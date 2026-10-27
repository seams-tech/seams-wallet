# VoiceID transfer readiness — 2026-10-25

The user supplied a screenshot with a prior successful unlock message and reported a disabled transfer button. A later read-only observation of the live Chrome page showed Authentication: locked and “VoiceID challenge expired. Start unlock again.” The transfer button was disabled. This explains the later state, but does not prove the cause of the earlier report.

The live test page reads an exact-wallet session for its status and uses the React provider's bound wallet for signing. Commands now explicitly refresh that provider for the requested wallet before reporting completion. The unlock result no longer claims that a transfer is ready. The transfer section reports its current blocker: no wallet, locked provider, another selected wallet, no NEAR signer, or a pending review.

App and intended-test type checks passed. The bloat check passed. The live-page E2E was extended to assert immediate transfer readiness after voice unlock, but this run failed during test-wallet registration before reaching that assertion. The reported error was Router Ed25519 Yao execute failure. No signing or speaker policy was changed to bypass the blocker.

The live page received the update and displayed “Unlock this wallet to enable the transfer button.” A fresh human unlock is needed to verify the original disabled-button report. Do not claim an end-to-end fix until that succeeds.
