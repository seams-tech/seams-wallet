# ML-DSA admission and installation isolation

Two hosted lifecycle runs pass canonical creation, recovery, and four verified signatures.
The earlier admission-storage and installation failures do not recur.
Their underlying cause remains unresolved. This change establishes better failure observations, rather than a demonstrated storage fix.
The consistent five-second target remains unqualified.

## Implementation

Admission and pool requests now preserve public call IDs through their dispatch and forwarding paths.
Opt-in observations identify the command, public job and operation IDs, authorization, transaction callback, and storage API boundaries.
Pool initialization, material checks, material installation, and initial signing-stock installation are included.
Chunk writes and bulk reads/deletions use the same observations.

Each asynchronous observation reserves one ID before its first poll.
Its beginning and completion share that ID, including concurrent chunk writes that finish out of order.
Event ordinals remain separate from observation IDs.
Expected absent storage records are normalized before observation, so ordinary absence is not reported as a storage failure.
Malformed diagnostic headers remain best-effort metadata.

The existing `ML_DSA_WAIT_DIAGNOSTICS` setting controls these observations and remains disabled by default.
Production adds no explicit sync barrier or protocol round trip.
The cryptographic protocol, wallet-seed recovery, FIPS export, prepare-four/consume-two policy, and thirty-two-candidate capacity remain unchanged.
Admission still requires sixteen ready candidates. Cooldown remains sixty seconds, and service signing capacity remains one operation.

## Hosted results

Both runs use the same frozen native Worker artifacts and policy.
The bounded repeat uses a fresh synthetic wallet on the same deployment.
Only the forwarding front is public. The six destinations and credential payloads match the existing approval.
Client measurements include response handling and verification.

| Run | Ceremony | Prepared registration | Verified signing | Pairs consumed | Candidates evaluated | Prior preparation |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| First | Creation | 4.927 s | 6.181 s | 8 | 16 | 98.652 s |
| First | Recovery | 5.589 s | 4.990 s | 2 | 4 | 94.871 s |
| Repeat | Creation | 4.138 s | 2.289 s | 1 | 2 | 63.084 s |
| Repeat | Recovery | 4.812 s | 1.692 s | 2 | 4 | 61.939 s |

Preparation includes generic key-generation material plus sixteen initial signing candidates.
These durations are not four-candidate refill timings or sustained throughput measurements.
The online registration figures require ready material. Both campaigns also check the explicit empty-pool retry response.
Three of four registrations and three of four signatures finish below five seconds.
Four samples do not qualify consistent production latency.
The repeat's shorter preparation times establish no source optimization. Cache history, placement, platform load, and randomness remain uncontrolled.

Each recovery reproduces the creation public key.
Exact replay returns the completed registration, and changed replay is rejected.
The local real-Worker lifecycle also passes creation and recovery, verifies one signature, and preserves the recovery signing cooldown.
Its artifact contains 4,466 durable observations across the targeted command paths.
The hosted campaign exercises authenticated private Gateway requests and real Worker storage. Public login, browser UI, and testnet submission are outside this screen.

## Admission and installation findings

The first run captures these initialization joins:

| Initialization | Caller-to-pool interval | Pool invocation wall | Authorization interval | Transaction-return interval |
| --- | ---: | ---: | ---: | ---: |
| Creation A | 876 ms | 35 ms | 11 ms | 0 ms |
| Creation B | 808 ms | 51 ms | 20 ms | 0 ms |
| Recovery A | 19 ms | 13 ms | 9 ms | 0 ms |
| Recovery B | 35 ms | 19 ms | 16 ms | 0 ms |

The exact call IDs distinguish forwarding from the observed object work.
The difference does not identify network, placement, queueing, startup, or durability gates as its cause.
Initialization overlaps key execution. Its complete duration is not removable registration latency.
Initial-stock installation is the clearer critical-path target: Router intervals measure 1.742 seconds for creation and 1.639 seconds for recovery in the first run.
Delivery calls and installation scheduling should be profiled before changing storage semantics.

All seventy-eight captured callback-finish-to-transaction-return intervals in the first run report zero milliseconds.
Cached Worker clocks prevent interpreting this as free durable commits.
Storage boundaries can include preceding CPU and scheduling. Transaction return is not an explicit `storage.sync()` measurement.
Dispatch completion means the fetch returned; its HTTP status still requires a separate check.
Cloudflare documents storage timeout as an object-reset boundary, which does not identify this workload's underlying cause. [Cloudflare troubleshooting](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)

The first signing request consumes eight pairs. Rejection sampling therefore accounts for substantial additional work.
The two-pair recovery signature still approaches five seconds, so candidate count alone does not explain the latency.
Observed pair-check intervals are approximately 265–306 ms in creation and 490/544 ms on B during recovery.
B's first recovery activation interval is 607 ms, followed by 255 ms for the next pair.
Both detailed B invocations report their first signing call and a cache miss.
These observations leave setup, scheduling, transport, and runtime variation as candidates.
A's detailed recovery signing trace is absent from the first capture, despite the successful verified signature.

## Capture validation and limits

| Capture | Invocations | Durable events | Pairs within records | Explicit cross-record pairs | Unresolved boundaries | Provider truncation | Reported exceptions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| First | 585 | 3,236 | 1,501 | 0 | 0 | 0 | 0 |
| Repeat | 439 | 2,342 | 1,076 | 2 | 0 | 0 | 0 |

The first run contains two error boundaries from expected changed-replay checks. They are not storage failures.
Fourteen first-run invocations report cancellation without an exception. Both client lifecycles complete.
A false truncation flag does not establish complete capture of every request or observation.

The repeat exposes a correction to the original pairing rule.
Two waits begin in provider record 78 and end in record 79, both for the same A pool class.
Each pair matches worker, version, role, entrypoint, call ID, command, stage, observation, job, and operation.
Each has exactly one beginning and ending. Their event ordering is consistent, and the scope ordinals contain no gaps or duplicates.
Both reconstructed intervals are eighteen milliseconds.
The analysis marks these joins explicitly and does not assign their elapsed time to either record's CPU measurement.
Ambiguous or incomplete groups remain unresolved.

The earlier rule requiring every pair to remain inside one provider record is withdrawn.
Stable logical observations can span captured records. This does not establish that all missing records are recoverable.
Independent review reproduced the counts, joins, lifecycle results, and measurement limits.

## Facts and causes

| Fact | Instrument | Scope | Check |
| --- | --- | --- | --- |
| Four canonical ceremonies and signatures complete | Client verification artifacts | Two hosted wallets, creation and recovery | Completed results and signatures retained |
| Prior storage failures do not recur | Provider categories and command observations | Both hosted captures | Zero reported exceptions; expected negative replays separated |
| Initial dispatch exceeds observed object work | Shared call IDs, boundary clocks, provider wall time | First creation A/B initialization | Exact caller/callee joins |
| Stock installation is on the critical path | Router milestones | First creation and recovery | 1.742/1.639 s |
| Commit cost remains unmeasured by zero intervals | Callback and transaction-return marks | Seventy-eight captured first-run transactions | Cached-clock limitation retained |
| Two logical waits span provider records | Stable IDs and scope ordinals | Repeat records 78/79 | Unique eighteen-millisecond joins |

| Candidate cause or claim | Evidence | Status |
| --- | --- | --- |
| The earlier failures were fixed | No behavioral storage fix and no reproduced failure | Unproven |
| A deterministic cryptographic error causes every lifecycle failure | Current canonical lifecycles and signatures pass | Contradicted for that broad claim |
| Storage/runtime failures are intermittent | Prior resets and current successful native runs | Fits; underlying cause unresolved |
| Our adapter or request scheduling contributes | Current success does not reproduce the failing condition | Open |
| Cold dispatch explains registration delay | Large initial dispatch gap; initialization overlaps computation | Partial signal; cause and critical contribution unproved |
| Initial-stock delivery is a registration optimization target | Measured critical-path installation intervals | Supported target; no gain selected yet |
| Candidate count explains all signing latency | Two-pair recovery still takes 4.990 s | Contradicted |
| Diagnostics change timing | Added opt-in event emission | Open; no matched logging-overhead control |

The previous failure classification remains provisionally `environment_or_infrastructure_failure`.
The evidence does not establish a platform-only cause or exclude a workload/adapter defect.
A future failure must retain its exact command, observation ID, and surrounding scope before any retry.
A deliberately bounded cold/warm delivery experiment can test the dispatch hypothesis.
Per-pair setup, activation, checks, and forwarding need complete A/B captures to explain signing tails.

## Next work

1. Profile initial-stock serialization, delivery, and installation scheduling at the same capacity.
2. Compare cold and warm installation while accounting for overlap with key execution.
3. Obtain complete A/B signing stage captures and reduce setup and per-pair costs.
4. Repeat latency and refill qualification after selecting a measured improvement.

All six temporary Workers are deleted.
The required bloat check retains the inherited 13,972 versus 13,754 Rust duplication failure. This change adds no duplication over the preceding commit.
The baseline is unchanged.
The [evidence summary](../evidence/ml-dsa-65-durable-isolation-20261024.json) links source hashes, sanitized traces, scripts, versions, and cleanup receipts.
