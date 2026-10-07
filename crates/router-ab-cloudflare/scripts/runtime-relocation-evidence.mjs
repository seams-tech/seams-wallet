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
      headers: { ...Object.fromEntries(request.headers), 'x-seams-wallet-home-region': 'US' },
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
  presignReceipts = new Map();
  ecdsaReceipt = null;
  ecdsaActivation = null;
  ed25519Receipt = null;
  ed25519Activation = null;
  activationReceipt = null;
  constructor(source) {
    this.source = source;
  }

  async fetch(request) {
    assert.ok(
      request.url.endsWith('/relocation-presign-transfer') ||
      request.url.endsWith('/relocation-presign-source') ||
        request.url.endsWith('/relocation-presign-receipt') ||
        request.url.endsWith('/relocation-ecdsa-activation') ||
        request.url.endsWith('/relocation-ecdsa-receipt') ||
        request.url.endsWith('/relocation-ecdsa-transfer') ||
        request.url.endsWith('/relocation-ed25519-activation') ||
        request.url.endsWith('/relocation-ed25519-receipt') ||
        request.url.endsWith('/relocation-ed25519-transfer') ||
        request.url.endsWith('/relocation-runtime-source') ||
        request.url.endsWith('/relocation-router-receipt') ||
        request.url.endsWith('/relocation-router-export') ||
        request.url.endsWith('/relocation-router-destination') ||
        request.url.endsWith('/relocation-router-activation') ||
        request.url.endsWith('/relocation-router-cleanup'),
    );
    assert.equal(request.headers.get('x-seams-writer-role'), 'walletRuntime');
    assert.equal(
      request.headers.get('x-seams-writer-version'),
      '11111111-1111-4111-8111-111111111111',
    );
    const input = await request.json();
    if (this.mode === 'denied' || input.attempt.moveId !== this.source.request.move_id)
      return Response.json({ ok: false, code: 'attempt_conflict' }, { status: 409 });
    if (request.url.endsWith('/relocation-presign-transfer')) {
      assert.ok(this.ecdsaReceipt, 'Wallet snapshot must be sealed before session transfer');
      const receipt = structuredClone(this.presignReceipts.get(input.request.session.presignSessionId));
      assert.ok(receipt);
      assert.equal(receipt.command.server_presignature_id, input.request.session.serverPresignatureId);
      const command = { kind: input.request.operation, receipt };
      if (this.mode === 'corrupt') receipt.command.wallet_scope.wallet_id = 'another-wallet';
      if (input.request.operation === 'export') command.segment_index = input.request.segmentIndex;
      if (input.request.operation !== 'verify' && input.request.operation !== 'cleanup') command.chunk_bytes = 4096;
      return Response.json({ ok: true, command });
    }
    if (request.url.endsWith('/relocation-presign-source')) {
      const operation = input.request.operation;
      const payload = operation === 'inventory'
        ? { scope: this.source.scope, request: this.source.request, cursor: input.request.cursor, limit: input.request.limit }
        : { wallet_scope: this.source.scope, request: this.source.request,
          presign_session_id: input.request.session.presignSessionId, server_presignature_id: input.request.session.serverPresignatureId };
      if (this.mode === 'corrupt') payload.request = { ...payload.request, move_id: `wmove_${'z'.repeat(43)}` };
      return Response.json({ ok: true, command: { operation, payload } });
    }
    if (request.url.endsWith('/relocation-presign-receipt')) {
      assert.deepEqual(input.receipt.command.wallet_scope, this.source.scope);
      assert.deepEqual(input.receipt.command.request, this.source.request);
      const key = input.receipt.command.presign_session_id;
      if (this.presignReceipts.has(key)) assert.deepEqual(input.receipt, this.presignReceipts.get(key));
      this.presignReceipts.set(key, input.receipt);
      if (this.receiptMode === 'lost_reply') throw new Error('Recorded presign receipt reply was lost');
      return Response.json({ ok: true, receipt: input.receipt });
    }
    if (request.url.endsWith('/relocation-ecdsa-receipt')) {
      assert.deepEqual(input.receipt.scope, this.source.scope);
      assert.deepEqual(input.receipt.request, this.source.request);
      if (this.ecdsaReceipt) assert.deepEqual(input.receipt, this.ecdsaReceipt);
      this.ecdsaReceipt = input.receipt;
      if (this.receiptMode === 'lost_reply') throw new Error('Recorded ECDSA receipt reply was lost');
      return Response.json({ ok: true, receipt: this.ecdsaReceipt });
    }
    if (request.url.endsWith('/relocation-ecdsa-activation')) {
      assert.deepEqual(input.receipt, this.ecdsaReceipt);
      this.ecdsaActivation = input.receipt;
      if (this.receiptMode === 'lost_reply') throw new Error('Recorded ECDSA activation reply was lost');
      return Response.json({ ok: true, receipt: this.ecdsaActivation });
    }
    if (request.url.endsWith('/relocation-ecdsa-transfer')) {
      assert.ok(this.ecdsaReceipt);
      assert.equal(Object.keys(input).length, 3, 'Console receives no chunk data');
      if (input.request.operation === 'cleanup') {
        if (!this.ecdsaActivation) return Response.json({ ok: false }, { status: 409 });
        return Response.json({ ok: true, command: { kind: 'cleanup', activation: this.ecdsaActivation } });
      }
      const command = { kind: input.request.operation, receipt: structuredClone(this.ecdsaReceipt) };
      if (this.mode === 'corrupt') command.receipt.scope.wallet_id = 'another-wallet';
      if (input.request.operation === 'export') command.segment_index = input.request.segmentIndex;
      if (['export', 'status', 'import'].includes(input.request.operation)) command.chunk_bytes = 4096;
      return Response.json({ ok: true, command });
    }
    if (request.url.endsWith('/relocation-ed25519-activation')) {
      assert.deepEqual(input.receipt, this.ed25519Receipt);
      this.ed25519Activation = input.receipt;
      if (this.receiptMode === 'lost_reply') throw new Error('Recorded Ed25519 activation reply was lost');
      return Response.json({ ok: true, receipt: this.ed25519Activation });
    }
    if (request.url.endsWith('/relocation-ed25519-receipt')) {
      assert.deepEqual(input.receipt.source, this.source);
      if (this.ed25519Receipt) assert.deepEqual(input.receipt, this.ed25519Receipt);
      this.ed25519Receipt = input.receipt;
      if (this.receiptMode === 'lost_reply') throw new Error('Recorded Ed25519 receipt reply was lost');
      return Response.json({ ok: true, receipt: this.ed25519Receipt });
    }
    if (request.url.endsWith('/relocation-ed25519-transfer')) {
      assert.ok(this.ed25519Receipt);
      assert.equal(Object.keys(input).length, 3, 'Console receives no segment data');
      if (input.request.operation === 'cleanup') {
        if (!this.ed25519Activation) return Response.json({ ok: false }, { status: 409 });
        return Response.json({ ok: true, command: { command: 'cleanup', activation: this.ed25519Activation } });
      }
      const command = { command: input.request.operation, receipt: structuredClone(this.ed25519Receipt) };
      if (this.mode === 'corrupt') command.receipt.source.scope.wallet_id = 'another-wallet';
      if (input.request.operation === 'export') command.segment_index = input.request.segmentIndex;
      return Response.json({ ok: true, command });
    }
    if (request.url.endsWith('/relocation-router-cleanup')) {
      assert.ok(this.activationReceipt);
      return Response.json({
        ok: true,
        command: { kind: 'cleanup', activation: this.activationReceipt },
      });
    }
    if (request.url.endsWith('/relocation-router-activation')) {
      assert.deepEqual(input.receipt.source, this.receipt);
      if (this.activationReceipt !== null) assert.deepEqual(input.receipt, this.activationReceipt);
      this.activationReceipt = input.receipt;
      if (this.receiptMode === 'lost_reply') throw new Error('Recorded activation reply was lost');
      return Response.json({ ok: true, receipt: this.activationReceipt });
    }
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
      payload = routerMoveRequest(this.source);
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

export function sourceEnvelope(source) {
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
      case '/router-ab/signing-worker/wallet/linked-presign-inventory':
        operation = 'presign-inventory';
        forwardedBody = sourceEnvelope(body);
        forwardedBody.cursor = body.cursor;
        forwardedBody.limit = body.limit;
        break;
      case '/router-ab/signing-worker/linked-presign-session/fence':
      case '/router-ab/signing-worker/linked-presign-session/freeze':
        operation = path.endsWith('/fence') ? 'presign-fence' : 'presign-freeze';
        forwardedBody = sourceEnvelope({ scope: body.wallet_scope, request: body.request });
        forwardedBody.session = { presignSessionId: body.presign_session_id, serverPresignatureId: body.server_presignature_id };
        break;
      case '/router-ab/signing-worker/linked-presign-session/export':
      case '/router-ab/signing-worker/linked-presign-session/transfer': {
        if (body.kind === 'prepare') {
          operation = 'presign-transfer';
          break;
        }
        const kind = path.endsWith('/export') ? 'export' : body.kind;
        const receipt = kind === 'import' ? body.chunk.receipt : body.receipt;
        operation = `presign-${kind}`;
        forwardedBody = sourceEnvelope({ scope: receipt.command.wallet_scope, request: receipt.command.request });
        forwardedBody.attempt.phase = kind === 'cleanup' ? 'cutover' : 'copying';
        forwardedBody.session = {
          presignSessionId: receipt.command.presign_session_id,
          serverPresignatureId: receipt.command.server_presignature_id,
        };
        if (kind === 'export') forwardedBody.segmentIndex = body.segment_index;
        if (kind === 'import') forwardedBody.chunk = body.chunk;
        break;
      }
      case '/router-ab/signing-worker/wallet/pool/freeze':
        operation = 'ecdsa-freeze';
        forwardedBody = sourceEnvelope(body);
        break;
      case '/router-ab/signing-worker/wallet/ecdsa/export':
        operation = 'ecdsa-export';
        forwardedBody = sourceEnvelope(body.receipt);
        forwardedBody.attempt.phase = 'copying';
        forwardedBody.segmentIndex = body.segment_index;
        break;
      case '/router-ab/signing-worker/wallet/ecdsa/transfer':
        operation = body.kind === 'prepare' ? 'ecdsa-transfer' : `ecdsa-${body.kind}`;
        if (body.kind !== 'prepare') {
          const receipt = body.kind === 'cleanup' ? body.activation : body.kind === 'import' ? body.chunk.receipt : body.receipt;
          forwardedBody = sourceEnvelope(receipt);
          forwardedBody.attempt.phase = body.kind === 'activate' || body.kind === 'cleanup' ? 'cutover' : 'copying';
          if (body.kind === 'import') forwardedBody.chunk = body.chunk;
        }
        break;
      case '/router-ab/signing-worker/wallet/ed25519/settle':
        operation = 'ed25519-settle';
        forwardedBody = sourceEnvelope(body);
        break;
      case '/router-ab/signing-worker/wallet/ed25519/snapshot':
        operation = ['capture', 'export', 'import', 'status', 'verify', 'activate', 'cleanup'].includes(body.command)
          ? `ed25519-${body.command}` : 'ed25519-snapshot';
        if (body.command === 'capture') forwardedBody = sourceEnvelope(body.source);
        else if (operation !== 'ed25519-snapshot') {
          forwardedBody = sourceEnvelope(body.command === 'cleanup' ? body.activation.source : body.receipt.source);
          forwardedBody.attempt.phase = body.command === 'activate' || body.command === 'cleanup' ? 'cutover' : 'copying';
          if (body.command === 'export') forwardedBody.segmentIndex = body.segment_index;
          if (body.command === 'import') forwardedBody.segment = body.segment;
        }
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

function routerMoveRequest(source) {
  return {
    owner: {
      org_id: source.scope.org_id,
      project_id: source.scope.project_id,
      env_id: source.scope.project_environment_id,
      wallet_id: source.scope.wallet_id,
    },
    move_id: source.request.move_id,
    request_digest_hex: 'a'.repeat(64),
    source_generation: source.request.source_generation,
    destination_generation: source.request.source_generation + 1,
  };
}

export async function verifyRuntimeRouterExport(runtime, activation, topology) {
  const destination = new RuntimeRelocationSource(
    runtime.handler,
    await topology.getWorker('router-relocation-destination'),
    runtime.env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
    runtime.env.WALLET_CONSOLE.source,
  );
  const preparation = {
    kind: 'prepare',
    request: routerMoveRequest(runtime.env.WALLET_CONSOLE.source),
    chunk_bytes: 4096,
  };
  const prepared = await runtimeRouterCommand(destination, 'router-transfer', preparation);
  assert.equal(prepared.kind, 'prepared');
  assert.equal(typeof prepared.destination_object, 'string');
  assert.ok(prepared.destination_object.length > 0);
  assert.deepEqual(
    await runtimeRouterCommand(destination, 'router-transfer', preparation),
    prepared,
  );
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
  destination.env.WALLET_CONSOLE.receipt = frozen.receipt;
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
  destination.env.WALLET_CONSOLE.receiptMode = 'lost_reply';
  const lostActivation = await destination.handler(
    new Request(`${runtimeOrigin}${runtimeBase}/router-activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    }),
    destination.env,
  );
  assert.equal(lostActivation.status, 503);
  assert.ok(destination.env.WALLET_CONSOLE.activationReceipt);
  destination.env.WALLET_CONSOLE.receiptMode = 'available';
  const activated = await runtimeRouterCommand(destination, 'router-activate', envelope);
  assert.equal(activated.kind, 'activated');
  assert.equal(activated.activation.destination_object, prepared.destination_object);
  assert.deepEqual(activated.activation.source, frozen.receipt);
  assert.equal(typeof activated.activation.destination_object, 'string');
  assert.deepEqual(await runtimeRouterCommand(destination, 'router-activate', envelope), activated);
  runtime.env.WALLET_CONSOLE.activationReceipt = destination.env.WALLET_CONSOLE.activationReceipt;
  let cleanup;
  for (let step = 0; step < 64; step += 1) {
    cleanup = await runtimeRouterCommand(runtime, 'router-cleanup', envelope);
    if (cleanup.kind === 'cleaned') break;
    assert.equal(cleanup.kind, 'cleaning');
  }
  assert.equal(cleanup.kind, 'cleaned');
  assert.deepEqual(cleanup.activation, activated.activation);
  assert.deepEqual(await runtimeRouterCommand(runtime, 'router-cleanup', envelope), cleanup);
  assert.deepEqual(await runtimeRouterCommand(destination, 'router-activate', envelope), activated);

  return {
    recordCount: records.length,
    chunkCount: chunks,
    exactReplay: true,
    storedReceiptMatchesExport: true,
    destinationVerifiedThroughRuntime: true,
    destinationActivatedThroughRuntime: true,
    activationReceiptLostReplyRecovered: true,
    sourceCleanupPreservesDestinationActivation: true,
    destinationPreparedBeforeSourceFinalizationAndFreeze: true,
    activatedObjectMatchesPreparedObject: true,
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

export async function runtimeRelocationDestination(topology, source) {
  const destination = new RuntimeRelocationSource(source.handler,
    await topology.getWorker('router-relocation-destination'),
    source.env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
    source.env.WALLET_CONSOLE.source);
  destination.env.WALLET_CONSOLE = source.env.WALLET_CONSOLE;
  destination.env.SEAMS_D1_HOME_DATABASE_ID = '33333333-3333-4333-8333-333333333333';
  return destination;
}
