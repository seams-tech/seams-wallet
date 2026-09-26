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

## Proposed bounded mechanism (revised for review, 2026-09-26)

Status: proposal. The admission-and-drain direction is approved. This revision
answers the review of the first version (2026-09-25), which checked each
effect's deadline only when a recipient accepted it. That left open an effect
that starts just before its deadline and finishes afterward, and it did not
show that every recipient, SigningWorker included, enforces the rule. No
refresh, retirement, restore or cutover path is changed by this document.

### Current code facts

- **Refresh no longer erases at activation.** It keeps the retired share and
  reports retirement `pending` (commit-first refresh,
  [proposal](./refactor-150-refresh-commit-first.md)). Erasure waits for this
  rule.
- **Source retirement deletes at once.** It deletes the lineage in one batch
  and moves recovery attempts to `destroying`, with no closing state or drain
  (`tenant_root_role_d1/source_retirement.rs`). No test covers it.
- **Cutover takes caller-supplied receipts.** The `Drained` stage accepts a
  drain receipt from the caller, and nothing consumes `derivation_gate()`
  (`tenant_root_cutover_lifecycle.rs`).
- **Root reads match the epoch exactly** (`load_active`), and each re-checks
  the custody binding against the reading role's clock. The binding's
  lifetime is at most `TENANT_ROOT_MAX_LIFETIME_MS_V1` (300 s), accepted up to
  `TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1` (60 s) past expiry
  (`router-ab-core/src/derivation/tenant_root_custody_binding.rs:337-349`).
- **Yao already enforces a deadline where an effect commits.** A pair whose
  completion arrives at least `YAO_RUNNING_LIFETIME_MS` after start (20 s on
  Cloudflare, 60 s on the VM) is recorded `Burned`, not `Completed`
  (`ed25519_yao_lifecycle.rs:381-386`). A returns its execution to the Router
  only for a `Completed` pair.
- **SigningWorker commits root-derived material with no deadline.** This
  covers Yao package delivery and promotion, ECDSA derivation activation and
  refresh, and lane activation. Timestamps there are only metadata
  (`ed25519_yao_signing_worker.rs:1727-1849`; `lib.rs:8680-8830`;
  `signing_worker/ecdsa_lane.rs`). A completed execution's package can
  therefore be delivered and activated at any later time.
- **No root-use admission table or gate exists** on Cloudflare or the VM.

### The rule: deadlines are enforced where effects commit

A deadline that only gates acceptance says nothing about when an accepted
effect finishes. So the rule is enforced at every **commit point**: the
storage transaction that makes a root-derived effect count.

1. **Admission.** Every root-using operation commits an admission in its role
   store while the epoch's gate is `open`, before its first root read. The
   admission carries an immutable deadline `D = admitted_at + W`.
2. **The deadline travels with every root-derived effect.** `D` and the
   admission id are bound into the signed artifacts that cross roles:
   - readiness receipts and start grants;
   - Yao round and target-proof messages;
   - sealed completions;
   - SigningWorker activation packages;
   - ECDSA derivation results;
   - lane activations.
3. **Every commit point checks `D` inside its own transaction.** It commits
   the effect only if its clock reads at most `D`. Otherwise it records the
   effect as refused (as Yao's `Burned` does today) and the effect never
   counts. The commit points are listed below.
4. **Retirement.**
   1. CAS the gate `open → closing`. New admissions for the epoch fail.
   2. Wait until the retiring role's clock reads more than `D_max + 2S`,
      where `D_max` is the largest deadline among the epoch's admissions.
   3. In one conditional transaction, move the gate to `closed`, retire or
      erase the share, and record a signed gate-closed receipt. The
      transaction fails if any admission's `D + 2S` is still in the future.

The commit points that must check `D`, and whether each checks a deadline
today:

| Commit point | Owner | Checks a deadline today? |
| --- | --- | --- |
| Deriver root read (prepare, execute) | A, B | Yes, the custody binding at each read |
| Pair start admission | A (with B's acceptance) | Yes, readiness and prepared expiry |
| Pair completion | A and B | Yes, `YAO_RUNNING_LIFETIME_MS` → `Burned` |
| ECDSA derivation evaluation | Each Deriver | At its single root read |
| Router finalization of an execution | Router | No |
| SigningWorker package, activation, promotion, lane commit | SigningWorker | No |
| Gateway wallet activation | Gateway | Separate owner; ordered by cutover |

Router finalization and every SigningWorker commit need the check added.
SigningWorker is the decisive one: it is the last commit point of every
registration, recovery, export, derivation and lane operation.

### Why this bounds every effect

Assumption C: every role's clock is within `S` of true time.

- **A commit point commits only while its clock reads at most `D`.** Under C,
  every commit of an effect with deadline `D` happens at true time at most
  `D + S`.
- **Retirement finalizes only after its clock reads more than `D_max + 2S`.**
  Under C, that is true time more than `D_max + S`.
- **So every commit of every admitted effect happens before finalization.**
  An effect that started before its deadline and finished after it was
  refused at its commit point and never counted. Retransmitted, queued or
  restarted work is covered, because the check runs at commit, not when a
  message is sent or received.
- **Retirement waits at most `W + 2S`** after the last admission, and never
  waits on proof of executor quiescence.

What the rule does not reach:

- **Effects with no commit point that can check `D`.** Here durable completion
  evidence is still required, as in the contract above. With the table
  complete, none remains among the root-derived effects. Any new commit point
  must be added to the table before it ships.
- **Consequences after a legitimate commit.** SigningWorker signing later with
  material it activated in time is independent wallet material, which
  retirement does not revoke (see the invariant above). It needs no pushed
  gate-closed receipts: the deadline at its activation commit is enough.
  Pushing receipts to SigningWorker could let retirement finish early, but
  correctness does not need it.

### Choosing `W` from existing deadlines and timings

`W` must cover the longest legitimate span from admission to an operation's
last commit point.

| Operation | Existing deadlines on that span | Measured duration |
| --- | --- | --- |
| Yao registration, recovery, export (Cloudflare) | Router authority 60 s; readiness 60 s; custody binding 60 s + 60 s skew; running 20 s | Hosted Router execution 2.99–3.64 s (n = 2, `deployed-registration-baseline.md`); local workerd median 0.30 s, max 0.48 s (n = 40); native registration p95 0.10 s |
| Yao on the VM | Prepared 60 s; running 60 s; stream IO 30 s | Native p95 0.10 s; no VM-hosted measurements |
| ECDSA derivation | Request expiry up to 300 s; custody binding at most 300 s | Hosted respond 1.26–2.40 s, activate 1.49–3.53 s |
| Lane provisioning and refresh | Caller-supplied job expiry, no server maximum | None |

Proposal: **`W = TENANT_ROOT_MAX_LIFETIME_MS_V1` = 300 s**, the frozen maximum
lifetime every root-bound authorization already has.
- It covers the longest existing span, ECDSA derivation's 300 s request
  expiry.
- It is about 80 times the largest measured hosted duration.
- Each operation's own tighter deadline still applies inside it.

Two conditions come with it:
- **Lane jobs.** A job's expiry must be capped at `W` before lane operations
  can be admitted under this rule.
- **SigningWorker delivery.** Delivery must happen within `W` of admission. A
  completed execution whose package arrives later is refused and must be
  re-admitted, which is itself refused once the gate is closing.

### `S`: the clock assumption and how to enforce it

- **Value: `S = TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1` = 60 s.** It is the allowance
  the code already applies to every tenant-root ceremony and custody binding.
  In practice clocks are much tighter: Yao readiness and start acceptance
  already refuse more than 1 s of future skew, and those checks pass on both
  hosts.
- **Cloudflare.** Workers read the platform clock (`Date.now()`, which
  advances at I/O). The deployment cannot inspect how that clock is
  synchronised, so C is an operator-reviewed platform assumption.
- **VM.** Each role host must run disciplined time (for example chrony). Each
  role process checks its kernel synchronisation status (`ntp_adjtime`: not
  `STA_UNSYNC`, and estimated maximum error within `S / 4`) at startup and
  before every admission and retirement step. While the check fails, the role:
  - refuses new root-use admissions;
  - refuses to finalize retirement;
  - fails its readiness check.

  A VM without the check cannot establish C, so its retirement stays
  pending.
- **Detection on both hosts.** Every signed cross-role artifact already
  carries its sender's time. A recipient that sees a peer timestamp more
  than `S / 2` from its own clock refuses it and raises an alarm. A role found
  outside `S` is a custody incident: retirement stays pending until an
  operator reviews it.

If C cannot be established for a deployment, retirement there remains
pending. It is never finalized on a timeout alone.

### Coverage of each transition

| Transition | Application |
| --- | --- |
| Manual and scheduled refresh | After the refresh commit, close the old epoch's gate. The new epoch opens when it is delivered. Erase the old share only once closed |
| A/B epoch swap | Each role closes its own old-epoch gate. The Router records erasure only after both roles' gate-closed receipts exist |
| Source retirement | Replace the immediate delete with closing, the wait, and a closed-plus-delete batch |
| Managed restore replacing live authority | Close the live epoch's gate before the restored epoch is promoted |
| Custody cutover (separate approval) | `Drained` requires both roles' signed gate-closed receipts. `derivation_gate()` becomes the check SigningWorker and the Router consume before activating the destination |

### What it does not cover

- It does not retract a signature already released, or revoke independent
  lane material, SigningWorker activations or Gateway sessions. Those keep
  their own fences, and cutover orders them separately.
- It depends on assumption C. A clock outside `S` is a custody incident.
- A single deadline per admission bounds multi-round work to `W`. Longer work
  must re-admit per round, which is refused once the gate is closing.

### Deterministic tests to add

Run each on the VM and on Workers:
1. Pause an effect after acceptance and before its commit, and move the
   committing role's clock past `D`. The commit is refused and the effect
   does not count; retirement finalizes after `D_max + 2S` without it.
2. Deliver a completed execution's SigningWorker package after `D`. It is
   refused, and a re-admission is refused while the gate is closing.
3. Move one role's clock outside `S`. Admissions and retirement refuse, the
   readiness check fails, and retirement stays pending.
4. Race the last admission with closing. The CAS lets exactly one win.
5. Crash and restart at each commit point. Restarted or queued work is
   refused past `D`.

Tests need a controllable clock per role process. The VM adapter can take one
in test builds; Workers tests run against Miniflare's clock.

### Open review questions

1. Confirm `W` = 300 s, and the cap on lane-job expiry.
2. Confirm `S` = 60 s and the VM synchronisation check (`ntp_adjtime`, maximum
   error within `S / 4`). Decide whether to rely on Cloudflare's platform
   clock as an operator-reviewed assumption.
3. Whether the Router should count settled admissions so that retirement can
   finish before `D_max + 2S` when every admission has settled. This is
   optional; correctness does not depend on it.
