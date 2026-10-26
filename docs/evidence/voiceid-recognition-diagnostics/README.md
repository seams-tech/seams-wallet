# Remaining VoiceID recognition failures

Investigation on 2026-10-26. The user confirmed that speech began after Listening.
The latest seven screenshots contain six phrase-only failures and one speaker
failure at 0.471 that also failed phrase matching. Phrase-only gaps range from
13.3 to 17.6 against the limit of 8. Every closest candidate equals the attempted
sentence. This candidate comes from the fixed phrase bank and is not an independent
transcription of what the model decoded.

## Evidence and limits

| Fact | Instrument | Scope |
| --- | --- | --- |
| Phrase rejection remains the main reported failure. | User screenshots, with attempted phrase and score gap. | No recordings or unconstrained decoded text were available. |
| One similar rejection is reproducible with synthetic speech. | Pinned Aurora ONNX model, four system voices, all 16 prompts at 180 words/minute. | 63/64 accepted. This is development screening, not human accuracy qualification. |
| The rejected synthetic phrase has actual decoding errors. | Pinned SentencePiece tokenizer applied to unconstrained model output. | Daniel's “we have enough time to walk home” decoded as “we have notough time to wardk the home.” Its gap was 9.762. |
| Existing natural fixtures do not reproduce the live failure rate. | 32 tracked full-waveform fixtures at 140/160 words/minute. | All passed the existing phrase rule. |

| Possible cause | Finding | Remaining uncertainty |
| --- | --- | --- |
| Speaking before the listening state | User reports waiting for Listening. | Physical microphone startup latency was not measured. |
| Incorrect words from the small phrase model | Reproduced in one synthetic rejection. | The user's actual decoded words were missing from previous details. |
| Trimming removes quiet word edges | An exploratory Silero test of 48 natural synthetic clips at three gains passed with 200 ms, 500 ms, and full-recording context. | This does not rule out clipping in human recordings. Trimming was not changed. |
| Alternate token sequences for the same text | Previous lattice screening did not improve the saved cases. | Live decoded output is needed before choosing another decoder. |
| Improvements expired during repeated attempts | Supplemental references last at most 32 uses. | Previous details did not identify the reference used for each failure. |

## Diagnostic change

Recording details now includes the unconstrained decoded text as **Model heard**.
It also reports the original or improved reference and both similarity scores from
the same embedding. Only the active reference determines acceptance. The original
score is diagnostic and cannot override a rejection. Template use remains atomic.

Phrase gaps show three decimals and explicitly state when they exceed the limit.
Phrase-only errors include model-input duration, detected speech, and background
estimate. Speaker errors also retain the phrase error details when both checks fail.

The tokenizer pieces come from the pinned tokenizer through the existing generator.
No new model weights are required. Raw audio and embeddings are still discarded.
Decoded text stays in the current local recording diagnostics; it is not persisted
or sent by this change. The user can choose to share those details.

Speaker threshold **0.5**, phrase gap **8**, capture timing, preprocessing, and
acceptance decisions remain unchanged. These changes do not claim to fix recognition.
The next live failure's decoded words and paired scores are needed to select a fix.

## Repeat

```sh
python tests/scripts/voiceid-aurora/screen.py \
  --model-root /private/tmp/voiceid-aurora-evaluation \
  --cases docs/evidence/voiceid-recognition-diagnostics/natural-cases.json \
  --output /private/tmp/voiceid-recognition-repeat --rate 180
```

Provisioning instructions are in `tests/scripts/voiceid-aurora/README.md`.
The generated `natural-screen.json` includes every decoded text and score.
System voices are Samantha, Daniel, Karen, and Moira. Their installed versions can
change results. No synthetic audio or user biometric vectors are committed here.

The live-page and ES256 management browser contracts passed with real browser
models and deterministic NEAR RPC. They verify the new error details alongside
rejection, enrollment, adaptation, unlock, and signing. Their JSON reports are saved
here. SDK build, SDK/test type checks, and the bloat check passed.
