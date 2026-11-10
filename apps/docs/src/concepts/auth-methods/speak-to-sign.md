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
   one clip of at most 8 s. The card stays open and shows each next step.
2. The Seams server sends the clip and the typed request to the verifier on
   OutLayer, a NEAR off-chain compute service that runs code in a TEE (trusted
   execution environment). While the verifier works, the Wallet reads the
   access-key nonce and a recent block hash for the payment. It signs nothing
   before the verdict.
3. The verifier gets a speaker embedding from a service on Phala Cloud and a
   transcript from NEAR AI at the same time. It compares the voice with the
   owner's enrolled template and the words with its own text of the request.
   The amount must match exactly. A word that holds no value can be a
   sound-alike: "year" for "NEAR", "sent" for "send" or "testnode" for
   "testnet". The receiver can be a sound-alike of the account name. The
   owner can say a separator in other words ("period" for "dot", "hyphen" for
   "dash"), or leave out the separators and "testnet": "seams v one" is
   `seams-v1.testnet`.
   Then a policy step can ask for more approval.
4. The verifier returns a signed verdict that expires after 120 s. The Wallet
   checks it against the verifier key that the Wallet pins: the request, the
   spoken text, the recording, the expiry and the signature.
5. On `accept`, the Wallet signs the transfer through the owner's Wallet
   Session with no confirm and sends it. On `step_up`, the card asks the owner
   to approve again with the session's own method (a passkey on a passkey
   session). The signing request carries the verdict, and the Seams co-signer
   checks it again before it adds its part of the signature (see
   [Trust model](#trust-model)).
6. The card shows the result: the paid transfer with a link, or the reason
   for a refusal. After a refusal of the words or the voice, the owner can
   record the sentence again, up to five recordings in all. The call returns
   when the owner closes the card.

A spoken payment needs a warm Wallet Session. If the session is locked or
expired, the Wallet asks the owner to unlock first.

## Install

Install the three packages at the same version:

```sh
pnpm add @seams/wallet@0.65.0 @seams/voiceid@0.65.0 @seams/speak-to-sign@0.65.0
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

const voice = seams.near.speakToSign;
if (voice) {
  const result = await voice.signAndSendTransaction({
    walletId,
    transaction: { receiverId: 'guest-book.testnet', actions },
    summary: 'Sign the guest book.',
  });
  if (result.kind === 'approved') console.log(result.result.transactionHash);
}
```

`seams.near.speakToSign` exists only when the configuration names the
descriptor. It is the NEAR signer by voice: each call has the name of the
`seams.near` call that it replaces, and takes the same transaction, delegate
action or message with a `summary`.

| Normal call                   | Voice call                                | `result` of an approved call      |
| ----------------------------- | ----------------------------------------- | --------------------------------- |
| `near.signAndSendTransaction` | `near.speakToSign.signAndSendTransaction` | `{ transactionHash }`             |
| `near.signTransaction`        | `near.speakToSign.signTransaction`        | The signed transaction            |
| `near.signDelegateAction`     | `near.speakToSign.signDelegateAction`     | The signed delegate action        |
| `near.signMessage`            | `near.speakToSign.signMessage`            | The NEP-413 signature and nonce   |

- The owner reads the summary aloud: 1 to 12 plain words (`summaryRefusal`).
- The verdict binds what the Wallet signs: the receiver and the action bytes
  of a transaction or a delegate action, or the bytes of a NEP-413 message. The
  Seams co-signer checks the verdict again against the bytes that it signs.
- The application writes the summary. The voice proves who approves and which
  words this person said. It does not prove that the summary describes the
  request.
- The Wallet sets the sender of a delegate action and draws the nonce of a
  message.

Every signing call returns one result shape. The `kind` is `approved`,
`refused`, `cancelled` or `unavailable`. An `approved` result holds `result`,
`times` and `approval`: `voice` when the verdict alone approved the request,
and `voice_and_passkey` when a policy rule asked for the confirm again.

## Typed calls

`seams.near.speakToSign.typed` has calls whose sentence comes from the request
fields, so the owner says what the Wallet signs:

```ts [Partial example]
const result = await seams.near.speakToSign.typed.transfer({
  walletId,
  receiver: 'alice.testnet',
  amount: '2',
});
```

| Call                  | The owner says                                    |
| --------------------- | ------------------------------------------------- |
| `typed.transfer`      | "send two near to alice dot testnet"              |
| `typed.note`          | The short summary of a community note             |
| `typed.rating`        | "this note is helpful"                            |
| `typed.mergeApproval` | "merge pull request forty two into main"          |
| `typed.bet`           | "bet zero point five usdc yes on market nine"     |

For `typed.transfer`, the receiver can be any named NEAR account that the owner
can say, such as `alice.testnet`. The result is `refused` with
`receiver_not_speakable` for an implicit (64-hex) or `0x` account, and with
`receiver_missing` for an account that does not exist. The amount is decimal
NEAR with at most two decimal places. Today the verifier has one stub rule: a
voice transfer above 10 NEAR needs a passkey.

`onProgress` is optional on every call. It gets each stage of the request, in
order:

| `stage`            | When                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| `recording_sent`   | The Wallet sent the recording to the Seams verify route.             |
| `verifier_running` | The Seams server called the verifier.                                |
| `verdict`          | The verifier answered. `ms` holds its stage times.                   |
| `step_up`          | A policy rule asks for a fresh approval. `policyText` is the rule.   |
| `transaction_sent` | The signed transaction left for the network.                         |
| `settled`          | NEAR returned the final outcome. `transactionHash` names it.         |

The verifier sends its result only at the end, so no event comes between
`verifier_running` and `verdict`. An error in the listener does not stop the
request.

When the Seams co-signer refuses the verdict, the result is `refused` with
`cosigner_refused`. `detail` then holds the co-signer's reason, for example
`reused` or `request_mismatch`. Nothing was signed. Speak-to-Sign sets no
amount limit of its own.

An app without the descriptor downloads no Speak-to-Sign code, WASM or assets.
An app with it loads nothing more until a spoken payment starts.

## Set up the owner

Before the first spoken payment, the owner needs a voice template at the
verifier:

```ts [Partial example]
const enrollment = await seams.near.speakToSign.enroll({ walletId });
if (enrollment.kind === 'enrolled') {
  console.log('template', enrollment.templateEpoch);
}
```

`enroll` shows three short phrases on the VoiceID surface. If the wallet has no
VoiceID yet, `enroll` turns it on first, and the three samples of that VoiceID
enrollment are also the verifier's recordings. So the owner reads one set of
phrases for both. Then the owner approves one signed message (NEP-413) on the
wallet confirm. The message names the digest of exactly these recordings. The
verifier checks that a full-access key of the owner signed it, and enrolls only
that audio. A new enrollment replaces the template. The result `kind` is
`enrolled`, `refused`, `cancelled` or `unavailable`.

If the owner turned VoiceID off, `enroll` returns `unavailable` with the reason
`voiceid_unavailable`. Turn it on again with
`seams.registration.setAuthMethodEnabled({ walletId, method: 'voiceid', enabled: true })`.

The owner's account pays the gas of each transfer, about 0.00005 NEAR on
testnet.

## Spoken community notes

The same flow can sign a community note or a note rating on a notes contract
with `add_note({ post_id, text, summary })` and `rate_note({ note_id, rating })`.
The author types the note and reads aloud only a short summary. The verdict
binds the full note by its SHA-256. Wallet core builds the one call, with no
deposit and no confirm.

```ts [Partial example]
import { summaryRefusal } from '@seams/wallet';

if (summaryRefusal(summary) === null) {
  await seams.near.speakToSign.typed.note({
    walletId,
    contract: 'community-notes.testnet',
    postId: 7,
    text: 'The city closes one lane for two weeks. The bridge stays open.',
    summary: 'Only one lane closes for two weeks.',
  });
}
await seams.near.speakToSign.typed.rating({
  walletId,
  contract: 'community-notes.testnet',
  noteId: 3,
  rating: 'helpful',
});
```

- A summary has 1 to 12 words of ASCII letters. Write numbers as words. Digits,
  apostrophes, hyphens, URLs and handles give `summary_not_speakable`.
- A rating is said as "this note is helpful", "this note is somewhat helpful"
  or "this note is not helpful".
- A summary of 4 or more words also passes with one word heard differently or
  dropped, but never with an added or dropped "not".
- Notes need verifier 0.4.0 or later.

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
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | The OutLayer payment key. Keep it in a secret store.               |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

The route reads the caller's Wallet Session as identity. It answers 401
`unauthorized` without a session and 503 `session_unavailable` when the
session store fails, and it spends no signing use. It refuses a request for
another owner's voice. It serves the verifier's `verify` and `enroll`
operations and accepts a body of at most 1,100 KB. A refusal before the
verifier call is a JSON error. After the checks, the route answers with
`text/event-stream`: the event `verifier_running` at once, then one `verdict`
event with the verifier output unchanged, or one `failed` event with a fixed
code, such as `verifier_timeout`.

The same six variables turn on the co-signer's verdict check. It records each
accepted verdict in the signer database table `speak_to_sign_voice_verdicts`
(D1 migration `0089_speak_to_sign_voice_verdicts.sql`). Each new record deletes
the wallet's records that are older than 24 hours. The server log has one
warning line for each refusal, with the reason, the wallet and the signing
request. A Seams server without the variables refuses every signing request
that carries a verdict, with the reason `unavailable`.

## The verifier key

The verifier is the OutLayer project `seams-v1.testnet/voice-verifier`. Its
verdict key `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` is bound to
the project and stays the same across versions. The Wallet pins that key in its
own code. It never takes the key from the app, because the app chooses the
Seams server URL. The Wallet pays at most once in each flow, and only for a
recording that it made in the same flow.

## Trust model

- The Wallet signs only after a verdict that the pinned key signed for this
  exact request: network, owner, receiver and amount, and a recording of this
  flow. The Wallet Session and the Seams co-signer still take part in every
  signature.
- The Seams co-signer checks the verdict again before it adds its part of the
  signature. It checks only a signing request that carries a verdict. A
  normal signing request carries none, and the co-signer handles it as before.
  The co-signer checks these items:
  - The signature, against the same pinned verifier key.
  - The expiry: at most 120 s after the verifier signed.
  - The transaction. The co-signer reads the unsigned transaction that it is
    asked to sign and builds the request again: one transfer to the receiver
    with the amount, or one `add_note` or `rate_note` call with no deposit. The
    digest of that request must equal the digest in the verdict.
  - The owner. The transaction signer must be the NEAR account of the Wallet
    Session.
  - Single use. The co-signer records each verdict that it accepts and refuses
    it for another signing request.
  - The voice limits of each wallet: at most 10 NEAR in one voice payment and
    20 NEAR in any 24 hours. A refused payment does not count. An admitted
    payment counts, also when it then fails on chain.
  - A `step_up` verdict. The co-signer accepts it only with a fresh approval:
    a passkey or Email OTP step-up of the same operation, or a new VoiceID
    unlock after the verifier signed the verdict. Such a payment is not
    voice-only, so the voice limits do not apply to it. On a wallet with only
    VoiceID, the fresh approval is a second voice check (VoiceID on the
    device), so the voice approves that payment twice.
- The co-signer check protects against a fault in the Wallet's Speak-to-Sign
  path, and it keeps the limits and single use on the server. It does not stop
  code at `walletOrigin` that leaves the verdict out, because such code can
  already sign in an open Wallet Session.
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
  `alicia.testnet` for `alice.testnet`. It also accepts the name without its
  separators and network suffix. So it cannot tell apart two such accounts,
  for example `bob.testnet` and `bobb.testnet`, or `bob-1.testnet` and
  `bob1.testnet`. The owner must read the account on the screen before
  speaking.

Unlike a [VoiceID](/concepts/auth-methods/voiceid) unlock, the audio leaves the
browser. It goes to OutLayer, Phala and NEAR AI, and the voice template stays in
OutLayer storage.

Read next:

- [VoiceID](/concepts/auth-methods/voiceid)
- [Wallet iframe](/concepts/custody/wallet-iframe)
