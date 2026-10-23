import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { credentialKey, assertion } from '../helpers/mlDsaGatewayRegistration.e2e.mjs';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(process.argv[2]);
const artifact = resolve(process.argv[3]);
const deployment = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
assert.equal(new URL(deployment.gatewayUrl).protocol, 'https:');
const secrets = JSON.parse(await readFile(join(directory, 'gateway-secrets.json'), 'utf8'));
const origin = 'https://wallet.example.test';
const rpcUrl = 'https://rpc.testnet.near.org';
const binary = join(root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation');
const report = {
  observedAt: new Date().toISOString(),
  fixtureOnly: true,
  productionEligible: false,
  scope:
    'Browser advanced SDK and real WebAuthn against hosted Gateway/D1/Router/A/B/preparers. Existing owner records are fixture-seeded; native custody opens the fixed public zero seed. Testnet self-transfers use faucet tokens.',
  deployment,
  requests: [],
  samples: [],
  result: 'incomplete',
};
const key = credentialKey();
const walletId = `ml-dsa-qualification-${randomBytes(8).toString('hex')}`;
const accountId = `ml-dsa-pub-${randomBytes(8).toString('hex')}.testnet`;
const signingKeyId = 'near-ml-dsa-65:1';
let native;
let server;
let config;
let api;
let localUrl;
let initialCustody;
const checkpoints = new Map();
let busy = false;

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
async function save() {
  await mkdir(resolve(artifact, '..'), { recursive: true });
  await writeFile(artifact, JSON.stringify(report, null, 2) + '\n');
}
async function post(url, body, headers = {}) {
  const target = String(url);
  const entry = { url: target, request: body, startedAt: new Date().toISOString() };
  // Assertion payloads are transient authorization; retain their hashes only.
  if (target.includes('/signers/start'))
    entry.request = {
      walletId,
      assertionSha256: hash(Buffer.from(JSON.stringify(body.auth.credential))),
    };
  report.requests.push(entry);
  await save();
  const started = performance.now();
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  entry.status = response.status;
  entry.elapsedMs = performance.now() - started;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    entry.responseText = text;
    await save();
    throw new Error(`Non-JSON qualification response: ${target} (${response.status})`);
  }
  entry.response = target.endsWith('/fixture/owner')
    ? { owner: raw.owner, intentDigestB64u: raw.intent?.addSignerIntentDigestB64u }
    : raw;
  await save();
  assert.ok(response.ok, JSON.stringify({ url, status: response.status, raw }));
  return raw;
}
async function fixture(path, body) {
  return post(new URL(path, deployment.gatewayUrl), body, {
    'X-ML-DSA-Test-Token': secrets.PROBE_TOKEN,
  });
}
async function gateway(path, body) {
  return post(new URL(path, deployment.gatewayUrl), body, {
    Origin: origin,
    ...managementProtocol,
  });
}
async function rpc(method, params) {
  return post(rpcUrl, { jsonrpc: '2.0', id: 'ml-dsa-public-qualification', method, params });
}
async function next() {
  const line = await native.lines.next();
  assert.equal(line.done, false, 'Native custody client ended early');
  return JSON.parse(line.value);
}
const managementProtocol = {};
async function setup() {
  const nodeBundle = join(directory, 'gateway-fixture-api.mjs');
  await build({
    entryPoints: [join(root, 'tests/helpers/mlDsaGatewayRegistration.fixtures.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    mainFields: ['module', 'main'],
    loader: { '.wasm': 'file' },
    tsconfig: join(root, 'packages/wallet/tsconfig.json'),
    outfile: nodeBundle,
  });
  api = await import(pathToFileURL(nodeBundle).href);
  managementProtocol[api.WALLET_MANAGEMENT_PROTOCOL_HEADER] =
    api.WALLET_MANAGEMENT_PROTOCOL_VERSION;
  const owner = await api.gatewayOwner({
    walletId,
    credentialIdB64u: key.credentialId,
    credentialPublicKeyB64u: key.publicKey,
    label: walletId,
  });
  const source = join(directory, 'native-source.json');
  await writeFile(
    source,
    JSON.stringify({
      wallet_id: walletId,
      wallet_auth_method_id: owner.authMethod.walletAuthMethodId,
      rp_id: 'wallet.example.test',
      credential_id_b64u: key.credentialId,
    }),
    { mode: 0o600 },
  );
  const child = spawn(binary, ['gateway-registration-client', source], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  native = {
    process: child,
    lines: createInterface({ input: child.stdout })[Symbol.asyncIterator](),
  };
  const ready = await next();
  assert.equal(ready.ready, true);
  report.walletId = walletId;
  const prepareStarted = performance.now();
  const prepared = await fixture('/fixture/prepare', { walletId });
  assert.equal(prepared.ready, true);
  report.preparationMs = performance.now() - prepareStarted;
  const seeded = await fixture('/fixture/owner', {
    walletId,
    credentialIdB64u: key.credentialId,
    credentialPublicKeyB64u: key.publicKey,
    custody: ready,
  });
  assert.equal(seeded.intent.ok, true, JSON.stringify(seeded));
  initialCustody = await fixture('/fixture/state', { walletId });
  assert.equal(initialCustody.custodyRows, 2);
  const issued = seeded.intent;
  const onlineStart = performance.now();
  const started = await gateway(`/wallets/${walletId}/signers/start`, {
    addSignerIntentGrant: issued.addSignerIntentGrant,
    addSignerIntentDigestB64u: issued.addSignerIntentDigestB64u,
    intent: issued.intent,
    auth: {
      kind: 'webauthn_assertion',
      rpId: 'wallet.example.test',
      credential: assertion(key, issued.addSignerIntentDigestB64u),
      expectedChallengeDigestB64u: issued.addSignerIntentDigestB64u,
    },
  });
  const parsed = api.parseWalletAddSignerStartResponse({
    value: started,
    expectedIntent: issued.intent,
  });
  assert.equal(parsed.kind, 'near_ml_dsa_65');
  const context = parsed.mlDsa.protocolInputs;
  native.process.stdin.write(
    JSON.stringify({
      signing_key_id: context.signingKeyId,
      operation: Array.from(Buffer.from(context.operationIdB64u, 'base64url')),
      epoch: context.materialEpoch,
      continuity: { kind: 'create' },
      holder_public_keys: [
        Array.from(Buffer.from(context.roleAPublicKeyB64u, 'base64url')),
        Array.from(Buffer.from(context.roleBPublicKeyB64u, 'base64url')),
      ],
    }) + '\n',
  );
  const inputs = await next();
  const executed = await gateway(`/wallets/${walletId}/signers/ml-dsa/execute`, {
    addSignerCeremonyId: started.addSignerCeremonyId,
    encryptedInputs: inputs.inputs,
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  native.process.stdin.write(executed.protocolResultJson + '\n');
  const complete = await next();
  assert.equal(complete.canonicalKeyVerified, true);
  assert.equal(complete.holderResultsAuthenticated, true);
  const published = await gateway(`/wallets/${walletId}/signers/ml-dsa/publish`, {
    addSignerCeremonyId: started.addSignerCeremonyId,
    custodyCommit: complete.commit,
  });
  assert.equal(published.ok, true, JSON.stringify(published));
  report.registrationOnlineMs = performance.now() - onlineStart;
  report.publication = published;
  config = {
    gatewayUrl: deployment.gatewayUrl,
    publicKeyB64u: published.key.publicKeyB64u,
    walletId,
    signingKeyId,
    credentialIdB64u: key.credentialId,
  };
  const status = await rpc('status', []);
  assert.equal(status.result.chain_id, 'testnet');
  const protocol = await rpc('EXPERIMENTAL_protocol_config', { finality: 'final' });
  assert.ok(protocol.result.protocol_version >= 85);
  report.protocolVersion = protocol.result.protocol_version;
  const publicKey = 'ml-dsa-65:' + api.base58Encode(Buffer.from(config.publicKeyB64u, 'base64url'));
  report.accountId = accountId;
  report.publicKey = publicKey;
  const enrolled = await post('https://helper.testnet.near.org/account', {
    newAccountId: accountId,
    newAccountPublicKey: publicKey,
  });
  assert.ok('SuccessValue' in enrolled.status, JSON.stringify(enrolled));
  const final = await rpc('tx', {
    tx_hash: enrolled.transaction.hash,
    sender_account_id: enrolled.transaction.signer_id,
    wait_until: 'FINAL',
  });
  assert.ok('SuccessValue' in final.result.status);
  await build({
    entryPoints: [join(root, 'tests/helpers/mlDsaBrowserSigning.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: join(root, 'packages/wallet/tsconfig.json'),
    outfile: join(directory, 'browser-signing.mjs'),
  });
  server = createServer(handleRequest);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  localUrl = `http://127.0.0.1:${server.address().port}`;
  await writeFile(join(directory, 'browser-control.json'), JSON.stringify({ localUrl, origin }), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      stage: 'browser-ready',
      localUrl,
      origin,
      artifact,
      registrationOnlineMs: report.registrationOnlineMs,
      preparationMs: report.preparationMs,
    }),
  );
}
async function transaction() {
  const current = await rpc('query', {
    request_type: 'view_access_key',
    account_id: accountId,
    public_key: report.publicKey,
    finality: 'final',
  });
  assert.ok(current.result, JSON.stringify(current));
  assert.ok(Number.isSafeInteger(current.result.nonce));
  native.process.stdin.write(
    JSON.stringify({
      signerId: accountId,
      nonce: (BigInt(current.result.nonce) + 1n).toString(),
      blockHash: current.result.block_hash,
    }) + '\n',
  );
  return next();
}
async function body(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    assert.ok(length <= 100_000);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function respond(response, status, value, type = 'application/json') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(type === 'application/json' ? JSON.stringify(value) : value);
}
async function complete(input) {
  assert.equal(input.samples.length, 3);
  report.browser = input.browser;
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
      Buffer.from(config.publicKeyB64u, 'base64url'),
    ]),
    type: 'spki',
    format: 'der',
  });
  for (const sample of input.samples) {
    const checkpoint = checkpoints.get(sample.operationIdB64u);
    assert.ok(checkpoint);
    assert.equal(checkpoint.transaction.signatureB64u, sample.transaction.signatureB64u);
    assert.equal(
      verify(
        null,
        Buffer.from(checkpoint.inspection.transactionHashB64u, 'base64url'),
        publicKey,
        Buffer.from(sample.transaction.signatureB64u, 'base64url'),
      ),
      true,
    );
    const result = await rpc('tx', {
      tx_hash: sample.transaction.transactionHash,
      sender_account_id: accountId,
      wait_until: 'FINAL',
    });
    assert.equal(result.result.final_execution_status, 'FINAL');
    assert.ok('SuccessValue' in result.result.status);
    assert.ok(result.result.receipts_outcome.length > 0);
    assert.equal(result.result.transaction.hash, sample.transaction.transactionHash);
    assert.equal(result.result.transaction.public_key, report.publicKey);
    assert.equal(result.result.transaction.signer_id, accountId);
    assert.equal(result.result.transaction.receiver_id, accountId);
    assert.deepEqual(result.result.transaction.actions, [{ Transfer: { deposit: '1' } }]);
    report.samples.push({ ...sample, finalized: true, independentlyVerified: true });
    await save();
  }
  const state = await fixture('/fixture/state', { walletId });
  assert.equal(state.custodyDigest, initialCustody.custodyDigest);
  assert.equal(state.operations.length, 3);
  assert.ok(state.operations.every(completedOperation));
  report.custodyAndClaimsVerified = true;
  report.sources = {};
  for (const file of [
    'tests/helpers/mlDsaQualificationWorker.ts',
    'tests/helpers/mlDsaBrowserSigning.ts',
    'tests/e2e/ml-dsa-browser-worker.e2e.mjs',
    'packages/wallet/src/core/rpcClients/relayer/mlDsaSigning.ts',
    'packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletMlDsaSigning.ts',
    'tools/ml-dsa-investigation/src/gateway_registration_client.rs',
  ])
    report.sources[file] = hash(await readFile(join(root, file)));
  report.binaries = {
    signerWasm: hash(await readFile(join(root, 'wasm/near_signer/pkg-ml-dsa/ml_dsa_signer_bg.wasm'))),
    native: hash(await readFile(binary)),
    browserBundle: hash(await readFile(join(directory, 'browser-signing.mjs'))),
  };
  report.result = 'passed';
  await save();
  console.log(
    JSON.stringify({
      stage: 'complete',
      result: report.result,
      samples: report.samples.map(timing),
    }),
  );
  return { passed: true };
}
function completedOperation(operation) {
  return operation.lifecycle_kind === 'completed' && operation.result_kind === 'succeeded';
}
function timing(sample) {
  return {
    signingMs: sample.signingMs,
    retries: sample.retries.length,
    transactionHash: sample.transaction.transactionHash,
  };
}
async function handleRequest(request, response) {
  try {
    const path = new URL(request.url, localUrl).pathname;
    if (path === '/' && request.method === 'GET')
      return respond(
        response,
        200,
        '<!doctype html><title>ML-DSA public qualification</title><h1>ML-DSA public qualification</h1><p>Disposable testnet wallet. Three one-yocto self-transfers, one minute apart.</p><button id="run">Run qualification</button><pre id="status">Ready</pre><pre id="display"></pre><script type="module" src="/browser-signing.mjs"></script>',
        'text/html',
      );
    if (path === '/browser-signing.mjs')
      return respond(
        response,
        200,
        await readFile(join(directory, 'browser-signing.mjs')),
        'text/javascript',
      );
    if (path === '/wasm/ml_dsa_signer_bg.wasm')
      return respond(
        response,
        200,
        await readFile(join(root, 'wasm/near_signer/pkg-ml-dsa/ml_dsa_signer_bg.wasm')),
        'application/wasm',
      );
    if (path === '/driver/passkey')
      return respond(response, 200, {
        credentialId: Buffer.from(key.credentialId, 'base64url').toString('base64'),
        isResidentCredential: false,
        rpId: 'wallet.example.test',
        privateKey: key.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
        signCount: 0,
      });
    if (path === '/fixture/config') return respond(response, 200, config);
    if (path === '/fixture/checkpoint') {
      const checkpoint = await body(request);
      checkpoints.set(checkpoint.operationIdB64u, checkpoint);
      report.checkpoints = [...checkpoints.values()];
      await save();
      return respond(response, 200, { recorded: true });
    }
    if (path === '/fixture/failure') {
      report.browserFailure = await body(request);
      report.result = 'failed';
      await save();
      console.error(JSON.stringify(report.browserFailure));
      return respond(response, 200, { recorded: true });
    }
    assert.equal(request.method, 'POST');
    assert.equal(busy, false, 'A fixture operation is already running');
    busy = true;
    try {
      if (path === '/fixture/transaction') return respond(response, 200, await transaction());
      if (path === '/fixture/complete')
        return respond(response, 200, await complete(await body(request)));
      return respond(response, 404, { error: 'Unknown qualification route' });
    } finally {
      busy = false;
    }
  } catch (error) {
    report.serverFailure = String(error);
    await save();
    respond(response, 500, { error: String(error) });
  }
}
function stop() {
  native?.process.kill();
  server?.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  await setup();
  setTimeout(stop, 900_000).unref();
} catch (error) {
  report.result = 'failed';
  report.error = String(error);
  await save();
  stop();
  throw error;
}
