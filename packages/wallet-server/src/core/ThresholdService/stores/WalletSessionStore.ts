import type {
  ThresholdEd25519AuthorityScope,
  ThresholdEcdsaSigningRootMetadata,
} from '../../types';
import {
  WALLET_SESSION_FAILURE_CODES,
  type WalletSessionFailureCode,
} from '@shared/utils/walletSessionFailure';
import type { EcdsaKeyHandle } from '../../keyMaterialBrands';

export type Ed25519WalletSessionRecord = {
  expiresAtMs: number;
  relayerKeyId: string;
  userId: string;
  walletId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  authorityScope: ThresholdEd25519AuthorityScope;
  participantIds: number[];
} & Partial<ThresholdEcdsaSigningRootMetadata>;

type EcdsaWalletSessionRecordCore = {
  expiresAtMs: number;
  relayerKeyId: string;
  walletId: string;
  keyHandle: EcdsaKeyHandle;
  participantIds: number[];
};

type EcdsaWalletSessionRecord = EcdsaWalletSessionRecordCore &
  (
    | {
        signingRootId?: never;
        signingRootVersion?: never;
        walletKeyVersion?: never;
        derivationVersion?: never;
      }
    | ThresholdEcdsaSigningRootMetadata
  );

type WalletSessionRecord = Ed25519WalletSessionRecord | EcdsaWalletSessionRecord;

type WalletSessionConsumeUsesResult =
  | { ok: true; remainingUses: number }
  | { ok: false; code: string; message: string };

type WalletSessionConsumedUseResult =
  | { ok: true; consumed: boolean }
  | { ok: false; code: string; message: string };

type WalletSessionReplayGuardResult = { ok: true } | { ok: false; code: string; message: string };

export type WalletSessionStatus<TRecord extends WalletSessionRecord> = {
  record: TRecord;
  expiresAtMs: number;
  remainingUses: number;
};

type WalletSessionStatusLookupResult<TRecord extends WalletSessionRecord> =
  | { ok: true; status: WalletSessionStatus<TRecord> }
  | {
      ok: false;
      code: Extract<
        WalletSessionFailureCode,
        | typeof WALLET_SESSION_FAILURE_CODES.missing
        | typeof WALLET_SESSION_FAILURE_CODES.expired
        | typeof WALLET_SESSION_FAILURE_CODES.unavailable
      >;
    };

export interface WalletSessionStore<TRecord extends WalletSessionRecord> {
  putSession(
    id: string,
    record: TRecord,
    opts: { ttlMs: number; remainingUses: number },
  ): Promise<void>;
  getSession(id: string): Promise<TRecord | null>;
  getSessionStatus(id: string): Promise<WalletSessionStatusLookupResult<TRecord>>;
  /**
   * Consume one use from the session counter without fetching the session record.
   *
   * This enables session-token-only authorization flows where scope/expiry are enforced from
   * signed JWT claims instead of a KV-stored record, reducing KV read-after-write consistency issues.
   */
  consumeUseCount(id: string): Promise<WalletSessionConsumeUsesResult>;
  consumeUseCountOnce(id: string, idempotencyKey: string): Promise<WalletSessionConsumeUsesResult>;
  hasConsumedUseCountOnce(
    id: string,
    idempotencyKey: string,
  ): Promise<WalletSessionConsumedUseResult>;
  reserveReplayGuard(
    scopeId: string,
    replayKey: string,
    expiresAtMs: number,
  ): Promise<WalletSessionReplayGuardResult>;
}

export type Ed25519WalletSessionStore = WalletSessionStore<Ed25519WalletSessionRecord>;
export type EcdsaWalletSessionStore = WalletSessionStore<EcdsaWalletSessionRecord>;
