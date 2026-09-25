# R150 tenant-root creation resume

Status: proposed 2026-09-25, awaiting review. Not implemented. Refresh,
managed restore and retirement stay gated and are not affected. The
behaviour after the activation commit is measured by an E2E (see below);
both recovery policies here need approval before creation can be called
resumable.

## The commit point decides the direction

The Router's persisted initial-activation receipt is the commit point of a
creation. Recovery depends on which side of it a failure falls:

| Failure | Before the ceremony expires | After it expires |
| --- | --- | --- |
| Before the commit, both roles installed | resume from durable evidence (this proposal) | abandon both roles (needs approval) |
| After the commit, zero or one Deriver active | re-deliver the committed receipt (works today) | roll forward only (needs approval; today it stays split) |

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

## Proposed fix before the commit

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

### Before the commit, after expiry

An initial activation must fall inside the ceremony window
(`validate_receipt_window`; at most `TENANT_ROOT_MAX_LIFETIME_MS_V1`, five
minutes). After that the control plane cannot issue, and the resume returns
an explicit "ceremony expired before activation" error without changing
state. Recovery then means abandoning both installed roles and fencing the
ceremony, by extending the existing cleanup to two roles. That is a
fresh-attempt recovery and needs its own approval; it is not part of this
fix. No role is active in this state, so abandoning contradicts nothing.

## After the commit

The Router can commit the receipt and then stop before either Deriver
activates, or between the two activations. This gap exists today,
independently of the resume above.

### Measured today

`vm_tenant_root_committed_activation_is_redelivered_until_the_ceremony_expires`
(`R150_VM_TENANT_ROOT_POST_COMMIT_E2E`) drops one delivery after the Router
commits:

- Delivery to A lost, zero Derivers active: a retry inside the window
  re-delivers the committed receipt and both Derivers activate.
- Delivery to B lost, A active: a retry inside the window finishes, A
  replays its activation, and B activates.
- The same loss, retried after the window closes: the retry fails closed
  and the creation stays split, with the Router committed, A active and B
  pending. Two independent checks refuse it:
  1. The only coordinator entry is the grant, and
     `control_plane_create_tenant_root_v1` rechecks grant freshness
     (`authorize_tenant_root_creation_v1`). The retry never reaches the
     committed receipt.
  2. Delivering the committed receipt directly, the pending Deriver refuses
     it: `prepare_initial_activation_v1` runs `require_fresh(now_ms)` when it
     has no activation replay record. The active Deriver replays it.

The same grant check means an exact replay of a fully completed creation
also fails once the grant expires, instead of returning the durable
outcome.

### Proposed policy: delivery of a committed receipt is not a new authorization

Freshness keeps gating every decision: grant admission, receipt issuance and
the Router's commit. Only delivering an already-committed decision is exempt,
and only by matching the commit exactly.

1. **The coordinator reads its own commit first.** Before calling the
   control plane, the Router looks up the creation state for the grant's
   identity and lineage. If an initial activation is committed, it
   re-delivers that receipt and returns the durable outcome, without a
   control-plane call. The Router cannot verify the grant's signature (it
   does not hold the grant authority keys). It binds the grant to the
   committed creation another way: the ceremony session id and nonce are
   SHA-256 of the exact grant bytes (`derive_tenant_root_creation_ceremony_v1`)
   and are carried by the issuer-signed journal. A grant that does not
   reproduce them is refused. Re-delivery only ever sends the committed
   receipt, so it opens no new decision.
2. **A pending Deriver accepts a late receipt only if it is the committed
   one.** Past the receipt window, and with no replay record, the Deriver
   reads the Router's committed active state (it already calls the Router's
   creation state during creation). It accepts only a byte-identical
   receipt, and evaluates the window at the receipt's `activated_at_ms`. The
   managed-restore branch of the same function already does this for a
   durable decision. Any receipt the Router did not commit stays refused
   after expiry.

The resulting invariant: once the Router commits, the creation reaches both
Derivers active on some later retry, however late, and never abandons.

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

After the commit (policy above):

- The post-commit E2E already exercises the crash after the Router's commit
  and between the two Deriver activations. When the policy lands, its
  expired-retry assertions change: the retry returns ready with the same
  committed receipt and both Derivers active. It also gains the zero-active
  case retried after expiry.
- The same E2E adds a negative case: after expiry, a pending Deriver refuses
  a correctly signed receipt that the Router never committed. The receipt
  can be obtained by capturing the initial-activation request to the control
  plane and replaying it inside the window.
- An exact replay of a completed creation after its grant expires returns
  the durable outcome.
- workerd harness: the same crash points, injected with the harness-build
  flag pattern.

Before the commit (resume):

- VM E2E: a proxy in front of the control plane drops the initial-activation
  exchange once. The retry resumes to ready, with one active state at the
  Router, both rows active, and a canary in each backup store. A replay
  after restarting every role is unchanged.
- VM E2E for expiry: sign a short-window grant, fail activation, wait past
  expiry. The retry refuses explicitly and changes nothing.
- workerd harness: the same fault, injected with the harness-build flag
  pattern already used for `R150_TEST_ECDSA_INTERRUPT_AFTER_CLAIM`.
- The partial-cleanup E2E also asserts B's canary is removed.
