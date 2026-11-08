# Plan: Implicit State Machine Hardening

## Purpose and Scope

This document records the source-verified audit of implicit state machines across `seams-wallet` and the phased refactor plan to replace ad-hoc boolean flags, parallel `Map`s, nullable field bags, and unguarded transitions with explicit discriminated unions and atomic transition helpers.

Every candidate finding from the initial repository scan was checked directly against the current source on `dev` (`470fbdba5`) before inclusion. Batch 1 (`B1–B6`) was checked a second time against `e82d630a3` on 2026-11-08. That check corrected names and line numbers, narrowed four items, and withdrew most of B4. Following [`docs/debugging-method.md`](./debugging-method.md):

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
| **B1** | [`readiness.ts`](../packages/wallet/src/core/signingEngine/session/availability/readiness.ts) (`L59-L62`, `L162-L178`, `L731-L760`) & [`SigningSessionCoordinator.ts`](../packages/wallet/src/core/signingEngine/session/SigningSessionCoordinator.ts) (`L429-L439`) | `DiscoveredSigningSessionLane.backing: 'touch_confirm' \| 'email_otp_worker' \| 'record_policy'` | `buildDiscoveredLaneForRuntime` (`L175`) is the sole constructor and hardcodes `backing: 'record_policy'`. In `clearWalletSession`, `if (lane.backing === 'record_policy') continue;` (`L732`) always skips the calls to `clearEmailOtpWarmSessionMaterial` (`L738`) and `touchConfirm.clearVolatileWarmSessionMaterial` (`L747`). The only caller, `SigningSessionCoordinator.clear`, has no caller in `packages/wallet/src` and discards the result. | **Confirmed dead code** | Batch 1 |
| **B2** | [`presignaturePool.ts`](../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts) (`L299-L305`, `L321-L364`, `L431-L517`, `L637-L643`, `L1424-L1590`) | 6 module-level `Map<string, ...>` keyed by `poolKey`, plus `presignatureMaintenance` (`L672`) | `clearClientPresignaturePool` (`L637-L643`) leaves `clientPresignatureHydrationInFlightByPoolKey`, `foregroundRefillInFlightByPoolKey` and `presignatureMaintenance` populated. The next `hydrateClientPresignaturePool` (`L444-L447`) joins the stale-generation hydration and returns with no new handles. `popClientPresignature` (`L321-L334`) removes a handle before `reserveClientPresignature` (`L1567`); a concurrent hydration can push the same handle back. The worker reservation rejects the second claim (`claimed_elsewhere`, `L1577-L1590`), so the duplicate costs a retry from `MAX_CLIENT_PRESIGNATURE_CLAIM_RETRIES` (`L299`), not a double use. | **Confirmed defect (narrowed)** | Batch 1 |
| **B3** | [`workerTransport.ts`](../packages/wallet/src/core/signingEngine/workerManager/workerTransport.ts) (`L243-L257`, `L290-L350`, `L1047-L1091`) | `workers: Map<WorkerKind, WorkerEntry>` + 2 prewarm promises | A succeeded `ecdsaRegistrationCryptoPrewarmPromise` or `emailOtpYaoPrewarmPromise` survives `resetWorker` / `terminateWorkerOnly`, so a later prewarm returns at once and does not warm the new worker. `setWorkerBaseOrigin` (`L253`) clears only `emailOtpYaoPrewarmPromise`. The effect is speed only: lazy init still runs on first use. | **Confirmed defect (narrowed)** | Batch 1 |
| **B4** | [`ecdsa-presign-client.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-presign-client.worker.ts) & [`ecdsa-derivation-client.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-derivation-client.worker.ts) | `messageQueue` + `opaqueMaterials` + `routerAbEcdsaRegistrationCeremonies` | Withdrawn except one optional defensive change. See [Withdrawn and Narrowed Findings](#withdrawn-and-narrowed-findings), item 5. | **Withdrawn (mostly)** | Batch 1 (optional) |
| **B5** | [`passkey-mpc-session.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/passkey-mpc-session.worker.ts) (`L665-L669`, `L700-L719`, `L1108-L1174`) | `warmSessionPrfHandleCache` (keyed by `thresholdSessionId`) + `passkeyPrfFirstHandleStore` (keyed by `prfFirstHandle`) | `runSigningSessionSealAndPersist` captures `entry` (`L1117`), awaits the seal preparation and `callSigningSessionSealRoute`, then calls `updateWarmSessionPrfHandlePolicy` (`L1173`), which always runs `warmSessionPrfHandleCache.set(thresholdSessionId, ...)` (`L717`). If the session was cleared during the awaits, the cache gets an entry whose secret is gone. If a newer entry replaced it, the old handle overwrites the newer entry. On a policy failure, `deleteWarmSessionPrfHandle(thresholdSessionId)` (`L1170`) deletes whatever entry is current, including a newer one. | **Confirmed defect** | Batch 1 |
| **B6** | [`unlockedEd25519ExportRootCapability.ts`](../packages/wallet/src/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability.ts) (`L44-L47`, `L268-L316`, `L375-L397`) & [`nearProvisioningRegistry.ts`](../packages/wallet/src/core/signingEngine/flows/registration/nearProvisioningRegistry.ts) (`L64-L73`, `L88-L119`) | Module-level `currentCapability` singleton; `{ state, inFlight }` entries + `listeners` | The ceremony worker runs one message at a time (`wallet-custody-ceremony.worker.ts:L1271-L1290`) and destroys the previous handle for the same wallet (`L869`). Two gaps remain on the main thread. (1) If `destroyUnlockedWalletEd25519ExportRootCapabilitiesV1` runs while an establish is in flight, the destroy clears the local reference first, then the establish installs a handle that the worker destroyed next (`L310`). (2) A capability for a different wallet is replaced locally but stays in the worker until expiry. In `nearProvisioningRegistry.ts`, `runSingleFlightNearProvisioning` publishes `near_provisioning` (`L95-L98`) before `entry.inFlight = inFlight` (`L118`), so a listener that calls it again starts a second attempt. | **Confirmed defect (narrowed)** | Batch 1 |
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

Before writing code, we verified every candidate from the initial exploration against the actual source files. The following claims were **refuted or narrowed** and will **not** be treated as bugs. Items 5 and 6 come from the second Batch 1 check:

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
5. **Withdrawn (mostly) — B4 ECDSA worker queue, reservation and ceremony leak**:
   - *Initial claim*: `attachControlChannel` and `attachPresignChannel` must go through `messageQueue`; `messageQueue` needs `.catch` recovery; `reservePresignature` needs a `'reserving'` state; `persistInitialCanonicalEcdsaActivation` leaks the ceremony on failure.
   - *Measured fact — queueing the attach is unsafe*: `replaceAuthorityChannel` runs `purgeAuthorityPort` (`ecdsa-presign-client.worker.ts:L132-L142`), which rejects requests pending on the old port. If the attach waited behind a queued request that is blocked on the dead old port, nothing would reject that request and the queue would stop. The attach must stay outside the queue.
   - *Measured fact — the `.catch` is not needed*: `handleRpcRequest` (`L896-L993`) catches every error and posts it, so the `messageQueue` chain does not reject.
   - *Measured fact — no current reservation race*: `reservePresignature` (`L549-L640`) is called only from `handleRpcRequest` (`L965`), which `messageQueue` runs one at a time. The online port path acts only on `'committed'` entries (`L806`). An attach during the restore await rejects the pending restore, so the reservation fails closed.
   - *Measured fact — callers close the ceremony*: on any persistence failure the main thread throws and calls `closeStrictEcdsaRegistrationCeremony` (`registrationStrictEcdsa.ts:L524`, `registration.ts:L1095`, `registration.ts:L2191`), which sends `CloseRouterAbEcdsaRegistrationCeremony` to the worker.
   - *What remains*: an optional worker-side `closeRouterAbEcdsaRegistrationCeremonyState` on the three failure branches. Do it only if it adds no net lines: `ecdsa-derivation-client.worker.ts` has 3,223 lines, so every new line raises `linesInFilesOver2000`.
6. **Narrowed — B3 main-thread handle registries**:
   - *Initial claim*: resetting `ecdsaDerivationClient` or `emailOtp` leaves `linkedEcdsaHolderRuntime`, `Ed25519YaoActiveClientRegistry` and `WalletCustodyEd25519ActiveClientV1` with handles to a terminated worker.
   - *Measured fact*: no failure was measured. `Ed25519YaoActiveClientRegistry.resolve` already drops a disposed client (`yaoActiveClientRegistry.ts:L194-L201`). Yao clients also run on the iframe main thread and in other workers (`docs/browser-workers.md`), so a worker reset is not the only owner. A hook from `workerTransport.ts` into `SeamsWeb` registries would also make core code depend on `SeamsWeb`.
   - *Decision*: no invalidation hooks in Batch 1. Add one only after a test shows that a stale handle passes a check it should fail. If one is needed, use a termination subscription on the transport, not a direct import.

---

## Phased Execution Plan

### Batch 1: Browser Core Session Readiness, Presignature Pool & Worker Lifecycles (`B1–B6`)

Order of work: B5, B6, B3, B2, B1, then the optional part of B4. Each item is a separate commit.

#### B5 — Compare-and-set the warm session cache after the async seal (`passkey-mpc-session.worker.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/workerManager/workers/passkey-mpc-session.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/passkey-mpc-session.worker.ts)
- **Root Cause**:
  - `runSigningSessionSealAndPersist` (`L1108-L1174`) reads `entry` at `L1117`, then awaits the seal preparation and `callSigningSessionSealRoute`.
  - After the awaits, `updateWarmSessionPrfHandlePolicy` (`L700-L719`) always writes `warmSessionPrfHandleCache.set(thresholdSessionId, ...)`. On a policy failure, `deleteWarmSessionPrfHandle(thresholdSessionId)` (`L665-L669`, called at `L1170`) deletes the current entry.
  - Both writes act on whatever entry is current, not on the entry that the seal started with.
- **Change**:
  - Before either write, check that `warmSessionPrfHandleCache.get(thresholdSessionId)?.prfFirstHandle === entry.prfFirstHandle`. For the update, also check that `passkeyPrfFirstHandleStore.has(entry.prfFirstHandle)`. Note that `passkeyPrfFirstHandleStore` is keyed by `prfFirstHandle`, not by `thresholdSessionId`.
  - Put the check in one helper that both paths use. If the check fails, return the same "session unavailable" result that `readWarmSessionMaterialEntry` returns for a missing session.
- **Verification**:
  - Test that a clear during the seal does not put an entry back in the cache.
  - Test that a newer entry for the same `thresholdSessionId` survives both the update path and the policy-failure path of an older seal.

#### B6 — Generation-guard the export-root capability and set `inFlight` before notify (`unlockedEd25519ExportRootCapability.ts`, `nearProvisioningRegistry.ts`)
- **Files**:
  - [`packages/wallet/src/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability.ts`](../packages/wallet/src/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability.ts)
  - [`packages/wallet/src/core/signingEngine/flows/registration/nearProvisioningRegistry.ts`](../packages/wallet/src/core/signingEngine/flows/registration/nearProvisioningRegistry.ts)
- **Root Cause**:
  - The ceremony worker runs one message at a time and destroys the previous handle for the same wallet (`wallet-custody-ceremony.worker.ts:L869`, `L1271-L1290`). The gaps are on the main thread only.
  - `destroyUnlockedWalletEd25519ExportRootCapabilitiesV1` (`L375-L397`) clears the local reference at once. An establish that was already in flight then installs its handle (`L310`), which the queued destroy removes in the worker next. The main thread keeps a reference to a destroyed handle.
  - When an establish replaces a capability for a different wallet, the old handle stays in the worker until it expires.
  - In `nearProvisioningRegistry.ts`, `runSingleFlightNearProvisioning` publishes `near_provisioning` (`L95-L98`) before it sets `entry.inFlight` (`L118`). A listener that calls `runSingleFlightNearProvisioning` from inside the notify starts a second attempt.
- **Change**:
  - Record each establish in flight with its `walletId` and `walletSessionId`. A destroy marks every record that its scope covers as cancelled. A cancelled establish does not install the result and sends a `capability` scope destroy for the new handle. A destroy for another wallet does not cancel an unrelated establish, which a single generation counter would do.
  - When an establish replaces a capability for a different wallet, send a `capability` scope destroy for the old handle.
  - No three-state slot is needed: the generation counter and the existing `currentCapability` cover the states.
  - In `nearProvisioningRegistry.ts`, create the in-flight promise and assign `entry.inFlight` before the `near_provisioning` publish. Start `args.attempt()` only after that assignment.
- **Verification**:
  - Test a destroy while an establish is in flight: the read returns `undefined`, and the worker gets a destroy for the new handle.
  - Test that a listener that calls `runSingleFlightNearProvisioning` from inside the notify joins the first attempt.

#### B3 — Reset prewarm promises with their worker (`workerTransport.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/workerManager/workerTransport.ts`](../packages/wallet/src/core/signingEngine/workerManager/workerTransport.ts)
- **Root Cause**:
  - `prewarmEcdsaRegistrationCrypto` (`L290-L306`) and `prewarmEmailOtpYao` (`L324-L350`) keep a succeeded promise for the life of the transport.
  - `terminateWorkerOnly` (`L1079-L1091`) does not clear either promise. `setWorkerBaseOrigin` (`L250-L257`) clears only `emailOtpYaoPrewarmPromise`.
  - After a reset, a prewarm call returns at once and the new worker stays cold. Lazy init still runs on first use, so the effect is speed only.
- **Change**:
  - In `terminateWorkerOnly`, clear `ecdsaRegistrationCryptoPrewarmPromise` for `ecdsaDerivationClient` and `emailOtpYaoPrewarmPromise` for `emailOtp`.
  - Remove the separate clear from `setWorkerBaseOrigin`, because it resets every worker through `terminateWorkerOnly`.
  - The main-thread handle registries are out of scope. See [Withdrawn and Narrowed Findings](#withdrawn-and-narrowed-findings), item 6.
- **Verification**:
  - Test that a prewarm after a reset of `ecdsaDerivationClient` or `emailOtp`, or after a `setWorkerBaseOrigin` change, sends a new prewarm request.

#### B2 — Reset all per-pool state on clear and skip handles that are being reserved (`presignaturePool.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts`](../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts)
- **Root Cause**:
  - `clearClientPresignaturePool` (`L637-L643`) bumps the generation, but leaves `clientPresignatureHydrationInFlightByPoolKey`, `foregroundRefillInFlightByPoolKey` and `presignatureMaintenance` populated.
  - `hydrateClientPresignaturePool` (`L431-L457`) joins any hydration in flight. After a clear, it joins the stale-generation hydration, which only destroys its handles (`L486-L497`). The caller then finds an empty pool.
  - `popClientPresignature` (`L321-L334`) removes a handle before `reserveClientPresignature` (`L1567`). Between the two, a concurrent hydration can list the handle as available and push it back (`L499-L516`). The worker reservation is authoritative and returns `claimed_elsewhere` (`L1577-L1590`), so the duplicate costs a retry, not a double use.
- **Change**:
  - Key the hydration in-flight map by pool key and generation, or delete its entry on clear, so a hydration after a clear starts fresh.
  - Make `clearClientPresignaturePool` call `stopPresignatureMaintenance(poolKey)` and delete the foreground refill count.
  - Track handles that are taken but not yet reserved in a per-pool `Set`. `pushClientPresignature` returns `'duplicate'` for them. Remove the handle from the set when the reservation settles.
  - Do not merge the maps into one `PoolBucketState` in this batch. The file has 1,959 lines. Do that merge only after a split along a real seam, such as moving maintenance scheduling (`L657-L770`) to its own module.
- **Verification**:
  - Test that a hydration after a clear stores the new handles.
  - Test that a hydration during a reservation does not push the handle being reserved.

#### B1 — Remove the unreachable wallet session clear path (`readiness.ts`, `SigningSessionCoordinator.ts`)
- **Files**:
  - [`packages/wallet/src/core/signingEngine/session/availability/readiness.ts`](../packages/wallet/src/core/signingEngine/session/availability/readiness.ts)
  - [`packages/wallet/src/core/signingEngine/session/SigningSessionCoordinator.ts`](../packages/wallet/src/core/signingEngine/session/SigningSessionCoordinator.ts)
- **Root Cause**:
  - `DiscoveredSigningSessionLane.backing` (`L59-L62`) is always `'record_policy'` (`L175`). So `clearWalletSession` (`L731-L760`) always skips `clearEmailOtpWarmSessionMaterial` and `touchConfirm.clearVolatileWarmSessionMaterial`.
  - `clearWalletSession` does not delete an IndexedDB record. Its only work that runs is the status override delete.
  - Its only caller, `SigningSessionCoordinator.clear` (`L429-L439`), has no caller in `packages/wallet/src` and discards the `WalletSessionClearResult`.
- **Change**:
  - First, check that `clear` is not reachable from a published `.d.ts` entry point and has no use in `seams-monorepo`. `SigningSessionCoordinator.d.ts` is emitted, so check the entry points, not only the file.
  - If it is unreachable, delete `SigningSessionCoordinator.clear`, `clearWalletSession`, `WalletSessionClearResult` users that become dead, and the `backing` field. Update `readiness.typecheck.ts`.
  - If it is reachable, delete `backing` and dispatch on `lane.source` (`email_otp` or `passkey`), as `clientSessionExpiryInvalidator.ts` (`L73-L94`) does on `lane.auth.kind`.
- **Verification**:
  - Delete path: `pnpm type-check` and `pnpm report:bloat --check`.
  - Fix path: a test that `clear` calls `clearEmailOtpWarmSessionMaterial` for an `email_otp` lane and `touchConfirm.clearVolatileWarmSessionMaterial` for a `passkey` lane.

#### B4 — Optional: close the registration ceremony in the worker on persistence failure (`ecdsa-derivation-client.worker.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-derivation-client.worker.ts`](../packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-derivation-client.worker.ts)
- **Root Cause**: the callers already close the ceremony on failure. The rest of the original B4 is withdrawn. See [Withdrawn and Narrowed Findings](#withdrawn-and-narrowed-findings), item 5.
- **Change**: in `persistInitialCanonicalEcdsaActivation` (`L547-L617`), call `closeRouterAbEcdsaRegistrationCeremonyState(ceremonyId, active)` once before the `switch` on `stored.kind`, so all four results close it. Do this only if the file does not grow.
- **Verification**: run the registration contract tests that cover ECDSA activation.

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
2. Targeted unit tests for modified TypeScript code. `packages/wallet`, `packages/wallet-server` and `packages/voiceid` have no `test` script. Wallet unit tests live in `tests/unit/*.unit.test.ts` and run with Playwright: `pnpm -C tests test:wallet-unit` (or `pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts unit/<file>` for one file). `tests/unit` is not type-checked, so run each new test.
   - No unit test covers a Batch 1 module today, so each Batch 1 item adds its test file.
   - Test through the exports that exist. A new export that only a test uses raises `testOnlyExports`. The check does not ratchet that measure, but `AGENTS.md` says to export only what another file uses. Worker files have no exports, so move worker logic to a module that the worker imports (as `passkeyMpcSession/warmSessionPrfHandles.ts` does), or drive the transport with a fake `Worker` (as `tests/unit/workerTransportPrewarm.unit.test.ts` does).
3. Targeted Cargo tests for modified Rust crates (`cargo test -p router-ab-ecdsa-presign`, `cargo test -p router-ab-cloudflare`, `cargo test --manifest-path wasm/router_ab_ecdsa_client/Cargo.toml`)
4. `pnpm report:bloat --check`
