export interface CashFormDefaults {
  billInputUsd: string;
  receivedAmount: string;
  calcLabel: string;
  pettyCategory: string;
  pettyAmount: string;
  pettyNote: string;
  safeUzs: string;
  safeUsd: string;
  safeEur: string;
  uzsBills: Record<number, number>;
  usdBills: Record<number, number>;
}

/**
 * Strictly empty / zero starting values for all live CashTab forms so
 * receptionists on a live shift never accidentally post hardcoded demo figures.
 */
export function createEmptyCashFormDefaults(): CashFormDefaults {
  return {
    billInputUsd: '',
    receivedAmount: '',
    calcLabel: '',
    pettyCategory: '',
    pettyAmount: '',
    pettyNote: '',
    safeUzs: '',
    safeUsd: '',
    safeEur: '',
    uzsBills: {
      200000: 0,
      100000: 0,
      50000: 0,
      20000: 0,
      10000: 0,
      5000: 0,
    },
    usdBills: {
      100: 0,
      50: 0,
      20: 0,
      10: 0,
      5: 0,
      1: 0,
    },
  };
}

/**
 * Optional demo-only sample values injected explicitly via «Подставить пример».
 */
export const DEMO_CASH_FORM_EXAMPLE: CashFormDefaults = {
  billInputUsd: '36',
  receivedAmount: '50',
  calcLabel: 'Оплата проживания (пример Demo)',
  pettyCategory: 'Вода Hydrolife',
  pettyAmount: '60000',
  pettyNote: '2 бутыли 19л',
  safeUzs: '1000000',
  safeUsd: '100',
  safeEur: '0',
  uzsBills: {
    200000: 5,
    100000: 10,
    50000: 9,
    20000: 0,
    10000: 0,
    5000: 0,
  },
  usdBills: {
    100: 2,
    50: 2,
    20: 2,
    10: 0,
    5: 0,
    1: 0,
  },
};
