/* LucidView v5.0 — background service worker
   Toolbar badge shows when a page has a target video. */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'lucid-badge') return;
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) return;

  const hasVideo = !!message.hasVideo;
  const quality = message.quality || '';
  const text = hasVideo ? (quality.length > 4 ? quality.slice(0, 4) : quality || '●') : '';

  try {
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: hasVideo ? '#ff2d55' : '#3f3f46'
    });
    chrome.action.setTitle({
      tabId,
      title: hasVideo ? `LucidView · ${quality || 'video ready'}` : 'LucidView Universal'
    });
  } catch (e) {}
  sendResponse({ ok: true });
});
