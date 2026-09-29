import type { WebAuthnRpId } from '../utils/domainIds';

export const DEFAULT_WALLET_SESSION_TTL_MS = 24 * 60 * 60_000;
export const DEFAULT_WALLET_SESSION_REMAINING_USES = 3;
export const MAX_WALLET_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const MAX_WALLET_SESSION_REMAINING_USES = 1_000_000;

export type Ed25519AuthorityScope =
  | {
      kind: 'passkey_rp';
      rpId: WebAuthnRpId;
      proofKind?: never;
      email?: never;
      provider?: never;
      providerUserId?: never;
      challengeId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    }
  | {
      kind: 'email_otp';
      provider: 'google' | 'email';
      providerUserId: string;
      proofKind?: never;
      rpId?: never;
      email?: never;
      challengeId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    };
