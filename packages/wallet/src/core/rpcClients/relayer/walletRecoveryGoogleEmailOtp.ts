import {
  parsePasskeyCustodyEnvelopeRecord,
  type PasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';
import {
  parseEmailOtpChallengeId,
  parseEmailOtpProviderUserId,
  parseWalletRecoveryOperationId,
  type EmailOtpChallengeId,
  type WalletId,
  type WalletRecoveryOperationId,
} from '@shared/utils/domainIds';
import type { DeviceId } from '@shared/authorization/capabilityKinds';
import type { WalletAuthMethodId, WalletAuthorityId } from '@shared/utils/domainIds';
import type { WalletAuthMethodRecordV2 } from '@shared/utils/registrationIntent';
import {
  parseRecoveryCodeReservationId,
  type RecoveryCodeReservationId,
} from '@shared/wallet-recovery/recoveryCodeReservation';
import {
  parseWalletRecoveryEcdsaPossessionProofV1,
  type WalletRecoveryEcdsaPossessionProofV1,
} from '@shared/wallet-recovery/walletRecoveryEcdsaPossession';
import { parseEmailOtpChallengeDelivery } from '@/core/signingEngine/session/emailOtp/challengeDelivery';
import type { EmailOtpChallengeDelivery } from '@/core/signingEngine/session/emailOtp/publicTypes';
import type { ActiveRecoveredWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import {
  parseWalletRecoveryCommittedProjectionV1,
  type WalletRecoveryCommittedProjectionExpectationV1,
} from '@shared/wallet-recovery/walletRecoveryCommittedProjection';
import { buildRelayerJsonPostRequestInit, normalizeRelayerBaseUrl } from './relayerHttp';
import type { WalletRecoveryAttemptFailure } from './walletRecoveryPrepare';

const GOOGLE_VERIFY_PATH = '/wallets/recovery/google/verify';
const EMAIL_OTP_VERIFY_PATH = '/wallets/recovery/email-otp/verify';
const GOOGLE_EMAIL_OTP_FINALIZE_PATH = '/wallets/recovery/google-email-otp/finalize';

type RecoveryOperationInput = {
  readonly relayUrl: string;
  readonly recoveryOperationId: WalletRecoveryOperationId;
  readonly reservationId: RecoveryCodeReservationId;
  readonly fetchImpl?: typeof fetch;
};

export type WalletRecoveryGoogleVerifyResult =
  | {
      readonly kind: 'verified';
      readonly recoveryOperationId: WalletRecoveryOperationId;
      readonly reservationId: RecoveryCodeReservationId;
      readonly challengeId: EmailOtpChallengeId;
      readonly delivery: EmailOtpChallengeDelivery;
      readonly expiresAtMs: number;
    }
  | WalletRecoveryAttemptFailure;

export type WalletRecoveryEmailOtpVerifyResult =
  | {
      readonly kind: 'verified';
      readonly recoveryOperationId: WalletRecoveryOperationId;
      readonly reservationId: RecoveryCodeReservationId;
      readonly challengeId: EmailOtpChallengeId;
    }
  | WalletRecoveryAttemptFailure;

export type WalletRecoveryEmailOtpEnrollmentMaterial = {
  readonly enrollmentSealKeyVersion: string;
  readonly clientUnlockPublicKeyB64u: string;
  readonly unlockKeyVersion: string;
  readonly serverSealedFactorCiphertextB64u: string;
};

export type WalletRecoveryGoogleEmailOtpFinalizeResult =
  | {
      readonly kind: 'promoted';
      readonly storeVersion: string;
      readonly authority: ActiveRecoveredWalletAuthorityV1;
      readonly authMethod: Extract<
        WalletAuthMethodRecordV2,
        { readonly kind: 'email_otp'; readonly status: 'active' }
      >;
    }
  | WalletRecoveryAttemptFailure;

export async function verifyWalletRecoveryGoogle(
  args: RecoveryOperationInput & { readonly idToken: string },
): Promise<WalletRecoveryGoogleVerifyResult> {
  const response = await postRecoveryJson(args, GOOGLE_VERIFY_PATH, {
    recoveryOperationId: args.recoveryOperationId,
    reservationId: args.reservationId,
    idToken: args.idToken,
  });
  if (!response.ok) return response.failure;
  try {
    const body = decodeWalletRecoveryGoogleVerifyResponse(response.body);
    const identity = parseRecoveryResponseIdentity(body, args);
    const challengeId = requireParsed(parseEmailOtpChallengeId(body.challengeId));
    const expiresAtMs = Number(body.expiresAtMs);
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) throw new Error('invalid expiry');
    return {
      kind: 'verified',
      ...identity,
      challengeId,
      delivery: parseEmailOtpChallengeDelivery(
        body.delivery,
        'walletRecoveryGoogleVerify.delivery',
      ),
      expiresAtMs,
    };
  } catch {
    return { kind: 'transport_uncertain' };
  }
}

export async function verifyWalletRecoveryEmailOtp(
  args: RecoveryOperationInput & {
    readonly challengeId: EmailOtpChallengeId;
    readonly otpCode: string;
  },
): Promise<WalletRecoveryEmailOtpVerifyResult> {
  const response = await postRecoveryJson(args, EMAIL_OTP_VERIFY_PATH, {
    recoveryOperationId: args.recoveryOperationId,
    reservationId: args.reservationId,
    challengeId: args.challengeId,
    otpCode: args.otpCode,
  });
  if (!response.ok) return response.failure;
  try {
    const body = decodeWalletRecoveryEmailOtpVerifyResponse(response.body);
    const identity = parseRecoveryResponseIdentity(body, args);
    const challengeId = requireParsed(parseEmailOtpChallengeId(body.challengeId));
    if (challengeId !== args.challengeId) throw new Error('challenge changed');
    return { kind: 'verified', ...identity, challengeId };
  } catch {
    return { kind: 'transport_uncertain' };
  }
}

export async function finalizeWalletRecoveryGoogleEmailOtp(
  args: RecoveryOperationInput & {
    readonly walletId: WalletId;
    readonly targetDeviceId: DeviceId;
    readonly targetAuthorityId: WalletAuthorityId;
    readonly targetWalletAuthMethodId: WalletAuthMethodId;
    readonly expectedProviderSubject: string;
    readonly expectedEmailHashHex: string;
    readonly expectedRegistrationAuthorityId: string;
    readonly replacementEnvelope: PasskeyCustodyEnvelopeRecord;
    readonly ecdsaMaterialPossessionProofs: readonly {
      readonly keySetId: `evm_family_ecdsa:${string}`;
      readonly proof: WalletRecoveryEcdsaPossessionProofV1;
    }[];
    readonly emailOtpEnrollment: {
      readonly kind: 'create';
      readonly material: WalletRecoveryEmailOtpEnrollmentMaterial;
    } | null;
  },
): Promise<WalletRecoveryGoogleEmailOtpFinalizeResult> {
  let replacementEnvelope: PasskeyCustodyEnvelopeRecord;
  let ecdsaMaterialPossessionProofs: readonly {
    readonly keySetId: `evm_family_ecdsa:${string}`;
    readonly proof: WalletRecoveryEcdsaPossessionProofV1;
  }[];
  try {
    replacementEnvelope = parsePasskeyCustodyEnvelopeRecord(
      args.replacementEnvelope,
      'walletRecoveryGoogleEmailOtpFinalize.replacementEnvelope',
    );
    if (replacementEnvelope.factor.kind !== 'email_otp') throw new Error('wrong factor');
    ecdsaMaterialPossessionProofs = args.ecdsaMaterialPossessionProofs.map((entry) => ({
      keySetId: entry.keySetId,
      proof: parseWalletRecoveryEcdsaPossessionProofV1(entry.proof),
    }));
  } catch {
    return { kind: 'refused' };
  }
  const response = await postRecoveryJson(args, GOOGLE_EMAIL_OTP_FINALIZE_PATH, {
    kind: 'finalize',
    recoveryOperationId: args.recoveryOperationId,
    reservationId: args.reservationId,
    replacementEnvelope,
    ecdsaMaterialPossessionProofs,
    ...(args.emailOtpEnrollment ? { emailOtpEnrollment: args.emailOtpEnrollment } : {}),
  });
  if (!response.ok) return response.failure;
  try {
    const body = decodeWalletRecoveryProjectionResponse(
      response.body,
      'walletRecoveryGoogleEmailOtpFinalize',
    );
    const projection = await parseWalletRecoveryCommittedProjectionV1(
      body.projection,
      buildGoogleEmailOtpProjectionExpectation(args, replacementEnvelope),
    );
    if (projection.kind !== 'google_email_otp')
      throw new Error('recovery projection branch changed');
    return {
      kind: 'promoted',
      storeVersion: projection.storeVersion,
      authority: projection.authority,
      authMethod: projection.authMethod,
    };
  } catch {
    return { kind: 'transport_uncertain' };
  }
}

/** Replays an already-committed Email OTP recovery without an OTP or factor. */
export async function replayWalletRecoveryGoogleEmailOtp(args: {
  readonly relayUrl: string;
  readonly recoveryOperationId: WalletRecoveryOperationId;
  readonly reservationId: RecoveryCodeReservationId;
  readonly walletId: WalletId;
  readonly targetDeviceId: DeviceId;
  readonly targetAuthorityId: WalletAuthorityId;
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly expectedProviderSubject: string;
  readonly expectedEmailHashHex: string;
  readonly expectedRegistrationAuthorityId: string;
  readonly replacementEnvelope: PasskeyCustodyEnvelopeRecord;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletRecoveryGoogleEmailOtpFinalizeResult> {
  let replacementEnvelope: PasskeyCustodyEnvelopeRecord;
  try {
    replacementEnvelope = parsePasskeyCustodyEnvelopeRecord(
      args.replacementEnvelope,
      'walletRecoveryGoogleEmailOtpReplay.replacementEnvelope',
    );
    if (
      replacementEnvelope.factor.kind !== 'email_otp' ||
      String(replacementEnvelope.walletId) !== String(args.walletId)
    ) {
      throw new Error('recovery replay envelope identity is invalid');
    }
  } catch {
    return { kind: 'refused' };
  }
  const response = await postRecoveryJson(args, GOOGLE_EMAIL_OTP_FINALIZE_PATH, {
    kind: 'replay',
    recoveryOperationId: args.recoveryOperationId,
    reservationId: args.reservationId,
    replacementEnvelope,
  });
  if (!response.ok) return response.failure;
  try {
    const body = decodeWalletRecoveryProjectionResponse(
      response.body,
      'walletRecoveryGoogleEmailOtpReplay',
    );
    const projection = await parseWalletRecoveryCommittedProjectionV1(
      body.projection,
      buildGoogleEmailOtpProjectionExpectation(args, replacementEnvelope),
    );
    if (projection.kind !== 'google_email_otp') {
      throw new Error('recovery projection branch changed');
    }
    return {
      kind: 'promoted',
      storeVersion: projection.storeVersion,
      authority: projection.authority,
      authMethod: projection.authMethod,
    };
  } catch {
    return { kind: 'transport_uncertain' };
  }
}

type RecoveryJsonResponse =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: WalletRecoveryAttemptFailure };

async function postRecoveryJson(
  args: RecoveryOperationInput,
  path: string,
  body: RecoveryRequestBody,
): Promise<RecoveryJsonResponse> {
  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)(
      `${normalizeRelayerBaseUrl(args.relayUrl)}${path}`,
      buildRelayerJsonPostRequestInit({ body }),
    );
  } catch {
    return { ok: false, failure: { kind: 'transport_uncertain' } };
  }
  const responseBody = await response.json().catch(() => undefined);
  if (response.status === 200) {
    return { ok: true, body: responseBody };
  }
  if (response.status === 409 || response.status === 429) {
    return { ok: false, failure: { kind: 'retryable_conflict' } };
  }
  if (response.status === 400 || response.status === 401) {
    return { ok: false, failure: { kind: 'refused' } };
  }
  return { ok: false, failure: { kind: 'transport_uncertain' } };
}

function parseRecoveryResponseIdentity(
  body: RecoveryIdentityResponseDto,
  expected: Pick<RecoveryOperationInput, 'recoveryOperationId' | 'reservationId'>,
): {
  readonly recoveryOperationId: WalletRecoveryOperationId;
  readonly reservationId: RecoveryCodeReservationId;
} {
  const recoveryOperationId = requireParsed(
    parseWalletRecoveryOperationId(body.recoveryOperationId),
  );
  const reservationId = parseRecoveryCodeReservationId(body.reservationId);
  if (
    recoveryOperationId !== expected.recoveryOperationId ||
    reservationId !== expected.reservationId
  ) {
    throw new Error('recovery operation identity changed');
  }
  return { recoveryOperationId, reservationId };
}

type RecoveryIdentityResponseDto = {
  readonly recoveryOperationId: unknown;
  readonly reservationId: unknown;
};

type WalletRecoveryGoogleVerifyResponseDto = RecoveryIdentityResponseDto & {
  readonly challengeId: unknown;
  readonly delivery: unknown;
  readonly expiresAtMs: unknown;
};

type WalletRecoveryEmailOtpVerifyResponseDto = RecoveryIdentityResponseDto & {
  readonly challengeId: unknown;
};

type WalletRecoveryProjectionResponseDto = {
  readonly projection: unknown;
};

type RecoveryRequestBody =
  | {
      readonly recoveryOperationId: WalletRecoveryOperationId;
      readonly reservationId: RecoveryCodeReservationId;
      readonly idToken: string;
    }
  | {
      readonly recoveryOperationId: WalletRecoveryOperationId;
      readonly reservationId: RecoveryCodeReservationId;
      readonly challengeId: EmailOtpChallengeId;
      readonly otpCode: string;
    }
  | {
      readonly kind: 'finalize';
      readonly recoveryOperationId: WalletRecoveryOperationId;
      readonly reservationId: RecoveryCodeReservationId;
      readonly replacementEnvelope: PasskeyCustodyEnvelopeRecord;
      readonly ecdsaMaterialPossessionProofs: readonly {
        readonly keySetId: `evm_family_ecdsa:${string}`;
        readonly proof: WalletRecoveryEcdsaPossessionProofV1;
      }[];
      readonly emailOtpEnrollment?: {
        readonly kind: 'create';
        readonly material: WalletRecoveryEmailOtpEnrollmentMaterial;
      };
    }
  | {
      readonly kind: 'replay';
      readonly recoveryOperationId: WalletRecoveryOperationId;
      readonly reservationId: RecoveryCodeReservationId;
      readonly replacementEnvelope: PasskeyCustodyEnvelopeRecord;
    };

function decodeWalletRecoveryGoogleVerifyResponse(
  value: unknown,
): WalletRecoveryGoogleVerifyResponseDto {
  const response = requireExactJsonResponse(
    value,
    ['ok', 'recoveryOperationId', 'reservationId', 'challengeId', 'delivery', 'expiresAtMs'],
    'walletRecoveryGoogleVerify',
  );
  requireSuccessfulResponse(response, 'walletRecoveryGoogleVerify');
  return {
    recoveryOperationId: readResponseField(response, 'recoveryOperationId'),
    reservationId: readResponseField(response, 'reservationId'),
    challengeId: readResponseField(response, 'challengeId'),
    delivery: readResponseField(response, 'delivery'),
    expiresAtMs: readResponseField(response, 'expiresAtMs'),
  };
}

function decodeWalletRecoveryEmailOtpVerifyResponse(
  value: unknown,
): WalletRecoveryEmailOtpVerifyResponseDto {
  const response = requireExactJsonResponse(
    value,
    ['ok', 'recoveryOperationId', 'reservationId', 'challengeId'],
    'walletRecoveryEmailOtpVerify',
  );
  requireSuccessfulResponse(response, 'walletRecoveryEmailOtpVerify');
  return {
    recoveryOperationId: readResponseField(response, 'recoveryOperationId'),
    reservationId: readResponseField(response, 'reservationId'),
    challengeId: readResponseField(response, 'challengeId'),
  };
}

function decodeWalletRecoveryProjectionResponse(
  value: unknown,
  label: string,
): WalletRecoveryProjectionResponseDto {
  const response = requireExactJsonResponse(value, ['ok', 'projection'], label);
  requireSuccessfulResponse(response, label);
  return { projection: readResponseField(response, 'projection') };
}

function requireExactJsonResponse(
  value: unknown,
  fields: readonly string[],
  label: string,
): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain JSON object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !hasExactResponseFields(keys, fields)) {
    throw new Error(`${label} has an unexpected response shape`);
  }
  return value;
}

function hasExactResponseFields(keys: readonly string[], fields: readonly string[]): boolean {
  for (const field of fields) {
    if (!keys.includes(field)) return false;
  }
  return true;
}

function requireSuccessfulResponse(value: object, label: string): void {
  if (readResponseField(value, 'ok') !== true) {
    throw new Error(`${label} did not succeed`);
  }
}

function readResponseField(value: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || !('value' in descriptor)) {
    throw new Error(`response field ${field} is missing`);
  }
  return descriptor.value;
}

function requireParsed<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  if (!result.ok) throw new Error('invalid domain identity');
  return result.value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('value must be a string');
  return value.trim();
}

function buildGoogleEmailOtpProjectionExpectation(
  args: {
    readonly walletId: WalletId;
    readonly recoveryOperationId: WalletRecoveryOperationId;
    readonly targetDeviceId: DeviceId;
    readonly targetAuthorityId: WalletAuthorityId;
    readonly targetWalletAuthMethodId: WalletAuthMethodId;
    readonly expectedProviderSubject: string;
    readonly expectedEmailHashHex: string;
    readonly expectedRegistrationAuthorityId: string;
  },
  replacementEnvelope: PasskeyCustodyEnvelopeRecord,
): WalletRecoveryCommittedProjectionExpectationV1 {
  if (replacementEnvelope.factor.kind !== 'email_otp') {
    throw new Error('replacement envelope is not an Email OTP envelope');
  }
  return {
    kind: 'google_email_otp',
    walletId: args.walletId,
    recoveryOperationId: args.recoveryOperationId,
    targetDeviceId: args.targetDeviceId,
    targetAuthorityId: args.targetAuthorityId,
    targetWalletAuthMethodId: args.targetWalletAuthMethodId,
    providerSubject: requireParsed(parseEmailOtpProviderUserId(args.expectedProviderSubject)),
    emailHashHex: requireEmailHash(args.expectedEmailHashHex),
    registrationAuthorityId: requireString(args.expectedRegistrationAuthorityId),
    enrollment: {
      kind: 'email_otp_enrollment_reference_v1',
      enrollmentId: requireString(replacementEnvelope.factor.enrollmentId),
      enrollmentSealKeyVersion: requireString(replacementEnvelope.factor.enrollmentSealKeyVersion),
    },
  };
}

function requireEmailHash(value: string): string {
  const hash = requireString(value);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('email hash is invalid');
  return hash;
}
