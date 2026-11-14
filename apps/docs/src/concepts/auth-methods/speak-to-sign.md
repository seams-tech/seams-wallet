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
   The Wallet seals the clip to the verifier's audio key before it sends it,
   so the Seams server carries only ciphertext. The verifier opens the clip
   inside its TEE.
2. The Seams server sends the clip and the typed request to the verifier on
   OutLayer, a NEAR off-chain compute service that runs code in a TEE (trusted
   execution environment). While the verifier works, the Wallet reads the
   access-key nonce and a recent block hash for the payment. It signs nothing
   before the verdict.
3. The verifier gets a speaker embedding from a service on Phala Cloud and a
   transcript from NEAR AI at the same time (from Venice AI while NEAR AI
   Whisper is down, if the server has the `venice` build; see
   [Configure the Seams server](#configure-the-seams-server)). It compares the
   voice with the
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

Install the two packages at the same version. Speak-to-Sign is a part of
`@seams/wallet`: it has no package of its own.

```sh
pnpm add @seams/wallet@0.71.0 @seams/voiceid@0.71.0
```

Add the `spoken` descriptor to `approvals`, beside the VoiceID auth method:

```ts [Partial example]
import { SeamsWeb, spoken } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  approvals: [spoken({ network: 'testnet' })],
});

const result = await seams.near.signAndSendTransaction({
  receiverId: 'guest-book.testnet',
  actions,
  approval: { kind: 'spoken', summary: 'Sign the guest book.' },
});
if (result.kind === 'approved') console.log(result.result.transactionHash);
```

The normal NEAR sign calls take `approval`. With it, the owner approves by
voice in place of the Wallet's confirm, and the call returns a result with a
`kind`. Without it, the call is the normal call.

| Call with `approval`          | `result` of an approved call      |
| ----------------------------- | --------------------------------- |
| `near.signAndSendTransaction` | `{ transactionHash }`             |
| `near.signTransaction`        | The signed transaction            |
| `near.signDelegateAction`     | The signed delegate action        |
| `near.signMessage`            | The NEP-413 signature and nonce   |

- `summary` is the sentence that the owner reads aloud: 1 to 12 plain words
  (`summaryRefusal`).
- The verdict binds what the Wallet signs: the receiver and the action bytes
  of a transaction or a delegate action, or the bytes of a NEP-413 message. The
  Seams co-signer checks the verdict again against the bytes that it signs.
- The application writes the summary. The voice proves who approves and which
  words this person said. It does not prove that the summary describes the
  request.
- The Wallet sets the sender of a delegate action and draws the nonce of a
  message.
- `walletSession` is optional, as for the normal calls. Without it, the call
  is for the authenticated wallet.
- A call with `approval` throws if `approvals` does not hold the descriptor.

Every call with `approval` returns one result shape, and it does not throw for
a refusal. The `kind` is `approved`, `refused`, `cancelled` or `unavailable`.
An `approved` result holds `result`, `times` and `approval`: `voice` when the
verdict alone approved the request, and `voice_and_passkey` when a policy rule
asked for the confirm again. It also holds `attestationUrl`: the public
OutLayer record of the verifier call, with its TDX quote. This is the link
"View TDX quote" of the result card. It is `null` when OutLayer gave no record.

## Typed calls

`seams.near.spoken` has calls whose sentence comes from the request fields, so
the owner says what the Wallet signs. It exists only when `approvals` holds the
descriptor.

```ts [Partial example]
const result = await seams.near.spoken?.transfer({
  receiver: 'alice.testnet',
  amount: '2',
});
```

| Call                   | The owner says                                    |
| ---------------------- | ------------------------------------------------- |
| `spoken.transfer`      | "send two near to alice dot testnet"              |
| `spoken.note`          | The summary of a community note, which Seams writes |
| `spoken.rating`        | "this note is helpful"                            |
| `spoken.mergeApproval` | "merge pull request forty two into main"          |
| `spoken.bet`           | "bet zero point five usdc yes on market nine"     |

For `spoken.transfer`, the receiver can be any named NEAR account that the owner
can say, such as `alice.testnet`. The result is `refused` with
`receiver_not_speakable` for an implicit (64-hex) or `0x` account, and with
`receiver_missing` for an account that does not exist. The amount is decimal
NEAR with at most two decimal places. Today the verifier has one stub rule: a
voice transfer above 10 NEAR needs a passkey.

`onProgress` is optional: in `approval` for a normal call, and in the request
of a typed call. It gets each stage of the request, in order:

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

`autoStart` is optional, in the same place as `onProgress`. With `true`
(the default for a request), the card records when it opens, with no press on
Record. With `false`, the owner presses Record. If the browser does not start
audio without a press, the card keeps its Record button.

When the Seams co-signer refuses the verdict, the result is `refused` with
`cosigner_refused`. `detail` then holds the co-signer's reason, for example
`reused` or `request_mismatch`. Nothing was signed. Speak-to-Sign sets no
amount limit of its own.

The flow of Speak-to-Sign is a part of the Wallet that loads on the first spoken
request. A Wallet without the descriptor never loads it.

## Set up the owner

Before the first spoken payment, the owner needs a voice template at the
verifier:

```ts [Partial example]
const enrollment = await seams.near.spoken?.enroll();
if (enrollment?.kind === 'enrolled') {
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

By default, the owner presses Record for each phrase. With
`enroll({ autoStart: true })`, each phrase card records when it opens. This
applies to a wallet that has VoiceID. When `enroll` turns VoiceID on first,
the VoiceID cards still wait for a press on each sample.

If the owner turned VoiceID off, `enroll` returns `unavailable` with the reason
`voiceid_unavailable`. Turn it on again with
`seams.registration.setAuthMethodEnabled({ walletId, method: 'voiceid', enabled: true })`.

The owner's account pays the gas of each transfer, about 0.00005 NEAR on
testnet.

## Spoken community notes

The same flow can sign a community note or a note rating on a notes contract
with `add_note({ post_id, text, summary, verdict_json, signature_b64 })` and
`rate_note({ note_id, rating, verdict_json, signature_b64 })`.
The author types the note and reads aloud only a short summary of it. The
application gives the note, not the summary:

1. The Wallet asks the Seams server for the summary
   (`POST /speak-to-sign/v1/summary`). The server writes it from the note with
   a chat model on NEAR AI.
2. The card shows the note above the summary. The author says the summary.
3. The verifier gets the note text. It binds the note by its SHA-256, and it
   asks JEV (a NEAR AI model that answers yes-or-no questions) if the summary
   gives the main point of the note. A summary that does not fit gives
   `summary_mismatch`.

So the application cannot choose the words that the author says. Wallet core
builds the one call, with no deposit and no confirm. The call carries the
verdict and its signature, so the notes contract can check the verdict itself.
A contract that does not check it ignores the two arguments.

```ts [Partial example]
await seams.near.spoken?.note({
  contract: 'community-notes.testnet',
  postId: 7,
  text: 'The city closes one lane for two weeks. The bridge stays open.',
});
await seams.near.spoken?.rating({
  contract: 'community-notes.testnet',
  noteId: 3,
  rating: 'helpful',
});
```

- A note has 1 to 280 characters.
- Without a summary from the server, the result is `unavailable` with the
  reason `summary_unavailable`, and no card opens. The Wallet checks the
  server's summary with the rules of `summaryRefusal`: 1 to 12 words of ASCII
  letters, numbers as words. A summary that breaks them gives
  `summary_not_speakable`.
- Without an answer from JEV, the verifier refuses with
  `summary_check_unavailable`.
- A rating is said as "this note is helpful", "this note is somewhat helpful"
  or "this note is not helpful".
- A summary of 4 or more words also passes with one word heard differently or
  dropped, but never with an added or dropped "not".
- Notes need verifier 0.13.0 or later. An older verifier refuses the note text
  with `unsupported`.

### Prepare a spoken request

The summary takes 0.5 to 2 s, and the Wallet loads its Speak-to-Sign code for
the first request. To show the card sooner, call `prepare` when your form is
on the screen, before the owner presses your button:

```ts [Partial example]
// When the note is in the form, and again when its text changes.
void seams.near.spoken?.prepare({ note: { text: noteText } });
```

- The Wallet loads its Speak-to-Sign code and reads the VoiceID state. With
  `note`, it also asks the Seams server for the summary of that text.
- The Wallet keeps one summary for each note text for 5 minutes. The
  `spoken.note` call with the same text shows that summary with no new
  request. A second try of the note shows the same sentence.
- `prepare` shows no card, records nothing and signs nothing. Its result is
  `{ kind: 'ready' }` or `{ kind: 'unavailable', reason }`. You do not need
  the result: the request that follows does the same steps itself.
- `prepare()` with no note prepares a transfer, a rating or a bet.
- Your application still gives no summary. The Seams server writes it with
  `writeSummary` of `@seams/voice-sign/server`, and the Wallet keeps it with
  `createSummarySource` of `@seams/voice-sign/summary`. An application with
  no Seams Wallet can use both parts.

## Prepare the Wallet host

Speak-to-Sign needs no step of its own on the Wallet host. Its flow is in
`@seams/wallet`. It records on the VoiceID surface, so the operator of
`walletOrigin` composes VoiceID as for a VoiceID host:

```sh
npx --no-install seams-voiceid-host ./wallet-with-voiceid
```

Until 0.67.0 the host also installed the plugin `@seams/wallet-voice-sign` and
composed it with `seams-speak-to-sign-host`. Remove both.

## Configure the Seams server

The Seams server adds `POST /speak-to-sign/v1/verify` only when all six
variables are set:

| Variable                                    | Testnet value                                                      |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `SPEAK_TO_SIGN_OUTLAYER_BASE_URL`           | `https://testnet-api.outlayer.ai`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_PROJECT`            | `seams-v1.testnet/voice-verifier`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | The OutLayer payment key. Keep it in a secret store.               |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

One more variable is optional: `SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY`,
the WASM hash of the `venice` build of the same verifier (verifier 0.14.0 and
later, `./build.sh --venice` in the speak-to-sign repository). That build sends
the clip to Venice AI in place of NEAR AI Whisper, and its verdicts name it,
for example `0.14.0+venice`. The server chooses the build for each call, and
the page cannot choose it:

- Without the variable, or without `SPEAK_TO_SIGN_NEAR_AI_API_KEY`, NEAR AI
  serves each call.
- With both, the server checks NEAR AI: its model list, and a silent clip of
  0.5 s to `openai/whisper-large-v3`. One check serves all calls for 60 s.
  A 5xx answer or no answer in 10 s is down; a 4xx answer is not.
- Venice serves a call only while NEAR AI or its Whisper is down, or when the
  check gives no answer in 3 s. Otherwise NEAR AI serves.

Venice AI runs in no TEE, so it can hear each recording that it gets. The
verdict of such a call says so, and the Wallet's receipt shows "Speech to
text: Venice AI, outside a TEE".

The Wallet seals each recording, so the version must be verifier 0.12.0 or
later, and the secrets profile must hold the secret `PROTECTED_AUDIO_KEY` of
the audio key that the Wallet pins. An older version refuses each spoken
request with `unsupported`.

The route reads the caller's Wallet Session as identity. It answers 401
`unauthorized` without a session and 503 `session_unavailable` when the
session store fails, and it spends no signing use. It refuses a request for
another owner's voice. It serves only the verifier's `verify` and `enroll`
operations (400 `unsupported_operation` for another one) and accepts a body
of at most 1,100 KB. A refusal before the verifier call is a JSON error.
After the checks, the route answers with `text/event-stream`: the event
`verifier_running` at once, then one `verdict` event with the verifier output
unchanged, or one `failed` event with a fixed code, such as
`verifier_timeout`. The route calls the verifier with `relayToVerifier` of
`@seams/voice-sign/server` (speak-to-sign repository). It cannot read the
sealed recording, and it forwards only an output of a known kind: an error
output of the verifier gives `failed` with `verifier_failed`.

Before it sends a `verdict`, the route checks the TDX quote of the call. The
verdict key is bound to the OutLayer project, so every version of the project
signs with it; the quote names the WASM that ran. The route reads the
attestation record of the call from OutLayer. OutLayer stores the record a
short time after the call, so the route tries once each second for up to
15 s. Then it checks, with `@seams/voice-verdict`:

- The quote binds the output to the WASM hash of the build that the route
  called (`SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`, or
  `SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY` for a Venice call) and to the
  project (`checkAttestationBinding`).
- Intel signed the quote, and Intel's collateral at the time of the call
  does not revoke the platform (`checkQuoteCollateral`, with the collateral of
  `GET <api>/public/collateral`).
- The OutLayer worker contract (`worker.outlayer.testnet`) approves the five
  measurements of the quote (`measurementsApproved`, through
  `https://rpc.testnet.fastnear.com`).

The server keeps the collateral of each platform in memory until its next
update, and an approval of the contract for 10 minutes. If a check fails, or
the record does not come in time, the route sends `failed` with the code
`attestation_<code>`, for example `attestation_wasm_not_accepted` or
`attestation_unavailable`. The log has the code and the times only. A
`verdict` has `attestationUrl`, the full URL of the record, `transcriber`
(`nearai` or `venice`), and its `timing` has `attestationMs`, the time of the
check with the wait.

The route `POST /speak-to-sign/v1/summary` writes the summary of a spoken
community note. The server adds it only with the six variables above and
`SPEAK_TO_SIGN_NEAR_AI_API_KEY`, a NEAR AI key. Keep it in a secret store.
`SPEAK_TO_SIGN_SUMMARY_MODEL` is optional; the default is `Qwen/Qwen3.8-27B`,
which the route calls with thinking off. The route reads the Wallet Session
as the verify route does. It takes `{ text }` (1 to 280 characters) and answers
`{ ok: true, summary }`. If the model breaks a summary rule, the route asks
once more. A failure is a JSON error with a fixed code: `summary_unreachable`,
`summary_failed` or `summary_not_speakable`. Without the key, the Wallet
cannot sign a spoken note.

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
  - The carried verdict. A note, a rating and a bet carry the verdict to their
    contract. It must be the verdict beside the signing request.
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
- While NEAR AI Whisper is down, a server with the `venice` build sends the
  clip to Venice AI. Venice runs in no TEE: it can hear the recording, and the
  verifier trusts its transcript.
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
browser. It goes to OutLayer, Phala and NEAR AI (or Venice AI while NEAR AI
Whisper is down), and the voice template stays in OutLayer storage.

Read next:

- [VoiceID](/concepts/auth-methods/voiceid)
- [Wallet iframe](/concepts/custody/wallet-iframe)
