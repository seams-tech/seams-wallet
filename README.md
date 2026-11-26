# Seams Wallet

Open-source browser and server Wallet SDKs, signer runtimes, Rust/Wasm
implementation crates, documentation, examples, and recovery CLI.

SDK version: **0.76.0**. [Read the documentation](https://docs.wallet.seams.sh/) or start with the [release notes](./apps/docs/src/releases.md).

From the next release, the packages are:

- `@seams/mpc-wallet` — the embedded MPC wallet: browser SDK, React components and the VoiceID page code. It includes Speak-to-Sign: experimental, testnet-only NEAR signing by voice, which needs VoiceID.
- `@seams/wallet-connect` — connectors for existing EVM and NEAR wallets, with no Seams account or custody.
- `@seams/host` — the services that an operator deploys: the Wallet Gateway, packaged Worker runtimes, migrations, the wallet origin document and the VoiceID host plugin.
- `@seams/cli@0.29.0` — the recovery CLI launcher, with its signed native release;
  see the [recovery CLI](./apps/docs/src/deploy-and-operate/recovery-cli.md).

They replace `@seams/wallet`, `@seams/wallet-server`, `@seams/voiceid` and `@seams/wallet-cli`
(see "Next release" below).

Seams Wallet is licensed under Apache-2.0. See `LICENSE.md`.

The browser and server SDKs use wallet iframe protocol `25.0.0`. Upgrade the browser
SDK, wallet-origin assets, server SDK, and enabled VoiceID plugin together.
The browser SDK, server SDK and VoiceID plugin use version **0.76.0**.
The signed recovery CLI remains at **0.29.0**.
See [release notes](./apps/docs/src/releases.md) and the
[hosted integration guide](./apps/docs/src/deploy-and-operate/hosted-integration.md)
for changes and deployment requirements. The development checkout can contain
changes that npm does not yet publish.

The hosted Seams Console, the Wallet site, and deployment configuration live
in the `seams-tech/seams-console` repository.

## Next release (not released yet)

- Passkeys: the server requires user verification (a PIN, a biometric or a device passcode) for every passkey registration and assertion. A ceremony that is valid in every other way but has no user verification fails with the new code `user_verification_required`, and the Wallet tells the user to use a passkey with a PIN or biometric, or to set a PIN on the security key. The Wallet asks for `userVerification: 'required'` in every passkey prompt.
- Breaking: a security key with no PIN can no longer register a passkey, sign in, unlock, sign or run an owner operation.
- Breaking: the add-method, device-link and recovery passkey options carry `authenticatorSelection.userVerification: 'required'`, and the Wallet accepts only that value. Deploy the server and the Wallet host together.
- Breaking: `webauthn.authenticatorOptions.userVerification` and the `UserVerificationPolicy` enum are removed. The field had no effect.
- Breaking: the packages have new names (Refactor 251, Release A). The code works as before; the names, the paths and the package boundaries change. `@seams/wallet` becomes `@seams/mpc-wallet`, `@seams/wallet-server` becomes `@seams/host`, and `@seams/wallet-cli` becomes `@seams/cli` with the same `seams-wallet` command. `@seams/voiceid` is not published any more: its page code is in `@seams/mpc-wallet`, and its host plugin and models are in `@seams/host`. The connectors for existing wallets move to the new `@seams/wallet-connect`, which imports no Seams auth or MPC wallet code.
- Breaking: no package has a root import. Each import says where its code runs:

| Import before | Import now |
| --- | --- |
| `@seams/wallet` | `@seams/mpc-wallet/client` |
| `@seams/wallet/advanced` | `@seams/mpc-wallet/client` |
| `@seams/wallet/threshold` | `@seams/mpc-wallet/client` |
| `@seams/wallet/runtime` | `@seams/mpc-wallet/client` |
| `@seams/wallet/react` | `@seams/mpc-wallet/react` |
| `@seams/wallet/react/profile` | `@seams/mpc-wallet/react` |
| `@seams/wallet/react/hosted-seams-auth-menu` | `@seams/mpc-wallet/react` |
| `@seams/wallet/react/provider` | `@seams/mpc-wallet/react` |
| `@seams/wallet/react/styles` | `@seams/mpc-wallet/styles.css` |
| `@seams/wallet/voiceid-host` | `@seams/mpc-wallet/voiceid` |
| `@seams/wallet/external-evm` | `@seams/wallet-connect/client` |
| `@seams/wallet/external-near` | `@seams/wallet-connect/client` |
| `@seams/wallet/react/external-evm` | `@seams/wallet-connect/react` |
| `@seams/wallet/react/external-near` | `@seams/wallet-connect/react` |
| `@seams/wallet/web/wallet-iframe-client-html` | `@seams/host/wallet-origin-html` |
| `@seams/voiceid` | `@seams/mpc-wallet/voiceid` |
| `@seams/voiceid/react` | `@seams/mpc-wallet/react` |
| `@seams/voiceid/styles` | `@seams/mpc-wallet/styles.css` |
| `@seams/voiceid/hosting` | `@seams/host/voiceid` |
| `@seams/wallet-server` | `@seams/host/server-types` |
| `@seams/wallet-server/application-auth` | `@seams/mpc-wallet/server` |
| `@seams/wallet-server/<path>` (each other path) | `@seams/host/<path>` (the same path) |
| `@seams/wallet-cli` | `@seams/cli` |

- Breaking: the default exports of `@seams/wallet/react/provider` and `@seams/wallet/react/hosted-seams-auth-menu` are gone with those paths. Import `SeamsWebProvider` and `HostedSeamsAuthMenu` by name from `@seams/mpc-wallet/react`. That path also loads the component stylesheets, so import it through a bundler, also for server-side rendering.
- `@seams/mpc-wallet` names `@seams/wallet-connect` as a peer, because the hosted auth menu takes its controllers as wallet alternatives. It also depends on `voice-glow` for `VoiceBeam`. Install the four packages at one version.
- The connector pickers draw their own theme boundary and no longer read the `Theme` tokens of the React package. They look the same; their boundary element has no `data-seams-theme`, `lang` or token variables. Their colours come from the `--seams-wallet-picker-*` CSS variables, as before.
- The wallet asset manifest names `@seams/mpc-wallet`, and the host artifact manifest names `@seams/host`. `seams-voiceid-host` and `composeVoiceIdWalletAssets` come from `@seams/host`; the other `seams-wallet-server-*` commands keep their names.
- The old names get npm deprecation messages that name the new packages.

## Release 0.76.0

- Email OTP: the enrollment of a wallet keeps one factor for each Email OTP method, each with its own nonce, wrapped factor and pinned unlock key. The release picks the factor whose nonce the device sends. A revoke removes the method's factor in the same commit, also when a linked device is revoked, and the enrollment goes with its last factor or method.
- Email OTP: Google recovery works on a new device again. The recovery code opens the seed, and the device enrolls its own Email OTP factor for the recovered method, so the server releases no factor. The factors of the wallet's other devices stay.
- Email OTP: a linked device enrolls its own Email OTP factor, also on a wallet that has Email OTP. The code goes to the wallet's Email OTP address, which the new device must enter, and the link adds the device's factor to the enrollment. The server releases no factor of another device.
- Breaking: `/wallets/recovery/email-otp/release` is gone. `/wallets/recovery/email-otp/verify` also returns `providerSubject` and `verifiedEmail`. `/wallets/recovery/google-email-otp/finalize` requires `emailOtpEnrollment`, which is now the enrollment material itself, with no `kind` wrapper.
- Breaking: the device-link route `/email-otp-base-factor` is gone, with the base method chooser. `QRCodeScanner` and `useDeviceLinking` no longer take `onEmailOtpBaseFactorRequired`. A device-link approval and target preparation for Email OTP carry only `targetEmail`, the challenge start has no `workerEphemeralPublicKey65B64u`, the verification result has no `factorRelease`, and an Email OTP target registration always carries `emailOtpEnrollment`. The add-method `emailOtpTarget` of kind `existing_enrollment` now carries `enrollment` too.
- Email OTP: on a device that holds no Email OTP key for the wallet, a Google or email sign-in sends no code. It fails with the new code `email_otp_device_factor_missing`, which carries the wallet ID and the email hint in `account`. The hosted menu then offers "Link this device" and "Recover wallet".
- Fix: an Email OTP owner sees the Wallet's email code prompt when removing a sign-in method or a linked device, and when moving a wallet to another region. The prompt stayed hidden, so the request failed after its timeout.
- Reset: Email OTP wallets made by 0.75.0 do not open after the upgrade, because the stored enrollment changed.
- Deploy: apply D1 migration `0091_linked_device_email_otp_own_factor.sql` before the server. It drops the open device-link Email OTP grants, so such a link asks for a new code. Then ship the server and the Wallet host together, then the apps: a 0.76.0 server has no Email OTP recovery release and no base-factor route for a 0.75 Wallet host, and a 0.76.0 Wallet host uses the new recovery and device-link contracts.
- Compatibility: an app at 0.76.0 needs a Wallet host at 0.76.0. A Wallet host at 0.76.0 accepts an app at 0.74 or 0.75. The Wallet iframe protocol stays **25.0.0**, and the VoiceID host API stays 11. The voice libraries stay at **0.72.0**. Install all three packages at 0.76.0.

## Release 0.75.0

- Email OTP is a device factor. The device keeps a random input, and the server keeps a factor nonce and the factor encrypted under the RFC 9497 POPRF output (ristretto255-SHA512) for that input. The server cannot compute that output without the device, so neither the server nor the device alone can open an Email OTP wallet. The POPRF `info` names the wallet, the enrollment and the server-chosen nonce. A new WASM module, `oprf_runtime`, serves the Email OTP worker and the Gateway.
- Email OTP: the server stores each code encrypted (AES-256-GCM, bound to its challenge), never in plain text. The key comes from the Email OTP seal root (`SIGNING_SESSION_SEAL_ROOT_SECRET_B64U`), so no new secret is needed. Delivery, resend and the dev outbox do not change.
- Signing-session seal: the warm session that survives a page reload is sealed with the same RFC 9497 POPRF in place of Shamir three-pass. The device keeps a random input and the session secret under AES-256-GCM, with a key from the POPRF output. The POPRF `info` names the wallet and the threshold session. A restore is one server call. The `shamir3pass_runtime` module and its nested worker are gone.
- Stricter checks: the server and the SDK refuse a bad signing count, signer slot, participant ID, step-up expiry or key-envelope binding instead of filling in a default. A NEAR RPC error such as `{"InvalidTxError":"Expired"}` keeps its name. A Wallet Session whose authority row is gone reads as ended, not corrupt.
- Fix: the Email OTP export and rotation no longer send the seal group as `orgId` in `/wallet/unlock/challenge`.
- Breaking: `/wallet/email-otp/registration/seal` is now `/wallet/email-otp/registration/factor`, which takes a blinded element. The factor release, the Ed25519 step-up material recovery and the Google recovery release take `deviceFactors` in place of a worker public key, and they return an `email_otp_factor_evaluation_v1`. The enrollment material carries `factorNonceB64u` and `wrappedFactorB64u`.
- Breaking: `/wallet-session/seal/apply-server-seal` and `/wallet-session/seal/remove-server-seal` are now one route, `POST /wallet-session/seal/evaluate`, which takes a blinded element. The server allows 30 evaluations a minute for each wallet and threshold session. The seal protocol in `/.well-known/webauthn` is `{ algorithm: 'ristretto255-sha512-poprf-v1' }` with no `groupId`. The registration `sessionSeal` carries `blindedElementB64u`, and the Email OTP login options have no `groupId`.
- Breaking: `@seams/wallet-server` exports `createSigningSessionSealEvaluator` in place of the seal cipher adapters and their Shamir three-pass types, and `parseSigningSessionSealRootConfig` is gone. `createSigningSessionSealOptions` keeps its input.
- Email OTP on a new device: a device-link target cannot reuse the wallet's Email OTP factor, and Google recovery of an Email OTP wallet works only on a device that holds the factor. Choose a passkey or VoiceID for the new device, or use the recovery code. A later change gives each device its own factor.
- Reset: Email OTP wallets from an earlier version do not open after the upgrade. The Wallet deletes the sealed warm sessions of an earlier version when it reads them, so each open session needs one unlock.
- Deploy: apply D1 migration `0090_email_otp_code_seal.sql` before the server. It drops the open Email OTP challenges, so a code that is open at the deploy fails and the user asks for a new one. Then ship the server and the Wallet host together, then the apps. A 0.75.0 Wallet host refuses a server with another seal protocol (`sealed_refresh_parity_mismatch`), and a 0.75.0 server has no route for the Email OTP registration and the seal of a 0.74 Wallet host. A deploy config that checks `signingSessionSeal.algorithm` must change it to `ristretto255-sha512-poprf-v1` and drop `groupId`.
- Compatibility: an app at 0.75.0 needs a Wallet host at 0.75.0. A Wallet host at 0.75.0 accepts an app at 0.74: the app config now names the seal mode only, and the host ignores the seal protocol that an older app sends. The Wallet iframe protocol stays **25.0.0**, and the VoiceID host API stays 11. The voice libraries stay at **0.72.0**. Install all three packages at 0.75.0.

## Release 0.74.0

- A passkey account sync asks for the app's Wallet Session budget, as unlock does. A linked device records the count that the server granted.
- Fixes from the review of 0.73.0: the grant follows the authority (a linked device always gets the linked-device budget), a retry replays after the tenant's maximum changes, and the SDK refuses a budget value that is not a non-negative integer.
- Email OTP counts each attempt before it compares the code. NEP-413 signs the app's exact message, recipient and callback URL. An ECDSA step-up is admitted only while its signer read still holds.
- Breaking: a server that composes `AuthorizationService` itself passes a `walletSessionLimits` port. `provisioningDefaults.{tempo,evm}` hold only `enabled`.
- Deploy order: the server, then the Wallet host, then the apps. A Wallet host at 0.74.0 needs a server at 0.74.0, and an app at 0.74.0 needs a Wallet host at 0.74.0. The voice libraries stay at **0.72.0**. No database migrations.

## Release 0.73.1

- The transaction receipt keeps the heading and description of each stage on one line on a phone, so the card no longer changes height while it signs and sends. The Japanese text of the stages and three English descriptions are shorter.
- No server or protocol change: a Wallet host at 0.73.1 works with a server at 0.73.0. The voice libraries stay at **0.72.0**. Install all three packages at 0.73.1. No database migrations.

## Release 0.73.0

- The app asks for its Wallet Session budget (`signingSessionDefaults` or `signingSession`), and the server grants it up to the maximum that the tenant sets for the project environment in the Seams Console (100 signatures and 30 days when the tenant sets none). With no request, a session gives 5 signatures and lasts 24 hours, as before.
- A Wallet host at 0.73.0 needs a server at 0.73.0. Deploy the server first: a 0.73.0 server accepts a 0.72.0 Wallet host.
- The Wallet lists JPYC on Ethereum while the wallet holds it.
- The voice libraries stay at **0.72.0**. The Wallet iframe protocol stays **25.0.0**. Install all three packages at 0.73.0. No database migrations.

## Release 0.70.4

- The Wallet ends the summary request of a note text that changed, and the summary route ends its request to the model. The Wallet keeps no summary that breaks a rule of `summaryRefusal`.
- The summary writer leaves out a number that is inside a name ("3D"). The voice libraries are **0.70.4**.
- A sent or signed result of a spoken request has `attestationUrl`, the OutLayer record of the verifier call.
- The Wallet iframe protocol stays **25.0.0**. Install all three packages at 0.70.4. No database migrations.

## Release 0.70.2

- New call `seams.near.spoken.prepare({ note? })`: the Wallet loads its Speak-to-Sign code and asks for a note's summary before the owner presses the button, so the card shows sooner. The Wallet keeps one summary for each note text for 5 minutes.
- The summary writer and its rules are general parts of the voice libraries 0.70.2: `summaryRefusal` (`@seams/voice-verdict`), `writeSummary` (`@seams/voice-sign/server`) and `createSummarySource` (`@seams/voice-sign/summary`). A name with a number in it ("COP31") needs one request to the model.
- The Wallet iframe protocol stays **25.0.0**. Install all three packages at 0.70.2. No database migrations.

## Release 0.70.1

- The Speak-to-Sign result card names a long receiver in its short form ("To 3e2210…7e55"), and `@seams/voice-capture` 0.70.1 breaks a word that is longer than the line. Before, an implicit account made the receipt and the button wider than the card.
- The summary route of a note no longer fails for a name with a number in it, such as "COP31".
- The Wallet iframe protocol stays **25.0.0**. Install all three packages at 0.70.1. No database migrations.

## Release 0.70.0

- The Speak-to-Sign verify route checks the TDX quote of each verifier call before it sends a verdict. The quote must bind the output to the WASM hash `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY` and to the project, Intel must sign it, and `worker.outlayer.testnet` must approve its measurements. A refusal is `failed` with `attestation_<code>`. A `verdict` has `attestationUrl`, the OutLayer record of the call.
- Optional `SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY`: while NEAR AI Whisper is down, the server calls the `venice` build of the verifier, which sends the clip to Venice AI (no TEE; the receipt says so). The quote check accepts only the hash of the build that it called.
- New refusal `transcriber_not_attested` (verifier 0.14.0 and later): the check of NEAR AI's gateway TEE failed. Before, the Wallet read it as `verdict_mismatch`.
- The verify route gives each verifier run 40 s (was 15 s) and waits 60 s (was 30 s), so a slow model gives a signed refusal.
- The paid and signed Speak-to-Sign cards show a TEE receipt with a "View TDX quote" link. VoiceID activation goes to the first recording at once, with no "Activate VoiceID" press.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.0**. A result card of `@seams/voice-capture` takes a `receipt`.
- The Wallet iframe protocol stays **25.0.0**. An app at 0.69.x works with a Wallet host at 0.70.0. Install all three packages at 0.70.0. No database migrations.

## Release 0.69.2

- The Speak-to-Sign card's check reads "Checking what you said", so the line with its verifier step fits the card.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.69.2**. In a form card (a card with a context, such as a note), the check's line slides into the microphone's circle and the microphone turns into a tick. A card with no context keeps the ring and the seal.
- The Wallet iframe protocol stays **25.0.0**, and the server and the verifier (0.13.0) do not change. An app at 0.69.0 works with a Wallet host at 0.69.2. Install all three packages at 0.69.2. No database migrations.

## Release 0.69.0

- Breaking: `spoken.note` takes no `summary`. The Seams server writes the spoken summary of a note (new route `POST /speak-to-sign/v1/summary`, which needs `SPEAK_TO_SIGN_NEAR_AI_API_KEY`; `SPEAK_TO_SIGN_SUMMARY_MODEL` is optional). Without a summary the result is unavailable with `summary_unavailable`, and no card opens. The card shows the note above the summary.
- The verifier is **0.13.0** (`1b777154…`): the Wallet sends `note_text`, and the verifier checks that the summary gives the main point of the note (refusals `summary_mismatch` and `summary_check_unavailable`). Set its version key on the server before this Wallet ships.
- `add_note` and `rate_note` carry their verdict to the notes contract, as a bet does in its `msg`. The co-signer refuses a call that carries another verdict.
- Wallet steps: an anchored card takes `minimize` (the `minimize` prop of `WalletStep`). Minimize hides the card and keeps its request; the app hears `onMinimize(restore)`, `onRestore` and `onProgress`. Deploy the hosted Wallet before an app sends `minimize`.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.69.1**. The voice card shows a context above its sentence, has a form card and a `colors` prop (with `surface3`), draws Minimize, and shows a result as one group: the seal (`voiceSeal`, else `voiceLine`), the headline, the details and the button. Its grid rows have names. `voiceBeam: 'none'` turns the Beam off, and the Beam takes the theme from the first frame.
- Wallet iframe protocol **25.0.0**: the note message has no summary. An app at 0.68.1 does not work with a Wallet host at 0.69.0, or the reverse. Deploy the verifier, then the server, then the SDK and the hosted Wallet together. Install all three packages at 0.69.0. No database migrations.

## Release 0.68.1

- Breaking: Speak-to-Sign is a part of `@seams/wallet`. The plugin package `@seams/wallet-voice-sign`, its host file `/sdk/speak-to-sign/host.js` and the step `seams-speak-to-sign-host` go away. Remove them from the app and from the Wallet host.
- Breaking: the app API of approval by voice. The configuration is `approvals: [spoken({ network })]`, with `spoken` from `@seams/wallet`. The normal NEAR sign calls take `approval: { kind: 'spoken', summary }`. The typed requests and `enroll` are in `seams.near.spoken`. `transactionFeatures`, `speakToSign()` and `seams.near.speakToSign` are removed, with no alias.
- Inside: one sign path in Wallet core, and one table of typed kinds that core and the co-signer both read. The co-signer builds a typed request only from the bytes that it signs. Core holds the limits of a transfer, and the recording never reaches the flow on the card.
- The Seams server calls the verifier with `relayToVerifier` of `@seams/voice-sign` 0.68.1, and its verify route serves only `verify` and `enroll`. `@seams/voice-verdict` and `@seams/voice-capture` are 0.68.1: the voice card's main button takes the theme's button colours.
- `@seams/voice-capture` 0.68.1: the theme can set the colours and widths of the voice line, its echo lines and the Beam, and a card that records by itself (`autoStart`) is shorter, with no Record row.
- Wallet steps: a card in an app's dialog takes `transition` (wait and fades), and `chrome: 'back_and_close'` draws Back and Close together.
- Wallet iframe protocol **24.0.0**: the configuration that the app sends has `approvals`. Ship the SDK, the hosted Wallet and the server together, the server first. Install all three packages at 0.68.1. No database migrations.

## Release 0.67.0

- Wallet core seals each Speak-to-Sign recording to the verifier's audio key before it leaves the device. The Seams server and OutLayer carry only ciphertext. The verifier is 0.12.0 (`bfe81633…`): set it on the server before this Wallet ships, or each spoken request fails with `unsupported`.
- Wallet core and the co-signer check a verdict with `checkVerdict` of `@seams/voice-verdict` 0.67.1. VoiceID records with `@seams/voice-capture` 0.67.1. Both packages come from `seams-tech/speak-to-sign`.
- Fixes: the Receive QR code shows in every app (`qrcode` is a dependency), a transaction card keeps one corner radius while it moves, and the Add and Remove buttons of Authentication methods have room for their labels. New color token `transactionCardBorder`.
- The Speak-to-Sign host API stays at 10, and the VoiceID host API stays at 11. Install all four packages at 0.67.0. No database migrations.

## Release 0.66.0

- Speak-to-Sign is the NEAR signer by voice: `seams.near.speakToSign` has `signAndSendTransaction`, `signTransaction`, `signDelegateAction` and `signMessage` for any NEAR transaction, delegate action or NEP-413 message, and `typed.transfer`, `typed.note`, `typed.rating`, `typed.mergeApproval` and the new `typed.bet`.
- Breaking: `seams.speakToSign` is gone, with no old names. A signing call that succeeds returns `{ kind: 'approved', result, approval, times }`; the kind `sent` is gone. The co-signer has no fixed voice limits.
- Ship the SDK, the hosted Wallet and the server together. The Speak-to-Sign host API is 10; the VoiceID host API stays at 11. Install all four packages at 0.66.0. No database migrations.

## Release 0.65.0

- A Wallet card can show as a step of an app's own dialog: `presentation: { kind: 'anchored', ... }` on the sign methods and the Speak-to-Sign requests, `onEnter`, `onReady`, `onResize`, `onExit`, `onBack` and `onClose` on the sign-in menu, `WalletStep` and `seams.surfaces.mount`. A top-layer card takes clicks only while it is whole in view and nothing covers it.
- App steps can show inside the Wallet modal: `steps: { title, before, after }` on reviewed transactions, `seams.authMenu.open` and the Speak-to-Sign requests. They need `TransactionReviewHost`.
- The sign-in menu shows "Unlock with email code" only where the email code can unlock.
- Ship the SDK and the hosted Wallet together. Host APIs stay at 11 (VoiceID) and 9 (Speak-to-Sign). Install all four packages at 0.65.0. No database migrations.

## Release 0.64.0

- `speakToSign.enroll` turns on VoiceID for a wallet without it, and the three samples of that VoiceID enrollment are also the verifier's recordings. The owner reads one set of phrases, not two. The Wallet clears its copies after it sends them; `activateAuthMethod` never returns audio to an app.
- During that enrollment, the Wallet confirm of the signed message no longer opens below the VoiceID card.
- VoiceID cards change state smoothly: rows that change fade out and the new rows fade in one after another, the first enrollment card continues the activation card with the same phrase, the model download bar follows the downloaded bytes and stays full while VoiceID prepares, and a card that gets shorter follows the Wallet frame instead of jumping.
- The VoiceID host API is version 11 and the Speak-to-Sign host API is version 9. Install all four packages at 0.64.0. No database migrations.

## Release 0.63.0

- A site or device with no NEAR custody cache reissues the current Client share. Passkey login, account sync and VoiceID unlock do this. Before, a passkey login ran a Router recovery, which moved the state epoch and made a new material activation, and VoiceID failed with "This site has no wallet keys on this device yet." A reissue keeps the activation and the epoch, so other sites' caches stay current.
- The Gateway serves `/router-ab/ed25519/yao/reissue/admit` and `/router-ab/ed25519/yao/reissue/execute`. Any Ed25519 Wallet Session of the wallet admits a reissue, VoiceID's included. The SigningWorker checks the reissued shares against its active share before the Router releases the Client packages, and it stores nothing.
- Router project policies must allow the `reissue` work kind. Deploy the Gateway, Router, both Derivers, SigningWorker and Wallet host together.
- Email OTP on a site with no cache still needs a recovery code.
- The Wallet frame hides its scroll bar while a VoiceID card is open.
- Install all four packages at 0.63.0. No database migrations.

## Release 0.62.0

- A NEAR custody cache from an older state epoch re-binds locally. A Router recovery, such as the first passkey login on another site, keeps both shares and moves only the epoch, so passkey login, account sync, VoiceID and Email OTP re-seal the old row under the current epoch with no Router round. VoiceID no longer fails after a login on another site.
- The active Ed25519 capability carries `signingWorkerVerifyingShare`. Release the Wallet, the server and the hosted assets together: a 0.61.0 Wallet's Email OTP unlock refuses the new field, and a 0.62.0 Wallet needs it.
- A passkey login that rejoins the key set now reports the recovery, so the local authority follows the new activation.
- `@seams/speak-to-sign` 0.62.0 removes its empty `./react` entry. Its verifier is 0.5.2, OutLayer version key `96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5`.
- Install all four packages at 0.62.0. No database migrations.

## Release 0.61.0

- Speak-to-Sign (experimental, NEAR testnet only) approves a pull request merge by voice: `requestMergeApproval` signs one `approve_merge` call after the owner says "merge pull request 42 into main". It needs verifier 0.5.0 or later.
- A voice-approved plain transfer shows "Sent" when a block holds it, about two blocks before its outcome. A recording of a known sentence ends after 0.8 s of silence instead of 1.5 s, once the whole sentence was said. The result times start at the last spoken word.
- Verifier 0.5.1 (`cdb46fea…`) writes the used-audio mark during its requests, about 0.2 s off each verification. A refused recording is used up.
- A passkey unlock refreshes a NEAR custody cache that is older than the server's keys. The Wallet host loads its plugins with a version key in the URL.
- The Speak-to-Sign host API is version 8. `@seams/speak-to-sign` releases from `seams-tech/speak-to-sign`. Install all four packages at 0.61.0. No database migrations.

## Release 0.60.0

- Speak-to-Sign (experimental, NEAR testnet only): the Seams co-signer checks the verifier's verdict again before it adds its part of a voice-approved signature. It checks the pinned key, the expiry, the transaction against the spoken request, the owner and single use, and it applies the voice limits: 10 NEAR in one voice-only payment and 20 NEAR in any 24 hours for each wallet. A refusal is `refused` with `voice_limit` or `cosigner_refused`.
- A `step_up` verdict needs a fresh approval: a passkey or Email OTP step-up of the same operation, or a new VoiceID unlock after the verdict.
- `requestTransfer`, `requestNote` and `requestRating` take an optional `onProgress`. The verify route answers with `text/event-stream`, and the Wallet prefetches the NEAR nonce and block hash while the verifier works.
- Without `rpIdOverride`, passkeys are scoped to the host of `walletOrigin`. Before, every wallet origin kept the local default `example.localhost`.
- Without a `routerAb` setting, the Seams-hosted wallet origins (`staging.sign.seams.sh`, `test.sign.seams.sh`, `sign.seams.sh`) enable Router A/B normal signing with their own SigningWorker. So `seamsTestnetConfig` with `walletOrigin`, `relayerUrl` and `publishableKey` can sign NEAR. Before, NEAR signing stayed off until the app set `routerAb`.
- Verifier 0.4.1 (`d078eb11…`) accepts more spoken forms in transfers: separators said in other words or left out ("seams v one"), "to" joined with the account, and "oh" for zero.
- D1 migration `0089_speak_to_sign_voice_verdicts.sql` adds one table. Apply it, deploy the server, then the Wallet host; Speak-to-Sign needs both at 0.60.0. The Speak-to-Sign host API is version 7. Install all four packages at 0.60.0.

## Release 0.59.0

- Speak-to-Sign signs spoken community notes and note ratings. `requestNote` posts a typed note when the author reads aloud its summary of 1 to 12 plain words; the verdict binds the full note by its SHA-256. `requestRating` rates a note when the owner says "this note is helpful", "somewhat helpful" or "not helpful". Wallet core signs one `add_note` or `rate_note` call on the notes contract, with no deposit and no confirm.
- Verifier 0.4.0 (`8a0b7ba0…`) adds the note requests. Transfers are unchanged.
- The Speak-to-Sign host API is version 6, and the VoiceID host API stays at version 10. Install all four packages at 0.59.0.

## Release 0.58.1

- Speak-to-Sign shows one VoiceID card for the whole spoken payment. After the recording, the card stays open: it shows the verifier check, the payment and the result in place. A refusal offers "Try again" on the same card, up to five recordings in all, and a step-up asks for the passkey in the card. `requestTransfer` returns when the owner closes the card. The Wallet pays at most once in each flow.
- Verifier 0.3.1 (`5b6fad5d…`) accepts sound-alikes of the words that hold no value, such as "year" for "NEAR". On the saved Whisper transcripts, 98.0% of transfers pass, up from 94.6%, with no false accepts.
- The VoiceID host API is version 10 and the Speak-to-Sign host API is version 5. Install all four packages at 0.58.1.

## Release 0.58.0

- Speak-to-Sign pays from the owner's own account. There is no vault: the Wallet checks the verifier's signed verdict and sends the transfer through the owner's Wallet Session. An accepted spoken payment shows no confirm and no passkey. A policy rule can ask for the confirm again; today one stub rule asks for it above 10 NEAR.
- `speakToSign({ network })` replaces `speakToSign({ vault, network })`. A `sent` result has `approval` (`voice` or `voice_and_passkey`). The refusal `vault_rejected` becomes `transaction_failed`, `vault_missing` is gone, and an enrollment result has no transaction hash.
- Enrollment signs one NEP-413 message for exactly the three recordings. Each owner enrolls again once, because the verifier keys templates by owner only.
- The Speak-to-Sign host API is version 4, and the verifier is version 0.3.0 (`09f4ce1b…`). Install all four packages at 0.58.0. The VoiceID host API stays at version 9. Speak-to-Sign stays experimental and NEAR testnet only.
- Wallet iframe protocol remains **23.0.0**. This release adds no database migrations.

## Integrate the SDK

```sh
npm install @seams/mpc-wallet @seams/wallet-connect
# Operators of the Wallet Gateway and the Wallet host, also for VoiceID:
npm install @seams/host
```

VoiceID and the experimental Speak-to-Sign need no other package in the app:
`voiceIdAuthMethod()` comes from `@seams/mpc-wallet/voiceid`.

Use `HostedSeamsAuthMenu` from `@seams/mpc-wallet/react` inside `SeamsWebProvider`.
Its optional `walletAlternatives` configuration supplies ordered `primary` and
`secondary` groups. Omitted or empty groups stay hidden. Authentication stays on
the wallet origin, while external connections remain owned by application controllers.
Wallet icons retain their original colors.

Start with the [runnable connector example](./examples/seams-auth-menu/README.md),
the [React reference](./apps/docs/src/reference/react.md), and the
[hosted integration guide](./apps/docs/src/deploy-and-operate/hosted-integration.md).

## Local development

Local development uses two terminals:

```sh
pnpm router
pnpm site
```

`pnpm router` starts the five isolated MPC Router roles, bootstraps the local tenant
root, migrates signer D1, and serves the Wallet Gateway. `pnpm site` starts Caddy,
Wallet Console Lite, the hosted Wallet iframe/assets, and the Wallet documentation.
Together they provide a complete local Wallet stack without `seams-monorepo`.

Wallet Console Lite supports local organisation/project setup, registration, unlock,
session inspection, safe message signing, and the public CLI workflows for server-share
export, rotation, and deployment restore. See
[`examples/wallet-console-lite`](./examples/wallet-console-lite/README.md).

### TypeScript compiler

Project checks, declaration builds, and the packed SDK consumer check use the exact
`tsrs` version in the root `package.json`. The root `typescript` dependency supplies
the JavaScript API used by build-analysis scripts and declaration comparison.
Vite, Rolldown, and Bun still produce application JavaScript.

```sh
pnpm type-check
pnpm -C packages/mpc-wallet build:sdk
pnpm -C packages/mpc-wallet-server build
pnpm -C packages/mpc-wallet check:declarations-external
```

The SDK build uses existing WASM outputs. Use `pnpm build:wasm` when those outputs
need regeneration.

Compare tsrs with its matching upstream compiler from the repository root:

```sh
npm install --prefix .artifacts/typescript-reference --ignore-scripts --no-audit --no-fund typescript@7.1.0-dev.20260930.4
node tests/e2e/typescript-compiler-comparison.e2e.mjs \
  --reference .artifacts/typescript-reference/node_modules/typescript/bin/tsc \
  --candidate node_modules/.bin/tsrs
```

The comparison covers ten configurations, including lifecycle type fixtures and
browser tests, plus both declaration builds. It compares checked source files and
declaration syntax. Record property order may differ. Overload and signature order
must match. Declaration maps must have matching metadata and source paths, while
encoded position mappings may differ. Run the comparison without concurrent builds
or tests. It excludes one warmup and records three samples per project.

Logs, declarations, source manifests, times, and peak resident memory go to
`.artifacts/typescript-compiler-comparison/result/`. A successful run prints
`Verified` and sets `verified: true` in `result.json`. Linux requires GNU
`/usr/bin/time`; macOS uses its bundled `/usr/bin/time`.

### Packaged local runtime

`@seams/host` includes prebuilt Worker roles, signer/private-role
migrations, and the native local identity initializer. Consumers can run
`seams-wallet-server-local` (complete local Wallet system),
`seams-wallet-server-local-roles`, or `seams-wallet-server-local-init --root <directory>`.
Supported initializer targets match the CLI release: macOS arm64/x64 and Linux
x64. `pnpm build:local-tools` builds the host initializer in this source repo;
the npm release pipeline assembles all supported targets.

Private Console adapters use `@seams/host/local-runtime` for local
configuration and `@seams/host/tenant-root` for portable protocol
contracts. Console governance/security-state models stay in the private repo.

## Architecture specifications

Start with [How the wallet works](./docs/README.md), then choose a topic from the
numbered `spec-{x}-{title}.md` chapters. Each explains the main flow and links to
further detail. [Intended Behaviours](./docs/intended-behaviours.md) defines the
supported user journeys.
