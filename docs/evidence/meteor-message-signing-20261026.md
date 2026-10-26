# Meteor message signing — 2026-10-26

Meteor's external NEAR connector now exposes `signMessage(connection, params)`.
The final SDK build returned a valid NEP-413 signature from the real Meteor extension.
This change remains on `dev` and requires a new SDK release before application adoption.

## Measured results

| Fact | Instrument | Scope | Check |
| --- | --- | --- | --- |
| The real extension signed a fresh challenge | Chrome profile Pta and the built SDK acceptance page | `cyan-loong.testnet`, testnet, 2026-10-26T14:46:28.867Z challenge | [Raw result](meteor-message-signing-20261026.json) |
| The signature matches standard NEP-413 encoding | Node.js crypto with independent UTF-8 and Borsh encoding | Same message, nonce, recipient, and signature | [Verification](meteor-message-signing-20261026-verification.json) |
| Altered message, recipient, and nonce fail verification | Independent Node.js verifier | Same real signature | All three rejected |
| The key belongs to the account with full access | Testnet RPC `view_access_key`, final block 274865891 | Captured account and returned public key | `FullAccess` |
| Browser behavior passes | Playwright using the compiled SDK | Chromium, Firefox, and WebKit | 27 checks passed |
| Type and package boundaries pass | SDK declarations, domain type fixtures, compiled documentation examples | Local source | See validation commands below |

The controlled ownership scenario checks Unicode text, callback presence and absence,
nonce copying, duplicate requests, altered signed fields, account mismatch, malformed
keys and signatures, state mismatch, wallet refusal, transport replacement, and an
unsupported adapter. The cancellation scenario checks disconnect during approval
and a late reply while a newer connection has a pending signature request.
Both scenarios save JSON evidence after completion. Message signing submits no transaction.

## Diagnosis record

| Cause | ASCII signature | Unicode signature | Independent byte comparison | Result |
| --- | --- | --- | --- | --- |
| Meteor transport cannot sign messages | Contradicted by real extension success | No conclusion | No conclusion | Removed |
| Independent verifier uses the wrong payload | ASCII signatures pass | Unicode initially fails | Node UTF-8 encoding matches the standard | Removed |
| New verifier uses Borsh 1.0 string encoding | Fits | Fits | The dependency truncates UTF-16 code units | Confirmed and corrected |

The correction encodes strings as UTF-8 byte vectors before Borsh serialization.
A byte vector has the same wire layout as a Borsh string.
The existing Intear Firefox fixture also required a separate correction.
Firefox supplied an empty referrer, which caused the fixture's URL constructor to fail.
The fixture now receives its expected application origin explicitly.
Production Intear behavior remains unchanged.

## Repeat

Build the SDK and run the browser checks from the repository root:

```sh
pnpm -C packages/wallet build:types
pnpm -C packages/wallet build:rolldown
SEAMS_TEST_FRONTEND_URL=http://localhost:4287 pnpm -C tests exec playwright test \
  -c playwright.wallet-browser.config.ts \
  wallet-ui/external-near-message.browser.test.ts \
  wallet-ui/external-near.browser.test.ts
pnpm -C tests type-check:wallet-state
pnpm -C apps/docs type-check
pnpm check:packed-wallet
pnpm -C packages/wallet check:declarations-external
pnpm report:bloat --check
```

The browser artifacts are `meteor-message-ownership.json` and
`meteor-message-cancellation.json` under `tests/test-results/`, separately for each browser.
The ownership artifact includes the independent digest and signature.

For a real extension run, start the acceptance page:

```sh
pnpm -C tests exec vite browser-app --host 127.0.0.1 --port 4286 --strictPort
```

Open `http://localhost:4286/external-wallet-acceptance.html` in a profile with Meteor.
Connect a testnet account. Select **Sign ownership message** and approve the challenge.
Save the displayed JSON. The account needs no balance for this check.

This evidence verifies the SDK's message-signing API.
GetSignal's deployed ownership check and complete trading flow remain outside this run.
Its server must validate account-key ownership and reject expired or reused challenges.
