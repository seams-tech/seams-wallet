# ML-DSA AES profiling checkpoint

The tested native AES bridge provides no useful Cloudflare CPU gain. Keep the current software AES implementation.
Fixed AES round-loop unrolling also provides no local gain and is removed. No production cryptographic source change remains.
The measurement tool now separates AES setup, rounds, conversion, and erasure through temporary diagnostic copies.
The merged browser settings flow passes, including the existing hostile CSS checks.

These results establish no improvement in complete preparation, registration, or signing latency.
Four-candidate preparation near ten seconds remains the previous complete-job baseline.
The six-second preparation target and sustained four-wallet capacity target remain open.

## What the profile supports

The preceding calibrated local preparation profile places about half of participant A samples and two-fifths of B samples inside software AES.
This checkpoint uses the same production sources to distinguish possible optimization targets.
The final Node-Wasm component screen reports these diagnostic medians:

| Component | Median per call |
| --- | ---: |
| Scalar key schedule and destruction | 249.9 ns |
| Widen an existing schedule and destroy it | 233.3 ns |
| AES rounds on converted state | 160.7 ns |
| Input/output conversion and state erasure | 19.3 ns |
| State erasure alone | 5.8 ns |
| Complete eight-block encryption call | 182.1 ns |

These times are nonadditive. Diagnostic copies expose different compiler optimization boundaries.
Do not subtract them to predict protocol savings.
Production already retains schedules across encryption calls. The correlation chunk constructs four AES contexts using three fixed public keys, rather than one cipher per encryption call.
Another software key cache therefore has no demonstrated benefit.
The existing compiled AES path already uses constant SIMD shuffles. It exposes no missing dynamic-shuffle optimization.

The full-output screen compares production scalar and SIMD AES with RustCrypto AES for 256 keys and 256 blocks per key.
It also checks correlation batch lengths zero through thirty-three, including unchanged suffixes.
All comparisons pass. The final script removes an unused export from an earlier diagnostic probe.
The archive retains the exact earlier script and Wasm separately from the final tool.

## Native provider experiment

The experiment compares three paths with identical inputs:

1. Current software AES in Wasm.
2. A fresh native AES-ECB context for every update.
3. One native AES-ECB context per benchmark request, destroyed when that request ends.

ECB encrypts independent AES blocks here. This experiment does not change the protocol pseudorandom generator or replace its security assumption.
The three production correlation keys are public protocol constants. Their input and output blocks remain private in the actual protocol.
The public benchmark uses disposable deterministic inputs only.

An initial local provider-only probe makes context reuse look useful at 16 KiB per update.
That probe omits repeated Rust-to-JavaScript calls. Product parity is not established by that reading.
A second probe uses a real Rust/wasm-bindgen bridge, the production correlation source, borrowed buffers, copying, erasure, and context cleanup.
It verifies complete outputs against an independent AES implementation before timing.

At production call sizes, the local bridge already loses to software AES.
The protocol currently uses sixteen-byte final hashing, 128-byte PPRF updates, and 128/256-byte triple updates.
The 16 KiB local bridge result still favors native context reuse: 10.06 ms versus 20.72 ms for 16 MiB.
This local result does not repeat on Cloudflare.

## Cloudflare comparison

Two temporary Workers serve bounded public fixtures and collect exact-request provider CPU readings.
No wallet data, benchmark credentials, or participant storage keys are uploaded.
Both use compatibility date `2026-06-12` and `nodejs_compat`, matching the checked-in participant configuration.
Historical private campaigns used a later compatibility date. This is a hosted kernel screen, not a repeat of those complete-job campaigns.

| Bytes per update | Work per request | Software CPU | Fresh native CPU | Reused native CPU |
| ---: | ---: | ---: | ---: | ---: |
| 16 | 0.25 MiB | 6.5 ms | 473 ms | 76.5 ms |
| 128 | 2 MiB | 5 ms | 462 ms | 83 ms |
| 256 | 4 MiB | 10 ms | 450.5 ms | 93 ms |
| 1,024 | 16 MiB | 43 ms | 532.5 ms | 183.5 ms |
| 2,048 | 16 MiB | 41.5 ms | 275.5 ms | 140.5 ms |
| 4,096 | 16 MiB | 42.5 ms | 188.5 ms | 96.5 ms |
| 16,384 | 16 MiB | 43 ms | 93 ms | 64.5 ms |

Each cell is the median of eight alternating-order measurements. Compare paths within the same row.
These are provider CPU readings for whole instrumented benchmark requests. External HTTP times also remain in the evidence.
Reused native AES has no median CPU advantage at any tested size.
It wins two individual comparisons at 16 KiB, and none at the production 128/256-byte sizes.

All 270 requests match unique provider records: sixty full-output checks, forty-two warmups, and 168 timing requests.
Every response is HTTP 200. Every provider outcome is `ok`, with no exception, truncation, or missing CPU reading.
Context counters confirm expected creation, updates, finalization, destruction, and zero remaining live contexts.
The kernel version is `c3e1a171-ea57-4e46-9eda-be0a1ed30be3` throughout the capture.
Deployment history, source hashes, generated bindings, and the Wasm hash agree.
An independent reviewer reproduces all twenty-one CPU medians and all sixty oracle hashes.

Both temporary Workers are deleted. Independent absence checks retain Cloudflare error code `10007` for each Worker.
No D1 database or R2 bucket is created.

## Why the prototypes are removed

| Hypothesis | Observation | Decision |
| --- | --- | --- |
| Repeated software key setup dominates each encryption | Production already retains the schedule across calls | No extra schedule cache |
| Input/output conversion dominates software AES | Isolated conversion is much smaller than AES rounds | No conversion rewrite justified by this screen |
| Native context reuse improves production-size calls | Local and hosted bridged calls are slower at 128/256 bytes | Discard this native bridge |
| Large native updates establish a complete preparation gain | Local 16 KiB gain reverses in hosted medians | No protocol integration |
| Fixed AES round-loop unrolling improves Wasm | Local SIMD medians are 5.356 and 5.399 ms, with no gain | Remove fixed-round prototype |
| Cloudflare provider internals explain the reversal | Provider internals and host contention are unmeasured | Cause remains unknown |

The native comparison includes diagnostic counters, copies, cleanup, and Rust/JavaScript crossings.
It rejects this instrumented prototype. It does not prove every possible native AES integration is slower.
Provider internal erasure, provider constant-time behavior, cold execution, and complete preparation parity remain unqualified.
No production native dependency, experimental protocol flag, cipher change, or new cache remains.

## Browser and recovery checks

The rebuilt browser bundle passes the existing account-menu E2E.
It covers the controlled settings modal, shared Signing keys screen, export previews, and the actual SigningKeyDetails component.
Hostile host CSS preserves the SDK surfaces in light/dark themes and at narrow widths.
Keyboard focus and overflow checks pass. The suite records zero wallet mutations and no browser errors.
The user's CSS specificity changes remain intact.

Fresh native prepared-keygen and wallet-recovery runs also complete.
They check standard signatures, recovery of the same canonical key, ordinary FIPS seed/key export, and automatic pool rollover.
These local checks provide correctness evidence. Their timings are not hosted latency claims.
All three current strict Worker builds pass. The only retained source change is the measurement tool.

## Failures and measurement repairs

- The initial local module path escaped Miniflare's default root. Classification: `environment_or_infrastructure_failure`. An explicit module root resolves setup.
- The initial checksum compares signed Wasm `i32` with an unsigned oracle. Classification: `valid_test_needs_update`. Normalize the result at the boundary.
- The generated bridge imports the provider snippet directly after adding a destructor. The earlier entry omits that import namespace. Classification: `obsolete_test_or_fixture`. Match the generated import table.

The archive retains these failed probes. None requires a production cryptographic repair.
The initial unbridged provider result is withdrawn as evidence of production parity.
The local 16 KiB provider improvement is withdrawn as evidence of a hosted gain.

## Next implementation decision

Qualify the selected runtime under sustained four-wallet signing before another speculative AES rewrite.
The prepared campaign uses two experimental producer slots, four-candidate preparation, and two-at-once consumption.
Each wallet retains thirty-two candidates of capacity and the sixteen-candidate admission minimum.
The production sixty-second cooldown and service-wide signing limit remain unchanged.

Measure verified signatures, consumed/retained/retired candidates, empty-pool waits, failed work, and complete reserve restoration.
The initial campaign uses the existing sixty-second load driver. Four wallets therefore admit at most four operations per minute.
A five-signature-per-minute experiment requires a separately identified shorter benchmark cooldown.
No larger reserve or dedicated preparation server is proposed.

Automatic approval review rejects the fresh eight-Worker deployment.
Deployment and credential uploads await exact approval.
No private campaign Worker is created and no private credential is uploaded by that rejected action.
Wallet-seed recovery, FIPS export, participant separation, and per-wallet capacity remain unchanged.

[Replayable evidence and hashes](../evidence/ml-dsa-65-aes-context-20261028.json) contain the complete public capture and cleanup receipts.

The required bloat check retains its inherited Rust duplication failure: 13,992 lines against the 13,754-line baseline.
This checkpoint adds no production Rust lines. The baseline remains unchanged.
