import {
  WALLET_RUNTIME_OP_PATHS_V1,
  WALLET_RUNTIME_OPS_BASE_PATH_V1,
  WALLET_RUNTIME_SERVICE_ORIGIN_V1,
  parseWalletRuntimeExecuteSignedDelegateRequest,
  parseWalletRuntimeWalletIdentityRequest,
  type WalletRuntimeOps,
} from './walletRuntimeOps';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function readBody(request: Request): Promise<unknown> {
  return await request.json().catch(() => null);
}

export function createWalletRuntimeOpsHandler(
  resolveOps: () => Promise<WalletRuntimeOps>,
): (request: Request) => Promise<Response | null> {
  return async function handleWalletRuntimeOperation(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(WALLET_RUNTIME_OPS_BASE_PATH_V1)) return null;
    if (url.origin !== WALLET_RUNTIME_SERVICE_ORIGIN_V1) return null;
    if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    const ops = await resolveOps();
    if (url.pathname === WALLET_RUNTIME_OP_PATHS_V1.relayerAccount) {
      return json(await ops.getRelayerAccount());
    }
    if (url.pathname === WALLET_RUNTIME_OP_PATHS_V1.executeSignedDelegate) {
      const input = parseWalletRuntimeExecuteSignedDelegateRequest(await readBody(request));
      if (!input) return json({ ok: false, code: 'invalid_body' }, 400);
      return json({ result: await ops.executeSignedDelegate(input) });
    }
    if (url.pathname === WALLET_RUNTIME_OP_PATHS_V1.walletIdentities) {
      const input = parseWalletRuntimeWalletIdentityRequest(await readBody(request));
      if (!input) return json({ ok: false, code: 'invalid_body' }, 400);
      return json(await ops.getWalletIdentities(input));
    }
    return json({ ok: false, code: 'not_found' }, 404);
  };
}
