# Ed25519 Yao Cloudflare benchmark pair

Benchmark-only Workers for the fixed activation circuit with the 128 KiB
stream profile. Deriver A opens one binary WebSocket to Deriver B through the
private `DERIVER_B` Service Binding and runs the fixed ceremony on fixed
fixtures. There is no production route, no admission, no session state and no
sealing: this pair measures what the platform and the engine cost by
themselves. The deployed July 2026 campaigns measured it at 202 ms p50; the
production path measured about 800 ms in October 2026. R155H Phase 0 redeploys
this pair to find out which part of that gap is the platform.

The crate was deleted on October 1, 2026 (commit `23944e26`) and restored on
October 12 for that check, with its deployment, cost, isolation and Phase 13A
tooling left out: that tooling failed on files this repository no longer has.
The Phase 9B and R120 reports live in `crates/ed25519-yao/docs/`.

## Toolchain

The Workers pin `worker` and `worker-sys` 0.8.5 and `wasm-bindgen` 0.2.126 in
this crate's own `Cargo.lock`. Production and CI pin 0.8.4 and 0.2.123, so this
crate is not in the pnpm workspace and no CI lane builds it. Install the
matching `worker-build` once, in its own root, and put it first on `PATH`
for the build commands below:

```sh
npm run worker-build:install
export PATH="$HOME/.cargo/worker-build-0.8.5/bin:$PATH"
```

The engine side is the `phase9-role-benchmark` feature of `crates/ed25519-yao`.

## Build

```sh
npm run build:b
npm run build:a
```

`build/deriver-a/` and `build/deriver-b/` hold the bundles. The
`wrangler.*.prebuilt.json` configs are the `wrangler.*.jsonc` configs without
the `build` block, so `wrangler dev` and `wrangler deploy` use these bundles
instead of rebuilding with whatever `worker-build` is on `PATH`.

## The yield variant

`yield-after-table-frame` makes Deriver A await a zero-length `worker::Delay`
after each table frame. Without it the WebSocket only queues the frames, they
all leave after the last one is garbled, and Deriver B evaluates afterwards.
Build it beside the default role and deploy either under the same name:

```sh
worker-build --release --out-dir build/deriver-a-yield --features deriver-a-same-account-websocket,yield-after-table-frame
```

The [record of October 12, 2026](../../docs/evidence/refactor-155h-probe-hosted.md)
measured 290–350 ms against 520–640 ms per ceremony in Tokyo. Production's
transport in `crates/router-ab-cloudflare/src/ed25519_yao_websocket.rs` holds
the same yield.

## Local run

```sh
pnpm exec wrangler dev --local -c wrangler.a.prebuilt.json -c wrangler.b.prebuilt.json --port 8787 --show-interactive-dev-session=false
node scripts/run_same_account_benchmark.mjs 6 http://127.0.0.1:8787/benchmark/activation
```

The driver prints one JSON report. `total_protocol_duration_ms` is Deriver A's
clock-visible protocol time, from its protocol start to the response EOF. On a
Worker `Date.now()` excludes the invocation's own CPU time, so the figure is
waits only. Client wall and the tail's `wallTime` are the real durations.
Local workerd on an M4 Pro measured 134 ms on October 12, 2026; the July 2026
local report measured 141 ms.

## Deployed run

Deploy B, then A, from the repository root so the pinned Wrangler is used:

```sh
pnpm exec wrangler deploy --config crates/ed25519-yao-cloudflare-bench/wrangler.b.prebuilt.json
pnpm exec wrangler deploy --config crates/ed25519-yao-cloudflare-bench/wrangler.a.prebuilt.json
```

A publishes a `workers.dev` endpoint; Wrangler prints it. Then:

```sh
node crates/ed25519-yao-cloudflare-bench/scripts/run_same_account_benchmark.mjs 21 https://<a-endpoint>/benchmark/activation
```

The first sample is the warm-up; report p50 and p95 of the rest. Collect CPU
per invocation with `pnpm exec wrangler tail <worker> --format json` on both
Workers during the run. Delete both Workers afterwards:

```sh
pnpm exec wrangler delete --config crates/ed25519-yao-cloudflare-bench/wrangler.a.prebuilt.json
pnpm exec wrangler delete --config crates/ed25519-yao-cloudflare-bench/wrangler.b.prebuilt.json
```

The A endpoint is public and unauthenticated. It serves fixed fixtures and
holds no secret, but it burns CPU for anyone who calls it, so it exists only
for the duration of a measurement.

## Tests

```sh
node scripts/test_local_benchmark_tooling.mjs
cargo test --test source_guards
```

The fault and cross-account configurations build with their features and
their `smoke:*` scripts still run against `wrangler dev`; they are kept as
they were.

## ML-DSA raw transport probe

`src/transport_probe.mjs` measures synthetic binary transport between two separate
Workers. It does not run a signing protocol. The isolated
`wrangler.transport.{a,b}.jsonc` configurations use temporary names
`ml-dsa-probe-20261013-a` and `ml-dsa-probe-20261013-b`.
They do not change the Ed25519 benchmark pair.

The campaign compares HTTP request streaming with binary WebSockets. Each uses
both a direct A-to-B Service Binding and a wallet Durable Object on each side.
The wallet path is A Worker → A wallet object → B Worker → B wallet object.
The payload sizes are exactly 8,000,000, 32,000,000, and 64,000,000 bytes.
Each payload frame contains 64 KiB or 128 KiB, plus an eight-byte sequence header.
HTTP awaits each stream write. WebSockets permit eight outstanding frames,
then require receiver credit. The report records these limits.

The receiver checks frame order, exact byte count, and a rolling Adler-32 checksum.
The payload contains public synthetic bytes. Adler-32 detects accidental changes.
It provides no cryptographic integrity guarantee.

Run the local E2E campaign from the repository root:

```sh
node crates/ed25519-yao-cloudflare-bench/scripts/run_transport_probe.mjs \
  --local --samples 1 --out /tmp/ml-dsa-transport-local.json
```

The driver uses the installed Miniflare and workerd. It reads both Wrangler
configurations and creates fresh local wallet objects. It keeps runtime state in
`/tmp` and removes that state after the run. Local authentication uses a random
in-memory token when `PROBE_TOKEN` is absent.

The E2E campaign verifies all 24 combinations, with one warm-up per combination.
It also checks public authentication rejection, truncated HTTP and WebSocket
payloads, and a slow HTTP receiver. The JSON report is the repeatable artifact.
`--quick` selects only 8 MB and 64 KiB frames. `--samples` counts measured runs
per combination and defaults to five. Warm-up runs remain in the report.

For a hosted campaign, authenticate with `pnpm exec wrangler whoami` first.
Install the same `PROBE_TOKEN` secret on both temporary Workers. The token must
contain at least 32 characters. Use Wrangler `secret bulk` with a restricted
JSON file containing `PROBE_TOKEN`. Keep that file outside the repository.
Deploy B, then A:

```sh
pnpm exec wrangler deploy --config crates/ed25519-yao-cloudflare-bench/wrangler.transport.b.jsonc
pnpm exec wrangler deploy --config crates/ed25519-yao-cloudflare-bench/wrangler.transport.a.jsonc
node crates/ed25519-yao-cloudflare-bench/scripts/run_transport_probe.mjs \
  --endpoint https://<a-endpoint> --samples 5 --out /tmp/ml-dsa-transport-hosted.json
```

The driver reads `PROBE_TOKEN` from its environment. It never writes the token
into the report. Only A has a public endpoint. Both roles require authentication.

Client wall time includes actual elapsed time. The streamed report also records
client arrival times for setup, first payload byte, last payload byte, receiver
completion, and sender acknowledgement. Those arrivals include the return path.
Network buffering can combine several events. Worker `Date.now()` observations
omit that invocation's own CPU time. Collect tail `cpuTime` and `wallTime` for
both Workers and wallet objects when interpreting hosted results.

The report separates intended placement from reported request colo. Both wallet
objects request the `apac` location hint. Cloudflare gives no placement guarantee
for this hint. Actual wallet object locations remain unknown. This probe uses no
D1, so D1 placement is not applicable. It measures generation and checksum CPU
along with transport. It does not measure peak runtime memory or garbled-circuit
cost. The credit window can limit throughput when round-trip latency is high.

Cloudflare documents [streaming](https://developers.cloudflare.com/workers/runtime-apis/streams/),
[WebSocket frame buffering](https://developers.cloudflare.com/workers/runtime-apis/websockets/#reading-binary-payloads),
and [Durable Object location hints](https://developers.cloudflare.com/durable-objects/reference/data-location/#provide-a-location-hint).
The configurations use the existing benchmark's compatibility date so the pinned
local workerd can execute the same API behavior.

After collection, delete A, then B. Remove the temporary secret file:

```sh
pnpm exec wrangler delete --config crates/ed25519-yao-cloudflare-bench/wrangler.transport.a.jsonc
pnpm exec wrangler delete --config crates/ed25519-yao-cloudflare-bench/wrangler.transport.b.jsonc
```
