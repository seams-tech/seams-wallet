# Setup preflight and SDK completion

Date: 2026-10-13. SDK implementation and hosted comparison. No Worker deployment.

## Changes

- Start the setup CORS preflight during wallet runtime initialization when
  registration credentials are configured. Reuse the existing OPTIONS helper.
  It sends no credentials or body, skips same-origin requests, and ignores failures.
  It performs no registration, database write, or custody operation.
- Mark successful NEAR session seal hydration as consumed. The worker already
  removes the preparation and destroys its temporary key before returning.
  Registration no longer sends a second discard request for that preparation.
  NEAR-only registration uses this rule. Failed hydration retains cleanup.
- Keep durable publication, signer activation, export capability establishment,
  and session notification before successful SDK return.

Preflight overlap depends on initialization time and the browser's CORS cache.
Immediate registration may still wait for the exchange. There is one best-effort
warm-up per configured runtime, including runtimes used without registration.
The completion change removes one worker exchange. Hosted results follow below.

## Correction to the completion budget

The earlier analysis computed `end = setup.at - setup.durationMs + sdkRegistrationMs`.
The whole SDK duration starts before the internal setup stage. This calculation
adds earlier initialization to the completion interval and the post-passkey interval.
The earlier 144 ms figure is therefore not an available completion saving.

Reanalysis uses the observer timestamp of `near_sdk_registration_timing`, minus
the corresponding `near_only.finalize` or `near_only.authentication` timestamp.
These are console delivery timestamps on the same observer clock, not exact SDK
stage boundaries. They have delivery uncertainty and are not a new hosted run.

| Observer interval | 0.9.0 median / p90 | 0.9.3 median / p90 |
| --- | ---: | ---: |
| Finalize completion → SDK return | 43.22 / 56.31 ms | 54.32 / 58.59 ms |
| Passkey completion → SDK return | 2,238.54 / 2,950.51 ms | 1,642.35 / 2,129.80 ms |

Samples: 198 successful baseline wallets and 164 successful 0.9.3 wallets from
`.artifacts/r155h-singapore-anchor/baseline-090*` and `release-093*` in the private
repository. Each source is `group-*/registration-*.json`, with `outcome=succeeded`.
The maximum observed 0.9.3 completion interval is 69.98 ms.

Original records remain in `refactor-155h-release-093-staging.json`. Do not
interpret this accounting correction as a gain from the changes in this document.
The SDK's measured total registration and signing durations are unchanged.

## Verification

- SDK build and SDK type check pass.
- Intended-behaviour type check and repository bloat check pass.
- All four `passkey.near-registration-commit.contract.test.ts` cases pass (43.4 s).
  They cover initial signing without status reads, lock during a delayed query,
  exact replay, signing across reload, lost finalization credentials, and a failed
  server seal followed by unlock and signing.
- The first case records OPTIONS before setup POST. OPTIONS has no body or
  credentials. Browser request observation does not establish a hosted latency gain.

Reproduce after building the SDK and local backend:

```sh
SEAMS_INTENDED_SKIP_BUILD=1 \
SEAMS_INTENDED_ROUTER_AB_ROOT=/tmp/seams-setup-completion-verified \
SEAMS_INTENDED_APP_URL=http://localhost:4201 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4100 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4202 \
SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID=local-smoke-project:dev \
SEAMS_INTENDED_PUBLISHABLE_KEY=pk_local \
pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts \
  passkey.near-registration-commit.contract.test.ts --reporter=line
```

The tests emit JSON artifacts containing verified signatures and request evidence
under `tests/test-results/`. This run's copies are retained under
`.artifacts/setup-sdk-completion-20261013/`. No custody secrets are copied there.

## Hosted comparison

The [machine-readable record](refactor-155h-setup-sdk-staging.json) contains all
36 usable samples, group statistics, source revisions, and artifact hashes.

- Control: `9e8a85875c7a6c3886cab5928c2f9d2cb590562e`.
- Candidate: `8a7d8f7534f92d0f3b5dbc558cb3c2418a59afc9`.
- Tokyo Chromium, existing Singapore staging, 18 fresh wallets per arm.
- Six blocks of six wallets: control, candidate, candidate, control, control,
  candidate. Each block has two groups of three fresh browser contexts.
- Frozen production SDK builds served through local HTTPS at the staging origins.
  Backend requests use the real network. No browser request interception.
- All nine served WASM binaries match between arms. All 14 serving Worker
  versions match before and after. No backend or frontend deployment occurred.
- All 36 signatures passed independent Node Ed25519 verification, including
  rejection of changed signed fields. Every usable registration succeeded.

| Workload | Control median | Candidate median | Observed difference |
| --- | ---: | ---: | ---: |
| Setup stage | 545.50 ms | 522.85 ms | −22.65 ms |
| Finalize completion → SDK return | 56.91 ms | 54.88 ms | −2.03 ms |
| Registration, excluding passkey interaction | 2,909.07 ms | 2,840.35 ms | −68.72 ms |
| Registration plus first signature, excluding interaction | 3,372.85 ms | 3,462.65 ms | +89.80 ms |

These are observed differences, not established causal savings. Network and
backend stages varied substantially. Both arms were slower than the earlier
0.9.3 run. The combined flow did not improve at the median. This comparison
does not establish a reliable overall latency gain.

Explicit setup OPTIONS requests appeared in all 18 candidate samples and none
of the control samples. Their browser start times preceded the POST by only
30.21 ms at the median (range −34.38 to 96.33 ms). No explicit OPTIONS exchange
finished before its POST started. These records do not separately expose
Chromium's automatic CORS preflight. Runtime construction gives little head
start in this direct-registration workload. Moving warm-up to validated iframe
configuration, before lazy runtime loading, is the next candidate to evaluate.

Both arms made six Gateway POST requests per registration-plus-signature flow.
The cleanup change removes a local worker message, not a Gateway POST.

| Workload | Control p90 / maximum | Candidate p90 / maximum |
| --- | ---: | ---: |
| Registration, excluding passkey interaction | 4.124 / 6.327 s | 3.401 / 7.353 s |
| Registration plus first signature, excluding interaction | 5.271 / 7.288 s | 4.095 / 7.946 s |

The candidate maximum is `06-candidate-1/registration-3.json`. Its custody/Yao
stage took 5.809 s; setup took 373 ms and SDK completion took 56.65 ms. The
signature verified. No role-level trace was collected, so the source of the
custody delay is unproven. R155J should investigate it. Eighteen samples per
arm cannot establish p99 or an improvement in tail latency.

### Harness failure and retained evidence

Two additional candidate attempts have no usable timing artifacts. The first
finished registration and signature verification, then timed out in the new
OPTIONS recorder's `response.finished()` wait. The second attempt was stopped
because the running test process retained that recorder. The recorder now reads
available timing without awaiting completion. The affected group was replaced;
its logs remain in `02-candidate-1`. These are excluded harness attempts, not
successful latency samples or proven product failures.

Private run folder: `.artifacts/setup-sdk-staging-20261013/`. It contains the
frozen sources, site hashes, production build logs, `arms.json`, raw registration
artifacts, `analyze.py`, `summary.json`, `proof-verification.json`, and before/after
serving versions. `run.py` and `resume.py` record the exact commands and recovery.
No staging restoration was required because no deployment changed.

## Combined implementation follow-up — October 13

The next batch moves setup OPTIONS from the runtime constructor to validated
iframe configuration. It therefore starts before the lazy runtime loads. The old
constructor call is deleted. Appearance updates and equivalent configuration do
not start another warm-up. Signing-only and same-origin configurations retain the
existing exclusions.

Console publishable-key authentication now hands its usage write to the current
request's `waitUntil`. Key, environment and origin validation still precede success.
Usage timestamps use monotonic updates. Delayed telemetry cannot undo revocation
or overwrite a newer timestamp. No schema change is needed.

The Gateway setup batch already exists: the snapshot, ceremony and home reservation
are persisted together after Console authorization. The checklist is reconciled;
there is no additional claimed saving from that existing implementation.

Checks passed:
- SDK type check and private server type checks.
- Browser configuration scenario: warm-up starts before runtime work; appearance
  and invalid updates do not repeat it; replacement still fences active work.
- Console composition scenario with real Miniflare D1: authentication returns while
  telemetry is held; reordered writes preserve timestamps; concurrent revocation,
  wrong origin and wrong environment remain enforced; telemetry failure is observable.
- Public bloat check and focused private lint.

The previous staging numbers remain the baseline. This batch has no new hosted
latency result. Measure the complete SDK and Console candidate together next.
