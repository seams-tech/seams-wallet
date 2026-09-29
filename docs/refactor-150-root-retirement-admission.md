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

## Proposed mechanism (third revision for review, 2026-09-26)

Status: proposal. The admission-and-drain direction is approved; this
mechanism is not.
- **Refresh retirement's gate is implemented** (2026-09-27). The
  retired-cleanup command erases only once the epoch's admissions are settled
  or cancelled.
- **The Router issues it** (2026-09-27): once delivery is complete and the
  grace after the swap has passed, on later refresh passes. The next refresh
  waits for both roles to erase
  ([refresh retirement](./refactor-150-refresh-retirement.md)).
- **Moving authority** is not implemented.

### What the earlier revisions could not prove

The second revision enforced a deadline `D` at every commit point, "commit only
if this role's clock reads at most `D`", with `S = 60 s` as the clock bound.
Review found two gaps, and neither can be closed with time alone.

1. **`S` is a tolerance, not a measured bound.** Sixty seconds is the skew the
   code accepts, not an established limit on clock error. The clock that
   matters is every committing recipient's, including SigningWorker's, not
   only the admitting or retiring role's. Most of those recipients cannot
   report how well their clock is synchronised.
2. **A time check does not bound when the commit happens.**
   - On deployed Workers, `Date.now()` and `performance.now()` do not advance
     while code runs, only after I/O
     ([Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/performance/)).
     A reading taken before a storage call can therefore be stale by the
     length of the computation before it, and the commit itself is a later
     I/O.
   - Local `workerd`/Miniflare timers behave differently, so local tests can
     miss this.
   - On any host a process can pause between the check and the commit, for
     example through scheduling, garbage collection or VM suspension, with no
     upper bound.

   A check inside a transaction proves only that the clock read at most `D` at
   some earlier moment. This is the familiar lease problem: without a bound on
   pauses, a time-based lease cannot give safety.

So time cannot be what makes retirement safe. The revision separates the two
reasons for retiring a share and gives each a rule that does not depend on a
clock bound.

### Two purposes, two rules

**Refresh retirement: in-progress work finishes on its own epoch.** A refresh
keeps the root and every derived public key (Spec 6). That does not make
results from different epochs interchangeable. Transcripts, authorizations,
partial contributions and one-use records are bound to their epoch, and Spec 6
says work already in progress follows the version it started with. So a
retired share may be erased only once no admitted work can still need it:

1. **Close the old epoch's gate** to new admissions in the role store. New
   root-using work is bound to an epoch by its control-plane custody binding,
   which names the epoch and the activation receipt digest. Each Deriver
   resolves its share against that binding
   (`resolve_authoritative_active_tenant_root_pair_binding_v1`), so once the
   refresh is committed and delivered, new bindings name the new epoch.
2. **Let admitted work read its exact retired epoch.** Keeping the retired row
   was not enough: root loading went through `load_active`, which finds only
   the active epoch. Implemented (2026-09-26): every Deriver root read now
   goes through `load_bound` (`tenant_root_role_d1.rs`). It loads the exact
   row the authenticated custody binding names.
   - **Active row:** `load_active`, unchanged.
   - **Retired row:** returned only when every binding field matches the
     activation evidence the row retained: identity, lineage, epoch, role,
     this role's commitment, and the activation receipt that made the epoch
     active.
   - **Pending or absent row:** refused.

   There is no read without an exact binding.

   **Durable admission (implemented 2026-09-26).** A binding proves which
   material a request names, but not that its operation began before the
   epoch closed. So each Deriver records the admission itself, in its role
   store (`tenant_root_root_use_admissions`, migration 0013).
   - **Admitting:** `admit_bound` inserts one row per execution attempt: a
     Yao pair session, or an ECDSA operation on one epoch
     ([admission identity](./refactor-150-admission-identity.md), migration
     0015). The insert is conditional on the binding's epoch being the active
     row, so it is ordered exactly against the refresh swap in the same store.
     A retry of the attempt must match its binding apart from the window.
   - **When it runs:** at the operation's first step at that Deriver. The Yao
     preparation admits on both hosts: on Cloudflare its root read admits, and
     on the VM the prepare handler admits explicitly.
   - **Reading:** `load_bound` admits first. It returns a retired share only
     to an operation admitted before the swap.
   - **Refusals:** both are the retryable `LifecycleTransitionInProgress`.
     An unused binding for a closed epoch is told "retired here before the
     operation was admitted; start it again". A binding for an epoch not yet
     active here is told to retry.

   The admissions are also the obligations that settlement (step 3) must see
   resolved.
3. **Erase only after durable settlement or fenced cancellation of every
   old-epoch admission.** Each admission must have either:
   - a durable terminal outcome, or
   - a cancellation behind a durable fence that refuses any later step.

   Elapsed time alone never permits erasure. Implemented 2026-09-27 for
   refresh retirement ([admission identity and settlement](./refactor-150-admission-identity.md)).
   An admission's status is the record of settlement or cancellation, and
   the retired-share delete checks it in the same statement.
4. **`W` warns and triggers recovery; it never permits erasure.** When an
   old-epoch admission is unsettled `W` after the gate closed, operators are
   warned and the owning operation's recovery (fenced cancellation, or
   completion) is started. Retirement stays pending until each is settled.

Restarting in-progress work on the new epoch would be a behaviour change to
Spec 6. It needs its own explicit, verified recovery transition and approval,
and is not proposed.

**Moving authority: source retirement and cutover, where safety is at stake.**
Only one deployment may be the root's active authority (Spec 6). The rule must
hold under arbitrary delays, so it uses fences, not time:

1. Close the gate to new admissions in each role store.
2. **Fence every terminal commit point.** A terminal commit point is one whose
   commit makes a root-derived effect count for anyone else:
   - SigningWorker package, activation, promotion and lane commits;
   - Router finalization;
   - Gateway wallet activation.

   For each one, the retiring side sends a signed epoch fence naming the
   identity, lineage and epoch. The owner records the fence durably, and from
   then on every commit it makes checks the fence in the same transaction as
   the commit and refuses a fenced epoch. It returns a signed acknowledgement
   of the recorded fence.
3. **Finalize only after every owner has acknowledged.** Retire or erase the
   share once all acknowledgements are held. Before that, retirement stays
   pending, however long it takes.

Why this is safe without a clock:
- An effect's commit runs in the owner's store, in the same transaction as
  its fence check.
- Every commit that owner makes after recording the fence is refused,
  whatever the committing process's clock reads and however long it paused.
- Every commit before the fence happened before the acknowledgement, and so
  before finalization.

In-flight work whose terminal commit is refused fails and does not count.
Intermediate commits in the old deployment (a wallet-DO pair record, a role
store) cannot make anything count on their own. Their results reach users or
other roles only through a terminal owner, and that owner is fenced.

Owners in the old deployment's own stores do not need the fence pushed to
them, because nothing of theirs is terminal. SigningWorker, the Router and the
Gateway do, since their commits are terminal.

**Coverage is not yet proven.** Before this rule can be approved it must show
two things.

- **Releases as well as commits.** Some operations release root-derived
  results to a caller without a durable terminal commit:
  - Yao export returns key material;
  - recovery returns its outcome.

  A release can be fenced only where it is authorized, so each release path
  must be listed, with the store that authorizes it and whether that store
  checks the fence in the same transaction.
- **Every per-wallet owner, including new ones.** SigningWorker's target store
  is one Durable Object per wallet, and a fence pushed to known wallets misses
  a wallet object created while the gate is closing. The rule needs one of:
  - a tenant-wide fence authority that every per-wallet commit consults
    atomically, or
  - a creation path for per-wallet owners that is itself fenced.

  Neither exists yet.

### What this changes relative to the second revision

- **The time check is dropped.** "Commit only while the clock reads at most `D`"
  is no longer a safety rule. `W` is kept only to warn and to trigger recovery
  for unsettled admissions.
- **`S` has no role in safety.** Clock health remains an operational signal:
  - On a VM, checking the kernel's synchronisation status is still
    recommended.
  - On both hosts, peer timestamps in signed artifacts that differ from the
    recipient's clock by more than a threshold raise an alarm.

  Neither blocks retirement unless an operator decides it should.
- **SigningWorker gains an epoch-fence record.** Today it binds
  `root_share_epoch` into its material. Its commit paths compare that epoch
  only between active and candidate material, never with a retired or fenced
  epoch of the tenant root. It needs:
  - a fence table keyed by identity, lineage and epoch;
  - a conditional check of that table in every commit that installs
    root-derived material;
  - a signed acknowledgement of each recorded fence.

  The Router's finalization and the Gateway's wallet activation need the same.
- **Commit-first refresh provides one refresh precondition.** The Router
  commits the new epoch before delivery, and the old epoch keeps its retired
  share. Work bound to that epoch can now read it (step 2 above).

### Choosing `W`

`W` is when an unsettled old-epoch admission raises a warning and starts its
operation's recovery; it never permits erasure. Every root-bound
authorization already has a frozen maximum lifetime of 300 s
(`TENANT_ROOT_MAX_LIFETIME_MS_V1`), the longest existing span is ECDSA
derivation's 300 s request expiry, and the measured hosted durations are 3 to
4 s. So `W = 300 s` remains the proposal.

### Tests before any erasure is enabled

On the VM and on Workers:

1. **In-flight work across an epoch switch.** Pause each operation after its
   first root read, then refresh (commit and delivery):
   - Yao registration;
   - recovery;
   - export;
   - ECDSA derivation.

   Resume it. It reads its exact retired epoch and completes, and a request
   bound to the retired epoch without having been admitted is refused.

   Done for Yao registration on the VM:
   `vm_tenant_root_work_admitted_before_a_refresh_finishes_on_its_epoch`
   (`R150_VM_TENANT_ROOT_WORK_ACROSS_REFRESH_E2E`).
   - **Setup:** a registration is admitted and prepared on epoch 1, and its
     execute is held before Deriver A reads it. A manual refresh then commits
     epoch 2, and both roles swap.
   - **With `load_active`:** on release, A refuses with "tenant-root active
     role share does not match authenticated custody binding", and the Router
     burns the pair (`peer_uncertain`).
   - **With `load_bound`:** A answers 200 and the registration succeeds. The
     held request's binding carries the epoch-1 receipt.

   The refusal of an unused binding is covered on the VM by
   `vm_tenant_root_binding_unused_before_its_epoch_closes_starts_nothing`
   (`R150_VM_TENANT_ROOT_UNUSED_BINDING_E2E`).
   - **Setup:** a registration is admitted by the Router on epoch 1, and B
     prepares and admits it. A's preparation is held while a refresh swaps
     both roles.
   - **Result:** on release, A refuses it and admits nothing. The Router
     answers `recoverable_failure`. A fresh registration is then admitted on
     epoch 2 at both roles and completes. B's epoch-1 admission remains, an
     obligation for settlement.

   On Workers, the harness's `--admission-races` mode, also part of the
   full run, applies both schedules (`R150_WORKERS_TENANT_ROOT_ADMISSION_RACES`)
   and gets the same results.
   - **Unused binding:** Deriver A answers the held preparation with 503
     `recoverable_failure`; its log gives "retired here before the operation
     was admitted". The registration answers `recoverable_failure`, and
     admissions are A [] and B [1], then A [2] and B [1, 2] after a fresh
     registration.
   - **Pending delivery:** new work gets 503 while B is pending, and completes
     once B is reachable.

   Both refusals are retryable for the whole operation, which re-admits on
   the new epoch.
   - **Deriver:** reports both as `LifecycleTransitionInProgress`.
   - **Service calls on both hosts:** keep that code from a peer
     (`router_ab_peer_error_code_v1`), where every other peer failure becomes
     `InvalidLocalServiceConfig`.
   - **Workers Yao:** the pair store keeps the code across its error boundary,
     and the role-failure classification answers `recoverable_failure`.

   **ECDSA derivation on Workers** (`--ecdsa-across-refresh`, also part of
   the full run; `R150_WORKERS_ECDSA_ACROSS_REFRESH`). Each Deriver is
   called once per ECDSA operation and admits it at its root read.
   - **Setup:** a registration's call to Deriver B is held after A has
     admitted it on epoch 1, while a manual refresh moves the root to epoch
     2.
   - **Result:** on release, B refuses it, "retired here before the
     operation was admitted", and the Router answers 503
     `LifecycleTransitionInProgress`. The same registration, retried, is
     admitted on epoch 2 by both roles and forwarded.
   - **Scope:** ECDSA is not served on the VM (Phase 0 decision 1).

   The harness's ECDSA activation is answered from the Router's stored
   result without calling the Derivers. So the existing check that
   activation stays byte-identical after a refresh shows replay, not a fresh
   root read; the registration test above is the one that reaches the
   Derivers.

   **Not covered: Yao recovery and export.** Neither host's harness drives
   them.
   - **Export:** needs an export binding with an authorization digest from
     the step-up flow, which the VM does not serve.
   - **Recovery:** needs credential flows that neither harness has.
   - **Shared path:** both would run the prepare and execute path that the
     registration E2Es exercise, admitting at preparation and reading
     through `load_bound`.

   Dedicated E2Es need those flows built first.
2. **Settlement before erasure.** With one old-epoch admission unsettled,
   retirement stays pending past `W`, raises its warning and starts recovery.
   It proceeds only after that admission's terminal outcome or fenced
   cancellation.

   Done for the operator-issued retired cleanup (2026-09-27):
   - **VM:** `vm_tenant_root_retired_epoch_is_erased_only_after_its_admissions_settle`
     covers pending, `W` recovery, erasure and the cancellation count.
   - **Workers:** the harness's `--admission-races` covers the pending
     refusal and the erasure.
   - **Also on the VM (items 3 and 7):**
     - the cancelled attempt's own preparation, replayed, is refused by the
       cancellation;
     - the executed command replays its receipt.
   - **Items 1 and 3 on the VM (2026-09-27):**
     `vm_tenant_root_execution_paused_after_its_root_reads_is_cancelled_and_retried`.
     - The execution is paused after both root reads, then cancelled.
     - Released, it cannot claim its pair, and nothing completes.
     - The same wallet's fresh registration succeeds, and the SigningWorker
       accepts it as the wallet's only registration.
   - **Wallet-object pair stores (Workers harness,
     `--do-admission-settlement`):**
     - an admission settles, or is fenced and cancelled, only on its
       object's word;
     - B's object refuses to start a fenced pair;
     - a lost settlement acknowledgement is reconciled to the same
       completion.
   - **A claimed execution that fails** (VM
     `vm_tenant_root_claimed_execution_that_fails_is_recovered_and_retirement_completes`;
     Workers harness `--do-claimed-recovery`, in wallet objects):
     1. Recovery fences Deriver B first.
     2. It then ends A's claim.
     3. Retirement completes, and a second refresh succeeds.
   - **Not yet covered:** ECDSA presignatures.
3. **Retry identity and one use after fenced cancellation.** A cancelled
   operation's retry keeps its identity and consumes no one-use item twice:
   capability, pair, presignature, SigningWorker effect claim.
4. **A delayed terminal commit after a fence.** Hold a SigningWorker package or
   activation until after the owner has recorded the epoch fence. The commit is
   refused, and its retry on the fenced epoch is refused too.
5. **A pause between check and commit.** Suspend a committing process after it
   reads its clock and before it commits, and fence meanwhile. The commit is
   refused, because the fence check runs inside the commit, whatever the clock
   reads. On Workers, run this against deployed timer semantics, not only
   local ones.
6. **Retirement pending without an acknowledgement.** One owner unreachable
   keeps retirement pending, with no timeout shortcut.
7. **Restart safety.** Crash at each step. The fences, the acknowledgements and
   the erasure are each recorded once and replay exactly.

### Coverage of each transition

| Transition | Rule |
| --- | --- |
| Manual and scheduled refresh | Refresh retirement. Close the old epoch's gate; erase only once every old-epoch admission is settled or cancelled behind a fence |
| Managed restore replacing live authority | Refresh retirement, for the forward refresh that follows the restore |
| Source retirement | Moving authority. Fences acknowledged by every terminal owner, then retire |
| Custody cutover (separate approval) | Moving authority. `Drained` requires every terminal owner's fence acknowledgement; `derivation_gate()` becomes the check those owners consume |

### What it does not cover

- It does not retract a signature already released, or revoke independent lane
  material or Gateway sessions activated before the fence. Those keep their own
  fences, and cutover orders them.
- Fencing depends on knowing every terminal commit point. A new terminal owner
  must be added to the fence protocol before it ships.

### Open review questions

1. **Admission records.** Resolved for the role store: each Deriver records
   admissions there (see step 2), ordered against the swap. Settlement still
   needs each admission's terminal outcome or fenced cancellation recorded
   against it. Pair records live in the wallet object on Cloudflare and in the
   role-private SQLite on the VM, so how an admission is marked settled is
   open.
2. **Fence coverage for moving authority.** The list of release paths (export,
   recovery outcomes), and the mechanism that covers per-wallet owners created
   while closing.
3. **`W` = 300 s**, as the warning and recovery trigger.
