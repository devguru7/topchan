import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LaundryJob } from '../types/ops';
import { formatTashkentClock, formatTashkentDateRu, getTashkentTodayIso } from '../utils/time';
import { useOpsData } from './OpsDataContext';

export interface TimerContextValue {
  nowMs: number;
  clockStr: string;
  todayIso: string;
  todayRu: string;
  getRemainingSeconds: (job: LaundryJob) => number;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state, completeLaundryJob } = useOpsData();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const laundryRef = useRef(state.laundryJobs);
  laundryRef.current = state.laundryJobs;

  // Isolated 1-second tick: only TimerContext consumers (Header Clock + Laundry cards) re-render
  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);

      for (const job of laundryRef.current) {
        if (job.status !== 'running') continue;
        const startedMs = new Date(job.startedAt).getTime();
        const elapsedSec = Math.max(0, Math.floor((current - startedMs) / 1000));
        const rem = Math.max(0, job.totalSeconds - elapsedSec);
        if (rem === 0) {
          completeLaundryJob(job.id);
        }
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [completeLaundryJob]);

  const getRemainingSeconds = useCallback(
    (job: LaundryJob): number => {
      if (job.status === 'completed') return 0;
      const startedMs = new Date(job.startedAt).getTime();
      if (!Number.isFinite(startedMs)) return job.remainingSeconds;
      const elapsedSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
      return Math.max(0, job.totalSeconds - elapsedSec);
    },
    [nowMs]
  );

  const value = useMemo<TimerContextValue>(() => {
    const d = new Date(nowMs);
    return {
      nowMs,
      clockStr: formatTashkentClock(d),
      todayIso: getTashkentTodayIso(d),
      todayRu: formatTashkentDateRu(d),
      getRemainingSeconds,
    };
  }, [nowMs, getRemainingSeconds]);

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
};

export function useTimers(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimers must be used inside TimerProvider');
  return ctx;
}
