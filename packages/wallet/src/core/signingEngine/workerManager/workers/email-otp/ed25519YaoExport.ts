/**
 * Ed25519 Yao seed export: authorizes the export for its exact lane and opens the custody the
 * Router asks for.
 */
import type { WalletAuthMethodId } from '@shared/utils/domainIds';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import {
  type PasskeyCustodyEnvelopeRecord,
  custodyEnvelopeBindingJsonV1,
} from '@shared/passkey-custody';
import { parseRouterAbEd25519YaoExportAdmissionRequestV1 } from '@shared/utils/routerAbEd25519Yao';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  sameRuntimePolicyScope,
  signingRootScopeFromRuntimePolicyScope,
} from '@shared/threshold/signingRootScope';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import {
  openWalletCustodyEd25519ActiveClientV1,
  walletCustodyCacheEnvelopeFromRecordV1,
} from '@/core/signingEngine/walletCustody/openCustodyCache';
import type {
  EmailOtpEd25519YaoActiveCapabilityDescriptorV1,
  EmailOtpEd25519YaoExportMaterialV1,
} from '@/core/signingEngine/workerManager/workerTypes';
import {
  RouterAbEd25519YaoHttpActivationTransportV1,
  type RouterAbEd25519YaoExportArtifactV1,
  type RouterAbEd25519YaoExportEmailOtpFactorReleaseV1,
  type RouterAbEd25519YaoExportCustodyEnvelopeV1,
} from '../../../threshold/ed25519/yaoClient';
import {
  deriveRouterAbEd25519YaoExportAuthorizationDigestV1,
  deriveRouterAbEd25519YaoExportConfirmationDigestV1,
  deriveRouterAbEd25519YaoRuntimePolicyBindingV1,
} from '@shared/utils/routerAbEd25519YaoDigests';
import type { ThresholdRuntimePolicyScope } from '@/core/signingEngine/threshold/sessionPolicy';
import { assertNeverEmailOtpWorker } from './payloadParsing';
import { getEmailOtpYaoClient } from './crypto';
import { releaseEmailOtpFactorSecret } from './otpVerification';
import {
  bindEmailOtpEd25519YaoCapabilityWarmFactor,
  type EmailOtpEd25519YaoWorkerActivationHandle,
  storeEmailOtpEd25519YaoActiveClient,
} from './sessionState';
import {
  bytesToLowerHex,
  walletCustodyActivationFactsFromEmailOtpBootstrap,
} from './custodyRestore';
import { completeEmailOtpUnlockFromSecret32 } from './unlock';

const EMAIL_OTP_ED25519_YAO_EXPORT_AUTH_TTL_MS = 60_000;

function safeEd25519YaoStateEpoch(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Email OTP Ed25519 Yao export state epoch is invalid');
  }
  return value;
}

function assertEmailOtpEd25519YaoExportCapabilityContinuity(args: {
  walletId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  signerSlot: number;
  runtimePolicyScope: ThresholdRuntimePolicyScope;
  capability: EmailOtpEd25519YaoActiveCapabilityDescriptorV1;
}): void {
  if (!Number.isSafeInteger(args.signerSlot) || args.signerSlot < 1) {
    throw new Error('Email OTP Ed25519 Yao export signerSlot is invalid');
  }
  const capability = args.capability;
  const signingRoot = signingRootScopeFromRuntimePolicyScope(args.runtimePolicyScope);
  if (!signingRoot) {
    throw new Error('Email OTP Ed25519 Yao export runtime policy scope is invalid');
  }
  if (
    capability.nearAccountId !== args.nearAccountId ||
    capability.applicationBinding.wallet_id !== args.walletId ||
    capability.applicationBinding.near_ed25519_signing_key_id !== args.nearEd25519SigningKeyId ||
    capability.applicationBinding.key_creation_signer_slot !== args.signerSlot ||
    capability.applicationBinding.signing_root_id !== signingRoot.signingRootId ||
    capability.lifecycle.accountId !== args.walletId ||
    capability.lifecycle.rootShareEpoch !== args.runtimePolicyScope.signingRootVersion ||
    !sameRuntimePolicyScope(capability.runtimePolicyScope, args.runtimePolicyScope)
  ) {
    throw new Error('Email OTP Ed25519 Yao export capability changed the exact durable lane');
  }
  const nearAccountId = args.nearAccountId.trim().toLowerCase();
  if (
    /^[0-9a-f]{64}$/.test(nearAccountId) &&
    bytesToLowerHex(Uint8Array.from(capability.registeredPublicKey)) !== nearAccountId
  ) {
    throw new Error('Email OTP Ed25519 Yao export public key does not match the NEAR account');
  }
}

export async function exportEmailOtpEd25519YaoSeed(args: {
  relayUrl: string;
  walletId: string;
  providerSubjectId: string;
  walletAuthMethodId: string;
  challengeId: string;
  otpCode: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  signerSlot: number;
  runtimePolicyScope: ThresholdRuntimePolicyScope;
  capability: EmailOtpEd25519YaoActiveCapabilityDescriptorV1;
  resolveCustodyEnvelope: (
    release: RouterAbEd25519YaoExportEmailOtpFactorReleaseV1,
  ) => Promise<RouterAbEd25519YaoExportCustodyEnvelopeV1>;
}): Promise<RouterAbEd25519YaoExportArtifactV1> {
  assertEmailOtpEd25519YaoExportCapabilityContinuity(args);
  const capability = args.capability;
  const identity = {
    scope: {
      lifecycle_id: capability.lifecycle.lifecycleId,
      root_share_epoch: capability.lifecycle.rootShareEpoch,
      account_id: capability.lifecycle.accountId,
      threshold_session_id: capability.lifecycle.thresholdSessionId,
      signer_set_id: capability.lifecycle.signerSetId,
      signing_worker_id: capability.lifecycle.signingWorkerId,
      material_activation: routerAbMpcMaterialActivationRefToWire(capability.materialActivation),
    },
    application_binding: capability.applicationBinding,
    participant_ids: capability.participantIds,
    registered_public_key: [...capability.registeredPublicKey],
    state_epoch: safeEd25519YaoStateEpoch(capability.stateEpoch),
    runtime_policy_binding: await deriveRouterAbEd25519YaoRuntimePolicyBindingV1(
      args.runtimePolicyScope,
    ),
  };
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + EMAIL_OTP_ED25519_YAO_EXPORT_AUTH_TTL_MS;
  const nonce = new Uint8Array(32);
  globalThis.crypto.getRandomValues(nonce);
  try {
    const confirmationDigest = await deriveRouterAbEd25519YaoExportConfirmationDigestV1({
      identity,
      nonce: [...nonce],
      issuedAtMs,
      expiresAtMs,
    });
    const authorizationDigest = await deriveRouterAbEd25519YaoExportAuthorizationDigestV1({
      identity,
      confirmationDigest,
      nonce: [...nonce],
      issuedAtMs,
      expiresAtMs,
      authority: {
        kind: 'email_otp',
        providerSubjectId: args.providerSubjectId,
      },
    });
    const request = parseRouterAbEd25519YaoExportAdmissionRequestV1({
      scope: identity.scope,
      application_binding: identity.application_binding,
      participant_ids: identity.participant_ids,
      registered_public_key: identity.registered_public_key,
      state_epoch: identity.state_epoch,
      runtime_policy_binding: identity.runtime_policy_binding,
      authorization: {
        confirmation_digest: confirmationDigest,
        authorization_digest: authorizationDigest,
        nonce: [...nonce],
        issued_at_ms: issuedAtMs,
        expires_at_ms: expiresAtMs,
      },
    });
    if (!request.ok) {
      throw new Error(`Invalid Email OTP Ed25519 Yao export admission: ${request.message}`);
    }
    const client = await getEmailOtpYaoClient();
    const result = await client.exportSeed({
      request: request.value,
      authorization: {
        kind: 'email_otp_factor',
        providerSubjectId: args.providerSubjectId,
        walletAuthMethodId: args.walletAuthMethodId,
        challengeId: args.challengeId,
        otpCode: args.otpCode,
      },
      resolveCustodyEnvelope: args.resolveCustodyEnvelope,
      transport: new RouterAbEd25519YaoHttpActivationTransportV1({
        routerOrigin: new URL(args.relayUrl).origin,
        authorization: { kind: 'cookies' },
        fetch: globalThis.fetch.bind(globalThis),
      }),
    });
    if (!result.ok) throw new Error(result.message);
    return result.artifact;
  } finally {
    nonce.fill(0);
  }
}

export type EmailOtpEd25519ExportCustodyResolutionState = {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly orgId: string;
  readonly providerSubjectId: string;
  readonly material: EmailOtpEd25519YaoExportMaterialV1;
  activeClientHandle: string | null;
  warmFactorBound: boolean;
  rehydrated: EmailOtpEd25519YaoWorkerActivationHandle | null;
};

export function emailOtpEd25519YaoExportCapabilityV1(
  material: EmailOtpEd25519YaoExportMaterialV1,
): EmailOtpEd25519YaoActiveCapabilityDescriptorV1 {
  switch (material.kind) {
    case 'active_capability':
      return material.capability;
    case 'sealed_custody':
      return material.bootstrap.capability;
    case 'sealed_export_root':
      return material.capability;
    default:
      return assertNeverEmailOtpWorker(material);
  }
}

function emailOtpEd25519ExportRootEnvelopeWireV1(
  envelope: PasskeyCustodyEnvelopeRecord,
): Omit<RouterAbEd25519YaoExportCustodyEnvelopeV1, 'factorSecret'> {
  if (
    envelope.lifecycle.state !== 'active' ||
    envelope.binding.kind !== 'ed25519_yao_client_root_v1'
  ) {
    throw new Error('Email OTP Ed25519 export requires an active Client-root envelope');
  }
  return {
    kind: 'ed25519_yao_client_root_v1',
    bindingJson: custodyEnvelopeBindingJsonV1(envelope),
    nonce: base64UrlDecode(envelope.nonceB64u),
    ciphertext: base64UrlDecode(envelope.sealedCustodySecretB64u),
    aadHash: base64UrlDecode(envelope.aadHashB64u),
    ciphertextDigest: base64UrlDecode(envelope.ciphertextDigestB64u),
  };
}

export async function resolveEmailOtpEd25519ExportCustodyEnvelope(
  state: EmailOtpEd25519ExportCustodyResolutionState,
  release: RouterAbEd25519YaoExportEmailOtpFactorReleaseV1,
): Promise<{
  readonly factorSecret: Uint8Array;
  readonly bindingJson: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly aadHash: Uint8Array;
  readonly ciphertextDigest: Uint8Array;
  readonly kind: 'wallet_custody_seed_v1' | 'ed25519_yao_client_root_v1';
}> {
  const released = await releaseEmailOtpFactorSecret({
    relayUrl: state.relayUrl,
    walletId: state.walletId,
    kind: 'verified_grant',
    loginGrant: release.loginGrant,
    challengeId: release.challengeId,
    sessionAuth: undefined,
  });
  let factorSecret32: Uint8Array | null = released.factorSecret32;
  try {
    if (state.material.kind === 'sealed_export_root') {
      const rootEnvelope = state.material.exportRootEnvelope;
      if (
        rootEnvelope.lifecycle.state !== 'active' ||
        rootEnvelope.walletId !== state.walletId ||
        rootEnvelope.binding.kind !== 'ed25519_yao_client_root_v1' ||
        rootEnvelope.binding.targetFactor.kind !== 'email_otp' ||
        rootEnvelope.binding.registeredPublicKeyB64u !==
          base64UrlEncode(Uint8Array.from(state.material.capability.registeredPublicKey)) ||
        rootEnvelope.factor.kind !== 'email_otp' ||
        rootEnvelope.factor.enrollmentId !== released.enrollmentId ||
        rootEnvelope.factor.enrollmentSealKeyVersion !== released.enrollmentSealKeyVersion
      ) {
        throw new Error('Email OTP Ed25519 export root is bound to another factor or lane');
      }
      const envelope = emailOtpEd25519ExportRootEnvelopeWireV1(rootEnvelope);
      const ownedFactorSecret = factorSecret32;
      factorSecret32 = null;
      return {
        ...envelope,
        factorSecret: ownedFactorSecret,
      };
    }
    const unlocked = await completeEmailOtpUnlockFromSecret32({
      relayUrl: state.relayUrl,
      walletId: state.walletId,
      authoritySelector: {
        kind: 'wallet_auth_method',
        walletAuthMethodId: state.walletAuthMethodId,
      },
      orgId: state.orgId,
      userId: state.providerSubjectId,
      enrollmentId: released.enrollmentId,
      enrollmentSealKeyVersion: released.enrollmentSealKeyVersion,
      clientSecret32: factorSecret32,
      material: { kind: 'ed25519_yao_export' },
      sessionAuth: undefined,
    });
    if (unlocked.kind !== 'ed25519_yao_export') {
      throw new Error('Email OTP Ed25519 Yao export returned the wrong custody material');
    }
    if (state.material.kind === 'sealed_custody') {
      const bootstrap = state.material.bootstrap;
      const activeClient = await openWalletCustodyEd25519ActiveClientV1({
        material: state.material.walletCustodyEd25519Material,
        activation: walletCustodyActivationFactsFromEmailOtpBootstrap(bootstrap),
        envelope: walletCustodyCacheEnvelopeFromRecordV1(unlocked.walletCustodyEnvelope),
        ownedFactorSecret: factorSecret32.slice(),
      });
      try {
        const stored = storeEmailOtpEd25519YaoActiveClient(activeClient);
        state.activeClientHandle = stored.activeClientHandle;
        state.rehydrated = stored;
        if (bootstrap.session.remainingUses > 0) {
          bindEmailOtpEd25519YaoCapabilityWarmFactor({
            bootstrap,
            factorSecret32,
            materialActivation: state.material.materialActivation,
          });
          state.warmFactorBound = true;
        }
      } catch (error) {
        activeClient.dispose();
        throw error;
      }
    }
    const envelope = walletCustodyCacheEnvelopeFromRecordV1(unlocked.walletCustodyEnvelope);
    const ownedFactorSecret = factorSecret32;
    factorSecret32 = null;
    return {
      kind: 'wallet_custody_seed_v1',
      factorSecret: ownedFactorSecret,
      bindingJson: envelope.bindingJson,
      nonce: base64UrlDecode(envelope.nonceB64u),
      ciphertext: base64UrlDecode(envelope.ciphertextB64u),
      aadHash: base64UrlDecode(envelope.aadHashB64u),
      ciphertextDigest: base64UrlDecode(envelope.ciphertextDigestB64u),
    };
  } finally {
    zeroizeBytes(factorSecret32);
  }
}
