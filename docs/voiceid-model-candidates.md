# VoiceID model candidates

Research date: 2026-10-24. Status: shortlist with initial browser evaluation. The browser prototype now uses ReDimNet B1. Broader production accuracy
qualification remains open.

Evaluate ReDimNet B0 and B1 first for speaker verification. Evaluate AuroraASR-1M
for optional spoken-phrase checking, with Moonshine Tiny as the browser baseline.
Select a replacement only after browser compatibility and accuracy checks.

The [B0/B1 browser evaluation](evidence/voiceid-redimnet-20261024/README.md) is complete
on Chromium and desktop WebKit using 29 public-corpus speakers. Full-waveform
exports measured 4.41 MB and 8.86 MB. B1 is integrated into the prototype. The [Wallet E2E evidence](evidence/voiceid-b1-live-page-20261024.json)
covers model download progress, cache reuse, owner re-enrollment, unlock, and signing.
Live enrollment with the new model and broader accuracy qualification remain open.

## Two separate tasks

| Task | Question answered | Current implementation |
| --- | --- | --- |
| Speaker verification | Does this voice match the enrolled user? | Local SpeechBrain ECAPA inference and cosine comparison |
| Speech-to-text (STT) | Which words did the user say? | Not implemented; needed for randomized spoken phrases |

STT is also called automatic speech recognition (ASR). An STT model does not
replace the speaker-verification model. The current displayed sentence helps
recording consistency. The current plugin does not check its words.

Both tasks must remain local to the browser and load only when enabled and needed.
No native host, browser extension, or system-settings change is part of this plan.
The MVP assumes the user physically possesses an open, active device. This work
covers speaker and phrase matching; spoof detection remains outside its scope.

## Current download baseline

Sizes were measured from the local prototype assets. MB means 1,000,000 bytes.

| Asset | Bytes | MB |
| --- | ---: | ---: |
| Full-waveform ECAPA ONNX model | 83,533,672 | 83.534 |
| ONNX Runtime Web WASM | 14,239,897 | 14.240 |
| Runtime module, runtime JS, and VoiceID host chunk | 131,750 | 0.132 |
| Total additional VoiceID assets | 97,905,319 | 97.905 |

Local gzip compression at level 6 reduced these assets to approximately 81.5 MB.
This is a compression measurement, not an observed production network transfer.
Hosting headers and browser caching determine actual transfer size. Cache eviction
can require another download. Ordinary Wallet SDK assets are excluded above.

The current model uses 16 kHz mono audio and a normalized 192-number speaker
representation. Its match threshold is 0.6. The live prototype completed enrollment,
voice unlock, and a NEAR testnet transfer. That single-user result does not measure
population accuracy. See the [live receipt](evidence/voiceid-live-transfer-20261024.json)
and [plugin deployment notes](../packages/wallet/src/plugins/voiceid/README.md).

## Speech-to-text shortlist

File sizes below come from Hugging Face file metadata checked on the research date.
They exclude the browser runtime. Source repositories can change; pin revisions
and hashes when creating evaluation artifacts.

| Candidate | Published assets | License listed | Browser work and assessment |
| --- | --- | --- | --- |
| [AuroraASR-1M](https://huggingface.co/AuroraAI-Research/AuroraASR-1M) | INT8 weights: 1,056,232 bytes; tokenizer: 243,353 bytes. Approximately 1.30 MB together. FP32 weights: 3,807,868 bytes. | Apache-2.0 | First size-focused candidate. English-only. Custom Python implementation requires browser export, feature extraction, and decoding. |
| [Femto-ASR](https://huggingface.co/igorktech/femto-asr) | Published FP32 weights: 9,603,384 bytes. The card advertises about 2.5 MB INT8, but that artifact was absent from the checked file listing. | Apache-2.0 | Secondary candidate. English-only. Requires browser integration and a reproducible quantized export if using INT8. |
| [Moonshine Tiny ONNX](https://huggingface.co/onnx-community/moonshine-tiny-ONNX) | UINT8 encoder: 7,919,857 bytes; merged decoder: 20,189,543 bytes; tokenizer/config files: about 3.90 MB. Approximately 32.0 MB total. | MIT | Browser baseline. Existing Transformers.js integration reduces initial integration work. |

Aurora's author reports LibriSpeech word-error rates of 11.43% on test-clean and
26.50% on test-other. Femto's author reports 10.95% and 25.36%, respectively.
These are author-reported full-utterance results. They do not establish exact
random-phrase accuracy or performance after our browser conversion.

Aurora INT8 stores compressed weights and dequantizes them during execution.
Its smaller files do not imply faster arithmetic. A community
[ONNX conversion](https://huggingface.co/cowWhySo/AuroraASR-1M-ONNX-MLX-EP)
uses a fixed input corresponding to approximately 11 seconds. Its native-runtime
checks do not establish browser or arbitrary-duration support.

For Moonshine, download one compatible encoder/decoder combination. Do not sum
all precision variants in the repository. Tokenizer files are also required.

## Speaker-verification shortlist

Checkpoint sizes and browser bundle sizes are different. A PyTorch checkpoint
requires export; an ONNX file still requires compatible operations and preprocessing.

| Candidate | Published file size | Format and license listed | Assessment |
| --- | ---: | --- | --- |
| [ReDimNet B0, VoxCeleb2, large-margin fine-tuned](https://huggingface.co/voice-is-cool/ReDimNet/tree/main) | 4,285,894 bytes | PyTorch `b0-vox2-ft_lm.pt`; MIT | First compact candidate. Requires ONNX export and browser evaluation. |
| [ReDimNet B1, same training variant](https://huggingface.co/voice-is-cool/ReDimNet/tree/main) | 8,730,606 bytes | PyTorch `b1-vox2-ft_lm.pt`; MIT | Compare against B0 for fewer owner rejections at the same wrong-person acceptance rate. |
| [WeSpeaker ResNet34-LM](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/tree/main) | Approximately 26.5 MB | ONNX; CC-BY-4.0 | Existing export provides a useful comparison baseline. Requires matching audio preprocessing. |
| [CAM++ Chinese/English, 200k-speaker variant](https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/tree/main) | Approximately 28.3 MB | Community ONNX export; exporter lists Apache-2.0 | Secondary candidate. Verify upstream weight licensing and reproduce preprocessing/export. |

The [official ReDimNet evaluation](https://github.com/IDRnD/redimnet/blob/master/EVALUATION.md)
reports VoxCeleb1-O equal-error rates of 1.16% for B0 and 0.85% for B1, without
score normalization. Equal-error rate (EER) is the operating point where
wrong-person acceptance and owner rejection rates are equal. It is not our
chosen authentication operating point. Published EER does not establish accuracy
on short browser recordings or prove equivalence to our current ECAPA model.

The [ReDimNet2 successor](https://github.com/PalabraAI/redimnet2) is also worth
checking. Its authors report 1.1M parameters and 1.04% VoxCeleb1-O EER for B0.
Weights are linked from GitHub releases. Exact exported browser size was not
measured in this investigation. Keep its results separate from original ReDimNet.

### Candidates excluded or requiring caution

- [FlaxSpeaker tiny ECAPA](https://huggingface.co/wq2012/ls_ecapa_tdnn_tiny_ge2e)
  has a 2,515,768-byte checkpoint. Its author identifies it as a 400-step,
  unconverged demonstration. Reported single-utterance EER is 12.60% on its
  LibriSpeech evaluation and 21.70% on its VoxCeleb1 evaluation. Exclude it from
  the deployment shortlist. These protocols differ from full VoxCeleb1-O.
- [OpenVoiceOS ReDimNet B2 ONNX](https://huggingface.co/OpenVoiceOS/redimnet-b2-vox2-onnx/tree/main)
  is 22,193,734 bytes. Its collection description suggests a smaller parameter
  count, but the actual file size governs downloads. It lacks a model card;
  validate provenance and licensing before use.
- [AntSpeaker ONNX](https://huggingface.co/mrfakename/AntSpeaker-ONNX) has a browser
  demo and a reported 25 MB FP16 model. Its CC-BY-NC-SA-4.0 weight license excludes
  it from our default commercial-use shortlist.
- [audio.cpp](https://github.com/0xShug0/audio.cpp) is an inference framework.
  Its documented deployment uses native CLI/server programs and a WebUI. No
  browser-WASM deployment path was established in this review. It is useful for
  model discovery, but its documented path does not meet our browser-only goal.

## Quantizing the current model

Keeping ECAPA and reducing weight precision is another candidate path.
Inspection found 82,837,504 bytes of float weights attached to Conv/Gemm/MatMul
operations. Replacing those weights with INT8 suggests approximately 21.4 MB for
the model, before quantization metadata and conversion overhead. With the current
runtime and JS, the estimated total is approximately 35.8 MB uncompressed.

This is a size estimate. No quantized ECAPA artifact was built or qualified in
this investigation. The [ONNX Runtime guidance](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
recommends calibrated static quantization for convolutional models. Preserve
sensitive preprocessing operations at full precision where measurements require it.

A [speaker-model quantization study](https://arxiv.org/html/2210.17326v5)
reports substantial compression with trained quantization methods. ResNet was
more tolerant than ECAPA in those experiments. Those results do not guarantee
that a direct conversion preserves our model's accuracy.

## Evaluation and selection

1. Pin source revisions, hashes, model files, licenses, and export dependencies.
   Produce repeatable browser artifacts with the exact preprocessing and decoder.
2. Verify output parity against each model's reference implementation. Exercise
   variable recording lengths and quiet input. Keep conversion correctness
   separate from recognition accuracy.
3. Run real browser inference on desktop Chrome and mobile Safari/Chrome. Measure
   cold download, warm latency, memory, and time from recording end to result.
4. For speaker verification, use held-out real speakers and separate recording
   sessions. Include three-sample enrollment, short speech, microphone changes,
   accents, and realistic background noise. Synthetic voices are smoke tests only.
5. Select thresholds on calibration data. Measure owner rejection at the same
   wrong-person acceptance target on a separate evaluation set. Report uncertainty.
   Do not reuse ECAPA's 0.6 threshold for a different model.
6. For STT, measure exact randomized-phrase success and incorrect-phrase acceptance.
   Include substituted, missing, reordered, and extra words, silence, and unrelated
   speech. Define text normalization before testing. A decoder constrained to the
   expected phrase alone is insufficient evidence that the phrase was spoken.
7. Compare FP32 and INT8 on the same data. Report compressed total downloads,
   including tokenizer, preprocessing code, and any extra runtime. Count a shared
   runtime once only when both models actually use the same runtime build.
8. Replace the deployed model only after the selected accuracy and latency criteria
   pass. Change the model identity with the artifact. Existing enrollment templates
   are not portable across models; require owner-authorized re-enrollment.

Use consented recordings for human evaluation. Do not retain or upload current
user enrollment audio or templates as benchmark data without authorization.

An illustrative B0 + Aurora INT8 + current runtime budget is about 20 MB before
export and preprocessing overhead. This is not a measured browser bundle.
A product acceptance threshold for accuracy loss remains to be selected before
qualification. B1 passed the browser Wallet E2E with synthetic microphone audio. Other candidates
have not passed this flow. The live B1 microphone test remains open.
