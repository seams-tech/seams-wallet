# Browser VoiceID plugin

Enable with `authMethods: [voiceIdAuthMethod()]`. The descriptor is small and
loads no model code. The trusted Wallet registry loads `host.ts` on first use.
The plugin owns browser microphone capture, three-sample enrollment, ECAPA
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
`packages/wallet/assets/voiceid/ecapa.onnx` before building the SDK. The existing
static-asset build includes it and the matching ONNX Runtime Web WASM files.
If the optional model is absent, ordinary Wallet builds still work, and enabling
VoiceID reports that its model is unavailable. Release builds offering VoiceID
must provision this asset. It is not fetched from a third party during capture.

Current model: SpeechBrain `spkrec-ecapa-voxceleb`, Apache-2.0, upstream revision
`0f99f2d0ebe89ac095bcc5903c4dd8f72b367286`. The export accepts 16 kHz mono PCM and
returns a normalized 192-dimensional embedding. Model bytes: 83,533,672.
SHA-256: `0d56d37287767d3c43a4f2ffc7ed12452bdd73d67c40428acd78279ecff8d5c3`.
The plugin verifies this digest before inference. This prototype uses the existing
verified export from the model evaluation workflow. A reproducible public model
export/distribution step remains required before publishing this package.

To replace the implementation, preserve `WalletAuthMethodHostPlugin`, the device
assertion contract, and method-bound custody envelopes. To remove VoiceID, remove
its registry entry, descriptor exports, implementation directory, ONNX dependency,
and optional assets. Omitting the descriptor prevents runtime use and downloads.

## Smaller models and spoken phrases

See the [model candidate evaluation plan](../../../../../docs/voiceid-model-candidates.md)
for verified download sizes, speaker-verification and STT shortlists, licensing,
and qualification criteria. These are research candidates. The current plugin
continues to use the pinned ECAPA model and does not transcribe spoken phrases.
