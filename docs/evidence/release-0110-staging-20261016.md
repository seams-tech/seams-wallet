# Release 0.11.0 on staging — October 16, 2026

Release 0.11.0 serves on the staging Singapore lane. 66 measured registrations
passed, with no failure. The R155J tail target is still not met, and 66 attempts
are too few for a p99 claim. Respond is about 400 ms slower at the median than in
every 0.10.2 population. The cause is cold callee isolates: since `18b09520`
the Router wallet object, which is fresh for each wallet, calls the Derivers and
the Signing Worker itself, and such calls start new isolates of these large
Workers. A probe confirmed the mechanism and ruled out write confirmation.

## Deployment

| Step | Result |
| --- | --- |
| npm | `@seams/wallet-server` 0.11.0 at 05:45 UTC, `@seams/wallet` 0.11.0 at 05:47 UTC (run `38853336503` on `main` `aedbe786`) |
| Private pins | `seams-monorepo` `a5dbf249` on `dev`: ten pins, two release-age exclusions, and three changes for the removed Express entry |
| Backend | Run `38857937018`: every component deployed; the smoke step answered 403 before activation, as expected |
| Activation | Run `38858871724`, 15:02 JST |
| Frontends | Run `38859011577`, 15:05 JST, wallet revision `aedbe786`; the hosted wallet reports package 0.11.0 |
| Console | Not deployed by this release. Another session deployed Console `a600e533` at 15:31 JST, four minutes before the runs |

All 14 serving Worker versions were recorded before the runs. The Router,
Derivers, Signing Worker and tenant-root control plane serve the uploads of
05:54 to 05:55 UTC; the Gateways and wallet runtimes serve those of 05:56 to
05:57 UTC.

## Population

One warm-up group, then two runs of 33 registrations, from 15:36 to 15:44 JST.
Each registration is followed by its first Ed25519 signature. The browser entered
Cloudflare in Tokyo (NRT) for every run. The harness was the 0.11.0 source tree
and a test app built against the published 0.11.0 package.

The 0.10.2 populations are the [acceptance run](refactor-155j-acceptance-0102.md)
of October 15, 00:00 to 01:30 JST, and three controls of October 16
([record](refactor-155j-followups-20261015.md)). The controls ran at 00:30, 00:46
and 10:14 JST; the slow Deriver A condition of that night affected the first one.
No 0.10.2 population ran at the same time as 0.11.0. A tail gain against the
controls therefore does not show an effect of 0.11.0.

| Population | Wallets / failed | After passkey p50 / p90 / p95 / max (ms) | Without passkey p50 / p95 / p99 (ms) | Above 4 s |
| --- | ---: | --- | --- | ---: |
| Acceptance 0.10.2 | 203 / 1 | 1,619 / 2,563 / 3,025 / 5,770 | 2,307 / 4,032 / 5,966 | 11 (5.4%) |
| Control 0.10.2, 00:30 | 33 / 0 | 2,744 / 7,734 / 8,099 / 10,142 | 3,835 / 9,523 / 12,241 | 15 |
| Control 0.10.2, 00:46 | 33 / 0 | 2,070 / 2,832 / 4,638 / 7,309 | 3,085 / 6,275 / 8,278 | 9 |
| Control 0.10.2, 10:14 | 33 / 0 | 2,308 / 3,767 / 4,130 / 8,856 | 4,142 / 11,867 / 19,166 | 20 |
| **0.11.0** | **66 / 0** | **2,021 / 2,353 / 2,497 / 2,932** | **2,779 / 3,798 / 4,166** | **2 (3.0%)** |

Interpolated p99. "Without passkey" is the R155J measure. Its target is a p99 of
4 s and at most 1% above 4 s. The 0.11.0 p99 rests on less than one observation.

| Stage, median / p90 (ms) | Acceptance 0.10.2 | 0.11.0 |
| --- | --- | --- |
| Setup | 544 / — | 631 / — |
| Respond | 1,076 / 1,834 | 1,498 / 1,810 |
| Finalize | 395 / 707 | 408 / 607 |
| First signature | 370 / — | 374 / — |

No Deriver A preparation took more than 3 s in 0.11.0 (9 of 33 in the 00:30
control).

## The respond regression

**Cause: cold callee isolates.** Since `18b09520`, the Router wallet object
calls Deriver A, Deriver B and the Signing Worker itself. Each wallet has a
fresh Router wallet object, and a service-binding call from a fresh object
almost always starts a new isolate of the callee. These callees are large
Rust/Wasm Workers, so every registration now pays their cold starts. In 0.10.2
the stateless Router made these calls and mostly reached warm isolates.

The Router's own `Server-Timing` steps for respond, median / p90 (ms):

| Population | `yao_router_execution` | `yao_router_prepare_pair` | `yao_router_role_execution` | Browser respond |
| --- | --- | --- | --- | --- |
| Acceptance 0.10.2 | 805 / 1,464 | 149 / 465 | 575 / 1,057 | 1,076 / 1,834 |
| Control 0.10.2, 00:46 | 882 / 1,636 | 170 / 540 | 644 / 1,327 | 1,352 / 2,117 |
| Control 0.10.2, 10:14 | 758 / 1,211 | 141 / 542 | 537 / 1,041 | 1,456 / 2,076 |
| 0.11.0 | 1,232 / 1,540 | 469 / 624 | 909 / 1,208 | 1,498 / 1,810 |

### Where the time goes

The tails give real-time event timestamps. Events are linked per registration
by the `x-seams-trace-id` header of the stateless events and by the object id
that each stateless event logs before it calls its wallet object. Medians (ms):

| Interval | Acceptance 0.10.2 | Controls 0.10.2 | 0.11.0 |
| --- | ---: | ---: | ---: |
| Router `execute` event | 773 | 717 to 851 | 1,184 |
| Router start to tenant-root read (claim and parsing)¹ | 187 | 82 to 133 | 61 |
| Tenant-root read to first Deriver start | 42 | 38 to 42 | 207 |
| Router start to first Deriver start | 88 | 89 to 119 | 270 |
| Deriver A object end to Router end (package delivery and finish)¹ | 168 | 170 | 256 |

¹ Linked executions only: 18 and 43 in the acceptance run, 26 and 42 in the
controls, 28 and 64 in 0.11.0. Some executions lack a matching event in the tail.

The claim inside the object is faster than the two command calls of 0.10.2, as
intended. The time is lost after it: between the tenant-root read and the first
Deriver start (at least 134 ms in all 28 linked executions of the second run),
and after Deriver A's object ends. The Deriver A object's own work is unchanged. A Deriver A stateless event
ends before its object's event in 0.11.0 (its answer streams through), so the
end of the A object, not of the A stateless event, marks the end of Deriver A.

### The cold-start signature in the tails

A stateless Deriver or Signing Worker event in a new isolate uses much more CPU.

| Stateless callee | Acceptance 0.10.2 | Controls 0.10.2 | 0.11.0 |
| --- | ---: | ---: | ---: |
| Deriver A `execute-pair`: calls with CPU ≥ 50 ms | 13% | 31% | 97% |
| Deriver B `prepare-pair`: calls with CPU ≥ 50 ms | 14% | 30% | 89% |
| Signing Worker `activation/packages`: CPU median | 2 ms | 3 ms | 65 ms |
| Signing Worker: calls with CPU ≥ 50 ms | 7% | 22% | 95% |

The high-CPU calls also start late, in both versions. Router start to Deriver A
start, median:

| Deriver A call | Acceptance 0.10.2 | Controls 0.10.2 | 0.11.0 |
| --- | ---: | ---: | ---: |
| CPU < 30 ms | 81 ms (174 calls) | 95 ms (65) | 27 ms (2) |
| CPU ≥ 50 ms | 260 ms (26 calls) | 185 ms (31) | 315 ms (64) |

The same split holds for Deriver B. In 0.11.0 the few warm calls start sooner
than in 0.10.2 (27 against 81 to 95 ms), because the claim no longer needs its
own command call. Low CPU and an early start do not match one to one: in 7 of
the 9 executions with an early start, only one of the two Derivers started
early, and some early starts still used 58 to 84 ms of CPU. A new isolate can
start quickly on some machines; in most calls its start waits about 200 ms.

### Probe

A probe on the approved Worker names `ed25519-yao-ab-benchmark-a` and
`ed25519-yao-ab-benchmark-b` ran from 20:41 to 20:52 JST and was then deleted;
the API confirmed both names absent. Its front, its peer and its objects ran in
Singapore, as on staging: the front and the peer have placement
`aws:ap-southeast-1`, and the objects are SQLite-backed with the `apac` hint,
fresh for each test, woken 1 s before it, with 12 KB request bodies.

First it tested write confirmation, which this record named as the likely
cause before. 30 rounds in random order, medians:

| Probe test | Median (ms) |
| --- | ---: |
| Reply without a write / after a transaction | 6 / 10 |
| Object start to peer arrival, without a write / after the claim-like transaction | 11 / 14 |
| Same, after the transaction and 60 ms of CPU | 14 |
| `storage.sync()` after the transaction | 3 |
| Peer answer to front receipt in a 600 ms request, without / with a write before the reply | 4 / 9 |
| 0.11.0 flow form (claim, two peers, delivery, finish in the object), total | 632 |
| 0.10.2 flow form (claim and finish commands, peers called by the front), total | 648 |

Write confirmation is fast in every position, so it is not the cause. The two
flow forms tie because the probe's peer is tiny JavaScript, whose cold start is
free (0 to 2 ms of CPU).

Then the peer reported an isolate id and a request count:

| Caller of the peer | Calls | Distinct peer isolates | First request of an isolate |
| --- | ---: | ---: | ---: |
| Stateless front | 40 | 2 | 2 |
| Fresh object for each call | 40 | 39 | 39 |
| One reused object | 40 | 2 | 2 |

A placed callee does not keep a shared warm isolate for calls from fresh
objects. The probe sources, results and tails are in the private
`seams-monorepo/.artifacts/r155j-release-0110/gate-probe/`.

### Consequence

The fix is to make these calls from a stateless Worker again, as 0.10.2 did,
or otherwise from an isolate that stays warm. Keeping the claim inside the
object would keep its saving only if the role calls leave the object. The B half
of `18b09520` is not on this path: Deriver B's `prepare-pair` ends before
Deriver A's object does.

## Gateway steps

0.11.0 is the first release with Gateway step timing (`b948567b`). Medians / p90
(ms), 66 registrations:

| Route | Largest steps |
| --- | --- |
| Setup (browser 622) | `setup_context` 109 / 287, `setup_wallet_objects` 80 / 376, `setup_ceremony` 21 / 27, `setup_rate_limit` 15 / 26 |
| Respond (browser 1,496) | `yao_router_execution` 1,232 / 1,540, `yao_admission_bind` 36 / 168, `respond_authority_verify` 12 / 21 |
| Sign prepare (browser 307) | `ed25519_sign_proxy` 86 / 183, `ed25519_sign_admit` 38 / 55 |
| Sign (browser 307) | `ed25519_sign_proxy` 93 / 245, `ed25519_sign_admit` 15 / 28 |

`setup_context` is mostly the Console `registration-setup` call: Console wall
84 and 102 ms at the median in the two runs, up to 1,330 ms. The slowest registrations without the
passkey step were one `setup_wallet_objects` of 1,193 ms, one Router execution of
2,167 ms, and one `setup_context` of 969 ms.

## Files

The raw runs, tails, serving snapshots and scripts are in the private
`seams-monorepo/.artifacts/r155j-release-0110/` (`compare.py`,
`execute_timeline.py`, `setup_context.py`, `trace_timeline.py`) and use the kit in
`.artifacts/r155h-singapore-anchor/` (`steps.py`). `trace_timeline.py` links the
events of one registration.
