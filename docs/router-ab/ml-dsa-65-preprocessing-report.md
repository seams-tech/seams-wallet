# ML-DSA-65 preprocessing prototype

Date: October 14, 2026. Branch: `ml-dsa`.
Production integration is paused at the user's request.
The target is under five seconds for key generation and online signing, with preprocessing permitted.
Wallet-seed recovery remains required. Export is unchanged.

## Current reduced protocol

The [public-decision reduction](ml-dsa-65-public-keygen-performance.md) passes the scoped privacy review and canonical recovery checks.
It reduces normal online table reads to 41.7 MB. Read-ahead then lowers the hosted median from 7.82 to 4.81 seconds.
Three of eight measured requests still miss five seconds. The strict target remains unmet. The earlier sections below describe the private-selection baseline from commit `08af3354`.

## Hosted follow-up

The first [hosted streamed-storage campaign](ml-dsa-65-prepared-hosted-report.md) misses the five-second target.
Seven measured requests take 10.08–15.40 seconds online, with a 12.65-second median.
Canonical wallet-seed recovery fixture checks pass. The controlled stream-reader comparison is complete.

The controlled larger-read follow-up records an 11.57-second median and seven further deadline misses.
Its mean does not improve. The experiment establishes no consistent latency gain from larger reads.
Both hosted campaigns retain the same canonical recovery keys and private disclosures.

## Preliminary local result

Prepared canonical key generation passes separate-role native and Node/V8 Wasm experiments.
The Wasm online phase takes 1.23–1.51 seconds across three measured zero-delay cases after one warm-up.
A separate case with an injected 20 ms RTT takes 1.95 seconds.
These results support a hosted experiment. They do not establish Cloudflare latency or a production percentile.

| Environment | Online median, zero added delay | Observed zero-delay range | One case with injected 5 ms RTT | One case with injected 20 ms RTT |
| --- | ---: | ---: | ---: | ---: |
| Native separate processes | 1.48 s | 1.48–1.65 s | 1.66 s | 2.11 s |
| Node/V8 Wasm, separate processes | 1.36 s | 1.23–1.51 s | 1.46 s | 1.95 s |

The delay adapter waits half the stated RTT before each outgoing online message.
This is a sensitivity test, not a real network measurement.
These small samples contain run variation and do not establish a latency distribution.
The table uses B's online observations. A's observations are also retained in each artifact.

The three measured Wasm preparations take 2.30–2.37 seconds before the online phase.
Preparation includes fresh garbling, genuine random OT, table transfer, and writing B's local table files.
Online timing includes private input transfer, local table reads, evaluation, share arithmetic, and public-key completion.
Module startup, public schedule loading, wallet authentication, admission, and durable activation are outside these measurements.
The native harness seals its role material after the timer. It records that additional time separately.
The supplied input is one owner-root share per role. The private wallet-root-to-FIPS-seed circuit is included.

Evidence:

- [Native campaign](../evidence/ml-dsa-65-prepared-keygen-native-20261014.json): six complete cases with canonical FIPS reference verification.
  One measured case also signs with its prepared-keygen shares and verifies authorized recovery of the exact canonical seed after timing.
- [Wasm campaign](../evidence/ml-dsa-65-prepared-keygen-wasm-20261014.json): six complete cases, verified against the native canonical oracle.
- [Five-second resource screen](../evidence/ml-dsa-65-five-second-resource-screen-20261014.json): earlier measured inputs and clearly marked resource models.

## What changed

Each role prepares nineteen independent circuit invocations without receiving actual circuit inputs:

1. One wallet-owner-root to canonical-seed circuit.
2. One canonical FIPS seed expansion.
3. Eleven secret polynomial sampling circuits.
4. Six private rounding circuits.

The circuits and the canonical key-generation state machine remain unchanged.
The prepared path reuses the existing half-gate garbler, evaluator, and passive OT implementation.
It has separate consuming preparation handles. The existing non-prepared path remains the baseline experiment.
These are distinct experiment execution methods, not production compatibility paths.

A prepares random wire labels and garbled tables before input selection.
B stores the tables in role-local files.
Both sides execute random OT. A retains independent pad pairs. B receives one pad under each private random choice.
No real input bit determines those choices.

Online, B sends its actual input bits XOR its random choices.
A uses these corrections to encrypt the appropriate input labels under its pad pairs.
A also sends the labels selected by its own actual input bits.
B obtains only one label per input wire and evaluates its prepared table.
B returns only the existing declared public circuit outputs to A.
The global free-XOR offset and both labels for any wire never go to B.

Each handle is consumed once. Its secret label and pad buffers zeroize on drop.
Every invocation has a fresh header, circuit digest, OT session, and execution binding.
Online messages include that binding and reject a different preparation's identifier.
No trusted dealer, private-key reconstruction, or changed signing-mask derivation is used by this keygen prototype.

This remains a passive, honest-execution experiment.
The new random-OT correction composition still needs independent review.
In-memory consumption does not establish durable replay or rollback protection.

## Traffic and exchanges

| Resource per key generation | Measured value |
| --- | ---: |
| Offline A/B protocol traffic, including ready barrier | 115,681,029 bytes |
| Online A to B | 3,612,000 bytes |
| Online B to A | 8,363 bytes |
| Total online A/B traffic | 3,620,363 bytes |
| Online A messages | 19 |
| Online B messages | 38 |
| Prepared table objects at B | 19 |
| Table bytes read online, including frame headers | 113,514,952 bytes |
| Local table-frame reads | 1,737 |

Each circuit uses B's correction, A's label response, and B's public-output completion message.
That gives nineteen correction/label exchanges and 57 logical messages.
These messages travel over one persistent duplex channel in the prototype.
They are not 57 HTTP requests or measured physical network hops.
The public-output completion and the next correction can share a directional flight in a future adapter.

The tables remain large. Preprocessing moves their transfer before the request. The tables still exist.
A hosted storage adapter must stream each prepared object without issuing one remote request per 64 KiB frame.
Measure nineteen object reads, bounded prefetching, and storage near the evaluator explicitly.
Any online storage access remains within the five-second budget.

Wasm linear-memory peaks are 23.81 MiB at A and 17.13 MiB at B.
B's whole Node process RSS reaches 257–344 MiB across these runs.
RSS includes the Node runtime, generated code, heap, and other process memory.
Neither figure establishes a Cloudflare isolate-memory bound.
The benchmark keeps tables on disk rather than retaining the entire pool in Wasm memory.

## Why the tables are large

At 128-bit labels, half-gates use 32 table bytes per AND gate.
Canonical keygen plus wallet-seed derivation uses 3,546,908 AND gates.

| Component | Table bytes |
| --- | ---: |
| SHAKE expansion for eleven secret polynomials | 53,709,568 |
| Secret sampling, private selection, and share conversion | 49,137,792 |
| Private rounding | 8,257,536 |
| Wallet-seed and FIPS-seed derivation | 2,396,160 |
| Total, excluding frame headers | 113,501,056 |

Public matrix expansion and linear lattice arithmetic already run outside Yao.
Publishing the secret SHAKE stream or its accepted positions would change the privacy contract.
Moving these operations to another MPC engine is possible without publishing them, but requires a complete cost and round comparison.
The current sampler is an optimization target. Its fixed bound and private coefficient ordering must remain intact.

An isolated [fresh-mask conversion experiment](../evidence/ml-dsa-65-fresh-mask-conversion-20261014.json) reduces one signing-mask circuit from 212,928 to 21,760 AND gates.
Seven separate-process cases pass independent coefficient mapping checks with fresh OT.
Replacing all five masks would reduce current signing-candidate AND gates by about 42%.
That is a signing protocol proposal, not a canonical keygen optimization.
It replaces the existing message-bound nonce derivation and requires separate security review.
The live signer does not use it.

## Pool behavior and remaining measurements

This prototype measures a complete ready reservation. It does not implement a durable shared pool or an empty-pool queue.
A later pool must reserve matching preparation at both participants before admitting online work.
It must discard consumed or uncertain material after interruption, rather than restore it from a snapshot.
Wallet recovery regenerates the same key with fresh preparation.
An empty pool must report unavailable or preparing, and trigger refill. That request is not a five-second success.

Next experiments, in order:

1. Review public sampler decisions and public `t0` against the threshold transcript. Keep canonical wallet-seed recovery unchanged.
2. Design adaptive SHAKE consumption with a FIPS-compliant continuation. Do not replace the allowed cap with 408 bytes.
3. Measure the reviewed smaller keygen circuits on Workers with the same storage and client timing boundary.
4. Review fresh prepared signing masks and public commitment computation. Keep extra disclosure assumptions explicit before implementation.
5. Measure admission, actual placement, pool exhaustion, throughput, and interruptions after a design passes the preliminary deadline.

The hosted storage experiment is complete. Larger reads reduce application callbacks but still miss five seconds.
Applying preparation to the unchanged signing circuits is no longer the next optimization priority.

Production integration remains paused. No five-second hosted result or prepared-signing result is claimed yet.

## Reproduce

Run from the ML-DSA worktree:

```sh
cargo build --release --locked --offline --manifest-path tools/ml-dsa-investigation/Cargo.toml
tools/ml-dsa-investigation/target/release/ml-dsa-investigation prepared-keygen \
  docs/evidence/ml-dsa-65-prepared-keygen-native-20261014.json
```

Build the Wasm package with the repository's pinned wasm-bindgen helper:

```sh
source packages/wallet/scripts/build/wasm-toolchain.sh
cd crates/ed25519-yao/wasm-bench
with_wasm_bindgen_cli_for_lockfile Cargo.lock \
  wasm-pack build --target nodejs --out-dir pkg-prepared --release --locked
```

Then, from the worktree root:

```sh
node crates/ed25519-yao/wasm-bench/scripts/run_prepared_keygen.mjs \
  docs/evidence/ml-dsa-65-prepared-keygen-wasm-20261014.json
```

The artifacts retain source and executable or Wasm hashes, role counters, timings, and cleanup confirmation.
All keys are disposable fixtures. No production wallet data enters the experiments.
