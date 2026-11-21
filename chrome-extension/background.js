// Topchan Ops Manifest V3 Service Worker
// Opens the side panel on extension icon click and relays messages between content scripts and the side panel.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {
    // Fallback for older Chromium builds
  });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'TOPCHAN_SAVE_CAPTURED_GUEST') {
    chrome.storage.local.set({ topchanCapturedGuest: message.payload }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'TOPCHAN_GET_CAPTURED_GUEST') {
    chrome.storage.local.get(['topchanCapturedGuest'], (res) => {
      sendResponse({ ok: true, payload: res.topchanCapturedGuest || null });
    });
    return true;
  }

  return false;
});
