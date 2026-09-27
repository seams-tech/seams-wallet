# R150: erasing the old epoch after a refresh

Status: implemented 2026-09-27, with its evidence, on branch
`codex/r150-do-backend`. Not deployed. The Router now erases each refresh's
retired epoch itself. Its prerequisites were done first (2026-09-27):
- settlement from the wallet-object pair store;
- cancellation that stops the whole execution;
- recovery of a claimed execution through its peer;
- replay of a completed step without the share.

See [admission identity and settlement](./refactor-150-admission-identity.md).

## How it works

- **The gate at each role.** A Deriver erases a retired share and its backup
  only once every admission on that epoch is settled or cancelled.
  - Recovery past `W` cancels only what can be fenced: an ECDSA attempt, or a
    Yao attempt Deriver A has not claimed. Its pair's claim and completion
    then refuse it, in the role store or in the wallet object that holds it.
  - A claimed attempt is recovered through its peer. Deriver B fences the
    session, or reports that it completed it, and only then is A's claim
    fenced ([admission identity](./refactor-150-admission-identity.md)).
  - A wallet object's completion is acknowledged to the role store. A lost
    acknowledgement is recovered by reconciliation.
- **The Router's record.** A committed refresh swap's delivery record names
  the epoch it replaced.
  - Each role's swap acknowledgement adds that role's part: the retired and
    active row revisions its cleanup command names, and when the Router
    recorded the swap.
  - Once the role erases the epoch, its signed cleanup receipt and its
    cancelled-admission count are added. The first erasure recorded wins.
  - A later pass therefore needs nothing from the retired row, which may be
    gone.
- **A pass.**
  1. It delivers the committed receipt to any role still waiting.
  2. At each role whose grace after the swap has passed, the control plane
     signs a fresh retired-cleanup command for the recorded revisions.
  3. The Deriver executes it.
  4. A role that cannot erase yet is reported pending, with its reason.
- **When passes run.**
  - Every refresh call runs one before its admission. So do an exact retry of
    a refresh, the next refresh, and each scheduled offer: the VM
    scheduler's tick, and the external scheduled trigger on Workers.
  - A refresh also runs one after its own delivery. That pass reports the
    new swap's grace.
- **One retired epoch per role at a time.**
  - The control plane signs cleanup only for the epoch the latest swap
    retired.
  - Admission therefore refuses a new refresh while the previous swap is not
    erased at both roles: HTTP 409 `tenant_root_retirement_pending`, with each
    role's retirement.
  - Replays, and throttled and not-due answers, keep their meaning.
  - Nothing bounds that wait. An unreachable role, or an execution that
    cannot yet be fenced, keeps it pending.
- **Restart safety.** Each pass requests a fresh command, and the control
  plane keeps no state for it.
  - A lost command reply just waits for the next pass.
  - A Deriver that erased and whose answer was lost answers a fresh command
    from its own store: the retired row is already gone.
  - A retry reports the recorded erasure exactly.
- **Warnings.** A nonzero cancelled-admission count is logged as a warning.
  It names the root, the lineage, the role and the epoch.
- **Grace.** `TENANT_ROOT_RETIREMENT_GRACE_MS` on the Router: five minutes
  by default, at least one second. It is policy only, and neither permits
  nor forbids erasure.

The refresh response's `retirement` names each role:
- `erased`, with `cleanup_receipt_b64u` and `cancelled_admissions`;
- `pending`, with a `reason`: the grace, the role's unsettled count, or why
  the role could not be reached;
- `superseded`: a replay of a refresh whose epoch a later refresh has since
  replaced. That later refresh was admitted only once this retirement had
  finished.

## A completed step replays without the share

An exact retry of a completed step is answered from its stored outcome,
before any root read. Waiting out the grace alone would only postpone the
problem.
- The Router's replay of a completed Yao operation reads only stored
  outcomes: both Derivers' completed pair records, or Deriver A's stored
  outcome in its wallet object.
- Deriver A's execute answers an exact retry from its completed record, before
  its receipts' freshness or any root read.
  - It already did so on the VM and in its wallet object.
  - The role store now keeps the request's digest and B's sealed execution
    for it.
  - A changed request is refused.
- An ECDSA retry after a refresh is a new attempt on the active epoch, so it
  never needs the retired share.

## Scope

- A managed restore's forward refresh retires through the same path.
- Moving authority (source retirement, cutover) stays excluded. It needs the
  fences in the [drain proposal](./refactor-150-root-retirement-admission.md).

## Known gap: needs design approval

A managed restore does not wait for the previous refresh's retirement. The
role it restores may be the very one that cannot erase.
- If that retirement is still pending when the restore's swap commits, the
  swap's record replaces it.
- The control plane signs cleanup only for the latest swap's retired epoch,
  so the older epoch then stays retired and unerased at the roles that had
  not erased it.
- The Router logs a warning when a restore proceeds this way.
- Erasing that epoch would need the control plane to sign cleanup for an
  older retired epoch, bound to the current active one.

## Evidence

- **VM** `vm_tenant_root_refresh_retires_its_old_epoch_once_its_work_settles`
  (`R150_VM_TENANT_ROOT_RETIREMENT_TRIGGER_E2E`). The grace is two seconds,
  `W` eight.
  1. A second registration is admitted only at Deriver B, then a refresh
     moves the root to epoch 2. Both roles report the grace.
  2. After the grace, a retry of the refresh is a pass. A erases epoch 1, but
     its answer is lost. B keeps epoch 1: one admission is unsettled.
  3. The next pass: A answers a fresh command from its store, and its
     erasure is recorded. B is now unreachable. A retry replays A's
     recorded erasure exactly.
  4. A new refresh is refused: 409 `tenant_root_retirement_pending`.
  5. B is reachable again, and `W` has passed. The new refresh's own pass
     has B cancel the stale admission and erase epoch 1. The refresh then
     completes on epoch 3.
- **Workers harness** `--retirement-trigger`
  (`R150_WORKERS_RETIREMENT_TRIGGER`), on role-store and wallet-object
  builds. The grace is one second, `W` thirty.
  1. A registration's execute is held over a refresh.
  2. After the grace, both roles keep epoch 1 while that work is unsettled.
  3. Released, the work completes on epoch 1.
  4. The next pass erases epoch 1 at both roles, and a retry replays the
     recorded erasures exactly.
- **Replay after erasure:** VM
  `vm_tenant_root_completed_registration_replays_after_its_epoch_is_erased`
  (`R150_VM_REPLAY_AFTER_ERASURE_E2E`), and the Workers harness
  `--replay-after-erasure` (`R150_WORKERS_REPLAY_AFTER_ERASURE`) on both
  builds.
- **Lost replies:**
  - A lost Deriver answer is shown on the VM.
  - A lost command reply leaves nothing to reconcile, since each pass asks for
    a fresh command.
  - The Router's record is its own creation state, written before a pass
    reports.
