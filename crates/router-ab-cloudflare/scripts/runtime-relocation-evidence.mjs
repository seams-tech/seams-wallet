import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const runtimeOrigin = 'https://wallet-runtime.internal';
const runtimeBase = '/internal/wallet-runtime/v1/relocation';

class MiniflareRouterBinding {
  constructor(router) {
    this.router = router;
  }

  async fetch(request) {
    return this.router.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      redirect: request.redirect,
      body: await request.arrayBuffer(),
    });
  }
}

class RuntimeRelocationSource {
  constructor(handler, router, credential) {
    this.handler = handler;
    this.env = {
      MPC_ROUTER: new MiniflareRouterBinding(router),
      ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: credential,
    };
  }

  async fetch(url, init) {
    const path = new URL(url).pathname;
    let operation;
    switch (path) {
      case '/router-ab/signing-worker/wallet/ed25519/settle':
        operation = 'ed25519-settle';
        break;
      case '/router-ab/signing-worker/wallet/ed25519/snapshot':
        operation = 'ed25519-snapshot';
        break;
      default:
        throw new Error(`Unsupported relocation evidence request: ${path}`);
    }
    const result = await this.handler(new Request(`${runtimeOrigin}${runtimeBase}/${operation}`, init), this.env);
    assert.ok(result);
    return result;
  }
}

export async function runtimeRelocationSource(topology, credential) {
  const entry = fileURLToPath(new URL('../../../packages/wallet-server/src/router/cloudflare/runtime/walletControlOps.ts', import.meta.url));
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral' });
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
  const source = new RuntimeRelocationSource(module.handleWalletControlRequest, await topology.getWorker('router'), credential);
  const publicRequest = new Request(`https://public.example${runtimeBase}/ed25519-snapshot`, { method: 'POST' });
  assert.equal(await source.handler(publicRequest, source.env), null);
  const unknown = await source.handler(new Request(`${runtimeOrigin}${runtimeBase}/unknown`, { method: 'POST' }), source.env);
  assert.equal(unknown.status, 404);
  return source;
}
