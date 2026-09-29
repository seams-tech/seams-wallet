import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { DatabaseSync } from 'node:sqlite';

const root = '.artifacts/r150/admission-policy';
await mkdir(root, { recursive: true });
const migration = await readFile('packages/wallet-server/migrations/d1-signer/0001_signer_d1_initial.sql', 'utf8');
const schema = /CREATE TABLE router_ab_normal_signing_admission_records \([\s\S]*?\n\);/u.exec(migration)?.[0];
assert.ok(schema);
const options = {
  bundle: true, format: 'esm', platform: 'neutral', write: false,
  tsconfig: 'packages/wallet-server/tsconfig.json', external: ['node:crypto'],
};
const workerBuild = await build({ ...options, entryPoints: ['tests/r150-hosted/gateway/admissionPolicy.fixture.ts'] });
const worker = new Miniflare({
  modules: true, script: workerBuild.outputFiles[0].text,
  compatibilityDate: '2026-04-17', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'],
});
const nodeBuild = await build({
  ...options,
  stdin: {
    contents: `
      export { handlePolicyRequest } from './tests/r150-hosted/gateway/admissionPolicy.fixture';
      export { createSyncSqliteDatabase } from './packages/wallet-server/src/storage/syncSqlite';
      export { nodeSqliteConnection } from './packages/wallet-server/src/router/node/nodeSqlite';
    `,
    resolveDir: process.cwd(), loader: 'ts',
  },
});
await writeFile(`${root}/node-fixture.mjs`, nodeBuild.outputFiles[0].text);
const node = await import(pathToFileURL(`${process.cwd()}/${root}/node-fixture.mjs`));
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(schema);
const vmDatabase = node.createSyncSqliteDatabase(node.nodeSqliteConnection(sqlite));
const evidence = [];
try {
  const d1 = await worker.getD1Database('DB');
  await d1.prepare(schema).run();
  for (const host of ['d1', 'vm', 'memory']) {
    await scenario(host, false);
    await scenario(host, true);
  }
  await worker.dispatchFetch('http://policy/throttle');
  await d1.prepare("UPDATE router_ab_normal_signing_admission_records SET decision = NULL WHERE record_kind = 'abuse'").run();
  await check('d1', '/evaluate', 500, 'invalid_policy', 1);
  await worker.dispatchFetch('http://policy/reject-project');
  await check('d1', '/evaluate', 403, 'project_policy_rejected', 1);
  await writeFile(`${root}/result.json`, JSON.stringify({
    reproduce: 'node tests/r150-hosted/gateway/admissionPolicy.e2e.mjs',
    hosts: ['local_cloudflare_d1', 'vm_sqlite_adapter', 'in_memory'],
    policyPrecedenceAndLiveUpdatesVerified: true,
    missingRowsAllowAndMalformedRowsFailClosed: true,
    evidence,
  }, null, 2));
  console.log(`Admission policy E2E passed; artifact: ${root}/result.json`);
} finally {
  await worker.dispose();
  sqlite.close();
}

async function send(host, route) {
  const url = new URL(route, 'http://policy');
  if (host === 'memory') url.searchParams.set('memory', '1');
  if (host === 'vm') return node.handlePolicyRequest(new Request(url), vmDatabase);
  return worker.dispatchFetch(url.toString());
}

async function check(host, route, status, code, expectedCalls) {
  const response = await send(host, route);
  assert.equal(response.status, status, `${host} ${route}`);
  const body = await response.json();
  assert.equal(body.code ?? body.error ?? 'allowed', code);
  const trace = JSON.parse(response.headers.get('X-Benchmark-D1'));
  assert.equal(trace.pending, 0);
  assert.equal(trace.dropped, 0);
  assert.equal(trace.calls.length, host === 'memory' ? 0 : expectedCalls);
  evidence.push({ host, route, status, code, trace });
}

async function scenario(host, ed25519) {
  const query = ed25519 ? '?ed25519=1' : '?ecdsa=1';
  await check(host, `/evaluate${query}`, 200, 'allowed', 1);
  await send(host, `/throttle${query}`);
  await check(host, `/evaluate${query}`, 429, 'rate_limited', 1);
  await check(host, `/evaluate${query}&other-wallet=1`, 200, 'allowed', 1);
  await send(host, `/reject-project${query}`);
  await check(host, `/evaluate${query}`, 403, 'project_policy_rejected', 1);
  await check(host, `/evaluate${query}&other-wallet=1`, 403, 'project_policy_rejected', 1);
  await check(host, `/evaluate${query}&other-environment=1`, 200, 'allowed', 1);
  await check(host, `/evaluate${query}&other-version=1`, 200, 'allowed', 1);
  if (host !== 'memory') await check(host, `/evaluate${query}&other-namespace=1`, 200, 'allowed', 1);
  await check(host, `/evaluate${query}&expired=1`, 408, 'invalid_body', 0);
  await send(host, `/clear-project${query}`);
  await check(host, `/evaluate${query}`, 429, 'rate_limited', 1);
  await send(host, `/reject-abuse${query}`);
  await check(host, `/evaluate${query}`, 403, 'abuse_rejected', 1);
  await send(host, `/clear-abuse${query}`);
  await check(host, `/evaluate${query}`, 200, 'allowed', 1);
}
