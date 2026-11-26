import type { ThresholdRuntimePolicyScope } from './types';
import type {
  WalletEmailOtpChannel,
  WalletEmailOtpLoginOperation,
  WalletEmailOtpOperation,
} from '@shared/utils/emailOtpDomain';
import {
  WALLET_EMAIL_OTP_ACTIONS,
  WALLET_EMAIL_OTP_REGISTRATION_OPERATION,
  WALLET_EMAIL_OTP_UNLOCK_OPERATION,
  WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION,
  WALLET_EMAIL_OTP_RELOCATION_OPERATION,
} from '@shared/utils/emailOtpDomain';
export type EmailOtpChannel = WalletEmailOtpChannel;
export type EmailOtpGrantAction =
  | typeof WALLET_EMAIL_OTP_ACTIONS.unseal
  | typeof WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap;
export type EmailOtpChallengeAction =
  | typeof WALLET_EMAIL_OTP_ACTIONS.login
  | typeof WALLET_EMAIL_OTP_ACTIONS.registration
  | typeof WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap
  | typeof WALLET_EMAIL_OTP_ACTIONS.deviceLink
  | typeof WALLET_EMAIL_OTP_ACTIONS.relocation;
export type EmailOtpChallengeOperation = WalletEmailOtpOperation;
export type EmailOtpLoginChallengeOperation = WalletEmailOtpLoginOperation;

export type EmailOtpChallengePurpose =
  | {
      readonly action: typeof WALLET_EMAIL_OTP_ACTIONS.login;
      readonly operation: WalletEmailOtpLoginOperation;
    }
  | {
      readonly action: typeof WALLET_EMAIL_OTP_ACTIONS.registration;
      readonly operation: typeof WALLET_EMAIL_OTP_REGISTRATION_OPERATION;
    }
  | {
      readonly action: typeof WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap;
      readonly operation: typeof WALLET_EMAIL_OTP_UNLOCK_OPERATION;
    }
  | {
      readonly action: typeof WALLET_EMAIL_OTP_ACTIONS.deviceLink;
      readonly operation: typeof WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION;
    }
  | {
      readonly action: typeof WALLET_EMAIL_OTP_ACTIONS.relocation;
      readonly operation: typeof WALLET_EMAIL_OTP_RELOCATION_OPERATION;
    };

export type EmailOtpChallengeRecord = {
  version: 'email_otp_challenge_v2';
  challengeId: string;
  /**
   * Subject that owns the OTP challenge.
   * For Google registration this is the OIDC provider subject. For existing-wallet
   * Email OTP flows this is the enrolled provider subject.
   */
  challengeSubjectId: string;
  /** Wallet being registered or unlocked. Registration rerolls may change this after issuance. */
  walletId: string;
  /** Tenant scope that prevents cross-org challenge reuse. */
  orgId?: string;
  otpChannel: EmailOtpChannel;
  /** Normalized email address that received the OTP code. */
  email: string;
  /** The code, encrypted under a key from the Email OTP seal root. D1 never holds the code. */
  otpCodeSealedB64u: string;
  /** Exact wallet, owner, operation, origin, and audience binding digest. */
  ownerProofBindingDigest: string;
  createdAtMs: number;
  expiresAtMs: number;
  attemptCount: number;
  maxAttempts: number;
} & EmailOtpChallengePurpose;

export type EmailOtpGrantRecord = {
  version: 'email_otp_grant_v1';
  grantToken: string;
  userId: string;
  walletId: string;
  orgId?: string;
  challengeId: string;
  otpChannel: EmailOtpChannel;
  ownerProofBindingDigest: string;
  action: EmailOtpGrantAction;
  issuedAtMs: number;
  expiresAtMs: number;
};

/** The most factors one enrollment holds: one for each active Email OTP method. */
export const EMAIL_OTP_ENROLLMENT_FACTOR_LIMIT = 8;

/**
 * The factor of one Email OTP method. Each method has its own S, wrapped under
 * the POPRF output for an input that only its device holds, and its own pinned
 * unlock key from S. The release picks the factor by the device's nonce.
 */
export type EmailOtpEnrollmentFactorRecord = {
  walletAuthMethodId: string;
  factorNonceB64u: string;
  wrappedFactorB64u: string;
  clientUnlockPublicKeyB64u: string;
  createdAtMs: number;
};

/**
 * The Email OTP enrollment of a wallet: one email identity, its code checks and
 * lockouts, and the factors of its Email OTP methods. All factors use the
 * enrollment's key version.
 */
export type EmailOtpWalletEnrollmentRecord = {
  version: 'email_otp_wallet_enrollment_v1';
  walletId: string;
  providerUserId: string;
  orgId: string;
  verifiedEmail: string;
  enrollmentId: string;
  enrollmentVersion: string;
  enrollmentSealKeyVersion: string;
  unlockKeyVersion: string;
  factors: readonly EmailOtpEnrollmentFactorRecord[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type EmailOtpAuthStateRecord = {
  version: 'email_otp_auth_state_v1';
  walletId: string;
  providerUserId: string;
  orgId: string;
  createdAtMs: number;
  updatedAtMs: number;
  otpFailureCount?: number;
  lastOtpFailureAtMs?: number;
  otpLockedUntilMs?: number;
  lastEmailOtpLoginAtMs?: number;
  lastStrongAuthAtMs?: number;
};

export type EmailOtpUnlockChallengeRecord = {
  version: 'email_otp_unlock_challenge_v1';
  challengeId: string;
  walletId: string;
  userId: string;
  orgId?: string;
  challengeB64u: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type GoogleEmailOtpRegistrationOfferCandidateRecord = {
  candidateId: string;
  walletId: string;
  collisionCounter: number;
};

export type NonEmptyGoogleEmailOtpRegistrationOfferCandidates = readonly [
  GoogleEmailOtpRegistrationOfferCandidateRecord,
  ...GoogleEmailOtpRegistrationOfferCandidateRecord[],
];

type GoogleEmailOtpRegistrationOfferBinding = {
  offerId: string;
  offerCandidates: NonEmptyGoogleEmailOtpRegistrationOfferCandidates;
  selectedCandidateId: string;
};

type GoogleEmailOtpRegistrationAttemptBaseRecord = {
  version: 'google_email_otp_registration_attempt_v1';
  attemptId: string;
  providerSubject: string;
  email: string;
  walletId: string;
  ownerProofBindingDigest: string;
  authProvider: string;
  accountIdSlugVersion: 'hmac_readable_v1';
  walletIdDerivationNonce: string;
  collisionCounter: number;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
};

type StartedGoogleEmailOtpRegistrationAttemptRecord = GoogleEmailOtpRegistrationAttemptBaseRecord &
  GoogleEmailOtpRegistrationOfferBinding & {
    state: 'started';
    finalizedPublicKey?: never;
    failureCode?: never;
  };

type KeyFinalizedGoogleEmailOtpRegistrationAttemptRecord =
  GoogleEmailOtpRegistrationAttemptBaseRecord &
    GoogleEmailOtpRegistrationOfferBinding & {
      state: 'key_finalized';
      finalizedPublicKey: string;
      failureCode?: never;
    };

type ActiveGoogleEmailOtpRegistrationAttemptRecord = GoogleEmailOtpRegistrationAttemptBaseRecord &
  GoogleEmailOtpRegistrationOfferBinding & {
    state: 'active';
    finalizedPublicKey?: string;
    failureCode?: never;
  };

type AbandonedGoogleEmailOtpRegistrationAttemptRecord =
  GoogleEmailOtpRegistrationAttemptBaseRecord &
    GoogleEmailOtpRegistrationOfferBinding & {
      state: 'abandoned';
      finalizedPublicKey?: string;
      failureCode: string;
    };

type FailedGoogleEmailOtpRegistrationAttemptRecord = GoogleEmailOtpRegistrationAttemptBaseRecord &
  GoogleEmailOtpRegistrationOfferBinding & {
    state: 'failed';
    finalizedPublicKey?: string;
    failureCode: string;
  };

type ExpiredGoogleEmailOtpRegistrationAttemptRecord = GoogleEmailOtpRegistrationAttemptBaseRecord &
  GoogleEmailOtpRegistrationOfferBinding & {
    state: 'expired';
    finalizedPublicKey?: string;
    failureCode?: string;
  };

export type GoogleEmailOtpRegistrationAttemptRecord =
  | StartedGoogleEmailOtpRegistrationAttemptRecord
  | KeyFinalizedGoogleEmailOtpRegistrationAttemptRecord
  | ActiveGoogleEmailOtpRegistrationAttemptRecord
  | AbandonedGoogleEmailOtpRegistrationAttemptRecord
  | FailedGoogleEmailOtpRegistrationAttemptRecord
  | ExpiredGoogleEmailOtpRegistrationAttemptRecord;

export type PendingGoogleEmailOtpRegistrationAttemptRecord =
  | StartedGoogleEmailOtpRegistrationAttemptRecord
  | KeyFinalizedGoogleEmailOtpRegistrationAttemptRecord;

/** A registration's subject, email, owner binding and runtime scope, as of `nowMs`. */
export type GoogleEmailOtpRegistrationAttemptScopeInput = {
  providerSubject: string;
  email: string;
  orgId: string;
  ownerProofBindingDigest: string;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
  nowMs: number;
};
