# AuroraASR randomized phrase prototype — 2026-10-24

VoiceID now requires a B1 speaker match and an Aurora phrase match from the same
browser recording. Enrollment, unlock, and signing display a randomly selected
short English phrase. Each attempt keeps its phrase fixed. Retries change it.

## Download and execution

The pinned INT8 ONNX export is 1,342,384 bytes, or 1,017,191 bytes with local gzip
level 6. This is a compression measurement, not a production transfer measurement.
The model shares the existing ONNX Runtime Web WASM instance and cache mechanism.
The two models plus WASM and runtime modules total 24,536,977 uncompressed bytes,
excluding Wallet and plugin JavaScript. Existing B1 enrollment remains valid.

The export includes 16 kHz waveform preprocessing. Compressed weights dequantize
for floating point execution. The phrase bank's token sequences live in code,
so the browser does not download a tokenizer. No audio or transcript leaves the
Wallet origin or enters persistent storage. Packaged model notices identify the
upstream revision and Apache-2.0 license.

[Export results](export.json) include hashes, versions, numerical parity checks,
and model sizes. [Speech reference checks](reference.json) found identical decoded
text between the upstream preprocessing pipeline and ONNX on the checked samples.
Recognition errors also occurred upstream, including with FP32 weights.

## Development screening

These synthetic samples informed the phrase bank and cutoff. They are development
data, including the additional voices. They do not estimate human accuracy.

| Screening | Result |
| --- | --- |
| Initial four-word phrases, Samantha and Daniel | 17/64 exact greedy transcripts |
| Natural phrases, Samantha and Daniel | 42/66 exact greedy transcripts |
| Selected 16 phrases, Karen and Moira | 21/32 exact greedy transcripts |
| Selected phrases, same additional voices, constrained decoder at gap 5 | 30/32 correct accepts |
| 98 unrelated samples, constrained decoder at gap 5 | 0 accepted bank phrases |
| 48 changed-word or missing-word samples at gap 5 | 0 accepted expected phrases |

The decoder scores all 16 phrases using CTC sequence likelihood. CTC sums possible
alignments between audio frames and text tokens. It selects the best phrase, then
compares that score with the unconstrained collapsed-greedy sequence. The maximum
allowed log-likelihood gap is 5. Only then does it compare with the displayed phrase.
It never scores the expected phrase alone or uses fuzzy string matching.

The exploratory cutoff of 6 falsely accepted “i want glass of water” for
“i want a glass of water” (gap 5.900565). The shipped cutoff is 5.
The saved [near-miss report](near-misses.json) retains the original cutoff-6
`acceptedExpected` values. Compare its scores with 5 for the shipped policy.

Raw screening reports: [four-word](four-word-screen.json),
[natural](natural-screen.json), [additional voices](additional-voices.json),
[CTC scores](ctc-screen.json), and [near misses](near-misses.json).

## Browser qualification

The Wallet contracts use actual MediaRecorder audio, B1 and Aurora WASM inference,
local Wallet sessions, and Ed25519 Yao signing. NEAR RPC responses are deterministic.
All three contracts passed (4.6 minutes). The final packaged-build enrollment and
signing journey also passed (2.6 minutes). Results:
[enrollment and wrong phrases](voiceid-live-page.json),
[fresh sessions and concurrent lock](voiceid-unlock-near.json), and
[broadcast retries](voiceid-browser-broadcast-failure.json).
Synthetic fixtures are available in the repository. The tests write JSON artifacts.
See [repeat instructions](../../../tests/scripts/voiceid-aurora/README.md).

An initial expanded run rejected a synthetic third enrollment sample. The test then
waited for activation until timeout. Its helper now bounds each sample's wait.
Native simulation of compression and trimming also rejected two fixture recordings
that passed on the original WAV. Fixture speaking rates were adjusted without
changing the production cutoff. This demonstrates sensitivity to audio conditions.

The [live transfer evidence](live-transfer.json) records a successful user-reported
randomized-phrase unlock and transfer using an existing B1 enrollment. NEAR RPC
independently confirmed final success for a one-yoctoNEAR self-transfer. Exact
phrases and client inference scores were not collected. Randomized-phrase enrollment
still needs a live human check. Test other speakers, accents, noise, and microphones
before production use. More missing, reordered, and extra-word cases remain necessary.

## Scope

The finite phrase bank does not establish replay resistance or liveness. VoiceID
retains the assumption that the authorized user possesses an open, active device.
The server proves device-key possession. Trusted Wallet code checks speaker and
phrase matches before key use. Existing expiry, cancellation, review binding,
quota, and single-consumption checks still apply.
