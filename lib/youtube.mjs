// YouTube live chat relay. Browsers can't read YouTube chat directly (CORS), so the server polls
// YouTube's own live_chat endpoint and streams messages to overlays over Server-Sent Events.
// One relay per channel is shared by every overlay watching it, and stops when nobody is.

import { UA, sleep, log, sseSend } from './util.mjs';
import { LIMITS } from './config.mjs';

export const YT_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' };

export async function resolveVideoId(target) {
  target = target.trim();
  const m = target.match(/(?:v=|youtu\.be\/|\/live\/)([\w-]{11})/);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(target) && !target.startsWith('@')) return target;
  const url = /^UC[\w-]{22}$/.test(target)
    ? `https://www.youtube.com/channel/${target}/live`
    : `https://www.youtube.com/${target.startsWith('@') ? target : '@' + target}/live`;
  const html = await (await fetch(url, { headers: YT_HEADERS })).text();
  const c = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
  if (!c) return null;
  // /live can point at an upcoming or finished stream; only accept one that is live now
  if (!/"isLiveNow":true/.test(html) && !/"isLive":true/.test(html)) return null;
  return c[1];
}

function runsToParts(runs = []) {
  return runs.map(r => {
    if (r.emoji) {
      const thumbs = r.emoji.image?.thumbnails || [];
      const name = r.emoji.shortcuts?.[0] || r.emoji.emojiId || '';
      // standard unicode emoji come through as images too — keep them as text
      if (!r.emoji.isCustomEmoji && r.emoji.emojiId && !/^UC/.test(r.emoji.emojiId)) return { text: r.emoji.emojiId };
      return { emote: thumbs[thumbs.length - 1]?.url, name };
    }
    return { text: r.text ?? '' };
  });
}

function parseAction(a) {
  const item = a.addChatItemAction?.item;
  if (!item) {
    const del = a.markChatItemAsDeletedAction || a.removeChatItemAction;
    if (del) return { type: 'delete', id: del.targetItemId };
    const ban = a.markChatItemsByAuthorAsDeletedAction || a.removeChatItemByAuthorAction;
    if (ban) return { type: 'clearuser', user: ban.externalChannelId };
    return null;
  }
  const r = item.liveChatTextMessageRenderer || item.liveChatPaidMessageRenderer || item.liveChatMembershipItemRenderer;
  if (!r) return null;
  const badges = [];
  const roles = [];
  for (const b of r.authorBadges || []) {
    const br = b.liveChatAuthorBadgeRenderer;
    const icon = br?.icon?.iconType;
    if (icon) roles.push(icon.toLowerCase()); // owner, moderator, verified
    const t = br?.customThumbnail?.thumbnails;
    if (t?.length) { badges.push({ url: t[t.length - 1].url, title: br.tooltip }); roles.push('member'); }
  }
  const msg = {
    type: 'msg',
    id: r.id,
    userId: r.authorExternalChannelId,
    user: (r.authorName?.simpleText || '').replace(/^@/, ''),
    badges, roles,
    parts: runsToParts(r.message?.runs || r.headerSubtext?.runs),
  };
  if (item.liveChatPaidMessageRenderer) { msg.highlight = 'superchat'; msg.amount = r.purchaseAmountText?.simpleText; }
  if (item.liveChatMembershipItemRenderer) { msg.highlight = 'member'; }
  return msg;
}

class YouTubeRelay {
  constructor(target) { this.target = target; this.key = target.toLowerCase(); this.clients = new Set(); this.running = false; this.status = 'starting'; }
  add(res) { this.clients.add(res); this.send(res, 'status', { state: this.status }); if (!this.running) this.loop(); }
  remove(res) { this.clients.delete(res); }
  send(res, ev, data) { sseSend(res, ev, data); }
  broadcast(ev, data) { for (const c of this.clients) this.send(c, ev, data); }
  setStatus(state, detail) { this.status = state; this.broadcast('status', { state, detail }); log(`[yt ${this.target}] ${state}${detail ? ' — ' + detail : ''}`); }

  async loop() {
    this.running = true;
    while (this.clients.size) {
      try {
        const vid = await resolveVideoId(this.target);
        if (!vid) { this.setStatus('offline', 'not live — checking again in 60s'); await this.idle(60000); continue; }
        const page = await (await fetch(`https://www.youtube.com/live_chat?is_popout=1&v=${vid}`, { headers: YT_HEADERS })).text();
        const key = page.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
        const ver = page.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || '2.20240101.00.00';
        let cont = page.match(/"continuation":"([^"]+)"/)?.[1];
        if (!key || !cont) { this.setStatus('offline', 'live chat unavailable — retrying in 60s'); await this.idle(60000); continue; }
        this.setStatus('connected', vid);
        let fails = 0;
        while (this.clients.size && cont) {
          const res = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${key}&prettyPrint=false`, {
            method: 'POST',
            headers: { ...YT_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'en' } }, continuation: cont }),
          });
          if (!res.ok) { if (++fails > 3) throw new Error('HTTP ' + res.status); await sleep(3000); continue; }
          fails = 0;
          const j = await res.json();
          const lc = j.continuationContents?.liveChatContinuation;
          if (!lc) break; // stream ended
          for (const a of lc.actions || []) { const m = parseAction(a); if (m) this.broadcast(m.type, m); }
          const c = lc.continuations?.[0];
          const cd = c?.invalidationContinuationData || c?.timedContinuationData || c?.reloadContinuationData;
          cont = cd?.continuation;
          await sleep(Math.min(Math.max(cd?.timeoutMs ?? 2000, 1000), 5000));
        }
        this.setStatus('offline', 'stream ended — rechecking');
        await this.idle(15000);
      } catch (e) {
        this.setStatus('error', e.message);
        await this.idle(15000);
      }
    }
    this.running = false;
    if (!this.clients.size && relays.get(this.key) === this) relays.delete(this.key);
  }
  async idle(ms) { for (let t = 0; t < ms && this.clients.size; t += 1000) await sleep(1000); }
}

const relays = new Map();

// Attach an SSE response to the relay for this channel (creating it if needed).
// Returns false when the server is at its relay limit.
export function joinRelay(target, res) {
  const key = target.trim().toLowerCase();
  let relay = relays.get(key);
  if (!relay) {
    if (relays.size >= LIMITS.maxYouTubeRelays) return null;
    relay = new YouTubeRelay(target.trim());
    relays.set(key, relay);
  }
  relay.add(res);
  return relay;
}
export const relayCount = () => relays.size;
