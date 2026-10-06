import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

class PlacementDirectory {
  placement = { state: 'settled', region: 'US', generation: 1, nextMoveAtMs: 0 };
  entered = null;
  release = null;
  calls = 0;

  async fetch(request) {
    assert.equal(new URL(request.url).pathname, '/internal/wallet-placement/v1/placement-status');
    assert.equal(request.headers.get('authorization'), null);
    this.calls += 1;
    if (this.entered !== null) {
      this.entered.resolve();
      await this.release.promise;
    }
    return Response.json(this.placement);
  }
}

class PlacementClientJourney {
  messages = [];
  reply = null;
  requests = 0;

  constructor(api, routes, binding, token) {
    this.routes = routes;
    this.binding = binding;
    this.token = token;
    this.unlock();
    const host = api.createWalletHostPlacementCommands({
      managementRequest: { request: this.request.bind(this) },
      readAuthentication: this.readAuthentication.bind(this),
    });
    this.handlers = api.createPlacementWalletIframeHandlers({
      getWalletRuntime: this.getWalletRuntime.bind(this, host),
      respondIfCancelled: this.respondIfCancelled.bind(this),
      post: this.receive.bind(this),
    });
    this.router = { placement: api.createIframePlacementCommands(this.post.bind(this)) };
    this.application = api.createApplicationPlacementCommands({
      requireRouter: this.requireRouter.bind(this),
    });
  }

  unlock() {
    this.authentication = authenticatedWallet(this.binding.walletId);
  }

  lock() {
    this.authentication = { kind: 'signed_out' };
  }

  readAuthentication() {
    return this.authentication;
  }

  getWalletRuntime(placement) {
    return { placement };
  }

  respondIfCancelled() {
    return false;
  }

  async requireRouter() {
    return this.router;
  }

  async request(input) {
    this.requests += 1;
    const response = await this.routes.handle(
      new Request(`https://gateway.example.test${input.canonicalPath}`, {
        method: input.method,
        headers: { Origin: this.binding.origin, Authorization: `Bearer ${this.token}` },
      }),
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json() };
  }

  receive(message) {
    this.messages.push(structuredClone(message));
    this.reply = message;
  }

  async post(request) {
    this.messages.push(structuredClone(request));
    await this.handlers.PM_GET_WALLET_PLACEMENT({
      ...structuredClone(request),
      requestId: 'placement-read',
    });
    assert.equal(this.reply.type, 'PM_RESULT');
    assert.equal(this.reply.payload.ok, true);
    return { result: structuredClone(this.reply.payload.result) };
  }

  read() {
    return this.application.get(this.binding.walletId);
  }
}

function authenticatedWallet(walletId) {
  return { kind: 'authenticated', walletId, authMethod: 'passkey' };
}

function movingPlacement(binding, progress) {
  return {
    state: 'moving',
    move: {
      moveId: binding.moveId,
      sourceRegion: 'US',
      destinationRegion: 'APAC',
      sourceGeneration: 1,
      destinationGeneration: 2,
      admittedAtMs: 1000,
      nextMoveAtMs: 2000,
      progress,
    },
  };
}

export async function verifyPlacementClient({
  output,
  binding,
  token,
  routeOptions,
  WalletPlacementRoutes,
}) {
  const bundle = await build({
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    tsconfig: 'packages/wallet/tsconfig.json',
    stdin: {
      resolveDir: process.cwd(),
      loader: 'ts',
      contents: `
        export { createApplicationPlacementCommands, createIframePlacementCommands } from './packages/wallet/src/SeamsWeb/walletIframe/client/placementCommands';
        export { createWalletHostPlacementCommands } from './packages/wallet/src/SeamsWeb/walletIframe/host/createPlacementCommands';
        export { createPlacementWalletIframeHandlers } from './packages/wallet/src/SeamsWeb/walletIframe/host/handlers/placement';
      `,
    },
  });
  const bytes = bundle.outputFiles[0].contents;
  const bundlePath = resolve(output, 'placement-client.mjs');
  await writeFile(bundlePath, bytes);
  const api = await import(pathToFileURL(bundlePath).href);
  const directory = new PlacementDirectory();
  const routes = new WalletPlacementRoutes({ ...routeOptions, directory });
  const client = new PlacementClientJourney(api, routes, binding, token);
  assert.deepEqual(await client.read(), { ok: true, placement: directory.placement });
  directory.placement = movingPlacement(binding, {
    state: 'copying',
    availability: 'paused',
    execution: { state: 'running' },
  });
  assert.deepEqual(await client.read(), { ok: true, placement: directory.placement });
  directory.placement = movingPlacement(binding, {
    state: 'cleanup',
    availability: 'active',
    execution: { state: 'retry_wait', code: 'transport_unavailable', retryAtMs: 3000 },
  });
  assert.deepEqual(await client.read(), { ok: true, placement: directory.placement });
  directory.placement.move.progress.availability = 'paused';
  assert.deepEqual(await client.read(), { ok: false, code: 'invalid_response' });
  directory.placement.move.progress.availability = 'active';
  directory.entered = Promise.withResolvers();
  directory.release = Promise.withResolvers();
  const pending = client.read();
  await directory.entered.promise;
  client.lock();
  directory.release.resolve();
  assert.deepEqual(await pending, { ok: false, code: 'wallet_unlock_required' });
  const requestsBeforeLockedRead = client.requests;
  assert.deepEqual(await client.read(), { ok: false, code: 'wallet_unlock_required' });
  assert.equal(client.requests, requestsBeforeLockedRead);
  client.unlock();
  client.token = 'invalid-owner-token';
  const callsBeforeUnauthorized = directory.calls;
  assert.deepEqual(await client.read(), { ok: false, code: 'unauthorized' });
  assert.equal(directory.calls, callsBeforeUnauthorized);
  await assert.rejects(
    client.post({
      type: 'PM_GET_WALLET_PLACEMENT',
      payload: { walletId: binding.walletId, bearer: token },
    }),
    /identity is invalid/u,
  );
  client.messages.pop();
  assert.equal(JSON.stringify(client.messages).includes(token), false);
  const evidence = {
    scope:
      'Production client commands, host handler and Gateway with real D1 authorization; simulated directory and owner credential adapter. Excludes browser boot, settings and local credential lookup.',
    bundleSha256: createHash('sha256').update(bytes).digest('hex'),
    settledAndPausedPlacementRead: true,
    cleanupRetryLeavesDestinationActive: true,
    invalidAvailabilityRejected: true,
    lockDiscardsPendingReadAndPreventsNextRequest: true,
    invalidOwnerCredentialRejectedBeforeDirectory: true,
    parentCannotSupplyOwnerCredential: true,
    credentialsAbsentFromClientMessages: true,
  };
  await writeFile(
    resolve(output, 'placement-client-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}
