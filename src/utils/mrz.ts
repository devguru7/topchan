import type { MrzResult } from '../types/ops';
import { getTashkentYear } from './time';
import {
  buildValidTd3Mrz,
  computeMrzCheckDigit,
  parseMrzDate,
  parseTd3MrzStrict,
  SAMPLE_MRZ_FEMALE_DE,
  SAMPLE_MRZ_ITALY,
  SAMPLE_MRZ_KOREA,
  verifyMrzCheckDigit,
  type MrzCheckDigits,
  type StrictMrzResult,
} from './mrzParser';

export {
  buildValidTd3Mrz,
  computeMrzCheckDigit,
  parseMrzDate,
  parseTd3MrzStrict,
  SAMPLE_MRZ_FEMALE_DE,
  SAMPLE_MRZ_ITALY,
  SAMPLE_MRZ_KOREA,
  verifyMrzCheckDigit,
  type MrzCheckDigits,
  type StrictMrzResult,
};

/**
 * Strict ICAO 9303 TD3 MRZ parser wrapper.
 * Enforces check-digit validation by default (`requireValidCheckDigits: true`)
 * so corrupted or mistyped MRZ strings never silently enter guest/E-mehmon cards.
 */
export function parseTd3Mrz(
  input: string,
  refYear = getTashkentYear(),
  requireValidCheckDigits = true
): MrzResult {
  return parseTd3MrzStrict(input, { refYear, requireValidCheckDigits });
}
