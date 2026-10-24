import type { AuthMethodSessionInstaller } from './hostPlugin';
import { IndexedDBManager } from '@/core/indexedDB';
import type { LoadWalletCustodyEd25519MaterialResultV1 } from '@/core/signingEngine/walletCustody/ed25519SeedMaterial';
import {
  openWalletCustodyEd25519ActiveClientV1,
  walletCustodyCacheEnvelopeFromRecordV1,
} from '@/core/signingEngine/walletCustody/openCustodyCache';
import { buildOwnerRouterAbEd25519WalletSessionState } from '@/core/signingEngine/session/warmCapabilities/routerAbEd25519WalletSessionState';
import { buildRouterAbEd25519SigningWalletSession } from '@/core/signingEngine/session/routerAbSigningWalletSession';
import {
  buildVoiceIdWalletAuthAuthority,
  walletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import { base64UrlEncode } from '@shared/utils/base64';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import { nearEd25519SigningKeyIdFromString } from '@shared/utils/registrationIds';
import { ROUTER_AB_ED25519_NORMAL_SIGNING_STATE_KIND } from '@shared/utils/signingSessionSeal';

export async function prepareAuthMethodNearSession(input: {
  readonly unlocked: Parameters<AuthMethodSessionInstaller>[0];
  readonly relayerUrl: string;
  readonly loadMaterial: (input: {
    nearAccountId: string;
    signerSlot: number;
    expectedRegisteredPublicKeyB64u: string;
  }) => Promise<LoadWalletCustodyEd25519MaterialResultV1>;
}) {
  const { walletSession, operationCredential, custodyEnvelope, near, signal } = input.unlocked;
  if (signal.aborted) throw new Error('Wallet unlock was cancelled.');
  if (near.kind !== 'ready') throw new Error('This wallet has no active NEAR signer.');
  const method = await IndexedDBManager.getWalletAuthMethodV2(walletSession.authMethodId);
  const authority = await IndexedDBManager.getWalletAuthority(walletSession.authorityId);
  const cap = near.capability;
  if (
    !method ||
    method.kind !== 'voiceid' ||
    method.status !== 'active' ||
    method.walletId !== walletSession.walletId ||
    method.walletAuthorityId !== walletSession.authorityId ||
    !authority ||
    authority.state !== 'active' ||
    authority.walletId !== walletSession.walletId ||
    authority.authorityDigestB64u !== walletSession.authorityDigestB64u ||
    authority.revocationEpoch !== walletSession.authorityRevocationEpoch ||
    !authority.signerActivations.ed25519 ||
    !mpcMaterialActivationRefsEqual(
      authority.signerActivations.ed25519.materialActivation,
      cap.materialActivation,
    ) ||
    custodyEnvelope.walletId !== walletSession.walletId ||
    custodyEnvelope.ownership.walletAuthMethodId !== method.walletAuthMethodId ||
    custodyEnvelope.factor.kind !== 'voiceid' ||
    custodyEnvelope.factor.deviceKeyId !== method.deviceKeyId ||
    cap.applicationBinding.wallet_id !== walletSession.walletId
  ) {
    throw new Error('Wallet Session, device method, and NEAR custody do not match.');
  }
  const loaded = await input.loadMaterial({
    nearAccountId: cap.nearAccountId,
    signerSlot: cap.applicationBinding.key_creation_signer_slot,
    expectedRegisteredPublicKeyB64u: base64UrlEncode(Uint8Array.from(cap.registeredPublicKey)),
  });
  if (loaded.kind !== 'found')
    throw new Error(
      'Unlock with a passkey or Email OTP once to restore NEAR custody on this device.',
    );
  if (
    loaded.material.binding.walletId !== walletSession.walletId ||
    loaded.material.binding.nearEd25519SigningKeyId !==
      cap.applicationBinding.near_ed25519_signing_key_id ||
    loaded.material.binding.signingWorkerId !== cap.lifecycle.signingWorkerId ||
    loaded.material.binding.stateEpoch !== String(cap.stateEpoch)
  ) {
    throw new Error('Cached NEAR custody belongs to another material activation.');
  }
  const factor = input.unlocked.factorSecret32.slice();
  const activeClient = await openWalletCustodyEd25519ActiveClientV1({
    material: loaded.material,
    envelope: walletCustodyCacheEnvelopeFromRecordV1(custodyEnvelope),
    ownedFactorSecret: factor,
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
    const ref = await walletAuthAuthorityRef({
      authority: buildVoiceIdWalletAuthAuthority({
        walletId: method.walletId,
        walletAuthMethodId: method.walletAuthMethodId,
        deviceKeyId: method.deviceKeyId,
      }),
    });
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
