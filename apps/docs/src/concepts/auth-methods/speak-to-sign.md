---
title: 'Experimental: Speak-to-Sign'
description: Experimental spoken NEAR payments from a vault contract that pays only after an attested verifier checks the owner's voice and words. Testnet only, not in a release.
---

# Experimental: Speak-to-Sign

::: warning Experimental
Speak-to-Sign is experimental. It runs on **NEAR testnet only**. It is **not in a
release** of `@seams/wallet`. Its packages, routes and contract can change
without notice. Do not use it with real funds.
:::

Speak-to-Sign lets a wallet owner pay by voice. The owner says a sentence such
as "Send 2 NEAR to alice dot testnet". A vault contract on NEAR pays only after
an attested verifier hears the owner's voice say the exact text of the request.

Speak-to-Sign is a transaction feature, not an authentication method. It never
unlocks a wallet or opens a session. It needs a [VoiceID](/concepts/auth-methods/voiceid)
enrollment and uses the VoiceID capture surface.

## How a spoken payment works

1. The Wallet reads the vault: the next nonce, the contacts and the pinned
   verifier key.
2. The Wallet shows the expected sentence on the VoiceID surface and records
   one clip of at most 8 s.
3. The Seams server sends the clip to the verifier on OutLayer, a NEAR
   off-chain compute service that runs code in a TEE (trusted execution
   environment).
4. The verifier gets a speaker embedding from a service on Phala Cloud and a
   transcript from NEAR AI at the same time. It compares the voice with the
   owner's enrolled template and the words with its own text of the request.
5. The verifier returns a signed verdict. The Wallet checks the signature
   against the key that the vault pinned.
6. The Wallet sends one `transfer_with_verdict` call. The vault rebuilds the
   request from its own state, checks the verdict, the nonce, the contact, the
   limits and audio reuse, and pays.

On testnet, one payment took 8.7 s from the end of speech until the vault
accepted it. These times come from a reference client, not from a Wallet run.

## Install

Install the three packages at the same version:

```sh
pnpm add @seams/wallet@VERSION @seams/voiceid@VERSION @seams/speak-to-sign@VERSION
```

Add the descriptor to `transactionFeatures` beside the VoiceID auth method:

```ts
import { SeamsWeb } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { speakToSign } from '@seams/speak-to-sign';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  transactionFeatures: [speakToSign({ vault: 'seams-wallet.testnet', network: 'testnet' })],
});

if (seams.speakToSign) {
  const result = await seams.speakToSign.requestTransfer({
    walletId,
    receiver: 'alice.testnet',
    amount: '2',
  });
}
```

`seams.speakToSign` exists only when the configuration names the descriptor.
The receiver must be an active contact of the vault. The amount is decimal
NEAR with at most two decimal places. The result `kind` is `sent`, `refused`,
`cancelled` or `unavailable`.

An app without the descriptor downloads no Speak-to-Sign code, WASM or assets.
An app with it loads nothing more until a spoken payment starts.

## Prepare the Wallet host

The operator of `walletOrigin` installs the same packages and composes the
assets into a new directory:

```sh
npx --no-install seams-speak-to-sign-host ./wallet-with-speak-to-sign
```

Deploy that directory as the static root of `walletOrigin`. The Wallet loads
`/sdk/speak-to-sign/host.js` only when a spoken payment starts. It refuses a
host plugin with a different host API version.

## Configure the Seams server

The Seams server adds `POST /speak-to-sign/v1/verify` only when all six
variables are set:

| Variable                                    | Testnet value                                                      |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `SPEAK_TO_SIGN_OUTLAYER_BASE_URL`           | `https://testnet-api.outlayer.ai`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_PROJECT`            | `seams-v1.testnet/voice-verifier`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `1e79327b0afa2a0f026aee519bd0d1801272e21cb21205d31788e4d1452231f0` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | The OutLayer payment key. Keep it in a secret store.               |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

The route requires an active Wallet Session. It refuses a request for another
owner's voice. It passes the verifier output back unchanged.

## The vault contract

The testnet vault is `seams-wallet.testnet`. It pinned the verifier key
`ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` at init.

| Method                  | Use                                                                         |
| ----------------------- | --------------------------------------------------------------------------- |
| `transfer_with_verdict` | Pays an active contact on a verdict that the pinned key signed.             |
| `authorize_enrollment`  | The owner allows one enrollment of exactly these recordings for 10 minutes. |
| `get_vault`             | Balance, limits and the next nonce of an owner.                             |
| `get_contacts`          | The owner's contacts and whether each one is active.                        |
| `get_verifier`          | The pinned verifier key.                                                    |

A new contact becomes active after the contact delay that the vault set at
init. The owner can withdraw without voice after a 10-minute wait.

## Trust model

- The vault pays only on a verdict that the pinned key signed for this exact
  request: network, vault, owner, receiver, amount and nonce.
- The verifier runs in OutLayer's TEE. The OutLayer project owner can deploy a
  new version that signs with the same key.
- The speaker check runs in a Phala dstack CVM with a pinned key. The Phala app
  owner can change its code and keep that key.
- NEAR AI makes the transcript. Transcripts carry no signature, so the verifier
  trusts the NEAR AI gateway.
- Code at `walletOrigin` cannot change the request after the owner speaks: the
  words then do not match.

Unlike a [VoiceID](/concepts/auth-methods/voiceid) unlock, the audio leaves the
browser. It goes to OutLayer, Phala and NEAR AI, and the voice template stays in
OutLayer storage.

Read next:

- [VoiceID](/concepts/auth-methods/voiceid)
- [Wallet iframe](/concepts/custody/wallet-iframe)
