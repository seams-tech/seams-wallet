# ML-DSA preparation: direct dispatch to the durable producer

Campaign: 2026-10-18–19 JST. Production qualification remains open.

Direct dispatch removes a forwarding request, but this screen demonstrates no material dispatch speedup.
Median claim-to-queue time changes from 927 to 905 milliseconds. Candidate signing finishes below five seconds in thirty of thirty-one successes.
The remaining request takes 7.790 seconds, and preparation still exceeds the useful-cost target.

Worker A now dispatches a preparation job directly to its durable producer in the separate preparation Worker.
The previous path passed through an additional forwarding Worker request.
The change removes that request and its public forwarding route. It preserves the producer's authentication, lease check, durable state, and alarm execution.

Preparation stays on Workers. Four-candidate groups, thirty-two candidates per wallet, and the sixteen-candidate admission minimum remain unchanged.
The service still allows one producer and one admitted signing operation.
The production cooldown remains sixty seconds. The benchmark retains its one-second cooldown.
Wallet-seed recovery and ordinary FIPS seed/key export remain required.
GPU work and larger pools remain deferred.

## Optimization order

1. Attribute dispatch and preparation-start delays to exact jobs.
2. Remove the forwarding request and measure the resulting path.
3. Repeat recovery, registration, and multi-group signing checks with fresh material.
4. Report missing cost records and unfinished demands before making capacity claims.
5. Use the next measured bottleneck to select further preparation work.

## Evidence before the change

The preceding refill-wake campaign establishes a local scheduling gain without qualifying hosted performance.
Its exact job IDs permit a narrower analysis than the earlier next-global-load join.

| Retained service-clock interval | Earlier control | Refill-wake candidate |
| --- | ---: | ---: |
| Controller entry to lease claim | Not instrumented | 70 ms median, 59 jobs |
| Lease claim to producer queue log | 959 ms median, 59 jobs | 1,030.5 ms median, 60 jobs |
| Producer queue log to running log | 50 ms median, 61 jobs | 50 ms median, 59 jobs |
| Running log to A preparation load | 811 ms median, 61 jobs | 792 ms median, 59 jobs |

The claim-to-queue interval includes orphan reconciliation, forwarding, decoding, and the producer's admission check.
It does not isolate the forwarding request's cost.
Service clocks can omit CPU, and these spans cross actors. They are not CPU or pure idle-time measurements.
The new analysis requires exactly one observation of each endpoint for each job and role.
It excludes observed repeated stages, missing stages, missing clocks, and negative deltas. Missing records can conceal retries.
Older claim endpoints use retained log timestamps. New claim endpoints use explicit stage timestamps. It never substitutes adjacent global jobs.

## Implementation and ownership

The controller uses an `ML_DSA_PRODUCER_DO` namespace binding whose `script_name` identifies the preparation Worker.
An external binding selects that Worker's namespace, as described in the [Cloudflare binding documentation](https://developers.cloudflare.com/durable-objects/reference/environments/).
The preparation Worker remains the namespace owner. Heavy preparation still runs in its producer alarm.

The request continues to use the batch ID as the durable object name.
The producer checks internal authentication, participant A, the private path, the bounded request body, and the current lease.
Its transaction retains the existing duplicate and changed-job rules.
The controller requires a 202 response and a true receipt before it treats dispatch as acknowledged.
FIFO admission, paired publication, terminal settlement, and recovery alarms are unchanged.

The obsolete forwarding handler and `ML_DSA_PREPARER` service binding are removed.
The local E2Es bind Worker A to the existing producer in `preparer-a`.
They address that owner directly for duplicate, changed, expired, and wrong-authority requests.

The temporary deployment creates each Worker's owned namespaces before publishing cross-bound final bundles.
This resolves the dependency between the pool and producer bindings without moving either namespace.
Bootstrap routes return 503 and receive no test traffic. The final rollout must complete for all five Workers before testing starts.
Explicit deployment phases enforce bootstrap and credential prerequisites.

## Timing coverage

Public per-job events identify controller selection, activation checks, both inventories, the lease claim, dispatch, producer receipt, authorization, queue persistence, and acknowledgement.
Additional boundaries identify alarm entry, recovery scheduling, role claims, peer connection, and preparation load.
The events contain public job IDs, roles, stages, and optional timestamps.
They expose no seed, signing share, nonce, or secret circuit value.

Candidate instrumentation is part of the measured change. The old control has fewer timing events.
Small differences therefore cannot establish a pure forwarding-hop effect.
Cloudflare placement, runtime variation, and rejection outcomes remain uncontrolled between deployments.

## Fact list

| Fact | Instrument | Where | Check |
| --- | --- | --- | --- |
| The prior claim-to-queue interval is about one second | Per-job trace join | Previous hosted campaign | Recomputed from retained IDs and timestamps. |
| The prior controller-to-claim interval is about seventy milliseconds | Controller and claim events | Previous candidate | Fifty-nine complete joins. |
| The old path has a forwarding request before the producer | Source and deployment bindings | Baseline | Controller service binding forwards to the owned namespace. |
| Direct dispatch retains the namespace owner | Final and bootstrap bindings | Candidate | Independent source/config review. |
| Changed-job rejection appears as an exception in the direct local client | Real Miniflare E2E | Candidate test boundary | Test assertion updated without production changes. |

## Cause table

| Candidate cause | Facts | Assessment |
| --- | --- | --- |
| Forwarding request and startup | Included in the one-second dispatch interval | Targeted hypothesis; cost not isolated beforehand. |
| Reconciliation or producer authorization | Also included in that interval | New stage events separate these boundaries. |
| Cryptographic preparation | Starts after the measured dispatch interval | Remains a separate preparation cost. |
| Instrumentation or hosted variation | Candidate adds events and uses a separate deployment | Limits causal attribution. |
| Wrong producer ownership | Would move heavy work and change role bindings | Configuration review checks the existing preparation owner. |

## Local assertion update

The first candidate local run reaches the expected changed-claim rejection.
The direct Miniflare durable-object call propagates that rejection as an exception.
The previous forwarding Worker exposed an HTTP error response, which the old assertion expected.
This is classified as `valid_test_needs_update`.
The updated E2E requires the exact inactive-lease rejection for changed and expired claims.
It separately requires HTTP 403 for a wrong internal credential.
No production behavior changes to satisfy the test.

## Validation plan

Use frozen baseline and candidate Worker bundles with matching policies.
Run the full local durable lifecycle E2E with passive observation and verify standard signatures.
Run local registration and recovery through the new binding layout.
Run two hosted wallets for ten minutes, beginning and ending with the same full reserves.
Retain exhausted operations, unfinished demands, and missing records.
Verify retained signatures independently and compare canonical keys across creation, recovery, and profiles.
Delete temporary Workers and private benchmark files after recording sanitized evidence.

## Local results

Both complete durable Worker E2Es pass and verify three standard signatures each.
The control fills the reserve in 35.075 seconds. The candidate takes 35.094 seconds.
Those observations fall within the one-second readiness resolution and show no local reserve improvement.
The earlier failed-assertion run observed 41.134 seconds before it stopped. Its artifact remains separate.

The candidate also passes the local registration/recovery E2E through the external producer binding.
Creation takes 1.027 seconds and recovery takes 0.992 seconds, including client verification.
Both reproduce the canonical key and retain the existing manifest, holder-authentication, and replay checks.
Local timings do not qualify the hosted five-second target.

All three strict Worker builds pass. The inherited bloat check still reports 13,984 Rust and 10,238 TypeScript duplicated lines.
This change does not increase those counts. The baseline file remains unchanged.

## Complete hosted comparison

Both runs use two wallets, ten minutes of load, and full reserve restoration. Both material ledgers balance at thirty-two candidates per wallet.
All fifty-nine retained load signatures independently verify. Altered messages and signatures fail verification.

| Measurement | Baseline | Direct dispatch |
| --- | ---: | ---: |
| Verified load signatures | 28 | 31 |
| Successful requests below five seconds | 23/28 | 30/31 |
| Successful online median | 3.552 s | 1.966 s |
| Successful online range | 1.259–9.418 s | 1.162–7.790 s |
| Four-candidate producer invocation median | 11.212 s | 14.125 s |
| Captured producer time per verified signature | 23.911 s | 22.525 s |
| Full-cycle time per success, including reserve restoration | 28.402 s | 25.346 s |
| Consumed and replenished groups | 50 | 44 |
| Exhausted operations | 1 | 0 |
| Unfinished demands at cutoff | 2 | 2 |
| Complete successful demand median, including waits | 33.905 s | 36.483 s |
| Complete successful demand maximum | 188.889 s | 114.316 s |

The candidate consumes fewer groups per success. Its preparation-group median is higher.
Total captured producer time increases from 669.506 to 698.290 seconds, while time divided by verified successes falls.
This ratio cannot establish faster preparation. Rejection outcomes, runtime variation, placement, and added instrumentation prevent a causal speedup claim.

Candidate group counts are twenty-one one-group, eight two-group, one three-group, and one four-group success.
Only the four-group success exceeds five seconds, at 7.790 seconds.
The baseline's slowest success consumes one group and takes 9.418 seconds. Hosted variation can therefore exceed the target even without multiple groups.
One-group medians are 3.305 seconds and 1.749 seconds. These remain separate, uncontrolled hosted samples.

After initial stock depletion, observed refill rates are 4.030 and 3.520 groups per minute.
Successful-signature rates are 2.320 and 2.607 per minute across the two wallets.
These short saturation windows do not qualify production capacity or latency percentiles.

### Cost and trace coverage

Preparation-cost accounting covers load through full reserve restoration.
Two of fifty baseline replacement groups lack matched producer costs. All forty-four candidate replacement groups have matched costs.
Both conservative accounting flags remain false. The candidate still has forty-five producer invocations conservatively classified as unknown by the cost screen.
The separate whole-campaign coverage join finds no retained positive-work producer invocation without an identity.
It retains seventy-three baseline and sixty-six candidate canceled alarms with zero reported CPU and no job attribution.
One baseline and two candidate verified operations lack complete paired signing traces.
These limits remain visible even though the material ledgers balance.

### Exact dispatch stages

These distributions cover all retained version-matched jobs, including registration/recovery and initial filling.
They use a different window from the preparation-cost table above.

| Median service-clock interval | Baseline | Direct dispatch |
| --- | ---: | ---: |
| Controller selection to claim | 67 ms, 72 jobs | 64 ms, 65 jobs |
| Claim to producer queue log | 927 ms, 72 jobs | 905 ms, 65 jobs |
| Claim to A preparation load | 1,603.5 ms, 70 jobs | 1,692 ms, 65 jobs |
| Running log to A load | 678 ms, 72 jobs | 697 ms, 65 jobs |

Removing the forwarding request does not materially shorten the dispatch interval in this screen.
The candidate separates that interval into these observed boundaries:

- Dispatch start to first producer receipt log: 882 ms median.
- Producer receipt to completed lease authorization: 19 ms median.
- Dispatch start to acknowledged receipt at the caller: 1,076 ms median.
- A role claim to peer connection: 623 ms median.

The receipt checkpoint follows request decoding and authentication. Its preceding interval can include routing, actor activation, Wasm initialization, and that initial request handling.
The data does not isolate those causes. Producer DO invocations with retained queued events have 198 ms wall medians in both profiles: seventy-four baseline records and sixty-five candidate records.
This subset excludes baseline forwarding invocations. Its reported CPU medians are 134.5 and 143 ms. Service-clock checkpoints alone omit some execution time.

### Alarm clock check

All seventy-two baseline running-log timestamps equal their scheduled alarm time.
Sixty-three of sixty-five candidate running logs also match exactly; the other differences are one and 141 milliseconds.
Both profiles have platform event timestamps a median thirty-five milliseconds before the scheduled timestamp.
These fields do not establish actual alarm-delivery delay. The logged fifty-millisecond queue-to-running interval must not be treated as a delivery guarantee.
Zero service-clock spans around local storage also do not establish zero elapsed work.

## Hosted registration and recovery

All four ceremonies in each profile reproduce the canonical key and pass holder-authentication, manifest, and replay checks.

| Online registration, including client verification | Baseline | Direct dispatch |
| --- | ---: | ---: |
| Wallet 1 creation | 5.409 s | 6.444 s |
| Wallet 1 recovery | 5.109 s | 6.563 s |
| Wallet 2 creation | 6.188 s | 6.187 s |
| Wallet 2 recovery | 4.685 s | 4.636 s |

Each profile has one observation below five seconds. Registration remains unqualified.
Preceding preparation spans 81.704–100.977 seconds in the baseline and 64.614–110.947 seconds in the candidate.
This includes generic key-generation preparation and required initial signing stock.
Direct dispatch does not change canonical key derivation or its cryptographic preparation.

## Next work

1. Measure cold and warm entry to the same producer namespace, with existing module-instance/cache markers. Distinguish routing, actor activation, and module initialization before changing producer lifetime.
2. Inspect static-data ownership in the preparation bundle. Candidate role binaries are 49.49 and 49.52 MB raw, including 39.46 and 39.47 MB data sections. Size alone does not establish startup cost.
3. Return to measured preparation CPU costs after isolating startup. Private AES and cryptographic work remain unchanged by this dispatch simplification.
4. Repeat multi-group signing and cold registration screens with fresh material. Keep exhausted and unfinished operations in the results.
5. Close missing trace costs before publishing useful-preparation capacity claims.

The next experiment should test the pre-receipt boundary. It should not remove authorization checks or reuse single-use preparation to make a faster benchmark.
Keep Workers preparation, wallet-seed recovery, FIPS export, and pool capacity unchanged. GPU work stays deferred.

## Reproduction and retained evidence

The [comparison](../evidence/ml-dsa-65-direct-dispatch-comparison-20261018.json) and [validation receipt](../evidence/ml-dsa-65-direct-dispatch-validation-20261018.json) retain the main measurements and hashes.
The compressed [hosted evidence](../evidence/ml-dsa-65-direct-dispatch-hosted-20261018.json.gz), [local evidence](../evidence/ml-dsa-65-direct-dispatch-local-20261018.json.gz), and [provenance](../evidence/ml-dsa-65-direct-dispatch-provenance-20261018.json.gz) store exact UTF-8 files in a `files` map.
The provenance includes source snapshots, build hashes, deployment generators, independent reviews, and cleanup receipts.

Run the exact-job analysis with:

```sh
python3 tools/ml-dsa-investigation/research/summarize_refill_dispatch.py TRACES.json VERSIONS.json OUTPUT.json
```

The existing durable and registration Worker E2Es exercise the new namespace layout.
Use the frozen baseline/candidate manifests and campaign runners to repeat the hosted comparison with fresh credentials and Worker names.
Ten temporary Workers are deleted. Private credential and role-key files are excluded from the public evidence.
