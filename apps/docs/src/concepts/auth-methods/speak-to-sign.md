---
title: 'Experimental: Speak-to-Sign'
description: Experimental spoken NEAR payments from a vault contract that pays only after an attested verifier checks the owner's voice and words. Testnet only.
---

# Experimental: Speak-to-Sign

::: warning Experimental
Speak-to-Sign is experimental. It runs on **NEAR testnet only**. Release 0.54.0
is its first release, and 0.56.0 adds `enroll`. Its packages, routes and
contract can change without notice. Do not use it with real funds.
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
pnpm add @seams/wallet@0.56.2 @seams/voiceid@0.56.2 @seams/speak-to-sign@0.56.2
```

Add the descriptor to `transactionFeatures` beside the VoiceID auth method:

```ts [Partial example]
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

## Set up the owner

Before the first spoken payment, the owner needs:

1. VoiceID on for the wallet:
   `seams.registration.activateAuthMethod({ walletId, method: 'voiceid' })`.
2. A vault with an active contact. The owner calls `create_vault` with a
   deposit (the vault keeps 0.1 NEAR for storage) and `add_contact`, for
   example with `seams.near.signAndSendTransaction`.
3. A voice template at the verifier:

```ts [Partial example]
const enrollment = await seams.speakToSign.enroll({ walletId });
if (enrollment.kind === 'enrolled') {
  console.log('template', enrollment.templateEpoch, 'tx', enrollment.transactionHash);
}
```

`enroll` shows three short phrases on the VoiceID surface. Then the owner
approves one `authorize_enrollment` call for the digest of exactly these
recordings. The verifier enrolls only audio that the vault authorized, for 10
minutes. A new enrollment replaces the template. The result `kind` is
`enrolled`, `refused`, `cancelled` or `unavailable`.

Create the vault and a contact with two owner calls on the vault contract,
for example with `wallet.near` from `useSeams()`. Each call opens the wallet
confirmation:

```ts [Partial example]
import { functionCall, type BoundNearSigner } from '@seams/wallet/react';

const VAULT = 'seams-wallet.testnet';
const GAS = '30000000000000';

async function setUpVault(near: BoundNearSigner, contact: string): Promise<void> {
  // 0.15 NEAR: the vault keeps 0.1 NEAR for storage.
  await near.signAndSendTransaction({
    receiverId: VAULT,
    actions: [
      functionCall({
        method: 'create_vault',
        args: {},
        gas: GAS,
        deposit: '150000000000000000000000',
      }),
    ],
  });
  await near.signAndSendTransaction({
    receiverId: VAULT,
    actions: [
      functionCall({
        method: 'add_contact',
        args: { account_id: contact },
        gas: GAS,
        deposit: '0',
      }),
    ],
  });
}
```

On testnet the owner account needs about 0.3 NEAR: `create_vault` takes 0.15
NEAR, and NEAR charges prepaid gas up front, about 0.03 NEAR for each 30 Tgas
call and 0.051 NEAR for each spoken payment.

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
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `b4d68fb64f8be57382794bd9a8fce60f1655e869260b3fda88953dddf001fdd0` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | The OutLayer payment key. Keep it in a secret store.               |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

The route reads the caller's Wallet Session as identity. It answers 401
`unauthorized` without a session and 503 `session_unavailable` when the
session store fails, and it spends no signing use. It refuses a request for
another owner's voice. It serves the verifier's `verify` and `enroll`
operations, accepts a body of at most 1,100 KB, and passes the verifier output
back unchanged.

## The vault contract

The testnet vault is `seams-wallet.testnet`. It pinned the verifier key
`ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` at init.

| Method                   | Use                                                                               |
| ------------------------ | --------------------------------------------------------------------------------- |
| `create_vault`           | Creates the owner's vault with the attached deposit (0.1 NEAR stays for storage). |
| `add_contact`            | Adds a contact (`account_id`) that a spoken payment can pay.                      |
| `transfer_with_verdict`  | Pays an active contact on a verdict that the pinned key signed.                   |
| `authorize_enrollment`   | The owner allows one enrollment of exactly these recordings for 10 minutes.       |
| `get_pending_enrollment` | The owner's live enrollment authorization, which the verifier reads.              |
| `get_vault`              | Balance, limits and the next nonce of an owner.                                   |
| `get_contacts`           | The owner's contacts and whether each one is active.                              |
| `get_verifier`           | The pinned verifier key.                                                          |

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
