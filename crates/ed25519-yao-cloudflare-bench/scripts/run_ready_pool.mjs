import assert from 'node:assert/strict';
import { randomBytes, createPublicKey, createHash, verify } from 'node:crypto';
import { once, on } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { localRuntime, provenance } from './run_prepared_keygen.mjs';

function options() {
  const result = {
    local: false,
    endpoint: '',
    secretsFile: '',
    output: '',
    indices: [0],
    initial: 10,
    refill: 1,
  };
  const args = process.argv.slice(2);
  while (args.length) {
    const name = args.shift();
    switch (name) {
      case '--local':
        result.local = true;
        break;
      case '--endpoint':
        result.endpoint = args.shift();
        break;
      case '--secrets-file':
        result.secretsFile = args.shift();
        break;
      case '--output':
        result.output = args.shift();
        break;
      case '--indices':
        result.indices = args.shift().split(',').map(Number);
        break;
      case '--initial-batches':
        result.initial = Number(args.shift());
        break;
      case '--refill-batches':
        result.refill = Number(args.shift());
        break;
      default:
        throw new Error(`Unknown option: ${name}`);
    }
  }
  assert(result.output && (result.local || (result.endpoint && result.secretsFile)));
  assert([1, 10].includes(result.initial) && [1, 10].includes(result.refill));
  assert(result.indices.length && result.indices.every(validIndex));
  return result;
}
function validIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < 9;
}
function checkCounters(roles) {
  for (const phase of ['offline', 'online']) {
    assert.equal(roles.a[phase].sent_bytes, roles.b[phase].received_bytes);
    assert.equal(roles.b[phase].sent_bytes, roles.a[phase].received_bytes);
  }
  assert.deepEqual(roles.a.inventory, roles.b.inventory);
}
function checkOperation(report, publicKey, before, command) {
  const { a, b } = report.roles;
  checkCounters(report.roles);
  for (const field of [
    'status',
    'signature_hex',
    'operation',
    'group',
    'message_hex',
    'public_key_hex',
  ])
    assert.deepEqual(a[field], b[field]);
  if (command.type === 'sign') {
    assert.equal(a.operation, command.operation);
    assert.equal(a.public_key_hex, publicKey);
    const index = Buffer.alloc(4);
    index.writeUInt32LE(command.operation);
    const expected = createHash('sha256')
      .update('seams/ml-dsa/pool-message/v1')
      .update('sign')
      .update(index)
      .digest('hex');
    assert.equal(a.message_hex, expected);
  } else {
    assert.equal(a.group, command.group);
    assert.equal(a.requested_batches, command.batches);
    assert.equal(b.requested_batches, command.batches);
  }
  if (a.status === 'replay-rejected') {
    assert.equal(a.inventory.batches, before);
    return;
  }
  if (command.type === 'refill') {
    assert.equal(a.status, 'refilled');
    assert.equal(a.inventory.batches, before + command.batches);
    return;
  }
  assert(['signed', 'empty'].includes(a.status));
  assert.equal(a.public_key_hex, publicKey);
  assert.equal(a.inventory.batches, before - a.exhausted.length - Number(a.status === 'signed'));
  assert.equal(a.exhausted.length, b.exhausted.length);
  if (a.status === 'empty') {
    assert.equal(a.signature_hex, undefined);
    return;
  }
  assert.equal(a.standard_signature_verified, true);
  assert.equal(b.standard_signature_verified, true);
  const prefix = Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex');
  const key = createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(publicKey, 'hex')]),
    type: 'spki',
    format: 'der',
  });
  const message = Buffer.from(a.message_hex, 'hex');
  const signature = Buffer.from(a.signature_hex, 'hex');
  assert.equal(signature.length, 3309);
  assert(verify(null, message, key, signature));
  message[0] ^= 1;
  assert.equal(verify(null, message, key, signature), false);
}
async function next(iterator, expected, record, started) {
  for (;;) {
    const event = await iterator.next();
    assert.equal(event.done, false, 'Worker closed before the expected result');
    const value = JSON.parse(event.value[0].toString());
    if (value.type === 'error') throw new Error(value.error);
    assert.equal(value.run_id, record.run_id);
    if (value.type === 'preparation-progress') {
      record.progress.push({ ...value, client_elapsed_ms: performance.now() - started });
      console.log(
        `${record.fixture_index}: ${value.event}, bindings ${value.binding_phases_started}`,
      );
      continue;
    }
    assert.equal(value.type, expected);
    return value;
  }
}
async function operation(socket, iterator, command, kind, record, started, publicKey, before) {
  const requestStart = performance.now();
  socket.send(JSON.stringify(command));
  const report = await next(iterator, 'pool-result', record, started);
  const elapsed = performance.now() - requestStart;
  checkOperation(report, publicKey, before, command);
  const observation = { kind, command, client_ms: elapsed, report };
  record.operations.push(observation);
  console.log(
    `${record.fixture_index}: ${kind} ${report.roles.a.status}, ${elapsed.toFixed(1)} ms, ${report.roles.a.inventory.batches} batches remain`,
  );
  return report.roles.a.inventory.batches;
}
async function sample(endpoint, token, fixture, initial, refill, record) {
  const started = performance.now();
  const url = new URL('/benchmark', endpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('kernel', 'prepared-gmw-pool');
  url.searchParams.set('run_id', record.run_id);
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
    handshakeTimeout: 30000,
  });
  const iterator = on(socket, 'message', {
    signal: AbortSignal.timeout(1_200_000),
    close: ['close'],
  });
  try {
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'configure', batches: initial }));
    record.ready = await next(iterator, 'pool-ready', record, started);
    record.preparation_ms = performance.now() - started;
    checkCounters(record.ready.roles);
    assert.equal(record.ready.roles.a.inventory.batches, initial);
    const registrationStart = performance.now();
    socket.send(JSON.stringify({ type: 'start', fixture_index: fixture.index }));
    record.registration = await next(iterator, 'registered', record, started);
    record.registration_ms = performance.now() - registrationStart;
    checkCounters(record.registration.roles);
    for (const role of ['a', 'b']) {
      assert.equal(record.registration.roles[role].public_key_hex, fixture.public_key_hex);
      assert.equal(
        record.registration.roles[role].key_manifest_digest_hex,
        fixture.key_manifest_digest_hex,
      );
      assert.equal(record.registration.roles[role].canonical_key_verified, true);
    }
    assert.equal(record.registration.roles.b.table_storage.objects_read_before_admission, 0);
    assert.equal(
      record.registration.roles.b.table_storage.resident_table_bytes_before_admission,
      0,
    );
    assert.equal(
      record.registration.roles.b.table_storage.storage_start_policy,
      'all-groups-stream-online',
    );
    assert(record.registration.roles.b.table_storage.table_bytes_read > 0);
    console.log(`${fixture.index}: registration ${record.registration_ms.toFixed(1)} ms`);
    let remaining = initial;
    let ordinal = 0;
    for (let cycle = 0; cycle < 2; cycle += 1) {
      while (remaining > 0) {
        assert(ordinal < 60);
        remaining = await operation(
          socket,
          iterator,
          { type: 'sign', operation: ordinal++ },
          'sign',
          record,
          started,
          fixture.public_key_hex,
          remaining,
        );
        if (
          record.first_success_from_registration_start_ms === null &&
          record.operations.at(-1).report.roles.a.status === 'signed'
        ) {
          record.first_success_from_registration_start_ms = performance.now() - registrationStart;
        }
      }
      const empty = { type: 'sign', operation: ordinal++ };
      remaining = await operation(
        socket,
        iterator,
        empty,
        'empty-probe',
        record,
        started,
        fixture.public_key_hex,
        0,
      );
      assert.equal(record.operations.at(-1).report.roles.a.status, 'empty');
      assert.equal(record.operations.at(-1).report.roles.a.exhausted.length, 0);
      await operation(
        socket,
        iterator,
        empty,
        'operation-replay-probe',
        record,
        started,
        fixture.public_key_hex,
        0,
      );
      assert.equal(record.operations.at(-1).report.roles.a.status, 'replay-rejected');
      if (cycle === 0) {
        const command = { type: 'refill', group: 1, batches: refill };
        remaining = await operation(
          socket,
          iterator,
          command,
          'refill',
          record,
          started,
          fixture.public_key_hex,
          0,
        );
        await operation(
          socket,
          iterator,
          command,
          'refill-replay-probe',
          record,
          started,
          fixture.public_key_hex,
          remaining,
        );
        assert.equal(record.operations.at(-1).report.roles.a.status, 'replay-rejected');
      }
    }
    const closed = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'close' }));
    await next(iterator, 'cleaned', record, started);
    const [code] = await closed;
    assert.equal(code, 1000);
    record.cleanup_acknowledged = true;
    record.websocket_close_code = code;
    record.status = 'complete';
  } finally {
    await iterator.return();
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
}
async function main() {
  const args = options();
  const token = args.local
    ? randomBytes(32).toString('hex')
    : JSON.parse(await readFile(args.secretsFile, 'utf8')).PROBE_TOKEN;
  const local = args.local ? await localRuntime(token) : null;
  const endpoint = local ? local.endpoint : args.endpoint;
  const oracle = JSON.parse(
    await readFile(new URL('../src/ml_dsa_schedules/prepared-client.json', import.meta.url)),
  );
  const artifact = {
    schema: 'seams.ml-dsa-ready-pool-worker.v1',
    environment: args.local ? 'local-workerd' : 'hosted-cloudflare',
    production_eligible: false,
    initial_batches: args.initial,
    refill_batches: args.refill,
    candidates_per_batch: 4,
    provenance: await provenance(),
    samples: [],
    scope:
      'Disposable role-separated registration from wallet-root shares, standard canonical key checks, streamed R2 keygen tables, consuming pool rollover, refill, empty-pool and replay probes. Client clocks measure all request intervals. Preparation precedes registration. No production admission or durable pool storage is claimed.',
  };
  try {
    const unauthorized = await fetch(
      new URL(
        '/benchmark?kernel=prepared-gmw-pool&run_id=00000000000000000000000000000000',
        endpoint,
      ),
    );
    assert.equal(unauthorized.status, 401);
    artifact.unauthorized_request_rejected = true;
    for (const index of args.indices) {
      const record = {
        fixture_index: index,
        run_id: randomBytes(16).toString('hex'),
        status: 'running',
        progress: [],
        operations: [],
        first_success_from_registration_start_ms: null,
      };
      artifact.samples.push(record);
      try {
        await sample(endpoint, token, oracle.cases[index], args.initial, args.refill, record);
      } catch (error) {
        record.status = 'failed';
        record.error = String(error);
        console.error(record.error);
      }
      await writeFile(args.output, JSON.stringify(artifact, null, 2));
    }
  } finally {
    if (local) await local.runtime.dispose();
    await writeFile(args.output, JSON.stringify(artifact, null, 2));
  }
  if (artifact.samples.some(failed)) process.exitCode = 1;
}
function failed(sample) {
  return sample.status === 'failed';
}
await main();
