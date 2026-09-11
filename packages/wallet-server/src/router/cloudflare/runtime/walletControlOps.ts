import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';
import type { WalletRuntimeServiceBinding } from './walletRuntimeOps';

export const WALLET_CONTROL_SERVICE_ORIGIN_V1 = 'https://wallet-runtime.internal';
export const WALLET_CONTROL_BASE_PATH_V1 = '/internal/wallet-runtime/v1/tenant-root-control';
export const WALLET_CONTROL_AUTH_MARKER_V1 = 'wallet-control-private-binding-v1';

type WalletControlTarget = 'mpc-router' | 'control-plane' | 'deriver-a' | 'deriver-b';

type WalletControlOperation = {
  readonly id: string;
  readonly target: WalletControlTarget;
  readonly origin: string;
  readonly path: string;
};

const OPERATIONS = [
  operation(
    'create',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/router-ab/internal/tenant-root/creation/v1/create',
  ),
  operation(
    'refresh',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/router-ab/internal/tenant-root/refresh/v1/execute',
  ),
  operation(
    'status',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/router-ab/internal/tenant-root/status/v1/read',
  ),
  operation(
    'destination-bootstrap',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/router-ab/internal/tenant-root/destination-bootstrap/v1/read-auth',
  ),
  operation(
    'restore-register-manifest',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/tenant-root-control-plane/restore/v1/register-manifest',
  ),
  operation(
    'restore-issue-import-key',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/tenant-root-control-plane/restore/v1/issue-import-key',
  ),
  operation(
    'restore-accept-import',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/tenant-root-control-plane/restore/v1/accept-import',
  ),
  operation(
    'restore-activate',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/router-ab/internal/tenant-root/restore/v1/activate',
  ),
  operation(
    'restore-cleanup',
    'mpc-router',
    'https://mpc-router.router-ab.internal',
    '/router-ab/internal/tenant-root/restore/v1/cleanup',
  ),
  operation(
    'recovery-command',
    'control-plane',
    'https://tenant-root-control-plane.internal',
    '/router-ab/tenant-root-control-plane/recovery/command',
  ),
  operation(
    'recovery-manifest',
    'control-plane',
    'https://tenant-root-control-plane.internal',
    '/router-ab/tenant-root-control-plane/recovery/manifest',
  ),
  operation(
    'recovery-recipient-proof',
    'control-plane',
    'https://tenant-root-control-plane.internal',
    '/router-ab/tenant-root-control-plane/recovery/recipient-proof',
  ),
  operation(
    'recovery-trust',
    'control-plane',
    'https://tenant-root-control-plane.internal',
    '/router-ab/tenant-root-control-plane/recovery/trust',
  ),
  ...deriverOperations('a'),
  ...deriverOperations('b'),
] as const satisfies readonly WalletControlOperation[];

function operation(
  id: string,
  target: WalletControlTarget,
  origin: string,
  path: string,
): WalletControlOperation {
  return { id, target, origin, path };
}

function deriverOperations(role: 'a' | 'b'): readonly WalletControlOperation[] {
  const target = `deriver-${role}` as const;
  const origin = 'https://tenant-root.internal';
  return ['reshare', 'access', 'retire-source'].map((name) =>
    operation(
      `recovery-deriver-${role}-${name}`,
      target,
      origin,
      `/router-ab/deriver/tenant-root-recovery/${name}`,
    ),
  );
}

export interface WalletControlRuntimeBindings {
  readonly MPC_ROUTER: CloudflareServiceBindingFetcher;
  readonly TENANT_ROOT_CONTROL_PLANE: CloudflareServiceBindingFetcher;
  readonly DERIVER_A: CloudflareServiceBindingFetcher;
  readonly DERIVER_B: CloudflareServiceBindingFetcher;
  readonly ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET?: string;
}

export interface WalletControlClientBindings {
  readonly router: CloudflareServiceBindingFetcher;
  readonly controlPlane: CloudflareServiceBindingFetcher;
  readonly deriverA: CloudflareServiceBindingFetcher;
  readonly deriverB: CloudflareServiceBindingFetcher;
}

export function createWalletControlClientBindings(
  binding: WalletRuntimeServiceBinding,
): WalletControlClientBindings {
  return {
    router: createClientFetcher(binding, 'mpc-router'),
    controlPlane: createClientFetcher(binding, 'control-plane'),
    deriverA: createClientFetcher(binding, 'deriver-a'),
    deriverB: createClientFetcher(binding, 'deriver-b'),
  };
}

function createClientFetcher(
  binding: WalletRuntimeServiceBinding,
  target: WalletControlTarget,
): CloudflareServiceBindingFetcher {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const match = OPERATIONS.find(
        (candidate) =>
          candidate.target === target &&
          candidate.origin === url.origin &&
          candidate.path === url.pathname &&
          url.search === '',
      );
      if (!match || request.method !== 'POST') {
        throw new Error(
          `Unsupported Wallet control operation: ${request.method} ${url.origin}${url.pathname}`,
        );
      }
      return await binding.fetch(
        `${WALLET_CONTROL_SERVICE_ORIGIN_V1}${WALLET_CONTROL_BASE_PATH_V1}/${match.id}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: await request.arrayBuffer(),
        },
      );
    },
  };
}

export async function handleWalletControlRequest(
  request: Request,
  env: WalletControlRuntimeBindings,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${WALLET_CONTROL_BASE_PATH_V1}/`)) return null;
  if (url.origin !== WALLET_CONTROL_SERVICE_ORIGIN_V1) return null;
  if (request.method !== 'POST') return jsonError('method_not_allowed', 405);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return jsonError('unsupported_media_type', 415);
  }
  const id = url.pathname.slice(WALLET_CONTROL_BASE_PATH_V1.length + 1);
  const selected = OPERATIONS.find((candidate) => candidate.id === id);
  if (!selected) return jsonError('operation_not_found', 404);
  const body = await request.arrayBuffer();
  if (body.byteLength > 512 * 1024) return jsonError('request_too_large', 413);
  return await bindingForTarget(env, selected.target).fetch(
    new Request(`${selected.origin}${selected.path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': contentType,
        'x-router-ab-internal-service-auth': requireInternalServiceAuth(env),
      },
      body,
    }),
  );
}

function bindingForTarget(
  env: WalletControlRuntimeBindings,
  target: WalletControlTarget,
): CloudflareServiceBindingFetcher {
  switch (target) {
    case 'mpc-router':
      return env.MPC_ROUTER;
    case 'control-plane':
      return env.TENANT_ROOT_CONTROL_PLANE;
    case 'deriver-a':
      return env.DERIVER_A;
    case 'deriver-b':
      return env.DERIVER_B;
  }
}

function requireInternalServiceAuth(env: WalletControlRuntimeBindings): string {
  const value = String(env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET || '').trim();
  if (!value) throw new Error('Wallet Runtime internal service authentication is unavailable');
  return value;
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
