// User storage in a single SQLite file (Node's built-in node:sqlite — nothing to install).
//
//   users     one row per streamer: settings JSON + the secret token in their OBS link
//   accounts  the Twitch / Kick / YouTube accounts they connected (one user can have several)
//   sessions  sign-in sessions for the setup page (only a hash of the cookie is stored)

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';
import { DEFAULTS } from './settings.mjs';

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'multichat.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    overlay_token TEXT NOT NULL UNIQUE,
    settings TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS accounts (
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    connected_at INTEGER NOT NULL,
    PRIMARY KEY (provider, provider_user_id)
  );
  CREATE INDEX IF NOT EXISTS accounts_user ON accounts(user_id);
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

export const newId = (bytes = 12) => randomBytes(bytes).toString('base64url');
const hash = s => createHash('sha256').update(s).digest('hex');

// ---------- users ----------
const toUser = row => row && { ...row, settings: { ...DEFAULTS, ...JSON.parse(row.settings || '{}') } };

export const getUser = id => toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
export const getUserByOverlayToken = token => toUser(db.prepare('SELECT * FROM users WHERE overlay_token = ?').get(token));

export function createUser({ displayName = '', avatar = '', settings = {} } = {}) {
  const id = newId(9);
  db.prepare('INSERT INTO users (id, created_at, display_name, avatar, overlay_token, settings) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, Date.now(), displayName, avatar, newId(18), JSON.stringify({ ...DEFAULTS, ...settings }));
  return getUser(id);
}
export function saveSettings(userId, settings) {
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(settings), userId);
}
export function updateProfile(userId, { displayName, avatar }) {
  db.prepare('UPDATE users SET display_name = ?, avatar = ? WHERE id = ?').run(displayName || '', avatar || '', userId);
}
export function regenerateOverlayToken(userId) {
  const token = newId(18);
  db.prepare('UPDATE users SET overlay_token = ? WHERE id = ?').run(token, userId);
  return token;
}
export function deleteUser(userId) {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// ---------- connected accounts ----------
export const getAccount = (provider, providerUserId) =>
  db.prepare('SELECT * FROM accounts WHERE provider = ? AND provider_user_id = ?').get(provider, String(providerUserId));
export const listAccounts = userId =>
  db.prepare('SELECT provider, login, display_name, avatar, connected_at FROM accounts WHERE user_id = ? ORDER BY connected_at').all(userId);

export function upsertAccount(userId, provider, { id, login, displayName, avatar }) {
  db.prepare(`INSERT INTO accounts (provider, provider_user_id, user_id, login, display_name, avatar, connected_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(provider, provider_user_id) DO UPDATE SET login = excluded.login, display_name = excluded.display_name, avatar = excluded.avatar`)
    .run(provider, String(id), userId, login || '', displayName || '', avatar || '', Date.now());
}
export function removeAccount(userId, provider) {
  db.prepare('DELETE FROM accounts WHERE user_id = ? AND provider = ?').run(userId, provider);
}

// ---------- sessions ----------
const SESSION_DAYS = 60;
export function createSession(userId) {
  const token = newId(32);
  db.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return { token, maxAge: SESSION_DAYS * 86400 };
}
export function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?').get(hash(token));
  if (!row || row.expires_at < Date.now()) return null;
  return getUser(row.user_id);
}
export function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash(token));
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3).unref();
