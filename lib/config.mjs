// All configuration comes from environment variables (see .env.example).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.PORT || 8787);
export const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
export const IS_HTTPS = BASE_URL.startsWith('https://');
export const IS_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const THEMES_DIR = path.join(ROOT, 'themes');

export const PROVIDERS = {
  twitch: { clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET },
  kick: { clientId: process.env.KICK_CLIENT_ID, clientSecret: process.env.KICK_CLIENT_SECRET },
  google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
};
export const enabledProviders = () => Object.keys(PROVIDERS).filter(p => PROVIDERS[p].clientId && PROVIDERS[p].clientSecret);

// "Continue as test user" sign-in — only ever available when running on this computer.
export const DEV_LOGIN = IS_LOCAL && process.env.DEV_LOGIN !== '0';

export const LIMITS = {
  uploadBytesPerUser: Number(process.env.UPLOAD_QUOTA_MB || 100) * 1024 * 1024,
  maxImageBytes: 30 * 1024 * 1024,
  maxFontBytes: 15 * 1024 * 1024,
  maxYouTubeRelays: Number(process.env.MAX_YT_RELAYS || 1000),
};
