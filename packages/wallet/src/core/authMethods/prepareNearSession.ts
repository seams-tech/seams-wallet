import type { AuthMethodSessionInstaller } from './hostPlugin';
import type { resolveAuthMethodSessionIdentity } from './sessionIdentity';
import type {
  LoadedWalletCustodyEd25519MaterialV1,
  LoadWalletCustodyEd25519MaterialResultV1,
} from '@/core/signingEngine/walletCustody/ed25519SeedMaterial';
import {
  openOrRebindWalletCustodyEd25519V1,
  walletCustodyCacheEnvelopeFromRecordV1,
} from '@/core/signingEngine/walletCustody/openCustodyCache';
import { buildOwnerRouterAbEd25519WalletSessionState } from '@/core/signingEngine/session/warmCapabilities/routerAbEd25519WalletSessionState';
import { buildRouterAbEd25519SigningWalletSession } from '@/core/signingEngine/session/routerAbSigningWalletSession';
import { base64UrlEncode } from '@shared/utils/base64';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import { nearEd25519SigningKeyIdFromString } from '@shared/utils/registrationIds';
import { ROUTER_AB_ED25519_NORMAL_SIGNING_STATE_KIND } from '@shared/utils/signingSessionSeal';
import { NEAR_CUSTODY_UNAVAILABLE_MESSAGE } from '@shared/utils/errors';

export async function prepareAuthMethodNearSession(input: {
  readonly unlocked: Parameters<AuthMethodSessionInstaller>[0];
  readonly identity: Awaited<ReturnType<typeof resolveAuthMethodSessionIdentity>>;
  readonly relayerUrl: string;
  readonly loadMaterial: (input: {
    nearAccountId: string;
    signerSlot: number;
    expectedRegisteredPublicKeyB64u: string;
  }) => Promise<LoadWalletCustodyEd25519MaterialResultV1>;
  /** Writes a row re-bound to the current epoch; a failure costs the next unlock a re-bind. */
  readonly persistMaterial: (material: LoadedWalletCustodyEd25519MaterialV1) => Promise<void>;
}) {
  const { walletSession, operationCredential, custodyEnvelope, near, signal } = input.unlocked;
  if (signal.aborted) throw new Error('Wallet unlock was cancelled.');
  if (near.kind !== 'ready') throw new Error('This wallet has no active NEAR signer.');
  const { method, authority, ref } = input.identity;
  const cap = near.capability;
  if (
    !authority.signerActivations.ed25519 ||
    !mpcMaterialActivationRefsEqual(
      authority.signerActivations.ed25519.materialActivation,
      cap.materialActivation,
    ) ||
    cap.applicationBinding.wallet_id !== walletSession.walletId
  ) {
    throw new Error('NEAR capability does not match the Wallet Session authority.');
  }
  const loaded = await input.loadMaterial({
    nearAccountId: cap.nearAccountId,
    signerSlot: cap.applicationBinding.key_creation_signer_slot,
    expectedRegisteredPublicKeyB64u: base64UrlEncode(Uint8Array.from(cap.registeredPublicKey)),
  });
  if (
    loaded.kind === 'found' &&
    (loaded.material.binding.walletId !== walletSession.walletId ||
      loaded.material.binding.nearEd25519SigningKeyId !==
        cap.applicationBinding.near_ed25519_signing_key_id ||
      loaded.material.binding.signingWorkerId !== cap.lifecycle.signingWorkerId)
  ) {
    throw new Error('Cached NEAR custody belongs to another material activation.');
  }
  const factor = input.unlocked.factorSecret32.slice();
  const opened = await openOrRebindWalletCustodyEd25519V1({
    loadCachedMaterial: async () => loaded,
    envelope: walletCustodyCacheEnvelopeFromRecordV1(custodyEnvelope),
    ownedFactorSecret: factor,
    current: cap,
    activation: {
      materialActivation: cap.materialActivation,
      lifecycleId: cap.lifecycle.lifecycleId,
      signingRootId: cap.applicationBinding.signing_root_id,
      signingRootVersion: cap.lifecycle.rootShareEpoch,
      signerSetId: cap.lifecycle.signerSetId,
      thresholdSessionId: cap.lifecycle.thresholdSessionId,
      activationTranscriptB64u: base64UrlEncode(
        Uint8Array.from(cap.registrationContinuity.activationTranscript),
      ),
      activationCapabilityBindingB64u: base64UrlEncode(
        Uint8Array.from(cap.activeCapabilityBinding),
      ),
    },
  }).finally(factor.fill.bind(factor, 0));
  if (opened.kind !== 'opened') throw new Error(NEAR_CUSTODY_UNAVAILABLE_MESSAGE);
  const activeClient = opened.activeClient;
  if (opened.rebound) {
    await input.persistMaterial(opened.rebound).catch((error: unknown) => {
      console.warn('[voiceid] wallet custody cache write failed; continuing', { error });
    });
  }
  try {
    if (signal.aborted) throw new Error('Wallet unlock was cancelled.');
    const signingSession = buildRouterAbEd25519SigningWalletSession({
      walletId: walletSession.walletId,
      nearAccountId: cap.nearAccountId,
      nearEd25519SigningKeyId: cap.applicationBinding.near_ed25519_signing_key_id,
      walletSessionId: operationCredential.walletSessionId,
      authorizationId: walletSession.authorizationId,
      quotaId: walletSession.quotaId,
      thresholdSessionId: cap.lifecycle.thresholdSessionId,
      expiresAtMs: walletSession.expiresAtMs,
      remainingUses: near.remainingUses,
      runtimePolicyScope: cap.runtimePolicyScope,
      signingRootId: cap.applicationBinding.signing_root_id,
      signingRootVersion: cap.lifecycle.rootShareEpoch,
      routerAbNormalSigning: {
        kind: ROUTER_AB_ED25519_NORMAL_SIGNING_STATE_KIND,
        signingWorkerId: cap.lifecycle.signingWorkerId,
      },
      walletSessionToken: operationCredential.token,
      home: operationCredential.home,
      nowMs: Date.now(),
    });
    if (!signingSession.ok)
      throw new Error(`NEAR Wallet Session is invalid: ${signingSession.reason}`);
    const state = buildOwnerRouterAbEd25519WalletSessionState({
      walletId: walletSession.walletId,
      nearAccountId: cap.nearAccountId,
      nearEd25519SigningKeyId: nearEd25519SigningKeyIdFromString(
        cap.applicationBinding.near_ed25519_signing_key_id,
      ),
      signerSlot: cap.applicationBinding.key_creation_signer_slot,
      auth: {
        kind: 'voiceid',
        walletAuthMethodId: method.walletAuthMethodId,
        deviceKeyId: method.deviceKeyId,
      },
      authority: ref,
      relayerUrl: input.relayerUrl,
      signingWalletSession: signingSession.value,
    });
    return { activeClient, state, capability: cap };
  } catch (error) {
    activeClient.dispose();
    throw error;
  }
}
