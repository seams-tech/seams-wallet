# R150 Deriver A executor loss after Deriver B completion

Status: proposal for review. Nothing here is implemented. Today's behavior
fails closed and must stay that way until this design is approved.

## The gap (code-checked 2026-09-25)

Deriver A keeps its Yao transcript, final completion and new effective
contribution in process memory while its pair record is `Running`
(`local_ed25519_yao_worker.rs:1480-1768`). It persists them only in
`complete_a_pair`, which is one transaction that also writes A's role state.
B persists `Running`, then `Completed` together with its effective-state
delta, before it sends its sealed completion (`:2661-2824`).

A lost B reply is already reconciled while A survives: A reads B's exact
outcome and checks it against its own transcript. If A's process dies after B
commits:

- **A is stuck in `Running`.** The record has no expiry
  (`ed25519_yao_pair_lifecycle.rs`), and A refuses a second executor for the
  pair.
- **Router retries never end.** Router reconciliation sees (A `Running`,
  B `Completed`) and returns `RecoverableFailure(ServiceUnavailable)`
  forever (`local_router_coordinator.rs:470-474`).
- **Fresh registration is blocked.** B's effective contribution is keyed by
  wallet identity without the session (`local_ed25519_yao_refresh.rs:137-145`),
  so a fresh registration for that wallet is rejected by B.
- **Nothing leaks.** No SigningWorker activation and no client package is
  released. The wallet identity is simply unusable.

The Cloudflare wallet DO path has the same shape: a Deriver A isolate
eviction loses the in-memory transcript in the same way.

B's durable response cannot resume A. Resuming needs A's private half of the
transcript, and the constraints rule out storing it durably.

## Constraints

- **No durable secret-transcript storage** for A.
- **No reuse** of the old pair session, execution id, readiness receipts or
  one-use material.
- **No inference from silence.** Process silence, a timeout, `Burned`, or a
  missing record never proves that A's old executor has stopped.
- **Explicit authorization.** A fresh attempt requires reconciliation plus an
  authorization from the owner of the registration ceremony.

## Proposed protocol: fenced abandonment, then a fresh attempt

### 1. A proves its old executor is gone

A's `Running` record gains an `executor_incarnation`. This is a random id
generated at process or object start and persisted with the `Running` claim.

A new incarnation may CAS `Running{incarnation=old}` →
`Abandoned{execution_id, incarnation=old}` only when both of these hold:

- **One A executor.** The deployment runs exactly one A executor per role
  store. This is the documented VM single-host-per-role topology. For a DO,
  the object's single-instance guarantee applies: a new instance means the
  old isolate is gone, and its storage and in-memory state cannot be
  restored.
- **A different incarnation.** The record's incarnation differs from the
  current process's own.

`Abandoned` is terminal:

- A rejects every later peer message, completion read or readiness emission
  for that pair session.
- A signs an abandonment receipt with its peer key: `(pair binding,
  execution_id, old incarnation, "no completion released by A")`.
- A has no state from which it could release a completion, because the only
  copy was in the lost memory.

A multi-process A deployment cannot use this rule. It would need a lease
owned by the role store instead, and that is out of scope.

### 2. SigningWorker fences the old execution

Before anything on B changes, the Router asks SigningWorker to durably fence
`execution_id`. A fenced execution id can never be activated, so a delayed
activation package from the old completion is refused.

The Router reads SigningWorker's exact finalization record first:

- **Not activated:** SigningWorker writes the fence.
- **Activated:** there is no gap to repair. The registration completed, and
  the Router proceeds with normal finalization reconciliation instead.

### 3. The Gateway authorizes a fresh attempt

The registration ceremony's execution record in the Router gets a new attempt
number, and records `superseded_by_attempt(n+1)` for the old attempt,
together with:

- A's abandonment receipt;
- SigningWorker's fence receipt.

The Gateway admits attempt n+1 only if the ceremony is still valid, and only
after fresh owner verification if the original proof has expired. The old
attempt's admission claim stays consumed. The fresh attempt gets a new
admission, a new pair session and a new execution id.

### 4. B supersedes its completed contribution

B accepts `supersede_pair` only if all of these check out:

- A's abandonment receipt for B's exact `Completed` record;
- SigningWorker's fence receipt for the same execution id;
- the Router's authorization for attempt n+1.

B then:

- CASes `Completed` → `Superseded`, keeping the outcome digest as a
  tombstone so the old execution id can never be replayed as a success;
- releases the wallet's effective contribution for the new session.

B's completed outcome is never delivered after this point.

### 5. Normal registration of attempt n+1

The new attempt runs through the existing pair lifecycle.

## Why this is safe

- **No reuse.** Every identifier in attempt n+1 is fresh. Every identifier in
  attempt n is tombstoned in A (`Abandoned`), B (`Superseded`) and
  SigningWorker (fenced).
- **Fail-closed at each step.** Any missing receipt leaves the old state and
  retries the same step. No step infers completion or quiescence from
  absence.
- **The old executor cannot act.** Its only state was the lost memory. Its
  durable record is `Abandoned`, and every peer rejects its identifiers.
- **Nothing secret is added.** No transcript is persisted. The receipts carry
  only public identifiers and digests.

## Scope and alternatives

- **Scope.** This covers initial registration. Recovery and export executions
  use the same pair lifecycle and would reuse steps 1, 2 and 4 with their own
  Gateway authorization rule.
- **Alternative: permanent block.** Keep the current fail-closed behavior and
  document an operator procedure that retires the wallet identity. This is
  acceptable for disposable test wallets. It is not acceptable for production
  wallets, because the user's wallet identity is lost.
- **Rejected: durable A transcript.** Out of scope by constraint.

## Tests required before enabling

All against both the VM and the DO host:

- A crash after B commits, followed by the full fenced path.
- A duplicate A executor presenting the old incarnation.
- A delayed SigningWorker activation after the fence.
- B receiving `supersede_pair` without each receipt in turn.
- A replay of attempt n's completion after `Superseded`.
- A restart at every step boundary.
