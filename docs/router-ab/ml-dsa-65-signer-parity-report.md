# Shared signer settings

Date: 2026-10-24. Branch: `ml-dsa`. Starting commit: `b040267b`.

## Changes

Signing keys now displays the current Ed25519, ECDSA, and ML-DSA signers together.
ECDSA rows identify their configured network, account, public key, and current capability readiness.
NEAR groups Ed25519 and ML-DSA under their account. The screen also works for ECDSA-only wallets.

Each supported key uses Key details and Export key actions. Native export-format details stay inside the key details.
Exports keep the existing Wallet-origin authorization and secret viewer. Host export callbacks remain connected.
The separate Export keys menu, components, and unused styles are removed. The local preview uses the same navigation labels.

Missing Ed25519 and ECDSA families use the existing add-signer APIs and configured targets.
Adding Ed25519 creates a NEAR account. ML-DSA addition still requires an existing NEAR account and explicit key activation.
Pending NEAR provisioning is displayed separately and suppresses duplicate Add signer actions.
Shared availability labels distinguish preparation, approval, setup, and failure.

## Boundaries

This change uses the authenticated Wallet Session capability projection for ordinary keys.
ML-DSA continues to use its existing current-owner metadata endpoint. Its read failure does not remove ECDSA rows.
Key metadata grants no signing or export authority. Each operation retains the existing protocol-specific checks.
No Rust, cryptographic domain string, circuit identifier, storage format, or preprocessing policy changes belong to this commit.
The parallel Rust naming work owns the shared crates, generators, benchmarks, and vendor paths.

Wallet-seed recovery, ordinary FIPS export, two-at-once consumption, and thirty-two-candidate capacity remain unchanged.

## Validation

- SDK type check, intended-test type check, and SDK build pass.
- Full ML-DSA browser lifecycle passes with the shared screen. It includes recovered and linked owners, FIPS seed import, participant restoration, and a finalized NEAR testnet transaction.
- The ECDSA-only browser contract passes: add NEAR through settings, retain the ECDSA rows, and independently verify a subsequent ECDSA signature.
- Delayed NEAR setup contract passes: setup remains visible, duplicate creation is absent, ECDSA stays visible, and the ready key appears after reopening settings.
- Bloat check retains the inherited Rust duplication excess: 13,972 lines against a 13,754-line baseline. This UI change edits no Rust.

The tests use Chromium, the public SDK, and isolated local Cloudflare workerd roles.
The ML-DSA lifecycle also uses live NEAR testnet. These runs do not establish hosted latency or full browser/device coverage.

Run the two contract files with the isolated-origin environment documented in the [earlier report](ml-dsa-65-signing-keys-report.md#repeat-the-browser-contract):

```sh
pnpm -C packages/wallet build:sdk
pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts e2e/intended-behaviours/signing-keys.contract.test.ts e2e/intended-behaviours/ml-dsa.lifecycle.contract.test.ts --reporter=line
```

Use a fresh runtime directory. Public JSON evidence and screenshots are written under `tests/test-results`.

Retained evidence:

- [ML-DSA lifecycle and independently verifiable signatures](../evidence/signer-parity-ml-dsa-20261024.json)
- [ECDSA-only wallet adds NEAR and retains ECDSA signing](../evidence/signer-parity-add-near-20261024.json)
- [Delayed setup transition](../evidence/signer-parity-pending-near-20261024.json)
- [Shared settings screenshot](../evidence/signer-parity-settings-20261024.png)
- [Pending setup screenshot](../evidence/signer-parity-pending-near-20261024.png)

The ML-DSA lifecycle passed in attempt 2. The pending-state display was added afterward; it is qualified by the two targeted settings contracts in attempts 4 and 5.

## Failure record

Raw attempts remain in `/private/tmp/ml-dsa-signer-parity-20261024`.

| Attempt | Result | Classification |
| --- | --- | --- |
| 1 | Build referred to the removed export stylesheet. | Introduced build regression. Removed the stale aggregate import and unused selectors. |
| 2 | ML-DSA lifecycle passed. New settings test did not start because its filename was unregistered. | Valid test needed harness registration. |
| 3 | ECDSA-only addition and subsequent ECDSA signing passed. | No failure. |
| 4 | ECDSA-only test passed again. Delayed-setup test waited for a control after an outside action closed the menu. | Valid test needed correction: reopen settings after the harness action. The failure snapshot confirms NEAR readiness and a closed menu. |
| 5 | Corrected delayed-setup test passed. | No production change for this test navigation correction. |

## Next work

1. Combine key selection with the shared transaction review while preserving exact key/transaction binding and cancellation. The current selection-plus-approval sequence remains in use.
2. Complete the remaining authentication and device-permission parity work. ML-DSA currently requires a full-owner passkey for its public lifecycle; export/restoration retain their custody-owner rules.
3. Qualify the composed application and additional browsers, then resume hosted latency and sustained-capacity qualification.

### Delayed-setup diagnostic record

| Fact | Instrument | Scope |
| --- | --- | --- |
| Pending setup and both ECDSA targets were visible; no Add signer control appeared. | Browser assertions and `pending-near.png` | Attempt 4 |
| Await NEAR Ready completed successfully. | Failure page snapshot, action result | Attempt 4 |
| The account menu was closed. | Failure page snapshot showing its Settings trigger | Attempt 4 |
| Outside clicks close the menu. | Existing `useProfileState` capture handler; independent reviewer source check | Current implementation |

| Cause | Pending-screen evidence | Successful readiness and closed-menu evidence | Result |
| --- | --- | --- | --- |
| NEAR protocol stalled | No conclusion. | Contradicted by the ready result. | Rejected. |
| Pending state was never rendered | Contradicted by assertions and screenshot. | No conclusion. | Rejected. |
| Test used a removed pending-screen control | Fits. | Fits the outside click and closed menu. | Corrected test navigation. |
