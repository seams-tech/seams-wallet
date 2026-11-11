# Refactor 232: Wallet plugins by evidence (Speak-to-Sign)

Status: 2026-11-11. Slices 1 to 3 are built on the branch `refactor-232` (see "Slices"), not merged and not released. Written against `dev` at `bb2014e1f` and
speak-to-sign `dev` at `4478fb8`. Slice 0 (the 0.67.0 release) is done. On 2026-11-11 the
owner cut the plan to Slices 1 to 5: the Speak-to-Sign part. The parts that are not in the
plan are listed at the end.

A security review of Slices 1 to 3 (2026-11-11) changed Sections 1, 3 and 4, added Section 8
(the invariants that each slice keeps) and added a test to each of Slices 1 to 3.

The owner's problem (2026-11-11): the Wallet needs too much custom code to carry VoiceID and
Speak-to-Sign (`@seams/voiceid` and `@seams/wallet-voice-sign`). The owner wants a plugin
surface for an authentication method and for a signing feature, and asks if that is secure.

## Result

- **A plugin gives evidence, not code with Wallet rights.** The Wallet shows what it signs,
  records the approval and checks signed evidence against a pinned key. The co-signer checks
  the same evidence again. These three jobs never leave Wallet code.
- **One sign path in core.** `signWithEvidence(intent, evidence)` replaces `payWithVerdict`,
  `signNoteWithVerdict` and `signMessageWithVerdict`. A new request kind is one entry in an
  intent table. It needs no new plugin method and no new host API version.
- **One app option.** The normal sign calls take `approval: { kind: 'spoken', ... }`. The
  second namespace `seams.near.speakToSign` is not necessary.
- **`@seams/wallet-voice-sign` goes away.** Its flow becomes a part of `@seams/wallet` that
  loads on first use. The fourth package, its host API version and its release go away. The
  server calls the verifier with `callVerifier` of `@seams/voice-sign`. The recording stays
  on the phrase card of `@seams/voice-capture`, which VoiceID already gives to core
  (Section 4).
- **speak-to-sign has no dependency on the Wallet.** It keeps the verifier, the intent
  format, `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign`.

## Decisions for the owner

Decided on 2026-11-11: `@seams/wallet-voice-sign` goes away (D2, Section 4), and the plan
is Slices 1 to 5 only.

- **D1. The rule "evidence, not code".** An app never supplies code that runs in the Wallet.
  Code in the Wallet origin comes only from the Wallet operator. Recommended: yes.
- **D2. Decided: `@seams/wallet-voice-sign` goes away** (Slice 4). The Wallet depends on
  `@seams/voice-sign`.
- **D3. The app API.** Recommended: `approval` on the normal sign calls, and remove
  `seams.near.speakToSign` with no alias (as 0.66.0 did with `seams.speakToSign`). The
  `typed` calls stay as helpers that build a request.

## Facts this plan builds on

- **F1. The app side is data.** A feature descriptor is `{ kind: 'speak_to_sign', network }`.
  The parser refuses every other value
  (`packages/wallet/src/core/transactionFeatures/plugins.ts`). "It is data only and loads no
  code."
- **F2. The Wallet host loads plugin code from a fixed path** on its own origin:
  `/sdk/speak-to-sign/host.js` and `/sdk/voiceid/host.js`. It checks only `hostApiVersion`
  (`transactionFeatures/hostRegistry.ts`, `authMethods/hostRegistry.ts`). App configuration
  cannot name code.
- **F3. Speak-to-Sign host API 10** has four plugin methods (`enroll`, `requestTransfer`,
  `requestNoteAction`, `requestMessage`) and seven core operations (`openPrompt`,
  `receiverExists`, `verify`, `payWithVerdict`, `signNoteWithVerdict`,
  `signMessageWithVerdict`, `authorizeEnrollment`). The plugin gets no key and no session
  (`transactionFeatures/hostPlugin.ts`, 554 lines).
- **F4. Core already does the trusted work.** `verify` seals each recording to the
  verifier's audio key before it leaves the device. `approveVerdict` checks the verdict with
  `checkVerdict` of `@seams/voice-verdict` against the pinned key and the request that core
  builds. A `step_up` verdict asks the owner (`transactionFeatures/hostOperations.ts`, 686
  lines).
- **F5. The co-signer checks again.** `checkSigningRequestVoiceVerdict` runs `checkVerdict`,
  builds the request again from the bytes that it signs, compares the digest and admits each
  verdict once (`packages/wallet-server/src/router/domains/speakToSign/`, 1,129 lines).
- **F6. The plugin is a card and a flow.** Its source is about 50 KB: `card.ts` 13 KB,
  `flow.ts` 15 KB, `result.ts`, `enroll.ts`, `verifier.ts`, `prompt.ts`, `heardWords.ts`.
  `flow.ts` already has one general function `runSpoken` with three thin callers.
- **F7. Each request kind is ported by hand, in three places.** The format is
  `SpokenRequestV1` of the `spoken-intent` crate (transfer, note, rating, merge approval,
  bet, transaction, signed message, and more). The Wallet has `spokenTransfer.ts` (219
  lines), `spokenNote.ts` (385), `spokenBet.ts` (142) and `spokenMessage.ts` (61). The
  co-signer has `voiceVerdictTransaction.ts` (350). The plugin has one method for each group.
- **F8. The verdict is general already.** `VoiceVerdict` binds `request_digest`,
  `spoken_text_digest`, `audio_digest`, `outcome` (`accept`, `step_up`, `refuse`) and
  `expires_at_ms` (life 120 s) under the domain `seams:outlayer:voice-verdict:v2`.
- **F9. VoiceID gives core the phrase surface.** `openPhrase` of the VoiceID host plugin is
  a 30-line adapter (`packages/voiceid/src/capture/phrase.ts`) over `openPhraseCard` of
  `@seams/voice-capture/card`. It adds the Wallet's theme classes, the Back control and the
  size reports. The surface returns the samples to its caller, which is core.
- **F10. Policy.** [Refactor 225](refactor-225-jev-policy-engine.md) plans the policy engine
  (nothing built). Its rule is "tighten-only": a semantic rule never allows more than the
  deterministic rules.
- **F11. What `@seams/voice-sign` has** (checked on 2026-11-11, speak-to-sign `65b47e9`):
  - `./server` has `callVerifier`. It makes the same OutLayer call as `speakToSignVerify.ts`
    of the Wallet server: the same URL, `version_key`, `secrets_ref`, `resource_limits` and
    a timeout. It uses only `fetch` and `AbortSignal`, and takes a `fetch` of the caller, so
    it runs in a Cloudflare Worker. Its input type has `audio_wav_b64` only: it has no type
    for `audio_sealed_b64`. It throws `VerifierCallError` with the kinds `timeout`,
    `network` and `http`.
  - `./browser` has `recordSentence`: a recording with no card. The Wallet needs the card
    with the check and the result on it, which is `openPhraseCard` of
    `@seams/voice-capture/card` (F9). So `./browser` gives the Wallet nothing that it does
    not have.

## Terms

- **Evidence:** a signed statement from a verifier that binds an owner, a request digest, an
  outcome and an end time. The first kind is the voice verdict (F8).
- **Intent:** the thing to sign (a transaction, a delegate action or a message) together
  with the request that the evidence must bind.
- **Approver:** a part that gets an approval from the owner and returns evidence.
- **Wallet operator:** the party that deploys the Wallet origin and the server.

## Design

### 1. Who is trusted

| Party | Trusted for | Not trusted for |
| --- | --- | --- |
| The app | Nothing. It sends data: a descriptor and an intent | Code in the Wallet, the summary of a general request |
| Wallet core (Wallet origin) | The display, the recording, the evidence check, the signature | — |
| A host plugin (Wallet origin, from the operator) | Everything that core can do. The TypeScript interface is a rule for the author, not a wall | — |
| The verifier (TEE) | "This voice said these words for this request" | The limits. The policy and the co-signer set them |
| The co-signer (server) | The second check of evidence and bytes, the "once" ledger | — |

Three results follow:

- **R1.** A hook that an app registers can only return data. It never runs in the Wallet
  origin. A method that the app's code controls can unlock the wallet for the app, so it is
  custody by the app. The Wallet must not offer that as an authentication method.
- **R2.** Code in the Wallet origin is in the trusted base, with or without a plugin
  interface. So the number of such plugins must stay small, and each must come from the
  operator's build. Today that is true (F2).
- **R3.** The safe way to add a method from another party is evidence that core can check:
  a signature from a pinned key (a passkey, a TEE verdict). The Wallet then runs none of
  that party's code.

**The limit of the co-signer's check.** The co-signer checks a verdict only when the signing
request carries one (`checkSigningRequestVoiceVerdict` returns for a request with no
`voice_verdict`). A client with a live Wallet Session can sign as a normal request. So the
second check protects against a fault in Wallet core or in a plugin. It does not stop a
hostile client. A limit that must hold against a hostile client belongs to the policy engine
(F10), not to this check.

### 2. What must stay in Wallet code

1. **Show.** The card that shows the request and the sentence.
2. **Capture.** The microphone and the passkey prompt. A recorder that is not trusted can
   copy the owner's voice. Core seals the recording (F4).
3. **Check and sign.** Core checks evidence against the pinned key and the request that it
   builds from the bytes to sign. The co-signer does the same (F5).

Everything else can be data: the verifier's address and keys, the request kinds, the texts.

### 3. One sign path in core

```ts
type Intent =
  | { sign: 'transaction'; deliver: 'send' | 'sign'; receiverId: string; actions: ActionArgs[] }
  | { sign: 'delegate'; receiverId: string; actions: ActionArgs[] }
  | { sign: 'message'; message: Nep413Message };

type SpokenRequest = { kind: SpokenKind; fields: Readonly<Record<string, unknown>> };

type Evidence = { kind: 'voice_verdict_v2'; output: unknown };

signWithEvidence(
  intent: Intent,
  request: SpokenRequest,
  evidence: Evidence,
  signal: AbortSignal,
  hooks: ProgressHooks,
): Promise<Signed | Refused | StepUpDeclined>;
```

- Core builds the request bytes from `intent` and `request`, as today. It never takes a
  digest from the caller.
- `payWithVerdict`, `signNoteWithVerdict` and `signMessageWithVerdict` become three calls of
  this one operation, then they go away with the host API change of Slice 3.
- The co-signer gets the same shape: one admission function for every kind.

**The intent table.** One table in `packages/shared-ts/src/speakToSign/spokenKinds.ts` has
one entry for each typed kind (transfer, note, rating, merge approval, bet):

```ts
type SpokenKindEntry<Fields> = {
  parse(fields: unknown, network): Fields | null;   // the app's fields and the limits of the kind
  spokenText(fields: Fields): string;                // the words that the verdict binds
  request(fields: Fields, network, owner: string): SpokenRequest;   // what the verdict names
  call(fields: Fields, verdict: CheckedVerdict): SpokenCall;        // the one action to sign
  fromCall(call: SignedSpokenCall, network): Fields | null;         // the fields of signed bytes
};
```

Core and the co-signer both read this table. A new kind is one entry and its vectors from
speak-to-sign. Today the same knowledge is in four core files, one server file and one
plugin method (F7).

The table has two directions, and each side uses only one:

- **Core goes from fields to bytes**: `parse`, then `request` and `spokenText`, then the
  verdict check, then `call`.
- **The co-signer goes from bytes to the request**: `fromCall` on the one action of the
  transaction that it signs, then `request`. It never builds a request from fields, a kind
  or a digest that the client sends. The kind that the client implies (a summary beside the
  verdict or none) only selects the path. The digest decides.

Rules for the table and the one sign path:

1. **The fields hold no owner, no network and no digest.** `parse` refuses unknown keys. The
   owner is the account of the session. The network is the network of the feature.
2. **`parse` holds every limit of its kind.** The transfer rules (0.01 to 1,000,000 NEAR in
   whole hundredths, a named receiver) are only in the plugin today, and core's
   `payWithVerdict` accepts any amount. They move into `parse`. Core signs nothing when
   `parse` returns null.
3. **`spokenText` never returns null.** `checkVerdict` skips a digest that the caller omits.
   So `signWithEvidence` and the admission function take the request digest as a required
   value, and core takes the spoken-text digest as a required value, for every kind.
4. **`call` takes only a verdict that passed the check.** The bet writes the verdict into
   the call for the market contract. The co-signer checks that this verdict is the verdict
   of the request.
5. **A typed kind has one intent form**: one transaction with one action, signed and sent.
   Only the general transaction reads a delivery (`send`, `sign` or the delegate fields)
   from the application. The verdict does not bind the delivery.
6. **The general kinds are not in the table.** A `transaction` and a `signed_message` have
   no call form. Core computes `actionsSha256` and `payloadSha256` from the intent that it
   signs, inside `signWithEvidence`. It builds the intent once for each flow, because a
   message draws its nonce once. Today these two digests go through the plugin, and only
   the co-signer finds a wrong one.
7. **Core derives the step-up mode from the intent form**, never from the table or the
   caller. A transaction asks for a fresh approval. A delegate action and a message have no
   fresh-approval path, so they refuse a `step_up` verdict. A new intent form refuses.
8. **"Once" is one synchronous block.** No `await` stands between the last test that the
   flow has not signed and the assignment. Core clears the mark only for a result that
   proves that nothing was signed.
9. **The transfer keeps its two own behaviours.** Core checks that the receiver exists
   before the owner speaks (today the plugin calls `receiverExists`). Only a plain transfer
   reports `included`, because a contract call can still fail in its receipt.

### 4. The approver contract

The plugin contract has one method for a request and one for enrollment:

```ts
interface Approver {
  approve(input: {
    walletId: WalletId;
    ownerAccountId: string;
    request: SpokenRequestView;        // kind, sentence or summary, card texts
    surface: Surface;                  // the trusted card and its size binding
    operations: {
      record(): Promise<ClipHandle>;                         // core records and seals
      verify(clip: ClipHandle): Promise<VerifyReply>;
      sign(evidence: Evidence, hooks): Promise<SignResult>;  // signWithEvidence
    };
    signal: AbortSignal;
  }): Promise<ApprovalResult>;
  enroll(input: {
    walletId: WalletId;
    ownerAccountId: string;
    surface: Surface;
    clips: ClipHandle[] | null;        // the three clips of a VoiceID enrollment, or null
    operations: {
      record(sentenceIndex: number): Promise<ClipHandle>;
      enrollClips(clips: ClipHandle[]): Promise<VerifyReply>;  // core signs and sends
    };
    signal: AbortSignal;
  }): Promise<EnrollResult>;
}
```

In host API 10 the plugin passes the intent to each sign operation, chooses the sentence on
the card, builds the verifier input, holds the WAV bytes and supplies the abort signal that
core checks. This contract removes each of these:

- `sign` takes no intent. Core bound the intent when it made `operations`, so the plugin
  cannot sign a different thing with good evidence.
- `record` takes no sentence. Core shows the sentence of the table on the surface.
- `verify` takes a clip only. Core builds the verifier input: the operation, the owner of
  the session and the request of the bound intent. Core seals with that owner.
- The plugin never holds raw audio. A `ClipHandle` is an object with no bytes and no
  digest. Core keeps its recording in a map of this flow, so a handle that the plugin makes,
  or a handle of another flow, does not work. Core sets the WAV bytes to zero after it
  seals them.
- Enrollment obeys the same rule. Today the plugin gets the WAV of a VoiceID enrollment and
  gives three WAV clips back for the authorization. With `enrollClips`, core signs the
  enrollment message for the three handles and sends the sealed clips itself.
- Core uses its own abort signal. The operations stop when `approve` or `enroll` settles,
  so a plugin cannot sign later with operations that it kept.
- The plugin still draws the check and the result on the surface, and it still gives
  `sign` the verifier output. Core checks that output.

The plugin runs in the Wallet origin, so this contract is a rule for its author and not a
wall (Section 1). The gain is that a fault in the plugin cannot sign another intent or send
a recording.

- **The version.** In Slice 3 the plugin is still a package, so the contract is host API 12
  (VoiceID's host API is 11, and a type test keeps the two numbers apart) and core refuses
  another version, as today: it loads `host.js?api=12`, reads
  `hostApiVersion` and throws before it records or signs. The change of the number and the
  check for `approve` in `isHostPlugin` go in one commit. From Slice 4 the contract is
  internal to `@seams/wallet` (D2): the flow is a chunk that core imports on first use, one
  build has both sides, and the version check goes away.
- `record()` stays on the phrase surface that VoiceID gives to core (F9). Core gets the
  samples first and seals them, as today. So Speak-to-Sign still needs VoiceID on the Wallet
  host, which also serves the files of the speech model. The Wallet gets no dependency on
  `@seams/voice-capture` of its own, and none on `@seams/voice-sign/browser` (F11).
- The verify route of the server calls the verifier with `callVerifier` of
  `@seams/voice-sign/server`, in place of its own call in `speakToSignVerify.ts`. Two
  changes in speak-to-sign come first: an input type for sealed recordings, and a way to get
  the verifier output unchanged, because the route sends it on as it is. The route maps
  `VerifierCallError` to its fixed codes (`verifier_timeout`, `verifier_unreachable`). The
  gain is small, about 40 lines, but the OutLayer call then has one owner.

### 5. The app API

The code in this document is a sketch of the shapes, not final names.

```ts
defineSeamsConfig({
  approvals: [spoken({ network: 'testnet' })],  // today: transactionFeatures
});

// General request: the app writes the summary.
await seams.near.signAndSendTransaction({
  receiverId, actions,
  approval: { kind: 'spoken', summary: 'Pay Bob two NEAR' },
});

// Typed request: the sentence comes from the fields.
await seams.near.signAndSendTransaction(
  spokenRequest.transfer({ receiverId: 'bob.testnet', amount: '2' }),
);
```

- Without `approval`, the call shows the normal confirm. With it, the result has the same
  kinds as today: `approved`, `refused`, `cancelled`, `unavailable`.
- The descriptor `spoken()` comes from `@seams/wallet`. An app does not install the plugin
  package.

### 6. Packages after this plan

| Package | Repository | Change |
| --- | --- | --- |
| `@seams/voice-verdict`, `@seams/voice-capture`, `@seams/voice-sign` | speak-to-sign | None. No dependency on the Wallet |
| `@seams/wallet` | seams-wallet | Gets the approver chunk, the intent table and `signWithEvidence` |
| `@seams/wallet-server` | seams-wallet | Depends on `@seams/voice-sign`. One admission function for every kind |
| `@seams/voiceid` | seams-wallet | None. It still gives core the phrase surface |
| The Wallet plugin (`@seams/speak-to-sign`, `@seams/wallet-voice-sign`) | speak-to-sign, then removed | A package until Slice 4, then a chunk of `@seams/wallet` |

### 7. What does not change

- The verifier, the verdict format and the request format.
- The wire protocol between the app and the Wallet iframe, except the new `approval` field.
- The rule that one verdict signs once, and the step-up path.
- VoiceID, passkey and Email OTP: their code, their host API and their unlock.
- The limit of a general request: the voice proves who spoke and what they said. It does not
  prove that the app's summary describes the transaction.
- The invariants of Section 8.

### 8. Invariants that each slice keeps

A slice is done only when each row has a passing test for each kind that the row applies
to. A new kind is one table entry, its crate vectors, and its rows of the kind matrix and
of the round trip.

| # | Invariant | Where it holds | Test |
| --- | --- | --- | --- |
| 1 | The verdict key is pinned in code. It never comes from the app, the plugin or a server reply | Core, co-signer | A verdict of another key signs nothing |
| 2 | The request digest comes from the bytes that are signed. No caller supplies a digest | Core: from the intent that it builds. Co-signer: from the bytes that it signs | Round trip: the co-signer builds the same request from the bytes that core built, for each kind |
| 3 | The kind is in the digest (the tag byte). A verdict for one kind never signs another kind | Core, co-signer | Kind matrix: for each pair of kinds A and B, a verdict for B does not sign A |
| 4 | The verdict binds the spoken words, for each kind | Core | A verdict with the correct request digest and a wrong spoken-text digest signs nothing, for each kind |
| 5 | The verdict binds a recording of this flow | Core | A verdict with a clip of another flow signs nothing |
| 6 | One flow signs once, and the co-signer admits one verdict once | Core (the flow), co-signer (the ledger) | Two `sign` calls at the same time give one signature. A second request with the verdict is refused |
| 7 | A `step_up` verdict needs a fresh approval by the session's own method. An intent form with no fresh-approval path refuses | Core, co-signer | Step-up for each intent form. A verdict that expires while the owner decides signs nothing |
| 8 | The owner is the account of the session. No field and no plugin input sets it | Core, the verify route, co-signer | A request, a verify input and a transaction of another owner are refused |
| 9 | No recording leaves the device in the clear. From Slice 3 the plugin holds no raw audio | Core | Only sealed input reaches the verify route. A forged clip handle is refused |

Rows 2 and 4 are only partly true today. The digest of a general transaction and of a
message goes through the plugin (rule 6 of Section 3), and only the transfer has a test of
the spoken words. Slices 1 and 3 make both rows fully true in core.

The limits of each kind (no deposit on a note, a rating or a merge approval, the USDC
`ft_transfer_call` of a bet with 1 yoctoNEAR, the amount rules) are not rows here. They
belong to the table entries, and the crate vectors and the tests of each kind check them.

## Slices

Each slice ships alone and leaves the tests green.

- **Slice 0 (0.67.0). Done on 2026-11-11.** Released as 0.66.0 was released. The plugin is
  `@seams/wallet-voice-sign` 0.67.0, from speak-to-sign.
- **Status of Slices 1 and 2: built on 2026-11-11 on the branch `refactor-232`, not merged
  and not released.** `signWithEvidence` (`core/transactionFeatures/hostOperations.ts`) is
  the one sign path, and the three `...WithVerdict` operations call it. `SPOKEN_KINDS` has
  `request`, `call` and `fromCall` for each typed kind, and the co-signer builds a typed
  request only through `fromCall`. The 79 old tests passed with no change to their cases.
  Not built yet:
  - `parse` and `spokenText` as table entries. The limits and the sentences are still
    functions of core (`intentRefusal`, `renderTransfer`, `renderNoteAction`), and core
    checks both digests for each kind.
  (The tests of both slices are built: 89 Speak-to-Sign unit tests.)
- **Slice 1. `signWithEvidence` and the intent table in core and `shared-ts`.** The three
  `...WithVerdict` operations call it. No host API change. The unit tests of the four
  Speak-to-Sign files must pass with no change to their cases. New tests: the kind matrix in
  core, the spoken words for each kind, the transfer rules in core, two `sign` calls at the
  same time, and a verdict that expires during a step-up (rows 3, 4, 6 and 7 of Section 8).
- **Slice 2. One admission function in the co-signer** that reads the same table, from
  bytes to the request only. New tests: the round trip and the kind matrix in the co-signer,
  a transfer that is not a whole hundredth, and a `step_up` verdict for a message and for a
  delegate action (rows 2, 3 and 7). Deploy the server before the Wallet: a kind or a call
  form that only one side knows gives `request_mismatch`, so a wrong order refuses and signs
  nothing.
- **Slice 3. The approver contract.** `approve` replaces the three request methods.
  Host API 12 for Speak-to-Sign. New tests: `sign` has no intent parameter, a forged clip
  handle and a handle of another flow are refused, `sign` after the flow ended is refused,
  a plugin of version 10 does not load, and a plugin of version 11 with no `approve` does
  not load (rows 2, 8 and 9).
- **Status of Slice 3: built on 2026-11-11, not merged and not released.** Wallet side:
  branch `refactor-232` (`core/transactionFeatures/hostApproval.ts` binds the operations).
  Plugin side: speak-to-sign branch `plugin-host-api-12`. Details that differ from Section 4:
  - Core keeps its own operations (`openPrompt`, `verify`, `payWithVerdict` and the others)
    as an internal layer with its tests, and `hostApproval.ts` gives the plugin only the
    bound operations. `@seams/wallet/speak-to-sign-host` exports data contracts only.
  - `enrollClips(clips, onAuthorized)` has a callback, so the card can change when the owner
    signed. `enroll` gets `phraseCount`, and the phrases are in core.
  - The request view has texts only: `kind`, `form`, `displayText`, `spokenText`,
    `counterparty`, `amount`, `summary`.
  - The digests of the two general kinds (`actionsSha256`, `payloadSha256`) are computed by
    the Wallet route (`handlers/speakToSign.ts`), which is core code, before the plugin
    runs. They never pass through the plugin. They are not computed inside
    `signWithEvidence`, because the action bytes come from the signer worker, which only
    the route has. The co-signer computes both again from the bytes that it signs.
  - Tested: the names and the arity of the operations (type test and route test), a copied
    clip handle, the operations after the flow ended, and the plugin contract e2e test (a
    plugin of host API 10 and a plugin with no `approve` do not load).
  - The release must ship the Wallet and the plugin together, with new versions. The
    hosted Wallet must compose the new plugin, because a plugin of host API 10 does not load.
- **Slice 4. The plugin goes away** (D2). Its flow becomes a chunk of `@seams/wallet`, and
  the server's verify route uses `callVerifier` of `@seams/voice-sign/server` (after the two
  changes of Section 4 in speak-to-sign). Remove the Speak-to-Sign host API version, the
  host path `/sdk/speak-to-sign/host.js`, its `compose` step and the package in
  speak-to-sign. Deprecate the npm name.
- **Slice 5. The app API** (D3): `approval` on the sign calls, `approvals` in the
  configuration, descriptors from `@seams/wallet`. Breaking.

## Not in this plan

The owner cut these on 2026-11-11. Each needs its own plan.

- One authenticator contract for passkey, Email OTP and VoiceID. About 100 source files
  switch on the method, and they are the unlock and custody code. It gives no new function
  until a fourth method exists.
- VoiceID unlock by a TEE verdict in place of the voice match in the browser.
- A verifier from Wallet operator configuration.
- `spoken-intent` as WASM in core and the co-signer, in place of the hand-written ports.

The security review found these limits of today. This plan does not change them.

- The co-signer's ledger admits one verdict once for each request id, not once for each
  signed bytes. A second request with the same id and the same verdict passes the ledger.
- The verdict does not bind the gas of a typed call.
- The verifier does not sign `policy_text`, which the step-up confirm shows.
- A summary cannot start with a transfer verb, but it can be the sentence of a bet or of a
  merge approval. This rule is in the `spoken-intent` crate.

## Open questions for the owner

1. Does an app need a typed helper for each kind (`spokenRequest.transfer`), or is the
   `typed` namespace of today the better name?
