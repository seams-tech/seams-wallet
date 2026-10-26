# AuroraASR browser export and development screening

The browser uses the pinned AuroraASR-1M INT8 checkpoint under Apache-2.0.
The source model includes custom Python code. Review the three pinned Python files
before executing the exporter. The exporter imports these files directly.
It does not use automatic remote model loading.

## Reproduce the model

Use Python with torch 2.6.0, torchaudio 2.6.0, transformers 4.51.2, numpy 2.2.6,
onnx 1.17.0, onnxruntime 1.23.2, sentencepiece, safetensors, and soundfile.
Run from the repository root:

```sh
python tests/scripts/voiceid-aurora/export.py \
  --root /tmp/voiceid-aurora \
  --vocabulary packages/wallet/src/plugins/voiceid/browser/phraseVocabulary.ts
cp /tmp/voiceid-aurora/aurora-int8.onnx packages/wallet/assets/voiceid/aurora-int8.onnx
```

The exporter downloads a pinned revision, exports FP32 and INT8, and checks both
against PyTorch at several input lengths. It rejects an unexpected INT8 artifact
hash. `export.json` records input hashes, output hashes, sizes, versions, and parity.
The ONNX graph includes waveform preprocessing. INT8 weights dequantize for floating
point execution. Constant folding stays disabled to preserve compact weights.
The generated tokenizer pieces replace a runtime tokenizer download.

Build the SDK after provisioning both Aurora and B1. The asset build copies their
notices and licenses beside the models. Model files stay outside Git.

## Repeat the synthetic screening

These are development cases and do not provide independent human accuracy estimates.
The native screen reports unconstrained decoded text. Phrase acceptance is exercised
through the browser contract using the production bounded matcher. Historical CTC
screening reports describe the retired log-gap rule and are not current acceptance results.

On macOS with the named system voices installed:

```sh
python tests/scripts/voiceid-aurora/screen.py \
  --model-root /tmp/voiceid-aurora \
  --cases docs/evidence/voiceid-aurora-20261024/ctc-screen.json \
  --output /tmp/voiceid-aurora-screen
python tests/scripts/voiceid-aurora/screen.py \
  --model-root /tmp/voiceid-aurora \
  --cases docs/evidence/voiceid-aurora-20261024/near-misses.json \
  --output /tmp/voiceid-aurora-near-misses
```

Each run synthesizes 16 kHz audio and writes a repeatable `results.json` artifact.
System voice versions can change results. The current browser test uses the production
Aurora decoder and matcher with actual ONNX inference.

## Browser E2E fixtures

The tracked WAVs contain synthetic Samantha speech. They contain no user recording.
Regenerate in a temporary directory with macOS `say` and ffmpeg:

```sh
python tests/scripts/voiceid-aurora/fixtures.py --output /tmp/voiceid-aurora-fixtures
```

The standard fixtures use connected speech at 140 words per minute. The natural
fixtures use 160 words per minute. Neither set stretches audio. The current
4–6-word trading sentences take about 1.5–2.2 seconds in the natural fixture set.
The browser helper reads the visible phrase and plays its WAV through a MediaStream.
It exercises MediaRecorder, decoding, preprocessing, B1, and Aurora without mocking
model outcomes. Explicit overrides supply wrong-speaker and wrong-phrase samples.

Run the three Wallet contracts against the local Wallet services:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts \
  e2e/intended-behaviours/passkey.voiceid-near.contract.test.ts
```

Configure `SEAMS_INTENDED_APP_URL`, `SEAMS_INTENDED_WALLET_ORIGIN`,
`SEAMS_INTENDED_ROUTER_URL`, `SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID`, and
`SEAMS_INTENDED_PUBLISHABLE_KEY` for the local service instance.
Each successful contract writes JSON evidence. The chain RPC is deterministic;
Wallet sessions and Ed25519 Yao signing use the real local services.

Two capture-quality fixtures derive from the tracked synthetic `0.wav`:

```sh
ffmpeg -v error -y -i tests/fixtures/audio/aurora/0.wav -t 0.35 tests/fixtures/audio/aurora/short.wav
ffmpeg -v error -y -i tests/fixtures/audio/aurora/0.wav -af volume=0.001 tests/fixtures/audio/aurora/quiet.wav
```

The unlock contract injects these before a valid sample. It checks that the first
two attempts stay locked, supply distinct measurement IDs, and never call verify.
All three attempts use one original server challenge.


Natural-paced fixtures in `tests/fixtures/audio/aurora/natural/` use Samantha at
160 words per minute without time stretching. Regenerate on macOS:

```sh
python tests/scripts/voiceid-aurora/fixtures.py --natural --output /tmp/voiceid-natural-fixtures
cp /tmp/voiceid-natural-fixtures/*.wav tests/fixtures/audio/aurora/natural/
```

The unlock contract enrolls at 140 words per minute, rejects truncated and quiet
input, then unlocks with natural speech after two seconds of initial silence.
It signs a reviewed NEAR transfer with another natural-paced phrase. This checks
existing enrollment compatibility and capture completion with the real browser
models. Synthetic voices do not establish human false-accept or false-reject rates.

## Update the sentence bank

Edit `phrases.json`, then regenerate the phrase bank and decoder pieces with the pinned tokenizer. This does
not export or change the Aurora model:

```sh
python tests/scripts/voiceid-aurora/vocabulary.py \
  --root /tmp/voiceid-aurora \
  --vocabulary packages/wallet/src/plugins/voiceid/browser/phraseVocabulary.ts
```

`screen.py` accepts `--rate` (default 160) for transcript screening.
Use `--rate 95` when reproducing the historical slow-speech screen. Cases can
override the rate and supply a different spoken sentence for negative checks.
Regenerate both fixture sets and the derived noise fixtures after changing the bank.
The browser phrase matcher uses a 30% text-difference bound and a 10-point candidate margin.
Speaker verification remains at 0.5. Existing speaker
enrollment remains valid because its model and template format did not change.


## Bounded phrase tolerance

Generate the additional synthetic cases with:

```sh
python tests/scripts/voiceid-aurora/fixtures.py --tolerance --output /tmp/voiceid-tolerance-fixtures
```

The tracked copies are under `tests/fixtures/audio/aurora/tolerance/`. The browser
contract `tests/wallet-ui/voiceid-phrase-tolerance.browser.test.ts` checks all 16
natural fixtures against all 16 challenges, plus omitted articles, approximate
wording, unrelated speech, reordering, a negation, and a short fragment. Run it with
`playwright.wallet-browser.config.ts`, project `chromium`. It emits
`phrase-tolerance.json` with the decoded text and decision for every case.
