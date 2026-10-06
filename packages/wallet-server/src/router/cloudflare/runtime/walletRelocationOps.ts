import {
  authorizeRuntimeSource,
  recordRuntimeRouterReceipt,
  type RuntimeSourceDirectory,
} from './walletRelocationSource';
import { isPlainObject } from '@shared/utils/validation';
import { ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 } from '../../../core/ThresholdService/routerAb/internalServiceHttp';
import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';

const ORIGIN = 'https://wallet-runtime.internal';
const BASE_PATH = '/internal/wallet-runtime/v1/relocation';

// The private Runtime binding carries trusted coordinator commands. The Router
// parses each role's command and the participant enforces its durable move state.
const OPERATIONS = {
  'deriver-a-context': '/router-ab/internal/deriver-a/wallet/relocation-context',
  'deriver-b-context': '/router-ab/internal/deriver-b/wallet/relocation-context',
  'deriver-b-prepare': '/router-ab/internal/deriver-b/wallet/prepare-relocation',
  'deriver-a-prepare': '/router-ab/internal/deriver-a/wallet/prepare-relocation',
  'router-freeze': '/router-ab/router/wallet/freeze',
  'router-cleanup': '/router-ab/router/wallet/transfer',
  'router-activate': '/router-ab/router/wallet/transfer',
  'router-import': '/router-ab/router/wallet/transfer',
  'router-status': '/router-ab/router/wallet/transfer',
  'router-verify': '/router-ab/router/wallet/transfer',
  'router-export': '/router-ab/router/wallet/transfer',
  'router-transfer': '/router-ab/router/wallet/transfer',
  'ed25519-capture': '/router-ab/signing-worker/wallet/ed25519/snapshot',
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

export type WalletRelocationRuntimeBindings = RuntimeSourceDirectory & {
  readonly MPC_ROUTER: CloudflareServiceBindingFetcher;
  readonly DERIVER_A: CloudflareServiceBindingFetcher;
  readonly DERIVER_B: CloudflareServiceBindingFetcher;
  readonly ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET?: string;
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
  const deriverOperation = operation === 'deriver-a-prepare' || operation === 'deriver-b-prepare' ||
    operation === 'deriver-a-context' || operation === 'deriver-b-context';
  const credential = deriverOperation
    ? env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET?.trim()
    : env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET?.trim();
  if (!credential) return failure('relocation_transport_unavailable', 503);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 131072) return failure('request_too_large', 413);
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return failure('invalid_input', 400);
  }
  let body: BodyInit = bytes;
  if (
    operation === 'router-cleanup' ||
    operation === 'router-activate' ||
    operation === 'router-import' ||
    operation === 'router-status' ||
    operation === 'router-verify' ||
    operation === 'router-export' ||
    operation === 'router-freeze' ||
    operation === 'ed25519-settle' ||
    operation === 'ed25519-capture' ||
    operation === 'ecdsa-freeze'
  ) {
    const authorized = await authorizeRuntimeSource(input, operation, env);
    if (!authorized.ok) {
      let status = 503;
      if (authorized.code === 'invalid_input') status = 400;
      else if (authorized.code === 'source_command_denied') status = 409;
      return failure(authorized.code, status);
    }
    body = authorized.body;
  } else if (
    operation === 'router-transfer' &&
    isPlainObject(input) &&
    (input.kind === 'export' ||
      input.kind === 'status' ||
      input.kind === 'verify' ||
      input.kind === 'import' ||
      input.kind === 'activate' ||
      input.kind === 'cleanup')
  ) {
    return failure('source_command_required', 400);
  } else if (
    operation === 'ed25519-snapshot' &&
    isPlainObject(input) &&
    input.command === 'capture'
  ) {
    return failure('source_command_required', 400);
  }
  let transport = env.MPC_ROUTER;
  let origin = 'https://mpc-router.router-ab.internal';
  if (operation === 'deriver-a-prepare' || operation === 'deriver-a-context') {
    transport = env.DERIVER_A;
    origin = 'https://deriver-a.router-ab.internal';
  } else if (operation === 'deriver-b-prepare' || operation === 'deriver-b-context') {
    transport = env.DERIVER_B;
    origin = 'https://deriver-b.router-ab.internal';
  }
  const response = await transport.fetch(
    new Request(`${origin}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential,
      },
      body,
    }),
  );
  if (operation === 'router-freeze' || operation === 'router-activate')
    return recordRuntimeRouterReceipt(operation, input, response, env);
  return response;
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}
