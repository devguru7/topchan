import React, { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface TooltipHintProps {
  title?: string;
  text: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export const TooltipHint: React.FC<TooltipHintProps> = ({
  title,
  text,
  align = 'center',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        aria-label={title ?? 'Пояснение'}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <HelpCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>

      {open && (
        <div
          id={popoverId}
          role="tooltip"
          className={`absolute bottom-full mb-2 z-50 w-64 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 shadow-lg text-left ${alignClass}`}
        >
          {title && (
            <div className="text-xs font-semibold text-[var(--text-primary)] mb-1">{title}</div>
          )}
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed font-normal">
            {text}
          </p>
        </div>
      )}
    </span>
  );
};
