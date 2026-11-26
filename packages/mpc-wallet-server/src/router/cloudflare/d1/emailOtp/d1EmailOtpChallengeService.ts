import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_ACTIONS,
  WALLET_EMAIL_OTP_REGISTRATION_OPERATION,
  WALLET_EMAIL_OTP_UNLOCK_OPERATION,
} from '@shared/utils/emailOtpDomain';
import { failure } from '@shared/utils/failure';
import type { RouterApiEmailOtpRouteService } from '../../../framework/authServicePort';
import { emailOtpGrantRecord, maskEmail, parseEmailOtpLoginOperation } from './d1EmailOtpRecords';
import type { CloudflareD1EmailOtpChallengeIssuer } from './d1EmailOtpChallengeIssuer';
import type { CloudflareD1EmailOtpChallengeStore } from './d1EmailOtpChallengeStore';
import type { CloudflareD1EmailOtpChallengeVerifier } from './d1EmailOtpChallengeVerifier';
import type { CloudflareD1EmailOtpServerSealRuntime } from './d1EmailOtpServerSealRuntime';
import type { CloudflareD1EmailOtpGrantStore } from './d1EmailOtpGrantStore';

type CreateEmailOtpChallengeInput = Parameters<
  RouterApiEmailOtpRouteService['createEmailOtpChallenge']
>[0];
type CreateEmailOtpChallengeResult = Awaited<
  ReturnType<RouterApiEmailOtpRouteService['createEmailOtpChallenge']>
>;
type CreateEmailOtpEnrollmentChallengeInput = Parameters<
  RouterApiEmailOtpRouteService['createEmailOtpEnrollmentChallenge']
>[0];
type CreateEmailOtpEnrollmentChallengeResult = Awaited<
  ReturnType<RouterApiEmailOtpRouteService['createEmailOtpEnrollmentChallenge']>
>;
type VerifyEmailOtpChallengeInput = Parameters<
  RouterApiEmailOtpRouteService['verifyEmailOtpChallenge']
>[0];
type VerifyEmailOtpChallengeResult = Awaited<
  ReturnType<RouterApiEmailOtpRouteService['verifyEmailOtpChallenge']>
>;
type VerifyEmailOtpWalletRecoveryChallengeInput = Parameters<
  RouterApiEmailOtpRouteService['verifyEmailOtpWalletRecoveryChallenge']
>[0];
type VerifyEmailOtpWalletRecoveryChallengeResult = Awaited<
  ReturnType<RouterApiEmailOtpRouteService['verifyEmailOtpWalletRecoveryChallenge']>
>;
type ReadEmailOtpOutboxEntryInput = Parameters<
  RouterApiEmailOtpRouteService['readEmailOtpOutboxEntry']
>[0];
type ReadEmailOtpOutboxEntryResult = Awaited<
  ReturnType<RouterApiEmailOtpRouteService['readEmailOtpOutboxEntry']>
>;

export class CloudflareD1EmailOtpChallengeService {
  private readonly challenges: CloudflareD1EmailOtpChallengeStore;
  private readonly devOutboxEnabled: boolean;
  private readonly codeSeal: Pick<CloudflareD1EmailOtpServerSealRuntime, 'openEmailOtpCode'>;
  private readonly grantTtlMs: number;
  private readonly grants: CloudflareD1EmailOtpGrantStore;
  private readonly issuer: CloudflareD1EmailOtpChallengeIssuer;
  private readonly verifier: CloudflareD1EmailOtpChallengeVerifier;
  readonly prepareEmailOtpOwnerProof: RouterApiEmailOtpRouteService['prepareEmailOtpOwnerProof'];

  constructor(input: {
    readonly challenges: CloudflareD1EmailOtpChallengeStore;
    readonly devOutboxEnabled: boolean;
    readonly codeSeal: Pick<CloudflareD1EmailOtpServerSealRuntime, 'openEmailOtpCode'>;
    readonly grantTtlMs: number;
    readonly grants: CloudflareD1EmailOtpGrantStore;
    readonly issuer: CloudflareD1EmailOtpChallengeIssuer;
    readonly verifier: CloudflareD1EmailOtpChallengeVerifier;
  }) {
    this.challenges = input.challenges;
    this.devOutboxEnabled = input.devOutboxEnabled;
    this.codeSeal = input.codeSeal;
    this.grantTtlMs = input.grantTtlMs;
    this.grants = input.grants;
    this.issuer = input.issuer;
    this.verifier = input.verifier;
    this.prepareEmailOtpOwnerProof = prepareEmailOtpOwnerProof.bind(null, input.verifier);
  }

  async createEmailOtpChallenge(
    input: CreateEmailOtpChallengeInput,
  ): Promise<CreateEmailOtpChallengeResult> {
    const operation = parseEmailOtpLoginOperation(input.operation);
    const result = await this.issuer.create({
      userId: input.userId,
      walletId: input.walletId,
      orgId: input.orgId,
      email: input.email,
      otpChannel: input.otpChannel,
      ownerProofBindingDigest: input.ownerProofBindingDigest,
      clientIp: input.clientIp,
      reuseActiveChallenge: input.reuseActiveChallenge,
      requestOrigin: input.requestOrigin,
      action: WALLET_EMAIL_OTP_ACTIONS.login,
      operation,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      challenge: {
        challengeId: result.challenge.challengeId,
        issuedAtMs: result.challenge.issuedAtMs,
        expiresAtMs: result.challenge.expiresAtMs,
        userId: result.challenge.challengeSubjectId,
        walletId: result.challenge.walletId,
        orgId: result.challenge.orgId,
        otpChannel: result.challenge.otpChannel,
        ownerProofBindingDigest: result.challenge.ownerProofBindingDigest,
        action: WALLET_EMAIL_OTP_ACTIONS.login,
        operation,
      },
      delivery: result.delivery,
    };
  }

  async createEmailOtpEnrollmentChallenge(
    input: CreateEmailOtpEnrollmentChallengeInput,
  ): Promise<CreateEmailOtpEnrollmentChallengeResult> {
    const result = await this.issuer.create({
      userId: input.userId,
      walletId: input.walletId,
      orgId: input.orgId,
      email: input.email,
      otpChannel: input.otpChannel,
      ownerProofBindingDigest: input.ownerProofBindingDigest,
      clientIp: input.clientIp,
      requestOrigin: input.requestOrigin,
      action: WALLET_EMAIL_OTP_ACTIONS.registration,
      operation: WALLET_EMAIL_OTP_REGISTRATION_OPERATION,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      challenge: {
        challengeId: result.challenge.challengeId,
        issuedAtMs: result.challenge.issuedAtMs,
        expiresAtMs: result.challenge.expiresAtMs,
        userId: result.challenge.challengeSubjectId,
        walletId: result.challenge.walletId,
        orgId: result.challenge.orgId,
        otpChannel: result.challenge.otpChannel,
        ownerProofBindingDigest: result.challenge.ownerProofBindingDigest,
        action: WALLET_EMAIL_OTP_ACTIONS.registration,
        operation: WALLET_EMAIL_OTP_REGISTRATION_OPERATION,
      },
      delivery: result.delivery,
    };
  }

  async verifyEmailOtpChallenge(
    input: VerifyEmailOtpChallengeInput,
  ): Promise<VerifyEmailOtpChallengeResult> {
    const operation = parseEmailOtpLoginOperation(input.operation);
    const verified = await this.verifier.verifyExisting({
      userId: input.userId,
      walletId: input.walletId,
      orgId: input.orgId,
      challengeId: input.challengeId,
      otpCode: input.otpCode,
      otpChannel: input.otpChannel,
      ownerProofBindingDigest: input.ownerProofBindingDigest,
      clientIp: input.clientIp,
      action: WALLET_EMAIL_OTP_ACTIONS.login,
      operation,
    });
    if (!verified.ok) return verified;

    const issuedAtMs = Date.now();
    const grantExpiresAtMs = issuedAtMs + this.grantTtlMs;
    const loginGrant = secureRandomBase64Url(24, 'email otp login grants');
    await this.grants.put(
      emailOtpGrantRecord({
        grantToken: loginGrant,
        userId: verified.userId,
        walletId: verified.walletId,
        orgId: verified.orgId,
        challengeId: verified.challengeId,
        ownerProofBindingDigest: verified.ownerProofBindingDigest,
        action: WALLET_EMAIL_OTP_ACTIONS.unseal,
        issuedAtMs,
        expiresAtMs: grantExpiresAtMs,
      }),
    );

    return {
      ok: true,
      challengeId: verified.challengeId,
      loginGrant,
      grantExpiresAtMs,
      otpChannel: EMAIL_OTP_CHANNEL,
    };
  }

  async verifyEmailOtpWalletRecoveryChallenge(
    input: VerifyEmailOtpWalletRecoveryChallengeInput,
  ): Promise<VerifyEmailOtpWalletRecoveryChallengeResult> {
    const verified = await this.verifier.verifyExisting({
      userId: input.userId,
      walletId: input.walletId,
      orgId: input.orgId,
      challengeId: input.challengeId,
      otpCode: input.otpCode,
      otpChannel: input.otpChannel,
      ownerProofBindingDigest: input.ownerProofBindingDigest,
      clientIp: input.clientIp,
      action: WALLET_EMAIL_OTP_ACTIONS.login,
      operation: WALLET_EMAIL_OTP_UNLOCK_OPERATION,
    });
    if (!verified.ok) return verified;

    const issuedAtMs = Date.now();
    const grantExpiresAtMs = issuedAtMs + this.grantTtlMs;
    const loginGrant = secureRandomBase64Url(24, 'wallet recovery email otp grants');
    await this.grants.put(
      emailOtpGrantRecord({
        grantToken: loginGrant,
        userId: verified.userId,
        walletId: verified.walletId,
        orgId: verified.orgId,
        challengeId: verified.challengeId,
        ownerProofBindingDigest: verified.ownerProofBindingDigest,
        action: WALLET_EMAIL_OTP_ACTIONS.unseal,
        issuedAtMs,
        expiresAtMs: grantExpiresAtMs,
      }),
    );
    return {
      ok: true,
      challengeId: verified.challengeId,
      loginGrant,
      grantExpiresAtMs,
      otpChannel: EMAIL_OTP_CHANNEL,
    };
  }

  async readEmailOtpOutboxEntry(
    input: ReadEmailOtpOutboxEntryInput,
  ): Promise<ReadEmailOtpOutboxEntryResult> {
    if (!this.devOutboxEnabled) {
      return failure('not_found', 'Email OTP dev outbox is not enabled');
    }
    const challengeId = toOptionalTrimmedString(input.challengeId);
    const userId = toOptionalTrimmedString(input.userId);
    const walletId = toOptionalTrimmedString(input.walletId);
    if (!userId) return failure('invalid_body', 'Missing userId');
    if (!walletId) return failure('invalid_body', 'Missing walletId');
    const record = challengeId
      ? await this.challenges.read(challengeId)
      : await this.challenges.readLatestActiveForSubjectWallet({
          challengeSubjectId: userId,
          walletId,
          nowMs: Date.now(),
        });
    if (!record || record.challengeSubjectId !== userId || record.walletId !== walletId) {
      return failure('not_found', 'Email OTP outbox entry was not found');
    }
    if (Date.now() > record.expiresAtMs) {
      await this.challenges.delete(record.challengeId);
      return failure('not_found', 'Email OTP outbox entry expired');
    }
    const opened = await this.codeSeal.openEmailOtpCode({
      challengeId: record.challengeId,
      otpCodeSealedB64u: record.otpCodeSealedB64u,
    });
    if (!opened.ok) return opened;
    return {
      ok: true,
      challengeId: record.challengeId,
      walletId,
      userId,
      otpChannel: EMAIL_OTP_CHANNEL,
      emailHint: maskEmail(record.email),
      otpCode: opened.otpCode,
      expiresAtMs: record.expiresAtMs,
    };
  }
}

export async function prepareEmailOtpOwnerProof(
  verifier: CloudflareD1EmailOtpChallengeVerifier,
  input: VerifyEmailOtpChallengeInput,
): ReturnType<RouterApiEmailOtpRouteService['prepareEmailOtpOwnerProof']> {
  const verified = await verifier.verifyExistingForBatch({
    userId: input.userId,
    walletId: input.walletId,
    orgId: input.orgId,
    challengeId: input.challengeId,
    otpCode: input.otpCode,
    otpChannel: input.otpChannel,
    ownerProofBindingDigest: input.ownerProofBindingDigest,
    clientIp: input.clientIp,
    action: WALLET_EMAIL_OTP_ACTIONS.login,
    operation: parseEmailOtpLoginOperation(input.operation),
  });
  if (!verified.ok) return verified;
  return {
    ok: true,
    challengeId: verified.challengeId,
    expiresAtMs: verified.expiresAtMs,
    consumeInBatch: verified.consumeInBatch,
  };
}
