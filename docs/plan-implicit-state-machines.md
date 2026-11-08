# Plan: Implicit State Machine Hardening

## Purpose and Scope

This document records the source-verified audit of implicit state machines across `seams-wallet` and the phased refactor plan to replace ad-hoc boolean flags, parallel `Map`s, nullable field bags, and unguarded transitions with explicit discriminated unions and atomic transition helpers.

Every candidate finding from the initial repository scan was checked directly against the current source on `dev` (`470fbdba5`) before inclusion. Following [`docs/debugging-method.md`](./debugging-method.md):

1. **Facts precede causes**: each item below cites the exact file, line range, and measured code behavior.
2. **Refuted or narrowed hypotheses are recorded explicitly**: four initial subagent claims were either refuted or narrowed upon reading the implementation and are documented in [Withdrawn and Narrowed Findings](#withdrawn-and-narrowed-findings) so we do not churn working code.
3. **Zero database migrations**: per project decision, D1 and SQLite table schemas remain unchanged. Persisted state invariants are enforced in TypeScript/Rust boundary codecs and SQL compare-and-swap (`WHERE`) guards.
4. **Codebase hygiene (`AGENTS.md`)**:
   - Name union variants beside their union with `Variant` (`packages/shared-ts/src/utils/variant.ts`).
   - Use validation helpers from `packages/shared-ts/src/utils/validation.ts`.
   - Delete replaced state fields and dead branches in the same change; add no compatibility shims, flags, or dual paths.
   - Do not cite refactor or phase numbers in code comments.
   - Keep every file under 2,000 lines (splitting along a real seam first when needed) and pass `pnpm report:bloat --check`.

---

## Verification Matrix

| ID | Subsystem & File | Current Encoding | Measured Fact in Source | Status | Batch |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **B1** | [`readiness.ts`](../packages/wallet/src/core/signingEngine/session/availability/readiness.ts) (`L59-L62`, `L162-L178`, `L731-L753`) | `DiscoveredSigningSessionLane.backing: 'record_policy' \| 'volatile_authority'` | `buildDiscoveredLaneForRuntime` (`L175`) is the sole constructor and hardcodes `backing: 'record_policy'`. In `clearWalletSession` (`L732`), `if (lane.backing === 'record_policy') continue;` always skips `L733-L753`, so volatile `emailOtp` and `touchConfirm` worker sessions are never cleared by `clearWalletSession`. | **Confirmed defect** | Batch 1 |
| **B2** | [`presignaturePool.ts`](../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts) (`L300-L305`, `L460-L518`, `L620-L644`, `L672`) | 7 module-level `Map<string, ...>` keyed by `poolKey` | `clearClientPresignaturePool(poolKey)` (`L638-L644`) deletes from 3 of 7 maps and bumps generation, leaving `clientPresignatureHydrationInFlightByPoolKey` and `foregroundRefillInFlightByPoolKey` populated. `takeClientPresignature` pops from `clientPresignaturePool` (`L672`) before awaiting worker reservation while `hydrateClientPresignaturePool` (`L474-L506`) re-lists available worker handles and pushes any handle not in `clientPresignaturePool`. | **Confirmed defect** | Batch 1 |
| **B3** | [`workerTransport.ts`](../packages/wallet/src/core/signingEngine/workerManager/workerTransport.ts) (`L243-L257`, `L1047-L1091`) | `workers: Map<WorkerKind, WorkerEntry>` + 2 prewarm promises + external handle registries | `terminateWorkerOnly` and `resetWorker` do not clear `ecdsaRegistrationCryptoPrewarmPromise` or `emailOtpYaoPrewarmPromise`; `setWorkerBaseOrigin` (`L253`) clears `emailOtpYaoPrewarmPromise` but forgets `ecdsaRegistrationCryptoPrewarmPromise`. Resetting `ecdsaDerivationClient` or `emailOtp` does not invalidate main-thread `linkedEcdsaHolderRuntime` or `Ed25519YaoActiveClientRegistry` handles. | **Confirmed defect** | Batch 1 |
| **B4** | [`ecdsa-presign-client.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-presign-client.worker.ts) (`L590-L635`, `L892-L894`, `L996-L1000`) & [`ecdsa-derivation-client.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-derivation-client.worker.ts) (`L585-L619`, `L3142-L3160`) | `messageQueue: Promise<void>` + `presignatureByHandle` + `ceremonyStates` | In `ecdsa-presign-client.worker.ts`, `attachControlChannel` (`L997`) and `enqueueOnlineRequest` (`L892`) bypass `messageQueue`, and `reservePresignature` (`L595-L624`) leaves `entry.state.kind === 'available'` across `await requestOpaqueAuthority(...)`. In `ecdsa-derivation-client.worker.ts`, `persistInitialCanonicalEcdsaActivation` (`L601-L618`) only closes `ceremonyId` in `case 'stored'`, leaking the ceremony entry on `'exact_record_conflict' \| 'corrupt' \| 'persistence_unavailable'`. | **Confirmed defect** | Batch 1 |
| **B5** | [`passkey-mpc-session.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/passkey-mpc-session.worker.ts) (`L1108-L1174`) | `passkeyPrfFirstHandleStore` + `warmSessionPrfHandleCache` | `runSigningSessionSealAndPersist` captures `const entry = activeEntry.entry` (`L1117`) before async Shamir 3-pass and `callSigningSessionSealRoute` RPCs, then calls `updateWarmSessionPrfHandlePolicy(thresholdSessionId, entry, policy)` (`L1173`), which unconditionally sets `warmSessionPrfHandleCache.set(thresholdSessionId, entry)` even if the session was cleared or consumed during the `await`s. | **Confirmed defect** | Batch 1 |
| **B6** | [`unlockedEd25519ExportRootCapability.ts`](../packages/wallet/src/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability.ts) (`L44-L47`, `L268-L315`) & [`nearProvisioningRegistry.ts`](../packages/wallet/src/core/signingEngine/flows/registration/nearProvisioningRegistry.ts) (`L16-L24`, `L96-L119`) | Module-level `currentCapability` singleton; `{ state, inFlight, listeners }` | `establishUnlockedWalletEd25519ExportRootCapabilityV1` awaits `transport.requestOperation` (`L287`) and overwrites `currentCapability` (`L310`) without checking if `destroyUnlockedWalletEd25519ExportRootCapabilitiesV1` ran while in flight or destroying a superseded `capabilityHandleId`. In `nearProvisioningRegistry.ts`, `publishNearProvisioningState` (`L96`) notifies listeners before `entry.inFlight = inFlight` (`L118`) is assigned. | **Confirmed defect** | Batch 1 |
| **B7** | [`NonceCoordinator.ts`](../packages/wallet/src/core/signingEngine/nonce/NonceCoordinator.ts) (`L940-L1018`, `L1246-L1253`, `L1421-L1464`) & [`nearNonceLane.ts`](../packages/wallet/src/core/signingEngine/nonce/nearNonceLane.ts) (`L805-L874`) | In-memory `leases`, `evmState`, `nearState` + durable `nonceLaneCoordinationStore` | `recoverDurableLeases` (`L940-L1018`) leaves non-expired `Reserved`/`Signed` durable records in `nonceLaneCoordinationStore` without inserting them into in-memory `leases`, `evmState.reserved`, or `nearState.reservedNonces`. `clearNearAccessKey` (`L1246-L1253`) clears in-memory `leases` without deleting durable store records. `clearForWallet` (`L1421`) and `clearAll` (`L1451`) mutate state outside `withLaneLock`. | **Confirmed defect** | Batch 2 |
| **B8** | [`unifiedIndexedDBManager.ts`](../packages/wallet/src/core/indexedDB/unifiedIndexedDBManager.ts) (`L45-L140`, `L787`) & [`sealedRestoreOrchestrator.ts`](../packages/wallet/src/core/signingEngine/session/emailOtp/sealedRestoreOrchestrator.ts) (`L82`, `L97`, `L261`) | Flat interfaces `AccountSignerRecord` / `SignerOpOutboxRecord`; unused `summary.repairs`; mutable `requestedChainTarget` | `AccountSignerRecord` and `SignerOpOutboxRecord` allow invalid combinations of `status` and nullable lifecycle fields unless narrowed by boundary codecs. `summary.repairs` (`L787`) is initialized to `[]` and never populated. `requestedChainTarget` (`L82`) is a mutable instance property used to pass a synchronous parameter into `readEcdsaSealedRecordForTarget`. | **Confirmed structural hazard** | Batch 2 |
| **B9** | [`routerAbEd25519YaoRegistration.ts`](../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistration.ts) (`L655-L778`) | 3 maps: `states`, `lifecycleSessions`, `admissionClaims` | In `commitAdmit` (`L708-L715`), when `input.outcome.kind === 'backend_uncertain'`, the method returns `503 admission_uncertain` without deleting `this.admissionClaims.get(input.claim.lifecycleId)`. Subsequent `prepareAdmit` (`L665`) and `prepareExecute` (`L778`) calls permanently fail with `409 admission_in_progress`. | **Confirmed defect** | Batch 3 |
| **B10** | [`d1LinkedDeviceAuthorityInstallService.ts`](../packages/wallet-server/src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceAuthorityInstallService.ts) (`L1250-L1296`) | Multi-step D1 batch cleanup (`pending` -> `allocation_removed` -> `session_removed`) | In `commitAcknowledgementCleanupV1` (`L1270-L1290`), when `input.session === null`, `database.batch([...beforeDeleteStatements, ...afterDeleteStatements])` runs without `D1_BATCH_CAS_GUARD_SQL` after the state transition updates, so 0-row matches silently succeed. | **Confirmed defect** | Batch 3 |
| **B11** | [`externalAuthStore.ts`](../packages/wallet-server/src/auth/externalAuthStore.ts) (`L469-L475`) | SQL `status` column (`pending \| verified \| consumed \| expired \| cancelled \| failed \| revoked`) | `revokeSession` (`L470-L474`) runs `UPDATE external_auth_attempts SET status = 'revoked' WHERE ${SCOPE} AND session_token_hash = ?5 AND origin = ?6` without guarding `AND purpose = 'authenticate' AND status IN ('verified', 'consumed')`. | **Confirmed defect** | Batch 3 |
| **B12** | [`d1RegistrationCeremonyRecords.ts`](../packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyRecords.ts) (`L1475-L1515`) & [`d1WalletExecutionAuthority.ts`](../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority.ts) (`L76-L139`, `L274-L310`) | `activationOwner: ''` sentinel; `(state, registration_completion)` pair | `parseD1StoredEvmFamilyEcdsaActivationClaimedBranch` (`L1480`) and `ActivatedBranch` (`L1508`) encode legacy unowned rows as `activationOwner: ''` instead of a discriminated union. In `d1WalletExecutionAuthority.ts`, `admitHomeRead` (`L112-L115`) invokes `await this.cancel(input)` (a D1 write + directory RPC) inside a read admission check, and `cancel` (`L134-L137`) runs two D1 batches that both set `state = 'retired'`. | **Confirmed defect** | Batch 3 |
| **B13** | [`ecdsa_presign_live_session.rs`](../crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs) (`L587-L725`) | `RefCell<BTreeMap<String, LiveSession>>` + `completed_records` + DO storage | `handle_linked_step` (`L593-L595`) removes `entry` from `sessions` before validating expiry, scope, request digest, stage (`L602-L630`), or message decoding (`L633`). Any validation error, transient RNG error, or `persist_linked_terminal_completion` storage error permanently drops the live session without re-inserting or tombstoning it. | **Confirmed defect** | Batch 3 |
| **B14** | [`tenant_root_role_d1.rs`](../crates/router-ab-cloudflare/src/tenant_root_role_d1.rs) (`L14930-L15040`) | `TenantRootRestoreImportSessionTombstoneD1RowV1` (`state: Option<String>`) | `restore_import_session_tombstone_from_row` validates `role`, `closed_at_ms`, `activation_receipt`, and `cleanup_receipt`, but never checks `row.state.as_deref() == Some("closed")`. | **Confirmed defect** | Batch 3 |
| **B15** | [`session.rs`](../crates/router-ab-ecdsa-presign/src/session.rs) (`L185-L210`, `L410-L437`) | `ClientState` / `SigningWorkerState` -> `PresignSessionStage` | Both `ClientPresignSession::stage()` (`L198`) and `SigningWorkerPresignSession::stage()` (`L425`) map `Done(_) \| Poisoned => PresignSessionStage::Done`, making a poisoned session indistinguishable from a completed session via `stage()`. | **Confirmed defect** | Batch 3 |
| **B16** | [`ceremony.rs`](../wasm/router_ab_ecdsa_client/src/ceremony.rs) (`L34-L260`) & [`ecdsa_role_local.rs`](../wasm/router_ab_ecdsa_client/src/ecdsa_role_local.rs) (`L639-L710`) | 4 independent `Option` fields on `RouterAbEcdsaClientCeremonyV1`; 3 `pending_export_*` `Option`s on `EcdsaRoleLocalHolderV1` | `RouterAbEcdsaClientCeremonyV1` allows `build_registration_request`, `build_explicit_export_request`, and `build_activation_refresh_request` to be called on the same ceremony instance, overwriting `post_registration_application_binding_digest`. `EcdsaRoleLocalHolderV1` stores 3 co-null `Option<[u8; 32]>` fields instead of a single `Option<PendingOrdinaryExportV1>`. | **Confirmed structural hazard** | Batch 3 |
| **B17** | [`router.ts`](../packages/wallet/src/SeamsWeb/walletIframe/client/router.ts) (`L2494-L2568`, `L4232-L4272`, `L4558-L4573`) | `state.ready`, `state.configured`, `state.initInFlight`, `state.configurationInFlight`, `exactSessionState` + 4 `hostedAuthMenu*` maps | `connectAndConfigure` sets `this.state.ready = true` (`L2551`) before `await this.post({ type: 'PM_SET_CONFIG', ... })` (`L2553`); concurrent `post()` calls check `if (!this.state.ready \|\| !this.state.port)` (`L4563`) and can send RPCs before `PM_SET_CONFIG` finishes. In `openHostedAuthMenu` (`L4246-L4259`), cancelling during `await this.ensureConfigured()` causes `post()` (`L4570`) to throw `'Wallet iframe request was cancelled before dispatch'` instead of returning `{ kind: 'cancelled', authMenuSessionId }`. | **Confirmed defect** | Batch 4 |
| **B18** | [`overlay-controller.ts`](../packages/wallet/src/SeamsWeb/walletIframe/client/overlay/overlay-controller.ts) (`L369-L410`) | `mode: OverlayMode \| null`, `visible: boolean`, `reviewHandoff`, `pendingReveal`, `surfaceResize` | In `show(mode)` (`L376`), `this.mode = mode` is assigned before `L409`: `else if (!this.mode \|\| !('identity' in this.mode) \|\| identityChanged) dialog.removeAttribute('data-transaction-review')`. Because `this.mode` was already overwritten with the new `mode`, transitioning from a non-identity mode or checking the previous mode's identity inspects the new `mode` instead of `previousMode`. | **Confirmed defect** | Batch 4 |
| **B19** | [`session.ts`](../packages/wallet/src/SeamsWeb/walletIframe/host/auth-menu/session.ts) (`L3436-L3675`) | `viewModel.submitBusy`, `viewModel.resendBusy`, `viewModel.rerollBusy` booleans | In `google_login`, `resendGoogleOtp` (`L3438`) only checks `resendBusy` and `submitGoogleOtp` (`L3509`) only checks `submitBusy`, allowing concurrent `flow.resend()` and `flow.submit()`. In `google_registration`, `rerollGoogleRegistration` (`L3588`) only checks `rerollBusy` and `completeGoogleRegistration` (`L3661`) only checks `submitBusy`, allowing concurrent `flow.rerollWalletId()` and `flow.completeRegistration()`. | **Confirmed defect** | Batch 4 |
| **B20** | [`linkDeviceFlow.ts`](../packages/wallet/src/SeamsWeb/operations/devices/linkDeviceFlow.ts) (`L601-L654`) | `emailOtpTargetActivationState` union | `prepareTargetEmailOtpActivationV1` sets `this.emailOtpTargetActivationState = { kind: 'available', context: baseContext }` (`L611`) and directly calls `await this.startTargetEmailOtpChallengeV1(baseContext)` (`L612`) instead of `await this.sendTargetEmailOtpCodeV1()`, leaving `emailOtpTargetActivationState.kind === 'available'` while the initial start challenge RPC is in flight. | **Confirmed defect** | Batch 4 |
| **B21** | [`WithdrawPanel.tsx`](../packages/wallet/src/react/components/AccountMenuButton/assets/WithdrawPanel.tsx) (`L84-L140`) | `state: FormState` + `maxPending: boolean` | `busy` (`L98`) is `state.kind === 'checking' \|\| state.kind === 'confirming'` and ignores `maxPending`. While `fillMax` (`L100-L121`) is awaiting `prepare(...)`, the user can submit `review()`, and when `fillMax` resolves it overwrites `amount` and resets `setState({ kind: 'editing', error: null })` (`L120`). | **Confirmed defect** | Batch 4 |
| **B22** | [`externalEvm/controller.ts`](../packages/wallet/src/externalEvm/controller.ts) (`L435-L461`, `L548-L584`) & [`externalNear/controller.ts`](../packages/wallet/src/externalNear/controller.ts) (`L90-L128`) | `snapshot` + `binding` + `activeRequestToken` + `dispatched` boolean; `pending` boolean | In `externalEvm/controller.ts`, `switchChain` (`L455-L460`) calls `this.disconnect()` when `observed.value.chainId !== configuredChain.chainId`, destroying a valid connection if the provider stayed on the old chain. In `externalNear/controller.ts`, `this.pending` (`L124`) is tracked beside `snapshot.connection`. | **Confirmed defect** | Batch 4 |
| **B23** | [`inference.ts`](../packages/voiceid/src/browser/inference.ts) (`L28-L64`), [`ribbon.ts`](../packages/voiceid/src/browser/ribbon.ts) (`L53-L91`, `L133-L190`, `L270-L368`), [`microphone.ts`](../packages/voiceid/src/browser/microphone.ts) (`L165-L360`) | `pending` + `progress` + `listeners`; `phase` + `stage` + `settleSuccess`; `recorder.state` + `closed` + `ended` | In `inference.ts`, `failed` (`L54-L58`) resets `this.progress = { kind: 'checking_cache' }` without notifying other concurrent `download()` listeners. In `ribbon.ts`, `succeed(begin)` (`L152-L160`) waits for `this.stage.kind === 'spin'`, which never happens when `this.checking === 'segments'` (`L136`, `L270-L285`), so `begin` is never called during segment-mode success. | **Confirmed defect** | Batch 4 |

---

## Withdrawn and Narrowed Findings

Before writing code, we verified every candidate from the initial exploration against the actual source files. The following four claims from the initial exploration were **refuted or narrowed** and will **not** be treated as bugs:

1. **Withdrawn — `UiConfirmManager.ts` 3-map race and `reservedNonceLeases` leak**:
   - *Initial claim*: `UiConfirmManager.ts` (lines 714–754) maintained `pendingRequests`, `pendingRequestTokens`, and `pendingWorkerRequests` in a `confirmWithWorker` method that leaked `reservedNonceLeases` when `pendingExecution.decision?.confirmed` was true.
   - *Measured fact*: [`UiConfirmManager.ts`](../packages/wallet/src/core/signingEngine/uiConfirm/UiConfirmManager.ts) (`L72-L89`, `L218-L285`) is 342 lines total, already models each request with an explicit `PendingConfirmState` union (`'awaiting_decision' | 'decided'`), and does not manage `reservedNonceLeases` (nonce leases live in [`signing.ts`](../packages/wallet/src/core/signingEngine/uiConfirm/handlers/flows/signing.ts) and [`adapters.ts`](../packages/wallet/src/core/signingEngine/uiConfirm/handlers/flows/adapters.ts)). No change needed in `UiConfirmManager.ts`.
2. **Withdrawn (false-positive claim) — `reconcileLocalSignerState` flagging active ECDSA signers**:
   - *Initial claim*: `reconcileLocalSignerState` in [`unifiedIndexedDBManager.ts`](../packages/wallet/src/core/indexedDB/unifiedIndexedDBManager.ts) (`L851-L868`) checked `key.keyKind === 'threshold_share_v1'` and therefore falsely reported `active_signer_missing_key_material` for every active ECDSA signer.
   - *Measured fact*: [`repositories.ts`](../packages/wallet/src/core/indexedDB/seamsWalletDB/repositories.ts) (`L3897`, `L3954`) writes `keyKind: 'threshold_share_v1'` for **both** `ed25519` and `ecdsa` threshold key material rows. The check at `unifiedIndexedDBManager.ts:853` is valid for both curves. Only the unpopulated `summary.repairs` array (`L787`) and the non-discriminated `AccountSignerRecord` / `SignerOpOutboxRecord` interfaces (`L45-L140`) are real cleanup targets (tracked in **B8**).
3. **Narrowed — `EmailOtpSealedRestoreOrchestrator.requestedChainTarget` async race**:
   - *Initial claim*: `this.requestedChainTarget` in [`sealedRestoreOrchestrator.ts`](../packages/wallet/src/core/signingEngine/session/emailOtp/sealedRestoreOrchestrator.ts) (`L82`, `L97`, `L261`) was subject to an async race across concurrent restore calls.
   - *Measured fact*: `this.requestedChainTarget` is assigned at `L97` and read synchronously at `L261` before the first `await` in `readEcdsaSealedRecordForTarget` (`L270`). There is no async race, only an unnecessary mutable instance field that should be passed as a parameter (included in **B8**).
4. **Narrowed — `nearProvisioningRegistry.ts` `inFlight === null` window**:
   - *Initial claim*: `runSingleFlightNearProvisioning` in [`nearProvisioningRegistry.ts`](../packages/wallet/src/core/signingEngine/flows/registration/nearProvisioningRegistry.ts) (`L96-L119`) left `entry.inFlight === null` across async turns when `status === 'near_provisioning'`.
   - *Measured fact*: `publishNearProvisioningState` (`L96`) and `entry.inFlight = inFlight` (`L118`) run synchronously in the same turn. However, `publishNearProvisioningState` notifies synchronous listeners at `L56` *before* `entry.inFlight = inFlight` is set at `L118`, and external callers can call `publishNearProvisioningState` with `status: 'near_provisioning'` directly. Folding `inFlight` into the `'near_provisioning'` variant (tracked in **B6**) closes even the synchronous re-entrancy window.

---

## Phased Execution Plan

### Batch 1: Browser Core Session Readiness, Presignature Pool & Worker Lifecycles (`B1–B6`)

#### B1 — Fix `clearWalletSession` volatile session cleanup (`readiness.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/session/availability/readiness.ts`](../packages/wallet/src/core/signingEngine/session/availability/readiness.ts)
- **Root Cause**:
  - `DiscoveredSigningSessionLane` (`L59-L62`) defines `backing: 'record_policy' | 'volatile_authority'`, and `buildDiscoveredLaneForRuntime` (`L162-L178`) always sets `backing: 'record_policy'`.
  - `clearWalletSession` (`L731-L753`) loops over `discovered` lanes and executes `if (lane.backing === 'record_policy') continue;` (`L732`), making the volatile worker cleanup for `email_otp` (`clearEmailOtpColdSigningSession`) and `passkey` (`clearAllPrfFirstCacheForSession`) at `L733-L753` completely unreachable.
  - By contrast, [`clientSessionExpiryInvalidator.ts`](../packages/wallet/src/core/signingEngine/session/availability/clientSessionExpiryInvalidator.ts) (`L79-L87`) dispatches directly on `lane.auth.kind`.
- **Change**:
  - Remove the dead `backing` field from `DiscoveredSigningSessionLane` (or replace it with the actual auth-lane capability).
  - In `clearWalletSession` (`L731-L753`), always clear volatile worker material for discovered lanes alongside `SigningSessionStateRepository.deleteSigningSessionState(walletId)` (dispatching on `lane.auth.kind === 'email_otp'` and `lane.auth.kind === 'passkey'`), matching `clientSessionExpiryInvalidator.ts`.
- **Verification**:
  - Add a unit test in `packages/wallet` verifying that `clearWalletSession` invokes `clearEmailOtpColdSigningSession` for discovered `email_otp` lanes and `clearAllPrfFirstCacheForSession` for discovered `passkey` lanes in addition to deleting the IndexedDB policy record.

#### B2 — Consolidate ECDSA presignature pool maps into `PoolBucketState` (`presignaturePool.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts`](../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts)
- **Root Cause**:
  - Seven separate maps keyed by `poolKey` (`clientPresignaturePool`, `clientPresignaturePoolIdentityByPoolKey`, `clientPresignatureRefillInFlightByPoolKey`, `foregroundRefillInFlightByPoolKey`, `clientPresignatureHydrationInFlightByPoolKey`, `clientPresignaturePoolGenerationByPoolKey`, and `presignatureMaintenance`) track per-pool state (`L300-L305`, `L620`).
  - `clearClientPresignaturePool(poolKey)` (`L638-L644`) only deletes from `clientPresignaturePool`, `clientPresignaturePoolIdentityByPoolKey`, and `clientPresignatureRefillInFlightByPoolKey`, leaving `foregroundRefillInFlightByPoolKey` and `clientPresignatureHydrationInFlightByPoolKey` stale.
  - `takeClientPresignature` (`L672`) pops a `ClientPresignature` from `available` before `await reserveClientPresignatureInWorker(...)`, during which a concurrent `hydrateClientPresignaturePool` (`L474-L506`) can re-read the handle from the worker as `'available'` and push a duplicate into `available`.
- **Change**:
  - Replace the 7 maps with a single `Map<string, PoolBucketState>` where `PoolBucketState` holds:
    - `generation: number`
    - `identity: ClientPresignaturePoolIdentity | null`
    - `available: ClientPresignature[]`
    - `reservingHandles: Set<string>` (handles currently in-flight to `reserveClientPresignatureInWorker` so `hydrateClientPresignaturePool` skips them)
    - `hydrationInFlight: Promise<void> | null`
    - `backgroundRefillInFlight: Promise<ClientPresignature[]> | null`
    - `foregroundRefillInFlight: Promise<ClientPresignature> | null`
    - `maintenance: PoolMaintenanceMode` (`Variant`-named union: `'idle' | 'scheduled' | 'running'`)
  - Make `clearClientPresignaturePool(poolKey)` and `clearAllClientPresignaturePools()` atomically increment `generation`, cancel any scheduled maintenance timer, and reset all fields of `PoolBucketState`.
- **Verification**:
  - Run existing presignature pool tests and add a test covering concurrent `takeClientPresignature` + `hydrateClientPresignaturePool` and `clearClientPresignaturePool` during in-flight hydration/foreground refill.

#### B3 — Synchronize worker resets with prewarm promises and main-thread handle caches (`workerTransport.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/workerManager/workerTransport.ts`](../packages/wallet/src/core/signingEngine/workerManager/workerTransport.ts)
- **Root Cause**:
  - `terminateWorkerOnly` (`L1079-L1091`) and `resetWorker` (`L1047-L1077`) do not clear `ecdsaRegistrationCryptoPrewarmPromise` (when `ecdsaDerivationClient` resets) or `emailOtpYaoPrewarmPromise` (when `emailOtp` resets).
  - `setWorkerBaseOrigin` (`L243-L257`) clears `emailOtpYaoPrewarmPromise` (`L253`) but forgets `ecdsaRegistrationCryptoPrewarmPromise`.
  - When `ecdsaDerivationClient` or `emailOtp` resets, main-thread handle registries (`linkedEcdsaHolderRuntime`, `Ed25519YaoActiveClientRegistry`, `WalletCustodyEd25519ActiveClientV1`) retain handle IDs pointing to the terminated worker instance.
- **Change**:
  - Store the prewarm state inside `WorkerEntry` (or clear the corresponding prewarm promise in `terminateWorkerOnly` and `setWorkerBaseOrigin`).
  - Register worker-termination invalidation hooks in `terminateWorkerOnly` for `ecdsaDerivationClient` and `emailOtp` alongside the existing `walletCustodyCeremony` hook (`L1088`).
- **Verification**:
  - Add unit tests in `workerTransport` verifying that resetting `ecdsaDerivationClient` or `emailOtp` or changing `workerBaseOrigin` invalidates prewarm promises and cached worker handles.

#### B4 — Serialize worker control channels and close leaked ceremony / reservation windows (`ecdsa-presign-client.worker.ts`, `ecdsa-derivation-client.worker.ts`)
- **Files**:
  - [`packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-presign-client.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-presign-client.worker.ts)
  - [`packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-derivation-client.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-derivation-client.worker.ts)
- **Root Cause**:
  - In `ecdsa-presign-client.worker.ts`, `attachControlChannel` (`L997`) and `enqueueOnlineRequest` (`L892`) execute outside `messageQueue`, and `messageQueue = messageQueue.then(...)` (`L999`) has no `.catch` recovery if a handler throws before posting.
  - In `ecdsa-presign-client.worker.ts`, `reservePresignature` (`L595-L624`) checks `entry.state.kind === 'available'` (`L607`), then awaits `requestOpaqueAuthority(entry.authorityPort, ...)` (`L617`) before mutating `entry.state` to `'reserved'` (`L624`).
  - In `ecdsa-derivation-client.worker.ts`, `persistInitialCanonicalEcdsaActivation` (`L601-L618`) only calls `closeRouterAbEcdsaRegistrationCeremonyState(ceremonyId, active)` in `case 'stored'`, leaking `ceremonyStates.get(ceremonyId)` on `'exact_record_conflict' | 'corrupt' | 'persistence_unavailable'`. Also `enqueueOpaquePresignRequest` (`L3142`) and `attachPresignChannel` (`L3146`) bypass `messageQueue`.
- **Change**:
  - Route `attachControlChannel` and `attachPresignChannel` through `messageQueue` and ensure `messageQueue` always recovers via `.catch(() => undefined)`.
  - Add a `'reserving'` variant to `StoredPresignatureStateV1` in `ecdsa-presign-client.worker.ts` before awaiting `requestOpaqueAuthority`, rolling back to `'available'` only if the authority port call fails and the entry was not cleared.
  - Call `closeRouterAbEcdsaRegistrationCeremonyState(ceremonyId, active)` in a `finally` block (or across all terminal branches) in `persistInitialCanonicalEcdsaActivation`.
- **Verification**:
  - Run ECDSA worker unit tests and add a test for ceremony cleanup on persistence conflict/failure.

#### B5 — Guard `warmSessionPrfHandleCache` update after async seal RPC (`passkey-mpc-session.worker.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/workerManager/workers/passkey-mpc-session.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/passkey-mpc-session.worker.ts)
- **Root Cause**:
  - `runSigningSessionSealAndPersist` (`L1108-L1174`) reads `const entry = activeEntry.entry` (`L1117`), awaits Shamir 3-pass operations and `callSigningSessionSealRoute`, and then unconditionally calls `updateWarmSessionPrfHandlePolicy(thresholdSessionId, entry, policy)` (`L1173`), which inserts `entry` into `warmSessionPrfHandleCache` even if `thresholdSessionId` was cleared or superseded while the RPC was in flight.
- **Change**:
  - In `updateWarmSessionPrfHandlePolicy` (or immediately before calling it at `L1173`), verify that `passkeyPrfFirstHandleStore.get(thresholdSessionId) === entry` and that `entry.prfFirstHandle` is still live in `prfFirstOutputLookup` before writing to `warmSessionPrfHandleCache`.
- **Verification**:
  - Add a unit test verifying that clearing a passkey session while `runSigningSessionSealAndPersist` is in flight does not resurrect the warm session cache entry.

#### B6 — Epoch-guard unlocked Ed25519 export root capability & fold `inFlight` into `NearProvisioningState` (`unlockedEd25519ExportRootCapability.ts`, `nearProvisioningRegistry.ts`)
- **Files**:
  - [`packages/wallet/src/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability.ts`](../packages/wallet/src/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability.ts)
  - [`packages/wallet/src/core/signingEngine/flows/registration/nearProvisioningRegistry.ts`](../packages/wallet/src/core/signingEngine/flows/registration/nearProvisioningRegistry.ts)
- **Root Cause**:
  - In `unlockedEd25519ExportRootCapability.ts`, `establishUnlockedWalletEd25519ExportRootCapabilityV1` (`L268-L315`) awaits `transport.requestOperation` (`L287`) and then assigns `currentCapability = capability` (`L310`). If `destroyUnlockedWalletEd25519ExportRootCapabilitiesV1` ran during the `await`, the newly minted capability is still installed into `currentCapability` instead of being immediately destroyed; if a previous `currentCapability` for a different wallet/method existed, its worker handle is overwritten without being destroyed.
  - In `nearProvisioningRegistry.ts` (`L96-L119`), `publishNearProvisioningState` notifies listeners synchronously before `entry.inFlight = inFlight` is set.
- **Change**:
  - Replace `currentCapability` in `unlockedEd25519ExportRootCapability.ts` with an explicit `CapabilitySlotState` (`'empty' | 'establishing' | 'active'`) tracked with a monotonic `generation` counter. When `destroyUnlockedWalletEd25519ExportRootCapabilitiesV1` increments `generation`, any in-flight `establish` destroys its newly created worker handle upon resolution instead of installing it, and any replaced active handle is destroyed in the worker.
  - In `nearProvisioningRegistry.ts`, assign `entry.inFlight` before notifying listeners when entering `near_provisioning`.
- **Verification**:
  - Add unit tests for concurrent `establish` + `destroy` in `unlockedEd25519ExportRootCapability` and re-entrant listener observation in `nearProvisioningRegistry`.

---

### Batch 2: Nonce Coordinator & Local IndexedDB State (`B7–B8`)

#### B7 — Unify in-memory and durable nonce lease recovery and locking (`NonceCoordinator.ts`, `nearNonceLane.ts`)
- **Files**:
  - [`packages/wallet/src/core/signingEngine/nonce/NonceCoordinator.ts`](../packages/wallet/src/core/signingEngine/nonce/NonceCoordinator.ts)
  - [`packages/wallet/src/core/signingEngine/nonce/nearNonceLane.ts`](../packages/wallet/src/core/signingEngine/nonce/nearNonceLane.ts)
- **Root Cause**:
  - `recoverDurableLeases` (`NonceCoordinator.ts:940-1018`) iterates over durable records in `nonceLaneCoordinationStore`. It deletes invalid or expired `Reserved` leases, and transitions expired `Submitted`/`BroadcastUncertain` leases to `ReconcileRequired`, but for **non-expired** `Reserved` or `Signed` leases it does nothing — leaving them in `nonceLaneCoordinationStore` while in-memory `leases`, `evmState.reserved`, and `nearState.reservedNonces` remain empty.
  - `clearNearAccessKey()` (`NonceCoordinator.ts:1246-1253`) removes NEAR leases from in-memory `this.leases` without deleting their durable records from `nonceLaneCoordinationStore`.
  - `clearForWallet` (`L1421`) and `clearAll` (`L1451`) mutate `this.leases`, `this.evmLanes`, and `this.nearLanes` directly without acquiring `withLaneLock`.
- **Change**:
  - In `recoverDurableLeases`, either hydrate non-expired `Reserved`/`Signed` durable leases into `this.leases` and the corresponding lane's `reserved` set, or transition unhydratable pre-broadcast leases from a prior process instance to `Released` and delete them from `nonceLaneCoordinationStore` so durable and in-memory state are 100% consistent after recovery.
  - Make `clearNearAccessKey`, `clearForWallet`, and `clearAll` serialize through `withLaneLock` and clean up `nonceLaneCoordinationStore`.
- **Verification**:
  - Run `NonceCoordinator` unit tests and add a test verifying that a durable `Reserved` lease from `nonceLaneCoordinationStore` does not desynchronize `leases` / `evmState.reserved` / `nearState.reservedNonces` across `recoverDurableLeases` and `clearNearAccessKey`.

#### B8 — Tighten IndexedDB signer/outbox boundary codecs and `EmailOtpSealedRestoreOrchestrator` parameter passing (`unifiedIndexedDBManager.ts`, `sealedRestoreOrchestrator.ts`)
- **Files**:
  - [`packages/wallet/src/core/indexedDB/unifiedIndexedDBManager.ts`](../packages/wallet/src/core/indexedDB/unifiedIndexedDBManager.ts)
  - [`packages/wallet/src/core/signingEngine/session/emailOtp/sealedRestoreOrchestrator.ts`](../packages/wallet/src/core/signingEngine/session/emailOtp/sealedRestoreOrchestrator.ts)
- **Root Cause**:
  - `AccountSignerRecord` (`unifiedIndexedDBManager.ts:45-77`) and `SignerOpOutboxRecord` (`L112-L133`) are flat interfaces with optional/nullable fields (`removedAtMs`, `supersededByKeyRef`, `nextAttemptAtMs`, `lastErrorCode`) rather than discriminated unions narrowed by `status`.
  - `ReconcileSummary.repairs` (`L787`) is never populated.
  - `EmailOtpSealedRestoreOrchestrator` (`sealedRestoreOrchestrator.ts:82, 97, 261`) stores `requestedChainTarget` on `this` instead of passing `input.chainTarget` to `readEcdsaSealedRecordForTarget`.
- **Change**:
  - Pass `input.chainTarget` directly to `readEcdsaSealedRecordForTarget` in `sealedRestoreOrchestrator.ts` and delete `private requestedChainTarget`.
  - Narrow `AccountSignerRecord` and `SignerOpOutboxRecord` with `Variant` helpers and remove or populate the unused `repairs` field if no caller reads it.
- **Verification**:
  - Run `pnpm type-check` and IndexedDB reconciliation tests.

---

### Batch 3: Wallet Server & Rust/WASM Protocol State Machines (`B9–B16`)

#### B9 — Release `admissionClaims` on `backend_uncertain` in Yao registration (`routerAbEd25519YaoRegistration.ts`)
- **File**: [`packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistration.ts`](../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistration.ts)
- **Root Cause**:
  - In `commitAdmit` (`L692-L738`), when `input.outcome.kind === 'backend_uncertain'` (`L708-L715`), the method returns `{ ok: false, status: 503, code: 'admission_uncertain', ... }` **without** deleting `input.claim.lifecycleId` from `this.admissionClaims`.
  - Because `this.admissionClaims` still holds the claim and `this.lifecycleSessions` has no entry, every subsequent retry of `prepareAdmit` (`L665-L681`) or `prepareExecute` (`L778-L786`) for that `lifecycleId` permanently fails with `409 admission_in_progress`.
  - Furthermore, at `L722-L729`, if `this.states.has(key)` is true, `commitAdmit` also returns `409` without deleting `this.admissionClaims`.
- **Change**:
  - Delete `this.admissionClaims.delete(input.claim.lifecycleId)` when `input.outcome.kind === 'backend_uncertain'` (and on `this.states.has(key)` conflict), or unify `admissionClaims`, `lifecycleSessions`, and `states` into a single `Map<LifecycleId, YaoRegistrationLifecycleEntry>` discriminated union (`'claiming' | 'admitted' | 'executing' | 'completed'`).
- **Verification**:
  - Add a unit test in `packages/wallet-server` verifying that a `503 admission_uncertain` outcome from `admit` allows the caller to retry `admit` with the same `lifecycle_id` and succeed.

#### B10 — Guard sessionless device-linking acknowledgement cleanup batch with `D1_BATCH_CAS_GUARD_SQL` (`d1LinkedDeviceAuthorityInstallService.ts`)
- **File**: [`packages/wallet-server/src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceAuthorityInstallService.ts`](../packages/wallet-server/src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceAuthorityInstallService.ts)
- **Root Cause**:
  - In `commitAcknowledgementCleanupV1` (`L1250-L1302`), `beforeDeleteStatements` transitions `cleanup_state` from `'pending'` to `'allocation_removed'`, and `afterDeleteStatements` transitions `cleanup_state` from `'allocation_removed'` to `'session_removed'` and completes cleanup.
  - When `input.session` is non-null (`L1270`), `deleteActiveSessionWithStatementsV1` guards the batch. When `input.session === null` (`L1288-L1290`), `this.options.database.batch([...beforeDeleteStatements, ...afterDeleteStatements])` runs without `D1_BATCH_CAS_GUARD_SQL` after the `cleanup_state` updates, so a concurrent state change or 0-row update does not trigger the `catch` replay check (`L1291-L1301`).
- **Change**:
  - Interleave `this.options.database.prepare(D1_BATCH_CAS_GUARD_SQL)` after the state-transition `UPDATE` statements in the `input.session === null` batch so any 0-row CAS miss rolls back the batch and enters the `readActivationCleanupReceiptV1` replay verification block.
- **Verification**:
  - Add a test in `packages/wallet-server` covering `commitAcknowledgementCleanupV1` when `input.session === null` under concurrent replay.

#### B11 — Restrict `ExternalAuthStore.revokeSession` to active authenticate sessions (`externalAuthStore.ts`)
- **File**: [`packages/wallet-server/src/auth/externalAuthStore.ts`](../packages/wallet-server/src/auth/externalAuthStore.ts)
- **Root Cause**:
  - `revokeSession` (`L469-L475`) executes:
    ```sql
    UPDATE external_auth_attempts SET status = 'revoked'
    WHERE ${SCOPE} AND session_token_hash = ?5 AND origin = ?6
    ```
    without `AND purpose = 'authenticate' AND status IN ('verified', 'consumed')`.
- **Change**:
  - Add `AND purpose = 'authenticate' AND status IN ('verified', 'consumed')` to `revokeSession` in `externalAuthStore.ts`.
- **Verification**:
  - Add a unit test in `externalAuthStore` verifying that `revokeSession` only transitions `'verified'` or `'consumed'` `'authenticate'` rows to `'revoked'`.

#### B12 — Replace `activationOwner: ''` sentinel and remove write side-effect from `admitHomeRead` (`d1RegistrationCeremonyRecords.ts`, `d1WalletExecutionAuthority.ts`)
- **Files**:
  - [`packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyRecords.ts`](../packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyRecords.ts)
  - [`packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority.ts`](../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority.ts)
- **Root Cause**:
  - `parseD1StoredEvmFamilyEcdsaActivationClaimedBranch` (`L1480`) and `parseD1StoredEvmFamilyEcdsaActivatedBranch` (`L1508`) fall back to `activationOwner: ''` when `record.activationOwner` is absent.
  - In `d1WalletExecutionAuthority.ts`, `admitHomeRead` (`L111-L120`) calls `await this.cancel(input)` inside a read admission check whenever `local.state === 'retired'` and `local.registration_completion === 'cancelled'`. And `cancel` (`L132-L139`) runs `await this.fixCancellation(input)` (which already updates `registration_completion = 'cancelled', state = 'retired'`) followed by a redundant second D1 batch `await this.database.batch(this.prepareState(input, 'retired'))` (`L137`).
- **Change**:
  - Replace `activationOwner: string` (with `''` sentinel) on the parsed TypeScript branch types with an explicit `ActivationOwnershipV1` union (`{ kind: 'owned'; owner: string } | { kind: 'legacy_unowned' }`) while keeping the persisted JSON wire format compatible.
  - In `d1WalletExecutionAuthority.ts`, remove the redundant `await this.database.batch(this.prepareState(input, 'retired'))` from `cancel`, and ensure `prepareState(input.registration, 'active')` explicitly guards `AND registration_completion IN ('pending', 'established')`.
- **Verification**:
  - Run registration ceremony and execution authority unit tests in `packages/wallet-server`.

#### B13 — Preserve live ECDSA presign session on validation/transient errors in Durable Object (`ecdsa_presign_live_session.rs`)
- **File**: [`crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs`](../crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs)
- **Root Cause**:
  - `handle_linked_step` (`L593-L601`) removes `entry` from `sessions` (`sessions.borrow_mut().remove(&input.presign_session_id)`) **before** validating expiry/scope/request digest (`L602-L613`), stage (`L615-L630`), or base64 message payloads (`L632-L634`), and before `persist_linked_terminal_completion` (`L712-L714`).
  - If a malformed request arrives with the wrong stage or bad base64, or if `persist_linked_terminal_completion` hits a transient DO storage error, `entry` is already removed from `sessions` and lost forever.
- **Change**:
  - Inspect and validate `entry` (expiry, scope, request digest, stage, and base64 decoding of `outgoing_messages_b64u`) **before** removing `entry` from `sessions` (removing immediately if `entry.expires_at_ms <= now_unix_ms`).
  - Only remove `entry` once validation succeeds and the cryptographic step is ready to advance; if `entry.session.message(...)` or `start_presign()` fails with a protocol error, drop the poisoned session intentionally.
- **Verification**:
  - Add a Rust unit test in `crates/router-ab-cloudflare` verifying that a stage mismatch or malformed base64 payload does not evict an active non-expired `LiveSession` from `sessions`.

#### B14 — Enforce `row.state == "closed"` on tenant-root restore-session tombstones (`tenant_root_role_d1.rs`)
- **File**: [`crates/router-ab-cloudflare/src/tenant_root_role_d1.rs`](../crates/router-ab-cloudflare/src/tenant_root_role_d1.rs)
- **Root Cause**:
  - `restore_import_session_tombstone_from_row` (`L14930-L15040`) never checks `row.state`.
- **Change**:
  - Check `if row.state.as_deref() != Some("closed") { return Err(store_error("tenant-root restore-session tombstone has invalid state")); }` at the start of `restore_import_session_tombstone_from_row`.
- **Verification**:
  - Run `cargo test -p router-ab-cloudflare` and add a unit test rejecting a tombstone row whose `state` is not `"closed"`.

#### B15 — Distinguish `PresignSessionStage::Poisoned` from `PresignSessionStage::Done` (`session.rs`)
- **File**: [`crates/router-ab-ecdsa-presign/src/session.rs`](../crates/router-ab-ecdsa-presign/src/session.rs)
- **Root Cause**:
  - `ClientPresignSession::stage()` (`L198`) and `SigningWorkerPresignSession::stage()` (`L425`) both map `Done(_) | Poisoned => PresignSessionStage::Done`.
- **Change**:
  - Add `PresignSessionStage::Poisoned` (`as_str() -> "poisoned"`) and map `ClientState::Poisoned` and `SigningWorkerState::Poisoned` to `PresignSessionStage::Poisoned`.
  - Check `progress.event == PresignSessionEvent::PresignDone && progress.stage == PresignSessionStage::Done` in callers (`ecdsa_presign_live_session.rs:646`).
- **Verification**:
  - Run `cargo test -p router-ab-ecdsa-presign` and `cargo test -p router-ab-cloudflare`.

#### B16 — Make WASM ECDSA ceremony mode and pending ordinary export state mutually exclusive (`ceremony.rs`, `ecdsa_role_local.rs`)
- **Files**:
  - [`wasm/router_ab_ecdsa_client/src/ceremony.rs`](../wasm/router_ab_ecdsa_client/src/ceremony.rs)
  - [`wasm/router_ab_ecdsa_client/src/ecdsa_role_local.rs`](../wasm/router_ab_ecdsa_client/src/ecdsa_role_local.rs)
- **Root Cause**:
  - `RouterAbEcdsaClientCeremonyV1` (`ceremony.rs:34-40`) has 4 independent `Option` fields (`registration_binding`, `explicit_export_request_digest`, `activation_refresh_request_digest`, `post_registration_application_binding_digest`), allowing a single ceremony instance to mix registration, explicit export, and activation refresh calls.
  - `EcdsaRoleLocalHolderV1` (`ecdsa_role_local.rs:644-693`) stores 3 parallel `Option<[u8; 32]>` fields (`pending_export_request_digest`, `pending_export_transcript_digest`, `pending_export_application_binding_digest`) that are always set and taken together.
- **Change**:
  - Replace the 4 `Option` fields on `RouterAbEcdsaClientCeremonyV1` with an explicit `CeremonyStateV1` enum (`Unbound { keypair }`, `Registration { keypair, binding }`, `ExplicitExport { keypair, request_digest, application_binding_digest }`, `ActivationRefresh { keypair, request_digest, application_binding_digest }`, `Closed`).
  - Replace the 3 `pending_export_*` `Option` fields on `EcdsaRoleLocalHolderV1` with a single `pending_export: Option<PendingOrdinaryExportV1>`.
- **Verification**:
  - Run `cargo test --manifest-path wasm/router_ab_ecdsa_client/Cargo.toml`.

---

### Batch 4: Host-to-Iframe Transport, Auth Menu, External Wallet Controllers & VoiceID (`B17–B23`)

#### B17 — Unify `WalletIframeRouter` connection readiness and pre-dispatch auth-menu cancellation (`router.ts`)
- **File**: [`packages/wallet/src/SeamsWeb/walletIframe/client/router.ts`](../packages/wallet/src/SeamsWeb/walletIframe/client/router.ts)
- **Root Cause**:
  - `connectAndConfigure` (`L2532-L2568`) sets `this.state.ready = true` (`L2551`) **before** `await this.post({ type: 'PM_SET_CONFIG', ... })` (`L2553`). Any concurrent caller of `post()` checks `if (!this.state.ready || !this.state.port)` (`L4563`) and dispatches its message over the port before `PM_SET_CONFIG` completes.
  - In `openHostedAuthMenu` (`L4232-L4272`), if `cancelHostedAuthMenu` is called while `await this.ensureConfigured()` (`L4246`) is still running, `cancelledHostedAuthMenuSessions` records the session ID, and `this.post(...)` throws `Error('Wallet iframe request was cancelled before dispatch')` (`L4571`), causing `openHostedAuthMenu` to reject instead of returning `{ kind: 'cancelled', authMenuSessionId }`.
- **Change**:
  - Allow only internal configuration handshake messages (`PM_SET_CONFIG`) to bypass `ensureConfigured()` in `post()`, while all normal requests await `ensureConfigured()` (or `init()`) before posting.
  - In `openHostedAuthMenu`, if `this.cancelledHostedAuthMenuSessions.has(normalized.authMenuSessionId)` is true after `await this.ensureConfigured()`, return `{ kind: 'cancelled', authMenuSessionId: normalized.authMenuSessionId }` directly instead of calling `this.post(...)`.
- **Verification**:
  - Run `router.ts` unit tests and add tests for: (1) cancelling `openHostedAuthMenu` while `ensureConfigured()` is in flight, and (2) concurrent RPC calls during `connectAndConfigure()` waiting for `PM_SET_CONFIG`.

#### B18 — Fix `OverlayController.show` `previousMode` check before overwriting `this.mode` (`overlay-controller.ts`)
- **File**: [`packages/wallet/src/SeamsWeb/walletIframe/client/overlay/overlay-controller.ts`](../packages/wallet/src/SeamsWeb/walletIframe/client/overlay/overlay-controller.ts)
- **Root Cause**:
  - In `show(mode)` (`L369-L410`), `this.mode = mode` is assigned at `L376`, and then `L409` checks `else if (!this.mode || !('identity' in this.mode) || identityChanged) dialog.removeAttribute('data-transaction-review')`. Because `this.mode` is already the new `mode`, `this.mode` is never null and `'identity' in this.mode` tests the new mode instead of whether the previous mode had an identity.
- **Change**:
  - Capture `const previousMode = this.mode;` before `this.mode = mode;` and use `previousMode` (or `!('identity' in mode) || !previousMode || !('identity' in previousMode) || identityChanged`) when clearing `data-transaction-review`.
- **Verification**:
  - Add a unit test in `overlay-controller` verifying `data-transaction-review` attribute removal across mode transitions.

#### B19 — Prevent concurrent Google OTP `resend`/`submit` and registration `reroll`/`complete` (`session.ts`)
- **File**: [`packages/wallet/src/SeamsWeb/walletIframe/host/auth-menu/session.ts`](../packages/wallet/src/SeamsWeb/walletIframe/host/auth-menu/session.ts)
- **Root Cause**:
  - `resendGoogleOtp` (`L3438`) only checks `state.viewModel.resendBusy`, and `submitGoogleOtp` (`L3509`) only checks `state.viewModel.submitBusy`.
  - `rerollGoogleRegistration` (`L3588`) only checks `state.viewModel.rerollBusy`, and `completeGoogleRegistration` (`L3661`) only checks `state.viewModel.submitBusy`.
- **Change**:
  - Guard `resendGoogleOtp` and `submitGoogleOtp` on `state.viewModel.resendBusy || state.viewModel.submitBusy` (and likewise guard `rerollGoogleRegistration` and `completeGoogleRegistration` on `state.viewModel.rerollBusy || state.viewModel.submitBusy`).
- **Verification**:
  - Add unit tests in `auth-menu` verifying that `submitGoogleOtp` is a no-op while `resendGoogleOtp` is in flight (and vice versa), and `completeGoogleRegistration` is a no-op while `rerollGoogleRegistration` is in flight.

#### B20 — Transition `emailOtpTargetActivationState` to `'starting'` on initial challenge start (`linkDeviceFlow.ts`)
- **File**: [`packages/wallet/src/SeamsWeb/operations/devices/linkDeviceFlow.ts`](../packages/wallet/src/SeamsWeb/operations/devices/linkDeviceFlow.ts)
- **Root Cause**:
  - `prepareTargetEmailOtpActivationV1` (`L611-L612`) sets `this.emailOtpTargetActivationState = { kind: 'available', context: baseContext }` and calls `await this.startTargetEmailOtpChallengeV1(baseContext)` directly instead of `await this.sendTargetEmailOtpCodeV1()`, leaving `emailOtpTargetActivationState.kind === 'available'` while the challenge request is in flight.
- **Change**:
  - Call `await this.sendTargetEmailOtpCodeV1()` at `L612` so `this.emailOtpTargetActivationState` transitions to `{ kind: 'starting', context: baseContext, promise }` and deduplicates any concurrent `sendCode()` call.
- **Verification**:
  - Run `linkDeviceFlow` unit tests.

#### B21 — Fold `maxPending` into `WithdrawPanel` `FormState` (`WithdrawPanel.tsx`)
- **File**: [`packages/wallet/src/react/components/AccountMenuButton/assets/WithdrawPanel.tsx`](../packages/wallet/src/react/components/AccountMenuButton/assets/WithdrawPanel.tsx)
- **Root Cause**:
  - `maxPending` (`L85`) is a separate boolean from `state: FormState` (`L84`), so `busy` (`L98`) does not block `review()` while `fillMax()` is awaiting `prepare(...)`.
- **Change**:
  - Replace `maxPending` with `{ readonly kind: 'pricing_max' }` in `FormState` and include `state.kind === 'pricing_max'` in `busy`.
- **Verification**:
  - Run `WithdrawPanel` / account menu component tests and `pnpm type-check`.

#### B22 — Preserve connection on rejected `switchChain` in `ExternalEvmController` and fold `pending` in `ExternalNearController` (`externalEvm/controller.ts`, `externalNear/controller.ts`)
- **Files**:
  - [`packages/wallet/src/externalEvm/controller.ts`](../packages/wallet/src/externalEvm/controller.ts)
  - [`packages/wallet/src/externalNear/controller.ts`](../packages/wallet/src/externalNear/controller.ts)
- **Root Cause**:
  - In `externalEvm/controller.ts`, `switchChain` (`L455-L460`) calls `this.disconnect()` when `observed.value.chainId !== configuredChain.chainId`. If the wallet stayed connected on its previous chain, calling `this.disconnect()` destroys the active connection instead of publishing the observed connected chain and returning `unsupported_chain`.
  - In `externalNear/controller.ts`, `connect` (`L123-L126`) tracks `this.pending` alongside `this.snapshot.connection`.
- **Change**:
  - In `externalEvm/controller.ts`, when `observed.value.chainId !== configuredChain.chainId` while the account is still authorized (`L455-L460`), publish the observed connected state (`connectedExternalEvm(...)`) rather than disconnecting, and return `externalEvmFailure('unsupported_chain', 'The wallet did not switch to the requested network.')`.
  - In `externalNear/controller.ts`, ensure `connect` and `disconnect` transitions update `pending` and `connection` through a single state transition helper.
- **Verification**:
  - Run `externalEvm` and `externalNear` unit tests.

#### B23 — Fix `BrowserInferenceAsset` failure notification and `VoiceRibbon.succeed` in `'segments'` mode (`inference.ts`, `ribbon.ts`, `microphone.ts`)
- **Files**:
  - [`packages/voiceid/src/browser/inference.ts`](../packages/voiceid/src/browser/inference.ts)
  - [`packages/voiceid/src/browser/ribbon.ts`](../packages/voiceid/src/browser/ribbon.ts)
  - [`packages/voiceid/src/browser/microphone.ts`](../packages/voiceid/src/browser/microphone.ts)
- **Root Cause**:
  - In `inference.ts` (`L39-L58`), `BrowserInferenceAsset` caches `bytes: ArrayBuffer` only via the `Promise<ArrayBuffer>` in `this.pending` and resets `this.progress = { kind: 'checking_cache' }` on error without notifying active listeners.
  - In `ribbon.ts` (`L152-L160`), `succeed(begin)` waits for `this.stage.kind === 'spin'` to call `this.beginSuccess(...)`. When `this.checking === 'segments'` (`L136`), `this.stage` is `{ kind: 'segments', ... }` which never transitions to `'spin'` (`L270-L285`), so `begin` is never called during `succeed()`.
- **Change**:
  - In `ribbon.ts`, handle `this.stage.kind === 'segments'` in `succeed(begin)` (invoking `begin()` and settling cleanly when checking uses `'segments'`).
  - In `inference.ts`, represent asset state explicitly (`'idle' | 'loading' | 'ready'`) so `failed` transitions cleanly back to `'idle'`.
- **Verification**:
  - Run `packages/voiceid` unit tests.

---

## Verification Gate for Every Batch

Before committing each batch on `implicit-state-machines`:

1. `pnpm type-check`
2. Targeted Vitest suites for modified TypeScript packages (`pnpm --filter @seams/wallet test ...`, `pnpm --filter @seams/wallet-server test ...`, `pnpm --filter @seams/voiceid test ...`)
3. Targeted Cargo tests for modified Rust crates (`cargo test -p router-ab-ecdsa-presign`, `cargo test -p router-ab-cloudflare`, `cargo test --manifest-path wasm/router_ab_ecdsa_client/Cargo.toml`)
4. `pnpm report:bloat --check`
