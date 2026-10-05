import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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
      body.kind === 'freeze' || body.kind === 'export' || body.kind === 'import_authorization',
    );
    assert.equal(body.attempt.moveId, this.identity.moveId);
    if (this.mode === 'denied')
      return Response.json({ ok: false, code: 'attempt_conflict' }, { status: 409 });
    let command;
    if (body.kind === 'import_authorization') {
      assert.equal(this.snapshot.kind, 'captured');
      command = destinationCommand(this.scope, this.identity, this.snapshot.manifest);
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

function exportRequest(scope, identity, index, origin) {
  return new Request(origin, {
    method: 'POST',
    body: JSON.stringify({
      walletId: identity.walletId,
      index,
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

export async function transferAuthorizationThroughCommands({
  api,
  source,
  destination,
  scope,
  identity,
  manifest,
}) {
  const url = URL.replace('/freeze', '/export');
  const directory = new SourceDirectory(scope, identity, 'authorized', {
    kind: 'captured',
    manifest,
  });
  const handler = new api.WalletAuthorizationRelocationRoutes({
    database: source,
    scope,
    directory,
  });
  const denied = new api.WalletAuthorizationRelocationRoutes({
    database: source,
    scope,
    directory: new SourceDirectory(scope, identity, 'denied', { kind: 'uncaptured' }),
  });
  assert.equal((await denied.handle(exportRequest(scope, identity, 0, url))).status, 403);
  assert.equal(
    (
      await handler.handle(
        exportRequest(
          scope,
          identity,
          0,
          url.replace('wallet-relocation.internal', 'wallet.example.test'),
        ),
      )
    ).status,
    404,
  );
  assert.equal(directory.calls, 0);
  assert.equal((await handler.handle(exportRequest(scope, identity, -1, url))).status, 400);
  assert.equal(directory.calls, 0);
  const receiver = new api.WalletAuthorizationRelocationRoutes({
    database: destination,
    scope,
    directory,
  });
  const deniedReceiver = new api.WalletAuthorizationRelocationRoutes({
    database: destination,
    scope,
    directory: new SourceDirectory(scope, identity, 'denied', { kind: 'captured', manifest }),
  });
  assert.equal(
    (await deniedReceiver.handle(destinationRequest(scope, identity, { kind: 'prepare' }))).status,
    403,
  );
  const untrusted = await destinationRequest(scope, identity, { kind: 'prepare' }).json();
  untrusted.manifest = manifest;
  assert.equal(
    (
      await receiver.handle(
        new Request(URL.replace('/freeze', '/prepare'), {
          method: 'POST',
          body: JSON.stringify(untrusted),
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    await destination
      .prepare(
        'SELECT COUNT(*) AS count FROM wallet_relocation_authorization_imports WHERE wallet_id = ?',
      )
      .bind(identity.walletId)
      .first('count'),
    0,
  );
  const prepared = await receiver.handle(destinationRequest(scope, identity, { kind: 'prepare' }));
  assert.equal(prepared.status, 200);
  assert.deepEqual((await prepared.json()).progress, {
    state: 'receiving',
    nextIndex: 0,
    chunkCount: manifest.chunkCount,
  });
  assert.equal(
    (await receiver.handle(destinationRequest(scope, identity, { kind: 'verify' }))).status,
    503,
  );
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const response = await handler.handle(exportRequest(scope, identity, index, url));
    assert.equal(response.status, 200, await response.clone().text());
    const received = await response.json();
    assert.equal(received.kind, 'authorization_chunk');
    assert.ok(Buffer.byteLength(received.chunk.chunkJson) <= 131072);
    const replay = await new api.WalletAuthorizationRelocationRoutes({
      database: source,
      scope,
      directory,
    }).handle(exportRequest(scope, identity, index, url));
    const replayed = await replay.json();
    assert.deepEqual(replayed, received);
    const accepted = await receiver.handle(
      destinationRequest(scope, identity, { kind: 'accept', chunk: received.chunk }),
    );
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const acknowledgement = await accepted.json();
    assert.equal(acknowledgement.digestHex, received.chunk.digestHex);
    const acceptedAgain = await new api.WalletAuthorizationRelocationRoutes({
      database: destination,
      scope,
      directory,
    }).handle(destinationRequest(scope, identity, { kind: 'accept', chunk: received.chunk }));
    assert.deepEqual(await acceptedAgain.json(), acknowledgement);
    const resumed = await new api.WalletAuthorizationRelocationRoutes({
      database: destination,
      scope,
      directory,
    }).handle(destinationRequest(scope, identity, { kind: 'prepare' }));
    assert.equal(resumed.status, 200);
    assert.deepEqual((await resumed.json()).progress, {
      state: 'receiving',
      nextIndex: index + 1,
      chunkCount: manifest.chunkCount,
    });
  }
  const verified = await receiver.handle(destinationRequest(scope, identity, { kind: 'verify' }));
  assert.equal(verified.status, 200, await verified.clone().text());
  assert.equal((await verified.json()).digestHex, manifest.digestHex);
  const completed = await new api.WalletAuthorizationRelocationRoutes({
    database: destination,
    scope,
    directory,
  }).handle(destinationRequest(scope, identity, { kind: 'prepare' }));
  assert.equal(completed.status, 200);
  assert.deepEqual((await completed.json()).progress, {
    state: 'verified',
    digestHex: manifest.digestHex,
  });
  return {
    durableResumePositionAfterAcknowledgementLoss: true,
    chunksTransferred: manifest.chunkCount,
    destinationDigest: manifest.digestHex,
    deniedAndPublicExportRejected: true,
    boundedExactExportReplay: true,
    allChunksRestoredThroughAuthorizedDestinationRoute: true,
    callerCannotChooseDestinationManifest: true,
    incompleteImportCannotVerify: true,
  };
}

function destinationCommand(scope, identity, manifest) {
  const source = sourceCommand(scope, identity, 'freeze');
  const home = {
    region: 'APAC',
    accountId: 'a'.repeat(32),
    databaseId: '33333333-3333-4333-8333-333333333333',
  };
  return {
    id: `${identity.moveId}/gateway/import_authorization`,
    wallet: source.wallet,
    moveId: identity.moveId,
    requestDigest: identity.requestDigestHex,
    participant: 'gateway',
    versionId: source.versionId,
    home,
    generation: identity.sourceGeneration + 1,
    operation: {
      kind: 'import_authorization',
      receipt: sourceFence(scope, identity),
      physicalResource: `${home.databaseId}/gateway/${identity.sourceGeneration + 1}`,
      manifest,
    },
  };
}

function destinationRequest(scope, identity, operation) {
  const attempt = {
    wallet: sourceCommand(scope, identity, 'freeze').wallet,
    moveId: identity.moveId,
    phase: 'copying',
    id: `wattempt_${'e'.repeat(43)}`,
    revision: 2,
    run: 1,
    number: 1,
    startedAtMs: Date.now(),
  };
  const body =
    operation.kind === 'accept'
      ? { walletId: identity.walletId, attempt, chunk: operation.chunk }
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
  run(key = 'settlement') {
    return this.api.runRouterAbEd25519YaoRegistrationSideEffectV2(this.store, {
      kind: 'prepared_resumable',
      operation: 'registration_activate',
      key,
      requestFingerprint: 'f'.repeat(64),
      resumeAfterMs: 1,
      nowMs: this.nowMs.bind(this),
      prepare: this.prepare.bind(this),
      derivePreparedArtifactFingerprint: this.fingerprint,
      execute: this.execute.bind(this),
      projectReceipt: this.projectReceipt,
      replay: this.replay,
    });
  }
}
