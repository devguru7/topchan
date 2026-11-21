import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useOps } from '../context/OpsContext';

const TONE_STYLES = {
  emerald: {
    icon: CheckCircle2,
    fg: 'var(--tone-emerald-fg)',
    border: 'var(--tone-emerald-border)',
  },
  amber: {
    icon: AlertCircle,
    fg: 'var(--tone-amber-fg)',
    border: 'var(--tone-amber-border)',
  },
  rose: {
    icon: AlertCircle,
    fg: 'var(--tone-rose-fg)',
    border: 'var(--tone-rose-border)',
  },
  cobalt: {
    icon: Info,
    fg: 'var(--tone-cobalt-fg)',
    border: 'var(--tone-cobalt-border)',
  },
} as const;

export const ToastStack: React.FC = () => {
  const { toasts, dismissToast } = useOps();

  return (
    <div
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-5 right-4 z-50 flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none no-print"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const cfg = TONE_STYLES[toast.tone];
          const Icon = cfg.icon;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{ borderColor: cfg.border }}
              className="pointer-events-auto bg-[var(--bg-surface)]/95 backdrop-blur-md border rounded-2xl px-4 py-3 shadow-lg flex items-start gap-3"
            >
              <Icon
                className="w-4 h-4 mt-0.5 shrink-0"
                strokeWidth={1.75}
                style={{ color: cfg.fg }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
                  {toast.title}
                </p>
                {toast.description && (
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Закрыть уведомление"
                onClick={() => dismissToast(toast.id)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded-lg transition-colors shrink-0"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
