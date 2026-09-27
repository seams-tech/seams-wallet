# R150 VM reference: setup

Status: local reference, 2026-09-26. This runs the Wallet on ordinary processes
and SQLite files, with no Cloudflare service, Wrangler or Miniflare. It is a
reference for portability, not a provisioning framework: AWS/GCP tooling,
PostgreSQL and multi-region custody are out of scope.

All roles on one machine, as this guide runs them, is a development topology.
It does not establish independent custody: production A/B isolation needs
separate hosts, administrators, service identities, keys, databases and
backups, and an explicit operator review.

## Processes

| Process | Binary | Holds | SQLite |
| --- | --- | --- | --- |
| Router | `router_ab_local_worker --role router` | Gateway-to-Router, Router-to-SigningWorker ECDSA and role-shared credentials, Wallet Session JWT verifier, published tenant-root verifying keys | tenant-root creation state |
| Deriver A | `router_ab_local_worker --role deriver-a` | its role signing key, role-store record key, online and managed-backup provider keys, peer signing key | role-private store; managed backups |
| Deriver B | `router_ab_local_worker --role deriver-b` | the same, for B | role-private store; managed backups |
| SigningWorker | `router_ab_local_worker --role signing-worker` | server-output key, wallet key-encryption key, Router ECDSA and Gateway presign credentials | role-private store, including the wallet store (ECDSA activations, presignature pool, signing effects) |
| Tenant-root control plane | `router_ab_local_tenant_root_control_plane` | the issuer signing key, and nothing else secret | none |
| Wallet Gateway | Node, `nodeHostedWalletGatewayMain.ts` | Gateway secrets | shared Gateway store |

Each role reads only its own env file. The tenant-root settings use the env
names the Cloudflare roles read (for example
`DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY`,
`TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY`, `DERIVER_ROLE_PRIVATE_D1_*`),
and the shared parsers refuse any key a role must not hold. The ECDSA code
reads each role's other bindings under their Cloudflare names too; the VM keys
that differ in name or format are presented that way by
`local_cloudflare_bindings.rs`. The operator file
holds the creation grant authority and the recovery authorities and is loaded
by no process.

The Router also runs the VM's scheduled refresh, the counterpart of the
external trigger on Cloudflare. Each tick, it offers every tenant root it holds
a scheduled refresh through the same coordinator the refresh route runs, and
the admission answers "not due" until the root's schedule says otherwise. The
job is the Router's persisted pending admission, so a restarted Router resumes
the scheduled operation it began. Two settings in the Router's env file
govern it:

- `TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS`: the schedule's interval, thirty
  days by default and at least one minute. Cloudflare's Router reads the same
  setting.
- `LOCAL_TENANT_ROOT_REFRESH_SCHEDULER_TICK_MS`: how often the scheduler
  checks, one minute by default and at least one second.

Restoring a tenant's recovery kit into a new deployment uses the same Router,
control-plane, Deriver and creation-state code as Cloudflare. Two settings,
under their Cloudflare names, make a VM deployment a restore destination:

- `TENANT_ROOT_DESTINATION_BOOTSTRAP_JSON` in the Router's env file: the
  bootstrap authority the operator provisions for one empty tenant root. It
  names the root's identity, the deployment fingerprint, a fresh custody
  lineage and the digest of a one-time credential. The first bootstrap read
  stores it; activation consumes it and leaves only a destroyed marker.
- `TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON` in the control plane's env file,
  with `TENANT_ROOT_RECOVERY_TRUST_SNAPSHOT_JSON` optionally: the recovery trust
  the kit's manifest must chain to.

Every role holds the grant authorities' verifying keys, as on Cloudflare. The
control plane checks creation and restore grants with them; the Router and the
Derivers check a restore's pre-activation cleanup grant.

## One command

```bash
node crates/router-ab-dev/scripts/start-vm-wallet-system.mjs --root /tmp/seams-vm
```

It builds `router-ab-dev`, generates every env file, applies each role's
schema, starts the five role processes, creates the tenant root from an
operator-signed grant, prepares the Gateway configuration with the same
preparer the Worker launcher uses, migrates the Gateway store and serves the
Gateway on `http://127.0.0.1:4100`. Roles listen on 4102-4106. Set
`SEAMS_LOCAL_PORT_OFFSET` and `SEAMS_INTENDED_ROUTER_URL` together to move the
whole stack (the browser suites expect the Gateway at 4100 plus the offset).

The browser suites run against it with `SEAMS_INTENDED_WALLET_HOST=vm`.

## Step by step

1. Generate env files:

   ```bash
   cargo run --manifest-path crates/router-ab-dev/Cargo.toml --bin router_ab_local_init -- --root /tmp/seams-vm
   ```

   This writes `.env.router-ab.{router,deriver-a,deriver-b,signing-worker}.local`,
   `.env.router-ab.tenant-root-control-plane.local` and
   `.env.router-ab.tenant-root-operator.local`. Key material is derived per
   deployment from a fresh seed.

2. Apply each role's schema. The chains are embedded in the binary; a role
   refuses to serve with a pending or unknown migration.

   ```bash
   router_ab_local_worker --role deriver-a --env .env.router-ab.deriver-a.local --migrate
   ```

   Deriver A and B apply the same role-private migrations their D1 databases
   run, plus a managed-backup schema. The Router applies its creation-state
   schema.

3. Start the roles and the control plane, from the root directory.

4. Create the tenant root. The operator signs a creation grant and posts it to
   the Router's creation route with the role-shared credential:

   ```bash
   node crates/router-ab-cloudflare/scripts/bootstrap-local-tenant-root.mjs \
     --root /tmp/seams-vm --grant-authority-env /tmp/seams-vm/.env.router-ab.tenant-root-operator.local \
     --org-id org_local_wallet --project-id local-smoke-project --env-id local-smoke-project:dev \
     --signing-root-id local-smoke-project:dev --signing-root-version default \
     --router-url http://127.0.0.1:4102
   ```

   Replaying the same grant returns the same ready state. The control plane is
   needed only for creation; signing does not call it.

5. Prepare, migrate and serve the Gateway (`nodeHostedWalletGatewayMain.ts`
   `migrate`, `check`, `serve`). `serve-local` serves the local Gateway, which
   adds the intended-suite transport faults.

## Checks

- `router_ab_local_worker ... --migrate` prints what it applied; a started role
  that finds a pending migration exits with the file and the pending names.
- `nodeHostedWalletGatewayMain.ts check` reports the Gateway store's migration
  status without writing.
- Every role serves `GET /healthz`.
- `vm_tenant_root_creation_is_authorized_replayable_and_role_isolated` in
  `crates/router-ab-dev/tests/local_worker_http.rs` prints
  `R150_VM_TENANT_ROOT_E2E` with the creation evidence;
  `vm_tenant_root_partial_creation_is_cleaned_before_a_fresh_grant` prints
  `R150_VM_TENANT_ROOT_PARTIAL_CLEANUP_E2E`.
- `vm_tenant_root_committed_activation_is_delivered_after_the_ceremony_expires`
  prints `R150_VM_TENANT_ROOT_POST_COMMIT_E2E`: a delivery lost after the
  Router commits is finished by a retry, inside the ceremony window or after
  it, and a signed receipt the Router did not commit activates nothing.
- `vm_tenant_root_ready_creation_resumes_from_durable_evidence` prints
  `R150_VM_TENANT_ROOT_RESUME_E2E`: a creation that stops after both roles
  install and before the Router commits resumes from stored evidence.
- `vm_tenant_root_uncommitted_creation_is_abandoned_after_the_ceremony_expires`
  prints `R150_VM_TENANT_ROOT_ABANDONMENT_E2E`: past its window an uncommitted
  creation is fenced and cleaned, and the fence and an activation commit
  exclude each other.
- A creation left with one role installed is cleaned on the next retry of its
  grant, which then reports that a fresh grant is required.
- `vm_tenant_root_refresh_delivers_the_committed_receipt_after_a_lost_delivery`
  prints `R150_VM_TENANT_ROOT_REFRESH_E2E`: a manual refresh commits at the
  Router before any Deriver swaps. The test loses B's delivery; a retry of the
  same operation delivers the committed receipt, and an exact replay returns
  the durable outcome. Both roles keep the retired epoch, and retirement is
  reported pending.
- `vm_tenant_root_refresh_that_misses_its_window_is_abandoned_and_superseded`
  (ignored by default: it waits past the five-minute refresh window) prints
  `R150_VM_TENANT_ROOT_REFRESH_ABANDONMENT_E2E`: a refresh installed at both
  roles whose receipt request is lost is abandoned after its window, its
  signed receipt can no longer be committed or delivered, and a new operation
  refreshes the root, superseding what the abandoned attempt left.
- `vm_tenant_root_scheduled_refresh_runs_and_resumes_after_a_router_restart`
  prints `R150_VM_TENANT_ROOT_SCHEDULED_REFRESH_E2E`: with a one-minute
  schedule, the Router's scheduler refreshes a root once it is due. A Router
  restarted while that scheduled refresh is in flight completes the same
  operation.
- `vm_tenant_root_restored_from_its_managed_backup_signs_refreshes_and_replays`
  prints `R150_VM_TENANT_ROOT_MANAGED_RESTORE_E2E`: Deriver A loses its
  active share and the root is restored from A's managed backup. The operator
  reserves a challenge at the control plane, signs it with the operations and
  Deriver A custody keys from the operator file, and the control plane issues
  the restore capability; exact retries return identical bytes. The Router
  stages A's share and runs the forward refresh. A new wallet registers on the
  restored root and signs a NEAR transaction; after another refresh a second
  wallet registers on the new epoch and signs; the original restore, retried,
  returns its outcome.
  - The retired fence of a completed restore no longer shields against a
    stray new challenge; such a challenge expires unauthorized like any
    other.
- `vm_tenant_root_restore_reservation_never_authorized_expires_and_frees_the_root`
  prints `R150_VM_TENANT_ROOT_RESTORE_RESERVATION_EXPIRY_E2E`: a challenge
  reserved with a five-second window and never authorized holds refresh back
  (409, in progress) while it stands. After its window, a checkpoint of it is
  refused (408) and the fence records it as expired. The control plane
  refuses to authorize it, and reserving it again is refused. The refresh it
  held back then runs. Deriver A later loses its share, and a new challenge
  is reserved, authorized and restored.
- `vm_tenant_root_recovery_kit_restores_into_an_empty_deployment_and_signs`
  prints `R150_VM_TENANT_ROOT_RECOVERY_KIT_RESTORE_E2E`: a tenant's recovery
  kit (the committed fixture manifest, both role packages and their trust
  bundle) restores the root into an empty deployment.
  - The test stands in for the Console, signing each grant with the
    operator's grant key, and for the tenant, resealing each opened share to
    its destination import key.
  - The bootstrap credential authenticates, and a wrong one is refused.
  - After the restore refresh the root is dormant: both Derivers hold pending
    epoch-1 shares, and the Router has no active state.
  - The operator's activation makes it active, replays exactly and consumes
    the credential. Cleanup retried after a lost reply returns both
    Derivers' receipts again.
  - A wallet registers on the restored root and signs. The root then
    refreshes, and a second wallet signs on epoch 2.
- `vm_tenant_root_work_admitted_before_a_refresh_finishes_on_its_epoch`
  prints `R150_VM_TENANT_ROOT_WORK_ACROSS_REFRESH_E2E`: a Yao registration
  admitted on epoch 1 is held while a refresh commits epoch 2 and both roles
  swap. Once released, it completes on its retired epoch.
- `vm_tenant_root_binding_unused_before_its_epoch_closes_starts_nothing`
  prints `R150_VM_TENANT_ROOT_UNUSED_BINDING_E2E`: a preparation held across
  a refresh is refused by the Deriver that had not admitted it.
- `vm_tenant_root_admission_follows_the_execution_attempt` prints
  `R150_VM_TENANT_ROOT_ADMISSION_ATTEMPT_E2E`: Deriver B's admission belongs to
  the Yao pair session.
  - A retry of the pair under a restamped window is answered from B's
    prepared record and keeps one admission row.
  - After a refresh, the same pair bound to epoch 2 is refused as
    `ConflictingPair`.
  - A fresh registration on epoch 2 gets its own row.
- `vm_tenant_root_new_work_waits_for_the_committed_epoch_delivery` prints
  `R150_VM_TENANT_ROOT_DELIVERY_GATE_E2E`: new work is refused with HTTP 503
  while a Deriver lacks the committed epoch, and admitted once delivery
  completes.
- ECDSA through the real Gateway: `passkey.presign-pool.contract.test.ts` with
  `SEAMS_INTENDED_WALLET_HOST=vm`. A fresh wallet registers, activates its
  SigningWorker material, fills its presignature pool and signs, on the same
  Router, Deriver and SigningWorker code as Cloudflare. The SigningWorker keeps
  its ECDSA state in the wallet store the SigningWorker wallet Durable Object
  uses, over its role-private SQLite file.
- `admitted ECDSA finalize lost_response retry returns the stored signature`
  writes `.artifacts/r150/gateway-ecdsa-finalize-lost-response-vm.json`: after
  a finalize response is lost, the exact retry returns the same signature, and
  the SigningWorker has recorded one signing effect, so one presignature was
  consumed. The Gateway answers that retry from its own operation record.
- `exact finalize retry at the Router returns the SigningWorker stored
  signature` writes `.artifacts/r150/router-ecdsa-finalize-exact-retry-vm.json`.
  The local Gateway loses the Router's finalize response after the
  SigningWorker has signed, and sends the identical request again before it
  records anything. The SigningWorker answers from the effect it already
  claimed: the same signature, and still one effect.
- A SigningWorker refusal of an effect another attempt has claimed and not
  finished reaches the Gateway as HTTP 409 `ReplayedLocalRequest`, on both
  hosts, so the Gateway keeps the operation in progress for a retry.
- Operation step-up through the real Gateway, on the same admission code as
  Cloudflare: `passkey.unlock` ("passkey unlock restores immediate export" and
  "page refresh hydrates warm signing, one-use step-up, and key export"),
  `passkey.registration` "sustained Tempo and Arc signing uses fresh
  presignatures beyond pool capacity" and `passkey.registration.resume`
  "passkey NEAR completion preserves an exhausted EVM signing budget". After
  a wallet exhausts its session budget, NEAR, Tempo and Arc signatures
  succeed by step-up, and an empty pool generates a presignature under the
  step-up operation. The step-up binding names the wallet and the Console
  project environment the Gateway's store claimed it in, so the SigningWorker
  reaches the same wallet storage as for an owner Wallet Session.
- Ed25519 and ECDSA export through the real Gateway, in the same
  `passkey.unlock` tests. The Router derives the ECDSA export's wallet from the
  Gateway ceremony session it verifies; the SigningWorker seals its share
  from its wallet store. Passkey recovery (`passkey.recovery`, passkey-founded
  cases, including a lost finalization response and a runtime reset) passes.
- ECDSA add-signer: `passkey.ed25519-yao-local` "public ECDSA add-signer lets
  an Ed25519 wallet sign NEAR, Tempo and Arc at once and after unlock, across a
  lost finalize response". The Router runs the registration steps bound to the
  add-signer purpose. The Gateway extends the wallet's authority with the new
  activation and promotes the wallet's live Wallet Sessions to it. Each
  session keeps its identity, quota and operation-credential hash, so the SDK
  signs on with the credential it holds; promotion retires the sessions'
  hosted credentials and deletes their unredeemed hosted exchange codes. A
  replayed finalize returns the committed outcome.
- VM route errors answer 400, except `LifecycleTransitionInProgress`, which
  answers 503 as on Cloudflare so the Gateway retries it.
- The VM Router runs creation-state operations one at a time in process, as a
  Durable Object does. SQLite's lock alone let a role polling the refresh
  rendezvous starve its peer's write.

## Not served on the VM

See the [Phase 0 inventory](./refactor-150-supported-operations.md) for each
operation, its contracts and what is needed.

- ECDSA activation refresh. Linked-device ECDSA signing fails closed.
- Device linking.
- Tenant-root status, recovery-package backup, source retirement and cutover.
  Manual and scheduled refresh, managed restore and restore into a new
  deployment are served, with the same Router, Deriver and control-plane code
  as Cloudflare. Backup waits on the
  [retention decision](./refactor-150-vm-recovery-retention.md).
- Linked-device signing.
- Google Cloud KMS managed backup (HPKE only).
- Router and SigningWorker prewarm, which keeps Worker isolates warm and has no
  VM counterpart; the launcher sets `ROUTER_AB_PREWARM_ENABLED=false`.
