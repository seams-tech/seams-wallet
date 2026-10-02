/**
 * Wallet unlock with a released Email OTP factor: signs the unlock challenge, verifies it with
 * the Router and returns the material the requested capabilities need.
 */
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import type { Variant } from '@shared/utils/variant';
import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import { toOptionalTrimmedNonEmptyString } from '@shared/utils/validation';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_ACTIONS,
  WALLET_EMAIL_OTP_UNLOCK_OPERATION,
} from '@shared/utils/emailOtpDomain';
import {
  parseActiveWalletSessionV1,
  parseWalletSessionOperationCredentialV1,
  type WalletSessionOperationCredentialV1,
} from '@shared/device-linking';
import { bindEmailOtpEcdsaSessionPolicyToUnlockChallenge } from '@/core/signingEngine/session/emailOtp/ecdsaUnlockChallengeBinding';
import type { EmailOtpVerifiedAuthorityProjection } from '@/core/signingEngine/session/emailOtp/publicTypes';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import type { LoadedWalletCustodyEd25519MaterialV1 } from '@/core/signingEngine/walletCustody/ed25519SeedMaterial';
import type {
  EmailOtpEd25519YaoRecoveryAugmentationV1,
  EmailOtpEd25519YaoRecoveryBootstrapV1,
  EmailOtpEcdsaCustodyRestoreV1,
  EmailOtpAuthoritySelector,
  EmailOtpWalletUnlockMaterialRequest,
  EmailOtpWorkerOperationMap,
  EmailOtpWorkerProgressCode,
} from '@/core/signingEngine/workerManager/workerTypes';
import type { RouterAbEd25519YaoActiveClientMetadataV1 } from '../../../threshold/ed25519/yaoClient';
import type { WalletRegistrationEd25519YaoBootstrapSession } from '@shared/utils/registrationContracts';
import {
  parseRouterAbEcdsaCredentialFreeSessionActivationResponseV1,
  parseRouterAbEcdsaPostRegistrationSessionActivationResponseV1,
  type RouterAbEcdsaCredentialFreeSessionActivationResponseV1,
  type RouterAbEcdsaPostRegistrationSessionActivationResponseV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { ExactWalletSessionAuthorization } from '../../../session/persistence/walletSessionAuthorizationProjection';
import {
  secp256k1_private_key_32_to_public_key_33,
  sign_secp256k1_recoverable,
} from '../../../../../../../../wasm/evm_crypto/pkg/evm_crypto.js';
import { postEmailOtpJson } from './fetch';
import type { EmailOtpRoutePlan } from '../../../stepUpConfirmation/otpPrompt/authLane';
import {
  assertNeverEmailOtpWorker,
  emailOtpAuthoritySelectorBody,
  readString,
  resolveEmailOtpAuthSubjectId,
} from './payloadParsing';
import { parseEmailOtpEd25519YaoRecoveryBootstrap } from './materialParsing';
import { deriveEmailOtpUnlockAuthSeedInWorker, ensureEvmCryptoWasm } from './crypto';
import {
  emailOtpRouteSessionAuth,
  postEmailOtpChallenge,
  releaseEmailOtpFactorSecret,
} from './otpVerification';
import {
  bindEmailOtpEcdsaWarmSessionFactor,
  bindEmailOtpEd25519YaoCapabilityWarmFactor,
  type EmailOtpEd25519YaoWorkerActivationHandle,
  removeEmailOtpEd25519YaoActiveClient,
} from './sessionState';
import {
  type EmailOtpUnlockSecretMaterialRequest,
  type EmailOtpWalletCustodyUnlockProjection,
  parseEmailOtpEcdsaCustodyContinuity,
  parseEmailOtpWalletCustodyUnlockProjection,
  parseEmailOtpWalletUnlockBootstrapSession,
  parseEmailOtpWalletUnlockExactSessionAuthorization,
  requireVerifiedEmailOtpAuthorityProjection,
  resolveEmailOtpWalletUnlockExactSessionAuthorization,
  restoreEmailOtpEcdsaMaterialFromCustody,
  restoreEmailOtpEd25519FromCustodyCache,
} from './custodyRestore';

type EmailOtpEd25519SessionMaterialRequest = Extract<
  EmailOtpWalletUnlockMaterialRequest,
  {
    kind: 'ed25519_yao_recovery' | 'wallet_unlock_capabilities';
  }
>;

function emailOtpEd25519SessionRequest(
  material: EmailOtpEd25519SessionMaterialRequest,
): EmailOtpEd25519YaoRecoveryAugmentationV1 {
  switch (material.kind) {
    case 'ed25519_yao_recovery':
      return material.ed25519YaoRecovery;
    case 'wallet_unlock_capabilities':
      return material.ed25519Yao.recovery;
    default:
      return assertNeverEmailOtpWorker(material);
  }
}

function emailOtpEd25519SessionIdentity(material: EmailOtpEd25519SessionMaterialRequest): {
  providerSubject: string;
  nearAccountId: string;
  expectedOperationalPublicKey: string;
  expectedThresholdSessionId: string;
} {
  if (material.kind === 'wallet_unlock_capabilities') {
    return material.ed25519Yao;
  }
  return material;
}

function assertEmailOtpEd25519SessionMaterialIdentity(args: {
  material: EmailOtpEd25519SessionMaterialRequest;
}): void {
  const sessionRequest = emailOtpEd25519SessionRequest(args.material);
  const { providerSubject } = emailOtpEd25519SessionIdentity(args.material);
  if (!providerSubject.trim() || !sessionRequest.orgId.trim()) {
    throw new Error('Email OTP Ed25519 session requires its provider and organization identity');
  }
}

export function assertEmailOtpUnlockMaterialRouteAuth(args: {
  routePlan: EmailOtpRoutePlan;
  material: EmailOtpWalletUnlockMaterialRequest;
}): void {
  const carriesEcdsaActivation =
    (args.material.kind === 'ecdsa' && Boolean(args.material.ecdsaSessionPolicy)) ||
    args.material.kind === 'wallet_unlock_capabilities';
  /* One direction only: an Ed25519-only wallet unlocks without any ECDSA
     activation, so wallet_unlock does not imply ECDSA-bearing material. */
  if (carriesEcdsaActivation && args.routePlan.operation !== WALLET_EMAIL_OTP_UNLOCK_OPERATION) {
    throw new Error('Only Email OTP wallet unlock may carry first ECDSA session activation');
  }
  switch (args.material.kind) {
    case 'ecdsa':
      return;
    case 'wallet_unlock_capabilities':
      assertEmailOtpEd25519SessionMaterialIdentity({ material: args.material });
      if (
        args.material.ecdsa.sessionHandleBinding.authSubjectId !==
          args.material.ed25519Yao.providerSubject ||
        args.material.ecdsa.runtimePolicyScope.orgId !== args.material.ed25519Yao.recovery.orgId
      ) {
        throw new Error('Email OTP capability unlock ECDSA and Ed25519 identities do not match');
      }
      return;
    case 'ed25519_yao_recovery': {
      assertEmailOtpEd25519SessionMaterialIdentity({ material: args.material });
      /* Two legitimate carriers. A cold wallet unlock presents a fresh OTP as
         its proof and has no session to authenticate with — the same
         activation a combined wallet performs through
         `wallet_unlock_capabilities`. A signing-session rejoin has a session
         and must present its exact Ed25519 wallet session below. */
      if (
        args.routePlan.routeFamily === 'login' &&
        args.routePlan.operation === WALLET_EMAIL_OTP_UNLOCK_OPERATION
      ) {
        return;
      }
      if (args.routePlan.routeFamily !== 'signing_session') {
        throw new Error(
          'Email OTP Ed25519 session requires a wallet-unlock or signing-session route plan',
        );
      }
      const operationCredential = args.routePlan.authLane.operationCredential;
      const usesEd25519WalletSession =
        operationCredential.kind === 'opaque_wallet_session_operation_credential_v1' &&
        args.routePlan.authLane.curve === 'ed25519';
      if (!usesEd25519WalletSession) {
        throw new Error('Email OTP Ed25519 session requires an authenticated route plan');
      }
      return;
    }
    default:
      return assertNeverEmailOtpWorker(args.material);
  }
}

export async function unlockEmailOtpAuthorityWallet(
  args: EmailOtpWorkerOperationMap['unlockEmailOtpAuthorityWallet']['payload'],
): Promise<EmailOtpWorkerOperationMap['unlockEmailOtpAuthorityWallet']['result']> {
  await ensureEvmCryptoWasm();
  const relayUrl = readString(args.relayUrl, 'relayUrl');
  const walletId = readString(args.walletId, 'walletId');
  const walletAuthMethodId = readString(args.walletAuthMethodId, 'walletAuthMethodId');
  const challengeId = readString(args.challengeId, 'challengeId');
  const otpCode = readString(args.otpCode, 'otpCode');
  const released = await releaseEmailOtpFactorSecret({
    relayUrl,
    walletId,
    authoritySelector: { kind: 'wallet_auth_method', walletAuthMethodId },
    challengeId,
    otpCode,
    operation: WALLET_EMAIL_OTP_UNLOCK_OPERATION,
    kind: 'email_otp',
    sessionAuth: undefined,
  });
  let factorSecret32: Uint8Array | null = released.factorSecret32;
  let challengeDigest32: Uint8Array | null = null;
  let unlockPrivateKey32: Uint8Array | null = null;
  let unlockPublicKey33: Uint8Array | null = null;
  let unlockSignature65: Uint8Array | null = null;
  try {
    const unlockChallenge = await postEmailOtpJson({
      relayUrl,
      route: '/wallet/unlock/challenge',
      body: {
        unlockBackend: 'email_otp',
        walletId,
        walletAuthMethodId,
      },
    });
    const unlockChallengeId = readString(unlockChallenge.challengeId, 'challengeId');
    const unlockChallengeB64u = readString(unlockChallenge.challengeB64u, 'challengeB64u');
    challengeDigest32 = base64UrlDecode(unlockChallengeB64u);
    if (challengeDigest32.length !== 32) {
      throw new Error('wallet/unlock/challenge challengeB64u must decode to 32 bytes');
    }
    if (!factorSecret32) {
      throw new Error('Email OTP factor release did not return a factor secret');
    }
    unlockPrivateKey32 = await deriveEmailOtpUnlockAuthSeedInWorker({
      clientSecret32: factorSecret32,
      walletId,
    });
    unlockPublicKey33 = secp256k1_private_key_32_to_public_key_33(unlockPrivateKey32) as Uint8Array;
    unlockSignature65 = sign_secp256k1_recoverable(
      challengeDigest32,
      unlockPrivateKey32,
    ) as Uint8Array;
    const verified = await postEmailOtpJson({
      relayUrl,
      route: '/wallet/unlock/verify',
      body: {
        unlockBackend: 'email_otp',
        walletId,
        walletAuthMethodId,
        challengeId: unlockChallengeId,
        unlockProof: {
          publicKey: base64UrlEncode(unlockPublicKey33),
          signature: base64UrlEncode(unlockSignature65),
        },
        requestedCapabilities:
          args.ed25519.kind === 'no_ed25519'
            ? { kind: 'wallet_session' }
            : {
                kind: 'ed25519_yao',
                signerSlot: args.ed25519.signerSlot,
                remainingUses: args.ed25519.remainingUses,
              },
      },
    });
    const verifiedAuthorityProjection = requireVerifiedEmailOtpAuthorityProjection({
      raw: verified.verifiedAuthorityProjection,
      walletId,
      authoritySelector: { kind: 'wallet_auth_method', walletAuthMethodId },
    });
    const walletCustody = ownerEmailOtpWalletCustodyProjection({
      verifiedAuthorityProjection,
      rawWalletCustody: verified.walletCustody,
      walletId,
      enrollmentId: released.enrollmentId,
      enrollmentSealKeyVersion: released.enrollmentSealKeyVersion,
    });
    const walletCustodySeed: EmailOtpWorkerOperationMap['unlockEmailOtpAuthorityWallet']['result']['walletCustodySeed'] =
      walletCustody
        ? {
            kind: 'owner_authority_seed_envelope',
            existingEnvelope: walletCustody.envelope,
          }
        : { kind: 'linked_device_seed_unavailable' };
    const walletSession = parseActiveWalletSessionV1(verified.walletSession);
    const operationCredential = parseWalletSessionOperationCredentialV1(
      verified.operationCredential,
    );
    if (
      String(walletSession.walletId) !== walletId ||
      String(walletSession.authMethodId) !== walletAuthMethodId
    ) {
      throw new Error('Email OTP authority Wallet Session identity changed');
    }
    let ed25519Activation: EmailOtpWorkerOperationMap['unlockEmailOtpAuthorityWallet']['result']['ed25519Activation'] =
      { kind: 'ed25519_activation_absent' };
    if (args.ed25519.kind !== 'no_ed25519') {
      const bootstrap = parseEmailOtpEd25519YaoRecoveryBootstrap(verified.ed25519YaoCapability, {
        kind: 'wallet_unlock_response',
        unlockCredential: verified.operationCredential,
      });
      if (args.ed25519.kind === 'linked_device') {
        /* A linked device opens its own sealed material after this call, so the
           bootstrap is all it needs from here. */
        ed25519Activation = { kind: 'ed25519_bootstrap_only', bootstrap };
      } else {
        /* An owner authority has no sealed material of its own. The verify
           response above already carried the custody projection, so the runtime
           is built here from the seed this unlock already holds rather than by
           verifying the factor a second time somewhere else. */
        if (!walletCustody) {
          throw new Error('Email OTP owner authority unlock omitted wallet custody');
        }
        if (!factorSecret32) {
          throw new Error('Email OTP authority unlock lost its factor secret');
        }
        const restored = await restoreEmailOtpEd25519FromCustodyCache({
          projection: walletCustody,
          material: {
            kind: 'ed25519_yao_recovery',
            ed25519YaoRecovery: args.ed25519.recovery.ed25519YaoRecovery,
            providerSubject: args.ed25519.recovery.providerSubject,
            nearAccountId: args.ed25519.recovery.nearAccountId,
            expectedOperationalPublicKey: args.ed25519.recovery.expectedOperationalPublicKey,
            expectedThresholdSessionId: args.ed25519.recovery.expectedThresholdSessionId,
            walletCustodyEd25519Material: args.ed25519.recovery.walletCustodyEd25519Material,
          },
          bootstrap,
          clientSecret32: factorSecret32,
        });
        if (restored.kind !== 'opened') {
          throw new Error(`Email OTP authority Ed25519 runtime is ${restored.kind}`);
        }
        ed25519Activation = {
          kind: 'ed25519_activation_ready',
          activeClientHandle: restored.activeClientHandle,
          metadata: restored.metadata,
          bootstrap,
        };
      }
    }
    const ownedFactorSecret32 = factorSecret32;
    factorSecret32 = null;
    return {
      kind: 'email_otp_authority_wallet_unlock_v1',
      factorSecret32: ownedFactorSecret32,
      walletSession,
      operationCredential,
      verifiedAuthorityProjection,
      walletCustodySeed,
      ed25519Activation,
    };
  } finally {
    zeroizeBytes(factorSecret32);
    zeroizeBytes(challengeDigest32);
    zeroizeBytes(unlockPrivateKey32);
    zeroizeBytes(unlockPublicKey33);
    zeroizeBytes(unlockSignature65);
  }
}

function ownerEmailOtpWalletCustodyProjection(args: {
  readonly verifiedAuthorityProjection: EmailOtpVerifiedAuthorityProjection;
  readonly rawWalletCustody: unknown;
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly enrollmentSealKeyVersion: string;
}): EmailOtpWalletCustodyUnlockProjection | null {
  switch (args.verifiedAuthorityProjection.authority.provenance.kind) {
    case 'wallet_registration':
    case 'wallet_recovery':
      return parseEmailOtpWalletCustodyUnlockProjection({
        raw: args.rawWalletCustody,
        walletId: args.walletId,
        enrollmentId: args.enrollmentId,
        enrollmentSealKeyVersion: args.enrollmentSealKeyVersion,
      });
    case 'device_link':
      return null;
    default:
      return assertNeverEmailOtpWorker(args.verifiedAuthorityProjection.authority.provenance);
  }
}

type EmailOtpOpenedEd25519YaoCapability = {
  activeClientHandle: string;
  metadata: RouterAbEd25519YaoActiveClientMetadataV1;
  ed25519YaoCapability: EmailOtpEd25519YaoRecoveryBootstrapV1;
  walletCustodyEd25519Material?: LoadedWalletCustodyEd25519MaterialV1;
  walletCustodyEnvelope: PasskeyCustodyEnvelopeRecord;
};

type EmailOtpUnlockProof = {
  unlockChallengeId: string;
  unlockChallengeB64u: string;
  clientUnlockPublicKeyB64u: string;
  unlockSignatureB64u: string;
  verifiedAuthorityProjection: EmailOtpVerifiedAuthorityProjection;
};

type EmailOtpUnlockCompletionMaterial =
  | {
      kind: 'ecdsa';
      ecdsaSession?: RouterAbEcdsaPostRegistrationSessionActivationResponseV1;
      ecdsaCustody?: EmailOtpEcdsaCustodyRestoreV1;
    }
  | {
      kind: 'ed25519_yao_export';
      walletCustodyEnvelope: PasskeyCustodyEnvelopeRecord;
    }
  | {
      kind: 'wallet_custody_cache_absent';
      ed25519YaoRecovery: EmailOtpEd25519YaoRecoveryBootstrapV1;
    }
  | ({
      kind: 'ed25519_yao_capability';
      walletSessionAuthorization: ExactWalletSessionAuthorization;
    } & EmailOtpOpenedEd25519YaoCapability)
  | ({ kind: 'ed25519_yao_operation_capability' } & EmailOtpOpenedEd25519YaoCapability)
  | {
      kind: 'wallet_unlock_capabilities';
      walletCustodyEnvelope: PasskeyCustodyEnvelopeRecord;
      walletSessionAuthorization: ExactWalletSessionAuthorization;
      ecdsa: {
        session: RouterAbEcdsaCredentialFreeSessionActivationResponseV1;
        custody: EmailOtpEcdsaCustodyRestoreV1;
      };
      ed25519Yao:
        | {
            kind: 'wallet_custody_cache_absent';
            bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
          }
        | {
            kind: 'capability';
            activeClientHandle: string;
            metadata: RouterAbEd25519YaoActiveClientMetadataV1;
            bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
          };
    };

function requireEmailOtpWorkerCredentialFreeEcdsaSessionResponse(
  value: RouterAbEcdsaCredentialFreeSessionActivationResponseV1 | undefined,
): RouterAbEcdsaCredentialFreeSessionActivationResponseV1 {
  if (!value) throw new Error('Email OTP unlock did not return its first ECDSA Wallet Session');
  return value;
}

function requireEmailOtpWalletUnlockBootstrapSession(
  value: WalletRegistrationEd25519YaoBootstrapSession | undefined,
): WalletRegistrationEd25519YaoBootstrapSession {
  if (!value) throw new Error('Email OTP Ed25519 Wallet Session is unavailable');
  return value;
}

function requireEmailOtpWorkerEcdsaCustodyRestore(
  value: EmailOtpEcdsaCustodyRestoreV1 | undefined,
): EmailOtpEcdsaCustodyRestoreV1 {
  if (!value) throw new Error('Email OTP unlock did not restore ECDSA custody');
  return value;
}

type EmailOtpRequestedCapabilities =
  | {
      kind: 'none';
    }
  | {
      kind: 'wallet_session';
    }
  | {
      kind: 'ed25519_yao';
      signerSlot: number;
      remainingUses: number;
    };

function buildEmailOtpRequestedCapabilities(args: {
  material: EmailOtpUnlockSecretMaterialRequest;
}): EmailOtpRequestedCapabilities {
  switch (args.material.kind) {
    case 'ecdsa':
      // Direct ECDSA unlock carries its own credential-bearing activation.
      return { kind: 'none' };
    case 'ed25519_yao_export':
      return { kind: 'none' };
    case 'ed25519_yao_operation_recovery':
      return { kind: 'none' };
    case 'ed25519_yao_recovery':
    case 'wallet_unlock_capabilities': {
      const request = emailOtpEd25519SessionRequest(args.material);
      return {
        kind: 'ed25519_yao',
        signerSlot: request.signerSlot,
        remainingUses: request.remainingUses,
      };
    }
    default:
      return assertNeverEmailOtpWorker(args.material);
  }
}

export async function completeEmailOtpUnlockFromSecret32(args: {
  relayUrl: string;
  walletId: string;
  authoritySelector: EmailOtpAuthoritySelector;
  orgId?: string;
  userId: string;
  enrollmentId: string;
  enrollmentSealKeyVersion: string;
  clientSecret32: Uint8Array;
  material: EmailOtpUnlockSecretMaterialRequest;
  sessionAuth: WalletSessionOperationCredentialV1 | undefined;
}): Promise<EmailOtpUnlockProof & EmailOtpUnlockCompletionMaterial> {
  await ensureEvmCryptoWasm();
  const relayUrl = readString(args.relayUrl, 'relayUrl');
  const walletId = readString(args.walletId, 'walletId');
  readString(args.userId, 'userId');
  const challenge = await postEmailOtpJson({
    relayUrl: readString(args.relayUrl, 'relayUrl'),
    route: '/wallet/unlock/challenge',
    body: {
      unlockBackend: 'email_otp',
      walletId,
      ...emailOtpAuthoritySelectorBody(args.authoritySelector),
      ...(toOptionalTrimmedNonEmptyString(args.orgId)
        ? { orgId: toOptionalTrimmedNonEmptyString(args.orgId) }
        : {}),
    },
  });
  const unlockChallengeId = readString(challenge.challengeId, 'challengeId');
  const unlockChallengeB64u = readString(challenge.challengeB64u, 'challengeB64u');
  const challengeDigest32: Uint8Array | null = base64UrlDecode(unlockChallengeB64u);
  if (challengeDigest32.length !== 32) {
    zeroizeBytes(challengeDigest32);
    throw new Error('wallet/unlock/challenge challengeB64u must decode to 32 bytes');
  }

  let unlockPrivateKey32: Uint8Array | null = null;
  let unlockPublicKey33: Uint8Array | null = null;
  let unlockSignature65: Uint8Array | null = null;
  let openedEd25519Client: EmailOtpEd25519YaoWorkerActivationHandle | null = null;
  try {
    unlockPrivateKey32 = await deriveEmailOtpUnlockAuthSeedInWorker({
      clientSecret32: args.clientSecret32,
      walletId,
    });
    unlockPublicKey33 = secp256k1_private_key_32_to_public_key_33(unlockPrivateKey32) as Uint8Array;
    unlockSignature65 = sign_secp256k1_recoverable(
      challengeDigest32,
      unlockPrivateKey32,
    ) as Uint8Array;

    const clientUnlockPublicKeyB64u = base64UrlEncode(unlockPublicKey33);
    const unlockSignatureB64u = base64UrlEncode(unlockSignature65);

    const requestedCapabilities = buildEmailOtpRequestedCapabilities({
      material: args.material,
    });
    const ecdsaSessionPolicy =
      args.material.kind === 'ecdsa' || args.material.kind === 'wallet_unlock_capabilities'
        ? bindEmailOtpEcdsaSessionPolicyToUnlockChallenge(args.material, unlockChallengeId)
        : null;
    const verified = await postEmailOtpJson({
      relayUrl: readString(args.relayUrl, 'relayUrl'),
      route: '/wallet/unlock/verify',
      ...(args.sessionAuth ? { sessionAuth: args.sessionAuth } : {}),
      body: {
        unlockBackend: 'email_otp',
        walletId,
        ...emailOtpAuthoritySelectorBody(args.authoritySelector),
        ...(toOptionalTrimmedNonEmptyString(args.orgId)
          ? { orgId: toOptionalTrimmedNonEmptyString(args.orgId) }
          : {}),
        challengeId: unlockChallengeId,
        unlockProof: {
          publicKey: clientUnlockPublicKeyB64u,
          signature: unlockSignatureB64u,
        },
        ...(ecdsaSessionPolicy ? { ecdsaSessionPolicy } : {}),
        requestedCapabilities,
      },
    });
    const verifiedAuthorityProjection = requireVerifiedEmailOtpAuthorityProjection({
      raw: verified.verifiedAuthorityProjection,
      walletId,
      authoritySelector: args.authoritySelector,
    });
    const walletCustody = parseEmailOtpWalletCustodyUnlockProjection({
      raw: verified.walletCustody,
      walletId,
      enrollmentId: args.enrollmentId,
      enrollmentSealKeyVersion: args.enrollmentSealKeyVersion,
    });
    const ecdsaCustody =
      args.material.kind === 'ecdsa' && args.material.ecdsaSessionPolicy
        ? parseEmailOtpEcdsaCustodyContinuity(verified.ecdsaCustody)
        : args.material.kind === 'wallet_unlock_capabilities'
          ? parseEmailOtpEcdsaCustodyContinuity(verified.ecdsaCustody)
          : undefined;
    const ecdsaCustodyRestore = ecdsaCustody
      ? await restoreEmailOtpEcdsaMaterialFromCustody({
          projection: walletCustody,
          clientSecret32: args.clientSecret32,
          material: args.material,
          continuity: ecdsaCustody,
        })
      : undefined;
    const ed25519YaoBootstrap =
      args.material.kind === 'ed25519_yao_operation_recovery'
        ? args.material.bootstrap
        : args.material.kind === 'ed25519_yao_recovery' ||
            args.material.kind === 'wallet_unlock_capabilities'
          ? parseEmailOtpEd25519YaoRecoveryBootstrap(verified.ed25519YaoCapability, {
              kind: 'wallet_unlock_response',
              unlockCredential: verified.operationCredential,
            })
          : null;
    const walletUnlockEd25519YaoSession =
      args.material.kind === 'wallet_unlock_capabilities'
        ? parseEmailOtpWalletUnlockBootstrapSession(
            verified.ed25519YaoCapability,
            verified.operationCredential,
          )
        : undefined;
    if (
      ed25519YaoBootstrap &&
      (args.material.kind === 'ed25519_yao_recovery' ||
        args.material.kind === 'ed25519_yao_operation_recovery' ||
        args.material.kind === 'wallet_unlock_capabilities')
    ) {
      const restored = await restoreEmailOtpEd25519FromCustodyCache({
        projection: walletCustody,
        material: args.material,
        bootstrap: ed25519YaoBootstrap,
        clientSecret32: args.clientSecret32,
      });
      if (restored.kind === 'opened') {
        openedEd25519Client = {
          activeClientHandle: restored.activeClientHandle,
          metadata: restored.metadata,
        };
      }
    }
    const ecdsaSession =
      args.material.kind === 'ecdsa' && args.material.ecdsaSessionPolicy
        ? parseRouterAbEcdsaPostRegistrationSessionActivationResponseV1(verified.ecdsaSession)
        : undefined;
    const walletUnlockEcdsaSession =
      args.material.kind === 'wallet_unlock_capabilities'
        ? parseRouterAbEcdsaCredentialFreeSessionActivationResponseV1(verified.ecdsaSession)
        : undefined;
    const walletSessionAuthorization =
      args.material.kind === 'wallet_unlock_capabilities'
        ? await parseEmailOtpWalletUnlockExactSessionAuthorization({
            relayUrl,
            rawWalletSession: verified.walletSession,
            rawOperationCredential: verified.operationCredential,
            walletId,
            providerSubjectId: args.material.ed25519Yao.providerSubject,
            verifiedAuthorityProjection,
            activation:
              requireEmailOtpWorkerCredentialFreeEcdsaSessionResponse(walletUnlockEcdsaSession),
            ed25519Session: requireEmailOtpWalletUnlockBootstrapSession(
              walletUnlockEd25519YaoSession,
            ),
          })
        : args.material.kind === 'ed25519_yao_recovery' && ed25519YaoBootstrap
          ? await resolveEmailOtpWalletUnlockExactSessionAuthorization({
              relayUrl,
              rawWalletSession: verified.walletSession,
              rawOperationCredential: verified.operationCredential,
              walletId,
              providerSubjectId: args.material.providerSubject,
              verifiedAuthorityProjection,
              ed25519Session: parseEmailOtpWalletUnlockBootstrapSession(
                verified.ed25519YaoCapability,
                verified.operationCredential,
              ),
            })
          : undefined;
    const warmSession = ecdsaSession ?? walletUnlockEcdsaSession;
    if (warmSession) {
      bindEmailOtpEcdsaWarmSessionFactor({
        session: warmSession.session,
        factorSecret32: args.clientSecret32,
      });
    }
    const commonResult = {
      unlockChallengeId,
      unlockChallengeB64u,
      clientUnlockPublicKeyB64u,
      unlockSignatureB64u,
      verifiedAuthorityProjection,
    };
    switch (args.material.kind) {
      case 'ecdsa': {
        return {
          kind: 'ecdsa',
          ...commonResult,
          ...(ecdsaSession ? { ecdsaSession } : {}),
          ...(ecdsaCustodyRestore ? { ecdsaCustody: ecdsaCustodyRestore } : {}),
        };
      }
      case 'ed25519_yao_export':
        return {
          kind: 'ed25519_yao_export',
          ...commonResult,
          walletCustodyEnvelope: walletCustody.envelope,
        };
      case 'wallet_unlock_capabilities': {
        if (!walletSessionAuthorization) {
          throw new Error('Email OTP unlock did not return its exact Wallet Session');
        }
        if (!ed25519YaoBootstrap) {
          throw new Error('Email OTP Ed25519 custody capability was not returned');
        }
        let ed25519Yao: EmailOtpCompletion<'wallet_unlock_capabilities'>['ed25519Yao'];
        if (openedEd25519Client) {
          bindEmailOtpEd25519YaoCapabilityWarmFactor({
            bootstrap: ed25519YaoBootstrap,
            factorSecret32: args.clientSecret32,
            materialActivation: ed25519YaoBootstrap.capability.materialActivation,
          });
          const opened = openedEd25519Client;
          openedEd25519Client = null;
          ed25519Yao = {
            kind: 'capability',
            activeClientHandle: opened.activeClientHandle,
            metadata: opened.metadata,
            bootstrap: ed25519YaoBootstrap,
          };
        } else {
          ed25519Yao = { kind: 'wallet_custody_cache_absent', bootstrap: ed25519YaoBootstrap };
        }
        return {
          kind: 'wallet_unlock_capabilities',
          ...commonResult,
          walletCustodyEnvelope: walletCustody.envelope,
          walletSessionAuthorization,
          ecdsa: {
            session:
              requireEmailOtpWorkerCredentialFreeEcdsaSessionResponse(walletUnlockEcdsaSession),
            custody: requireEmailOtpWorkerEcdsaCustodyRestore(ecdsaCustodyRestore),
          },
          ed25519Yao,
        };
      }
      case 'ed25519_yao_recovery':
        if (openedEd25519Client) {
          const ed25519YaoCapability = ed25519YaoBootstrap;
          if (!ed25519YaoCapability) {
            throw new Error('Email OTP Ed25519 custody capability was not returned');
          }
          if (!walletSessionAuthorization) {
            throw new Error('Email OTP Ed25519 unlock did not return its exact Wallet Session');
          }
          bindEmailOtpEd25519YaoCapabilityWarmFactor({
            bootstrap: ed25519YaoCapability,
            factorSecret32: args.clientSecret32,
            materialActivation: ed25519YaoCapability.capability.materialActivation,
          });
          const opened = openedEd25519Client;
          openedEd25519Client = null;
          return {
            kind: 'ed25519_yao_capability',
            ...commonResult,
            activeClientHandle: opened.activeClientHandle,
            metadata: opened.metadata,
            ed25519YaoCapability,
            walletSessionAuthorization,
            walletCustodyEnvelope: walletCustody.envelope,
          };
        }
        if (!ed25519YaoBootstrap) {
          throw new Error('Email OTP Ed25519 custody capability was not returned');
        }
        return {
          kind: 'wallet_custody_cache_absent',
          ...commonResult,
          ed25519YaoRecovery: ed25519YaoBootstrap,
        };
      case 'ed25519_yao_operation_recovery':
        if (openedEd25519Client) {
          const ed25519YaoCapability = ed25519YaoBootstrap;
          if (!ed25519YaoCapability) {
            throw new Error('Email OTP Ed25519 custody capability was not returned');
          }
          const opened = openedEd25519Client;
          openedEd25519Client = null;
          return {
            kind: 'ed25519_yao_operation_capability',
            ...commonResult,
            activeClientHandle: opened.activeClientHandle,
            metadata: opened.metadata,
            ed25519YaoCapability,
            walletCustodyEnvelope: walletCustody.envelope,
          };
        }
        throw new Error('Email OTP Ed25519 operation material is unavailable');
      default:
        return assertNeverEmailOtpWorker(args.material);
    }
  } finally {
    if (openedEd25519Client) {
      removeEmailOtpEd25519YaoActiveClient(openedEd25519Client.activeClientHandle);
    }
    zeroizeBytes(challengeDigest32);
    zeroizeBytes(unlockPrivateKey32);
    zeroizeBytes(unlockPublicKey33);
    zeroizeBytes(unlockSignature65);
  }
}

export type EmailOtpWalletUnlockVerification =
  EmailOtpWorkerOperationMap['loginWithEmailOtpWallet']['payload']['verification'];

type EmailOtpCompletion<K extends EmailOtpUnlockCompletionMaterial['kind']> = Variant<
  EmailOtpUnlockCompletionMaterial,
  'kind',
  K
>;

/** What a login unlock hands back: the completion plus the factor secret it may own. */
type EmailOtpLoginUnlockMaterial =
  | (EmailOtpCompletion<'ecdsa'> & { clientSecret32?: never; ed25519YaoRecovery?: never })
  | (EmailOtpCompletion<'ed25519_yao_export'> & {
      clientSecret32: Uint8Array;
      ed25519YaoRecovery?: never;
    })
  | EmailOtpCompletion<'wallet_custody_cache_absent'>
  | (EmailOtpCompletion<'ed25519_yao_capability'> & {
      /* An Ed25519-only unlock carries the same export-root custody a
         combined unlock returns, so the main thread can establish the
         unlocked export-root capability. */
      clientSecret32: Uint8Array;
      ed25519YaoRecovery?: never;
    })
  | (EmailOtpCompletion<'wallet_unlock_capabilities'> & { clientSecret32: Uint8Array });

export async function loginWithEmailOtpAndUnlockWallet(args: {
  relayUrl: string;
  walletId: string;
  authoritySelector: EmailOtpAuthoritySelector;
  orgId?: string;
  userId: string;
  verification: EmailOtpWalletUnlockVerification;
  groupId: string;
  routePlan: EmailOtpRoutePlan;
  factorReleaseSessionAuth?: WalletSessionOperationCredentialV1;
  material: EmailOtpUnlockSecretMaterialRequest;
  onProgress?: (code: EmailOtpWorkerProgressCode) => void;
}): Promise<
  { challengeId: string; enrollmentSealKeyVersion: string } & EmailOtpUnlockProof &
    EmailOtpLoginUnlockMaterial
> {
  const relayUrl = readString(args.relayUrl, 'relayUrl');
  const walletId = readString(args.walletId, 'walletId');
  readString(args.groupId, 'groupId');
  let clientSecret32: Uint8Array | null = null;
  try {
    const sessionAuth = emailOtpRouteSessionAuth(args.routePlan);
    let challengeId: string;
    if (args.verification.kind === 'email_otp_unseal_grant') {
      challengeId = args.verification.challengeId;
    } else {
      const providedChallengeId = toOptionalTrimmedNonEmptyString(args.verification.challengeId);
      if (providedChallengeId) {
        challengeId = providedChallengeId;
      } else {
        const challenge = await postEmailOtpChallenge({
          relayUrl,
          routePlan: args.routePlan,
          body: {
            walletId,
            ...emailOtpAuthoritySelectorBody(args.authoritySelector),
            otpChannel: EMAIL_OTP_CHANNEL,
            operation: args.routePlan.operation,
          },
          expectedAction: WALLET_EMAIL_OTP_ACTIONS.login,
          label: 'Email OTP login challenge',
        });
        challengeId = readString(
          (challenge.challenge as Record<string, unknown>)?.challengeId,
          'challengeId',
        );
      }
    }
    const userId = resolveEmailOtpAuthSubjectId({ userId: args.userId });
    const released = await releaseEmailOtpFactorSecret({
      relayUrl,
      walletId,
      challengeId,
      sessionAuth: args.factorReleaseSessionAuth || sessionAuth,
      ...(args.verification.kind === 'email_otp_unseal_grant'
        ? { kind: 'verified_grant', loginGrant: args.verification.grant }
        : {
            kind: 'email_otp',
            authoritySelector: args.authoritySelector,
            otpCode: readString(args.verification.otpCode, 'otpCode'),
            operation: args.routePlan.operation,
          }),
    });
    if (args.verification.kind === 'otp') args.onProgress?.('otp.verify.succeeded');
    const enrollmentSealKeyVersion = released.enrollmentSealKeyVersion;
    clientSecret32 = released.factorSecret32;
    const unlocked = await completeEmailOtpUnlockFromSecret32({
      relayUrl,
      walletId,
      authoritySelector: args.authoritySelector,
      ...(toOptionalTrimmedNonEmptyString(args.orgId)
        ? { orgId: toOptionalTrimmedNonEmptyString(args.orgId) }
        : {}),
      userId,
      enrollmentId: released.enrollmentId,
      enrollmentSealKeyVersion,
      clientSecret32,
      material: args.material,
      sessionAuth,
    });
    const commonResult = {
      challengeId,
      enrollmentSealKeyVersion,
      unlockChallengeId: unlocked.unlockChallengeId,
      unlockChallengeB64u: unlocked.unlockChallengeB64u,
      clientUnlockPublicKeyB64u: unlocked.clientUnlockPublicKeyB64u,
      unlockSignatureB64u: unlocked.unlockSignatureB64u,
      verifiedAuthorityProjection: unlocked.verifiedAuthorityProjection,
    };
    switch (unlocked.kind) {
      case 'ecdsa':
        return {
          kind: 'ecdsa',
          ...commonResult,
          ...(unlocked.ecdsaSession ? { ecdsaSession: unlocked.ecdsaSession } : {}),
          ...(unlocked.ecdsaCustody ? { ecdsaCustody: unlocked.ecdsaCustody } : {}),
        };
      case 'ed25519_yao_export': {
        const ownedClientSecret32 = clientSecret32;
        clientSecret32 = null;
        return {
          kind: 'ed25519_yao_export',
          ...commonResult,
          clientSecret32: ownedClientSecret32,
          walletCustodyEnvelope: unlocked.walletCustodyEnvelope,
        };
      }
      case 'wallet_custody_cache_absent': {
        return {
          kind: 'wallet_custody_cache_absent',
          ...commonResult,
          ed25519YaoRecovery: unlocked.ed25519YaoRecovery,
        };
      }
      case 'ed25519_yao_capability': {
        const ownedClientSecret32 = clientSecret32;
        clientSecret32 = null;
        return {
          kind: 'ed25519_yao_capability',
          ...commonResult,
          activeClientHandle: unlocked.activeClientHandle,
          metadata: unlocked.metadata,
          ed25519YaoCapability: unlocked.ed25519YaoCapability,
          walletSessionAuthorization: unlocked.walletSessionAuthorization,
          ...(unlocked.walletCustodyEd25519Material
            ? { walletCustodyEd25519Material: unlocked.walletCustodyEd25519Material }
            : {}),
          clientSecret32: ownedClientSecret32,
          walletCustodyEnvelope: unlocked.walletCustodyEnvelope,
        };
      }
      case 'wallet_unlock_capabilities': {
        const ownedClientSecret32 = clientSecret32;
        clientSecret32 = null;
        return {
          kind: 'wallet_unlock_capabilities',
          ...commonResult,
          clientSecret32: ownedClientSecret32,
          walletCustodyEnvelope: unlocked.walletCustodyEnvelope,
          walletSessionAuthorization: unlocked.walletSessionAuthorization,
          ecdsa: unlocked.ecdsa,
          ed25519Yao: unlocked.ed25519Yao,
        };
      }
      case 'ed25519_yao_operation_capability':
        throw new Error('Email OTP unlock returned operation-scoped Ed25519 material');
      default:
        return assertNeverEmailOtpWorker(unlocked);
    }
  } finally {
    zeroizeBytes(clientSecret32);
  }
}

export type EmailOtpWalletCustodySeedUnlock = {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly userId: string;
  readonly groupId: string;
  readonly routePlan: EmailOtpRoutePlan;
  readonly verification: {
    readonly kind: 'otp';
    readonly challengeId: string;
    readonly otpCode: string;
  };
};

/** Unlocks the wallet custody seed with a fresh OTP. The caller zeroizes the factor secret. */
export async function unlockEmailOtpWalletCustodySeed(
  args: EmailOtpWalletCustodySeedUnlock,
  missingMaterialMessage: string,
) {
  const orgId = readString(args.groupId, 'groupId');
  const recovered = await loginWithEmailOtpAndUnlockWallet({
    relayUrl: args.relayUrl,
    walletId: args.walletId,
    authoritySelector: { kind: 'wallet' },
    userId: args.userId,
    groupId: args.groupId,
    routePlan: args.routePlan,
    orgId,
    verification: args.verification,
    material: { kind: 'ed25519_yao_export' },
  });
  if (recovered.kind !== 'ed25519_yao_export') throw new Error(missingMaterialMessage);
  return recovered;
}

export function emailOtpUnlockMaterialOrgId(material: EmailOtpWalletUnlockMaterialRequest): string {
  switch (material.kind) {
    case 'ecdsa':
      return material.runtimePolicyScope.orgId;
    case 'ed25519_yao_recovery':
      return material.ed25519YaoRecovery.orgId;
    case 'wallet_unlock_capabilities':
      return material.ed25519Yao.recovery.orgId;
    default:
      return assertNeverEmailOtpWorker(material);
  }
}
