# Production WASM release profile

The package release workflow now sets `WASM_SDK_BUILD_MODE=prod` for `pnpm build`.
It uses the existing production branch of the WASM build script. This builds
Shamir3Pass, EVM crypto, Tempo, and Email OTP runtimes with `--release`; the main
signing and custody modules already explicitly used release mode. No cryptographic
algorithm, group, wire format, persistence schema, or session authority changed.

The [deployment audit](./registration-deployment-build-audit.md) identified that
published version 0.5.33 had built the four auxiliary runtimes with `--dev --no-opt`.
The fix applies to future package releases; it does not replace deployed artifacts.
Local development retains its existing build mode. Manual builds intended for
publication must also use `WASM_SDK_BUILD_MODE=prod`.

## Measurement method

Shamir3Pass was compiled from the same source and locked dependencies using:

```sh
wasm-pack build --locked --target web \
  --out-dir /tmp/seams-shamir-release-profile \
  --out-name shamir3pass_runtime --release
```

The existing registration benchmark ran 20 alternating-order pairs on a frozen
SDK/demo snapshot and fixed local backend, with the optimized backend signing
worker from the previous investigation. The only cohort difference was the
Shamir3Pass WASM and its matching generated JavaScript bindings. Both worker
bundles were built from identical worker source with Bun. Browser routing served
the selected artifact, and each test asserted that both the WASM and worker
script were requested. Routing and cache behavior were the same for both cohorts.

Each run created a fresh wallet and verified NEAR threshold signatures before
and after refresh. Public-chain RPCs were stubbed and passkeys used a virtual
authenticator. These local measurements exclude human interaction, deployed
network geography, and NEAR transaction inclusion. No deployed speedup is claimed.

The development WASM was 654,272 bytes; release WASM was 93,119 bytes, an 85.8%
reduction. The two SHA-256 hashes are recorded with the timing samples.

An initial benchmark setup was rejected by the lifecycle harness because the
copied file had an unrecognized name. It was corrected before the measured run;
no application or lifecycle behavior was changed to accommodate it.

## Results

All 40 measured registrations passed. Medians and nearest-rank p95 are in
milliseconds, with 20 samples per profile.

| Stage | Development median | Release median | Development p95 | Release p95 |
| --- | ---: | ---: | ---: | ---: |
| Full NEAR readiness | 974.2 | 930.6 | 1008.8 | 978.1 |
| EVM registration return | 641.5 | 639.0 | 674.0 | 681.0 |
| Seal preparation | 56.5 | 7.2 | 63.6 | 8.3 |
| Client seal | 44.0 | 3.0 | 46.0 | 4.0 |
| Client unseal | 43.0 | 3.0 | 45.0 | 3.0 |
| Hydration | 92.5 | 53.0 | 98.4 | 55.8 |
| Hydration server request | 47.5 | 47.0 | 49.0 | 49.0 |

Median full readiness improved by 43.6 ms (4.5%). Seventeen of twenty pairs
improved; median paired savings were 33.8 ms. Hydration fell by 39.5 ms (42.7%).
The corresponding server request barely changed, supporting the client runtime
as the cause. Seal preparation was already overlapped with custody, so its
49.3-ms improvement does not add another 49.3 ms to the full-readiness gain.
Client-seal timings recorded under hydration describe the earlier preparation;
they are not an additional sequential hydration stage.

EVM return was effectively unchanged in this sample, and its p95 rose slightly.
Twenty samples per cohort do not establish production tail latency. The
[server-seal investigation](./server-seal-release-profile.md) subsequently
confirmed that the same release-profile fix also reduces the server request.

[Timing samples and artifact hashes](./shamir-release-profile-latency.json)

The fixed SDK snapshot contained custody overlap from `2b147d2`. The workflow
correction is `a55e944`. The benchmark specifically isolates Shamir3Pass; it does
not measure the other three runtimes also affected by production build mode.

## Verification

- Isolated release WASM build passed.
- Two Shamir3Pass Rust tests passed in release mode.
- Five client-seal ownership unit tests passed.
- Seventeen NEAR registration contracts passed with the release WASM and matching
  worker bindings, including held custody, exact replay, lock, zero quota,
  readiness rollback, hydration failure, and refresh signing.
- Forty alternating benchmark runs passed; each verified both selected artifact
  requests and NEAR signatures before and after refresh.
- `actionlint` passed for the changed release workflow; its parsed build step
  explicitly selects `WASM_SDK_BUILD_MODE=prod`.

The full multi-package release build and deployment were not run. This validates
Shamir3Pass and the workflow selection; it does not constitute new lifecycle
coverage for every auxiliary module. The active demo artifacts were preserved.
Release/publishing, Console adoption, and deployed cold-start/regional measurement
remain pending the release hold.
