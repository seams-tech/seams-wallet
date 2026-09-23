import { rejectUnknownFields, requireRecord } from '../passkey-custody/primitives';
import { base64UrlEncode } from '../utils/base64';
import { alphabetizeStringify, sha256Bytes } from '../utils/digests';
import {
  parseWalletAuthorityId,
  parseWebAuthnCredentialIdB64u,
  type WalletAuthorityId,
  type WalletId,
  type WebAuthnCredentialIdB64u,
} from '../utils/domainIds';
import { parseWalletHomeLane, type WalletHomeLane } from './homeLane';
import {
  parseUnixTimestamp,
  parseWalletHomeLaneId,
  parseWalletLaneEpoch,
  parseWalletRegionMigrationGrantDigest,
  parseWalletRegionMigrationId,
  parseWalletRegionPolicyVersion,
  parseWalletRegionRequestNonceB64u,
  parseWalletRegionStepUpChallengeDigest,
  requireWalletId,
  requireWalletRegionBoundary,
  type UnixTimestamp,
  type WalletHomeLaneId,
  type WalletLaneEpoch,
  type WalletRegionMigrationGrantDigest,
  type WalletRegionMigrationId,
  type WalletRegionPolicyVersion,
  type WalletRegionRequestNonceB64u,
  type WalletRegionStepUpChallengeDigest,
} from './ids';

const walletRegionMigrationGrantProof: unique symbol = Symbol('WalletRegionMigrationGrant');

export type WalletRegionMigrationGrant = {
  readonly version: 'wallet_region_migration_grant_v1';
  readonly migrationId: WalletRegionMigrationId;
  readonly walletId: WalletId;
  readonly ownerAuthorityId: WalletAuthorityId;
  readonly credentialId: WebAuthnCredentialIdB64u;
  readonly source: WalletHomeLane;
  readonly targetLaneId: WalletHomeLaneId;
  readonly targetEpoch: WalletLaneEpoch;
  readonly policyVersion: WalletRegionPolicyVersion;
  readonly requestNonceB64u: WalletRegionRequestNonceB64u;
  readonly stepUpChallengeDigestB64u: WalletRegionStepUpChallengeDigest;
  readonly issuedAt: UnixTimestamp;
  readonly expiresAt: UnixTimestamp;
  readonly grantDigest: WalletRegionMigrationGrantDigest;
  readonly [walletRegionMigrationGrantProof]: true;
};

export type WalletRegionMigrationGrantUnsignedFields = Omit<
  WalletRegionMigrationGrant,
  'grantDigest' | typeof walletRegionMigrationGrantProof
>;

function requireDomainId<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly message: string } },
  label: string,
): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.value;
}

function grantDigestPayload(fields: WalletRegionMigrationGrantUnsignedFields): object {
  return {
    version: fields.version,
    migrationId: fields.migrationId,
    walletId: fields.walletId,
    ownerAuthorityId: fields.ownerAuthorityId,
    credentialId: fields.credentialId,
    source: fields.source,
    targetLaneId: fields.targetLaneId,
    targetEpoch: fields.targetEpoch,
    policyVersion: fields.policyVersion,
    requestNonceB64u: fields.requestNonceB64u,
    stepUpChallengeDigestB64u: fields.stepUpChallengeDigestB64u,
    issuedAt: fields.issuedAt,
    expiresAt: fields.expiresAt,
  };
}

export async function computeWalletRegionMigrationGrantDigest(
  fields: WalletRegionMigrationGrantUnsignedFields,
): Promise<WalletRegionMigrationGrantDigest> {
  const encoded = new TextEncoder().encode(alphabetizeStringify(grantDigestPayload(fields)));
  return requireWalletRegionBoundary(
    parseWalletRegionMigrationGrantDigest(base64UrlEncode(await sha256Bytes(encoded))),
    'wallet region migration grant digest',
  );
}

export function buildWalletRegionMigrationGrant(input: {
  readonly fields: WalletRegionMigrationGrantUnsignedFields;
  readonly grantDigest: WalletRegionMigrationGrantDigest;
}): WalletRegionMigrationGrant {
  if (input.fields.walletId !== input.fields.source.walletId) {
    throw new Error('wallet region migration grant source belongs to another wallet');
  }
  if (input.fields.source.laneId === input.fields.targetLaneId) {
    throw new Error('wallet region migration grant target must differ from its source lane');
  }
  if (input.fields.targetEpoch !== input.fields.source.laneEpoch + 1) {
    throw new Error(
      'wallet region migration grant target epoch must immediately follow its source',
    );
  }
  if (input.fields.expiresAt <= input.fields.issuedAt) {
    throw new Error('wallet region migration grant expiry must follow issuance');
  }
  return {
    version: input.fields.version,
    migrationId: input.fields.migrationId,
    walletId: input.fields.walletId,
    ownerAuthorityId: input.fields.ownerAuthorityId,
    credentialId: input.fields.credentialId,
    source: input.fields.source,
    targetLaneId: input.fields.targetLaneId,
    targetEpoch: input.fields.targetEpoch,
    policyVersion: input.fields.policyVersion,
    requestNonceB64u: input.fields.requestNonceB64u,
    stepUpChallengeDigestB64u: input.fields.stepUpChallengeDigestB64u,
    issuedAt: input.fields.issuedAt,
    expiresAt: input.fields.expiresAt,
    grantDigest: input.grantDigest,
    [walletRegionMigrationGrantProof]: true,
  };
}

export async function createWalletRegionMigrationGrant(
  fields: WalletRegionMigrationGrantUnsignedFields,
): Promise<WalletRegionMigrationGrant> {
  return buildWalletRegionMigrationGrant({
    fields,
    grantDigest: await computeWalletRegionMigrationGrantDigest(fields),
  });
}

export async function walletRegionMigrationGrantDigestIsValid(
  grant: WalletRegionMigrationGrant,
): Promise<boolean> {
  return (await computeWalletRegionMigrationGrantDigest(grant)) === grant.grantDigest;
}

export function parseWalletRegionMigrationGrant(raw: unknown): WalletRegionMigrationGrant {
  const label = 'walletRegionMigrationGrant';
  const record = requireRecord(raw, label);
  rejectUnknownFields(
    record,
    [
      'version',
      'migrationId',
      'walletId',
      'ownerAuthorityId',
      'credentialId',
      'source',
      'targetLaneId',
      'targetEpoch',
      'policyVersion',
      'requestNonceB64u',
      'stepUpChallengeDigestB64u',
      'issuedAt',
      'expiresAt',
      'grantDigest',
    ],
    label,
  );
  if (record.version !== 'wallet_region_migration_grant_v1') {
    throw new Error(`${label}.version is invalid`);
  }
  const source = parseWalletHomeLane(record.source);
  const fields: WalletRegionMigrationGrantUnsignedFields = {
    version: record.version,
    migrationId: requireWalletRegionBoundary(
      parseWalletRegionMigrationId(record.migrationId),
      `${label}.migrationId`,
    ),
    walletId: requireWalletId(record.walletId, `${label}.walletId`),
    ownerAuthorityId: requireDomainId(
      parseWalletAuthorityId(record.ownerAuthorityId),
      `${label}.ownerAuthorityId`,
    ),
    credentialId: requireDomainId(
      parseWebAuthnCredentialIdB64u(record.credentialId),
      `${label}.credentialId`,
    ),
    source,
    targetLaneId: requireWalletRegionBoundary(
      parseWalletHomeLaneId(record.targetLaneId),
      `${label}.targetLaneId`,
    ),
    targetEpoch: requireWalletRegionBoundary(
      parseWalletLaneEpoch(record.targetEpoch),
      `${label}.targetEpoch`,
    ),
    policyVersion: requireWalletRegionBoundary(
      parseWalletRegionPolicyVersion(record.policyVersion),
      `${label}.policyVersion`,
    ),
    requestNonceB64u: requireWalletRegionBoundary(
      parseWalletRegionRequestNonceB64u(record.requestNonceB64u),
      `${label}.requestNonceB64u`,
    ),
    stepUpChallengeDigestB64u: requireWalletRegionBoundary(
      parseWalletRegionStepUpChallengeDigest(record.stepUpChallengeDigestB64u),
      `${label}.stepUpChallengeDigestB64u`,
    ),
    issuedAt: requireWalletRegionBoundary(parseUnixTimestamp(record.issuedAt), `${label}.issuedAt`),
    expiresAt: requireWalletRegionBoundary(
      parseUnixTimestamp(record.expiresAt),
      `${label}.expiresAt`,
    ),
  };
  return buildWalletRegionMigrationGrant({
    fields,
    grantDigest: requireWalletRegionBoundary(
      parseWalletRegionMigrationGrantDigest(record.grantDigest),
      `${label}.grantDigest`,
    ),
  });
}
