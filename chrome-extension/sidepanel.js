// Topchan Ops Chrome Side Panel Controller
// Uses textContent exclusively (zero innerHTML) for safe DOM updates.

const els = {
  surname: document.getElementById('fSurname'),
  givenName: document.getElementById('fGivenName'),
  passportNo: document.getElementById('fPassport'),
  dob: document.getElementById('fDob'),
  checkInDate: document.getElementById('fCheckIn'),
  checkOutDate: document.getElementById('fCheckOut'),
  status: document.getElementById('statusBox'),
  btnScrape: document.getElementById('btnScrapeBnovo'),
  btnFill: document.getElementById('btnFillEmehmon'),
  btnSave: document.getElementById('btnSaveDraft'),
};

function setStatus(text, tone) {
  els.status.textContent = text;
  els.status.className = 'status' + (tone === 'ok' ? ' status-ok' : tone === 'warn' ? ' status-warn' : '');
}

function readForm() {
  return {
    surname: els.surname.value.trim(),
    givenName: els.givenName.value.trim(),
    passportNo: els.passportNo.value.trim(),
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
  if (guest.dob) els.dob.value = guest.dob;
  if (guest.checkInDate) els.checkInDate.value = guest.checkInDate;
  if (guest.checkOutDate) els.checkOutDate.value = guest.checkOutDate;
}

// Hydrate stored guest draft on panel load
chrome.runtime.sendMessage({ type: 'TOPCHAN_GET_CAPTURED_GUEST' }, (res) => {
  if (chrome.runtime.lastError) return;
  if (res && res.payload) {
    populateForm(res.payload);
    setStatus('Загружена последняя карточка гостя из памяти моста.', 'ok');
  }
});

els.btnSave.addEventListener('click', () => {
  const payload = readForm();
  chrome.runtime.sendMessage({ type: 'TOPCHAN_SAVE_CAPTURED_GUEST', payload }, () => {
    setStatus('Карточка сохранена. Откройте E-mehmon.uz и нажмите «Заполнить».', 'ok');
  });
});

els.btnScrape.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url || !tab.url.includes('bnovo.ru')) {
      setStatus('Перейдите на вкладку Bnovo (*.bnovo.ru), чтобы считать бронь.', 'warn');
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'TOPCHAN_SCRAPE_BNOVO' }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        setStatus('Не удалось прочитать страницу Bnovo. Обновите вкладку и повторите.', 'warn');
        return;
      }
      populateForm(res.payload);
      setStatus(`Считано из Bnovo: ${res.payload.guestName || 'Бронь'} (${res.payload.bookingNumber})`, 'ok');
    });
  } catch {
    setStatus('Ошибка доступа к активной вкладке Chrome.', 'warn');
  }
});

els.btnFill.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url || !tab.url.includes('emehmon.uz')) {
      setStatus('Откройте форму регистрации гостя на сайте emehmon.uz.', 'warn');
      return;
    }
    const payload = readForm();
    chrome.runtime.sendMessage({ type: 'TOPCHAN_SAVE_CAPTURED_GUEST', payload });
    chrome.tabs.sendMessage(tab.id, { type: 'TOPCHAN_FILL_EMEHMON', payload }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        setStatus('Не удалось заполнить форму E-mehmon. Обновите страницу и повторите.', 'warn');
        return;
      }
      setStatus(`Заполнено полей в E-mehmon: ${res.filledCount}. Проверьте и сохраните квиток.`, 'ok');
    });
  } catch {
    setStatus('Ошибка взаимодействия с вкладкой E-mehmon.', 'warn');
  }
});
