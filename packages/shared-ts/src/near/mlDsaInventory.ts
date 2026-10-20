import { exactRecord } from '../utils/exactRecord';
import {
  parseDigestB64u,
  sha256Utf8DigestB64u,
  type DigestB64u,
} from '../utils/canonicalPrimitives';
import { requireRecord } from '../utils/validation';
import { alphabetizeStringify } from '../utils/digests';
import {
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type WalletId,
  type WebAuthnCredentialIdB64u,
  type WebAuthnRpId,
} from '../utils/domainIds';
import { requireParsed } from '../passkey-custody/primitives';
import { parseMlDsaCustodyCommit, type MlDsaCustodyCommit } from '../passkey-custody/mlDsaCustody';
import { parseMlDsaSigningKeyId } from '../signing-lanes/recordParsers';
import type { MlDsaSigningKeyId } from '../signing-lanes';
import type { ReadonlyExclusiveUnion } from '../utils/variant';
import type { MlDsaSigningFailure } from './mlDsaSigning';

export const ML_DSA_INVENTORY_PROOF_TTL_MS = 300_000;
export type MlDsaInventoryActor = {
  readonly walletId: WalletId;
  readonly rpId: WebAuthnRpId;
  readonly credentialIdB64u: WebAuthnCredentialIdB64u;
  readonly walletCustodySeed?: never;
  readonly canonicalSeed?: never;
  readonly holderShare?: never;
};
export type MlDsaInventoryPreparation = MlDsaInventoryActor & {
  readonly nonceB64u: DigestB64u;
  readonly expiresAtMs: number;
};
export type MlDsaInventoryPreparationOutcome = ReadonlyExclusiveUnion<
  | {
      readonly kind: 'prepared';
      readonly preparation: MlDsaInventoryPreparation;
      readonly challengeB64u: string;
    }
  | MlDsaSigningFailure
>;
export type MlDsaSignerInventoryEntry = ReadonlyExclusiveUnion<
  | { readonly kind: 'published'; readonly key: MlDsaCustodyCommit['key'] }
  | {
      readonly kind: 'unpublished';
      readonly signingKeyId: MlDsaSigningKeyId;
      readonly phase: 'admitted' | 'executing' | 'installed' | 'expired_admission';
    }
>;
export type MlDsaSignerInventoryOutcome = ReadonlyExclusiveUnion<
  | { readonly kind: 'inventory'; readonly entries: readonly MlDsaSignerInventoryEntry[] }
  | MlDsaSigningFailure
>;
export function parseMlDsaInventoryActor(raw: unknown): MlDsaInventoryActor {
  const r = exactRecord(raw, ['walletId', 'rpId', 'credentialIdB64u'], 'ML-DSA inventory actor');
  return {
    walletId: requireParsed(parseWalletId(r.walletId), 'walletId'),
    rpId: requireParsed(parseWebAuthnRpId(r.rpId), 'rpId'),
    credentialIdB64u: requireParsed(
      parseWebAuthnCredentialIdB64u(r.credentialIdB64u),
      'credentialIdB64u',
    ),
  };
}

export function parseMlDsaInventoryPreparation(raw: unknown): MlDsaInventoryPreparation {
  const r = exactRecord(
    raw,
    ['walletId', 'rpId', 'credentialIdB64u', 'nonceB64u', 'expiresAtMs'],
    'ML-DSA inventory approval',
  );
  if (
    typeof r.expiresAtMs !== 'number' ||
    !Number.isSafeInteger(r.expiresAtMs) ||
    r.expiresAtMs <= 0
  )
    throw new Error('Invalid ML-DSA inventory expiry');
  return {
    walletId: requireParsed(parseWalletId(r.walletId), 'walletId'),
    rpId: requireParsed(parseWebAuthnRpId(r.rpId), 'rpId'),
    credentialIdB64u: requireParsed(
      parseWebAuthnCredentialIdB64u(r.credentialIdB64u),
      'credentialIdB64u',
    ),
    nonceB64u: parseDigestB64u(r.nonceB64u),
    expiresAtMs: r.expiresAtMs,
  };
}
export async function mlDsaInventoryChallenge(
  preparation: MlDsaInventoryPreparation,
  origin: string,
): Promise<string> {
  return sha256Utf8DigestB64u(
    `seams/ml-dsa/signer-inventory/v1|${alphabetizeStringify({ preparation, origin })}`,
  );
}
export function parseMlDsaSignerInventoryEntry(
  raw: unknown,
  walletId: WalletId,
): MlDsaSignerInventoryEntry {
  const r = exactRecord(raw, inventoryFields(raw), 'ML-DSA signer inventory entry');
  if (r.kind === 'published') {
    const { key } = parseMlDsaCustodyCommit({ custodyAction: 'joined', key: r.key });
    if (key.walletId !== walletId) throw new Error('ML-DSA inventory changed its wallet');
    return { kind: 'published', key };
  }
  if (r.kind !== 'unpublished') throw new Error('Invalid ML-DSA inventory entry');
  switch (r.phase) {
    case 'admitted':
    case 'executing':
    case 'installed':
    case 'expired_admission':
      return {
        kind: 'unpublished',
        signingKeyId: parseMlDsaSigningKeyId(r.signingKeyId),
        phase: r.phase,
      };
    default:
      throw new Error('Invalid ML-DSA unpublished phase');
  }
}
function inventoryFields(raw: unknown): readonly string[] {
  const tagged = requireRecord(raw, 'ML-DSA inventory tag');
  return tagged.kind === 'published' ? ['kind', 'key'] : ['kind', 'signingKeyId', 'phase'];
}
