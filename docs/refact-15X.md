# Reusable wallet DOs for presignature preparation

Status: planned. No runtime changes from this plan are implemented.
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

Current routing creates a distinct DO for each presignature-generation session.
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

- [ ] Define the host identity from existing canonical tenant, wallet, material
  activation, and home/ownership-generation identities. Preserve signer-role and
  deployment separation. Exclude the presignature session ID from the host key.
- [ ] Require the same host identity for initialization, protocol steps,
  completion replay, consumption, and lifecycle operations. Validate it at the
  trusted request boundary. Never route from an unverified caller-selected key.
- [ ] Key authorization and protocol records by session ID within that host.
  Preserve durable identity claims before emitting protocol output.
- [ ] Preserve atomic one-use consumption and exact-request retry behavior.
  A consumed or interrupted identity must never generate fresh material again.
- [ ] Audit owner and linked-device paths. Keep their authorization and records
  distinct while using the applicable reusable host scope.
- [ ] Expire only the affected sessions. Schedule the next required expiry so
  one session cannot postpone another's cleanup or erase another's live state.
- [ ] Bound retained live state and clean expired material. Preserve replay
  records for their required lifetime; deletion must not permit identity reuse.
- [ ] Preserve pending-state inventory and lifecycle fences. Host reuse must not
  bypass revocation, material replacement, or relocation ownership checks.
- [ ] On restart, preserve durable terminal/consumption behavior. If intermediate
  state cannot resume, fail that session safely and prepare under a fresh identity.
- [ ] Remove replaced per-session routing and singleton storage paths. Add no
  legacy fallback, compatibility flag, or new configuration source.

## Phase 2 — Start preparation early and share it with signing

- [ ] **Trigger preparation at the earliest valid point during registration.**
  Locate the first point where committed active material, its verified manifest,
  usable client material, fixed home, and preprocessing authorization all exist.
  Start there, before unrelated completion work where possible. Record the chosen
  call site and why its prerequisites hold.
- [ ] Preserve registration failure and cancellation cleanup. Never expose or
  continue using material from an abandoned or superseded activation.
- [ ] Verify unlock starts the same preparation path after authentication and
  material restoration. Do not add a network ping or an artificial readiness wait.
- [ ] **Let immediate signing use that in-progress preparation.** Share the exact
  pool identity and existing progress signal. Reserve the first usable result
  without waiting for all five entries or starting a duplicate generation session.
- [ ] Keep foreground recovery bounded if background preparation fails, expires,
  or is invalidated. Preserve actionable failure reporting and authorization checks.
- [ ] **Reuse the same DO when generating additional presignatures.** The first
  preparation can pay initial setup; subsequent sessions use the same host.
- [ ] Keep registration and unlock independent of filling the entire pool.
  Maintain existing capacity and concurrency limits. Add no permanent keepalive.

## Phase 3 — Verify behavior end to end

Use existing E2E harnesses with real protocol execution. Do not add unit tests or
source-text guards. Update the intended-behavior contract with any intentional
lifecycle change. Add type fixtures only where shared domain types change.

- [ ] Register a fresh wallet and sign immediately, with no test readiness wait.
  Verify the signature and show that signing shares registration's preparation.
- [ ] Generate and consume several presignatures through one host. Retain evidence
  of stable host identity, distinct session identities, and single consumption.
- [ ] Sign concurrently for two wallets and for two devices of one wallet.
  Verify isolation, distinct claims, and the unchanged shared-budget rules.
- [ ] Lose a protocol or terminal reply, then retry. Verify the documented replay
  result and prove that no consumed identity produces a second signature.
- [ ] Restart the object during preparation and after completion. Verify safe
  recovery or explicit failure, with no orphaned reservation or reused material.
- [ ] Expire one session while another remains active. Verify selective cleanup.
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

- [ ] Keep the established six ready signatures and nine consecutive signatures
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
- [ ] Remove temporary probes, restore staging after the controlled trial, and
  verify deployed versions and bindings. Preserve benchmark artifacts and results.
- [ ] Review for obsolete routes, unbounded state, duplicate schedulers, and unsafe
  replay behavior. Run relevant checks and `pnpm report:bloat --check`.
- [ ] Commit completed work on `dev` and link final evidence from this plan.

Completion requires the implementation, behavioral evidence, and hosted comparison.
This plan does not include a release or a guaranteed two-second signing bound.
