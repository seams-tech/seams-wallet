# NEAR local latency breakdown and candidate experiments

Measured 2026-09-29. The first two follow-up steps are complete: repair NEAR-only
refresh signing and add the missing local registration/signing breakdowns.
**Four focused lifecycle E2Es passed; the final benchmark passed 40 registrations
and 80 independently verified signatures with zero retries.** Network work remains deferred.

## Correctness repair

NEAR-only registration installed a live signing client but omitted the sealed
session needed to restore that client after reload. The lane inventory therefore
had no restorable NEAR candidate. This was a `production_regression` against
[Page Refresh Before Signing](./intended-behaviours.md#page-refresh-before-signing).

Registration now awaits the existing session-hydration/persistence path before
reporting completion. NEAR-only and mixed registration share the same hydration
input builder. Exact lane selection and authorization checks are unchanged.
The existing NEAR-only lifecycle contract now registers, signs twice, reloads,
and verifies another signature without a new passkey prompt or Yao activation.

The historical 751 ms NEAR-only result omitted this required work. Keep it as
historical evidence; use this corrected baseline for optimization comparisons.
This change establishes correct readiness and makes no speedup claim.

## Corrected baseline

Milliseconds; 20 samples per row. Median averages the middle pair; p95 is nearest
rank and descriptive at this sample size. Mixed public return and inner NEAR
readiness have different start boundaries and cannot be subtracted or directly
compared with NEAR-only public readiness.

| Boundary                                     | Median |   p95 | Maximum |
| -------------------------------------------- | -----: | ----: | ------: |
| NEAR-only public SDK registration → ready    |  906.9 | 924.0 |  1112.8 |
| Mixed public registration hook → ECDSA ready |  763.8 | 787.6 |   788.9 |
| Mixed inner SDK registration → NEAR ready    |  914.4 | 952.6 |   964.0 |
| NEAR-only first signing, public SDK          |  372.1 | 390.6 |   424.3 |
| NEAR-only warm signing, public SDK           |  363.1 | 367.5 |   404.1 |
| Mixed first NEAR signing, public SDK         |  372.8 | 389.6 |   393.3 |
| Mixed warm NEAR signing, public SDK          |  364.6 | 370.1 |   376.1 |

## Registration attribution

These NEAR-only stages are consecutive intervals inside the registration branch.
Their per-sample total approximates its inner return (749.0 ms median).
Public SDK return also includes the surrounding iframe/API work. The captured
iframe connection timings are zero in this preconnected harness; they do not
explain that remaining public-call envelope. The summary's older bucket fields
cover only their instrumented work; a missing/zero bucket is not evidence of no work.

| NEAR-only stage       | Median ms |
| --------------------- | --------: |
| setup                 |       8.7 |
| authentication        |     234.3 |
| respond               |      19.4 |
| custody               |     296.7 |
| backup and checkpoint |       1.8 |
| activate              |       6.6 |
| provision checkpoint  |       0.9 |
| finalize              |      29.4 |
| publication           |      11.2 |
| session hydration     |     135.0 |
| material activation   |      10.0 |
| export capability     |       6.0 |
| wallet ready          |       1.7 |

The custody Router round is 269.6 ms. Its server header attributes 39.0 ms
to pair preparation and 207.5 ms to role execution. Role execution includes
role dispatch and validation; it is not a CPU-only cryptographic measurement.
The remaining header subspans and all raw safe timings are in the JSON artifact.

The newly required refresh persistence is 135.0 ms. Its nested diagnostics expose
client sealing, the server seal route, client unsealing, and local persistence.
These are nested spans: do not add the parent span to its children. Mixed
registration already prepares the seal during custody and carries the prepared
server seal through finalization, making it the useful implementation comparison.

## Signing attribution

Median milliseconds. `prompt.decisionWaitMs` is nested within `confirmation`;
`signature total` is nested within `confirmed to signed`. Other listed engine
stages are consecutive, and `unattributed sdk` is computed per sample before
aggregation. Do not sum medians to reconstruct a median total.

| Stage                 | NEAR-only first | NEAR-only warm | Mixed first | Mixed warm |
| --------------------- | --------------: | -------------: | ----------: | ---------: |
| preparation modal     |             6.8 |            1.6 |         6.5 |        1.6 |
| authorization probe   |            13.2 |            9.7 |        14.1 |       10.6 |
| lane preparation      |            43.2 |           33.5 |        41.0 |       34.8 |
| execution setup       |            20.3 |           18.5 |        21.8 |       20.1 |
| pre confirmation      |             3.0 |            2.2 |         3.2 |        2.4 |
| confirmation          |           200.8 |          220.7 |       201.4 |      216.6 |
| prompt.decisionWaitMs |           191.0 |          215.0 |       192.0 |      211.0 |
| confirmed to signed   |            52.0 |           44.7 |        52.0 |       45.6 |
| signature total       |            43.1 |           40.1 |        42.7 |       39.9 |
| unattributed sdk      |            32.8 |           32.7 |        33.3 |       32.5 |

Every measured SDK signature issued **eight `POST /wallet/session/status`
requests** between its SDK start/return markers. This count identifies a useful
investigation; it does not imply that all eight reads can safely be removed.

The confirmation decision interval includes UI readiness, automated clicking, and
decision handling. It is not measured human wait or pure rendering cost. The
artifact also reports elapsed time outside this interval; that subtraction is a
diagnostic, not a complete system-only latency claim. The residual SDK interval
includes uninstrumented API validation/paint scheduling, bridge work, and return
handling. `actions.ts` explicitly awaits a UI animation frame before engine entry;
its individual contribution has not yet been timed.

## Candidate experiments, in order

| Priority | Experiment                                                                                                            | Measured opportunity and success criterion                                                                                                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | Reuse mixed registration's early seal preparation and prepared-server-seal finalization for NEAR-only                 | 135.0 ms is currently exposed in refresh persistence. Hide independent preparation under custody and avoid a separate seal exchange where the existing protocol supports it. Retain an improvement only if public durable-ready median and p95 improve in matched cohorts.                                                     |
| 2        | Share compatible pre-confirmation session/inventory reads within one signing operation                                | Eight status requests per signature; separate authorization-probe, lane-preparation, and execution-setup costs are now visible. Reuse the existing read scope and exact prepared facts where valid. Require fewer requests and lower SDK latency outside decision wait. Keep required prepare/finalize authority checks fresh. |
| 3        | Profile the role-execution portion of registration, then trial one demonstrated serialization/setup/storage reduction | 207.5 ms role execution plus 39.0 ms pair preparation. Split local CPU, serialization, storage, and dispatch before choosing a change. Reuse only immutable setup within existing lifecycle boundaries; retain identical protocol outputs and recovery/replay behavior.                                                        |
| 4        | Attribute the remaining API/iframe and UI-paint scheduling intervals                                                  | The residual engine-external signing time and public registration envelope remain explicit. Add boundary timers, then test coalescing a demonstrated redundant wait. Preserve visible secure review and trusted confirmation semantics.                                                                                        |

For experiment 1, retain the refresh E2E and exercise lost-response resume,
leading-zero PRF restoration, and lock during completion. Registration must await
both durable persistence and material installation. For experiment 2, retain
refresh, lock, expiry/revocation, authority replacement, and final-use/step-up
invariants. Never replace mutable authority with a cross-operation cache.

Use one change per experiment, alternating baseline/candidate order on the same
quiet machine, with at least 20 wallets per registration kind per arm. Keep
release artifacts, diagnostic flags, confirmation automation, and backend type
fixed. Require verified signatures, zero automatic retries, no lifecycle failures,
and report every sample, median, p95, and maximum. Stage budgets are upper bounds
on opportunity, not predicted savings. A smaller targeted improvement should be
repeated before adoption. Do not optimize automated decision wait as if it were
all production compute, remove confirmation, or change the signing protocol for
this approximately 40 ms local signing exchange.

## Evidence and reproduction

- Source snapshot base: `aecf14da5eb506440e4156a4236cf70271adc2b7`, plus the recorded changes. The snapshot
  is a plain copy with shared installed dependencies, not a Git worktree.
- SDK build input hash: `ee0329720760b699305121080b11ed80db3078b35aae894a50033c33a4435da3`.
- 8,829 source/asset/config hashes matched after measurement. All five role
  stamps identify release D1 builds. Node 24.18.0, Playwright 1.55.0, Chromium
  140.0.7339.16, macOS arm64; virtual WebAuthn, stubbed chain RPC, no broadcast.
- One worker, fresh browser/wallet for each sample, one persistent local backend,
  alternating NEAR-only/mixed ordering. No benchmark-owned builds/audits ran
  during the final cohort; ordinary shared-machine background work was uncontrolled.
- Focused E2Es: NEAR-only register/sign/refresh; mixed leading-zero PRF refresh;
  late completion with cross-tab lock; refresh/export/budget exhaustion/step-up.
- SDK build, intended-app TypeScript check, and repository bloat check passed.
- Safe [measurements and provenance](./optimization-11-NEAR-local-breakdown.json)
  exclude credentials, recovery codes, request bodies, and full console traces.

Private evidence is under `.artifacts/optimization-11-near/20260929-breakdown/`.
`final/contracts.json` holds the four lifecycle passes. `final/benchmark.json`
holds the initial 40-pass instrumented cohort. `expanded/benchmark.json` retains
a 39-pass attempt with one browser/page closure during registration; its samples
are excluded here. `expanded/benchmark-repeat.json` and `summary-repeat.json`
are the complete final cohort, with source/assets unchanged between attempts.
The failed pre-fix reproduction and intermediate diagnostic reports are retained
separately. No partial runs were pooled or individual failures replaced.

Build and verify the release assets using the [baseline instructions](./optimization-11-NEAR-local-baseline.md#reproduce),
then use a fresh artifact/runtime directory for each run:

```sh
NEAR_RUN_DIR="$PWD/.artifacts/optimization-11-near/local-next"
mkdir -p "$NEAR_RUN_DIR"
SEAMS_INTENDED_EXTERNAL_GATEWAY=0 \
SEAMS_INTENDED_WALLET_HOST=workers \
SEAMS_INTENDED_SIGNING_SESSION_DEBUG=1 \
SEAMS_INTENDED_SKIP_BUILD=1 \
ROUTER_AB_WORKER_BUILD_PROFILE=release \
SEAMS_LOCAL_PORT_OFFSET=4000 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:8100 \
SEAMS_INTENDED_APP_URL=http://localhost:8201 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:8202 \
SEAMS_INTENDED_ROUTER_AB_ROOT="$NEAR_RUN_DIR/runtime" \
PLAYWRIGHT_JSON_OUTPUT_FILE="$NEAR_RUN_DIR/benchmark.json" \
pnpm -C tests exec playwright test \
  -c playwright.wallet-intended.benchmark.ci.config.ts \
  e2e/intended-behaviours/near-latency/passkey.registration.benchmark.test.ts \
  --reporter=json --output="$NEAR_RUN_DIR/results"
node tests/scripts/analyze-near-local-latency.mjs \
  "$NEAR_RUN_DIR/benchmark.json" "$NEAR_RUN_DIR/summary.json"
```

The analyzer rejects incomplete cohorts. Refresh/unlock latency distributions,
Email OTP, cold starts, hosted placement, and real network/chain costs remain
separate future measurements.
