// Small shared helpers: logging, HTTP request/response utilities, cookies.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export function readBody(req, limit = 1e5) {
  return new Promise((ok, fail) => {
    const chunks = []; let size = 0;
    req.on('data', d => { size += d.length; if (size > limit) { fail(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(d); });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}
export async function readJson(req) {
  const b = (await readBody(req)).toString();
  try { return b ? JSON.parse(b) : {}; } catch { return {}; }
}

export function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
export function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export function sse(req, res, onClose) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': hi\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); onClose(); });
}
export const sseSend = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

// Serve a file from rootDir, refusing anything that escapes it.
// userContent=true locks the response down (uploads could be hostile SVGs).
export async function serveStatic(res, rootDir, rel, { cache = 'no-store', userContent = false } = {}) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { res.writeHead(400); return res.end(); }
  const root = path.resolve(rootDir);
  const file = path.resolve(root, '.' + path.sep + decoded);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' };
    if (userContent) headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
    res.writeHead(200, headers);
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookie(name, value, { maxAge, secure, httpOnly = true, path: p = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${p}; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  return c;
}

// Very small fixed-window rate limiter, keyed by e.g. IP + route.
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  return ++b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000).unref();

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
