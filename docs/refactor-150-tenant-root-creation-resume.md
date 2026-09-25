# R150 tenant-root creation resume

Status: proposed 2026-09-25, awaiting review. Not implemented. Refresh,
managed restore and retirement stay gated and are not affected.

## The gap

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

## Proposed fix

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

## Not covered: expiry

An initial activation must fall inside the ceremony window
(`validate_receipt_window`; at most `TENANT_ROOT_MAX_LIFETIME_MS_V1`, five
minutes). After that the control plane cannot issue, and the resume returns
an explicit "ceremony expired before activation" error without changing
state. Recovery then means abandoning both installed roles and fencing the
ceremony, by extending the existing cleanup to two roles. That is a
fresh-attempt recovery and needs its own approval; it is not part of this
fix.

## Related finding, not fixed here

If Deriver A persists its pending row but stops before its commitment and
installation calls, while B's installation is recorded, the retry cleans B
only. A's pending row, backup and (after step 1) canary remain. They do not
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

- VM E2E: a proxy in front of the control plane drops the initial-activation
  exchange once. The retry resumes to ready, with one active state at the
  Router, both rows active, and a canary in each backup store. A replay
  after restarting every role is unchanged.
- VM E2E for expiry: sign a short-window grant, fail activation, wait past
  expiry. The retry refuses explicitly and changes nothing.
- workerd harness: the same fault, injected with the harness-build flag
  pattern already used for `R150_TEST_ECDSA_INTERRUPT_AFTER_CLAIM`.
- The partial-cleanup E2E also asserts B's canary is removed.
