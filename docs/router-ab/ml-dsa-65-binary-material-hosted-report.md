# ML-DSA binary delivery: hosted comparison

Binary prepared-material delivery removes base64 expansion from the bulk consumed ciphertext.
The matched Cloudflare screens establish no overall signing-latency or throughput gain.
Both screens complete with ordinary verified signatures and exact reserve restoration.
The earlier 7.699-second call is not an inherent JSON-format lower bound: this JSON control completes eleven pairs in 2.634 seconds.

## Configuration and boundary

Four disposable wallets create and recover canonical FIPS ML-DSA-65 keys before the comparison.
Each wallet retains thirty-two candidates, with sixteen required for admission.
Preparation stays on Workers. Jobs prepare four candidates, with existing bounded two-candidate top-ups; signing consumes two at a time.
Both windows use two preparation slots, one signing slot, and a thirty-second benchmark wallet cooldown.
Production defaults remain one preparation slot and a sixty-second wallet cooldown.
Wallet-seed recovery, canonical export, stored formats, and interparticipant cryptographic messages remain unchanged.

Cloudflare durable drivers call the private Router through the forwarding Worker.
These timings exclude public Gateway/SDK execution, browser network, login, human approval, NEAR submission, and finality.
Each requested window lasts twelve minutes. Complete-cycle rates include final reserve restoration.

## Complete cycles

| Metric | JSON/base64 delivery | Binary delivery |
| --- | ---: | ---: |
| Verified signatures | 96 | 93 |
| Complete-cycle signatures/minute | 7.738 | 7.435 |
| Reserve observed full after cutoff | 24.347 s | 30.506 s |
| Fresh and consumed candidates | 578 | 584 |
| Preparation CPU | 998.828 s | 1,007.411 s |
| Preparation CPU per candidate | 1.728 s | 1.725 s |
| Final successful call median | 0.837 s | 0.907 s |
| Final successful call p95, nearest rank | 2.087 s | 1.992 s |
| Final successful call maximum | 3.029 s | 2.728 s |
| Calls below five seconds | 96/96 | 93/93 |
| Complete demand median, including waits | 8.483 s | 7.977 s |
| Complete demand maximum | 14.039 s | 41.857 s |
| Below-minimum stock responses | 2 | 7 |
| Failed or declined signing operations | 0 | 0 |

The JSON ledger is 64 initial + 289 fresh = 289 consumed + 64 final pairs.
The binary ledger is 64 initial + 292 fresh = 292 consumed + 64 final pairs.
All starting material is consumed. No pair serves two operations. Final A/B sets match exactly, without reservations.
All 161 JSON and 165 binary jobs have matching claims, executions, publications, settlements, and versions.
One binary demand remains censored at cutoff without live signing authority. Its requests and costs remain included.

Binary uses more candidates per successful signature in this sample.
Almost equal preparation CPU per candidate and different rejection outcomes prevent treating the rate difference as a codec effect.
Preparation accounts for about 91% of captured CPU in both windows.
No finite screen establishes a maximum production rate or consistent five-second user wait.

## Equal-pair signing

The following medians exclude four schedule-cache-miss operations per window.
Pair counts and sample counts remain explicit.

| Consumed pairs | Warm samples, JSON / binary | Call median, JSON / binary |
| --- | ---: | ---: |
| 1 | 25 / 24 | 469 / 523 ms |
| 2 | 24 / 19 | 746 / 761 ms |
| 3 | 14 / 18 | 992 / 901 ms |
| 4 | 12 / 11 | 1,243 / 1,068 ms |
| 5 | 5 / 7 | 1,241 / 1,147 ms |
| 6 | 5 / 5 | 1,702 / 1,628 ms |

Several three-to-five-pair latency observations improve. One- and two-pair call medians increase. Role execution CPU results are mixed.
Small sample counts, random rejection outcomes, module identities, and sequential deployment conditions prevent a stable gain claim.
The archive retains every operation, both roles, cache misses, module identities, take spans, and whole-invocation CPU.
Stage clocks can omit CPU. Their spans include scheduling, transfer, and processing and do not isolate database or serialization cost.

The retained structural benefit is raw ciphertext delivery without its base64 expansion.
For large ciphertext, that reduces its transfer representation by approximately one quarter, while leaving metadata and MPC traffic separate.
The result must not be advertised as an overall latency improvement.

## Remaining stock wait

Seven binary stock responses affect one operation after its preceding signature consumes nine pairs, or eighteen candidates.
Six paired Ready records remain against an eight-pair admission minimum.
A live refill restores eight pairs and admission proceeds.
The operation completes 7.428 seconds after its first stock response, including one service-capacity response and a 500 ms retry.
The 41.857-second complete-demand maximum belongs to a different operation. It comprises a 26 ms cooldown reply, a 3.086-second scheduled wait, 37.448 seconds of recorded driver alarm lateness, and a 1.297-second signing call.
This is a below-minimum reserve, rather than an observed zero-stock pool.

The data therefore does not establish removal of material waits.
Preparation CPU and burst replenishment remain the main performance priorities at the same pool capacity.

## Instrument and setup qualifications

Both deployed arms use the same updated driver hash.
That driver follows the existing public Gateway's 500 ms service-capacity cap, a 100 ms minimum, and exact server times for other retry reasons.
The binary driver also records alarm lateness of 43.159 and 30.397 seconds before new demands begin.
Those delays reduce offered load but fall outside those demands' recorded latency.
Five binary requests exceed one second of recorded lateness, versus one JSON request at 3.507 seconds.
The exact delay cause remains unknown. Preserve measured throughput without subtracting these intervals.
These scheduling observations further prevent assigning the 93-versus-96 result to the codec or preparation capacity.
They do not establish public SDK timer behavior.

The JSON control's raw client artifact still describes the old generic one-to-five-second cadence.
Its script hash and deployed source establish the actual behavior. The raw artifact stays unchanged.
The collector descriptor is corrected for later collection. Public Gateway and SDK code remain unchanged.

Two setup failures precede all timed demand:

- A copied bootstrap config references the wrong artifact path. A dependent class binding reports Cloudflare error 10061.
  The corrected bootstrap and complete release both verify all eight roles before wallet tests.
- The first disposable client directory generates holder keys different from the approved server keys.
  The failed evidence is preserved. Each client directory then uses the approved holder set, with recipient equality checks unchanged.

Both are environment_or_infrastructure_failure cases. Neither requires a production cryptographic change.
All four wallets subsequently pass creation and wallet-seed recovery.
Remaining short-lived setup stock is retired and replaced outside the timed windows, without increasing reserves.

Provider cancellation is not automatically preparation failure.
One binary canceled record contains completed cryptography, publication, settlement, and wake completion for its exact job.
Its B partner publishes the same pair, which remains in the final reserve.
Its 1,817 ms CPU remains included. Total canceled-event CPU is 1,823 ms; the exact provider cancellation cause remains unknown.

## Evidence and cleanup

Independent verification accepts all 189 signatures and rejects all 189 altered messages.
A final authoritative check finds zero pending preparation jobs across four wallets.
The continuous provider selection preserves all statuses and complete invocation envelopes that intersect the experiment interval.
All 32,533 retained provider records reproduce both cycle analyses and preserve the original closed-window fingerprints.

All eight temporary Workers are deleted. Independent queries confirm all eight are absent.
The archive scan checks every generated synthetic credential and its encodings before publication.
The inherited bloat check remains at 13,992 Rust duplicated lines against 13,754, without a baseline increase.

[Replayable evidence](../evidence/ml-dsa-65-binary-material-hosted-20261030.json) contains the archive hash, complete measurements, role costs, and cleanup receipts.
After extraction, run `python3 replay.py` with Python 3 and Node.js with ML-DSA support.
The replay requires no credential or network access.

The next useful performance experiment is preparation CPU execution overlap. Avoid further material-wire tuning without a new measured bottleneck.
