import type { Ed25519SessionPolicy, ThresholdEd25519AuthorityScope } from '../types';
import type { WebAuthnRpId } from '@shared/utils/domainIds';
import { buildPasskeyWalletAuthAuthority } from '@shared/utils/walletAuthAuthority';
import type { Ed25519WalletSessionRecord } from './stores/WalletSessionStore';

declare const rpId: WebAuthnRpId;

const authorityScope: ThresholdEd25519AuthorityScope = { kind: 'passkey_rp', rpId };
const passkeyAuthority = buildPasskeyWalletAuthAuthority({
  walletId: 'wallet_alice',
  rpId,
  credentialIdB64u: 'Y3JlZGVudGlhbC0x',
});

const sessionPolicy: Ed25519SessionPolicy = {
  version: 'threshold_session_v1',
  nearAccountId: 'alice.near',
  nearEd25519SigningKeyId: 'ed25519:wallet_alice:1',
  authority: passkeyAuthority,
  relayerKeyId: 'ed25519:relayer',
  thresholdSessionId: 'threshold-session-1',
  ttlMs: 60_000,
  remainingUses: 1,
};

const walletSession: Ed25519WalletSessionRecord = {
  expiresAtMs: 1,
  relayerKeyId: 'ed25519:relayer',
  userId: 'wallet_alice',
  walletId: 'wallet_alice',
  nearAccountId: 'alice.near',
  nearEd25519SigningKeyId: 'ed25519:wallet_alice:1',
  authorityScope,
  participantIds: [1, 2],
};

void sessionPolicy;
void walletSession;

const invalidSessionPolicy = {
  ...sessionPolicy,
  // @ts-expect-error Ed25519 session policy carries bound authority, never root rpId.
  rpId: 'wallet.example.test',
} satisfies Ed25519SessionPolicy;

const invalidSessionPolicyWithWalletId = {
  ...sessionPolicy,
  // @ts-expect-error Ed25519 session policy gets wallet binding from authority.
  walletId: 'wallet_alice',
} satisfies Ed25519SessionPolicy;

const invalidSessionPolicyWithAuthorityScope = {
  ...sessionPolicy,
  // @ts-expect-error Ed25519 session policy carries bound authority, never authorityScope.
  authorityScope,
} satisfies Ed25519SessionPolicy;

const invalidWalletSession = {
  ...walletSession,
  // @ts-expect-error Ed25519 wallet-session records carry authorityScope, never root rpId.
  rpId: 'wallet.example.test',
} satisfies Ed25519WalletSessionRecord;

const invalidEmailOtpAuthorityScopeWithProofKind = {
  kind: 'email_otp',
  provider: 'google',
  providerUserId: 'google:alice',
  // @ts-expect-error Ed25519 Email OTP authority scopes carry stable provider identity, never one-time proof kind.
  proofKind: 'otp_challenge',
} satisfies ThresholdEd25519AuthorityScope;

const invalidEmailOtpAuthorityScopeWithChallengeId = {
  kind: 'email_otp',
  provider: 'google',
  providerUserId: 'google:alice',
  // @ts-expect-error Ed25519 Email OTP authority scopes cannot carry one-time challenge IDs.
  challengeId: 'challenge-1',
} satisfies ThresholdEd25519AuthorityScope;

void invalidSessionPolicy;
void invalidSessionPolicyWithWalletId;
void invalidSessionPolicyWithAuthorityScope;
void invalidWalletSession;
void invalidEmailOtpAuthorityScopeWithProofKind;
void invalidEmailOtpAuthorityScopeWithChallengeId;
