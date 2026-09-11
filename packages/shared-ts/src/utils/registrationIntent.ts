import { alphabetizeStringify, sha256BytesUtf8 } from './digests';
import type {
  ChallengeSubjectId,
  EmailOtpChallengeId,
  EmailOtpProviderUserId,
  OrgId,
  ProviderSubject,
  WalletAuthorityId,
  WalletAuthMethodId,
  WalletId,
  WebAuthnCredentialIdB64u,
  WebAuthnRpId,
} from './domainIds';
import {
  parseEmailOtpProviderUserId,
  parseWalletAuthorityId,
  parseWalletAuthMethodId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
} from './domainIds';
import { base64UrlEncode } from './encoders';
import { parseDigestB64u, type DigestB64u } from './canonicalPrimitives';
import type { EmailOtpProvider } from './walletAuthAuthority';
import type { WebAuthnAuthenticatorDeviceInfo } from './webauthnDeviceInfo';
import {
  parseNamedNearAccountId,
  type ImplicitNearAccountId,
  type NamedNearAccountId,
} from './near';

export type { WalletId, WebAuthnRpId } from './domainIds';
export type { ImplicitNearAccountId, NamedNearAccountId, NearAccountId } from './near';

export type RegistrationIntentGrant = string & {
  readonly __registrationIntentGrantBrand: unique symbol;
};

export type AddAuthMethodIntentGrant = string & {
  readonly __addAuthMethodIntentGrantBrand: unique symbol;
};

export type AddSignerIntentGrant = string & {
  readonly __addSignerIntentGrantBrand: unique symbol;
};

export type ServerAllocatedWalletId = WalletId & {
  readonly __serverAllocatedWalletIdBrand: unique symbol;
};

export type NearEd25519SigningKeyId = string & {
  readonly __nearEd25519SigningKeyIdBrand: unique symbol;
};

export type RegisterWalletInput =
  | {
      kind: 'server_allocated';
      walletId?: never;
    }
  | {
      kind: 'provided';
      walletId: WalletId;
    };

export type PasskeyRegistrationAuthMethodInput = {
  kind: 'passkey';
  rpId: WebAuthnRpId;
  authenticatorOptions?: unknown;
  email?: never;
  otpCode?: never;
  challengeId?: never;
};

export type EmailOtpRegistrationAuthMethodInput =
  | {
      kind: 'email_otp';
      proofKind: 'otp_challenge';
      email: string;
      providerSubject: string;
      otpCode: string;
      challengeId?: string;
      rpId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
      authenticatorOptions?: never;
    }
  | {
      kind: 'email_otp';
      proofKind: 'google_sso_registration';
      email: string;
      providerSubject: string;
      googleEmailOtpRegistrationAttemptId: string;
      googleEmailOtpRegistrationOfferId: string;
      googleEmailOtpRegistrationCandidateId: string;
      rpId?: never;
      otpCode?: never;
      challengeId?: never;
      authenticatorOptions?: never;
    };

export type RegistrationAuthMethodInput =
  | PasskeyRegistrationAuthMethodInput
  | EmailOtpRegistrationAuthMethodInput;

export type AddAuthMethodInput =
  | {
      kind: 'passkey';
      rpId: WebAuthnRpId;
      email?: never;
      otpCode?: never;
      challengeId?: never;
      authenticatorOptions?: never;
    }
  | {
      kind: 'email_otp';
      email: string;
      rpId?: never;
      otpCode?: never;
      challengeId?: never;
      authenticatorOptions?: never;
    };

export type WalletAuthMethodRevocationProof =
  | {
      readonly kind: 'webauthn_assertion';
      rpId: WebAuthnRpId;
      credential: unknown;
      expectedChallengeDigestB64u: string;
    }
  | {
      readonly kind: 'email_otp';
      readonly challengeId: string;
      readonly otpCode: string;
      readonly ownerProofBindingDigest: string;
    };

export async function computeWalletAuthMethodRevokeOperationFingerprintV1(input: {
  readonly walletId: WalletId;
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly requestedAtMs: number;
}): Promise<DigestB64u> {
  return parseDigestB64u(
    base64UrlEncode(
      await sha256BytesUtf8(
        alphabetizeStringify({
          version: 'wallet_auth_method_revoke_operation_v1',
          walletId: String(input.walletId),
          targetWalletAuthMethodId: String(input.targetWalletAuthMethodId),
          requestedAtMs: input.requestedAtMs,
        }),
      ),
    ),
  );
}

export type RegistrationAuthority =
  | {
      kind: 'passkey';
      walletId: WalletId;
      rpId: WebAuthnRpId;
      credentialIdB64u: string;
      credentialPublicKeyB64u: string;
      counter: number;
      /** Device metadata captured at registration verification (UA + attestation). */
      device: WebAuthnAuthenticatorDeviceInfo;
      registrationIntentDigestB64u: string;
      providerSubject?: never;
      challengeSubjectId?: never;
      email?: never;
      emailHashHex?: never;
      registrationAuthorityId?: never;
      challengeId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      originalWalletId?: never;
      finalWalletId?: never;
      orgId?: never;
      challengePurpose?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    }
  | {
      kind: 'email_otp';
      proofKind: 'otp_challenge';
      walletId: WalletId;
      /** OIDC provider subject verified for the OTP registration proof. */
      providerSubject: ProviderSubject;
      /** Challenge owner verified against the OTP challenge record. */
      challengeSubjectId: ChallengeSubjectId;
      /** Normalized email address that received and verified the OTP. */
      email: string;
      emailHashHex: string;
      challengeId: EmailOtpChallengeId;
      registrationAuthorityId: EmailOtpChallengeId;
      /** Wallet id attached to the original OTP challenge before any name reroll. */
      originalWalletId: WalletId;
      /** Final wallet id selected for registration. */
      finalWalletId: WalletId;
      /** Tenant scope verified against the OTP challenge record. */
      orgId: OrgId;
      /** Operation-bound owner proof digest verified against the OTP challenge record. */
      ownerProofBindingDigest: string;
      challengePurpose: 'registration' | 'registration_reroll';
      registrationIntentDigestB64u: string;
      credentialIdB64u?: never;
      credentialPublicKeyB64u?: never;
      counter?: never;
      device?: never;
      rpId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    }
  | {
      kind: 'email_otp';
      proofKind: 'google_sso_registration';
      walletId: WalletId;
      providerSubject: ProviderSubject;
      email: string;
      emailHashHex: string;
      googleEmailOtpRegistrationAttemptId: string;
      googleEmailOtpRegistrationOfferId: string;
      googleEmailOtpRegistrationCandidateId: string;
      registrationAuthorityId: string;
      finalWalletId: WalletId;
      orgId: OrgId;
      ownerProofBindingDigest: string;
      registrationIntentDigestB64u: string;
      challengeSubjectId?: never;
      challengeId?: never;
      originalWalletId?: never;
      challengePurpose?: never;
      credentialIdB64u?: never;
      credentialPublicKeyB64u?: never;
      counter?: never;
      device?: never;
      rpId?: never;
    };

export type EmailOtpRegistrationProof =
  | {
      version: 'email_otp_registration_proof_v1';
      proofKind: 'otp_challenge';
      providerSubject: string;
      /** Normalized email address that received the OTP. */
      email: string;
      challengeId: string;
      otpCode: string;
      otpChannel: 'email_otp';
      /** Registration intent digest that binds the OTP proof to the wallet-registration request. */
      registrationIntentDigestB64u: string;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    }
  | {
      version: 'email_otp_registration_proof_v1';
      proofKind: 'google_sso_registration';
      providerSubject: string;
      email: string;
      googleEmailOtpRegistrationAttemptId: string;
      googleEmailOtpRegistrationOfferId: string;
      googleEmailOtpRegistrationCandidateId: string;
      registrationIntentDigestB64u: string;
      challengeId?: never;
      otpCode?: never;
      otpChannel?: never;
    };

export type WalletAuthMethodRecord =
  | {
      version: 'wallet_auth_method_v1';
      kind: 'passkey';
      status: 'active' | 'revoked';
      walletId: WalletId;
      rpId: WebAuthnRpId;
      credentialIdB64u: string;
      credentialPublicKeyB64u: string;
      counter: number;
      createdAtMs: number;
      updatedAtMs: number;
      emailHashHex?: never;
      challengeId?: never;
    }
  | {
      version: 'wallet_auth_method_v1';
      kind: 'email_otp';
      status: 'active' | 'revoked';
      walletId: WalletId;
      emailHashHex: string;
      registrationAuthorityId: string;
      createdAtMs: number;
      updatedAtMs: number;
      rpId?: never;
      credentialIdB64u?: never;
      credentialPublicKeyB64u?: never;
      counter?: never;
    };

export type WalletAuthMethodLifecycleV1 =
  | {
      readonly status: 'pending_local_install';
      readonly activatedAtMs?: never;
      readonly revokedAtMs?: never;
    }
  | {
      readonly status: 'active';
      readonly activatedAtMs: number;
      readonly revokedAtMs?: never;
    }
  | {
      readonly status: 'revoked';
      readonly activatedAtMs: number;
      readonly revokedAtMs: number;
    };

type WalletAuthMethodDraftCommonV1 = {
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly walletId: WalletId;
  readonly createdAtMs: number;
};

export type PasskeyWalletAuthMethodDraftV1 = WalletAuthMethodDraftCommonV1 & {
  readonly kind: 'passkey';
  readonly rpId: WebAuthnRpId;
  readonly credentialIdB64u: WebAuthnCredentialIdB64u;
  readonly credentialPublicKeyB64u: string;
  readonly counter: number;
  readonly emailHashHex?: never;
  readonly registrationAuthorityId?: never;
};

export type EmailOtpWalletAuthMethodDraftV1 = WalletAuthMethodDraftCommonV1 & {
  readonly kind: 'email_otp';
  readonly emailHashHex: string;
  readonly registrationAuthorityId: string;
  readonly rpId?: never;
  readonly credentialIdB64u?: never;
  readonly credentialPublicKeyB64u?: never;
  readonly counter?: never;
};

export type WalletAuthMethodCommonV1 = {
  readonly version: 'wallet_auth_method_v2';
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly walletId: WalletId;
  readonly walletAuthorityId: WalletAuthorityId;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type WalletAuthMethodRecordV2 = WalletAuthMethodCommonV1 &
  (
    | (PasskeyWalletAuthMethodDraftV1 & WalletAuthMethodLifecycleV1)
    | (EmailOtpWalletAuthMethodDraftV1 & WalletAuthMethodLifecycleV1)
  );

export function sameWalletAuthMethodRecordV2(
  left: WalletAuthMethodRecordV2,
  right: WalletAuthMethodRecordV2,
): boolean {
  if (
    left.version !== right.version ||
    left.walletAuthMethodId !== right.walletAuthMethodId ||
    left.walletId !== right.walletId ||
    left.walletAuthorityId !== right.walletAuthorityId ||
    left.status !== right.status ||
    left.createdAtMs !== right.createdAtMs ||
    left.updatedAtMs !== right.updatedAtMs
  ) {
    return false;
  }
  switch (left.kind) {
    case 'passkey':
      if (right.kind !== 'passkey') return false;
      if (
        left.rpId === right.rpId &&
        left.credentialIdB64u === right.credentialIdB64u &&
        left.credentialPublicKeyB64u === right.credentialPublicKeyB64u &&
        left.counter === right.counter
      ) {
        break;
      }
      return false;
    case 'email_otp':
      if (right.kind !== 'email_otp') return false;
      if (
        left.emailHashHex === right.emailHashHex &&
        left.registrationAuthorityId === right.registrationAuthorityId
      ) {
        break;
      }
      return false;
    default:
      return assertNeverWalletAuthMethodRecordV2(left, 'wallet auth method kind');
  }

  switch (left.status) {
    case 'pending_local_install':
      return right.status === 'pending_local_install';
    case 'active':
      return right.status === 'active' && left.activatedAtMs === right.activatedAtMs;
    case 'revoked':
      return (
        right.status === 'revoked' &&
        left.activatedAtMs === right.activatedAtMs &&
        left.revokedAtMs === right.revokedAtMs
      );
    default:
      return assertNeverWalletAuthMethodRecordV2(left, 'wallet auth method lifecycle');
  }
}

function assertNeverWalletAuthMethodRecordV2(value: never, label: string): never {
  throw new Error(`${label} branch is unsupported: ${String(value)}`);
}

export function buildWalletAuthMethodRecordV2(
  input: WalletAuthMethodRecordV2,
): WalletAuthMethodRecordV2 {
  validateWalletAuthMethodRecordV2(input);
  if (input.kind === 'passkey') {
    switch (input.status) {
      case 'pending_local_install':
        return {
          version: 'wallet_auth_method_v2',
          walletAuthMethodId: input.walletAuthMethodId,
          walletId: input.walletId,
          walletAuthorityId: input.walletAuthorityId,
          kind: 'passkey',
          status: 'pending_local_install',
          rpId: input.rpId,
          credentialIdB64u: input.credentialIdB64u,
          credentialPublicKeyB64u: input.credentialPublicKeyB64u,
          counter: input.counter,
          createdAtMs: input.createdAtMs,
          updatedAtMs: input.updatedAtMs,
        };
      case 'active':
        return {
          version: 'wallet_auth_method_v2',
          walletAuthMethodId: input.walletAuthMethodId,
          walletId: input.walletId,
          walletAuthorityId: input.walletAuthorityId,
          kind: 'passkey',
          status: 'active',
          rpId: input.rpId,
          credentialIdB64u: input.credentialIdB64u,
          credentialPublicKeyB64u: input.credentialPublicKeyB64u,
          counter: input.counter,
          createdAtMs: input.createdAtMs,
          updatedAtMs: input.updatedAtMs,
          activatedAtMs: input.activatedAtMs,
        };
      case 'revoked':
        return {
          version: 'wallet_auth_method_v2',
          walletAuthMethodId: input.walletAuthMethodId,
          walletId: input.walletId,
          walletAuthorityId: input.walletAuthorityId,
          kind: 'passkey',
          status: 'revoked',
          rpId: input.rpId,
          credentialIdB64u: input.credentialIdB64u,
          credentialPublicKeyB64u: input.credentialPublicKeyB64u,
          counter: input.counter,
          createdAtMs: input.createdAtMs,
          updatedAtMs: input.updatedAtMs,
          activatedAtMs: input.activatedAtMs,
          revokedAtMs: input.revokedAtMs,
        };
    }
  }
  switch (input.status) {
    case 'pending_local_install':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.walletAuthMethodId,
        walletId: input.walletId,
        walletAuthorityId: input.walletAuthorityId,
        kind: 'email_otp',
        status: 'pending_local_install',
        emailHashHex: input.emailHashHex,
        registrationAuthorityId: input.registrationAuthorityId,
        createdAtMs: input.createdAtMs,
        updatedAtMs: input.updatedAtMs,
      };
    case 'active':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.walletAuthMethodId,
        walletId: input.walletId,
        walletAuthorityId: input.walletAuthorityId,
        kind: 'email_otp',
        status: 'active',
        emailHashHex: input.emailHashHex,
        registrationAuthorityId: input.registrationAuthorityId,
        createdAtMs: input.createdAtMs,
        updatedAtMs: input.updatedAtMs,
        activatedAtMs: input.activatedAtMs,
      };
    case 'revoked':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.walletAuthMethodId,
        walletId: input.walletId,
        walletAuthorityId: input.walletAuthorityId,
        kind: 'email_otp',
        status: 'revoked',
        emailHashHex: input.emailHashHex,
        registrationAuthorityId: input.registrationAuthorityId,
        createdAtMs: input.createdAtMs,
        updatedAtMs: input.updatedAtMs,
        activatedAtMs: input.activatedAtMs,
        revokedAtMs: input.revokedAtMs,
      };
  }
}

export function parseWalletAuthMethodRecordV2(raw: unknown): WalletAuthMethodRecordV2 | null {
  const record = inspectRawObject(raw);
  if (!record || !('version' in record) || !('kind' in record) || !('status' in record)) {
    return null;
  }
  const version = trimString(record.version);
  const kind = trimString(record.kind);
  const status = trimString(record.status);
  if (version !== 'wallet_auth_method_v2' || (kind !== 'passkey' && kind !== 'email_otp')) {
    return null;
  }
  try {
    const common = parseWalletAuthMethodRecordV2Common(record);
    if (kind === 'passkey') {
      if (
        !('rpId' in record) ||
        !('credentialIdB64u' in record) ||
        !('credentialPublicKeyB64u' in record) ||
        !('counter' in record)
      ) {
        return null;
      }
      exactWalletAuthMethodV2Fields(record, 'passkey', status);
      const rpId = parseWebAuthnRpId(record.rpId);
      const credentialIdB64u = parseWebAuthnCredentialIdB64u(record.credentialIdB64u);
      if (
        !rpId.ok ||
        !credentialIdB64u.ok ||
        typeof record.credentialPublicKeyB64u !== 'string' ||
        !record.credentialPublicKeyB64u.trim() ||
        Object.prototype.hasOwnProperty.call(record, 'emailHashHex') ||
        Object.prototype.hasOwnProperty.call(record, 'registrationAuthorityId')
      ) {
        return null;
      }
      return buildParsedPasskeyWalletAuthMethodRecordV2({
        common,
        lifecycle: parseWalletAuthMethodLifecycle(record),
        rpId: rpId.value,
        credentialIdB64u: credentialIdB64u.value,
        credentialPublicKeyB64u: record.credentialPublicKeyB64u,
        counter: parseNonNegativeInteger(record.counter),
      });
    }
    if (!('emailHashHex' in record) || !('registrationAuthorityId' in record)) return null;
    exactWalletAuthMethodV2Fields(record, 'email_otp', status);
    const emailHashHex = trimString(record.emailHashHex);
    const registrationAuthorityId = trimString(record.registrationAuthorityId);
    if (
      !emailHashHex ||
      !registrationAuthorityId ||
      Object.prototype.hasOwnProperty.call(record, 'rpId') ||
      Object.prototype.hasOwnProperty.call(record, 'credentialIdB64u') ||
      Object.prototype.hasOwnProperty.call(record, 'credentialPublicKeyB64u') ||
      Object.prototype.hasOwnProperty.call(record, 'counter')
    ) {
      return null;
    }
    return buildParsedEmailOtpWalletAuthMethodRecordV2({
      common,
      lifecycle: parseWalletAuthMethodLifecycle(record),
      emailHashHex,
      registrationAuthorityId,
    });
  } catch {
    return null;
  }
}

function parseWalletAuthMethodRecordV2Common(raw: object): WalletAuthMethodCommonV1 {
  if (
    !('walletAuthMethodId' in raw) ||
    !('walletId' in raw) ||
    !('walletAuthorityId' in raw) ||
    !('createdAtMs' in raw) ||
    !('updatedAtMs' in raw)
  ) {
    throw new Error('wallet auth method common fields are required');
  }
  const walletAuthMethodId = parseWalletAuthMethodIdRequired(raw.walletAuthMethodId);
  const walletId = parseWalletIdRequired(raw.walletId);
  const walletAuthorityId = parseWalletAuthorityIdRequired(raw.walletAuthorityId);
  const createdAtMs = parseNonNegativeInteger(raw.createdAtMs);
  const updatedAtMs = parseNonNegativeInteger(raw.updatedAtMs);
  return {
    version: 'wallet_auth_method_v2',
    walletAuthMethodId,
    walletId,
    walletAuthorityId,
    createdAtMs,
    updatedAtMs,
  };
}

function validateWalletAuthMethodRecordV2(value: WalletAuthMethodRecordV2): void {
  if (value.version !== 'wallet_auth_method_v2') {
    throw new Error('wallet auth method record version is unsupported');
  }
  if (!value.walletAuthMethodId || !value.walletId || !value.walletAuthorityId) {
    throw new Error('wallet auth method record identities are required');
  }
  if (!Number.isSafeInteger(value.createdAtMs) || value.createdAtMs < 0) {
    throw new Error('wallet auth method createdAtMs must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs < value.createdAtMs) {
    throw new Error('wallet auth method updatedAtMs must follow createdAtMs');
  }
  if (value.kind === 'passkey') {
    if (!value.rpId || !value.credentialIdB64u || !value.credentialPublicKeyB64u.trim()) {
      throw new Error('passkey wallet auth method fields are required');
    }
    if (!Number.isSafeInteger(value.counter) || value.counter < 0) {
      throw new Error('passkey authenticator counter must be non-negative');
    }
  } else if (!value.emailHashHex.trim() || !value.registrationAuthorityId.trim()) {
    throw new Error('email OTP wallet auth method fields are required');
  }
  switch (value.status) {
    case 'pending_local_install':
      return;
    case 'active':
      validateNonNegativeInteger(value.activatedAtMs, 'activatedAtMs');
      return;
    case 'revoked':
      validateNonNegativeInteger(value.activatedAtMs, 'activatedAtMs');
      validateNonNegativeInteger(value.revokedAtMs, 'revokedAtMs');
      if (value.revokedAtMs < value.activatedAtMs) {
        throw new Error('revokedAtMs cannot precede activatedAtMs');
      }
      return;
  }
}

function parseWalletAuthMethodLifecycle(raw: object): WalletAuthMethodLifecycleV1 {
  if (!('status' in raw)) throw new Error('wallet auth method status is required');
  switch (raw.status) {
    case 'pending_local_install':
      return { status: 'pending_local_install' };
    case 'active':
      if (!('activatedAtMs' in raw)) {
        throw new Error('wallet auth method activatedAtMs is required');
      }
      return {
        status: 'active',
        activatedAtMs: parseNonNegativeInteger(raw.activatedAtMs),
      };
    case 'revoked':
      if (!('activatedAtMs' in raw) || !('revokedAtMs' in raw)) {
        throw new Error('wallet auth method revocation timestamps are required');
      }
      return {
        status: 'revoked',
        activatedAtMs: parseNonNegativeInteger(raw.activatedAtMs),
        revokedAtMs: parseNonNegativeInteger(raw.revokedAtMs),
      };
    default:
      throw new Error('wallet auth method status is unsupported');
  }
}

function exactWalletAuthMethodV2Fields(
  raw: object,
  kind: WalletAuthMethodRecordV2['kind'],
  status: string,
): void {
  const fields = [
    'version',
    'walletAuthMethodId',
    'walletId',
    'walletAuthorityId',
    'kind',
    'status',
    'createdAtMs',
    'updatedAtMs',
  ];
  if (kind === 'passkey') {
    fields.push('rpId', 'credentialIdB64u', 'credentialPublicKeyB64u', 'counter');
  } else {
    fields.push('emailHashHex', 'registrationAuthorityId');
  }
  if (status === 'active') fields.push('activatedAtMs');
  if (status === 'revoked') fields.push('activatedAtMs', 'revokedAtMs');
  if (status !== 'pending_local_install' && status !== 'active' && status !== 'revoked') {
    throw new Error('wallet auth method status is unsupported');
  }
  const expected = new Set(fields);
  const actual = Object.keys(raw);
  if (actual.length !== fields.length)
    throw new Error('wallet auth method record has invalid fields');
  for (const field of actual) {
    if (!expected.has(field)) throw new Error(`wallet auth method field ${field} is invalid`);
  }
}

function buildParsedPasskeyWalletAuthMethodRecordV2(input: {
  readonly common: WalletAuthMethodCommonV1;
  readonly lifecycle: WalletAuthMethodLifecycleV1;
  readonly rpId: WebAuthnRpId;
  readonly credentialIdB64u: WebAuthnCredentialIdB64u;
  readonly credentialPublicKeyB64u: string;
  readonly counter: number;
}): WalletAuthMethodRecordV2 {
  switch (input.lifecycle.status) {
    case 'pending_local_install':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.common.walletAuthMethodId,
        walletId: input.common.walletId,
        walletAuthorityId: input.common.walletAuthorityId,
        kind: 'passkey',
        status: 'pending_local_install',
        createdAtMs: input.common.createdAtMs,
        updatedAtMs: input.common.updatedAtMs,
        rpId: input.rpId,
        credentialIdB64u: input.credentialIdB64u,
        credentialPublicKeyB64u: input.credentialPublicKeyB64u,
        counter: input.counter,
      };
    case 'active':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.common.walletAuthMethodId,
        walletId: input.common.walletId,
        walletAuthorityId: input.common.walletAuthorityId,
        kind: 'passkey',
        status: 'active',
        createdAtMs: input.common.createdAtMs,
        updatedAtMs: input.common.updatedAtMs,
        rpId: input.rpId,
        credentialIdB64u: input.credentialIdB64u,
        credentialPublicKeyB64u: input.credentialPublicKeyB64u,
        counter: input.counter,
        activatedAtMs: input.lifecycle.activatedAtMs,
      };
    case 'revoked':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.common.walletAuthMethodId,
        walletId: input.common.walletId,
        walletAuthorityId: input.common.walletAuthorityId,
        kind: 'passkey',
        status: 'revoked',
        createdAtMs: input.common.createdAtMs,
        updatedAtMs: input.common.updatedAtMs,
        rpId: input.rpId,
        credentialIdB64u: input.credentialIdB64u,
        credentialPublicKeyB64u: input.credentialPublicKeyB64u,
        counter: input.counter,
        activatedAtMs: input.lifecycle.activatedAtMs,
        revokedAtMs: input.lifecycle.revokedAtMs,
      };
  }
}

function buildParsedEmailOtpWalletAuthMethodRecordV2(input: {
  readonly common: WalletAuthMethodCommonV1;
  readonly lifecycle: WalletAuthMethodLifecycleV1;
  readonly emailHashHex: string;
  readonly registrationAuthorityId: string;
}): WalletAuthMethodRecordV2 {
  switch (input.lifecycle.status) {
    case 'pending_local_install':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.common.walletAuthMethodId,
        walletId: input.common.walletId,
        walletAuthorityId: input.common.walletAuthorityId,
        kind: 'email_otp',
        status: 'pending_local_install',
        createdAtMs: input.common.createdAtMs,
        updatedAtMs: input.common.updatedAtMs,
        emailHashHex: input.emailHashHex,
        registrationAuthorityId: input.registrationAuthorityId,
      };
    case 'active':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.common.walletAuthMethodId,
        walletId: input.common.walletId,
        walletAuthorityId: input.common.walletAuthorityId,
        kind: 'email_otp',
        status: 'active',
        createdAtMs: input.common.createdAtMs,
        updatedAtMs: input.common.updatedAtMs,
        emailHashHex: input.emailHashHex,
        registrationAuthorityId: input.registrationAuthorityId,
        activatedAtMs: input.lifecycle.activatedAtMs,
      };
    case 'revoked':
      return {
        version: 'wallet_auth_method_v2',
        walletAuthMethodId: input.common.walletAuthMethodId,
        walletId: input.common.walletId,
        walletAuthorityId: input.common.walletAuthorityId,
        kind: 'email_otp',
        status: 'revoked',
        createdAtMs: input.common.createdAtMs,
        updatedAtMs: input.common.updatedAtMs,
        emailHashHex: input.emailHashHex,
        registrationAuthorityId: input.registrationAuthorityId,
        activatedAtMs: input.lifecycle.activatedAtMs,
        revokedAtMs: input.lifecycle.revokedAtMs,
      };
  }
}

function parseWalletAuthMethodIdRequired(raw: unknown): WalletAuthMethodId {
  const parsed = parseWalletAuthMethodId(raw);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function parseWalletIdRequired(raw: unknown): WalletId {
  const parsed = parseWalletId(raw);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function parseWalletAuthorityIdRequired(raw: unknown): WalletAuthorityId {
  const parsed = parseWalletAuthorityId(raw);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function parseNonNegativeInteger(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new Error('value must be a non-negative safe integer');
  }
  return raw;
}

function validateNonNegativeInteger(raw: number, label: string): void {
  if (!Number.isSafeInteger(raw) || raw < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export function walletAuthMethodRecordId(record: WalletAuthMethodRecord): WalletAuthMethodId {
  const raw =
    record.kind === 'passkey'
      ? `passkey:${record.rpId}:${record.credentialIdB64u}`
      : `email_otp:${record.walletId}:${record.emailHashHex}`;
  const parsed = parseWalletAuthMethodId(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
}

export type RegistrationNearAccountProvisioning =
  | {
      kind: 'implicit_account';
      accountIdSource: 'ed25519_public_key';
      requestedAccountId?: never;
      sponsor?: never;
    }
  | {
      kind: 'sponsored_named_account';
      requestedAccountId: NamedNearAccountId;
      sponsor: 'relayer';
      accountIdSource?: never;
    };

export type ResolvedRegistrationNearAccount =
  | {
      kind: 'implicit_account';
      nearAccountId: ImplicitNearAccountId;
      nearEd25519SigningKeyId: NearEd25519SigningKeyId;
      transactionHash?: never;
    }
  | {
      kind: 'sponsored_named_account';
      nearAccountId: NamedNearAccountId;
      nearEd25519SigningKeyId: NearEd25519SigningKeyId;
      transactionHash: string;
    };

export type ThresholdEd25519RegistrationSpec = {
  accountProvisioning: RegistrationNearAccountProvisioning;
  signerSlot: number;
  participantIds: number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
};

export type ThresholdEcdsaRegistrationSpec = {
  chainTargets: unknown[];
  participantIds: number[];
};

export type ThresholdEd25519AddSignerSpec = {
  mode: 'create_implicit_near_account';
  signerSlot: number;
  participantIds: number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
};

export type ThresholdEcdsaAddSignerChainTarget =
  | {
      readonly kind: 'evm';
      readonly namespace: 'eip155';
      readonly chainId: number;
      readonly networkSlug?: string;
    }
  | {
      readonly kind: 'tempo';
      readonly chainId: number;
      readonly networkSlug?: string;
    };

export type ThresholdEcdsaAddSignerSpec = {
  chainTargets: readonly ThresholdEcdsaAddSignerChainTarget[];
  participantIds: number[];
};

export type RegistrationSignerBranchKey = string & {
  readonly __registrationSignerBranchKeyBrand: unique symbol;
};

export type RegistrationNearEd25519SignerRequest = {
  kind: 'near_ed25519';
  accountProvisioning: RegistrationNearAccountProvisioning;
  signerSlot: number;
  participantIds: readonly number[];
  derivationVersion: number;
  keyPurpose?: never;
  keyVersion?: never;
  chainTargets?: never;
};

export type RegistrationEvmFamilyEcdsaSignerRequest = {
  kind: 'evm_family_ecdsa';
  participantIds: readonly number[];
  chainTargets: readonly unknown[];
  accountProvisioning?: never;
  signerSlot?: never;
  keyPurpose?: never;
  keyVersion?: never;
  derivationVersion?: never;
};

export type RegistrationSignerRequest =
  | RegistrationNearEd25519SignerRequest
  | RegistrationEvmFamilyEcdsaSignerRequest;

export type RegistrationSignerSetSelection = {
  kind: 'signer_set';
  signers: readonly RegistrationSignerRequest[];
  mode?: never;
  ed25519?: never;
  ecdsa?: never;
};

export type RegistrationNearEd25519SignerPlan = {
  kind: 'near_ed25519';
  branchKey: RegistrationSignerBranchKey;
  accountProvisioning: RegistrationNearAccountProvisioning;
  signerSlot: number;
  participantIds: readonly number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
  chainTargets?: never;
};

export type RegistrationEvmFamilyEcdsaSignerPlan = RegistrationEvmFamilyEcdsaSignerRequest & {
  branchKey: RegistrationSignerBranchKey;
};

export type RegistrationSignerPlanBranch =
  | RegistrationNearEd25519SignerPlan
  | RegistrationEvmFamilyEcdsaSignerPlan;

export type RegistrationSignerPlan = {
  kind: 'signer_set';
  branches: readonly RegistrationSignerPlanBranch[];
};

export type AddSignerSelection =
  | {
      mode: 'ed25519';
      ed25519: ThresholdEd25519AddSignerSpec;
      ecdsa?: never;
    }
  | {
      mode: 'ecdsa';
      ecdsa: ThresholdEcdsaAddSignerSpec;
      ed25519?: never;
    };

export type RuntimePolicyScopeLike = {
  orgId: string;
  projectId: string;
  envId: string;
  signingRootVersion?: string;
};

export type RegistrationIntentV1 = {
  version: 'registration_intent_v1';
  walletId: WalletId;
  authMethod: RegistrationAuthMethodInput;
  signerSelection: RegistrationSignerSetSelection;
  /**
   * The wallet's first auth method, allocated with the intent.
   *
   * It has to exist before the custody ceremony runs, because every envelope
   * the ceremony seals names the method that owns it inside its AAD. Allocated
   * at finalize — where the record is written — it would be a name the seal
   * could not have used, and the wallet would register with an envelope owned
   * by nobody.
   *
   * Server-allocated and part of the intent digest, so a client can neither
   * choose it nor swap it between the seal and the commit.
   */
  foundingWalletAuthMethodId: WalletAuthMethodId;
  runtimePolicyScope?: RuntimePolicyScopeLike;
  nonceB64u: string;
};

export type AddSignerIntentV1 = {
  version: 'add_signer_intent_v1';
  walletId: WalletId;
  signerSelection: AddSignerSelection;
  runtimePolicyScope?: RuntimePolicyScopeLike;
  nonceB64u: string;
};

/**
 * Who is starting the ceremony, and therefore what the source has to present.
 *
 * One endpoint serves two operations. Refactor 109C's same-device addition
 * requires a fresh operation-specific source proof; Refactor 103E's
 * linked-device ceremony start deliberately does not, because Device 1's owner
 * Wallet Session is the authority and Device 2 holds the factor. Without this
 * discriminator the endpoint could not tell them apart, so the weaker
 * requirement applied to both and a same-device addition could be authorized
 * by a reusable bearer credential.
 *
 * The branch lives on the intent rather than the start request because the
 * intent is what the source proof signs: a caller cannot present a fresh proof
 * over a same-device intent and then start a linked-device ceremony with it.
 */
export type AddAuthMethodIntentSourceV1 = {
  readonly walletAuthorityId: WalletAuthorityId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly walletSessionId: string;
  readonly authorityDigestB64u: string;
  readonly revocationEpoch: number;
};

type AddAuthMethodIntentCommonV1 = {
  version: 'add_auth_method_intent_v1';
  walletId: WalletId;
  authMethod: AddAuthMethodInput;
  /**
   * Allocated by the server when the intent is minted, not when the ceremony
   * starts.
   *
   * A source proof has to name the method it is authorizing the creation of.
   * While this was allocated in `start` — after the source had already been
   * authenticated — no proof could bind it, and one authorization could have
   * been replayed against a different target.
   */
  targetWalletAuthMethodId: WalletAuthMethodId;
  runtimePolicyScope?: RuntimePolicyScopeLike;
  nonceB64u: string;
};

export type AddAuthMethodIntentV1 = AddAuthMethodIntentCommonV1 &
  (
    | {
        readonly caller: 'same_device_addition';
        readonly source: AddAuthMethodIntentSourceV1;
      }
    | {
        readonly caller: 'linked_device_ceremony';
        readonly source?: never;
      }
  );

export function walletIdFromString(value: string): WalletId {
  const parsed = parseWalletId(value);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
}

export type ServerAllocatedWalletIdParseResult =
  | { ok: true; value: ServerAllocatedWalletId }
  | {
      ok: false;
      error: {
        code: 'missing' | 'invalid';
        message: string;
      };
    };

const SERVER_ALLOCATED_WALLET_ADJECTIVES = [
  'alpine',
  'amber',
  'azure',
  'brisk',
  'bright',
  'calm',
  'cedar',
  'cobalt',
  'copper',
  'coral',
  'crimson',
  'crystal',
  'dawn',
  'deep',
  'dusky',
  'evergreen',
  'fair',
  'fern',
  'frost',
  'gentle',
  'glacier',
  'glowing',
  'golden',
  'harbor',
  'humble',
  'indigo',
  'ivory',
  'jade',
  'keen',
  'lunar',
  'maple',
  'misty',
  'mossy',
  'noble',
  'ocean',
  'opal',
  'polar',
  'quiet',
  'rapid',
  'redwood',
  'river',
  'royal',
  'sage',
  'scarlet',
  'serene',
  'silver',
  'solar',
  'steady',
  'stone',
  'swift',
  'tranquil',
  'twilight',
  'umber',
  'verdant',
  'vibrant',
  'violet',
  'vivid',
  'warm',
  'wild',
  'willow',
  'winter',
  'woodland',
  'young',
  'zephyr',
] as const;

const SERVER_ALLOCATED_WALLET_NOUNS = [
  'anchor',
  'arbor',
  'atlas',
  'aurora',
  'badger',
  'beacon',
  'bloom',
  'brook',
  'canyon',
  'cascade',
  'comet',
  'cove',
  'crane',
  'delta',
  'dune',
  'eagle',
  'ember',
  'falcon',
  'feather',
  'fjord',
  'forest',
  'galaxy',
  'garden',
  'giant',
  'grove',
  'harvest',
  'heron',
  'horizon',
  'island',
  'lagoon',
  'lantern',
  'lark',
  'meadow',
  'meteor',
  'monolith',
  'nebula',
  'oasis',
  'orchid',
  'otter',
  'peak',
  'pebble',
  'phoenix',
  'pine',
  'prism',
  'quartz',
  'raven',
  'reef',
  'ridge',
  'sable',
  'sequoia',
  'shore',
  'solstice',
  'sparrow',
  'star',
  'summit',
  'tempo',
  'thunder',
  'tundra',
  'valley',
  'vermillion',
  'voyage',
  'wave',
  'wren',
  'zenith',
] as const;

const SERVER_ALLOCATED_WALLET_SUFFIX_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const SERVER_ALLOCATED_WALLET_ID_PATTERN = /^([a-z]+)-([a-z]+)-([a-z0-9]{6})$/;
const SERVER_ALLOCATED_WALLET_ADJECTIVE_SET = new Set<string>(SERVER_ALLOCATED_WALLET_ADJECTIVES);
const SERVER_ALLOCATED_WALLET_NOUN_SET = new Set<string>(SERVER_ALLOCATED_WALLET_NOUNS);

export function createServerAllocatedWalletId(): ServerAllocatedWalletId {
  return requireServerAllocatedWalletId(
    [
      randomServerAllocatedWalletWord(SERVER_ALLOCATED_WALLET_ADJECTIVES),
      randomServerAllocatedWalletWord(SERVER_ALLOCATED_WALLET_NOUNS),
      randomServerAllocatedWalletSuffix(6),
    ].join('-'),
  );
}

export function createReadableWalletId(): WalletId {
  return walletIdFromString(
    [
      randomServerAllocatedWalletWord(SERVER_ALLOCATED_WALLET_ADJECTIVES),
      randomServerAllocatedWalletWord(SERVER_ALLOCATED_WALLET_NOUNS),
      randomServerAllocatedWalletSuffix(6),
    ].join('-'),
  );
}

export function parseServerAllocatedWalletId(raw: unknown): ServerAllocatedWalletIdParseResult {
  const parsed = parseWalletId(raw);
  if (!parsed.ok) return parsed;
  const value = String(parsed.value);
  const match = SERVER_ALLOCATED_WALLET_ID_PATTERN.exec(value);
  const adjective = match?.[1] || '';
  const noun = match?.[2] || '';
  const suffix = match?.[3] || '';
  if (
    !match ||
    !SERVER_ALLOCATED_WALLET_ADJECTIVE_SET.has(adjective) ||
    !SERVER_ALLOCATED_WALLET_NOUN_SET.has(noun) ||
    !serverAllocatedWalletSuffixIsValid(suffix)
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid',
        message:
          'server-allocated walletId must match the approved readable word-word-suffix allocation format',
      },
    };
  }
  return { ok: true, value: parsed.value as ServerAllocatedWalletId };
}

export function requireServerAllocatedWalletId(value: unknown): ServerAllocatedWalletId {
  const parsed = parseServerAllocatedWalletId(value);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
}

function serverAllocatedRandomIndex(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 256) {
    throw new Error('Invalid server-allocated wallet random bound');
  }
  const limit = 256 - (256 % maxExclusive);
  const byte = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(byte);
    if (byte[0] < limit) return byte[0] % maxExclusive;
  }
}

function randomServerAllocatedWalletWord(words: readonly string[]): string {
  return words[serverAllocatedRandomIndex(words.length)]!;
}

function randomServerAllocatedWalletSuffix(length: number): string {
  let suffix = '';
  for (let index = 0; index < length; index += 1) {
    suffix +=
      SERVER_ALLOCATED_WALLET_SUFFIX_ALPHABET[
        serverAllocatedRandomIndex(SERVER_ALLOCATED_WALLET_SUFFIX_ALPHABET.length)
      ];
  }
  return suffix;
}

function serverAllocatedWalletSuffixIsValid(suffix: string): boolean {
  if (suffix.length !== 6) return false;
  for (const character of suffix) {
    if (!SERVER_ALLOCATED_WALLET_SUFFIX_ALPHABET.includes(character)) return false;
  }
  return true;
}

export function nearEd25519SigningKeyIdFromString(value: string): NearEd25519SigningKeyId {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('nearEd25519SigningKeyId is required');
  }
  return normalized as NearEd25519SigningKeyId;
}

export function parseNearEd25519SigningKeyId(value: unknown): NearEd25519SigningKeyId {
  if (typeof value !== 'string') {
    throw new Error('nearEd25519SigningKeyId must be a string');
  }
  return nearEd25519SigningKeyIdFromString(value);
}

export function formatNearEd25519SigningKeyIdForWire(value: NearEd25519SigningKeyId): string {
  return value;
}

export function nearEd25519SigningKeyIdFromWalletId(walletId: WalletId): NearEd25519SigningKeyId {
  return nearEd25519SigningKeyIdFromString(String(walletId));
}

export type GeneratedImplicitNearEd25519SigningKeyDigestInput = {
  kind: 'generated_implicit_near_ed25519_signing_key_v1';
  walletId: ServerAllocatedWalletId;
  authorityScope: RegistrationEd25519AuthorityScope;
  signingRootId: string;
  signingRootVersion: string;
  signerSlot: number;
  participantIds: readonly number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
};

export async function computeGeneratedImplicitNearEd25519SigningKeyId(
  input: GeneratedImplicitNearEd25519SigningKeyDigestInput,
): Promise<NearEd25519SigningKeyId> {
  const canonical = alphabetizeStringify({
    kind: input.kind,
    walletId: String(input.walletId),
    authorityScope: input.authorityScope,
    signingRootId: input.signingRootId,
    signingRootVersion: input.signingRootVersion,
    signerSlot: input.signerSlot,
    participantIds: [...input.participantIds],
    keyPurpose: input.keyPurpose,
    keyVersion: input.keyVersion,
    derivationVersion: input.derivationVersion,
  });
  const digest = base64UrlEncode(await sha256BytesUtf8(canonical));
  return nearEd25519SigningKeyIdFromString(`ed25519ks_${digest}`);
}

export async function computeAddSignerNearEd25519SigningKeyId(input: {
  kind: 'wallet_add_signer_implicit_near_ed25519_key_v1';
  walletId: WalletId;
  signingRootId: string;
  signingRootVersion: string;
  signerSlot: number;
  participantIds: readonly number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
}): Promise<NearEd25519SigningKeyId> {
  const canonical = alphabetizeStringify({
    kind: input.kind,
    walletId: String(input.walletId),
    signingRootId: input.signingRootId,
    signingRootVersion: input.signingRootVersion,
    signerSlot: input.signerSlot,
    participantIds: [...input.participantIds],
    keyPurpose: input.keyPurpose,
    keyVersion: input.keyVersion,
    derivationVersion: input.derivationVersion,
  });
  const digest = base64UrlEncode(await sha256BytesUtf8(canonical));
  return nearEd25519SigningKeyIdFromString(`ed25519ks_${digest}`);
}

export type RegistrationEd25519AuthorityScope =
  | {
      kind: 'passkey';
      rpId: WebAuthnRpId;
      proofKind?: never;
      email?: never;
      challengeId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    }
  | {
      kind: 'email_otp';
      provider: EmailOtpProvider;
      providerUserId: EmailOtpProviderUserId;
      proofKind?: never;
      rpId?: never;
      email?: never;
      challengeId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    };

export function registrationEd25519AuthorityScope(
  authMethod: Extract<RegistrationAuthMethodInput, { kind: 'passkey' }>,
): Extract<RegistrationEd25519AuthorityScope, { kind: 'passkey' }> {
  return {
    kind: 'passkey',
    rpId: authMethod.rpId,
  };
}

function emailOtpProviderUserIdFromRegistrationAuthority(
  authority: Extract<RegistrationAuthority, { kind: 'email_otp' }>,
): EmailOtpProviderUserId {
  const parsed = parseEmailOtpProviderUserId(authority.providerSubject);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

export function registrationEd25519AuthorityScopeFromAuthority(
  authority: RegistrationAuthority,
): RegistrationEd25519AuthorityScope {
  switch (authority.kind) {
    case 'passkey':
      return {
        kind: 'passkey',
        rpId: authority.rpId,
      };
    case 'email_otp':
      return {
        kind: 'email_otp',
        provider: authority.proofKind === 'google_sso_registration' ? 'google' : 'email',
        providerUserId: emailOtpProviderUserIdFromRegistrationAuthority(authority),
      };
    default: {
      const exhaustive: never = authority;
      return exhaustive;
    }
  }
}

export async function computeRegistrationNearEd25519SigningKeyId(input: {
  walletId: WalletId;
  authorityScope: RegistrationEd25519AuthorityScope;
  signingRootId: string;
  signingRootVersion: string;
  ed25519: ThresholdEd25519RegistrationSpec;
}): Promise<NearEd25519SigningKeyId> {
  switch (input.ed25519.accountProvisioning.kind) {
    case 'implicit_account':
      return await computeGeneratedImplicitNearEd25519SigningKeyId({
        kind: 'generated_implicit_near_ed25519_signing_key_v1',
        walletId: requireServerAllocatedWalletId(input.walletId),
        authorityScope: input.authorityScope,
        signingRootId: input.signingRootId,
        signingRootVersion: input.signingRootVersion,
        signerSlot: input.ed25519.signerSlot,
        participantIds: input.ed25519.participantIds,
        keyPurpose: input.ed25519.keyPurpose,
        keyVersion: input.ed25519.keyVersion,
        derivationVersion: input.ed25519.derivationVersion,
      });
    case 'sponsored_named_account':
      return nearEd25519SigningKeyIdFromWalletId(input.walletId);
    default: {
      const exhaustive: never = input.ed25519.accountProvisioning;
      return exhaustive;
    }
  }
}

export function implicitNearAccountProvisioning(): RegistrationNearAccountProvisioning {
  return {
    kind: 'implicit_account',
    accountIdSource: 'ed25519_public_key',
  };
}

export function sponsoredNamedNearAccountProvisioning(
  requestedAccountId: NamedNearAccountId,
): RegistrationNearAccountProvisioning {
  return {
    kind: 'sponsored_named_account',
    requestedAccountId,
    sponsor: 'relayer',
  };
}

export function registrationProvisioningScopeKey(
  provisioning: RegistrationNearAccountProvisioning,
): string {
  switch (provisioning.kind) {
    case 'implicit_account':
      return 'implicit_account';
    case 'sponsored_named_account':
      return `sponsored_named_account:${String(provisioning.requestedAccountId)}`;
    default: {
      const exhaustive: never = provisioning;
      return exhaustive;
    }
  }
}

export function registrationIntentGrantFromString(value: string): RegistrationIntentGrant {
  return String(value || '').trim() as RegistrationIntentGrant;
}

export function addAuthMethodIntentGrantFromString(value: string): AddAuthMethodIntentGrant {
  return String(value || '').trim() as AddAuthMethodIntentGrant;
}

export function addSignerIntentGrantFromString(value: string): AddSignerIntentGrant {
  return String(value || '').trim() as AddSignerIntentGrant;
}

export function serializeRegistrationIntentV1(intent: RegistrationIntentV1): string {
  return alphabetizeStringify(intent);
}

export function serializeAddSignerIntentV1(intent: AddSignerIntentV1): string {
  return alphabetizeStringify(intent);
}

export function serializeAddAuthMethodIntentV1(intent: AddAuthMethodIntentV1): string {
  return alphabetizeStringify(intent);
}

export async function computeRegistrationIntentDigestB64u(
  intent: RegistrationIntentV1,
): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(serializeRegistrationIntentV1(intent)));
}

export async function computeAddSignerIntentDigestB64u(intent: AddSignerIntentV1): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(serializeAddSignerIntentV1(intent)));
}

export async function computeAddAuthMethodIntentDigestB64u(
  intent: AddAuthMethodIntentV1,
): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(serializeAddAuthMethodIntentV1(intent)));
}

function inspectRawObject(value: unknown): object | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(raw: unknown, fallback: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function collectPositiveParticipantIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const participantIds: number[] = [];
  for (const id of raw) {
    const numericId = Number(id);
    if (Number.isInteger(numericId) && numericId > 0) participantIds.push(numericId);
  }
  return participantIds;
}

function normalizeUnknownArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function normalizeRegistrationNearAccountProvisioning(
  raw: unknown,
): RegistrationNearAccountProvisioning | null {
  const record = inspectRawObject(raw);
  if (!record || !('kind' in record)) return null;
  const kind = trimString(record.kind);
  switch (kind) {
    case 'implicit_account':
      if (
        Object.prototype.hasOwnProperty.call(record, 'requestedAccountId') ||
        Object.prototype.hasOwnProperty.call(record, 'sponsor')
      ) {
        return null;
      }
      return {
        kind: 'implicit_account',
        accountIdSource: 'ed25519_public_key',
      };
    case 'sponsored_named_account': {
      if (
        Object.prototype.hasOwnProperty.call(record, 'accountIdSource') ||
        !('requestedAccountId' in record)
      ) {
        return null;
      }
      const parsed = parseNamedNearAccountId(record.requestedAccountId);
      if (!parsed.ok) return null;
      return {
        kind: 'sponsored_named_account',
        requestedAccountId: parsed.value,
        sponsor: 'relayer',
      };
    }
    default:
      return null;
  }
}

function normalizeRegistrationEcdsaSpec(
  value: object | null,
): ThresholdEcdsaRegistrationSpec | null {
  if (!value) return null;
  if (!('participantIds' in value) || !('chainTargets' in value)) return null;
  const participantIds = collectPositiveParticipantIds(value.participantIds);
  const chainTargets = normalizeUnknownArray(value.chainTargets);
  if (participantIds.length === 0 || chainTargets.length === 0) return null;
  return { participantIds, chainTargets };
}

export type NormalizeSignerSelectionResult<TSelection> =
  | { ok: true; value: TSelection }
  | { ok: false; code: string; message: string };

export type NormalizeAddSignerSelectionOptions = {
  readonly normalizeEcdsaChainTarget: (
    target: unknown,
  ) => ThresholdEcdsaAddSignerChainTarget | null;
};

export type RegistrationSignerSetSelectionFromPlanOptions = {
  readonly normalizeEcdsaChainTarget?: (target: unknown) => unknown | null;
};

const REGISTRATION_NEAR_ED25519_KEY_PURPOSE = 'near_tx';
export const NEAR_ED25519_YAO_KEY_VERSION_V1 = 'router-ab-ed25519-yao-v1';
export const REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION = 1;

export function registrationSignerBranchKeyFromString(value: string): RegistrationSignerBranchKey {
  const normalized = trimString(value);
  if (!normalized) {
    throw new Error('registration signer branch key is required');
  }
  return normalized as RegistrationSignerBranchKey;
}

export function registrationNearEd25519BranchKey(signerSlot: number): RegistrationSignerBranchKey {
  return registrationSignerBranchKeyFromString(`near_ed25519:slot:${signerSlot}`);
}

function registrationEvmFamilyEcdsaTargetKey(target: unknown): string {
  return alphabetizeStringify(target);
}

export function registrationEvmFamilyEcdsaBranchKey(
  chainTargets: readonly unknown[],
): RegistrationSignerBranchKey {
  return registrationSignerBranchKeyFromString(
    `evm_family_ecdsa:${chainTargets.map(registrationEvmFamilyEcdsaTargetKey).join('|')}`,
  );
}

function registrationSignerPlanFromRequests(
  signers: readonly RegistrationSignerRequest[],
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  return registrationSignerPlanFromBranches(signers.map(registrationSignerPlanBranchFromRequest));
}

function registrationSignerPlanFromBranches(
  branches: readonly RegistrationSignerPlanBranch[],
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  if (branches.length === 0) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'signer set must include at least one signer',
    };
  }
  const nearSlots = new Set<number>();
  const ecdsaTargetKeys = new Set<string>();
  const branchKeys = new Set<string>();
  for (const branch of branches) {
    const duplicate = findRegistrationSignerPlanDuplicate({
      branch,
      nearSlots,
      ecdsaTargetKeys,
      branchKeys,
    });
    if (duplicate) return duplicate;
  }
  return {
    ok: true,
    value: {
      kind: 'signer_set',
      branches,
    },
  };
}

function registrationSignerPlanBranchFromRequest(
  signer: RegistrationSignerRequest,
): RegistrationSignerPlanBranch {
  switch (signer.kind) {
    case 'near_ed25519':
      return {
        kind: 'near_ed25519',
        branchKey: registrationNearEd25519BranchKey(signer.signerSlot),
        accountProvisioning: signer.accountProvisioning,
        signerSlot: signer.signerSlot,
        participantIds: signer.participantIds,
        keyPurpose: REGISTRATION_NEAR_ED25519_KEY_PURPOSE,
        keyVersion: NEAR_ED25519_YAO_KEY_VERSION_V1,
        derivationVersion: signer.derivationVersion,
      };
    case 'evm_family_ecdsa':
      return {
        kind: 'evm_family_ecdsa',
        branchKey: registrationEvmFamilyEcdsaBranchKey(signer.chainTargets),
        participantIds: signer.participantIds,
        chainTargets: signer.chainTargets,
      };
    default:
      return assertNeverRegistrationSignerRequest(signer);
  }
}

function findRegistrationSignerPlanDuplicate(input: {
  readonly branch: RegistrationSignerPlanBranch;
  readonly nearSlots: Set<number>;
  readonly ecdsaTargetKeys: Set<string>;
  readonly branchKeys: Set<string>;
}): NormalizeSignerSelectionResult<RegistrationSignerPlan> | null {
  switch (input.branch.kind) {
    case 'near_ed25519':
      if (input.nearSlots.has(input.branch.signerSlot)) {
        return {
          ok: false,
          code: 'invalid_body',
          message: 'duplicate near_ed25519 signer slot is invalid',
        };
      }
      input.nearSlots.add(input.branch.signerSlot);
      break;
    case 'evm_family_ecdsa':
      {
        const duplicateTarget = findDuplicateRegistrationEcdsaTarget(
          input.branch,
          input.ecdsaTargetKeys,
        );
        if (duplicateTarget) return duplicateTarget;
      }
      break;
    default:
      return assertNeverRegistrationSignerPlanBranch(input.branch);
  }
  return findDuplicateRegistrationSignerBranch(input.branch, input.branchKeys);
}

function findDuplicateRegistrationSignerBranch(
  branch: RegistrationSignerPlanBranch,
  branchKeys: Set<string>,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> | null {
  const branchKey = String(branch.branchKey);
  if (branchKeys.has(branchKey)) {
    return { ok: false, code: 'invalid_body', message: 'duplicate signer branch is invalid' };
  }
  branchKeys.add(branchKey);
  return null;
}

function findDuplicateRegistrationEcdsaTarget(
  branch: RegistrationEvmFamilyEcdsaSignerPlan,
  ecdsaTargetKeys: Set<string>,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> | null {
  for (const target of branch.chainTargets) {
    const targetKey = registrationEvmFamilyEcdsaTargetKey(target);
    if (ecdsaTargetKeys.has(targetKey)) {
      return {
        ok: false,
        code: 'invalid_body',
        message: 'duplicate evm_family_ecdsa chain target is invalid',
      };
    }
    ecdsaTargetKeys.add(targetKey);
  }
  return null;
}

function normalizeRegistrationSignerRequest(
  raw: unknown,
): NormalizeSignerSelectionResult<RegistrationSignerRequest> {
  const record = inspectRawObject(raw);
  if (!record) {
    return { ok: false, code: 'invalid_body', message: 'signer set entry must be an object' };
  }
  if (!('kind' in record)) {
    return { ok: false, code: 'invalid_body', message: 'unsupported registration signer kind' };
  }
  const kind = trimString(record.kind);
  switch (kind) {
    case 'near_ed25519':
      return normalizeRegistrationNearEd25519SignerRequest(record);
    case 'evm_family_ecdsa':
      return normalizeRegistrationEvmFamilyEcdsaSignerRequest(record);
    default:
      return { ok: false, code: 'invalid_body', message: 'unsupported registration signer kind' };
  }
}

function normalizeRegistrationNearEd25519SignerRequest(
  raw: object,
): NormalizeSignerSelectionResult<RegistrationSignerRequest> {
  if (
    Object.prototype.hasOwnProperty.call(raw, 'keyPurpose') ||
    Object.prototype.hasOwnProperty.call(raw, 'keyVersion')
  ) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'near_ed25519 signer spec cannot include protocol key fields',
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(raw, 'nearAccountId') ||
    Object.prototype.hasOwnProperty.call(raw, 'createNearAccount')
  ) {
    return { ok: false, code: 'invalid_body', message: 'near_ed25519 signer spec is invalid' };
  }
  const accountProvisioning = normalizeRegistrationNearAccountProvisioning(
    'accountProvisioning' in raw ? raw.accountProvisioning : undefined,
  );
  const signerSlot = normalizePositiveInteger('signerSlot' in raw ? raw.signerSlot : undefined, 0);
  const derivationVersion = Number('derivationVersion' in raw ? raw.derivationVersion : undefined);
  const participantIds = collectPositiveParticipantIds(
    'participantIds' in raw ? raw.participantIds : undefined,
  );
  if (
    !accountProvisioning ||
    signerSlot < 1 ||
    participantIds.length === 0 ||
    derivationVersion !== REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION
  ) {
    return { ok: false, code: 'invalid_body', message: 'near_ed25519 signer spec is invalid' };
  }
  return {
    ok: true,
    value: {
      kind: 'near_ed25519',
      accountProvisioning,
      signerSlot,
      participantIds,
      derivationVersion,
    },
  };
}

function normalizeRegistrationEvmFamilyEcdsaSignerRequest(
  raw: object,
): NormalizeSignerSelectionResult<RegistrationSignerRequest> {
  const ecdsa = normalizeRegistrationEcdsaSpec(raw);
  if (!ecdsa) {
    return { ok: false, code: 'invalid_body', message: 'evm_family_ecdsa signer spec is invalid' };
  }
  return {
    ok: true,
    value: {
      kind: 'evm_family_ecdsa',
      participantIds: ecdsa.participantIds,
      chainTargets: ecdsa.chainTargets,
    },
  };
}

function normalizeRegistrationSignerSetPlan(
  raw: object,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  if (!('signers' in raw) || !Array.isArray(raw.signers)) {
    return { ok: false, code: 'invalid_body', message: 'signerSelection.signers must be an array' };
  }
  const signers: RegistrationSignerRequest[] = [];
  for (const rawSigner of raw.signers) {
    const signer = normalizeRegistrationSignerRequest(rawSigner);
    if (!signer.ok) return signer;
    signers.push(signer.value);
  }
  return registrationSignerPlanFromRequests(signers);
}

export function normalizeRegistrationSignerPlan(
  raw: unknown,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  const record = inspectRawObject(raw);
  if (!record) {
    return { ok: false, code: 'invalid_body', message: 'signerSelection must be an object' };
  }
  if (!('kind' in record)) {
    return { ok: false, code: 'invalid_body', message: 'signerSelection.kind must be signer_set' };
  }
  if (trimString(record.kind) === 'signer_set') {
    return normalizeRegistrationSignerSetPlan(record);
  }
  return { ok: false, code: 'invalid_body', message: 'signerSelection.kind must be signer_set' };
}

export function registrationSignerPlanFromSelection(
  selection: RegistrationSignerSetSelection,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  return registrationSignerPlanFromRequests(selection.signers);
}

export function findRegistrationSignerPlanNearEd25519Branch(
  plan: RegistrationSignerPlan,
): RegistrationNearEd25519SignerPlan | null {
  for (const branch of plan.branches) {
    if (branch.kind === 'near_ed25519') return branch;
  }
  return null;
}

export function findRegistrationSignerPlanEvmFamilyEcdsaBranch(
  plan: RegistrationSignerPlan,
): RegistrationEvmFamilyEcdsaSignerPlan | null {
  for (const branch of plan.branches) {
    if (branch.kind === 'evm_family_ecdsa') return branch;
  }
  return null;
}

export function registrationSignerSetSelectionFromPlan(
  plan: RegistrationSignerPlan,
  options: RegistrationSignerSetSelectionFromPlanOptions = {},
): NormalizeSignerSelectionResult<RegistrationSignerSetSelection> {
  const signers: RegistrationSignerRequest[] = [];
  for (const branch of plan.branches) {
    const signer = registrationSignerRequestFromPlanBranchForSelection(branch, options);
    if (!signer.ok) return signer;
    signers.push(signer.value);
  }
  return {
    ok: true,
    value: {
      kind: 'signer_set',
      signers,
    },
  };
}

function registrationSignerRequestFromPlanBranchForSelection(
  branch: RegistrationSignerPlanBranch,
  options: RegistrationSignerSetSelectionFromPlanOptions,
): NormalizeSignerSelectionResult<RegistrationSignerRequest> {
  switch (branch.kind) {
    case 'near_ed25519':
      return {
        ok: true,
        value: registrationNearEd25519RequestFromPlanBranch(branch),
      };
    case 'evm_family_ecdsa':
      return registrationEvmFamilyEcdsaRequestFromPlanBranch(branch, options);
    default:
      return assertNeverRegistrationSignerPlanBranch(branch);
  }
}

function registrationNearEd25519RequestFromPlanBranch(
  branch: RegistrationNearEd25519SignerPlan,
): RegistrationNearEd25519SignerRequest {
  return {
    kind: 'near_ed25519',
    accountProvisioning: branch.accountProvisioning,
    signerSlot: branch.signerSlot,
    participantIds: [...branch.participantIds],
    derivationVersion: branch.derivationVersion,
  };
}

function registrationEvmFamilyEcdsaRequestFromPlanBranch(
  branch: RegistrationEvmFamilyEcdsaSignerPlan,
  options: RegistrationSignerSetSelectionFromPlanOptions,
): NormalizeSignerSelectionResult<RegistrationEvmFamilyEcdsaSignerRequest> {
  const chainTargets = registrationEcdsaChainTargetsFromPlanBranch(branch, options);
  if (!chainTargets) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'registration ECDSA chainTargets are invalid',
    };
  }
  return {
    ok: true,
    value: {
      kind: 'evm_family_ecdsa',
      participantIds: [...branch.participantIds],
      chainTargets,
    },
  };
}

function registrationEcdsaChainTargetsFromPlanBranch(
  branch: RegistrationEvmFamilyEcdsaSignerPlan,
  options: RegistrationSignerSetSelectionFromPlanOptions,
): unknown[] | null {
  if (!options.normalizeEcdsaChainTarget) return [...branch.chainTargets];
  const chainTargets: unknown[] = [];
  for (const target of branch.chainTargets) {
    const normalized = options.normalizeEcdsaChainTarget(target);
    if (!normalized) return null;
    chainTargets.push(normalized);
  }
  return chainTargets;
}

function assertNeverRegistrationSignerRequest(value: never): never {
  throw new Error(`Unsupported registration signer request: ${String(value)}`);
}

function assertNeverRegistrationSignerPlanBranch(value: never): never {
  throw new Error(`Unsupported registration signer plan branch: ${String(value)}`);
}

export function normalizeAddSignerSelection(
  raw: unknown,
  options: NormalizeAddSignerSelectionOptions,
): NormalizeSignerSelectionResult<AddSignerSelection> {
  const record = inspectRawObject(raw);
  if (!record) {
    return { ok: false, code: 'invalid_body', message: 'signerSelection must be an object' };
  }
  if (!('mode' in record)) {
    return { ok: false, code: 'invalid_body', message: 'unsupported add-signer mode' };
  }
  const mode = trimString(record.mode);
  if (mode === 'ecdsa') {
    return normalizeAddSignerEcdsaSelection('ecdsa' in record ? record.ecdsa : undefined, options);
  }
  if (mode === 'ed25519') {
    return normalizeAddSignerEd25519Selection(
      'ed25519' in record ? record.ed25519 : undefined,
    );
  }
  return { ok: false, code: 'invalid_body', message: 'unsupported add-signer mode' };
}

function normalizeAddSignerEcdsaSelection(
  raw: unknown,
  options: NormalizeAddSignerSelectionOptions,
): NormalizeSignerSelectionResult<AddSignerSelection> {
  const ecdsaRecord = inspectRawObject(raw);
  const participantIds = collectPositiveParticipantIds(
    ecdsaRecord && 'participantIds' in ecdsaRecord ? ecdsaRecord.participantIds : undefined,
  );
  const chainTargets = normalizeAddSignerEcdsaChainTargets(
    ecdsaRecord && 'chainTargets' in ecdsaRecord ? ecdsaRecord.chainTargets : undefined,
    options,
  );
  if (participantIds.length === 0 || chainTargets.length === 0) {
    return { ok: false, code: 'invalid_body', message: 'ecdsa add-signer spec is invalid' };
  }
  return {
    ok: true,
    value: {
      mode: 'ecdsa',
      ecdsa: {
        chainTargets,
        participantIds,
      },
    },
  };
}

function normalizeAddSignerEcdsaChainTargets(
  raw: unknown,
  options: NormalizeAddSignerSelectionOptions,
): ThresholdEcdsaAddSignerChainTarget[] {
  if (!Array.isArray(raw)) return [];
  const chainTargets: ThresholdEcdsaAddSignerChainTarget[] = [];
  for (const target of raw) {
    const normalized = options.normalizeEcdsaChainTarget(target);
    if (!normalized) return [];
    chainTargets.push(normalized);
  }
  return chainTargets;
}

function normalizeAddSignerEd25519Selection(
  raw: unknown,
): NormalizeSignerSelectionResult<AddSignerSelection> {
  const ed25519Record = inspectRawObject(raw);
  const ed25519Mode = trimString(
    ed25519Record && 'mode' in ed25519Record ? ed25519Record.mode : undefined,
  );
  const signerSlot = normalizePositiveInteger(
    ed25519Record && 'signerSlot' in ed25519Record ? ed25519Record.signerSlot : undefined,
    1,
  );
  const keyPurpose = trimString(
    ed25519Record && 'keyPurpose' in ed25519Record ? ed25519Record.keyPurpose : undefined,
  );
  const keyVersion = trimString(
    ed25519Record && 'keyVersion' in ed25519Record ? ed25519Record.keyVersion : undefined,
  );
  const derivationVersion = normalizePositiveInteger(
    ed25519Record && 'derivationVersion' in ed25519Record
      ? ed25519Record.derivationVersion
      : undefined,
    0,
  );
  const participantIds = collectPositiveParticipantIds(
    ed25519Record && 'participantIds' in ed25519Record ? ed25519Record.participantIds : undefined,
  );
  if (!keyPurpose || !keyVersion || !derivationVersion || participantIds.length === 0) {
    return { ok: false, code: 'invalid_body', message: 'ed25519 add-signer spec is invalid' };
  }
  if (ed25519Mode === 'create_implicit_near_account') {
    return {
      ok: true,
      value: {
        mode: 'ed25519',
        ed25519: {
          mode: ed25519Mode,
          signerSlot,
          participantIds,
          keyPurpose,
          keyVersion,
          derivationVersion,
        },
      },
    };
  }
  return { ok: false, code: 'invalid_body', message: 'unsupported add-signer mode' };
}

export function normalizeRegistrationAuthMethodInput(
  raw: unknown,
): RegistrationAuthMethodInput | null {
  const record = inspectRawObject(raw);
  if (!record || !('kind' in record)) return null;
  const kind = trimString(record.kind);
  if (kind === 'passkey') {
    const rpId = parseWebAuthnRpId('rpId' in record ? record.rpId : undefined);
    if (
      !rpId.ok ||
      Object.prototype.hasOwnProperty.call(record, 'email') ||
      Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
      Object.prototype.hasOwnProperty.call(record, 'challengeId')
    ) {
      return null;
    }
    return {
      kind: 'passkey',
      rpId: rpId.value,
      ...('authenticatorOptions' in record && record.authenticatorOptions !== undefined
        ? { authenticatorOptions: record.authenticatorOptions }
        : {}),
    };
  }
  if (kind === 'email_otp') {
    const proofKind = trimString('proofKind' in record ? record.proofKind : undefined);
    const email = trimString('email' in record ? record.email : undefined);
    const providerSubject = trimString(
      'providerSubject' in record ? record.providerSubject : undefined,
    );
    if (
      !email ||
      !providerSubject ||
      Object.prototype.hasOwnProperty.call(record, 'rpId') ||
      Object.prototype.hasOwnProperty.call(record, 'authenticatorOptions')
    ) {
      return null;
    }
    if (proofKind === 'otp_challenge') {
      const otpCode = trimString('otpCode' in record ? record.otpCode : undefined);
      const challengeId = trimString('challengeId' in record ? record.challengeId : undefined);
      if (
        !otpCode ||
        Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationAttemptId') ||
        Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationOfferId') ||
        Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationCandidateId')
      ) {
        return null;
      }
      return {
        kind: 'email_otp',
        proofKind: 'otp_challenge',
        email,
        providerSubject,
        otpCode,
        ...(challengeId ? { challengeId } : {}),
      };
    }
    if (proofKind === 'google_sso_registration') {
      const googleEmailOtpRegistrationAttemptId = trimString(
        'googleEmailOtpRegistrationAttemptId' in record
          ? record.googleEmailOtpRegistrationAttemptId
          : undefined,
      );
      const googleEmailOtpRegistrationOfferId = trimString(
        'googleEmailOtpRegistrationOfferId' in record
          ? record.googleEmailOtpRegistrationOfferId
          : undefined,
      );
      const googleEmailOtpRegistrationCandidateId = trimString(
        'googleEmailOtpRegistrationCandidateId' in record
          ? record.googleEmailOtpRegistrationCandidateId
          : undefined,
      );
      if (
        !googleEmailOtpRegistrationAttemptId ||
        !googleEmailOtpRegistrationOfferId ||
        !googleEmailOtpRegistrationCandidateId ||
        Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
        Object.prototype.hasOwnProperty.call(record, 'challengeId')
      ) {
        return null;
      }
      return {
        kind: 'email_otp',
        proofKind: 'google_sso_registration',
        email,
        providerSubject,
        googleEmailOtpRegistrationAttemptId,
        googleEmailOtpRegistrationOfferId,
        googleEmailOtpRegistrationCandidateId,
      };
    }
    return null;
  }
  return null;
}

export function normalizeAddAuthMethodInput(raw: unknown): AddAuthMethodInput | null {
  const record = inspectRawObject(raw);
  if (!record || !('kind' in record)) return null;
  const kind = trimString(record.kind);
  if (kind === 'passkey') {
    const rpId = parseWebAuthnRpId('rpId' in record ? record.rpId : undefined);
    if (
      !rpId.ok ||
      Object.prototype.hasOwnProperty.call(record, 'email') ||
      Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
      Object.prototype.hasOwnProperty.call(record, 'challengeId') ||
      Object.prototype.hasOwnProperty.call(record, 'authenticatorOptions')
    ) {
      return null;
    }
    return { kind: 'passkey', rpId: rpId.value };
  }
  if (kind === 'email_otp') {
    const email = trimString('email' in record ? record.email : undefined);
    if (
      !email ||
      Object.prototype.hasOwnProperty.call(record, 'rpId') ||
      Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
      Object.prototype.hasOwnProperty.call(record, 'challengeId') ||
      Object.prototype.hasOwnProperty.call(record, 'authenticatorOptions')
    ) {
      return null;
    }
    return {
      kind: 'email_otp',
      email,
    };
  }
  return null;
}

/**
 * Parses the caller branch once, at the boundary. Core code below this receives
 * a branch whose identities are branded and complete, never a partially filled
 * source it has to re-check.
 */
export type AddAuthMethodIntentCallerV1 =
  | { readonly caller: 'same_device_addition'; readonly source: AddAuthMethodIntentSourceV1 }
  | { readonly caller: 'linked_device_ceremony' };

export function normalizeAddAuthMethodIntentCaller(
  raw: unknown,
): AddAuthMethodIntentCallerV1 | null {
  const record = inspectRawObject(raw);
  if (!record || !('caller' in record)) return null;
  const caller = trimString(record.caller);
  if (caller === 'linked_device_ceremony') {
    if (Object.prototype.hasOwnProperty.call(record, 'source')) return null;
    return { caller: 'linked_device_ceremony' };
  }
  if (caller !== 'same_device_addition') return null;
  const source = inspectRawObject('source' in record ? record.source : undefined);
  if (!source) return null;
  const walletAuthorityId = parseWalletAuthorityId(
    'walletAuthorityId' in source ? source.walletAuthorityId : undefined,
  );
  const walletAuthMethodId = parseWalletAuthMethodId(
    'walletAuthMethodId' in source ? source.walletAuthMethodId : undefined,
  );
  const walletSessionId = trimString(
    'walletSessionId' in source ? source.walletSessionId : undefined,
  );
  const authorityDigestB64u = trimString(
    'authorityDigestB64u' in source ? source.authorityDigestB64u : undefined,
  );
  const revocationEpoch = 'revocationEpoch' in source ? source.revocationEpoch : undefined;
  if (
    !walletAuthorityId.ok ||
    !walletAuthMethodId.ok ||
    !walletSessionId ||
    !authorityDigestB64u ||
    typeof revocationEpoch !== 'number' ||
    !Number.isSafeInteger(revocationEpoch) ||
    revocationEpoch < 0
  ) {
    return null;
  }
  return {
    caller: 'same_device_addition',
    source: {
      walletAuthorityId: walletAuthorityId.value,
      walletAuthMethodId: walletAuthMethodId.value,
      walletSessionId,
      authorityDigestB64u,
      revocationEpoch,
    },
  };
}

/** True when the two source claims name the same session on the same authority. */
export function sameAddAuthMethodIntentSourceV1(
  left: AddAuthMethodIntentSourceV1,
  right: AddAuthMethodIntentSourceV1,
): boolean {
  return (
    left.walletAuthorityId === right.walletAuthorityId &&
    left.walletAuthMethodId === right.walletAuthMethodId &&
    left.walletSessionId === right.walletSessionId &&
    left.authorityDigestB64u === right.authorityDigestB64u &&
    left.revocationEpoch === right.revocationEpoch
  );
}

function exactRegistrationIntentObject(
  raw: unknown,
  label: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): object {
  const record = inspectRawObject(raw);
  if (!record) throw new Error(label + ' must be an object');
  const allowedFields = new Set([...requiredFields, ...optionalFields]);
  const actualFields = Object.keys(record);
  if (actualFields.length < requiredFields.length || actualFields.length > allowedFields.size) {
    throw new Error(label + ' has invalid fields');
  }
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(label + '.' + field + ' is required');
    }
  }
  for (const field of actualFields) {
    if (!allowedFields.has(field)) throw new Error(label + ' has invalid fields');
  }
  return record;
}

function readRegistrationIntentField(record: object, field: string, label: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    throw new Error(label + '.' + field + ' is required');
  }
  return Reflect.get(record, field);
}

function hasRegistrationIntentField(record: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function readRegistrationIntentString(record: object, field: string, label: string): string {
  const value = readRegistrationIntentField(record, field, label);
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(label + '.' + field + ' must be a non-empty canonical string');
  }
  return value;
}

function readRegistrationIntentSafeInteger(
  record: object,
  field: string,
  label: string,
  minimum: number,
): number {
  const value = readRegistrationIntentField(record, field, label);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(label + '.' + field + ' must be a safe integer');
  }
  return value;
}

function parseRegistrationIntentArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(label + ' must be an array');
  return value;
}

function readRegistrationIntentParticipantIds(
  record: object,
  field: string,
  label: string,
): number[] {
  const values = parseRegistrationIntentArray(
    readRegistrationIntentField(record, field, label),
    label + '.' + field,
  );
  if (values.length === 0) throw new Error(label + '.' + field + ' must not be empty');
  const participantIds: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(label + '.' + field + '[' + index + '] must be a positive safe integer');
    }
    participantIds.push(value);
  }
  return participantIds;
}

function readOptionalRegistrationIntentString(
  record: object,
  field: string,
  label: string,
): string | undefined {
  return hasRegistrationIntentField(record, field)
    ? readRegistrationIntentString(record, field, label)
    : undefined;
}

function parseAddSignerIntentChainTargetV1(
  raw: unknown,
  label = 'addSignerIntent.signerSelection.ecdsa.chainTarget',
): ThresholdEcdsaAddSignerChainTarget | null {
  try {
    const target = exactRegistrationIntentObject(
      raw,
      label,
      ['kind'],
      ['namespace', 'chainId', 'networkSlug'],
    );
    const kind = readRegistrationIntentString(target, 'kind', label);
    switch (kind) {
      case 'evm': {
        const evm = exactRegistrationIntentObject(
          target,
          label,
          ['kind', 'namespace', 'chainId'],
          ['networkSlug'],
        );
        if (readRegistrationIntentString(evm, 'namespace', label) !== 'eip155') return null;
        const chainId = readRegistrationIntentSafeInteger(evm, 'chainId', label, 1);
        const networkSlug = readOptionalRegistrationIntentString(evm, 'networkSlug', label);
        return networkSlug === undefined
          ? { kind: 'evm', namespace: 'eip155', chainId }
          : { kind: 'evm', namespace: 'eip155', chainId, networkSlug };
      }
      case 'tempo': {
        const tempo = exactRegistrationIntentObject(
          target,
          label,
          ['kind', 'chainId'],
          ['networkSlug'],
        );
        const chainId = readRegistrationIntentSafeInteger(tempo, 'chainId', label, 1);
        const networkSlug = readOptionalRegistrationIntentString(tempo, 'networkSlug', label);
        return networkSlug === undefined
          ? { kind: 'tempo', chainId }
          : { kind: 'tempo', chainId, networkSlug };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function parseAddSignerIntentSelectionV1(raw: unknown): AddSignerSelection {
  const label = 'addSignerIntent.signerSelection';
  const selection = exactRegistrationIntentObject(raw, label, ['mode'], ['ed25519', 'ecdsa']);
  const mode = readRegistrationIntentString(selection, 'mode', label);
  switch (mode) {
    case 'ed25519': {
      const branch = exactRegistrationIntentObject(selection, label, ['mode', 'ed25519']);
      const ed25519 = exactRegistrationIntentObject(
        readRegistrationIntentField(branch, 'ed25519', label),
        label + '.ed25519',
        ['mode', 'signerSlot', 'participantIds', 'keyPurpose', 'keyVersion', 'derivationVersion'],
      );
      if (
        readRegistrationIntentString(ed25519, 'mode', label + '.ed25519') !==
        'create_implicit_near_account'
      ) {
        throw new Error(label + '.ed25519.mode is unsupported');
      }
      readRegistrationIntentSafeInteger(ed25519, 'signerSlot', label + '.ed25519', 1);
      readRegistrationIntentParticipantIds(ed25519, 'participantIds', label + '.ed25519');
      readRegistrationIntentString(ed25519, 'keyPurpose', label + '.ed25519');
      readRegistrationIntentString(ed25519, 'keyVersion', label + '.ed25519');
      readRegistrationIntentSafeInteger(ed25519, 'derivationVersion', label + '.ed25519', 1);
      break;
    }
    case 'ecdsa': {
      const branch = exactRegistrationIntentObject(selection, label, ['mode', 'ecdsa']);
      const ecdsa = exactRegistrationIntentObject(
        readRegistrationIntentField(branch, 'ecdsa', label),
        label + '.ecdsa',
        ['chainTargets', 'participantIds'],
      );
      const chainTargets = parseRegistrationIntentArray(
        readRegistrationIntentField(ecdsa, 'chainTargets', label + '.ecdsa'),
        label + '.ecdsa.chainTargets',
      );
      if (chainTargets.length === 0) {
        throw new Error(label + '.ecdsa.chainTargets must not be empty');
      }
      for (const chainTarget of chainTargets) {
        if (!parseAddSignerIntentChainTargetV1(chainTarget)) {
          throw new Error(label + '.ecdsa.chainTargets contains an invalid target');
        }
      }
      readRegistrationIntentParticipantIds(ecdsa, 'participantIds', label + '.ecdsa');
      break;
    }
    default:
      throw new Error(label + '.mode is unsupported');
  }
  const normalized = normalizeAddSignerSelection(raw, {
    normalizeEcdsaChainTarget: parseAddSignerIntentChainTargetV1,
  });
  if (!normalized.ok) throw new Error(normalized.message);
  return normalized.value;
}

function parseAddAuthMethodInputV1(raw: unknown): AddAuthMethodInput {
  const label = 'addAuthMethodIntent.authMethod';
  const authMethod = exactRegistrationIntentObject(raw, label, ['kind'], ['rpId', 'email']);
  const kind = readRegistrationIntentString(authMethod, 'kind', label);
  switch (kind) {
    case 'passkey': {
      const passkey = exactRegistrationIntentObject(authMethod, label, ['kind', 'rpId']);
      const rpId = parseWebAuthnRpId(readRegistrationIntentString(passkey, 'rpId', label));
      if (!rpId.ok) throw new Error(rpId.error.message);
      break;
    }
    case 'email_otp': {
      const emailOtp = exactRegistrationIntentObject(authMethod, label, ['kind', 'email']);
      readRegistrationIntentString(emailOtp, 'email', label);
      break;
    }
    default:
      throw new Error(label + '.kind is unsupported');
  }
  const normalized = normalizeAddAuthMethodInput(raw);
  if (!normalized) throw new Error(label + ' is invalid');
  return normalized;
}

function validateAddAuthMethodIntentSourceV1(raw: unknown): void {
  const label = 'addAuthMethodIntent.source';
  const source = exactRegistrationIntentObject(raw, label, [
    'walletAuthorityId',
    'walletAuthMethodId',
    'walletSessionId',
    'authorityDigestB64u',
    'revocationEpoch',
  ]);
  const walletAuthorityId = parseWalletAuthorityId(
    readRegistrationIntentString(source, 'walletAuthorityId', label),
  );
  const walletAuthMethodId = parseWalletAuthMethodId(
    readRegistrationIntentString(source, 'walletAuthMethodId', label),
  );
  if (!walletAuthorityId.ok || !walletAuthMethodId.ok) {
    throw new Error(label + ' has invalid identity');
  }
  readRegistrationIntentString(source, 'walletSessionId', label);
  readRegistrationIntentString(source, 'authorityDigestB64u', label);
  readRegistrationIntentSafeInteger(source, 'revocationEpoch', label, 0);
}

function parseRegistrationIntentRuntimePolicyScopeV1(
  record: object,
  label: string,
): RuntimePolicyScopeLike | undefined {
  if (!hasRegistrationIntentField(record, 'runtimePolicyScope')) return undefined;
  const scopeLabel = label + '.runtimePolicyScope';
  const scope = exactRegistrationIntentObject(
    readRegistrationIntentField(record, 'runtimePolicyScope', label),
    scopeLabel,
    ['orgId', 'projectId', 'envId'],
    ['signingRootVersion'],
  );
  const orgId = readRegistrationIntentString(scope, 'orgId', scopeLabel);
  const projectId = readRegistrationIntentString(scope, 'projectId', scopeLabel);
  const envId = readRegistrationIntentString(scope, 'envId', scopeLabel);
  const signingRootVersion = readOptionalRegistrationIntentString(
    scope,
    'signingRootVersion',
    scopeLabel,
  );
  return signingRootVersion === undefined
    ? { orgId, projectId, envId }
    : { orgId, projectId, envId, signingRootVersion };
}

function readRegistrationIntentWalletId(record: object, label: string): WalletId {
  const result = parseWalletId(readRegistrationIntentString(record, 'walletId', label));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function readRegistrationIntentAuthMethodId(
  record: object,
  field: string,
  label: string,
): WalletAuthMethodId {
  const result = parseWalletAuthMethodId(readRegistrationIntentString(record, field, label));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function parseAddSignerIntentV1(raw: unknown): AddSignerIntentV1 {
  const label = 'addSignerIntent';
  const intent = exactRegistrationIntentObject(
    raw,
    label,
    ['version', 'walletId', 'signerSelection', 'nonceB64u'],
    ['runtimePolicyScope'],
  );
  if (readRegistrationIntentString(intent, 'version', label) !== 'add_signer_intent_v1') {
    throw new Error(label + '.version is unsupported');
  }
  const walletId = readRegistrationIntentWalletId(intent, label);
  const runtimePolicyScope = parseRegistrationIntentRuntimePolicyScopeV1(intent, label);
  const nonceB64u = readRegistrationIntentString(intent, 'nonceB64u', label);
  const signerSelection = parseAddSignerIntentSelectionV1(
    readRegistrationIntentField(intent, 'signerSelection', label),
  );
  return runtimePolicyScope === undefined
    ? { version: 'add_signer_intent_v1', walletId, signerSelection, nonceB64u }
    : {
        version: 'add_signer_intent_v1',
        walletId,
        signerSelection,
        runtimePolicyScope,
        nonceB64u,
      };
}

export function parseAddAuthMethodIntentV1(raw: unknown): AddAuthMethodIntentV1 {
  const label = 'addAuthMethodIntent';
  const intent = exactRegistrationIntentObject(
    raw,
    label,
    ['version', 'walletId', 'authMethod', 'targetWalletAuthMethodId', 'caller', 'nonceB64u'],
    ['runtimePolicyScope', 'source'],
  );
  if (readRegistrationIntentString(intent, 'version', label) !== 'add_auth_method_intent_v1') {
    throw new Error(label + '.version is unsupported');
  }
  const walletId = readRegistrationIntentWalletId(intent, label);
  const targetWalletAuthMethodId = readRegistrationIntentAuthMethodId(
    intent,
    'targetWalletAuthMethodId',
    label,
  );
  const authMethod = parseAddAuthMethodInputV1(
    readRegistrationIntentField(intent, 'authMethod', label),
  );
  const runtimePolicyScope = parseRegistrationIntentRuntimePolicyScopeV1(intent, label);
  const nonceB64u = readRegistrationIntentString(intent, 'nonceB64u', label);
  const caller = readRegistrationIntentString(intent, 'caller', label);
  switch (caller) {
    case 'same_device_addition':
      validateAddAuthMethodIntentSourceV1(readRegistrationIntentField(intent, 'source', label));
      break;
    case 'linked_device_ceremony':
      if (hasRegistrationIntentField(intent, 'source')) {
        throw new Error(label + '.source is not valid for linked_device_ceremony');
      }
      break;
    default:
      throw new Error(label + '.caller is unsupported');
  }
  const parsedCaller = normalizeAddAuthMethodIntentCaller(intent);
  if (!parsedCaller) throw new Error(label + '.caller is invalid');
  const common =
    runtimePolicyScope === undefined
      ? {
          version: 'add_auth_method_intent_v1' as const,
          walletId,
          authMethod,
          targetWalletAuthMethodId,
          nonceB64u,
        }
      : {
          version: 'add_auth_method_intent_v1' as const,
          walletId,
          authMethod,
          targetWalletAuthMethodId,
          runtimePolicyScope,
          nonceB64u,
        };
  switch (parsedCaller.caller) {
    case 'same_device_addition':
      return { ...common, caller: parsedCaller.caller, source: parsedCaller.source };
    case 'linked_device_ceremony':
      return { ...common, caller: parsedCaller.caller };
    default:
      return assertNeverAddAuthMethodIntentCaller(parsedCaller);
  }
}

function assertNeverAddAuthMethodIntentCaller(value: never): never {
  throw new Error(`Unsupported add-auth-method intent caller: ${String(value)}`);
}

function sameRegistrationIntentNumberArray(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Number.isSafeInteger(left[index]) || left[index] !== right[index]) return false;
  }
  return true;
}

function sameAddSignerIntentChainTargetV1(
  left: ThresholdEcdsaAddSignerChainTarget,
  right: ThresholdEcdsaAddSignerChainTarget,
): boolean {
  switch (left.kind) {
    case 'evm':
      return (
        right.kind === 'evm' &&
        left.namespace === right.namespace &&
        left.chainId === right.chainId &&
        left.networkSlug === right.networkSlug
      );
    case 'tempo':
      return (
        right.kind === 'tempo' &&
        left.chainId === right.chainId &&
        left.networkSlug === right.networkSlug
      );
    default:
      return assertNeverThresholdEcdsaAddSignerChainTarget(left);
  }
}

function assertNeverThresholdEcdsaAddSignerChainTarget(
  value: never,
): never {
  throw new Error(`Unsupported add-signer chain target: ${String(value)}`);
}

function sameAddSignerSelectionV1(left: AddSignerSelection, right: AddSignerSelection): boolean {
  if (left.mode !== right.mode) return false;
  switch (left.mode) {
    case 'ed25519':
      return (
        right.mode === 'ed25519' &&
        left.ed25519.mode === right.ed25519.mode &&
        left.ed25519.signerSlot === right.ed25519.signerSlot &&
        sameRegistrationIntentNumberArray(
          left.ed25519.participantIds,
          right.ed25519.participantIds,
        ) &&
        left.ed25519.keyPurpose === right.ed25519.keyPurpose &&
        left.ed25519.keyVersion === right.ed25519.keyVersion &&
        left.ed25519.derivationVersion === right.ed25519.derivationVersion
      );
    case 'ecdsa': {
      if (
        right.mode !== 'ecdsa' ||
        left.ecdsa.chainTargets.length !== right.ecdsa.chainTargets.length
      ) {
        return false;
      }
      for (let index = 0; index < left.ecdsa.chainTargets.length; index += 1) {
        if (
          !sameAddSignerIntentChainTargetV1(
            left.ecdsa.chainTargets[index],
            right.ecdsa.chainTargets[index],
          )
        ) {
          return false;
        }
      }
      return sameRegistrationIntentNumberArray(
        left.ecdsa.participantIds,
        right.ecdsa.participantIds,
      );
    }
    default:
      return assertNeverAddSignerSelection(left);
  }
}

function assertNeverAddSignerSelection(value: never): never {
  throw new Error(`Unsupported add-signer selection: ${String(value)}`);
}

function sameRegistrationIntentRuntimePolicyScope(
  left: RuntimePolicyScopeLike | undefined,
  right: RuntimePolicyScopeLike | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.orgId === right.orgId &&
    left.projectId === right.projectId &&
    left.envId === right.envId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

export function sameAddSignerIntentV1(left: AddSignerIntentV1, right: AddSignerIntentV1): boolean {
  return (
    left.version === right.version &&
    left.walletId === right.walletId &&
    sameAddSignerSelectionV1(left.signerSelection, right.signerSelection) &&
    sameRegistrationIntentRuntimePolicyScope(left.runtimePolicyScope, right.runtimePolicyScope) &&
    left.nonceB64u === right.nonceB64u
  );
}

function sameAddAuthMethodInputV1(left: AddAuthMethodInput, right: AddAuthMethodInput): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'passkey':
      return right.kind === 'passkey' && left.rpId === right.rpId;
    case 'email_otp':
      return right.kind === 'email_otp' && left.email === right.email;
    default:
      return assertNeverAddAuthMethodInput(left);
  }
}

function assertNeverAddAuthMethodInput(value: never): never {
  throw new Error(`Unsupported add-auth-method input: ${String(value)}`);
}

export function sameAddAuthMethodIntentV1(
  left: AddAuthMethodIntentV1,
  right: AddAuthMethodIntentV1,
): boolean {
  if (
    left.version !== right.version ||
    left.walletId !== right.walletId ||
    !sameAddAuthMethodInputV1(left.authMethod, right.authMethod) ||
    left.targetWalletAuthMethodId !== right.targetWalletAuthMethodId ||
    !sameRegistrationIntentRuntimePolicyScope(left.runtimePolicyScope, right.runtimePolicyScope) ||
    left.nonceB64u !== right.nonceB64u
  ) {
    return false;
  }
  switch (left.caller) {
    case 'same_device_addition':
      return (
        right.caller === 'same_device_addition' &&
        sameAddAuthMethodIntentSourceV1(left.source, right.source)
      );
    case 'linked_device_ceremony':
      return right.caller === 'linked_device_ceremony';
    default:
      return assertNeverAddAuthMethodIntent(left);
  }
}

function assertNeverAddAuthMethodIntent(value: never): never {
  throw new Error(`Unsupported add-auth-method intent: ${String(value)}`);
}

export function normalizeEmailOtpRegistrationProof(raw: unknown): EmailOtpRegistrationProof | null {
  const record = inspectRawObject(raw);
  if (!record) return null;
  const version = trimString('version' in record ? record.version : undefined);
  const proofKind = trimString('proofKind' in record ? record.proofKind : undefined);
  const providerSubject = trimString(
    'providerSubject' in record ? record.providerSubject : undefined,
  );
  const email = trimString('email' in record ? record.email : undefined).toLowerCase();
  const registrationIntentDigestB64u = trimString(
    'registrationIntentDigestB64u' in record ? record.registrationIntentDigestB64u : undefined,
  );
  if (
    version !== 'email_otp_registration_proof_v1' ||
    !providerSubject ||
    !email ||
    !registrationIntentDigestB64u
  ) {
    return null;
  }
  if (proofKind === 'otp_challenge') {
    const challengeId = trimString('challengeId' in record ? record.challengeId : undefined);
    const otpCode = trimString('otpCode' in record ? record.otpCode : undefined);
    const otpChannel = trimString('otpChannel' in record ? record.otpChannel : undefined);
    if (
      !challengeId ||
      !otpCode ||
      otpChannel !== 'email_otp' ||
      Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationAttemptId') ||
      Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationOfferId') ||
      Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationCandidateId')
    ) {
      return null;
    }
    return {
      version: 'email_otp_registration_proof_v1',
      proofKind: 'otp_challenge',
      providerSubject,
      email,
      challengeId,
      otpCode,
      otpChannel: 'email_otp',
      registrationIntentDigestB64u,
    };
  }
  if (proofKind === 'google_sso_registration') {
    const googleEmailOtpRegistrationAttemptId = trimString(
      'googleEmailOtpRegistrationAttemptId' in record
        ? record.googleEmailOtpRegistrationAttemptId
        : undefined,
    );
    const googleEmailOtpRegistrationOfferId = trimString(
      'googleEmailOtpRegistrationOfferId' in record
        ? record.googleEmailOtpRegistrationOfferId
        : undefined,
    );
    const googleEmailOtpRegistrationCandidateId = trimString(
      'googleEmailOtpRegistrationCandidateId' in record
        ? record.googleEmailOtpRegistrationCandidateId
        : undefined,
    );
    if (
      !googleEmailOtpRegistrationAttemptId ||
      !googleEmailOtpRegistrationOfferId ||
      !googleEmailOtpRegistrationCandidateId ||
      Object.prototype.hasOwnProperty.call(record, 'challengeId') ||
      Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
      Object.prototype.hasOwnProperty.call(record, 'otpChannel')
    ) {
      return null;
    }
    return {
      version: 'email_otp_registration_proof_v1',
      proofKind: 'google_sso_registration',
      providerSubject,
      email,
      googleEmailOtpRegistrationAttemptId,
      googleEmailOtpRegistrationOfferId,
      googleEmailOtpRegistrationCandidateId,
      registrationIntentDigestB64u,
    };
  }
  return null;
}

/** What a client sends to create a wallet's shared Email OTP enrollment. */
export type WalletEmailOtpEnrollmentMaterialV1 = {
  enrollmentSealKeyVersion: string;
  clientUnlockPublicKeyB64u: string;
  unlockKeyVersion: string;
  serverSealedFactorCiphertextB64u: string;
};

export type WalletAddAuthMethodEmailOtpTargetV1 =
  | { readonly kind: 'existing_enrollment'; readonly enrollment?: never }
  | {
      readonly kind: 'new_enrollment';
      readonly enrollment: WalletEmailOtpEnrollmentMaterialV1;
    };
