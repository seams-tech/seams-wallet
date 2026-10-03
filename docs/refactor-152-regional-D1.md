# Refactor 152: regional D1 ownership and placement

## Authoritative replacement phase: per-wallet regional homes

**Decision, October 2, 2026:** each wallet receives its own home when registration
starts, selected server-side from trusted original ingress location. US, Europe
and Tokyo users in the **same tenant, project, environment and namespace** must
be able to register wallets in US, WEUR and APAC respectively. One user's location
must never choose another wallet's home. Travel, unlock, recovery, export, linking
and retries retain the wallet's original home.

This phase supersedes namespace-wide placement and all older completion claims
about production ownership below. Earlier placement measurements remain empirical
evidence for their recorded topology. Namespace-wide reservation/activation tests
prove that old design only; they do not count as per-wallet routing acceptance.
The old green `94b4c988` candidate is a checkpoint, **not the final 0.8.0 candidate**.
Release 0.8.0 only after this replacement's code and required verification pass.

Existing wallets are disposable test data. No migration of existing wallet state,
namespace fallback, dual routing mode, legacy flag or old-binding adoption path
will remain. A scoped reset/reprovision replaces those paths. Preserve unrelated
Console accounts, billing, credentials and custody configuration unless their
reset is explicitly included in the reviewed reset scope. This plan authorizes
no immediate data deletion or deployment.

### Measured performance baseline to preserve

The [consolidated empirical summary](refactor-152-results.md#consolidated-performance-summary-october-2)
records the observed regional-placement gains, sample sizes, tail latencies,
D1/SQL breakdowns and limitations. London steady owner signing improved from
2.4451 to 0.8501 seconds median; Tokyo from 2.96895 to 1.68995 seconds median,
with 180 verified ready-material signatures in each city. London's smaller
first-sign/burst diagnostic improved medians from 4.8396 to 1.1519 seconds and
7.8671 to 1.3336 seconds respectively.

These are baselines for the new per-wallet implementation. Keep the static
Console, published-server hosted Console and unreleased-candidate measurements
separate. R6 must measure the completed hosted route across wallet homes and
travel locations with frozen sources, explicit call budgets and retained failures.
The earlier measurements do not close that acceptance gate or justify release.

### October 3 checkpoint: shared external identities

- [x] Route hosted Gateway identity lookup, claim, list, unlink and cleanup through
  authenticated Console authority, retaining the existing D1 claim/move rules.
- [x] Verify competing regional claims, tenant isolation and outage behavior in
  repeatable three-region composition; keep regional identity stores unused.
- [ ] Forward discovery after provider proof verification to the discovered home.
- [ ] Share registration offers, passkey credential uniqueness and rate limits;
  finish linked-device coordination and internal/deferred enforcement.

This checkpoint is a prerequisite to discovery routing. It does not close the
replacement phase. Hosted acceptance and release 0.8.0 remain pending.

### R0. Inventory before implementation

The following source inventory was inspected on October 2. `private` means
`seams-monorepo`; `public` means `seams-wallet`. Paths are repository-relative.
This is the initial change inventory, not a claim that every call site or table
has already been classified. Complete the remaining inventory checkboxes before
changing the placement architecture.

| Area / current source | Required refactor | End state / deletion obligation |
| --- | --- | --- |
| Private `tenantDeployment/namespaceHome.ts`, `service.ts`, `d1.ts` (under `packages/wallet-console-server-ts/src/`) | Replace namespace-to-database reservation with a wallet home directory keyed by authenticated tenant scope and canonical wallet identity. | Delete `NamespaceD1HomeV1`, namespace assignment APIs and their single-home enforcement. Keep namespace only where it scopes identity/auth, never as the placement owner. |
| Private `packages/wallet-console-server-ts/migrations/d1-console/0047_namespace_d1_homes.sql` through `0050_tenant_deployment_home_verification.sql` | Inventory every trigger, index and activation-column dependency on namespace home. Separate deployment resource verification from wallet ownership. | Remove obsolete tables/triggers/columns from the final effective schema through the repository's schema-reset/migration procedure. No obsolete schema retained for compatibility. Preserve unrelated activation invariants. |
| Private `packages/wallet-console-shared-ts/src/tenant-deployment/index.ts`; server `tenantDeployment/{types,runtimeBinding,resourceVerification}.ts` | A deployment may serve many wallet homes. Binding hashes and writer admission must identify permitted regional resources/versions independently of each wallet's assignment. | Delete the singular deployment `home` contract and namespace-home hash/admission assumptions; rebuild canonical factories and type fixtures. |
| Private `tenantDeployment/{resourceChallenge,productionReadiness,runtimeInspection}.ts`; `scripts/{verify-tenant-d1-bindings,tenant-resource-challenge}.mjs` | Reuse provider UUID inspection, live database challenge and serving-version verification for each regional backend. | Proof means “this regional backend reaches this resource”, never “every wallet in the namespace lives here”. Resource challenge storage and endpoints now use resource terminology; regional-set activation remains open. |
| Private `tenantDeployment/{homeAdoption,provisioning,automationRoute}.ts`; `scripts/tenant-cutover.mjs` | Separate deploying/admitting a regional backend from assigning a new wallet. | Delete old-home adoption endpoints, request types, command modes and persistence decoders; retain unrelated authenticated deployment control. |
| Private `router/cloudflare/{d1GatewayWorker,d1WalletRuntimeWorker,d1ConsoleStagingWorker,d1LocalDevWorker}.ts` | Resolve wallet home through trusted authority, dispatch once to that region, and require the regional execution context before wallet-local reads/writes. Local mode uses the same contract with one configured resource. | No namespace-default database, no second combined hosted path, no acceptance of a browser-chosen database/region. Already removed combined entrypoints stay deleted. |
| Public `router/cloudflare/d1/registration/{d1WalletRegistrationService,d1WalletRegistrationSetup,d1RegistrationCeremonyRecords}.ts` under `packages/wallet-server/src/` | Allocate canonical wallet identity and home before regional ceremony effects. Both supplied and server-allocated IDs need atomic reservation and exact retry semantics. | A regional registration service cannot independently allocate an unreserved wallet or silently pick its local database. |
| Public `router/cloudflare/d1/emailOtp/d1GoogleEmailOtpSessionResolver.ts` | Its separate wallet-ID allocation and candidate-offer flow must use the same global allocation/identity authority. | No independently region-local identity uniqueness or offer allocation. Reserve the selected wallet once; retries preserve the offered/selected registration identity. |
| Public `router/domains/walletRegistration/{walletRegistrationRoutes,walletRegistrationSetupPayload}.ts`, shared registration contracts and SDK relayer clients | Bind registration operation, wallet, tenant and home in the verified setup context. Inventory current retry tokens before adding any wire field. | Remove old setup shapes when replaced; protocol version and intended-behavior specification change together if the wire changes. |
| Public signer D1 migrations and `router/cloudflare/d1/{authorization,passkeyCustody,deviceLinking,emailOtp,ed25519Yao,versionedJson}/` | Classify the effective schema's tables, keys, triggers, batches and every mutation by wallet-local or shared authority. | Wallet-local atomic batches stay on one home. No duplicate shared uniqueness/quota authority across regional databases. |
| Public identity, passkey, Email OTP, recovery-code locator, session exchange and delivery lookups | Inventory every entry route that lacks wallet ID, including opaque token/credential/locator resolution. | Resolve through an authoritative index or verified routing envelope before accessing wallet state; no broadcast search across regions. |
| Private `serviceBinding/walletConsoleOpsHandler.ts`, `router/routerApiKeyAuth.ts`, Console identity/policy services; public Console service clients | Reuse authenticated service bindings for shared identity admission, tenant policy, cross-wallet limits and home lookup. | Console projections/usage events remain projections, never the authority used to infer a missing home. No secrets copied into the directory. |
| Public `hosted-wallet-gateway.ts`, `router/cloudflare/runtime/{walletControlOps,routerAbPrewarm}.ts`, custody Router/role dispatch; private cron/control paths | Inventory all public, service-binding, scheduled and custody paths and distinguish wallet-scoped work from tenant-root bootstrap/control. | Wallet-scoped work requires the same home-bound context; non-wallet control has an explicit authenticated tenant scope, not a blanket bypass. |
| Private `deployment/{wallet-system,console}/targets.json`, `scripts/{deployment-targets,deploy-backend,deploy-surface,deployment-smoke}.mjs`, config parser/renderers and workflows | Provision US/WEUR/APAC backend resource sets and trusted service routes using existing deployment configuration. Separate network/environment from physical region. | Multiple homes can serve one project/environment. No hard-coded one-lane/one-database assumption, no per-user Worker deployment. |
| Private `tests/relayer/*home*.e2e.test.ts`, `namespace-home-provisioning.e2e.test.ts`, provider tests, `tests/fixtures/tenant-deployment/`, `tests/typecheck/namespace-d1-home.typecheck.ts`; public intended contracts and hosted probes | Rebuild fixtures and E2Es around multiple wallets in one tenant using different homes. Retain resource/version verification assertions that still apply. | Delete namespace-wide uniqueness/adoption fixtures and stale assertions. No unit tests added; use behavioral E2Es and domain type fixtures. |

Inventory completion checklist:

- [x] Locate namespace ownership, registration allocation, regional resource proof,
  deployment routing and existing acceptance-test entry points listed above.
- [ ] Enumerate every effective signer table/index/trigger after **all** migrations,
  including 0041; assign each an authoritative owner and record all cross-table
  transactions. Include dynamically constructed/versioned JSON records.
- [x] Inventory all registration paths and their current durable idempotency keys;
  specify the first durable allocation point and behavior after a lost response.
  The [registration operation inventory](refactor-152-per-wallet-inventory.md#registration-operation-ids-and-first-durable-write)
  covers direct, hosted-passkey, low-level and Google offer entry points.
- [ ] Inventory public/internal routes, cron/alarm/queue jobs and role RPCs: wallet
  identity available, identity verified where, home resolved where, store touched,
  and failure behavior. Explicitly cover routes with no wallet ID.
- [ ] Enumerate old symbols, imports, scripts, config keys, generated outputs,
  schema references and tests to remove. Record a replacement or deletion for
  each; do not equate a file rename with architectural replacement.
- [ ] Finish an invariant-to-authority matrix for identity uniqueness, email/IP
  limits, tenant policy, wallet quota, revocation, recovery and one-use material.
  Resolve every cross-database transaction dependency before implementing it.

### Implementation checkpoint: wallet directory foundation (October 2)

The [per-wallet implementation inventory](refactor-152-per-wallet-inventory.md)
now enumerates the effective 55-table / 64-index / 30-trigger signer schema and
records registration, lookup and transaction seams. It now also maps the main
hosted route families, nine direct Yao operations, internal Wallet Runtime and
Console service calls, scheduled control work, and surviving singular-home
symbols. The remaining R0 review items above stay open until each mixed table,
role RPC and cross-authority contract has a final owner and failure behavior.

- [x] Implement a Console D1 directory keyed by namespace, organization, project,
  environment and wallet ID, with per-tenant registration-operation uniqueness.
- [x] Preserve the first committed home through concurrent region proposals,
  lost replies and restart; reject conflicting wallet/registration ownership.
- [x] Enforce reserved → established/cancelled transitions and immutable identity
  in D1, with idempotent completion and rejection of late cancelled completion.
- [x] Verify the directory through a persistent-D1/two-Worker E2E and retain a
  hashed JSON receipt; verify invalid domain-state combinations with type fixtures.
- [x] Bind each reservation and completion to a required request digest and
  explicit provided/server-allocated identity branch. Concurrent generated
  candidates reuse the first committed wallet; changed requests conflict.
  Expanded persistent-D1 E2E and type fixtures pass (`8da3c38`, private).
- [x] Persist the first committed ceremony, preparation, founding authority,
  device and auth-method IDs with the wallet/home reservation. Regional retry
  candidates receive the same allocation after races or lost replies; SQL
  rejects later mutation. This is directory storage only, not hosted routing.
- [x] Add a configured three-region admission catalog and internal Console
  service-binding endpoint. Reservations choose the configured resource for a
  region and reject arbitrary D1 UUIDs; a retry retains the first home. The
  Gateway now consumes reservations at its matching physical D1 resource;
  regional forwarding and deployment catalog rendering remain open.
- [x] Correct the existing wallet-identity collapse in Runtime and Console:
  exact project/environment/wallet queries and replies; explicit Console
  environment-ID → runtime-key lookup; scoped projection/cache constraints,
  lookup and refresh requests, cursors and dashboard keys. Packed-candidate D1
  E2E and type fixtures verify collisions, cache isolation and migration 0053.
  Per-wallet regional fan-out is still part of the hosted integration below.
- [ ] Connect authenticated registration and shared-identity admission to this
  directory, then switch all hosted and lifecycle paths together with removal
  of namespace placement. Registration setup now uses the directory in the
  candidate Gateway; the complete regional dispatch remains open.
- [x] Persist a browser setup operation before sending the request; preserve it
  through lost replies, concurrent tabs and reload. Bind accepted responses to
  one wallet/ceremony and clear the journal at shared registration publication,
  including resumed commits. Protocol 2 requires the operation field.
- [x] Bind the setup operation to authenticated Console reservation admission.
  Use its winning wallet and five setup IDs; persist an immutable regional setup
  snapshot and reconcile retries without overwriting a progressed ceremony.
  Local E2Es cover lost replies, concurrent replay and replay after commit.
  Current ECDSA setup computes preparation facts locally; Router work begins later.
- [x] Add authenticated setup forwarding through fixed regional service bindings
  and a one-hop receiving entrypoint; dispatch the four registration continuation
  routes and explicit wallet-path lifecycle routes through the directory.
  Verify the transport with three local Workers and three separate signer D1s.
- [x] Confirm Console establishment after the durable registration receipt and
  before ceremony cleanup; reconcile lost completion replies. Persist definitive
  cancellation before deletion; reject cancelled continuation. Established setup
  replay never recreates a deleted mutable ceremony.
- [x] Replace the single-resource binding and activation store with a canonical
  resource set and one fresh proof per resource. Admit exact role/version/resource
  writers; atomically reject partial proofs, duplicate writers and reused challenges.
  Migration 0054 removes singular activation columns and requires fresh activation.
  Console refuses wallet reservations against an unverified regional catalog.
- [x] Replace singular deployment configuration with an explicit three-region
  resource map. Render the catalog, all Gateway/Runtime bindings and named receiving
  entrypoints; collect and activate with three proofs after stable complete-set
  provider checks. The local CLI/Worker/D1 E2E verifies all six writers and cleanup
  after a lost third-region response (October 3 regional deployment checkpoint).
- [ ] Supply verified US/WEUR allocations and bootstrap new regional service
  targets before hosted rollout. Canonical schema 5 records pending allocations
  explicitly; rendering/preflight/collection refuse incomplete resources. The
  ordinary deployment update order assumes service-binding targets already exist.
- [x] Route protected runtime resource challenges through the catalog to the exact
  regional Gateway/Runtime pair. Require a validated resource in every request;
  reject foreign namespaces, unlisted resources and cross-resource proofs. One
  Console verifies all three regions in the composed local Worker/D1 E2E.
- [x] Inspect readiness across the exact admitted resource set. Hosted Console uses
  US/WEUR/APAC Runtime clients, each bound to its expected physical resource;
  aggregate all wallet/ceremony counts and fail if any region cannot be inspected.
  Regional service-binding generation remains part of deployment orchestration.
- [x] Explicit protected activation renews admission for changed serving versions
  while preserving the managed browser credential. Reuse-only calls stay read-only;
  root/credential failures release unfinished cutovers, and a lost committed
  activation reply preserves the active key. See the October 3 renewal checkpoint.
- [x] Route opaque primary/hosted session credentials and exchange redemption
  through a scoped digest-to-wallet Console index. Publish direct and linked-device
  credentials through one authorization path; restrict publication to the wallet's
  admitted home writer. Local three-region Worker/D1 verification covers exchange
  races, method retirement, cross-wallet rejection and directory outages.
- [x] Dispatch direct Yao registration admission/execute by the directory's
  ceremony identity before opening regional state. Recheck the receiving home,
  reject session/ceremony wallet disagreement, and return explicit 503 on directory
  outage. Three-region local E2E covers both reserved and established ceremonies;
  protocol proof verification remains in the existing receiving handlers.
- [x] Publish scoped recovery-code digests before custody registration/rotation
  commits and recovery operation IDs before returning preparation. Route recovery
  preparation, five operation continuations and three administration routes to the
  directory home. Keep code validity/consumption and custody CAS at that home;
  reject foreign claims and fail closed on shared authority outages. Local E2E
  exercises actual custody registration/rotation stores with canonical fixtures.
- [x] Route direct Yao recovery bootstrap/admission/status and export admission
  by their explicit wallet identity, including cross-wallet session rejection.
  Three-home Worker/D1 composition passes; protocol execution is controlled.
- [x] Route direct Yao recovery execute/activate and export execute by immutable,
  scoped lifecycle-to-wallet assignments. Publish after admission authorization
  and before backend admission; reject conflicts and outages before continuation
  exposure. Three-home local E2E verifies nine continuation/home combinations,
  races, retry and failures; full Yao execution remains a hosted acceptance gate.
- [x] Route passkey login/unlock challenge creation by wallet identity and
  verification by the published challenge ID. Route Email OTP unlock/challenge/
  factor-release requests by their wallet ID. Verify real challenge creation and
  one-use consumption across homes; signature/provider execution remains open.
  Require canonical auth paths so path aliases cannot bypass home dispatch.
- [x] Route explicit-wallet Google login to the selected home. A missing or
  mismatched selected enrollment fails without switching wallets or creating a
  registration offer. Three-home composition exercises the production resolver
  and D1 enrollment/identity stores; Google token verification is controlled.
- [ ] Resolve wallet-less linked-device QR creation and polling through shared
  pre-wallet coordination, then bind the approved session to its owner's home.
  Inventory atomic claims, approval, delivery and terminal cleanup before moving stores.
- [ ] Finish routing for passkey/external-identity/delivery locators and Wallet
  Runtime operations, deferred work, expiry reconciliation and deliberate
  fresh attempts. Remove the remaining single-D1 deployment assumptions only after
  their regional resource-proof replacements are installed.
- [x] Remove Console's namespace reservation gate, historical home-adoption
  path and effective-schema table, while preserving provider writer proof and
  binding/resource checks. Private focused E2Es and type checks passed. Hosted
  routing remains single-D1 until the directory integration is complete.

This foundation does not close R1–R7, does not measure geographic latency, and
leaves the release held. No hosted schema reset, deployment or publication occurred.

### R1. Define one wallet-home and registration contract

- [ ] Define the canonical wallet ownership key from verified tenant scope and
  wallet ID, preserving the actual existing uniqueness scope. Project/environment
  isolation must be explicit; equal wallet strings in different scopes cannot
  route or authorize each other.
- [ ] Define a typed region/resource catalog for US, WEUR and APAC. Stable home
  identity names the actual authoritative resource; physical Worker versions and
  deployment revisions are distinct from wallet identity.
- [ ] Select the closest eligible home from trusted original edge location at
  registration. Strip client routing/location overrides and preserve provenance
  through service hops. Record the region decision, not unnecessary raw location.
  Use a documented configured default only when **new-registration** location is
  unavailable. Never use that default to recover an unknown existing wallet.
- [ ] Define branch-specific registration state: reserved, established, failed or
  cancelled, with required identities and legal transitions. Persist reservation
  before any regional custody/credential side effect. Concurrent and retried
  attempts for the same registration return the same wallet/home.
- [ ] Keep a wallet's home immutable. A failed/retried registration cannot reuse
  its identity at another region. Define cleanup of abandoned attempts without
  allowing late messages to recreate or move that wallet.
- [ ] Use precise parsed/built domain types and Result-style recoverable failures.
  Add type fixtures rejecting forged admitted contexts, broad-spread lifecycle
  construction and invalid branch combinations. Diagnostics do not grant access.

### R2. Separate shared authority from wallet-local state

- [ ] Put the wallet directory and pre-wallet allocation/identity uniqueness in
  the existing Console authority, behind authenticated service interfaces.
  Do not maintain three independent copies of a globally unique identity index.
- [ ] Keep wallet sessions, wallet signing quotas, authorities/auth methods,
  revocation, operation admission/completion/replay, material lifecycle journals,
  custody envelopes and wallet-local recovery state at the assigned home.
- [ ] Keep tenant/project policy, cross-wallet credential/identity uniqueness,
  aggregate rate limits and tenant-wide quotas authoritative at their defined
  shared scope. Keep every Email OTP rate-limit key in shared authority for the
  initial cutover: the current consume operation walks IP, user, wallet,
  provider and organization keys together. A later counter split needs explicit
  idempotent consumption semantics; regionalization must not multiply an
  existing allowance by three.
- [ ] Preserve atomicity for recovery/identity changes. Where the old transaction
  crosses the new ownership boundary, define durable reservation, idempotent
  regional commit and completion/reconciliation states; prohibit duplicate
  claims and replayed proofs. Do not assume a cross-D1 transaction exists.
- [ ] Specify which checks are fresh per request and which verified admissions
  may be reused for an operation, including expiry, revocation and replay.
  Count every added authority lookup/write and its latency; avoid redundant
  directory reads once a request has a verified execution context.

### R3. Replace registration and lookup routing

- [ ] Route passkey, Email OTP/OIDC and supplied-ID registrations through the
  same reservation authority. Complete their region-local ceremonies using the
  allocated wallet/home context; persist completion idempotently.
- [ ] Implement trusted lookup for unlock/discoverable passkey, verified external
  identity, recovery code, exchange token and delivery identifiers that arrive
  without wallet ID. Preserve non-enumerating errors and credential secrecy.
- [ ] Treat any client-carried routing hint as untrusted until it is bound to
  authenticated tenant/wallet authority. A home identifier never authorizes an
  operation. Reject disagreement before wallet mutation.
- [ ] Use existing Gateway/service-binding infrastructure to dispatch to the
  assigned regional backend. Dispatch at most once; never forward credentials
  to a request-provided URL or follow an unvalidated redirect.
- [ ] Remove the old namespace-home admission and registration allocation paths
  in the same changes that install their replacements; do not add a mode flag.

### R4. Enforce home at every execution boundary

- [ ] Require a verified wallet-home execution context when constructing the
  wallet-local store/service graph. Check tenant, wallet, actual resource and
  admitted regional deployment identity before effects.
- [ ] Apply it to registration completion, unlock/session exchange, both signing
  curves, prepare/finalize/replay, recovery, export, add/revoke auth method,
  device linking, refresh/retirement and wallet-scoped administration.
- [ ] Carry the same identity through custody role RPCs and deferred work.
  Wallet-scoped cron/alarm/refill/retry jobs use persisted wallet home, never
  current client location or a process-wide namespace default.
- [ ] Inventory tenant-root creation/backup/control separately. Keep legitimate
  pre-wallet bootstrap possible under explicit authenticated tenant authority;
  wallet operations cannot enter that path to bypass home admission.
- [ ] Fail closed for unknown/unavailable/conflicting homes and stale workers.
  Do not silently fall back to a different regional database. Define treatment
  of already-admitted in-flight operations during backend deployment changes.
- [ ] Remove obsolete direct/internal entrypoints and prohibit deployment of
  surviving unfenced writers. Retain local development through the same domain
  contract with a single-region adapter, not an alternate ownership model.

### R5. Deployment and deletion closure

- [ ] Render and verify US/WEUR/APAC Gateway, Wallet Runtime and required custody
  service placements/bindings. Configure placement near each home and verify
  actual execution; a region label alone is insufficient.
- [ ] Reuse fresh provider-bound database challenges and version checks per
  regional resource. Deployment activation admits a backend resource set;
  wallet assignment selects one admitted home within it.
- [ ] Define the scoped reset of disposable wallet data, registrations, sessions,
  routing indexes and associated test custody material. Do not leave a stale
  session, worker, locator or replay record able to resurrect discarded data.
- [ ] Delete namespace-home classes/stores, immutable namespace reservation
  schema, home-adoption handlers/CLI modes, compatibility decoders and old
  one-home deployment fields. Preserve ordinary namespace tenant isolation.
- [ ] Rebuild schemas/configs/generated bindings and package artifacts through
  their generators. No hand-edited generated manifests or stale schema retained
  solely to load discarded wallets. Respect published migration history; use an
  explicit reset/new baseline or removal migration as applicable.
- [ ] Replace/delete old fixtures, type tests, E2Es, snapshots and docs assertions.
  Historical experiment receipts may remain clearly labelled evidence outside
  active code/configuration. No legacy implementation is retained as an example.
- [ ] Inspect final exports/imports, source searches and generated bundles for
  retired ownership symbols, routes and schema. This is a deletion audit, not
  a new source-text guard suite. No unexplained matches may remain in active code.

### R6. Behavioral verification and measurement

- [ ] Register US, European and Tokyo users in the **same** tenant/project/
  environment/namespace and prove three independent home assignments. Permute
  registration order to prove the first user has no influence on others.
- [ ] Run concurrent registration, duplicate identities, lost replies and restart
  across ingress regions. Assert one durable wallet/home per operation, current
  uniqueness semantics and no orphaned duplicate custody effect.
- [ ] Send conflicting last-quota operations and duplicate prepare/finalize/replay
  from multiple ingress regions to one wallet. Verify one quota use per admitted
  operation, one custody effect, exact replay and unchanged key identity.
- [ ] Verify spoofed region/resource/wallet/tenant, stale deployment, wrong bound
  database, unavailable directory and region outage. Assert no fallback write
  and retain before/after state plus outbound-dispatch evidence.
- [ ] Run unlock, recovery, export, linking, revocation and deferred work after
  client travel. Repeat no-wallet-ID entry cases; all reach the original home.
- [ ] Verify shared identity collision and aggregate rate/quota enforcement across
  different homes; changing ingress or wallet home cannot evade shared limits.
- [ ] Extend the existing hosted probes for a fixed wallet from local and remote
  clients in US/Europe/Tokyo. Alternate client order; keep build, home and custody
  identities fixed. Cover warm signing, cold unlock/first sign and bursts; verify
  signatures and retain failures, sample counts and latency distributions.
- [ ] Break down client-to-home, directory/shared-authority, Gateway-to-D1 and
  custody calls. Distinguish simulated concurrency from geographically hosted
  measurements. Do not claim travel-latency improvement from emulator timings.
- [ ] Produce repeatable E2E artifacts containing source/build identities,
  selected homes, actual resource/version/served-region observations, operation
  IDs, quota/replay assertions and redacted traces. Add no unit tests.

### R7. Completion and release gate

- [ ] Every inventory item has a verified replacement or deletion; all entry
  points have a documented owner and admission check. No namespace placement
  fallback, adoption path, legacy flag or dual ownership implementation remains.
- [ ] Update intended-behavior specification and matching contracts together;
  update integration docs to describe per-wallet placement and travel behavior.
- [ ] Review all intervening source commits, freeze a new exact 0.8.0 candidate,
  rebuild packages and run public/private acceptance plus exact-revision CI.
  Prior green CI cannot validate the replacement architecture.
- [ ] Complete the agreed code and verification scope before requesting/reusing
  release authorization. No 0.8.0 publication under the superseded intermediate
  candidate approval. Existing-wallet migration stays excluded.

## Historical namespace experiment and implementation record

The remainder records earlier evidence and the superseded namespace-wide plan.
Its checked boxes are historical milestones, not acceptance of the replacement.
Use R0–R7 above as the active implementation and deletion checklist.

Date: September 30, 2026

Status: placement investigation and ownership design in progress. Repeated London
and Tokyo ready-material comparisons each favor their nearby primary. Each
ready-material comparison has 180 verified signatures: 30 owner and 60 linked
signatures per D1 arm.
Tokyo retains one additional collection failure with unknown Wallet outcome.
The first real-Console Tokyo diagnostic verifies eighteen signatures. The
registration projection gap is now fixed in source and verified through hosted
replay/reply-loss checks. A separate server candidate verifies a reversed-order
18-signature comparison and cold unlock/burst in both D1 arms (28 candidate
signatures total). A separate local-browser follow-up verifies twelve more
signatures, measures individual cold-unlock calls and proves ECDSA activation-loss
recovery through hosted Console. The next candidate removes nine authority
initialization calls and verifies thirty signatures across cold unlock,
activation recovery and device linking. The subsequent commit-readback candidate
verifies thirty signatures and removes one further call: cold unlock is now 29
Gateway calls and activation-loss recovery is 25, each with two Console calls.
The latest hosted Tokyo repeat failed during Container allocation before any
browser dispatch; cleanup and restoration are verified. Repeated authenticated cohorts,
broader workloads and production routing remain gated on the checks below. The October 1
[ownership review and first experiment](refactor-152-ownership-review.md)
defines a whole-deployment-namespace diagnostic and records the remaining
production routing proof. The October 1 implementation request authorizes that
concrete two-database experiment. Both isolated databases are provisioned and
have the same 39 migrations; measured placement results are recorded in
[the regional experiment log](refactor-152-results.md).

The Console namespace-home reservation primitive is implemented and verified
locally in private commit `12784a3`. Concurrent callers share one immutable
account/database assignment, including after interrupted provisioning and restart.
Private commit `a09e454` integrates the reservation into authenticated
provisioning admission: missing or conflicting assignments fail before cutover,
custody or credential creation. Existing-resource inventory/pinning,
physical-resource verification and regional runtime routing remain
open. Private commit `afeea62` also requires the reserved resource at activation
and records it in the activation transaction. Historical activation rows remain
unattested; a new activation can record their pinned home without rewriting the
binding. These changes have not been deployed.

October 2 private commit `dd6f5bf` makes home identity required in the canonical
binding hash, adds explicit historical-binding adoption to a new revision, and
checks configured resource identity in bound runtime consumers. Private commit
`97e0426` adds explicit operator adoption, fresh production readiness and canary
retry handling, verified locally through the production Console Worker. Physical
resource verification, coordinated adoption/deployment with hosted canary evidence,
and remaining entry-point coverage are still rollout gates. See the
[contract/adoption evidence](refactor-152-results.md#canonical-home-contract-and-adoption-october-2).

Private commit `877890d` adds a read-only provider binding checkpoint for every
serving version of the lane's Gateway and Wallet Runtime, including gradual
rollouts and deployment-drift detection. The local CLI E2E covers ten scenarios.
The live production-testnet provider check passed October 2 using saved Wrangler
OAuth credentials. Private commit `022e1a9` implements a fresh database challenge
and comparison with Console's immutable reservation, verified locally through
the production Console, Gateway and Wallet Runtime Workers. Its signer migration
0040 requires a new exact Wallet Server release before deployment; the private
repository currently consumes 0.7.3. Live runtime verification and joining both
checkpoints to activation remain open. Neither checkpoint authorizes activation. See the
[provider checkpoint evidence](refactor-152-results.md#provider-binding-checkpoint-october-2).

Private commit `5dca209` joins provider and runtime evidence in one operator
checkpoint. It matches each answering Worker version to Cloudflare's serving
version and verifies stable deployments before and after the fresh challenge.
Four related local E2Es pass. The combined check requires one serving version per
writer; it rejects gradual rollouts before writing the challenge. Live execution
and activation enforcement remain open. See the
[version-bound checkpoint evidence](refactor-152-results.md#version-bound-home-checkpoint-october-2).

Private commit `a367716` consumes that evidence atomically with activation and
enforces the activated versions on split Gateway requests/scheduled work and
bound Wallet Runtime requests. The nine related local E2Es pass. The subsequent
local follow-up fixes production-testnet rollout ordering and verifies readiness
before/after activation and stale-version rejection. The migration release,
hosted rollout execution and remaining writer coverage are still open. See the
[activation evidence](refactor-152-results.md#activation-consumption-and-runtime-version-admission-october-2).

The October 2 release preparation now freezes candidate `94b4c988`, including
the wallet-management upgrade gate and live step-up expiry enforcement. Local
package, Console home-challenge, published-client reload, Email OTP lifecycle
and sustained-signing checks pass. Both exact-revision CI workflows have passed.
The first 40 signer migrations are unchanged; 0041 is added. Publication, exact
private consumption and hosted cutover remain open. See the
[protocol candidate acceptance](refactor-152-release-review.md#protocol-candidate-acceptance--october-2)
for hashes, scope, timings and CI links.

## Current release scope — October 2

Finish regional Gateway routing and automatic initial-home assignment, complete
internal/lifecycle admission enforcement, and implement regional concurrency
and travel-latency verification before publishing 0.8.0. Existing test wallets
may be discarded; no existing-wallet migration implementation is required.
The previously green SDK candidate remains a checkpoint, not authorization to
publish while this implementation is unfinished.

## Objective and starting evidence

Use the [R151 empirical results](refactor-151-results.md) as the consolidated
baseline index; preserve each cohort's scope and build identity when comparing.

Reduce complete system-controlled signing latency by bringing the remaining
authoritative D1 calls closer to the Gateway and role-separated custody DOs.
Retain the architecture established by
[R150](refactor-150-regional-wallet-home-lanes.md). Custody material stays with
its owning role; this plan concerns Gateway authorization, policy, sessions,
quotas, and durable operation records.

[R151](refactor-151.md) reduced canonical reusable-session ECDSA prepare/finalize
from 18 to five Gateway D1 calls (six SQL statements and two write-bearing calls).
Both linked generations also use five calls after the custody and policy joins.
The [session-read follow-up](refactor-151-session-read.md) inventories the wider
SDK path and consolidates its status reads. Use its final source/build identities
and complete request budget as the next experiment baseline.
The earlier hosted
12-call cohort reported median summed D1 wall time
of approximately 865–901 ms versus 14–15 ms of SQL execution, with all calls
served by the APAC primary. Gateway and DO execution locations were unverified.
These numbers justify investigation; the difference includes scheduling,
binding, service, and transport overhead and cannot be attributed wholly to
distance or treated as recoverable latency.

The subsequent stable-rollout cohort verifies 35 signatures across Tokyo
(`nrt13`), London (`lhr15`), and the US (`ord12`). All 28 timed signatures retain
seven D1 calls served by the APAC primary. First/warm D1 wall medians are 614,
1,766, and 1,672 ms respectively, versus 16.56, 11.94, and 11.18 ms SQL execution.
Warm SDK medians are 1.97, 4.04, and 4.14 seconds, including automated confirmation.
Cloudflare adaptive analytics subsequently identify aggregate Gateway execution
in NRT, LHR, and ORD and role DO execution also in KIX and AMS. These aggregates
do not identify each signing RPC. This remains a regional-path observation with
one configuration and no isolated regional-D1 benefit. Execution evidence:
`.artifacts/r151/regional-workloads-20260930-r7/placement-complete.json`.

Seven of eight dispatched wallet attempts completed; one Tokyo unlock action
timed out without a process signal and remains unresolved. London and US each
completed all three attempts after preflight required completed image rollouts,
matching application versions, and two stable observations. Preserve earlier
failed cohorts separately. Five further fresh Tokyo attempts completed unlock
and 25 verified signatures; the original timeout did not reproduce. A local
network-failure E2E verifies a visible error and successful explicit user retry.
Linked timing passes on all three local backend profiles (27 signatures).
Subsequent hosted linked chains also passed in Tokyo, London, and the US
(27 signatures), retaining nine D1 calls per linked signature. First linked
signatures spent 6.15–13.44 seconds generating material in the foreground.
R151 implements background preparation after linked activation and verifies
consumption of that material. A subsequent joined linked-custody credential read
(`09608843`) reduces both linked generations to seven calls/eight statements,
matching canonical signing at that checkpoint. The subsequent policy snapshot
join reduces prepare/finalize to five calls; the seven- and nine-call cohorts
remain historical baselines.

The first two placement preflights dispatched no wallet operations because a
probe image rollout could not become healthy (Tokyo, then the US). Subsequent
independent regional cohorts completed successfully. Preserve those failed
preflights as infrastructure evidence. The subsequent October 1 experiment
provisions fresh APAC and WEUR databases, separately from those earlier cohorts.

An independent London cohort completed the A/B Gateway-placement experiment:
three same-wallet pairs, all signatures verified. Median D1 wall time fell from
2,007 to 584 ms, while custody proxy stages rose from 160 to 2,239 ms and complete
SDK time rose from 4,650 to 6,627 ms. Every pair became slower. Execution analytics
confirm LHR for default Gateway versions and NRT for Tokyo versions; per-request
placement headers were unavailable. This supports testing a primary near the
existing Gateway/custody path rather than moving only the Gateway. It does not
establish a regional-D1 benefit. Fixed default-then-Tokyo ordering, three samples,
and aggregate DO attribution limit the conclusion. Evidence:
`.artifacts/r151/regional-placement-20260930-r11/`.

R150's D1-versus-DO custody comparison did not measure the benefit of aligning
the residual Gateway database. R152's subsequent regional-D1 gain is recorded
separately in [the October 1 experiment results](refactor-152-results.md).
The complete signing target remains 1–2 seconds, including SDK orchestration,
authorization, presign waiting, prepare/finalize, and verified signature return.
Human decision time and transaction broadcasting are reported separately.

## Platform constraints

- D1 primary location hints apply when creating a database and are best effort.
  A matching region label cannot establish same-datacenter placement. Jurisdiction
  constraints take precedence over hints. See
  [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/).
- Worker placement can optimize proximity to backends. Evaluate Smart Placement
  and supported explicit placement hints using the current deployment tooling;
  record observed execution evidence separately from the requested placement.
  See [Worker placement](https://developers.cloudflare.com/workers/configuration/placement/)
  and [explicit placement hints](https://developers.cloudflare.com/changelog/post/2026-01-22-explicit-placement-hints/).
- DO location hints are also best effort. Use fresh experiment objects when
  testing initial placement and record which role objects were exercised. See
  [DO data location](https://developers.cloudflare.com/durable-objects/reference/data-location/).
- D1 replicas are asynchronous and writes go to the primary. Session bookmarks
  provide ordering relative to the supplied bookmark; they do not prove that an
  independent session's latest revocation has been observed. Keep authoritative
  admission checks on an appropriate primary-consistent path. See
  [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).

## Phase 1: establish the residual cost

- [x] Finish R151's supported-call-budget review and record the resulting canonical,
  linked, replay, and rejected-request budgets. Retain admission, atomic quota,
  material freshness, and durable completion invariants. Both canonical and linked
  prepare/finalize use five calls after the policy/material join. The full
  ready-material owner path uses seven calls, including two status reads;
  linked signing uses five. Replay/rejection correctness evidence remains
  separate from successful-signature latency. These are adopted measured
  budgets; a theoretical minimum remains unproven.
- [x] Freeze SDK, Gateway, role builds, schema, concurrency, and refill settings
  for each cohort. Record source revisions and distribution hashes.
- [x] Reuse the existing isolated benchmark and per-call D1 instrumentation.
  Correlate browser spans, Gateway requests, and role operations without storing
  credentials, signing material, or request bodies in the public evidence.
- [x] Record probe location, ingress colo, available Gateway execution-location
  evidence, role DO placement evidence, and every D1 call's served region and
  primary flag. Mark unknown locations explicitly. Ingress colo alone cannot
  establish where application code executed.
- [x] Measure London immediate first sign, ready-pool warm sign, and concurrent
  burst separately, retaining refill overlap and foreground-wait evidence. All
  30 diagnostic signatures verified. Report D1/write budgets and SDK distributions
  separately from browser harness time; concurrent durations overlap. The repeated
  sample target and other probe regions remain Phase 2 gates.

Experiment preparation can proceed alongside R151. A regional ownership decision
uses the residual cost after supported call reductions have been implemented.
R151 r16/r17 freeze builds and instrument the ready-material London workload.
The repeated R152 regional treatment completes the London ready-material
sample target with 180 verified signatures: owner p95 2,638.4→942.7 ms and linked
p95 2,457.7→927.0 ms. A separate six-wallet first-sign/burst diagnostic verifies
30 more signatures; its WEUR first-sign median is 1,151.9 ms and burst median
1,333.6 ms, with a 2,017.2 ms burst maximum. The broader repeated workload/region
matrix stays open; see [results and limitations](refactor-152-results.md).

## Phase 2: controlled placement comparison

Use the same workloads and build identities in these arms:

| Arm | Database and compute | Question |
| --- | --- | --- |
| A | Existing primary and current Gateway/DO configuration | What is the optimized baseline? |
| B | Same primary and DOs; Gateway placement optimized near that primary | Can Gateway placement alone remove the relevant cost? |
| C | Fresh APAC control versus fresh WEUR primary; fixed Gateway and role builds, fresh wallets in both arms | Does regional D1 improve complete signing with the existing compute path? |

- [x] Run A/B first. Include the Gateway-to-DO leg: improving D1 proximity can
  increase custody RPC latency. Confirm the placement treatment took effect.
- [x] Complete the London ready-material regional-D1 comparison across two
  probe boots and alternating arm order: 30 owner and 60 linked signatures per
  arm, all verified. Owner/linked p95 improves 64.3%/62.3%, meeting the proposed
  benefit criterion for this workload. Preserve its static-Console scope and
  keep the broader workload/region gates below open.
- [x] Complete the Tokyo ready-material sample target with 30 owner and 60 linked
  signatures per arm across ten completed wallets per arm. APAC versus WEUR D1
  lowers owner p95 3,173.6→2,065.6 ms and linked p95 2,970.6→1,637.1 ms
  (34.9%/44.9%). Count the additional WEUR collection failure in its 11 dispatched
  attempts, preserve rejected Osaka candidates, and retain the independent-boot,
  temporal-block and static-Console limitations. See the
  [sample extension](refactor-152-results.md#tokyo-sample-extension-october-1).
- [x] Provision the initial fresh APAC control and WEUR treatment with matching
  schemas, separate namespaces, fixed builds, and comparable fresh-wallet
  registration. Record database identities, actual primary-region metadata,
  deployed binding pairs, cost, and restoration evidence.
- [ ] Extend the matched comparison to other probe regions and, when warranted,
  an ENAM primary. Keep registration distribution and object age comparable;
  retain the original ENAM infrastructure failure separately. Three R152 Tokyo
  preflights and a subsequent direct-Linux-manifest diagnostic dispatched no
  wallets because the target probe image could not become healthy. Authenticated
  registry reads verified the target manifest/configuration. The direct manifest
  also produced a Container allocation error before process startup; the underlying
  provider cause remains unresolved. All failures and cleanup receipts are retained.
  Probe rollback required a byte-identical redeployment; the new restoration
  baseline is `c573e917-9faf-4448-a4a1-d6eb2d845fef`, recorded in the experiment log.
  A subsequent Docker-format manifest with identical configuration/layers also
  failed the original Tokyo application's readiness gate. Temporarily moving
  the existing idle WEUR application to APAC successfully started that frozen
  SDK in Hong Kong; the location gate rejected it before wallet dispatch.
  Those attempts supplied no Tokyo measurements. Preserve the separate failed preflight/rollout and
  Hong Kong startup receipts; use them for provider investigation of the
  original application and Tokyo provisioning path. APAC constraints cannot
  guarantee a Tokyo location. See the [repair attempts](refactor-152-results.md#tokyo-repair-attempts-image-format-and-alternate-application-october-1).
  A later WEUR→APAC placement reset recovered the original application's target
  rollout, first in London and then Hong Kong. A smaller 1-vCPU / 6-GiB probe
  also started in Hong Kong. Both failed the Tokyo location gate before wallet
  dispatch. The user approved a temporary Worker/namespace/Container bundle;
  Durable Object scheduling with provider-verified placement subsequently
  started the frozen SDK in `nrt08` and completed Tokyo signing. Keep rejected
  Osaka placements and the between-arm probe restart separate. Use bounded
  candidate discovery and a fresh, stable cohort per arm; broader sample-count,
  workload and authenticated Console gates remain open. The initial Tokyo cohort
  verifies 18 signatures (three owner and six linked per D1 arm); owner medians
  are 1,673.8 ms with APAC D1 and 3,010.5 ms with WEUR D1. All temporary resources
  were deleted after verification. The subsequent extension reaches 180 verified
  Tokyo signatures; the US and broader workload matrix remain open. See the
  [Tokyo results](refactor-152-results.md#tokyo-signing-results-and-cleanup).
- [ ] Alternate arm order across at least two runs. Target at least 30 completed
  signatures per arm, probe region, and workload; record errors and incomplete
  attempts in the denominator. Distinguish independent fresh-wallet first-sign
  samples from repeated signatures on an existing wallet. The ready-material
  London/Tokyo targets are complete; repeated immediate-first/burst and US
  workloads remain open.
- [x] Report p50, p95, observed maximum, sample count, and error rate for the
  completed London workloads. Preserve raw redacted samples. Arms use distinct
  wallets; distributions are unpaired. Continue this accounting for each region.
  A small cohort maximum does not establish a universal two-second bound.
- [ ] Use a proposed benefit gate of at least 20% and 100 ms improvement in
  full-path p95 over the best simpler arm across repeated runs. Record uncertainty
  and tail/error regressions in other regions. Revisit the gate explicitly before
  running if the measured baseline makes it inappropriate. London's WEUR
  treatment meets this latency criterion over the APAC baseline for ready-material
  signing. Tokyo supports retaining APAC and demonstrates the cost of a WEUR-only
  placement there. Its owner maximum is 2,069.4 ms, so a universal two-second
  bound is unproven.
- [x] Reconcile cumulative Cloudflare experiment cost before provisioning and
  each completed run; continue before every rerun. Keep the existing $25 cap and
  isolated-resource scope. Preserve R150's
  unresolved ENAM infrastructure failure separately. Stop at the budget limit
  and retain incomplete evidence rather than silently expanding the experiment.
- [ ] Record a decision: retain current ownership, change Gateway placement only,
  or proceed to regional ownership design. A no-go result completes this phase.
  Restore temporary deployments and clean up only resources owned by this run.

### Next authenticated Console cohort

- [x] Verify full Console Worker initialization and its real credential service
  client locally. Private commit `7eef6d4` passes credential issuance/authentication,
  origin/environment rejection, rotation, revocation, environment lookup, and
  unprovisioned-root rejection. The existing binding E2E also passes. See the
  [preflight and fixture audit](refactor-152-results.md#authenticated-console-local-preflight-october-1).
- [x] Prepare a fresh Console-supported development fixture. The static benchmark
  uses an unsupported key format and `bench` environment; its reduced root receipt
  also lacks Console-required ready fields. Use production provisioning services
  and retain the full root response. Two fresh development identities now have
  active roots and complete Console grant receipts; their Wallet namespaces and
  organizations are disjoint. Keep the existing static cohorts unchanged.
- [x] Prepare Console authority in one fixed database for the two
  Gateway D1 homes. Audit schema overlap and apply required Console migrations
  without resetting retained Wallet data. Configure the complete isolated Console
  handler and preserve the frozen custody-role deployments. The migration
  rehearsal and remote readback preserve all existing schema objects. Console
  authority stays in APAC; only that database receives the additional 22 Console
  migration files. See the [hosted fixture evidence](refactor-152-results.md#hosted-console-fixture-provisioning-october-1).
- [x] Run the first hosted signing diagnostic through the real Gateway → Console
  composition. Two fresh wallets in provider-verified Tokyo complete registration,
  two generations of linking and 18 verified signatures with the frozen SDK image
  and Wallet Server 0.7.3. Console stays in APAC while Gateway D1 changes from APAC
  to WEUR. Record Console calls and Gateway D1 metadata separately. The existing
  harness namespace check is preserved by correcting the private fixture names.
  See the [authenticated diagnostic](refactor-152-results.md#hosted-console-signing-diagnostic-october-1).
- [x] Close the demonstrated registration-projection gap. The managed Gateway
  now supplies the existing projection adapter through the Console service
  boundary. Hosted activation plus lost-reply/exact replay creates one Wallet
  row per registration; the local Console E2E verifies zero registration
  monthly-active-resource rows and rejects organization/scope mismatch. Preserve
  the original frozen cohort and keep the unreleased patched candidate separate.
- [x] Repeat the linked-device diagnostic with reversed arm order. Provider-verified
  Tokyo completes WEUR then APAC: eighteen verified signatures on one recorded
  boot, with the same candidate build and fixed APAC Console authority. Owner
  medians are 3.20s versus 1.93s; linked medians are 2.69s versus 1.57s.
- [x] Complete initial cold-unlock/first/warm/burst diagnostics in both arms.
  Ten verified signatures across two fresh wallets include explicit unlock
  verification after runtime reset and shared-budget exhaustion. The WEUR
  preflight boot change is retained; its replacement passes under a fresh Tokyo
  identity. These single samples use different boots and do not establish a
  controlled latency gain. Server replay/reply-loss checks yield four total new
  projections across the candidate cohorts, with no monthly billing rows.
- [x] Measure unlock's individual Console/D1 calls separately. A local Docker
  browser against the frozen hosted candidate verifies ten first/warm/burst
  signatures. Each unlock uses 39 Gateway D1 calls and two Console calls,
  including nine runtime schema/initialization calls. Summed Gateway D1 wall is
  2.520s with APAC and 9.718s with WEUR; unknown `exec` metadata stays unknown.
  This closes diagnostic call accounting, with provider-verified regional
  repeats still open. See the [measurement scope and artifacts](refactor-152-results.md#local-browser-cold-unlock-accounting).
- [x] Cover ECDSA browser recovery after losing the original activation response
  through hosted Console. Fresh local-browser WEUR/APAC runs each verify three
  exact replays, altered-digest rejection before unlock, one explicit unlock,
  unchanged registration-request count and a signature from the original key.
  Each creates one Console projection, with zero monthly billing rows. Recovery
  uses 35 Gateway D1 calls plus two Console calls. This is correctness evidence;
  provider-verified regional repetition remains open. Preserve the earlier
  diagnostic header-overflow failure separately. See the [recovery evidence](refactor-152-results.md#browser-activation-loss-recovery-through-hosted-console).
- [x] Remove the nine demonstrated request-time authority initialization calls
  in a separate candidate. Migration and remote schema/guard preflights pass;
  duplicate DDL, schema-on-use state/option and the unused setup helper are
  deleted. Thirty verified signatures cover cold unlock, activation recovery
  and second/third-generation linking across both D1 homes. Cold unlock falls
  39 → 30 Gateway D1 calls; recovery falls 35 → 26, retaining two Console calls.
  Remaining query multisets are unchanged. Two failed long linking attempts
  expose a local IPv6/IPv4 readiness mismatch; explicit IPv4 binding fixes the
  launcher and the repeat passes. See the [candidate evidence](refactor-152-results.md#removing-request-time-authority-initialization-october-1).
- [x] Review the remaining unlock reads and writes separately. The D1 commit
  adapter already verifies the persisted session and primary credential digest;
  remove the service's duplicate readback. Account for all 33 reported written
  rows, including index maintenance: 25 in session replacement and eight in
  challenge, authenticator and activity operations. Preserve the full replacement
  transaction and live authority/quota checks. Thirty new verified signatures
  cover both homes: cold unlock now uses 29 Gateway D1 calls and recovery 25,
  with two Console calls each. The four query comparisons remove exactly one
  read; writes remain unchanged and no latency gain is established. Further
  envelope/activity read reuse remains a bounded optimization candidate;
  generic query fingerprints alone do not prove duplicate bound records. See the
  [write inventory and readback reduction](refactor-152-results.md#removing-the-duplicate-session-commit-readback-october-1).
- [ ] Extend authenticated sample counts across fresh wallets and boots, then
  collect the broader workload and region coverage. These small diagnostics do
  not establish a latency distribution or production readiness. Record refill
  overlap and Console costs separately; fourteen Gateway rows written per
  signature and eleven/seven combined owner/linked D1 round trips remain targets
  for the deferred write/round-trip reduction work.
  Retain failures, reconcile cost, revoke credentials, remove the active binding,
  close ingress and verify restoration after every cohort. Successful signing
  alone does not close the complete authenticated-composition gate or authorize
  production regional routing.

Further call/write optimization is tracked in the
[deferred lifecycle budget audit](#deferred-follow-up-lifecycle-d1-call-budgets).
Keep each regional comparison on its frozen candidate while that audit is pending.

## Phase 3: prove the ownership boundary

Complete the experiment's isolation review before Phase 2C. The
[initial review](refactor-152-ownership-review.md) keeps all tables of each fresh
deployment namespace in one database and records the authorization scope
constraint. Proceed with production regional ownership/routing implementation
only when Phase 2 demonstrates material benefit. The complete production proofs
below remain open.

- [x] Classify public, internal, scheduled and custody-alarm entry points against
  their actual storage and side effects. The
  [entry-point review](refactor-152-ownership-review.md#entry-point-review-and-initial-home-implementation-order)
  distinguishes Wallet D1 admission, pre-activation inspection/control, Console
  scheduled custody resumption and role-local expiry. It also identifies the
  missing namespace-wide assignment constraint across deployment lanes.
- [x] Extend the lifecycle transaction inventory to both export curves, linked
  installation/activation/cleanup, method revocation, lane retirement and OTP
  accounting. Record where custody effects precede a D1 commit and distinguish
  Wallet Session quotas from Console quotas. See the
  [lifecycle follow-up](refactor-152-ownership-review.md#lifecycle-ownership-follow-up).
- [ ] Inventory every table, trigger, admission check, revocation, policy update,
  quota, replay key, and administration path touched by a signature. Identify
  which values must participate in the same transaction or freshness boundary.
- [x] Choose the conservative initial ownership unit: the entire deployment
  namespace, including all its organizations/projects. Schema uniqueness,
  signing admission and the lifecycle transaction inventory support keeping
  these records together. Existing namespaces remain pinned. A smaller
  tenant/project/wallet partition requires a separate proof of its cross-owner
  state; this decision does not establish the smallest possible partition.
- [ ] Keep exactly one authoritative writable home for each ownership unit.
  Multiple regional databases hold disjoint owners. Independent writable copies
  of the same quota, revocation state, or operation are excluded.
- [ ] Identify globally shared configuration and its consistency requirements.
  If a global authority check still needs a remote round trip, include it in the
  experiment and decision. Do not add asynchronous authority copies to hide it.
  Private Console now consumes Wallet 0.7.3 and exposes binding wall time on
  status requests, plus Console D1 wall/SQL/available placement metrics. An isolated
  service E2E verifies propagation and fresh binding reads locally. A hosted NRT
  cohort now verifies production Gateway → Console → D1 timing and revision
  freshness: 64 unauthenticated status probes, binding p50 64 ms with APAC versus
  246 ms with WEUR. Full authenticated signing composition remains open; this
  lookup-only cohort does not measure signing latency. See the experiment log.
- [x] Implement the namespace-wide reservation primitive in the existing Console
  authority. Private migration `0047_namespace_d1_homes.sql` and the deployment
  store serialize initial assignment across callers, preserve exact retries and
  reject changed account/database identities. Local persistent-D1 E2E verifies
  twelve competing requests, response loss, restart and SQL overwrite guards;
  see [results](refactor-152-results.md#console-namespace-home-reservation-october-1).
- [x] Require the reserved home during authenticated provisioning before lane
  side effects. The production Console Worker E2E verifies signed automation,
  missing-home rejection, concurrent matching/conflicting lanes, refusal of a
  request-supplied home and reservation preservation after custody failure/retry.
  Hosted admission reads the existing reservation once; it cannot create one.
- [ ] Inventory and explicitly pin existing namespaces to their current resource
  before deploying the mandatory admission boundary. Initialize fresh hosted
  namespaces through deployment control. Local bootstrap alone reserves its
  configured development resource as part of provisioning.
- [x] Enforce the reserved home in new activation transactions. Required parsed
  home inputs and a D1 trigger reject missing/conflicting resources. Local E2E
  verifies competing activations, completed retry after readiness expiry, stale
  retry rejection, direct SQL home checks and historical adoption through a new
  activation. This records assignment identity, with physical verification open.
- [x] Require home identity in the canonical binding hash. Ordinary decoding
  rejects bindings without it. Explicit persistence-boundary adoption verifies
  the old hash, checks the namespace reservation and creates a deterministic new
  revision while retaining the original row. Local E2E verifies adoption and
  activation retries, preserved history and tampered-home rejection.
- [x] Compare configured home identity in bound Gateway, Wallet Runtime and
  combined runtime request paths, including Gateway scheduled work. Provisioning
  candidate creation and active reuse also check the configured home. Generated
  configurations carry the same signer-D1 identity. This is configuration
  consistency; actual resource verification remains open.
- [x] Implement explicit operator adoption with fresh production readiness and
  historical source-scope handling. The OIDC-protected route and CLI resume saved
  cutovers, rerun the canary after activation/response failure, preserve the old
  binding and reject stale requests. Local production-Console E2E uses controlled
  external Wallet/canary responses; see the
  [operator evidence](refactor-152-results.md#operator-home-adoption-october-2).
- [ ] Complete coordinated operator adoption/deployment with physical binding
  verification and real hosted canary evidence. Ordinary readers reject old
  bindings and the current deployment job smokes readiness before cutover;
  rollout sequencing must handle that transition. Local composed acceptance now
  rejects registration and auth-method intent requests through both changed
  writer versions before JSON parsing, with unchanged signer application state;
  see [ordinary writer admission evidence](refactor-152-results.md#ordinary-writer-admission-coverage--october-2).
  Local Gateway scheduled admission also passes: the current version dispatches
  one authenticated prewarm request and the stale version dispatches none; see
  [scheduled writer evidence](refactor-152-results.md#scheduled-writer-admission--october-2).
  Cover remaining internal
  control/inspection, discovery and administrative paths before claiming every
  entry point enforces home identity. Preserve pre-activation custody bootstrap.
- [x] Implement the provider configuration checkpoint: inspect all versions in
  current Gateway/Wallet Runtime deployments, compare actual `SIGNER_DB` UUIDs
  with the lane manifest and reject deployment/weight changes during inspection.
  Local CLI E2E verifies minority-version mismatches, malformed/missing bindings,
  provider denial, secret exclusion and preserved output identity.
- [x] Run the live production-testnet provider checkpoint. At October 2 09:39 JST,
  both serving Gateway/Wallet Runtime versions bound `SIGNER_DB` to the intended
  UUID and their deployments remained stable across inspection. Saved Wrangler
  OAuth credentials provided access; no provider mutation was performed.
- [x] Implement the fresh runtime challenge and immutable Console-reservation
  comparison. The operator writes a random five-minute proof through the intended
  database UUID, verifies both actual runtime bindings and deletes the proof even
  after a lost INSERT response. Nine related local E2Es pass, including two real
  D1 databases and all forty signer migrations. See the
  [runtime challenge evidence](refactor-152-results.md#runtime-home-challenge-and-live-provider-check-october-2).
- [x] Join runtime proof to provider-verified Worker versions. Generated writer
  configurations expose Cloudflare version metadata; both runtime observations
  must match the serving versions, and provider deployments must stay unchanged
  across the challenge. Missing metadata, wrong versions and deployment drift
  fail. Combined verification requires one version per writer at 100% traffic.
- [x] Bind the combined evidence to a specific cutover operation through the
  protected operator authority. Persist the namespace/home, verified deployments
  and versions, operation identity and expiry. Consume fresh matching evidence
  in the activation transaction and reject replay into a different operation.
  Enforce the activated version identity in runtime admission, covering retries,
  expiry and deployment changes after verification. Console migration 0050 stores
  immutable evidence in the activation row and makes challenge IDs unique. Both
  operator cutover commands now submit fresh verification. Bound Gateway/Runtime
  requests and Gateway cron enforce recorded versions in the existing binding
  lookup. The standalone checkpoint retains `activationAuthorized: false`.
- [x] Coordinate production-testnet deployment so verification, activation and
  canary precede Wallet/Console smoke. Require the packaged challenge migration
  before any deployment job. Both deployment CLI commands use the protected
  coordinator with an explicit environment ID; the backend child is reusable
  only. Wallet smoke rejects unavailable bindings. Local E2E evidence covers
  readiness before/after activation and a changed writer version. This is local
  rollout preparation; hosted execution and other-lane activation remain open.
- [ ] Publish and consume an exact Wallet Server release containing signer
  migration 0040, then coordinate Console migration 0050, service bindings, Worker deployment
  and historical adoption. Run the fresh challenge live and join both checkpoints
  to the immutable Console reservation.
  Validate the fence on hosted Workers and cover other reachable older/internal
  writer paths before claiming complete regional enforcement.
  Local package acceptance now runs the composed three-Worker home-verification
  E2E against extracted candidate JavaScript and all forty packaged migrations.
  The original 39 migration files are unchanged. The private local Worker now
  uses the SDK configuration parser, eliminating its retired `nodeRole` field.
  Full release validation and hosted execution remain distinct gates; see the
  [package-readiness evidence](refactor-152-package-readiness.md). The selected
  next version is 0.8.0 for both Wallet packages. Its ECDSA bootstrap wire change
  requires a coordinated client/server cutover, including already-open clients;
  see the [release review](refactor-152-release-review.md).
- [x] Make the existing hosted-wallet frontend deployment lane-specific before
  a testnet-only SDK/backend cutover. Private commit `709daa3` adds `--lane` to
  build/deploy/smoke and a `wallet_lane` input to the existing workflows. Each
  selection has its own artifact directory. A real Vite build and local Pages
  emulator E2E passed on 2026-10-02: exactly one testnet project deployed, all five
  smoke requests targeted testnet, and mainnet's content and digest stayed
  unchanged. Invalid selections and using a testnet build for mainnet were
  rejected. This establishes local deployment scope; hosted cutover remains open.
- [ ] Demonstrate the hosted old-client cutover behavior with an already-open 0.7.3
  client, an actionable reload/upgrade outcome and successful 0.8.0 registration
  and signing after reload. Both releases advertise iframe protocol `2.0.0`, so
  the existing handshake cannot establish the required SDK/backend pairing.
  A Chromium transport probe on 2026-10-02 confirmed both published 0.7.3 and
  frozen 0.8.0 propagate a fixture server's 409 upgrade message after one
  registration setup request, without retry. UI rendering and the complete
  cutover remain separate gates. The recommended explicit protocol check is now
  selected and implemented at the wallet-management request boundary, with the
  matching header in the SDK and private deployment canary. Local and hosted
  verification scopes are recorded in the release review. New candidate
  acceptance and hosted rollback verification remain required.
  Local composed acceptance passed in 30.3 seconds: published 0.7.3 received the
  upgrade error, the intended app surfaced the missing-header error, unsupported
  protocol failed before JSON parsing, CORS passed, and reload completed
  registration plus verified Tempo/Arc signatures. The old candidate's green
  CI does not cover this new protocol requirement.
- [ ] Reuse existing trusted tenant/environment routing where possible. Define
  required owner, home, and routing-generation identity at the server boundary.
  Reject inconsistent or stale routes before any mutation. Route lookup itself
  must be counted in the complete latency budget.
  Use the namespace-wide reservation in the existing Console authority.
  Prove the relationship between the assigned home and the
  actual D1 resource; a lane-level activation CAS or copied identity row is
  insufficient. Preserve authenticated provisioning before first activation.
  The [home identity design](refactor-152-ownership-review.md#home-identity-verification-design)
  specifies provider binding/version inspection plus a fresh database challenge
  through the runtime service. Resource verification and end-to-end provisioning
  race/failure checks remain open; its runtime identity lookup must be included
  in latency accounting.
- [ ] Complete APAC/WEUR selection policy and regional deployment routing.
  Automatic immutable resource assignment now runs after authenticated proof
  from both configured writers, with concurrent first-time requests verified.
  Browser hints are advisory input;
  browser assertions cannot select an alternative authority. Avoid a mandatory
  home picker, travel profiling, and automatic geographic migration.
- [ ] Implement regional Gateways paired with the assigned D1 homes, initially
  APAC and WEUR. Reuse existing Gateway deployments where possible, bind each to
  its authoritative database, and configure execution placement near that home.
  Route requests through trusted namespace/deployment bindings so a Tokyo client
  using a WEUR namespace reaches its WEUR Gateway. Reuse existing hostname/service
  routing; introduce an additional global routing Worker only if that routing
  cannot select the assigned Gateway. Verify actual execution placement, preserve
  custody-role identities, and measure Gateway-to-DO and Console dependencies.
  D1 home assignment alone does not place the Gateway or custody DOs. Keep this
  work subject to the isolated-experiment and production-rollout gates.
- [ ] Verify every entry point reaches the same home: Gateway, role RPC,
  recovery, linking, revocation, quota administration, scheduled work, and replay.
  Fail closed when authoritative routing or the home is unavailable. Any redirect
  must be bounded and validated before credentials are sent onward.

## Existing-wallet migration: excluded from this rollout

On October 2 the user confirmed that all existing wallets are disposable test
wallets. Existing-wallet state transfer, transfer rollback, custody relocation
and migration compatibility are outside R152's release scope. Use fresh
namespaces and wallets for the APAC/WEUR rollout. Preserve one authoritative
home for each new namespace and reject stale or conflicting assignments.
A reset may discard the designated test wallets; this scope decision does not
require deleting databases immediately or weakening quota/replay enforcement.

## Phase 5: verification and rollout decision

- [ ] Reuse behavioral E2Es for concurrent last-quota contention, duplicate
  admission, lost finalize responses, exact replay, revocation, material
  retirement, recovery, and second/third-generation device linking.
- [ ] Add regional routing scenarios with the same operation concurrently sent
  through two entry regions and a stale home. Verify one quota consumption,
  one custody effect, exact replay, and refusal of wrong tenant/environment data.
- [ ] Measure travel latency using the same WEUR wallet from Europe and Tokyo,
  holding Gateway, D1 and custody placement and build identities fixed. Repeat
  for an APAC home with local and remote clients. Separate browser-to-home round
  trips from internal D1, custody RPC and Console costs; cover ready-material
  signing and cold unlock/first sign. Alternate client order, retain failures,
  verify signatures and report distributions. Confirm remote client location
  never changes the writable home or causes fallback to another database.
- [ ] Exercise shared behavior on Workers D1, wallet-DO composition, and the VM
  reference when shared contracts change. Keep placement in the deployment
  adapter. Use existing type fixtures for domain-state guarantees; add no unit
  tests or source-text guards.
- [ ] Produce repeatable evidence with deployment/build identities, routing
  generations, placement evidence, redacted traces, verified signatures, quota
  and replay outcomes, latency distributions, cost, and cleanup records.
- [ ] Review a concrete rollout: measured gain, operational cost, chosen owner,
  migration scope, failure behavior, staged cohort, and rollback procedure.
  Production activation is a separate decision after these gates pass.

## Deferred follow-up: lifecycle D1 call budgets

Requested October 1, 2026. Perform this audit later, before the next lifecycle
query-reduction implementation. Numeric targets remain unset until their
required state transitions and freshness boundaries have been analysed.

- [ ] Inventory unlock, signing, wallet recovery, key export, registration,
  device linking, auth-method addition/revocation, session status/refresh,
  recovery-code rotation and background material refill. Split passkey/Email OTP,
  ECDSA/Ed25519, owner/linked devices, cold/warm state and explicit lane selection
  where their work differs. Distinguish lost-activation-response recovery from
  recovery-code-based wallet recovery.
- [ ] Establish a reproducible baseline for each supported flow using existing
  behavioral E2Es and request-level traces. Count foreground Gateway D1 calls,
  Console D1 calls, other-service D1 calls, sequential dependency depth, SQL
  statements, write-bearing calls and reported row writes separately. Attribute
  background/refill overlap separately; keep unknown or unmeasured values explicit.
- [ ] Map each call to its invariant and decision point. Derive a justified
  lower-bound estimate, a practical next target and any stretch target from
  join/batch opportunities and removable duplicate work. Preserve fresh authority,
  revocation/expiry, exact scope, one-use proofs/material, quota contention,
  durable replay and key-identity guarantees. A necessary check need not imply
  a separate network call; a lower call count does not imply fewer durable writes.
- [ ] Publish one tracking table in the results docs: flow/variant, build and
  evidence, measured baseline, proposed target/range, assumptions/confidence,
  required writes, blockers, next optimization and latest verified result.
  Give success, exact replay, rejection and interrupted/retried flows separate
  budgets. Label design estimates explicitly; do not present them as measured
  results or proven theoretical minima.
- [ ] Prioritize by avoidable sequential wall time, frequency and implementation
  risk. Implement later in bounded changes and update the table with repeatable
  before/after E2E artifacts. Recheck the relevant race/replay/revocation scenarios
  and preserve frozen regional cohorts when a candidate changes.

## Completion

The investigation is complete when it records a reproducible placement result
and a justified ownership decision. Regional implementation is complete only
after its ownership, failure, correctness, latency, and rollout gates pass.
Keep unproven regions and deferred migration work visible; a region label or
lower SQL latency alone cannot close this plan.

### October 3: deployment resource proof cleanup

- [x] Replace the active namespace-home challenge table, endpoint, operator command
  and checkpoint shape with deployment-resource contracts. Signer migration 0042
  renames the table and replaces its index; earlier migrations remain ordered history.
- [x] Verify independent physical resources for the same tenant, cross-resource proof
  rejection, stale writers, expiry and lost-response cleanup in the Worker E2E.
- [ ] Replace the singular binding/activation resource with the complete admitted
  US/WEUR/APAC backend set and render all regional bindings. The resource-proof
  cleanup does not complete this activation change.

Remaining implementation order: regional deployment-set admission/rendering; shared
credential, recovery and opaque-token locators; direct/internal/deferred home
checks; expiry reconciliation and fresh attempts; composed regional and hosted
travel verification. Release 0.8.0 remains held. See the release review for evidence.

### October 3: verified resource-set activation

Private commit `af96653` replaces the singular binding and activation contract.
Three-resource/six-writer admission, rejection and migration behavior pass local
Worker/D1 E2Es. Remaining deployment work is orchestration/rendering and version
renewal, followed by shared locators, internal/deferred enforcement, expiry and
fresh-attempt reconciliation, and composed hosted/travel acceptance. The final
three focused E2Es passed in 18.9s, a local test duration. See the release review
for precise evidence and limits; this does not enable deployment or release.

### October 3: deployment admission renewal

Private implementation commit: `20eb4aa` on `seams-monorepo/dev`.

Explicit protected activation now validates the complete resource-proof set even
when tenant identity and public surfaces match the active binding. It creates a
new activation and admits its exact writer versions while preserving the existing
managed browser credential. `reuse_active` remains a read-only lookup. Root and
credential failures terminate unfinished cutovers; a committed activation with a
lost reply keeps its active credential.

The composed local renewal E2E verifies six replacement writers, rejection of six
previous versions, incomplete-proof rejection, a root-service outage followed by
successful retry, repeated revoked-key rejection without a stuck lane, and lost
activation-reply cleanup. Evidence and scope limits are in the results document.
Regional configuration, complete-set proof collection and regional readiness still
come next; shared locators, internal/deferred enforcement, expiry/fresh attempts
and composed hosted/travel verification remain. No deployment or release occurred.

### October 3: regional readiness checkpoint

Private implementation commit: `0c4b923` on `seams-monorepo/dev`.

Hosted readiness now inspects every resource through explicit US/WEUR/APAC Runtime
bindings and verifies each response's resource identity. The composed E2E uses three
actual Runtime Workers and separate local D1s; it blocks renewal for an APAC live
ceremony or outage and verifies aggregate counts and cross-resource rejection.
Three focused E2Es passed in 45.5s. Evidence and fixture limits are recorded in
`refactor-152-results.md` under the matching checkpoint.

Next: canonical regional target configuration, generated Gateway/Runtime service
bindings and complete-set operator proof collection. The renderer does not yet emit
the required regional Runtime bindings. Shared locators, internal/deferred home
checks, expiry/fresh attempts and composed hosted/travel verification follow.
No deployment or release occurred; 0.8.0 remains held.

### October 3: regional challenge selection

Private implementation commit: `51ddb3b` on `seams-monorepo/dev`.

One Console now challenges any exact resource in its regional catalog through the
corresponding fixed Gateway/Runtime bindings. Required resource identity replaces
Console's former single-D1 challenge selection. Three local D1s and six actual
writer versions pass the expanded E2E; unknown/cross-resource/foreign-namespace
requests fail. Three focused E2Es passed in 21.6s; see the matching results checkpoint.

Next remains canonical regional configuration and generated service bindings,
then complete-set operator proof collection. The CLI still selects one configured
resource. Shared locators, internal/deferred enforcement, expiry/fresh attempts and
hosted/travel acceptance follow. Deployment and 0.8.0 remain held.
