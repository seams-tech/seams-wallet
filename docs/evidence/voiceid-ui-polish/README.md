# VoiceID UI polish verification

Verified on 2026-10-25 with the existing browser E2E journeys.

- Settings, one-wallet method selection, cancel/retry, enrollment, and signing passed.
- Delayed preparation preserves the prompt card height between loading and ready.
- Cancellation remains immediate. Voice unlock and reviewed signing passed.
- The waveform uses transform interpolation and settles after recording. Reduced motion uses a restrained level display without scrolling history.
- Settings keeps the re-enrollment action mounted during updates.

The initial layout assertion caught a 12 px margin shift. The progress container now contains paragraph margins. The repeated test passed.

Artifacts use synthetic microphone input, real local model inference and signing, and deterministic NEAR RPC. They do not claim a new on-chain transaction or human assessment of animation smoothness.

Repeat with the local intended-behavior services and `playwright.wallet-intended.config.ts`, running `passkey.voiceid-ui.contract.test.ts` and `voiceid.unlock-near.contract.test.ts`. Connection settings are documented in ../voiceid-ui-integration/README.md.

SDK and intended-test type checks passed. The SDK build and bloat check passed.
