import assert from "node:assert/strict";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WALLET_ROOT = resolve(ROOT, "../..");
const REQUIRE = createRequire(import.meta.url);
const KERNELS = ["seed", "sampling", "rounding", "signing-mask", "keygen-fixture", "keygen-joint", "threshold-fixture", "threshold-joint"];
const SCHEDULES = ["seed", "sampling", "rounding", "signing-seed", "signing-mask", "commitment-high", "commitment-hash", "response-check", "row-check", "aggregate-check"];
const SOURCES = [
  "src/ml_dsa.rs",
  "src/ml_dsa/pipeline.rs",
  "src/lib.rs",
  "Cargo.toml",
  "Cargo.lock",
  "scripts/run_ml_dsa_kernels.mjs",
  "wrangler.ml-dsa.a.jsonc",
  "wrangler.ml-dsa.b.jsonc",
  "../ed25519-yao/Cargo.toml",
  "../ed25519-yao/src/lib.rs",
  "../ed25519-yao/src/passive.rs",
  "../ed25519-yao/src/passive/runtime.rs",
  "../ed25519-yao/src/passive/ml_dsa_runtime.rs",
  "../ed25519-yao/src/passive/ml_dsa_signing.rs",
  "../ed25519-yao/src/passive/ml_dsa_signing/arithmetic.rs",
  "../ed25519-yao/src/passive/ml_dsa_signing/keygen.rs",
  "../ed25519-yao/src/passive/gate_aes.rs",
  "../ed25519-yao/src/passive/ot.rs",
  "../../tools/ml-dsa-investigation/Cargo.toml",
  "../../tools/ml-dsa-investigation/Cargo.lock",
  "../../tools/ml-dsa-investigation/src/worker_fixtures.rs",
  "../../tools/ml-dsa-investigation/src/private_signing.rs",
  "../../tools/ed25519-yao-generator/src/circuit/keccak.rs",
  "../../tools/ed25519-yao-generator/src/circuit/ir.rs",
  "../../tools/ed25519-yao-generator/src/circuit/schedule.rs",
  "../../tools/ed25519-yao-generator/src/circuit/ml_dsa_arithmetic.rs",
  "../../tools/ed25519-yao-generator/src/circuit/ml_dsa_sampling.rs",
  "../../tools/ed25519-yao-generator/src/circuit/ml_dsa_rounding.rs",
  "../../tools/ed25519-yao-generator/src/circuit/ml_dsa_keygen.rs",
  "../../tools/ed25519-yao-generator/src/circuit/ml_dsa_signing.rs",
  "../../tools/ed25519-yao-generator/src/circuit/ml_dsa_signing_mask.rs",
];

function argumentsFrom(argv) {
  const options = { local: false, endpoint: null, out: null, samples: 5, kernels: KERNELS };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--local") {
      options.local = true;
      continue;
    }
    if (!["--endpoint", "--out", "--samples", "--kernel"].includes(name)) {
      throw new Error(`Unknown argument ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing ${name} value`);
    index += 1;
    switch (name) {
      case "--endpoint":
        options.endpoint = new URL(value).toString();
        break;
      case "--out":
        options.out = resolve(value);
        break;
      case "--samples":
        options.samples = Number(value);
        break;
      case "--kernel":
        assert(KERNELS.includes(value), "The kernel name is invalid");
        options.kernels = [value];
        break;
    }
  }
  assert(options.local !== (options.endpoint !== null), "Choose --local or --endpoint URL");
  assert(Number.isInteger(options.samples) && options.samples >= 1 && options.samples <= 100, "Samples must be 1 through 100");
  assert(options.out !== null, "Use --out to save a repeatable evidence artifact");
  return options;
}

async function fileIdentity(path) {
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function buildIdentity(role) {
  const directory = resolve(ROOT, `build/ml-dsa-${role}`);
  const modules = [];
  for (const name of ["index.js", "index_bg.wasm"]) {
    const path = resolve(directory, name);
    const bytes = await readFile(path);
    modules.push({ ...(await fileIdentity(path)), gzip_bytes: gzipSync(bytes).length });
  }
  return { role, modules };
}

async function provenance() {
  const sources = [];
  for (const source of SOURCES) sources.push(await fileIdentity(resolve(ROOT, source)));
  const schedules = [];
  for (const kernel of SCHEDULES) schedules.push(await fileIdentity(resolve(ROOT, `src/ml_dsa_schedules/${kernel}.bin`)));
  const fixtures = [];
  for (const role of ["a", "b"]) fixtures.push(await fileIdentity(resolve(ROOT, `src/ml_dsa_schedules/fixtures-${role}.json`)));
  const fixtureA = JSON.parse(await readFile(fixtures[0].path, "utf8"));
  const fixtureB = JSON.parse(await readFile(fixtures[1].path, "utf8"));
  assert.deepEqual(fixtureA.schedules, fixtureB.schedules);
  for (let index = 0; index < SCHEDULES.length; index += 1) {
    const resources = fixtureA.schedules[SCHEDULES[index]];
    assert.equal(resources.sha256, schedules[index].sha256);
    assert.equal(resources.bytes, schedules[index].bytes);
    assert(Number.isSafeInteger(resources.and_gates) && resources.and_gates > 0);
    assert.equal(resources.table_bytes, resources.and_gates * 32);
  }
  const packages = [];
  for (const name of ["wrangler", "miniflare", "workerd"]) {
    const path = REQUIRE.resolve(`${name}/package.json`);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    packages.push({ name: manifest.name, version: manifest.version, manifest: await fileIdentity(path) });
  }
  const builds = [];
  for (const role of ["a", "b"]) builds.push(await buildIdentity(role));
  return {
    captured_at: new Date().toISOString(),
    sources,
    schedules,
    threshold_fixture: fixtureA.threshold_fixture,
    schedule_resources: fixtureA.schedules,
    fixtures,
    builds,
    node: { version: process.version, openssl: process.versions.openssl, v8: process.versions.v8, platform: process.platform, architecture: process.arch },
    packages,
    reproduction: {
      working_directory: process.cwd(),
      argv: [process.execPath, ...process.argv.slice(1)],
      fixtures: "cargo run --release --manifest-path tools/ml-dsa-investigation/Cargo.toml -- export-worker-fixtures crates/ed25519-yao-cloudflare-bench/src/ml_dsa_schedules",
      build_a: "worker-build --release --out-dir build/ml-dsa-a --features ml-dsa-a",
      build_b: "worker-build --release --out-dir build/ml-dsa-b --features ml-dsa-b",
      wallet_root: WALLET_ROOT,
      authentication: "PROBE_TOKEN is read from the environment for hosted runs. Its value is never included in this artifact.",
    },
  };
}

async function localRuntime(token) {
  const { Miniflare, Log, LogLevel } = await import("miniflare");
  const workers = [];
  for (const role of ["a", "b"]) {
    const configuration = JSON.parse(await readFile(resolve(ROOT, `wrangler.ml-dsa.${role}.jsonc`), "utf8"));
    const services = {};
    for (const service of configuration.services ?? []) services[service.binding] = service.service;
    workers.push({
      name: configuration.name,
      modules: true,
      modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }],
      scriptPath: resolve(ROOT, configuration.main),
      compatibilityDate: configuration.compatibility_date,
      bindings: { PROBE_TOKEN: token },
      serviceBindings: services,
    });
  }
  const runtime = new Miniflare({ host: "127.0.0.1", port: 0, log: new Log(LogLevel.ERROR), workers });
  const endpoint = String(await runtime.ready);
  return { runtime, endpoint };
}

function assertRole(role, expectedRole, kernel, runId) {
  assert.equal(role.schema, "seams.ml-dsa-worker-kernel.v1");
  assert.equal(role.role, expectedRole);
  assert.equal(role.kernel, kernel);
  assert.equal(role.run_id, runId);
  assert.equal(role.public_fixture_only, true);
  assert.equal(role.fixture_output_matches, true);
  assert(Number.isInteger(role.wasm_linear_memory_highwater_bytes));
  assert(role.wasm_linear_memory_highwater_bytes > 0);
  assert.match(role.schedule_sha256, /^[a-f0-9]{64}$/);
  assert.equal(role.transport.credit_window_messages, 8);
  assert(role.transport.largest_pending_messages <= 8);
  assert(role.transport.largest_runtime_message_bytes <= 376_880);
  assert.equal(Object.hasOwn(role, "output"), false);
  assert.equal(Object.hasOwn(role, "output_hex"), false);
}

function assertReport(report, kernel, runId, expectedDigest) {
  assert.equal(report.schema, "seams.ml-dsa-worker-kernel.v1");
  assert.equal(report.ok, true);
  assert.equal(report.public_fixture_only, true);
  assert.equal(report.kernel, kernel);
  assert.equal(report.run_id, runId);
  assertRole(report.roles.a, "a", kernel, runId);
  assertRole(report.roles.b, "b", kernel, runId);
  assert.equal(report.roles.a.schedule_sha256, expectedDigest);
  assert.equal(report.roles.b.schedule_sha256, expectedDigest);
  assert.equal(report.roles.a.runtime.execution_binding_sha256, report.roles.b.runtime.execution_binding_sha256);
  assert.equal(report.roles.a.runtime.garbler_to_evaluator_wire_bytes, report.roles.a.transport.sent_runtime_bytes);
  assert.equal(report.roles.a.runtime.evaluator_to_garbler_wire_bytes, report.roles.a.transport.received_runtime_bytes);
  assert.equal(report.roles.b.runtime.garbler_to_evaluator_wire_bytes, report.roles.b.transport.received_runtime_bytes);
  assert.equal(report.roles.b.runtime.evaluator_to_garbler_wire_bytes, report.roles.b.transport.sent_runtime_bytes);
  assert.equal(report.roles.a.transport.sent_runtime_bytes, report.roles.b.transport.received_runtime_bytes);
  assert.equal(report.roles.b.transport.sent_runtime_bytes, report.roles.a.transport.received_runtime_bytes);
  assert.equal(report.roles.a.transport.sent_ack_bytes, report.roles.b.transport.received_ack_bytes);
  assert.equal(report.roles.b.transport.sent_ack_bytes, report.roles.a.transport.received_ack_bytes);
  assert(report.roles.a.transport.received_completion_bytes > 0);
}

function isThreshold(kernel) {
  return kernel === "threshold-fixture" || kernel === "threshold-joint";
}

function isKeygen(kernel) {
  return kernel === "keygen-fixture" || kernel === "keygen-joint";
}

function isPipeline(kernel) {
  return isThreshold(kernel) || isKeygen(kernel);
}

function standardKey(bytes) {
  // SPKI for OID 2.16.840.1.101.3.4.3.18 and exactly 1,952 raw key bytes.
  const prefix = Buffer.from("308207b2300b0609608648016503040312038207a100", "hex");
  return createPublicKey({ key: Buffer.concat([prefix, bytes]), type: "spki", format: "der" });
}

function assertKernelResources(role, expectedCalls, schedules) {
  const observed = new Set();
  let circuitCount = 0;
  let tableBytes = 0;
  for (const kernel of role.runtime.per_kernel) {
    assert.equal(observed.has(kernel.kernel), false);
    observed.add(kernel.kernel);
    assert.equal(kernel.calls, expectedCalls[kernel.kernel]);
    assert.equal(kernel.table_bytes, schedules[kernel.kernel].table_bytes * kernel.calls);
    circuitCount += kernel.calls;
    tableBytes += kernel.table_bytes;
  }
  assert.deepEqual([...observed].sort(), Object.keys(expectedCalls).sort());
  assert.equal(role.runtime.circuit_count, circuitCount);
  assert.equal(role.runtime.fresh_execution_bindings, circuitCount);
  assert.equal(role.runtime.table_bytes, tableBytes);
  assert(role.runtime.a_to_b_wire_bytes > tableBytes);
  assert(role.runtime.b_to_a_wire_bytes > 0);
}

function assertThresholdRole(role, expectedRole, kernel, runId, schedules) {
  assert.equal(role.schema, "seams.ml-dsa-worker-threshold.v1");
  assert.equal(role.role, expectedRole);
  assert.equal(role.kernel, kernel);
  assert.equal(role.run_id, runId);
  assert.equal(role.disposable_test_key, true);
  assert.equal(role.public_fixture_only, kernel === "threshold-fixture");
  assert.equal(role.standard_signature_verified, true);
  assert.equal(role.public_key_hex.length, 1952 * 2);
  assert.equal(role.signature_hex.length, 3309 * 2);
  assert.equal(role.message_hex.length, 64);
  assert.equal(role.context_hex, "");
  assert(Number.isInteger(role.attempts) && role.attempts >= 1 && role.attempts <= 821);
  assert.equal(role.retry_count, role.attempts - 1);
  assert.equal(role.challenge_hashes_hex.length, role.attempts);
  assertKernelResources(role, {
    seed: 1,
    sampling: 11,
    rounding: 6,
    "signing-seed": 1,
    "signing-mask": 5 * role.attempts,
    "commitment-high": 6 * role.attempts,
    "commitment-hash": role.attempts,
    "response-check": 5 * role.attempts,
    "row-check": 6 * role.attempts,
    "aggregate-check": role.attempts,
  }, schedules);
  assert.equal(role.runtime.accepted_share_bytes, 5312);
  assert.equal(role.runtime.signature_return_bytes, 3309);
  assert.equal(role.transport.credit_window_messages, 8);
  assert(role.transport.largest_pending_messages <= 8);
  assert(role.transport.largest_runtime_message_bytes <= 376_880);
  assert(Number.isInteger(role.wasm_linear_memory_highwater_bytes));
  assert(role.wasm_linear_memory_highwater_bytes > 0);
  for (const name of ["seed", "seed_hex", "own_material", "private_key", "output", "output_hex"]) {
    assert.equal(Object.hasOwn(role, name), false);
  }
}

function assertThresholdReport(report, kernel, runId, fixture, schedules) {
  assert.equal(report.schema, "seams.ml-dsa-worker-threshold.v1");
  assert.equal(report.ok, true);
  assert.equal(report.production_eligible, false);
  assert.equal(report.kernel, kernel);
  assert.equal(report.run_id, runId);
  assertThresholdRole(report.roles.a, "a", kernel, runId, schedules);
  assertThresholdRole(report.roles.b, "b", kernel, runId, schedules);
  const a = report.roles.a;
  const b = report.roles.b;
  for (const field of ["public_key_hex", "signature_hex", "message_hex", "context_hex", "attempts", "challenge_hashes_hex"]) {
    assert.deepEqual(a[field], b[field]);
  }
  for (const field of ["execution_bindings_sha256", "circuit_count", "table_bytes", "a_to_b_wire_bytes", "b_to_a_wire_bytes", "ot_wire_bytes"]) {
    assert.deepEqual(a.runtime[field], b.runtime[field]);
  }
  assert.equal(a.runtime.a_to_b_wire_bytes, a.transport.sent_runtime_bytes);
  assert.equal(a.runtime.b_to_a_wire_bytes, a.transport.received_runtime_bytes);
  assert.equal(b.runtime.a_to_b_wire_bytes, b.transport.received_runtime_bytes);
  assert.equal(b.runtime.b_to_a_wire_bytes, b.transport.sent_runtime_bytes);
  assert.equal(a.transport.sent_ack_bytes, b.transport.received_ack_bytes);
  assert.equal(b.transport.sent_ack_bytes, a.transport.received_ack_bytes);
  const publicKey = Buffer.from(a.public_key_hex, "hex");
  const message = Buffer.from(a.message_hex, "hex");
  const signature = Buffer.from(a.signature_hex, "hex");
  const key = standardKey(publicKey);
  assert.equal(key.asymmetricKeyType, "ml-dsa-65");
  assert.equal(verify(null, message, key, signature), true);
  const changedMessage = Buffer.from(message);
  changedMessage[0] ^= 1;
  const changedSignature = Buffer.from(signature);
  changedSignature[0] ^= 1;
  const changedKey = Buffer.from(publicKey);
  changedKey[0] ^= 1;
  assert.equal(verify(null, changedMessage, key, signature), false);
  assert.equal(verify(null, message, key, changedSignature), false);
  assert.equal(verify(null, message, standardKey(changedKey), signature), false);
  assert.equal(a.message_hex, fixture.message_hex);
  if (kernel === "threshold-fixture") {
    assert.equal(a.public_key_hex, fixture.public_key_hex);
    assert.equal(a.signature_hex, fixture.deterministic_signature_hex);
  }
  return {
    kind: "standard-ml-dsa-65-signature",
    verifier: "Node crypto backed by the recorded OpenSSL version",
    verified: true,
    changed_message_rejected: true,
    changed_signature_rejected: true,
    changed_public_key_rejected: true,
    fips_context_hex: "",
    canonical_fixture_bytes_checked: kernel === "threshold-fixture",
  };
}

function assertKeygenReport(report, kernel, runId, fixture, schedules) {
  assert.equal(report.schema, "seams.ml-dsa-worker-keygen.v1");
  assert.equal(report.ok, true);
  assert.equal(report.production_eligible, false);
  assert.equal(report.kernel, kernel);
  assert.equal(report.run_id, runId);
  const a = report.roles.a;
  const b = report.roles.b;
  for (const role of [a, b]) {
    assert.equal(role.schema, report.schema);
    assert.equal(role.kernel, kernel);
    assert.equal(role.run_id, runId);
    assert.equal(role.disposable_test_key, true);
    assert.equal(role.public_fixture_only, kernel === "keygen-fixture");
    assert.equal(role.public_key_hex.length, 1952 * 2);
    assert.equal(role.own_material_bytes, 17_472);
    assertKernelResources(role, { seed: 1, sampling: 11, rounding: 6 }, schedules);
    assert.equal(role.runtime.accepted_share_bytes, 0);
    assert.equal(role.runtime.signature_return_bytes, 0);
    assert.equal(role.transport.credit_window_messages, 8);
    assert(role.transport.largest_pending_messages <= 8);
    assert(role.transport.largest_runtime_message_bytes <= 376_880);
    assert(Number.isInteger(role.wasm_linear_memory_highwater_bytes));
    assert(role.wasm_linear_memory_highwater_bytes > 0);
    for (const name of ["seed", "seed_hex", "own_material", "private_key", "output", "output_hex", "signature_hex"]) {
      assert.equal(Object.hasOwn(role, name), false);
    }
  }
  assert.equal(a.role, "a");
  assert.equal(b.role, "b");
  assert.equal(a.public_key_hex, b.public_key_hex);
  for (const field of ["execution_bindings_sha256", "circuit_count", "table_bytes", "a_to_b_wire_bytes", "b_to_a_wire_bytes", "ot_wire_bytes"]) {
    assert.deepEqual(a.runtime[field], b.runtime[field]);
  }
  assert.equal(a.runtime.a_to_b_wire_bytes, a.transport.sent_runtime_bytes);
  assert.equal(a.runtime.b_to_a_wire_bytes, a.transport.received_runtime_bytes);
  assert.equal(b.runtime.a_to_b_wire_bytes, b.transport.received_runtime_bytes);
  assert.equal(b.runtime.b_to_a_wire_bytes, b.transport.sent_runtime_bytes);
  assert.equal(a.transport.sent_ack_bytes, b.transport.received_ack_bytes);
  assert.equal(b.transport.sent_ack_bytes, a.transport.received_ack_bytes);
  assert.equal(standardKey(Buffer.from(a.public_key_hex, "hex")).asymmetricKeyType, "ml-dsa-65");
  if (kernel === "keygen-fixture") assert.equal(a.public_key_hex, fixture.public_key_hex);
  return {
    kind: "canonical-ml-dsa-65-key-generation",
    verifier: "Node crypto parses the standard key; the fixed case checks independent canonical bytes",
    standard_public_key_parsed: true,
    canonical_fixture_bytes_checked: kernel === "keygen-fixture",
    role_private_material_bytes: 17_472,
    signature_generated: false,
  };
}

async function oneSample(endpoint, token, kernel, expectedDigest, identity, warmup) {
  const startedAt = new Date().toISOString();
  const runId = randomBytes(16).toString("hex");
  const url = new URL("/benchmark", endpoint);
  url.searchParams.set("kernel", kernel);
  url.searchParams.set("run_id", runId);
  const started = performance.now();
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(360_000),
  });
  const responseHeadersMs = performance.now() - started;
  const body = await response.text();
  const completeMs = performance.now() - started;
  assert.equal(response.status, 200, `Kernel ${kernel} failed: ${body.slice(0, 3000)}`);
  const report = JSON.parse(body);
  let clientVerification;
  if (isThreshold(kernel)) {
    clientVerification = assertThresholdReport(report, kernel, runId, identity.threshold_fixture, identity.schedule_resources);
  } else if (isKeygen(kernel)) {
    clientVerification = assertKeygenReport(report, kernel, runId, identity.threshold_fixture, identity.schedule_resources);
  } else {
    assertReport(report, kernel, runId, expectedDigest);
    clientVerification = { kind: "private-kernel-fixture", expected_role_outputs_match: true };
  }
  return { warmup, started_at: startedAt, finished_at: new Date().toISOString(), client_response_headers_ms: responseHeadersMs, client_complete_ms: completeMs, client_verification_ms: performance.now() - started - completeMs, client_verification: clientVerification, report };
}

function median(values) {
  const sorted = [...values].sort(compareNumbers);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[center - 1] + sorted[center]) / 2 : sorted[center];
}

function compareNumbers(left, right) {
  return left - right;
}

function sampleElapsed(sample) {
  return sample.client_complete_ms;
}

function assertFreshBinding(sample, bindings, jointPublicKeys) {
  const binding = isPipeline(sample.report.kernel)
    ? sample.report.roles.a.runtime.execution_bindings_sha256
    : sample.report.roles.a.runtime.execution_binding_sha256;
  assert.match(binding, /^[a-f0-9]{64}$/);
  assert.equal(bindings.has(binding), false, "The runtime reused an execution binding");
  bindings.add(binding);
  if (sample.report.kernel === "keygen-joint" || sample.report.kernel === "threshold-joint") {
    const publicKey = sample.report.roles.a.public_key_hex;
    assert.equal(jointPublicKeys.has(publicKey), false, "The pipeline reused a joint key");
    jointPublicKeys.add(publicKey);
  }
}

async function exercise(options, endpoint, token, identity) {
  const unauthorized = await fetch(new URL("/benchmark?kernel=seed&run_id=00000000000000000000000000000000", endpoint));
  assert.equal(unauthorized.status, 401);
  await unauthorized.arrayBuffer();
  const cases = [];
  const bindings = new Set();
  const jointPublicKeys = new Set();
  for (const kernel of options.kernels) {
    let expectedDigest = null;
    for (const schedule of identity.schedules) {
      if (schedule.path.endsWith(`/${kernel}.bin`)) expectedDigest = schedule.sha256;
    }
    if (!isPipeline(kernel)) assert.equal(typeof expectedDigest, "string", "The local schedule identity is missing");
    if (!options.local) await delay(1200);
    const warmup = await oneSample(endpoint, token, kernel, expectedDigest, identity, true);
    assertFreshBinding(warmup, bindings, jointPublicKeys);
    const measured = [];
    for (let index = 0; index < options.samples; index += 1) {
      if (!options.local) await delay(1200);
      const sample = await oneSample(endpoint, token, kernel, expectedDigest, identity, false);
      assertFreshBinding(sample, bindings, jointPublicKeys);
      measured.push(sample);
    }
    const elapsed = measured.map(sampleElapsed);
    cases.push({
      kernel,
      warmup,
      samples: measured,
      client_complete_ms: { median: median(elapsed), minimum: Math.min(...elapsed), maximum: Math.max(...elapsed) },
    });
    process.stdout.write(`${kernel}: ${median(elapsed).toFixed(1)} ms median (${options.samples} samples)\n`);
  }
  return { unauthorized_request_rejected: true, unique_execution_bindings: bindings.size, unique_joint_public_keys: jointPublicKeys.size, cases };
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const token = options.local ? randomBytes(32).toString("hex") : process.env.PROBE_TOKEN;
  assert(typeof token === "string" && token.length === 64, "PROBE_TOKEN must contain 64 characters");
  const identity = await provenance();
  let local = null;
  try {
    if (options.local) local = await localRuntime(token);
    const endpoint = local === null ? options.endpoint : local.endpoint;
    const result = await exercise(options, endpoint, token, identity);
    const artifact = {
      schema: "seams.ml-dsa-cloudflare-threshold-investigation.v1",
      created_at: new Date().toISOString(),
      environment: options.local ? "local-workerd" : "hosted-cloudflare",
      endpoint,
      public_fixture_only: !options.kernels.includes("threshold-joint") && !options.kernels.includes("keygen-joint"),
      disposable_test_keys_only: true,
      security_scope: "Disposable fixed fixtures and fresh joint keys run with genuine Chou-Orlandi and IKNP OT. Complete key generation and threshold signing use the shared resumable core. No wallet admission, durable shares, production peer authentication, or authorized cloud export flow is implemented.",
      measurement_scope: "Client wall time includes request and response transport. Worker Date.now observations are elapsed markers. CPU billing and actual physical placement require separate platform evidence.",
      sampling_scope: "One warm-up precedes each kernel. The measured samples establish observed latency only; they do not establish a production tail-latency bound.",
      provenance: identity,
      ...result,
    };
    await writeFile(options.out, `${JSON.stringify(artifact, null, 2)}\n`);
    process.stdout.write(`Saved ${options.out}\n`);
  } finally {
    if (local !== null) await local.runtime.dispose();
  }
}

await main();
