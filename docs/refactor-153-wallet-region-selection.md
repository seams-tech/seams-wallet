# Refactor 153: owner-controlled wallet region selection

Status: implementation started, October 3, 2026. The private directory control
plane is implemented. Backend state transfer, writer fencing, owner API, client
reconciliation, settings, and hosted placement remain unfinished.

## Implementation order and prerequisites

Follow **R152 → R170/R171 → R153 → slim R154**.

1. R152 supplies the completed fixed-home routing and state ownership baseline.
2. [R170](refactor-170.md) and [R171](refactor-171.md) are complete within their
   approved scope. Use their committed `dev` implementation and
   [completion receipt](refactor-170-completion.md).
3. Proceed directly to R153 on that client/host composition. Preserve the existing
   relocation journal and evidence. Implement and validate the manual move first.
4. Implement [slim R154](refactor-154-region-change-notifications.md) only after
   R153 acceptance passes. It adds region observations and owner-confirmed suggestions.

Release/adoption work and deployed compression checks can wait. They do not block
R153 implementation. Month-later presignature reuse is a separate task outside
R170/R171 and is not an R153 prerequisite. Use matching client/host builds from
committed `dev` through the existing local candidate workflow when integration
requires them. Publication is not required to start R153.

R153 reuses their host-owned session cleanup, typed commands, session events,
fresh unlock, and on-demand worker preparation. Add relocation handling to those
owners without rebuilding the SDK composition or introducing another lifecycle.

Ordinary lock preserves valid durable presignatures. Relocation retires sessions
and invalidates usable presignatures across all devices through a separate
invalidation operation. Never add a durable-pool purge to ordinary lock or shorten
material validity to implement relocation. Client connection generations and wallet
ownership generations remain separate concepts.

## Architecture decision

Architecture decision, October 5, 2026: retain one active wallet home and use
[R154](refactor-154-region-change-notifications.md) to suggest owner-confirmed moves.
Owners mainly use one region and occasionally travel. The priority is local
permission and signing calls after relocation. Verify actual placement and shared
dependencies before claiming a signing path without cross-region calls.

Move wallet-owned durable state and execution together to the selected home.
Keeping that state in a fixed region while relocating only execution is excluded:
the resulting cross-region storage calls defeat this latency objective.
Shared policy and tenant custody retain their existing ownership boundaries.

[Initial backend relocation validation](refactor-153-backend-relocation-validation.md)
records the Cloudflare capabilities, current storage hazards, local probe
results, and remaining hosted checks.

## October 5 transfer-contract review

The contract below defines the paused, retry-only implementation. Earlier
checkpoints record historical evidence; they do not override this contract.
The ownership input is R152 revision 13. This review adds design requirements
and acceptance gates without claiming a working transfer implementation.

Lifecycle decision: every admitted region change ends all existing signing
sessions and invalidates all usable presignatures across every device. Transfer
durable wallet material and retired history. After activation, each device
authenticates again and creates fresh sessions and presignatures on demand.
Session continuity, sealed-session restoration, and pool restoration are excluded.

| Gap found | Required detail added below |
| --- | --- |
| State selection and disposal were scattered across the plan. | Classify transferred, invalidated, shared, and device-local state. Give each resource one transfer owner. |
| The source receipt already binds a manifest, but invalidation occurred in `copying`. | Finish draining and invalidation before sealing the snapshot in `freezing`. |
| Partial import and acknowledgement loss lacked a durable chunk contract. | Bind each chunk to the frozen manifest. Commit imported records and its acknowledgement together. |
| Historical inserts can consume quota or reject terminal records. | Define a narrowly scoped restore context and preserve ordinary admission guards. Prove it against production stores. |
| `cutover` could not express an active destination awaiting cleanup. | Persist activation independently of cleanup and expose readiness from authenticated evidence. |
| Running-attempt recovery and paused authentication were underspecified. | Reconcile existing participant commands without timer takeover or credential mutation. |

## Implemented baseline

Owner presignature identity claims now use the shared wallet SQL store. Native
admission and step lookup use that store, replacing the native-only implementation
without changing the persisted table. Cloudflare wallet-DO session admission also
records the claim in the wallet transaction before creating live protocol output.
Owner-session steps use that same SQL authority and wallet fence. This backend
does not create a duplicate owner claim in session KV. The private-D1 backend
continues to use its own session KV authority. Step validation binds the ceremony
expiry to the session identity.
The immutable ECDSA snapshot includes these claims and restores their original
authority bytes, identities, and expiry values. Restore validates historical
identity bindings without requiring an unexpired ceremony or reopening admission.
The production-store E2E transfers an expired claim, rejects duplicate and frozen
admissions, and excludes another wallet's later claim. It also rejects unknown
step identities, changed authority, changed expiry, and delayed steps during drain.
Separate presign-session KV
records, linked-session history, existing Cloudflare sessions without wallet SQL
claims, and aggregate participant freeze/transfer remain unfinished.
The existing Worker E2E now verifies real ECDSA signing with the shared SQL
authority, tenant rejection, lost-reply replay, and replay after eviction of the
owner's wallet object. The test identifies that object before tenant rejection
probes, because a rejected tenant lookup can create a separate empty object.
Evidence is retained under `.artifacts/r153/worker-presign-runtime-20261005/`.
This scenario does not verify linked-session freezing or an assembled regional move.
Linked KV consumption in the wallet-DO backend now reads the pinned wallet
authority and checks wallet admission before consuming or expiring a record.
The client cannot select a different wallet for this check. A separate linked
session fence now serializes with its KV claim, completion, consumption, and
expiry transactions. Its private endpoint requires the Router-to-SigningWorker
ECDSA credential and binds the move to the stored wallet, session, and server
presignature identities. Exact retries return the stored receipt; changed commands
fail. Closing the fence clears live linked protocol and completion caches. The
receipt proves a local write barrier only. It does not claim material invalidation
or a sealed snapshot. A separate freeze command requires that exact fence. It
validates the pinned authority without requiring an unexpired signing request,
checks both completion indexes, removes the stored presignature secrets, and
preserves public completion history. Consumption and expiry also retain public
history when removing secrets. Freeze stores canonical snapshot bytes and their
digest in the same transaction as invalidation. Exact retries return the stored
freeze receipt. An absent completion remains explicitly unknown; this change
cannot reconstruct history deleted by earlier builds. Both Worker backend builds
compile. Linked-session export now reads the sealed bytes in chunks of 1 through
65536 bytes. It requires the exact stored freeze receipt, verifies the snapshot
digest, and rejects absent segment indexes. The dedicated Router-to-SigningWorker
ECDSA credential protects this endpoint. Linked destination preparation requires an
empty session object and persists its write fence in the same transaction. Imports
commit each chunk, its acknowledgement, and progress together. Exact retries retain
the original acknowledgement. Verification checks the complete digest, canonical
bytes, authority bindings, retired history, and record count before restoring public
history and the original snapshot. The destination remains fenced, including after
verification. The Worker E2E now covers exact preparation replay, out-of-order and
conflicting chunk rejection, acknowledgements after object eviction, and rejection
of incomplete or invalid history after complete transport. Failed verification
leaves authority and snapshot unavailable after eviction. Evidence is retained under
`.artifacts/r153/linked-session-import-runtime-20261005/`. Successful historical
restore, source freeze races, physical destination preparation, and coordinator
integration for linked sessions remain unfinished.

New linked sessions in the wallet-DO backend now register their session identity,
server presignature identity, and exact initialization digest in the wallet SQL
store before creating local protocol state. Registration shares the wallet mutation
fence, permits exact retries, and rejects conflicting identities. Wallet snapshots
transfer this inventory with exact historical restore. The existing storage E2E
passes with an empty linked inventory. Populated inventory transfer, registration
races, and enumeration by the coordinator remain unverified. A registration can
outlive failed local initialization; the coordinator must reconcile that condition.
Sessions created before this inventory existed still require historical discovery.


ECDSA transfer preserves SQL integers through the Worker JavaScript boundary.
Pool versions and historical effect timestamps use canonical decimal strings in
snapshot encoding and SQL reads. The wallet DO binds integer parameters as text;
SQLite integer-column affinity restores their exact values. This avoids the
Worker library's `i64` to `f64` conversion. The existing production-store scenario
now transfers version `9007199254740993`, including a real version increment,
through chunk retries, process-independent store reopens, and historical restore.
Its SQLite adapter exercises the same decimal parameter binding. This is local
storage evidence; hosted DO execution remains part of composed acceptance.


Presignature expiry now preserves durable owner-session identity claims in both
native SQLite and the session Durable Object. Native admission no longer deletes
expired claims across wallets. The Durable Object alarm clears live protocol
memory without deleting the authority record. Expired requests remain rejected
by the existing expiry checks. This removes expiry-driven changes to identity
history while a wallet is frozen. Aggregate presign-session inventory, transfer,
and source cleanup remain unfinished. Native and WASM compilation cover these
changes; the existing HTTP relocation scenario does not exercise overdue alarms.


R152 closed the ownership dependency at public `c160e107` and private
`8a40b44`. Use [ownership revision 13](refactor-152-state-ownership.md).
Its [results](refactor-152-results.md) retain the regional routing and lifecycle
evidence. R153 consumes that baseline through the completed R170/R171 composition.

Private commits `72ce0f6` and `c0a57c6` implement the directory journal in
`walletPlacement/relocation{,Store,Execution}.ts` and migrations 0070/0071:

- Atomic admission and pause, one pending move, canonical replay, generation
  checks, same-home no-op, and the five-minute cooldown.
- Conditional transitions through the five phases with manifest-bound receipts.
- Persisted attempts, six-attempt budgets, bounded backoff, and explicit recovery.
- Immutable outcomes and type fixtures for phase, identity, and receipt constraints.

This is an internal storage primitive. Its receipt parsers check shape and binding.
Real participant authentication, writer fences, transfer, and activation remain
unwired. Private commit `e87c500` adds migration 0073 and records activation during
`cutover`, before cleanup. Its required activation branch retains the durable
receipt through cleanup retries and restart. Recording activation preserves the
current attempt and retry budget. Completion requires that prior activation.
No owner relocation endpoint is enabled.

The existing private directory E2E covers races, lost replies, restart, cooldown,
receipt conflicts, stale attempts, budget exhaustion, and recovery. Its synthetic
receipts prove directory behavior only. Extend this test for journal changes.

The activation extension covers a lost activation reply, process restart, cleanup
failure, exact replay, rejected conflicting receipts, and rejection of completion
before activation. Type fixtures reject missing or wrong activation receipts and
mixed phase fields. Console type checking, the type fixtures, and focused lint pass.
The directory E2Es write repeatable evidence under the private
`.artifacts/r153/activation-journal-20261005/` directory. This verifies journal
behavior with synthetic participant receipts. Real execution authority and
participant command contracts remain phase-one work.

Private commit `52fa041` adds migration 0074. The directory switches ownership
while keeping the destination paused. Recording durable activation opens ordinary
routing and shared locator publication in the same transaction. The directory E2E
proves that publication fails before activation and succeeds afterward. Old source
publication remains rejected, and unrelated wallets remain usable. Both directory
E2Es, Console type checking, type fixtures, and focused lint pass. Evidence remains
under private `.artifacts/r153/activation-gate-20261005/`. These checks use synthetic
participant receipts; they do not prove role-local writer fencing or transfer.

The internal placement service also provides `placement-status`. It reads the
home and latest journal in one database snapshot. It returns settled placement
and cooldown, the current move with activation/retry state, or explicit absence.
The read remains available during a pause and rejects foreign tenant scope.
Repeated reads leave attempt identity and budget unchanged. The directory E2E
covers cutover, activation with failed cleanup, completion, and a later blocked
move. Evidence remains under private `.artifacts/r153/placement-status-20261005/`.
This internal observation grants no write authority. The owner-facing API and
bounded move-only access remain unfinished.

The internal `relocation-command` endpoint admits Gateway and Wallet Runtime
freeze, verify, activate, and cleanup commands against the current running attempt.
It binds the caller's resource, participant, wallet, generation, and stored phase
evidence. Cleanup requires durable activation. Command identity and input digest
remain unchanged across retry attempts. The directory E2E verifies stale-attempt,
wrong-resource, wrong-wallet, and premature-cleanup rejection, plus restart/retry.
Evidence remains under private `.artifacts/r153/d1-command-authority-20261005/`.
Type fixtures, Console type checking, and focused lint pass. These commands still
need participant-local effect fences and durable results. Rust role command
transport, prepared-version pinning, and authenticated receipt production remain
unfinished. Command admission alone grants no ordinary write authority.

D1 admission now requires fresh source and destination resource proofs from the
existing deployment verifier. Migration 0075 stores these proofs atomically with
admission and makes them immutable. Commands require the recorded participant
version and include it in their input digest. An exact admission replay retains
the original proofs even after expiry. Failed resource preparation leaves the
source active and creates no move. Migration requires earlier pending moves to
finish first. Both directory E2Es, type checks, type fixtures, and focused lint
pass. Evidence remains under private `.artifacts/r153/resource-admission-20261005/`.
This verifies the D1 resource/version subset with synthetic provider checkpoints.
It does not complete owner approval, schema/key checks, Rust role preparation,
participant effects, or the full preparation gate.

The Router registration store now has a transactional source fence on both native
SQLite and the wallet Durable Object. Its private freeze route requires the
existing Gateway-to-Router authentication. It stops new registration claims,
drains admitted claims and activation consumption, then seals a stable record
digest. Claim expiry alone never proves completion. Exact retries return the
stored receipt; changed inputs conflict. No source-reactivation operation exists.
The two existing Router wallet HTTP E2Es pass, including a real held Deriver
request, delayed admission, restart, exact replay, and wallet isolation. The
Cloudflare Router compiles for WASM. Evidence remains in public
`.artifacts/r153/router-wallet-freeze-20261005/`. This covers the Router's
registration records only. Console command integration, other Router stores,
authoritative generation reconciliation, and other participant fences remain
unfinished. No whole-wallet source-fence receipt is produced yet.

Router registration transfer now prepares an inactive destination and imports
bounded segments through the same native and Durable Object transactions.
Preparation fixes the chunk size. Each import stores its acknowledgement with
its effects. Exact retries return that acknowledgement, including after restart
and verification. Changed chunk inputs fail. Historical restore checks wallet,
lifecycle, request digest, and terminal outcome without executing registration
or consumption again. Verification compares the record count and snapshot digest.
The destination remains inactive after verification, and the source stays frozen.
The existing Router HTTP E2E transferred one real registration in 21 segments,
restarted during import, replayed a lost acknowledgement, rejected a changed
chunk, and compared exact stored historical records. Both focused Router E2Es,
the Worker WASM build, and the required bloat check pass. Evidence remains in
`.artifacts/r153/router-wallet-transfer-20261005/`. This covers registration
storage only. Participant activation, cleanup, physical destination resolution,
Console command binding, and transfer of other wallet stores remain unfinished.

An unused Router registration store now records its owner and source fence before
attesting an empty inventory. A store with records or a prior fence but no owner
fails closed. The same transfer verification accepts the empty snapshot without
chunks. The focused HTTP E2E checks both stores after restart, rejects delayed
registration, and preserves another wallet's copied records and replay result.
Evidence remains in `.artifacts/r153/router-empty-inventory-20261005/`.

The ECDSA pool now has an explicit `InvalidateForRelocation` command and a
`WalletRelocated` terminal reason. It destroys available or reserved material
without retiring keys or activations. Reserved records retain their request
bindings. Existing consumed records and tombstones remain unchanged. Exact
invalidation retries use the original revision and timestamp and return the
original terminal result. Both persistence adapters avoid rewriting terminal
ciphertext. Ordinary lock behavior is unchanged.
Native and SigningWorker WASM checks, nine existing pool contract tests, and the
bloat check pass. Evidence remains in
`.artifacts/r153/pool-relocation-invalidation-20261005/`. These checks preserve
existing pool behavior; they do not prove the new operation through an E2E.
The later encrypted SQLite storage scenario exercises the new command through
the production pool store and cipher. It reopens the database for each command,
burns available and reserved records, preserves reservation bindings, and keeps
consumed, previously retired, and unrelated records unchanged. Exact retries
preserve ciphertext and SQL versions. Changed retries and attempts to repopulate
terminal identities fail. It retains a receipt without key material under
`.artifacts/r153/pool-storage-relocation-20261005/`. This scoped storage E2E passes
with the bloat check. Wallet-wide writer fencing, inventory traversal,
presign-session invalidation, coordinator command binding, HTTP authorization,
and composed behavioral acceptance remain unfinished.

The SigningWorker wallet ECDSA store now persists a pool fence in the same
transaction as pool mutations. Freeze first closes pool admission. It waits for
claimed effects to record terminal results, then invalidates usable records and
stores a stable pool digest. Exact freeze retries return the stored receipt.
The encrypted SQLite scenario now also verifies drain across reopen, completion
through the original effect commit, rejection of a previously unrecorded refill,
unchanged frozen bytes, and admission for another wallet. The focused storage
E2E, native build, SigningWorker WASM build, and bloat check pass. Evidence remains
in `.artifacts/r153/pool-fence-20261005/`. This covers the wallet pool store only.
The coordinator does not invoke this operation yet. Other SigningWorker stores,
the separate private-D1 pool, and presign-session admission still need fences.

The pool freeze operation is now reachable through the native SigningWorker
and the existing Cloudflare wallet-DO build. Both require the Router's dedicated
ECDSA service credential. The Worker uses the same transaction wrapper for effect
claims and pool freeze, so an error rolls back the complete operation. The native
HTTP E2E rejects absent and unrelated credentials, freezes an empty inventory,
restarts the SigningWorker, replays the exact receipt, and rejects changed inputs.
Both focused HTTP E2Es, native compilation, wallet-DO and standard SigningWorker
WASM builds, and the bloat check pass. Evidence remains in
`.artifacts/r153/pool-freeze-transport-20261005/`. The standard private-D1 build
does not expose this wallet-store operation. Console command authorization and
coordinator invocation remain unfinished.

Owner presignature initialization now checks the wallet pool fence before reading
material. The native adapter checks it in the transaction that claims session
authority. The wallet-DO adapter uses a separate presignature material-read command,
so an admitted signing effect can still read material and finish. Native session
steps verify the pinned authority before checking the fence; a closed fence
discards that session's live protocol state. Its durable one-use authority remains.
The storage E2E verifies admission rejection in both draining and frozen states
and admission for another wallet. Native and both SigningWorker WASM builds pass,
as does the bloat check. Evidence remains in
`.artifacts/r153/presign-admission-fence-20261005/`. Live native session disposal
still needs composed behavioral coverage. Cloudflare session-step cancellation,
linked presignatures, the separate private-D1 pool, and the aggregate presign-session
freeze barrier remain unfinished. An earlier admitted round may still finish;
the pool publication fence continues to reject its output after freeze.

Cloudflare owner presignature sessions now read typed pool admission from the
wallet Durable Object before initialization and each session step. A closed fence
removes live protocol state after the step verifies the pinned authority. The
durable one-use authority remains. Transport errors stop the step without deleting
live state. This applies to the existing wallet-DO build. The native build, both
SigningWorker WASM builds, production-store E2E, and bloat check pass. Evidence
remains in `.artifacts/r153/presign-step-fence-20261005/`. Cloudflare live-session
disposal still needs composed behavioral coverage. The aggregate freeze barrier,
linked presignatures, and private-D1 pool remain unfinished. An already admitted
round can finish after the check; the pool publication fence rejects its output.

Linked Cloudflare presignature sessions now persist their complete admission
identity before emitting protocol messages. Initialization rejects an existing
claim, including after restart, consumption, or loss of live state. Each step
compares its request, material source, session identity, and expiry with the stored
claim before processing or replay. Completion and consumption leave the claim
intact. Both SigningWorker WASM builds and the bloat check pass. Evidence remains
in `.artifacts/r153/linked-presign-authority-20261005/`. This checkpoint has no
composed behavioral proof yet. Linked admission still needs authenticated deployment
scope and a relocation fence. Its durable claims, completion records, and usable
secrets must join the aggregate freeze and transfer inventory.

The linked presignature transport now requires wallet deployment scope. Rust
validates its wallet identity against the signing request. The stored admission
pins that scope, and later steps reject a changed scope. In the wallet-DO build,
initialization and live steps check the wallet pool fence. Closed admission removes
live state while retaining the durable claim. Exact terminal-step replay remains
available. Server TypeScript, existing type fixtures, both SigningWorker WASM
builds, and the bloat check pass. Evidence remains in
`.artifacts/r153/linked-presign-fence-20261005/`. No Gateway caller of this separate
linked-presignature transport exists in the current source search. Trace the active
linked-device signing flow before claiming end-to-end coverage or retaining an
obsolete transport. Composed behavioral proof, completed-secret invalidation,
private-D1 fencing, and the aggregate freeze barrier remain unfinished.

The active Gateway refill path uses `initializePoolFill`/`advancePoolFill` with
wallet scope from authenticated preprocessing admission. Linked activation material
loads through the common wallet ECDSA store. Its registration activation and linked
reservation, activation, and revocation writes now enforce the same relocation
fence as pool mutations. Read-only linked lifecycle answers remain available.
The guard is named `require_mutation_admission` to reflect this scope. The existing
production-store E2E admits an activation before freeze, then rejects a different
delayed activation during draining and after freeze. Native compilation, wallet-DO
WASM compilation, and the bloat check pass. Evidence remains in
`.artifacts/r153/ecdsa-material-fence-20261005/`. Linked lifecycle transitions still
need composed coverage. The current receipt digests pool records only; activation
and reservation inventory must join the complete participant snapshot.

The wallet ECDSA freeze now inventories all four store collections: pool records,
registration activations, linked reservations, and completed effects. It hashes
exact stored ciphertext and metadata in stable key order, including nullable
indexes, SQL versions, authorization bytes, results, and timestamps. Production
readers validate activation and reservation ciphertext before sealing the receipt.
The required `wallet_records_digest_hex` field distinguishes this inventory from
earlier pool-only receipts. An earlier receipt fails closed at the persistence
boundary and cannot stand in for the expanded inventory. The storage E2E verifies
eight selected records, including an activation and terminal effect, and exact
receipt replay after reopening. Linked-reservation data still needs composed
coverage. This inventory is not yet exported through bounded chunks, and it does
not cover the other SigningWorker stores or the separate presign-session objects.
Evidence remains in `.artifacts/r153/ecdsa-snapshot-20261005/`.

Frozen wallet ECDSA inventories now export through the native SigningWorker and
wallet-DO transports. The endpoint requires the dedicated Router-to-SigningWorker
ECDSA credential. Each request names the exact stored receipt, segment position,
and a size of 1 through 65,536 bytes. The store recomputes the complete inventory
digest before returning a segment. Changed receipts, changed source rows, missing
segments, and oversized requests fail. The production-store E2E reopens storage
for every segment and exact retry, reconstructs the inventory, and detects changed
SQL versions. The HTTP E2E rejects an unrelated credential and repeats the same
export after SigningWorker restart. Native and both WASM builds, these focused
E2Es, and the bloat check pass. Evidence remains in
`.artifacts/r153/ecdsa-export-20261005/`. The export currently reads the complete
wallet inventory to verify each segment. Destination preparation, transactional
import acknowledgements, verification, and coordinator command authority remain
unfinished for this inventory.

Wallet ECDSA destinations now support preparation and durable segment staging
through the native and wallet-DO transports. Preparation requires an empty wallet
inventory and pins the move and chunk size. Every accepted segment commits its
bytes, acknowledgement, and next position in one host transaction. Exact retries
read the saved acknowledgement. Changed inputs and out-of-order segments fail.
Both prepared and importing destinations reject ordinary mutations and source
freeze. The extended production-store E2E stages 33 segments, reopens for every
retry, and injects an error before transaction commit to prove that bytes and
acknowledgement roll back together. All segments remain staged and the destination
stays inactive. Native and both WASM builds, the existing HTTP scenarios, and the
bloat check pass. Evidence remains in `.artifacts/r153/ecdsa-import-20261005/`.
Record restoration, full destination verification, activation, and coordinator
command authority remain unfinished. HTTP transfer commands compile but their
new preparation/import operations still need composed transport coverage.

Wallet ECDSA transfer now verifies and restores a complete staged inventory in
one host transaction. Verification checks segment identity, completeness, source
digest, scope, move, and record count. Restore accepts terminal pool records only,
opens role ciphertext, validates identities, and inserts exact historical rows.
It preserves SQL NULL values, versions, authorization bytes, and terminal results
without invoking signing or quota admission. The destination is marked verified
only after its stored inventory reproduces the source digest. Ordinary admission
stays closed. Exact verification and known chunk retries remain read-only.
The production-store E2E verifies incomplete-copy rejection, wrong-key rejection,
rollback after restoration, exact ciphertext/version preservation, and replay of
the original terminal operation. Native HTTP scenarios, both WASM builds, and the
bloat check pass. Evidence remains in `.artifacts/r153/ecdsa-restore-20261005/`.
Linked-reservation/NULL fixtures and composed transfer transport coverage remain
unfinished. Activation, cleanup, coordinator authority, and the other participant
inventories still require implementation.

The existing two-stack native HTTP scenario now sends ECDSA preparation, import,
and verification commands to a separate destination SigningWorker. It rejects
unrelated credentials and premature verification. After import, it restarts the
destination and receives the exact saved acknowledgement. It then verifies,
restarts again, and receives the exact verification response. Preparation replay
still matches, and a changed verification identity fails. The scenario transfers
an empty ECDSA inventory to isolate transport and process durability. The existing
production-store scenario owns populated encrypted inventory and restore coverage.
The focused HTTP scenario and bloat check pass. Evidence remains in
`.artifacts/r153/ecdsa-transfer-http-20261005/`. This does not prove deployed
Cloudflare execution, key continuity for populated HTTP transfers, or assembled
wallet relocation. Activation, cleanup, and coordinator command authority remain
unfinished.

Retained evidence:
`.artifacts/r153/execution-journal-20261004/`, receipt SHA-256
`02184ddd17816901bf2413115c35ca33a43bd90a269fedaeffb7f6990d8af555`.
The later published-0.8.0 handoff passed both directory E2Es and Console type
checking without candidate overrides. That checkpoint does not verify relocation.

Run the focused directory scenario from the private repository when its code changes:

```sh
pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/wallet-relocation-directory.e2e.test.ts --reporter=line
```

## Intent

Add a Wallet region setting so an owner who expects to spend time in another
region can explicitly choose a supported home for their wallet. Build on
[R152's per-wallet homes](refactor-152-regional-D1.md), extending the fixed-home
rule through a controlled relocation operation.

The setting applies to the whole wallet and all of the owner's devices. Show the
current home separately from a requested move and its progress. A selected region
remains the wallet's preference until the owner changes it.

This phase establishes the relocation operation used when an owner accepts
[R154's region-change suggestion](refactor-154-region-change-notifications.md).

### User-requested pause and progress

The owner accepts a temporary pause and fresh authentication on every device
when confirming a region change. Show this consequence before admission:

> Moving your wallet ends signing sessions on all devices. After the move,
> unlock your wallet again to sign.

Optimize for a short interruption, with a few seconds as a measurement target.
Network partitions, unresolved operations, or recovery can extend the pause. Promise no
fixed completion time before hosted measurements establish the normal duration.

After submission, show a blocking progress view while resolving admission and
performing the transfer. Disable signing, export, recovery, device or factor
changes, and another region change. Enforce the mutation pause at the server
across every device, direct role request, and deferred writer. The loading view
only communicates that durable state.

Keep authenticated status access and local lock available. Closing the wallet,
locking it, or losing the connection does not cancel the move. On reconnect,
resolve the same move before enabling ordinary wallet actions.

Use an indicator with a truthful phase label, such as **Preparing your wallet**,
**Transferring wallet data**, or **Activating the new region**. Do not infer a
percentage from the phase count. Show **Reconnecting to check progress** when the
client loses contact. Show a recovery message when the journal reports a blocked
stage; an indefinite loading indicator must not conceal a known failure.

After verified destination activation and client placement reconciliation, show
the ordinary unlock flow. Require fresh authentication before protected actions.
Source cleanup may continue afterward under the durable journal.
Keep another relocation disabled until cleanup completes. Distinguish wallet
readiness from completion of all move stages.

## Working assumptions and boundaries

- One wallet has one owner using multiple devices. An eligible owner device can
  initiate a move for the wallet; other devices should not need to approve it or
  be online. Require active full-owner authority and a fresh operation-bound
  factor proof, as specified in the move contract below.
- Existing wallets will be deleted before rollout. Exclude existing-wallet
  migration, backfills, legacy formats, and compatibility paths. Relocation must
  still preserve wallets created after that reset.
- Preserve wallet keys and addresses, device permissions and revocations,
  historical quota accounting, and operation identities/results across a move.
  End all signing sessions. Offline devices authenticate again in the new home.
- At most one home may authorize wallet writes, including during crashes, stale
  routing, and retries. One-use signing material must remain single-use.
- Ownership changes at one directory commit after source fencing and destination
  verification. Each participant persists its transfer progress for exact retries.
  The copy itself can span several transactions while both homes reject new work.
- Invalidate every usable presignature before the snapshot. Preserve durable
  signing material and identities, consumed-material history, and operation
  results. Start the destination with no usable sessions or presignatures.
- Shared tenant policy, identity uniqueness, and shared custody authorities retain
  their ownership boundaries. Determine which wallet-owned resources move.
- Region-change detection and notifications belong to R154. Owners choose each move.


## Binding validation: paused server-side transfer

Question: can a paused, role-preserving server-side transfer keep every wallet
and device identity intact?

**The current binding contracts permit this, provided the destination remains
the same logical custody and authorization deployment.** Geography, D1 database
ID, and Cloudflare physical DO ID are absent from the material bindings examined.
The production authorization service accepted existing credentials against copied
records in an independent local D1 database. That probe establishes a binding fact.
The selected lifecycle deliberately retires those sessions before copying.
Fresh authentication and signing after relocation still require assembled E2E evidence.

Adopt these constraints for the relocation design:

- Preserve wallet IDs, keys/addresses, authority and device IDs, factors,
  permissions, and replay history. Retain old session IDs, credential digests,
  and quota rows as retired history. New sessions receive fresh identities.
- Preserve material activation references, activation epochs, signing-root
  metadata, revocation epochs, logical role/server IDs, signer-set identity, and
  the logical object names authenticated by stored ciphertext. A new placement
  generation is separate metadata; moving home does not rotate those identities.
- Preserve each role's encryption keys and versions, recipient/peer identity,
  and authenticated environment labels. Preserve the Gateway's server-seal
  secret and required key versions for durable Email OTP/custody material.
  Old sealed signing sessions remain unusable even if their ciphertext can open.
  Provision each destination only with its own role's material and keys.
- Keep the public relayer URL, wallet/app origins, and passkey RP identity stable.
  Regional routing happens behind them. Client presign storage includes the
  relayer URL, and hosted credentials enforce the wallet origin.
- Change physical D1/DO locators independently from these stable identities.
  Current deployment tooling derives some protocol IDs from Worker names and
  encryption environment labels from deployment lanes. A regional deployment
  must not accidentally change those values or generate replacement keys.

No inspected binding requires an owner seed, device re-enrollment, new wallet
keys, or a new custody ceremony solely for this physical move. An offline
device retains its enrollment and durable signing material. It discards old
signing credentials, sealed signing sessions, and presignatures when it reconnects.
It authenticates again through the stable endpoint. Prove that existing linked
devices can obtain fresh sessions without re-enrollment before enabling relocation.

The local probe copied two devices' authority/session records and a hosted
credential. Both devices retained exact authorization state; wrong scope and
origin were rejected, expiry still applied, and retiring one device's session
left the other active. It also reproduced a concrete import restriction:
inserting an already-consumed hosted exchange is rejected by the current schema.
Historical-state restoration needs an explicit path without reissuing identities
or replaying authorization transitions.

See the [binding evidence and probe](refactor-153-backend-relocation-validation.md#material-and-authorization-binding-validation)
for exact source references, reproducible checks, and limitations. Remaining
work is the transfer/import and fencing operation, role/key provisioning, shared
authority reconciliation, and an E2E move with both signing curves and an
offline device. The current code does not yet implement that handover.

## Session retirement, presignature invalidation, and relocation frequency

Use one lifecycle for every move:

1. Pause ordinary wallet actions and settle already-admitted operations.
2. Retire every signing session and invalidate every usable presignature.
3. Copy and verify durable wallet state and the resulting inactive history.
4. Switch ownership and activate the destination with empty usable session/pool state.
5. Each device authenticates again and prepares fresh material when needed.

Retirement covers primary and hosted signing credentials, outstanding exchange
codes, linked-device session grants/deliveries, and saved or sealed session restore.
All signing and session-issuance paths must reject the retired parent session.
Do not revoke device enrollment, factor registration, durable signing material,
or wallet recovery configuration.
Use existing session retirement transitions after admitted effects settle.
Do not invent successful completion for an uncertain operation.

Here, signing sessions are authorization grants and live protocol work. Durable
Deriver pair material can use `session` in storage names. Classify it by ownership
and lifecycle before selecting records for retirement or transfer.

Retain claimed/consumed identities, terminal failures, replay records, quota
accounting, and completed results. Existing operation/audit selectors depend on
session parents, so copy those retired parents through the historical restore path.
Delete usable presignature secrets through supported burn transitions, while
keeping their tombstones. Do not add history compaction or archive routing.

A lost signing response remains recoverable after fresh authentication. Authorize
reading the original outcome separately from permission to execute new work.
Match its original operation identity and request digest. Never rebind the old
operation to a fresh session or spend quota again to retrieve its result.
An unresolved outcome blocks freeze; session revocation cannot erase an effect.

New sessions follow ordinary issuance rules with new IDs and allowances.
Old remaining allowances stay retired. Wallet/tenant limits, usage accounting,
device permissions, revocations, and relocation cooldowns do not reset.
Require fresh factor/device authentication after activation. Never use an old
sealed session, retired credential, or relocation approval to mint a new session.

Fence both signing and presignature admission at the source. A delayed refill
must not publish old material after invalidation or into the destination.
Reject stale cached presignatures at the server even if an offline device has
not yet learned about the move. On reconnect, each device reconciles placement,
discards obsolete sessions and cache entries, authenticates again, and obtains
fresh paired material through the normal client/server protocol. The transfer
does not wait for every device to refill. Measure the extra latency of the first
subsequent signature.

Current pool retirement only accepts key/activation retirement reasons, and
client pool generations are local memory. Add an explicit pool invalidation
boundary tied to authoritative placement without rotating wallet keys, material
activation references, or device identities. Preserve one-use tombstones so
deleting pool secrets cannot make the same presignature identity admissible again.
See the [follow-up source validation](refactor-153-backend-relocation-validation.md#presignature-invalidation-and-compute-limits).

Use a **five-minute minimum between wallet relocation admissions** to
limit repeated regeneration. Enforce it server-side across all owner devices and
both settings and notification entrypoints. Allow one move in progress per wallet.
Keep this limit with the authoritative placement state so a move cannot reset it.
Selecting the current home is a no-op for transfer; retrying the same move resumes
its recorded outcome without scheduling another regeneration. Failed attempts
that incur work also need bounded retries; counting only successful moves would
leave a way to bypass the cost limit. Failure/backoff semantics are specified
below; the adequacy of five minutes remains a measurement question. Refill should
use bounded normal demand rather than eagerly warming every offline device.

## Implementation strategy and entry gate

### Modular relocation layer

R153 extends R152 placement through the completed R170/R171 SDK and host. Use
explicit typed dependencies and the existing application composition points. Keep
the orchestration in the current `walletPlacement/relocation*` modules and adjacent
coordinator code; keep storage and cryptographic operations inside their owning
services. Target the completed feature for Wallet SDK/server 0.9.0.

| Boundary | Responsibility |
| --- | --- |
| R152 placement and runtime | Authoritative wallet scope/home/generation, ordinary execution, authentication, signing, persistence and replay. Writers enforce current execution authority locally. |
| Relocation module | Owner admission, eligibility, cooldown, journal, retries, orchestration, evidence collection, cutover and progress. It invokes narrowly typed participant operations through existing authenticated transports. |
| Participant adapters in existing services | Prepare inactive resources, freeze/drain, invalidate presignatures, extract/import, verify, activate and clean up the participant's own state. Produce durable receipts. Each service owns its selectors, record decoding, storage transactions and effect fences. |
| SDK/settings | Confirm wallet-wide session retirement, submit a region choice, and show progress. Reconcile placement, discard old sessions/pools, and use ordinary unlock and refill. No orchestration or custody-store knowledge. |
| R154 notifications | Observe region changes and suggest a destination. Open the existing settings flow for owner confirmation and fresh proof. |

Ordinary signing and wallet flows depend on a small ownership/execution guard.
They must not import the relocation coordinator or branch on its copy/retry/cleanup
phases. The coordinator depends on existing domain services; those services expose
local operations without depending on the coordinator. Public SDK/server contracts
remain independent of private Console implementation. Put adapters next to their
owning stores and roles and use explicit composition to connect them.

The existing seven participant slots form a fixed, required typed set. Define
phase-specific command and receipt contracts as the real endpoints are connected;
do not weaken them to arbitrary command strings, optional hooks or generic JSON.
Extend existing transport/authentication boundaries. A runtime plugin registry,
dynamic loading, a new package or a generic workflow framework is unnecessary for
this feature. Separate a new module only when it owns actual behavior.

The module is optional at application composition: an installation may omit the
relocation API/coordinator and continue normal fixed-home operation. Ownership
enforcement remains mandatory in every relocation-capable writer. Removing or
stopping the module cannot undo a pause, erase a journal or reopen a retired source.
An interrupted move remains at its durable authority state until the coordinator
resumes. Avoid a legacy writer path or a flag that bypasses generation checks.

This boundary contains the feature's workflow complexity while preserving the
core safety integration: fencing must execute at each write/effect boundary. A
Gateway-only wrapper cannot protect deferred callbacks, direct role requests or
storage restored from an earlier generation. Keep those guards small and test
normal execution with the relocation entrypoints absent, plus interrupted moves
with the coordinator stopped and restarted.

### Transfer strategy

Implement one **forward-only, paused, role-preserving transfer** with exact retries.
Preserve source data and frozen transfer inputs until verified destination
activation is durable. Required session retirement and presignature invalidation
still happen before the snapshot. Preserving the source never permits reactivation.

Use this lifecycle:

1. **Complete preparation before pausing the wallet.** Prepare inactive regional
   resources and check every prerequisite that does not require frozen source data.
   Pin the checked resources at admission. Drain work and verify copied wallet
   data after the pause. Preparation cannot prove those conditions in advance.
2. **Transfer one immutable snapshot.** Settle admitted work, retire signing
   sessions, and invalidate usable presignatures before sealing the snapshot.
   Every retry uses the same snapshot, manifest, and chunk identities.
3. **Make each transfer command independently repeatable.** Persist command
   identities, input digests, and durable results at the owning participant.
   Exact retries return recorded results. Changed inputs under the same identity
   block the move. Resolve uncertain effects before issuing a completion receipt.
4. **Separate activation from cleanup.** Persist destination activation during
   `cutover`. Allow fresh authentication and signing after client reconciliation
   while source cleanup retries. Block another move until cleanup completes.
5. **Keep historical import narrow.** Use dedicated store restore operations with
   transaction-scoped permission for the wallet, move, and chunk. Preserve identity
   and parent checks. Adjust only demonstrated restore-sensitive trigger paths.

These rules refine the existing five phases. They add no rollback or second
transfer protocol. Fresh authentication and refill happen after activation.
Measure pause duration before adding online pre-copy or delta replication.
Keep wallet key derivation, custody ceremonies, and device enrollment intact.

The investigation found no fundamental identity-binding blocker under the
preservation contract above. Most work is in routing, writer fencing, exact
historical-state restoration, and device cache reconciliation. This assessment
depends on the assembled signing/fault tests; successful row copying alone does
not establish safe relocation.

R152 supplies implemented home routing, verified composition, and the closed
revision-13 ownership contract. Before integrating an executable move:

- [x] Freeze R152's [wallet/shared ownership inventory](refactor-152-state-ownership.md),
  with revision 12 closing signer selectors and DO/Container/role-private material
  accounting. The original inventory counted 56 signer and 84 shared Console
  tables; apply subsequent schema changes through signer migration 0048.
  Shared identity bindings should continue resolving to the same wallet through
  the updated directory.
- [ ] Extend R152's fixed-home execution context and admitted resource catalog
  with relocation generations, local fences, and destination activation evidence.
- [ ] Pin the source and destination builds, schema revisions, and resource set
  used by the move. Coordinate changes to shared files during implementation.

Use existing directory/services, wallet stores, role boundaries, and request
routing. Keep one relocation operation for R153 and R154. Existing-wallet
backfills, compatibility modes, arbitrary destination URLs/resources, independently
keyed custody deployments, and live MPC-session transfer stay outside this scope.

## Move contract — step 1

These are implementation decisions for the first manual relocation operation.
The existing directory journal implements a subset; the gaps at the end of this
section are implementation work, not additional product decisions. The ownership
input is R152 revision 13. No endpoint is enabled by this contract update.
R154 suggestions use the same owner confirmation and fresh-proof requirements.
Region observations and notification actions cannot authorize relocation.

### Owner authorization and destination eligibility

- Any active full-owner authority of the wallet may initiate relocation, including
  an installed linked device. Use the existing full-owner permission comparison
  in `d1WalletAuthMethodService.ts`; do not compare the caller with the founding
  registration authority. Partial/delegated permissions and Console administration
  alone do not authorize a move. Other devices need no approval or online presence.
- Authenticate the Wallet Session and its request/origin binding. For a new move,
  additionally require a fresh passkey or Email OTP proof from an active method
  belonging to that same wallet and full-owner authority. Apply the existing
  factor's verification rules, including WebAuthn user verification. A provider
  token or long-lived Wallet Session alone is insufficient.
- Issue a relocation-specific challenge with a server-recorded lifetime of at most
  five minutes, capped by the factor's own expiry. Bind it to the deployment scope,
  wallet, move ID, destination region, expected generation and initiating authority.
  Reject future/expired proofs and cross-purpose reuse. Use the existing fresh-proof
  and active-authority guard patterns; never reuse a revocation challenge verbatim.
- Authorization linearizes at the source transaction that checks active method,
  full-owner permissions and revocation epoch, consumes the proof, and records
  approval of the exact move digest. Console admission accepts that approval only
  for its original scope/generation and before expiry. A later method revocation
  cannot undo an already-authorized operation; it prevents new approvals and
  unauthorized result reads. Persist approval before contacting Console so a lost
  reply can replay the same approval without spending another factor proof.
  Use scoped authorization/replay persistence with explicit wallet ownership;
  include the approval in the selected wallet's retained operation history.
  Record the initiating credential's bounded, move-only read authorization with
  this approval, as defined below. It cannot authorize a signing operation.
- The source transaction and Console admission are separate commits. Before
  Console admission, there is no relocation pause or transfer. A lost admission
  reply is resolved by reading the journal; an unused expired approval authorizes
  no new admission. Proof consumption alone never claims a completed admission.
- Admit only established wallets in the same logical tenant/custody deployment.
  Resolve US, WEUR, APAC or OC through the server's admitted regional catalog. Clients
  supply no D1 IDs, URLs, role identities or key material. Before admission, verify
  destination resources, schema/import support, role identities, required key
  versions, server-seal continuity, and authenticated transport access. Prepare
  inactive destination resources before admission pauses the source. This preparation
  copies no wallet data and grants no ordinary execution authority. A preparation
  failure leaves source placement and signing sessions unchanged and charges no
  relocation cooldown. Pin the checked resource/configuration
  identities to the move; subsequent configuration changes cannot retarget it.
  Unsupported custody/jurisdiction configurations return an eligibility failure.

### Request, status and admission results

Use the stable Gateway origin and existing wallet authentication boundary:

| Operation | Contract |
| --- | --- |
| Read placement: `GET /wallet/placement/v1?walletId=…` | Authenticated wallet access returns active home and generation, or the pending move's safe progress. Resolve deployment scope from the authenticated boundary. |
| Admit: `POST /wallet/placement/v1/relocations` | Body requires `walletId`, `moveId`, `destinationRegion`, `expectedGeneration` and `sourceProof`. Verify the factor proof for a new admission; an exact replay does not consume it again. Resolve the initiating authority from authentication and the destination resources from the catalog. Reuse the journal's `wmove_` identity and canonical request digest. |
| Read move: `GET /wallet/placement/v1/relocations/{moveId}?walletId=…` | The initiating device uses its move-only read authorization during transfer. After activation, any freshly authenticated full-owner device may read progress. The initiating authority stays immutable. A move ID is never a bearer credential. |

Parse once into precise internal identities and phase-specific types. Keep proof
bytes, request nonces and refreshed session tokens outside the canonical move
digest. The digest binds the full wallet scope, move ID, destination resources,
expected generation and initiating authority, as the existing request does.
Public responses expose regions, generations, move identity, phase, timestamps
and safe error codes; role receipts and infrastructure/key details stay internal.

Admission results are discriminated: `admitted` or `reused` carries the move;
`unchanged` carries the active placement; `rejected` carries a specific code.
`cooldown` additionally requires `retryAtMs`; other rejection branches omit it.
Distinguish invalid input, unauthenticated, insufficient permission, expired proof,
unsupported destination, unavailable authority, unestablished wallet, stale
generation, request conflict and another move in progress. Never turn an unknown
admission outcome into a second move ID automatically.

Authenticate ordinary access or move-only read access first. Look up an existing
move before fresh-proof, cooldown, or current-catalog admission checks.
An exact retry returns its recorded progress/result even after cutover, proof
expiry, or catalog changes. It does not re-consume the factor proof.
Reusing its ID with a different canonical request
returns `request_conflict`. Move-only access can only read an existing matching
move or replay its exact admitted request. It cannot authorize a new admission.
Another device never rewrites the initiating authority.
Status and authenticated admission replay remain reachable while ordinary wallet
mutations are paused. These reads must not issue credentials or mutate copied
authorization/counter state; use the shared request-proof authority where needed.

Keep progress authentication separate from signing-session validity. At approval,
record the initiating credential digest, request/origin binding, authority, exact
move scope, and original expiry. Reuse that credential only as proof of the
recorded move-only read authorization. Do not create another token or extend its
lifetime. Model this access separately from an active Wallet Session so ordinary
authorization code cannot accept it for signing, unlock, export, or new admission.
The client removes the credential from its signing state. Only the progress view
may retain its move-only access under the existing credential storage/lock rules.

The status resolver permits only safe placement/progress reads for that move and
exact admission replay. Preserve credential proof, origin, expiry, authority
revocation, and shared request-proof checks. Use the pinned approval at the source
before cutover and its verified copy afterward. Retirement caused by this move
does not remove its separate read authorization. Other revocations still deny
access. Never refresh a session, redeem an exchange, increment a copied counter,
or issue a credential to make status polling work.

If locking or expiry removes the caller's usable credentials, return an
authentication failure and let the server continue the move. The UI may show a
generic connection/authentication message without exposing private progress.
Other devices can show a generic unavailable/locked state until normal unlock
resumes after destination activation. Keep only the move locator and the existing
credential under its ordinary storage/lock rules; do not retain it past local lock
for polling. The locator grants no authority. Polling never starts work or resets
retry budgets.

### Cooldown, concurrency and cancellation

- Admission atomically journals the move and pauses new wallet mutations. Console
  is authoritative for time, current generation, one pending move and the cooldown.
  Require at least 300,000 ms since the previous admitted move, across all devices
  and entrypoints. A move still pending blocks another regardless
  of elapsed time. An admission that later encounters failure still counts.
- Reject preflight/auth failures before admission without charging this cooldown.
  Use the existing authentication/rate limits for rejected requests. The original
  admitted time survives retries, restarts and cleanup.
- Selecting the active home at the current generation is `unchanged`: no pause,
  journal admission, cooldown extension, transfer or refill. This is a placement
  read/no-op. It does not retire sessions or reserve a move ID. If placement
  subsequently changes, a retry with that stale generation is rejected.
  During a pending move, selecting
  its source is a conflicting request, not cancellation.
- The owner can cancel the settings interaction before submitting the admission
  request. Once submitted, closing the UI or aborting HTTP does not cancel server
  execution; resolve the journal outcome. Once admitted, there is
  **no cancellation or rollback operation**, including before
  cutover. Resolve a lost response before claiming cancellation succeeded. Repair
  and resume the same move after failure. This preserves the journal's linear
  protocol and avoids reactivating a partly retired source generation.
- Before cutover, an unrecoverable destination outage can therefore leave the
  wallet paused until repaired. Surface that state explicitly. Preserve the
  source fences and journal while repairing and resuming the same move.

### Phases and required evidence

Let the active source generation be `g`. Reserve `g + 1` for the destination at
admission; reject generation exhaustion. Registration, authority, activation,
root-share and signing-root epochs remain unchanged.

| Phase | Writable home and required transition evidence |
| --- | --- |
| `freezing` | Pause new wallet mutations. Drain or reconcile admitted work at every participant. Retire all signing sessions, invalidate usable presignatures, and seal the frozen snapshot and manifest. Destination ordinary execution stays disabled. Persist authenticated source-fence evidence bound to that manifest before advancing. |
| `copying` | Neither home admits ordinary writes. The source snapshot is immutable. Import bounded chunks into inactive destination resources, preserving exact records and durable chunk acknowledgements. Source invalidation is already complete. |
| `verified` | Both homes remain closed to ordinary writes. Required destination receipt binds the exact frozen source manifest, restored records and logical identities to destination resources at `g + 1`; all participant checks passed. |
| `cutover` | One Console transaction CASes the expected paused source, move and receipts to destination `g + 1`. Destination admission remains closed until activation evidence is durable. Persist activation before source cleanup; an activated destination stays usable during cleanup retries. Source `g` stays retired. |
| `completed` | Destination activation and source cleanup have durable receipts. Source wallet secrets/state are removed; retirement fences and immutable move/replay evidence remain. Completion never changes home or generation again. |

Use the existing seven participant slots: Gateway, Wallet Runtime, Router,
Deriver A, Deriver B, SigningWorker and presign sessions. Each slot aggregates
every applicable D1/DO/role-private resource from revision 13. An empty participant
must attest its checked empty inventory. Every receipt binds wallet scope, move
ID, resource identities, generation, phase, protocol version and manifest digest.
The coordinator verifies authenticated issuers and durable underlying evidence;
seven caller-supplied hashes alone do not authorize cutover. Persist exact receipts
so a retry after completion returns the same proof rather than a new timestamp.

### Transfer inventory and ownership

Use the exact selectors and parsers in the
[revision-13 inventory](refactor-152-state-ownership.md). This table defines the
transfer treatment; it does not replace those selectors.

| State | Treatment |
| --- | --- |
| Wallet identity, signer activations, authorities, auth methods, revocations, and passkey counters | Copy exact wallet-owned records, including inactive and revoked branches. Preserve identity and authority relationships. |
| Signing sessions, credentials, hosted exchanges, and linked session deliveries | Retire before the snapshot. Copy required rows as inactive history, preserving IDs, bindings, and retirement decisions. Reject all old signing, exchange, refresh, and session-restore paths. |
| Quotas, operation evidence, audits, and results | Copy exact accounting and replay identities, with required retired/expired parents and exhausted quotas. Do not authorize or charge an operation during restore. New sessions never reactivate old allowances. |
| Custody envelopes, recovery sets, ceremony records, and linked-device installations/delivery receipts | Copy the complete wallet-owned state through its existing role boundary. Preserve ciphertext bindings and completed or abandoned lifecycle history. |
| Deriver pair records and SigningWorker durable material, activation, retirement, and effect records | Transfer from each source role to the same destination role. Preserve logical identities, encryption context, epochs, and one-use history. |
| Ready/reserved presignatures and live protocol sessions | Settle admitted effects first. Safely terminate remaining preparation and invalidate usable material before the snapshot. Preserve burned/consumed identities. Never import a live lock or session as fresh authority. |
| Shared Console identity/policy/billing records and shared tenant custody | Keep their current authority. Reconcile physical references through the committed placement. Do not clone shared derivation secrets or rewind shared revocation state. |
| Device-local custody secrets, enrollment, and durable signing material | Keep them on the device. Discard old signing credentials, sealed sessions, and presignatures on reconnect. Authenticate again and refill on demand. Do not require every device online. |

Assign each physical store or selected record set to exactly one of the seven
participants. Other participants may reference its digest; they must not import
the same records again. Resolve indirect ownership through scoped parent joins.
For mixed JSON partitions, select validated wallet entries and preserve unrelated
entries with a local version-checked merge. Unknown or ambiguous ownership blocks
the move.

Keep source data and frozen transfer inputs until destination activation is
durable. Never delete source records to mark a chunk as sent. Provision only the
destination role's required key versions through the existing deployment secret
boundary. The coordinator handles resource references and receipts, without
decrypting or collecting role secrets.

### Freeze barrier and immutable snapshot

Complete these steps in order within `freezing`:

1. Each participant durably closes ordinary admission for the source generation.
   Serialize that change with local write/effect admission. Record already-admitted
   operations that still need to settle.
2. Drain those operations through their original identities. Reconcile submitted
   external effects and lost replies. A timeout, lease expiry, or absent response
   cannot establish that an effect did not occur.
3. Retire every signing session through existing lifecycle transitions. Close
   hosted exchange, linked delivery, refresh, and sealed-session restore paths.
   Terminate unused preparation through supported cleanup and burn rules. Prevent
   delayed refill, WebSocket, alarm, and background callbacks from publishing
   new material. Preserve exact results and consumption history.
4. Confirm every participant reached quiescence: no admitted operation can still
   change the selected snapshot. Settle pending lifecycle decisions or preserve
   them as inert historical records with a defined replay result. If a record
   still requires source execution, remain in `freezing`. Use existing protocol
   terminal transitions; never fabricate success or failure to complete a snapshot.
5. Capture each participant's stable selected state, then seal the common manifest
   and source-fence receipt. Source-side expiry cleanup must also respect the fence.

Preliminary local fence records do not need the final manifest digest. The
aggregate source receipt is issued only after the manifest is sealed. Export
reads after that point must reproduce the same snapshot. Keep transfer-command
receipts and progress outside the snapshot to avoid a changing or circular digest.

Do not use one transaction across independent stores. Their durable fences make
successive snapshots consistent. Shared authorities remain live; copied references
must still obey their current policy and retirement decisions at activation and use.

### Manifest, transport, and resumable chunks

Pin one schema-compatible transfer format for the move. Reject incompatible
destinations before admission. Do not add cross-version conversion inside a move.
Each participant defines its record order using complete primary keys and its
existing storage schema. Shared ownership selectors remain explicit.

Deployment and key maintenance must preserve the resources, schema support, and
key versions pinned by unfinished moves. A catalog update cannot retarget a move.
If maintenance invalidates a pinned prerequisite, block execution until repaired.

The immutable manifest binds wallet scope, move ID, both generations, the pinned
resource set, schema/format revisions, and the fixed participant set. For every
selected collection, include its count, ordered chunk digests, and aggregate
digest. Include empty collections and required SQL/KV/alarm dispositions so an
omission cannot look like an empty store. This is per-move transfer evidence,
without a new configuration registry or schema generator.

Use a deterministic encoding that preserves bytes, SQL NULL, text, and full-width
integers. Use exact decimal integer encoding where JSON numbers lose precision.
Hash the encoded records in fixed order; do not hash arbitrary object iteration
order. Each store adapter validates the boundary once into its typed records.

Send bounded chunks directly between corresponding roles through existing
authenticated internal transports. Bind each command to the move, participant,
source/destination resource, collection, chunk position, and expected digest.
Choose byte and row limits against the deployed storage/request limits before
enabling transfer. Never buffer the entire wallet in a Worker or coordinator.

The destination applies these rules in one local transaction per chunk:

1. Authenticate the command against the pinned destination and move.
   Validate scope, schema, position, contents, and manifest digest.
2. If this exact chunk has a committed acknowledgement, return it without writing
   records again. A changed digest under the same chunk identity is a conflict.
3. For a new chunk, require the inactive destination and open import gate.
   Restore records in dependency order. An existing identical record is acceptable.
   A different value under the same key blocks the move. Never overwrite it with
   `INSERT OR REPLACE` or interpret ignored conflicts as verification.
4. Commit the records and their acknowledgement together. Failed transactions
   commit neither. After a lost response, read or replay the same chunk identity.

For mixed-store participants, commit separate chunks in each local store and
aggregate their verified acknowledgements. Destination incompleteness is safe
because ordinary execution stays closed. Successful chunks do not consume new
stage attempts. Retries reuse the snapshot and chunk identities across attempts.

Once verification closes the import gate, new chunk writes are forbidden. Exact
late retries can read existing acknowledgements after authentication; they cannot
overwrite records after activation. Verification and import-gate closure must
serialize with local imports. Reject unknown or extra records in the selected
destination scope, without deleting another wallet's data.

### Historical restore and destination verification

Use a dedicated internal restore operation in the owning store. Ordinary session
issuance, registration, quota claims, and signing APIs must not perform restoration.
The current consumed-exchange probe disabled a trigger temporarily; that technique
is excluded from production shared databases.

For rows rejected or mutated by ordinary insertion triggers, implement a scoped
restore context in the same local transaction as the imported rows. It must bind
the wallet, move, inactive destination generation, and verified chunk. Enter and
clear that context inside the transaction so it cannot remain enabled afterward.
Only the authenticated import path may establish it. A foreign wallet or ordinary
request cannot use it.

Adjust only the demonstrated restore-sensitive trigger paths: initial lifecycle
checks, admission-time expiry checks, quota consumption, and generated audit or
credential side effects. Preserve scope, identity, uniqueness, and parent integrity
checks. Insert exact historical audit/credential rows instead of regenerating them.
Current expiry and revocation rules still apply when restored records are used.
Prove the precise trigger changes with the production store before wiring cutover.

Each destination role reads restored records through its production parsers and
decryptors. Check required key versions, ciphertext bindings, parent relationships,
terminal results, and absence of usable old sessions or presignatures. Verify
that no hosted exchange or linked delivery can revive a retired session.
Recompute counts and digests from stored rows, rather than echoing incoming hashes.
Verification must have no signing, credential, quota, or external side effects.

Persist each verification receipt with the closed local import gate. Aggregate
only receipts from authenticated, pinned participants for the same manifest.
Journal transitions establish order. Timestamps support diagnostics only.
Matching identities and digests bind the evidence. A receipt-shaped JSON object
alone grants no execution authority.

### Activation, shared references, and cleanup

Cutover changes the directory's home atomically and keeps placement paused.
Each participant
must install generation `g + 1`, confirm the committed move, and durably acknowledge
readiness while ordinary admission remains closed. Reconcile physical role/pair
references with their existing shared authority, without altering logical identities.

Persist an aggregate destination-activation receipt after every required
participant is ready. Ordinary requests, direct role calls, and deferred work
must carry or resolve authenticated evidence of both cutover and activation.
Open admission only under that execution authority. Revalidate current shared
policy and retirement state; a frozen snapshot cannot revive retired material.
Readiness requires all imported signing sessions retired and no usable old
presignatures. Do not issue sessions or refill pools inside the relocation job.
After activation, devices use ordinary fresh authentication and authorized refill
on demand. Neither step delays backend activation or waits for offline devices.

Use durable regional activation evidence during ordinary execution. Relocation
readiness must not add a Console roundtrip to every signature. Local generation
fences and authoritative restart reconciliation still apply. Existing shared
authorization dependencies require their separate latency assessment.

`WalletRelocationProgress` and migration 0073 persist activation during `cutover`.
The required activation branches are `awaiting_activation` and `activated` with
its receipt. Activation preserves the existing five phases and stage retry budget.
Connect this journal state to authenticated participant evidence and regional
execution authority. Do not add an independent
`walletReady` flag or infer readiness from an error string or directory region.

After activation, the destination can change normally. Retries verify the stored
activation/import receipts, without comparing the live destination to the old
snapshot or re-importing it. Client caches reconcile the authoritative generation
before fresh authentication and signing. Old sessions and presignatures remain
invalid even for a device that missed every notification. Client deletion alone
never establishes revocation; every server admission path enforces it.

Cleanup removes only the source wallet subset, obsolete alarms, and temporary
transfer payloads after the activation receipt is durable. Preserve retirement
fences and immutable move/command evidence. Never erase a whole shared database,
mixed JSON partition, or encryption key needed by another wallet. Keep uncertain
cleanup resumable and another relocation blocked. A cleanup receipt proves the
specified live-resource deletion; backup erasure requires a separate retention claim.

### Writer fence and authority lifetime

Every ordinary mutation/effect carries the exact wallet scope, resource identity
and ownership generation through Gateway, Runtime, role RPCs and deferred work.
Generation metadata is outside signing operation IDs/digests, preserving exact
signing retries. Move-control commands additionally bind the admitted move and
allowed phase, and cannot authorize ordinary signing or credential issuance.

At each writer, serialize durable fence installation with write/effect admission.
Close admission, settle tracked in-flight work, then persist the source receipt.
Commit-time generation/fence checks must share the local transaction or serialized
effect gate with the write. A prior directory lookup followed by an unguarded
commit, a cached generation, or an expired timer is insufficient. Shared Console
wallet-affecting mutations use its own transactional placement guard.

External effects already submitted, including NEAR provisioning, need durable
operation identity and outcome reconciliation before source quiescence. An unknown
effect outcome keeps the freeze incomplete. Late refill, WebSocket completion,
alarms and protocol callbacks must settle or be durably prevented from publishing
after the fence. Timeouts alone cannot prove either result.

Retirement markers outlive source cleanup and are excluded from wallet snapshot
restoration. On restart, deployment replacement or restored storage, a role must
reconcile its resource/generation with authoritative Console placement before
admitting ordinary work. Directory unavailability fails closed. Older deployments
that bypass the fence cannot retain writable bindings or serve the wallet; verify
that deployment prerequisite before enabling moves. Returning to a region later
uses a new generation and fresh physical targets, retaining old retirement markers.

### Crash recovery and bounded retries

Recovery uses retries and reconciliation, with no rollback. After a network
failure, resume or reconcile the same move with the same operation and material
identities. Never trigger a second admission or restore an earlier snapshot over
current state.
The accepted UI pause does not remove any source-fence or verification requirement.

| Failure | Recovery and owner experience |
| --- | --- |
| Before admission | Resolve an uncertain admission response. If no move was admitted, the source stays active. |
| After admission, before cutover | Keep new wallet mutations paused. Resume the recorded stage after transient failure, within its retry budget. |
| Cutover response is lost | Read the authoritative decision. Keep actions blocked while ownership is unknown. Never reactivate the source based on a timeout. |
| After cutover, before destination activation | Resume destination activation. The source remains retired. |
| After activation, during source cleanup | Allow reconciled clients to authenticate again and use the destination. Retry cleanup and block another relocation until completion. |
| Retry budget exhausted or evidence conflicts | Report the blocked stage. Repair and resume through the existing internal recovery action. Preserve the phase's execution restrictions. |

Do not add a source-reactivation or rollback path. After cutover, returning to
the source requires a new verified relocation after the current move completes.

The durable phase describes authority; execution status describes progress within
that phase. Use required discriminated status branches: `ready` for an unclaimed
stage, `running` for a claimed attempt, `retry_wait`
with an error code and server `retryAtMs`, or `blocked` with a stable error code.
Completion has no retry status. Error text/logs do not drive phase transitions.

Persist stage progress and claim attempts through a journal CAS so competing
coordinators cannot reset or bypass the budget. Initially allow six attempts per stage, with
1, 2, 4, 8 and 16 second delays before attempts two through six. Retry transient
transport/unavailability failures only. Identity, receipt or content conflicts
block immediately; exhaustion also blocks. Restart and owner polling must not
reset the budget. An authenticated internal recovery action after repair may
resume the existing stage with a new recorded budget; it creates no new move or
fresh regeneration work. Reuse the project's existing job/retry mechanism.

Identify each stage command by move, participant, stage, and command position.
Chunk commands also include their resource, collection, and chunk position.
Persist the input digest under that identity. Exact retries return the recorded
result. A changed input under the same identity is a conflict.
A crash before recording a response is
resolved through the participant's durable result and the journal. Cutover response
loss always triggers an authoritative read: if committed, continue destination
activation/cleanup; if still verified, retry the same CAS. If authority cannot be
read, neither recovery code nor a timer may reactivate the source. Cleanup failure
leaves the destination active in `cutover` and blocks a subsequent move until
completion. Generation and cooldown history survive all cleanup.

On restart, the coordinator discovers unfinished journals through the existing
job mechanism. It resumes a persisted `running` attempt using its existing identity.
Before resending work, query the participant's durable command receipt. An uncertain
response keeps the same command identity and input digest. Several coordinators
may reconcile that command, but local command claims must serialize its effects.
Do not create a timer-based takeover or reset attempts when a browser reconnects.

A newer recorded retry attempt may continue the same immutable transfer commands.
Reject stale attempts that try to advance the journal or introduce different work.
Already-admitted commands must remain exact and harmless to repeat, even if their
reply arrives after the coordinator records a transport failure. Phase gates,
local fences, and import closure must prevent late writes after activation.

Retain the source snapshot and acknowledged destination chunks through blocked
recovery. An internal recovery action grants another recorded retry run after
repair. It cannot change the destination, replace the manifest, erase conflicting
records, or skip a receipt. If pinned resources or source data are irrecoverably
lost, retry-only relocation can remain unavailable; report that limitation rather
than inventing a new owner or promising a bounded recovery time.

## Implementation stages

The move contract above is settled. Use this checklist for remaining implementation
work. Acceptance ownership appears below. Do not create separate deliverables for
the same requirement in each section.

### 0. Use the committed implementation

- [x] R170/R171 are complete within their approved scope. Their completion receipt
  records source revision `8ecbea72` and matching protocol `14.0.0`.
  Build R153 on committed `dev` and reuse that evidence for unchanged behavior.
- [ ] Map SDK/settings work to the established host lifecycle and final public API.
  Keep ordinary-lock retention separate from relocation-driven invalidation.
- [ ] Extend existing type fixtures when shared domain types change. Cover missing
  activation receipts, premature cleanup, forged construction, broad spreads,
  and move-only access passed as signing authority. Check runtime identity values
  at boundary parsers through behavioral tests. Explicit unsafe assertions remain
  review concerns where TypeScript cannot reject them.

### 1. Directory authority, move admission, and regional execution

- [x] Extend the existing Console wallet directory with persistent ownership
  generation, one active move, progress/recovery state, and wallet-wide cooldown.
  Preserve immutable wallet and founding-registration identities. Replace the
  blanket immutable-home rule with changes permitted only by a verified move.
- [ ] Prepare inactive regional D1 resources and fresh physical per-role DO
  identities before admission pauses the wallet. Apply intended location hints
  on first creation. Verify schema/import support, logical identities, required
  key versions, server-seal continuity, and authenticated transport access.
  Pin the checked resources at admission without exposing keys to a central mover.
- [ ] Admit moves through the authenticated owner path and configured region
  catalog. Persist the move before transfer effects. Bind retries to the same
  canonical request; changed destinations/requests conflict. Selecting the
  current home performs no transfer, session retirement, or presignature regeneration.
- [ ] Carry the admitted home/generation through the existing regional service
  graph. Require authority at every mutation boundary, including direct/internal
  requests, recovery, linking, revocation, quota changes, refills, jobs, and alarms.
  Read authoritative state after a lost ownership-switch response.
- [ ] Persist conditional progress transitions and recover unfinished stages after
  process restart. Extend the existing journal with participant command evidence
  and independent activation persistence. Preserve stage budgets across chunk
  progress, restart, and UI polling.

### 2. Source quiescence and session/pool retirement

- [ ] Keep prepared destinations inactive. Stop new source admissions, drain already
  admitted effects, and reconcile unfinished claims. If an effect's outcome or
  source quiescence is uncertain, retain the pause and reconcile before switching.
- [ ] Fence Router, Deriver A/B, SigningWorker, and presign session/deferred paths.
  Keep role-local material with its existing role. Include shared tenant-root
  admission/retirement references in the cutover contract.
- [ ] Retire all devices' signing sessions after admitted effects settle. Reject
  old primary/hosted credentials, exchange codes, linked credential deliveries,
  refresh, and saved/sealed-session restore. Keep device/factor enrollment active.
- [ ] Add explicit presignature invalidation independent of key/activation
  retirement. Burn usable secrets while preserving claimed/consumed identities,
  tombstones, request bindings, and terminal results. Account for both wallet SQL
  pools and linked-device presign-session KV/one-use records.
- [ ] Reject delayed source rounds and pool admissions. An in-flight refill whose
  identity was never stored must not repopulate a pool after invalidation.
- [ ] Seal the common manifest only after every participant is quiescent and
  session retirement and pool invalidation are complete. Keep snapshot bytes
  stable through retries and expiry.

### 3. Exact state transfer and destination verification

- [ ] Extract the wallet-owned subset from the frozen R152 inventory. Preserve
  indirect records, dependency order, exact bytes, integer precision, nulls,
  expiry times, revisions, retirement decisions, historical quota accounting,
  and completed/replayed outcomes. Import no usable old signing sessions or pools.
- [ ] Implement bounded, authenticated same-role chunks. Atomically commit each
  local import and acknowledgement. Prove exact replay, conflict rejection, mixed
  partition isolation, and rejection of late imports after the gate closes.
- [ ] Transfer DO SQL and KV explicitly; decide destination alarm work/deadlines
  separately. Live MPC memory is drained or abandoned with identities burned.
  Repeated imports resume the same move without executing authorization again.
- [ ] Restore historical states through the validated scoped import path. Preserve
  consumed hosted exchanges and operation claims/results without reissuing
  credentials, charging quota again, or bypassing unrelated wallets' guards.
- [ ] Verify destination schema, scope, logical identities, record counts,
  revisions, and content digests before it can write. Reject partial/conflicting
  copies. Verify ciphertext through each role's own readers.
- [ ] Keep shared uniqueness, policy, aggregate limits, and tenant-root authority
  at their existing owners. Reconcile physical references through the agreed
  directory resolution so concurrent retirement/revocation reaches the right home.

### 4. Ownership switch, client resume, and cleanup

- [ ] Conditionally switch the directory only after all source fences and
  destination verification are durable. Activate destination writes only after
  confirming that authoritative outcome and every participant's readiness.
  Persist activation before cleanup; every obsolete generation stays fenced.
- [ ] Use stable public endpoints for fresh authentication after activation.
  New sessions have fresh IDs; old grants remain retired. Authorize retrieval of
  an original operation result without changing its identity or spending quota.
  Prove linked devices can obtain fresh sessions without replacement enrollment.
- [ ] Reconcile authoritative placement before using durable or resident client
  presignatures. Cancel stale refill work and clear old sessions, credentials,
  sealed-session restores, and pool caches across tabs and reloads. Authenticate
  again before ordinary refill. Offline devices resume independently. Keep this
  relocation invalidation separate from ordinary lock, which preserves otherwise-valid
  durable presignatures.
- [ ] Add Wallet region to the existing settings surface. Show actual home,
  selected region, pending progress, temporary mutation pause, recoverable failure,
  cooldown retry time, and fresh authentication on all devices. Expose supported
  regions and eligible owner controls. Region-change notifications remain
  R154's follow-up.
- [ ] Implement the blocking progress view and reconnect behavior above. Preserve
  local lock and bounded move-only status access. Show ordinary unlock after
  destination activation and client reconciliation. Show blocked recovery explicitly.
- [ ] Delete obsolete source wallet state after destination activation. Retain
  the authority fence and move outcome needed for cleanup/retry. Failed cleanup is
  resumable and cannot reopen the source. A later move back uses fresh resources.

### 5. Integration, measured suitability, and completion

- [ ] Pass the E2E matrix below, including real ECDSA/Ed25519 signing and both
  passkey and Email OTP fresh authentication where supported. Reject old sealed
  signing sessions and delayed linked credential deliveries.
- [ ] Run the hosted regional suitability scenario below. Reuse its placement,
  timing, and load evidence instead of creating a second measurement campaign.
- [ ] Update intended-behavior specification and matching contracts together.
  Freeze the public package candidate and pin private consumers to its exact
  artifact through the existing integration workflow.
- [ ] Remove superseded fixed-home mutation restrictions, direct writer paths,
  cache assumptions, fixtures, and exports as their replacements land. Preserve
  ordinary identity immutability and registration replay guarantees.
- [ ] Run affected type checks, Rust/wire verification when affected, and the
  required bloat check. Run behavioral scenarios through their assigned owners.
  Broaden checks for shared behavior changes or unresolved failures. Retain results
  for the final tested revisions. Deployments and publication follow the existing
  separate release process.

## Module ownership and integration

Use the existing module boundaries. This table assigns responsibilities, without
requiring a fixed team size or parallel implementation.

| Owner | Surfaces and responsibility |
| --- | --- |
| Coordinator | Private `walletPlacement/relocation*.ts`, directory migrations, and narrow Gateway/Runtime composition. Own admission, journal transitions, retries, and authenticated participant receipts. |
| Custody roles | Public `crates/router-ab-cloudflare/src/` role stores and Durable Objects, plus `router-ab-ecdsa-pool`. Own local fences, invalidation, transfer, verification, activation, and cleanup. |
| D1 stores | Public `packages/wallet-server/src/router/cloudflare/d1/` and signer migrations. Own exact selection, chunk transactions, historical restore, and stored-data verification. |
| Client host and settings | The completed R170/R171 host owns reconciliation and session cleanup. Existing SDK commands and settings expose region selection and progress. |
| Deployment | Existing private `tenantDeployment/` and deployment scripts own regional eligibility and identity-preserving resource configuration. |
| Acceptance | Public product E2Es own Wallet behavior. Private E2Es own Console composition and the directory. Keep one owner for each assertion. |

The coordinator consumes typed service operations. Stores and signing flows never
import the coordinator or branch on transfer phases. Public contracts remain
independent of private Console implementation. Add adjacent files only when they
own behavior. Create no new package, registry, workflow engine, or test harness.

Integrate cutover only after real source fences and destination verification work.
Use the existing candidate/package integration workflow. Work on `dev` in the main
checkouts. When work is concurrent, agree file ownership and serialize shared
entrypoint, generated-binding, and dependency-pin edits. Commit only owned changes.

## Behavioral acceptance matrix

Use existing product E2Es and type fixtures. Add no unit tests or source-text
guards. Extend existing signing, device-linking, replay, and regional fixtures.
Each row below assigns distinct coverage to an existing or extended scenario.

### Coverage ownership

- Keep directory races, cooldown timing, retry budgets, stale attempts, and
  recovery transitions in the existing private directory E2E. Extend it for
  activation before cleanup. Product E2Es check that real admission and participant
  commands obey these decisions, without repeating every journal permutation.
- Use one two-device WEUR → APAC move and a return move for assembled acceptance.
  Exercise both signing curves. Cover fresh passkey and Email OTP authentication
  where supported, without repeating every fault under both factors or every
  regional direction. Add variants only for different execution paths, storage
  paths, or deployment configurations.
- Inject faults at distinct durability boundaries: local fences, chunk commits,
  import-gate closure, directory switch, activation, and cleanup. Exercise each
  independently implemented writer fence. Reuse coverage only where implementations
  share the same transaction/effect gate. Avoid a region × factor × role × fault
  matrix and crashes after every statement or record.
- Reuse R152 and R170/R171 evidence for unchanged behavior. Run their affected
  contracts when R153 changes a shared path. Do not repeat ownership audits or
  synthetic copy probes as additional relocation gates.
- Type fixtures check compile-time branch constraints. Behavioral tests check
  authenticated identity, parser rejection, persisted effects, and restart.
  They do not duplicate source-text or implementation-shape assertions.

### Required scenarios

| Scenario / owner | Distinct behavior to verify |
| --- | --- |
| Owner admission and progress access / product E2E | Reject unauthenticated, partial-owner, expired/revoked, wrong-scope, stale-generation, and unsupported-destination requests before transfer. Preparation failure leaves placement, sessions, and cooldown unchanged. Exercise competing owner requests, same-home no-op, and exact replay after a lost admission reply and proof expiry/catalog change. During the pause, reload and reconnect with bounded move-only access. Reject signing, wrong move/origin, revoked authority, and expired access. Local lock clears the credential. Progress shows blocked recovery and never starts work or resets budgets. |
| Two-device move and fresh signing / product E2E | Verify both curves before and after transfer. Keep one device offline through activation, then authenticate it again without enrollment replacement. Preserve addresses, permissions, revocations, and durable material. Reject old primary/hosted credentials, exchanges, linked deliveries, refresh, and sealed-session restore. Reconcile resident/durable caches across tabs and reloads. Include an exhausted old allowance and a lost signing response. Retrieve the original result with one effect/quota use, and issue fresh sessions under unchanged wallet/tenant limits. |
| Frozen transfer and exact restore / production-store E2E | Delay refill through freeze, restart source roles, and run overdue alarms. No delayed material enters the frozen snapshot. Transfer binary values, NULL, full-width integers, consumed exchanges, expired/retired parents, exhausted quotas, and operation history. Exercise D1, DO SQL/KV, and mixed partitions. Lose chunk acknowledgements and replay after crashes before/after commit. Preserve exact digests, audit/quota state, and unrelated-wallet guards. Reject altered or mismatched chunks, missing/extra selected records, and wrong encryption context through production readers. Clear scoped restore permission atomically. |
| Handover and recovery / composed E2E | Restart at the distinct boundaries above and reconcile concurrent coordinators using the same commands. An unresolved external effect keeps freeze incomplete. Direct calls, jobs, callbacks, and alarms cannot reopen the source. Lose directory-switch and activation replies, then fail cleanup. Fresh authentication and signing work after durable activation while another move stays blocked. Late known chunks return stored acknowledgements without overwriting new data. Unknown chunks fail. After a blocked attempt, repaired execution resumes the same manifest, resources, and committed chunks. |
| Shared authority and return move / composed E2E | Change shared revocation/tenant-root authority during transfer and keep an unrelated wallet active. Activation/use must obey current authority. After cleanup and cooldown, return using a fresh generation and physical resources. Restore an old source snapshot in isolation and prove it cannot write, including when the directory is unavailable. |
| Regional suitability / hosted E2E | Verify actual destination resource/configuration identities and placement independently from ingress location. Compare before/after signing from the same client location. Record pause duration, first-signature refill delay, subsequent signing latency, transfer bytes, and unrelated-wallet interference. Use existing telemetry for regeneration compute and transfer load. Do not create a separate benchmark framework or repeat the local fault matrix on every region. |

One assertion may satisfy several requirements. Reuse its result instead of adding
another scenario. Narrow store/role scenarios use production paths and retain
repeatable evidence. They do not substitute for the assembled two-device move.

Each focused scenario writes one artifact using the existing test output format.
Record the command, relevant build revisions, resource identities, and the
assertions that scenario owns. Include generations, digests, operation IDs,
signature results, quota outcomes, fault points, and timings only where relevant.
Reference existing receipts instead of copying them into multiple reports.
Exclude credentials, plaintext shares, role keys, and custody material.

Acceptance requires correct ownership and preserved state, plus verified regional
placement and measured latency. A few seconds remains a pause target, without an
unmeasured hard deadline. Five minutes remains the admission limit. Change these
values only when measurements justify it. Dedicated load tuning and exhaustive
regional benchmarking are follow-up work if the hosted run exposes a problem.
