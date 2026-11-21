import type { MrzResult } from '../types/ops';
import { getTashkentYear } from './time';
import {
  buildValidTd3Mrz,
  computeMrzCheckDigit,
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
  parseTd3MrzStrict,
  SAMPLE_MRZ_FEMALE_DE,
  SAMPLE_MRZ_ITALY,
  SAMPLE_MRZ_KOREA,
  verifyMrzCheckDigit,
  type MrzCheckDigits,
  type StrictMrzResult,
};

/**
 * Compatibility wrapper around `parseTd3MrzStrict` preserving existing signature.
 */
export function parseTd3Mrz(input: string, refYear = getTashkentYear()): MrzResult {
  return parseTd3MrzStrict(input, { refYear, requireValidCheckDigits: false });
}
