// Topchan Ops — E-mehmon.uz Content Script
// Autofills guest registration fields safely with tightened selectors (excluding login/username/search/filename)
// and includes a <select> citizenship matching helper.

(function () {
  const EXCLUDED_ATTR_RE = /(username|login|filename|search|email|password|captcha|token)/i;

  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;

  function isSafeEditableInput(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.disabled || el.readOnly) return false;
    const type = (el.type || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'password', 'search'].includes(type)) {
      return false;
    }
    const meta = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`;
    if (EXCLUDED_ATTR_RE.test(meta)) {
      return false;
    }
    return true;
  }

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
      const candidates = document.querySelectorAll(sel);
      for (const el of candidates) {
        if (isSafeEditableInput(el)) return el;
      }
    }
    return null;
  }

  function selectCitizenship(citizenshipValue) {
    const query = String(citizenshipValue || '').trim().toUpperCase();
    if (!query) return false;

    const selects = document.querySelectorAll(
      'select[name*="citizen" i], select[id*="citizen" i], select[name*="country" i], select[id*="country" i], select[name*="nationality" i]'
    );
    for (const selEl of selects) {
      if (!(selEl instanceof HTMLSelectElement) || selEl.disabled) continue;
      for (const opt of Array.from(selEl.options)) {
        const optVal = String(opt.value || '').trim().toUpperCase();
        const optText = String(opt.textContent || '').trim().toUpperCase();
        if (optVal === query || optText === query || optText.includes(query)) {
          selEl.value = opt.value;
          selEl.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }

    // Fallback to text input if E-mehmon uses searchable country input
    const countryInput = findInput([
      'input[name*="citizen" i]',
      'input[id*="citizen" i]',
      'input[name*="nationality" i]',
      'input[placeholder*="Гражданство" i]',
    ]);
    return setNativeValue(countryInput, query);
  }

  function fillEmehmonForm(guest) {
    let filledCount = 0;

    const surnameEl = findInput([
      'input[name="surname" i]',
      'input[name*="surname" i]',
      'input[name*="lastname" i]',
      'input[name*="last_name" i]',
      'input[id*="surname" i]',
      'input[placeholder*="Фамилия" i]',
    ]);
    if (setNativeValue(surnameEl, guest.surname)) filledCount++;

    const givenEl = findInput([
      'input[name="firstname" i]',
      'input[name*="firstname" i]',
      'input[name*="first_name" i]',
      'input[name*="given_name" i]',
      'input[id*="firstname" i]',
      'input[placeholder*="Имя" i]',
    ]);
    if (setNativeValue(givenEl, guest.givenName)) filledCount++;

    const passportEl = findInput([
      'input[name*="passport" i]',
      'input[id*="passport" i]',
      'input[name*="doc_number" i]',
      'input[placeholder*="Паспорт" i]',
    ]);
    if (setNativeValue(passportEl, guest.passportNo)) filledCount++;

    if (selectCitizenship(guest.citizenship)) filledCount++;

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
