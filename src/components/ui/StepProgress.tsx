import React from 'react';
import { Check } from 'lucide-react';

export interface WizardStep {
  id: number;
  label: string;
  hint?: string;
}

interface StepProgressProps {
  steps: ReadonlyArray<WizardStep>;
  currentStep: number;
  onStepClick?: (stepId: number) => void;
}

export const StepProgress: React.FC<StepProgressProps> = ({
  steps,
  currentStep,
  onStepClick,
}) => {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Шаги оформления">
      {steps.map((step) => {
        const completed = step.id < currentStep;
        const active = step.id === currentStep;
        const clickable = Boolean(onStepClick);

        return (
          <li key={step.id}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(step.id)}
              className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors flex items-center gap-2.5 ${
                active
                  ? 'border-[#3B82F6] bg-[var(--tone-cobalt-bg)]'
                  : completed
                    ? 'border-[var(--tone-emerald-border)] bg-[var(--tone-emerald-bg)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono tabular-nums font-bold shrink-0"
                style={
                  active
                    ? { backgroundColor: '#2563EB', color: '#FFFFFF' }
                    : completed
                      ? { backgroundColor: '#059669', color: '#FFFFFF' }
                      : {
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-strong)',
                        }
                }
              >
                {completed ? <Check className="w-3.5 h-3.5" strokeWidth={2.25} /> : step.id}
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-xs font-semibold truncate ${
                    active || completed
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {step.label}
                </span>
                {step.hint && (
                  <span className="hidden sm:block text-xs text-[var(--text-muted)] truncate">
                    {step.hint}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};
