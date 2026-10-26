# Browser speaker-model evaluation

Compare the current Wallet ECAPA export with pinned ReDimNet B0 and B1 using
public speech. This harness does not access microphone permissions, Wallet
storage, enrollment templates, credentials, or transaction signing.

## Inputs and provenance

- ReDimNet source: [IDRnD/redimnet](https://github.com/IDRnD/redimnet), MIT,
  revision `ce039a624cb99fe127702ceb94c6080090e5032f`.
- Checkpoints: [voice-is-cool/ReDimNet](https://huggingface.co/voice-is-cool/ReDimNet),
  MIT, revision `5180983b6895dafa0cd88aa88e8a07296df27834`.
  Use `b0-vox2-ft_lm.pt` and `b1-vox2-ft_lm.pt`. The exporter checks their SHA-256 hashes.
- ECAPA: the historical full-waveform baseline export, supplied separately.
  Save it as `$voiceid_eval/ecapa.onnx` for the comparison. The exporter checks its pinned hash.
- Audio: [LibriSpeech test-clean](https://www.openslr.org/12), CC-BY-4.0,
  Vassil Panayotov, Guoguo Chen, Daniel Povey, and Sanjeev Khudanpur.
  The source recordings come from LibriVox audiobooks.
- JavaScript runtime: use the Wallet's installed `onnxruntime-web` dependency.
  This evaluation uses the same single-threaded WASM backend as the plugin.

Keep downloads, generated models, decoded audio, and raw embeddings outside Git.
Use a temporary directory or an explicitly ignored evaluation directory. Model
weights retain their upstream licenses. This repository does not redistribute them.

## Prepare

Run from the public `seams-wallet` repository. Use a Python 3.11 environment with
these versions from the reference run:

```sh
python3.11 -m venv /private/tmp/voiceid-model-env
/private/tmp/voiceid-model-env/bin/pip install torch==2.6.0 torchaudio==2.6.0 numpy==2.2.6 onnx==1.17.0 onnxruntime==1.23.2 scipy==1.17.1 soundfile==0.14.0
```

Download the pinned artifacts:

```sh
voiceid_eval=/private/tmp/voiceid-redimnet-evaluation
mkdir -p "$voiceid_eval/source"
curl -L --fail -o "$voiceid_eval/source.tar.gz" https://codeload.github.com/IDRnD/ReDimNet/tar.gz/ce039a624cb99fe127702ceb94c6080090e5032f
curl -L --fail -o "$voiceid_eval/b0.pt" https://huggingface.co/voice-is-cool/ReDimNet/resolve/5180983b6895dafa0cd88aa88e8a07296df27834/b0-vox2-ft_lm.pt
curl -L --fail -o "$voiceid_eval/b1.pt" https://huggingface.co/voice-is-cool/ReDimNet/resolve/5180983b6895dafa0cd88aa88e8a07296df27834/b1-vox2-ft_lm.pt
curl -L --fail -o "$voiceid_eval/test-clean.tar.gz" https://openslr.trmal.net/resources/12/test-clean.tar.gz
```

Verify the corpus archive against OpenSLR's published MD5:
`32fa31d27d2e1cad72775fee3f4849a9`. The generated report also records SHA-256.
Extract `source.tar.gz` into `source/` and `test-clean.tar.gz` into the evaluation
root, using Python `tarfile.extractall(..., filter='data')` or equivalent safe
archive extraction. The resulting corpus path must be `LibriSpeech/test-clean`.

```sh
/private/tmp/voiceid-model-env/bin/python tests/scripts/voiceid-model-evaluation/prepare.py \
  --root "$voiceid_eval" \
  --ecapa "$voiceid_eval/ecapa.onnx"
```

The exporter replaces only the complex-valued spectrogram operation with an
ONNX STFT representation. It preserves reflection padding, the padded Hamming
window, hop size, mel filterbank, pre-emphasis, and normalization. It checks
PyTorch/ONNX embedding agreement at 1, 2, 4, and 8 seconds, including a non-aligned
sample count. The corpus preparation then saves PyTorch reference embeddings
for both candidates and native ONNX reference embeddings for current ECAPA.

## Run browsers sequentially

Install the repository's dependencies and Playwright browser binaries first.
Use its existing SDK static assets for the runtime-size measurement. No live
Wallet server is needed. Each run starts a temporary server bound to 127.0.0.1.

```sh
node tests/scripts/voiceid-model-evaluation/run-browser.mjs \
  "$voiceid_eval" "$voiceid_eval/ecapa.onnx" chromium
node tests/scripts/voiceid-model-evaluation/run-browser.mjs \
  "$voiceid_eval" "$voiceid_eval/ecapa.onnx" webkit
/private/tmp/voiceid-model-env/bin/python tests/scripts/voiceid-model-evaluation/analyze.py \
  --root "$voiceid_eval" \
  --sdk-assets packages/wallet/dist/public/sdk \
  --engines chromium webkit
```

Artifacts: `exports.json`, `corpus.json`, browser/model JSON outputs and screenshots,
`report.json`, `inputs.json`, and `trials.csv.gz`. The last three form the shareable
evidence set. They exclude raw audio and speaker embeddings. The trial table
allows recomputing every reported false acceptance and false rejection count.

## Protocol and limits

- Select speakers with at least two chapters, each with four eligible recordings.
  Enrollment uses three clips from the first chapter. Probes use four from the second.
- Sort speaker IDs numerically and alternate calibration/evaluation assignment.
  These groups contain different speakers. In the recorded run, 29 speakers qualify:
  15 calibration and 14 evaluation.
- Center-crop each recording to 4 seconds and 2 seconds. Apply the Wallet's energy
  trimming rule. Require 2 seconds of voiced audio for the 4-second condition.
  The 2-second stress condition requires 1 second; it differs from production admission.
- Normalize each embedding and average three enrollment embeddings, then normalize
  the mean. Build independent templates and thresholds for each clip duration.
- Choose a threshold using calibration impostor scores with at most 1% acceptance.
  Evaluate that frozen threshold on the held-out cohort. This 1% target is for
  comparison only; it is not an approved deployment threshold.
- Report empirical EER separately as a descriptive curve statistic. Never use its
  test-set threshold for deployment. Bootstrap intervals resample probe speakers,
  conditional on the fixed enrollment cohort. Zero-event intervals are degenerate
  and do not establish zero population error.
- Require browser/reference cosine agreement of at least 0.99999 for every input.
  Quiet-input checks require finite output only; the Wallet rejects quiet input
  before inference. Finite output does not mean that silence is an identity.
- Run each model in a new browser context. Measure session load over localhost and
  per-recording inference time. Exclude the first inference from warm percentiles.
  Runs use one pass per model in B1, ECAPA, B0 order. Timing is indicative and can
  change with thermal state, browser version, and hardware.
- Desktop WebKit is not a physical iPhone Safari test. This corpus does not cover
  microphone changes, room acoustics, or conversational speech. Model pretraining
  identity overlap has not been audited. Total WASM memory and internet download
  latency are not measured.

The benchmark checks conversion and compares models. It does not change the
Wallet's deployed model or calibrate production authentication policy.

To provision the selected B1 model without the historical ECAPA baseline, run
`prepare.py --root "$voiceid_eval" --export-only`. Copy the resulting `b1.onnx` to
`packages/voiceid/assets/redimnet-b1.onnx`, then build the SDK. The source
and B0/B1 checkpoints above remain required. No corpus download is needed for export.

## Adaptive enrollment feasibility

This speaker-only experiment preserves each baseline and adds a bounded contribution
from three separate recordings. It never reads Wallet storage or captures a microphone.
The public dataset's speaker label stands in for independent owner confirmation.
It does not exercise passkey authorization or the randomized phrase gate.

Use the previously prepared corpus and deployed B1 model. Python needs NumPy,
ONNX Runtime, and SoundFile; PyTorch is unnecessary for this experiment.

```sh
voiceid_adaptation=/private/tmp/voiceid-adaptation-evaluation-20261026
python tests/scripts/voiceid-model-evaluation/adaptation.py prepare \
  --root /private/tmp/voiceid-redimnet-evaluation \
  --output "$voiceid_adaptation"
node tests/scripts/voiceid-model-evaluation/run-browser.mjs \
  "$voiceid_adaptation" /private/tmp/voiceid-redimnet-evaluation/ecapa.onnx chromium b1
python tests/scripts/voiceid-model-evaluation/adaptation.py analyze \
  --root "$voiceid_adaptation" --engine chromium
```

The output directory must be new. `prepare` freezes `protocol.json` before model
inference. The browser runner's final `b1` argument excludes the other models;
the historical ECAPA positional argument is unused in this mode. Repeat the last
two commands with `webkit` to check another browser engine.

The protocol uses the original speaker split and baseline/probe files. Three
unused, qualifying recordings from each probe chapter supply supplemental samples.
Speakers with fewer than three such recordings are excluded before scoring.
Enrollment, supplement, and probe source files must be disjoint. Probe durations
share source recordings, so they must not be pooled as independent trials.

The candidate uses 80% baseline and 20% normalized supplemental mean. Admission
requires sample/baseline cosine at least 0.5 and resulting template/baseline cosine
at least 0.98. Each new template is recomputed from the original baseline. These
are fixed exploratory parameters, not calibrated production learning rules.
The acceptance threshold remains 0.5. No parameter search uses evaluation outcomes.

`analyze` verifies the frozen protocol, model hash, PCM hashes, exact browser output
coverage, and browser/native agreement. It reports paired recoveries and regressions,
new other-speaker accepts, per-speaker results, and descriptive bootstrap intervals.
Zero-event intervals are degenerate and cannot bound population false acceptance.

Shareable artifacts: `protocol.json`, `inputs.json`, `<engine>-adaptation-report.json`,
`<engine>-adaptation-trials.csv.gz`, and the browser completion screenshot.
Keep `corpus.json`, raw browser outputs, models, and PCM outside Git because they
contain embeddings or audio. Trial CSV rows allow independent recomputation of counts.

This corpus uses read speech and the historical RMS trim. It does not reproduce
current microphone processing, Silero capture, conversation, or separate-day use.
Supplement and probe files share a chapter. Baseline/probe files also appeared in
earlier model studies. Treat a positive result as feasibility evidence only.
Automatic learning, poisoning, expiry, and production authorization remain untested.
