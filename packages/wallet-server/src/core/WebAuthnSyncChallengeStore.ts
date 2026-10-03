export type WebAuthnSyncChallengeRecord = {
  version: 'webauthn_sync_challenge_v1';
  challengeId: string;
  rpId: string;
  expectedUserId?: string;
  challengeB64u: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type SyncChallengeFailure = {
  readonly ok: false;
  readonly code: 'wallet_home_conflict' | 'wallet_home_unavailable';
  readonly message: string;
  readonly record?: never;
};

export interface WebAuthnSyncChallengeStore {
  create(
    record: WebAuthnSyncChallengeRecord,
  ): Promise<
    | {
        readonly ok: true;
        readonly code?: never;
        readonly message?: never;
        readonly record?: never;
      }
    | SyncChallengeFailure
  >;
  consume(input: {
    readonly challengeId: string;
    readonly credentialIdB64u: string;
  }): Promise<
    | {
        readonly ok: true;
        readonly record: WebAuthnSyncChallengeRecord | null;
        readonly code?: never;
        readonly message?: never;
      }
    | SyncChallengeFailure
  >;
}
