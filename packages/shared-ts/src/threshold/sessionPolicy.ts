import type { WebAuthnRpId } from '../utils/domainIds';
import type { DigestB64u } from '../utils/canonicalPrimitives';

// The Wallet Session budget when the app asks for none. After it, the Wallet asks for a step-up.
export const DEFAULT_WALLET_SESSION_TTL_MS = 24 * 60 * 60_000;
export const DEFAULT_WALLET_SESSION_REMAINING_USES = 5;
// The budget of a linked device when the app asks for none.
export const LINKED_DEVICE_WALLET_SESSION_TTL_MS = 15 * 60 * 1000;
export const LINKED_DEVICE_WALLET_SESSION_REMAINING_USES = 100;
// The maximum of a project environment whose tenant set none in the Console.
export const DEFAULT_TENANT_WALLET_SESSION_MAX_TTL_MS = 30 * 24 * 60 * 60_000;
export const DEFAULT_TENANT_WALLET_SESSION_MAX_REMAINING_USES = 100;
// The platform ceiling: the highest maximum a tenant can set.
export const MAX_WALLET_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const MAX_WALLET_SESSION_REMAINING_USES = 1_000_000;

export type Ed25519AuthorityScope =
  | { kind: 'voiceid'; deviceKeyId: DigestB64u; rpId?: never; provider?: never; providerUserId?: never }
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
