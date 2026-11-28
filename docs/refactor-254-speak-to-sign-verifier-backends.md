# Refactor 254: Speak-to-Sign verifier backends (SaySo first, OutLayer second)

Status: 2026-11-28. Slices 1 to 5 are built (Section 6). Of Slice 3, G1 passes on today's
sentences by 16 readings, and G3 passes on staging with a hedged turbo call (Q16, Q17). Slice 4 is built on `dev` with design A (Section 6, "Slice 4
result"), and Slice 5 wrote its docs ("Slice 5 result"); neither is released or deployed.
Slice 6 is not built.
Section 8 lists the questions for the owner and the answers; Q16 and Q17 wait for the owner. Section 9 holds the
architecture review that the owner asked for before Slice 2, and Section 8 holds the owner's
answers to it. The 10 NEAR rule is removed, and Slice 2 is the neutral evidence checker
(Section 6, "Slice 2 result").

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
- **SaySo is the backend on every lane, `staging-testnet` first** (Section 8, Q9). SaySo is the
  Cloudflare verifier that runs at `https://sayso.seams.sh` in the same Cloudflare account as
  the Gateways. The Gateway calls it through a service binding. The browser never gets a SaySo
  token.
- **OutLayer becomes a module that is off.** Its code moves without a change of behaviour. Its
  tests stay. A lane setting turns it on again.
- **Voice is an equal approval method.** The owner decided on 2026-11-27 that voice approves
  what a passkey step-up approves (Section 8, Q8). The Wallet adds no amount rule, and SaySo
  has none. The 10 NEAR rule stays only inside the OutLayer verifier.
- **Two changes in SaySo first.** It must not forgive a word in the recipient or the amount of
  a Wallet request, and `@seams/sayso-verdict` must be an exact release.
- **No D1 migration.** The verdict ledger and its table stay.
- **The trust claim changes.** The SaySo backend has no TEE and needs none: one operator runs
  it. What a TEE attestation proved before now rests on trust in the operator's Cloudflare
  infrastructure (Section 8, "The trust model"). The docs and the card stop saying "TEE
  receipt", Intel TDX, Phala and NEAR AI for it.

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
  [Refactor 232](https://github.com/seams-tech/seams-wallet/blob/110a67a38/docs/refactor-232-wallet-plugins-by-evidence.md) designed it for more kinds.
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
  - The repository was local only, and its packages were not published. S2 changes both
    (Section 6, "Slice 3 progress").
- **F8. SaySo reads the Wallet's sentences as they are.** `@seams/sayso-verdict` `createIntent`
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
  `@seams/sayso-verdict`. The verify route, Wallet core and the co-signer import only the port. The
  repository has no ESLint, so a check of the import graph holds this, as
  `tests/scripts/check-packed-wallet-boundaries.mjs` does for the packed SDK. Do not add a
  check of source text.
- Each lane names one active backend: `SPEAK_TO_SIGN_BACKEND = sayso | outlayer` in the
  Gateway env, and the same value in the Wallet host's lane configuration. The Wallet host has
  no lane configuration today (Section 9, R2), so this rule needs a design first.
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
| `sentence`           | The words that the owner says (`spokenText`), not the card's `displayText`                        |

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

**Step-up.** The SaySo backend has none. Voice is an equal approval method (Section 8, Q8):
an accepted verdict approves what a passkey step-up approves, with no amount rule in Wallet
core or in the co-signer. The first plan had a function `spokenStepUp(request)` for a transfer
above 10 NEAR; it is not built. A `step_up` verdict of the OutLayer verifier still needs its
fresh approval, because that outcome is in the signed verdict of that backend.

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
  `@seams/sayso-verdict` is published as an exact version. seams-wallet pins that version.
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
2. **The neutral evidence checker.** The `EvidenceChecker` of Section 1 for the v2 kind, with
   `expiresAtMs` and `signedAtMs` in its result (Section 9, R5). Core and the co-signer reach
   the verdict only through it. No change of behaviour. The 10 NEAR rule of the first plan is
   not built (Section 8, Q8).
3. **SaySo S1 to S3, and the gates G1 to G3.** In the SaySo repository. Record the
   measurements in a seams-wallet evidence file.
4. **The SaySo backend.** The server module, the SDK module, `saysoVerdictV1.ts`, the
   `enroll` operation with its step-up, and the card lines. Unit tests use verdicts signed by a test key. A type fixture
   holds that the co-signer accepts only the active kind. Two parts follow from the owner's
   answers (Section 8, Q13 and Q14):
   - **The card shows the request.** Built before the rest of Slice 4, because it does not
     depend on SaySo (Section 6, "The spoken card"). The spoken card shows what the Wallet's
     confirm shows for the same bytes: the receiver, the actions and the amounts. The summary
     of the application stays as the words to say.
   - **The setting that turns voice off exists.** It is the VoiceID switch in Authentication
     methods (`VoiceIdAvailabilityControl.tsx`). With VoiceID off or not set up, the Wallet
     answers a spoken request with `voiceid_unavailable`
     (`walletIframe/host/handlers/speakToSign.ts`) and the application uses the confirm. So
     Slice 4 adds no screen. It adds only the delete of the voice template at SaySo when the
     owner removes the VoiceID method, through a delete route in SaySo (R4).
   - **No new UI.** The owner said on 2026-11-27: "you shouldn't really need any new UI (or
     minimal) to integrate sayso." The SaySo backend changes the text of the card's receipt
     lines and nothing else that the owner sees.
   - **A request above SaySo's limits gets no spoken approval** (Section 8, Q7). The Wallet
     answers it as unavailable with the reason, and the application uses the confirm. First
     measure which limits hold for a transcript-only intent: the plan has only the 8 s of
     audio and the 200 bytes of `heard` for it, not the 16 words.
5. **Docs.** `speak-to-sign.md` in English and Japanese, `hosted-integration.md`,
   `voiceid.md`, `docs/wallet-steps.md` and the release notes in `README.md`. Remove the TEE
   claims for the SaySo backend, and the 10/20 NEAR co-signer limits (F5). Write the privacy
   text for the audio that goes to Cloudflare Workers AI (Section 8, Q6), and where the verdict
   key is and what the co-signer's check guards (Q12).
6. **Release and staging.** An SDK and server release. Deploy the server first, then the
   Wallet host, then the apps. The `SAYSO` binding and the `SAYSO_API_KEY` secret go into the
   Gateway's deployment config in seams-console, whose `scripts/deploy-backend.mjs` checks the
   service bindings of each Worker. Then the first staging voice check: enroll, a transfer of
   10 NEAR, and a transfer above 10 NEAR, which voice alone approves.

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

### Slice 2 result (2026-11-27)

Built on `dev` in `5162cc831`, with no change of behaviour: the order of the refusals of core
and of the co-signer is the same.

- **The checker.** `shared-ts/src/speakToSign/evidence.ts` holds `EvidenceChecker` and
  `evidenceChecker(kind)`. A checker has three steps, not the one function of Section 1:
  `read` the text (a refusal of the verifier, or the expiry), `open` it against the pinned key
  (signature, kind, outcome, expiry), and `bindingRefusal` of the opened evidence (request
  digest, spoken-text digest, recording). The steps are apart because the co-signer asks for
  the fresh approval of a step-up before it decodes the bytes that it signs.
- **Opened evidence** holds `verdictId`, `stepUp`, `signedAtMs` and `expiresAtMs`. The
  co-signer's `freshApproval` and its ledger read them, so no shared code reads a constant of
  the v2 format (R5).
- **The v2 kind.** `evidence/voiceVerdictV2.ts` holds `VOICE_VERDICT_V2_CHECKER` and is the one
  reader of the v2 library. Core (`voiceVerdict.ts`, `hostOperations.ts`) and the co-signer
  (`voiceVerdictAdmission.ts`) import only `evidence.ts`.
- **The kind of a lane.** `BACKEND_EVIDENCE_KIND` gives the evidence kind of each backend. The
  Gateway passes the kind of its backend to the co-signer (`evidenceKind`), and core writes it
  into `SpokenEvidence`.
- **Check.** `pnpm check:speak-to-sign-backends` also fails when a file other than
  `evidence.ts`, an evidence kind or a backend module imports a module in `evidence/`. A probe
  file proved it.
- **Tests.** The 8 unit files (167 cases), the plugin contract test and the four type checks
  pass. The tests changed only their harness: the `kind` of four core checks and the
  `evidenceKind` of the co-signer check.

For Slice 4:

- `ExpectedEvidence` holds the request digest, the spoken-text digest and the recordings. The
  SaySo checker also needs the owner, the kind of the request and the spoken words for its
  intent. The co-signer must then render the words from the request.
- The checker compares a digest as base64url text. Before, core compared the bytes with the v2
  library and the co-signer compared the text. A verifier writes one text for one digest.
- `open` takes the pinned key as text. `SPEAK_TO_SIGN_VERIFIERS` still holds only OutLayer
  data, and core still reads the v2 verify output (`parseVerifyOutput`) outside a backend.

### The spoken card (2026-11-27)

The answer to Q13, built on `dev` in `f40c0e7b5` before the rest of Slice 4.

- **What the card shows.** Above the sentence of a general transaction, a delegate action or
  a message, the card has a box "This request". For a transaction it holds the receiver and
  one line for each action with its fields: the key and permissions of a new key, the account
  that gets the balance of a deleted account, the arguments of a call. For a message it holds
  the recipient and the text. A typed kind gets no box: the Wallet writes its sentence.
- **The same words as the confirm.** `core/transactionFeatures/spokenRequestContext.ts` reads
  the review tree of the confirm (`buildDisplayTreeFromTxPayloads`) and its action titles
  (`nearActionTitle`, moved out of the Preact label). It builds the lines from the transaction
  that the signer builds the bytes from, never from text of the application.
- **Tokens.** A transfer of a token on the Wallet's own list also shows its amount, such as
  "Token transfer: 12.5 USDC to bob.testnet". Another contract shows only its arguments.
- **No new card code.** The lines go into the `context` slot of the phrase card of
  `@seams/voice-capture`, which the note flow uses. So this needs no release of that package.
  The box is plain text: it has no copy button, and a long request scrolls in it. Arguments
  above 600 characters are cut, and the line says how many characters are left.
- **Checks.** 6 new unit cases (`tests/unit/speakToSignRequestContext.unit.test.ts`); the 9
  unit files have 173 cases, and all pass. The transaction tree and review browser tests pass
  on Chromium and WebKit; Firefox is not installed for Playwright on this machine. A preview
  page with the real card of `@seams/voice-capture` showed the box for a transfer with a new
  key, a token transfer and a message.

### Slice 3 progress (2026-11-27)

**S1 is built** in SaySo `1e02ffb` on `main`. With the owner's yes, the Worker at `https://sayso.seams.sh` runs it since
2026-11-27 03:10 UTC (version `2caac3c4`; the version before is `ffef6563`). The verdict key
did not change.

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

The [evidence file](evidence/refactor-254-slice-3-sayso-20261127.md) has the measurements of S1
to S3 and of each gate.

**S2: done.** The repository is moved, and both packages are on npm.

- **The names.** The npm scope `@sayso` belongs to another party: the npm user `sayso`, who
  publishes `sayso-mcp-server` for a prediction-market product at sayso.so. The owner chose
  `@seams/sayso-verdict` and `@seams/sayso-client` (2026-11-27). The name SaySo itself is also
  that product's name; nothing else in this plan depends on it.
- **The repository.** `https://github.com/seams-tech/say-so`, public (the owner's choice), default
  branch `main`, from SaySo `1610600`. A scan of its 7 commits found no secret.
- **The release path.** `.github/workflows/release.yml` tests, packs and publishes both
  packages with one exact version and npm provenance. `scripts/npm-trust.sh` makes the workflow
  their trusted publisher. npm trusts a workflow only for a package that exists, and it refused a
  placeholder version, so the script first publishes the real first release from the owner's
  terminal. It needs the owner's npm login and two-factor approval.
- **The first version is 0.2.0**, the version in the workspace. The packed tarballs install in a
  new project and give the pinned digest `a63e63c8…`.
- **CI.** The first CI run of the new repository passed (run `45934386701`).
- **Pushed.** With the owner's yes, `main` is at `3da0c0c` since 2026-11-27, with the mock-mode
  fix, the `staging-testnet` environment, the G1 bench and transcript-only intents. CI passed
  (run `45946768685`).
- **Deployed.** With the owner's yes, `sayso.seams.sh` runs `3da0c0c` since 2026-11-27 (Worker
  version `04760e00`; the version before is `2caac3c4`). The container image and the verdict key
  did not change. The probes give the pinned digests for an intent with no guards, with guards
  and transcript-only (`fw0hpoPb…`); an intent with both is refused; "acct7" reads "acct
  seven"; `/v1/verify` with no token answers 401.
- **Published: `@seams/sayso-verdict` and `@seams/sayso-client` 0.2.0** (2026-11-27, about 18:43
  JST), from the owner's terminal with `scripts/npm-trust.sh` at SaySo `49bf51e`. npm refused the
  placeholder `0.0.0-stage` (403), and the owner did not want an npm token, so the first release
  is the real one, with no provenance. Both install from npm; the client depends on exactly
  `@seams/sayso-verdict` 0.2.0, and the package gives the pinned transcript-only digest.
- **Trusted publishing:** `@seams/sayso-verdict` trusts `release.yml` of `seams-tech/say-so`
  (relationship `5d3c10a8`, read in the script output). For `@seams/sayso-client` the first
  approval expired. The owner ran the script once more and approved the client's relationship on
  npmjs.com (2026-11-27). I could not read it back: `npm trust list` and the package settings page
  each need the owner's security key. The next release through the workflow proves both: a
  package with no trusted publisher refuses the workflow's publish. Every later version comes from
  the workflow, with provenance.
- The seams-wallet pin waits for Slice 4, because no code in seams-wallet imports the package
  before it.

**R3, mock mode: fixed** in SaySo `fa13032` (local, not deployed). Mock mode signs only with the
public mock seed, and a real verdict key with `SAYSO_DEV_MOCK=true` stops the Worker.

**G1 with perfect transcripts** (SaySo `354016f`, `bench/stt1`, free). The corpus is rebuilt from
the exact versions of the baseline: 250 requests, 6,742 cases. Each case text is scored as its
own transcript, so only SaySo's word check acts:

| Guards                                     | Correct readings accepted | False accepts                        |
| ------------------------------------------ | ------------------------- | ------------------------------------ |
| The values only (the S1 example above)     | 2,664 of 3,000 (88.8%)    | 484 of 3,742: "lend" for "send" (444), "remove" for "add" (40) |
| Every word                                 | 2,664 of 3,000 (88.8%)    | 0 of 3,742                           |

- **The S1 example is not safe.** The Wallet must guard the verb as well as the values. Then
  "sent ten near …" refuses, so the plan's test pair holds only for the mechanism, not for a
  Wallet request. In a Wallet sentence nearly every word is then guarded, so SaySo forgives
  almost nothing.
- **The word limit caps G1 below 95%.** SaySo refuses the intent of 28 of the 250 requests (336
  correct readings), because they have more than 16 words: 20 transfers and 8 multisig
  transfers. The 8 s audio cap of the Worker may refuse more; the audio is not measured yet.
  The 95% target of Refactor 210 Q6 needs a higher limit first (Q7).

**G1 with Whisper large-v3-turbo: fails** (owner's yes on 2026-11-27; 401 audio minutes, about
$0.21; SaySo `9c78b65`). With every word guarded, SaySo accepts 125 of 3,000 correct readings
(4.2%; transfers 2.2%) and no near miss. The baseline accepts 88.4%. Whisper writes
"eric.testnet", which SaySo reads as one word, and it spells sound-alike names in its own way
("eric" for "erik"). A test variant that spells the punctuation reaches 47.0%, with 5 false
accepts from sound-alike contacts. The
[evidence file](evidence/refactor-254-slice-3-sayso-20261127.md) has the causes.

This changes the design of Slice 4 (Q15). SaySo's word check cannot decide a Wallet request.
The choices:

- **A. The Wallet decides the words.** SaySo signs the transcript in the verdict (today it
  keeps `heard` only on a refusal), and Wallet core and the co-signer run `spoken-intent` on it
  with the contacts, as the OutLayer verifier did inside its TEE. SaySo then checks only the
  speaker and the audio. Recommended: it is the parser that reached 88.4% with 0 false accepts.
  The cost: `shared-ts` has the request and the words, but no copy of the parser
  (`normalize_punctuated`, `parse_transfer`, the phonetic key). `spoken-intent` builds for
  `wasm32-unknown-unknown`, so Slice 4 adds that build to core and the co-signer.
- **B. SaySo learns the Wallet's grammar.** sayso-wasm gets the punctuation rules and a list of
  contacts. This breaks SaySo's rule of no chain code, and it repeats `spoken-intent`.
- **C. Keep OutLayer for transfers.** Its funding is stopped (owner, 2026-11-26).

**The owner chose A** (2026-11-27). The SaySo side is built in SaySo `c6235d5` (local):

- An intent can set `transcript_only` (`createIntent({ transcriptOnly: true })`). SaySo then
  checks the speaker, the audio and the single use of the recording, but not the words. An
  accepted verdict carries the transcript as written in `heard`, with its case and punctuation,
  cut to 200 bytes. The verdict keeps its 12 fields.
- Its `intent_digest` uses the domain `sayso:intent:transcript:v1\0`, so such a verdict never
  matches an intent whose words SaySo checks. It cannot have guarded words, so the Wallet does
  not use S1. Vector, with the inputs of the S1 vector and no guards:
  `7f0d21a683dbffa7dd0678670db1a8d339e510c36548eb823408e3cca3100d9f`.
- The same commit fixes a normalizer fault: it dropped the digits of a mixed word, so "acct7"
  and "acct9" both read "acct", and a misheard account passed the word check.

**G1 under design A** (SaySo `3da0c0c`, no cost: the turbo transcripts scored again with the
baseline's own `spoken-intent` scorer):

| Transcriber                  | Slot rules (`3a284a874`) | Forgiving rules (`976167297`) | False accepts |
| ---------------------------- | ------------------------ | ----------------------------- | ------------- |
| NEAR AI Whisper large-v3     | 88.4% (transfers 94.6%)  | 91.1% (transfers 98.0%)       | 0             |
| Workers AI large-v3-turbo    | 83.4% (transfers 90.5%)  | 86.1% (transfers 93.9%)       | 0             |

So design A has no false accept, but turbo reads about 5 points below large-v3, and G1 as
written ("at least the NEAR AI result") fails. Most multisig losses are "Approved" for
"approve" and digit strings, which the forgiving rules do not cover.

**G1, the two paid tries** (2026-11-27, with the owner's "complete it all"; about $4.20 in all).
Neither closes the gap:

- **Deepgram Nova-3** reads 45.5% and 60.2% under design A with the stream's options then
  (`numerals`, `smart_format`), and 62.1% and 80.7% with no options. With `numerals` it drops a
  spoken "point", so a moved decimal point pays the request (6 and 9 false accepts). SaySo's
  stream used those options; it sends none since SaySo `f7aa760` (staging only).
- **A contact prompt** for turbo made each call 2.4 times slower and wrote "88888" for "eight
  thousand eight hundred eighty eight": 66.5% against 89.2% on the same 803 readings.
- A fix of the multisig wording cannot be measured on STT-1: today's `spoken-intent` has no
  challenge words, so the STT-1 multisig sentences are old (Q16).

**G1 on today's grammar: passes as written** (2026-11-28, about $0.20). A new corpus with
today's sentences (seams-console `e76d5b1c`, SaySo `9f3de86`): the 200 transfers of STT-1 and 50
multisig approvals in today's words, 3,000 correct readings and 3,642 near misses. Turbo with
today's `spoken-intent` (speak-to-sign `8db52c1`) reads 2,668 of 3,000 (88.9%; transfers 95.0%,
multisig 65.2%) with 0 false accepts. The gate is 2,652 (88.4%).

- **The margin is small:** 16 readings. NEAR AI large-v3 was not run on this corpus, so the
  compare with the baseline is not like for like.
- **The 16-word limit of SaySo** refuses the intents of 32 requests (384 readings). With it,
  2,311 of 3,000 pass (77.0%), or 88.3% of the readings that SaySo takes. The Wallet offers no
  spoken approval for those requests (Q7), and the baseline had no such limit.
- **Multisig holds the result down.** "Ad member" for "add member" passes 8 of 120; a test that
  reads "ad" as "add" gives 90.0% with 0 false accepts. The 95% target of Refactor 210 Q6 is not
  reached. The evidence is `docs/evidence/refactor-254-g1-today-grammar-20261128.md`.

What Slice 4 must build for A: the SDK and the Gateway send a transcript-only intent; the
`saysoVerdictV1` checker reads `heard` with `spoken-intent` and the contacts, and refuses
unless the parse gives exactly the request; core and the co-signer get the `spoken-intent` wasm
build. Open for Slice 4: the co-signer has no contact list, so it can only compare the heard
receiver with the request's receiver.

**S3: deployed** (2026-11-27, with the owner's "complete it all"). The Wrangler environment
`staging-testnet` is the Worker `sayso-verifier-staging-testnet`, with its own Durable Objects
and container, no route and no `workers.dev` URL.

- **Its secrets** are a new `VERDICT_SECRET_KEY_HEX` and `SAYSO_API_KEY`, and no
  `SAYSO_ENROLL_SECRET`, so only a service binding with the key can enroll or verify. The verdict
  public key for the Wallet pin is
  `3d96c3d21be6b7864cadfe1d5e57366e45774d7513972710e2569aa33a0d6895`. The values are in
  `~/.seams/staging-testnet/sayso.env`.
- **Its image** is the speaker image of `sayso.seams.sh`, by its registry tag, because a local
  image build hung in Docker Desktop's credential helper.
- **A fault fixed:** every enrollment on a cold container failed, because two of its three
  recordings reached the container before it listened. All requests now wait for one shared
  start. The staging lane runs the fix, and `sayso.seams.sh` runs it since 2026-11-28 (Worker
  version `2535f751`, SaySo `98f8691`). That deploy found that the speaker image did not build
  from its `Cargo.lock`; SaySo `a0c4318` fixes it, and the new image gives the same embeddings
  (evidence, section 1.4).
- The Gateway side (the binding, the secret and the lane rule in seams-console) is Slice 6.

**G2: passes.** The SaySo speaker image and the image that Phala ran, both on this machine, on
the 30 private clips: the same decision for every clip at 450 milli, a score difference of 0
milli, and an embedding cosine of 0.99999999 or more. No clip left this machine.

**G3: failed at p95 on 2026-11-27; passes with a hedged turbo call since 2026-11-28.** Through a
service binding to the staging Worker, with a `say` voice: 40 warm verifies at p50 1.68 s and p95
4.57 s; 5 cold verifies at p50 2.47 s and a maximum of 6.87 s. All 45 accepted.

- **The cause, measured.** With the time of each part (SaySo `8f93822`), the turbo call was the
  slowest part in 320 of 320 warm verifies. Two equal turbo calls outside SaySo have a
  correlation of 0.07, so the tail is inside Workers AI (inferred).
- **The fix.** A second, equal turbo call starts when the first has not answered in 1.5 s, and
  the first answer wins (SaySo `b4481dc`, lane version `538d0a45`). 160 warm verifies: p50 1.39
  s, p95 3.21 s, maximum 4.71 s, against p95 3.85 s without it in the same runs. 5 cold verifies:
  maximum 2.59 s. The extra cost is about $0.009 for each 1,000 verifies.
- `sayso.seams.sh` has no hedge yet. The evidence is
  `docs/evidence/refactor-254-g3-verify-time-20261128.md` (Q17).

### Slice 4 result (2026-11-28)

Built on `dev` with design A (Q15): SaySo checks the speaker and the audio and signs the
transcript; Wallet core and the co-signer decide the words with `spoken-intent`. Not released,
not deployed and not tried on staging; Slice 6 does that.

- **The pin and the kind.** `@seams/sayso-verdict` 0.2.0 is pinned exactly in `shared-ts`, the
  Wallet and the server. `sayso` is in `SPEAK_TO_SIGN_BACKEND_IDS`, and `BACKEND_EVIDENCE_KIND`
  maps it to `sayso_verdict_v1`.
- **The checker** (`shared-ts/src/speakToSign/evidence/saysoVerdictV1.ts`). `open` accepts a
  signature of any pinned key (a list, for a rotation), refuses a verifier other than
  `sayso/x.y.z` (so no `+mock` verdict), and has no step-up. `bindingRefusal` builds the
  transcript-only intent from the request (`user_id` `near:<network>:<owner>`, `action`
  `seams.near.<kind>`, the request digest, the spoken words) and compares `intent_digest`, then
  the recording, then the words: `heard` must read with `normalize_punctuated` as exactly the
  spoken words of the request. The only contact is the request's receiver, on both sides. The
  pin for testnet is the staging key `3d96c3d2…0d6895`; mainnet has none.
- **The port changes.** `ExpectedEvidence` holds the `SpokenRequest`, and the co-signer renders
  its words with `renderSpokenRequest`. `bindingRefusal` is async. A new refusal code `words`
  lets core answer `refused: words`, so the owner can say the sentence again. `VERDICT_KEYS`
  holds the keys of each kind and network. `EvidenceChecker.reachesContracts` says whether a
  note, a rating and a bet carry the verdict to their contract: true for v2, false for SaySo
  (R6). The co-signer refuses a SaySo verdict inside such a call, and still requires the v2
  verdict in a bet.
- **`spoken-intent` for wasm32** (`wasm/spoken_intent`, 56 KB). It links the crate of
  seams-tech/speak-to-sign at `bbb7617` (`dev`) as a Git dependency, and exports one function,
  `heard_words`. `shared-ts/src/speakToSign/heardWords.ts` holds the module; each runtime names
  how it loads it: the server through `initializeServerWasm`, the Wallet from `sdk/workers/`.
  The build scripts, the server's asset copy and the third-party notices include it.
- **The Gateway module** (`backends/sayso/`). It calls the `SAYSO` service binding with
  `Authorization: Bearer SAYSO_API_KEY` and builds the intent with `createIntent({
  transcriptOnly: true })`, with the owner that the route checked. It serves `verify`, `enroll`
  and `delete`; OutLayer serves `verify` and `enroll`. SaySo's error text never reaches the
  answer or the log.
- **The verify body names its backend:** `{ backend, input }`. Another backend gives 409
  `backend_mismatch` (R5). `SPEAK_TO_SIGN_BACKEND` is now required beside any backend setting
  (R7): a lane with OutLayer settings and no `SPEAK_TO_SIGN_BACKEND` stops at start.
- **The SDK module** (`verifiers/sayso/`) is the backend of Wallet core; OutLayer stays as a
  module that is off. The port builds the verify input (`verifyInput`), reads the output
  (`parseOutput`), proves an enrollment (`authorizeEnrollment`) and gives the delete input. The
  OutLayer request form moved into its module (R5).
- **Enrollment (Q2, Q11).** The Gateway enrolls on SaySo only with a Wallet Session that a
  passkey or Email OTP issued in the last 120 s; a VoiceID session never counts. The Wallet gets
  such a session with a passkey unlock just before it sends the clips.
- **Limits (Q7).** SaySo refuses a sentence of more than 16 words or 160 characters, also for a
  transcript-only intent. Core asks the backend before the card opens, and answers
  `unavailable: verifier_unavailable` with the reason, such as "The sentence has 18 words; the
  verifier takes at most 16." The audio is cut at 8 s as before.
- **The card** changes only its receipt lines and step texts: "Verifier receipt", "Seams
  verifier · Cloudflare", ReDimNet B1, Whisper large-v3-turbo on Workers AI, and no TEE link.
- **The template delete (R4).** SaySo `d6ccbea` (local, not pushed or deployed) adds
  `POST /v1/template/delete` with a test. The Gateway serves `op: 'delete'` on SaySo. The Wallet
  deletes the template before VoiceID goes off or is removed; a failed delete stops the change,
  because the co-signer accepts a verdict whatever the local switch says. A lane with no verify
  route (404) or another backend (409) has nothing to delete, so the change goes on.
- **Checks.** `pnpm check:speak-to-sign-backends` passes and now also covers the SaySo modules
  and `@seams/sayso-verdict`. The 10 Speak-to-Sign unit files have 200 cases, and all pass:
  `speakToSignSaySo.unit.test.ts` is new, and the other files test SaySo in core, the co-signer
  and the route beside their OutLayer cases, which keep the OutLayer module by injection. The
  type fixture `tests/typecheck/speak-to-sign-backends.typecheck.ts` holds that the co-signer
  takes one evidence kind. `tsrs` passes for `shared-ts`, the Wallet, the server and the two
  test configs. SaySo's `pnpm test:ts` (20 tests) and `pnpm typecheck` pass.
- **Not checked:** the WASM load from `sdk/workers/` in a browser, the passkey unlock of an
  enrollment, and a call through a real `SAYSO` binding.

For Slice 6:

- seams-console `render-d1-gateway-config.mjs` sets the OutLayer variables and no
  `SPEAK_TO_SIGN_BACKEND`. It must set `SPEAK_TO_SIGN_BACKEND`, the `SAYSO` binding and
  `SAYSO_API_KEY` before the lane runs this server.
- The Wallet asks for the fresh approval with a passkey only. An Email OTP wallet cannot enroll
  yet; the Gateway already accepts an Email OTP session.
- A sound-alike of the receiver reads as the receiver (the forgiving rules of `spoken-intent`);
  the card shows the receiver, and another account does not pass.
- Deploy SaySo `d6ccbea` before the Wallet: a Gateway delete on an older Worker answers 404,
  and VoiceID cannot go off.

### Slice 5 result (2026-11-28)

Built on `dev`: the docs of the SaySo backend as Slice 4 built it. Not released or deployed.
The pages hold no gate numbers.

- **Files.** `apps/docs/src/concepts/auth-methods/speak-to-sign.md`, `voiceid.md` and
  `deploy-and-operate/hosted-integration.md`, each with its `ja` copy; `docs/wallet-steps.md`;
  the "Next release" section of `README.md`. Also the "Next release" section of
  `apps/docs/src/releases.md` and its `ja` copy, because the public release notes have their own
  text. Also four code comments that named only OutLayer: `attestationUrl` in `hostPlugin.ts`
  (twice), the typed transfer in `publicApi/spoken.ts` and `publicApi/speakToSign.ts`, and the
  summary route in `speakToSignVerify.ts`.
- **What the pages say.** SaySo is the backend of the Wallet. `staging-testnet` is its first
  lane, and the other lanes have no verify route. OutLayer is a module that is off: a short
  section says that `SPEAK_TO_SIGN_BACKEND=outlayer` answers this Wallet with 409
  `backend_mismatch`, and links the 0.76.0 text at `7123e190b`. The pages describe design A,
  the 16-word and 160-character limit, the passkey unlock of an enrollment (a wallet with no
  passkey cannot enroll yet), the template delete when VoiceID goes off, no amount rule, the
  verdict key in the operator's Cloudflare account, what the co-signer check guards and what
  it does not guard, and the audio path and what SaySo stores. The Japanese speak-to-sign page
  had another order and no table of typed calls; it now has the sections of the English page.
- **Checked in the code.** No amount rule (`voiceVerdictAdmission.ts`), the pinned keys and
  the `sayso/x.y.z` rule (`saysoVerdictV1.ts`), the 120 s fresh session
  (`SAYSO_ENROLLMENT_FRESH_MS`), the passkey unlock (`freshApproval` in
  `walletIframe/host/handlers/speakToSign.ts` calls the passkey `unlock`), the delete only with
  the `spoken` descriptor (`createRegistrationCommands.ts`), the route codes and the setting
  names (`saysoBackend.ts`, `select.ts`, `speakToSignVerify.ts`). The sound-alike and separator
  rules come from `spoken-intent` at `bbb7617` (`punctuated/mod.rs`, `recipient.rs`) and the
  Slice 4 unit cases. What SaySo stores comes from SaySo `d6ccbea`: `accountVoiceDo.ts` keeps
  the template, the used audio digests for 7 days and the rate events, and
  `workers/verifier/src` logs no audio and no transcript.
- **Faults fixed on the way.** The pages said that each ledger record deletes the wallet's
  records older than 24 hours. The ledger deletes the records of expired verdicts
  (`d1VoiceVerdictLedger.ts`, `PRUNE`). `docs/wallet-steps.md` used
  `seams.speakToSign.requestNote` with `summary`, which 0.66.0 and 0.69.0 removed.
- **Not confirmed in the code:**
  - What Cloudflare itself keeps of the audio in Workers AI. The pages say only that the audio
    goes to no service outside Cloudflare.
  - Which secrets the deployed SaySo Workers hold (R3). The pages name the verdict key a Worker
    secret, from SaySo's code and the S3 evidence.
  - The browser parts that Slice 4 did not check: the WASM load from `sdk/workers/`, the passkey
    unlock of an enrollment and a call through a real `SAYSO` binding.
  - The template delete: SaySo `d6ccbea` serves it, and no Worker runs that commit yet.
  - The second transcription call (the hedge of G3, SaySo `b4481dc`). The pages say that SaySo
    can send a recording to Workers AI a second time, with no time and no gate number. Only the
    `staging-testnet` Worker runs it, the SaySo `main` on GitHub does not hold it yet, and Q17
    waits for the owner. If the owner drops the hedge, delete that line.

For Slice 6:

- When the release has its number, move the Speak-to-Sign items of "Next release" in
  `README.md`, `releases.md` and `hosted-integration.md` under it.
- The pages say "only `staging-testnet` has a verifier". Change them when another lane gets
  SaySo, with its pinned key.
- The Wallet deletes the template only when the application that turns VoiceID off has the
  `spoken` descriptor. In another application the template stays at SaySo. The Wallet still
  refuses a spoken request while VoiceID is off, so this keeps a template, not a way to sign.

## 7. Invariants

- Evidence binds the owner, the request digest, the sentence, a recording of this flow and an
  end time. Core and the co-signer check it with the same function.
- One backend is active on a lane. The co-signer refuses the evidence kind of the other one.
- Voice approves what a passkey step-up approves. The Wallet and the co-signer set no amount
  rule for it. A voice enrollment needs a fresh passkey or Email OTP approval, never a voice.
- The browser never holds a SaySo token or key.
- SaySo evidence has no attestation. The Wallet and the co-signer trust the verdict key that
  the operator holds in its Cloudflare account, on testnet and on mainnet.
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
| Q8  | What may voice alone approve, and to what value (R1)? Answered below                       | The typed kinds only; any transaction, delegate action or message steps up  |
| Q9  | Which lanes get a verifier with no TEE (R2)? seams-console permits only `staging-testnet`  | `staging-testnet` first; a production lane after G1 to G3                   |
| Q10 | One SaySo deployment and key for each lane, or one for all with the lane in `user_id` (R3) | One for each lane, as the Gateways are. This extends Q4                     |
| Q11 | May a VoiceID unlock be the fresh approval of an enrollment (R4)?                          | No: a passkey or Email OTP only, because VoiceID is the same voice again    |
| Q12 | The verdict key, the templates and the co-signer in one Cloudflare account (R3)            | Accept it with the trust text of R3. Answered: also for mainnet             |
| Q13 | The spoken card shows only the application's summary; the confirm shows the request (R1)   | The card shows what the confirm shows, so that the two methods are equal    |
| Q14 | A Wallet setting that turns voice approval off and deletes the template (R4)               | The VoiceID switch is that setting. Slice 4 adds only the template delete   |
| Q15 | G1 fails with SaySo's word check (4.2%). Who decides the words of a Wallet request?          | Answered: A                                                                 |
| Q16 | G1 under A on today's sentences: turbo reads 88.9% (gate 88.4%), 0 false accepts; 77.0% with the 16-word limit | Accept turbo for `staging-testnet`; keep the 95% target open; next, the "ad" alias for member sentences |
| Q17 | G3: the turbo call sets the verify time; a hedged second call at 1.5 s gives warm p95 3.21 s | Keep the hedge (SaySo `b4481dc`); measure again through the Gateway in Slice 6 |

### Answers of the owner (2026-11-27)

- **Q8.** "It should be able to approve any transaction normal stepup with passkey can
  approve. It is an equal authorization method (since it's optional, users can toggle it
  on/off, theres less of a security issue)". So the plan has no amount rule, and Slice 2 is
  the neutral checker.
- **Q10.** Agreed: one SaySo deployment and one key for each lane. This also answers Q4.
- **Q15.** A: SaySo signs the transcript, and Wallet core and the co-signer run `spoken-intent`
  on it (2026-11-27).
- **Q11 and Q2.** Agreed: an enrollment needs a fresh passkey or Email OTP approval. A VoiceID
  unlock does not count.
- **Q13 and Q14.** "agreed, build both in Slice 4". The card shows what the confirm shows, and
  the Wallet gets a setting that turns voice off and deletes the template (Section 6, Slice 4).
  The card is built (Section 6, "The spoken card"). The setting exists already: the review
  was wrong that the Wallet has none. It is the VoiceID switch (Section 6, Slice 4).
- **Q1, Q5, Q6, Q7, Q9 and Q12.** "Agreed on all six recommendations" (2026-11-27). So:
  - **Q1.** `user_id` is the NEAR account, `near:<network>:<accountId>`.
  - **Q5.** Live words on the card come later, after G3. Slice 4 does not build them.
  - **Q6.** Slice 5 writes the privacy text for the audio.
  - **Q7.** The Wallet offers no spoken approval for a request above SaySo's limits, and says
    why (Section 6, Slice 4). The limits are not raised.
  - **Q9.** `staging-testnet` gets SaySo first. A production lane follows only after G1 to G3
    pass. The lane rule of seams-console already permits `staging-testnet`, so the first lane
    needs only its `speakToSignVerifier` schema to change (Section 9, R2).
  - **Q12.** The verdict key, the templates and the co-signer stay in one Cloudflare account,
    with the trust text below in the docs. This holds for mainnet too (see below).
- **Mainnet follows testnet** (2026-11-27). Each answer here for testnet holds for mainnet: the
  same backend, the same trust model, and a deployment and a key for each lane. No second
  decision comes before mainnet. The order of Q9 stays: `staging-testnet` first, then the
  other lanes after G1 to G3.
- **The trust model** (2026-11-27). "for sayso, since it's a centralized operator running the
  infra, we don't need a TEE, and anything that used TEE attestations before will now simply
  trust the operator's cloudflare infra". So the plan adds no attestation and no quote check
  for SaySo, and `attestationUrl` is `null`. The limits of R3 on the key in the operator's
  account are accepted, not faults. The other changes of R3 stay, because they guard one lane
  from another and the real key from mock results: a key for each lane, no public enroll
  route, and no mock mode with a key.
- Q3 was answered by Slice 1. No question is open.

## 9. Architecture review (2026-11-27)

The owner asked on 2026-11-27: "let's review the plan first, and spot any architectural issues
first". Two reads made this list: one by the session that wrote the handoff, and one by a
reviewer that did not see the first list. Both found R1, R2 and R3. Read at seams-wallet
`5a2c55a38`, SaySo `6e17c4f`, speak-to-sign `dev` `bbb7617` and seams-console `04a18a1d`. The
word limit of SaySo is F8 and Q7. Each item is measured in the code unless it says otherwise.

**R1. The step-up rule sees one kind of seven.** The owner answered this with Q8: voice is an
equal approval method, so the plan has no amount rule and the "Change" below is not built.
Two parts follow. The card showed less than the confirm (Q13, built). The answer relies on a
setting that turns voice off: the VoiceID switch in Authentication methods is that setting
(Q14).

- The OutLayer policy steps up only an `AccountTransfer` above 10 NEAR; every other kind is
  `Allow` (speak-to-sign `dev`, `crates/voice-verifier/src/policy.rs`, `decide`).
- The `transaction` kind is any NEAR transaction. The request holds the receiver, a SHA-256 of
  the actions and the summary (`shared-ts/src/speakToSign/spokenRequest.ts:86-99`). The
  application writes the summary (`speak-to-sign.md`, "The application writes the summary"),
  and the card shows only that sentence (`core/transactionFeatures/hostApproval.ts:162`).
- So voice alone can sign a transfer of the whole balance or an `AddKey` under the words "Sign
  the guest book". A delegate action and a NEP-413 message are the same. A bet goes to
  1,000,000 USDC with no step-up.
- `spokenStepUp(request)` cannot see this value: the request holds a hash, not the actions.
- The co-signer checks a verdict only when the signing request carries one
  (`voiceVerdictAdmission.ts:121`). Its rule binds an honest Wallet core. It is not a limit on
  the session.
- Change: the rule reads the decoded actions of the bytes to sign, in Wallet core and in the
  co-signer, for each kind and each signing form (transaction, delegate action, message). A
  fresh approval is the default, and the rule lists what voice alone may approve (Q8).
- This gap is in the OutLayer path today, on `staging-testnet` only. Slice 2 as written keeps
  it, and "every lane" takes it to production.

**R2. The Wallet host has no lane setting.**

- The application sends the whole configuration of the Wallet host with `PM_SET_CONFIG`
  (`SeamsWeb/walletIframe/host/index.ts:395`), and a `spoken` descriptor holds only `kind` and
  `network` (`core/transactionFeatures/plugins.ts:8-24`).
- The SDK backend is a build constant (`core/transactionFeatures/verifiers/backend.ts:63`).
  The pinned keys are for each network, not for each lane (`evidence/voiceVerdictV2.ts`).
  Staging and production testnet are both `testnet`, so they cannot run different backends,
  and staging cannot try SaySo first.
- The Gateway and the co-signer are one Worker and read one env
  (`hosted-wallet-gateway.ts`), so only the Wallet host lacks the setting.
- seams-console refuses a verifier on a lane other than `staging-testnet`
  (`scripts/deployment-targets.mjs`, `assertGatewayDeploymentConfigMatchesLane`), and its
  `speakToSignVerifier` schema holds only OutLayer fields (`gateway-deployment-config.mjs`).
  "SaySo on every lane" needs both to change (Q9).
- Change: a setting that the operator builds into the Wallet host of each lane, never from the
  application, names the backend and its pinned key. Another choice is to pin the backend in
  the table of each network and make one deployment for each lane (Q10). The Gateway stops at
  start when its env names another backend. Slice 6 adds the seams-console schema, the lane
  rule and the local lane, which has no service binding.

**R3. SaySo as deployed is too open to be the trust root.**

- One Worker `sayso-verifier` has one verdict key and one template for each `user_id`
  (`workers/verifier/wrangler.jsonc`, `accountVoiceDo.ts`). With `near:testnet:<account>`, a
  staging enrollment replaces the template that production testnet uses. Not measured: whether
  two lanes can hold the same NEAR account for two people.
- `SAYSO_API_KEY` authorizes an enrollment for any `user_id` (`workers/verifier/src/auth.ts`,
  `authorizeEnrollment`). S3 gives the same value to the Gateway of each lane, so a staging
  Gateway can enroll for a production account.
- The Worker is public at `sayso.seams.sh` with `SAYSO_ALLOWED_ORIGIN: "*"` and HMAC tokens,
  beside the service binding.
- With `SAYSO_DEV_MOCK=true` and a configured key, the Worker signs mock results with the real
  key (`workers/verifier/src/index.ts`, `getWarmSigner` and `buildEngine`). `verifyVerdict` of
  `@seams/sayso-verdict` checks only the type of `verifier`, so a `sayso/0.2.0+mock` verdict passes.
- The verdict key is a secret in the Cloudflare account that also runs the co-signer. With
  OutLayer the key was bound to a TEE project. With SaySo the co-signer's check guards against
  a fault of the client, and not against the operator or a stolen deploy token. The owner
  accepts this for testnet and mainnet (Section 8, "The trust model").
- Not measured: which secrets the deployed Worker holds.
- Change, in Section 4: a deployment and a key for each lane (Q10). Enroll and verify come
  only through the binding, and the Worker has no HMAC secret. The Worker refuses mock mode
  when a key is set. The Wallet's checker refuses a `verifier` that is not `sayso/x.y.z`. The
  pinned data is a list of keys, so that a rotation needs no forced release. Section 7 and the
  docs of Slice 5 say what the co-signer's check guards and where the key is (Q12).

**R4. The enrollment proof on SaySo is not defined.**

- The verify route does an identity read and admits an exhausted session
  (`speakToSignVerify.ts`, the comments at 42 and 206). It has no step-up. The only fresh
  approval check is on the signing route (`voiceVerdictAdmission.ts:281`, `freshApproval`).
- An enrollment replaces the template, and SaySo has no route that deletes one
  (`accountVoiceDo.ts`, `PUT /template`).
- A VoiceID unlock counts as a fresh approval, and the plan reuses the VoiceID samples. That
  is the same voice two times (Q11).
- Change: Q2 is a requirement, not a question. Keep a signed statement over the clip digests,
  as the OutLayer module has (`verifiers/outlayer/outlayerVerifier.ts`, `enrollmentDigest`),
  signed after a fresh approval and checked by the Gateway. Add a delete route to SaySo.

**R5. The port still has the shape of OutLayer.**

- Wallet core builds the OutLayer input (`op`, `owner`, `request`, `contacts`) before the
  port, and the SDK port takes the v2 `SpeakToSignVerifier` with `project` and `audioKey`
  (`verifiers/backend.ts:51-59`). The verify route reads `op` and `owner` from that input.
- Core and the co-signer import `evidence/voiceVerdictV2` directly, and the import check
  allows it. `freshApproval` finds the time of signing with `VOICE_VERDICT_LIFE_MS`, a v2
  constant (`voiceVerdictAdmission.ts:285`). SaySo also uses 120 s, but only by chance.
- The `EvidenceCheck` of Section 1 has no `expiresAtMs` and no `signedAtMs`. The ledger and
  `freshApproval` need them.
- The Gateway result holds `attestationUrl`, `transcriber` and `timing`
  (`speakToSign/backend.ts:19-27`). They fit SaySo with `attestationUrl: null`.
- Change: build the `EvidenceChecker` for the v2 kind before Slice 2, with those two fields.
  Slice 2 then changes neutral code one time. Slice 4 defines a verify body that names its
  backend, and the Gateway answers `backend_mismatch`, which also covers the deploy window of
  Slice 6.
- No change: the `voice_verdict` field of the signing request needs no kind. The signed JSON
  holds its `kind`, each kind has its own key and signing domain, and the co-signer picks the
  checker of the lane.

**R6. The kind table depends on the backend.** A note, a rating and a bet put the verdict into
the signed call (`shared-ts/src/speakToSign/spokenKinds.ts`, `VERDICT_ARGS`), and the
co-signer checks that the call carries it (`transactionCarriesVerdict`). F4 says that this file
stays, and Section 2 changes these calls. Change: each backend declares the kinds that it
serves, and Slice 4 defines the call of these three kinds on SaySo in one place.

**R7. Small items.**

- An unset `SPEAK_TO_SIGN_BACKEND` means `outlayer` (`speakToSign/backend.ts:54`). Make the
  value required when two backends exist.
- The Slice 2 test "for both evidence kinds" is not possible before Slice 4. Slice 2 tests the
  v2 kind, and Slice 4 adds the SaySo cases.
- `nearAiApiKey` in `backends/select.ts` is a need of the OutLayer module in the neutral
  selector.

**The order after the review.**

1. Slice 2: the neutral checker of the v2 kind (R5). Built (Section 6, "Slice 2 result").
2. Slice 3: G1 first, because it decides go or no-go, then the SaySo changes of R3 and R4.
3. Slices 4 to 6. Q9 and Q12 are answered (Section 8), so Slice 4 waits only for Slice 3.

If the OutLayer credits end before Slice 6, no lane has a verifier. The Gateway then has no
verify route and the co-signer refuses each verdict, so the failure is closed.
