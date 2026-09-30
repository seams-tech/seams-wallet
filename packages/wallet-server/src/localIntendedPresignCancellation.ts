import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayEnv,
  type HostedWalletGatewayDependenciesV1,
} from './hosted-wallet-gateway';
import type { CfExecutionContext } from './router/cloudflare/runtime/cloudflare.types';

const held = new Set<string>();
const header = 'x-seams-intended-presign-cancellation';
const initPath = '/router-ab/ecdsa-derivation/presignature-pool/fill/init';

class HeldPresignProxy {
  constructor(private readonly token: string) {}

  async fetch(): Promise<Response> {
    held.add(this.token);
    await new Promise(resolveHeldPresign);
    held.delete(this.token);
    return Response.json({ ok: false, code: 'temporarily_unavailable' }, { status: 503 });
  }
}

function resolveHeldPresign(resolve: (value: void) => void): void {
  setTimeout(resolve, 30_000);
}

export async function localPresignCancellationProbe(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
): Promise<Response | null> {
  const token = request.headers.get(header);
  if (token === null) return null;
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== initPath ||
    !/^[0-9a-f-]{36}$/u.test(token)
  ) {
    return Response.json({ code: 'invalid_presign_cancellation_probe' }, { status: 400 });
  }
  if (request.method === 'GET') return Response.json({ held: held.has(token) });
  if (request.method === 'DELETE') {
    held.delete(token);
    return new Response(null, { status: 204 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const headers = new Headers(request.headers);
  headers.delete(header);
  return handleSplitGatewayRequest(
    new Request(request, { headers }),
    { ...env, SIGNING_WORKER: new HeldPresignProxy(token) },
    ctx,
    dependencies,
  );
}
