import React from 'react';
import type { StatusTone } from './StatusPill';

interface MetricTileProps {
  label: string;
  value: string | number;
  subtext?: string;
  tone?: StatusTone;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

const VALUE_COLOR: Record<StatusTone, string> = {
  emerald: 'var(--tone-emerald-fg)',
  amber: 'var(--tone-amber-fg)',
  rose: 'var(--tone-rose-fg)',
  cobalt: 'var(--tone-cobalt-fg)',
  neutral: 'var(--text-primary)',
};

export const MetricTile: React.FC<MetricTileProps> = ({
  label,
  value,
  subtext,
  tone = 'neutral',
  active = false,
  onClick,
  className = '',
}) => {
  const baseClass = `text-left rounded-2xl border p-4 transition-colors ${
    active
      ? 'border-[#3B82F6] bg-[var(--bg-hover)]'
      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
  } ${onClick ? 'hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]' : ''} ${className}`;

  const content = (
    <>
      <div className="text-xs font-medium text-[var(--text-muted)] truncate">{label}</div>
      <div
        className="text-2xl font-bold font-mono tabular-nums mt-1.5 tracking-tight truncate"
        style={{ color: VALUE_COLOR[tone] }}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-xs text-[var(--text-muted)] mt-1 truncate">{subtext}</div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClass}>
        {content}
      </button>
    );
  }

  return <div className={baseClass}>{content}</div>;
};
