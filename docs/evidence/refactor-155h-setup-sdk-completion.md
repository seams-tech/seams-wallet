# Setup preflight and SDK completion

Date: 2026-10-13. Local SDK implementation; no staging deployment in this change.

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
The completion change removes one worker exchange. Hosted savings are unmeasured.

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
