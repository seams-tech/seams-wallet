# VoiceID UI integration evidence

Recorded on 2026-10-25 on `codex/voiceid-browser`.

## Verified behavior

- Authentication methods settings enrolls three voice samples and enables VoiceID.
- The switch controls availability for this wallet in this browser. Turning it off preserves enrollment and locks an active VoiceID session.
- Passkey or Email OTP authentication is required to turn VoiceID back on. The browser test exercises passkey authentication.
- Disabled VoiceID cannot unlock through the SDK. It is absent from the login menu.
- SeamsAuthMenu lists each wallet once, with available methods below the wallet selector.
- Canceling voice capture restores the login menu. A later attempt can unlock successfully.
- Transaction review shows Confirm with VoiceID. Confirmation opens the minimal phrase and live waveform prompt.
- Recording voice again preserves the enrolled authentication method identity.
- VoiceID code remains lazy. Passkey-selected operations do not load the voice runtime.
- Wallet protocol version 17 carries the availability commands and authenticated VoiceID menu outcome.

## Artifacts and scope

`voiceid-ui-flows.json` records the complete settings, login, and signing journey. The three PNG files show the actual UI from that run.

`voiceid-unlock-near.json` records fresh session issuance, signature verification, cancellation, speech-quality retries, and loading measurements. The prompt appeared within 110 ms with a five-second challenge delay. A concurrent lock rejected a stale unlock.

`auth-method-plugin.json`, `voiceid-session-selection.json`, and `voiceid-live-page.json` cover lazy loading, method selection, and the developer test page.

These tests use synthetic speech through the browser microphone pipeline, real speaker inference, and real local signing services. NEAR RPC is deterministic. These artifacts do not claim a new on-chain transaction or a human microphone test.

## Repeat the checks

Start the intended-behavior local services, then build the Wallet SDK:

```sh
SEAMS_WALLET_APPROVED_RELAYER_ORIGINS='http://127.0.0.1:4510 http://127.0.0.1:4600' pnpm -C packages/wallet build:sdk
```

Run the main browser journeys:

```sh
SEAMS_INTENDED_APP_URL=http://localhost:4320 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4313 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4600 \
SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID=local-smoke-project:dev \
SEAMS_INTENDED_PUBLISHABLE_KEY=pk_local \
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/passkey.voiceid-ui.contract.test.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts
```

Both journeys passed after the final availability checks. The plugin, per-wallet selection, and live-page contracts also passed. Thirty auth-menu surface and lifecycle checks passed:

```sh
SEAMS_TEST_FRONTEND_URL=http://localhost:4340 \
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/auth-menu.surface.test.ts wallet-ui/auth-menu.lifecycle.test.ts \
  --project=chromium
```

SDK and test type checks passed. `pnpm report:bloat --check` passed with no ratcheted measure increase.
