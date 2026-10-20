// Live events between a user's setup page and their overlays (Server-Sent Events).
//   settings  → overlays reload with the new look
//   test      → overlays show sample messages
//   status    → setup page shows "Chat connected" etc.
//   uploads / themes → setup page refreshes those lists

import { sseSend } from './util.mjs';

const listeners = new Map(); // userId -> Set(res)
const statuses = new Map();  // userId -> { "platform:channel": status }

export function addListener(userId, res) {
  if (!listeners.has(userId)) listeners.set(userId, new Set());
  listeners.get(userId).add(res);
  sseSend(res, 'statuses', Object.values(statuses.get(userId) || {}));
}
export function removeListener(userId, res) {
  const set = listeners.get(userId);
  if (!set) return;
  set.delete(res);
  if (!set.size) { listeners.delete(userId); statuses.delete(userId); }
}
export function emit(userId, ev, data = {}) {
  for (const res of listeners.get(userId) || []) sseSend(res, ev, data);
}
export function emitAll(ev, data = {}) {
  for (const set of listeners.values()) for (const res of set) sseSend(res, ev, data);
}
export function setStatus(userId, s) {
  const st = { platform: String(s.platform).slice(0, 20), channel: String(s.channel || '').slice(0, 200), state: String(s.state || '').slice(0, 30), detail: String(s.detail || '').slice(0, 200), at: Date.now() };
  if (!statuses.has(userId)) statuses.set(userId, {});
  statuses.get(userId)[st.platform + ':' + st.channel.toLowerCase()] = st;
  emit(userId, 'status', st);
}
export function clearUser(userId) {
  statuses.delete(userId);
  for (const res of listeners.get(userId) || []) res.end();
  listeners.delete(userId);
}
