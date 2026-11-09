import { custodyEnvelopeBindingJsonV1 } from '@shared/passkey-custody';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import {
  isWalletCustodySeedBinding,
  type PasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';
import {
  ROUTER_AB_ED25519_YAO_ACTIVE_CLIENT_KIND_V1,
  RouterAbEd25519YaoClientV1,
  type RouterAbEd25519YaoActiveClientMetadataV1,
  type RouterAbEd25519YaoSealableActiveClientV1,
} from '@/core/signingEngine/threshold/ed25519/yaoClient';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type { MpcMaterialActivationRef } from '@shared/utils/domainIds';
import type { LoadedWalletCustodyEd25519MaterialV1 } from './ed25519SeedMaterial';

/**
 * Turning the wallet's cached material back into a signing client.
 *
 * **Why the activation facts are a parameter and not fields on the record.**
 * Rebuilding the active-client metadata needs a material activation reference,
 * a transcript, a capability binding and a signing-root identity. None of them
 * are stored in the cache, on purpose: Invariant 11 gives that state exactly
 * one owner, and it is resolved per operation. A cache row that carried its
 * own copy would be a second source for an identity that must have one, and it
 * would outlive the operation it was minted for — the row survives across
 * sessions, and the authorization it described would not.
 *
 * So the caller brings them from the wallet session, and this assembles the
 * metadata. The record contributes key identity; the session contributes
 * permission. Keeping the seam here is what lets the cache be a cache.
 *
 * The factor secret is consumed: any factor that opens the wallet's custody
 * envelope opens this cache, because the ceremony sealed it under the seed
 * rather than under whichever factor happened to run registration.
 */

export type WalletCustodyActivationFactsV1 = {
  /** From the wallet session, per operation — never from the cached row. */
  readonly materialActivation: MpcMaterialActivationRef;
  readonly lifecycleId: string;
  readonly signingRootVersion: string;
  readonly signingRootId: string;
  readonly signerSetId: string;
  readonly thresholdSessionId: string;
  readonly activationTranscriptB64u: string;
  readonly activationCapabilityBindingB64u: string;
};

export function walletCustodyActivationFactsFromActiveClientMetadataV1(
  metadata: RouterAbEd25519YaoActiveClientMetadataV1,
): WalletCustodyActivationFactsV1 {
  return {
    materialActivation: metadata.materialActivation,
    lifecycleId: metadata.scope.lifecycle_id,
    signingRootVersion: metadata.scope.root_share_epoch,
    signingRootId: metadata.applicationBinding.signing_root_id,
    signerSetId: metadata.scope.signer_set_id,
    thresholdSessionId: metadata.scope.threshold_session_id,
    activationTranscriptB64u: base64UrlEncode(metadata.transcript),
    activationCapabilityBindingB64u: base64UrlEncode(
      Uint8Array.from(metadata.activeCapabilityBinding),
    ),
  };
}

export type WalletCustodyCacheEnvelopeV1 = {
  /** The custody envelope binding, as stored, serialized for the wasm side. */
  readonly bindingJson: string;
  readonly nonceB64u: string;
  readonly ciphertextB64u: string;
  readonly aadHashB64u: string;
  readonly ciphertextDigestB64u: string;
};

export function walletCustodyCacheEnvelopeFromRecordV1(
  envelope: PasskeyCustodyEnvelopeRecord,
): WalletCustodyCacheEnvelopeV1 {
  if (!isWalletCustodySeedBinding(envelope.binding)) {
    throw new Error('wallet custody cache accepts wallet custody seed envelopes only');
  }
  return {
    bindingJson: custodyEnvelopeBindingJsonV1(envelope),
    nonceB64u: envelope.nonceB64u,
    ciphertextB64u: envelope.sealedCustodySecretB64u,
    aadHashB64u: envelope.aadHashB64u,
    ciphertextDigestB64u: envelope.ciphertextDigestB64u,
  };
}

export function walletCustodyActiveClientMetadataV1(input: {
  readonly material: LoadedWalletCustodyEd25519MaterialV1;
  readonly activation: WalletCustodyActivationFactsV1;
}): RouterAbEd25519YaoActiveClientMetadataV1 {
  const { binding } = input.material;
  const { activation } = input;
  return {
    kind: ROUTER_AB_ED25519_YAO_ACTIVE_CLIENT_KIND_V1,
    scope: {
      lifecycle_id: activation.lifecycleId,
      root_share_epoch: activation.signingRootVersion,
      account_id: binding.walletId,
      threshold_session_id: activation.thresholdSessionId,
      signer_set_id: activation.signerSetId,
      signing_worker_id: binding.signingWorkerId,
      material_activation: routerAbMpcMaterialActivationRefToWire(activation.materialActivation),
    },
    applicationBinding: {
      wallet_id: binding.walletId,
      near_ed25519_signing_key_id: binding.nearEd25519SigningKeyId,
      signing_root_id: activation.signingRootId,
      key_creation_signer_slot: binding.signerSlot,
    },
    participantIds: binding.participantIds,
    registeredPublicKey: base64UrlDecode(binding.registeredPublicKeyB64u),
    signingWorkerVerifyingShare: base64UrlDecode(binding.signingWorkerVerifyingShareB64u),
    stateEpoch: BigInt(binding.stateEpoch),
    transcript: base64UrlDecode(activation.activationTranscriptB64u),
    activeCapabilityBinding: Array.from(
      base64UrlDecode(activation.activationCapabilityBindingB64u),
    ),
    materialActivation: activation.materialActivation,
  };
}

/**
 * The warm path: cached material plus any enrolled factor, no Router round.
 *
 * The factor secret is handed straight through to wasm, which zeroes it. It is
 * not copied here and nothing above this call keeps it — the seed it unwraps
 * lives for exactly one call inside the module.
 */
export async function openWalletCustodyEd25519ActiveClientV1(input: {
  readonly material: LoadedWalletCustodyEd25519MaterialV1;
  readonly activation: WalletCustodyActivationFactsV1;
  readonly envelope: WalletCustodyCacheEnvelopeV1;
  /** `PRF.first`, or the Email OTP factor key. Zeroed by the callee. */
  readonly ownedFactorSecret: Uint8Array;
}): Promise<RouterAbEd25519YaoSealableActiveClientV1> {
  const client = await RouterAbEd25519YaoClientV1.initializeBundled();
  return client.openCustodyCache(custodyCacheOpenInput(input));
}

function custodyCacheOpenInput(input: {
  readonly material: LoadedWalletCustodyEd25519MaterialV1;
  readonly activation: WalletCustodyActivationFactsV1;
  readonly envelope: WalletCustodyCacheEnvelopeV1;
  readonly ownedFactorSecret: Uint8Array;
}): Parameters<RouterAbEd25519YaoClientV1['openCustodyCache']>[0] {
  return {
    ownedFactorSecret: input.ownedFactorSecret,
    envelope: {
      bindingJson: input.envelope.bindingJson,
      nonce: base64UrlDecode(input.envelope.nonceB64u),
      ciphertext: base64UrlDecode(input.envelope.ciphertextB64u),
      aadHash: base64UrlDecode(input.envelope.aadHashB64u),
      ciphertextDigest: base64UrlDecode(input.envelope.ciphertextDigestB64u),
    },
    applicationBindingDigest: base64UrlDecode(input.material.binding.applicationBindingDigestB64u),
    sealed: {
      kind: 'router_ab_ed25519_yao_sealed_local_material_v1',
      nonce: base64UrlDecode(input.material.sealed.nonceB64u),
      ciphertext: base64UrlDecode(input.material.sealed.ciphertextB64u),
    },
    metadata: walletCustodyActiveClientMetadataV1({
      material: input.material,
      activation: input.activation,
    }),
  };
}

/** The server's current state of this key set, from the active capability. */
export type WalletCustodyCurrentSigningStateV1 = {
  readonly stateEpoch: number;
  readonly signingWorkerVerifyingShare: readonly number[];
};

type WalletCustodyUnlockResultV1 =
  | {
      readonly kind: 'opened';
      readonly activeClient: RouterAbEd25519YaoSealableActiveClientV1;
      /** The row re-bound to the current epoch; persist it in place of the old row. */
      readonly rebound: LoadedWalletCustodyEd25519MaterialV1 | null;
    }
  | { readonly kind: 'rejoin_required' };

/**
 * Opens the cached row for the server's current state epoch, or reports that
 * the key set must be rejoined.
 *
 * **The envelope is needed either way.** The custody seed is never stored — it
 * is re-derived by opening the envelope on every unlock, so a cache hit saves
 * the Router round, not the envelope.
 *
 * **An older row is re-bound, not rejoined.** A Router recovery — for example
 * a passkey login on another site, whose storage partition had no row — keeps
 * both shares and moves only the epoch. The row from the older epoch therefore
 * holds the current share. It is checked against the server's current
 * SigningWorker verifying share and sealed again under the current epoch, with
 * no Router round. The caller persists `rebound`.
 *
 * A missing or unusable row, or one newer than the server, needs a rejoin.
 * This layer does not perform it: rejoining runs a Router ceremony and needs
 * the step runner, the admission and the application facts this layer has no
 * business holding.
 */
export async function openOrRebindWalletCustodyEd25519V1(input: {
  readonly loadCachedMaterial: () => Promise<
    | { readonly kind: 'found'; readonly material: LoadedWalletCustodyEd25519MaterialV1 }
    | { readonly kind: 'absent' }
    | { readonly kind: 'unusable'; readonly reason: string }
  >;
  readonly activation: WalletCustodyActivationFactsV1;
  readonly envelope: WalletCustodyCacheEnvelopeV1;
  readonly ownedFactorSecret: Uint8Array;
  readonly current: WalletCustodyCurrentSigningStateV1;
}): Promise<WalletCustodyUnlockResultV1> {
  const cached = await input.loadCachedMaterial();
  const currentEpoch = BigInt(input.current.stateEpoch);
  const recordEpoch = cached.kind === 'found' ? BigInt(cached.material.binding.stateEpoch) : null;
  if (cached.kind !== 'found' || recordEpoch === null || recordEpoch > currentEpoch) {
    /* The factor secret is zeroed here because the callee that normally does
       it is never reached. A rejoin obtains its own. */
    input.ownedFactorSecret.fill(0);
    return { kind: 'rejoin_required' };
  }
  const material: LoadedWalletCustodyEd25519MaterialV1 = {
    binding: {
      ...cached.material.binding,
      stateEpoch: String(currentEpoch),
      signingWorkerVerifyingShareB64u: base64UrlEncode(
        Uint8Array.from(input.current.signingWorkerVerifyingShare),
      ),
    },
    sealed: cached.material.sealed,
  };
  const openInput = custodyCacheOpenInput({
    material,
    activation: input.activation,
    envelope: input.envelope,
    ownedFactorSecret: input.ownedFactorSecret,
  });
  const client = await RouterAbEd25519YaoClientV1.initializeBundled();
  if (recordEpoch === currentEpoch) {
    return { kind: 'opened', activeClient: client.openCustodyCache(openInput), rebound: null };
  }
  const rebound = client.rebindCustodyCache({ ...openInput, oldStateEpoch: recordEpoch });
  return {
    kind: 'opened',
    activeClient: rebound.activeClient,
    rebound: { binding: material.binding, sealed: rebound.sealed },
  };
}
