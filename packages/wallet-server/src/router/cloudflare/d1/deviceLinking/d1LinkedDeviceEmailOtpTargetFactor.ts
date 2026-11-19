/**
 * The D1 composition behind the linked-device Email OTP challenge routes.
 *
 * The target device enrolls its own Email OTP factor; the server releases no
 * factor of another method. Everything identity-bearing is resolved
 * server-side from the wallet's enrollment: with an enrollment, the code goes
 * to its address under the `wallet_email_otp_device_link` purpose, and the
 * install commit adds the target's factor to it (`existing_enrollment`).
 * Without one, the code goes to the target address as a registration, and the
 * install commit creates the enrollment (`new_enrollment`). Device 2 supplies
 * only the code it received. Challenges reuse the Email OTP issuer, verifier,
 * rate limits and lockouts, bound by a digest over the whole device-link
 * context.
 */
import type {
  LinkedDeviceApprovalV1,
  LinkedDeviceEmailOtpEnrollmentSelectionV1,
  LinkedDeviceEmailOtpVerificationGrantV1,
  LinkedDeviceTargetPreparationV1,
} from '@shared/device-linking/contracts';
import { computeLinkedDeviceTargetPreparationDigestV1 } from '@shared/device-linking/digests';
import { base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { sha256HexUtf8 } from '@shared/utils/digests';
import type { WalletAuthMethodId, VerifiedEmailAddress } from '@shared/utils/domainIds';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_ACTIONS,
  WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION,
  WALLET_EMAIL_OTP_REGISTRATION_OPERATION,
} from '@shared/utils/emailOtpDomain';
import {
  computeLinkedDeviceEmailOtpAuthorityDigestV1,
  computeLinkedDeviceEmailOtpChallengeBindingDigestV1,
  computeLinkedDeviceEmailOtpGrantTokenDigestV1,
  linkedDeviceEmailOtpDescriptorCredentialIdV1,
  linkedDeviceEmailOtpGrantAdmitsUseV1,
  parseLinkedDeviceEmailOtpGrantRecordV1,
} from '../../../../core/deviceLinking/linkedDeviceEmailOtpGrant';
import type { LinkedDeviceSessionRecordV1 } from '../../../../core/deviceLinking/linkedDeviceSessionRecord';
import type { DeviceLinkingEmailOtpTargetFactorProviderV1 } from '../../../transport/fetch/routes/deviceLinking';
import type {
  LinkedDeviceEmailOtpGrantRegistrationPortV1,
  VerifiedLinkedDeviceEmailOtpGrantV1,
} from './d1LinkedDeviceTargetCredentialProvider';
import type { CloudflareD1EmailOtpChallengeIssuer } from '../emailOtp/d1EmailOtpChallengeIssuer';
import type { CloudflareD1EmailOtpChallengeVerifier } from '../emailOtp/d1EmailOtpChallengeVerifier';
import type { CloudflareD1EmailOtpEnrollmentStore } from '../emailOtp/d1EmailOtpEnrollmentStore';
import { type D1LinkedDeviceEmailOtpGrantStoreV1 } from './d1LinkedDeviceEmailOtpGrantStore';

const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_RESEND_COOLDOWN_MS = 30 * 1_000;

type ResolvedChallengeContextV1 = {
  readonly enrollment: LinkedDeviceEmailOtpEnrollmentSelectionV1;
  readonly targetEmail: VerifiedEmailAddress;
  readonly targetPreparationDigestB64u: ReturnType<typeof parseDigestB64u>;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly authorityDigestB64u: ReturnType<typeof parseDigestB64u>;
  readonly bindingDigestB64u: string;
  readonly providerUserId: string;
  readonly orgId: string;
};

type RefusedV1 = { readonly kind: 'refused'; readonly code: string; readonly message: string };

type SentEmailOtpChallengeV1 = Extract<
  NonNullable<
    Extract<
      LinkedDeviceSessionRecordV1,
      { readonly targetFactor: { readonly kind: 'email_otp' } }
    >['emailOtpChallenge']
  >,
  { readonly state: 'sent' }
>;

function resolveSentEmailOtpChallengeV1(
  session: LinkedDeviceSessionRecordV1,
  challengeId: string,
): SentEmailOtpChallengeV1 | null {
  if (
    session.state.state !== 'awaiting_target_factor' ||
    session.targetFactor?.kind !== 'email_otp'
  ) {
    return null;
  }
  const challenge = session.emailOtpChallenge;
  if (!challenge || challenge.state !== 'sent' || challenge.challengeId !== challengeId) {
    return null;
  }
  return challenge;
}

type D1LinkedDeviceEmailOtpTargetFactorOptionsV1 = {
  readonly issuer: Pick<CloudflareD1EmailOtpChallengeIssuer, 'create'>;
  readonly verifier: Pick<
    CloudflareD1EmailOtpChallengeVerifier,
    'verifyExisting' | 'verifyRegistration'
  >;
  /** The wallet's enrollment decides between a new enrollment and an added factor. */
  readonly enrollments: Pick<CloudflareD1EmailOtpEnrollmentStore, 'readEnrollment'>;
  readonly orgId: string;
  readonly grants: Pick<
    D1LinkedDeviceEmailOtpGrantStoreV1,
    'issueV1' | 'readByIdV1' | 'buildConsumeStatementsV1'
  >;
  readonly grantTtlMs?: number;
  readonly resendCooldownMs?: number;
};

export class D1LinkedDeviceEmailOtpTargetFactorV1 implements DeviceLinkingEmailOtpTargetFactorProviderV1 {
  private readonly options: D1LinkedDeviceEmailOtpTargetFactorOptionsV1;
  private readonly grantTtlMs: number;
  private readonly resendCooldownMs: number;

  constructor(options: D1LinkedDeviceEmailOtpTargetFactorOptionsV1) {
    this.options = options;
    this.grantTtlMs = requirePositiveMs(options.grantTtlMs ?? DEFAULT_GRANT_TTL_MS, 'grantTtlMs');
    this.resendCooldownMs = requirePositiveMs(
      options.resendCooldownMs ?? DEFAULT_RESEND_COOLDOWN_MS,
      'resendCooldownMs',
    );
  }

  async startChallengeV1(
    input:
      | {
          readonly session: LinkedDeviceSessionRecordV1;
          readonly approval: LinkedDeviceApprovalV1;
          readonly preparation: LinkedDeviceTargetPreparationV1;
          readonly resend: false;
          readonly requestedAtMs: number;
        }
      | {
          readonly session: LinkedDeviceSessionRecordV1;
          readonly approval: LinkedDeviceApprovalV1;
          readonly preparation: LinkedDeviceTargetPreparationV1;
          readonly resend: true;
          readonly requestedAtMs: number;
        },
  ): Promise<
    | {
        readonly kind: 'sent';
        readonly challengeId: string;
        readonly maskedEmailHint: string;
        readonly expiresAtMs: number;
        readonly resendAvailableAtMs: number;
      }
    | RefusedV1
  > {
    const context = await this.resolveChallengeContextV1(input.approval, input.preparation);
    if (context.kind === 'refused') return context;
    const common = {
      userId: context.providerUserId,
      walletId: String(input.approval.walletId),
      orgId: context.orgId,
      otpChannel: EMAIL_OTP_CHANNEL,
      ownerProofBindingDigest: context.bindingDigestB64u,
      // A fresh start reuses an outstanding challenge instead of racing it;
      // an explicit resend, arriving after the route's cooldown gate, mints anew.
      reuseActiveChallenge: !input.resend,
    } as const;
    // With an enrollment, the issuer sends the code to the enrollment's address
    // and applies its lockout.
    const issued =
      context.enrollment.kind === 'existing_enrollment'
        ? await this.options.issuer.create({
            ...common,
            action: WALLET_EMAIL_OTP_ACTIONS.deviceLink,
            operation: WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION,
          })
        : await this.options.issuer.create({
            ...common,
            email: context.targetEmail,
            action: WALLET_EMAIL_OTP_ACTIONS.registration,
            operation: WALLET_EMAIL_OTP_REGISTRATION_OPERATION,
          });
    if (!issued.ok) {
      return { kind: 'refused', code: issued.code, message: issued.message };
    }
    return {
      kind: 'sent',
      challengeId: issued.challenge.challengeId,
      maskedEmailHint: issued.delivery.emailHint,
      expiresAtMs: issued.challenge.expiresAtMs,
      resendAvailableAtMs: issued.challenge.issuedAtMs + this.resendCooldownMs,
    };
  }

  async verifyChallengeV1(input: {
    readonly session: LinkedDeviceSessionRecordV1;
    readonly approval: LinkedDeviceApprovalV1;
    readonly preparation: LinkedDeviceTargetPreparationV1;
    readonly challengeId: string;
    readonly otpCode: string;
    readonly requestedAtMs: number;
  }): Promise<
    | { readonly kind: 'verified'; readonly grant: LinkedDeviceEmailOtpVerificationGrantV1 }
    | RefusedV1
  > {
    const context = await this.resolveChallengeContextV1(input.approval, input.preparation);
    if (context.kind === 'refused') return context;
    if (!resolveSentEmailOtpChallengeV1(input.session, input.challengeId)) {
      return {
        kind: 'refused',
        code: 'challenge_missing',
        message: 'the link session has no sent challenge with this ID',
      };
    }
    const verified = await this.verifyCodeV1(input, context);
    if (verified.kind === 'refused') return verified;
    const issuedAtMs = input.requestedAtMs;
    // The grant must not outlive the artifacts it authorizes against.
    const expiresAtMs = Math.min(
      issuedAtMs + this.grantTtlMs,
      input.approval.expiresAtMs,
      input.preparation.expiresAtMs,
    );
    if (expiresAtMs <= issuedAtMs) {
      return {
        kind: 'refused',
        code: 'enrollment_expired',
        message: 'linked-device enrollment has no remaining lifetime for a grant',
      };
    }
    const grantId = randomTokenB64u(16);
    const grantToken = randomTokenB64u(32);
    const emailHashHex = await sha256HexUtf8(context.targetEmail);
    const grantRecord = parseLinkedDeviceEmailOtpGrantRecordV1({
      kind: 'linked_device_email_otp_grant_record_v1',
      grantId,
      grantTokenDigestB64u: await computeLinkedDeviceEmailOtpGrantTokenDigestV1(grantToken),
      walletId: input.approval.walletId,
      linkSessionId: input.approval.linkSessionId,
      enrollmentId: input.approval.enrollmentId,
      deviceId: input.approval.deviceId,
      targetFactor: { kind: 'email_otp' },
      targetPreparationDigestB64u: context.targetPreparationDigestB64u,
      targetEmail: context.targetEmail,
      enrollment: context.enrollment,
      emailHashHex,
      registrationAuthorityId: verified.challengeId,
      providerUserId: context.providerUserId,
      walletAuthMethodId: context.walletAuthMethodId,
      authorityDigestB64u: context.authorityDigestB64u,
      challengeId: verified.challengeId,
      state: { kind: 'issued' },
      issuedAtMs,
      expiresAtMs,
    });
    const issued = await this.options.grants.issueV1(grantRecord);
    if (issued.kind === 'refused') return issued;
    return {
      kind: 'verified',
      grant: {
        kind: 'linked_device_email_otp_verification_grant_v1',
        grantId,
        grantToken,
        challengeId: verified.challengeId,
        linkSessionId: input.approval.linkSessionId,
        walletId: input.approval.walletId,
        enrollmentId: input.approval.enrollmentId,
        deviceId: input.approval.deviceId,
        targetPreparationDigestB64u: context.targetPreparationDigestB64u,
        targetEmail: context.targetEmail,
        enrollment: context.enrollment,
        emailHashHex,
        registrationAuthorityId: verified.challengeId,
        providerUserId: context.providerUserId,
        authorityDigestB64u: context.authorityDigestB64u,
        issuedAtMs,
        expiresAtMs,
      },
    };
  }

  /** Checks the code under the purpose the challenge was issued for. */
  private async verifyCodeV1(
    input: {
      readonly approval: LinkedDeviceApprovalV1;
      readonly challengeId: string;
      readonly otpCode: string;
    },
    context: ResolvedChallengeContextV1,
  ): Promise<{ readonly kind: 'verified'; readonly challengeId: string } | RefusedV1> {
    if (context.enrollment.kind === 'existing_enrollment') {
      const verified = await this.options.verifier.verifyExisting({
        userId: context.providerUserId,
        walletId: String(input.approval.walletId),
        orgId: context.orgId,
        challengeId: input.challengeId,
        otpCode: input.otpCode,
        otpChannel: EMAIL_OTP_CHANNEL,
        ownerProofBindingDigest: context.bindingDigestB64u,
        action: WALLET_EMAIL_OTP_ACTIONS.deviceLink,
        operation: WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION,
      });
      if (!verified.ok) return { kind: 'refused', code: verified.code, message: verified.message };
      if (
        verified.challengeId !== input.challengeId ||
        verified.enrollment.verifiedEmail !== context.targetEmail
      ) {
        return {
          kind: 'refused',
          code: 'scope_mismatch',
          message: 'Email OTP device-link challenge identity changed',
        };
      }
      return { kind: 'verified', challengeId: verified.challengeId };
    }
    const verified = await this.options.verifier.verifyRegistration({
      providerSubject: context.providerUserId,
      walletId: String(input.approval.walletId),
      orgId: context.orgId,
      challengeId: input.challengeId,
      otpCode: input.otpCode,
      otpChannel: EMAIL_OTP_CHANNEL,
      ownerProofBindingDigest: context.bindingDigestB64u,
      proofEmail: context.targetEmail,
    });
    if (!verified.ok) return { kind: 'refused', code: verified.code, message: verified.message };
    if (
      verified.email !== context.targetEmail ||
      verified.challengeSubjectId !== context.providerUserId ||
      verified.challengeId !== input.challengeId
    ) {
      return {
        kind: 'refused',
        code: 'scope_mismatch',
        message: 'Email OTP registration challenge identity changed',
      };
    }
    return { kind: 'verified', challengeId: verified.challengeId };
  }

  async verifyRegistrationGrantV1(
    input: Parameters<LinkedDeviceEmailOtpGrantRegistrationPortV1['verifyRegistrationGrantV1']>[0],
  ): Promise<
    | { readonly kind: 'verified'; readonly grant: VerifiedLinkedDeviceEmailOtpGrantV1 }
    | { readonly kind: 'rejected'; readonly message: string }
  > {
    const wireGrant = input.registration.emailOtpVerificationGrant;
    if (input.registration.targetFactor.kind !== 'email_otp' || !wireGrant) {
      return { kind: 'rejected', message: 'Email OTP verification grant is missing' };
    }
    const durable = await this.options.grants.readByIdV1(wireGrant.grantId);
    if (!durable || !linkedDeviceEmailOtpGrantAdmitsUseV1(durable, input.requestedAtMs)) {
      return { kind: 'rejected', message: 'Email OTP verification grant is unavailable' };
    }
    const tokenDigest = await computeLinkedDeviceEmailOtpGrantTokenDigestV1(wireGrant.grantToken);
    if (!isEmailOtpTargetPreparationV1(input.preparation)) {
      return { kind: 'rejected', message: 'Email OTP target preparation is unavailable' };
    }
    const identityMatches =
      tokenDigest === durable.grantTokenDigestB64u &&
      durable.walletId === input.preparation.walletId &&
      durable.linkSessionId === input.preparation.linkSessionId &&
      durable.enrollmentId === input.preparation.enrollmentId &&
      durable.deviceId === input.preparation.deviceId &&
      durable.walletAuthMethodId === input.preparation.walletAuthMethodId &&
      durable.targetPreparationDigestB64u === input.registration.targetPreparationDigestB64u &&
      durable.targetEmail === input.preparation.targetEmail &&
      durable.targetEmail === wireGrant.targetEmail &&
      durable.enrollment.kind === wireGrant.enrollment.kind &&
      durable.authorityDigestB64u === wireGrant.authorityDigestB64u &&
      durable.challengeId === wireGrant.challengeId &&
      durable.issuedAtMs === wireGrant.issuedAtMs &&
      durable.expiresAtMs === wireGrant.expiresAtMs &&
      durable.emailHashHex === wireGrant.emailHashHex &&
      durable.registrationAuthorityId === wireGrant.registrationAuthorityId &&
      durable.providerUserId === wireGrant.providerUserId;
    if (!identityMatches) {
      return { kind: 'rejected', message: 'Email OTP verification grant identity changed' };
    }
    // The install commit inserts the enrollment or adds a factor to it, so the
    // wallet's enrollment must still be in the state the code was verified for.
    const enrollment = await this.options.enrollments.readEnrollment(
      String(input.preparation.walletId),
    );
    if (durable.enrollment.kind === 'new_enrollment' && enrollment) {
      return { kind: 'rejected', message: 'wallet already has an Email OTP enrollment' };
    }
    if (
      durable.enrollment.kind === 'existing_enrollment' &&
      (!enrollment ||
        enrollment.verifiedEmail !== durable.targetEmail ||
        enrollment.providerUserId !== durable.providerUserId)
    ) {
      return { kind: 'rejected', message: 'the wallet Email OTP enrollment changed' };
    }
    return {
      kind: 'verified',
      grant: {
        grantId: durable.grantId,
        targetEmail: durable.targetEmail,
        enrollment: durable.enrollment,
        providerUserId: durable.providerUserId,
        authorityDigestB64u: durable.authorityDigestB64u,
        descriptorCredentialIdB64u: await linkedDeviceEmailOtpDescriptorCredentialIdV1(
          durable.walletAuthMethodId,
        ),
      },
    };
  }

  async buildCompletionStatementsV1(
    input: Parameters<
      LinkedDeviceEmailOtpGrantRegistrationPortV1['buildCompletionStatementsV1']
    >[0],
  ) {
    return this.options.grants.buildConsumeStatementsV1({
      grantId: input.grant.grantId,
      consumedAtMs: input.consumedAtMs,
    });
  }

  /**
   * Resolves who receives the code and how the target's factor joins the
   * wallet. With an enrollment, the target address must be the enrollment's
   * address, because the enrollment keeps one email identity for all its
   * factors.
   */
  private async resolveChallengeContextV1(
    approval: LinkedDeviceApprovalV1,
    preparation: LinkedDeviceTargetPreparationV1,
  ): Promise<({ readonly kind: 'resolved' } & ResolvedChallengeContextV1) | RefusedV1> {
    if (approval.targetFactor.kind !== 'email_otp' || !isEmailOtpTargetPreparationV1(preparation)) {
      return {
        kind: 'refused',
        code: 'wrong_target_factor',
        message: 'approved target factor is not email OTP',
      };
    }
    const targetEmail = approval.targetFactor.targetEmail;
    if (targetEmail !== preparation.targetEmail) {
      return {
        kind: 'refused',
        code: 'target_changed',
        message: 'approved Email OTP target changed',
      };
    }
    const targetPreparationDigestB64u = parseDigestB64u(
      await computeLinkedDeviceTargetPreparationDigestV1(preparation),
    );
    const walletAuthMethodId = preparation.walletAuthMethodId;
    const existing = await this.options.enrollments.readEnrollment(String(approval.walletId));
    if (existing && existing.verifiedEmail !== targetEmail) {
      return {
        kind: 'refused',
        code: 'target_email_mismatch',
        message:
          "This wallet's Email OTP uses another email address. Enter that address on the new device.",
      };
    }
    const enrollment: LinkedDeviceEmailOtpEnrollmentSelectionV1 = existing
      ? { kind: 'existing_enrollment' }
      : { kind: 'new_enrollment' };
    const authorityDigestB64u = await computeLinkedDeviceEmailOtpAuthorityDigestV1({
      walletId: approval.walletId,
      enrollmentId: approval.enrollmentId,
      deviceId: approval.deviceId,
      walletAuthMethodId,
      targetEmail,
      enrollment,
    });
    const bindingDigestB64u = await computeLinkedDeviceEmailOtpChallengeBindingDigestV1({
      walletId: approval.walletId,
      linkSessionId: approval.linkSessionId,
      enrollmentId: approval.enrollmentId,
      deviceId: approval.deviceId,
      targetPreparationDigestB64u,
      targetEmail,
      enrollment,
      walletAuthMethodId,
    });
    return {
      kind: 'resolved',
      enrollment,
      targetEmail,
      targetPreparationDigestB64u,
      walletAuthMethodId,
      authorityDigestB64u,
      bindingDigestB64u,
      providerUserId: existing ? existing.providerUserId : String(targetEmail),
      orgId: existing ? existing.orgId : this.options.orgId,
    };
  }
}

function isEmailOtpTargetPreparationV1(
  preparation: LinkedDeviceTargetPreparationV1,
): preparation is Extract<
  LinkedDeviceTargetPreparationV1,
  { readonly targetFactor: { readonly kind: 'email_otp' } }
> {
  return preparation.targetFactor.kind === 'email_otp';
}

export function linkedDeviceEmailOtpGrantRegistrationPortV1(
  provider: D1LinkedDeviceEmailOtpTargetFactorV1,
): LinkedDeviceEmailOtpGrantRegistrationPortV1 {
  return {
    verifyRegistrationGrantV1: (input) => provider.verifyRegistrationGrantV1(input),
    buildCompletionStatementsV1: (input) => provider.buildCompletionStatementsV1(input),
  };
}

function requirePositiveMs(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function randomTokenB64u(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
