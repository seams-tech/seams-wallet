import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { base64UrlEncode } from '@shared/utils/encoders';
import { type WalletEmailOtpChannel } from '@shared/utils/emailOtpDomain';

type EmailOtpFailureAuditInput = {
  source:
    | 'registration_finalize'
    | 'login_challenge'
    | 'login_verify'
    | 'unlock_verify'
    | 'signing_session_challenge'
    | 'signing_session_verify';
  code: string;
  message: string;
  challengeId?: string;
  otpChannel?: WalletEmailOtpChannel;
  operation?: string;
  lockedUntilMs?: number;
};

export type EmailOtpWebhookEventDescriptor = {
  eventType: string;
  eventId?: string;
  payload: Record<string, unknown>;
};

export function emailOtpStatusCode(code: string | undefined): number {
  if (code === 'internal') return 500;
  if (code === 'not_configured') return 503;
  if (code === 'not_found') return 404;
  if (code === 'rate_limited') return 429;
  if (code === 'stronger_auth_required') return 403;
  if (
    code === 'reenrollment_required' ||
    code === 'registration_attempt_missing' ||
    code === 'registration_attempt_expired'
  ) {
    return 409;
  }
  if (
    code === 'challenge_id_mismatch' ||
    code === 'challenge_purpose_mismatch' ||
    code === 'challenge_subject_mismatch' ||
    code === 'challenge_email_mismatch' ||
    code === 'challenge_wallet_mismatch' ||
    code === 'challenge_session_mismatch' ||
    code === 'challenge_org_mismatch' ||
    code === 'challenge_channel_mismatch' ||
    code === 'registration_reroll_disallowed' ||
    code === 'challenge_expired_or_invalid' ||
    code === 'invalid_otp'
  ) {
    return 401;
  }
  return 400;
}

function emailOtpFailureAuditPayload(input: EmailOtpFailureAuditInput): Record<string, unknown> {
  return {
    source: input.source,
    code: input.code,
    message: input.message,
    ...(input.challengeId ? { challengeId: input.challengeId } : {}),
    ...(input.otpChannel ? { otpChannel: input.otpChannel } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(typeof input.lockedUntilMs === 'number' ? { lockedUntilMs: input.lockedUntilMs } : {}),
  };
}

function shouldEmitEmailOtpLockedWebhook(code: string): boolean {
  return code === 'otp_locked_out' || code === 'otp_attempts_exhausted';
}

export function emailOtpFailureWebhookEventDescriptors(
  input: EmailOtpFailureAuditInput,
): EmailOtpWebhookEventDescriptor[] {
  const payload = emailOtpFailureAuditPayload(input);
  const event = {
    eventType: 'wallet.email_otp.failed',
    ...(input.challengeId ? { eventId: input.challengeId } : {}),
    payload,
  };
  if (!shouldEmitEmailOtpLockedWebhook(input.code)) return [event];
  return [
    event,
    {
      eventType: 'wallet.email_otp.locked',
      ...(input.challengeId ? { eventId: input.challengeId } : {}),
      payload,
    },
  ];
}

export function emailOtpLoggedInWebhookEventDescriptor(input: {
  challengeId: string;
  otpChannel: WalletEmailOtpChannel;
  unlockBackend: string;
}): EmailOtpWebhookEventDescriptor {
  return {
    eventType: 'wallet.email_otp.logged_in',
    eventId: input.challengeId,
    payload: {
      otpChannel: input.otpChannel,
      unlockBackend: input.unlockBackend,
      challengeId: input.challengeId,
    },
  };
}

export async function hashEmailOtpOperationBinding(input: {
  walletId: string;
  providerUserId: string;
  orgId: string;
  operation: string;
  requestOrigin: string | null;
  audience: string | null;
  authorityRef?: unknown;
  operationFingerprintDigest?: string;
}): Promise<string> {
  const json = alphabetizeStringify({
    walletId: input.walletId,
    providerUserId: input.providerUserId,
    orgId: input.orgId,
    operation: input.operation,
    requestOrigin: input.requestOrigin || '',
    audience: input.audience || '',
    ...(input.authorityRef !== undefined ? { authorityRef: input.authorityRef } : {}),
    ...(input.operationFingerprintDigest
      ? { operationFingerprintDigest: input.operationFingerprintDigest }
      : {}),
  });
  return base64UrlEncode(await sha256BytesUtf8(json));
}
