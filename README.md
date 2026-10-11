# LucidView Universal — Floating Video & Enhancer

Universal video enhancer for any HTML5 `<video>` page (YouTube, TikTok, Vimeo, X, Instagram, Twitch, and others).

Manifest V3 Chrome extension. Popup UI reports **v5.1**; `manifest.json` version is **5.0**.

## What it does

- **Universal target + multi-video picker:** auto-detects the main `<video>`, lists every video on the page with measured quality (`8K / 4K / 1440p / 1080p / 720p / 480p / …` or `Auto` when metadata is hidden), play state, and on-screen size. Sort by quality high→low / low→high, screen size, playing-first, or page order. Filter chips: All / 720p+ / 1080p+ / 4K+. `Alt + Q` jumps to the best-quality video. Manual picks are sticky until the element leaves the DOM. Toolbar badge shows `●` / quality label when a video is ready (`background.js`).
- **Float player:** detaches the target video into a draggable floating player with its own transport, A–B loop, 1/30s frame-step buttons, brightness/contrast/saturation sliders, Auto-Tone, and a Pop-to-PiP button.
- **Filtered PiP:** pushes the graded video into a real browser Picture-in-Picture window with adjustments baked in. Two-way play/pause sync; frame pumping via `requestVideoFrameCallback` with a timer fallback so background tabs don't freeze; page source is hidden while PiP is active to avoid double playback.
- **Color grading:** contrast, saturation, vibrance, brightness, hue-rotate. Presets: Cinematic (`✦ Lucid Mode`, contrast 1.28 / saturate 1.38 / vibrance 0.3 / brightness 1.09 / hue 4), Vivid, Warm, Noir, Auto Tone (64×36 frame-luminance analysis), Reset.
- **In-player OSD strip:** draggable overlay on the playing video with volume / brightness / contrast / saturation sliders, mute toggle, Auto-Tone (`⚡`), and reset (`↺`). Only visible while playing; re-anchored every frame; `Alt + C` or popup `OSD Strip` toggles it. (Native PiP windows are browser chrome — the strip lives on the page video and in the float player.)
- **Audio:** native volume 0–100%, Web Audio boost up to **400%** (gain stage), EQ presets Flat / Bass+ / Voice / Night (biquad bass + treble + dynamics compressor graph). `Alt + B` toggles 1×/2.5× quickly.
- **Transport:** play/pause, ±10s seek, speed slider 0.25–4× in 0.05 steps, chips 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2 / 3×, full-video Loop toggle.
- **A–B loop + frame-step:** set A / B points and loop just that segment; step one frame (`1/30s`) forward/back (pauses first). Lives in the float player.
- **Lucid / Ambient Glow + Focus:** `✦ Lucid Mode` cinematic grade + ambient glow canvas (uses `requestVideoFrameCallback`, pauses with the video). `◎ Focus Mode` dims the page around the target video.
- **Marks + frame gallery:** timestamp marks with optional label, stored per page URL in `chrome.storage.local` (`marks_<host><path>`), click-to-seek, delete, `Alt + M` instant mark. Session screenshot gallery (canvas capture with grade baked in, CORS-aware — tainted sources report `Blocked (CORS)` instead of false success), click-to-copy.
- **Playback resume:** last position saved per URL (`resume_<origin><path>`, debounced ~800ms) and restored when `< 95%` watched.
- **Sleep timer + Wake Lock:** auto-pause in 15 / 30 / 60 min (Off by default); Screen Wake Lock with re-acquire on tab visibility return.
- **Per-site prefs + export/import:** `Save Site Prefs` stores speed, volume, boost, loop, EQ, filters/Lucid state per host and re-applies on next visit. Export/import is a single JSON (`exportedAt`, `version`, `filters`, `marks`, `sitePrefs`, `pageMarks`).
- **Gestures:** double-click left 40% / right 40% of the video seeks ∓10s; mouse wheel over the video adjusts volume (bypasses the OSD strip target).
- **OS integration:** Media Session API handlers (play/pause/seek) for keyboard media keys and lock-screen transport; on-page HUD toasts for every action; session meta panel (status / quality `W×H` / video count / resume point).
- **Detached control window:** `↗ Float This Window` opens `popup.html?tabId=<id>` as a 388×680 popup bound to that tab, with 1.5s state / 4s video / 5s mark polling.

## Popup tabs

| Tab | Contents |
|---|---|
| Player | Lucid, PiP, Float, Focus, Screenshot, OSD Strip; transport (−10s / +10s / play-pause); volume + speed sliders + chips + Loop; shortcut cheatsheet |
| Marks | `+ Mark` + label field, mark list (time pill + label/note + delete), frame gallery |
| Videos | sort select, rescan `⟳`, quality filter chips, clickable video rows with `TARGET` tag |
| Color | 5 grading sliders + Cinematic / Vivid / Warm / Noir / Auto Tone / Reset |
| Audio | boost slider to 4.0× + Flat / Bass+ / Voice / Night |
| Session | sleep chips, Wake Lock, Save Site Prefs, Export/Import, Float This Window, target-video meta |

## Keyboard shortcuts

Shortcuts are ignored while typing in inputs/textareas/contentEditable.

| Action | Shortcut |
|---|---|
| Play / Pause | `Alt + Space` |
| Cinematic (Lucid) toggle | `Alt + F` |
| Float player | `Alt + G` |
| PiP | `Alt + P` |
| Focus mode | `Alt + H` |
| Save mark | `Alt + M` |
| Best-quality video | `Alt + Q` (works even before a main video is settled) |
| Seek ±10s | `Alt + → / ←` (also `Alt + D / A`) |
| Volume ±10% | `Ctrl + ↑ / ↓` |
| Speed ±0.25 | `Shift + > / <` (`.` / `,`) |
| Speed presets 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 3 / 4 / 8× | `Alt + 1 … 9` |
| Speed reset 1× | `Alt + 0` |
| Full-video loop | `Alt + L` (popup `Loop` chip = same) |
| Screenshot | `Alt + S` |
| OSD strip toggle | `Alt + C` |
| Volume-boost toggle 1×/2.5× | `Alt + B` |
| On-video: seek ∓10s | double-click left / right side |
| On-video: volume | mouse wheel |

## Files

- `manifest.json` — MV3, `activeTab` + `scripting` + `storage`, `<all_urls>` content script `content.js` (`document_idle`), service worker `background.js`, popup `popup.html`.
- `content.js` — all page logic (~2,800 lines, v5.0 header documents v4.0–v5.0 fixes).
- `popup.html` / `popup.js` — dark neumorphic control panel, 6 tabs, demo mode when opened outside the extension (shows banner + sample marks/videos).
- `background.js` — per-tab toolbar badge/title.
- `strip-preview.html` — standalone FAB/strip UX preview (open directly in a browser, no extension needed).
- `icon16/48/128.png` — toolbar icons.

## Privacy

All state stays in `chrome.storage.local` (`prefs_*`, `marks_*`, `resume_*`) plus popup `localStorage` for Videos-tab sort/filter. No analytics or remote endpoints observed in source. `<all_urls>` is used only to inject the content script into video pages.

## Limitations (verified in code)

- Content scripts cannot run on `chrome://`, `edge://`, or the Chrome Web Store — the popup does nothing there by design.
- Screenshots / Auto-Tone fail gracefully on cross-origin (tainted) canvas and DRM streams (`Blocked (CORS)` / `No frame yet`).
- Native PiP windows cannot host the custom OSD strip (browser chrome).
- Wake Lock requires a supporting Chromium build and a visible tab; intent is remembered and re-acquired on return.
- Resume only restores when saved time is `> 0` and `< 95%` of duration.

## Install

Full step-by-step: see [INSTALL.md](INSTALL.md).

Quick version: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder → pin LucidView → **refresh any open video tabs** once.

## Version notes (from `content.js` header)

- v4.0: fixed vibrance matrix, A–B/frame-step, float volume, wake-lock, drag/resize, restore-to-page, tainted-canvas.
- v4.1: PiP double-play fix, single-build audio graph, explicit Lucid flag; float-player Auto-Tone + Pop-to-PiP; glow via `requestVideoFrameCallback`.
- v4.2: two-way PiP play/pause sync, background-tab frame pump, on-video OSD strip.
- v4.3–v4.5: strip drag/visibility/anchoring fixes, saturation + volume rows, centred slider thumbs.
- v4.6: Videos tab with always-available quality sort + `Auto` rank + sticky picks + URL-inferred fallback.
- v5.0: marks, resume, focus, gestures, gallery, Media Session, badge, export/import, fine speed control.
