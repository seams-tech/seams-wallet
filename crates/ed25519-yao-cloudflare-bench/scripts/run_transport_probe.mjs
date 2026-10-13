import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [8_000_000, 32_000_000, 64_000_000];
const CHUNKS = [65_536, 131_072];
const PATHS = ["direct", "wallet-do"];
const TRANSPORTS = ["http", "websocket"];
const REQUIRE = createRequire(import.meta.url);
const SOURCE_FILES = [
  "src/transport_probe.mjs",
  "scripts/run_transport_probe.mjs",
  "wrangler.transport.a.jsonc",
  "wrangler.transport.b.jsonc",
];

function argumentsFrom(argv) {
  const options = { local: false, endpoint: null, out: null, samples: 5, quick: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--local") options.local = true;
    else if (name === "--quick") options.quick = true;
    else if (["--endpoint", "--out", "--samples"].includes(name)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`Missing ${name} value`);
      index += 1;
      if (name === "--endpoint") options.endpoint = value;
      else if (name === "--out") options.out = value;
      else options.samples = Number(value);
    } else throw new Error(`Unknown argument ${name}`);
  }
  if (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 100) throw new Error("Samples must be 1 through 100");
  if (options.local === (options.endpoint !== null)) throw new Error("Choose --local or --endpoint URL");
  return options;
}

async function hashedFile(path) {
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function packageIdentity(name) {
  const path = REQUIRE.resolve(`${name}/package.json`);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  return { name: manifest.name, version: manifest.version, manifest: await hashedFile(path) };
}

async function provenance() {
  const sources = [];
  for (const path of SOURCE_FILES) sources.push(await hashedFile(resolve(ROOT, path)));
  const packages = [];
  for (const name of ["wrangler", "miniflare", "workerd"]) packages.push(await packageIdentity(name));
  const workerd = REQUIRE("workerd");
  return {
    captured_at: new Date().toISOString(),
    sources,
    runtime: {
      node: { version: process.version, platform: process.platform, architecture: process.arch, v8: process.versions.v8, binary: await hashedFile(process.execPath) },
      installed_packages: packages,
      local_workerd: { version: workerd.version, compatibility_date: workerd.compatibilityDate, binary: await hashedFile(workerd.default) },
      hosted_runtime: "Cloudflare runtime identity requires separate deployment or platform evidence",
    },
    reproduction: {
      working_directory: process.cwd(),
      argv: [process.execPath, ...process.argv.slice(1)],
      authentication: "PROBE_TOKEN environment value is required for hosted runs and is never recorded",
    },
  };
}

async function localRuntime(token) {
  const { Miniflare, Log, LogLevel } = await import("miniflare");
  const state = await mkdtemp(resolve(tmpdir(), "ml-dsa-transport-"));
  const configurations = await Promise.all(["a", "b"].map(async role => JSON.parse(await readFile(resolve(ROOT, `wrangler.transport.${role}.jsonc`), "utf8"))));
  const workers = configurations.map(configuration => ({
    name: configuration.name,
    modules: true,
    scriptPath: resolve(ROOT, configuration.main),
    compatibilityDate: configuration.compatibility_date,
    bindings: { ...configuration.vars, PROBE_TOKEN: token },
    serviceBindings: Object.fromEntries((configuration.services ?? []).map(service => [service.binding, service.service])),
    durableObjects: Object.fromEntries(configuration.durable_objects.bindings.map(binding => [binding.name, { className: binding.class_name, useSQLite: true }])),
  }));
  const runtime = new Miniflare({
    host: "127.0.0.1",
    port: 0,
    log: new Log(LogLevel.ERROR),
    durableObjectsPersist: resolve(state, "durable-objects"),
    workers,
  });
  await runtime.ready;
  return { runtime, state, endpoint: String(await runtime.ready) };
}

function expectedChecksum(bytes) {
  let a = 1;
  let b = 0;
  for (let offset = 0; offset < bytes; offset += 5552) {
    const end = Math.min(offset + 5552, bytes);
    for (let index = offset; index < end; index += 1) {
      a += index & 255;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, "0");
}

function probeUrl(endpoint, probe, wallet) {
  const url = new URL("/probe", endpoint);
  url.searchParams.set("bytes", probe.bytes);
  url.searchParams.set("chunk_bytes", probe.chunkBytes);
  url.searchParams.set("path", probe.path);
  url.searchParams.set("transport", probe.transport);
  url.searchParams.set("receiver_delay_ms", probe.receiverDelayMs);
  url.searchParams.set("fault", probe.fault);
  url.searchParams.set("wallet", wallet);
  return url;
}

async function oneProbe(endpoint, token, probe, wallet, checksum, warmup) {
  const started = performance.now();
  const response = await fetch(probeUrl(endpoint, probe, wallet), {
    headers: { "x-ml-dsa-probe-token": token },
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(response.status, 200, `Probe HTTP ${response.status}`);
  assert.ok(response.body, "Probe must stream its events");
  const headersMs = performance.now() - started;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let end = pending.indexOf("\n");
    while (end !== -1) {
      const event = JSON.parse(pending.slice(0, end));
      events.push({ ...event, client_arrival_ms: performance.now() - started });
      pending = pending.slice(end + 1);
      end = pending.indexOf("\n");
    }
  }
  assert.equal(pending, "", "Probe response must end at a record boundary");
  const clientWallMs = performance.now() - started;
  const acknowledgement = events.find(event => event.event === "sender_ack");
  assert.ok(acknowledgement, "Sender must acknowledge receiver completion or failure");
  if (probe.fault === "truncate") {
    assert.equal(acknowledgement.ok, false, "Truncated payload must fail");
    assert.match(acknowledgement.error, /Truncated payload/);
    assert.equal(events.some(event => event.event === "receiver_complete"), false);
  } else {
    assert.equal(acknowledgement.ok, true, acknowledgement.error);
    const complete = events.find(event => event.event === "receiver_complete");
    assert.ok(complete, "Receiver must report EOF completion");
    assert.equal(complete.payload_bytes, probe.bytes);
    assert.equal(complete.application_frames, Math.ceil(probe.bytes / probe.chunkBytes));
    assert.equal(complete.wire_bytes, probe.bytes + complete.application_frames * 8);
    assert.equal(complete.checksum_adler32, checksum);
    for (const name of ["start", "setup", "receiver_ready", "first_byte", "last_byte"]) {
      assert.ok(events.some(event => event.event === name), `Missing ${name} event`);
    }
    const start = events.find(event => event.event === "start");
    const ready = events.find(event => event.event === "receiver_ready");
    assert.equal(start.sender.inside_wallet_do, probe.path === "wallet-do");
    assert.equal(ready.receiver.inside_wallet_do, probe.path === "wallet-do");
  }
  return { probe, warmup, client_headers_ms: headersMs, client_wall_ms: clientWallMs, events };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function concurrentRequest(index, startedAt, endpoint, token, probe, wallet, checksum) {
  const launchOffsetMs = performance.now() - startedAt;
  const result = await oneProbe(endpoint, token, probe, wallet, checksum, false);
  return { request_index: index, client_launch_offset_ms: launchOffsetMs, ...result };
}

async function concurrentWave(concurrency, endpoint, token, probe, wallet, checksum, waveIndex) {
  const startedAt = performance.now();
  const pending = [];
  for (let index = 0; index < concurrency; index += 1) {
    pending.push(concurrentRequest(index, startedAt, endpoint, token, probe, wallet, checksum));
  }
  const requests = await Promise.all(pending);
  const wallMs = performance.now() - startedAt;
  const totalPayloadBytes = probe.bytes * concurrency;
  return {
    wave_index: waveIndex,
    simultaneous_requests: concurrency,
    total_payload_bytes: totalPayloadBytes,
    client_group_wall_ms: wallMs,
    aggregate_payload_mb_per_second: totalPayloadBytes / wallMs / 1000,
    requests,
  };
}

async function concurrencyCampaign(options, endpoint, token, wallet, checksum) {
  const levels = options.quick ? [1, 4] : [1, 4, 16];
  const measuredWaves = options.quick ? 1 : options.samples;
  const groups = [];
  for (const path of PATHS) {
    const probe = { path, transport: "http", bytes: 8_000_000, chunkBytes: 131_072, receiverDelayMs: 0, fault: "none" };
    for (const concurrency of levels) {
      const warmup = await oneProbe(endpoint, token, probe, wallet, checksum, true);
      const waves = [];
      for (let index = 0; index < measuredWaves; index += 1) {
        waves.push(await concurrentWave(concurrency, endpoint, token, probe, wallet, checksum, index));
      }
      const durations = waves.flatMap(wave => wave.requests.map(request => request.client_wall_ms));
      const throughputs = waves.map(wave => wave.aggregate_payload_mb_per_second);
      groups.push({
        probe,
        simultaneous_requests: concurrency,
        measured_waves: measuredWaves,
        measured_requests: durations.length,
        client_request_p50_ms: percentile(durations, 0.50),
        client_request_p95_ms: percentile(durations, 0.95),
        aggregate_payload_mb_per_second_p50: percentile(throughputs, 0.50),
        excluded_warmup: warmup,
        waves,
      });
      process.stderr.write(`${path} HTTP concurrency ${concurrency}: ${groups.at(-1).client_request_p50_ms.toFixed(1)} ms request p50; ${groups.at(-1).aggregate_payload_mb_per_second_p50.toFixed(1)} MB/s aggregate p50\n`);
    }
  }
  return {
    scope: "HTTP only, 8 MB per request, 128 KiB frames. Each group shares the same wallet on both roles. One serial warm-up precedes each measured group. Throughput uses aggregate payload bytes and client group wall time.",
    quick_scope: options.quick ? "Quick mode uses one measured wave at concurrency 1 and 4; concurrency 16 is omitted" : "Full concurrency 1, 4, and 16",
    wallet,
    groups,
  };
}

async function runCampaign(options, endpoint, token) {
  const checksum = new Map((options.quick ? [8_000_000] : SIZES).map(bytes => [bytes, expectedChecksum(bytes)]));
  const wallet = `campaign-${randomBytes(8).toString("hex")}`;
  const noAuth = await fetch(probeUrl(endpoint, { bytes: 8_000_000, chunkBytes: 65_536, path: "direct", transport: "http", receiverDelayMs: 0, fault: "none" }, wallet));
  assert.equal(noAuth.status, 401, "Public CPU route must require authentication");
  await noAuth.arrayBuffer();
  const results = [];
  const summaries = [];
  const sizes = options.quick ? [8_000_000] : SIZES;
  const chunks = options.quick ? [65_536] : CHUNKS;
  for (const path of PATHS) {
    for (const transport of TRANSPORTS) {
      for (const bytes of sizes) {
        for (const chunkBytes of chunks) {
          const probe = { path, transport, bytes, chunkBytes, receiverDelayMs: 0, fault: "none" };
          const group = [];
          for (let index = 0; index <= options.samples; index += 1) {
            const result = await oneProbe(endpoint, token, probe, wallet, checksum.get(bytes), index === 0);
            results.push(result);
            if (index > 0) group.push(result.client_wall_ms);
          }
          summaries.push({ probe, measured_samples: group.length, client_wall_p50_ms: percentile(group, 0.50), client_wall_p95_ms: percentile(group, 0.95) });
          process.stderr.write(`${path} ${transport} ${bytes} bytes / ${chunkBytes}: ${summaries.at(-1).client_wall_p50_ms.toFixed(1)} ms p50\n`);
        }
      }
    }
  }
  const checks = [];
  for (const transport of TRANSPORTS) {
    const probe = { path: "wallet-do", transport, bytes: 8_000_000, chunkBytes: 65_536, receiverDelayMs: 0, fault: "truncate" };
    checks.push(await oneProbe(endpoint, token, probe, wallet, checksum.get(probe.bytes), false));
  }
  const slow = { path: "wallet-do", transport: "http", bytes: 8_000_000, chunkBytes: 65_536, receiverDelayMs: 2, fault: "none" };
  checks.push(await oneProbe(endpoint, token, slow, wallet, checksum.get(slow.bytes), false));
  const concurrency = await concurrencyCampaign(options, endpoint, token, wallet, checksum.get(8_000_000));
  return {
    schema: "ml-dsa-transport-probe-v2",
    generated_at: new Date().toISOString(),
    runtime: options.local ? "local workerd through installed Miniflare" : "hosted Cloudflare Workers",
    endpoint,
    placement_scope: "No same-region guarantee. Request colo is reported. Durable Object execution location remains unknown. No D1 is used.",
    clock_scope: "Client wall includes real elapsed time. Worker Date.now observations omit each invocation's own CPU. Client event arrivals include return-path delay and can coalesce.",
    payload_scope: "Public synthetic bytes plus an eight-byte header per application frame. Adler-32 detects accidental transfer changes and is not a cryptographic integrity check.",
    memory_scope: "Sender emits 64 or 128 KiB payload frames. HTTP awaits each stream write. WebSockets allow eight frames before receiver credit. Runtime buffering and peak process memory are not measured.",
    cpu_scope: "Generation, parsing and checksum CPU are included. Tail cpuTime and wallTime require a separate hosted collection.",
    checks: { public_authentication_rejected: true, truncated_payloads_rejected: true, slow_receiver_completed: true, runs: checks },
    summaries,
    runs: results,
    concurrency,
  };
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  let token = process.env.PROBE_TOKEN;
  if (options.local && token === undefined) token = randomBytes(32).toString("hex");
  if (typeof token !== "string" || token.length < 32) throw new Error("Set PROBE_TOKEN to a secret with at least 32 characters");
  let local = null;
  try {
    if (options.local) local = await localRuntime(token);
    const endpoint = local === null ? options.endpoint : local.endpoint;
    const identity = await provenance();
    const report = { provenance: identity, ...await runCampaign(options, endpoint, token) };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.out === null) process.stdout.write(serialized);
    else {
      await writeFile(resolve(options.out), serialized);
      process.stdout.write(`Transport evidence: ${resolve(options.out)}\n`);
    }
  } finally {
    if (local !== null) {
      await local.runtime.dispose();
      await rm(local.state, { recursive: true, force: true });
    }
  }
}

await main();
