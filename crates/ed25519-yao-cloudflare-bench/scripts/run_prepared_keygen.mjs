import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
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
    endpoint: '',
    secretsFile: '',
    output: '',
    indices: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  };
  while (args.length) {
    const argument = args.shift();
    switch (argument) {
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
  const workers = [];
  for (const role of ['a', 'b']) {
    const config = JSON.parse(
      await readFile(resolve(ROOT, `wrangler.ml-dsa-prepared.${role}.jsonc`), 'utf8'),
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
  assert.equal(b.table_storage.objects_written, 35);
  assert.equal(b.table_storage.objects_read, online.length);
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
async function sample(endpoint, token, fixture, schedules) {
  const runId = randomBytes(16).toString('hex');
  const url = new URL('/benchmark', endpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('kernel', 'prepared-keygen');
  url.searchParams.set('run_id', runId);
  const started = performance.now();
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
    handshakeTimeout: 30000,
  });
  const closed = { code: null, reason: '' };
  socket.once('close', recordClose.bind(null, closed));
  const events = on(socket, 'message', { signal: AbortSignal.timeout(360000), close: ['close'] });
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
          checkReport(message, fixture, schedules);
          state = {
            kind: 'cleaning',
            result: {
              run_id: runId,
              fixture_index: fixture.index,
              warmup: fixture.index === 0,
              client_ready_ms: state.clientReadyMs,
              client_online_ms: onlineMs,
              under_five_seconds: onlineMs < 5000,
              ready: state.ready,
              report: message,
            },
          };
          break;
        }
        case 'cleaned': {
          assert.equal(state.kind, 'cleaning');
          return { ...state.result, table_cleanup_acknowledged: true };
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
    socket.terminate();
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
  if (!values.length) return { measured_samples: 0 };
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return {
    measured_samples: values.length,
    median_ms: median,
    minimum_ms: values[0],
    maximum_ms: values.at(-1),
    deadline_misses: values.filter(missesDeadline).length,
    all_observed_under_five_seconds: values.every(underDeadline),
  };
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
    schema: 'seams.ml-dsa-prepared-keygen-worker.v1',
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
    scope:
      'Two separate Worker roles. Fresh input-independent preprocessing, thirty-five R2 object writes including all fallback branches, then a client-controlled online request with streamed R2 reads for the used branches and public Power2Round. Each deployed bundle receives only its own root shares.',
    limits: [
      'Client online time includes the start message, R2 reads, protocol exchanges, and the returned public key. Offline preparation and cleanup are separate.',
      'Native fixture generation derives owner roots from known disposable wallet seeds. Workers receive only their root shares and execute root-to-canonical-key derivation. Production custody envelopes, admission, durable activation, and pool restart are not implemented.',
      'Cf colo fields describe request metadata. They do not independently establish each physical compute or storage placement.',
      'These samples establish observed latency only. They are not a production percentile or successful-signature deadline guarantee.',
    ],
  };
  try {
    const unauthorized = await fetch(
      new URL(
        '/benchmark?kernel=prepared-keygen&run_id=00000000000000000000000000000000',
        endpoint,
      ),
    );
    assert.equal(unauthorized.status, 401);
    artifact.unauthorized_request_rejected = true;
    for (const index of options.indices) {
      try {
        const result = await sample(endpoint, token, oracle.cases[index], oracle.schedules);
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
await main();
