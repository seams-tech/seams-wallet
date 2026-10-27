# VoiceID noise evaluation

The browser uses Silero VAD v5.1.2 at revision
`6478567951ae5c9979ad7b234185b5515f4be7a1` (MIT).
It processes sequential 512-sample frames at 16 kHz with 64 context samples.
The recurrent state belongs to one recording and is cleared when recording ends.
The browser checks the model digest before inference and caches it with the other
optional VoiceID models.

Provision the model from the pinned upstream revision:

```sh
curl -fL https://raw.githubusercontent.com/snakers4/silero-vad/6478567951ae5c9979ad7b234185b5515f4be7a1/src/silero_vad/data/silero_vad.onnx \
  -o packages/voiceid/assets/silero-vad.onnx
shasum -a 256 packages/voiceid/assets/silero-vad.onnx
```

Expected SHA-256: `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`.
Expected size: 2,327,524 bytes. The license ships beside the model.

Generate deterministic synthetic mixtures from the existing natural-paced speech:

```sh
python3 tests/scripts/voiceid-noise/fixtures.py --output tests/fixtures/audio/voiceid-noise
```

Evaluate the detector against the old RMS rule. This requires NumPy, SoundFile,
ONNX Runtime, SentencePiece, and FFmpeg. Use the pinned Aurora tokenizer
from the existing Aurora export workflow. It also screens FFmpeg spectral noise reduction as an
offline candidate. That filter is not part of the browser plugin.

```sh
python tests/scripts/voiceid-noise/evaluate.py \
  --model packages/voiceid/assets/silero-vad.onnx \
  --tokenizer /tmp/voiceid-aurora/bpe256.model \
  --output /tmp/voiceid-noise-baseline
```

Run `voiceid.noise.contract.test.ts` with the existing intended-behavior Playwright
configuration and local services. It rejects noise alone, displays noise guidance,
and unlocks and signs on speech mixed with continued noise. The output contains a screenshot
and `noise-capture.json`. Playwright 1.56.1 is required because the previously pinned
1.55 release stalls AudioWorklet loading (upstream issue #37592).

These fixtures contain generated noise and synthetic speech. They do not establish
human accuracy in a café. A quieter synthetic speaker remains speech to VAD. The
speaker and phrase models retain their separate authorization checks. No VAD or
noise estimate identifies the owner or provides spoof detection.
