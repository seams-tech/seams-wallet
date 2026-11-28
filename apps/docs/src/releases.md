---
title: Release 0.77.0
description: The packages get new names, passkeys need user verification, Email OTP releases need a fresh code, and SaySo replaces OutLayer as the Speak-to-Sign verifier. Ship the server and the Wallet host together.
---

## Next release (not released yet)

Since 0.77.0:

- Speak-to-Sign: in a multisig "add member" approval, Wallet core and the co-signer read "ad" or "at" directly before "member" as "add". Whisper large-v3-turbo often writes "Ad Member" for "add member". The words of the member do not change, and the Wallet still compares them with the request.

# Release 0.77.0

The app installs `@seams/mpc-wallet` and `@seams/wallet-connect` **0.77.0**, and the operator installs `@seams/host` **0.77.0**. Apply every signer migration of 0.76.0 first, then deploy the server and the Wallet host together, then the apps.

Since 0.76.0:

- Passkeys: the server requires user verification (a PIN, a biometric or a device passcode) for every passkey registration and every passkey assertion. Before, it accepted an assertion that showed only user presence. A ceremony that is valid in every other way but has no user verification fails with the new code `user_verification_required`. The Wallet then shows "This passkey did not check a PIN or biometric. Use a passkey with a PIN or biometric, or set a PIN on your security key."
- The Wallet asks for `userVerification: 'required'` in every passkey prompt, also in the add-method, device-link and recovery options that the server sends.
- Ed25519 Yao registration: an admission that failed or stopped before its commit left a claim in D1. Each later admission of that lifecycle then failed with `admission_in_progress`, and a relocation of the wallet waited with `ceremonies_unsettled`. The admission now stores nothing before its one commit, and the Gateway drops a claim that an earlier version stored. No migration is needed.
- Email OTP: no route releases the factor for a Wallet Session bearer. Each factor release needs a fresh email code for its operation, or the grant of one. After a reload, the NEAR Ed25519 restore opens the factor from its warm seal: the Email OTP worker seals the factor under the signing-session seal of its Wallet Session. The sealed value opens only for that live session.
- The Gateway routes that the Console answers (`GET /v1/wallets`, `GET /v1/wallets/search`, `GET /v1/wallets/:id`, `POST /signed-delegate` and `POST /sponsorships/evm/call`) returned 500 `Can't modify immutable headers.` on a Gateway with CORS origins. They now return the answer of the Console with the CORS headers.

Breaking changes:

- A security key with no PIN, or another authenticator that cannot verify the user, can no longer register a passkey, sign in, unlock, sign or run an owner operation. Set a PIN on the key, or use another passkey or sign-in method.
- The server options for an added passkey, a device-link passkey and a recovery passkey carry `authenticatorSelection.userVerification: 'required'`, and the Wallet accepts only that value. Deploy the server and the Wallet host together. A ceremony that starts before the deploy and ends after it fails, and the user starts it again.
- `webauthn.authenticatorOptions.userVerification` is removed from the SDK config, with the `UserVerificationPolicy` enum. The field had no effect.
- `/wallet/email-otp/factor-release` refuses `kind: 'wallet_session'`, and a `verified_grant` release requires `operation`. A release, a step-up or an export takes only a grant of its own operation. A grant that is open at the deploy fails, and the user asks for a new code. A NEAR Email OTP session that started before the deploy has no warm seal, so after a reload it needs a new unlock with an email code.
- `@seams/host` D1 stores do not create tables. The `d1-signer` migrations are the only schema. `D1WalletStore`, `D1WalletAuthMethodStore`, `D1IdentityStore` and `CloudflareD1RouterAbEd25519YaoCapabilityPersistence` take no `ensureSchema` option, and the `ensure*D1Schema` functions, their option types and the `*_D1_SCHEMA_SQL` arrays are removed.
- `@seams/host` D1: the signer migrations are one baseline, `0001_signer_d1_baseline.sql`, in place of the 91 files `0001` to `0091`. Before a database takes this release, apply every migration up to `0091_linked_device_email_otp_own_factor.sql` with the 0.76.0 release. `wrangler d1 migrations apply` then runs the baseline once on that database as a no-op, and the database keeps its schema and data. The baseline refuses a database that does not have migration 0091, with `CHECK constraint failed: apply_migration_0091_first`.
- `@seams/host` types: `RouterAbEd25519YaoProductRegistrationCeremonyStateV1` has no `registration.admissionClaims` map, and `InMemoryRouterAbEd25519YaoRegistrationService` keeps its admission claims for itself.

### Speak-to-Sign: the SaySo verifier

SaySo, a Cloudflare Worker of the Seams operator, replaces OutLayer as the verifier. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign#the-verifier).

- SaySo checks the speaker and the recording and signs the transcript. The Wallet and the co-signer read the transcript with `spoken-intent` and need exactly the words of the request.
- SaySo has no TEE. The card shows a "Verifier receipt" of the "Seams verifier · Cloudflare", and `attestationUrl` is always `null`.
- The voice approves any amount, as a passkey step-up does. The 10 NEAR rule of the OutLayer verifier is gone.
- A request whose sentence has more than 16 words or 160 characters gets no spoken approval: `unavailable` with `verifier_unavailable`. Use the confirm for it.
- An enrollment asks for a passkey unlock in place of the NEP-413 message. A wallet with no passkey cannot enroll yet. Every owner enrolls again.
- Turning VoiceID off or removing it first deletes the owner's voice template at SaySo.
- A note, a rating and a bet carry no verdict to their contract.
- Breaking for the operator: a Gateway with a verifier needs `SPEAK_TO_SIGN_BACKEND`, the `SAYSO` service binding and the `SAYSO_API_KEY` secret. See [Hosted integration](/deploy-and-operate/hosted-integration#speak-to-sign-verifier).

### New package names

The packages have new names, so that each product is its own package. The code works as
before; the names, the import paths and the package boundaries change.

| Package before | Package now | What it holds |
| --- | --- | --- |
| `@seams/wallet` | `@seams/mpc-wallet` | The embedded MPC wallet: browser SDK, React components, and the VoiceID page code |
| `@seams/wallet/external-*` | `@seams/wallet-connect` (new) | The connectors for existing EVM and NEAR wallets, with no Seams account or custody |
| `@seams/wallet-server` | `@seams/host` | The services that an operator deploys, the wallet origin document, and the VoiceID host plugin and models |
| `@seams/voiceid` | `@seams/mpc-wallet` and `@seams/host` | Not published alone any more |
| `@seams/wallet-cli` | `@seams/cli` | The recovery CLI launcher, still **0.29.0** with the `seams-wallet` command |

No package has a root import. Each import says where its code runs:

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

Also changed:

- The default exports of `@seams/wallet/react/provider` and `@seams/wallet/react/hosted-seams-auth-menu` are gone with those paths. Import `SeamsWebProvider` and `HostedSeamsAuthMenu` by name from `@seams/mpc-wallet/react`. That path also loads the component stylesheets, so import it through a bundler, also for server-side rendering.
- `@seams/mpc-wallet` names `@seams/wallet-connect` as a peer, because the hosted auth menu takes its controllers as wallet alternatives. It also depends on `voice-glow` for `VoiceBeam`. Install the packages at one version.
- The connector pickers draw their own theme boundary and do not read the `Theme` tokens of `@seams/mpc-wallet/react`. They look the same. Their boundary element has no `data-seams-theme`, `lang` or token variables. Set the `--seams-wallet-picker-*` CSS variables to change their colours, as before.
- The wallet asset manifest names `@seams/mpc-wallet`, and the host artifact manifest names `@seams/host`. `seams-voiceid-host` and `composeVoiceIdWalletAssets` come from `@seams/host`. The other `seams-wallet-server-*` commands keep their names.
- The old package names get npm deprecation messages that name the new packages.

Compatibility:

- Apply every signer migration of 0.76.0, up to `0091_linked_device_email_otp_own_factor.sql`, before the 0.77.0 server. The 0.77.0 baseline then runs as a no-op.
- On a lane with Speak-to-Sign, deploy a SaySo Worker that serves `POST /v1/template/delete` before the Gateway.
- A Wallet host at 0.77.0 needs a server at 0.77.0, and the reverse: the passkey options and the Email OTP release bodies changed on both sides.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` stay at **0.72.0**. `@seams/cli` stays at **0.29.0**.
- The Wallet iframe protocol stays **25.0.0**, and the VoiceID host API stays 11. Install `@seams/mpc-wallet`, `@seams/wallet-connect` and `@seams/host` at 0.77.0.

# Release 0.76.0

The browser SDK, server SDK and VoiceID plugin use **0.76.0**. Apply the D1 migration `0091_linked_device_email_otp_own_factor.sql`, then deploy the server and the Wallet host together, then the apps.

Since 0.75.0:

- The Email OTP enrollment of a wallet keeps one factor for each Email OTP method, each with its own nonce, wrapped factor and pinned unlock key. The release picks the factor whose nonce the device sends. A revoke removes the method's factor in the same commit, also when a linked device is revoked.
- Google recovery works on a new device again. The recovery code opens the seed, and the device enrolls its own Email OTP factor for the recovered method. The server releases no factor, and the factors of the wallet's other devices stay.
- A linked device enrolls its own Email OTP factor, also on a wallet that has Email OTP. The code goes to the wallet's Email OTP address, which the new device must enter, and the link adds the device's factor to the enrollment.
- On a device that holds no Email OTP factor for the wallet, a Google or email sign-in sends no code. It fails with the new code `email_otp_device_factor_missing`, which carries the wallet ID and the email hint in `account`. The hosted menu then offers "Link this device" and "Recover wallet".
- An Email OTP owner sees the Wallet's email code prompt when removing a sign-in method or a linked device, and when moving a wallet to another region. The prompt stayed hidden, so the request failed after its timeout.

Breaking changes:

- `/wallets/recovery/email-otp/release` is removed. `/wallets/recovery/email-otp/verify` also returns `providerSubject` and `verifiedEmail`. `/wallets/recovery/google-email-otp/finalize` requires `emailOtpEnrollment`, which is now the enrollment material itself, with no `kind` wrapper.
- The device-link route `/email-otp-base-factor` is removed, with the base method chooser. `QRCodeScanner` and `useDeviceLinking` no longer take `onEmailOtpBaseFactorRequired`.
- A device-link approval and target preparation for Email OTP carry only `targetEmail`. The challenge start has no `workerEphemeralPublicKey65B64u`, the verification result has no `factorRelease`, and an Email OTP target registration always carries `emailOtpEnrollment`. The add-method `emailOtpTarget` of kind `existing_enrollment` carries `enrollment` too.
- Email OTP wallets made by 0.75.0 do not open after the upgrade, because the stored enrollment changed.

Compatibility:

- Apply the D1 migration `0091_linked_device_email_otp_own_factor.sql` before the server. It drops the open device-link Email OTP grants, so such a link asks for a new code. An upgrade from 0.74 applies `0090_email_otp_code_seal.sql` first.
- A Wallet host at 0.76.0 needs a server at 0.76.0, and the reverse: the Email OTP recovery and device-link contracts changed on both sides.
- An app at 0.76.0 needs a Wallet host at 0.76.0. A Wallet host at 0.76.0 accepts an app at 0.74 or 0.75.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` stay at **0.72.0**. They have no change.
- The Wallet iframe protocol stays **25.0.0**, and the VoiceID host API stays 11. Install all three packages at 0.76.0.

## Release 0.75.0

The browser SDK, server SDK and VoiceID plugin use **0.75.0**. Apply the D1 migration `0090_email_otp_code_seal.sql`, then deploy the server and the Wallet host together, then the apps.

Since 0.74.0:

- Email OTP is a device factor. The device keeps a random input. The server keeps a factor nonce and the factor, encrypted under the RFC 9497 POPRF output (ristretto255-SHA512) for that input. The server cannot compute that output without the device, so neither the server nor the device alone can open an Email OTP wallet. The POPRF `info` names the wallet, the enrollment and a nonce that the server picks.
- The server stores each Email OTP code encrypted (AES-256-GCM, bound to its challenge), never in plain text. The key comes from the existing seal root (`SIGNING_SESSION_SEAL_ROOT_SECRET_B64U`), so no new secret is needed.
- The warm session that survives a page reload is sealed with the same POPRF in place of Shamir three-pass. The device keeps a random input and the session secret under AES-256-GCM, with a key from the POPRF output. The POPRF `info` names the wallet and the threshold session. A restore is one server call. A new WASM module, `oprf_runtime`, serves the Wallet workers and the Gateway, and the `shamir3pass_runtime` module and its nested worker are gone.
- The server and the SDK refuse a bad signing count, signer slot, participant ID, step-up expiry or key-envelope binding instead of filling in a default. A NEAR RPC error such as `{"InvalidTxError":"Expired"}` keeps its name. A Wallet Session whose authority row is gone reads as ended, not corrupt.
- The Email OTP export and rotation no longer send the seal group as `orgId` in `/wallet/unlock/challenge`.

Breaking changes:

- `/wallet/email-otp/registration/seal` is now `/wallet/email-otp/registration/factor`, which takes a blinded element. The factor release, the Ed25519 step-up material recovery and the Google recovery release take `deviceFactors` in place of a worker public key, and they return an `email_otp_factor_evaluation_v1`.
- `/wallet-session/seal/apply-server-seal` and `/wallet-session/seal/remove-server-seal` are now one route, `POST /wallet-session/seal/evaluate`, which takes a blinded element. The server allows 30 evaluations a minute for each wallet and threshold session. The seal protocol in `/.well-known/webauthn` is `{ algorithm: 'ristretto255-sha512-poprf-v1' }` with no `groupId`. A deploy config that checks `signingSessionSeal.algorithm` must change it and drop `groupId`.
- `@seams/wallet-server` exports `createSigningSessionSealEvaluator` in place of the seal cipher adapters and their Shamir three-pass types. `parseSigningSessionSealRootConfig` is removed. `createSigningSessionSealOptions` keeps its input.
- The Email OTP login options have no `groupId`.
- A device-link target cannot reuse the wallet's Email OTP factor, and Google recovery of an Email OTP wallet works only on a device that holds the factor. Choose a passkey or VoiceID for the new device, or use the recovery code. A later release gives each device its own factor.
- Email OTP wallets from an earlier version do not open after the upgrade. The Wallet deletes the sealed warm sessions of an earlier version when it reads them, so each open session needs one unlock.

Compatibility:

- Apply the D1 migration `0090_email_otp_code_seal.sql` before the server. It drops the open Email OTP challenges, so a code that is open at the deploy fails and the user asks for a new one.
- A Wallet host at 0.75.0 needs a server at 0.75.0, and the reverse: a 0.75.0 Wallet host refuses a server with another seal protocol (`sealed_refresh_parity_mismatch`), and a 0.75.0 server has no route for the Email OTP registration and the seal of a 0.74 Wallet host.
- An app at 0.75.0 needs a Wallet host at 0.75.0. A Wallet host at 0.75.0 accepts an app at 0.74: the app config names the seal mode only, and the host ignores the seal protocol that an older app sends.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` stay at **0.72.0**. They have no change.
- The Wallet iframe protocol stays **25.0.0**. Install all three packages at 0.75.0.

## Release 0.74.0

The browser SDK, server SDK and VoiceID plugin use **0.74.0**. Deploy in this order: the server, then the Wallet host, then the apps.

Since 0.73.1:

- A passkey account sync asks for the app's Wallet Session budget (`signingSessionDefaults`), as unlock does. The client sends `walletSessionBudget` to `/sync-account/verify`. Before, a sync always got 5 signatures and 24 hours.
- A linked device reads the count of its session from the server after the link. Before, it recorded 5. The server grants a linked device 100 signatures and 15 minutes, capped by the tenant's maximum.
- The server picks the budget profile from the authority. A linked device gets the linked-device budget on every path: unlock, budget refresh, ECDSA activation and VoiceID.
- A retry of a session issue replays after the tenant changed the maximum. A stored maximum that does not parse changes only the grant (5 signatures and 24 hours, with a log line), not the rest of the environment.
- `signingSessionDefaults` and `signingSession` values must be non-negative integers. Another value fails the config or the login. Before, it disabled the warm session with no error.
- The client checks every grant with one rule: 1 ≤ granted ≤ requested. VoiceID and the ECDSA session now check it too.
- Email OTP counts each attempt before it compares the code. Before, parallel guesses on one challenge could pass the limit of attempts.
- NEP-413 signs the app's exact message, recipient and callback URL. Before, the SDK trimmed the whitespace, so a message with a leading or trailing space failed.
- An ECDSA step-up is admitted only while the signer rows that it read still hold. A failed Email OTP unlock names a wallet in its webhook only when the request has a valid wallet ID.
- VoiceID unlock answers 402 for a billing failure. A NEAR lookup failure after the session is issued no longer loses the session: the response says `near: unavailable`.
- The lock after a signing failure logs each step that failed.

Breaking changes:

- A server that composes `AuthorizationService` itself passes a `walletSessionLimits` port. The service refuses a composition with none. `@seams/wallet-server/cloud-host` exports `createProjectEnvironmentWalletSessionLimits` and `UNAVAILABLE_WALLET_SESSION_LIMITS` (for a server with no Console).
- `provisioningDefaults.{tempo,evm}` and `RegistrationHooksOptions.signerOptions` hold only `enabled`. Nothing read their `signingSession`. Set the budget with `signingSessionDefaults`. A Wallet host at 0.74.0 ignores the `signingSession` that an older app sends.
- The unused types `EcdsaSessionPolicy` and `ThresholdEcdsaBootstrapSessionPolicy` are removed from `@seams/wallet-server`.
- `@seams/wallet/advanced` exports `DEFAULT_TENANT_WALLET_SESSION_LIMITS`, `parseWalletSessionLimits` and `WalletSessionLimits`.

Compatibility:

- A Wallet host at 0.74.0 needs a server at 0.74.0: a 0.73 server refuses the `walletSessionBudget` of a sync. A server at 0.74.0 accepts a Wallet host at 0.73.
- An app at 0.74.0 needs a Wallet host at 0.74.0: a 0.73 Wallet host refuses a config with no `provisioningDefaults.signingSession`. A Wallet host at 0.74.0 accepts an app at 0.73 or 0.72.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` stay at **0.72.0**. They have no change.
- The Wallet iframe protocol stays **25.0.0**. Install all three packages at 0.74.0. No database migrations.

## Release 0.73.1

The browser SDK, server SDK and VoiceID plugin use **0.73.1**. It has no breaking change since 0.73.0.

Since 0.73.0:

- The transaction receipt keeps the heading and description of each stage on one line on a phone. Before, a stage that took two lines followed a stage that took one, and the card changed height while it signed and sent the transaction.
- The Japanese text of the stages is shorter, for example 署名中 and 送信中 in the headings. Three English descriptions are shorter: "Sending it to the network.", "Sent. Waiting for the receipt." and, for a signed message, "Nothing was sent to the network."
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` stay at **0.72.0**. They have no change.
- No server or protocol change. The Wallet iframe protocol stays **25.0.0**, and a Wallet host at 0.73.1 works with a server at 0.73.0.
- Install all three packages at 0.73.1. No database migrations.

## Release 0.73.0

The browser SDK, server SDK and VoiceID plugin use **0.73.0**. A Wallet host at 0.73.0 needs a server at 0.73.0, so deploy the server first.

Since 0.72.0:

- The app sets the Wallet Session budget: `signingSessionDefaults: { ttlMs, remainingUses }` in the provider config, or `signingSession` in the options of one login. Before, an app could only lower the count below 5. See [Set the session budget](/guides/wallet-sessions-and-signing-lanes#set-the-session-budget).
- The server grants the request up to the maximum of the project environment. A tenant sets that maximum in the Seams Console. With no setting, the maximum is 100 signatures and 30 days. The highest maximum is 1,000,000 signatures and 30 days. With no request, a session gives 5 signatures and lasts 24 hours, as before.
- Read the granted budget from the unlock result (`signingSession.remainingUses` and `signingSession.expiresAtMs`). It can be lower than the request.
- The budget goes to the server as `walletSessionBudget` on the passkey, Email OTP and VoiceID unlock and on registration setup. The session that registration gives lasts the granted time. Before, its ECDSA session lasted 5 minutes.
- A linked device gets its own session of 100 signatures and 15 minutes, also capped by the tenant's maximum.
- A server that you host reads the maximum through the Console binding. The static Console binding takes the optional `deployment.walletSessionLimits` (`{ maxTtlMs, maxRemainingUses }`).
- The Wallet lists JPYC (JPY Coin) on Ethereum, with JPYC's coin mark. Like WBTC and cbBTC, it shows only while the wallet holds it.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` stay at **0.72.0**. They have no change.
- The Wallet iframe protocol stays **25.0.0**. A server at 0.73.0 accepts the requests of a 0.72.0 Wallet host and ignores their old counts. A Wallet host at 0.73.0 does not work with a server at 0.72.0.
- Install all three packages at 0.73.0. No database migrations.

## Release 0.72.0

The browser SDK, server SDK and VoiceID plugin use **0.72.0**. It has no breaking change since 0.71.0.

Since 0.71.0:

- One unlock gives a Wallet Session of 5 signatures. Before, it gave 3. After the last one, the Wallet asks for a step-up, as before. A session that exists keeps its count until the next unlock.
- The default is one constant now, `DEFAULT_WALLET_SESSION_REMAINING_USES`. The client defaults and the server read it. `signingSessionDefaults.remainingUses` can still lower the count for an app, and it cannot raise it above the default.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.72.0**. They have no change.
- The Wallet iframe protocol stays **25.0.0**. The count comes from the Wallet host and the server, so an app at 0.71.0 gets 5 signatures from a host at 0.72.0.
- Install all three packages at 0.72.0. No database migrations.

## Release 0.71.0

The browser SDK, server SDK and VoiceID plugin use **0.71.0**. It has no breaking change since 0.70.6.

Since 0.70.6:

- A wallet with no VoiceID can set up its voice from an app again. Since 0.70.1, a VoiceID activation starts when VoiceID has loaded, with no press on "Activate VoiceID". But the activation still needed a press in the Wallet frame, and a press in the app does not count there. So the first voice setup of a new wallet failed with "Open the Wallet and select Record to use VoiceID." Now the enrollment card opens and waits for "Record sample 1". For Speak-to-Sign, the three samples are still the enrollment of VoiceID and of the verifier.
- A VoiceID activation that records at once shows "Activate VoiceID" and waits, if the Wallet frame has no press. This is the case of a browser that already holds a voice enrollment of the wallet. Before, it failed with the same message.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.71.0**. Their behavior has no change. Their documents and tests follow verifier 0.15.0 of Speak-to-Sign: a verdict that passes has no heard words.
- The Wallet iframe protocol stays **25.0.0**. The fix is in the Wallet host, so an app at 0.70.6 gets it from a Wallet host at 0.71.0.
- Install all three packages at 0.71.0. No database migrations.

## Release 0.70.6

The browser SDK, server SDK and VoiceID plugin use **0.70.6**. It has no breaking change since 0.70.5.

Since 0.70.5:

- An app can press a control of a Wallet card in its dialog for the person, for example from a voice command. The new step event `onControls` gives the app `press`, which takes `retry`, `minimize`, `back` or `close`. `retry` is the card's button while it starts a recording: Record or "Try again". The Wallet never presses another action for the app, such as "Confirm with passkey" or "Done". A press counts as a click does: only on a card that is whole in view and not covered.
- The card's stage has the new value `waiting`: the card waits for a press on Record or "Try again", and its microphone is off. Before, the card reported `recording` there. An app that pauses its own speech recognition while the Wallet records can now listen again while the card waits.
- After "Try again" on a failed check, the card records at once. Before, it showed Record, and the person pressed a second time.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.6**. Only `@seams/voice-capture` has a change.
- The Wallet iframe protocol stays **25.0.0**. An app at 0.70.5 works with a Wallet host at 0.70.6: it does not see the stage `waiting`. A press of an app at 0.70.6 needs a Wallet host at 0.70.6.
- Install all three packages at 0.70.6. No database migrations.

## Release 0.70.5

The browser SDK, server SDK and VoiceID plugin use **0.70.5**. It has no breaking change since 0.70.4.

Since 0.70.4:

- The result card of a spoken request stays whole in the Wallet frame. Before, a result with a TEE receipt showed about 10 px too high: its top was cut off, and an empty band showed under it. The result is taller than the view before it, and it shows while the frame still grows. The card put the focus on "Done" with a plain focus, so the browser scrolled the frame. Each focus of the card now keeps the scroll position. The VoiceID cards have the same change.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.5**. Only `@seams/voice-capture` has a change.
- The Wallet iframe protocol stays **25.0.0**. An app at 0.70.4 works with a Wallet host at 0.70.5.
- Install all three packages at 0.70.5. No database migrations.

## Release 0.70.4

The browser SDK, server SDK and VoiceID plugin use **0.70.4**. It has no breaking change since 0.70.2. No Wallet package has the version 0.70.3; the voice libraries have it.

Since 0.70.2:

- When the owner edits a note, the Wallet ends the summary request of the older text, if only `prepare` asked for it. The summary route then ends its request to the model. Before, each pause in the typing left one model call.
- The Wallet does not keep a summary that breaks a rule of `summaryRefusal`. Before, such a summary stayed for 5 minutes. When the server's model gives no summary that a person can say, the result of `spoken.note` is now the refusal `summary_not_speakable`. Before, it was `unavailable` with `summary_unavailable`.
- The second request of the summary writer asks the model to leave out a number that is inside a name, such as "3D". Before, it asked for the number as words. Speech-to-text writes a said "three D" as "3D" again, and the verifier reads such a word digit by digit, so the words did not match.
- A sent or signed result of a spoken request has `attestationUrl`: the OutLayer record of the verifier call, with its TDX quote, or null when the Wallet got none. An app can show the proof with its own result.
- The last repair of the summary writer keeps a quantity. A word that starts with a digit or a currency sign ("10km", "$40m", "2nd") is not cut to its letters: the result is `summary_not_speakable`.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.4**. `writeSummary` takes `{ signal }`, and `createSummarySource` has the two changes above. The docs of `writeSummary` say that a summary is a draft: only a community note has the verifier's check that the summary fits the text.
- The Wallet iframe protocol stays **25.0.0**. Upgrade the app before the Wallet host: an app at 0.70.2 or older reads a result with exact keys, so it refuses the success result of a spoken request from a Wallet host at 0.70.4, which has `attestationUrl` ("Speak-to-Sign … result is invalid", after the transaction was sent). An app at 0.70.4 reads the result of an older Wallet host too.
- Install all three packages at 0.70.4. No new server setting, and no database migrations.

## Release 0.70.2

The browser SDK, server SDK and VoiceID plugin use **0.70.2**. It has no breaking change since 0.70.1.

Since 0.70.1:

- New call `seams.near.spoken.prepare({ note? })`. Call it when your form is on the screen. The Wallet loads its Speak-to-Sign code, and with `note` it asks the Seams server for the summary of that text. The `spoken.note` call that follows shows its card sooner: before, the card waited 2.5 to 3 s for these steps. The call shows no card and signs nothing. See [Prepare a spoken request](/concepts/auth-methods/speak-to-sign#prepare-a-spoken-request).
- The Wallet keeps one summary for each note text for 5 minutes. A second try of a note shows the same sentence. Before, each try asked the model again, and the sentence could change.
- A note request asks for its summary while the Speak-to-Sign code loads. Before, it asked after the load.
- The summary route writes a name with a number in it with one request to the model: "COP31" becomes "COP". Since 0.70.1 such a name got a second request, which added about 0.5 s. A number that stands alone still gets the second request.
- The summary code is now a general part of the voice libraries, and the Wallet uses it:
  - `@seams/voice-verdict` **0.70.2** has `summaryRefusal`, the rules of a spoken summary.
  - `@seams/voice-sign/server` **0.70.2** has `writeSummary`. The Seams summary route calls it.
  - `@seams/voice-sign/summary` is a new entry with `createSummarySource`. The Wallet keeps its summaries with it. `@seams/wallet` now depends on `@seams/voice-sign`.
  - `@seams/voice-capture` **0.70.2** has no change.
- The Wallet iframe protocol stays **25.0.0**. The new message `PM_SPEAK_TO_SIGN_PREPARE` is optional: an app at 0.70.1 works with a Wallet host at 0.70.2. An app at 0.70.2 that calls `prepare` needs a Wallet host at 0.70.2.
- Install all three packages at 0.70.2. No new server setting, and no database migrations.

## Release 0.70.1

The browser SDK, server SDK and VoiceID plugin use **0.70.1**. It has no breaking change since 0.70.0.

Since 0.70.0:

- The result card of a transfer, a transaction or a message names a long receiver in its short form: an implicit account of 64 characters shows as "To 3e2210…7e55". A named account stays in full. The request that the person approves still names the full account. A request with no receiver shows its own text; before, the caption said "To null".
- The summary route of a note no longer fails for a name with a number in it, such as "COP31". The second request to the model names the word and says to write its number as words or to leave it out. If both replies still have such a word, the route keeps the letters of each word ("COP31" becomes "COP"). A number that stands alone still gives `summary_not_speakable`. The verifier still checks that the summary fits the note.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.1**. In `@seams/voice-capture`, a word that is longer than the line breaks inside the card. Before, such a word made the receipt and the button wider than the card.
- The Wallet iframe protocol stays **25.0.0**. An app at 0.70.0 works with a Wallet host at 0.70.1.
- Install all three packages at 0.70.1. No database migrations.

## Release 0.70.0

The browser SDK, server SDK and VoiceID plugin use **0.70.0**. An app has no breaking change since 0.69.2. A server operator must read the first item.

Since 0.69.2:

- The Speak-to-Sign verify route checks the TDX quote of each verifier call before it sends a verdict. The verdict key is bound to the OutLayer project, so every version of the project signs with it. The quote names the WASM that ran.
  - The quote must bind the output to the WASM hash `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY` and to the project. Intel must sign the quote, and `worker.outlayer.testnet` must approve its five measurements.
  - The route reads the record of the call from OutLayer. It tries once each second for up to 15 s.
  - If a check fails, or the record does not come in time, the route sends `failed` with `attestation_<code>`, for example `attestation_wasm_not_accepted` or `attestation_unavailable`.
  - A `verdict` has `attestationUrl`, the URL of the OutLayer record. Its `timing` has `attestationMs`.
  - Set `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY` to the WASM hash of the verifier version that the server calls. The route refuses a quote of another WASM. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign).
- Optional `SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY`: the WASM hash of the `venice` build of the verifier (0.14.0 and later), which sends the clip to Venice AI. With it and `SPEAK_TO_SIGN_NEAR_AI_API_KEY`, the server checks NEAR AI once a minute. Venice serves a call only while NEAR AI or its Whisper is down. Only the server chooses; the page cannot.
  - Venice AI runs in no TEE, so it can hear the recordings that it gets. The receipt of such a call shows "Speech to text: Venice AI, outside a TEE".
  - The quote check accepts only the WASM hash of the build that the route called. The verdict event has `transcriber` (`nearai` or `venice`).
  - The Wallet card reads a verifier version with a build name, such as `0.14.0+venice`.
- New refusal `transcriber_not_attested` (verifier 0.14.0 and later): the verifier could not check the TEE of NEAR AI's gateway, or Whisper's reply did not open with the checked key. No audio went out after a failed check. Before, the Wallet read this refusal as `verdict_mismatch`. The card says that the recording is not the cause, and offers Try again. An app before 0.70.0 cannot read this reason.
- The verify route gives each verifier run 40 s (was 15 s) and waits 60 s for the answer (was 30 s). The verifier waits up to 30 s for each model. A slow NEAR AI Whisper now gives a signed refusal (`transcriber_unavailable`), not a run that OutLayer stopped.
- The paid and signed Speak-to-Sign cards show a TEE receipt: "TEE receipt · Intel TDX · OutLayer", the voice of the account, the words, the summary check of a note, the verifier version of the verdict, and "View TDX quote". If the server sends no `attestationUrl`, the receipt has no link.
- VoiceID activation goes to the first recording as soon as VoiceID has loaded. Before, the person pressed "Activate VoiceID" and then "Record sample 1".
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.0**. A result card of `@seams/voice-capture` takes `receipt` (`PhraseReceipt`): a title, a source, checked rows and a link, between the caption and the detail line. In `@seams/voice-sign`, the default run limit is 40 s (was 15 s) and the default `timeoutMs` is 60,000 (was 20,000).
- The Wallet iframe protocol stays **25.0.0**. An app at 0.69.x works with a Wallet host at 0.70.0. This release needs no new verifier version.
- Deploy the server and the hosted Wallet together. Install all three packages at 0.70.0. No database migrations.

## Release 0.69.2

The browser SDK, server SDK and VoiceID plugin use **0.69.2**. It has no breaking change since 0.69.0.

Since 0.69.0:

- The Speak-to-Sign card's check reads "Checking what you said". With the verifier step after it, the line now fits the card.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.69.2**. In a form card (a card with a context, such as a note), the check's line slides into the microphone's circle, and the microphone turns into a tick. A card with no context keeps the ring and the seal.
- The Wallet iframe protocol stays **25.0.0**. The server and the verifier (0.13.0) do not change. An app at 0.69.0 works with a Wallet host at 0.69.2.
- Install all three packages at 0.69.2. No database migrations.

## Release 0.69.0

The browser SDK, server SDK and VoiceID plugin use **0.69.0**. This release has breaking changes for an app that signs community notes with Speak-to-Sign.

- `spoken.note` takes no `summary`. The app gives only the note. The Seams server writes the summary that the author reads aloud, so an app cannot put other words in the author's mouth.
  - New route `POST /speak-to-sign/v1/summary` on the Seams server. It reads the Wallet Session as the verify route does, takes `{ text }` (1 to 280 characters), and asks `Qwen/Qwen3.8-27B` on NEAR AI for one plain sentence. It checks the reply with the spoken rules and asks once more if a rule breaks. Failures are `summary_unreachable`, `summary_failed` and `summary_not_speakable`.
  - The route exists only when the server has `SPEAK_TO_SIGN_NEAR_AI_API_KEY`. `SPEAK_TO_SIGN_SUMMARY_MODEL` is optional.
  - Without a summary, the result is unavailable with `summary_unavailable`, and no card opens.
  - The voice card shows the note above the summary.
- The verifier is **0.13.0** (`1b7771544f3bcf5b3ba9e9bf3ac611f6abad21e7538f67b2666fd8aafc8cf930`). The Wallet sends `note_text` in place of `note_sha256_hex`. The verifier hashes the note and checks that the summary gives the main point of the note. A summary that does not fit is refused with `summary_mismatch`, and no answer with `summary_check_unavailable`. Set the 0.13.0 version key on the server before this Wallet ships.
- `add_note` and `rate_note` carry their verdict (`verdict_json`, `signature_b64`) to the notes contract, as a bet carries it in its `msg`. The co-signer refuses a call that carries another verdict. A note call without the two arguments, from an older Wallet, is still admitted.
- Wallet steps: an app can ask for Minimize on an anchored card (`minimize: true` on the presentation, or the `minimize` prop of `WalletStep`). The card draws Minimize beside Close, also during the check.
  - A press hides the card and keeps its request. The SDK runs `onMinimize(restore)`. `restore()` shows the card again, and the card also shows again when it needs the person. Both run `onRestore`.
  - The card reports its stage (`recording`, `checking` with done and total, `result`) with `onProgress`. It carries no approval data.
  - A Wallet host before 0.69.0 refuses `minimize`. Deploy the hosted Wallet before an app sends it.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.69.1**. The voice card:
  - shows a context (the note) above its sentence, and a form card shows Record in place of the voice line until it records;
  - takes a `colors` prop (with `surface3`, the colour of the check segments that have not run yet), and the voice line can draw pixels in place of sine waves;
  - turns the Beam off with `voiceBeam: 'none'`, and takes the theme's Beam from the first frame. Before, it showed the default Beam until recording started;
  - shows a result as one group: the seal, the headline, the details and the button. The seal takes `voiceSeal`, else `voiceLine`, of `appearance.theme.colors`;
  - places its grid rows by name. A host that sets its own rows must use the names.
- The Wallet iframe protocol is **25.0.0**: the note message has no summary. An app at 0.68.1 does not work with a Wallet host at 0.69.0, or the reverse.
- Deploy in this order: verifier 0.13.0 on OutLayer, then the server with its version key and the NEAR AI key, then the SDK and the hosted Wallet together.
- Install all three packages at 0.69.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds. No database migrations.
