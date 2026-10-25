# Bounded enrollment adaptation — feasibility result

Measured 2026-10-26. The tested adaptation rule did not reduce genuine rejection
in the evaluation group. Keep production matching and enrollment unchanged.
This result does not establish that all adaptation rules are ineffective.

## Experiment

The harness preserves three four-second enrollment recordings as the baseline.
It adds up to three disjoint two-second recordings from the probe chapter.
The normalized supplemental mean contributes 20%; the baseline contributes 80%.
Each supplemental recording must score at least 0.5 against the original baseline.
The resulting template must retain a cosine of at least 0.98 against that baseline.
The final acceptance threshold remains 0.5.

All parameters were fixed before inference, without a search against evaluation
outcomes. The existing split supplies 15 development and 13 evaluation speakers.
Speaker 121 was excluded before scoring because only one unused recording was
available in the probe chapter. Every retained speaker has three supplement inputs.
Of 84 candidate inputs, 78 passed the experimental admission rules.

Both Chromium and desktop WebKit processed 392 inputs through the deployed B1
model in single-threaded ONNX WASM. Browser/native cosine agreement was at least
0.999999999998. Both engines produced the same acceptance decisions.

## Results

| Cohort | Probe duration | Baseline genuine rejects | Adapted genuine rejects | Other-speaker accepts, baseline → adapted |
| --- | --- | --- | --- | --- |
| Development | 2 seconds | 1 / 60 | 0 / 60 | 0 / 840 → 0 / 840 |
| Development | 4 seconds | 0 / 60 | 0 / 60 | 0 / 840 → 0 / 840 |
| Evaluation | 2 seconds | 2 / 52 | 2 / 52 | 0 / 624 → 0 / 624 |
| Evaluation | 4 seconds | 2 / 52 | 2 / 52 | 0 / 624 → 0 / 624 |

No genuine attempts regressed. One development attempt recovered. No evaluation
attempt recovered, so this candidate did not meet its improvement criterion.
The four-second development condition already had zero baseline rejections.

The trial counts were independently recomputed from the compressed CSV artifacts.
Reports include per-speaker outcomes, sample admission scores, template displacement,
and descriptive bootstrap intervals. Zero observed false accepts cannot establish
zero population risk. Trials share speakers and templates. Two-second and four-second
probes also share source recordings; do not pool them as independent observations.

## What the evidence can establish

| Fact | Instrument | Scope and check |
| --- | --- | --- |
| Both references use exactly the same probes. | Frozen protocol, input hashes, paired CSV rows. | The analyzer rejects overlapping enrollment/supplement/probe source files. |
| The experiment uses the deployed speaker model. | Pinned model hash and native/browser embeddings. | All 392 inputs meet the 0.99999 agreement requirement in both browsers. |
| The baseline preprocessing is unchanged. | Recomputed PCM hashes. | The shared crop helper reproduces all 406 original benchmark inputs exactly. |
| Evaluation rejection counts did not improve. | Browser scores at the fixed 0.5 threshold. | CSV recomputation agrees with each report. |

| Hypothesis | Finding | Remaining uncertainty |
| --- | --- | --- |
| Bounded additions improve genuine recognition. | One development recovery; no evaluation recoveries for this rule. | Independent conversational and later-session results remain unknown. |
| Browser inference differs enough to explain these benchmark decisions. | Both browsers agree with native inference and each other's decisions. | This does not measure microphone processing or the user's live failures. |
| The original live enrollment poorly represents natural speech. | This experiment does not use the user's enrollment. | A separately authorized live comparison is still needed. |
| Adaptation resolves phrase rejection. | Phrase recognition is outside this experiment. | It remains a separate investigation. |

The public source is read English from LibriSpeech test-clean, CC-BY-4.0. Attribution,
source URLs, and preparation steps are in the
[model evaluation instructions](../../../tests/scripts/voiceid-model-evaluation/README.md).
Pretraining identity overlap has not been audited.

Supplement and probe recordings share a chapter. The dataset does not establish
their session dates or independent microphone conditions. Dataset speaker labels
stand in for owner confirmation. Phrase checking, current Silero capture, browser
audio processing, and passkey confirmation are not exercised. Historical baseline
and probe recordings also appeared in earlier model studies.

Parity with the reported live failure pattern is **not established**. This is an
optimistic speaker-only feasibility experiment. It cannot qualify production
adaptation, automatic learning, drift resistance, or a false-acceptance bound.

## Reproduce and inspect

Use the `Adaptive enrollment feasibility` commands in the
[harness README](../../../tests/scripts/voiceid-model-evaluation/README.md).
The reference run used `/private/tmp/voiceid-adaptation-evaluation-20261026`.
Use a new output directory when preparing another run.

- `protocol.json` records parameters fixed before inference.
- `inputs.json` identifies every public input and its PCM hash.
- `chromium-adaptation-report.json` and `webkit-adaptation-report.json` record results and environments.
- The corresponding `*-adaptation-trials.csv.gz` files permit independent count recomputation.
- `chromium-b1.png` and `webkit-b1.png` show browser completion.

Raw audio, embeddings, and model weights stay outside Git. No private Wallet data
was accessed. The test browser download was developer infrastructure, not a user
VoiceID dependency. Production download sizes are documented in the
[implementation plan](../../refactor-190a-voiceid-adaptive-enrollment-plan.md#download-and-storage-cost).

## Decision

Retain this evaluation harness. Do not introduce production adaptive matching or
increase supplemental weight after inspecting these evaluation results. A different
rule requires a separately declared experiment and independent validation data.

Before production work resumes, collect explicitly authorized natural-paced human
samples across sessions and test the original-enrollment hypothesis directly.
At the time of this experiment, the passkey-confirmed collection flow, storage migration,
expiration, reset, and automatic learning were unimplemented. See the current plan
for subsequent manual implementation. This experiment changed neither threshold.

The user subsequently requested the explicit manual option as an experiment.
Its separate [browser evidence](../voiceid-adaptive-management/README.md) verifies
management behavior. The accuracy result and automatic-learning decision above
remain unchanged.
