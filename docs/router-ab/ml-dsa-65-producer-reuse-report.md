# ML-DSA preparation: safe producer reuse and HTTP timing

Campaign: 2026-10-19 JST. Safe producer reuse passes the lifecycle checks and improves the observed hosted preparation time.
The five-second signing target remains unmet: 55 of 58 candidate signatures finish below five seconds.
Candidate signing takes 1.813 seconds median and 6.519 seconds maximum.
Four-candidate preparation takes 8.247 seconds median, compared with 10.033 seconds in the control.
These are sequential ten-minute screens with uncontrolled placement, CPU variation, and rejection outcomes.

The producer now reuses one Durable Object for the service's single preparation slot.
Every preparation job retains a separate durable state record and independent single-use material.
New client and Router timing records identify each HTTP attempt separately from its signing operation.

## Fixed requirements

Prepare four candidates together and consume independent pairs.
Keep thirty-two candidates per wallet, sixteen ready candidates for admission, one producer, and one active signing operation.
The production wallet cooldown remains sixty seconds. Both saturation profiles use a one-second benchmark cooldown.
Wallet-seed recovery and ordinary FIPS seed/key export remain required.
Preparation stays on Workers. GPU work and larger pools remain deferred.

## Evidence that motivated the change

The previous campaign recorded seventy-four producer objects across seventy-three module identities.
Only one queue entry reused loaded schedules. Every alarm reused the module loaded by its own queue request.
Cold-entry probes measured 875.5 milliseconds on first calls and 9.5 milliseconds on repeated calls.
The probe used different boundaries from the original cross-actor service-clock interval.
It supported cold-entry association without isolating code loading, compilation, or Wasm initialization.

The previous slowest successful HTTP request took 9.151 seconds and consumed one pair.
Both signing roles had warm caches and reported approximately 1.5 seconds of invocation time.
The matched Router operation reported 3.061 seconds, but the old evidence could not identify each HTTP attempt independently.
A repeated operation ID alone is insufficient to join a particular client request to a Router invocation.

## Producer lifecycle

The existing global admission lease remains the sole authority for preparation.
The producer uses the stable object name `ml-dsa-producer-v1` in the existing separate preparation Worker.
Its pending queue contains at most two job IDs: the current job and a possible successor waiting for settlement.

Each job has a record under `producer-job/<batch-id>`.
The state remains queued, running, published, failed, or interrupted.
A repeated batch must match the complete stored job. It cannot restart private work or replace another job's state.
Terminal records remain durable replay barriers. Queue bounds do not imply bounded total historical metadata storage.

The receiver checks the exact live Router lease before enqueueing.
It checks expiry again inside the local transaction after any wait for storage access.
Before capacity checks, it removes only expired queued entries and marks them interrupted.
Running and unsettled terminal entries retain their place.
The existing fresh lease check before role preparation remains intact.

A local asynchronous mutex protects queue changes and actual alarm updates.
The mutex is never held across remote calls or cryptographic work.
The producer arms a recovery alarm before persisting queue or running state.
After settlement, it removes only the matching queue head and schedules the current successor or clears the idle alarm while holding the mutex.
An old settlement cannot clear a newer queued job's alarm.

Cloudflare serializes alarm handlers for one object. A newly armed alarm cannot interrupt a live handler.
The [alarm contract](https://developers.cloudflare.com/durable-objects/api/alarms/) is therefore part of the liveness argument.
Private preparation retains its existing lease deadline.
Recovery inspection and each remote settlement attempt now have a fresh five-second deadline, including response-body decoding.
A timeout preserves durable job state and recovery intent. Remote requests can still complete after the local wait ends; exact-job checks protect newer leases.

The producer preserves the Router's FIFO admission order and the existing paired-publication recovery rule.
Reusing the process caches public schedules and circuit topology. It does not reuse nonces, correlations, or signing material.
The role stores, wrapping keys, and participant trust boundaries remain separate.

Rollout uses a new producer identity. Drain outstanding jobs before changing an existing deployment.
This campaign uses fresh temporary namespaces and introduces no compatibility path for old in-flight producer objects.

## Client and Router measurements

Each HTTP attempt sends a fresh `x-ml-dsa-request-id`.
The Router validates its public hexadecimal form and echoes it in the response.
It remains diagnostic metadata and grants no authority.
The signing operation ID remains unchanged across retries.

Router records cover entry, decoded input, admission completion, role execution, completion recording, role release, durable settlement, and response readiness.
Each record includes its attempt ID, optional operation ID, module identity, status, and nullable service-clock readings.
These clocks can omit CPU. The milestone differences are not a complete physical timeline.

The Node observer uses [Undici request channels](https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md) and [Node socket creation events](https://nodejs.org/api/diagnostics_channel.html#event-netclientsocket).
It records request creation, the start of request writing, response headers, completed response receipt, body reading, and JSON parsing.
Socket identity links DNS, TCP, TLS, and reuse observations without retaining addresses, credentials, or bodies.
Socket timing fields are cumulative offsets from socket creation. They are not additive durations and do not recur on every request using that socket.

The local calibration delays headers by eighty milliseconds and the remaining body by another eighty milliseconds.
It requires both non-zero intervals, ordered application timestamps, observed connection timing, and socket reuse.
A separate HTTPS sanity check observes non-zero DNS/TCP/TLS offsets and reuse through three unauthorized requests to the temporary baseline.
The HTTPS check does not inject a known TLS delay.
An initial attempt to join connection callbacks by a shared parameter object failed calibration and was removed before load testing.

The analyzer joins a client attempt only when exactly one version-matched Router record has the same attempt ID and operation ID.
Missing or repeated records remain unjoined.
Client time minus Router invocation wall time remains an unassigned signed difference, not a network measurement.

## Correct producer attribution

A reusable actor can process many jobs.
The coverage tool now requires an explicit job in each alarm invocation before attributing that invocation to material.
Actor-only records remain unassigned, even if only one job appears elsewhere in the captured trace.
Missing events must not cause work to be assigned to the actor's most recently observed job.
The same stricter rule applies to the baseline and candidate.

## Fact list

| Fact | Instrument | Where | Check |
| --- | --- | --- | --- |
| Prior job dispatch repeatedly loads new modules | Exact producer entry records | Prior hosted campaign | Seventy-four objects, seventy-three module identities |
| Repeated entry is much faster in the probe | Caller round trips | Prior temporary probe | Complete response receipts |
| A slow successful request consumes only one pair | Client result and role traces | Prior hosted campaign | Verified standard signature |
| One operation can have multiple HTTP attempts | Existing retry and duplicate behavior | Client and Router source | Fresh attempt ID added |
| The old SQLite observer can collide with restart recovery | Read-only query error | First candidate local run | SQLite extended error 261 |

## Cause table

| Cause | Evidence and prediction | Status |
| --- | --- | --- |
| Per-job module startup contributes to preparation latency | One reusable object/module replaces seventy-four objects and seventy-three modules. Dispatch acknowledgment median falls from 930 to 43 ms. | Supported association. Compilation and Wasm initialization remain unsplit. |
| Public schedule loading contributes to queue cost | Queue schedule hits rise from 1/74 to 89/90. Median queue CPU falls from 128 to 1 ms. | Supported for queue startup. No isolated estimate for each cache. |
| Rejection sampling explains every slow HTTP success | Prior single-pair maximum contradicts this | Rejected as a complete explanation |
| Fresh connection setup causes the longest pre-send gaps | Both large candidate gaps use existing sockets. Their original setup finished earlier. | Fresh handshake rejected for these requests. Transport queue remains unresolved. |
| A long client event-loop stall causes the large pre-send gaps | No recorded gap above 100 ms overlaps either request. Each has one create/send/header/complete event. | No evidence of a multi-second loop stall. Observer limits remain. |
| Router admission or settlement dominates the three slow successes | Admission spans are 120–149 ms. Execution spans are 4,849–6,186 ms. | Rejected as the dominant cause in these three requests. |
| Role execution and repeated candidate groups cause the remaining slow successes | Exact attempts match four, four, and five checked pairs. All roles have warm schedules. | Localized to role execution. CPU, storage, and peer waits need further separation. |
| Missing traces or incorrect joins create apparent gaps | Ambiguous attempts and actor-only alarms stay unassigned | Explicit measurement limit |

## Local validation

The baseline complete durable lifecycle E2E passes with three independently verified signatures.
It observes the full reserve in 38.099 seconds.

The first candidate run reaches interrupted-producer recovery, then its read-only SQLite observer receives `SQLITE_BUSY_RECOVERY`.
Classification: `environment_or_infrastructure_failure` in the observer.
The observer now uses a one-second busy timeout and a read transaction for a consistent job/queue/alarm snapshot.
No production behavior changed for this observer failure.

The candidate adds two handoff scenarios after the normal lifecycle checks.
Both hold a successful settlement reply for sixty seconds and require a second job to queue behind the terminal first job.
The live scenario requires the first job to leave the queue within fifteen seconds without restarting.
The restart scenario checks durable recovery while both jobs are pending.
Both reject stale retries, preserve the successor lease, require one execution per job, and require the final idle alarm to clear.

The corrected candidate lifecycle E2E passes and observes the full reserve in 37.081 seconds.
The single local baseline and candidate observations differ by about one second, which does not establish a hosted speedup.
In the live handoff case, the old job leaves the queue 3.932 seconds after the successor is observed.
The held reply would otherwise take sixty seconds. The successor runs once without restart.
The restart case clears the old queue entry in 1.401 seconds and also runs the successor exactly once.
Both cases preserve the newer lease against stale finish requests and clear the final idle alarm.

Local candidate registration and recovery take 1.349 and 1.323 seconds, including client verification.
Both reproduce the canonical FIPS key. Separate preceding preparation takes 21.389 and 21.967 seconds.

The candidate client adds repeated transport-event counters and an event-loop observer after the baseline exposes a long pre-send delay.
The observer detects an injected 150-millisecond local event-loop stall before load starts.
Its fifty-millisecond timer records only gaps above one hundred milliseconds during the load window.
Concurrent calibration requests echo separate IDs and retain one create/send event each.
These extra observations are absent from the baseline; that difference remains a comparison limitation.

One formatting-only change reorders adjacent Rust module declarations after the frozen build.
The compiled source copy and the formatted source are retained separately in the provenance.
## Hosted results

Both profiles use fresh temporary deployments and the same capacity.
Each runs for ten minutes, then restores the complete starting reserve.
The candidate adds producer reuse and Router timing. It also adds client event-loop and repeated-event observations described above.
This is a paired engineering screen. It does not establish production percentiles or isolate every source of speed change.

| Measurement | Per-job producer control | Reusable producer |
| --- | ---: | ---: |
| Verified signatures during load | 33 | 58 |
| Successful HTTP requests below five seconds | 31/33 | 55/58 |
| Successful HTTP minimum / median / maximum | 0.842 / 2.448 / 8.245 s | 0.851 / 1.813 / 6.519 s |
| Completed four-candidate producer invocations | 56 | 67 |
| Four-candidate invocation median / maximum | 10.033 / 23.228 s | 8.247 / 12.082 s |
| Captured producer invocation time per verified signature | 20.277 s | 10.444 s |
| Restored-stock cycle time per verified signature | 23.017 s | 12.315 s |
| Signatures per minute after both wallets consume starting stock | 2.943 | 4.971 |
| Complete demand median / maximum, including admission waits | 31.209 / 110.170 s | 18.536 / 99.816 s |
| Exhausted admitted operations | 2 | 1 |

The candidate also completes three two-candidate top-ups, each within the existing target capacity.
The configured production group remains four, and consumption remains two at once.
Both material ledgers balance after full reserve restoration. No observed role exceeds thirty-two candidates per wallet.
Complete paired signing traces are missing for two control successes and five candidate successes.
Independent signature checks and inventory accounting remain complete despite that trace limit.
The control consumes 224 candidates across all admitted operations. The candidate consumes 274.
The resulting 6.79 and 4.72 candidates per verified signature include exhausted operations and differ through random rejection outcomes.
They are observed sample ratios, not changes to the protocol's expected acceptance probability.

Captured producer time is not complete resource accounting.
The coverage analyzer finds no unattributed nonzero work in retained invocations, but canceled alarms remain unassigned.
During the load/restoration window, the conservative cost analyzer reports 56 and 67 unknown producer invocations respectively.
Its `accounting_complete` flag remains false. Missing telemetry cannot be treated as zero cost.
The stock-balanced cycle and complete demand measurements retain waits omitted by invocation-only accounting.
Both profiles end with two unfinished demands, which remain explicitly censored.
The throughput improvement combines producer reuse, runtime variation, and different rejection outcomes.

Prepared registration and recovery remain separately measured:

| Wallet | Control create / recovery | Candidate create / recovery |
| --- | ---: | ---: |
| 1 | 4.332 / 3.557 s | 4.461 / 5.702 s |
| 2 | 4.739 / 5.024 s | 3.850 / 4.517 s |

Every creation and recovery reproduces the canonical FIPS key.
The timer includes client verification and excludes preceding preparation.
Candidate initial registration preparation takes 49.129–68.012 seconds, including its signing reserve.
The registration target also remains unmet because one candidate recovery exceeds five seconds.
Producer reuse changes key-bound refill. It does not remove the separate generic registration preparation cost.

## Producer startup and cache evidence

Whole-campaign entry records show the following:

| Measurement | Control | Candidate |
| --- | ---: | ---: |
| Queue entries | 74 | 90 |
| Distinct producer identities | 74 | 1 |
| Distinct queue module identities | 73 | 1 |
| Queue entries with loaded schedules | 1 | 89 |
| Median queue invocation CPU | 128 ms | 1 ms |
| Median queue invocation wall time | 173 ms | 27 ms |
| Caller dispatch acknowledgment median | 930 ms, 43 joins | 43 ms, 32 joins |

The candidate records seven live-object construction ordinals within that one producer identity and module.
Reuse does not require one uninterrupted object instance. Durable job state survives reconstruction.

The caller dispatch interval uses both timestamps in one controller invocation.
It includes the complete dispatch acknowledgment, which makes it stronger evidence than a cross-actor checkpoint difference.
The cross-actor dispatch-to-first-entry median falls from 820 ms to 14 ms, but the candidate has only seven complete joins.
Missing records remain missing. Service-clock intervals cannot isolate CPU or actual alarm delivery.
The observations support reuse as a way to remove repeated startup work.
They do not establish separate durations for compilation, Wasm initialization, and schedule loading.

## Client and Router delay evidence

All fifty-eight candidate successful attempts have unique exact Router joins.
Across all 584 attempts, 498 join and 86 lack a matching retained Router trace.
The baseline has no Router attempt trace because its frozen binary predates this instrumentation.

| Successful attempt | Client | Router invocation | Admission-to-execution completion | Checked pairs |
| --- | ---: | ---: | ---: | ---: |
| `1a3d06d3e54b5c84640009933bffdda1` | 5.493 s | 5.474 s | 5.147 s | 4 |
| `6155cd38f460ff3db9c5698868fe4d6f` | 6.519 s | 6.486 s | 6.186 s | 4 |
| `5722d44a36ac8c63075f3f19059d8f2d` | 5.182 s | 5.161 s | 4.849 s | 5 |

Each request starts writing within one millisecond, reuses a socket, and has one event per observed transport stage.
No recorded event-loop gap overlaps these requests.
Admission takes 120–149 ms on service clocks. Completion recording, role release, and final settlement together take 157–199 ms.
The large delay belongs to role execution. All matched role schedule caches are warm.

The 6.519-second request has a 1,500-millisecond A-side `taking` to `taken` interval for its second pair.
B records 1,805 milliseconds from restoration to activation for that pair.
These are overlapping observations across peers. They must not be added or labeled as proven storage/network delay.
A and B report 1.096 and 1.212 seconds of CPU, with about 6.17 seconds of invocation wall time each.
Repeated pair checks also account for substantial observed protocol time in all three slow requests.

Two other successful requests isolate a separate client-side delay:

| Attempt | Client total | Before request writing | Router invocation |
| --- | ---: | ---: | ---: |
| `2a9350df51256c6f1d32f0310898be73` | 3.943 s | 2.970 s | 0.929 s |
| `f5e5360f06ad77905e4b039ee9bf1f12` | 3.865 s | 2.791 s | 1.056 s |

Both use existing sockets, with six and eighty-one earlier requests respectively.
Each has one create/send/header/complete event and no overlapping recorded loop gap above one hundred milliseconds.
These are the largest pre-send waits among successful requests.
Across all attempts, a non-successful response has a 4.979-second pre-send wait on a reused socket, also without an overlapping recorded loop gap.
The observer localizes these waits before request writing. It does not identify the Undici scheduling or transport condition that caused them.
The largest body-read time across successful candidate requests is 5.782 milliseconds. The largest JSON parse time is 0.235 milliseconds.
Those stages do not explain the multi-second tails.

## Qualification and next measurements

The deployed experimental Worker protocol matches the measured private harness.
The public wallet SDK, browser transport, Gateway admission, and NEAR transaction path are not qualified by this campaign.
The one-second load cooldown intentionally saturates the single producer. Production remains sixty seconds per wallet.
These results support keeping producer reuse, with the rollout drain requirement above.
They do not establish signing below five seconds under saturation or at production percentiles.

Next work:

1. Measure the A-side pair-consumption wait and B-side activation wait with exact durable-call boundaries.
2. Compare the two client pre-send tails against explicit dispatcher queue and socket availability observations.
3. Repeat the fixed-capacity load screen to separate rejection variance from sustained refill performance.
4. Keep registration preparation and its occasional online recovery tail as separate optimization tasks.

No earlier production latency guarantee is retained. The previous 882-millisecond interval remains a checkpoint observation, not a measured Wasm initialization duration.

## Validation and evidence

Both local lifecycle runs pass. The candidate includes live-timeout and restart handoff scenarios.
Local and hosted canonical recovery checks pass.
Independent verification accepts all 91 load signatures and rejects altered messages and altered signatures.
Rust formatting, JavaScript syntax, Python compilation, and whitespace checks pass.
The bloat check still fails at inherited duplicate-line counts: Rust 13,984 against 13,754 and TypeScript 10,238 against 10,216.
This change does not increase those counts.
All ten temporary Workers were deleted after evidence collection.

- [Comparison summary](../evidence/ml-dsa-65-producer-reuse-comparison-20261019.json)
- [Hosted evidence](../evidence/ml-dsa-65-producer-reuse-hosted-20261019.json.gz)
- [Local evidence](../evidence/ml-dsa-65-producer-reuse-local-20261019.json.gz)
- [Source, runners, review, and deployment provenance](../evidence/ml-dsa-65-producer-reuse-provenance-20261019.json.gz)
- [Validation and cleanup receipts](../evidence/ml-dsa-65-producer-reuse-validation-20261019.json)
