import { ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 } from '../../../core/ThresholdService/routerAb/internalServiceHttp';
import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';

const ORIGIN = 'https://wallet-runtime.internal';
const BASE_PATH = '/internal/wallet-runtime/v1/relocation';

// The private Runtime binding carries trusted coordinator commands. The Router
// parses each role's command and the participant enforces its durable move state.
const OPERATIONS = {
  'router-freeze': '/router-ab/router/wallet/freeze',
  'router-transfer': '/router-ab/router/wallet/transfer',
  'ed25519-settle': '/router-ab/signing-worker/wallet/ed25519/settle',
  'ed25519-snapshot': '/router-ab/signing-worker/wallet/ed25519/snapshot',
  'ecdsa-freeze': '/router-ab/signing-worker/wallet/pool/freeze',
  'ecdsa-export': '/router-ab/signing-worker/wallet/ecdsa/export',
  'ecdsa-transfer': '/router-ab/signing-worker/wallet/ecdsa/transfer',
  'presign-inventory': '/router-ab/signing-worker/wallet/linked-presign-inventory',
  'presign-fence': '/router-ab/signing-worker/linked-presign-session/fence',
  'presign-freeze': '/router-ab/signing-worker/linked-presign-session/freeze',
  'presign-export': '/router-ab/signing-worker/linked-presign-session/export',
  'presign-transfer': '/router-ab/signing-worker/linked-presign-session/transfer',
} as const;

export type WalletRelocationRuntimeBindings = {
  readonly MPC_ROUTER: CloudflareServiceBindingFetcher;
  readonly ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET?: string;
};

export async function handleWalletRelocationRequest(
  request: Request,
  env: WalletRelocationRuntimeBindings,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.origin !== ORIGIN || !url.pathname.startsWith(`${BASE_PATH}/`)) return null;
  if (request.method !== 'POST') return failure('method_not_allowed', 405);
  const operation = url.pathname.slice(BASE_PATH.length + 1);
  if (!Object.hasOwn(OPERATIONS, operation) || url.search !== '')
    return failure('operation_not_found', 404);
  const path: unknown = Reflect.get(OPERATIONS, operation);
  if (typeof path !== 'string') return failure('operation_not_found', 404);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json'))
    return failure('unsupported_media_type', 415);
  const credential = env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET?.trim();
  if (!credential) return failure('relocation_transport_unavailable', 503);
  const body = await request.arrayBuffer();
  if (body.byteLength > 131072) return failure('request_too_large', 413);
  return env.MPC_ROUTER.fetch(new Request(`https://mpc-router.router-ab.internal${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential,
    },
    body,
  }));
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}
