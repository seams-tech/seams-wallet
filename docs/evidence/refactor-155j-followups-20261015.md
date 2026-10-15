# R155J — Follow-ups of October 15, 2026

Plan: [R155J](../refactor-R155J-p99.md). Method:
[debugging method](../debugging-method.md). The acceptance record that
started these items: [refactor-155j-acceptance-0102.md](refactor-155j-acceptance-0102.md).

## Result

- **The execution-before-preparation race reproduces inside both Derivers.**
  With `bc2328c3` the execution binds to the setup preparation and the
  registration passes. Without its second look, the Deriver fails with the
  staging error, and the registration fails about 11 s later; `e311a6f6`
  alone does not save it.
- **The Gateway now reports the steps that the tail cases could not
  attribute** (`b948567b`): setup, respond before the Yao execution, and
  each stage of Ed25519 signing. No staging data exists yet.
- **Registration is slow tonight because Deriver A's preparation waits.** A
  continuous control of 33 wallets at 00:30 JST, served in Tokyo, gave
  2,744 ms at p50 and 8,099 ms at p95 after the passkey step, against 1,619
  and 3,025 ms in the acceptance run. Nine of 33 Deriver A preparations
  waited more than 3 s (0 of 204 in the acceptance run), with no change to
  Deriver A and a nearly idle database.
- **Evening serving from the United States fits Cloudflare's load shedding
  of Free-plan traffic** (inferred). Our hostnames were served from
  Portland or Seattle in 20 of 72 samples between 21:00 and 24:00 JST,
  after entering Cloudflare in Tokyo; Cloudflare's own hosts never were.
- **The hosted menu shows the delay notice live.** The check found that the
  notice kept the passkey prompt line; `ce5729fb` removes it. A mixed
  registration (ECDSA and NEAR) sends no delay notice at all.

## The race inside the Derivers

### Method

A temporary hook in `durable_object/registration_preparation.rs`, which both
Derivers use, forced one order that agrees with the failed staging attempt.
It was never committed; the patch is kept in the ignored folder
`.artifacts/r155d/race-evidence/race-hook.patch`, and the control in `race-control.patch`.

- The setup preparation waits, at the start of `admit`, until an execution
  of the same object has checked its access (at most 20 s).
- An execution that finds no preparation and so admits fresh waits until the
  preparation is admitted (at most 20 s). Then it makes its own admission.

So the preparation's root-use admission ends before the execution's own
admission starts. The staging record shows only that the preparation
admitted first; it does not show whether the two admissions overlapped. In
an overlap, the second look finds the preparation not yet admitted and
waits in `access_for_execution`; this run did not exercise that wait.

The case was the contract case "NEAR registration and signing expose
gateway step timings": one Ed25519-only passkey registration and one
signature. The tree was `dev` at `774cc1d7` with the uncommitted changes
that became `b948567b`, `efd1a3cc` and `ce5729fb`; the Worker sources were
`774cc1d7` plus the hook. Release Worker builds
(`ROUTER_AB_WORKER_BUILD_PROFILE=release`), local stack, Worker logs in the
case log. For the control run, the guard of the second look in
`load_for_execution` became `if admitted_fresh && false`.

### Facts

| Run | Deriver logs, A and B | Gateway requests | Outcome |
| --- | --- | --- | --- |
| With the second look (`bc2328c3`) | Execution fresh; preparation held 174 and 183 ms; execution conflicted, looked again, bound to the preparation, loaded the share | setup 200, respond 200 with the execution inside it, near-provisioning 200, sign/prepare 200, sign 200 | Passed |
| Second look disabled | Execution fresh; preparation held 163 and 170 ms; both loads failed with `ConflictingPair: this tenant-root operation was admitted here under a different binding` | setup 200, respond 200 (`admitted`, in the browser trace), execute 409 `execution_in_progress` 12 times over 10 s, then execute 503 `execution_failed`, "Router Yao execution is retryable", 11 s after respond | Failed |

Inside Deriver A, the control run fails as the staging attempt did: a
fresh admission loses to the setup preparation, respond answers
`admitted`, and the Router holds its claim. Both Derivers raced here
because the hook is shared; on staging only Deriver A started late. Deriver
B's failure in the control run took another path (an uncaught exception,
then a Signing Worker 400, "Yao ceremony ended without packages").

The client sees a different end than on staging. With `e311a6f6` the SDK
waits out the claim instead of failing on the first 409. The run that then
takes over the lapsed claim reads Deriver A's pair state. Deriver A failed
before it wrote a pair record, and a missing or running record gives a
recoverable `ServiceUnavailable`, which the Gateway answers as 503
`execution_failed` (`router_coordinator.rs`, the takeover read). The SDK
retries only `execution_in_progress`, so it stops. The takeover runs the
execution again only when Deriver A holds a prepared record, so a longer
SDK wait would also fail. Only the Deriver change keeps the registration
alive.

### What this does not show

The hook decides the order; it does not show how often a late object start
produces this order on staging. The staging rate stays 1 failure in 204
attempts on 0.10.2.

### Review

An independent reviewer received this record, the two case logs, the
browser trace and the patch, and tried to contradict it. Each objection was
checked against the data before the record changed:

- The first version counted 13 answers of 409; the logs and the trace show
  12, then the 503.
- The first version said the Router answered with the failed run's
  recorded failure. The Router records none; the takeover read of Deriver
  A's missing pair record gives the answer.
- The first version said the hook forced the staging order and that the
  control run followed the staging attempt step by step. The hook forces
  one order that agrees with it, both Derivers raced, and Deriver B failed
  on another path.
- The first version named the tree as `774cc1d7` only and did not record
  the control change.

A second reviewer checked the sections on slow preparations, the idle
series and the evening serving. The first versions of those sections said
that cold role isolates explain the first-wallet times (the allocate CPU is
too small and occurs in most wallets), took the serving location from a
separate curl instead of the wallets' requests, called the acceptance
group maxima of 579 and 703 ms the first reads, counted one prewarm per
minute, and stated the Traffic Manager cause as a fact. Each point was
checked against the tails before the text changed, and the control batch
was added.

## Slow Deriver A preparations tonight, and the first registration after idle

### Method

R155J step 2 asks for an earlier start of the custody objects and role
Workers. Before any change, a read-only series measured the first
registration after idle. On staging 0.10.2, one warm-up group ran after
several hours without registration traffic from these scripts, then one
group of three fresh wallets after 5, 10, 20 and 40 minutes without traffic
(the 80-minute group was stopped for the control below). Tails start with
each group, so other traffic before a group is not observed. Then a
continuous control of 33 wallets ran at 00:30 JST on October 16. Only the
staging Console had a newer version than the acceptance run (`1b9dbae7`,
deployed by another session). Scripts and tails:
`seams-monorepo/.artifacts/r155j-idle-gaps/`.

### Facts

| After the passkey step | Wallets | p50 | p90 | p95 |
| --- | ---: | ---: | ---: | ---: |
| Acceptance, October 15, 00:00 to 01:41 | 203 | 1,619 ms | 2,563 ms | 3,025 ms |
| Control, October 16, 00:30, all served in Tokyo | 33 | 2,744 ms | 7,734 ms | 8,099 ms |

| Deriver A preparation event (wall) | Events | Median | Over 1 s | Over 3 s | Largest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Acceptance group 1 | 102 | 629 ms | 10 | 0 | 2,950 ms |
| Acceptance group 2 | 102 | 513 ms | 2 | 0 | 1,460 ms |
| Control | 33 | 709 ms | 11 | 9 | 8,629 ms |

- **The control is slow because of Deriver A's preparation.** The slowest
  responds spent 4.0 to 8.4 s in the Router's role execution (median
  1.1 s). In the same minutes, Deriver A's preparation events lasted up to
  8.6 s with at most 0.5 s of CPU, and Deriver B's connection to Deriver A
  waited up to 16.9 s. Deriver B's own preparations stayed below 3 s.
- **The databases do not explain it.** Both role databases are in APAC,
  equal in size, without read replication, and nearly idle (a few hundred
  statements per hour). D1 reports the role-share read at 0.36 ms on
  average over 285 runs in the three hours to 00:40, 103 ms in total, so no
  single execution of it took longer than 103 ms. The Workers that another
  session ran in this period have no database bindings.
- **The idle series.** Without the passkey step, the first wallet took
  13,069 ms after several hours (served in Tokyo), then 6,472 (Osaka), 5,272
  (Portland), 5,085 (Tokyo) and 4,855 ms (Tokyo) after 5, 10, 20 and 40
  minutes. The only same-location pairs, at 20 and 40 minutes, compare with
  3,104 and 2,671 ms for the third wallet. The second wallets took 4.4 to
  5.0 s, so the third wallet is not a warm baseline.
- **The 8.7 s case.** In the warm-up group, Deriver A's preparation event
  lasted 8,717 ms with 439 ms of CPU, and its callers waited as long (8,834
  and 9,070 ms). Its log gives 8,696 ms to `initial_read_and_open`, one D1
  read and a CPU-only decryption. That figure depends on an assumption: an
  object's clock moves only at I/O or with concurrent timers, and in 13 of
  the 15 Deriver A preparations of the idle series it shows 0 ms for the
  read and for a batch with a write. If the clock is shared by the requests of the same object, at
  least 8.0 s fall inside the read section.
- **Cold isolates are frequent but small.** A warm `wallet/allocate` uses 0
  to 6 ms of CPU. Values of 56 to 232 ms occurred on at least one role in
  12 of the 15 idle-series wallets, not only the first, and in 13 to 17% of
  the Deriver allocates of the continuous acceptance run, also late in a
  group. They are too small to explain the first-wallet differences of 1.5
  to 3.2 s. Almost every Deriver protocol run is the first in its isolate
  (`execution_index` 0 in 30 of 30 here, about 95% in the acceptance run).
- **The prewarm.** The staging Gateway configurations carry a minute cron
  with `ROUTER_AB_PREWARM_ENABLED`, and the Router received about four
  prewarms per minute in the acceptance tails; it calls the prewarm of both Derivers and the Signing Worker, and
  Deriver A objects also prewarm Deriver B. The prewarm reads no database.

### What this means

- **Inferred:** tonight's slow registrations come from a wait inside Deriver
  A's registration preparation that our code, our database load and the
  serving location do not explain. Deriver A's code and version are the same
  as in the acceptance run, where such waits were rare. The wait is either
  in reaching the database or in the object's host; the instruments cannot
  separate these.
- **Not shown:** that the first registration after idle has a cause of its
  own. Tonight's idle series ran during the same condition as the control.
- For step 2, a warm-up does not address this wait. The next measurement is
  a Deriver A preparation span with an explicit timer around the database
  read, so that its clock moves (as in the race hook above), on a quiet and
  a slow evening.

## Durable writes tonight, and where the tail sits

### Facts

- **Writes were slower across services, without new work.** At 00:30 JST
  the staging Console's write calls took about three times longer than in
  the acceptance run (`claim-passkey` 22–24 → 58–62 ms, `publish-routes`
  26–28 → 72–78 ms, `complete` 26–28 → 70–76 ms), while its read
  (`tenant-root/active-lineage`) stayed at 18–22 ms. The Console database
  (`seams-console-sin-candidate-20261014`, primary in Singapore, bound by
  both the old and the new Console version) received about 7 writes per
  wallet in both runs, and its batch time stayed at 2.2–2.8 ms at p90.
  Finalize's server total grew from 199 to 319–421 ms, with each durable
  step about twice as long.
- **The Deriver A waits are on the database path.** Both Deriver role
  databases have Singapore primaries. Deriver A's database receives about 60
  reads an hour without traffic, so it is never idle, and its batch time
  stayed at 1.1–1.5 ms at p90 tonight. In the slow preparations the D1 call
  started at the preparation's start, before the execution arrived; in one,
  the read returned in 67 ms after the object's own writes and the next D1
  write batch took 6.3 s.
- **Schema statements are not a cost.** A probe object (approved probe
  name, deleted afterwards) answered a pure read in 10–11 ms at the median
  and a read after `CREATE TABLE IF NOT EXISTS` in 10–11 ms, against 19–20 ms
  for one insert. SQLite and workerd treat the schema statement as a write,
  but the production storage confirms the empty commit without a wait.

| Slowest 10% after the passkey step, excess over the median | respond | role execution in respond | pair preparation in respond | finalize |
| --- | ---: | ---: | ---: | ---: |
| Acceptance, 203 wallets | +1,242 ms | +564 ms | +248 ms | +326 ms |
| Two 0.10.2 runs on October 14, 198 wallets | +627 ms | +278 ms | +192 ms | +222 ms |
| Best run, October 14 13:30, 99 wallets | +334 ms | +219 ms | +20 ms | +149 ms |

### What this means

- **Inferred:** the variance of registration time comes mostly from the
  latency of durable writes and D1 round trips on Cloudflare in Singapore,
  which changes by the hour and by database and sometimes stalls for
  seconds. Our code cannot shorten one write; it can only reduce the writes
  in series after the passkey step or move them into the prompt.
- Respond carries most of the tail. About 430 ms of respond's tail excess in
  the acceptance run lies outside the Router's role work; `b948567b` times
  that part once it is deployed.
- Finalize already runs its independent writes together; about four durable
  stages remain in series.

## Evening serving outside Japan

### Method

From 00:31 JST on October 15, every 5 minutes, this machine in Tokyo read
`/cdn-cgi/trace` of two hostnames of our `seams.sh` zone
(`staging.api.wallet.seams.sh`, `wallet.seams.sh`) and of two Cloudflare
hosts (`www.cloudflare.com`, `1.1.1.1`). When the staging hostname was
served outside Japan, it ran a traceroute, at most once an hour. There are
no samples from 10:43 to 13:15 except one, empty samples from 13:15 to
17:00 (no network), and none until 18:51. Files:
`seams-monorepo/.artifacts/entry-routing-probe/`.

### Facts

| Hosts | Samples served outside Japan | When |
| --- | --- | --- |
| Our two hostnames | 20 of 378 (Portland 15, Seattle 5) | Only from 21:07 to 23:12 JST in the sampled hours: 20 of the 72 samples from 21:00 to 24:00 |
| `www.cloudflare.com`, `1.1.1.1` | 0 of 378 | Never |

- The two traceroutes, at 21:12 and 22:32, reached Cloudflare's network at
  hop 6 on the Tokyo exchange JPNAP, and hops 7 and 8 answered in 10 to
  24 ms. At those minutes the hostname was served in Portland. So the
  connection entered Cloudflare in Tokyo and was served in the United
  States.
- Cloudflare's post "How Cloudflare's systems dynamically route traffic
  across the globe" (September 25, 2023), on Traffic Manager, says "We move
  Free customers first", from the lowest priority plan to the highest; its
  example moves all Free and Pro traffic, half of Business and none of
  Enterprise. Plurimog forwards a connection at layer 4 after it arrives.
  Our zone is on the Free website plan.
- The post orders destinations by latency from the overloaded data center;
  it does not explain why Portland or Seattle served instead of a nearer
  site.
- The same evening pattern was seen on October 13 (about 21:30 to 23:30)
  and on October 14 (about 80% of the requests after the passkey step,
  during the 0.10.2 runs).

### What this means

- **Inferred:** in the Tokyo evening peak, Cloudflare moves part of our
  zone's traffic to the United States, by the load shedding that the post
  describes. The reference hosts are Cloudflare's own, on other address
  ranges, so the data cannot separate "Free plan" from "this address pool".
- **Decision for the owner:** the zone plan. A Pro or Business plan is
  untested here; in the post's example both still move. Measurements of
  browser totals should note the serving location, or run outside 21:00 to
  24:00 JST.

## Gateway step timing

`b948567b` adds these `Server-Timing` entries. The Gateway request evidence
of the hosted test now keeps the raw header, so a staging run records them.

| Route | New entries |
| --- | --- |
| `/wallets/register/setup` | `setup_context`, `setup_route_policy`, `setup_rate_limit`, `setup_dispatch`, `setup_reserve`, `setup_ceremony`, `setup_wallet_objects`, `setup_pair_describe` |
| `/wallets/register/respond` (Ed25519-only) | `respond_authority_verify`, `yao_admission_request`, `yao_admission_bind`, `respond_ceremony_commit` (only when respond writes the ceremony) |
| `/router-ab/ed25519/sign/prepare` and `/router-ab/ed25519/sign` | `ed25519_sign_authorize`, `ed25519_sign_admit`, `ed25519_sign_proxy`, `ed25519_sign_complete`, `ed25519_sign_total` |

One local run of the contract case, without the race hook, for scale only
(milliseconds):

| Route | Values |
| --- | --- |
| setup | context 0, route policy 1, rate limit 1, dispatch 0, reserve 3, ceremony 3, wallet objects 9, pair describe 0 |
| respond | load 2, passkey verification 3, admission request 0, admission binding 3, Router execution 180 |
| sign/prepare | authorize 4, admit 11, proxy 28, total 44 |
| sign | authorize 1, admit 1, proxy 19, complete 1, total 22 |

Worker clocks do not move during CPU work, so each entry is a wait, not a
CPU cost. A staging setup that is forwarded to another region's Gateway
returns that Gateway's entries only.

## Hosted menu delay notice

### Method

A temporary case opened the hosted menu of the intended test app, chose
"Create a wallet" and "Create wallet with passkey", and held the browser's
`respond` request for 6.5 s. The test app lists Tempo and Arc, so its menu
registers a mixed wallet; for this check only, its chain list was reduced to
NEAR.

### Facts

- The headline "Taking longer than usual... waiting on the network…"
  appeared 5,858 ms after the hold started. The menu closed when the
  registration completed, 7,766 ms after.
- Before `ce5729fb`, the busy view kept its passkey picture and the line
  "Complete the prompt on your device." under the headline, although the
  prompt had finished before respond was sent. After the change, the view
  shows the headline and a spinner.
- With the full chain list, the same menu registered a mixed wallet, and no
  notice appeared during the same hold. The SDK sends the delay event only
  from the Ed25519-only registration path.
- In this case, the harness's virtual authenticator refused the menu's
  passkey creation with "Resident credentials or empty 'allowCredentials'
  lists are not supported at this time." A second authenticator added on a
  new browser session accepted it. The SDK registration path, with the same
  creation options, passes on the harness's authenticator. The cause is not
  investigated.

## Account-menu contract case

The case "account menu removes an added passkey through the wallet email
prompt and preserves signing" failed after `38a01fec`, which moved linked
devices to an embedded screen. Classification: valid test needing an update.
`efd1a3cc` follows the new screens and passes. The same commit removes an
unused import of `38a01fec` that failed the intended type check.
