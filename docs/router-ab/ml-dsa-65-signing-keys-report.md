# ML-DSA Signing keys and optional loading

Date: 2026-10-24. Branch: `ml-dsa`. Protocol baseline: `69651323`.

## Result

The SDK now exposes a Signing keys screen and transaction key selection.
The new screen and ML-DSA execution code load on demand.
The complete browser lifecycle passes. This change makes no hosted latency or production-readiness claim.

## User flow

1. Open **Signing keys** from the account menu or settings page.
2. Select **Add ML-DSA signer**. Existing custody approval creates the recoverable signer.
3. Select **Approve NEAR key addition**. An explicitly selected Ed25519 key authorizes the full-access AddKey transaction.
4. Wait for finalized NEAR activation, then select **Make default** if desired.
5. For an ordinary transaction with several active keys, select the signing key and continue to the existing approval.

The selector displays transaction details before any nonce reservation or signing approval.
The approval screen fixes and names the selected key. A transaction-specific choice leaves the saved default unchanged.
An explicit SDK key stays fixed. An unavailable ML-DSA default fails with an actionable error.
Ed25519 remains the initial default. Existing on-chain keys retain their permissions.
This release targets existing wallets with full-owner passkeys. It does not add ML-DSA-only registration or per-key device permissions.

## Loading and metadata

- Registration imports the ML-DSA ceremony only within its ML-DSA branch.
- Metadata and generic cancellation helpers no longer import the optional verifier at startup.
- The account menu loads Signing keys through React lazy loading.
- The codec loads for configured-key enrollment checks and selected ML-DSA operations.
- Export stays inside the existing Wallet-origin export worker.

`near.getMlDsaSigners` reads public references through the current exact full-owner session.
The bearer credential remains inside Wallet origin. The Gateway rechecks current authority after reading inventory.
This operation consumes no signing quota and creates no signing authorization.
Fresh-proof inventory remains the authorization boundary for recovery/export operations that need it.

`near.getDefaultSigner` and `near.setDefaultSigner` use the existing Wallet-origin preference store.
The preference is scoped by wallet, network, and account. It records a stable signing key ID.
Signing resolves the current key publication and material epoch before approval.
The preference grants no authority and is local to the device.

An ordinary default-based transaction performs a metadata read. Configured ML-DSA keys also require finalized NEAR availability checks.
Those requests have network cost. This change does not claim zero overhead for discovery or a smaller installed npm package.

## Validation

- SDK build, SDK/server type checks, intended-browser type checks, and wallet-state type fixtures pass.
- Static ESM traversal finds no ML-DSA codec or registration implementation in ordinary auth, NEAR runtime, or NEAR iframe-host imports.
- The ML-DSA transaction chunk is the positive control: its static graph includes the optional codec.
- Browser lifecycle: attempts 7 and 8 both pass in 6.9 minutes, including unchanged cooldown waits. Attempt 8 retains the full JSON artifact. All five retained signatures verify independently again.
- The bloat check retains an inherited Rust duplication failure: 13,972 lines against a 13,754-line baseline. This change edits no Rust.

The lifecycle test uses Chromium, local Cloudflare workerd participants, real passkey/recovery ceremonies, and live NEAR testnet.
It exercises the actual settings controls, reload, default selection, signing, full-owner QR linking, revocation, FIPS export, and participant restoration.
It verifies signatures independently and broadcasts a restored-key transaction to finalized testnet state.
It also blocks fresh passkey prompts during metadata reads and counts optional asset requests before enrollment.

Retained artifacts:

- [Browser lifecycle and independently verifiable signatures](../evidence/ml-dsa-65-signing-keys-browser-20261024.json)
- [Static import graph screen](../evidence/ml-dsa-65-signing-keys-loading-20261024.json)
- [Signing keys screenshot](../evidence/ml-dsa-65-signing-keys-20261024.png)
- [Transaction picker screenshot](../evidence/ml-dsa-65-transaction-picker-20261024.png)

The browser observes zero optional ML-DSA asset requests during ordinary registration, an empty settings view, and Ed25519 signing.
It verifies preference persistence after reload, unavailable-default refusal, and revoked-owner metadata refusal.
The final restored-key transaction reaches NEAR testnet finality with `SuccessValue`.

## Repeat the browser contract

Build `packages/wallet-server` and the existing strict local role binaries first.
Use a fresh runtime directory for each run. Do not copy an initialized D1 database between runs.
The test fixture supplies disposable credentials and synthetic testnet funding.

```sh
export SEAMS_WALLET_APPROVED_RELAYER_ORIGINS=http://127.0.0.1:19100
export SEAMS_INTENDED_SKIP_BUILD=1
export SEAMS_INTENDED_ML_DSA=1
export SEAMS_LOCAL_PORT_OFFSET=15000
export SEAMS_INTENDED_APP_URL=http://localhost:19201
export SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:19202
export SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:19100
export SEAMS_INTENDED_ROUTER_AB_ROOT=/private/tmp/ml-dsa-signing-keys-repeat/runtime
export SEAMS_INTENDED_TEST_APP_VITE_CACHE_DIR=/private/tmp/ml-dsa-signing-keys-repeat/vite-app
export SEAMS_INTENDED_TRACE_DIR=/private/tmp/ml-dsa-signing-keys-repeat/evidence
pnpm -C packages/wallet build:sdk
pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts e2e/intended-behaviours/ml-dsa.lifecycle.contract.test.ts --reporter=line
```

The test writes public evidence and screenshots under `tests/test-results`.
Screenshots occur before the recovery and export flows, so they contain no recovery codes or exported seeds.

## Failure record

Failed attempts remain under `/private/tmp/ml-dsa-settings-browser-20261024`.
No retry changes protocol parameters or pool capacity.

| Attempt | Observation | Classification and correction |
| --- | --- | --- |
| 1 | Existing Caddy occupied port 4302. | Infrastructure failure. Use isolated ports; preserve the existing service. |
| 2 | SDK omitted the isolated relayer origin. | Infrastructure failure. Build with the exact test-origin allowlist. |
| 3 | Add signer passed no RP ID in iframe mode. | Introduced production regression. Reuse the existing wallet-origin RP resolver. |
| 4 | The NEAR receipt intercepted the Make default click. | Valid test needed correction. Use the existing receipt-settlement helper. |
| 5 | The exact label locator included select-option text. | Valid test needed correction. Use the observed accessible combobox name. |
| 6 | The new ordinary-signing test command left its receipt open. | Valid test needed correction. Include default-based signing in the existing receipt-settlement and deadline branches. |

### Instrument checks

| Fact | Instrument | Scope |
| --- | --- | --- |
| Registration was published before the long wait. | Read-only D1 phase count | Attempt 4 local Gateway |
| Receipt intercepted Make default. | Playwright action log and page snapshot | Attempt 4 failing click |
| Picker existed with ML-DSA selected. | Playwright accessibility snapshot | Attempt 5 |
| Exact label matching includes option text. | Installed Playwright label matcher and current component source | Attempt 5 test instrument |

| Candidate cause | Receipt evidence | Picker evidence | Conclusion |
| --- | --- | --- | --- |
| Protocol signing stall | No signing request had started; click was intercepted. | Picker awaited user selection. | Does not explain these failures. |
| Missing UI picker | No bearing. | Snapshot shows the picker. | Rejected. |
| Test action/locator errors | Exact blocked click identified. | Exact label text differs from accessible name. | Corrected with existing UI semantics. |
| Pool-capacity warning | No proven connection to the blocked click. | No proven connection. | Separate warning; no causal claim. |

Attempt 7 passes the complete contract. Its in-memory JSON attachment was not retained by the line reporter.
The test now writes that attachment to its output directory before attaching it. Attempt 8 passes with the same SDK build and retains the full evidence.

## Preserved requirements

Wallet-seed recovery and ordinary FIPS seed/key export stay unchanged.
Preparation groups contain four candidates. Signing consumes two candidates at a time.
The reserve holds thirty-two candidates, and admission requires sixteen ready candidates.
The default cooldown remains sixty seconds. GPU work remains deferred.

## Remaining release work

Qualify this UI in the composed application and supported browsers, then run hosted cold/warm and sustained-load campaigns.
Complete the existing security review before production release.
The separate selection and approval steps can later be combined if the approval lifecycle preserves exact key binding.
