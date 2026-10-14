import assert from 'node:assert/strict';
import { randomBytes, createHash, createPublicKey, verify } from 'node:crypto';
import { once, on } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = resolve(ROOT, '../..');

function parseOptions() {
  const args = process.argv.slice(2);
  const options = {
    local: false,
    operation: 'keygen',
    endpoint: '',
    secretsFile: '',
    output: '',
    indices: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  };
  while (args.length) {
    const argument = args.shift();
    switch (argument) {
      case '--operation':
        options.operation = args.shift();
        break;
      case '--local':
        options.local = true;
        break;
      case '--endpoint':
        options.endpoint = args.shift();
        break;
      case '--secrets-file':
        options.secretsFile = args.shift();
        break;
      case '--output':
        options.output = args.shift();
        break;
      case '--indices':
        options.indices = args.shift().split(',').map(Number);
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  assert(['keygen', 'signing', 'gmw-signing'].includes(options.operation));
  assert(options.output, 'An output path is required');
  assert(
    options.local || (options.endpoint && options.secretsFile),
    'Hosted runs require endpoint and secrets-file',
  );
  assert(options.indices.length > 0 && options.indices.every(validIndex));
  return options;
}
function validIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < 9;
}
async function localRuntime(token) {
  const { Miniflare, Log, LogLevel } = await import('miniflare');
  const { unstable_readConfig } = await import('wrangler');
  const workers = [];
  for (const role of ['a', 'b']) {
    const config = unstable_readConfig(
      { config: resolve(ROOT, `wrangler.ml-dsa-prepared.${role}.jsonc`) },
      { hideWarnings: true, preserveOriginalMain: true },
    );
    const services = {};
    for (const service of config.services ?? []) services[service.binding] = service.service;
    const r2 = {};
    for (const bucket of config.r2_buckets ?? []) r2[bucket.binding] = bucket.bucket_name;
    workers.push({
      name: config.name,
      modules: true,
      modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
      scriptPath: resolve(ROOT, config.main),
      compatibilityDate: config.compatibility_date,
      bindings: { PROBE_TOKEN: token },
      serviceBindings: services,
      r2Buckets: r2,
    });
  }
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    log: new Log(LogLevel.ERROR),
    workers,
  });
  return { runtime, endpoint: String(await runtime.ready) };
}
function tableBytes(schedule) {
  return schedule.half_gate_table_bytes + 8 * Math.ceil(schedule.half_gate_table_bytes / 65536);
}
function expectedCircuits(fixture) {
  const circuits = [{ name: 'seed', ordinal: 0 }];
  for (const [ordinal, prefix] of fixture.sampler_prefix_bytes.entries()) {
    circuits.push({ name: 'sampling-two-blocks', ordinal });
    if (prefix >= 408) circuits.push({ name: 'sampling-three-blocks', ordinal });
    if (prefix === 481) circuits.push({ name: 'sampling-final-bound', ordinal });
  }
  return circuits;
}
function checkReport(report, fixture, schedules) {
  assert.equal(report.type, 'complete');
  for (const role of ['a', 'b']) {
    const value = report.roles[role];
    assert.equal(value.role, role);
    assert.equal(value.canonical_key_verified, true);
    assert.equal(value.public_key_hex, fixture.public_key_hex);
    assert.equal(value.key_manifest_digest_hex, fixture.key_manifest_digest_hex);
    assert.equal(value.wallet_id, fixture.wallet_id);
    assert.equal(value.signing_key_id, fixture.signing_key_id);
  }
  const { a, b } = report.roles;
  for (const phase of ['offline', 'online']) {
    assert.equal(a[phase].sent_bytes, b[phase].received_bytes);
    assert.equal(b[phase].sent_bytes, a[phase].received_bytes);
    assert.equal(a[phase].sent_messages, b[phase].received_messages);
  }
  const circuits = expectedCircuits(fixture);
  assert.deepEqual(a.executed_circuits, circuits);
  assert.deepEqual(b.executed_circuits, circuits);
  const online = [{ name: 'wallet-seed', ordinal: 0 }, ...circuits];
  let aBytes = 4 + 6185;
  let bBytes = 6185;
  let readBytes = 0;
  for (const circuit of online) {
    const schedule = schedules.find(matchesSchedule.bind(null, circuit.name));
    assert(schedule);
    aBytes += 32 + 16 * schedule.garbler_input_bits + 32 * schedule.evaluator_input_bits;
    bBytes += 64 + schedule.evaluator_input_bits / 8 + schedule.public_output_bytes;
    readBytes += tableBytes(schedule);
  }
  let storedBytes = 0;
  for (const schedule of schedules) {
    const count = schedule.schedule_filename.startsWith('sampling-') ? 11 : 1;
    storedBytes += count * tableBytes(schedule);
  }
  assert.equal(a.online.sent_messages, online.length + 2);
  assert.equal(b.online.sent_messages, online.length * 2 + 1);
  assert.equal(a.online.sent_bytes, aBytes);
  assert.equal(b.online.sent_bytes, bBytes);
  assert.equal(b.table_storage.objects_written, 23);
  assert.equal(b.table_storage.objects_read, online.length - 12);
  assert.equal(b.table_storage.objects_read_before_admission, 1);
  assert.equal(b.table_storage.objects_read_online, online.length - 13);
  assert.equal(b.table_storage.table_bytes_read, readBytes);
  assert.equal(b.table_storage.table_bytes_written, storedBytes);
}
function matchesSchedule(name, schedule) {
  return schedule.schedule_filename === `${name}.bin`;
}
function recordClose(diagnostic, code, reason) {
  diagnostic.code = code;
  diagnostic.reason = reason.toString();
}
async function closeCleanly(socket, diagnostic) {
  if (socket.readyState !== WebSocket.CLOSED) {
    const closing = once(socket, 'close', { signal: AbortSignal.timeout(10000) });
    socket.close(1000, 'benchmark complete');
    const [code] = await closing;
    assert.equal(code, 1000, 'Worker did not close normally after cleanup');
  }
  assert.equal(diagnostic.code, 1000, 'Worker close code was not observed');
}
async function sample(endpoint, token, fixture, schedules, operation) {
  const runId = randomBytes(16).toString('hex');
  const url = new URL('/benchmark', endpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('kernel', `prepared-${operation}`);
  url.searchParams.set('run_id', runId);
  const started = performance.now();
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
    handshakeTimeout: 30000,
  });
  const closed = { code: null, reason: '' };
  socket.once('close', recordClose.bind(null, closed));
  const events = on(socket, 'message', { signal: AbortSignal.timeout(900000), close: ['close'] });
  let state = { kind: 'preparing' };
  try {
    await once(socket, 'open');
    for await (const [bytes] of events) {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'error') throw new Error(message.error);
      assert.equal(message.run_id, runId);
      switch (message.type) {
        case 'ready': {
          assert.equal(state.kind, 'preparing');
          const onlineStart = performance.now();
          state = {
            kind: 'online',
            started: onlineStart,
            ready: message,
            clientReadyMs: onlineStart - started,
          };
          socket.send(JSON.stringify({ type: 'start', fixture_index: fixture.index }));
          break;
        }
        case 'complete': {
          assert.equal(state.kind, 'online');
          const onlineMs = performance.now() - state.started;
          if (operation === 'keygen') checkReport(message, fixture, schedules);
          else checkSigningReport(message, fixture, schedules);
          state = {
            kind: 'cleaning',
            result: {
              run_id: runId,
              fixture_index: fixture.index,
              warmup: fixture.index === 0,
              client_ready_ms: state.clientReadyMs,
              client_online_ms: onlineMs,
              under_five_seconds: onlineMs < 5000,
              successful: operation === 'keygen' || message.roles.a.status === 'signed',
              ready: state.ready,
              report: message,
            },
          };
          break;
        }
        case 'cleaned': {
          assert.equal(state.kind, 'cleaning');
          const result = state.result;
          await closeCleanly(socket, closed);
          state = { kind: 'complete' };
          return { ...result, table_cleanup_acknowledged: true, websocket_close_code: 1000 };
        }
        default:
          throw new Error(`Unexpected message: ${message.type}`);
      }
    }
    throw new Error(
      `Worker closed before cleanup confirmation: run=${runId}, phase=${state.kind}, code=${closed.code}, reason=${closed.reason}, elapsed_ms=${(performance.now() - started).toFixed(1)}`,
    );
  } finally {
    await events.return();
    if (state.kind !== 'complete') socket.terminate();
  }
}
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function numericOrder(a, b) {
  return a - b;
}
function summary(samples) {
  const values = samples.filter(measured).map(onlineTime).sort(numericOrder);
  const allRequests = {
    total_completed_requests_including_warmup: samples.length,
    total_unsuccessful_requests_including_warmup: samples.filter(unsuccessful).length,
    all_completed_requests_succeeded_within_five_seconds:
      samples.length > 0 && samples.every(successWithinDeadline),
  };
  if (!values.length) return { ...allRequests, measured_samples: 0 };
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return {
    ...allRequests,
    measured_samples: values.length,
    unsuccessful_requests: samples.filter(measured).filter(unsuccessful).length,
    all_successful_under_five_seconds: samples.filter(measured).every(successWithinDeadline),
    median_ms: median,
    minimum_ms: values[0],
    maximum_ms: values.at(-1),
    deadline_misses: values.filter(missesDeadline).length,
    all_observed_under_five_seconds: values.every(underDeadline),
  };
}
function unsuccessful(sample) {
  return !sample.successful;
}
function successWithinDeadline(sample) {
  return sample.successful && sample.under_five_seconds;
}
function measured(sample) {
  return !sample.warmup;
}
function onlineTime(sample) {
  return sample.client_online_ms;
}
function missesDeadline(ms) {
  return ms >= 5000;
}
function underDeadline(ms) {
  return ms < 5000;
}
async function provenance() {
  const sources = [];
  for (const path of [
    'crates/ed25519-yao-cloudflare-bench/src/ml_dsa.rs',
    'crates/ed25519-yao-cloudflare-bench/src/ml_dsa/prepared.rs',
    'crates/ed25519-yao-cloudflare-bench/src/ml_dsa/prepared_signing.rs',
    'crates/ed25519-yao-cloudflare-bench/src/ml_dsa/pipeline.rs',
    'crates/ed25519-yao/src/passive/ml_dsa_signing/prepared_signing.rs',
    'crates/ed25519-yao/src/passive/ml_dsa_signing/prepared_signing/gmw.rs',
    'crates/ed25519-yao/src/passive/ml_dsa_runtime/boolean_comparison.rs',
    'crates/ed25519-yao/src/passive/ml_dsa_runtime/boolean_comparison/prepared.rs',
    'crates/ed25519-yao/src/passive/ot.rs',
    'tools/ed25519-yao-generator/src/circuit/ml_dsa_signing.rs',
    'tools/ml-dsa-investigation/src/prepared_signing_evidence.rs',
    'crates/ed25519-yao-cloudflare-bench/src/ml_dsa/prepared_storage.rs',
    'crates/ed25519-yao-cloudflare-bench/scripts/run_prepared_keygen.mjs',
    'crates/ed25519-yao-cloudflare-bench/wrangler.ml-dsa-prepared.a.jsonc',
    'crates/ed25519-yao-cloudflare-bench/wrangler.ml-dsa-prepared.b.jsonc',
    'crates/ed25519-yao/src/passive/ml_dsa_runtime/prepared.rs',
    'crates/ed25519-yao/src/passive/ml_dsa_runtime/prepared/keygen.rs',
    'crates/ed25519-yao/src/passive/ml_dsa_signing/keygen.rs',
    'crates/ed25519-yao/src/passive/ml_dsa_runtime.rs',
    'tools/ed25519-yao-generator/src/circuit/ml_dsa_public_sampling.rs',
    'tools/ml-dsa-investigation/src/prepared_worker_fixtures.rs',
  ])
    sources.push({ path, sha256: digest(await readFile(resolve(REPOSITORY, path))) });
  const builds = [];
  for (const role of ['a', 'b']) {
    for (const name of ['index.js', 'index_bg.wasm']) {
      const path = `crates/ed25519-yao-cloudflare-bench/build/ml-dsa-${role}/${name}`;
      const bytes = await readFile(resolve(REPOSITORY, path));
      builds.push({ path, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  const fixtures = [];
  for (const role of ['a', 'b', 'client']) {
    const path = `crates/ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/prepared-${role}.json`;
    fixtures.push({ path, sha256: digest(await readFile(resolve(REPOSITORY, path))) });
  }
  return { sources, builds, fixtures, node: process.version };
}
function measurementScope(operation) {
  switch (operation) {
    case 'keygen':
      return 'Two separate Worker roles. Thirty-five prepared circuits in twenty-three grouped R2 objects. The first table group is resident before readiness; fallback reads remain online.';
    case 'signing':
      return 'Two separate Worker roles. A wallet-derived canonical key and twelve fresh Yao signing candidates precede readiness. The first table group is resident. Online time includes later reads, retries, protocol exchanges, and both Worker verifiers.';
    case 'gmw-signing':
      return 'Two separate Worker roles. A wallet-derived canonical key, fresh nonce commitments, and private GMW correlations precede readiness. All candidates run in three online batches. No R2 table read occurs. Direct uniform nonce sampling replaces the FIPS hedged nonce procedure.';
    default:
      throw new Error('Unknown prepared operation');
  }
}
async function main() {
  const options = parseOptions();
  const token = options.local
    ? randomBytes(32).toString('hex')
    : JSON.parse(await readFile(options.secretsFile, 'utf8')).PROBE_TOKEN;
  assert.equal(token.length, 64);
  const local = options.local ? await localRuntime(token) : null;
  const endpoint = local ? local.endpoint : options.endpoint;
  const oracle = JSON.parse(
    await readFile(resolve(ROOT, 'src/ml_dsa_schedules/prepared-client.json'), 'utf8'),
  );
  const artifact = {
    schema: `seams.ml-dsa-prepared-${options.operation}-worker.v1`,
    operation: options.operation,
    created_at: new Date().toISOString(),
    environment: options.local ? 'local-workerd' : 'hosted-cloudflare',
    endpoint,
    production_eligible: false,
    disposable_public_wallet_fixtures_only: true,
    latency_target_ms: 5000,
    provenance: await provenance(),
    public_recovery_oracle: oracle.cases,
    public_schedules: oracle.schedules,
    samples: [],
    failures: [],
    scope: measurementScope(options.operation),
    limits: [
      'Yao loads its first fresh table group before admission. GMW prepares fresh private correlations and retains packed shares. Readiness includes this work. Online time includes input delivery, dependent exchanges, later Yao table reads, retries, verification, and completion. Cold or empty pools have no five-second success claim.',
      'Native fixture generation derives owner roots from known disposable wallet seeds. Workers receive only their root shares and execute root-to-canonical-key derivation. Production custody envelopes, admission, durable activation, and pool restart are not implemented.',
      'Cf colo fields describe request metadata. They do not independently establish each physical compute or storage placement.',
      'These samples establish observed latency only. They are not a production percentile or successful-signature deadline guarantee.',
    ],
  };
  try {
    const unauthorized = await fetch(
      new URL(
        `/benchmark?kernel=prepared-${options.operation}&run_id=00000000000000000000000000000000`,
        endpoint,
      ),
    );
    assert.equal(unauthorized.status, 401);
    artifact.unauthorized_request_rejected = true;
    for (const index of options.indices) {
      try {
        const fixture =
          options.operation === 'keygen' ? oracle.cases[index] : { ...oracle.cases[0], index };
        const schedules =
          options.operation === 'keygen' ? oracle.schedules : oracle.signing_schedules;
        const result = await sample(endpoint, token, fixture, schedules, options.operation);
        artifact.samples.push(result);
        console.log(
          `Fixture ${index}: online ${result.client_online_ms.toFixed(1)} ms, ready ${result.client_ready_ms.toFixed(1)} ms`,
        );
      } catch (error) {
        artifact.failures.push({ fixture_index: index, error: String(error) });
        console.error(`Fixture ${index} failed: ${error}`);
        break;
      }
      artifact.summary = summary(artifact.samples);
      await writeFile(resolve(options.output), JSON.stringify(artifact, null, 2));
    }
    artifact.summary = summary(artifact.samples);
    artifact.all_requested_completed = artifact.samples.length === options.indices.length;
    const repeated = artifact.samples.filter(sameWallet);
    artifact.same_wallet_key_reproduced =
      repeated.length >= 2 && repeated.every(matchesFirst.bind(null, repeated[0]));
    await writeFile(resolve(options.output), JSON.stringify(artifact, null, 2));
    if (artifact.failures.length) process.exitCode = 1;
  } finally {
    if (local) await local.runtime.dispose();
  }
}
function sameWallet(sample) {
  return sample.fixture_index < 6;
}
function matchesFirst(first, current) {
  return (
    first.report.roles.a.public_key_hex === current.report.roles.a.public_key_hex &&
    first.report.roles.a.key_manifest_digest_hex === current.report.roles.a.key_manifest_digest_hex
  );
}
function sumBatchLayers(total, batch) {
  return total + batch.and_exchanges;
}
function matchesSigningSchedule(name, record) {
  return record.name === name;
}
function checkSigningReport(report, fixture, schedules) {
  const { a, b } = report.roles;
  for (const field of ['status', 'signature_hex', 'attempts', 'message_hex', 'public_key_hex'])
    assert.equal(a[field], b[field]);
  assert.equal(a.public_key_hex, fixture.public_key_hex);
  assert.equal(a.canonical_key_verified, true);
  assert.equal(b.canonical_key_verified, true);
  for (const phase of ['online', 'offline']) {
    assert.equal(a[phase].sent_bytes, b[phase].received_bytes);
    assert.equal(b[phase].sent_bytes, a[phase].received_bytes);
  }
  if (a.engine === 'gmw') {
    assert.equal(b.engine, 'gmw');
    assert.equal(a.table_storage, null);
    assert.equal(b.table_storage, null);
    if (a.status === 'signed') {
      assert.equal(a.evaluated_candidates, a.pool_capacity);
      assert.equal(b.evaluated_candidates, b.pool_capacity);
      assert.equal(a.gmw_batches.reduce(sumBatchLayers, 0), 227);
      assert.equal(b.gmw_batches.reduce(sumBatchLayers, 0), 227);
      for (let batch = 0; batch < 3; batch += 1) {
        for (let phase = 0; phase < 6; phase += 1) {
          const left = a.gmw_batches[batch].phases[phase];
          const right = b.gmw_batches[batch].phases[phase];
          assert.equal(left.sent_bytes, right.received_bytes);
          assert.equal(right.sent_bytes, left.received_bytes);
        }
      }
    }
  } else {
    assert.equal(b.table_storage.objects_written, b.pool_capacity);
    assert.equal(b.table_storage.objects_read, b.attempts);
    assert.equal(b.table_storage.objects_read_before_admission, 1);
    assert.equal(b.table_storage.objects_read_online, b.attempts - 1);
    let candidateBytes = 0;
    for (const [name, count] of [
      ['commitment-hash', 1],
      ['response-check', 5],
      ['low-response-check', 6],
      ['bounds-decision', 1],
    ]) {
      const record = schedules.find(matchesSigningSchedule.bind(null, name));
      assert(record);
      const tables = record.and_gates * 32;
      candidateBytes += count * (tables + 8 * Math.ceil(tables / 65536));
    }
    assert.equal(b.table_storage.table_bytes_read, candidateBytes * b.attempts);
  }
  if (a.status === 'exhausted') {
    assert.equal(a.signature_hex, undefined);
    assert.equal(a.attempts, a.pool_capacity);
    return;
  }
  assert.equal(a.status, 'signed');
  assert.equal(a.standard_signature_verified, true);
  assert.equal(b.standard_signature_verified, true);
  const bytes = Buffer.from(a.public_key_hex, 'hex');
  const prefix = Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex');
  const key = createPublicKey({ key: Buffer.concat([prefix, bytes]), type: 'spki', format: 'der' });
  const message = Buffer.from(a.message_hex, 'hex');
  const signature = Buffer.from(a.signature_hex, 'hex');
  assert.equal(signature.length, 3309);
  assert.equal(verify(null, message, key, signature), true);
  const changed = Buffer.from(message);
  changed[0] ^= 1;
  assert.equal(verify(null, changed, key, signature), false);
}
await main();
