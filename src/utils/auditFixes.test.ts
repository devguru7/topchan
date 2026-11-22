import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSeedState } from '../data/seed';
import { buildTouristTaxCsv, escapeCsvCell } from './exportReports';
import { calcBookingTouristTaxUzs, calcMonthlyTouristTaxUzs } from './math';
import { buildValidTd3Mrz, parseMrzDate, parseTd3Mrz, parseTd3MrzStrict, SAMPLE_MRZ_ITALY } from './mrz';
import { validateFemaleOnlyRoom } from '../store/handlers/bookingHandlers';
import { migrateAppState } from '../services/storageAdapter';
import { SupabaseNormalizedSync } from '../services/supabaseNormalizedAdapter';
import {
  findJunkFolderFromList,
  parseImapFetchBlocks,
  parseSafeEmailDate,
  unfoldMimeHeaders,
} from '../../server/mailWatcher';
import {
  buildEmehmonExportText,
  getLiveOpsSnapshot,
  handleTelegramWebhookUpdate,
  parseCallbackData,
  updateLiveOpsSnapshot,
} from '../../server/telegramBot';
import {
  asyncHandler,
  validateTelegramWebhookSecret,
  verifySupabaseJwt,
} from '../../server/index';

// ============================================================================
// BLOCK 1: FINANCE & TOURIST TAX CSV (Fixes 1, 2, 3)
// ============================================================================

test('AUDIT FIX 1 & 2: buildTouristTaxCsv does NOT double-count parallel multi-room nights, matches calcBookingTouristTaxUzs, and blocks CSV formula injection', () => {
  const state = createSeedState('2026-11-20');
  state.bookings = [
    {
      id: 'bkg-multi-room',
      propertyId: state.propertyId,
      bnovoId: 'BN-MULTI-01',
      status: 'active',
      checkOutTime: '12:00',
      checkingOutToday: false,
      source: 'Bnovo',
      createdAt: '2026-11-20T10:00:00Z',
      segments: [
        {
          id: 'seg-a',
          roomId: 'room-small-1',
          fromDate: '2026-11-20',
          toDate: '2026-11-23',
          nights: 3,
          nightlyRateUsd: 18,
        },
        {
          id: 'seg-b',
          roomId: 'room-small-2',
          fromDate: '2026-11-20',
          toDate: '2026-11-23',
          nights: 3,
          nightlyRateUsd: 18,
        },
      ],
      guests: [
        {
          id: 'g-formula',
          fullName: '=SUM(A1:A9)',
          citizenship: 'ITA',
          age: 30,
          passportNo: '+CMD|CALC',
          dob: '1996-01-10',
          sex: 'M',
          isForeigner: true,
          emehmonRegistered: true,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: true,
        },
      ],
      ledgerEntries: [],
    },
  ];

  const activePhysicalCount = state.physicalRooms.filter((r) => !r.archived).length;
  const expectedTax = calcBookingTouristTaxUzs(state.bookings[0], state.currency.bcvUzs, activePhysicalCount);
  assert.equal(expectedTax, 44000 * 3, '3 unique nights * 44,000 UZS = 132,000 UZS (NOT 6 nights)');

  const csv = buildTouristTaxCsv(state);
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  const guestRow = lines[1];
  const totalRow = lines[lines.length - 1];

  // Guest row must show 3 nights (not 6) and 132000 total
  assert.ok(guestRow.includes(',3,'), `Expected 3 nights in CSV row, got: ${guestRow}`);
  assert.ok(guestRow.includes(',132000,'), `Expected 132000 UZS in CSV row, got: ${guestRow}`);
  assert.ok(totalRow.includes(`,${expectedTax},`), `Grand total must equal calcBookingTouristTaxUzs (${expectedTax})`);
  assert.equal(expectedTax, calcMonthlyTouristTaxUzs(state.bookings, state.currency.bcvUzs, activePhysicalCount));

  // Formula injection protection: =, +, -, @, \t, \r must be prefixed with leading apostrophe
  assert.ok(guestRow.includes("'=SUM(A1:A9)"), 'Leading = must be neutralized with apostrophe');
  assert.ok(guestRow.includes("'+CMD|CALC"), 'Leading + must be neutralized with apostrophe');
  assert.equal(escapeCsvCell('=1+1'), "'=1+1");
  assert.equal(escapeCsvCell('+2+2'), "'+2+2");
  assert.equal(escapeCsvCell('-2+3'), "'-2+3");
  assert.equal(escapeCsvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(escapeCsvCell('\t=1'), "'\t=1");
  assert.equal(escapeCsvCell('\r=1'), `"\'\r=1"`);
});

test('AUDIT FIX 3: buildTouristTaxCsv labels future bookings as Ожидается заезд and >40 rooms bracket accurately', () => {
  const state = createSeedState('2026-11-20');
  // Expand physical rooms to 45 rooms (> 40 bracket)
  for (let i = 0; i < 25; i++) {
    state.physicalRooms.push({
      id: `room-extra-${i}`,
      propertyId: state.propertyId,
      categoryId: 'cat-small',
      code: `Extra-${i}`,
      number: 100 + i,
      status: 'available',
    });
  }
  state.bookings = [
    {
      id: 'bkg-future',
      propertyId: state.propertyId,
      bnovoId: 'BN-FUT-1',
      status: 'active',
      checkOutTime: '12:00',
      checkingOutToday: false,
      source: 'Bnovo',
      createdAt: '2026-11-20T10:00:00Z',
      segments: [
        {
          id: 'seg-fut',
          roomId: 'room-small-3',
          fromDate: '2026-11-25',
          toDate: '2026-11-27',
          nights: 2,
          nightlyRateUsd: 18,
        },
      ],
      guests: [
        {
          id: 'g-fut',
          fullName: 'Future Guest',
          citizenship: 'DEU',
          age: 29,
          passportNo: 'DE998877',
          dob: '1997-04-04',
          sex: 'F',
          isForeigner: true,
          emehmonRegistered: false,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: false,
        },
      ],
      ledgerEntries: [],
    },
  ];

  const csv = buildTouristTaxCsv(state);
  assert.ok(csv.includes('Ожидается заезд'), 'Future arrival must be labeled Ожидается заезд');
  assert.ok(csv.includes('10% (41+ комн.)'), 'Properties with >40 rooms must not be mislabeled 11–40 комн.');
  assert.equal(csv.includes('10% (11–40 комн.)'), false);
});

// ============================================================================
// BLOCK 2: BACKEND SECURITY, TELEGRAM & MAIL WATCHER (Fixes 4, 5, 6)
// ============================================================================

test('AUDIT FIX 4: verifySupabaseJwt validates HS256 & remote user API, webhook rejects unset secret in prod, and asyncHandler catches rejections', async () => {
  const secret = 'test-super-secret-jwt-key-32-chars!!';
  const signJwt = (payloadObj: Record<string, unknown>, sigSecret = secret) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const sig = crypto.createHmac('sha256', sigSecret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
  };

  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const validToken = signJwt({ sub: 'user-uuid-123', exp: futureExp });
  const expiredToken = signJwt({ sub: 'user-uuid-123', exp: Math.floor(Date.now() / 1000) - 60 });
  const badSigToken = signJwt({ sub: 'user-uuid-123', exp: futureExp }, 'wrong-secret');

  const okRes = await verifySupabaseJwt(validToken, { jwtSecret: secret });
  assert.deepEqual(okRes, { ok: true, userId: 'user-uuid-123' });

  const expRes = await verifySupabaseJwt(expiredToken, { jwtSecret: secret });
  assert.equal(expRes.ok, false);

  const badRes = await verifySupabaseJwt(badSigToken, { jwtSecret: secret });
  assert.equal(badRes.ok, false);

  // Remote /auth/v1/user path
  const mockFetch = (async () =>
    new Response(JSON.stringify({ id: 'remote-user-42' }), { status: 200 })) as unknown as typeof fetch;
  const remoteOk = await verifySupabaseJwt('supabase-session-token', {
    jwtSecret: '',
    supabaseUrl: 'https://demo.supabase.co',
    supabaseAnonKey: 'anon-key',
    fetchImpl: mockFetch,
  });
  assert.deepEqual(remoteOk, { ok: true, userId: 'remote-user-42' });

  // Telegram webhook secret guard in production
  const prodMissing = validateTelegramWebhookSecret({ isProd: true, expectedSecret: '', providedSecret: '' });
  assert.equal(prodMissing.ok, false);
  assert.equal(prodMissing.status, 503);

  const wrongSecret = validateTelegramWebhookSecret({
    isProd: true,
    expectedSecret: 'secret-123',
    providedSecret: 'wrong',
  });
  assert.equal(wrongSecret.ok, false);
  assert.equal(wrongSecret.status, 403);

  const rightSecret = validateTelegramWebhookSecret({
    isProd: true,
    expectedSecret: 'secret-123',
    providedSecret: 'secret-123',
  });
  assert.equal(rightSecret.ok, true);

  // asyncHandler catches rejected promises and forwards to next(err)
  let forwardedErr: unknown = null;
  const wrapped = asyncHandler(async () => {
    throw new Error('boom-async');
  });
  await new Promise<void>((resolve) => {
    wrapped({} as never, {} as never, (err?: unknown) => {
      forwardedErr = err;
      resolve();
    });
  });
  assert.ok(forwardedErr instanceof Error && forwardedErr.message === 'boom-async');
});

test('AUDIT FIX 5: Telegram parseCallbackData preserves colons in targetId and safe_confirm / emehmon_export execute real handlers', async () => {
  assert.deepEqual(parseCallbackData('hk_done:room-mix-dorm:mix-bed-4'), {
    action: 'hk_done',
    targetId: 'room-mix-dorm:mix-bed-4',
  });

  const prevAdminIds = process.env.TELEGRAM_ADMIN_IDS;
  process.env.TELEGRAM_ADMIN_IDS = '999001';
  try {
    updateLiveOpsSnapshot({
      pendingSafeCollections: [{ id: 'safe:col:1', summary: '$200 + 1 500 000 сум' }],
      confirmedSafeCollections: [],
      unregisteredEmehmon: [
        {
          bookingId: 'bkg:em:1',
          bnovoId: 'BN-777',
          guestName: 'Marco Rossi',
          passportNo: 'YA4829103',
          citizenship: 'ITA',
          dob: '1991-06-15',
          sex: 'M',
          fromDate: '2026-11-20',
          toDate: '2026-11-23',
          roomLabel: 'Yellow-1',
        },
      ],
    });

    const safeOutcome = await handleTelegramWebhookUpdate({
      callback_query: {
        id: 'cb-1',
        from: { id: 999001 },
        data: 'safe_confirm:safe:col:1',
      },
    });
    assert.equal(safeOutcome.ok, true);
    const snapAfterSafe = getLiveOpsSnapshot();
    assert.equal(snapAfterSafe.pendingSafeCollections.length, 0);
    assert.equal(snapAfterSafe.confirmedSafeCollections?.length, 1);
    assert.equal(snapAfterSafe.confirmedSafeCollections?.[0].id, 'safe:col:1');

    const emehmonOutcome = await handleTelegramWebhookUpdate({
      callback_query: {
        id: 'cb-2',
        from: { id: 999001 },
        data: 'emehmon_export:bkg:em:1',
      },
    });
    assert.equal(emehmonOutcome.ok, true);
    const exportText = buildEmehmonExportText('bkg:em:1');
    assert.ok(exportText.includes('Marco Rossi'));
    assert.ok(exportText.includes('YA4829103'));
    assert.ok(exportText.includes('ул. 8 Марта, 104'));
  } finally {
    if (prevAdminIds === undefined) delete process.env.TELEGRAM_ADMIN_IDS;
    else process.env.TELEGRAM_ADMIN_IDS = prevAdminIds;
  }
});

test('AUDIT FIX 6: mailWatcher does NOT crash on invalid Date:, unfolds multi-line MIME headers, finds \\Junk dynamically, and uses deterministic UIDs', () => {
  const fixedNow = new Date('2026-11-22T08:00:00.000Z');
  const badDate = parseSafeEmailDate('Definitely Not A Date 99/99/9999', fixedNow);
  assert.equal(badDate.valid, false);
  assert.equal(badDate.iso, '2026-11-22T08:00:00.000Z');

  const goodDate = parseSafeEmailDate('Fri, 20 Nov 2026 10:30:00 +0500', fixedNow);
  assert.equal(goodDate.valid, true);
  assert.equal(goodDate.iso, '2026-11-20T05:30:00.000Z');

  const folded = unfoldMimeHeaders('Subject: Airport\r\n   transfer\r\n\tfor 2 guests');
  assert.equal(folded, 'Subject: Airport transfer for 2 guests');

  const listResp = [
    '* LIST (\\HasNoChildren) "|" "INBOX"',
    '* LIST (\\HasNoChildren \\Sent) "|" "Sent"',
    '* LIST (\\HasNoChildren \\Junk) "|" "YandexJunkFolder"',
    'A2 OK LIST Completed',
  ].join('\r\n');
  assert.equal(findJunkFolderFromList(listResp), 'YandexJunkFolder');

  const rawFetch = [
    '* 1 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {120}',
    'From: traveler@example.com',
    'Subject: Airport transfer',
    '  needed at 03:00',
    'Date: INVALID-DATE-VALUE',
    ')',
    'A3 OK FETCH completed',
  ].join('\r\n');

  const parsed1 = parseImapFetchBlocks(rawFetch, 'Spam', fixedNow);
  const parsed2 = parseImapFetchBlocks(rawFetch, 'Spam', fixedNow);
  assert.equal(parsed1.length, 1);
  assert.equal(parsed1[0].subject, 'Airport transfer needed at 03:00');
  assert.equal(parsed1[0].category, 'transfer');
  assert.equal(parsed1[0].receivedAt, fixedNow.toISOString());
  assert.equal(parsed1[0].id, parsed2[0].id, 'Fallback UID must be deterministic, never Math.random()');
});

// ============================================================================
// BLOCK 3: MRZ PASSPORT PARSER (Fixes 7, 8)
// ============================================================================

test('AUDIT FIX 7 & 8: parseTd3Mrz enforces check digits by default, parseMrzDate rejects invalid dates, < stays X, and empty citizenship stays STATELESS', () => {
  // 1. Tampered check digit MUST be rejected by default parseTd3Mrz()
  const [l1, l2] = SAMPLE_MRZ_ITALY.split('\n');
  const badCd = String((Number(l2[9]) + 1) % 10);
  const tampered = `${l1}\n${l2.slice(0, 9)}${badCd}${l2.slice(10)}`;
  const strictDefault = parseTd3Mrz(tampered, 2026);
  assert.equal(strictDefault.valid, false, 'parseTd3Mrz must reject bad check digits by default');

  // 2. parseMrzDate rejects impossible months and non-existent calendar dates
  assert.equal(parseMrzDate('959915', false, 2026), null, 'Month 99 must be rejected');
  assert.equal(parseMrzDate('950231', false, 2026), null, 'Feb 31 must be rejected');
  assert.equal(parseMrzDate('950229', false, 2026), null, 'Feb 29 on non-leap year 1995 must be rejected');
  assert.equal(parseMrzDate('960229', false, 2026), '1996-02-29', 'Feb 29 on leap year 1996 is valid');

  // 3. MRZ with impossible DOB fails with explicit error (no silent 1990-01-01)
  const badDobMrz = buildValidTd3Mrz({
    issuingState: 'DEU',
    surname: 'MUELLER',
    givenName: 'HANS',
    passportNo: 'C12345678',
    nationality: 'DEU',
    dobYymmdd: '950231',
    sex: 'M',
    expiryYymmdd: '300615',
  });
  const badDobRes = parseTd3Mrz(badDobMrz, 2026);
  assert.equal(badDobRes.valid, false);
  assert.equal(badDobRes.dob, '');

  // 4. Unspecified sex '<' MUST return 'X' (not 'M'), and Fem Dorm guard blocks 'X'
  const unspecifiedSexMrz = buildValidTd3Mrz({
    issuingState: 'NLD',
    surname: 'DEVRIES',
    givenName: 'ALEX',
    passportNo: 'NL9876543',
    nationality: '', // stateless <<<
    dobYymmdd: '940512',
    sex: '<',
    expiryYymmdd: '310512',
  });
  const parsedUnspecified = parseTd3MrzStrict(unspecifiedSexMrz, { refYear: 2026 });
  assert.equal(parsedUnspecified.valid, true);
  assert.equal(parsedUnspecified.sex, 'X', 'MRZ sex "<" must not silently become "M"');
  assert.equal(parsedUnspecified.nationality, 'STATELESS', 'Empty nationality must not silently copy issuingState');
  assert.equal(parsedUnspecified.isStateless, true);

  const seed = createSeedState('2026-11-20');
  const femGuardErr = validateFemaleOnlyRoom(seed, 'room-fem-dorm', [
    { fullName: parsedUnspecified.fullName, sex: parsedUnspecified.sex },
  ]);
  assert.ok(femGuardErr && femGuardErr.includes('(пол не указан (X))'));
});

// ============================================================================
// BLOCK 4: SUPABASE REALTIME & OFFLINE QUEUE (Fixes 9, 10)
// ============================================================================

test('AUDIT FIX 9 & 10: SupabaseNormalizedSync preserves multiple audit_log inserts, supports DELETE, quarantines permanent 4xx, and reports honest realtimeConnected', async () => {
  const seed = createSeedState('2026-11-20');
  const calls: Array<{ url: string; method: string }> = [];

  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.includes('/rest/v1/booking_groups') && method === 'POST') {
      // Simulate permanent 403 RLS error
      return new Response('new row violates row-level security policy', { status: 403 });
    }
    if (url.includes('/rest/v1/stay_segments') && method === 'POST') {
      // Simulate transient 503 error
      return new Response('service unavailable', { status: 503 });
    }
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  const sync = new SupabaseNormalizedSync('https://example.supabase.co', 'anon-key', {
    fetchImpl: mockFetch,
    initialOnline: false,
  });

  // Realtime must start strictly false until WebSocket confirms SUBSCRIBED
  assert.equal(sync.getStatus().realtimeConnected, false);

  // Enqueue 3 separate audit_log batches while offline -> ALL 3 must remain (never deduplicated/lost!)
  sync.enqueueNormalizedSync(seed, ['audit_log']);
  sync.enqueueNormalizedSync(seed, ['audit_log']);
  sync.enqueueNormalizedSync(seed, ['audit_log']);
  assert.equal(
    sync.getQueue().filter((item) => item.table === 'audit_log').length,
    3,
    'Multiple audit_log insert entries must accumulate without overwriting each other'
  );

  // Enqueue upsert that will fail with permanent 403, upsert that will fail with transient 503, and a DELETE
  sync.enqueueNormalizedSync(seed, ['booking_groups', 'stay_segments']);
  sync.enqueueDelete('booking_groups', ['bkg-old-1', 'bkg-old-2'], seed.propertyId);

  sync.setOnlineStatus(true);
  const flushed = await sync.flushQueue();

  // 3 audit_log inserts + 1 DELETE succeeded = 4 flushed
  assert.equal(flushed, 4);
  assert.ok(
    calls.some((c) => c.method === 'DELETE' && c.url.includes('/rest/v1/booking_groups?id=in.(bkg-old-1,bkg-old-2)')),
    'DELETE operation must send HTTP DELETE with id=in.(...)'
  );

  // Permanent 403 on booking_groups must be quarantined in failedQueue (NOT left in retry queue)
  assert.equal(sync.getFailedQueue().length, 1);
  assert.equal(sync.getFailedQueue()[0].table, 'booking_groups');

  // Transient 503 on stay_segments stays in retry queue with attempts === 1
  assert.equal(sync.getQueue().length, 1);
  assert.equal(sync.getQueue()[0].table, 'stay_segments');
  assert.equal(sync.getQueue()[0].attempts, 1);

  sync.destroy();
});

// ============================================================================
// BLOCK 5: LEGACY LOCALSTORAGE MIGRATION SAFETY
// ============================================================================

test('AUDIT BLOCK 5: migrateAppState backfills missing legacy collections without crashing', () => {
  const seed = createSeedState('2026-11-20');
  const legacy = { ...seed } as Record<string, unknown>;
  delete legacy.luggageItems;
  delete legacy.shiftHistory;
  delete legacy.lostFoundItems;
  delete legacy.mailInbox;
  delete legacy.auditLog;
  delete legacy.transactions;

  const migrated = migrateAppState(legacy);
  assert.ok(migrated);
  assert.deepEqual(migrated.luggageItems, []);
  assert.deepEqual(migrated.shiftHistory, []);
  assert.deepEqual(migrated.lostFoundItems, []);
  assert.deepEqual(migrated.mailInbox, []);
  assert.deepEqual(migrated.auditLog, []);
  assert.deepEqual(migrated.transactions, []);
});
