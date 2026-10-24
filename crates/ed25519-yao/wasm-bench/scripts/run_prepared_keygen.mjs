import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, open, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const BINARY = resolve(ROOT, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation');
const PACKAGE = resolve(
  ROOT,
  'crates/ed25519-yao/wasm-bench/pkg-prepared/ed25519_yao_wasm_bench.js',
);
const execute = promisify(execFile);
const writeStdout = promisify(process.stdout.write.bind(process.stdout));
let state;

function counts() {
  return {
    sent_bytes: 0,
    received_bytes: 0,
    sent_messages: 0,
    received_messages: 0,
    table_bytes_written: 0,
    table_bytes_read: 0,
    table_frame_reads: 0,
    table_objects_opened: 0,
  };
}
function observeMemory() {
  state.wasmPeak = Math.max(state.wasmPeak, state.wasm.wasm_linear_memory_bytes());
  state.rssPeak = Math.max(state.rssPeak, process.memoryUsage().rss);
}
async function send(bytes) {
  observeMemory();
  if (state.phase === 1 && state.rttMs > 0) await delay(state.rttMs / 2);
  await writeStdout(Buffer.from(bytes));
  state.counts[state.phase].sent_bytes += bytes.length;
  state.counts[state.phase].sent_messages++;
}
async function receive(length) {
  const output = Buffer.alloc(length);
  let written = 0;
  while (written < length) {
    if (state.pending.length === 0) {
      const item = await state.input.next();
      assert(!item.done, 'Peer ended before the expected protocol message');
      state.pending = item.value;
    }
    const amount = Math.min(length - written, state.pending.length);
    state.pending.copy(output, written, 0, amount);
    state.pending = state.pending.subarray(amount);
    written += amount;
  }
  state.counts[state.phase].received_bytes += length;
  state.counts[state.phase].received_messages++;
  observeMemory();
  return output;
}
async function store(binding, ordinal, bytes) {
  const name = Buffer.from(binding).toString('hex');
  let file = state.files.get(name);
  if (!file) {
    assert.equal(ordinal, 0);
    file = await open(join(state.directory, name), 'wx+', 0o600);
    state.files.set(name, file);
    state.counts[state.phase].table_objects_opened++;
  }
  await file.writeFile(Buffer.from(bytes));
  state.counts[state.phase].table_bytes_written += bytes.length;
  observeMemory();
}
async function load(binding, ordinal, length) {
  const file = state.files.get(Buffer.from(binding).toString('hex'));
  assert(file, 'No prepared table for this circuit');
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await file.read(output, offset, length - offset, ordinal * 65544 + offset);
    assert(result.bytesRead > 0, 'Prepared table is truncated');
    offset += result.bytesRead;
  }
  state.counts[state.phase].table_bytes_read += length;
  state.counts[state.phase].table_frame_reads++;
  observeMemory();
  return output;
}
function phase(value) {
  state.phase = value;
  state.started[value] = performance.now();
  state.cpuStarted[value] = process.cpuUsage();
  if (value === 1) {
    state.offlineMs = state.started[1] - state.started[0];
    state.offlineCpu = process.cpuUsage(state.cpuStarted[0]);
  }
  observeMemory();
}
async function closeFile(file) {
  await file.close();
}

async function roleMain(args) {
  assert.equal(args.length, 6);
  const [role, schedules, input, directory, output, rtt] = args;
  const wasm = createRequire(import.meta.url)(PACKAGE);
  state = {
    wasm,
    role,
    directory,
    rttMs: Number(rtt),
    phase: 0,
    counts: [counts(), counts()],
    input: process.stdin[Symbol.asyncIterator](),
    pending: Buffer.alloc(0),
    files: new Map(),
    started: [0, 0],
    cpuStarted: [null, null],
    offlineMs: 0,
    offlineCpu: null,
    wasmPeak: 0,
    rssPeak: 0,
  };
  globalThis.preparedHost = { send, receive, store, load, phase };
  const buffers = [];
  for (const name of ['wallet-seed', 'seed', 'sampling-two-blocks', 'sampling-three-blocks', 'sampling-final-bound']) {
    buffers.push(await readFile(join(schedules, `${name}.bin`)));
  }
  const ownRoot = await readFile(input);
  try {
    const publicKey = await wasm.prepared_keygen_benchmark(role, buffers, ownRoot);
    const onlineMs = performance.now() - state.started[1];
    const onlineCpu = process.cpuUsage(state.cpuStarted[1]);
    observeMemory();
    await writeFile(
      output,
      JSON.stringify(
        {
          public_key_hex: Buffer.from(publicKey).toString('hex'),
          offline_ms: state.offlineMs,
          online_ms: onlineMs,
          offline_cpu_us: state.offlineCpu,
          online_cpu_us: onlineCpu,
          offline: state.counts[0],
          online: state.counts[1],
          wasm_linear_memory_peak_bytes: state.wasmPeak,
          process_rss_peak_bytes: state.rssPeak,
        },
        null,
        2,
      ),
    );
  } finally {
    ownRoot.fill(0);
    await Promise.all([...state.files.values()].map(closeFile));
    process.stdin.destroy();
  }
}

function collectStderr(chunks, chunk) {
  chunks.push(chunk);
}
async function waitChild(child) {
  const [code, signal] = await once(child, 'close');
  assert.equal(code, 0, `Role failed (${signal}): ${Buffer.concat(child.diagnostics).toString()}`);
}
function launch(args) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'role', ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.diagnostics = [];
  child.stderr.on('data', collectStderr.bind(null, child.diagnostics));
  return child;
}
async function runCase(directory, schedules, index, rttMs, expectedKey) {
  const aDir = join(directory, `${index}-a`);
  const bDir = join(directory, `${index}-b`);
  await mkdir(aDir, { mode: 0o700 });
  await mkdir(bDir, { mode: 0o700 });
  const aRoot = randomBytes(32);
  const bRoot = Buffer.alloc(32, 0x42);
  for (let i = 0; i < 32; i++) bRoot[i] ^= aRoot[i];
  const aInput = join(aDir, 'root');
  const bInput = join(bDir, 'root');
  await writeFile(aInput, aRoot, { mode: 0o600 });
  await writeFile(bInput, bRoot, { mode: 0o600 });
  aRoot.fill(0);
  bRoot.fill(0);
  const aOutput = join(aDir, 'result.json');
  const bOutput = join(bDir, 'result.json');
  const a = launch(['a', schedules, aInput, aDir, aOutput, String(rttMs)]);
  const b = launch(['b', schedules, bInput, bDir, bOutput, String(rttMs)]);
  a.stdout.pipe(b.stdin);
  b.stdout.pipe(a.stdin);
  try {
    await Promise.all([waitChild(a), waitChild(b)]);
  } finally {
    a.kill();
    b.kill();
  }
  const aReport = JSON.parse(await readFile(aOutput, 'utf8'));
  const bReport = JSON.parse(await readFile(bOutput, 'utf8'));
  assert.equal(aReport.public_key_hex, expectedKey);
  assert.equal(bReport.public_key_hex, expectedKey);
  for (const phase of ['offline', 'online']) {
    assert.equal(aReport[phase].sent_bytes, bReport[phase].received_bytes);
    assert.equal(bReport[phase].sent_bytes, aReport[phase].received_bytes);
    assert.equal(aReport[phase].sent_messages, bReport[phase].received_messages);
  }
  assert(aReport.online.sent_messages >= 14 && aReport.online.sent_messages <= 36);
  assert.equal(bReport.online.sent_messages, 2 * (aReport.online.sent_messages - 1) + 1);
  console.error(
    `Prepared keygen Wasm case ${index}, injected RTT ${rttMs} ms: B online ${bReport.online_ms.toFixed(1)} ms`,
  );
  return {
    warmup: index === 0,
    injected_rtt_ms: rttMs,
    canonical_key_verified: true,
    a: aReport,
    b: bReport,
  };
}
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
async function main() {
  if (process.argv[2] === 'role') return roleMain(process.argv.slice(3));
  assert.equal(process.argv.length, 3, 'Pass one evidence output path');
  const output = resolve(process.argv[2]);
  const directory = await mkdtemp(join(tmpdir(), 'ml-dsa-prepared-wasm-'));
  const cases = [];
  const sources = [];
  const nativePath = resolve(ROOT, 'docs/evidence/ml-dsa-65-prepared-keygen-native-20261014.json');
  const nativeBytes = await readFile(nativePath);
  const native = JSON.parse(nativeBytes.toString());
  try {
    const schedules = join(directory, 'schedules');
    await execute(BINARY, ['export-custody-schedules', schedules], { timeout: 120000 });
    for (const [index, rttMs] of [0, 0, 0, 0, 5, 20].entries()) {
      cases.push(
        await runCase(directory, schedules, index, rttMs, native.cases[0].a.public_key_hex),
      );
    }
    for (const path of [
      'crates/ed25519-yao/wasm-bench/src/prepared.rs',
      'crates/ed25519-yao/wasm-bench/scripts/run_prepared_keygen.mjs',
      'crates/ed25519-yao/wasm-bench/Cargo.toml',
      'crates/ed25519-yao/wasm-bench/Cargo.lock',
      'crates/two-party-primitives/Cargo.toml',
      'crates/two-party-primitives/src/lib.rs',
      'crates/two-party-primitives/src/ot.rs',
      'crates/two-party-primitives/src/gate_aes.rs',
      'crates/two-party-primitives/src/decoding.rs',
      'crates/ml-dsa-threshold/src/runtime/prepared.rs',
      'crates/ml-dsa-threshold/src/runtime/prepared/keygen.rs',
      'crates/ml-dsa-threshold/src/runtime.rs',
      'crates/ml-dsa-threshold/src/signing/keygen.rs',
      'crates/ml-dsa-threshold/src/signing/wallet_seed.rs',
    ])
      sources.push({ path, sha256: sha256(await readFile(resolve(ROOT, path))) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const artifact = {
    schema: 'seams.ml-dsa-prepared-keygen-wasm.v1',
    production_eligible: false,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    sources,
    native_oracle_sha256: sha256(nativeBytes),
    wasm_sha256: sha256(await readFile(PACKAGE.replace('.js', '_bg.wasm'))),
    temporary_files_removed: true,
    cases,
    limits: [
      'Node/V8 Wasm with two separate processes and hot local disk tables. No Cloudflare deployment, remote storage, production admission, or durable pool is measured.',
      'The injected delay is half the specified RTT before each outgoing online message. This is a sensitivity test, not a network simulation.',
      'Online timing includes input correction, label delivery, table reads, circuit evaluation, and canonical keygen arithmetic. Module startup and schedule loading precede preparation.',
      'Wasm linear memory excludes the Node heap and runtime. Process RSS includes the whole Node process. Neither is a deployed Worker isolate-memory measurement.',
      'Each reservation is freshly prepared and consumed once. No reusable prepared secret material or third-party dealer is used.',
    ],
  };
  await writeFile(output, JSON.stringify(artifact, null, 2));
  console.log(output);
}
await main();
