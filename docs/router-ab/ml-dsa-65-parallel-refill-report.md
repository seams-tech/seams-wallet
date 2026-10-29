# ML-DSA parallel refill qualification — October 26, 2026

Two preparation slots improve usable material throughput by **83.65%** in the settled eight-wallet comparison.
The complete-cycle signing rate rises from **3.70 to 7.55 signatures per minute**.
Per-wallet capacity, wallet-seed recovery, standard FIPS export, and two-at-once consumption remain unchanged.

The parallel load completes 79 verified signatures with no empty-pool responses.
Its successful calls take 0.335–3.676 seconds.
These finite screens support further investment in preparation performance. They do not establish a production capacity ceiling.

The [hosted evidence](../evidence/ml-dsa-65-parallel-refill-hosted-20261026.json) records the public archive, hashes, qualification checks, and cleanup receipts.
The [local evidence](../evidence/ml-dsa-65-parallel-refill-local-20261025.json) retains native lifecycle and local Workerd checks.

## Settled comparison

Both runs use the same eight wallets and unchanged cryptographic Worker deployments.
Each requests one operation per wallet per minute, with one outstanding demand per wallet.
Each begins and ends with sixteen paired records per wallet.
The cycle includes the load, in-flight completions, and the earliest captured fresh full-reserve set.

| Measurement | One slot | Two slots |
| --- | ---: | ---: |
| Requested load | 10 minutes | 10 minutes |
| Verified signatures, including drain | 60 | 79 |
| Signatures completed inside requested window | 59 | 79 |
| Consumed pairs | 178 | 211 |
| Candidates consumed per verified signature | 5.933 | 5.342 |
| Empty-pool responses | 608 | 0 |
| Service-capacity responses | 87 | 32 |
| Demands pending at cutoff | 7 | 1 |
| Reserve restoration after cutoff | 373.219 s | 28.169 s |
| Complete-cycle signatures/minute | 3.699 | 7.546 |
| Complete-cycle usable candidates/minute | 21.948 | 40.308 |
| Successful HTTP minimum / median / maximum | 0.365 / 1.021 / 14.145 s | 0.335 / 1.162 / 3.676 s |
| Successful calls below 8 seconds | 59/60 | 79/79 |
| Complete demand median / maximum | 25.841 / 122.011 s | 23.842 / 62.069 s |

The signature-rate increase is about 104%. It also includes different rejection and exhaustion outcomes.
The material-rate increase is the clearer preparation comparison.
The serial run exhausts two operations after thirty and sixteen candidates. The parallel run has no exhausted signing operation.

Complete demand latency includes configured cooldown and admission retries.
Successful-call latency excludes earlier unavailable responses.
The parallel run's zero empty-pool count does not mean that every demand finishes within eight seconds.
These private Router A/B timings exclude browser transport, public Gateway owner approval, UI, and NEAR finality.

The earlier clean serial screen records 22.443 usable candidates/minute, close to the settled serial control's 21.948.
Its signature rate is lower because it consumes more candidates per verified signature.
All rates include full reserve restoration and unchanged capacity.

## Preparation cost

Completed four-candidate producer invocations have these medians:

| Producer | A wall time | A CPU time | B CPU time | Candidate/correlation interval |
| --- | ---: | ---: | ---: | ---: |
| Settled serial, primary | 8.657 s | 3.790 s | 3.917 s | 7.106 s |
| Settled parallel, primary | 8.820 s | 3.793 s | 3.958 s | 7.063 s |
| Settled parallel, secondary | 7.998 s | 3.454 s | 3.574 s | 6.321 s |

The primary producer's warm-cache CPU medians are 3.7845 and 3.785 seconds.
Parallel refill increases concurrent work; it does not materially reduce the primary job's computation.
The secondary producer is faster despite the same role Wasm hash. Its placement and runtime cause remain unmeasured.
The earlier approximately twofold CPU difference remains unexplained.

Candidate and correlation preparation remains the main measured interval.
A-side serialization-complete to publication medians are 0.782, 0.717, and 0.801 seconds, respectively.
Those intervals exclude serialization itself and include subsequent waits.
Do not subtract one participant's CPU time from protocol wall time to infer network delay.

Cloudflare documents that service-bound Workers share a server thread by default.
Separate Worker names and overlapping protocol intervals do not prove separate CPU cores.
See the [service-binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

## Deployment-version finding and qualification fix

The first attempted policy transitions were invalid as clean controls.
The public sign Router changed version before the authoritative admission Durable Object changed version.

| Requested phase | Observed authority during the load |
| --- | --- |
| Original parallel | Previous serial version through +227.584 s; parallel version starts +228.489 s |
| Original serial reversal | Previous parallel version through +213.273 s; serial version starts +214.343 s |

The reversal admits twenty-one fresh secondary jobs during its mixed-policy interval.
This exceeds the effect of one old lease draining.
Exact-version filtering had hidden the older authority rows while public signing coverage still passed.
The provider's rollout mechanism remains unknown.

Those runs remain retained as transition experiments.
Their counts are valid, but their apparent scaling ratios are withdrawn.
They are excluded from the settled comparison above.

The investigation plan and analyzer now require effective-authority evidence.
`summarize_capacity.py` checks unfiltered admission `/control` and `/check` versions.
It writes the diagnosis and exits unsuccessfully if authority versions are mixed or unobserved.
Recorded positive and negative controls accept the original serial run and reject both mixed phases.

The repeat controller waits for recent expected-version authority records and no observed live, unsettled refill lease.
It then requires fresh full reserves.
Post-run checks cover the entire reserve cycle, require the expected actor version, and reject secondary jobs in serial mode.
The pre-run gate is an observation from available traces. Post-run coverage supplies the final qualification.

## Preparation failures and the slow signing call

The settled serial and parallel runs reproduce ten and eight primary-B `loadShed` failures.
The bursts span 57.314 and 39.210 seconds in their recorded B invocation timelines.
They use ten and eight distinct module identities.
All eighteen attempts have explicit A-side failed-publication receipts.
Their thirty-six planned pair IDs never become paired stock or enter signing in the captured record.
Failed computation remains a resource cost; it is separate from expiry waste.

The last recorded Wasm sizes occur in successful controls too.
These boundary readings exclude the JavaScript heap and transient allocation peaks.
The initial memory query failed authentication. A later query returned HTTP 200 with no rows; its public-Worker control then failed authentication.
No positive total-memory instrument was established.

Cloudflare lists `loadShed`, `exceededMemory`, and `exceededCpu` as separate outcomes in its [runtime schema](https://raw.githubusercontent.com/cloudflare/workerd/main/src/workerd/io/outcome.capnp).
The [128 MiB isolate limit](https://developers.cloudflare.com/workers/platform/limits/) does not identify the cause of these events.
No memory-exhaustion or hardware-change conclusion is established.

The 14.145-second serial signing outlier consumes two pairs and evaluates four candidates.
B records 12.823 seconds between permit validation and material availability.
The correlated pool actor reports 12.574 seconds wall time and 30 ms CPU.
The subsequent recorded B protocol interval is 137 ms.
These readings locate the delay at material loading. Its storage, queueing, or transport cause remains unresolved.

## Correctness, capacity, and recovery

The complete paired-stock ledgers balance:

- Serial: 128 initial + 178 new = 178 consumed + 128 final.
- Parallel: 128 initial + 211 new = 211 consumed + 128 final.

Both participant take histories agree. No captured material identity belongs to multiple operations.
No settled-cycle paired stock remains unexplained.
All final pairs have known, unexpired deadlines.
Two independent final captures match across each full cycle, including unfiltered authority records.
Final accounting uses the closed capture. Late completion receipts update acknowledgement counts; the original phase snapshots remain archived.
Latency, restoration times, qualification outcomes, and balanced stock totals are unchanged.
All 345 retained setup and load signatures verify independently; all 345 altered messages fail verification.

All eight wallets reproduce their canonical public keys through recovery.
One initial setup signature exhausts sixteen candidates; its original failed result remains intact.
That wallet's post-recovery signature verifies.
The setup run therefore has fifteen verified signatures across sixteen signing attempts.

The two-slot runtime uses separate producer namespaces and separate A/B preparer deployments.
Both preparer pairs remain inside the same two participant trust boundaries.
A storage remains separate from B storage.
Queue order, key/epoch fencing, and exact-job settlement remain enforced.
Native E2E evidence covers restart, stale completion, recovery, and changing back to one slot.
A lease expiry does not prove that interrupted computation stops immediately.

| Unchanged policy | Value |
| --- | ---: |
| Candidates consumed together | 2 |
| Normal preparation group | 4 candidates |
| One-pair top-off | 2 candidates |
| Per-wallet target | 16 pairs / 32 candidates |
| Minimum admission reserve | 8 pairs |
| Wallet cooldown | 60 seconds |
| Active signing operations | 1 |
| Producer lease | 90 seconds |
| Refill material lifetime | 1 hour |

The default preparation limit remains one.
Two slots require the separate preparer bindings used in this screen.
Wallet-seed recovery, standard FIPS export, and the passive server-blind model remain unchanged.
GPU work stays deferred.

## Next high-impact work

1. Benchmark a batched Workers-native AES backend against the existing Wasm implementation. Measure call sizes and bridge overhead. Require exact output equality and review private-buffer handling before integration. Cloudflare exposes the [Node crypto API](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/); this screen establishes no native-AES speed gain.
2. Reduce repeated failed preparation against an unhealthy slot. Evaluate bounded retry backoff while preserving queue fairness, fresh job IDs, and single-use retirement.
3. Isolate the observed pool-actor loading stall before claiming an eight-second signing tail.

The current upper targets are roughly ten seconds for registration and eight seconds for signing.
Preparation throughput and empty-pool waits take priority over a five-second headline.
The sixteen hosted creation/recovery calls take **6.829–12.402 seconds**, with a **9.693-second median**, including client verification.
These observations exceed the ten-second upper target in some cases.
Their prior preparation takes **51.437–117.010 seconds**, with a **90.331-second median**.
That preparation creates generic registration material and initial signing stock; it differs from one four-candidate refill job.
No registration optimization is claimed here.

## Provenance and cleanup

The branch was rebased onto `dev` at `b8988196`; the rebased runtime commit is `5346887c`.
All benchmark Wasm hashes remained unchanged from the pre-rebase runtime `d1d3fdaf`.
Measurement scripts were frozen during the rebase.
The later analyzer change adds authority-version qualification without changing protocol behavior.

All eight temporary Workers are deleted and checked independently for absence.
The public archive excludes benchmark credentials and participant fixture storage.
The bloat check retains the inherited Rust duplication excess: 13,972 lines against a 13,754 baseline. This work adds no duplicated Rust lines.
