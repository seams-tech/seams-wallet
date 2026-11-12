# Refactor 233: Auth methods by factor and gate

Status: 2026-11-12. Plan only. Nothing is built. The owner decided D1 to D4 on 2026-11-12.

Deferred (owner, 2026-11-12): the work starts after the NEAR hackathon and its judging, so the
release 0.68.1 of the submission stays unchanged. The refactor ships in a later breaking release.
The owner gave 0.70.0 to the non-breaking changes of 2026-11-13 (TDX quote check, TEE receipt).

The owner's problem (2026-11-12): the method names (`passkey`, `email_otp`, `voiceid`) are in
too many places. Today `case 'passkey'` has 154 arms, `case 'email_otp'` has 161 arms and
`case 'voiceid'` has 77 arms in 103 files. The owner wants the configuration of a method in a
much smaller number of files. The app API for methods also has three shapes for the same jobs.

This plan follows [Refactor 232](refactor-232-wallet-plugins-by-evidence.md). Refactor 232
made the approvals (Speak-to-Sign) clean. It did not change the authentication methods.

Scope, as the owner chose on 2026-11-12:

- **Low risk:** the phrase card in core (Section 2), and one app API for methods (Section 3).
- **Medium risk:** the gate contract and the factor table on the client (Section 4), and
  step-up from the factor table (Section 5).
- **Not in scope:** the server, the stored records and the custody flows (the end of this
  document).

## Result

- **A method is a factor and, for some methods, a gate.** The factor is what the server and
  the custody code verify. The gate is what the owner does on the device to release a factor.
  VoiceID is the factor `device_key` with the gate `voice`.
- **The signing engine switches on the factor, not on the method.** The factor set is small and
  closed: `webauthn`, `email_code`, `device_key`. A new local gate (a face check, a PIN) adds no
  arm to the engine.
- **The client has one factor table.** Each factor has one folder. One registry file maps a
  factor to its folder. A test fails if a method or factor literal is outside those files.
- **A gate gets a surface and a scoped store, never a key.** Core holds the device key, signs
  the challenge and opens the factor secret. The gate only says `passed`.
- **The Speak-to-Sign card no longer needs VoiceID.** Core opens the phrase card of
  `@seams/voice-capture/card` itself. A wallet with only a passkey can use `spoken`.
- **One app API shape for methods.** `authMethods: [passkey(), emailCode(), voiceId()]` in the
  configuration, and `seams.auth.methods.{list, add, remove}` and `seams.auth.unlock`.

## Decisions for the owner

- **D1. Decided (2026-11-12): only the Wallet operator writes a gate, for now.** In a later
  release, other parties can submit open-source gate modules. Section 1 says how this plan
  prepares for that. So in this plan the VoiceID gate becomes a chunk of
  `@seams/wallet`, as the approver did in Slice 4 of Refactor 232.
- **D2. Decided (2026-11-12): what a descriptor in `authMethods` means.**
  - If the app omits `authMethods`, the default is `[passkey(), emailCode()]`.
  - The list sets which methods the app can add, and which methods the auth menu offers.
  - A method that a wallet already has always unlocks, also if the app does not list it. The
    wallet belongs to its owner, not to the app.
- **D3. Decided (2026-11-12): old names.** No alias, as in Refactor 232. The release is a breaking release after 0.70.0.
  Remove `addPasskey`, `addEmail`, `activateAuthMethod`, `hasPasskey`, `unlockWithAuthMethod` and
  `getAuthMethodAvailability` in the same release (Slice 6).
- **D4. Decided (2026-11-12): `@seams/wallet` depends on `@seams/voice-capture`.** Section 4 of
  Refactor 232 said the Wallet gets no such dependency. Section 2 of this plan changes that. The
  dependency is a chunk that loads on the first spoken request. `@seams/voice-capture` does not depend on the
  Wallet, so the rule of the speak-to-sign repository stays.

## Facts this plan builds on

- **F1. The configuration is not symmetric.** `parseWalletAuthMethodPlugins` accepts only
  `{ kind: 'voiceid', transcriptionModel? }` (`core/authMethods/plugins.ts`). Passkey and Email
  OTP have no descriptor. They are always on.
- **F2. The plugin contract names VoiceID.** `WalletAuthMethodHostPlugin` has `unlock`,
  `activate`, `confirmOperation` and `openPhrase`. Their inputs use `VoiceIdUnlockPreparation`,
  `VoiceIdActivationPreparation` and `VoiceIdOperationProof` (`core/authMethods/hostPlugin.ts`,
  174 lines). No second method can implement it.
- **F3. The loader.** `loadWalletAuthMethodHostPlugin` imports `/sdk/voiceid/host.js` and
  checks `hostApiVersion === 11` (`core/authMethods/hostRegistry.ts`). It has four callers:
  `createSessionCommands.ts` (two), `createRegistrationCommands.ts` and `speakToSignPorts.ts`.
- **F4. The plugin reaches into core.** `@seams/wallet/voiceid-host` exports 26 names: the
  enrollment store, the device store (`createBrowserVoiceDevice`, `readBrowserVoiceDevice`,
  `openBrowserVoiceFactor`), the challenge bytes, the microphone preference and the card chrome.
- **F5. The gate is not cryptographic.** The device record holds a non-extractable Ed25519 key
  and a non-extractable AES-GCM key that wraps a random 32-byte factor secret
  (`core/authMethods/voiceId/deviceStore.ts`). The voice template is not in the wrap. The
  plugin matches the voice, then signs with the device key, then opens the factor
  (`voiceid/src/capture/deviceBridge.ts`, `captureVoiceIdUnlock`). So code in the Wallet origin
  can use the key with no voice. A gate that returns `passed` has the same strength as today.
- **F6. The server checks a device key.** It verifies an Ed25519 assertion over
  `seams:wallet-session:voiceid-device:v1` (`wallet-server/src/authorization/voiceIdDeviceProof.ts`).
  It never sees a voice.
- **F7. The phrase card goes through VoiceID.** `openPhrase` of the VoiceID plugin is a 60-line
  adapter over `openPhraseCard` of `@seams/voice-capture/card` (`voiceid/src/capture/phrase.ts`).
  It adds the Wallet's theme classes, the card controls, Minimize and the size reports.
  Speak-to-Sign calls it through `speakToSign.ts` line 458. So `spoken` needs VoiceID on the host.
- **F8. The capture settings come from VoiceID.** `configureVoiceIdCapture` gives
  `@seams/voice-capture` the asset folder `/sdk/voiceid/`, the microphone preference and the
  style nonce (`voiceid/src/capture/configure.ts`).
- **F9. Step-up uses an error as a branch.** `selectStepUpMethod` has runners for `passkey` and
  `emailOtp` (`stepUpConfirmation/methodRunners.ts`). For `voiceid` it throws
  `VoiceIdStepUpRequiredError` (`methodSelection.ts`, `requireNearStepUpAuth.ts`). Then
  `BrowserSigningSurface.ts` (line 3565) catches it, runs a VoiceID unlock with `step_up`, and
  calls again with `afterVoiceIdStepUp`. `signNear.ts` and `signEvmFamily.ts` hold the modal
  for this error.
- **F10. Most VoiceID arms in the engine compare identities.** A sample of 15 arms in
  `core/signingEngine`: 10 parse, build or compare `{ walletAuthMethodId, deviceKeyId }`
  (`exactSigningLaneIdentity.ts`, `signingLaneAuthBinding.ts`, `clientSessionPersistence.ts`,
  `ed25519SealedSessionRuntime.ts`, `availableSigningLanes.ts`, `capabilityReaderCore.ts`,
  `yaoPublicCapabilityReferences.ts`). Two arms select step-up. Three arms select a custody or
  export flow (`ed25519YaoExportFlow.ts`, `ecdsaExportFlow.ts`).
- **F11. Arms by area.** The client has the most arms in `core/signingEngine/session` (20, 26
  and 13 for the three methods), `core/signingEngine/flows`, `core/indexedDB/seamsWalletDB` and
  `react/components/AccountMenuButton`. The server has most in `router/cloudflare/d1`.
- **F12. The app API for methods** (`SeamsWeb/publicApi/types.ts`): `auth.unlock`,
  `auth.unlockWithAuthMethod({ method })`, `auth.unlockWithEmailCode`, `auth.hasPasskey`,
  `registration.addPasskey`, `registration.addEmail`, `registration.activateAuthMethod`,
  `registration.getAuthMethodAvailability`, `registration.setAuthMethodEnabled`,
  `registration.removeAuthMethod`. No call lists the methods of a wallet.

## Terms

- **Method:** what the owner sees and the app configures: passkey, Email code, VoiceID.
- **Factor:** what the server and the custody code verify. `webauthn` (a passkey assertion),
  `email_code` (a code from the server), `device_key` (an Ed25519 assertion of a key on this
  device, with a wrapped factor secret).
- **Gate:** a local check that the owner passes before core uses a `device_key` factor. The
  `voice` gate is the first. A gate is the part of a method that a plugin supplies.
- **Factor table:** one entry for each factor, with the functions that the engine calls in place
  of a `switch` on the method.

A method maps to one factor and at most one gate:

| Method | Factor | Gate |
| --- | --- | --- |
| passkey | `webauthn` | none (the platform prompt) |
| Email code | `email_code` | none |
| VoiceID | `device_key` | `voice` |

## Design

### 1. Who is trusted

| Party | Trusted for | Not trusted for |
| --- | --- | --- |
| Wallet core | The device key, the challenge, the assertion, the factor secret, the session | — |
| A gate (Wallet origin) | The answer `passed` or `cancelled`, and what it draws on its surface | Keys, challenges, other wallets |
| The server | The factor check, the session | — |

- **A gate is in the trusted base.** It runs in the Wallet origin, so it can do what core can
  do (F5, R2 of Refactor 232). The contract of Section 4 is a rule for its author, not a wall.
- **For now, a gate is a chunk of `@seams/wallet`** (D1). One build has both sides. There is no
  host API version and no host path.
- **For a later release with gates from other parties:** the rule "code in the Wallet origin
  comes only from the Wallet operator" stays. An open-source gate enters the operator's build
  after review. It does not load from the app or from a URL. So this plan makes the contract
  small enough to review: no key, no challenge, no network, a store scoped to one wallet method.
  A plan for that release must also decide how a gate is isolated (for example a worker with no
  DOM, or a separate origin) and how the operator pins its version.

### 2. The phrase card in core (item 3)

- Move the adapter of F7 into `core/transactionFeatures/approver/phraseCard.ts`. It imports
  `openPhraseCard` of `@seams/voice-capture/card` as a dynamic import.
- Move the capture settings of F8 into core. Core calls `configureVoiceCapture` once, with the
  same values. The asset folder stays `/sdk/voiceid/` in this plan, because the host already
  serves the speech files there. A later plan can rename it.
- `speakToSign.ts` calls the core adapter. It does not load the VoiceID plugin.
- Remove `openPhrase` from `WalletAuthMethodHostPlugin`, from `isHostPlugin` and from
  `voiceid/src/host.ts`. Move `AuthMethodPhraseRequest`, `AuthMethodPhraseSurface` and the
  `Phrase...` view types to `core/transactionFeatures/` and rename them `Phrase...`.
- The hand-over of the enrollment recordings (`keepRecordings`) stays. It is an optional input
  of the VoiceID activation, and Speak-to-Sign still uses it.

### 3. One app API for methods (item 4)

```ts
defineSeamsConfig({
  authMethods: [passkey(), emailCode(), voiceId({ transcriptionModel: 'citrinet' })],
  approvals: [spoken({ network: 'testnet' })],
});

await seams.auth.methods.list({ walletId });
// [{ id, method: 'passkey' | 'email_code' | 'voiceid', status: 'enabled' | 'disabled' }]
await seams.auth.methods.add({ walletId, method: 'voiceid' });
await seams.auth.methods.add({ walletId, method: 'passkey', rpId });
await seams.auth.methods.add({ walletId, method: 'email_code', emailAddress });
await seams.auth.methods.setEnabled({ walletId, id, enabled: false });
await seams.auth.methods.remove({ walletId, id });
await seams.auth.unlock({ walletId, method: 'voiceid', purpose: 'unlock' });
```

- `passkey()`, `emailCode()` and `voiceId()` are exports of `@seams/wallet`. They are data only
  and load no code. `voiceId()` moves from `@seams/voiceid` to `@seams/wallet`.
- One parser reads `authMethods` and `approvals`. Today `parseWalletAuthMethodPlugins` and
  `parseWalletApprovalPlugins` repeat the same checks (exact keys, a known kind, no duplicate).
- Each call returns a result with a `kind`: `done`, `cancelled` or `unavailable`, and a
  `reason` for `unavailable`. A refusal does not throw. This is the shape of the `spoken` calls.
- `methods.add` takes a union on `method`, so each method keeps its own fields.
- `methods.list` is new. It reads the wallet's method records and their availability.
- The Email flow in which the app draws its own code field stays as two calls:
  `auth.requestEmailCode` and `auth.unlockWithEmailCode`. They are the "app draws the UI" form.
- The method names of the app API are `passkey`, `email_code` and `voiceid`. They are the
  method, not the factor. The app never sees a factor.
- In Slice 2 the new calls are a layer over the calls of F12. Slice 6 removes the old calls.

### 4. The factor table and the gate contract (item 2)

**The gate contract:**

```ts
interface LocalGate {
  /** Records what the gate needs, such as a voice template, in the store of this method. */
  enroll(input: {
    surface: GateSurface;
    store: GateStore;
    signal: AbortSignal;
  }): Promise<'enrolled' | 'cancelled'>;
  /** Asks the owner to pass the gate. It returns only an answer. */
  check(input: {
    surface: GateSurface;
    store: GateStore;
    purpose: 'unlock' | 'step_up' | 'operation';
    signal: AbortSignal;
  }): Promise<'passed' | 'cancelled'>;
}
```

- `GateStore` is a key-value store that core scopes to one wallet method. A gate cannot read
  the store of another method or of another wallet.
- `GateSurface` is the Wallet's card frame: the theme, the controls and the size reports.
- A failed check (a wrong voice) does not end `check`. The gate shows it and lets the owner try
  again. `check` ends with `passed`, or with `cancelled` when the owner closes the card.
- **Core does the rest of the `device_key` factor**: it creates the device key at activation,
  gets the challenge, signs it after `passed`, opens the factor secret, sends the assertion and
  installs the session. Today the plugin does these steps through `@seams/wallet/voiceid-host`
  (F4). After this slice the plugin calls none of them.
- `unlock`, `activate` and `confirmOperation` of today become `check` with a purpose, and
  `enroll`. The three `VoiceId...Preparation` types go away from the contract.
- The challenge has an end time. Core gets it after `passed`, not before, so a slow owner does
  not see an expired challenge. Core checks the end time before it signs.

**The factor table:**

```ts
type FactorEntry<Binding> = {
  parseBinding(record: unknown): Binding;            // { walletAuthMethodId, deviceKeyId } ...
  bindingKey(binding: Binding): string;              // the stable string of the binding
  sameBinding(a: Binding, b: Binding): boolean;
  stepUp: StepUpRunner;                              // Section 5
};

const FACTORS = { webauthn: ..., email_code: ..., device_key: ... } as const;
const METHOD_FACTOR = { passkey: 'webauthn', email_otp: 'email_code', voiceid: 'device_key' } as const;
```

- The table lives in `core/authMethods/factors/`: one file for each factor and one `index.ts`.
- **The stored values do not change.** A lane, a session record and a method record keep
  `kind: 'voiceid'`. The engine reads the factor with `METHOD_FACTOR[kind]` and then calls the
  table. So no stored record and no server value changes in this plan.
- Slice 4 moves the identity arms of F10 (parse, build, compare, key string) to the table.
  These are about two thirds of the arms in `core/signingEngine/session`.
- The custody and export arms (`ed25519YaoExportFlow.ts`, `ecdsaExportFlow.ts`) stay. They
  select different key material. They are not in scope.

### 5. Step-up from the factor table (item 5)

- `StepUpMethodRunners` becomes a map from factor to runner. Each runner has `prepare` and
  `complete`. The `device_key` runner runs the gate `check` with `step_up`, then core signs a
  fresh assertion and returns the new session.
- `selectStepUpMethod` reads the runner of the lane's factor. A missing runner gives one error,
  `unsupported_step_up_method`.
- Remove `VoiceIdStepUpRequiredError`, `isVoiceIdStepUpRequired` and the catch and retry in
  `BrowserSigningSurface.ts`. The step-up of a `device_key` lane is a normal step-up in the
  same call.
- `afterVoiceIdStepUp` goes away. A fresh step-up by the session's own factor meets
  `require_fresh_same_method`, for each factor, in one rule in `requireStepUpAuth.ts`.
- The modal holds of `signNear.ts` and `signEvmFamily.ts` for the error go away. The step-up
  surface opens in the same modal, as for a passkey.
- The deferred runners (`authenticator_otp`, `magic_link`, `password`) are not factors today.
  Remove them from the type. A later plan adds a factor when it builds one.

### 6. Where a method name may appear

The rule, after Slice 5:

| Literal | Allowed in |
| --- | --- |
| `'passkey'`, `'email_otp'`, `'voiceid'` (method) | the descriptors, `METHOD_FACTOR`, the stored-record parsers, the labels of the UI, the app API types |
| `'webauthn'`, `'email_code'`, `'device_key'` (factor) | `core/authMethods/factors/` |
| `'voice'` (gate) | the gate registry and the gate chunk |

- **A ratchet test** (Slice 0) counts the files that name each literal on the client. It fails
  if a count grows. Each slice lowers the counts in the test file.
- The server, the custody flows and the D1 store are outside the rule in this plan. They keep
  their arms.
- **The target for the client**, after Slice 5: a gate name in about four files, and a factor
  name only in its folder. The method names stay in the stored-record parsers and the UI.

### 7. What does not change

- The server, its routes and its checks (F6).
- The stored records: IndexedDB, D1 and the session records keep their `kind` values.
- The signed domain strings, such as `seams:wallet-session:voiceid-device:v1` and
  `seams-voiceid-browser-factor-v1`. A change breaks every enrolled device.
- The custody flows, the export flows and the recovery flows.
- The Speak-to-Sign verifier, its verdict and its enrollment.
- The host path `/sdk/voiceid/` for the speech model files.

### 8. Invariants that each slice keeps

| # | Invariant | Test |
| --- | --- | --- |
| 1 | A gate never holds a private key, a wrapping key or a factor secret | Type test: no gate input has a `CryptoKey` or a `Uint8Array`. Unit test: the gate module imports nothing from `core/authMethods/voiceId/deviceStore` |
| 2 | Core signs a challenge only after `check` returns `passed` for that challenge's purpose | A gate that returns `cancelled` gives no assertion and no request to the server |
| 3 | A gate store of one wallet method cannot read another | Two methods on one device: each store reads only its own keys |
| 4 | The factor secret is set to zero when the session installation settles | The unit test of `installSession.ts` of today, for the `device_key` runner |
| 5 | A step-up by a `device_key` lane gives a fresh assertion of the same device key | A step-up with another method's key is refused by the server (existing e2e) |
| 6 | A method that a wallet already has unlocks, also if the app does not list it (D2) | Config with `[passkey()]` and a wallet with VoiceID: `auth.unlock({ method: 'voiceid' })` works, `methods.add({ method: 'voiceid' })` gives `unavailable` |
| 7 | `spoken` works with no VoiceID descriptor | e2e: a passkey wallet with `approvals: [spoken()]` signs a transfer |
| 8 | No stored record changes its shape | The IndexedDB and D1 fixtures of 0.68 read with no migration |

## Slices

Each slice ships alone and leaves the tests green. Slices 1 to 5 add no breaking change. Slice 6
is the breaking release (D3).

- **Slice 0. Inventory and ratchet.** Sort every client arm of the three methods into three
  groups: identity (parse, build, compare), step-up, and custody. Record the list at the end of
  this document. Add the ratchet test of Section 6 with the counts of today. No code change.
- **Slice 1. The phrase card in core** (Section 2). Low risk. Tests: invariant 7, the card
  tests of the approver move with no change to their cases, and the VoiceID plugin builds with
  no `openPhrase`. The hosted Wallet and `@seams/voiceid` ship together, because
  `isHostPlugin` changes.
- **Slice 2. The app API for methods** (Section 3), as a layer over the calls of today. Low
  risk. Tests: invariant 6, one test for each result `kind` of each call, and the parser
  refuses a duplicate or an unknown descriptor in `authMethods` and `approvals`.
- **Slice 3. The gate contract** (Section 4, the gate part). Medium risk. The VoiceID flow moves
  into `core/authMethods/gates/voice/` as a chunk. Core takes over the device key steps of F4.
  Remove `@seams/wallet/voiceid-host`, the host API version and `/sdk/voiceid/host.js`.
  `@seams/voiceid` keeps only the files that the host serves (the speech model). Tests:
  invariants 1 to 4, and the VoiceID unlock, step-up and export e2e tests with no change to
  their cases.
- **Slice 4. The factor table on the client** (Section 4, the table part). Medium risk. Move
  the identity arms of Slice 0 to the table. Tests: invariant 8, the existing lane and session
  tests with no change to their cases, and the ratchet counts go down.
- **Slice 5. Step-up from the table** (Section 5). Medium risk. Tests: invariant 5, a step-up
  for each factor in one call with no retry, and `require_fresh_same_method` for each factor.
- **Slice 6. Remove the old names** (D3). Breaking. Remove the old calls of F12 and the
  `voiceId()` export of `@seams/voiceid`. Update the docs (EN and JA), the README, the demo and
  the example in speak-to-sign, and the apps in seams-monorepo. A breaking release after 0.70.0.

## Not in this plan

Each needs its own plan.

- The factor table on the server, and the D1 arms (F11).
- A change to the stored `kind` values, from method to factor.
- The custody, export and recovery arms.
- Gates from other parties: the review process, the isolation and the version pin (Section 1).
- A `verdict` factor: VoiceID unlock by a TEE verdict, with a pinned key. It would let one
  enrollment serve unlock and Speak-to-Sign.
- A new name for the asset folder `/sdk/voiceid/`.

## Inventory (Slice 0)

Not done yet.
