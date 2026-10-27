# Compact VoiceID sentences — 2026-10-25

The user requested 6–7 words instead of 8–9. The bank now contains 16 sentences
with 6–7 common words. Candidates were selected for recognition and useful spoken
duration. Speaker threshold 0.5, phrase limit 8, model digests, and enrollment
format remain unchanged. No re-enrollment or new model download is required.

## Development screening

- 64/64 positive synthetic recordings passed at 160 words per minute across
  Samantha, Daniel, Karen, and Moira.
- 16/16 enrollment recordings passed at 140 words per minute.
- 16 unrelated and 16 truncated recordings were rejected.
- Normal-paced positive clips ranged from 1.84 to 2.66 seconds.

This screening was used to select the bank. It is not an independent human
accuracy estimate. Both fixture sets use connected speech without stretching.
Audio, noise mixtures, and phrase tokens were regenerated with the existing
scripts. `screening-cases.json` reproduces `screening.json` through screen.py.

## Browser verification

The live-page and fresh-session unlock/signing contracts passed (2 tests, 2.3
minutes). They cover enrollment, phrase and speaker rejection, retries,
cancellation, natural-paced unlock, and reviewed NEAR signing. The screenshot
shows the actual compact prompt. The tests use synthetic microphone input, real
browser models and local signing services, and deterministic NEAR RPC.

The first live-service run stalled with the previously documented local role-
worker failure. The verified task-owned supervisor was restarted with SIGUSR2,
reusing persistence. Entry-file hashes were recorded locally before the restart.
No database, wallet, credential, or voice enrollment was reset. The passing run
followed generation 3. This is service recovery, not a claim about the original
runtime fault's root cause.

SDK and intended-test type checks, SDK build, and bloat checks passed. Human
normal-paced success still needs live confirmation.

Reproduction uses the model and fixture commands in
../../../tests/scripts/voiceid-aurora/README.md and the local connection settings
in ../voiceid-ui-integration/README.md. Run voiceid.live-page.contract.test.ts and
voiceid.unlock-near.contract.test.ts with playwright.wallet-intended.config.ts.
