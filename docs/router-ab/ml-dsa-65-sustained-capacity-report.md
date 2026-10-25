# ML-DSA sustained Cloudflare capacity — October 25, 2026

Preparation remains the capacity limit in the current single-producer configuration.
The four-wallet run verifies 39 signatures. Its successful signing calls take 0.506–3.799 seconds within Cloudflare.
Twelve demands encounter an empty pool. Complete demand latency reaches 154.906 seconds, including all admission waits and retries.

After starting material can no longer contribute, the four-wallet run completes 17 signatures in 400.808 seconds.
That is 2.545 signatures per minute in this finite interval. It is not a maximum-capacity or production percentile claim.

The eight-wallet run verifies 46 signatures. Its post-stock interval reaches 1.417 signatures per minute.
Complete demand latency reaches 767.428 seconds. Both loads produce material waits longer than five seconds.
The test keeps preparation on Workers and preserves the existing pool policy.

## Scope and policy

The runtime binaries match the prior [hosted lifecycle qualification](ml-dsa-65-final-hosted-lifecycle-report.md).
The runtime source is `c0292b42`. The checkout starts at `08178907`.
The campaign records exact Worker version IDs and Wasm hashes.
No cryptographic protocol source changes during this campaign.

Each wallet keeps these settings:

| Setting | Value |
| --- | ---: |
| Prepared candidates per group | 4 |
| Candidates consumed together | 2 |
| Pool target per wallet | 32 candidates |
| Minimum ready capacity for admission | 16 candidates |
| Wallet cooldown from material reservation | 60 seconds |
| Active signing operations across the service | 1 |
| Active preparation jobs across the service | 1 |
| Refill material lifetime | 10 minutes |
| Initial registration material lifetime | 15 minutes |

Wallet-seed recovery, ordinary FIPS seed/key export, participant separation, and single-use checks remain unchanged.
The privacy claim remains passive execution by honest participants.
GPU preparation remains deferred.

All wallets use synthetic material. Registration probes create a key, recover it into epoch 2, and check the same canonical public key.
Each probe also verifies an ordinary signature. These probes run outside the load windows.
Their complete initial preparation includes registration material and signing stock. It is a different measure from four-candidate refill time.

The first two-wallet run uses persistent local Node clients.
The later runs use durable Cloudflare test clients through the ordinary forwarding Router, ML-DSA Router, and separate A/B Workers.
Each wallet has one outstanding demand. New demands start at least 60 seconds apart. A pending demand delays the next demand.
Requests retry their exact operation ID. Every HTTP attempt has a separate trace ID.

Node/OpenSSL independently verifies every retained signature after each cloud run.
The first completed operation for each wallet is replayed. The cached signature must remain byte-identical.
The load driver excludes browser transport, public SDK and Gateway owner approval, UI, and NEAR submission.
These timings measure the private authenticated Worker path.

The test polls admission at intervals of 1–5 seconds. The public SDK polls service capacity more frequently.
Demand latency includes this test's polling policy and can exceed the SDK's request deadline.

## Results

| Cohort | Window | Verified signatures | Successful HTTP median / maximum | Largest complete demand | Post-stock rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2 wallets, local Node caller | 10 min | 20 | 2.139 / 6.668 s | 15.697 s | Insufficient interval |
| 4 wallets, cloud caller | 12 min | 39 | 1.352 / 3.799 s | 154.906 s | 2.545/min over 400.808 s |
| 8 wallets, cloud caller | 20 min | 46 | 0.981 / 5.182 s | 767.428 s | 1.417/min over 635.348 s |

Timing boundaries differ between the local and cloud callers. These rows do not establish a causal signing-latency improvement.
The post-stock rates are finite observations. They do not establish maximum capacity or a production service guarantee.

The two-wallet run lasts ten minutes and completes 20 signatures, ten per wallet.
It records no empty-pool responses or client errors. All material identities balance.
Successful HTTP calls take 1.015–6.668 seconds, with a 2.139-second median.
The complete load-and-reserve-restoration cycle takes 624.373 seconds, or 1.922 signatures per minute.
The interval after both starting reserves are consumed is only 51.200 seconds. It is too short to estimate a sustained ceiling.

The four-wallet cloud run lasts twelve minutes. It completes 39 independently verified signatures, distributed as 10, 8, 11, and 10.
Every successful signing HTTP call finishes below five seconds. The median is 1.352 seconds.
Complete demand latency ranges from 2.056 to 154.906 seconds, with an 18.254-second median.

Twelve demands see an empty pool. Nine later succeed. Three remain pending at the cutoff.
The run has four pending demands in total. They remain incomplete observations in the artifact.
No successful response completes after the requested window.

| Four-wallet wait category | Responses | HTTP time plus retry intervals, summed across wallets |
| --- | ---: | ---: |
| Empty pool | 327 | 386.049 s |
| Service capacity | 29 | 146.381 s |
| Wallet cooldown | 208 | 939.138 s |
| Protocol retry | 0 | 0 s |

These sums overlap across wallets. They do not partition the twelve-minute wall time.
An empty-pool wait is the measured response time plus the following retry interval.
The largest such wait sum is 75.136 seconds. Other admission conditions contribute to the 154.906-second complete demand.

The eight-wallet cloud run completes 46 signatures, distributed as 5, 8, 5, 6, 6, 7, 5, and 4.
Forty-five successful signing calls finish below five seconds. Their range is 0.452–5.182 seconds.
Complete demand latency has a 131.001-second median and a 767.428-second maximum.

Thirty-six demands encounter an empty pool. Thirty later succeed. Six remain pending at the cutoff.
Eight demands remain pending in total. The longest pending demand has waited 578.044 seconds when the window closes.
The largest empty-pool response-plus-retry sum is 388.434 seconds. Other admission conditions add to complete demand latency.

One operation exhausts eight pairs and rejects all sixteen candidates. It returns failed and retains the wallet cooldown.
The demand continues under a fresh operation. The run records no unknown HTTP outcomes or runtime exceptions within the window.
No successful response completes after the cutoff.

| Eight-wallet wait category | Responses | HTTP time plus retry intervals, summed across wallets |
| --- | ---: | ---: |
| Empty pool | 3,031 | 4,085.980 s |
| Service capacity | 533 | 2,680.476 s |
| Wallet cooldown | 471 | 2,184.163 s |
| Protocol retry | 1 | 2.540 s |

Both cloud runs observe at most sixteen pairs per role and wallet. The configured pool target remains respected.

## Starting-stock exclusion and material accounting

The four-wallet run excludes 60 initial or prestarted pair identities.
Fifty-seven pairs have terminal completion times and matching A/B `taken` events.
The remaining three have consistent material deadlines and no `taken` event.

The latest bound is `2026-10-25T06:56:41.239Z`, or 319.290 seconds after load starts.
Earlier material cannot contribute after that bound under the unchanged expiry and single-use checks.
Seventeen verified signing HTTP attempts begin after it. The remaining interval is 400.808 seconds.

All 103 consumed pairs match the actual A and B `taken` events. No pair crosses operations.
The run burns 206 candidates for 39 signatures, or 5.282 candidates per signature in this sample.
This observed average is a sample result. Two-at-once consumption still has rejection variance.

Three initial pairs disappear from ready inventory before their material deadlines:

| Wallet index | Pair prefix | First absent from ready inventory | Recorded material deadline |
| --- | --- | ---: | ---: |
| 0 | `6ed32c25` | +107.930 s | +128.488 s |
| 1 | `e97c60d6` | +69.893 s | +95.708 s |
| 3 | `d32d0abd` | +49.938 s | +78.579 s |

Each pair has less than thirty seconds remaining at first absence.
This fits the readiness filter, which requires enough lifetime for the operation deadline.
There is no explicit event proving the retirement cause. The complete publication ledger therefore remains incomplete.
Deadline bounds establish when these pairs cannot contribute. They do not establish a retirement event.
The post-stock interval does not prove full reserve restoration.

The eight-wallet run excludes 81 initial or prestarted pairs: 67 terminal-consumed pairs and fourteen deadline-only pairs.
Its latest bound is `2026-10-25T07:27:37.019Z`, or 564.652 seconds after load starts.
Fifteen verified signing attempts begin after that bound across 635.348 seconds.
The observed post-stock rate is 1.417 signatures per minute.

All 117 consumed pairs match exact A and B `taken` events across 47 terminal operations.
Those operations comprise 46 signatures and the exhausted operation. No pair appears under two operations.
The run burns 234 candidates, including sixteen in the exhausted operation.

The bounded material ledger has 44 unaccounted pairs: fourteen starting pairs and thirty newly prepared pairs.
All have one consistent deadline and no `taken` event. Forty deadlines pass by the observation horizon.
The other four disappear from ready inventory with 27.340 or 29.635 seconds remaining.
Every observed disappearance occurs within the final thirty seconds of lifetime. None later reappears.
This supports deadline and readiness exclusion. Actual retirement events remain unobserved, so the ledger remains incomplete.

The thirty newly prepared pairs represent sixty candidates that become unavailable without signing use.
This measured waste makes idle replacement and readiness policy important capacity work.

## Preparation cost

The four-wallet run has 36 unique four-candidate producer executions and one two-candidate execution.
Every execution has one matching B request and a publication record.
An additional cancelled queue alarm uses 2 ms CPU and 46 ms wall time. It refers to an already-counted job.
The analysis retains that alarm as lifecycle overhead and counts B CPU once.

| Four-candidate execution | Median | Range |
| --- | ---: | ---: |
| A invocation wall time | 18.129 s | 15.872–24.917 s |
| A CPU | 8.395 s | 7.339–11.561 s |
| B invocation wall time | 17.912 s | 15.641–24.661 s |
| B CPU | 8.649 s | 7.607–11.982 s |

A and B CPU are separate observations. Their work can account for much of the execution wall time.
Subtracting A CPU alone from wall time cannot identify network delay.
Unattributed alarms remain separate. These figures do not establish complete billing.
The campaign has no matched control for earlier faster producer screens. It does not establish a runtime regression.

The eight-wallet run has sixty unique four-candidate executions, all matched to B and published.
Their A wall-time median is 17.776 seconds, with a 15.827–24.172-second range.
Median A/B CPU is 7.998/8.593 seconds. The preparation median stays close to the four-wallet result.
Lower complete signing throughput therefore needs an allocation, expiry, and admission analysis.
This comparison alone cannot assign the effect to one cause.

Idle wallets also request replacement material when it expires.
At full target, replacing 32 candidates every ten minutes requires 3.2 candidates per minute for each idle wallet.
That is a policy-based calculation. Actual waste needs measured material lifetimes and retirement events.
Eight full idle targets would require 25.6 replacement candidates per minute in that model.
This exceeds the observed production rate of the current single producer.
The calculation is a policy screen. The measured sixty unused new candidates provide separate evidence of waste.

## Instrument checks and the interrupted local run

An earlier local four-wallet run is unqualified for full-window timing.
The host enters clamshell sleep at 13:51:06 JST. The first major client timer gap begins about two seconds later.
All four unknown HTTP outcomes follow that gap.
The client records 149 empty-pool responses and a 152.467-second successful demand before sleep.
Those earlier observations remain facts. The full-window throughput estimate is withdrawn.

| Fact | Instrument | Check |
| --- | --- | --- |
| Clamshell sleep begins at 13:51:06 JST | macOS power history | Matches the first large client timer gap |
| First large timer gap is 145.236 s | Local client event-loop monitor | Starts at +340.591 s |
| Last successful response precedes sleep | Client request history | Completes at +332.477 s |
| Empty-pool responses precede sleep | Client request history | First occurs at +71.750 s |
| Cloud driver sees empty-pool waits | Durable cloud client records | Independent of laptop execution |

| Candidate cause | Local timer and HTTP failures | Pre-sleep empty waits | Cloud empty waits | Assessment |
| --- | --- | --- | --- | --- |
| Laptop sleep | Fits | Does not explain | Does not explain | Explains the local measurement interruption |
| Measurement clocks | Fits the invalid time mapping | Does not remove responses | Separate durable timestamps | Invalidates the local full-window rate |
| Preparation and admission capacity | Does not explain timer gaps | Fits | Fits | Remains the service-capacity issue |

The local runner now records wall-clock continuity and rejects timing qualification after a large clock divergence.
The cloud driver persists operation, request, and demand records before dispatch.
An interrupted request remains an explicit unknown outcome. It cannot become a successful measurement.

The driver rejects an unauthenticated control request. A configured 200 ms delay measures 200 ms.
A two-wallet control produces two standard signatures, verifies exact replay, and has complete A/B and Router coverage.

The four-wallet run has exact Router coverage for every attempt and completed A/B traces for every verified operation.
Two closed-window exports, separated by a drain, contain the same 9,731 records and the same digest.
Tail capture runs after producer execution, so the method includes a bounded drain before comparing exports.
See [Cloudflare's Tail Workers documentation](https://developers.cloudflare.com/workers/observability/logs/tail-workers/).

The independent review checks the host sleep diagnosis, instrument lifecycle, material identities, duplicate alarms, and starting-stock bound.
The eight-wallet run also has exact Router and A/B coverage.
Its two closed-window exports contain the same 46,866 records and the same digest.
A local DNS interruption delays observation. Durable cloud results continue without restarting an operation.

Material accounting ends at a fixed two-minute horizon after each load window.
This prevents delayed exports from counting later idle maintenance as load-time material loss.
The raw public records retain missing or truncated coverage explicitly.

## Repeat and remaining work

Extract the archive named in the evidence summary. Use the measured Node 26.4.0 runtime for offline signature verification:

```sh
node verify-signatures.mjs .
```

The verifier checks 107 signatures and rejects 107 changed messages.
Recompute the capacity summaries from the extracted directory:

```sh
python3 analysis/summarize_capacity.py cohorts/cloud-four/client.json cohorts/cloud-four/traces.json scope.json four-summary.json
python3 analysis/summarize_capacity.py cohorts/cloud-eight/client.json cohorts/cloud-eight/traces.json scope.json eight-summary.json
```

These outputs must match their archived summaries. The manifest records every public file's byte count and SHA-256 digest.


The repeatable driver is `tests/e2e/ml-dsa-cloud-load-worker.mjs`.
The controller is `tests/e2e/ml-dsa-cloud-load.e2e.mjs`.
The analysis is `tools/ml-dsa-investigation/research/summarize_capacity.py`.
The [evidence summary](../evidence/ml-dsa-65-sustained-capacity-20261025.json) indexes the reproducible compressed archive.
It retains public registration receipts, clients, bounded traces, deployment versions, policy, source hashes, and cleanup receipts.
The archive retains the deployed driver bytes. The committed fixture receives formatting after deployment.
It excludes authentication tokens, storage keys, and private raw tails.

All six temporary Workers are deleted. Independent Cloudflare API reads confirm that all six are absent.
Local benchmark credential files are removed after evidence capture.
The required bloat check still reports inherited Rust duplication: 13,972 lines against a 13,754-line baseline.
This campaign changes no Rust source. The native tool lockfile records three required feature dependencies without version changes.

The next capacity work should address idle material replacement and admission contention, then measured preparation CPU.
Admission currently claims the single service slot before checking participant inventories.
Empty-pool checks therefore occupy that slot briefly. Their contribution needs a controlled measurement.
The test's five-second service-capacity polling also contributes to demand latency.
A later controlled parallel-producer test can measure scale while retaining the same per-wallet capacity and trust boundaries.
The production release still needs capacity qualification through the public SDK and the final composition security review.
