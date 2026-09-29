import {
  delegatedWalletPermissionNamesV1,
  parseDelegatedWalletAuthorityV1 as parseDelegatedWalletAuthorityResult,
  type DelegatedWalletAuthorityV1,
  type DelegatedWalletPermissionV1,
} from '../authorization/delegatedAuthority';
import {
  parseDeviceId as parseAuthorizationDeviceId,
  parseMpcWalletSigningQuotaId,
  parseWalletSessionAuthorizationId,
  parseWalletSessionId,
  type WalletSessionAuthorizationId,
  type WalletSessionId,
} from '../authorization/capabilityKinds';
import {
  parseLinkedDeviceEnrollmentId,
  parseLinkedDeviceId,
  parseLinkDeviceSessionId,
  parseWalletKeyId,
  type LinkedDeviceEnrollmentId,
  type LinkedDeviceId,
  type LinkDeviceSessionId,
  type WalletKeyId,
} from '../signing-lanes/ids';
import {
  parseMpcMaterialActivationRef,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseVerifiedEmailAddress,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type WalletAuthMethodId,
  type VerifiedEmailAddress,
  type WebAuthnCredentialIdB64u,
} from '../utils/domainIds';
import { parseDigestB64u } from '../utils/canonicalPrimitives';
import { parseWalletAddAuthMethodRegistrationOptions } from '../utils/addAuthMethodRegistration';
import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import {
  parseLinkedDeviceWalletSessionCredentialDeliveryBindingV1,
  parseLinkedDeviceWalletSessionCredentialDeliveryV1,
} from './walletSessionCredentialDelivery';
import { parseEd25519PublicKeyB64u, parseUnixMs } from '../passkey-custody/primitives';
import {
  parseWalletAuthorityV1,
  parseWalletSignerActivationSetV1,
} from '../authorization/walletAuthority';
import { parseWalletAuthMethodRecordV2 } from '../utils/registrationIntent';
import {
  type EmailOtpWalletAuthMethodDraftV1,
  type PasskeyWalletAuthMethodDraftV1,
  type WalletEmailOtpEnrollmentMaterialV1,
} from '../utils/registrationIntent';
import { requireRouterAbX25519PublicKey } from '../utils/routerAbPublicKeyset';
import { parseWebAuthnAuthenticatorDeviceInfo } from '../utils/webauthnDeviceInfo';
import {
  type LinkedDeviceApprovalV1,
  type LinkedDeviceApprovalDeliveryV1,
  type LinkedDeviceApprovalResultV1,
  type LinkedDevicePendingSessionStateV1,
  type LinkedDeviceListRequestV1,
  type LinkedDeviceListResultV1,
  type OwnerDeviceSummaryV1,
  type LinkedDeviceRevokeRequestV1,
  type LinkedDeviceRevokeResultV1,
  type LinkedDeviceSummaryV1,
  type LinkedOwnerCredentialMetadataV1,
  type LinkedDeviceOwnerAuthorizationSourceV1,
  type LinkedDeviceOwnerAuthorizationRequestV1,
  type LinkedDeviceSessionClaimRequestV1,
  type LinkedDeviceSessionClaimV1,
  type LinkSessionProjectionV1,
  type LinkPrecommitFailureV1,
  type LinkSessionStateV1,
  type LinkSessionTransportEventV1,
  type LinkedDeviceSessionTransportRequestV1,
  type LinkedDeviceTargetCredentialRegistrationV1,
  type LinkedDeviceTargetCredentialRegistrationResultV1,
  type OrdinarySignerMaterialRecipientRequestV1,
  type OrdinarySignerMaterialRecipientRequirementV1,
  type LinkedDeviceTargetPreparationRequestV1,
  type VerifiedTargetFactorV1,
  type LinkedDeviceEd25519ExportRootPreparationV1,
  type LinkedDeviceEmailOtpVerificationGrantV1,
  type LinkedDeviceEmailOtpFactorReleaseEnvelopeV1,
  type LinkedDeviceEmailOtpChallengeStartRequestV1,
  type LinkedDeviceEmailOtpChallengeResendRequestV1,
  type LinkedDeviceEmailOtpChallengeVerifyRequestV1,
  type LinkedDeviceEmailOtpChallengeResultV1,
  type LinkedDeviceEmailOtpVerificationResultV1,
  type LinkedDeviceTargetPreparationV1,
  type LinkedDevicePasskeyCreationOptionsV1,
  type LinkedDeviceWebAuthnRegistrationV1,
  type LinkDevicePublicKeyB64u,
  type QrLinkedDeviceSessionPayloadV5,
  type LinkedDeviceTargetFactorV1,
  type LinkedDeviceApprovedTargetFactorV1,
  type LinkedDeviceEmailOtpBaseFactorChoiceV1,
  type LinkedDeviceEmailOtpEnrollmentSelectionV1,
  type LinkedDeviceEmailOtpBaseFactorRequestV1,
  type LinkedDeviceEmailOtpBaseFactorResolutionV1,
  type LinkedDeviceEmailOtpBaseFactorResolutionResultV1,
  type ActiveWalletSessionV1,
  type ActivateInstalledAuthorityResultV1,
  type ActivationRetryReasonV1,
  type LinkIntegrityFailureV1,
  type LocalAuthorityActivationFinalAckV1,
  type LocalAuthorityInstallationReceiptV1,
  type WalletSessionOperationCredentialV1,
  type WalletCapabilitySubjectV1,
} from './contracts';
import {
  parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1,
  parseLinkedDeviceOrdinaryMaterialSourceContributionTupleV1,
} from './sourceContribution';
import { requireArray, requireRecord } from '../utils/validation';
import { exactRecord, rejectUnknownFields } from '../utils/exactRecord';
import {
  wireLabeled,
  wireLiteral,
  wireNullable,
  wireObject,
  wireResult,
  wireUnion,
  type AllTrue,
  type ParsesExactly,
  type WireParser,
} from '../utils/wireSchema';
import type { Variant } from '../utils/variant';

type UnknownRecord = Record<string, unknown>;

export {
  parseCommittedSignerPackageSetDigestB64u,
  parseCommittedSignerPackageSetV1,
} from './committedSignerPackages';

const QR_FIELDS = [
  'version',
  'purpose',
  'linkSessionId',
  'linkPublicKeyB64u',
  'devicePublicKeyB64u',
  'requestedPermission',
  'targetFactor',
  'issuedAtMs',
  'expiresAtMs',
] as const;
const COMPACT_QR_FIELDS = ['v', 's', 'l', 'd', 'a', 'f', 'i', 'e'] as const;

const sessionId = /* @__PURE__ */ wireResult(parseLinkDeviceSessionId);
const walletId = /* @__PURE__ */ wireResult(parseWalletId);
const enrollmentId = /* @__PURE__ */ wireResult(parseLinkedDeviceEnrollmentId);
const linkedDeviceId = /* @__PURE__ */ wireResult(parseLinkedDeviceId);
const authorizationDeviceId = /* @__PURE__ */ wireResult(parseAuthorizationDeviceId);
const walletKeyId = /* @__PURE__ */ wireResult(parseWalletKeyId);
const walletSessionId = /* @__PURE__ */ wireResult(parseWalletSessionId);
const walletSessionAuthorizationId = /* @__PURE__ */ wireResult(parseWalletSessionAuthorizationId);
const walletAuthMethodId = /* @__PURE__ */ wireResult(parseWalletAuthMethodId);
const walletAuthorityId = /* @__PURE__ */ wireResult(parseWalletAuthorityId);
const credentialId = /* @__PURE__ */ wireResult(parseWebAuthnCredentialIdB64u);
const rpId = /* @__PURE__ */ wireResult(parseWebAuthnRpId);
const quotaId = /* @__PURE__ */ wireResult(parseMpcWalletSigningQuotaId);
const materialActivation = /* @__PURE__ */ wireResult(parseMpcMaterialActivationRef);
const digest = /* @__PURE__ */ wireLabeled(parseDigestB64u);
const nullableToken = /* @__PURE__ */ wireNullable(parseNonEmptyToken);

// Some records name a bad field by its key alone rather than by its path.
function keyLabeled<T>(parse: WireParser<T>): WireParser<T> {
  return (raw, label) => parse(raw, label.slice(label.lastIndexOf('.') + 1));
}

// A list that may be empty, reported as invalid when it is not an array.
function listOf<T>(item: WireParser<T>): WireParser<T[]> {
  return (raw, label) => {
    if (!Array.isArray(raw)) throw new Error(`${label} is invalid`);
    return raw.map((entry, index) => item(entry, `${label}[${index}]`));
  };
}

// One of the given strings; any other value is reported as unsupported.
function supportedLiteral<V extends string>(...values: V[]): WireParser<V> {
  return (raw, label) => {
    if (!values.includes(raw as V)) throw new Error(`${label} is unsupported`);
    return raw as V;
  };
}

function parseLinkedDeviceRevokeWalletAuthMethodId(
  raw: unknown,
  label: string,
): WalletAuthMethodId {
  const value = walletAuthMethodId(raw, label);
  if (value.startsWith('wallet-authority:') || value.startsWith('authority:')) {
    throw new Error(`${label} must identify a WalletAuthMethodId`);
  }
  return value;
}

function parseUnixTime(raw: unknown, label: string): number {
  try {
    return parseUnixMs(raw, label);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} is invalid`);
  }
}

function parseEmailHashHex(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/.test(raw)) {
    throw new Error(`${label} must be 32 canonical lowercase hex bytes`);
  }
  return raw;
}

function parseNonEmptyToken(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.trim() !== raw) {
    throw new Error(`${label} must be a non-empty canonical string`);
  }
  for (const character of raw) {
    const code = character.charCodeAt(0);
    if (/\s/.test(character) || code <= 31 || code === 127) {
      throw new Error(`${label} must not contain whitespace or control characters`);
    }
  }
  return raw;
}

function parsePublicKey(raw: unknown, label: string): LinkDevicePublicKeyB64u {
  if (typeof raw !== 'string' || raw.length === 0 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error(`${label} must be canonical unpadded base64url`);
  }
  try {
    const decoded = base64UrlDecode(raw);
    if (decoded.length !== 32 || base64UrlEncode(decoded) !== raw) throw new Error('non-canonical');
  } catch {
    throw new Error(`${label} must be a canonical 32-byte unpadded base64url key`);
  }
  return raw as LinkDevicePublicKeyB64u;
}

function parseCanonicalBase64UrlBytes(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error(`${label} must be canonical unpadded base64url`);
  }
  try {
    const decoded = base64UrlDecode(raw);
    if (decoded.length === 0 || base64UrlEncode(decoded) !== raw) throw new Error('non-canonical');
  } catch {
    throw new Error(`${label} must be canonical unpadded base64url`);
  }
  return raw;
}

function parseCanonicalFixedBase64UrlBytes(raw: unknown, length: number, label: string): string {
  const value = parseCanonicalBase64UrlBytes(raw, label);
  const decoded = base64UrlDecode(value);
  try {
    if (decoded.length !== length) throw new Error(`${label} must encode ${length} bytes`);
    return value;
  } finally {
    decoded.fill(0);
  }
}

const P256_FIELD_PRIME = BigInt(
  '0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff',
);
const P256_CURVE_A = P256_FIELD_PRIME - 3n;
const P256_CURVE_B = BigInt(
  '0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b',
);

function bigEndianBytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function isP256Point(decoded: Uint8Array): boolean {
  const x = bigEndianBytesToBigInt(decoded.subarray(1, 33));
  const y = bigEndianBytesToBigInt(decoded.subarray(33, 65));
  if (x >= P256_FIELD_PRIME || y >= P256_FIELD_PRIME) return false;
  const left = (y * y) % P256_FIELD_PRIME;
  const right =
    ((x * x * x) % P256_FIELD_PRIME +
      (P256_CURVE_A * x) % P256_FIELD_PRIME +
      P256_CURVE_B) %
    P256_FIELD_PRIME;
  return left === right;
}

// An ECDH recipient or sender key must be a well-formed uncompressed SEC1
// P-256 point (65 bytes, 0x04 prefix) before it is persisted or sealed to —
// a malformed point would otherwise fail only after the OTP code is spent.
function parseUncompressedP256PointB64u(raw: unknown, label: string): string {
  const value = parseCanonicalFixedBase64UrlBytes(raw, 65, label);
  const decoded = base64UrlDecode(value);
  try {
    if (decoded[0] !== 0x04) {
      throw new Error(`${label} must be an uncompressed SEC1 P-256 point`);
    }
    if (!isP256Point(decoded)) {
      throw new Error(`${label} must be an on-curve P-256 point`);
    }
    return value;
  } finally {
    decoded.fill(0);
  }
}

export function parseLinkDevicePublicKeyB64u(raw: unknown): LinkDevicePublicKeyB64u {
  return parsePublicKey(raw, 'LinkDevicePublicKeyB64u');
}

function parseCredential(raw: unknown, label: string): WebAuthnCredentialIdB64u {
  return credentialId(parseCanonicalBase64UrlBytes(raw, label), label);
}

function parseKeyFamily(raw: unknown, label: string): 'ed25519' | 'ecdsa_secp256k1' {
  if (raw !== 'ed25519' && raw !== 'ecdsa_secp256k1') {
    throw new Error(`${label} must identify a supported key family`);
  }
  return raw;
}

function parseNonNegativeSafeInteger(raw: unknown, label: string): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return Number(raw);
}

function parsePositiveSafeInteger(raw: unknown, label: string): number {
  const value = parseNonNegativeSafeInteger(raw, label);
  if (value < 1) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function assertExpiryAfterIssued(issuedAtMs: number, expiresAtMs: number, label: string): void {
  if (expiresAtMs <= issuedAtMs) throw new Error(`${label}.expiresAtMs must be after issuedAtMs`);
}

function parseDelegatedWalletAuthority(raw: unknown, label: string): DelegatedWalletAuthorityV1 {
  const result = parseDelegatedWalletAuthorityResult(raw);
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.value;
}

function delegatedWalletAuthorityWireValue(value: DelegatedWalletAuthorityV1): {
  readonly kind: DelegatedWalletAuthorityV1['kind'];
  readonly permissions: readonly DelegatedWalletPermissionV1[];
} {
  return {
    kind: value.kind,
    permissions: [...delegatedWalletPermissionNamesV1(value)],
  };
}

function qrPayloadWireValue(payload: QrLinkedDeviceSessionPayloadV5): UnknownRecord {
  const base = {
    version: payload.version,
    purpose: payload.purpose,
    linkSessionId: payload.linkSessionId,
    linkPublicKeyB64u: payload.linkPublicKeyB64u,
    devicePublicKeyB64u: payload.devicePublicKeyB64u,
    requestedPermission: delegatedWalletAuthorityWireValue(payload.requestedPermission),
    targetFactor: payload.targetFactor,
    issuedAtMs: payload.issuedAtMs,
    expiresAtMs: payload.expiresAtMs,
  };
  return payload.targetFactor.kind === 'email_otp'
    ? { ...base, targetEmail: payload.targetEmail }
    : base;
}

function parseTargetFactor(raw: unknown, label: string): LinkedDeviceTargetFactorV1 {
  const record = exactRecord(raw, ['kind'], label);
  switch (record.kind) {
    case 'passkey_prf':
      return { kind: 'passkey_prf' };
    case 'email_otp':
      return { kind: 'email_otp' };
    default:
      throw new Error(`${label}.kind is unsupported`);
  }
}

function passkeyTargetFactorV1() {
  return wireObject({ kind: wireLiteral('passkey_prf') });
}

function emailOtpTargetFactorV1() {
  return wireObject({ kind: wireLiteral('email_otp') });
}

function parseTargetEmail(raw: unknown, label: string): VerifiedEmailAddress {
  const parsed = parseVerifiedEmailAddress(raw);
  if (!parsed.ok) throw new Error(`${label} ${parsed.error.message}`);
  return parsed.value;
}

function existingEnrollmentV1() {
  return wireObject({ kind: wireLiteral('existing_enrollment') });
}

function newEnrollmentV1() {
  return wireObject({ kind: wireLiteral('new_enrollment') });
}

function emailOtpEnrollmentSelectionV1() {
  return wireUnion('kind', [existingEnrollmentV1(), newEnrollmentV1()]);
}

function parseEmailOtpEnrollmentSelection(
  raw: unknown,
  label: string,
): LinkedDeviceEmailOtpEnrollmentSelectionV1 {
  return emailOtpEnrollmentSelectionV1()(raw, label);
}

function emailOtpEnrollmentMaterialV1() {
  return wireObject({
    enrollmentSealKeyVersion: parseNonEmptyToken,
    clientUnlockPublicKeyB64u: parseNonEmptyToken,
    unlockKeyVersion: parseNonEmptyToken,
    serverSealedFactorCiphertextB64u: parseNonEmptyToken,
  });
}

// Hand-written: the enrollment and address are checked before the keys, so a missing
// address reports what the address parser says about it.
function parseApprovedTargetFactor(
  raw: unknown,
  label: string,
): LinkedDeviceApprovedTargetFactorV1 {
  const record = requireRecord(raw, label);
  if (record.kind === 'passkey_prf') {
    exactRecord(record, ['kind'], label);
    return { kind: 'passkey_prf' };
  }
  if (record.kind === 'email_otp') {
    const enrollment = parseEmailOtpEnrollmentSelection(record.enrollment, `${label}.enrollment`);
    const targetEmail = parseTargetEmail(record.targetEmail, `${label}.targetEmail`);
    if (enrollment.kind === 'existing_enrollment') {
      const exact = exactRecord(
        record,
        ['kind', 'targetEmail', 'enrollment', 'baseWalletAuthMethodId'],
        label,
      );
      return {
        kind: 'email_otp',
        targetEmail,
        enrollment,
        baseWalletAuthMethodId: walletAuthMethodId(
          exact.baseWalletAuthMethodId,
          `${label}.baseWalletAuthMethodId`,
        ),
      };
    }
    exactRecord(record, ['kind', 'targetEmail', 'enrollment'], label);
    return { kind: 'email_otp', targetEmail, enrollment };
  }
  throw new Error(`${label}.kind is unsupported`);
}

function parseWebAuthnDeviceInfo(raw: unknown, label: string) {
  const device = parseWebAuthnAuthenticatorDeviceInfo(raw);
  if (!device) throw new Error(`${label} is invalid`);
  return device;
}

function linkedOwnerCredentialMetadataV1() {
  return wireUnion('kind', [
    wireObject({
      kind: wireLiteral('passkey'),
      walletAuthMethodId,
      credentialIdB64u: credentialId,
      device: parseWebAuthnDeviceInfo,
    }),
    wireObject({ kind: wireLiteral('email_otp'), walletAuthMethodId, email: parseTargetEmail }),
  ]);
}

function parseLinkedOwnerCredentialMetadata(
  raw: unknown,
  label: string,
): LinkedOwnerCredentialMetadataV1 {
  return linkedOwnerCredentialMetadataV1()(raw, label);
}

function linkedDeviceSummaryV1() {
  return wireObject({
    deviceId: linkedDeviceId,
    enrollmentId,
    walletId,
    credential: parseLinkedOwnerCredentialMetadata,
    permission: parseDelegatedWalletAuthority,
    keyManifestDigestB64u: digest,
    coveredWalletKeys: listOf(walletKeyId),
    state: wireLiteral('provisioning', 'active', 'suspended', 'expired', 'revoked'),
    createdAtMs: parseUnixTime,
    lastActivityAtMs: parseUnixTime,
    revocationEpoch: parseNonNegativeSafeInteger,
  });
}

export function parseLinkedDeviceSummaryV1(raw: unknown): LinkedDeviceSummaryV1 {
  return linkedDeviceSummaryV1()(raw, 'LinkedDeviceSummaryV1');
}

function linkedDeviceListRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_list_request_v1'),
    walletId,
    limit: parsePositiveSafeInteger,
    cursor: nullableToken,
  });
}

export function parseLinkedDeviceListRequestV1(raw: unknown): LinkedDeviceListRequestV1 {
  return linkedDeviceListRequestV1()(raw, 'LinkedDeviceListRequestV1');
}

function ownerDeviceSummaryV1() {
  return wireObject({
    walletId,
    walletAuthorityId,
    credential: parseLinkedOwnerCredentialMetadata,
    createdAtMs: parseUnixTime,
    lastActivityAtMs: parseUnixTime,
  });
}

// Each device reports its errors under its own record name, not its place in the list.
function linkedDeviceListResultV1() {
  const ownerDevice = ownerDeviceSummaryV1();
  return wireObject({
    devices: listOf(parseLinkedDeviceSummaryV1),
    ownerDevices: listOf((raw) => ownerDevice(raw, 'OwnerDeviceSummaryV1')),
    nextCursor: nullableToken,
  });
}

export function parseLinkedDeviceListResultV1(raw: unknown): LinkedDeviceListResultV1 {
  return linkedDeviceListResultV1()(raw, 'LinkedDeviceListResultV1');
}

function linkedDeviceRevokeRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_revoke_request_v1'),
    walletId,
    walletAuthMethodId: parseLinkedDeviceRevokeWalletAuthMethodId,
    requestedAtMs: parseUnixTime,
  });
}

export function parseLinkedDeviceRevokeRequestV1(raw: unknown): LinkedDeviceRevokeRequestV1 {
  return linkedDeviceRevokeRequestV1()(raw, 'LinkedDeviceRevokeRequestV1');
}

function linkedDeviceRevokeFailureV1() {
  return wireObject({ kind: wireLiteral('not_found', 'conflict', 'unauthorized') });
}

function linkedDeviceRevokedV1() {
  return wireObject({
    kind: wireLiteral('revoked'),
    walletAuthMethodId: parseLinkedDeviceRevokeWalletAuthMethodId,
    authorityId: walletAuthorityId,
    revocationEpoch: parseNonNegativeSafeInteger,
  });
}

// Any kind other than a failure's is read as a revocation, whose keys are checked first.
export function parseLinkedDeviceRevokeResultV1(raw: unknown): LinkedDeviceRevokeResultV1 {
  const record = requireRecord(raw, 'LinkedDeviceRevokeResultV1');
  const failed =
    record.kind === 'not_found' || record.kind === 'conflict' || record.kind === 'unauthorized';
  return (failed ? linkedDeviceRevokeFailureV1() : linkedDeviceRevokedV1())(
    record,
    'LinkedDeviceRevokeResultV1',
  );
}

function parseQrPayloadRecord(record: UnknownRecord): QrLinkedDeviceSessionPayloadV5 {
  if (record.version !== 'v5') throw new Error('QrLinkedDeviceSessionPayloadV5.version is invalid');
  if (record.purpose !== 'linked_device_lane_creation') {
    throw new Error('QrLinkedDeviceSessionPayloadV5.purpose is invalid');
  }
  const issuedAtMs = parseUnixTime(record.issuedAtMs, 'QrLinkedDeviceSessionPayloadV5.issuedAtMs');
  const expiresAtMs = parseUnixTime(
    record.expiresAtMs,
    'QrLinkedDeviceSessionPayloadV5.expiresAtMs',
  );
  assertExpiryAfterIssued(issuedAtMs, expiresAtMs, 'QrLinkedDeviceSessionPayloadV5');
  const base = {
    version: 'v5',
    purpose: 'linked_device_lane_creation',
    linkSessionId: sessionId(record.linkSessionId, 'QrLinkedDeviceSessionPayloadV5.linkSessionId'),
    linkPublicKeyB64u: parsePublicKey(
      record.linkPublicKeyB64u,
      'QrLinkedDeviceSessionPayloadV5.linkPublicKeyB64u',
    ),
    devicePublicKeyB64u: parsePublicKey(
      record.devicePublicKeyB64u,
      'QrLinkedDeviceSessionPayloadV5.devicePublicKeyB64u',
    ),
    requestedPermission: parseDelegatedWalletAuthority(
      record.requestedPermission,
      'QrLinkedDeviceSessionPayloadV5.requestedPermission',
    ),
    targetFactor: parseTargetFactor(
      record.targetFactor,
      'QrLinkedDeviceSessionPayloadV5.targetFactor',
    ),
    issuedAtMs,
    expiresAtMs,
  } as const;
  if (base.targetFactor.kind === 'email_otp') {
    return {
      ...base,
      targetFactor: { kind: 'email_otp' },
      targetEmail: parseTargetEmail(
        record.targetEmail,
        'QrLinkedDeviceSessionPayloadV5.targetEmail',
      ),
    };
  }
  return { ...base, targetFactor: { kind: 'passkey_prf' } };
}

// Hand-written: serialize checks a typed payload's fields without checking its keys.
export function parseQrLinkedDeviceSessionPayloadV5(raw: unknown): QrLinkedDeviceSessionPayloadV5 {
  const candidate = requireRecord(raw, 'QrLinkedDeviceSessionPayloadV5');
  const targetFactor = parseTargetFactor(
    candidate.targetFactor,
    'QrLinkedDeviceSessionPayloadV5.targetFactor',
  );
  return parseQrPayloadRecord(
    exactRecord(
      candidate,
      targetFactor.kind === 'email_otp' ? [...QR_FIELDS, 'targetEmail'] : QR_FIELDS,
      'QrLinkedDeviceSessionPayloadV5',
    ),
  );
}

export function serializeQrLinkedDeviceSessionPayloadV5(
  payload: QrLinkedDeviceSessionPayloadV5,
): string {
  const parsed = parseQrPayloadRecord(qrPayloadWireValue(payload));
  const compact = {
    v: 5,
    s: parsed.linkSessionId,
    l: parsed.linkPublicKeyB64u,
    d: parsed.devicePublicKeyB64u,
    a: delegatedWalletAuthorityWireValue(parsed.requestedPermission),
    f: parsed.targetFactor.kind === 'passkey_prf' ? 'p' : 'e',
    i: parsed.issuedAtMs,
    e: parsed.expiresAtMs,
  };
  return parsed.targetFactor.kind === 'email_otp'
    ? JSON.stringify({ ...compact, t: parsed.targetEmail })
    : JSON.stringify(compact);
}

export function parseQrLinkedDeviceSessionTextV5(raw: string): QrLinkedDeviceSessionPayloadV5 {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('Linked-device QR payload is not valid JSON');
  }
  const candidate = requireRecord(decoded, 'LinkedDeviceQrV5');
  const targetFactorKind = candidate.f === 'e' ? 'email_otp' : 'passkey_prf';
  const compact = exactRecord(
    candidate,
    targetFactorKind === 'email_otp' ? [...COMPACT_QR_FIELDS, 't'] : COMPACT_QR_FIELDS,
    'LinkedDeviceQrV5',
  );
  if (compact.v !== 5) throw new Error('LinkedDeviceQrV5.v is invalid');
  if (compact.f !== 'p' && compact.f !== 'e') {
    throw new Error('LinkedDeviceQrV5.f is invalid');
  }
  const payload = {
    version: 'v5',
    purpose: 'linked_device_lane_creation',
    linkSessionId: compact.s,
    linkPublicKeyB64u: compact.l,
    devicePublicKeyB64u: compact.d,
    requestedPermission: compact.a,
    issuedAtMs: compact.i,
    expiresAtMs: compact.e,
  };
  return parseQrLinkedDeviceSessionPayloadV5(
    compact.f === 'e'
      ? { ...payload, targetFactor: { kind: 'email_otp' }, targetEmail: compact.t }
      : { ...payload, targetFactor: { kind: 'passkey_prf' } },
  );
}

function linkedDeviceOwnerAuthorizationRequestV1() {
  return wireObject({
    payload: parseQrLinkedDeviceSessionPayloadV5,
    requestedAtMs: parseUnixTime,
  });
}

export function parseLinkedDeviceOwnerAuthorizationRequestV1(
  raw: unknown,
): LinkedDeviceOwnerAuthorizationRequestV1 {
  return linkedDeviceOwnerAuthorizationRequestV1()(raw, 'LinkedDeviceOwnerAuthorizationRequestV1');
}

function linkSessionStatesV1() {
  const withDevice = <S extends LinkSessionStateV1['state']>(state: S) =>
    wireObject({ state: wireLiteral(state), deviceId: authorizationDeviceId });
  return [
    wireObject({ state: wireLiteral('displaying_qr') }),
    withDevice('claimed'),
    withDevice('awaiting_target_factor'),
    withDevice('awaiting_source_contribution'),
    withDevice('provisioning'),
    wireObject({
      state: wireLiteral('authority_pending_local_install'),
      deviceId: authorizationDeviceId,
      authorityId: walletAuthorityId,
      packageSetDigestB64u: digest,
    }),
    wireObject({
      state: wireLiteral('active'),
      deviceId: authorizationDeviceId,
      authorityId: walletAuthorityId,
      activatedAtMs: parseUnixTime,
    }),
    wireObject({ state: wireLiteral('failed_before_commit'), error: parseLinkPrecommitFailureV1 }),
    wireObject({ state: wireLiteral('cancelled'), cancelledAtMs: parseUnixTime }),
    wireObject({ state: wireLiteral('expired'), expiredAtMs: parseUnixTime }),
  ];
}

// Each state reports its errors under its own name, as `LinkSessionStateV1.<state>`.
export function parseLinkSessionStateV1(raw: unknown): LinkSessionStateV1 {
  const state = requireRecord(raw, 'LinkSessionStateV1').state;
  if (typeof state !== 'string') throw new Error('LinkSessionStateV1.state is invalid');
  const schema = linkSessionStatesV1().find((variant) =>
    (variant.shape.state.literals as readonly string[]).includes(state),
  );
  if (!schema) throw new Error(`LinkSessionStateV1.state ${state} is unsupported`);
  return schema(raw, `LinkSessionStateV1.${state}`);
}

function parseLinkPrecommitFailureV1(raw: unknown): LinkPrecommitFailureV1 {
  const record = exactRecord(raw, ['kind', 'reason'], 'LinkPrecommitFailureV1');
  if (
    record.kind !== 'invalid_input' &&
    record.kind !== 'unauthorized_source' &&
    record.kind !== 'revoked_source' &&
    record.kind !== 'permission_attenuation_failed' &&
    record.kind !== 'target_factor_failed' &&
    record.kind !== 'expired_session' &&
    record.kind !== 'cancelled_session' &&
    record.kind !== 'claim_conflict' &&
    record.kind !== 'package_preparation_failed'
  ) {
    throw new Error('LinkPrecommitFailureV1.kind is invalid');
  }
  return {
    kind: record.kind,
    reason: parseNonEmptyToken(record.reason, 'LinkPrecommitFailureV1.reason'),
  };
}

function linkSessionProjectionV1() {
  return wireObject({
    kind: wireLiteral('linked_device_session_projection_v1'),
    linkSessionId: sessionId,
    qrPayload: parseQrLinkedDeviceSessionPayloadV5,
    revision: parseNonNegativeSafeInteger,
    createdAtMs: parseUnixTime,
    updatedAtMs: parseUnixTime,
    state: parseLinkSessionStateV1,
  });
}

export function parseLinkSessionProjectionV1(raw: unknown): LinkSessionProjectionV1 {
  return linkSessionProjectionV1()(raw, 'LinkSessionProjectionV1');
}

function linkSessionTransportEventV1() {
  return wireObject({
    kind: wireLiteral('linked_device_session_event_v1'),
    linkSessionId: sessionId,
    state: parseLinkSessionStateV1,
    emittedAtMs: parseUnixTime,
  });
}

export function parseLinkSessionTransportEventV1(raw: unknown): LinkSessionTransportEventV1 {
  return linkSessionTransportEventV1()(raw, 'LinkSessionTransportEventV1');
}

function linkedDeviceApprovalResultV1() {
  return wireUnion('outcome', [
    wireObject({ outcome: wireLiteral('pending'), state: parsePendingApprovalState }),
    wireObject({
      outcome: wireLiteral('replayed'),
      replay: wireObject({
        // Only its presence is checked: a replay always reports a pending approval.
        state: (): 'pending' => 'pending',
        session: parsePendingApprovalState,
      }),
    }),
  ]);
}

export function parseLinkedDeviceApprovalResultV1(raw: unknown): LinkedDeviceApprovalResultV1 {
  return linkedDeviceApprovalResultV1()(raw, 'LinkedDeviceApprovalResultV1');
}

function parsePendingApprovalState(raw: unknown): LinkedDevicePendingSessionStateV1 {
  const state = parseLinkSessionStateV1(raw);
  switch (state.state) {
    case 'awaiting_target_factor':
    case 'awaiting_source_contribution':
    case 'provisioning':
    case 'authority_pending_local_install':
      return state;
    default:
      throw new Error('LinkedDeviceApprovalResultV1 state is not pending');
  }
}

function linkedDeviceSessionClaimRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_session_claim_request_v1'),
    payload: parseQrLinkedDeviceSessionPayloadV5,
  });
}

export function parseLinkedDeviceSessionClaimRequestV1(
  raw: unknown,
): LinkedDeviceSessionClaimRequestV1 {
  return linkedDeviceSessionClaimRequestV1()(raw, 'LinkedDeviceSessionClaimRequestV1');
}

function linkedDeviceSessionClaimV1() {
  return wireObject(
    {
      kind: wireLiteral('linked_device_session_claim_v1'),
      linkSessionId: sessionId,
      walletId,
      enrollmentId,
      deviceId: linkedDeviceId,
      devicePublicKeyB64u: parsePublicKey,
      targetFactor: parseTargetFactor,
      sessionRevision: parseUnixTime,
      claimedAtMs: parseUnixTime,
      claimExpiresAtMs: parseUnixTime,
    },
    (claim, label) => assertExpiryAfterIssued(claim.claimedAtMs, claim.claimExpiresAtMs, label),
  );
}

export function parseLinkedDeviceSessionClaimV1(raw: unknown): LinkedDeviceSessionClaimV1 {
  return linkedDeviceSessionClaimV1()(raw, 'LinkedDeviceSessionClaimV1');
}

function walletSessionOwnerAuthorizationV1() {
  return wireObject({
    kind: wireLiteral('wallet_session'),
    walletSessionId,
    authorizationId: walletSessionAuthorizationId,
  });
}

export function parseLinkedDeviceOwnerAuthorizationSourceV1(
  raw: unknown,
  label = 'ownerAuthorization',
): LinkedDeviceOwnerAuthorizationSourceV1 {
  if (requireRecord(raw, label).kind !== 'wallet_session') {
    throw new Error(`${label}.kind is unsupported`);
  }
  return walletSessionOwnerAuthorizationV1()(raw, label);
}

function linkedDeviceApprovalFields() {
  return {
    kind: wireLiteral('linked_device_approval_v1'),
    linkSessionId: sessionId,
    walletId,
    enrollmentId,
    deviceId: linkedDeviceId,
    linkPublicKeyB64u: parsePublicKey,
    devicePublicKeyB64u: parsePublicKey,
    permission: parseDelegatedWalletAuthority,
    targetFactor: parseApprovedTargetFactor,
    ownerAuthorization: parseLinkedDeviceOwnerAuthorizationSourceV1,
    approvedAtMs: parseUnixTime,
    expiresAtMs: parseUnixTime,
  };
}

function approvedBeforeExpiry(
  approval: { readonly approvedAtMs: number; readonly expiresAtMs: number },
  label: string,
): void {
  assertExpiryAfterIssued(approval.approvedAtMs, approval.expiresAtMs, label);
}

function linkedDeviceApprovalV1() {
  return wireObject(linkedDeviceApprovalFields(), approvedBeforeExpiry);
}

function linkedDeviceSourceContributionApprovalV1() {
  return wireObject(
    {
      ...linkedDeviceApprovalFields(),
      sourceContribution: parseLinkedDeviceOrdinaryMaterialSourceContributionTupleV1,
    },
    approvedBeforeExpiry,
  );
}

export function parseLinkedDeviceApprovalV1(raw: unknown): LinkedDeviceApprovalV1 {
  const record = requireRecord(raw, 'LinkedDeviceApprovalV1');
  return (
    record.sourceContribution === undefined
      ? linkedDeviceApprovalV1()
      : linkedDeviceSourceContributionApprovalV1()
  )(record, 'LinkedDeviceApprovalV1');
}

function linkedDeviceApprovalDeliveryV1() {
  return wireObject({
    kind: wireLiteral('linked_device_approval_delivery_v1'),
    approval: parseLinkedDeviceApprovalV1,
  });
}

export function parseLinkedDeviceApprovalDeliveryV1(raw: unknown): LinkedDeviceApprovalDeliveryV1 {
  return linkedDeviceApprovalDeliveryV1()(raw, 'LinkedDeviceApprovalDeliveryV1');
}

function linkedDeviceTargetPreparationFields() {
  return {
    kind: wireLiteral('linked_device_target_preparation_v1'),
    linkSessionId: sessionId,
    walletId,
    enrollmentId,
    deviceId: linkedDeviceId,
    deliveryRecipientPublicKey65B64u: parseUncompressedP256PointB64u,
    walletAuthMethodId,
    ed25519ExportRoot: wireNullable(ed25519ExportRootPreparationV1()),
    ordinarySignerMaterialRecipientRequirements: parseRecipientRequirements,
    issuedAtMs: parseUnixTime,
    expiresAtMs: parseUnixTime,
  };
}

function preparationExpiresAfterIssue(
  preparation: { readonly issuedAtMs: number; readonly expiresAtMs: number },
  label: string,
): void {
  if (preparation.expiresAtMs <= preparation.issuedAtMs) {
    throw new Error(`${label}.expiresAtMs must follow issuedAtMs`);
  }
}

function passkeyTargetPreparationV1() {
  return wireObject(
    {
      ...linkedDeviceTargetPreparationFields(),
      targetFactor: passkeyTargetFactorV1(),
      passkeyCreationOptions: parseLinkedDevicePasskeyCreationOptionsV1,
      passkeyConfigurationDigestB64u: digest,
    },
    (preparation, label) => {
      preparationExpiresAfterIssue(preparation, label);
      if (
        preparation.passkeyCreationOptions.walletAuthMethodId !== preparation.walletAuthMethodId
      ) {
        throw new Error(
          `${label}.passkeyCreationOptions.walletAuthMethodId must match the preparation`,
        );
      }
    },
  );
}

function emailOtpTargetPreparationV1() {
  return wireObject(
    {
      ...linkedDeviceTargetPreparationFields(),
      targetFactor: emailOtpTargetFactorV1(),
      targetEmail: parseTargetEmail,
      enrollment: existingEnrollmentV1(),
      baseWalletAuthMethodId: walletAuthMethodId,
    },
    preparationExpiresAfterIssue,
  );
}

function newEmailOtpTargetPreparationV1() {
  return wireObject(
    {
      ...linkedDeviceTargetPreparationFields(),
      targetFactor: emailOtpTargetFactorV1(),
      targetEmail: parseTargetEmail,
      enrollment: newEnrollmentV1(),
    },
    preparationExpiresAfterIssue,
  );
}

export function parseLinkedDeviceTargetPreparationV1(
  raw: unknown,
): LinkedDeviceTargetPreparationV1 {
  const label = 'LinkedDeviceTargetPreparationV1';
  const record = requireRecord(raw, label);
  const targetFactor = parseTargetFactor(record.targetFactor, `${label}.targetFactor`);
  if (targetFactor.kind === 'passkey_prf') return passkeyTargetPreparationV1()(record, label);
  const enrollment = parseEmailOtpEnrollmentSelection(record.enrollment, `${label}.enrollment`);
  return (
    enrollment.kind === 'new_enrollment'
      ? newEmailOtpTargetPreparationV1()
      : emailOtpTargetPreparationV1()
  )(record, label);
}

function linkedDeviceTargetPreparationRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_target_preparation_request_v1'),
    linkSessionId: sessionId,
    deliveryRecipientPublicKey65B64u: parseUncompressedP256PointB64u,
  });
}

export function parseLinkedDeviceTargetPreparationRequestV1(
  raw: unknown,
): LinkedDeviceTargetPreparationRequestV1 {
  return linkedDeviceTargetPreparationRequestV1()(raw, 'LinkedDeviceTargetPreparationRequestV1');
}

// Hand-written: the revision is checked before the kind and the keys, so a missing
// revision reports what the time parser says about it.
export function parseLinkedDeviceEmailOtpBaseFactorRequestV1(
  raw: unknown,
): LinkedDeviceEmailOtpBaseFactorRequestV1 {
  const record = requireRecord(raw, 'LinkedDeviceEmailOtpBaseFactorRequestV1');
  const expectedRevision = parseUnixTime(
    record.expectedRevision,
    'LinkedDeviceEmailOtpBaseFactorRequestV1.expectedRevision',
  );
  if (record.kind === 'resolve') {
    exactRecord(record, ['kind', 'expectedRevision'], 'LinkedDeviceEmailOtpBaseFactorRequestV1');
    return { kind: 'resolve', expectedRevision };
  }
  if (record.kind === 'select') {
    const exact = exactRecord(
      record,
      ['kind', 'expectedRevision', 'baseWalletAuthMethodId'],
      'LinkedDeviceEmailOtpBaseFactorRequestV1',
    );
    return {
      kind: 'select',
      expectedRevision,
      baseWalletAuthMethodId: walletAuthMethodId(
        exact.baseWalletAuthMethodId,
        'LinkedDeviceEmailOtpBaseFactorRequestV1.baseWalletAuthMethodId',
      ),
    };
  }
  throw new Error('LinkedDeviceEmailOtpBaseFactorRequestV1.kind is unsupported');
}

function emailOtpBaseFactorChoiceV1() {
  return wireObject({
    baseWalletAuthMethodId: walletAuthMethodId,
    maskedEmailHint: (raw, label): string => {
      if (typeof raw !== 'string' || raw.length === 0) throw new Error(`${label} is invalid`);
      return raw;
    },
  });
}

// Choices report their errors under their own record name, not their place in the list.
function emailOtpBaseFactorResolutionsV1() {
  const choice = emailOtpBaseFactorChoiceV1();
  const parseChoice = (raw: unknown) => choice(raw, 'LinkedDeviceEmailOtpBaseFactorChoiceV1');
  return {
    selected: wireObject({ kind: wireLiteral('selected'), choice: parseChoice }),
    selection_required: wireObject({
      kind: wireLiteral('selection_required'),
      choices: (raw, label) => {
        if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${label} must not be empty`);
        const choices = raw.map(parseChoice);
        return [choices[0]!, ...choices.slice(1)] as const;
      },
    }),
    unavailable: wireObject({
      kind: wireLiteral('unavailable'),
      reason: supportedLiteral('no_active_email_otp_base_factor'),
    }),
  };
}

function parseLinkedDeviceEmailOtpBaseFactorResolutionV1(
  raw: unknown,
): LinkedDeviceEmailOtpBaseFactorResolutionV1 {
  const label = 'LinkedDeviceEmailOtpBaseFactorResolutionV1';
  const record = requireRecord(raw, label);
  const resolutions = emailOtpBaseFactorResolutionsV1();
  switch (record.kind) {
    case 'selected':
    case 'selection_required':
    case 'unavailable':
      return resolutions[record.kind](record, label);
    default:
      throw new Error(`${label}.kind is unsupported`);
  }
}

function emailOtpBaseFactorResolutionResultV1() {
  return wireObject({
    revision: parseUnixTime,
    resolution: parseLinkedDeviceEmailOtpBaseFactorResolutionV1,
  });
}

export function parseLinkedDeviceEmailOtpBaseFactorResolutionResultV1(
  raw: unknown,
): LinkedDeviceEmailOtpBaseFactorResolutionResultV1 {
  return emailOtpBaseFactorResolutionResultV1()(
    raw,
    'LinkedDeviceEmailOtpBaseFactorResolutionResultV1',
  );
}

// Checks the ceremony's keys; parseWalletAddAuthMethodRegistrationOptions checks its values.
function parseLinkedDevicePasskeyCreationOptionsV1(
  raw: unknown,
  label: string,
): LinkedDevicePasskeyCreationOptionsV1 {
  const record = exactRecord(
    raw,
    [
      'kind',
      'walletAuthMethodId',
      'challengeId',
      'challengeB64u',
      'rpId',
      'user',
      'pubKeyCredParams',
      'authenticatorSelection',
      'timeoutMs',
      'attestation',
      'extensions',
      'excludeCredentials',
    ],
    label,
  );
  const methodId = walletAuthMethodId(record.walletAuthMethodId, `${label}.walletAuthMethodId`);
  exactRecord(record.user, ['idB64u', 'name', 'displayName'], `${label}.user`);
  exactRecord(
    record.authenticatorSelection,
    ['residentKey', 'userVerification'],
    `${label}.authenticatorSelection`,
  );
  const extensions = exactRecord(record.extensions, ['prf'], `${label}.extensions`);
  const prf = exactRecord(extensions.prf, ['eval'], `${label}.extensions.prf`);
  exactRecord(prf.eval, ['firstB64u', 'secondB64u'], `${label}.extensions.prf.eval`);
  if (!Array.isArray(record.pubKeyCredParams)) {
    throw new Error(`${label}.pubKeyCredParams must be an array`);
  }
  record.pubKeyCredParams.forEach((entry, index) => {
    exactRecord(entry, ['type', 'alg'], `${label}.pubKeyCredParams[${index}]`);
  });
  if (!Array.isArray(record.excludeCredentials)) {
    throw new Error(`${label}.excludeCredentials must be an array`);
  }
  record.excludeCredentials.forEach((entry, index) => {
    exactRecord(entry, ['type', 'id'], `${label}.excludeCredentials[${index}]`);
  });
  const options = parseWalletAddAuthMethodRegistrationOptions(record);
  return {
    kind: options.kind,
    walletAuthMethodId: methodId,
    challengeId: options.challengeId,
    challengeB64u: options.challengeB64u,
    rpId: options.rpId,
    user: options.user,
    pubKeyCredParams: options.pubKeyCredParams,
    authenticatorSelection: options.authenticatorSelection,
    timeoutMs: options.timeoutMs,
    attestation: options.attestation,
    extensions: options.extensions,
    excludeCredentials: options.excludeCredentials,
  };
}

function ed25519ExportRootPreparationV1() {
  return wireObject({
    kind: wireLiteral('linked_device_ed25519_export_root_preparation_v1'),
    walletKeyId,
    applicationBindingDigestB64u: digest,
    registeredPublicKeyB64u: parseEd25519PublicKeyB64u,
    revocationEpoch: parseNonNegativeSafeInteger,
  });
}

// One or two entries, one per key family and wallet key, Ed25519 first.
function parseKeyFamilyEntries<
  T extends { readonly keyFamily: string; readonly walletKeyId: WalletKeyId },
>(raw: unknown, item: WireParser<T>, label: string): T[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2) {
    throw new Error(`${label} must contain one or two entries`);
  }
  const entries = raw.map((entry, index) => item(entry, `${label}[${index}]`));
  if (new Set(entries.map((entry) => entry.keyFamily)).size !== entries.length) {
    throw new Error(`${label} repeats a key family`);
  }
  if (new Set(entries.map((entry) => String(entry.walletKeyId))).size !== entries.length) {
    throw new Error(`${label} repeats a wallet key`);
  }
  if (
    entries.length === 2 &&
    (entries[0]?.keyFamily !== 'ed25519' || entries[1]?.keyFamily !== 'ecdsa_secp256k1')
  ) {
    throw new Error(`${label} must be ordered Ed25519 then ECDSA`);
  }
  return entries;
}

function recipientRequirementV1() {
  return wireObject({
    kind: wireLiteral('ordinary_signer_material_recipient_requirement_v1'),
    keyFamily: parseKeyFamily,
    walletKeyId,
  });
}

function parseRecipientRequirements(
  raw: unknown,
): [
  OrdinarySignerMaterialRecipientRequirementV1,
  ...OrdinarySignerMaterialRecipientRequirementV1[],
] {
  const requirements = parseKeyFamilyEntries(
    raw,
    recipientRequirementV1(),
    'LinkedDeviceTargetPreparationV1.ordinarySignerMaterialRecipientRequirements',
  );
  const first = requirements[0];
  if (!first) throw new Error('ordinary signer material recipient requirements are empty');
  return [first, ...requirements.slice(1)];
}

const webAuthnTransport = /* @__PURE__ */ wireLiteral(
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
);

function parseWebAuthnTransports(
  raw: unknown,
  label: string,
): LinkedDeviceWebAuthnRegistrationV1['transports'][number][] {
  const transports = requireArray(raw, label).map((entry, index) =>
    webAuthnTransport(entry, `${label}[${index}]`),
  );
  if (new Set(transports).size !== transports.length) {
    throw new Error(`${label} contains duplicates`);
  }
  return transports;
}

function linkedDeviceWebAuthnRegistrationV1() {
  return wireObject({
    kind: wireLiteral('linked_device_webauthn_registration_v1'),
    credentialIdB64u: parseCredential,
    authenticatorAttachment: wireNullable(wireLiteral('platform', 'cross-platform')),
    clientDataJsonB64u: parseCanonicalBase64UrlBytes,
    attestationObjectB64u: parseCanonicalBase64UrlBytes,
    transports: parseWebAuthnTransports,
  });
}

function recipientRequestV1() {
  const keyFamily =
    <F extends 'ed25519' | 'ecdsa_secp256k1'>(family: F): WireParser<F> =>
    (raw, label) => {
      if (raw !== family) throw new Error(`${label} does not match its kind`);
      return family;
    };
  return wireUnion('kind', [
    wireObject({
      kind: wireLiteral('ordinary_ed25519_signer_material_recipient_request_v1'),
      keyFamily: keyFamily('ed25519'),
      walletKeyId,
      recipientPublicKeyB64u: (raw, label) => parseCanonicalFixedBase64UrlBytes(raw, 32, label),
    }),
    wireObject({
      kind: wireLiteral('ordinary_ecdsa_signer_material_recipient_request_v1'),
      keyFamily: keyFamily('ecdsa_secp256k1'),
      walletKeyId,
      clientEphemeralPublicKey: requireRouterAbX25519PublicKey,
    }),
  ]);
}

// Registration results report these under the registration's name too.
function parseRecipientRequests(
  raw: unknown,
): [OrdinarySignerMaterialRecipientRequestV1, ...OrdinarySignerMaterialRecipientRequestV1[]] {
  const requests = parseKeyFamilyEntries<OrdinarySignerMaterialRecipientRequestV1>(
    raw,
    recipientRequestV1(),
    'LinkedDeviceTargetCredentialRegistrationV1.ordinarySignerMaterialRecipientRequests',
  );
  const first = requests[0];
  if (!first) throw new Error('ordinary signer material recipient requests are empty');
  return [first, ...requests.slice(1)];
}

function targetCredentialRegistrationIdentity() {
  return {
    kind: wireLiteral('linked_device_target_credential_registration_v1'),
    linkSessionId: sessionId,
    walletId,
    enrollmentId,
    deviceId: linkedDeviceId,
    walletAuthMethodId,
  };
}

function passkeyTargetCredentialRegistrationV1() {
  return wireObject({
    ...targetCredentialRegistrationIdentity(),
    targetFactor: passkeyTargetFactorV1(),
    targetPreparationDigestB64u: digest,
    ordinarySignerMaterialRecipientRequests: parseRecipientRequests,
    webauthnRegistration: linkedDeviceWebAuthnRegistrationV1(),
    registeredAtMs: parseUnixTime,
  });
}

function emailOtpTargetCredentialRegistrationV1() {
  return wireObject({
    ...targetCredentialRegistrationIdentity(),
    targetFactor: emailOtpTargetFactorV1(),
    targetEmail: parseTargetEmail,
    targetPreparationDigestB64u: digest,
    ordinarySignerMaterialRecipientRequests: parseRecipientRequests,
    emailOtpVerificationGrant: parseLinkedDeviceEmailOtpVerificationGrantV1,
    registeredAtMs: parseUnixTime,
  });
}

function newEmailOtpTargetCredentialRegistrationV1() {
  return wireObject({
    ...targetCredentialRegistrationIdentity(),
    targetFactor: emailOtpTargetFactorV1(),
    targetEmail: parseTargetEmail,
    targetPreparationDigestB64u: digest,
    ordinarySignerMaterialRecipientRequests: parseRecipientRequests,
    emailOtpVerificationGrant: parseLinkedDeviceEmailOtpVerificationGrantV1,
    emailOtpEnrollment: emailOtpEnrollmentMaterialV1(),
    registeredAtMs: parseUnixTime,
  });
}

// An Email OTP registration's fields depend on its grant's enrollment, so the grant is
// read first.
export function parseLinkedDeviceTargetCredentialRegistrationV1(
  raw: unknown,
): LinkedDeviceTargetCredentialRegistrationV1 {
  const label = 'LinkedDeviceTargetCredentialRegistrationV1';
  const record = requireRecord(raw, label);
  const targetFactor = parseTargetFactor(record.targetFactor, `${label}.targetFactor`);
  if (targetFactor.kind === 'passkey_prf') {
    return passkeyTargetCredentialRegistrationV1()(record, label);
  }
  const grant = parseLinkedDeviceEmailOtpVerificationGrantV1(record.emailOtpVerificationGrant);
  return (
    grant.enrollment.kind === 'new_enrollment'
      ? newEmailOtpTargetCredentialRegistrationV1()
      : emailOtpTargetCredentialRegistrationV1()
  )(record, label);
}

function targetCredentialRegistrationResultV1() {
  return wireObject(
    {
      kind: wireLiteral('linked_device_target_credential_registration_result_v1'),
      outcome: wireLiteral('applied', 'replayed'),
      linkSessionId: sessionId,
      walletId,
      enrollmentId,
      deviceId: linkedDeviceId,
      walletAuthMethodId,
      targetPreparationDigestB64u: digest,
      targetFactor: parseVerifiedTargetFactorV1,
      ordinarySignerMaterialPreparations:
        parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1,
      ordinarySignerMaterialRecipientRequests: parseRecipientRequests,
      keyManifestDigestB64u: digest,
    },
    (result, label) => {
      const { authMethod } = result.targetFactor;
      if (
        authMethod.walletAuthMethodId !== result.walletAuthMethodId ||
        authMethod.walletId !== result.walletId
      ) {
        throw new Error(`${label} target identity differs`);
      }
    },
  );
}

export function parseLinkedDeviceTargetCredentialRegistrationResultV1(
  raw: unknown,
): LinkedDeviceTargetCredentialRegistrationResultV1 {
  return targetCredentialRegistrationResultV1()(
    raw,
    'LinkedDeviceTargetCredentialRegistrationResultV1',
  );
}

function verifiedAfterCreation(
  target: { readonly authMethod: { readonly createdAtMs: number }; readonly verifiedAtMs: number },
  label: string,
): void {
  if (target.verifiedAtMs < target.authMethod.createdAtMs) {
    throw new Error(`${label}.verifiedAtMs precedes authMethod.createdAtMs`);
  }
}

function verifiedPasskeyTargetV1() {
  return wireObject(
    {
      kind: wireLiteral('verified_passkey_target_v1'),
      authMethod: parsePasskeyWalletAuthMethodDraftV1,
      verificationDigestB64u: digest,
      verifiedAtMs: parseUnixTime,
    },
    verifiedAfterCreation,
  );
}

function verifiedEmailOtpTargetV1() {
  return wireObject(
    {
      kind: wireLiteral('verified_email_otp_target_v1'),
      authMethod: parseEmailOtpWalletAuthMethodDraftV1,
      targetEmail: parseTargetEmail,
      enrollment: existingEnrollmentV1(),
      baseWalletAuthMethodId: walletAuthMethodId,
      providerUserId: parseNonEmptyToken,
      verificationDigestB64u: digest,
      verifiedAtMs: parseUnixTime,
    },
    verifiedAfterCreation,
  );
}

function verifiedNewEmailOtpTargetV1() {
  return wireObject(
    {
      kind: wireLiteral('verified_email_otp_target_v1'),
      authMethod: parseEmailOtpWalletAuthMethodDraftV1,
      targetEmail: parseTargetEmail,
      enrollment: newEnrollmentV1(),
      providerUserId: parseNonEmptyToken,
      verificationDigestB64u: digest,
      verifiedAtMs: parseUnixTime,
    },
    verifiedAfterCreation,
  );
}

function parseVerifiedTargetFactorV1(raw: unknown, label: string): VerifiedTargetFactorV1 {
  const record = requireRecord(raw, label);
  if (record.kind === 'verified_passkey_target_v1') return verifiedPasskeyTargetV1()(record, label);
  if (record.kind !== 'verified_email_otp_target_v1') throw new Error(`${label}.kind is invalid`);
  const enrollment = parseEmailOtpEnrollmentSelection(record.enrollment, `${label}.enrollment`);
  return (
    enrollment.kind === 'existing_enrollment'
      ? verifiedEmailOtpTargetV1()
      : verifiedNewEmailOtpTargetV1()
  )(record, label);
}

function passkeyWalletAuthMethodDraftV1() {
  return wireObject({
    walletAuthMethodId,
    walletId,
    createdAtMs: parseUnixTime,
    kind: wireLiteral('passkey'),
    rpId,
    credentialIdB64u: credentialId,
    credentialPublicKeyB64u: parseCanonicalBase64UrlBytes,
    counter: parseNonNegativeSafeInteger,
  });
}

function parsePasskeyWalletAuthMethodDraftV1(
  raw: unknown,
  label: string,
): PasskeyWalletAuthMethodDraftV1 {
  return passkeyWalletAuthMethodDraftV1()(raw, label);
}

function emailOtpWalletAuthMethodDraftV1() {
  return wireObject({
    walletAuthMethodId,
    walletId,
    createdAtMs: parseUnixTime,
    kind: wireLiteral('email_otp'),
    emailHashHex: parseEmailHashHex,
    registrationAuthorityId: parseNonEmptyToken,
  });
}

function parseEmailOtpWalletAuthMethodDraftV1(
  raw: unknown,
  label: string,
): EmailOtpWalletAuthMethodDraftV1 {
  return emailOtpWalletAuthMethodDraftV1()(raw, label);
}

function emailOtpVerificationGrantFields<E>(enrollment: WireParser<E>) {
  return {
    kind: wireLiteral('linked_device_email_otp_verification_grant_v1'),
    grantId: parseNonEmptyToken,
    grantToken: parseNonEmptyToken,
    challengeId: parseNonEmptyToken,
    linkSessionId: sessionId,
    walletId,
    enrollmentId,
    deviceId: linkedDeviceId,
    targetPreparationDigestB64u: digest,
    targetEmail: parseTargetEmail,
    enrollment,
    emailHashHex: parseEmailHashHex,
    registrationAuthorityId: parseNonEmptyToken,
    providerUserId: parseNonEmptyToken,
    authorityDigestB64u: digest,
    issuedAtMs: parseUnixTime,
    expiresAtMs: parseUnixTime,
  };
}

function grantIssuedBeforeExpiry(
  grant: { readonly issuedAtMs: number; readonly expiresAtMs: number },
  label: string,
): void {
  assertExpiryAfterIssued(grant.issuedAtMs, grant.expiresAtMs, label);
}

function emailOtpVerificationGrantV1() {
  return wireObject(
    {
      ...emailOtpVerificationGrantFields(existingEnrollmentV1()),
      baseWalletAuthMethodId: walletAuthMethodId,
    },
    grantIssuedBeforeExpiry,
  );
}

function newEnrollmentEmailOtpVerificationGrantV1() {
  return wireObject(emailOtpVerificationGrantFields(newEnrollmentV1()), grantIssuedBeforeExpiry);
}

export function parseLinkedDeviceEmailOtpVerificationGrantV1(
  raw: unknown,
): LinkedDeviceEmailOtpVerificationGrantV1 {
  const label = 'LinkedDeviceEmailOtpVerificationGrantV1';
  const record = requireRecord(raw, label);
  const enrollment = parseEmailOtpEnrollmentSelection(record.enrollment, `${label}.enrollment`);
  return (
    enrollment.kind === 'new_enrollment'
      ? newEnrollmentEmailOtpVerificationGrantV1()
      : emailOtpVerificationGrantV1()
  )(record, label);
}

function emailOtpFactorReleaseEnvelopeV1() {
  return wireObject({
    kind: wireLiteral('email_otp_factor_release_v1'),
    challengeId: parseNonEmptyToken,
    enrollmentId: parseNonEmptyToken,
    enrollmentSealKeyVersion: parseNonEmptyToken,
    serverEphemeralPublicKey65B64u: parseUncompressedP256PointB64u,
    nonce12B64u: (raw, label) => parseCanonicalFixedBase64UrlBytes(raw, 12, label),
    ciphertextB64u: parseCanonicalBase64UrlBytes,
  });
}

export function parseLinkedDeviceEmailOtpFactorReleaseEnvelopeV1(
  raw: unknown,
): LinkedDeviceEmailOtpFactorReleaseEnvelopeV1 {
  return emailOtpFactorReleaseEnvelopeV1()(raw, 'LinkedDeviceEmailOtpFactorReleaseEnvelopeV1');
}

function emailOtpChallengeStartRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_email_otp_challenge_start_request_v1'),
    linkSessionId: sessionId,
    workerEphemeralPublicKey65B64u: parseUncompressedP256PointB64u,
  });
}

export function parseLinkedDeviceEmailOtpChallengeStartRequestV1(
  raw: unknown,
): LinkedDeviceEmailOtpChallengeStartRequestV1 {
  return emailOtpChallengeStartRequestV1()(raw, 'LinkedDeviceEmailOtpChallengeStartRequestV1');
}

function emailOtpChallengeResendRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_email_otp_challenge_resend_request_v1'),
    linkSessionId: sessionId,
    challengeId: parseNonEmptyToken,
  });
}

export function parseLinkedDeviceEmailOtpChallengeResendRequestV1(
  raw: unknown,
): LinkedDeviceEmailOtpChallengeResendRequestV1 {
  return emailOtpChallengeResendRequestV1()(raw, 'LinkedDeviceEmailOtpChallengeResendRequestV1');
}

function emailOtpChallengeVerifyRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_email_otp_challenge_verify_request_v1'),
    linkSessionId: sessionId,
    challengeId: parseNonEmptyToken,
    otpCode: (raw, label): string => {
      if (typeof raw !== 'string' || !/^[0-9]{6,10}$/.test(raw)) {
        throw new Error(`${label} is invalid`);
      }
      return raw;
    },
  });
}

export function parseLinkedDeviceEmailOtpChallengeVerifyRequestV1(
  raw: unknown,
): LinkedDeviceEmailOtpChallengeVerifyRequestV1 {
  return emailOtpChallengeVerifyRequestV1()(raw, 'LinkedDeviceEmailOtpChallengeVerifyRequestV1');
}

function emailOtpChallengeResultV1() {
  return wireObject({
    kind: wireLiteral('linked_device_email_otp_challenge_result_v1'),
    challengeId: parseNonEmptyToken,
    maskedEmailHint: parseNonEmptyToken,
    expiresAtMs: parseUnixTime,
    resendAvailableAtMs: parseUnixTime,
  });
}

export function parseLinkedDeviceEmailOtpChallengeResultV1(
  raw: unknown,
): LinkedDeviceEmailOtpChallengeResultV1 {
  return emailOtpChallengeResultV1()(raw, 'LinkedDeviceEmailOtpChallengeResultV1');
}

// Hand-written: whether the factor release may be null depends on the grant's enrollment.
export function parseLinkedDeviceEmailOtpVerificationResultV1(
  raw: unknown,
): LinkedDeviceEmailOtpVerificationResultV1 {
  const record = exactRecord(
    raw,
    ['kind', 'verificationGrant', 'factorRelease'],
    'LinkedDeviceEmailOtpVerificationResultV1',
  );
  if (record.kind !== 'linked_device_email_otp_verification_result_v1') {
    throw new Error('LinkedDeviceEmailOtpVerificationResultV1.kind is invalid');
  }
  const verificationGrant = parseLinkedDeviceEmailOtpVerificationGrantV1(record.verificationGrant);
  if (isNewEnrollmentEmailOtpVerificationGrantV1(verificationGrant)) {
    if (record.factorRelease !== null) {
      throw new Error('new linked-device Email OTP enrollment cannot carry a factor release');
    }
    return {
      kind: 'linked_device_email_otp_verification_result_v1',
      verificationGrant,
      factorRelease: null,
    };
  }
  const factorRelease = parseLinkedDeviceEmailOtpFactorReleaseEnvelopeV1(record.factorRelease);
  if (factorRelease.challengeId !== verificationGrant.challengeId) {
    throw new Error('LinkedDeviceEmailOtpVerificationResultV1 challenge binding changed');
  }
  return {
    kind: 'linked_device_email_otp_verification_result_v1',
    verificationGrant,
    factorRelease,
  };
}

function isNewEnrollmentEmailOtpVerificationGrantV1(
  grant: LinkedDeviceEmailOtpVerificationGrantV1,
): grant is Extract<
  LinkedDeviceEmailOtpVerificationGrantV1,
  { readonly enrollment: { readonly kind: 'new_enrollment' } }
> {
  return grant.enrollment.kind === 'new_enrollment';
}

function cancelUnclaimedRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_session_cancel_unclaimed_request_v1'),
    linkSessionId: sessionId,
    reason: (raw): 'user_cancelled' => {
      if (raw !== 'user_cancelled') {
        throw new Error('LinkedDeviceSessionCancelUnclaimedRequestV1 is invalid');
      }
      return raw;
    },
    requestedAtMs: parseUnixTime,
  });
}

function cancelClaimedRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_session_cancel_claimed_request_v1'),
    linkSessionId: sessionId,
    enrollmentId,
    deviceId: linkedDeviceId,
    reason: supportedLiteral('user_cancelled', 'expired', 'revoked'),
    requestedAtMs: parseUnixTime,
  });
}

function retryCommittedDeliveryRequestV1() {
  return wireObject({
    kind: wireLiteral('linked_device_session_retry_committed_delivery_request_v1'),
    linkSessionId: sessionId,
    enrollmentId,
    deviceId: linkedDeviceId,
    requestedAtMs: parseUnixTime,
  });
}

export function parseLinkedDeviceSessionTransportRequestV1(
  raw: unknown,
): LinkedDeviceSessionTransportRequestV1 {
  const record = requireRecord(raw, 'LinkedDeviceSessionTransportRequestV1');
  switch (record.kind) {
    case 'linked_device_session_claim_request_v1':
      return parseLinkedDeviceSessionClaimRequestV1(record);
    case 'linked_device_approval_v1':
      return parseLinkedDeviceApprovalV1(record);
    case 'linked_device_target_credential_registration_v1':
      return parseLinkedDeviceTargetCredentialRegistrationV1(record);
    case 'linked_device_session_cancel_unclaimed_request_v1':
      return cancelUnclaimedRequestV1()(record, 'LinkedDeviceSessionCancelUnclaimedRequestV1');
    case 'linked_device_session_cancel_claimed_request_v1':
      return cancelClaimedRequestV1()(record, 'LinkedDeviceSessionCancelClaimedRequestV1');
    case 'linked_device_session_retry_committed_delivery_request_v1':
      return retryCommittedDeliveryRequestV1()(
        record,
        'LinkedDeviceSessionRetryCommittedDeliveryRequestV1',
      );
    default:
      throw new Error('LinkedDeviceSessionTransportRequestV1.kind is unsupported');
  }
}

type BuildQrLinkedDeviceSessionPayloadV5Args = {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly linkPublicKeyB64u: LinkDevicePublicKeyB64u;
  readonly devicePublicKeyB64u: LinkDevicePublicKeyB64u;
  readonly requestedPermission: DelegatedWalletAuthorityV1;
} & (
  | {
      readonly targetFactor: { readonly kind: 'passkey_prf' };
      readonly targetEmail?: never;
    }
  | {
      readonly targetFactor: { readonly kind: 'email_otp' };
      readonly targetEmail: VerifiedEmailAddress;
    }
) & {
    readonly issuedAtMs: number;
    readonly expiresAtMs: number;
  };

export function buildQrLinkedDeviceSessionPayloadV5(
  args: BuildQrLinkedDeviceSessionPayloadV5Args,
): QrLinkedDeviceSessionPayloadV5 {
  const issuedAtMs = parseUnixTime(args.issuedAtMs, 'QrLinkedDeviceSessionPayloadV5.issuedAtMs');
  const expiresAtMs = parseUnixTime(args.expiresAtMs, 'QrLinkedDeviceSessionPayloadV5.expiresAtMs');
  assertExpiryAfterIssued(issuedAtMs, expiresAtMs, 'QrLinkedDeviceSessionPayloadV5');
  const targetFactor = parseTargetFactor(
    args.targetFactor,
    'QrLinkedDeviceSessionPayloadV5.targetFactor',
  );
  if (targetFactor.kind === 'passkey_prf') {
    return {
      version: 'v5',
      purpose: 'linked_device_lane_creation',
      linkSessionId: args.linkSessionId,
      linkPublicKeyB64u: args.linkPublicKeyB64u,
      devicePublicKeyB64u: args.devicePublicKeyB64u,
      requestedPermission: parseDelegatedWalletAuthority(
        delegatedWalletAuthorityWireValue(args.requestedPermission),
        'QrLinkedDeviceSessionPayloadV5.requestedPermission',
      ),
      targetFactor,
      issuedAtMs,
      expiresAtMs,
    };
  }
  if (args.targetEmail === undefined) {
    throw new Error('QrLinkedDeviceSessionPayloadV5.targetEmail is required for Email OTP');
  }
  return {
    version: 'v5',
    purpose: 'linked_device_lane_creation',
    linkSessionId: args.linkSessionId,
    linkPublicKeyB64u: args.linkPublicKeyB64u,
    devicePublicKeyB64u: args.devicePublicKeyB64u,
    requestedPermission: parseDelegatedWalletAuthority(
      delegatedWalletAuthorityWireValue(args.requestedPermission),
      'QrLinkedDeviceSessionPayloadV5.requestedPermission',
    ),
    targetFactor,
    targetEmail: parseTargetEmail(args.targetEmail, 'QrLinkedDeviceSessionPayloadV5.targetEmail'),
    issuedAtMs,
    expiresAtMs,
  };
}

export function buildLinkedDeviceSessionClaimRequestV1(
  payload: QrLinkedDeviceSessionPayloadV5,
): LinkedDeviceSessionClaimRequestV1 {
  return { kind: 'linked_device_session_claim_request_v1', payload };
}

export function buildWalletSessionLinkedDeviceOwnerAuthorizationV1(args: {
  readonly walletSessionId: WalletSessionId;
  readonly authorizationId: WalletSessionAuthorizationId;
}): LinkedDeviceOwnerAuthorizationSourceV1 {
  return {
    kind: 'wallet_session',
    walletSessionId: args.walletSessionId,
    authorizationId: args.authorizationId,
  };
}

function validateEnrollmentTimes(
  approvedAtMs: number,
  expiresAtMs: number,
  label: string,
): {
  readonly approvedAtMs: number;
  readonly expiresAtMs: number;
} {
  const approved = parseUnixTime(approvedAtMs, `${label}.approvedAtMs`);
  const expires = parseUnixTime(expiresAtMs, `${label}.expiresAtMs`);
  assertExpiryAfterIssued(approved, expires, label);
  return { approvedAtMs: approved, expiresAtMs: expires };
}

export function buildLinkedDeviceApprovalV1(
  args: Omit<LinkedDeviceApprovalV1, 'kind'>,
): LinkedDeviceApprovalV1 {
  const times = validateEnrollmentTimes(
    args.approvedAtMs,
    args.expiresAtMs,
    'LinkedDeviceApprovalV1',
  );
  return parseLinkedDeviceApprovalV1({ kind: 'linked_device_approval_v1', ...args, ...times });
}

type LinkedDeviceTargetPreparationBuildInputV1 =
  | Omit<
      Extract<
        LinkedDeviceTargetPreparationV1,
        { readonly targetFactor: { readonly kind: 'passkey_prf' } }
      >,
      'kind'
    >
  | Omit<
      Extract<
        LinkedDeviceTargetPreparationV1,
        { readonly targetFactor: { readonly kind: 'email_otp' } }
      >,
      'kind'
    >;

export function buildLinkedDeviceTargetPreparationV1(
  args: LinkedDeviceTargetPreparationBuildInputV1,
): LinkedDeviceTargetPreparationV1 {
  return parseLinkedDeviceTargetPreparationV1({
    kind: 'linked_device_target_preparation_v1',
    ...args,
  });
}

export function buildLinkedDeviceTargetCredentialRegistrationV1(
  args: Omit<LinkedDeviceTargetCredentialRegistrationV1, 'kind'>,
): LinkedDeviceTargetCredentialRegistrationV1 {
  return parseLinkedDeviceTargetCredentialRegistrationV1({
    kind: 'linked_device_target_credential_registration_v1',
    ...args,
  });
}

export function buildLinkedDeviceSessionCancelUnclaimedRequestV1(args: {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly requestedAtMs: number;
}): Extract<
  LinkedDeviceSessionTransportRequestV1,
  { readonly kind: 'linked_device_session_cancel_unclaimed_request_v1' }
> {
  return {
    kind: 'linked_device_session_cancel_unclaimed_request_v1',
    linkSessionId: args.linkSessionId,
    reason: 'user_cancelled',
    requestedAtMs: parseUnixTime(
      args.requestedAtMs,
      'LinkedDeviceSessionCancelUnclaimedRequestV1.requestedAtMs',
    ),
  };
}

export function buildLinkedDeviceSessionCancelClaimedRequestV1(args: {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly enrollmentId: LinkedDeviceEnrollmentId;
  readonly deviceId: LinkedDeviceId;
  readonly reason: 'user_cancelled' | 'expired' | 'revoked';
  readonly requestedAtMs: number;
}): Extract<
  LinkedDeviceSessionTransportRequestV1,
  { readonly kind: 'linked_device_session_cancel_claimed_request_v1' }
> {
  return {
    kind: 'linked_device_session_cancel_claimed_request_v1',
    ...args,
    requestedAtMs: parseUnixTime(
      args.requestedAtMs,
      'LinkedDeviceSessionCancelClaimedRequestV1.requestedAtMs',
    ),
  };
}

// The message interpolates the activation set's error object, not its message.
function parseInstalledActivationRefs(raw: unknown, label: string) {
  const result = parseWalletSignerActivationSetV1(raw);
  if (!result.ok) throw new Error(`${label} ${result.error}`);
  return result.value;
}

function localAuthorityInstallationReceiptV1() {
  return wireObject({
    kind: wireLiteral('local_authority_installation_receipt_v1'),
    authorityId: keyLabeled(walletAuthorityId),
    walletId: keyLabeled(walletId),
    authMethodId: keyLabeled(walletAuthMethodId),
    deviceId: keyLabeled(authorizationDeviceId),
    packageSetDigestB64u: keyLabeled(digest),
    installedActivationRefs: parseInstalledActivationRefs,
    installedRecordSetDigestB64u: keyLabeled(digest),
    targetFactorVerificationDigestB64u: keyLabeled(digest),
    installedAtMs: keyLabeled(parseUnixTime),
  });
}

export function parseLocalAuthorityInstallationReceiptV1(
  raw: unknown,
): LocalAuthorityInstallationReceiptV1 {
  return localAuthorityInstallationReceiptV1()(raw, 'LocalAuthorityInstallationReceiptV1');
}

function walletSessionOperationCredentialV1() {
  return wireObject(
    {
      kind: wireLiteral('opaque_wallet_session_operation_credential_v1'),
      token: (raw, label): string => {
        if (typeof raw !== 'string' || raw.length > 8192) throw new Error(`${label} is invalid`);
        return raw;
      },
      walletSessionId: keyLabeled(walletSessionId),
    },
    (credential, label) => {
      if (!/^wst_[A-Za-z0-9_-]{43}$/.test(credential.token)) {
        throw new Error(`${label} opaque token is invalid`);
      }
    },
  );
}

export function parseWalletSessionOperationCredentialV1(
  raw: unknown,
): WalletSessionOperationCredentialV1 {
  return walletSessionOperationCredentialV1()(raw, 'WalletSessionOperationCredentialV1');
}

function capabilitySubjectKey(subject: WalletCapabilitySubjectV1): string {
  return subject.kind === 'sign' || subject.kind === 'export_keys'
    ? `${subject.kind}:${subject.keyFamily}:${subject.materialActivation.activationId}`
    : subject.kind;
}

function activeWalletSessionV1() {
  return wireObject(
    {
      kind: wireLiteral('active_wallet_session_v1'),
      walletId: keyLabeled(walletId),
      authorityId: keyLabeled(walletAuthorityId),
      authMethodId: keyLabeled(walletAuthMethodId),
      authorizationId: keyLabeled(walletSessionAuthorizationId),
      quotaId: keyLabeled(quotaId),
      authorityDigestB64u: keyLabeled(digest),
      authorityRevocationEpoch: keyLabeled(parseNonNegativeSafeInteger),
      capabilitySubjects: (
        raw,
        label,
      ): [WalletCapabilitySubjectV1, ...WalletCapabilitySubjectV1[]] => {
        if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${label} must be non-empty`);
        const subjects: WalletCapabilitySubjectV1[] = [];
        for (const [index, subject] of raw.entries()) {
          subjects.push(parseWalletCapabilitySubjectV1(subject, `capabilitySubjects[${index}]`));
        }
        const first = subjects[0];
        if (!first) throw new Error(`${label} must be non-empty`);
        return [first, ...subjects.slice(1)];
      },
      issuedAtMs: keyLabeled(parseUnixTime),
      expiresAtMs: keyLabeled(parseUnixTime),
    },
    (session, label) => {
      const keys = session.capabilitySubjects.map(capabilitySubjectKey);
      if (new Set(keys).size !== keys.length) {
        throw new Error(`${label} capability subjects repeat`);
      }
    },
  );
}

export function parseActiveWalletSessionV1(raw: unknown): ActiveWalletSessionV1 {
  return activeWalletSessionV1()(raw, 'ActiveWalletSessionV1');
}

// Hand-written: a missing field reaches its parser rather than failing as missing.
function parseWalletCapabilitySubjectV1(raw: unknown, label: string): WalletCapabilitySubjectV1 {
  const record = requireRecord(raw, label);
  if (record.kind === 'link_devices' || record.kind === 'revoke_devices') {
    rejectUnknownFields(record, ['kind'], label);
    return { kind: record.kind };
  }
  if (record.kind !== 'sign' && record.kind !== 'export_keys') {
    throw new Error(`${label}.kind is invalid`);
  }
  rejectUnknownFields(record, ['kind', 'keyFamily', 'materialActivation'], label);
  if (record.keyFamily !== 'ed25519' && record.keyFamily !== 'ecdsa_secp256k1') {
    throw new Error(`${label}.keyFamily is invalid`);
  }
  return {
    kind: record.kind,
    keyFamily: record.keyFamily,
    materialActivation: materialActivation(
      record.materialActivation,
      `${label}.materialActivation`,
    ),
  };
}

function localAuthorityActivationFinalAckV1() {
  return wireObject({
    kind: wireLiteral('local_authority_activation_final_ack_v1'),
    linkSessionId: keyLabeled(sessionId),
    authorityId: keyLabeled(walletAuthorityId),
    packageSetDigestB64u: keyLabeled(digest),
    authorizationId: keyLabeled(walletSessionAuthorizationId),
    walletSessionId: keyLabeled(walletSessionId),
    credentialDigestB64u: keyLabeled(digest),
    installationReceiptDigestB64u: keyLabeled(digest),
    acknowledgedAtMs: keyLabeled(parseUnixTime),
  });
}

export function parseLocalAuthorityActivationFinalAckV1(
  raw: unknown,
): LocalAuthorityActivationFinalAckV1 {
  return localAuthorityActivationFinalAckV1()(raw, 'LocalAuthorityActivationFinalAckV1');
}

// Hand-written: a missing field reaches its parser rather than failing as missing.
export function parseActivateInstalledAuthorityResultV1(
  raw: unknown,
): ActivateInstalledAuthorityResultV1 {
  const record = requireRecord(raw, 'ActivateInstalledAuthorityResultV1');
  switch (record.kind) {
    case 'active': {
      rejectUnknownFields(
        record,
        ['kind', 'authority', 'authMethod', 'walletSession', 'deliveryBinding', 'sealedDelivery'],
        'ActivateInstalledAuthorityResultV1',
      );
      const authorityResult = parseWalletAuthorityV1(record.authority);
      if (!authorityResult.ok || authorityResult.value.state !== 'active') {
        throw new Error('ActivateInstalledAuthorityResultV1.authority must be active');
      }
      const authMethod = parseWalletAuthMethodRecordV2(record.authMethod);
      if (!authMethod || authMethod.status !== 'active') {
        throw new Error('ActivateInstalledAuthorityResultV1.authMethod must be active');
      }
      const walletSession = parseActiveWalletSessionV1(record.walletSession);
      const deliveryBinding =
        parseLinkedDeviceWalletSessionCredentialDeliveryBindingV1(record.deliveryBinding);
      const sealedDelivery = parseLinkedDeviceWalletSessionCredentialDeliveryV1(
        record.sealedDelivery,
      );
      if (
        authorityResult.value.walletId !== authMethod.walletId ||
        authorityResult.value.authorityId !== authMethod.walletAuthorityId ||
        walletSession.walletId !== authorityResult.value.walletId ||
        walletSession.authorityId !== authorityResult.value.authorityId ||
        walletSession.authMethodId !== authMethod.walletAuthMethodId ||
        walletSession.authorityDigestB64u !== authorityResult.value.authorityDigestB64u ||
        walletSession.authorityRevocationEpoch !== authorityResult.value.revocationEpoch ||
        deliveryBinding.namespace !== sealedDelivery.aad.namespace ||
        deliveryBinding.orgId !== sealedDelivery.aad.orgId ||
        deliveryBinding.projectId !== sealedDelivery.aad.projectId ||
        deliveryBinding.envId !== sealedDelivery.aad.envId ||
        deliveryBinding.tenantId !== sealedDelivery.aad.tenantId ||
        deliveryBinding.principalId !== sealedDelivery.aad.principalId ||
        sealedDelivery.aad.walletId !== walletSession.walletId ||
        sealedDelivery.aad.authorityId !== walletSession.authorityId ||
        sealedDelivery.aad.walletAuthMethodId !== walletSession.authMethodId ||
        sealedDelivery.aad.authorizationId !== walletSession.authorizationId ||
        sealedDelivery.aad.quotaId !== walletSession.quotaId ||
        sealedDelivery.aad.issuedAtMs !== walletSession.issuedAtMs ||
        sealedDelivery.aad.expiresAtMs !== walletSession.expiresAtMs
      ) {
        throw new Error('ActivateInstalledAuthorityResultV1 identities do not match');
      }
      return {
        kind: 'active',
        authority: authorityResult.value,
        authMethod,
        walletSession,
        deliveryBinding,
        sealedDelivery,
      };
    }
    case 'pending_local_install':
      rejectUnknownFields(
        record,
        ['kind', 'authorityId', 'reason'],
        'ActivateInstalledAuthorityResultV1',
      );
      return {
        kind: 'pending_local_install',
        authorityId: walletAuthorityId(record.authorityId, 'authorityId'),
        reason: activationRetryReasonV1()(record.reason, 'ActivationRetryReasonV1'),
      };
    case 'integrity_error':
      rejectUnknownFields(record, ['kind', 'reason'], 'ActivateInstalledAuthorityResultV1');
      return {
        kind: 'integrity_error',
        reason: parseLinkIntegrityFailureV1(record.reason),
      };
    default:
      throw new Error('ActivateInstalledAuthorityResultV1.kind is invalid');
  }
}

function activationRetryReasonV1() {
  return wireUnion('kind', [
    wireObject({ kind: wireLiteral('installation_receipt_not_found') }),
    wireObject({ kind: wireLiteral('server_worker_activation_pending') }),
    wireObject({ kind: wireLiteral('wallet_session_issuance_pending') }),
  ]);
}

// Hand-written: a missing field reaches its parser rather than failing as missing.
function parseLinkIntegrityFailureV1(raw: unknown): LinkIntegrityFailureV1 {
  const record = requireRecord(raw, 'LinkIntegrityFailureV1');
  switch (record.kind) {
    case 'authority_id_mismatch':
      rejectUnknownFields(
        record,
        ['kind', 'expectedAuthorityId', 'actualAuthorityId'],
        'LinkIntegrityFailureV1',
      );
      return {
        kind: 'authority_id_mismatch',
        expectedAuthorityId: walletAuthorityId(record.expectedAuthorityId, 'expectedAuthorityId'),
        actualAuthorityId: walletAuthorityId(record.actualAuthorityId, 'actualAuthorityId'),
      };
    case 'package_set_digest_mismatch':
      rejectUnknownFields(
        record,
        ['kind', 'expectedPackageSetDigestB64u', 'actualPackageSetDigestB64u'],
        'LinkIntegrityFailureV1',
      );
      return {
        kind: 'package_set_digest_mismatch',
        expectedPackageSetDigestB64u: digest(
          record.expectedPackageSetDigestB64u,
          'expectedPackageSetDigestB64u',
        ),
        actualPackageSetDigestB64u: digest(
          record.actualPackageSetDigestB64u,
          'actualPackageSetDigestB64u',
        ),
      };
    case 'installation_receipt_mismatch':
      rejectUnknownFields(record, ['kind', 'field'], 'LinkIntegrityFailureV1');
      if (
        record.field !== 'walletId' &&
        record.field !== 'authMethodId' &&
        record.field !== 'deviceId' &&
        record.field !== 'targetFactorVerificationDigestB64u' &&
        record.field !== 'installedActivationRefs'
      ) {
        throw new Error('LinkIntegrityFailureV1.field is invalid');
      }
      return { kind: 'installation_receipt_mismatch', field: record.field };
    default:
      throw new Error('LinkIntegrityFailureV1.kind is invalid');
  }
}

type TransportRequest<K extends LinkedDeviceSessionTransportRequestV1['kind']> = Variant<
  LinkedDeviceSessionTransportRequestV1,
  'kind',
  K
>;

// Each schema parses exactly its declared wire type. Ambient, so it costs nothing.
declare const schemasParseTheirDeclaredTypes: AllTrue<
  [
    ParsesExactly<typeof emailOtpEnrollmentSelectionV1, LinkedDeviceEmailOtpEnrollmentSelectionV1>,
    ParsesExactly<typeof emailOtpEnrollmentMaterialV1, WalletEmailOtpEnrollmentMaterialV1>,
    ParsesExactly<typeof linkedOwnerCredentialMetadataV1, LinkedOwnerCredentialMetadataV1>,
    ParsesExactly<typeof linkedDeviceSummaryV1, LinkedDeviceSummaryV1>,
    ParsesExactly<typeof linkedDeviceListRequestV1, LinkedDeviceListRequestV1>,
    ParsesExactly<typeof ownerDeviceSummaryV1, OwnerDeviceSummaryV1>,
    ParsesExactly<typeof linkedDeviceListResultV1, LinkedDeviceListResultV1>,
    ParsesExactly<typeof linkedDeviceRevokeRequestV1, LinkedDeviceRevokeRequestV1>,
    ParsesExactly<
      typeof linkedDeviceRevokeFailureV1 | typeof linkedDeviceRevokedV1,
      LinkedDeviceRevokeResultV1
    >,
    ParsesExactly<
      typeof linkedDeviceOwnerAuthorizationRequestV1,
      LinkedDeviceOwnerAuthorizationRequestV1
    >,
    ParsesExactly<ReturnType<typeof linkSessionStatesV1>[number], LinkSessionStateV1>,
    ParsesExactly<typeof linkSessionProjectionV1, LinkSessionProjectionV1>,
    ParsesExactly<typeof linkSessionTransportEventV1, LinkSessionTransportEventV1>,
    ParsesExactly<typeof linkedDeviceApprovalResultV1, LinkedDeviceApprovalResultV1>,
    ParsesExactly<typeof linkedDeviceSessionClaimRequestV1, LinkedDeviceSessionClaimRequestV1>,
    ParsesExactly<typeof linkedDeviceSessionClaimV1, LinkedDeviceSessionClaimV1>,
    ParsesExactly<typeof walletSessionOwnerAuthorizationV1, LinkedDeviceOwnerAuthorizationSourceV1>,
    ParsesExactly<
      typeof linkedDeviceApprovalV1 | typeof linkedDeviceSourceContributionApprovalV1,
      LinkedDeviceApprovalV1
    >,
    ParsesExactly<typeof linkedDeviceApprovalDeliveryV1, LinkedDeviceApprovalDeliveryV1>,
    ParsesExactly<
      | typeof passkeyTargetPreparationV1
      | typeof emailOtpTargetPreparationV1
      | typeof newEmailOtpTargetPreparationV1,
      LinkedDeviceTargetPreparationV1
    >,
    ParsesExactly<
      typeof linkedDeviceTargetPreparationRequestV1,
      LinkedDeviceTargetPreparationRequestV1
    >,
    ParsesExactly<typeof emailOtpBaseFactorChoiceV1, LinkedDeviceEmailOtpBaseFactorChoiceV1>,
    ParsesExactly<
      ReturnType<typeof emailOtpBaseFactorResolutionsV1>[keyof ReturnType<
        typeof emailOtpBaseFactorResolutionsV1
      >],
      LinkedDeviceEmailOtpBaseFactorResolutionV1
    >,
    ParsesExactly<
      typeof emailOtpBaseFactorResolutionResultV1,
      LinkedDeviceEmailOtpBaseFactorResolutionResultV1
    >,
    ParsesExactly<
      typeof ed25519ExportRootPreparationV1,
      LinkedDeviceEd25519ExportRootPreparationV1
    >,
    ParsesExactly<typeof recipientRequirementV1, OrdinarySignerMaterialRecipientRequirementV1>,
    ParsesExactly<typeof linkedDeviceWebAuthnRegistrationV1, LinkedDeviceWebAuthnRegistrationV1>,
    ParsesExactly<typeof recipientRequestV1, OrdinarySignerMaterialRecipientRequestV1>,
    ParsesExactly<
      | typeof passkeyTargetCredentialRegistrationV1
      | typeof emailOtpTargetCredentialRegistrationV1
      | typeof newEmailOtpTargetCredentialRegistrationV1,
      LinkedDeviceTargetCredentialRegistrationV1
    >,
    ParsesExactly<
      typeof targetCredentialRegistrationResultV1,
      LinkedDeviceTargetCredentialRegistrationResultV1
    >,
    ParsesExactly<
      | typeof verifiedPasskeyTargetV1
      | typeof verifiedEmailOtpTargetV1
      | typeof verifiedNewEmailOtpTargetV1,
      VerifiedTargetFactorV1
    >,
    ParsesExactly<typeof passkeyWalletAuthMethodDraftV1, PasskeyWalletAuthMethodDraftV1>,
    ParsesExactly<typeof emailOtpWalletAuthMethodDraftV1, EmailOtpWalletAuthMethodDraftV1>,
    ParsesExactly<
      typeof emailOtpVerificationGrantV1 | typeof newEnrollmentEmailOtpVerificationGrantV1,
      LinkedDeviceEmailOtpVerificationGrantV1
    >,
    ParsesExactly<
      typeof emailOtpFactorReleaseEnvelopeV1,
      LinkedDeviceEmailOtpFactorReleaseEnvelopeV1
    >,
    ParsesExactly<
      typeof emailOtpChallengeStartRequestV1,
      LinkedDeviceEmailOtpChallengeStartRequestV1
    >,
    ParsesExactly<
      typeof emailOtpChallengeResendRequestV1,
      LinkedDeviceEmailOtpChallengeResendRequestV1
    >,
    ParsesExactly<
      typeof emailOtpChallengeVerifyRequestV1,
      LinkedDeviceEmailOtpChallengeVerifyRequestV1
    >,
    ParsesExactly<typeof emailOtpChallengeResultV1, LinkedDeviceEmailOtpChallengeResultV1>,
    ParsesExactly<
      typeof cancelUnclaimedRequestV1,
      TransportRequest<'linked_device_session_cancel_unclaimed_request_v1'>
    >,
    ParsesExactly<
      typeof cancelClaimedRequestV1,
      TransportRequest<'linked_device_session_cancel_claimed_request_v1'>
    >,
    ParsesExactly<
      typeof retryCommittedDeliveryRequestV1,
      TransportRequest<'linked_device_session_retry_committed_delivery_request_v1'>
    >,
    ParsesExactly<typeof localAuthorityInstallationReceiptV1, LocalAuthorityInstallationReceiptV1>,
    ParsesExactly<typeof walletSessionOperationCredentialV1, WalletSessionOperationCredentialV1>,
    ParsesExactly<typeof activeWalletSessionV1, ActiveWalletSessionV1>,
    ParsesExactly<typeof localAuthorityActivationFinalAckV1, LocalAuthorityActivationFinalAckV1>,
    ParsesExactly<typeof activationRetryReasonV1, ActivationRetryReasonV1>,
  ]
>;
