# MultiChat

Hosted Twitch + Kick + YouTube chat overlay for OBS. Streamers sign in (Twitch / Kick / Google), style their overlay, and paste a personal link into OBS. Node 22.13+, **no npm dependencies** (uses `node:sqlite`). Keep it that way.

Run locally: `npm run dev`, then open http://localhost:8787. On localhost, "Continue as test user" signs in without OAuth. Deploying is covered in `DEPLOY.md`.

## Layout
- `server.mjs`: HTTP routes
  - pages: `/` (sign-in), `/setup` (needs a session), `/o/<token>` (the OBS overlay)
  - `/auth/*`: sign-in
  - `/api/*`: setup page, cookie session + same-origin check
  - `/api/o/<token>/*`: overlay, authorized by the overlay token
- `lib/`:
  - `config` (env vars), `db` (users, accounts, sessions), `auth` (OAuth providers), `settings` (defaults + validation)
  - `uploads` (per-user files at `/u/<userId>/…`), `events` (per-user SSE), `youtube` (shared chat relay), `channels` (lookups), `themes`, `util`
- `public/`: `login.html`, `dashboard.html`, `overlay.html`, `assets/fonts.js` (font catalog)
- `themes/`: one CSS file per theme, shared by all users
- `DATA_DIR` (default `./data`): `multichat.db` + `uploads/`

## Adding a custom theme when asked

Create **one new file** `themes/<id>.css` following `THEMES.md` (start from `themes/_template.css`):
- Include the `@name` / `@description` / `@swatch` header.
- Set defaults via `--mc-*` variables in `:root`, and use `var(--mc-…)` in rules so setup-page settings still override.
- Only use the documented classes. Follow the "Rules" section of THEMES.md.

Do **not** edit `public/overlay.html`, `public/dashboard.html` or the server to add a theme. Themes are CSS only and appear for every user automatically.

## Notes
- Kick's Pusher key is hard-coded in `public/overlay.html` (`KICK_PUSHER_KEY`). If Kick chat stops, POST to
  `https://web.kick.com/api/v1/realtime/channels/<id>/chat/connection` with `accepted_providers:[{provider:"pusher"}]` to get the current key.
- Google font names in `public/assets/fonts.js` must be exact Google Fonts family names.
- OAuth access tokens are used once to read the user's identity/channel and are never stored.
