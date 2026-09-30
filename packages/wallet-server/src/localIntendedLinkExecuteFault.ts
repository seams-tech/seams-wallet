export const LOCAL_INTENDED_LINK_EXECUTE_FAULT_HEADER_V1 = 'x-seams-intended-link-execute-fault-v1';
export const LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-link-execute-fault-token-v1';
const LOCAL_INTENDED_LINK_EXECUTE_FAULT_PROOF_HEADER_V1 =
  'x-seams-intended-link-execute-fault-proof-v1';
const ROUTER_AB_YAO_REPLAY_HEADER_V1 = 'x-seams-yao-replay';
const ROUTER_AB_SOURCE_PRESERVING_EXECUTE_PATH_V1 =
  '/router-ab/router/ed25519-yao/execute-source-preserving';
const LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_PATTERN_V1 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * `drop_router_response_once` lets the Router run a linked device's
 * source-preserving execution, then loses its answer. The Gateway must send
 * the same request again, marked as the Router's replay, and the Router must
 * answer it with the reservation the lost answer carried.
 */
type LocalIntendedLinkExecuteFaultModeV1 = 'drop_router_response_once';

type LocalIntendedLinkExecuteFaultProofV1 = 'replay_answered_same_reservation';

type LocalIntendedLinkExecuteFaultViolationV1 =
  | 'router_execute_not_observed'
  | 'router_first_response_failed'
  | 'router_first_marked_as_replay'
  | 'router_retry_not_observed'
  | 'router_retry_body_changed'
  | 'router_retry_not_marked_as_replay'
  | 'router_retry_response_failed'
  | 'router_retry_answer_changed'
  | 'unexpected_additional_execute';

type LocalIntendedLinkExecuteFaultStateV1 =
  | { readonly kind: 'armed' }
  | {
      readonly kind: 'awaiting_replay';
      readonly body: Uint8Array;
      readonly answer: Uint8Array;
    }
  | { readonly kind: 'proved'; readonly proof: LocalIntendedLinkExecuteFaultProofV1 }
  | { readonly kind: 'violated'; readonly violation: LocalIntendedLinkExecuteFaultViolationV1 };

type LocalIntendedLinkExecuteFaultOutcomeV1 = Extract<
  LocalIntendedLinkExecuteFaultStateV1,
  { kind: 'proved' } | { kind: 'violated' }
>;

type LocalIntendedLinkExecuteFaultTokenV1 = {
  readonly value: string;
};

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function parseLocalIntendedLinkExecuteFaultModeV1(
  value: string | null,
): LocalIntendedLinkExecuteFaultModeV1 | null {
  return value === 'drop_router_response_once' ? value : null;
}

export function parseLocalIntendedLinkExecuteFaultTokenV1(
  value: string | null,
): LocalIntendedLinkExecuteFaultTokenV1 | null {
  if (!value || !LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_PATTERN_V1.test(value)) return null;
  return { value };
}

export class LocalIntendedLinkExecuteFaultControllerV1 {
  private state: LocalIntendedLinkExecuteFaultStateV1 = { kind: 'armed' };

  constructor(private readonly baseFetch: typeof globalThis.fetch) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== ROUTER_AB_SOURCE_PRESERVING_EXECUTE_PATH_V1) {
      return await this.baseFetch.call(globalThis, request);
    }
    switch (this.state.kind) {
      case 'armed':
        return await this.handleFirstExecute(request);
      case 'awaiting_replay':
        return await this.handleReplay(request, this.state);
      case 'proved':
      case 'violated':
        this.state = { kind: 'violated', violation: 'unexpected_additional_execute' };
        throw new Error('Local intended linking fault observed an additional Router execute');
    }
  }

  outcome(): LocalIntendedLinkExecuteFaultOutcomeV1 {
    switch (this.state.kind) {
      case 'proved':
      case 'violated':
        return this.state;
      case 'armed':
        return { kind: 'violated', violation: 'router_execute_not_observed' };
      case 'awaiting_replay':
        return { kind: 'violated', violation: 'router_retry_not_observed' };
    }
  }

  private async handleFirstExecute(request: Request): Promise<Response> {
    if (request.headers.has(ROUTER_AB_YAO_REPLAY_HEADER_V1)) {
      this.state = { kind: 'violated', violation: 'router_first_marked_as_replay' };
      throw new Error('Local intended linking fault saw a first execute marked as a replay');
    }
    const body = new Uint8Array(await request.clone().arrayBuffer());
    const response = await this.baseFetch.call(globalThis, request);
    const answer = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
      this.state = { kind: 'violated', violation: 'router_first_response_failed' };
      return new Response(answer, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    // The Router ran the execution and reserved the target's material. Only
    // its answer is lost.
    this.state = { kind: 'awaiting_replay', body, answer };
    throw new Error('Local intended linking fault dropped the completed Router response');
  }

  private async handleReplay(
    request: Request,
    expected: Extract<LocalIntendedLinkExecuteFaultStateV1, { kind: 'awaiting_replay' }>,
  ): Promise<Response> {
    const body = new Uint8Array(await request.clone().arrayBuffer());
    if (!equalBytes(expected.body, body)) {
      this.state = { kind: 'violated', violation: 'router_retry_body_changed' };
      throw new Error('Local intended linking retry changed the Router request body');
    }
    if (request.headers.get(ROUTER_AB_YAO_REPLAY_HEADER_V1) !== '1') {
      this.state = { kind: 'violated', violation: 'router_retry_not_marked_as_replay' };
      throw new Error('Local intended linking retry was not marked as the Router replay');
    }
    const response = await this.baseFetch.call(globalThis, request);
    const answer = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
      this.state = { kind: 'violated', violation: 'router_retry_response_failed' };
    } else if (!equalBytes(expected.answer, answer)) {
      this.state = { kind: 'violated', violation: 'router_retry_answer_changed' };
    } else {
      this.state = { kind: 'proved', proof: 'replay_answered_same_reservation' };
    }
    return new Response(answer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}

export function requestWithoutLocalIntendedLinkExecuteFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_LINK_EXECUTE_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedLinkExecuteFaultOutcomeV1(
  response: Response,
  outcome: LocalIntendedLinkExecuteFaultOutcomeV1,
  token: LocalIntendedLinkExecuteFaultTokenV1,
): Response {
  const headers = new Headers(response.headers);
  const proof = outcome.kind === 'proved' ? outcome.proof : `violation:${outcome.violation}`;
  headers.set(LOCAL_INTENDED_LINK_EXECUTE_FAULT_PROOF_HEADER_V1, `${token.value}:${proof}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
