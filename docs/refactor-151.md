# Refactor 151: reduce Gateway D1 round trips

Date: September 29, 2026

Status: the combined project/abuse policy read is implemented and verified in a
bounded hosted diagnostic. Further query consolidation, write changes, and
regional databases remain planned. Production rollout is separate.

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

### Completed checkpoint: combined policy read

The admission store now returns one policy decision from one query. Two exact
primary-key joins fetch project and abuse policy together. Missing records allow
the request; a present malformed record fails closed. Project rejection retains
precedence, including over a malformed abuse record. Expired requests still fail
before storage access. The separate provider/read interfaces have been removed
from the store and its public exports.

The local HTTP/D1 policy scenario and the VM SQLite and in-memory adapters cover
both ECDSA and Ed25519 policy inputs, live changes, project/abuse precedence,
wallet/environment/version/namespace isolation where applicable, expiry, and
malformed records. Type fixtures reject invalid allowed/rejected combinations.
Reproduce with `node tests/r150-hosted/gateway/admissionPolicy.e2e.mjs`; evidence
is `.artifacts/r150/admission-policy/result.json`.

Three further hosted registrations and six verified ECDSA signatures used the
same SDK distribution hash as the initial diagnostic, unchanged role Workers,
and instrumented Gateway `0385b2db-497f-411b-9e98-9811fb9cfccd`. They ran
13:36:43–13:37:55 UTC on September 29, 2026. Artifacts and the run provenance are
in `.artifacts/r150/d1-policy-20260929/`; the private launcher is
`.runtime/r150-d1-diagnostic/run-policy-browser.mjs`.

| Per complete signature | Before | Combined policy read |
| --- | ---: | ---: |
| D1 calls, every signature | 18 | 16 |
| Write-bearing calls / reported row writes | 2 / 14 | 2 / 14 |
| First-sign D1 elapsed median | 1,770 ms | 1,231 ms |
| Subsequent-sign D1 elapsed median | 1,468 ms | 1,175 ms |
| First-sign server median | 1,964 ms | 1,496 ms |
| Subsequent-sign server median | 1,853 ms | 1,335 ms |
| First-sign server range | 1,961–2,132 ms | 1,368–3,475 ms |
| Subsequent-sign server range | 1,666–2,044 ms | 1,318–3,658 ms |

All 96 signing-path calls reported the APAC primary. Each stage has three
samples. The third new run was slower and remains included. The two-call
reduction is established; the latency difference cannot be attributed wholly to
this change from these sequential small cohorts. The 1–2 second maximum remains
unmet, even on server-only timing. The benchmark Gateway is restored to its
original version after the diagnostic.

Server and intended-test type checks, policy adapter scenarios, and the bloat
check pass.

### Completed checkpoint: batched claim and readback

Admission now sends its guarded INSERT and committed-row SELECT in one D1
batch. The SELECT observes the admission triggers' effects. Existing replay
lookup, fresh material predicates, quota triggers, race recovery, and rejection
classification remain in place. The statements live in a focused SQL module
extracted from the authorization store. No schema or write semantics changed.
[D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
execute statements in order and roll back the sequence on statement failure.
The pinned owner-scope projection remains a separate read.

The browser contract now sends two concurrent identical prepares, loses the
successful finalize response, and retries it exactly. Workers D1, wallet-DO,
and VM runs each produced one 200 prepare, one `operation_in_progress` 409,
and a successful retry with the identical stored signature. VM database
evidence shows quota changing from 3 to 2 and exactly one SigningWorker effect
and consumed presignature. This covers duplicate admission; concurrent distinct
operations competing for the last quota use remain a separate planned case.

Reproduce the scenario with the isolated runner and grep
`concurrent prepare and admitted ECDSA` in
`tests/e2e/intended-behaviours/passkey.presign-pool.contract.test.ts`.
Use the default Workers profile, then
`ROUTER_AB_WORKER_BUILD_PROFILE=dev ROUTER_AB_WALLET_DO_HARNESS=enabled`,
then `SEAMS_INTENDED_WALLET_HOST=vm`. Build the corresponding role binaries
before setting `SEAMS_INTENDED_SKIP_BUILD=1`. Missing local DO/VM binaries
initially prevented startup; rebuilding them resolved those infrastructure
failures. SDK/server builds, server/intended-test type checks, and the bloat
check pass.

Three hosted registrations and six verified signatures ran
13:58:29–13:59:31 UTC on September 29, 2026, using the same preserved SDK hash
and role Workers as the preceding diagnostics. Instrumented Gateway version:
`43a6b97c-4329-4f6d-868c-226acf1ccb42`. Evidence is in
`.artifacts/r150/d1-batch-20260929/`; the private reproducer is
`.runtime/r150-d1-diagnostic/run-batch-browser.mjs`.

| Per complete signature | Combined policy read | Batched claim/readback |
| --- | ---: | ---: |
| D1 calls, every signature | 16 | 15 |
| SQL statements | 16 | 16 |
| Write-bearing calls / reported row writes | 2 / 14 | 2 / 14 |
| First-sign D1 elapsed median | 1,231 ms | 1,077 ms |
| Subsequent-sign D1 elapsed median | 1,175 ms | 1,091 ms |
| First-sign server median | 1,496 ms | 1,330 ms |
| Subsequent-sign server median | 1,335 ms | 1,289 ms |
| First-sign server range | 1,368–3,475 ms | 1,263–1,379 ms |
| Subsequent-sign server range | 1,318–3,658 ms | 1,224–1,298 ms |

All 96 statement results across the 90 signing-path D1 calls reported the APAC
primary. SQL execution medians were 12.35 ms and 13.17 ms. Full browser-flow
windows remained 3,526–8,863 ms for first signing and 3,552–8,133 ms for
subsequent signing. Those windows include test/UI orchestration and background
work; local binary builds also overlapped the diagnostic. They do not isolate
the complete system-controlled signing span or establish the 1–2 second maximum.
These small sequential cohorts establish the call reduction; latency changes
remain observational.

The original benchmark Gateway was restored and authenticated readiness returned
204. Cumulative estimated benchmark cost was $0.6414 through 14:01:16 UTC, with
the existing accounting-lag caveat and $25 cap. The ENAM failure and earlier
regional cohorts remain separate. Next consolidate pinned-scope/finalize reads,
trace repeated status-request owners, and isolate the remaining client-side
critical path before reassessing placement.

### 1. Consolidate reads while preserving decision boundaries

- [x] Read project and abuse policy together through the existing admission store.
  Both currently use the same SQL shape with different keys. Preserve rejection
  precedence and fresh policy evaluation for each operation. This should remove
  one round trip from prepare and one from finalize.
- [x] Consolidate the prepare claim and committed readback into one D1 batch.
  Read back after the INSERT triggers in the same transaction.
- [ ] Reuse the committed row's pinned scope projection where the existing
  guard can be retained, removing its separate lookup.
- [ ] Join the finalize operation, live authorization source, and pinned scope
  reads where they can enforce the same predicates. Preserve replay-time
  revocation, expiry, wallet/environment binding, and operation identity checks.
- [ ] Examine joining initial material resolution to the existing joined session
  lookup. Keep the fresh-material check at admission until equivalent atomic SQL
  predicates and race behavior are demonstrated. Two material reads at different
  decision points are not automatically redundant.
- [ ] Use the existing store/domain boundaries and narrow admitted result types.
  Delete replaced paths. Do not add request-wide caches of revocation or quota
  decisions, compatibility branches, or another authorization implementation.

First measurable goal: at least two fewer sequential calls per signature from
the policy change. Then target 12 or fewer from the larger consolidation, subject
to the correctness cases below. Each change needs its own before/after call
counts and timings; these are engineering targets, not predicted latency wins.

### 2. Reduce unnecessary work and classify writes

- [ ] Trace the SDK owners of repeated session-status requests. Coalesce
  overlapping requests with the same semantics and reuse already returned
  display data where valid. Keep server-side authorization fresh at admission.
- [ ] Measure warm pool, immediate first sign, and burst signing separately.
  Keep presign refill off the foreground wait using the established machinery.
  Preserve the distinct presign and signing authorization boundaries.
- [ ] Inventory writes by invariant: claim/idempotency, quota consumption,
  completion/replay, audit, and unrelated maintenance. The measured signing path
  has two write-bearing calls, both enforcing current behavior. No demonstrated
  redundant signing write is approved for deletion.
- [ ] Report round trips, write-bearing calls, and D1 rows written separately.
  Batching saves calls; it does not itself eliminate writes. Preserve atomic
  quota effects, one-use material, audit semantics, and durable response replay.

### 3. Reassess placement using measured residual cost

- [ ] Repeat with fixed SDK/role builds and verified probe locations, recording
  per-call D1 region/primary metadata and actual Gateway/DO placement evidence.
- [ ] Compare a Gateway near the existing D1 primary against the current path
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

- [ ] Extend/reuse behavioral E2Es for concurrent last-quota admission, revocation
  and material retirement between authorization and admission, exact prepare
  replay, and lost finalize response followed by durable replay. Verify unchanged
  keys/signatures, one quota consumption, no repeated custody effect, and refusal
  of changed operation/environment inputs.
- [ ] Exercise the shared behavior on Workers D1, the wallet-DO composition, and
  the VM reference wherever a shared store/domain contract changes. Use existing
  type fixtures for changed domain-state rejection guarantees; add no unit tests.
- [ ] Produce repeatable artifacts containing build identities, call traces,
  signature verification, quota/replay outcomes, and measured before/after totals.
- [ ] Record complete system-controlled signing latency alongside server stages;
  neither a median nor a server-only measurement establishes a 1–2 second maximum.
- [ ] Keep new hosted cohorts separate from R150's preserved comparison and its
  unresolved ENAM infrastructure failure. Maintain the existing Cloudflare-only,
  isolated-resource, $25 cap. Production rollout requires its own decision.

The measured evidence warrants this round-trip reduction plan. Regional database
provisioning remains conditional; this diagnostic does not establish its benefit.
