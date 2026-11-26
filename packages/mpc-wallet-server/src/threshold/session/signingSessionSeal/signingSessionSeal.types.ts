import type {
  SigningSessionSealEvaluation,
  SigningSessionSealProtocol,
} from '@shared/utils/signingSessionSeal';
import type { NormalizedLogger } from '../../../core/logger';

export type SigningSessionSealRouteHeaders = Record<string, string | string[] | undefined>;

export interface SigningSessionSealAuthContext {
  userId: string;
  session: SigningSessionSealAuthorizationSessionRecord;
}

export interface SigningSessionSealAuthorizeInput {
  headers: SigningSessionSealRouteHeaders;
  thresholdSessionId: string;
}

export type SigningSessionSealAuthorizeResult =
  | { ok: true; auth: SigningSessionSealAuthContext }
  | { ok: false; code?: string; message?: string; status?: number };

/**
 * One POPRF evaluation for a signing session. The device sends a blinded element; the server
 * never sees the OPRF input or the sealed secret. Without `keyVersion`, the current key applies.
 */
export interface SigningSessionSealEvaluateRequest {
  thresholdSessionId: string;
  blindedElementB64u: string;
  keyVersion?: string;
}

export type SigningSessionSealRouteResult =
  | (SigningSessionSealEvaluation & { ok: true; expiresAtMs: number })
  | {
      ok: false;
      code: string;
      message: string;
    };

export interface SigningSessionSealIdempotencyGetInput {
  key: string;
  nowMs: number;
}

export interface SigningSessionSealIdempotencySetInput {
  key: string;
  result: SigningSessionSealRouteResult;
  expiresAtMs: number;
}

export interface SigningSessionSealIdempotencyStore {
  get(input: SigningSessionSealIdempotencyGetInput): Promise<SigningSessionSealRouteResult | null>;
  set(input: SigningSessionSealIdempotencySetInput): Promise<void>;
}

export interface SigningSessionSealServiceIdempotencyOptions {
  store: SigningSessionSealIdempotencyStore;
  ttlMs?: number;
}

export interface SigningSessionSealService {
  evaluate(
    request: SigningSessionSealEvaluateRequest,
    auth: SigningSessionSealAuthContext,
  ): Promise<SigningSessionSealRouteResult>;
}

export interface SigningSessionSealRoutesOptions {
  basePath?: string;
  service: SigningSessionSealService;
  capabilities?: SigningSessionSealStartupCapabilities;
  authorize?: (
    input: SigningSessionSealAuthorizeInput,
  ) => Promise<SigningSessionSealAuthorizeResult> | SigningSessionSealAuthorizeResult;
}

export interface SigningSessionSealStartupCapabilities {
  mode: 'sealed_refresh_v1';
  protocol: SigningSessionSealProtocol;
  currentKeyVersion: string;
}

export type { SigningSessionSealCurve } from '@shared/utils/signingSessionSeal';

type SigningSessionSealAuthorizationSessionRecordBase = {
  userId: string;
  expiresAtMs: number;
};

type SigningSessionSealExactThresholdSessionRecordBase =
  SigningSessionSealAuthorizationSessionRecordBase & {
    kind: 'exact_wallet_session_operation_credential';
    thresholdSessionId: string;
  };

export type SigningSessionSealEcdsaThresholdSessionRecord =
  SigningSessionSealExactThresholdSessionRecordBase & {
    curve: 'ecdsa';
  };

export type SigningSessionSealEd25519ThresholdSessionRecord =
  SigningSessionSealExactThresholdSessionRecordBase & {
    curve: 'ed25519';
  };

export type SigningSessionSealThresholdSessionRecord =
  | SigningSessionSealEcdsaThresholdSessionRecord
  | SigningSessionSealEd25519ThresholdSessionRecord;

export type SigningSessionSealAuthorizationSessionRecord = SigningSessionSealThresholdSessionRecord;

/** The server keys of the seal. `info` comes from the admitted wallet and threshold session. */
export interface SigningSessionSealEvaluator {
  readonly currentKeyVersion: string;
  evaluate(input: {
    readonly walletId: string;
    readonly thresholdSessionId: string;
    readonly keyVersion: string;
    readonly blindedElementB64u: string;
  }): Promise<
    | (SigningSessionSealEvaluation & { readonly ok: true })
    | { readonly ok: false; readonly code: string; readonly message: string }
  >;
}

export interface SigningSessionSealGuardInput {
  thresholdSessionId: string;
  auth: SigningSessionSealAuthContext;
}

export type SigningSessionSealGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type SigningSessionSealGuard = (
  input: SigningSessionSealGuardInput,
) => Promise<SigningSessionSealGuardResult> | SigningSessionSealGuardResult;

export interface SigningSessionSealAuditEvent {
  thresholdSessionId: string;
  userId: string;
  ok: boolean;
  code?: string;
  durationMs: number;
}

export type SigningSessionSealAuditSink = (
  event: SigningSessionSealAuditEvent,
) => Promise<void> | void;

export interface CreateSigningSessionSealServiceOptions {
  evaluator: SigningSessionSealEvaluator;
  idempotency?: SigningSessionSealServiceIdempotencyOptions;
  guard?: SigningSessionSealGuard;
  audit?: SigningSessionSealAuditSink;
  logger?: NormalizedLogger;
  nowMs?: () => number;
}
