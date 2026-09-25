# R150 cross-owner Yao finalization, recovery and export

Status: proposal for review. Nothing here is implemented. Until it is
approved, the Yao ceremony and execution partitions stay in Gateway D1 next to
the tenant-wide `router-ab-ed25519-yao:shared` record. The current atomic unit
is unchanged: the batch that installs a capability into the shared record and
advances the lifecycle record.

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
| Ceremony partition, execution record, claim lease, terminal outcome, `consumerBinding` | Router wallet DO (VM: Router SQLite for that wallet) |
| Recovery capability index, identity index, recovery sessions, export nonces | Gateway shared D1 (unchanged) |
| Public wallet identity, signer projection, authority, sessions, custody envelope | Gateway D1 (unchanged) |
| Finalization decision per lifecycle | Gateway shared D1: a new decision row (below) |

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
