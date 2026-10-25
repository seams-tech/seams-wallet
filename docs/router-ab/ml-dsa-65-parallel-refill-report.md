# ML-DSA producer diagnosis and parallel refill — October 25, 2026

The parallel refill implementation passes the native lifecycle checks.
Hosted throughput remains unqualified until the serial–parallel–serial campaign completes.
The previous `loadShed` failures and producer speed change still have no proven cause.
The [local evidence](../evidence/ml-dsa-65-parallel-refill-local-20261025.json) records twelve independently verified signatures and the public archive digest.

## Facts and limits

The earlier eight-wallet campaign recorded twelve B-side `loadShed` jobs within 34.532 seconds.
Each failed job has a distinct Wasm module identity.
The first failed job reused the module of the preceding successful job.
The second stored two B halves before failure. Neither half became paired stock or was consumed.
These observations distinguish partial preparation from usable material.

| Fact | Instrument and control | Limit |
| --- | --- | --- |
| Twelve failures occur in a short burst | Retained Cloudflare B invocation outcomes, matched by job ID | Outcome alone does not identify the platform cause |
| First two failures last report 94,371,840 Wasm bytes | The immediately preceding successful job reports the same size | Wasm boundaries omit the JavaScript heap and transient peaks |
| Remaining ten failures last report 40,566,784 Wasm bytes | Successful cold executions also start at this size | No full-isolate memory trace is available |
| Thirty-six adjacent B invocation intervals overlap, at most 581 ms | Recomputed from retained invocation timestamps and wall time | Invocation overlap does not prove overlapping heavy computation |
| Provider memory query returns HTTP 401 / authentication error 10000 | Exact previous B Worker and failure time window, current Wrangler identity | No memory conclusion follows from a rejected query |
| Previous four-wallet F4 median producer wall time changes 18.129→9.318 s | Same preparer Wasm binaries; matched four-candidate jobs | Deployment and runtime conditions differ between campaigns |
| Warm schedule-hit median CPU changes 8.385→4.002 s | Schedule-hit jobs only; identical bytes and protocol event counts | Public topology reuse and runtime compilation were unmeasured |

The failure counts are reproducible with the evidence archive's `diagnose_prior.py` and the previous campaign's eight-wallet `traces.json`.
The resulting JSON exactly matches `prior-failure-analysis.json`.
The previous campaign and its binary comparison are recorded in the [expiry report](ml-dsa-65-expiry-admission-report.md).

Cloudflare lists separate `loadShed`, `exceededMemory`, and `exceededCpu` outcomes in its [runtime schema](https://raw.githubusercontent.com/cloudflare/workerd/main/src/workerd/io/outcome.capnp).
Its [memory limit documentation](https://developers.cloudflare.com/workers/platform/limits/) applies a 128 MiB limit per isolate, shared across concurrent requests.
These facts do not establish that this burst exceeded memory.
Cloudflare's [memory metrics](https://developers.cloudflare.com/changelog/post/2026-06-30-memory-usage-metrics/) could add evidence if authorized access becomes available.

## Cause table

| Candidate cause | Observed failures | Speed difference | Status and next measurement |
| --- | --- | --- | --- |
| Changed cryptographic work | No evidence of changed work | Identical preparer binaries, bytes, and protocol event counts contradict a changed algorithm | Remove as explanation for the historical speed gain |
| Schedule parsing alone | Does not identify the burst | Warm schedule-hit CPU also differs | Insufficient explanation |
| Public topology cache or runtime compilation | Module replacement fits repeated cold work | Topology reuse was unmeasured | Record builds, hits, resident topology bytes, and module identity |
| Memory pressure | Possible; boundary sizes occur in successful controls too | Says nothing decisive | Obtain full-isolate telemetry; do not infer exhaustion from `loadShed` |
| Physical CPU or placement differences | Could fit speed variation | Unmeasured | Same-deployment serial–parallel–serial comparison; request colo remains only request metadata |
| Our scheduling or overlapping computation | Invocation intervals overlap briefly | Could add contention | Record per-module active computation and isolate normal parallel slots in separate Worker deployments |
| Storage or protocol waits alone | Could affect wall time | CPU also falls substantially | Insufficient as the sole explanation; compare CPU and stage waits separately |
| Measurement effects | Tail capture adds work; historical conditions differ | Possible | Keep capture fields and crypto deployments constant across comparison phases |

No earlier claim that expiry or admission changes caused the producer speed gain is retained.
No hardware change or memory-exhaustion diagnosis is established.

## Implementation

`max_active_preparations` accepts one or two service-wide preparation leases. Its default is one.
Each slot uses a separate producer Durable Object namespace and a separate A/B preparer deployment.
Both slots deliver material to the existing participant-local pools.
A preparer receives only its own participant's storage key.

The admission authority keeps FIFO grants and one live lease per exact key scope.
Changing the policy from two slots to one counts both existing leases until they finish or expire.
Completion removes only the matching full job. Recovery and lease checks reject stale publication.
The ninety-second lease does not prove that timed-out computation stops immediately.

All per-wallet limits remain unchanged:

- Sixteen prepared pairs, or thirty-two candidates, per wallet.
- Eight pairs required before signing admission.
- Two candidates consumed per attempt.
- Four candidates prepared normally; two candidates when one pair remains vacant.
- Sixty-second wallet cooldown and one active service-wide signing operation.
- Wallet-seed recovery, standard FIPS export, and the passive server-blind model.

New diagnostics contain public state only: producer slot, topology cache counters, allocation bytes, module identity, and active computation count.
The count belongs to one Wasm module. It does not measure all computation across a Worker deployment.
The trace collector also retains validated request colo codes, which do not identify the physical CPU host.

## Validation and remaining hosted comparison

The native durable-pool E2E covers two concurrent keys, queue order, restart, serial reconfiguration, stale completion, recovery fencing, and invalid slot substitution.
The independent review found no blocking lease, authorization, or single-use issue.
A secondary B service binding was corrected before release; both pairs now map consistently to their own preparer deployments.

Local Workerd validation uses all eight Worker scripts and two synthetic wallets.
Both wallets pass registration, signature verification, and canonical seed-based recovery across two epochs.
Both pools return to sixteen pairs. Two cross-wallet preparation intervals overlap, and all four jobs publish successfully.
These intervals include protocol waits. They do not prove simultaneous CPU execution.
Ten additional signatures verify across simultaneous, repeated, and staggered demands, after recovery.
Two setup signatures also verify. Local timing is not a Cloudflare performance result.
Two old-epoch jobs complete computation during recovery and fail publication.
Their traces are consistent with recovery fencing, but the public events do not identify the terminal errors.
The native E2E separately proves that old-epoch publication is rejected.
Cache controls record six builds in a cold preparation and twelve hits in a warm preparation.
All recorded per-module active-computation counts equal one; this does not prove a deployment-wide maximum.
A test bridge initially returned HTTP 500 before dispatch because it passed an incompatible Request object to Miniflare.
Passing the URL and request options directly fixed that infrastructure failure. Production behavior did not change.

The hosted campaign uses eight wallets and three matched phases:

1. One preparation slot.
2. Two preparation slots, with only the Router's policy redeployed.
3. One preparation slot again, retaining the preparer deployments.

Each phase starts and ends at the same per-wallet reserve target.
Measure verified signatures per minute, produced and consumed pairs, failed preparation, expiry waste, empty-pool waits, and complete demand latency.
Report warm and cold producer CPU, cache state, protocol waits, storage waits, and module replacement separately.
Require trace coverage and exact A/B consumption matching before claiming capacity gains.
Successful HTTP latency alone does not establish sustained capacity.

Eight temporary Worker shells have been created. Credential upload is pending explicit approval after automatic review rejected the new destinations and payloads.
No hosted comparison result is claimed at this stage.

The bloat check retains its inherited failure: 13,972 duplicated Rust lines against a 13,754 baseline. This change adds no duplicated Rust lines.
