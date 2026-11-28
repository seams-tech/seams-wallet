---
title: 'Experimental: Speak-to-Sign'
description: Experimental spoken NEAR payments from the owner's own account. A Seams verifier on Cloudflare checks the owner's voice and signs what it heard, and the Wallet checks the words. Testnet only.
---

# Experimental: Speak-to-Sign

::: warning Experimental
Speak-to-Sign is experimental. It runs on **NEAR testnet only**. Release 0.54.0
is its first release, and 0.56.0 adds `enroll`. Its packages and routes can
change without notice. Do not use it with real funds.
:::

Speak-to-Sign lets a wallet owner pay by voice. The owner says a sentence such
as "Send 2 NEAR to alice dot testnet". The Seams verifier checks that the
voice is the owner's, and signs a verdict with the words that it heard. The
Wallet checks the verdict and that the heard words are exactly the words of
the request. Then it sends the transfer from the owner's own account. The
spoken sentence is the confirmation: an accepted payment shows no confirm and
no passkey.

Speak-to-Sign is a transaction feature, not an authentication method. It never
unlocks a wallet or opens a session. It needs a [VoiceID](/concepts/auth-methods/voiceid)
enrollment and uses the VoiceID capture surface.

## The verifier

The Seams server of each lane calls one verifier backend. The server setting
`SPEAK_TO_SIGN_BACKEND` names it (see
[Configure the Seams server](#configure-the-seams-server)).

- **SaySo** is the backend of the Wallet. It is a Cloudflare Worker that the
  Seams operator runs. It writes the transcript with Whisper large-v3-turbo on
  Cloudflare Workers AI, checks the speaker with ReDimNet B1 in a Cloudflare
  Container, and signs an Ed25519 verdict. Each lane has its own SaySo
  deployment, verdict key and voice templates.
- `staging-testnet` is the first lane with SaySo. The other lanes have no
  verifier yet, so their Seams server has no verify route.
- **OutLayer** was the verifier until 0.76.0. It ran in a TEE (trusted
  execution environment) on OutLayer. Its code stays as a module that is off,
  and no lane runs it.

The voice templates of OutLayer do not move to SaySo. Each owner enrolls the
voice again (see [Set up the owner](#set-up-the-owner)).

## How a spoken payment works

1. The Wallet shows the request and the sentence on the VoiceID surface and
   records one clip of at most 8 s. The card stays open and shows each next
   step.
2. The Wallet sends the clip as a WAV and the request to the Seams server. The
   server calls SaySo through a Cloudflare service binding with its own key.
   The browser never holds a SaySo key. While the verifier works, the Wallet
   reads the access-key nonce and a recent block hash for the payment. It
   signs nothing before the verdict.
3. SaySo gets a transcript of the clip from Workers AI and a speaker embedding
   from its container. It compares the voice with the owner's enrolled
   template, and it refuses a recording that it saw before. It does not decide
   the words.
4. SaySo returns a signed verdict that expires after 120 s. The verdict names
   the owner, an intent digest that binds the request digest and the sentence,
   the digest of the recording and the transcript.
5. The Wallet checks the verdict against the SaySo key that the Wallet pins:
   the signature, the expiry, the owner, the request and the recording. Then
   it reads the transcript with `spoken-intent`, the sentence reader of
   Speak-to-Sign, and compares it with the words of the request. The amount
   must match exactly. In a transfer, a word that holds no value can be a
   sound-alike: "sent" for "send" or "nir" for "NEAR". The receiver can be a
   sound-alike of the request's receiver. The owner can say a separator in
   other words ("period" for "dot", "hyphen" for "dash"), or leave out the
   separators and "testnet": "seams v one" is `seams-v1.testnet`.
6. The Wallet signs the transfer through the owner's Wallet Session with no
   confirm and sends it. The signing request carries the verdict, and the
   Seams co-signer checks it again before it adds its part of the signature
   (see [Trust model](#trust-model)).
7. The card shows the result: the paid transfer with a link, or the reason
   for a refusal. After a refusal of the words or the voice, the owner can
   record the sentence again, up to five recordings in all. The call returns
   when the owner closes the card.

A spoken payment needs a warm Wallet Session. If the session is locked or
expired, the Wallet asks the owner to unlock first.

SaySo takes a sentence of at most 16 words and 160 characters. A request with
a longer sentence gets no spoken approval: the Wallet opens no card, and the
result is `unavailable` with the reason `verifier_unavailable`. Its `detail`
says why, for example "The sentence has 18 words; the verifier takes at most
16." Ask for the Wallet's confirm for such a request: make the call without
`approval`.

## Install

Install the MPC wallet package. Speak-to-Sign and the VoiceID descriptor are parts of
`@seams/mpc-wallet`: they have no package of their own.

```sh
pnpm add @seams/mpc-wallet@0.77.0
```

Add the `spoken` descriptor to `approvals`, beside the VoiceID auth method:

```ts [Partial example]
import { SeamsWeb, spoken } from '@seams/mpc-wallet/client';
import { voiceIdAuthMethod } from '@seams/mpc-wallet/voiceid';

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

| Call with `approval`          | `result` of an approved call    |
| ----------------------------- | ------------------------------- |
| `near.signAndSendTransaction` | `{ transactionHash }`           |
| `near.signTransaction`        | The signed transaction          |
| `near.signDelegateAction`     | The signed delegate action      |
| `near.signMessage`            | The NEP-413 signature and nonce |

- `summary` is the sentence that the owner reads aloud: 1 to 12 plain words
  (`summaryRefusal`).
- The verdict binds what the Wallet signs: the receiver and the action bytes
  of a transaction or a delegate action, or the bytes of a NEP-413 message. The
  Seams co-signer checks the verdict again against the bytes that it signs.
- The application writes the summary. The voice proves who approves and which
  words this person said. It does not prove that the summary describes the
  request.
- The card shows the request above the summary, in the words of the Wallet's
  confirm: the receiver and each action of a transaction or a delegate action,
  or the recipient and the text of a message. The Wallet writes these lines
  from the request that it signs, so the owner reads them before they speak.
- The Wallet sets the sender of a delegate action and draws the nonce of a
  message.
- `walletSession` is optional, as for the normal calls. Without it, the call
  is for the authenticated wallet.
- A call with `approval` throws if `approvals` does not hold the descriptor.

Every call with `approval` returns one result shape, and it does not throw for
a refusal. The `kind` is `approved`, `refused`, `cancelled` or `unavailable`.
An `approved` result holds `result`, `times`, `approval` and `attestationUrl`.
With SaySo, `approval` is always `voice`: the verdict alone approved the
request. `attestationUrl` is always `null`, because SaySo has no attestation.
The OutLayer verifier set `voice_and_passkey` when a policy rule asked for the
confirm again, and a link to the TDX quote of its call.

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

| Call                   | The owner says                                      |
| ---------------------- | --------------------------------------------------- |
| `spoken.transfer`      | "send two near to alice dot testnet"                |
| `spoken.note`          | The summary of a community note, which Seams writes |
| `spoken.rating`        | "this note is helpful"                              |
| `spoken.mergeApproval` | "merge pull request forty two into main"            |
| `spoken.bet`           | "bet zero point five usdc yes on market nine"       |

For `spoken.transfer`, the receiver can be any named NEAR account that the owner
can say, such as `alice.testnet`. The result is `refused` with
`receiver_not_speakable` for an implicit (64-hex) or `0x` account, and with
`receiver_missing` for an account that does not exist. The amount is decimal
NEAR with at most two decimal places. The voice approves any amount, as a
passkey step-up does.

`onProgress` is optional: in `approval` for a normal call, and in the request
of a typed call. It gets each stage of the request, in order:

| `stage`            | When                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `recording_sent`   | The Wallet sent the recording to the Seams verify route.           |
| `verifier_running` | The Seams server called the verifier.                              |
| `verdict`          | The verifier answered. `ms` holds its stage times.                 |
| `step_up`          | A policy rule asks for a fresh approval. `policyText` is the rule. |
| `transaction_sent` | The signed transaction left for the network.                       |
| `settled`          | NEAR returned the final outcome. `transactionHash` names it.       |

The verifier sends its result only at the end, so no event comes between
`verifier_running` and `verdict`. Only the OutLayer verifier has policy rules,
so SaySo never sends `step_up`. An error in the listener does not stop the
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
phrases for both.

Then the Wallet asks the owner to unlock again with a passkey. A voice becomes
a way to approve payments, so the Seams server enrolls it only with a Wallet
Session that such an unlock issued in the last 120 s. A VoiceID unlock never
counts, because it is the same voice again. The Wallet sends only the three
recordings of this enrollment.

The Wallet asks for this unlock with a passkey only. A wallet with no passkey,
such as a wallet that signs in only with Email OTP, cannot enroll a voice for
Speak-to-Sign yet. If the unlock does not complete, `enroll` returns
`unavailable` with the reason `not_submitted`, and the verifier enrolls
nothing.

A new enrollment replaces the template. The result `kind` is `enrolled`,
`refused`, `cancelled` or `unavailable`. A spoken request of an owner with no
template at the verifier gives `refused` with `template_missing`.

By default, the owner presses Record for each phrase. With
`enroll({ autoStart: true })`, each phrase card records when it opens. This
applies to a wallet that has VoiceID. When `enroll` turns VoiceID on first,
the VoiceID cards still wait for a press on each sample.

If the owner turned VoiceID off, `enroll` returns `unavailable` with the reason
`voiceid_unavailable`. Turn it on again with
`seams.registration.setAuthMethodEnabled({ walletId, method: 'voiceid', enabled: true })`.

The owner's account pays the gas of each transfer, about 0.00005 NEAR on
testnet.

### Turn spoken approval off

The VoiceID switch in **Authentication methods** turns spoken approval off.
With VoiceID off or not set up, a spoken request returns `unavailable` with the
reason `voiceid_unavailable`, and the application uses the confirm.

When the application has the `spoken` descriptor, the Wallet first deletes the
owner's voice template at the verifier, through the Seams server. It does this
when the owner turns VoiceID off and when the owner removes the VoiceID method.
The Seams co-signer accepts a verdict whatever the switch on the device says,
so only this delete stops spoken approvals at the verifier. If the delete
fails, VoiceID stays on, and the owner can try again. A lane with no verifier,
or with another backend, has no template to delete, so the change goes on.

## Spoken community notes

The same flow can sign a community note or a note rating on a notes contract
with `add_note({ post_id, text, summary })` and
`rate_note({ note_id, rating })`.
The author types the note and reads aloud only a short summary of it. The
application gives the note, not the summary:

1. The Wallet asks the Seams server for the summary
   (`POST /speak-to-sign/v1/summary`). The server writes it from the note with
   a chat model on NEAR AI.
2. The card shows the note above the summary. The author says the summary.
3. The verdict binds the note by its SHA-256. SaySo does not check that the
   summary gives the main point of the note: the author approves the summary
   that the card shows and that they say.

So the application cannot choose the words that the author says. Wallet core
builds the one call, with no deposit and no confirm. No contract checks a
SaySo verdict, so the call of a note, a rating or a bet carries no verdict.
The co-signer refuses such a call that carries one.

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
- A rating is said as "this note is helpful", "this note is somewhat helpful"
  or "this note is not helpful".
- The transcript of a summary or a rating must give exactly its words. Case,
  punctuation and digits in place of number words can differ. The sound-alike
  rules are only for a transfer.

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
`@seams/mpc-wallet`. It records on the VoiceID surface, so the operator of
`walletOrigin` installs `@seams/host` and composes VoiceID as for a VoiceID host:

```sh
npx --no-install seams-voiceid-host ./wallet-with-voiceid
```

The Wallet reads a SaySo transcript with `/sdk/workers/spoken_intent_bg.wasm`.
The composed assets hold it. Serve it as the other WASM files of `/sdk/*`.

Until 0.67.0 the host also installed the plugin `@seams/wallet-voice-sign` and
composed it with `seams-speak-to-sign-host`. Remove both.

## Configure the Seams server

The Seams server adds `POST /speak-to-sign/v1/verify` only when its lane names
a verifier backend. For SaySo, the Gateway Worker of the lane needs:

| Setting                 | Value                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| `SPEAK_TO_SIGN_BACKEND` | `sayso`                                                              |
| `SAYSO`                 | A service binding to the SaySo Worker of the lane                    |
| `SAYSO_API_KEY`         | The `SAYSO_API_KEY` of that SaySo Worker. Keep it in a secret store. |

- Without `SPEAK_TO_SIGN_BACKEND` and without the settings of a backend, the
  server has no verify route.
- The settings of a backend without `SPEAK_TO_SIGN_BACKEND` stop the server at
  start: the lane must name its backend. `sayso` without the key or the
  binding, and a value other than `sayso` or `outlayer`, also stop it.
- Give each lane its own SaySo deployment. A deployment holds one verdict key
  and the voice templates of its owners.
- The SaySo Worker must serve `POST /v1/template/delete`. Without it, the
  delete answers 404, and VoiceID cannot go off on that lane.

The route reads the caller's Wallet Session as identity. It answers 401
`unauthorized` without a session and 503 `session_unavailable` when the
session store fails, and it spends no signing use. The body is
`{ backend, input }` of at most 1,100 KB. Wallet core names the backend that
it made the input for. A backend other than the lane's gives 409
`backend_mismatch`. The route refuses a request for another owner's voice
(403 `owner_mismatch`). On SaySo it serves the operations `verify`, `enroll`
and `delete` (400 `unsupported_operation` for another one). A refusal before
the verifier call is a JSON error.

After the checks, the route answers with `text/event-stream`: the event
`verifier_running` at once, then one `verdict` event with the verifier output
unchanged, or one `failed` event with a fixed code. On SaySo:

- The route calls the binding with `Authorization: Bearer SAYSO_API_KEY` and
  waits at most 20 s (`verifier_timeout`).
- It builds the SaySo intent from the session's owner: the user
  `near:<network>:<accountId>`, the action `seams.near.<kind>`, the request
  digest and the sentence. The intent is transcript-only: SaySo checks the
  speaker and the recording and signs the transcript, and the Wallet and the
  co-signer decide the words.
- An enrollment needs a Wallet Session that a passkey or Email OTP approval
  issued in the last 120 s. A VoiceID session never counts. Another session
  gives `failed` with `fresh_approval_required`.
- The text of a SaySo error never reaches the answer or the log. Its status
  gives a fixed code: `verifier_unauthorized`, `verifier_busy`,
  `verifier_rejected_request`, `verifier_failed` or `verifier_unreachable`.
- A `verdict` has `attestationUrl: null`, `transcriber`
  (`workers_ai_whisper_large_v3_turbo`), and `timing` with `saysoMs` and
  `serverMs`.

The route `POST /speak-to-sign/v1/summary` writes the summary of a spoken
community note. The server adds it only with a verifier backend and
`SPEAK_TO_SIGN_NEAR_AI_API_KEY`, a NEAR AI key. Keep it in a secret store.
`SPEAK_TO_SIGN_SUMMARY_MODEL` is optional; the default is `Qwen/Qwen3.8-27B`,
which the route calls with thinking off. The route reads the Wallet Session
as the verify route does. It takes `{ text }` (1 to 280 characters) and answers
`{ ok: true, summary }`. If the model breaks a summary rule, the route asks
once more. A failure is a JSON error with a fixed code: `summary_unreachable`,
`summary_failed` or `summary_not_speakable`. Without the key, the Wallet
cannot sign a spoken note.

The same backend setting turns on the co-signer's verdict check. The
co-signer accepts only the verdict kind of the lane's backend:
`sayso_verdict_v1` on SaySo. It records each accepted verdict in the signer
database table `speak_to_sign_voice_verdicts` (made by the signer D1
migrations). Each new record deletes the wallet's records of expired
verdicts. The server log has one warning line for each refusal, with the
reason, the wallet and the signing request. A Seams server without a backend
refuses every signing request that carries a verdict, with the reason
`unavailable`.

### The OutLayer backend

No lane runs OutLayer, because its funding stopped. Its code stays in
`@seams/host`: `SPEAK_TO_SIGN_BACKEND=outlayer` and the six
`SPEAK_TO_SIGN_OUTLAYER_*` variables turn it on. But the Wallet of this
release makes SaySo input, so such a server answers each verify request with
409 `backend_mismatch`. A server with the OutLayer variables and no
`SPEAK_TO_SIGN_BACKEND` stops at start: remove the variables, or set the
backend. The
[0.76.0 text of this section](https://github.com/seams-tech/seams-wallet/blob/7123e190b/apps/docs/src/concepts/auth-methods/speak-to-sign.md#configure-the-seams-server)
has the OutLayer variables and the TDX quote check.

## The verifier key

Each SaySo deployment signs its verdicts with its own Ed25519 key. The secret
key is a Worker secret of that deployment in the operator's Cloudflare
account. The same account runs the Seams server and the co-signer.

The Wallet and the co-signer pin the public keys in their own code. They never
take a key from the app, because the app chooses the Seams server URL. Each
network has a list of keys, so that a new key can come before the old key
goes:

| Network   | Pinned SaySo keys                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `testnet` | `3d96c3d21be6b7864cadfe1d5e57366e45774d7513972710e2569aa33a0d6895`, the `staging-testnet` deployment |
| `mainnet` | None. A mainnet request has no verifier.                                                             |

The Wallet and the co-signer also refuse a verdict of a SaySo build other than
a release (`sayso/x.y.z`), such as a mock build. The Wallet pays at most once
in each flow, and only for a recording that it made in the same flow.

## Trust model

- The Wallet signs only after a verdict that a pinned key signed for this
  exact request: the network, the owner, the request digest, a recording of
  this flow and an expiry. The transcript in the verdict must give exactly the
  words of the request. The Wallet Session and the Seams co-signer still take
  part in every signature.
- The voice approves what a passkey step-up approves. The Wallet and the
  co-signer set no amount limit for it, and SaySo has no policy step. A limit
  on a spoken request is a rule of the Wallet's policy, as for a normal
  signature.
- The Seams co-signer checks the verdict again before it adds its part of the
  signature. It checks only a signing request that carries a verdict. A
  normal signing request carries none, and the co-signer handles it as before.
  The co-signer checks these items:
  - The signature, against the same pinned SaySo keys, and a release build.
  - The expiry: at most 120 s after SaySo signed.
  - The request. The co-signer reads the unsigned transaction or message that
    it is asked to sign and builds the request again: one transfer to the
    receiver with the amount, one call of a typed kind, or the whole
    transaction or message with its spoken summary. The intent of that request
    must give the intent digest in the verdict.
  - The words. The co-signer reads the transcript with `spoken-intent`, with
    the request's receiver as the only contact. It must give exactly the words
    of the request.
  - No carried verdict. The call of a note, a rating or a bet must carry no
    verdict to its contract.
  - The owner. The transaction signer must be the NEAR account of the Wallet
    Session.
  - Single use. The co-signer records each verdict that it accepts and refuses
    it for another signing request.
- The co-signer check protects against a fault in the Wallet's Speak-to-Sign
  path, and it keeps single use on the server. It does not stop code at
  `walletOrigin` that leaves the verdict out, because such code can already
  sign in an open Wallet Session.
- SaySo has no TEE and no attestation. The Wallet and the co-signer trust the
  operator's Cloudflare infrastructure: the SaySo Worker, Workers AI and the
  speaker container. The verdict key is in the same Cloudflare account as the
  co-signer. So the co-signer check does not protect against the operator, or
  against a person who holds a deploy token of that account.
- Workers AI writes the transcript, and SaySo signs it as it is. The
  transcript has no signature of its own, so SaySo trusts Workers AI.
- Code at `walletOrigin` cannot change the request after the owner speaks:
  the request digest then does not match.
- Any named account can receive a spoken payment. If the voice check accepts a
  clone or a replay of the owner's voice, the payment can go to any named
  account, at any amount. SaySo refuses a recording that it saw before. To stop
  spoken approvals, turn VoiceID off.
- The Wallet and the co-signer accept a heard receiver that sounds like the
  request's receiver: the same sound key, or a key one sound apart with the
  same first two letters, such as `alicia.testnet` for `alice.testnet`. They
  also accept the name without its separators and network suffix. So the voice
  cannot tell apart two such accounts, for example `bob.testnet` and
  `bobb.testnet`, or `bob-1.testnet` and `bob1.testnet`. The owner must read
  the account on the card before speaking.

## The audio and what the verifier keeps

Unlike a [VoiceID](/concepts/auth-methods/voiceid) unlock, the audio leaves the
browser:

- The Wallet sends each recording as a WAV to the Seams server, which passes
  it to the SaySo Worker of its lane.
- SaySo sends the recording to Whisper large-v3-turbo on Cloudflare Workers AI
  for the transcript, and to its speaker container (ReDimNet B1 in a
  Cloudflare Container) for the voice check.
- If the first transcription is slow or fails, SaySo can send the same
  recording to Workers AI a second time. It uses the first answer.
- These services run in the operator's Cloudflare account. The audio goes to
  no service outside Cloudflare.

SaySo keeps no recording and no transcript. It stores these items for each
owner:

- The voice template: a speaker embedding of the three enrollment recordings,
  not the audio. A new enrollment replaces it.
- The SHA-256 digest of each recording that it checked, for 7 days, so that a
  recording counts only once.
- The times of the owner's recent requests, for its rate limit.

The verdict holds the transcript, and the Wallet and the co-signer read it.
The co-signer records the ID of each accepted verdict, with the wallet and the
signing request, but not the transcript.

To delete the voice template, the owner turns VoiceID off or removes it (see
[Turn spoken approval off](#turn-spoken-approval-off)). The digests of used
recordings stay until their 7 days end, so that a recording still counts only
once.

Read next:

- [VoiceID](/concepts/auth-methods/voiceid)
- [Wallet iframe](/concepts/custody/wallet-iframe)
