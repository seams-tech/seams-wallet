# ML-DSA complete wait traces and hosted retirement ordering

Compact diagnostics preserve both preparation traces without provider truncation in the matched screen.
The screen does not establish a benefit from explicit commit barriers.
Storage failures prevent a successful unwrapped baseline and stop recovery in the sync arm.

## Changes and constraints

The Rust trace records the first pending peer event once per call.
Counters still cover every peer observation. Storage boundaries, completion handshakes, and final summaries remain.
The first peer event proves a historical suspension. It does not identify the final blocked receive after an interruption.
Detailed tracing remains disabled by default. Production adds no explicit `storage.sync()` call.

A test-only fixture controls two preparation-response orderings.
It allows the real A preparation to return `true`, then substitutes HTTP 503.
In the unclaimed ordering, the Router must retire the exact job.
In the claimed ordering, the fixture first observes admission of that exact job, then releases the failed response.
The Router must preserve the admitted operation.

The fixture uses existing Gateway and participant authority boundaries.
Only the Gateway can arm, restart, or query its public control route.
The A wrapper uses internal authority to report completion and wait for the matching claim.
The fixture stores public job and operation metadata only. Production entrypoints do not import it.

Wallet-seed recovery and FIPS export remain unchanged.
Preparation uses four candidates. Signing consumes two at a time.
Capacity remains thirty-two candidates per wallet, with sixteen required for admission.
The sixty-second cooldown and one-operation service limit remain unchanged.

## Matched hosted screen

Both arms use the same frozen Wasm binaries, client script, synthetic wallet, credentials, policy, and six-role topology.
Only the forwarding front has a public route.
Control uses native role entrypoints. Sync wraps actual registration transactions and awaits `storage.sync()` after transaction return.
Each arm starts with fresh namespaces. Placement, cache history, platform load, and random candidate outcomes remain uncontrolled.
The control runs first. A single bounded repeat retains the same deployment after an initial admission failure.
The sync arm uses newly created namespaces. These sequential runs cannot establish a causal speedup.

| Attempt | Preparation | Registration | Verified signing | Result |
| --- | ---: | ---: | ---: | --- |
| Control, first attempt | Not reached | Empty-pool admission fails after 5.413 s | Not reached | HTTP 500 |
| Control, bounded repeat | 88.962 s | Fails after 39.153 s | Not reached | Admission storage timeout |
| Explicit sync, creation | 141.178 s | 23.855 s | 13.092 s | Canonical key and signature verify |
| Explicit sync, recovery | Fails after 110.700 s | Not reached | Not reached | Readiness publication and retirement request fail |

Preparation here includes generic registration material and sixteen initial signing candidates.
It is not a four-candidate refill measurement.
The verified signature consumes five pairs and evaluates ten candidates.
None of these attempts proves the five-second target or successful recovery for this screen.

The control repeat's A and B execution finish in 3.587 and 3.525 seconds.
An Admission invocation subsequently reports a 30.002-second storage-timeout reset.
The trace does not identify that invocation's exact admission command.

The failing sync preparation is job `8980c4235816173baab3d00b4185072f630d69a3791e55bcc5b6ec8f25fe3e09`.
Request and call IDs connect the Router to both participant invocations.
Both roles complete private preparation publication and the preparation acknowledgement.
Readiness publication then fails after 4.723 seconds on A and 4.897 seconds on B.
The Router records `retirement_failed=true` without a result.
The retirement request failed. The final durable tombstone state remains unknown without a later read.
Existing lease and cleanup alarms remain the fallback.

| Captured post-transaction intervals | Count | Median | Maximum |
| --- | ---: | ---: | ---: |
| A execution | 4 | 26.5 ms | 255 ms |
| B execution | 27 | 50 ms | 169 ms |
| B preparation, both jobs | 360 | 20 ms | 1,271 ms |

The explicit barrier changes scheduling and can wait for earlier writes.
Worker clocks can include preceding CPU when they advance at an I/O boundary.
These intervals do not isolate disk service time or partition request latency.
The successful readiness-publication intervals are 6.532/5.949 seconds in control and 26.407/26.929 seconds in sync, for A/B respectively.
They include admission work, storage gates, delivery, and scheduling.

All 17 initial-control, 87 repeated-control, and 274 sync invocations report `logs_truncated=false`.
That value does not prove perfect tail capture.
The sync traces contain sixteen storage-internal-reset categories across multiple invocations. They do not establish sixteen independent incidents.

## Facts and remaining causes

| Fact | Instrument | Scope | Check |
| --- | --- | --- | --- |
| Both control attempts fail | Client HTTP records and sanitized provider tails | Frozen control deployment | Retain both attempts |
| Control participant execution completes before controller failure | Participant phase/call records and controller exception category | Control repeat | Invocation times and request correlation |
| Sync fails after preparation, at readiness publication | Exact job, call IDs, paired boundary events | Recovery preparation | Both roles show the same job |
| Retirement request fails too | Router retirement event | Same recovery request | Result is absent; durable state unknown |
| Commit intervals are visible and non-zero | Test wrapper around actual storage transactions | Sync registration objects | Prior local timer calibration; no disk-latency claim |
| No provider truncation is reported | Provider trace flag | All three retained attempts | Recomputed from sanitized records |

| Candidate cause or claim | Evidence | Status |
| --- | --- | --- |
| Yao evaluation is the immediate cause of the observed readiness failure | Both roles finish preparation before publication errors | Contradicted for this failure |
| Admission storage or its interaction with our workload contributes | Storage resets and failed publication/retirement requests | Fits; underlying cause unknown |
| Explicit sync fixes storage resets | Resets recur in the sync arm | Contradicted |
| Explicit sync improves latency | No successful control registration; sequential placement/load differ | Unproven |
| Our state transitions or workload cause provider storage failure | Native error boundaries are observed; provider internals are unavailable | Open |
| Measurement changes timing | Sync adds barriers; detailed logs add load | Fits; overhead remains unmeasured |

The screen exercises real hosted Worker protocol and storage operations.
Public login, browser lifecycle, and NEAR submission remain outside this campaign.
Parity with the full public SDK workload is not established.
Earlier browser recovery, export, and transaction evidence remains separate.

## Retirement ordering results

Both final local orderings pass canonical creation and verify one signature each.
The unclaimed case retains the retirement decision across restart and allocates fresh replacement stock before expiry.
The claimed case preserves the exact operation and replays its completed result after restart.
Neither one-epoch ordering campaign tests recovery. Their recovery flag is false.

Hosted results prove the retirement decisions, but both complete lifecycle campaigns fail later:

| Hosted ordering | Retirement evidence | Later failure |
| --- | --- | --- |
| Unclaimed | Native retired decision survives restart; late readiness and participant retirement reject; fresh replacement allocates 209.177 s before expiry | Replacement registration returns HTTP 500 during B installation |
| Claimed | Router reports `claimed`; supplemental restart check preserves the same recorded job and operation | Registration returns HTTP 500 during role-storage initialization |

The unclaimed Router reports a failed retirement acknowledgement.
The subsequent native-outcome record, restart, and late-readiness checks establish that retirement occurred despite that failed acknowledgement.
Its replacement execution completes in 3.112 seconds on A and 3.051 seconds on B.
B installation returns HTTP 500 after 20.894 seconds at the Router, matched to a 20.882-second B forwarding call.
No matching B registration-object trace identifies the internal failure.
The initial description of this replacement failure as a storage error is withdrawn.

In the claimed case, A/B execution completes in 2.590/2.544 seconds.
The Router then waits 34.787 seconds for role-storage initialization, which returns HTTP 500 before activation starts.
An A pool storage-reset invocation has a similar 34.751-second duration.
It lacks an exact request or operation join, so it is a possible related failure rather than an established cause.
The supplemental restart check proves persistence of the fixture-observed native `claimed` decision.
It does not prove successful or still-live registration. No hosted fault campaign verifies a signature.

The failure classification is provisionally `environment_or_infrastructure_failure`.
Storage and runtime failures occur in the campaigns, but the internal causes of the two HTTP 500 responses remain unresolved.
There is no demonstrated retirement-transition regression. Code defects remain possible until those boundaries are measured.
The unclaimed and claimed traces contain 301 and 234 invocations, respectively, with no reported truncation.
Expected exceptions from the deliberate fixture restart remain in the evidence.

The first local claimed fixture compared JSON field order and missed a valid native claim.
The corrected fixture compares the exact job ID. Production still validates the complete job identity.
The recorder also accepts an already-retired result when its first outcome acknowledgement was lost.
Earlier local artifacts incorrectly label a single epoch as recovery. The archive retains them with this correction and the final passing reruns.
The claimed-case registration timing is cached replay latency. All fault campaign timings are excluded from performance qualification.

An independent reviewer checked the final local and hosted retirement evidence, completion boundaries, and failure limits.
All six temporary Workers were deleted after the screen.
The required bloat check retains the inherited 13,972 versus 13,754 Rust duplication failure. Its baseline is unchanged.

The [evidence summary](../evidence/ml-dsa-65-matched-commit-20261024.json) links the sanitized archive, source hashes, scripts, deployment versions, and cleanup receipts.
To repeat the local ordering checks, use `ML_DSA_REGISTRATION_RETIREMENT_ORDER=unclaimed` or `claimed` with the existing registration Worker E2E.
The hosted campaign requires the authenticated fixture entrypoints recorded in the archive.
Fresh operation and material IDs are required for every run.

## Next implementation work

1. Correlate Admission commands with the request, job, and operation before each durable transition.
2. Separate controller transaction completion from participant readiness delivery, using calibrated low-volume observations.
3. Repeat an unwrapped successful lifecycle before selecting a storage optimization.
4. Repeat sustained refill and signing qualification with the same capacity after the failure boundary is resolved.

Explicit sync remains a test probe. GPU preparation remains deferred.
