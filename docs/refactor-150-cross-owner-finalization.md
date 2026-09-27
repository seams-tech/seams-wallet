# R150 cross-owner Yao finalization, recovery and export

Status: slices 1 and 2 implemented (2026-09-27/28, see below). The Router
owns each registration's execution record, and registration and add-signer
finalize through one decision row per lifecycle. Recovery promotion and export
are proposals. Until each lands, its records stay in Gateway D1 next to the
tenant-wide `router-ab-ed25519-yao:shared` record, and the current atomic
unit is unchanged: the batch that installs a capability into the shared
record and advances the lifecycle record.

## Code check and slices (2026-09-27)

A second code check changes the plan's order and settles where the Router's
side runs.

- **Who runs this code today.** Every Yao ceremony and execution record is
  read and written by TypeScript in the Wallet Gateway
  (`packages/wallet-server`), on Workers and on the VM's Node Gateway. The
  Rust Router, Worker or VM process, never touched them. At this check
  nothing here was implemented: no decision table, no `finalizing` state,
  and no Router wallet object. Slice 1 has since added the Router wallet
  object.
- **The Router is the Router role.** The [ownership
  map](./refactor-150-state-ownership-map.md) names five owners, Gateway,
  Router, A, B and SigningWorker, and says the Router claims the protocol
  operation. That is the Rust Router Worker, with Router SQLite on the VM,
  as the Derivers' and SigningWorker's wallet objects live in their own
  Workers. A TypeScript object inside the Gateway deployment would be the
  Gateway's storage under another name.
- **The execution record moves first, alone.** It is registration's and
  add-signer's only; recovery and export never touch it. Its consumption is
  already its own transaction today, so moving it splits no atomic unit and
  needs no decision row.
- **The ceremony partition stays in Gateway D1 for now.** Capability
  install, recovery admission's suspension and sessions, promotion, and the
  export nonce and uncertain set each commit it with the tenant-wide shared
  record. Moving it would split every one of those; each would first need
  its own cross-owner protocol.
- **Corrections to the section below.**
  - Add-signer finalizes the same way as registration: it consumes the
    activation, writes the signer, then installs the capability. The
    protocol covers it as well.
  - Recovery's terminal batch is written by the two-phase runner after
    `replaceActiveCapability`, not by `commitActivateRecovery` itself.
    Recovery admission also writes the shared record: it suspends the active
    capability and records a recovery session. No decision kind covers
    those writes yet.

### Slice 1: the Router owns the execution record

- **Split.** The Gateway keeps admission: the ceremony's admitted state,
  the intent credential and its expiry, and the tenant root the
  registration dispatches to, all checked before it calls the Router. The
  Router's wallet object keeps what the Router decides: the claim of the
  execution, its lease, generation and replay, the exact request it pinned,
  the terminal outcome, and the first consumer binding.
- **One call per execution.** The Gateway calls the Router's execute once.
  The Router claims in its wallet object, runs the ceremony, and records a
  terminal outcome before it answers. An exact retry gets the stored
  outcome. While a claim's lease is live, a retry is told the execution is
  in progress. After it, a retry takes the claim over and replays on the
  pinned request. A different request for the same lifecycle is refused.
- **Claim generations.** Each claim has a generation, and a takeover starts
  the next one. A run records its terminal outcome only while it holds the
  current generation. A run that resumes after another took its lapsed claim
  over is told the execution is in progress, and records nothing; the
  current holder records the outcome.
- **The dispatch root is pinned at admission.** The Gateway resolves the
  active tenant root once, when it admits a fresh registration, and pins it
  in the ceremony record with the admission. Every execute and consumption
  of the lifecycle sends that root and never looks the active root up again,
  so a completed execution's answer and its consumption do not depend on
  the root still being active. The Gateway still authenticates each call
  (the intent credential's digest and expiry, the admitted binding) and
  checks the pinned root against the admission's signing root and version.
  The Router checks the root for every new run.
- **Consumption.** Finalization and add-signer consume the activation at
  the Router: the first consumer binding wins, and the same binding
  replays.
- **Hosts.** Workers: a Router wallet Durable Object, named like Deriver B's
  by organization, project, environment and wallet. VM: the same records in
  the Router's SQLite. The transitions are shared Rust over both.

**Evidence (2026-09-27).**

- VM, `crates/router-ab-dev/tests/local_worker_http.rs`:
  - `vm_router_run_that_lost_its_claim_cannot_record_its_answer`: a run
    paused after both Derivers completed its pair loses its one-second claim
    to an exact retry (generation 2), which is paused reading Deriver B's
    pair status. The first run resumes, is told `execution_in_progress`, and
    the claim stays generation 2's. The takeover run records its answer, and
    an exact retry gets it byte for byte.
  - `vm_router_owns_each_registration_execution_and_its_consumption`, and the
    four tenant-root tests that register a fresh lifecycle for each
    registration.
- Workers private harness, stamped dev builds: role-store
  `replay-after-erasure`, `admission-races` and
  `refresh-after-managed-restore`; wallet-object
  `do-historical-starting-replay`, `do-pair-lost-reply`,
  `do-pair-b-burn-before-complete` and `do-historical-replay`.
- Real Gateway: the five `passkey.ed25519-yao-local` contracts pass on
  Workers and on the VM.
- Harness corrections found on the way. The wallet-object modes read Deriver
  B's pairs and the SigningWorker's activations from D1, which that build no
  longer writes. B's pairs are now read through B's own status route. The
  historical replay's two subtests that edited SigningWorker D1 rows
  (missing and revoked output) are removed until they can act on the
  SigningWorker's wallet object.

### Slice 2: the decision row for registration and add-signer

A code check of the finalize paths corrected two premises of the protocol
below:
- **What makes a finalization visible is the wallet's signer row.** The
  capability in the `shared` record is a bounded cache (32 entries); readers
  that miss it rebuild it from the signer row.
- **A registration finalize could not resume once its commit had landed.**
  A retry rebuilt the founding authority with new timestamps. That either
  threw "replay conflicts", which is retryable, so every resume failed, or it
  recorded `invalid_state` as terminal while the wallet was already visible.

So the decision joins the batch that writes the signer row, and nothing else
moves:
- **The decision row.** `yao_lifecycle_decisions` in the signer database
  holds one row per lifecycle: its kind (`registration_finalized` or
  `add_signer_finalized`), the wallet, and a decision id. The id digests the
  kind, the lifecycle, the wallet, the consumer binding the Router consumed
  the execution for, and the capability the finalization installs. It is
  inserted once, behind the batch guard, so a batch for a lifecycle already
  decided commits nothing.
- **Registration.** The commit store's batch (wallet, signer rows, founding
  authority and method, Email OTP rows) also inserts the decision. A
  finalize reads the decision before building that batch:
  - If it finds its own decision, it skips the batch and the checks that
    assume nothing was committed. It goes on to the steps after it: identity
    completion, the capability cache, custody, the session and the journal.
    Each of those is idempotent.
  - If it finds another decision, it is refused.
- **Add-signer.** The signer insert, guarded on its slot being free, and the
  decision share one batch. If that batch aborts, re-reading the decision
  tells a concurrent finalize of the same lifecycle (proceed) apart from
  another signer in the slot (`signer_conflict`). The ceremony's move to
  `finalizing` stays before the batch, and a resume already works from it.
- **The Router keeps no decision.** Its consumption pins the one consumer
  binding that may finalize, which is what the `finalizing(decision_id)`
  step below was for. The decision itself is the Gateway's fact alone. A
  copy in the wallet object (the `finalized` step below) would be a second
  authority for it, so neither step is built.
- **Answered.** Open question 1: the wallet's rows join the decision batch.
- **Evidence (2026-09-28).**
  - Real Gateway contract, on Workers and on the VM: "deferred NEAR finalize
    that loses storage after its decision resumes from the decision and
    signs". A mixed passkey registration's NEAR finalize loses the Gateway's
    signer database once, right after the batch holding the decision
    commits. A local-only fault does this, and the Gateway reports its proof.
    The finalize reports a retryable failure. After the journal's 30-second
    resume window, unlocking retries it. The retry finds its own decision and
    commits nothing again, NEAR becomes ready, and the wallet signs. Before
    this slice, that retry hit the authority-extension check and returned
    `invalid_state` as terminal.
  - The five other `passkey.ed25519-yao-local` contracts pass on both hosts,
    covering registration, Ed25519 and ECDSA add-signer, the exact transport
    retry and the terminal burned execution.
- **Not yet built.**
  - An `abandoned` decision. No abort path exists today.
  - A resume after an add-signer ceremony has expired is still refused as not
    found, although its signer is visible.
  - A capability cache install refused after the decision still returns its
    error.

### Slice 3: recovery promotion commits in one batch

A code check of recovery (2026-09-28) found promotion writing the
SigningWorker, then two D1 batches.
- **Batch 1 replaced the capability.** It covered the signer row, the
  replacement receipt, and the active authorities and live sessions that
  project the capability. No statement in it aborted the batch. A stale
  signer, or an authority changed since it was read, committed part of the
  replacement, and every retry then answered `exact_retry`.
- **Batch 2 recorded the shared record and the ceremony.** Between the two,
  the signer rows showed the successor while the shared cache still held the
  old capability suspended. Readers that rebuilt the cache from the signer
  row got `capability_conflict` until someone retried the activation.

Now:
- **The replacement is prepared, not applied.** The persistence port returns
  its statements. The batch guard follows the signer row and each authority,
  and the receipt is inserted once per operation. A live session retired
  since it was read matches no row, which is correct: it projects nothing.
- **One batch.** The statements commit in the batch that records the
  promoted shared record and ceremony, so a promotion is visible everywhere
  or nowhere. If the batch aborts, nothing commits and a retried activation
  promotes again. That happens when a guard fires, or when the shared record
  changed during the Router call, which is now a retryable 503. On the retry
  the SigningWorker answers the same promotion, and the replacement is
  prepared again from what is stored.
- **No decision row for recovery.** The ceremony's `promoted` state commits
  in the same batch as the rows it makes visible, so it is the decision. A
  second row would record the same fact twice.
- **Evidence (2026-09-28).** Two passkey recovery contracts pass on Workers
  and on the VM:
  - a fresh browser recovers with one code, signs, and refuses the code's
    reuse;
  - a committed recovery survives a lost finalization response and a runtime
    reset.

  A persisted trace of the first shows the recovery's Yao admit, execute and
  activate calls, so the promotion ran through the single batch before the
  recovered wallet signed. No fault case targets the batch itself.

Found in the same check and not addressed here (for review):
- A failed recovery never un-suspends the old capability. A later recovery
  is refused `capability_suspended`, and export and warm bootstrap find no
  active capability.
- Admission and execute can stay `admitting` or `executing` after a crash or
  a lost commit, and then answer "in progress" forever. Every Router
  non-success in execute is recorded as terminal, recoverable ones included.
- The SigningWorker keys a recovery's staged candidate by the stable key
  context, in one slot, not by the Router execution, and has no read-only
  lookup. An abandoned candidate blocks later recoveries.
- The VM and Workers Routers reconcile a replayed recovery differently.

### Slice 4: a recovery resumes instead of sticking

A recovery could stop for good. Recoverable Router answers were recorded as
terminal, a claim cut short stayed "in progress" forever, and the capability
stayed suspended with no way on. The SDK makes this worse: each attempt draws
a fresh random replacement binding, so a retry never repeats a request. It is
a new attempt, refused `capability_suspended` because the earlier attempt
held the suspension.

**Attempt and recovery.** An attempt is one admission request. The recovery
is its lifecycle, derived from the recovery code's reservation and key set,
authorized the same way. A failure never reactivates the old capability:
recovery may follow a suspected compromise. The recovery goes on by resuming.

**Gateway.**
- A new attempt of the same recovery supersedes the attempt holding the
  suspension if that attempt has not begun activating. Supersedable: failed
  admission, admitted, interrupted or failed execution, and staged. A live
  claim becomes supersedable once stale: 30 s for admission, 60 s for
  execution, which outlasts any Router execution. The superseded attempt is
  recorded `superseded` and can never execute or activate. The suspension
  passes to the new attempt.
- An attempt that is activating, failed activation, or promoted is never
  superseded. Its promotion could already be at the SigningWorker, so it can
  only be resumed.
- Execution answers that decide nothing become `execution_interrupted`, not
  terminal: an unavailable role or Router, another run holding the execution,
  or a lost reply. The same payload then executes again as the Router's
  replay, as does a stale claim of it. Burned, rejected and expired
  executions stay terminal for the attempt, and the recovery continues
  through a new attempt.
- A promote the SigningWorker did not answer leaves the attempt activating,
  and a retry reconciles it.

**SigningWorker**, the same on Workers and the VM:
- A later attempt's delivery replaces the staged candidate of an earlier
  attempt of the same lifecycle. The new candidate stands on the same active
  material. Only the Gateway's current attempt promotes.
- The same deliveries answer again, staged or promoted.
- Another attempt of a recovery that already promoted is refused as stale.
- Workers promotes by compare-and-set on the lifecycle first and writes the
  activation row after, so one promotion wins, and a repeat writes the row
  again.
- The VM now keeps its recovery slot, staged or promoted, in its durable
  state, and persists a promotion before replying.

**Router.** On the VM, replaying a recovery reconciles as role-store Workers
does:
- both roles completed: the packages are delivered again;
- a pair running or completed on one side: it is burned;
- expired: recoverable;
- missing: a fresh run.

**Evidence (2026-09-28).**
- New contract, on Workers and on the VM: "an interrupted recovery attempt
  is superseded by a retry with the same code, which recovers and signs".
  1. A local-only fault lets the Router run the first attempt's execution,
     which stages its candidate at the SigningWorker.
  2. The fault then loses every reply to that execution. That includes the
     Gateway's replay, which must also answer `succeeded`, so both hosts
     reconcile a replayed completed recovery the same way.
  3. The Gateway records the attempt interrupted, and the page offers to try
     again.
  4. The retry is a new attempt. It supersedes the first at the Gateway and
     replaces the first attempt's candidate at the SigningWorker. It
     promotes, and the wallet signs NEAR.

  Before this slice, the retry was refused `capability_suspended`.
- Two other recovery contracts pass on both hosts: the fresh-browser
  recovery, and one that survives a lost finalization response.
- VM tests pass: the SigningWorker and Router coordinator unit tests, the
  Router's SigningWorker reply-loss reconciliation, the product
  registration, and the claim takeover.

**Not addressed (for review).**
- Abandoning a recovery and restoring the previous authority. This needs an
  explicit, fenced policy.
- Recovery on the wallet-object build. The SigningWorker wallet object
  handles registration only, so a recovery delivery or promotion there never
  reaches it.
- After a recovery promotes, the SigningWorker keeps the previous
  activation's row, still signable there. The Gateway no longer admits it.
- A recovery execute still resolves its tenant root on every call, not
  pinned at admission.
- On a registration replay, a pair running or completed on one side is still
  burned on role-store Workers and answered recoverable on the VM.

### Boundary decision: ceremony records stay in Gateway D1 (2026-09-28)

The lifecycle-keyed ceremony records stay in Gateway D1. This is the final
boundary, not remaining work:
- **They are the Gateway's facts.** The records hold the admission, the
  intent credential that bound it, the tenant root pinned at admission, and
  the progress of recovery and export. Each is decided by the Gateway's own
  authentication and tenant checks.
- **They commit with tenant-wide facts.** Every transition that writes one
  also writes Gateway-owned tenant-wide facts in the same D1 batch: the
  `shared` record's capability, identity, session and nonce indexes, the
  lifecycle's decision row, or the wallet's signer rows. Moving the records
  to a wallet object would split each of those atomic units into a
  cross-owner protocol, with nothing gained in ownership.
- **Nothing here is a cache.** The Router's wallet object owns what the
  Router decides: the execution's claim, lease and generation, the pinned
  request, the terminal answer, and the consumer binding. The Gateway keeps
  no copy of those, and the Router keeps none of the Gateway's records.

What would reopen this: a transition that commits a ceremony record without
any tenant-wide fact, or a need to serve ceremony records from the Router.
Neither exists today.

### Later slices

1. **Export (sized 2026-09-28, awaiting review).** Export's authorization
   runs before its nonce claim, as separate writes:
   - an evidence set;
   - the owner proof (built, not stored);
   - `admitAuthorizedOperation`, a single insert into `authorized_operations`
     keyed by the export's lifecycle and digest. This insert consumes the
     grant.

   Only then does the preclaim commit claim the nonce in the shared record.
   A retry with the same proof replays the admitted operation.

   The proposed change is a prepared variant of that insert: its validation
   reads first, then the insert behind the batch guard, joining the preclaim
   batch as a companion write the way slice 3's replacement joins the
   promotion. The evidence set can stay separate, since an orphan one grants
   nothing. It changes a primitive the signing paths share, so it waits for
   review.

## Current behavior (code-checked 2026-09-25)

Two record families share `router_ab_yao_versioned_json_records` in
`SIGNER_DB`:

- **The shared record** (`router-ab-ed25519-yao:shared`) is tenant-wide.
  - It maps recovery capability bindings to active, suspended or retired
    identities, and indexes stable identity to capability.
  - It also holds recovery sessions, export authorization nonces and the
    export-uncertain set
    (`routerAbEd25519YaoProductRegistrationPartitioning.ts:25-32`).
- **Lifecycle records** are keyed by `lifecycleId`.
  - The ceremony partition holds registration states, admission claims,
    recoveries and exports.
  - The execution record, `registration-execution:<lifecycleId>`, moves
    ready → claimed → completed | failed. A completed record also carries a
    `consumerBinding` written by a first-writer CAS.

`PartitionedStateStore.commit` writes the shared record (only if it changed),
the ceremony record, and any execution-record change in one guarded D1 batch
(`d1VersionedJsonRecordStore.putMany`).

Registration finalization is not one transaction today. It is four separate
D1 transactions (`d1WalletRegistrationService.ts`):

1. `consumeActivated` (≈6046) runs a first-writer CAS of `consumerBinding` on
   the execution record.
2. The wallet commit writes `wallets`, `wallet_signers`, authority, factor and
   email-OTP rows.
3. `installRegistrationFinalizeCapability` (≈6447) is the shared + ceremony
   batch.
4. `commitRegistrationCustody` writes the passkey envelope and recovery set.

Each step is idempotent by its own identity. A retry replays from the
request's idempotency key and fingerprint.

Recovery activation is also split. `replaceActiveCapability` writes
`wallet_signers`, `router_ab_yao_capability_replacements`,
`wallet_authorities` and sessions in one batch. The terminal shared +
ceremony commit is a second batch (`routerAbEd25519YaoRecovery.ts:2506-2544`).

Export first consumes its Gateway grant through the authorization store,
then records nonce replay in the shared record.

## Ownership target

| Fact | Authority after this change |
| --- | --- |
| Execution record: claim lease and generation, pinned request, terminal outcome, `consumerBinding` | Router wallet DO (VM: Router SQLite for that wallet); slice 1 |
| Ceremony partition: admission, intent credential, pinned dispatch root | Gateway D1 until its own slice (see above) |
| Recovery capability index, identity index, recovery sessions, export nonces | Gateway shared D1 (unchanged) |
| Public wallet identity, signer projection, authority, sessions, custody envelope | Gateway D1 (unchanged) |
| Finalization decision per lifecycle | Gateway D1: `yao_lifecycle_decisions`, one row per lifecycle; slice 2 for registration and add-signer |

The shared record never moves into a wallet object: its uniqueness and replay
sets are cross-wallet. The lifecycle partition never gets a D1 copy. There is
exactly one writer per fact.

## Protocol: one decision row per lifecycle

The linearization point is a Gateway D1 decision row, written in the same
batch that makes the registration visible. The wallet DO records its intent
before that point and reconciles against the row afterwards. It never infers
the outcome from its own state alone.

Proposed D1 table (shared authority, tenant-scoped):

```text
yao_lifecycle_decisions(
  scope…, lifecycle_id PRIMARY KEY within scope,
  decision_kind  'registration_finalized' | 'recovery_promoted' | 'export_released' | 'abandoned',
  decision_id    -- H(domain, lifecycle_id, execution_id, consumer_binding, capability_binding)
  wallet_id, execution_receipt_digest, capability_binding_digest,
  decided_at_ms)
```

A lifecycle has at most one decision, enforced by the primary key. An
`abandoned` decision is a tombstone that makes every later visibility batch
for the same lifecycle fail.

### Registration

Built in slice 2 (above), without steps 2 and 4: the Router's consumption
pins the consumer binding, and the decision stays the Gateway's alone. The
proposal as written:

1. **DO: completed.** This already exists. The execution record holds the
   terminal outcome before any peer reply, and `consumerBinding` is claimed
   by first-writer CAS.
2. **DO: `finalizing(decision_id)`.**
   - A CAS moves completed → finalizing and pins the exact decision id.
   - Retrying with the same id replays. A different id conflicts.
   - Nothing becomes visible at this step.
3. **D1: one guarded batch.** The batch contains:
   - the capability installation into the shared record;
   - the decision row (`registration_finalized`, exact `decision_id`);
   - the wallet commit rows that step 2 of the current sequence writes today.

   **This batch is the linearization point:** the registration is visible if
   and only if the decision row exists. Custody commit stays a separate,
   idempotent D1 step that is gated on the decision row, as it is today on
   the wallet commit.
4. **DO: `finalized(decision_id, d1_decision_digest)`.**
   - The DO records the result only after it has read back the exact
     decision row.
   - Replays return the stored response.

**Lost replies and crashes:**

| Failure | Recovery |
| --- | --- |
| Crash or lost reply before step 3 committed | The retry reads DO `finalizing(decision_id)` and re-submits the byte-identical step-3 batch. The primary key makes it insert-once; a matching row counts as success. |
| Lost reply of step 3 | Read the decision row by `lifecycle_id`. An exact `decision_id` match proceeds to step 4. A different decision, or `abandoned`, is terminal and never re-executes. |
| Crash after step 3, before step 4 | The registration is already visible, because D1 is the visibility authority. Any DO read that finds `finalizing` consults D1 by exact id before replying. It never re-runs the protocol. |
| Competing registrations for the same wallet or credential | The shared-record CAS and the existing identity uniqueness in D1 reject the loser atomically with its decision row. |
| Stale or partial state | No step writes whole state. Each is a CAS on the exact prior version or an insert-once of an exact id. |

**Abort.** Before step 3 commits, the only way to cancel is an
`abandoned` decision in D1, for example when the ceremony expires. The DO
may move `finalizing → abandoned` only after reading that tombstone.
Otherwise a delayed step-3 batch could race the abort. After a
`registration_finalized` decision, abort is impossible.

### Recovery promotion

Built differently in slice 3 (above): the replacement rows, the shared record
and the ceremony's `promoted` state commit in one batch, and the ceremony
state is the decision. The SigningWorker's promotion is keyed by the stable
key context, not by the Router execution. The proposal as written:

The same shape applies, with `decision_kind = 'recovery_promoted'`:

- The DO pins `promoting(decision_id)`.
- One D1 batch applies all of these together:
  - suspend old, activate successor and re-point the identity index in the
    shared record;
  - the `replaceActiveCapability` rows (`wallet_signers`,
    `router_ab_yao_capability_replacements`, authority, sessions);
  - the decision row.

  This merges today's two D1 transactions into one, so a promoted successor
  can never exist without its session and authority projection.
- The DO records `promoted` after reading the decision back.
- SigningWorker promotion stays keyed by the Router execution id and is
  reconciled by exact read, as registration activation is today.

### Export

- The Gateway grant consumption and the export nonce claim are both
  tenant-wide D1 facts. They go into one D1 batch, together with the
  `export_released` decision.
- Before any Deriver call, the DO pins the exact grant id and nonce it will
  use.
- A lost reply before release reads the decision. If no decision exists, the
  result is uncertain, and the existing `exportAuthorizationUncertain` set
  stays authoritative: an uncertain export is never re-executed under a fresh
  grant without new owner proof.

## Why the decision lives in D1 and not the DO

Visibility is a tenant-wide fact. The capability index, the identity
uniqueness and the public wallet row are checked across wallets. Putting the
decision in the wallet DO would require a transaction spanning the DO and
D1, which neither host provides, or a second writer for the shared record.
The DO owns everything that can be decided locally: its claim, its terminal
outcome and its intent. D1 owns the one bit that must be globally
consistent.

## VM adapter

The same sequence runs against Router role SQLite for the lifecycle side and
the VM Gateway's shared SQL for the decision row. No step needs a
cross-database transaction.

## Tests required before the partitions move

- A lost reply at each of steps 2–4.
- A crash between steps 3 and 4, then a DO restart.
- Two concurrent finalizations of one lifecycle with different
  `consumerBinding`s.
- An abort racing a delayed step-3 batch.
- A recovery promotion replayed after its capability was superseded.
- Export grant loss after release.

Each must run against the Router wallet DO and VM SQLite, asserting one
decision, no double visibility, and no re-execution.

## Open questions for review

1. Should the wallet commit rows join the decision batch, or stay a separate
   step gated on the decision? Joining makes visibility strictly atomic but
   enlarges the batch.
2. Should the shared record become a per-capability table instead of one JSON
   row? Its 32-entry cap can evict retired tombstones, and its nonce and
   recovery-session sets are unbounded. This is independent of the ownership
   move but touches the same batch.
3. The identity key includes `root_share_epoch`
   (`routerAbEd25519YaoRecovery.ts:1086-1095`). Confirm whether identity
   should survive an epoch swap before the decision row keys on it.
