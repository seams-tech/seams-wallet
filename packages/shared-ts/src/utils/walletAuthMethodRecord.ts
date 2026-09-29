// A wallet's auth-method records: the stored passkey and Email OTP methods, their lifecycle,
// and the fingerprint of a request to revoke one.
import { type DigestB64u, parseDigestB64u } from './canonicalPrimitives';
import { alphabetizeStringify, sha256BytesUtf8 } from './digests';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
  type WebAuthnCredentialIdB64u,
  type WebAuthnRpId,
} from './domainIds';
import { base64UrlEncode } from './encoders';
import { inspectRawObject, trimString } from './registrationAuthMethodInput';
import type { Variant } from './variant';

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

type WalletAuthMethodLifecycleV1 =
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

type WalletAuthMethodCommonV1 = {
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

export type PasskeyWalletAuthMethodRecordV2 = Variant<WalletAuthMethodRecordV2, 'kind', 'passkey'>;
export type EmailOtpWalletAuthMethodRecordV2 = Variant<
  WalletAuthMethodRecordV2,
  'kind',
  'email_otp'
>;
export type PendingWalletAuthMethodRecordV2 = Variant<
  WalletAuthMethodRecordV2,
  'status',
  'pending_local_install'
>;
export type ActiveWalletAuthMethodRecordV2 = Variant<WalletAuthMethodRecordV2, 'status', 'active'>;
export type RevokedWalletAuthMethodRecordV2 = Variant<
  WalletAuthMethodRecordV2,
  'status',
  'revoked'
>;
export type ActivePasskeyWalletAuthMethodRecordV2 = Variant<
  ActiveWalletAuthMethodRecordV2,
  'kind',
  'passkey'
>;
export type ActiveEmailOtpWalletAuthMethodRecordV2 = Variant<
  ActiveWalletAuthMethodRecordV2,
  'kind',
  'email_otp'
>;

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
