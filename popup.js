/* LucidView v5.0 — popup.js
   Adds: marks/bookmarks, frame gallery, focus mode, transport, speed chips,
   settings export/import, richer status, toasts. Keeps demo mode + detached window. */

/* ---------- v5.1 neumorphic slider painting ----------
   The gradient "capsule" fill is a background sized by --p (fill fraction);
   --tc colours the thumb so it reads as the rounded end-cap of the fill,
   sampled from the same teal→azure gradient the CSS paints. */
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
// One delegated listener covers every slider's user input; programmatic
// .value sets (below) get explicit lvPaintRange calls at each sync point.
document.addEventListener('input', (e) => {
    if (e.target && e.target.type === 'range') lvPaintRange(e.target);
}, true);

document.addEventListener('DOMContentLoaded', () => {
    const getEl = (id) => document.getElementById(id);
    const IS_EXTENSION = typeof chrome !== 'undefined' && !!(chrome.tabs && chrome.runtime && chrome.runtime.id);
    if (!IS_EXTENSION) document.body.classList.add('demo');

    /* ---------- Toast ---------- */
    let toastTimer = null;
    function toast(msg) {
        const el = getEl('toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
    }

    /* ---------- Tabs ---------- */
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panel = getEl(tab.dataset.panel);
            if (panel) panel.classList.add('active');
            if (tab.dataset.panel === 'panel-videos') fetchVideos();
            if (tab.dataset.panel === 'panel-marks') { fetchMarks(); renderGallery(); }
        });
    });

    function getActiveTab(callback) {
        if (!IS_EXTENSION) return;
        const urlParams = new URLSearchParams(window.location.search);
        const lockedTabId = urlParams.get('tabId');
        if (lockedTabId) {
            chrome.tabs.get(parseInt(lockedTabId, 10), (tab) => {
                if (!chrome.runtime.lastError && tab) callback(tab);
                else chrome.tabs.query({ active: true, windowType: 'normal' }, (tabs) => callback(tabs[0]));
            });
        } else {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const t = tabs && tabs[0];
                if (t && (!t.url || !t.url.includes(chrome.runtime.id))) callback(t);
                else chrome.tabs.query({ active: true, windowType: 'normal' }, (ts) => callback(ts[0]));
            });
        }
    }

    const send = (cmd, val = null, onResponse = null) => {
        if (!IS_EXTENSION) {
            if (onResponse) onResponse({ demo: true });
            return;
        }
        getActiveTab((tab) => {
            if (!tab || (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')))) return;
            chrome.tabs.sendMessage(tab.id, { command: cmd, value: val }, (res) => {
                const err = chrome.runtime.lastError;
                if (err) { console.log('LucidView: refresh the page if unresponsive.', err.message); return; }
                if (onResponse) onResponse(res);
            });
        });
    };

    let currentFilters = { contrast: 1, saturate: 1, vibrance: 0, brightness: 1, hue: 0 };
    let gallery = []; // [{id, dataUrl, time}]
    let focusActive = false;
    let loopActive = false;

    // Paint the initial gradient fills on every slider (incl. hidden panels).
    document.querySelectorAll('input[type=range]').forEach(lvPaintRange);

    /* ---------- State ---------- */
    function fetchState() {
        send('get_state', null, (response) => {
            if (!response || response.demo) return;

            const dot = getEl('status-dot');
            if (dot) {
                dot.classList.toggle('live', !!response.hasVideo);
                const q = response.quality && response.quality.label ? response.quality.label : '';
                dot.textContent = response.hasVideo
                    ? (q ? `Video · ${q}` : 'Video detected')
                    : 'No video';
                dot.title = response.hasVideo
                    ? (response.quality && response.quality.w ? `${response.quality.w}×${response.quality.h}` : 'Target video')
                    : 'No video on this page';
            }

            if (response.filters) updateUI(response.filters);

            if (response.volume !== undefined && getEl('volume-slider')) {
                getEl('volume-slider').value = response.volume;
                lvPaintRange(getEl('volume-slider'));
                getEl('volume-txt').innerText = Math.round(response.volume * 100) + '%';
            }
            if (response.speed !== undefined && getEl('speed-slider')) {
                getEl('speed-slider').value = response.speed;
                lvPaintRange(getEl('speed-slider'));
                getEl('speed-txt').innerText = Number(response.speed).toFixed(2) + '×';
                document.querySelectorAll('.speed-chip').forEach(c =>
                    c.classList.toggle('on', Math.abs(parseFloat(c.dataset.rate) - response.speed) < 0.05));
            }

            if (getEl('lucid-btn')) getEl('lucid-btn').classList.toggle('on', !!response.lucid);
            if (getEl('overlay-btn')) getEl('overlay-btn').classList.toggle('on', response.overlay !== false);
            if (getEl('focus-btn')) {
                focusActive = !!response.focus;
                getEl('focus-btn').classList.toggle('on', focusActive);
            }
            if (getEl('loop-btn')) {
                loopActive = !!response.loop;
                getEl('loop-btn').classList.toggle('on', loopActive);
            }
            if (getEl('wakelock-btn')) {
                getEl('wakelock-btn').classList.toggle('on', !!response.wakeLock);
            }

            if (response.eq) {
                document.querySelectorAll('.eq-chip').forEach(c =>
                    c.classList.toggle('on', c.dataset.eq === response.eq));
            }

            if (response.sleepRemaining !== undefined) {
                const hint = getEl('sleep-hint');
                if (response.sleepRemaining > 0 && hint) {
                    hint.textContent = `⏳ Pausing in ~${response.sleepRemaining} min.`;
                } else if (hint && !hint.textContent.includes('Pausing in')) {
                    hint.textContent = 'Auto-pauses the video when the timer ends.';
                }
            }

            // Session meta
            if (getEl('meta-status')) getEl('meta-status').textContent = response.hasVideo ? 'Ready' : 'Waiting';
            if (getEl('meta-quality')) {
                getEl('meta-quality').textContent = response.quality
                    ? (response.quality.w ? `${response.quality.label} · ${response.quality.w}×${response.quality.h}` : response.quality.label)
                    : '—';
            }
            if (getEl('meta-count')) getEl('meta-count').textContent = String(response.videoCount || 0);
            if (getEl('meta-resume')) {
                getEl('meta-resume').textContent = response.resumeTime
                    ? `Saved at ${fmtDuration(response.resumeTime)}`
                    : 'None yet';
            }

            if (Array.isArray(response.gallery)) {
                gallery = response.gallery.slice(-12);
                renderGallery();
            }
        });
    }
    fetchState();

    function fmtDuration(sec) {
        if (!sec || !isFinite(sec)) return '0:00';
        const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    /* ---------- Quick actions ---------- */
    if (getEl('lucid-btn')) getEl('lucid-btn').onclick = () => { send('toggle_lucid'); setTimeout(fetchState, 120); };
    if (getEl('pip-btn')) getEl('pip-btn').onclick = () => send('trigger_pip');
    if (getEl('float-btn')) getEl('float-btn').onclick = () => { send('float_video'); if (IS_EXTENSION) window.close(); };
    if (getEl('overlay-btn')) getEl('overlay-btn').onclick = () => { send('toggle_overlay'); setTimeout(fetchState, 120); };
    if (getEl('focus-btn')) getEl('focus-btn').onclick = () => {
        focusActive = !focusActive;
        send('set_focus', focusActive);
        getEl('focus-btn').classList.toggle('on', focusActive);
        toast(focusActive ? 'Focus mode on' : 'Focus mode off');
    };

    if (getEl('screenshot-btn')) {
        getEl('screenshot-btn').onclick = () => {
            const btn = getEl('screenshot-btn');
            const originalText = btn.innerHTML;
            send('take_screenshot', null, (res) => {
                if (res && res.ok) {
                    btn.innerHTML = '✓ Captured';
                    if (res.dataUrl) {
                        gallery = [...gallery, { id: res.id || String(Date.now()), dataUrl: res.dataUrl, time: res.time || 0 }].slice(-12);
                        renderGallery();
                    }
                } else {
                    btn.innerHTML = '✕ Blocked (CORS)';
                }
                setTimeout(() => { btn.innerHTML = originalText; }, 1400);
            });
            if (!IS_EXTENSION) {
                btn.innerHTML = '✓ Captured';
                setTimeout(() => { btn.innerHTML = originalText; }, 1200);
            }
        };
    }

    if (getEl('seek-back-btn')) getEl('seek-back-btn').onclick = () => { send('seek_by', -10); toast('−10s'); };
    if (getEl('seek-fwd-btn')) getEl('seek-fwd-btn').onclick = () => { send('seek_by', 10); toast('+10s'); };
    if (getEl('playpause-btn')) getEl('playpause-btn').onclick = () => send('toggle_play');

    if (getEl('loop-btn')) getEl('loop-btn').onclick = () => {
        loopActive = !loopActive;
        send('set_loop', loopActive);
        getEl('loop-btn').classList.toggle('on', loopActive);
    };

    /* ---------- Playback ---------- */
    if (getEl('volume-slider')) getEl('volume-slider').oninput = (e) => {
        getEl('volume-txt').innerText = Math.round(e.target.value * 100) + '%';
        send('set_native_volume', e.target.value);
    };
    if (getEl('speed-slider')) getEl('speed-slider').oninput = (e) => {
        getEl('speed-txt').innerText = parseFloat(e.target.value).toFixed(2) + '×';
        send('set_playback_rate', e.target.value);
        document.querySelectorAll('.speed-chip').forEach(c =>
            c.classList.toggle('on', Math.abs(parseFloat(c.dataset.rate) - parseFloat(e.target.value)) < 0.05));
    };
    document.querySelectorAll('.speed-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const rate = parseFloat(chip.dataset.rate);
            send('set_playback_rate', rate);
            if (getEl('speed-slider')) { getEl('speed-slider').value = rate; lvPaintRange(getEl('speed-slider')); }
            if (getEl('speed-txt')) getEl('speed-txt').innerText = rate.toFixed(2) + '×';
            document.querySelectorAll('.speed-chip').forEach(c => c.classList.toggle('on', c === chip));
            toast(`Speed ${rate}×`);
        });
    });

    /* ---------- Color grading ---------- */
    function updateUI(filters) {
        currentFilters = { ...currentFilters, ...filters };
        const map = [
            ['contrast-slider', 'contrast', v => v.toFixed(2)],
            ['saturation-slider', 'saturate', v => v.toFixed(2)],
            ['vibrance-slider', 'vibrance', v => v.toFixed(2)],
            ['brightness-slider', 'brightness', v => v.toFixed(2)],
            ['hue-slider', 'hue', v => v + '°']
        ];
        map.forEach(([sliderId, key, fmt]) => {
            const slider = getEl(sliderId);
            const txt = getEl(sliderId.replace('-slider', '-txt'));
            if (slider) { slider.value = currentFilters[key]; lvPaintRange(slider); }
            if (txt) txt.innerText = fmt(currentFilters[key]);
        });
    }

    function updateFilter(type, value) {
        currentFilters[type] = parseFloat(value);
        updateUI(currentFilters);
        send('set_filters', currentFilters);
    }

    [['contrast-slider', 'contrast'], ['saturation-slider', 'saturate'], ['vibrance-slider', 'vibrance'],
     ['brightness-slider', 'brightness'], ['hue-slider', 'hue']].forEach(([id, key]) => {
        if (getEl(id)) getEl(id).oninput = (e) => updateFilter(key, e.target.value);
    });

    function applyPreset(preset) {
        updateUI(preset);
        send('set_filters', preset);
        setTimeout(fetchState, 120);
    }

    if (getEl('cinematic-preset-btn')) getEl('cinematic-preset-btn').onclick = () => { send('apply_cinematic_preset'); setTimeout(fetchState, 120); };
    if (getEl('vivid-btn')) getEl('vivid-btn').onclick = () => applyPreset({ contrast: 1.10, saturate: 1.50, vibrance: 0.5, brightness: 1.05, hue: 0 });
    if (getEl('warm-btn')) getEl('warm-btn').onclick = () => applyPreset({ contrast: 1.15, saturate: 1.20, vibrance: 0.2, brightness: 1.00, hue: 5 });
    if (getEl('noir-btn')) getEl('noir-btn').onclick = () => applyPreset({ contrast: 1.35, saturate: 0, vibrance: 0, brightness: 0.98, hue: 0 });
    if (getEl('reset-filters-btn')) getEl('reset-filters-btn').onclick = () => { send('reset_filters'); setTimeout(fetchState, 120); };
    if (getEl('auto-tone-btn')) getEl('auto-tone-btn').onclick = () => { send('auto_tone'); setTimeout(fetchState, 120); };

    /* ---------- Audio ---------- */
    if (getEl('boost-slider')) getEl('boost-slider').oninput = (e) => {
        getEl('boost-txt').innerText = parseFloat(e.target.value).toFixed(1) + '×';
        send('set_boost', e.target.value);
    };
    document.querySelectorAll('.eq-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.eq-chip').forEach(c => c.classList.remove('on'));
            chip.classList.add('on');
            send('set_eq', chip.dataset.eq);
        });
    });

    /* ---------- Sleep timer ---------- */
    document.querySelectorAll('.sleep-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.sleep-chip').forEach(c => c.classList.remove('on-amber'));
            const mins = parseInt(chip.dataset.min, 10);
            if (mins > 0) chip.classList.add('on-amber');
            send('set_sleep_timer', mins);
            const hint = getEl('sleep-hint');
            if (hint) hint.textContent = mins > 0 ? `⏳ Pausing in ${mins} min.` : 'Auto-pauses the video when the timer ends.';
        });
    });

    /* ---------- Marks / bookmarks ---------- */
    function fetchMarks() {
        send('get_marks', null, (res) => {
            if (!res || !res.marks) {
                if (!IS_EXTENSION) {
                    renderMarks([
                        { id: 'd1', time: 42, label: 'Key idea', note: 'intro hook' },
                        { id: 'd2', time: 128, label: 'Example', note: 'demo starts' }
                    ]);
                }
                return;
            }
            renderMarks(res.marks);
        });
    }

    function renderMarks(marks) {
        const box = getEl('bm-list');
        if (!box) return;
        if (!marks || !marks.length) {
            box.innerHTML = `<div class="empty">No marks yet.<br>Play a video and hit <b>+ Mark</b> or <kbd>Alt + M</kbd>.</div>`;
            return;
        }
        box.innerHTML = marks.map(m => `
            <div class="bm-item" data-id="${m.id}">
                <span class="bm-time" data-seek="${m.time}">${fmtDuration(m.time)}</span>
                <div class="bm-body" data-seek="${m.time}">
                    <div class="bm-label">${escapeHtml(m.label || 'Untitled mark')}</div>
                    ${m.note ? `<div class="bm-note">${escapeHtml(m.note)}</div>` : ''}
                </div>
                <button class="bm-del" title="Delete">✕</button>
            </div>
        `).join('');

        box.querySelectorAll('[data-seek]').forEach(el => {
            el.onclick = () => {
                send('seek_to', parseFloat(el.dataset.seek));
                toast(`Jumped to ${fmtDuration(el.dataset.seek)}`);
            };
        });
        box.querySelectorAll('.bm-del').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const id = btn.closest('.bm-item').dataset.id;
                send('delete_mark', id, () => { fetchMarks(); toast('Mark deleted'); });
            };
        });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    if (getEl('bm-add-btn')) getEl('bm-add-btn').onclick = () => {
        const label = (getEl('bm-label') && getEl('bm-label').value.trim()) || '';
        send('add_mark', { label }, (res) => {
            if (getEl('bm-label')) getEl('bm-label').value = '';
            if (res && res.ok) { fetchMarks(); toast(`Marked ${fmtDuration(res.time)}`); }
            else toast('No video to mark');
        });
    };
    if (getEl('bm-label')) getEl('bm-label').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') getEl('bm-add-btn').click();
    });

    /* ---------- Gallery ---------- */
    function renderGallery() {
        const box = getEl('gallery-list');
        if (!box) return;
        if (!gallery.length) {
            box.innerHTML = `<div class="empty gallery-empty">No frames yet.<br>Hit <b>Screenshot</b> while a video plays.</div>`;
            return;
        }
        box.innerHTML = gallery.map(g => `
            <div class="gallery-item" data-id="${g.id}" title="Click to copy · ${fmtDuration(g.time)}">
                <img src="${g.dataUrl}" alt="Frame ${fmtDuration(g.time)}">
            </div>
        `).join('');
        box.querySelectorAll('.gallery-item').forEach(item => {
            item.onclick = () => {
                const g = gallery.find(x => x.id === item.dataset.id);
                if (!g) return;
                send('copy_frame', g.id);
                toast('Frame copied');
            };
        });
    }

    /* ---------- Videos tab ---------- */
    let videoList = [];
    let mainVideoId = null;

    const SORT_KEY = 'lucidVideoSort';
    const FILTER_KEY = 'lucidVideoFilter';
    const loadPref = (key, fallback) => {
        try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
    };
    const savePref = (key, val) => { try { localStorage.setItem(key, val); } catch (e) {} };

    let videoSort = loadPref(SORT_KEY, 'quality-desc');
    let videoFilter = parseInt(loadPref(FILTER_KEY, '0'), 10) || 0;

    const sortEl = getEl('video-sort');
    if (sortEl) {
        sortEl.value = videoSort;
        if (!sortEl.value) { sortEl.value = 'quality-desc'; videoSort = 'quality-desc'; }
        sortEl.onchange = () => {
            videoSort = sortEl.value || 'quality-desc';
            savePref(SORT_KEY, videoSort);
            renderVideos();
        };
    }

    document.querySelectorAll('.vfilter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.vfilter-chip').forEach(c => c.classList.remove('on'));
            chip.classList.add('on');
            videoFilter = parseInt(chip.dataset.min, 10) || 0;
            savePref(FILTER_KEY, String(videoFilter));
            renderVideos();
        });
    });
    document.querySelectorAll('.vfilter-chip').forEach(c => {
        c.classList.toggle('on', (parseInt(c.dataset.min, 10) || 0) === videoFilter);
    });

    function sortVideos(list) {
        const known = list.filter(v => v.rank > 0);
        const unknown = list.filter(v => v.rank === 0);
        const byQuality = (a, b) => (a.rank - b.rank) || (b.area - a.area);
        const cmp = {
            'quality-desc': (a, b) => byQuality(b, a),
            'quality-asc': byQuality,
            'size': (a, b) => (b.area - a.area),
            'playing': (a, b) => (b.playing - a.playing) || (b.rank - a.rank),
            'order': () => 0
        }[videoSort] || ((a, b) => byQuality(b, a));
        return known.slice().sort(cmp).concat(unknown);
    }

    function renderVideos() {
        const box = getEl('video-list');
        if (!box) return;
        const shown = sortVideos(videoList.filter(v => v.rank >= videoFilter));
        if (!videoList.length) {
            box.innerHTML = `<div class="empty">No video element on this page yet.<br>Open this tab again once the page has finished loading.</div>`;
            return;
        }
        if (!shown.length) {
            box.innerHTML = `<div class="empty">No video matches this quality filter.<br>Tap <b>All</b> to see every video again.</div>`;
            return;
        }
        box.innerHTML = shown.map(v => {
            const dims = v.w ? `${v.w}×${v.h}` : (v.known ? '' : 'resolution unknown');
            const state = [v.playing ? '▶ playing' : '⏸ paused'];
            if (v.onScreen) state.push('on screen');
            if (v.muted) state.push('muted');
            if (v.duration) state.push(fmtDuration(v.duration));
            return `<div class="video-item${v.id === mainVideoId ? ' active' : ''}" data-id="${v.id}">
                <span class="q-badge q-${v.rank}">${v.label}</span>
                <div class="vi-body">
                    <div class="vi-line1">${dims ? dims + ' · ' : ''}${v.hint}</div>
                    <div class="vi-line2">${state.join(' · ')}</div>
                </div>
                ${v.id === mainVideoId ? '<span class="vi-tag">TARGET</span>' : ''}
            </div>`;
        }).join('');
        box.querySelectorAll('.video-item').forEach(item => {
            item.onclick = () => {
                send('select_video', item.dataset.id, () => {
                    mainVideoId = item.dataset.id;
                    renderVideos();
                    setTimeout(fetchState, 120);
                });
            };
        });
    }

    function fetchVideos() {
        send('get_videos', null, (res) => {
            if (!res) return;
            videoList = res.videos || [];
            mainVideoId = res.mainId || null;
            renderVideos();
            if (videoList.some(v => v.rank === 0)) {
                setTimeout(() => {
                    send('get_videos', null, (r2) => {
                        if (!r2) return;
                        videoList = r2.videos || [];
                        mainVideoId = r2.mainId || null;
                        renderVideos();
                    });
                }, 900);
            }
        });
        if (!IS_EXTENSION) {
            videoList = [
                { id: 'demo1', label: '1080p', rank: 6, w: 1920, h: 1080, known: true, playing: true, muted: false, area: 900000, onScreen: true, duration: 372, hint: 'main-video.mp4' },
                { id: 'demo2', label: '720p', rank: 5, w: 1280, h: 720, known: true, playing: false, muted: true, area: 120000, onScreen: true, duration: 95, hint: 'ad-roll.mp4' },
                { id: 'demo3', label: 'Auto', rank: 0, w: 0, h: 0, known: false, playing: false, muted: false, area: 40000, onScreen: false, duration: 0, hint: 'media stream' }
            ];
            mainVideoId = 'demo1';
            renderVideos();
        }
    }
    if (getEl('video-refresh')) getEl('video-refresh').onclick = () => fetchVideos();
    fetchVideos();

    /* ---------- Session: wake / prefs / export ---------- */
    if (getEl('wakelock-btn')) getEl('wakelock-btn').onclick = () => {
        const btn = getEl('wakelock-btn');
        const next = !btn.classList.contains('on');
        btn.classList.toggle('on', next);
        send('toggle_wake_lock', next);
    };

    if (getEl('save-prefs-btn')) getEl('save-prefs-btn').onclick = () => {
        send('save_site_prefs');
        toast('Site prefs saved');
    };

    if (getEl('export-btn')) getEl('export-btn').onclick = () => {
        send('export_settings', null, (res) => {
            const data = (res && res.settings) || {
                exportedAt: new Date().toISOString(),
                filters: currentFilters,
                marks: [],
                sitePrefs: {}
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `lucidview-settings-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            toast('Settings exported');
        });
    };

    if (getEl('import-btn')) getEl('import-btn').onclick = () => getEl('import-file').click();
    if (getEl('import-file')) getEl('import-file').onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const settings = JSON.parse(reader.result);
                send('import_settings', settings, (res) => {
                    toast(res && res.ok ? 'Settings imported' : 'Import failed');
                    setTimeout(fetchState, 150);
                    fetchMarks();
                });
            } catch (err) {
                toast('Invalid JSON file');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    /* ---------- Detached window ---------- */
    const isDetached = new URLSearchParams(window.location.search).has('tabId');
    if (isDetached) document.body.classList.add('detached');

    const detachWindow = () => {
        if (!IS_EXTENSION) return;
        getActiveTab((tab) => {
            if (tab) {
                chrome.windows.create({
                    url: chrome.runtime.getURL(`popup.html?tabId=${tab.id}`),
                    type: 'popup',
                    width: 388,
                    height: 680,
                    focused: true
                });
                window.close();
            }
        });
    };
    if (getEl('detach-btn')) getEl('detach-btn').onclick = detachWindow;
    if (getEl('detach-header-btn')) getEl('detach-header-btn').onclick = detachWindow;

    if (isDetached && IS_EXTENSION) {
        setInterval(fetchState, 1500);
        setInterval(fetchVideos, 4000);
        setInterval(fetchMarks, 5000);
    }

    fetchMarks();
    renderGallery();
});
