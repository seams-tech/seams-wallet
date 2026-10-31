import { exactRecord } from '../utils/exactRecord';
import { requireRecord } from '../utils/validation';
import type { ReadonlyExclusiveUnion } from '../utils/variant';
import {
  MlDsaSigningError,
  parseMlDsaSigningFailure,
  type MlDsaSigningFailure,
} from './mlDsaSigning';

export type NearSigningFailureCause = ReadonlyExclusiveUnion<
  | { readonly kind: 'unclassified' }
  | { readonly kind: 'ml_dsa'; readonly failure: MlDsaSigningFailure }
>;

/** Error normalization at the public transaction boundary. */
export function nearSigningFailureCause(error: unknown): NearSigningFailureCause {
  if (error instanceof MlDsaSigningError) return { kind: 'ml_dsa', failure: error.failure };
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('ml_dsa_signing_')
  ) {
    try {
      const failure = parseMlDsaSigningFailure({
        kind: 'refused',
        code: error.code.slice('ml_dsa_signing_'.length),
        message: error.message,
      });
      return { kind: 'ml_dsa', failure };
    } catch {
      return { kind: 'unclassified' };
    }
  }
  return { kind: 'unclassified' };
}

/** Older persisted/iframe non-submission records contain only their display message. */
export function parseNearSigningFailureCause(raw: unknown): NearSigningFailureCause {
  if (raw === undefined) return { kind: 'unclassified' };
  const value = requireRecord(raw, 'NEAR signing failure cause');
  switch (value.kind) {
    case 'unclassified':
      exactRecord(raw, ['kind'], 'Unclassified NEAR failure');
      return { kind: 'unclassified' };
    case 'ml_dsa': {
      const record = exactRecord(raw, ['kind', 'failure'], 'ML-DSA signing failure');
      return { kind: 'ml_dsa', failure: parseMlDsaSigningFailure(record.failure) };
    }
    default:
      throw new Error('Invalid NEAR signing failure cause');
  }
}
