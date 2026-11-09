---
title: 'Experimental: Speak-to-Sign'
description: Experimental spoken NEAR payments from the owner's own account, approved by an attested verifier that checks the owner's voice and words. Testnet only.
---

# Experimental: Speak-to-Sign

::: warning Experimental
Speak-to-Sign is experimental. It runs on **NEAR testnet only**. Release 0.54.0
is its first release, and 0.56.0 adds `enroll`. Its packages and routes can
change without notice. Do not use it with real funds.
:::

Speak-to-Sign lets a wallet owner pay by voice. The owner says a sentence such
as "Send 2 NEAR to alice dot testnet". An attested verifier checks that the
owner's voice says the exact text of the request, and signs a verdict. The
Wallet checks the verdict and sends the transfer from the owner's own account.
The spoken sentence is the confirmation: an accepted payment shows no confirm
and no passkey.

Speak-to-Sign is a transaction feature, not an authentication method. It never
unlocks a wallet or opens a session. It needs a [VoiceID](/concepts/auth-methods/voiceid)
enrollment and uses the VoiceID capture surface.

## How a spoken payment works

1. The Wallet shows the expected sentence on the VoiceID surface and records
   one clip of at most 8 s.
2. The Seams server sends the clip and the typed request to the verifier on
   OutLayer, a NEAR off-chain compute service that runs code in a TEE (trusted
   execution environment).
3. The verifier gets a speaker embedding from a service on Phala Cloud and a
   transcript from NEAR AI at the same time. It compares the voice with the
   owner's enrolled template and the words with its own text of the request.
   The amount must match exactly. A word that holds no value can be a
   sound-alike: "year" for "NEAR", "sent" for "send" or "testnode" for
   "testnet". The receiver can be a sound-alike of the account name.
   Then a policy step can ask for more approval.
4. The verifier returns a signed verdict that expires after 120 s. The Wallet
   checks it against the verifier key that the Wallet pins: the request, the
   spoken text, the recording, the expiry and the signature.
5. On `accept`, the Wallet signs the transfer through the owner's Wallet
   Session with no confirm and sends it. On `step_up`, the owner approves
   again on the confirm (a passkey on a passkey session).

A spoken payment needs a warm Wallet Session. If the session is locked or
expired, the Wallet asks the owner to unlock first.

## Install

Install the three packages at the same version:

```sh
pnpm add @seams/wallet@0.58.0 @seams/voiceid@0.58.0 @seams/speak-to-sign@0.58.0
```

Add the descriptor to `transactionFeatures` beside the VoiceID auth method:

```ts [Partial example]
import { SeamsWeb } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { speakToSign } from '@seams/speak-to-sign';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  transactionFeatures: [speakToSign({ network: 'testnet' })],
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
The receiver can be any named NEAR account that the owner can say, such as
`alice.testnet`. The result is `refused` with `receiver_not_speakable` for an
implicit (64-hex) or `0x` account, and with `receiver_missing` for an account
that does not exist. The amount is decimal NEAR with at most two decimal
places. The result `kind` is `sent`, `refused`, `cancelled` or `unavailable`.
A `sent` result has `approval`: `voice` when the verdict alone approved the
payment, and `voice_and_passkey` when a policy rule asked for the confirm
again. Today the verifier has one stub rule: a voice payment above 10 NEAR needs
a passkey.

An app without the descriptor downloads no Speak-to-Sign code, WASM or assets.
An app with it loads nothing more until a spoken payment starts.

## Set up the owner

Before the first spoken payment, the owner needs:

1. VoiceID on for the wallet:
   `seams.registration.activateAuthMethod({ walletId, method: 'voiceid' })`.
2. A voice template at the verifier:

```ts [Partial example]
const enrollment = await seams.speakToSign.enroll({ walletId });
if (enrollment.kind === 'enrolled') {
  console.log('template', enrollment.templateEpoch);
}
```

`enroll` shows three short phrases on the VoiceID surface. Then the owner
approves one signed message (NEP-413) on the wallet confirm. The message names
the digest of exactly these recordings. The verifier checks that a full-access
key of the owner signed it, and enrolls only that audio. A new enrollment
replaces the template. The result `kind` is `enrolled`, `refused`, `cancelled`
or `unavailable`.

The owner's account pays the gas of each transfer, about 0.00005 NEAR on
testnet.

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
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | The OutLayer payment key. Keep it in a secret store.               |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

The route reads the caller's Wallet Session as identity. It answers 401
`unauthorized` without a session and 503 `session_unavailable` when the
session store fails, and it spends no signing use. It refuses a request for
another owner's voice. It serves the verifier's `verify` and `enroll`
operations, accepts a body of at most 1,100 KB, and passes the verifier output
back unchanged.

## The verifier key

The verifier is the OutLayer project `seams-v1.testnet/voice-verifier`. Its
verdict key `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` is bound to
the project and stays the same across versions. The Wallet pins that key in its
own code. It never takes the key from the app, because the app chooses the
Seams server URL. The Wallet pays each verdict at most once, and only for a
recording that it made in the same flow.

## Trust model

- The Wallet signs only after a verdict that the pinned key signed for this
  exact request: network, owner, receiver and amount, and a recording of this
  flow. The Wallet Session and the Seams co-signer still take part in every
  signature.
- No contract limits a spoken payment. A payment above the policy rule's
  amount needs the confirm again.
- The verifier runs in OutLayer's TEE. The OutLayer project owner can deploy a
  new version that signs with the same key.
- The speaker check runs in a Phala dstack CVM with a pinned key. The Phala app
  owner can change its code and keep that key.
- NEAR AI makes the transcript. Transcripts carry no signature, so the verifier
  trusts the NEAR AI gateway.
- Code at `walletOrigin` cannot change the request after the owner speaks: the
  words then do not match.
- Any named account can receive a spoken payment. If the voice check accepts a
  clone or a replay of the owner's voice, the payment can go to any named
  account. Below the step-up amount, the voice alone pays.
- The verifier accepts a receiver name that sounds alike: the same sound key,
  or a key one sound apart with the same first two sounds, such as
  `alicia.testnet` for `alice.testnet`. So it cannot tell apart two such
  accounts, for example `bob.testnet` and `bobb.testnet`. The owner must read
  the account on the screen before speaking.

Unlike a [VoiceID](/concepts/auth-methods/voiceid) unlock, the audio leaves the
browser. It goes to OutLayer, Phala and NEAR AI, and the voice template stays in
OutLayer storage.

Read next:

- [VoiceID](/concepts/auth-methods/voiceid)
- [Wallet iframe](/concepts/custody/wallet-iframe)
