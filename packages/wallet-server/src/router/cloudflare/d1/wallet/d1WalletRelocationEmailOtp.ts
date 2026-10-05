import { sha256Utf8DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import { sha256HexUtf8 } from '@shared/utils/digests';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_ACTIONS,
  WALLET_EMAIL_OTP_RELOCATION_OPERATION,
} from '@shared/utils/emailOtpDomain';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import type { CloudflareD1EmailOtpChallengeVerifier } from '../emailOtp/d1EmailOtpChallengeVerifier';
import type { CloudflareD1EmailOtpChallengeStore } from '../emailOtp/d1EmailOtpChallengeStore';
import {
  D1WalletRelocationChallenges,
  type WalletRelocationChallengeBinding,
} from './d1WalletRelocationChallenges';
import {
  readWalletRelocationOwner,
  type WalletRelocationFactorVerification,
} from './d1WalletRelocationOwner';

export type WalletRelocationEmailOtpServices = {
  readonly verifier: CloudflareD1EmailOtpChallengeVerifier;
  readonly emailOtpChallenges: CloudflareD1EmailOtpChallengeStore;
};

export async function walletRelocationEmailOtpBinding(
  scope: D1TenantScope,
  binding: WalletRelocationChallengeBinding,
  challengeB64u: string,
): Promise<DigestB64u> {
  return sha256Utf8DigestB64u(
    JSON.stringify([
      'seams/wallet-relocation-email-otp/v1',
      scope.namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      binding.encoded(),
      challengeB64u,
    ]),
  );
}

export async function verifyWalletRelocationEmailOtp(input: {
  readonly database: D1DatabaseLike;
  readonly scope: D1TenantScope;
  readonly binding: WalletRelocationChallengeBinding;
  readonly challengeId: string;
  readonly otpCode: string;
  readonly nowMs: number;
  readonly verifier: CloudflareD1EmailOtpChallengeVerifier;
  readonly emailOtpChallenges: CloudflareD1EmailOtpChallengeStore;
}): Promise<WalletRelocationFactorVerification> {
  const challenges = new D1WalletRelocationChallenges(input.database, input.scope);
  const challenge = await challenges.read(input.binding);
  if (
    !challenge ||
    challenge.state !== 'issued' ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < challenge.createdAtMs ||
    input.nowMs >= challenge.expiresAtMs
  )
    return { kind: 'denied' };
  const owner = await readWalletRelocationOwner(input.database, input.scope, input.binding);
  if (!owner || owner.method.kind !== 'email_otp') return { kind: 'denied' };
  const enrollment = await input.verifier.readEnrollmentForWallet(input.binding.walletId);
  if (
    !enrollment ||
    enrollment.walletId !== input.binding.walletId ||
    enrollment.orgId !== input.scope.orgId ||
    (await sha256HexUtf8(enrollment.verifiedEmail)) !== owner.method.emailHashHex
  )
    return { kind: 'denied' };
  const otp = await input.emailOtpChallenges.read(input.challengeId);
  if (
    !otp ||
    otp.createdAtMs < challenge.createdAtMs ||
    otp.createdAtMs > input.nowMs ||
    otp.expiresAtMs < challenge.expiresAtMs
  )
    return { kind: 'denied' };
  const ownerProofBindingDigest = await walletRelocationEmailOtpBinding(
    input.scope,
    input.binding,
    challenge.challengeB64u,
  );
  const verified = await input.verifier.verifyExistingForBatch({
    userId: enrollment.providerUserId,
    walletId: input.binding.walletId,
    orgId: input.scope.orgId,
    challengeId: input.challengeId,
    otpCode: input.otpCode,
    otpChannel: EMAIL_OTP_CHANNEL,
    ownerProofBindingDigest,
    action: WALLET_EMAIL_OTP_ACTIONS.relocation,
    operation: WALLET_EMAIL_OTP_RELOCATION_OPERATION,
  });
  if (!verified.ok || verified.consumeInBatch.length === 0) return { kind: 'denied' };
  return {
    kind: 'verified',
    authorityDigestB64u: owner.authority.authorityDigestB64u,
    authorityRevocationEpoch: owner.authority.revocationEpoch,
    commitPrerequisites: [
      ...owner.commitPrerequisites,
      input.database
        .prepare(
          `UPDATE email_otp_wallet_enrollments SET updated_at_ms = updated_at_ms
        WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
          AND wallet_id = ? AND provider_user_id = ? AND record_org_id = ? AND verified_email = ?`,
        )
        .bind(
          input.scope.namespace,
          input.scope.orgId,
          input.scope.projectId,
          input.scope.envId,
          input.binding.walletId,
          enrollment.providerUserId,
          enrollment.orgId,
          enrollment.verifiedEmail,
        ),
      input.database.prepare(D1_BATCH_CAS_GUARD_SQL),
      ...verified.consumeInBatch,
      ...challenges.prepareConsume(challenge, input.nowMs),
    ],
  };
}
