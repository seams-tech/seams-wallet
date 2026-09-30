# Refactor 151: reduce Gateway D1 round trips

Date: September 29, 2026

Status: policy, claim/readback, operation/source, and persisted owner-scope
consolidation are implemented and verified in bounded hosted diagnostics. The
canonical reusable-session ECDSA path makes 12 D1 calls per signature, down from
18. A local linked-device checkpoint reduces third-generation signing from 24
to 20 calls; directly linked signing remains at 20.
Further call reduction and the minimum-call-budget review remain open; regional
databases are conditional. Production rollout is separate.

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
again so an already admitted operation can finish. Consolidating those two
classifications into one precise active/exhausted/unavailable result is the next
identified read reduction. It must preserve fresh authority/method checks and
refuse new admission when quota is exhausted.

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

### Remaining call and write inventory (September 30)

The canonical reusable-session path has the following six call positions on
each request. This accounts for all 12 foreground Gateway D1 calls and 13 SQL
statements per successful signature. It excludes status/refill requests and
storage internal to custody roles.

| Position | Prepare | Finalize | Freshness/invariant |
| --- | --- | --- | --- |
| 1 | Joined Wallet Session, authority, auth method, quota | Same read | Authenticate the current credential and its exact owner/environment before policy evaluation. |
| 2 | Resolve active signing material | Same read | Bind the requested activation, key handle, and policy scope to current material. |
| 3 | Combined project/abuse policy read | Same read | Evaluate the current signing policy in that material's scope. |
| 4 | Re-resolve material before admission | Same read | Reject material replaced or retired since initial authorization. |
| 5 | Existing operation, live authorization source, pinned owner scope | Same read | Exact operation identity, replay/in-progress state, and live authority; preserve denial precedence. |
| 6 | Claim INSERT plus committed readback in one batch | Completion UPDATE RETURNING | Atomically admit and consume quota, then persist the exact terminal response for replay. |

Direct and third-generation linked signing take 20 calls: each material
resolution expands from one canonical lookup to three calls, adding four calls
per request. Those calls resolve canonical material, verified installation-chain
evidence, and canonical signer candidates. The chain is verified once per
resolution; its two authorization/admission freshness boundaries remain distinct.

Position 4 moves the material check closer to admission; it does not make that
check atomic with the claim. Positions 1–5 enforce real invariants, but their separate transport calls are
not all proven necessary. The next server reduction should consolidate the
initial authority/material/policy decision and move the second material check
into an atomic admission predicate that handles canonical and linked material.
The existing registration-only signer SQL predicate is insufficient for linked
installations. Exact installation identity, verified package/projection
provenance, chain retirement, and canonical-signer ambiguity must survive any
replacement. Until that boundary is implemented and raced in E2Es, retain the
fresh resolver. R151's three-round-trip proposal remains a hypothesis.

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

### 1. Consolidate reads while preserving decision boundaries

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
The 12-call intermediate milestone is reached for reusable-session ECDSA.
Phase 3 still revisits the complete call budget after these incremental changes.

### 2. Reduce unnecessary work and classify writes

- [x] Record current-build status-request callers for the mixed-wallet refresh,
  warm-signing, and step-up lifecycle, with repeatable browser evidence.
- [x] Remove the second ECDSA preparation inventory read used only for generation
  metadata, retaining the inventory that selected the exact material candidate.
- [ ] Extend caller coverage as needed and coalesce overlapping status requests
  with the same semantics. Reuse already returned display data where valid.
  Keep server-side authorization fresh at admission.
- [x] Measure warm pool, immediate first sign, and burst signing separately in
  a bounded local diagnostic with signature and shared-quota verification.
- [ ] Repeat the workloads in controlled hosted cohorts and reduce demonstrated
  foreground refill waits using the established machinery.
  Preserve the distinct presign and signing authorization boundaries.
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
- [ ] Evaluate a roughly three-round-trip design for a successful signature:
  prepare validates authority/policy/material and atomically claims the operation
  with quota consumption; finalize resolves the claim and checks live authority
  and material before signing; completion durably records the replay response.
  This is a design hypothesis, not a proven minimum or a promise of three calls.
  Document any additional round trip that correctness requires.
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
