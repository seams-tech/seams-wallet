export type WebAuthnSyncChallengeRecord = {
  version: 'webauthn_sync_challenge_v1';
  challengeId: string;
  rpId: string;
  expectedUserId?: string;
  challengeB64u: string;
  createdAtMs: number;
  expiresAtMs: number;
};
