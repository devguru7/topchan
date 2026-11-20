import type {
  CurrencyCode,
  CurrencySettings,
  ParsedCommand,
  PhysicalRoom,
  RoomCategory,
} from '../types/ops';
import { calcChangeUzs, round2 } from './math';

export const COMMAND_PRESETS: string[] = [
  'Смолл 3, Алекс Ким, 2 ночи, дал $50, сдача сумами, быстрая стирка',
  'Йеллоу 2, Мария Соколова, 3 ночи, дал $100, сдача сумами, поздний завтрак',
  'Микс 5, Дэвид Ли, 1 ночь, дал $20, сдача сумами, средняя стирка',
];

const ROOM_ALIASES: Array<{ keywords: string[]; categoryMatch: string }> = [
  { keywords: ['смолл', 'смол', 'small', 'маленькая', 'малая'], categoryMatch: 'Small' },
  { keywords: ['йеллоу', 'желтая', 'жёлтая', 'yellow'], categoryMatch: 'Yellow' },
  { keywords: ['оранж', 'оранжевая', 'orange'], categoryMatch: 'Orange' },
  { keywords: ['пинк', 'розовая', 'pink'], categoryMatch: 'Pink' },
  { keywords: ['виолет', 'фиолетовая', 'violet'], categoryMatch: 'Violet' },
  { keywords: ['ред', 'красная', 'red'], categoryMatch: 'Red' },
  { keywords: ['грин', 'зеленая', 'зелёная', 'green'], categoryMatch: 'Green' },
  { keywords: ['блю', 'синяя', 'семейная', 'family', 'blue'], categoryMatch: 'Blue (Family)' },
  { keywords: ['микс', 'mix'], categoryMatch: 'Mix Dorm' },
  { keywords: ['фем', 'женский', 'женская', 'fem'], categoryMatch: 'Fem Dorm' },
];

export function parseRussianReceptionCommand(
  rawInput: string,
  rooms: PhysicalRoom[],
  categories: RoomCategory[],
  currency: CurrencySettings
): ParsedCommand {
  const raw = rawInput.trim();
  const lower = raw.toLowerCase();

  // 1. Identify room category & number
  let matchedCategory: RoomCategory | undefined;
  let roomNumber = 1;
  let matchedTokenEnd = -1;

  for (const alias of ROOM_ALIASES) {
    for (const kw of alias.keywords) {
      const regex = new RegExp(`(?:^|[\\s,])${kw}(?:\\s*#?(\\d+))?`, 'i');
      const m = lower.match(regex);
      if (m) {
        matchedCategory = categories.find(
          (c) => c.name.toLowerCase() === alias.categoryMatch.toLowerCase()
        );
        if (m[1]) {
          roomNumber = parseInt(m[1], 10);
        }
        matchedTokenEnd = (m.index ?? 0) + m[0].length;
        break;
      }
    }
    if (matchedCategory) break;
  }

  let matchedRoom: PhysicalRoom | undefined;
  let matchedBedId: string | undefined;

  if (matchedCategory) {
    const activeRoomsInCat = rooms.filter(
      (r) => r.categoryId === matchedCategory!.id && !r.archived
    );
    if (matchedCategory.isDorm) {
      matchedRoom = activeRoomsInCat[0];
      if (matchedRoom?.beds?.length) {
        const targetBed =
          matchedRoom.beds.find((b) => b.label === `#${roomNumber}`) ??
          matchedRoom.beds.find((b) => b.status === 'available') ??
          matchedRoom.beds[0];
        matchedBedId = targetBed?.id;
      }
    } else {
      matchedRoom =
        activeRoomsInCat.find((r) => r.number === roomNumber) ??
        activeRoomsInCat.find((r) => r.status === 'available') ??
        activeRoomsInCat[0];
    }
  } else {
    matchedRoom = rooms.find((r) => !r.archived && r.status === 'available') ?? rooms[0];
    matchedCategory = categories.find((c) => c.id === matchedRoom?.categoryId);
  }

  // 2. Parse nights
  const nightsMatch = lower.match(/(\d+)\s*(?:ноч|сут|night)/i);
  const nights = nightsMatch ? Math.max(1, parseInt(nightsMatch[1], 10)) : 1;

  // 3. Parse extras
  const extras: ParsedCommand['extras'] = [];
  if (/быстр\w*\s*стирк|стирк\w*\s*22/i.test(lower)) {
    extras.push({ type: 'laundry_fast', label: 'Быстрая стирка (22 мин)', priceUsd: 2 });
  } else if (/средн\w*\s*стирк|стирк\w*\s*55/i.test(lower)) {
    extras.push({ type: 'laundry_medium', label: 'Средняя стирка (55 мин)', priceUsd: 3 });
  } else if (/стирк/i.test(lower)) {
    extras.push({ type: 'laundry_fast', label: 'Быстрая стирка (22 мин)', priceUsd: 2 });
  }
  if (/поздн\w*\s*завтрак|завтрак/i.test(lower)) {
    extras.push({ type: 'late_breakfast', label: 'Поздний завтрак', priceUsd: 2 });
  }
  if (/ранн\w*\s*заезд|поздн\w*\s*выезд/i.test(lower)) {
    const rate = matchedCategory?.pricesUsd[1] ?? 18;
    extras.push({
      type: 'early_late',
      label: 'Ранний заезд / Поздний выезд (+50%)',
      priceUsd: round2(rate * 0.5),
    });
  }

  // 4. Parse payment amount & currency
  let paidCurrency: CurrencyCode = 'USD';
  let paidAmount = 0;

  const usdMatch =
    raw.match(/\$\s*(\d+(?:[.,]\d+)?)/i) ??
    raw.match(/(\d+(?:[.,]\d+)?)\s*(?:\$|долл|usd|бакс)/i);
  const eurMatch =
    raw.match(/€\s*(\d+(?:[.,]\d+)?)/i) ??
    raw.match(/(\d+(?:[.,]\d+)?)\s*(?:€|евро|eur)/i);
  const uzsMatch = raw.match(/(\d[\d\s]{2,})\s*(?:сум|uzs|тыс)/i);

  if (usdMatch) {
    paidCurrency = 'USD';
    paidAmount = parseFloat(usdMatch[1].replace(',', '.'));
  } else if (eurMatch) {
    paidCurrency = 'EUR';
    paidAmount = parseFloat(eurMatch[1].replace(',', '.'));
  } else if (uzsMatch) {
    paidCurrency = 'UZS';
    const numeric = parseFloat(uzsMatch[1].replace(/\s+/g, ''));
    paidAmount = /тыс/i.test(uzsMatch[0]) ? numeric * 1000 : numeric;
  }

  // 5. Parse change currency preference
  const changeCurrency: 'UZS' | 'USD' = /сдач\w*\s*(?:доллар|usd|\$)/i.test(lower)
    ? 'USD'
    : 'UZS';

  // 6. Extract guest name from comma-separated segments
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let guestName = 'Гость (Walk-in)';
  const skipPattern =
    /(смолл|смол|small|йеллоу|желт|жёлт|yellow|оранж|orange|пинк|розов|pink|виолет|фиолет|violet|ред|красн|red|грин|зелен|зелён|green|блю|син|семейн|blue|микс|mix|фем|женск|fem|\d+\s*(ноч|сут|night)|дал|оплат|сдач|стирк|завтрак|заезд|выезд|\$|€|сум|usd|uzs|eur)/i;

  for (const part of parts) {
    if (!skipPattern.test(part) && part.length >= 2) {
      guestName = part
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      break;
    }
  }
  if (guestName === 'Гость (Walk-in)' && matchedTokenEnd > 0 && parts.length === 1) {
    const remainder = raw.slice(matchedTokenEnd).trim();
    const cleaned = remainder.replace(/[\d$€.,]+.*$/, '').trim();
    if (cleaned.length >= 2 && !skipPattern.test(cleaned)) {
      guestName = cleaned;
    }
  }

  // 7. Financial calculations
  const nightlyRateUsd = matchedCategory?.pricesUsd[1] ?? 18;
  const stayUsd = round2(nightlyRateUsd * nights);
  const extrasUsd = round2(extras.reduce((s, e) => s + e.priceUsd, 0));
  const totalUsd = round2(stayUsd + extrasUsd);

  let paidUsdEquivalent = paidAmount;
  if (paidCurrency === 'UZS') {
    paidUsdEquivalent = currency.accRate > 0 ? round2(paidAmount / currency.accRate) : 0;
  } else if (paidCurrency === 'EUR') {
    const eurToUsd = currency.cbuUsd > 0 ? currency.cbuEur / currency.cbuUsd : 1.1;
    paidUsdEquivalent = round2(paidAmount * eurToUsd);
  }

  const diffUsd = round2(paidUsdEquivalent - totalUsd);
  const overpaidUsd = diffUsd > 0 ? diffUsd : 0;
  const debtUsd = diffUsd < 0 ? round2(Math.abs(diffUsd)) : 0;
  const changeUzs =
    overpaidUsd > 0 && changeCurrency === 'UZS'
      ? calcChangeUzs(overpaidUsd, currency.exRate)
      : 0;
  const changeUsd = overpaidUsd > 0 && changeCurrency === 'USD' ? overpaidUsd : 0;

  const bedObj = matchedRoom?.beds?.find((b) => b.id === matchedBedId);
  const roomLabel = matchedRoom
    ? bedObj
      ? `${matchedRoom.code} · Койка ${bedObj.label}`
      : matchedRoom.code
    : 'Не выбрана';

  const confidenceNote = matchedRoom
    ? `Распознано локально: ${roomLabel}, ${nights} н. × $${nightlyRateUsd}`
    : 'Выберите комнату вручную перед проведением';

  return {
    raw,
    roomId: matchedRoom?.id ?? null,
    roomLabel,
    bedId: matchedBedId,
    guestName,
    nights,
    nightlyRateUsd,
    paidCurrency,
    paidAmount,
    changeCurrency,
    extras,
    totalUsd,
    overpaidUsd,
    changeUzs,
    changeUsd,
    debtUsd,
    confidenceNote,
  };
}
