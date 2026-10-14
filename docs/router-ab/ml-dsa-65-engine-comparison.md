# ML-DSA-65 engine comparison

Updated: October 14, 2026. Branch: `ml-dsa`.

Half-gates, GMW, and Boolean ABY2.0 now execute complete canonical key generation and threshold signing through the same core states.
All three produce identical public keys and deterministic signature bytes in the native comparison.
Half-gates has the lowest complete time and traffic in this small sample.
Private preprocessing dominates the current Boolean alternatives. These results select no production signing design.

## Complete native comparison

The [complete campaign](../evidence/ml-dsa-65-complete-engines-host-20261014.json) uses separate A/B processes for every operation.
Each engine runs one complete excluded warm-up and one measured execution with the same zero-seed public fixture and message.
All six executions require five signing candidates.
Each execution starts without prepared correlations and includes fresh base OT for every batch.

| Engine | Key generation | Signing, five candidates | Key-generation traffic | Signing traffic |
| --- | ---: | ---: | ---: | ---: |
| Half-gates | 2.59 s | 8.68 s | 116.75 MB | 417.42 MB |
| GMW | 40.83 s | 109.72 s | 357.64 MB | 1,157.83 MB |
| Boolean ABY2.0 | 31.57 s | 117.20 s | 356.81 MB | 1,155.38 MB |

MB means 1,000,000 bytes. Traffic includes both directions, every circuit invocation, and the final accepted-share and signature messages.
Times measure each complete process pair, including startup, schedule reads, private preprocessing, conversions, retries, and role verification.
They exclude schedule compilation, the parent's independent verification, and subsequent authorized recovery.
One measured sample establishes neither a percentile nor sustained throughput. It cannot resolve small differences between the Boolean engines.
These native observations establish no Cloudflare speed or cost result.

Both Boolean engines transfer 1,507,921,152 bytes for private preprocessing across key generation and signing.
At A, preprocessing takes 149.08 seconds for GMW and 147.37 seconds for ABY2.0.
This is approximately 99% of each complete pair's combined elapsed time.
Their gate-execution phases transfer 7,486,732 and 3,746,500 bytes respectively, across 14,445 dependent AND layers.
Their corresponding gate-execution phase times at A are 0.58 and 0.52 seconds.
Those phase times exclude binding, topology construction, input sharing, output handling, and preparation of correlations.
They are not measurements of a deployed prepared pool.

The complete circuits retain up to 53.50 MB of expanded public topology per native role.
This amount excludes schedule bytes, private values, OT temporaries, and total process memory.
Worker peak memory remains unmeasured for the Boolean engines.

Every engine passes ordinary RustCrypto and OpenSSL signature verification and changed-input rejection checks.
Neither participant produces a signature when its peer is absent.
The separate test recipient then reconstructs the canonical seed and checks every expanded private-key field against OpenSSL.
All 834 circuit execution bindings differ across the six complete executions.
Runtime counters match actual directional pipe traffic for every circuit and the final signature exchange.
The artifact preserves raw phase counters, timings, circuit identities, source digests, and reproduction arguments.

The [adapter E2E campaign](../evidence/ml-dsa-65-engine-adapter-e2e-host-20261014.json) also repeats the existing five-key half-gates scenarios after integration.
It passes fixed and jointly generated keys, deterministic and hedged signing, authorized recovery, interruptions, replay rejection, restart, and four concurrent signatures.
The SDK-encoded threshold transaction also passes NEAR's pinned AWS-LC verification algorithm.
This campaign uses one reference and public-garbling sample per case for correctness. Its timings supply no additional performance ranking.

## Executed comparison

The [native comparison](../evidence/ml-dsa-65-boolean-engine-kernels-host-20261013.json) runs A and B as separate processes.
Each engine and kernel has three measured executions after one excluded warm-up.
Every execution starts without prepared correlations.
Both participants generate their own private correlations through fresh OT in both directions.
There is no trusted dealer and no plaintext triple generator.

GMW uses XOR shares and one Beaver triple per AND.
A Beaver triple contains shares of random `a`, random `b`, and their product `a*b`.
ABY2.0 uses a public masked wire value with a private mask share at each role.
Both implementations use the existing passive IKNP extension with 16-byte payloads and batches of 4,096 choices.
The final batch includes padding, which remains in the measured cost.

| Kernel | GMW complete median | ABY2.0 complete median | GMW online median at A | ABY2.0 online median at A |
| --- | ---: | ---: | ---: | ---: |
| Seed expansion | 374.1 ms | 362.8 ms | 1.04 ms | 0.93 ms |
| One sampling polynomial | 2,526.9 ms | 2,533.3 ms | 7.57 ms | 7.13 ms |
| One rounding polynomial | 388.7 ms | 382.9 ms | 1.78 ms | 1.63 ms |
| One signing-mask polynomial | 1,784.7 ms | 1,790.5 ms | 6.42 ms | 4.65 ms |

Complete medians include child startup, schedule loading, topology expansion, private preprocessing, input sharing, online execution, and fixture checks.
Online phase medians include peer waits and exclude setup, input conversion, and final output decoding.
These phase timings do not measure a durable prepared pool or its admission and storage costs.
Three samples establish neither a production percentile nor sustained throughput.

| Kernel | Private preprocessing bytes, either engine | GMW online bytes | ABY2.0 online bytes | Dependent AND layers |
| --- | ---: | ---: | ---: | ---: |
| Seed expansion | 4,099,840 | 18,912 | 9,456 | 24 |
| One sampling polynomial | 29,518,848 | 146,130 | 73,104 | 199 |
| One rounding polynomial | 4,509,824 | 21,504 | 10,752 | 93 |
| One signing-mask polynomial | 21,319,168 | 106,588 | 53,394 | 185 |

These byte counts include both directions.
ABY2.0 also exchanges input-mask setup and online input messages.
The artifact records these conversions, binding messages, and private output decoding separately.
It checks every runtime counter against actual pipe traffic and the other role's counters.
Its preprocessing formula includes fresh base OT for every batch.

| Kernel | Half-gates complete protocol bytes | GMW complete protocol bytes | ABY2.0 complete protocol bytes |
| --- | ---: | ---: | ---: |
| Seed expansion | 1,247,816 | 4,118,986 | 4,109,850 |
| One sampling polynomial | 9,487,338 | 29,665,790 | 29,594,496 |
| One rounding polynomial | 1,857,304 | 4,532,778 | 4,526,442 |
| One signing-mask polynomial | 6,950,960 | 21,426,566 | 21,375,104 |

The half-gates counters come from the [division-free host campaign](../evidence/ml-dsa-65-threshold-host-division-free-20261013.json).
These exact protocol bytes exclude adapter envelopes and production admission or storage.
The alternatives evaluate the identical Boolean descriptions.
Sampling selection, additive-share conversion, and rounding conversion remain inside those descriptions and their gate costs.
No mixed-ring conversion shortcut supplies hidden savings in this comparison.

## Implications for the next experiment

The current fresh-base, 16-byte OT primitive makes alternative preprocessing the largest cost.
Online bytes alone would conceal that cost.
Investigate packed-bit or correlated OT, reusable base OT, and reviewed portable silent OT before selecting a prepared-pool design.
Measure replenishment and exhausted-pool behavior alongside online latency.
The current comparison discards its correlations after each execution and cannot reuse them.
Keep half-gates as the executable baseline while these preprocessing experiments proceed.
Repeat complete measurements after changing preprocessing.
A short gate-execution phase alone cannot select a design.

Interaction depth also matters on Cloudflare.
Independent polynomial invocations can share communication layers.
Key generation could use 316 dependent layers across seed, batched sampling, and batched rounding.
That count follows from the measured topologies. It is an unimplemented batching model, not a latency result.
The present sequential core has 2,771 layers when expanded into separate invocations.
A fair deployed comparison must include batching before rejecting Boolean sharing on round count.

The native sampling topology retains 47.96 MB of public expanded gate data per role.
Its private values and correlations retain a further 2.04 MB for GMW or 2.63 MB for ABY2.0.
These values measure allocation capacities. They exclude total peak memory.
Wasm pointer sizes, topology reuse, concurrent operation admission, and final isolate memory still need measurement.

## Smaller garbling

[Three-halves garbling](https://eprint.iacr.org/2021/749) forecasts fewer transmitted table bits per AND than half-gates.
The [structural screen](../evidence/ml-dsa-65-engine-structural-screen-20261013.json) records ideal table forecasts of 86.43 MB per key generation and 56.24 MB per signing candidate.
These forecasts exclude framing, OT, labels, output handling, and additional computation.

The authors' [MOTION implementation](https://github.com/encryptogroup/MOTION/tree/ffa76f82ace55c7ba49c0c89d97246b8827c52a9/src/motioncore/protocols/garbled_circuit) is now pinned at `ffa76f82ace55c7ba49c0c89d97246b8827c52a9`.
Its [license](https://github.com/encryptogroup/MOTION/blob/ffa76f82ace55c7ba49c0c89d97246b8827c52a9/LICENSE) permits reuse under MIT terms.
The provider uses AES-NI and therefore needs a portable implementation for Workers.
Its garbler also uses lookup and row indices derived from private wire permutation bits.
Those operations need a constant-time rewrite and target inspection before adoption.
The evaluator's selection bits already belong to its own view, so its branches require a separate data-flow classification.
This source review establishes no deployed timing exploit.

The [implementation paper, Appendix B](https://encrypto.de/papers/HKST22.pdf) reports additional AES work and branching costs on its own native benchmark.
Those results do not establish performance on our host or Cloudflare.
No three-halves engine executes in the current investigation.
A complete target comparison remains open.

## Latest local Worker checks

The rebuilt half-gates Workers pass [five fresh joint key generations](../evidence/ml-dsa-65-worker-keygen-division-free-local-20261013.json).
Their client median is 3.28 seconds, with an observed 3.21–3.30-second range after one excluded warm-up.
One [complete fixed key-generation-and-signing sample](../evidence/ml-dsa-65-worker-threshold-division-free-local-20261013.json) takes 16.66 seconds after its excluded warm-up.
It requires five signing candidates and matches the ordinary deterministic signature exactly.
These local results establish interoperability and limited timing observations.
They establish no cloud speed improvement.
Hosted reruns still await the pending approval for the new disposable benchmark token.
