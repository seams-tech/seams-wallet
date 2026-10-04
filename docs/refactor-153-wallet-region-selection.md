# Refactor 153: owner-controlled wallet region selection

Status: implementation started, October 3, 2026. The private directory control
plane is implemented. Backend state transfer, writer fencing, owner API, client
reconciliation, settings, and hosted placement remain unfinished.

Architecture decision, October 5, 2026: retain one active wallet home and use
[R154](refactor-154-region-change-notifications.md) to suggest owner-confirmed moves.
Owners mainly use one region and occasionally travel. The priority is local
permission and signing calls after relocation. Verify actual placement and shared
dependencies before claiming a signing path without cross-region calls.

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

## Implementation decisions and validation still open

- What relocation Cloudflare Durable Objects actually support, whether new
  destination objects are required, and how placement can be measured.
- Which D1, Router, Deriver, and SigningWorker state must follow the wallet, and
  whether the resulting topology materially improves end-to-end latency.
- Verify the binding-preserving transfer with actual signing after fresh
  authentication, rejection of saved old sessions, and an offline device reconnect.
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

R153 is a relocation module composed on top of the R152 wallet runtime. Use
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

Implement a **paused, role-preserving transfer** first: prepare inactive regional
resources, pause wallet mutations, settle in-flight work, invalidate usable
sessions and presignatures, copy and verify durable wallet state and history,
then switch ownership. Fresh authentication and refill happen after activation.
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

Cutover changes the directory's home atomically. Its `active` placement value
does not by itself establish that destination roles are ready. Each participant
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

The current `WalletRelocationProgress` type and migration 0071 permit activation
and cleanup receipts only at `completed`. Extend that existing journal to persist
activation during `cutover`. Model its activation state as required discriminated
branches: awaiting activation or activated with its required receipt. Preserve
the existing five phases and stage retry budget. Do not add an independent
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

### Required extensions to the existing implementation

Private `walletPlacement/relocation.ts`, `relocationStore.ts` and migration 0070
already supply the canonical request, five phases, generation CAS, admission
cooldown and receipt envelopes. Extend those same modules during implementation:

1. Add fresh-owner approval and server destination preflight; a parsed request's
   `authorityId` currently proves no authorization. Pin the complete resource set.
2. Serve authenticated status/replay during the pause. Preserve the implemented
   exact-replay ordering before new-admission catalog validation. Keep no-op and
   conflict behavior distinct. Add the bounded move-only read authorization to
   the existing approval and keep it separate from active signing authority.
3. Produce real source/destination manifests and authenticate participant evidence.
   The journal now requires manifest-bound activation/cleanup receipt envelopes
   before `complete`; production evidence producers remain to be connected.
   Synthetic directory-test receipts remain directory-only evidence.
4. Connect the persisted execution status/retry budgets to the coordinator and
   enforce every effect fence. Keep recovery commands internal; do not add a public
   cancellation endpoint. Retire all sessions and invalidate pools before sealing
   the snapshot. Prove fresh-session issuance for retained device enrollments.
5. Persist activation independently from cleanup in `cutover`. Update domain
   branches, journal guards, readiness responses, and readers together. Migrate
   only at the persistence boundary under the supported disposable-wallet reset.
6. Extend the existing type fixtures and E2E as each contract is implemented:
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
- [ ] Prove the scoped historical restore context against current lifecycle/claim
  triggers. Preserve guards for unrelated wallets and avoid quota/audit side
  effects. The authorization probe's temporary trigger removal remains test-only.
- [x] Record the move contract here, distinguishing decisions from runtime support.
- [ ] Extend targeted type fixtures alongside implementation for illegal
  phase combinations, forged execution contexts, broad spreads, and unsafe casts.
  Include activation without a receipt, cleanup before activation, and chunk
  commands with mismatched wallet, resource, generation, or manifest identities.
  Reject move-only read access wherever an active signing session is required.

### 1. Directory authority, move admission, and regional execution

- [x] Extend the existing Console wallet directory with persistent ownership
  generation, one active move, progress/recovery state, and wallet-wide cooldown.
  Preserve immutable wallet and founding-registration identities. Replace the
  blanket immutable-home rule with changes permitted only by a verified move.
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

### 2. Destination preparation, source quiescence, and session/pool retirement

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
  again before ordinary refill. Offline devices resume independently.
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
| Coordinator: contracts, directory, orchestration, integration | Private `walletPlacement/relocation*.ts` and adjacent coordinator code; narrow integration in `{home,d1,service,serviceClient}.ts`, Console directory schema and Gateway/Wallet Runtime composition. Public placement wire/domain contracts and `router/transport/fetch/createFetchRouter.ts` integration. Placement type fixtures and this plan. | Keep orchestration inside the relocation module, consume typed participant adapters and implement authoritative admission/CAS. Own shared entrypoints and serialize authority-switch integration. |
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
| Paused WEUR → APAC move with two owner devices | Real signatures for both curves before/after. Preserve addresses, wallet/device/material identities, permissions, historical accounting, and completed results. Reject every old signing credential, exchange, and sealed-session restore. Keep device two offline through cutover, then authenticate it again without re-enrollment, obtain a new session, refill, and sign. Exercise passkey and Email OTP entrypoints where supported. |
| In-flight work and stale preparation | Lose a finalize response after its effect. After relocation and fresh authentication, retrieve the original result under its original identity with one quota use/effect. Interrupt presigning, delay refill/admission and linked credential delivery until after cutover, and restore an old client cache after reload. No old grant or material becomes usable. |
| D1 historical restore and isolation | Restore consumed exchanges, expired parents, exhausted quotas, and reconciled operation history through the scoped import context. Crash before and after a chunk commit, lose its acknowledgement, and replay it. Preserve audit/quota exactly and leave no restore context enabled. Keep a second wallet active in the same database and enforce its ordinary triggers throughout. |
| Frozen snapshot and destination proof | Delay a refill through freeze, then restart source roles and run overdue alarms. Seal the snapshot only after all signing sessions are retired and all usable presignatures are invalidated. Snapshot digests must remain stable. Transfer binary values, NULL, and maximum supported integers. Reject altered chunks, omitted collections, wrong encryption context, and extra selected records before cutover. Verify ciphertext through production role readers. |
| Late import and independent activation | Lose activation acknowledgement, restart the coordinator, and fail source cleanup. Preserve the committed activation receipt. Allow fresh authentication and destination signing while cleanup retries. Replay an old chunk after those new writes: return its stored acknowledgement without overwriting live state. An unknown chunk remains rejected. |
| Crash at every handover boundary | Crash during each role fence, extraction/import, destination verification, around directory CAS with a lost reply, and during cleanup. Restart both sides and send old direct requests/jobs/alarms. Prove at most one writer and one effect/material consumption. |
| Blocking progress and network recovery | Confirm a move, lose the admission reply, and attempt actions from two devices. Interrupt transfer and status connectivity, reload the browser, and resume the same journal. The initiator's bounded move-only access survives signing-session retirement and permits only that move's status/exact replay. Reject wrong move, origin, expired credentials, and all signing/mutation attempts with this access. Lock clears the credential normally. After activation, authenticate again and sign while cleanup retries; another move remains blocked. |
| Fresh-session accounting and same-home no-op | Exhaust an old session's allowance, relocate, and obtain a new session under normal issuance rules. Preserve old claims/results and wallet/tenant limits. No old exchange, quota, or credential is revived. Selecting the current home causes no session retirement, pool invalidation, or new allowance. |
| Concurrent coordinators and blocked recovery | Run two coordinators against one running attempt and duplicate participant commands. Restart during import, exhaust retries, and invoke authenticated recovery after repair. Preserve command identities, manifest, committed chunks, and allowance history. Reject stale advancement and resource retargeting. Polling cannot reset the budget. |
| Shared authority changes and repeated moves | Retire/refresh tenant-root state or revoke authority during a move, keep another wallet active, move back to the old region using fresh resources, and attempt isolated restoration of a pre-move snapshot. Shared policy/limits stay authoritative and old state cannot resume writes. |
| Conflicting owner requests and cost guard | Race two devices/destinations, issue duplicate/same-home requests, cross the five-minute boundary, and retry failed stages. One active move, no duplicate regeneration/charges, and authoritative retry timing. R154 must later exercise this same admission guard. |
| Hosted regional suitability | Verify destination resource/version identities and placement evidence independently from ingress colo. Measure pause, cold refill, warm signing, compute/load, and failure recovery; retain samples and failures. |

Each run produces a repeatable artifact with both repository/build revisions,
resource identities, move/generation transitions, hashes/counts, operation IDs,
signature verification, quota/replay outcomes, fault points, and relevant timings.
Exclude tokens, plaintext shares, role keys, and custody material. The existing
[storage and authorization probes](refactor-153-backend-relocation-validation.md#evidence-and-limits)
remain useful lower-level evidence; the full relocation gates remain unchecked.
