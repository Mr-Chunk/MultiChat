// "Sign in with Twitch / Kick / Google (YouTube)" — standard OAuth 2 authorization-code flow.
// We only ask for read-only identity scopes, use the access token once to learn who the user is
// and which channel they own, and then throw it away. No tokens are stored.

import { randomBytes, createHash } from 'node:crypto';
import { BASE_URL, PROVIDERS, IS_HTTPS } from './config.mjs';
import { cookie, parseCookies } from './util.mjs';

const b64url = buf => buf.toString('base64url');
const pkce = () => { const verifier = b64url(randomBytes(32)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; };
const redirectUri = provider => `${BASE_URL}/auth/${provider}/callback`;

async function postForm(url, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`token exchange failed (${r.status}) ${j.error_description || j.error || j.message || ''}`.trim());
  return j.access_token;
}
async function getJson(url, headers) {
  const r = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`${new URL(url).host} returned ${r.status}`);
  return r.json();
}

// Each provider: platform it connects, authorize URL builder, and how to turn a code into a profile.
// A profile is { id, login, displayName, avatar, channel } — channel is what goes into the overlay settings.
const IMPL = {
  twitch: {
    platform: 'twitch',
    authorize: ({ state }) => 'https://id.twitch.tv/oauth2/authorize?' + new URLSearchParams({
      client_id: PROVIDERS.twitch.clientId, redirect_uri: redirectUri('twitch'), response_type: 'code', scope: '', state, force_verify: 'true',
    }),
    async profile({ code }) {
      const token = await postForm('https://id.twitch.tv/oauth2/token', {
        client_id: PROVIDERS.twitch.clientId, client_secret: PROVIDERS.twitch.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri('twitch'),
      });
      const u = (await getJson('https://api.twitch.tv/helix/users', { Authorization: `Bearer ${token}`, 'Client-Id': PROVIDERS.twitch.clientId })).data?.[0];
      if (!u) throw new Error('Twitch did not return a user');
      return { id: u.id, login: u.login, displayName: u.display_name, avatar: u.profile_image_url, channel: u.login };
    },
  },
  kick: {
    platform: 'kick',
    authorize: ({ state, challenge }) => 'https://id.kick.com/oauth/authorize?' + new URLSearchParams({
      client_id: PROVIDERS.kick.clientId, redirect_uri: redirectUri('kick'), response_type: 'code', scope: 'user:read channel:read',
      code_challenge: challenge, code_challenge_method: 'S256', state,
    }),
    async profile({ code, verifier }) {
      const token = await postForm('https://id.kick.com/oauth/token', {
        grant_type: 'authorization_code', client_id: PROVIDERS.kick.clientId, client_secret: PROVIDERS.kick.clientSecret,
        redirect_uri: redirectUri('kick'), code_verifier: verifier, code,
      });
      const auth = { Authorization: `Bearer ${token}` };
      const u = (await getJson('https://api.kick.com/public/v1/users', auth)).data?.[0];
      if (!u) throw new Error('Kick did not return a user');
      const ch = (await getJson('https://api.kick.com/public/v1/channels', auth).catch(() => ({}))).data?.[0];
      const slug = ch?.slug || String(u.name || '').toLowerCase();
      return { id: u.user_id, login: slug, displayName: u.name, avatar: u.profile_picture || '', channel: slug };
    },
  },
  google: {
    platform: 'youtube',
    authorize: ({ state, challenge }) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: PROVIDERS.google.clientId, redirect_uri: redirectUri('google'), response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly', state, code_challenge: challenge, code_challenge_method: 'S256',
      prompt: 'select_account', access_type: 'online', include_granted_scopes: 'false',
    }),
    async profile({ code, verifier }) {
      const token = await postForm('https://oauth2.googleapis.com/token', {
        code, client_id: PROVIDERS.google.clientId, client_secret: PROVIDERS.google.clientSecret,
        redirect_uri: redirectUri('google'), grant_type: 'authorization_code', code_verifier: verifier,
      });
      const ch = (await getJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { Authorization: `Bearer ${token}` })).items?.[0];
      if (!ch) throw Object.assign(new Error('That Google account has no YouTube channel'), { userMessage: 'no_channel' });
      return { id: ch.id, login: ch.snippet?.customUrl || ch.id, displayName: ch.snippet?.title || '', avatar: ch.snippet?.thumbnails?.default?.url || '', channel: ch.id };
    },
  },
};
export const platformOf = provider => IMPL[provider]?.platform;
export const providerOf = platform => Object.keys(IMPL).find(p => IMPL[p].platform === platform);

// Pending sign-ins, keyed by the random `state` (also stored in a short-lived cookie to bind it to this browser).
const pending = new Map();
setInterval(() => { const cut = Date.now() - 15 * 60e3; for (const [k, v] of pending) if (v.at < cut) pending.delete(k); }, 60e3).unref();

export function startAuth(provider, res, { linkUserId = null, returnTo = '/setup' } = {}) {
  const state = b64url(randomBytes(24));
  const { verifier, challenge } = pkce();
  pending.set(state, { provider, verifier, linkUserId, returnTo, at: Date.now() });
  res.writeHead(302, {
    Location: IMPL[provider].authorize({ state, challenge }),
    'Set-Cookie': cookie('mc_oauth', state, { maxAge: 900, secure: IS_HTTPS }),
    'Cache-Control': 'no-store',
  });
  res.end();
}

// Returns { platform, profile, linkUserId, returnTo }. Throws with .userMessage for friendly errors.
export async function finishAuth(provider, req, url) {
  const state = url.searchParams.get('state') || '';
  const p = pending.get(state);
  pending.delete(state);
  if (url.searchParams.get('error')) throw Object.assign(new Error('cancelled'), { userMessage: 'cancelled' });
  if (!p || p.provider !== provider || parseCookies(req).mc_oauth !== state) throw Object.assign(new Error('bad state'), { userMessage: 'expired' });
  const profile = await IMPL[provider].profile({ code: url.searchParams.get('code') || '', verifier: p.verifier });
  return { platform: IMPL[provider].platform, profile, linkUserId: p.linkUserId, returnTo: p.returnTo };
}
