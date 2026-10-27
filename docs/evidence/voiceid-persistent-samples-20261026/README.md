# Persistent VoiceID samples

The ES256 passkey management browser contract passed on 2026-10-26.
Saved supplements have no time or use limit. The speaker threshold remains 0.5.
The baseline weight, supplement weight, and admission bounds remain unchanged.

The journey adds three samples with fresh passkey approval, unlocks with VoiceID,
and signs a NEAR transaction. It verifies unchanged sample hashes and revision
after use. It restores valid sample records with retired last-use and expired
metadata, verifies that matching preserves their samples, and reloads the page.
Explicit reset, re-recording, cancellation, and method removal are also exercised.

The JSON and screenshot are unmodified test outputs. Audio and passkeys are
synthetic; inference and signing use production paths. Chain RPC responses are
deterministic. This test does not establish an improvement in human recognition.
Samples already deleted by the old expiry behavior cannot be recovered.

## Repeat

With the local services and built SDK running:

```sh
SEAMS_INTENDED_APP_URL=http://localhost:4320 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4313 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4600 \
SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID=local-smoke-project:dev \
SEAMS_INTENDED_PUBLISHABLE_KEY=pk_local \
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/passkey.voiceid-ui.contract.test.ts \
  --grep 'es256 passkey manages'
```

The test suppresses development hot-reload WebSocket updates in its own context.
This prevents unrelated edits from resetting the test wallet during capture.
The live user browser is unaffected.

## Enrollment retry clarity

The extended ES256 journey passed with a deliberately wrong third phrase after
accepting two samples. The dialog reports two accepted samples and offers Retry
sample 3. The stored enrollment remains unchanged until a valid retry completes
exactly three accepted samples. It then closes and subsequent unlock/signing,
persistence, reset, and replacement checks pass.

`third-sample-retry.json` and `third-sample-retry.png` are unmodified outputs from
that run. The rejection uses a wrong phrase; it does not measure human speaker
matching accuracy. The same command above repeats this case.
