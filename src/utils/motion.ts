import React, { useEffect, useRef, useState } from 'react';

export const SPRING_SNAPPY = {
  type: 'spring' as const,
  stiffness: 320,
  damping: 28,
  mass: 0.8,
};

export const FADE_FAST = {
  duration: 0.14,
  ease: [0.22, 1, 0.36, 1] as const,
};

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return reduced;
}

interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  format = (n) => Math.round(n).toLocaleString('ru-RU'),
  className = '',
}) => {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const start = prevRef.current;
    const diff = value - start;
    if (reduced || Math.abs(diff) < 0.01) {
      prevRef.current = value;
      setDisplay(value);
      return;
    }

    let frame = 0;
    const duration = 260;
    const startedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + diff * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        prevRef.current = value;
        setDisplay(value);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  return React.createElement(
    'span',
    { className: `tabular-nums ${className}`.trim() },
    format(display)
  );
};
