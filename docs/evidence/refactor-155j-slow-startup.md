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
This identifies the request-body wait boundary. It does not identify why the
Router's producer did not complete the body. The failed attempt has no observed
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
The independent verification report is
`.artifacts/proof-verification-r155j-hosted-startup-20261013.json`.

All 14 serving versions match the original snapshot. Final tenant activation and
readiness passed in GitHub run `38345363529`. Unfinished ceremonies temporarily
blocked reactivation; they expired without deleting lifecycle records. The private
`restored.json` records the final check. Temporary diagnostics were removed from
source in `3d60ebca`. Uploaded diagnostic versions remain inactive in Cloudflare
version history; none serves traffic.

## Next action

Investigate the captured streamed-delivery failure and prompt failure propagation.
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
