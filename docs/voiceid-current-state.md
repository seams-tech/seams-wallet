# VoiceID: current state and future improvements

Source snapshot: 2026-10-31. This page describes source behavior. Use the
[release notes](../apps/docs/src/releases.md) to check package versions, and
check the installed Wallet host when assessing a deployment.

VoiceID is an optional, local authentication method. It checks the speaker and
the displayed phrase from the same recording. The application supplies the
transaction request. VoiceID uses a spoken phrase to confirm that request.
The [integration guide](../apps/docs/src/concepts/auth-methods/voiceid.md) covers
setup. [Intended Behaviours](intended-behaviours.md#browser-voiceid-prototype)
defines the Wallet flow.

## Current behavior

- An application adds `voiceIdAuthMethod()` from `@seams/voiceid`. The Wallet
  host also needs a matching VoiceID installation. Other authentication methods
  do not load VoiceID inference assets.
- An owner first unlocks with a passkey or Email OTP. VoiceID enrollment then
  requires three accepted recordings. Each recording starts with a Record click.
  The original speaker template and later manual improvements remain saved until
  the owner changes them or clears Wallet-origin storage. Improvements have no
  time or usage limit.
- A VoiceID unlock selects the voice method for that Wallet Session. Reviewed
  native NEAR and Arc testnet transfers require a new **Confirm with VoiceID**
  action. The Wallet retains the full review, its deadline, signing permissions,
  and session limits. Mainnet and other transaction kinds remain outside the
  current VoiceID approval policy.
- An application can pass `options.voiceId.confirmationCommand`. The Wallet uses
  its leading action word to choose a short phrase family. The full amount,
  asset, price, and transaction stay in the review. The Wallet does not parse
  the command into a trade.
- Capture uses 16 kHz mono audio and a local speech detector. It stops after a
  pause or at eight seconds. Audio that fails the quality check never reaches
  phrase matching, speaker matching, or device-key use. Raw audio is discarded
  after processing. Enrollment templates and device credentials stay in the
  Wallet origin.

| Local task | Current implementation |
| --- | --- |
| Speech detection | Silero VAD and an audio-level check |
| Speaker comparison | ReDimNet B1, with an experimental cosine cutoff of **0.45** |
| Phrase recognition | Citrinet-256 LS by default, or AuroraASR-1M when the app selects it |

Both phrase models use INT8 weight storage and the same bounded phrase matcher.
The matcher compares the decoded text with a bank of 39 phrases. It checks text
distance, the margin over the next phrase, word count, and negation. It can
accept an approximate reading with a changed content word. The same recording
must pass the speaker and phrase checks. Changing the phrase model preserves
the ReDimNet enrollment and its cutoff.

The application chooses `transcriptionModel: 'citrinet'` or `'aurora'` in
`voiceIdAuthMethod()`. Citrinet is the default. The browser downloads the
selected phrase model, ReDimNet B1, Silero VAD, and their shared ONNX WASM engine
when a VoiceID action needs them. One indicator covers these downloads and the
following preparation stage. Assets have pinned sizes and SHA-256 digests.
Verified model bytes can be reused from Wallet-origin browser cache.
Interrupted downloads receive a bounded automatic retry. The prompt offers a
further retry while preserving the enrollment and valid cached assets.

| Phrase model | Model file | Gzip of model file | Approximate total cold assets before compression |
| --- | ---: | ---: | ---: |
| Citrinet INT8 | 10.48 MB | 8.84 MB | 36 MB |
| Aurora INT8 | 1.34 MB | 1.02 MB | 27 MB |

MB means 1,000,000 bytes. These totals include the shared engine and other
VoiceID assets. They measure package assets before compression. Transfer time
and browser memory depend on the host and device.
See the [Citrinet export and browser comparison](../tests/scripts/voiceid-citrinet/README.md)
and [Aurora export notes](../tests/scripts/voiceid-aurora/README.md).

## What the checks establish

The Wallet server verifies a signed assertion from the enrolled browser device
key. Wallet-origin code requires a local voice match before it uses that key.
The device signature proves key use. The server has no independent attestation
of the recording, speaker result, or microphone path. The phrase challenge adds
freshness. The finite bank leaves replay and synthetic speech resistance unproven.

Browser and Wallet contracts cover model integrity, enrollment, unlock,
reviewed testnet signing, cancellation, and retry. A paired browser check ran
both phrase models on the same synthetic recordings. It established export and
browser compatibility. Synthetic success does not measure acceptance for real
people. The small local human trials do not establish a general acceptance
rate, a wrong-speaker acceptance rate, or a liveness guarantee. The 0.45 speaker
cutoff and phrase bounds remain experimental.

## Potential improvements

1. **Raise genuine phrase acceptance with measured changes.** Collect short,
   consented sessions with the current microphone path. Rank failures by phrase
   and recognition reason. Compare candidate wording and model precision on the
   same recordings. Keep wrong-phrase and negation controls when changing the
   matcher. The requested usability target is above 90% owner acceptance;
   current evidence does not establish that target.
2. **Measure speaker and replay risk.** Gather separate speakers and later
   sessions before changing the 0.45 cutoff. Include playback and generated
   speech controls. Report owner rejection and wrong-speaker acceptance at the
   same decision point. Treat a short phrase match as one check, rather than a
   complete liveness proof.
3. **Check mobile cost.** Measure cold downloads, memory, and time from the end
   of a recording to a decision on mobile browsers. Keep the model choice and
   selected-only download behavior. Evaluate Aurora FP16 only if paired audio
   shows a useful gain over INT8; the larger weight file alone gives no
   accuracy result.
4. **Study stronger device proof if needed.** The browser device key proves
   possession of that key. A claim that hardware verified the voice would need
   a capture and attestation path that can make that claim. Hashing a voice
   template or recording on-chain would not provide it.
5. **Expand approval policy deliberately.** [Cross-method transaction approval](refactor-190-voiceid-cross-method-step-up-plan.md)
   remains a separate design. Any wider chain or operation scope needs its own
   review and signing-boundary checks. Applications can build voice commands
   separately and pass a short `confirmationCommand` after they construct a
   transaction.

The [Whisper integration plan](refactor-191-voiceid-whisper-turbo-plan.md) is
deferred by the user as of 2026-10-31. Browser integration will not proceed
because its roughly 602 MB download is too large for Wallet users. An API-backed
alternative voice modal remains a possible future option, with no approved
implementation or schedule.
