// Per-user uploads (background images + custom fonts), stored under DATA_DIR/uploads/<userId>/.
// Served publicly at /u/<userId>/<kind>/<file> so OBS can load them.

import { readdir, mkdir, stat, unlink, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, LIMITS } from './config.mjs';

export const UPLOADS_ROOT = path.join(DATA_DIR, 'uploads');
export const KINDS = {
  images: { exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'], max: LIMITS.maxImageBytes },
  fonts: { exts: ['.ttf', '.otf', '.woff', '.woff2'], max: LIMITS.maxFontBytes },
};
export const uploadsBase = userId => `/u/${userId}`;
const dirFor = (userId, kind) => path.join(UPLOADS_ROOT, userId, kind);

export function safeName(name, kind) {
  const ext = path.extname(name).toLowerCase();
  if (!KINDS[kind]?.exts.includes(ext)) return null;
  const base = path.basename(name, path.extname(name)).replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 60) || 'file';
  return base + ext;
}

export async function listUploads(userId) {
  const out = {};
  for (const kind of Object.keys(KINDS)) {
    const dir = dirFor(userId, kind);
    const files = (await readdir(dir).catch(() => [])).filter(f => KINDS[kind].exts.includes(path.extname(f).toLowerCase()));
    out[kind] = await Promise.all(files.map(async f => ({
      name: f, url: `${uploadsBase(userId)}/${kind}/${encodeURIComponent(f)}`, size: (await stat(path.join(dir, f))).size,
    })));
  }
  return out;
}
async function usedBytes(userId) {
  const all = await listUploads(userId);
  return [...all.images, ...all.fonts].reduce((n, f) => n + f.size, 0);
}

// Returns { name, url } or throws an Error with a user-facing message and .code
export async function saveUpload(userId, kind, requestedName, body) {
  let name = safeName(requestedName || '', kind);
  if (!name) throw Object.assign(new Error(`Only ${KINDS[kind].exts.join(', ')} files are allowed`), { code: 400 });
  if ((await usedBytes(userId)) + body.length > LIMITS.uploadBytesPerUser)
    throw Object.assign(new Error(`You've used your ${LIMITS.uploadBytesPerUser / 1048576} MB of upload space. Delete some files first.`), { code: 413 });
  const dir = dirFor(userId, kind);
  await mkdir(dir, { recursive: true });
  const ext = path.extname(name), stem = name.slice(0, -ext.length);
  for (let i = 2; await stat(path.join(dir, name)).then(() => true, () => false); i++) name = `${stem}-${i}${ext}`;
  await writeFile(path.join(dir, name), body);
  return { name, url: `${uploadsBase(userId)}/${kind}/${encodeURIComponent(name)}` };
}

export async function deleteUpload(userId, kind, name) {
  if (!KINDS[kind] || !name || name !== safeName(name, kind)) return false;
  await unlink(path.join(dirFor(userId, kind), name)).catch(() => {});
  return true;
}
export async function deleteAllUploads(userId) {
  if (!/^[\w-]+$/.test(userId)) return;
  await rm(path.join(UPLOADS_ROOT, userId), { recursive: true, force: true });
}
