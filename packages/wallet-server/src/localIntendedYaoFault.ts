import { assertString, requireArray, requireRecord } from '@shared/utils/validation';
import { ROUTER_AB_TRACE_ID_HEADER_V1 } from '@shared/utils/routerAbTraceContext';

export const LOCAL_INTENDED_YAO_FAULT_HEADER_V1 = 'x-seams-intended-yao-fault-v1';
export const LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1 = 'x-seams-intended-yao-fault-token-v1';
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
const ROUTER_AB_YAO_REPLAY_HEADER_V1 = 'x-seams-yao-replay';
const ROUTER_AB_YAO_EXECUTE_PATH_V1 = '/router-ab/router/ed25519-yao/execute';
const LOCAL_INTENDED_YAO_FAULT_TOKEN_PATTERN_V1 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/* Asks a Router built for the intended suite to end the registration burned
   instead of running it. The Router records that answer as the execution's
   terminal one, so an exact retry gets it from the Router. */
const LOCAL_INTENDED_ROUTER_BURN_HEADER_V1 = 'x-seams-local-intended-router-burn-v1';

/**
 * - `drop_router_response_once` loses the Router's reply to the first
 *   execute, and expects the Gateway to send the identical request again.
 * - `return_terminal_burned_once` has the Router end the first execute
 *   burned, and expects the Gateway to answer that failure without retrying.
 * - `answer_retryable_while_running_once` lets the Router keep running the
 *   first execute, and answers the Gateway at once that it failed
 *   recoverably, as a Deriver that refused a late preparation does. The
 *   Router's claim stays held until that run records its answer.
 */
type LocalIntendedYaoFaultModeV1 =
  | 'drop_router_response_once'
  | 'return_terminal_burned_once'
  | 'answer_retryable_while_running_once';

type LocalIntendedYaoFaultProofV1 =
  | 'exact_request_replayed'
  | 'terminal_failure_not_retried'
  | 'execution_left_running';

type LocalIntendedYaoFaultViolationV1 =
  | 'fault_already_armed'
  | 'router_execute_not_observed'
  | 'router_first_response_failed'
  | 'router_retry_not_observed'
  | 'router_retry_body_changed'
  | 'router_retry_trace_changed'
  | 'router_retry_marked_as_replay'
  | 'router_retry_response_failed'
  | 'router_terminal_not_recorded'
  | 'unexpected_additional_execute';

type LocalIntendedYaoFaultStateV1 =
  | {
      readonly kind: 'idle';
    }
  | {
      readonly kind: 'armed';
      readonly mode: LocalIntendedYaoFaultModeV1;
    }
  | {
      readonly kind: 'awaiting_exact_replay';
      readonly body: Uint8Array;
      readonly traceId: string;
    }
  | {
      readonly kind: 'proved';
      readonly proof: LocalIntendedYaoFaultProofV1;
    }
  | {
      readonly kind: 'violated';
      readonly violation: LocalIntendedYaoFaultViolationV1;
    };

type LocalIntendedYaoFaultOutcomeV1 =
  | {
      readonly kind: 'proved';
      readonly proof: LocalIntendedYaoFaultProofV1;
    }
  | {
      readonly kind: 'violated';
      readonly violation: LocalIntendedYaoFaultViolationV1;
    };

type LocalIntendedYaoFaultTokenV1 = {
  readonly value: string;
};

function equalRequestBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function parseLocalIntendedYaoFaultModeV1(
  value: string | null,
): LocalIntendedYaoFaultModeV1 | null {
  switch (value) {
    case 'drop_router_response_once':
    case 'return_terminal_burned_once':
    case 'answer_retryable_while_running_once':
      return value;
    default:
      return null;
  }
}

export function parseLocalIntendedYaoFaultTokenV1(
  value: string | null,
): LocalIntendedYaoFaultTokenV1 | null {
  if (!isLocalIntendedYaoFaultTokenV1(value)) return null;
  return { value };
}

export function isLocalIntendedYaoFaultTokenV1(value: string | null): value is string {
  return !!value && LOCAL_INTENDED_YAO_FAULT_TOKEN_PATTERN_V1.test(value);
}

/** Reconstructs a local fault request from its persisted boundary value. */
export function parseLocalIntendedKeptRouterRequestV1(value: unknown): Request {
  const record = requireRecord(value, 'Kept Router request');
  const headers = new Headers();
  for (const value of requireArray(record.headers, 'Kept Router headers')) {
    const pair = requireArray(value, 'Kept Router header');
    if (pair.length !== 2) throw new Error('Kept Router header must contain a name and value');
    headers.append(assertString(pair[0], 'header name'), assertString(pair[1], 'header value'));
  }
  return new Request(assertString(record.url, 'Kept Router URL'), {
    method: 'POST',
    headers,
    body: assertString(record.body, 'Kept Router body'),
  });
}

export class LocalIntendedYaoFaultControllerV1 {
  private state: LocalIntendedYaoFaultStateV1 = { kind: 'idle' };

  constructor(
    private readonly baseFetch: typeof globalThis.fetch,
    /** Keeps a Router call alive after the Gateway answered without it. */
    private readonly keepRunning: (running: Promise<unknown>) => void,
  ) {}

  arm(mode: LocalIntendedYaoFaultModeV1): void {
    if (this.state.kind !== 'idle') {
      this.state = { kind: 'violated', violation: 'fault_already_armed' };
      return;
    }
    this.state = { kind: 'armed', mode };
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== ROUTER_AB_YAO_EXECUTE_PATH_V1) {
      return await this.baseFetch.call(globalThis, request);
    }

    switch (this.state.kind) {
      case 'idle':
        return await this.baseFetch.call(globalThis, request);
      case 'armed':
        return await this.handleArmedExecute(request, this.state.mode);
      case 'awaiting_exact_replay':
        return await this.handleExactReplay(request, this.state);
      case 'proved':
      case 'violated':
        this.state = { kind: 'violated', violation: 'unexpected_additional_execute' };
        throw new Error('Local intended Yao fault observed an additional Router execute');
    }
  }

  consumeOutcome(): LocalIntendedYaoFaultOutcomeV1 {
    const current = this.state;
    this.state = { kind: 'idle' };
    switch (current.kind) {
      case 'proved':
        return current;
      case 'violated':
        return current;
      case 'armed':
        return { kind: 'violated', violation: 'router_execute_not_observed' };
      case 'awaiting_exact_replay':
        return { kind: 'violated', violation: 'router_retry_not_observed' };
      case 'idle':
        return { kind: 'violated', violation: 'router_execute_not_observed' };
    }
  }

  private async handleArmedExecute(
    request: Request,
    mode: LocalIntendedYaoFaultModeV1,
  ): Promise<Response> {
    if (mode === 'answer_retryable_while_running_once') {
      const running = this.baseFetch.call(globalThis, request);
      this.keepRunning(running.then((response) => response.arrayBuffer()));
      this.state = { kind: 'proved', proof: 'execution_left_running' };
      return Response.json({
        status: 'recoverable_failure',
        code: 'conflicting_pair',
        retry_after_ms: 100,
      });
    }
    if (mode === 'return_terminal_burned_once') {
      const headers = new Headers(request.headers);
      headers.set(LOCAL_INTENDED_ROUTER_BURN_HEADER_V1, 'burned');
      const response = await this.baseFetch.call(globalThis, new Request(request, { headers }));
      const answer: unknown = await response
        .clone()
        .json()
        .catch(() => null);
      this.state =
        response.ok && (answer as { readonly status?: unknown } | null)?.status === 'burned'
          ? { kind: 'proved', proof: 'terminal_failure_not_retried' }
          : { kind: 'violated', violation: 'router_terminal_not_recorded' };
      return response;
    }

    const body = new Uint8Array(await request.clone().arrayBuffer());
    const traceId = request.headers.get(ROUTER_AB_TRACE_ID_HEADER_V1) ?? '';
    const response = await this.baseFetch.call(globalThis, request);
    await response.clone().arrayBuffer();
    if (!response.ok) {
      this.state = { kind: 'violated', violation: 'router_first_response_failed' };
      return response;
    }
    this.state = { kind: 'awaiting_exact_replay', body, traceId };
    throw new Error('Local intended Yao fault dropped the completed Router response');
  }

  private async handleExactReplay(
    request: Request,
    expected: Extract<LocalIntendedYaoFaultStateV1, { kind: 'awaiting_exact_replay' }>,
  ): Promise<Response> {
    const replayBody = new Uint8Array(await request.clone().arrayBuffer());
    if (!equalRequestBytes(expected.body, replayBody)) {
      this.state = { kind: 'violated', violation: 'router_retry_body_changed' };
      throw new Error('Local intended Yao retry changed the Router request body');
    }
    if (request.headers.get(ROUTER_AB_TRACE_ID_HEADER_V1) !== expected.traceId) {
      this.state = { kind: 'violated', violation: 'router_retry_trace_changed' };
      throw new Error('Local intended Yao retry changed the Router trace ID');
    }
    // The Router decides a registration's replay from its own claim, and
    // answers the exact retry from the answer it recorded.
    if (request.headers.has(ROUTER_AB_YAO_REPLAY_HEADER_V1)) {
      this.state = { kind: 'violated', violation: 'router_retry_marked_as_replay' };
      throw new Error('Local intended Yao retry carried the replay marker');
    }
    const response = await this.baseFetch.call(globalThis, request);
    await response.clone().arrayBuffer();
    if (!response.ok) {
      this.state = { kind: 'violated', violation: 'router_retry_response_failed' };
      return response;
    }
    this.state = { kind: 'proved', proof: 'exact_request_replayed' };
    return response;
  }
}

export function requestWithoutLocalIntendedYaoFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_YAO_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedYaoFaultOutcomeV1(
  response: Response,
  outcome: LocalIntendedYaoFaultOutcomeV1,
  token: LocalIntendedYaoFaultTokenV1,
): Response {
  const headers = new Headers(response.headers);
  const proof = outcome.kind === 'proved' ? outcome.proof : `violation:${outcome.violation}`;
  const value = `${token.value}:${proof}`;
  headers.set(LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
