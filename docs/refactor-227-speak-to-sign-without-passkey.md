# Refactor 227: Speak-to-Sign without a passkey, with typed contract calls

Status: plan, 2026-11-09, second draft. Nothing is built. It changes the Speak-to-Sign design
of `seams-monorepo/docs/refactor-210-voice-intents.md` (Section 0) and uses the step-up of
[Refactor 225](refactor-225-jev-policy-engine.md) (Section 4).

Decisions of the user (2026-11-09):

- **D1. Off chain, trusted.** A key holder signs only after it checks the verdict. The key
  holder is the Seams Wallet (option G). The shared vault and the Global Contract idea are
  parked.
- **D2.** The stub step-up rule: "a payment above 10 NEAR needs a passkey". JEV decides
  step-up later.
- **D3.** Progress: the verify route streams its own stages (P1). The verifier stages arrive
  together, because OutLayer has no stream.
- **D4.** The first typed contract call is a spoken community note (an X-style community
  note on a post) and a spoken note rating. There is no prediction-market call.

## Result

- **No passkey for a spoken payment or call.** The owner's own account signs a normal NEAR
  transaction through the warm Wallet Session. The accepted verdict replaces the confirm
  click. No vault, no deposit, no relayer.
- **Any contract, as the owner.** A spoken contract call runs from the owner's account, so
  deposits work and the results go to the owner. The first call posts or rates a community
  note.
- **Short verdict life.** The verdict holds `expires_at_ms`. The Wallet and the server refuse
  it after that time.
- **Step-up.** The verifier has a policy step. A `step_up` verdict sends the operation to the
  normal "Confirm with Passkey" path. The first rule is a stub: above 10 NEAR.
- **Live progress** of the verify route over SSE. The Wallet sends the signing and chain
  stages itself.

## Facts

### Wallet signing (code, 2026-11-09)

- Signing needs an active server session and signing material in the client runtime. The
  client and the server sign jointly, in several rounds
  ([Spec 3](spec-3-wallet-sessions-and-execution-lanes.md)). The server cannot sign alone.
- With a warm session the confirm heading is "Review transaction". "Confirm with Passkey" is
  the `webauthn` mode, for a session that is not warm
  (`uiConfirm/ui/confirmation-model.ts`, `confirmationHeading`).
- The confirmation config has `uiMode` (`none`, `modal`, `drawer`) and `behavior`
  (`requireClick`, `skipClick`) (`session/userPreferences.ts`).
- A VoiceID session can require a fresh VoiceID unlock before it signs
  (`VoiceIdStepUpRequiredError`, `stepUpConfirmation/voiceIdStepUp.ts`).
- A related local figure: the router Yao round of a registration took 316 ms at the median
  with the release signing worker ([near-custody-profiling.md](near-custody-profiling.md)).
  The time of one transaction signature on staging is not measured.

### Chain (Refactor 210, Section 11.5, testnet)

- A plain transfer to its executed receipt: p95 2.1 s over 20 runs.
- A vault transaction to "vault accepted": 3.4 s in 1 run. The vault adds a payout receipt and
  a callback.

### OutLayer HTTPS API (measured 2026-11-09, this Mac to `testnet-api.outlayer.ai`)

Input `{"op":"probe"}`, which the verifier refuses at once. Pinned version `b4d68fb6…`.

| Call                                      | Client wall        | OutLayer `time_ms` | What came back                                        |
| ----------------------------------------- | ------------------ | ------------------ | ----------------------------------------------------- |
| Sync, 3 runs                              | 2.60, 2.80, 3.00 s | 695–707 ms         | One `application/json` body at the end                 |
| Sync with `Accept: text/event-stream`     | 2.43 s             | 706 ms             | Same JSON body. The header has no effect               |
| Sync with `"stream": true` in the body    | 2.33 s             | 767 ms             | Same JSON body. The field has no effect                |
| Async start, 3 runs                       | 0.80–1.01 s        | –                  | `status: "pending"`, `poll_url: /calls/{call_id}`      |
| Async poll of `/calls/{call_id}`, 9 polls | 0.23–0.72 s each   | –                  | Only `pending`, then `completed` with the whole output |
| Async start to `completed`, 3 runs        | 2.84, 2.90, 3.00 s | 951–971 ms         | No stage data, no partial output                       |

- The HTTPS API docs list no stream, no progress event and no partial output.
- About 1.6–2.3 s of each call is outside the run (network, queue, start).
- A verify-shaped probe (Gate 0, verifier 0.1.0, 9 runs): speaker 1.36–1.53 s and Whisper
  0.72–0.79 s in parallel. Verify over HTTPS with Phala: p95 5.2 s over 20 runs.

### OutLayer signing keys (docs, `signing-keys.wit`)

- The keystore derives a key from the project and the caller (the Seams payment-key owner),
  never from the input. A manifest declares at most three keys.
- So a key in the TEE is one key for every owner. It cannot be a key of each owner.

## Design

### 1. Option G: the Wallet signs after it checks the verdict

Option B (a key in the TEE) is faster: the worker could read the access-key nonce and a block
hash beside the speaker and Whisper calls and sign at once. But it does not fit:

- A function-call access key cannot send NEAR and cannot attach a deposit. So no payment,
  swap or `ft_transfer_call`.
- A full-access key from the TEE is one key for every owner (Facts). One bad verifier version
  or one keystore fault could empty every account.

Option G, the flow:

1. The Wallet starts the signing preparation that needs no transaction input while the verify
   call runs (Refactor 225, Decision 4 allows it). No signature exists before the verdict.
2. The verify route returns the verdict (as today).
3. Wallet core (not the host plugin) checks the verdict: kind, outcome, the request and
   spoken-text digests, the audio digest of the clip that core recorded, the signature, the
   verifier key and `expires_at_ms`.
4. On `accept`, Wallet core builds the transaction from the request itself (one `Transfer`
   to the receiver), signs it through the warm session with no confirm UI, and sends it. The
   owner's account pays its own gas.
5. On `step_up`, Wallet core asks for a fresh passkey for this one operation, also when the
   session is warm (Section 3).
6. If the session is not warm, the Wallet needs an unlock first (passkey or VoiceID). The
   verdict cannot replace the unlock, because the client signing material comes from the
   custody seed.

The verifier key is pinned in the Wallet code, one key for each network (testnet:
`ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`). It never comes from the app. The app
supplies the Seams server URL and the transaction features (`createWalletHostConfig`), so a
key from the app would let the app supply its own verdicts and make the Wallet sign with no
confirm. The project-bound key stays the same across verifier versions.

Server hardening (Step 1b, after the client path works): the signing request carries the
verdict. The co-signer admission checks it before it adds its part: the signature, the
expiry, that the request digest equals the transaction, single use, that the owner is the
session's NEAR account, and the voice limits of the wallet (per payment and per day). It adds
no round trip, because the verdict travels in the request that the Wallet sends anyway. It
changes the signing request format, so it is a separate step.

Replay: the request does not hold the access-key nonce, because the signing path picks the
nonce itself. These checks stop a replay:

- The verifier marks each recording used, so a new verdict needs a new recording.
- Wallet core signs at most once for each verdict, and only before `expires_at_ms`.
- In Step 1b, the co-signer records each verdict it accepts.

Latency, expected (to measure in Step 1): verify (p95 5.2 s) + the last signing round (not
measured on staging; the related local round was 316 ms) + a plain transfer (p95 2.1 s).
That is about the same as, or faster than, the vault path (3.4 s to "vault accepted" after the
verdict).

Trust change: the shared vault's on-chain checks go away. The voice limits, single use and
expiry move to the Wallet and wallet-server. The user accepts a trusted, off-chain design.

### 2. Requests and verdict v2

`spoken-intent` (`MultisigApproval` keeps Borsh tag 1; the new kinds take new tags):

```rust
SpokenRequestV1::AccountTransfer {   // tag 2; replaces VaultTransfer (tag 0)
    network: Network,
    owner: NearAccount,              // not spoken
    receiver: SpokenAccount,         // spoken
    amount: NearAmount,              // spoken
}
SpokenRequestV1::CommunityNote { .. } // tag 4, Step 3 (Section 4)
SpokenRequestV1::NoteRating { .. }    // tag 5, Step 3 (Section 4)
```

- Tag 3 stays reserved for a typed contract call that moves value. No such call is chosen.
- `VaultTransfer` is deleted with the vault. The spoken text of a transfer stays the same:
  "send two near to bob dot testnet".
- Verdict v2: `kind: "seams_voice_signed_verdict_v2"`, 13 fields in a fixed order: `kind`,
  `renderer`, `verifier`, `request_digest`, `spoken_text_digest`, `audio_digest`, `outcome`
  (`accept`, `step_up` or `refuse`), `reason`, `policy_rule`, `expires_at_ms`,
  `speaker_score_milli`, `word_margin_milli`, `heard`.
- `expires_at_ms`: the worker's wall clock plus 120 s. Step 1 checks the OutLayer clock. If it
  is wrong, the verifier reads the NEAR block time in the same request batch (no added wait).
- The unsigned output adds `policy_text`, the sentence of the rule.

### 3. Step-up and the stub rule

- The verifier runs a policy step after the words match:
  `policy::decide(&request) -> Allow | StepUp(rule) | Deny(rule)`. JEV plugs in here later
  (Refactor 225, Section 3). A policy step can only tighten.
- The stub rule: "A voice payment above 10 NEAR needs a passkey." A community note or a
  rating moves no value, so the rule never applies to it.
- A warm session normally signs with "Review transaction" and no passkey. So Wallet core
  gets a per-call option that forces a fresh passkey (the `passkeyReauth` plan) for the
  `step_up` operation. The confirm shows the rule sentence (`policy_text`).
- In Step 1b, the co-signer accepts a `step_up` verdict only with a fresh passkey approval of
  the same operation.

### 4. Typed contract calls

- Which contracts and methods: a closed list in `spoken-intent` and the Wallet. A new call is
  a new request kind. No kind that moves value holds free text or a free function call.
- The entries now are the community-note kinds, on the notes contract
  `notes.seams-v1.testnet` (`seams-voice-intents/community-notes`):
  - `CommunityNote` (tag 4) binds the post, the SHA-256 of the typed note text and the
    contract. Wallet core calls `add_note({post_id, text, summary})`.
  - `NoteRating` (tag 5) binds the note id and the rating. Wallet core calls
    `rate_note({note_id, rating})`.
  - Both move no value: the deposit is 0, and Wallet core calls only these two methods.
- The words: the author reads the note's summary aloud; the display is the summary itself. A
  rater says "this note is helpful", "this note is somewhat helpful" or "this note is not
  helpful".
- The summary is the one free-text exception. It has 1 to 12 words, only letters after
  normalization, and a first word that is not "send", "sent" or "sends". So the
  send-sentence word rules never read it.
- The confusion set guards the meaning: "not" added at each position, a negation removed,
  and the other ratings.
- The call runs from the owner's account, so the notes contract records the owner as the
  author or the rater and needs no beneficiary.
- The SDK: `seams.speakToSign.requestNote({ walletId, contract, postId, text, summary })` and
  `requestRating({ walletId, contract, noteId, rating })`.

### 5. Live progress (P1)

- The verify route answers with `text/event-stream`: `verifier_running`, then `verdict` with
  the stage times from the output `ms` (speaker, transcribe, policy, sign).
- The Wallet sends the rest itself: `recording_sent`, `step_up`, `transaction_sent`,
  `settled`.
- The status modal (approved, 2026-11-09) accepts these names. `verifier_running` pulses its
  segments 2–5; `verdict` fills them. Without a vault there is no `vault_accepted`; `settled`
  ends segment 6. The modal session is told before Step 2 ships.

### 6. Enrollment without the vault

- Today the owner authorizes an enrollment with the vault method `authorize_enrollment` (a
  passkey transaction), and the verifier reads it over NEAR RPC.
- New: the owner signs one NEP-413 message with the Wallet (the existing `signNEP413Message`
  path), and the verifier checks it:
  - `enrollment_digest = base64url-no-pad SHA-256("seams:voice-enrollment:v2" || owner ||
    0x00 || d1 || d2 || d3)`, where `d1..d3` are the SHA-256 digests of the three canonical
    WAVs.
  - The message is `Speak-to-Sign voice enrollment <enrollment_digest>`, the recipient is
    `seams-v1.testnet/voice-verifier`, and the nonce is 32 random bytes.
  - The verifier checks the ed25519 signature over the NEP-413 hash. In the same request
    batch as the speaker calls, it reads `view_access_key(owner, public_key)` over NEAR RPC.
    The key must be a full-access key of the owner.
- The template key changes from `template:v2:<vault>:<owner>` to `template:v3:<owner>`. Each
  owner enrolls again once.
- The SDK descriptor becomes `speakToSign({ network })`. The vault option goes.

## Steps

Each step is built, tested and deployed only after the user approves it. Deployments wait
until the 0.57.0 rollout session reports done.

1. **Payments without a passkey.**
   - `spoken-intent`: `AccountTransfer`, golden vectors, and the TypeScript port. The port
     moves into Wallet core, because core checks the verdict. Delete `VaultTransfer`.
   - Verifier 0.3.0: verdict v2, `expires_at_ms`, the policy step with the stub rule, the new
     input, the new template key and the NEP-413 enrollment. Tests with the fake host. Check
     the clock.
   - Wallet core and SDK: the pinned verifier key, the verdict check in core, warm-session
     signing with no confirm UI on `accept`, a forced fresh passkey on `step_up`, the unlock
     path for a cold session, and the NEP-413 enrollment. Then input-free signing
     preparation during verify, if the signing engine allows it without a large change.
   - 1b. wallet-server: the co-signer admission checks the verdict and the voice limits.
   - Deploy: FastFS upload, `add_version`, pin `versionKey` in `targets.json`, deploy
     wallet-server and the hosted Wallet to staging, release the SDK if its app API changed.
   - Check: a 1 NEAR spoken payment on the staging demo with no passkey prompt; an 11 NEAR
     payment that asks for the passkey; 10 runs of end of speech to settled.
2. **Live progress.** Route SSE, SDK stream reader, Wallet progress events.
3. **Spoken community notes.** `CommunityNote` and `NoteRating` in the crate and the port,
   the notes contract, verifier 0.4.0, the Wallet and SDK `requestNote` and `requestRating`,
   and the Spoken Notes demo page (`seams-voice-intents/demo`). Check a spoken note and a
   spoken rating on staging.
4. **Retire the vault.** Testnet owners withdraw from `seams-wallet.testnet`. The SDK and
   Wallet vault code goes in Step 1 with `VaultTransfer`. The contract source stays in git
   history; the deployed code hash `ecdd703a…ec42` keeps its withdrawal methods.
5. **Records.** Refactor 210 Section 0, Refactor 225 Section 4 and open question 9, the
   verifier README.

## Parked

- A voice contract on the owner's account with a NEAR Global Contract (by code hash). It
  would keep on-chain limits. Checked on 2026-11-09: testnet protocol 88, near-sdk 5.21 and
  near-cli-rs 0.23.2 support Global Contracts, and the Wallet knows `UseGlobalContract`.
- P2 progress: the verifier pushes its inner stages to the route as they end.

## Coordination

- Another session rolls out 0.57.0 (npm, the monorepo pin, the demo files
  `apps/wallet-console/src/showcase/speakToPay*.tsx`, staging and production). This plan bumps
  no version, releases nothing and edits no demo file until that session reports done.
- The status modal session agreed the event names (Section 5).
- A separate session replaces `w3a-relayer.testnet` with `seams-relayer.testnet`. With option
  G, Speak-to-Sign does not need the relayer for gas.
- The Phala CVM `seams-speaker-v2` runs for user testing at USD 0.116 per hour. Live checks
  need it; it starts and stops only with the user's agreement.
