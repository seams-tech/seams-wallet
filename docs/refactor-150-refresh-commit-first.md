# R150 tenant-root refresh: commit first, then roll forward

Status: the direction is approved (2026-09-26): a durable, commit-first refresh
decision followed by roll-forward delivery, with retired shares kept until
safe erasure is established. The commit point, roll-forward delivery and
pending retirement are implemented and shared: the Router coordinator, the
Deriver refresh and activation, and the control plane run the same code on
Cloudflare and the VM (see "Implemented" and "Served on the VM" below).
Admission during delivery (open question 2) and refresh abandonment (open
question 1, implemented 2026-09-27) are done. A VM trigger for scheduled
refresh remains.

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

### Before the commit, after expiry: abandonment and supersession (implemented)

A prepared but uncommitted refresh whose window has closed can no longer be
activated: the control plane issues no receipt after the window. Until this
change it stayed `Executed`, and every later refresh of the root answered "in
progress". A retry of its own operation re-ran the expired commands, which
the control plane refused. So one lost response could stop a root from ever
refreshing again.

- **The fence decides.** The Router's refresh admission abandons the attempt
  once its ceremony window has closed by the creation state's clock.
  - The fence becomes `Abandoned`, the attempt's checkpoints are removed, and
    the operation that owned it is recorded as abandoned.
  - From then on the commit, the commitment and contribution rendezvous and
    the installation checkpoints refuse the attempt. They live in the same
    storage as the fence, so abandonment and commit exclude each other,
    whichever arrives first.
  - A retry of the abandoned operation answers 409
    `tenant_root_refresh_abandoned`. A new operation refreshes the root.
  - An admitted operation that holds no live attempt is abandoned once its
    authorization expires, so it cannot block other operations either.
  - Nothing is abandoned while a managed restore owns the fence.
- **No cleanup commands: the next attempt supersedes.** Every attempt of one
  transition writes the same next-epoch row and the same backup and canary
  keys, and R2 has no conditional delete. A cleanup that runs late or twice
  could delete a newer attempt's objects, even its active epoch's backup. So
  nothing deletes. The next attempt replaces what the abandoned one left, and
  only that:
  - Before its pending checkpoint, a Deriver loads the older attempts of the
    same transition, then confirms with the Router that its own attempt is the
    current one. The Router keeps one live attempt per root and abandons one
    before reserving the next. Every older attempt loaded before that
    confirmation is therefore abandoned for good.
  - One batch records each older attempt as superseded
    (`tenant_root_refresh_supersessions`, migration 0014), guarded on the state
    it was loaded with. The same batch removes the pending row one of them left
    and writes the new row and checkpoint. A superseded attempt's own
    checkpoints refuse from then on, so it cannot write that row back.
  - Backup and canary writes stay create-only. An object holding a superseded
    attempt's exact prepared bytes is replaced, conditionally on that stored
    version: R2 `etagMatches`, or the VM store's object generation. A
    concurrent writer is never overwritten.
- **What stays until the next refresh.** The abandoned attempt's pending rows
  and objects remain until the next attempt of the transition replaces them.
  They can never activate, because a Deriver activates only on the Router's
  committed receipt. Their erasure otherwise falls under the retirement rule,
  which stays disabled. The old epoch stays active throughout, so abandoning a
  refresh never affects availability.

### Evidence: abandonment

Both hosts run the same fault. Both roles install a refresh, and the Router's
request for its receipt is lost. The test replays that request to obtain the
attempt's correctly signed receipt, which the Router never committed. Both
tests wait past the five-minute window, so they run on request:
`vm_tenant_root_refresh_that_misses_its_window_is_abandoned_and_superseded`
(`--ignored`, `R150_VM_TENANT_ROOT_REFRESH_ABANDONMENT_E2E`) and the Workers
harness mode `--refresh-abandonment-after-expiry`
(`tenant_root_refresh_abandonment_workers_e2e_v1`). Each passed on its first
run, with identical observations:

- **After the loss:** the Router's fence is `executed` at the created
  revision. Each role holds epoch 1 active and epoch 2 pending, with the
  attempt's epoch-2 backup and canary.
- **Inside the window:** another operation answers 409
  `tenant_root_refresh_in_progress`.
- **After the window:** the stranded operation answers 409
  `tenant_root_refresh_abandoned`, and the fence is `abandoned`. The signed
  receipt is refused at the Router's commit (409) and at a Deriver's
  activation (500).
- **The next operation:** 200 at the next revision. Both roles hold epoch 1
  retired and epoch 2 active. Each role's epoch-2 backup and canary were
  replaced, and each recorded one superseded attempt.
- **Afterwards:** an exact replay returns the same body, and the stranded
  operation stays abandoned.

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

Delivery status per role (open question 2) and refresh abandonment (open
question 1) were implemented afterwards; see those sections.

## Served on the VM (2026-09-26)

The refresh is written once and run by both hosts:
- **Router.** `tenant_root_router_coordinate_refresh_v1`
  (`tenant_root_refresh_coordinator.rs`) runs over the Router's host:
  admission, attempt reservation, both Derivers' refreshes, the commit and
  delivery. The Workers Router and the VM Router both call it.
- **Derivers.** `tenant_root_deriver_refresh_v1` and
  `tenant_root_deriver_refresh_activation_v1` run over the Deriver host.
  Backups and canaries go through the host's store, and the rendezvous goes
  through the creation-state transport.
- **Control plane.** Refresh commands and the refresh-swap receipt were already
  shared.

The VM transport runs each private call on its own thread and awaits it. Both
Derivers' refreshes therefore run concurrently, as they do over Service
Bindings. They must: each waits at the Router's rendezvous for the other.

`vm_tenant_root_refresh_delivers_the_committed_receipt_after_a_lost_delivery`
applies the Workers fault on the VM: B's refresh activation is dropped after
the Router commits. It observed (`R150_VM_TENANT_ROOT_REFRESH_E2E`):
- **After the loss:** the Router is committed at revision 4 with its fence
  terminal. A holds epoch 1 retired and epoch 2 active; B holds epoch 1 active
  and epoch 2 pending.
- **The retry:** HTTP 200 with the committed receipt's digest. Both roles hold
  epoch 1 retired and epoch 2 active; retirement is `pending`.
- **An exact replay:** 200 with the same body.
- **A second operation:** 429 inside the manual-refresh interval.
- **Backups and canaries:** each role keeps both epochs' objects.

The lost delivery first surfaced as HTTP 400 on the VM and 500 on Workers:
the VM HTTP client classified every peer failure as a bad local request. It
now classifies them as Cloudflare does. A refused connection, an I/O failure,
a truncated or malformed response, or a peer's error status is a server-side
failure (500). A malformed route or credential from the caller stays 400. The
VM E2E now answers the lost delivery with 500.

**A VM rendezvous starvation, found and fixed.** Repeated runs of that E2E
failed 2 of 5 times with "refresh commitment rendezvous did not receive both
roles".
- **Timing:** both Derivers started polling within 2 ms of each other.
  Deriver A made its 32 polls about 21 ms apart, while B's single commitment
  write took about 1.5 s.
- **Cause:** the VM Router served each creation-state operation in its own
  IMMEDIATE SQLite transaction. SQLite's busy handler makes a waiter sleep
  between attempts, so A's tight polling kept winning the lock, and B's write
  kept missing it.
- **Fix:** a Durable Object runs one operation at a time and wakes the next.
  The VM Router now takes an in-process lock around each operation, which
  wakes the next waiter on release. SQLite already serialized these
  operations, so this adds no new restriction.
- **Result:** 8 of 8 runs pass, with each Deriver needing 3 polls in total.

The rendezvous itself still polls without a pause, 32 times, on both hosts.
Its tolerance for one role starting late therefore depends on round-trip
latency. That has not failed on either host since, but it remains a liveness
margin rather than a bound.

**Work in progress keeps its epoch.** Spec 6 says work already in progress
follows the version it started with. Every Deriver root read now loads the
exact epoch its custody binding names, including a retired one
(`load_bound`; see the
[retirement-admission proposal](./refactor-150-root-retirement-admission.md#two-purposes-two-rules)).
A binding that names an epoch still pending at that Deriver is refused, so
new work never assumes an undelivered epoch is live. That refusal is in the
code but not yet exercised by an E2E. An E2E pauses a Yao
registration across a refresh on the VM and shows both behaviours: with
`load_active` A refuses the held work, and with `load_bound` it completes.

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

1. **Refresh abandonment.** Implemented (2026-09-27) with a narrower rule than
   creation's: a refresh-scoped fence at the Router, and supersession by the
   next attempt at each Deriver instead of issuer-signed cleanup commands. See
   "Before the commit, after expiry" above.
2. **Admission during delivery.** Implemented (2026-09-26):
   - **Tracking:** the Router records each Deriver's delivery of the committed
     receipt, initial or refresh, in its creation state. The commit records
     both roles pending, and each acknowledged activation marks one
     delivered.
   - **Gate:** every Router admission of root work goes through
     `tenant_root_router_admission_receipt_v1`. That covers Yao on both hosts,
     and ECDSA registration, export and activation refresh on Cloudflare.
     Before issuing a binding, the gate delivers a pending receipt. If a
     Deriver cannot be reached, it answers `LifecycleTransitionInProgress`
     (HTTP 503), which the Gateway retries.
   - **Backstop:** a Deriver refuses an epoch it has not activated, even when
     a binding names it.
   - **Evidence:**
     `vm_tenant_root_new_work_waits_for_the_committed_epoch_delivery`
     (`R150_VM_TENANT_ROOT_DELIVERY_GATE_E2E`).
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
   coordinator, Deriver and control-plane code (done; see "Served on the
   VM").
