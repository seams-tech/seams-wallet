import type {
  EcdsaThresholdKeyId,
  SigningRootId,
  SigningRootVersion,
  ThresholdEcdsaSessionId,
  ThresholdOwnerAddress,
} from './evmFamilyEcdsaIdentity';
import type { EmailOtpAuthSubjectId } from '@/core/platform/types';
import {
  parseSdkEcdsaDerivationSigningRootId,
  parseSdkEcdsaDerivationSigningRootVersion,
  parseSdkEcdsaDerivationThresholdKeyId,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';

export type {
  EcdsaThresholdKeyId,
  EmailOtpAuthSubjectId,
  SigningRootId,
  SigningRootVersion,
  ThresholdEcdsaSessionId,
  ThresholdOwnerAddress,
};

function requiredEmailOtpDerivationString(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`[email-otp-derivation] ${field} is required`);
  }
  return normalized;
}

export function toEmailOtpAuthSubjectId(value: unknown): EmailOtpAuthSubjectId {
  return requiredEmailOtpDerivationString(value, 'authSubjectId') as EmailOtpAuthSubjectId;
}

export function toEcdsaDerivationThresholdKeyId(value: unknown): EcdsaThresholdKeyId {
  return parseSdkEcdsaDerivationThresholdKeyId(value);
}

export function toEcdsaDerivationSigningRootId(value: unknown): SigningRootId {
  return parseSdkEcdsaDerivationSigningRootId(value);
}

export function toEcdsaDerivationSigningRootVersion(value: unknown): SigningRootVersion {
  return parseSdkEcdsaDerivationSigningRootVersion(value);
}
