import { parseAuthFactorId, type AuthFactorId } from '@shared/authorization';
import { parseEmailOtpChallengeId, type EmailOtpChallengeId } from '@shared/utils/domainIds';
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
    | {
        readonly kind: 'email_otp_approved';
        readonly proofDigest: DigestB64u;
        readonly verifiedAtMs: number;
        readonly expiresAtMs: number;
        readonly factorId: AuthFactorId;
        readonly challengeId: EmailOtpChallengeId;
        readonly verificationReceiptDigest: DigestB64u;
      }
    | { readonly kind: 'awaiting_approval' }
    | { readonly kind: 'session_approved'; readonly sessionIdB64u: DigestB64u }
    | {
        readonly kind: 'approved';
        readonly verifiedAtMs: number;
        readonly assertionDigest: DigestB64u;
      }
  >;
};

export function encodeMlDsaSigningRecord(record: MlDsaSigningRecord): VersionedJsonObject {
  return {
    preparation: {
      request: {
        walletId: record.preparation.request.walletId,
        signingKeyId: record.preparation.request.signingKeyId,
        operationIdB64u: record.preparation.request.operationIdB64u,
        unsignedTransactionBorshB64u: record.preparation.request.unsignedTransactionBorshB64u,
        actor:
          record.preparation.request.actor.kind === 'passkey'
            ? {
                kind: 'passkey',
                rpId: record.preparation.request.actor.rpId,
                credentialIdB64u: record.preparation.request.actor.credentialIdB64u,
              }
            : {
                kind: 'email_otp',
                walletAuthMethodId: record.preparation.request.actor.walletAuthMethodId,
              },
      },
      transaction: record.preparation.transaction,
      challengeB64u: record.preparation.challengeB64u,
      expiresAtMs: record.preparation.expiresAtMs,
    },
    targetJson: JSON.stringify(record.target),
    ownerJson: JSON.stringify(record.owner),
    publicationVersion: record.publicationVersion,
    origin: record.origin,
    phase: encodeSigningPhase(record.phase),
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
    const preparation = parseStoredPreparation(r.preparation);
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
      case 'email_otp_approved':
        if (
          preparation.request.actor.kind !== 'email_otp' ||
          typeof p.verifiedAtMs !== 'number' ||
          !Number.isSafeInteger(p.verifiedAtMs) ||
          p.verifiedAtMs <= 0 ||
          typeof p.expiresAtMs !== 'number' ||
          !Number.isSafeInteger(p.expiresAtMs) ||
          p.expiresAtMs <= p.verifiedAtMs ||
          p.expiresAtMs > preparation.expiresAtMs
        )
          return null;
        phase = {
          kind: 'email_otp_approved',
          proofDigest: parseDigestB64u(p.proofDigest),
          verifiedAtMs: p.verifiedAtMs,
          expiresAtMs: p.expiresAtMs,
          factorId: requireParsed(parseAuthFactorId(p.factorId), 'factorId'),
          challengeId: requireParsed(parseEmailOtpChallengeId(p.challengeId), 'challengeId'),
          verificationReceiptDigest: parseDigestB64u(p.verificationReceiptDigest),
        };
        break;
      case 'awaiting_approval':
        phase = { kind: 'awaiting_approval' };
        break;
      case 'session_approved':
        phase = { kind: 'session_approved', sessionIdB64u: parseDigestB64u(p.sessionIdB64u) };
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
  switch (r.kind) {
    case 'email_otp_approved':
      return [
        'kind',
        'proofDigest',
        'verifiedAtMs',
        'expiresAtMs',
        'factorId',
        'challengeId',
        'verificationReceiptDigest',
      ];
    case 'approved':
      return ['kind', 'verifiedAtMs', 'assertionDigest'];
    case 'session_approved':
      return ['kind', 'sessionIdB64u'];
    default:
      return ['kind'];
  }
}

function parseStoredPreparation(raw: unknown): MlDsaSigningPreparation {
  const p = exactRecord(
    raw,
    ['request', 'transaction', 'challengeB64u', 'expiresAtMs'],
    'Stored signing preparation',
  );
  const request = requireRecord(p.request, 'Stored signing request');
  if ('actor' in request) return parseMlDsaSigningPreparation(raw);
  const previous = exactRecord(
    request,
    [
      'walletId',
      'signingKeyId',
      'operationIdB64u',
      'unsignedTransactionBorshB64u',
      'rpId',
      'credentialIdB64u',
    ],
    'Stored Passkey request',
  );
  return parseMlDsaSigningPreparation({
    request: {
      walletId: previous.walletId,
      signingKeyId: previous.signingKeyId,
      operationIdB64u: previous.operationIdB64u,
      unsignedTransactionBorshB64u: previous.unsignedTransactionBorshB64u,
      actor: { kind: 'passkey', rpId: previous.rpId, credentialIdB64u: previous.credentialIdB64u },
    },
    transaction: p.transaction,
    challengeB64u: p.challengeB64u,
    expiresAtMs: p.expiresAtMs,
  });
}

function encodeSigningPhase(phase: MlDsaSigningRecord['phase']): VersionedJsonObject {
  switch (phase.kind) {
    case 'awaiting_approval':
      return { kind: 'awaiting_approval' };
    case 'approved':
      return {
        kind: 'approved',
        verifiedAtMs: phase.verifiedAtMs,
        assertionDigest: phase.assertionDigest,
      };
    case 'session_approved':
      return { kind: 'session_approved', sessionIdB64u: phase.sessionIdB64u };
    case 'email_otp_approved':
      return {
        kind: 'email_otp_approved',
        proofDigest: phase.proofDigest,
        verifiedAtMs: phase.verifiedAtMs,
        expiresAtMs: phase.expiresAtMs,
        factorId: phase.factorId,
        challengeId: phase.challengeId,
        verificationReceiptDigest: phase.verificationReceiptDigest,
      };
    default:
      return assertNever(phase);
  }
}
function assertNever(value: never): never {
  throw new Error(`Unknown signing phase: ${String(value)}`);
}
