import { ROUTER_AB_TRACE_ID_HEADER_V1 } from '@shared/utils/routerAbTraceContext';

export const LOCAL_INTENDED_YAO_FAULT_HEADER_V1 = 'x-seams-intended-yao-fault-v1';
export const LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1 = 'x-seams-intended-yao-fault-token-v1';
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
const ROUTER_AB_YAO_REPLAY_HEADER_V1 = 'x-seams-yao-replay';
const ROUTER_AB_YAO_EXECUTE_PATH_V1 = '/router-ab/router/ed25519-yao/execute';
const LOCAL_INTENDED_YAO_FAULT_TOKEN_PATTERN_V1 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type LocalIntendedYaoFaultModeV1 = 'drop_router_response_once' | 'return_terminal_burned_once';

type LocalIntendedYaoFaultProofV1 = 'exact_request_replayed' | 'terminal_failure_not_retried';

type LocalIntendedYaoFaultViolationV1 =
  | 'fault_already_armed'
  | 'router_execute_not_observed'
  | 'router_first_response_failed'
  | 'router_retry_not_observed'
  | 'router_retry_body_changed'
  | 'router_retry_trace_changed'
  | 'router_retry_marker_missing'
  | 'router_retry_response_failed'
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

const LOCAL_INTENDED_BURNED_EXECUTION_ID_V1 = new Array<number>(32).fill(93);

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

function terminalBurnedRouterResponseV1(): Response {
  return new Response(
    JSON.stringify({
      status: 'burned',
      execution_id: LOCAL_INTENDED_BURNED_EXECUTION_ID_V1,
      reason: 'protocol_failure',
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

export class LocalIntendedYaoFaultControllerV1 {
  private state: LocalIntendedYaoFaultStateV1 = { kind: 'idle' };

  constructor(private readonly baseFetch: typeof globalThis.fetch) {}

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
    if (mode === 'return_terminal_burned_once') {
      this.state = { kind: 'proved', proof: 'terminal_failure_not_retried' };
      return terminalBurnedRouterResponseV1();
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
    if (request.headers.get(ROUTER_AB_YAO_REPLAY_HEADER_V1) !== '1') {
      this.state = { kind: 'violated', violation: 'router_retry_marker_missing' };
      throw new Error('Local intended Yao retry omitted the replay marker');
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
