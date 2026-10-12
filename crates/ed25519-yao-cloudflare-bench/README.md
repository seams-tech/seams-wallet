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

## Local run

```sh
pnpm exec wrangler dev --local -c wrangler.a.prebuilt.json -c wrangler.b.prebuilt.json --port 8787 --show-interactive-dev-session=false
node scripts/run_same_account_benchmark.mjs 6 http://127.0.0.1:8787/benchmark/activation
```

The driver prints one JSON report. `total_protocol_duration_ms` is Deriver A's
clock-visible protocol time, from its protocol start to the response EOF. On a
Worker `Date.now()` advances only at I/O, so the figure excludes CPU after the
last incoming message. Local workerd on an M4 Pro measured 134 ms on
October 12, 2026; the July 2026 local report measured 141 ms.

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
