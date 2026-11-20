import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useOps } from '../context/OpsContext';

const TONE_STYLES = {
  emerald: {
    icon: CheckCircle2,
    accent: 'text-[#10B981]',
    border: 'border-[#10B981]/30',
  },
  amber: {
    icon: AlertCircle,
    accent: 'text-[#F59E0B]',
    border: 'border-[#F59E0B]/30',
  },
  rose: {
    icon: AlertCircle,
    accent: 'text-[#F43F5E]',
    border: 'border-[#F43F5E]/30',
  },
  cobalt: {
    icon: Info,
    accent: 'text-[#3B82F6]',
    border: 'border-[#3B82F6]/30',
  },
} as const;

export const ToastStack: React.FC = () => {
  const { toasts, dismissToast } = useOps();

  return (
    <div
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-5 right-4 z-50 flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const cfg = TONE_STYLES[toast.tone];
          const Icon = cfg.icon;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className={`pointer-events-auto bg-[#121826]/95 backdrop-blur-md border ${cfg.border} rounded-xl px-4 py-3 shadow-2xl flex items-start gap-3`}
            >
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.accent}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white leading-snug">{toast.title}</p>
                {toast.description && (
                  <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Закрыть уведомление"
                onClick={() => dismissToast(toast.id)}
                className="text-slate-400 hover:text-white p-1 rounded-md transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
