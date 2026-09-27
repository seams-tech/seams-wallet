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
| **Retiring and erasing old shares after refresh** | Spec 6: erase only when completion conditions allow; in-progress work keeps its version; one-use and retry safety | Retired shares and backups are kept; retirement reported `pending` | Nothing is erased | [Drain proposal](./refactor-150-root-retirement-admission.md), revised 2026-09-26 for review. Erasure stays release-gated on both hosts until then |
| **Availability restore** (one role from its managed backup, then a forward refresh) | Spec 6 availability backup; runbooks for object failure and recovery | Served, with a Workers E2E. A restored root refreshes again (defect below, fixed) | Served by the same control-plane, Router and Deriver code. VM backups are HPKE-sealed, and the restore opens them with the same provider | Done. A reservation that is never authorized still blocks refresh with no expiry (see the restore section of the VM setup) |
| **Recovery package and restore to a new deployment** (dormant, then operator activation) | Spec 6 restoring to a new deployment; recovery runbook | Served; no E2E | Not served | After availability restore. Largest slice |
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
