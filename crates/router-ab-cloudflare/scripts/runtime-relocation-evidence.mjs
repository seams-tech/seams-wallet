import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const runtimeOrigin = 'https://wallet-runtime.internal';
const runtimeBase = '/internal/wallet-runtime/v1/relocation';

class MiniflareRouterBinding {
  constructor(router) {
    this.router = router;
    this.calls = 0;
  }

  async fetch(request) {
    this.calls += 1;
    return this.router.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      redirect: request.redirect,
      body: await request.arrayBuffer(),
    });
  }
}

// The private directory E2E verifies journal admission. This fixture supplies its
// response while this scenario exercises the production Runtime and Rust roles.
class SourceDirectory {
  mode = 'authorized';
  constructor(source) {
    this.source = source;
  }

  async fetch(request) {
    assert.ok(request.url.endsWith('/relocation-runtime-source'));
    assert.equal(request.headers.get('x-seams-writer-role'), 'walletRuntime');
    assert.equal(
      request.headers.get('x-seams-writer-version'),
      '11111111-1111-4111-8111-111111111111',
    );
    const input = await request.json();
    if (this.mode === 'denied' || input.attempt.moveId !== this.source.request.move_id)
      return Response.json({ ok: false, code: 'attempt_conflict' }, { status: 409 });
    let payload =
      input.operation === 'ed25519-capture'
        ? { command: 'capture', source: this.source }
        : this.source;
    if (input.operation === 'router-freeze') {
      payload = {
        owner: {
          org_id: this.source.scope.org_id,
          project_id: this.source.scope.project_id,
          env_id: this.source.scope.project_environment_id,
          wallet_id: this.source.scope.wallet_id,
        },
        move_id: this.source.request.move_id,
        request_digest_hex: 'a'.repeat(64),
        source_generation: this.source.request.source_generation,
        destination_generation: this.source.request.source_generation + 1,
      };
    }
    return Response.json({
      ok: true,
      command: {
        operation: this.mode === 'corrupt' ? 'unexpected' : input.operation,
        payload,
      },
    });
  }
}

function sourceEnvelope(source) {
  const wallet = {
    namespace: 'fixture',
    organizationId: source.scope.org_id,
    projectId: source.scope.project_id,
    environmentId: source.scope.project_environment_id,
    walletId: source.scope.wallet_id,
  };
  return {
    wallet,
    attempt: {
      wallet,
      moveId: source.request.move_id,
      phase: 'freezing',
      id: `wattempt_${'a'.repeat(43)}`,
      revision: 1,
      run: 1,
      number: 1,
      startedAtMs: source.request.invalidated_at_ms,
    },
  };
}

class RuntimeRelocationSource {
  constructor(handler, router, credential, source) {
    this.handler = handler;
    this.env = {
      MPC_ROUTER: new MiniflareRouterBinding(router),
      WALLET_CONSOLE: new SourceDirectory(source),
      CF_VERSION_METADATA: { id: '11111111-1111-4111-8111-111111111111' },
      SEAMS_D1_HOME_ACCOUNT_ID: 'a'.repeat(32),
      SEAMS_D1_HOME_DATABASE_ID: '22222222-2222-4222-8222-222222222222',
      ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: credential,
    };
  }

  async fetch(url, init) {
    const path = new URL(url).pathname;
    let operation;
    const body = JSON.parse(init.body);
    let forwardedBody = body;
    switch (path) {
      case '/router-ab/signing-worker/wallet/ed25519/settle':
        operation = 'ed25519-settle';
        forwardedBody = sourceEnvelope(body);
        break;
      case '/router-ab/signing-worker/wallet/ed25519/snapshot':
        operation = body.command === 'capture' ? 'ed25519-capture' : 'ed25519-snapshot';
        if (body.command === 'capture') forwardedBody = sourceEnvelope(body.source);
        break;
      default:
        throw new Error(`Unsupported relocation evidence request: ${path}`);
    }
    const result = await this.handler(
      new Request(`${runtimeOrigin}${runtimeBase}/${operation}`, {
        ...init,
        body: JSON.stringify(forwardedBody),
      }),
      this.env,
    );
    assert.ok(result);
    return result;
  }
}

export async function runtimeRelocationSource(topology, credential, command) {
  const entry = fileURLToPath(
    new URL(
      '../../../packages/wallet-server/src/router/cloudflare/runtime/walletControlOps.ts',
      import.meta.url,
    ),
  );
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`
  );
  const source = new RuntimeRelocationSource(
    module.handleWalletControlRequest,
    await topology.getWorker('router'),
    credential,
    command,
  );
  const publicRequest = new Request(`https://public.example${runtimeBase}/ed25519-snapshot`, {
    method: 'POST',
  });
  assert.equal(await source.handler(publicRequest, source.env), null);
  const unknown = await source.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/unknown`, { method: 'POST' }),
    source.env,
  );
  assert.equal(unknown.status, 404);
  const capture = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'capture', source: command }),
  };
  const bypass = await source.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/ed25519-snapshot`, capture),
    source.env,
  );
  assert.equal(bypass.status, 400);
  assert.equal((await bypass.json()).code, 'source_command_required');
  source.env.WALLET_CONSOLE.mode = 'denied';
  assert.equal(
    (
      await source.fetch(
        'https://router.test/router-ab/signing-worker/wallet/ed25519/snapshot',
        capture,
      )
    ).status,
    409,
  );
  source.env.WALLET_CONSOLE.mode = 'corrupt';
  assert.equal(
    (
      await source.fetch(
        'https://router.test/router-ab/signing-worker/wallet/ed25519/snapshot',
        capture,
      )
    ).status,
    503,
  );
  assert.equal(source.env.MPC_ROUTER.calls, 0);
  source.env.WALLET_CONSOLE.mode = 'authorized';
  const routerSource = {
    scope: { ...command.scope, wallet_id: `${command.scope.wallet_id}-router-authorization` },
    request: command.request,
  };
  const routerRuntime = new RuntimeRelocationSource(
    module.handleWalletControlRequest,
    await topology.getWorker('router'),
    credential,
    routerSource,
  );
  const routerInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceEnvelope(routerSource)),
  };
  routerRuntime.env.WALLET_CONSOLE.mode = 'denied';
  const deniedRouter = await routerRuntime.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/router-freeze`, routerInit),
    routerRuntime.env,
  );
  assert.equal(deniedRouter.status, 409);
  assert.equal(routerRuntime.env.MPC_ROUTER.calls, 0);
  routerRuntime.env.WALLET_CONSOLE.mode = 'authorized';
  const frozenRouter = await routerRuntime.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/router-freeze`, routerInit),
    routerRuntime.env,
  );
  assert.equal(frozenRouter.status, 200);
  const frozen = await frozenRouter.json();
  assert.equal(frozen.state, 'frozen');
  const replayRouter = await routerRuntime.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/router-freeze`, routerInit),
    routerRuntime.env,
  );
  assert.deepEqual(await replayRouter.json(), frozen);
  return source;
}
