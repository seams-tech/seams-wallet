# Add an EVM account from wallet settings

The composed browser test passed on 2026-10-26. It starts with a NEAR-only wallet
unlocked with VoiceID, then uses Accounts → Add EVM account. A browser virtual
passkey authenticator approves the existing add-signer operation. The new account
supports both configured networks, Tempo and Arc.

The operation changes the wallet's signer authority. If the prior session no longer
matches, the action unlocks the updated wallet with a passkey before refreshing the
account list. The menu retains setup state during this transition and across screen navigation.

The test verifies that all three account rows appear, the add action disappears,
and a later VoiceID unlock signs both Arc and NEAR transfers. Voice enrollment and
the 0.5 speaker threshold remain unchanged. The test uses real browser inference
and MPC signing with deterministic chain RPC responses, not live-chain settlement.

- `accounts-before-evm.png`: the new menu action, using existing wallet styles.
- `accounts-with-evm.png`: refreshed NEAR, Tempo, and Arc rows.
- `voiceid-arc-transfer.json`: unchanged Playwright output with signed transaction
  bytes, sender recovery, and the verified NEAR transfer.

Repeat with the local services running:

```sh
SEAMS_INTENDED_APP_URL=http://localhost:4320 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4313 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4600 \
SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID=local-smoke-project:dev \
SEAMS_INTENDED_PUBLISHABLE_KEY=pk_local \
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.unlock-arc.contract.test.ts --grep add_ecdsa_after_voice
```

## Diagnosis record

| Fact | Instrument | Result |
| --- | --- | --- |
| The first action returned to the overview without showing the new address. | Browser screenshot and Accounts assertion | The Accounts screen unmounted during session invalidation. |
| Add-signer completed successfully before session refresh. | Temporary operation-result diagnostics | Creation succeeded; the old session did not bind the expanded signer authority. |
| Keeping the screen mounted and unlocking the updated wallet completes the flow. | Composed browser test | Address rows update and both signing journeys pass. |

| Candidate cause | Evidence | Disposition |
| --- | --- | --- |
| Signer creation failed | Add-signer returned success. | Eliminated. |
| The old session remained usable after addition | Session refresh returned signed out. | Eliminated. |
| The menu lost its action while session authority changed | The permission effect reset navigation during setup. | Fixed by retaining the action's wallet and completing session restoration. |

Independent review found a remount race and a stale session-read race. The menu
now owns pending setup. Session reads check both request generation and selected
wallet before updating React state. Read-only review found no remaining defect.

A delayed-intent navigation probe was classified as `valid_test_needs_update`.
The real authentication overlay blocked Back until the request timed out. That
probe was removed; it did not establish an available user navigation path. The
parent-owned state and stale-read guard remain reviewed safeguards.
