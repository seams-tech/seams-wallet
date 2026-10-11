# R155F — Reduce NEAR registration round trips

Status: **in progress.** The latest wallet/session transaction change is implemented
and measured. Each phase below retains its earlier evidence.
Date: October 11, 2026.

The [hosted transaction comparison](evidence/refactor-155f-wallet-session-hosted.md)
verifies **13 → 12 finalization D1 calls** and **37 → 36 registration calls** across
Gateway and Console. The first signature adds seven calls. These counts exclude
custody-role databases and pending background calls.

NEAR-only registration measures **3.839 s median (3.754–4.627 s)**. The first
signature measures **0.988 s median**; the combined flow measures **4.854 s**.
Finalization measures **1.167 s**, against the repeated control's **1.240 s**.
Unchanged stages also varied. The full registration difference cannot be attributed
to this transaction, and the four-second maximum remains unmet. All nine signatures,
all 18 comparison checks, and independent restoration checks pass. Staging is restored.

Public `2b0e427d` combines wallet, capability, initial-session, and completion-decision
persistence. Its [local evidence](evidence/refactor-155f-wallet-session-transaction.md)
covers rollback, concurrent exact retry, lost completion replies, and foreign-region
signing. Earlier changes overlap independent reads and sealing, remove the extra
home read, and batch Console lineage, passkey-claim, and setup work. Their measurements
remain in the phase records and linked evidence below.

Next: combine finalization's initial home, retry-record, and ceremony reads. Keep
completed retries usable after ceremony cleanup. Moving the passkey claim earlier
needs the cancellation review recorded in Phase 4.

## Objective and ownership

Reduce NEAR-only registration latency by removing repeated reads, separate write
batches, and unnecessary service exchanges. Measure the time each change removes
from the critical path: the work that must finish before the user can continue.

Registration followed by an independently verified NEP-413 signature must reach
the existing **3–4 second target**, with **1–2 seconds preferred**. Report
registration alone as the primary metric. Report first-signature latency separately.
Exclude user interaction, test automation, funding, and blockchain confirmation
from those SDK metrics. Also retain the inclusive timings.

[R155D](refactor-155D-registration-critical-path.md) records the completed changes,
earlier experiments, database cutover, and existing recovery defect. This plan owns
the next four optimization areas below. Coordinate with the R155D implementer
before changing shared files. Do not repeat work already completed there.

[R155B](refactor-155B.md) defines regional execution and Console responsibilities.
[R155C](refactor-155C-yao-peer-connection.md) defines concurrent A/B execution.
One trusted organisation operates both Derivers. Preserve their secret separation
and authenticated transport. This plan adds no peer signatures or handshake.

## Measured starting point

The October 10 [hosted comparison](evidence/refactor-155d-allocation-hosted.md)
used three fresh wallets per arm: baseline, candidate, then the repeated baseline.
The client ran in Tokyo. Each wallet used its APAC home and an implicit NEAR account.

| Candidate workload | Median | Range |
| --- | ---: | ---: |
| Registration, excluding user interaction | 4.354 s | 3.782–4.716 s |
| First signature, excluding confirmation | 0.899 s | 0.669–1.141 s |
| Registration through first signature, excluding interaction | 5.253 s | 4.450–5.858 s |
| SDK finalization | 1.116 s | See the linked trace |
| Gateway finalization service | 0.796 s | 0.762–1.123 s |
| SDK custody execution | 1.674 s | See the linked trace |
| Router Yao execution | 1.324 s | 1.324–1.817 s |

The repeated baseline registered in **4.227 s** and reached its first signature
in **4.970 s**, using the same exclusions. These samples establish fewer calls.
They do not establish an overall latency improvement from the candidate bundle.
Do not add stage medians or overlapping spans to reconstruct elapsed time.

| Registration stage | Completed D1 round trips |
| --- | ---: |
| Gateway setup | 5 |
| Gateway respond | 6 |
| Gateway Yao execution entry | 2 |
| Gateway finalization | 15 |
| Console across registration | 14 |
| **Registration total** | **42** |
| First signature, additional Gateway calls | **7** |

A round trip is one D1 API call. A batch can execute several SQL statements.
These counts exclude custody-role databases and calls unfinished when the response
was recorded. Setup and finalization each had one pending background call.
The total through the first signature was **49 completed Gateway/Console calls**.

Console's 14 calls came from five HTTP requests:

| Console operation | D1 calls | Observed work |
| --- | ---: | --- |
| Registration setup | 5 | Deployment admission, API key read/update, environment read, home reservation |
| Active root lineage | 2 | Creation grant and restore-state reads |
| Passkey claim | 3 | Deployment admission, claim insert, owner read-back |
| Route publication | 2 | Deployment admission and route batch |
| Registration completion | 2 | Deployment admission and completion batch |

The [machine-readable trace](evidence/refactor-155d-allocation-hosted.json)
records query identities, timings, request counts, and component versions.

### Changes that already exist

- Stored unique wallet-object IDs, setup-time startup, concurrent A/B execution,
  and removal of NEAR registration's session-status request are implemented.
- Session issuance already commits its completion decision. Activation already
  commits with journal completion. Router consumption overlaps ownership claims.
- Commit `67f31336` combines wallet and capability persistence. That step uses
  two D1 calls instead of three in local verification. Hosted savings remain
  unmeasured. The **42-call measurement predates this change**.
- The three staging custody databases now use replacements with HKG primaries.
  R155D records successful tenant activation and updated deployment variables.
  Nine wallets registered and signed through the new role databases on October 11.
  Earlier saved Worker versions bind the old, deleted databases.

Use these changes in the new baseline. Do not report their savings again as R155F
improvements. See the [capability evidence](evidence/refactor-155d-capability-persistence.md)
and R155D's [cutover record](refactor-155D-registration-critical-path.md#startup-and-role-databases).

## Implementation inventory

Paths below are relative to the named repository. Inspect their current versions
before editing because registration work continues concurrently.

| Area | Repository and entry files |
| --- | --- |
| Finalization and wallet transaction | Public: `packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationService.ts`, `d1WalletRegistrationCommitStore.ts`, `walletRegistrationEstablishedSessionIssuer.ts`, `d1WalletExecutionAuthority.ts` |
| Yao state and completion | Public: `packages/wallet-server/src/router/cloudflare/d1/ed25519Yao/d1Ed25519YaoProductRegistrationPartitionedStateStore.ts` and the registration boundary under `router/domains/ed25519Yao/registration/` |
| Gateway admission and routing | Private: `packages/wallet-console-server-ts/src/tenantDeployment/regionalAdmission.ts`, `walletPlacement/regionalDispatch.ts`, `walletPlacement/localSessionRouting.ts` |
| Console operations | Private: `packages/wallet-console-server-ts/src/walletPlacement/registrationSetup.ts`, `passkeyClaims.ts`, `walletRouteLocators.ts`, `sessionLocators.ts`, `d1.ts`, `service.ts`, `serviceClient.ts` |
| Root lineage | Private: `packages/wallet-console-server-ts/src/tenantRootSecurity/activeLineageD1.ts` and `tenantRootCreation/d1.ts` |
| SDK and registration routes | Public: `packages/wallet/src/SeamsWeb/operations/registration/registration.ts`, `registrationTiming.ts`, and `packages/wallet-server/src/router/domains/walletRegistration/walletRegistrationRoutes.ts` |
| Custody execution | Public: `crates/router-ab-cloudflare/src/router_coordinator.rs`, wallet objects under `durable_object/`, and the existing Deriver completion spans |

## Phase 1 — Consolidate finalization and Gateway reads

- [ ] Trace one fresh registration and one exact retry on the current combined
  source. Label every database call with its state dependency and transaction owner.
  Reuse existing trace tools. Do not create another instrumentation framework.
- [ ] Combine finalization's initial routing, ownership-generation, Yao-state,
  and ceremony reads where they share one database and admission boundary.
  The hosted path used four calls for these initial loads.
- [ ] Carry the validated request state into core functions. Remove repeated
  reads only when no intervening mutation requires a fresh value.
- [ ] Move deployment predicates into the first required transaction where
  possible. Preserve immediate deployment retirement and wallet relocation fences.
- [ ] Identify remaining wallet, custody, session, and journal write dependencies.
  Combine compatible writes through existing transaction builders.
  Keep separate commits where a remote result must occur between them.
  The October 11 Console comparison records **119 ms** for the candidate's wallet
  commit and **131 ms** for its following session commit, at the median.
  The implementation below combines them. Console completion remains between session persistence and the final
  activation/receipt transaction.
- [x] Commit the fresh NEAR wallet, capability, and initial session in one batch.
  Preserve ownership, capability version checks, session uniqueness, and exact
  retry. Verify rollback when session persistence fails and preserve the winning
  credential and quota on concurrent retries. Local composed finalization uses
  11 calls, down from 12. Hosted finalization uses 12 calls, down from 13.
  [Implementation](evidence/refactor-155f-wallet-session-transaction.md) and
  [hosted evidence](evidence/refactor-155f-wallet-session-hosted.md).
- [ ] Inspect setup and respond for the same repeated reads. Read the current
  fresh-admission path before changing it because R155D already removed an absent-record read.
- [ ] Record a justified round-trip budget for fresh registration and exact retry.
  List each unavoidable serial dependency. R155D's **4–6 finalization calls** remain
  an investigation target, not an established minimum or a promised result.
- [x] Start session sealing after the session commit, beside home publication.
  Keep the result local to the request until finalization succeeds. Verify failed
  publication, exact retry, and recovery from a failed seal.
- [x] Return the committed registration home state from session issuance.
  Remove publication's extra home read and its duplicate decision-write path.
  Verify that Console completion starts before sealing uses the Worker CPU.
- [x] Overlap initial home admission and the operation-journal read. Settle both
  before preparing or writing. Keep ceremony loading lazy for completed retries.
  Reconcile a lost claim with a fresh journal read.

Acceptance: remove the demonstrated duplicate reads or commits, preserve exact
replay, and record the remaining dependency graph. Remove the replaced helpers.
Do not add another registration state machine or transaction abstraction.

### Phase 1 record

The hosted finalization of October 11 made 14 completed D1 calls. Every call
also carries the Gateway's deployment write check as one more statement.

| # | Call | Owner | Needs |
| ---: | --- | --- | --- |
| 1 | Admission and routing read | Gateway regional admission | The request |
| 2 | Home generation read | Registration home authority | Verified setup claims |
| 3 | Journal read | Operation journal | Verified ceremony and idempotency key |
| 4 | Ceremony read | Ceremony store | A journal miss |
| 5 | Journal prepared write | Operation journal | Ceremony identity |
| 6 | Yao lifecycle read | Yao registration runtime | Activation reference |
| — | Router consume, credential claim, route claim | Router and Console | Call 5 |
| 7 | Lifecycle decision read | Decision store | Lifecycle id |
| 8 | Authority and method read | Wallet auth methods | Ceremony authority |
| 9 | Yao record read | Yao state store | Lifecycle id |
| 10 | Wallet commit | Wallet commit store | Consume result and credential claim |
| 11 | Custody records write | Custody commit store | Call 10 and the route claim |
| 12 | Session authorization write | Authorization service | Call 10 |
| 13 | Home generation read | Registration home authority | Call 12 |
| — | Console completion | Console | Call 12 |
| 14 | Journal completion and home activation | Operation journal | Console acknowledgement |

This table records the hosted baseline. Local commit `88ef6517` removes call 13
by returning its state from call 12's existing transaction. See the
[committed-home record](evidence/refactor-155f-session-seal-overlap.md#completion-dispatch-without-a-second-home-read).
The local browser trace records 12 finalization calls. It excludes the hosted
Gateway's separate admission read. The later
[hosted comparison](evidence/refactor-155f-home-publication-hosted.md) verifies
**13 finalization calls** in each of its three candidate samples.

Commit `edc7d5f9` removes two waits from this chain. The wallet commit no longer
waits for the route claim, because the claim cannot fail a registration. The
custody records are stored beside the session issuance, because neither needs
the other. A finalization that fails still settles its started route claim
before it responds. The call count stays at 14. On staging the Gateway
finalization service measured 908 ms (814–1,170) before and 780 ms (741–843)
after, with three wallets each and no repeated baseline.
In the three candidate samples of October 11 the route claim outlasted the other
two concurrent calls by 0–403 ms, and the custody write took 68–73 ms.

Remaining serial dependencies, with the hosted durations of October 11:

- Calls 1–5 run in sequence: 120–142 ms in two samples, and 411 ms in one with
  a slow read. Calls 2–4 are independent reads of three owners and can overlap.
- Calls 7–9 run in sequence after the concurrent calls: 57–77 ms. Each needs
  only an identifier that exists before the consume. Call 9 reads the record
  that call 6 loaded.
- The credential claim must precede call 10. Gateway observed 132–480 ms.
- Console completion must precede call 14. Gateway observed 131–413 ms.
- The Gateway used 265 ms of CPU time per finalization. Other registration
  requests used 19–36 ms. A Worker clock cannot place that time. A local CPU
  profile below identifies the main sampled computation.

Budget: one serial D1 step for admission, one for the initial loads, the
prepared write, the wallet commit, the session write and the completion write.
That is six serial steps against today's thirteen. The custody write and the
pre-commit reads can overlap other work. The two Console exchanges stay serial.

### Finalization read overlap and CPU profile — October 11

Two independent reads now overlap existing work:

1. The lifecycle-decision read starts beside Router consumption and the credential
   claim. Its result still determines whether this request can commit the wallet.
2. The founding-record read starts beside the capability read. Their results still
   enter one atomic wallet/capability transaction with the existing version check.

The change removes two serial dependencies. It does not remove D1 calls. Initial
home/journal/ceremony reads and the two serial Console exchanges remain open.
The existing retry bound, competing-writer handling, and transaction guards remain.

Six selected browser contracts pass, including lost finalization replies, recovery,
session publication, and mixed registration. The real D1 scenario delays the
founding-record read and verifies that the capability read proceeds. It also
verifies atomic rollback, exact retry, and preservation of another wallet's write.
Authorization transfer and wallet-state type fixtures pass.

The authorization scenario had a stale expectation of two attempts for an unchanged
capability. Commit `d51cfcd8` deliberately removed that write. The updated scenario
expects one attempt and still verifies concurrent-wallet and suspension preservation.
This was an obsolete assertion. The correction changes no production behavior.

Three local profiles isolate the finalization POST. `addSigningSessionSealLock`
accounts for **78.47–79.72% of sampled execution**, mainly modular arithmetic in
the Shamir WASM module. Each profiled registration also verifies exact replay and
its first signature. These percentages do not establish an absolute CPU duration
or the exact share of the hosted 265 ms observation.

The profile suggested overlapping the existing seal computation with registration's
network waits after its authority and inputs are established. The read-overlap
commit did not alter sealing. The next record describes that follow-up.

[Local verification and profile evidence](evidence/refactor-155f-finalization-local-profile.md)
records reproduction, sample counts, checksums, and limitations. Hosted latency
savings were unmeasured at that commit. The later hosted comparison below measures
the read and sealing overlaps together.

### Session sealing overlap — October 11

Finalization now starts server sealing after the Wallet Session commits. Home
publication starts first so its I/O can proceed while the Gateway computes the seal.
Both operations settle before finalization continues. The route returns the seal
only after the finalization receipt and home activation commit.

The request retains one computation, bound to its wallet, session and expiry.
Exact replay computes against the committed session through the same helper.
Resumed mixed registration uses its refreshed session projection before sealing.
A seal failure still permits the registration receipt to commit. Normal unlock
then recovers the session. No cipher, HTTP endpoint, database field or D1 call was added.

The composed scenario holds Console's completion reply until the real seal finishes.
It verifies one seal call, successful registration and signing through a foreign
Gateway during a Console outage. A second scenario verifies a lost completion reply.
The browser contracts also exercise a failed seal and mismatched session IDs.

This removes sealing as a separate stage after completion. It does not reduce the
CPU required by sealing. Synchronous WASM can delay JavaScript continuations, so
the earlier CPU profile does not imply an equal reduction in elapsed time.
`near_finalize_session_seal` now measures the remaining wait after service completion.
The earlier work is included in the session-issuance span. These spans overlap.

[Implementation and local evidence](evidence/refactor-155f-session-seal-overlap.md).
The following comparison measures the committed changes with real browser preflights.

### Initial home and journal read overlap — October 11

Public commit `a3dd064f` starts the home and journal reads together after request
authentication. Both must settle before preparation or writes. Home rejection
still takes precedence. The journal determines whether the ceremony must load;
completed receipts remain replayable after ceremony cleanup.

The journal runner receives the initial parsed record explicitly. A competing
writer still triggers a fresh read after a failed claim. No result is cached
across requests. D1 calls and SQL statements are unchanged by this overlap.

The real-D1 scenario completes a competing registration after the initial read.
The losing request returns the winner's exact result and publishes the home once.
Private commit `755e7be` holds the home-read reply until the journal read starts.
It verifies that registration makes no write before home admission settles.

All three composed browser scenarios pass: normal completion, lost completion
reply, and mixed-registration retry through another region during Console outage.
The normal proof records `journalStartedBeforeHomeReply: true` and verifies its
NEAR signature. The authorization-transfer D1 scenario, server build and type
check, wallet-state fixtures, and bloat check also pass.

Full batching of home, journal, and ceremony remains open. It needs coordinated
store changes; this commit removes one serial dependency through the existing
journal interface. The later comparison verifies concurrent starts in all three
hosted samples, without establishing an overall latency saving.

### Hosted home-publication and initial-read comparison — October 11

The comparison used public control `25425eff`, candidate `a3dd064f`, and private
composition `755e7be`. The SDK, custody versions, placement, and database bindings
stayed fixed. Each group registered three fresh NEAR-only wallets.

| Median workload | Control before | Candidate | Control after |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 5.064 s | **4.102 s** | 4.094 s |
| First signature, excluding confirmation | 0.998 s | **0.978 s** | 0.667 s |
| Registration plus first signature, excluding interaction | 6.062 s | **5.115 s** | 4.761 s |
| Finalization POST, browser timing | 1.420 s | **1.138 s** | 0.961 s |

Candidate registration ranged from **3.597 to 5.593 s**. Finalization ranged
from **0.993 to 1.280 s**. The repeated control removes the apparent registration
gain against the first group. The run establishes no clear overall speedup.
The four-second maximum target remains unmet. Keep the changes for their verified
removal of work and preservation of behavior.

Registration uses **38 completed Gateway/Console D1 calls**: 26 in Gateway and
12 in Console. The control uses 39. The Console lineage batch is fixed in both
groups; this run confirms its one-call lookup but cannot isolate its latency gain.
Signing adds seven Gateway D1 calls. HTTP counts remain six application POSTs,
six browser preflights, and five early `OPTIONS` requests per wallet.

All nine signatures passed independent verification. All 18 comparison checks
passed, including exact serving versions and one early object startup per wallet.
All 13 original Worker versions and both Deriver schemas were restored and checked.
Tenant activation on the restored deployment passed. No new infrastructure was created.
The [full record](evidence/refactor-155f-home-publication-hosted.md) contains the
ranges, local failure scenarios, observed ordering, and restoration status.

### Hosted read and sealing comparison — October 11

The comparison used public baseline `79a43a73`, candidate `25425eff`, and private
composition `3e47ba2`. One rebuilt SDK with early preflights was fixed in every
group. Custody versions, regional database bindings, placement, and client location
were also fixed. Each group registered three new NEAR-only wallets.

| Median workload | Baseline before | Candidate | Baseline after |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 4.346 s | **4.267 s** | 4.227 s |
| First signature, excluding confirmation | 0.724 s | **0.957 s** | 0.617 s |
| Registration plus first signature, excluding interaction | 5.070 s | **4.945 s** | 4.908 s |
| Complete finalization POST, browser timing | 1.234 s | **1.030 s** | 1.069 s |

The candidate registration range was **3.663–4.378 s**. Its combined range was
**4.620–5.423 s**. The **3–4 second maximum target remains unmet**. The candidate
was close to the repeated baseline overall, so this run establishes no clear
total-latency gain. Its first-signature median was higher than both baseline medians.
The run does not establish the cause of that difference.

All nine signatures passed independent Node.js verification. All 18 comparison
checks passed, including served-version checks and the repeated baseline's exact
version match. Hosted traces confirm the two read overlaps. Keep the changes for
that demonstrated ordering improvement, without assigning an unproven total saving.
All 13 original Worker versions and both Deriver schemas were restored and checked
independently. Tenant activation on the restored versions passed. No new resource
was created.

Counts stayed at **40 completed Gateway/Console D1 calls for registration** and
**seven more for signing**. Console receives five registration calls. Each wallet
sends six application POSTs, six browser preflights, and five explicit early
`OPTIONS` requests. Session-status calls remain zero. These HTTP categories are
separate; six application operations do not mean six HTTP requests.

The [full record](evidence/refactor-155f-finalization-overlap-hosted.md) contains
ranges, individual samples, SQL counts, regions, ordering evidence, and restoration
status. The earlier **3.530 s / 4.204 s** early-preflight result remains historical
evidence. It is not the control for attributing gains to these server changes.

## Phase 2 — Reduce Console calls and exchanges

- [x] Batch setup's deployment admission and exact environment read.
  Private `3db9b5d` uses one read-only D1 batch, then checks the writer and resources
  before authentication or reservation. Fresh setup uses four calls and five SQL
  statements. Retired writers and missing deployments stop after the first batch.
  [Implementation and evidence](evidence/refactor-155f-setup-batch.md).
  The [hosted comparison](evidence/refactor-155f-console-setup-hosted.md) confirms
  those counts in all three candidate samples. Console setup's summed D1 time
  measured 93 / 76 / 77 ms across control, candidate, and repeated control.
  The candidate removes a call; these samples establish no repeatable latency saving.
- [ ] Examine the remaining Console mutations for deployment checks that can
  join their existing transaction. The transaction must enforce the writer and
  retirement checks before a write. A batch of an unchecked read and write does
  not provide that guarantee.
- [x] Examine registration setup's API-key and environment operations.
  Batch independent reads and required writes. Classify the API-key update before
  moving it: authentication, quota, and usage-accounting semantics must remain explicit.
  `authenticatePublishableKey` in private `packages/console-server-ts/src/apiKeys/d1.ts`
  reads the credential, validates it, then awaits `recordApiKeyUse` before the public
  registration-context resolver loads the environment. For this call, the update
  records `last_used_at_ms` and `updated_at_ms`; endpoint counting is disabled.
  It consumes no signing budget or quota. Private `ba2aa5d` first overlapped the
  environment read with authentication. Private `3db9b5d` replaces that path
  with the deployment/environment batch above. The usage update remains awaited.
  The credential must match the deployment scope before reservation. The existing
  context builder validates the exact active environment. Production Console and
  three composed browser scenarios pass. The later hosted comparison is linked above.
  Keep the [overlap record](evidence/refactor-155f-setup-overlap.md) as historical
  evidence; do not add its expected saving to the replacement batch.
- [x] Combine the lineage reads if one query or batch preserves their meaning.
  Preserve the current restore and revocation checks.
  The October 11 local comparison confirms **two calls become one batch**.
  Both SQL reads remain. The production Console E2E covers a missing root,
  an active created root, and rejection of conflicting stored identity fields.
  The comparison also preserves duplicate-restore rejection.
  [Implementation and evidence](evidence/refactor-155f-console-lineage-batch.md).
  The later home-publication comparison confirms the one-call lookup on staging.
  Both groups include the batch, so it does not isolate its latency saving.
- [x] Replace passkey claiming's separate insert/read-back with one atomic batch
  that returns the winning owner. Preserve exact retry and competing-wallet refusal.
- [ ] Examine the three finalization Console requests together: passkey claim,
  route publication, and completion. Combine operations only when their required
  ordering and failure behavior fit. Measure whether the removed exchange was serial.
  Source review confirms that passkey claiming and route publication already
  overlap. Combining them could remove a deployment read and HTTP request, but
  cannot remove a full serial exchange. Completion remains a later dependency.
- [ ] Preserve the current custody-failure policy explicitly. A route-claim failure
  currently reports rejected custody storage while registration can continue.
  An ownership-claim failure prevents wallet publication. A combined request must
  retain these distinct outcomes without converting optional custody into a blocker.
- [ ] Remove replaced route handlers, client methods, and response shapes together.
  Keep established-session signing independent of Console.

Acceptance: record before/after D1 and HTTP counts per operation. Verify ownership
conflicts and partial failures with real Console composition. Reuse existing
durable decisions for retries. Do not introduce a distributed transaction service.

### Phase 2 record

Gateway-observed duration of each Console call, against Console's own execution
time for the same call. Values are the group medians of the six hosted groups of
October 10 and 11.

| Console call | Request | Gateway observed | Console executed |
| --- | --- | ---: | ---: |
| Registration setup | Setup | 190–401 ms | 150–179 ms |
| Active root lineage | Respond | 83–405 ms | 70–79 ms |
| Passkey claim | Finalization | 133–307 ms | 99–200 ms |
| Route publication | Finalization | 160–338 ms | 194–206 ms |
| Registration completion | Finalization | 124–276 ms | 54–59 ms |

Console's D1 calls take 10–24 ms each. The staging Console Worker and its
database run in Tokyo. The APAC Gateway runs in Hong Kong, so each exchange adds
a Hong Kong–Tokyo round trip to Console's execution time. Four of these calls
are serial on the registration path. A Gateway in another region pays a longer
round trip for the same four calls.

## Phase 3 — Reduce measured custody preparation and connection delays

- [x] Reuse R155D's completed role-database cutover and activation results.
  Run the pending registration proof through the new role databases.
  Capture fresh baseline Worker versions and actual database bindings afterward.
  Do not repeat the cutover or restore versions that bind the old databases.
  The old databases are deleted. The comparison custody set with the new
  bindings is Router `aa1cf297`, Deriver A `fd1c1f00`, Deriver B `4c70417b` and
  Signing Worker `c39367f9`. Nine wallets registered and signed through this set
  on October 11. The [hosted record](evidence/refactor-155f-relocated-hosted.md)
  holds the versions, the bindings and the restoration check.
- [ ] Separate A preparation, peer connection, B admission, protocol execution,
  output sealing, durable completion, and background D1 settlement in the trace.
- [ ] Optimize the largest remaining serial admission or persistence step.
  Prefer combined reads and removal of repeated Worker/object dispatches.
  Keep the existing concurrent A/B transport and stored wallet-object addresses.
- [ ] Preserve the durable completed outcome before replying. Background D1
  acknowledgement already exists and must not be counted as response latency.

Starting observations: A preparation **198 ms**, A connection **277 ms**, and
protocol spans of **274 ms for A** and **230 ms for B**. These overlap and cannot
be subtracted from the **1.674 s** SDK custody median to prove a specific overhead.
Worker clocks also cannot isolate synchronous CPU or implicit storage flushes.

Acceptance: attribute the selected delay to measured work, then verify replay
after a lost response. Keep crypto changes and new peer protocols outside this plan.

### Phase 3 record

Deriver A's preparation inside the execution had group medians of 193–199 ms
before the role-database move and 120–130 ms after it. No other custody span
changed beyond the spread between groups. SDK custody execution measured
1,956–2,295 ms on October 11.

### Serial chain of one Yao execution — October 11

About half of a Yao execution is protocol work. The other half is admission,
connection, delivery and bookkeeping around it, in one serial chain. The Worker
records of the nine wallets in the
[home-publication run](evidence/refactor-155f-home-publication-hosted.md) give
the order. The Router's execute request took **1,574 ms** at the median
(1,283–2,085). The browser measured 1,688 ms for the same request, about 40%
of a registration.

| Step, in order | Median | Range |
| --- | ---: | ---: |
| Router authorizes and claims the registration in its wallet object | 86 ms | 75–680 |
| Router reaches the three roles | 44 ms | 21–233 |
| Deriver A reaches its object and admits the pair session, two D1 round trips | 123 ms | 96–315 |
| Deriver A connects to Deriver B | 252 ms | 231–373 |
| Protocol, by the Worker clock | 398 ms | 275–459 |
| Deriver A's CPU work that the clock does not show | 281 ms | 233–385 |
| Router delivers the packages to the Signing Worker | 76 ms | 70–96 |
| Router finishes the registration in its wallet object | 73 ms | 64–86 |

The steps are medians of nine samples and do not add exactly to the request median.

- **The clock hides Deriver A's CPU work.** A Worker clock advances only at I/O.
  Deriver A's reply reached the Router 233–385 ms after the object's last clock
  value. That gap matches the object's reported CPU time in every sample
  (272–413 ms). Protocol work is therefore about **680 ms**, not 398 ms.
- **The steps before the protocol take about 500 ms.** Both Derivers admit in
  D1 with two round trips each, 103 ms for A and 110 ms for B, in parallel.
  Deriver B's whole preparation request takes 293 ms (251–387).
- **The connection crosses a stateless Deriver B Worker.** Deriver A reaches it
  in 46 ms (43–55). The Worker holds the request 119 ms (100–206), although its
  code only parses one header and forwards the request. It uses 40–64 ms of CPU
  in all nine samples. Other stateless calls to this Worker use 2–24 ms, except
  the first preparation request of two groups, at 67 and 91 ms. A new isolate
  for each connection would explain both values. This cause is not established.
  Deriver B's wallet object starts 55 ms later (10–69), and Deriver A sees the
  connection after 46 ms more (11–129). The hold does not wait for Deriver B's
  preparation: in one sample the preparation ended 145 ms before the connection
  arrived.
- **Deriver B reads its admitted session from D1 again**, 62 ms (52–65), in the
  object that receives the connection. Part of it overlaps the connection reply.
- **The Router sends two commands to its wallet object**, the claim at the start
  and the completion at the end, at about 50–70 ms each.

The run is the comparison of three groups on staging. The two finish values
that the clock reported below zero are excluded from that row's range. A staging
Worker with little traffic may start a new isolate more often than production does.

Candidates, in order of expected size. None is implemented or measured.

1. Remove the hold in the stateless Deriver B Worker from the connection, about
   120 ms. First establish its cause, and whether production traffic removes it.
2. Admit both Derivers before the execute request arrives, about 120 ms plus
   Deriver B's preparation. The preparation request carries the client's input
   today, so first establish which part needs it.
3. Remove Deriver B's second D1 read, about 60 ms, if the object that admitted
   the session also receives the connection.
4. Combine each admission's two D1 round trips, about 50 ms.

Reproduce with the scripts in `.artifacts/r155f-yao-chain/` of `seams-monorepo`.
Each takes the run directory as its argument.

## Phase 4 — Remove a browser exchange where inputs permit it

- [ ] Trace when the client creates each input for setup, respond, execute,
  and finalization. Identify any input that depends on the Yao result.
- [ ] Evaluate R155D's combined execute/finalize design first. If all finalization
  inputs exist before execute, carry them on that request and complete registration
  before returning. Reuse the existing journal and exact registration identity.
- [ ] If an input requires the execute result, document that concrete dependency.
  Identify server-only preparation that can overlap that client work instead.
  Do not invent placeholder commitments or another ceremony to force a merge.
- [ ] Return the established session and custody outcome through the existing SDK
  completion path. Preserve mixed NEAR/ECDSA and recovery behavior through explicit
  domain states. Remove obsolete requests and branches for the replaced flow.

### Phase 4 record

The finalization request needs the activation reference and the custody commit.
The client builds both from the Yao execution's result: the custody commit
contains the registered public key. A direct merge of execute and finalization
is therefore not possible. Server-only work that needs no Yao result can still
overlap the client's custody work: the credential claim, the route claim and
the initial loads need only the ceremony.

An earlier credential claim also changes cancellation behavior. Console's
`D1WalletHomeDirectory.complete` refuses cancellation after a wallet gains a
passkey claim. Moving the claim into respond would extend that restriction to
subsequent Yao failures. Review that outcome before moving the claim; preserve
usable retry or cancellation behavior. Initial read batching is the smaller
next change and needs no earlier remote ownership mutation.

Each browser request also costs a CORS preflight exchange, because every
request is a cross-origin JSON POST to a new URL. A registration and its first
signature send six. A probe from Tokyo measured 125–191 ms for one preflight
against the staging Gateway, which answers it from its pinned region. The
hosted harness never measured these exchanges: Playwright request interception
answers every preflight locally. Since private `5f5f919` the latency test serves
its assets from a local HTTPS server without interception, and the browser
sends real preflights.

Two staging runs of October 11 measured with real preflights. The
[record](evidence/refactor-155f-preflight-hosted.md) holds both.

| Six wallets each, identical Worker versions | Unchanged SDK | SDK with early preflights |
| --- | ---: | ---: |
| Registration, excluding WebAuthn | 5.129 s (4.080–5.658) | 3.530 s (3.306–4.147) |
| First signature, excluding confirmation | 1.076 s (0.924–1.417) | 0.649 s (0.562–0.778) |
| Registration plus first signature | 6.102 s (5.174–6.903) | 4.204 s (3.948–4.794) |

The early-preflight SDK sends one `OPTIONS` fetch to each later registration
route and to both signing routes when registration starts. Commit `99a34b73`
contains it, with the specification text and a contract assertion of the early
requests and their order. Its saving is larger than the removed preflights
explain, and a staging Worker with little traffic may profit from the early
requests more than a production Worker does. Setup keeps its own preflight.

Browser tests that matched a route by URL alone took an early request for the
operation's first request. Commit `2e70218e` and private `97cf88f` make those
interceptors handle the POST only. All 132 contract cases and all 23 private
composed registration cases pass with the change. One device-linking case
failed twice in eight runs that night, with and without load. Its failing step
is an Email OTP unlock that the menu automation ran as a passkey unlock. That
step sends no early request, and the case passed five times in a row afterwards
with the change and once without it.

Two other ways remove or shorten the preflights without an SDK request:

- Serve the Gateway API under the wallet origin. Requests become same-origin
  and need no preflight. This changes routing and the SDK's relayer address.
- Answer `OPTIONS` at the edge, before the pinned Gateway Worker. This needs
  one more Worker, which this plan's scope excludes.

The client's distance to the Gateway region is a separate cost. Each exchange
between Tokyo and the Hong Kong Gateway took about 100 ms for a request that
does no work. Without early prewarming, registration and its first signature
make six application POSTs and six preflights. Early prewarming adds five explicit
`OPTIONS` requests and moves the later preflights ahead of their application calls.
The hosted overlap comparison observed 17 Gateway HTTP requests per wallet.
A same-origin API would need only the six application requests for this flow.

The current path uses **four registration browser requests**, followed by prepare
and sign. A combined execute/finalize would reduce registration to **three** and
the complete flow to **five**. This is conditional on the input-dependency review.
Moving prepare into confirmation does not reduce registration time or request count.
One-request signing and early signing commitments remain separate protocol work.

## Phase 5 — Verify, measure, and record

- [ ] Use the existing real-D1 and browser scenarios. Cover a lost finalization
  reply, competing claims, partial Console failure, exact retry, and signing after reload.
  Verify an independently checked NEP-413 signature after the retry.
- [ ] Exercise retirement or relocation during a changed write ordering.
  Extend an existing E2E only when the changed ordering lacks behavioral coverage.
  Produce a repeatable artifact. Do not add unit or source-text tests.
- [ ] Run the relevant type fixtures and package checks. Use branch-specific
  domain states and boundary parsers. Remove obsolete APIs and compatibility paths.
- [x] Resolve the interrupted-recovery conflict that R155D tracked. Commit
  `3ed898cc` introduced it. Capability installation got its own commit of the
  shared Yao record, and that commit wrote the record even when nothing changed.
  A recovery admission resolves the capability after it loads the shared version.
  An interrupted attempt leaves the capability suspended, so the lookup rehydrates
  the stored capability. The rehydration changes nothing, but its write raised
  the shared version, and the admission's claim conflicted with
  `409 admission_failed`. Commit `d51cfcd8` skips the write for an unchanged
  capability set that carries no companion write.
  Three recovery contract cases fail from `3ed898cc` to `490c3d50` and pass with
  the fix: the interrupted attempt, the replaced activation and the late
  superseded attempt. Server source `941e01b3` passes them. All 132 contract
  cases pass on `d51cfcd8`. The earlier parent comparison used `06696b27`, which
  already contains `3ed898cc`. An earlier revision of this record said that the
  server source did not locate the cause. That statement came from a cloned
  tree that still ran the original tree's server build.
- [ ] Freeze matching SDK, Gateway, Runtime, Console, and custody sources.
  Compare baseline, candidate, and repeated baseline on existing staging resources.
  Hold the client, signer, wallet home, custody versions, and database bindings fixed
  except for the component being tested. Separate placement changes from code changes.
- [ ] Use at least the existing three fresh wallets per arm for the first comparison.
  Add samples only when a specific uncertainty justifies them within the **$25 Cloudflare budget**.
  Record cold and warm observations separately. Do not infer cold state from a new wallet alone.
- [ ] Record registration, first signature, and combined medians, maxima, and ranges.
  Record HTTP calls, Console calls, D1 calls, SQL statements, serial waiting time,
  preparation waits, served regions, and unfinished background work separately.
- [ ] Audit serving versions and independently verify every signature.
  Restore the baseline captured after the database cutover. Verify the restoration.
- [ ] Commit accepted changes on `dev`. Link sanitized evidence from this plan.
  Record whether the 3–4 second target was met. Do not claim a maximum from a median.

Keep a simple change when it demonstrably removes a serial dependency or redundant
work and preserves behavior, even if a small sample cannot isolate its saving.
Report a measured regression explicitly. Do not label an unmeasured saving as achieved.

## Scope limits and completion

This plan requires no new database, Worker, secret, environment-variable family,
cache layer, queue, or configuration framework. Use the existing staging resources.
Production rollout and publishing 0.9.0 remain separate release work.

Complete the plan when each proposed change has implementation and evidence, or
a concrete dependency that prevents it. Record remaining latency against the user
target. A completed checklist does not establish that the latency target was met.
Keep only the implementation needed for the accepted behavior.
