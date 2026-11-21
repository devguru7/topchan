import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  onCopied?: () => void;
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  label = 'Скопировать',
  copiedLabel = 'Скопировано',
  onCopied,
  variant = 'default',
  size = 'sm',
  className = '',
  ariaLabel,
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      // Clipboard fallback ignored in restricted contexts; still provide confirmation feedback
    }
    setCopied(true);
    onCopied?.();
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-xs min-h-[34px]' : 'px-4 py-2.5 text-sm min-h-[40px]';

  const variantClass =
    variant === 'primary'
      ? 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white border border-transparent'
      : variant === 'ghost'
        ? 'bg-transparent hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent'
        : 'bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)]';

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel ?? label}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors whitespace-nowrap shrink-0 ${sizeClass} ${variantClass} ${className}`}
    >
      {copied ? (
        <Check
          className="w-3.5 h-3.5 shrink-0"
          strokeWidth={2}
          style={{ color: variant === 'primary' ? '#FFFFFF' : 'var(--tone-emerald-fg)' }}
        />
      ) : (
        <Copy className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
      )}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
};
