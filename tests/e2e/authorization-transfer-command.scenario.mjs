import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authorizationRowsQuery } from './authorization-transfer-freeze.scenario.mjs';
import { seedExecutionGeneration } from './execution-generation.scenario.mjs';

const URL = 'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization/freeze';

// This fixture supplies Console command responses. The private directory E2E
// separately verifies actual command admission and its runtime resource checks.
class SourceDirectory {
  calls = 0;
  constructor(scope, identity, mode, snapshot) {
    this.scope = scope;
    this.identity = identity;
    this.mode = mode;
    this.snapshot = snapshot;
  }
  async fetch(request) {
    this.calls += 1;
    const body = await request.json();
    if (request.url.endsWith('/relocation-authorization-manifest')) {
      assert.equal(body.wallet.walletId, this.identity.walletId);
      if (this.snapshot.kind === 'captured')
        assert.deepEqual(body.manifest, this.snapshot.manifest);
      this.snapshot = { kind: 'captured', manifest: body.manifest };
      return Response.json({ ok: true, manifest: this.snapshot.manifest });
    }
    assert.equal(
      request.url,
      'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-command',
    );
    assert.ok(
      body.kind === 'freeze' ||
        body.kind === 'export' ||
        body.kind === 'import_authorization' ||
        body.kind === 'activate' ||
        body.kind === 'cleanup',
    );
    assert.equal(body.attempt.moveId, this.identity.moveId);
    if (this.mode === 'denied')
      return Response.json({ ok: false, code: 'attempt_conflict' }, { status: 409 });
    let command;
    if (body.kind === 'cleanup') {
      assert.equal(this.snapshot.kind, 'captured');
      command = cleanupCommand(this.scope, this.identity, this.snapshot.manifest);
    } else if (body.kind === 'import_authorization' || body.kind === 'activate') {
      assert.equal(this.snapshot.kind, 'captured');
      command = destinationCommand(this.scope, this.identity, this.snapshot.manifest, body.kind);
    } else {
      command = sourceCommand(this.scope, this.identity, body.kind);
    }
    const digest = createHash('sha256')
      .update(
        JSON.stringify([
          'seams/wallet-d1-relocation-command/v1',
          command.wallet,
          command.moveId,
          command.requestDigest,
          command.participant,
          command.versionId,
          command.home,
          command.generation,
          command.operation,
        ]),
      )
      .digest('hex');
    return Response.json({
      ok: true,
      command,
      digest: this.mode === 'corrupt' ? '0'.repeat(64) : digest,
    });
  }
}

function sourceCommand(scope, identity, kind) {
  return {
    id: `${identity.moveId}/gateway/${kind}`,
    wallet: {
      namespace: scope.namespace,
      organizationId: scope.orgId,
      projectId: scope.projectId,
      environmentId: scope.envId,
      walletId: identity.walletId,
    },
    moveId: identity.moveId,
    requestDigest: identity.requestDigestHex,
    participant: 'gateway',
    versionId: '11111111-1111-4111-8111-111111111111',
    home: {
      region: 'WEUR',
      accountId: 'a'.repeat(32),
      databaseId: '22222222-2222-4222-8222-222222222222',
    },
    generation: identity.sourceGeneration,
    operation:
      kind === 'freeze'
        ? { kind: 'freeze' }
        : { kind: 'export', receipt: sourceFence(scope, identity) },
  };
}

function request(scope, identity, origin = URL) {
  return new Request(origin, {
    method: 'POST',
    body: JSON.stringify({
      walletId: identity.walletId,
      attempt: {
        wallet: sourceCommand(scope, identity, 'freeze').wallet,
        moveId: identity.moveId,
        phase: 'freezing',
        id: `wattempt_${'f'.repeat(43)}`,
        revision: 1,
        run: 1,
        number: 1,
        startedAtMs: Date.now(),
      },
    }),
  });
}

export async function freezeAuthorizationThroughCommand({ api, database, scope, identity }) {
  const activeBefore = await liveSessions(database, scope, identity);
  assert.ok(activeBefore > 0);
  const directory = new SourceDirectory(scope, identity, 'authorized', { kind: 'uncaptured' });
  const handler = new api.WalletAuthorizationRelocationRoutes({ database, scope, directory });
  assert.equal(
    (
      await handler.handle(
        request(scope, identity, URL.replace('wallet-relocation.internal', 'wallet.example.test')),
      )
    ).status,
    404,
  );
  assert.equal(directory.calls, 0);
  for (const mode of ['denied', 'corrupt']) {
    const rejected = new api.WalletAuthorizationRelocationRoutes({
      database,
      scope,
      directory: new SourceDirectory(scope, identity, mode, { kind: 'uncaptured' }),
    });
    assert.equal(
      (await rejected.handle(request(scope, identity))).status,
      mode === 'denied' ? 403 : 502,
    );
    assert.equal(await liveSessions(database, scope, identity), activeBefore);
    await assert.rejects(
      new api.D1WalletAuthorizationSnapshot(database, scope).seal(identity),
      /requires_frozen_source/u,
    );
  }
  await seedExecutionGeneration({ api, database, scope, walletId: identity.walletId });
  assert.equal(await new api.D1WalletRelocationWriteBlock(database, scope).check(identity, Date.now()), 'ready');
  const response = await handler.handle(request(scope, identity));
  assert.equal(response.status, 200, await response.clone().text());
  const receipt = await response.json();
  assert.equal(receipt.kind, 'authorization_frozen');
  assert.equal(await liveSessions(database, scope, identity), 0);
  const replay = await new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory,
  }).handle(request(scope, identity));
  assert.deepEqual(await replay.json(), receipt);
  return {
    manifest: receipt.manifest,
    commandDigest: receipt.commandDigest,
    invalidCommandsLeaveSourceUnfrozen: true,
    authorizedCommandRetiresLiveSession: true,
    exactFreezeCommandReplay: true,
  };
}

async function liveSessions(database, scope, identity) {
  return database
    .prepare(
      `SELECT COUNT(*) AS count FROM wallet_session_authorizations_v2
    WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND wallet_id = ?
      AND retired_at_ms IS NULL`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, identity.walletId)
    .first('count');
}

function sourceFence(scope, identity) {
  const command = sourceCommand(scope, identity, 'freeze');
  return {
    kind: 'source_fence',
    wallet: command.wallet,
    moveId: identity.moveId,
    home: command.home,
    generation: identity.sourceGeneration,
    recordedAtMs: 1_791_000_000_000,
    manifestDigest: '9'.repeat(64),
    participants: {
      gateway: 'a'.repeat(64),
      walletRuntime: 'b'.repeat(64),
      router: 'c'.repeat(64),
      deriverA: 'd'.repeat(64),
      deriverB: 'e'.repeat(64),
      signingWorker: 'f'.repeat(64),
      presignSessions: '0'.repeat(64),
    },
  };
}

function exportRequest(scope, identity, origin) {
  return new Request(origin, {
    method: 'POST',
    body: JSON.stringify({
      walletId: identity.walletId,
      attempt: {
        wallet: sourceCommand(scope, identity, 'freeze').wallet,
        moveId: identity.moveId,
        phase: 'copying',
        id: `wattempt_${'e'.repeat(43)}`,
        revision: 2,
        run: 1,
        number: 1,
        startedAtMs: Date.now(),
      },
    }),
  });
}

export async function transferAuthorizationThroughCommands({ api, source, destination, scope, identity, manifest }) {
  const url = URL.replace('/freeze', '/export');
  const directory = new SourceDirectory(scope, identity, 'authorized', { kind: 'captured', manifest });
  const handler = new api.WalletAuthorizationRelocationRoutes({ database: source, scope, directory });
  const denied = new api.WalletAuthorizationRelocationRoutes({ database: source, scope,
    directory: new SourceDirectory(scope, identity, 'denied', { kind: 'uncaptured' }) });
  assert.equal((await denied.handle(exportRequest(scope, identity, url))).status, 403);
  assert.equal((await handler.handle(exportRequest(scope, identity,
    url.replace('wallet-relocation.internal', 'wallet.example.test')))).status, 404);
  const response = await handler.handle(exportRequest(scope, identity, url));
  assert.equal(response.status, 200, await response.clone().text());
  const received = await response.json();
  assert.equal(received.kind, 'authorization_snapshot');
  const receiver = new api.WalletAuthorizationRelocationRoutes({ database: destination, scope, directory });
  assert.equal((await receiver.handle(destinationRequest(scope, identity, { kind: 'activate' }))).status, 503);
  const operation = { kind: 'import', snapshot: received.snapshot };
  const untrusted = await destinationRequest(scope, identity, operation).json();
  untrusted.manifest = manifest;
  assert.equal((await receiver.handle(new Request(URL.replace('/freeze', '/import'), {
    method: 'POST', body: JSON.stringify(untrusted),
  }))).status, 400);
  const accepted = await receiver.handle(destinationRequest(scope, identity, operation));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const acknowledgement = await accepted.json();
  assert.equal(acknowledgement.digestHex, manifest.digestHex);
  const replay = await new api.WalletAuthorizationRelocationRoutes({ database: destination, scope, directory })
    .handle(destinationRequest(scope, identity, operation));
  assert.deepEqual(await replay.json(), acknowledgement);
  return { snapshotBytes: Buffer.byteLength(JSON.stringify(received.snapshot)),
    transferRequests: 1, destinationDigest: manifest.digestHex,
    deniedAndPublicExportRejected: true, callerCannotChooseDestinationManifest: true,
    restartedImportAfterLostAcknowledgementExact: true };
}

export async function activateAuthorizationThroughCommand({
  api,
  database,
  scope,
  identity,
  manifest,
}) {
  const directory = new SourceDirectory(scope, identity, 'authorized', {
    kind: 'captured',
    manifest,
  });
  const denied = new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory: new SourceDirectory(scope, identity, 'denied', { kind: 'captured', manifest }),
  });
  assert.equal(
    (await denied.handle(destinationRequest(scope, identity, { kind: 'activate' }))).status,
    403,
  );
  const handler = new api.WalletAuthorizationRelocationRoutes({ database, scope, directory });
  const activated = await handler.handle(destinationRequest(scope, identity, { kind: 'activate' }));
  assert.equal(activated.status, 200, await activated.clone().text());
  const receipt = await activated.json();
  assert.equal(receipt.kind, 'authorization_activated');
  assert.equal(receipt.digestHex, manifest.digestHex);
  const replay = await new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory,
  }).handle(destinationRequest(scope, identity, { kind: 'activate' }));
  assert.deepEqual(await replay.json(), receipt);
  return {
    exactActivationReceiptAfterHandlerRestart: true,
    directoryDenialPreventsActivation: true,
    receipt,
  };
}

function destinationCommand(scope, identity, manifest, kind) {
  const source = sourceCommand(scope, identity, 'freeze');
  const home = {
    region: 'APAC',
    accountId: 'a'.repeat(32),
    databaseId: '33333333-3333-4333-8333-333333333333',
  };
  return {
    id: `${identity.moveId}/gateway/${kind}`,
    wallet: source.wallet,
    moveId: identity.moveId,
    requestDigest: identity.requestDigestHex,
    participant: 'gateway',
    versionId: source.versionId,
    home,
    generation: identity.sourceGeneration + 1,
    operation: {
      kind,
      receipt:
        kind === 'activate'
          ? destinationVerification(scope, identity, home)
          : sourceFence(scope, identity),
      physicalResource: `${home.databaseId}/gateway/${identity.sourceGeneration + 1}`,
      manifest,
    },
  };
}

function destinationVerification(scope, identity, home, kind = 'destination_verification') {
  const source = sourceFence(scope, identity);
  return {
    kind,
    wallet: source.wallet,
    moveId: identity.moveId,
    home,
    generation: identity.sourceGeneration + 1,
    recordedAtMs: source.recordedAtMs,
    manifestDigest: source.manifestDigest,
    participants: source.participants,
  };
}

function cleanupCommand(scope, identity, manifest) {
  const source = sourceCommand(scope, identity, 'freeze');
  const destination = destinationCommand(scope, identity, manifest, 'activate');
  return {
    id: `${identity.moveId}/gateway/cleanup`,
    wallet: source.wallet,
    moveId: identity.moveId,
    requestDigest: identity.requestDigestHex,
    participant: source.participant,
    versionId: source.versionId,
    home: source.home,
    generation: identity.sourceGeneration,
    operation: {
      kind: 'cleanup',
      receipt: destinationVerification(scope, identity, destination.home, 'destination_activation'),
      manifest,
    },
  };
}

export async function cleanupAuthorizationThroughCommand({
  api,
  database,
  scope,
  identity,
  manifest,
  tables,
}) {
  const directory = new SourceDirectory(scope, identity, 'authorized', {
    kind: 'captured',
    manifest,
  });
  const denied = new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory: new SourceDirectory(scope, identity, 'denied', { kind: 'captured', manifest }),
  });
  assert.equal(
    (await denied.handle(destinationRequest(scope, identity, { kind: 'cleanup' }))).status,
    403,
  );
  const quotaRows = await database
    .prepare(authorizationRowsQuery('authorization_wallet_session_quotas'))
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, identity.walletId)
    .all();
  const neighborBefore = await readCleanupNeighbor(database, scope, tables);
  await database
    .prepare(
      `CREATE TRIGGER injected_authorization_cleanup_failure
    BEFORE DELETE ON authorized_operation_audit_events
    BEGIN SELECT RAISE(ABORT, 'injected_cleanup_failure'); END`,
    )
    .run();
  let interrupted = false;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const response = await new api.WalletAuthorizationRelocationRoutes({
      database,
      scope,
      directory,
    }).handle(destinationRequest(scope, identity, { kind: 'cleanup' }));
    if (response.status === 503) {
      interrupted = true;
      break;
    }
    assert.equal(response.status, 202, await response.clone().text());
  }
  assert.equal(interrupted, true, 'Cleanup must reach the injected deletion failure');
  await database.exec('DROP TRIGGER injected_authorization_cleanup_failure');
  let completion = null;
  let calls = 0;
  for (; calls < 32; calls += 1) {
    const response = await new api.WalletAuthorizationRelocationRoutes({
      database,
      scope,
      directory,
    }).handle(destinationRequest(scope, identity, { kind: 'cleanup' }));
    assert.ok(response.status === 200 || response.status === 202, await response.clone().text());
    const body = await response.json();
    if (body.progress.state === 'cleaned') {
      completion = body;
      break;
    }
    assert.equal(body.progress.state, 'cleaning');
  }
  assert.ok(completion);
  assert.ok(calls > 2, 'Large snapshot cleanup must require several bounded calls');
  const repeated = await new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory,
  }).handle(destinationRequest(scope, identity, { kind: 'cleanup' }));
  assert.deepEqual(await repeated.json(), completion);
  for (const table of tables) {
    const rows = await database
      .prepare(authorizationRowsQuery(table))
      .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, identity.walletId)
      .all();
    assert.equal(rows.results.length, 0, table);
  }
  for (const quota of quotaRows.results) {
    assert.equal(
      await database
        .prepare(
          `SELECT COUNT(*) AS count FROM authorization_wallet_session_quotas
      WHERE namespace = ? AND tenant_id = ? AND quota_id = ?`,
        )
        .bind(quota.namespace, quota.tenant_id, quota.quota_id)
        .first('count'),
      0,
    );
  }
  assert.deepEqual(await readCleanupNeighbor(database, scope, tables), neighborBefore);
  for (const table of [
    'wallet_relocation_authorization_chunks',
    'wallet_relocation_authorization_intake_chunks',
  ])
    assert.equal(
      await database
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE wallet_id = ?`)
        .bind(identity.walletId)
        .first('count'),
      0,
    );
  assert.equal(
    await database
      .prepare(
        'SELECT COUNT(*) AS count FROM wallet_relocation_authorization_fences WHERE wallet_id = ?',
      )
      .bind(identity.walletId)
      .first('count'),
    1,
  );
  return {
    boundedCalls: calls + 1,
    failureResumedAfterHandlerRestart: true,
    exactCompletionReplay: true,
    quotasRemovedWithSessions: true,
    neighboringWalletUnchanged: true,
    sourceFenceRetained: true,
  };
}

async function readCleanupNeighbor(database, scope, tables) {
  const result = [];
  for (const table of tables) {
    const rows = await database
      .prepare(authorizationRowsQuery(table))
      .bind(
        scope.namespace,
        scope.orgId,
        scope.projectId,
        scope.envId,
        'wallet:authorization-freeze-neighbor',
      )
      .all();
    result.push(rows.results);
  }
  return result;
}

function destinationRequest(scope, identity, operation) {
  const attempt = {
    wallet: sourceCommand(scope, identity, 'freeze').wallet,
    moveId: identity.moveId,
    phase: operation.kind === 'activate' || operation.kind === 'cleanup' ? 'cutover' : 'copying',
    id: `wattempt_${'e'.repeat(43)}`,
    revision: 2,
    run: 1,
    number: 1,
    startedAtMs: Date.now(),
  };
  const body =
    operation.kind === 'import'
      ? { walletId: identity.walletId, attempt, snapshot: operation.snapshot }
      : { walletId: identity.walletId, attempt };
  return new Request(URL.replace('/freeze', `/${operation.kind}`), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

class UnusedRegistrationBackend {
  admit() {
    throw new Error('Settlement scenario must not call the backend');
  }
  execute() {
    throw new Error('Settlement scenario must not call the backend');
  }
}

async function commitCeremony(store, lifecycleId, loaded) {
  return store.commit({
    lifecycleId,
    state: loaded.state,
    baseline: loaded.baseline,
    companionWrite: null,
  });
}

export async function verifyPendingCeremonyFreeze({ api, database, scope }) {
  const fixture = await api.buildNearRegistrationAuthorityFixture('settlement');
  const lifecycleId = fixture.admission.scope.lifecycle_id;
  const store = api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database,
    scope,
  });
  const admitted = await store.load(lifecycleId);
  admitted.state.authorization.authorities.push(...fixture.state.authorities);
  const service = new api.InMemoryRouterAbEd25519YaoRegistrationService(
    new UnusedRegistrationBackend(),
    admitted.state.registration,
  );
  const preparation = service.prepareAdmit(fixture.admission);
  assert.equal(preparation.kind, 'claimed');
  assert.equal((await commitCeremony(store, lifecycleId, admitted)).kind, 'stored');
  const identity = api.WalletRelocationSessionSource.parse({
    walletId: fixture.intent.walletId,
    moveId: `wmove_${'s'.repeat(43)}`,
    requestDigestHex: '7'.repeat(64),
    sourceGeneration: 1,
  });
  const directory = new SourceDirectory(scope, identity, 'authorized', { kind: 'uncaptured' });
  const original = request(scope, identity);
  const handler = new api.WalletAuthorizationRelocationRoutes({ database, scope, directory });
  const pending = await handler.handle(original.clone());
  assert.equal(pending.status, 202);
  const waiting = await pending.json();
  assert.equal(waiting.kind, 'authorization_pending');
  assert.equal(waiting.reason, 'ceremonies_unsettled');
  const repeated = await new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory,
  }).handle(original.clone());
  assert.deepEqual(await repeated.json(), waiting);
  await assert.rejects(
    new api.D1WalletRelocationSessions(database, scope).retire(identity, Date.now()),
    /wallet_ceremonies_unsettled/u,
  );
  assert.equal(
    await database
      .prepare('SELECT COUNT(*) AS count FROM wallet_relocation_session_fences WHERE wallet_id = ?')
      .bind(identity.walletId)
      .first('count'),
    0,
  );
  await assert.rejects(
    new api.D1WalletAuthorizationSnapshot(database, scope).seal(identity),
    /requires_frozen_source/u,
  );

  const settled = await store.load(lifecycleId);
  const resumed = new api.InMemoryRouterAbEd25519YaoRegistrationService(
    new UnusedRegistrationBackend(),
    settled.state.registration,
  );
  const rejected = resumed.commitAdmit({
    request: fixture.admission,
    claim: preparation.claim,
    outcome: {
      kind: 'backend_response',
      result: {
        ok: false,
        status: 409,
        code: 'admission_rejected',
        message: 'Admission definitively rejected',
      },
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal((await commitCeremony(store, lifecycleId, settled)).kind, 'stored');
  const neighbor = await api.buildNearRegistrationAuthorityFixture('settlement-neighbor');
  const neighborLifecycleId = neighbor.admission.scope.lifecycle_id;
  const neighborLoaded = await store.load(neighborLifecycleId);
  neighborLoaded.state.authorization.authorities.push(...neighbor.state.authorities);
  const neighborService = new api.InMemoryRouterAbEd25519YaoRegistrationService(
    new UnusedRegistrationBackend(),
    neighborLoaded.state.registration,
  );
  assert.equal(neighborService.prepareAdmit(neighbor.admission).kind, 'claimed');
  assert.equal((await commitCeremony(store, neighborLifecycleId, neighborLoaded)).kind, 'stored');
  const delayed = await store.load(lifecycleId);
  const late = new api.InMemoryRouterAbEd25519YaoRegistrationService(
    new UnusedRegistrationBackend(),
    delayed.state.registration,
  );
  assert.equal(late.prepareAdmit(fixture.admission).kind, 'claimed');
  await new api.D1WalletRelocationSessions(database, scope).retire(identity, Date.now());
  await assert.rejects(
    commitCeremony(store, lifecycleId, delayed),
    /wallet_ceremony_admission_closed/u,
  );
  assert.equal((await store.load(lifecycleId)).state.registration.admissionClaims.size, 0);
  await new api.D1WalletAuthorizationFreeze(database, scope).freeze(identity, Date.now());
  const completed = await handler.handle(original.clone());
  assert.equal(completed.status, 200, await completed.clone().text());
  assert.equal((await completed.json()).kind, 'authorization_frozen');
  await verifyCompletedGatewayAdmission({ api, database, scope });
  return {
    pendingFreezeKeepsSourceUnretired: true,
    restartedPendingReplyMatches: true,
    unsettledSnapshotRejected: true,
    admittedWorkCanSettle: true,
    lateAdmissionAfterRetirementRejected: true,
    sameCommandFreezesAfterSettlement: true,
    unrelatedPendingWorkDoesNotBlockFreeze: true,
    completedGatewayAdmissionDoesNotBlockFreeze: true,
    interruptedOperationBlocksFreeze: true,
    exactOperationRetrySettlesOriginalClaim: true,
    frozenOperationReplayDoesNotExecuteEffects: true,
    frozenOperationWritesRejected: true,
  };
}

async function unexpectedAdmissionEffect() {
  throw new Error('Gateway admission must not execute external effects');
}

async function verifyCompletedGatewayAdmission({ api, database, scope }) {
  const fixture = await api.buildNearRegistrationAuthorityFixture('settled-admission');
  const lifecycleId = fixture.admission.scope.lifecycle_id;
  const store = api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database,
    scope,
  });
  const loaded = await store.load(lifecycleId);
  loaded.state.authorization.authorities.push(...fixture.state.authorities);
  const backend = new api.RouterAbEd25519YaoHttpRegistrationBackend({
    routerUrl: 'https://router.invalid',
    signingWorkerId: fixture.admission.scope.signing_worker_id,
    internalServiceAuth: 'admission-test-secret',
    deriverAInputPublicKey: new Array(32).fill(1),
    deriverBInputPublicKey: new Array(32).fill(2),
    signingWorkerRecipientPublicKey: new Array(32).fill(3),
    resolveTenantRoot: unexpectedAdmissionEffect,
    fetch: unexpectedAdmissionEffect,
  });
  const service = new api.InMemoryRouterAbEd25519YaoRegistrationService(
    backend,
    loaded.state.registration,
  );
  const preparation = service.prepareAdmit(fixture.admission);
  assert.equal(preparation.kind, 'claimed');
  const result = service.commitAdmit({
    request: fixture.admission,
    claim: preparation.claim,
    outcome: { kind: 'backend_response', result: await backend.admit(fixture.admission) },
  });
  assert.equal(result.ok, true);
  assert.equal((await commitCeremony(store, lifecycleId, loaded)).kind, 'stored');
  const identity = api.WalletRelocationSessionSource.parse({
    walletId: fixture.intent.walletId,
    moveId: `wmove_${'a'.repeat(43)}`,
    requestDigestHex: '8'.repeat(64),
    sourceGeneration: 1,
  });
  const directory = new SourceDirectory(scope, identity, 'authorized', { kind: 'uncaptured' });
  const handler = new api.WalletAuthorizationRelocationRoutes({ database, scope, directory });
  const operation = new SettlementOperationProbe(api, database, scope, fixture.admission);
  const interrupted = await operation.run();
  assert.equal(interrupted.kind, 'uncertain');
  assert.equal(interrupted.phase, 'effect');
  const pending = await handler.handle(request(scope, identity));
  assert.equal(pending.status, 202);
  operation.now += 2;
  operation.interrupt = false;
  const completedOperation = await operation.run();
  assert.equal(completedOperation.kind, 'executed');
  assert.equal(operation.preparations, 1);
  await seedExecutionGeneration({ api, database, scope, walletId: identity.walletId });
  assert.equal(await new api.D1WalletRelocationWriteBlock(database, scope).check(identity, Date.now()), 'ready');
  const response = await handler.handle(request(scope, identity));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).kind, 'authorization_frozen');
  assert.equal((await operation.run()).kind, 'exact_replay');
  assert.equal(operation.executions, 2);
  const completedRecord = await operation.store.read('settlement');
  assert.equal(completedRecord.kind, 'present');
  await assert.rejects(
    operation.store.put('settlement', completedRecord.value, completedRecord.version),
  );
  const delayed = await operation.run('delayed-operation');
  assert.equal(delayed.kind, 'uncertain');
  assert.equal(delayed.phase, 'claim');
  assert.equal(operation.executions, 2);
}

class SettlementOperationProbe {
  now = 100;
  interrupt = true;
  preparations = 0;
  executions = 0;

  constructor(api, database, scope, admission) {
    this.api = api;
    this.admission = admission;
    this.store = new api.D1WalletOperationStore(
      {
        database,
        scope,
        keyPrefix: 'settlement-operation:',
        encode: this.encode,
        parse: this.parse.bind(this),
      },
      this.owner,
    );
  }

  encode(value) {
    return value;
  }
  owner(record) {
    return record.prepared.application_binding.wallet_id;
  }
  parsePrepared(value) {
    const parsed = this.api.parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(value);
    return parsed.ok ? parsed.value : null;
  }
  parseReceipt(value) {
    return value === 'completed' ? value : null;
  }
  parse(value) {
    return this.api.parseRouterAbEd25519YaoRegistrationSideEffectRecordV2(value, {
      operation: 'registration_activate',
      parsePrepared: this.parsePrepared.bind(this),
      parseReceipt: this.parseReceipt,
    });
  }
  nowMs() {
    return this.now;
  }
  async prepare() {
    this.preparations += 1;
    return this.admission;
  }
  async fingerprint(prepared) {
    return createHash('sha256').update(JSON.stringify(prepared)).digest('hex');
  }
  async execute() {
    this.executions += 1;
    if (this.interrupt) throw new Error('Injected interruption after durable admission');
    return 'completed';
  }
  projectReceipt(response) {
    return response;
  }
  async replay(receipt) {
    return receipt;
  }
  async run(key = 'settlement') {
    return this.api.runRouterAbEd25519YaoRegistrationSideEffectV2(this.store, {
      kind: 'prepared_resumable',
      operation: 'registration_activate',
      key,
      initialRecord: await this.store.read(key),
      requestFingerprint: 'f'.repeat(64),
      resumeAfterMs: 1,
      nowMs: this.nowMs.bind(this),
      prepare: this.prepare.bind(this),
      derivePreparedArtifactFingerprint: this.fingerprint,
      execute: this.execute.bind(this),
      projectReceipt: this.projectReceipt,
      completionWrite: noCompletionWrite,
      replay: this.replay,
    });
  }
}

// This operation leaves no write for its completion record.
function noCompletionWrite() {
  return null;
}

// Admit a real operation immediately before the retirement transaction starts.
class RetirementRaceDatabase {
  constructor(database, store, operation) {
    this.database = database;
    this.store = store;
    this.operation = operation;
    this.claimed = null;
  }

  prepare(sql) {
    return this.database.prepare(sql);
  }

  async batch(statements) {
    if (this.operation !== null) {
      const operation = this.operation;
      this.operation = null;
      const admitted = await this.store.admitAuthorizedOperation({ operation });
      assert.equal(admitted.kind, 'claimed');
      this.claimed = admitted.operation;
    }
    return this.database.batch(statements);
  }
}

export async function verifyPendingSessionOperationFreeze({
  api,
  database,
  scope,
  service,
  issueDeviceSession,
}) {
  const nowMs = Date.now();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'operation-settlement',
    identity: {
      walletId: 'wallet:operation-settlement',
      credentialIdB64u: Buffer.alloc(32, 81).toString('base64url'),
    },
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 3_600_000,
  });
  const issued = await issueDeviceSession(database, service(database, scope), fixture, nowMs);
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const firstInput = api.buildSessionSigningOperationInputFixture({
    session: issued.session,
    label: 'settlement-first',
    nowMs,
  });
  const secondInput = api.buildSessionSigningOperationInputFixture({
    session: issued.session,
    label: 'settlement-second',
    nowMs,
  });
  const first = await store.admitAuthorizedOperation({ operation: firstInput });
  const second = await store.admitAuthorizedOperation({ operation: secondInput });
  assert.equal(first.kind, 'claimed');
  assert.equal(second.kind, 'claimed');
  const identity = api.WalletRelocationSessionSource.parse({
    walletId: fixture.authority.walletId,
    moveId: `wmove_${'o'.repeat(43)}`,
    requestDigestHex: '4'.repeat(64),
    sourceGeneration: 1,
  });
  const sessions = new api.D1WalletRelocationSessions(database, scope);
  assert.equal(await sessions.hasPendingOperations(identity.walletId), true);
  assert.equal(
    await new api.D1WalletRelocationSessions(database, {
      ...scope,
      envId: 'foreign-operation-scope',
    }).hasPendingOperations(identity.walletId),
    false,
  );
  const directory = new SourceDirectory(scope, identity, 'authorized', { kind: 'uncaptured' });
  const original = request(scope, identity);
  const waitingResponse = await new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory,
  }).handle(original.clone());
  assert.equal(waitingResponse.status, 202);
  const waiting = await waitingResponse.json();
  assert.equal(waiting.reason, 'operations_unsettled');
  await assert.rejects(
    sessions.retire(identity, nowMs + 1),
    /wallet_operations_unsettled/u,
  );
  assert.equal(await liveSessions(database, scope, identity), 1);
  const firstCompletion = await store.completeAuthorizedOperation({
    operation: first.operation,
    result: 'succeeded',
    response: {
      status: 200,
      contentType: 'application/json',
      bodyText: '{"signature":"settled-first"}',
    },
    completedAtMs: nowMs + 2,
  });
  assert.equal(firstCompletion.lifecycle, 'completed');
  assert.equal(await sessions.hasPendingOperations(identity.walletId), true);
  await database
    .prepare(
      `CREATE TRIGGER interrupt_operation_completion BEFORE UPDATE ON authorized_operations
    WHEN NEW.authorized_operation_id = 'operation:settlement-second'
    BEGIN SELECT RAISE(ABORT, 'injected_operation_completion_failure'); END`,
    )
    .run();
  const completion = {
    operation: second.operation,
    result: 'failed_before_side_effect',
    response: {
      status: 409,
      contentType: 'application/json',
      bodyText: '{"code":"backend_rejected"}',
    },
    completedAtMs: nowMs + 3,
  };
  await assert.rejects(
    store.completeAuthorizedOperation(completion),
    /injected_operation_completion_failure/u,
  );
  const repeated = await new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory,
  }).handle(original.clone());
  assert.deepEqual(await repeated.json(), waiting);
  await database.exec('DROP TRIGGER interrupt_operation_completion');
  const secondCompletion = await store.completeAuthorizedOperation(completion);
  assert.equal(secondCompletion.lifecycle, 'completed');
  assert.equal(await sessions.hasPendingOperations(identity.walletId), false);

  const lateInput = api.buildSessionSigningOperationInputFixture({
    session: issued.session,
    label: 'settlement-late',
    nowMs,
  });
  const raced = new RetirementRaceDatabase(database, store, lateInput);
  await assert.rejects(new api.D1WalletRelocationSessions(raced, scope).retire(identity, nowMs + 4),
    /wallet_operations_unsettled/u);
  assert.ok(raced.claimed);
  assert.equal(await liveSessions(database, scope, identity), 1);
  assert.equal(
    await database
      .prepare('SELECT COUNT(*) AS count FROM wallet_relocation_session_fences WHERE wallet_id = ?')
      .bind(identity.walletId)
      .first('count'),
    0,
  );
  await store.completeAuthorizedOperation({
    operation: raced.claimed,
    result: 'succeeded',
    response: {
      status: 200,
      contentType: 'application/json',
      bodyText: '{"signature":"settled-late"}',
    },
    completedAtMs: nowMs + 4,
  });
  const exactReplay = await store.admitAuthorizedOperation({ operation: firstInput });
  assert.equal(exactReplay.kind, 'replayed');
  assert.deepEqual(exactReplay.operation, firstCompletion);

  const neighbor = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'operation-settlement-neighbor',
    identity: {
      walletId: 'wallet:operation-settlement-neighbor',
      credentialIdB64u: Buffer.alloc(32, 82).toString('base64url'),
    },
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 3_600_000,
  });
  const neighborIssued = await issueDeviceSession(
    database,
    service(database, scope),
    neighbor,
    nowMs,
  );
  const neighborClaim = await store.admitAuthorizedOperation({
    operation: api.buildSessionSigningOperationInputFixture({
      session: neighborIssued.session,
      label: 'settlement-neighbor',
      nowMs,
    }),
  });
  assert.equal(neighborClaim.kind, 'claimed');
  assert.equal(await new api.D1WalletRelocationWriteBlock(database, scope).check(identity, Date.now()), 'ready');
  const frozenResponse = await new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory,
  }).handle(original.clone());
  assert.equal(frozenResponse.status, 200, await frozenResponse.clone().text());
  const frozen = await frozenResponse.json();
  assert.equal(frozen.kind, 'authorization_frozen');
  assert.equal(await liveSessions(database, scope, identity), 0);
  assert.equal(await sessions.hasPendingOperations(neighbor.authority.walletId), true);
  const retry = await new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory,
  }).handle(original.clone());
  assert.deepEqual(await retry.json(), frozen);
  const rejected = await store.admitAuthorizedOperation({
    operation: api.buildSessionSigningOperationInputFixture({
      session: issued.session,
      label: 'settlement-after-freeze',
      nowMs,
    }),
  });
  assert.equal(rejected.kind, 'authorization_grant_rejected');
  assert.deepEqual(
    await store.readAuthorizedOperation({
      tenantId: issued.session.tenantId,
      operationFingerprintDigest: first.operation.operationFingerprintDigest,
    }),
    firstCompletion,
  );
  return {
    pendingClaimsBlockRetirement: true,
    completionFailureKeepsSessionsAvailableForSettlement: true,
    claimBetweenReadAndRetirementRollsBackRetirement: true,
    terminalResultsSurviveFreeze: true,
    neighboringPendingWalletDoesNotBlockFreeze: true,
    obsoleteSessionCannotClaimNewOperation: true,
    exactFreezeReplay: true,
    operationIds: [
      first.operation.authorizedOperationId,
      second.operation.authorizedOperationId,
      raced.claimed.authorizedOperationId,
    ],
    manifest: frozen.manifest,
  };
}
