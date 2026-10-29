# Citrinet browser evaluation

Aurora remains the production recognizer. These tools compare Citrinet and
Aurora locally. The SDK does not import the experiment or download its model.
Moonshine is excluded. INT4 remains deferred until human results justify a
download-size tradeoff.

## Export and verify

Use an isolated Python 3.12 environment. The tested direct dependencies are:

```sh
uv venv --python 3.12 /tmp/seams-citrinet-python
uv pip install --python /tmp/seams-citrinet-python/bin/python \
  torch==2.6.0 torchaudio==2.6.0 numpy==2.2.6 onnx==1.17.0 \
  onnxruntime==1.23.2 soundfile==0.13.1 PyYAML==6.0.3 omegaconf==2.3.0 \
  hydra-core==1.3.2 pytorch-lightning==2.0.7 torchmetrics==0.11.4 \
  transformers==4.44.2 huggingface-hub==0.23.5 librosa==0.10.2.post1 \
  einops==0.8.0 inflect==7.5.0 webdataset==0.1.62 tensorboard==2.20.0 \
  ruamel.yaml==0.18.6 wget==3.2 setuptools==80.9.0 wrapt==1.17.3 \
  python-dateutil==2.9.0.post0 sox==1.5.0 pandas==2.2.3 text-unidecode==1.3
uv pip install --python /tmp/seams-citrinet-python/bin/python --no-deps nemo_toolkit==1.23.0

/tmp/seams-citrinet-python/bin/python tests/scripts/voiceid-citrinet/export.py \
  --root /tmp/seams-citrinet-eval --fixtures tests/fixtures/audio/aurora
/tmp/seams-citrinet-python/bin/python tests/scripts/voiceid-citrinet/native_parity.py \
  --root /tmp/seams-citrinet-eval --fixtures tests/fixtures/audio/aurora
```

The exporter verifies the pinned NVIDIA checkpoint digest. It reads only named
archive members and loads tensors with `weights_only=True`. Model attribution
and the architecture license are in [NOTICE.md](NOTICE.md).

Both ONNX variants include waveform preprocessing. The float variant must match
the local PyTorch implementation. The separate parity check must match NVIDIA
NeMo's actual preprocessing, padded encoder, convolution masks, and decoder.
Only unrelated package registration initializers are skipped. Inference code
remains unchanged. The check records the float model digest.

INT8 uses per-channel weight storage with DequantizeLinear nodes. Activations
and arithmetic use FP32. The export report records frame agreement, relative
logit error, and decoded text for FP32 and INT8. These distinguish export parity
from quantization changes.

## Repeat the browser comparison

Build the Wallet and VoiceID assets first. Then run from the repository root:

```sh
CITRINET_EVAL_ROOT=/tmp/seams-citrinet-eval \
SEAMS_TEST_FRONTEND_URL=http://localhost:4299 \
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/voiceid-citrinet.chromium.test.ts --project=chromium --trace=off \
  --output=../output/playwright/voiceid-citrinet
```

The test exports a JSON report and a capture-page screenshot. Each audio buffer
goes through both models. Model order alternates. Both use the production phrase
matcher with its existing distance, margin, word-count, and negation checks.
The corpus contains 39 standard clips, ten clips from two additional synthetic
voices, and ten wrong-phrase or negation controls. All 38 other bank challenges
are checked for each correctly read clip. No prompt constrains transcription.

The report records exact input hashes, model hashes, native parity, browser and
machine details, initialization time, recognition latency, failures, and counts.
The capture journey uses real MediaRecorder and Silero with synthetic input.
It verifies consent gating, labels, score exports, session closure, and the
absence of uploads. Synthetic data is tagged `synthetic_fixture`.

The October 29 trial on an Apple M4 Pro with Chromium 141 matched 49/49 Aurora
clips and 48/49 Citrinet INT8 clips. Both rejected all ten controls. Neither
accepted another bank challenge. Citrinet missed “If you panic, panic early.”
The INT8 export is 10,483,704 bytes, or 8,835,693 gzip bytes. It shares the
existing ONNX WASM engine and runs with one thread without cross-origin
isolation. Desktop recognition took roughly 35 ms for Citrinet and 8 ms for
Aurora. Loopback initialization is separate from real network download time.

NVIDIA NeMo parity passed on all 39 reference clips. Argmax agreement was 100%.
The largest log-probability error was 0.000464. INT8 changed two decoded texts
relative to FP32. These measurements establish export compatibility and the
synthetic comparison. Human improvement and mobile latency remain unmeasured.

## Compare fresh human recordings

```sh
CITRINET_EVAL_ROOT=/tmp/seams-citrinet-eval \
node tests/scripts/voiceid-citrinet/serve.mjs 4392
```

Open `http://localhost:4392/` in Chrome. Confirm participation. Prepare the
models. Record each displayed phrase, then label the reading before seeing
results. Enrollment is unnecessary because this trial isolates phrase matching.
The batch contains five phrases followed by three explicit wrong-phrase controls.
Read exactly the words displayed for each control. Model order alternates.
The page stops after eight labeled recordings and enables the final export.

Export before closing. The server binds to loopback and accepts GET requests
only. Audio is discarded after both recognizers finish. Exports omit transcripts,
voice vectors, and microphone identifiers. They retain prompt labels, reading
judgments, model failures, candidate scores, timings, and build/model hashes.
One model failure preserves the other model's result. Results include separate
counts for correct readings and all natural readings, including stumbles.

Earlier human calibration exports contain no audio. They cannot supply a fair
replay comparison. Do not infer human acceptance from the synthetic trial.

## Validation limits

VoiceID and Wallet-state type checks pass. The broader browser TypeScript
project has existing errors in unrelated fixtures. No Citrinet source errors
remain in that project. The bloat check and existing Aurora browser checks pass.
