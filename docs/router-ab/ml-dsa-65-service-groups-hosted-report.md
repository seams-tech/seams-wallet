# ML-DSA service groups: hosted scaling screen

Independent wallet service groups increase achieved Cloudflare throughput in this screen.
Complete-cycle output rises from 7.45 signatures/minute with one group to 12.01 with two and 25.48 with four.
The four-group result is 3.42 times the one-group result. It establishes no linear-scaling guarantee or maximum production capacity.
All 312 load signatures verify independently, and altered messages fail verification.

## Matched workload and timing boundary

The same eight temporary Worker scripts serve all three profiles. Only the configured group count changes.
Each six-minute profile uses four new active synthetic wallets, two refill slots and one signing slot per group, and a five-second benchmark cooldown.
All wallets retain thirty-two candidates, require sixteen for admission, and consume two at a time.
Profiles run sequentially with fresh keys and preparation. Earlier wallets remain assigned and idle.
Production defaults remain one group, one refill slot, one signing slot, and a sixty-second wallet cooldown.

Cloudflare durable drivers call the private Router through a forwarding Worker.
These timings exclude the public Gateway/SDK, browser network, login, human approval, NEAR submission, and finality.
Each complete-cycle denominator includes driver drain and observed restoration of exact initial reserve sizes.
Every initial material ID is consumed. Matching A/B final reserves contain sixteen pairs per active wallet, with no reservations.

## Complete cycles

| Metric | One group | Two groups | Four groups |
| --- | ---: | ---: | ---: |
| Verified signatures, complete cycle | 59 | 88 | 165 |
| Verified signatures by six-minute cutoff | 59 | 87 | 164 |
| Complete-cycle signatures/minute | **7.45** | **12.01** | **25.48** |
| Observed closure after cutoff | 115.124 s | 79.657 s | 28.550 s |
| Final successful call median | 0.984 s | 1.046 s | 0.737 s |
| Final successful call p95, nearest rank | 3.183 s | 2.222 s | 2.020 s |
| Final successful call maximum | 4.309 s | 2.996 s | 3.083 s |
| Successful complete-demand median | 20.666 s | 5.896 s | 5.103 s |
| Successful complete-demand p95 | 80.042 s | 44.151 s | 21.404 s |
| Below-minimum stock responses | 625 | 291 | 45 |
| Failed admitted operations | 0 | 3 | 4 |
| Consumed candidates, including failures | 314 | 518 | 978 |
| Preparation CPU | 696.242 s | 1,374.859 s | 2,437.948 s |
| Paired preparation jobs | 80 | 130 | 257 |
| Four-candidate checkpoint median | 9.140 s | 9.365 s | 9.249 s |

The two- and four-group cycles each include one trailing signature after cutoff. Its completion and cost remain in the denominator.
Closure includes driver completion, settlement, and observation. It does not isolate refill execution.
Successful calls exclude earlier cooldown, service-capacity, and stock waits. Complete demands include those waits and driver retry behavior.
The offered demand ceiling is forty-eight demands/minute. The profiles deliberately overload the measured preparation capacity.
These demand latencies must not be presented as ordinary sixty-second production-policy signing latency.

The ledgers are:

- One group: 64 initial + 157 fresh = 157 consumed + 64 final pairs.
- Two groups: 64 initial + 259 fresh = 259 consumed + 64 final pairs.
- Four groups: 64 initial + 489 fresh = 489 consumed + 64 final pairs.

Claims, queue records, running records, role publications, terminal settlements, actual versions, and producer-group ownership match.
No material reuse, missing captured execution, provider exception, or log truncation is found inside the qualified cycles.
Canceled invocations remain in the CPU totals. A provider cancellation alone does not establish failed preparation.

## Rejection and setup failures

The three two-group failures exhaust eight, nine, and eleven admitted pairs: fifty-six candidates total.
The four four-group failures exhaust eleven, eleven, twelve, and eight pairs: eighty-four candidates total.
Both participants consume identical sets. Their costs remain included. The driver retains a demand while retrying a failed operation with a fresh operation ID.

All twelve wallets pass canonical creation and recovery, for twenty-four verified key-generation ceremonies.
Private registration with generic stock ready spans approximately 4.96–8.83 seconds across those cases, including client verification.
Generic registration preparation separately spans 50.45–117.56 seconds. This includes key-independent key-generation preparation and initial signing stock.
It differs from a four-candidate key-bound refill job.
One initial-stock setup signature exhausts sixteen candidates. Its original E2E remains functionally failed; canonical creation/recovery and its later epoch signature pass.
That failure remains outside the timed windows and appears in the setup evidence. Twenty-three successful setup signatures are retained separately.

A reused benchmark driver name returns HTTP 409 before starting the two-group load.
The corrected profiles use unique driver identities. Preserve the failed setup record; no wallet registration is repeated to hide it.

## Runtime variation and instrumentation

Most producer slots have four-candidate medians near 8.6–9.6 seconds.
The group-one primary remains slower: its median is 19.036 seconds in the two-group screen and 17.966 seconds in the four-group screen.
Its paired invocation CPU is about 4.6 seconds per candidate, versus roughly 2.1–2.4 elsewhere.
Both participants remain slow across multiple jobs. Protocol byte counts and candidate width match.
A single cold invocation, different width, or extra protocol traffic cannot explain the entire observed difference.
The host, compiler-tier, and scheduling cause remains unknown. Whole-invocation CPU does not isolate the cryptographic kernel.
CPU excludes network and storage waits. Wall time includes those waits. [Cloudflare CPU definition](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

The remaining CPU diagnosis has these facts:

| Fact | Instrument and scope |
| --- | --- |
| Frozen Wasm, width, and protocol traffic match | Build hashes and paired transport records across slots |
| The slow primary remains slow across its first and last jobs | Twenty-one four-candidate jobs in two groups; paired CPU and checkpoints |
| The same logical actors remain slow after redeployment | Four-group producer IDs, new module identities, and CPU records |
| CPU and wall time differ in what they measure | Provider CPU excludes network/storage waits; checkpoints include them |

| Candidate cause | Evidence result |
| --- | --- |
| One cold invocation alone | Contradicted by persistent slow jobs |
| Extra candidates or protocol traffic | Contradicted by matched width and byte counts |
| Extra I/O waiting alone | Cannot explain the active CPU increase |
| Host hardware or compiler tier | Remains possible; no direct host or compiler-state measurement |
| Concurrent runtime work or placement | Remains possible; invocation CPU is not a kernel profile |
| Measurement or observer effects | Not fully excluded without a quiet return control and matched public calibration |

Recorded active preparation stays at one per Wasm instance. Recorded Wasm allocation peaks at 94,502,912 bytes, about 90.1 MiB.
This excludes JavaScript heap and does not establish complete isolate peak memory.
Distinct object identities and overlapping protocol lifetimes do not establish simultaneous physical CPU execution.

Most large first-request `alarmLatenessMs` values include cadence debt from a previous demand.
The stored target remains demand-start plus interval, while the actual success alarm can be armed at current-time plus one millisecond.
Those values do not isolate provider scheduler delay. Actual retry lateness reaches 19.558 seconds in one group and 54.818 seconds in two.
The four-group retry maximum is 267 milliseconds. Keep measured throughput and complete demand times unchanged.
These observations describe the private load driver. They do not establish public SDK timer behavior.

## Deployment implications and remaining work

Keep one group as the low-volume default. Increasing the group count assigns newly arriving wallets without moving existing wallets.
The four original assignments remain zero after the two-group rollout. All eight earlier assignments survive the four-group rollout.
The final four active wallets occupy groups zero through three, with independent admission and producer objects.
Group expansion therefore adds useful measured capacity without increasing stock per wallet or creating per-user Worker deployments.

The screens use fresh wallets, different rejection outcomes, sequential execution conditions, and fixed active-wallet count.
They support higher achieved capacity with more groups. They do not establish proportional scaling with a larger user population.
Next, qualify more active and idle wallets, choose production budgets, and repeat quiet slow-actor controls with matched public calibration.
Earlier idle wallets resume one-hour expiry maintenance after the timed windows. Include that cost in a population-sized qualification.
Wallet-seed recovery, canonical FIPS export, participant trust boundaries, two-at-once consumption, and pool capacity remain unchanged.

All eight temporary Workers are deleted. Independent queries confirm absence. The final authoritative snapshot records zero pending jobs across twelve wallets.
[Replayable evidence](../evidence/ml-dsa-65-service-groups-hosted-20261030.json) preserves all three cycles, setup qualifications, source/build hashes, raw provider selection, and cleanup receipts.
