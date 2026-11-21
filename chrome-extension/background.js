// Topchan Ops Manifest V3 Service Worker
// Validates message origins strictly via URL hostname, relays captured guest drafts,
// and auto-wipes passport PII from chrome.storage.local 60s after E-mehmon fill.

const WIPE_ALARM_NAME = 'topchan_wipe_passport_pii';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {
    // Fallback for older Chromium builds
  });

function isAllowedHostUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'chrome-extension:' && parsed.hostname === chrome.runtime.id) {
      return true;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'bnovo.ru' ||
      host.endsWith('.bnovo.ru') ||
      host === 'emehmon.uz' ||
      host.endsWith('.emehmon.uz')
    );
  } catch {
    return false;
  }
}

function wipeCapturedGuest(callback) {
  chrome.alarms.clear(WIPE_ALARM_NAME).catch(() => {});
  chrome.storage.local.remove(['topchanCapturedGuest'], () => {
    if (typeof callback === 'function') callback();
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === WIPE_ALARM_NAME) {
    wipeCapturedGuest();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  const senderUrl = sender?.url || sender?.tab?.url || '';
  if (sender?.id !== chrome.runtime.id || (senderUrl && !isAllowedHostUrl(senderUrl))) {
    sendResponse({ ok: false, error: 'unauthorized_sender' });
    return false;
  }

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

  if (message.type === 'TOPCHAN_CLEAR_CAPTURED_GUEST') {
    wipeCapturedGuest(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'TOPCHAN_SCHEDULE_PII_WIPE') {
    const delayMinutes = 1; // 60 seconds
    chrome.alarms.create(WIPE_ALARM_NAME, { delayInMinutes: delayMinutes });
    sendResponse({ ok: true, wipeInSeconds: 60 });
    return true;
  }

  return false;
});
