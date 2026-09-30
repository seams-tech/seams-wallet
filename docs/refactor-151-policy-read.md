# R151 credential and policy read consolidation

Date: October 1, 2026

## Change

ECDSA reusable-session credential reads now include project and abuse policy
candidates for the wallet's persisted signer scopes. Material verification still
selects the canonical signer or validates the linked custody chain before policy
evaluation. The configured admission adapter consumes only the decision for that
verified scope, wallet, and requested material activation.

The snapshot is bound to its in-process database instance and storage namespace.
A D1 adapter with a different database or namespace reads its own policy store.
Custom adapters retain policy ownership. Ed25519 and operation step-up continue
using their existing policy read. Every prepare, finalize, and completed replay
reads fresh persistence evidence; no cross-request authorization cache is added.
Project rejection retains precedence over abuse rejection and rate limiting.
Malformed policy decisions are retained as failures until policy evaluation.

The measured Gateway prepare/finalize budget is five D1 calls / six SQL
statements per successful signature:

| Phase | D1 call | Invariant |
| --- | --- | --- |
| Prepare | Credential, material, and policy snapshot | Live session, authority, method, quota candidate, verified material and policy |
| Prepare | Atomic claim plus readback batch | One quota use and one operation claim; reject changed material |
| Finalize | Credential, material, and policy snapshot | Fresh authorization and policy, including exhausted-session replay |
| Finalize | Existing operation and source resolution | Prepare must exist; material and stored operation must match |
| Finalize | Durable completion | Persist the exact replayable result and audit |

Both write-bearing calls remain. All 27 hosted signatures verified **5 calls /
6 statements / 2 write-bearing calls / 14 reported row writes**, with complete
APAC-primary metadata. The previous hosted budget was 7 / 8 / 2 / 14. This removes
29% of Gateway D1 calls and 25% of its SQL statements.

## Verification

Source commit: `78a6a4c2`. All **30 browser scenario/profile checks passed**
(six signing/policy scenarios and four linking/retirement scenarios on each of
Workers D1, wallet-DO, and VM). The direct policy-store E2E passed 72 assertions
across D1, SQLite, and memory. Server build and intended/state type checks passed.
The SDK rebuild validated its static assets and reproduced all 1,829 JavaScript
and WASM runtime files byte for byte.

The behavioral cohort covers first/warm/concurrent signing, missing prepare,
project/abuse/rate-limit precedence, exact completed replay, lost finalize
responses, final-quota contention, linked material retirement, revocation, and
three-device signing. A new third-generation linked policy scenario verifies the
canonical policy scope and requested linked activation together.

The canonical and linked policy scenarios each exercise nine denials with no
quota, claim, or audit changes. They then sign and replay successfully while
12 unrelated policy records remain: other namespace, organization, project,
environment, signing-root version, wallet, and activation. Static fixtures reject
fabricated or spread policy snapshots and invalid policy-read source branches.

Repeat with the intended-behavior runner and select:

- `passkey.presign-pool.contract.test.ts`: first/warm/burst, missing prepare,
  live signing policy, third-generation linked signing, concurrent prepare and
  admitted finalize, and distinct concurrent prepares.
- `passkey.device-linking.contract.test.ts`: second-device passkey linking,
  linked-to-third-device signing, and material retirement between resolution
  and admission.
- `node tests/r150-hosted/gateway/admissionPolicy.e2e.mjs`: D1, SQLite, and
  in-memory policy-store behavior, malformed rows, expiry, and scope isolation.

Run the browser scenarios on Workers D1, wallet-DO, and VM. Retained artifacts
are under `.artifacts/r151/policy-read-20261001/`; run records include built
SDK/server hashes. The SDK remains frozen during these measurements.

The initial wallet-DO run was interrupted after a concurrent local build briefly
replaced its loaded files. It is excluded from verification. The subsequent
run used a fixed build. Formatting also moved one static fixture's expected-error
annotation; correcting the annotation restored the intended compile-time check.
The first VM cohort passed the four signing/policy scenarios, then two existing
quota assertions exposed a fixture isolation bug: their whole-database sum included
200 unused owner/intermediate-device uses from the preceding linked scenario.
The invariant remains supported. Quota evidence now selects the signing wallet
through its persisted sessions; the subsequent cohort reruns the same assertions.

## Hosted comparison

Three fresh London cohorts completed 27 verified signatures: nine canonical,
nine directly linked, and nine third-generation linked. No attempt failed or
was retried. Gateway source was `78a6a4c2`, deployed as
`35d58aa7-ebad-4cea-bda7-90938bce921b`. The browser SDK stayed at `57388d7f`
in image `sha256:842fa08261267f201d1dd9cd905d624590a24d7a9e9f1d510db96cff82c9b585`.
The probe ran in `lhr15`, boot `f204afc8-fcd3-41ce-bb93-f27c241dd8c1`.

Baseline is the preceding r14 cohort on the same SDK/role builds. Each cohort
contains nine canonical and 18 linked signatures; wallets and times differ.

| Median per signature | Seven-call baseline | Five-call change |
| --- | ---: | ---: |
| Canonical public SDK | 4,243.8 ms | 3,654.6 ms |
| Linked public SDK | 3,061.5 ms | 2,511.8 ms |
| Canonical signing-request D1 wall | 1,814 ms | 1,277 ms |
| Linked signing-request D1 wall | 2,072.5 ms | 1,598.5 ms |
| Canonical signing-request SQL | 11.35 ms | 11.97 ms |
| Linked signing-request SQL | 13.21 ms | 13.68 ms |

Canonical SDK median fell 14%; linked median fell 18%. Changed SDK ranges were
3,530.5–3,718.4 ms canonical and 2,335.1–2,995 ms linked. All samples are retained.
Canonical `commit_total` median was 2,219.3 ms (range 2,141.1–2,297.9); linked
median was 1,968.5 ms (range 1,786.5–2,525.7). Canonical material authorization
within commit had a median of 558.7 ms across nine samples.
The 1–2 second complete maximum remains unmet.

All six first linked signatures consumed the exact precompleted presignature
IDs; no signing window needed foreground refill. The harness waits for that
readiness before starting the timer. These measurements cover ready-material
signing and include automatic confirmation. They establish neither immediate
post-link latency nor a production percentile/maximum guarantee.

Evidence: `.artifacts/r151/regional-policy-read-20261001-r15/`, including source
and WASM identities, attempt ledger, original per-request D1 headers,
`summary.json`, `comparison.json`, and `residual-stages.json`. Analyze an original
signature artifact with `node tests/r150-hosted/analyze-d1.mjs <artifact.json>`.
The retained private cohort analyzer additionally asserts 5/6/2/14 and complete
APAC-primary metadata for every signature.

Version-specific adaptive analytics record 754 Gateway invocations in LHR and
one in NRT for the measured version. Role DO aggregates include AMS, KIX, LHR,
and NRT. These aggregates do not attribute each signature's individual custody
RPCs; see `placement.json` and `placement-summary.json`.

Restoration passed on the first post-run verification: original Workers/images,
all three probes inactive, default Gateway placement, probe HTTP 403, and ingress
HTTP 503. Observed cumulative benchmark cost was **$0.9873** at September 30
17:03 UTC, subject to accounting lag, against the existing $25 cap. See
`restoration.json` and `final-cost.json`. The final evidence scan found no
benchmark-token matches. No regional database was provisioned.

## Remaining gates

The full 1–2 second signing target and regional-primary benefit remain unproven.
The Gateway budget covers the two signing requests. The SDK timing also includes
material authorization and other work outside those requests. Follow up by
attributing that stage to individual requests/local work and recording the full
foreground request inventory. The canonical flow re-resolves authority after
confirmation (`signingFlow.ts` / `signingFlowRuntime.ts`); retain that freshness
boundary when evaluating reductions.
Five calls is a dependency inventory, not a proven theoretical minimum. Further
reductions require preserving the verified operation/source and atomic quota
boundaries. R152 owns regional-D1 ownership and placement evaluation. Production
rollout remains separate.
