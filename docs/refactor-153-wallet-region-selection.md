# Refactor 153: owner-controlled wallet region selection

Status: implementation started, October 3, 2026. The private directory control
plane is implemented. Backend state transfer, writer fencing, owner API, client
reconciliation, settings, and hosted placement remain unfinished.

[Initial backend relocation validation](refactor-153-backend-relocation-validation.md)
records the Cloudflare capabilities, current storage hazards, local probe
results, and remaining hosted checks.

## October 3 implementation checkpoint

Private implementation: `72ce0f6` on `seams-monorepo/dev`.

Private Console migration `0070_wallet_relocations.sql` and
`walletPlacement/relocation{,Store}.ts` add:

- A required ownership generation, durable relocation journal, and one pending
  move per wallet. Wallet and founding-registration identities remain immutable.
- Atomic admission with the wallet directory paused in the same D1 transaction.
  Home, credential, and lifecycle lookups reject paused placement; home-owned
  shared locator publications and linked-device claims also respect the pause.
- Canonical request replay, destination/request conflicts, stale-generation
  rejection, and a five-minute interval between admissions. Selecting an active
  current home performs no transfer and incurs no cooldown. An unfinished move
  stays paused and resumes through its existing journal; cancellation is pending.
- Conditional progress through freezing, copying, verified, cutover, and completed.
  Source-fence and destination-verification receipts are required before cutover.
  Cutover updates home and generation atomically; an exact retry reads the original
  committed outcome after a lost reply. Receipts and completed history are immutable.
- Boundary parsers and type fixtures for request/receipt identity, illegal phase
  combinations, required generations, and broad-spread forgery.

This is a **trusted control-plane storage primitive**. It is not exposed as an
owner or operator HTTP move endpoint. The directory cannot establish that a role
has stopped writing from a digest alone: real role receipt producers, quiescence,
transfer/import, and destination activation must be wired before enabling moves.
Owner authentication, current permissions, expiry/revocation, and fresh-auth policy
remain API integration work. Linked owner devices have distinct authority IDs;
the founding-registration authority is preserved metadata, not the relocation
eligibility rule. The journal records the actual initiating authority.

The new composed directory E2E uses two Workers and persistent local D1. It exercises
competing requests, lost admission/cutover replies, process restart, receipt replay,
cooldown boundaries, a later return move at a fresh generation, and isolation from
an unrelated wallet. Existing registration/regional-directory acceptance remains
green. Its participant receipts are synthetic; it makes no backend transfer,
authorization, signing, or single-writer fencing claim. Repeatable evidence is in
the private `.artifacts/r153/directory-implementation/` checkpoint.
Two E2Es passed in 6.7 seconds; candidate-backed TypeScript, focused lint, and
public bloat checks passed. Directory receipt SHA-256:
`f13201c216ecfadf69336c8d6f07142642a1b29e879cf3dfa0cce7bdfc7c7e36`.

Repeat the relocation-directory scenario from the private repository:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/wallet-relocation-directory.e2e.test.ts --reporter=line
```

R152's [state ownership baseline](refactor-152-state-ownership.md) now identifies
specific unresolved prerequisites: selectors for ordinary operation history and
opaque records, complete DO/Container ownership, internal/deferred write fencing,
and composed linked-device installation. These prevent enabling a general transfer
and cutover today. Continue independent implementation against this journal; close
those ownership and execution contracts before connecting an executable move.

## October 4 readiness review

This is the earlier readiness checkpoint. The revision-12 ownership handoff below
supersedes its open selector and material-accounting findings.

Reviewed public revision `e10c1eaa` and private revision `561b0b9`. R152 now provides
enough verified local composition to resume R153 implementation. Its final
ownership audit and hosted acceptance remain open. Executable relocation remains
unwired until the transfer and fencing contracts below are verified.

| Dependency | Current evidence and consequence |
| --- | --- |
| Runtime identity home enforcement | Implemented in private `09626d8`. Console partitions mixed-wallet reads by home; direct Runtime reads verify authoritative placement. The former local-read bypass is closed. |
| Real linked-device installation | The all-home local matrix verifies production registration, cryptographic installation, NEAR/Tempo signing, home-only durable records and transient cleanup. Lost activation/acknowledgement replies and full Gateway/Console/role Worker restarts also pass. The earlier synthetic-source-only limitation is superseded for these scenarios. |
| Composed regional lifecycle acceptance | Mixed-home wallets in one namespace, passkey and Email OTP founding registration, recovery, unlock, exports, concurrent signing, replay and process restarts have retained local receipts. Independent geographic role placement, transaction crashes and hosted acceptance remain open. |
| Yao capability replacement receipt ownership | Closed by public `b764f7b6`. Receipts require scoped `wallet_id`, retries check the same wallet, and cross-wallet capability replacement fails before mutation. Terminal receipts remain directly selectable after lifecycle cleanup. |
| Remaining transfer selectors and complete material ownership | Still open. Ordinary-operation and opaque-record selectors remain blocked, and DO/Container material accounting remains incomplete. R152 owns these ownership contracts and the fixed-home context for deferred work; R153 consumes them for extraction/import. |
| Relocation writer fencing | Still open. Deferred continuation routing establishes its fixed home; it does not fence a queued Deriver execution or NEAR side-effect commit after ownership changes. R153 must connect generations and source quiescence to every relevant effect boundary. |

The [latest R152 lifecycle/restart evidence](refactor-152-results.md#october-4-recovery-and-linked-device-replay-after-local-role-worker-restarts)
uses one shared local role stack. Verified receipt hashes include mixed-home
passkey recovery `8eb28b58458ea8d9c33082fb2d2cdf03c7b1a964d28d32a844f78d555ddce528`
and APAC linked installation
`ee4b1129ea4dbf680964b15e8625bc2b72ac8656018b601f40fb998b42047f81`.
The [Email OTP founding-registration/recovery checkpoint](refactor-152-results.md#october-4-email-otp-founded-wallets-retain-regional-ownership-through-recovery)
adds receipt `4221cccdd7c8a5770915f607f5585c61d8662740da7b81c802024392cb77faf5`.
These files were present and their hashes matched during this review; no scenarios
were rerun for the documentation update.

Resume with exact extraction/import ownership and generation fencing against the
committed relocation journal. Keep owner-triggered transfer and cutover unwired
until those contracts and real relocation acceptance pass. Full R152 performance
and hosted-release work can proceed separately from this implementation.

The capability receipt follow-up was reviewed at `b764f7b6`. Migration 0045 adds
required wallet ownership and the exact
`(namespace, org_id, project_id, env_id, wallet_id)` selector without ownership
reconstruction or a compatibility reader. Populated unowned receipt tables block
the migration until the planned disposable-wallet reset. The retained
`.artifacts/r152/wallet-owned-receipts-20261004/evidence.json` records 45 applied
signer migrations, exact two-wallet selection, empty-owner rejection, a blocked
unowned-table upgrade without receipt loss, and SQLite integrity `ok`. This closes
the capability receipt selector only; remaining ownership selectors and material
accounting stay with R152, while relocation generations and effect fences stay
with R153. This review did not rerun type checking or the migration verification.

## October 4 ownership handoff: revision 12

Public `9c1c7b8e` and private `7720793` close the ownership dependency through
[R152 ownership revision 12](refactor-152-state-ownership.md). R153 can implement
extraction/import and role fencing against this contract. The earlier open signer
selectors and DO/Container material accounting are closed.

The contract covers pending and terminal role-private records, pools,
reservations, presign indexes and replay claims. Linked signing ownership resolves
through the actual Wallet Session and device-link authority. Migration 0048 removes
14 obsolete operation/audit columns and names the retained scope `owner_scope_*`.
Transfer must preserve exact operation/result identities and reject ambiguous
records using the contract's scoped selectors and validated parent joins.

The retained evidence records all 48 signer migrations with integrity `ok` and
three-region linked installation/restart acceptance. Each wallet retained two
linked signing operations only at home; correct-owner reads succeeded and
foreign-wallet reads failed. This review checked all three regional receipt hashes
against the committed results; it did not rerun the scenarios.

Credential reconciliation, complete deferred fixed-home execution verification,
hosted acceptance and R152's final review/release remain open. They are separate
from the closed ownership dependency and must remain visible during integration.
R153 owns generations, source quiescence, effect fences, historical import,
presignature invalidation, cutover and relocation acceptance. Implement these now
against revision 12; enable an executable move only after the relevant execution
contracts and real relocation acceptance pass.

## October 4 execution journal checkpoint

Private commit `c0a57c6` implements persisted phase execution against the move
contract. Migration 0071 adds CAS attempt claims, six-attempt retry budgets,
1/2/4/8/16-second backoff, immediate blocking on identity/receipt/content conflicts,
and recorded recovery runs. `ready` distinguishes an unclaimed stage from a
running attempt. Restart, polling and duplicate commands cannot reset its budget.
Current-attempt identity is required to advance each phase; a running attempt
remains available for reconciliation after restart without a timer takeover.

Source and destination receipts now bind a common manifest digest. Completion
requires destination activation and source cleanup receipts with matching scope,
generation and manifest and ordered timestamps. SQL rejects timestamp-only
completion. Exact admission replay is resolved before new catalog validation.
The migration requires an empty relocation journal under the planned test-wallet
reset; no missing execution history or receipt is reconstructed.

The directory E2E now covers competing/lost attempt claims, phase transitions,
six transient failures with a mid-budget restart, early retry refusal, exhausted
budget, stale attempts, explicit recovery, immediate conflict blocking, mismatched
cleanup evidence, and lost completion reply followed by restart/replay. Both
directory E2Es passed in 7.9 seconds. Candidate-backed TypeScript (including type
fixtures), focused ESLint and diff checks passed. Private receipts are retained in
`.artifacts/r153/execution-journal-20261004/`; relocation receipt SHA-256 is
`02184ddd17816901bf2413115c35ca33a43bd90a269fedaeffb7f6990d8af555`.
Repeat the earlier directory command with output `test-results/r153-execution`.

This remains an internal journal implementation. Receipt parsers establish shape
and binding consistency; real issuer authentication and durable role evidence
remain unwired. Owner approval, authenticated status during pause, pinned role
resources, the recovery coordinator, writer fences, import and cleanup producers
are still required. No user relocation endpoint is enabled.

## R152 completion handoff — published 0.8.0 baseline

R152's final handoff is public `c160e107` and private `8a40b44`. Consume
[ownership revision 13](refactor-152-state-ownership.md), including fixed-home
deferred execution and credential reconciliation, as the current contract.
Earlier open R152 acceptance statements in this plan are historical checkpoints;
the R152 dependency is now closed. Relocation generations, fences, transfers and
their acceptance remain R153 work.

The private checkout consumes exact published Wallet SDK/server 0.8.0. Both
directory E2Es passed in 6.6 seconds with the installed package, without candidate
or TypeScript path overrides; the standard Console package type check passed.
Repeat from the private repository:

```sh
pnpm --dir packages/wallet-console-server-ts type-check
pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/wallet-relocation-directory.e2e.test.ts \
  relayer/wallet-home-directory.e2e.test.ts \
  --reporter=line --output=test-results/r153-published
```

The retained R152 hosted proxy measurements describe backend travel; native
full-browser latency and calls outside home Gateway `SIGNER_DB` are outside those
measurements. This handoff check did not deploy infrastructure or enable relocation.
Continue with owner approval and authenticated placement/status access, then real
participant evidence, source fencing and data transfer against the published
baseline. The existing journal remains an internal storage primitive.

## Intent

Add a Wallet region setting so an owner who expects to spend time in another
region can explicitly choose a supported home for their wallet. Build on
[R152's per-wallet homes](refactor-152-regional-D1.md), extending the fixed-home
rule through a controlled relocation operation.

The setting applies to the whole wallet and all of the owner's devices. Show the
current home separately from a requested move and its progress. A selected region
remains the wallet's preference until the owner changes it.

This phase establishes the relocation operation that
[R154's automatic placement policy](refactor-154-automatic-wallet-relocation.md)
will later invoke.

## Working assumptions and boundaries

- One wallet has one owner using multiple devices. An eligible owner device can
  initiate a move for the wallet; other devices should not need to approve it or
  be online. Require active full-owner authority and a fresh operation-bound
  factor proof, as specified in the move contract below.
- Existing wallets will be deleted before rollout. Exclude existing-wallet
  migration, backfills, legacy formats, and compatibility paths. Relocation must
  still preserve wallets created after that reset.
- Preserve wallet keys and addresses, device permissions and revocations, quotas,
  and operation identities/results across a move. Offline devices should resume
  through the new home when they reconnect.
- At most one home may authorize wallet writes, including during crashes, stale
  routing, and retries. One-use signing material must remain single-use.
- Existing presignatures may be invalidated and regenerated after relocation.
  Preserve durable signing material and identities, consumed-material history,
  and operation results. Uninterrupted access to a ready presignature pool is
  not required.
- Shared tenant policy, identity uniqueness, and shared custody authorities retain
  their ownership boundaries. Determine which wallet-owned resources move.
- Automatic movement detection and placement decisions belong to R154.

## Implementation decisions and validation still open

- What relocation Cloudflare Durable Objects actually support, whether new
  destination objects are required, and how placement can be measured.
- Which D1, Router, Deriver, and SigningWorker state must follow the wallet, and
  whether the resulting topology materially improves end-to-end latency.
- Verify the binding-preserving transfer described below with actual signing,
  sealed-session restoration, and an offline device reconnecting after cutover.
- Validate the move contract's owner-proof and regional eligibility enforcement
  through the actual admission path.
- Measure interruption under the paused protocol; the contract promises durable
  progress and recovery, without a fixed completion-time guarantee.
- Validate pool invalidation without key or activation retirement, delayed refill
  completion, offline cache reconciliation, and regeneration cost. Confirm the
  effectiveness of the five-minute admission limit under real regeneration load.

## Binding validation: paused server-side transfer

Question: can a paused, role-preserving server-side transfer keep every wallet
and device identity intact?

**The current binding contracts permit this, provided the destination remains
the same logical custody and authorization deployment.** Geography, D1 database
ID, and Cloudflare physical DO ID are absent from the material bindings examined.
The production authorization service accepted existing credentials against copied
records in an independent local D1 database. Complete signing and browser
continuity after a move still need an assembled E2E demonstration.

Adopt these constraints for the relocation design:

- Preserve wallet IDs, keys/addresses, authority and device IDs, factors,
  credential digests, session IDs, permissions, quota, and replay history.
- Preserve material activation references, activation epochs, signing-root
  metadata, revocation epochs, logical role/server IDs, signer-set identity, and
  the logical object names authenticated by stored ciphertext. A new placement
  generation is separate metadata; moving home does not rotate those identities.
- Preserve each role's encryption keys and versions, recipient/peer identity,
  and authenticated environment labels. Preserve the Gateway's server-seal
  secret and required key versions for Email OTP and sealed-session continuity.
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
device should retain its durable signing material and credentials, subject to
their existing expiry and revocation rules, discard invalidated presignatures,
and resume through the stable endpoint.

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

## Presignature invalidation and relocation frequency

The owner accepts discarding existing presignatures and regenerating them after
a move. This lets the paused transfer resume with empty usable pools. Account
for in-flight operations first; preserve claimed/consumed identities, terminal
failures, replay records, quotas, and completed results. A lost signing response
must still return its original result on an exact retry.

Fence both signing and presignature admission at the source. A delayed refill
must not publish old material after invalidation or into the destination.
Reject stale cached presignatures at the server even if an offline device has
not yet learned about the move. On reconnect, each device reconciles placement,
discards obsolete cache entries, and obtains fresh paired material through the
normal client/server protocol. The transfer does not wait for every device to
refill; measure the extra latency of the first subsequent signature.

Current pool retirement only accepts key/activation retirement reasons, and
client pool generations are local memory. Add an explicit pool invalidation
boundary tied to authoritative placement without rotating wallet keys, material
activation references, or device identities. Preserve one-use tombstones so
deleting pool secrets cannot make the same presignature identity admissible again.
See the [follow-up source validation](refactor-153-backend-relocation-validation.md#presignature-invalidation-and-compute-limits).

Use a **five-minute minimum between wallet relocation admissions** to
limit repeated regeneration. Enforce it server-side across all owner devices and
both manual and automatic requests, alongside one move in progress per wallet.
Keep this limit with the authoritative placement state so a move cannot reset it.
Selecting the current home is a no-op for transfer; retrying the same move resumes
its recorded outcome without scheduling another regeneration. Failed attempts
that incur work also need bounded retries; counting only successful moves would
leave a way to bypass the cost limit. Failure/backoff semantics are specified
below; the adequacy of five minutes remains a measurement question. Refill should
use bounded normal demand rather than eagerly warming every offline device.

## Implementation strategy and entry gate

Implement a **paused, role-preserving transfer** first: prepare inactive regional
resources, pause wallet mutations, settle in-flight work, invalidate usable
presignatures, copy and verify wallet state, then switch ownership and resume.
Measure pause duration before adding online pre-copy or delta replication.
Keep wallet key derivation, custody ceremonies, and device enrollment intact.

The investigation found no fundamental identity-binding blocker under the
preservation contract above. Most work is in routing, writer fencing, exact
historical-state restoration, and device cache reconciliation. This assessment
depends on the assembled signing/fault tests; successful row copying alone does
not establish safe relocation.

R152 supplies implemented home routing, verified local composition and the closed
revision-12 ownership contract. Execution coverage remains an integration
dependency. Before integrating an executable move:

- [x] Freeze R152's [wallet/shared ownership inventory](refactor-152-state-ownership.md),
  with revision 12 closing signer selectors and DO/Container/role-private material
  accounting. The original inventory counted 56 signer and 84 shared Console
  tables; apply subsequent schema changes through signer migration 0048.
  Shared identity bindings should continue resolving to the same wallet through
  the updated directory.
- [ ] Establish R152's trusted wallet-home execution context across Gateway,
  Wallet Runtime, role RPCs, and background work, plus the admitted regional
  resource catalog. Extend these contracts for relocation.
- [ ] Coordinate ownership of any files still being changed for R152. Inventory,
  scenario design, and isolated transfer experiments can proceed alongside it;
  implementation agents must consume the same agreed contracts.

Use existing directory/services, wallet stores, role boundaries, and request
routing. Keep one relocation operation for R153 and R154. Existing-wallet
backfills, compatibility modes, arbitrary destination URLs/resources, independently
keyed custody deployments, and live MPC-session transfer stay outside this scope.

## Move contract — step 1

These are implementation decisions for the first manual relocation operation.
The existing directory journal implements a subset; the gaps at the end of this
section are implementation work, not additional product decisions. The ownership
input is R152 revision 12. No endpoint is enabled by this contract update.
R154 must define standing-consent authorization before automatic policy can invoke
this same orchestration; the manual contract does not grant that permission.

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
- The source transaction and Console admission are separate commits. Before
  Console admission, there is no relocation pause or transfer. A lost admission
  reply is resolved by reading the journal; an unused expired approval authorizes
  no new admission. Proof consumption alone never claims a completed admission.
- Admit only established wallets in the same logical tenant/custody deployment.
  Resolve US, WEUR or APAC through the server's admitted regional catalog. Clients
  supply no D1 IDs, URLs, role identities or key material. Before admission, verify
  destination resources, schema/import support, role identities, required key
  versions and server-seal continuity. Pin the checked resource/configuration
  identities to the move; subsequent configuration changes cannot retarget it.
  Unsupported custody/jurisdiction configurations return an eligibility failure.

### Request, status and admission results

Use the stable Gateway origin and existing wallet authentication boundary:

| Operation | Contract |
| --- | --- |
| Read placement: `GET /wallet/placement/v1?walletId=…` | Authenticated wallet access returns active home and generation, or the pending move's safe progress. Resolve deployment scope from the authenticated boundary. |
| Admit: `POST /wallet/placement/v1/relocations` | Body requires `walletId`, `moveId`, `destinationRegion`, `expectedGeneration` and `sourceProof`. Verify the factor proof for a new admission; an exact replay does not consume it again. Resolve the initiating authority from authentication and the destination resources from the catalog. Reuse the journal's `wmove_` identity and canonical request digest. |
| Read move: `GET /wallet/placement/v1/relocations/{moveId}?walletId=…` | Any currently authorized full-owner device of that wallet may read progress. The initiating authority in the journal remains immutable. A move ID is never a bearer credential. |

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

After ordinary request authentication, look up an existing move before fresh-proof,
cooldown or current-catalog admission checks. An exact retry returns its recorded
progress/result even after cutover, proof expiry or catalog changes; it does not
re-consume the factor proof. Reusing its ID with a different canonical request
returns `request_conflict`. Another owner device uses the status operation to
observe/recover the admitted move; it does not rewrite the initiating authority.
Status and authenticated admission replay remain reachable while ordinary wallet
mutations are paused. These reads must not issue credentials or mutate copied
authorization/counter state; use the shared request-proof authority where needed.

### Cooldown, concurrency and cancellation

- Admission atomically journals the move and pauses new wallet mutations. Console
  is authoritative for time, current generation, one pending move and the cooldown.
  Require at least 300,000 ms since the previous admitted move, across all devices
  and future automatic requests. A move still pending blocks another regardless
  of elapsed time. An admission that later encounters failure still counts.
- Reject preflight/auth failures before admission without charging this cooldown.
  Use the existing authentication/rate limits for rejected requests. The original
  admitted time survives retries, restarts and cleanup.
- Selecting the active home at the current generation is `unchanged`: no pause,
  journal admission, cooldown extension, transfer or refill. This is a placement
  read/no-op; it does not reserve a move ID. If placement subsequently changes, a
  retry with that stale generation is rejected. During a pending move, selecting
  its source is a conflicting request, not cancellation.
- The owner can cancel the settings interaction before submitting the admission
  request. Once submitted, closing the UI or aborting HTTP does not cancel server
  execution; resolve the journal outcome. Once admitted, the first
  implementation has **no cancellation or rollback operation**, including before
  cutover. Resolve a lost response before claiming cancellation succeeded. Repair
  and resume the same move after failure. This preserves the journal's linear
  protocol and avoids reactivating a partly retired source generation.
- Before cutover, an unrecoverable destination outage can therefore leave the
  wallet paused until repaired. Surface that state explicitly. A future safe-abort
  feature would require its own fenced source reactivation at a fresh generation;
  do not improvise it with an active flag, timeout or journal deletion.

### Phases and required evidence

Let the active source generation be `g`. Reserve `g + 1` for the destination at
admission; reject generation exhaustion. Registration, authority, activation,
root-share and signing-root epochs remain unchanged.

| Phase | Writable home and required transition evidence |
| --- | --- |
| `freezing` | New wallet mutations are paused. Previously admitted source work may finish only under tracked source authority. Destination ordinary execution is disabled. Obtain durable quiescence/fence evidence from every participant before advancing. |
| `copying` | Neither home admits ordinary writes. Required source receipt proves `g` cannot produce later effects. Invalidate usable presignatures; preserve claimed/consumed records and exact results. Import the frozen state into inactive destination resources, with idempotent exact-record comparison. |
| `verified` | Both homes remain closed to ordinary writes. Required destination receipt binds the exact frozen source manifest, restored records and logical identities to destination resources at `g + 1`; all participant checks passed. |
| `cutover` | One Console transaction CASes the expected paused source, move and receipts to destination `g + 1`. Only the destination may activate, after reading that committed decision. Source `g` stays retired. Post-cutover activation, refill and source cleanup are resumable. |
| `completed` | Destination activation and source cleanup have durable receipts. Source wallet secrets/state are removed; retirement fences and immutable move/replay evidence remain. Completion never changes home or generation again. |

Use the existing seven participant slots: Gateway, Wallet Runtime, Router,
Deriver A, Deriver B, SigningWorker and presign sessions. Each slot aggregates
every applicable D1/DO/role-private resource from revision 12. An empty participant
must attest its checked empty inventory. Every receipt binds wallet scope, move
ID, resource identities, generation, phase, protocol version and manifest digest.
The coordinator verifies authenticated issuers and durable underlying evidence;
seven caller-supplied hashes alone do not authorize cutover. Persist exact receipts
so a retry after completion returns the same proof rather than a new timestamp.

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

All stage commands are idempotent by move, participant, stage and exact input
digest. A changed input is a conflict. A crash before recording a response is
resolved through the participant's durable result and the journal. Cutover response
loss always triggers an authoritative read: if committed, continue destination
activation/cleanup; if still verified, retry the same CAS. If authority cannot be
read, neither recovery code nor a timer may reactivate the source. Cleanup failure
leaves the destination active in `cutover` and blocks a subsequent move until
completion. Generation and cooldown history survive all cleanup.

### Required extensions to the existing implementation

Private `walletPlacement/relocation.ts`, `relocationStore.ts` and migration 0070
already supply the canonical request, five phases, generation CAS, admission
cooldown and two receipt envelopes. Extend those same modules during implementation:

1. Add fresh-owner approval and server destination preflight; a parsed request's
   `authorityId` currently proves no authorization. Pin the complete resource set.
2. Serve authenticated status/replay during the pause, and move exact replay ahead
   of new-admission catalog validation. Keep no-op and conflict behavior distinct.
3. Produce real source/destination manifests and authenticate participant evidence.
   The journal now requires manifest-bound activation/cleanup receipt envelopes
   before `complete`; production evidence producers remain to be connected.
   Synthetic directory-test receipts remain directory-only evidence.
4. Connect the persisted execution status/retry budgets to the coordinator and
   enforce every effect fence. Keep recovery commands internal; do not add a public
   cancellation endpoint.
5. Extend the existing type fixtures and E2E as each contract is implemented:
   reject forged approval, mismatched receipt kind/generation, mixed phase fields,
   broad state spreads and unsafe construction; exercise exact retries after proof
   expiry, two-device conflict, paused status and crash recovery. Historical import
   and real transfer acceptance remain subsequent implementation work.

## Implementation stages

### 0. Settle the contracts before parallel implementation

- [x] Define eligible full-owner authority, authentication freshness and compatible
  custody constraints. Actual regional configuration verification remains part of
  admission implementation. Only an established wallet may move; registration
  retries keep their original allocation.
- [x] Define request, progress, and recoverable failure contracts using precise
  domain states. Require tenant/wallet identity, move identity, source and
  destination resources, and ownership generations where each phase needs them.
  Parse external data once; use branch-specific builders and exhaustive handling.
- [x] Specify separate authorized move-control commands and ordinary wallet execution.
  Inactive destinations may import/verify the admitted move and must reject
  signing and other ordinary mutations. Keep placement metadata separate from
  original operation IDs/request digests so rerouting preserves exact retries.
- [x] Define the authority sequence: source active → both homes unable to admit
  new writes after source quiescence → destination active at a new generation.
  Name the required per-writer fence and verification receipts. A source comparing
  a request to its own cached generation is insufficient.
- [x] Choose how the authority fence survives deletion, restart, old deployment
  execution, and snapshot restore. Separate ownership generation from activation,
  signing-root, revocation, and operation-lease epochs.
- [x] Settle pre-cutover cancellation and post-cutover recovery. Keep incomplete
  destinations inactive; never reuse a retired authority generation. Once the
  destination is authoritative, returning to the source requires a new handover.
- [x] Adopt five minutes between relocation admissions as the initial
  limit, including admitted moves that later fail. Define bounded
  stage retries, same-move replay, conflicts, and authoritative retry timing.
- [ ] Prove the chosen historical import path against current lifecycle/claim
  triggers before committing to it. The authorization probe's temporary trigger
  removal is a local experiment; production restoration must preserve guards for
  unrelated wallets and avoid quota/audit side effects.
- [x] Record the move contract here, distinguishing decisions from runtime support.
- [ ] Extend targeted type fixtures alongside implementation for illegal
  phase combinations, forged execution contexts, broad spreads, and unsafe casts.

### 1. Directory authority, move admission, and regional execution

- [x] Extend the existing Console wallet directory with persistent ownership
  generation, one active move, progress/recovery state, and wallet-wide cooldown.
  Preserve immutable wallet and founding-registration identities. Replace the
  blanket immutable-home rule with changes permitted only by a verified move.
- [ ] Admit moves through the authenticated owner path and configured region
  catalog. Persist the move before transfer effects. Bind retries to the same
  canonical request; changed destinations/requests conflict. Selecting the
  current home performs no transfer or presignature regeneration.
- [ ] Carry the admitted home/generation through the existing regional service
  graph. Require authority at every mutation boundary, including direct/internal
  requests, recovery, linking, revocation, quota changes, refills, jobs, and alarms.
  Read authoritative state after a lost ownership-switch response.
- [ ] Persist conditional progress transitions and recover unfinished stages after
  process restart. Avoid a separate relocation framework or duplicate routing path.

### 2. Destination preparation, source quiescence, and pool invalidation

- [ ] Select verified regional D1 resources and fresh physical per-role DO
  identities. Apply intended location hints on first creation. Keep logical
  ciphertext identities and role configuration stable; verify required keys and
  versions without exposing them to a central mover.
- [ ] Prepare destinations inactive. Stop new source admissions, drain already
  admitted effects, and reconcile unfinished claims. If an effect's outcome or
  source quiescence is uncertain, retain the pause and reconcile before switching.
- [ ] Fence Router, Deriver A/B, SigningWorker, and presign session/deferred paths.
  Keep role-local material with its existing role. Include shared tenant-root
  admission/retirement references in the cutover contract.
- [ ] Add explicit presignature invalidation independent of key/activation
  retirement. Burn usable secrets while preserving claimed/consumed identities,
  tombstones, request bindings, and terminal results. Account for both wallet SQL
  pools and linked-device presign-session KV/one-use records.
- [ ] Reject delayed source rounds and pool admissions. An in-flight refill whose
  identity was never stored must not repopulate a pool after invalidation.

### 3. Exact state transfer and destination verification

- [ ] Extract the wallet-owned subset from the frozen R152 inventory. Preserve
  indirect records, dependency order, exact bytes, integer precision, nulls,
  expiry times, revisions, revocations, quota, and completed/replayed outcomes.
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
  confirming that authoritative outcome; every obsolete generation stays fenced.
- [ ] Resume through stable public endpoints. Completed retries retain original
  operation IDs and results; expired or revoked credentials retain their normal
  semantics. Relocation alone does not issue replacement device identities.
- [ ] Reconcile authoritative placement before using durable or resident client
  presignatures. Cancel stale refill work, discard obsolete caches across tabs
  and reloads, and refill through the normal client/server protocol on demand.
  Offline devices resume independently, without holding the move open.
- [ ] Add Wallet region to the existing settings surface. Show actual home,
  selected region, pending progress, temporary mutation pause, recoverable failure,
  and cooldown retry time. Expose supported regions and eligible owner controls;
  Automatic mode remains R154's follow-up.
- [ ] Delete obsolete source wallet state after verification while retaining the
  authority fence and move outcome needed for cleanup/retry. Failed cleanup is
  resumable and cannot reopen the source. A later move back uses fresh resources.

### 5. Integration, measured suitability, and completion

- [ ] Pass the E2E matrix below, including real ECDSA/Ed25519 signing and both
  passkey and Email OTP sealed-session continuity where supported.
- [ ] Validate actual hosted resources/placement and measure pause duration,
  first-signature refill delay, subsequent signing latency, transfer bytes,
  regeneration compute, and interference with an unrelated wallet.
- [ ] Update intended-behavior specification and matching contracts together.
  Freeze the public package candidate and pin private consumers to its exact
  artifact through the existing integration workflow.
- [ ] Remove superseded fixed-home mutation restrictions, direct writer paths,
  cache assumptions, fixtures, and exports as their replacements land. Preserve
  ordinary identity immutability and registration replay guarantees.
- [ ] Run relevant type checks, Rust/wire verification when affected, behavioral
  acceptance, and the required bloat check. Retain exact-revision evidence.
  Deployments and publication follow the existing separate release process.

## Parallel work ownership and dependencies

Paths below are repository-relative: `private` is `seams-monorepo`, `public` is
`seams-wallet`. Confirm final seams after R152 integration; use existing modules
and add adjacent files only when needed. This is a proposed implementation team,
with one coordinator and five bounded workstreams.

| Workstream / owner | Owned surfaces | Dependency / handoff |
| --- | --- | --- |
| Coordinator: contracts, directory, orchestration, integration | Private `walletPlacement/{home,d1,service,serviceClient}.ts` under `packages/wallet-console-server-ts/src/`, Console directory schema changes, and Gateway/Wallet Runtime wiring. Public placement wire/domain contracts and `router/transport/fetch/createFetchRouter.ts` integration. Placement type fixtures and this plan. | Settle stage 0 and implement authoritative admission/CAS. Own shared entrypoints and connect the other streams; serialize authority-switch integration. |
| Custody backend: routing, fences, invalidation | Public `crates/router-ab-cloudflare/src/durable_object/{router_wallet,deriver_a_pair,deriver_b_pair,signing_worker_wallet,ecdsa_presign_live_session}.rs`, corresponding role stores/routing, `ecdsa_pool_lifecycle.rs`, `ecdsa_presign_session.rs`, and `crates/router-ab-ecdsa-pool/src/lib.rs`. This owner also integrates changes in Cloudflare `src/lib.rs` and regenerates affected Rust wire bindings. | After contracts, implement role-local freeze/transfer/verification commands and explicit pool invalidation. Hand verified source/destination receipts to the coordinator. |
| D1 transfer: extraction and historical restore | Public `packages/wallet-server/src/router/cloudflare/d1/` transfer/store changes and required signer schema changes. | Use the R152 ownership inventory and agreed move context. Prove idempotent restore with trigger/quota/replay behavior, then expose the store operations for orchestration. |
| Client and settings: placement reconciliation | Public `packages/wallet/src/core/` placement-facing SDK/signing/IndexedDB changes and `react/components/AccountMenuButton/` settings. | After API contract, implement progress/cooldown UI and cross-device cache reconciliation. Coordinate against custody invalidation semantics; integration needs the real backend. |
| Deployment: regional eligibility and identity preservation | Private `tenantDeployment/` catalog/binding configuration, `scripts/deploy-backend.mjs`, and `deployment/wallet-system/scripts/generate-{github-env-values,deployment-keys}.mjs`. | Preserve logical role identities, environment labels, KEKs/versions, peers, and server-seal configuration across eligible regions. Hand verified resource/configuration evidence to the coordinator; use disposable hosted probes when scheduled. |
| Verification: behavioral acceptance and evidence | Public `tests/e2e/`, focused E2E fixtures, and `docs/intended-behaviours.md`; private composed E2Es under `tests/`. | Draft scenarios after stage 0, run incremental acceptance as streams land, then own the assembled fault/offline/hosted matrix and repeatable receipts. Do not count the synthetic transfer probes as a full move. |

Contract decisions precede parallel implementation. The coordinator can build
directory/admission support while custody, D1 transfer, client/settings,
deployment preparation, and scenario development run concurrently against those
contracts. Ownership-switch integration waits for authoritative admission and
verified source fences/copies. Completion depends on the full E2E and hosted
evidence. Keep those integration steps on the coordinator's path.

All agents work on `dev` in the main checkouts unless the user explicitly asks
otherwise. They are sharing the codebase: preserve other agents' edits, agree
file ownership before editing, and commit only owned changes with explicit paths.
Do not concurrently edit common entrypoints, package exports, generated bindings,
or dependency pins. Hand those edits to their designated owner. Record the public
and private revisions/artifacts used for each integration run.

## Behavioral acceptance matrix

Use medium-to-hard product E2Es and targeted type fixtures; add no unit tests or
source-text guards. Extend existing signing, device-linking, replay, and regional
fixtures wherever they express these scenarios.

| Scenario | Required evidence |
| --- | --- |
| Owner authorization and destination admission | Reject unauthenticated, insufficient-permission, expired/revoked, wrong-tenant/wallet, stale-generation, and unsupported-resource requests before transfer effects. An unavailable directory or unverified destination fails closed without a fallback write. |
| Paused WEUR → APAC move with two owner devices | Real signatures for both curves before/after; unchanged addresses, wallet/device/material identities, credentials, quota, and completed results. Keep device two offline through cutover, then reconnect, invalidate its cached pool, refill, and sign. |
| In-flight work and stale preparation | Lose a finalize response after its effect; retry after relocation returns the original result with one quota use/effect. Interrupt presigning, delay a terminal refill/admission until after cutover, and restore an old client cache after reload; obsolete material never becomes usable. |
| D1 historical restore and isolation | Restore consumed exchanges and terminal/claimed history according to the reconciliation contract; interrupt/repeat import. Preserve audit/quota exactly, enforce expired/revoked credentials and origin/scope checks, and keep another wallet's ordinary guards active. |
| Crash at every handover boundary | Crash during each role fence, extraction/import, destination verification, around directory CAS with a lost reply, and during cleanup. Restart both sides and send old direct requests/jobs/alarms. Prove at most one writer and one effect/material consumption. |
| Shared authority changes and repeated moves | Retire/refresh tenant-root state or revoke authority during a move, keep another wallet active, move back to the old region using fresh resources, and attempt isolated restoration of a pre-move snapshot. Shared policy/limits stay authoritative and old state cannot resume writes. |
| Conflicting owner requests and cost guard | Race two devices/destinations, issue duplicate/same-home requests, cross the five-minute boundary, and retry failed stages. One active move, no duplicate regeneration/charges, and authoritative retry timing. R154 must later exercise this same admission guard. |
| Hosted regional suitability | Verify destination resource/version identities and placement evidence independently from ingress colo. Measure pause, cold refill, warm signing, compute/load, and failure recovery; retain samples and failures. |

Each run produces a repeatable artifact with both repository/build revisions,
resource identities, move/generation transitions, hashes/counts, operation IDs,
signature verification, quota/replay outcomes, fault points, and relevant timings.
Exclude tokens, plaintext shares, role keys, and custody material. The existing
[storage and authorization probes](refactor-153-backend-relocation-validation.md#evidence-and-limits)
remain useful lower-level evidence; the full relocation gates remain unchecked.
