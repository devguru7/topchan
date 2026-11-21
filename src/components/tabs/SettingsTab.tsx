import React, { useEffect, useState } from 'react';
import {
  Archive,
  Bell,
  Bot,
  Chrome,
  Copy,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { GuestLang } from '../../types/ops';
import { generateGuestReplySmart } from '../../services/aiService';
import { getTashkentTodayIso } from '../../utils/time';
import {
  calcDefaultAccRate,
  calcDefaultExRate,
  calcMonthlyTouristTaxUzs,
  formatUzs,
} from '../../utils/math';

function triggerFileDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const SettingsTab: React.FC = () => {
  const {
    state,
    storageKind,
    executeTelegramAction,
    updateTelegramAlertDraft,
    addPhysicalRoom,
    archivePhysicalRoom,
    updateCategoryPrice,
    updateCurrencySettings,
    updateIntegrationSettings,
    setSidePanelOpen,
    resetDemoData,
    pushToast,
  } = useOps();

  // Room creation state
  const [newRoomCatId, setNewRoomCatId] = useState(state.roomCategories[0]?.id ?? 'cat-small');
  const [newRoomCode, setNewRoomCode] = useState('');

  // Currency form state
  const [accInput, setAccInput] = useState(String(state.currency.accRate));
  const [exInput, setExInput] = useState(String(state.currency.exRate));
  const [bcvInput, setBcvInput] = useState(String(state.currency.bcvUzs));

  // Integration form state
  const [bnovoAccount, setBnovoAccount] = useState(state.integrations.bnovoAccountId);
  const [yandexEmail, setYandexEmail] = useState(state.integrations.yandexEmail);
  const [tgChatId, setTgChatId] = useState(state.integrations.telegramChatId);
  const [wifiPass, setWifiPass] = useState(state.integrations.wifiPass);
  const [doorCode, setDoorCode] = useState(state.integrations.doorCode);

  useEffect(() => {
    setAccInput(String(state.currency.accRate));
    setExInput(String(state.currency.exRate));
    setBcvInput(String(state.currency.bcvUzs));
  }, [state.currency.accRate, state.currency.exRate, state.currency.bcvUzs]);

  useEffect(() => {
    setBnovoAccount(state.integrations.bnovoAccountId);
    setYandexEmail(state.integrations.yandexEmail);
    setTgChatId(state.integrations.telegramChatId);
    setWifiPass(state.integrations.wifiPass);
    setDoorCode(state.integrations.doorCode);
  }, [
    state.integrations.bnovoAccountId,
    state.integrations.yandexEmail,
    state.integrations.telegramChatId,
    state.integrations.wifiPass,
    state.integrations.doorCode,
  ]);

  const [showResolvedAlerts, setShowResolvedAlerts] = useState(false);
  const [draftLangByAlert, setDraftLangByAlert] = useState<Record<string, GuestLang>>({});
  const [draftingAlertId, setDraftingAlertId] = useState<string | null>(null);

  const visibleAlerts = showResolvedAlerts
    ? state.telegramAlerts
    : state.telegramAlerts.filter((a) => !a.resolved);

  const handleGenerateReply = async (alertId: string, title: string, body: string) => {
    const lang = draftLangByAlert[alertId] ?? 'ru';
    setDraftingAlertId(alertId);
    try {
      const res = await generateGuestReplySmart({
        guestMessage: `${title}. ${body}`,
        lang,
        wifiPass: state.integrations.wifiPass,
        doorCode: state.integrations.doorCode,
      });
      updateTelegramAlertDraft(alertId, res.reply);
      pushToast(
        'AI-черновик готов',
        `Язык ${lang.toUpperCase()} · ${res.engine === 'gemini' ? 'Gemini AI' : 'Локальный движок'}`,
        'cobalt'
      );
    } finally {
      setDraftingAlertId(null);
    }
  };

  const activePhysicalCount = state.physicalRooms.filter((r) => !r.archived).length;
  const monthlyTaxUzs = calcMonthlyTouristTaxUzs(
    state.bookings,
    state.currency.bcvUzs,
    activePhysicalCount
  );

  const handleAddRoom = (e: React.FormEvent) => {
    e.preventDefault();
    addPhysicalRoom(newRoomCatId, newRoomCode.trim() || undefined);
    setNewRoomCode('');
  };

  const handleSaveCurrency = (e: React.FormEvent) => {
    e.preventDefault();
    const acc = Math.max(1000, parseInt(accInput, 10) || state.currency.accRate);
    const ex = Math.max(1000, parseInt(exInput, 10) || state.currency.exRate);
    const bcv = Math.max(100000, parseInt(bcvInput, 10) || state.currency.bcvUzs);
    updateCurrencySettings({
      accRate: acc,
      accManualOverride: true,
      exRate: ex,
      exManualOverride: true,
      bcvUzs: bcv,
    });
  };

  const handleResetCurrencyAuto = () => {
    const autoAcc = calcDefaultAccRate(state.currency.cbuUsd);
    const autoEx = calcDefaultExRate(state.currency.cbuUsd);
    setAccInput(String(autoAcc));
    setExInput(String(autoEx));
    updateCurrencySettings({
      accRate: autoAcc,
      accManualOverride: false,
      exRate: autoEx,
      exManualOverride: false,
    });
  };

  const handleSaveIntegrations = (e: React.FormEvent) => {
    e.preventDefault();
    updateIntegrationSettings({
      bnovoAccountId: bnovoAccount.trim(),
      yandexEmail: yandexEmail.trim(),
      telegramChatId: tgChatId.trim(),
      wifiPass: wifiPass.trim(),
      doorCode: doorCode.trim(),
    });
  };

  const handleExportJson = () => {
    triggerFileDownload(
      `topchan-ops-backup-${getTashkentTodayIso()}.json`,
      JSON.stringify(state, null, 2),
      'application/json;charset=utf-8'
    );
    pushToast('Экспорт JSON выполнен', 'Полный снимок состояния скачан', 'emerald');
  };

  const handleExportCsv = () => {
    const headers = ['Дата', 'Карман', 'Направление', 'Сумма', 'Валюта', 'Описание', 'Сотрудник'];
    const rows = state.transactions.map((t) => [
      t.timestamp,
      t.pocketId,
      t.direction === 'in' ? 'Приход' : 'Расход',
      String(t.amount),
      t.currency,
      `"${t.label.replace(/"/g, '""')}"`,
      `"${t.actor.replace(/"/g, '""')}"`,
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    triggerFileDownload(
      `topchan-cash-ledger-${getTashkentTodayIso()}.csv`,
      csv,
      'text/csv;charset=utf-8'
    );
    pushToast('Экспорт CSV выполнен', `Выгружено ${state.transactions.length} кассовых операций`, 'emerald');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Telegram-бот, Автопилот и Настройки
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Интерактивная лента бота · редактор комнат и тарифов · курсы Acc/Ex и БРВ · аудит-лог и
            экспорт
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSidePanelOpen((v) => !v)}
            className="px-3.5 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-white border border-white/[0.08] inline-flex items-center gap-2"
          >
            <Chrome className="w-4 h-4 text-[#3B82F6]" />
            Мост Bnovo / E-mehmon
          </button>
          <button
            type="button"
            onClick={resetDemoData}
            className="px-3.5 py-2 rounded-lg bg-[#F43F5E]/15 hover:bg-[#F43F5E]/25 text-[#F43F5E] border border-[#F43F5E]/35 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Сбросить демо-данные
          </button>
        </div>
      </div>

      {/* Interactive Telegram Bot Feed */}
      <section className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-[#3B82F6]" />
            <h2 className="text-sm font-semibold text-white">
              Лента Telegram-бота Topchan Ops (активных:{' '}
              {state.telegramAlerts.filter((a) => !a.resolved).length})
            </h2>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showResolvedAlerts}
              onChange={(e) => setShowResolvedAlerts(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#3B82F6]"
            />
            Показать обработанные
          </label>
        </div>

        {visibleAlerts.length === 0 ? (
          <div className="p-6 rounded-xl bg-[#0B0F17] border border-white/[0.06] text-center text-xs text-slate-400">
            Все уведомления бота обработаны. Новые заявки из QR-консьержа и таймеров стирки
            появятся здесь мгновенно.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleAlerts.map((alert) => {
              const toneColor =
                alert.severity === 'danger'
                  ? 'text-[#F43F5E]'
                  : alert.severity === 'warning'
                    ? 'text-[#F59E0B]'
                    : alert.severity === 'success'
                      ? 'text-[#10B981]'
                      : 'text-[#3B82F6]';
              return (
                <div
                  key={alert.id}
                  className={`p-4 rounded-xl bg-[#0B0F17] border ${
                    alert.resolved ? 'border-white/[0.05] opacity-60' : 'border-white/[0.1]'
                  } space-y-3`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Bell className={`w-3.5 h-3.5 ${toneColor}`} />
                      <span className={`font-semibold ${toneColor}`}>{alert.source}</span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {alert.timestamp}
                      </span>
                    </div>
                    {alert.resolved && <span className="text-[#10B981]">Обработано</span>}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-white">{alert.title}</h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">{alert.body}</p>
                  </div>

                  {/* Multilingual AI Reply Drafter Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-1 p-0.5 bg-[#121826] border border-white/[0.08] rounded-lg">
                      {(['ru', 'en', 'uz', 'zh'] as GuestLang[]).map((lang) => {
                        const selected = (draftLangByAlert[alert.id] ?? 'ru') === lang;
                        return (
                          <button
                            key={lang}
                            type="button"
                            onClick={() =>
                              setDraftLangByAlert((prev) => ({ ...prev, [alert.id]: lang }))
                            }
                            className={`px-2 py-0.5 rounded-md text-xs font-mono uppercase transition-colors ${
                              selected
                                ? 'bg-[#3B82F6] text-white font-semibold'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {lang}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={draftingAlertId === alert.id}
                      onClick={() => handleGenerateReply(alert.id, alert.title, alert.body)}
                      className="px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-white border border-white/[0.08] inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {draftingAlertId === alert.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#3B82F6]" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
                      )}
                      AI-черновик ответа
                    </button>
                  </div>

                  {alert.draftReply && (
                    <div className="p-3 rounded-lg bg-[#121826] border border-white/[0.08] space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[#3B82F6]">
                          AI-черновик ответа гостю:
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(alert.draftReply ?? '').catch(() => {});
                            pushToast('Черновик скопирован', 'Можно вставить в чат с гостем', 'emerald');
                          }}
                          className="text-xs text-slate-300 hover:text-white inline-flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          Копировать
                        </button>
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">
                        {alert.draftReply}
                      </p>
                    </div>
                  )}

                  {!alert.resolved && alert.actions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {alert.actions.map((act, idx) => (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() => executeTelegramAction(alert.id, act.id)}
                          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                            idx === 0
                              ? 'bg-[#3B82F6] hover:bg-blue-500 text-white'
                              : 'bg-[#1A2234] hover:bg-slate-700 text-slate-200 border border-white/[0.08]'
                          }`}
                        >
                          {act.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Dynamic Room & Price Editor */}
      <section className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Динамический редактор комнат и тарифов (USD)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Активных комнат: {activePhysicalCount} (порог турсбора иностранцев:{' '}
              {activePhysicalCount <= 10 ? '5% БРВ = 22 000 сум' : '10% БРВ = 44 000 сум'})
            </p>
          </div>
        </div>

        {/* Add Physical Room Form */}
        <form
          onSubmit={handleAddRoom}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#0B0F17] p-4 rounded-xl border border-white/[0.08]"
        >
          <div>
            <label className="block text-xs text-slate-400 mb-1">Категория комнаты</label>
            <select
              value={newRoomCatId}
              onChange={(e) => setNewRoomCatId(e.target.value)}
              className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
            >
              {state.roomCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.isDorm ? 'Дорм 6 коек' : 'Приватная'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Название (необязательно, авто-номер)
            </label>
            <input
              type="text"
              value={newRoomCode}
              onChange={(e) => setNewRoomCode(e.target.value)}
              placeholder="Например: Small #6"
              className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full py-2 px-4 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Добавить физическую комнату
            </button>
          </div>
        </form>

        {/* Category Price Matrix */}
        <div className="overflow-x-auto border border-white/[0.08] rounded-xl bg-[#0B0F17]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.08] text-slate-400">
              <tr>
                <th className="py-2.5 px-3 font-medium">Категория</th>
                <th className="py-2.5 px-3 font-medium">Bnovo ID</th>
                <th className="py-2.5 px-3 font-medium">Тарифы USD (1 / 2 / 3 / 4 чел.)</th>
                <th className="py-2.5 px-3 font-medium text-right">Комнат</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {state.roomCategories.map((cat) => {
                const count = state.physicalRooms.filter(
                  (r) => r.categoryId === cat.id && !r.archived
                ).length;
                return (
                  <tr key={cat.id} className="hover:bg-[#1A2234]/50">
                    <td className="py-2.5 px-3 font-medium text-white whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-xs"
                          style={{ backgroundColor: cat.colorHex }}
                        />
                        {cat.name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-400">{cat.bnovoCategoryId}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {Object.entries(cat.pricesUsd).map(([occ, price]) => (
                          <label key={occ} className="inline-flex items-center gap-1 text-slate-400">
                            <span>{cat.isDorm ? 'Койка:' : `${occ}ч:`}</span>
                            <input
                              type="number"
                              min="1"
                              defaultValue={price}
                              onBlur={(e) => {
                                const val = parseFloat(e.target.value);
                                if (Number.isFinite(val) && val > 0 && val !== price) {
                                  updateCategoryPrice(cat.id, Number(occ), val);
                                }
                              }}
                              className="w-16 bg-[#121826] border border-white/[0.1] rounded-md px-2 py-1 font-mono tabular-nums text-white"
                            />
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white">
                      {count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Physical rooms quick archive toggles */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-400">
            Список физических комнат (архивация / возврат)
          </div>
          <div className="flex flex-wrap gap-2">
            {state.physicalRooms.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => archivePhysicalRoom(r.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 transition-colors ${
                  r.archived
                    ? 'bg-[#0B0F17] text-slate-500 border-white/[0.06] line-through'
                    : 'bg-[#0B0F17] hover:bg-[#1A2234] text-slate-200 border-white/[0.08]'
                }`}
              >
                <Archive className="w-3 h-3 text-slate-400" />
                {r.code}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Currency Acc/Ex & BCV + Integrations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Currency & Tax Settings */}
        <form
          onSubmit={handleSaveCurrency}
          className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-[#10B981]" />
              <h2 className="text-sm font-semibold text-white">Курсы валют (Acc / Ex) и БРВ</h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              ЦБ РУз ({state.currency.cbuStatus === 'live' ? 'Live' : 'Кэш'}):{' '}
              {state.currency.cbuUsd.toLocaleString('ru-RU')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Курс проживания (Acc)</label>
              <input
                type="number"
                value={accInput}
                onChange={(e) => setAccInput(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Курс сдачи (Ex)</label>
              <input
                type="number"
                value={exInput}
                onChange={(e) => setExInput(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">БРВ РУз 2026 (сум)</label>
              <input
                type="number"
                value={bcvInput}
                onChange={(e) => setBcvInput(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white"
              />
            </div>
          </div>

          <div className="text-xs text-slate-400 font-mono tabular-nums">
            Текущий расчёт турсбора за активный период: <strong className="text-white">{formatUzs(monthlyTaxUzs)}</strong>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              Сохранить курсы
            </button>
            <button
              type="button"
              onClick={handleResetCurrencyAuto}
              className="px-3.5 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-slate-200 border border-white/[0.08]"
            >
              Авто от ЦБ РУз
            </button>
          </div>
        </form>

        {/* Bnovo / Yandex IMAP / Hostel Codes */}
        <form
          onSubmit={handleSaveIntegrations}
          className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#3B82F6]" />
              <h2 className="text-sm font-semibold text-white">
                Bnovo API v1, Яндекс IMAP и коды доступа
              </h2>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-300">
              <Database className="w-3.5 h-3.5 text-[#10B981]" />
              {storageKind === 'supabase' ? 'Supabase Cloud' : 'LocalStorage (офлайн)'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Bnovo Account ID</label>
              <input
                type="text"
                value={bnovoAccount}
                onChange={(e) => setBnovoAccount(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Яндекс Почта (IMAP)</label>
              <input
                type="email"
                value={yandexEmail}
                onChange={(e) => setYandexEmail(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Telegram Chat ID</label>
              <input
                type="text"
                value={tgChatId}
                onChange={(e) => setTgChatId(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono text-xs text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Wi-Fi пароль</label>
                <input
                  type="text"
                  value={wifiPass}
                  onChange={(e) => setWifiPass(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-2.5 py-2 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Код двери</label>
                <input
                  type="text"
                  value={doorCode}
                  onChange={(e) => setDoorCode(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-2.5 py-2 font-mono text-xs text-white"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            Сохранить интеграции
          </button>
        </form>
      </div>

      {/* Audit Log & Export CSV / JSON */}
      <section className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Неизменяемый аудит-лог и экспорт данных
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Фиксация всех оплат, закрытий с долгом, инкассаций и правок тарифов
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-white border border-white/[0.08] inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4 text-[#10B981]" />
              Экспорт CSV
            </button>
            <button
              type="button"
              onClick={handleExportJson}
              className="px-3.5 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-white border border-white/[0.08] inline-flex items-center gap-1.5"
            >
              <FileJson className="w-4 h-4 text-[#3B82F6]" />
              Экспорт JSON
            </button>
            <Download className="w-4 h-4 text-slate-500 hidden sm:block" aria-hidden="true" />
          </div>
        </div>

        <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#0B0F17] overflow-hidden max-h-72 overflow-y-auto">
          {state.auditLog.map((entry) => (
            <div
              key={entry.id}
              className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-semibold text-white">
                  {entry.action} · <span className="font-normal text-slate-300">{entry.diff}</span>
                </div>
                <div className="text-slate-400 mt-0.5">
                  {entry.actor} · Причина: {entry.reason}
                </div>
              </div>
              <span className="font-mono tabular-nums text-slate-500 shrink-0">
                {entry.timestamp.slice(0, 16).replace('T', ' ')}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
