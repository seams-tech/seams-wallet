import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import type {
  GoogleEmailOtpRegistrationAttemptRecord,
  GoogleEmailOtpRegistrationOfferCandidateRecord,
  NonEmptyGoogleEmailOtpRegistrationOfferCandidates,
  PendingGoogleEmailOtpRegistrationAttemptRecord,
} from '../../../../core/EmailOtpStores';
import {
  isB64uString,
  nonNegativeSafeInteger,
  parseJsonObject,
  positiveSafeInteger,
} from '../auth/d1RouterApiAuthBoundary';

export type D1EmailOtpRegistrationAttemptRow = {
  readonly attempt_id?: unknown;
  readonly record_json?: unknown;
  readonly expires_at_ms?: unknown;
  readonly updated_at_ms?: unknown;
};

type GoogleEmailOtpRegistrationOfferForResponse = {
  readonly offerId: string;
  readonly selectedCandidateId: string;
  readonly candidates: readonly [
    { readonly candidateId: string; readonly walletId: string },
    ...{ readonly candidateId: string; readonly walletId: string }[],
  ];
};

type GoogleEmailOtpRegistrationAttemptParseFields = {
  readonly attemptId: string;
  readonly providerSubject: string;
  readonly email: string;
  readonly walletId: string;
  readonly offerId: string;
  readonly offerCandidates: NonEmptyGoogleEmailOtpRegistrationOfferCandidates;
  readonly selectedCandidateId: string;
  readonly ownerProofBindingDigest: string;
  readonly authProvider: string;
  readonly accountIdSlugVersion: 'hmac_readable_v1';
  readonly walletIdDerivationNonce: string;
  readonly collisionCounter: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly expiresAtMs: number;
  readonly runtimePolicyScope?: RuntimePolicyScope;
};

const GOOGLE_EMAIL_OTP_AUTH_PROVIDER = 'google';

export function requireRuntimePolicyScope(input: unknown): RuntimePolicyScope {
  const scope = parseRuntimePolicyScope(input);
  if (scope) return scope;
  throw new Error(
    'runtimePolicyScope.orgId, runtimePolicyScope.projectId, runtimePolicyScope.envId, and runtimePolicyScope.signingRootVersion are required for Google Email OTP registration',
  );
}

export function expiredGoogleEmailOtpRegistrationAttemptRecord(input: {
  readonly record: GoogleEmailOtpRegistrationAttemptRecord;
  readonly updatedAtMs: number;
}): GoogleEmailOtpRegistrationAttemptRecord {
  const terminal = terminalGoogleEmailOtpRegistrationAttemptRecord({
    fields: { ...input.record, updatedAtMs: input.updatedAtMs },
    state: 'expired',
    ...('finalizedPublicKey' in input.record && input.record.finalizedPublicKey
      ? { finalizedPublicKey: input.record.finalizedPublicKey }
      : {}),
    ...('failureCode' in input.record && input.record.failureCode
      ? { failureCode: input.record.failureCode }
      : {}),
  });
  if (!terminal) throw new Error('Failed to build expired Google Email OTP registration attempt');
  return terminal;
}

export function parseGoogleEmailOtpRegistrationAttemptRecord(
  input: unknown,
): GoogleEmailOtpRegistrationAttemptRecord | null {
  const record = parseJsonObject(input);
  if (!record) return null;
  const version = toOptionalTrimmedString(record.version);
  const attemptId = toOptionalTrimmedString(record.attemptId);
  const providerSubject = toOptionalTrimmedString(record.providerSubject);
  const email = toOptionalTrimmedString(record.email);
  const walletId = toOptionalTrimmedString(record.walletId);
  const offerId = toOptionalTrimmedString(record.offerId);
  const offerCandidates = parseGoogleEmailOtpRegistrationOfferCandidates(record.offerCandidates);
  const selectedCandidateId = toOptionalTrimmedString(record.selectedCandidateId);
  const ownerProofBindingDigest = toOptionalTrimmedString(record.ownerProofBindingDigest);
  const authProvider = toOptionalTrimmedString(record.authProvider);
  const accountIdSlugVersion = toOptionalTrimmedString(record.accountIdSlugVersion);
  const walletIdDerivationNonce = toOptionalTrimmedString(record.walletIdDerivationNonce);
  const collisionCounter = nonNegativeSafeInteger(record.collisionCounter);
  const state = googleEmailOtpRegistrationAttemptState(record.state);
  const createdAtMs = positiveSafeInteger(record.createdAtMs);
  const updatedAtMs = positiveSafeInteger(record.updatedAtMs);
  const expiresAtMs = positiveSafeInteger(record.expiresAtMs);
  const runtimePolicyScope = parseRuntimePolicyScope(record.runtimePolicyScope);
  const finalizedPublicKey = toOptionalTrimmedString(record.finalizedPublicKey);
  const failureCode = toOptionalTrimmedString(record.failureCode);
  if (
    version !== 'google_email_otp_registration_attempt_v1' ||
    !attemptId ||
    !providerSubject ||
    !email ||
    !walletId ||
    !offerId ||
    !offerCandidates ||
    !selectedCandidateId ||
    !googleEmailOtpRegistrationOfferContainsCandidate({
      candidates: offerCandidates,
      candidateId: selectedCandidateId,
    }) ||
    !ownerProofBindingDigest ||
    authProvider !== GOOGLE_EMAIL_OTP_AUTH_PROVIDER ||
    accountIdSlugVersion !== 'hmac_readable_v1' ||
    !walletIdDerivationNonce ||
    !isB64uString(walletIdDerivationNonce) ||
    collisionCounter == null ||
    !state ||
    !createdAtMs ||
    !updatedAtMs ||
    !expiresAtMs ||
    updatedAtMs < createdAtMs
  ) {
    return null;
  }
  if (state === 'key_finalized' && !finalizedPublicKey) return null;
  const fields: GoogleEmailOtpRegistrationAttemptParseFields = {
    attemptId,
    providerSubject,
    email,
    walletId,
    offerId,
    offerCandidates,
    selectedCandidateId,
    ownerProofBindingDigest,
    authProvider,
    accountIdSlugVersion: 'hmac_readable_v1',
    walletIdDerivationNonce,
    collisionCounter,
    createdAtMs,
    updatedAtMs,
    expiresAtMs,
    ...(runtimePolicyScope ? { runtimePolicyScope } : {}),
  };
  switch (state) {
    case 'started':
      return registrationAttemptRecord(fields, { state });
    case 'key_finalized':
      return registrationAttemptRecord(fields, {
        state,
        finalizedPublicKey: finalizedPublicKey || '',
      });
    case 'active':
    case 'abandoned':
    case 'failed':
    case 'expired':
      return terminalGoogleEmailOtpRegistrationAttemptRecord({
        fields,
        state,
        ...(finalizedPublicKey ? { finalizedPublicKey } : {}),
        ...(failureCode ? { failureCode } : {}),
      });
  }
}

export function parseGoogleEmailOtpRegistrationAttemptRow(
  row: D1EmailOtpRegistrationAttemptRow | null,
): GoogleEmailOtpRegistrationAttemptRecord | null {
  const record = parseGoogleEmailOtpRegistrationAttemptRecord(row?.record_json);
  const expiresAtMs = positiveSafeInteger(row?.expires_at_ms);
  const updatedAtMs = positiveSafeInteger(row?.updated_at_ms);
  // D1 is the persistence boundary for the current registration protocol. A
  // row without a signed runtime scope belongs to the retired pre-scope shape;
  // treating it as malformed makes callers discard it and issue a fresh offer
  // instead of attempting to rewrite it through the scoped store.
  if (!record || !record.runtimePolicyScope || !expiresAtMs || !updatedAtMs) return null;
  if (record.expiresAtMs !== expiresAtMs || record.updatedAtMs !== updatedAtMs) return null;
  return record;
}

export function googleEmailOtpRegistrationOfferForResponse(
  input: Pick<
    PendingGoogleEmailOtpRegistrationAttemptRecord,
    'offerId' | 'offerCandidates' | 'selectedCandidateId'
  >,
): GoogleEmailOtpRegistrationOfferForResponse {
  const first = input.offerCandidates[0];
  const candidates: { readonly candidateId: string; readonly walletId: string }[] = [
    { candidateId: first.candidateId, walletId: first.walletId },
  ];
  for (let index = 1; index < input.offerCandidates.length; index += 1) {
    const candidate = input.offerCandidates[index];
    if (!candidate) continue;
    candidates.push({ candidateId: candidate.candidateId, walletId: candidate.walletId });
  }
  return {
    offerId: input.offerId,
    selectedCandidateId: input.selectedCandidateId,
    candidates: [candidates[0], ...candidates.slice(1)],
  };
}

export function abandonedGoogleEmailOtpRegistrationAttemptRecord(input: {
  readonly record: PendingGoogleEmailOtpRegistrationAttemptRecord;
  readonly failureCode: 'owner_proof_binding_replaced' | 'offer_restarted_by_user';
  readonly updatedAtMs: number;
}): GoogleEmailOtpRegistrationAttemptRecord {
  return registrationAttemptRecord(
    { ...input.record, updatedAtMs: input.updatedAtMs },
    {
      state: 'abandoned',
      ...(input.record.state === 'key_finalized'
        ? { finalizedPublicKey: input.record.finalizedPublicKey }
        : {}),
      failureCode: input.failureCode,
    },
  );
}

function parseRuntimePolicyScope(input: unknown): RuntimePolicyScope | undefined {
  const record = parseJsonObject(input);
  if (!record) return undefined;
  const orgId = toOptionalTrimmedString(record.orgId);
  const projectId = toOptionalTrimmedString(record.projectId);
  const envId = toOptionalTrimmedString(record.envId);
  const signingRootVersion = toOptionalTrimmedString(record.signingRootVersion);
  if (!orgId || !projectId || !envId || !signingRootVersion) return undefined;
  return { orgId, projectId, envId, signingRootVersion };
}

function parseGoogleEmailOtpRegistrationOfferCandidate(
  input: unknown,
): GoogleEmailOtpRegistrationOfferCandidateRecord | null {
  const record = parseJsonObject(input);
  if (!record) return null;
  const candidateId = toOptionalTrimmedString(record.candidateId);
  const walletId = toOptionalTrimmedString(record.walletId);
  const collisionCounter = nonNegativeSafeInteger(record.collisionCounter);
  if (!candidateId || !walletId || collisionCounter == null) return null;
  return { candidateId, walletId, collisionCounter };
}

export function parseGoogleEmailOtpRegistrationOfferCandidates(
  input: unknown,
): NonEmptyGoogleEmailOtpRegistrationOfferCandidates | null {
  if (!Array.isArray(input)) return null;
  const candidates: GoogleEmailOtpRegistrationOfferCandidateRecord[] = [];
  for (const item of input) {
    const candidate = parseGoogleEmailOtpRegistrationOfferCandidate(item);
    if (!candidate) return null;
    candidates.push(candidate);
  }
  const first = candidates[0];
  if (!first) return null;
  return [first, ...candidates.slice(1)];
}

function googleEmailOtpRegistrationOfferContainsCandidate(input: {
  readonly candidates: NonEmptyGoogleEmailOtpRegistrationOfferCandidates;
  readonly candidateId: string;
}): boolean {
  for (const candidate of input.candidates) {
    if (candidate.candidateId === input.candidateId) return true;
  }
  return false;
}

function googleEmailOtpRegistrationAttemptState(
  input: unknown,
): GoogleEmailOtpRegistrationAttemptRecord['state'] | null {
  const state = toOptionalTrimmedString(input);
  switch (state) {
    case 'started':
    case 'key_finalized':
    case 'active':
    case 'abandoned':
    case 'failed':
    case 'expired':
      return state;
    default:
      return null;
  }
}

/**
 * Builds an attempt from its fields, with `state` carrying the state and the fields stored beside
 * it. The key order is the stored JSON's: terminal states append their own fields after these.
 */
function registrationAttemptRecord<
  const S extends { readonly state: GoogleEmailOtpRegistrationAttemptRecord['state'] },
>(fields: GoogleEmailOtpRegistrationAttemptParseFields, state: S) {
  return {
    version: 'google_email_otp_registration_attempt_v1' as const,
    attemptId: fields.attemptId,
    providerSubject: fields.providerSubject,
    email: fields.email,
    walletId: fields.walletId,
    offerId: fields.offerId,
    offerCandidates: fields.offerCandidates,
    selectedCandidateId: fields.selectedCandidateId,
    ownerProofBindingDigest: fields.ownerProofBindingDigest,
    authProvider: fields.authProvider,
    accountIdSlugVersion: 'hmac_readable_v1' as const,
    walletIdDerivationNonce: fields.walletIdDerivationNonce,
    collisionCounter: fields.collisionCounter,
    ...state,
    createdAtMs: fields.createdAtMs,
    updatedAtMs: fields.updatedAtMs,
    expiresAtMs: fields.expiresAtMs,
    ...(fields.runtimePolicyScope ? { runtimePolicyScope: fields.runtimePolicyScope } : {}),
  };
}

function terminalGoogleEmailOtpRegistrationAttemptRecord(input: {
  readonly fields: GoogleEmailOtpRegistrationAttemptParseFields;
  readonly state: 'active' | 'abandoned' | 'failed' | 'expired';
  readonly finalizedPublicKey?: string;
  readonly failureCode?: string;
}): GoogleEmailOtpRegistrationAttemptRecord | null {
  const finalized = input.finalizedPublicKey
    ? { finalizedPublicKey: input.finalizedPublicKey }
    : {};
  switch (input.state) {
    case 'active':
      return { ...registrationAttemptRecord(input.fields, { state: 'active' }), ...finalized };
    case 'abandoned':
    case 'failed':
      if (!input.failureCode) return null;
      return {
        ...registrationAttemptRecord(input.fields, { state: input.state }),
        ...finalized,
        failureCode: input.failureCode,
      };
    case 'expired':
      return {
        ...registrationAttemptRecord(input.fields, { state: 'expired' }),
        ...finalized,
        ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      };
  }
}
