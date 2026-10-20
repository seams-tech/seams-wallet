import type { ReadonlyExclusiveUnion, Variant } from '@shared/utils/variant';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireCanonicalString } from '@shared/utils/validation';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
} from '@shared/utils/domainIds';
import { requireParsed } from '@shared/passkey-custody/primitives';
import {
  parseMlDsaCustodyProtocolInputs,
  parseMlDsaSignerPurpose,
  type MlDsaSignerPurpose,
  type MlDsaCreateProtocolInputs,
  type MlDsaRecoveryProtocolInputs,
  mlDsaProtocolMatchesPurpose,
  type MlDsaCustodyProtocolInputs,
} from '@shared/passkey-custody/mlDsaCustody';
import {
  walletObjectIdentity,
  type WalletObjectIdentity,
} from '../../cloudflare/runtime/walletObjectAddresses';

type PreparationIdentity = {
  readonly walletCustodySeed?: never;
  readonly canonicalSeed?: never;
  readonly holderShare?: never;
  readonly identity: WalletObjectIdentity;
  readonly owner: {
    readonly walletAuthorityId: WalletAuthorityId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly authorityDigestB64u: DigestB64u;
    readonly revocationEpoch: number;
  };
  readonly recipientKeyVersions: { readonly a: string; readonly b: string };
  readonly custodyEnvelope: { readonly recordKey: string; readonly storeVersion: string };
};

export type MlDsaAddSignerPreparation = PreparationIdentity &
  ReadonlyExclusiveUnion<
    | {
        readonly purpose: Variant<MlDsaSignerPurpose, 'kind', 'create'>;
        readonly protocolInputs: MlDsaCreateProtocolInputs;
      }
    | {
        readonly purpose: Variant<MlDsaSignerPurpose, 'kind', 'restore'>;
        readonly protocolInputs: MlDsaRecoveryProtocolInputs;
      }
  >;

type UnverifiedPreparation = PreparationIdentity & {
  readonly purpose: MlDsaSignerPurpose;
  readonly protocolInputs: MlDsaCustodyProtocolInputs;
};

function matchesPreparation(value: UnverifiedPreparation): value is MlDsaAddSignerPreparation {
  return mlDsaProtocolMatchesPurpose(value.protocolInputs, value.purpose);
}

/** Bind the participant response to the admitted purpose at the preparation boundary. */
export function buildMlDsaAddSignerPreparation(
  value: UnverifiedPreparation,
): MlDsaAddSignerPreparation {
  if (!matchesPreparation(value)) throw new Error('ML-DSA preparation changed its continuity');
  return value;
}

export function parseMlDsaAddSignerPreparation(raw: unknown): MlDsaAddSignerPreparation {
  const record = exactRecord(
    raw,
    ['purpose', 'protocolInputs', 'identity', 'owner', 'recipientKeyVersions', 'custodyEnvelope'],
    'ML-DSA preparation',
  );
  const purpose = parseMlDsaSignerPurpose(record.purpose);
  const protocolInputs = parseMlDsaCustodyProtocolInputs(record.protocolInputs);
  const identityRecord = exactRecord(
    record.identity,
    ['walletId', 'ownershipGeneration', 'orgId', 'projectId', 'envId'],
    'ML-DSA wallet identity',
  );
  const identity = walletObjectIdentity(
    identityRecord.walletId,
    identityRecord.ownershipGeneration,
    {
      orgId: identityRecord.orgId,
      projectId: identityRecord.projectId,
      envId: identityRecord.envId,
    },
  );
  if (protocolInputs.walletId !== identity.walletId)
    throw new Error('ML-DSA preparation changed its wallet');
  const owner = exactRecord(
    record.owner,
    ['walletAuthorityId', 'walletAuthMethodId', 'authorityDigestB64u', 'revocationEpoch'],
    'ML-DSA owner',
  );
  if (
    typeof owner.revocationEpoch !== 'number' ||
    !Number.isSafeInteger(owner.revocationEpoch) ||
    owner.revocationEpoch < 0
  ) {
    throw new Error('ML-DSA owner revocation epoch must be a nonnegative integer');
  }
  const versions = exactRecord(
    record.recipientKeyVersions,
    ['a', 'b'],
    'ML-DSA recipient versions',
  );
  const envelope = exactRecord(
    record.custodyEnvelope,
    ['recordKey', 'storeVersion'],
    'ML-DSA custody envelope',
  );
  return buildMlDsaAddSignerPreparation({
    purpose,
    protocolInputs,
    identity,
    owner: {
      walletAuthorityId: requireParsed(
        parseWalletAuthorityId(owner.walletAuthorityId),
        'walletAuthorityId',
      ),
      walletAuthMethodId: requireParsed(
        parseWalletAuthMethodId(owner.walletAuthMethodId),
        'walletAuthMethodId',
      ),
      authorityDigestB64u: parseDigestB64u(owner.authorityDigestB64u),
      revocationEpoch: owner.revocationEpoch,
    },
    recipientKeyVersions: {
      a: requireCanonicalString(versions.a, 'participant A key version'),
      b: requireCanonicalString(versions.b, 'participant B key version'),
    },
    custodyEnvelope: {
      recordKey: requireCanonicalString(envelope.recordKey, 'custody envelope key'),
      storeVersion: requireCanonicalString(envelope.storeVersion, 'custody envelope version'),
    },
  });
}
