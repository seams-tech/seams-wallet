import assert from 'node:assert/strict';
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Miniflare } from 'miniflare';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(process.argv[2]);
const artifact = resolve(process.argv[3]);
const hostedUrl = process.env.ML_DSA_REGISTRATION_ROUTER_URL;
const gatewayAuth = process.env.ML_DSA_GATEWAY_TOKEN_FILE
  ? (await readFile(process.env.ML_DSA_GATEWAY_TOKEN_FILE, 'utf8')).trim()
  : randomBytes(32).toString('hex');
const serviceAuth = randomBytes(32).toString('hex');
const persistence = await mkdtemp(join(tmpdir(), 'ml-dsa-registration-e2e-'));
const policy = {
  wallet_cooldown: { mode: 'enabled', interval_ms: 60000 },
  max_active_operations: 1,
  operation_timeout_ms: 30000,
  minimum_ready_batches: 2,
  refill_target_batches: 4,
};
const wallet = {
  org: 'registration-e2e',
  project: 'wallet',
  environment: 'temporary',
  wallet: `wallet-${randomBytes(8).toString('hex')}`,
};
const children = [];
const observations = {
  observedAt: new Date().toISOString(),
  wallet,
  scope:
    'Authenticated private Gateway request through real Worker key generation, durable two-role installation, initial signing stock, and client custody verification. Public login and SDK UI are outside this campaign.',
  hosted: Boolean(hostedUrl),
  policy,
  cases: [],
  functionalPassed: false,
  latencyTargetMet: false,
};
observations.builds = Object.fromEntries(
  await Promise.all(['router', 'deriver-a', 'deriver-b'].map(buildHash)),
);
observations.scriptSha256 = createHash('sha256')
  .update(await readFile(import.meta.filename))
  .digest('hex');
let runtime;
let keks;
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let client = await startClient();
  keks = await Promise.all(['a', 'b'].map(readKek));
  if (!hostedUrl) {
    runtime = new Miniflare({ workers: workers(), durableObjectsPersist: persistence });
    await runtime.ready;
  }
  const denied = await raw('/router-ab/ml-dsa/registration/prepare', { wallet }, serviceAuth);
  assert.equal(denied.status, 403);
  observations.wrongCredentialRejected = true;
  let previous;
  let firstRequest;
  for (const epoch of [1, 2]) {
    if (epoch === 2) client = await startClient();
    const continuity =
      epoch === 1
        ? { kind: 'create' }
        : {
            kind: 'recover',
            public_key_digest: previous.a.activation.key.public_key_digest,
            manifest_digest: previous.a.activation.manifest_digest,
          };
    client.process.stdin.write(
      `${JSON.stringify({ wallet, key_id: 'near', epoch, operation: Array.from(randomBytes(32)), continuity })}\n`,
    );
    const payload = await next(client);
    if (epoch === 1) {
      const empty = await post('/router-ab/ml-dsa/register', payload.request);
      assert.equal(empty.status, 'unavailable');
      assert.ok(empty.retry_at_ms > Date.now() - 10000);
      observations.emptyPoolRetryTime = true;
      firstRequest = payload.request;
    }
    const prepareStarted = performance.now();
    const ready = await post('/router-ab/ml-dsa/registration/prepare', { wallet });
    assert.equal(ready.ready, true);
    const preparationMs = performance.now() - prepareStarted;
    const started = performance.now();
    const response = await post('/router-ab/ml-dsa/register', payload.request);
    const serverResponseMs = performance.now() - started;
    assert.equal(response.status, 'existing');
    assert.equal(response.operation.state, 'complete');
    const result = response.operation.result;
    assert.deepEqual(result.a.public_key, payload.expected_public_key);
    assert.deepEqual(result.a.public_key, result.b.public_key);
    client.process.stdin.write(`${JSON.stringify(result)}\n`);
    const checked = await next(client);
    assert.equal(checked.verified, true);
    const registrationWithClientVerificationMs = performance.now() - started;
    assert.deepEqual(await post('/router-ab/ml-dsa/register', payload.request), response);
    const changed = structuredClone(payload.request);
    changed.epoch += 1;
    const replay = await raw('/router-ab/ml-dsa/register', changed, gatewayAuth);
    assert.notEqual(replay.status, 200);
    if (previous) assert.deepEqual(result.a.public_key, previous.a.public_key);
    const signed = await sign(result);
    observations.cases.push({
      epoch,
      preparationMs,
      serverResponseMs,
      registrationWithClientVerificationMs,
      underFiveSeconds: registrationWithClientVerificationMs < 5000,
      canonicalKeyVerified: true,
      holderResultsAuthenticated: true,
      manifestVerified: true,
      exactReplay: true,
      changedReplayRejected: true,
      initialStockSign: signed,
      publicKeyHex: Buffer.from(result.a.public_key).toString('hex'),
    });
    previous = result;
    if (!hostedUrl && epoch === 1) {
      await runtime.dispose();
      runtime = new Miniflare({ workers: workers(), durableObjectsPersist: persistence });
      await runtime.ready;
      assert.deepEqual(await post('/router-ab/ml-dsa/register', firstRequest), response);
      observations.registrationSurvivesRestart = true;
    }
  }
  observations.recoveryPreservesCanonicalKey = true;
  observations.functionalPassed = true;
  observations.latencyTargetMet = observations.cases.every(meetsLatencyTarget);
} catch (error) {
  observations.error = String(error);
  throw error;
} finally {
  for (const child of children) child.kill();
  await runtime?.dispose();
  await mkdir(resolve(artifact, '..'), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(observations, null, 2)}\n`);
  await rm(persistence, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      artifact,
      functionalPassed: observations.functionalPassed,
      latencyTargetMet: observations.latencyTargetMet,
      cases: observations.cases.map(caseSummary),
    }),
  );
}
async function startClient() {
  const process = spawn(
    join(root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation'),
    ['worker-registration-client', directory],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  children.push(process);
  const lines = createInterface({ input: process.stdout })[Symbol.asyncIterator]();
  const client = { process, lines };
  assert.equal((await next(client)).ready, true);
  return client;
}
async function next(client) {
  const line = await client.lines.next();
  assert.equal(line.done, false, 'Native custody verifier ended early');
  return JSON.parse(line.value);
}
async function readKek(role) {
  return readFile(join(directory, `${role}-kek`), 'utf8');
}
function base(name, build, extra) {
  return {
    name,
    modules: true,
    scriptPath: join(root, 'crates/router-ab-cloudflare/build', build, 'worker/shim.mjs'),
    modulesRoot: root,
    modulesRules: [
      { type: 'ESModule', include: ['**/*.js', '**/*.mjs'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'] },
    ],
    compatibilityDate: '2026-06-12',
    bindings: {
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING: 'INTERNAL_AUTH',
      INTERNAL_AUTH: serviceAuth,
      ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: gatewayAuth,
      ML_DSA_ADMISSION_POLICY: JSON.stringify(policy),
      ...extra,
    },
  };
}
function workers() {
  return [
    {
      ...base('router', 'router', {}),
      durableObjects: {
        ML_DSA_ADMISSION_DO: { className: 'RouterAbMlDsaAdmissionDurableObject', useSQLite: true },
      },
      serviceBindings: { DERIVER_A: 'a', DERIVER_B: 'b' },
    },
    role('a', 0),
    role('b', 1),
  ];
}
function role(name, index) {
  return {
    ...base(name, `deriver-${name}`, {
      DERIVER_ROLE_PRIVATE_D1_ROLE: `deriver_${name}`,
      DERIVER_ROLE_PRIVATE_D1_KEK_BINDING: 'ROLE_KEK',
      ROLE_KEK: keks[index],
      DERIVER_ROLE_PRIVATE_D1_KEK_VERSION: 'registration-e2e',
    }),
    durableObjects: {
      ML_DSA_POOL_DO: { className: 'RouterAbMlDsaPoolDurableObject', useSQLite: true },
      ML_DSA_REGISTRATION_DO: {
        className: 'RouterAbMlDsaRegistrationDurableObject',
        useSQLite: true,
      },
      ML_DSA_ADMISSION_DO: {
        className: 'RouterAbMlDsaAdmissionDurableObject',
        scriptName: 'router',
      },
    },
    serviceBindings: { DERIVER_B: 'b' },
  };
}
async function raw(path, input, credential) {
  const init = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': credential,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(360000),
  };
  if (hostedUrl) return fetch(new URL(path, hostedUrl), init);
  return (await runtime.getWorker('router')).fetch(`https://ml-dsa.internal${path}`, init);
}
async function post(path, input) {
  const response = await raw(path, input, gatewayAuth);
  const text = await response.text();
  assert.equal(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text);
}
function digest(bytes) {
  return Array.from(createHash('sha256').update(Buffer.from(bytes)).digest());
}
async function sign(result) {
  const message = digest(Array.from(Buffer.from('ML-DSA registered Worker key')));
  const request = {
    key: result.a.activation.key,
    operation: Array.from(randomBytes(32)),
    message_digest: digest(message),
    context_digest: digest([]),
  };
  const started = performance.now();
  const response = await post('/router-ab/ml-dsa/sign', { request, message, context: [] });
  const elapsedMs = performance.now() - started;
  // Recovery preserves wallet cooldown. A cooldown response is valid for the second case.
  if (response.status === 'unavailable') {
    assert.equal(response.reason, 'wallet_cooldown');
    return { cooldownPreserved: true, retryAtMs: response.retry_at_ms };
  }
  assert.equal(response.status, 'existing');

  assert.equal(response.operation.state, 'succeeded');
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
      Buffer.from(result.a.public_key),
    ]),
    type: 'spki',
    format: 'der',
  });
  assert.equal(
    verify(null, Buffer.from(message), key, Buffer.from(response.operation.signature)),
    true,
  );
  return { verified: true, elapsedMs };
}

function caseSummary(value) {
  return {
    epoch: value.epoch,
    preparationMs: value.preparationMs,
    registrationMs: value.registrationWithClientVerificationMs,
    underFiveSeconds: value.underFiveSeconds,
    initialStockSign: value.initialStockSign,
  };
}
async function buildHash(name) {
  const bytes = await readFile(
    join(root, 'crates/router-ab-cloudflare/build', name, 'index_bg.wasm'),
  );
  return [name, createHash('sha256').update(bytes).digest('hex')];
}
function meetsLatencyTarget(value) {
  return (
    value.underFiveSeconds &&
    value.initialStockSign.verified === true &&
    value.initialStockSign.elapsedMs < 5000
  );
}
