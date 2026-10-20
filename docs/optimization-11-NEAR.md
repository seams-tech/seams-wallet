# Optimization 11: NEAR registration and signing latency

Status: local refresh persistence repaired and latency breakdown measured, 2026-09-29;
optimization experiments remain proposed.
No optimization or deployment is claimed. R150 is integrated into wallet `dev`; measurements
must identify the exact source, SDK assets, role builds, and deployed versions.

Execution order confirmed: establish the local development baseline first and
optimize measured local work before starting network/placement experiments.
The [local benchmark report](./optimization-11-NEAR-local-baseline.md) records the
workload, results, reproduction commands, and known coverage gaps.
The [corrected local breakdown and experiment ranking](./optimization-11-NEAR-local-breakdown.md)
adds NEAR-only refresh persistence, registration stage timings, signing preparation
and confirmation timings, and per-signature session-status request counts.
Use that corrected readiness baseline for the next experiments.

## Objective and scope

Reduce the time to a durably usable NEAR wallet and the complete system-controlled
time to a verified Ed25519 signature. Prioritize demonstrated serial waits,
repeated authorization/storage work, and avoidable client preparation.

- Signing target: 1–2 seconds for the complete system-controlled path, including
  SDK orchestration, material readiness, authorization, prepare, client share,
  finalize, verification, and result assembly. Report every breach of 2 seconds;
  a median below that threshold alone does not establish the maximum requirement.
- Registration: reduce SDK-entry-to-durable-NEAR-readiness latency. Establish a
  fresh baseline before setting an absolute registration target; none is approved
  here. Report absolute and paired percentage improvements for each cohort.
- Preserve mixed registration's ECDSA-ready return while NEAR continues. Measure
  that return and full NEAR readiness independently. NEAR-only registration must
  commit custody and become usable before reporting successful completion.
- Cover passkey and Email OTP, NEAR-only and mixed registration, reusable sessions,
  first signing, refresh/unlock, and exact-operation step-up.

Wallet owns SDK, protocol/domain behavior, adapters, and behavioral contracts.
`seams-monorepo` owns managed deployment, Console adoption, and composed hosted
acceptance. Use exact released package and artifact versions at that boundary.

This plan does not authorize production deployment, wallet resets, a provider
change, new credentials, or additional benchmark spend. Preserve the existing
R150 comparison image and deployments until its matched comparison finishes.
Any later isolated experiment must fit its explicitly authorized scope and budget.

## Evidence and existing work

Historical diagnostics identify opportunities; they are not the current R150
baseline or population latency guarantees.

| Evidence | Observation | Implication |
| --- | --- | --- |
| [Optimization 10 appendix](./optimization-10-appendix.md#near-signing-after-wallet-062) | Three hosted signatures averaged 1.613 s inside prepare/share/finalize and 5.939 s confirmed-to-signed; the average difference was 4.326 s | Attribute the work outside the signing exchange first |
| Same report | Other samples measured 1.234 / 8.710 s and 2.683 / 6.801 s for core / confirmed-to-signed | Both the exchange and surrounding orchestration can exceed the budget |
| [Hosted registration outcome](./optimization-10-appendix.md#hosted-registration-outcome) | Five post-0.6.2 samples averaged 4.682 s to durable NEAR readiness | Refresh the deployed registration baseline; this small historical cohort cannot establish p95 |
| [Custody profiling](./near-custody-profiling.md) | Local SigningWorker delivery fell from 373 ms to 7 ms with the correct release artifact; Yao computation was approximately 140 ms in that investigation | Verify build profile before attributing latency to cryptography |
| Same report | Earlier client-seal preparation removed its remaining wait, with 19.3 ms median full-readiness savings in a local paired comparison | Reuse existing overlap; local micro-optimizations need deployed evidence |

Already implemented in earlier work: independent mixed NEAR provisioning,
client-seal preparation during custody, hydration/installation overlap, prepared
server-seal finalization, duplicate admission removal, development/release artifact
separation, and granular client signing timings. Confirm their presence in the
measured build before proposing replacements. Older reports describe earlier
request shapes and deployment status.

R150's hosted Tempo/ECDSA signing results are separate evidence. They cannot
establish NEAR signing performance. ECDSA presign-pool changes are outside this
plan unless tracing demonstrates shared contention affecting NEAR.

## Measurement contract

Extend existing diagnostics and E2Es; avoid a second benchmark framework.

### Timing boundaries

Record one monotonic client timeline per registration or signing operation:

1. Registration: SDK entry, authentication, recovery-backup interaction, response,
   admission, custody execution, activation, NEAR finalization, local publication,
   hydration/installation, and durable readiness.
2. Signing: SDK entry, readiness/preparation, confirmation, nonce recovery,
   material resolution, transaction context, session authorization, prepare,
   client share, finalize, verification, nonce commit, and result assembly.
3. Server: authorization snapshot, material lookup, admission/claim, owner-scope
   lookup, role dispatch, role storage/computation, and durable terminal replay.

Report full elapsed time and system-controlled elapsed time. Exclude only measured
human-wait intervals from the latter, using their interval union. Record automated
confirmation separately; a virtual authenticator does not model human latency.
Include preparation and queueing before confirmation. Keep chain broadcast and
finality separate, and include transaction-context RPC needed to produce a valid
transaction in transaction-signing latency.

Retain `confirmed_to_signed` and `signature_total` as diagnostic subspans. Neither
alone is the complete signing metric. Associate prepare and finalize with the
same operation; never pool their response durations as complete signatures.
Calculate totals and differences per sample before percentiles. Overlapping spans
and component medians must not be summed into an end-to-end result.

Use existing operation/ceremony identifiers to correlate records. Record request
counts with causal attribution so concurrent ECDSA refill or NEAR continuation
traffic is distinguishable. Record failures and missing spans explicitly. Never
log credentials, factor secrets, signing material, recovery codes, or request bodies.

### Cohorts and evidence

- Establish local release-build baselines first. Defer hosted measurements in APAC,
  WEUR, and ENAM until the local work is assessed and those runs are authorized.
  Record actual runtime locations and storage topology; a location hint alone is
  insufficient evidence.
- Registration: NEAR-only and mixed, separated by factor; report ECDSA return,
  full NEAR readiness, and immediate first NEAR signature.
- Signing: first after registration, warm reuse in one retained session, after
  refresh/unlock, and final-use exhaustion followed by step-up. Separate those
  authorization branches; do not count a step-up as a warm reusable-session sample.
- Compare NEP-413 with transaction signing to isolate transaction-context and nonce
  overhead. Cover supported delegate signing when shared signing code changes.
- Include a bounded burst to expose queues and nonce coordination. Identify real
  runtime cold starts separately from fresh wallets and cold browser state.
- Start with 20 alternating baseline/candidate pairs for the representative path.
  Freeze artifacts within each arm and document the intentional differences.
  Expand after a demonstrated improvement; small-cohort p95 remains descriptive.

Retain sanitized per-operation timelines, raw timing samples, signature
verification outcomes, failure ledger, commands, build/deployment fingerprints,
runtime identities, concurrency, RPC mode, sample counts, p50/p95/max, and counts
above 2 seconds. Use repeatable artifacts under `.artifacts/optimization-11-near/`;
keep publishable summaries in this document or a linked report. A local stubbed-RPC
pass establishes behavior, while hosted real-RPC measurements establish that
environment's transaction-context cost. Neither proves residential/mobile latency.

## Implementation sequence

### 1. Establish the current critical path

- [x] Record a frozen local Workers/D1 baseline: 20 passkey NEAR-only and 20 mixed
  registrations, each followed by verified first and warm NEAR signing. Preserve
  safe samples, artifact identity, reproduction commands, and diagnostic failures.
- [x] Verify release WASM artifacts and freeze the source/assets used by each local run.
- [x] Repair missing NEAR-only refresh persistence and verify refresh, cross-tab lock,
  leading-zero PRF restoration, export, and budget step-up with focused E2Es.
- [x] Measure NEAR-only registration stages, Router execution subspans, signing
  preparation, confirmation decision wait, and session-status request counts.
- [x] Rank the measured local experiments in the corrected breakdown report.
- [ ] Split role execution into computation, serialization, storage, and dispatch;
  attribute remaining public-call orchestration before changing its scheduling.
- [ ] Extend these measurements to Email OTP and separately timed refresh/unlock
  cohorts before making claims about those workloads.

Start with [the existing registration benchmark](../tests/e2e/intended-behaviours/passkey.registration.benchmark.test.ts)
and [signing stage traces](../packages/wallet/src/core/signingEngine/session/operationState/trace.ts).
Check older benchmark gates against current request ordering before reusing them.

### 2. Remove repeated signing authorization and storage waits

Primary paths:
[Gateway routes](../packages/wallet-server/src/router/transport/fetch/routes/thresholdEd25519.ts),
[shared admission](../packages/wallet-server/src/router/domains/signingOperations/routerAbEd25519NormalSigningRoute.ts),
and [client signing exchange](../packages/wallet/src/core/signingEngine/flows/signNear/shared/ed25519YaoNormalSigning.ts).

- [ ] Trace the reads performed by session validation, material resolution,
  operation admission, pinned owner scope, and finalize revalidation.
- [ ] Consolidate related reads into an existing consistent snapshot where the
  domain permits it. Carry validated immutable facts through the request instead
  of re-reading them. Use precise internal types at the boundary.
- [ ] Batch dependent writes only when their existing atomicity requirements align.
  Preserve the current authority checks at their required commit boundaries.
- [ ] Measure the same cohort after each focused change; retain only demonstrated
  improvements or independently justified correctness fixes.

Prepare returns the server commitments needed by the client share. The current
prepare → client share → finalize dependency remains. Removing a protocol round
requires separate cryptographic design and verification. Keep fresh revocation
checks, exact method/environment binding, quota consumption, one-use nonce
semantics, and durable response replay. A cache cannot replace mutable authority.

### 3. Reduce SDK preparation and transaction-context waits

Inspect [transaction orchestration](../packages/wallet/src/core/signingEngine/flows/signNear/signTransactions.ts)
and existing material/hydration and nonce coordinators.

- [ ] Identify repeated worker initialization, material hydration, session status
  refresh, or durable-lease recovery within one operation.
- [ ] Reuse the authorized active client within its existing session lifecycle;
  preload workers/WASM through existing initialization paths where helpful.
- [ ] Overlap independent preparation and transaction-context reads using existing
  orchestration. Validate freshness and exact nonce ownership before signing.
- [ ] Preserve lock, expiry, revocation, authority replacement, refresh, and
  worker-reset invalidation. Keep early preparation in the reported timeline.

Do not add speculative caches or a new nonce manager. Avoid persistent transports
unless hosted attribution justifies them: earlier local HTTP/RPC comparisons
showed only a 2–3 ms difference.

### 4. Shorten registration through durable NEAR readiness

Inspect [registration orchestration](../packages/wallet/src/SeamsWeb/operations/registration/registration.ts)
and [registration persistence](../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationService.ts).

- [ ] Attribute remaining custody, finalization, session-seal, and local activation
  time separately for NEAR-only and mixed branches and both factors.
- [ ] Confirm existing duplicate-admission removal and prepared-seal reuse. Where
  an admission request remains, determine whether it is required for that branch
  before considering returning its receipt with the registration response.
- [ ] Evaluate server orchestration of activation followed by NEAR finalization
  for NEAR-only registration if the trace shows a meaningful browser round-trip
  cost and the server already has the required inputs. Preserve each effect's
  identity, durable checkpoint, replay, and uncertainty handling.
- [ ] Extend existing preparation/hydration overlap only across independent work.
  Keep local publication and readiness atomic with their required authority checks.
- [ ] Verify response-loss recovery through the existing exact-method unlock API;
  coordinate with the ongoing activation-resume work instead of adding another
  recovery implementation.

Consolidating an HTTP exchange does not make separate effects one atomic action.
Mixed registration must keep ECDSA usable while NEAR waits. The custody ceremony
still derives and verifies the key manifest; recovery backup acknowledgement and
durable custody commit retain their ordering. Exact committed replay remains
credential-free and requires fresh exact-method unlock when authority was lost.

### 5. Address measured geographic crossings

- [ ] Correlate Gateway D1 waits and role calls with observed placement. Determine
  whether remaining latency comes from storage distance, role distance, queueing,
  cold start, or computation.
- [ ] Evaluate placement/configuration changes in isolated resources only after
  the application-level comparison is complete. Preserve role-private credentials,
  stores, and operator boundaries when locating services closer together.
- [ ] Keep Gateway shared authority and ceremony records with their established
  owner. A broader authority-placement redesign requires its own measured case
  and correctness review.

Optimize cryptographic computation only if release-build profiling identifies it
as a dominant remaining cost. Any primitive/protocol change needs the relevant
Rust vectors, wire contracts, and formal verification in addition to E2Es.

## Correctness verification and completion

Use focused intended-behavior E2Es and repeatable artifacts; add no unit tests.
Extend existing contracts where they own the behavior. For shared domain changes,
run the affected scenarios on VM, wallet-DO, and Workers D1 adapters.

Required scenarios for affected paths:

- Registration loses a committed response, resumes the same wallet through exact
  unlock, signs, refreshes, and signs again with unchanged key identity.
- A lock or authority replacement races hydration/finalization; late work cannot
  restore access or publish stale readiness. Retain an unlock-repairable journal.
- Mixed registration signs EVM while NEAR is held, then completes NEAR with the
  same session identity, expiry, and remaining quota, including zero quota.
- Signing covers warm reuse, final-use exhaustion, step-up, expired/revoked
  authority, concurrent operations, and lost finalize responses. Verify signatures,
  nonce ownership, one-time consumption, and exact replay after restart.

If lifecycle/domain types change, add targeted type fixtures for invalid branch
combinations and construction escape hatches. Classify failures against current
domain behavior before changing production code or fixtures. Run narrow checks
per change and the relevant integrated contracts at the completion milestone.

Completion requires:

- [ ] Fresh before/after evidence for registration readiness and complete signing,
  with exact source/artifact identities, failures, tails, and limitations.
- [ ] A measured registration improvement without delaying mixed ECDSA return.
- [ ] Signing target assessed separately for first, warm, refresh/unlock, and
  step-up paths; any remaining budget breach has an attributed blocker.
- [ ] Recovery, revocation, quota, custody, and one-use invariants pass the affected
  contracts; obsolete paths and temporary instrumentation are removed where replaced.
- [ ] `pnpm report:bloat --check` and relevant build/type checks pass before the
  implementation commits. Completed work is committed on wallet `dev`.
- [ ] Exact release/consumer versions and hosted acceptance needs are documented.
  Production rollout remains a separate decision.
