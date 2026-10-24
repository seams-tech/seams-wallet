# Minimal VoiceID UI integration — 2026-10-24

The real browser plugin now shares one minimal prompt across enrollment, unlock,
and NEAR transfer approval. The card shows the phrase, a live waveform, status,
and Cancel. Enrollment identifies its sample and shows Record between captures.
During signing, Confirm replaces the review contents with the prompt. A mismatch
returns to the original review. The review binding and expiry remain unchanged.

The meter observes the existing recording stream through Web Audio. It creates no
second microphone request and does not change audio supplied to B1 or Aurora.
The display uses the preview's continuous amplitude curve. Recording still owns
track cleanup. The meter closes its AudioContext when capture ends or is cancelled.
The UI is part of the lazy plugin and introduces no React runtime into the Wallet.

## Evidence

Three composed Wallet contracts passed across focused runs:

- [Full journey](voiceid-live-page.json): browser enrollment and owner re-enrollment,
  model cache reuse, fresh voice unlock, a cancelled signing capture, wrong speaker,
  wrong phrase, retry, and successful NEAR signing. It asserts that the review is
  absent during voice capture, the waveform moves, and only one new microphone
  stream is requested for that capture. Cancellation leaves no live track and
  produces no signing finalization or broadcast.
- [Fresh-session unlock](voiceid-unlock-near.json): delayed preparation, cancellation,
  a concurrent lock, fresh server Wallet Session issuance, and a reviewed transfer.
- [Broadcast failure](voiceid-browser-broadcast-failure.json): retries reuse signed
  bytes, while a new review requires fresh approval.

These contracts use synthetic audio through real MediaRecorder, B1 and Aurora WASM,
and real local Ed25519 Yao signing services. NEAR RPC replies are deterministic.
This is automated integration evidence, not a new human voice or live-chain test.

Seven additional Chromium confirmation tests passed. They cover the public review
mount, supported chains and presentation modes, cancellation, handoff cleanup,
late ABI enrichment, and the VoiceID signing gate. SDK, intended-flow, and state
fixture type checks passed. The SDK build and bloat check passed.

Two test expectations needed updates for the new journey. The enrollment-cancel
helper now uses the icon's accessible label. The added cancelled warm review also
claims one signing use under the existing documented prepare policy. The final
balance is one after that review and the successful transfer; mismatched voice
retries reuse the second review and do not create another prepare.

## Screenshots

- [Enrollment](minimal-voice-enrollment.png)
- [Unlock](minimal-voice-unlock.png)
- [Transaction approval](minimal-voice-approval.png)

## Repeat

With the local Wallet services running, set the `SEAMS_INTENDED_*` environment
variables documented in `tests/README.md`, then run:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts \
  e2e/intended-behaviours/passkey.voiceid-near.contract.test.ts
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  --project=chromium wallet-ui/confirm-ui.browser.test.ts wallet-ui/voiceid-approval.browser.test.ts
```

The full journey writes screenshots and JSON evidence to its Playwright output folder.
