# Server-seal request latency

The roughly 47 ms local server-seal request was mainly server-side Shamir3Pass
work built with the development WASM profile. The existing package-release fix
in `a55e944` sets `WASM_SDK_BUILD_MODE=prod` for the shared build. The root build
compiles WASM before Wallet Server copies it into its package, so this fix applies
to the server runtime as well as the browser runtime. No protocol or route change
is needed to obtain the measured server improvement in the next release.

## Evidence

The gateway's existing operation log measured a 35 ms median for five baseline
requests; the browser measured 46 ms for the request. The server uses the same
Shamir3Pass WASM module as the optimized client from the
[prior investigation](./shamir-release-profile.md).

A separate 50-sample experiment applied the server lock to the same synthetic
ciphertext, group, root, and context with each build profile. The median WASM
operation took 38.4 ms in development mode and 2.1 ms in release mode. This
isolates the expensive modular operation from authentication and transport.

For a complete request comparison, five fresh passkey registrations used each
server profile. The SDK was frozen with the optimized client runtime. Router A/B
roles and local runtime configuration were unchanged. An isolated copy of Wallet
Server served release WASM; the original package served development WASM. Each
registration verified NEAR signing before and after refresh.

| Median, milliseconds | Development server | Release server |
| --- | ---: | ---: |
| Server seal operation | 35 | 2 |
| Browser seal request | 46 | 13 |
| Session hydration | 53.4 | 20.3 |
| Full NEAR readiness | 932.0 | 890.4 |
| Custody join | 320.4 | 321.3 |
| EVM registration return | 644 | 640 |

The measured 33 ms server-operation reduction explains the 33 ms request and
hydration reductions. The remaining 11 ms between the release server operation
and browser request includes local routing, authorization, serialization, and
transport. This comparison does not isolate those costs individually.

The full-readiness difference is 41.6 ms (4.5%) in these five-run cohorts. They
ran in separate batches, so this is directional evidence rather than a precise
production gain or p95 estimate. The server operation and request deltas are the
stronger causal evidence. Local Workers, virtual passkeys, and stubbed public
chain RPCs cannot predict deployed regional latency or cold starts.

The isolated package retained the existing generated JavaScript bindings while
replacing WASM from the same source and locked dependencies. All five full
registration flows passed, demonstrating matching bindings for the tested path.
The actual release build regenerates its own bindings and copies the optimized
WASM to Wallet Server.

[Timing-only samples](./server-seal-release-profile-latency.json)

## Release state

The source fix is committed, and this investigation adds measurement evidence.
The currently deployed `@seams/wallet-server` release still contains development
Shamir3Pass WASM. Publishing, Console adoption, deployment, and deployed
measurement remain under the existing release hold.

## Verification

- Five development-server and five release-server registrations passed, each
  verifying NEAR signing before and after refresh.
- Seventeen focused registration contracts passed with the isolated release
  server package and optimized client runtime. They covered held admission and
  execution, persisted replay, same-tab and cross-tab lock, zero quota,
  readiness rollback, hydration failure, and refresh signing.
- The earlier release workflow change passed `actionlint`, and the isolated
  release Shamir3Pass build passed its two Rust tests.

No production package was published. Full package build and live Cloudflare
version readback remain part of release validation.
