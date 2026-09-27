# R150 remaining tenant-root lifecycle work, by requirement

Status: working inventory (2026-09-26). It ties each remaining tenant-root
lifecycle item to the requirement that makes it R150 work, states what exists
on each host, and names what gates it. Planned migration and cutover are
listed separately: R150 keeps their requirements intact but does not require
them to be extended to the VM.

## Requirements

- **R150 completion** ([plan](./refactor-150-regional-wallet-home-lanes.md#repository-ownership-and-completion)).
  Every enabled lifecycle and signing protocol passes its current contracts.
  The same domain logic passes the supported contracts through the VM adapter,
  with VM topology and recovery limits documented. Role isolation,
  restart/retry safety and one-use-material invariants pass review.
- **Shared contracts** ([plan](./refactor-150-regional-wallet-home-lanes.md#shared-contract-verification)).
  Both adapters run the same supported lifecycle contracts, covering:
  - competing claims and duplicate commands;
  - stale versions and expiry;
  - lost responses after commit;
  - crash and restart;
  - durable retries and wrong-role access.
- **Product scope** ([plan](./refactor-150-regional-wallet-home-lanes.md#product-behavior-and-scope)).
  Preserve registration, unlock, signing, recovery, factor and export for each
  configuration enabled in the release. Provide runbooks for object failure,
  schema upgrades, recovery and the clean-reset rollout.
- **Spec 6** ([tenant roots](./spec-6-tenant-roots-recovery-and-portability.md)).
  Specifies share refresh, availability backup, a tenant recovery package with
  restore to a new deployment, and moving an active deployment.

Phase 0 input: the [inventory of enabled operations](./refactor-150-supported-operations.md)
records what this repository enables today and lists the decisions still
needed. For example, scheduled refresh and availability restore have no
surface in this repository. The table below treats Spec 6's refresh,
availability restore and recovery-package restore as enabled, because the
Cloudflare path serves them. Excluding any of them requires an explicit
decision.

## Items

| Item | Why it is R150 work | Cloudflare today | VM today | Gate |
| --- | --- | --- | --- | --- |
| **Creation and its recovery** | Enabled lifecycle; shared contracts | Implemented: resume, commit-first delivery, abandonment, ceremony-bound cleanup, operator sweep | Same code, same E2Es | Done. Automatic sweeping is a separate decision |
| **Share refresh** (manual and scheduled) | Spec 6 refreshing shares; enabled lifecycle; shared contracts | Commit-first, with roll-forward delivery. The lost-delivery fault is reproduced and fixed in a Workers E2E | Served by the same Router coordinator, Deriver and control-plane code. The lost-delivery and abandonment E2Es pass on the VM, and the Router's scheduler triggers scheduled refresh | [Commit-first](./refactor-150-refresh-commit-first.md): abandonment, per-role delivery status and the VM's scheduled-refresh trigger are done |
| **Retiring and erasing old shares after refresh** | Spec 6: erase only when completion conditions allow; in-progress work keeps its version; one-use and retry safety | The retired-cleanup command erases a retired share and its backup only once every admission on that epoch is settled or cancelled. It previously had no settlement check. The Router issues it on later refresh passes once the grace after the swap has passed, and the next refresh waits for both roles. The harness shows the cycle | Same code, gate and trigger, with VM E2Es through `W` recovery and the trigger | [Admission identity and settlement](./refactor-150-admission-identity.md), for review. Done: settlement and fencing in the wallet objects, with reconciliation that recovers a lost acknowledgement; cancellation that stops the whole execution, in the role store, on the VM and in the wallet objects. A claimed attempt is recovered once Deriver B fences it or reports it completed. A completed step replays from stored outcomes after its epoch is erased, on the VM and on both Workers builds. Done: the automatic [trigger](./refactor-150-refresh-retirement.md), with VM and Workers E2Es. Done: a managed restore that commits while a retirement is pending carries it, and later passes erase that epoch, with a VM E2E through a Router restart. The moving-authority fences are not implemented |
| **Availability restore** (one role from its managed backup, then a forward refresh) | Spec 6 availability backup; runbooks for object failure and recovery | Served, with a Workers E2E. A restored root refreshes again (defect below, fixed) | Served by the same control-plane, Router and Deriver code. VM backups are HPKE-sealed, and the restore opens them with the same provider | Done. A reservation never authorized expires after its window (defect below, fixed) |
| **Recovery package and restore to a new deployment** (dormant, then operator activation) | Spec 6 restoring to a new deployment; recovery runbook | Served; no E2E | Restore and backup served by the same Router, control-plane, Deriver and creation-state code. VM E2Es cover restore from a recovery kit through signing and a refresh, and a kit generated on a VM source and restored into an empty VM | Done: backup with [option 1](./refactor-150-vm-recovery-retention.md), local sealed retention. Destroy reports the erasure unverified |
| **Linked-device and step-up signing** | Preserve signing for each enabled configuration | Served | Fails closed | Needed on the VM only if the release enables them. Independent of tenant-root lifecycle |
| **Google Cloud KMS managed backup** | Optional provider integration | Served | HPKE only | Out of scope: R150 excludes provider-specific provisioning. HPKE is the portable path |
| **Worker prewarm** | Cloudflare isolate warm-up | Served | Not applicable | None |

### Defect: refresh after an availability restore

Found 2026-09-26, while adding a Workers E2E that refreshed the harness's
main root after its managed restore.
- **What persists:** a completed managed restore leaves a terminal
  managed-restore fence in the Router's creation state.
- **The rule:** that fence is valid only against the restored state itself,
  or while the restore's own forward refresh is the latest completed refresh.
- **The failure:** when a later refresh reserves its attempt, the stored
  record no longer satisfies the rule. The next read, the refresh commitment
  checkpoint, refuses it: "managed-restore terminal challenge does not match
  active state". The Router reports this as "creation journal unavailable".
- **Scope:** no refresh can complete on a restored root, on Workers and,
  with the shared code, on the VM. It predates R150's refresh work; no test
  refreshed a root twice or after a restore.
- **Fixed (2026-09-27): the fence is retired.**
  - A restore is complete when its own forward refresh commits, and that
    commit retires the managed-restore fence. Later refreshes then validate
    against the state they change. A later incident can also authorize
    another restore, which a terminal fence used to refuse for good; no test
    exercises a second restore yet.
  - The restore's durable outcome moves, in the same storage operation, to a
    completion record named by its exact issuer-signed public state and
    capability. This mirrors the manual refresh's completion record.
  - An exact retry of the restore reads that record first and returns its
    outcome, however far later refreshes have moved the active state. It
    delivers a pending receipt only while the restore's own commit is still
    the active one.
- **Evidence:** the Workers harness now refreshes the harness's main root
  after its managed restore (`R150_WORKERS_REFRESH_AFTER_MANAGED_RESTORE`,
  also runnable alone with `--refresh-after-managed-restore`). The step came
  first and reproduced the failure verbatim: "tenant-root refresh commitment
  checkpoint returned HTTP 500: tenant-root creation journal unavailable".
  With the fix, the refresh commits the next revision, taking Deriver A to
  epoch 3 over its restored epoch 2 and Deriver B from epoch 1 through 2 to 3.
  An exact retry of the restore afterwards returns its original bytes.

### Defect: a restore reservation never authorized held the root

Raised in review on 2026-09-27.
- **The failure:** a reserved managed-restore challenge that is never
  authorized holds the fence for good. Refresh admission answers "in
  progress" while the fence is reserved, and nothing ever releases it.
- **Fixed (2026-09-27): the reservation expires.**
  - Once the creation state's clock passes the challenge's window, the fence
    becomes `expired`, recording the challenge, its attempt and when it
    expired. It is never simply cleared.
  - The transition is persisted before the operation that finds it is
    evaluated: refresh admission, a new reservation, or a checkpoint. It
    therefore holds even when that operation is then refused.
  - An expired reservation holds back neither refresh nor a new challenge.
    Its own late checkpoint is refused, as are an authorization of it at the
    control plane and a repeat of its reservation. It stays on record through
    later refreshes until a new reservation replaces it.
  - An authorized (terminal) restore is never expired. It stays recoverable
    through its own forward refresh, and its completion record still answers
    exact retries.
- **Evidence:** VM
  `vm_tenant_root_restore_reservation_never_authorized_expires_and_frees_the_root`
  (`R150_VM_TENANT_ROOT_RESTORE_RESERVATION_EXPIRY_E2E`). Workers run the
  same creation-state code; the harness does not yet exercise it.

### Defect: an authorized restore overtaken by a refresh broke the root

Found and reproduced on the VM on 2026-09-27.
- **The failure:**
  1. A restore was authorized, but never ran; for example, the role came back
     by itself.
  2. A manual refresh completed, and the authorized fence stayed on record.
  3. The next refresh reservation was persisted without being validated. The
     record held a reserved refresh beside a restore challenge two states
     old, and no read accepts that pairing.
  4. From then on, every operation on the root failed with "stored tenant-root
     refresh checkpoint is invalid": refresh, a new challenge, and new work.
- **Fixed (2026-09-27): the refresh supersedes the restore.**
  - **The transition:** when a refresh completes that is not the restore's
    own forward refresh, the authorized fence becomes `superseded`. It
    records the challenge, its attempt, and the revision that overtook it.
  - **Why this is safe:** that refresh needed both roles, and the restore's
    capability names a state that no longer exists, so the restore could no
    longer run.
  - **What it frees:** a superseded restore holds back neither refresh nor a
    new challenge.
  - **What it refuses:** its execution, its challenge request, its
    checkpoint and its authorization. A completed restore is unchanged: its
    forward refresh records its completion, which answers exact retries.
  - **Defence in depth:** a refresh reservation is validated before it is
    persisted.
- **Evidence:** VM
  `vm_tenant_root_authorized_restore_overtaken_by_a_refresh_is_superseded`
  (`R150_VM_TENANT_ROOT_RESTORE_SUPERSEDED_E2E`). Workers run the same
  creation-state code; the harness does not exercise this schedule.

### Defect: harness runs could load stale or mismatched Worker builds

Found 2026-09-27, when an `--admission-races` run failed with a misleading
"deriver-a must persist one managed backup and one provider canary:
1 !== 2".
- **The failure.** `test-private-d1.mjs` chose its Worker builds from the
  node process's environment, and nothing checked what it loaded.
  - It loaded `build/dev/<role>` only when that process itself had
    `ROUTER_AB_WORKER_BUILD_PROFILE=dev`. Otherwise it silently loaded the
    release bundles in `build/<role>`, which were days old.
  - Dev builds of both variants share `build/dev/<role>`, so a wallet-object
    run after a role-store build would load the wrong variant.
  - It never loaded release wallet-object builds, which
    `build-strict-worker.sh` writes to `build/wallet-do/<role>`.
- **Audit of this branch's Workers evidence**, from every harness command
  run 2026-09-25 to 2026-09-27:
  - Every reported pass ran with the dev profile on the node process, after
    a same-variant build in the same or the preceding command.
  - The only runs without it were six `--admission-races` attempts between
    10:31 and 10:36 UTC on 2026-09-27. They loaded the stale release bundles
    and failed, and none was reported. The same mode then passed with the
    dev profile.
  - A wallet-object run at 10:23 UTC followed an interrupted role-store
    build. That build never reached its output, so the run loaded the
    wallet-object builds it needed.
  - What remained: later commits changed code the last Workers runs had not
    built, including shared recovery code in the VM backup commit. So each
    release-critical mode this work touches was rerun on the current tree
    (below).
- **Fixed (2026-09-27): a run refuses a stale or mismatched build.**
  - `build-strict-worker.sh` stamps each build beside `worker/` with its
    profile, its variant, its features and when it started. A deployment
    does not upload the stamp.
  - The harness requires the profile to be named. It loads
    `build/wallet-do/<role>` for a release wallet-object run.
  - Before it loads a build, it checks the stamp's profile and variant, and
    that the build started after the newest source of the Worker crate and
    every workspace crate it depends on by path. It logs each build it loads.
- **Rerun on the current tree, 2026-09-27**, each variant built just before
  its runs:
  - Role-store: `--retirement-trigger`, `--refresh-after-managed-restore`,
    `--admission-races`, `--replay-after-erasure`, `--ecdsa-across-refresh`,
    `--refresh-delivery-after-expiry` and
    `--refresh-abandonment-after-expiry` pass.
  - Wallet-object: `--retirement-trigger`, `--replay-after-erasure`,
    `--do-claimed-recovery` and `--do-admission-settlement` pass.
  - One stale result surfaced. `--refresh-delivery-after-expiry` had last
    passed on 2026-09-26, before the automatic retirement trigger. Rerun, it
    failed on its own expectation, not a defect: its retry comes 310 seconds
    after Deriver A's swap, past A's five-minute grace, so the retry's pass
    correctly erases A's epoch 1. The expectation now says so.
  - Not rerun: the full default suite, which can wait for the release.

## Separate: planned migration (cutover and source retirement)

Spec 6 describes moving an active deployment:
1. restore the destination;
2. authorize cutover, with one active authority at a time;
3. retire the source and erase it by policy.

R150 keeps safe-cutover requirements for moving between independent
authorities and defers relocation. That means R150 must not weaken these
requirements, but extending cutover beyond them is its own work:

| Item | Cloudflare today | VM today | Gate |
| --- | --- | --- | --- |
| **Cutover record** | A store for caller-supplied stage receipts; nothing orchestrates the stages, and nothing consumes `derivation_gate()` | Not served | Separate approval. The drain proposal changes `Drained` to require gate-closed receipts |
| **Source retirement** | Deletes the lineage in one batch, with no drain and no test | Not served | Separate approval, after the drain gate. It is the most destructive operation and has no coverage today |

## Order

1. The refresh storage extraction (this slice). It changes no behaviour, and a
   new Workers manual-refresh E2E gives the same result before and after.
2. The drain proposal revision and the commit-first refresh proposal, both for
   review.
3. Commit-first refresh on Cloudflare, with the failure reproduced first.
   Retirement is reported pending.
4. Refresh served on the VM through the same coordinator, Deriver and
   control-plane code (done for manual refresh).
5. Availability restore on the VM.
6. The drain gate on both hosts, once approved. It enables erasure after
   refresh.
7. Recovery-package restore on the VM.

Planned migration, the wallet-level recovery, factor and export coverage listed
in the [ownership map](./refactor-150-state-ownership-map.md), hosted
measurements and production changes each proceed on their own approval.
