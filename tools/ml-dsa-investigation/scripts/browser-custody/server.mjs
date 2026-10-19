import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const require = createRequire(resolve(ROOT, 'packages/wallet/package.json'));
const { build } = require('esbuild');
const execute = promisify(execFile);
const BINARY = resolve(ROOT, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation');
const out = process.argv[2];
assert(out, 'Supply an evidence JSON path');
const temporary = await mkdtemp(resolve(tmpdir(), 'ml-dsa-browser-'));
const schedules = resolve(temporary, 'schedules');
const cases = new Map();
const reports = [];
const wasmDirectory = resolve(ROOT, 'wasm/wallet_custody_ceremony/pkg');
const assets = new Map([
  [
    '/wasm/wallet_custody_ceremony_bg.wasm',
    resolve(wasmDirectory, 'wallet_custody_ceremony_bg.wasm'),
  ],
  [
    '/wasm/wasm_signer_worker_bg.wasm',
    resolve(ROOT, 'wasm/near_signer/pkg/wasm_signer_worker_bg.wasm'),
  ],
  [
    '/wasm/router_ab_ed25519_yao_client_bg.wasm',
    resolve(ROOT, 'crates/router-ab-ed25519-yao-client/pkg/router_ab_ed25519_yao_client_bg.wasm'),
  ],
  ['/browser.mjs', resolve(HERE, 'browser.mjs')],
]);

await execute(BINARY, ['export-custody-schedules', schedules], { timeout: 120_000 });
const bootstrap = `import { WasmMlDsaCeremonyPreparedV1, WasmMlDsaCeremonyVerifiedV1 } from ${JSON.stringify(resolve(wasmDirectory, 'wallet_custody_ceremony.js'))};
import ${JSON.stringify(resolve(ROOT, 'packages/wallet/src/core/signingEngine/workerManager/workers/wallet-custody-ceremony.worker.ts'))};
let preparedFreed = 0;
let verifiedFreed = 0;
const preparedFree = WasmMlDsaCeremonyPreparedV1.prototype.free;
const verifiedFree = WasmMlDsaCeremonyVerifiedV1.prototype.free;
function freePrepared() { preparedFreed += 1; preparedFree.call(this); }
function freeVerified() { verifiedFreed += 1; verifiedFree.call(this); }
WasmMlDsaCeremonyPreparedV1.prototype.free = freePrepared;
WasmMlDsaCeremonyVerifiedV1.prototype.free = freeVerified;
const handler = self.onmessage;
function fixtureMessage(event) {
  if (event.data.type === 'fixtureLifetime') {
    self.postMessage({ id: event.data.id, ok: true, result: { preparedFreed, verifiedFreed } });
  } else { handler(event); }
}
self.onmessage = fixtureMessage;
`;
const workerPath = resolve(temporary, 'custody-worker.js');
await build({
  stdin: { contents: bootstrap, resolveDir: ROOT, sourcefile: 'ml-dsa-browser-fixture.js' },
  outfile: workerPath,
  bundle: true,
  ignoreAnnotations: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  tsconfig: resolve(ROOT, 'packages/wallet/tsconfig.json'),
  banner: { js: 'self.WASM_BASE_URL = new URL("/wasm/", self.location.href).href;' },
});
assets.set('/custody-worker.js', workerPath);
const driverPath = resolve(temporary, 'custody-driver.js');
await build({
  entryPoints: [
    resolve(ROOT, 'packages/wallet/src/core/signingEngine/walletCustody/ceremonyDriver.ts'),
  ],
  outfile: driverPath,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  tsconfig: resolve(ROOT, 'packages/wallet/tsconfig.json'),
});
assets.set('/custody-driver.js', driverPath);
const server = createServer(handleRequest);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
console.log(`ML-DSA browser E2E: http://127.0.0.1:${server.address().port}`);
const deadline = setTimeout(abort, 900_000);

function collectError(chunks, chunk) {
  chunks.push(chunk);
}
function ignorePipeClose(error) {
  if (error.code !== 'EPIPE') throw error;
}
function stopPair(a, b) {
  a.kill();
  b.kill();
}
async function duplex(argsA, argsB) {
  const a = spawn(BINARY, argsA, { stdio: ['pipe', 'pipe', 'pipe'] });
  const b = spawn(BINARY, argsB, { stdio: ['pipe', 'pipe', 'pipe'] });
  const errors = [];
  a.stderr.on('data', collectError.bind(null, errors));
  b.stderr.on('data', collectError.bind(null, errors));
  a.stdin.on('error', ignorePipeClose);
  b.stdin.on('error', ignorePipeClose);
  const exits = Promise.all([once(a, 'exit'), once(b, 'exit')]);
  a.stdout.pipe(b.stdin);
  b.stdout.pipe(a.stdin);
  const timer = setTimeout(stopPair, 240_000, a, b);
  try {
    const results = await exits;
    for (const [code] of results) assert.equal(code, 0, Buffer.concat(errors).toString());
  } finally {
    clearTimeout(timer);
    stopPair(a, b);
  }
}
async function jsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
async function privateJson(path, value) {
  await writeFile(path, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
}
function holderKey() {
  const pair = generateKeyPairSync('x25519');
  const secret = pair.privateKey.export({ format: 'jwk' });
  return { secret: Buffer.from(secret.d, 'base64url'), public: secret.x };
}
function fixture() {
  assert(cases.size < 32, 'Fixture budget exhausted');
  const id = randomBytes(16).toString('hex');
  const holders = [holderKey(), holderKey()];
  const protocol = {
    walletId: 'ml-dsa-browser-wallet',
    signingKeyId: 'near-key-1',
    operationIdB64u: randomBytes(32).toString('base64url'),
    materialEpoch: cases.size,
    roleAPublicKeyB64u: holders[0].public,
    roleBPublicKeyB64u: holders[1].public,
    continuity: { kind: 'create' },
  };
  cases.set(id, { phase: 'prepared', holders, protocol, directory: resolve(temporary, id) });
  return { id, protocol };
}
async function executeRoles(body) {
  const current = cases.get(body.id);
  assert(current && current.phase === 'prepared', 'Fixture already consumed or absent');
  current.phase = 'executing';
  const dispatch = JSON.parse(body.roleInputsJson);
  assert.equal(dispatch.binding.wallet_id, current.protocol.walletId);
  assert.equal(dispatch.binding.signing_key_id, current.protocol.signingKeyId);
  assert.equal(
    Buffer.from(dispatch.binding.operation_id).toString('base64url'),
    current.protocol.operationIdB64u,
  );
  assert.equal(dispatch.binding.material_epoch, current.protocol.materialEpoch);
  const own = [];
  for (const [index, role] of ['a', 'b'].entries()) {
    const directory = resolve(current.directory, role);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const input = resolve(directory, 'input.json');
    const result = resolve(directory, 'result.json');
    await privateJson(input, {
      kind: 'sealed-wallet-owner-root',
      binding: dispatch.binding,
      sealed_input: role === 'a' ? dispatch.roleA : dispatch.roleB,
      holder_secret: [...current.holders[index].secret],
    });
    own.push({ input, result, material: resolve(directory, 'sealed-test-material.json') });
  }
  await duplex(
    ['private-keygen-role-a', schedules, own[0].input, own[0].result, 'half-gates'],
    ['private-keygen-role-b', schedules, own[1].input, own[1].result, 'half-gates'],
  );
  const a = await jsonFile(own[0].result);
  const b = await jsonFile(own[1].result);
  assert.equal(a.public_key_hex, b.public_key_hex);
  const publicPath = resolve(current.directory, 'public-key.bin');
  await writeFile(publicPath, Buffer.from(a.public_key_hex, 'hex'));
  const operation = {
    operation_id: [...randomBytes(32)],
    engine: 'half-gates',
    message: [...Buffer.alloc(32, 0x5a)],
    context: [],
    randomness: 'deterministic',
  };
  const operationPath = resolve(current.directory, 'operation.json');
  await privateJson(operationPath, operation);
  const signA = resolve(current.directory, 'sign-a.json');
  const signB = resolve(current.directory, 'sign-b.json');
  await duplex(
    ['private-signing-role-a', schedules, own[0].material, publicPath, operationPath, signA],
    ['private-signing-role-b', schedules, own[1].material, publicPath, operationPath, signB],
  );
  const signedA = await jsonFile(signA);
  const signedB = await jsonFile(signB);
  assert.equal(signedA.signature_hex, signedB.signature_hex);
  const signingReport = resolve(current.directory, 'signing.json');
  await writeFile(
    signingReport,
    JSON.stringify({
      signature_hex: signedA.signature_hex,
      message_hex: Buffer.from(operation.message).toString('hex'),
      context_hex: '',
      randomness: 'deterministic',
    }),
  );
  Object.assign(current, {
    phase: 'signed',
    own,
    publicPath,
    signingReport,
    publicKeyHex: a.public_key_hex,
    attempts: signedA.attempts,
  });
  return {
    resultsJson: JSON.stringify({ roleA: a.sealed_keygen_result, roleB: b.sealed_keygen_result }),
    publicKeyB64u: Buffer.from(a.public_key_hex, 'hex').toString('base64url'),
    attempts: signedA.attempts,
  };
}
async function verifyExport(body) {
  const current = cases.get(body.id);
  assert(current && current.phase === 'signed', 'No completed signing operation');
  assert.equal(
    body.commit.key.publicKeyB64u,
    Buffer.from(current.publicKeyHex, 'hex').toString('base64url'),
  );
  const output = resolve(current.directory, 'authorized-export.json');
  await execute(
    BINARY,
    [
      'private-keygen-authorized-test-recipient',
      current.own[0].material,
      current.own[1].material,
      current.publicPath,
      current.signingReport,
      output,
    ],
    { timeout: 120_000 },
  );
  const recovery = await jsonFile(output);
  assert.equal(recovery.canonical_recovery_public_key_matches, true);
  current.phase = 'verified';
  reports.push({
    fixture_id: body.id,
    commit: body.commit,
    signing_candidates: current.attempts,
    authorized_export_after_signing: recovery,
  });
  return { verified: true };
}
async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    assert(length <= 1_000_000, 'Oversize fixture request');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function send(response, status, value, type = 'application/json') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(type === 'application/json' ? JSON.stringify(value) : value);
}
async function identity(path) {
  const body = await readFile(path);
  return { path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
}
async function record(body) {
  assert.equal(reports.length, 3, 'Establishment, recovery, and joining must all complete');
  for (const report of reports) {
    assert.equal(reports[0].commit.key.publicKeyB64u, report.commit.key.publicKeyB64u);
    assert.equal(
      reports[0].authorized_export_after_signing.public_test_seed_hex,
      report.authorized_export_after_signing.public_test_seed_hex,
    );
  }
  const sources = [];
  for (const path of [
    'wasm/wallet_custody_ceremony/src/ml_dsa_wasm.rs',
    'wasm/wallet_custody_ceremony/src/wasm.rs',
    'wasm/wallet_custody_ceremony/src/ml_dsa.rs',
    'crates/signer-core/src/ml_dsa_custody.rs',
    'packages/wallet/src/core/signingEngine/workerManager/workers/wallet-custody-ceremony.worker.ts',
    'packages/wallet/src/core/signingEngine/workerManager/walletCustodyWorkerChannels.ts',
    'packages/shared-ts/src/passkey-custody/mlDsaCustody.ts',
    'packages/wallet/src/core/signingEngine/walletCustody/ceremonyDriver.ts',
    'packages/wallet/src/core/signingEngine/walletCustody/ceremonyDriver.typecheck.ts',
    'tools/ml-dsa-investigation/scripts/browser-custody/server.mjs',
    'tools/ml-dsa-investigation/scripts/browser-custody/browser.mjs',
  ])
    sources.push(await identity(resolve(ROOT, path)));
  const artifacts = [
    await identity(BINARY),
    await identity(workerPath),
    await identity(driverPath),
  ];
  for (const name of ['wallet_custody_ceremony.js', 'wallet_custody_ceremony_bg.wasm'])
    artifacts.push(await identity(resolve(wasmDirectory, name)));
  const scheduleManifest = await jsonFile(resolve(schedules, 'schedule-manifest.json'));
  for (const value of cases.values()) for (const holder of value.holders) holder.secret.fill(0);
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    resolve(ROOT, out),
    JSON.stringify(
      {
        schema: 'seams.ml-dsa-browser-custody-e2e.v1',
        created_at: new Date().toISOString(),
        browser: body.browser,
        checks: body.checks,
        cases: reports,
        sources,
        artifacts,
        schedule_manifest: scheduleManifest,
        temporary_role_files_removed: true,
        production_eligible: false,
        scope:
          'Chromium runs the SDK custody driver, actual worker, and browser-target Wasm. Separate native A/B processes generate and sign. Establishment, recovery, and joining preserve the ordinary canonical key and export. This does not exercise public Gateway admission, device enrollment, durable custody publication, or public signing routes.',
      },
      null,
      2,
    ) + '\n',
  );
}
async function handleRequest(request, response) {
  try {
    const path = new URL(request.url, 'http://fixture').pathname;
    if (request.method === 'GET' && path === '/')
      return send(
        response,
        200,
        '<!doctype html><title>ML-DSA browser custody E2E</title><button id="run">Run custody E2E</button><pre id="status">Ready</pre><script type="module" src="/browser.mjs"></script>',
        'text/html',
      );
    if (request.method === 'GET' && assets.has(path))
      return send(
        response,
        200,
        await readFile(assets.get(path)),
        path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      );
    if (request.method === 'POST' && path === '/fixture') return send(response, 200, fixture());
    if (request.method === 'POST' && path === '/execute')
      return send(response, 200, await executeRoles(await readBody(request)));
    if (request.method === 'POST' && path === '/verify-export')
      return send(response, 200, await verifyExport(await readBody(request)));
    if (request.method === 'POST' && path === '/record') {
      await record(await readBody(request));
      send(response, 200, { saved: true });
      clearTimeout(deadline);
      server.close();
      server.closeIdleConnections();
      console.log(`Saved ${out}`);
      return;
    }
    send(response, 404, { error: 'Unknown fixture route' });
  } catch (error) {
    console.error(error.message);
    send(response, 500, { error: error.message });
  }
}
async function abort() {
  clearTimeout(deadline);
  await rm(temporary, { recursive: true, force: true });
  server.close();
  server.closeAllConnections();
  process.exitCode = 1;
}
process.on('SIGTERM', abort);
