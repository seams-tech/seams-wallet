# Longer natural VoiceID sentences — 2026-10-25

The user approved longer prompts instead of speaking one word at a time.
The 16 randomized prompts now contain 8–9 words. B1, Aurora, speaker threshold
0.5, phrase gap limit 8, and existing enrollment format remain unchanged.

## Screening

- All 64 synthetic recordings passed at 160 words per minute: 16 sentences across
  Samantha, Daniel, Karen, and Moira. Full clips ranged from 1.75 to 2.94 seconds.
- All 16 standard enrollment recordings passed at 140 words per minute.
- All 16 unrelated sentences and 16 four-word truncations were rejected.

Candidates were selected using synthetic screening. These are development results,
not an independent human accuracy estimate. The longer text targets roughly two
seconds or more at a natural pace; it does not guarantee a fixed spoken duration.

Both fixture sets now use connected speech without time stretching. The browser
fixtures and noise mixtures were regenerated. Tokens were generated from the
existing pinned Aurora tokenizer without re-exporting the model.

## Browser verification

The live-page and unlock-NEAR contracts passed on a fresh isolated local stack
(2 tests, 3.2 minutes). They exercise enrollment, phrase and speaker rejection,
retry details, cancellation, fresh-session unlock, natural-paced capture, and
reviewed signing. The chain RPC is deterministic. The screenshot shows the
actual prompt. These results do not claim a new human voice success rate or
an on-chain transfer.

SDK and test type checks and the bloat check passed. Two visual-probe literals
were updated because the retired short sentences are no longer valid prompt
values. The capture timing assertions now allow the intentional longer input.

## Reproduce

Use tests/scripts/voiceid-aurora/vocabulary.py to regenerate tokens, fixtures.py
for both audio sets, and tests/scripts/voiceid-noise/fixtures.py for mixtures.
See those directories' README files for dependency and model provisioning steps.

```sh
python tests/scripts/voiceid-aurora/screen.py \
  --model-root /tmp/voiceid-aurora \
  --cases docs/evidence/voiceid-long-sentences/recognition-cases.json \
  --output /tmp/voiceid-long-screen
```

The browser run used gateway 4800, role-worker port offset 700, app 4345, and
wallet host 4346 with playwright.wallet-intended.ci.config.ts and a fresh temporary
state root. The live user's services and enrollment were preserved.
