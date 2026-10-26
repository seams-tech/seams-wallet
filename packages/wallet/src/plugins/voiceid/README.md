# Browser VoiceID plugin

Enable with `authMethods: [voiceIdAuthMethod()]`. The descriptor is small and
loads no model code. The trusted Wallet registry loads `host.ts` on first use.
The plugin owns browser microphone capture, three-sample enrollment, ReDimNet B1
speaker matching, AuroraASR phrase recognition, WebCrypto device credentials, and the existing server proof
exchange. SDK core owns custody installation, quotas, and NEAR MPC signing.

Availability and selection are separate. Configuring the descriptor does not apply
voice approval to passkey or Email OTP signing. The Wallet selects policy from the
requested wallet's trusted authority selection. Enrolling VoiceID does not change
the current owner method. Unlock with VoiceID to select voice approval; unlock with
a passkey to return to passkey signing. Built-in methods do not load the VoiceID
entry or inference assets, including after a reload with an enrolled voice method.
A signing lane must match its review policy, so a method change cannot reuse an
incompatible approval. Omitting the plugin while VoiceID is selected rejects the
operation; it cannot silently bypass voice approval.


After a passkey or Email OTP owner unlock, call
`registration.activateAuthMethod({ walletId, method: 'voiceid' })`.
It resolves with `{ kind: 'activated', walletId, walletAuthMethodId }`, or with
`{ kind: 'cancelled' }` when the person closes the Wallet surface.
The Wallet requests microphone permission and enrolls this wallet method through three
Record clicks. For an existing method, the same command opens Manage voice. Later use `auth.unlockWithAuthMethod` with that wallet and method
ID. A VoiceID-selected NEAR testnet transfer requires Confirm and a fresh voice match.
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
Voice-only unlock cannot use it. The user must first unlock with a passkey and
select Manage voice, then Record voice again. Activation reuses an existing local device
credential for that wallet and authority, then replaces the speaker template only
after all three samples succeed. It does not create another server method or change
the existing custody envelope. Cancellation preserves the prior stored record.

## Manual adaptive enrollment

Manage voice shows whether the enrollment is original or improved, and the
remaining checks and time of an improvement. It provides Improve recognition,
Reset improvements, and Record voice again, and shows only the actions that apply.
Each action requires a fresh passkey confirmation. The trusted
Wallet validates the assertion's signature, challenge, origin, RP ID, user presence,
and user verification. ES256 passkey credentials use the existing public-key crypto
worker for COSE and signature decoding, then WebCrypto for signature verification. No credential PRF
output is requested. Confirmation authorizes one local enrollment change only.
Both ES256 and RS256 passkey credentials are supported. RS256 uses WebCrypto and
the existing small CBOR dependency for its RSA public key. These are passkey algorithms.
Wallet transaction signers remain ECDSA/secp256k1 and Ed25519. VoiceID signing currently
supports Ed25519-Yao NEAR testnet transfers. The server must still recognize the
same owner session before confirmation and before saving; no signing quota is consumed.

Enrollment storage binds wallet, authority, method, and device key. An atomic commit
checks owner selection, lock generation, availability revision, and enrollment
generation/revision. A competing update cannot be overwritten. Capture watches
owner lifecycle changes and releases the microphone if the action becomes invalid.

Three accepted supplements contribute 20% of the effective template; the immutable
baseline contributes 80%. Each supplement must match the baseline at 0.5. The final
template must stay within cosine 0.98 of the baseline. Supplements expire after
24 hours or 32 template uses. Reset preserves the baseline. Re-recording creates a
new baseline generation. These are bounded experimental settings, not calibrated
accuracy or false-acceptance guarantees. Automatic learning is not implemented.

Old browser-wide records cannot authenticate directly. Manage voice offers an
explicit, passkey-confirmed import for the selected method. This migration boundary
is the only reader of the old record. Other wallets require their own import or
enrollment. Import deletes it once all known active VoiceID methods have scoped records.

No additional model weights are needed. Fresh passkey confirmation can load the
existing crypto worker and WASM if uncached: about 1.34 MB uncompressed or 0.31 MB
with local gzip compression, plus management JavaScript. This is separate from the
26.86 MB uncompressed voice models and inference runtime. Actual network transfer
depends on compression and caching. The local enrollment record has a 32 KiB limit.

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
sentences of 6–7 words, targeting about two seconds or more at a normal pace.
Each attempt holds its displayed sentence until recording ends. Retries
select another phrase. Read naturally, then pause. Capture stops after 1.5 seconds
of quiet once audible input has continued for 100 ms. Initial silence does not
stop capture. An eight-second maximum bounds silence, continued noise, and
recordings where live analysis is unavailable. Both speaker and phrase checks use the same recording.
Existing B1 enrollment remains valid. Aurora adds a separate phrase check.

Aurora decodes the audio independently of the displayed phrase. The matcher compares
that text with all 16 phrases. It ignores case, punctuation, and articles, and maps
selected homophones to a common spelling. It permits at most 30% normalized character
edit distance, requires a 10-point distance margin over the next candidate, and
limits decoded word count to within two words of the candidate. Detected negations
reject. These are development bounds for an approximate challenge. Some changed
content words can pass; this check does not interpret transaction intent.
A different recognized phrase, ambiguity, or an out-of-bounds result prevents
enrollment, device-key use, or signing. The speaker threshold remains 0.5. A signing retry
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
Unlock starts listening automatically after preparation. The initial Unlock with
VoiceID action opens this flow. Back cancels capture and returns to the login menu.
Retries require Try again. The card uses the wallet's Back icon and Seams wordmark,
with one rounded surface and a transparent activation container.
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

The prompt combines a thin, four-layer flowing ribbon with the SDK's existing
VoiceBeam glow. Both use the recorder's activity levels; neither opens an audio
graph or requests a microphone. Speech drives full movement and ambient sound
is restrained. The ribbon settles when recording ends and the glow indicates
processing. Reduced motion removes ribbon travel and the glow honors the system
preference. Disposal cancels the ribbon clock and unmounts the glow.
The visual is loaded through the optional VoiceID host module. It cannot grant
approval or change capture, phrase, speaker, or signing policy.

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


## Settings and SeamsAuthMenu

The VoiceID card in Authentication methods shows the enable/disable switch, the
state in this browser, and **Manage voice**.
Management requires an enabled VoiceID method and a selected passkey owner session. Use
`registration.getAuthMethodAvailability({ walletId, method: 'voiceid' })` to read
`not_enrolled`, `enabled`, or `disabled`. Use
`registration.setAuthMethodEnabled({ walletId, method: 'voiceid', enabled })`
to change the browser preference. It preserves enrollment. Enable requires an
owner passkey or Email OTP session. Disable requires another active method and
locks a current VoiceID session. Existing enrollments without a preference start
enabled at the persistence boundary. Removal is a separate revocation action.

The login menu lists a wallet once, with its available methods below. Discovery
reads local metadata without loading the voice models. Voice login uses the menu's
measurement and cancellation channel; the old menu is hidden and inert during
capture. Back restores it. The minimal signing prompt is unchanged, with an
explicit “Confirm with VoiceID” review button. Capture remains click initiated.

## Background noise

Silero VAD adds 2,327,524 bytes, loaded only with VoiceID and cached with integrity
verification. Browser noise suppression, echo cancellation, and automatic gain
control remain requested. Recording details show the actual reported settings,
including unknown settings when the browser does not report them.

Speech detection replaces volume alone for pause detection and clip qualification.
It retains the 1.5-second pause and eight-second recording cap. Speech probability
must reach 0.5 and the original minimum volume must also pass. The speaker
threshold remains 0.5; the independent phrase-score limit remains 8.

Noise estimates compare frames classified as speech with other frames. They are
approximate guidance, not a calibrated acoustic SNR or an authorization decision.
Nearby conversation can still register as speech. No extra denoiser is shipped.
See `tests/scripts/voiceid-noise/README.md` for model provisioning and evaluation.
