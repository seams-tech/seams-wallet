# Slow startup investigation — October 13, 2026

The largest explained interval is before Deriver A's wallet handler starts.
The three-second abort can remove a queued warm-up request. Removing that abort
alone did not reduce the initialization wait in a local workerd reproduction.
No hosted speedup or complete Cloudflare root cause is claimed.

## Saved staging evidence

Source: private `.artifacts/r155h-singapore-anchor/release-093/`, sample
`group-22/registration-2.json`, plus Gateway, Router and Deriver tails.
Registration took 5.472 s excluding passkey interaction; custody took 4.166 s.
The trace parser and extracted timeline are in private `.artifacts/r155j-startup/`.

| Boundary | Recorded UTC epoch milliseconds | Evidence |
| --- | ---: | --- |
| Router startup invocation | 1791830053309 | 2,978 ms wall, 2 ms CPU |
| A startup Worker invocation | 1791830053331 | 2,973 ms wall, 4 ms CPU |
| A startup object selection | 1791830053332 | Stored A object ID and logical name |
| A execute Worker invocation and object selection | 1791830054430 | Same A object ID and logical name; 3,737 ms wall, 6 ms CPU |
| A execute object invocation | 1791830057277 | 898 ms wall, 342 ms CPU |

Execution was command 1 after the A object constructor. Its isolate record says
`prewarm: none`. No startup handler record exists for that object. Router startup
and execution also used the same stored Router object ID. Startup reached that
Router object successfully; execution was its second command.

The A Worker selection and A object invocation timestamps differ by 2,847 ms.
These timestamps come from distinct invocations. Treat the difference as an
approximate cross-invocation interval, not a calibrated network measurement.
Whole-invocation wall time can include background work. Do not subtract it from a
parent span or add overlapping spans.

This rules out a slow Yao computation as the explanation for that entire interval.
The A handler had not started. The trace does not distinguish object placement,
platform initialization, scheduling, internal retries or another pre-handler wait.
No production constructor delay is identified by this investigation.

## Local cancellation reproduction

Run from the public repository:

```sh
node tests/e2e/startup-cancellation.e2e.mjs
```

This uses real local workerd service bindings: Gateway → Router → role Worker →
a SQLite-backed Durable Object. Startup has the existing three-second abort.
Execution follows one second later and addresses the same unique object ID.
An artificial 4.5-second delay is applied either inside `blockConcurrencyWhile`
during initialization or inside an already-entered startup handler. Each case
also runs without the abort. Observation occurs after the delay can finish.

The fixture models transport and initialization only. It does not execute MPC,
reproduce Cloudflare placement, or run the production registration handler.

| Scenario | With abort | Without abort |
| --- | --- | --- |
| Initialization held | Queued startup never enters; execute is first | Startup enters, then execute |
| Execution wait during held initialization | About 3.5 s | About 3.5 s |
| Startup handler already entered | Startup completes after caller aborts | Startup completes |
| Execute during asynchronous handler wait | Completes without waiting for startup | Same |

Thus cancellation behavior depends on the boundary. A queued request can be
removed before handler entry. In this fixture, an entered handler continues while
another request keeps the object active. This does not prove detached work survives
without another active request or without `waitUntil`.

The observed queued-request behavior explains how the saved trace could have no
startup handler and `prewarm: none`. It does not prove the same platform cause or
prove cancellation created the original slow initialization. The control retains
the same execution wait. Increasing the timeout is therefore unsupported as a
latency fix.

The repeatable artifact is `.artifacts/startup-cancellation/evidence.json`.
A [sanitized result](refactor-155j-startup-cancellation.json) records all four cases.

## Production code findings

- Gateway initializes the stored address set before it schedules startup with
  `waitUntil`. Its `WalletHomeCustodyBinding` resolves the same persisted identity
  and ownership generation used by later execution.
- Router starts Router, A, B and Signing Worker objects concurrently. One slow
  role can exhaust the Gateway timeout for the joined startup request.
- A and B startup schedule their in-memory compute ceremony with object
  `wait_until`, then return. Success means startup admission/handler readiness,
  not completed compute prewarming.
- Real pair work sets the isolate's stop marker. Prewarm checks it after yielding
  between protocol messages. A late startup cannot begin prewarm after real work
  already arrived. It cannot retroactively hide the first execution's CPU.
- Startup does not admit signing authority. Ownership checks and execution claims
  remain on the actual operation. No timeout, claim or protocol behavior changed.

## Hosted diagnostic capture

On October 13, temporary Gateway, Router, Deriver A and Deriver B builds ran on
existing staging resources. Public sources were frozen at `dee249c5`; private
Gateway sources were frozen at `bbc0f03`. The browser used the earlier combined
setup/SDK candidate. Binding values, secrets, database schemas and placement were
preserved. This was a diagnostic capture, not a release latency comparison.

The Gateway recorded wallet ID, ownership generation, startup start time and abort
initiation. Role forwarding recorded start, duration and reply status. Object
command records included handler start time. These additions have been removed
from the working source. The existing three-second timeout remains unchanged.

The bounded run attempted 89 registrations. It completed 87 independently verified
NEP-413 signatures. Two attempts failed; one planned attempt did not run after the
last failure. The verifier rejected altered signed fields for every completed
signature. The run retained both failed attempts.

**The earlier three-second Deriver A startup stall did not recur.** No Gateway
startup abort event was observed. Among APAC startup forwards in the collected
tails, the largest completed duration was 489 ms for A and 673 ms for B. These
are all APAC tail observations, not a benchmark-only population. Other US-region
startup traffic reached 1,333 ms and is excluded from the APAC figures.

### A different slow failure was captured

Sample `group-30/registration-2.json` reached the Signing Worker object promptly.
Its startup had already succeeded, and both Derivers recorded completed prewarm.

| Boundary | Observed result |
| --- | --- |
| Gateway joined startup | Success, 353 ms |
| A startup forward | Success, 179 ms |
| B startup forward | Success, 268 ms |
| Signing Worker startup | First command; HTTP 200 |
| Signing Worker package delivery | Second command; 30,000 ms handler span; about 2 ms CPU; HTTP 500 |
| Browser registration action | Remained pending until its 120-second harness timeout |

The Signing Worker has an existing 30-second timeout around decoding the streamed
package body in `durable_object/signing_worker_wallet/package_delivery.rs`.
The captured command hit that duration and has no completed `body_wait` record.
This strongly suggests a request-body timeout. The response body and an explicit
timeout event were not captured, so the timeout cause remains an inference.
The trace does not identify why the Router's producer did not complete the body. The failed attempt has no observed
A/B execution completion record. Missing tail records do not prove that execution
never began.

The Router joins the ceremony and early delivery futures in
`router_coordinator.rs`. A delivery failure therefore needs investigation on both
sides: why the producer stalls, and why the HTTP failure does not promptly settle
the browser request. Preserve durable claims and exact retry behavior when fixing
that path. Increasing the timeout would extend the failed wait.

The other failed sample, `group-11/registration-3.json`, registered successfully
but received HTTP 503 on its first signature: `Wallet Session status is unavailable`.
Its cause remains unresolved. Runtime and Signing Worker tails were enabled after
that failure, so they cannot explain it retrospectively.

### Evidence and restoration

[Sanitized invocation timeline and version IDs](refactor-155j-hosted-startup.json).
Private raw artifacts, frozen sources, signatures, activation records and guards:
`.artifacts/r155j-hosted-startup-20261013/` in `seams-monorepo`.
Failed raw samples contain an unconditional success note from the benchmark
writer. Their failed outcome and missing measurement take precedence; those notes
are not signature evidence. Original raw artifacts remain unchanged.

The independent verification report is
`.artifacts/proof-verification-r155j-hosted-startup-20261013.json`.

At the end of the first capture, all 14 serving versions matched its snapshot.
Final tenant activation and
readiness passed in GitHub run `38345363529`. Unfinished ceremonies temporarily
blocked reactivation; they expired without deleting lifecycle records. The private
`restored.json` records the final check. Temporary diagnostics were removed from
source in `3d60ebca`. Uploaded diagnostic versions remain inactive in Cloudflare
version history; none serves traffic.

## Delivery failure propagation

The hosted trace prompted a separate Router code review. The old coordinator
joined the ceremony and streamed delivery until both finished. Delivery errors
were placed in a channel that the ceremony read only after role execution.
An early delivery error could therefore remain unseen while role execution waited.
A completed ceremony failure also waited for the delivery exchange.

Commit `4f360155` changes the coordinator to observe both futures. A ceremony outcome ends the joined
wait. A delivery error ends it through the existing failure mapping. A successful
delivery still waits for ceremony finalization. A superseded attempt retains its
terminal rejection and exact-replay behavior. Durable claims remain unchanged.

This fixes failure propagation. It does not establish the cause of the hosted
producer stall, prove remote cancellation, or claim a registration latency gain.

| Candidate cause | Evidence | Conclusion |
| --- | --- | --- |
| Startup delay caused this failed sample | Startup completed successfully before execution | Does not explain this sample |
| Pending upload always prevents an error reply | Local service-binding probe returned HTTP 500 before the body was supplied | Universal claim contradicted; hosted transport parity remains unproved |
| Router waits after one side has failed | Existing join and delayed receipt read | Concrete failure-propagation gap; targeted Worker check below |
| Producer stalled for a known reason | No completed producer trace or explicit timeout response | Still unknown |

### Worker E2E verification

Run from the public repository after building all five strict Workers with the
`dev` profile:

```sh
ROUTER_AB_WORKER_BUILD_PROFILE=dev node crates/router-ab-cloudflare/scripts/package-delivery-failure-evidence.mjs
```

The test uses the actual Rust Router, role Workers, Signing Worker and SQLite
wallet objects. It allocates namespace-issued object IDs. Fault replies use native
Worker service bindings. A first Node HTTP bridge injector added a separate wait
while reading the error body; that injector was replaced before the comparison.

Only the Router differs in the parent control. With parent `e53e3c3e`, the native
binding delivery-failure case remained pending at the five-second test deadline.
The candidate answered that case in 205 ms. All five candidate cases passed:

| Scenario | Verified behavior |
| --- | --- |
| Delivery fails while A is held | Router returns HTTP 500 before A is released |
| Recoverable ceremony failure while delivery is held | Router returns the recoverable result before delivery is released |
| Superseded attempt while A is held | Terminal rejection persists and exact retry returns it |
| Delivery fails after packages are produced | Retry reports uncertain delivery without executing the protocol again |
| Successful registration | Exact retry returns the committed result |

The first three local fault responses took 199–205 ms. These are development
harness timings, not hosted speedups. The [sanitized result](refactor-155j-delivery-failure.json)
records the population and limits. The raw repeatable artifact stays under
`.artifacts/delivery-timeout/source/.artifacts/package-delivery-failure/`.

## Hosted check of the delivery fix

On October 13, Router version `5651a97c-80b7-47b3-8a6c-1b8d1f91d99a`
replaced `286463e7-df21-4052-9fc1-1ab86dbe7c6a` on staging. Its release build
contains `4f360155`. The other 13 serving Workers were preserved, including
Claude's `wallet_do_host` logging. Bindings, runtime settings, placement, classes
and migration metadata matched the fresh serving snapshot. No resources or
additional temporary code diagnostics were created.

All 30 registration attempts succeeded across ten groups of three. All 30 first
NEP-413 signatures passed independent verification, using 30 distinct keys.
Changes to signed fields failed verification. The existing tenant verification
accepted the updated Router; an additional activation was unnecessary. The verified
candidate remains on staging. All tail processes stopped after capture.

| Workload | Median | Maximum |
| --- | ---: | ---: |
| Registration, excluding the passkey step | 2.745 s | 5.476 s |
| Registration after the passkey step | 1.892 s | 4.222 s |
| First signature | 0.568 s | 2.252 s |
| Registration and first signature, excluding interaction | 3.481 s | 7.734 s |

This is an immediate post-deployment diagnostic sample. The first group's median
registration was 4.435 s; the last group's was 2.228 s. Keep every group. This
variation and the absence of a contemporary control prevent a speedup claim.
These 30 attempts do not establish p99 acceptance. The SDK site matches the saved
`release-093` client, and its file hashes stayed unchanged during the run.

The collected tails contain no invocation at or above 2.5 seconds. All 351
Router trace records identify the candidate version; none returned HTTP 500 or
higher. Neither the original three-second startup stall nor the 30-second delivery
failure recurred. Successful hosted requests do not exercise the failure path:
the native Worker fault tests above provide that evidence. The producer's original
stall remains unexplained.

[Sanitized hosted result](refactor-155j-delivery-hosted.json) includes all group
summaries. Private artifacts are under `.artifacts/r155j-delivery-hosted-20261013/`.
The independent proof report is `.artifacts/proof-verification-r155j-delivery-hosted-20261013.json`.
The benchmark writer now labels failed samples accurately (`seams-monorepo`
`2310116`); saved earlier raw samples remain untouched.

## Next action

The failure-propagation fix is deployed and passed the bounded hosted check.
Continue tracing the captured streamed-delivery producer stall.
Keep the original startup cause marked unresolved. A future coordinated capture
can target it; this bounded run provides no causal fix for that stall and no p99
acceptance claim. The 500-attempt acceptance run and setup cost controls remain
separate work. Do not race replacement objects or change the startup timeout based
on this evidence.

## Validation

The four-case local workerd reproduction passed twice. It asserts queued startup
omission, same-object execution, one constructor, and completion of an entered
asynchronous handler after caller cancellation. The initial diagnostic change
passed Wallet Server type-check and Wasm-target Router/Deriver A checks.
After removing the temporary diagnostics, Wallet Server type-check and the public
bloat check passed. All 87 completed hosted signatures passed independent checks.


## Setup recovery verification

The existing bounded retry implementation passes through the assembled registration
service and a real local Miniflare D1 database. No production code changed.
The test injects a transport exception before a ceremony batch, or after its
successful commit. It preserves the actual SQL, transaction, and replay paths.
The reservation authority remains reachable throughout these cases.

Run from the public repository:

```sh
node tests/e2e/registration-setup-startup.e2e.mjs
```

| Injected condition | Initial batch attempts | Initial response | Exact request replay |
| --- | ---: | ---: | --- |
| One lost batch request | 2 | 200 | Same wallet, ceremony, and object addresses |
| One lost committed batch reply | 2 | 200 | Same wallet, ceremony, and object addresses |
| Three lost batch requests | 3 | 503 | Recovers with the original reservation and addresses |
| Three lost committed batch replies | 3 | 503 | Recovers the committed ceremony with the original addresses |

Each recovered case retains two ceremony records, one home record, and one
reservation. The two ceremony records are the setup snapshot and current ceremony.
The 503 response contains `storage_unavailable` and a fixed message. It contains
no database driver text. The existing allocation-loss, cancellation, concurrent
allocation, wrong-tenant, and generation checks also pass in the same run.

Exact setup replay models recovery after a successful response does not reach its
caller. This check does not inject browser transport loss or test SDK automatic
retry. It also does not inject a Console reservation failure or hosted D1 failure.
No hosted latency saving is inferred from this local correctness check.

The repeatable artifact is `.artifacts/registration-setup-startup/result.json`.
The sanitized copy is [setup recovery evidence](refactor-155j-setup-recovery.json).

Release status: npm reports `@seams/wallet-server@0.9.3` source revision
`e4f883f7a4429dcb517f7a9dfb48d95ae3e62de0`. That revision does not contain
`storage/d1Retry.ts`. Commit `b8de6715` remains part of the next candidate.
This check made no live changes.
