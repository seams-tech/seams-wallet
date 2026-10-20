import { exactRecord } from '@shared/utils/exactRecord';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseWalletAuthorityV1,
  type ActiveWalletAuthorityV1,
} from '@shared/authorization/walletAuthority';
import {
  parseMlDsaSigningPreparation,
  type MlDsaSigningPreparation,
} from '@shared/near/mlDsaSigning';
import { requireParsed } from '@shared/passkey-custody/primitives';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import { MlDsaSigningTarget } from '../../../domains/signingOperations/mlDsaOwnerAdmission';
import { parseSessionOrigin, type SessionOrigin } from '../../../../authorization/domain';
import type { VersionedJsonObject } from '../../../framework/versionedJsonRecordStore';
import {
  parseMlDsaInventoryPreparation,
  type MlDsaInventoryPreparation,
} from '@shared/near/mlDsaInventory';

export type MlDsaInventoryChallengeRecord = {
  readonly preparation: MlDsaInventoryPreparation;
  readonly origin: SessionOrigin;
  readonly authorityDigestB64u: DigestB64u;
  readonly revocationEpoch: number;
};
export function encodeMlDsaInventoryChallenge(
  record: MlDsaInventoryChallengeRecord,
): VersionedJsonObject {
  const p = record.preparation;
  return {
    preparation: {
      walletId: p.walletId,
      rpId: p.rpId,
      credentialIdB64u: p.credentialIdB64u,
      nonceB64u: p.nonceB64u,
      expiresAtMs: p.expiresAtMs,
    },
    origin: record.origin,
    authorityDigestB64u: record.authorityDigestB64u,
    revocationEpoch: record.revocationEpoch,
  };
}
export function parseMlDsaInventoryChallenge(raw: unknown): MlDsaInventoryChallengeRecord | null {
  try {
    const r = exactRecord(
      raw,
      ['preparation', 'origin', 'authorityDigestB64u', 'revocationEpoch'],
      'ML-DSA inventory challenge',
    );
    if (
      typeof r.revocationEpoch !== 'number' ||
      !Number.isSafeInteger(r.revocationEpoch) ||
      r.revocationEpoch < 0
    )
      return null;
    return {
      preparation: parseMlDsaInventoryPreparation(r.preparation),
      origin: parseSessionOrigin(r.origin),
      authorityDigestB64u: parseDigestB64u(r.authorityDigestB64u),
      revocationEpoch: r.revocationEpoch,
    };
  } catch {
    return null;
  }
}

export type MlDsaSigningRecord = {
  readonly preparation: MlDsaSigningPreparation;
  readonly target: MlDsaSigningTarget;
  readonly owner: ActiveWalletAuthorityV1;
  readonly publicationVersion: string;
  readonly origin: SessionOrigin;
  readonly phase: ReadonlyExclusiveUnion<
    | { readonly kind: 'awaiting_approval' }
    | {
        readonly kind: 'approved';
        readonly verifiedAtMs: number;
        readonly assertionDigest: DigestB64u;
      }
  >;
};

export function encodeMlDsaSigningRecord(record: MlDsaSigningRecord): VersionedJsonObject {
  const phase: VersionedJsonObject =
    record.phase.kind === 'approved'
      ? {
          kind: 'approved',
          verifiedAtMs: record.phase.verifiedAtMs,
          assertionDigest: record.phase.assertionDigest,
        }
      : { kind: 'awaiting_approval' };
  return {
    preparation: {
      request: {
        walletId: record.preparation.request.walletId,
        signingKeyId: record.preparation.request.signingKeyId,
        operationIdB64u: record.preparation.request.operationIdB64u,
        unsignedTransactionBorshB64u: record.preparation.request.unsignedTransactionBorshB64u,
        rpId: record.preparation.request.rpId,
        credentialIdB64u: record.preparation.request.credentialIdB64u,
      },
      transaction: record.preparation.transaction,
      challengeB64u: record.preparation.challengeB64u,
      expiresAtMs: record.preparation.expiresAtMs,
    },
    targetJson: JSON.stringify(record.target),
    ownerJson: JSON.stringify(record.owner),
    publicationVersion: record.publicationVersion,
    origin: record.origin,
    phase,
  };
}
export function parseMlDsaSigningRecord(raw: unknown): MlDsaSigningRecord | null {
  try {
    const r = exactRecord(
      raw,
      ['preparation', 'targetJson', 'ownerJson', 'publicationVersion', 'origin', 'phase'],
      'ML-DSA signing journal',
    );
    const p = exactRecord(r.phase, phaseFields(r.phase), 'ML-DSA signing phase');
    const preparation = parseMlDsaSigningPreparation(r.preparation);
    const target = MlDsaSigningTarget.parse(
      JSON.parse(requireCanonicalString(r.targetJson, 'targetJson')),
    );
    const owner = requireParsed(
      parseWalletAuthorityV1(JSON.parse(requireCanonicalString(r.ownerJson, 'ownerJson'))),
      'owner',
    );
    if (
      owner.state !== 'active' ||
      owner.walletId !== target.identity.walletId ||
      preparation.request.walletId !== target.identity.walletId ||
      preparation.request.signingKeyId !== target.key.mlDsaSigningKeyId ||
      preparation.transaction.publicKeyB64u !== target.key.registeredPublicKeyB64u
    )
      return null;
    let phase: MlDsaSigningRecord['phase'];
    switch (p.kind) {
      case 'awaiting_approval':
        phase = { kind: 'awaiting_approval' };
        break;
      case 'approved':
        if (
          typeof p.verifiedAtMs !== 'number' ||
          !Number.isSafeInteger(p.verifiedAtMs) ||
          p.verifiedAtMs <= 0
        )
          return null;
        phase = {
          kind: 'approved',
          verifiedAtMs: p.verifiedAtMs,
          assertionDigest: parseDigestB64u(p.assertionDigest),
        };
        break;
      default:
        return null;
    }
    return {
      preparation,
      target,
      owner,
      publicationVersion: requireCanonicalString(r.publicationVersion, 'publicationVersion'),
      origin: parseSessionOrigin(r.origin),
      phase,
    };
  } catch {
    return null;
  }
}
function phaseFields(raw: unknown): readonly string[] {
  const r = requireRecord(raw, 'ML-DSA phase');
  return r.kind === 'approved' ? ['kind', 'verifiedAtMs', 'assertionDigest'] : ['kind'];
}
