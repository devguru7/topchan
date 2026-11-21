import React from 'react';
import { UIProvider, useUI, type UIContextValue } from './UIContext';
import { OpsDataProvider, useOpsData, type OpsDataContextValue } from './OpsDataContext';
import { TimerProvider, useTimers } from './TimerContext';

export type { CheckInPayload, CheckOutPayload, CheckInPreselect } from '../store/types';
export { useUI, useOpsData, useTimers };

export const OpsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <UIProvider>
      <OpsDataProvider>
        <TimerProvider>{children}</TimerProvider>
      </OpsDataProvider>
    </UIProvider>
  );
};

export type OpsContextValue = OpsDataContextValue & UIContextValue;

/**
 * Thin compatibility hook combining OpsDataContext and UIContext.
 * Note: Intentionally omits TimerContext so consumers never re-render every second.
 */
export function useOps(): OpsContextValue {
  const data = useOpsData();
  const ui = useUI();
  return { ...data, ...ui };
}
