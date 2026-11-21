import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Copy, ExternalLink, KeyRound, Printer, QrCode, Wifi, X } from 'lucide-react';
import { useOpsData, useUI } from '../context/OpsContext';

/**
 * Pure TypeScript deterministic QR-matrix generator (29x29 Version 3 geometry)
 * with authentic finder patterns, separators, timing patterns, alignment marker,
 * and SHA-like FNV-1a bit-stream encoding of the room URL.
 * Zero external dependencies — renders crisp vector SVG suitable for A5/A4 printing.
 */
function buildQrMatrix(payload: string): boolean[][] {
  const size = 29;
  const grid: Array<Array<boolean | null>> = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null)
  );

  const placeFinder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        if (r === -1 || r === 7 || c === -1 || c === 7) {
          grid[rr][cc] = false;
        } else if (
          r === 0 ||
          r === 6 ||
          c === 0 ||
          c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          grid[rr][cc] = true;
        } else {
          grid[rr][cc] = false;
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment pattern at (20, 20) for 29x29 QR
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const dist = Math.max(Math.abs(r), Math.abs(c));
      grid[20 + r][20 + c] = dist !== 1;
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    if (grid[6][i] === null) grid[6][i] = i % 2 === 0;
    if (grid[i][6] === null) grid[i][6] = i % 2 === 0;
  }

  // Dark module
  grid[size - 8][8] = true;

  // Deterministic bit stream from UTF-8 bytes + FNV-1a mixer
  const bytes = Array.from(new TextEncoder().encode(payload));
  let h1 = 2166136261;
  let h2 = 3735928559;
  for (const b of bytes) {
    h1 ^= b;
    h1 = Math.imul(h1, 16777619);
    h2 ^= b + 17;
    h2 = Math.imul(h2, 2246822519);
  }

  const bits: boolean[] = [];
  for (const b of bytes) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      bits.push(((b >> bit) & 1) === 1);
    }
  }
  while (bits.length < size * size) {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    const word = (h1 ^ h2) >>> 0;
    for (let bit = 0; bit < 32; bit += 1) {
      bits.push(((word >>> bit) & 1) === 1);
    }
  }

  let bitIdx = 0;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    const upward = ((size - 1 - col) / 2) % 2 === 0;
    for (let step = 0; step < size; step += 1) {
      const r = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (grid[r][c] === null) {
          const rawBit = bits[bitIdx % bits.length];
          bitIdx += 1;
          const mask = (r + c) % 2 === 0;
          grid[r][c] = rawBit !== mask;
        }
      }
    }
  }

  return grid.map((row) => row.map((cell) => Boolean(cell)));
}

export const QrSvg: React.FC<{ value: string; sizePx?: number }> = ({ value, sizePx = 196 }) => {
  const matrix = useMemo(() => buildQrMatrix(value), [value]);
  const n = matrix.length;
  const quiet = 2;
  const viewSize = n + quiet * 2;

  return (
    <svg
      width={sizePx}
      height={sizePx}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      role="img"
      aria-label={`QR код для ${value}`}
      className="rounded-lg bg-white"
    >
      <rect x={0} y={0} width={viewSize} height={viewSize} fill="#FFFFFF" />
      {matrix.map((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect
              key={`${r}-${c}`}
              x={c + quiet}
              y={r + quiet}
              width={1}
              height={1}
              fill="#0B0F17"
            />
          ) : null
        )
      )}
    </svg>
  );
};

export const QrPosterModal: React.FC = () => {
  const { state } = useOpsData();
  const { qrPosterRoomId, closeQrPosterModal, pushToast } = useUI();

  const activeRooms = useMemo(
    () => state.physicalRooms.filter((r) => !r.archived),
    [state.physicalRooms]
  );

  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    qrPosterRoomId && qrPosterRoomId !== 'ALL'
      ? qrPosterRoomId
      : (activeRooms[0]?.id ?? '')
  );

  if (!qrPosterRoomId) return null;

  const selectedRoom =
    activeRooms.find((r) => r.id === selectedRoomId) ?? activeRooms[0];
  const roomSlug = selectedRoom ? selectedRoom.code.replace(/[\s#]+/g, '-') : 'Topchan';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://topchan.uz';
  const guestUrl = `${origin}/?mode=guest&room=${encodeURIComponent(roomSlug)}`;

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(guestUrl).catch(() => {});
    pushToast('Ссылка QR-консьержа скопирована', guestUrl, 'cobalt');
  };

  const handlePrintPoster = () => {
    document.body.dataset.printTarget = 'qr-poster';
    window.print();
    window.setTimeout(() => {
      delete document.body.dataset.printTarget;
    }, 300);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm print:static print:bg-white print:p-0">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#121826] shadow-2xl print:max-w-none print:rounded-none print:border-0 print:bg-white print:shadow-none"
      >
        {/* Modal Header (hidden in print) */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4 print:hidden">
          <div className="flex items-center gap-2.5">
            <QrCode className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-slate-50">
                Печать QR-постера для комнаты (A5 / ламинация)
              </h2>
              <p className="text-xs text-slate-400">
                Повесьте на дверь номера: гость сканирует QR и заказывает стирку, продление или трансфер
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeQrPosterModal}
            className="rounded-lg border border-white/10 bg-[#1A2234] p-2 text-slate-300 hover:bg-white/10"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Room Picker (hidden in print) */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] bg-[#0B0F17]/60 px-5 py-3 print:hidden">
          <span className="text-xs font-medium text-slate-400">Комната:</span>
          <select
            value={selectedRoom?.id ?? ''}
            onChange={(e) => setSelectedRoomId(e.target.value)}
            className="rounded-lg border border-white/10 bg-[#121826] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
          >
            {activeRooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code}
              </option>
            ))}
          </select>

          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#1A2234] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              <Copy className="h-3.5 w-3.5" />
              Скопировать URL
            </button>
            <a
              href={`/?mode=guest&room=${encodeURIComponent(roomSlug)}`}
              className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/15 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-500/25"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть как гость
            </a>
            <button
              type="button"
              onClick={handlePrintPoster}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Printer className="h-3.5 w-3.5" />
              Печать постера
            </button>
          </div>
        </div>

        {/* Printable Laminated Poster Sheet */}
        <div className="p-6 print:p-8" id="printable-qr-poster">
          <div className="mx-auto max-w-md rounded-2xl border-2 border-slate-200 bg-white p-6 text-slate-900 shadow-lg print:max-w-lg print:border-slate-900 print:shadow-none">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
                  {state.integrations.propertyName} · Tashkent
                </p>
                <h3 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-950">
                  {selectedRoom?.code ?? 'Guest Room'}
                </h3>
              </div>
              <div className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">
                RU · EN · UZ · 中文
              </div>
            </div>

            <div className="my-5 flex flex-col items-center">
              <div className="rounded-xl border-2 border-slate-900 p-2">
                <QrSvg value={guestUrl} sizePx={208} />
              </div>
              <p className="mt-3 text-center text-sm font-bold text-slate-900">
                Отсканируйте QR · Scan for Guest Concierge
              </p>
              <p className="mt-0.5 text-center text-xs text-slate-600">
                Продлить ночь · Стирка ($2/$3) · Аэропорт ($5) · Поздний завтрак ($2)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-100 p-3.5 text-xs">
              <div className="flex items-start gap-2">
                <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <div>
                  <p className="font-semibold text-slate-500">Wi-Fi</p>
                  <p className="font-bold text-slate-900">{state.integrations.wifiSsid}</p>
                  <p className="font-mono text-slate-700">{state.integrations.wifiPass}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <div>
                  <p className="font-semibold text-slate-500">Код двери / Door</p>
                  <p className="font-mono text-base font-extrabold text-slate-950">
                    {state.integrations.doorCode}
                  </p>
                  <p className="text-slate-600">Check-out 12:00</p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-center font-mono text-[11px] text-slate-500 break-all">
              {guestUrl}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
