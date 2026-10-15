# R155J — Reduce registration outliers

Status, October 15, 2026: **the tail target is not met on release 0.10.2.**
The [acceptance population](evidence/refactor-155j-acceptance-0102.md) has 204
attempts: p99 5,966 ms without the passkey step, 11 registrations above 4 s,
and one failed attempt. Its slowest registrations and the failure are
attributed; the failure path is fixed on `dev` in `bc2328c3` and `e311a6f6`.

The last verified staging release is 0.10.2. Do not confuse an implemented
fix, a successful bounded check, a published release, and acceptance of the
tail target.

This plan extends [R155H](refactor-155H.md). It owns outlier diagnosis, supported
failure-path fixes, and combined tail acceptance. R155H owns routine registration
CPU/round-trip work, preparation at setup, its cost controls, and transient
`respond` recovery. Console completion remains deferred there.

## Current status

| Work | Established result | What remains |
| --- | --- | --- |
| A startup and caller cancellation | Saved request correlated to the same object; four-case local reproduction; 89-attempt hosted capture; diagnostics removed | Explain the pre-handler delay. Cancellation was not shown to cause its duration |
| Package-delivery failure propagation | Router no longer waits for held delivery after a terminal failure; five Worker cases and 30 hosted signatures passed | Explain the original producer stall; successful requests do not test the hosted failure path |
| Setup storage recovery | Bounded replay verified for lost requests/replies, ambiguous commits, and exhausted retries | No new setup retry implementation is needed |
| Respond storage recovery | Server retries and exhausted-fault HTTP 503 mapping committed in `ec08890c` | Retry-specific checks and release belong to R155H Phase 10; SDK transport recovery is outside that commit |
| Setup exposure and pair preparation | Rate limit, bounded pair admission/connection, expiry, cancellation, and replay implemented; released in 0.10.0 | R155H retains abandoned-setup cost measurement |
| SDK completion and finalization | Informational parity wait removed; Yao admission batched; 42-wallet combined comparison passed | Publish accumulated changes separately; historical 5.5-second SDK gap is not fully attributed |
| Founding-read overlap | `f6422f37` committed; explicit-argument cleanup `f36b32a1` and focused checks pass | Hosted contribution is unmeasured; include it in the next accumulated candidate |
| B binding-await delay | All three arms showed the asymmetry; an unchanged three-wallet control later ran in 12–21 ms | Separate database, transport, runtime, and clock effects if it recurs; no migration is justified now |
| First-signature HTTP 503 | One diagnostic capture recorded it | Cause remains unresolved |
| Router object reply wait | One 12.2 s `finish_registration` reply on 0.10.2; our code and transport excluded ([record](evidence/refactor-155j-router-finish-hold-20261014.md)) | A platform wait; only Cloudflare can refine it. 1 of 1,779 Router calls on October 14 |
| Execution before its preparation | The failed acceptance attempt: a 2.4 s Deriver A start, an inline preparation that lost `ConflictingPair` to the setup preparation, then 409 from a held Router claim | Fixed on `dev`: `bc2328c3` binds such an execution to its setup preparation; `e311a6f6` makes the SDK wait out the held claim. A temporary hook reproduced the race inside both Derivers on October 15: with `bc2328c3` the registration passes; without it the Deriver fails with the staging error and the registration fails about 11 s later, even with `e311a6f6` ([record](evidence/refactor-155j-followups-20261015.md)) |
| Gateway steps before the Yao execution | Three of the eleven slowest registrations waited 1.2 to 1.7 s in respond with no timing for that stretch | `b948567b` reports setup, respond and Ed25519 signing steps in `Server-Timing`; the hosted test keeps the raw header. Read them in the next staging population |
| Delay notice | The SDK sends one event when respond or finalize has not answered after 5 s; verified live in the SDK and in the hosted menu | `ce5729fb` drops the passkey prompt line from the menu's delay view. A mixed (ECDSA and NEAR) registration sends no delay event |
| Final p99 acceptance | [204 attempts on 0.10.2](evidence/refactor-155j-acceptance-0102.md): p99 5,966 ms, 5.4% above 4 s, 1 failure | Not met. First batches after idle hold 5 of the 11 slowest; a Gateway wait before the Yao execution holds 3 |

The next diagnostic work is the cold first batch after idle, the Gateway
wait before the Yao execution (now timed by `b948567b`), and the unexplained
startup/delivery/503 behavior, using matched boundaries and current serving
versions. Apply a fix only when the evidence
supports it. Keep accepted call reductions even when a small noisy comparison does
not establish their individual saving. No production deployment is part of this plan.

## Baseline and target

The release table below is the historical starting population. Later bounded
comparisons retain their own builds and sample counts; they do not replace it.

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

The [saved trace and local reproduction](evidence/refactor-155j-slow-startup.md)
show that startup and execution selected the same A object. Execution was its first
handled command, with `prewarm: none`. The missing interval precedes handler entry.

- [x] Correlate the saved Gateway startup/abort, A Worker dispatch, selected object,
  and execution entry. The historical record preserves timestamps and missing data.
- [x] Reuse existing correlation identifiers and add the missing diagnostic boundaries
  for one bounded capture. No secret inputs or protocol material were logged.
- [x] Reproduce caller cancellation with real local workerd bindings. Four cases
  distinguish queued initialization from an entered asynchronous handler, with and
  without abort. An abort can remove queued startup; removing it did not shorten
  the roughly 3.5-second execution wait. This is a transport/initialization fixture,
  not a reproduction of the hosted provider delay.
- [x] Verify stable object IDs and distinguish handler readiness from completed
  compute prewarming. The existing three-second startup timeout remains unchanged.
- [x] Run the bounded hosted diagnostic capture: 89 attempts, 87 signatures verified,
  two failures retained. The original three-second startup stall did not recur.
  The capture found a separate delivery failure and an isolated signing 503.
- [x] Remove temporary diagnostics and verify restoration. Persistent role/host
  observations already present in the product remain available.
- [ ] Capture the missing pre-handler boundary when the real slow startup recurs.
  Separate dispatch, handler entry, initialization/storage, and reply. Label any
  interval the available tools cannot observe instead of assigning it to transit.
  Recurred on October 15 in the failed acceptance attempt: the Deriver A
  Worker forwarded the wallet start at −2,941 ms, and the object's first event
  began at −538 ms, as its first command after the constructor, with no CPU in
  between. Handler entry and the commands are at +0 of that event. So the
  2.4 s lies before the object's event; the tails cannot see inside it.
- [ ] Explain the older 14.6-second B preparation failure after a version switch,
  if reproduced. The October 14 binding-await samples are a different observation.

Use browser/caller elapsed time and matched Worker wall/CPU records. Worker clocks
advance at I/O boundaries; zero-valued spans and whole-await durations do not identify
SQL time or a provider-internal confirmation wait. Do not sum overlapping work.

Investigation result: the original A cause is unresolved. The local abort result
explains a possible missing startup handler, not the duration of the hosted stall.

## Phase 2 — Apply only a demonstrated startup fix

No causal fix for the original A startup stall is established. The tested control
keeps the initialization delay after the abort is removed, so a longer startup
timeout is not an accepted latency fix.

- [x] Keep the existing timeout and stable stored object IDs. Do not add replacement
  objects, races, or retries solely because an object starts slowly.
- [ ] If a matched capture shows initialization, queued work, or prewarm interference,
  remove that demonstrated interference using the existing continuation mechanism.
- [ ] If preparation is unnecessarily repeated within its permitted lifetime,
  reuse it with the exact wallet, home, generation, ceremony, and expiry. Preserve
  cancellation, fresh root checks, and the single execution winner. Cross-request
  decrypted-share caching remains excluded under R155H.
- [ ] For any resulting fix, exercise delayed startup, concurrent execution, lost
  replies, expiry, cancellation, ownership mismatch, and object restart.

These are conditional follow-ups, not instructions to invent another startup
refactor. If the remaining interval belongs to an opaque platform service, preserve
its evidence and state that limit. A support draft may be prepared; sending it
requires the user's instruction. Do not change a database merely because a previous
run was slow.

## Phase 3 — Completed fixes and remaining failure investigations

- [x] Fix package-delivery failure propagation. The Router observes delivery failure
  without waiting for a held ceremony/delivery join. All five actual-Worker cases
  pass; the parent native-binding control stayed pending at five seconds while the
  candidate answered that case in 205 ms. This is local correctness evidence.
- [x] Verify the delivered fix on staging: all 30 registrations and signatures
  succeeded. The failure itself did not recur, so no hosted failure-path or p99
  saving is claimed. The historical Router version in that record is not a current
  restore target. See [delivery evidence](evidence/refactor-155j-slow-startup.md#delivery-failure-propagation)
  and its [hosted check](evidence/refactor-155j-slow-startup.md#hosted-check-of-the-delivery-fix).
- [ ] Diagnose the producer behind the captured 30-second streamed-delivery wait.
  The existing trace strongly suggests a body timeout but does not show its producer
  cause. Capture producer completion/failure and consumer timeout in the same attempt.
- [ ] Diagnose the isolated first-signature HTTP 503. Do not infer its cause from
  the unrelated delivery failure or the later B binding-await recovery.

- [x] Verify the existing setup retry implementation (`b8de6715`) against the current
  lifecycle. The original 0.9.3 baseline did not contain it; that historical fact
  does not make setup recovery an unimplemented task today.
- [x] Exercise lost batch requests, committed-but-lost replies, exhausted retries,
  exact setup replay, cancellation, wrong tenant, and generation checks through
  the assembled service. Preserve the wallet, ceremony, and object identities.
- [x] Verify exhausted transient faults return `storage_unavailable` with HTTP 503
  and fixed public text. [Setup recovery evidence](evidence/refactor-155j-slow-startup.md#setup-recovery-verification)
  is local correctness evidence; it does not claim hosted fault-injection savings.

- [x] Close the setup-rate-limit implementation item through R155H Phase 1:
  30 setups/minute per publishable key and source IP, refusal before custody work,
  one prepared session per wallet, and a 30-second maximum lifetime.
- [x] Implement and test input-free pair admission and connection during the prompt.
  Release 0.10.0 contains it. Expiry, abandonment, cancellation, and exact replay
  have evidence. See [local checks](evidence/refactor-155h-prompt-preparation.md)
  and the [hosted release](evidence/refactor-155h-release-0100-staging.md).

- [x] Remove the informational startup parity await from SDK session publication
  (`7caae2fa`, contract refinement `e97be4be`). A production-build held-GET case
  returns success before the diagnostic completes, then signs and respects lock.
  The historical 5.5-second gap remains partly unexplained.
- [x] Batch immutable Yao admission into finalization's initial D1 read (`8b4dcf5f`).
  Router consumption, replay, cancellation, and lifecycle guards remain enforced.
- [x] Record the combined 42-wallet comparison, with all signatures verified and
  all 14 original Worker versions restored. Finalization was faster in that sample;
  full registration did not improve consistently. See the
  [completion record](evidence/registration-completion-20261014.md).
- [x] Record the October 14 B asymmetry and the later unchanged production control.
  Historical binding-await medians were 96.5–120 ms; the three later samples were
  21, 12, and 20 ms. Isolated B writes measured 12 ms median. The
  [investigation](evidence/deriver-b-latency-20261014.md) retains the instrument and
  probe limitations. Its temporary Worker and both diagnostic tables were removed.
- [ ] If the B delay recurs, use a matched first-primary-session probe and real
  batch metadata to separate SQL, database/transport waiting, preceding CPU, and
  runtime resumption. Do not label the historical delay a proven Cloudflare defect.

Further durable-write batching, background-work changes, and CPU optimization need
an observed dependency and lifecycle review. R155H Phase 9 owns routine finalization
work, including committed founding-read overlap and seal warm-up (`1527b97f`).
R155H Phase 10 owns verification and release of transient `respond` D1 retries
(`ec08890c`). Those server retries are implemented; SDK transport recovery remains
outside their scope. R155H Phase 3's Console outbox remains deferred; session issue
and custody persistence already overlap. Keep required ownership and execution
claims durable; this plan does not authorize `allowUnconfirmed` for them.

## Phase 4 — Final combined acceptance

Completed bounded verification is distinct from acceptance of the tail target:

- [x] Keep repeatable behavioral artifacts for cancellation, delivery failure,
  setup recovery, SDK completion, retries, and lock/ownership checks of accepted
  changes. Their scope and exclusions are recorded beside each result.
- [x] Record frozen sources, serving baselines, release builds, and cleanup for the
  completed captures. They used the existing Singapore lane; diagnostics were
  removed and original serving versions restored where the run was temporary.
- [x] Retain failures and per-arm data, and verify completed signatures independently:
  87/89 in the diagnostic capture, 30/30 in the delivery check, 42/42 in the SDK/
  finalization comparison, and 3/3 in the later B control. These populations use
  different conditions and must not be pooled into one p99 estimate.
- [x] Link the sanitized evidence from this plan and R155H. The available records
  identify several slow stages; they do not establish all underlying causes.

Remaining acceptance work:

- [x] Freeze the next accumulated candidate after its correctness checks. Release
  0.10.2 (`main` `70f5674f`) carries founding-read overlap, seal warm-up and the
  `respond` retries; its suite result is in the
  [release review](refactor-155-release-review.md).
- [x] Coordinate the staging window and capture current versions, database bindings,
  migrations, and activation state. The run compared all 14 serving versions with
  a frozen snapshot before each group. Another session deployed a staging Console
  build at 07:05 JST on October 15, so group 3 was skipped.
- [x] Run at least 500 attempts across five or more time-separated groups if the
  remaining $25 budget supports it. Two groups of 102 ran at 00:00 and 01:30 JST.
  The user stopped the run after the target was already missed; at 204 attempts,
  p99 rests on about two observations.
- [x] Include first-use attempts in the primary population. The first batch of
  each group is included and also reported on its own; it holds 5 of the 11
  slowest registrations.
- [x] Report p50, p90, p95, interpolated p99, nearest-rank p99, maximums, failures,
  and counts above four, five, and six seconds. See the
  [acceptance record](evidence/refactor-155j-acceptance-0102.md).
- [x] Attribute the ten slowest attempts using matched request, object, CPU, storage,
  and placement evidence. Eleven registrations above 4 s and the one failure are
  attributed; two `respond` events were missing from the tail. All 203 completed
  signatures verify. No diagnostic ran on staging.
- [x] Compare against the stated targets and write the final acceptance decision.
  **Not met** on 0.10.2: p99 5,966 ms and 5.4% above 4 s, against 4 s and 1%.

Check expected cost before the run and impose a fixed attempt cap. Do not run an
unbounded benchmark to improve confidence. Implement accepted improvements together
and isolate only demonstrated regressions. No standalone run is required for each
small structural saving.

## Completion

Close the plan when each investigation has evidence and each accepted fix passes
the relevant behavioral checks. Record measured outcomes against the targets.
If platform delays remain, identify their boundary and retain the support bundle.
An implementation can be complete while a latency target remains unmet.

Production deployment and package publication are separate release work.
This document authorizes neither a new deployment nor new infrastructure.

## Ownership and release boundary

R155H owns finalization CPU, result-independent preparation work, and respond
recovery. R155J owns the unresolved slow-attempt causes and final p99 acceptance.
Setup admission, rate limiting, earlier preflight, and the delivered failure-
propagation fix are completed implementations, not duplicate tasks to start again.

Use the user's existing authorization for live work; ask only for unresolved
material scope or actions outside it. This reconciliation authorizes no new
resource, migration, publication, or production deployment.
