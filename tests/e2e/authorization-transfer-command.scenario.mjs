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
