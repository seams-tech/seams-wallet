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
  installed roles. It refuses a committed creation, and any creation whose
  window is still open. Once the fence exists, the initial-activation
  commit, the commitment rendezvous and the installation checkpoint all
  refuse (`require_creation_not_abandoned_v1`). The fence and those writes
  live in one creation object, each in one storage transaction, so
  abandonment and activation exclude each other whichever arrives first.
- **Cleanup follows the fence.** The coordinator fences first, then cleans
  each role that is not yet cleaned, installed or not (see ceremony-bound
  cleanup below): the control plane issues that role's cleanup command only
  for a fenced creation, the Deriver removes its pending row, managed backup
  and canary, and the Router checkpoints the Deriver's receipt under a
  per-role key. One-role cleanup now also runs
  behind the fence, and only after the window. That closes a race in the
  previous order, where a role's row could be deleted before the checkpoint
  while the other role's installation landed.
- **Entry without the control plane.** The coordinator reads its own
  progress first. When the creation is uncommitted and either already fenced
  or past its window (the progress read reports `ceremony_open` by the
  creation state's clock), it abandons without asking the control plane to
  re-authorize the expired grant. The retry is refused with "expired before
  activation and was abandoned; a fresh grant is required". Replays report
  the abandonment and clean nothing twice.
- **Cleanup finishes after any outage.** Each cleanup command's window
  starts at the fence (`abandoned_at_ms`), so every retry issues the
  identical command. Executing the fence is not a new decision, so neither
  side judges the command against the current time.
  - The Deriver reads the Router's creation state and requires a fence that
    records its role exactly when the command is bound to installation
    evidence, and that was written at the command's issue time. It then
    reserves the cleanup at the first instant after the fence
    (`tenant_root_abandonment_decided_at_ms_v1`).
  - The Router's checkpoint requires the same issue time and judges the
    command at the same instant.
  - A command for any other decision is still refused, at any time.
  - `vm_tenant_root_abandonment_finishes_after_a_long_outage`
    (`R150_VM_TENANT_ROOT_ABANDONMENT_OUTAGE_E2E`, ignored by default because
    it waits more than five minutes) loses the first cleanup command right
    after the fence, waits past the window and retries: both rows, backups
    and canaries are removed.

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
- **Abandonment only after the window (decided 2026-09-26).** An ordinary
  retry must not cancel a creation that may still be running, so the fence
  is refused inside the window for every installation state. A retry that
  finds one role installed inside the window reports that the creation can
  be abandoned once its window closes. Expiry stops new admission, but it
  does not stop a command admitted before it: that command can still write
  its row, backup and canary after the fence. The fence's installed roles are
  therefore not a complete list of what a role may hold, and cleanup must
  cover those late writes as well as crashes before installation
  checkpointing. Ceremony-bound cleanup (below) does.

### Ceremony-bound cleanup of unrecorded material (implemented)

A role the fence does not record as installed may still hold material: it
stopped after writing its row, backup and canary but before its installation
checkpoint reached the Router, or a command admitted before the window closed
writes after the fence. Abandonment now cleans both roles, not only the
recorded ones.

- **Two cleanup targets, chosen by the fence.** A role the fence records is
  cleaned by `TenantRootRoleCleanupTargetV1::Pending`, bound to its recorded
  installation evidence, as before. Any other role is cleaned by
  `TenantRootRoleCleanupTargetV1::AbandonedCeremony`, bound to the identity,
  lineage, role and the ceremony's session id and nonce. The control plane
  issues it only for a fenced creation, at the fence time, with a nonce
  derived from the journal digest and the role. The Router's checkpoint
  (`creation_cleanup_target`) derives the expected target from the fence, so
  one kind can never stand in for the other, and projects cleaned roles for
  both roles.
- **The Deriver requires the fence to match.** It reads the Router's fence and
  requires that the fence lists its role exactly when the command is
  evidence-bound, and that the command was issued at the fence. It also
  validates the Router's issuer-signed journal and requires the command's
  ceremony session and nonce to be that journal's, so even with no row
  present a command cannot tombstone a lineage for another ceremony.
- **Keys and liveness.** The control plane issues neither kind of command
  while the ceremony names a retired role signing key, because the Router
  would refuse the Deriver's receipt after the Deriver had acted. The
  coordinator attempts both roles' cleanups before reporting the first
  failure, so one role's failing cleanup does not hold back the other's.
- **The cleanup refuses active material and binds the ceremony.** A row
  present at reservation must be pending and must be this ceremony's: its
  creation command's replay record, keyed by the ceremony session and nonce,
  must exist. One batch deletes any pending initial row for the lineage and
  role, writes a tombstone (`tenant_root_creation_tombstones`, migration
  0012), and checkpoints the command, with count guards on the tombstone and
  the checkpoint. The managed backup and canary are deleted after every
  cleanup call, including exact replays.
- **Both roles are tombstoned.** A recorded role's evidence-bound cleanup
  writes the tombstone in the same batch as its row deletion
  (`clean_abandoned_pending`). Its creation had completed, so a retry of that
  command can only replay; the tombstone is what tells a late duplicate that
  its writes were abandoned.
- **Late writes.** The creation insert (`INSERT_INITIAL_CREATION_SQL`, used
  only by creation) is guarded by the tombstone, so a row that lands after
  the cleanup is refused in the same statement. Refresh and restore keep the
  unguarded insert. The creation path writes the backup, the canary, then
  the row. If that attempt does not commit its own row, whether a write
  failed, the tombstone refused the row, or a concurrent duplicate found
  another attempt's record, and the lineage is tombstoned, it deletes the
  role's initial backup and canary and reports that the creation was
  abandoned while the role was writing. Objects written before the tombstone
  are removed by the cleanup's own delete, which follows it, so either the
  writer or the cleanup removes them.

Residual: a Deriver that crashes between a late backup write and its
compensating delete, or whose tombstone lookup fails there, leaves an
unreferenced backup and canary. It holds no
row and can never activate. An ordinary retry of the grant skips roles the
Router has already checkpointed as cleaned, so it does not remove them. The
operator sweep below does. Sweeping automatically is a separate decision and
is not implemented.

### Operator cleanup of residual objects (implemented)

The sweep re-runs both roles' cleanup of one abandoned creation. It adds no
new authority: every deletion still goes through the same issuer-signed
cleanup command and the same fence checks as the abandonment.

- The Router refuses unless its creation state holds the abandonment fence
  (`only an abandoned tenant-root creation can be swept`). A creation that is
  open, committed or never started is refused.
- For each role, the control plane reissues the command it issued at the
  fence, byte for byte. The Router verifies it, and the Deriver confirms the
  fence and replays its terminal receipt. It then deletes that role's
  initial-epoch managed backup and canary. The Router replays its cleanup
  checkpoint.
- A role not cleaned yet is cleaned for the first time.
- A sweep records nothing new, so it is safe to repeat: an identical second
  call returns the same response.

**Finding candidates.** Residue exists only for a lineage a Deriver
tombstoned whose initial-epoch objects are still present. For each Deriver
(role `deriver-a` or `deriver-b`), list its tombstones:

```sql
-- VM: the role store at DERIVER_A_ROLE_PRIVATE_STORAGE_PATH or
-- DERIVER_B_ROLE_PRIVATE_STORAGE_PATH. Cloudflare: that Deriver's D1.
SELECT tenant_identity_digest_hex, custody_lineage_b64u
FROM tenant_root_creation_tombstones;
```

For each row, look for objects under
`tenant-root-managed-backup/v1/<role>/<tenant_identity_digest_hex>/<custody_lineage_b64u>/1`.
The backup is `1.bin` and the canary `1.provider-canary.bin`. On a VM they
are rows of `local_tenant_root_managed_backups` in the store at
`DERIVER_TENANT_ROOT_MANAGED_BACKUP_STORAGE_PATH`, keyed by `object_key`. On
Cloudflare they are objects in that Deriver's managed-backup R2 bucket.
Sweeping a lineage with no residue is harmless.

**Sweeping.** Call the Router's private route with the role-shared service
credential (`ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET`) in
`x-router-ab-internal-service-auth`. The identity digest goes as base64url of
its 32 bytes, not hex:

```bash
IDENTITY_DIGEST_B64U=$(python3 -c 'import base64,sys; print(base64.urlsafe_b64encode(bytes.fromhex(sys.argv[1])).decode().rstrip("="))' "$TENANT_IDENTITY_DIGEST_HEX")
curl -sS -X POST "$ROUTER_URL/router-ab/internal/tenant-root/creation/v1/sweep-abandoned" \
  -H 'content-type: application/json' \
  -H "x-router-ab-internal-service-auth: $ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET" \
  -d "{\"identity_digest_b64u\":\"$IDENTITY_DIGEST_B64U\",\"custody_lineage_b64u\":\"$CUSTODY_LINEAGE_B64U\"}"
```

A 200 response reports `abandoned_at_ms` and `swept_roles`. Re-check the
object listing afterwards.

### Evidence: unrecorded material and late writes

- `vm_tenant_root_unrecorded_material_is_cleaned_after_the_ceremony_expires`
  (`R150_VM_TENANT_ROOT_UNRECORDED_CLEANUP_E2E`) drops Deriver B's
  installation checkpoint after B's writes, so B holds a pending row, backup
  and canary that the Router never recorded, and A holds nothing. After
  expiry the fence records no role. Both roles are cleaned by the ceremony:
  no rows, backups or canaries remain, both lineages are tombstoned, and a
  replay cleans nothing twice.
- `vm_tenant_root_write_that_lands_after_the_fence_is_cleaned`
  (`R150_VM_TENANT_ROOT_LATE_WRITE_E2E`) holds B's answer to A until the
  window has closed and the Router has fenced the creation. A, admitted inside
  the window, then writes its backup, canary and row, and the Router refuses
  its commitment. A VM Deriver serves one request at a time, so A's cleanup
  runs after that late write and removes it: A's creation and cleanup
  commands both completed, and nothing remains.
- `vm_tenant_root_operator_sweep_removes_what_an_abandoned_creation_left`
  (`R150_VM_TENANT_ROOT_OPERATOR_SWEEP_E2E`) reproduces the residue by
  putting back B's backup and canary after its cleanup was checkpointed. An
  ordinary retry leaves them. The runbook's search finds exactly that
  lineage, and the sweep request built from its tombstone removes them. The Router's fence and
  checkpoints, each Deriver's completed commands and tombstones are unchanged,
  and a second sweep returns the identical response. Sweeps of an open
  creation, a committed one and one never started are refused. The late-write
  E2E also sweeps afterwards, replaying B's evidence-bound cleanup after its
  row is gone.
- On Workers, where a cleanup can land first, `testTenantRootCreationRecoveryPaths`
  holds B's answer through a late-writing Deriver A worker that shares A's
  database and bucket. The abandonment cleans and tombstones A before A
  writes; A's late row is refused, its backup and canary are removed, and
  its creation command stays reserved and never executes. The same test
  restores B's objects, sweeps through the Router Worker, and checks that the
  sweep removes them, repeats identically and refuses a committed creation.

### Independent review of the cleanup (2026-09-26)

A separate review of the ceremony-bound cleanup found no high-severity defect.
It confirmed that neither target kind can stand in for the other, that the
batches are atomic, that D1 and VM SQLite treat the new SQL alike, and that
an exact replay of an evidence-bound cleanup succeeds after its row is gone.
Its findings and what was done:

1. A late write was compensated only when persistence returned an error, not
   on a replay or in-progress outcome, nor when the canary write failed after
   the backup. Recorded roles had no tombstone to key it on. Now every
   attempt that does not commit its own row checks the tombstone, and both
   roles are tombstoned.
2. One role's failing cleanup stopped the other's. Both are now attempted.
3. A ceremony-bound command could be issued under a retired role key, then
   executed and refused at the Router on every retry. The control plane now
   refuses to issue it, as it already did for evidence-bound commands.
4. Reading a fenced creation loaded role keys even with no cleanup
   checkpoint to validate. They are now loaded only when one exists.
5. The tombstone guard sat in the insert shared with refresh and restore, so
   every insert needed migration 0012. Only the creation insert carries it
   now; creation still needs 0012 applied before the code that uses it.

The review also noted that the Deriver did not check the command's ceremony
against the Router's journal. It now does.

The new outcomes in item 1 are not covered by an E2E. Reaching them needs
two attempts of one role's command to pass the preflight before either
reserves, then a cleanup between that role's preflight and its backup write.
On a VM a Deriver handles one request at a time, and on Workers nothing
between those two steps can be intercepted. An initiator's duplicate cannot
get there anyway: its peer answers only one attempt. The operator sweep
removes anything such a race leaves.

## After the commit (implemented)

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

## Alternatives rejected

- **Keep all six artifacts in the Router's creation state.** The Router would
  hold a second copy of each Deriver's backup ciphertext, giving one fact two
  owners.
- **Deriver A keeps its initiator response as a replay row.** A would durably
  hold B's backup and canary.
- **A new evidence store.** Not needed: every artifact already has an owner.

## Verification plan

After the commit: covered by the E2E above.

On Workers, `testTenantRootCreationRecoveryPaths` in
`crates/router-ab-cloudflare/scripts/test-private-d1.mjs`
(`tenant_root_creation_recovery_workers_e2e_v1`) injects the same faults
through a `router-recovery` Worker whose Deriver and control-plane bindings
can each lose one initial-activation request. It covers resume, delivery of
a committed receipt after expiry, refusal of a signed uncommitted receipt,
and abandonment, after which the creation object refuses that receipt with
409.

Before the commit: resume, abandonment and ceremony-bound cleanup of
unrecorded and late-written material are covered by the VM E2Es above and by
the Workers recovery test.
