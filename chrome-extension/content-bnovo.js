// Topchan Ops — Bnovo PMS Content Script
// Reads active booking details (guest name, dates, category, balance, booking number) safely from Bnovo DOM.

(function () {
  function pickText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    return '';
  }

  function scrapeBnovoBooking() {
    const guestName =
      pickText([
        '[data-testid="guest-name"]',
        '.booking-customer-name',
        '.customer-name',
        'input[name="customer_name"]',
        'h1',
      ]) || document.title;

    const bookingNumber = pickText([
      '[data-testid="booking-number"]',
      '.booking-number',
      '.booking-header__number',
    ]);

    const datesRaw = pickText([
      '[data-testid="booking-dates"]',
      '.booking-dates',
      '.stay-dates',
    ]);

    const category = pickText([
      '[data-testid="room-category"]',
      '.booking-room-type',
      '.room-type-name',
    ]);

    const balanceRaw = pickText([
      '[data-testid="booking-balance"]',
      '.booking-balance',
      '.booking-total',
    ]);

    const passportInput = document.querySelector(
      'input[name*="passport" i], input[placeholder*="паспорт" i]'
    );
    const passportNo =
      passportInput && 'value' in passportInput ? String(passportInput.value || '').trim() : '';

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
      datesRaw: datesRaw || 'Сегодня',
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
