import { scheduleLinkedDevicePresignaturePrefill } from '../scheduleLinkedDevicePresignaturePrefill';
import type { LoginResult } from '@/core/types/seams';
import type { LoginWebContext } from '@/SeamsWeb/signingSurface/types';
import { toAccountId } from '@/core/types/accountIds';
import { isWalletCustodySeedBinding } from '@shared/passkey-custody/custodySecretBinding';
import { secureRandomId } from '@shared/utils/secureRandomId';
import { isObject } from '@shared/utils/validation';
import type {
  ActiveWalletSessionV1,
  WalletSessionOperationCredentialV1,
} from '@shared/device-linking';
import {
  mpcMaterialActivationRefsEqual,
  parseThresholdEd25519SessionId,
  type ThresholdEd25519SessionId,
  type WalletAuthMethodId,
} from '@shared/utils/domainIds';
import {
  parseMpcWalletSigningQuotaId,
  parseWalletSessionAuthorizationId,
  parseWalletSessionId,
  type MpcWalletSigningQuotaId,
  type WalletSessionAuthorizationId,
  type WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import {
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1,
  parseRouterAbEd25519YaoWarmRecoveryBootstrapRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  parseRouterAbEd25519NormalSigningState,
  type RouterAbEd25519NormalSigningState,
} from '@shared/utils/signingSessionSeal';
import {
  walletAuthAuthorityRef,
  type WalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import { IndexedDBManager } from '@/core/indexedDB';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { type PasskeyWalletUnlockEd25519Session } from '@/core/rpcClients/near/rpcCalls';
import type { WalletRegistrationEd25519YaoSignerRuntimeBootstrap } from '@shared/utils/registrationContracts';
import {
  ROUTER_AB_ED25519_YAO_ACTIVE_CLIENT_KIND_V1,
  RouterAbEd25519YaoClientV1,
  type RouterAbEd25519YaoActiveClientMetadataV1,
} from '@/core/signingEngine/threshold/ed25519/yaoClient';
import {
  IndexedDbEd25519YaoPublicCapabilityReferenceStore,
  publishEd25519YaoPublicCapabilityReferenceAndLane,
  type Ed25519YaoPublicCapabilityLaneReferenceV1,
} from '@/core/signingEngine/threshold/ed25519/yaoPublicCapabilityReferences';
import { nearEd25519SigningKeyIdFromString } from '@shared/utils/registrationIds';
import { type ThresholdRuntimePolicyScope } from '@/core/signingEngine/threshold/sessionPolicy';
import {
  establishUnlockedWalletEd25519ExportRootCapabilityV1 as establishUnlockedExportRootCapabilityV1,
  walletCustodyCeremonyTransportFromWorkerContextV1,
} from '@/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';
import { type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toRpId } from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import { nearEd25519SignerBindingFromBoundaryFields } from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import { DEFAULT_UNLOCK_REMAINING_USES } from '@/core/signingEngine/threshold/sessionPolicy';
import { base64UrlEncode } from '@shared/utils/base64';
import { base58Encode } from '@shared/utils/base58';
import { deriveImplicitNearAccountIdFromEd25519PublicKey } from '@shared/utils/near';
import {
  destroyLinkedDeviceEcdsaHolderMaterialWasm,
  storeLinkedDeviceEcdsaHolderMaterialWasm,
} from '@/core/signingEngine/threshold/crypto/ecdsaDerivationClientWasm';
import {
  installLinkedEcdsaHolderRuntimeV1,
  resolveLinkedEcdsaHolderRuntimeV1,
  type LinkedEcdsaHolderRuntimeV1,
} from '@/core/signingEngine/session/material/linkedEcdsaHolderRuntime';
import type {
  LinkedDevicePasskeyOpenedMaterial,
  LinkedDeviceAuthoritySelection,
  LinkedDeviceEmailOtpProviderIdentity,
  LinkedDevicePasskeyAuthoritySelection,
  LinkedDeviceEmailOtpAuthoritySelection,
} from './authority';
import {
  resolveLinkedDevicePasskeyAuthoritySelection,
  resolveLinkedDeviceEmailOtpAuthoritySelection,
  assertLinkedDeviceWalletSessionExact,
  openLinkedDeviceSignerMaterialsWithFactorSecret,
  walletAuthAuthorityForLinkedDeviceMethod,
  linkedDeviceEmailOtpProviderSubjectId,
} from './authority';

export function linkedDeviceRuntimeRequiresCurve(
  walletSession: ActiveWalletSessionV1,
  curve: 'ed25519' | 'ecdsa',
): boolean {
  return walletSession.capabilitySubjects.some(
    (subject) =>
      (subject.kind === 'sign' || subject.kind === 'export_keys') &&
      subject.keyFamily === (curve === 'ed25519' ? 'ed25519' : 'ecdsa_secp256k1'),
  );
}

export function linkedDeviceEd25519Material(
  materials: readonly [LinkedDevicePasskeyOpenedMaterial, ...LinkedDevicePasskeyOpenedMaterial[]],
): Extract<LinkedDevicePasskeyOpenedMaterial, { readonly keyFamily: 'ed25519' }> | null {
  const matches = materials.filter(
    (
      material,
    ): material is Extract<LinkedDevicePasskeyOpenedMaterial, { readonly keyFamily: 'ed25519' }> =>
      material.keyFamily === 'ed25519',
  );
  if (matches.length > 1) {
    throw new Error('[login] linked passkey has multiple active Ed25519 materials');
  }
  return matches[0] ?? null;
}

export function linkedDeviceEcdsaMaterial(
  materials: readonly [LinkedDevicePasskeyOpenedMaterial, ...LinkedDevicePasskeyOpenedMaterial[]],
): Extract<LinkedDevicePasskeyOpenedMaterial, { readonly keyFamily: 'ecdsa_secp256k1' }> | null {
  const matches = materials.filter(
    (
      material,
    ): material is Extract<
      LinkedDevicePasskeyOpenedMaterial,
      { readonly keyFamily: 'ecdsa_secp256k1' }
    > => material.keyFamily === 'ecdsa_secp256k1',
  );
  if (matches.length > 1) {
    throw new Error('[login] linked passkey has multiple active ECDSA materials');
  }
  return matches[0] ?? null;
}

type LinkedEcdsaHolderActivationContext = {
  readonly signingEngine: Pick<LoginWebContext['signingEngine'], 'getSignerWorkerContext'>;
};

export async function activateLinkedDeviceEcdsaHolderRuntime(args: {
  readonly context: LinkedEcdsaHolderActivationContext;
  readonly selection: LinkedDeviceAuthoritySelection;
  readonly factorAuthority: WalletAuthAuthority;
  readonly material: Extract<
    LinkedDevicePasskeyOpenedMaterial,
    { readonly keyFamily: 'ecdsa_secp256k1' }
  >;
}): Promise<{ readonly runtime: LinkedEcdsaHolderRuntimeV1; readonly installed: boolean }> {
  const existing = resolveLinkedEcdsaHolderRuntimeV1({
    walletId: args.selection.walletId,
    materialActivation: args.material.materialActivation,
  });
  if (existing) {
    const [existingAuthorityRef, requestedAuthorityRef] = await Promise.all([
      walletAuthAuthorityRef({ authority: existing.factorAuthority }),
      walletAuthAuthorityRef({ authority: args.factorAuthority }),
    ]);
    if (
      existing.authorityId !== args.selection.authority.authorityId ||
      existing.walletAuthMethodId !== args.selection.authMethod.walletAuthMethodId ||
      existing.ecdsaThresholdKeyId !== args.material.publicFacts.ecdsaThresholdKeyId ||
      existingAuthorityRef.authorityDigest !== requestedAuthorityRef.authorityDigest
    ) {
      throw new Error('[login] linked ECDSA holder runtime conflicts with the selected authority');
    }
    return { runtime: existing, installed: false };
  }
  const holderHandleId = secureRandomId('linked-ecdsa-holder');
  try {
    const stored = await storeLinkedDeviceEcdsaHolderMaterialWasm({
      holderHandleId,
      ownedSigningShare32: args.material.material.slice(),
      activationReceiptJson: JSON.stringify(args.material.publicFacts.activationReceipt),
      workerCtx: args.context.signingEngine.getSignerWorkerContext(),
    });
    const runtime: LinkedEcdsaHolderRuntimeV1 = {
      kind: 'linked_ecdsa_holder_runtime_v1',
      walletId: args.selection.walletId,
      authorityId: args.selection.authority.authorityId,
      walletAuthMethodId: args.selection.authMethod.walletAuthMethodId,
      factorAuthority: args.factorAuthority,
      materialActivation: args.material.materialActivation,
      holderHandleId: stored.holderHandleId,
      ecdsaThresholdKeyId: args.material.publicFacts.ecdsaThresholdKeyId,
      activationReceipt: args.material.publicFacts.activationReceipt,
    };
    installLinkedEcdsaHolderRuntimeV1(runtime);
    return { runtime, installed: true };
  } catch (error: unknown) {
    await destroyLinkedDeviceEcdsaHolderMaterialWasm({
      holderHandleId,
      workerCtx: args.context.signingEngine.getSignerWorkerContext(),
    }).catch(() => undefined);
    throw error;
  }
}

type LinkedDevicePostLinkFactor =
  | {
      readonly kind: 'passkey';
      readonly walletId: WalletId;
    }
  | {
      readonly kind: 'email_otp';
      readonly walletId: WalletId;
      readonly walletAuthMethodId: WalletAuthMethodId;
      readonly emailHashHex: string;
      readonly providerIdentity: LinkedDeviceEmailOtpProviderIdentity;
    };

async function resolveLinkedDevicePostLinkSelection(
  factor: LinkedDevicePostLinkFactor,
): Promise<LinkedDevicePasskeyAuthoritySelection | LinkedDeviceEmailOtpAuthoritySelection> {
  if (factor.kind === 'passkey') {
    const selection = await resolveLinkedDevicePasskeyAuthoritySelection(String(factor.walletId));
    if (!selection) throw new Error('[login] linked Passkey authority is unavailable after link');
    return selection;
  }
  const resolution = await resolveLinkedDeviceEmailOtpAuthoritySelection({
    walletIdInput: String(factor.walletId),
    walletAuthMethodId: String(factor.walletAuthMethodId),
    emailHashHex: factor.emailHashHex,
    provider: factor.providerIdentity.provider,
    providerSubjectId: factor.providerIdentity.providerSubjectId,
  });
  if (resolution.kind !== 'selected') {
    throw new Error(
      resolution.kind === 'rejected'
        ? resolution.message
        : '[login] linked Email OTP authority is unavailable after link',
    );
  }
  return resolution.selection;
}

async function linkedDeviceEd25519SessionAfterLink(args: {
  readonly relayerUrl: string;
  readonly selection: LinkedDeviceAuthoritySelection;
  readonly walletSession: ActiveWalletSessionV1;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly material: Extract<LinkedDevicePasskeyOpenedMaterial, { readonly keyFamily: 'ed25519' }>;
}): Promise<LinkedDeviceEd25519RuntimeSession> {
  const metadata = linkedDeviceEd25519Metadata(args.material);
  const nearAccountId = deriveImplicitNearAccountIdFromEd25519PublicKey(
    `ed25519:${base58Encode(metadata.registeredPublicKey)}`,
  );
  const requestResult = parseRouterAbEd25519YaoWarmRecoveryBootstrapRequestV1({
    kind: 'router_ab_ed25519_yao_warm_recovery_bootstrap_request_v1',
    walletId: String(args.selection.walletId),
    nearAccountId,
    nearEd25519SigningKeyId: metadata.applicationBinding.near_ed25519_signing_key_id,
    signerSlot: metadata.applicationBinding.key_creation_signer_slot,
    thresholdSessionId: metadata.scope.threshold_session_id,
    signingWorkerId: metadata.scope.signing_worker_id,
    participantIds: metadata.participantIds,
  });
  if (!requestResult.ok) throw new Error(requestResult.message);
  const response = await fetch(
    `${new URL(args.relayerUrl).origin}${ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.operationCredential.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestResult.value),
    },
  );
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok || !isObject(raw)) {
    const message = isObject(raw) ? String(raw.message || '').trim() : '';
    throw new Error(
      `[login] linked Ed25519 post-link bootstrap failed (HTTP ${response.status}): ${message || 'invalid response'}`,
    );
  }
  const thresholdSessionId = parseThresholdEd25519SessionId(raw.thresholdSessionId);
  const walletSessionId = parseWalletSessionId(raw.walletSessionId);
  const quotaId = parseMpcWalletSigningQuotaId(raw.quotaId);
  const runtimePolicyScope = normalizeRuntimePolicyScope(raw.runtimePolicyScope);
  const routerAbNormalSigning = parseRouterAbEd25519NormalSigningState(raw.routerAbNormalSigning);
  const participantIds = Array.isArray(raw.participantIds) ? raw.participantIds : [];
  if (
    (raw.kind !== 'router_ab_ed25519_yao_warm_recovery_bootstrap_v1' &&
      raw.kind !== 'router_ab_ed25519_yao_v2_session_bootstrap_v1') ||
    String(raw.walletId) !== String(args.selection.walletId) ||
    String(raw.nearAccountId) !== requestResult.value.nearAccountId ||
    String(raw.nearEd25519SigningKeyId) !== requestResult.value.nearEd25519SigningKeyId ||
    String(raw.signingWorkerId) !== requestResult.value.signingWorkerId ||
    !thresholdSessionId.ok ||
    !walletSessionId.ok ||
    !quotaId.ok ||
    !runtimePolicyScope ||
    !routerAbNormalSigning ||
    participantIds.length !== 2 ||
    !Number.isSafeInteger(participantIds[0]) ||
    !Number.isSafeInteger(participantIds[1]) ||
    String(walletSessionId.value) !== String(args.operationCredential.walletSessionId) ||
    String(thresholdSessionId.value) !== requestResult.value.thresholdSessionId
  ) {
    throw new Error('[login] linked Ed25519 post-link bootstrap identity is invalid');
  }
  const expiresAtMs = Number(raw.thresholdExpiresAtMs);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error('[login] linked Ed25519 post-link bootstrap is expired');
  }
  return {
    walletId: String(args.selection.walletId),
    nearAccountId: requestResult.value.nearAccountId,
    nearEd25519SigningKeyId: requestResult.value.nearEd25519SigningKeyId,
    relayerKeyId: requestResult.value.signingWorkerId,
    participantIds: [participantIds[0], participantIds[1]],
    thresholdSessionId: thresholdSessionId.value,
    authorizationId: args.walletSession.authorizationId,
    walletSessionId: walletSessionId.value,
    quotaId: quotaId.value,
    expiresAtMs,
    remainingUses: DEFAULT_UNLOCK_REMAINING_USES,
    runtimePolicyScope,
    routerAbNormalSigning,
    operationCredential: args.operationCredential,
  };
}

export async function activateLinkedDeviceSignerRuntimesAfterLink(args: {
  readonly context: LoginWebContext;
  readonly factor: LinkedDevicePostLinkFactor;
  readonly walletSession: ActiveWalletSessionV1;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly factorSecret32: Uint8Array;
}): Promise<void> {
  const selection = await resolveLinkedDevicePostLinkSelection(args.factor);
  assertLinkedDeviceWalletSessionExact(selection, args.walletSession);
  const relayerUrl = String(args.context.configs.network.relayer?.url || '').trim();
  if (!relayerUrl) throw new Error('[login] linked post-link activation requires relayer.url');
  await walletSessionAuthorizations.writeExactWithOperationCredential({
    record: args.walletSession,
    operationCredential: args.operationCredential,
  });
  const openedMaterials = await openLinkedDeviceSignerMaterialsWithFactorSecret({
    selection,
    factorSecret32: args.factorSecret32,
  });
  try {
    const providerIdentity =
      args.factor.kind === 'email_otp' ? args.factor.providerIdentity : undefined;
    const factorAuthority = await walletAuthAuthorityForLinkedDeviceMethod({
      selection,
      ...(providerIdentity ? { providerIdentity } : {}),
    });
    const ecdsaMaterial = linkedDeviceEcdsaMaterial(openedMaterials);
    if (ecdsaMaterial) {
      const { runtime } = await activateLinkedDeviceEcdsaHolderRuntime({
        context: args.context,
        selection,
        factorAuthority,
        material: ecdsaMaterial,
      });
      void scheduleLinkedDevicePresignaturePrefill({
        runtime,
        operationCredential: args.operationCredential,
        expiresAtMs: args.walletSession.expiresAtMs,
        relayerUrl,
        workerCtx: args.context.signingEngine.getSignerWorkerContext(),
      });
    }
    const ed25519Material = linkedDeviceEd25519Material(openedMaterials);
    if (ed25519Material) {
      const session = await linkedDeviceEd25519SessionAfterLink({
        relayerUrl,
        selection,
        walletSession: args.walletSession,
        operationCredential: args.operationCredential,
        material: ed25519Material,
      });
      await activateLinkedDeviceEd25519Runtime({
        context: args.context,
        selection,
        session,
        material: ed25519Material,
        relayerUrl,
        ...(providerIdentity ? { providerIdentity } : {}),
      });
    }
    if (selection.exportRoot) {
      if (args.factor.kind === 'passkey') {
        await args.context.signingEngine.establishUnlockedWalletEd25519ExportRootCapabilityV1({
          existingEnvelope: selection.exportRoot.envelope,
          passkeyPrfFirstB64u: base64UrlEncode(args.factorSecret32),
          walletId: String(selection.walletId),
          walletAuthMethodId: String(selection.authMethod.walletAuthMethodId),
          walletSessionId: String(args.operationCredential.walletSessionId),
          expiresAtMs: args.walletSession.expiresAtMs,
        });
      } else if (
        isWalletCustodySeedBinding(selection.exportRoot.envelope.binding) ||
        selection.exportRoot.envelope.binding.kind === 'ed25519_yao_client_root_v1'
      ) {
        await establishUnlockedExportRootCapabilityV1(
          walletCustodyCeremonyTransportFromWorkerContextV1(
            args.context.signingEngine.getSignerWorkerContext(),
          ),
          {
            existingEnvelope: selection.exportRoot.envelope,
            existingFactorSecret: args.factorSecret32,
            walletId: String(selection.walletId),
            walletAuthMethodId: String(selection.authMethod.walletAuthMethodId),
            walletSessionId: String(args.operationCredential.walletSessionId),
            expiresAtMs: args.walletSession.expiresAtMs,
          },
        );
      }
    }
    await args.context.signingEngine.markWalletSelectionUnlocked({
      walletId: selection.walletId,
      walletAuthMethodId: selection.authMethod.walletAuthMethodId,
    });
  } finally {
    for (const openedMaterial of openedMaterials) openedMaterial.material.fill(0);
  }
}

function linkedDeviceEd25519Metadata(
  material: Extract<LinkedDevicePasskeyOpenedMaterial, { readonly keyFamily: 'ed25519' }>,
): RouterAbEd25519YaoActiveClientMetadataV1 {
  const binding = material.publicFacts.targetBinding;
  const receipt = material.publicFacts.activationReceipt;
  return {
    kind: ROUTER_AB_ED25519_YAO_ACTIVE_CLIENT_KIND_V1,
    scope: {
      lifecycle_id: binding.lifecycle.lifecycle_id,
      root_share_epoch: binding.lifecycle.root_share_epoch,
      account_id: binding.lifecycle.account_id,
      threshold_session_id: binding.lifecycle.session_id,
      signer_set_id: binding.lifecycle.signer_set_id,
      signing_worker_id: binding.lifecycle.selected_server_id,
      material_activation: binding.material_activation,
    },
    applicationBinding: material.publicFacts.applicationBinding,
    participantIds: material.publicFacts.participantIds,
    registeredPublicKey: Uint8Array.from(receipt.registered_public_key),
    signingWorkerVerifyingShare: Uint8Array.from(receipt.signing_worker_verifying_share),
    stateEpoch: BigInt(receipt.state_epoch),
    transcript: Uint8Array.from(receipt.transcript),
    activeCapabilityBinding: binding.session_id,
    materialActivation: material.materialActivation,
  };
}

type LinkedDeviceEd25519RuntimeSession = {
  readonly walletId: string;
  readonly nearAccountId: string;
  readonly nearEd25519SigningKeyId: string;
  readonly relayerKeyId: string;
  readonly participantIds: readonly [number, number];
  readonly thresholdSessionId: ThresholdEd25519SessionId;
  readonly authorizationId: WalletSessionAuthorizationId;
  readonly walletSessionId: WalletSessionId;
  readonly quotaId: MpcWalletSigningQuotaId;
  readonly expiresAtMs: number;
  readonly remainingUses: number;
  readonly runtimePolicyScope: ThresholdRuntimePolicyScope;
  readonly routerAbNormalSigning: RouterAbEd25519NormalSigningState;
  readonly operationCredential: WalletSessionOperationCredentialV1;
};

export function linkedDeviceEd25519SessionFromPasskeyUnlock(args: {
  readonly session: PasskeyWalletUnlockEd25519Session;
  readonly operationCredential: WalletSessionOperationCredentialV1;
}): LinkedDeviceEd25519RuntimeSession {
  const session = args.session;
  if (session.walletSessionId !== args.operationCredential.walletSessionId) {
    throw new Error('[login] linked Passkey Ed25519 credentials identify different sessions');
  }
  if (
    session.sessionKind === 'issued_exact_wallet_session' &&
    session.operationCredential.walletSessionId !== args.operationCredential.walletSessionId
  ) {
    throw new Error('[login] linked Passkey Ed25519 credentials identify different sessions');
  }
  return {
    walletId: session.walletId,
    nearAccountId: session.nearAccountId,
    nearEd25519SigningKeyId: session.nearEd25519SigningKeyId,
    relayerKeyId: session.relayerKeyId,
    participantIds: session.participantIds,
    thresholdSessionId: session.thresholdSessionId,
    authorizationId: session.authorizationId,
    walletSessionId: session.walletSessionId,
    quotaId: session.quotaId,
    expiresAtMs: session.expiresAtMs,
    remainingUses: session.remainingUses,
    runtimePolicyScope: session.runtimePolicyScope,
    routerAbNormalSigning: session.routerAbNormalSigning,
    operationCredential: args.operationCredential,
  };
}

export function linkedDeviceEd25519SessionFromEmailOtpBootstrap(args: {
  readonly session: WalletRegistrationEd25519YaoSignerRuntimeBootstrap;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly providerIdentity: LinkedDeviceEmailOtpProviderIdentity;
}): LinkedDeviceEd25519RuntimeSession {
  const session = args.session;
  /* The provider flavor is server-derived from the enrollment's principal
     shape (a fresh address-verified target is 'email'; a target reusing the
     founding Google enrollment stays 'google'), and the client holds no
     durable record of it. The provider subject is the identity anchor, so the
     binding pins kind and subject and accepts either flavor. */
  if (
    session.authorityScope.kind !== 'email_otp' ||
    String(session.authorityScope.providerUserId) !==
      String(args.providerIdentity.providerSubjectId)
  ) {
    const mismatches = [
      ...(session.authorityScope.kind !== 'email_otp' ? ['scope.kind'] : []),
      ...(session.authorityScope.kind === 'email_otp' &&
      String(session.authorityScope.providerUserId) !==
        String(args.providerIdentity.providerSubjectId)
        ? ['scope.providerUserId']
        : []),
    ];
    throw new Error(
      `[login] linked Email OTP Ed25519 session authority mismatch: ${mismatches.join(', ')}`,
    );
  }
  const thresholdSessionId = parseThresholdEd25519SessionId(session.thresholdSessionId);
  const authorizationId = parseWalletSessionAuthorizationId(session.authorizationId);
  const walletSessionId = parseWalletSessionId(session.walletSessionId);
  const quotaId = parseMpcWalletSigningQuotaId(session.quotaId);
  if (!thresholdSessionId.ok || !authorizationId.ok || !walletSessionId.ok || !quotaId.ok) {
    throw new Error('[login] linked Email OTP Ed25519 session identity is invalid');
  }
  if (args.operationCredential.walletSessionId !== walletSessionId.value) {
    throw new Error('[login] linked Email OTP Ed25519 credential identifies another session');
  }
  const base = {
    walletId: String(session.walletId),
    nearAccountId: session.nearAccountId,
    nearEd25519SigningKeyId: session.nearEd25519SigningKeyId,
    relayerKeyId: session.routerAbNormalSigning.signingWorkerId,
    participantIds: session.participantIds,
    thresholdSessionId: thresholdSessionId.value,
    authorizationId: authorizationId.value,
    walletSessionId: walletSessionId.value,
    quotaId: quotaId.value,
    expiresAtMs: session.expiresAtMs,
    remainingUses: session.remainingUses,
    runtimePolicyScope: session.runtimePolicyScope,
    routerAbNormalSigning: session.routerAbNormalSigning,
  };
  return { ...base, operationCredential: args.operationCredential };
}

function linkedDeviceEd25519YaoLaneReference(args: {
  readonly selection: LinkedDeviceAuthoritySelection;
  readonly session: LinkedDeviceEd25519RuntimeSession;
  readonly material: Extract<LinkedDevicePasskeyOpenedMaterial, { readonly keyFamily: 'ed25519' }>;
  readonly providerIdentity?: LinkedDeviceEmailOtpProviderIdentity;
}): Ed25519YaoPublicCapabilityLaneReferenceV1 {
  const nearAccountId = toAccountId(args.session.nearAccountId);
  const common = {
    walletId: args.selection.walletId,
    nearAccountId,
    thresholdSessionId: args.session.thresholdSessionId,
    runtimePolicyScope: args.session.runtimePolicyScope,
    materialActivation: args.material.materialActivation,
    nearEd25519SigningKeyId: nearEd25519SigningKeyIdFromString(
      args.session.nearEd25519SigningKeyId,
    ),
    signerSlot: args.material.publicFacts.applicationBinding.key_creation_signer_slot,
  };
  if (args.selection.authMethod.kind === 'passkey') {
    return {
      ...common,
      auth: {
        kind: 'passkey',
        rpId: toRpId(args.selection.authMethod.rpId),
        credentialIdB64u: args.selection.authMethod.credentialIdB64u,
      },
    };
  }
  return {
    ...common,
    auth: {
      kind: 'email_otp',
      providerSubjectId: linkedDeviceEmailOtpProviderSubjectId(args.providerIdentity),
    },
    remainingUses: args.session.remainingUses,
    expiresAtMs: args.session.expiresAtMs,
  };
}

export async function activateLinkedDeviceEd25519Runtime(args: {
  readonly context: LoginWebContext;
  readonly selection: LinkedDeviceAuthoritySelection;
  readonly session: LinkedDeviceEd25519RuntimeSession;
  readonly material: Extract<LinkedDevicePasskeyOpenedMaterial, { readonly keyFamily: 'ed25519' }>;
  readonly relayerUrl: string;
  readonly providerIdentity?: LinkedDeviceEmailOtpProviderIdentity;
}): Promise<Extract<LoginResult, { success: true }>> {
  const metadata = linkedDeviceEd25519Metadata(args.material);
  const application = metadata.applicationBinding;
  const mismatchLabels: string[] = [];
  if (args.session.walletId !== String(args.selection.walletId)) mismatchLabels.push('walletId');
  if (application.wallet_id !== String(args.selection.walletId)) {
    mismatchLabels.push('application.walletId');
  }
  if (metadata.scope.account_id !== String(args.selection.walletId)) {
    mismatchLabels.push('material.walletId');
  }
  if (args.session.nearEd25519SigningKeyId !== application.near_ed25519_signing_key_id) {
    mismatchLabels.push('nearEd25519SigningKeyId');
  }
  if (args.session.thresholdSessionId !== metadata.scope.threshold_session_id) {
    mismatchLabels.push('thresholdSessionId');
  }
  if (args.session.relayerKeyId !== metadata.scope.signing_worker_id) {
    mismatchLabels.push('signingWorkerId');
  }
  if (mismatchLabels.length > 0) {
    throw new Error(
      `[login] linked Ed25519 Wallet Session does not match local material: ${mismatchLabels.join(', ')}`,
    );
  }
  const yaoClient = await RouterAbEd25519YaoClientV1.initializeBundled();
  const activeClient = yaoClient.importLinkedMaterial({
    ownedClientScalarShare: args.material.material,
    publicReceipt: args.material.publicFacts.activationReceipt,
    metadata,
  });
  let activated = false;
  try {
    const activatedIdentity =
      await args.context.signingEngine.activateVerifiedNearEd25519YaoMaterial({
        activeClient,
        facts: {
          thresholdSessionId: args.session.thresholdSessionId,
          signer: nearEd25519SignerBindingFromBoundaryFields({
            walletId: args.selection.walletId,
            nearAccountId: toAccountId(args.session.nearAccountId),
            nearEd25519SigningKeyId: nearEd25519SigningKeyIdFromString(
              args.session.nearEd25519SigningKeyId,
            ),
            signerSlot: application.key_creation_signer_slot,
          }),
          signingRootId: application.signing_root_id,
          signingRootVersion: metadata.scope.root_share_epoch,
          routerAbNormalSigning: args.session.routerAbNormalSigning,
          runtimePolicyScope: args.session.runtimePolicyScope,
          relayerUrl: args.relayerUrl,
        },
      });
    const nearAccountId = toAccountId(args.session.nearAccountId);
    if (
      String(activatedIdentity.walletId) !== String(args.selection.walletId) ||
      String(activatedIdentity.nearAccountId) !== String(nearAccountId) ||
      !mpcMaterialActivationRefsEqual(
        activatedIdentity.materialActivation,
        args.material.materialActivation,
      )
    ) {
      throw new Error('[login] linked Ed25519 activation identity does not match the V2 session');
    }
    await publishEd25519YaoPublicCapabilityReferenceAndLane(
      new IndexedDbEd25519YaoPublicCapabilityReferenceStore(IndexedDBManager),
      linkedDeviceEd25519YaoLaneReference({
        selection: args.selection,
        session: args.session,
        material: args.material,
        ...(args.providerIdentity ? { providerIdentity: args.providerIdentity } : {}),
      }),
    );
    activated = true;
  } finally {
    if (!activated) activeClient.dispose();
  }
  const nearAccountId = toAccountId(args.session.nearAccountId);
  return {
    success: true,
    kind: 'near_wallet_unlocked',
    walletId: args.selection.walletId,
    loggedInNearAccountId: String(nearAccountId),
    operationalPublicKey: `ed25519:${base58Encode(metadata.registeredPublicKey)}`,
    nearAccountId,
  };
}
