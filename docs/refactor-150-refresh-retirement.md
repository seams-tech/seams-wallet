# R150: erasing the old epoch after a refresh

Status: design decided in review, 2026-09-27. **The trigger is not
implemented**, so nothing erases automatically. Its prerequisites are done
(2026-09-27):
- settlement from the wallet-object pair store;
- cancellation that stops the whole execution;
- recovery of a claimed execution through its peer;
- replay of a completed step without the share.

See [admission identity and settlement](./refactor-150-admission-identity.md).

## Where things stand

- **The gate is implemented.** A Deriver erases a retired share and its
  backup only once every admission on that epoch is settled or cancelled.
- **Cancellation now stops the whole execution.** Recovery cancels only what
  can be fenced:
  - an ECDSA attempt;
  - a Yao attempt that Deriver A has not claimed. Its pair's claim and
    completion then refuse it, in the role store or in the wallet object
    that holds it.

  A claimed attempt is recovered through its peer. Deriver B fences the
  session, or reports that it completed it. Only then is A's claim fenced
  ([admission identity](./refactor-150-admission-identity.md)). It stays
  pending only while B cannot answer.
- **Wallet objects settle.** An object's completion is acknowledged to the
  role store. A lost acknowledgement is recovered by reconciliation, which
  reports the same completion.
- **A completed step replays without the share** (design item 4 below).
- **Nothing issues the command.**
  - The control plane signs a retired-cleanup command only when asked, with
    the role's exact row revisions.
  - No Router code asks, and Workers has no operator route to it.
  - Every refresh reports `retirement: pending`, and retired shares and
    backups stay.

## Design

1. **The Router retires once delivery is complete.** When both roles have
   acknowledged the swap, the Router asks the control plane for each role's
   retired-cleanup command and delivers it.
2. **It uses the revisions each role reported.**
   - A role's swap acknowledgement already carries `retired_revision` and
     `active_revision`.
   - The Router records them with that role's delivery, in its creation state
     next to the delivery status it already keeps.
   - A later pass then does not depend on the retired row, which may be gone.
3. **A settled epoch is kept for `W` after the swap.** This is operational
   policy only: it neither permits nor forbids erasure.
4. **A completed step replays without the share.** An exact retry of a
   completed step is answered from its stored outcome, before any root read.
   Waiting `W` alone would only postpone the problem. Done (2026-09-27):
   - The Router's replay of a completed Yao operation reads only stored
     outcomes: both Derivers' completed pair records, or Deriver A's stored
     outcome in its wallet object.
   - Deriver A's execute answers an exact retry from its completed record,
     before its receipts' freshness or any root read. It already did so on
     the VM and in its wallet object; the role store now keeps the request's
     digest and B's sealed execution for it. A changed request is refused.
   - An ECDSA retry after a refresh is a new attempt on the active epoch, so
     it never needs the retired share.
   - Evidence: VM
     `vm_tenant_root_completed_registration_replays_after_its_epoch_is_erased`
     (`R150_VM_REPLAY_AFTER_ERASURE_E2E`) and the Workers harness
     `--replay-after-erasure` (`R150_WORKERS_REPLAY_AFTER_ERASURE`), on
     role-store and wallet-object builds. A wallet registers on epoch 1, and
     epoch 1 is erased at both Derivers. The Router's replay then returns the
     original result, and Deriver A's exact retry its stored response.
5. **One retired epoch per role at a time.**
   - The control plane signs cleanup only for the epoch the latest refresh
     retired, so a second refresh would strand the first retired epoch.
   - The next refresh therefore first completes the previous retirement, and
     is refused as in progress while it is pending.
   - Nothing bounds that wait. An unreachable owner, or an execution that
     cannot yet be fenced, keeps retirement pending.
6. **Existing passes retry it.** Pending retirement is attempted again:
   - on an exact retry of the refresh operation;
   - before the next refresh is admitted;
   - on the VM scheduler's tick and the Workers scheduled trigger. Both
     already offer each root its scheduled refresh.
7. **Pending is a normal result.**
   - A role that answers "retirement is pending" does not fail the refresh,
     and the refresh completes.
   - The response reports each role as `erased`, with its cleanup receipt, or
     `pending`, with the unsettled count.
8. **Recovery warnings reach the log.** A nonzero `cancelled_admissions` is
   logged as a warning, naming the root, the role and the epoch.
9. **Scope.**
   - Refresh after a managed restore uses the same path.
   - Moving authority (source retirement, cutover) stays excluded. It needs
     the fences in the [drain proposal](./refactor-150-root-retirement-admission.md).

## Order of work

1. **Done (2026-09-27):** settlement from the wallet-object pair store,
   through an explicit, replay-safe path back to the role store that owns the
   admission.
2. **Done (2026-09-27):** cancellation that stops the whole execution, or
   leaves it pending.
   - Its VM E2E pauses an execution after its root reads, cancels, then
     retries.
   - The old execution causes no duplicate effect and reuses no one-use
     material.
3. **Done (2026-09-27):** recovery of a claimed execution through its peer
   ([admission identity](./refactor-150-admission-identity.md)).
4. **Done (2026-09-27):** completed-step replay that needs no share (design
   item 4).
5. **Next:** the trigger above.

## Evidence planned for the trigger

- **VM:**
  - A refresh, then its retirement erases both roles' epoch on a later pass,
    once `W` has passed.
  - With one unsettled admission, retirement stays pending.
- **Workers harness:** the same cycle.
- **Restart:** a lost reply at each step replays exactly. The steps are the
  command issue, its execution, and the Router's record.
