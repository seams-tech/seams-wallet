# Refactor 150: automatic wallet placement and regional custody

Date created: September 23, 2026
Date revised: September 24, 2026

Status: revised implementation plan. Managed Cloudflare hosting targets
role-separated, SQLite-backed Durable Objects for wallet-local authoritative
state. Shared wallet logic must also run through a conventional VM host adapter.
Regional lanes remain an alternative deployment design. Geographic relocation is
deferred. This document does not claim that the revised architecture
is implemented, verified, or deployed.

The filename is retained for existing links. This revision supersedes the original
mandatory Home region setting, three managed D1 lanes, and migration-first rollout.
Existing lane implementation work must be reconciled with this plan before further
integration; its presence does not make it a requirement of the DO architecture.

## Decision and objective

Place wallet-local state and its mutation logic near the user at registration,
without asking the user to manage infrastructure regions. Keep that placement
stable afterward. Preserve custody isolation, public keys, and signing safety.

The architecture separates these concerns:

| Concern | Decision |
| --- | --- |
| Managed Cloudflare hosting | Role-separated SQLite-backed DOs, subject to a real signing-path verification gate |
| Conventional VM hosting, including AWS and Google Cloud | The same wallet logic through ordinary server processes and role-private SQL storage |
| Deployments with independent regional databases | Regional lanes as a reference design with automatic initial assignment |
| Moving a wallet between independent authorities | Retain safe-cutover requirements; defer geographic relocation and its product policy |

This is a storage and execution ownership change. Wallet-local state selected for
the DO path moves out of D1, and its mutations execute beside the DO's storage.
Placing a DO proxy in front of the same remote D1 calls does not accomplish this
objective. D1 can remain for shared configuration, reporting, and other state
whose ownership and latency requirements justify it.

The expected benefits are automatic per-wallet routing, local transactional state
access, and fewer serial network calls. The size of the latency benefit and total
cost must be measured before the full conversion proceeds.

## Product behavior and scope

Initial managed release:

- Select placement automatically during registration, within organization policy.
- Use stable wallet and role identities for subsequent routing.
- Keep signing available from any supported client location through the existing
  authority; travel can increase network latency.
- Preserve registration, unlock, signing, recovery, factor, and export behavior
  for each configuration enabled in the release.
- Collect operational latency and cost measurements without building travel
  profiles or a user-movement detector.
- Provide runbooks for object failure, schema upgrades, recovery, and staged
  backend conversion.
- Keep shared wallet behavior independent of Cloudflare APIs and verify it through
  a concrete VM reference path as well as the managed Cloudflare adapter.
- Deliver a setup guide and reference configuration for each adapter, with thin
  role-scoped setup tooling, read-only deployment checks, and explicit smoke tests.

Excluded from initial scope:

- A Home region picker, settings page, move recommendations, or move cooldown.
- Automatic geographic relocation or an owner-initiated move API.
- A mandatory global wallet-to-region directory for the stable DO path.
- Three pre-provisioned managed regional D1 deployments.
- Active-active custody writers or transactions spanning separate role stores.
- Guaranteed placement in a named city or data center.
- A universal storage/provider framework or provider-specific AWS/GCP provisioning
  automation. The portable VM adapter and its setup path are in scope.

Organization residency requirements remain explicit deployment policy. Location
hints never establish residency compliance or authorize a wallet operation. If
the deployment cannot enforce a required policy, registration fails with a clear
unsupported-policy result rather than silently relaxing that policy.

### Remove user-facing region controls

Remove any existing registration region picker, Home region settings, latency-based
move recommendation, move button, migration progress screen, and cooldown message.
Audit both Wallet SDK surfaces and hosted Console composition. Delete supporting
controllers, public UI exports, probes, mocks, and tests used solely by these retired
surfaces. Do not retain hidden controls or feature flags for the previous design.

This product decision applies to both managed DO hosting and the regional-lane
reference design: initial placement is automatic in either topology. Organization
residency restrictions remain administrator/deployment policy, with clear errors
when enforcement is unavailable. Region and latency diagnostics remain internal
operational tools; they do not become user move recommendations.

Retain protocol or operational components that have independent supported uses.
Any future relocation UI requires a new explicit product decision based on a
demonstrated need; it is not a scheduled follow-up to this release.

## Cloudflare managed topology

The following describes logical ownership, rather than a requirement to create
four new classes. Reuse existing Router, signing-session, and store objects where
their coordination boundaries fit.

| Owner | Authoritative state to evaluate for local storage |
| --- | --- |
| Router coordination | Wallet operation lifecycle, command admission, idempotency and coordination records |
| Deriver A | A-private custody and protocol state, replay protection and role-local reservations |
| Deriver B | B-private custody and protocol state, replay protection and role-local reservations |
| SigningWorker | Its protocol material, presignature lifecycle and consumption records |

The edge Gateway authenticates and dispatches through trusted deployment
configuration. Each role addresses its wallet-local state through a stable object
identity scoped to tenant, wallet, and role as required by existing ownership.
One global object must not serialize all wallets. Existing session-specific
objects remain appropriate where a session is the actual coordination unit.

Deriver A and B retain separate deployable services, role-private namespaces and
stores, encryption keys, service credentials, and administrative boundaries.
Separate object names or namespaces under one shared privileged identity are
insufficient to establish the custody boundary. Deployment review must prove that
one role's operators and bindings cannot read the other role's secrets.
Neither the Gateway nor the coordinator receives the custody seed or both role
shares.

### Placement and routing

Cloudflare routes a stable object identity to its instance. Initial placement is
influenced by first access and supported location hints; objects currently do not
dynamically relocate to follow users. Hints are best effort, and separate role
objects need not land in the same data center. See
[DO data location](https://developers.cloudflare.com/durable-objects/reference/data-location/).

Registration must therefore:

1. Resolve trusted deployment and residency policy before choosing object identity.
2. Derive a coarse placement hint at the user-facing registration boundary when
   useful. Treat it solely as an optimization input.
3. Carry that hint through authenticated internal registration calls so an existing
   remote coordinator does not accidentally determine every role's first placement.
4. Initialize each role idempotently with the same wallet identity and accepted
   policy. Retries and competing registrations must resolve the same authority.
5. Persist sufficient trusted routing/policy metadata to resolve the same objects
   on later visits, independent of the client's current country or IP address.

Do not pre-create wallet objects from CI or a central provisioning job. New
session objects must follow the chosen wallet-local topology rather than create
an accidental cross-region signing chain.

Use supported jurisdiction controls when policy requires them; a latency hint is
insufficient. Namespace and jurisdiction selection are identity-bearing decisions.
A changed policy or hint must never silently create a second writable wallet.
The stable DO path needs no geographic directory. Trusted policy/identity metadata
and temporary backend-conversion routing remain necessary where applicable.

### Storage and execution boundary

Inventory every serial read/write in registration and signing. For each record,
identify its authoritative owner, durability requirement, transaction boundary,
and whether it is wallet-local, tenant-wide, shared, or derived.

- Move related wallet-local mutations into their owning role's DO storage.
- Keep shared identity indexes, tenant quotas, and other cross-wallet invariants
  with their actual authority. Do not duplicate a global constraint per wallet.
- Use asynchronous reporting projections only for data that may lag. Security
  admission must never depend on an eventually consistent reporting copy.
- Include Gateway authentication and shared-policy accesses in measurements;
  repeated remote writes there can dominate the remaining critical path.
- Retain a single source of truth for each record. Avoid DO/D1 dual-write ownership.

Each object has local transactional storage. There is no transaction spanning
Router, A, B, SigningWorker, or a blockchain submission. Persist claims before
external effects, use the current protocol's idempotency and replay identities,
and record explicit recovery state for interrupted operations. External awaits
allow other requests to run; single-threaded execution alone is insufficient.
Never hold an object-wide concurrency block across an MPC exchange or other
network I/O. See
[SQLite-backed storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

Eviction, restart, alarm retries, lost replies, and schema upgrades must preserve
one-use-material consumption and operation outcomes. Critical correctness state
must survive outside memory. A storage restore must not resurrect consumed
material; recovery procedures must fence affected authority and reconcile durable
outcomes before admitting signing again.

### Domain and wire boundaries

Reuse existing wallet, role, operation, capability, and generation types. Validate
raw inputs once at request and persistence boundaries. Core transitions use
precise discriminated states, branch-specific builders, exhaustive handling, and
Result-style recoverable failures.

Keep DO identities and provider routing metadata in deployment adapters. They
must not become mandatory public Wallet SDK region fields. Do not attach a
synthetic geographic lane epoch to every stable-object request solely to preserve
the original proposal. Existing security generations and operation fences remain
mandatory wherever they protect an actual invariant.

Typed internal routing must reject cross-wallet, cross-tenant, wrong-role, and
unauthorized backend targets. Raw client URLs, binding names, namespace selections,
and location fields never choose a custody authority.

## VM portability and host adapters

DO and D1 are Cloudflare hosting choices. The portable ownership model separates
wallet-local authoritative state from shared application state; it does not
require two database technologies or one database per wallet on other hosts.
DO storage is persistent authority, with no D1 write-through cache arrangement.
Wallet-local metadata such as replay counters and signing generations stays with
the material it protects. Each service receives only the storage and peer access
needed by its role; every service need not access both kinds of store.

| Responsibility | Cloudflare adapter | Conventional VM adapter |
| --- | --- | --- |
| Execute wallet role logic | DO handlers calling shared wallet logic | Ordinary server processes calling the same logic |
| Wallet-local persistence | Role-private DO SQLite storage | Role-private SQLite for a single-host-per-role reference deployment; PostgreSQL is a possible later multi-replica adapter |
| Shared configuration and indexes | D1 where appropriate | Conventional SQL storage with the same ownership boundaries |
| Peer communication | Authenticated service calls | Authenticated HTTP/RPC |
| Durable retries and scheduled work | DO alarms where used | Persisted jobs processed by a restart-safe worker |

Cloudflare environment bindings, object identities, storage APIs, and alarm APIs
stay in the host adapter. Shared protocol and lifecycle code depends on narrow
domain operations and existing host interfaces. Deployment wiring chooses the
adapter; the public SDK and core state machines do not branch on cloud provider.
The VM path must run without access to Cloudflare services or a DO emulator.

### Atomic domain operations

Reuse operations such as claiming a signing reservation, consuming a capability
once, and committing an operation result. Their contracts must state transaction
boundaries, version checks, retry outcomes, and durability requirements. A generic
get/set interface cannot by itself preserve these guarantees across concurrent
VM processes.

Use short storage transactions and conditional transitions to persist claims
before external effects. Retain durable operation identity and recovery state
across the subsequent MPC exchange. In-memory mutexes, process affinity, and DO
single-threaded scheduling cannot substitute for durable claims. Do not hold SQL
transactions open throughout peer calls. A lost reply or process crash must never
make consumed material available again.

The reference VM path should build on existing role-private SQLite support, with
explicit persistent-volume, transaction, restart, backup/restore, and contention
handling. SQLite serializes writers; deployments must respect its concurrency
model. A later PostgreSQL adapter can use conditional updates, transactions, and
row locks for multiple service replicas, with tested isolation and retry behavior.
See [SQLite isolation](https://www.sqlite.org/isolation.html) and
[PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html).
Neither adapter supplies a transaction spanning custody roles or chain submission.

Start from the existing [Rust host interfaces](../crates/router-ab-core/src/protocol/engine/host.rs),
[session claim contracts](../packages/wallet-server/src/core/ThresholdService/stores/SessionStore.ts),
and [role-private SQLite tests](../crates/router-ab-dev/tests/local_role_private_sqlite.rs).
These are reuse candidates and development evidence; they do not establish a
production-ready VM backend. Extract missing boundaries where platform code owns
domain transitions, and keep one implementation of those transitions. Do not add
a universal cloud framework, duplicate signing engine, or mandatory PostgreSQL
implementation.

### VM placement and custody isolation

A single-region VM deployment serves wallets from its configured region. It has
no automatic per-wallet geographic placement or relocation. Deploy compute near
its role-private database; if an operator later needs multiple regions, use the
regional-lane reference design or separately evaluate a distributed database.

Production A/B isolation must extend to hosts, administrators, service identities,
encryption keys, databases, and backups. Separate processes, containers, files,
schemas, or database users on infrastructure administered by one identity with
access to both roles do not establish independent custody boundaries. A same-VM
development fixture must not be represented as that production security topology.

### Shared contract verification

Run the same supported lifecycle, wire, and storage-behavior contracts through
both adapters. Include competing claims from independent connections/processes,
duplicate commands, stale versions, expiry, lost responses after commit,
crash/restart, durable-job retries, and wrong-role access. Assert equivalent domain
outcomes rather than matching provider-specific SQL or scheduling behavior.
Test each adapter's recovery from contention and verify that restored data cannot
revive one-use material. Document the supported VM topology and its recovery
limitations before declaring it production-ready.

## Reference setup paths and deployment tooling

Deliver two concrete hosting adapters and two reference setup paths: Cloudflare
and conventional VMs, including AWS or Google Cloud VMs. Both execute the shared
wallet logic and pass the shared contracts above. This is a target deliverable;
the current examples do not establish complete production support on either host.

Each setup guide and reference configuration must cover:

- Exact package/artifact versions and the supported wallet/protocol matrix.
- Gateway, Router, Deriver A/B, and SigningWorker topology, with role-scoped
  bindings or endpoints, service authentication, and storage ownership.
- Secret references and provisioning steps performed by each role's operator.
- Explicit schema initialization and upgrade commands that are safe to retry and
  refuse incompatible versions; no implicit migration during a readiness check.
- Persistent storage, durable scheduling, process/object restart behavior, backups,
  and recovery procedures that preserve replay and one-use-material safety.
- Health/readiness checks and an explicitly invoked registration/signing smoke
  test using a disposable test wallet and test network.

Reuse existing deployment scripts, configuration, and examples. The existing
[Cloudflare signing-worker example](../examples/self-host-cloudflare-worker/README.md)
covers a signing surface only. Keep that scope clear and document the additional
services needed for the complete wallet setup. Reuse the VM reference runtime
after its required hardening; a same-machine development fixture is not the
production custody topology. Avoid a second CLI, generic manifest generator, or
parallel setup workflow where existing tooling can express the required steps.

Add a read-only deployment check for missing configuration, inaccessible peers,
artifact/schema incompatibility, durable-job readiness, and observable storage or
role-binding mistakes. Report checks that cannot be established with the caller's
permissions as unverified. This check does not generate keys, migrate schemas,
create wallets, sign transactions, or repair deployment state. The explicit
smoke test is a separate mutating operation.

Setup and diagnostics remain role-scoped. No convenience installer or diagnostic
process may collect both A and B custody secrets or privileged credentials. Do not
print secrets in configuration output, logs, or error reports. Deployment checks
cannot certify administrative independence; document the operator review required
for host, account, key, storage, and backup isolation.

A single-region VM setup requires no wallet-region directory. Multi-region VM
hosting is an optional extension with an eligible-region catalog, automatic initial
assignment, and persistent wallet routing. Cloudflare DO placement stays in its
adapter. Extensive AWS/GCP infrastructure automation, PostgreSQL support, and a
universal cloud abstraction are deferred until a concrete deployment needs them.

## Cost and performance gate

Comparable cost to D1 is a hypothesis for users signing 10-20 transactions per
week. Frequency alone cannot establish it. SQLite row-operation rates are
comparable, while DO requests and active wall-clock duration add billing dimensions.
Network waits can contribute to duration; idle objects eligible for hibernation
avoid duration charges. Stored state still costs money. Consult current
[DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Before a full conversion, compare the current path and a representative DO-backed
path using the same protocol, payload, user locations, and network conditions:

- End-to-end registration and signing p50/p95, including cold and warm objects.
- Time by stage: Gateway, storage, role-to-role exchange, client round trips,
  cryptographic computation, and chain RPC.
- Request fan-out, active duration per role, rows read/written, stored bytes,
  retries, presignature refill, and periodic background work.
- Cost per completed signature and monthly cost for 10-20 transactions per user
  per week at explicit user counts, including dormant-wallet storage.
- All calling Worker costs, account-level included allocations, billing rounding,
  shared services, and failure/retry overhead.
- Concurrency, restart, response-loss, and one-use-material safety results.

Record latency targets and a monthly cost ceiling before the experiment. Proceed
only when results meet those targets and security review passes. If the gate
fails, retain the current backend and document the measured reason before choosing
a revised design. Do not silently resume the superseded region-settings rollout.

## Regional lanes: portable alternative

This section is a reference design for an operator choosing independent regional
stores, including AWS-hosted services with regional databases. It is not a second
mandatory implementation track for managed Cloudflare hosting.

A lane contains regional Router coordination, Deriver A, Deriver B, and
SigningWorker services and their role-private authoritative stores. A trusted
catalog maps internal lane identities to configured service targets. A wallet
directory assigns one authoritative lane and generation through insert-if-absent
registration and, if relocation is supported, a fenced compare-and-swap cutover.

The operator automatically chooses the initial eligible lane from deployment
policy and coarse location or measured latency. The SDK does not require a region
picker. Requests resolve trusted directory state; clients cannot select arbitrary
service endpoints. Cached routes never override a committed fence or newer
authority generation.

Regional deployments use the same reviewed artifacts and verify actual database
placement, service-to-store latency, role separation, schema parity, and capacity
before admitting wallets. A location label alone is insufficient evidence.

The database topology determines whether this design is needed:

- Independent regional databases benefit from explicit ownership and routing.
- Aurora Global Database still has a primary write region per global database;
  separate regional wallet authorities would require separate ownership groups.
  See [Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html).
- A distributed database may own more of the coordination. Aurora DSQL exposes
  two regional read/write endpoints for one logical database. Its supported
  geography, isolation semantics, and transaction behavior require workload review
  before treating it as sufficient for signing invariants. See
  [Aurora DSQL multi-region clusters](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/multi-region-aws-cli.html).

Use the portable VM adapter for AWS-hosted role services. Do not add AWS-specific
service adapters, generic multi-cloud manifests, or multi-region provisioning
solely to preserve this reference design. Add those extensions only when an
operator actually needs them.

## Deferred relocation: portable safety requirements

Stable placement is sufficient for the initial release. A travelling or relocated
user continues reaching the original authority. Neither movement telemetry nor
automatic relocation is an initial dependency.

If relocation becomes justified, treat it as an explicit transfer of custody
authority. For DOs this requires new target objects and authoritative routing
indirection; changing a hint does not move an existing object. For regional lanes
it changes the wallet directory assignment. Platform-managed instance restarts
within the same logical object are a different operation.

The following requirements preserve the useful part of the original R150 without
committing to its UI, APIs, or cooldown policy:

1. **Authorize.** Bind an operation-specific grant to wallet, source and target
   authorities, source and next generations, migration id, policy version, and
   expiry. A passkey-based owner move requires fresh user verification. Existing
   sessions and location signals cannot substitute for this authority. Automatic
   moves and OTP-only authorization require separate approval and security design.
2. **Freeze.** Durably fence every source role, reject new mutations, and drain or
   resolve admitted work. Record signed source evidence. Lease expiry cannot
   silently release the fence.
3. **Prepare.** Re-establish custody using the reviewed ceremony, verify the same
   key manifest and public addresses, and keep target writes disabled. A and B
   provision independently; the coordinator receives only protocol evidence.
   Opaque database/share copying is excluded unless a separately reviewed design
   explicitly authorizes it. Unsupported configurations cannot move.
4. **Cut over.** Verify all role receipts and compare-and-swap authoritative routing
   from the exact source generation to the target generation. This is the
   linearization point. Activate the target only after proof of committed cutover.
5. **Retire.** Keep source fencing permanent for the retired generation, rebind
   sessions, invalidate old operation capabilities, and regenerate one-use signing
   material. Preserve replay/command history so changing generations never allows
   the same authorized operation to execute twice. Apply role-specific source
   retention and deletion with auditable tombstones.

The journal records discriminated durable stages: authorized, source frozen,
target verified, cutover committed, and completed. Receipts are required by the
states that consume them. Recoverable failures retain the last durable stage.

Before cutover, recovery may retry or perform a serialized, audited abort that
proves cutover cannot race with source reactivation. After cutover, recovery
finishes target activation; it never silently re-enables the source. A lost CAS
reply is resolved by reading committed authority. A reverse move is a new
authorized operation. No stage may reconstruct secrets from receipts alone.

Relocation release gates include manifest preservation for every enabled protocol,
concurrent signing and migration races, lost replies at each stage, partial role
failure, stale sessions and commands, safe abort, target restart, and source
retirement. Ordinary latency observations cannot trigger a custody transition.

The separate
[self-hosted-wallet proposal](../examples/self-host-cloudflare-worker/refactor-150-cloudflare-self-hosted-wallets.md)
continues to own transfers to customer-operated infrastructure. This revision
does not expand its authorization or merge its product scope.

## Existing wallets and existing implementation work

New-wallet placement and converting an existing D1-backed wallet are separate
deliverables. Publishing a new adapter cannot silently create a second writer.

- Inventory current DO usage, D1 stores, lane types, directory migrations,
  authenticated lane requests, and worker entrypoints before adding replacements.
- Reuse established coordination and storage interfaces where they fit. A shared
  store object must not accidentally aggregate every wallet into one location or
  combine custody roles.
- Classify prior lane code as required by a supported deployment, reusable for an
  actual ownership transition, or superseded. Remove superseded paths, exports,
  settings helpers, and tests in the implementation change that replaces them.
- Inspect deployed schema/version usage before retiring any persistence artifact.
  The new design does not authorize deleting live records or blindly dropping
  previously applied migrations.
- Existing wallets remain on their proven authority until a separate conversion
  procedure establishes authorization, source fencing, target verification,
  replay continuity, and safe activation. Do not assume SQL export or dual writes
  is an acceptable custody transfer.
- A new-wallet cohort may precede existing-wallet conversion. Any temporary backend
  discriminator belongs at the trusted routing/persistence boundary, with one
  selected authority per wallet and an explicit removal milestone after conversion.
  There is no automatic fallback that creates fresh custody on a failed lookup.
- If conversion cannot preserve a wallet configuration's invariants, leave it on
  its current backend and report the blocker. A cohort rollout is not evidence
  that existing-wallet conversion is complete.

## Implementation sequence and verification

### Phase 0: ownership inventory and baseline

1. Map writable and registration-critical state across Gateway, Router, both
   Derivers, SigningWorker, current DOs, and D1.
2. Identify wallet-local transactions, shared constraints, custody boundaries,
   replay/command guards, and all serial network dependencies. Map reusable host
   interfaces and the VM reference adapter, including domain logic currently tied
   to Cloudflare handlers.
3. Audit the prior R150 implementation, including user-facing region surfaces and
   their dependencies, and record reuse/removal decisions. Inventory existing setup
   scripts and examples before defining the two reference setup paths.
4. Record supported wallet/protocol configurations, regional baseline latency,
   traffic assumptions, acceptance targets, and cost ceiling.

### Phase 1: representative DO path and decision gate

1. Implement a narrowly scoped registration and complete signing path with the
   necessary role-private state and mutations local to their owning objects.
2. Reuse existing cryptographic logic and protocol contracts; do not introduce a
   second signing implementation. Exercise that same path through the VM host
   adapter and role-private SQLite with no Cloudflare dependencies.
3. Verify registration retry identity, role isolation, concurrency, object restart,
   external-await interleaving, response loss, and durable one-use claims.
4. Run hosted cold/warm measurements from North America, Europe, and Asia Pacific
   and evaluate the cost/performance gate above.

### Phase 2: complete managed backend and new-wallet cohort

1. Complete the ownership changes for all enabled lifecycle operations and supported
   protocols, including NEAR and EVM signing.
2. Add automatic registration placement and stable trusted routing. Verify policy
   changes, VPN use, travel, and retries cannot create another authority. Remove
   user-facing region controls and their exclusively supporting code and tests.
3. Add boundary/type fixtures rejecting invalid lifecycle and authority combinations;
   use behavioral tests for single consumption and durable recovery.
4. Run lifecycle contracts, targeted store tests, relevant crypto/wire vectors, and
   deployed role-boundary acceptance tests. Update normative behavior and its
   contract tests together where behavior intentionally changes. Run shared
   behavioral contracts against both hosting adapters, including VM process
   concurrency and crash/restart; document the VM topology and operational limits.
5. Deliver both setup guides, reference configurations, role-scoped setup tooling,
   and read-only deployment checks. Exercise documented initialization, upgrade,
   restart, and explicit test-wallet smoke-test flows for each adapter. Test
   diagnostic failures and secret redaction; record operator isolation checks.
6. Release a small new-wallet cohort with latency/error/cost monitoring, schema
   upgrade and incident runbooks, and explicit supported configurations.

Stopping new registrations is a valid rollout rollback. Existing DO wallets retain
their committed authority; rollback never routes them to stale D1 state.

### Phase 3: existing-wallet conversion and cleanup

1. Specify and separately review the D1-to-DO conversion procedure and retention
   policy. Apply authority-transfer safety requirements even if the reason is
   a backend upgrade rather than geographic relocation.
2. Exercise failure injection and supported-protocol manifest verification before
   moving a production wallet.
3. Convert eligible cohorts, resolve unsupported configurations explicitly, and
   remove obsolete routing, stores, and temporary compatibility boundaries once
   their last dependent wallet has safely converted.

Regional-lane deployments and optional geographic relocation have independent
approval and acceptance gates. They are not later mandatory phases of this managed
Cloudflare rollout.

## Repository ownership and completion

The seams-wallet repository owns protocol/domain behavior, Cloudflare and VM host
adapters, reference setup paths and public tooling, SDK contracts, custody
verification, shared adapter/lifecycle/type/vector tests, and normative
specifications. The seams-monorepo repository owns managed deployment resources,
bindings, secrets and operator boundaries, Console policy composition, hosted
measurements, monitoring, and runbooks. Coordinate exact package releases and
deployment contract versions across repos.

The initial managed DO milestone is complete when:

- New wallets receive automatic policy-compliant placement and stable identities.
- Wallet-local state and mutations execute in their owning role stores, with no
  hidden dual writer or required global geographic directory.
- Every enabled lifecycle and signing protocol passes its current contracts.
- The same domain logic passes the supported contracts through a runnable VM
  reference adapter without Cloudflare dependencies; host-specific APIs remain
  confined to adapters, and supported VM topology/recovery limits are documented.
- Both reference setup paths are documented and exercised, with role-scoped
  tooling, read-only deployment checks, separately invoked test-wallet smoke tests,
  and an explicit operator review of production custody isolation.
- Role isolation, restart/retry safety, and one-use-material invariants pass review.
- Measured p50/p95 latency and modeled costs meet the recorded acceptance targets.
- Travel works through the existing authority without region settings or relocation.
- Registration and settings expose no region selection or move controls; retired
  region UI and its exclusive dependencies have been removed from SDK and hosted
  composition, without hidden or feature-flagged remnants.
- Existing-wallet status and conversion blockers are explicitly documented.

The backend replacement is complete only after existing-wallet conversion and
obsolete-path cleanup are also complete. Future relocation UI, movement telemetry,
provider-specific AWS/GCP deployment automation, a PostgreSQL adapter, and
regional-lane deployment are excluded from both completion claims. The portable
VM reference path and its shared correctness tests are required.
Both reference setup paths and their thin setup/diagnostic tooling are also required.
