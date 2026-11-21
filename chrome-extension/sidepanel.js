// Topchan Ops Chrome Side Panel Controller
// Uses textContent exclusively (zero innerHTML), validates hostnames via new URL(url).hostname,
// schedules automatic 60-second PII wipe after E-mehmon fill, and provides manual PII wipe.

const els = {
  surname: document.getElementById('fSurname'),
  givenName: document.getElementById('fGivenName'),
  passportNo: document.getElementById('fPassport'),
  citizenship: document.getElementById('fCitizenship'),
  dob: document.getElementById('fDob'),
  checkInDate: document.getElementById('fCheckIn'),
  checkOutDate: document.getElementById('fCheckOut'),
  status: document.getElementById('statusBox'),
  btnScrape: document.getElementById('btnScrapeBnovo'),
  btnFill: document.getElementById('btnFillEmehmon'),
  btnSave: document.getElementById('btnSaveDraft'),
  btnClearPii: document.getElementById('btnClearPii'),
};

function setStatus(text, tone) {
  els.status.textContent = text;
  els.status.className =
    'status' + (tone === 'ok' ? ' status-ok' : tone === 'warn' ? ' status-warn' : '');
}

function isAllowedHostname(rawUrl, expectedRootDomain) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === expectedRootDomain || host.endsWith('.' + expectedRootDomain);
  } catch {
    return false;
  }
}

function readForm() {
  return {
    surname: els.surname.value.trim(),
    givenName: els.givenName.value.trim(),
    passportNo: els.passportNo.value.trim(),
    citizenship: els.citizenship.value.trim().toUpperCase(),
    dob: els.dob.value.trim(),
    checkInDate: els.checkInDate.value.trim(),
    checkOutDate: els.checkOutDate.value.trim(),
  };
}

function populateForm(guest) {
  if (!guest) return;
  if (guest.surname) els.surname.value = guest.surname;
  if (guest.givenName) els.givenName.value = guest.givenName;
  if (guest.passportNo) els.passportNo.value = guest.passportNo;
  if (guest.citizenship) els.citizenship.value = guest.citizenship;
  if (guest.dob) els.dob.value = guest.dob;
  if (guest.checkInDate) els.checkInDate.value = guest.checkInDate;
  if (guest.checkOutDate) els.checkOutDate.value = guest.checkOutDate;
}

function clearFormFields() {
  els.surname.value = '';
  els.givenName.value = '';
  els.passportNo.value = '';
  els.citizenship.value = '';
  els.dob.value = '';
  els.checkInDate.value = '';
  els.checkOutDate.value = '';
}

// Hydrate stored guest draft on panel load
chrome.runtime.sendMessage({ type: 'TOPCHAN_GET_CAPTURED_GUEST' }, (res) => {
  if (chrome.runtime.lastError) return;
  if (res && res.payload) {
    populateForm(res.payload);
    setStatus('Загружена последняя карточка гостя из памяти моста.', 'ok');
  }
});

// React to background auto-wipe so visible fields clear immediately too
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.topchanCapturedGuest && !changes.topchanCapturedGuest.newValue) {
    clearFormFields();
    setStatus('Паспортные данные автоматически очищены из памяти расширения.', 'ok');
  }
});

els.btnSave.addEventListener('click', () => {
  const payload = readForm();
  chrome.runtime.sendMessage({ type: 'TOPCHAN_SAVE_CAPTURED_GUEST', payload }, () => {
    setStatus('Карточка сохранена. Откройте E-mehmon.uz и нажмите «Заполнить».', 'ok');
  });
});

els.btnClearPii.addEventListener('click', () => {
  clearFormFields();
  chrome.runtime.sendMessage({ type: 'TOPCHAN_CLEAR_CAPTURED_GUEST' }, () => {
    setStatus('Паспортные данные полностью удалены из памяти расширения.', 'ok');
  });
});

els.btnScrape.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !isAllowedHostname(tab.url, 'bnovo.ru')) {
      setStatus('Перейдите на защищённую вкладку Bnovo (https://*.bnovo.ru).', 'warn');
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'TOPCHAN_SCRAPE_BNOVO' }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        setStatus('Не удалось прочитать страницу Bnovo. Обновите вкладку и повторите.', 'warn');
        return;
      }
      populateForm(res.payload);
      setStatus(
        `Считано из Bnovo: ${res.payload.guestName || 'Бронь'} (${res.payload.bookingNumber})`,
        'ok'
      );
    });
  } catch {
    setStatus('Ошибка доступа к активной вкладке Chrome.', 'warn');
  }
});

els.btnFill.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !isAllowedHostname(tab.url, 'emehmon.uz')) {
      setStatus('Откройте форму регистрации гостя на https://*.emehmon.uz.', 'warn');
      return;
    }
    const payload = readForm();
    chrome.runtime.sendMessage({ type: 'TOPCHAN_SAVE_CAPTURED_GUEST', payload });
    chrome.tabs.sendMessage(tab.id, { type: 'TOPCHAN_FILL_EMEHMON', payload }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        setStatus('Не удалось заполнить форму E-mehmon. Обновите страницу и повторите.', 'warn');
        return;
      }
      chrome.runtime.sendMessage({ type: 'TOPCHAN_SCHEDULE_PII_WIPE' });
      setStatus(
        `Заполнено полей в E-mehmon: ${res.filledCount}. Паспортные данные автоматически очистятся через 60 сек.`,
        'ok'
      );
    });
  } catch {
    setStatus('Ошибка взаимодействия с вкладкой E-mehmon.', 'warn');
  }
});
