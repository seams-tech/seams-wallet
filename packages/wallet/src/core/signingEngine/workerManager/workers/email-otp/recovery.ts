/**
 * Recovery flows: releasing the recovery factor, rehydrating Ed25519 operation and Wallet
 * Session material, and rotating the recovery set.
 */
import {
  mpcMaterialActivationRefsEqual,
  type MpcMaterialActivationRef,
  type ThresholdEd25519SessionId,
} from '@shared/utils/domainIds';
import { base64UrlEncode } from '@shared/utils/base64';
import { base58Encode } from '@shared/utils/base58';
import { asRecord } from '@shared/utils/validation';
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
import { postEmailOtpJson } from './fetch';
import { readString, readThresholdEd25519SessionId } from './payloadParsing';
import {
  decryptEmailOtpFactorReleaseEnvelope,
  ensureWalletCustodyCeremonyWasm,
  generateEmailOtpFactorReleaseKeyPair,
} from './crypto';
import { releaseEmailOtpFactorSecret } from './otpVerification';
import { removeEmailOtpEd25519YaoActiveClient } from './sessionState';
import type { EmailOtpEd25519OperationRecoveryMaterialRequest } from './custodyRestore';
import {
  completeEmailOtpUnlockFromSecret32,
  type EmailOtpWalletCustodySeedUnlock,
  unlockEmailOtpWalletCustodySeed,
} from './unlock';

export async function releaseWalletRecoveryEmailOtpFactor(
  args: EmailOtpWorkerOperationMap['releaseWalletRecoveryEmailOtpFactor']['payload'],
): Promise<EmailOtpWorkerOperationMap['releaseWalletRecoveryEmailOtpFactor']['result']> {
  const { privateKey, workerPublicKey } = await generateEmailOtpFactorReleaseKeyPair(
    'Email OTP recovery factor release',
  );
  if (workerPublicKey.length !== 65 || workerPublicKey[0] !== 4) {
    throw new Error('Email OTP recovery factor release generated an invalid public key');
  }
  let factorSecret32: Uint8Array | null = null;
  try {
    const released = await postEmailOtpJson({
      relayUrl: readString(args.relayUrl, 'relayUrl'),
      route: '/wallets/recovery/email-otp/release',
      body: {
        recoveryOperationId: readString(args.recoveryOperationId, 'recoveryOperationId'),
        reservationId: readString(args.reservationId, 'reservationId'),
        workerEphemeralPublicKey65B64u: base64UrlEncode(workerPublicKey),
      },
    });
    const responseKind = readString(released.kind, 'recovery factor release.kind');
    const recoveryOperationId = readString(
      released.recoveryOperationId,
      'recovery factor release.recoveryOperationId',
    );
    const reservationId = readString(
      released.reservationId,
      'recovery factor release.reservationId',
    );
    if (
      recoveryOperationId !== String(args.recoveryOperationId).trim() ||
      reservationId !== String(args.reservationId).trim()
    ) {
      throw new Error('Email OTP recovery factor release changed its operation identity');
    }
    if (responseKind === 'wallet_recovery_google_email_otp_new_enrollment_v1') {
      const enrollment = asRecord(released.enrollment);
      if (!enrollment) {
        throw new Error('Email OTP recovery new enrollment response is invalid');
      }
      if (enrollment.kind !== 'create') {
        throw new Error('Email OTP recovery new enrollment kind is invalid');
      }
      return {
        kind: 'create',
        recoveryOperationId,
        reservationId,
        providerSubject: readString(
          enrollment.providerSubject,
          'recovery factor release.enrollment.providerSubject',
        ),
        verifiedEmail: readString(
          enrollment.verifiedEmail,
          'recovery factor release.enrollment.verifiedEmail',
        ),
      };
    }
    if (responseKind !== 'email_otp_factor_release_v1') {
      throw new Error('Email OTP recovery factor release returned an invalid response kind');
    }
    const challengeId = readString(released.challengeId, 'recovery factor release.challengeId');
    const enrollmentId = readString(released.enrollmentId, 'recovery factor release.enrollmentId');
    const providerSubject = readString(
      released.providerSubject,
      'recovery factor release.providerSubject',
    );
    const verifiedEmail = readString(
      released.verifiedEmail,
      'recovery factor release.verifiedEmail',
    );
    const enrollmentSealKeyVersion = readString(
      released.enrollmentSealKeyVersion,
      'recovery factor release.enrollmentSealKeyVersion',
    );
    const decrypted = await decryptEmailOtpFactorReleaseEnvelope({
      walletId: String(args.walletId).trim(),
      challengeId,
      workerPrivateKey: privateKey,
      materialRecovery: {
        kind: 'email_otp_factor_release_v1',
        challengeId,
        enrollmentId,
        enrollmentSealKeyVersion,
        serverEphemeralPublicKey65B64u: readString(
          released.serverEphemeralPublicKey65B64u,
          'recovery factor release.serverEphemeralPublicKey65B64u',
        ),
        nonce12B64u: readString(released.nonce12B64u, 'recovery factor release.nonce12B64u'),
        ciphertextB64u: readString(
          released.ciphertextB64u,
          'recovery factor release.ciphertextB64u',
        ),
      },
    });
    factorSecret32 = decrypted.factorSecret32;
    const ownedFactorSecret32 = Uint8Array.from(factorSecret32).buffer;
    factorSecret32.fill(0);
    factorSecret32 = null;
    return {
      kind: 'existing',
      recoveryOperationId,
      reservationId,
      providerSubject,
      verifiedEmail,
      enrollmentId,
      enrollmentSealKeyVersion,
      factorSecret32: ownedFactorSecret32,
    };
  } finally {
    workerPublicKey.fill(0);
    if (factorSecret32) factorSecret32.fill(0);
  }
}

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
  const { privateKey, workerPublicKey } = await generateEmailOtpFactorReleaseKeyPair(
    'Email OTP operation material',
  );
  let factorSecret32: Uint8Array | null = null;
  let activeClientHandle: string | null = null;
  try {
    if (workerPublicKey.length !== 65 || workerPublicKey[0] !== 4) {
      throw new Error('Email OTP operation material generated an invalid public key');
    }
    const issuedAuthorization = await issueEd25519OperationStepUpAuthorization({
      relayerUrl: relayUrl,
      normalSigningRequest: args.normalSigningRequest,
      displayDigest: readString(args.displayDigest, 'displayDigest'),
      proof: args.proof,
      credential,
      materialRecovery: {
        kind: 'email_otp_factor_release_v1',
        workerEphemeralPublicKey65B64u: base64UrlEncode(workerPublicKey),
      },
    });
    if (issuedAuthorization.materialRecovery.kind !== 'email_otp_factor_release_v1') {
      throw new Error('Email OTP operation step-up did not return factor-release material');
    }
    const released = await decryptEmailOtpFactorReleaseEnvelope({
      walletId,
      challengeId: args.proof.challengeId,
      workerPrivateKey: privateKey,
      materialRecovery: issuedAuthorization.materialRecovery,
    });
    factorSecret32 = released.factorSecret32;
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
    zeroizeBytes(workerPublicKey);
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
  const released = await releaseEmailOtpFactorSecret({
    relayUrl,
    walletId,
    kind: 'wallet_session',
    sessionAuth,
  });
  let factorSecret32: Uint8Array | null = released.factorSecret32;
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
      material: {
        kind: 'wallet_unlock_capabilities',
        ecdsa: args.ecdsa,
        ed25519Yao: {
          providerSubject: providerSubjectId,
          nearAccountId: args.nearAccountId,
          expectedOperationalPublicKey: args.expectedOperationalPublicKey,
          expectedThresholdSessionId: args.expectedThresholdSessionId,
          walletCustodyEd25519Material: args.walletCustodyEd25519Material,
          recovery: {
            kind: ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1,
            signerSlot: args.signerSlot,
            remainingUses: args.remainingUses,
            orgId: args.orgId,
          },
        },
      },
      sessionAuth,
    });
    factorSecret32 = null;
    if (
      unlocked.kind !== 'wallet_unlock_capabilities' ||
      unlocked.ed25519Yao.kind !== 'capability'
    ) {
      throw new Error('Active Email OTP Wallet Session did not restore wallet capabilities');
    }
    return {
      activeClientHandle: unlocked.ed25519Yao.activeClientHandle,
      metadata: unlocked.ed25519Yao.metadata,
      bootstrap: unlocked.ed25519Yao.bootstrap,
      ecdsaSession: unlocked.ecdsa.session,
      walletSessionAuthorization: unlocked.walletSessionAuthorization,
    };
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
