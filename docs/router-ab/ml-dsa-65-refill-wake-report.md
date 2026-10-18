# ML-DSA preparation: wake the controller after settlement

Date: 2026-10-18. Production qualification remains open.

The controller now receives a wake after durable producer settlement.
A passive local comparison fills the unchanged thirty-two-candidate reserve in 38.091 seconds instead of 49.136 seconds, a 22.48% reduction.
Recovery and FIFO lifecycle checks pass. The hosted candidate verifies twenty-one load signatures, with sixteen below five seconds and a 10.251-second maximum.
This hosted screen is worse than its baseline. Registration also remains above five seconds.

The previous passive local runs filled thirty-two candidates in about 49 seconds.
An active inventory observer reduced that time to 36.171 seconds with the same binary.
Those observations support a scheduling experiment. They do not establish a hosted speedup.

## Change

The producer persists its terminal outcome before it releases the service-wide lease.
The admission transaction releases only the matching lease.
It returns at most two wake hints: the oldest eligible queued key, then the completed key if distinct and active.
An idle replay recomputes those hints. A newer active lease remains untouched and returns no hints.

Worker A validates each key against current admission and installed storage.
It enqueues the key without changing its existing queue position.
It requests an alarm fifty milliseconds ahead and acknowledges only after the alarm write.
An existing earlier alarm remains unchanged. Fifty milliseconds is a requested schedule, not a delivery guarantee.
The normal controller still checks capacity and obtains the producer lease through the existing FIFO claim path.

The producer keeps a recovery alarm during settlement and wake delivery.
It deletes that alarm after acknowledged delivery or after a retry finds a superseding lease.
If the first wake starts a new producer before the second wake fails, the retry returns no hints.
The second wallet then uses its existing controller alarm. This design does not guarantee delivery of every original fast wake.

Preparation stays on Workers. Capacity remains thirty-two candidates per wallet in four-candidate groups.
Admission still requires sixteen candidates. The service permits one active signing operation and one producer.
The production cooldown remains sixty seconds. The benchmark uses the existing one-second cooldown to apply load.
Wallet-seed recovery, ordinary FIPS seed/key export, and cryptographic preparation remain unchanged.

## Evidence and limits

The SQLite lifecycle E2E checks FIFO targets, duplicate settlement, inactive and expired waiters, and a superseding lease.
The Worker E2E injects an inspection failure, a settlement failure before commit, a lost reply after commit, and a lost wake acknowledgement.
It checks actual producer execution events and durable alarm removal after recovery.
The wake-reply fault applies to the wallet. The settlement faults bind to the interrupted job.
The existing prepublication interruption test retains its lease until the deadline and starts a fresh job afterward.

The hosted comparison uses two wallets and ten minutes of load per deployment.
The runner requires full reserves before and after load. This prevents initial stock from hiding preparation cost.
The pool size, group width, policy, cryptographic code, and workload remain fixed.
Deployments run sequentially. Placement and CPU variation remain uncontrolled.
A single comparison cannot establish production percentiles or sustained capacity for a large service.

The trace collector retains controller entry, settlement reply, and acknowledged wake events.
These events contain public identifiers and timing fields only.
Service-clock spans can omit CPU. Publication precedes the final protocol handshake and settlement.
Publication-to-next-start gaps therefore include more than idle time.

## Local result

Both complete local Worker E2Es pass and verify three standard signatures each.
The candidate fills thirty-two candidates in 38.091 seconds, compared with 49.136 seconds for the baseline.
This is a 22.48% reduction in one passive-observer comparison. Readiness observations have one-second resolution.
Median service-clock start spacing falls from 6.158 seconds to 4.652 seconds.
The interval from the first load to the eighth publication falls from 47.199 seconds to 36.918 seconds.
The first eight load-to-publication spans total 35.907 seconds in the baseline and 36.116 seconds in the candidate.
The seven publication-to-next-load gaps total 11.292 seconds and 0.802 seconds.
These clock intervals support the scheduling hypothesis. They do not measure pure idle time or hosted CPU.

The interrupted job reaches terminal state in 6.246 seconds and releases its lease in 11.250 seconds despite injected failures.
Its execution log contains one private-preparation start.
The snapshot contains nine terminal producers. Only the interrupted producer still has an alarm, which clears after settlement retries.
The original alarm is present before restart and absent after settlement recovery.
The incomplete-publication case retains its lease, waits for its deadline, and starts a distinct replacement job.
Stale settlement cannot release that replacement lease.

The SQLite lifecycle E2E and all three strict Worker builds pass.
The bloat check retains its inherited failure: 13,984 Rust duplicate lines against 13,754, and 10,238 TypeScript lines against 10,216.
Those counts do not increase in this change.

## Checked facts

| Fact | Instrument | Where | Check |
| --- | --- | --- | --- |
| Same thirty-two-candidate capacity and passive observation | E2E policy and observation fields | Both local artifacts | Policies and flags match. |
| Reserve observation falls by 11.045 seconds | Client monotonic timer | Local workerd | Independent reviewer recomputes 22.48%. |
| Preparation spans stay similar while following gaps shrink | First eight public preparation events | Local service clocks | Independent reviewer reproduces each span. |
| Interrupted private work starts once | Per-job producer execution events | Worker restart E2E | One running event and three settlement retries. |
| Recovery alarm remains until terminal settlement completes | Read-only durable SQLite metadata | Worker restart E2E | Non-null before reset, null after recovery. |
| First hosted candidate loses a client connection | Client error log and retained traces | Second wallet setup | No completed second-wallet case or load run. |

## Cause table

| Cause | Evidence | Assessment |
| --- | --- | --- |
| Controller waits after a busy check | Existing one-second check followed by a five-second retry, plus the active-observer control | Target of this change. |
| Cryptographic preparation cost | Same source and candidate group layout | Remains part of refill cost. |
| Hosted CPU and placement variation | Separate sequential deployments | Limits causal attribution from hosted elapsed time. |
| Observation changes scheduling | Inventory reads can advance controller alarms | Local comparison uses the passive observer. |
| Lost replies or interrupted producers | Real Worker fault injection and durable alarm checks | Must pass before the new scheduling path is accepted. |

## Complete hosted comparison

Both complete runs restore eight groups per wallet and observe the unchanged thirty-two-candidate cap.
All forty-six retained load signatures independently verify with OpenSSL. Changed messages and changed signatures fail verification.

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Verified load signatures | 25 | 21 |
| Successful requests below five seconds | 25/25 | 16/21 |
| Successful online range | 1.495–4.561 s | 1.435–10.251 s |
| Successful online median | 1.866 s | 3.380 s |
| Four-candidate producer invocation median | 12.933 s | 11.095 s |
| Captured producer invocation time per verified signature | 25.327 s | 28.093 s |
| Full cycle time per verified signature, including reserve restoration | 32.226 s | 36.255 s |
| Consumed and replenished candidate groups | 41 | 44 |
| Exhausted admitted operations | 1 | 1 |
| Unfinished demands at cutoff | 2 | 2 |
| Complete successful demand median, including waits | 42.420 s | 36.510 s |
| Complete successful demand maximum | 189.431 s | 225.076 s |

The candidate has a lower observed preparation-group median and consumes more groups per success.
Its complete signing and preparation targets remain unmet. Separate deployments, runtime variation, and different rejection outcomes prevent a causal service-speedup claim.

All five candidate latency misses involve three or four groups. Four signatures use four groups and take 5.926–10.251 seconds.
The other miss uses three groups and takes 6.360 seconds. No baseline success uses four groups.
One-group signing medians are 1.685 seconds in the baseline and 1.798 seconds in the candidate.
This scheduling change does not remove signing rejection sampling or reduce cryptographic work per candidate.

After initial stock depletion, the observed refill rate is 3.098 versus 3.422 groups per minute.
The corresponding successful-signature rates are 1.668 versus 1.467 per minute across both wallets.
These are short saturation windows with a one-second benchmark cooldown. They are not production capacity guarantees.

### Coverage and timing limits

Both material identity ledgers balance. Two baseline operations and one candidate operation lack complete paired signing traces.
All forty-one baseline replacement groups have matched completed-job costs. Only forty-two of forty-four candidate groups do.
The two missing candidate groups lack retained preparer-A producer-alarm records entirely.
Their preparer-B records cannot substitute for those costs. The forty-two-job median also excludes those two groups.
The captured producer-time metric is therefore incomplete and is a lower-bound observation. It must not be presented as total compute cost or complete useful preparation cost.
Across whole-campaign coverage, sixty-one baseline and sixty candidate canceled alarms have zero reported CPU and lack job attribution.
Their whole-campaign wall-time sums are 1.980 and 1.943 seconds.
The load-and-restoration cost windows contain forty-one and forty-three such alarms, totaling 1.334 and 1.357 seconds. No retained positive-work producer invocation remains unclassified in the coverage join.

The candidate retains fifty-nine settlement events, 102 requested hints, 102 wake acknowledgements, and 571 controller entries.
The median service-clock interval from settlement reply to wake acknowledgement is 116 milliseconds, with a 41–1,132 millisecond range.
Across the full captured campaigns, median spacing between observed A loads is 18.668 seconds in the baseline and 18.855 seconds in the candidate.
Those campaigns include registration, load, and reserve restoration. This broader observation does not reproduce the local cadence improvement.
The median interval from settlement reply to the next observed global A load is 2.925 seconds.
That next load need not belong to the acknowledged target, and missing traces can skip work.
These events confirm that hosted wake requests complete. They do not establish a fifty-millisecond delivery guarantee or explain the remaining interval.

## Hosted registration checks

Both wallets complete creation and recovery in the corrected candidate run. All four ceremonies reproduce the canonical keys.

| Online registration, including client verification | Baseline | Candidate |
| --- | ---: | ---: |
| Wallet 1 creation | 5.184 s | 5.683 s |
| Wallet 1 recovery | 5.387 s | 5.545 s |
| Wallet 2 creation | 7.705 s | 6.919 s |
| Wallet 2 recovery | 6.028 s | 5.215 s |

All eight observations exceed five seconds.
The preceding preparation takes 73.175–108.886 seconds in the baseline and 61.941–74.739 seconds in the candidate.
That preparation includes generic key-generation material and the required initial signing groups.
Registration preparation code is unchanged. Separate deployments and background activity prevent attributing these differences to the wakeup change.

## Hosted transport interruption

The first candidate deployment stops during the second wallet's setup after a client TLS read returns `ECONNRESET`.
Its first wallet completes creation and recovery with canonical-key checks.
Online creation takes 9.636 seconds, recovery takes 10.902 seconds, and recovered initial signing takes 9.351 seconds.
Those operations pass functional checks and miss the latency target.
The second wallet has no completed ceremony, and the signing load phase does not run.
The 748 retained Worker outcomes are normal or canceled. They do not identify the cause of the reset.
Missing trace records and server-side causes remain possible. The public evidence retains the client error log.
This is classified as a transport/infrastructure failure. No production code changes for the retry.
All five temporary Workers from that attempt are deleted.
The repeat uses fresh Worker names, the same frozen binary, and the same policy.
The failed attempt remains in the evidence and is excluded from the complete load comparison.

## Benchmark setup error on retry

The next deployment returns HTTP 500 during registration because the retry setup omits the per-wallet role-key fixtures.
The native client creates new keys, while the Workers retain the intended campaign keys.
Byte comparisons confirm the mismatch for both participants. The campaign keys match the uploaded credentials.
This is a benchmark configuration error. The private input fails to open under the Worker role key.
No production source changes for this correction.

The corrected runner requires matching client and uploaded role keys before any hosted request.
It also checks the client public-key fixture against the campaign fixture.
All five Workers from the failed retry are deleted. Its artifact, error log, and sanitized traces remain in the evidence.
The next repeat uses fresh names, the same frozen binary, and the same policy.

## Remaining work

1. Measure the controller's admission, inventory, dispatch, and next-load intervals separately. Use matched hosted controls before attributing delay to one request.
2. Reduce preparation work per successful signature toward five to ten seconds. The wakeup change leaves private AES and the cryptographic protocol unchanged.
3. Repeat multi-group signing screens with fresh material. Include exhausted operations, incomplete demands, and full reserve restoration.
4. Close missing participant and producer-cost records before publishing capacity or percentile claims.

Consistently sub-five-second registration and signing remain release gates. Larger pools and GPU preparation remain outside this experiment.

## Repeat the checks

Run the existing durable lifecycle test from the wallet repository:

```sh
cargo test --release --locked --manifest-path crates/router-ab-cloudflare/Cargo.toml --test ml_dsa_durable_pool_e2e
```

It writes `ml-dsa-durable-admission-e2e.json` under the system temporary directory.
Use `ML_DSA_E2E_REPORT` to select another output file.
Build the strict Router, Deriver A, and Deriver B bundles with `crates/router-ab-cloudflare/scripts/build-strict-worker.sh`.
Run the existing Worker E2E with generated native fixtures and passive observation:

```sh
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /tmp/ml-dsa-worker-fixtures /tmp/ml-dsa-worker-result.json --profile-preparation --passive-preparation-observer
```

The evidence bundles retain the exact source snapshots, build hashes, benchmark runners, policies, and sanitized results.
Hosted repeats require fresh benchmark credentials and temporary Worker names.
The runner checks client/Worker key agreement before sending requests.
It restores the original reserve after load, drains traces, and deletes the temporary Workers.

## Retained evidence

The [comparison](../evidence/ml-dsa-65-refill-wake-comparison-20261018.json) and [validation receipt](../evidence/ml-dsa-65-refill-wake-validation-20261018.json) contain the main results and hashes.
The compressed [hosted evidence](../evidence/ml-dsa-65-refill-wake-hosted-20261018.json.gz), [local evidence](../evidence/ml-dsa-65-refill-wake-local-20261018.json.gz), and [provenance](../evidence/ml-dsa-65-refill-wake-provenance-20261018.json.gz) retain exact UTF-8 files in a `files` map.
The provenance includes repeat scripts, frozen build hashes, source snapshots, independent reviews, and cleanup receipts.
All twenty temporary Workers across the complete and failed runs are deleted.
Private benchmark credentials and role-key files are excluded from the public evidence.
