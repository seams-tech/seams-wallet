---
title: VoiceID
description: Understand VoiceID's local browser architecture, custody-envelope design, comparison with other biometric methods, setup, and security boundaries.
---

# VoiceID

VoiceID is an optional, **device-bound** browser authentication method.
The application enables support, and each wallet owner chooses whether to enroll on that browser.
Speaker matching and spoken-phrase verification run locally inside the isolated [Wallet iframe](/concepts/custody/wallet-iframe) with no audio or voiceprint egress.
The Wallet keeps its existing [split-custody](/concepts/custody/), [Wallet Session](/concepts/sessions/wallet-sessions), [policy](/concepts/policy/mandates), threshold signing, and key-export checks.

VoiceID unlocks and steps up sessions on the enrolled browser rather than acting as a cross-device biometric recovery key.
Because both the speaker template and non-extractable device keys stay inside that browser's `walletOrigin` storage, a public recording or remote voice clone cannot unlock the wallet from another machine.
Using a new device or clearing `walletOrigin` storage requires unlocking with an enrolled [passkey](/concepts/auth-methods/passkeys) or [Email OTP](/concepts/auth-methods/email-otp) first.

## Architecture and design

### Custody envelope resealing

VoiceID does not derive cryptographic keys directly from noisy voice embeddings.
Instead, owner-confirmed enrollment reseals the wallet custody seed into a method-bound `wallet_custody_envelope_v2` envelope under a fresh, full-entropy 256-bit random factor.

Decoupling biometric matching from cryptographic key entropy gives VoiceID three properties:

- **Full cryptographic key strength** — threshold derivation and Yao export envelopes stay protected by uniform 256-bit secrets rather than low-entropy fuzzy-extractor helper data.
- **Model and template independence** — adding speaker samples, resetting a voiceprint, or switching phrase models (`citrinet` and `aurora`) never rekeys NEAR accounts, EVM addresses, or server signing shares.
- **Per-device revocation** — removing a VoiceID method revokes that device's credential and custody envelope without invalidating the owner's vocal biometric or other enrolled factors.

### Local dual-model verification

Audio capture (`16 kHz` mono via a same-origin AudioWorklet) and ONNX Runtime Web WASM inference execute entirely inside `walletOrigin`:

| Stage | Model / check | Role |
| --- | --- | --- |
| Speech and quality gate | Silero VAD + level check | Rejects silence, clipping, and unusable audio before speaker or key operations run. |
| Speaker verification | ReDimNet B1 | Compares speaker embeddings against the enrolled template (experimental cosine cutoff **0.45**). |
| Phrase verification | Citrinet-256 LS (default) or AuroraASR-1M (INT8) | Checks that the same recording speaks the fresh challenge prompt from a 39-phrase bank. |

The phrase matcher tolerates common homophones and bounded natural-speech differences, requires a clear edit-distance margin over the runner-up phrase, and rejects flipped negations (`no`, `not`, `never`, `don't`, `without`) so negating a displayed prompt cannot approve an action.
Raw audio samples, decoded embeddings, and temporary template buffers are zeroed immediately after each check.

### Non-extractable device keys and domain separation

During enrollment, `walletOrigin` creates two non-extractable WebCrypto keys in IndexedDB for that wallet and auth method:

1. **Ed25519 device signing key** — signs server-verified challenges proving possession of the enrolled browser credential.
2. **AES-GCM-256 wrapping key** — encrypts the 32-byte random method factor at rest with `walletOrigin`, `walletId`, `walletAuthMethodId`, and `deviceKeyId` bound as additional authenticated data (AAD). The factor is decrypted only along a passing local voice check and zeroed after handoff to the custody worker or Yao client.

Session unlock (`seams:wallet-session:voiceid-device:v1`) and single-use sensitive operations (`seams:wallet-operation:voiceid-device:v1`, used for `near.export_key` and `evm.export_key`) sign distinct, domain-separated statements.
Neither proof can be replayed in place of the other.

### Host-composed plugin boundary

Applications that omit VoiceID—and passkey or Email OTP flows in applications that enable it—download no VoiceID code, WASM runtime, or models.
Application configuration cannot supply a plugin URL or executable code: the `walletOrigin` operator statically composes `/sdk/voiceid/*`, and the browser verifies asset byte lengths and SHA-256 digests before inference starts.

## How VoiceID compares

| Approach | Key and secret model | Biometric privacy | Revocation and upgrades | Primary trade-off |
| --- | --- | --- | --- | --- |
| **Cloud voice biometrics** | Server processes audio and issues a session | Raw audio and voiceprints live on vendor servers | Managed in server database | Central biometric honeypot and custodial trust |
| **Fuzzy extractors / ZK voice keys** | Derives keys directly from voice features and public helper data | Local proof generation | Cannot rotate a user's vocal tract if leaked | Steep entropy vs. false-rejection trade-off across mics or illness |
| **Passkeys (WebAuthn + PRF)** | Hardware or platform authenticator gates P-256 signatures and PRF output | Biometric never leaves OS / authenticator | Per-credential revocation | No voice modality; interrupts hands-free or conversational flows |
| **Seams VoiceID** | Local `walletOrigin` WASM checks gate non-extractable WebCrypto keys and a random envelope factor | Audio and templates stay in `walletOrigin`; audio is zeroed after use | Per-method revocation; ASR model changes keep enrollment | Software-enforced gate in `walletOrigin`; ~27–36 MB cold download |

VoiceID fits best as a modality-preserving unlock and step-up method alongside a passkey or Email OTP:

- **Conversational and AI-agent dApps** — approve NEAR transactions, intents, or contract calls by voice inside the trusted Wallet card without breaking a voice-first interaction.
- **Hands-free and accessibility workflows** — unlock sessions and confirm reviewed actions when touch or hardware security keys are impractical.

## Install and configure

Install matching package versions in your application. Replace `VERSION` with
the matching version from the [release notes](/releases):

```sh
pnpm add @seams/wallet@VERSION @seams/voiceid@VERSION
```

Import the descriptor from the optional package and add `authMethods` to your existing configuration.
This example enables NEAR and Arc testnets:

<<< ../../examples/voiceid.ts#configuration

Pass the configuration to `SeamsWebProvider` as shown in
[Wallet setup and authentication](/examples/wallet-setup-and-authentication#configure-the-provider).
Importing the descriptor and enabling support download no engine or models.
Passkey and Email OTP flows load no VoiceID assets.
Citrinet-256 LS is the default phrase model. Set
`voiceIdAuthMethod({ transcriptionModel: 'aurora' })` to use the smaller
AuroraASR-1M model. Only the selected phrase model downloads. Changing it
preserves saved speaker enrollment.

## Prepare the Wallet host

The operator serving `walletOrigin` must install both packages at matching versions.
If another operator hosts your Wallet, ask them to enable VoiceID on that origin.

Run this command from the host project after installing the packages:

```sh
npx --no-install seams-voiceid-host ./wallet-with-voiceid
```

The command finds the installed Wallet package automatically, including pnpm layouts.
It combines the Wallet assets and optional VoiceID assets in the named output directory.
Use a new output directory for each build. Existing directories and installed packages are never overwritten.

Deploy that directory as the static root at `walletOrigin`. It contains `/wallet-service`,
`/sdk/*`, and the asset manifest. Preserve the manifest's content types and cache headers.
See [hosted integration](/deploy-and-operate/hosted-integration) for the hosting requirements.

The host loads `/sdk/voiceid/host.js` only when an enabled VoiceID action needs it.
A missing or incompatible host installation produces a setup error.

## Enroll a wallet

The owner first unlocks the wallet with a passkey or Email OTP.
They can then open **Authentication methods → VoiceID** in the Wallet menu.
Your application can also provide an **Enable VoiceID** action:

<<< ../../examples/voiceid.ts#activation

Get `seams` from `useSeams()` inside your provider. Pass it with the current wallet ID to `enableVoiceId` after a user click.
The Wallet handles microphone permission and three accepted samples.
A rejected sample can be retried. Closing the surface returns `kind: 'cancelled'`.
Successful enrollment returns `walletAuthMethodId` and preserves the current authentication method.
Calling activation again for an enrolled method opens **Manage voice**.

## Unlock and sign {#unlock-and-approve-transfers}

The owner can select VoiceID in the Wallet sign-in menu. A custom unlock action uses
the wallet ID and the enrolled `walletAuthMethodId`:

<<< ../../examples/voiceid.ts#unlock

To unlock, the owner reads the displayed short English phrase at a normal pace.
The experimental speaker similarity threshold is **0.45**.
Phrase recognition allows bounded differences to handle natural speech.
The displayed phrase checks freshness.

VoiceID works like a passkey. A VoiceID unlock opens a normal signing session. Use the
existing [transaction APIs](/examples/signing) on any chain and network: transfers, contract
calls, delegate actions, and message signing. Each operation shows the ordinary **Confirm**,
with no further voice check, within the session's uses and expiry.
When the session runs out or expires, the next operation asks for VoiceID again inside the
Wallet, then signs. A transaction asks inside its own confirm card: the card shows
**Confirm with VoiceID**, the voice capture replaces the review in the same card, and the
card then turns into the receipt. A VoiceID session never asks for a passkey. Key export asks for one more
voice check inside the Wallet, bound to that export, and never for a passkey or Email OTP.

Enabling or enrolling VoiceID does not select it for passkey or Email OTP signing.
Adding signers or authentication methods and changing enrollment retain their action-level authorization checks.

## Loading and storage

The first VoiceID operation downloads about **36 MB with Citrinet**, or
**27 MB with Aurora**, before transfer compression.
One progress indicator covers the engine, speaker model, speech detector, and selected phrase model. It then shows **Preparing VoiceID…** until inference is ready.
Verified assets are cached when browser storage permits. Clearing site data or browser eviction can require another download.

Audio stays local and is discarded after processing. The Wallet origin stores the enrollment template and device credentials.
Saved enrollment and added samples have no time or usage limit.
Removing the enrollment or clearing Wallet-origin storage requires enrollment again.
**Manage voice** provides recognition improvements, reset, and re-recording with fresh owner confirmation.

## Security boundaries

- **Software-enforced local gate** — Unlike a hardware-backed passkey authenticator, the Wallet server verifies the enrolled browser's Ed25519 signature rather than a hardware or TEE attestation of the microphone path or speaker score. Trusted `walletOrigin` code enforces the voice match before invoking the non-extractable WebCrypto keys. Cross-origin iframe isolation protects this gate from an untrusted `appOrigin`, whereas script execution inside `walletOrigin`, privileged browser debugging extensions, or local OS compromise could invoke those browser keys directly.
- **Physical device control and local playback assumptions** — Binding VoiceID to non-extractable browser keys blocks remote attackers from unlocking a wallet with public audio clips or synthesized voice clones from another device. Locally, `walletOrigin` requires a visible, focused Wallet prompt and an active user gesture (**Record**) before opening the microphone and displaying the challenge phrase—an app or nearby speaker cannot silently trigger capture in the background. VoiceID therefore assumes the owner maintains **physical control of their unlocked device**: while the owner is present, someone attempting to trigger a prompt, read the displayed phrase, and play cloned or recorded audio into the microphone is visibly and audibly observable. If an attacker instead gains **unattended physical or shared-session access** to an unlocked enrolled browser, the 39-phrase bank and experimental **0.45** speaker threshold do not guarantee liveness against recorded playback or synthetic speech. Lock the OS session when stepping away and do not enroll VoiceID on shared or public machines.
- **Policy and backup factors** — Scope VoiceID sessions with appropriate [Wallet Session](/concepts/sessions/wallet-sessions) quotas and [mandates](/concepts/policy/mandates) for mainnet value, and keep a [passkey](/concepts/auth-methods/passkeys) or [Email OTP](/concepts/auth-methods/email-otp) available for cross-device access and enrollment management.

Read next:

- [Wallet iframe](/concepts/custody/wallet-iframe)
- [Custody model](/concepts/custody/)
- [Recovery and export](/concepts/custody/recovery-and-export)
- [Passkeys](/concepts/auth-methods/passkeys)
