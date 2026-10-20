// MultiChat — hosted Twitch + Kick + YouTube chat overlay for OBS.
//
// Streamers sign in with Twitch, Kick or Google (YouTube), style their overlay on /setup,
// and paste their personal /o/<token> link into an OBS Browser source. Nothing to install.
//
// Run locally:  node server.mjs            (open http://localhost:8787 — a test sign-in is available)
// Deploy:       see DEPLOY.md               (needs Node 22.5+; no npm packages)

import http from 'node:http';
import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { BASE_URL, PORT, ROOT, PUBLIC_DIR, THEMES_DIR, IS_HTTPS, DEV_LOGIN, enabledProviders } from './lib/config.mjs';
import { json, redirect, readBody, readJson, sse, serveStatic, parseCookies, cookie, rateLimit, clientIp, log } from './lib/util.mjs';
import * as db from './lib/db.mjs';
import { DEFAULTS, cleanSettings } from './lib/settings.mjs';
import { startAuth, finishAuth, platformOf, providerOf } from './lib/auth.mjs';
import { listThemes, watchThemes } from './lib/themes.mjs';
import { UPLOADS_ROOT, KINDS, listUploads, saveUpload, deleteUpload, deleteAllUploads, uploadsBase } from './lib/uploads.mjs';
import { addListener, removeListener, emit, emitAll, setStatus, clearUser } from './lib/events.mjs';
import { checkChannel, kickFetch, normKick } from './lib/channels.mjs';
import { joinRelay } from './lib/youtube.mjs';

const BASE_ORIGIN = new URL(BASE_URL).origin;
const overlayUrl = user => `${BASE_URL}/o/${user.overlay_token}`;
const sessionUser = req => db.getSessionUser(parseCookies(req).mc_session);
const forbidden = res => json(res, 403, { error: 'forbidden' });

// state-changing requests from the setup page must come from our own site (CSRF protection)
function sameOrigin(req) {
  const o = req.headers.origin;
  if (o) return o === BASE_ORIGIN;
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin';
}

function signIn(res, userId, location) {
  const { token, maxAge } = db.createSession(userId);
  redirect(res, location, { 'Set-Cookie': [cookie('mc_session', token, { maxAge, secure: IS_HTTPS }), cookie('mc_oauth', '', { maxAge: 0, secure: IS_HTTPS })] });
}

// ---------- sign-in result: log in, create an account, or connect another platform ----------
async function handleAuthResult(res, { platform, profile, linkUserId, returnTo }) {
  const existing = db.getAccount(platform, profile.id);
  if (linkUserId) {
    if (existing && existing.user_id !== linkUserId) return redirect(res, '/setup?error=in_use');
    db.upsertAccount(linkUserId, platform, profile);
    const user = db.getUser(linkUserId);
    const settings = { ...user.settings, [platform]: profile.channel };
    db.saveSettings(linkUserId, settings);
    emit(linkUserId, 'settings', settings);
    return redirect(res, `${returnTo}?connected=${platform}`);
  }
  if (existing) {
    db.upsertAccount(existing.user_id, platform, profile); // refresh name / avatar / channel
    return signIn(res, existing.user_id, '/setup');
  }
  const user = db.createUser({ displayName: profile.displayName, avatar: profile.avatar, settings: { [platform]: profile.channel } });
  db.upsertAccount(user.id, platform, profile);
  log(`new user ${user.id} via ${platform} (${profile.login})`);
  return signIn(res, user.id, '/setup?welcome=1');
}

// local-only test sign-in; imports settings from the old single-user version on first use
async function devLogin(res) {
  let acct = db.getAccount('dev', 'local');
  if (!acct) {
    let legacy = {};
    const legacyFile = path.join(ROOT, 'multichat-settings.json');
    try { legacy = JSON.parse(await readFile(legacyFile, 'utf8')); await rename(legacyFile, legacyFile + '.imported'); } catch {}
    const user = db.createUser({ displayName: 'Test streamer', settings: legacy });
    db.saveSettings(user.id, cleanSettings(legacy, user.settings, uploadsBase(user.id)));
    db.upsertAccount(user.id, 'dev', { id: 'local', login: 'test', displayName: 'Test streamer' });
    acct = db.getAccount('dev', 'local');
  }
  signIn(res, acct.user_id, '/setup');
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  const p = url.pathname;
  const method = req.method;
  try {
    // ----- pages -----
    if (p === '/') return sessionUser(req) ? redirect(res, '/setup') : serveStatic(res, PUBLIC_DIR, 'login.html');
    if (p === '/setup') return sessionUser(req) ? serveStatic(res, PUBLIC_DIR, 'dashboard.html') : redirect(res, '/');
    if (/^\/o\/[\w-]{10,}$/.test(p)) return serveStatic(res, PUBLIC_DIR, 'overlay.html');
    if (p.startsWith('/assets/')) return serveStatic(res, path.join(PUBLIC_DIR, 'assets'), p.slice(8), { cache: 'public, max-age=3600' });
    if (p.startsWith('/themes/')) { res.setHeader('Access-Control-Allow-Origin', '*'); return serveStatic(res, THEMES_DIR, p.slice(8), { cache: 'no-cache' }); }
    if (p.startsWith('/u/')) { res.setHeader('Access-Control-Allow-Origin', '*'); return serveStatic(res, UPLOADS_ROOT, p.slice(3), { cache: 'public, max-age=86400', userContent: true }); }
    if (p === '/health') { res.writeHead(200); return res.end('ok'); }

    // ----- sign-in -----
    if (p === '/auth/providers') return json(res, 200, { providers: enabledProviders(), dev: DEV_LOGIN });
    if (p === '/auth/dev') return DEV_LOGIN ? devLogin(res) : forbidden(res);
    if (p === '/auth/logout' && method === 'POST') {
      if (!sameOrigin(req)) return forbidden(res);
      db.deleteSession(parseCookies(req).mc_session);
      res.setHeader('Set-Cookie', cookie('mc_session', '', { maxAge: 0, secure: IS_HTTPS }));
      return json(res, 200, { ok: true });
    }
    let m = p.match(/^\/auth\/(twitch|kick|google)(\/callback)?$/);
    if (m) {
      const provider = m[1];
      if (!enabledProviders().includes(provider)) return redirect(res, '/?error=not_configured');
      if (!m[2]) {
        if (!rateLimit('auth:' + clientIp(req), 30, 60e3)) return redirect(res, '/?error=slow_down');
        const me = sessionUser(req);
        return startAuth(provider, res, { linkUserId: me?.id || null });
      }
      try { return await handleAuthResult(res, await finishAuth(provider, req, url)); }
      catch (e) {
        log(`sign-in with ${provider} failed: ${e.message}`);
        const back = sessionUser(req) ? '/setup' : '/';
        return redirect(res, `${back}?error=${encodeURIComponent(e.userMessage || 'signin_failed')}&provider=${provider}`);
      }
    }

    // ----- overlay APIs (authorized by the secret token in the OBS link) -----
    m = p.match(/^\/api\/o\/([\w-]{10,})\/(settings|events|status|yt|kick)$/);
    if (m) {
      const user = db.getUserByOverlayToken(m[1]);
      if (!user) return json(res, 404, { error: 'This overlay link is no longer valid. Copy the new one from your MultiChat setup page.' });
      res.setHeader('Access-Control-Allow-Origin', '*');
      switch (m[2]) {
        case 'settings': return json(res, 200, { settings: user.settings, uploadsBase: uploadsBase(user.id) });
        case 'events': sse(req, res, () => removeListener(user.id, res)); return addListener(user.id, res);
        case 'status':
          if (method !== 'POST' || !rateLimit('st:' + user.id, 120, 60e3)) return json(res, 429, {});
          setStatus(user.id, await readJson(req));
          return json(res, 200, { ok: true });
        case 'yt': {
          const target = (url.searchParams.get('channel') || '').trim().slice(0, 200);
          if (!target) return json(res, 400, { error: 'missing channel' });
          sse(req, res, () => relay?.remove(res));
          const relay = joinRelay(target, res);
          if (!relay) { res.write(`event: status\ndata: ${JSON.stringify({ state: 'error', detail: 'server busy — try again soon' })}\n\n`); res.end(); }
          return;
        }
        case 'kick': {
          if (!rateLimit('kick:' + user.id, 30, 60e3)) return json(res, 429, {});
          const r = await kickFetch(normKick(url.searchParams.get('slug')));
          const j = r.ok ? await r.json() : {};
          return json(res, r.status, { chatroom: j.chatroom ? { id: j.chatroom.id } : null });
        }
      }
    }

    // ----- setup-page APIs (need a signed-in session) -----
    if (p.startsWith('/api/')) {
      const user = sessionUser(req);
      if (!user) return json(res, 401, { error: 'signed_out' });
      if (method !== 'GET' && !sameOrigin(req)) return forbidden(res);

      if (p === '/api/me') return json(res, 200, {
        user: { id: user.id, displayName: user.display_name, avatar: user.avatar },
        accounts: db.listAccounts(user.id).filter(a => a.provider !== 'dev'),
        overlayUrl: overlayUrl(user), overlayPath: `/o/${user.overlay_token}`, uploadsBase: uploadsBase(user.id),
        providers: enabledProviders(), dev: DEV_LOGIN,
      });
      if (p === '/api/settings') {
        if (method === 'POST') {
          const settings = cleanSettings(await readJson(req), user.settings, uploadsBase(user.id));
          db.saveSettings(user.id, settings);
          emit(user.id, 'settings', settings);
          return json(res, 200, settings);
        }
        return json(res, 200, user.settings);
      }
      if (p === '/api/defaults') return json(res, 200, DEFAULTS);
      if (p === '/api/themes') return json(res, 200, await listThemes());
      if (p === '/api/uploads') return json(res, 200, await listUploads(user.id));
      if (p === '/api/upload') {
        const kind = url.searchParams.get('kind');
        if (!KINDS[kind]) return json(res, 400, { error: 'unknown kind' });
        if (method === 'DELETE') {
          await deleteUpload(user.id, kind, path.basename(url.searchParams.get('name') || ''));
          emit(user.id, 'uploads');
          return json(res, 200, { ok: true });
        }
        if (method !== 'POST') return json(res, 405, {});
        if (!rateLimit('up:' + user.id, 30, 60e3)) return json(res, 429, { error: 'Too many uploads — wait a minute.' });
        let body;
        try { body = await readBody(req, KINDS[kind].max); }
        catch { return json(res, 413, { error: `File is too big (max ${KINDS[kind].max / 1048576} MB)` }); }
        try {
          const saved = await saveUpload(user.id, kind, url.searchParams.get('name'), body);
          emit(user.id, 'uploads');
          return json(res, 200, saved);
        } catch (e) { return json(res, e.code || 500, { error: e.message }); }
      }
      if (p === '/api/test' && method === 'POST') { emit(user.id, 'test'); return json(res, 200, { ok: true }); }
      if (p === '/api/check') {
        if (!rateLimit('check:' + user.id, 40, 60e3)) return json(res, 429, { ok: true, live: null });
        try { return json(res, 200, await checkChannel(url.searchParams.get('platform') || '', url.searchParams.get('name') || '')); }
        catch (e) { return json(res, 200, { ok: true, live: null, error: e.message }); }
      }
      if (p === '/api/events') { sse(req, res, () => removeListener(user.id, res)); return addListener(user.id, res); }
      if (p === '/api/accounts/disconnect' && method === 'POST') {
        const { platform } = await readJson(req);
        const accounts = db.listAccounts(user.id);
        if (accounts.length <= 1) return json(res, 400, { error: 'You need at least one connected account to sign in. Connect another one first, or delete your MultiChat account.' });
        db.removeAccount(user.id, platform);
        const settings = { ...user.settings, [platform]: '' };
        db.saveSettings(user.id, settings);
        emit(user.id, 'settings', settings);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/overlay/regenerate' && method === 'POST') {
        const token = db.regenerateOverlayToken(user.id);
        emit(user.id, 'settings', user.settings); // old overlays reload and find their link is gone
        return json(res, 200, { overlayUrl: `${BASE_URL}/o/${token}`, overlayPath: `/o/${token}` });
      }
      if (p === '/api/account/delete' && method === 'POST') {
        clearUser(user.id);
        await deleteAllUploads(user.id);
        db.deleteUser(user.id);
        log(`deleted user ${user.id}`);
        res.setHeader('Set-Cookie', cookie('mc_session', '', { maxAge: 0, secure: IS_HTTPS }));
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    log('error', method, p, e.stack || e.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Something went wrong');
  }
});

watchThemes(() => { emitAll('themes'); emitAll('reload'); });

server.listen(PORT, () => {
  const providers = enabledProviders();
  console.log(`\n  MultiChat running at ${BASE_URL}`);
  console.log(`  Sign-in providers: ${providers.length ? providers.join(', ') : 'none configured'}${DEV_LOGIN ? '  (+ local test sign-in)' : ''}\n`);
  if (!providers.length && !DEV_LOGIN) console.log('  ⚠ No sign-in providers are configured — see DEPLOY.md\n');
});
