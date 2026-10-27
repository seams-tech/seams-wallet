# VoiceID glow and flowing ribbon — 2026-10-25

Enrollment, unlock, and signing share the production VoicePrompt. Its old scrolling bars are replaced by a four-layer SVG ribbon (1 px main stroke, 0.65 px supporting strokes) and the actual voice-glow 0.2.1 VoiceBeam exported by the SDK. Recorder activity events drive both. The visual requests no microphone or audio graph. Recognition thresholds and signing decisions are unchanged.

The Wallet iframe uses Preact. Its build resolves VoiceBeam's React imports through Preact compat. The public React SDK export is unchanged. The build's module-ownership check continues to reject actual React modules. The source-text check now requires React-specific internal markers rather than element symbols and createElement names shared with Preact compat.

## Passed checks

- SDK build, SDK and intended-test type checks, and bloat check.
- Optional-plugin browser loading contract.
- Browser visual contract using the actual production prompt and synthetic recorder activity: responsive ribbon, actual VoiceBeam, processing, retry, reduced motion, light theme, and cancellation/disposal.
- Strict stylesheet CSP with a nonce, with no recorded security-policy violations.

The screenshots come from the visual contract. It makes no claim about biometric accuracy or transaction success.

## Full-journey limitation

The per-user selection, live-page, and unlock/signing journeys could not complete. The local gateway at port 4600 failed test-wallet registration before VoiceID opened. It returned execution_failed; the worker execute route returned HTTP 500. The local service log reported “Yao ceremony ended without packages”. No production signing behavior was changed to accommodate this environment failure.

## Repeat

Run `voiceid.visuals.contract.test.ts` and `auth-method-plugin.contract.test.ts` with `playwright.wallet-intended.config.ts`. These browser checks use bundled production modules and do not require the signing service. After the local signing service recovers, run the live-page, unlock-NEAR, and per-user selection contracts with the connection environment documented in ../voiceid-ui-integration/README.md.
