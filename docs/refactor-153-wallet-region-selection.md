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
  be online. Full-owner authority is the proposed eligibility boundary; exact
  permissions and fresh authentication requirements remain to be defined.
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
- Who may change placement, how that action is authenticated, and which supported
  regions and custody configurations are eligible.
- What interruption is acceptable and how concurrent requests, conflicting moves,
  failed moves, and retries should appear to the owner.
- Validate pool invalidation without key or activation retirement, delayed refill
  completion, offline cache reconciliation, and regeneration cost. Confirm the
  cooldown and its treatment of failed attempts before implementation.

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

Use a **proposed five-minute minimum between wallet relocation admissions** to
limit repeated regeneration. Enforce it server-side across all owner devices and
both manual and automatic requests, alongside one move in progress per wallet.
Keep this limit with the authoritative placement state so a move cannot reset it.
Selecting the current home is a no-op for transfer; retrying the same move resumes
its recorded outcome without scheduling another regeneration. Failed attempts
that incur work also need bounded retries; counting only successful moves would
leave a way to bypass the cost limit. Exact failure/backoff semantics and the
adequacy of five minutes remain validation questions. Refill should use bounded
normal demand rather than eagerly warming every offline device.

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

R152 is an explicit dependency. Its directory foundation exists, but its active
plan still leaves hosted per-wallet routing and shared-authority integration
open. Before integrating an executable move:

- [ ] Freeze R152's [wallet/shared ownership inventory](refactor-152-per-wallet-inventory.md),
  including indirect children, opaque credential locators, one-use objects,
  deferred work, and tenant-root references. Shared identity bindings should
  continue resolving to the same wallet through the updated directory.
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

## Implementation stages

### 0. Settle the contracts before parallel implementation

- [ ] Confirm the eligible full-owner authority, authentication freshness, and
  supported account/jurisdiction/custody configurations. Only an established
  wallet may move; registration retries keep their original allocation.
- [ ] Define request, progress, and recoverable failure contracts using precise
  domain states. Require tenant/wallet identity, move identity, source and
  destination resources, and ownership generations where each phase needs them.
  Parse external data once; use branch-specific builders and exhaustive handling.
- [ ] Separate authorized move-control commands from ordinary wallet execution.
  Inactive destinations may import/verify the admitted move and must reject
  signing and other ordinary mutations. Keep placement metadata separate from
  original operation IDs/request digests so rerouting preserves exact retries.
- [ ] Define the authority sequence: source active → both homes unable to admit
  new writes after source quiescence → destination active at a new generation.
  Name the required per-writer fence and verification receipts. A source comparing
  a request to its own cached generation is insufficient.
- [ ] Choose how the authority fence survives deletion, restart, old deployment
  execution, and snapshot restore. Separate ownership generation from activation,
  signing-root, revocation, and operation-lease epochs.
- [ ] Settle pre-cutover cancellation and post-cutover recovery. Keep incomplete
  destinations inactive; never reuse a retired authority generation. Once the
  destination is authoritative, returning to the source requires a new handover.
- [ ] Adopt five minutes between relocation admissions as the initial proposed
  limit, including admitted moves that later fail. Define bounded
  stage retries, same-move replay, conflicts, and authoritative retry timing.
- [ ] Prove the chosen historical import path against current lifecycle/claim
  triggers before committing to it. The authorization probe's temporary trigger
  removal is a local experiment; production restoration must preserve guards for
  unrelated wallets and avoid quota/audit side effects.
- [ ] Record the agreed contracts here and add targeted type fixtures for illegal
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
| Conflicting owner requests and cost guard | Race two devices/destinations, issue duplicate/same-home requests, cross the proposed five-minute boundary, and retry failed stages. One active move, no duplicate regeneration/charges, and authoritative retry timing. R154 must later exercise this same admission guard. |
| Hosted regional suitability | Verify destination resource/version identities and placement evidence independently from ingress colo. Measure pause, cold refill, warm signing, compute/load, and failure recovery; retain samples and failures. |

Each run produces a repeatable artifact with both repository/build revisions,
resource identities, move/generation transitions, hashes/counts, operation IDs,
signature verification, quota/replay outcomes, fault points, and relevant timings.
Exclude tokens, plaintext shares, role keys, and custody material. The existing
[storage and authorization probes](refactor-153-backend-relocation-validation.md#evidence-and-limits)
remain useful lower-level evidence; the full relocation gates remain unchecked.
