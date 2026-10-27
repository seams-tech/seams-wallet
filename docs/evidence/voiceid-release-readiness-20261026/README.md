# VoiceID release readiness — 2026-10-26

Target: SDK 0.24.0, after publishing SDK 0.23.0. This work remains on the
VoiceID feature branch. Speaker verification remains at 0.5.

## First passkey from a VoiceID session

The composed browser journey passed:

1. Register an Email OTP wallet with NEAR and EVM capabilities.
2. Enroll VoiceID and unlock with VoiceID.
3. Add the first passkey with one fresh Email OTP proof.
4. Recover a lost finalize response without duplicating the method.
5. Keep the selected VoiceID session unchanged. Issue no extra unlock request.
6. Reject a repeated addition.
7. Lock and reload. Unlock with the new passkey, then sign through NEAR and Tempo.

See [first-passkey evidence](first-passkey.json).
The [Email OTP control](email-lazy-loading.json) still signs without voice downloads
or microphone capture. The [NEAR journey](near-unlock.json) rejects short and quiet
recordings before device verification, then unlocks and signs a reviewed transfer.

These tests use virtual passkeys, deterministic audio, and deterministic chain RPC
responses. They exercise real local inference and signing protocols. They do not
establish human-speech accuracy or live chain settlement.

## Diagnosis and correction

| Fact | Instrument | Checked |
| --- | --- | --- |
| The first-passkey journey failed with “this authority needs an active passkey to confirm the addition.” | Before-change browser run, `/private/tmp/voiceid-first-passkey-before.log` | The refreshed test token allowed registration, enrollment, and VoiceID unlock before this failure. |
| VoiceID already establishes the session-scoped seed capability. | `core/authMethods/installSession.ts` | The existing call supplies the exact VoiceID method, session, envelope, and expiry. |
| Email OTP already proves the passkey addition's intent digest. | `operations/authMethods/passkey/addPasskey.ts` and server admission | The proof remains fresh and bound to the claimed method and authority. |
| The revised journey completes with one Email OTP challenge and zero extra unlocks. | `first-passkey.json` | It also unlocks and signs with the resulting passkey after reload. |

| Candidate cause | Evidence | Conclusion |
| --- | --- | --- |
| VoiceID lacks the custody handle | Existing installer creates it; the revised test reseals through it | Rejected. The earlier release note overstated this limitation. |
| Source selection excludes Email OTP beside VoiceID | The old resolver requires a passkey; the before-change test fails at that check | Confirmed. Select an active same-authority Email OTP method when no passkey exists. |
| A second unlock or new worker operation is required | Revised journey reports zero extra unlocks and uses the existing reseal operation | Rejected. Worker boundaries remain unchanged. |

An independent reviewer found no concrete correctness or authorization defect.
The worker checks the capability's wallet, method, session, expiry, and live handle.
Lock destroys the handle. Server admission still checks the fresh Email OTP proof,
exact authority, revocation state, and single-use addition intent.

## Release cleanup

The Recording details expander, associated styles, error-detail strings, and UI
plumbing are removed. Prompts retain short failure guidance, fresh retry phrases,
and cancellation. Structured local measurements remain available to behavior tests.
Speaker and phrase acceptance rules are unchanged.

The [demo-page journey](demo-page.json) passed. It rejects wrong phrases and
speakers, cancels capture without signing, retries successfully, and preserves the
signing budget rules. Screenshots verify [phrase failure](phrase-retry.png) and
[speaker failure](speaker-retry.png) without a diagnostics expander.

The demo-page test previously supplied a wallet ID while expecting new-wallet
setup. The current page correctly treats a supplied wallet ID as an existing wallet.
The test now starts without that parameter. Its old capture-local Cancel and
review-confirm retry selectors also predated the current Wallet toolbar and
Try again control. These were obsolete fixtures. The revised full journey passed.

Wallet and intended-test type checks, the SDK build, and the bloat check passed.

## Reproduce

Serve the built Wallet host, local gateway, and intended app from this checkout.
Use the configured Google test audience and a fresh test token for Email OTP.
Set the usual `SEAMS_INTENDED_*` app, Wallet-origin, gateway, environment, and key
variables for that local stack.

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/email-otp.voiceid-selection.contract.test.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  --workers=1 --output=/private/tmp/voiceid-release-acceptance
```

## Live acceptance confirmed

The user reported successful VoiceID approvals on Arc and NEAR on October 26,
2026. Independent RPC reads confirmed both self-transfers:

- [Arc transaction](https://explorer.testnet.arc.io/tx/0xbbd1960f0cfd6ed1dc05943fb14b1b6da0444deac6c7112731cb25316e7d3c0c):
  receipt status `0x1`, chain ID 5042002, value 1 native base unit, empty calldata.
  Sender and recipient are `0xb539520c3eb14f2b9239adaa94a3a356563ec921`.
  Raw evidence: [receipt](arc-live-receipt.json), [transaction](arc-live-transaction.json).
- [NEAR transaction](https://testnet.nearblocks.io/txns/3aaq2WMJUn7fp5nwLVD2QKypDQxzprGt756pmbX2PwrP):
  final execution status `FINAL`, successful execution and receipts, transfer of
  one yoctoNEAR to the same signing account.
  Raw evidence: [transaction and outcomes](near-live-transaction.json).

The user also confirmed another normal-paced Arc approval:
[transaction 0xba27…524a](https://explorer.testnet.arc.io/tx/0xba27b74748e9309d35d6a5cb967521d4a5dc06db286c453d78bcd4468d9b524a).
The RPC returned receipt status `0x1`, with the same wallet address as sender and
recipient. See the [second live receipt](arc-second-live-receipt.json).

Voice approval is user-reported. The RPC evidence independently verifies settlement.
These live transfers are separate from the deterministic browser-test transactions.

The user also reported that the shorter phrases feel harder to match. This remains
usability feedback for further measurement. The displayed phrase now reads
**“If you panic, panic early.”** The comma supplies a reading cue. The canonical
phrase, matching rules, and speaker threshold of 0.5 remain unchanged.
