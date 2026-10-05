import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const URL = 'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization/freeze';

// This fixture supplies Console command responses. The private directory E2E
// separately verifies actual command admission and its runtime resource checks.
class FreezeDirectory {
  calls = 0;
  constructor(scope, identity, mode) {
    this.scope = scope;
    this.identity = identity;
    this.mode = mode;
  }
  async fetch(request) {
    this.calls += 1;
    assert.equal(
      request.url,
      'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-command',
    );
    const body = await request.json();
    assert.equal(body.kind, 'freeze');
    assert.equal(body.attempt.moveId, this.identity.moveId);
    if (this.mode === 'denied')
      return Response.json({ ok: false, code: 'attempt_conflict' }, { status: 409 });
    const command = freezeCommand(this.scope, this.identity);
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

function freezeCommand(scope, identity) {
  return {
    id: `${identity.moveId}/gateway/freeze`,
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
    operation: { kind: 'freeze' },
  };
}

function request(scope, identity, origin = URL) {
  return new Request(origin, {
    method: 'POST',
    body: JSON.stringify({
      walletId: identity.walletId,
      attempt: {
        wallet: freezeCommand(scope, identity).wallet,
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
  const directory = new FreezeDirectory(scope, identity, 'authorized');
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
      directory: new FreezeDirectory(scope, identity, mode),
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
