# R150 root-use admission and retirement drain

Status: unapproved review contract. No production wallet-DO routing or role-root retirement
change is enabled by this document. The clean reset of test wallets removes
existing-wallet conversion; this steady-state new-wallet race remains.

## Invariant and owners

Each Deriver owns its tenant-root share, lineage fence, and exact root-use
admissions in its role-private D1. Its wallet DO owns the pair record and its
execution fence. The Deriver executor and its peer-effect owner must prove that
an admitted execution can issue no further effects before the role releases a
drain obligation. A/B each apply this contract under separate credentials and
databases. Whole-custody cutover waits for both roles and the destination
activation protocol.

Root retirement fences future admitted root use and drains already-admitted
root-using effects. It does not retract a released signature or revoke
independent wallet lane material; those have separate owners and fences.

## Role-D1 admission

One transaction checks the exact active root identity, lineage, epoch, and
absence of a closing fence before creating an immutable admission. Its unique
key is the tenant-root identity digest, lineage, fixed role, wallet, and
canonical pair session. Pair digest, request digest, backend owner, root
epoch/revision, and later execution identity are immutable compared values,
never additional uniqueness selectors. The same session with different
request or pair digest conflicts, including under concurrent inserts. A lost
admission reply leaves one durable drain obligation. Replay and tombstone
evidence survives retirement.

Preparation has no execution ID yet. It creates the exact admission and DO
pair preparation under that identity. Role D1 is the sole start-binding
authority: a compare-and-swap changes `admitted/unbound` to `bound` with one
execution ID and exact start digest. It issues or reissues an authenticated
start grant only for that persisted winner. The wallet DO claims only that
grant after matching its stored pair scope and any terminal tombstone. D1
success followed by DO failure leaves the same bound obligation for retry or
cancellation; it never allocates another execution ID or returns to unbound.
Lost D1 and DO replies reconcile against the persisted winner. A root-share
read for an existing admission authorizes only that exact draining operation;
it never reopens general root access.

## Closing and quiescence

Retirement atomically changes the exact role-D1 lineage to `closing` and
rejects new admissions. Every committed admission remains a drain obligation,
including a lost grant reply or missing DO record. A closing/pending response
is distinct from completed retirement. The existing retirement completion
meaning stays unchanged until the replacement protocol is integrated.

Exact admission and terminal-outcome reads remain available after closing and
completed retirement for reconciliation and replay. They provide no new work
authorization or root-share access. Closing issues no new or replayed start
grants. A grant issued before closing may arrive late: the wallet DO must
resolve it against a terminal tombstone or a single running claim. Retirement
waits for that race to settle. A bound admission whose DO never started is
cancelled through the same durable tombstone procedure.

An admission that has not started may be cancelled only after its wallet DO
durably installs a terminal tombstone for the exact pair. The tombstone must
reject a delayed preparation or start, including when no pair row previously
existed. Missing DO state alone is not cancellation proof.

For a running execution, `Burned`, expiry, a timeout, process silence, or a
storage-only terminal state does not prove quiescence. The role-D1 obligation
remains until the executor and relevant peer-effect owners acknowledge that
they have stopped, or durable effect fences prove every later effect from that
execution will be rejected. A completed response can discharge the obligation
only if all applicable effects are settled and no executor can emit more work.
An ordinary response replay remains allowed and must never re-execute an
effect. If proof is unavailable, retirement stays pending without a timeout
shortcut.

Receipts have distinct branches. `CancelledBeforeStart` binds the exact
admission and the wallet DO's durable no-start tombstone; it has no execution
ID. `ExecutionQuiescent` binds those admission fields plus the persisted
execution ID, start digest, executor fence, and settled peer-effect receipts.
Both branches authenticate role, identity, lineage, epoch/revision, wallet,
pair/session, request digest, and backend owner. The role reconciles an exact
receipt idempotently into its immutable admission. The final role-D1
transaction retires live root records only while the same lineage is
closing and zero admissions remain unresolved. A concurrent new admission or
root replacement cannot pass that conditional check. A lost finalization
reply replays the same terminal receipt.

Quiescence mechanism remains a release blocker. The effect inventory must
cover Router retries, the Deriver A executor, the Deriver B peer executor,
their WebSocket/target-proof and Yao round messages, sealed completion
delivery, and any queued or restarted worker instance that can resend them.
SigningWorker package activation and Gateway wallet activation have separate
durable owners and must be accounted for by the whole-custody cutover. A
Yao-specific durable effect journal/fence is a candidate: each effect gets
one exact execution-bound identity before send; its recipient durably accepts
and deduplicates or rejects it; closing prevents new effect permits; and
restarts only reconcile recorded effects. A process acknowledgement alone is
insufficient. An effect is settled only after its authority durably accepts
or rejects it. The current A handler, B peer handler, and wallet DO store do
not yet implement this mechanism.

## Deterministic review tests

Run each schedule against DO SQLite and role-private VM SQLite:

1. Pause admission before its insert; close retirement; resume and reject.
   Reverse the commits and require retirement to wait.
2. Commit admission and lose its response; an exact retry finds one obligation.
   Race one session with different request and pair digests; both conflict
   against the immutable winner.
3. Delay preparation until after cancellation; the wallet tombstone rejects it,
   including when the DO was initially empty.
4. Pause a running executor after loading material and before peer send; burn
   its pair; retirement remains pending until a real effect fence or executor
   acknowledgement proves quiescence.
5. Let a peer commit an effect and drop its reply; retry preserves the single
   execution and retirement stays pending until reconciliation.
6. Lose the first execution-binding reply, then race two execution IDs before
   either reaches the DO; D1 retains one bound winner. Close between that
   binding and the DO claim; a delayed grant races the cancellation tombstone.
7. Deliver late prepare and start after terminal fencing; neither recreates a
   usable pair. An exact late terminal receipt may settle its pending drain
   obligation, while a changed completion cannot resurrect the pair.
8. Race last quiescence receipt with final retirement and new admission; the
   role-D1 zero-outstanding check remains consistent.
9. Restart at each boundary, including a duplicate executor after a purported
   quiescence acknowledgement. Reject delayed callbacks for a different
   lineage, epoch, role, wallet, or execution.
10. Replay a terminal admission after completed retirement; return the exact
    outcome without new work authorization. Restore an older schema or backup
    in a controlled test and prove its stale admissions and pair material
    cannot become active authority.
11. Produce `Burned` through the existing timeout path; demonstrate that it
    cannot discharge the retirement obligation without effect quiescence.

The current pair-store adapter tests establish local claims and replay only.
They do not satisfy these cross-owner schedules.
