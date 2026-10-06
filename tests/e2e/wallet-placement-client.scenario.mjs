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

  constructor(api, routes, binding, token, signingEngine = {}) {
    this.routes = routes;
    this.binding = binding;
    this.token = token;
    this.unlock();
    const host = api.createWalletHostPlacementCommands({
      managementRequest: { request: this.request.bind(this) },
      signingEngine,
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
        ...(input.method === 'POST' ? { body: JSON.stringify(input.body) } : {}),
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
    await this.handlers[request.type]({
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
  const { api, bundleSha256 } = await loadPlacementClient(output);
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
    bundleSha256,
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

async function loadPlacementClient(output) {
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
        export { IndexedDBManager, seamsWalletDB } from './packages/wallet/src/core/indexedDB';
        export { createApplicationPlacementCommands, createIframePlacementCommands } from './packages/wallet/src/SeamsWeb/walletIframe/client/placementCommands';
        export { createWalletHostPlacementCommands } from './packages/wallet/src/SeamsWeb/walletIframe/host/createPlacementCommands';
        export { WalletHostOwnerRequestTransportError } from './packages/wallet/src/SeamsWeb/operations/devices/walletHostOwnerAuthority';
        export { createPlacementWalletIframeHandlers } from './packages/wallet/src/SeamsWeb/walletIframe/host/handlers/placement';
      `,
    },
  });
  const bytes = bundle.outputFiles[0].contents;
  const bundlePath = resolve(output, 'placement-client.mjs');
  await writeFile(bundlePath, bytes);
  const api = await import(pathToFileURL(bundlePath).href);
  const localDatabase = new LocalPlacementDatabase();
  api.seamsWalletDB.runTransaction = localDatabase.runTransaction.bind(localDatabase);
  return { api, bundleSha256: createHash('sha256').update(bytes).digest('hex') };
}

class MoveDirectory {
  calls = 0;

  constructor(binding) {
    this.binding = binding;
    this.status = movingPlacement(binding, {
      state: 'cleanup',
      availability: 'active',
      execution: { state: 'running' },
    });
  }

  async fetch(request) {
    assert.equal(new URL(request.url).pathname, '/internal/wallet-placement/v1/relocation-status');
    const body = await request.json();
    assert.equal(body.moveId, this.binding.moveId);
    assert.equal(body.wallet.walletId, this.binding.walletId);
    this.calls += 1;
    return Response.json(this.status);
  }
}

export async function verifyRetiredMoveClient({
  output,
  binding,
  token,
  routeOptions,
  WalletPlacementRoutes,
}) {
  const { api, bundleSha256 } = await loadPlacementClient(output);
  const directory = new MoveDirectory(binding);
  const routes = new WalletPlacementRoutes({ ...routeOptions, directory });
  const client = new PlacementClientJourney(api, routes, binding, token);
  assert.deepEqual(await client.read(), { ok: false, code: 'unauthorized' });
  assert.equal(directory.calls, 0);
  const status = await client.application.getMove(binding.walletId, binding.moveId);
  assert.deepEqual(status, { ok: true, status: directory.status });
  directory.status = {
    state: 'completed',
    moveId: binding.moveId,
    sourceRegion: 'US',
    destinationRegion: 'APAC',
    sourceGeneration: 1,
    destinationGeneration: 2,
    admittedAtMs: 1000,
    completedAtMs: 2000,
  };
  assert.deepEqual(await client.application.getMove(binding.walletId, binding.moveId), {
    ok: true,
    status: directory.status,
  });
  directory.status.moveId = `wmove_${'x'.repeat(43)}`;
  assert.deepEqual(await client.application.getMove(binding.walletId, binding.moveId), {
    ok: false,
    code: 'invalid_response',
  });
  const callsBeforeWrongMove = directory.calls;
  assert.deepEqual(await client.application.getMove(binding.walletId, directory.status.moveId), {
    ok: false,
    code: 'unauthorized',
  });
  assert.equal(directory.calls, callsBeforeWrongMove);
  client.lock();
  const requestsBeforeLock = client.requests;
  assert.deepEqual(await client.application.getMove(binding.walletId, binding.moveId), {
    ok: false,
    code: 'wallet_unlock_required',
  });
  assert.equal(client.requests, requestsBeforeLock);
  assert.equal(JSON.stringify(client.messages).includes(token), false);
  const evidence = {
    scope:
      'Production client commands, host handler and Gateway after real D1 owner-session retirement; simulated directory and local credential adapter.',
    bundleSha256,
    retiredCredentialCannotReadGeneralPlacement: true,
    approvedMoveReadableAfterSessionRetirement: true,
    completedMoveReadable: true,
    mismatchedResponseMoveRejected: true,
    unapprovedMoveDeniedBeforeDirectory: true,
    localLockPreventsMoveReads: true,
    credentialsRemainInsideHost: true,
  };
  await writeFile(
    resolve(output, 'retired-move-client-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}

class SubmissionDirectory {
  failNextPreparation = false;
  status = null;
  submissions = 0;
  constructor(binding) {
    this.binding = binding;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = await request.json();
    assert.equal(body.moveId, this.binding.moveId);
    if (path.endsWith('/relocation-status')) {
      return this.status
        ? Response.json(this.status)
        : Response.json({ state: 'unavailable', code: 'not_found' }, { status: 404 });
    }
    if (path.endsWith('/relocation-request')) {
      return Response.json({
        kind: 'resolved',
        requestDigest: this.binding.requestDigestHex,
        sourceGeneration: 1,
        destinationRegion: 'APAC',
      });
    }
    assert.ok(path.endsWith('/relocation-replay'));
    assert.equal(body.requestDigest, this.binding.requestDigestHex);
    this.submissions += 1;
    if (this.failNextPreparation) {
      this.failNextPreparation = false;
      return Response.json({ ok: false, code: 'preparation_unavailable' }, { status: 503 });
    }
    this.status = movingPlacement(this.binding, {
      state: 'freezing',
      availability: 'paused',
      execution: { state: 'running' },
    });
    return Response.json(this.status);
  }
}

class MoveApprovalPrompt {
  calls = 0;
  constructor(challenges) {
    this.challenges = challenges;
  }
  async requestEmailOtpEnrollmentConfirmation(input) {
    this.calls += 1;
    assert.equal(input.confirmerText.title, 'Move wallet region');
    const record = await this.challenges.read(input.challengeId);
    assert.ok(record);
    assert.equal(record.operation, 'wallet_relocation');
    if (this.beforeReturn) this.beforeReturn();
    return { challengeId: input.challengeId, otpCode: record.otpCode };
  }
}

class LostMoveReplyJourney extends PlacementClientJourney {
  lost = false;
  submittedBodies = [];
  async request(input) {
    const response = await super.request(input);
    if (
      response.status === 200 &&
      input.method === 'POST' &&
      input.canonicalPath.endsWith('/relocations')
    ) {
      this.submittedBodies.push(structuredClone(input.body));
      if (!this.lost) {
        this.lost = true;
        throw new this.TransportError('network_error', 'Injected committed reply loss');
      }
    }
    return response;
  }
}

function moveRequest(binding) {
  return {
    walletId: binding.walletId,
    moveId: binding.moveId,
    destinationRegion: binding.destinationRegion,
    expectedGeneration: binding.sourceGeneration,
  };
}

export async function verifyMoveSubmissionClient({
  output,
  binding,
  token,
  routeOptions,
  WalletPlacementRoutes,
}) {
  const { api, bundleSha256 } = await loadPlacementClient(output);
  const directory = new SubmissionDirectory(binding);
  const routes = new WalletPlacementRoutes({ ...routeOptions, directory });
  const prompt = new MoveApprovalPrompt(routeOptions.emailOtp.emailOtpChallenges);
  const client = new LostMoveReplyJourney(api, routes, binding, token, prompt);
  client.TransportError = api.WalletHostOwnerRequestTransportError;
  const localState = new Map();
  api.IndexedDBManager.getAppState = readLocalState.bind(null, localState);
  api.IndexedDBManager.setAppState = writeLocalState.bind(null, localState);
  const intent = moveRequest(binding);
  assert.deepEqual(await client.application.move(intent), { ok: true, status: directory.status });
  assert.deepEqual(await client.application.getLastMoveRequest(binding.walletId), intent);
  client.lock();
  const beforeLocatorRead = client.requests;
  assert.deepEqual(await client.application.getLastMoveRequest(binding.walletId), intent);
  assert.equal(client.requests, beforeLocatorRead);
  client.unlock();
  assert.equal(client.lost, true);
  assert.equal(directory.submissions, 2);
  assert.equal(prompt.calls, 1);
  assert.deepEqual(client.submittedBodies[0], client.submittedBodies[1]);
  assert.deepEqual(await client.application.move(intent), { ok: true, status: directory.status });
  assert.equal(prompt.calls, 1);
  assert.equal(directory.submissions, 2);
  assert.deepEqual(await client.application.move({ ...intent, destinationRegion: 'WEUR' }), {
    ok: false,
    code: 'invalid_response',
  });
  assert.equal(prompt.calls, 1);
  const blockedBinding = {
    ...binding,
    moveId: `wmove_${Buffer.alloc(32, 103).toString('base64url')}`,
  };
  const blockedDirectory = new SubmissionDirectory(blockedBinding);
  const blockedRoutes = new WalletPlacementRoutes({ ...routeOptions, directory: blockedDirectory });
  const blockedPrompt = new MoveApprovalPrompt(routeOptions.emailOtp.emailOtpChallenges);
  const blockedClient = new PlacementClientJourney(
    api,
    blockedRoutes,
    blockedBinding,
    token,
    blockedPrompt,
  );
  blockedPrompt.beforeReturn = blockedClient.lock.bind(blockedClient);
  await assert.rejects(
    blockedClient.application.move(moveRequest(blockedBinding)),
    /authentication changed/u,
  );
  assert.equal(blockedDirectory.submissions, 0);
  assert.equal(JSON.stringify(client.messages).includes(token), false);
  assert.equal(JSON.stringify(client.messages).includes('sourceProof'), false);
  const retryBinding = {
    ...binding,
    moveId: `wmove_${Buffer.alloc(32, 104).toString('base64url')}`,
  };
  const retryDirectory = new SubmissionDirectory(retryBinding);
  retryDirectory.failNextPreparation = true;
  const retryRoutes = new WalletPlacementRoutes({ ...routeOptions, directory: retryDirectory });
  const retryPrompt = new MoveApprovalPrompt(routeOptions.emailOtp.emailOtpChallenges);
  const retryClient = new PlacementClientJourney(
    api,
    retryRoutes,
    retryBinding,
    token,
    retryPrompt,
  );
  assert.deepEqual(await retryClient.application.move(moveRequest(retryBinding)), {
    ok: false,
    code: 'transport_unavailable',
  });
  assert.equal(retryPrompt.calls, 1);
  assert.equal(retryDirectory.status, null);
  assert.deepEqual(await retryClient.application.move(moveRequest(retryBinding)), {
    ok: true,
    status: retryDirectory.status,
  });
  assert.equal(retryPrompt.calls, 1);
  assert.equal(retryDirectory.submissions, 2);
  const evidence = {
    lockedLocatorReadDoesNotContactServer: true,
    locatorContainsOnlyCanonicalRequestFields: true,
    approvedMoveResumesAfterPreparationFailureWithoutAnotherPrompt: true,
    scope:
      'Production application, iframe handlers and Gateway with real D1 owner approval and OTP verification. Console admission, local storage and the user prompt are simulated.',
    bundleSha256,
    freshApprovalInsideHost: true,
    lostReplyRetriesIdenticalProofAndIntent: true,
    existingMoveReplayDoesNotPrompt: true,
    conflictingDestinationRejected: true,
    authenticationChangePreventsSubmission: true,
    proofAndCredentialAbsentFromParentMessages: true,
  };
  await writeFile(
    resolve(output, 'move-submission-client-evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
  return evidence;
}

function readLocalState(state, key) {
  return Promise.resolve(structuredClone(state.get(key)));
}

function writeLocalState(state, key, value) {
  state.set(key, structuredClone(value));
  return Promise.resolve();
}

// This Gateway scenario has no browser. The browser journey covers real IndexedDB.
class LocalPlacementDatabase {
  rows = new Map();

  async runTransaction(_stores, _mode, task) {
    return task(this);
  }

  store() {
    return this;
  }
  index() {
    return this;
  }
  async openCursor() {
    return null;
  }
  async get(key) {
    return structuredClone(this.rows.get(key));
  }
  async put(row) {
    this.rows.set(row.key, structuredClone(row));
  }
}
