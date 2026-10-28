# @seams/voiceid

Optional browser VoiceID authentication for `@seams/wallet` 0.27.0.
This package owns microphone capture, enrollment, local inference, voice UI,
and the model/runtime assets. The Wallet SDK owns custody, sessions, signing,
and the trusted host API. Existing voice enrollments keep their storage identity.

## Enable in the application

Install matching Wallet and VoiceID versions, then import the descriptor:

```ts
import { defineSeamsConfig } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';

const config = defineSeamsConfig({
  walletOrigin,
  relayerUrl,
  publishableKey,
  authMethods: [voiceIdAuthMethod()],
});
```

The root entry contains only the descriptor. Importing it or enabling it does not
load capture code, ONNX Runtime, or models. The selected VoiceID action starts
loading in the trusted Wallet iframe. Passkey and Email OTP flows remain independent.

The optional `VoiceBeam` and `VoiceAssistantCard` visuals are exported from
`@seams/voiceid/react`. Import `@seams/voiceid/styles` when using the card.

## Configure a signing challenge

Pass `voiceId.confirmationCommand` in the `options` of an existing reviewed NEAR
or EVM signing request:

```ts
const options = {
  voiceId: {
    confirmationCommand: 'Sell 100 NEAR for USDC at $5.5',
  },
};
```

The Wallet selects a short action-only challenge, such as “Approve this sale at
once” or “Let the sale go through.” It omits amounts, assets, and prices from the
spoken phrase. The full transaction review remains authoritative.

The leading English verb selects the phrase family: `sell`, `buy`, `swap`, or
`send`/`transfer`. Other wording uses the default random challenges. Commands
must be nonempty strings of at most 256 characters without control characters.
The application cannot supply the final phrase or change verification thresholds.
Retries choose a different phrase within the selected family.

This option changes wording only. It does not enable VoiceID for unsupported
transactions or interpret a trading command. VoiceID currently supports reviewed
native transfers on NEAR testnet and Arc testnet. Approval remains bound to the
complete signing request and review deadline, including the supplied command.
Enrollment and unlock retain the default phrase bank. This adds no model or API
request and keeps audio in the Wallet iframe.

## Install on the Wallet host

The Wallet host operator must also install this package. App configuration cannot
provide executable code or choose a plugin URL. A plain `@seams/wallet` deployment
contains no VoiceID implementation, engine, or models.

Compose a separate deployment directory from the two installed packages:

```sh
npx --no-install seams-voiceid-host ./wallet-with-voiceid
```

The command finds the installed Wallet package automatically, including pnpm layouts.
The output directory must be new and separate from the installed package trees.
Serve its `/wallet-service`, `/sdk/*`, and manifest files from the Wallet origin.
The command preserves the plain Wallet package and extends the existing asset
manifest with `/sdk/voiceid/*`.

Node deployments that compose a specific Wallet build can call the operation directly:

```ts
import { composeVoiceIdWalletAssets } from '@seams/voiceid/hosting';

await composeVoiceIdWalletAssets({
  walletPublicDirectory: './node_modules/@seams/wallet/dist/public',
  outputDirectory: './wallet-with-voiceid',
});
```

The host loads `/sdk/voiceid/host.js` only for an enabled VoiceID action. Both sides
check the host API version. A missing package produces an explicit installation
error. It cannot fall back to a different authentication method.

## Loading and storage

One cumulative indicator covers the engine WASM and three models. It then shows
**Preparing VoiceID…** until inference is ready. Downloaded assets are checked by
length and SHA-256 before use. Browser cache retention is best effort.

Interrupted downloads receive one automatic retry. A stalled download times out
after 30 seconds without progress. Further failures show **Retry loading** in the
same card. Retry keeps verified assets and voice enrollment. Close the card to
choose a passkey instead. A missing or incompatible host package requires an
operator fix; other module failures include connection and reload instructions.

Transaction reviews prepare VoiceID before enabling **Confirm with VoiceID**.
The voice attempt timer starts after that click. The transaction's expiry remains
in force while loading or retrying, so an expired transaction needs a fresh review.

VoiceID remembers the microphone used for usable audio in this browser. Enrollment,
unlock, and signing request that input even when the system default changes.
If it is unavailable, VoiceID can use the current default. Reconnecting the saved
microphone restores it. Interrupted recordings require a new attempt. Voice
enrollment and verification thresholds stay unchanged.
Choose **Use system microphone** on the retry prompt to switch inputs. The next
Record click uses the system default and remembers it after usable audio.

The package remains a roughly 27 MB cold payload before transfer compression.
Splitting it removes that payload from Wallet-only installations. It does not
reduce the bytes needed for the first VoiceID operation.

See [implementation notes](src/README.md) in the source repository for enrollment,
phrase freshness, action authentication, and browser storage behavior.
