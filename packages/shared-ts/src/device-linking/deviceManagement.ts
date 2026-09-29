// Linked-device management: listing a wallet's devices and revoking one.
import type { WalletAuthMethodId } from '../utils/domainIds';
import { parseWebAuthnAuthenticatorDeviceInfo } from '../utils/webauthnDeviceInfo';
import {
  type LinkedDeviceListRequestV1,
  type LinkedDeviceListResultV1,
  type OwnerDeviceSummaryV1,
  type LinkedDeviceRevokeRequestV1,
  type LinkedDeviceRevokeResultV1,
  type LinkedDeviceSummaryV1,
  type LinkedOwnerCredentialMetadataV1,
} from './contracts';
import { requireRecord } from '../utils/validation';
import {
  wireLiteral,
  wireObject,
  wireUnion,
  type AllTrue,
  type ParsesExactly,
  type WireParser,
} from '../utils/wireSchema';
import {
  credentialId,
  digest,
  enrollmentId,
  linkedDeviceId,
  nullableToken,
  parseDelegatedWalletAuthority,
  parseNonNegativeSafeInteger,
  parseTargetEmail,
  parseUnixTime,
  walletAuthMethodId,
  walletAuthorityId,
  walletId,
  walletKeyId,
} from './wireFields';

// A list that may be empty, reported as invalid when it is not an array.
function listOf<T>(item: WireParser<T>): WireParser<T[]> {
  return (raw, label) => {
    if (!Array.isArray(raw)) throw new Error(`${label} is invalid`);
    return raw.map((entry, index) => item(entry, `${label}[${index}]`));
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

function parsePositiveSafeInteger(raw: unknown, label: string): number {
  const value = parseNonNegativeSafeInteger(raw, label);
  if (value < 1) throw new Error(`${label} must be a positive safe integer`);
  return value;
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

// Each schema parses exactly its declared wire type. Ambient, so it costs nothing.
declare const schemasParseTheirDeclaredTypes: AllTrue<
  [
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
  ]
>;
