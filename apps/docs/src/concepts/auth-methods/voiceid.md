---
title: VoiceID
description: Install the optional VoiceID package, prepare the Wallet host, and let wallet owners enroll, unlock, and approve transfers with their voice.
---

# VoiceID

VoiceID is an optional browser authentication method in SDK **0.24.0**.
The application enables support. Each wallet owner then chooses whether to enroll.
Speaker matching and phrase recognition run locally inside the trusted Wallet iframe.
The Wallet keeps its existing custody, session, policy, and threshold signing checks.

## Install and configure

Install matching package versions in your application:

```sh
pnpm add @seams/wallet@0.24.0 @seams/voiceid@0.24.0
```

Import the descriptor from the optional package and add `authMethods` to your existing configuration.
This example enables NEAR and Arc testnets:

<<< ../../examples/voiceid.ts#configuration

Pass the configuration to `SeamsWebProvider` as shown in
[Wallet setup and authentication](/examples/wallet-setup-and-authentication#configure-the-provider).
Importing the descriptor and enabling support download no engine or models.
Passkey and Email OTP flows load no VoiceID assets.

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

## Unlock and approve transfers

The owner can select VoiceID in the Wallet sign-in menu. A custom unlock action uses
the wallet ID and the enrolled `walletAuthMethodId`:

<<< ../../examples/voiceid.ts#unlock

After VoiceID unlock, use the existing [transaction APIs](/examples/signing).
Reviewed NEAR and Arc testnet transfers show **Confirm with VoiceID**.
The owner reads the displayed short English phrase at a normal pace.
Each review requires a fresh voice check. The speaker similarity threshold remains **0.5**.
Phrase recognition allows bounded differences to handle natural speech.
The displayed phrase checks freshness. The transaction review defines the operation being approved.

Enabling or enrolling VoiceID does not select it for passkey or Email OTP signing.
Adding signers or authentication methods and changing enrollment retain their action-level authorization checks.

## Loading and storage

The first VoiceID operation downloads about **27 MB before transfer compression**.
One progress indicator covers the engine and all three models. It then shows **Preparing VoiceID…** until inference is ready.
Verified assets are cached when browser storage permits. Clearing site data or browser eviction can require another download.

Audio stays local and is discarded after processing. The Wallet origin stores the enrollment template and device credentials.
Saved enrollment and added samples have no time or usage limit.
Removing the enrollment or clearing Wallet-origin storage requires enrollment again.
**Manage voice** provides recognition improvements, reset, and re-recording with fresh owner confirmation.

VoiceID depends on that browser's device credentials and local speaker checks.
Recorded or synthetic speech resistance is not a production accuracy guarantee.
Keep a passkey or Email OTP available for enrollment management.
