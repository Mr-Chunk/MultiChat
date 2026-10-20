# MultiChat themes

A theme is **one CSS file** in the `themes/` folder. Drop a file in and it appears on the setup page right away. Edits to a theme also show up live in OBS. No code changes are needed, and a theme can't break chat because it only restyles the page.

- File name = theme id: `themes/my-theme.css` → id `my-theme` (letters, numbers, `-`, `_`).
- Files starting with `_` are hidden (see `themes/_template.css` to start from).
- Built-in examples: `default`, `cards`, `neon`, `retro-pixel`, `bubbly`, `minimal`, `terminal`, `glass`.

## Header

Start the file with a comment block. The setup page reads it:

```css
/*
  @name Neon Glow
  @description Glowing cyberpunk names on deep purple glass.
  @author Your name
  @swatch #0d0221 #00f0ff #ff2bd6 #f8f8ff
*/
```

`@swatch` is 2–5 hex colors shown on the theme's tile.

## How settings and themes combine

1. `overlay.html` base styles
2. your theme file (loaded after, so it can override the base)
3. **setup-page settings**, applied as inline `--mc-*` variables on `<html>`. These always win over the theme.

So **put your defaults in variables** (in `:root`) and **use `var(--mc-…)` in your rules**. That way a user who picks their own font, colors or background still gets them on your theme. Settings left blank ("Theme default") fall back to your values.

## Variables

| Variable | Used for |
|---|---|
| `--mc-font` | message font family |
| `--mc-name-font` | username font family |
| `--mc-size` | base text size (e.g. `18px`). Scale with `calc(var(--mc-size) * 1.2)` rather than replacing it |
| `--mc-line-height` | line height |
| `--mc-text` | message text color |
| `--mc-name-weight` | username weight (`700` / `400`) |
| `--mc-name-color` | fallback username color (when a user has no color, or "single color" mode) |
| `--user-color` | *(set per message)* the chatter's own name color |
| `--mc-outline` | text outline / shadow color |
| `--mc-highlight` | Super Chats, memberships, highlighted messages |
| `--mc-twitch` `--mc-kick` `--mc-youtube` | platform accent colors (also tint the platform icons) |
| `--mc-bubble` | message bubble background |
| `--mc-bubble-radius` | bubble corner radius |
| `--mc-gap` | space between bubbles |
| `--mc-chat-bg` | background color of the whole chat area |
| `--mc-chat-padding` | padding around the chat |
| `--mc-bg-image` `--mc-bg-size` `--mc-bg-repeat` `--mc-bg-position` `--mc-bg-opacity` `--mc-bg-blur` `--mc-bg-radius` | background image (set by the setup page; themes normally leave these alone) |

## Elements and classes

```html
<html class="mc theme-<id> align-left|right|center
             [boxed] [shadow] [animate] [hide-icons] [hide-badges] [bg-messages]
             [name-user|name-platform|name-custom]">
  <div id="bg"></div>                     <!-- background layer behind the chat (::before holds the image) -->
  <div id="chat">                         <!-- flex column, newest message at the bottom -->
    <div class="msg twitch|kick|youtube [superchat|member|highlight] [action] [sys]" data-platform="twitch">
      <span class="msg-bg"></span>        <!-- only when the background image is set "behind each message" -->
      <span class="meta">
        <span class="plat"><svg>…</svg></span>
        <span class="badges"><img class="badge">…</span>
        <span class="amount">$5.00</span>  <!-- Super Chats only -->
        <span class="name">Username</span>
        <span class="sep">:</span>
      </span>
      <span class="text">message text <img class="emote"> …</span>
    </div>
  </div>
</html>
```

Handy patterns:

- Name on its own line: `.meta { display: block } .sep { display: none }`
- Per-platform styling: `.msg.twitch { … }`, or use `var(--mc-twitch)`
- Bubbles that hug the text: `.msg { width: fit-content; max-width: 100% }`
- Entry animation: override `.animate .msg { animation: … }` (keep it under `.animate` so the toggle still works)
- Google Fonts: `@import url("https://fonts.googleapis.com/css2?family=Name&display=swap");` as the **first** line

## Rules (so the theme never breaks MultiChat)

- CSS only. Themes cannot add scripts.
- Don't hide `.msg`, `.text` or `.name`, and don't use `display: none` on `#chat`.
- Keep `.msg.fading` able to fade (don't force `opacity: 1 !important` on `.msg`).
- Don't use `!important` on colors or fonts, or user settings can't override them.
- `.msg-bg` and `#bg::before` belong to the background-image feature. Style `#bg` itself or `#bg::after` instead.
- Keep `.hide-icons .plat` and `.hide-badges .badges` working (don't force `display` on those).
