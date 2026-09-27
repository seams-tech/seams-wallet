import { isLocalIntendedYaoFaultTokenV1 } from './localIntendedYaoFault';

export const LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1 = 'x-seams-intended-yao-recovery-fault-v1';
export const LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-recovery-fault-token-v1';
/* The proof rides the Yao fault proof header, which the intended suite
   collects from every response. */
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
const ROUTER_AB_YAO_EXECUTE_PATH_V1 = '/router-ab/router/ed25519-yao/execute';

/**
 * A recovery execution completes at the Router, and every reply to it is lost
 * on its way back to the Gateway, the Gateway's replay included. The Gateway
 * records the execution as interrupted, while the attempt's candidate is
 * already staged at the SigningWorker. Local only.
 */
type LocalIntendedYaoRecoveryFaultModeV1 = 'lose_router_recovery_replies';

type LocalIntendedYaoRecoveryFaultOutcomeV1 =
  | { readonly kind: 'proved'; readonly proof: 'recovery_replies_lost_after_router_executed' }
  | {
      readonly kind: 'violated';
      readonly violation: 'router_recovery_not_executed' | 'router_recovery_answer_failed';
    };

export function parseLocalIntendedYaoRecoveryFaultModeV1(
  value: string | null,
): LocalIntendedYaoRecoveryFaultModeV1 | null {
  return value === 'lose_router_recovery_replies' ? value : null;
}

export function parseLocalIntendedYaoRecoveryFaultTokenV1(value: string | null): string | null {
  return isLocalIntendedYaoFaultTokenV1(value) ? value : null;
}

/** The Gateway's Router binding, losing every reply to a recovery execution. */
export class LocalIntendedYaoRecoveryFaultControllerV1 {
  private executed = false;
  private failed = false;

  constructor(private readonly baseFetch: typeof globalThis.fetch) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== ROUTER_AB_YAO_EXECUTE_PATH_V1
    ) {
      return await this.baseFetch.call(globalThis, request);
    }
    const response = await this.baseFetch.call(globalThis, request);
    const answer: unknown = await response.clone().json().catch(() => null);
    if (
      response.ok &&
      typeof answer === 'object' &&
      answer !== null &&
      (answer as { readonly status?: unknown }).status === 'succeeded'
    ) {
      this.executed = true;
    } else {
      this.failed = true;
    }
    throw new Error('Local intended Yao recovery fault lost the Router reply');
  }

  outcome(): LocalIntendedYaoRecoveryFaultOutcomeV1 {
    if (this.failed) return { kind: 'violated', violation: 'router_recovery_answer_failed' };
    if (!this.executed) return { kind: 'violated', violation: 'router_recovery_not_executed' };
    return { kind: 'proved', proof: 'recovery_replies_lost_after_router_executed' };
  }
}

export function requestWithoutLocalIntendedYaoRecoveryFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedYaoRecoveryFaultOutcomeV1(
  response: Response,
  outcome: LocalIntendedYaoRecoveryFaultOutcomeV1,
  token: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set(
    LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1,
    outcome.kind === 'proved' ? `${token}:${outcome.proof}` : `${token}:violated:${outcome.violation}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
