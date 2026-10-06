import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  receiptMode = 'available';
  receipt = null;
  constructor(source) {
    this.source = source;
  }

  async fetch(request) {
    assert.ok(
      request.url.endsWith('/relocation-runtime-source') ||
        request.url.endsWith('/relocation-router-receipt') ||
        request.url.endsWith('/relocation-router-export') ||
        request.url.endsWith('/relocation-router-destination'),
    );
    assert.equal(request.headers.get('x-seams-writer-role'), 'walletRuntime');
    assert.equal(
      request.headers.get('x-seams-writer-version'),
      '11111111-1111-4111-8111-111111111111',
    );
    const input = await request.json();
    if (this.mode === 'denied' || input.attempt.moveId !== this.source.request.move_id)
      return Response.json({ ok: false, code: 'attempt_conflict' }, { status: 409 });
    if (request.url.endsWith('/relocation-router-destination')) {
      assert.ok(this.receipt);
      assert.equal(Object.keys(input).length, 3, 'Console receives no chunk data');
      if (input.operation === 'import')
        return Response.json({
          ok: true,
          command: { kind: 'import', receipt: this.receipt, chunk_bytes: 4096 },
        });
      if (input.operation === 'status')
        return Response.json({
          ok: true,
          command: {
            kind: 'status',
            receipt: this.receipt,
            chunk_bytes: 4096,
          },
        });
      if (input.operation === 'activate')
        return Response.json({ ok: true, command: { kind: 'activate', receipt: this.receipt } });
      assert.equal(input.operation, 'verify');
      return Response.json({ ok: true, command: { kind: 'verify', receipt: this.receipt } });
    }
    if (request.url.endsWith('/relocation-router-export')) {
      if (input.recordIndex >= this.receipt.record_count)
        return Response.json({ ok: false, code: 'invalid_cursor' }, { status: 409 });
      return Response.json({
        ok: true,
        command: {
          kind: 'export',
          receipt: this.receipt,
          record_index: input.recordIndex,
          segment_index: input.segmentIndex,
          chunk_bytes: 4096,
        },
      });
    }
    if (request.url.endsWith('/relocation-router-receipt')) {
      if (this.receipt !== null) assert.deepEqual(input.receipt, this.receipt);
      this.receipt = input.receipt;
      if (this.receiptMode === 'lost_reply') throw new Error('Recorded receipt reply was lost');
      return Response.json({ ok: true, receipt: this.receipt });
    }
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
  routerRuntime.env.WALLET_CONSOLE.receiptMode = 'lost_reply';
  const lostReceipt = await routerRuntime.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/router-freeze`, routerInit),
    routerRuntime.env,
  );
  assert.equal(lostReceipt.status, 503);
  assert.ok(routerRuntime.env.WALLET_CONSOLE.receipt);
  routerRuntime.env.WALLET_CONSOLE.receiptMode = 'available';
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
  const exportInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...sourceEnvelope(routerSource), recordIndex: 0, segmentIndex: 0 }),
  };
  const callsBeforeExport = routerRuntime.env.MPC_ROUTER.calls;
  const emptyExport = await routerRuntime.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/router-export`, exportInit),
    routerRuntime.env,
  );
  assert.equal(emptyExport.status, 409);
  const rawExport = await routerRuntime.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/router-transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'export',
        receipt: frozen.receipt,
        record_index: 0,
        segment_index: 0,
        chunk_bytes: 4096,
      }),
    }),
    routerRuntime.env,
  );
  assert.equal(rawExport.status, 400);
  assert.equal(routerRuntime.env.MPC_ROUTER.calls, callsBeforeExport);

  return source;
}

export async function verifyRuntimeRouterExport(runtime, activation, topology) {
  const binding = activation.envelope.target.binding;
  const consumed = await runtime.env.MPC_ROUTER.fetch(
    new Request(
      'https://mpc-router.router-ab.internal/router-ab/router/ed25519-yao/registration/consume',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-router-ab-internal-service-auth': runtime.env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
        },
        body: JSON.stringify({
          ownership_generation: 1,
          tenant_root: activation.envelope.tenant_root,
          wallet_id: binding.lifecycle.account_id,
          lifecycle_id: binding.lifecycle.lifecycle_id,
          session_id: binding.session_id,
          consumer_binding: 'fixture-registration-finalization',
        }),
      },
    ),
  );
  assert.equal(consumed.status, 200, await consumed.text());
  const envelope = sourceEnvelope(runtime.env.WALLET_CONSOLE.source);
  const freeze = await runtime.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/router-freeze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    }),
    runtime.env,
  );
  const frozen = await freeze.json();
  assert.equal(freeze.status, 200, JSON.stringify(frozen));
  assert.equal(frozen.state, 'frozen');
  assert.ok(frozen.receipt.record_count > 0);
  const destination = new RuntimeRelocationSource(
    runtime.handler,
    await topology.getWorker('router-relocation-destination'),
    runtime.env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
    runtime.env.WALLET_CONSOLE.source,
  );
  destination.env.WALLET_CONSOLE.receipt = frozen.receipt;
  const prepared = await runtimeRouterCommand(destination, 'router-transfer', {
    kind: 'prepare',
    request: frozen.receipt.request,
    chunk_bytes: 4096,
  });
  assert.equal(prepared.kind, 'prepared');
  const status = await runtimeRouterCommand(destination, 'router-status', envelope);
  assert.equal(status.kind, 'receiving');
  assert.equal(status.next_record, 0);
  const records = [];
  let chunks = 0;
  for (let recordIndex = 0; recordIndex < frozen.receipt.record_count; recordIndex += 1) {
    const bytes = [];
    for (let segmentIndex = 0; ; segmentIndex += 1) {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...envelope, recordIndex, segmentIndex }),
      };
      const response = await runtime.handler(
        new Request(`${runtimeOrigin}${runtimeBase}/router-export`, init),
        runtime.env,
      );
      const exported = await response.json();
      assert.equal(response.status, 200, JSON.stringify(exported));
      assert.equal(exported.kind, 'exported');
      assert.deepEqual(exported.chunk.receipt, frozen.receipt);
      assert.equal(exported.chunk.record_index, recordIndex);
      assert.equal(exported.chunk.segment_index, segmentIndex);
      const replay = await runtime.handler(
        new Request(`${runtimeOrigin}${runtimeBase}/router-export`, init),
        runtime.env,
      );
      assert.deepEqual(await replay.json(), exported);
      const segment = Buffer.from(exported.chunk.data_b64u, 'base64url');
      assert.ok(segment.length <= 4096);
      const wrongReceipt = structuredClone(exported.chunk);
      wrongReceipt.receipt.records_digest_hex = '0'.repeat(64);
      const callsBeforeWrongReceipt = destination.env.MPC_ROUTER.calls;
      const denied = await destination.handler(
        new Request(`${runtimeOrigin}${runtimeBase}/router-import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...envelope, chunk: wrongReceipt }),
        }),
        destination.env,
      );
      assert.equal(denied.status, 400);
      assert.equal(destination.env.MPC_ROUTER.calls, callsBeforeWrongReceipt);
      const imported = await runtimeRouterCommand(destination, 'router-import', {
        ...envelope,
        chunk: exported.chunk,
      });
      assert.equal(imported.kind, 'imported');
      assert.deepEqual(
        await runtimeRouterCommand(destination, 'router-import', {
          ...envelope,
          chunk: exported.chunk,
        }),
        imported,
      );
      bytes.push(segment);
      chunks += 1;
      if (segmentIndex + 1 === exported.chunk.segment_count) break;
      assert.ok(segmentIndex < 1024, 'Router registration export must be bounded');
    }
    records.push(JSON.parse(Buffer.concat(bytes).toString('utf8')));
  }
  const digest = createHash('sha256')
    .update('seams/router/wallet-snapshot/v1')
    .update(JSON.stringify([frozen.receipt.request, records]))
    .digest('hex');
  assert.equal(digest, frozen.receipt.records_digest_hex);
  const verified = await runtimeRouterCommand(destination, 'router-verify', envelope);
  assert.equal(verified.kind, 'verified');
  assert.deepEqual(verified.receipt, frozen.receipt);
  assert.deepEqual(await runtimeRouterCommand(destination, 'router-status', envelope), verified);
  const activated = await runtimeRouterCommand(destination, 'router-activate', envelope);
  assert.equal(activated.kind, 'activated');
  assert.deepEqual(activated.activation.source, frozen.receipt);
  assert.equal(typeof activated.activation.destination_object, 'string');
  assert.deepEqual(await runtimeRouterCommand(destination, 'router-activate', envelope), activated);

  return {
    recordCount: records.length,
    chunkCount: chunks,
    exactReplay: true,
    storedReceiptMatchesExport: true,
    destinationVerifiedThroughRuntime: true,
    destinationActivatedThroughRuntime: true,
    sourceDigestHex: frozen.receipt.records_digest_hex,
  };
}

async function runtimeRouterCommand(runtime, operation, body) {
  const response = await runtime.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    runtime.env,
  );
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
