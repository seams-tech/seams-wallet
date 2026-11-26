import type {
  GoogleEmailOtpRegistrationCandidate,
  GoogleEmailOtpRegistrationCandidateId,
  GoogleEmailOtpRegistrationOffer,
  GoogleEmailOtpRegistrationOfferId,
} from '@/SeamsWeb/publicApi/types';
import { walletIdFromString } from '@shared/utils/registrationIds';
import { requireRecord, requireTrimmedString } from '@shared/utils/validation';

const OTP_ONLY_FORBIDDEN_FIELDS = [
  'delivery',
  'challengeId',
  'otpCode',
  'resend',
  'webauthn',
  'webauthnRegistration',
  'webauthn_registration',
  'authenticatorOptions',
  'publicKey',
  'passkey',
  'passkeyPrfFirstB64u',
] as const;

const SECRET_MATERIAL_FIELDS = [
  'recoveryKeys',
  'recoveryCodes',
  'bootstrap',
  'bootstrapMaterial',
  'clientSecret32',
] as const;

function requireTimestampMs(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer timestamp`);
  }
  return value;
}

function rejectFields(
  record: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const forbiddenField = fields.find((field) =>
    Object.prototype.hasOwnProperty.call(record, field),
  );
  if (forbiddenField) throw new Error(`${label} must not include ${forbiddenField}`);
}

function parseOfferId(value: unknown): GoogleEmailOtpRegistrationOfferId {
  return requireTrimmedString(value, 'offerId') as GoogleEmailOtpRegistrationOfferId;
}

function parseCandidateId(
  value: unknown,
  label = 'candidateId',
): GoogleEmailOtpRegistrationCandidateId {
  return requireTrimmedString(value, label) as GoogleEmailOtpRegistrationCandidateId;
}

function parseCandidate(value: unknown): GoogleEmailOtpRegistrationCandidate {
  const record = requireRecord(value, 'registration candidate');
  rejectFields(record, OTP_ONLY_FORBIDDEN_FIELDS, 'registration candidate');
  rejectFields(record, SECRET_MATERIAL_FIELDS, 'registration candidate');
  return {
    candidateId: parseCandidateId(record.candidateId),
    walletId: walletIdFromString(requireTrimmedString(record.walletId, 'candidate.walletId')),
  };
}

export function parseGoogleEmailOtpRegistrationOffer(
  value: unknown,
): GoogleEmailOtpRegistrationOffer {
  const record = requireRecord(value, 'Google Email OTP registration offer');
  rejectFields(record, OTP_ONLY_FORBIDDEN_FIELDS, 'Google Email OTP registration offer');
  rejectFields(record, SECRET_MATERIAL_FIELDS, 'Google Email OTP registration offer');
  if (record.kind !== 'google_email_otp_registration_offer_v1') {
    throw new Error('registration offer kind must be google_email_otp_registration_offer_v1');
  }
  if (!Array.isArray(record.candidates) || record.candidates.length < 1) {
    throw new Error('registration offer must include at least one candidate');
  }
  const candidates = record.candidates.map(parseCandidate);
  const selectedCandidateId = parseCandidateId(record.selectedCandidateId, 'selectedCandidateId');
  if (!candidates.some((candidate) => candidate.candidateId === selectedCandidateId)) {
    throw new Error('selectedCandidateId must refer to an offered candidate');
  }
  const [firstCandidate, ...remainingCandidates] = candidates;
  return {
    kind: 'google_email_otp_registration_offer_v1',
    offerId: parseOfferId(record.offerId),
    expiresAtMs: requireTimestampMs(record.expiresAtMs, 'expiresAtMs'),
    emailHint: requireTrimmedString(record.emailHint, 'emailHint'),
    candidates: [firstCandidate, ...remainingCandidates],
    selectedCandidateId,
  };
}
