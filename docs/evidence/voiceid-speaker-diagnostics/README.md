# Speaker mismatch diagnosis — 2026-10-25

The user reported four failed unlock attempts. The screenshot identifies a speaker mismatch but does not expose similarity or capture measurements. Direct browser observation is denied by a saved origin permission. No browser workaround was attempted.

Unlock speaker mismatches now remain in the prompt with an explicit retry and the existing challenge deadline. Recording details show similarity, threshold, detected speech duration, microphone, noise estimate, browser processing, and phrase result. Enrollment and thresholds remain unchanged.

The synthetic trim comparison found identical speaker embeddings across old RMS and new VAD cropping for 16 quiet fixtures. For 16 noisy mixtures, embedding agreement ranged down to 0.826. This compares two processing paths, not either path against the user's enrollment. It does not exclude a capture regression for the user or establish café accuracy.

SDK build, SDK/test type checks, and bloat check passed. The updated live-page E2E adds a wrong-speaker unlock rejection, verifies the wallet remains locked, opens diagnostics, and retries. Two attempts to run it failed before VoiceID, during wallet registration, with Router Ed25519 Yao execute HTTP 500. The local service log reported “Yao ceremony ended without packages”. This test has not passed in this change set.

The remaining required evidence is a failed live attempt's Recording details and whether the microphone differs from enrollment. No user audio was saved.
