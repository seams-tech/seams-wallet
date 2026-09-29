import { isLocalIntendedYaoFaultTokenV1 } from './localIntendedYaoFault';

export const LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_HEADER_V1 =
  'x-seams-intended-ecdsa-finalize-fault-v1';
export const LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-ecdsa-finalize-fault-token-v1';
const LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_PROOF_HEADER_V1 =
  'x-seams-intended-ecdsa-finalize-fault-proof-v1';
export const ROUTER_AB_ECDSA_FINALIZE_PATH_V1 = '/router-ab/ecdsa-derivation/sign';

/**
 * The Router's response to an admitted ECDSA finalize is lost after the
 * SigningWorker has signed, and the identical request is sent again before the
 * Gateway records any outcome. The retry reaches the SigningWorker, which must
 * answer from the signing effect it already claimed: the same signature, with
 * no second presignature consumed.
 */
type LocalIntendedEcdsaFinalizeFaultModeV1 = 'drop_router_response_once';

type LocalIntendedEcdsaFinalizeFaultProofV1 = 'stored_signature_replayed';

type LocalIntendedEcdsaFinalizeFaultViolationV1 =
  | 'router_finalize_not_observed'
  | 'router_first_response_failed'
  | 'router_retry_response_failed'
  | 'router_retry_changed_response'
  | 'unexpected_additional_finalize';

type LocalIntendedEcdsaFinalizeFaultOutcomeV1 =
  | { readonly kind: 'proved'; readonly proof: LocalIntendedEcdsaFinalizeFaultProofV1 }
  | { readonly kind: 'violated'; readonly violation: LocalIntendedEcdsaFinalizeFaultViolationV1 };

type LocalIntendedEcdsaFinalizeFaultStateV1 =
  | { readonly kind: 'armed' }
  | LocalIntendedEcdsaFinalizeFaultOutcomeV1;

export function parseLocalIntendedEcdsaFinalizeFaultModeV1(
  value: string | null,
): LocalIntendedEcdsaFinalizeFaultModeV1 | null {
  return value === 'drop_router_response_once' ? value : null;
}

export function parseLocalIntendedEcdsaFinalizeFaultTokenV1(value: string | null): string | null {
  return isLocalIntendedYaoFaultTokenV1(value) ? value : null;
}

export class LocalIntendedEcdsaFinalizeFaultControllerV1 {
  private state: LocalIntendedEcdsaFinalizeFaultStateV1 = { kind: 'armed' };

  constructor(private readonly baseFetch: typeof globalThis.fetch) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== ROUTER_AB_ECDSA_FINALIZE_PATH_V1
    ) {
      return await this.baseFetch.call(globalThis, request);
    }
    if (this.state.kind !== 'armed') {
      this.state = { kind: 'violated', violation: 'unexpected_additional_finalize' };
      throw new Error('Local intended ECDSA fault observed an additional Router finalize');
    }
    const body = await request.clone().arrayBuffer();
    const first = await this.baseFetch.call(globalThis, request.clone());
    const firstBody = await first.text();
    if (!first.ok) {
      this.state = { kind: 'violated', violation: 'router_first_response_failed' };
      return new Response(firstBody, first);
    }
    // The first response is lost; the identical request goes to the Router again.
    const retry = await this.baseFetch.call(
      globalThis,
      new Request(request.url, { method: 'POST', headers: request.headers, body }),
    );
    const retryBody = await retry.text();
    if (!retry.ok) {
      this.state = { kind: 'violated', violation: 'router_retry_response_failed' };
    } else if (JSON.stringify(JSON.parse(retryBody)) !== JSON.stringify(JSON.parse(firstBody))) {
      this.state = { kind: 'violated', violation: 'router_retry_changed_response' };
    } else {
      this.state = { kind: 'proved', proof: 'stored_signature_replayed' };
    }
    return new Response(retryBody, retry);
  }

  consumeOutcome(): LocalIntendedEcdsaFinalizeFaultOutcomeV1 {
    const current = this.state;
    return current.kind === 'armed'
      ? { kind: 'violated', violation: 'router_finalize_not_observed' }
      : current;
  }
}

export function requestWithoutLocalIntendedEcdsaFinalizeFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedEcdsaFinalizeFaultOutcomeV1(
  response: Response,
  outcome: LocalIntendedEcdsaFinalizeFaultOutcomeV1,
  token: string,
): Response {
  const headers = new Headers(response.headers);
  const proof = outcome.kind === 'proved' ? outcome.proof : `violation:${outcome.violation}`;
  headers.set(LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_PROOF_HEADER_V1, `${token}:${proof}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
