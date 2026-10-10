# R155F — Reduce NEAR registration round trips

Status: **in progress.** The R155D implementer took over every phase of this
plan on October 10 at the owner's instruction. Phase 1 has its first code change.
The registration proof for the relocated role databases exists. Each phase
below ends with its record.
Date: October 11, 2026.

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
- [ ] Inspect setup and respond for the same repeated reads. Read the current
  fresh-admission path before changing it because R155D already removed an absent-record read.
- [ ] Record a justified round-trip budget for fresh registration and exact retry.
  List each unavoidable serial dependency. R155D's **4–6 finalization calls** remain
  an investigation target, not an established minimum or a promised result.

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
| 3 | Journal read | Operation journal | Request fingerprint |
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

Commit `edc7d5f9` removes two waits from this chain. The wallet commit no longer
waits for the route claim, because the claim cannot fail a registration. The
custody records are stored beside the session issuance, because neither needs
the other. A finalization that fails still settles its started route claim
before it responds. The call count stays at 14. Hosted saving is unmeasured.
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
  profile is the next step.

Budget: one serial D1 step for admission, one for the initial loads, the
prepared write, the wallet commit, the session write and the completion write.
That is six serial steps against today's thirteen. The custody write and the
pre-commit reads can overlap other work. The two Console exchanges stay serial.

## Phase 2 — Reduce Console calls and exchanges

- [ ] Combine each Console operation's deployment check with its required data
  read or conditional write. Evaluate the check in the transaction it protects.
- [ ] Examine registration setup's API-key and environment operations.
  Batch independent reads and required writes. Classify the API-key update before
  moving it: authentication, quota, and usage-accounting semantics must remain explicit.
- [ ] Combine the lineage reads if one query or batch preserves their meaning.
  Preserve the current restore and revocation checks.
- [ ] Replace passkey claiming's separate insert/read-back with one atomic batch
  that returns the winning owner. Preserve exact retry and competing-wallet refusal.
- [ ] Examine the three finalization Console requests together: passkey claim,
  route publication, and completion. Combine operations only when their required
  ordering and failure behavior fit. Measure whether the removed exchange was serial.
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

Each browser request also costs a CORS preflight exchange, because every
request is a cross-origin JSON POST to a new URL. A registration and its first
signature send six. A probe from Tokyo measured 125–191 ms for one preflight
against the staging Gateway, which answers it from its pinned region. The
hosted harness never measured these exchanges: Playwright request interception
answers every preflight locally. A private harness change serves the latency
test's assets from a local HTTPS server without interception. It loads the site
and sends real preflights. Its first full hosted run is still open.

Three ways remove or shorten the preflights. None is implemented.

- Serve the Gateway API under the wallet origin. Requests become same-origin
  and need no preflight. This changes routing and the SDK's relayer address.
- Answer `OPTIONS` at the edge, before the pinned Gateway Worker. This needs
  one more Worker, which this plan's scope excludes.
- Let the SDK send an early `OPTIONS` request to each later route while setup
  runs. This needs no deployment change. It adds visible requests on the
  operation routes, and about a dozen test interceptors match them by URL.

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
