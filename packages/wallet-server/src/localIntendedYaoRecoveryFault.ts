import { isPlainObject } from '@shared/utils/validation';
import type { D1RegistrationCeremonyRecordStore } from './router/cloudflare/d1/registration/d1RegistrationCeremonyRecordStore';
import {
  isLocalIntendedYaoFaultTokenV1,
  parseLocalIntendedKeptRouterRequestV1,
} from './localIntendedYaoFault';

export const LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1 = 'x-seams-intended-yao-recovery-fault-v1';
export const LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-recovery-fault-token-v1';
/* The proof rides the Yao fault proof header, which the intended suite
   collects from every response. */
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
const ROUTER_AB_YAO_EXECUTE_PATH_V1 = '/router-ab/router/ed25519-yao/execute';

/**
 * Faults on one recovery execution's way to the Router. Local only.
 * - `lose_router_recovery_replies`: the execution completes at the Router,
 *   and every reply to it is lost on its way back to the Gateway, the
 *   Gateway's replay included. The Gateway records the execution as
 *   interrupted, while the attempt's candidate is already staged at the
 *   SigningWorker.
 * - `withhold_router_recovery_execute`: the execution never reaches the
 *   Router, and the Gateway keeps it; the Gateway records it as interrupted.
 * - `release_router_recovery_execute`: a kept execution reaches the Router
 *   now, exactly as the Gateway sent it: a late run of an attempt the Gateway
 *   has since superseded.
 */
type LocalIntendedYaoRecoveryFaultModeV1 =
  | 'lose_router_recovery_replies'
  | 'withhold_router_recovery_execute'
  | 'release_router_recovery_execute';

type LocalIntendedYaoRecoveryFaultOutcomeV1 =
  | {
      readonly kind: 'proved';
      readonly proof: 'recovery_replies_lost_after_router_executed' | 'recovery_execute_withheld';
    }
  | {
      readonly kind: 'violated';
      readonly violation:
        | 'router_recovery_not_executed'
        | 'router_recovery_answer_failed'
        | 'router_recovery_execute_not_observed';
    };

// The local Gateway's D1 store retains the credential across Worker instances.
const KEPT_RECOVERY_SCOPE = 'recovery-execute';
const KEPT_RECOVERY_TTL_MS = 10 * 60 * 1000;

export function parseLocalIntendedYaoRecoveryFaultModeV1(
  value: string | null,
): LocalIntendedYaoRecoveryFaultModeV1 | null {
  switch (value) {
    case 'lose_router_recovery_replies':
    case 'withhold_router_recovery_execute':
    case 'release_router_recovery_execute':
      return value;
    default:
      return null;
  }
}

export function parseLocalIntendedYaoRecoveryFaultTokenV1(value: string | null): string | null {
  return isLocalIntendedYaoFaultTokenV1(value) ? value : null;
}

/** The Gateway's Router binding, faulting every call to a recovery execution. */
export class LocalIntendedYaoRecoveryFaultControllerV1 {
  private executed = false;
  private failed = false;
  private kept = false;

  constructor(
    private readonly baseFetch: typeof globalThis.fetch,
    private readonly mode: 'lose_router_recovery_replies' | 'withhold_router_recovery_execute',
    private readonly token: string,
    private readonly storage: D1RegistrationCeremonyRecordStore,
  ) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== ROUTER_AB_YAO_EXECUTE_PATH_V1
    ) {
      return await this.baseFetch.call(globalThis, request);
    }
    if (this.mode === 'withhold_router_recovery_execute') {
      // The first is kept; the Gateway's replay of it is withheld as well.
      await this.storage.insertOrRead({
        scope: KEPT_RECOVERY_SCOPE,
        id: this.token,
        value: {
          url: request.url,
          headers: [...request.headers],
          body: await request.clone().text(),
        },
        expiresAtMs: Date.now() + KEPT_RECOVERY_TTL_MS,
      });
      this.kept = true;
      throw new Error('Local intended Yao recovery fault withheld the Router execution');
    }
    const response = await this.baseFetch.call(globalThis, request);
    const answer: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (
      response.ok &&
      isPlainObject(answer) &&
      answer.status === 'succeeded'
    ) {
      this.executed = true;
    } else {
      this.failed = true;
    }
    throw new Error('Local intended Yao recovery fault lost the Router reply');
  }

  outcome(): LocalIntendedYaoRecoveryFaultOutcomeV1 {
    if (this.mode === 'withhold_router_recovery_execute') {
      return this.kept
        ? { kind: 'proved', proof: 'recovery_execute_withheld' }
        : { kind: 'violated', violation: 'router_recovery_execute_not_observed' };
    }
    if (this.failed) return { kind: 'violated', violation: 'router_recovery_answer_failed' };
    if (!this.executed) return { kind: 'violated', violation: 'router_recovery_not_executed' };
    return { kind: 'proved', proof: 'recovery_replies_lost_after_router_executed' };
  }
}

/** Sends the execution kept under `token` to the Router, exactly. */
export async function releaseLocalIntendedYaoRecoveryExecuteV1(
  router: { fetch(request: Request): Promise<Response> },
  token: string,
  storage: D1RegistrationCeremonyRecordStore,
): Promise<Response> {
  const kept = await storage.take(KEPT_RECOVERY_SCOPE, token);
  if (!kept) {
    return Response.json({ code: 'intended_recovery_execute_missing' }, { status: 404 });
  }
  const reply = await router.fetch(parseLocalIntendedKeptRouterRequestV1(kept));
  return Response.json({ status: reply.status, body: await reply.text() });
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
    outcome.kind === 'proved'
      ? `${token}:${outcome.proof}`
      : `${token}:violated:${outcome.violation}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
