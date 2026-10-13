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

## Missing observations added

The Gateway startup result now includes wallet ID, ownership generation and start
time. Timeout is distinct from other failures. A separate event records when the
abort fires, and the listener is removed when startup completes.

Role forwarding now records its start, duration and reply status beside the existing
object-selection event. Object command records include handler start time. Existing
object host observations are reused. These records contain routing identifiers,
not keys, credentials, protocol frames or authorization headers.

These diagnostics are committed locally, not deployed. A cancelled forward can
lack a completion record. Missing records must remain missing, not be interpreted
as a zero-length operation.

## Next action

Deploy the coordinated diagnostic candidate during the next R155J staging window.
Capture correlated startup, abort, object-entry, command and host records. Keep the
three-second timeout until evidence shows a useful retained continuation changes
the critical path. Use the existing startup path; do not race replacement objects.

If the long interval stays before handler entry, retain a sanitized Cloudflare
support bundle. Provider escalation requires separate authorization. The 500-attempt
p99 acceptance run, setup recovery tests and cost controls remain separate open work.


## Validation

The four-case workerd reproduction passed twice. The final run asserts queued
startup omission, same-object execution, one constructor, and completion of an
already-entered asynchronous handler after caller cancellation.
`packages/wallet-server` type-check passed. Wasm-target Rust checks passed for
Router and Deriver A entrypoints. The public bloat check passed. No live deployment
or resource change was made during this investigation.
