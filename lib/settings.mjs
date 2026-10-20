// Overlay settings: defaults and validation. Appearance values left as '' mean "use the theme's default".

import { normTwitch, normKick } from './channels.mjs';

export const DEFAULTS = {
  twitch: '', kick: '', youtube: '',
  theme: 'default',
  // text
  size: 18, fontMessage: '', fontName: '', nameBold: true,
  // colors
  textColor: '', nameMode: 'theme', nameColor: '', outlineColor: '', highlightColor: '',
  twitchColor: '', kickColor: '', youtubeColor: '',
  bubbleColor: '', bubbleOpacity: 55,
  // layout
  max: 50, fade: 0, align: 'left',
  icons: true, badges: true, boxed: false, shadow: true, animate: true,
  // background
  chatBgColor: '', chatBgOpacity: 60,
  bgImage: '', bgTarget: 'chat', bgFit: 'cover', bgPosition: 'center', bgImageOpacity: 100, bgBlur: 0, bgRadius: 12,
  // filters
  hidecmd: false, ignore: 'nightbot, streamelements, streamlabs, botrix, moobot, fossabot',
};
const ENUMS = {
  nameMode: ['theme', 'user', 'platform', 'custom'],
  align: ['left', 'right', 'center'],
  bgTarget: ['chat', 'messages'],
  bgFit: ['cover', 'contain', 'tile', 'stretch'],
  bgPosition: ['center', 'top', 'bottom', 'left', 'right'],
};
const COLOR_KEYS = ['textColor', 'nameColor', 'outlineColor', 'highlightColor', 'twitchColor', 'kickColor', 'youtubeColor', 'bubbleColor', 'chatBgColor'];
const RANGES = { size: [8, 72], max: [5, 500], fade: [0, 3600], bubbleOpacity: [0, 100], chatBgOpacity: [0, 100], bgImageOpacity: [0, 100], bgBlur: [0, 40], bgRadius: [0, 60] };

// uploadsBase is the user's own upload path, e.g. "/u/<userId>"
export function cleanSettings(input, base, uploadsBase) {
  const out = { ...DEFAULTS, ...base };
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (!(k in input)) continue;
    const v = input[k];
    if (typeof def === 'boolean') out[k] = !!v;
    else if (typeof def === 'number') { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
    else out[k] = String(v ?? '').slice(0, 500).trim();
  }
  out.twitch = normTwitch(out.twitch);
  out.kick = normKick(out.kick);
  out.youtube = out.youtube.slice(0, 200);
  for (const [k, [lo, hi]] of Object.entries(RANGES)) out[k] = Math.min(Math.max(out[k], lo), hi);
  out.max = Math.round(out.max);
  for (const k of COLOR_KEYS) if (out[k] && !/^#[0-9a-f]{6}$/i.test(out[k])) out[k] = '';
  for (const [k, allowed] of Object.entries(ENUMS)) if (!allowed.includes(out[k])) out[k] = DEFAULTS[k];
  out.theme = out.theme.replace(/[^a-z0-9_-]/gi, '') || 'default';
  for (const k of ['fontMessage', 'fontName']) out[k] = out[k].replace(/["<>;{}\\]/g, '').slice(0, 120);
  const ownImage = new RegExp('^' + uploadsBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/images/[\\w.-]+$');
  if (out.bgImage && !ownImage.test(out.bgImage) && !/^https:\/\/[^\s"'()<>\\]+$/i.test(out.bgImage)) out.bgImage = '';
  return out;
}
