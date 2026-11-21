import React from 'react';

export type StatusTone = 'emerald' | 'amber' | 'rose' | 'cobalt' | 'neutral';

interface StatusPillProps {
  tone?: StatusTone;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  mono?: boolean;
  className?: string;
}

const TONE_STYLE_MAP: Record<
  StatusTone,
  { color: string; backgroundColor: string; borderColor: string }
> = {
  emerald: {
    color: 'var(--tone-emerald-fg)',
    backgroundColor: 'var(--tone-emerald-bg)',
    borderColor: 'var(--tone-emerald-border)',
  },
  amber: {
    color: 'var(--tone-amber-fg)',
    backgroundColor: 'var(--tone-amber-bg)',
    borderColor: 'var(--tone-amber-border)',
  },
  rose: {
    color: 'var(--tone-rose-fg)',
    backgroundColor: 'var(--tone-rose-bg)',
    borderColor: 'var(--tone-rose-border)',
  },
  cobalt: {
    color: 'var(--tone-cobalt-fg)',
    backgroundColor: 'var(--tone-cobalt-bg)',
    borderColor: 'var(--tone-cobalt-border)',
  },
  neutral: {
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--bg-elevated)',
    borderColor: 'var(--border-subtle)',
  },
};

export const StatusPill: React.FC<StatusPillProps> = ({
  tone = 'neutral',
  children,
  icon: Icon,
  mono = false,
  className = '',
}) => {
  const style = TONE_STYLE_MAP[tone];
  return (
    <span
      style={style}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
        mono ? 'font-mono tabular-nums' : ''
      } ${className}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />}
      <span>{children}</span>
    </span>
  );
};
