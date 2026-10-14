# R155J — Reduce registration outliers

Status: startup investigation in progress. Date: October 13, 2026.

Reduce slow NEAR-only registrations on Singapore staging. Diagnose the rare
Deriver A startup delay first. Keep the gains delivered by release 0.9.3.

This plan extends [R155H](refactor-155H.md). It owns the startup investigation,
targeted fixes, and combined tail measurement. A tail is the slowest part of
the latency distribution. R155H retains the preparation-at-setup design,
setup cost controls, and the deferred Console completion design.
Record their implementation once and cross-reference the evidence here.

## Baseline and target

The [0.9.3 staging record](evidence/refactor-155h-release-093-staging.md)
covers a Tokyo browser calling Singapore. It contains 164 successful
registrations and one failed setup attempt. The baseline contains 198
successful registrations on 0.9.0. Both releases used fresh wallets.

The following percentiles use linear interpolation at `(n - 1) * p`.
They include all recorded groups. They exclude user interaction, funding,
and blockchain confirmation. Registration includes setup unless stated otherwise.

| Workload | 0.9.0 p99 | 0.9.3 median | 0.9.3 p99 | 0.9.3 maximum |
| --- | ---: | ---: | ---: | ---: |
| Registration | 6.207 s | 2.215 s | 4.701 s | 5.472 s |
| Registration after the passkey step | 5.605 s | 1.734 s | 3.815 s | 5.013 s |
| First signature | 1.539 s | 0.326 s | 0.972 s | 1.402 s |
| Registration and first signature | 7.329 s | 2.609 s | 5.218 s | 5.757 s |

Four successful 0.9.3 registrations exceeded four seconds. One exceeded five
seconds. The failed attempt returned HTTP 400 with a transient D1 error.
Keep that failure in the attempt count, outside successful-request percentiles.

The earlier 6.458-second maximum used 165 baseline wallets. The complete
198-wallet baseline has a 6.918-second maximum. Keep these populations distinct.

Later evidence: the [setup/SDK comparison](evidence/refactor-155h-setup-sdk-completion.md#hosted-comparison)
recorded a successful 7.353 s registration with 5.809 s in custody/Yao. It used
unchanged staging backends and 18 samples per SDK arm. Keep it separate from the
release baseline; it has no role trace and cannot establish p99. That record also
documents the correction to the historical after-passkey timing calculation.

Working targets for the same client and lane:

- Registration p99 below four seconds, with fewer than 1% above four seconds.
- Preserve registration median at or below 2.3 seconds and after-passkey median below two seconds.
- Preserve first-signature performance and all registration correctness guarantees.
- Report failures, maximums, and incomplete attempts beside the percentiles.

These are acceptance targets, not latency guarantees. At 164 successes, p99
depends on approximately two observations. A larger sample must support the result.

Reproducible baseline inputs in the private repository:

- `.artifacts/r155h-singapore-anchor/p99-comparison.json`
- `baseline-090`, then `baseline-090-b` through `baseline-090-f`
- `release-093`, `release-093-b`, and `release-093-pub`
- `analyze.py`, registration JSON files, Worker tails, and signature proofs

## Source inventory

| Area | Existing implementation |
| --- | --- |
| Gateway startup and three-second abort | `packages/wallet-server/src/hosted-wallet-gateway.ts`, `startRegistrationRouter` |
| Parallel role startup | `crates/router-ab-cloudflare/src/durable_object/wallet_startup.rs` |
| A execution and B preparation | `crates/router-ab-cloudflare/src/durable_object/deriver_a_pair.rs`, `deriver_b_pair.rs` |
| Compute prewarming | `crates/router-ab-cloudflare/src/ed25519_yao_prewarm.rs` |
| Stored object addresses | `packages/wallet-server/src/router/cloudflare/d1/walletObjectAddresses.ts` |
| Registration lifecycle and setup | `packages/wallet-server/src/router/cloudflare/d1/registration/` |
| Existing setup retry fix | Commit `b8de6715`, including `storage/d1Retry.ts` and `router/framework/registrationSetupDispatch.ts` |
| Hosted workload | Private `tests/e2e/hosted-product/near-signing-latency.test.ts` |

Resolve current symbols before editing. Preserve concurrent work and use existing
domain types, measurement helpers, and behavioral scenarios.

## Phase 1 — Locate the startup delay

October 13 findings: [saved trace and local cancellation reproduction](evidence/refactor-155j-slow-startup.md).
The same A object received startup and execution dispatch. Execution was its first
handled command, with `prewarm: none`. A local workerd reproduction shows that the
abort can remove queued startup; disabling it does not shorten the initialization
wait. Diagnostics now distinguish abort initiation, forwarding completion and
handler start. A bounded staging capture ran 89 attempts: 87 signatures verified,
two attempts failed. The three-second startup stall did not recur. Temporary
diagnostics were removed from source after capture. The platform cause remains unresolved.
The capture found a separate 30-second package-delivery failure. A body timeout
is strongly inferred; the producer cause remains unresolved. See the evidence.


The slowest 0.9.3 registration spent 4.166 seconds in custody execution.
Setup took 459 ms and finalization took 495 ms. Its background startup reached
the Gateway's three-second limit. Execution later waited about 2.85 seconds
before A's object ran. This does not prove that cancellation caused the delay.

- [ ] Correlate that sample from Gateway startup through Router, role Worker,
  object entry, prewarm, admission, and execution completion.
- [x] Use existing correlation identifiers. Add only missing timing boundaries.
  Never record secret inputs, credentials, protocol material, or raw authorization headers.
- [ ] Record dispatch, handler entry, first storage operation, and reply for each role.
  Record abort initiation and downstream completion separately.
- [ ] Distinguish pre-handler delay, initialization, queued work, prewarm CPU,
  storage confirmation, and transport failure. Mark missing observations explicitly.
- [ ] Reproduce cancellation with a controlled delayed startup in the composed test.
  Check whether abort cancels downstream work, stops observation, or leaves work running.
- [x] Verify startup and execution address the same persisted A object and ownership generation.
- [x] Check whether startup completion means handler readiness or completed compute prewarming.
- [x] Record a causal finding, or the precise boundary that remains unexplained. The
  unresolved interval precedes A handler entry; see the evidence above.

Use Worker tail wall and CPU measurements alongside application spans.
Worker application clocks alone can omit CPU time. Do not sum overlapping spans
or infer transit time from unsynchronized clocks.

Exit: identify the largest unexplained interval and the effect of cancellation.
If the delay precedes handler entry, retain that fact in the platform evidence.

## Phase 2 — Apply the demonstrated startup fix

- [ ] If cancellation interrupts useful startup, preserve its bounded background
  lifetime through the existing continuation mechanism.
- [ ] If cancellation only stops observation, retain the timeout unless another
  demonstrated reason supports changing it. A larger timeout alone is not a speedup.
- [ ] If initialization or prewarm blocks execution, remove that interference.
  Keep prewarm cooperative and subordinate to real wallet work.
- [ ] If execution repeats preparation, reuse the existing admitted state with
  exact wallet, home, generation, expiry, and ceremony binding.
- [ ] Preserve one execution winner and exact retry behavior. Keep claims durable
  before protocol material leaves either role.
- [ ] Exercise slow startup followed by immediate execution, lost startup reply,
  cancellation, expiry, duplicate execution, and an object restart.

Use the smallest fix supported by Phase 1. Keep stored object IDs stable.
Do not introduce object pools, duplicate executions, relocation, or replacement
objects to race a slow request. A retry against the same object may queue behind
the same delay.

If the cause is entirely outside handler execution, prepare a sanitized support
bundle. Include version IDs, times, location evidence, request correlation, and
the successful control. The user sends it to Cloudflare unless separately authorized.

## Phase 3 — Remove additional waits and close setup recovery

- [x] Propagate package-delivery failures without waiting for a stalled ceremony.
  Preserve terminal supersession and exact replay. Five actual-Worker E2E cases
  passed; the parent Router remained pending in the native-binding control.
  Staging now serves the fix in Router `5651a97c`; 30 registrations and their
  first signatures passed independent verification.
  [Hosted check](evidence/refactor-155j-slow-startup.md#hosted-check-of-the-delivery-fix).
  [Failure-propagation evidence](evidence/refactor-155j-slow-startup.md#delivery-failure-propagation).
- [ ] Diagnose the producer stall behind the captured 30-second package-delivery
  failure. The deployed fix addresses propagation; the failure did not recur in
  the 30-attempt hosted check. No hosted failure-path or p99 gain is established.
  The original slow startup and first-signature HTTP 503 also remain unresolved.

- [x] Review commit `b8de6715` against the current setup lifecycle. Reuse its bounded
  retry implementation and error mapping. Published 0.9.3 resolves to `e4f883f7`,
  which does not contain this fix.
- [x] Exercise a transient D1 failure, an ambiguous write result, and a lost setup reply.
  The assembled setup service passes request loss, committed-batch reply loss,
  exhausted retries, and exact setup replay with stable identity and addresses.
  [Recovery evidence](evidence/refactor-155j-slow-startup.md#setup-recovery-verification).
- [x] Verify exhausted transient failures return a recoverable server response.
  Keep database driver text out of the public response.
- [ ] Resolve R155H's setup cost control before moving more work before authentication.
  Reuse an existing applicable policy. If none exists, present concrete limits
  for user approval. Do not invent a separate quota framework.
- [ ] Implement R155H Phase 1 once: prepare the exact wallet during setup and
  let immediate execution reuse that work. Validate expiry and abandoned setup cleanup.
- [ ] Inventory confirmed writes on the slow registration path. Identify which
  writes must precede another operation and which can overlap.
- [ ] Batch related writes within an existing object or database transaction.
  Overlap independent commits only when the lifecycle permits it.
- [ ] Keep nonessential background writes away from an object serving registration.
  An object's pending writes can hold outgoing responses behind its output gate.
- [ ] Preserve durable ownership, replay, and execution claims. Do not use
  `allowUnconfirmed` to acknowledge these writes early.

Console completion after the reply remains deferred under R155H Phase 3.
Revisit it only if the new traces show a material remaining contribution.
Do not create an outbox solely to complete this checklist.

## Phase 4 — Verify the combined implementation

Complete correctness checks during implementation. Keep logical commits.
Measure the accepted changes together. Isolate a change only when a failure
or regression requires diagnosis.

- [ ] Extend existing behavioral tests for delayed startup, concurrent requests,
  retry, cancellation, ownership mismatch, and failure recovery.
- [ ] Classify every failing test against current types and the intended-behavior specification.
- [ ] Update the specification with any intended lifecycle change. Remove replaced paths.
- [ ] Freeze matching SDK, Gateway, Runtime, Console, and custody versions.
  Record migrations and the serving baseline before staging changes.
- [ ] Coordinate the staging window with active experiments. Use the current
  Singapore databases and activation flow. Retire old restore snapshots.
- [ ] Build release artifacts and run the relevant checks. Deploy the coordinated
  candidate to existing staging resources, then activate and verify readiness.
- [ ] Run at least 500 registration attempts across five or more time-separated groups.
  Use fresh wallets and the same Tokyo client, origins, confirmation policy, and workload.
- [ ] Include first-use samples in the primary population. Label naturally cold
  starts and prewarm outcomes. Report controlled post-deployment runs separately.
- [ ] Record every attempt, including failed, cancelled, and incomplete attempts.
  Do not replace a failed sample silently or omit its retry time.
- [ ] Report p50, p90, p95, p99, maximum, failure rate, and counts above four,
  five, and six seconds. Retain inclusive interaction timings separately.
- [ ] Use the existing percentile method. Include nearest-rank p99 and sample counts
  so readers can see the sensitivity to individual outliers.
- [ ] Retain per-run results. A pooled improvement must not hide a slow run.
- [ ] Verify every completed signature independently and retain repeatable artifacts.
- [ ] Attribute the ten slowest registrations to stages and supported causes.
  Compare object-entry delay, storage waits, CPU, prewarm completion, and request counts.
- [ ] Export sanitized evidence and link it from this plan and R155H.

Check expected Cloudflare cost before starting the run. Stay within the user's
$25 Cloudflare budget. Use existing resources and impose a fixed attempt cap.
If the remaining budget cannot support 500 attempts, report the smaller sample
and its uncertainty. Do not run an unbounded benchmark to improve confidence.

## Completion

Close the plan when each investigation has evidence and each accepted fix passes
the relevant behavioral checks. Record measured outcomes against the targets.
If platform delays remain, identify their boundary and retain the support bundle.
An implementation can be complete while a latency target remains unmet.

Production deployment and package publication are separate release work.
This document authorizes neither a new deployment nor new infrastructure.

## October 14 — SDK completion and finalization follow-up

The [completion evidence](evidence/registration-completion-20261014.md) records two
accepted changes. Session publication no longer waits for an informational
startup network diagnostic. Finalization loads immutable Yao admission in its
initial D1 batch, which removes one later round trip. Router consumption,
revocation, lock, replay, and durable completion checks remain enforced.

A held-GET browser contract verifies the completion change. The earlier 5.5-second
outlier remains only partly explained because its browser network trace is missing.
The bounded staging comparison is separate from this plan's 500-attempt p99 study.
