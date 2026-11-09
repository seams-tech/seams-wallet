import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import { base64UrlEncode } from '@shared/utils/base64';
import type { RouterAbEd25519YaoSealableActiveClientV1 } from '@/core/signingEngine/threshold/ed25519/yaoClient';
import type { WalletCustodyCeremonySurface } from '@/SeamsWeb/signingSurface/ports';
import {
  WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND,
  type LoadedWalletCustodyEd25519MaterialV1,
} from './ed25519SeedMaterial';
import { joinCustodyWireFromEnvelopeRecord } from './joinCustodyWire';
import {
  openWalletCustodyEd25519ActiveClientV1,
  walletCustodyCacheEnvelopeFromRecordV1,
  type WalletCustodyActivationFactsV1,
} from './openCustodyCache';
import type { WalletSessionEd25519ReissueBasisV1 } from './walletReissueEd25519';

/**
 * Reissues the current Client share for a site with no usable cache, and
 * opens it.
 *
 * A reissue keeps the material activation and the state epoch, so the new
 * row carries the server's current epoch and SigningWorker verifying share,
 * and it opens with the same activation facts as a cache hit. The caller
 * persists `material`; a failed write costs the next unlock another reissue.
 */
export async function reissueWalletCustodyEd25519CacheV1(input: {
  readonly reissueKeySet: WalletCustodyCeremonySurface['reissueWalletCustodyNearEd25519KeySet'];
  readonly envelope: PasskeyCustodyEnvelopeRecord;
  /** Borrowed. The ceremony and the open each get a copy, zeroed here. */
  readonly factorSecret: Uint8Array;
  readonly basis: WalletSessionEd25519ReissueBasisV1;
  readonly signer: {
    readonly walletId: string;
    readonly nearAccountId: string;
    readonly nearEd25519SigningKeyId: string;
    readonly signerSlot: number;
  };
  readonly activation: WalletCustodyActivationFactsV1;
  readonly routerOrigin: string;
  readonly walletSessionToken: string;
}): Promise<{
  readonly activeClient: RouterAbEd25519YaoSealableActiveClientV1;
  readonly material: LoadedWalletCustodyEd25519MaterialV1;
}> {
  const custodyWire = joinCustodyWireFromEnvelopeRecord(input.envelope);
  if (!custodyWire.ok) throw new Error(custodyWire.reason);
  const ceremonySecret = input.factorSecret.slice();
  const openSecret = input.factorSecret.slice();
  try {
    const { localMaterial } = await input.reissueKeySet({
      walletId: input.signer.walletId,
      custodyJson: custodyWire.custodyJson,
      factorSecret: ceremonySecret.buffer,
      nearEd25519SigningKeyId: input.signer.nearEd25519SigningKeyId,
      basis: input.basis,
      routerOrigin: input.routerOrigin,
      walletSessionToken: input.walletSessionToken,
    });
    const material: LoadedWalletCustodyEd25519MaterialV1 = {
      binding: {
        kind: WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND,
        applicationBindingDigestB64u: localMaterial.applicationBindingDigestB64u,
        registeredPublicKeyB64u: base64UrlEncode(Uint8Array.from(input.basis.registeredPublicKey)),
        participantIds: input.basis.participantIds,
        stateEpoch: String(input.basis.stateEpoch),
        ...input.signer,
        signingWorkerId: input.basis.lifecycle.signingWorkerId,
        signingWorkerVerifyingShareB64u: base64UrlEncode(
          Uint8Array.from(input.basis.signingWorkerVerifyingShare),
        ),
      },
      sealed: { ciphertextB64u: localMaterial.b64u, nonceB64u: localMaterial.nonceB64u },
    };
    const activeClient = await openWalletCustodyEd25519ActiveClientV1({
      material,
      activation: input.activation,
      envelope: walletCustodyCacheEnvelopeFromRecordV1(input.envelope),
      ownedFactorSecret: openSecret,
    });
    return { activeClient, material };
  } finally {
    ceremonySecret.fill(0);
    openSecret.fill(0);
  }
}
