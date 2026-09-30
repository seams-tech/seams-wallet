import { isLocalIntendedYaoFaultTokenV1 } from './localIntendedYaoFault';

export const LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1 = 'x-seams-intended-yao-signing-fault-v1';
export const LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-signing-fault-token-v1';
/* The proof rides the Yao fault proof header, which the intended suite
   collects from every response. */
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
export const ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH_V1 = '/router-ab/ed25519/sign';

/**
 * A NEAR signature's finalize, as the Gateway sends it to the Router after
 * authorizing it, kept to be sent again later: a request authorized before a
 * recovery that arrives after it. Local only.
 * - `capture_signing_finalize` lets the finalize run and keeps it: a
 *   signature already made.
 * - `withhold_signing_finalize` keeps it and never sends it: a signature
 *   authorized but not yet made. The Gateway's answer is a refusal.
 * - `release_signing_finalize` sends a kept finalize to the Router again,
 *   exactly, and answers with the Router's reply.
 * - `arm_signing_worker_hold` asks the SigningWorker to hold the next NEAR
 *   finalize of the wallet the body names after it signs and before it
 *   commits, until its activation is retired: a finalize that loaded its
 *   material just before a recovery promoted. Dev builds of the Workers D1
 *   SigningWorker only; the wallet object and the VM SigningWorker sign and
 *   commit in one step.
 * - `read_signing_worker_hold` reads that hold's state.
 */
type LocalIntendedYaoSigningFaultModeV1 =
  | 'capture_signing_finalize'
  | 'withhold_signing_finalize'
  | 'release_signing_finalize'
  | 'arm_signing_worker_hold'
  | 'read_signing_worker_hold';

const SIGNING_WORKER_LOCAL_INTENDED_HOLD_URL_V1 =
  'https://signing-worker.router-ab.internal/router-ab/signing-worker/local-intended/hold';
const ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 = 'x-router-ab-internal-service-auth';

type KeptFinalizeV1 = {
  readonly request: {
    readonly url: string;
    readonly headers: readonly (readonly [string, string])[];
    readonly body: string;
  };
  /** The Router's reply when the finalize ran; none when it was withheld. */
  readonly original: { readonly status: number; readonly body: string } | null;
};

/* Kept in the Gateway process, so the service credential on the finalize
   never leaves it; a release finds its finalize by the fault token. */
const keptFinalizes = new Map<string, KeptFinalizeV1>();

export function parseLocalIntendedYaoSigningFaultModeV1(
  value: string | null,
): LocalIntendedYaoSigningFaultModeV1 | null {
  switch (value) {
    case 'capture_signing_finalize':
    case 'withhold_signing_finalize':
    case 'release_signing_finalize':
    case 'arm_signing_worker_hold':
    case 'read_signing_worker_hold':
      return value;
    default:
      return null;
  }
}

export function parseLocalIntendedYaoSigningFaultTokenV1(value: string | null): string | null {
  return isLocalIntendedYaoFaultTokenV1(value) ? value : null;
}

/** The Gateway's Router binding, keeping the first NEAR finalize it carries. */
export class LocalIntendedYaoSigningFaultControllerV1 {
  private kept = false;

  constructor(
    private readonly baseFetch: typeof globalThis.fetch,
    private readonly mode: 'capture_signing_finalize' | 'withhold_signing_finalize',
    private readonly token: string,
  ) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH_V1
    ) {
      return await this.baseFetch.call(globalThis, request);
    }
    const kept = {
      url: request.url,
      headers: [...request.headers],
      body: await request.clone().text(),
    };
    if (this.mode === 'withhold_signing_finalize') {
      this.keep({ request: kept, original: null });
      return Response.json(
        {
          ok: false,
          code: 'intended_signing_finalize_withheld',
          message: 'Local intended fault withheld this NEAR finalize from the Router',
        },
        { status: 409 },
      );
    }
    const response = await this.baseFetch.call(globalThis, request);
    this.keep({
      request: kept,
      original: { status: response.status, body: await response.clone().text() },
    });
    return response;
  }

  private keep(finalize: KeptFinalizeV1): void {
    this.kept = true;
    if (!keptFinalizes.has(this.token)) keptFinalizes.set(this.token, finalize);
  }

  outcome(): string {
    if (!this.kept) return `${this.token}:violated:signing_finalize_not_observed`;
    return this.mode === 'withhold_signing_finalize'
      ? `${this.token}:signing_finalize_withheld`
      : `${this.token}:signing_finalize_captured`;
  }
}

/** Sends the finalize kept under `token` to the Router again, exactly. */
export async function releaseLocalIntendedYaoSigningFinalizeV1(
  router: { fetch(request: Request): Promise<Response> },
  token: string,
): Promise<Response> {
  const kept = keptFinalizes.get(token);
  if (!kept) {
    return Response.json({ code: 'intended_signing_finalize_missing' }, { status: 404 });
  }
  keptFinalizes.delete(token);
  const reply = await router.fetch(
    new Request(kept.request.url, {
      method: 'POST',
      headers: kept.request.headers.map(([name, value]) => [name, value] as [string, string]),
      body: kept.request.body,
    }),
  );
  return Response.json({
    status: reply.status,
    body: await reply.text(),
    original: kept.original,
  });
}

/**
 * Arms or reads the SigningWorker's hold on one wallet's next NEAR finalize,
 * with the Gateway's own SigningWorker credential, and answers with the
 * SigningWorker's reply.
 */
export async function commandLocalIntendedSigningWorkerHoldV1(
  signingWorker: { fetch(request: Request): Promise<Response> },
  credential: string | undefined,
  mode: 'arm_signing_worker_hold' | 'read_signing_worker_hold',
  body: unknown,
): Promise<Response> {
  const walletId = (body as { readonly wallet_id?: unknown } | null)?.wallet_id;
  if (!credential || typeof walletId !== 'string' || walletId === '') {
    return Response.json({ code: 'invalid_intended_signing_worker_hold' }, { status: 400 });
  }
  const reply = await signingWorker.fetch(
    new Request(SIGNING_WORKER_LOCAL_INTENDED_HOLD_URL_V1, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential,
      },
      body: JSON.stringify({
        command: mode === 'arm_signing_worker_hold' ? 'arm' : 'read',
        wallet_id: walletId,
      }),
    }),
  );
  return Response.json({ status: reply.status, body: await reply.text() });
}

export function requestWithoutLocalIntendedYaoSigningFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedYaoSigningFaultOutcomeV1(
  response: Response,
  outcome: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set(LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1, outcome);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
