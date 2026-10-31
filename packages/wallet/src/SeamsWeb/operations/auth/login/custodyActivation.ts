import type { LoginUnlockSigningSurface } from '@/SeamsWeb/signingSurface/types';
import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import {
  parseThresholdEd25519SessionId,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import { type WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import { IndexedDBManager } from '@/core/indexedDB';
import { readActivePasskeyAuthorityForRecovery } from '@/SeamsWeb/operations/authMethods/passkey/exactPasskeyAuthority';
import {
  type PasskeySessionEcdsaCustodyContinuityV1,
  type PasskeySessionCustodyUnlockV1,
} from '@/core/rpcClients/near/rpcCalls';
import { persistPasskeyEd25519YaoSignerMaterialV1 } from '@/core/signingEngine/session/passkey/ed25519YaoLocalMaterial';
import {
  buildPasskeyEd25519RestoreMetadata,
  persistPasskeyEd25519YaoSessionForRefresh,
} from '@/core/signingEngine/session/passkey/ed25519YaoSealedSession';
import { buildPasskeyRouterAbEd25519WalletSessionState } from '@/core/signingEngine/session/warmCapabilities/routerAbEd25519WalletSessionState';
import { buildRouterAbEd25519SigningWalletSession } from '@/core/signingEngine/session/routerAbSigningWalletSession';
import {
  sameRouterAbEcdsaDerivationPublicCapabilityV1,
  sameRouterAbEcdsaRegistrationActivationReceiptV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { createRouterAbNormalSigningPolicy } from '@/SeamsWeb/operations/session/thresholdWarmSessionBootstrap';
import {
  deriveEvmFamilySigningKeySlotId,
  toRpId,
} from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import { nearEd25519SignerBindingFromBoundaryFields } from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { base58Encode } from '@shared/utils/base58';
import {
  openWalletCustodyEd25519ActiveClientV1,
  walletCustodyActivationFactsFromActiveClientMetadataV1,
  walletCustodyCacheEnvelopeFromRecordV1,
  type WalletCustodyActivationFactsV1,
} from '@/core/signingEngine/walletCustody/openCustodyCache';
import { joinCustodyWireFromEnvelopeRecord } from '@/core/signingEngine/walletCustody/joinCustodyWire';
import {
  WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND,
  type WalletCustodyEd25519MaterialBindingV1,
} from '@/core/signingEngine/walletCustody/ed25519SeedMaterial';
import type {
  ActivePasskeySessionCustodyUnlockV1,
  LoginWarmEd25519Session,
} from './unlockPlanning';
import type { ResolvedLoginWalletBinding } from './identity';
import {
  sameThresholdRuntimePolicyScope,
  ethereumAddressFromEcdsaIdentityB64u,
  assertRejoinedPasskeyEcdsaPublicFacts,
} from './signerState';

type PasskeyEd25519CustodyLoginInput = {
  signingEngine: LoginUnlockSigningSurface;
  custody: ActivePasskeySessionCustodyUnlockV1;
  walletBinding: ResolvedLoginWalletBinding;
  signerSlot: number;
  passkeyPrfFirstB64u: string;
  walletSession: LoginWarmEd25519Session;
  authority: WalletAuthAuthorityRef;
  routerAbNormalSigning: ReturnType<typeof createRouterAbNormalSigningPolicy>;
  relayerUrl: string;
};

export type PasskeyEd25519CustodyLoginOutcome =
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'recovered';
      readonly materialActivation: MpcMaterialActivationRef;
      readonly previousAuthority: ActiveWalletAuthorityV1;
    };

function requireLoginWarmEd25519OperationCredential(
  session: LoginWarmEd25519Session,
): WalletSessionOperationCredentialV1 {
  if ('operationCredential' in session) return session.operationCredential;
  throw new Error(
    '[login] wallet custody Ed25519 activation requires the exact issued operation credential',
  );
}

async function ensurePasskeyEd25519OwnerProfile(
  input: Pick<PasskeyEd25519CustodyLoginInput, 'signingEngine' | 'walletBinding' | 'signerSlot'> & {
    readonly credentialIdB64u: string;
    readonly registeredPublicKey: Uint8Array;
  },
): Promise<void> {
  const existing = await input.signingEngine
    .getUserBySignerSlot(input.walletBinding.nearAccountId, input.signerSlot)
    .catch(() => null);
  if (existing) {
    if (
      existing.walletId !== String(input.walletBinding.walletId) ||
      existing.nearEd25519SigningKeyId !== String(input.walletBinding.nearEd25519SigningKeyId) ||
      existing.signerSlot !== input.signerSlot
    ) {
      throw new Error('[login] local Ed25519 owner profile identity is invalid');
    }
    return;
  }
  await input.signingEngine.storeUserData({
    walletId: String(input.walletBinding.walletId),
    nearAccountId: input.walletBinding.nearAccountId,
    nearEd25519SigningKeyId: String(input.walletBinding.nearEd25519SigningKeyId),
    signerSlot: input.signerSlot,
    operationalPublicKey: `ed25519:${base58Encode(input.registeredPublicKey)}`,
    passkeyCredential: {
      id: input.credentialIdB64u,
      rawId: input.credentialIdB64u,
    },
    lastUpdated: Date.now(),
    version: 2,
  });
}

function walletCustodyLoginActivationFacts(
  custody: ActivePasskeySessionCustodyUnlockV1,
  thresholdSessionId: string,
): WalletCustodyActivationFactsV1 {
  const capability = custody.ed25519.capability;
  const continuity = capability.registrationContinuity;
  return {
    materialActivation: capability.materialActivation,
    lifecycleId: capability.lifecycle.lifecycleId,
    signingRootVersion: capability.lifecycle.rootShareEpoch,
    signingRootId: capability.applicationBinding.signing_root_id,
    signerSetId: capability.lifecycle.signerSetId,
    thresholdSessionId,
    activationTranscriptB64u: base64UrlEncode(Uint8Array.from(continuity.activationTranscript)),
    activationCapabilityBindingB64u: base64UrlEncode(
      Uint8Array.from(capability.activeCapabilityBinding),
    ),
  };
}

function assertWalletCustodyLoginIdentity(input: PasskeyEd25519CustodyLoginInput): void {
  const ed25519 = input.custody.ed25519;
  const capability = ed25519.capability;
  if (
    ed25519.nearAccountId !== String(input.walletBinding.nearAccountId) ||
    ed25519.nearEd25519SigningKeyId !== String(input.walletBinding.nearEd25519SigningKeyId) ||
    ed25519.signerSlot !== input.signerSlot ||
    capability.applicationBinding.wallet_id !== String(input.walletBinding.walletId) ||
    capability.applicationBinding.near_ed25519_signing_key_id !==
      String(input.walletBinding.nearEd25519SigningKeyId) ||
    capability.applicationBinding.key_creation_signer_slot !== input.signerSlot ||
    capability.nearAccountId !== input.walletBinding.nearAccountId ||
    capability.lifecycle.accountId !== String(input.walletBinding.walletId) ||
    capability.lifecycle.signingWorkerId !== ed25519.relayerKeyId
  ) {
    throw new Error('[login] wallet custody identity does not match the selected signing lane');
  }
}

export async function openAndActivatePasskeyEd25519CustodyLogin(
  input: PasskeyEd25519CustodyLoginInput,
): Promise<PasskeyEd25519CustodyLoginOutcome> {
  assertWalletCustodyLoginIdentity(input);
  const capability = input.custody.ed25519.capability;
  const cached = await input.signingEngine.loadWalletCustodyEd25519Material({
    nearAccountId: String(input.walletBinding.nearAccountId),
    signerSlot: input.signerSlot,
    expectedRegisteredPublicKeyB64u: base64UrlEncode(
      Uint8Array.from(capability.registeredPublicKey),
    ),
  });
  const thresholdSessionId = parseThresholdEd25519SessionId(input.walletSession.thresholdSessionId);
  if (!thresholdSessionId.ok) {
    throw new Error('[login] wallet custody returned an invalid threshold session identity');
  }
  const activation = walletCustodyLoginActivationFacts(input.custody, thresholdSessionId.value);
  const envelope = walletCustodyCacheEnvelopeFromRecordV1(input.custody.envelope);
  const previousAuthority = await readActivePasskeyAuthorityForRecovery({
    walletId: input.walletBinding.walletId,
    authMethodId: input.authority.walletAuthMethodId,
  });
  let activeClient: Awaited<ReturnType<typeof openWalletCustodyEd25519ActiveClientV1>> | null =
    null;
  let rejoinSecret: Uint8Array<ArrayBuffer> | null = null;
  let openSecret: Uint8Array | null = null;
  try {
    if (cached.kind === 'found') {
      openSecret = base64UrlDecode(input.passkeyPrfFirstB64u);
      activeClient = await openWalletCustodyEd25519ActiveClientV1({
        material: cached.material,
        activation,
        envelope,
        ownedFactorSecret: openSecret,
      });
    } else {
      const custodyWire = joinCustodyWireFromEnvelopeRecord(input.custody.envelope);
      if (!custodyWire.ok) throw new Error(custodyWire.reason);
      rejoinSecret = base64UrlDecode(input.passkeyPrfFirstB64u);
      openSecret = base64UrlDecode(input.passkeyPrfFirstB64u);
      const rejoined = await input.signingEngine.rejoinWalletCustodyNearEd25519KeySet({
        walletId: String(input.walletBinding.walletId),
        custodyJson: custodyWire.custodyJson,
        factorSecret: rejoinSecret.buffer,
        nearEd25519SigningKeyId: String(input.walletBinding.nearEd25519SigningKeyId),
        recoveryBasis: capability,
        routerOrigin: new URL(input.relayerUrl).origin,
        walletSessionToken: requireLoginWarmEd25519OperationCredential(input.walletSession).token,
      });
      const materialBinding: WalletCustodyEd25519MaterialBindingV1 = {
        kind: WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND,
        applicationBindingDigestB64u: rejoined.localMaterial.applicationBindingDigestB64u,
        registeredPublicKeyB64u: base64UrlEncode(rejoined.metadata.registeredPublicKey),
        participantIds: rejoined.metadata.participantIds,
        stateEpoch: String(rejoined.metadata.stateEpoch),
        walletId: String(input.walletBinding.walletId),
        nearAccountId: String(input.walletBinding.nearAccountId),
        nearEd25519SigningKeyId: String(input.walletBinding.nearEd25519SigningKeyId),
        signerSlot: input.signerSlot,
        signingWorkerId: input.custody.ed25519.relayerKeyId,
        signingWorkerVerifyingShareB64u: base64UrlEncode(
          rejoined.metadata.signingWorkerVerifyingShare,
        ),
      };
      const sealed = {
        ciphertextB64u: rejoined.localMaterial.b64u,
        nonceB64u: rejoined.localMaterial.nonceB64u,
      };
      try {
        await input.signingEngine.persistWalletCustodyEd25519Material({
          binding: materialBinding,
          sealed,
        });
      } catch (error) {
        console.warn(
          '[login] wallet custody cache write failed; continuing with verified material',
          {
            error,
          },
        );
      }
      activeClient = await openWalletCustodyEd25519ActiveClientV1({
        material: { binding: materialBinding, sealed },
        activation: walletCustodyActivationFactsFromActiveClientMetadataV1(rejoined.metadata),
        envelope,
        ownedFactorSecret: openSecret,
      });
    }
    if (!activeClient) throw new Error('[login] wallet custody produced no active client');
    const recoveredThresholdSessionId = parseThresholdEd25519SessionId(
      activeClient.metadata().scope.threshold_session_id,
    );
    if (!recoveredThresholdSessionId.ok) {
      throw new Error('[login] wallet custody returned an invalid threshold session identity');
    }
    if (recoveredThresholdSessionId.value !== input.walletSession.thresholdSessionId) {
      throw new Error('[login] wallet custody changed the threshold session identity');
    }
    const envelopeFactor = input.custody.envelope.factor;
    if (envelopeFactor.kind !== 'passkey') {
      throw new Error('[login] wallet custody returned a different factor authority');
    }
    await ensurePasskeyEd25519OwnerProfile({
      signingEngine: input.signingEngine,
      walletBinding: input.walletBinding,
      signerSlot: input.signerSlot,
      credentialIdB64u: envelopeFactor.credentialIdB64u,
      registeredPublicKey: activeClient.metadata().registeredPublicKey,
    });
    await persistPasskeyEd25519YaoSignerMaterialV1({
      store: IndexedDBManager,
      activeClient,
      identity: {
        walletId: String(input.walletBinding.walletId),
        nearAccountId: String(input.walletBinding.nearAccountId),
        nearEd25519SigningKeyId: String(input.walletBinding.nearEd25519SigningKeyId),
        thresholdSessionId: recoveredThresholdSessionId.value,
        signerSlot: input.signerSlot,
        rpId: envelopeFactor.rpId,
        credentialIdB64u: envelopeFactor.credentialIdB64u,
        signingRootId: capability.applicationBinding.signing_root_id,
        signingRootVersion: capability.lifecycle.rootShareEpoch,
        signingWorkerId: input.custody.ed25519.relayerKeyId,
      },
      stableServerScope: {
        relayerKeyId: input.custody.ed25519.relayerKeyId,
        participantIds: input.custody.ed25519.participantIds,
        runtimePolicyScope: capability.runtimePolicyScope,
        routerAbNormalSigning: input.routerAbNormalSigning,
      },
      passkeyPrfFirstB64u: input.passkeyPrfFirstB64u,
    });
    const activated = await input.signingEngine.activateVerifiedNearEd25519YaoMaterial({
      activeClient,
      facts: {
        thresholdSessionId: recoveredThresholdSessionId.value,
        signer: nearEd25519SignerBindingFromBoundaryFields({
          walletId: input.walletBinding.walletId,
          nearAccountId: input.walletBinding.nearAccountId,
          nearEd25519SigningKeyId: input.walletBinding.nearEd25519SigningKeyId,
          signerSlot: input.signerSlot,
        }),
        signingRootId: capability.applicationBinding.signing_root_id,
        signingRootVersion: capability.lifecycle.rootShareEpoch,
        routerAbNormalSigning: input.routerAbNormalSigning,
        runtimePolicyScope: capability.runtimePolicyScope,
        relayerUrl: input.relayerUrl,
      },
    });
    const signingWalletSession = buildRouterAbEd25519SigningWalletSession({
      walletId: String(input.walletBinding.walletId),
      nearAccountId: String(input.walletBinding.nearAccountId),
      nearEd25519SigningKeyId: String(input.walletBinding.nearEd25519SigningKeyId),
      walletSessionId: input.walletSession.walletSessionId,
      authorizationId: input.walletSession.authorizationId,
      quotaId: input.walletSession.quotaId,
      thresholdSessionId: recoveredThresholdSessionId.value,
      remainingUses: input.walletSession.remainingUses,
      expiresAtMs: input.walletSession.expiresAtMs,
      runtimePolicyScope: input.walletSession.runtimePolicyScope,
      signingRootId: capability.applicationBinding.signing_root_id,
      signingRootVersion: capability.lifecycle.rootShareEpoch,
      routerAbNormalSigning: input.routerAbNormalSigning,
      walletSessionToken: requireLoginWarmEd25519OperationCredential(input.walletSession).token,
      home: requireLoginWarmEd25519OperationCredential(input.walletSession).home,
      nowMs: Math.min(Date.now(), input.walletSession.expiresAtMs - 1),
    });
    if (!signingWalletSession.ok) {
      throw new Error(
        `[login] wallet custody returned an unusable Ed25519 Wallet Session: ${signingWalletSession.reason}`,
      );
    }
    const session = buildPasskeyRouterAbEd25519WalletSessionState({
      walletId: input.walletBinding.walletId,
      nearAccountId: input.walletBinding.nearAccountId,
      nearEd25519SigningKeyId: input.walletBinding.nearEd25519SigningKeyId,
      signerSlot: input.signerSlot,
      rpId: toRpId(envelopeFactor.rpId),
      credentialIdB64u: envelopeFactor.credentialIdB64u,
      relayerUrl: input.relayerUrl,
      authority: input.authority,
      signingWalletSession: signingWalletSession.value,
    });
    await persistPasskeyEd25519YaoSessionForRefresh({
      persistence: input.signingEngine,
      session,
      prfFirstB64u: input.passkeyPrfFirstB64u,
      ed25519Restore: buildPasskeyEd25519RestoreMetadata({
        rpId: envelopeFactor.rpId,
        nearAccountId: String(input.walletBinding.nearAccountId),
        nearEd25519SigningKeyId: String(input.walletBinding.nearEd25519SigningKeyId),
        relayerKeyId: input.custody.ed25519.relayerKeyId,
        participantIds: input.custody.ed25519.participantIds,
        runtimePolicyScope: input.walletSession.runtimePolicyScope,
        signerSlot: input.signerSlot,
        routerAbNormalSigning: input.routerAbNormalSigning,
        credentialIdB64u: envelopeFactor.credentialIdB64u,
        materialActivation: activated.materialActivation,
      }),
      materialActivation: activated.materialActivation,
    });
    /* The passkey factor was presented for this unlock and the owner Wallet
       Session persisted above is active, so this is where the linking
       capability is established — the linking flow itself never prompts and
       never opens the envelope again. Runs last: everything above has
       succeeded, so a failed unlock never leaves a capability. */
    await input.signingEngine.establishUnlockedWalletEd25519ExportRootCapabilityV1({
      existingEnvelope: input.custody.envelope,
      passkeyPrfFirstB64u: input.passkeyPrfFirstB64u,
      walletId: String(input.walletBinding.walletId),
      walletAuthMethodId: String(input.authority.walletAuthMethodId),
      walletSessionId: String(input.walletSession.walletSessionId),
      expiresAtMs: input.walletSession.expiresAtMs,
    });
    return cached.kind === 'found'
      ? { kind: 'unchanged' }
      : { kind: 'recovered', materialActivation: activated.materialActivation, previousAuthority };
  } catch (error) {
    activeClient?.dispose();
    throw error;
  } finally {
    rejoinSecret?.fill(0);
    openSecret?.fill(0);
  }
}

function nonEmptyEcdsaCustodyChainTargets(
  signers: readonly PasskeySessionEcdsaCustodyContinuityV1['signers'][number][],
): readonly [
  PasskeySessionEcdsaCustodyContinuityV1['signers'][number]['chainTarget'],
  ...PasskeySessionEcdsaCustodyContinuityV1['signers'][number]['chainTarget'][],
] {
  const [first, ...rest] = signers;
  if (!first) throw new Error('[login] passkey ECDSA custody continuity is empty');
  return [first.chainTarget, ...rest.map((signer) => signer.chainTarget)];
}

export async function restorePasskeyEcdsaCustodyLogin(input: {
  readonly signingEngine: LoginUnlockSigningSurface;
  readonly walletId: string;
  readonly custody: PasskeySessionCustodyUnlockV1;
  readonly continuity: PasskeySessionEcdsaCustodyContinuityV1;
  readonly authority: WalletAuthAuthorityRef;
  readonly passkeyPrfFirstB64u: string;
}): Promise<void> {
  const first = input.continuity.signers[0];
  if (!first) throw new Error('[login] passkey ECDSA custody continuity is empty');
  if (first.walletKey.walletId !== input.walletId) {
    throw new Error('[login] passkey ECDSA custody continuity changed wallet identity');
  }
  for (const signer of input.continuity.signers) {
    if (
      signer.walletKey.walletId !== first.walletKey.walletId ||
      signer.walletKey.keyHandle !== first.walletKey.keyHandle ||
      signer.walletKey.ecdsaThresholdKeyId !== first.walletKey.ecdsaThresholdKeyId ||
      signer.walletKey.signingRootId !== first.walletKey.signingRootId ||
      signer.walletKey.signingRootVersion !== first.walletKey.signingRootVersion ||
      signer.walletKey.relayerKeyId !== first.walletKey.relayerKeyId ||
      !sameRouterAbEcdsaDerivationPublicCapabilityV1(
        signer.walletKey.publicCapability,
        first.walletKey.publicCapability,
      ) ||
      !sameRouterAbEcdsaRegistrationActivationReceiptV1(
        signer.activationReceipt,
        first.activationReceipt,
      ) ||
      !sameThresholdRuntimePolicyScope(signer.runtimePolicyScope, first.runtimePolicyScope)
    ) {
      throw new Error('[login] passkey ECDSA custody continuity conflicts across targets');
    }
  }
  const custodyWire = joinCustodyWireFromEnvelopeRecord(input.custody.envelope);
  if (!custodyWire.ok) throw new Error(custodyWire.reason);
  const factorSecret = base64UrlDecode(input.passkeyPrfFirstB64u);
  try {
    const rejoined = await input.signingEngine.rejoinWalletCustodyEvmFamilyKeySet({
      walletId: input.walletId,
      custodyJson: custodyWire.custodyJson,
      factorSecret: factorSecret.buffer,
      evmFamilySigningKeySlotId: deriveEvmFamilySigningKeySlotId({
        walletId: input.walletId,
        signingRootId: first.walletKey.signingRootId,
        signingRootVersion: first.walletKey.signingRootVersion,
      }),
      applicationBindingDigestB64u:
        first.walletKey.publicCapability.context.application_binding_digest_b64u,
      registeredClientRootPublicKey33B64u: first.walletKey.derivationClientSharePublicKey33B64u,
      relayerPublicIdentityJson: JSON.stringify({
        relayerKeyId: first.walletKey.relayerKeyId,
        relayerPublicKey33B64u:
          first.activationReceipt.ecdsa_activation.public_identity.server_public_key33_b64u,
        groupPublicKey33B64u:
          first.activationReceipt.ecdsa_activation.public_identity.threshold_public_key33_b64u,
        ethereumAddress: ethereumAddressFromEcdsaIdentityB64u(
          first.activationReceipt.ecdsa_activation.public_identity.ethereum_address20_b64u,
        ),
        relayerShareRetryCounter:
          first.activationReceipt.ecdsa_activation.public_identity.server_share_retry_counter,
      }),
    });
    assertRejoinedPasskeyEcdsaPublicFacts({
      publicFacts: rejoined.publicFacts,
      signer: first,
    });
    await input.signingEngine.restoreWalletCustodyEcdsaContinuity({
      authority: input.authority,
      chainTargets: nonEmptyEcdsaCustodyChainTargets(input.continuity.signers),
      walletId: first.walletKey.walletId,
      keyHandle: first.walletKey.keyHandle,
      ecdsaThresholdKeyId: first.walletKey.ecdsaThresholdKeyId,
      signingRootId: first.walletKey.signingRootId,
      signingRootVersion: first.walletKey.signingRootVersion,
      relayerKeyId: first.walletKey.relayerKeyId,
      participantIds: first.walletKey.participantIds,
      publicCapability: first.walletKey.publicCapability,
      activationReceipt: first.activationReceipt,
      runtimePolicyScope: first.runtimePolicyScope,
      readyStateBlobB64u: rejoined.readyStateBlobB64u,
      publicFacts: rejoined.publicFacts,
    });
  } finally {
    factorSecret.fill(0);
  }
}
