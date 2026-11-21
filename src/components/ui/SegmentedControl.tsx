import React from 'react';
import { motion } from 'motion/react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  badge?: number;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  ariaLabel: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  ariaLabel,
  size = 'md',
  fullWidth = false,
  className = '',
}: SegmentedControlProps<T>) {
  const padClass = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-xs';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 p-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-x-auto max-w-full ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`relative rounded-xl font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${padClass} ${
              fullWidth ? 'flex-1' : ''
            } ${
              active
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="absolute inset-0 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] shadow-xs"
              />
            )}
            {Icon && <Icon className="w-3.5 h-3.5 relative z-10 shrink-0" strokeWidth={1.75} />}
            <span className="relative z-10">{opt.label}</span>
            {typeof opt.badge === 'number' && opt.badge > 0 && (
              <span
                className="relative z-10 ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-mono tabular-nums font-bold leading-none"
                style={{
                  backgroundColor: 'var(--tone-cobalt-bg)',
                  color: 'var(--tone-cobalt-fg)',
                }}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
