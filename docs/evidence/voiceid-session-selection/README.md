# VoiceID availability and wallet selection

`authMethods: [voiceIdAuthMethod()]` makes the plugin available. Signing policy now
uses the requested wallet's trusted authority selection. A passkey or Email OTP
selection bypasses the VoiceID loader. Enrollment preserves the owner method.
VoiceID unlock selects voice approval; a passkey unlock returns to passkey signing.

The material-preparation boundary checks the actual signing method against the
admitted review policy. A VoiceID lane requires a reviewed operation with voice
approval. A built-in method cannot reuse a voice review. The existing approval
consumption check still runs before MPC signing.

## Verified behavior

- `voiceid-session-selection.json`: four real MPC transfers in one browser journey.
  An enabled but unenrolled passkey wallet signs with no VoiceID entry, model, or
  inference-runtime requests. After enrollment, passkey signing still captures no
  audio. VoiceID unlock selects voice capture for the next transfer. A fresh-page
  passkey unlock then signs without downloading VoiceID, despite the saved enrollment.
- `auth-method-plugin.json`: enabling configuration starts no plugin downloads.
  First enabled use loads it. Disabled use is rejected, including after a cached load.
- `voiceid-unlock-near.json`, `voiceid-live-page.json`, and
  `voiceid-browser-broadcast-failure.json`: voice unlock, prompt loading/cancellation,
  capture retries, signing, and broadcast retry behavior remain valid.
- `delegate-early-prepare.json`: ordinary NEAR message and delegate signing still
  works, including step-up after quota exhaustion.
- `voiceid-wallet-gate.json` and `review-method-selection-guard.json`: browser review
  checks reject mismatched signing methods and signing without a current voice approval.

All 35 browser review cases passed. SDK, intended-flow, Wallet-state, and browser
type checks passed. SDK build and bloat checks passed. Synthetic audio uses real B1
and Aurora inference. MPC uses the local services; NEAR RPC responses are deterministic.
These artifacts do not claim another on-chain transaction or population voice accuracy.

## Environment limit

The Email OTP end-to-end test is included but did not reach registration. This test
environment has no usable Google ID token or service-account refresh configuration.
The credential helper confirmed that condition. No Email OTP end-to-end success is
claimed. The production selector treats both built-in methods through the same branch.

The first new-test run needed registration in the existing lifecycle harness.
The download observer also initially matched the worktree directory named `voiceid`
inside Vite file URLs. It now matches model assets under `/sdk/voiceid/` and discovers
the emitted plugin entry by its public export. Activation provides a positive
download control. An occupied browser-test port was resolved by using port 4339.

The broadcast-retry contract now explicitly unlocks with VoiceID after activation.
This follows the intentional behavior change: enrollment alone does not select voice.

## Repeat

Set the existing local-service `SEAMS_INTENDED_*` environment variables, then run:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/passkey.voiceid-selection.contract.test.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  e2e/intended-behaviours/passkey.voiceid-near.contract.test.ts

SEAMS_TEST_FRONTEND_URL=http://localhost:4339 pnpm -C tests exec playwright test \
  -c playwright.wallet-browser.config.ts --project=chromium \
  wallet-ui/voiceid-approval.browser.test.ts wallet-ui/transaction-review.browser.test.ts
```

Once the Google test credential is configured, run
`e2e/intended-behaviours/email-otp.voiceid-selection.contract.test.ts` with the intended
configuration. The test must sign successfully with zero VoiceID downloads and captures.
