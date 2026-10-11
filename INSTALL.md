# INSTALL — LucidView Universal (Chrome / Chromium MV3)

## Requirements

- Google Chrome (primary target). Any Chromium MV3 browser (Edge, Brave, Opera) should load it the same way — paths differ only in step 1.
- No build step, no dependencies, no API keys. The extension is the files in this folder.

## Install (Load unpacked)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Enable **Developer mode** (toggle, top-right).
3. Click **Load unpacked**.
4. Select this repository folder — the folder containing `manifest.json`
   (e.g. `lucidview-extension/` or `lucidview_Popup_Video_Chrome_extension/`).
5. Confirm **LucidView Universal - Floating Video & Enhancer** appears with its `L` icon and no errors.
6. Click the puzzle-piece toolbar icon → pin **LucidView**.
7. **Refresh every already-open video tab once.** Content scripts only inject on (re)load; a stale tab will show `No video` until reloaded.

## Verify it works

1. Open any page with an `<video>` (e.g. a YouTube watch page, or a plain `.mp4` URL).
2. Click the LucidView toolbar icon. The status orb should read `Video · <quality>` (e.g. `Video · 1080p`) instead of `No video`.
3. Press `✦ Lucid Mode`, `◫ Float Player`, or `▣ PiP Mode` — the page should respond and show an on-page HUD toast.
4. Open the **Videos** tab → `⟳` rescan should list the page's videos with quality badges.
5. `chrome://extensions` → LucidView → **Inspect views: service worker** should be error-free; per-tab badge text comes from `background.js`.

## Optional previews (no install needed)

- `strip-preview.html`: double-click to open in a browser. Standalone mock of the floating action button + expandable slider stack (volume/brightness/contrast/saturation, Auto-Tone, reset). Drag the `✨` circle, click to expand/collapse.
- `popup.html`: double-click to open directly. Outside the extension it enters **demo mode** (`Demo preview` banner) with sample marks, gallery placeholders, and demo video rows — sliders and tabs render but cannot control a page.

## Detached control window

In the popup → **Session** → `↗ Float This Window` (or the `↗` header button) opens `popup.html?tabId=<id>` as a 388×680 popup bound to that tab. It polls state (~1.5s), videos (~4s), and marks (~5s). Close it and use the normal popup at any time.

## Permissions (why each is requested)

| Permission | Use |
|---|---|
| `activeTab` | Talk to the currently active video tab when the popup is opened |
| `scripting` | Message the injected `content.js` (`chrome.tabs.sendMessage`) |
| `storage` | `chrome.storage.local`: per-site prefs (`prefs_*`), marks (`marks_*`), resume points (`resume_*`), exported settings |
| `<all_urls>` (content scripts + host) | Detect and enhance `<video>` on any site (YouTube, TikTok, Vimeo, X, Instagram, Twitch, plain HTML5) |

## Troubleshooting

- **`No video` on a page that clearly has video:** reload the tab (see step 7). Single-page-app navigations are handled by a debounced DOM observer, but a cold install needs one reload.
- **Popup says nothing happens / console says refresh if unresponsive:** the content script isn't in that tab yet — reload it. Never works on `chrome://`, `edge://`, or the Chrome Web Store (browser forbids content scripts there).
- **Screenshot shows `Blocked (CORS)`:** the video source is cross-origin/tainted or DRM-protected; canvas capture is disallowed by the browser, not by LucidView. Same-origin MP4s capture with the grade baked in.
- **`Auto Tone` says `No frame yet`:** the video hasn't exposed a decodable frame (`readyState < 2`) — wait for it to start playing.
- **No sound after EQ/boost changes:** the Web Audio graph (`MediaElementSource → bass → treble → compressor → gain → destination`) attaches once per element; switching videos re-routes it. Reload the tab if a site replaced its player mid-session.
- **Screen keeps sleeping with Wake Lock on:** Wake Lock needs a supported Chromium + visible tab; the extension remembers intent and re-acquires on `visibilitychange`, but the browser can still release it — toggle it off/on in **Session**.
- **Resume didn't restore:** by design it only restores when `0 < saved < 95%` of duration and duration metadata is known.
- **Extension error after editing files:** `chrome://extensions` → LucidView → `⟳ Reload`, then reload video tabs.

## Update / uninstall

- **Update:** `git pull` (or re-download), then `chrome://extensions` → LucidView → `⟳ Reload`, then reload video tabs.
- **Uninstall:** `chrome://extensions` → LucidView → **Remove**. Per-site prefs, marks, and resume data remain in `chrome.storage.local` until the browser profile clears them; reinstalling restores them.

## Files you should see after checkout

`manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`, `strip-preview.html`, `icon16.png`, `icon48.png`, `icon128.png`, `README.md`, `INSTALL.md`, `.gitignore`.
