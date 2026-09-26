# R150 tenant-root refresh: commit first, then roll forward

Status: the direction is approved (2026-09-26): a durable, commit-first refresh
decision followed by roll-forward delivery, with retired shares kept until
safe erasure is established. The commit point, roll-forward delivery and
pending retirement are implemented on Cloudflare (see "Implemented" below).
Refresh abandonment, admission during delivery and the VM adapter remain open.

Related: [creation resume](./refactor-150-tenant-root-creation-resume.md) (the same
policy for initial activation), [root retirement admission](./refactor-150-root-retirement-admission.md)
(when retired shares may be erased), and [Spec 6](./spec-6-tenant-roots-recovery-and-portability.md#refreshing-shares).

## Requirement

Spec 6 requires that a refresh keeps the tenant root's identity and derived
public keys, that "the roles save and verify their new material before it
becomes active", that "work already in progress follows the version it started
with", and that "old material is retired and erased only when the recorded
completion conditions allow it". R150 requires every enabled lifecycle
operation to pass the same contracts on the Cloudflare and VM adapters,
including lost responses after commit, crash and restart, and durable retries.

## Current order, and why a retry cannot repair it

`finish_cloudflare_router_tenant_root_refresh_v1`
(`crates/router-ab-cloudflare/src/strict_worker/router.rs:3476-3542`) runs:

1. The control plane issues a refresh-swap activation receipt, stamping
   `activated_at_ms` with its current time
   (`tenant_root_control_plane.rs:3742`).
2. Both Derivers swap to the new epoch in parallel: the new row becomes
   active and the old one retired.
3. The Router persists the receipt as its authoritative active state.
4. The Router immediately erases both retired shares (`RetiredAfterRefresh`
   cleanup).

Three facts make a stop between steps 2 and 3 unrecoverable:

- **A retry gets a different receipt.** Each issuance is a new signature over a
  new `activated_at_ms`, so a retry never presents the same bytes twice.
- **A swapped Deriver accepts only the exact receipt it swapped with.** A retry
  after the swap must match the active successor byte for byte
  (`tenant_root_role_runtime.rs:3651-3667`, "tenant-root refresh activation
  retry does not match the active successor").
- **A receipt is valid only inside its window.** Its activation time must fall
  within the ceremony window of at most five minutes (`validate_receipt_window`,
  `router-ab-core/src/derivation/tenant_root_activation_receipt.rs:1456`), and a
  first activation also requires freshness at the current time
  (`tenant_root_role_runtime.rs:3727`).

So if the Router stops after one or both Derivers swap, a retry obtains a new
receipt that the swapped Derivers refuse, inside or after the window. The
Router's active state still names the old epoch while one or both Derivers hold
only the new one active. Root reads match the epoch exactly (`load_active`), so
work at the Router's epoch fails closed at a swapped Deriver.

### Reproduced

`testTenantRootRefreshDeliveryAfterLoss` in the Workers harness was run against
the code before commit-first. It drops B's refresh activation only after A has
answered its own, then retries the same manual operation. It observed
(`R150_WORKERS_REFRESH_DELIVERY_OBSERVATION`):

- **After B's activation was lost**, the request returned HTTP 500 and the
  Router stayed at revision 3 with the attempt `executed` and uncommitted. A
  held epoch 1 retired and epoch 2 active. B held epoch 1 active and epoch 2
  pending.
- **The retry** failed even earlier than the analysis above predicted, before
  any receipt was issued. A's refresh execution looked for an active record at
  the Router's epoch 1, found it retired, and refused (`tenant-root
  role-private operation requires an active record`). The state stayed split,
  and no retry can move it.

The same order also erases the old shares at once, so work already admitted on
the old epoch cannot finish, contrary to Spec 6.

## Proposal

### The commit point

The Router's persisted refresh-swap receipt is the commit point, as the
persisted initial-activation receipt is for creation.

- **Before the commit**, the refresh is prepared: both roles have written,
  checkpointed and verified their replacement shares, backups and canaries.
  This is today's fence state `Executed`, which requires both installation
  checkpoints.
- **The commit** happens once, in one Router storage transaction. It stores the
  control plane's receipt, advances the active state to the new epoch and
  revision, and records delivery as pending for both roles. Nothing is
  delivered before it.
- **After the commit**, the decision is final. Retries deliver that exact
  receipt and never obtain another, so a retry after expiry delivers the same
  decision.

### Delivery after the commit

- **The Router records delivery.** Its active state names the committed receipt
  and each role's delivery as `pending` or `delivered`. "Decision committed" and
  "both Derivers ready" are separate facts.
- **A Deriver activates only on the Router's committed receipt.** Before
  swapping, the Deriver reads the Router's active state and requires a
  byte-identical receipt. It judges the receipt's freshness at its
  `activated_at_ms`, not at the current time. This mirrors
  `require_router_committed_initial_activation_v1` for creation. A correctly
  signed receipt the Router did not commit activates nothing, at any time.
- **Retries roll forward.** A retry of the refresh operation, or of anything
  that finds delivery pending, re-delivers the committed receipt to each
  pending role and records it as delivered. An exact retry returns the
  durable outcome.
- **New work waits for delivery.** A new root-using operation that finds a
  role's delivery pending must not assume the new epoch is live there.
  Proposed: the Router completes the pending delivery before admitting new
  root work, and fails with a retryable "refresh delivery in progress" if it
  cannot. The alternative, admitting on the old epoch until delivered, would
  let new work start on material that is about to be retired.
- **Work already admitted continues** on the epoch it started with, because the
  swap only retires the old row and does not erase it.

### Retirement stays pending

- **No erasure in the refresh path.** After both roles are delivered, each
  retired old-epoch share is kept. The refresh response reports retirement as
  `pending` rather than claiming it `confirmed`.
- **Erasure has one rule for both hosts.** It happens only through the safe
  retirement rule of the retirement-admission proposal. Until that rule is
  implemented and reviewed, erasure after refresh is release-gated on both
  hosts. The VM adapter never gets the immediate erasure, and the shared
  implementation removes it from Cloudflare too (open question 3).

### Before the commit, after expiry

A prepared but uncommitted refresh whose window has closed can no longer be
activated, because its receipt window has passed. As with creation, it must
be abandoned explicitly:

1. Fence the attempt in the Router's creation state, so no commit can follow.
2. Clean each role's pending new-epoch row, backup and canary with an
   issuer-signed command bound to that fence.

Today's pending cleanup is bound to the creation fence, so this needs a
refresh-scoped abandonment (open question 1). The old epoch stays active
throughout, so abandoning a refresh never affects availability.

## Implemented on Cloudflare (2026-09-26)

- **Commit first.** `finish_cloudflare_router_tenant_root_refresh_v1`
  (`strict_worker/router.rs`) persists the control plane's receipt in the
  Router's creation state before delivering it. If a concurrent retry
  committed first, its receipt is the one delivered.
- **Roll forward.** `deliver_cloudflare_router_committed_refresh_v1` delivers
  the committed receipt to both Derivers in parallel and returns the first
  failure. Every retry path delivers the committed receipt and never obtains
  another: an exact replay, a revision that moved, a terminal attempt before a
  new one, and a managed-restore replay.
- **Deriver check.** A Deriver's refresh activation requires the Router's
  committed receipt byte for byte (`require_router_committed_activation_v1`,
  shared with initial activation). The Router's commit replaces the check
  against current time.
- **Retirement pending.** The refresh path no longer erases. The retired share
  and its backup are kept, and the response reports `retirement:
  {"kind":"pending"}`. The control-plane `RetiredAfterRefresh` command and the
  Deriver's retired cleanup remain, unused, for the safe-retirement rule.

Not yet implemented:
- delivery status recorded per role at the Router (open question 2);
- refresh abandonment (open question 1);
- the VM adapter.

### Evidence

`testTenantRootRefreshDeliveryAfterLoss`, with the same fault as the
reproduction above:
- **First attempt:** HTTP 500. The Router is committed at revision 4 with its
  fence terminal. A holds epoch 1 retired and epoch 2 active; B holds epoch 1
  active and epoch 2 pending.
- **Retry:** HTTP 200 with the same receipt digest. Both roles hold epoch 1
  retired and epoch 2 active, with retirement `pending`.

The manual-refresh E2E, the managed-restore E2E and the signing-continuity
checks after refresh pass with the retired shares kept.

`--refresh-delivery-after-expiry` is an opt-in harness mode, because it waits
more than five minutes. It applies the same fault, then holds the retry for
310 s, past both the committed receipt's window and the refresh context's
lifetime. The retry still returns HTTP 200 with the committed receipt digest,
and both roles end on epoch 2
(`tenant_root_refresh_delivery_after_expiry_workers_e2e_v1`).

## Open questions

1. **Refresh abandonment.** A refresh-scoped fence and pending cleanup, reusing
   the creation abandonment's ceremony binding and tombstone, or a narrower
   rule. Until it exists, a prepared refresh that misses its window stays
   `Executed`, which blocks the next refresh without affecting signing.
2. **Admission during delivery.** Proposed: complete delivery before admitting
   new root work, as above. Needs confirming against the root-use admission
   gate, which checks the epoch at admission.
3. **Cloudflare's immediate erasure.** Proposed: remove it with this change, so
   both hosts follow one retirement rule and report `pending`. The alternative
   is to keep it on Cloudflare until the drain gate lands, which leaves
   Cloudflare violating Spec 6 in the meantime.
4. **Scheduled refresh on the VM.** R150 assigns scheduled work on VMs to
   persisted jobs processed by a restart-safe worker. The Cloudflare trigger is
   external; the VM needs its own documented trigger.

## Sequence and evidence

1. **Reproduce the current failure** on Workers and, once refresh is served
   there, the VM. Drop B's refresh-activation request after A has swapped, then
   retry: the E2E should show A refusing the new receipt and the Router and
   Derivers on different epochs.
2. **Host-neutral storage.** The Router's refresh state operations run over
   the host-neutral creation store (done in this slice). A new Workers E2E
   covers a manual refresh end to end, with the same outcome before and after
   the extraction.
3. **Commit first.** The Router commits the receipt and records delivery per
   role. The Deriver refresh activation requires the Router's committed
   receipt and judges it at `activated_at_ms`. The coordinator rolls forward.
4. **Retirement pending.** The refresh path stops erasing and reports
   retirement `pending` on both hosts.
5. **E2Es on both hosts:**
   - the step-1 fault now completes;
   - a stop after one role's delivery completes;
   - a delayed retry after the window delivers the committed receipt;
   - a signed but uncommitted receipt activates nothing;
   - new work during pending delivery is refused as retryable or completes
     delivery first;
   - retired shares remain after refresh.
6. **VM adapter.** Serve the refresh operations on the VM with the same
   coordinator, Deriver and control-plane code.
