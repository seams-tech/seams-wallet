# Refactor 233: Auth methods by factor and gate

Status: 2026-11-28. Slice 0 (the inventory and the ratchet test) and Slice 1 (the phrase card
in core) are built on `dev`, not released. They are the only slices that this plan builds.
Slices 2 to 6 are not built on the old code:
[Refactor 251](refactor-251-auth-wallet-checkout-modules.md) builds their design as new code,
and the "Slices" section says where. The owner decided D1 to D4 on 2026-11-12.

What is left in this plan:

- **Nothing to build.** The owner decided on 2026-11-28 to keep the rule of 0.77.0 (F13): a
  wallet with no VoiceID gets no spoken approval. Invariant 7 is final in its second form.
- **Sections 3 to 5** stay as the design that Refactor 251 reads. Delete this plan when
  Refactor 251 has built or replaced them (its Slice 8), with the ratchet test.

History: the plan is from 2026-11-12. The owner deferred it until after the NEAR hackathon and
asked for it on 2026-11-28. The facts were checked against the code on 2026-11-28, after release
0.77.0 renamed the packages (`@seams/wallet` is `@seams/mpc-wallet` in `packages/mpc-wallet`,
`@seams/voiceid` is the internal `packages/voiceid` that `@seams/host` ships). Paths without a
package are in `packages/mpc-wallet/src`.

Changed (owner, 2026-11-18): [Refactor 251](refactor-251-auth-wallet-checkout-modules.md) writes
a new auth library in `packages/auth` instead of changing the old wallet code. Sections 3 to 5 of
this plan become the design of that new auth core, so they are not built on the old code.
Section 2 (the phrase card in core) is a wallet change and stays in this plan.

The owner's problem (2026-11-12): the method names (`passkey`, `email_otp`, `voiceid`) are in
too many places. `case 'passkey'` has 154 arms, `case 'email_otp'` has 161 arms and
`case 'voiceid'` has 77 arms. On 2026-11-28 the three counts are the same, in 110 files. The owner wants the configuration of a method in a
much smaller number of files. The app API for methods also has three shapes for the same jobs.

This plan follows [Refactor 232](https://github.com/seams-tech/seams-wallet/blob/110a67a38/docs/refactor-232-wallet-plugins-by-evidence.md). Refactor 232
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
- **The Speak-to-Sign card no longer needs the VoiceID plugin** (built in Slice 1). Core opens
  the phrase card of `@seams/voice-capture/card` itself. "A wallet with only a passkey can use
  `spoken`" is not built: the owner kept the rule of 0.77.0 (F13).
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

  Changed by Release A (0.77.0): the packed-package check
  (`tests/scripts/check-packed-wallet-boundaries.mjs`) refuses `@seams/voice-capture` and
  `onnxruntime-web` as a dependency of `@seams/mpc-wallet`, and refuses the model engine in its
  files. So Slice 1 makes `@seams/voice-capture` a build-time dependency (`devDependencies`).
  The hosted Wallet bundle holds the card. An application that installs `@seams/mpc-wallet`
  installs no capture package and no ONNX runtime.

## Facts this plan builds on

- **F1. The configuration is not symmetric.** `parseWalletAuthMethodPlugins` accepts only
  `{ kind: 'voiceid', transcriptionModel? }` (`core/authMethods/plugins.ts`). Passkey and Email
  OTP have no descriptor. They are always on. Holds on 2026-11-28.
- **F2. The plugin contract names VoiceID.** `WalletAuthMethodHostPlugin` has `unlock`,
  `activate`, `confirmOperation` and `openPhrase`. Their inputs use `VoiceIdUnlockPreparation`,
  `VoiceIdActivationPreparation` and `VoiceIdOperationProof` (`core/authMethods/hostPlugin.ts`,
  189 lines on 2026-11-28). No second method can implement it. Slice 1 removes `openPhrase`.
- **F3. The loader.** `loadWalletAuthMethodHostPlugin` imports `/sdk/voiceid/host.js` and
  checks `hostApiVersion === 11` (`core/authMethods/hostRegistry.ts`). It has four callers:
  `createSessionCommands.ts` (two), `createRegistrationCommands.ts` and `speakToSignPorts.ts`.
  Holds on 2026-11-28. The test fixture `tests/fixtures/ui/AuthMethodPluginProbe.ts` is a fifth.
- **F4. The plugin reaches into core.** The bridge is now the path `@seams/mpc-wallet/voiceid`
  (`voiceid.ts`, which exports `voiceid-host.ts` and the `voiceIdAuthMethod` descriptor). On
  2026-11-28 `voiceid-host.ts` exports 67 names, 35 of them values: the enrollment store, the
  device store (`createBrowserVoiceDevice`, `readBrowserVoiceDevice`, `openBrowserVoiceFactor`),
  the challenge bytes, the microphone preference and the card chrome. The Wallet host serves it
  as `/sdk/voiceid-host.js`, and the plugin imports it with the Wallet's version in the URL.
- **F5. The gate is not cryptographic.** The device record holds a non-extractable Ed25519 key
  and a non-extractable AES-GCM key that wraps a random 32-byte factor secret
  (`core/authMethods/voiceId/deviceStore.ts`). The voice template is not in the wrap. The
  plugin matches the voice, then signs with the device key, then opens the factor
  (`packages/voiceid/src/capture/deviceBridge.ts`, `captureVoiceIdUnlock`). So code in the Wallet origin
  can use the key with no voice. A gate that returns `passed` has the same strength as today.
- **F6. The server checks a device key.** It verifies an Ed25519 assertion over
  `seams:wallet-session:voiceid-device:v1`
  (`packages/mpc-wallet-server/src/authorization/voiceIdDeviceProof.ts`; the domain string is in
  `packages/shared-ts/src/authorization/voiceIdDeviceAssertion.ts`). It never sees a voice.
- **F7. The phrase card goes through VoiceID.** `openPhrase` of the VoiceID plugin is a 63-line
  adapter over `openPhraseCard` of `@seams/voice-capture/card`
  (`packages/voiceid/src/capture/phrase.ts`). It adds the Wallet's theme classes, the card
  controls, Minimize and the size reports. Speak-to-Sign calls it through `openPhrase` of
  `SeamsWeb/walletIframe/host/handlers/speakToSign.ts`. So `spoken` needs VoiceID on the host.
  Holds on 2026-11-28. The installed `@seams/voice-capture` 0.72.0 has every field that the
  adapter uses, so the move needs no new release of that package.
- **F8. The capture settings come from VoiceID.** `configureVoiceIdCapture` gives
  `@seams/voice-capture` the asset folder `/sdk/voiceid/`, the microphone preference and the
  style nonce (`packages/voiceid/src/capture/configure.ts`). Holds on 2026-11-28. The settings
  are state of one copy of `@seams/voice-capture`. The VoiceID plugin bundles its own copy, so
  a card in core needs the settings on the Wallet's copy too (Section 2).
- **F9. Step-up uses an error as a branch.** `selectStepUpMethod` has runners for `passkey` and
  `emailOtp` (`stepUpConfirmation/methodRunners.ts`). For `voiceid` it throws
  `VoiceIdStepUpRequiredError` (`methodSelection.ts`, `requireNearStepUpAuth.ts`). Then
  `BrowserSigningSurface.ts` (line 3560 on 2026-11-28) catches it, runs a VoiceID unlock with
  `step_up`, and calls again with `afterVoiceIdStepUp`. `signNear.ts` and `signEvmFamily.ts`
  hold the modal for this error. Holds on 2026-11-28. The error is thrown in 10 places:
  `BrowserSigningSurface.ts` (6), `signEvmFamily/authPlanning.ts`, `requireNearStepUpAuth.ts`,
  `signNear.ts` and `methodSelection.ts`.
- **F10. Most VoiceID arms in the engine compare identities.** A sample of 15 arms in
  `core/signingEngine`: 10 parse, build or compare `{ walletAuthMethodId, deviceKeyId }`
  (`exactSigningLaneIdentity.ts`, `signingLaneAuthBinding.ts`, `clientSessionPersistence.ts`,
  `ed25519SealedSessionRuntime.ts`, `availableSigningLanes.ts`, `capabilityReaderCore.ts`,
  `yaoPublicCapabilityReferences.ts`). Two arms select step-up. Three arms select a custody or
  export flow (`ed25519YaoExportFlow.ts`, `ecdsaExportFlow.ts`).
- **F11. Arms by area.** The client has the most arms in `core/signingEngine/session` (20, 26
  and 13 for the three methods), `core/signingEngine/flows`, `core/indexedDB/seamsWalletDB` and
  `react/components/AccountMenuButton`. The server has most in `router/cloudflare/d1`. The
  inventory of Slice 0 has the counts of 2026-11-28 for each area of the client.
- **F12. The app API for methods** (`SeamsWeb/publicApi/types.ts`): `auth.unlock`,
  `auth.unlockWithAuthMethod({ method })`, `auth.unlockWithEmailCode`, `auth.hasPasskey`,
  `registration.addPasskey`, `registration.addEmail`, `registration.activateAuthMethod`,
  `registration.getAuthMethodAvailability`, `registration.setAuthMethodEnabled`,
  `registration.removeAuthMethod`. No call lists the methods of a wallet. Holds on 2026-11-28,
  and `auth.requestEmailCode` exists.
- **F13. Since 0.77.0 a spoken request needs VoiceID on the wallet** (found on 2026-11-28).
  [Refactor 254](refactor-254-speak-to-sign-verifier-backends.md) made the VoiceID switch of
  **Authentication methods** the setting that turns spoken approval off (the owner, 2026-11-27:
  no new screen). `prepareFlow` of `speakToSign.ts` answers `voiceid_unavailable` when VoiceID
  is off or not set up, and the public docs say so
  (`apps/docs/src/concepts/auth-methods/speak-to-sign.md`, "Turn spoken approval off"). This rule
  is later than this plan. It conflicts with "A wallet with only a passkey can use `spoken`" of
  the Result and with invariant 7. Section 2 says what Slice 1 does about it. The owner decided
  on 2026-11-28: the rule of 0.77.0 stays.

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

Built in Slice 1 on 2026-11-28. The text says what the code does.

**The rule of 0.77.0 stays (F13).** A spoken request still needs VoiceID on for the wallet.
Slice 1 moves the code: the card needs no VoiceID plugin on the host and no VoiceID descriptor
in the app. It does not open `spoken` to a wallet that has no VoiceID. Such a wallet has no
setting that turns spoken approval off, and no path that deletes its voice template at the
verifier, because both are parts of the VoiceID method. The owner kept this rule on
2026-11-28. So invariant 7 is tested in the form "a spoken request loads no VoiceID plugin and
needs no VoiceID descriptor".

- **The adapter** is `core/transactionFeatures/approver/phraseCard.ts`. It opens
  `openPhraseCard` of `@seams/voice-capture/card` in the Wallet's frame: the theme classes, the
  card controls, Minimize and the size reports. `speakToSignPorts.ts` loads it with a dynamic
  import, so the card and the capture package are one chunk of the hosted Wallet
  (`sdk/phraseCard-*.js`, 147 kB, 43 kB gzip) that loads on the first spoken card.
- **The types** are in `core/transactionFeatures/phraseSurface.ts`: `PhraseRequest`,
  `PhraseSurface`, `PhraseRecording` and the view types. They are written in core, not imported
  from the capture package, so the Wallet's declarations name no type of a package that an
  application does not install.
- **The capture settings** are in core: `walletVoiceCaptureConfig()` of
  `core/authMethods/voiceId/captureConfig.ts`, with the same values as before. The settings are
  the state of one copy of `@seams/voice-capture`. The Wallet's chunk and the VoiceID plugin
  each bundle a copy, so each copy gets the settings: the adapter on its first card, and the
  plugin through `@seams/mpc-wallet/voiceid` (`packages/voiceid/src/capture/configure.ts`).
  One copy for both waits for the gate chunk of Slice 3, which Refactor 251 replaces.
- **The model engine stays in the asset folder.** The Wallet's bundle holds no ONNX Runtime Web
  (D4, the packed-package check). The VoiceID build writes the engine at a fixed name,
  `/sdk/voiceid/ort.wasm.bundle.min.js`, and the Wallet's card and the plugin's chunks both
  import that file. The asset folder stays `/sdk/voiceid/`, so a Wallet host still composes the
  VoiceID assets of `@seams/host` for `spoken`. A later plan can rename the folder.
- **The plugin contract.** `WalletAuthMethodHostPlugin`, `isHostPlugin` and
  `packages/voiceid/src/host.ts` have no `openPhrase`, and `packages/voiceid/src/capture/phrase.ts`
  is deleted. The VoiceID host API is version 12. `@seams/mpc-wallet/voiceid` lost 13 names (the
  phrase types, the card chrome functions and the two microphone functions) and got
  `walletVoiceCaptureConfig`.
- **The hand-over of the enrollment recordings** (`keepRecordings`) stays. It is an optional
  input of the VoiceID activation, and Speak-to-Sign still uses it. An enrollment of a wallet
  with no VoiceID still loads the VoiceID plugin to turn VoiceID on first.

**Measured on 2026-11-28:**

| Check | Result |
| --- | --- |
| Speak-to-Sign unit tests, the ratchet and the whole unit suite (`pnpm -C tests test:wallet-unit`, Chromium) | 544 passed |
| The approver's card tests (`speakToSignApproverFlow`, `speakToSignApproverEnroll`) | Passed with no change to a case or a file |
| Invariant 7, unit: a spoken transfer of an app with no VoiceID descriptor (`speakToSignIframeRoute.unit.test.ts`) | Passed; the VoiceID loader is not called |
| Invariant 7, browser: the real adapter opens the card from its own chunk and asks no `/sdk/voiceid/host.js` (`speak-to-sign-plugin.contract.test.ts`) | Passed |
| The built VoiceID plugin loads through the Wallet's loader (`auth-method-plugin.contract.test.ts`) | 2 passed |
| The VoiceID plugin builds with no `openPhrase` | Yes; its JavaScript went from 280,236 to 258,736 bytes, and each of its 30 imports from the bridge is an export of the built bridge |
| VoiceID capture in a browser (`voiceid-loading`, `voiceid-phrase-tolerance`, `voiceid-microphone`) and `wallet-steps` | Passed in Chromium and WebKit |
| The packed-package check for `@seams/mpc-wallet` | Passed: no capture package, no ONNX runtime, no engine file |
| Type checks: the wallet, the two test projects, and the plugin's source against the wallet's source | Passed |

**Not measured:**

- The VoiceID journeys on the local stack (activation, unlock, key export) were not run. The
  shared checkout held another session's unfinished server changes, and three of these cases
  already failed before this slice.
- No spoken request was made against a real verifier. The staging payment is the owner's.
- Firefox has no local build here; CI runs it.

**For the release:** the hosted Wallet and the VoiceID assets of `@seams/host` must ship
together, with a new version. The plugin imports the bridge `/sdk/voiceid-host.js` by the
Wallet's version, and the new plugin needs the new bridge.

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
| 7 | `spoken` works with no VoiceID descriptor | A spoken request of an app with `approvals: [spoken()]` and no VoiceID descriptor opens the card and signs, and loads no VoiceID plugin. The first form, "a passkey wallet signs a transfer", is dropped: the owner kept the rule of 0.77.0 (F13) |
| 8 | No stored record changes its shape | The IndexedDB and D1 fixtures of 0.68 read with no migration |

## Slices

This plan builds Slices 0 and 1. Slices 2 to 6 are not built on the old wallet code (the owner,
2026-11-18): [Refactor 251](refactor-251-auth-wallet-checkout-modules.md) builds their design as
new code. Each of them names the slice of Refactor 251 that covers it, and what Refactor 251
does not name. "Row" is a row of the audit table in the
[Slice 0 inventory of Refactor 251](refactor-251-slice-0-inventory.md).

- **Slice 0. Inventory and ratchet.** Sort every client arm of the three methods into three
  groups: identity (parse, build, compare), step-up, and custody. Record the list at the end of
  this document. Add the ratchet test of Section 6 with the counts of today. No code change.

  Done on 2026-11-28. The list is at the end of this document, with a fourth group for the arms
  that fit none of the three. The ratchet test is
  `tests/unit/authMethodLiteralRatchet.unit.test.ts`.
- **Slice 1. The phrase card in core** (Section 2). Low risk. Tests: invariant 7, the card
  tests of the approver move with no change to their cases, and the VoiceID plugin builds with
  no `openPhrase`. The hosted Wallet and the VoiceID host plugin of `@seams/host` ship
  together, because `isHostPlugin` changes.

  Built on 2026-11-28. Section 2 says what the code does, what was measured and what was not.
  Invariant 7 holds in its second form, which is final (F13).
- **Slice 2. The app API for methods** (Section 3). Not built here.
  - **Refactor 251 covers it** in its Slice 6 (the auth client: `passkey()`, `emailCode()` and
    `voiceId()` in `@seams/auth/client`, and `auth.methods.list`, `add` and `remove`) and its
    Slice 9 (Release B, the new API with no alias).
  - **Refactor 251 does not name:**
    - `methods.setEnabled`. Row 3.5 keeps the enabled flag, but the new API has no call for it.
    - The result shape: `done`, `cancelled` or `unavailable` with a `reason`, and no throw for
      a refusal.
    - D2: the default `[passkey(), emailCode()]`, and the rule that a method that a wallet
      already has always unlocks (invariant 6).
    - The Email flow in which the app draws its own code field (`requestEmailCode` and
      `unlockWithEmailCode`).
    - One parser for `authMethods` and `approvals`. In Refactor 251 the two lists belong to two
      packages, so this item probably goes away.
- **Slice 3. The gate contract** (Section 4, the gate part). Not built here.
  - **Refactor 251 covers it** in its Slice 6 (the plugin contract, `prove` and the
    `device_key` proof after the `voice` gate) and its Slice 8 (the cutover: row 1.8 moves
    VoiceID to auth, and `@seams/mpc-wallet/voiceid` goes away).
  - **Refactor 251 differs:** VoiceID stays a host plugin that the account origin loads from a
    fixed path (its Section 5). D1 of this plan made the gate a chunk of the Wallet with no host
    path and no host API version.
  - **Refactor 251 does not name:**
    - Who holds the device key. This plan says: core holds the key, signs and opens the factor
      secret, and the gate only answers `passed` (invariants 1 and 2). Rows 1.8 and 3.6 give
      the device record to auth, but they do not say that the plugin loses the key.
    - The gate store that core scopes to one wallet method (invariant 3).
    - The challenge that core gets after `passed`, not before.
- **Slice 4. The factor table on the client** (Section 4, the table part). Not built here.
  - **Refactor 251 covers it** for the method records in its Slice 6 (the factor table of the
    new auth core, its Fact F4, row 3.2) and for the wallet's account layer in its Slices 7 and
    8 (rows 3.9 to 3.11).
  - **Refactor 251 does not cover:** the identity arms of the signing engine. The inventory has
    67 identity arms in `core/signingEngine` (lanes, sessions, capabilities and their stored
    records). D13 of Refactor 251 does not rewrite the signing engine, and its audit cleans only
    the code that it touches. These arms stay unless a row of the audit takes them.
  - **Also not named:** the ratchet and the rule of Section 6 (where a method name can appear).
    Refactor 251 uses line budgets and the bloat report. The ratchet test of Slice 0 stays until
    the cutover lowers its counts. New wallet code of Refactor 251 in `packages/mpc-wallet/src`
    that names a method raises a count, and its author must then decide.
- **Slice 5. Step-up from the table** (Section 5). Not built here.
  - **Refactor 251 covers it** in its Slices 6 and 7 (a step-up is `auth.prove` for the audience
    `wallet`, with the operation in the challenge) and its Slice 8 (rows 4.6 and 6.17).
  - **Refactor 251 does not name:** the removal of `VoiceIdStepUpRequiredError`, of the catch
    and retry in `BrowserSigningSurface.ts`, of `afterVoiceIdStepUp` and of the modal holds in
    `signNear.ts` and `signEvmFamily.ts`; the one rule for `require_fresh_same_method`; and the
    removal of the deferred runners (`authenticator_otp`, `magic_link`, `password`). The
    inventory has 34 step-up arms, 24 of them in `core/signingEngine`. Row 4.6 names
    `stepUpConfirmation/*`, but not the signing flows that throw and catch the error.
- **Slice 6. Remove the old names** (D3). Not built here.
  - **Refactor 251 covers it** in its Slice 9 (Release B: `SeamsWeb` goes away with no alias, so
    every old call of F12 goes with it, and `seams-monorepo` changes in one commit). Its package
    table moves `voiceId()` to `@seams/auth/client`.
  - **Refactor 251 does not name:** the demo and the example in the speak-to-sign repository.

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

Counted on 2026-11-28 at `8df663796`.

**What is counted.** An arm is one `case 'passkey'`, `case 'email_otp'` or `case 'voiceid'`.
The client is `packages/mpc-wallet/src` and `packages/voiceid/src`. The client has 272 arms in
134 `switch` statements of 72 files. `packages/voiceid/src` names no method.

**The groups.**

- **Identity:** the arm parses, builds, serializes, compares or names a method, its binding or
  its factor reference. It reads no key material. These arms are the work of the factor table
  (Section 4).
- **Step-up:** the arm selects, builds or checks the fresh proof of one operation (Section 5).
- **Custody:** the arm selects or handles key material: registration, unlock, envelopes, sealed
  sessions, export, recovery and device linking. These arms stay (Section 4).
- **Other:** labels and icons, the rules of the auth menu, loaders and timing. The plan had no
  group for them. They are the "labels of the UI" of Section 6.

The group of a `switch` is a reading of its function, not a measurement. A `switch` that
compares two factor references inside a custody record is in "identity".

| Group | Switches | `passkey` | `email_otp` | `voiceid` | Arms |
| --- | --- | --- | --- | --- | --- |
| identity | 61 | 51 | 50 | 30 | 131 |
| step-up | 17 | 14 | 15 | 5 | 34 |
| custody | 35 | 24 | 27 | 6 | 57 |
| other | 21 | 18 | 17 | 15 | 50 |
| Total | 134 | 107 | 109 | 56 | 272 |

The same arms for each area:

| Area | identity | step-up | custody | other |
| --- | --- | --- | --- | --- |
| `SeamsWeb/assembly` | 0 | 0 | 3 | 0 |
| `SeamsWeb/operations` | 11 | 3 | 18 | 6 |
| `SeamsWeb/signingSurface` | 4 | 4 | 2 | 0 |
| `SeamsWeb/walletIframe` | 3 | 2 | 7 | 14 |
| `core/authMethods` | 0 | 0 | 0 | 1 |
| `core/indexedDB` | 32 | 0 | 0 | 9 |
| `core/rpcClients` | 11 | 1 | 7 | 0 |
| `core/signingEngine` | 67 | 24 | 19 | 0 |
| `react/components` | 3 | 0 | 1 | 20 |

**Not sorted, only counted:**

- Comparisons with `===` or `!==` on the client: 317 for `passkey`, 258 for `email_otp` and
  90 for `voiceid`.
- `packages/shared-ts/src`, which the client and the server share: 11, 13 and 6 arms in 12 files.
  Most are in `utils/walletAuthMethodRecord.ts` (6), `utils/registrationIntent.ts` (4) and
  `passkey-custody/custodyEnvelope.ts` (3).
- The server (`packages/mpc-wallet-server/src`): 36, 39 and 15 arms. Not in scope.

**The ratchet test** is `tests/unit/authMethodLiteralRatchet.unit.test.ts`. For each method name
it counts the client files that name it and the `case` arms on it. It fails when a count is
above the recorded count. `pnpm -C tests test:wallet-unit` runs it, also in CI.

| Method name | Files that name it | `case` arms |
| --- | --- | --- |
| `passkey` | 191 | 107 |
| `email_otp` | 188 | 109 |
| `voiceid` | 70 | 56 |

The test counts only the method names. A factor name (`email_code`, `device_key`) and a gate
name are in no client file today, and `'webauthn'` is in 27 files for other meanings. Their
rule of Section 6 belongs to the new auth core.

P is `passkey`, E is `email_otp` and V is `voiceid` in the lists.

**Identity**

| File | Function | Arms |
| --- | --- | --- |
| `SeamsWeb/operations/auth/login/authority.ts` | `walletAuthMethodBindingFromRecord` | P E V |
| `SeamsWeb/operations/auth/login/unlockPlanning.ts` | `loginEd25519ExactProvisionAuthBinding` | P E |
| `SeamsWeb/operations/devices/deviceLinkingAuthorityInstallation.ts` | `localAuthorityProfileProjectionV1` | P E |
| `SeamsWeb/operations/devices/deviceLinkingEd25519ExportRoot.ts` | `replacementEnvelopeFactorMatchesTargetFactor` | E |
| `SeamsWeb/operations/recovery/walletRecoveryCommit.ts` | `sameWalletRecoveryCommittedProjectionV1` | P |
|  | `committedProjectionFromPromotion` | P |
| `SeamsWeb/operations/recovery/walletRecoveryJournal.ts` | `pendingRecordMatchesDurablePayload` | P |
| `SeamsWeb/signingSurface/BrowserSigningSurface.ts` | `requireEmailOtpNearEd25519MaterialIdentity` | V |
|  | `nearEd25519AuthBindingsEqual` | V |
|  | `assertNearEd25519YaoMaterialBoundaryAuth` | V |
|  | `resolveExactNearEd25519SigningKeyMaterial` | V |
| `SeamsWeb/walletIframe/shared/exactSessionState.ts` | `walletIdFromAuthBinding` | P E V |
| `core/indexedDB/linkedAuthoritySignerMaterial.ts` | `sameLinkedAuthorityMaterialTargetFactorV1` | P E |
| `core/indexedDB/seamsWalletDB/repositories.ts` | `exportRootEnvelopeMatchesAuthMethod` | P E V |
|  | `assertRegistrationFinalizeMatchesPending` | P E |
|  | `localWalletAuthMethodRecordsMatch` | P E |
|  | `localWalletAuthMethodRowsMatch` | P E |
|  | `walletAuthMethodIdentifier` | P E |
|  | `walletAuthMethodRowFromBinding` | P E |
|  | `walletAuthMethodV2StorageRow` | P E V |
|  | `localWalletAuthMethodProjectionV2` | P E V |
|  | `walletAuthorityLinkedMaterialTargetFactorsMatch` | P E |
|  | `walletCustodyEnvelopeFactorsMatch` | P E V |
|  | `walletAuthMethodRecordsMatch` | P E V |
|  | `walletAuthMethodPendingMatchesActive` | P E V |
| `core/rpcClients/relayer/walletRecoveryPrepare.ts` | `recoveryTargetsMatch` | P |
| `core/rpcClients/relayer/walletRegistration.ts` | `parseWalletRegistrationSetupAuthMethod` | P E |
|  | `parseRevokeWalletAuthMethodResponse` | P E V |
| `core/rpcClients/relayer/walletRegistrationTerminalResponse.ts` | `parseWalletRegistrationEd25519AuthorityScope` | E |
|  | `parseWalletRegistrationFinalizeAuthority` | P E |
|  | `parseWalletRegistrationFinalizeAuthorityBranch` | P E |
| `core/signingEngine/flows/recovery/ecdsaExportFlow.ts` | `activeWalletAuthorityEcdsaRuntimeIdentityMatches` | P E |
| `core/signingEngine/flows/signEvmFamily/signingFlowRuntime.ts` | `signerAuthMethodForWalletAuthority` | P E V |
| `core/signingEngine/session/availability/availableSigningLanes.ts` | `activeAuthorizationMatchesEd25519Lane` | P E V |
| `core/signingEngine/session/availability/readiness.ts` | `toLaneSource` | P E |
|  | `authMethodForSigningSessionLanes` | V |
|  | `selectedMethodMatchesRuntime` | P E |
| `core/signingEngine/session/identity/exactSigningLaneIdentity.ts` | `parseSigningLaneAuthBinding` | P E V |
|  | `canonicalAuthBinding` | P E V |
| `core/signingEngine/session/identity/signingLaneAuthBinding.ts` | `signingLaneAuthMethod` | V |
|  | `signingLaneAuthBindingKey` | V |
| `core/signingEngine/session/material/ecdsaSealedRuntime.ts` | `authMethodForEcdsaSealedSource` | E |
| `core/signingEngine/session/material/ecdsaSigningCapability.ts` | `capabilityAuthorityMatchesRuntime` | P E V |
|  | `selectedAuthMethodMatchesRuntime` | P E V |
|  | `exactEcdsaAuthBindingsMatch` | P E V |
| `core/signingEngine/session/persistence/clientSessionPersistence.ts` | `selectedAuthorityMatchesEd25519Lane` | P E V |
| `core/signingEngine/session/persistence/ecdsaRoleLocalRecords.ts` | `parseEcdsaRoleLocalAuthMethod` | P E |
|  | `authMethodsEqual` | P E |
|  | `readyRecordFromParts` | P E |
|  | `serializeAuthMethod` | P E |
|  | `ecdsaRoleLocalAuthMethodStorageKeyPart` | P E |
| `core/signingEngine/session/warmCapabilities/capabilityReaderCore.ts` | `signingLaneAuthBindingFromEcdsaRuntime` | P E V |
| `core/signingEngine/session/warmCapabilities/ed25519SealedSessionRuntime.ts` | `authBinding` | P E |
|  | `ed25519SealedRuntimeAuthorityRef` | P E |
|  | `authBindingsEqual` | P E V |
| `core/signingEngine/session/warmCapabilities/routerAbEd25519WalletSessionState.ts` | `authorizeRouterAbEd25519WalletSessionState` | P E V |
| `core/signingEngine/threshold/ecdsa/activation.ts` | `inferThresholdEcdsaBootstrapAuthMethod` | P E |
| `core/signingEngine/threshold/ed25519/yaoPublicCapabilityReferences.ts` | `parseSigningLaneAuth` | P E V |
|  | `parsePublicCapabilityLane` | P E V |
| `core/signingEngine/workerManager/workers/device-linking-key/ordinaryMaterialState.ts` | `sameOrdinaryTargetFactor` | P E |
| `react/components/AccountMenuButton/LinkedDevicesModal.tsx` | `assertRevokeSourceMethod` | P E V |

**Step-up**

| File | Function | Arms |
| --- | --- | --- |
| `SeamsWeb/operations/authMethods/addAuthMethodSourceClaim.ts` | `findAuthorityConfirmationMethod` | P E V |
| `SeamsWeb/signingSurface/BrowserSigningSurface.ts` | `operationStepUpProofMatchesSelectedWalletAuthMethod` | P E |
|  | `resolveExactNearEd25519YaoPreparedMaterial` | V |
|  | `resolveExactNearEd25519YaoSigningHydration` | V |
| `SeamsWeb/walletIframe/host/requestWalletMove.ts` | `collectProof` | P E |
| `core/rpcClients/relayer/walletRegistration.ts` | `addAuthMethodAuthBody` | E |
| `core/signingEngine/flows/recovery/stepUpAuthorization.ts` | `buildExportStepUpAuthorization` | P E |
| `core/signingEngine/flows/signEvmFamily/thresholdAdmission.ts` | `operationStepUpProof` | P E |
| `core/signingEngine/flows/signNear/implicitAccountFunding.ts` | `fundingAuthorityProvenance` | P E |
|  | `operationStepUpFundingProvenance` | P E |
| `core/signingEngine/flows/signNear/requireNearStepUpAuth.ts` | `signingAuthPlanForNearMaterialRequirement` | P E V |
| `core/signingEngine/flows/signNear/shared/ed25519YaoNormalSigning.ts` | `buildNearEd25519OperationStepUpProof` | P E |
|  | `resolveIssuedEd25519OperationStepUpAuthorization` | P E |
| `core/signingEngine/flows/signNear/shared/signingSessionAuthMode.ts` | `buildPlanningLane` | P E V |
| `core/signingEngine/flows/signNear/signDelegate.ts` | `nearPreparedStepUpEventAuthMethod` | P E |
| `core/signingEngine/threshold/ed25519/walletSession.ts` | `serializeEd25519OperationStepUpProof` | P E |
|  | `buildEd25519OperationStepUpMaterialRecoveryRequest` | P E |

**Custody**

| File | Function | Arms |
| --- | --- | --- |
| `SeamsWeb/assembly/browserSigningSurfaceAssembly.ts` | `isEd25519YaoPublicCapabilityActive` | P E V |
| `SeamsWeb/operations/auth/login/authority.ts` | `resolveLinkedDeviceNearUnlockSubject` | V |
| `SeamsWeb/operations/auth/login/signerWarmup.ts` | `run` | P E |
| `SeamsWeb/operations/devices/linkDeviceFlow.ts` | `waitForTargetCredentialActivation` | E |
| `SeamsWeb/operations/recovery/walletRecovery.ts` | `recoveryFinalizationOperation` | P |
| `SeamsWeb/operations/recovery/walletRecoveryRotation.ts` | `rotateWalletRecoveryCodes` | E |
| `SeamsWeb/operations/registration/pendingEcdsaRegistrationRecoveryUnlock.ts` | `unlockPendingEcdsaRegistration` | P E |
| `SeamsWeb/operations/registration/pendingRegistrationRecovery.ts` | `pendingNearProvisioningAuth` | P E |
| `SeamsWeb/operations/registration/registration.ts` | `registrationThreeRouteAuthorityPayload` | P E |
|  | `registrationEd25519LaneAuthorization` | P E |
|  | `buildDeferredRegistrationFinalizeAuthMaterial` | P E |
| `SeamsWeb/operations/registration/registrationTerminalCommit.ts` | `buildRegistrationPersistenceAuth` | P E |
| `SeamsWeb/signingSurface/BrowserSigningSurface.ts` | `isEd25519YaoPublicCapabilityActive` | V |
|  | `resolveExactNearEd25519SigningKeyMaterial` | V |
| `SeamsWeb/walletIframe/client/router.ts` | `hostedWalletRegistrationTransport` | P E |
| `SeamsWeb/walletIframe/host/handlers/near.ts` | `walletOriginRegistrationAuthMethod` | P E |
| `SeamsWeb/walletIframe/host/recovery-entrypoint.ts` | `targetFor` | P |
| `SeamsWeb/walletIframe/shared/recoveryAuthorization.ts` | `parseWalletRecoveryRequest` | P E |
| `core/rpcClients/relayer/walletRecoveryPrepare.ts` | `parseWalletRecoveryPrepareResponse` | P |
| `core/rpcClients/relayer/walletRegistration.ts` | `walletRegistrationRespondBody` | P E |
|  | `authorizeWalletRegistrationNearAdmission` | P E |
|  | `addAuthMethodAuthorityBody` | P E |
| `core/signingEngine/flows/recovery/ecdsaDerivationExport.ts` | `executeEcdsaDerivationExport` | P |
| `core/signingEngine/flows/recovery/ecdsaExportFlow.ts` | `normalizeIssuedEcdsaExportUnseal` | P E V |
| `core/signingEngine/flows/recovery/ed25519YaoExportFlow.ts` | `exportEd25519YaoKeyWithFreshAuthorization` | P E V |
| `core/signingEngine/flows/registration/accountLifecycle.ts` | `walletEcdsaRegistrationSignerSource` | P E |
|  | `prepareWalletEcdsaRegistrationPublicationWithMode` | P E |
| `core/signingEngine/session/availability/readiness.ts` | `clearLaneWarmSessionMaterial` | P E |
| `core/signingEngine/session/emailOtp/ecdsaBootstrapCommit.ts` | `signerDomainForThresholdEcdsaSource` | E |
| `core/signingEngine/session/persistence/sealedSessionRecords.ts` | `normalizeSealedEcdsaRestoreSource` | E |
|  | `normalizeEcdsaInactiveMaterialPublicRestore` | E |
|  | `buildEcdsaInactiveMaterialPublicRestore` | E |
| `core/signingEngine/session/sealedRecovery/recoveryRecord.ts` | `normalizeEcdsaRestoreSource` | E |
| `core/signingEngine/threshold/ed25519/yaoClient.ts` | `buildRouterAbEd25519YaoExportAdmissionBodyV1` | P |
| `react/components/ShowQRCode.tsx` | `targetFactorFromSelection` | E |

**Other**

| File | Function | Arms |
| --- | --- | --- |
| `SeamsWeb/operations/auth/login/localWallets.ts` | `recentUnlockAccountFromLinkedDeviceSelection` | V |
|  | `localLoginAuthMethod` | P E V |
| `SeamsWeb/operations/registration/registrationTiming.ts` | `buildRegistrationAuthTiming` | P E |
| `SeamsWeb/walletIframe/host/auth-menu/account-options.ts` | `localAuthMethodOption` | P E |
| `SeamsWeb/walletIframe/host/auth-menu/domain.ts` | `authMenuLoginAllowsPasskey` | P E V |
|  | `authMenuLoginAllowsEmailOtp` | P E V |
|  | `isAuthMenuActionReady` | P |
| `SeamsWeb/walletIframe/host/auth-menu/session.ts` | `presentedAuthMenuError` | P |
| `SeamsWeb/walletIframe/host/runtimeContext.ts` | `assertWalletAuthMethodCanSign` | P E V |
| `SeamsWeb/walletIframe/host/runtimeLoader.ts` | `loadRuntimeForKind` | E |
| `core/authMethods/hostRegistry.ts` | `loadWalletAuthMethodHostPlugin` | V |
| `core/indexedDB/seamsWalletDB/repositories.ts` | `unavailableWalletAuthMethodPresentation` | P E V |
|  | `parseWalletAuthMethodLocalPresentationV1` | P E V |
|  | `walletAuthMethodLocalPresentation` | P E V |
| `react/components/AccountMenuButton/AccountMenuMockScreens.tsx` | `methodLabel` | P E |
| `react/components/AccountMenuButton/AuthenticationMethodRow.tsx` | `methodIcon` | P E V |
| `react/components/AccountMenuButton/AuthenticationMethodsModal.tsx` | `methodView` | P E V |
|  | `selectedMethodView` | P E V |
|  | `methodTitle` | P E V |
|  | `methodDescription` | P E V |
| `react/components/AccountMenuButton/LinkedDevicesModal.tsx` | `credentialDescription` | P E V |
