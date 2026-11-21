import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BedDouble,
  Bot,
  Check,
  Chrome,
  Coins,
  Database,
  FileJson,
  FileSpreadsheet,
  History,
  Loader2,
  Mail,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { SettingsSubTab } from '../../context/UIContext';
import type { GuestLang } from '../../types/ops';
import { generateGuestReplySmart } from '../../services/aiService';
import { getTashkentTodayIso } from '../../utils/time';
import { getTopchanRoomColor } from '../../utils/roomColors';
import {
  calcDefaultAccRate,
  calcDefaultExRate,
  calcMonthlyTouristTaxUzs,
  formatUzs,
} from '../../utils/math';
import { CopyButton, EmptyState, SegmentedControl, StatusPill, TooltipHint } from '../ui';

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
    settingsSubTab,
    setSettingsSubTab,
    executeTelegramAction,
    updateTelegramAlertDraft,
    addPhysicalRoom,
    archivePhysicalRoom,
    updateCategoryPrice,
    updateCurrencySettings,
    updateIntegrationSettings,
    dismissMailInquiry,
    syncMailInbox,
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
  const [syncingMail, setSyncingMail] = useState(false);

  const unresolvedAlertsCount = state.telegramAlerts.filter((a) => !a.resolved).length;
  const activeMailItems = (state.mailInbox ?? []).filter((m) => !m.handled);
  const visibleAlerts = showResolvedAlerts
    ? state.telegramAlerts
    : state.telegramAlerts.filter((a) => !a.resolved);

  const subTabOptions = useMemo<
    Array<{
      id: SettingsSubTab;
      label: string;
      icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
      badge?: number;
    }>
  >(
    () => [
      { id: 'telegram', label: 'Лента Telegram', icon: Bot, badge: unresolvedAlertsCount },
      { id: 'currency', label: 'Курсы и БРВ', icon: Coins },
      { id: 'rooms', label: 'Комнаты и прайс', icon: BedDouble },
      { id: 'integrations', label: 'Интеграции', icon: Shield },
      { id: 'audit', label: 'Журнал аудита', icon: History },
    ],
    [unresolvedAlertsCount]
  );

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
        'Черновик ответа готов',
        `Язык ${lang.toUpperCase()} · ${res.engine === 'gemini' ? 'Адаптивный шаблон' : 'Стандарт Topchan'}`,
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
    pushToast(
      'Экспорт CSV выполнен',
      `Выгружено ${state.transactions.length} кассовых операций`,
      'emerald'
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Telegram-бот и Настройки
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-0.5">
            Входящие заявки гостей, курсы Acc/Ex и БРВ, управление комнатами, интеграции и аудит
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSidePanelOpen((v) => !v)}
            className="px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] inline-flex items-center gap-2 transition-colors"
          >
            <Chrome
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-cobalt-fg)' }}
            />
            Мост Bnovo / E-mehmon
          </button>
        </div>
      </div>

      {/* Sub-Tab Switcher */}
      <SegmentedControl
        options={subTabOptions}
        value={settingsSubTab}
        onChange={setSettingsSubTab}
        layoutId="settingsSubTab"
        ariaLabel="Разделы настроек"
      />

      {/* SUB-TAB 1: Authentic Telegram Chat Feed */}
      {settingsSubTab === 'telegram' && (
        <section className="ops-card overflow-hidden">
          {/* Chat Window Header */}
          <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-white text-xs"
                style={{ backgroundColor: '#2563EB' }}
              >
                <Bot className="w-5 h-5" strokeWidth={1.75} />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  Topchan Ops Bot
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  Активных заявок: <span className="font-mono tabular-nums">{unresolvedAlertsCount}</span> ·
                  Чат <span className="font-mono">{state.integrations.telegramChatId}</span>
                </div>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={showResolvedAlerts}
                onChange={(e) => setShowResolvedAlerts(e.target.checked)}
                className="w-4 h-4 accent-[#2563EB]"
              />
              Показать обработанные
            </label>
          </div>

          {/* Chat Message Stream */}
          <div className="p-5 space-y-4">
            {visibleAlerts.length === 0 ? (
              <EmptyState
                icon={Bot}
                title="Входящих заявок нет"
                description="Все уведомления бота обработаны. Новые запросы из гостевого QR-гида и таймеров стирки появятся здесь мгновенно."
              />
            ) : (
              visibleAlerts.map((alert) => {
                const severityTone =
                  alert.severity === 'danger'
                    ? 'rose'
                    : alert.severity === 'warning'
                      ? 'amber'
                      : alert.severity === 'success'
                        ? 'emerald'
                        : 'cobalt';

                return (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 ${alert.resolved ? 'opacity-65' : ''}`}
                  >
                    {/* Bot Message Avatar */}
                    <div
                      className="w-8 h-8 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-center shrink-0 mt-0.5"
                      style={{ color: 'var(--tone-cobalt-fg)' }}
                    >
                      <Bot className="w-4 h-4" strokeWidth={1.75} />
                    </div>

                    {/* Chat Bubble */}
                    <div className="flex-1 min-w-0 max-w-3xl space-y-2">
                      <div className="rounded-2xl rounded-tl-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <StatusPill tone={severityTone}>{alert.source}</StatusPill>
                            <span className="font-mono tabular-nums text-[var(--text-muted)]">
                              {alert.timestamp}
                            </span>
                          </div>
                          {alert.resolved && <StatusPill tone="emerald">Обработано</StatusPill>}
                        </div>

                        <div>
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                            {alert.title}
                          </h3>
                          <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                            {alert.body}
                          </p>
                        </div>

                        {/* Multilingual AI Reply Drafter Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
                          <div className="flex items-center gap-1 p-0.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl">
                            {(['ru', 'en', 'uz', 'zh'] as GuestLang[]).map((lang) => {
                              const selected = (draftLangByAlert[alert.id] ?? 'ru') === lang;
                              return (
                                <button
                                  key={lang}
                                  type="button"
                                  onClick={() =>
                                    setDraftLangByAlert((prev) => ({ ...prev, [alert.id]: lang }))
                                  }
                                  className={`px-2.5 py-1 rounded-lg text-xs font-mono uppercase transition-colors ${
                                    selected
                                      ? 'bg-[#2563EB] text-white font-semibold'
                                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                  }`}
                                >
                                  {lang === 'zh' ? '中文' : lang}
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            disabled={draftingAlertId === alert.id}
                            onClick={() => handleGenerateReply(alert.id, alert.title, alert.body)}
                            className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                          >
                            {draftingAlertId === alert.id ? (
                              <Loader2
                                className="w-3.5 h-3.5 animate-spin"
                                strokeWidth={1.75}
                                style={{ color: 'var(--tone-cobalt-fg)' }}
                              />
                            ) : (
                              <MessageSquareText
                                className="w-3.5 h-3.5"
                                strokeWidth={1.75}
                                style={{ color: 'var(--brand-primary)' }}
                              />
                            )}
                            Черновик ответа гостю
                          </button>
                        </div>

                        {alert.draftReply && (
                          <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="text-xs font-semibold"
                                style={{ color: 'var(--tone-cobalt-fg)' }}
                              >
                                Готовый ответ гостю:
                              </span>
                              <CopyButton
                                text={alert.draftReply}
                                label="Скопировать"
                                size="sm"
                                variant="ghost"
                                onCopied={() =>
                                  pushToast(
                                    'Черновик скопирован',
                                    'Можно вставить в чат с гостем',
                                    'emerald'
                                  )
                                }
                              />
                            </div>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
                              {alert.draftReply}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Telegram Inline Keyboard Action Buttons */}
                      {!alert.resolved && alert.actions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          {alert.actions.map((act, idx) => (
                            <button
                              key={act.id}
                              type="button"
                              onClick={() => executeTelegramAction(alert.id, act.id)}
                              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                                idx === 0
                                  ? 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white'
                                  : 'bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
                              }`}
                            >
                              {act.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Yandex Mail IMAP Controller (INBOX + Spam) */}
          <div className="border-t border-[var(--border-strong)]">
            <div className="px-5 py-3.5 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: 'var(--brand-primary-soft)',
                    color: 'var(--brand-primary)',
                  }}
                >
                  <Mail className="w-4 h-4" strokeWidth={1.75} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    Яндекс Почта (INBOX + Спам)
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono">
                    {state.integrations.yandexEmail} · неразобранных: {activeMailItems.length}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={syncingMail}
                onClick={async () => {
                  setSyncingMail(true);
                  try {
                    await syncMailInbox();
                  } finally {
                    setSyncingMail(false);
                  }
                }}
                className="px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingMail ? 'animate-spin' : ''}`}
                  strokeWidth={1.75}
                />
                Проверить почту
              </button>
            </div>

            <div className="p-5 space-y-3">
              {activeMailItems.length === 0 ? (
                <EmptyState
                  icon={Mail}
                  title="Новых писем от гостей нет"
                  description="IMAP-контроллер отслеживает INBOX и папку Спам на предмет заявок на бронь и трансфер."
                />
              ) : (
                activeMailItems.map((mail) => (
                  <div
                    key={mail.id}
                    className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <StatusPill tone={mail.folder === 'Spam' ? 'rose' : 'cobalt'}>
                            {mail.folder === 'Spam' ? 'Спам (выловлено!)' : 'INBOX'}
                          </StatusPill>
                          <StatusPill tone="amber">{mail.category}</StatusPill>
                          <span className="font-mono text-[var(--text-muted)]">
                            {mail.receivedAt.slice(0, 16).replace('T', ' ')}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] mt-1.5">
                          {mail.subject}
                        </h3>
                        <div className="text-xs text-[var(--text-muted)] font-mono">
                          От: {mail.from}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => dismissMailInquiry(mail.id)}
                        className="px-3 py-1.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" strokeWidth={2} />
                        Обработано
                      </button>
                    </div>

                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      {mail.snippet}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
                      <CopyButton
                        text={mail.draftReplyRu}
                        label="Скопировать ответ (RU)"
                        size="sm"
                        variant="ghost"
                        onCopied={() =>
                          pushToast('Ответ (RU) скопирован', mail.from, 'emerald')
                        }
                      />
                      <CopyButton
                        text={mail.draftReplyEn}
                        label="Copy reply (EN)"
                        size="sm"
                        variant="ghost"
                        onCopied={() =>
                          pushToast('Reply (EN) copied', mail.from, 'emerald')
                        }
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* SUB-TAB 2: Currency & BCV (БРВ) */}
      {settingsSubTab === 'currency' && (
        <form onSubmit={handleSaveCurrency} className="ops-card p-5 space-y-5 max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Coins
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--tone-emerald-fg)' }}
              />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Курсы валют (Acc / Ex) и БРВ РУз
              </h2>
            </div>
            <StatusPill tone={state.currency.cbuStatus === 'live' ? 'emerald' : 'neutral'} mono>
              ЦБ РУз ({state.currency.cbuStatus === 'live' ? 'Онлайн' : 'Кэш'}):{' '}
              {state.currency.cbuUsd.toLocaleString('ru-RU')}
            </StatusPill>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                <span>Курс проживания (Acc)</span>
                <TooltipHint
                  title="Курс проживания (Acc)"
                  text="Используется для пересчёта стоимости ночи из долларов в сумы. Сумма округляется вверх до 1 000 сум."
                  align="left"
                />
              </label>
              <input
                type="number"
                value={accInput}
                onChange={(e) => setAccInput(e.target.value)}
                className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                <span>Курс сдачи (Ex)</span>
                <TooltipHint
                  title="Курс сдачи (Ex)"
                  text="Используется при выдаче сдачи сумами с долларов или евро. Сумма округляется вниз до 1 000 сум."
                  align="center"
                />
              </label>
              <input
                type="number"
                value={exInput}
                onChange={(e) => setExInput(e.target.value)}
                className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                <span>БРВ РУз (сум)</span>
                <TooltipHint
                  title="Базовая расчётная величина (БРВ)"
                  text="От БРВ рассчитывается обязательный туристический сбор РУз (5% до 10 номеров, 10% от 11 до 40 номеров для иностранцев; 0.4% для граждан РУз)."
                  align="right"
                />
              </label>
              <input
                type="number"
                value={bcvInput}
                onChange={(e) => setBcvInput(e.target.value)}
                className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-[var(--text-secondary)]">
              Текущий расчёт турсбора за активный период ({activePhysicalCount} комн. ·{' '}
              {activePhysicalCount <= 10 ? '5%' : '10%'} БРВ):
            </span>
            <strong
              className="font-mono tabular-nums text-sm"
              style={{ color: 'var(--tone-emerald-fg)' }}
            >
              {formatUzs(monthlyTaxUzs)}
            </strong>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Save className="w-4 h-4" strokeWidth={1.75} />
              Сохранить курсы
            </button>
            <button
              type="button"
              onClick={handleResetCurrencyAuto}
              className="px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
            >
              Сбросить на авто от ЦБ РУз
            </button>
          </div>
        </form>
      )}

      {/* SUB-TAB 3: Rooms & Pricing */}
      {settingsSubTab === 'rooms' && (
        <section className="ops-card p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Редактор комнат и тарифов (USD)
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono tabular-nums">
                Активных комнат: {activePhysicalCount} (ставка турсбора иностранцев:{' '}
                {activePhysicalCount <= 10 ? '5% БРВ' : '10% БРВ'})
              </p>
            </div>
          </div>

          {/* Add Physical Room Form */}
          <form
            onSubmit={handleAddRoom}
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-2xl bg-[var(--bg-elevated)] p-4 border border-[var(--border-subtle)]"
          >
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                Категория комнаты
              </label>
              <select
                value={newRoomCatId}
                onChange={(e) => setNewRoomCatId(e.target.value)}
                className="ops-input w-full px-3 py-2 text-xs"
              >
                {state.roomCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.isDorm ? 'Дорм 6 коек' : 'Приватная'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                Название (или оставьте пустым для авто-номера)
              </label>
              <input
                type="text"
                value={newRoomCode}
                onChange={(e) => setNewRoomCode(e.target.value)}
                placeholder="Например: Small #6"
                className="ops-input w-full px-3 py-2 text-xs"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full py-2 px-4 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors min-h-[36px]"
              >
                <Plus className="w-4 h-4" strokeWidth={1.75} />
                Добавить комнату
              </button>
            </div>
          </form>

          {/* Category Price Matrix */}
          <div className="overflow-x-auto border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-elevated)]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                <tr>
                  <th className="py-3 px-3.5 font-semibold">Категория</th>
                  <th className="py-3 px-3.5 font-semibold">Bnovo ID</th>
                  <th className="py-3 px-3.5 font-semibold">Тарифы USD (1 / 2 / 3 / 4 чел.)</th>
                  <th className="py-3 px-3.5 font-semibold text-right">Комнат</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {state.roomCategories.map((cat) => {
                  const count = state.physicalRooms.filter(
                    (r) => r.categoryId === cat.id && !r.archived
                  ).length;
                  const refinedColor = getTopchanRoomColor(cat.id, cat.colorHex);
                  return (
                    <tr key={cat.id} className="hover:bg-[var(--bg-hover)]/50 transition-colors">
                      <td className="py-3 px-3.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: refinedColor }}
                          />
                          {cat.name}
                        </span>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-[var(--text-muted)]">
                        {cat.bnovoCategoryId}
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {Object.entries(cat.pricesUsd).map(([occ, price]) => (
                            <label
                              key={occ}
                              className="inline-flex items-center gap-1.5 text-[var(--text-muted)]"
                            >
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
                                className="ops-input w-16 px-2 py-1 font-mono tabular-nums text-xs"
                              />
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                        {count}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Physical rooms archive toggles */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[var(--text-secondary)]">
              Физические комнаты (нажмите, чтобы архивировать или вернуть в работу)
            </div>
            <div className="flex flex-wrap gap-2">
              {state.physicalRooms.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => archivePhysicalRoom(r.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border inline-flex items-center gap-1.5 transition-colors ${
                    r.archived
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border-subtle)] line-through opacity-70'
                      : 'bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--border-subtle)]'
                  }`}
                >
                  <Archive className="w-3.5 h-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
                  {r.code}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* SUB-TAB 4: Integrations & Codes */}
      {settingsSubTab === 'integrations' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form
            onSubmit={handleSaveIntegrations}
            className="lg:col-span-8 ops-card p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Shield
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Bnovo, Яндекс Почта, Telegram и коды доступа
                </h2>
              </div>
              <StatusPill tone={storageKind === 'supabase' ? 'emerald' : 'neutral'} icon={Database}>
                {storageKind === 'supabase' ? 'Облако Supabase' : 'Локально в браузере'}
              </StatusPill>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Bnovo Account ID
                </label>
                <input
                  type="text"
                  value={bnovoAccount}
                  onChange={(e) => setBnovoAccount(e.target.value)}
                  className="ops-input w-full px-3 py-2.5 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Яндекс Почта (IMAP)
                </label>
                <input
                  type="email"
                  value={yandexEmail}
                  onChange={(e) => setYandexEmail(e.target.value)}
                  className="ops-input w-full px-3 py-2.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Telegram Chat ID
                </label>
                <input
                  type="text"
                  value={tgChatId}
                  onChange={(e) => setTgChatId(e.target.value)}
                  className="ops-input w-full px-3 py-2.5 font-mono text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                    Wi-Fi пароль
                  </label>
                  <input
                    type="text"
                    value={wifiPass}
                    onChange={(e) => setWifiPass(e.target.value)}
                    className="ops-input w-full px-2.5 py-2.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                    Код двери
                  </label>
                  <input
                    type="text"
                    value={doorCode}
                    onChange={(e) => setDoorCode(e.target.value)}
                    className="ops-input w-full px-2.5 py-2.5 font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Save className="w-4 h-4" strokeWidth={1.75} />
              Сохранить интеграции
            </button>
          </form>

          {/* Maintenance & Reset Card */}
          <section className="lg:col-span-4 ops-card p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Служебные действия
              </h2>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Откройте боковую панель переноса данных в Bnovo/E-mehmon или сбросьте демо-данные
                к исходному состоянию.
              </p>
              <div className="text-xs font-mono tabular-nums text-[var(--text-muted)] pt-1">
                Версия синка: #{state.revision}
              </div>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSidePanelOpen((v) => !v)}
                className="w-full py-2.5 px-3.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Chrome
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                />
                Открыть Мост Bnovo / E-mehmon
              </button>
              <button
                type="button"
                onClick={resetDemoData}
                className="w-full py-2.5 px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                style={{
                  backgroundColor: 'var(--tone-rose-bg)',
                  borderColor: 'var(--tone-rose-border)',
                  color: 'var(--tone-rose-fg)',
                }}
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                Сбросить демо-данные
              </button>
            </div>
          </section>
        </div>
      )}

      {/* SUB-TAB 5: Audit Log & Export */}
      {settingsSubTab === 'audit' && (
        <section className="ops-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Неизменяемый журнал аудита и экспорт
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                История всех оплат, особых разрешений, инкассаций и правок тарифов · Версия синка{' '}
                <span className="font-mono tabular-nums">#{state.revision}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] inline-flex items-center gap-1.5 transition-colors"
              >
                <FileSpreadsheet
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-emerald-fg)' }}
                />
                Экспорт CSV
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] inline-flex items-center gap-1.5 transition-colors"
              >
                <FileJson
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                />
                Экспорт JSON
              </button>
            </div>
          </div>

          {state.auditLog.length === 0 ? (
            <EmptyState
              icon={History}
              title="Записей в журнале аудита пока нет"
              description="Каждое финансовое действие и изменение настроек автоматически фиксируется здесь."
            />
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-elevated)] overflow-hidden max-h-[520px] overflow-y-auto">
              {state.auditLog.map((entry) => (
                <div
                  key={entry.id}
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--text-primary)]">
                      {entry.action} ·{' '}
                      <span className="font-normal text-[var(--text-secondary)]">{entry.diff}</span>
                    </div>
                    <div className="text-[var(--text-muted)] mt-0.5">
                      {entry.actor} · Основание: {entry.reason}
                    </div>
                  </div>
                  <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0">
                    {entry.timestamp.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
