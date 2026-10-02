# Per-wallet placement implementation inventory

Date: October 2, 2026. This inventory supplements the
[replacement checklist](refactor-152-regional-D1.md#authoritative-replacement-phase-per-wallet-regional-homes).
It records the current schema and known ownership seams. Route-by-route and
cross-authority reconciliation review remains in progress; this is not a completed
partition proof or permission to enable regional routing.

## First implementation slice

Private Console now has `walletPlacement/{home,d1}.ts` and migration
`0051_wallet_homes.sql`. Its ownership key exactly matches the current `wallets`
primary key: namespace, organization, project, environment, wallet ID. Registration
operation uniqueness has that same tenant scope. A competing retry for the same
wallet/registration retains the first committed home even if its proposed region
changes. A different wallet using the same registration ID conflicts; a different
registration claiming the same wallet conflicts. Terminal cancellation preserves
the reservation and prevents a late completion from establishing it elsewhere.

The directory is an internal persistence primitive. Its inputs must come from the
authenticated placement service; parsing a key or resource does not authenticate
it or prove deployment admission. Hosted entrypoints are not switched yet.
The old namespace reservation gate and its adoption route were removed from
Console code and the effective schema by private migration `0052`; deployment
resource verification remains. Hosted Gateway and Wallet Runtime still use one
signer D1 binding per lane, so no wallet request uses the new directory yet.
No migration or deployment has been run against hosted databases.

The private `wallet-home-directory.e2e.test.ts` uses two Worker transports and
persistent local D1. It verifies three regions in one tenant with different
registration orders; concurrent retries across regions; conflicting wallet and
registration IDs; lost reply and restart; stable completion; cancelled attempts;
project isolation; and rejection of SQL update/delete/replace. Its JSON receipt
records source bundle/migration hashes and final rows. It measures no geographic
latency and does not prove registration or signing integration.

Private implementation commit: `f93c015` on `dev`. Verification passed:
Console server type-check, all private type fixtures, focused ESLint, and the
new directory E2E (2.2 seconds). Reproduce with:

```sh
pnpm -C packages/wallet-console-server-ts type-check
pnpm -C tests type-check:fixtures
pnpm -C tests test:relayer wallet-home-directory.e2e.test.ts
```

Retained private evidence:
`.artifacts/r152/per-wallet-directory-20261002/wallet-home-evidence.json`.

## Registration replay checkpoint

Private commit `8da3c38` adds required request-digest and allocation-mode binding
to the directory. A caller-supplied wallet ID must match the existing reservation;
a server-allocated candidate may lose a race and reuse the winner's wallet ID.
Different generated candidates for the same operation converge on one wallet and
home. A generated candidate that collides with another operation is rejected so
the allocator can generate a new candidate without replacing that wallet.

The digest is a lowercase SHA-256 hex value persisted with the registration ID.
The authenticated registration boundary must compute it from the canonical
normalized request and verified caller/origin context. Never accept a browser's
declared digest as proof of request equality. Exclude transient ingress location
and the uncommitted server-generated candidate, so travel and allocation races
can replay the original request. Persisted allocation mode prevents switching a
provided-ID request into a generated-ID retry. Completion checks the same digest.

The expanded directory E2E passed (2.4 seconds): nine concurrent generated-ID
candidates across two Worker transports converge; changed digest/allocation mode
conflicts; collision retry, response loss, restart and different-region replay
retain the winner; a mismatched completion leaves the reservation pending; SQL
cannot change the digest even as part of an otherwise valid lifecycle transition.
Server type-check, all private type fixtures and focused ESLint passed. All 28
Console migration files also applied to empty SQLite with clean integrity and
foreign-key checks. The undeployed `0051` baseline was updated in place; no
hosted database has received either version.

The reservation now also stores the first committed setup allocation: ceremony,
preparation, founding authority, device and auth-method IDs. Later candidates
for the same registration receive that exact allocation, including after a
lost reply and authority restart. Its five fields are immutable in D1 and
parsed at the boundary. The persistent-D1 E2E and type fixtures pass. This
allocation is not yet called by hosted registration; it closes only the
directory's replay-data gap.

Retained private receipt: `.artifacts/r152/setup-allocation-20261002/wallet-home-evidence.json`.
Reproduce with `pnpm -C tests test:relayer wallet-home-directory.e2e.test.ts`.

Reproduce with the same commands above. Retained private receipt and logs:
`.artifacts/r152/registration-reservation-20261002/`.

### Next integration boundary

The directory still has no hosted caller. Before enabling routing, registration
setup must supply a stable request ID and compute the digest after credential,
origin and request validation. It must use the winning wallet/home and stored
ceremony/founding-authority identities before any custody preparation. Retrying
only the directory reservation does not make custody preparation or the regional
ceremony write idempotent. Both supplied-ID and Google candidate-selection
paths must adopt the same contract. Shared credential/recovery routing indexes
and their transaction reconciliation remain open, followed by hosted routing
replacement. This checkpoint does not close those gates.

### Configured-resource admission checkpoint

Private commit `1586f68` adds a three-region resource catalog and an internal
Console service-binding endpoint for finding, reserving and completing wallet
homes. A reservation supplies a region decision; Console selects the configured
US, WEUR or APAC D1 resource itself and rejects an arbitrary database UUID.
The first committed choice remains immutable across a retry from another
region. The endpoint validates its request at the boundary and uses Console D1
for the same transactional directory. An ingress selector is available to read
Cloudflare's `request.cf` metadata and ignores app-supplied region hints. The
service is mounted on the private Console Worker but **has no hosted Gateway
caller yet**, and its catalog has not been added to deployment rendering. No
regional wallet execution or geographic latency claim follows from this step.

The persistent two-Worker E2E now covers the service path, a conflicting
completion, an unadmitted resource, and app-hint spoofing. Console type-check,
type fixtures and focused lint pass. Reproduce with
`pnpm -C tests test:relayer wallet-home-directory.e2e.test.ts`; retained receipt:
`.artifacts/r152/service-admission-20261002/wallet-home-evidence.json`
(SHA-256 `2578c099785196bbdd70d124b10f52ec7c40d38e23916910e66809ff686f84f2`).
Private review commit `30d0f9c` makes an absent catalog return a fail-closed
503 and rejects unknown internal paths before parsing request bodies.
Private commit `df3eb53` binds each service request to the active deployment's
exact tenant scope and applies its existing registration pause before a
reservation. The same E2E rejects a cross-project request and a paused setup;
private `pnpm check` passes. These controls do not replace the missing hosted
Gateway caller, verified regional resource set, or shared lookup authority.

Private commit `df7dda5` makes ceremony IDs unique across a namespace and adds
an internal, tenant-scoped ceremony-to-home lookup for registration continuations
that have no wallet ID. A duplicate ceremony cannot replace another reservation.
A cancelled registration now rejects a setup retry and cannot be resolved for a
continuation. The persistent two-Worker E2E, Console type-check, type fixtures,
focused lint and formatting checks passed. Receipt:
`.artifacts/r152/service-admission-20261002/wallet-home-evidence.json`
(the receipt was refreshed by the cutover-admission checkpoint below).
The lookup is still unused by hosted traffic.
Private commit `9792bca` requires placement service calls to present the active
Gateway or Wallet Runtime role and exact authorized Worker version. The real
Console Worker E2E rejects missing and stale versions with 403 and accepts an
active-version reservation. Its retained receipt is
`.artifacts/r152/wallet-home-writer-admission-20261002/wallet-home-writer-admission.json`
(SHA-256 `5242020ee7a9bc7718250714e50285b115818fb4657e86396ada730f6e0f75b0`).
The package still has no production caller, and the existing singular deployment
resource binding has not been replaced with a regional resource set.
Private commit `d923391` closes a setup-admission race: the cutover pause is
checked in the same Console D1 statement that inserts a wallet reservation.
The service also rejects an existing reservation replay while setup is paused.
The directory E2E now applies every Console migration and tests both paused
new setup and paused replay. The two focused Worker E2Es and private `pnpm check`
pass. Refreshed directory receipt SHA-256:
`d90c1e5b2422b98772f80aab2223caf253de7be93a735c154f43cba4866864fe`.

Private commit `9f8921a` adds a service client that revalidates JSON assignments
into the wallet, home and setup-allocation domain types, checks tenant scope
and the configured resource catalog, and sends the active writer role/version
on each request.
The same two-Worker E2E exercises reserve, wallet and ceremony lookup, missing
wallet, cross-project rejection and completion through that client. It still
has no hosted Gateway caller. Refreshed receipt SHA-256:
`6d5a5d1e0f4fdfda1e47d95e753454214bc767aa7065c34d7cdd6847c9b9d803`.
Private commit `5ce1c27` adds a lost-response replay to that two-Worker path.
The first generated candidate commits in WEUR, its client response is discarded,
and a retry proposes a different wallet and US ingress. The service returns the
first wallet, WEUR home and setup allocation.

## Namespace assignment removal checkpoint

The private Console no longer reserves one database for a whole namespace.
`0052_drop_namespace_placement.sql` removes the old table and activation trigger
from the effective schema. Activation still checks the canonical binding resource
and a fresh proof from both serving Workers. The historical binding-home adoption
endpoint, operator mode, parser, persistence conversion and tests of namespace
exclusivity were deleted. The parsed deployment resource identity has its own
name, separate from a wallet home.

Focused E2Es passed for regional writer challenges, binding reads/activation,
and three independent wallet homes in one tenant. Console, fixture and shared
type checks and private `pnpm check` passed. This does not close R1–R7: the
hosted registration path, lookup indexes, wallet-local routing and regional
deployments still require implementation and verification.

## Authority and transaction seams

| Boundary | Current invariant and replacement obligation |
| --- | --- |
| Wallet identity | `wallets` uses all five ownership-key fields. Preserve this scope; a namespace is not a home. |
| External identity | `identity_links` has a tenant-scoped subject primary key. Keep one shared authority for claiming each subject and resolving its wallet. |
| Passkeys | `webauthn_credential_bindings` uniquely binds tenant + RP + credential; authenticator counters and wallet auth methods remain wallet-local. Reserve shared binding before committing the regional method and reconcile completion. |
| Email enrollment | The effective enrollment primary key is tenant + wallet. Its provider index is non-unique: do not invent a one-provider/one-wallet constraint. Discovery must preserve supported multiple-wallet selection. |
| Rate limits | Email OTP `rate_key` includes several scopes; keep shared IP/provider/project consumption authoritative across regions. Classify wallet-only keys before moving any counter. |
| Signing policy | `router_ab_normal_signing_admission_records` mixes `project_policy`, `abuse` and `quota`. Its current SQL joins project and abuse decisions; separate shared policy evaluation from wallet-local operation/quota mutation explicitly. |
| Session admission | The operation-claim trigger reads wallet authorities, methods, sessions and quotas and writes operation/audit state. Keep this batch and trigger together at the wallet home. Preserve the 0041 step-up expiry check. |
| Recovery | `commitRegistration` atomically inserts custody envelope, recovery set, backup acknowledgement and locator rows. Recovery-set rotation atomically checks collisions, removes old locators and inserts replacements. Shared routing locators need durable reservation and regional commit reconciliation; a remote insert cannot be substituted into the current D1 batch. |
| Linked devices | Session CAS, target credential reservation, authority installation, delivery and retirement share wallet-local transactions. Pre-wallet link-session creation still needs an explicit routing identity before wallet approval. |
| Opaque session/exchange tokens | Local lifecycle parent triggers must remain with session rows. Gateway lookup without wallet ID needs a verified routing envelope or authoritative index before regional access. |
| Vault | `vault_proxy_secrets` is keyed by namespace + tenant + vault + item, with no wallet identity. Keep its existing shared tenant authority; never infer wallet ownership from a capability ID. |
| Tenant-root control | Creation, restore, backup and prewarm can occur before any wallet exists. Keep explicit tenant-scoped control authorization separate from wallet execution. |

Cross-authority completion must be idempotent: reserve shared identity, commit the
wallet-local mutation once, then acknowledge the exact regional receipt. An
interruption leaves a pending claim that blocks conflicting ownership until
reconciliation; it must never make an uncommitted credential usable. Reconciliation
must verify the operation identity and regional outcome before publishing or
releasing an index entry. The exact service contracts remain an open inventory item.

### Invariant-to-authority cutover matrix

| Invariant | Present atomic owner | Target owner and transaction boundary |
| --- | --- | --- |
| Wallet ID and registration-operation uniqueness | One signer D1 plus the new Console directory, which hosted setup does not yet call | Console wallet directory commits wallet/home/setup identity before Router preparation. A regional ceremony uses that allocation only. |
| Passkey credential uniqueness and discoverability | Signer D1 `webauthn_credential_bindings`; local `webauthn_authenticators` tracks counters | Console reserves tenant + RP + credential and resolves it to a wallet; wallet home commits the method and counter. Publish the shared locator only after a verified regional receipt. |
| Google/provider subject and Email OTP offer selection | Signer D1 `identity_links`, `email_otp_registration_attempts` and enrollment rows | Shared identity authority owns subject-to-wallet links and offer candidates. The selected wallet is reserved once; regional enrollment remains wallet-local. Preserve supported multiple-wallet discovery. |
| IP, user, wallet, provider and organization Email OTP limits | Signer D1 `email_otp_rate_limits`; `consume` walks each generated key sequentially | Keep every rate key in one shared authority during the cutover, including wallet-keyed counters. Challenge/grant state stays at home; region count cannot multiply an allowance. Define retry identity before changing consumption semantics. |
| Project signing policy and wallet-scoped abuse decision | Signer D1 `router_ab_normal_signing_admission_records`; a SQL read joins `project_policy` and wallet-keyed `abuse` records to a session | Shared authority owns current project policy. The wallet home owns its wallet-keyed abuse decision and claims one session operation and quota. A policy admission must carry exact scope, decision/version and expiry into the local claim. |
| Wallet signing quota, authorization and one-use owner proof | Signer D1 `authorization_wallet_session_quotas`, `authorized_operations`, `verified_owner_proof_consumptions` and their triggers | One wallet home owns quota decrement, operation claim/completion, replay and proof consumption in the same local batch. Never replicate a quota independently across regional databases. |
| Auth-method revocation | Signer D1 wallet authority/method rows and credential lookup | Wallet home commits revocation and session invalidation. Shared credential routing entry must be retired or marked inactive only against an exact regional receipt; stale lookup cannot authorize a revoked method. |
| Recovery code locator uniqueness and one-use consumption | `d1WalletCustodyCommitStore` inserts envelope, recovery set, acknowledgement and locators in one D1 batch; rotation removes old locators and inserts replacements in that batch | Console reserves routing locators before regional commit. Wallet home keeps recovery wraps, held-code consumption and replacement authority atomic. Reconciliation publishes/retire locators only after the exact home receipt, with pending claims blocking duplicates. |
| Hosted exchange, linked delivery and other opaque one-use IDs | Signer D1 parent/child lifecycle rows and triggers | A shared lookup or authenticated envelope resolves the parent wallet; issuance, redemption, acknowledgement and retirement remain one-use at the wallet home. Lookup alone cannot consume or authorize the bearer. |

The matrix identifies the transaction cuts. The shared reservation/commit
interfaces and failure reconciliation for passkeys, recovery locators, policy
and rate limits still need implementation before the signer database can split.
Moving only wallet-keyed Email OTP counters to regional D1 would split the
current multi-key `consume` operation and create partial-consumption behavior
across databases. Keeping the whole rate-limit table shared is the smaller
initial change; its existing sequential-key behavior remains a separate
write/roundtrip optimization target.

## Registration and no-wallet-ID entrypoints

| Source (public unless labelled private) | Current behavior / required change |
| --- | --- |
| `d1WalletRegistrationService.setupWalletRegistration` | Allocates wallet ID, founding auth method, ceremony and preparation IDs before custody preparation. No durable client request key currently binds an initial setup retry. Introduce one boundary-normalized registration identity before regional effects and keep allocated IDs stable. |
| `d1WalletRegistrationSetup.resolveWalletRegistrationSetupWalletId` | Supports supplied and server-allocated wallet IDs. Both need the shared reservation. |
| `d1GoogleEmailOtpSessionResolver.createFreshRegistrationAttempt` | Offers locally checked candidate wallets before selecting one. Shared authority must own offers/selection and existing-provider discovery; only the selected wallet gets its permanent home. |
| `walletRegistrationSetupPayload` | Setup claims bind ceremony, wallet and signing context. Bind the reserved home/operation in the verified continuation context. |
| `d1WebAuthnStore` | Credential/RP lookup may precede wallet identity. Resolve the shared binding; verify proof at the selected home. |
| `d1WalletCustodyCommitStore` / recovery routes | Recovery locator lookup needs shared routing but held proof, consumption and custody mutation remain wallet-local. |
| Hosted session exchange and linked delivery | Opaque code/session identifiers require a routing index or verified envelope; never query all regional databases. |
| Private `d1WalletRuntimeWorker` | Wallet-identities operation accepts multiple wallets. Group by their resolved homes and combine only validated responses; relayer account and tenant-root operations retain explicit tenant scope. |
| Private `d1GatewayWorker` / scheduled prewarm | Replace namespace binding with per-wallet admission for wallet requests; prewarm stays explicit tenant control. Preserve role/version/resource admission. |

### Registration operation IDs and first durable write

| Entry path | Current replay identity | Gap and required cutover behavior |
| --- | --- | --- |
| SDK direct passkey ECDSA or mixed registration | Volatile `finalizeIdempotencyKey`, created before setup and used by activation | Persist one pre-setup operation ID; a lost setup reply must replay the same Console reservation and regional preparation. |
| SDK direct Email OTP Ed25519-only registration | Volatile `finalizeIdempotencyKey`, created before setup | Use the same pre-setup operation contract; the Email OTP authority and selected wallet must remain bound through retry. |
| SDK direct passkey Ed25519-only registration | Volatile `finalizeIdempotencyKey`, created before setup | Use the same pre-setup operation contract and recover the same ceremony identity. |
| Hosted passkey preparation (`prepareHostedPasskeyRegistration`) | `authMenuSessionId` and `requestId` own the in-memory prompt; the finalization key is created only when registration continues | Create and durably record the setup operation before hosted preparation. Cancellation must close its reservation; a restarted UI must identify the prior attempt explicitly. |
| Low-level `setupWalletRegistration` client and `/wallets/register/setup` route | No setup operation ID on the wire | Require a stable ID from the caller; validate it at the authenticated route and bind it to the normalized request and Origin. |
| Google Email OTP registration offer | Durable `registrationAttemptId` and `ownerProofBindingDigest`; `restartRegistrationOffer` abandons an offer intentionally | Keep the offer and candidate uniqueness in shared authority. The selected candidate must use one setup operation and one permanent wallet/home reservation. |

`/wallets/register/setup` currently has no request-carried setup operation ID.
The route validates the publishable key, exact Origin, environment and body,
then calls `setupWalletRegistration`. That service generates a wallet ID for the
server-allocated branch, founding authority/auth-method IDs, ceremony and
preparation IDs in memory before custody preparation and ceremony persistence.
`buildD1EvmFamilyEcdsaRegistrationPrepare` can call the Router before
`putCeremony` makes the current local setup durable. This ordering must change
when the shared reservation is installed.
The browser-side `finalizeIdempotencyKey` is generated before setup in each
registration branch, but currently binds **finalization only** and is not
persisted across a browser restart. Reusing its string as a setup key without
a durable browser operation journal would not repair a lost setup response.
The SDK already has generic IndexedDB `appState` storage. Its pending-registration
commit journal starts after setup, so a pre-setup operation record belongs in
that existing store with its own precise lifecycle and cleanup.

The Console directory reservation must be the first durable wallet/home
allocation for both supplied and generated wallet IDs. The hosted setup
boundary must derive the request digest from the verified tenant, Origin and
normalized request, reserve once, and use the winning wallet, home and five
stored setup IDs before regional custody preparation. The setup operation ID
must survive response loss
and browser restart; a replay must return the winning allocation. Setup effects
and ceremony persistence need their own idempotent continuation, because a
directory replay alone cannot prove that regional preparation committed.
If a reply is lost before the directory commits, replay may propose a fresh
candidate. If it is lost after commit, replay must receive the stored wallet,
home and setup IDs. If regional preparation ran but the ceremony write did not,
the stored preparation ID must resume or reconcile that exact Router operation.
Once a ceremony exists, replay reads and verifies it before returning its
original identity. Expired or cancelled operations return a terminal outcome;
they never select a new home for the same wallet.

Google Email OTP has an additional durable `registrationAttemptId` and
`ownerProofBindingDigest`. `findStarted` reuses an active offer for the same
verified provider/binding, while `createFreshRegistrationAttempt` checks up to
30 candidate wallet IDs against its current D1 and stores an offer with up to
five candidates. Those local collision checks cannot establish global
uniqueness after regional splitting. Preserve the offer/selected-attempt
identity in shared authority, then reserve only the selected wallet's home.

### Hosted route and deferred-work admission map

The source of truth for public route names and auth policy is
`packages/wallet-server/src/router/framework/routeDefinitions.ts`; the private
Gateway calls `handleSplitGatewayRequest` after resolving one active deployment
binding. The groups below identify the routing identity required **before** a
regional store is opened. They do not claim that proof or home enforcement has
already been implemented.

| Entrypoint family | Initial identity | Required home resolution and failure |
| --- | --- | --- |
| Registration setup | Verified publishable-key tenant, Origin, stable setup operation; supplied wallet ID or generated candidate | Reserve through Console first. A changed digest conflicts; no regional preparation on unavailable authority. |
| Registration respond, activate and NEAR continuation | Signed setup/ceremony or preparation identity | Resolve the Console ceremony index, then verify its wallet/home against signed claims before regional mutation. Unknown/cancelled ceremony fails. |
| `/wallets/:walletId/*` custody, signer, auth-method and recovery status | Path wallet ID plus route proof/session | Resolve tenant-scoped wallet directory, then verify proof at its home. A body/path disagreement fails before effects. |
| Unlock and discoverable passkey | Challenge, credential or verified provider identity, sometimes no wallet ID | Resolve shared credential/provider binding to one wallet; then resolve its home. Never search regional D1s. |
| Recovery prepare/finalize and code locator | Recovery code locator or server-issued recovery operation | Resolve shared locator/operation index, retain one-use proof and custody commit at wallet home. Missing/conflicting index fails without revealing wallet existence. |
| Hosted session exchange and linked-device delivery | Opaque session, exchange code or link-session identity | Resolve a shared index or authenticated routing envelope; verify parent wallet and home before opening local lifecycle rows. |
| Ed25519/ECDSA signing, export, refresh and pool-fill | Exact wallet session/capability or wallet ID | Resolve and verify wallet home once at Gateway admission; carry the bound context through Router/DO RPC and deferred continuation. |
| Wallet Runtime service operations | Wallet ID or a list of wallet IDs; some tenant-root controls have none | Resolve each wallet independently and group by home; tenant-root control uses its own authenticated tenant authority. |
| Scheduled prewarm, retry, refill, alarm and queue work | Persisted wallet operation/session or tenant-root control identity | Wallet work carries its original home. Control work uses explicit tenant scope. No current client location is available or relevant. |
| Public health, keyset and well-known routes | No wallet | Serve without wallet state under their existing public policy. |

`router_ab_normal_signing_admission_records`, `email_otp_rate_limits`,
`webauthn_credential_bindings`, recovery locators and hosted exchange parents
remain the critical mixed/shared seams. Each needs a concrete owner and an
idempotent cross-authority sequence before splitting the current signer D1.
The route-by-route and role-RPC inventory remains open in R0.

## Effective signer schema

Applied all 41 ordered migrations to empty SQLite. The effective schema contains
55 application tables, 64 explicitly named indexes and 30 triggers. SQLite's
automatic constraint indexes are excluded from that index count. `quick_check`
returns `ok`; `foreign_key_check` returns no violations. Table ownership below is
the intended destination, with mixed tables explicitly requiring a split review.
Indexes and triggers remain attached to their listed table; cross-table trigger
bodies must be reviewed before splitting any of their dependencies.

| Table | Intended authority |
| --- | --- |
| `authorization_wallet_session_quotas` | Wallet home (including its local transactional guards) |
| `authorized_operation_audit_events` | Wallet home (including its local transactional guards) |
| `authorized_operations` | Wallet home (including its local transactional guards) |
| `email_otp_auth_states` | Wallet home (including its local transactional guards) |
| `email_otp_challenges` | Mixed lookup/policy/lifecycle responsibilities; split review required |
| `email_otp_grants` | Wallet home (including its local transactional guards) |
| `email_otp_rate_limits` | Shared tenant/identity authority |
| `email_otp_registration_attempts` | Shared tenant/identity authority |
| `email_otp_unlock_challenges` | Wallet home (including its local transactional guards) |
| `email_otp_wallet_enrollments` | Mixed lookup/policy/lifecycle responsibilities; split review required |
| `identity_links` | Shared tenant/identity authority |
| `lane_cas_guard` | Wallet home (including its local transactional guards) |
| `lane_effect_journal` | Wallet home (including its local transactional guards) |
| `lane_enrollments` | Wallet home (including its local transactional guards) |
| `lane_locks` | Wallet home (including its local transactional guards) |
| `lane_product_epochs` | Wallet home (including its local transactional guards) |
| `lane_protocol_operations` | Wallet home (including its local transactional guards) |
| `lane_receipts` | Wallet home (including its local transactional guards) |
| `linked_device_authority_allocations` | Wallet home (including its local transactional guards) |
| `linked_device_authority_installations` | Wallet home (including its local transactional guards) |
| `linked_device_ed25519_export_root_transfers` | Wallet home (including its local transactional guards) |
| `linked_device_email_otp_grants` | Wallet home (including its local transactional guards) |
| `linked_device_request_proof_nonces` | Wallet home (including its local transactional guards) |
| `linked_device_session_cas_guard` | Wallet home (including its local transactional guards) |
| `linked_device_session_transcripts` | Wallet home (including its local transactional guards) |
| `linked_device_sessions` | Wallet home (including its local transactional guards) |
| `linked_device_target_commit_reservations` | Wallet home (including its local transactional guards) |
| `linked_device_target_credentials` | Wallet home (including its local transactional guards) |
| `linked_device_wallet_session_credential_deliveries_v1` | Wallet home (including its local transactional guards) |
| `namespace_home_challenges` | Deployment resource proof; replace namespace ownership terminology |
| `near_public_keys` | Wallet home (including its local transactional guards) |
| `registration_ceremony_cas_guard` | Wallet home (including its local transactional guards) |
| `registration_ceremony_records` | Wallet home; classify every dynamic record prefix and pre-wallet allocation |
| `router_ab_normal_signing_admission_records` | Mixed lookup/policy/lifecycle responsibilities; split review required |
| `router_ab_yao_capability_replacements` | Wallet home (including its local transactional guards) |
| `router_ab_yao_versioned_json_cas_guard` | Wallet home (including its local transactional guards) |
| `router_ab_yao_versioned_json_records` | Wallet home; classify every dynamic record prefix and pre-wallet allocation |
| `vault_proxy_secrets` | Shared tenant/identity authority |
| `verified_owner_proof_consumptions` | Wallet home (including its local transactional guards) |
| `verified_wallet_operation_evidence_sets` | Wallet home (including its local transactional guards) |
| `wallet_auth_method_revocation_replays` | Wallet home (including its local transactional guards) |
| `wallet_auth_methods` | Wallet home (including its local transactional guards) |
| `wallet_authorities` | Wallet home (including its local transactional guards) |
| `wallet_authority_cas_guard` | Wallet home (including its local transactional guards) |
| `wallet_ecdsa_pending_session_activations` | Wallet home (including its local transactional guards) |
| `wallet_recovery_code_locators` | Mixed lookup/policy/lifecycle responsibilities; split review required |
| `wallet_session_authorizations_v2` | Wallet home (including its local transactional guards) |
| `wallet_session_hosted_credentials_v2` | Wallet home (including its local transactional guards) |
| `wallet_session_hosted_exchange_codes_v2` | Wallet home (including its local transactional guards) |
| `wallet_signers` | Wallet home (including its local transactional guards) |
| `wallets` | Wallet home (including its local transactional guards) |
| `webauthn_authenticators` | Wallet home (including its local transactional guards) |
| `webauthn_challenges` | Mixed lookup/policy/lifecycle responsibilities; split review required |
| `webauthn_credential_bindings` | Shared tenant/identity authority |
| `yao_lifecycle_decisions` | Wallet home (including its local transactional guards) |

### Effective index inventory

| Name | Table |
| --- | --- |
| `authorization_wallet_session_quotas_lifecycle_idx` | `authorization_wallet_session_quotas` |
| `authorized_operation_audit_fingerprint_idx` | `authorized_operation_audit_events` |
| `authorized_operations_tenant_fingerprint_idx` | `authorized_operations` |
| `authorized_operations_tenant_lifecycle_idx` | `authorized_operations` |
| `email_otp_challenges_context_idx` | `email_otp_challenges` |
| `email_otp_challenges_expires_idx` | `email_otp_challenges` |
| `email_otp_grants_expires_idx` | `email_otp_grants` |
| `email_otp_rate_limits_reset_idx` | `email_otp_rate_limits` |
| `email_otp_registration_attempts_subject_idx` | `email_otp_registration_attempts` |
| `email_otp_registration_attempts_wallet_idx` | `email_otp_registration_attempts` |
| `email_otp_unlock_challenges_expires_idx` | `email_otp_unlock_challenges` |
| `email_otp_wallet_enrollments_provider_idx` | `email_otp_wallet_enrollments` |
| `identity_links_user_idx` | `identity_links` |
| `idx_registration_ceremony_records_expiry` | `registration_ceremony_records` |
| `idx_router_ab_normal_signing_admission_expiry` | `router_ab_normal_signing_admission_records` |
| `idx_router_ab_yao_versioned_json_records_updated` | `router_ab_yao_versioned_json_records` |
| `idx_verified_wallet_operation_evidence_expiry` | `verified_wallet_operation_evidence_sets` |
| `idx_wallet_recovery_code_locators_wallet` | `wallet_recovery_code_locators` |
| `lane_enrollments_wallet_idx` | `lane_enrollments` |
| `lane_product_epochs_one_active_idx` | `lane_product_epochs` |
| `lane_product_epochs_wallet_active_idx` | `lane_product_epochs` |
| `lane_protocol_operations_enrollment_idx` | `lane_protocol_operations` |
| `linked_device_authority_allocations_authority_idx` | `linked_device_authority_allocations` |
| `linked_device_authority_installations_authority_idx` | `linked_device_authority_installations` |
| `linked_device_authority_installations_exact_identity_uidx` | `linked_device_authority_installations` |
| `linked_device_ed25519_export_root_transfers_enrollment_idx` | `linked_device_ed25519_export_root_transfers` |
| `linked_device_email_otp_grants_expiry_idx` | `linked_device_email_otp_grants` |
| `linked_device_email_otp_grants_session_idx` | `linked_device_email_otp_grants` |
| `linked_device_request_proof_nonces_expiry_idx` | `linked_device_request_proof_nonces` |
| `linked_device_session_transcripts_digest_idx` | `linked_device_session_transcripts` |
| `linked_device_sessions_state_idx` | `linked_device_sessions` |
| `linked_device_target_credentials_credential_idx` | `linked_device_target_credentials` |
| `linked_device_wallet_session_credential_deliveries_v1_lifecycle_idx` | `linked_device_wallet_session_credential_deliveries_v1` |
| `linked_device_wallet_session_credential_deliveries_v1_parent_idx` | `linked_device_wallet_session_credential_deliveries_v1` |
| `namespace_home_challenges_expiry_idx` | `namespace_home_challenges` |
| `near_public_keys_user_idx` | `near_public_keys` |
| `registration_completion_credential_inventory_idx` | `router_ab_yao_versioned_json_records` |
| `wallet_auth_methods_authority_identity_uidx` | `wallet_auth_methods` |
| `wallet_auth_methods_v2_authority_email_uidx` | `wallet_auth_methods` |
| `wallet_auth_methods_v2_email_provider_idx` | `wallet_auth_methods` |
| `wallet_auth_methods_v2_passkey_uidx` | `wallet_auth_methods` |
| `wallet_auth_methods_wallet_authority_status_idx` | `wallet_auth_methods` |
| `wallet_authorities_active_device_uidx` | `wallet_authorities` |
| `wallet_authorities_enrollment_uidx` | `wallet_authorities` |
| `wallet_authorities_inventory_idx` | `wallet_authorities` |
| `wallet_authorities_wallet_identity_uidx` | `wallet_authorities` |
| `wallet_session_authorizations_v2_active_exact_tuple_uidx` | `wallet_session_authorizations_v2` |
| `wallet_session_authorizations_v2_authority_idx` | `wallet_session_authorizations_v2` |
| `wallet_session_authorizations_v2_credential_lifecycle_idx` | `wallet_session_authorizations_v2` |
| `wallet_session_authorizations_v2_exact_identity_uidx` | `wallet_session_authorizations_v2` |
| `wallet_session_authorizations_v2_expiry_idx` | `wallet_session_authorizations_v2` |
| `wallet_session_authorizations_v2_method_idx` | `wallet_session_authorizations_v2` |
| `wallet_session_authorizations_v2_operation_credential_uidx` | `wallet_session_authorizations_v2` |
| `wallet_session_authorizations_v2_wallet_idx` | `wallet_session_authorizations_v2` |
| `wallet_session_hosted_credentials_v2_exact_identity_uidx` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_credentials_v2_expiry_idx` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_credentials_v2_parent_idx` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_exchange_codes_v2_expiry_idx` | `wallet_session_hosted_exchange_codes_v2` |
| `wallet_session_hosted_exchange_codes_v2_parent_idx` | `wallet_session_hosted_exchange_codes_v2` |
| `wallet_signers_chain_target_idx` | `wallet_signers` |
| `wallet_signers_wallet_idx` | `wallet_signers` |
| `webauthn_authenticators_user_idx` | `webauthn_authenticators` |
| `webauthn_challenges_expiry_idx` | `webauthn_challenges` |
| `webauthn_credential_bindings_user_idx` | `webauthn_credential_bindings` |

### Effective trigger inventory

| Name | Table |
| --- | --- |
| `authorized_operation_audit_claim` | `authorized_operations` |
| `authorized_operation_audit_complete` | `authorized_operations` |
| `authorized_operation_complete_atomic` | `authorized_operations` |
| `authorized_operation_grant_shape_guard` | `authorized_operations` |
| `authorized_operation_owner_grant_claim_atomic` | `authorized_operations` |
| `authorized_operation_step_up_claim_atomic` | `authorized_operations` |
| `lane_cas_guard_no_delete` | `lane_cas_guard` |
| `linked_device_session_cas_guard_no_delete` | `linked_device_session_cas_guard` |
| `linked_device_wallet_session_credential_delivery_acknowledgement_guard` | `linked_device_wallet_session_credential_deliveries_v1` |
| `linked_device_wallet_session_credential_delivery_cleanup_completion_guard` | `linked_device_wallet_session_credential_deliveries_v1` |
| `linked_device_wallet_session_credential_delivery_cleanup_receipt_guard` | `linked_device_wallet_session_credential_deliveries_v1` |
| `linked_device_wallet_session_credential_delivery_envelope_guard` | `linked_device_wallet_session_credential_deliveries_v1` |
| `linked_device_wallet_session_credential_delivery_identity_guard` | `linked_device_wallet_session_credential_deliveries_v1` |
| `linked_device_wallet_session_credential_delivery_insert_lifecycle_guard` | `linked_device_wallet_session_credential_deliveries_v1` |
| `linked_device_wallet_session_credential_delivery_lifecycle_guard` | `linked_device_wallet_session_credential_deliveries_v1` |
| `linked_device_wallet_session_credential_delivery_parent_guard` | `linked_device_wallet_session_credential_deliveries_v1` |
| `registration_ceremony_cas_guard_no_delete` | `registration_ceremony_cas_guard` |
| `router_ab_yao_versioned_json_cas_guard_no_delete` | `router_ab_yao_versioned_json_cas_guard` |
| `wallet_session_hosted_credentials_v2_identity_guard` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_credentials_v2_insert_lifecycle_guard` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_credentials_v2_lifecycle_guard` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_credentials_v2_parent_guard` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_credentials_v2_parent_update_guard` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_credentials_v2_retirement_guard` | `wallet_session_hosted_credentials_v2` |
| `wallet_session_hosted_exchange_codes_v2_child_update_guard` | `wallet_session_hosted_exchange_codes_v2` |
| `wallet_session_hosted_exchange_codes_v2_identity_guard` | `wallet_session_hosted_exchange_codes_v2` |
| `wallet_session_hosted_exchange_codes_v2_insert_lifecycle_guard` | `wallet_session_hosted_exchange_codes_v2` |
| `wallet_session_hosted_exchange_codes_v2_lifecycle_guard` | `wallet_session_hosted_exchange_codes_v2` |
| `wallet_session_hosted_exchange_codes_v2_parent_guard` | `wallet_session_hosted_exchange_codes_v2` |
| `wallet_session_hosted_exchange_codes_v2_parent_update_guard` | `wallet_session_hosted_exchange_codes_v2` |

### Dynamic records

`d1RouterApiAuthService.ts` creates `gateway-registration:`,
`router-ab-yao-sponsored-account:`, `wallet-registration-activate:`,
`wallet-registration-near-provisioning:`, `wallet-add-signer-start:` and
`wallet-add-signer-finalize:` stores. Custody envelopes, credential activity,
recovery sets and `wallet-recovery-google-email-otp:` also use versioned JSON.
Their records require wallet-home routing even when the SQL key only contains an
operation or ceremony ID. Complete the remaining prefix/caller inventory before
changing store composition.

## Deletion obligations still open

The namespace reservation API, `NamespaceD1HomeV1`, adoption route/CLI and
effective `namespace_d1_homes` table were removed in the private `0052` cutover
checkpoint. Earlier numbered migrations remain as ordered persistence history;
they do not create an effective legacy ownership path.

| Surviving source or configuration | Replacement or deletion |
| --- | --- |
| Private shared `tenant-deployment/index.ts`, server `tenantDeployment/{types,runtimeBinding,provisioning,d1,homeVerification}.ts` | Replace singular binding `home`/hash and one-resource activation with an admitted regional resource set; retain version and provider proof for each backend. |
| Private `d1GatewayWorker`, `d1WalletRuntimeWorker`, `d1ConsoleStagingWorker`, `d1LocalDevWorker`, and `render-d1-gateway-config.mjs` | Remove the assumption that `SEAMS_D1_HOME_ACCOUNT_ID` and `SEAMS_D1_HOME_DATABASE_ID` identify the home of every wallet in a tenant. A regional backend may still bind its own `SIGNER_DB` resource after admission. |
| Private `deployment/wallet-system/targets.json`, `scripts/deploy-backend.mjs`, generated Wrangler config and smoke scripts | Render and verify US, WEUR and APAC resource/backend bindings; remove singular `signerD1` assumptions after the regional set replaces them. Do not commit locally rendered secrets or IDs. |
| Public `hosted-wallet-gateway.ts`, Cloudflare runtime env and local hosted adapter | Resolve wallet ownership before selecting the regional `SIGNER_DB`; remove direct single-database composition for wallet-scoped paths. |
| Public `namespace_home_challenges` table/migration and private `tenant-home-challenge.mjs`/`homeChallenge.ts` | Keep the provider challenge as per-resource proof; rename its active storage and call sites so a challenge no longer implies namespace ownership. Preserve old migrations only as ordered history. |
| Private `tenant-deployment-binding.e2e`, `tenant-home-challenge.e2e`, helper environments and type fixtures | Replace singular-home assertions with multiple admitted backend resources and per-wallet ownership; retain actual wrong-resource and stale-version rejection. |
| Private `docs/refactor-127.md` operator commands | Remove or supersede the deleted `adopt-home` instructions before the new regional operator runbook is used. |

Retain ordinary namespace authorization and resource/version verification. The
final deletion sweep must search source, tests, scripts, config renderers and
generated outputs after the replacement is wired, then verify no obsolete
runtime path remains.
