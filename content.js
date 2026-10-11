/* =========================================================
   LucidView Universal v5.0 — content.js
   Fixed + upgraded build.
   Fixes (v4.0): inverted vibrance matrix, dead A-B loop /
           frame-step buttons, dead float volume slider, wake-lock
           blocked without video, wake-lock re-acquire on tab
           return, drag/resize clobbering page handlers,
           restoreToPage style bug, tainted-canvas false success.
   Fixes (v4.1):
     - YouTube/Opera "two videos playing" PiP bug: the page <video>
       is now hidden (opacity 0, kept playing) whenever ANY PiP
       session starts, so only one video is visible. Restored on
       PiP exit. Works for both our filtered PiP and native browser
       PiP via enter/leavepictureinpicture hooks.
     - Audio graph only built once: now re-routes the
       MediaElementSource when the active <video> changes (SPA /
       multi-video sites).
     - Lucid/Cinematic detection replaced fragile float-equality
       checks on the `data-lucid` attribute with an explicit flag.
     - Removed dead styles.css (never loaded).
   New (v4.1):
     - In-player Brightness / Contrast sliders + ⚡ Auto-Tone
       (frame-luminance analysis) inside the floating player, plus
       a "Pop" button that pushes the filtered video into a real
       browser PiP with adjustments baked in.
     - Ambient Glow now uses requestVideoFrameCallback when
       available (pauses with the video, zero idle CPU).
     - Debounced DOM video observer.
   Fixes + New (v4.2):
     - PiP play/pause dead-end fixed: the PiP proxy and the page
       <video> are now two-way synchronized, so pausing inside the
       PiP window and pressing play again resumes playback without
       having to exit PiP and use the page controls. Entering PiP no
       longer force-plays a video the user had paused.
     - PiP picture no longer freezes when the tab is backgrounded:
       frames are pumped via requestVideoFrameCallback with a timer
       safety net (rAF is suspended in hidden tabs).
     - NEW in-player Brightness / Contrast strip drawn over the
       video itself (draggable, hover-revealed), plus an Alt+C
       toggle and a popup switch. Native PiP windows are browser
       chrome we cannot draw into, so this + the floating player's
       Picture row are where in-player colour grading lives.
   Fixes + New (v4.3):
     - Brightness/Contrast strip no longer sticks to the mouse cursor. Its
       drag ended on a document-level mouseup, but the strip's own
       stopPropagation() guard swallowed that mouseup whenever the release
       happened over the strip itself — which is almost always, since the
       strip follows the cursor while dragging — so the drag never ended and
       the strip chased the cursor forever. Drag now uses pointer capture on
       the strip plus a global safety net: a release ANYWHERE (even outside
       the strip, the page, or the window) always ends it.
     - The strip now belongs to playback: it only appears while the video is
       actually PLAYING. Pausing or ending hides it immediately, and hovering
       a paused/ended video never summons it.
     - While visible, the strip is re-anchored to the video's rect every
       animation frame, so it stays attached to the player through scrolling,
       resizing and layout shifts like a real player OSD (Opera-style),
       instead of drifting over the page on a debounced timer.
   Fixes + New (v4.4):
     - Colour Saturation added to the floating bar (the in-player strip) next
       to Brightness / Contrast, and mirrored in the floating player's Picture
       row. All three readouts stay in sync through syncPictureUI(), so the
       strip, the floating player, the popup and the ⚡ Auto-Tone pass all
       drive the same `saturate` value in currentFilters.
       Strip sliders were shortened (70px → 56px) so the three-control stack
       still fits inside a typical player.
   Fixes + New (v4.5):
     - Volume slider added to the in-player strip (top of the stack). It drives
       overlayVideo.volume directly and stays in sync with the floating player,
       the popup and the Ctrl+Arrow volume shortcuts through the video's own
       `volumechange` event. The speaker icon also toggles mute.
     - Slider thumbs are no longer off-centre. The range input is now exactly as
       wide as its thumb (14px) and the slim 4px rail is painted as a CENTRED
       line inside that box, so the dot always sits centred on the rail no
       matter how the browser writes/directs the vertical slider. (Before, the
       input was 4px wide with a 14px thumb, so the dot hung out to one side.)
     - Strip slimmed down: tighter padding and gaps, shorter sliders
       (56px → 44px), smaller icons, readouts and action buttons.
   Fixes + New (v4.6):
     - NEW "Videos" tab: every <video> on the page is listed with its detected
       quality (8K / 4K / 1440p / 1080p / 720p / 480p / …), play state and
       on-screen size. Clicking a row makes it the target for every LucidView
       control (colour, PiP, float, screenshot, shortcuts).
     - The Quality sorting option is ALWAYS available: it is never hidden,
       disabled or removed — not when only one video exists, not when nothing
       is playing, and not when a page hides metadata so no resolution can be
       measured. Such videos get the "Auto" label (rank 0) and are sorted to
       the end instead of breaking the sort.
     - A manual pick is sticky: resolveMainVideo() keeps the user's choice
       until that element leaves the DOM. Previously every popup message ran
       findMainVideo() and silently overrode the selection.
     - Resolution is measured from videoWidth/videoHeight and, when metadata
       is unavailable (blob:/MSE streams that never fired loadedmetadata),
       inferred from the source URL (…1080p…, _720., /1440/) as a fallback.
    New (v5.0):
      - Timestamp marks (bookmarks + optional note) stored per page URL.
      - Playback resume: last position saved per URL, restored when < 95% watched.
      - Focus / Cinema mode: dims the page around the target video.
      - Gestures: double-click seeks ±10s, mouse wheel changes volume.
      - Screenshot gallery (session) with data URLs returned to the popup.
      - Media Session API for OS media keys / lock-screen transport.
      - Toolbar badge when a video is active; settings export / import.
      - Fine speed control (0.05 steps) and seek_by / seek_to / set_loop commands.
   ========================================================= */

let mainVideo = null;
let audioCtx = null;
let gainNode = null;
let bassFilter = null;
let trebleFilter = null;
let compressor = null;
let mediaSource = null;
let floatingContainer = null;
let sitePrefs = {};
let currentFilters = { contrast: 1, saturate: 1, vibrance: 0, brightness: 1, hue: 0 };
let abLoop = { a: null, b: null, active: false };
let wakeLockSentinel = null;
let wakeLockWanted = false; // FIX: remember intent so we can re-acquire on visibilitychange
let currentHost = location.hostname;
let currentEQ = 'flat';
let sleepTimerId = null;
let sleepTimerEnd = null;
let ambientEnabled = true;
let ambientRafId = null;
let ambientCanvas = null;
let ambientCtx = null;
let ambientTainted = false;
let lucidActive = false;       // explicit Lucid/Cinematic flag (replaces fragile float comparison)
let pipHiddenState = null;     // saved styles while the source is hidden for PiP
let videoHooksAttached = null; // element that currently has our PiP enter/leave hooks
let pipSyncing = false;        // mutes play/pause sync while we programmatically align states

/* v5.0 feature state */
let marks = [];
let resumeKey = null;
let resumeSaveTimer = null;
let focusActive = false;
let focusOverlayEl = null;
let focusRaf = null;
let galleryItems = [];
let gallerySeq = 0;
let mediaSessionBound = null;

/* In-player overlay state (declared up front to avoid TDZ in applyFilters) */
let overlayEl = null;
let overlayVideo = null;
let overlayEnabled = true;
let overlayHideTimer = null;
let overlayTrackRaf = null;     // v4.3: rAF loop that keeps the strip anchored to the player
let overlayDragEnd = null;      // v4.3: cleanup for the active strip drag (pointer capture)
let overlayVideoCleanup = null; // v4.3: removes play-state listeners from the current video
let overlayGlobalsBound = false;
let overlayPos = { dx: 0, dy: 0, custom: false };
let ovBright = null, ovBrightVal = null, ovContrast = null, ovContrastVal = null;
let ovSaturate = null, ovSaturateVal = null;
let ovVolume = null, ovVolumeVal = null, ovVolIcon = null;  // v4.5: in-player volume
let overlayLastCheck = 0;
let floatSyncPicture = null;   // hook into the floating player's Picture sliders

/* ---------- Styles ---------- */
/* ---------- v5.1 neumorphic slider painting ----------
   Shared by the floating player and the in-player strip: the gradient capsule
   fill is a background sized by --p (fill fraction), and --tc colours the
   thumb so it reads as the rounded end-cap of the fill, sampled from the same
   teal→azure gradient the CSS paints. */
function lvPaintRange(r) {
  if (!r || r.type !== 'range') return;
  const min = parseFloat(r.min) || 0;
  const max = parseFloat(r.max);
  const p = max > min ? (parseFloat(r.value) - min) / (max - min) : 0;
  const t = Math.min(1, Math.max(0, p));
  r.style.setProperty('--p', String(t));
  const c1 = [61, 233, 198], c2 = [61, 155, 255]; // #3DE9C6 → #3D9BFF
  const c = c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  r.style.setProperty('--tc', `rgb(${c[0]},${c[1]},${c[2]})`);
}
// One capture-phase listener covers user input on every slider we inject;
// programmatic .value sets get explicit lvPaintRange calls at each sync point.
document.addEventListener('input', (e) => {
  if (e.target && e.target.type === 'range') lvPaintRange(e.target);
}, true);

const floatStyles = document.createElement('style');
floatStyles.textContent = `
  /* v5.1 — dark neumorphic tokens, scoped to our own UI so host pages are
     never affected (never put these on :root). */
  #lucid-float-container, #lucid-inplayer, #lucid-hud {
    --teal: #3de9c6;
    --blue: #3d9bff;
    --grad: linear-gradient(90deg, #3de9c6 0%, #3d9bff 100%);
    --ink: #062028;
    --face-hi: #24252b;
    --face-lo: #1c1d22;
    --groove: #0e0e11;
    --raise: 4px 4px 10px rgba(0,0,0,.5), -3px -3px 8px rgba(255,255,255,.04);
    --press: inset 3px 3px 7px rgba(0,0,0,.65), inset -2px -2px 5px rgba(255,255,255,.05);
    --groove-sh: inset 2px 2px 6px rgba(0,0,0,.65), inset -1px -1px 3px rgba(255,255,255,.05);
  }
  #lucid-float-container {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    background: #16171b;
    box-shadow: 12px 14px 36px rgba(0,0,0,.6), -6px -6px 18px rgba(255,255,255,.03), 0 0 0 1px rgba(255,255,255,.05);
    display: flex; flex-direction: column;
  }
  /* When the user has resized the window, the video fills all leftover space */
  #lucid-float-container.custom-size .lucid-video-wrapper {
    flex: 1 1 auto; min-height: 0; height: auto;
  }
  #lucid-float-container.custom-size video {
    width: 100% !important; height: 100% !important;
    max-height: none !important; object-fit: contain;
  }
  #lucid-ambient-glow {
    position: absolute; inset: -28px; z-index: -1; pointer-events: none;
    filter: blur(42px) saturate(1.6); opacity: 0.55; border-radius: 32px;
    transition: opacity 0.6s ease;
  }
  #lucid-float-container .lucid-float-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; background: linear-gradient(180deg, #1b1c21 0%, #17181d 100%);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset;
    cursor: move; user-select: none; backdrop-filter: blur(12px);
  }
  #lucid-float-container .header-left { display: flex; align-items: center; gap: 10px; }
  #lucid-float-container .title { font-weight: 600; font-size: 13.5px; letter-spacing: -0.2px; color: #f2f3f6; }
  #lucid-float-container .badge {
    font-size: 9px; padding: 2px 8px; background: linear-gradient(90deg, #3de9c6, #3d9bff); color: #062028;
    border-radius: 9999px; font-weight: 800; letter-spacing: 0.5px;
    box-shadow: 0 2px 8px rgba(61,155,255,.35);
  }
  #lucid-float-container .header-actions { display: flex; gap: 6px; }
  #lucid-float-container .h-btn {
    background: linear-gradient(145deg, var(--face-hi), var(--face-lo)); border: none; color: #c9cdd4;
    width: 30px; height: 30px; border-radius: 50%; font-size: 12px;
    cursor: pointer; transition: all .15s cubic-bezier(0.4,0,0.2,1);
    display: flex; align-items: center; justify-content: center;
    box-shadow: var(--raise); font-family: inherit; font-weight: 600;
  }
  #lucid-float-container .h-btn:hover { color: var(--teal); }
  #lucid-float-container .h-btn:active { box-shadow: var(--press); transform: scale(0.94); }
  #lucid-float-container .h-btn.close:hover { background: #ff4d5e; color: white; }
  #lucid-float-container .h-btn.on { color: var(--teal); text-shadow: 0 0 10px rgba(61,233,198,.5); }
  #lucid-float-container .lucid-video-wrapper {
    position: relative; background: #000; display: flex; align-items: center; justify-content: center;
    min-height: 180px; overflow: hidden;
  }
  #lucid-float-container video {
    width: 100% !important; height: auto !important; max-height: 70vh; display: block;
    border-radius: 0 !important; box-shadow: none !important; outline: none;
  }
  #lucid-float-container .lucid-controls {
    padding: 12px 16px 14px; background: linear-gradient(180deg, #1a1b20 0%, #16171b 100%);
    border-top: 1px solid rgba(255,255,255,0.05);
  }
  #lucid-float-container .controls-row {
    display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
  }
  #lucid-float-container .controls-row.secondary { margin-bottom: 0; justify-content: space-between; flex-wrap: wrap; }
  #lucid-float-container .ctrl-btn {
    background: linear-gradient(145deg, var(--face-hi), var(--face-lo)); border: none; color: #e8eaee;
    width: 34px; height: 34px; border-radius: 50%; font-size: 15px;
    cursor: pointer; transition: .15s; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    box-shadow: var(--raise); font-family: inherit;
  }
  #lucid-float-container .ctrl-btn:hover { color: #ffffff; }
  #lucid-float-container .ctrl-btn:active { box-shadow: var(--press); transform: scale(0.94); }
  #lucid-float-container .ctrl-btn.small { width: 28px; height: 28px; font-size: 13px; }
  /* ---- v5.1 sliders: inset groove + teal→azure capsule fill (fill fraction
     --p and thumb colour --tc are set by lvPaintRange) ---- */
  #lucid-float-container input[type=range] {
    -webkit-appearance: none; appearance: none;
    --tw: 12px;
    height: 12px; background: transparent; margin: 0; cursor: pointer;
    border-radius: 9999px;
  }
  #lucid-float-container input[type=range]::-webkit-slider-runnable-track {
    height: 12px; border: none; border-radius: 9999px;
    background: var(--groove) linear-gradient(90deg, var(--teal), var(--blue))
      left center / calc(6px + (100% - 12px) * var(--p, 0)) 100% no-repeat;
    box-shadow: var(--groove-sh);
  }
  #lucid-float-container input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 12px; height: 12px; border: none; border-radius: 50%;
    background: var(--tc, var(--blue)); margin-top: 0;
    box-shadow: 0 0 0 2px rgba(11,11,13,.55), 0 1px 5px rgba(0,0,0,.5), 0 0 10px rgba(61,155,255,.3);
    cursor: pointer;
  }
  #lucid-float-container input[type=range]::-moz-range-track {
    height: 12px; border: none; border-radius: 9999px;
    background: var(--groove) linear-gradient(90deg, var(--teal), var(--blue))
      left center / calc(6px + (100% - 12px) * var(--p, 0)) 100% no-repeat;
    box-shadow: var(--groove-sh);
  }
  #lucid-float-container input[type=range]::-moz-range-thumb {
    width: 12px; height: 12px; border: none; border-radius: 50%;
    background: var(--tc, var(--blue));
    box-shadow: 0 0 0 2px rgba(11,11,13,.55), 0 1px 5px rgba(0,0,0,.5), 0 0 10px rgba(61,155,255,.3);
    cursor: pointer;
  }
  #lucid-float-container .vol-slider {
    flex: 1; min-width: 60px;
  }
  #lucid-float-container .vol-slider.mini { flex: 0 0 72px; min-width: 72px; }
  #lucid-float-container .progress { flex: 1; min-width: 80px; }
  #lucid-float-container .pic-row input[type=range] { flex: 1; min-width: 70px; }
  #lucid-float-container .vol-txt {
    font-size: 10.5px; font-variant-numeric: tabular-nums; color: #9aa0a9;
    min-width: 38px; font-weight: 600;
  }
  #lucid-float-container .time {
    font-size: 10.5px; font-variant-numeric: tabular-nums; color: #9aa0a9;
    min-width: 92px; text-align: right; font-weight: 600;
  }
  #lucid-float-container .speed-group {
    display: flex; background: var(--groove); border-radius: 9999px; padding: 3px; gap: 3px;
    box-shadow: var(--groove-sh);
  }
  #lucid-float-container .speed-btn {
    background: transparent; border: none; color: #9aa0a9; font-size: 11px;
    padding: 3px 10px; border-radius: 9999px; cursor: pointer; font-weight: 650;
    transition: all .12s ease; font-family: inherit;
  }
  #lucid-float-container .speed-btn.active {
    background: linear-gradient(90deg, #3de9c6, #3d9bff); color: #062028; font-weight: 750;
    box-shadow: 0 2px 8px rgba(61,155,255,.35), inset 0 1px 0 rgba(255,255,255,.35);
  }
  #lucid-float-container .speed-btn:hover:not(.active) { color: #f2f3f6; }
  #lucid-float-container .ab-controls { display: flex; gap: 5px; align-items: center; font-size: 11px; }
  #lucid-float-container .ab-btn {
    background: linear-gradient(145deg, var(--face-hi), var(--face-lo)); border: none; color: #9aa0a9;
    padding: 3px 9px; border-radius: 9999px; font-size: 10px; cursor: pointer;
    box-shadow: var(--raise); font-family: inherit; font-weight: 650;
  }
  #lucid-float-container .ab-btn:active { box-shadow: var(--press); }
  #lucid-float-container .ab-btn.active {
    background: linear-gradient(90deg, #3de9c6, #3d9bff); color: #062028; font-weight: 750;
    box-shadow: 0 2px 8px rgba(61,155,255,.35);
  }
  #lucid-hud {
    position: fixed; top: 24px; left: 50%; transform: translateX(-50%) translateY(-8px);
    background: linear-gradient(145deg, rgba(36,37,43,.96), rgba(28,29,34,.96)); color: #f2f3f6;
    border: none;
    padding: 9px 18px; border-radius: 9999px; font: 600 13px/1.4 Inter, system-ui, sans-serif;
    z-index: 2147483647; pointer-events: none; opacity: 0; letter-spacing: 0.2px;
    backdrop-filter: blur(14px); box-shadow: 6px 8px 22px rgba(0,0,0,.5), -3px -3px 10px rgba(255,255,255,.04), 0 0 0 1px rgba(255,255,255,.06);
    transition: opacity .22s ease, transform .22s ease; display: flex; gap: 8px; align-items: center;
  }
  #lucid-hud.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
  #lucid-hud .hud-accent { color: var(--teal); }
  #lucid-float-container .pic-row {
    display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;
  }
  #lucid-float-container .section-title {
    font-size: 9.5px; font-weight: 750; color: #63686f;
    text-transform: uppercase; letter-spacing: 0.9px;
  }
  #lucid-float-container .pic-row .pic-label {
    font-size: 10px; color: #9aa0a9; min-width: 56px; font-weight: 650;
  }
  #lucid-float-container .pic-row .pic-val {
    font-size: 10px; color: #d8dbdf; min-width: 34px; text-align: right;
    font-variant-numeric: tabular-nums; font-weight: 600;
  }
  #lucid-float-container .pic-row .pic-auto {
    background: linear-gradient(145deg, var(--face-hi), var(--face-lo)); border: none; color: #e8eaee;
    font-size: 10px; padding: 4px 10px; border-radius: 9999px; cursor: pointer; font-weight: 650;
    box-shadow: var(--raise); font-family: inherit;
  }
  #lucid-float-container .pic-row .pic-auto:active { box-shadow: var(--press); }
  #lucid-float-container .pic-row .pic-auto:hover { color: var(--teal); }
  #lucid-float-container .pic-row .pic-pip {
    background: linear-gradient(145deg, var(--face-hi), var(--face-lo)); border: none; color: #e8eaee;
    font-size: 10px; padding: 4px 10px; border-radius: 9999px; cursor: pointer; font-weight: 650;
    box-shadow: var(--raise); font-family: inherit;
  }
  #lucid-float-container .pic-row .pic-pip:active { box-shadow: var(--press); }
  #lucid-float-container .pic-row .pic-pip:hover { color: var(--teal); }
  /* ---- In-player control strip (FAB: collapsed circle → expanded panel) ---- */
  #lucid-inplayer {
    position: fixed; z-index: 2147483647;
    display: flex; flex-direction: column; align-items: center; gap: 0;
    padding: 0; border-radius: 9999px;
    background: transparent;
    border: none;
    box-shadow: none;
    color: #f2f3f6; white-space: nowrap; cursor: move;
    user-select: none; -webkit-user-select: none; touch-action: none;
    font: 500 11px/1 Inter, system-ui, -apple-system, sans-serif;
    opacity: 0; pointer-events: none;
    transform: translate(-100%, -50%) scale(0.92);
    transition: opacity .18s ease, transform .22s cubic-bezier(.2,.8,.2,1);
  }
  #lucid-inplayer.visible {
    opacity: 1; pointer-events: auto;
    transform: translate(-100%, -50%) scale(1);
  }
  /* Collapsed launcher — small circle, always the first thing you see */
  #lucid-inplayer .lucid-ip-fab {
    width: 38px; height: 38px; border-radius: 50%; border: none; padding: 0;
    background: linear-gradient(145deg, var(--face-hi), var(--face-lo));
    color: var(--teal);
    font-size: 16px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow:
      0 0 0 1px rgba(255,255,255,.08),
      0 4px 14px rgba(0,0,0,.45),
      0 0 18px rgba(61,233,198,.22);
    transition: transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s, color .18s, background .18s;
    flex-shrink: 0; position: relative; z-index: 2;
    font-family: inherit;
    -webkit-backdrop-filter: blur(16px) saturate(1.4);
    backdrop-filter: blur(16px) saturate(1.4);
  }
  #lucid-inplayer .lucid-ip-fab:hover {
    color: #fff;
    transform: scale(1.06);
    box-shadow:
      0 0 0 1px rgba(255,255,255,.12),
      0 6px 18px rgba(0,0,0,.5),
      0 0 22px rgba(61,155,255,.35);
  }
  #lucid-inplayer .lucid-ip-fab:active {
    transform: scale(0.94);
    box-shadow: var(--press), 0 0 12px rgba(61,233,198,.25);
  }
  /* Expanded: FAB becomes the collapse control and lights up */
  #lucid-inplayer[data-expanded="true"] .lucid-ip-fab,
  #lucid-inplayer.is-expanded .lucid-ip-fab {
    background: linear-gradient(90deg, #3de9c6, #3d9bff);
    color: #062028;
    box-shadow:
      0 0 0 1px rgba(255,255,255,.25),
      0 6px 18px rgba(61,155,255,.4),
      inset 0 1px 0 rgba(255,255,255,.35);
    width: 32px; height: 32px; font-size: 13px;
  }
  /* Expandable panel — hidden until the circle is clicked */
  #lucid-inplayer .lucid-ip-panel {
    display: flex; flex-direction: column; align-items: center; gap: 5px;
    padding: 10px 8px 8px; border-radius: 18px;
    background: linear-gradient(145deg, rgba(36,37,43,.96), rgba(26,27,32,.96));
    box-shadow:
      6px 8px 20px rgba(0,0,0,.55),
      -3px -3px 12px rgba(255,255,255,.04),
      0 0 0 1px rgba(255,255,255,.06);
    -webkit-backdrop-filter: blur(16px) saturate(1.4);
    backdrop-filter: blur(16px) saturate(1.4);
    max-height: 0; opacity: 0; overflow: hidden;
    transform: translateY(-8px) scale(0.94);
    transform-origin: top center;
    pointer-events: none; padding-top: 0; padding-bottom: 0; margin-top: 0;
    transition:
      max-height .28s cubic-bezier(.2,.8,.2,1),
      opacity .2s ease,
      transform .24s cubic-bezier(.2,.8,.2,1),
      padding .22s ease,
      margin .22s ease;
  }
  #lucid-inplayer[data-expanded="true"] .lucid-ip-panel,
  #lucid-inplayer.is-expanded .lucid-ip-panel {
    max-height: 360px; opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
    padding-top: 10px; padding-bottom: 8px; margin-top: 8px;
  }
  #lucid-inplayer .lucid-ip-stack {
    display: flex; flex-direction: column; align-items: center; gap: 5px;
  }
  #lucid-inplayer .lucid-ip-group {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    cursor: default;
  }
  #lucid-inplayer .lucid-ip-group[hidden] { display: none; }
  /* v5.1 — four control buttons; the active one lights up and reveals the
     single shared slider for that control. */
  #lucid-inplayer .lucid-ip-btns {
    display: flex; flex-direction: column; align-items: center; gap: 5px;
  }
  #lucid-inplayer .lucid-ip-ctl {
    width: 28px; height: 28px; border-radius: 50%; border: none; padding: 0;
    background: linear-gradient(145deg, var(--face-hi), var(--face-lo));
    color: #c9cdd4; font-size: 13px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: var(--raise);
    transition: color .15s, box-shadow .15s, transform .15s;
    font-family: inherit;
  }
  #lucid-inplayer .lucid-ip-ctl:hover { color: #ffffff; }
  #lucid-inplayer .lucid-ip-ctl:active { box-shadow: var(--press); transform: scale(0.94); }
  #lucid-inplayer .lucid-ip-ctl.on {
    background: linear-gradient(90deg, #3de9c6, #3d9bff);
    color: #062028;
    box-shadow: 0 2px 10px rgba(61,155,255,.4), inset 0 1px 0 rgba(255,255,255,.35);
  }
  /* Slim vertical slider — inset groove with a teal→azure capsule fill growing
     from the bottom; --p / --tc come from lvPaintRange. Kept exactly as wide
     as the thumb so the cap never hangs off the rail (v4.5 fix, preserved). */
  #lucid-inplayer input[type=range] {
    -webkit-appearance: none; appearance: none;
    writing-mode: vertical-lr; direction: rtl;
    width: 14px; height: 84px; border-radius: 9999px;
    margin: 0; padding: 0; border: none;
    background: transparent; cursor: pointer;
  }
  #lucid-inplayer input[type=range]::-webkit-slider-runnable-track {
    width: 14px; height: 100%; border: none; border-radius: 9999px;
    background: var(--groove) linear-gradient(to top, var(--teal), var(--blue))
      left bottom / 100% calc(7px + (100% - 14px) * var(--p, 0)) no-repeat;
    box-shadow: var(--groove-sh);
  }
  #lucid-inplayer input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; border: none; border-radius: 50%;
    background: var(--tc, var(--blue));
    box-shadow: 0 0 0 2px rgba(11,11,13,.55), 0 1px 4px rgba(0,0,0,.5), 0 0 8px rgba(61,155,255,.3);
    cursor: pointer;
  }
  #lucid-inplayer input[type=range]::-moz-range-track {
    width: 14px; border: none; border-radius: 9999px;
    background: var(--groove) linear-gradient(to top, var(--teal), var(--blue))
      left bottom / 100% calc(7px + (100% - 14px) * var(--p, 0)) no-repeat;
    box-shadow: var(--groove-sh);
  }
  #lucid-inplayer input[type=range]::-moz-range-thumb {
    width: 14px; height: 14px; border: none; border-radius: 50%;
    background: var(--tc, var(--blue));
    box-shadow: 0 0 0 2px rgba(11,11,13,.55), 0 1px 4px rgba(0,0,0,.5), 0 0 8px rgba(61,155,255,.3);
    cursor: pointer;
  }
  #lucid-inplayer .lucid-ip-val {
    min-width: 28px; text-align: center; font-variant-numeric: tabular-nums;
    color: #c9cdd4; font-size: 10px; font-weight: 600; cursor: default;
  }
  #lucid-inplayer .lucid-ip-actions { display: flex; flex-direction: column; gap: 5px; align-items: center; }
  #lucid-inplayer .lucid-ip-btn {
    background: linear-gradient(145deg, var(--face-hi), var(--face-lo)); border: none; color: #c9cdd4;
    width: 24px; height: 24px; border-radius: 50%; font-size: 12px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: color .15s, box-shadow .15s, transform .15s;
    box-shadow: var(--raise); font-family: inherit;
  }
  #lucid-inplayer .lucid-ip-btn:hover { color: var(--teal); }
  #lucid-inplayer .lucid-ip-btn:active { box-shadow: var(--press); transform: scale(0.94); }
`;
(document.head || document.documentElement).appendChild(floatStyles);

/* v5.0: caption restyle for low-vision users (W3C MAUR CC-9–12 via ::cue) */
const captionStyles = document.createElement('style');
captionStyles.textContent = `
  video::cue {
    background: rgba(0, 0, 0, 0.72);
    color: #fff;
    font-size: 1.15em;
    line-height: 1.35;
    text-shadow: 0 1px 2px #000, 0 0 4px #000;
  }
`;
(document.head || document.documentElement).appendChild(captionStyles);

/* ---------- NEW: On-page HUD ---------- */
let hudEl = null;
let hudTimer = null;
function showHUD(text, accent = '') {
  if (!hudEl) {
    hudEl = document.createElement('div');
    hudEl.id = 'lucid-hud';
    (document.body || document.documentElement).appendChild(hudEl);
  }
  hudEl.innerHTML = accent
    ? `<span>${text}</span><span class="hud-accent">${accent}</span>`
    : `<span>${text}</span>`;
  hudEl.classList.add('visible');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hudEl.classList.remove('visible'), 1400);
}

/* ---------- Video discovery ---------- */
function findMainVideo() {
  const allVideos = Array.from(document.querySelectorAll('video'));
  if (allVideos.length === 0) return null;

  const playable = allVideos.filter(v =>
    (v.readyState >= 2 || v.duration > 0) &&
    v.offsetWidth > 60 && v.offsetHeight > 40
  );

  if (playable.length === 0) return allVideos[0];

  return playable.reduce((largest, current) => {
    let scoreL = (largest.offsetWidth || 0) * (largest.offsetHeight || 0);
    let scoreC = (current.offsetWidth || 0) * (current.offsetHeight || 0);
    if (!largest.paused) scoreL *= 1.3;
    if (!current.paused) scoreC *= 1.3;
    try {
      const rect = current.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0) scoreC *= 1.4;
    } catch (e) {}
      return scoreC > scoreL ? current : largest;
  });
}

/* ---------- Video discovery: quality + list (v4.6) ---------- */

// Stable per-element ids so the popup can point at a specific <video>.
const lucidVideoIds = new WeakMap();
let lucidIdSeq = 0;
function lucidVideoId(v) {
  if (!lucidVideoIds.has(v)) lucidVideoIds.set(v, 'v' + (++lucidIdSeq));
  return lucidVideoIds.get(v);
}

// Resolution ladder. `rank` is what sorting uses, so Quality sorting works
// even when the numeric height is odd (cropped rips, 1078p, …).
const QUALITY_LADDER = [
  { h: 4320, label: '8K',    rank: 9 },
  { h: 2160, label: '4K',    rank: 8 },
  { h: 1440, label: '1440p', rank: 7 },
  { h: 1080, label: '1080p', rank: 6 },
  { h: 720,  label: '720p',  rank: 5 },
  { h: 480,  label: '480p',  rank: 4 },
  { h: 360,  label: '360p',  rank: 3 },
  { h: 240,  label: '240p',  rank: 2 },
  { h: 144,  label: '144p',  rank: 1 }
];

function labelForHeight(h) {
  let best = null;
  for (const q of QUALITY_LADDER) {
    const d = Math.abs(q.h - h);
    if (!best || d < best.d) best = { d, q };
  }
  return best.q;
}

// Last-resort guess when metadata never arrived (blob:/MSE, lazy players).
function inferQualityFromSrc(v) {
  const src = (v.currentSrc || v.src || '') + ' ' + (v.getAttribute('src') || '');
  if (!src) return null;
  let m = src.match(/(\d{3,4})\s*[pP](?![a-zA-Z])/);
  if (!m) m = src.match(/[_\-./](4320|2160|1440|1080|720|480|360|240|144)[_\-./]/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (!h || h < 100 || h > 4320) return null;
  const q = labelForHeight(h);
  return { label: q.label, rank: q.rank, w: 0, h: h, known: false };
}

function detectQuality(v) {
  const w = v.videoWidth || 0;
  const h = v.videoHeight || 0;
  if (w && h) {
    const q = labelForHeight(h);
    return { label: q.label, rank: q.rank, w, h, known: true };
  }
  const guessed = inferQualityFromSrc(v);
  // rank 0 = "Auto": unknown, but still sortable — never dropped from the list.
  return guessed || { label: 'Auto', rank: 0, w: 0, h: 0, known: false };
}

function srcHint(v) {
  try {
    if (v.srcObject) return 'live stream';
    const src = v.currentSrc || v.src || '';
    if (!src) return 'no source';
    if (src.startsWith('blob:')) return 'media stream';
    if (src.startsWith('data:')) return 'inline data';
    const clean = src.split('?')[0];
    const file = clean.split('/').pop();
    return file && file.length > 1 ? decodeURIComponent(file).slice(0, 42) : clean.slice(0, 42);
  } catch (e) { return 'source'; }
}

function getVideoList() {
  return Array.from(document.querySelectorAll('video')).map(v => {
    const q = detectQuality(v);
    let onScreen = false;
    try {
      const r = v.getBoundingClientRect();
      onScreen = r.width > 0 && r.height > 0 &&
        r.bottom > 0 && r.top < window.innerHeight &&
        r.right > 0 && r.left < window.innerWidth;
    } catch (e) {}
    return {
      id: lucidVideoId(v),
      label: q.label, rank: q.rank, w: q.w, h: q.h, known: q.known,
      playing: !v.paused && !v.ended,
      muted: !!v.muted,
      area: (v.offsetWidth || 0) * (v.offsetHeight || 0),
      onScreen,
      duration: isFinite(v.duration) ? v.duration : 0,
      hint: srcHint(v),
      isMain: v === mainVideo
    };
  });
}

// A video the user picked by hand outranks the auto-detected one, and stays
// picked until the element is removed from the page.
let userPickedVideo = null;
function resolveMainVideo() {
  if (userPickedVideo && userPickedVideo.isConnected) return userPickedVideo;
  userPickedVideo = null;
  return findMainVideo();
}

function isDefaultFilters(f = currentFilters) {
  return f.contrast === 1 && f.saturate === 1 && f.vibrance === 0 &&
         f.brightness === 1 && f.hue === 0;
}

// Move every LucidView effect from `from` onto `to`.
function retargetVideo(to) {
  const from = mainVideo;
  if (from && from !== to && !isDefaultFilters()) {
    try { from.style.removeProperty('filter'); } catch (e) {}
  }
  userPickedVideo = to;
  mainVideo = to;
  videoHooksAttached = null;       // force fresh hooks on the new element
  attachVideoHooks(to);
  if (lucidActive) applyCinematicPreset(to);
  else if (!isDefaultFilters()) applyFilters(to, currentFilters);
  if (Object.keys(sitePrefs).length > 0) setTimeout(() => applySitePrefs(to), 120);
}

function selectVideoById(id) {
  const target = Array.from(document.querySelectorAll('video'))
    .find(v => lucidVideoId(v) === id);
  if (!target) return { ok: false, reason: 'That video is no longer on the page.' };
  retargetVideo(target);
  const q = detectQuality(target);
  showHUD('Video selected', q.w ? `${q.label} · ${q.w}×${q.h}` : q.label);
  return { ok: true, id, quality: q };
}

/* ---------- Audio graph (boost + NEW EQ / compressor) ---------- */
function setupAudio(video) {
  try {
    // Already wired to this exact element — nothing to do.
    if (audioCtx && mediaSource && mediaSource.mediaElement === video && gainNode) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // A graph exists but for a DIFFERENT element (SPA nav / multi-video site).
    // createMediaElementSource can only be called once per element, so tear
    // the old source down and rebuild the chain for the new video.
    if (mediaSource && mediaSource.mediaElement !== video) {
      try { mediaSource.disconnect(); } catch (e) {}
      mediaSource = null;
    }

    if (!mediaSource) {
      mediaSource = audioCtx.createMediaElementSource(video);

      bassFilter = audioCtx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 180;
      bassFilter.gain.value = 0;

      // Mid presence band (speech ~1–3 kHz) — powers the Voice preset (F5/MAUR).
      trebleFilter = audioCtx.createBiquadFilter();
      trebleFilter.type = 'peaking';
      trebleFilter.frequency.value = 2400;
      trebleFilter.Q.value = 0.9;
      trebleFilter.gain.value = 0;

      compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = 0; // transparent by default
      compressor.ratio.value = 1;

      gainNode = audioCtx.createGain();

      mediaSource.connect(bassFilter);
      bassFilter.connect(trebleFilter);
      trebleFilter.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(audioCtx.destination);
    }

    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {
    console.warn('[LucidView] AudioContext unavailable for this element:', e && e.message);
  }
}

function applyEQPreset(name, video) {
  if (!audioCtx) setupAudio(video || mainVideo);
  if (!bassFilter) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  currentEQ = name;
  const presets = {
    flat:   { bass: 0,  mid: 0,  thr: 0,   ratio: 1  },
    bass:   { bass: 8,  mid: 0,  thr: 0,   ratio: 1  },
    voice:  { bass: -3, mid: 6,  thr: -28, ratio: 3.5 },
    night:  { bass: -2, mid: 2,  thr: -42, ratio: 10 }
  };
  const p = presets[name] || presets.flat;
  bassFilter.gain.value = p.bass;
  // peaking mid band (was highshelf treble) for dialogue presence
  if (trebleFilter.type !== 'peaking') {
    trebleFilter.type = 'peaking';
    trebleFilter.frequency.value = 2400;
    trebleFilter.Q.value = 0.9;
  }
  trebleFilter.gain.value = p.mid != null ? p.mid : (p.treble || 0);
  compressor.threshold.value = p.thr;
  compressor.ratio.value = p.ratio;
  showHUD('Audio EQ', name.charAt(0).toUpperCase() + name.slice(1));
}

/* ---------- Utils ---------- */
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ---------- Vibrance SVG engine (FIXED math) ---------- */
function injectSVGFilter() {
  if (document.getElementById('lucid-svg-defs')) return;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('id', 'lucid-svg-defs');
  svg.setAttribute('style', 'display:none; width:0; height:0; position:absolute;');
  svg.innerHTML = `
    <defs>
      <filter id="lucid-vibrance" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" id="vibrance-matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
      </filter>
    </defs>
  `;
  (document.body || document.documentElement).appendChild(svg);
}

function updateVibranceMatrix(vibranceValue) {
  const matrix = document.getElementById('vibrance-matrix');
  if (!matrix) return;

  const v = parseFloat(vibranceValue || 0);
  // FIX: previous build computed (1-a)*I + a*Luminance which DESATURATES
  // for positive values. Correct saturation matrix: s > 1 boosts color.
  const s = 1 + v * 1.5;
  const rL = 0.2126, gL = 0.7152, bL = 0.0722;

  const r1 = (1 - s) * rL + s, g1 = (1 - s) * gL,     b1 = (1 - s) * bL;
  const r2 = (1 - s) * rL,     g2 = (1 - s) * gL + s, b2 = (1 - s) * bL;
  const r3 = (1 - s) * rL,     g3 = (1 - s) * gL,     b3 = (1 - s) * bL + s;

  matrix.setAttribute('values', `${r1} ${g1} ${b1} 0 0  ${r2} ${g2} ${b2} 0 0  ${r3} ${g3} ${b3} 0 0  0 0 0 1 0`);
}

function getFilterString(filters) {
  let str = `contrast(${filters.contrast}) saturate(${filters.saturate}) brightness(${filters.brightness}) hue-rotate(${filters.hue}deg)`;
  if (filters.vibrance !== 0) str += ` url(#lucid-vibrance)`;
  return str;
}

function applyFilters(video, filters = currentFilters) {
  if (!video) return;
  currentFilters = { ...currentFilters, ...filters };
  injectSVGFilter();
  updateVibranceMatrix(currentFilters.vibrance);
  video.style.setProperty('filter', getFilterString(currentFilters), 'important');
  // Any non-default filter set means we are no longer in the pure Lucid preset.
  lucidActive = false;
  video.removeAttribute('data-lucid');
  syncPictureUI();
}

function resetFilters(video) {
  if (!video) return;
  currentFilters = { contrast: 1, saturate: 1, vibrance: 0, brightness: 1, hue: 0 };
  video.style.filter = '';
  lucidActive = false;
  video.removeAttribute('data-lucid');
  syncPictureUI();
}

function applyCinematicPreset(video) {
  if (!video) return;
  applyFilters(video, { contrast: 1.28, saturate: 1.38, vibrance: 0.3, brightness: 1.09, hue: 4 });
  lucidActive = true;
  video.setAttribute('data-lucid', 'true');
}

/* ---------- NEW: Auto Tone (frame-analysis color balance) ---------- */
// Samples the current frame, measures mean luminance, and auto-sets brightness
// + contrast to pull the picture toward a balanced mid-tone. Works on
// same-origin video; reports gracefully on cross-origin (tainted) sources.
function autoTone(video) {
  if (!video || video.readyState < 2) { showHUD('Auto Tone', 'No frame yet'); return; }
  try {
    const c = document.createElement('canvas');
    const w = 64, h = 36;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b; // perceived luminance
    }
    const avg = sum / (data.length / 4); // 0..1
    let brightness = avg > 0.001 ? 0.5 / avg : 1;
    brightness = Math.max(0.6, Math.min(1.4, brightness));
    let contrast = avg < 0.5 ? 1.15 : 1.1;
    contrast = Math.max(0.9, Math.min(1.4, contrast));
    applyFilters(video, { brightness, contrast });
    showHUD('Auto Tone', `B ${brightness.toFixed(2)} · C ${contrast.toFixed(2)}`);
  } catch (e) {
    showHUD('Auto Tone blocked', 'Cross-origin');
  }
}

/* ---------- v5.0: Marks (timestamp bookmarks + notes) ---------- */
function marksKey() {
  return `marks_${currentHost}${location.pathname}`;
}

async function loadMarks() {
  try {
    const key = marksKey();
    const result = await chrome.storage.local.get(key);
    marks = Array.isArray(result[key]) ? result[key] : [];
  } catch (e) {
    marks = [];
  }
}

async function persistMarks() {
  try {
    await chrome.storage.local.set({ [marksKey()]: marks });
    return true;
  } catch (e) {
    return false;
  }
}

function addMark(label = '', note = '') {
  const video = resolveMainVideo() || mainVideo;
  if (!video) return { ok: false, reason: 'No video' };
  const mark = {
    id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    time: video.currentTime || 0,
    label: String(label || '').slice(0, 80) || `Mark ${marks.length + 1}`,
    note: String(note || '').slice(0, 240),
    createdAt: Date.now()
  };
  marks.push(mark);
  marks.sort((a, b) => a.time - b.time);
  persistMarks();
  showHUD('Mark saved', formatTime(mark.time));
  return { ok: true, time: mark.time, mark };
}

function deleteMark(id) {
  const before = marks.length;
  marks = marks.filter(m => m.id !== id);
  if (marks.length !== before) persistMarks();
  return { ok: marks.length !== before, marks };
}

function seekTo(t) {
  const video = resolveMainVideo() || mainVideo;
  if (!video || !isFinite(t)) return { ok: false };
  video.currentTime = Math.max(0, Math.min(video.duration || t, t));
  showHUD('Seek', formatTime(video.currentTime));
  return { ok: true, time: video.currentTime };
}

function seekBy(delta) {
  const video = resolveMainVideo() || mainVideo;
  if (!video) return { ok: false };
  const next = (video.currentTime || 0) + Number(delta);
  video.currentTime = Math.max(0, Math.min(video.duration || next, next));
  showHUD('Skip', (delta > 0 ? '+' : '') + delta + 's');
  return { ok: true, time: video.currentTime };
}

/* ---------- v5.0: Resume position ---------- */
function resumeKeyFor() {
  try {
    return `resume_${location.origin}${location.pathname}`;
  } catch (e) {
    return `resume_${currentHost}${location.pathname}`;
  }
}

async function loadResumeForVideo(video) {
  if (!video) return 0;
  try {
    const key = resumeKeyFor();
    resumeKey = key;
    const result = await chrome.storage.local.get(key);
    const saved = result[key];
    if (!saved || typeof saved.time !== 'number') return 0;
    if (!isFinite(video.duration) || video.duration <= 0) return 0;
    if (saved.time > 0 && saved.time < video.duration * 0.95 && video.currentTime < 2) {
      video.currentTime = saved.time;
      showHUD('Resumed', formatTime(saved.time));
      return saved.time;
    }
  } catch (e) {}
  return 0;
}

function scheduleResumeSave() {
  if (!resumeKey || !mainVideo) return;
  clearTimeout(resumeSaveTimer);
  resumeSaveTimer = setTimeout(() => {
    try {
      if (!mainVideo || !isFinite(mainVideo.duration) || mainVideo.duration <= 0) return;
      chrome.storage.local.set({
        [resumeKey]: { time: mainVideo.currentTime, duration: mainVideo.duration, updatedAt: Date.now() }
      });
    } catch (e) {}
  }, 800);
}

/* ---------- v5.0: Focus / Cinema mode ---------- */
function ensureFocusOverlay() {
  if (focusOverlayEl && focusOverlayEl.isConnected) return focusOverlayEl;
  focusOverlayEl = document.createElement('div');
  focusOverlayEl.id = 'lucid-focus-overlay';
  focusOverlayEl.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;transition:background 0.35s ease;display:none;';
  (document.body || document.documentElement).appendChild(focusOverlayEl);
  return focusOverlayEl;
}

function layoutFocusOverlay() {
  if (!focusActive || !focusOverlayEl || !mainVideo) return;
  if (floatingContainer || pipHiddenState) return;
  let r;
  try { r = mainVideo.getBoundingClientRect(); } catch (e) { return; }
  if (!r || r.width < 80) return;
  const top = Math.max(0, r.top);
  const left = Math.max(0, r.left);
  const right = Math.max(0, window.innerWidth - r.right);
  const bottom = Math.max(0, window.innerHeight - r.bottom);
  focusOverlayEl.style.display = 'block';
  focusOverlayEl.style.background = `linear-gradient(to bottom, rgba(0,0,0,0.72) 0, rgba(0,0,0,0.72) ${top}px, transparent ${top}px), linear-gradient(to top, rgba(0,0,0,0.72) 0, rgba(0,0,0,0.72) ${bottom}px, transparent ${bottom}px), linear-gradient(to right, rgba(0,0,0,0.72) 0, rgba(0,0,0,0.72) ${left}px, transparent ${left}px), linear-gradient(to left, rgba(0,0,0,0.72) 0, rgba(0,0,0,0.72) ${right}px, transparent ${right}px)`;
}

function startFocusTracking() {
  if (focusRaf !== null) return;
  const loop = () => {
    if (!focusActive) { focusRaf = null; return; }
    layoutFocusOverlay();
    focusRaf = requestAnimationFrame(loop);
  };
  focusRaf = requestAnimationFrame(loop);
}

function stopFocusTracking() {
  if (focusRaf !== null) { cancelAnimationFrame(focusRaf); focusRaf = null; }
}

function setFocusMode(on) {
  focusActive = !!on;
  const el = ensureFocusOverlay();
  if (!focusActive) {
    el.style.display = 'none';
    stopFocusTracking();
    showHUD('Focus mode', 'Off');
    return;
  }
  layoutFocusOverlay();
  startFocusTracking();
  showHUD('Focus mode', 'On');
}

/* ---------- v5.0: Gallery ---------- */
function addGalleryItem(dataUrl, time) {
  const item = { id: 'g' + (++gallerySeq), dataUrl, time: time || 0 };
  galleryItems.push(item);
  if (galleryItems.length > 12) galleryItems = galleryItems.slice(-12);
  return item;
}

function getGallery() {
  return galleryItems.slice();
}

function copyGalleryFrame(id) {
  const item = galleryItems.find(g => g.id === id);
  if (!item) return { ok: false };
  try {
    const byteString = atob(item.dataUrl.split(',')[1]);
    const mime = item.dataUrl.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: mime });
    navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]).catch(() => {});
    showHUD('Frame', 'Copied');
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

/* ---------- v5.0: Gestures (double-click seek, wheel volume) ---------- */
function attachGestures(video) {
  if (!video || video.dataset.lucidGestures === '1') return;
  video.dataset.lucidGestures = '1';
  video.addEventListener('dblclick', (e) => {
    const rect = video.getBoundingClientRect();
    const onLeft = e.clientX < rect.left + rect.width * 0.4;
    const onRight = e.clientX > rect.left + rect.width * 0.6;
    if (onLeft) seekBy(-10);
    else if (onRight) seekBy(10);
  });
  video.addEventListener('wheel', (e) => {
    if (overlayEl && (overlayEl === e.target || overlayEl.contains(e.target))) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 0.05 : -0.05;
    video.volume = Math.max(0, Math.min(1, video.volume + dir));
    if (video.volume > 0) video.muted = false;
    updateOverlayVolume();
    showHUD('Volume', Math.round(video.volume * 100) + '%');
  }, { passive: false });
}

/* ---------- v5.0: Media Session (OS media keys) ---------- */
function bindMediaSession(video) {
  if (!video || mediaSessionBound === video) return;
  if (!('mediaSession' in navigator)) return;
  mediaSessionBound = video;
  try {
    navigator.mediaSession.setActionHandler('play', () => video.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => video.pause());
    navigator.mediaSession.setActionHandler('seekbackward', (d) => seekBy(-(d.seekOffset || 10)));
    navigator.mediaSession.setActionHandler('seekforward', (d) => seekBy(d.seekOffset || 10));
    navigator.mediaSession.setActionHandler('seekto', (d) => { if (d.seekTime != null) seekTo(d.seekTime); });
    const updateMeta = () => {
      try {
        const q = detectQuality(video);
        navigator.mediaSession.metadata = new MediaMetadata({
          title: (document.title || 'LucidView').slice(0, 80),
          artist: currentHost,
          album: q.label ? `LucidView · ${q.label}` : 'LucidView'
        });
      } catch (e) {}
    };
    updateMeta();
    video.addEventListener('loadedmetadata', updateMeta);
  } catch (e) {}
}

/* ---------- v5.0: Toolbar badge ---------- */
function updateActionBadge(hasVideo) {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({
      type: 'lucid-badge',
      hasVideo: !!hasVideo,
      quality: hasVideo && mainVideo ? detectQuality(mainVideo).label : ''
    }, () => { void chrome.runtime.lastError; });
  } catch (e) {}
}

/* ---------- v5.0: Settings export / import ---------- */
async function exportSettings() {
  try {
    const all = await chrome.storage.local.get(null);
    const sitePrefsOut = {};
    const marksOut = {};
    for (const [k, v] of Object.entries(all || {})) {
      if (k.startsWith('prefs_')) sitePrefsOut[k] = v;
      if (k.startsWith('marks_')) marksOut[k] = v;
    }
    return {
      exportedAt: new Date().toISOString(),
      version: '5.0',
      filters: { ...currentFilters },
      marks: marksOut,
      sitePrefs: sitePrefsOut,
      pageMarks: marks.slice()
    };
  } catch (e) {
    return { exportedAt: new Date().toISOString(), version: '5.0', error: true };
  }
}

async function importSettings(settings) {
  if (!settings || typeof settings !== 'object') return { ok: false };
  try {
    const payload = {};
    if (settings.marks && typeof settings.marks === 'object') Object.assign(payload, settings.marks);
    if (settings.sitePrefs && typeof settings.sitePrefs === 'object') Object.assign(payload, settings.sitePrefs);
    if (Array.isArray(settings.pageMarks)) {
      payload[marksKey()] = settings.pageMarks;
      marks = settings.pageMarks;
    }
    if (settings.filters) {
      currentFilters = { ...currentFilters, ...settings.filters };
      if (mainVideo) applyFilters(mainVideo, currentFilters);
    }
    if (Object.keys(payload).length) await chrome.storage.local.set(payload);
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

/* ---------- Site prefs ---------- */
async function loadSitePrefs() {
  try {
    const key = `prefs_${currentHost}`;
    const result = await chrome.storage.local.get(key);
    sitePrefs = result[key] || {};
  } catch (e) {
    sitePrefs = {};
  }
}

async function saveSitePrefs() {
  if (!mainVideo) return false;
  const prefs = {
    speed: mainVideo.playbackRate,
    volume: mainVideo.volume,
    boost: gainNode ? gainNode.gain.value : 1,
    loop: mainVideo.loop,
    lucid: lucidActive,
    eq: currentEQ,
    filters: { ...currentFilters },
    timestamp: Date.now()
  };
  try {
    await chrome.storage.local.set({ [`prefs_${currentHost}`]: prefs });
    sitePrefs = prefs;
    showHUD('Preferences saved for', currentHost);
    return true;
  } catch (e) {
    return false;
  }
}

function applySitePrefs(video) {
  if (!video || !sitePrefs || Object.keys(sitePrefs).length === 0) return;
  try {
    if (sitePrefs.speed) video.playbackRate = sitePrefs.speed;
    if (sitePrefs.volume !== undefined) video.volume = sitePrefs.volume;
    if (sitePrefs.boost && gainNode) gainNode.gain.value = sitePrefs.boost;
    if (sitePrefs.loop) video.loop = sitePrefs.loop;
    if (sitePrefs.eq && sitePrefs.eq !== 'flat') applyEQPreset(sitePrefs.eq, video);
    if (sitePrefs.filters) applyFilters(video, sitePrefs.filters);
    else if (sitePrefs.lucid) applyCinematicPreset(video);
  } catch (e) {}
}

/* ---------- Wake lock (FIXED: re-acquire on tab return) ---------- */
async function toggleWakeLock(enable) {
  wakeLockWanted = enable;
  if (!('wakeLock' in navigator)) return;
  try {
    if (enable && !wakeLockSentinel) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    } else if (!enable && wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch (err) {}
}

document.addEventListener('visibilitychange', () => {
  // FIX: browsers auto-release wake locks when tab is hidden; re-acquire.
  if (document.visibilityState === 'visible' && wakeLockWanted && !wakeLockSentinel) {
    toggleWakeLock(true);
  }
});

/* ---------- NEW: Sleep timer ---------- */
function setSleepTimer(minutes) {
  clearTimeout(sleepTimerId);
  sleepTimerId = null;
  sleepTimerEnd = null;
  if (!minutes || minutes <= 0) {
    showHUD('Sleep timer', 'Off');
    return;
  }
  sleepTimerEnd = Date.now() + minutes * 60 * 1000;
  sleepTimerId = setTimeout(() => {
    const v = findMainVideo() || mainVideo;
    if (v && !v.paused) v.pause();
    sleepTimerEnd = null;
    showHUD('Sleep timer', 'Video paused');
  }, minutes * 60 * 1000);
  showHUD('Sleep timer set', `${minutes} min`);
}

/* ---------- PiP source hiding (fixes "two videos playing") ---------- */
// When ANY picture-in-picture session starts (native browser PiP or our own
// canvas-proxy PiP), the original page <video> would otherwise keep rendering
// on the page — so the user sees the native player AND the PiP window at once.
// We hide the source visually (opacity 0) but keep it PLAYING so its audio
// keeps going and, for our filtered PiP, the canvas keeps receiving frames.
function hideSourceForPiP(video) {
  if (!video || pipHiddenState) return;
  pipHiddenState = {
    video,
    opacity: video.style.opacity,
    pointerEvents: video.style.pointerEvents
  };
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  // NOTE (v4.2): we deliberately do NOT force-play here. Forcing playback made
  // the page player and the PiP window disagree about the play state — the root
  // cause of "paused in PiP, can only resume from the page". The two elements
  // are now kept in sync instead (see attachPipSync).
}

function restoreSourceFromPiP() {
  if (!pipHiddenState) return;
  const { video, opacity, pointerEvents } = pipHiddenState;
  video.style.opacity = opacity;
  video.style.pointerEvents = pointerEvents;
  pipHiddenState = null;
}

// Attach enter/leave PiP hooks so native browser PiP (e.g. YouTube's own
// picture-in-picture, or Opera's PiP popup) also hides the page video.
function attachVideoHooks(video) {
  if (!video || videoHooksAttached === video) return;
  videoHooksAttached = video;
  video.addEventListener('enterpictureinpicture', () => hideSourceForPiP(video));
  video.addEventListener('leavepictureinpicture', () => restoreSourceFromPiP());
  attachOverlay(video);
  attachGestures(video);
  bindMediaSession(video);
  updateActionBadge(true);
  video.addEventListener('timeupdate', scheduleResumeSave, { passive: true });
  if (isFinite(video.duration) && video.duration > 0) loadResumeForVideo(video);
  else video.addEventListener('loadedmetadata', () => loadResumeForVideo(video), { once: true });
}

/* ---------- Filtered PiP (two-way synchronized) ---------- */
let pipProxyVideo = null;
let pipCanvas = null;
let pipCtx = null;
let pipSource = null;
let pipSessionActive = false;
let pipEntering = false;   // a requestPictureInPicture() call is in flight
let pipPumpSource = null;  // element the current frame callback is registered on
let pipRvfcId = null;
let pipRafId = null;
let pipSafetyTimer = null;
let pipLastDraw = 0;
let pipSyncCleanup = null;

// Paint one filtered frame of the source into the canvas. This canvas is the
// capture source for the PiP proxy video.
function drawPipFrame() {
  const src = pipSource;
  if (!src || !pipCanvas || !pipCtx) return;
  if (src.readyState < 2) return;
  // Upscale low-res sources so the PiP window is not capped at a tiny size, and
  // only touch canvas dims when they actually change.
  const vw = src.videoWidth || 1280;
  const vh = src.videoHeight || 720;
  const scale = Math.max(1, 1920 / vw);
  const cw = Math.round(vw * scale);
  const ch = Math.round(vh * scale);
  if (pipCanvas.width !== cw || pipCanvas.height !== ch) {
    pipCanvas.width = cw;
    pipCanvas.height = ch;
  }
  pipCtx.filter = `contrast(${currentFilters.contrast}) saturate(${currentFilters.saturate}) brightness(${currentFilters.brightness}) hue-rotate(${currentFilters.hue}deg)`;
  try { pipCtx.drawImage(src, 0, 0, cw, ch); } catch (e) {}
  pipLastDraw = performance.now();
}

function stopPipFramePump() {
  if (pipRafId) { cancelAnimationFrame(pipRafId); pipRafId = null; }
  if (pipSafetyTimer) { clearInterval(pipSafetyTimer); pipSafetyTimer = null; }
  // Cancel against the element the callback was actually registered on, not
  // whatever pipSource happens to point at now — otherwise the old callback
  // leaks on the previous video.
  const src = pipPumpSource;
  if (pipRvfcId !== null && src && typeof src.cancelVideoFrameCallback === 'function') {
    try { src.cancelVideoFrameCallback(pipRvfcId); } catch (e) {}
  }
  pipRvfcId = null;
  pipPumpSource = null;
}

function startPipFramePump() {
  stopPipFramePump();
  const src = pipSource;
  if (!src) return;
  pipPumpSource = src;

  if (typeof src.requestVideoFrameCallback === 'function') {
    // Frame-accurate, and free while paused (no callback = no work).
    const onFrame = () => {
      if (!pipSessionActive || pipSource !== src) return;
      drawPipFrame();
      pipRvfcId = src.requestVideoFrameCallback(onFrame);
    };
    pipRvfcId = src.requestVideoFrameCallback(onFrame);
  } else {
    const loop = () => {
      if (!pipSessionActive || pipSource !== src) return;
      if (!src.paused && !src.ended) drawPipFrame();
      pipRafId = requestAnimationFrame(loop);
    };
    pipRafId = requestAnimationFrame(loop);
  }

  // Safety net: requestVideoFrameCallback / requestAnimationFrame are suspended
  // while the tab is hidden, which used to freeze the PiP picture the moment the
  // user switched tabs. Timers keep running for tabs that play audio, so this
  // light interval only draws when the primary pump has gone quiet.
  pipSafetyTimer = setInterval(() => {
    if (!pipSessionActive || pipSource !== src) return;
    if (src.paused || src.ended) return;
    if (performance.now() - pipLastDraw < 200) return;
    drawPipFrame();
  }, 33);
}

/* Keep the PiP proxy and the page <video> in lock-step. Without this, pausing
   inside the PiP window only paused the proxy — the page video kept its own
   play state and the two disagreed, so the PiP window could never be resumed
   from and the user had to exit PiP and press play on the page. */
function detachPipSync() {
  if (pipSyncCleanup) { pipSyncCleanup(); pipSyncCleanup = null; }
}

function attachPipSync(src) {
  detachPipSync();
  const proxy = pipProxyVideo;
  if (!proxy || !src) return;

  const onProxyPlay = () => { if (pipSyncing) return; if (src.paused) src.play().catch(() => {}); };
  const onProxyPause = () => { if (pipSyncing) return; if (!src.paused) src.pause(); };
  const onSourcePlay = () => { if (pipSyncing) return; if (proxy.paused) proxy.play().catch(() => {}); };
  const onSourcePause = () => { if (pipSyncing) return; if (!proxy.paused) proxy.pause(); };
  const onSourceEnded = () => { document.exitPictureInPicture().catch(() => {}); };
  const onSourceSeeked = () => {
    if (!src.paused) return;
    drawPipFrame();
    // A paused MediaStream-backed video keeps its old frame, so nudge the proxy
    // for one frame to make a seek made while paused visible in the PiP window.
    const wasPaused = proxy.paused;
    pipSyncing = true;
    proxy.play().then(() => { if (wasPaused) proxy.pause(); })
      .catch(() => {})
      .finally(() => { setTimeout(() => { pipSyncing = false; }, 60); });
  };

  proxy.addEventListener('play', onProxyPlay);
  proxy.addEventListener('pause', onProxyPause);
  src.addEventListener('play', onSourcePlay);
  src.addEventListener('pause', onSourcePause);
  src.addEventListener('ended', onSourceEnded);
  src.addEventListener('seeked', onSourceSeeked);

  pipSyncCleanup = () => {
    proxy.removeEventListener('play', onProxyPlay);
    proxy.removeEventListener('pause', onProxyPause);
    src.removeEventListener('play', onSourcePlay);
    src.removeEventListener('pause', onSourcePause);
    src.removeEventListener('ended', onSourceEnded);
    src.removeEventListener('seeked', onSourceSeeked);
  };
}

function teardownPipSession(restoreSource = true) {
  pipSessionActive = false;
  pipSyncing = false;
  pipEntering = false;
  stopPipFramePump();
  detachPipSync();
  if (pipProxyVideo) {
    try { pipProxyVideo.pause(); } catch (e) {}
    try { pipProxyVideo.srcObject = null; } catch (e) {}
    try { pipProxyVideo.remove(); } catch (e) {}
  }
  pipProxyVideo = null;
  pipSource = null;
  pipCanvas = null;
  pipCtx = null;
  if (restoreSource) restoreSourceFromPiP();
}

function toggleFilteredPiP(sourceVideo) {
  if (!sourceVideo) return;

  // Already in a PiP window (ours or the browser's) → leave it.
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
    return;
  }

  // A PiP request is already in flight. Without this, a fast double-click would
  // start a second capture stream and a second requestPictureInPicture() on the
  // same proxy, which lands in the fallback path and tears the session down.
  if (pipEntering) return;

  if (!pipProxyVideo) {
    pipCanvas = document.createElement('canvas');
    pipCtx = pipCanvas.getContext('2d', { willReadFrequently: true });
    pipProxyVideo = document.createElement('video');
    pipProxyVideo.muted = true;
    pipProxyVideo.playsInline = true;
    pipProxyVideo.addEventListener('leavepictureinpicture', () => teardownPipSession(true));
  }

  pipSource = sourceVideo;

  // Fallback: plain (unfiltered) PiP straight on the source video. The source's
  // own enter/leave hooks take care of hiding + restoring the page video.
  const fallbackPiP = () => {
    teardownPipSession(false);
    // Many sites (e.g. YouTube embeds) set this attribute — remove it or
    // requestPictureInPicture() throws InvalidStateError.
    sourceVideo.removeAttribute('disablePictureInPicture');
    sourceVideo.disablePictureInPicture = false;
    sourceVideo.requestPictureInPicture().catch((err) => {
      console.error('LucidView PiP failed:', err);
      showHUD('PiP unavailable', err.name === 'NotAllowedError' ? 'Needs a user gesture' : err.message);
    });
  };

  try {
    // Size the canvas and paint the first frame BEFORE capturing the stream —
    // a 0x0 canvas with no frames makes the PiP request reject.
    if (sourceVideo.readyState < 2) { fallbackPiP(); return; }
    drawPipFrame();
    pipSessionActive = true;
    pipEntering = true;
    // Watchdog: a hung metadata/PiP request must never leave the PiP button
    // permanently dead — clear the in-flight flag and let the user retry.
    setTimeout(() => { pipEntering = false; }, 5000);
    startPipFramePump();

    pipProxyVideo.srcObject = pipCanvas.captureStream(60);

    const enterPiP = () => {
      const proxy = pipProxyVideo;
      if (!proxy) { pipEntering = false; return; }
      const wasPaused = sourceVideo.paused || sourceVideo.ended;

      // Mute the sync while we bring the proxy up so this initial play/pause
      // cannot bounce onto the page video.
      pipSyncing = true;
      setTimeout(() => { pipSyncing = false; }, 1200);

      proxy.play().catch(() => {});

      // Wait for the proxy video to have metadata; requesting PiP earlier
      // throws "Metadata for the video element is not loaded yet".
      proxy.requestPictureInPicture().then(() => {
        pipEntering = false;
        // Hide the page copy so only the PiP window is visible (one video).
        hideSourceForPiP(sourceVideo);
        // Mirror the source's play state so a video paused before entering PiP
        // stays paused instead of silently starting to play.
        if (wasPaused) proxy.pause();
        attachPipSync(sourceVideo);
        setTimeout(() => { pipSyncing = false; }, 150);
      }).catch(() => {
        pipSyncing = false;
        pipEntering = false;
        fallbackPiP();
      });
    };

    if (pipProxyVideo.readyState >= 1) enterPiP();
    else pipProxyVideo.addEventListener('loadedmetadata', enterPiP, { once: true });
  } catch (e) {
    fallbackPiP();
  }
}

/* ---------- NEW: In-player Brightness / Contrast strip ---------- */
// A control strip that lives ON the video itself — the same idea as the volume
// control Opera puts inside its player. Native PiP windows are browser chrome
// that no extension can draw into, so this overlay (plus the floating player's
// Picture row) is where in-player brightness / contrast lives.
function buildOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = 'lucid-inplayer';
  overlayEl.innerHTML = `
    <button class="lucid-ip-fab" id="lucid-ip-fab" title="LucidView controls" aria-label="Expand LucidView controls">✨</button>
    <div class="lucid-ip-panel">
      <div class="lucid-ip-stack">
        <div class="lucid-ip-btns">
          <button class="lucid-ip-ctl" id="lucid-ip-vol-ico" data-ctl="volume" title="Volume — click again to mute">🔊</button>
          <button class="lucid-ip-ctl" data-ctl="bright" title="Brightness">☀</button>
          <button class="lucid-ip-ctl" data-ctl="contrast" title="Contrast">◐</button>
          <button class="lucid-ip-ctl" data-ctl="saturate" title="Saturation">◍</button>
        </div>
        <div class="lucid-ip-group" data-ctl="volume" title="Volume" hidden>
          <input type="range" id="lucid-ip-volume" min="0" max="1" step="0.01" value="1">
          <span class="lucid-ip-val" id="lucid-ip-volume-val">100%</span>
        </div>
        <div class="lucid-ip-group" data-ctl="bright" title="Brightness" hidden>
          <input type="range" id="lucid-ip-bright" min="0.5" max="1.5" step="0.01" value="1">
          <span class="lucid-ip-val" id="lucid-ip-bright-val">1.00</span>
        </div>
        <div class="lucid-ip-group" data-ctl="contrast" title="Contrast" hidden>
          <input type="range" id="lucid-ip-contrast" min="0.5" max="2" step="0.01" value="1">
          <span class="lucid-ip-val" id="lucid-ip-contrast-val">1.00</span>
        </div>
        <div class="lucid-ip-group" data-ctl="saturate" title="Saturation" hidden>
          <input type="range" id="lucid-ip-saturate" min="0" max="2" step="0.01" value="1">
          <span class="lucid-ip-val" id="lucid-ip-saturate-val">1.00</span>
        </div>
        <div class="lucid-ip-actions">
          <button class="lucid-ip-btn" id="lucid-ip-auto" title="Auto balance brightness & contrast">⚡</button>
          <button class="lucid-ip-btn" id="lucid-ip-reset" title="Reset colour">↺</button>
        </div>
      </div>
    </div>
  `;
  overlayEl.dataset.expanded = 'false';

  // The strip floats above the page's own player — never let our clicks reach it.
  ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'wheel'].forEach(evt => {
    overlayEl.addEventListener(evt, (e) => e.stopPropagation());
  });
  overlayEl.addEventListener('mouseenter', () => clearTimeout(overlayHideTimer));
  overlayEl.addEventListener('mousemove', () => keepOverlayAlive());

  const bright = overlayEl.querySelector('#lucid-ip-bright');
  const contrast = overlayEl.querySelector('#lucid-ip-contrast');
  ovBright = bright;
  ovBrightVal = overlayEl.querySelector('#lucid-ip-bright-val');
  ovContrast = contrast;
  ovContrastVal = overlayEl.querySelector('#lucid-ip-contrast-val');
  const saturate = overlayEl.querySelector('#lucid-ip-saturate');
  ovSaturate = saturate;
  ovSaturateVal = overlayEl.querySelector('#lucid-ip-saturate-val');

  /* --- v4.5: volume (drives the <video>, not the colour filter chain) --- */
  const volume = overlayEl.querySelector('#lucid-ip-volume');
  ovVolume = volume;
  ovVolumeVal = overlayEl.querySelector('#lucid-ip-volume-val');
  ovVolIcon = overlayEl.querySelector('#lucid-ip-vol-ico');
  volume.addEventListener('input', () => {
    if (!overlayVideo) return;
    overlayVideo.volume = parseFloat(volume.value);
    if (overlayVideo.volume > 0) overlayVideo.muted = false;
    updateOverlayVolume();
  });

  /* --- v5.1: four control buttons, ONE shared slider ---------------------
     The strip is a compact column of circular buttons. Clicking one reveals
     that control's slider (the active button lights up with the gradient);
     clicking the active button again hides the slider. The volume button
     doubles as mute/unmute while its slider is open. */
  const setActiveCtl = (name) => {
    overlayEl.dataset.active = name || '';
    overlayEl.querySelectorAll('.lucid-ip-ctl').forEach(b =>
      b.classList.toggle('on', b.dataset.ctl === name));
    overlayEl.querySelectorAll('.lucid-ip-group').forEach(g => {
      g.hidden = g.dataset.ctl !== name;
    });
  };

  /* --- v5.2: FAB expand / collapse ------------------------------------
     The strip starts as a small circle. Clicking it expands the control
     panel; clicking again (or the FAB while expanded) collapses it.
     Dragging the circle moves the strip — but only after movement exceeds a
     threshold, so a plain click still fires and is never swallowed by
     preventDefault / pointer capture. */
  const fab = overlayEl.querySelector('#lucid-ip-fab');
  let fabDragged = false;
  let fabToggleLock = 0;
  let fabDragEndedAt = 0;
  const setExpanded = (open) => {
    overlayEl.dataset.expanded = open ? 'true' : 'false';
    overlayEl.classList.toggle('is-expanded', !!open);
    if (fab) {
      fab.textContent = open ? '✕' : '✨';
      fab.title = open ? 'Collapse LucidView controls' : 'LucidView controls';
      fab.setAttribute('aria-label', fab.title);
    }
    if (!open) setActiveCtl(null);
    keepOverlayAlive();
  };
  const toggleExpanded = (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    // Ignore residual click/pointerup after a drag, and debounce the
    // pointerup+click pair into a single toggle.
    const now = Date.now();
    if (fabDragged || now - fabDragEndedAt < 300) {
      fabDragged = false;
      return;
    }
    if (now - fabToggleLock < 250) return;
    fabToggleLock = now;
    setExpanded(overlayEl.dataset.expanded !== 'true');
  };
  if (fab) {
    // Toggle on pointerup AND click (guarded). Do not preventDefault on
    // pointerdown — that suppresses click and the circle never expands.
    fab.addEventListener('pointerup', toggleExpanded);
    fab.addEventListener('click', toggleExpanded);
  }

  overlayEl.querySelectorAll('.lucid-ip-ctl').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!overlayVideo) return;
      // Interacting with a control implies the panel is open.
      if (overlayEl.dataset.expanded !== 'true') setExpanded(true);
      const name = btn.dataset.ctl;
      if (name === 'volume' && overlayEl.dataset.active === 'volume') {
        // Un-muting a video parked at 0 would look like nothing happened.
        overlayVideo.muted = !overlayVideo.muted;
        if (!overlayVideo.muted && overlayVideo.volume === 0) overlayVideo.volume = 0.5;
        updateOverlayVolume();
        showHUD('Volume', overlayVideo.muted ? 'Muted' : Math.round(overlayVideo.volume * 100) + '%');
      } else if (overlayEl.dataset.active === name) {
        setActiveCtl(null);
      } else {
        setActiveCtl(name);
      }
      keepOverlayAlive();
    });
  });
  setActiveCtl(null);
  setExpanded(false);

  bright.addEventListener('input', () => applyFilters(overlayVideo, { brightness: parseFloat(bright.value) }));
  contrast.addEventListener('input', () => applyFilters(overlayVideo, { contrast: parseFloat(contrast.value) }));
  saturate.addEventListener('input', () => applyFilters(overlayVideo, { saturate: parseFloat(saturate.value) }));
  overlayEl.querySelector('#lucid-ip-auto').addEventListener('click', () => {
    autoTone(overlayVideo);
    setTimeout(syncPictureUI, 150);
  });
  overlayEl.querySelector('#lucid-ip-reset').addEventListener('click', () => {
    resetFilters(overlayVideo);
    showHUD('Colour', 'Reset');
  });

  // Drag the strip anywhere over the video (default sits just above the site's
  // own control bar, which differs per player, so it has to be movable).
  //
  // v4.3 FIX — "stuck to the mouse cursor": the old version listened for
  // mouseup on `document`, but this strip stops propagation of mouseup (the
  // guard above, which keeps page players from seeing our clicks). Releasing
  // the mouse over the strip — which is nearly every time, because the strip
  // follows the cursor while dragging — meant the document never saw the
  // mouseup, the drag listeners stayed attached forever, and the strip chased
  // the cursor across the page. Pointer capture solves it properly: once
  // captured, pointerup/pointercancel are guaranteed to be delivered to the
  // strip no matter where the cursor is when released, even outside the
  // window. A window-level safety net below catches anything else.
  overlayEl.addEventListener('pointerdown', (e) => {
    // Allow drag from the FAB (it's the only handle when collapsed) and from
    // empty chrome — never from sliders or the compact control buttons.
    const fromFab = !!(e.target.closest && e.target.closest('.lucid-ip-fab'));
    if (!fromFab && e.target.closest('input, button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Do NOT preventDefault or setPointerCapture here: that cancels the
    // button's click, so the circle never expanded. Wait for real movement.
    const startX = e.clientX, startY = e.clientY;
    const startDx = overlayPos.dx, startDy = overlayPos.dy;
    fabDragged = false;
    let dragging = false;
    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) <= 4) return;
        dragging = true;
        fabDragged = true;
        try { overlayEl.setPointerCapture(e.pointerId); } catch (err) {}
        document.body.style.userSelect = 'none';
      }
      overlayPos.custom = true;
      overlayPos.dx = startDx + (ev.clientX - startX);
      overlayPos.dy = startDy + (ev.clientY - startY);
      positionOverlay();
    };
    const endDrag = () => {
      overlayDragEnd = null;
      overlayEl.removeEventListener('pointermove', onMove);
      overlayEl.removeEventListener('pointerup', endDrag);
      overlayEl.removeEventListener('pointercancel', endDrag);
      document.body.style.userSelect = '';
      if (dragging) {
        try { overlayEl.releasePointerCapture(e.pointerId); } catch (err) {}
        fabDragEndedAt = Date.now();
      }
      // Keep the drag flag long enough for any residual click to see it.
      if (fabDragged) setTimeout(() => { fabDragged = false; }, 300);
    };
    overlayDragEnd = endDrag;
    overlayEl.addEventListener('pointermove', onMove);
    overlayEl.addEventListener('pointerup', endDrag);
    overlayEl.addEventListener('pointercancel', endDrag);
  });

  // Belt-and-braces: whatever happens (capture lost to a fullscreen
  // re-parent, a stray edge case in some player), a pointerup or pointercancel
  // observed ANYWHERE, or the window losing focus, always tears the drag down.
  const overlayGlobalDragEnd = () => { if (overlayDragEnd) overlayDragEnd(); };
  window.addEventListener('pointerup', overlayGlobalDragEnd, true);
  window.addEventListener('pointercancel', overlayGlobalDragEnd, true);
  window.addEventListener('blur', overlayGlobalDragEnd);

  (document.body || document.documentElement).appendChild(overlayEl);
  overlayEl.querySelectorAll('input[type=range]').forEach(lvPaintRange);
  return overlayEl;
}

// Fullscreen elements create their own stacking context, so the strip has to be
// re-parented into the fullscreen element to stay visible.
function overlayHost() {
  return document.fullscreenElement || document.body || document.documentElement;
}

function positionOverlay() {
  if (!overlayEl || !overlayVideo) return false;
  if (pipHiddenState || floatingContainer) return false; // video hidden / moved
  let r;
  try { r = overlayVideo.getBoundingClientRect(); } catch (e) { return false; }
  if (!r || r.width < 140 || r.height < 90) return false;
  // The bar is anchored to the right edge of the player, so only reject when
  // the video has scrolled off the right/left (the strip would be off-screen).
  if (r.right < 60 || r.left > window.innerWidth - 20) return false;
  // Vertical bar: right edge floats ~14px inside the player, centred vertically.
  // Bar is translated -100%/-50% in CSS, so `left`/`top` are its right/centre.
  const baseLeft = r.right - 14;
  const baseTop = r.top + r.height / 2;
  overlayEl.style.left = (baseLeft + overlayPos.dx) + 'px';
  overlayEl.style.top = (baseTop + overlayPos.dy) + 'px';
  return true;
}

function keepOverlayAlive() {
  clearTimeout(overlayHideTimer);
  overlayHideTimer = setTimeout(hideOverlay, 2800);
}

function hideOverlay() {
  if (overlayEl) {
    overlayEl.classList.remove('visible');
    // Next appearance always starts as the collapsed circle.
    overlayEl.dataset.expanded = 'false';
    overlayEl.classList.remove('is-expanded');
    const fab = overlayEl.querySelector('#lucid-ip-fab');
    if (fab) {
      fab.textContent = '✨';
      fab.title = 'LucidView controls';
      fab.setAttribute('aria-label', fab.title);
    }
  }
  stopOverlayTracking();
}

// v4.3 — While the strip is visible, re-anchor it to the video's rect on every
// animation frame. The previous scroll/resize listeners re-measured on a
// debounced timer, so during page scrolls the strip visibly lagged behind and
// drifted off the player. A per-frame anchor keeps it locked to the player the
// way Opera's volume OSD is — an element OF the player, not of the page. The
// loop only runs while the strip is on screen, so it costs nothing otherwise.
function overlayTrackLoop() {
  overlayTrackRaf = null;
  if (!overlayEl || !overlayEl.classList.contains('visible')) return;
  if (!positionOverlay()) { hideOverlay(); return; } // player gone (PiP/floating/size) → hide
  overlayTrackRaf = requestAnimationFrame(overlayTrackLoop);
}

function startOverlayTracking() {
  if (overlayTrackRaf === null) overlayTrackRaf = requestAnimationFrame(overlayTrackLoop);
}

function stopOverlayTracking() {
  if (overlayTrackRaf !== null) { cancelAnimationFrame(overlayTrackRaf); overlayTrackRaf = null; }
}

function showOverlay() {
  if (!overlayEnabled || !overlayEl || !overlayVideo) return;
  // v4.3: the strip belongs to playback. A paused or ended video never
  // summons it — and if it is mid-fade from a playback that just stopped,
  // get rid of it now.
  if (overlayVideo.paused || overlayVideo.ended) { hideOverlay(); return; }
  if (!overlayEl.classList.contains('visible')) {
    if (!positionOverlay()) { hideOverlay(); return; }
    overlayEl.classList.add('visible');
  }
  startOverlayTracking();
  keepOverlayAlive();
}

// Listened for on the document (capture), not on the video: on most sites the
// <video> is covered by the player's own control layer, so mousemove events
// never reach the element itself. We just test the pointer against its rect.
function onGlobalMouseMove(e) {
  if (!overlayEnabled || !overlayVideo || !overlayEl) return;
  if (overlayEl === e.target || overlayEl.contains(e.target)) { keepOverlayAlive(); return; }
  // v4.3: paused/ended video — never show the strip, and hide it if it is
  // still on screen from the moment playback stopped.
  if (overlayVideo.paused || overlayVideo.ended) {
    if (overlayEl.classList.contains('visible')) hideOverlay();
    return;
  }
  // Measuring the video rect is a layout read; cap it at ~20/s while the strip
  // is off-screen so a busy page cannot turn mousemove into a reflow storm.
  const now = performance.now();
  const visible = overlayEl.classList.contains('visible');
  if (!visible && now - overlayLastCheck < 50) return;
  overlayLastCheck = now;
  let r;
  try { r = overlayVideo.getBoundingClientRect(); } catch (err) { return; }
  if (!r) return;
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (inside) {
    showOverlay();
  } else if (visible) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = setTimeout(hideOverlay, 500);
  }
}

// Single source of truth for the brightness/contrast readouts: the overlay
// strip, the floating player's Picture row and the popup all read from here.
// Called on every slider input, so the element refs are cached rather than
// re-queried each time.
function syncPictureUI() {
  if (ovBright) { ovBright.value = currentFilters.brightness; lvPaintRange(ovBright); }
  if (ovBrightVal) ovBrightVal.textContent = Number(currentFilters.brightness).toFixed(2);
  if (ovContrast) { ovContrast.value = currentFilters.contrast; lvPaintRange(ovContrast); }
  if (ovContrastVal) ovContrastVal.textContent = Number(currentFilters.contrast).toFixed(2);
  if (ovSaturate) { ovSaturate.value = currentFilters.saturate; lvPaintRange(ovSaturate); }
  if (ovSaturateVal) ovSaturateVal.textContent = Number(currentFilters.saturate).toFixed(2);
  if (floatSyncPicture) floatSyncPicture();
}

/* v4.5 — Volume lives on the <video> element, not in the colour filter chain,
   so it needs its own sync. Dragging the strip, the floating player's volume
   bar, the popup slider and the Ctrl+Arrow shortcuts all land on the same
   element, and the browser's `volumechange` event brings the strip's dot and
   readout back in line no matter which one moved it. */
function updateOverlayVolume() {
  const v = overlayVideo;
  if (!ovVolume || !v) return;
  const silent = v.muted || v.volume === 0;
  ovVolume.value = v.muted ? 0 : v.volume;
  lvPaintRange(ovVolume);
  if (ovVolumeVal) ovVolumeVal.textContent = v.muted ? 'Mute' : Math.round(v.volume * 100) + '%';
  if (ovVolIcon) ovVolIcon.textContent = silent ? '🔇' : (v.volume < 0.5 ? '🔉' : '🔊');
}

function detachOverlay() {
  // v4.3 FIX: also drop the play-state listeners from the previous video —
  // switching videos used to leak them onto every old element.
  if (overlayVideoCleanup) { overlayVideoCleanup(); overlayVideoCleanup = null; }
  overlayVideo = null;
  clearTimeout(overlayHideTimer);
  hideOverlay();
}

function attachOverlay(video) {
  if (!video) return;
  if (overlayVideo === video) return;
  detachOverlay();
  overlayVideo = video;
  buildOverlay();

  // v4.3: the strip follows the video's play state. Pause or end → hide at
  // once; it can only come back (on hover) once the video is playing again.
  const onPlaybackStopped = () => { clearTimeout(overlayHideTimer); hideOverlay(); };
  video.addEventListener('pause', onPlaybackStopped);
  video.addEventListener('ended', onPlaybackStopped);
  // v4.5: keep the strip's volume dot/readout in sync with every other surface.
  video.addEventListener('volumechange', updateOverlayVolume);
  overlayVideoCleanup = () => {
    video.removeEventListener('pause', onPlaybackStopped);
    video.removeEventListener('ended', onPlaybackStopped);
    video.removeEventListener('volumechange', updateOverlayVolume);
  };

  if (!overlayGlobalsBound) {
    overlayGlobalsBound = true;
    document.addEventListener('mousemove', onGlobalMouseMove, true);
    window.addEventListener('scroll', () => {
      if (overlayEl && overlayEl.classList.contains('visible')) positionOverlay();
    }, true);
    window.addEventListener('resize', () => {
      if (overlayEl && overlayEl.classList.contains('visible')) positionOverlay();
    });
    document.addEventListener('fullscreenchange', () => {
      if (!overlayEl) return;
      const host = overlayHost();
      if (overlayEl.parentNode !== host) host.appendChild(overlayEl);
      if (overlayEl.classList.contains('visible')) positionOverlay();
    });
  }

  syncPictureUI();
  updateOverlayVolume();
}

function setOverlayEnabled(on) {
  overlayEnabled = !!on;
  if (!overlayEnabled) hideOverlay();
  showHUD('In-player controls', overlayEnabled ? 'On' : 'Off');
}


/* ---------- Screenshot (FIXED: report tainted canvas) ---------- */
function captureScreenshot(video) {
  if (!video) return { ok: false, reason: 'No video found' };
  try {
    const c = document.createElement('canvas');
    c.width = video.videoWidth || 1280;
    c.height = video.videoHeight || 720;
    const ctx = c.getContext('2d');
    ctx.filter = `contrast(${currentFilters.contrast}) saturate(${currentFilters.saturate}) brightness(${currentFilters.brightness}) hue-rotate(${currentFilters.hue}deg)`;
    ctx.drawImage(video, 0, 0, c.width, c.height);
    // Reading a pixel throws SecurityError if the canvas is tainted
    ctx.getImageData(0, 0, 1, 1);
    const dataUrl = c.toDataURL('image/png', 0.92);
    const galleryItem = addGalleryItem(dataUrl, video.currentTime || 0);
    c.toBlob(blob => {
      if (!blob) return;
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => {
        showHUD('Screenshot', 'Copied to clipboard');
      }).catch(() => {
        const a = document.createElement('a');
        a.download = `lucidview-${Date.now()}.png`;
        a.href = URL.createObjectURL(blob);
        a.click();
        showHUD('Screenshot', 'Downloaded');
      });
    });
    return { ok: true, id: galleryItem.id, dataUrl, time: galleryItem.time };
  } catch (err) {
    showHUD('Screenshot blocked', 'Cross-origin video');
    return { ok: false, reason: 'Cross-origin video (canvas tainted)' };
  }
}

/* ---------- Keyboard shortcuts ---------- */
function handleKeyboardShortcuts(e) {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) return;

  const k = e.key.toLowerCase();
  const code = e.code;
  const shift = e.shiftKey;
  const ctrl = e.ctrlKey;
  const alt = e.altKey;

  // v4.6: Alt + Q always jumps to the best-quality video on the page — works
  // even before LucidView has settled on a main video.
  if (alt && k === 'q') {
    const list = getVideoList();
    if (list.length) {
      const best = list.slice().sort((a, b) => (b.rank - a.rank) || (b.area - a.area))[0];
      selectVideoById(best.id);
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  if (!mainVideo) return;

  let handled = false;

  if (code === 'Space' && alt) {
    if (mainVideo.paused) mainVideo.play(); else mainVideo.pause();
    showHUD(mainVideo.paused ? 'Paused' : 'Playing');
    handled = true;
  }
  if ((code === 'ArrowRight' && alt) || (k === 'd' && alt)) {
    if (mainVideo.duration) mainVideo.currentTime = Math.min(mainVideo.duration, mainVideo.currentTime + 10);
    showHUD('Skip', '+10s');
    handled = true;
  }
  if ((code === 'ArrowLeft' && alt) || (k === 'a' && alt)) {
    if (mainVideo.duration) mainVideo.currentTime = Math.max(0, mainVideo.currentTime - 10);
    showHUD('Skip', '-10s');
    handled = true;
  }
  if (shift && (k === '>' || code === 'Period')) {
    mainVideo.playbackRate = Math.min(16, mainVideo.playbackRate + 0.25);
    showHUD('Speed', mainVideo.playbackRate.toFixed(2) + 'x');
    handled = true;
  }
  if (shift && (k === '<' || code === 'Comma')) {
    mainVideo.playbackRate = Math.max(0.1, mainVideo.playbackRate - 0.25);
    showHUD('Speed', mainVideo.playbackRate.toFixed(2) + 'x');
    handled = true;
  }
  if (alt && k >= '1' && k <= '9') {
    const rates = { 1: 0.5, 2: 0.75, 3: 1, 4: 1.25, 5: 1.5, 6: 2, 7: 3, 8: 4, 9: 8 };
    mainVideo.playbackRate = rates[parseInt(k)] || 1;
    showHUD('Speed', mainVideo.playbackRate.toFixed(2) + 'x');
    handled = true;
  }
  if (alt && k === '0') {
    mainVideo.playbackRate = 1;
    showHUD('Speed', '1.00x');
    handled = true;
  }
  if (ctrl && code === 'ArrowUp') {
    mainVideo.volume = Math.min(1, mainVideo.volume + 0.1);
    showHUD('Volume', Math.round(mainVideo.volume * 100) + '%');
    handled = true;
  }
  if (ctrl && code === 'ArrowDown') {
    mainVideo.volume = Math.max(0, mainVideo.volume - 0.1);
    showHUD('Volume', Math.round(mainVideo.volume * 100) + '%');
    handled = true;
  }
  if (alt && k === 'l') {
    mainVideo.loop = !mainVideo.loop;
    showHUD('Loop', mainVideo.loop ? 'On' : 'Off');
    handled = true;
  }
  if (alt && k === 'f') {
    const isActive = lucidActive;
    if (isActive) resetFilters(mainVideo); else applyCinematicPreset(mainVideo);
    showHUD('Lucid Mode', isActive ? 'Off' : 'On');
    handled = true;
  }
  if (alt && k === 'p') {
    toggleFilteredPiP(mainVideo);
    handled = true;
  }
  if (alt && k === 's') {
    captureScreenshot(mainVideo);
    handled = true;
  }
  if (alt && k === 'c') {
    setOverlayEnabled(!overlayEnabled);
    handled = true;
  }
  if (alt && k === 'm') {
    addMark('');
    handled = true;
  }
  if (alt && k === 'h') {
    setFocusMode(!focusActive);
    handled = true;
  }
  if (alt && k === 'g') {
    createFloatingPlayer(mainVideo);
    handled = true;
  }
  if (alt && k === 'b') {
    if (!audioCtx) setupAudio(mainVideo);
    if (gainNode) {
      const newBoost = gainNode.gain.value > 1.5 ? 1 : 2.5;
      gainNode.gain.value = newBoost;
      showHUD('Volume boost', newBoost + 'x');
    }
    handled = true;
  }

  if (handled) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

/* ---------- NEW: Ambient Glow (ambilight) ---------- */
function startAmbientGlow(video, glowEl) {
  if (!ambientCanvas) {
    ambientCanvas = document.createElement('canvas');
    ambientCanvas.width = 12;
    ambientCanvas.height = 8;
    ambientCtx = ambientCanvas.getContext('2d', { willReadFrequently: true });
  }
  ambientTainted = false;
  let lastSample = 0;
  const supportsRVFC = typeof video.requestVideoFrameCallback === 'function';

  const compute = () => {
    try {
      ambientCtx.drawImage(video, 0, 0, 12, 8);
      const d = ambientCtx.getImageData(0, 0, 12, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      glowEl.style.background = `radial-gradient(ellipse at center, rgb(${r},${g},${b}) 0%, rgba(${r},${g},${b},0.4) 60%, transparent 100%)`;
      return true;
    } catch (e) {
      // Cross-origin video: fall back to static brand glow
      ambientTainted = true;
      glowEl.style.background = 'radial-gradient(ellipse at center, rgba(61,155,255,0.8) 0%, rgba(61,233,198,0.25) 60%, transparent 100%)';
      stopAmbientGlow();
      return false;
    }
  };

  const sample = (ts) => {
    if (!floatingContainer || !ambientEnabled) return;
    ambientRafId = requestAnimationFrame(sample);
    if (ts - lastSample < 400) return;
    lastSample = ts;
    if (video.readyState < 2) return;
    compute();
  };

  // Modern API: only fires on actual presented video frames, so it naturally
  // pauses when the video pauses (zero wasted CPU) and stays frame-accurate.
  const onFrame = () => {
    if (!floatingContainer || !ambientEnabled) return;
    ambientRafId = video.requestVideoFrameCallback(onFrame);
    const t = performance.now();
    if (t - lastSample < 400) return;
    lastSample = t;
    if (video.readyState < 2) return;
    compute();
  };

  ambientRafId = supportsRVFC ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(sample);
}

function stopAmbientGlow() {
  cancelAnimationFrame(ambientRafId);
  ambientRafId = null;
}

/* ---------- Floating player ---------- */
function createFloatingPlayer(video) {
  if (!video) return;
  // If a previous PiP left the source hidden, restore it before moving the
  // video into the floating player (otherwise the floated video is invisible).
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  restoreSourceFromPiP();
  const existing = document.getElementById('lucid-float-container');
  if (existing) existing.remove();

  const originalParent = video.parentElement;
  const originalNextSibling = video.nextElementSibling;
  const originalControls = video.controls; // FIX: keep out of the style object
  const originalStyles = {
    position: video.style.position || '',
    top: video.style.top || '',
    left: video.style.left || '',
    width: video.style.width || '',
    height: video.style.height || '',
    maxHeight: video.style.maxHeight || '',
    display: video.style.display || '',
    zIndex: video.style.zIndex || '',
    filter: video.style.filter || ''
  };

  const container = document.createElement('div');
  container.id = 'lucid-float-container';
  container.innerHTML = `
    <div id="lucid-ambient-glow"></div>
    <div class="lucid-float-header">
      <div class="header-left">
        <span class="title">✨ Lucid Floating Player</span>
        <span class="badge">v5.0</span>
      </div>
      <div class="header-actions">
        <button class="h-btn" id="float-ambient" title="Ambient Glow">◉</button>
        <button class="h-btn" id="float-lucid" title="Cinematic Mode">✨</button>
        <button class="h-btn" id="float-speed" title="Current Speed">1.0×</button>
        <button class="h-btn" id="float-screenshot" title="Screenshot">📷</button>
        <button class="h-btn close" id="float-close" title="Close">✕</button>
      </div>
    </div>
    <div class="lucid-video-wrapper"></div>
    <div class="lucid-controls">
      <div class="controls-row">
        <button id="float-play" class="ctrl-btn">▶</button>
        <input type="range" id="float-progress" class="progress" min="0" max="1" step="0.0001" value="0">
        <span id="float-time" class="time">00:00 / 00:00 · left --</span>
      </div>
      <div class="controls-row">
        <button id="float-mute" class="ctrl-btn small" title="Mute / Unmute">🔊</button>
        <input type="range" id="float-volume" class="vol-slider" min="0" max="1" step="0.01" value="1">
        <span id="float-vol-txt" class="vol-txt">100%</span>
        <span style="font-size:10px;opacity:0.6;">Boost</span>
        <input type="range" id="float-boost" min="1" max="5" step="0.1" value="1" class="vol-slider mini" style="width:72px;">
      </div>
      <div class="controls-row secondary">
        <div class="speed-group">
          <button class="speed-btn" data-rate="0.5">0.5</button>
          <button class="speed-btn active" data-rate="1">1</button>
          <button class="speed-btn" data-rate="1.5">1.5</button>
          <button class="speed-btn" data-rate="2">2</button>
          <button class="speed-btn" data-rate="4">4</button>
        </div>
        <button id="float-loop" class="ctrl-btn small" title="Loop">🔁</button>
        <button id="float-restore" class="ctrl-btn small" title="Return">↩</button>
      </div>
      <div class="controls-row secondary" style="margin-top:6px; justify-content:flex-start; gap:6px;">
        <div class="ab-controls">
          <button id="ab-set-a" class="ab-btn" title="Set A point">A</button>
          <button id="ab-set-b" class="ab-btn" title="Set B point">B</button>
          <button id="ab-toggle" class="ab-btn" title="Toggle A-B Loop">AB</button>
          <button id="frame-back" class="ctrl-btn small" title="Frame back">«</button>
          <button id="frame-forward" class="ctrl-btn small" title="Frame forward">»</button>
          <span id="ab-status" style="font-size:10px; color:#a1a1aa; margin-left:4px;"></span>
        </div>
      </div>
      <div class="controls-row secondary" style="margin-top:8px; flex-direction:column; align-items:stretch; gap:4px;">
        <div class="section-title" style="margin:0 0 2px;">Picture</div>
        <div class="pic-row">
          <span class="pic-label">Brightness</span>
          <input type="range" id="float-bright" min="0.5" max="1.5" step="0.01" value="1">
          <span class="pic-val" id="float-bright-val">1.00</span>
        </div>
        <div class="pic-row">
          <span class="pic-label">Contrast</span>
          <input type="range" id="float-contrast" min="0.5" max="2" step="0.01" value="1">
          <span class="pic-val" id="float-contrast-val">1.00</span>
        </div>
        <div class="pic-row">
          <span class="pic-label">Saturation</span>
          <input type="range" id="float-saturate" min="0" max="2" step="0.01" value="1">
          <span class="pic-val" id="float-saturate-val">1.00</span>
          <button class="pic-auto" id="float-auto" title="Auto-balance brightness & contrast">⚡ Auto</button>
          <button class="pic-pip" id="float-pop-pip" title="Pop out as real browser PiP (filters baked in)">🖼️ Pop</button>
        </div>
      </div>
    </div>
  `;

  Object.assign(container.style, {
    position: 'fixed', top: '10%', left: '62%', width: '460px',
    background: '#16171b', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.05)', zIndex: '2147483647',
    color: '#f2f3f6'
  });
  container.querySelectorAll('input[type=range]').forEach(lvPaintRange);

  const wrapper = container.querySelector('.lucid-video-wrapper');
  video.style.width = '100%';
  video.style.height = 'auto';
  video.style.maxHeight = ''; // FIX: no hard cap — CSS handles sizing so resize is unlimited
  video.style.display = 'block';
  video.controls = false;
  wrapper.appendChild(video);

  applyFilters(video, currentFilters);

  document.body.appendChild(container);
  floatingContainer = container;

  const glowEl = container.querySelector('#lucid-ambient-glow');
  const ambientBtn = container.querySelector('#float-ambient');
  ambientBtn.classList.toggle('on', ambientEnabled);
  if (ambientEnabled) startAmbientGlow(video, glowEl);
  ambientBtn.onclick = () => {
    ambientEnabled = !ambientEnabled;
    ambientBtn.classList.toggle('on', ambientEnabled);
    if (ambientEnabled) { glowEl.style.opacity = '0.55'; startAmbientGlow(video, glowEl); }
    else { glowEl.style.opacity = '0'; stopAmbientGlow(); }
  };

  /* --- Drag (FIX: scoped listeners, no clobbering) --- */
  const header = container.querySelector('.lucid-float-header');
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    const startX = e.clientX, startY = e.clientY;
    // FIX: use getBoundingClientRect — offsetLeft/offsetTop are wrong for a
    // fixed element positioned with % values, which made the player refuse
    // to move above/past certain points.
    const rect = container.getBoundingClientRect();
    const startLeft = rect.left, startTop = rect.top;
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      // Allow dragging flush to the top (0) and mostly off-screen left/right;
      // only keep enough of the header on-screen to grab it again.
      const w = container.offsetWidth;
      container.style.left = Math.max(-(w - 80), Math.min(window.innerWidth - 80, startLeft + (ev.clientX - startX))) + 'px';
      container.style.top = Math.max(0, Math.min(window.innerHeight - 48, startTop + (ev.clientY - startY))) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  /* --- Resize (FIX: scoped listeners) --- */
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = 'position:absolute; bottom:0; right:0; width:22px; height:22px; cursor:nwse-resize; z-index:10; border-bottom-right-radius:20px; background: linear-gradient(135deg, transparent 55%, #3d9bff 55%);';
  container.appendChild(resizeHandle);

  resizeHandle.addEventListener('mousedown', (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    const startW = container.offsetWidth, startH = container.offsetHeight;
    const startX = e.clientX, startY = e.clientY;
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      // FIX: was capped at 820x680 — now only limited by the viewport.
      const maxW = window.innerWidth - 16;
      const maxH = window.innerHeight - 16;
      const newW = Math.max(300, Math.min(maxW, startW + (ev.clientX - startX)));
      const newH = Math.max(220, Math.min(maxH, startH + (ev.clientY - startY)));
      container.classList.add('custom-size');
      container.style.width = newW + 'px';
      container.style.height = newH + 'px';
      wrapper.style.height = ''; // flex layout sizes the video area now
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  /* --- Transport --- */
  const playBtn = container.querySelector('#float-play');
  const progressBar = container.querySelector('#float-progress');
  const timeDisplay = container.querySelector('#float-time');
  const volSlider = container.querySelector('#float-volume');
  const speedButtons = container.querySelectorAll('.speed-btn');
  const abStatus = container.querySelector('#ab-status');

  playBtn.onclick = () => {
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  };
  video.addEventListener('play', () => { playBtn.textContent = '⏸'; toggleWakeLock(true); });
  video.addEventListener('pause', () => { playBtn.textContent = '▶'; toggleWakeLock(false); });

  progressBar.oninput = () => { if (video.duration) video.currentTime = parseFloat(progressBar.value) * video.duration; };
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    progressBar.value = video.currentTime / video.duration;
    lvPaintRange(progressBar);
    const left = Math.max(0, video.duration - video.currentTime);
    timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)} · left ${formatTime(left)}`;
    if (abLoop.active && abLoop.a !== null && abLoop.b !== null && video.currentTime >= abLoop.b) {
      video.currentTime = abLoop.a;
    }
  });

  /* --- Volume bar (slider + mute + % readout) --- */
  const muteBtn = container.querySelector('#float-mute');
  const volTxt = container.querySelector('#float-vol-txt');
  const renderVolume = () => {
    volSlider.value = video.muted ? 0 : video.volume;
    lvPaintRange(volSlider);
    volTxt.textContent = video.muted ? 'Muted' : Math.round(video.volume * 100) + '%';
    muteBtn.textContent = (video.muted || video.volume === 0) ? '🔇' : '🔊';
  };
  renderVolume();
  volSlider.oninput = () => {
    video.volume = parseFloat(volSlider.value);
    if (video.volume > 0) video.muted = false;
    renderVolume();
  };
  muteBtn.onclick = () => { video.muted = !video.muted; renderVolume(); };
  video.addEventListener('volumechange', renderVolume);

  const boostSlider = container.querySelector('#float-boost');
  if (gainNode) boostSlider.value = gainNode.gain.value || 1;
  lvPaintRange(boostSlider);
  boostSlider.oninput = () => {
    if (!audioCtx) setupAudio(video);
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (gainNode) gainNode.gain.value = parseFloat(boostSlider.value);
  };

  speedButtons.forEach(btn => {
    btn.onclick = () => { video.playbackRate = parseFloat(btn.dataset.rate); };
  });
  video.addEventListener('ratechange', () => {
    const s = container.querySelector('#float-speed');
    if (s) s.textContent = video.playbackRate.toFixed(1) + '×';
    speedButtons.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.rate) === video.playbackRate));
  });

  container.querySelector('#float-loop').onclick = (e) => {
    video.loop = !video.loop;
    e.target.style.color = video.loop ? '#3de9c6' : '';
  };

  container.querySelector('#float-screenshot').onclick = () => captureScreenshot(video);

  container.querySelector('#float-lucid').onclick = (e) => {
    if (lucidActive) {
      resetFilters(video);
      e.target.classList.remove('on');
    } else {
      applyCinematicPreset(video);
      e.target.classList.add('on');
    }
    syncPictureUI();
  };

  /* --- NEW: Picture controls (brightness / contrast / auto / pop PiP) --- */
  const brightSlider = container.querySelector('#float-bright');
  const brightVal = container.querySelector('#float-bright-val');
  const contrastSlider = container.querySelector('#float-contrast');
  const contrastVal = container.querySelector('#float-contrast-val');
  const saturateSlider = container.querySelector('#float-saturate');
  const saturateVal = container.querySelector('#float-saturate-val');

  const syncPicture = () => {
    if (!brightSlider || !contrastSlider || !saturateSlider) return;
    brightSlider.value = currentFilters.brightness;
    lvPaintRange(brightSlider);
    brightVal.textContent = parseFloat(currentFilters.brightness).toFixed(2);
    contrastSlider.value = currentFilters.contrast;
    lvPaintRange(contrastSlider);
    contrastVal.textContent = parseFloat(currentFilters.contrast).toFixed(2);
    saturateSlider.value = currentFilters.saturate;
    lvPaintRange(saturateSlider);
    saturateVal.textContent = parseFloat(currentFilters.saturate).toFixed(2);
  };
  floatSyncPicture = syncPicture; // let the overlay / popup drive these too
  syncPicture();

  brightSlider.oninput = () => {
    applyFilters(video, { brightness: parseFloat(brightSlider.value) });
    brightVal.textContent = parseFloat(brightSlider.value).toFixed(2);
  };
  contrastSlider.oninput = () => {
    applyFilters(video, { contrast: parseFloat(contrastSlider.value) });
    contrastVal.textContent = parseFloat(contrastSlider.value).toFixed(2);
  };
  saturateSlider.oninput = () => {
    applyFilters(video, { saturate: parseFloat(saturateSlider.value) });
    saturateVal.textContent = parseFloat(saturateSlider.value).toFixed(2);
  };
  container.querySelector('#float-auto').onclick = () => { autoTone(video); setTimeout(syncPicture, 150); };
  container.querySelector('#float-pop-pip').onclick = () => { toggleFilteredPiP(video); };

  /* --- FIX: A-B loop + frame-step buttons were dead UI --- */
  const btnA = container.querySelector('#ab-set-a');
  const btnB = container.querySelector('#ab-set-b');
  const btnAB = container.querySelector('#ab-toggle');

  const renderABStatus = () => {
    const a = abLoop.a !== null ? formatTime(abLoop.a) : '--';
    const b = abLoop.b !== null ? formatTime(abLoop.b) : '--';
    abStatus.textContent = (abLoop.a !== null || abLoop.b !== null) ? `${a} → ${b}${abLoop.active ? ' ●' : ''}` : '';
    btnA.classList.toggle('active', abLoop.a !== null);
    btnB.classList.toggle('active', abLoop.b !== null);
    btnAB.classList.toggle('active', abLoop.active);
  };

  btnA.onclick = () => {
    abLoop.a = video.currentTime;
    if (abLoop.b !== null && abLoop.b <= abLoop.a) abLoop.b = null;
    renderABStatus();
    showHUD('Loop point A', formatTime(abLoop.a));
  };
  btnB.onclick = () => {
    if (abLoop.a === null || video.currentTime > abLoop.a) {
      abLoop.b = video.currentTime;
      renderABStatus();
      showHUD('Loop point B', formatTime(abLoop.b));
    } else {
      showHUD('Point B must be after A');
    }
  };
  btnAB.onclick = () => {
    if (abLoop.a === null || abLoop.b === null) {
      showHUD('Set both A and B first');
      return;
    }
    abLoop.active = !abLoop.active;
    renderABStatus();
    showHUD('A-B Loop', abLoop.active ? 'On' : 'Off');
  };

  const FRAME = 1 / 30;
  container.querySelector('#frame-back').onclick = () => {
    video.pause();
    video.currentTime = Math.max(0, video.currentTime - FRAME);
  };
  container.querySelector('#frame-forward').onclick = () => {
    video.pause();
    if (video.duration) video.currentTime = Math.min(video.duration, video.currentTime + FRAME);
  };

  /* --- Restore --- */
  const restoreToPage = () => {
    stopAmbientGlow();
    floatSyncPicture = null;
    if (originalParent && video) {
      try {
        if (originalNextSibling && originalNextSibling.parentNode === originalParent) originalParent.insertBefore(video, originalNextSibling);
        else originalParent.appendChild(video);
        Object.assign(video.style, originalStyles);
        video.controls = originalControls; // FIX: restore as a property, not a style
      } catch (e) {}
    }
    if (container.parentNode) container.parentNode.removeChild(container);
    floatingContainer = null;
    abLoop = { a: null, b: null, active: false };
    toggleWakeLock(false);
  };
  container.querySelector('#float-restore').onclick = restoreToPage;
  container.querySelector('#float-close').onclick = restoreToPage;

  setTimeout(() => {
    if (video.duration) timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    playBtn.textContent = video.paused ? '▶' : '⏸';
    if (Object.keys(sitePrefs).length > 0) {
      if (sitePrefs.speed) video.playbackRate = sitePrefs.speed;
      if (sitePrefs.volume !== undefined) { video.volume = sitePrefs.volume; volSlider.value = sitePrefs.volume; }
    }
  }, 280);
}

/* ---------- Message handling ---------- */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // v4.6: respect a manual pick instead of always re-running auto-detection.
  mainVideo = resolveMainVideo() || mainVideo;
  if (mainVideo) attachVideoHooks(mainVideo);

  switch (request.command) {
    case 'get_state':
      // FIX: always respond, even when no video, so the popup never
      // shows a stale/broken state.
      sendResponse({
        hasVideo: !!mainVideo,
        filters: currentFilters,
        quality: mainVideo ? detectQuality(mainVideo) : null,
        videoCount: document.querySelectorAll('video').length,
        volume: mainVideo ? mainVideo.volume : 1,
        speed: mainVideo ? mainVideo.playbackRate : 1,
        lucid: mainVideo ? lucidActive : false,
        eq: currentEQ,
        wakeLock: wakeLockWanted,
        overlay: overlayEnabled,
        focus: focusActive,
        loop: mainVideo ? !!mainVideo.loop : false,
        resumeTime: resumeKey ? (mainVideo && mainVideo.currentTime > 1 ? mainVideo.currentTime : 0) : 0,
        gallery: getGallery(),
        marks: marks.slice(),
        sleepRemaining: sleepTimerEnd ? Math.max(0, Math.round((sleepTimerEnd - Date.now()) / 60000)) : 0
      });
      return; // synchronous response, do not keep the port open

    case 'get_videos':
      // v4.6: the list is always returned, even when empty, so the popup's
      // Quality sort / filter controls are always rendered and usable.
      sendResponse({
        ok: true,
        videos: getVideoList(),
        mainId: mainVideo ? lucidVideoId(mainVideo) : null,
        qualitySort: true   // Quality sorting is always available
      });
      return;

    case 'select_video':
      sendResponse(selectVideoById(request.value));
      return;

    case 'toggle_overlay':
      setOverlayEnabled(!overlayEnabled);
      break;

    case 'set_overlay':
      setOverlayEnabled(request.value);
      break;

    case 'toggle_lucid':
      if (mainVideo) {
        const active = lucidActive;
        if (active) resetFilters(mainVideo); else applyCinematicPreset(mainVideo);
        showHUD('Lucid Mode', active ? 'Off' : 'On');
      }
      break;

    case 'trigger_pip':
      toggleFilteredPiP(mainVideo);
      break;

    case 'set_native_volume':
      if (mainVideo) mainVideo.volume = parseFloat(request.value);
      break;

    case 'set_playback_rate':
      if (mainVideo) mainVideo.playbackRate = parseFloat(request.value);
      break;

    case 'set_boost': {
      if (mainVideo) {
        if (!audioCtx) setupAudio(mainVideo);
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if (gainNode) gainNode.gain.value = parseFloat(request.value);
      }
      break;
    }

    case 'set_eq':
      if (mainVideo) applyEQPreset(request.value, mainVideo);
      break;

    case 'take_screenshot': {
      const result = captureScreenshot(mainVideo);
      sendResponse(result);
      return;
    }

    case 'float_video':
      if (mainVideo) createFloatingPlayer(mainVideo);
      break;

    case 'set_filters':
      if (mainVideo && request.value) applyFilters(mainVideo, request.value);
      break;

    case 'apply_cinematic_preset':
      if (mainVideo) applyCinematicPreset(mainVideo);
      break;

    case 'auto_tone':
      if (mainVideo) autoTone(mainVideo);
      break;

    case 'reset_filters':
      if (mainVideo) resetFilters(mainVideo);
      break;

    case 'toggle_wake_lock':
      // FIX: works even on pages without a video now
      toggleWakeLock(Boolean(request.value));
      showHUD('Wake Lock', request.value ? 'On' : 'Off');
      break;

    case 'set_sleep_timer':
      setSleepTimer(parseInt(request.value, 10) || 0);
      break;

    case 'save_site_prefs':
      saveSitePrefs();
      break;

    case 'get_marks':
      sendResponse({ ok: true, marks: marks.slice() });
      return;

    case 'add_mark': {
      const v = request.value || {};
      const result = addMark(v.label || '', v.note || '');
      sendResponse(result);
      return;
    }

    case 'delete_mark':
      sendResponse(deleteMark(request.value));
      return;

    case 'seek_to':
      sendResponse(seekTo(parseFloat(request.value)));
      return;

    case 'seek_by':
      sendResponse(seekBy(parseFloat(request.value)));
      return;

    case 'toggle_play':
      if (mainVideo) {
        if (mainVideo.paused) mainVideo.play().catch(() => {});
        else mainVideo.pause();
        showHUD(mainVideo.paused ? 'Paused' : 'Playing');
      }
      break;

    case 'set_loop':
      if (mainVideo) {
        mainVideo.loop = !!request.value;
        showHUD('Loop', mainVideo.loop ? 'On' : 'Off');
      }
      break;

    case 'set_focus':
      setFocusMode(!!request.value);
      break;

    case 'copy_frame':
      sendResponse(copyGalleryFrame(request.value));
      return;

    case 'export_settings':
      exportSettings().then((settings) => sendResponse({ ok: true, settings }));
      return true; // async sendResponse

    case 'import_settings':
      importSettings(request.value).then((result) => sendResponse(result));
      return true;
  }
});

/* ---------- Observe DOM for new videos ---------- */
// Debounced so heavy pages (SPA navigations, ad injections) don't trigger a
// full video scan on every single mutation.
let observerTimer = null;
const videoObserver = new MutationObserver(() => {
  if (observerTimer) return;
  observerTimer = setTimeout(() => {
    observerTimer = null;
    // v4.6: don't stomp on a video the user hand-picked from the list.
    const fresh = resolveMainVideo();
    if (fresh && fresh !== mainVideo) {
      mainVideo = fresh;
      attachVideoHooks(mainVideo);
      if (Object.keys(sitePrefs).length > 0) setTimeout(() => applySitePrefs(mainVideo), 120);
    }
  }, 300);
});
videoObserver.observe(document.documentElement || document.body, { childList: true, subtree: true, attributes: false });

/* ---------- Init ---------- */
(async function init() {
  await loadSitePrefs();
  await loadMarks();
  document.addEventListener('keydown', handleKeyboardShortcuts, true);
  setTimeout(() => {
    mainVideo = resolveMainVideo();
    if (mainVideo) {
      attachVideoHooks(mainVideo);
      if (Object.keys(sitePrefs).length > 0) applySitePrefs(mainVideo);
    }
    updateActionBadge(!!mainVideo);
  }, 650);
})();
