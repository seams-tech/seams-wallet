# VoiceID noise handling — 2026-10-25

## Result

Silero VAD v5.1.2 replaces the fixed-volume speech detector. It controls pause detection and validates speech duration after recording. Minimum volume remains a separate quiet-input check. The 1.5-second pause target, eight-second capture cap, speaker similarity threshold 0.5, and phrase gap limit 8 remain unchanged.

The model adds 2,327,524 bytes. It uses the existing lazy ONNX runtime, digest validation, and browser cache. The AudioWorklet holds short audio frames only. It has no signing authority. Existing enrollment remains valid.

The browser reports available microphone processing settings, detected speech duration, background RMS, and approximate speech/background level. High-noise guidance appears in the minimal prompt. Raw user audio is not saved by these diagnostics.

## Evidence

- `noise-capture.json`: startup cancellation stops microphone tracks; noise alone yields zero qualified speech and keeps the wallet locked; natural-paced speech over continuous noise unlocks and signs a reviewed transfer.
- `noise-guidance.png`: actual high-noise retry UI.
- `voiceid-unlock-near.json`: capture quality, cancellation, fresh-session installation, and NEAR signing.
- `voiceid-live-page.json`: enrollment, phrase retry, wrong-speaker and wrong-phrase rejection, and transfer.
- `voiceid-session-selection.json`: passkey-selected operations preserve lazy VoiceID loading.
- `baseline.json`: repeatable native comparison of RMS detection, Silero, and an exploratory spectral denoiser.

The noise, selection, and live-page browser contracts passed together (2.8 minutes). The final startup-cancellation/noisy-signing contract passed separately (38.7 seconds). SDK and test type checks, static asset checks, build, and bloat checks passed.

The baseline marked all 3.8 seconds of steady noise as active with RMS, versus zero speech with Silero. Speech over that noise retained about 1.2 seconds of detected speech. A quieter speaker remained speech, demonstrating that VAD does not identify the owner.

The exploratory spectral denoiser barely changed speaker similarity (0.7605 to 0.7636) and changed the unconstrained transcript from “this is my own voice” to “this is my own voye”. This single synthetic example does not support shipping the filter. Browser noise suppression remains requested; no additional denoiser ships.

## Scope and reproduction

These are synthetic speech and deterministic noise fixtures with real browser models and local signing services. NEAR RPC is deterministic. This does not establish café accuracy, human false-accept rates, or a new on-chain transfer. Background conversation can still trigger VAD. Live microphone and café validation remains necessary.

See ../../../tests/scripts/voiceid-noise/README.md for model provisioning, fixture regeneration, and baseline evaluation. Use the local service environment in ../voiceid-ui-integration/README.md with the listed browser contracts.

Playwright 1.55 stalled AudioWorklet module loading. The isolated reproduction matched https://github.com/microsoft/playwright/issues/37592. The test dependency was updated to 1.56.1. The WAV interception pattern also needed an explicit path match after that update; the old glob served HTML instead of audio. Worklet network requests are not intercepted by context.route, so the startup-cancellation test holds the native addModule call in the test fixture before releasing it. Production uses the real worklet without that test hook.
