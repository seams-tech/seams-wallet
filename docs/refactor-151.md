# Refactor 151: reduce Gateway D1 round trips

Date: September 29, 2026

Status: policy, claim/readback, operation/source, and persisted owner-scope
consolidation are implemented and verified in bounded hosted diagnostics. The
latest canonical reusable-session ECDSA path makes seven D1 calls per
signature, down from 18, confirmed in a fresh hosted diagnostic. Local
linked-device checkpoints reduce third-generation signing from 24 to nine calls
and directly linked signing from 20 to nine. Bounded first/warm/burst
diagnostics now have verified Tokyo, London, and US probe placement. Linked
latency, an observed unlock timeout, and the placement comparison remain open;
Gateway and DO execution placement is still unverified.
Active/exhausted credentials are classified in one read. Material snapshots are
checked atomically at reusable-session claim and finalize/replay admission.
Reusable-session finalize resolves existing operations without admitting new
claims; a missing prepare cannot consume quota or create an audit event.
The minimum-call-budget design review is recorded below; implementation and
measurement remain open. Regional databases are conditional. Production rollout
is separate.

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

### Completed checkpoint: operation and live-source read

Admission now reads the existing operation and evaluates its live authorization
source in one SQL query. The reusable-session branch retains the exact owner
scope, tenant, principal, quota identity, expiry, retirement, authority digest,
revocation epoch, and active auth-method predicates. The step-up branch retains
its exact evidence identity, operation digests, assurance, and expiry predicates.
The existing completed-step-up replay rule is unchanged. The separate source
query has been deleted; no authorization cache or public domain-type change was
introduced. The pinned scope lookup still verifies the operation/session/wallet
binding and remains a separate call.

Three existing browser scenarios passed on each of Workers D1, wallet-DO, and
VM (nine scenario/profile combinations): concurrent prepare with lost-finalize
replay; recovery retiring material while a finalize is delayed; and page refresh
with warm-budget signing, one-use step-up, and key export. VM replay evidence
again records quota 3 → 2 and one SigningWorker effect. The Workers step-up case
was rerun cleanly after a concurrent server build caused a transient dev-server
reload error. Server build/type check and the bloat check pass.

Run the isolated test runner with `passkey.presign-pool.contract.test.ts`,
`passkey.recovery.contract.test.ts`, and `passkey.unlock.contract.test.ts` under
`tests/e2e/intended-behaviours/`, selecting:

```text
--grep 'concurrent prepare and admitted ECDSA|a recovery retires the replaced activation|page refresh hydrates warm signing'
```

Use the three host profiles described in the preceding checkpoint. Reproduction
commands, source hashes, and verification results are in
`.artifacts/r150/d1-source-20260929/verification.json`; local lifecycle traces
remain private under `.runtime/r150-d1-diagnostic/source-traces/`.

Three hosted registrations and six verified signatures ran
14:23:56–14:24:50 UTC on September 29, 2026, with the same preserved SDK hash and
role Workers. Instrumented Gateway version:
`9e5dc644-0d9c-4627-810d-52d3916c6041`. Evidence is in
`.artifacts/r150/d1-source-20260929/`; private reproduction launcher:
`.runtime/r150-d1-diagnostic/run-source-browser.mjs`.

| Per complete signature | Batched claim/readback | Combined operation/source read |
| --- | ---: | ---: |
| D1 calls, every signature | 15 | 14 |
| SQL statements | 16 | 15 |
| Write-bearing calls / reported row writes | 2 / 14 | 2 / 14 |
| First-sign D1 elapsed median | 1,077 ms | 1,025 ms |
| Subsequent-sign D1 elapsed median | 1,091 ms | 1,002 ms |
| First-sign server median | 1,330 ms | 1,300 ms |
| Subsequent-sign server median | 1,289 ms | 1,178 ms |
| First-sign server range | 1,263–1,379 ms | 1,229–1,425 ms |
| Subsequent-sign server range | 1,224–1,298 ms | 1,163–1,541 ms |

Prepare and finalize each make seven D1 calls. All 90 statement results across
84 signing-path calls reported the APAC primary. SQL execution medians were
15.09 ms and 14.04 ms. Browser-flow windows were 3,037–3,792 ms for first signing
and 3,055–3,792 ms for subsequent signing; these include test/UI orchestration
and background work. The complete system-controlled maximum remains unproven.
Small sequential cohorts establish the call reduction; latency differences
remain observational. No local binary builds overlapped this hosted run.

The original benchmark Gateway was restored and authenticated readiness returned
204. Estimated cumulative cost was $0.6427 through 14:27:20 UTC, subject to
accounting lag and the existing $25 cap. Next remove the pinned-scope round trips
through an explicitly verified persisted binding, preserving its wallet guard,
then revisit the session/material reads and repeated status-request owners.
The deferred minimum-call-budget phase remains open.

### Completed checkpoint: persisted owner scope in admission

Reusable-session ECDSA admission now carries the verified persisted owner scope
in its claimed/in-progress result. The existing operation read and the batched
claim readback project the Wallet Session's wallet ID through the exact
namespace, tenant, authorization, and persisted organization/project/environment
binding. The store checks that wallet ID against the resolved material before
returning scope. Prepare and finalize reuse this result, removing their separate
scope lookups. The route retains its material-policy scope check.

The narrow entry point requires a reusable-session ECDSA operation and material.
It preserves the existing reusable-route material input and fresh resolver.
The first version of this entry point explicitly selected the registration-only
guarded INSERT; the linked-device follow-up below corrects that regression. Generic and one-use step-up admission
remain supported through their existing entry point. NEAR and step-up retain
their separate scope reader, which now shares the persisted projection and
preserves its operation/source identity checks. Raw storage rows stay private
to the store. Type fixtures reject unscoped claims, scope-bearing replay,
rejections retaining an operation/scope, generic admission inputs, and raw
storage values.

The same three browser scenarios passed on Workers D1, wallet-DO, and VM (nine
scenario/profile combinations). The concurrent-prepare/lost-response scenario
now also changes the finalize wallet ID, observes a 403, then confirms that an
exact retry still returns the identical signature. VM evidence measured after
these retries retains quota 3 → 2 and one SigningWorker effect/consumed
presignature. Recovery retirement, warm signing, one-use step-up, and key export
also pass. Server build, intended-test type check, and the bloat check pass.
Use the preceding checkpoint's reproduction commands; source hashes and results
are in `.artifacts/r150/d1-scope-20260930/verification.json`. Lifecycle traces
remain private under `.runtime/r150-d1-diagnostic/scope-traces/`.

Three hosted registrations and six verified signatures ran
15:09:10–15:10:07 UTC on September 29, 2026, with the same preserved SDK hash and
role Workers. The artifact directory uses the operator's September 30 local
date. Instrumented Gateway version: `f764a7fc-4408-4a4f-9bbe-c250194ff37d`;
Gateway bundle SHA-256:
`a1c31317c59741175c2e92e23a75c86aeac06f85b68876f3f504496fe2574c3f`.
Evidence is in `.artifacts/r150/d1-scope-20260930/`; private reproducer:
`.runtime/r150-d1-diagnostic/run-scope-browser.mjs`.

| Per complete signature | Combined operation/source read | Persisted owner scope |
| --- | ---: | ---: |
| D1 calls, every signature | 14 | 12 |
| SQL statements | 15 | 13 |
| Write-bearing calls / reported row writes | 2 / 14 | 2 / 14 |
| First-sign D1 elapsed median | 1,025 ms | 865 ms |
| Subsequent-sign D1 elapsed median | 1,002 ms | 901 ms |
| First-sign server median | 1,300 ms | 1,111 ms |
| Subsequent-sign server median | 1,178 ms | 1,142 ms |
| First-sign server range | 1,229–1,425 ms | 1,073–1,735 ms |
| Subsequent-sign server range | 1,163–1,541 ms | 1,112–1,290 ms |

Prepare and finalize each make six D1 calls. All 78 statement results across
72 signing-path calls reported the APAC primary, with complete SQL/row metadata.
SQL execution medians were 15.35 ms and 14.47 ms. Browser-flow windows were
3,543–4,310 ms for first signing and 3,055–4,333 ms for subsequent signing;
these include test/UI orchestration and background work. The complete
system-controlled maximum remains unproven. These small sequential cohorts
establish the call reduction; latency differences remain observational. No local
binary builds overlapped this hosted run; physical probe location is unverified.

The original benchmark Gateway was restored, its active version verified, and
authenticated readiness returned 204. Estimated cumulative cost was $0.6441
through 15:14:55 UTC, subject to accounting lag and the existing $25 cap. The
12-call intermediate target is reached. Next examine the initial session/material
join, trace repeated status-request owners and the full system-controlled
critical path, then complete the deferred minimum-call-budget review before
considering regional D1 ownership. The deeper review stays open.

### Next consolidation boundary: material freshness and request ownership

The 12-call cohort leaves six calls in prepare and six in finalize:

| Decision | Prepare calls | Finalize calls | Required property |
| --- | ---: | ---: | --- |
| Joined session, authority, method, quota | 1 | 1 | Exact credential, live authority and quota identity |
| Initial material resolution | 1 | 1 | Full activation, normal-signing scope, canonical or linked custody source |
| Joined project/abuse policy | 1 | 1 | Fresh policy and rejection precedence |
| Fresh material resolution | 1 | 1 | Revalidate after policy evaluation before admission |
| Existing operation, live source, pinned scope | 1 | 1 | Exact replay identity, revocation/expiry, persisted wallet binding |
| Claim + committed readback / durable completion | 1 | 1 | Atomic quota claim / exact response replay |

The fresh material read cannot yet be removed. The existing-operation query
checks live authorization and persisted material identity; it does not check
that the material remains live. The conditional INSERT's signer predicate covers
registration records only. The material resolver also resolves installed linked
activations and follows their custody chain to the canonical signer. A session
join or admission predicate must preserve that behavior and conflicting-signer
checks before it can replace a resolver read.

The existing three-device ECDSA-only contract exposed a `production_regression`
in the persisted-scope checkpoint: explicitly selecting the registration-only
INSERT guard rejected Device 3's valid linked activation with `material_mismatch`.
The correction preserves the reusable route's established material input to
admission and its fresh resolver. The persisted owner-scope optimization remains.
This is a correctness correction; it adds no cache or new compatibility branch.
The earlier 12-call hosted measurements remain historical evidence for that
bundle, not measurements of the corrected bundle.

A new behavioral scenario consumes two uses through verified signatures, then
races two distinct operation identities for the last use. It requires one 200
prepare and one `wallet_session_quota_exhausted` 409. Retrying both must return
one `operation_in_progress` and one quota-exhausted response. Both prepare
responses are deliberately dropped, so no new finalize runs. The VM checks quota
1 → 0 and retains only the two earlier signing effects. Reproduce with
`distinct concurrent prepares consume the last quota` in
`passkey.presign-pool.contract.test.ts`; the existing three-device contract is
selected by `a linked device links a third device on an ECDSA-only wallet`.
Artifacts and reproduction commands are in
`.artifacts/r150/d1-material-review-20260930/verification.json`; the remaining
call inventory and historical status totals are in `call-budget.json` beside it.
Five scenarios passed on each of Workers D1, wallet-DO, and VM (15
scenario/profile combinations): three-device linked signing; duplicate prepare
and lost-finalize replay with wrong-wallet refusal; last-quota contention;
recovery retirement; and warm signing with step-up/export. Server build,
intended-test type check, and the bloat check pass. A cached Worker profile
mismatch was corrected; the final two VM cases used the supported port offset
after another local stack occupied the default ports. No hosted resources were
changed during this checkpoint.

Next implementation order:

1. Specify one material-freshness predicate covering canonical and installed
   linked activations, exact owner/key/lifecycle/worker identity, custody-source
   resolution, and ambiguity rejection. Apply it to both new claims and existing
   operations; preserve the completed-response replay policy.
2. Exercise retirement/revocation between policy and admission, including linked
   devices, together with distinct operations contending for the last quota use.
   Then replace a resolver read and measure the actual call reduction.
3. Trace status-request owners in a fixed current SDK build. The preserved SDK
   used for hosted comparisons has a known content hash but unproven source;
   current source ownership alone cannot attribute those requests.
4. Measure the complete system-controlled signing span before revisiting the
   deferred minimum-call-budget design and regional placement.

The latest hosted scope cohort observed 51 status requests containing 117 D1
calls: registration windows 21/42, first-sign windows 12/24, and subsequent-sign
windows 18/51. These are window totals, including background work. They do not
identify the caller or establish a foreground dependency.

Current source has an operation-scoped `WalletSessionStatusReadScope`, keyed by
fetch implementation, normalized relay URL, credential, session, and quota.
Registration/unlock prefill, capability inventory, and iframe exact-session
reconciliation already share scopes internally. Warm EVM/Tempo capability
readers each invoke a resolver that creates its own scope; signing material
hydration also performs a deliberate later authorization read. Investigate the
former for sharing within one public read. Preserve the latter's freshness
boundary unless domain-state evidence supports replacing it. Avoid a global
status cache or reuse across a signing effect, unlock, or authority transition.

### Linked-device custody-chain checkpoint (September 30)

Material resolution read the wallet's entire installation set again for each
linked ancestor. Each read repeated the same package-digest validation. The
resolver now reads and validates that set once per invocation, then follows the
custody chain in memory with the existing 16-hop bound. The single-activation
reader remains in use by authorization; both readers share the same projection
validation. Duplicate activation matches, invalid receipts, key mismatches, and
canonical signer ambiguity retain their rejection behavior.

This reuse is confined to one resolver invocation. Prepare and finalize retain
their separate initial and fresh material resolutions. Atomic material freshness
for new claims and existing operations remains the next admission prerequisite.

The existing three-device browser contract now records prepare/finalize D1
traces alongside its three verified Tempo signatures. A fixed SDK distribution
was used before and after the change. Local Workers measurements are:

| Signing device | Before calls | After calls |
| --- | ---: | ---: |
| Original wallet | 12 | 12 |
| Directly linked device | 20 | 20 |
| Device linked by that linked device | 24 | 20 |

The third device removes four installation reads across prepare/finalize and
reduces SQL statements from 25 to 21. Every measured signature still has two
write-bearing calls and 14 D1-reported rows written. The wallet-DO profile
reproduces the new 12/20/20 counts; VM verifies all three signatures without D1
trace headers. These measurements cover one signature per device in each local
run. They establish the call reduction; they do not establish hosted latency or regional placement.
Local D1 does not report served-region metadata. Artifacts are in
`.artifacts/r150/d1-linked-chain-20260930/analysis.json`; verification details and
reproduction commands are in `verification.json` beside it.

Eight scenario/profile combinations passed: three-device signing and linked
revocation on Workers D1, wallet-DO, and VM, plus recovery retirement and
concurrent prepare/lost-finalize replay on Workers D1. The latter also verifies
wrong-wallet refusal and exact replay afterward. Server build, intended-test
type check, and bloat check pass. Temporary Gateway tracing was removed before
the revocation/recovery/replay runs. No hosted resources changed.

### Current SDK status-request ownership checkpoint (September 30)

A freshly built SDK now has browser initiator evidence for the mixed-wallet
refresh lifecycle: registration, unlock, page refresh, both key exports, warm
NEAR/Tempo/EVM signing, quota exhaustion, and one-use step-up signing. The
existing browser contract writes `wallet-session-status-owners-<host>.json`
under `.artifacts/r151/`. Chromium caller stacks retain function names and asset
paths/locations, excluding request bodies, headers, credentials, and URL queries.
Only status POSTs count; CORS preflights are excluded. This diagnostic is a
bounded lifecycle window, not a per-signature foreground count.

The matched Workers runs each observed 59 status POSTs:

| Caller responsibility | Before | After |
| --- | ---: | ---: |
| Lane inventory/discovery | 26 | 26 |
| NEAR material authorization | 10 | 10 |
| Iframe exact-session reconciliation | 9 | 9 |
| Presign refill | 6 | 6 |
| ECDSA runtime preparation | 4 | 4 |
| ECDSA material hydration | 2 | 2 |
| Unlock authorization | 1 | 1 |
| NEAR readiness planning | 1 | 1 |

Six ECDSA preparation reads entered the NEAR authorization reader because
curve-specific discovery loaded both curves. ECDSA signing discovery now skips
NEAR sealed records, public references, and its authorization reader. Full-wallet
inventory, owner/export discovery, and NEAR signing retain their existing reads.
The six status requests remain: the ECDSA reader already shared each request
through the existing operation scope and now initiates it itself. This removes
unrelated local discovery work; it establishes **zero network or D1 call savings**.
The suspected separate EVM/Tempo `getWarmSession` scopes were not observed in
this scenario, so no scope-sharing change was retained there.

Build input hashes, SDK/server distribution hashes, caller traces, classifications,
and reproduction commands are recorded in
`.artifacts/r151/status-owners-20260930/`. SDK builds are from current source;
these lifecycle samples remain separate from the earlier hosted SDK cohorts.
No hosted placement or complete-latency conclusion follows from these runs.

The mixed-wallet scenario passed on Workers D1, wallet-DO, and VM, with 59
status POSTs and the same caller classification in each after run. Three-device
ECDSA-only signing also passed on Workers D1. SDK/server builds, SDK/intended-test
type checks, and the bloat check pass. No hosted resources changed.

Next steps now have two distinct boundaries:

1. Material admission still needs a predicate covering original and linked
   activations, validated receipt/custody-source identity, and ambiguity. The
   registration-only INSERT guard cannot replace the linked resolver. Cover both
   new claims and existing operations, including retirement/revocation between
   policy and admission, before deleting a fresh read.
2. Use the observed inventory/discovery callers to identify repeated reads
   within one public operation. Distinguish lane selection and material-hydration
   checks, and identify any intervening authority/material transition before
   sharing a scope. Preserve separate later signing checks and avoid cross-action
   status caching. Measure the next change with these current-build caller traces.

### Remove the generation-only ECDSA inventory read (September 30)

The caller trace identified two inventory reads inside one authorized ECDSA
signing preparation. The first selects the material candidate and its authority.
After resolving that exact candidate, the second inventory's lanes and
authorization results were discarded; only its generation number was copied into
prepared-operation metadata. That number does not drive authorization or signing
control flow. Preparation now carries the generation from the inventory that
actually selected the candidate, removing the second read entirely.

Candidate/selection identity checks, readiness planning, subsequent runtime
preparation, material-hydration authorization, and server admission are retained.
Each new signing attempt still reads its own inventory. This change adds no cache,
shared scope, new domain type, or alternative authorization path.

The matched Workers browser lifecycle changes from 59 to 57 status POSTs. Both
saved requests are in warm signing: one in Tempo preparation and one in EVM
preparation. Lane inventory/discovery requests fall from 26 to 24; runtime
preparation remains at four and material hydration at two. Registration, unlock,
refresh/export, and step-up request counts remain unchanged in the observed
window. The count covers the complete mixed-wallet test lifecycle, including
background work; it is not the Gateway's per-signature D1 count.

The baseline is the preceding checkpoint's Workers run. Before rebuilding, both
SDK and server distribution hashes were checked against that artifact. Source
baseline: `2a2be2b3`. The current SDK was then rebuilt from source with this
single production edit; the server distribution is unchanged. Evidence, build
identities, and reproduction commands are in
`.artifacts/r151/inventory-read-20260930/analysis.json`.

The lifecycle passes on Workers D1, wallet-DO, and VM, each recording 57 status
POSTs with the same caller classification. Concurrent shared-budget signing,
linked-device revocation, and recovery retirement also pass on Workers D1: six
scenario/profile combinations in total. The SDK build/type check, intended-test
type check, and bloat check pass.

The next status-read candidates must similarly establish what the later read
contributes before removing or sharing it. The atomic material-freshness work,
minimum-call-budget review, full signing-span measurements, and conditional
regional-placement decision remain open. No hosted resources changed, and no
new D1-call or complete-latency result is claimed by this browser measurement.

### First, warm, and concurrent burst checkpoint (September 30)

The browser diagnostic now measures an immediate post-registration signature,
a signature whose selected server presignature is confirmed complete before the
window starts, and concurrent Tempo/Arc signing that consumes the final two
uses of a shared Wallet Session. A separate untimed sign sets up that burst.
All five signatures verify in each of Workers D1, wallet-DO, and VM: 15 verified
signatures across three scenario/profile checks.

| Workload | Gateway calls / statements | Write-bearing calls / reported row writes |
| --- | ---: | ---: |
| First signature | 12 / 13 | 2 / 14 |
| Warm signature | 12 / 13 | 2 / 14 |
| Two-signature burst ending at zero quota | 25 / 27 | 4 / 28 |

Both instrumented Workers profiles produced these counts. The burst's extra
call re-reads the joined authorization snapshot: active-session validation fails
after quota exhaustion, then the exhausted-candidate path reads the snapshot
again so an already admitted operation can finish. The following checkpoint
removes that duplicate read while preserving fresh authority/method checks and
refusal of new admission when quota is exhausted.

First signing included foreground-tagged refill steps on wallet-DO and VM.
Warm signing and the burst had background-tagged refill traffic; both selected
burst presignatures were already server-complete at window start in all three
profiles. Background traffic is reported separately and cannot be charged in
full to the signing critical path. Server material availability also does not
prove that every client preparation step is complete.

Browser-harness windows (first / warm / two-signature burst) were 739 / 758 /
1,263 ms on Workers D1, 1,487 / 1,478 / 2,531 ms on wallet-DO, and 1,472 / 749 /
1,764 ms on VM. These are single local diagnostic samples, including automatic
confirmation, test orchestration, and signature verification. The profiles use
different local role builds; these values establish neither comparative hosted
performance nor the complete system-controlled 1–2 second maximum.

Evidence: `.artifacts/r151/workloads-20260930/analysis.json`, per-profile browser
artifacts, D1 analyses, and run records with fixed distribution hashes. Reproduce:

```sh
node tests/scripts/run-wallet-intended-isolated.mjs -- \
  e2e/intended-behaviours/passkey.presign-pool.contract.test.ts \
  --grep 'first, warm, and concurrent burst'
```

The local cohort launcher is
`.runtime/r151-workloads/run.mjs`; D1 samples use the existing temporary local
Gateway wrapper and `node tests/r150-hosted/analyze-d1.mjs <artifact>`. The wrapper
was restored after the two Workers profiles. No hosted resources changed.
The existing forced-pool-wait E2E, intended-test type check, and bloat check also
pass with the updated observer.

Two diagnostic setup failures are retained: the first selected an unlock helper
requiring a mixed wallet; the second fetched old response bodies after navigation.
The scenario now uses the shared mixed-wallet lifecycle, and the observer retains
only completion metadata captured when responses arrive. Production behavior
was unchanged by this checkpoint.

### Single active/exhausted credential snapshot (September 30)

ECDSA signing now classifies its credential from one joined session, quota,
authority, and auth-method snapshot. An active result carries reusable-session
admission context. An exhausted result carries only an exact-operation candidate;
the existing operation admission and quota guards decide whether it may complete
or replay an admitted operation. Storage corruption, retired/expired sessions,
and unavailable authority still fail closed. Each request reads a fresh snapshot.

The exhausted quota is now a typed snapshot branch instead of an exception that
causes the ECDSA route to read the same records again. Active-only readers remain
for their existing consumers, including NEAR and administration. Their behavior
is preserved through shared credential readers. Owner-lane preflight explicitly
refuses exhausted candidates with its existing unavailable-session response.
Type fixtures reject mixed active/exhausted branches, relabeled broad spreads,
an exhausted snapshot carrying reusable authorization, and a direct exhausted
context cast into active admission.

| Workload | Before calls / statements | After calls / statements | Write-bearing calls / reported row writes |
| --- | ---: | ---: | ---: |
| First signature | 12 / 13 | 12 / 13 | 2 / 14 |
| Warm signature | 12 / 13 | 12 / 13 | 2 / 14 |
| Two-signature burst ending at zero quota | 25 / 27 | 24 / 26 | 4 / 28 |

Both local instrumented Workers profiles produced these counts with the same
SDK distribution as the preceding cohort. This saves the extra credential read
when quota is exhausted; the ordinary six-call prepare and finalize paths are
unchanged. Local elapsed times remain diagnostics rather than evidence of a
hosted latency gain.

The lost-finalize-response E2E now uses two verified signatures before its
concurrent duplicate prepare and dropped response. Its final operation consumes
the last quota use. An exact retry must return the same signature after
exhaustion, a changed wallet must be refused, and a subsequent exact retry must
still succeed. VM evidence checks zero remaining uses and exactly three custody
effects total: two setup signatures and one effect for the retried operation.
The separate last-quota race still checks that a distinct operation cannot claim
the exhausted session.

The old unit assertion that exhausted credentials fail at the active-only
validation boundary is classified `obsolete_test_or_fixture` and removed with
its unused mock. Preprocessing's exact-session/material assertions remain; the
behavioral E2Es own the current new-admission versus exact-replay distinction.
The fresh material resolver remains in place. Atomic canonical/linked material
freshness is the next separate server consolidation boundary.

Verification passed 15 scenario/profile checks: first/warm/burst signing,
last-use lost-response replay, last-quota contention, and mixed-wallet
refresh/signing/step-up/export on Workers D1, wallet-DO, and VM; plus recovery
retirement, third-generation linked signing, and linked-device revocation on
Workers D1. The VM replay artifact records remaining uses falling from one to
zero, three total custody effects, an identical replayed signature, and HTTP
403 for the changed wallet. Server build, intended-test types, state type
fixtures, and the bloat check also passed.

Local evidence is retained in `.artifacts/r151/credential-20260930/analysis.json`,
with per-profile call counts, replay/quota artifacts, distribution hashes, and
private lifecycle-trace hashes. Reproduce the cohort with
`node .runtime/r151-credential/verify.mjs`, then verify the collected evidence
with `python3 .runtime/r151-credential/analyze.py`. The existing local Gateway
diagnostic wrapper was restored after measurement. No hosted resources changed.

### Linked custody snapshot checkpoint (September 30)

The linked ECDSA resolver now reads installed authority packages and canonical
signer candidates in one D1 batch. It verifies package digests and installation
projections from that snapshot, follows the existing bounded custody chain, and
retains the canonical signer identity and ambiguity checks. The ordinary signer
store and the snapshot share the same scoped signer query and boundary parser.
The old chain-only reader has been replaced; there is no cross-request cache.

[D1 batches execute as SQL transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
This makes the installation/canonical-source snapshot internally consistent.
The canonical activation lookup remains separate. Both initial material
authorization and the fresh material resolution before admission remain in
place, each taking a new snapshot. This checkpoint does not make material
validation atomic with the operation claim or replay decision.

| Signing device | Before calls / statements | After calls / statements | Write-bearing calls / reported row writes |
| --- | ---: | ---: | ---: |
| Canonical registration device | 12 / 13 | 12 / 13 | 2 / 14 |
| Directly linked device | 20 / 21 | 16 / 21 | 2 / 14 |
| Device linked by that linked device | 20 / 21 | 16 / 21 | 2 / 14 |

The bounded local comparison uses one verified signature per device. Both
Workers D1 and wallet-DO reproduce the new counts; VM verifies the same three
signatures. The SDK distribution is fixed across the baseline and comparison
runs. Four reads become part of existing calls per linked signature; statement
and write counts stay unchanged. Local timings do not establish a hosted
latency improvement.

Nine scenario/profile checks passed: three-device ECDSA signing and linked-device
revocation on Workers D1, wallet-DO, and VM; plus recovery retirement,
last-use lost-response replay, and third-generation mixed-curve signing/export
on Workers D1. The separately measured baseline also passed. Server build,
intended-test type checking, and the bloat check passed.

Evidence is retained in `.artifacts/r151/custody-20260930/analysis.json`, including
per-device counts, distribution hashes, replay results, and private lifecycle
trace hashes. Reproduce the comparison with
`node .runtime/r151-custody/verify.mjs` and validate the artifacts with
`python3 .runtime/r151-custody/analyze.py`. The local diagnostic wrapper is
restored after measurement. No hosted resources changed.

The remaining atomic-freshness boundary must cover both the INSERT that claims
an operation and the existing-operation read used by finalize/replay. A predicate
on registration signer rows alone cannot authorize linked material. It must bind
the verified installation set and canonical signer identity to the exact
tenant/environment, detect retirement or replacement after the snapshot, and
preserve ambiguity rejection. Race coverage must retire or replace material
between snapshot verification and each admission decision before the fresh
resolver can be removed.

### Atomic material admission checkpoint (September 30)

Reusable-session ECDSA admission now carries the material snapshot that initial
route authorization verified. The snapshot captures the complete scoped
canonical signer record set for that activation, or the linked installation and
canonical signer sets read together. The canonical lookup no longer truncates
that set to four rows. Linked package digest, projection, custody-chain, and
canonical-identity verification remain in the resolver.

At a new claim, the existing INSERT checks both record-set cardinality and exact
stored tuples in its WHERE predicate. The existing-operation read performs the
same check for pending finalize and completed replay, alongside its live
session/authority/method checks. A changed, added, removed, or retired record
returns `material_mismatch`. Claim, quota consumption, and audit insertion still
share the existing transaction; no freshness table, version write, or cache was
introduced. Snapshot internals are private in-process fields and are not a wire
credential. Type fixtures reject missing evidence, object-literal fabrication,
spreads that lose it, and direct casts from serialized data.

The second resolver call has been removed from reusable-session signing. Initial
material and policy decisions now stay bound to the records actually admitted.
Step-up and preprocessing retain their own existing freshness boundaries.

| Signing device | Before calls / statements | After calls / statements | Write-bearing calls / reported row writes |
| --- | ---: | ---: | ---: |
| Canonical registration device | 12 / 13 | 10 / 11 | 2 / 14 |
| Directly linked device | 16 / 21 | 12 / 15 | 2 / 14 |
| Device linked by that linked device | 16 / 21 | 12 / 15 | 2 / 14 |

Workers D1 and wallet-DO reproduce these local counts with the fixed SDK
artifact; VM verifies the same three signatures. The guarded statements inspect
more data internally, so these call savings are not a hosted latency result.

The new behavioral E2E changes material after resolution, immediately before
claim, pending finalize, and completed replay. It covers canonical material,
linked installations, and the canonical source of a third-generation linked
device. Test-only changes, the admission statement, and restoration run together
so background requests never see the temporary retirement. All nine rejections
per profile must return `material_mismatch` and preserve the transaction's quota
total; subsequent ordinary signing and exact replay must verify.

Fifteen scenario/profile checks passed: retirement races, three-device signing,
last-use lost-response replay, and last-quota contention on Workers D1, wallet-DO,
and VM; plus recovery retirement, linked-device revocation, and mixed-wallet
refresh/signing/step-up/export on Workers D1. The 27 injected retirement
rejections preserve quota. VM replay evidence still records one quota use and
one custody effect for the operation whose response was lost. Server build,
intended-test types, state type fixtures, and bloat checking passed.

Evidence is retained in `.artifacts/r151/atomic-20260930/analysis.json`, including
baseline/comparison counts, distribution hashes, quota/replay outcomes, source
hashes, and private lifecycle trace hashes. Reproduce with
`node .runtime/r151-atomic/verify.mjs`, then validate the artifacts with
`python3 .runtime/r151-atomic/analyze.py`. The temporary Gateway measurement
wrapper was restored. No hosted resources changed.

An expanded diagnostic attempted additional linked signatures after the boundary
checks. It hit a 20-second local presign worker timeout/reset and then lost its
linked-holder handle. The same failure reproduced with fault injection disabled
(`environment_or_infrastructure_failure` for this local run). The focused
admission test checks quota directly instead of using extra signatures as its
quota measurement. Failed traces remain under
`.runtime/r150-d1-diagnostic/atomic-control-workers-traces/`; the repeated linked
presign timeout was carried into Phase 2. The next checkpoint resolves that
failure and adds repeated linked-workload coverage.

### Repeated linked-presign checkpoint (September 30)

The expanded control reproduced the timeout without material-retirement fault
injection. Investigation reclassifies it as `production_regression`: the
presign worker retained separate derivation and linked-holder ports, while the
derivation worker owned one peer port. Switching to linked authority closed the
old peer. A later `ListAvailable` request still queried that stale derivation
port, waited 20 seconds, and reset the worker that held the linked material.
The next presign then failed with `linked ECDSA holder material is unavailable`.

The presign worker now holds one active authority channel with an explicit kind.
Replacing it rejects pending requests and clears sessions/material references
from the previous port before closing it. Durable canonical inventory is read
only through an active canonical channel. Linked inventory retains its active
in-memory material. Initialization shares the common request/retention flow
while keeping branch-specific authority construction. No timeout increase or
holder-recovery path was added.

The existing three-device E2E now signs three times on each device, alternating
between canonical, directly linked, and third-generation linked devices. Its
artifact identifies each device and signature separately. Workers D1,
wallet-DO, and VM verify 27 signatures across the three runs. Workers D1 and
wallet-DO retain 10 calls / 11 statements per canonical signature and 12 calls /
15 statements per linked signature, with two write-bearing calls and 14 reported
row writes in each case. This closes repeated local workload coverage without
claiming hosted latency or regional-placement gains.

Eight scenario/profile checks pass: the original fault-disabled control, the
three repeated chain profiles, retirement admission races, dual-curve linking
and export, refresh/signing/step-up/export, and first/warm/concurrent burst
signing. Private lifecycle traces contain no worker timeout/reset. The nine
retirement rejections preserve quota and exact replay still matches. SDK build,
SDK/intended/state type checks, and the bloat check pass.

Evidence: `.artifacts/r151/presign-20260930/analysis.json` records source and
built-distribution hashes, before/after failure evidence, per-signature call
counts, and trace hashes. Reproduce with `pnpm -C packages/wallet build:sdk`,
`node .runtime/r151-presign/control.mjs`,
`node .runtime/r151-presign/verify.mjs`, and
`python3 .runtime/r151-presign/analyze.py`. The temporary Gateway measurement
wrapper is restored after the instrumented runs. Hosted resources are unchanged.

### Joined session/material checkpoint (September 30)

Reusable-session signing now projects its canonical material records in the
initial credential/session/authority/method/quota read. A correlated JSON
aggregate preserves every scoped candidate despite the outer session query's
`LIMIT 1`. The already-parsed request selects the activation; session and scope
validation still precede material rejection. General session/status readers
retain their existing projection.

The persistence boundary parses the canonical records once into scoped,
in-process evidence. It retains parse failures until the material decision,
checks wallet/environment/full activation identity when consumed, and uses the
existing record-set snapshot builder. Both active and exhausted candidates
require this evidence. Type fixtures reject missing evidence, object-literal
fabrication, broad spreads, direct string casts, and mixed database/snapshot
sources. Reusable signing also reuses its parsed request through validation.

An empty canonical set still enters the existing linked installation/canonical
source batch and custody-chain verification. Step-up, preprocessing, and other
independent material consumers explicitly read the database. The claim and
existing-operation snapshot predicates remain the freshness boundary; quota,
audit, durable replay, and completion writes retain their existing semantics.
The local retirement fault now captures scope from the joined row before
retiring material at claim, pending finalize, or completed replay.

| Signing device | Before calls / statements | After calls / statements | Write-bearing calls / reported row writes |
| --- | ---: | ---: | ---: |
| Canonical registration device | 10 / 11 | 8 / 9 | 2 / 14 |
| Directly linked device | 12 / 15 | 10 / 13 | 2 / 14 |
| Device linked by that linked device | 12 / 15 | 10 / 13 | 2 / 14 |

Workers D1 and wallet-DO reproduce those counts for each of three signatures
per device, using the same SDK distribution as the prior cohort. VM verifies
the same nine signatures. These are local call-count results; hosted latency
and regional-placement gains remain unmeasured.

Fifteen scenario/profile checks pass: retirement races, repeated three-device
signing, last-use lost-response replay, and last-quota contention on Workers D1,
wallet-DO, and VM; plus recovery retirement, linked-device revocation, and
refresh/signing/step-up/export on Workers D1. All 27 retirement rejections
preserve quota. VM replay evidence retains one quota use and one custody effect
for the operation whose response was lost. Server build, intended-test types,
state type fixtures, and the bloat check pass.

Evidence is retained in `.artifacts/r151/session-material-20260930/analysis.json`,
including per-signature before/after counts, distribution and source hashes,
quota/replay outcomes, and private trace hashes. Reproduce with
`pnpm -C packages/wallet-server build`,
`node .runtime/r151-session-material/verify.mjs`, and
`python3 .runtime/r151-session-material/analyze.py`. The temporary Gateway
measurement wrapper is restored. No hosted resources changed.

### Reuse the verified NEAR rehydration result (September 30)

Current-build initiator evidence identified another sequential duplicate inside
one signing operation. After refreshing the page, NEAR rehydration activates
its restored client and resolves the published signing lane. Its initiating
caller then immediately resolved the same lane again, with no intervening
local material or authority mutation. The second inventory includes a status POST.

Rehydration now returns the verified operation material with its rebound subject.
The initiating caller uses that material directly. A caller joining an already
running rehydration still resolves the rebound subject itself. The live-client
branch retains its existing single verification, and a failed post-activation
verification still disposes the restored client. Subsequent signing authorization
and server admission retain their existing freshness checks. No cross-operation
cache is introduced.

The matched Workers mixed-wallet lifecycle falls from 57 to 56 status POSTs:
warm signing falls from 19 to 18 and lane inventory/discovery from 24 to 23.
Registration, unlock, refresh/export, and step-up counts are unchanged. This is
a bounded browser lifecycle count including background work; it does not change
the measured ECDSA Gateway budget of eight canonical or 10 linked D1 calls.
No complete-latency or hosted-placement improvement is established.

Seven scenario/profile checks pass: refresh/signing/step-up/export on Workers
D1, wallet-DO, and VM; immediate export/shared-quota signing; three-device mixed
signing and export; linked-device revocation; and recovery retirement on Workers
D1. Each lifecycle profile records 56 status POSTs. SDK build/type checking,
intended and wallet-state type checks, and the bloat check pass. Hosted resources
are unchanged.

Evidence and reproduction commands are retained in
`.artifacts/r151/near-read-20260930/analysis.json`, with current SDK/server hashes,
caller stacks, source hashes, and private lifecycle trace hashes. Reproduce the
current build with `pnpm -C packages/wallet build:sdk`, then
`node .runtime/r151-near-read/run.mjs after-workers workers e2e/intended-behaviours/passkey.unlock.contract.test.ts 'page refresh hydrates warm signing'`,
`node .runtime/r151-near-read/verify.mjs`, and
`python3 .runtime/r151-near-read/analyze.py`.

Remaining status work requires identifying equivalent overlapping reads and
intervening transitions in additional caller traces before sharing their scope.
The minimum safe call-budget review and controlled hosted workload/placement
measurements remain open.

### Status-request overlap audit (September 30)

The browser evidence now records start/completion times, anonymous request
identity groups, frame groups, and caller stacks. Matching identities include
the exact URL, operation credential, Wallet Session ID, and quota ID. A fresh
in-memory HMAC key groups those inputs for each run; neither its key, input
values, fingerprints, request bodies, nor headers enter the artifact. Unknown
identity/frame coverage and unfinished/failed requests remain explicit.

The existing refresh/export/warm/step-up scenario and immediate unlock/export/
shared-budget concurrent signing scenario supply separate stage windows. The
same SDK/server builds are retained across Workers D1, wallet-DO, and VM. These
runs identify overlap at registration and restore, especially repeated iframe
exact-session reconciliation, full inventory reads, and per-chain restored
presign prefill. Pair counts describe overlapping intervals; a request can
participate in multiple pairs, so they are not a count of removable requests.

All six scenario/profile checks pass. Every observed status request has an
identified group, frame group, and completed interval. The refresh lifecycle
records 56 POSTs per profile; the concurrent-signing lifecycle records 42.
Matching overlap pairs number 12/15/10 for the refresh lifecycle and 12/9/12 for
the concurrent lifecycle (Workers D1 / wallet-DO / VM). All pairs occur during
registration, unlock, or restore/export; none occur during the measured warm,
concurrent, or step-up signing stages. Scheduling differences explain why pair
counts vary while request counts stay fixed. Intended-test type checking and
the bloat check pass. Hosted resources are unchanged.

Source inspection gives the next implementation order:

1. Share one existing `WalletSessionStatusReadScope` across the configured-chain
   prefills scheduled by one restore operation. Today each call through
   `prefillRouterAbEcdsaDerivationPresignaturePoolDomain` creates a separate scope.
   Keep separate pool scheduling and per-chain material validation. Preserve the
   public single-chain API; give the host restore operation an internal batch
   boundary rather than exposing a status-snapshot scope as public configuration.
2. Trace the parent requests behind concurrent `PM_GET_EXACT_WALLET_SESSION_STATE`
   and `PM_GET_WALLET_SESSION` display reads. Coalesce equivalent display reads
   within their owning operation, retaining restore/current mode, selected wallet,
   connection lifetime, and authority-transition boundaries. Equal status payloads
   alone do not establish equivalent public operations.
3. Retain fresh authorization during queued material use and server admission.
   Avoid a module-wide pending-status map: it would merge independently owned
   signing, display, and preprocessing checks merely because their wire inputs
   happen to match.

No production call reduction is claimed by this audit. The measured Gateway
budget remains eight canonical and 10 linked D1 calls per signature. Controlled
hosted first/warm/burst workloads, residual full-signature latency, the minimum
safe call-budget review, and the R152 placement decision remain open.

Evidence: `.artifacts/r151/status-overlap-20260930/analysis.json` contains build
identities, caller ownership, pair indexes into the retained request traces,
coverage checks, and reproduction commands. Reproduce with
`node .runtime/r151-status-overlap/verify.mjs` and
`python3 .runtime/r151-status-overlap/analyze.py` after the intended-test type check.

### Share status reads within one restored-session prefill batch (September 30)

One wallet-host restore now creates one `WalletSessionStatusReadScope` and passes
it to every configured-chain prefill. The existing scope keys reads by relayer,
operation credential, Wallet Session ID, quota ID, and fetch implementation.
Each chain still resolves and validates its own material and schedules its own
pool. The scope lives only for that restore batch.

The internal SeamsWeb restore entry point binds the existing prefill domain
function directly. The public single-chain prefill API keeps its existing inputs
and creates a fresh scope for each call. The former host wrapper is removed;
there is no module-wide cache or alternate authorization implementation.
Active/exhausted restore eligibility, pool policy, and subsequent signing and
server admission checks retain their existing behavior.

The matched Workers refresh/export/warm/step-up lifecycle falls from 56 to 54
status POSTs: one request is saved at unlock restoration and one after page
refresh. The immediate-unlock/concurrent-signing lifecycle falls from 42 to 41,
saving its one duplicate restore prefill read. Signing-stage request counts are
unchanged. These are whole-lifecycle browser counts, including background work;
they do not reduce the measured foreground Gateway budget of eight canonical or
10 linked D1 calls per signature or establish a hosted latency improvement.

The same 54/41 request counts hold on wallet-DO and VM. Presign-refill status
reads fall from six to four in the refresh lifecycle and four to three in the
concurrent lifecycle; all other caller counts stay unchanged. The recorded
matching prefill-overlap pairs disappear in these cohorts.

Nine scenario/profile checks pass: both measured lifecycles on all three
profiles, plus linked-device revocation, recovery retirement, and verified
first/warm/concurrent-burst signing on Workers D1. SDK build/type checking,
intended and wallet-state type checks, and the bloat check pass. Hosted resources
are unchanged.

Before rebuilding, both installed SDK and server distribution hashes were
verified against the preceding overlap-audit cohorts. The server build stays
fixed. Evidence, caller traces, source/build identities, and lifecycle trace
hashes are retained in `.artifacts/r151/restore-prefill-20260930/analysis.json`.
Reproduce with `pnpm -C packages/wallet build:sdk`,
`node .runtime/r151-restore-prefill/verify.mjs`, and
`python3 .runtime/r151-restore-prefill/analyze.py`.

Next: trace the parent owners of the remaining repeated display requests before
coalescing them. Continue the minimum-safe-call-budget review, then measure
controlled hosted first/warm/burst workloads and residual placement cost for R152.

### Remove duplicated React preference-triggered session refresh (September 30)

Parent-side ownership inspection explains one group of matching display reads.
`WalletIframeRouter.handlePreferencesChanged` refreshes exact session state when
the selected wallet changes and emits login status. `useWalletIframeLifecycle`
also subscribed to every preferences notification, launching a second exact
session reconciliation. Subscription replays the last preference value, causing
another reconciliation beside React's explicit initial read. Confirmation-config
notifications were also used to trigger authentication reads.

React now retains its initial exact-session reconciliation and login-status
subscription. The preferences subscription and its background reconciliation
wrapper are deleted. `WalletIframeCoordinator.ensureWalletIframePreferencesMirror`
continues mirroring wallet-host preferences, and the router retains selected-wallet
and registration/unlock-completion refreshes. No result cache or shared pending
map is introduced; subsequent reads and signing admission remain fresh.

The matched Workers refresh/export/warm/step-up lifecycle falls from 54 to 51
status POSTs. Exact-session reconciliation reads fall from nine to six: one saved
request each at registration, unlock, and page refresh. Inventory, prefill, warm
signing, and step-up caller counts are unchanged. The live custom-review E2E
also passes: NEAR readiness updates automatically while the review stays open,
and the reviewed Arc signature still requires wallet approval.

The concurrent-signing lifecycle falls from 41 to 39 POSTs, with exact-session
reconciliation falling from six to four. Both lifecycle counts match on Workers
D1, wallet-DO, and VM. Every other caller count is unchanged across the six
comparisons. Nine scenario/profile checks pass: both lifecycles on all three
profiles, custom review with a live NEAR readiness update, linked-device
revocation, and recovery retirement. SDK build/type checking, intended and
wallet-state type checks, and the bloat check pass. Hosted resources are unchanged.

The remaining display reads have distinct owners: selected-wallet change,
completed auth operations, initial React hydration, login-status projection, and
explicit SDK reads made by the application/acceptance harness. Equal wire inputs
across those boundaries do not establish a reusable snapshot. The local caller
review is complete for these cohorts; additional hosted evidence may justify a
further narrowly scoped reduction. The next implementation review is the minimum
safe Gateway signing call budget, followed by controlled hosted workload and
placement measurements. The Gateway budget remains eight canonical or 10 linked
D1 calls per signature; this browser measurement establishes no latency gain.

Evidence, source/build identities, unchanged-server hash checks, and private
lifecycle trace hashes are retained in
`.artifacts/r151/display-refresh-20260930/analysis.json`. Reproduce with the SDK
build, the `after-lifecycle-workers` command recorded there,
`node .runtime/r151-display-refresh/verify.mjs`, and
`python3 .runtime/r151-display-refresh/analyze.py`.

### Remaining call and write inventory (September 30)

The canonical reusable-session path has three foreground Gateway D1 calls on
prepare and four on finalize: seven calls and eight SQL statements per successful signature. Status/refill
traffic and storage internal to custody roles are outside that count.

| Position | Prepare | Finalize | Freshness/invariant |
| --- | --- | --- | --- |
| 1 | Joined Wallet Session, authority, auth method, quota, and canonical material records | Same read | Authenticate the credential and owner/environment; verify the complete canonical candidate set and capture its material snapshot before policy evaluation. |
| 2 | Combined project/abuse policy read | Same read | Evaluate the current signing policy in that material's scope. |
| 3 | Guarded claim INSERT plus live operation readback in one batch | Existing operation, live authorization source, pinned owner scope, material snapshot predicate | Prepare inserts only an absent fingerprint and atomically checks material, consumes quota, and audits. Its readback also classifies existing operations with exact identity and fresh authority/material checks. Finalize resolves existing operations without inserting. |
| 4 | — | Completion UPDATE RETURNING | Persist the exact terminal response for durable replay. |

Direct and third-generation linked signing take nine calls and 12 statements.
After the joined read yields no canonical match, one additional batch per
request reads the verified installation chain and canonical signer candidates.
The former second resolution remains replaced by admission predicates. Policy
and admission remain separate from the initial snapshot; revisiting those
decision points and the complete call budget remains open.
The three-round-trip proposal is still a hypothesis.

The two write-bearing calls have this invariant inventory:

| Write boundary | Application state changed | Current requirement |
| --- | --- | --- |
| Prepare claim batch | Insert `authorized_operations`; trigger decrements `authorization_wallet_session_quotas`; trigger inserts `authorized_operation_audit_events` | Unique operation admission, exactly one quota consumption, and durable audit identity in the same transaction. Readback returns the committed claim and owner scope. |
| Finalize completion | Update the claimed operation with status/content type/body/result digest; trigger completes its audit event | Durable exact response replay and a matching terminal audit result. The lifecycle guard prevents repeating the transition. |

The quota/authority trigger is defined by the current exact-session cutover
migration (`0034_r103f_exact_wallet_session_cutover.sql`); audit and completion
guards originate in `0002_signer_post_103_canonical_upgrade.sql`. The admission
and completion implementation is in
`packages/wallet-server/src/router/cloudflare/d1/authorization/`.
These are three logical row mutations on claim and two on completion. D1's
reported 11 + 3 row writes are a separate accounting metric and do not imply
14 independent application writes. There is no demonstrated unrelated
maintenance write on this measured Gateway signing path. Audit writes occur
inside these existing transactions and add no separate D1 call.

Exact replay returns the persisted response after identity/live-source checks;
it skips a new claim, quota consumption, and completion transition. Contended
claims and failed completion races can require an additional read to classify
the winner, so success-path counts cannot stand in for race/rejection counts.
Custody material consumption and refill persistence remain separate role-level
invariants; the Gateway's two-call write count does not describe all system
storage. No signing write is removed by this inventory.

### Initial session/material read review (September 30)

The review identified the first canonical material lookup in
`D1WalletStore.readEcdsaSignerMaterialSnapshot`. The joined credential read in
`D1AuthorizationStore.readJoinedWalletSessionAuthorizationV2Row` already has the
wallet and environment identity needed to scope that lookup. It also serves
status and other authorization consumers, so the added material projection
should belong to signing's result rather than every session read.

A direct multi-row JOIN under the session query's `LIMIT 1` would lose material
candidates and weaken ambiguity detection and snapshot cardinality. Preserve
the complete canonical record set with a scoped aggregate or an equivalent
single-call projection. Reuse the existing signer parser and snapshot builder.
Classify the session/authority/method first, then validate material, preserving
current denial precedence. An empty canonical set must still enter the existing
linked installation/canonical-source batch and custody-chain verification.

The joined session/material checkpoint above implements this reviewed
projection and verifies eight canonical calls and ten linked calls per signature.
Atomic admission snapshot predicates, policy reads, claim/quota/audit
writes, and durable completion remain required. Acceptance requires measured counts and repeated retirement, revocation,
last-quota contention, and lost-response replay checks.

### Minimum-call-budget design review (September 30)

The three-call proposal is not supported by the current execution dependencies.
`authorizeRouterAbEcdsaWalletSessionRequest` resolves and validates the complete
material candidate set before evaluating policy. The policy keys depend on the
resolved material's runtime scope and activation. The subsequent admission uses
`EcdsaMaterialReadSnapshot.condition` to check that the records examined by the
application still match. A batch cannot use application verification of its own
returned rows to decide an earlier claim in that batch. Claiming before that
verification would allow rejected requests to consume quota.

Finalize repeats the credential/material and policy decisions, then checks the
existing operation and material snapshot before custody execution. Completion
records the response after execution. Removing that completion write would lose
durable exact replay. Joining finalize admission to its initial credential read
would move the material/authority check before the intervening application and
policy work; retaining the existing retirement boundary requires a later check.
These are dependencies of the current implementation, not a proof of a universal
minimum. A three-call design requires an explicit replacement for them and its
own behavioral evidence.

The immediate candidate is one fewer prepare call: a guarded claim followed by
live operation readback in the same batch. A new claim would still consume quota
and create its audit event through the current triggers. An existing fingerprint
must skip insertion and then pass the existing identity, material, and live-source
checks. The readback must distinguish a new claim, an existing operation, and a
material mismatch; zero changed rows alone cannot identify the latter.
[D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
provide ordered statements and rollback on failure. They do not replace those
domain decisions.

The review found a prerequisite in the call graph, now addressed by the
read-only finalize checkpoint below:

- Both prepare and finalize previously called `admitRouterAbEcdsaReusableWalletSessionOperation`
  without a phase, invoking the same store admission method.
- If the fingerprint was absent, `admitAuthorizedOperationRecord` could insert a
  claim. Both the fetch route in `thresholdEcdsa.ts` and the domain route in
  `routerAbEcdsaDerivationNormalSigningRoute.ts` subsequently rejected a newly
  `claimed` finalize with `authorized_operation_missing`.
- Therefore an otherwise admissible finalize without a prior prepare could reach
  the quota/audit mutation before that rejection. This was a code-path finding;
  a deployed reproduction was not performed. The implementation now requires the
  phase at the domain boundary and excludes newly claimed finalize results.

A generic insert/readback replacement would also execute a conditional INSERT
on every normal finalize and replay. Even if it changed no rows, that would add
SQL work to an existing read path. Keep finalize resolution read-only and retain
its live-source/material predicates. The prepared-admission API used by Ed25519
export also owns a larger transaction: preserve its duplicate-claim failure
semantics rather than making its INSERT silently skip a row.

Implementation and acceptance order:

1. Add a behavioral E2E for an authenticated finalize with an absent prepare:
   require the missing-operation response, unchanged quota, no claim/audit row,
   and a subsequent successful prepare/finalize. Use required phase-specific
   admission types and type fixtures to exclude newly claimed finalize results.
   Update the intended behavior contract with the implementation.
2. Separate claim and existing-operation resolution through the current store
   and route boundaries. Preserve exhausted-session exact replay, live revocation,
   material retirement, owner scope, and rejection precedence in both paths.
3. Batch prepare's guarded claim and live readback. Scope the absence guard to
   namespace, tenant, and fingerprint; retain uniqueness and all trigger failures.
   Reuse the existing row parser and replay classifier. Keep the export-owned
   prepared transaction's conflict semantics explicit.
4. Run last-quota contention, duplicate prepare, lost-response replay, retirement,
   revocation, and mixed-wallet lifecycle E2Es on Workers D1, wallet-DO, and VM.
   Preserve fresh before/after artifacts and SDK/server build identities.
   Material fault injection must still retire records between resolution and
   the actual claim/existing-operation decision after the batch shape changes.
5. Measure successful signatures, exact prepare/finalize replay, and rejection
   separately. Report SQL INSERT attempts separately from calls with reported
   row writes; a skipped INSERT is still a statement. Require no quota/audit
   mutation on replay or missing finalize. Failed transactions may lack row-write
   metadata, so verify persisted state as well as trace counters.

With finalize kept read-only, the candidate success budget is seven calls/eight
statements for canonical signing and nine calls/12 statements for linked signing.
At review these were unmeasured targets; the prepare batch checkpoint below
verifies them. The preceding measured budgets were eight/nine and 10/13,
respectively, with two calls reporting row writes and 14 reported rows written.
Policy remains a separate decision after material resolution. Linked installation
resolution remains a separate batch on each request. Revisit those boundaries
after this change; do not mark phase 3 complete at the next intermediate target.
Hosted first/warm/burst latency and placement measurements remain required.

### Read-only finalize resolution checkpoint (September 30)

The reusable-session route now dispatches prepare to claim admission and finalize
to `resolveEcdsaWalletSessionOperation`. Finalize uses the existing live-source,
material-snapshot, identity, and pinned-owner checks, and returns
`authorized_operation_missing` when the operation is absent. Its store path has
no INSERT. The two routes' former rejection after a successful claim is deleted.
Phase-specific result types and static fixtures reject a newly claimed finalize,
including direct construction, a relabeled spread, and a direct cast to the
resolution result. Both callers pass their existing authorization object directly,
removing duplicated binding construction.

The new behavioral E2E runs against Workers D1, wallet-DO, and VM. Each registers
an ECDSA wallet and verifies one signature, then submits a valid authenticated
finalize naming an unprepared operation twice. Both responses are 409/missing;
direct reads of the isolated Gateway database confirm two remaining uses and
zero matching claim/audit rows after each rejection. Two further signatures
verify and consume the remaining uses. Exact replay of the first signature
still succeeds with exhausted quota. The three profiles produce nine verified
signatures in this scenario.

Concurrent duplicate prepare/lost-response replay, distinct last-quota contention,
and canonical/linked retirement scenarios also pass on all three profiles.
The retirement evidence contains 27 rejected requests with unchanged quota and
retains exact replay after the temporary retirement is restored.
Recovery, linked-device revocation, and the mixed-wallet refresh/warm/step-up
lifecycle also pass on Workers, for 15 final scenario/profile checks. Server build,
intended and Wallet state type checks, diff checks, and the bloat ratchet pass.

Evidence and build identities are in
`.artifacts/r151/finalize-resolution-20260930/`. Reproduce with the server build,
`node .runtime/r151-finalize-resolution/verify.mjs`, and
`python3 .runtime/r151-finalize-resolution/analyze.py`.
The first pilot failed in the new database-discovery helper before the probe;
the helper now selects the authorization schema among local SQLite files.
Passing final runs supersede that pilot.

This closed the finalize prerequisite for the prepare batching checkpoint below.
At this checkpoint the measured successful-signature budget remained eight/10
calls; the finalize change did not remeasure it or establish
hosted latency or regional-placement gains. The claim and completion writes for
successful signing remain required.

### Guarded prepare batch checkpoint (September 30)

Prepare now sends the conditional claim INSERT and live operation readback in
one D1 batch. The INSERT preserves a fingerprint already present in the same
namespace and tenant. New claims retain the material predicate and existing
authority/quota/audit triggers. A skipped insert with an existing row enters the
same replay identity, live-source, and material checks; a missing row after a
material-filtered insert is classified separately. Both standalone and batched
reads use the same admission-row parser.

The statement builder requires explicit existing-operation behavior. The
export-owned prepared transaction retains duplicate-insert rejection, so its
surrounding writes cannot commit after a silently skipped claim. Reusable-session
finalize continues through its read-only resolver. The material-retirement test
adapter now recognizes the requested boundary within the batch and retires the
records before that transaction, preserving the race being tested.

Fresh local measurements use the same SDK build before and after. Workers D1 has
matched baseline and changed-build cohorts; wallet-DO independently confirms the
changed-build counts. Each chain cohort verifies three signatures on each of
the owner, directly linked device, and third-generation linked device.

| Successful signature | Before calls / statements | After calls / statements | Calls reporting writes / reported rows written |
| --- | ---: | ---: | ---: |
| Canonical reusable session | 8 / 9 | 7 / 8 | 2 / 14, unchanged |
| Directly linked device | 10 / 13 | 9 / 12 | 2 / 14, unchanged |
| Third-generation linked device | 10 / 13 | 9 / 12 | 2 / 14, unchanged |

First, warm, and two-signature burst workloads confirm the same canonical
per-signature reduction. Replay and rejection have separate measurements:

| Canonical request | Before calls / statements | After calls / statements | Outcome |
| --- | ---: | ---: | --- |
| New prepare | 4 / 5 | 3 / 4 | One claim and one quota consumption. |
| Existing prepare / concurrent loser observed in these cohorts | 3 / 3 | 3 / 4 | Zero reported row writes; the additional statement skips insertion. |
| Successful finalize | 4 / 4 | 4 / 4 | Completion persists the exact response. |
| Exact finalize replay | 3 / 3 | 3 / 3 | No INSERT and zero reported row writes. |
| Wrong-wallet finalize | 1 / 1 | 1 / 1 | Rejected before admission. |
| Last-quota loser, including retry | 5 / 6 | 4 / 5 | Trigger rejection followed by a read to classify the result. |

These concurrency counts describe the recorded interleavings. Failed batch
statements lack row-write metadata; missing metadata is recorded explicitly and
does not establish zero writes. Behavioral quota and retirement checks establish
the durable outcomes. A skipped INSERT on prepare replay still adds SQL work;
hosted replay contention remains part of the residual latency measurement.

Evidence is in `.artifacts/r151/prepare-batch-20260930/`, including separate
success, replay, and quota-rejection traces and build identities. Reproduce the
baseline with `node .runtime/r151-prepare-batch/measure.mjs before workers` on the
preceding server build, then build this change and run
`node .runtime/r151-prepare-batch/verify.mjs` and
`python3 .runtime/r151-prepare-batch/analyze.py`.
The baseline workload passed before an artifact-copy path was corrected; its
completed artifact was retained and the remaining baseline cases resumed.
All four baseline and 22 changed-build scenario/profile checks pass. Verification
includes first/warm/burst and repeated three-device signing, duplicate admission,
last-quota contention, lost-response replay, missing finalize, recovery, revocation,
and mixed-wallet refresh/step-up/export. All three profiles retain nine
quota-preserving retirement rejections each. Server build, intended and Wallet
state type checks, diff checks, and the bloat ratchet pass. Temporary Gateway
instrumentation is restored; no hosted resources were changed.

The remaining prepare calls read credential/material, read policy, and perform
atomic admission. Finalize reads credential/material, policy, and the live
operation, then records completion after signing. Linked resolution adds its
installation/canonical-source batch on each request. The minimum-call review
remains open around policy and linked-resolution dependencies. Hosted complete
latency and placement comparisons remain required; local timings establish no
regional gain or 1–2 second maximum.

### Live policy denial and replay coverage

The next policy-read consolidation depends on two existing boundaries:
`resolveEcdsaMaterialActivation` establishes the trusted runtime policy scope,
including linked canonical-source validation, and the separately configured
admission adapter evaluates that scope. Gateway wiring owns the D1 policy store;
the shared authorization service also supports other admission adapters.
Project policy must win over abuse policy, and completed replay still evaluates
live policy before returning its durable result.

The existing E2Es covered material retirement, quota contention, and replay but
had no project-denial, abuse-denial, or rate-limit assertions. The new intended
scenario changes persisted policy in its isolated local Gateway database during
prepare, finalize, and completed replay. Each phase checks project rejection
with both project and abuse denial present, then abuse rejection, then rate
limiting. Every rejection preserves quota, operation claims, and audit events.
Clearing policy permits the original request; completed replay returns the exact
first response. All three quota uses still produce verified signatures.

Verification artifacts are recorded in `.artifacts/r151/policy-20260930/`.
Each profile runs against a fresh local database and records SDK/server build
hashes. Run the scenario with
`node .runtime/r151-policy/run.mjs policy-workers workers passkey.presign-pool.contract.test.ts 'live signing policy'`,
substituting `wallet-do` or `vm` for the profile and a distinct label. The existing
missing-prepare scenario also checks the extracted database locator in all three
compositions. Policy fixtures are confined to the isolated test database.
All six scenario/profile runs pass: 27 policy denials, 18 verified signatures,
unchanged denial-side quota/claim/audit state, and exact replay after clearing
policy. `node .runtime/r151-policy/analyze.mjs` verifies the captured results and
matching SDK/server hashes and writes `analysis.json`. Intended-suite type
checking, diff checks, and the bloat ratchet pass.

Next steps:

1. Review whether a policy projection can accompany the verified material read
   through the existing store/adapter contract. Preserve adapter ownership,
   trusted scope derivation, and denial precedence; do not infer policy authority
   from request scope or a diagnostic snapshot. Linked-source resolution remains
   a separate dependency. Record a concrete consolidation or justified deferral.
2. Re-measure any supported reduction across successful signing, replay, and
   rejection paths, retaining atomic admission and durable completion writes.
3. Run a controlled hosted cohort on fixed builds and verified probe locations.
   Measure complete signing latency and per-call served regions, then compare
   Gateway placement near the existing primary before evaluating regional D1
   ownership under R152.

This checkpoint adds behavioral coverage. The measured call budget remains
seven canonical and nine linked calls; it makes no new hosted latency or
regional-placement claim.

### Current-build hosted diagnostic and policy-read disposition — September 30

The policy/material join is deferred at the current boundary. The credential
projection supplies material candidates; the resolver verifies the canonical
signer or linked custody chain and establishes the trusted policy scope. A
separately configured admission adapter then owns policy evaluation. Joining
policy into the credential projection requires carrying a policy projection
through those contracts and proving it belongs to the selected verified source,
including namespace ownership and custom adapter behavior. Running policy after
claim would change rejection precedence and risk quota effects before denial.
The current seven-call path preserves those boundaries. This is an explicit
engineering deferral, not a proof of the theoretical minimum. The live-policy
E2E now covers the denial and replay invariants for a future redesign.

A fresh SDK build and instrumented benchmark Gateway ran three registration,
first-sign, and subsequent-sign flows on September 30. All six signatures
verified. Each signature made **seven D1 calls / eight SQL statements**, with
**two write-bearing calls / 14 D1-reported rows written**. All 48 signing SQL
statement results reported APAC and primary service; no signing metadata was
missing. Linked signing remains measured locally at nine calls.

| Per complete signature | First signing, n=3 | Subsequent signing, n=3 |
| --- | ---: | ---: |
| D1 call elapsed, median | 559 ms | 533 ms |
| D1 call elapsed, range | 557–567 ms | 529–560 ms |
| SQL execution, median | 12.48 ms | 10.87 ms |
| Prepare + finalize server time, median | 755 ms | 690 ms |
| Prepare + finalize server time, range | 716–791 ms | 677–702 ms |
| Automated browser window, median | 3,029 ms | 3,032 ms |
| Automated browser window, range | 3,022–7,576 ms | 2,260–7,596 ms |

The two policy calls totaled 734 ms across six signatures, averaging 122 ms
per signature. This measures their current cost; it does not predict the savings
from changing their ownership or query shape. Browser windows include harness
orchestration, automated confirmation, and signature verification. Their excess
over server time cannot be attributed to D1 or presign refill without a joined
client/request timeline. Neither these windows nor the server-only totals prove
the 1–2 second system-controlled maximum.

Provenance and operational checks:

- SDK rebuilt from `4da0e84c83c620081f2faa3e13d7d6b3598aff45` using the
  existing WASM outputs; freshness and static asset checks passed. SDK artifact
  SHA-256: `010e9e93991ce6e8597c835690e946aca48c67e1ff8044aa45674adb25f8b1ec`.
- Instrumented Gateway version: `0e37484b-9118-42c1-a89f-59b5ece3249d`.
  Bundle SHA-256: `6c9c9dcae2d11a7cb203dfd37e5b012d4152b446406d14356cb359872d6326a8`.
  Existing database, schema, and five role Worker deployments were retained;
  role deployment identities were captured during the run.
- This was an operator-browser diagnostic. Browser, Gateway, and DO physical
  locations were not independently verified. It is separate from R150's regional
  cohorts and establishes no regional D1 gain or controlled before/after latency
  comparison.
- Both original benchmark ingresses returned 503 during readiness checks. Saved
  access expiry was `2026-09-30T01:23:06.953Z`. Only the existing DO ingress's
  expiry was temporarily extended with its existing credential. The baseline
  Gateway `e1fa8688-6f5a-45bf-862b-442241789e16` and saved expiry were restored;
  deployment inspection and a 503 health response verify restoration/closure.
- Three preflight failures remain in separate artifact directories: an immediate
  readiness failure, followed by two local-origin readiness failures involving
  an existing IPv4 listener on port 4202. No wallet work ran in those attempts.
  Explicit IPv6 readiness URLs allowed the final browser run to proceed without
  disturbing that listener. No container restarts, wallet resets, new credentials,
  schema changes, or production/staging deployments occurred.
- Cumulative observed-usage cost estimate: **$0.6462** through
  `2026-09-30T11:10:28.738Z`, within the $25 cap. Accounting can lag requests;
  the report applies list rates without shared monthly allowances. Container
  compute rates were checked against the current
  [Cloudflare pricing](https://developers.cloudflare.com/containers/platform/pricing/).

Artifacts: `.artifacts/r151/hosted-current-20260930-r4/`, including three full
browser timing artifacts, `d1-analysis.json`, `summary.json`, build identities,
role deployment identities, restoration evidence, and cost accounting. Recheck
with `python3 .runtime/r151-hosted-readiness/analyze.py`. The earlier directories
without a suffix and with `-r2` / `-r3` retain failed preflights. Access-token and
private-key marker scans passed for the successful cohort's JSON artifacts.
The existing D1 trace E2E also passed after the rebuild.

The next executable work is to attribute the browser/server gap using the
existing client lifecycle and request timings, including foreground refill and
harness/confirmation time. Then run first/warm/burst and linked-signing cohorts
on fixed builds with verified probe locations. Compare Gateway placement near
the existing primary before any R152 regional ownership change. Revisit policy
projection consolidation if that measured residual justifies the wider contract
change; retain both durable writes until their invariants have an equivalent
replacement. R151 remains open for complete latency and placement evidence.

### SDK, refill, and harness attribution — September 30

The unforced signing E2E now records the public `signTempo` call duration,
existing SDK timing stages, Gateway request/response offsets, browser request
elapsed time, and harness phases. The harness reports page setup, completion
observation, confirmation-automation drain, and confirmation settlement
separately. The public SDK duration includes confirmation. Stage timers overlap:
`commit_total` contains authorization/signing work and `sign_total` contains its
child stages. These values must not be added as independent intervals. Observer
receive offsets use the test process clock and are distinct from browser-side
durations. Artifacts retain only timing fields, route paths, and existing D1
metadata; the new collector does not persist operation IDs or request bodies.

The first attributed hosted cohort reproduced two slow signatures. Their
public SDK calls took 7,059 and 7,167 ms, including 3,844 and 3,671 ms waiting on
an in-flight presign refill. Each subsequently issued a foreground refill init
and five step requests. Harness overhead therefore did not explain those slow
samples. That cohort also exposed an observability gap: `foreground_refill` was
already a declared timing stage but was never emitted. The signing path now
emits that timer around successful foreground refill/retry and material retrieval;
refill scheduling, authorization, and protocol behavior are unchanged.

After rebuilding, a separate six-signature hosted cohort measured:

| Measurement | Median | Range |
| --- | ---: | ---: |
| Automated browser window | 3,035 ms | 2,287–3,062 ms |
| Public SDK call, including confirmation | 2,199 ms | 2,011–2,705 ms |
| SDK commit work | 1,565 ms | 1,063–2,088 ms |
| Waiting on in-flight refill | 531 ms | 0–750 ms |
| Time outside the public SDK call | 737 ms | 277–979 ms |
| Harness automation drain after completion observation | 521 ms | 62–754 ms |
| Harness confirmation settlement | 152 ms | 139–167 ms |
| Gateway prepare + finalize server time | 720 ms | 695–824 ms |

All six signatures still made seven D1 calls / eight SQL statements, with two
write-bearing calls. D1 reported APAC. This cohort did not enter foreground
fallback, so it does not replace or invalidate the earlier slow observations.
Its smaller windows demonstrate sampling variability, not a performance gain
from adding a timer. Neither cohort establishes a 1–2 second maximum or regional
placement benefit; probe and Gateway/DO physical locations remain unverified.

A focused E2E now aborts background refill init requests, then signs twice through
the normal SDK. It requires foreground-refill timing, independently verifies both
signatures, and checks that exactly two of the three reusable quota uses were
consumed. This passes on Workers, wallet-DO, and VM. Normal first/subsequent
signing also passes on all three local profiles. Together with the final hosted
cohort, these checks verify 18 signatures. SDK builds, intended-suite type checks,
diff checks, and the bloat ratchet pass. No unit tests were added.

Artifacts and reproduction:

- Local normal/fault evidence: `.artifacts/r151/attribution-20260930/`.
  Run `.runtime/r151-attribution/verify.mjs` for normal signing and
  `.runtime/r151-attribution/verify-fallback.mjs` for wallet-DO/VM fallback;
  use `run.mjs foreground-workers workers passkey.presign-pool.contract.test.ts
  'failed background refill falls back'` for the Workers fallback case.
- Initial hosted attribution: `.artifacts/r151/hosted-attribution-20260930/`.
- Hosted cohort after adding the foreground timer:
  `.artifacts/r151/hosted-attribution-20260930-complete/`, including build/source
  hashes, six timing windows, D1 analysis, restoration evidence, and cost report.
  Recheck with `python3 .runtime/r151-attribution/analyze.py`.
- Both hosted runs used the existing isolated DO benchmark and retained its
  database/schema and role deployments. The baseline Gateway and expired access
  window were restored. Deployment inspection and ingress health checks confirmed
  restoration. Cumulative observed-usage estimate is $0.6482 through
  `2026-09-30T11:24:55.177Z`; accounting can lag. Artifact credential scans passed.

### Canceled Gateway refill diagnosis and correction — September 30

The demonstrated cause is the Gateway's module-global presign priority gate.
Canceling a request after it acquired a background ticket can terminate the
Worker invocation without executing its `finally` release. The isolate retains
`backgroundInFlight = 1`. Subsequent background requests poll that stale counter
until the SDK's five-second exchange deadline aborts them. Foreground replacement
bypasses the background gate and succeeds, explaining the empty refill result
followed by a second ceremony. The failure is a production regression in request
isolation; the five-second deadline is working as intended.

An unchanged-build hosted cohort recorded six `network_error` refill results
and six foreground fallbacks across twenty verified signatures. Their init
requests aborted at approximately 5,000 ms. A separate twenty-signature cohort
with temporary gate tracing recorded eight fallbacks. The trace includes one
isolate acquiring a background ticket, cancellation after 397 ms with no
release, and subsequent background requests entering that same isolate with
counter one and canceling after 4,991–4,995 ms. Foreground requests continued to
acquire and release while the stale background count remained one. The temporary
trace recorded only a random gate identifier, phase, traffic class, and counts;
it has been removed from production source.

The correction deletes the Gateway gate and its queue timing metric. Client
pool scheduling still bounds refill concurrency and retains foreground priority
through fallback. Every Gateway exchange still performs live authorization,
material checks, admission, and the existing protocol operation. Ceremony and
HTTP deadlines, quota consumption, persistence, and single-use material remain
unchanged. Request-local execution follows Cloudflare's guidance on
[avoiding mutable global request state](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

The new controlled E2E uses the existing local Gateway fault boundary. It holds
an admitted init at the signing-worker proxy, aborts its HTTP request, and lets
the ordinary SDK refill proceed. It signs twice and verifies distinct
presignatures and quota three → one. With the old gate it produces two failed
background refills and SDK calls of 4,538 and 4,451 ms. With the correction the
Workers calls take 416 and 387 ms, with usable background material and no
foreground fallback. The corrected scenario also passes on wallet-DO and VM.
The natural hosted cohorts use the same SDK distribution hash and unchanged
role deployments; only the Gateway changes:

| Hosted cohort | Verified signatures | Failed refills / fallback signatures | Public SDK median | Public SDK range | Commit median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unchanged Gateway | 20 | 6 / 6 | 2,746 ms | 2,013–7,771 ms | 2,074 ms |
| Diagnostic gate trace | 20 | 8 / 8 | 2,753 ms | 2,022–7,952 ms | 2,176 ms |
| Corrected Gateway | 20 | 0 / 0 | 2,335 ms | 1,843–3,060 ms | 1,735 ms |

The timing collector now retains sanitized refill outcomes and failed-request
elapsed times. The old assertion that every foreground-tagged init implies a
new foreground ceremony was retired: an existing background ceremony can be
promoted when a signer starts waiting. The explicit SDK `foreground_refill`
stage identifies actual fallback.

Cancellation and first/warm/burst E2Es pass on all three local profiles;
stalled-exchange recovery and third-generation linked signing also pass.
One local attempt failed during tenant-root bootstrap before executing its test;
the fresh-state retry passed. The failure was classified as infrastructure,
and no production behavior was changed for it. A final cancellation recheck
passes against rebuilt SDK/server distributions after removing the retired
queue metric from the parser and its existing fixture. Intended-suite and
server type checks, build freshness, diff checks, and the bloat ratchet pass.
No unit tests were added.

A preceding six-signature baseline had no failures, illustrating the intermittent
nature of the defect. Keep these cohorts separate. SDK timing includes automated
confirmation; commit timing overlaps child stages. These are ordered, small
cohorts, with unverified browser/Gateway/DO physical locations. They establish
removal of the reproduced cancellation stall, not a production tail bound or a
regional D1 benefit. All 66 hosted signatures verify and retain seven Gateway
D1 calls / eight SQL statements / two write-bearing calls; D1 reports APAC.

Evidence and reproduction:

- `.artifacts/r151/refill-cancellation-20260930/` contains the controlled before/
  after artifacts and `comparison.json`. Run the intended contract selected by
  `--grep 'canceling an admitted Gateway refill'` from
  `tests/e2e/intended-behaviours/passkey.presign-pool.contract.test.ts`.
- `.artifacts/r151/hosted-refill-before-20260930/`,
  `hosted-refill-before-20260930-r2/`, `hosted-refill-gate-20260930/`, and
  `hosted-refill-fixed-20260930/` retain source/build hashes, per-request D1
  traces, refill results, request failures, and signing timings. The diagnostic
  cohort also contains sanitized `gate-events.json`.
- `.runtime/r151-refill/verify.mjs` runs the controlled cancellation and
  first/warm/burst cases on Workers, wallet-DO, and VM, plus stalled-exchange
  recovery and third-generation linked signing. The analysis command is
  `python3 .runtime/r151-refill/analyze.py`.

The isolated benchmark's original Gateway version and expired ingress window
were restored and checked (100% baseline version, readiness HTTP 503). Observed
cumulative spend is $0.6607 through `2026-09-30T12:09:31.124Z`, below the existing
$25 cap; usage accounting can lag. No staging or production deployment changed.

Remaining R151 work is reliable regional first/warm/burst and linked-signing
measurement, then a placement comparison near the existing D1 primary. Revisit
policy-read consolidation against that residual. R152 gains remain unmeasured.

### Verified Tokyo first/warm/burst diagnostic — September 30

The existing Cloudflare probe now selects the first/warm/burst workload and
retains public SDK timing, overlapping commit stages, refill results, and D1
traces. Two fresh-wallet attempts completed on `nrt13` (APAC, Japan), verifying
ten signatures, including two untimed setup signatures. Both concurrent bursts
exhausted the shared three-use session budget after their setup signature.
Source revision `cad79fa2ab88` and SDK build-input hash `561bc6849011…` were
verified against the container identity before each attempt; both used one boot.

| Tokyo workload | Timed signatures | SDK median / observed maximum | Commit median / observed maximum |
| --- | ---: | ---: | ---: |
| First | 2 | 2,687 / 2,940 ms | 1,758 / 1,976 ms |
| Ready-pool warm | 2 | 2,026 / 2,040 ms | 1,252 / 1,270 ms |
| Concurrent burst, individual calls | 4 | 4,785 / 6,626 ms | 2,279 / 2,424 ms |

SDK timing includes automated confirmation. Concurrent calls overlap; their
elapsed times must not be added. Commit stages are narrower overlapping spans.
These samples do not establish the complete 1–2 second target.

No failed background refill or `foreground_refill` fallback was observed in the
two completed attempts. First signatures waited 195–728 ms for material; burst
signatures waited 957–1,257 ms. Neither burst had its selected material completed
at its start. Warm signatures used previously completed material. The cancellation
stall is absent from these samples; successful refill latency still contributes.
All eight timed signatures retain seven D1 calls, eight statements, two
write-bearing calls, and 14 reported row writes, served by the APAC primary.
First/warm D1 wall totals are 534–619 ms versus 10.81–13.71 ms SQL execution.
Gateway and custody DO execution locations remain unknown.

The planned regional cohort did not complete. Tokyo attempt three returned no
artifact and empty process output; its exit status was not persisted. London's
first attempt on `lhr15` (WEUR, UK) ended with `SIGTERM`, captured in the improved
result record. ENAM identity preflight returned HTTP 500 before any wallet
attempt. Treat these as unresolved infrastructure failures, preserve all attempt
ledgers, and do not retry operations with unknown outcomes. The current-build
cohorts contain two completed and two failed wallet attempts, plus the ENAM
preflight failure; only the completed Tokyo attempts supply latency samples.

An earlier attempt exposed a valid harness gap: direct budget-status verification
omitted the hosted ingress Origin and access token. The shared replay helper now
supplies both; ordinary Wallet authorization remains unchanged. The existing
first/warm/burst E2E passes locally after this correction, along with intended
type checking and the bloat ratchet. Access-window propagation and an image
mismatch were caught separately in preflight. No regional placement treatment
or regional database was introduced.

Evidence is retained in `.artifacts/r151/regional-workloads-20260930-r4/` (Tokyo),
`regional-workloads-20260930-r5/` (London/ENAM), and
`regional-workloads-20260930-summary/` (`summary.json`, `restoration.json`). Earlier
preflights and the failed harness cohort remain separate. Reanalyze with
`python3 .runtime/r151-regional/analyze.py`; the committed probe workload selector
is `first_warm_burst`, using the existing intended E2E selected by
`--grep 'first, warm, and concurrent burst'`. Private orchestration and exit logs
remain under `.runtime/r151-regional/`.

Rollout records show replacements continuing for two to four minutes after
Wrangler returned. A matching serving image can appear before replacement has
finished. Future preflight must check the latest rollout's completed state,
application version, and target image before starting wallet work. Read the
latest rollout record because `active_rollout_id` clears after completion.
A separate attempt with the initial completion checker stopped before wallet
work because it mishandled that cleared field. Restoration now waits for
settled rollouts. Whether replacement caused the captured subprocess signals
still needs confirmation; do not attribute them to the refill cancellation bug.

Final verification confirms all three original probe images with completed
rollouts, inactive probe instances, the original probe/Gateway Worker versions,
and expired access windows (probe HTTP 403, ingress HTTP 503). Evidence contains
no benchmark access-token values. Observed cumulative spend is $0.6994 through
`2026-09-30T13:03:18.086Z`, below the $25 cap; accounting can lag.

Next, diagnose probe process termination and ENAM startup, then complete regional
and linked cohorts with fixed builds. Only then compare Gateway placement near
the existing primary. R152 ownership and expected gains remain conditional.

### Stable-rollout regional cohort — September 30

The committed `tests/r150-hosted/probe/wait-for-rollouts.mjs` checker requires
completed rollout records, matching application/target versions and image
hashes, and two stable observations. Wrangler supplies and refreshes credentials.
It reads the latest rollout history after `active_rollout_id` clears. Both
measurement deployment and restoration use this gate; explicit image rollouts
preserve the existing applications and configuration. No schema, role, SDK,
or signing behavior changed for this cohort.

The fresh cohort completed seven wallet attempts and verified 35 signatures:
five in Tokyo (`nrt13`), 15 in London (`lhr15`), and 15 in the US (`ord12`). Each
region retained one verified boot and the same frozen source/SDK image. All
three London and US attempts completed without process termination or startup
failure. This supports the corrected rollout preflight; it does not prove the
origin of every earlier signal.

| Probe | Completed wallets | First SDK median | Warm SDK median | Burst SDK median, individual calls | First/warm D1 wall median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tokyo | 1 | 2.91 s | 1.97 s | 4.36 s | 614 ms |
| London | 3 | 5.43 s | 4.04 s | 8.91 s | 1,766 ms |
| US | 3 | 5.76 s | 4.14 s | 9.52 s | 1,672 ms |

D1 SQL medians for the same first/warm samples are 16.56, 11.94, and 11.18 ms.
All 28 timed signatures retain seven calls, eight SQL statements, two
write-bearing calls, and 14 reported row writes; all report the APAC primary.
The seven untimed setup signatures also verify. Completed attempts show no
failed background refills or foreground-refill fallbacks. Burst commit medians are 1.88, 4.63, and 4.84 seconds;
SDK timings additionally include automated confirmation and concurrent calls
overlap. These small cohorts do not satisfy the complete 1–2 second target.
Gateway/DO execution placement and recoverable geographic overhead remain
unproven. No Gateway-placement or regional-D1 treatment was compared.

Eight wallet attempts were dispatched: seven completed and Tokyo's second
attempt timed out during `unlockPasskeyWallet`, with exit code one and no
process signal. The retained trace shows successful refill rounds, while the
unlock action remains running. Classify this as an unresolved lifecycle or
automation failure; its cause is not established. The runner withheld further
Tokyo attempts and retained the failure. Do not count its partial work as a
completed sample or silently retry it. No probe process signal recurred.

Evidence: `.artifacts/r151/regional-workloads-20260930-r7/`, including per-region
ledgers/results, `summary.json`, D1 analysis, rollout observations, and execution
file hashes. Reanalyze with `python3 .runtime/r151-regional/analyze-r7.py`.
Restoration is verified against direct application/rollout records: original
images, inactive instances, baseline Workers, and expired access windows. The
CLI list view retained older image values for two apps; both stable direct
observations are retained. Observed cumulative spend is $0.7435 through
`2026-09-30T13:36:40.621Z`, below the $25 cap, with accounting lag possible.
Remaining work is diagnosing the unlock timeout, completing linked latency
cohorts and larger regional samples, verifying actual Gateway/DO execution
placement, and comparing Gateway placement near the existing primary. Retain
the explicit policy-read deferral until that residual is understood.

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
  retaining the linked custody fallback and verifying the admission races.
- [x] Use the existing store/domain boundaries and narrow admitted result types.
  Delete replaced paths. Do not add request-wide caches of revocation or quota
  decisions, compatibility branches, or another authorization implementation.

First measurable goal: at least two fewer sequential calls per signature from
the policy change. Then target 12 or fewer from the larger consolidation, subject
to the correctness cases below. Each change needs its own before/after call
counts and timings; these are engineering targets, not predicted latency wins.
The 12-call intermediate milestone is surpassed: canonical reusable-session
ECDSA now takes seven calls; linked signing takes nine after the prepare batch.
Phase 3 still revisits the complete call budget after these incremental changes.

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
- [x] Measure warm pool, immediate first sign, and burst signing separately in
  a bounded local diagnostic with signature and shared-quota verification.
- [x] Diagnose and fix the repeated linked-presign worker timeout/reset. Retire
  the stale authority channel and verify repeated three-device signing on
  Workers D1, wallet-DO, and VM, preserving per-signature D1 evidence.
- [x] Extend the hosted probe with first/warm/burst SDK timing and verify a
  bounded Tokyo diagnostic, retaining shared-quota and signature checks.
- [x] Gate measurements on completed image rollouts and collect bounded
  first/warm/burst evidence from verified Tokyo, London, and US probes.
- [ ] Diagnose the hosted unlock timeout and complete linked/larger regional
  cohorts. Reduce demonstrated refill waits using existing scheduling, preserving
  distinct presign and signing authorization boundaries.
- [x] Inventory foreground Gateway signing writes by invariant: claim/idempotency,
  quota consumption, completion/replay, audit, and unrelated maintenance. The measured signing path
  has two write-bearing calls, both enforcing current behavior. No demonstrated
  redundant signing write is approved for deletion.
- [x] Report round trips, write-bearing calls, and D1 rows written separately.
  Batching saves calls; it does not itself eliminate writes. Preserve atomic
  quota effects, one-use material, audit semantics, and durable response replay.

### 3. Revisit the minimum signing call budget (deferred follow-up)

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
- [ ] Consolidate reads and guarded writes around those decision points using
  the existing stores and SQL transactions. Preserve rejection precedence,
  tenant/environment binding, expiry/revocation checks, material retirement,
  one-use material, atomic quota consumption, and exact durable replay.
- [ ] Prioritize read round trips. Retain the admission and completion writes
  unless an equivalent durable invariant is demonstrated. Count calls, SQL
  statements, write-bearing calls, and reported row writes separately.
- [ ] Verify concurrent last-quota contention, duplicate admission, revocation
  and retirement races, and lost-response replay with behavioral E2Es. Measure
  successful signing, replay, and rejection paths separately; retain repeatable
  before/after artifacts and complete system-controlled latency measurements.
- [ ] Close this phase only after implementing the supported reductions and
  recording the resulting call budget, the reason for each remaining round
  trip, and any explicitly deferred blocker. A green latency median alone does
  not establish that the call budget or the 1–2 second maximum is satisfied.

### 4. Reassess placement using measured residual cost

The controlled placement experiment and conditional regional ownership design
are tracked in [R152: regional D1](refactor-152-regional-D1.md). R151 supplies
the residual call budget and latency evidence required for that decision.

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
