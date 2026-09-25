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
start grant only for that persisted winner while the lineage is open. The
wallet DO claims only that grant after matching its stored pair scope and any
terminal tombstone. D1 success followed by DO failure leaves the same bound
obligation for retry or cancellation; it never allocates another execution ID
or returns to unbound.
Lost D1 and DO replies reconcile against the persisted winner. A root-share
read for an existing admission authorizes only that exact draining operation;
it never reopens general root access.

The D1 binding commit is the grant's durable linearization point. Signing or
delivery may finish after closing if binding committed before it. A closing
lineage permits no new binding or grant issuance, and a later exact read
returns status without issuing another grant. An already committed grant is a
drain obligation even when its first delivery is delayed or its reply is lost.

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
existed. Cancellation also needs proof that any already-running preparation,
root read, readiness emission, or peer effect has stopped or settled behind
durable consumer fences. A no-start tombstone alone does not prove that an
in-flight preparer has stopped. Missing DO state alone is not cancellation
proof.

For a running execution, `Burned`, expiry, a timeout, process silence, or a
storage-only terminal state does not prove quiescence. The role-D1 obligation
remains until durable executor and peer-effect fences prove that all accepted
effects have settled and every later effect from that execution will be
rejected. A completed response can discharge the obligation
only if all applicable effects are settled and no executor can emit more work.
An ordinary response replay remains allowed and must never re-execute an
effect. If proof is unavailable, retirement stays pending without a timeout
shortcut.

Receipts have distinct branches. `CancelledBeforeStart` binds the exact
admission, the wallet DO's durable no-start tombstone, and preparation/effect
quiescence proof; it has no execution ID. `ExecutionQuiescent` binds those
admission fields plus the persisted
execution ID, start digest, executor fence, and settled peer-effect receipts.
Both branches authenticate role, identity, lineage, epoch/revision, wallet,
pair/session, request digest, and backend owner. The role reconciles an exact
receipt idempotently into its immutable admission. The final role-D1
transaction retires live root records only while the same lineage is
closing and zero admissions remain unresolved. A concurrent new admission or
root replacement cannot pass that conditional check. A lost finalization
reply replays the same terminal receipt.

Quiescence mechanism remains a release blocker. The effect inventory must
cover Router retries, Deriver A/B preparers and root-share readers, the
Deriver A executor, the Deriver B peer executor, readiness emissions,
their WebSocket/target-proof and Yao round messages, sealed completion
delivery, and any queued or restarted worker instance that can resend them.
SigningWorker package activation and Gateway wallet activation have separate
durable owners and must be accounted for by the whole-custody cutover. A
Yao-specific durable effect journal/fence is a candidate: each effect gets
one exact operation- or execution-bound identity before send; its recipient
durably accepts and deduplicates or rejects it; closing prevents new effect
permits; and
restarts only reconcile recorded effects. A process acknowledgement alone is
insufficient. An effect is settled only when its authority has durably
completed/quiesced its downstream work or durably rejected/fenced it against
future execution. Accepted-but-queued work remains an obligation. Deduplication
alone cannot prevent its first execution after retirement. The candidate also
needs an abort/drain path for active multi-round work; otherwise retirement
can remain pending indefinitely. The current A handler, B peer handler, and
wallet DO store do not yet implement this mechanism.

## Deterministic review tests

Run each schedule against DO SQLite and role-private VM SQLite:

1. Pause admission before its insert; close retirement; resume and reject.
   Reverse the commits and require retirement to wait.
2. Commit admission and lose its response; an exact retry finds one obligation.
   Race one session with different request and pair digests; both conflict
   against the immutable winner.
3. Delay preparation until after cancellation; the wallet tombstone rejects it,
   including when the DO was initially empty. Pause another preparer after a
   root read but before readiness emission; cancellation waits for its durable
   effect/quiescence proof.
4. Pause a running executor after loading material and before peer send; burn
   its pair; retirement remains pending until a durable execution/effect-fence
   proof covers duplicate and restarted executors and queued messages.
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

## Proposed bounded mechanism (for review, 2026-09-25)

Status: proposal. This section does not approve the contract above. It gives a
concrete candidate that bounds retirement time without treating silence as
proof. No refresh, retirement, restore or cutover path is disabled or changed
by it.

### Current code facts this must replace

- Refresh erases the retired share immediately. The Router activates both
  roles and then issues `RetiredAfterRefresh` cleanup straight away, without
  waiting for in-flight work (`strict_worker/router.rs:3620-3697`).
- Source retirement deletes the lineage in one batch and moves recovery
  attempts to `destroying`. There is no closing state or drain
  (`tenant_root_role_d1/source_retirement.rs:14-86`), and no test covers it.
- The cutover `Drained` stage accepts a drain receipt supplied by the caller.
  Nothing consumes `derivation_gate()`
  (`tenant_root_cutover_lifecycle.rs:1042`, `:1180-1193`).
- Root reads go through `load_active` with an exact epoch match. Work bound to
  a swapped epoch therefore fails closed at its next root read. An effect that
  has already read the root is not fenced.
- No root-use admission table or drain exists on Cloudflare or the VM.

### Mechanism: deadline-fenced root-use admissions, enforced by recipients

The fence is tenant-root-wide. It is keyed by (tenant-root identity digest,
lineage, epoch, role) and covers every wallet of that root.

1. **Gate.** Each role D1 gets one gate row per (identity, lineage, epoch):
   `open → closing → closed`. The gate lives in the same database as the
   share and changes in the same transactions as epoch swap, restore
   promotion and source retirement.
2. **Admission before any root read.** Every root-using operation must first
   commit an admission in the role D1 while the gate is `open` for the exact
   epoch. This covers Yao pair preparation and execution, ECDSA derivation and
   presign root use, lane provisioning and refresh, recovery and export.
   - The key follows the contract above.
   - Each admission carries an immutable `effect_deadline_ms`, set to
     `now + W`, where `W` is a protocol constant no longer than the pair
     readiness expiry.
   - A lost reply leaves one obligation, found by exact read.
3. **The deadline travels with every effect.** The deadline and the
   admission id are bound into every root-derived effect:
   - readiness receipts and start grants;
   - Yao round and target-proof messages;
   - sealed completions;
   - SigningWorker activation packages;
   - ECDSA derivation results.

   The sending role signs them.
4. **Recipients enforce the deadline at acceptance.** Each receiving role
   (the peer Deriver, SigningWorker, the Router coordinator) rejects any
   effect whose deadline has passed, using its own clock plus a bounded skew
   `S`.
   - Acceptance is judged when the effect is executed, not when it is
     received or queued, so queued and redelivered work is covered.
   - A recipient also rejects any admission id it holds a `closing` or
     `closed` gate receipt for.
5. **Retirement.**
   1. CAS the gate `open → closing`. New admissions for that epoch now fail.
   2. Wait until `now > max(effect_deadline_ms) + S` over that epoch's
      admissions.
   3. In one conditional transaction:
      - move the gate `closing → closed`;
      - retire or erase the share;
      - record a signed gate-closed receipt.

      The transaction fails if any admission's deadline plus `S` is still in
      the future, so a racing admission or replacement cannot pass. The wait
      is bounded by `W + S`.
6. **Early settlement is optional.** An admission whose operation reached a
   durable terminal outcome may be marked `settled` so reporting can ignore
   it. Retirement correctness does not depend on this: the deadline alone
   bounds when any effect can still be accepted.

### Why this satisfies the contract

- **Admitted, delayed, running and queued effects are covered.** Each carries
  a deadline that every recipient enforces when it acts on it. A running
  executor past its deadline cannot get any recipient to accept an effect.
  This is a recipient-side fence, not an executor timeout. `Burned`, missing
  DO records and process silence play no part.
- **No indefinite wait.** Retirement never waits on proof of executor
  quiescence, so it cannot stall. It waits at most `W + S`.
- **Historical records.** Admission and gate records survive closing for
  exact reconciliation. A historical receipt reads its outcome but can never
  authorize a new root read.

### Coverage of each transition

| Transition | Application |
| --- | --- |
| Manual and scheduled refresh | Close the old epoch's gate before `RetiredAfterRefresh` cleanup. The new epoch opens when it activates. |
| A/B epoch swap | Each role closes its own old-epoch gate. The Router issues cleanup only after both roles' gate-closed receipts exist. |
| Source retirement | Replace the immediate delete with closing, wait and a closed-plus-delete batch. The existing fence triggers stay. |
| Managed restore replacing live authority | Close the live epoch's gate before the restored epoch is promoted. The restored epoch stays pending until then. |
| Custody cutover | `Drained` requires both roles' signed gate-closed receipts instead of a caller-supplied receipt. `derivation_gate()` becomes the check that SigningWorker and the Router consume before activating the destination. |

### What it does not cover

- It does not retract a signature already released, or revoke independent
  lane material, SigningWorker activations or Gateway sessions. Those keep
  their own fences; cutover orders them separately.
- It depends on each role's clock. `S` must be an operator-reviewed bound,
  and a role whose clock is outside `S` must be treated as a custody incident.
- A single deadline per admission bounds multi-round Yao work to `W`. Long
  operations must either fit inside `W` or re-admit per round. Re-admission
  is refused once the gate is closing.

### Open review questions

1. The value of `W` for Yao registration, recovery and export on both hosts,
   and the acceptable `S`.
2. Whether SigningWorker should also reject activation packages for an epoch
   whose gate-closed receipt it holds, even inside the deadline. This is
   stricter and needs a push path for receipts.
3. Whether the Router should persist a per-epoch admission count so that
   retirement can finish early once every admission has settled.
