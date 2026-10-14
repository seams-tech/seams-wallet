# R155H — Release 0.10.1 on the Singapore staging lane

Date: October 14, 2026, 10:00 to 12:31 JST. Plan:
[refactor-155H.md](../refactor-155H.md). Numbers:
[refactor-155h-release-0101-staging.json](refactor-155h-release-0101-staging.json).

## Result

Release 0.10.1 serves on staging since 11:54 JST. A setup with a provided
wallet id that is not in the server-allocated format answers 200 with
`ed25519.status = after_proof`; 0.10.0 answered 500. The release changes no
code after setup, so it has no latency effect of its own.

The same morning found a cost outside this repository that is in every
staging figure of October 13 and 14. The private Console read every wallet
route of the environment for each registration, and the cost grew with each
wallet that the measurement runs added. With that scan removed, finalization
on 0.10.0 fell from 595 ms to 413 ms at the median, and registration after
the passkey step measured 1,383 ms.

| Run | Start, JST | Backend | After the passkey step, p50 | p90 | Finalize, p50 | Proof and execution, p50 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | 10:00 | 0.10.0, scan present | 1,513 ms | 2,090 ms | 595 ms | 783 ms |
| 2 | 11:20 | 0.10.0, scan removed | 1,383 ms | 1,884 ms | 413 ms | 867 ms |
| 3 | 11:55 | 0.10.1 | 1,725 ms | 2,276 ms | 511 ms | 1,055 ms |
| 4 | 12:07 | 0.10.1 | 1,796 ms | 2,284 ms | 529 ms | 1,100 ms |
| 5 | 12:21 | 0.10.1 | 1,626 ms | 2,313 ms | 501 ms | 912 ms |

Runs 3 to 5 are slower than run 2. The release is not the cause; see
"Waits that changed during the morning".

## Method

Same method as the [0.10.0 record](refactor-155h-release-0100-staging.md):
a laptop in Tokyo, Chromium with a virtual authenticator, a fresh NEAR
implicit registration and a first NEP-413 signature for each wallet, 99
wallets in each run, the test site of the 0.10.0 SDK. Every request of the
five runs entered Cloudflare in Tokyo. The stage times come from the SDK's
timing events; the Worker times come from tails of the same runs.

## The Console cost in the earlier records

Route publication in the private Console joined the ten route locators of a
registration with the route table. The database has no planner statistics,
so SQLite searched the table with the scope columns only: 171,070 rows read
for each registration when the table held 15,910 routes. The call sits
inside finalization.

| Run, JST | Median route publication call |
| --- | ---: |
| October 13, 03:28 (0.9.3 record) | 38 ms |
| October 13, 16:06 (0.9.4 record, baseline) | 95 ms |
| October 13, 23:42 (0.10.0 record, 0.9.4 arm) | 151 ms |
| October 14, 00:25 and 00:35 (0.10.0 record, 0.10.0 arm) | 167 and 185 ms |
| October 14, 10:00 (run 1) | 261 ms |
| October 14, 11:20 (run 2, corrected) | 90 ms |

The database runs one statement at a time, so the scan also delayed the
other Console calls of registrations that ran at the same time. Each record
compares two arms of one hour, so its differences stand: the two arms
carried nearly the same cost. The absolute figures of those records include
the cost, and it grew from one record to the next.

The correction makes each lookup use the full primary key. A second, smaller
scan of the same kind sat in an insert trigger of the Console and is
corrected too.

| Console statement, for each execution | Rows read before | After | SQL time before | After |
| --- | ---: | ---: | ---: | ---: |
| Insert of the routes | 171,070 | 41 | 172 ms | 1.5 ms |
| Verification of the routes | 15,491 | 30 | 36 ms | 0.3 ms |
| Reservation of the wallet home | 1,571 | 17 | 5.8 ms | 0.9 ms |

The Gateway and custody databases of this repository were checked the same
way. No statement reads more than 600 rows.

## Waits that changed during the morning

| Median | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Deriver A, write batch at registration | 9 ms | 62 ms | 56 ms | 58 ms | 57 ms |
| Deriver B, write batch at registration | 51 ms | 55 ms | 56 ms | 57 ms | 57 ms |
| Deriver B, read of the admission | 13 ms | 14 ms | 15 ms | 16 ms | 16 ms |
| Deriver A, execute work, wall | 372 ms | 466 ms | 628 ms | 701 ms | 498 ms |
| Deriver A, execute work, CPU | 163 ms | 178 ms | 173 ms | 178 ms | 184 ms |
| Deriver A, preparation, wall | 438 ms | 499 ms | 645 ms | 677 ms | 510 ms |
| Pair connections made inside the execution | 13 of 99 | 23 of 99 | 48 of 99 | 55 of 99 | 20 of 99 |
| Console, one write call | 51 ms | 80 ms | 86 ms | 87 ms | 83 ms |

Two changes are measured.

- **Slow write confirmation on Cloudflare's side, now ended.** Between runs
  1 and 2 the write batch of Deriver A's database went from 9 ms to about
  57 ms. That is before the 0.10.1 deployment. Deriver B's write batch was
  already at 51 ms in run 1. Reads stayed at 13 to 16 ms, SQL time at
  0.2 ms, both primaries in Singapore, and every custody object ran in
  Singapore. The Console database shows the same kind of step: one write
  call took about 20 ms on October 13 and 80 ms or more from run 2. At
  13:23 JST both Deriver write batches were back at 10 and 12 ms (6
  registrations) with no change on our side, and the Console database had
  moved to a fresh database with 21 ms write calls. Cloudflare's status
  page lists no incident for D1, Durable Objects or Singapore since
  October 12.
- **Wait directly after a deployment, cause not established.** Runs 3 and
  4 started 8 and 20 minutes
  after the deployment of all 14 Workers. Deriver A's preparation and
  execution each waited 150 to 230 ms longer than in run 2, with the same
  CPU time and the same database time. The preparation then ended after the
  passkey step in half of the registrations, so the execution waited for the
  pair connection. In run 5, 32 minutes after the deployment, both values
  were back at the level of run 2.

The passkey step of the virtual authenticator takes about 410 ms. A person
takes longer, so a preparation that is 150 ms late costs a real user less
than it costs this measurement.

The 90th percentiles of run 5 are not a clean measure: from 12:20 another
session measured write times on the Console database, and two Console calls
of that run have 90th percentiles of 471 and 590 ms against 103 and 104 ms
in run 2.

## Verification

- All 495 signatures of the five runs verify with an independent Ed25519
  check over an independent NEP-413 encoding. The 495 keys are distinct.
- All 14 staging Workers serve one version each, the latest upload of each.
- A setup with the provided wallet id `canary-<uuid>` answers 200 with
  `ed25519.status = after_proof`. A server-allocated setup answers 200 with
  `described`.

## Deployment record

Public `main` `c2589335` (pull request 40), publish run `38496003374`,
ended 11:13 JST; npm showed both packages at 11:21. Private `dev`: the
Console route correction `28f6e43e`, the pins `617770a8`, the Console
migration `de8d6626`, and `17c8a1a8`, which moves the staging backend
workflow from an artifact to a run cache after backend run `38502043490`
failed at a full artifact quota. Console runs `38500163964`, `38501430480`
and `38501744176`; backend run `38502490077`; activation run `38503380240`
passed at 11:54 JST. The staging frontends were deployed at 09:21 JST.

An earlier version of the waits table showed medians over all database
logs of a role. They mixed reads and zero-time entries with the write
batches, and showed Deriver B as unchanged.

## Open

- The write confirmation time of a database is outside this repository's
  code. Its cost falls with the number of serial write batches: one in each
  Deriver for each registration, and two Console write calls inside
  finalization.
- The wait directly after a deployment is not explained.
