# VoiceID wallet visual polish — 2026-10-25

The prompt now uses wallet font, card, control, and color tokens. It has an SVG close icon, a full-width rounded rectangular action, a themed thin progress track, and a shared action/progress grid row. The phrase and waveform remain prominent. Authentication thresholds are unchanged.

The live-page E2E passed on the UI build, including enrollment, phrase retry, unlock, rejection checks, and signing with deterministic NEAR RPC. Screenshots are captured from that run.

The loading test required three locator updates because the disabled action is intentionally hidden while progress is visible. The corrected rerun passed loading-height, disabled-state, and cancellation checks. It later timed out while concurrent edits rebuilt the shared SDK and Vite reloaded the page. This extended rerun is not a full pass. The loading screenshot is from that rerun.

SDK build and SDK type check passed before the concurrent microphone work. The intended-test type check and bloat check subsequently passed. Concurrent voice-activity and microphone edits are excluded from this change.
