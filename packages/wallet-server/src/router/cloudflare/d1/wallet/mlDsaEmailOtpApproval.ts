import { parseAuthFactorId, type CapabilityOperationEnvelope } from '@shared/authorization';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { sha256Utf8DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import { alphabetizeStringify } from '@shared/utils/digests';
import { walletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
  WALLET_EMAIL_OTP_ACTIONS,
} from '@shared/utils/emailOtpDomain';
import type { MlDsaEmailOtpProof } from '@shared/near/mlDsaEmailOtp';
import type { MlDsaSigningFailure } from '@shared/near/mlDsaSigning';
import { buildVerifiedWalletOperationEmailOtpFactorResult } from '../../../../authorization/factorEvidence';
import type { SessionOrigin } from '../../../../authorization/domain';
import type {
  RouterApiEmailOtpRouteService,
  RouterApiWalletUnlockService,
} from '../../../framework/authServicePort';
import { hashEmailOtpOperationBinding } from '../../../domains/emailOtp/emailOtpSessionRouteHelpers';
import type { MlDsaSigningRecord } from './mlDsaSigningRecord';
import type { CloudflareD1EmailOtpChallengeVerifier } from '../emailOtp/d1EmailOtpChallengeVerifier';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';

export type MlDsaEmailOtpServices = {
  readonly emailOtp: Pick<RouterApiEmailOtpRouteService, 'readActiveEmailOtpEnrollment'>;
  readonly walletUnlock: Pick<RouterApiWalletUnlockService, 'resolveEmailOtpAuthorityForUnlock'>;
};

export async function resolveMlDsaEmailOtpOwner(input: {
  readonly services: MlDsaEmailOtpServices;
  readonly walletId: MlDsaSigningRecord['target']['identity']['walletId'];
  readonly tenantId: MlDsaSigningRecord['target']['tenantId'];
  readonly walletAuthMethodId: MlDsaSigningRecord['target']['authority']['walletAuthMethodId'];
}) {
  const enrollment = await input.services.emailOtp.readActiveEmailOtpEnrollment({
    walletId: input.walletId,
    orgId: input.tenantId,
  });
  if (!enrollment.ok)
    return {
      kind: 'refused',
      code: 'unauthorized',
      message: 'The wallet Email OTP enrollment is unavailable',
    } as const;
  const owner = await input.services.walletUnlock.resolveEmailOtpAuthorityForUnlock({
    walletId: input.walletId,
    orgId: input.tenantId,
    walletAuthMethodId: input.walletAuthMethodId,
    providerUserId: enrollment.enrollment.providerUserId,
  });
  if (owner.kind !== 'active_authority')
    return {
      kind: 'refused',
      code: 'unauthorized',
      message: 'The exact Email OTP owner is unavailable',
    } as const;
  return { kind: 'owner', owner } as const;
}

export type VerifiedMlDsaEmailApproval = {
  readonly kind: 'verified';
  readonly factor: ReturnType<typeof buildVerifiedWalletOperationEmailOtpFactorResult>;
  readonly proofDigest: DigestB64u;
  readonly consumeInBatch: readonly D1PreparedStatementLike[];
};

export async function verifyMlDsaEmailOtpApproval(input: {
  readonly services: MlDsaEmailOtpServices;
  readonly verifier: Pick<CloudflareD1EmailOtpChallengeVerifier, 'verifyExistingForBatch'>;
  readonly record: MlDsaSigningRecord;
  readonly proof: MlDsaEmailOtpProof;
  readonly operation: CapabilityOperationEnvelope;
  readonly expectedChallenge: DigestB64u;
  readonly origin: SessionOrigin;
}): Promise<VerifiedMlDsaEmailApproval | MlDsaSigningFailure> {
  const record = input.record;
  const resolved = await resolveMlDsaEmailOtpOwner({
    services: input.services,
    walletId: record.target.identity.walletId,
    tenantId: record.target.tenantId,
    walletAuthMethodId: record.target.authority.walletAuthMethodId,
  });
  if (resolved.kind !== 'owner') return resolved;
  const current = resolved.owner;
  const authorityRef = await walletAuthAuthorityRef({ authority: current.walletAuthAuthority });
  if (
    current.authority.authorityId !== record.owner.authorityId ||
    current.authority.authorityDigestB64u !== record.owner.authorityDigestB64u ||
    current.authority.revocationEpoch !== record.owner.revocationEpoch ||
    alphabetizeStringify(authorityRef) !== alphabetizeStringify(record.target.authority)
  )
    return { kind: 'refused', code: 'unauthorized', message: 'The Email OTP authority changed' };
  const providerSubject = current.walletAuthAuthority.factor.providerUserId;
  const binding = await hashEmailOtpOperationBinding({
    walletId: record.target.identity.walletId,
    providerUserId: providerSubject,
    orgId: record.target.tenantId,
    operation: WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
    requestOrigin: input.origin,
    audience: input.origin,
    authorityRef,
    // The challenge binds the whole transaction or exact grant-start policy.
    // The ML-DSA lane digest alone identifies only the key and is insufficient.
    operationFingerprintDigest: input.expectedChallenge,
  });
  const verified = await input.verifier.verifyExistingForBatch({
    userId: providerSubject,
    walletId: record.target.identity.walletId,
    orgId: record.target.tenantId,
    challengeId: input.proof.challengeId,
    otpCode: input.proof.otpCode,
    otpChannel: EMAIL_OTP_CHANNEL,
    ownerProofBindingDigest: binding,
    action: WALLET_EMAIL_OTP_ACTIONS.login,
    operation: WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
  });
  if (!verified.ok)
    return {
      kind: 'refused',
      code: 'unauthorized',
      message: 'The transaction Email OTP approval failed',
    };
  if (verified.consumeInBatch.length === 0 || verified.challengeId !== input.proof.challengeId)
    return {
      kind: 'refused',
      code: 'unauthorized',
      message: 'The transaction Email OTP approval differs',
    };
  const now = Date.now();
  const expiresAtMs = record.preparation.expiresAtMs;
  if (expiresAtMs <= now)
    return {
      kind: 'refused',
      code: 'expired',
      message: 'The transaction Email OTP approval expired',
    };
  const factor = buildVerifiedWalletOperationEmailOtpFactorResult({
    tenantId: record.target.tenantId,
    principalId: input.operation.principalId,
    walletId: record.target.identity.walletId,
    authorityRef,
    requestOrigin: input.origin,
    audience: input.origin,
    factorId: requireParsed(
      parseAuthFactorId(
        `email_otp:${current.walletAuthAuthority.factor.provider}:${providerSubject}`,
      ),
      'factorId',
    ),
    operation: input.operation,
    challengeId: input.proof.challengeId,
    verificationReceiptDigest: await sha256Utf8DigestB64u(
      alphabetizeStringify({
        challengeId: input.proof.challengeId,
        operationFingerprint: input.expectedChallenge,
      }),
    ),
    verifiedAtMs: now,
    expiresAtMs,
  });
  return {
    kind: 'verified',
    factor,
    consumeInBatch: verified.consumeInBatch,
    proofDigest: await sha256Utf8DigestB64u(alphabetizeStringify(input.proof)),
  };
}
