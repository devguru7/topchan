// Topchan Ops — Bnovo PMS Content Script
// Reads active booking details (including form input .value and parsed check-in/out dates) safely from Bnovo DOM.

(function () {
  function readElementTextOrValue(el) {
    if (!el) return '';
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      return String(el.value || '').trim();
    }
    return String(el.textContent || '').trim();
  }

  function pickField(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const val = readElementTextOrValue(el);
      if (val) return val;
    }
    return '';
  }

  function normalizeDateToken(token) {
    if (!token) return '';
    // YYYY-MM-DD
    const iso = token.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // DD.MM.YYYY or DD/MM/YYYY
    const dmy = token.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return '';
  }

  function parseStayDates(raw) {
    if (!raw) return { checkInDate: '', checkOutDate: '' };
    const tokens = raw.match(/\d{4}[-/.]\d{2}[-/.]\d{2}|\d{2}[./-]\d{2}[./-]\d{4}/g) || [];
    const normalized = tokens.map(normalizeDateToken).filter(Boolean);
    return {
      checkInDate: normalized[0] || '',
      checkOutDate: normalized[1] || '',
    };
  }

  function scrapeBnovoBooking() {
    const guestName =
      pickField([
        '[data-testid="guest-name"]',
        '.booking-customer-name',
        '.customer-name',
        'input[name="customer_name"]',
        'input[name*="guest_name" i]',
        'h1',
      ]) || document.title;

    const bookingNumber = pickField([
      '[data-testid="booking-number"]',
      '.booking-number',
      '.booking-header__number',
      'input[name="booking_number"]',
    ]);

    const datesRaw = pickField([
      '[data-testid="booking-dates"]',
      '.booking-dates',
      '.stay-dates',
    ]);

    const explicitArrival = normalizeDateToken(
      pickField([
        'input[name*="arrival" i]',
        'input[name*="checkin" i]',
        'input[name*="date_from" i]',
      ])
    );
    const explicitDeparture = normalizeDateToken(
      pickField([
        'input[name*="departure" i]',
        'input[name*="checkout" i]',
        'input[name*="date_to" i]',
      ])
    );
    const parsedRange = parseStayDates(datesRaw);
    const checkInDate = explicitArrival || parsedRange.checkInDate;
    const checkOutDate = explicitDeparture || parsedRange.checkOutDate;

    const category = pickField([
      '[data-testid="room-category"]',
      '.booking-room-type',
      '.room-type-name',
    ]);

    const balanceRaw = pickField([
      '[data-testid="booking-balance"]',
      '.booking-balance',
      '.booking-total',
    ]);

    const passportNo = pickField([
      'input[name*="passport" i]',
      'input[placeholder*="паспорт" i]',
      '[data-testid="guest-passport"]',
    ]);

    const citizenship = pickField([
      'input[name*="citizen" i]',
      'select[name*="citizen" i]',
      'input[name*="country" i]',
      '[data-testid="guest-citizenship"]',
    ]);

    const dob = normalizeDateToken(
      pickField([
        'input[name*="birth" i]',
        'input[name*="dob" i]',
        '[data-testid="guest-dob"]',
      ])
    );

    const parts = guestName.replace(/\s+/g, ' ').trim().split(' ');
    const surname = parts[0] || '';
    const givenName = parts.slice(1).join(' ') || '';

    return {
      sourceUrl: window.location.href,
      capturedAt: new Date().toISOString(),
      bookingNumber: bookingNumber || 'BNV-ACTIVE',
      guestName: guestName.trim(),
      surname,
      givenName,
      passportNo,
      citizenship,
      dob,
      checkInDate,
      checkOutDate,
      datesRaw: datesRaw || (checkInDate && checkOutDate ? `${checkInDate} → ${checkOutDate}` : ''),
      category: category || 'Small',
      balanceRaw: balanceRaw || '$0',
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'TOPCHAN_SCRAPE_BNOVO') {
      const data = scrapeBnovoBooking();
      chrome.storage.local.set({ topchanCapturedGuest: data });
      sendResponse({ ok: true, payload: data });
      return true;
    }
    return false;
  });
})();
