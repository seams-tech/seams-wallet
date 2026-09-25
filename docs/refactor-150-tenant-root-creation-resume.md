# R150 tenant-root creation resume

Status: direction approved 2026-09-25; all three recovery paths implemented
and verified on the VM (below). Refresh, managed restore and retirement stay
gated and are not affected. This does not make R150 release-ready.

## The commit point decides the direction

The Router's persisted initial-activation receipt is the commit point of a
creation. Recovery depends on which side of it a failure falls:

| Failure | Before the ceremony expires | After it expires |
| --- | --- | --- |
| Before the commit, both roles installed | resume from durable evidence (implemented) | abandon both roles (implemented) |
| After the commit, zero or one Deriver active | re-deliver the committed receipt | re-deliver the committed receipt (implemented) |

Abandoning is never available after the commit: the committed receipt is the
authoritative decision, and one Deriver may already be active.

## Before the commit: the gap

`Ready` means both installation checkpoints are written. Activation then
needs a control-plane receipt over six public artifacts, and today those six
exist together only in Deriver A's initiator response to the Router. If the
coordinator stops after that response and before the Router persists the
receipt (a lost response, a failed control-plane call, a Router crash), a
retry reads `Ready`, finds no active state, and fails. This affects Workers
and the VM equally.

## What is lost, and who already owns it

| Artifact | Producer | Durable today | Existing owner |
| --- | --- | --- | --- |
| Deriver A installation evidence | A | yes | Router creation state, `BothRolesReady` checkpoint |
| Deriver B installation evidence | B | yes | Router creation state, `BothRolesReady` checkpoint |
| Deriver A signed managed backup | A | yes | A's managed-backup store (R2 / VM SQLite) |
| Deriver B signed managed backup | B | yes | B's managed-backup store |
| ECDSA provider canary receipt | A | **no** | A's managed-backup store, canary slot |
| Ed25519 provider canary receipt | B | **no** | B's managed-backup store, canary slot |

Only the two canary receipts are lost. Each Deriver writes its backup before
its row, commitment and installation checkpoint
(`persist_tenant_root_creation_progress_v1`), so both backups are durable
once the state is `Ready`. The checkpoint record already keeps both signed
evidences (`deriver_a_signed_evidence_b64u`, `deriver_b_signed_evidence_b64u`);
only the read projection hides them. The canary receipt is produced while
sealing (`compose_initial_tenant_root_role_runtime_v1`), returned in the
response, and never written.

The canary slot is not new. Refresh writes it (`put_verified_provider_canary`)
at the backup's coordinates, and partial-creation cleanup already deletes it
(today it reports the slot already absent).

## Fix before the commit (implemented)

1. **Persist the canary with its backup.** In
   `persist_tenant_root_creation_progress_v1`, write the role's canary
   receipt to the canary slot at the backup's coordinates, immediately after
   the backup and before the row, commitment and installation checkpoint. The
   invariant becomes: `Ready` implies all six artifacts are durable at their
   owners. The VM uses the same table, keyed by `provider_canary_object_key`,
   so no migration is needed. `TenantRootDeriverHostV1` gains put and get
   methods for the canary.
2. **Expose what the Router already stores.** The creation-state read returns
   both installation evidences in `BothRolesReady`, and says whether an
   initial activation is persisted. The resume then triggers on that fact,
   not on a read error.
3. **One read-only Deriver route.** For an initial pending row of
   (identity, lineage), each Deriver returns its stored signed backup and
   canary. It first verifies both with its own role key and checks they
   match the ceremony. The route refuses active rows, writes nothing, and
   takes the role-shared credential like the other tenant-root routes.
4. **Resume in the shared coordinator.** On `Ready` with no persisted
   activation, rebuild the control-plane activation request from 2 and 3,
   then continue unchanged: the control plane issues, the Router persists,
   and the Derivers activate. If the Router's persist conflicts because a
   concurrent resume won, re-read the active state and deliver that receipt.

The Router's persisted receipt stays the commit point. The control plane is
stateless, so issuing again is safe: a Deriver receives a receipt only after
the Router has persisted it, and a receipt the Router never persisted is
never delivered.

### Evidence: resume

`vm_tenant_root_ready_creation_resumes_from_durable_evidence`
(`R150_VM_TENANT_ROOT_RESUME_E2E`) drops the Router's activation request to the
control plane, so the Router stops after both roles are installed with
nothing committed. Both rows are pending and each role holds its backup and
canary. The retry resumes to ready from that evidence, an exact replay
returns the same response, and the evidence read refuses a share that is
already active. The partial-cleanup E2E now also sees B's canary removed.

### Before the commit, after expiry: abandonment (implemented)

An initial activation must fall inside the ceremony window
(`validate_receipt_window`; at most `TENANT_ROOT_MAX_LIFETIME_MS_V1`, five
minutes), so after it an uncommitted creation cannot finish. It is abandoned,
and nothing it abandons is active.

- **The fence decides.** `tenant_root_creation_persist_abandonment_v1` writes
  `creation/v1/abandonment` in the Router's creation state, recording the
  installed roles. It refuses a committed creation. It also refuses, while
  the window is open, a creation with no role or both roles installed, which
  can still finish or resume. Once the fence exists, the initial-activation
  commit, the commitment rendezvous and the installation checkpoint all
  refuse (`require_creation_not_abandoned_v1`). The fence and those writes
  live in one creation object, each in one storage transaction, so
  abandonment and activation exclude each other whichever arrives first.
- **Cleanup follows the fence.** The coordinator fences first, then cleans
  each installed role that is not yet cleaned: the control plane issues that
  role's cleanup command only for a fenced creation, the Deriver removes its
  pending row, managed backup and canary, and the Router checkpoints the
  Deriver's receipt under a per-role key. The one-role cleanup inside the
  window now runs behind the same fence. That closes a race in the previous
  order, where a role's row could be deleted before the checkpoint while the
  other role's installation landed.
- **Entry without the control plane.** The coordinator reads its own
  progress first. When the creation is uncommitted and either already fenced
  or past its window (the progress read reports `ceremony_open` by the
  creation state's clock), it abandons without asking the control plane to
  re-authorize the expired grant. The retry is refused with "expired before
  activation and was abandoned; a fresh grant is required". Replays report
  the abandonment and clean nothing twice.
- **Bounded limitation.** Each cleanup command's window starts at the fence
  (`abandoned_at_ms`), so every retry issues the identical command. If the
  coordinator stops between the fence and the end of cleanup and is not
  retried within five minutes, the Deriver refuses the stale command and
  that role's pending row stays behind. No activation can pass the fence, and
  a fresh grant is unaffected.

### Evidence: abandonment

`vm_tenant_root_uncommitted_creation_is_abandoned_after_the_ceremony_expires`
(`R150_VM_TENANT_ROOT_ABANDONMENT_E2E`) installs both roles, drops the
activation request, and has the control plane sign a receipt the Router
never commits. Inside the window, fencing is refused. After it, the retry
abandons: both rows, backups and canaries are removed, and the Router holds
one fence and two cleanup checkpoints. After the fence, the signed receipt
can neither be committed at the Router nor activate a Deriver. A replay
cleans nothing twice. A committed creation cannot be fenced, and a fresh
grant for the abandoned identity reaches ready.

### Fencing review (2026-09-26)

- **Every first activation is fenced.** Two writers can create a creation
  object's first active state: the initial-creation commit and the gated
  managed-restore activation. Both go through
  `tenant_root_creation_persist_active_state_v1`, which now refuses once the
  fence exists. Restore was already indirectly protected, because a
  destination bootstrap is only provisioned for an object without creation
  progress; the check no longer relies on that.
- **A concurrent commit wins over abandonment.** If a retry commits between
  another retry's progress read and its fence request, the fence is refused.
  That retry now re-reads the progress and delivers the commit instead of
  failing.
- **Open: a concurrent retry can abandon an in-flight creation.** Inside the
  window, a creation with one role installed is abandoned on retry, as it
  was before the fence. If the first coordinator is still running, the retry
  fences the creation, safety holds (no activation passes the fence), but the
  in-flight ceremony fails and its second role's row may be written after the
  fence, unrecorded. Recommendation: abandon one-role creations only after
  the window too. After expiry no Deriver accepts a role command, so the
  fence records every installed role. The retry would instead report that
  the ceremony is still open. Awaiting decision.



The Router can commit the receipt and then stop before either Deriver
activates, or between the two activations. Before this change a retry
finished only inside the ceremony window. After it, two checks refused the
retry and left the creation split, with the Router committed and zero or one
Deriver active:

- the only coordinator entry was the grant, and
  `control_plane_create_tenant_root_v1` rechecks grant freshness;
- a pending Deriver checked the receipt with `require_fresh(now_ms)`.

The same grant check made an exact replay of a completed creation fail once
its grant expired, instead of returning the durable outcome.

### Policy: delivering a committed receipt is not a new authorization

Freshness keeps gating every decision: grant admission, receipt issuance and
the Router's commit. Only delivery of an already-committed decision is
exempt, and only by matching the commit exactly.

1. **The coordinator reads its own commit first**
   (`committed_creation_for_grant_v1`). A typed Router progress read
   (`CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH`) reports whether a
   creation has started and returns any committed activation receipt. When a
   receipt is committed, the Router re-delivers it to both Derivers and
   answers with the same response the control plane would, built by the
   shared `create_tenant_root_response_v1`, without a control-plane call. The
   Router cannot verify the grant's signature, so it binds the grant to the
   creation another way (`tenant_root_creation_grant_opened_ceremony_v1`):
   the ceremony session id and nonce are SHA-256 of the exact grant bytes and
   are carried by the issuer-signed journal. A grant that does not reproduce
   them goes to the control plane as before.
2. **A Deriver activates only on the Router's committed receipt**
   (`require_router_committed_initial_activation_v1`). Before activating, it
   reads the Router's committed active state and requires a byte-identical
   receipt. It then judges freshness at the receipt's `activated_at_ms`, as
   the managed-restore branch already did. The commit check applies at every
   time, not only late: a correctly signed receipt the Router did not commit
   activates nothing.

Invariant: once the Router commits, the creation reaches both Derivers active
on some later retry, however late, and is never abandoned.

### Evidence

`vm_tenant_root_committed_activation_is_delivered_after_the_ceremony_expires`
(`R150_VM_TENANT_ROOT_POST_COMMIT_E2E`) routes the Router to each Deriver and
to the control plane through proxies:

- It drops the delivery to A (zero Derivers active) or to B (one active). The
  retry finishes both inside the window and after it expires. Each time it
  delivers the same committed receipt, and an exact replay after expiry
  returns the same response.
- It records the control plane's activation request and replays it, getting
  a second correctly signed receipt that the Router never committed. The
  pending Deriver refuses it, both inside the window and after expiry.

## Related finding, not fixed here

If Deriver A persists its pending row but stops before its commitment and
installation calls, while B's installation is recorded, abandonment cleans
B only. A's pending row, backup and (after step 1) canary remain. They do not
block a fresh grant, since rows are keyed by lineage, but they stay behind
as unreferenced sealed material that only A can discover.

## Alternatives rejected

- **Keep all six artifacts in the Router's creation state.** The Router would
  hold a second copy of each Deriver's backup ciphertext, giving one fact two
  owners.
- **Deriver A keeps its initiator response as a replay row.** A would durably
  hold B's backup and canary.
- **A new evidence store.** Not needed: every artifact already has an owner.

## Verification plan

After the commit: covered by the E2E above; the workerd harness runs the
changed Deriver activation on every creation.

Before the commit: resume and abandonment are covered by the E2Es above, and
the workerd harness writes and reads the canary on every creation. The
harness does not yet inject these faults on Workers; the shared code paths
are the same, and only storage (DO and R2 versus SQLite) differs.
