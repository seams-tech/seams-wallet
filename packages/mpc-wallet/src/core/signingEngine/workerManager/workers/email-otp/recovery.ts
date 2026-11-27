/**
 * Recovery flows: rehydrating Ed25519 operation and Wallet Session material, and rotating the
 * recovery set.
 */
import {
  mpcMaterialActivationRefsEqual,
  type MpcMaterialActivationRef,
  type ThresholdEd25519SessionId,
} from '@shared/utils/domainIds';
import { base58Encode } from '@shared/utils/base58';
import { normalizePositiveInteger } from '@shared/utils/normalize';
import { ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1 } from '@shared/utils/routerAbEd25519Yao';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import { joinCustodyWireFromEnvelopeRecord } from '@/core/signingEngine/walletCustody/joinCustodyWire';
import type {
  EmailOtpEd25519YaoRecoveryBootstrapV1,
  EmailOtpWorkerOperationMap,
} from '@/core/signingEngine/workerManager/workerTypes';
import type { RouterAbEd25519YaoActiveClientMetadataV1 } from '../../../threshold/ed25519/yaoClient';
import {
  issueEd25519OperationStepUpAuthorization,
  type Ed25519OperationStepUpCredential,
} from '../../../threshold/ed25519/walletSession';
import {
  wallet_custody_ceremony_join_v1,
  type WasmCeremonySeedHeldV1,
} from '../../../../../../../../wasm/wallet_custody_ceremony/pkg/wallet_custody_ceremony.js';
import { parseWalletRecoverySetRotationWorkerResultV1 } from '@shared/wallet-recovery/walletRecoveryRotation';
import { readString, readThresholdEd25519SessionId } from './payloadParsing';
import { ensureWalletCustodyCeremonyWasm } from './crypto';
import {
  blindEmailOtpDeviceFactors,
  discardEmailOtpDeviceFactorBlinds,
  openEmailOtpFactorEvaluation,
} from './deviceFactor';
import { emailOtpEd25519WarmSeal } from './ed25519WarmSeal';
import { removeEmailOtpEd25519YaoActiveClient } from './sessionState';
import type {
  EmailOtpEd25519OperationRecoveryMaterialRequest,
  EmailOtpUnlockSecretMaterialRequest,
} from './custodyRestore';
import {
  completeEmailOtpUnlockFromSecret32,
  type EmailOtpWalletCustodySeedUnlock,
  unlockEmailOtpWalletCustodySeed,
} from './unlock';

function assertEmailOtpEd25519OperationMaterialContinuity(args: {
  walletId: string;
  nearAccountId: string;
  signerSlot: number;
  expectedOperationalPublicKey: string;
  expectedThresholdSessionId: ThresholdEd25519SessionId;
  expectedMaterialActivation: MpcMaterialActivationRef;
  metadata: RouterAbEd25519YaoActiveClientMetadataV1;
  bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
}): void {
  const metadataActivation = args.metadata.materialActivation;
  const capability = args.bootstrap.capability;
  if (
    !mpcMaterialActivationRefsEqual(metadataActivation, args.expectedMaterialActivation) ||
    !mpcMaterialActivationRefsEqual(
      capability.materialActivation,
      args.expectedMaterialActivation,
    ) ||
    capability.nearAccountId !== args.nearAccountId ||
    capability.applicationBinding.wallet_id !== args.walletId ||
    capability.applicationBinding.key_creation_signer_slot !== args.signerSlot ||
    capability.lifecycle.thresholdSessionId !== args.expectedThresholdSessionId ||
    `ed25519:${base58Encode(args.metadata.registeredPublicKey)}` !==
      args.expectedOperationalPublicKey
  ) {
    throw new Error('Email OTP operation recovery activated different signing material');
  }
}

export async function rehydrateEmailOtpEd25519YaoOperationMaterial(
  args: EmailOtpWorkerOperationMap['rehydrateEmailOtpEd25519YaoOperationMaterial']['payload'],
): Promise<EmailOtpWorkerOperationMap['rehydrateEmailOtpEd25519YaoOperationMaterial']['result']> {
  const relayUrl = readString(args.relayUrl, 'relayUrl');
  const walletId = readString(args.walletId, 'walletId');
  const providerSubjectId = readString(args.providerSubjectId, 'providerSubjectId');
  const nearAccountId = readString(args.nearAccountId, 'nearAccountId');
  const signerSlot = normalizePositiveInteger(args.signerSlot);
  if (signerSlot === null) throw new Error('signerSlot must be a positive safe integer');
  const expectedThresholdSessionId = readThresholdEd25519SessionId(
    args.expectedThresholdSessionId,
    'expectedThresholdSessionId',
  );
  const expectedOperationalPublicKey = readString(
    args.expectedOperationalPublicKey,
    'expectedOperationalPublicKey',
  );
  const expectedMaterialActivation = args.expectedMaterialActivation;
  if (String(expectedMaterialActivation.materialOwner) !== walletId) {
    throw new Error('Email OTP operation material activation belongs to another wallet');
  }
  if (args.ed25519YaoRecovery.orgId !== String(args.orgId).trim()) {
    throw new Error('Email OTP operation material organization binding changed');
  }
  if (args.ed25519YaoRecovery.signerSlot !== signerSlot) {
    throw new Error('Email OTP operation material signer slot binding changed');
  }
  if (args.proof.providerSubjectId !== providerSubjectId) {
    throw new Error('Email OTP operation material provider binding changed');
  }
  if (String(args.proof.authorityRef.walletId) !== walletId) {
    throw new Error('Email OTP operation material authority wallet binding changed');
  }
  const operationCredential = parseWalletSessionOperationCredentialV1(args.operationCredential);
  if (
    args.normalSigningRequest.scope.authorization.kind === 'reusable_wallet_session' &&
    args.normalSigningRequest.scope.authorization.wallet_session_id !==
      String(operationCredential.walletSessionId)
  ) {
    throw new Error('Email OTP operation material Wallet Session identity changed');
  }
  const credential: Ed25519OperationStepUpCredential = {
    kind: 'wallet_session_opaque',
    walletSessionToken: operationCredential.token,
    home: operationCredential.home,
  };
  const material: EmailOtpEd25519OperationRecoveryMaterialRequest = {
    kind: 'ed25519_yao_operation_recovery',
    bootstrap: args.bootstrap,
    ed25519YaoRecovery: args.ed25519YaoRecovery,
    providerSubject: providerSubjectId,
    nearAccountId,
    expectedOperationalPublicKey,
    expectedThresholdSessionId: String(expectedThresholdSessionId),
    walletCustodyEd25519Material: args.walletCustodyEd25519Material,
  };
  const blinds = await blindEmailOtpDeviceFactors(walletId);
  let factorSecret32: Uint8Array | null = null;
  let activeClientHandle: string | null = null;
  try {
    const issuedAuthorization = await issueEd25519OperationStepUpAuthorization({
      relayerUrl: relayUrl,
      normalSigningRequest: args.normalSigningRequest,
      displayDigest: readString(args.displayDigest, 'displayDigest'),
      proof: args.proof,
      credential,
      materialRecovery: {
        kind: 'email_otp_factor_evaluation_v1',
        deviceFactors: blinds.deviceFactors,
      },
    });
    const released = issuedAuthorization.materialRecovery;
    if (released.kind !== 'email_otp_factor_evaluation_v1') {
      throw new Error('Email OTP operation step-up did not return a factor evaluation');
    }
    if (released.challengeId !== args.proof.challengeId) {
      throw new Error('Email OTP factor evaluation challenge binding changed');
    }
    factorSecret32 = await openEmailOtpFactorEvaluation({ blinds, evaluation: released });
    const unlocked = await completeEmailOtpUnlockFromSecret32({
      relayUrl,
      walletId,
      authoritySelector: {
        kind: 'wallet_auth_method',
        walletAuthMethodId: String(args.proof.authorityRef.walletAuthMethodId),
      },
      orgId: args.orgId,
      userId: providerSubjectId,
      enrollmentId: released.enrollmentId,
      enrollmentSealKeyVersion: released.enrollmentSealKeyVersion,
      clientSecret32: factorSecret32,
      material,
      // The operation keeps the Wallet Session of its credential.
      walletSessionBudget: null,
      sessionAuth: operationCredential,
    });
    if (unlocked.kind !== 'ed25519_yao_operation_capability') {
      throw new Error('Email OTP operation material did not activate an Ed25519 capability');
    }
    activeClientHandle = unlocked.activeClientHandle;
    assertEmailOtpEd25519OperationMaterialContinuity({
      walletId,
      nearAccountId,
      signerSlot,
      expectedOperationalPublicKey,
      expectedThresholdSessionId,
      expectedMaterialActivation,
      metadata: unlocked.metadata,
      bootstrap: unlocked.ed25519YaoCapability,
    });
    const ownedActiveClientHandle = activeClientHandle;
    activeClientHandle = null;
    return {
      activeClientHandle: ownedActiveClientHandle,
      metadata: unlocked.metadata,
      bootstrap: unlocked.ed25519YaoCapability,
      ...(unlocked.walletCustodyEd25519Material
        ? { walletCustodyEd25519Material: unlocked.walletCustodyEd25519Material }
        : {}),
      issuedAuthorization,
    };
  } catch (error) {
    if (activeClientHandle) removeEmailOtpEd25519YaoActiveClient(activeClientHandle);
    throw error;
  } finally {
    discardEmailOtpDeviceFactorBlinds(blinds);
    zeroizeBytes(factorSecret32);
  }
}

export async function rehydrateActiveEmailOtpEd25519YaoSessionMaterial(
  args: EmailOtpWorkerOperationMap['rehydrateActiveEmailOtpEd25519YaoSessionMaterial']['payload'],
): Promise<
  EmailOtpWorkerOperationMap['rehydrateActiveEmailOtpEd25519YaoSessionMaterial']['result']
> {
  const relayUrl = readString(args.relayUrl, 'relayUrl');
  const walletId = readString(args.walletId, 'walletId');
  const providerSubjectId = readString(args.providerSubjectId, 'providerSubjectId');
  const sessionAuth = parseWalletSessionOperationCredentialV1(args.operationCredential);
  // S comes from the warm seal of this Wallet Session; no route releases S for a bearer alone.
  const released = await emailOtpEd25519WarmSeal.open({
    relayUrl,
    walletId,
    thresholdSessionId: String(args.expectedThresholdSessionId),
    operationCredential: sessionAuth,
  });
  // The unlock below copies what it keeps, so S is zeroed here on every path.
  const factorSecret32 = released.factorSecret32;
  try {
    const unlocked = await completeEmailOtpUnlockFromSecret32({
      relayUrl,
      walletId,
      authoritySelector: {
        kind: 'wallet_auth_method',
        walletAuthMethodId: readString(args.walletAuthMethodId, 'walletAuthMethodId'),
      },
      orgId: readString(args.orgId, 'orgId'),
      userId: providerSubjectId,
      enrollmentId: released.enrollmentId,
      enrollmentSealKeyVersion: released.enrollmentSealKeyVersion,
      clientSecret32: factorSecret32,
      material: activeEmailOtpNearRestoreMaterial(args),
      // The restore joins the active Wallet Session of sessionAuth and keeps its budget.
      walletSessionBudget: null,
      sessionAuth,
    });
    switch (unlocked.kind) {
      case 'ed25519_yao_capability':
        if (args.ecdsa.kind !== 'absent')
          throw new Error('Combined restore omitted ECDSA activation');
        return {
          activeClientHandle: unlocked.activeClientHandle,
          metadata: unlocked.metadata,
          bootstrap: unlocked.ed25519YaoCapability,
          ecdsa: { kind: 'absent' },
          walletSessionAuthorization: unlocked.walletSessionAuthorization,
        };
      case 'wallet_unlock_capabilities':
        if (args.ecdsa.kind !== 'required' || unlocked.ed25519Yao.kind !== 'capability') {
          throw new Error('Active Email OTP Wallet Session did not restore selected capabilities');
        }
        return {
          activeClientHandle: unlocked.ed25519Yao.activeClientHandle,
          metadata: unlocked.ed25519Yao.metadata,
          bootstrap: unlocked.ed25519Yao.bootstrap,
          ecdsa: { kind: 'activated', session: unlocked.ecdsa.session },
          walletSessionAuthorization: unlocked.walletSessionAuthorization,
        };
      default:
        throw new Error('Active Email OTP Wallet Session did not restore selected capabilities');
    }
  } finally {
    zeroizeBytes(factorSecret32);
  }
}

export async function rotateEmailOtpWalletRecoverySet(
  args: EmailOtpWalletCustodySeedUnlock & { readonly recoveryCodesJson: string },
): Promise<EmailOtpWorkerOperationMap['rotateEmailOtpWalletRecoverySet']['result']> {
  const recovered = await unlockEmailOtpWalletCustodySeed(
    args,
    'Email OTP recovery rotation did not return wallet custody material',
  );
  await ensureWalletCustodyCeremonyWasm();
  let handle: WasmCeremonySeedHeldV1 | null = null;
  try {
    const custody = joinCustodyWireFromEnvelopeRecord(recovered.walletCustodyEnvelope);
    if (!custody.ok) throw new Error(custody.reason);
    handle = wallet_custody_ceremony_join_v1(recovered.clientSecret32, custody.custodyJson);
    const resultJson = handle.rotate_recovery_codes(args.recoveryCodesJson);
    handle = null;
    return parseWalletRecoverySetRotationWorkerResultV1(JSON.parse(resultJson));
  } finally {
    handle?.free();
    zeroizeBytes(recovered.clientSecret32);
  }
}

function activeEmailOtpNearRestoreMaterial(
  args: EmailOtpWorkerOperationMap['rehydrateActiveEmailOtpEd25519YaoSessionMaterial']['payload'],
): EmailOtpUnlockSecretMaterialRequest {
  const recovery = {
    kind: ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1,
    signerSlot: args.signerSlot,
    orgId: args.orgId,
  };
  switch (args.ecdsa.kind) {
    case 'absent':
      return {
        kind: 'ed25519_yao_recovery',
        ed25519YaoRecovery: recovery,
        providerSubject: args.providerSubjectId,
        nearAccountId: args.nearAccountId,
        expectedOperationalPublicKey: args.expectedOperationalPublicKey,
        expectedThresholdSessionId: args.expectedThresholdSessionId,
        walletCustodyEd25519Material: args.walletCustodyEd25519Material,
      };
    case 'required':
      return {
        kind: 'wallet_unlock_capabilities',
        ecdsa: {
          sessionHandleBinding: args.ecdsa.sessionHandleBinding,
          runtimePolicyScope: args.ecdsa.runtimePolicyScope,
          sessionPolicy: args.ecdsa.sessionPolicy,
        },
        ed25519Yao: {
          recovery,
          providerSubject: args.providerSubjectId,
          nearAccountId: args.nearAccountId,
          expectedOperationalPublicKey: args.expectedOperationalPublicKey,
          expectedThresholdSessionId: args.expectedThresholdSessionId,
          walletCustodyEd25519Material: args.walletCustodyEd25519Material,
        },
      };
    default:
      args.ecdsa satisfies never;
      throw new Error('Unsupported Email OTP restore selection');
  }
}
