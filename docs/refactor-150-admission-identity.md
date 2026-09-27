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
    - A wallet object: on the object's report, below.
  - **ECDSA:** right after its single root read, if that settlement wins.
- **Cancelled:** recovery cancels an admission still `admitted` `W` (300 s)
  after it was admitted. It does so only where this store fences every later
  step:
  - an ECDSA attempt;
  - a Yao attempt not yet claimed, whose pair is in this role store.

  An operator-issued cleanup obeys the same rule; age alone cancels nothing
  else.
- **A claimed attempt is recovered through its peer** (review, 2026-09-27).
  - **The problem:** a claimed execution that failed or ran too long burns
    its pair. A burned pair never completes, so the attempt used to stay
    pending forever. With retirement before each refresh, one ordinary
    failure would have blocked every later refresh of the root.
  - **Why the peer:** A's delayed messages can still reach Deriver B, but
    A cannot complete without B's completion.
  - **Recovery, past `W`:** Deriver A first asks Deriver B, over its peer
    channel, to fence the session unless B completed it. B answers only
    once its answer is durable:
    - it completed the pair: its admission is settled;
    - it had only admitted it: it cancels its admission, fencing its wallet
      object first if one holds the pair;
    - it never admitted it: its epoch must already be closed there, or it
      cannot yet prove it will never start, and A retries.
  - **Then A:** B can no longer act on A's messages. A's claimed admission
    is cancelled, which refuses A's own completion, or A's wallet object
    fences even the claimed pair.
  - **Clearing `claimed` alone is never enough.**
- **Stays pending, and retirement with it:**
  - **A claimed attempt whose Deriver B cannot answer yet.**
  - **An attempt whose wallet object cannot be reached,** until it answers.

**Wallet objects** (implemented 2026-09-27; R150's target Cloudflare backend):
- **Binding.** An admission records the object that holds its pair
  (`pair_object_name`), bound at admission. The same attempt through another
  object is a conflict.
- **The fence lives in the object.** It keeps its own fence table, and it
  refuses a fenced session's steps:
  - Deriver A's claim and completion;
  - Deriver B's start and completion.
- **Settlement is the object's report, acknowledged to the role store.**
  - Deriver A's object settles the admission after its completion write.
  - Deriver B's worker settles it whenever its object reports the pair
    completed, including on a status read.
  - Each settlement names the role, the attempt and the object.
  - It is an acknowledgement, not part of the object's transaction. If it is
    lost, the admission stays `admitted`: a retryable obligation.
- **Reconciliation in retired cleanup.** It asks the object behind each
  unsettled admission on the epoch:
  - **A completed pair** settles the admission, at any age. This recovers a
    lost acknowledgement with the same terminal outcome.
  - **Past `W`,** the object fences the pair in one statement, unless A
    claimed it or it completed. The admission is then cancelled.
  - **A claimed pair** is fenced only once Deriver B has fenced the session
    or completed it, as above. Until then it stays pending.
  - **An object that cannot answer** fails the cleanup, which is retried.
    Nothing is cancelled.
- **Evidence:** Workers harness `--do-admission-settlement`
  (`R150_WORKERS_WALLET_OBJECT_ADMISSIONS`), with wallet-object builds for
  both Derivers.
  - **Root R:**
    1. A registration's execute is held over a refresh.
    2. Retiring epoch 1 at B fences B's object and cancels B's admission.
    3. Released, B refuses to start the pair: "this tenant-root operation's
       admission was cancelled here", HTTP 503.
    4. Retiring at A fences A's burned, never-claimed pair.
    5. A fresh registration settles on epoch 2 through both objects.
  - **Root S:** a completed registration's admissions are set back to
    `admitted`, as if both acknowledgements were lost. Retirement reconciles
    them to `settled` and cancels nothing. Both objects report `completed`.
- **Evidence for claimed recovery:** VM
  `vm_tenant_root_claimed_execution_that_fails_is_recovered_and_retirement_completes`
  (`R150_VM_TENANT_ROOT_CLAIMED_RECOVERY_E2E`):
  1. A claims its pair, the stream is cut, and A's claimed pair burns.
  2. A restarts.
  3. Retiring epoch 1 has B fence the session first, then cancels A's
     claimed admission. Both epochs are erased.
  4. A's delayed execute and the old registration's retry are refused.
  5. A second refresh succeeds. The same wallet then registers once, on
     epoch 3.
- **The same recovery in wallet objects:** Workers harness
  `--do-claimed-recovery` (`R150_WORKERS_WALLET_OBJECT_CLAIMED_RECOVERY`).
  Deriver B is set to burn its pair just before completing it.
  1. A's object claims the pair, then B burns its side. A's object reports
     `claimed`, and B's reports `open`.
  2. Retiring epoch 1 at A has B's object fence its pair first. Only then
     does A's object fence the claimed pair. Both admissions are cancelled,
     both objects report `fenced`, and both epochs are erased.
  3. The old registration's retry is refused at preparation.
  4. A second refresh succeeds.
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
- **A settled attempt may still read** while its epoch is kept: an ECDSA
  request replayed on the same epoch reads again. A completed Yao pair does
  not. Deriver A's execute answers an exact retry from its completed record
  before any root read, on every host
  ([refresh retirement](./refactor-150-refresh-retirement.md), design item 4).
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
