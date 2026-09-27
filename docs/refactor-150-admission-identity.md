# R150: identity of a root-use admission

Status: proposed 2026-09-27, for review. Settlement and erasure build on it
([drain proposal](./refactor-150-root-retirement-admission.md), step 3).

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
| Yao | wallet and canonical pair session | The pair session is the execution. Both Derivers already key their pair records by it, so settlement joins on it |
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
- **The row gains what settlement needs:** the attempt key, the operation id
  and pair or request digest, the first binding digest and window, and a
  status that later moves once from `admitted` to settled or cancelled.

## Settlement it enables (step 3, to be implemented next)

Only the rule that matters for identity is stated here:
- **Yao:** the role's pair record reaching `Completed`, `Burned` or `Expired`
  settles that role's admission for the same pair session.
  - Where the pair record shares the admission's database (Cloudflare D1
    paths, both VM roles), one transaction does both.
  - Where it lives in the wallet object, the object's terminal record
    decides, and the role store records it.
- **ECDSA:** the Deriver settles its admission right after its single root
  read, in the same request.
- **An admission whose attempt never produced a record** is settled only
  by a durable fence that refuses any later step for that exact attempt key.
  Elapsed time alone never settles it.

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
