export type WebAuthnLoginChallengeRecord = {
  version: 'webauthn_login_challenge_v1';
  challengeId: string;
  userId: string;
  rpId: string;
  challengeB64u: string;
  createdAtMs: number;
  expiresAtMs: number;
};
