// Channel lookups for the setup page ("Found xQc · LIVE") and the Kick chatroom-id lookup.

import { UA } from './util.mjs';
import { YT_HEADERS } from './youtube.mjs';

export const normTwitch = v => String(v || '').trim().toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '');
export const normKick = v => String(v || '').trim().toLowerCase().replace(/^.*kick\.com\//, '').replace(/[^a-z0-9_-]/g, '');

// Kick sits behind Cloudflare, which rejects some header combos from Node — try plain first
export async function kickFetch(slug) {
  const url = `https://kick.com/api/v2/channels/${slug}`;
  let r;
  for (const headers of [{}, { Accept: 'application/json' }, { 'User-Agent': UA, Accept: 'application/json' }]) {
    r = await fetch(url, { headers });
    if (r.ok || r.status === 404) return r;
  }
  return r;
}

export async function checkChannel(platform, name) {
  name = String(name || '').trim();
  if (!name) return { ok: false, reason: 'empty' };
  if (platform === 'twitch') {
    const r = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query($l:String!){user(login:$l){displayName stream{id}}}', variables: { l: normTwitch(name) } }),
    });
    const u = (await r.json())?.data?.user;
    return u ? { ok: true, name: u.displayName, live: !!u.stream } : { ok: false, reason: 'not found' };
  }
  if (platform === 'kick') {
    const slug = normKick(name);
    const r = await kickFetch(slug);
    if (r.status === 404) return { ok: false, reason: 'not found' };
    if (!r.ok) return { ok: true, name: slug, live: null }; // Cloudflare hiccup — don't block the user
    const j = await r.json();
    return { ok: true, name: j.user?.username || slug, live: !!j.livestream?.is_live };
  }
  if (platform === 'youtube') {
    const m = name.match(/(?:v=|youtu\.be\/|\/live\/)([\w-]{11})/);
    const url = m ? `https://www.youtube.com/watch?v=${m[1]}`
      : /^UC[\w-]{22}$/.test(name) ? `https://www.youtube.com/channel/${name}/live`
      : `https://www.youtube.com/${name.startsWith('@') ? name : '@' + name}/live`;
    const r = await fetch(url, { headers: YT_HEADERS });
    if (r.status === 404) return { ok: false, reason: 'not found' };
    const html = await r.text();
    const ch = [...html.matchAll(/<meta itemprop="name" content="([^"]+)"/g)].pop()?.[1] || name;
    const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    return { ok: true, name: decode(ch), live: /"isLiveNow":true/.test(html) };
  }
  return { ok: false, reason: 'unknown platform' };
}
