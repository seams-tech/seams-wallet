import type { SeamsWebPublicApi } from '@/SeamsWeb/publicApi/createPublicApi';
import type { AddedMlDsaSignerCapability } from '@/core/types/seams';
import type { WalletId, WebAuthnRpId } from '@shared/utils/domainIds';
import { mlDsaSigningKeyIdForSlot } from '@shared/passkey-custody/mlDsaCustody';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export type RestoreMlDsaNearSignerOutcome = ReadonlyExclusiveUnion<
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'restored'; readonly signer: AddedMlDsaSignerCapability }
>;

/** Re-establish participant material from the active owner's wallet custody seed. */
export async function restoreMlDsaNearSigner(input: {
  readonly wallet: Pick<SeamsWebPublicApi, 'registration'>;
  readonly walletId: WalletId;
  readonly rpId: WebAuthnRpId;
  readonly signerSlot: number;
  readonly recordedSigner: AddedMlDsaSignerCapability;
}): Promise<RestoreMlDsaNearSignerOutcome> {
  const recorded = input.recordedSigner;
  if (recorded.signingKeyId !== mlDsaSigningKeyIdForSlot(input.signerSlot))
    throw new Error('ML-DSA restoration names a different signer slot');
  const result = await input.wallet.registration.addSigner({
    walletId: input.walletId,
    rpId: input.rpId,
    signerSelection: {
      mode: 'ml_dsa_65',
      mlDsa: {
        signerSlot: input.signerSlot,
        purpose: {
          kind: 'restore',
          publicKeyB64u: recorded.publicKeyB64u,
          keyManifestDigestB64u: recorded.keyManifestDigestB64u,
          materialEpoch: recorded.materialEpoch,
        },
      },
    },
  });
  if (!result.success) return { kind: 'refused', message: result.error };
  if (result.kind !== 'wallet_signer_added' || result.walletId !== input.walletId)
    throw new Error('ML-DSA restoration returned a different wallet');
  const signer = result.capabilities[0];
  if (
    signer.kind !== 'near_ml_dsa_65' ||
    signer.signingKeyId !== recorded.signingKeyId ||
    signer.publicKeyB64u !== recorded.publicKeyB64u ||
    signer.keyManifestDigestB64u !== recorded.keyManifestDigestB64u ||
    signer.materialEpoch <= recorded.materialEpoch
  )
    throw new Error('ML-DSA restoration changed the recorded key');
  return { kind: 'restored', signer };
}
