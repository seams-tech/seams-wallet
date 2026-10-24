# Browser VoiceID plugin

Enable with `authMethods: [voiceIdAuthMethod()]`. The descriptor is small and
loads no model code. The trusted Wallet registry loads `host.ts` on first use.
The plugin owns browser microphone capture, three-sample enrollment, ReDimNet B1
speaker matching, WebCrypto device credentials, and the existing server proof
exchange. SDK core owns custody installation, quotas, and NEAR MPC signing.

After a passkey or Email OTP owner unlock, call
`registration.activateAuthMethod({ walletId, method: 'voiceid' })`.
The Wallet requests microphone permission and enrolls this browser through three
Record clicks. Later use `auth.unlockWithAuthMethod` with that wallet and method
ID. A reviewed NEAR testnet transfer requires Confirm and a fresh voice match.
The button confirms intent. Words are not transcribed; use Cancel to cancel.

`browser/` contains capture, model inference, enrollment, and device storage.
No native service, extension, Keychain, or OS settings are required. The model
loads only when enabled VoiceID needs inference. Audio stays local and is
discarded after processing. Browser storage retains the template, nonextractable
Ed25519 and AES-GCM keys, and encrypted random factor. Clearing Wallet-origin
storage requires owner unlock and enrollment again. Nonextractability does not
prevent trusted Wallet-origin code from using a key; server verification proves
device-key possession, and the Wallet code enforces speaker matching.

## Hosted model asset

Place the approved full-waveform ECAPA export at
`packages/wallet/assets/voiceid/redimnet-b1.onnx` before building the SDK. The existing
static-asset build includes it and the matching ONNX Runtime Web WASM files.
If the optional model is absent, ordinary Wallet builds still work, and enabling
VoiceID reports that its model is unavailable. Release builds offering VoiceID
must provision this asset. It is not fetched from a third party during capture.

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

## Download progress and browser cache

First activation shows an accessible progress bar with bytes and percentage while
the model downloads. Enrollment recording becomes available after preparation.
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
and qualification criteria. The current prototype uses the pinned B1 model. Spoken-phrase transcription
remains unimplemented.

## Prompt and preparation

Enrollment, unlock, and transfer approval use “My voice unlocks my wallet.”
Speak slowly for about three seconds. This text is a recording aid; words are
not transcribed. Existing B1 enrollment remains valid after this wording change.

The capture modal mounts before plugin preparation. It shows Preparing VoiceID
and allows cancellation while its recording button is disabled. Unlock then checks
local state, loads the cached model if needed, and requests its server challenge.
Cancellation aborts the challenge request and prevents late UI or recording.
Shared model loading can finish and populate the cache after cancellation.
