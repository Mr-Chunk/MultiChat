# Putting MultiChat online

MultiChat is one small Node.js app with no packages to install. It needs:

- **Node 22.13 or newer**
- **A persistent disk** for `DATA_DIR`, which holds the database and uploaded images and fonts
- **HTTPS**, which every host below gives you automatically

The steps use **Railway** (about $5/month, simple, includes disks). Render, Fly.io or any VPS work the same way. Just set the same environment variables and mount a disk at `DATA_DIR`.

---

## 1. Put the code on GitHub

1. Create a free account at <https://github.com> if you don't have one.
2. Create a **new private repository** called `multichat`.
3. Upload everything in this folder **except** `data/`, `.env` and `multichat-settings.json*`. `.gitignore` already skips them.

(Or ask Claude to set up git and push it for you.)

## 2. Create the Railway service

1. Sign up at <https://railway.com> → **New Project** → **Deploy from GitHub repo** → pick `multichat`.
2. Open the service → **Settings → Networking → Generate Domain**. Copy the address, for example `https://multichat-production.up.railway.app`. This is your **BASE_URL**. You can add your own domain later.
3. **Right-click the service → Attach volume**, with mount path `/data`.
4. **Variables** tab, add:

| Variable | Value |
|---|---|
| `BASE_URL` | the address from step 2, no trailing slash |
| `DATA_DIR` | `/data` |

The site now runs, but sign-in buttons appear only after you add at least one provider below.

## 3. Sign-in providers

In each one, the **redirect URL** is your BASE_URL followed by the path shown. You can enable any combination.

### Twitch
1. Go to <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. **OAuth Redirect URLs:** `BASE_URL/auth/twitch/callback`
3. **Category:** Broadcaster Suite. **Client type:** Confidential.
4. Copy the **Client ID**, then click **New Secret** → add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in Railway.

### Kick
1. Sign in to kick.com → **Settings → Developer** → **Create App**.
2. **Redirect URL:** `BASE_URL/auth/kick/callback`
3. **Scopes:** `user:read` and `channel:read`.
4. Add `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET`.

### YouTube (Google)
1. Go to <https://console.cloud.google.com> → create a project → **APIs & Services → Library** → enable **YouTube Data API v3**.
2. **OAuth consent screen:** External, app name "MultiChat", your email. Add the scope `.../auth/youtube.readonly`.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   **Authorized redirect URI:** `BASE_URL/auth/google/callback`
4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

> **Important for YouTube:** while the Google app is in **Testing**, only Google accounts you add as *test users* (up to 100) can sign in. To let anyone sign in with YouTube, click **Publish app** and complete Google's verification. `youtube.readonly` is a "sensitive" scope, so Google asks for a homepage, a privacy policy page and a short video showing how the app uses it. This usually takes a few days to a few weeks. Twitch and Kick sign-in work for everyone right away. Until Google verification is done, people can still sign in with Twitch or Kick and type their YouTube handle into the YouTube box.

Railway redeploys automatically when you change variables.

## 4. Check it

Open your BASE_URL, sign in, connect your channels, then copy your overlay link into an OBS **Browser** source.

---

## Running it on your own computer (for testing)

```
npm run dev
```

Then open <http://localhost:8787>. On localhost a **"Continue as test user"** button is available, so you can try everything without setting up any providers. That button never appears on a real domain.

To test real sign-in locally, copy `.env.example` to `.env`. Set `BASE_URL=http://localhost:8787` and add your keys. Also add the `http://localhost:8787/auth/.../callback` URLs to each provider app.

## Good to know

- **Backups:** everything lives in `DATA_DIR`, in `multichat.db` plus the `uploads/` folder. Back up the volume.
- **YouTube chat** is read from YouTube's public live-chat page, so no API key or quota is needed. If YouTube ever blocks the server's address, YouTube chat pauses and retries. Twitch and Kick aren't affected.
- **Kick's chat connection key** is in `public/overlay.html` (`KICK_PUSHER_KEY`). If Kick chat stops connecting, see CLAUDE.md for how to find the new key.
- **Limits:** each streamer gets 100 MB of uploads (`UPLOAD_QUOTA_MB`). Up to 1000 YouTube channels can be watched at once (`MAX_YT_RELAYS`).
