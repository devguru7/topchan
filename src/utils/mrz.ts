import type { MrzResult } from '../types/ops';

export const SAMPLE_MRZ_ITALY = [
  'P<ITAROSSI<<MARCO<<<<<<<<<<<<<<<<<<<<<<<<<<<',
  'YA48291032ITA9106154M2906158<<<<<<<<<<<<<<04',
].join('\n');

export const SAMPLE_MRZ_KOREA = [
  'P<KORPARK<<MINJUN<<<<<<<<<<<<<<<<<<<<<<<<<<<',
  'M839104215KOR9603221M3103225<<<<<<<<<<<<<<02',
].join('\n');

function parseMrzDate(yymmdd: string, isExpiry: boolean, refYear = 2026): string {
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  if (Number.isNaN(yy)) return '1990-01-01';
  const currentTwoDigit = refYear % 100;
  let fullYear: number;
  if (isExpiry) {
    fullYear = 2000 + yy;
  } else {
    fullYear = yy > currentTwoDigit ? 1900 + yy : 2000 + yy;
  }
  return `${fullYear}-${mm}-${dd}`;
}

function calcAgeFromDob(dob: string, refYear = 2026): number {
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

/**
 * Parses a standard 2-line ICAO 9303 TD3 passport MRZ string.
 * Tolerates minor whitespace or slightly short lines by padding with '<'.
 */
export function parseTd3Mrz(input: string, refYear = 2026): MrzResult {
  const lines = input
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      valid: false,
      error: 'Нужны 2 строки MRZ (формат TD3, по 44 символа)',
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

  const passportNo = line2.slice(0, 9).replace(/</g, '');
  const nationality = line2.slice(10, 13).replace(/</g, '') || issuingState || 'UNK';
  const dobRaw = line2.slice(13, 19);
  const sexRaw = line2.slice(20, 21);
  const expiryRaw = line2.slice(21, 27);

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
    };
  }

  const dob = parseMrzDate(dobRaw, false, refYear);
  const expiryDate = /^\d{6}$/.test(expiryRaw)
    ? parseMrzDate(expiryRaw, true, refYear)
    : `${refYear + 5}-01-01`;
  const sex: 'M' | 'F' = sexRaw === 'F' ? 'F' : 'M';
  const age = calcAgeFromDob(dob, refYear);
  const isForeigner = nationality !== 'UZB';

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
  };
}
