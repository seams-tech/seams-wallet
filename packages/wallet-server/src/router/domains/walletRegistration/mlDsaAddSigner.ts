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
  parseMlDsaCreateProtocolInputs,
  type MlDsaCreateProtocolInputs,
} from '@shared/passkey-custody/mlDsaCustody';
import {
  walletObjectIdentity,
  type WalletObjectIdentity,
} from '../../cloudflare/runtime/walletObjectAddresses';

export type MlDsaAddSignerPreparation = {
  readonly protocolInputs: MlDsaCreateProtocolInputs;
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

export function parseMlDsaAddSignerPreparation(raw: unknown): MlDsaAddSignerPreparation {
  const record = exactRecord(
    raw,
    ['protocolInputs', 'identity', 'owner', 'recipientKeyVersions', 'custodyEnvelope'],
    'ML-DSA preparation',
  );
  const protocolInputs = parseMlDsaCreateProtocolInputs(record.protocolInputs);
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
  return {
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
  };
}
