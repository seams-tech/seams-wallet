# Refactor 151: reduce Gateway D1 round trips

Date: September 29, 2026

Status: policy, claim/readback, operation/source, and persisted owner-scope
consolidation are implemented and verified in bounded hosted diagnostics. The
latest reusable-session ECDSA Gateway prepare/finalize path makes five D1 calls
per signature for both canonical and linked signing. Canonical signing started at 18 calls; directly
linked signing started at 20 and third-generation signing at 24. The joined
linked-custody credential read removes the two-call linked surcharge. The policy
snapshot now removes two further calls while retaining the configured adapter
and verified material-scope boundary. Bounded first/warm/burst
diagnostics now have verified Tokyo, London, and US probe placement. Hosted linked
chains now pass in all three regions. The historical unlock timeout remains
unreproduced after five fresh successful attempts. The London
same-wallet placement comparison is complete: moving only the Gateway toward
D1 reduced database time but increased total signing time.
Cloudflare analytics now establish aggregate Gateway and role DO execution
locations for the regional cohort; individual RPC-to-DO attribution remains open.
Active/exhausted credentials are classified in one read. Material snapshots are
checked atomically at reusable-session claim and finalize/replay admission.
Reusable-session finalize resolves existing operations without admitting new
claims; a missing prepare cannot consume quota or create an audit event.
The supported call-budget reductions and explicit boundary deferrals are
recorded below. Regional databases are conditional. Production rollout
is separate.

## Current validation checkpoint

Five fresh Tokyo attempts on the diagnostic build completed unlock and all
25 signatures. The earlier timeout did not reproduce. Its retained evidence
records no successful automated unlock click, so a failed unlock network call
has not been established for that attempt. The probe now returns private
failure context and opt-in lifecycle traces; confirmation diagnostics retain
the last interaction error.

A separate local behavioral E2E deliberately interrupts the first unlock
verification request before forwarding it. The auth menu shows `Failed to fetch`;
the user refreshes preparation and confirms a fresh passkey attempt. Exactly
two verification requests are observed, and subsequent NEAR and ECDSA signatures
verify. This validates the visible-error/retry path without claiming to repair
the historical hosted timeout. Evidence:
`.artifacts/r151/passkey-unlock-network-failure-recovery.json`.

The earlier Tokyo cohort retained seven calls/eight statements/two write-bearing
calls per timed signature. SDK medians are 2.74 seconds first, 2.16 seconds warm,
and 4.86 seconds per burst call. One background refill reports
`wallet_session_unavailable`; none of the measured signatures has a foreground
refill fallback. Its SDK differs from the preceding cohort, so keep the samples
separate. Evidence: `.artifacts/r151/regional-unlock-20260930-r8/`. Original
Worker versions/images, an inactive probe, expired access, and credential scans
are verified; observed cumulative spend was $0.7673.

Linked signing now records SDK and transaction-completion timing on both owner
and linked-authority paths. The nine-signature three-device E2E passes on
Workers D1, wallet-DO, and VM, for 27 verified signatures. The shared completion
timer previously omitted the linked-authority branch; signing behavior is
unchanged. Evidence: `.artifacts/r151/linked-timing-20260930/`.

The committed `tests/r150-hosted/probe/measure-placement.mjs` query reads
Cloudflare's execution-location dimensions for the isolated benchmark. Across
the preceding regional cohort, Gateway invocations ran in NRT, LHR, and ORD.
Role DO invocations also include KIX and, for the signing worker, AMS. Adaptive
aggregate counts identify execution locations without proving every request's
individual route. Evidence:
`.artifacts/r151/regional-workloads-20260930-r7/placement-complete.json`.

Two subsequent hosted preflights dispatched no wallet operations. The first
exceeded the ten-minute image rollout gate in Tokyo. After full restoration, a
fresh preflight reached completed Tokyo/London image versions, while the US
rollout reported a failed instance and zero healthy target instances. A read-only
restart returned HTTP 500; the preflight was stopped. Both cohorts restored
original Worker versions and images, inactive probes, expired access, and
unchanged Gateway placement. The evidence scan found no benchmark tokens.
Observed cumulative spend was $0.8141, subject to accounting lag.
These are infrastructure failures, separate from the historical unlock timeout.
Evidence: `.artifacts/r151/regional-placement-20260930-r9/` and
`.artifacts/r151/regional-placement-20260930-r10/`.

The committed linked workload and same-wallet placement controller are ready.
The placement controller pauses between default and Tokyo Gateway deployments,
then measures warm signatures with the same wallet/session and persistent
custody ownership; one-use signing material differs between signatures.
The independent London cohort subsequently completed nine linked signatures
and three same-wallet placement pairs (18 signatures total), using frozen source
`f7f12c28`. Canonical signing retained seven calls/eight statements; both linked
generations retained nine calls/12 statements. Every timed signing request used
the APAC primary, with two write-bearing calls and 14 reported row writes per
complete signature.

| Median per warm signature, three pairs | Default Gateway | Tokyo Gateway |
| --- | ---: | ---: |
| Complete public SDK call | 4,650 ms | 6,627 ms |
| SDK commit | 3,053 ms | 4,163 ms |
| Summed D1 call wall time | 2,007 ms | 584 ms |
| Summed D1 SQL time | 12.34 ms | 13.24 ms |
| Gateway prepare + finalize | 2,167 ms | 2,863 ms |
| Gateway custody proxy stages | 160 ms | 2,239 ms |

All three pairs became slower end to end. D1 wall time fell by 71%, while the
median public SDK time rose by 43%. Version-specific adaptive analytics place
every measured default Gateway deployment in LHR and every Tokyo deployment in
NRT; per-request placement headers were unavailable. DO analytics contain LHR,
AMS, NRT, and KIX, without per-signature attribution. The same wallet/session and
persistent custody ownership were retained within each pair. Distinct one-use
material was consumed per signature. Default always preceded Tokyo, so order and
time effects remain possible; this is a bounded diagnostic, not a tail guarantee.

Keep the Gateway near its existing custody path. Moving the Gateway alone does
not meet the complete latency target. R152 can evaluate bringing an authoritative
regional D1 primary near that path, with its ownership and atomic quota constraints.
No regional-D1 gain has been measured or database provisioned. Evidence:
`.artifacts/r151/regional-placement-20260930-r11/`. Original versions, images,
Gateway placement, inactive probes, and expired access were verified after the run.

The hosted linked baseline also identified a cold-material cost: first linked
signatures spent 11.66 and 13.44 seconds in foreground generation. Later linked
signatures were much faster. Linked activation now schedules background prefill,
and inventory requests
explicitly select the same signing authority as generation to prevent channel
initialization from invalidating a refill. The enhanced three-device E2E passes
on Workers D1, wallet-DO, and VM (27 signatures); each linked first signature
consumes material completed before signing. Canonical retained-material unlock
and first/warm/concurrent-burst E2Es also pass. Commit: `57388d7f`. Evidence:
`.artifacts/r151/linked-prefill-20261001/`. Keep the readiness-gated changed-build
results separate from the baseline immediate-signing workload.

Tokyo and US frozen-baseline linked chains subsequently completed another
18 signatures, with verified NRT/ORD probe locations. First linked signatures
spent about 6.2 seconds (Tokyo) and 12.6 seconds (US) in foreground generation.
Later linked calls ranged from 1.67–1.87 seconds and 3.78–4.26 seconds respectively.
Both generations retain nine calls/12 statements, and every signing request
used the APAC primary. Evidence:
`.artifacts/r151/regional-placement-20260930-r12/`.

The changed London cohort (`57388d7f` SDK, frozen `f7f12c28` Gateway) passed all
nine signatures. Both linked first signatures consumed IDs completed before
signing, with no foreground refill; first ready-pool SDK calls were 3.74 and
3.40 seconds. Linked subsequent calls ranged from 3.04–3.99 seconds. D1 budgets
remained seven/nine calls, with APAC primary service. The test explicitly waits
for background readiness before signing. Its timings verify ready-pool behavior;
they are not an immediate-post-link latency comparison or evidence that
preprocessing cost disappeared. Evidence:
`.artifacts/r151/regional-linked-prefill-20261001-r13/`. Original Worker
versions/images, default Gateway placement, inactive probes, and expired access
were verified after restoration. Evidence scans found no benchmark credentials.
Observed cumulative cost is $0.907 against $25, subject to accounting lag.

The next Gateway change (`09608843`) joins linked installation and canonical-source
records into the credential statement. Existing scope/package/chain validation
and atomic material-freshness checks remain in force. All 27 local E2Es pass
across Workers D1, wallet-DO, and VM, including policy denials, retirement races,
revocation, last-quota contention, missing prepare, and exact lost-response replay.

The frozen London follow-up retains the `57388d7f` SDK and role deployments:
three attempts, 27 verified signatures, no failed attempts or foreground refills.
That cohort recorded **seven D1 calls / eight statements**, including both
linked generations, with two write-bearing calls and 14 reported row writes.
All signing SQL results report the APAC primary.

| Linked ready-pool signing | Previous Gateway, n=6 | Joined read, n=18 |
| --- | ---: | ---: |
| D1 calls / statements | 9 / 12 | 7 / 8 |
| Median public SDK call | 3,517 ms | 3,061 ms |
| Median summed D1 wall time | 2,477 ms | 2,073 ms |
| Median summed SQL execution | 15.10 ms | 13.21 ms |
| Observed public SDK range | 3,044–3,993 ms | 2,786–5,225 ms |

Canonical calls remained seven at that checkpoint, with SDK median 4,319 → 4,244 ms and D1 median
1,832 → 1,814 ms. These are separate fresh-wallet cohorts at different times,
with readiness waits before signing and automatic confirmation inside SDK timing.
The linked SDK median improves about 13%; neither that diagnostic nor the small
sample establishes the 1–2 second target. Keep the 5,225 ms outlier: its existing
admission batch took 2,475 ms, while the joined credential read took 385 ms.
Version-specific adaptive analytics locate the changed Gateway in LHR; role DO
aggregates span LHR/AMS/NRT/KIX without individual RPC attribution. Evidence:
`.artifacts/r151/regional-linked-read-20261001-r14/`, including `comparison.json`,
`placement.json`, and individual request traces. Final restoration verifies
original versions/images, inactive probes, default placement, and expired access;
see `restoration-final.json`. Observed cumulative cost is $0.9401 against $25,
subject to accounting lag.

### Policy snapshot follow-up

Commit `78a6a4c2` completes the previously deferred policy/material boundary.
All 30 local scenario/profile checks and 27 hosted signatures pass. Canonical
and both linked generations now use **five Gateway prepare/finalize D1 calls /
six statements**, retaining two write-bearing calls and 14 reported row writes.
In the bounded London comparison, canonical SDK median fell 4.244 → 3.655 seconds;
linked median fell 3.061 → 2.512 seconds. The SDK image and role builds were held
fixed; fresh wallets and times differ. These are ready-material measurements
with automatic confirmation, and the complete 1–2 second maximum remains unmet.
See [the policy-read evidence](refactor-151-policy-read.md) for scope validation,
latency stages, retained failures from local verification, and benchmark limits.
Original Workers/images and inactive probes are restored; observed cumulative
benchmark spend is $0.9873, subject to accounting lag.

### Session-status follow-up

The SDK follow-up `a2c936ed` reuses the authorization already read during lane
selection. It removes one duplicate pre-confirmation status request and retains
the post-confirmation refresh. The ECDSA-only owner workload now reads status
twice per signature; linked signing retains its existing path. Commit `dad8f5e9`
also joins canonical ECDSA material into each status read, preserving the
configured signer scope and existing material validation. The final change
passes 23 scenario/profile checks across Workers D1, wallet-DO, and VM, including
both Workers NEAR-promotion races. See [the session-read evidence](refactor-151-session-read.md)
for the request inventory, confirmation-boundary proof, and Email OTP
verification limitation.

Two controlled London follow-ups each verify 27/27 signatures. The SDK reuse
reduces owner SDK median from 3,654.6 to 3,123.6 ms; the subsequent status/material
join reduces it to 2,680.5 ms (26.7% lower across both changes). Linked median
stays near 2,487 ms. The full ready-material owner inventory now has **seven D1
calls / eight statements**, including two status calls; both linked generations
have **five calls / six statements**. Each retains two write-bearing calls and
14 reported row writes. All SQL metadata reports the APAC primary. The bounded
owner range is 2,562.6–2,751.6 ms and linked range 2,209.2–2,686.5 ms, so the
complete 1–2 second target remains unmet. The five-call prepare/finalize budget
continues to describe only those two HTTP requests.
Original Workers/images, inactive probes, default placement, and expired access
are verified after both cohorts. Latest observed cumulative benchmark spend is
$1.0530 against $25, subject to accounting lag.

### Remaining work

The credential/material/policy consolidation is implemented. Its verification
is recorded in [the policy-read evidence](refactor-151-policy-read.md). The
following outcome and follow-up gates remain open:

1. Evaluate an isolated regional primary under R152: moving the Gateway alone
   worsened total latency. Prove the ownership boundary before provisioning or
   implementation; a regional-D1 benefit has not been measured.
2. The 1–2 second complete signing target remains unmet. Use the recorded stages
   to select the next demonstrated bottleneck and expand controlled sampling.
   Five Gateway prepare/finalize calls is the adopted budget; a theoretical
   minimum remains unproven. The SDK request inventory and duplicate
   pre-confirmation status-read reduction are implemented; the fresh
   post-confirmation status read remains. Its sequential canonical-material
   lookup is now joined into the status statement. Continue measuring the
   complete path and other costs outside prepare/finalize. The
   linked-source and policy/material joins are implemented and verified.
3. Retain failure context if unlock stalls again; diagnose the observed failure
   before changing retry behavior. Five fresh successful attempts did not
   reproduce it. Visible network failure and explicit retry are E2E-verified.
4. Production rollout remains a separate decision.

## Decision

Reduce sequential Gateway D1 calls before introducing regional D1 ownership.
Retain the authoritative admission and durable completion writes. Measure again
after consolidation, then decide whether Gateway placement or regional D1
databases justify their operational complexity.

The target remains 1–2 seconds for the complete system-controlled signing path,
including SDK orchestration, authorization, presign waiting, prepare/finalize,
and verified signature return. Human decision time and transaction broadcasting
are measured separately. A faster Gateway alone does not establish this target.

## Evidence

Three fresh-wallet registration flows each completed a first and a subsequent
ECDSA signature against the existing isolated DO benchmark stack. All six
signatures verified. The diagnostic ran September 29, 2026, 13:15:37–13:16:48 UTC.

| Per complete signature | First signing, n=3 | Subsequent signing, n=3 |
| --- | ---: | ---: |
| Sequential Gateway D1 calls | 18 each | 18 each |
| Calls reporting row writes | 2 each | 2 each |
| D1 reported rows written | 14 each | 14 each |
| D1 call elapsed time, median | 1,770 ms | 1,468 ms |
| D1 call elapsed time, range | 1,657–1,773 ms | 1,432–1,683 ms |
| D1 SQL execution time, median | 10.73 ms | 10.81 ms |
| Prepare + finalize server time, median | 1,964 ms | 1,853 ms |

Prepare and finalize were added within each signature before calculating medians.
All 108 D1 calls on those signing requests reported `served_by_region: APAC` and
`served_by_primary: true`. Their intervals were sequential; summed and covered
D1 wall time were equal. This is strong evidence for reducing round trips.
Elapsed time minus SQL execution includes transport, scheduling, binding, and
service overhead. It does not isolate geographic network latency.

Each prepare made these nine calls:

1. Read the joined Wallet Session, authority, auth method, and quota.
2. Read active wallet signer material.
3. Read project policy.
4. Read abuse policy.
5. Re-read fresh signer material before admission.
6. Look up the authorized operation for replay.
7. Insert its claim, enforcing admission and quota through SQL guards/triggers.
8. Read the committed operation back.
9. Read its pinned owner/environment scope.

Finalize also made nine calls: the first five above, followed by the existing
operation, its live authorization source, pinned owner scope, and completion
update with its durable replay response. Prepare reported 11 row writes and
finalize 3; these are D1 accounting values, not 14 independent application writes.

The wider request windows also captured 52 `/wallet/session/status` responses
across three registrations and six signatures. These included 122 D1 calls.
Presign fill requests made two D1 reads each. Those background requests have
separate owners and timing: do not add their durations to the signing critical
path without proving a dependency.

### Measurement boundaries and reproduction

- This is an operator-browser diagnostic, not a regional comparison. Browser,
  Gateway, and DO physical locations were not independently established. APAC is
  D1's reported serving region; it does not prove same-datacenter placement.
- The existing benchmark database and role Workers were retained. Only the
  isolated DO-arm Gateway was temporarily instrumented. No migrations, database
  creation, wallet resets, staging/production changes, or container restarts ran.
- Instrumented Gateway version: `8ab7912d-0e67-4f2f-a066-1aafced8a7c5`.
  Original version `e1fa8688-6f5a-45bf-862b-442241789e16` was restored after
  measurement; the active version and authenticated readiness were verified.
- Estimated cumulative benchmark cost was $0.6389 through 13:17:53 UTC,
  against the existing $25 cap. The cost report uses observed Cloudflare usage;
  accounting may lag recent requests.
- The preserved SDK build was used because the active SDK checkout had a
  concurrent, unrelated type error. SDK distribution SHA-256:
  `f271f7d8b3a29c30f01f62debddc1288c1187d6706d44ed8f38d78d691b8dd70`.
  Its exact build source is unproven; the content hash identifies the artifact.
  Do not combine these samples with the earlier R150 regional cohorts.
- Artifacts: `.artifacts/r150/d1-diagnostic-20260929/`, including `run-r2.json`,
  three full timing artifacts, and `analysis.json`. The earlier preflight attempt
  failed before wallet work because it inherited the wrong local app port; its
  outcome is retained separately. Private reproduction launcher:
  `.runtime/r150-d1-diagnostic/run-browser.mjs`; use a new run ID/output file for
  every attempt, and redeploy the measured benchmark Gateway first.
- The existing unforced registration-and-repeated-signing Playwright contract
  collects `X-Benchmark-D1`. Re-analyze with:

  ```sh
  node tests/r150-hosted/analyze-d1.mjs \
    .artifacts/r150/d1-diagnostic-20260929/gateway-ecdsa-*.json
  ```

- `node tests/r150-hosted/gateway/d1Trace.e2e.mjs` verifies the observer against
  real local D1: batch rollback, successful batch readback, first-row/column
  behavior, and concurrent request isolation. It writes
  `.artifacts/r150/d1-trace.e2e.json`.
- The observer/analyzer E2E, `pnpm -C tests type-check:intended`, and
  `pnpm report:bloat --check` passed. The SDK build failure was classified as an
  unrelated concurrent-work type error; its files were left to their owner.
- The observer records query hashes/table hints, intervals, batch membership,
  outcome, SQL duration, rows, retry attempts, serving region and primary status.
  It excludes SQL text, parameters, result rows, and error messages. Repeated
  hashes identify SQL shapes; their bound values may differ.
- D1 `first()` omits metadata, so the benchmark executes the identical SQL once
  through `all()` and projects its first row/column. No additional query is
  issued. This observer effect must remain explicit in comparisons.
- Missing metadata stays unknown. The wider windows contained 54 statements
  without SQL/row metadata; no complete-signature call lacked that metadata.
  Missing, pending, or truncated request traces fail analysis. Batched calls
  contribute one elapsed interval, with separate metadata per statement.

Cloudflare documents the returned metadata in
[D1 return objects](https://developers.cloudflare.com/d1/worker-api/return-object/).

## Implementation order

Completed implementation and measurement checkpoints are preserved in
[the evidence log](refactor-151-evidence.md), including the earlier seven-call budget,
refill fix, and regional cohorts. The [policy-read follow-up](refactor-151-policy-read.md)
records the five-call Gateway budget and current residual costs.
The [session-read follow-up](refactor-151-session-read.md) records SDK
authorization reuse, the status/material projection, and the wider Gateway
request inventory.

### 1. Consolidate reads while preserving decision boundaries

- [x] Classify active/exhausted credentials from one snapshot for ECDSA signing,
  retaining exact-operation admission and refusal of new exhausted-quota claims.
- [x] Read project and abuse policy together through the existing admission store.
  Both currently use the same SQL shape with different keys. Preserve rejection
  precedence and fresh policy evaluation for each operation. This should remove
  one round trip from prepare and one from finalize.
- [x] Consolidate the prepare claim and committed readback into one D1 batch.
  Read back after the INSERT triggers in the same transaction.
- [x] Reuse the committed row's pinned scope projection for reusable-session
  ECDSA, retaining the wallet guard and removing its separate prepare lookup.
- [x] Read the finalize operation and live authorization source together.
  Preserve replay-time revocation, expiry, wallet/environment binding, quota
  identity, and operation identity checks.
- [x] Consolidate reusable-session ECDSA finalize's pinned owner-scope read
  while retaining its exact operation/session/wallet binding guard.
- [x] Read and verify linked ECDSA installations once per material resolution,
  resolving custody ancestors from that set while preserving fresh admission reads.
- [x] Batch linked installations and canonical signer candidates into one custody
  snapshot per material resolution, retaining both fresh decision boundaries.
- [x] Bind verified canonical/linked material snapshots to atomic claim and
  existing-operation admission predicates; verify retirement races and remove
  the second reusable-session material resolver.
- [x] Examine joining initial material resolution to the existing joined session
  lookup. Preserve the complete material candidate set despite the session's
  `LIMIT 1`; retain current parsers, snapshot predicates, and denial precedence.
- [x] Implement and measure the signing-specific session/material projection,
  including the linked custody snapshot and verifying the admission races.
- [x] Use the existing store/domain boundaries and narrow admitted result types.
  Delete replaced paths. Do not add request-wide caches of revocation or quota
  decisions, compatibility branches, or another authorization implementation.

First measurable goal: at least two fewer sequential calls per signature from
the policy change. Then target 12 or fewer from the larger consolidation, subject
to the correctness cases below. Each change needs its own before/after call
counts and timings; these are engineering targets, not predicted latency wins.
The 12-call intermediate milestone is surpassed: canonical reusable-session
ECDSA and linked Gateway prepare/finalize now each take five calls. Phase 3
records the remaining dependencies and completed policy/material consolidation.

### 2. Reduce unnecessary work and classify writes

- [x] Record current-build status-request callers for the mixed-wallet refresh,
  warm-signing, and step-up lifecycle, with repeatable browser evidence.
- [x] Remove the second ECDSA preparation inventory read used only for generation
  metadata, retaining the inventory that selected the exact material candidate.
- [x] Reuse the already verified NEAR material returned by rehydration in its
  initiating caller; preserve fresh verification for joined callers.
- [x] Extend caller evidence with anonymous identity/frame grouping and completed
  request intervals; cover refresh and concurrent shared-budget signing.
- [x] Share the restore operation's status-read scope across per-chain prefills,
  preserving separate pool and material validation and fresh independent calls.
- [x] Trace display-request owners and remove the duplicated React preference
  reconciliation. Retain distinct auth/selection/initialization/application reads
  and fresh queued-material/server admission checks; revisit with hosted evidence.
- [x] Inventory all observed Gateway requests during ready-material signing,
  binding late responses to their initiating request and identifying refill
  activity explicitly. Preserve the prepare/finalize-only evidence projection.
- [x] Reuse the prepared lane's authorization before confirmation, retaining the
  fresh queued-material read after confirmation. Verify the live custom-review
  freshness boundary and mixed-wallet NEAR promotion.
- [x] Join canonical ECDSA material into the session-status snapshot using the
  configured signer scope and existing activation/conflict parser. Retain
  Ed25519 and installed-authority resolution and atomic signing admission.
- [x] Measure warm pool, immediate first sign, and burst signing separately in
  a bounded local diagnostic with signature and shared-quota verification.
- [x] Diagnose and fix the repeated linked-presign worker timeout/reset. Retire
  the stale authority channel and verify repeated three-device signing on
  Workers D1, wallet-DO, and VM, preserving per-signature D1 evidence.
- [x] Extend the hosted probe with first/warm/burst SDK timing and verify a
  bounded Tokyo diagnostic, retaining shared-quota and signature checks.
- [x] Gate measurements on completed image rollouts and collect bounded
  first/warm/burst evidence from verified Tokyo, London, and US probes.
- [x] Complete bounded hosted linked chains in Tokyo, London, and the US,
  preserving successful samples and failed preflights separately.
- [x] Reduce demonstrated linked cold-material waits with activation prefill,
  preserving distinct preprocessing and signing authorization boundaries. Verify
  the first signatures consume background-completed IDs across all backends.
- [ ] Diagnose the historical hosted unlock timeout if it reproduces. Five fresh
  Tokyo attempts passed; a deliberately failed network call shows a visible error
  and recovers through explicit user retry. No historical network failure is proven.
- [x] Inventory foreground Gateway signing writes by invariant: claim/idempotency,
  quota consumption, completion/replay, audit, and unrelated maintenance. The measured signing path
  has two write-bearing calls, both enforcing current behavior. No demonstrated
  redundant signing write is approved for deletion.
- [x] Report round trips, write-bearing calls, and D1 rows written separately.
  Batching saves calls; it does not itself eliminate writes. Preserve atomic
  quota effects, one-use material, audit semantics, and durable response replay.

### 3. Revisit the minimum signing call budget

Revisit this after phases 1 and 2, before deciding on regional D1 provisioning.
The remaining foreground calls per signature remain expensive relative to the
small amount of SQL work. Reaching 12 calls does not close this follow-up.

- [x] Map every remaining foreground D1 call to the invariant it enforces and
  the point at which its data must be fresh. Identify dependencies introduced
  by store boundaries that can be removed without weakening those invariants.
- [x] Evaluate a roughly three-round-trip design for a successful signature:
  prepare validates authority/policy/material and atomically claims the operation
  with quota consumption; finalize resolves the claim and checks live authority
  and material before signing; completion durably records the replay response.
  This is a design hypothesis, not a proven minimum or a promise of three calls.
  Document any additional round trip that correctness requires.
  The September 30 design review records current material-verification and
  completion dependencies and the next seven-call canonical candidate.
- [x] Separate finalize's existing-operation resolution from prepare admission.
  Verify that missing finalize cannot create a claim or consume quota before
  consolidating prepare's guarded claim and live readback.
- [x] Batch prepare's guarded claim and live readback, preserving explicit
  duplicate-insert failure for export-owned prepared transactions. Measure
  skipped replay INSERTs separately from calls reporting row writes.
- [x] Consolidate the supported reads and guarded writes around those decision points using
  the existing stores and SQL transactions. Preserve rejection precedence,
  tenant/environment binding, expiry/revocation checks, material retirement,
  one-use material, atomic quota consumption, and exact durable replay.
- [x] Prioritize read round trips. Retain the admission and completion writes
  unless an equivalent durable invariant is demonstrated. Count calls, SQL
  statements, write-bearing calls, and reported row writes separately.
- [x] Verify concurrent last-quota contention, duplicate admission, revocation
  and retirement races, and lost-response replay with behavioral E2Es. Measure
  successful signing, replay, and rejection paths separately; retain repeatable
      before/after artifacts. Complete latency evidence is tracked below.
- [x] Join linked custody evidence into the credential read, preserving scope,
  package-digest, chain-identity, and atomic record-set validation. Verify seven
  calls/eight statements for canonical and both linked generations in a hosted cohort.
- [x] Include project/abuse policy candidates in the credential read, then select
  the verified material scope through the configured adapter. Preserve database
  and namespace ownership, denial precedence, and fresh reads on replay.
- [x] Close the supported-reduction review after implementing those reductions and
  recording the resulting call budget, the reason for each remaining round
  trip, and any explicitly deferred blocker. A green latency median alone does
  not establish that the call budget or the 1–2 second maximum is satisfied.

The adopted Gateway prepare/finalize budget is **five calls / six statements**
for both canonical and linked signing, with two write-bearing calls and 14
reported row writes. Prepare reads credential/material/policy together, then
atomically claims/readbacks the operation. Finalize reads a fresh combined
snapshot, resolves the existing operation/source, and durably records completion.
Linked package digests, chain identity, and material scope are verified before
policy evaluation. Atomic admission/finalize checks reject changed material
record sets. These dependencies remain candidates for further measured review.

The previously deferred policy/material boundary is now implemented. The
credential query projects decisions for persisted signer scopes; verified
material selects the applicable decision. The configured adapter checks the
snapshot's database and namespace, then the wallet, activation, and scope. A
separately configured store reads its own policy. Both durable writes remain.
See [the policy-read evidence](refactor-151-policy-read.md) for the contract,
30 browser scenario/profile checks, and hosted call/latency results.

The retained prepare-batch E2E artifacts contain four baseline and 22 changed-build
scenario/profile checks; the policy cohort adds 27 denial checks and 18 verified
signatures across Workers D1, wallet-DO, and VM. They cover last-quota contention,
duplicate admission, missing prepare, retirement, revocation, and exact replay.
Those earlier checkpoints retain their recorded source hashes; the linked
credential projection is changed by `09608843`. Evidence: `.artifacts/r151/prepare-batch-20260930/` and
`.artifacts/r151/policy-20260930/` and `.artifacts/r151/linked-read-20261001/`.
Latency and regional-D1 placement remain separate open gates.

### 4. Reassess placement using measured residual cost

The controlled placement experiment and conditional regional ownership design
are tracked in [R152: regional D1](refactor-152-regional-D1.md). R151 supplies
the residual call budget and latency evidence required for that decision.

- [x] Repeat with fixed SDK/role builds and verified probe locations, recording
  per-call D1 region/primary metadata and actual Gateway/DO placement evidence.
      The regional cohort's adaptive analytics establish aggregate execution
      locations; individual signing-RPC/DO attribution remains unproven.
- [x] Compare a Gateway near the existing D1 primary against the current path
  before changing data ownership. Measure complete signatures, including the
  resulting Gateway-to-DO leg.
- [ ] Propose regional D1 shards only if residual remote-primary calls still
  prevent the complete latency target and a controlled regional experiment
  demonstrates a material improvement. Choose an ownership unit containing all
  atomic policy/quota state; shared tenant quotas may require tenant ownership.
- [ ] Any regional design has one authoritative home per wallet/tenant, stable
  trusted routing, and explicit single-writer migration/failover rules. Define
  those boundaries before implementation. Independent active writable copies of
  the same authority are outside this plan.

[D1 read replicas](https://developers.cloudflare.com/d1/best-practices/read-replication/)
still send writes to the primary. Session bookmarks alone do not guarantee
observing another session's latest revocation. Read replication cannot replace
the authoritative admission checks. Matching
[D1 placement hints](https://developers.cloudflare.com/d1/configuration/data-location/)
also provides no exact-colocation guarantee.

## Verification and completion

- [x] Extend/reuse behavioral E2Es for concurrent last-quota admission, revocation
  and material retirement between authorization and admission, exact prepare
  replay, and lost finalize response followed by durable replay. Verify unchanged
  keys/signatures, one quota consumption, no repeated custody effect, and refusal
  of changed operation/environment inputs.
- [x] Exercise the shared behavior on Workers D1, the wallet-DO composition, and
  the VM reference wherever a shared store/domain contract changes. Use existing
  type fixtures for changed domain-state rejection guarantees; add no unit tests.
- [x] Produce repeatable artifacts containing build identities, call traces,
  signature verification, quota/replay outcomes, and measured before/after totals.
- [x] Record complete public SDK signing latency alongside server stages for
  canonical first/warm/burst and regional linked signing. Automatic confirmation
  is included. Neither these small cohorts nor their medians establish a
  1–2 second maximum; the target remains unmet.
- [x] Keep new hosted cohorts separate from R150's preserved comparison and its
  unresolved ENAM infrastructure failure. Maintain the existing Cloudflare-only,
  isolated-resource, $25 cap. Production rollout requires its own decision.

The measured evidence warrants this round-trip reduction plan. Regional database
provisioning remains conditional; this diagnostic does not establish its benefit.
