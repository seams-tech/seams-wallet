# Plan: Implicit State Machine Hardening

## Purpose and Scope

This document records the source-verified audit of implicit state machines across `seams-wallet` and the phased refactor plan to replace ad-hoc boolean flags, parallel `Map`s, nullable field bags, and unguarded transitions with explicit discriminated unions and atomic transition helpers.

Every candidate finding from the initial repository scan was checked directly against the current source on `dev` (`470fbdba5`) before inclusion. Batch 1 (`B1–B6`) was checked a second time against `e82d630a3` on 2026-11-08. That check corrected names and line numbers, narrowed four items, and withdrew most of B4. Batch 2 (`B7–B8`) was checked a second time against `e710e608f` on the same day. That check withdrew B7 and narrowed B8 to one cleanup. Batch 3 (`B9–B16`) was checked a second time against `8c7a8ac7c`. That check withdrew B11, B13, B14 and B15, narrowed B10, B12 and B16, and left B9 for a design decision. Batch 4 (`B17–B23`) was checked a second time against `4f36c5ac8`. That check withdrew B17, B20, B23 and the NEAR part of B22, reduced B18 to a cleanup, and narrowed B19. Following [`docs/debugging-method.md`](./debugging-method.md):

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
| **B7** | [`NonceCoordinator.ts`](../packages/wallet/src/core/signingEngine/nonce/NonceCoordinator.ts) (`L308-L380`, `L874-L1018`, `L1246-L1253`, `L1421-L1464`) | In-memory `leases` + durable `nonceLaneCoordinationStore`, shared by every tab of the origin | Withdrawn. Every reservation reads the durable records directly, and `Reserved`/`Signed` records expire by TTL. See [Withdrawn and Narrowed Findings](#withdrawn-and-narrowed-findings), item 7. | **Withdrawn** | Batch 2 |
| **B8** | [`sealedRestoreOrchestrator.ts`](../packages/wallet/src/core/signingEngine/session/emailOtp/sealedRestoreOrchestrator.ts) (`L82`, `L97`, `L258-L264`) | Mutable `requestedChainTarget` field | `tryRestoreEcdsaWarmSessionStatusFromSealedRecord` writes `requestedChainTarget` (`L97`) only so that `readEcdsaSealedRecord` (`L258-L264`) can read it before its first await. There is no race, but the field and the wrapper are not needed. The `unifiedIndexedDBManager.ts` part is withdrawn: see item 8. | **Cleanup (narrowed)** | Batch 2 |
| **B9** | [`routerAbEd25519YaoRegistration.ts`](../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistration.ts) (`L655-L738`) & [`routerAbEd25519YaoRegistrationTwoPhaseRunner.ts`](../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationTwoPhaseRunner.ts) (`L80-L113`) | `admissionClaims` + D1-persisted claim | On the live route, the two-phase runner persists the claim before the backend call and returns `backend_uncertain` without calling `commitAdmit`. The claim stays on purpose ("so a caller can reconcile"), but no reconciliation exists, so the lifecycle stays claimed and blocks relocation retire. The plan's delete in `commitAdmit` does not touch this path and would allow a double admit. | **Needs design decision** | Batch 3 (deferred) |
| **B10** | [`d1LinkedDeviceAuthorityInstallService.ts`](../packages/wallet-server/src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceAuthorityInstallService.ts) (`L1239-L1302`) | Sessionless D1 cleanup batch | When the durable session row is absent, the batch runs with no CAS guard. If a concurrent acknowledgement already committed, every statement matches 0 rows, the batch commits as a no-op, and the `catch` receipt check (`assertAcknowledgementMatchesCleanupReceipt`) never runs. The session path guards every statement. | **Confirmed defect (narrowed)** | Batch 3 |
| **B11** | [`externalAuthStore.ts`](../packages/wallet-server/src/auth/externalAuthStore.ts) (`L469-L475`) | `revokeSession` UPDATE | Withdrawn: the plan's guard would let a `prepared` login survive logout. See item 9. | **Withdrawn** | Batch 3 |
| **B12** | [`d1WalletExecutionAuthority.ts`](../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority.ts) (`L132-L139`) | `cancel` = `fixCancellation` + second batch | The second batch `prepareState(input, 'retired')` updates the same row that `fixCancellation` already set to `retired`; it is left over from before `88ef65177`. The `activationOwner: ''` sentinel and the `cancel` call in `admitHomeRead` stay: see item 10. | **Cleanup (narrowed)** | Batch 3 |
| **B13** | [`ecdsa_presign_live_session.rs`](../crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs) (`L534-L601`) | Linked presign live session | Withdrawn: the remove after the authority check is deliberate single-use behavior. See item 11. | **Withdrawn** | Batch 3 |
| **B14** | [`tenant_root_role_d1.rs`](../crates/router-ab-cloudflare/src/tenant_root_role_d1.rs) (`L4343-L4351`, `L14930`) | Restore-import tombstone row | Withdrawn: the row and the table have no `state` column; a row exists only for a closed session. See item 11. | **Withdrawn** | Batch 3 |
| **B15** | [`session.rs`](../crates/router-ab-ecdsa-presign/src/session.rs) (`L198`, `L425`) | `stage()` maps `Poisoned` to `Done` | Withdrawn: every caller stops on the `Err` that poisons the session, and the output read still fails closed. A new stage value would change what the WASM client sends. See item 11. | **Withdrawn** | Batch 3 |
| **B16** | [`ceremony.rs`](../wasm/router_ab_ecdsa_client/src/ceremony.rs) (`L34-L145`) | 4 `Option` fields on one ceremony | Only `build_registration_request` refuses a second build. `build_explicit_export_request` and `build_activation_refresh_request` check nothing, so in Rust one instance can mix modes. The worker makes one instance per ceremony and calls one builder, so no current caller mixes them. The holder struct is `EcdsaLinkedHolderMaterialV1`, and its three fields are always set and taken together. | **Latent gap (narrowed)** | Batch 3 |
| **B17** | [`router.ts`](../packages/wallet/src/SeamsWeb/walletIframe/client/router.ts) (`L2532-L2568`, `L4232-L4272`) | `state.ready` / `configured` + cancel set | Withdrawn: `PM_SET_CONFIG` reaches the port in the same tick as `ready = true`, and the host applies it before its first await; a cancel before dispatch rejects by design. See item 12. | **Withdrawn** | Batch 4 |
| **B18** | [`overlay-controller.ts`](../packages/wallet/src/SeamsWeb/walletIframe/client/overlay/overlay-controller.ts) (`applyVisible`, `L327-L410`) | `mode` + `data-transaction-review` | Withdrawn: `identityChanged` is computed from the previous mode before `this.mode = mode`, so the attribute is right. The two other terms of the condition are always false; they are deleted as a cleanup. See item 12. | **Cleanup only** | Batch 4 |
| **B19** | [`session.ts`](../packages/wallet/src/SeamsWeb/walletIframe/host/auth-menu/session.ts) (`L3507`, `L3586`) | `submitBusy` / `resendBusy` / `rerollBusy` | The Resend and reroll buttons already check both flags. But Enter in the OTP input, or a typed sixth digit, calls `submitGoogleOtp` during a resend; the flow then refuses the submit and shows a confusing error. A reroll during completion is not reachable from the UI, but would register the old wallet id and show the new one. | **Confirmed defect (narrowed)** | Batch 4 |
| **B20** | [`linkDeviceFlow.ts`](../packages/wallet/src/SeamsWeb/operations/devices/linkDeviceFlow.ts) (`prepareTargetEmailOtpActivation`, `L556-L613`) | `emailOtpTargetActivationState` | Withdrawn: `sendCode` reaches the integrator only through a notify that runs after the first start resolves. See item 12. | **Withdrawn** | Batch 4 |
| **B21** | [`SendPanel.tsx`](../packages/wallet/src/react/components/AccountMenuButton/assets/SendPanel.tsx) (`L93-L170`; Refactor 220 replaced `WithdrawPanel.tsx`) | `state: FormState` + `maxPending` | `busy` ignored `maxPending`, so the user could submit while the Max fee probe ran; the probe result then reset the form to `editing` with the max amount while the old amount was being sent, and a second submit was possible. | **Confirmed defect** | Batch 4 |
| **B22** | [`externalEvm/controller.ts`](../packages/wallet/src/externalEvm/controller.ts) (`switchChain`, `L390-L475`) | Snapshot after a switch | A resolved switch that leaves the wallet on another chain disconnected it, though `connect` and `chainChanged` keep a connection on an unconfigured chain and the React view offers a switch for it. A rejected switch never disconnected. The NEAR `pending` part is withdrawn: every change is published at once as `busy`. | **Confirmed defect (narrowed)** | Batch 4 |
| **B23** | [`inference.ts`](../packages/voiceid/src/browser/inference.ts), [`ribbon.ts`](../packages/voiceid/src/browser/ribbon.ts), [`microphone.ts`](../packages/voiceid/src/browser/microphone.ts) | VoiceID progress and ribbon stages | Withdrawn: the only progress listener ignores `checking_cache` and every caller gets the shared rejection; `succeed` never runs in segments mode. See item 12. | **Withdrawn** | Batch 4 |

---

## Withdrawn and Narrowed Findings

Before writing code, we verified every candidate from the initial exploration against the actual source files. The following claims were **refuted or narrowed** and will **not** be treated as bugs. Items 5 and 6 come from the second Batch 1 check, items 7 and 8 from the second Batch 2 check, items 9 to 11 from the second Batch 3 check, and item 12 from the second Batch 4 check:

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
7. **Withdrawn — B7 nonce lease recovery and clears**:
   - *Initial claim*: `recoverDurableLeases` leaves non-expired `Reserved`/`Signed` durable records out of the in-memory lease maps; `clearNearAccessKey` keeps durable records; `clearForWallet` and `clearAll` run outside `withLaneLock`.
   - *Measured fact — the durable records are cross-tab reservations*: `readActiveEvmLeaseNonces` and `readActiveNearLeaseNonces` (`NonceCoordinator.ts:L337-L380`) add every active durable record to the set of used nonces on each reservation. A record may belong to another live tab of the same origin. Loading it into this tab's `leases` would take over that tab's lease, and releasing it would let this tab reuse a nonce that the other tab holds.
   - *Measured fact — stale records heal*: `isActiveCoordinationLeaseRecord` (`nonceLeaseState.ts:L214-L224`) counts `Reserved` and `Signed` records only until `expiresAtMs`, and `readCoordinationLaneRecords` prunes expired records first. A record that `clearNearAccessKey` leaves behind blocks its nonce until it expires, which is safe.
   - *Measured fact — the clears fail closed*: `clearForWallet` and `clearAll` change state synchronously. An operation that is still in flight then fails at `readLease` (`L258-L266`, "nonce lease not found") on its next `markSigned` or `markBroadcastAccepted`, so it cannot broadcast with a lease that the clear removed. `clearForWallet` and `clearNearAccessKey` have no caller in `packages/wallet/src`, and `NonceCoordinator.d.ts` is reachable from the published types, so they stay.
   - *Decision*: no change.
8. **Withdrawn — B8 IndexedDB signer and outbox records**:
   - *Initial claim*: `AccountSignerRecord` and `SignerOpOutboxRecord` in `unifiedIndexedDBManager.ts` (`L45-L140`) have nullable lifecycle fields `removedAtMs`, `supersededByKeyRef`, `nextAttemptAtMs` and `lastErrorCode`; `summary.repairs` is never filled.
   - *Measured fact*: the two types are now in `passkeyClientDB.types.ts` (`L152-L168`, `L355-L370`) and none of the four named fields exists. Their optional fields are `removedAt`, `revocationReason`, `metadata`, `payload`, `lastError` and `txHash`. No invalid combination was measured. `repairs` is always `[]`, but `reconcileLocalSignerState` is on `UnifiedIndexedDBManager`, which the published types reach through `core/indexedDB/index.d.ts`, so removing the field is a public API change.
   - *Decision*: no change. A union rewrite of these persisted records needs a measured invalid state first.
9. **Withdrawn — B11 `revokeSession` guard**:
   - *Measured fact*: the schema (`migrations/d1-signer/0086_application_auth.sql:L22-L66`) has statuses `prepared | verified | consumed | revoked` and a UNIQUE `session_token_hash` per scope, so the UPDATE matches at most one row. Every purpose sets the hash at INSERT. The only caller, logout (`routes/externalAuth.ts:L435-L437`), ignores the result.
   - *Measured fact*: the plan's guard would skip a `prepared` authenticate row. Today logout revokes that row, and the next exchange fails because it needs `status = 'prepared'` (`externalAuthStore.ts:L383`). With the guard, a pending login would survive logout. For an associate or unlink row, only the holder of that same token can send the logout.
   - *Decision*: no change.
10. **Narrowed — B12 activation owner sentinel and repair-on-read**:
   - *Measured fact*: `activationOwner: ''` is a documented legacy sentinel (`d1RegistrationCeremonyRecords.ts:L1477-L1479`, `RegistrationCeremonyStore.ts:L231-L238`). `d1WalletRegistrationService.ts:L5153-L5160` rejects an empty owner, so a legacy claim fails closed. A union would be cosmetic.
   - *Measured fact*: the `cancel` call in `admitHomeRead` (from `8cfc587a6`) is deliberate repair-on-read. It publishes the cancellation to the directory again after a failed RPC, and no outbox exists for cancellations. Removing it would lose that retry.
   - *Measured fact*: no writer creates a row with `registering` and `cancelled`, so the plan's extra `registration_completion` guard on `prepareState('active')` is defensive only.
   - *Decision*: delete only the second `prepareState(input, 'retired')` batch in `cancel`.
11. **Withdrawn — B13, B14 and B15 (Rust)**:
   - *B13*: the function is `step_linked_presign_session`. It checks the step against the pinned Durable Object authority (`L544-L556`) before it removes the session, so a mismatched request burns nothing. Each Durable Object holds one session, the authority claim is single-use, and the client discards its session on any step error (`opaqueEcdsaPresignAuthority.ts:L154-L177`). After a protocol error the session is `Poisoned`; after a persist error the output was already taken. The owner path (`ecdsa_presign_session.rs:L199-L230`) uses the same order. Keeping the session would let nothing complete.
   - *B14*: `TenantRootRestoreImportSessionTombstoneD1RowV1` (`L4343-L4351`, `deny_unknown_fields`) has no `state` field, and no migration gives the table a `state` column. The table holds tombstones: a row exists only for a closed session, and the other queries test closure with `NOT EXISTS`. The plan's check does not compile.
   - *B15*: `Poisoned` is set only when `message()` or `start_presign()` returns `Err`, and every caller stops on that `Err`. If a caller did read `stage()`, `take_presignature_97` would still return `OutputUnavailable`. `PresignSessionStage` has no serde, but a new value would change what the WASM client sends (`ecdsa_role_local.rs:L858`, `L1083`) and break the TS `parseStage` (`opaqueEcdsaPresignAuthority.ts:L470-L480`).
   - *Decision*: no change for any of the three.
12. **Withdrawn — B17, B18, B20, B23 and the NEAR part of B22**:
   - *B17*: no `await` runs between `ready = true` (`router.ts:L2551`) and the `postMessage` of `PM_SET_CONFIG`, so every later request queues behind it on the same port. The host routes `PM_SET_CONFIG` with `signingPolicy: 'none'` and applies the configuration before its first await (`host/index.ts:L361-L399`). A cancel before dispatch rejects on purpose, as `component_unmounted` does after dispatch; `auth-menu.host.integration.test.ts` pins the rejection, and the React shell ignores it after cleanup.
   - *B18*: the method is `applyVisible`. `identityChanged` is computed from the previous mode (`L331`). `this.mode` starts as `{ kind: 'hidden' }`, and every non-hidden mode has `identity`, so the condition already reduced to `identityChanged`. A review handed to another surface of the same request keeps the attribute on purpose (`overlay-styles.ts:L151`).
   - *B20*: the function is `prepareTargetEmailOtpActivation`. `sendCode` reaches the integrator only through `notifyEmailOtpActivationV1`, which runs after the first start resolves, and a failed start goes back to `available`, so the retry goes through the single-flight `sendTargetEmailOtpCodeV1`.
   - *B22 NEAR*: `pending` is published only as `snapshot.busy`, and each change is followed by a publish; the `finally` blocks check the generation.
   - *B23*: the only progress listener (`progress.ts:L111-L129`) ignores `checking_cache`, and every caller awaits the same promise and gets its rejection; the reset stops a retry from showing a stale `downloading` value. Segments mode needs `unlockSuccess === 'skip'` (`capture/surface.ts:L99`), and the only caller of `succeed` needs `'show'` (`L205`), so `succeed` never runs in segments mode. No concrete defect was found in `microphone.ts`.
   - *Decision*: no change, except deleting the two always-false terms in B18.

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
  - Store the generation with each hydration in flight. A hydration for a newer generation waits for the stale one, then lists the pool again.
  - Make `clearClientPresignaturePool` and `clearAllRouterAbEcdsaDerivationClientPresignatures` call `stopPresignatureMaintenance`, so a scheduled refill does not run for a cleared pool. Leave the foreground refill count as it is: it counts refills that still run after a clear.
  - Track handles that a signing attempt took in one module-level `Set` (handles are unique across pools). `pushClientPresignature` returns `'duplicate'` for them. The attempt's `finally` removes the handle before it pushes an unclaimed handle back.
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
  - *Result (2026-11-08)*: reachable. Declarations emitted from `tsconfig.build.json` reach `SigningSessionCoordinator.d.ts` from the `speak-to-sign-host` entry through `core/signingEngine/interfaces/near.d.ts`. So `clear` stays, `backing` is deleted, and `clearWalletSession` dispatches on `lane.runtime.factor.kind`, which is the value `toLaneSource` maps.
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

The second source check (2026-11-08, `e710e608f`) withdrew B7 and the IndexedDB part of B8. See [Withdrawn and Narrowed Findings](#withdrawn-and-narrowed-findings), items 7 and 8.

#### B8 — Pass the chain target as a parameter in `EmailOtpSealedRestoreOrchestrator` (`sealedRestoreOrchestrator.ts`)
- **File**: [`packages/wallet/src/core/signingEngine/session/emailOtp/sealedRestoreOrchestrator.ts`](../packages/wallet/src/core/signingEngine/session/emailOtp/sealedRestoreOrchestrator.ts)
- **Root Cause**: `requestedChainTarget` is an instance field that carries `purpose.chainTarget` from `tryRestoreEcdsaWarmSessionStatusFromSealedRecord` to `readEcdsaSealedRecord`. `purpose.chainTarget` is never null, so the wrapper's null check is dead.
- **Change**: call `readEcdsaSealedRecordForTarget(requestedSessionId, purpose.chainTarget)` directly. Delete the field and the `readEcdsaSealedRecord` wrapper. The module is not reachable from the published types.
- **Verification**: `pnpm type-check` (the behavior does not change).

---

### Batch 3: Wallet Server & Rust/WASM Protocol State Machines (`B9–B16`)

The second source check (2026-11-08, `8c7a8ac7c`) withdrew B11, B13, B14 and B15. See [Withdrawn and Narrowed Findings](#withdrawn-and-narrowed-findings), items 9 to 11. Order of work: B12, B10, B16.

#### B12 — Delete the leftover second batch in `cancel` (`d1WalletExecutionAuthority.ts`)
- **File**: [`packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority.ts`](../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority.ts)
- **Root Cause**: `cancel` (`L132-L139`) runs `fixCancellation`, which sets `registration_completion = 'cancelled'` and `state = 'retired'` in one guarded batch, then a second batch `prepareState(input, 'retired')` on the same row. The second batch only matches the row again.
- **Change**: delete the second batch. Keep the `cancel` call in `admitHomeRead` and the `activationOwner` sentinel.
- **Verification**: `node tests/e2e/registration-setup-startup.e2e.mjs` (cancel while the directory is down, then a retry) and `node tests/e2e/registration-respond-recovery.scenario.mjs` if it runs on its own.

#### B10 — Guard the sessionless acknowledgement cleanup batch (`d1LinkedDeviceAuthorityInstallService.ts`)
- **File**: [`packages/wallet-server/src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceAuthorityInstallService.ts`](../packages/wallet-server/src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceAuthorityInstallService.ts)
- **Root Cause**: the `input.session === null` branch of `commitAcknowledgementCleanupV1` (`L1287-L1289`) runs its five statements with no CAS guard. A concurrent acknowledgement that already committed makes every statement match 0 rows, so the batch succeeds and skips the receipt comparison in the `catch`.
- **Change**: put `SESSION_CAS_GUARD_SQL` after each of the four `UPDATE`s, as `deleteActiveSessionWithStatementsV1` (`d1LinkedDeviceSessionStore.ts:L696-L716`) does. Do not guard the allocation `DELETE`: wallet authorization cleanup (`d1WalletAuthorizationCleanup.ts`) can already have removed the allocation. Guarding only after the state-transition updates, as first planned, would miss the acknowledgement `UPDATE`, which is the one that matches 0 rows in the race.
- **Verification**: `pnpm -C packages/wallet-server type-check`. No test reaches this path today.

#### B16 — Refuse a second request build on a WASM ECDSA ceremony (`ceremony.rs`)
- **File**: [`wasm/router_ab_ecdsa_client/src/ceremony.rs`](../wasm/router_ab_ecdsa_client/src/ceremony.rs)
- **Root Cause**: `build_explicit_export_request` and `build_activation_refresh_request` do not check whether the instance already built a request, so one instance can mix modes and overwrite `post_registration_application_binding_digest`.
- **Change**: each `build_*` refuses to run when the instance already built any request. This is smaller than the planned five-variant enum, and the JS worker already tracks the mode. Leave `EcdsaLinkedHolderMaterialV1` as it is. Split the test `opaque_ceremony_builds_all_strict_request_branches_without_private_material`, which builds every mode on one instance, into one instance per mode.
- **Verification**: `cargo test --manifest-path wasm/router_ab_ecdsa_client/Cargo.toml` with a `CARGO_TARGET_DIR` in a scratch directory.

#### B9 — Deferred: reconcile an uncertain Yao admission
- **Facts**: see the matrix row. Deleting the claim in `commitAdmit` is wrong: the live route does not call it, and a blind retry can make a second router session.
- **Decision needed**: either a reconciliation step (on retry, read the router's result for the lifecycle and then settle the claim), or a claim expiry that is safe with the router's idempotency. No code changes until that decision is made.

---

### Batch 4: Host-to-Iframe Transport, Auth Menu, External Wallet Controllers & VoiceID (`B17–B23`)

The second source check (2026-11-08, `4f36c5ac8`) withdrew B17, B20, B23 and the NEAR part of B22. See [Withdrawn and Narrowed Findings](#withdrawn-and-narrowed-findings), item 12.

#### B21 — Fold the Max fee probe into `FormState` (`SendPanel.tsx`)
- **Change**: add `{ kind: 'pricing_max' }` to `FormState`, include it in `busy`, and delete `maxPending`. The inputs, Max and Review and send are then disabled while the probe runs.
- **Verification**: `wallet-ui/asset-send-max.browser.test.ts` bundles the panel from source with a probe that the page releases. It fails on the old panel.

#### B22 — Keep the EVM connection when the wallet stays on another chain (`externalEvm/controller.ts`)
- **Change**: in `switchChain`, publish the connection on the observed chain and still return `unsupported_chain`, as `connect` and `chainChanged` do for an unconfigured chain.
- **Verification**: `unit/externalEvmController.unit.test.ts`; the test that pinned the disconnect now expects `connected` on chain 2 with `network: { kind: 'unsupported' }`.

#### B19 — Check both busy flags in the Google OTP submit and the registration reroll (`session.ts`)
- **Change**: `submitGoogleOtp` returns while `resendBusy` is set, and `rerollGoogleRegistration` returns while `submitBusy` is set. No copy or radius changes.
- **Verification**: `pnpm -C packages/wallet type-check`. The auth-menu browser tests load the built SDK, so they do not exercise this source change.

#### B18 — Delete the always-false terms in the review attribute condition (`overlay-controller.ts`)
- **Change**: `else if (identityChanged)`, with a comment that a review handed to another surface of the same request keeps the shell.

---

## Verification Gate for Every Batch

Before committing each batch on `implicit-state-machines`:

1. `pnpm type-check`
2. Targeted unit tests for modified TypeScript code. `packages/wallet`, `packages/wallet-server` and `packages/voiceid` have no `test` script. Wallet unit tests live in `tests/unit/*.unit.test.ts` and run with Playwright: `pnpm -C tests test:wallet-unit` (or `pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts unit/<file>` for one file). `tests/unit` is not type-checked, so run each new test.
   - No unit test covers a Batch 1 module today, so each Batch 1 item adds its test file.
   - Test through the exports that exist. A new export that only a test uses raises `testOnlyExports`. The check does not ratchet that measure, but `AGENTS.md` says to export only what another file uses. Worker files have no exports, so move worker logic to a module that the worker imports (as `passkeyMpcSession/warmSessionPrfHandles.ts` does), or drive the transport with a fake `Worker` (as `tests/unit/workerTransportPrewarm.unit.test.ts` does).
3. Targeted Cargo tests for modified Rust crates (`cargo test -p router-ab-ecdsa-presign`, `cargo test -p router-ab-cloudflare`, `cargo test --manifest-path wasm/router_ab_ecdsa_client/Cargo.toml`)
4. `pnpm report:bloat --check`
