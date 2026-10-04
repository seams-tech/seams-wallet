import type { WalletId } from '@shared/utils/domainIds';

export type WebAuthnLoginChallengeRecord = {
  version: 'webauthn_login_challenge_v1';
  challengeId: string;
  userId: WalletId;
  rpId: string;
  challengeB64u: string;
  createdAtMs: number;
  expiresAtMs: number;
};
