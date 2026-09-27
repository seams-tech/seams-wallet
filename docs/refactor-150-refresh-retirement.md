# R150: erasing the old epoch after a refresh

Status: proposal for review, 2026-09-27. It turns on erasure in production
code, so it waits for approval. Nothing here is implemented.

## Where things stand

- **The gate is implemented.** A Deriver erases a retired share and its
  backup only once every admission on that epoch is settled or cancelled
  ([admission identity and settlement](./refactor-150-admission-identity.md)).
  Recovery cancels an admission still unsettled `W` after it was admitted.
- **Nothing issues the command.**
  - The control plane signs a retired-cleanup command only when asked, with
    the role's exact row revisions.
  - No Router code asks, and Workers has no operator route to it.
  - Every refresh reports `retirement: pending`, and retired shares and
    backups stay.

## Proposal

1. **The Router retires once delivery is complete.** When both roles have
   acknowledged the swap, the Router asks the control plane for each role's
   retired-cleanup command and delivers it.
2. **It uses the revisions each role reported.**
   - A role's swap acknowledgement already carries `retired_revision` and
     `active_revision`.
   - The Router records them with that role's delivery.
   - A later pass then does not depend on the retired row, which may be gone.
3. **Existing passes retry it.** Pending retirement is attempted again:
   - on an exact retry of the refresh operation;
   - before the next refresh is admitted (see question 3);
   - on the VM scheduler's tick and the Workers scheduled trigger. Both
     already offer each root its scheduled refresh.
4. **Pending is a normal result.**
   - A role that answers "retirement is pending" does not fail the refresh,
     and the refresh completes.
   - The response reports each role as `erased`, with its cleanup receipt, or
     `pending`, with the unsettled count.
5. **Recovery warnings reach the log.** A nonzero `cancelled_admissions` is
   logged as a warning, naming the root, the role and the epoch.

## Questions for approval

1. **Erase at once, or keep a settled epoch for a while?**
   - **At once:** erasing as soon as every admission settles is the earliest
     safe point.
   - **The cost of at once:** a retry of a completed step whose reply was
     lost fails closed, and the operation must start again. For example,
     Cloudflare Deriver A's execute reads its share before it checks its pair
     record.
   - **Waiting `W` after the swap** lets those retries be answered. It only
     delays erasure; it never permits it.

   Recommendation: wait `W` after the swap.
2. **Where the per-role state lives.** Proposed: the Router's creation state,
   next to the delivery status it already keeps for each role.
3. **A second refresh before the first retirement completes.**
   - **The constraint:** the control plane signs cleanup only for the epoch
     the latest refresh retired. It reads that epoch from the active receipt.
     So a second refresh would strand the first retired epoch.
   - **Options:**
     - (a) the next refresh first completes the previous retirement, and is
       refused as in progress while it is pending. `W` bounds the wait,
       because recovery cancels what stays unsettled.
     - (b) the command names any retired epoch below the active one.

   Recommendation: (a). It keeps one retired epoch per role at a time.
4. **Scope.**
   - Refresh after a managed restore uses the same path.
   - Moving authority (source retirement, cutover) is excluded. It needs the
     fences in the [drain proposal](./refactor-150-root-retirement-admission.md).

## Evidence planned

- **VM:**
  - A refresh, then its retirement erases both roles' epoch on a later pass.
  - With one unsettled admission, retirement stays pending, and the epoch is
    erased after `W`.
- **Workers harness:** the same cycle, without `W` recovery.
- **Restart:** a lost reply at each step replays exactly. The steps are the
  command issue, its execution, and the Router's record.
