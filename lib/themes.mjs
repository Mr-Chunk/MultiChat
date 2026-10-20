// Themes are CSS files in ./themes (see THEMES.md). Shared by every user.

import { readdir, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { THEMES_DIR } from './config.mjs';

export async function listThemes() {
  const files = (await readdir(THEMES_DIR).catch(() => [])).filter(f => f.endsWith('.css') && !f.startsWith('_'));
  const themes = [];
  for (const f of files) {
    const css = await readFile(path.join(THEMES_DIR, f), 'utf8').catch(() => '');
    const head = css.slice(0, 2000);
    const meta = k => head.match(new RegExp('@' + k + '\\s+([^\\n*]+)'))?.[1]?.trim() || '';
    const id = f.slice(0, -4);
    themes.push({ id, name: meta('name') || id, description: meta('description'), author: meta('author'),
      swatch: meta('swatch').split(/\s+/).filter(c => /^#[0-9a-f]{3,8}$/i.test(c)) });
  }
  return themes.sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.name.localeCompare(b.name)));
}

// Calls onChange (debounced) whenever a theme file is added or edited.
export function watchThemes(onChange) {
  let t;
  try { watch(THEMES_DIR, () => { clearTimeout(t); t = setTimeout(onChange, 300); }); } catch {}
}
