# Natural-paced VoiceID capture

The two-second audio precheck rejected fluent readings of the short prompt phrases.
The precheck now requires 600 ms of frames above RMS 0.006. Phrase matching and
speaker matching retain their existing thresholds and remain required for approval.

Recording stops after 1.5 seconds below that level, once input has remained audible
for 100 ms. An initial quiet period or brief click does not start the stop timer.
The maximum remains eight seconds. Continued noise or unavailable live analysis can
use that maximum. The waveform and pause detector observe the same microphone stream.

## Evidence

- `voiceid-pause-capture.json`: real Chromium MediaRecorder capture preserves initial
  silence and a 750 ms internal pause. It stops 1.58 seconds after the final tone.
  Cancellation releases every track. Tones test capture behavior only.
- `voiceid-unlock-near.json`: truncated and quiet audio remain locked. Natural speech
  unlocks after initial silence and signs a reviewed NEAR transfer. It uses real
  browser B1/Aurora inference, Wallet session services, and Ed25519 Yao signing.
- `voiceid-live-page.json`: the manual page covers activation, cancellation,
  mismatch recovery, unlock, and signing.
- `voiceid-browser-broadcast-failure.json`: natural-paced enrollment and signing
  retain the original signature during broadcast retries. A new review can cancel.
- `natural-fixtures.json`: hashes and generation inputs for the natural-paced audio.
- `synthetic-phrase-screen.json`: exploratory native ONNX screening of all 16 phrases
  spoken by Samantha and Daniel at 160 words per minute. The Samantha template uses
  the first three slower fixtures. Both voices match all displayed phrases.
  Samantha speaker similarity is 0.596–0.744. Daniel similarity is 0.081–0.284.
  The speaker threshold is 0.5. Audio receives the browser's 10 ms energy scan and
  200 ms crop margins before inference. The phrase score-gap cutoff remains 5.

All four capture and Wallet scenarios passed in Chromium. SDK, intended-flow,
Wallet-state, intended-app, and browser-test type checks passed. The bloat check
passed. A separate stale confirmation fixture now supplies its required empty
capture state; all 18 confirmation browser cases passed.

The browser contracts use deterministic NEAR RPC responses. They do not prove a new
on-chain transaction. Synthetic voices do not establish human false-accept or
false-reject rates, especially for shorter recordings. No user audio was collected.

## Repeat

Build the SDK with the approved local relayer origins. Start the local Wallet stack
and set `SEAMS_INTENDED_APP_URL`, `SEAMS_INTENDED_WALLET_ORIGIN`,
`SEAMS_INTENDED_ROUTER_URL`, `SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID`, and
`SEAMS_INTENDED_PUBLISHABLE_KEY` for that stack.

```sh
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/voiceid-capture.browser.test.ts --project=chromium

pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  e2e/intended-behaviours/passkey.voiceid-near.contract.test.ts
```

Each contract writes a JSON artifact. Fixture generation commands are in
`tests/scripts/voiceid-aurora/README.md`. The 350 ms truncated fixture replaces the
older 800 ms fixture because 800 ms intentionally exceeds the new precheck.


## Live user test

The user reported successful voice unlock and transfer after instructions to speak
at a normal pace. Existing enrollment was reused. NEAR RPC independently confirmed
[Akj7JCNH6yYkCeiEemuzLfg8KHpScWVvwze16Xxn149r](https://testnet.nearblocks.io/txns/Akj7JCNH6yYkCeiEemuzLfg8KHpScWVvwze16Xxn149r)
as FINAL with SuccessValue: one yoctoNEAR transferred to the same wallet account.
`live-transfer.json` records the result. Live capture timing and inference scores
were not collected. This confirms one user journey, with no population accuracy claim.
