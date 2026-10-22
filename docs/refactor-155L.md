# R155L — Reduce the remaining NEAR registration and signing waits

Status: selected changes implemented and verified. Date: October 21, 2026.

The [implementation record](evidence/refactor-155l-near.md) contains results and
reproduction commands. NEAR passkey registration now starts its browser signer
worker during preparation. Default development builds also optimize session
sealing. Final lifecycle checks passed, including failed warmup and reload.

No package was released or deployed. Router removal, post-finalization concurrency,
and SQLite changes remain deferred. The server traces did not establish another
safe implementation change. The conditional work below records those boundaries.

## D1 latency follow-up — October 22, 2026

The later [private D1 investigation](https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/d1-write-path-diagnosis-20261022.json)
reproduced selective waits outside reported SQL execution on both Deriver databases.
Independent client measurements confirmed real waits while the other database responded and the caller continued sending heartbeats.
The exact internal cause remains unresolved. These probes do not explain every historical registration outlier.

The [private PostgreSQL and Hyperdrive future plan](https://github.com/seams-tech/seams-monorepo/blob/dev/docs/future-plan-wallet-postgresql-preparation.md#potential-latency-upgrade-postgresql-through-hyperdrive)
describes a potential latency upgrade using RDS or Google Cloud SQL while retaining Cloudflare Workers.
It requires disabled query caching, preserved transaction guarantees, remaining storage ports, and a controlled hosted comparison.
No hosted latency improvement from that upgrade is established.
[Storage portability](storage-portability.md#cloudflare-workers-with-hyperdrive) records the public implementation status.

## Objective and scope

Improve NEAR-only registration and Ed25519 signing through changes that produce
measurable user-facing savings. Start with the current WASM preloading change and
the remaining server waits. Evaluate client concurrency and Router removal only
when their measured costs justify the implementation.

This plan covers passkey NEAR-only registration, its first signature, and later
signatures. Preserve existing email OTP and linked-device behavior when a shared
NEAR path changes. ECDSA and mixed-registration optimization are outside scope.

The critical path is the work that must finish before the SDK can return a usable
wallet or signature. Fewer statements or service calls alone do not establish a
shorter critical path.

## Priority decisions

| Work | Decision | Reason |
| --- | --- | --- |
| Verify existing WASM preloading | Verified and extended | The first-signature worker still loaded late. Registration now starts that existing worker early. |
| Optimize development session sealing | Implemented | Hydration medians fell from 44–52 ms to about 6 ms in the focused comparison. |
| Attribute remaining `respond` and `finalize` waits | Profiled; unresolved | No additional server reordering was justified by the traces. |
| R2: overlap client completion work | Deferred | Completed preloading leaves a much smaller client cost. |
| S1: remove NEAR Router forwarding | Deferred after profiling | Required validation and downstream work obscure the removable contribution. |
| S3: combine NEAR SQLite updates | Defer | One statement inside an existing transaction is unlikely to justify priority for user-facing speed. |
| S5: background operation completion | Exclude | Completion owns replay responses and allows session retirement. |
| Remove repeated session checks | Exclude | Checks across asynchronous work protect expiry, lock, and authority replacement. |

## Starting evidence

The preloading change is `4e4d825e`, included in the local 0.15.6 release commit
`8c8cb24a`. A release commit does not establish which assets a hosted client serves.

The private evidence record
`seams-monorepo/docs/evidence/registration-post-passkey-gap-20261020.json` documents
two serial WASM downloads after finalization. In one traced hosted registration,
activation and export capability establishment took 566.2 ms.

After preloading completed in a controlled candidate run, publication took
13.7 ms, hydration 7.8 ms, activation 6.3 ms, and export capability establishment
3.0 ms. These stages total 30.8 ms. This is a sample, not a latency guarantee.
It does not support a general claim that client concurrency saves 50–120 ms.

The same candidate spent 1,567 ms in respond and 846.1 ms in finalize. A separate
production warm-up took 6,769 ms after the passkey step, including 5,021 ms in
respond. The cause of that backend wait remains unresolved. Its record is
`seams-monorepo/docs/evidence/registration-0154-staging-production-20261020.json`.

[R155J](refactor-R155J-p99.md) retains the unresolved server investigations.
Reuse its evidence and existing instrumentation.

## Phase 1 — Establish the current NEAR baseline

- [ ] Record the served SDK, iframe, Gateway, Router, Deriver, and Signing Worker
  versions. Record the candidate Git revision and asset hashes.
- [ ] Verify that both activation modules start loading before their use and
  that overlapping initialization produces one fetch and one shared instance.
- [ ] Exercise a cold browser, a warm browser, and the first request after idle.
  Keep these populations separate and retain every failed attempt.
- [ ] Measure post-passkey registration through durable readiness. Also retain
  the complete public SDK call duration.
- [ ] Measure the first NEAR signature and subsequent signatures separately.
  Retain confirmation time separately from signing execution.
- [ ] Independently verify signatures, reload the wallet, and verify another
  signature without another registration or unexpected passkey interaction.

Reuse the public registration asset and lifecycle contracts under
`tests/e2e/intended-behaviours/`. Use the private
`tests/e2e/hosted-product/near-signing-latency.test.ts` for hosted timing.
Follow its HTTPS asset-serving procedure. Request interception changes browser
caching and preflight behavior, so reserve it for correctness fault scenarios.

If the served build lacks preloading, qualify the existing implementation through
the normal release process. Do not create another preloader or initialization path.

## Phase 2 — Remove one demonstrated server wait

- [ ] Correlate browser elapsed time with existing Gateway and custody-role
  traces for slow and typical requests.
- [ ] Separate database calls, role execution, asset work, and unobserved time.
  Worker clocks advance at I/O boundaries. A zero span does not prove zero CPU cost.
- [ ] Identify the largest avoidable serial dependency in the current NEAR
  respond or finalize path. Record its inputs, outputs, and required ordering.
- [ ] Check whether the apparent duplication protects a commit, replay,
  ownership generation, or authority transition.
- [ ] Implement a fix only when the evidence identifies unnecessary work or an
  independent operation that can overlap safely.
- [ ] Record the removed dependency and verify its failure and retry behavior
  through the existing registration E2E.

An unexplained provider wait does not justify a new cache, longer timeout, extra
retry, placement change, or lifecycle redesign. If the evidence identifies no
code change, retain the finding and stop this phase.

## Phase 3 — Trial limited client overlap if it remains worthwhile

Work in
[`registration.ts`](../packages/wallet/src/SeamsWeb/operations/registration/registration.ts).
Use the existing mixed continuation only as a reference for hydration overlap.

- [ ] Measure the remaining hydration, material activation, and export capability
  spans after preloading completes. Compare their exposed wait with control variation.
- [ ] Keep publication preparation synchronous. It does not perform worker or
  IndexedDB work that `Promise.all` can overlap.
- [ ] Keep atomic registration publication before session hydration and material
  activation.
- [ ] Start hydration and material activation together only after verifying
  that their storage and worker operations have no required ordering.
- [ ] Consider export capability establishment in the same joined group only
  if it uses independent inputs and preserves its current session precondition.
- [ ] Settle every started branch before shared cleanup or return. Preserve
  required failure propagation, best-effort export behavior, and secret wiping.
- [ ] Retain current-session checks around material installation. Report ready
  only after required persistence, hydration, and activation finish.

Do not parallelize all writes as a blanket change. Do not detach secret-bearing
work after registration returns. Keep the existing retry journal semantics.

Extend the existing registration contract only where behavior coverage is missing.
Exercise delayed hydration, lock during completion, a failed required branch, and
reload after successful completion. Finish with independently verified signatures
and a saved evidence artifact.

If the concurrency adds lifecycle complexity and the measured savings remain
within control variation, discard the experiment.

## Phase 4 — Measure NEAR Router forwarding before changing it

Inspect
[`normalSigningRouterProxy.ts`](../packages/wallet-server/src/router/transport/fetch/routes/normalSigningRouterProxy.ts),
[`strict_worker/router.rs`](../crates/router-ab-cloudflare/src/strict_worker/router.rs),
and
[`strict_worker/signing_worker.rs`](../crates/router-ab-cloudflare/src/strict_worker/signing_worker.rs).

- [ ] Measure the NEAR prepare and finalize forwarding contribution, including
  parsing, serialization, initialization, and actual placement.
- [ ] Separate those costs from Gateway authorization and the wallet Durable
  Object, which owns persistent signing state.
- [ ] Proceed only if a matched experiment shows enough forwarding cost to
  justify changing the execution boundary.
- [ ] Move the existing NEAR admission validation into the Signing Worker entry
  boundary. Preserve authenticated Gateway origin, bounded decoding, wallet and
  tenant scope, ownership generation, material identity, and request binding.
- [ ] Preserve owner-session, step-up, and linked-device authorization behavior.
  Keep Gateway authorization and durable operation completion synchronous.
- [ ] Route NEAR prepare and finalize directly through the authenticated service
  binding. Remove the replaced NEAR forwarding path in the same change.
- [ ] Coordinate the internal route change through the existing release process.
  Keep registration orchestration and ECDSA routing outside this change.

Cloudflare documents same-thread, same-server execution for service bindings by
default. A removed Worker call is not automatically a saved network round trip.
[Service-binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

Use the existing NEAR signing E2E to verify first and warm signatures, exact
replay after a lost reply, changed-request rejection, expired authorization,
step-up, and retired ownership. Add coverage only for demonstrated gaps.

## Verification and acceptance

Keep changes small and reuse existing modules and domain builders. Define new
functions at module scope. Parse external values once at the boundary. Preserve
precise lifecycle types and avoid casts or broad spreads that bypass their rules.
Do not grow oversized files. Use existing companion modules where possible.

Add no unit tests or source-text guards. If shared domain types change, extend
their existing type fixtures for invalid branches, construction, and spread escapes.
Classify any failing check under the repository testing policy before fixing it.

Run the narrow affected E2E cases during implementation. Run affected package
type checks, Worker builds, and `pnpm report:bloat --check` before committing.
Broaden lifecycle verification if routing, authorization, or persistence changes.

After correctness passes, run one matched comparison of the retained changes.
Alternate control and candidate order. Keep tenant, network, backend versions,
asset delivery, placement, and warm-up conditions comparable. Investigate individual
changes separately only when a failure or regression requires it.

Save raw evidence under `.artifacts/refactor-155l-near/` in the owning repository.
Use existing harness artifacts rather than a new reporting framework. Retain:

- Exact commands, revisions, asset hashes, served versions, and cohort conditions.
- Per-attempt public durations, stage spans, requests, failures, and retries.
- Available database and service-call observations. Mark missing observations unknown.
- Independent signature verification, tamper rejection, and lifecycle fault outcomes.
- Sample counts, median, p95, maximum, and repeated-control variation.

Do not sum overlapping spans or add stage medians to reconstruct an overall median.
Report registration and signing separately. Keep cold-start and idle costs visible.
Small samples do not establish p99 acceptance. The historical Singapore 3,343 ms
sample percentile used setup + respond + finalize and a different measurement boundary.

Accept a speed claim only when matched results show a repeatable improvement
beyond control variation, with no material tail regression or lifecycle weakening.
If a change removes work but its user-facing benefit remains inconclusive, say so.
Do not expand the implementation to rescue an inconclusive micro-optimization.

Publish the result and limitations in `docs/evidence/refactor-155l-near.md`.
Production rollout remains separate from this implementation and measurement plan.
