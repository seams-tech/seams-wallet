# R155J — Acceptance population on release 0.10.2

Date: October 15, 2026, 00:00 to 01:41 JST, staging, release 0.10.2.
Plan: [R155J](../refactor-R155J-p99.md). Numbers:
[refactor-155j-acceptance-0102.json](refactor-155j-acceptance-0102.json).

## Result

**The tail target is not met.** Of 204 attempts, 203 registrations
succeeded and 1 failed after 4.1 s. Without the passkey step, p99 is
5,966 ms against the 4-second target, and 11 registrations (5.4%) took
more than 4 s against the 1% limit. The median, 2,307 ms, is just above
the 2.3-second target. All 203 signatures verify.

The run was stopped after two of the five planned groups, on the user's
decision: the target was already missed, and another session had deployed
a new staging Console build at 07:05 JST. Groups 1 and 2 ran on the frozen
0.10.2 build.

| Without the passkey step | n | p50 | p90 | p95 | p99 | Max | Over 4 s | Over 5 s | Over 6 s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All successful registrations | 203 | 2,307 ms | 3,508 ms | 4,032 ms | 5,966 ms | 8,017 ms | 11 | 5 | 2 |
| First batch of each group | 6 | 5,127 ms | 6,996 ms | 7,507 ms | 7,915 ms | 8,017 ms | 5 | 3 | 1 |
| All other batches | 197 | 2,272 ms | 3,275 ms | 3,863 ms | 4,941 ms | 6,050 ms | 6 | 2 | 1 |

Percentiles interpolate at `(n - 1) * p`; the nearest-rank p99 of all 203
is 5,975 ms. After the passkey step: 1,619 ms at the median, 4,138 ms at
p99.

| Group | Start (JST) | Entry | Attempts | Succeeded | Failed | p50 | p90 | Max |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 00:00 | Tokyo, 3 of 3 probes | 102 | 102 | 0 | 2,454 ms | 3,603 ms | 8,017 ms |
| 2 | 01:30 | Tokyo, 3 of 3 probes | 102 | 101 | 1 | 2,139 ms | 3,459 ms | 6,050 ms |

## The eleven slowest registrations

Each slow registration was joined with its server events through the trace
id of its `respond` request. Two `respond` events were missing from the
Gateway tail; their browser stages are still known.

| Class | Count | Evidence |
| --- | ---: | --- |
| First batch after 90 minutes or more without traffic | 5 | Setup 1.8 to 2.7 s (about 0.6 s otherwise); pair preparation 0.4 to 1.7 s; custody reservation up to 809 ms. Cold Workers and objects |
| A wait in the Gateway before the Yao execution | 3 | 1.2 to 1.7 s between the start of `respond` and its Yao execution, with 24 to 92 ms of CPU. D1 SQL batches took 20 ms at p99 in those minutes, so SQL is excluded. `respond` reports no timing for this stretch; write confirmation and transport are not excluded |
| Slow setup outside a first batch | 1 | 3,040 ms |
| Slow finalize outside the server's work | 1 | 2,011 ms in the browser against 139 ms of server time |
| Slow pair preparation | 1 | 963 ms |

One slow registration of the second class also had a 2.6-second start of
its Deriver A wallet object, with no CPU in that time.

## The failed attempt

Group 2, batch 14, registration 1. Times are milliseconds before or after
the Router's refusal.

| Time | Event |
| ---: | --- |
| −2,941 | Setup asks Deriver A to start the wallet object and to prepare the pair |
| −2,183 | `respond` sends the combined execution to the Router |
| −538 | The Deriver A object starts, 2.4 s after the first request, with no CPU in between. Start, execution and preparation arrive together; the execution is handled before the preparation |
| −538 | The execution prepares the pair itself. The setup preparation admits first, and the execution fails: "ConflictingPair: this tenant-root operation was admitted here under a different binding" |
| −400 | Deriver A answers 503. The Router keeps its claim of the registration until the claim's lease ends |
| 0 | `respond` answers 200 with `admitted`, so the SDK runs the execution through the `execute` route |
| +47 | The Router finds the claim held and answers "in progress" with a retry time. The Gateway answers 409 without that time, and the SDK fails |

- **State of the first execution:** it failed during preparation, before
  any online work. The setup preparation left an admitted, unused session.
- **Release 0.10.2:** `respond` made one Router call, so the 0.10.2 retry
  of `respond` did not run. The chain uses the combined request of
  `dcace878` (0.10.0) and the 409 mapping of `df9d0447`; both are in
  0.10.1.
- **Two places in our code turn a platform delay into a failure:** an
  execution that arrives before its preparation fails instead of waiting
  for it, and the Gateway drops the Router's retry time.

## Not part of this population

- The [12.2-second Router object wait](refactor-155j-router-finish-hold-20261014.md)
  of October 14 ran on the same release before this window.
- An entry-location probe runs from 00:31 JST on October 15 for 24 hours.
  It separates Cloudflare's routing of our zone from the client network's
  routing.

## Open measurements

- Server-Timing for the steps of `respond` before the Yao execution:
  passkey verification, admission binding and the ceremony write.
- A comparison of first batches after idle with and without an earlier
  start of the custody objects.
