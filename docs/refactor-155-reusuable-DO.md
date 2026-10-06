# Reusable wallet DOs for presignature preparation

Status: runtime implementation and controlled comparison complete. Full lifecycle acceptance remains open as listed below.
Date: October 6, 2026.

## Objective

Reduce the time users wait for ECDSA signing material. Reuse a Durable Object
(DO) across preparation sessions for the same wallet and signing-material scope.
Start useful preparation at the earliest authorized point during registration
and unlock. Immediate signing must use preparation already in progress.

A **presignature** is cryptographic material prepared before final signing.
It can be consumed only once. The **pool** holds available presignatures.
A **refill** generates material to replenish that pool.

Reuse the DO, never the presignature. Each generation session retains its own
identity, authorization, protocol state, expiry, and replay protection.

## Evidence and limits

Before this change, routing created a distinct DO for each presignature-generation session.
All protocol requests within that session reach the same object. Each request
also constructs a new stub, the client handle for contacting the object.

| October 6 diagnostic | Calls | Median | Maximum |
| --- | ---: | ---: | ---: |
| First no-op to a new object | 12 | 643ms | 731ms |
| Next no-op through the same stub | 12 | 3ms | 5ms |
| Fresh stub to the same warm object | 12 | 43ms | 54ms |
| Direct initialization without probes | 6 | 778.5ms | 948ms |

The 643ms is a component measurement during preparation. It is not a fixed
charge on every signature. Ready signing does not wait for material generation.
Background generation becomes visible when signing needs material before it
arrives. Object allocation, routing, and connection setup were not separately
observable. Waking an existing object may have a different cost.

| Full MPC signing checkpoint | Samples | Median | Maximum |
| --- | ---: | ---: | ---: |
| Ready material, combined prepare | 6 | 1.441s | 1.709s |
| Three-signature sequences, combined prepare | 9 | 2.393s | 3.029s |

Eight of nine consecutive signatures waited for refill. Those waits had a
1.136s median and a 1.669s maximum. The historical ready/consecutive medians
of 1.745s/3.411s remain separate baselines. These small cohorts establish no
latency guarantee.

Sources: [signing results](refactor-152-results.md#fresh-session-validation-in-prepare-october-6-2026),
[DO diagnosis](refactor-152-results.md#worker-to-do-first-contact-diagnosis-october-6-2026),
and [diagnostic evidence](evidence/r152-worker-do-first-contact-20261006.json).

## Existing implementation to reuse

The default pool target and client capacity are already **five**, with a refill
trigger of four and one background refill at a time. Keep these settings for
the comparison. Increasing capacity does not make an empty pool fill faster.

Registration and login already call the shared prefill scheduler. The signing
path already waits for an in-flight refill before attempting foreground recovery.
Verify and adjust these paths instead of adding a second scheduler or queue.

| Area | Source and required change |
| --- | --- |
| DO routing | `crates/router-ab-cloudflare/src/durable_object/worker_storage.rs`: replace the per-session object key with an exact wallet/material host identity. |
| Server entry points | `crates/router-ab-cloudflare/src/lib.rs` and `ecdsa_signing_fetch.rs`: keep init, step, completion, and consumption routing consistent. |
| Session storage | `crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs`: replace singleton owner authorization storage and audit linked completion/replay keys. |
| Object cleanup | `crates/router-ab-cloudflare/src/durable_object/mod.rs`: replace whole-map expiry with session-specific cleanup. |
| Ownership and relocation | `presign_session_relocation.rs`, its modules, and wallet ownership records: preserve exact selectors for pending, completed, and consumed sessions. |
| Registration trigger | `packages/wallet/src/SeamsWeb/operations/registration/registration.ts`: inspect both existing prefill calls and move them earlier only when all prerequisites hold. |
| Unlock trigger | `packages/wallet/src/SeamsWeb/operations/auth/login.ts` and its prefill helpers: reuse the authenticated capability and fixed home. |
| Shared scheduler | `packages/wallet/src/core/signingEngine/session/warmCapabilities/ecdsaLoginPrefill.ts`: preserve bounded, authorized background preparation. |
| Foreground handoff | `packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts`: reuse in-flight preparation and reserve the first usable result. |

The ownership and relocation files have concurrent work. Reconcile with their
current contracts before editing. Preserve other agents' changes and commit only
this work. Do not restore an earlier ownership model for this optimization.

## Phase 1 — Make the DO reusable

- [x] Define the host identity from existing canonical tenant, wallet, material
  activation, and signing-worker identities. Preserve regional deployment
  separation and existing ownership-generation admission fences. Exclude the presignature session ID from the host key.
- [x] Require the same host identity for initialization, protocol steps,
  completion replay, consumption, and lifecycle operations. Validate it at the
  trusted request boundary. Never route from an unverified caller-selected key.
- [x] Key authorization and protocol records by session ID within that host.
  Preserve durable identity claims before emitting protocol output.
- [x] Preserve atomic one-use consumption and exact-request retry behavior.
  A consumed or interrupted identity must never generate fresh material again.
- [x] Audit owner and linked-device paths. Keep their authorization and records
  distinct while using the applicable reusable host scope.
- [x] Expire only the affected sessions. Schedule the next required expiry so
  one session cannot postpone another's cleanup or erase another's live state.
- [x] Bound retained live state and clean expired material. Preserve replay
  records for their required lifetime; deletion must not permit identity reuse.
- [x] Preserve pending-state inventory and lifecycle fences. Host reuse must not
  bypass revocation, material replacement, or relocation ownership checks.
- [x] On restart, preserve durable terminal/consumption behavior. If intermediate
  state cannot resume, fail that session safely and prepare under a fresh identity.
- [x] Remove replaced per-session routing and singleton storage paths. Add no
  legacy fallback, compatibility flag, or new configuration source.

## Phase 2 — Start preparation early and share it with signing

- [x] **Trigger preparation at the earliest valid point during registration.**
  Locate the first point where committed active material, its verified manifest,
  usable client material, fixed home, and preprocessing authorization all exist.
  Start there, before unrelated completion work where possible. Record the chosen
  call site and why its prerequisites hold.
- [x] Preserve registration failure and cancellation cleanup. Never expose or
  continue using material from an abandoned or superseded activation.
- [x] Verify unlock starts the same preparation path after authentication and
  material restoration. Do not add a network ping or an artificial readiness wait.
- [x] **Let immediate signing use that in-progress preparation.** Share the exact
  pool identity and existing progress signal. Reserve the first usable result
  without waiting for all five entries or starting a duplicate generation session.
- [x] Keep foreground recovery bounded if background preparation fails, expires,
  or is invalidated. Preserve actionable failure reporting and authorization checks.
- [x] **Reuse the same DO when generating additional presignatures.** The first
  preparation can pay initial setup; subsequent sessions use the same host.
- [x] Keep registration and unlock independent of filling the entire pool.
  Maintain existing capacity and concurrency limits. Add no permanent keepalive.

## Phase 3 — Verify behavior end to end

Use existing E2E harnesses with real protocol execution. Do not add unit tests or
source-text guards. Update the intended-behavior contract with any intentional
lifecycle change. Add type fixtures only where shared domain types change.

- [x] Register a fresh wallet and sign immediately, with no test readiness wait.
  Verify the signature and show that signing shares registration's preparation.
- [x] Generate and consume several presignatures through one host. Retain evidence
  of stable host identity, distinct session identities, and single consumption.
- [ ] Sign concurrently for two wallets and for two devices of one wallet.
  Verify isolation, distinct claims, and the unchanged shared-budget rules.
- [x] Lose a protocol or terminal reply, then retry. Verify the documented replay
  result and prove that no consumed identity produces a second signature.
- [x] Restart the object during preparation and after completion. Verify safe
  recovery or explicit failure, with no orphaned reservation or reused material.
- [x] Expire one session while another remains active. Verify selective cleanup.
- [ ] Revoke authorization or replace material during preparation. Verify stale
  work cannot become usable and valid replacement material can sign.
- [ ] Exercise wrong-home and ownership-generation rejection through the existing
  lifecycle harness. Include pending and terminal linked-device records.

Retain a repeatable artifact containing commands, source revisions, outcomes,
verified-signature counts, and redacted traces. Do not record signing secrets.

## Phase 4 — Compare hosted latency and close the change

Use existing staging infrastructure within the **$25 Cloudflare budget**.
Do not create a shared warm pool, keep objects permanently active, or deploy
production. Freeze exact candidate and control sources before the comparison.

Run the same SDK, region, pool settings, and timing boundaries for each arm.
Vary only this optimization. Historical numbers remain reference points; run a
fresh control because deployed code and network conditions can change.

| Workload | Required observation |
| --- | --- |
| Register, then sign immediately | Preparation start, overlap with registration, remaining wait, and full signing time. |
| Unlock, then sign immediately | First usable material arrival and full signing time. |
| Sign 2, 5, and 15 seconds after unlock | Pool depth at signing and whether preparation completed in time. |
| Three consecutive signatures | Per-signature latency, refill waits, and pool depth. |
| Ready-material signing | Detect regressions in the existing fast path. |
| Sign after an idle interval | Report the interval and observed wake behavior separately from new-object cost. |
| Concurrent wallets/devices | Signature validity, contention, and shared-budget behavior. |

- [x] Keep the established six ready signatures and nine consecutive signatures
  per arm. Retain all samples and failures; report sample counts for added scenarios.
- [ ] Record medians, maxima, request counts, generation durations, refill waits,
  and generated/consumed/discarded material. Report registration and unlock duration
  separately so moving a wait does not appear as a free latency reduction.
- [ ] Correlate Worker-to-DO spans with object reuse. Separate first-object calls,
  calls to reused objects, and fresh-stub setup. Do not assume reuse eliminates
  the measured 43ms stub cost or guarantees a 643ms signing improvement.
- [ ] Require correctness checks to pass and demonstrate fewer or shorter refill
  waits without a material ready-signing regression. If results are mixed, report
  them and investigate the measured cause before claiming an improvement.
- [x] Remove temporary probes, restore staging after the controlled trial, and
  verify deployed versions and bindings. Preserve benchmark artifacts and results.
- [x] Review for obsolete routes, unbounded state, duplicate schedulers, and unsafe
  replay behavior. Run relevant checks and `pnpm report:bloat --check`.
- [x] Commit completed work on `dev` and link final evidence from this plan.

Full acceptance requires the remaining lifecycle checks below. Implementation and hosted performance evidence are recorded here.
This plan does not include a release or a guaranteed two-second signing bound.


## Implementation and results — October 6, 2026

Runtime commit: `3df1c9d3afe1aec25befe7b04c45c031c675a0e8` on public `dev`.
[Repeatable evidence](evidence/r155-reusable-do-20261006.json) contains the local
protocol outcome, hosted summary, request-window counts, and deployment versions.

### Implemented scope

Owner preprocessing now addresses one DO using canonical tenant/wallet identity
and the complete normal-signing material scope. This scope includes activation,
key context, SigningWorker identity, and activation epoch. Sessions retain separate
identity claims, authorization, expiry, and protocol state. Initialization, steps,
and the final batch use the same host identity.

Regional deployments retain their existing DO namespaces. Existing admission and
ownership fences remain authoritative. The host key introduces no new home or
ownership-generation wire field. Reusing a host does not grant authorization.

Linked-holder background prefill uses the same material-pool path and benefits
from host reuse. The distinct request-bound linked-signing protocol retains its
session address and relocation records. That protocol remains active behavior.

Durable claims use session-specific keys ordered by expiry. Cleanup removes only
expired claims and schedules the earliest remaining expiry. Each cleanup batch
contains at most 128 claims. Immutable session expiry prevents identity reuse after
claim deletion. Live state expires with its ceremony; no new numerical concurrency
limit was introduced. Interrupted in-memory ceremonies fail safely after eviction.

The existing SDK already starts registration preparation after the first durable
ECDSA publication, before export-root and remaining completion work. A later
publication reschedules preparation for the resulting authority. Unlock starts
preparation after material bootstrap. Signing already waits for the shared
in-flight refill and consumes its first available result. These paths required no
new scheduler or SDK runtime change. Capacity remains five, with threshold four
and one background refill at a time. There is no permanent keepalive.

### Fresh hosted comparison

Both arms used the same frozen SDK, Gateway, APAC wallet configuration, and NRT
browser. Only the SigningWorker runtime changed. Full signing time includes SDK
work and automated approval. It excludes broadcast and blockchain confirmation.

| Workload | Samples per arm | Control median / max | Reusable DO median / max |
| --- | ---: | ---: | ---: |
| Material ready | 6 | 1.474s / 1.706s | **1.463s / 1.595s** |
| Three-signature sequences | 9 | 2.844s / 3.222s | **1.559s / 1.899s** |

Consecutive-signing median fell **45%**. Refill waits above 1ms fell from **8/9**
to **1/9**. The remaining candidate wait was 462ms. Control waits had a 1.048s
median and 1.735s maximum. Neither ready cohort waited for refill.

This comparison uses the deployed separate session-status request. The historical
combined-prepare checkpoint above is a separate experiment. Do not combine the
savings or compare those arms as if they used identical sources.

| Early preparation scenario | Control signing | Reusable DO signing |
| --- | ---: | ---: |
| Immediately after registration | 4.054s | 3.518s |
| Immediately after unlock | 3.449s | 1.609s |
| 2 seconds after unlock | 1.639s | 1.514s |
| 5 seconds after unlock | 2.123s | 1.663s |
| 15 seconds after unlock | 1.454s | 1.496s |
| 90 seconds after unlock | 1.740s | 1.810s |

Each row has **one sample per arm**. Registration duration was 5.755s control and
5.587s candidate, separate from signing. Immediate registration still waited
1.865s for material, versus 2.348s control. A first signature is not guaranteed
within two seconds. The idle test does not establish that Cloudflare evicted the DO.
Request windows include overlapping background work. They are not a complete
material-generation census. Initialization spans mix new and reused objects and
do not independently measure cold starts or eliminate fresh-stub cost.

### Verification and remaining acceptance

- Local real-protocol E2E verified eight signatures, repeated host reuse, concurrent
  sessions, two wallets, tenant isolation, completion replay, eviction during and
  after preparation, fresh-session recovery, and selective expiry.
- Both Worker feature configurations compiled for WASM. The bloat check passed.
- All three hosted latency workloads passed. Existing concurrency and shared-budget
  assertions passed. These do not prove the complete two-device lifecycle matrix.
- The hosted overlap test verified three signatures while background refill
  supplied two entries during a held prepare request.
- The hosted retired-session test failed on **both candidate and restored control**.
  Refill correctly returned `401 wallet_session_invalid`. Prepare returned
  `503 wallet_session_unavailable`, while the test requires `401`. This pre-existing
  hosted failure is outside the changed DO route. The test remains strict.
  Finalize replay and replacement signing were not reached in that test.
- Full material-replacement, two-device, and wrong-home/ownership-generation
  lifecycle acceptance remains unverified in this run. Existing gates and linked
  relocation addressing were preserved, but compilation alone cannot prove them.
- All six staging versions were verified after restoration. No production release,
  new Worker, DO namespace, Container, or permanent warm pool was created.

The remaining acceptance blocker is the pre-existing retired-session response.
Resolve it in the deployed Gateway/authorization candidate, then run the remaining
lifecycle matrix against a compatible frozen deployment. Do not weaken the expected
rejection or report this plan as fully accepted before those checks pass.


## Initial preparation follow-up — October 6, 2026

The first registration prefill now uses the validated, issued registration
response for its initial session facts. It no longer waits for another
`/wallet/session/status` request before starting preparation. The scope binds the
relayer, credential, session, and quota. A changed identity fails reconciliation.
Every refill request still checks current server authorization. Later publication
and unlock retain their existing status reads. Prepare and finalize are unchanged.

The issued response parser already requires a positive initial quota and validates
its authorization identities. The new scope consumes this parsed domain value.
It introduces no raw response parser, cache TTL, compatibility flag, or scheduler.

[Comparison evidence](evidence/r155-first-preparation-20261006.json) records all
samples. Each arm registered three fresh wallets and immediately signed three
times per wallet. All **18 signatures** verified. Both arms used the reusable DO
SigningWorker, the same APAC deployment, and a native NRT browser.

| Metric | Control median / max | Candidate median / max |
| --- | ---: | ---: |
| Initial prefill scheduling | 238.7ms / 239.6ms | **19.6ms / 22.3ms** |
| Immediate first signing | 4.248s / 5.429s | **3.867s / 4.277s** |
| First-signature refill wait | 2.224s / 3.726s | **1.723s / 2.190s** |
| Following two signatures, six samples | 2.162s / 4.825s | **2.002s / 2.550s** |
| Registration duration | 6.464s / 7.298s | 8.038s / 21.268s |

The direct scheduling saving is **219ms median**. First signing improved about
9% in this small cohort. Network and startup variance prevent attributing the
entire difference to the removed request. The candidate's slowest registration
spent 6.276s in registration intent and 9.994s in the Gateway response stage,
before the changed prefill call. Its Deriver B span was 7.719s. These outliers
remain in the evidence. Registration-to-sign completion did not demonstrate an
overall improvement in this run.

The first presignature still requires DO initialization and the cryptographic
message exchanges. This change advances preparation; it does not reduce the
protocol's required work. The following-signature workload overlaps deferred
registration and is separate from the ready-material benchmark above.

Validation: TypeScript checking, SDK/site builds, and the bloat check passed.
The hosted test is `hosted first preparation: immediate registration and
consecutive signing` in private `mpc-signing-latency.test.ts`, run with
`--repeat-each 3 --workers 1`. The frozen SDK differs only in the initial
registration status scope. All six staging versions were restored and verified.
The earlier lifecycle acceptance gaps remain open.


## Start the registration host in the background — October 6, 2026

Successful SigningWorker activation now schedules one `wait_until` task that
contacts the wallet's exact presignature DO. The activation response does not
await this task. Failure is logged and does not fail registration. The call uses
the existing internal prewarm path through the private DO binding. It creates no
session, authority claim, presignature, or durable wallet record. It adds no
keepalive, public endpoint, configuration flag, or infrastructure resource.

The DO address now hashes the canonical tenant/wallet scope and the complete
material-activation reference. That reference binds the activation, capability,
material owner, key, lifecycle, and SigningWorker. These facts exist during server
activation. They are also carried by every later refill request. This replaces
hashing the entire normal-signing scope, which also included SDK-assigned labels
unavailable during server activation. Session admission and protocol execution
still validate the complete normal-signing scope. Regional namespace separation
and request-bound linked-session routing remain unchanged.

This changes the owner-host address. The experiment uses fresh test wallets.
There is no old-host lookup or migration path. An in-progress ceremony addressed
by the previous layout must restart with a fresh identity after deployment.
Previously completed material remains governed by its existing pool state.

[Evidence](evidence/r155-registration-host-startup-20261006.json) contains all
samples and the exact hosted versions. Both arms use the preceding SDK change
that starts prefill from the issued registration response. Each arm registers
three fresh APAC wallets from an NRT browser, then immediately signs three times.

| Metric | Control median / max | Startup candidate median / max |
| --- | ---: | ---: |
| First Worker-to-DO initialization span | 820ms / 859ms | **597ms / 627ms** |
| First presignature generation | 3.844s / 3.893s | **3.565s / 3.927s** |
| Immediate first signing | 4.011s / 4.618s | **3.924s / 4.344s** |
| First-signature refill wait | 2.370s / 2.663s | 2.274s / 2.703s |
| Following signatures, six samples | 1.953s / 4.048s | 2.048s / 4.151s |
| Registration duration | 6.488s / 6.608s | 5.819s / 6.481s |

The measured initialization median improved by **223ms (27%)**. First-generation
median improved by 279ms (7%). Full first signing improved only 87ms (2%) in this
small cohort. Following signatures and maximum generation time did not improve.
The result supports a modest startup benefit, not a large signing-speed claim.

The three background startup calls completed in 627ms, 763ms, and 803ms. A
separate diagnostic wallet proved identical hashed host addresses for startup
and subsequent initialization. Startup completed 1.327s before initialization
began, yet its first Worker-to-DO span still took 481ms. That wallet signed in
2.839s and verified three signatures. It is excluded from the comparison table.
The remaining delay is not explained by warming a different host. Transport and
runtime startup costs need separate measurement before further optimization.

Verification: both Worker WASM configurations compile. Local protocol E2E
verified eight signatures, startup before first signing, zero additional DOs at
first signing, tenant/wallet isolation, concurrent preparation, selective expiry,
replay rejection, and recovery after eviction. Hosted checks verified 21
signatures across comparison and diagnostic runs. Temporary host-address logging
exists only in the diagnostic build and is absent from the committed source.
All six original staging versions were restored and verified after the trial.
The broader lifecycle acceptance gaps recorded above remain open.
