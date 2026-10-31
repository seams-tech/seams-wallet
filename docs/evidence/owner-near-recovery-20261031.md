# NEAR owner-operation recovery

Date: 2026-10-31

The owner-operation SDK could leave applications waiting after an approval ended.
The result contract combined confirmed non-submission with unavailable recovery.
The iframe parser also discarded the submission event.
Applications could therefore miss a known transaction hash.

## Resolution

- `not_submitted` proves that this attempt did not broadcast.
- `recovery_unavailable` keeps recovery retryable when submission status is unavailable.
- `unresolved` retains the transaction hash and the operation identity to recover.
- A blocked approval returns the existing operation's identity. Applications must save that returned identity.
- Missing browser storage does not prove non-submission.
- Iframe initialization failures before dispatch return `not_submitted`.
- Owner broadcasts request `FINAL`. Broadcast and status requests have a 30-second deadline.
- A timeout retains the hash and pending operation. Recovery never rebroadcasts.
- Receipt write failures preserve observed completion, cancellation, and non-submission.
- Confirmed network reverts return `reverted` without another status request.
- The example retains known hashes across reload and prevents replacement of unresolved operations.

The iframe protocol must advance with this release because result variants and
submission-event fields changed. Update the application SDK and hosted assets together.

## Verification

The Chromium application-owner E2E passed with real MPC signatures and controlled RPC responses.
It verified unavailable iframe startup, interrupted approval, receipt write failures,
two stalled RPC requests, mismatched recovery identities, reload, confirmed reverts,
and recovery without another broadcast.
The standard NEAR submission E2E also passed.

Commands use the existing isolated local runtime. Use separate unused ports when another runtime is active.

```sh
pnpm -C tests exec node scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.near-submission.contract.test.ts
pnpm -C packages/wallet type-check
pnpm -C tests type-check:intended
pnpm -C tests type-check:wallet-state
pnpm -C examples/seams-auth-menu type-check
pnpm -C apps/docs type-check
pnpm report:bloat --check
```

The E2E writes `tests/.artifacts/application-auth/receipt.json` and Playwright artifacts.
The receipt records signed transaction hashes, independently verified signatures,
recovery identities, typed outcomes, and the checks performed.
SDK builds, documentation types, type fixtures, and bloat checks passed.

Implementation commits: `1790df609`, `b6fa19d13`.
The customer-reported deposit's on-chain outcome remains unverified.
The report contained different original and recovery operation IDs.
The browser reproduction validates the SDK behavior; it does not establish the customer's transaction history.
