import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WALLET_ROOT = resolve(ROOT, "../..");
const REQUIRE = createRequire(import.meta.url);
const KERNELS = ["seed", "sampling-0", "rounding", "mask-0"];
const SOURCES = [
  "src/ml_dsa.rs",
  "src/lib.rs",
  "Cargo.toml",
  "scripts/run_ml_dsa_kernels.mjs",
  "wrangler.ml-dsa.a.jsonc",
  "wrangler.ml-dsa.b.jsonc",
  "../ed25519-yao/src/passive/ml_dsa_runtime.rs",
  "../ed25519-yao/src/passive/gate_aes.rs",
  "../ed25519-yao/src/passive/ot.rs",
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
  for (const kernel of KERNELS) schedules.push(await fileIdentity(resolve(ROOT, `src/ml_dsa_schedules/${kernel}.bin`)));
  const fixtures = [];
  for (const role of ["a", "b"]) fixtures.push(await fileIdentity(resolve(ROOT, `src/ml_dsa_schedules/fixtures-${role}.json`)));
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
    fixtures,
    builds,
    node: { version: process.version, v8: process.versions.v8, platform: process.platform, architecture: process.arch },
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
  assert.match(role.schedule_sha256, /^[a-f0-9]{64}$/);
  assert.equal(role.transport.credit_window_messages, 8);
  assert(role.transport.largest_pending_messages <= 8);
  assert(role.transport.largest_runtime_message_bytes <= 188_464);
  assert.equal(Object.hasOwn(role, "output"), false);
  assert.equal(Object.hasOwn(role, "output_hex"), false);
}

function assertReport(report, kernel, runId) {
  assert.equal(report.schema, "seams.ml-dsa-worker-kernel.v1");
  assert.equal(report.ok, true);
  assert.equal(report.public_fixture_only, true);
  assert.equal(report.kernel, kernel);
  assert.equal(report.run_id, runId);
  assertRole(report.roles.a, "a", kernel, runId);
  assertRole(report.roles.b, "b", kernel, runId);
  assert.equal(report.roles.a.schedule_sha256, report.roles.b.schedule_sha256);
  assert.equal(report.roles.a.runtime.execution_binding_sha256, report.roles.b.runtime.execution_binding_sha256);
  assert.equal(report.roles.a.runtime.garbler_to_evaluator_wire_bytes, report.roles.a.transport.sent_runtime_bytes);
  assert.equal(report.roles.a.runtime.evaluator_to_garbler_wire_bytes, report.roles.a.transport.received_runtime_bytes);
  assert.equal(report.roles.b.runtime.garbler_to_evaluator_wire_bytes, report.roles.b.transport.received_runtime_bytes);
  assert.equal(report.roles.b.runtime.evaluator_to_garbler_wire_bytes, report.roles.b.transport.sent_runtime_bytes);
  assert.equal(report.roles.a.transport.sent_runtime_bytes, report.roles.b.transport.received_runtime_bytes);
  assert.equal(report.roles.b.transport.sent_runtime_bytes, report.roles.a.transport.received_runtime_bytes);
}

async function oneSample(endpoint, token, kernel, warmup) {
  const runId = randomBytes(16).toString("hex");
  const url = new URL("/benchmark", endpoint);
  url.searchParams.set("kernel", kernel);
  url.searchParams.set("run_id", runId);
  const started = performance.now();
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });
  const responseHeadersMs = performance.now() - started;
  const body = await response.text();
  assert.equal(response.status, 200, `Kernel ${kernel} failed: ${body.slice(0, 3000)}`);
  const report = JSON.parse(body);
  assertReport(report, kernel, runId);
  return { warmup, client_response_headers_ms: responseHeadersMs, client_complete_ms: performance.now() - started, report };
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

async function exercise(options, endpoint, token) {
  const unauthorized = await fetch(new URL("/benchmark?kernel=seed&run_id=00000000000000000000000000000000", endpoint));
  assert.equal(unauthorized.status, 401);
  await unauthorized.arrayBuffer();
  const cases = [];
  for (const kernel of options.kernels) {
    const warmup = await oneSample(endpoint, token, kernel, true);
    const measured = [];
    for (let index = 0; index < options.samples; index += 1) {
      measured.push(await oneSample(endpoint, token, kernel, false));
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
  return { unauthorized_request_rejected: true, cases };
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
    const result = await exercise(options, endpoint, token);
    const artifact = {
      schema: "seams.ml-dsa-cloudflare-private-kernels.v1",
      created_at: new Date().toISOString(),
      environment: options.local ? "local-workerd" : "hosted-cloudflare",
      endpoint,
      public_fixture_only: true,
      security_scope: "Disposable public fixtures run with genuine Chou-Orlandi and IKNP input OT. This experiment has no wallet secrets, persistent signing shares, production peer authentication, or threshold signatures.",
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
