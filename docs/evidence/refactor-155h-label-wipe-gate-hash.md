# R155H — Label wipes and the garbler's gate hash

Date: October 13, 2026. Plan: [refactor-155H.md](../refactor-155H.md), Phase 4.

## Result

Garbling takes half the time and evaluation two thirds of the time, with the
same protocol bytes. Two changes in `crates/ed25519-yao` do it:

1. **One volatile write wipes a label.** A wire label was a `[u8; 16]`. The
   derived wipe of a byte array writes each byte with its own volatile write
   and its own optimization barrier, and on `wasm32` the barrier is a function
   call. A ceremony drops several million labels. A label is now a
   `SecretBlock`, a 16-byte value marked `DefaultIsZeroes`, which the `zeroize`
   crate wipes with one volatile write of the whole value, as it wipes an
   integer. The temporaries of the gate hash use the same type.
2. **The garbler hashes its four blocks in one cipher pass.** The `aes` crate
   selects its 32-bit fixslice on `wasm32`, two blocks per pass, because the
   target's pointers are 32 bits wide. `passive/gate_aes.rs` holds the 64-bit
   fixslice of `aes` 0.8.4, reduced to AES-128 encryption. WebAssembly has
   native 64-bit integers, so four blocks take one pass. The evaluator hashes
   two blocks per gate and keeps the `aes` crate.

No message, no table byte and no digest changes. The frozen known answers of
the hash and of the half-gate table pass unchanged.

## Measurements

**Engine benchmark.** `crates/ed25519-yao/wasm-bench`, activation circuit,
128 KiB frames, WebAssembly with SIMD in Node on an M4 Pro, fat LTO, median of
ten runs after two warm-ups, two alternating rounds.

| Build | Garbler | Evaluator |
| --- | ---: | ---: |
| Before | 59.4–60.3 ms | 39.0–39.7 ms |
| One-write wipe | 41.5 ms | 26.4–26.5 ms |
| One-write wipe and four-block cipher | 29.2–30.1 ms | 25.2–25.7 ms |

**Local Workers runtime.** The benchmark pair with the table-frame yield and
SIMD, 20 warm ceremonies per run, two alternating rounds.

| Build | Ceremony | Table stream |
| --- | ---: | ---: |
| Before | 126 ms | 94 ms |
| After | 94–98 ms | 62–65 ms |

**Cloudflare.** The same pair under the benchmark Worker names, 25 ceremonies
per run, runs alternated, both Workers deleted afterwards. CPU is the tail's
`cpuTime` per ceremony invocation: 25 tail events per Singapore run and 11
per run near the client, where the tail delivered fewer.

| Run | Client wall p50 | Deriver A CPU p50 | Deriver B CPU p50 |
| --- | ---: | ---: | ---: |
| Near the client, before | 262 ms | 166 ms | 146 ms |
| Near the client, after | 210 ms | 121 ms | 123 ms |
| Singapore placement, before | 915 and 780 ms | 537 and 432 ms | 321 and 338 ms |
| Singapore placement, after | 617 and 633 ms | 274 and 277 ms | 240 and 232 ms |

The runs near the client met warm isolates. A new placement fills a run with
first-run isolates, which explains the high Singapore figures on both sides;
the change saves more there, because cold code pays more for each wipe call.

## What misled first

A microbenchmark of the gate hash alone showed the four-block cipher at 54% of
the old time. In the engine the same change saved nothing: the cipher call
cost 24.9 ms per ceremony before and 19.5 ms after, and added wipes of its
temporaries ate the difference. Running the cipher twice per gate in a scratch
copy gave those two figures. The wipe was the larger cost and was not visible
in a profile, because its barrier calls are spread over every function that
drops a label. Measure a change in the engine benchmark, not beside it.

## Verification

- `cargo test --locked` for `crates/ed25519-yao`: 65 tests, with the
  `local-protocol` feature 68. Four are new: the FIPS-197 vector in every
  lane, 128 single-bit blocks and their complements under the zero key, 2,000
  generated keys and block batches, and lane independence, each against the
  `aes` crate.
- `cargo test` for `crates/router-ab-cloudflare` with `workers-rs`, which
  runs full ceremonies of both roles, and for `crates/router-ab-ed25519-yao`.
- `check_constant_time_codegen.mjs` passes on the host build and on both
  Deriver Worker builds. The conditional XOR of a label keeps its source line
  in `SecretBlock`, so the gate checks the same instruction sequence.
- `cargo yao-fv`: reference-spec, vectors, cross-language, both Phase 2B
  checks that precede the review subject, benchmark-manifest reproducibility,
  parity with 83 production tests, anti-drift, runtime conformance, passive
  public shape, passive security, Lean and Verus pass. Two tracks did not run
  for reasons of this machine: the Phase 2B review subject needs a clean
  checkout, and the Aeneas track needs its pinned tool. Aeneas extracts the
  reference generator, not this code.
- On release builds of both Derivers at commit `ab91d575`, in an export tree:
  the 13 release cases of `passkey.ed25519-yao-local.contract.test.ts` pass,
  and its fourteenth needs a debug Router by design. All 14 cases of
  `passkey.registration.contract.test.ts` pass after an unrelated repair of
  one test interceptor (`757eba5b`).
- Open: a release and the staging measurement.

## Wipe guarantee

`zeroize` implements `Zeroize` for a `DefaultIsZeroes` type as one
`write_volatile` of the default value followed by its optimization barrier.
The byte-array implementation does the same per element. Both leave sixteen
zero bytes behind a volatile store that the compiler may not remove. The
crate keeps `#![forbid(unsafe_code)]`.
