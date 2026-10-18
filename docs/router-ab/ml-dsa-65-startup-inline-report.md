# ML-DSA preparation: producer startup and AES inlining

Campaign: 2026-10-19 JST. Full-service performance qualification remains open.

Two-at-once consumption works, but the five-second target remains unqualified.
The candidate completes forty-one hosted signatures; thirty-five finish below five seconds.
Four-candidate preparation takes 11.226 seconds at the median, compared with 11.939 seconds in the matched-policy baseline.

The cold-entry probe shows a similar first-call magnitude to the earlier approximate one-second dispatch interval.
Repeated calls to the same producer take much less time.
This associates the delay with cold entry, but does not isolate Wasm initialization or platform routing.

A one-line AES compiler hint is the implementation candidate.
The isolated hosted screen reduces median CPU from 650 to 363.5 milliseconds.
The full Worker build already inlines that function. Its small compiled change and uncontrolled runtime variation prevent attributing the full-service differences to this hint.

## Fixed policy

Prepare four candidates together. Consume independent pairs.
Keep thirty-two candidates per wallet and require sixteen ready candidates for admission.
Keep one preparation producer, one admitted signing operation, and the sixty-second production cooldown.
The saturation benchmark uses a one-second cooldown in both profiles.

The experimental default and local lifecycle harness now use this policy.
The earlier default allowed twenty four-candidate groups; the explicit hosted policy already capped stock at thirty-two candidates.
This change aligns the default with the requested capacity rather than increasing benchmark stock.
The consumed width is part of the durable schedule digest.
Existing four-at-once scopes require fresh pair-bound material through registration or recovery.

A successful signature needs approximately 5.1 candidates when each candidate is consumed individually.
For pair consumption, the geometric approximation gives `2 / (1 - (1 - 1/5.1)^2)`, or approximately 5.65 consumed candidates.
The value includes the unused candidate in a successful pair. Failed operations, interruption, and expired material can increase actual consumption.

Wallet-seed recovery, standard FIPS seed/key export, role separation, and the passive server-blind model remain unchanged.
Preparation stays on Workers. GPU work remains deferred.

## Fault and controls

The preceding direct-dispatch campaign measured an 882-millisecond median service-clock interval before the first producer receipt checkpoint.
That interval begins before namespace lookup and request serialization. It ends after authentication and job decoding.
It is neither a network latency measurement nor a Wasm initialization measurement.

The startup probe imports the exact prior Deriver A bundle and constructs its actual producer class.
It sends three sequential requests to each of twenty-four fresh durable object identities.
The outer probe route is authenticated. The inner request deliberately fails producer authentication with HTTP 403.
It creates no prepared material, grants no lease, and writes no signing state.

A second deployment uses the same probe shape and a small JavaScript receiver that returns HTTP 403.
The comparison changes both the packaged code and receiver implementation.
It does not control platform placement or prove parity with an authenticated production job.
Both probes use a local namespace binding. Production dispatch uses a binding to a separate preparation Worker.

The first Python request returned HTTP 403 before any probe result was recorded.
The successful campaign followed credential setup and used an explicit benchmark User-Agent.
The record does not isolate which difference resolved the first request.

## Startup results

| Caller round trip | Full producer bundle | Lightweight receiver |
| --- | ---: | ---: |
| First call to each object, median | 875.5 ms | 388.5 ms |
| First-call range | 272–1,371 ms | 292–596 ms |
| Repeated call, median | 9.5 ms | 7 ms |
| Repeated-call range | 4–14 ms | 3–15 ms |
| Distinct observed module identities | 23 | 24 |
| Complete response receipts | 72 | 72 |
| Retained receiver trace records | 66 | 55 |

One new object in the full probe reused an observed module. Its first call took 272 milliseconds.
This separates object identity from module identity, but provides only one reused-module sample.
The reported deployment startup measurements were 23 milliseconds for the full probe and two milliseconds for the lightweight probe.
Those upload-time measurements do not partition the caller's first-request latency.

Forty-two full-probe receiver entry timestamps precede the corresponding caller send timestamps.
All retained receiver entry-to-completion service-clock spans are zero.
These observations invalidate cross-actor subtraction as a physical timeline and zero spans as CPU measurements.
Use the caller's send-to-acknowledgement interval for the probe comparison.
Retained platform CPU and wall records remain incomplete.

## Production instrumentation

The producer logs entry before authentication and at completed authentication.
Each record includes its public object ID, module identity, construction ordinal, invocation count, schedule-cache state, and nullable service clocks.
No seed, signing share, nonce, or prepared correlation enters these records.

The construction ordinal starts at zero for each Wasm module.
The invocation count includes fetch and alarm entries for the current live object.
The random module identity is allocated lazily at the first instrumented signing or producer entry.
It identifies observed reuse; it does not measure compilation or initialization duration.
The trace collector retains the public fields and joins entry records to the exact queued job.
Cross-actor stage differences remain diagnostic observations; the caller round trip is the stronger latency measurement.

Authentication, current-lease checks, durable transitions, FIFO admission, recovery alarms, and settlement remain unchanged.
The experiment does not reuse producer state across different job identities.

## Fact list

| Fact | Instrument | Where | Checked |
| --- | --- | --- | --- |
| Earlier receipt interval is about one second | Exact job joins | Prior hosted direct-dispatch campaign | Retained source and evidence |
| Full probe first calls are much slower than repeated calls | Caller round trips | Twenty-four fresh hosted objects | All seventy-two receipts |
| Small receiver also has a first-call penalty | Same probe shape | Separate lightweight deployment | All seventy-two receipts |
| One fresh object reuses a module | Module identity and construction ordinal | Full probe | Unique response join |
| Receiver clocks can precede the sender clock | Retained timestamps | Full probe | Forty-two negative spans |
| AES is the largest prior CPU category | Calibrated workerd sampling | Prior preparation profile | Approximate half of samples |
| Inline hint improves the hosted kernel screen | Platform CPU, matched input seeds | Temporary AES Worker | Twelve complete pairs |

## Cause table

| Cause | Supporting or contradicting fact | Status |
| --- | --- | --- |
| Cold object/module entry | Fresh calls are much slower than repeated calls | Supported association |
| Wasm CPU alone explains the full delay | Full upload startup is 23 ms; lightweight first calls still take hundreds of ms | Not established |
| Packaged bundle or initialization contributes | Full and lightweight first-call distributions differ | Supported hypothesis; placement is uncontrolled |
| Persistent network latency alone | Repeated calls take 3–15 ms | Insufficient as the sole explanation |
| Schedule parsing or private computation is necessary for the delay | Rejection probe stops before both and still shows slow first calls | Contradicted for the probe |
| Successful authentication and initial request handling add delay | Rejection probe executes a different authentication path | Unresolved in production |
| Our measurement invents an exact receiver timeline | Receiver clock precedes caller in forty-two observations | Cross-clock interpretation rejected |

An authenticated production receipt can add schedule validation, lease checks, and queue persistence.
The similar first-call magnitude supports partial parity. Complete production parity remains unestablished.
Exact platform routing, code loading, and compilation before the first observable instruction remain unresolved.

## AES experiment

The existing source uses a fixed Boolean AES circuit and fixed public permutations.
The selected change adds `#[inline(always)]` to `encrypt_state`.
It lets the compiler place the round function inside its caller.
The equations, round sequence, key schedule, indices, and named erasure calls are unchanged.

Two larger round-loop changes were also screened. Their source patches remain in the evidence, and their code is excluded from the final implementation.

| Variant | Local SIMD median, baseline → candidate | Hosted CPU median, baseline → candidate |
| --- | ---: | ---: |
| Unroll all rounds | 5.987 → 6.135 ms | 630 → 547 ms |
| Two fixed round groups | 5.911 → 6.003 ms | 639.5 → 544.5 ms |
| Inline existing round function | 5.989 → 6.031 ms | 650 → 363.5 ms |

The hosted screen alternates baseline and candidate requests for twelve input seeds in each variant.
Each request performs 1,048,576 repeated encryption iterations and returns a checksum.
All checksums agree across variants and baseline/candidate modes for each seed.
All seventy-two CPU records join complete response receipts by variant, mode, seed, and version.
The inline variant's median paired CPU ratio is 0.5453. Its largest ratio is 1.4677, so individual observations still vary.
Hardware placement and runtime variation remain uncontrolled.

The local correctness screen compares full ciphertext bytes with RustCrypto for 256 keys across scalar and SIMD paths.
It also checks adapter lengths zero through thirty-three and verifies that unselected suffix blocks remain unchanged.
The final packaged Wasm inspection finds fixed public round counters, pointer offsets, and shuffle selectors in both AES bodies.
It finds no division, indirect calls, or secret-indexed table accesses in those bodies.
Named state, temporary buffer, and key-schedule wipes remain. Existing constructor-copy erasure limits remain.
The review does not establish complete stack/register erasure or constant-time behavior of the native JIT.

The packaged baseline already places the AES round body inside its callers.
The candidate scalar body changes operand order for a commutative XOR.
The SIMD body saves two local instructions and four bytes, with additional local scheduling changes.
The isolated harness does not apply the full Worker build optimization pipeline. Its large CPU reduction cannot be assumed for the packaged service.
This screen establishes no full-service speed or complete stack-erasure claim.

## Lifecycle fixture corrections

The old native fixture exporter replaced its two-candidate schedule digest with a four-candidate digest.
The new two-at-once harness correctly rejected that stale shape.
Classification: `obsolete_test_or_fixture`. The exporter now writes its existing two-candidate record directly, and the fixture is regenerated.

The first pair-policy recovery run stopped after only the first pair reached both role stores.
The existing recovery rule correctly retained its lease because the second pair was incomplete.
Classification: `valid_test_needs_update`.
The after-publication fault now waits for the final pair. The test checks every expected pair before restarting Workers.
The before-publication fault still checks that incomplete publication retains its lease until the deadline.

## Full-service validation

Both local lifecycle E2Es pass and verify three standard signatures each.
The baseline full-reserve observation is 43.124 seconds; the candidate observation is 40.104 seconds.
These single profiled runs do not establish a causal latency improvement.
Private AES remains approximately 50%/41% of A/B CPU samples in both profiles.
Candidate local registration and recovery take 1.364 and 1.307 seconds, including client verification. Both reproduce the canonical key.
The final packaged Wasm review and both sustained hosted runs are complete.
Both profiles use identical starting reserves and require full restoration after the load window.
The baseline wallet-2 creation check exhausted all eight pairs (sixteen candidates) in its first signing operation.
That request took 8.689 seconds. Its recovery ceremony later produced a verified initial-stock signature.
The registration checks themselves passed, but the wallet-2 combined functional flag remains false.
This failure stays in the evidence; it is not replaced with a successful retry.

One baseline verified operation lacks its Router outcome log.
Both complete role traces identify the same consumed pair, and an independent verifier checks the client signature.
The accounting helper uses those explicit bindings to close this one material-ledger gap.
It records the recovered operation and never infers unobserved burns from a stock deficit.
The complete ledger contains thirty-two initial pairs, eighty-six fresh pairs, eighty-six consumed pairs, and thirty-two final pairs.
The conservative cost flag remains false. The original depletion-rate calculation remains unavailable because its Router timeline is incomplete.

Report unsuccessful operations, incomplete demands, missing traces, and unassigned producer costs.
Do not infer preparation savings solely from a run that consumes fewer rejected candidates.


## Sustained hosted results

Both deployments run two wallets for ten minutes and restore all thirty-two candidates per wallet afterward.
The baseline and candidate use the same preparation, consumption, admission, and capacity policy.
All seventy-one load signatures independently verify with Node/OpenSSL. Altered messages and signatures fail verification.
Both material ledgers balance. Candidate consumption is 202 candidates across forty-one successes, or 4.927 per success in this sample.
That finite sample does not replace the approximately 5.65-candidate expectation for pair consumption.

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Verified load signatures | 30 | 41 |
| Successful requests below five seconds | 23/30 | 35/41 |
| Online median | 3.278 s | 2.674 s |
| Online range | 1.265–10.461 s | 1.063–9.151 s |
| Four-candidate producer invocation median | 11.939 s | 11.226 s |
| Four-candidate producer invocation mean | 14.850 s | 12.506 s |
| Four-candidate producer invocation range | 9.432–24.533 s | 8.297–24.705 s |
| Four-candidate completed jobs in cost window | 43 | 50 |
| Two-candidate completed jobs in cost window | 0 | 1 |
| Captured producer time per verified success | 21.334 s | 15.611 s |
| Full-cycle time per success, including reserve restoration | 24.819 s | 18.219 s |
| Consumed candidates, including failed operations | 172 | 202 |
| Failed admitted operations | 2 | 0 |
| Incomplete demands at the cutoff | 2 | 2 |
| Complete successful demand median, including waits | 24.117 s | 25.627 s |
| Complete successful demand maximum | 143.191 s | 107.988 s |
| Final reserve restoration | 144.579 s | 146.996 s |

The candidate's single two-candidate producer job takes 13.091 seconds.
Prepared width alone does not predict a particular hosted invocation's duration.
Total captured producer time is almost identical: 640.030 seconds in the baseline and 640.058 seconds in the candidate.
The candidate completes more signatures with that captured time and consumes fewer candidates per verified success.
It also has a lower observed four-candidate mean. Rejection outcomes, hardware variation, placement, and diagnostic changes remain uncontrolled.
These observations do not establish a causal full-service speedup from the compiler hint.

After its starting stock is consumed, the candidate observes 3.349 successes per minute across both wallets over approximately 8.06 minutes.
The baseline's corresponding depletion-based rate remains unavailable because the original Router timeline is incomplete.
The restored-reserve cycle gives approximately 2.42 and 3.29 successes per minute for the baseline and candidate.
These short samples do not establish production capacity or percentile guarantees.

### Coverage and cost limits

All eighty-six baseline and 101 candidate replacement pairs have matched producer costs.
The conservative cost flags remain false, with forty-three and fifty-two producer invocations classified as unknown by the cost screen.
The independent identity join finds no retained positive-work producer alarm without a job identity.
It retains sixty-five and seventy-six unattributed canceled alarms with zero reported CPU.
Four baseline successes lack complete paired signing traces. Every candidate success has complete paired traces.
The baseline Router-log gap described above is separate and is recovered from complete paired traces.
None of these limits is erased by a balanced material ledger.

### Actual producer entry

The candidate records seventy-four queue entries across seventy-four object IDs and seventy-three module identities.
Only one queue entry has a loaded schedule cache.
All seventy-four recorded alarm entries match an earlier queue entry in the same live object and module, with loaded schedules.
This supports repeated cold module entry across jobs and warm reuse between each job's queue and alarm.
It does not isolate platform code loading, compilation, or Wasm initialization time.

The candidate's median caller dispatch-to-acknowledgement observation is 977 milliseconds from fifty-one complete joins.
The baseline median is 1,181 milliseconds from sixty-one joins.
The candidate's cross-actor dispatch-to-first-entry observation is 843 milliseconds, equal to its post-decode observation.
Authentication and decoding do not advance those service-clock readings. That does not mean they consume zero CPU.
The queue invocation itself reports 126 milliseconds median CPU and 162 milliseconds median wall time across seventy-four records.
Do not add these measurements into an exact timeline; their clocks and boundaries differ.

### Signing tail

The candidate's 9.151-second maximum consumes one pair.
Both role traces show warm schedule caches and previous signing calls in the same module.
A and B report 1.516 and 1.494 seconds of invocation wall time. The matched Router invocation reports 3.061 seconds.
The client timing covers HTTP response headers and body decoding, before local signature verification.
The difference remains outside the retained role invocation measurements; it is not an identified CPU or network stage.

The eight-pair success takes 7.903 seconds. Both roles report approximately 7.55 seconds of invocation wall time.
Thus multi-pair protocol work and delays outside role execution are distinct causes of slow requests.
Reducing rejected candidates alone cannot address the single-pair outlier.

## Hosted registration and recovery

| Online ceremony, including client verification | Baseline | Candidate |
| --- | ---: | ---: |
| Wallet 1 creation | 6.693 s | 5.766 s |
| Wallet 1 recovery | 7.120 s | 6.104 s |
| Wallet 2 creation | 6.607 s | 5.964 s |
| Wallet 2 recovery | 5.422 s | 5.246 s |

All ceremonies reproduce the canonical key. None meets the five-second target in this campaign.
Separate preceding preparation takes 69.949–106.876 seconds in the baseline and 67.906–85.593 seconds in the candidate.
This includes generic key-generation preparation and required initial signing stock.
The baseline initial-signing exhaustion remains recorded separately from successful registration.

## Next work

1. Design bounded producer reuse that retains per-job identity, terminal settlement, and stale-alarm protection. Measure whether public schedule and topology caches survive across jobs.
2. Split client HTTP, Router admission, role dispatch, and settlement timing for the warm single-pair outlier. Establish where its unmeasured delay occurs before changing the signing protocol.
3. Profile the exact final Worker kernel. Test further private AES changes through the full build pipeline, and compare public matrix encoding and per-correlation preparation overhead.
4. Repeat the same-capacity sustained screen with more samples. Preserve failed operations, incomplete demands, and missing costs.

Cloudflare platform instrumentation would be needed to partition routing, code loading, and compilation before the first observable instruction.
The current data supports cold-entry association and observed reuse, with partial probe parity.
The earlier interpretation of the 882-millisecond span as an isolated internal delay is withdrawn.
It remains a service-clock observation across different actors.

Thirteen temporary Workers are deleted. Private benchmark credentials remain excluded from retained evidence.
The inherited bloat check still reports 13,984 Rust and 10,238 TypeScript duplicated lines. This change leaves those counts unchanged.

## Evidence and reproduction

The [comparison](../evidence/ml-dsa-65-startup-inline-comparison-20261019.json), [probe screen](../evidence/ml-dsa-65-startup-inline-probes-20261019.json), and [validation receipt](../evidence/ml-dsa-65-startup-inline-validation-20261019.json) retain the main measurements and hashes.
The compressed [hosted evidence](../evidence/ml-dsa-65-startup-inline-hosted-20261019.json.gz), [local evidence](../evidence/ml-dsa-65-startup-inline-local-20261019.json.gz), and [provenance](../evidence/ml-dsa-65-startup-inline-provenance-20261019.json.gz) store exact UTF-8 files in a `files` map.
The provenance retains source snapshots, runners, deployment configurations, compiled instruction review, and cleanup receipts.

Use the existing durable Worker E2E with `--profile-preparation --passive-preparation-observer` for the local lifecycle and CPU screen.
Regenerate its fixtures with the investigation tool's `prepared-keygen` command and `ML_DSA_WORKER_FIXTURE_DIRECTORY`.
The hosted runners use fresh credentials and Worker names, prepare four, consume two, and start and end with full reserves.
Run the exact-job analysis with `summarize_refill_dispatch.py TRACES.json VERSIONS.json OUTPUT.json`.
