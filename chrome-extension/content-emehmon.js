// Topchan Ops — E-mehmon.uz Content Script
// Autofills guest registration fields using native HTMLInputElement value setter + input/change events.

(function () {
  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;

  function setNativeValue(inputEl, value) {
    if (!inputEl || !value) return false;
    if (nativeInputSetter) {
      nativeInputSetter.call(inputEl, String(value));
    } else {
      inputEl.value = String(value);
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findInput(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLInputElement) return el;
    }
    return null;
  }

  function fillEmehmonForm(guest) {
    let filledCount = 0;

    const surnameEl = findInput([
      'input[name*="surname" i]',
      'input[name*="lastname" i]',
      'input[id*="surname" i]',
      'input[placeholder*="Фамилия" i]',
    ]);
    if (setNativeValue(surnameEl, guest.surname)) filledCount++;

    const givenEl = findInput([
      'input[name*="firstname" i]',
      'input[name*="given" i]',
      'input[name="name"]',
      'input[placeholder*="Имя" i]',
    ]);
    if (setNativeValue(givenEl, guest.givenName)) filledCount++;

    const passportEl = findInput([
      'input[name*="passport" i]',
      'input[id*="passport" i]',
      'input[placeholder*="Паспорт" i]',
    ]);
    if (setNativeValue(passportEl, guest.passportNo)) filledCount++;

    const dobEl = findInput([
      'input[name*="birth" i]',
      'input[name*="dob" i]',
      'input[id*="birth" i]',
    ]);
    if (setNativeValue(dobEl, guest.dob)) filledCount++;

    const checkInEl = findInput([
      'input[name*="checkin" i]',
      'input[name*="arrival" i]',
      'input[name*="date_from" i]',
    ]);
    if (setNativeValue(checkInEl, guest.checkInDate)) filledCount++;

    const checkOutEl = findInput([
      'input[name*="checkout" i]',
      'input[name*="departure" i]',
      'input[name*="date_to" i]',
    ]);
    if (setNativeValue(checkOutEl, guest.checkOutDate)) filledCount++;

    return filledCount;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'TOPCHAN_FILL_EMEHMON' && message.payload) {
      const filledCount = fillEmehmonForm(message.payload);
      sendResponse({ ok: true, filledCount });
      return true;
    }
    return false;
  });
})();
