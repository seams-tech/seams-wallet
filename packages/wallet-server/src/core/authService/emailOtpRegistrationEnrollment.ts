import {
  EMAIL_OTP_INITIAL_ENROLLMENT_VERSION,
  emailOtpDeviceEnrollmentId,
  WALLET_EMAIL_OTP_ACTIONS,
} from '@shared/utils/emailOtpDomain';
import { parseWalletId } from '@shared/utils/domainIds';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import type {
  EmailOtpAuthStateStore,
  EmailOtpChannel,
  EmailOtpRegistrationAttemptStore,
  EmailOtpWalletEnrollmentRecord,
  EmailOtpWalletEnrollmentStore,
} from '../EmailOtpStores';
import type { IdentityStore } from '../IdentityStore';
import type { WalletStore } from '../WalletStore';
import { validateSecp256k1PublicKey33 } from '../ThresholdService/evmCryptoWasm';
import { validateEmailOtpEnrollmentMaterial } from '../../router/cloudflare/d1/emailOtp/d1EmailOtpRecords';
import {
  parseRawEmailOtpRegistrationChallengeProofInput,
  type EmailOtpRegistrationChallengeProofInput,
  type EmailOtpRegistrationChallengeProofResult,
  type VerifiedEmailOtpChallengeCodeResult,
} from './emailOtpChallengeProof';
import { completeGoogleEmailOtpRegistrationAttemptWithStore } from './googleEmailOtpRegistration';
import type { VerifyEmailOtpChallengeCodeRequest } from './emailOtpChallengeVerification';

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export type VerifyEmailOtpEnrollmentInput = {
  request: VerifyEmailOtpEnrollmentRequest;
  walletStore: WalletStore;
  walletEnrollmentStore: EmailOtpWalletEnrollmentStore;
  authStateStore: EmailOtpAuthStateStore;
  registrationAttemptStore: EmailOtpRegistrationAttemptStore;
  identityStore: IdentityStore;
  verifyChallengeCode: (
    request: VerifyEmailOtpChallengeCodeRequest,
  ) => Promise<VerifiedEmailOtpChallengeCodeResult>;
};

type VerifyEmailOtpEnrollmentRequest = {
  providerSubject: unknown;
  walletId: unknown;
  orgId: unknown;
  challengeId: unknown;
  otpCode: unknown;
  otpChannel: unknown;
  ownerProofBindingDigest: unknown;
  proofEmail?: unknown;
  clientIp?: unknown;
  enrollmentSealKeyVersion?: unknown;
  serverSealedFactorCiphertextB64u?: unknown;
  clientUnlockPublicKeyB64u?: unknown;
  unlockKeyVersion?: unknown;
  googleEmailOtpRegistrationAttemptId?: unknown;
};

async function resolveEmailOtpRegistrationChallengeProof(input: {
  proofInput: EmailOtpRegistrationChallengeProofInput;
  registrationAttemptStore: EmailOtpRegistrationAttemptStore;
  nowMs: number;
}): Promise<EmailOtpRegistrationChallengeProofResult> {
  const proofInput = input.proofInput;
  switch (proofInput.kind) {
    case 'google_registration_attempt': {
      const attempt = await input.registrationAttemptStore.get(proofInput.registrationAttemptId);
      if (!attempt) {
        return {
          ok: false,
          code: 'registration_attempt_missing',
          message: 'Google Email OTP registration attempt expired or was not found',
        };
      }
      if (attempt.providerSubject !== proofInput.providerSubject) {
        return {
          ok: false,
          code: 'challenge_subject_mismatch',
          message: 'Email OTP registration attempt does not match the provider subject',
        };
      }
      if (attempt.expiresAtMs <= input.nowMs) {
        return {
          ok: false,
          code: 'registration_attempt_expired',
          message: 'Google Email OTP registration attempt expired',
        };
      }
      if (attempt.walletId !== proofInput.walletId) {
        return {
          ok: false,
          code: 'wallet_identity_mismatch',
          message: 'registrationAttemptId does not match walletId',
        };
      }
      return {
        ok: true,
        proof: {
          kind: 'registration_attempt',
          providerSubject: proofInput.providerSubject,
          challengeSubjectId: proofInput.challengeSubjectId,
          proofEmail: attempt.email.toLowerCase(),
          registrationAttemptId: proofInput.registrationAttemptId,
          challengeId: proofInput.challengeId,
          finalWalletId: proofInput.walletId,
          orgId: proofInput.orgId,
          ownerProofBindingDigest: proofInput.ownerProofBindingDigest,
        },
      };
    }
    case 'direct_proof_email':
      return {
        ok: true,
        proof: {
          kind: 'direct_proof_email',
          providerSubject: proofInput.providerSubject,
          challengeSubjectId: proofInput.challengeSubjectId,
          proofEmail: proofInput.proofEmail,
          challengeId: proofInput.challengeId,
          finalWalletId: proofInput.finalWalletId,
          orgId: proofInput.orgId,
          ownerProofBindingDigest: proofInput.ownerProofBindingDigest,
        },
      };
  }
  return assertNever(proofInput);
}

export async function verifyEmailOtpEnrollment(input: VerifyEmailOtpEnrollmentInput): Promise<
  | {
      ok: true;
      walletId: string;
      otpChannel: EmailOtpChannel;
      enrollment: {
        createdAtMs: number;
        updatedAtMs: number;
        enrollmentSealKeyVersion: string;
        unlockKeyVersion: string;
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
      attemptsRemaining?: number;
      lockedUntilMs?: number;
    }
> {
  const request = input.request;
  const proofInput = parseRawEmailOtpRegistrationChallengeProofInput(request);
  if (!proofInput.ok) return proofInput;
  const proofResult = await resolveEmailOtpRegistrationChallengeProof({
    proofInput: proofInput.input,
    registrationAttemptStore: input.registrationAttemptStore,
    nowMs: Date.now(),
  });
  if (!proofResult.ok) return proofResult;
  const verified = await input.verifyChallengeCode({
    ...request,
    challengeSubjectId: proofResult.proof.challengeSubjectId,
    registrationChallengeProof: proofResult.proof,
    allowRegistrationChallengeReroll: true,
    expectedAction: WALLET_EMAIL_OTP_ACTIONS.registration,
  });
  if (!verified.ok) return verified;
  const verifiedEmail = toOptionalTrimmedString(verified.email)?.toLowerCase();
  if (!verifiedEmail) {
    return {
      ok: false,
      code: 'internal',
      message: 'Email OTP enrollment verification did not include a verified email',
    };
  }
  const enrollmentMaterial = await validateEmailOtpEnrollmentMaterial({
    material: request,
    validateSecp256k1PublicKey33,
  });
  if (!enrollmentMaterial.ok) return enrollmentMaterial;
  const orgId = toOptionalTrimmedString(verified.orgId) || '';
  if (!orgId) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'Email OTP enrollment requires orgId tenant scope',
    };
  }
  const verifiedWalletId = parseWalletId(verified.walletId);
  if (!verifiedWalletId.ok) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'Email OTP enrollment verification returned an invalid walletId',
    };
  }
  const canonicalWallet = await input.walletStore.getWallet({
    walletId: verifiedWalletId.value,
  });
  if (!canonicalWallet) {
    return {
      ok: false,
      code: 'wallet_registration_incomplete',
      message:
        'Email OTP enrollment requires a canonical wallet created by /wallets/register/activate.',
    };
  }
  const existing = await input.walletEnrollmentStore.get(verified.walletId);
  const existingState = await input.authStateStore.get(verified.walletId);
  const nowMs = Date.now();
  const enrollmentRecord: EmailOtpWalletEnrollmentRecord = {
    version: 'email_otp_wallet_enrollment_v1',
    walletId: verified.walletId,
    providerUserId: verified.challengeSubjectId,
    orgId,
    verifiedEmail,
    enrollmentId: emailOtpDeviceEnrollmentId(verified.walletId, verified.challengeSubjectId),
    enrollmentVersion: EMAIL_OTP_INITIAL_ENROLLMENT_VERSION,
    enrollmentSealKeyVersion: enrollmentMaterial.enrollmentSealKeyVersion,
    serverSealedFactorCiphertextB64u: enrollmentMaterial.serverSealedFactorCiphertextB64u,
    clientUnlockPublicKeyB64u: enrollmentMaterial.clientUnlockPublicKeyB64u,
    unlockKeyVersion: enrollmentMaterial.unlockKeyVersion,
    createdAtMs: existing?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
  };
  const existingProviderEnrollment = await input.walletEnrollmentStore.getByProviderUserId({
    providerUserId: enrollmentRecord.providerUserId,
    orgId: enrollmentRecord.orgId,
  });
  if (
    existingProviderEnrollment &&
    existingProviderEnrollment.walletId !== enrollmentRecord.walletId
  ) {
    await input.walletEnrollmentStore.del(existingProviderEnrollment.walletId);
  }
  await input.walletEnrollmentStore.put(enrollmentRecord);
  await input.authStateStore.put({
    version: 'email_otp_auth_state_v1',
    walletId: enrollmentRecord.walletId,
    providerUserId: enrollmentRecord.providerUserId,
    orgId: enrollmentRecord.orgId,
    createdAtMs:
      existingState &&
      existingState.providerUserId === enrollmentRecord.providerUserId &&
      existingState.orgId === enrollmentRecord.orgId
        ? existingState.createdAtMs
        : nowMs,
    updatedAtMs: nowMs,
    otpFailureCount: 0,
    lastOtpFailureAtMs: undefined,
    otpLockedUntilMs: undefined,
    ...(existingState?.lastEmailOtpLoginAtMs &&
    existingState.providerUserId === enrollmentRecord.providerUserId &&
    existingState.orgId === enrollmentRecord.orgId
      ? { lastEmailOtpLoginAtMs: existingState.lastEmailOtpLoginAtMs }
      : {}),
    ...(existingState?.lastStrongAuthAtMs &&
    existingState.providerUserId === enrollmentRecord.providerUserId &&
    existingState.orgId === enrollmentRecord.orgId
      ? { lastStrongAuthAtMs: existingState.lastStrongAuthAtMs }
      : {}),
  });
  const completedRegistration = await completeGoogleEmailOtpRegistrationAttemptWithStore({
    registrationAttemptStore: input.registrationAttemptStore,
    identityStore: input.identityStore,
    nowMs: Date.now(),
    registrationAttemptId: request.googleEmailOtpRegistrationAttemptId,
    walletId: verified.walletId,
  });
  if (!completedRegistration.ok) return completedRegistration;
  return {
    ok: true,
    walletId: verified.walletId,
    otpChannel: verified.otpChannel,
    enrollment: {
      createdAtMs: existing?.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
      enrollmentSealKeyVersion: enrollmentMaterial.enrollmentSealKeyVersion,
      unlockKeyVersion: enrollmentMaterial.unlockKeyVersion,
    },
  };
}
