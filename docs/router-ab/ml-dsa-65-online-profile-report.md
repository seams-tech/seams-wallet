# ML-DSA hosted online execution — October 17, 2026

The storage follow-up qualifies 24 of 24 successful requests below five seconds.
Successful requests take 0.989–3.497 seconds, with a 1.520-second median.
One two-batch signature takes 1.781 seconds. All 24 signatures verify.
The first optimized deployment reached 23 of 24 below five seconds.
Its slowest successful request took 5.390 seconds and consumed one batch.
The instrumented baseline reached 11 of 12 below five seconds, with a maximum of 5.949 seconds.
These are prepared, admitted HTTP requests through the experimental Router and both hosted participants.
Empty-pool demand waits remain separate and can exceed five seconds.
Public Wallet login, SDK confirmation, NEAR submission, and finality are outside this campaign.

## Changes and preserved boundaries

The Worker now retains immutable public circuit layouts across signing operations.
The cache contains schedule digests, gate indexes, wiring, and output positions.
Private correlations, nonce material, and signing shares retain per-operation ownership.
No cache borrow crosses an asynchronous call.

Packed private-word loads now use the public lane width directly.
Public schedule decoding is inlined.
The load addresses and branches depend on public widths and gate indexes.
An independent source review found no new secret-dependent addressing or removed explicit wipes.
This review does not certify generated machine code, register erasure, or total stack erasure.

Data frames now carry cumulative delivery acknowledgments.
One-way streams receive a standalone acknowledgment every four frames.
Final flush and peer-close paths acknowledge remaining data.
Sequence, credit-window, deadline, permit, and operation bindings remain enforced.
Both participants must deploy this frame format together.
The circuit's dependent rounds and private calculations remain unchanged.

The storage follow-up removes writes of unchanged inventory indexes, refill state, and producer queues.
Expiry cleanup, reservation, consumption, settlement fences, release, and recovery remain durable.
Read responses clamp stale advisory retry times to at least one second after the current request time.
Refill scheduling uses paired stock and active leases. The advisory retry time does not control eligibility.

The policy remains four ready batches, eight candidates per batch, one producer, and one active signing operation.
The saturation test uses a one-second wallet cooldown. The product default remains sixty seconds.
The canonical wallet-derived FIPS seed, authorized export, and separate participant stores remain unchanged.
GPU work and public production integration remain deferred.

## Instruments and controls

Client monotonic timing measures the complete final HTTP request.
The E2E retains every unavailable, failed, declined, and successful request.
OpenSSL verifies every retained successful signature through Node's crypto API.
Complete demand timing includes retries after empty pools and exhausted operations.

Cloudflare invocation records supply CPU and elapsed totals for each role.
New public diagnostics record a random Wasm module identity, signing ordinal, schedule-cache state, layout-cache counters, and protocol events.
The identity begins lazily at the first signing attempt.
A first observed signing call does not prove a cold isolate or measure startup.
Unavailable random diagnostics produce a null identity and do not prevent signing.
The earlier instrumented baseline binary used a fatal diagnostic RNG-error path. No such error was observed.
Its exact source snapshot is retained in the evidence.

A known-work clock control ran zero, fifty million, and one hundred fifty million loop iterations three times each.
All nine CPU-only clock deltas were zero.
Seven of nine service-binding deltas were also zero. The other two were 10 and 129 milliseconds.
Therefore, stage timestamps measure observed clock advancement, with incomplete coverage of CPU and I/O work.
Do not sum them into a request timeline or subtract invocation CPU to infer pure network or storage wait.
The same restriction applies to the socket-event boundary counters.

Cloudflare's live CPU-profile API returned HTTP 404, code 10393, for these capture attempts.
Known Worker and version lookups succeeded. The JavaScript traffic control completed 32 requests.
No hosted sampled CPU profile was obtained. Account eligibility, routing, and capture behavior remain unresolved.
The actual Rust participant also returned the same capture error.
This result does not establish that live profiling is unavailable on other accounts or deployments.
The [Cloudflare profiling documentation](https://developers.cloudflare.com/workers/observability/profiling-in-production/) and
[profile API](https://developers.cloudflare.com/api/typescript/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/profile/) define that instrument.
The [Worker timer documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/) describes clock restrictions.

## Observed differences

| Control | Verified signatures | Successful HTTP median | Successful HTTP maximum | Below five seconds |
| --- | ---: | ---: | ---: | ---: |
| Instrumented baseline | 12 | 1.922 s | 5.949 s | 11/12 |
| Cache, packed loads, and cumulative ACK | 24 | 1.879 s | 5.390 s | 23/24 |
| Storage follow-up | 24 | 1.520 s | 3.497 s | 24/24 |

The baseline's one-batch operations rebuilt five public layouts per operation.
Warm optimized operations build zero layouts and record five cache hits per batch.
The baseline's warm one-batch A invocations have a 400-millisecond CPU median across four samples.
The optimized equivalent has a 240-millisecond median across eleven samples.
The first observed one-batch A calls vary from 502 to 1,115 milliseconds in the optimized deployment.
Their schedule-cache flag is false. Public cache reuse explains part of the observed CPU variation.
Sequential campaigns and changing platform conditions prevent a causal speedup percentage.
The final storage variant's warm one-batch A median is 194 milliseconds across eleven captured invocations.
Its first observed one-batch A median is 494 milliseconds across nine captured invocations.
Only captured invocations enter these groups. Three final operations lack both participant traces.

One-batch A pending socket-event polls fall from 709 to 354.
B has 707 pending polls and one immediately ready event in the baseline.
Captured optimized B invocations have 355 or 356 pending polls and approximately 356 total events.
Standalone ACKs fall from approximately one per data frame to one or zero per signing participant.
Payload counters exclude application headers, acknowledgments, WebSocket framing, and TLS.
These counters establish less event work, without an exact wire-bandwidth claim.

The first candidate's 5.390-second operation has these Router service-call observations:

| Call pair | First completion | Second completion |
| --- | ---: | ---: |
| Inventory | 878 ms | 1,020 ms |
| Reserve | 59 ms | 688 ms |
| Settlement fence | 48 ms | 699 ms |
| Release | 67 ms | 155 ms |

Each row contains two unordered participant calls.
The original logs do not identify the destination role. Action labels follow the coordinator's sequential call-pair order.
The storage follow-up emits explicit action labels.
The admitted signing call reports 2,611 milliseconds.
A uses 1,115 milliseconds of invocation CPU and 2,590 milliseconds elapsed.
B uses 1,009 milliseconds of invocation CPU and 2,563 milliseconds elapsed.
Service-call measurements cover the complete observed call boundary. They do not isolate database-write cost.
These observations motivated the storage follow-up. They do not identify a single Cloudflare internal cause.

## Diagnosis record

| Fact | Instrument | Check and limit |
| --- | --- | --- |
| Clock deltas omit known work | Hosted loop and service-binding control | Nine known CPU cases, three iteration counts |
| Warm operations reuse public layouts | Module identity and build/hit counters | Exact deployment and matching batch count |
| Socket event work approximately halves | Pending event and ACK counters | Matching one-batch operations; circuit rounds unchanged |
| Slow successful signing can use one batch | Client signature verification and Router outcome | 5.390-second first-candidate operation |
| Storage calls can consume substantial observed time | Router service-call diagnostics | Complete call boundary, frozen-clock limitation |
| Recovery reproduces the canonical key | Full local registration/recovery and native E2Es | Current storage variant; standard reference checks |

| Candidate cause | Cache and CPU observations | Event counts | Slow one-batch request | Status |
| --- | --- | --- | --- | --- |
| Public layouts rebuilt on every operation | Fits baseline; warm cache removes rebuilding | Says nothing | Does not explain storage calls | Contributing work removed |
| Excess standalone ACK processing | Says nothing | Fits direct count reduction | Does not explain all storage/CPU variation | Contributing work removed |
| Too many signing candidates alone | Says nothing | Batch counts matched | Contradicted by slow one-batch request | Insufficient explanation |
| Unchanged storage writes add work | Says nothing | Says nothing | Fits long inventory calls | Redundant writes removed; hosted follow-up measures the result |
| Network delay alone | Contradicted by differing CPU totals | Says nothing | CPU and elapsed both vary | Insufficient explanation |
| Platform CPU scheduling, placement, or startup | Fits first-call CPU spread | Says nothing | Fits remaining variation | Internal cause unresolved |
| Measurement overhead or missing logs | Controls retain overhead and missingness | Counters reproduce captured events | Cannot explain away client latency | Remains a comparison limit |
| Our implementation | Demonstrated redundant layouts and writes | Demonstrated redundant ACKs | Several contributors, no single cause | Reduced and requalified |

## Validation and remaining limits

The current full local Worker E2E verifies signing, automatic refill, duplicate replay after restart, admission, and a stalled peer.
The stalled operation expires without a signature. The peer closes within the permit deadline.
Local registration and recovery reproduce the same standard key and verify initial signatures.
The native screen checks canonical keys, sharing, prepared signing, and recovery with injected network delays.
An initial native screen exhausted all its bounded GMW candidates and failed its success assertion.
This is a `valid_test_needs_update` sampling limit. Production permits candidate exhaustion.
One fresh control repeat and both subsequent optimized native screens complete successfully.
The failed screen remains in the evidence. No pool or retry policy was enlarged to pass it.

Tail capture is incomplete for some successful participant invocations.
One baseline success lacks both participant traces. Fourteen first-candidate successes lack B's trace.
Client verification and Router outcome records remain present.
Cache and CPU statistics use only captured exact-version invocations and expose missing identities separately.
Two first-candidate paired batch arrivals lack a successful producer completion record.
Inventories observe those arrivals. The completion ledger remains explicitly incomplete.
The candidate also records two producer exceptions classified as `runtime_code_update_reset` and one unclassified producer exception.
The reset causes remain unknown. Missing publication completions cannot be attributed solely to telemetry loss.
All canceled, exceptional, and unknown invocations remain in the curated evidence.
The final variant records two producer reset exceptions and further cancellations.
Those resets also remain unexplained. Successful client requests and durable paired stock remain independently observable.

Product parity is limited to the private prepared-signing and durable registration routes.
The test uses one wallet and one active operation. It does not establish multi-wallet capacity or production percentiles.
Initial stock is excluded from sustained refill rates. Final reserve restoration is measured separately.
The first candidate starts with three observed ready pairs and one prestarted producer.
That producer's pair arrives approximately 28.3 seconds after the client starts.
Its work is excluded as initial stock. These starting conditions differ from a complete four-pair ready reserve.
No observed signing latency creates an empty-pool guarantee.

The final client interval is 810.763 seconds. It consumes 25 distinct batches for 24 signatures.
After initial stock depletion, observed refill supplies 1.640 paired batches per minute and supports 1.562 successful signatures per minute.
Complete demand latency reaches 91.011 seconds. Only three of 24 complete demands finish below five seconds.
The E2E's broad `latencyTargetMet` field remains false because it includes unavailable and declined requests.
The prepared successful-request screen passes. Capacity-inclusive latency remains a release gate.

Final observed stock balances: `4 initial + 25 new = 25 consumed + 4 final`.
No reservation remains. The operation records show 200 evaluated candidates.
Final reserve restoration adds 101.658 seconds after the client interval.
Two paired arrivals lack successful publication-completion records, so completion accounting remains incomplete.
The 23 captured successful completions take 16.285–50.012 seconds, with a 27.849-second median.
These durations exclude failed and unknown producers. Their events remain in the evidence.
The final client retains 208 unavailable requests and 208 declined requests, alongside its 24 successes.
Independent review verifies all sixty signatures across the three campaigns and rejects all 120 altered-message/signature checks.
All 67 consumed batch identities are distinct across the campaigns.

Reproduce the public diagnosis with `collect_worker_traces.py`, `summarize_refill.py`, and `summarize_signing_traces.py`.
Pass the exact per-role deployment-version map to both summary commands.
Run `ml-dsa-sustained-worker.e2e.mjs` with `ML_DSA_TEST_SUCCESS_TARGET=24` after observing the four-batch reserve.
Run the full durable Worker and registration E2Es against the same release bundles for recovery and lifecycle checks.
The evidence retains source hashes, bundle hashes, exact versions, private-source snapshot hashes, and the clock/API controls.
The compressed evidence bundles preserve exact UTF-8 file text under `files`.
Extract those entries into one isolated directory. Version maps use `hosted/` and independent review scripts use `review/`.

## Evidence and next work

- [Hosted clients, exact-version traces, and summaries](../evidence/ml-dsa-65-online-hosted-20261017.json.gz).
- [Local Worker, registration, native checks, and sampled profiles](../evidence/ml-dsa-65-online-local-20261017.json.gz).
- [Clock, profile-API, parser, and instrumented-source controls](../evidence/ml-dsa-65-online-controls-20261017.json.gz).
- [Independent verification receipts and reproduction scripts](../evidence/ml-dsa-65-online-review-20261017.json).
- [Build/source provenance, validation, and cleanup](../evidence/ml-dsa-65-online-provenance-20261017.json).

All five temporary Workers were deleted. All five tail sessions were stopped.
Benchmark credentials, role keys, private fixture directories, and raw tails were removed after credential scanning.
The scan includes decompressed evidence and common key encodings. Authorized public test seeds remain as recovery fixtures.
The bloat check retains its inherited duplication failure: Rust 13,984 against 13,754 and TypeScript 10,238 against 10,216.
This change does not increase either count. The baseline file remains unchanged.

The next qualification must repeat prepared signing with more fresh modules and more two-batch successes.
Measure multi-wallet capacity at the same pool cap and retain unavailable demand latency.
Investigate the producer resets before treating successful completion records as a complete refill ledger.
A hosted sampled CPU profile and verified placement would help distinguish remaining platform causes.
Current stage clocks cannot settle that distinction.
Public integration remains gated by sustained capacity, broader lifecycle coverage, and production security review.
