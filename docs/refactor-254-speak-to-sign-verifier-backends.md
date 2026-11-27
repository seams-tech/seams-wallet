# Refactor 254: Speak-to-Sign verifier backends (SaySo first, OutLayer second)

Status: 2026-11-27. Slice 1 is built in `23b08a7d2` (Section 6, "Slice 1 result"). Of Slice 3,
S1 is built in SaySo `1e02ffb` (Section 6, "Slice 3 progress"); S2, S3 and the gates wait for
the owner. Slices 2, 4, 5 and 6 are not built.
Section 8 lists the open questions.

The owner decided on 2026-11-27: "Cloudflare verifier is now replacing the OutLayer backend as
the primary path for voice signing. Ideally, we keep OutLayer as a secondary path (if it's not
too much of an internal change). If there is any OutLayer-specific code, we should refactor it
into a module and make it easy to swap in and out."

This decision replaces the note of 2026-11-09 that a Cloudflare verifier is "a second backend
beside OutLayer, not a replacement"
([speed report](evidence/refactor-227-speak-to-sign-speed-20261109.md), item 5). The reason:
the owner stopped the OutLayer, Phala and X API funding on 2026-11-26, so the OutLayer path
stops when its credits run out.

## Result

- **One verifier port.** Wallet core, the Gateway and the co-signer use a backend through one
  interface. Each backend is one module on each side. Core and the co-signer check evidence
  with one shared function for each evidence kind.
- **SaySo is the backend on every lane.** SaySo is the Cloudflare verifier that runs at
  `https://sayso.seams.sh` in the same Cloudflare account as the Gateways. The Gateway calls it
  through a service binding. The browser never gets a SaySo token.
- **OutLayer becomes a module that is off.** Its code moves without a change of behaviour. Its
  tests stay. A lane setting turns it on again.
- **The 10 NEAR step-up rule moves into the Wallet.** Today the OutLayer verifier decides it.
  The rule then holds for each backend.
- **Two changes in SaySo first.** It must not forgive a word in the recipient or the amount of
  a Wallet request, and `@sayso/verdict` must be an exact release.
- **No D1 migration.** The verdict ledger and its table stay.
- **The trust claim changes.** The SaySo backend has no TEE. The docs and the card stop saying
  "TEE receipt", Intel TDX, Phala and NEAR AI for it.

## Facts

Checked on 2026-11-27 in seams-wallet `dev` at `d3255d548`, SaySo at `6e17c4f`
(`~/Dev/purin-labs/say-so`) and speak-to-sign `dev` at `bbb7617`.

- **F1. OutLayer is wired in directly.** The Gateway's verify route
  (`packages/mpc-wallet-server/src/router/domains/speakToSign/speakToSignVerify.ts`) calls
  `relayToVerifier` of `@seams/voice-sign/server` with an OutLayer configuration: base URL,
  project, version key, payment key, secrets profile and secrets account. Wallet core
  (`packages/mpc-wallet/src/core/transactionFeatures/voiceVerdict.ts`) and the co-signer
  (`.../speakToSign/voiceVerdictAdmission.ts`) call `checkVerdict` of `@seams/voice-verdict`
  0.72.0 directly. No interface sits between them and OutLayer.
- **F2. Size.** 67 source files in `mpc-wallet`, `mpc-wallet-server` and `shared-ts` name
  Speak-to-Sign. 19 of them hold OutLayer, TDX or v2-format details: 6 in the server, 11 in
  the SDK and 2 in `shared-ts`.
- **F3. One extension point exists.** `SpokenEvidence` in
  `packages/mpc-wallet/src/core/transactionFeatures/spokenIntent.ts:42-47` has one kind,
  `voice_verdict_v2`. Its comment says "The first kind is the voice verdict".
  [Refactor 232](refactor-232-wallet-plugins-by-evidence.md) designed it for more kinds.
- **F4. Most of the flow does not depend on the verifier.** These parts can stay:
  - the public `seams.near.spoken.*` API and the `approval: { kind: 'spoken' }` option;
  - the iframe flow and the approval card (not its receipt text);
  - the request kinds, the sentence and the request digest (`shared-ts/src/speakToSign/`
    `spokenKinds.ts`, `spokenWords.ts`, `spokenRequest.ts`);
  - the transaction binding (`voiceVerdictTransaction.ts`);
  - the co-signer's rules: the owner is the session account, a verdict counts once, a
    `step_up` verdict needs a fresh approval, the request digest comes from the signed bytes;
  - the ledger `speak_to_sign_voice_verdicts` (migration 0089; its `verdict_id` is text);
  - the `voice_verdict { verdict_json, signature_b64 }` field of the signing request.
- **F5. The OutLayer verifier holds the 10 NEAR rule.** Its policy step returns `step_up` with
  `policy_rule: "stub_voice_amount_above_10_near"`. Wallet core and the co-signer only honour
  `step_up`; the co-signer has no amount limit
  (`voiceVerdictAdmission.ts:1-6`). The public docs still describe the 10 and 20 NEAR
  co-signer limits that 0.66.0 removed (`apps/docs/src/concepts/auth-methods/speak-to-sign.md`).
- **F6. The pinned verifier.** `SPEAK_TO_SIGN_VERIFIERS` in
  `packages/shared-ts/src/speakToSign/voiceVerdict.ts:25-34` holds the OutLayer project, the
  verdict key `ed25519:E8E53…751U` and the audio key for testnet. Mainnet is `null`.
- **F7. SaySo.** A Worker `sayso-verifier`, deployed on 2026-11-23 in the `seamsadmin`
  account. `GET /healthz` answered 200 on 2026-11-27 with `"mock": false` and the public key
  `d3c6773f57691b7f6461dbd405bc29c2b7ce98da6d6a89d8627ea583b4a2551e`.
  - Speech to text on Workers AI: Whisper large-v3-turbo for `POST /v1/verify`, Deepgram
    Nova-3 for the `/v1/stream` WebSocket.
  - Speaker check: ReDimNet B1 in a Cloudflare Container that sleeps after 3 minutes.
    Enrollment takes 3 clips. A Durable Object keeps one template for each `user_id` and
    refuses an audio digest that it saw before.
  - Intent: `{ user_id, action, payload_sha256_hex, sentence }`. The verdict
    `sayso_verdict_v1` has 12 fields and an Ed25519 signature over
    `SHA-256("sayso:verdict:v1" || verdict_json)`. The answer is
    `{ verdict_json, signature_b64 }`, the same shape as the Wallet's `voice_verdict` field.
  - Auth: a short-lived HMAC token or `Bearer SAYSO_API_KEY`. `SAYSO_API_KEY` is not set.
  - It has no `step_up` outcome, no TEE, no attestation and no NEAR code.
  - The repository is local only. Its packages are not published.
- **F8. SaySo reads the Wallet's sentences as they are.** `@sayso/verdict` `createIntent`
  normalizes a sentence as the Worker does, so the Wallet can compute the same
  `intent_digest`. All 37 sentences in `tests/fixtures/spoken-intent/spoken_intent_vectors_v1.json`
  ("send two point five near to bob dash one dot testnet", ...) normalize to themselves.
  But SaySo refuses a sentence of more than 16 words or 160 characters, and it keeps 8 s of
  audio. 3 of the 37 sentences have more words: 17, 18 ("send nine hundred ninety nine
  thousand nine hundred ninety nine point nine nine near to alice dot testnet") and 40
  (Section 8, Q7).
- **F9. SaySo forgives too much for a transfer.** In a sentence of 4 or more words, SaySo
  accepts one changed or dropped word unless that word is a number or a negation word
  (`crates/sayso-wasm/src/words.rs:200-240`). So it accepts "rob" for "bob" in "send ten near
  to bob dot testnet". `spoken-intent` changes only words that hold no value, compares the
  amount and the receiver with the request, and matches the receiver against the contacts
  (speak-to-sign `crates/spoken-intent/src/punctuated/mod.rs:72-100`).
- **F10. Enrollment proof.** The OutLayer verifier checks a NEP-413 message from a full-access
  key and reads the key with `view_access_key`. SaySo checks only its token or API key. The
  templates are in OutLayer storage, so every owner must enroll again. Only testnet has
  owners, because mainnet has no verifier (F6).
- **F11. TEE claims.** `speak-to-sign.md` (English and Japanese) says "attested verifier",
  describes sealed audio that only the TEE opens, the TDX attestation, and a trust model of
  the OutLayer TEE, the Phala CVM and NEAR AI. The approval card shows "TEE receipt",
  "Intel TDX · OutLayer" and "View TDX quote" (`core/transactionFeatures/approver/card.ts`,
  `result.ts`).
- **F12. Tests.** 8 unit files with about 156 cases (`tests/unit/speakToSign*.unit.test.ts`),
  `tests/e2e/intended-behaviours/speak-to-sign.live.contract.test.ts` (needs
  `SEAMS_SPEAK_TO_SIGN_LIVE=1` and the OutLayer payment key),
  `speak-to-sign-plugin.contract.test.ts`, two wallet-ui cases, a type fixture
  (`tests/typecheck/speak-to-sign-api.typecheck.ts`) and the fixtures
  `tests/fixtures/outlayer-attestation/*.json`.
- **F13. Three kinds carry the verdict to a contract.** A note, a rating and a bet send the v2
  verdict to the demo contracts, which check it against `E8E53…751U`
  (`shared-ts/src/speakToSign/spokenKinds.ts`). The owner said on 2026-11-26 that the demo
  does not need to work.
- **F14. VoiceID does not use this stack.** `@seams-internal/voiceid` runs its models on the
  device. It shares only the recorder and card of `@seams/voice-capture`.

## Design

### 1. The verifier port

`shared-ts` gets the types that both sides use:

```ts
type SpeakToSignBackendId = 'sayso' | 'outlayer';

type SpokenEvidence =
  | Readonly<{ kind: 'sayso_verdict_v1'; output: unknown }>
  | Readonly<{ kind: 'voice_verdict_v2'; output: unknown }>;

type ExpectedEvidence = Readonly<{
  network: SpeakToSignNetwork;
  owner: string; // NEAR account ID of the Wallet Session
  request: SpokenRequestV1; // built from the bytes to sign
  spokenText: string;
  audioDigests?: readonly Uint8Array[]; // the recordings of this flow: Wallet core only
  nowMs: number;
}>;

type EvidenceCheck =
  | Readonly<{ ok: true; verdictId: string; stepUp: boolean }>
  | Readonly<{ ok: false; refusal: SpokenRefusal }>;

// One function for each kind. Wallet core and the co-signer call the same one.
type EvidenceChecker = (
  evidence: SpokenEvidence,
  expected: ExpectedEvidence,
) => Promise<EvidenceCheck>;
```

The server side of a backend:

```ts
interface SpeakToSignBackend {
  readonly id: SpeakToSignBackendId;
  readonly evidenceKind: SpokenEvidence['kind'];
  enroll(input: BackendEnrollInput, signal: AbortSignal): Promise<BackendEnrollResult>;
  verify(
    input: BackendVerifyInput,
    hooks: VerifyHooks,
    signal: AbortSignal,
  ): Promise<BackendVerifyResult>;
}
```

The SDK side of a backend gives what only the browser does: the audio form (sealed or plain),
the enrollment proof that it sends, and the receipt lines of the card.

Layout:

| Side    | Port                                            | SaySo module                     | OutLayer module                                                                                                        |
| ------- | ----------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Gateway | `router/domains/speakToSign/backend.ts`         | `.../backends/sayso/`            | `.../backends/outlayer/`: the OutLayer call, `speakToSignAttestation.ts`, `speakToSignTranscriber.ts`, its env parsing |
| SDK     | `core/transactionFeatures/verifiers/backend.ts` | `.../verifiers/sayso/`           | `.../verifiers/outlayer/`: audio sealing, the NEP-413 enrollment message, the TDX receipt lines, `attestationUrl`      |
| Shared  | `shared-ts/src/speakToSign/evidence.ts`         | `.../evidence/saysoVerdictV1.ts` | `.../evidence/voiceVerdictV2.ts`                                                                                       |

Rules:

- Only a backend module imports `@seams/voice-sign`, `@seams/voice-verdict` or
  `@sayso/verdict`. The verify route, Wallet core and the co-signer import only the port. The
  repository has no ESLint, so a check of the import graph holds this, as
  `tests/scripts/check-packed-wallet-boundaries.mjs` does for the packed SDK. Do not add a
  check of source text.
- Each lane names one active backend: `SPEAK_TO_SIGN_BACKEND = sayso | outlayer` in the
  Gateway env, and the same value in the Wallet host's lane configuration.
- The co-signer accepts only the evidence kind of the active backend. A client cannot pick
  the other backend.
- `SPEAK_TO_SIGN_VERIFIERS` holds pinned keys for each backend and network:
  `{ sayso: { publicKeyHex }, outlayer: { project, publicKey, audioKey } }`.

### 2. The SaySo backend

**Call path.** The Gateway keeps `POST /speak-to-sign/v1/verify` and its SSE events
(`verifier_running`, then `verdict` or `failed`). It checks the Wallet Session and that the
owner is the session account, as it does today. Then it calls SaySo through a service binding
`SAYSO` with `Authorization: Bearer SAYSO_API_KEY`. The audio goes as a plain WAV; nothing
seals it.

**Intent.** The Gateway and the SDK build the same SaySo intent with `createIntent`:

| SaySo field          | Value                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `user_id`            | `near:<network>:<accountId>`, for example `near:testnet:alice.testnet`                            |
| `action`             | `seams.near.<kind>`, for example `seams.near.transfer`                                            |
| `payload_sha256_hex` | The Wallet's request digest, `SHA-256("seams:spoken-intent:request:v1" ‖ borsh(SpokenRequestV1))` |
| `sentence`           | The sentence that the card shows                                                                  |

The request digest keeps the binding to the bytes that the Wallet signs (F4). The verdict
binds the request through `intent_digest`.

**Evidence check** (`saysoVerdictV1.ts`, used by core and the co-signer):

- the Ed25519 signature against the pinned SaySo key of the network;
- `kind` is `sayso_verdict_v1`, `outcome` is `accept`, `expires_at_ms` is in the future;
- `user_id` is `near:<network>:<owner>` and `action` is `seams.near.<kind>`;
- `intent_digest` equals the digest of the intent that the checker builds from `expected`;
- `audio_digest` is the digest of a recording of this flow. Only Wallet core has the
  recordings, so only core checks this; the co-signer gets no `audioDigests`;
- `verdictId` is the SHA-256 of the signed message, for the ledger.

**Step-up.** A function `spokenStepUp(request)` in `shared-ts` decides it: a transfer above
10 NEAR needs a fresh passkey or Email OTP step-up, or a new VoiceID unlock. Wallet core and
the co-signer both call it, for both backends. A `step_up` from the OutLayer verifier still
counts.

**Enrollment.** The verify route keeps its `op: 'enroll'` with three clips
(`SERVED_OPERATIONS` in `speakToSignVerify.ts`). On the SaySo backend it needs a Wallet
Session for the account and a fresh step-up, and it sets `user_id` from the session. This
replaces the NEP-413 message and the `view_access_key` read of the OutLayer verifier. The SDK
can reuse the VoiceID samples, as today.

**Note summaries.** The summary route `/speak-to-sign/v1/summary` (a NEAR AI chat model) is
not part of the verifier, so it stays. The OutLayer verifier also checks that the summary
fits the note; SaySo has no such check. On the SaySo backend the owner approves the summary
that the card shows and that they say.

**Card.** The SaySo module gives the receipt lines: the Seams verifier on Cloudflare,
ReDimNet B1 for the speaker, Whisper large-v3-turbo on Workers AI for the words. No TEE text.
`attestationUrl` is `null`; its type allows that already.

**The three kinds that reach a contract** (F13). On the SaySo backend, a note, a rating and a
bet stop sending the verdict to the contract. They sign as the other kinds do.

### 3. The OutLayer backend

The OutLayer code moves into its modules without a change of behaviour. Its unit tests and
fixtures stay. The live contract test stays behind `SEAMS_SPEAK_TO_SIGN_LIVE=1`. No lane turns
it on, because its funding is stopped.

The owner wants OutLayer only if the change is small. Slice 1 is that test: if the OutLayer
module needs more than a move (for example, a second card flow or a second admission path),
stop and ask the owner whether to delete it instead.

### 4. Changes in SaySo first

- **S1. Guarded words.** No forgiveness inside the recipient and the amount of a Wallet
  request. The intent gets `guarded_word_indexes` (the word positions of the amount and the
  recipient), and `intent_digest` covers them. `check_words` refuses a change or a drop at a
  guarded position. A test pair: "send ten near to bob dot testnet" heard as "... rob ..."
  refuses; heard as "sent ten near to bob dot testnet" accepts.
- **S2. A release.** The SaySo repository moves to the `seams-tech` GitHub organization, and
  `@sayso/verdict` is published as an exact version. seams-wallet pins that version.
- **S3. The service caller.** Set `SAYSO_API_KEY` on the Worker and the same value as a
  Gateway secret for each lane.
- **S4. A key for each network.** One verdict key for testnet now. Mainnet gets its own key
  when it gets a verifier (Section 8, Q4).

### 5. Gates before the release

These are the gates of the monorepo Refactor 210, Section 14.5, for SaySo:

- **G1. Words.** Whisper large-v3-turbo on Workers AI, on the STT-1 transaction sentences: at
  least the NEAR AI Whisper large-v3 result (88.4% of correct readings with the slot rules)
  and 0 false accepts, with S1 in place. The target of Refactor 210, Q6, is 95%.
- **G2. Speaker.** ReDimNet B1 in the Container gives the same accept and refuse results as
  the Phala build on the Gate 0 set, at SaySo's threshold of 450 milli.
- **G3. Time.** The whole verify step at p95 of 4 s or less on staging, also when the
  Container starts cold.

## 6. Slices

1. **The port and the OutLayer module.** A refactor with no change of behaviour: the port,
   the moves, the import check. Every existing Speak-to-Sign test passes without a change to
   its assertions.
2. **Step-up in the Wallet.** `spokenStepUp` in `shared-ts`, used by core and the co-signer.
   Tests: 10 NEAR passes, 10.01 NEAR needs a fresh approval, for both evidence kinds.
3. **SaySo S1 to S3, and the gates G1 to G3.** In the SaySo repository. Record the
   measurements in a seams-wallet evidence file.
4. **The SaySo backend.** The server module, the SDK module, `saysoVerdictV1.ts`, the
   `enroll` operation with its step-up, and the card lines. Unit tests use verdicts signed by a test key. A type fixture
   holds that the co-signer accepts only the active kind.
5. **Docs.** `speak-to-sign.md` in English and Japanese, `hosted-integration.md`,
   `voiceid.md`, `docs/wallet-steps.md` and the release notes in `README.md`. Remove the TEE
   claims for the SaySo backend, and the 10/20 NEAR co-signer limits (F5).
6. **Release and staging.** An SDK and server release. Deploy the server first, then the
   Wallet host, then the apps. The `SAYSO` binding and the `SAYSO_API_KEY` secret go into the
   Gateway's deployment config in seams-console, whose `scripts/deploy-backend.mjs` checks the
   service bindings of each Worker. Then the first staging voice check: enroll, a transfer of
   10 NEAR, and a transfer above 10 NEAR with its step-up.

### Slice 1 result (2026-11-27)

Built on `dev`, with no change of behaviour. The OutLayer code was only a move behind a port,
so Section 3's condition holds: OutLayer stays as a module.

- **Gateway.** The port is `router/domains/speakToSign/backend.ts`. The verify route takes a
  `SpeakToSignBackend` and keeps the session check, the owner check and the SSE stream. The
  OutLayer module `backends/outlayer/` holds the configuration and its env names, the call, the
  error codes, `attestationUrlOf`, and the moved `attestation.ts` and `transcriber.ts`.
  `backends/select.ts` builds the backend that `SPEAK_TO_SIGN_BACKEND` names; unset means
  `outlayer`.
- **SDK.** The port is `core/transactionFeatures/verifiers/backend.ts`
  (`SPEAK_TO_SIGN_VERIFIER_BACKEND`). The OutLayer module `verifiers/outlayer/outlayerVerifier.ts`
  holds the audio sealing, the NEP-413 enrollment statement and `enrollmentDigest`, the card's
  verifier steps and timeout text, and the TEE receipt.
- **Shared.** `shared-ts/src/speakToSign/evidence/voiceVerdictV2.ts` is the only shared import
  of `@seams/voice-verdict` for the verdict (`spokenSummary.ts` keeps its summary limits). It holds
  `SPEAK_TO_SIGN_VERIFIERS`. `shared-ts/src/speakToSign/backend.ts` holds the backend IDs.
- **Check.** `pnpm check:speak-to-sign-backends` (`scripts/check-speak-to-sign-backends.mjs`,
  in `validate-wallet.yml`) reads the import graph with the TypeScript preprocessor. Only a
  backend module may import a backend's library, apart from three summary imports, and only the
  selector of its side may import a backend module.
- **Tests.** The 8 unit files (167 cases), the plugin contract test, the type fixtures and the
  type checks of both packages pass. Only import paths and the verify harness changed. The two
  wallet-ui cases did not run.

Where the build differs from Section 1, for Slice 4:

- The Gateway port has one `run` method, not `enroll` and `verify`: the OutLayer call relays both
  operations in the same way. The SaySo backend reads `op` itself.
- `SPEAK_TO_SIGN_BACKEND_IDS` holds only `outlayer`. Slice 4 adds `sayso`.
- The one checker for core and the co-signer (`ExpectedEvidence`, `EvidenceChecker`) is not
  built. The two checks of a v2 verdict differ: core compares the request and spoken-text
  digests and the recordings; the co-signer builds the request from the bytes that it signs and
  checks the step-up and the ledger. Slice 4 builds the checker with the SaySo kind.
- The SDK port takes the v2 `SpeakToSignVerifier` in `prepareInput` and `enrollmentStatement`.
  `readAttestationUrl` (the OutLayer record URL) and the `attestationUrl` fields stay where they
  are. Slice 4 makes the pinned data and the link check a part of each backend.

### Slice 3 progress (2026-11-27)

**S1 is built** in SaySo `1e02ffb` on `main`. The SaySo repository has no remote, so the commit
is local. The Worker at `https://sayso.seams.sh` is not deployed again: it still refuses an
intent that has the new field.

- **The field.** An intent can carry `guarded_word_indexes`: strictly ascending positions in
  its normalized words. `createIntent` takes `guardedWordIndexes` and sends the field only
  when the list is not empty. `prepare` and `POST /v1/render` return the list.
- **The check.** A changed word at a guarded position refuses with `words`. A dropped word
  refuses if any position that it could have is guarded. The number and negation rule stays.
  With guards `[1, 2, 4, 5, 6]` on "send ten near to bob dot testnet": "... rob ..." and a
  dropped "bob" refuse, "sent ten near ..." accepts.
- **The digest.** `intent_digest` appends `u32_le(count) ‖ one byte for each index` after the
  sentence, only when the list is not empty. The domain stays `sayso:intent:v1`. So an intent
  with no guards keeps its digest, and the Worker and its clients need not change at the same
  time. The other choice was a `v2` domain that always has the block; the SaySo README gives
  the reasons. It can still change before the S2 release.
- **A vector for Slice 4.** `user_id` `near:testnet:alice.testnet`, `action`
  `seams.near.transfer`, `payload_sha256_hex` `42` × 32, the sentence above and the guards
  above give the digest `a63e63c8e79f1e78101657310a9b5eedf1672fd5f55cf677db2be5accf86a583`.
  Without the guards it is `51bc8d22b29c0220a5cfb1a90c3ebebea5757c7f8293c0062beef13cb5968e86`.
  The Rust and the TypeScript tests of SaySo pin both values.
- **A fault fixed on the way.** An intent with an unknown or malformed field made the Worker
  throw after the speaker and transcriber calls. `verifyBatch` now checks the intent first and
  answers with a signed `unsupported` refusal before a model call.
- **Checks.** `pnpm test` and `pnpm typecheck` pass in SaySo: 11 Rust tests (8 in
  `sayso-wasm`) and 10 TypeScript tests.

**Not started:** S2, S3 and G1 to G3. Each needs the owner's yes: the `seams-tech` repository,
a push, a publish, a deploy, `SAYSO_API_KEY`, and a gate run that costs money. G1 and G3 need
the S1 Worker to be deployed.

**For S2.** SaySo has two edits that are not committed: `publishConfig: { access: public }`
in the `package.json` files of `@sayso/verdict` and `@sayso/client`. An Antigravity session
made them on 2026-11-24, after the owner chose to publish the two packages to npm. The owner
did not answer its next question, the npm scope: `@sayso`, `@seams` or `@purin-labs`.

## 7. Invariants

- Evidence binds the owner, the request digest, the sentence, a recording of this flow and an
  end time. Core and the co-signer check it with the same function.
- One backend is active on a lane. The co-signer refuses the evidence kind of the other one.
- The step-up rule does not depend on the verifier.
- The browser never holds a SaySo token or key.
- A word of the amount or the recipient is never forgiven (S1).

## 8. Open questions for the owner

| #   | Question                                                                                   | Recommendation                                                              |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Q1  | SaySo `user_id`: the NEAR account (`near:<network>:<accountId>`) or the wallet ID          | The NEAR account: the Gateway already checks that it is the session account |
| Q2  | Enrollment proof: a Wallet Session only, or a Wallet Session and a fresh step-up           | Both: a voice is a new way to approve payments                              |
| Q3  | Keep the OutLayer module, or delete it after Slice 1                                       | Keep it: Slice 1 was only a move (Section 6, "Slice 1 result")              |
| Q4  | Mainnet: one SaySo Worker with a key for each network, or one Worker for each network      | One Worker for each network, as the Gateways are                            |
| Q5  | Live words on the card through `/v1/stream` (Nova-3)                                       | Later, after G3                                                             |
| Q6  | The audio goes to Cloudflare Workers AI. The privacy text (Refactor 210, Q2) is still open | Write it in Slice 5                                                         |
| Q7  | SaySo refuses a sentence above 16 words; some Wallet amounts make longer sentences (F8)    | The Wallet offers no spoken approval for such a request, and says why       |
