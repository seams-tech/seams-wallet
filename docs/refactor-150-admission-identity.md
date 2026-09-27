# R150: identity of a root-use admission

Status: implemented 2026-09-27 for review, with settlement and safe erasure
([drain proposal](./refactor-150-root-retirement-admission.md), step 3).
- **Migrations:**
  - 0015 (attempt key);
  - 0016 (settlement index);
  - 0017 (the `claimed` status and the wallet object that holds the pair).
- **Evidence:**
  - VM `vm_tenant_root_admission_follows_the_execution_attempt`, for the key;
  - VM `vm_tenant_root_execution_paused_after_its_root_reads_is_cancelled_and_retried`,
    for cancellation that stops the whole execution;
  - VM `vm_tenant_root_retired_epoch_is_erased_only_after_its_admissions_settle`,
    for settlement, the pending refusal, recovery, erasure, and the refusals
    and replays after it;
  - the Workers harness, `--admission-races`
    (`R150_WORKERS_TENANT_ROOT_ADMISSION_RACES`). It shows the D1 batch
    settling at both roles, A erasing epoch 1, and B answering pending.
    `W` recovery is not exercised there, since `W` is 300 s on Workers;
  - the Workers harness, `--ecdsa-across-refresh`
    (`R150_WORKERS_ECDSA_ACROSS_REFRESH`): every ECDSA admission settled;
  - the existing admission E2Es, unchanged.

## The question

Each Deriver records an admission before it reads a tenant-root share
(`tenant_root_root_use_admissions`, migration 0013). Today one row is keyed by
the whole custody binding's digest. That key cannot tell apart two cases:
- **A replay of the same execution attempt.** Its binding must stay fixed:
  the replay must find the attempt's own row, and a replay that changes the
  binding must conflict.
- **A legitimate new attempt** after a refresh or a failure. It may carry a
  new binding and must be admitted in its own right.

Keying by the binding digest makes a changed binding look like an unrelated
admission. Keying by a broad business-operation id would refuse a valid new
attempt.

## What the binding carries today

- **Yao.** The operation, session and nonce are hashes of the pair digest.
  The window (`issued_at_ms`, `expires_at_ms`) is the Router's clock at each
  attempt. So even an exact replay of one pair gets a new binding digest and a
  new admission row. On the VM every replay leaves one more row that nothing
  settles; on Cloudflare the Deriver's Prepared pair record refuses the
  changed binding.
- **ECDSA.** The operation, session and nonce are hashes of the request
  digest, and the window comes from the request. An exact replay on one epoch
  gets the same digest and the same row. After a refresh, the same request is
  re-sent and admitted on the new epoch, a second row for one operation. The
  Workers harness asserts that retry (`--ecdsa-across-refresh`).
- Nothing reads or updates an admission after the insert, and the row stores
  no operation id or pair digest. Terminal pair records keep the pair digest
  and the pair session but not the binding. So no terminal outcome can be
  joined back to its admission.

## Decision

An admission is keyed by the execution attempt the protocol already has. Every
other binding field is an immutable compared value.

| Protocol | Attempt key (with identity digest, lineage, role) | Why |
| --- | --- | --- |
| Yao | canonical pair session | The pair session is the execution. Both Derivers already key their pair records by it, so settlement joins on it. It is unique on its own, so the wallet adds nothing to the key |
| ECDSA | operation id and epoch | Each Deriver's work is one root read per request and epoch. Re-sending the request after a refresh is a new attempt on the new epoch |

- **Compared on a repeat (the first insert wins):** operation id, pair digest
  (Yao) or request digest (ECDSA), session, nonce, epoch, epoch commitments,
  activation receipt digest, stable-context and outer-transcript digests, and
  the Deriver identities. Any difference conflicts, under concurrent inserts
  too.
- **Not compared: the window.** The Router restamps it on each Yao attempt.
  Each step still validates its own binding's window at use. The row records
  the first admitted binding's digest and window. That digest is the
  attempt's binding.
- **A Yao pair stays on its first epoch.** A replay of the pair after a
  refresh conflicts at admission. Spec 6 says work in progress follows the
  version it started with. The Gateway already treats this as a new
  ceremony, with a new pair session. This matches what the Cloudflare pair
  store does today, and the VM now refuses at admission instead of leaving an
  orphan row.
- **An ECDSA operation may run once per epoch.** Every epoch's output for one
  request is the same derived key, because refresh preserves the root. Each
  attempt follows the epoch it was admitted on.
- **The row gains what settlement needs:** the attempt kind and key, a
  digest of the compared fields (`TenantRootCustodyBindingV1::attempt_digest`,
  which covers every field but the window, including the operation id derived
  from the pair or request digest), the first binding digest and window, and a
  status. The status is `admitted` until settlement moves it once to
  `settled` or `cancelled`.
- **A conflicting retry** is refused with `ConflictingPair` and leaves the row
  as it was.

## Settlement and safe erasure

An admission's status moves forward only:
- `admitted`, then `settled` or `cancelled`;
- or, for Deriver A's Yao executor, `admitted`, then `claimed`, then
  `settled`.

Settlement and cancellation race for the same row. Each is one durable commit
in the store that owns the admission, so exactly one of them wins.

**What each role's execution can still do after its last durable check.**
This is the question the fence answers (mapped 2026-09-27, both hosts):
- **Root reads.** These were the only steps that checked the admission.
- **After a role's root read,** Yao round messages flow between the roles
  with no durable check. Nothing re-checks the admission.
- **Only the completion write gates the outputs that count:**
  - B's sealed completion is sent after B's completion write;
  - A's response to the Router is sent after A's completion write;
  - the Router's finalization and the SigningWorker delivery need both.
- **A cannot complete without B's sealed completion.** So fencing B's
  completion fences everything after it.
- **A's first protocol message follows its claim.** The claim is the write
  that starts A's pair running, after both root reads.

**The fence** (implemented 2026-09-27 for the role store and the VM; migration
0017):
- **Completion requires a live admission.** Each role's completion write
  requires its admission to be `admitted` or `claimed`, and settles it, in
  the same transaction or D1 batch. A cancelled attempt cannot complete at
  that role.
- **A's claim requires `admitted`** and marks the admission `claimed` in the
  same transaction. A cancelled attempt cannot send its first message.
- **B's start also requires `admitted`.**
- **Burned or Expired settles nothing.** Its executor may still hold what it
  read. A completion recorded as burned because it came after the running
  lifetime is a failure: on the VM, Deriver A no longer releases its outcome
  or keeps its per-wallet state then.
- **ECDSA** uses its share only if its settlement won. Settlement reports
  one of three outcomes:
  - "settlement won";
  - "already settled for this exact attempt";
  - "cancellation won", which refuses the request.

  An update that moved no row never lets the request go on.

**States:**
- **Settled:** the attempt completed at this role.
  - **Yao:** the role's pair record for the session reached `Completed`.
    - Cloudflare D1: the write and the settlement run in one batch. The batch
      continues after a failed compare-and-swap, so the settlement checks
      that the row really completed.
    - Both VM roles: in the pair store's own transaction, because its table
      shares the role store's SQLite file.
  - **ECDSA:** right after its single root read, if that settlement wins.
- **Cancelled:** recovery cancels an admission still `admitted` `W` (300 s)
  after it was admitted. It does so only where this store fences every later
  step:
  - an ECDSA attempt;
  - a Yao attempt not yet claimed, whose pair is in this role store.

  An operator-issued cleanup obeys the same rule; age alone cancels nothing
  else.
- **Stays pending, and retirement with it:**
  - **A claimed attempt.** Its messages may still reach Deriver B, so only
    its completion settles it.
  - **An attempt whose pair is in a wallet object.** Each such admission
    records its object (`pair_object_name`), but the object does not yet
    hold the fence or report settlement. Until it does, its admissions end
    in neither state.
- **Evidence:** VM
  `vm_tenant_root_execution_paused_after_its_root_reads_is_cancelled_and_retried`
  (`R150_VM_TENANT_ROOT_PAUSED_EXECUTION_CANCELLED_E2E`):
  1. A registration is paused after both Derivers read their shares and
     before A claims its pair.
  2. Replicas retire the epoch at both roles, cancelling both admissions and
     erasing both shares.
  3. Released, A's claim is refused and nothing completes. An exact retry of
     the old registration completes nothing either.
  4. A fresh registration of the same wallet then succeeds and signs. The
     SigningWorker accepts only a wallet's first registration.
- **Erasure:** a retired epoch's share is erased at a role only when no
  admission on that epoch is still `admitted` or `claimed` there.
  - The same `DELETE` statement checks this, so the check and the erasure are
    atomic in the role store that owns both.
  - Before it, the Deriver answers "retirement is pending" with the
    unsettled count.
  - Erasure runs through the existing retired-cleanup command: the control
    plane signs it and the Deriver executes it. Both hosts serve it; Workers
    served it before with no settlement check, and that gap is closed.
- **A settled attempt may still read** while its epoch is kept. An ECDSA
  request replayed on the same epoch reads again. Cloudflare Deriver A's
  execute reads its share before it checks its pair record.
- **After erasure, every refusal keeps its meaning.** With the share row gone,
  the attempt's own admission record answers. All three answers are the
  retryable `LifecycleTransitionInProgress`:
  - a cancelled attempt is refused by its cancellation;
  - a settled attempt is told its epoch "was erased here after the operation
    settled; start it again";
  - an attempt never admitted is told its epoch closed before it was
    admitted, as before the erasure. This applies only if a later epoch is
    active here; otherwise the missing row stays an error.
- **The erasure replays exactly.** The same command again returns the same
  signed receipt and the same `cancelled_admissions`. That count is read from
  the admission rows, which outlive the erasure. The backup deletion is
  observed again and reports its objects already absent.

## Consequences

- **The table changes shape.** Test wallets are disposable and no backward
  compatibility is required, so the migration recreates the table. Deploying
  it needs the separately coordinated authorization.
- **What the drain proposal means by a retry:** it says a refused operation
  "re-admits on the new epoch". Under this key, that is a new attempt:
  - ECDSA: the same request on the new epoch.
  - Yao: a fresh registration, with a new pair session. The Yao test there
    already does this.
  Its statement that a closed epoch returns `ExpiredLocalRequest` was wrong;
  the code returns `LifecycleTransitionInProgress`. It is corrected there.
- **Follow-up, not proposed here:** deriving the Yao window from the pair's
  authorization, as ECDSA does. Exact replays would then carry identical
  bindings, and the pair stores would stop refusing them.
