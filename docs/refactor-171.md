# Simplify the public Wallet SDK API

Status: accepted naming direction, implementation plan, 2026-10-04.
No runtime changes, publication, or deployment are performed by this document.

## Objective

Make application calls easy to discover, well named, and complete. Applications
describe wallet operations; the SDK handles RPC fallback, credential challenges,
worker preparation, export selection, and synchronization internally.

- Use direct verbs and domain nouns. No public `maybe`, `optional`, `bestEffort`,
  `ifNeeded`, or implementation-specific names for ordinary operations.
- Represent absent data, pending work, cancellation, and recoverable failures in
  precise result/state types. Names must not conceal uncertainty or promise
  success where an operation can fail.
- Keep one public name per operation. Delete replaced methods and deprecated
  aliases with their consumers; add no compatibility wrappers or legacy flags.
- Preserve distinct operations and their authorization boundaries. A shorter name
  does not authorize combining different proofs, sessions, or signing protocols.
- Group session and authentication calls under `auth`, appearance/chain helpers
  under `config`, and chain operations under `near`, `evm`, and `tempo`. Keep
  connection lifecycle under `connection` and general event subscriptions under
  `events`. Expose no top-level instance methods. Do not add another facade or
  duplicate hook family.

## Relationship to R170 and R153

[R170](refactor-170.md) owns separating application/host execution, config and
state boundaries, targeted worker loading, and bundle/network acceptance. This
plan owns the complete public naming/export migration and consumer updates.
Use the [existing inventory](refactor-170-inventory.md) as the starting point.

The grouped auth/config API, unified lock, SDK-owned `near.accountExists`, and preference
`flush` were already accepted in R170. Implement each once: R170 establishes the
behavior/ownership; R171 verifies the final names and migrates all public callers.
Do not build temporary renamed wrappers around the mixed runtime or maintain two
implementations. Perform final API extraction with R170's composition cutover;
inventory and documentation preparation can start beforehand.

Coordinate session cleanup, durable presign invalidation, and refill fencing with
R153. Preserve its placement generation and exact session binding. Naming changes
must not reset or bypass those contracts.

## Target application calls

Examples show names and grouping; omitted arguments are not complete signatures.
Preserve existing supported options and defaults unless a behavior decision below
explicitly changes them. Public input parsers normalize raw inputs once, then
pass required identities and precise branch-specific types into core functions.

```ts
const config = defineSeamsConfig({ ... });
const seams = new SeamsWeb(config);

await seams.connection.connect();
seams.connection.getState();
const stopConnection = seams.connection.onChange(listener);
const stopEvents = seams.events.subscribe(eventListener);

await seams.auth.unlock(walletId);
await seams.auth.lock();
await seams.auth.getSession();
await seams.auth.getRecentUnlocks();
await seams.auth.hasPasskey(walletId);
const stopSession = seams.auth.onSessionChange(sessionListener);

seams.config.setTheme("dark");
seams.config.setAppearance({ ... });
seams.config.chainTarget("ethereum");
seams.config.configuredChainTargets();
seams.connection.dispose();
```

`connect` establishes transport and reconciles initial public state. It does not
authenticate or initialize every signer. `dispose` releases the client and its
owned resources; `lock` ends the wallet session. Session/connection subscriptions
return unsubscribe functions and obey R170's snapshot/generation rules.

The top level contains namespaces only: `connection`, `events`, `auth`, `config`,
`registration`, `near`, `evm`, `tempo`, `recovery`, `devices`, `keys`,
`preferences`, and `authMenu`. There are no top-level method aliases.
`connection.dispose()` is terminal for the entire client: it cancels pending
client requests and releases all client-owned subscriptions and resources. It
does not lock the wallet or delete durable presignatures. It is broader than
disconnecting a transport; preserve this complete cleanup contract and update
React ownership cleanup to call it. `events.subscribe` returns an unsubscribe
function and retains the existing lifecycle event contract.
`config` groups operations, while constructor input and the
existing read-only `configs` snapshot remain separate concepts; audit supported
snapshot consumers before changing that property. Add no generic config setter
or new mutable configuration source.

## Complete operation migration map

Rows describe the current source surface reviewed during planning. Reconcile it
against current declarations at implementation time; concurrent work may change
the source. “Internal” requires a caller/export audit and migration of supported
uses, not deletion based solely on absence of repository callers.

### Session, lifecycle, and appearance

| Current call | Target / disposition |
| --- | --- |
| `auth.unlock` | `seams.auth.unlock` |
| `auth.lock`, `auth.logout` | One `seams.auth.lock`; remove `logout` |
| `auth.getWalletSession` | `seams.auth.getSession` |
| `auth.getRecentUnlocks` | `seams.auth.getRecentUnlocks` |
| `auth.hasPasskeyCredential` | `seams.auth.hasPasskey` |
| `initWalletIframe` | `seams.connection.connect` |
| `isWalletIframeReady` | Read discriminated `seams.connection.getState()` |
| `onWalletIframeReady` | `seams.connection.onChange` |
| `onWalletIframeLoginStatusChanged` | `seams.auth.onSessionChange` |
| `onSdkLifecycleEvent` | `seams.events.subscribe` |
| `onWalletIframePreferencesChanged` | Internal reconciliation feeding public preference subscriptions |
| `setTheme`, `setAppearance` | `config.setTheme`, `config.setAppearance` |
| `chainTarget`, `configuredChainTargets` | `config.chainTarget`, `config.configuredChainTargets` |
| `dispose` | `connection.dispose`; full-client terminal cleanup |
| `prewarm`, `prefetchBlockheight` | Internal connection/operation preparation |

The existing logout adds wallet-scoped durable ECDSA presignature deletion to
lock. Remove logout without carrying that deletion into lock. The unified lock
preserves durable presignatures and performs authorization retirement, volatile
material cleanup, and stale-work fencing, per R170. Keep credentials, wallet
records, and recovery material. Preserve exact-wallet cleanup under concurrent
unlock; attempt required cleanup and report failures. Retained presignatures
grant no active signing authority: validate authority and placement/generation
before reuse after unlock. Session expiry requires reauthorization and must not
by itself delete otherwise-valid durable presignatures. Keep independent material
invalidation and consumption rules intact. Do not broaden a local lock into a global device
revocation or a durable-pool purge.

A user can lock, return a month later, and use still-valid durable presignatures
for the first transaction after unlock without waiting for replenishment. Elapsed
time alone must not discard otherwise-valid material. Verify validity against
current authority, placement, and material state before reuse.

`hasPasskey` reports the supported credential lookup. It cannot guarantee a later
authenticator assertion succeeds. `getSession` preserves the existing distinct
session states and supported explicit-wallet queries.

### Email authentication

| Current calls | Target / disposition |
| --- | --- |
| `auth.requestEmailOtpChallenge` | `auth.requestEmailCode` for supported custom UI |
| `auth.loginWithEmailOtpEcdsaCapability`, `auth.unlockAddedEmailOtpWallet` | `auth.unlockWithEmailCode`, after mapping distinct authorization branches |
| `auth.beginGoogleEmailOtpWalletAuth` | `auth.startGoogleSignIn` |
| `auth.requestEmailOtpSigningSessionChallenge`, `auth.refreshEmailOtpSigningSession` | Internal operation-bound step-up/refresh |
| `auth.prefillRouterAbEcdsaDerivationPresignaturePool` | Internal targeted preparation |

```ts
const challenge = await seams.auth.requestEmailCode({ ... });
await seams.auth.unlockWithEmailCode({ challenge, code });
const flow = await seams.auth.startGoogleSignIn({ ... });
```

Keep specialized email/provider flows alongside session calls under `auth`.
Expose each method once under that namespace. Preserve returned flow handles, supported code submission,
resend/cancel operations, external broker callbacks, and one terminal outcome.
Inventory those returned-object methods as part of the declaration audit.

Before consolidation, map challenge purpose, wallet/authority binding, provider
evidence, enrollment vs unlock, curve capability scope, expiry, and retry/cancel
behavior. Use discriminated branches where contracts differ. The SDK supplies
relay routing and internal activation details; applications supply user intent,
required provider evidence, and code input. Preserve operation-bound step-up
proofs; never substitute an unlock proof. If a supported flow cannot fit these
names honestly, record a concrete design gap before replacing it. Do not silently
drop it or invent an authorization conversion to make one signature work.

### Registration and authentication methods

| Current call | Target / disposition |
| --- | --- |
| `registration.registerWallet` | Keep |
| `registration.registerPasskey` | Remove; select passkey through `registerWallet` arguments |
| `registration.registerWithEmailOtp` | Remove; select email OTP through `registerWallet` arguments |
| `registration.addWalletSigner` | `registration.addSigner` |
| `registration.addPasskey` | Keep |
| `registration.addEmailOtp` | `registration.addEmail` |
| `registration.revokeAuthMethod` | `registration.removeAuthMethod` |
| `registration.getNearProvisioningState` | `registration.getNearAccountState` |
| `registration.awaitNearReady` | `registration.waitForNearAccount` |
| `registration.onNearProvisioningStateChanged` | `registration.onNearAccountChange` |
| `registration.resumePendingEcdsaRegistration` | Internal durable continuation |
| `registration.requestEmailOtpEnrollmentChallenge`, `registration.enrollEmailOtp` | Internal registration/add-email steps; preserve custom UI needs through the flow contract |
| `near.registerNearWallet`, `evm.registerEvmWallet` | Consolidate into `registration.registerWallet` after behavior audit |

`registerWallet` is the sole public wallet-creation operation. Use the existing
`authMethod` discriminated union (`kind: "passkey"` or `kind: "email_otp"`) to
select authentication; keep wallet identity and signer selection as separate
arguments. Preserve proof-specific email branches and required evidence. Reuse
`RegistrationAuthMethodInput` and its boundary parser; do not introduce competing
flags, optional auth fields, or a second registration implementation.

```ts
await seams.registration.registerWallet({
  authMethod: { kind: "passkey", rpId },
  wallet,
  signerSelection,
});

await seams.registration.registerWallet({
  authMethod: emailOtpAuthMethod,
  wallet,
  signerSelection,
});
```

Here `emailOtpAuthMethod` is the precise email branch produced by the supported
challenge/provider flow, including its required proof. Remove `registerPasskey`
and `registerWithEmailOtp` from client declarations, React hooks/context, examples,
docs, and tests. Migrate convenience defaults into the single registration
boundary where supported; keep no aliases. Adding a passkey to an existing wallet
remains the distinct `registration.addPasskey` operation.

`waitForNearAccount` retains typed ready, failed, and timed-out outcomes and abort
behavior. Consolidating registration must preserve signer selection, implicit or
named NEAR provisioning, supplied wallet identity, callbacks, and recovery
checkpoints. `removeAuthMethod` retains its distinct authorizing-method proof.

### NEAR, EVM, and Tempo transactions

```ts
await seams.near.accountExists(accountId);
await seams.near.signTransaction({ ... });
await seams.near.signAndSendTransaction({ ... });
await seams.near.sendTransaction({ ... });
await seams.near.signMessage({ ... });
await seams.near.signDelegateAction({ ... });
await seams.near.sendDelegateAction({ ... });
await seams.near.signAndSendDelegateAction({ ... });

await seams.evm.signTransaction({ ... });
await seams.evm.signAndSendTransaction({ ... });
await seams.tempo.signTransaction({ ... });
await seams.tempo.signAndSendTransaction({ ... });
await seams.tempo.getFeeToken({ ... });
await seams.tempo.validateFeeToken({ ... });
await seams.tempo.setFeeToken({ ... });
```

| Current call | Target / disposition |
| --- | --- |
| NEAR helper usage through `getContext().nearClient` | `near.accountExists`; RPC and fallback stay internal |
| `near.signTransactionWithActions` | `near.signTransaction` |
| `near.signAndSendTransaction`, `near.sendTransaction` | Keep |
| `near.signNEP413Message` | `near.signMessage`; retain NEP-413 payload/result semantics |
| `near.executeAction` | Consolidate into `signAndSendTransaction` after comparing result, callbacks, and review semantics |
| `near.signDelegateAction`, `near.signAndSendDelegateAction` | Keep |
| `near.sendDelegateActionViaRelayer` | `near.sendDelegateAction` |
| `near.fundImplicitNearAccountForTesting` | Test tooling only |
| `evm.signTransaction`, `tempo.signTransaction` | Keep |
| `evm.executeTransaction`, `tempo.executeTransaction` | `signAndSendTransaction` in each namespace |
| `tempo.getFeeTokenPreference` | `tempo.getFeeToken` |
| `tempo.setFeeTokenPreference` | `tempo.setFeeToken` |
| `tempo.validateFeeToken` | Keep |
| `tempo.signTempo`, `tempo.executeEvmFamilyTransaction` | Delete deprecated aliases |

Signing returns a signed payload; sending submits an already signed payload;
sign-and-send performs both. Preserve each chain's current completion/finality
contract and document it. EVM and Tempo retain distinct typed envelopes/results.
Preserve parent review reservations, payload binding, cancellation, nonce
reporting, host admission, and receipt behavior. `setFeeToken` remains an on-chain
transaction. Relayer transport stays internal while supported configuration and
explicit overrides remain representable. Account lookup failures must remain
distinct from confirmed account absence.

### Recovery, devices, and export

| Current call | Target / disposition |
| --- | --- |
| `recovery.syncAccount` | Keep; verify and document its supported promise |
| `recovery.getWalletRecoveryCodeStatus` | `recovery.getCodeStatus` |
| `recovery.acknowledgeWalletRecoveryCodeBackup` | `recovery.confirmBackup` |
| `recovery.rotateWalletRecoveryCodes` | `recovery.rotateCodes` |
| `recovery.requestWalletCustodyEmailOtpChallenge` | Internal purpose-bound authorization; audit credential-list/label callers too |
| `devices.startDevice2LinkingFlow` | `devices.startLinking` |
| `devices.scanAndLinkDevice` | `devices.approveLinking` |
| `devices.cancelDeviceLinking` | `devices.cancelLinking` |
| `devices.listLinkedDevices` | `devices.list` |
| `devices.revokeLinkedDevice` | `devices.remove` |
| `keys.exportKeypair` | `keys.exportKey` |
| `keys.resolveExactKeyExportLane`, `keys.exportKeypairWithUI` | Internal export steps; retain explicit advanced support only for demonstrated supported uses |

The new device starts linking; an authorized existing device approves the
request. Scanning supplies input and remains a UI concern. Preserve source proof,
factor activation, cancellation, expiry, pagination, and revocation semantics.
Internalize timestamps and proof orchestration where the current trust boundary
allows it; never treat raw QR input as already authenticated.

`confirmBackup` records acknowledgement and does not claim to verify an external
backup. `exportKey` opens the wallet-origin viewer and preserves outcomes such as
`relink_required`; no private key is returned to the application by this rename.

### Preferences and hosted auth UI

| Current call | Target / disposition |
| --- | --- |
| `preferences.setCurrentWallet`, `getCurrentWalletId`, `onCurrentWalletChange` | Keep under `preferences` |
| `preferences.setConfirmBehavior` | `preferences.setConfirmationBehavior` |
| `preferences.setConfirmationConfig`, `getConfirmationConfig`, `onConfirmationConfigChange` | Keep under `preferences` |
| R170 acknowledged preference writes | `preferences.flush` |
| `openHostedAuthMenu` | `authMenu.open` |
| `cancelHostedAuthMenu` | `authMenu.cancel` |
| `onHostedAuthMenuExternalAuthRequest` | `authMenu.onExternalAuthRequest` |
| `resolveHostedAuthMenuExternalAuth` | `authMenu.resolveExternalAuth` |
| `onHostedAuthMenuDemoEmailOtpDelivery` | Demo/test integration only |

Keep preference synchronization automatic where operations require it. Preserve
R170 rollback/flush behavior and the distinction between display selection and
authenticated signing identity. Hosted UI retains wallet-origin CTA, session
correlation, and callback binding. Standard React consumers render the component;
imperative integration uses `authMenu`.

### Advanced execution and internal lifecycle

Keep `evm.advanced` and `tempo.advanced` reporting for supported custom broadcast:
`reportBroadcastAccepted`, `reportBroadcastRejected`, `reportFinalized`,
`reportDroppedOrReplaced`, and `reconcileNonceLane`. Standard sign-and-send calls
perform this coordination internally. Delete the deprecated top-level Tempo
reporting aliases.

Internalize `bootstrapEcdsaSession` (including deprecated top-level aliases),
`prefillRestoredWalletSession`, `getWalletIframeExactSessionState`,
`lockWalletIframeExactSession`, `setWalletIframeSurfaceMeasurementBinding`,
`signTempoFeeTokenPreferenceInternal`, and `getContext`, after mapping supported
explicit-runtime/advanced callers to their owner. Exact-session targeting must
survive extraction. Do not replace an exact-session lock with a loosely targeted
global call. Preserve the explicit runtime entry and its supported ports.

### React and external wallets

Keep `useWallet`, `useWalletAuth`, `useWalletDevices`, `useAccountInput`,
`useDeviceLinking`, `useExternalEvm`, `useQRCamera`, `useTheme`, and `useSeams`.
Keep `useNearClient` for explicit advanced RPC usage. Bound signing methods and
auth/device hook methods mirror the client names above; retain wallet binding and
transaction review. Keep the existing bound `wallet.exportKey` spelling.

| Current hook member | Target / disposition |
| --- | --- |
| `refreshLoginState` | `refreshSession` |
| `getWalletSession`, `addWalletSigner`, `setConfirmBehavior` | `getSession`, `addSigner`, `setConfirmationBehavior` |
| `registerPasskey`, `registerWithEmailOtp` | Remove; use `registerWallet` with `authMethod` |
| `setInputUsername` | `setAccountName` |
| `refreshAccountData` | Keep |
| Device `startDevice2LinkingFlow`, `cancelDeviceLinking`, `linkDevice` | `startLinking`, `cancelLinking`, `approveLinking` |
| Camera `startScanning`, `stopScanning`, `setScanMode` | Keep |
| Camera `handleCameraChange` | `selectCamera` |
| Camera `getOptimalFacingMode`, `setError` | Internal camera/error management |
| Flow `awaitCompletion`, `awaitNextStart`, `awaitNextCompletion` | Internal unless supported application orchestration requires explicit advanced access |

Preserve current React components and narrow entry points: provider, hosted auth
menu, account/profile/settings UI, QR UI, theme, and transaction review. This plan
does not redesign their visual behavior or rename components without a finding.

External EVM operations retain `connect`, `disconnect`, `selectAccount`,
`switchChain`, `signMessage`, `signTypedData`, `sendTransaction`, `getSnapshot`,
`subscribe`, and `dispose`. Rename `observeReceipt` to `waitForReceipt` after
confirming its exact promise completion condition. Keep `providerEvent` internal;
adapter/React integration owns `start`/`mount`, with supported non-React lifecycle
access explicitly documented. External signing/broadcast semantics remain separate
from hosted-wallet authorization.

## Export and input-shape audit

Audit all package entries: root, React and narrow React exports, external EVM,
advanced, threshold, runtime, and wallet-iframe client HTML. Include methods on
returned flow handles, hook results, callback controls, and exported classes.
The table above covers the reviewed operation surface; exported utilities need
a declaration-level pass before declaring the migration complete.

- Keep useful NEAR action builders: `transfer`, `functionCall`, `createAccount`,
  `deleteAccount`, `addKey`, `deleteKey`, `deployContract`, and `stake`.
- Preserve `defineSeamsConfig`, supported environment/testnet setup helpers, and
  `logWalletEvents`. Keep low-level configuration out of ordinary examples.
- Audit root-exported threshold chain/reference builders, event constructors,
  hosted-message boundary builders, worker configuration constants, and public
  type names. Move execution/transport mechanics to their actual owner or an
  existing advanced entry when supported. Keep useful exact-reference APIs.
- Audit advanced RPC, encoding, hashing, and runtime factories without creating
  a new utility framework or renaming established protocol terms for brevity.
- For each removed/renamed call record input/result/event/error contracts,
  existing consumers, replacement, and evidence in this document or the existing
  inventory. Avoid a new generated manifest or source-text guard.
- Simplify inputs with operation-bound challenge/flow results and existing typed
  builders. Require core identity/auth fields; allow truly optional UI/config
  options. No broad lifecycle spreads, domain casts, or repeated raw validation.

## Implementation sequence

- [ ] Audit current declarations and consumers in public SDK, tests, examples,
  docs, and private Console. Classify each row as rename, consolidation, internal
  move, or intentional behavior change; record unresolved contract differences.
- [ ] Close email/registration/action consolidation gates and returned-flow API
  inventory. Confirm behavior of `syncAccount` and external receipt completion.
- [ ] Integrate session/lifecycle names and unified lock with R170/R153 ownership.
  Implement SDK-owned account lookup and preserve injected RPC behavior.
- [ ] Rename chain, registration, recovery, device, key, preference, and hosted UI
  methods at their real implementation boundary. Remove old aliases/callers in
  the same change; reuse underlying flows rather than adding wrapper layers.
- [ ] Update React bindings and external EVM receipt naming. Preserve review,
  identity binding, optional React integration, SSR, and remount behavior.
- [ ] Complete package export/type cleanup and move internal/test helpers. Update
  all first-party examples, reference docs, intended-behavior specs, and Console.
- [ ] Run targeted verification and produce repeatable artifacts. Record public
  API migration notes and matching client/host release requirements.

## Verification and completion

Use existing behavioral E2E suites and type fixtures; add no unit tests or
source-text change-detector tests. Read the applicable test instructions and
classify failures against intended behavior before repairs.

- Packed SDK consumer type-check: ordinary setup/session/signing calls work
  through public imports. Type fixtures reject invalid lifecycle/challenge
  combinations and exercise removed public names without production casts.
- Real-host E2E: register a mixed wallet, await NEAR provisioning, lock/unlock,
  switch the rendered wallet during pending work, and sign on NEAR and EVM/Tempo.
  Verify bound identities, review, receipt results, and old-generation exclusion.
- Email custom/hosted flows: code failure, resend/cancel, step-up, and successful
  completion preserve purpose and authority. Cover consolidated registration
  paths and custom UI callers before deleting their old APIs.
- Device/recovery/export: link another browser context, approve and revoke it,
  acknowledge/rotate recovery codes, and exercise authorized export plus relink
  outcomes. Preserve wallet-origin secret display.
- Lock and preferences: durable-pool retention, volatile cleanup, failed cleanup,
  concurrent unlock, restart, signing rejection while locked, validated reuse
  after unlock, preference write failure, flush, and immediate sign. Verify that
  lock adds no durable-pool purge; retain independent invalidation coverage.
- Returning-user E2E: lock, restart the browser with durable storage preserved,
  advance the supported test clock by one month, unlock, and sign immediately.
  Record first-sign latency and evidence that the operation consumes a retained
  valid presignature without waiting for refill. Ensure the clock advances across
  relevant client/server validity checks; do not simulate aging only in UI time.
- Save repeatable commands, source revision, packed asset identity, browser
  traces/reports, and scenario results. Stub-host success alone is insufficient.
- Re-run R170 consumer graph/size checks to ensure naming/export moves do not
  pull runtime execution into application entries. Run relevant declaration,
  type, build, and `pnpm report:bloat --check` checks.
- Private Console must use the matching exact package release when available;
  record any local packed-package validation separately from released integration.
  Publication/deployment requires its own user instruction.

Complete when every inventory row has a disposition and migrated callers, the
accepted names are the only supported names for replaced operations, necessary
advanced/runtime contracts remain supported, documented behavior matches E2E
evidence, and no obsolete aliases or duplicate implementation paths remain.

Public TypeScript renames do not inherently require wire renames. Preserve wire
contracts where compatible; deletion or incompatible semantic changes require
R170's protocol/manifest version decision and a matched release/rollback pair.
Do not retain obsolete wire handlers as a compatibility path after that cutover.
