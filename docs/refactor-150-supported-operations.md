# R150 Phase 0: currently enabled operations and their contracts

Status: inventory (2026-09-26), with device-linking and auth-method scope
confirmed 2026-09-28. Phase 0 of the
[R150 plan](./refactor-150-regional-wallet-home-lanes.md#phase-0-ownership-inventory-and-baseline)
asks to "record supported wallet/protocol configurations"; no such record
existed. This lists what this repository enables today, what reaches it, where
it is served on each host, and the contracts that cover it.

Implementation status and scope decisions are recorded separately. R150
requires every enabled lifecycle and signing protocol to pass on both
adapters. An operation enabled but not served on the VM is R150 work, unless
explicitly excluded. Device linking and auth-method addition/revocation are
required; their open tasks are in
[Phase 2](./refactor-150-regional-wallet-home-lanes.md#required-device-linking-and-auth-method-work).
The remaining decisions are listed at the end.

- **"Enabled"** means a production route serves the operation and a product
  or operator surface in this repository reaches it: the SDK, hosted UI,
  Gateway, CLI or wallet-control operations.
- **Sources.** Surfaces are in `packages/wallet/src/SeamsWeb/publicApi/types.ts`,
  the Gateway route table (`packages/wallet-server/src/router/framework/routeDefinitions.ts`),
  `walletControlOps.ts` and `crates/seams-cli/src/command.rs`. VM service is
  from `crates/router-ab-dev/src/local_worker_topology.rs`, the VM Router
  dispatcher (`local_router_coordinator.rs`), which serves NEAR normal
  signing, Yao execute and recovery promote, and the VM ECDSA routes
  (`local_router_ab_ecdsa.rs`). Every other Router path returns 501.
- **Marking.** "(inferred)" marks a conclusion drawn from the dispatch code
  rather than exercised by a test.
- **Outside this repository.** The Console and the deployed Wallet Runtime that
  serves wallet-control operations live in seams-monorepo. Where an operation's
  only surface is there, this record says so.

## Wallet operations

| Operation | Enabled through | Cloudflare | VM | Contract | Main tests |
| --- | --- | --- | --- | --- | --- |
| **Ed25519 (NEAR) registration**, passkey and Email OTP | SDK `registerWallet`; hosted auth menu | Served | Served | Spec 2 "Creating a wallet"; Spec 5; `router-ab/ed25519-yao.md` | `passkey.registration*`, `email-otp.*`, `passkey.ed25519-yao-local` (VM); VM `product_topology_*`; Workers wallet-DO and replay tests |
| **ECDSA (Tempo, EVM) registration** | SDK registration with a chain target | Served | Served | Same | `passkey.registration`, `passkey.presign-pool` (VM); `testEcdsaRegistrationAndActivation`; `ecdsa_derivation_*` |
| **Add signer** | SDK `addWalletSigner` | Served | Served (Ed25519 and ECDSA) | Spec 2 | `passkey.ed25519-yao-local` add-signer (both curves): an Ed25519 wallet adds ECDSA, signs NEAR, Tempo and Arc at once and after unlock, across a lost finalize response (VM, Workers D1 and wallet-DO). The Gateway extends the wallet's authority with the ECDSA activation and promotes its live Wallet Sessions to it in the same commit: identities, quotas and operation credentials carry over; hosted credentials are retired and unredeemed hosted exchange codes deleted |
| **Unlock and Wallet Session** | SDK `auth.unlock` | Gateway | Gateway code shared | Spec 3 "Unlock and sign" | `passkey.unlock` (VM), `email-otp.unlock` |
| **NEAR Ed25519 signing** | SDK `near.*`, with Router normal signing enabled | Served | Served (owner sessions) | Spec 5 "Signing with prepared material" | `passkey.unlock`, `passkey.registration`; VM `product_near_signing_process_flow`; `normal_signing_worker_boundaries.rs` |
| **ECDSA Tempo and EVM signing** | SDK `tempo.*`, `evm.*`, with a chain target | Served | Served (owner sessions, pool material) | Spec 5; intended "Transaction Signing" | `passkey.registration`, `passkey.unlock`, `passkey.presign-pool` (VM, including a finalize lost-response retry); `testEcdsaNormalSigning`; `ecdsa_derivation_normal_signing_boundaries.rs` |
| **ECDSA presignature pool** | Automatic refill; SDK prefill | Served | Served (owner sessions) | Intended "Durable ECDSA preprocessing" | `passkey.presign-pool` (both hosts); `runEcdsaPresignSession` |
| **Step-up signing** (Ed25519 and ECDSA) | Implicit in sensitive operations | Served | Served, including step-up presignature generation | Spec 3 "Fresh approval" | `passkey.unlock`, `passkey.registration` "sustained Tempo and Arc signing", `passkey.registration.resume` NEAR budget (VM); `email-otp.unlock`, recovery contracts |
| **Device linking, inventory, revoke** | SDK `DevicesCapability`; account menu | Served, on Workers D1 and the wallet-object build (the SigningWorker wallet object keeps a linked device's reservations of both curves with the wallet's material) | Served: the Router's source-preserving execute and the SigningWorker's reservation, activation and revocation for both curves | Spec 2 "Linking a device" | `passkey.device-linking`: a second device links across a lost activation answer, signs NEAR and Tempo with the wallet's keys and is refused after revocation, while the first still signs (VM, Workers D1 and wallet-object build) |
| **Code recovery** (passkey; Google with Email OTP) | Hosted auth menu | Served, on Workers D1 and the wallet-object build (passkey recovery runs through the SigningWorker wallet object there, and retires the activation it replaces) | Served for passkey recovery; Google-backed recovery not run on the VM | Spec 2 "Recovering access"; [cross-owner finalization](./refactor-150-cross-owner-finalization.md) slices 3, 4 and 6 | `passkey.recovery` passkey-founded cases, including the interrupted-attempt and replaced-activation retirement contracts (VM, Workers D1 and wallet-object build); `google-email-otp.recovery` (excluded by the intended-wallet Playwright config) |
| **Recovery-code management** | SDK `RecoveryCapability` | Gateway | Gateway code shared | Intended "Account Recovery" | `recovery-code-backup.browser.test.ts` |
| **Factor add and remove** | SDK `addPasskey`, `addEmailOtp`, `revokeAuthMethod` | Gateway shared SQL | Gateway code shared; integration evidence pending | Spec 2 "Adding a sign-in method" | Reuse `passkey.add-email-otp`, `email-otp.add-passkey`, `auth-method-addition.matrix` for Phase 2 finalize-retry, new-method unlock/sign and revocation evidence on wallet-DO and VM |
| **Ed25519 export** | SDK `keys.exportKeypair` | Served | Served | Intended "Key Export"; [cross-owner finalization](./refactor-150-cross-owner-finalization.md) slices 5 and 7 | `passkey.unlock` (VM), `email-otp.unlock`, `export.flow.integration`; `passkey.ed25519-yao-local` interrupted-authorization retry (VM, Workers D1 and wallet-object build); the Email OTP variant in `email-otp.unlock` needs a Google ID token and has not been run |
| **ECDSA export** | Same | Served | Served | Same | Same |

Served but not reached by any surface in this repository (inferred):
- **Router signing lanes.** See the [ownership map](./refactor-150-state-ownership-map.md).
- **The Router's dedicated linked-device signing branches.** Device 2 signs
  through ordinary owner sessions instead.
- **ECDSA activation refresh.** Its SDK client has no caller.

## Tenant-root operations

| Operation | Enabled through | Cloudflare | VM | Contract | Main tests |
| --- | --- | --- | --- | --- | --- |
| **Creation** | Wallet-control `create`; local bootstrap | Served | Served | `router-ab/protocol.md` "Creation" | VM `vm_tenant_root_*`; Workers creation and recovery tests |
| **Creation sweep** (operator) | Runbook only (no op or CLI) | Served | Served | [Creation resume](./refactor-150-tenant-root-creation-resume.md) | VM and Workers sweep E2Es |
| **Status** | Wallet-control `status`; CLI `derivation-root status` | Served | **Not served** | None | None |
| **Manual refresh** | Wallet-control `refresh`; CLI `derivation-root rotate` | Served, commit-first | Served, same code | Spec 6 "Refreshing shares" | `testTenantRootManualRefresh`, `testTenantRootRefreshDeliveryAfterLoss`; VM `vm_tenant_root_refresh_*`; private rotation contract |
| **Scheduled refresh** | The Router accepts `trigger: scheduled`; on the VM the Router's own scheduler triggers it, on Cloudflare an external trigger | Served on request | Served by the Router's scheduler (`TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS`) | Spec 6 | Router-state unit tests; VM `vm_tenant_root_scheduled_refresh_runs_and_resumes_after_a_router_restart` |
| **Retirement after refresh** | None: the Router erases each refresh's retired epoch itself, once delivery is complete and the grace after the swap has passed (`TENANT_ROOT_RETIREMENT_GRACE_MS`) | Served, on later refresh passes | Served, same code; the Router's scheduler tick is a pass | Spec 6 "Refreshing shares"; [refresh retirement](./refactor-150-refresh-retirement.md) | Workers `--retirement-trigger` (both builds); VM `vm_tenant_root_refresh_retires_its_old_epoch_once_its_work_settles` |
| **Availability (managed) restore** | No surface in this repository | Served | Served, same control-plane, Router and Deriver code | Spec 6 "Backing up the deployment" | `testTenantRootManagedRestoreOperatingPath`; VM `vm_tenant_root_restored_from_its_managed_backup_signs_refreshes_and_replays`, `vm_tenant_root_restore_reservation_never_authorized_expires_and_frees_the_root`, `vm_tenant_root_authorized_restore_overtaken_by_a_refresh_is_superseded` |
| **Recovery-package backup** | CLI recovery-key and backup; wallet-control `recovery-*` | Served | Served, same code; the retention key lives in the role store ([option 1](./refactor-150-vm-recovery-retention.md)) and Destroy reports the erasure unverified | Spec 6 "Backing up the deployment" | VM `vm_tenant_root_generates_a_recovery_kit_that_restores_into_an_empty_vm`; `seams-cli` tests against a mocked Console |
| **Restore to a new deployment** | CLI `restore`; wallet-control restore ops | Served | Served, same Router, control-plane, Deriver and creation-state code | Spec 6 "Restoring to a new deployment" | `restore_drill.rs` (mocked Console); VM `vm_tenant_root_recovery_kit_restores_into_an_empty_deployment_and_signs`; no Worker E2E |
| **Cutover** | None | Record store only | Not served | Spec 6 "Moving an active deployment" | `tenant_root_cutover_lifecycle.rs` |
| **Source retirement** | Wallet-control `recovery-deriver-{a,b}-retire-source` | Served | **Not served** | Spec 6 "Moving an active deployment" | **None** |

## What this changes

- **The VM gaps are larger than documented.** The VM reference setup lists
  restore, retirement, cutover, linked-device signing and KMS backup as not
  served (refresh has since been served). It omitted two further gaps: every
  ECDSA operation and device linking. ECDSA wallet registration, the
  presignature pool, owner-session and step-up signing, ECDSA export,
  ECDSA add-signer and device linking are now served on the VM. R150
  names "NEAR and EVM signing" among the supported protocols that must pass on
  both adapters.
- **Source retirement is reachable and untested.** It is reachable through a
  wallet-control operation, deletes a lineage in one batch, and has no test
  anywhere.
- **Some enabled operations have no in-repository surface.** Cloudflare's
  scheduled-refresh trigger is external, and availability restore has no
  surface. Whether they are enabled in the release depends on seams-monorepo.
  The VM Router schedules refresh itself.

## Decisions needed

1. **Scheduled refresh and availability restore.** Confirm from seams-monorepo
   whether they are enabled in the release. If they are, they are VM work; if
   not, record that.
2. **Source retirement.** Keep it reachable as is, gate it until the drain
   rule exists, or keep it with an explicit decision. It deletes material with
   no drain and no coverage.
3. **Unreached code.** For Router signing lanes, the linked-device Router
   branches and ECDSA activation refresh, decide between removal and a
   recorded reason to keep them.
