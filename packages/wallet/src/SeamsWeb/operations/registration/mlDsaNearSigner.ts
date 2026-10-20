import type { SeamsWebPublicApi } from '@/SeamsWeb/publicApi/createPublicApi';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { AddedMlDsaSignerCapability } from '@/core/types/seams';
import type {
  NearAccountRef,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  enrollMlDsaNearSigner,
  type MlDsaNearEnrollmentOutcome,
} from '@/core/signingEngine/walletCustody/mlDsaEnrollment';
import type { WebAuthnRpId, WalletId } from '@shared/utils/domainIds';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export type AddMlDsaNearSignerOutcome = ReadonlyExclusiveUnion<
  | { readonly kind: 'registration_failed'; readonly message: string }
  | {
      readonly kind: 'published';
      readonly walletId: WalletId;
      readonly signer: AddedMlDsaSignerCapability;
      readonly enrollment: MlDsaNearEnrollmentOutcome;
    }
>;

/** Publish a seed-derived signer, then enroll its exact key through ordinary NEAR approval. */
export async function addMlDsaNearSigner(input: {
  readonly wallet: Pick<SeamsWebPublicApi, 'registration' | 'near'>;
  readonly nearClient: Pick<NearClient, 'viewAccessKeyList'>;
  readonly walletSession: WalletSessionRef;
  readonly nearAccount: NearAccountRef;
  readonly rpId: WebAuthnRpId;
  readonly signerSlot: number;
}): Promise<AddMlDsaNearSignerOutcome> {
  const registered = await input.wallet.registration.addSigner({
    walletId: input.walletSession.walletId,
    rpId: input.rpId,
    signerSelection: { mode: 'ml_dsa_65', mlDsa: { signerSlot: input.signerSlot } },
  });
  if (!registered.success) return { kind: 'registration_failed', message: registered.error };
  if (
    registered.kind !== 'wallet_signer_added' ||
    registered.walletId !== input.walletSession.walletId ||
    registered.capabilities[0].kind !== 'near_ml_dsa_65'
  )
    throw new Error('ML-DSA signer publication returned a different wallet or key family');
  const signer = registered.capabilities[0];
  return {
    kind: 'published',
    walletId: registered.walletId,
    signer,
    enrollment: await enrollMlDsaNearSigner({
      near: input.wallet.near,
      nearClient: input.nearClient,
      walletSession: input.walletSession,
      nearAccount: input.nearAccount,
      publication: { walletId: registered.walletId, signer },
    }),
  };
}
