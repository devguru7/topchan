import type { MrzResult } from '../types/ops';
import { getTashkentYear } from './time';

export interface MrzCheckDigits {
  passportValid: boolean;
  dobValid: boolean;
  expiryValid: boolean;
  compositeValid: boolean;
  allValid: boolean;
}

export interface StrictMrzResult extends MrzResult {
  checkDigits: MrzCheckDigits;
  personalNumber: string;
}

const MRZ_WEIGHTS = [7, 3, 1] as const;

/**
 * Computes ICAO 9303 check digit using 7-3-1 weighted modulo 10 algorithm.
 * Digits '0'-'9' => 0..9, Letters 'A'-'Z' => 10..35, Filler '<' => 0.
 */
export function computeMrzCheckDigit(field: string): number {
  let sum = 0;
  const upper = field.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const ch = upper.charCodeAt(i);
    let value = 0;
    if (ch >= 48 && ch <= 57) {
      value = ch - 48;
    } else if (ch >= 65 && ch <= 90) {
      value = ch - 55;
    } else {
      value = 0;
    }
    sum += value * MRZ_WEIGHTS[i % 3];
  }
  return sum % 10;
}

export function verifyMrzCheckDigit(field: string, expectedDigitChar: string): boolean {
  if (!/^\d$/.test(expectedDigitChar)) return false;
  return computeMrzCheckDigit(field) === parseInt(expectedDigitChar, 10);
}

/**
 * Builds a valid 2-line ICAO 9303 TD3 passport MRZ string with computed check digits.
 */
export function buildValidTd3Mrz(params: {
  issuingState: string;
  surname: string;
  givenName: string;
  passportNo: string;
  nationality: string;
  dobYymmdd: string;
  sex: 'M' | 'F';
  expiryYymmdd: string;
}): string {
  const iss = params.issuingState.toUpperCase().replace(/[^A-Z]/g, '').padEnd(3, '<').slice(0, 3);
  const sur = params.surname.toUpperCase().replace(/[^A-Z\s]/g, '').trim().replace(/\s+/g, '<');
  const giv = params.givenName.toUpperCase().replace(/[^A-Z\s]/g, '').trim().replace(/\s+/g, '<');
  const line1 = `P<${iss}${sur}<<${giv}`.padEnd(44, '<').slice(0, 44);

  const passField = params.passportNo.toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(9, '<').slice(0, 9);
  const passCd = String(computeMrzCheckDigit(passField));
  const nat = params.nationality.toUpperCase().replace(/[^A-Z]/g, '').padEnd(3, '<').slice(0, 3);
  const dob = params.dobYymmdd.slice(0, 6);
  const dobCd = String(computeMrzCheckDigit(dob));
  const exp = params.expiryYymmdd.slice(0, 6);
  const expCd = String(computeMrzCheckDigit(exp));
  const optional = '<'.repeat(14);
  const optCd = String(computeMrzCheckDigit(optional));
  const compositeInput = `${passField}${passCd}${dob}${dobCd}${exp}${expCd}${optional}${optCd}`;
  const compositeCd = String(computeMrzCheckDigit(compositeInput));

  const line2 = `${passField}${passCd}${nat}${dob}${dobCd}${params.sex}${exp}${expCd}${optional}${optCd}${compositeCd}`;
  return `${line1}\n${line2}`;
}

export const SAMPLE_MRZ_ITALY = buildValidTd3Mrz({
  issuingState: 'ITA',
  surname: 'ROSSI',
  givenName: 'MARCO',
  passportNo: 'YA4829103',
  nationality: 'ITA',
  dobYymmdd: '910615',
  sex: 'M',
  expiryYymmdd: '290615',
});

export const SAMPLE_MRZ_KOREA = buildValidTd3Mrz({
  issuingState: 'KOR',
  surname: 'PARK',
  givenName: 'MINJUN',
  passportNo: 'M83910421',
  nationality: 'KOR',
  dobYymmdd: '960322',
  sex: 'M',
  expiryYymmdd: '310322',
});

export const SAMPLE_MRZ_FEMALE_DE = buildValidTd3Mrz({
  issuingState: 'DEU',
  surname: 'WEBER',
  givenName: 'CLARA',
  passportNo: 'C01X00T47',
  nationality: 'DEU',
  dobYymmdd: '950814',
  sex: 'F',
  expiryYymmdd: '300814',
});

function parseMrzDate(yymmdd: string, isExpiry: boolean, refYear = getTashkentYear()): string {
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  if (Number.isNaN(yy)) return '1990-01-01';
  const currentTwoDigit = refYear % 100;
  const fullYear = isExpiry
    ? 2000 + yy
    : yy > currentTwoDigit
      ? 1900 + yy
      : 2000 + yy;
  return `${fullYear}-${mm}-${dd}`;
}

function calcAgeFromDob(dob: string, refYear = getTashkentYear()): number {
  const year = parseInt(dob.slice(0, 4), 10);
  if (Number.isNaN(year)) return 25;
  return Math.max(0, refYear - year);
}

function formatNamePart(raw: string): string {
  return raw
    .split('<')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

const EMPTY_CHECK_DIGITS: MrzCheckDigits = {
  passportValid: false,
  dobValid: false,
  expiryValid: false,
  compositeValid: false,
  allValid: false,
};

/**
 * Full ICAO 9303 TD3 parser with strict 7-3-1 mod 10 check-digit verification.
 * When `requireValidCheckDigits` is true, invalid check digits mark `valid = false`.
 */
export function parseTd3MrzStrict(
  input: string,
  options?: { refYear?: number; requireValidCheckDigits?: boolean }
): StrictMrzResult {
  const refYear = options?.refYear ?? getTashkentYear();
  const requireValidCheckDigits = options?.requireValidCheckDigits ?? false;

  const lines = input
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      valid: false,
      error: 'Нужны 2 строки MRZ (формат ICAO 9303 TD3, по 44 символа)',
      documentType: 'P',
      issuingState: '',
      surname: '',
      givenName: '',
      fullName: '',
      passportNo: '',
      nationality: '',
      dob: '',
      age: 0,
      sex: 'M',
      expiryDate: '',
      isForeigner: true,
      raw: input,
      personalNumber: '',
      checkDigits: EMPTY_CHECK_DIGITS,
    };
  }

  const line1 = lines[0].padEnd(44, '<').slice(0, 44);
  const line2 = lines[1].padEnd(44, '<').slice(0, 44);

  const documentType = line1.slice(0, 2).replace(/</g, '') || 'P';
  const issuingState = line1.slice(2, 5).replace(/</g, '');
  const namesField = line1.slice(5);
  const [rawSurname = '', rawGiven = ''] = namesField.split('<<');
  const surname = formatNamePart(rawSurname);
  const givenName = formatNamePart(rawGiven);
  const fullName = [givenName, surname].filter(Boolean).join(' ').trim();

  const passportField = line2.slice(0, 9);
  const passportCheckChar = line2.slice(9, 10);
  const passportNo = passportField.replace(/</g, '');
  const nationality = line2.slice(10, 13).replace(/</g, '') || issuingState || 'UNK';
  const dobRaw = line2.slice(13, 19);
  const dobCheckChar = line2.slice(19, 20);
  const sexRaw = line2.slice(20, 21);
  const expiryRaw = line2.slice(21, 27);
  const expiryCheckChar = line2.slice(27, 28);
  const personalField = line2.slice(28, 42);
  const personalCheckChar = line2.slice(42, 43);
  const compositeCheckChar = line2.slice(43, 44);

  const passportValid = verifyMrzCheckDigit(passportField, passportCheckChar);
  const dobValid = /^\d{6}$/.test(dobRaw) && verifyMrzCheckDigit(dobRaw, dobCheckChar);
  const expiryValid = /^\d{6}$/.test(expiryRaw) && verifyMrzCheckDigit(expiryRaw, expiryCheckChar);
  const compositePayload = `${passportField}${passportCheckChar}${dobRaw}${dobCheckChar}${expiryRaw}${expiryCheckChar}${personalField}${personalCheckChar}`;
  const compositeValid = verifyMrzCheckDigit(compositePayload, compositeCheckChar);

  const checkDigits: MrzCheckDigits = {
    passportValid,
    dobValid,
    expiryValid,
    compositeValid,
    allValid: passportValid && dobValid && expiryValid && compositeValid,
  };

  if (!passportNo || !surname || !/^\d{6}$/.test(dobRaw)) {
    return {
      valid: false,
      error: 'Не удалось распознать номер паспорта, фамилию или дату рождения из MRZ',
      documentType,
      issuingState,
      surname,
      givenName,
      fullName,
      passportNo,
      nationality,
      dob: '',
      age: 0,
      sex: 'M',
      expiryDate: '',
      isForeigner: nationality !== 'UZB',
      raw: input,
      personalNumber: personalField.replace(/</g, ''),
      checkDigits,
    };
  }

  const dob = parseMrzDate(dobRaw, false, refYear);
  const expiryDate = /^\d{6}$/.test(expiryRaw)
    ? parseMrzDate(expiryRaw, true, refYear)
    : `${refYear + 5}-01-01`;
  const sex: 'M' | 'F' = sexRaw === 'F' ? 'F' : 'M';
  const age = calcAgeFromDob(dob, refYear);
  const isForeigner = nationality !== 'UZB';

  if (requireValidCheckDigits && !checkDigits.allValid) {
    const failedParts: string[] = [];
    if (!passportValid) failedParts.push('номер паспорта');
    if (!dobValid) failedParts.push('дата рождения');
    if (!expiryValid) failedParts.push('срок действия');
    if (!compositeValid) failedParts.push('контрольная сумма строки');
    return {
      valid: false,
      error: `Ошибка контрольных цифр ICAO 9303: ${failedParts.join(', ')}`,
      documentType,
      issuingState,
      surname,
      givenName,
      fullName: fullName || surname,
      passportNo,
      nationality,
      dob,
      age,
      sex,
      expiryDate,
      isForeigner,
      raw: `${line1}\n${line2}`,
      personalNumber: personalField.replace(/</g, ''),
      checkDigits,
    };
  }

  return {
    valid: true,
    documentType,
    issuingState,
    surname,
    givenName,
    fullName: fullName || surname,
    passportNo,
    nationality,
    dob,
    age,
    sex,
    expiryDate,
    isForeigner,
    raw: `${line1}\n${line2}`,
    personalNumber: personalField.replace(/</g, ''),
    checkDigits,
  };
}
