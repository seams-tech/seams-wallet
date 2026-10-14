# ML-DSA-65 arithmetic optimization

Date: October 13, 2026. Branch: `ml-dsa`.

The first exact circuit rewrite reduces key-generation table bytes by **5.4 percent** and signing-candidate table bytes by **10.2 percent**.
Complete native and local Worker key generation, signing, and recovery checks pass.
The October 14 hosted rerun now passes complete key generation and signing.
It records CPU separately and establishes no hosted latency improvement over the earlier campaign.

## Hosted rerun — October 14, 2026

Both temporary Workers deployed after the user approved their replacement benchmark token.
The [deployment record](../evidence/ml-dsa-65-selected-halfgates-deployment-20261014.json) pins their versions and module hashes at source revision `e662ef7e`.
Every recorded benchmark source hash matches that revision.
The wallet-seed recovery prelude was implemented after this deployment and is outside these measurements.

| Hosted operation | Measured samples | Median elapsed | Observed range |
| --- | ---: | ---: | ---: |
| Fresh joint key generation | 5 | 14.974 s | 14.169–15.415 s |
| Fixed key generation plus five-candidate signing | 3 | 88.470 s | 88.421–88.609 s |
| Fresh joint key generation plus signing | 5 | 38.345 s | 21.410–153.717 s |

Each row excludes one complete warm-up operation.
Fresh-key signing used 1, 16, 2, 4, and 3 candidates, in that order.
Every signature passed independent standard verification and altered-input rejection checks.
The driver checked role agreement, fresh bindings, resource formulas, and transport counters.
These operations include new key generation before each signature. They do not measure signing against stored production shares.

The earlier hosted key-generation median was 12.439 seconds.
Its fixed five-candidate complete operation took 74.375 seconds in one measured run.
The revised circuit sends fewer bytes, but these separate campaigns do not show a latency improvement.
They do not isolate compiler, placement, runtime scheduling, warm-up, or input effects.
No controlled cause follows from that comparison.

Key generation transfers 116,752,358 protocol bytes across both directions.
Five-candidate signing transfers another 417,419,248 bytes, including the public request agreement.
These totals exclude Worker transport envelopes, credits, and completion reports.
The largest observed Wasm linear-memory high-water marks were 35.625 MiB at A and 35.25 MiB at B.
Those figures exclude total isolate memory and runtime-managed transport buffers.
A's request entry was NRT. B's physical placement remains unverified.

### CPU and marginal compute cost

The [sanitized tail evidence](../evidence/ml-dsa-65-selected-halfgates-tail-20261014.json) records both roles for all six fresh-key signing operations, including warm-up.
The [cost calculation](../evidence/ml-dsa-65-selected-halfgates-cpu-cost-20261014.json) correlates each sequential request by its client time interval and expected Worker versions.
Wrangler redacts run identifiers in these tail URLs. Each interval contains exactly one A event and one B event.
The evidence retains public timing metadata and omits request headers and logs.

Across the five measured operations, combined CPU usage has a 34,586 ms median and a 53,357.2 ms mean.
The observed range is 19,040–143,469 ms.
Under Workers Standard pricing, additional CPU costs $0.02 per million milliseconds, with CPU summed across service-bound Workers.
See [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/), checked October 14, 2026.

```text
marginal CPU cost = (CPU_ms_A + CPU_ms_B) * $0.02 / 1,000,000
```

That yields a median of $0.000692 and a mean of $0.001067 per measured key-generation-plus-signing operation.
The observed range is $0.000381–$0.002869.
At the sample mean, 1,000 such operations would use about $1.07 of additional CPU allowance.
This estimate excludes included usage, subscription fees, inbound requests, logs, admission, durable storage, and the new wallet-seed prelude.
It is not an invoice or a production cost guarantee.
Elapsed latency remains substantial despite the small per-operation CPU price.

The [cleanup record](../evidence/ml-dsa-65-selected-halfgates-cleanup-20261014.json) verifies deletion of both temporary Workers and removal of the disposable token file.
Sustained throughput, production storage, full memory use, and target timing qualification remain open.

## Exact change and measured resources

The compiler now uses one AND gate per full carry or borrow step.
The previous compiler used two AND gates for that step.
The carry identity is `a XOR ((a XOR b) AND (a XOR carry_in))`.
For subtraction, equal operand bits propagate the incoming borrow. Unequal operand bits select the right operand bit.
Both identities preserve the same arithmetic result for every input bit combination.

This changes only the Boolean topology.
It preserves the seed derivation, coefficient order, 481-byte sampling bound, share format, protocol sequence, and declared disclosures.
It introduces no native branch on a private value.
The runtime evaluates the same fixed circuit opcodes with fresh garbling and OT.

| Resource | Previous baseline | One-AND arithmetic |
| --- | ---: | ---: |
| Key-generation AND gates | 3,710,256 | 3,509,852 |
| Key-generation table bytes | 118,728,192 | 112,315,264 |
| Key-generation protocol bytes, both directions | 123,166,070 | 116,752,358 |
| AND gates per signing candidate | 2,542,062 | 2,283,770 |
| Table bytes per signing candidate | 81,345,984 | 73,080,640 |
| Protocol bytes per signing candidate | 91,498,125 | 83,231,733 |
| Reusable descriptions for all ten circuits | 33,076,075 | 33,699,271 |

The rewrite trades AND gates for additional XOR gates.
XOR gates require no garbled table, but they still require runtime work and encoded schedule records.
The reusable descriptions therefore grow by 623,196 bytes while per-operation cryptographic traffic decreases.
Protocol byte totals include fresh OT, circuit framing, labels, and declared public circuit results.
They exclude Worker envelope, credit, and completion-report bytes.
Signing setup and the final accepted-share exchange remain separate from each candidate's totals.

## Validation and timing limits

The complete native harness checks four fixed seeds and one fresh joint seed.
Both roles produce standard signatures before the authorized test recipient reconstructs the seed.
RustCrypto and OpenSSL verify the signatures and reject altered inputs.
The recipient reproduces each canonical key and complete expanded private encoding.
The fixed public keys match the earlier baseline exactly.
The deterministic fixed signatures and their attempt counts also match exactly.
Sampling exhaustion, coefficient order, arithmetic boundaries, strict norm checks, and hint limits still pass.

The current native key-generation median is 1.85 seconds across five cases.
The earlier campaign recorded 1.87 seconds.
These separate small campaigns do not establish a controlled latency improvement.
Five local joint-key runs record a 3.64-second median and a 3.32–3.81-second observed range.
One local fixed key-generation-and-signing operation takes 17.33 seconds after its excluded warm-up and requires five signing candidates.
These local measurements do not predict Cloudflare latency or a production p95.
The local key-generation campaign overlapped a failed deployment build during startup, so it is an exploratory measurement.

The Worker E2E driver now checks resource totals against generated schedule counts.
It still requires the exact protocol call sequence and equal role counters.
It also checks runtime bytes against actual transport bytes and verifies standard signatures independently.
Removing fixed historical byte totals permits valid compiler optimization without weakening these behavioral checks.

## Next engine comparison

The [structural screen](../evidence/ml-dsa-65-engine-structural-screen-20261013.json) measures the current circuits' dependent AND layers.
The current sequential core has a sum of 2,771 layers for key generation and 2,330 layers per signing candidate.
Boolean-sharing protocols require interaction across dependent layers.
Independent polynomials can share a communication batch, so a direct serial port would give an unnecessarily poor comparison.
Measure layer round-trip cost and batching before implementing the complete alternative signer.

[Three-halves garbling](https://eprint.iacr.org/2021/749) uses `1.5*kappa + 5` transmitted bits per AND.
At 128-bit labels, ideal packing forecasts 86,430,106 key-generation table bytes and 56,237,837 bytes per signing candidate.
These are table forecasts. Extra computation, framing, labels, OT, and implementation review remain additional.

[ABY2.0](https://encrypto.de/papers/PSSY21.pdf) moves work into an input-independent setup phase and provides mixed sharing conversions.
Its Boolean multiplication has two online transmitted bits per AND.
Ordinary GMW triple openings have four online bits per AND.
Neither online count includes private preprocessing or conversions, so neither is a complete cost comparison with Yao.

The reference [SEEC implementation](https://github.com/encryptogroup/SEEC/tree/24bcbd57f7176ffd706f6d797d013948c55cf7dd) supports passive GMW and Boolean ABY2.0.
This review pins commit `24bcbd57f7176ffd706f6d797d013948c55cf7dd`.
Its README identifies nightly SIMD and native transport dependencies. It provides no verified Worker/WASM path.
Exclude its explicitly insecure Silver option.
Portability and complete preprocessing cost remain open. This screen executes no alternative cryptographic engine.

## Constant-time work

The [compiled arithmetic triage](../evidence/ml-dsa-65-constant-time-triage-20261013.json) identifies Wasm remainder instructions in private polynomial arithmetic.
Manual data-flow review distinguishes these from public matrix, twiddle, and byte-length calculations.
Those instructions require target qualification. Their presence alone does not prove a deployed timing leak.
The inspected core assembly precedes final Worker optimization and native JIT compilation.
No constant-time certificate follows from this audit.
Evaluate bounded division-free modular reduction as a separate change and repeat full canonical interoperability checks.

The next change now implements that reduction without changing circuit topology or protocol traffic.
Its [complete host campaign](../evidence/ml-dsa-65-threshold-host-division-free-20261013.json) passes all five cases, including threshold signatures before recovery.
The fixed public keys and deterministic signatures remain identical to the previous campaign.
The [compiled audit](../evidence/ml-dsa-65-division-free-arithmetic-audit-20261013.json) finds zero division or remainder sites in the three private polynomial functions on Wasm and AArch64.
Final Worker and runtime qualification remain open.
The [composition review](ml-dsa-65-privacy-review.md) records the reduction bounds, disclosure contract, and remaining integration requirements.

## Evidence and remaining work

- [Complete native one-AND execution](../evidence/ml-dsa-65-threshold-host-one-and-20261013.json).
- [Generated resource comparison](../evidence/ml-dsa-65-one-and-resource-comparison-20261013.json).
- [Local Worker signing](../evidence/ml-dsa-65-worker-threshold-one-and-local-20261013.json).
- [Local Worker joint-key campaign](../evidence/ml-dsa-65-worker-keygen-one-and-local-20261013.json).

The selected half-gates cloud rerun is complete. Next measure the wallet-derived and durably stored production path.
The complete native engine comparison already includes setup and conversion costs.
The [first executed GMW and ABY2.0 comparison](ml-dsa-65-engine-comparison.md) now includes four kernels and their complete private preprocessing costs.
It also records the rebuilt local Worker checks and the pinned smaller-garbling source review.
Keep composition review, role-private persistence, Router admission, SDK/NEAR integration, and lifecycle E2E scenarios in the remaining queue.
The [investigation plan](ml-dsa-65-investigation-plan.md#immediate-work-queue) records that order.
