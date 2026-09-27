# R150: erasing the old epoch after a refresh

Status: design decided in review, 2026-09-27. **Not implemented.** Automatic
erasure stays disabled until two things exist:
- settlement from the wallet-object pair store;
- cancellation that stops the whole execution.

See [admission identity and settlement](./refactor-150-admission-identity.md).

## Where things stand

- **The gate is implemented.** A Deriver erases a retired share and its
  backup only once every admission on that epoch is settled or cancelled.
- **Cancellation now stops the whole execution in the role store and on the
  VM.** Recovery cancels only what the store can fence:
  - an ECDSA attempt;
  - a Yao attempt that Deriver A has not claimed and whose pair is in the
    role store.

  The pair's claim and completion then refuse it. A claimed attempt, or one
  whose pair is in a wallet object, stays pending
  ([admission identity](./refactor-150-admission-identity.md)).
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
   Waiting `W` alone would only postpone the problem.
   - Today Cloudflare Deriver A's execute reads its share before it checks
     its pair record.
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

1. Settlement from the wallet-object pair store, through an explicit,
   replay-safe path back to the role store that owns the admission.
2. Cancellation that stops the whole execution, or leaves it pending. Its
   E2E pauses an execution after its root read, cancels, then restarts or
   retries. The old execution must cause no duplicate effect and reuse no
   one-use material.
3. The trigger above, with completed-step replay that needs no share.

## Evidence planned for the trigger

- **VM:**
  - A refresh, then its retirement erases both roles' epoch on a later pass,
    once `W` has passed.
  - With one unsettled admission, retirement stays pending.
- **Workers harness:** the same cycle.
- **Restart:** a lost reply at each step replays exactly. The steps are the
  command issue, its execution, and the Router's record.
