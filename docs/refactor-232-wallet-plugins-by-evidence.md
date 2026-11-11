# Refactor 232: Wallet plugins by evidence (VoiceID and Speak-to-Sign)

Status: plan, 2026-11-11. Nothing is built. Written against `dev` at `bb2014e1f` and
speak-to-sign `dev` at `4478fb8`.

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
- **`@seams/wallet-voice-sign` goes away.** The Wallet uses `@seams/voice-sign` of
  speak-to-sign directly: `recordSentence` in the browser and `callVerifier` on the server.
  The flow that is left is a part of `@seams/wallet` that loads on first use. The fourth
  package, its host API version and its release go away.
- **One authenticator contract for every method.** Passkey, Email OTP and VoiceID get the
  same shape in core. Passkey and Email OTP stay built in. VoiceID stays a package that the
  Wallet host loads, because it carries large models. A later biometric method is a new
  implementation of the same contract.
- **speak-to-sign has no dependency on the Wallet.** It keeps the verifier, the intent
  format, `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign`.

## Decisions for the owner

Decided on 2026-11-11: the Wallet gets a plugin architecture with one general shape for
authenticators (Section 6), and `@seams/wallet-voice-sign` goes away, so that the Wallet
uses `@seams/voice-sign` directly (D2, Section 4).

- **D1. The rule "evidence, not code".** An app never supplies code that runs in the Wallet.
  Code in the Wallet origin comes only from the Wallet operator. Recommended: yes.
- **D2. Decided: `@seams/wallet-voice-sign` goes away** (Slice 4). The Wallet depends on
  `@seams/voice-sign`.
- **D3. The app API.** Recommended: `approval` on the normal sign calls, and remove
  `seams.near.speakToSign` with no alias (as 0.66.0 did with `seams.speakToSign`). The
  `typed` calls stay as helpers that build a request.
- **D4. VoiceID unlock by a TEE verdict.** Recommended: not now. See Section 6.
- **D5. A verifier from Wallet operator configuration.** Recommended: yes, operator only,
  never from the app. See Section 5.

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
- **F9. VoiceID host API 11** has `unlock`, `activate`, `confirmOperation` and `openPhrase`.
  Its inputs are VoiceID types (`VoiceIdUnlockPreparation`, `VoiceIdOperationProof`). After
  a voice match **in the browser**, the plugin returns a device assertion and
  `factorSecret32` (`authMethods/voiceId/contracts.ts`). So core trusts the plugin's match.
  107 files of Wallet core and 36 files of the server name VoiceID.
- **F10. Policy.** [Refactor 225](refactor-225-jev-policy-engine.md) plans the policy engine
  (nothing built). Its rule is "tighten-only": a semantic rule never allows more than the
  deterministic rules.

- **F11. The three authentication methods are a closed list.** `WALLET_AUTH_METHODS` is
  `passkey`, `email_otp` and `voiceid` (`shared-ts/src/utils/signerDomain.ts`). About 100
  source files of the three packages switch on the method. Passkey and Email OTP are built
  into core, each with its own folders (`SeamsWeb/operations/authMethods/passkey` and
  `emailOtp`, `signingEngine/session/passkey` and `emailOtp`, and the server domains). They
  use no plugin interface.
- **F12. VoiceID is the only loaded authenticator.** `WalletAuthMethodPlugin` is
  `VoiceIdAuthMethodPlugin` only, and the folder `core/authMethods/` serves VoiceID only.
  `installAuthMethodSession` has a general name, but only the VoiceID unlock calls it.
- **F13. The custody model is already common.** Each method ends with a 32-byte factor
  secret that opens a method-bound envelope: `wallet_custody_envelope_v2` with `factor.kind`
  `passkey`, `email_otp` or `voiceid` (`shared-ts/src/passkey-custody/custodyEnvelope.ts`).
- **F14. `@seams/voice-sign` has the two parts that the Wallet needs.** `./browser` has
  `recordSentence` (the phrase card and the recording, on `@seams/voice-capture`). `./server`
  has `callVerifier` and `callVerifierWithAttestation` for every verifier operation. Its
  `confirm` and `select` use the request kind for an application owner, which the Wallet
  does not use.

## Terms

- **Evidence:** a signed statement from a verifier that binds an owner, a request digest, an
  outcome and an end time. The first kind is the voice verdict (F8).
- **Intent:** the thing to sign (a transaction, a delegate action or a message) together
  with the request that the evidence must bind.
- **Approver:** a part that gets an approval from the owner and returns evidence.
- **Authenticator:** a part that proves the owner is present, to unlock or to step up.
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
  this one operation, then they go away with the host API change of Slice 2.
- The co-signer gets the same shape: one admission function for every kind.

**The intent table.** One table in `packages/shared-ts/src/speakToSign/` has one entry for
each `SpokenKind`:

```ts
type SpokenKindEntry<Fields> = {
  parse(fields: unknown): Fields | null;      // the app's request fields
  sentence(fields: Fields): string | null;     // what the owner says, or null: app summary
  request(fields: Fields, owner: string): Uint8Array;   // Borsh of SpokenRequestV1
  intent(fields: Fields, owner: string): Intent;        // the bytes to sign
};
```

Core and the co-signer both read this table. A new kind is one entry and its vectors from
speak-to-sign. Today the same knowledge is in four core files, one server file and one
plugin method (F7).

Option (Slice 7): build `request` and `sentence` from the `spoken-intent` crate as WASM, so
that no kind is ported by hand. The golden vectors already compare the two.

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
      verify(clips: ClipHandle[], signal): Promise<VerifyReply>;
      sign(evidence: Evidence, signal, hooks): Promise<SignResult>;   // signWithEvidence
    };
    signal: AbortSignal;
  }): Promise<ApprovalResult>;
  enroll(input: EnrollInput): Promise<EnrollResult>;
}
```

- The plugin never holds raw audio that can leave the device. It holds a `ClipHandle`.
  (Today it gets WAV bytes and core seals them at `verify`.)
- `sign` takes no intent. Core bound the intent when it made `operations`, so the plugin
  cannot sign a different thing with good evidence.
- This contract is internal to `@seams/wallet` (D2). The flow is a chunk that core imports
  on first use. No version check is necessary, because one build has both sides.
- `record()` is `recordSentence` of `@seams/voice-sign/browser`, with the Wallet's asset
  folder, style nonce and texts (as `packages/voiceid/src/capture/configure.ts` does today
  for `@seams/voice-capture`). The card of `@seams/voice-capture` replaces `card.ts` of the
  plugin where it can.
- The verify route of the server calls the verifier with `callVerifier` of
  `@seams/voice-sign/server`, in place of its own client code in `speakToSignVerify.ts`.
- To check before Slice 4: `recordSentence` must give core the clip before any other code
  sees it, so that core can seal it. And the card must work inside the Wallet's size
  binding (`surfaceMeasurementBinding`).

### 5. The verifier is operator configuration

Today the verdict key and the audio key of each network are constants
(`SPEAK_TO_SIGN_VERIFIERS` in `shared-ts/src/speakToSign/voiceVerdict.ts`), and the server
has `SPEAK_TO_SIGN_OUTLAYER_*` settings.

- Keep the constants as the default.
- Let the Wallet operator replace them in the Wallet host configuration and in the server
  settings: endpoint, verdict key, audio key, and the TEE measurement that the keys belong
  to. Both sides must name the same keys, or the co-signer refuses.
- The app can never set them (R1).

This is the real plugin point for another party: a verifier that signs the verdict format.
It needs no Wallet code. Its risk is that it can approve every request, so the limits must be
in the policy engine and the co-signer (F10), not in the verifier.

### 6. The authenticator contract

Today the Wallet has no common contract for its methods (F11, F12). Only the end is common:
a factor secret that opens the method's envelope (F13). The contract makes that end the
interface:

```ts
interface Authenticator<Kind extends WalletAuthMethod> {
  kind: Kind;
  enroll(ctx: AuthContext): Promise<EnrollResult>;
  /** Proves the owner and gives the factor secret of this method's envelope. */
  unlock(ctx: AuthContext, challenge: UnlockChallenge): Promise<UnlockCapture>;
  /** A fresh proof for one operation (step-up, key export). It never unlocks. */
  confirm(ctx: AuthContext, statement: OperationStatement): Promise<OperationCapture>;
}

type UnlockCapture = { assertion: MethodAssertion; factorSecret32: Uint8Array };
```

- **One contract, two ways to load.** Passkey and Email OTP implement it as modules of
  core. VoiceID implements it as the host plugin that the Wallet host loads from its own
  origin (F2). Core calls all three through one registry, and one `installAuthMethodSession`
  serves all three.
- Passkey and Email OTP do **not** move out of core and do not go through the plugin
  loader. They need no models, the passkey is the root of the owner checks of the other
  methods, and a loaded file gives no gain.
- The list of methods stays closed (F11). A new method is a new `kind` in the Wallet's own
  code: its envelope factor, its server proof and its policy. The contract removes the
  switch statements from the general code. It does not let an app add a method (R1).
- This is the VoiceID host API of today (F9) with general names. `openPhrase` moves to
  core's `record()` of Section 4, so Speak-to-Sign does not need VoiceID to record.
- The risk is in the size: about 100 files switch on the method (F11), and they are the
  most security-critical code of the Wallet. So Slice 6 goes in steps: unlock first, then
  enroll, then step-up. Each step keeps the tests of all three methods green.
- **Phase 1: VoiceID stays trusted code in the Wallet origin.** It matches the voice in the
  browser and releases the factor. That is the same trust as today. The gain is a smaller
  contract and no VoiceID types in core's general code.
- **Phase 2 (D4, option): unlock by evidence.** The TEE verifier judges the voice, and the
  server releases its part of the unlock only for a good verdict. Then the browser match is
  not trusted code. The cost: the audio leaves the device (sealed), an unlock takes about 2 s
  longer (the OutLayer fixed time), and an unlock needs the network. The unlock secret needs
  a new design, because a verdict is not a secret.

### 7. The app API

The code in this document is a sketch of the shapes, not final names.

```ts
defineSeamsConfig({
  authMethods: [voiceId()],                     // today: voiceIdAuthMethod() of @seams/voiceid
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
- The descriptors `voiceId()` and `spoken()` come from `@seams/wallet`. An app that uses a
  hosted Wallet installs one package.

### 8. Packages after this plan

| Package | Repository | Change |
| --- | --- | --- |
| `@seams/voice-verdict`, `@seams/voice-capture`, `@seams/voice-sign` | speak-to-sign | None. No dependency on the Wallet |
| `@seams/wallet` | seams-wallet | Depends on `@seams/voice-sign`. Gets the approver chunk, the intent table and `signWithEvidence` |
| `@seams/wallet-server` | seams-wallet | Depends on `@seams/voice-sign`. One admission function for every kind |
| `@seams/voiceid` | seams-wallet | The authenticator contract. Still its own package (models) |
| The Wallet plugin (`@seams/speak-to-sign`, `@seams/wallet-voice-sign`) | speak-to-sign, then removed | A package until Slice 4, then a chunk of `@seams/wallet` |

### 9. What does not change

- The verifier, the verdict format and the request format.
- The wire protocol between the app and the Wallet iframe, except the new `approval` field.
- The rule that one verdict signs once, and the step-up path.
- The limit of a general request: the voice proves who spoke and what they said. It does not
  prove that the app's summary describes the transaction.

## Slices

Each slice ships alone and leaves the tests green.

- **Slice 0 (0.67.0). Release as 0.66.0 was released.** No API change. The plugin stays in
  speak-to-sign until Slice 4 removes it, so it does not move into this repository first.
  Its npm name from 0.67.0 is `@seams/wallet-voice-sign` (the owner's choice), which needs a
  first publish by hand.
- **Slice 1. `signWithEvidence` and the intent table in core and `shared-ts`.** The three
  `...WithVerdict` operations call it. No host API change. The unit tests of the four
  Speak-to-Sign files must pass with no change to their cases.
- **Slice 2. One admission function in the co-signer** that reads the same table.
- **Slice 3. The approver contract.** `approve` replaces the three request methods, and
  `record()` in core replaces `openPhrase` for Speak-to-Sign. Host API 11 for Speak-to-Sign.
- **Slice 4. The plugin goes away** (D2). Its flow becomes a chunk of `@seams/wallet` on
  `@seams/voice-sign/browser`, and the server's verify route uses
  `@seams/voice-sign/server`. Remove the Speak-to-Sign host API version, the host path
  `/sdk/speak-to-sign/host.js`, the `compose` step and the package in speak-to-sign.
  Deprecate the npm name.
- **Slice 5. The app API** (D3): `approval` on the sign calls, `approvals` in the
  configuration, descriptors from `@seams/wallet`. Breaking.
- **Slice 6. The authenticator contract** (Phase 1 of Section 6), in three steps: unlock,
  enroll, step-up. Passkey and Email OTP implement it in core. VoiceID host API 12.
- **Slice 7 (option). `spoken-intent` as WASM** in core and the co-signer.
- **Slice 8 (option). The verifier from operator configuration** (D5).
- **Later (D4). VoiceID unlock by evidence.** It needs its own plan.

## Open questions for the owner

1. Does an app need a typed helper for each kind (`spokenRequest.transfer`), or is the
   `typed` namespace of today the better name?
2. For D5, must the Wallet check the verifier's TDX quote itself, or is a pinned key from the
   operator enough? `@seams/voice-verdict` can check a quote (`checkQuoteSignature`,
   `checkQuoteCollateral`).
3. Is a hosted Wallet with VoiceID for every app the normal case? If yes, the `compose`
   command for VoiceID is a tool for operators only, and the app docs can drop it.
