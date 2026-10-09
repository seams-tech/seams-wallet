import type { Variant } from '@shared/utils/variant';
import {
  parseMpcWalletSigningQuotaId,
  parseWalletSessionId,
  type MpcWalletSigningQuotaId,
  type WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import {
  parseActiveWalletSessionV1,
  parseWalletSessionOperationCredentialV1,
} from '@shared/device-linking/activeWalletSession';
import type {
  ActiveWalletSessionV1,
  WalletSessionOperationCredentialV1,
} from '@shared/device-linking/contracts';
import type { RegistrationEstablishedSessionV2 } from '@shared/utils/registrationEstablishedSession';
import {
  buildWalletSessionAuthorizationHeaders,
  buildRelayerJsonPostRequestInit,
  normalizeRelayerBaseUrl,
} from './relayerHttp';

const EXACT_WALLET_SESSION_STATUS_PATH = '/wallet/session/status' as const;

type ExactWalletSessionStatusIdentity = {
  readonly walletSessionId: WalletSessionId;
  readonly quotaId: MpcWalletSigningQuotaId;
};

/** The quota facts every observed status carries, whatever its lifecycle. */
type ObservedWalletSessionQuotaFacts = {
  readonly remainingUses: number;
  readonly expiresAtMs: number;
  readonly quotaLifecycle: 'active' | 'exhausted';
};

/**
 * The facts an observed status carries: the server's complete digest-free
 * authorization projection alongside its quota, so a reader reconciles its own
 * record from the same read that reports the lifecycle.
 */
type ObservedWalletSessionStatusFacts = ObservedWalletSessionQuotaFacts & {
  readonly authorization: ActiveWalletSessionV1;
};

/**
 * The quota facts a caller can assemble locally from an already-resolved
 * authorization, without a status read. This is deliberately narrower than a
 * status response: it makes no claim about the server's current projection.
 */
export type ActiveWalletSessionQuotaStatusV1 = ExactWalletSessionStatusIdentity & {
  readonly status: 'active';
  readonly remainingUses: number;
  readonly expiresAtMs: number;
};

/**
 * Every branch that observed a stored authorization carries it in full. The two
 * terminal branches name no authorization the caller can reconcile against and
 * cannot carry one.
 */
export type ExactWalletSessionStatus =
  | (ActiveWalletSessionQuotaStatusV1 & ObservedWalletSessionStatusFacts)
  | (ExactWalletSessionStatusIdentity &
      ObservedWalletSessionStatusFacts & {
        readonly status: 'exhausted';
        readonly remainingUses: 0;
      })
  | (ExactWalletSessionStatusIdentity &
      ObservedWalletSessionStatusFacts & {
        readonly status:
          | 'expired'
          | 'superseded'
          | 'authority_unavailable'
          | 'method_unavailable'
          | 'capability_unavailable';
      })
  | (ExactWalletSessionStatusIdentity & {
      readonly status: 'missing' | 'invalid';
      readonly remainingUses?: never;
      readonly expiresAtMs?: never;
      readonly quotaLifecycle?: never;
      readonly authorization?: never;
    });

export type PreparedWalletSessionStatus = Variant<ExactWalletSessionStatus, 'status', 'active'>;

/** What a registration response states about the session it issued. */
type RegistrationIssuedSession = Pick<
  RegistrationEstablishedSessionV2,
  | 'walletSessionId'
  | 'quotaId'
  | 'remainingUses'
  | 'expiresAtMs'
  | 'walletSession'
  | 'operationCredential'
>;

interface ExactWalletSessionStatusPort {
  read(input: ExactWalletSessionStatusIdentity): Promise<ExactWalletSessionStatus>;
}

type RelayerExactWalletSessionStatusPortOptions = {
  readonly relayerUrl: string;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly fetchImpl?: typeof fetch;
};

const defaultStatusFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

type LocalWalletSessionObservation = {
  readonly kind: 'local_wallet_session_observation';
  readonly sequence: number;
  readonly status: ExactWalletSessionStatus;
};

// These observations plan confirmation only. Signing uses fresh prepare admission.
// Bound the retained credentials and keep fetch mocks isolated.
const observationsByFetch = new WeakMap<typeof fetch, Map<string, LocalWalletSessionObservation>>();
let observationSequence = 0;

// Sessions a registration response issued that no host observation has read yet.
const registrationSessions = new Map<string, PreparedWalletSessionStatus>();

function statusIdentityKey(
  options: RelayerExactWalletSessionStatusPortOptions,
  identity: ExactWalletSessionStatusIdentity,
): string {
  return JSON.stringify([
    normalizeRelayerBaseUrl(options.relayerUrl),
    options.operationCredential.token,
    identity.walletSessionId,
    identity.quotaId,
  ]);
}

function recordStatusObservation(
  fetchImpl: typeof fetch,
  key: string,
  sequence: number,
  status: ExactWalletSessionStatus,
): ExactWalletSessionStatus {
  let observations = observationsByFetch.get(fetchImpl);
  if (!observations) {
    observations = new Map();
    observationsByFetch.set(fetchImpl, observations);
  }
  const previous = observations.get(key);
  if (previous && previous.sequence > sequence) return status;
  // Any recorded status is at least as new as the registration response.
  registrationSessions.delete(key);
  observations.delete(key);
  observations.set(key, { kind: 'local_wallet_session_observation', sequence, status });
  if (observations.size > 32) {
    const oldest = observations.keys().next();
    if (!oldest.done) observations.delete(oldest.value);
  }
  return status;
}

/** One operation owns this snapshot; subsequent operations create a new scope. */
export class WalletSessionStatusReadScope {
  private readonly readsByFetch = new Map<
    typeof fetch,
    Map<string, Promise<ExactWalletSessionStatus>>
  >();

  private suppliedStatus:
    | { readonly kind: 'remote' }
    | { readonly kind: 'host_observation' }
    | {
        readonly kind: 'server_response';
        readonly key: string;
        readonly status: PreparedWalletSessionStatus;
      } = { kind: 'remote' };

  static fromPrepare(
    options: RelayerExactWalletSessionStatusPortOptions,
    status: PreparedWalletSessionStatus,
  ): WalletSessionStatusReadScope {
    const scope = new WalletSessionStatusReadScope();
    scope.suppliedStatus = { kind: 'server_response', key: statusIdentityKey(options, status), status };
    return scope;
  }

  /** Initial prefill uses the issued response. Each refill request still verifies
   * current server authorization before it generates or admits material. */
  static fromRegistration(
    relayerUrl: string,
    session: RegistrationIssuedSession,
  ): WalletSessionStatusReadScope {
    const status = registrationSessionStatus(session);
    const scope = new WalletSessionStatusReadScope();
    scope.suppliedStatus = {
      kind: 'server_response',
      key: statusIdentityKey({ relayerUrl, operationCredential: session.operationCredential }, status),
      status,
    };
    return scope;
  }

  /**
   * A NEAR-only registration's finalize response states the session the server
   * issued as its last step. The wallet host's next observation of this exact
   * session reads it from the response; asking the server would repeat it.
   * An ECDSA registration keeps changing its session after it is issued, so
   * that path observes the server.
   */
  static acceptRegistrationSession(relayerUrl: string, session: RegistrationIssuedSession): void {
    const status = registrationSessionStatus(session);
    registrationSessions.set(
      statusIdentityKey({ relayerUrl, operationCredential: session.operationCredential }, status),
      status,
    );
    if (registrationSessions.size > 8) {
      const oldest = registrationSessions.keys().next();
      if (!oldest.done) registrationSessions.delete(oldest.value);
    }
  }

  /** One wallet-host observation. It reads a session that a registration response
   * issued once; every other read, and every explicit session query, asks the server. */
  static forHostObservation(): WalletSessionStatusReadScope {
    const scope = new WalletSessionStatusReadScope();
    scope.suppliedStatus = { kind: 'host_observation' };
    return scope;
  }

  static observationForConfirmation(
    options: RelayerExactWalletSessionStatusPortOptions,
    identity: ExactWalletSessionStatusIdentity,
  ): LocalWalletSessionObservation | null {
    return (
      observationsByFetch
        .get(options.fetchImpl ?? defaultStatusFetch)
        ?.get(statusIdentityKey(options, identity)) ?? null
    );
  }

  read(
    options: RelayerExactWalletSessionStatusPortOptions,
    identity: ExactWalletSessionStatusIdentity,
  ): Promise<ExactWalletSessionStatus> {
    if (this.suppliedStatus.kind === 'server_response') {
      if (this.suppliedStatus.key !== statusIdentityKey(options, identity)) {
        throw new Error('Wallet Session response identity changed before reconciliation');
      }
      return Promise.resolve(
        recordStatusObservation(
          options.fetchImpl ?? defaultStatusFetch,
          this.suppliedStatus.key,
          ++observationSequence,
          this.suppliedStatus.status,
        ),
      );
    }
    const fetchImpl = options.fetchImpl ?? defaultStatusFetch;
    let reads = this.readsByFetch.get(fetchImpl);
    if (!reads) {
      reads = new Map();
      this.readsByFetch.set(fetchImpl, reads);
    }
    const key = statusIdentityKey(options, identity);
    const existing = reads.get(key);
    if (existing) return existing;
    const sequence = ++observationSequence;
    const issued =
      this.suppliedStatus.kind === 'host_observation' ? registrationSessions.get(key) : undefined;
    const pending = issued
      ? Promise.resolve(recordStatusObservation(fetchImpl, key, sequence, issued))
      : createRelayerExactWalletSessionStatusPort(options)
          .read(identity)
          .then(recordStatusObservation.bind(null, fetchImpl, key, sequence));
    reads.set(key, pending);
    return pending;
  }
}

function registrationSessionStatus(session: RegistrationIssuedSession): PreparedWalletSessionStatus {
  return {
    status: 'active',
    walletSessionId: session.walletSessionId,
    quotaId: session.quotaId,
    remainingUses: session.remainingUses,
    expiresAtMs: session.expiresAtMs,
    quotaLifecycle: 'active',
    authorization: session.walletSession,
  };
}

const OBSERVED_FIELDS = [
  'ok',
  'status',
  'walletSessionId',
  'quotaId',
  'remainingUses',
  'expiresAtMs',
  'quotaLifecycle',
  'authorization',
] as const;
const TERMINAL_FIELDS = ['ok', 'status', 'walletSessionId', 'quotaId'] as const;

type WalletSessionObservedStatus =
  | 'active'
  | 'exhausted'
  | 'expired'
  | 'superseded'
  | 'authority_unavailable'
  | 'method_unavailable'
  | 'capability_unavailable';

type WalletSessionStatusResponseDto =
  | {
      readonly kind: 'observed';
      readonly status: WalletSessionObservedStatus;
      readonly walletSessionId: unknown;
      readonly quotaId: unknown;
      readonly remainingUses: unknown;
      readonly expiresAtMs: unknown;
      readonly quotaLifecycle: unknown;
      readonly authorization: unknown;
    }
  | {
      readonly kind: 'terminal';
      readonly status: 'missing' | 'invalid';
      readonly walletSessionId: unknown;
      readonly quotaId: unknown;
    }
  | { readonly kind: 'error'; readonly message: string | null };

function decodeWalletSessionStatusResponse(value: unknown): WalletSessionStatusResponseDto {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return { kind: 'error', message: null };
  }

  const fields = new Map<string, unknown>(Object.entries(value));
  const names = [...fields.keys()];
  const status = fields.get('status');
  const walletSessionId = fields.get('walletSessionId');
  const quotaId = fields.get('quotaId');
  if (fields.get('ok') === true && typeof status === 'string') {
    const observedStatus: WalletSessionObservedStatus | null =
      status === 'active' ||
      status === 'exhausted' ||
      status === 'expired' ||
      status === 'superseded' ||
      status === 'authority_unavailable' ||
      status === 'method_unavailable' ||
      status === 'capability_unavailable'
        ? status
        : null;
    if (observedStatus && names.length === OBSERVED_FIELDS.length) {
      const expected = new Set<string>(OBSERVED_FIELDS);
      if (names.every((name) => expected.has(name))) {
        return {
          kind: 'observed',
          status: observedStatus,
          walletSessionId,
          quotaId,
          remainingUses: fields.get('remainingUses'),
          expiresAtMs: fields.get('expiresAtMs'),
          quotaLifecycle: fields.get('quotaLifecycle'),
          authorization: fields.get('authorization'),
        };
      }
    }
    if ((status === 'missing' || status === 'invalid') && names.length === TERMINAL_FIELDS.length) {
      const expected = new Set<string>(TERMINAL_FIELDS);
      if (names.every((name) => expected.has(name))) {
        return { kind: 'terminal', status, walletSessionId, quotaId };
      }
    }
  }

  if (names.every((name) => name === 'code' || name === 'message')) {
    const message = fields.get('message');
    return { kind: 'error', message: typeof message === 'string' ? message : null };
  }
  return { kind: 'error', message: null };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseIdentity(
  record: Pick<
    Extract<WalletSessionStatusResponseDto, { readonly kind: 'observed' | 'terminal' }>,
    'walletSessionId' | 'quotaId'
  >,
  expected: ExactWalletSessionStatusIdentity,
): ExactWalletSessionStatusIdentity | null {
  const walletSessionId = parseWalletSessionId(record.walletSessionId);
  const quotaId = parseMpcWalletSigningQuotaId(record.quotaId);
  if (
    !walletSessionId.ok ||
    !quotaId.ok ||
    walletSessionId.value !== expected.walletSessionId ||
    quotaId.value !== expected.quotaId
  ) {
    return null;
  }
  return {
    walletSessionId: walletSessionId.value,
    quotaId: quotaId.value,
  };
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Reads the facts every observed branch carries. The authorization must be a
 * complete `ActiveWalletSessionV1` naming the quota the caller asked about, and
 * the quota lifecycle must agree with its own remaining-use count.
 */
function parseObservedStatusFacts(
  value: Extract<WalletSessionStatusResponseDto, { readonly kind: 'observed' }>,
  identity: ExactWalletSessionStatusIdentity,
): ObservedWalletSessionStatusFacts | null {
  if (value.quotaLifecycle !== 'active' && value.quotaLifecycle !== 'exhausted') return null;
  if (!isNonnegativeSafeInteger(value.remainingUses)) return null;
  if ((value.quotaLifecycle === 'exhausted') !== (value.remainingUses === 0)) return null;
  if (!isPositiveSafeInteger(value.expiresAtMs)) return null;
  let authorization: ActiveWalletSessionV1;
  try {
    authorization = parseActiveWalletSessionV1(value.authorization);
  } catch {
    return null;
  }
  if (
    authorization.quotaId !== identity.quotaId ||
    authorization.expiresAtMs !== value.expiresAtMs
  ) {
    return null;
  }
  return {
    remainingUses: value.remainingUses,
    expiresAtMs: value.expiresAtMs,
    quotaLifecycle: value.quotaLifecycle,
    authorization,
  };
}

export function parseExactWalletSessionStatusResponse(
  value: unknown,
  expected: ExactWalletSessionStatusIdentity,
): ExactWalletSessionStatus | null {
  return parseDecodedWalletSessionStatusResponse(
    decodeWalletSessionStatusResponse(value),
    expected,
  );
}

function parseDecodedWalletSessionStatusResponse(
  value: WalletSessionStatusResponseDto,
  expected: ExactWalletSessionStatusIdentity,
): ExactWalletSessionStatus | null {
  if (value.kind === 'error') return null;
  const identity = parseIdentity(value, expected);
  if (!identity) return null;
  if (value.kind === 'terminal') return { status: value.status, ...identity };
  switch (value.status) {
    case 'active': {
      const facts = parseObservedStatusFacts(value, identity);
      if (!facts || facts.quotaLifecycle !== 'active') return null;
      return { status: 'active', ...identity, ...facts };
    }
    case 'exhausted': {
      const facts = parseObservedStatusFacts(value, identity);
      if (!facts || facts.remainingUses !== 0) return null;
      return { status: 'exhausted', ...identity, ...facts, remainingUses: 0 };
    }
    case 'expired':
    case 'superseded':
    case 'authority_unavailable':
    case 'method_unavailable':
    case 'capability_unavailable': {
      const facts = parseObservedStatusFacts(value, identity);
      return facts ? { status: value.status, ...identity, ...facts } : null;
    }
    default:
      return null;
  }
}

class RelayerExactWalletSessionStatusPort implements ExactWalletSessionStatusPort {
  private readonly relayerUrl: string;
  private readonly operationCredential: WalletSessionOperationCredentialV1;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RelayerExactWalletSessionStatusPortOptions) {
    this.relayerUrl = normalizeRelayerBaseUrl(options.relayerUrl);
    if (!this.relayerUrl) throw new Error('Relayer URL is required');
    this.operationCredential = parseWalletSessionOperationCredentialV1(options.operationCredential);
    this.fetchImpl = options.fetchImpl ?? defaultStatusFetch;
  }

  async read(input: ExactWalletSessionStatusIdentity): Promise<ExactWalletSessionStatus> {
    const response = await this.fetchImpl(`${this.relayerUrl}${EXACT_WALLET_SESSION_STATUS_PATH}`, {
      ...buildRelayerJsonPostRequestInit({
        body: {
          walletSessionId: input.walletSessionId,
          quotaId: input.quotaId,
        },
        headers: buildWalletSessionAuthorizationHeaders(this.operationCredential),
      }),
      credentials: 'omit',
    });
    const payload: unknown = await response.json().catch(() => null);
    const decoded = decodeWalletSessionStatusResponse(payload);
    if (!response.ok) {
      const message =
        decoded.kind === 'error' && decoded.message
          ? decoded.message
          : `Wallet Session status request failed with HTTP ${response.status}`;
      throw new Error(message);
    }
    const parsed = parseDecodedWalletSessionStatusResponse(decoded, input);
    if (!parsed) throw new Error('Wallet Session status response is invalid');
    return parsed;
  }
}

export function createRelayerExactWalletSessionStatusPort(
  options: RelayerExactWalletSessionStatusPortOptions,
): ExactWalletSessionStatusPort {
  return new RelayerExactWalletSessionStatusPort(options);
}
