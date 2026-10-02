import type { ThresholdRuntimePolicyScope } from './types';
import type {
  WalletEmailOtpChannel,
  WalletEmailOtpLoginOperation,
  WalletEmailOtpOperation,
} from '@shared/utils/emailOtpDomain';
import { WALLET_EMAIL_OTP_ACTIONS } from '@shared/utils/emailOtpDomain';
export type EmailOtpChannel = WalletEmailOtpChannel;
export type EmailOtpGrantAction =
  | typeof WALLET_EMAIL_OTP_ACTIONS.unseal
  | typeof WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap;
export type EmailOtpChallengeAction =
  | typeof WALLET_EMAIL_OTP_ACTIONS.login
  | typeof WALLET_EMAIL_OTP_ACTIONS.registration
  | typeof WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap
  | typeof WALLET_EMAIL_OTP_ACTIONS.deviceLink;
export type EmailOtpChallengeOperation = WalletEmailOtpOperation;
export type EmailOtpLoginChallengeOperation = WalletEmailOtpLoginOperation;

export type EmailOtpChallengeRecord = {
  version: 'email_otp_challenge_v1';
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
  otpCode: string;
  /** Exact wallet, owner, operation, origin, and audience binding digest. */
  ownerProofBindingDigest: string;
  action: EmailOtpChallengeAction;
  operation: EmailOtpChallengeOperation;
  createdAtMs: number;
  expiresAtMs: number;
  attemptCount: number;
  maxAttempts: number;
};

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

export type EmailOtpWalletEnrollmentRecord = {
  version: 'email_otp_wallet_enrollment_v1';
  walletId: string;
  providerUserId: string;
  orgId: string;
  verifiedEmail: string;
  enrollmentId: string;
  enrollmentVersion: string;
  enrollmentSealKeyVersion: string;
  clientUnlockPublicKeyB64u: string;
  unlockKeyVersion: string;
  serverSealedFactorCiphertextB64u: string;
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
