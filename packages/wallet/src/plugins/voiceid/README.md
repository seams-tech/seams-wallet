# Browser VoiceID plugin

Enable with `authMethods: [voiceIdAuthMethod()]`. The descriptor is small and
loads no model code. The trusted Wallet registry loads `host.ts` on first use.
The plugin owns browser microphone capture, three-sample enrollment, ReDimNet B1
speaker matching, AuroraASR phrase recognition, WebCrypto device credentials, and the existing server proof
exchange. SDK core owns custody installation, quotas, and NEAR MPC signing.

After a passkey or Email OTP owner unlock, call
`registration.activateAuthMethod({ walletId, method: 'voiceid' })`.
The Wallet requests microphone permission and enrolls this browser through three
Record clicks. Later use `auth.unlockWithAuthMethod` with that wallet and method
ID. A reviewed NEAR testnet transfer requires Confirm and a fresh voice match.
The button confirms intent. Read the displayed phrase at a normal pace. Use Cancel to cancel.

`browser/` contains capture, model inference, enrollment, and device storage.
No native service, extension, Keychain, or OS settings are required. The model
loads only when enabled VoiceID needs inference. Audio stays local and is
discarded after processing. Browser storage retains the template, nonextractable
Ed25519 and AES-GCM keys, and encrypted random factor. Clearing Wallet-origin
storage requires owner unlock and enrollment again. Nonextractability does not
prevent trusted Wallet-origin code from using a key; server verification proves
device-key possession, and the Wallet code enforces speaker and phrase matching.

## Hosted model asset

Place the approved exports at `packages/wallet/assets/voiceid/redimnet-b1.onnx`
and `packages/wallet/assets/voiceid/aurora-int8.onnx` before building the SDK. The existing
static-asset build includes it and the matching ONNX Runtime Web WASM files.
If the optional model is absent, ordinary Wallet builds still work, and enabling
VoiceID reports that its model is unavailable. Release builds offering VoiceID
must provision both assets. It is not fetched from a third party during capture.

Current model: ReDimNet B1, VoxCeleb2 large-margin fine-tuned, MIT license.
Source revision: `ce039a624cb99fe127702ceb94c6080090e5032f`.
Weight revision: `5180983b6895dafa0cd88aa88e8a07296df27834`.
The full-waveform export accepts 16 kHz mono PCM and returns a normalized
192-dimensional embedding. Model bytes: 8,859,593.
SHA-256: `e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269`.
The deployment includes the model's MIT attribution and export details in NOTICE.txt.
Use the pinned exporter in `tests/scripts/voiceid-model-evaluation/prepare.py`
to reproduce the model. The browser evaluation evidence records parity checks.

The prototype uses a B1 threshold of 0.5: the next tenth above the four-second
calibration cohort's maximum impostor score (0.4417). The separate evaluation
cohort had 0/728 false accepts and 2/56 false rejects at this threshold. This small
clean-speech experiment does not qualify production authentication accuracy.

AuroraASR-1M checks the spoken phrase. Its INT8 full-waveform ONNX export is
1,342,384 bytes and shares the existing WASM runtime. It accepts 16 kHz mono PCM.
Source revision: `cd307b54b4d666d6ad7dc982a7a58a96d6e7f942`.
SHA-256: `83ed6f3856458cd96d49a70d8c5175aeec18ba8c184e5367e089cd424eebefd6`.
The deployment includes its Apache-2.0 license and export details.
See [export and screening instructions](../../../../../tests/scripts/voiceid-aurora/README.md).

## Download progress and browser cache

First activation shows an accessible progress bar with bytes and percentage while
each model downloads. Enrollment recording becomes available after preparation.
The trusted Wallet origin stores only hash-verified model bytes in Cache Storage,
under a key containing the model digest. A reload reads and verifies that cached
copy before loading inference. The normal HTTP cache also applies to runtime assets.

Storage can be unavailable or full. In that case inference continues for the
current session and the UI explains that the model could not be saved. Clearing
site data or browser eviction can require another download. A corrupted cached
model is discarded and downloaded again. Failed loads remain retryable.

## Re-enrollment after a model change

The persistence boundary treats an enrollment for a different model as unavailable.
Voice-only unlock cannot use it. The user must first unlock with a passkey or Email
OTP and select Enroll voice again. Activation reuses an existing local device
credential for that wallet and authority, then replaces the speaker template only
after all three samples succeed. It does not create another server method or change
the existing custody envelope. Cancellation preserves the prior stored record.

To replace the implementation, preserve `WalletAuthMethodHostPlugin`, the device
assertion contract, and method-bound custody envelopes. To remove VoiceID, remove
its registry entry, descriptor exports, implementation directory, ONNX dependency,
and optional assets. Omitting the descriptor prevents runtime use and downloads.

## Smaller models and spoken phrases

See the [model candidate evaluation plan](../../../../../docs/voiceid-model-candidates.md)
for verified download sizes, speaker-verification and STT shortlists, licensing,
and qualification criteria. The prototype uses pinned B1 and AuroraASR exports.

## Prompt and preparation

Enrollment, unlock, and transfer approval randomly select one of 16 short English
phrases. Each attempt holds its displayed phrase until recording ends. Retries
select another phrase. Read naturally, then pause. Capture stops after 1.5 seconds
of quiet once audible input has continued for 100 ms. Initial silence does not
stop capture. An eight-second maximum bounds silence, continued noise, and
recordings where live analysis is unavailable. Both speaker and phrase checks use the same recording.
Existing B1 enrollment remains valid. Aurora adds a separate phrase check.

The decoder scores all 16 phrases before comparing its result with the displayed
phrase. It also compares the best phrase score against unconstrained recognition.
The prototype accepts a log-likelihood gap of at most 5. This is a development
cutoff, with synthetic screening evidence. It needs human accuracy qualification.
A wrong phrase prevents enrollment, device-key use, or signing. A signing retry
keeps the original transaction review and deadline and requires another Confirm.
No audio or transcript leaves the browser or enters persistent storage.

The finite phrase bank does not establish replay resistance or liveness. The MVP
still assumes physical possession of an open, active device. Spoof detection stays
outside scope. See [screening results](../../../../../docs/evidence/voiceid-aurora-20261024/README.md).

The prompt reports its dimensions through the Wallet request measurement binding.
This reveals the parent modal immediately after layout, without its four-second
fallback. The reporter watches the stable outer section during enrollment changes
and disconnects when the prompt closes.

The lazy host entry contains the prompt shell. It mounts the modal and yields a
frame before importing the unlock or activation implementation. The card shows
Preparing VoiceID and allows cancellation while its recording button is disabled.
Unlock then prepares its core session installer, including lock cleanup and a new
lock generation. It checks local state, loads the cached model if needed, and
requests its server challenge. Model progress appears inside the same card.
The lightweight shell itself still needs its first module download.
Cancellation aborts the challenge request and prevents late UI or recording.
Shared model loading can finish and populate the cache after cancellation.

## Minimal capture UI

Enrollment, unlock, and signing share the plugin-owned `VoicePrompt`. The card shows
Read aloud, a large phrase, a live waveform, a short status, and Cancel. Enrollment
also shows the sample number and a Record control between samples. The record
control disappears during capture. Download details disappear when preparation ends.

After transaction Confirm, the Wallet replaces the review contents with the plugin's
trusted DOM surface. The Wallet retains its modal, cancellation, expiry, and review
binding. A mismatch returns to the original review and requires another Confirm.
The core host loads no VoiceID UI code when the plugin is disabled.

The waveform observes the existing MediaRecorder stream. It does not request or
stop another microphone stream. A continuous display curve preserves volume detail.
The meter closes its AudioContext after capture, error, or cancellation. Model audio,
gain control, phrase thresholds, and speaker thresholds are unchanged. The visual
meter cannot grant approval. Voice and phrase matches still gate signing.

## Recording quality feedback

Short or quiet recordings stay in the unlock prompt with Try again. The original
server challenge and expiry timer remain unchanged. Only typed insufficient-audio
results can take this path. A retry displays a new phrase before capture starts.
The normal phrase and speaker checks still apply before device-key use.

Recording details show the actual input label, decoded duration, wall-clock
recording time, stop reason, qualifying frame duration, and peak frame RMS. The
level threshold is 0.006. The quality precheck requires 600 ms of qualifying audio.
Aurora phrase and B1 speaker thresholds are unchanged. This energy proxy cannot generally separate
short speech from quiet or suppressed speech. Each measurement has an attempt ID
and timestamp. No audio or transcript is saved or sent by these diagnostics.
