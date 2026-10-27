# Short speaker probes at the deployed threshold

Measured 2026-10-25. The user reports normal-paced failures in a quiet place with
the enrollment microphone, while separated words succeed. No user audio or score
was available for this experiment. This study evaluates a duration hypothesis.

The existing held-out LibriSpeech cohort supplies 14 speakers, three four-second
enrollment clips per speaker, and four different-chapter probes each. Center-crop
the existing four-second probes to each duration. Keep enrollment fixed. Run the
same exported B1 model in native ONNX Runtime at the unchanged threshold 0.5.

| Probe duration | Genuine rejects | Wrong-person accepts |
| --- | --- | --- |
| 0.75 s | 26 / 56 | 0 / 728 |
| 1 s | 14 / 56 | 0 / 728 |
| 1.5 s | 6 / 56 | 0 / 728 |
| 2 s | 2 / 56 | 0 / 728 |
| 3 s | 2 / 56 | 0 / 728 |
| 4 s | 2 / 56 | 0 / 728 |

The result supports obtaining more naturally spoken audio before relying on this
speaker check. It does not prove the cause of this user's individual failures.
Trials share speakers and templates, so they are correlated. Zero observed wrong-
person accepts does not establish zero risk. This is audiobook speech, not a
microphone test. Two-second crops here derive from the prepared four-second clips;
they differ from the original evaluation's independently prepared two-second clips.

No deployed threshold, enrollment, prompt bank, or capture rule changed. The user
must choose between longer natural prompts and further short-utterance model
evaluation before changing that product behavior.

Repeat after preparing the existing model-evaluation corpus:

```sh
python tests/scripts/voiceid-model-evaluation/duration.py \
  --root /private/tmp/voiceid-redimnet-evaluation \
  --output /tmp/voiceid-short-speech.json
```

Dependencies and corpus provenance are in
../../../tests/scripts/voiceid-model-evaluation/README.md. Results contain no raw
audio or speaker embeddings.
