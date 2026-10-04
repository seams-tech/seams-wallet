// Run from the repository root: node tests/e2e/sponsored-account-ownership.e2e.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const output = resolve('.artifacts/r152/sponsored-owner-20261004');
await mkdir(`${output}/api`, { recursive: true });
await build({
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['*.wasm', 'bs58'],
  outfile: `${output}/api/fixture.mjs`,
  tsconfig: 'packages/wallet-server/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      export { createSponsoredNamedNearAccountForOptions } from './packages/wallet-server/src/router/cloudflare/d1/near/d1SponsoredNearAccount';
      export { createSyncSqliteDatabase } from './packages/wallet-server/src/storage/syncSqlite';
      export { nodeSqliteConnection } from './packages/wallet-server/src/router/node/nodeSqlite';
      export { applySignerSqlMigrationsV1 } from './packages/wallet-server/src/router/node/signerSqlMigrations';
      export { parseWalletId } from './packages/shared-ts/src/utils/domainIds';
      export { base58Encode } from './packages/shared-ts/src/utils/base58';
    `,
  },
});
const api = await import(pathToFileURL(`${output}/api/fixture.mjs`));
const keys = generateKeyPairSync('ed25519');
const seed = keys.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
const publicBytes = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const publicKey = `ed25519:${api.base58Encode(publicBytes)}`;
const secret = `ed25519:${api.base58Encode(Buffer.concat([seed, publicBytes]))}`;
const blockHash = api.base58Encode(new Uint8Array(32));
const sqlite = new DatabaseSync(':memory:');
const connection = api.nodeSqliteConnection(sqlite);
const database = api.createSyncSqliteDatabase(connection);
const requests = [];
let settledTransactionHash = null;
const rpc = createServer(handleRpc);
rpc.listen(0, '127.0.0.1');
await once(rpc, 'listening');
try {
  api.applySignerSqlMigrationsV1(
    connection,
    'packages/wallet-server/migrations/d1-signer',
    Date.now(),
  );
  const options = {
    database,
    namespace: 'sponsored-owner',
    orgId: 'org',
    projectId: 'project',
    envId: 'dev',
    relayerAccount: 'relayer.testnet',
    relayerPublicKey: publicKey,
    relayerPrivateKey: secret,
    nearRpcUrl: `http://127.0.0.1:${rpc.address().port}`,
    accountInitialBalance: '1',
  };
  const input = {
    walletId: walletId('wallet-a'),
    accountId: 'owned.relayer.testnet',
    publicKey,
    idempotencyKey: 'registration-operation',
  };
  const first = await api.createSponsoredNamedNearAccountForOptions(options, input);
  assert.equal(first.kind, 'retryable', JSON.stringify(first));
  assert.ok(
    sqlite.prepare('SELECT 1 FROM router_ab_yao_versioned_json_records').get(),
    JSON.stringify(first),
  );
  const claim = readEffect();
  assert.equal(claim.kind, 'router_ab_ed25519_yao_registration_side_effect_claim_v1');
  assert.equal(claim.prepared.walletId, input.walletId);
  const signedBytes = claim.prepared.transaction.signedTransactionBorshB64u;
  assert.ok(signedBytes.length > 0);
  const callsBeforeConflict = requests.length;
  const conflict = await api.createSponsoredNamedNearAccountForOptions(options, {
    walletId: walletId('wallet-b'),
    accountId: input.accountId,
    publicKey,
    idempotencyKey: input.idempotencyKey,
  });
  assert.equal(conflict.kind, 'rejected');
  assert.equal(requests.length, callsBeforeConflict, 'Cross-wallet retry must make no RPC calls');
  assert.deepEqual(readEffect(), claim);
  await delay(Math.max(0, claim.claimedAtMs + 30_001 - Date.now()));
  settledTransactionHash = claim.prepared.transaction.transactionHash;
  const broadcastsBeforeResume = requests.filter(isBroadcast).length;
  const resumed = await api.createSponsoredNamedNearAccountForOptions(options, input);
  assert.equal(resumed.kind, 'created', JSON.stringify(resumed));
  assert.equal(resumed.transactionHash, settledTransactionHash);
  const completed = readEffect();
  assert.equal(completed.kind, 'router_ab_ed25519_yao_registration_side_effect_completion_v1');
  assert.equal(completed.prepared.walletId, input.walletId);
  assert.equal(completed.prepared.transaction.signedTransactionBorshB64u, signedBytes);
  assert.equal(requests.filter(isBroadcast).length, broadcastsBeforeResume);
  const callsBeforeReplay = requests.length;
  assert.deepEqual(await api.createSponsoredNamedNearAccountForOptions(options, input), resumed);
  assert.equal(requests.length, callsBeforeReplay);
  await writeFile(
    `${output}/evidence.json`,
    JSON.stringify(
      {
        pendingOwner: claim.prepared.walletId,
        terminalOwner: completed.prepared.walletId,
        crossWalletConflictBeforeRpc: true,
        resumedWithoutRebroadcast: true,
        exactReplayWithoutRpc: true,
        signedBytesSha256: createHash('sha256').update(signedBytes).digest('hex'),
        requests,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: wallet-owned sponsorship survives uncertain broadcast, rejects cross-wallet retry, and reconciles exact bytes',
  );
} finally {
  sqlite.close();
  rpc.closeAllConnections();
  rpc.close();
  await once(rpc, 'close');
}

function walletId(value) {
  const parsed = api.parseWalletId(value);
  assert.equal(parsed.ok, true);
  return parsed.value;
}

function readEffect() {
  const row = sqlite.prepare('SELECT record_json FROM router_ab_yao_versioned_json_records').get();
  assert.ok(row);
  return JSON.parse(row.record_json);
}

function isBroadcast(method) {
  return method === 'send_tx' || method === 'broadcast_tx_commit';
}

async function handleRpc(request, response) {
  let body = '';
  for await (const part of request) body += part;
  const call = JSON.parse(body);
  requests.push(call.method);
  let result;
  if (call.method === 'block') result = { header: { hash: blockHash, height: 1 } };
  else if (call.method === 'query' && call.params.request_type === 'view_access_key') {
    result = { nonce: 1, permission: 'FullAccess', block_height: 1, block_hash: blockHash };
  } else if (call.method === 'EXPERIMENTAL_tx_status' && settledTransactionHash) {
    result = successfulOutcome(settledTransactionHash);
  } else {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ error: 'simulated lost broadcast reply and unavailable readback' }),
    );
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
}

function successfulOutcome(hash) {
  return {
    final_execution_status: 'FINAL',
    status: { SuccessValue: '' },
    transaction: { hash },
    transaction_outcome: {
      id: hash,
      outcome: {
        logs: [],
        receipt_ids: [],
        gas_burnt: 0,
        tokens_burnt: '0',
        executor_id: 'relayer.testnet',
        status: { SuccessValue: '' },
      },
    },
    receipts_outcome: [],
  };
}
