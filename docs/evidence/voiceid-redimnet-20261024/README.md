# ReDimNet B0/B1 browser evaluation — 2026-10-24

ReDimNet B0 and B1 both run through the Wallet's single-threaded ONNX Runtime Web
WASM backend in Chromium and desktop WebKit. B1 is the recommended next live-test
candidate. This result does not authorize replacing the working ECAPA model yet.

## Measured size and latency

Full-waveform exports include each model's own audio preprocessing. These are
measured generated ONNX files, rather than checkpoint-size estimates.

| Model | ONNX MB | ONNX gzip MB | Model + shared runtime MB | Combined gzip MB | Chromium 4s inference p50 / p95 | WebKit 4s inference p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current ECAPA | 83.53 | 77.82 | 97.87 | 81.52 | 345 / 363 ms | 344 / 364 ms |
| ReDimNet B0 | 4.41 | 3.79 | 18.74 | 7.49 | 49 / 51 ms | 48 / 50 ms |
| ReDimNet B1 | 8.86 | 7.98 | 23.19 | 11.68 | 71 / 75 ms | 66 / 69 ms |

MB is decimal. Runtime totals include WASM, its loader, and runtime JS. They exclude
ordinary Wallet assets and the small VoiceID plugin chunk. Gzip measurements use
level 6 and require matching server compression to become network-transfer savings.
STT is excluded. Both models remain full precision; no quantization was needed.

The Mac uses an Apple M4 Pro. Browser versions: Chromium 140.0.7339.16 and WebKit
26.0. ONNX Runtime Web: 1.30.0. Model runs were sequential in B1, ECAPA, B0 order,
one pass each. These timings are indicative, not a randomized performance study.
Session loads took 221–381 ms over localhost across the six runs. This does not
measure internet download latency. Total WASM memory was not measured.

## Reference agreement

B0/B1 full-waveform exports matched their pinned PyTorch implementations on five
sample lengths, including an eight-second recording with one additional sample.
Every browser embedding was also checked against its native reference on all
406 inputs. The minimum cosine agreement across models and browsers exceeded
0.99999999999. ECAPA's reference was the current native ONNX export.

Both browsers produced identical verification decisions for this corpus. Quiet
inputs produced finite model outputs; the Wallet's speech-quality check must
still reject silence before inference. This harness tests inference from decoded
PCM, not MediaRecorder capture or the complete Wallet signing flow.

## Speaker comparison

The public LibriSpeech test-clean subset contains 203 source recordings from 29
eligible speakers. Each recording has a four-second and two-second crop, for 406
inputs. Enrollment and probes come from different audiobook chapters. The split
uses 15 calibration speakers and 14 different evaluation speakers.

Each model/duration uses a threshold selected only from calibration scores, with
at most 1% wrong-person acceptance. Evaluation then freezes that threshold.
The 1% target is an exploratory comparison point, not a production auth target.

| Model | 4s owner rejects | 4s wrong-person accepts | 2s owner rejects | 2s wrong-person accepts |
| --- | ---: | ---: | ---: | ---: |
| ECAPA | 0 / 56 | 8 / 728 (1.10%) | 0 / 56 | 15 / 728 (2.06%) |
| B0 | 0 / 56 | 9 / 728 (1.24%) | 0 / 56 | 29 / 728 (3.98%) |
| B1 | 0 / 56 | 10 / 728 (1.37%) | 0 / 56 | 21 / 728 (2.88%) |

The four-second results are close, with broad overlapping uncertainty intervals.
The two-second stress result favors B1 over B0 directionally. It does not prove a
population ranking. Scores share speakers and templates, so trials are correlated.
The report includes probe-speaker bootstrap intervals conditional on this enrollment
cohort. Zero-event intervals are degenerate; zero observed rejects do not establish
zero population rejection.

For context, ECAPA's unchanged production threshold of 0.6 rejected 12/56 genuine
four-second probes and 33/56 two-second probes here, with no wrong-person accepts.
These are corpus measurements, not an explanation of the earlier user's mismatch.
The benchmark did not lower or change the deployed threshold.

## Recommendation and remaining work

Use B1 as the next live-test candidate because it cuts model size by about 89%
and offers a better short-clip result than B0 in this comparison. B0 remains useful
when minimizing size is the priority, especially with longer recordings.

Before replacing ECAPA:

1. Select an acceptable wrong-person acceptance target and owner-rejection limit.
2. Expand evaluation across independent recording sessions, microphones, accents,
   noise, and conversational speech. Freeze thresholds on separate calibration data.
3. Measure real iPhone and Android browser latency and memory. Desktop WebKit is
   not a physical iPhone measurement.
4. Install the selected model through the existing plugin, update its model identity,
   and require owner-authorized re-enrollment. Existing ECAPA templates are incompatible.
5. Repeat the full enrollment, voice unlock, reviewed transfer, mismatch/retry,
   cancellation, and expiry E2E. Confirm a live NEAR testnet transfer.

No production source, model selection, stored enrollment, or live Wallet service
changed during this evaluation. Model-pretraining identity overlap with LibriSpeech
was not audited. Clean audiobook results do not establish microphone robustness.

## Evidence and reproduction

- [Machine-readable report](report.json): model and source hashes, versions, timings,
  threshold values, counts, and uncertainty.
- [Input manifest](inputs.json): source utterance IDs, chapter split, crop lengths,
  and decoded-input hashes. No raw audio or embeddings.
- [Per-trial scores](trials.csv.gz): both browser runs; enough to recompute all
  acceptance and rejection counts. SHA-256 is recorded in the report.
- [Reproduction instructions](../../../tests/scripts/voiceid-model-evaluation/README.md).

Source audio: [LibriSpeech](https://www.openslr.org/12), CC-BY-4.0, Vassil Panayotov,
Guoguo Chen, Daniel Povey, and Sanjeev Khudanpur; derived from LibriVox audiobooks.
ReDimNet source and checkpoints: [ID R&D](https://github.com/IDRnD/redimnet) and
[voice-is-cool/ReDimNet](https://huggingface.co/voice-is-cool/ReDimNet), MIT.
Weights and source revisions are pinned in the report. Generated model weights
and raw corpus audio remain outside Git.
