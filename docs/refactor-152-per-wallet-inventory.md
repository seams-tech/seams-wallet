# Per-wallet placement implementation inventory

Date: October 2, 2026. This inventory supplements the
[replacement checklist](refactor-152-regional-D1.md#authoritative-replacement-phase-per-wallet-regional-homes).
The current frozen schema/ownership baseline for R153 is
[state ownership revision 1](refactor-152-state-ownership.md). The entries below
are chronological implementation evidence. This inventory records known ownership seams. Route-by-route and
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
| Email OTP registration receipt | `d1EmailOtpChallengeStore.consumeRegistrationWithReceipt` conditionally inserts into `registration_ceremony_records` from a matching `email_otp_challenges` row and deletes that challenge in one D1 batch. An opaque challenge ID may precede wallet allocation. Keep challenge/receipt consumption under one authority until a verified wallet-bound continuation exists; splitting either table without an equivalent one-use claim breaks this atomic handoff. |
| Google Email OTP recovery | `d1WalletCustodyCommitStore` checks `email_otp_challenges`, `email_otp_wallet_enrollments` and a `wallet-recovery-google-email-otp:` versioned-JSON attempt while finalizing recovery. The challenge and attempt must bind the same wallet/home before the local custody mutation. An unresolved shared challenge cannot authorize a regional commit. |

Cross-authority completion must be idempotent: reserve shared identity, commit the
wallet-local mutation once, then acknowledge the exact regional receipt. An
interruption leaves a pending claim that blocks conflicting ownership until
reconciliation; it must never make an uncommitted credential usable. Reconciliation
must verify the operation identity and regional outcome before publishing or
releasing an index entry. The exact service contracts remain an open inventory item.

### Invariant-to-authority cutover matrix

| Invariant | Present atomic owner | Target owner and transaction boundary |
| --- | --- | --- |
| Wallet ID and registration-operation uniqueness | Console reservation admission plus one regional signer D1 setup snapshot | Console wallet directory commits wallet/home/setup identity before Router preparation. A regional ceremony uses that allocation only. |
| Passkey credential uniqueness and discoverability | Signer D1 `webauthn_credential_bindings`; local `webauthn_authenticators` tracks counters | Console reserves tenant + RP + credential and routes the proof to its wallet home. The home commits the method and counter and verifies active local state and WebAuthn before discovery; no shared active-method copy is published. |
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
| `d1WalletRegistrationService.setupWalletRegistration` | Allocates wallet ID, founding auth method, ceremony and preparation IDs before custody preparation. The SDK now persists and sends a setup operation ID; the service still needs to use it for Console reservation and stable regional preparation. |
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
| SDK direct passkey ECDSA or mixed registration | Persisted setup operation; separate `finalizeIdempotencyKey` used by activation | Connect the setup operation to the same Console reservation and regional preparation after reply loss. |
| SDK direct Email OTP Ed25519-only registration | Persisted setup operation; separate finalization identity | Keep the Email OTP authority and selected wallet bound through authoritative replay. |
| SDK direct passkey Ed25519-only registration | Persisted setup operation; separate finalization identity | Recover the same reserved ceremony identity at the server. |
| Hosted passkey preparation (`prepareHostedPasskeyRegistration`) | Common setup client persists the operation; `authMenuSessionId` and `requestId` own the in-memory prompt | Connect cancellation to its reservation and expose an explicit fresh attempt after a terminal server outcome. |
| Low-level `setupWalletRegistration` client and `/wallets/register/setup` route | Protocol 2 requires `registrationOperationId`; IndexedDB persists it before sending, keyed by scope/request digests | Boundary validation is implemented. Bind it to the verified tenant, normalized request and Origin in Console before regional effects. |
| Google Email OTP registration offer | Durable `registrationAttemptId` and `ownerProofBindingDigest`; `restartRegistrationOffer` abandons an offer intentionally | Keep the offer and candidate uniqueness in shared authority. The selected candidate must use one setup operation and one permanent wallet/home reservation. |

`/wallets/register/setup` now requires a request-carried setup operation ID.
The SDK persists this random identity in an atomic IndexedDB transaction before
fetch, sharing matching attempts across tabs. The scope digest includes Gateway
URL, publishable key and environment; the request digest covers the normalized
wallet choice, authentication method and signer selection. Only digests and IDs
are persisted. After acceptance, changing the wallet or ceremony fails closed.
Shared registration publication removes the exact wallet/ceremony, including
publication resumed from the existing pending-commit journal. Corrupt storage
prevents sending a replacement operation. Cancellation/expiry and deliberate
fresh-attempt handling remain dependent on the authoritative server integration.

The route validates the publishable key, exact Origin, environment and body,
then calls `setupWalletRegistration`. As of October 3, the candidate Gateway
reserves the operation through Console and consumes the winning wallet and five
setup IDs. The selected regional D1 stores an immutable setup snapshot before
returning a token, then inserts or reads the mutable ceremony without resetting
its progress. A missing authority or mismatched physical home fails closed.

Correction to the earlier inventory: `buildD1EvmFamilyEcdsaRegistrationPrepare`
computes preparation facts from topology locally; it does not call Router. The
immutable snapshot is needed to retain its random session ID, nonce and expiry
across retries. Candidate setup forwarding, ceremony/path-wallet dispatch, and registration
home admission are now wired. Regional deployment-set activation and the
shared-identity/direct/internal paths remain open.
The browser-side `finalizeIdempotencyKey` is generated before setup in each
registration branch, but currently binds **finalization only** and is not
persisted across a browser restart. Reusing its string as a setup key without
a durable browser operation journal would not repair a lost setup response.
The SDK uses generic IndexedDB `appState` storage for the pre-setup operation.
Its pending-registration commit journal starts after setup. The new record uses
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

### Hosted execution paths inspected for the cutover

`createRouterApiRouteDefinitions` currently declares 69 route definitions (including
optional health, readiness and seal routes). The table above covers their
placement decisions; the groups below make the paths that bypass a wallet ID in
the URL explicit. Route authentication is still performed by the existing route
handler. Placement must follow the verified identity and precede construction of
any `SIGNER_DB`-backed service.

| Source and routes | Identity at ingress; current store | Required cutover admission |
| --- | --- | --- |
| `routeDefinitions.ts`: registration setup, respond, near-admission, activate and near-provisioning | Publishable-key scope and Origin for setup; signed setup or ceremony/preparation IDs on continuation. Setup consumes the Console reservation and stores immutable preparation facts at its matching D1; preparation computes locally. The four registration continuation routes now resolve the directory before dispatch, then recheck wallet/home after proof verification. Other direct and opaque-locator paths remain open. | Reserve the operation/wallet/home through Console before Router preparation. Resolve later ceremony IDs through the Console index, then verify signed claims at the selected home. |
| `routeDefinitions.ts`: `wallet_custody_*`, `wallet_recovery_*`, `passkey_custody_envelope_retrieve` | Some paths include `:walletId`; challenge, code, recovery and envelope routes derive identity from body, proof or locator. Credential and recovery locators plus custody state currently share one signer D1. | Resolve wallet ID or shared locator before regional state access. Proof remains verified at the home. Pending shared locator claims fail closed. |
| `routeDefinitions.ts`: `wallet_add_signer_*`, `wallet_add_auth_method_*`, `wallet_revoke_auth_method`, `wallet_ecdsa_key_facts_inventory`, `wallet_near_implicit_account_fund` | Path wallet ID with route-specific proof or session; wallet-local authority, signer and custody stores use signer D1. | Resolve the verified tenant-scoped wallet key once and carry the admitted home through the operation. |
| `routeDefinitions.ts`: `wallet_unlock_*`, `wallet_email_otp_*`, `auth_provider_action`, `sync_account_*`, `auth_identities`, `auth_link`, `auth_unlink`, `webauthn_authenticators`, `near_public_keys` | Credential, provider identity, challenge, session or body may be the only initial key. Identity, Email OTP, WebAuthn, session and wallet stores all use signer D1 today. | Shared credential/provider/challenge lookup identifies the wallet without regional broadcast. Verify the resulting proof and wallet state at its home. Tenant-wide rate limits remain shared. |
| `routeDefinitions.ts`: `wallet_session_exchange_*`, Ed25519/ECDSA session, signing, refresh, export, activation and presignature pool-fill routes; seal apply/remove | Opaque exchange/session/capability or wallet ID; session, quota, operation and pool records use signer D1 and Router/DO services. | Resolve a signed/admitted parent wallet before touching home state; bind Router/DO and deferred refill to that same home. An opaque token alone is not a region choice. |
| `routeDefinitions.ts`: health, readiness, WebAuthn manifest, Router keysets and derivation health | No wallet. Public/configuration diagnostics; no wallet-local D1 selection. | Keep wallet-home admission out of these routes. Tenant-root readiness still verifies its own deployment resources. |
| `hosted-wallet-gateway.ts`: nine direct Ed25519-Yao registration, recovery and export operations in `yaoDirectOperationForRequest` | Direct partitioned handler runs before `createSplitGatewayRouterHandler`, constructs request-scoped D1 state from `env.SIGNER_DB`; registration continuation may have only lifecycle ID and credential. | Admit a verified wallet/home before constructing the partitioned store. Registration continuation uses the ceremony index; recovery/export use an authenticated wallet or shared locator. This branch cannot rely on enforcement inside `routeDefinitions.ts`. |
| `walletRuntimeOpsHandler.ts`: `execute-signed-delegate`, `relayer-account`, `wallet-identities` | Signed delegate has an operation wallet; identities accepts a wallet list; relayer account is tenant control. `readWalletRuntimeIdentities` queries `wallet_signers` directly on `env.SIGNER_DB`. | Dispatch delegate to its admitted wallet home; resolve and group each identity-list wallet by home; keep relayer account under tenant-scoped control. |
| `walletControlOps.ts`: tenant-root creation, refresh, status, destination bootstrap, restore, recovery and deriver operations | Internal service-auth and tenant-root identity; no wallet yet. The Wallet Runtime forwards exact allowlisted calls to Router, control plane or derivers. | Keep an authenticated tenant-control context. Do not derive a wallet home from a missing wallet ID or treat control authorization as wallet admission. |
| `walletConsoleOpsHandler.ts`: key auth, environment lookup, usage, wallet projections and tenant-root lineage | Console tenant/key identity and Console D1. Wallet projections are usage-derived; they are not a routing authority. | Keep shared auth, tenant policy and lineage in Console. Resolve actual wallet homes through the directory; never infer them from projections. |
| Private Gateway/Wallet Runtime Worker `fetch`, Gateway `scheduled`, Console `scheduled`; public hosted/local Gateway `scheduled` | Both private Workers bind one `SIGNER_DB` after one active deployment lookup. Gateway cron calls Router prewarm; Console cron resumes tenant-root refresh and dispatches Console email. No relevant Worker `queue` or `alarm` handler occurs in these examined entrypoints. | Gateway and Wallet Runtime must select the wallet's regional backend before composing signer services. Prewarm and tenant-root/Console cron retain explicit tenant-control scope; any later wallet-scoped deferred work carries its persisted home. |

The critical constructor boundary is `createStagingRouterApiAuthComposition`:
it passes `env.SIGNER_DB` to the registration and route services. The direct
Ed25519-Yao branch constructs its partitioned store separately, and the Wallet
Runtime identity reader executes SQL directly. Changing only
`setupWalletRegistration` would leave these two paths and existing-wallet flows
on the singular database. The private Gateway currently consumes published
`@seams/wallet-server@0.7.3`, so its future regional contract and the public
server/SDK wire change must be validated together before the 0.8.0 candidate is
frozen.

The demonstrated identity-collapse defect is fixed in paired public/private
source (October 2). `wallet-identities` now requires and returns
`{projectId, envId, walletId}` within its configured namespace and requested
organization. Signer SQL selects exact tuples. Console resolves its environment
database ID to the runtime `env_key` through the same namespace, organization
and project before making that call, and rejects unexpected/duplicate reply keys.
Projection primary/address keys, cache keys, lookup requests, pagination cursors
and dashboard row keys now preserve project and environment. Console migration
0053 rebuilds the projection keys and invalidates old derived balances/snapshots.

The packed-candidate composed D1 E2E covers same-ID wallets across projects,
environments, namespaces and organizations, six pagination orderings, cache hits,
wrong-scope replies, missing scope, failed RPC refresh and a populated migration.
See the [release review receipt](refactor-152-release-review.md#wallet-identity-scope-acceptance--october-2).
Regional fan-out still needs to resolve every wallet's admitted home before
calling its regional Runtime. This correction closes the identity-collapse
prerequisite; hosted home dispatch and shared authority integration remain open.

### Singular-home symbols and replacement sweep

The surviving singular resource contract is concentrated in these source and
configuration families. The names below are deletion targets for the final
cutover; `SIGNER_DB` may remain as the regional backend's local binding name,
but it cannot remain the Gateway's implicit home for every wallet.

| Current symbol or file family | Replacement or deletion |
| --- | --- |
| Private `SEAMS_D1_HOME_ACCOUNT_ID`, `SEAMS_D1_HOME_DATABASE_ID` in Gateway, Wallet Runtime, Console, local Worker, `tenantDeployment/runtimeBinding.ts` and `scripts/render-d1-gateway-config.mjs` | Name and verify a physical regional resource without implying that the binding is the namespace's wallet home. |
| Private `gateway-deployment-config.mjs`, `deployment/wallet-system/targets.json`, `generate-github-env-values.mjs`: one `resources.signerD1` per lane | Render a typed US/WEUR/APAC resource catalog and regional Gateway/Wallet Runtime bindings; keep environment/lane separate from region. |
| Private `d1GatewayWorker.ts`, `d1WalletRuntimeWorker.ts`; public `hosted-wallet-gateway.ts`: one `env.SIGNER_DB` in request composition | Resolve/admit each wallet's home before constructing its local store; dispatch to the backend for that exact resource. A no-wallet control request uses explicit tenant scope. |
| Private `tenantDeployment/homeChallenge.ts`; public signer migration `0040_namespace_home_challenges.sql`; private provider-binding E2E | Retain fresh provider UUID/version challenge behavior and rename its schema, API and assertions around deployment resource proof. Delete namespace-home terminology; this proof never assigns wallets. |
| Public `localHostedWalletGatewayHandler.ts`, `nodeHostedWalletGateway.ts` and private `d1LocalDevWorker.ts` | Compose through the same wallet-home contract with one admitted local resource; update fault injection around the selected local store. No separate legacy routing mode. |
| Private `tests/relayer/tenant-home-challenge.e2e.test.ts`, deployment-binding E2E, `tests/fixtures/tenant-deployment/` and affected type fixtures | Preserve real resource/version verification; replace the single-wallet-home assumption and obsolete names. Verify multiple wallets in one tenant through the final path. |
| Private `.github/workflows/deploy-live-demo.yml` explicit `0042_deployment_resource_challenges.sql` probe and deployment/readiness scripts that require exactly one signer database | Change generated resource checks and schema probes with the cutover. Do not keep a stale migration as a success condition. |

The Console directory's `wallet_homes` table and service do not replace these
paths by themselves. In particular, `createStagingRouterApiAuthComposition`,
direct Yao operations and `readWalletRuntimeIdentities` currently receive the
single signer binding. A source and generated-bundle sweep must confirm that no
namespace-home allocation, implicit signer D1 selection, or old schema name
survives after their replacement.

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
| `deployment_resource_challenges` | Deployment resource proof; renamed by signer migration 0042 |
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
| `deployment_resource_challenges_expiry_idx` | `deployment_resource_challenges` |
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

The 30 effective triggers were read from SQLite after applying all 41 migrations.
Cross-table trigger references are limited to these groups: `authorized_operations`
audits into `authorized_operation_audit_events`, checks quota/authority/method/
session rows during owner-grant claims, and checks
`verified_wallet_operation_evidence_sets` for step-up; linked-device delivery
checks `linked_device_authority_installations` and
`wallet_session_authorizations_v2`; hosted credential/exchange lifecycle checks
parent `wallet_session_authorizations_v2`, and exchange child updates check
`wallet_session_hosted_credentials_v2`. Each group must stay in one wallet-home
database with its parent and child rows. This trigger list does not cover SQL
batches assembled in TypeScript, including the Email OTP and recovery cuts above.

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
| Private shared `tenant-deployment/index.ts`, server `tenantDeployment/{types,runtimeBinding,provisioning,d1,resourceVerification}.ts` | Binding/hash and activation use a verified resource set (private `af96653`); explicit activation renews writer admission while preserving the managed browser key. Regional readiness now aggregates resource-bound Runtime inspections. Finish regional configuration and complete-set operator proof collection; retain exact version/resource proof for each backend. |
| Private `d1GatewayWorker`, `d1WalletRuntimeWorker`, `d1ConsoleStagingWorker`, `d1LocalDevWorker`, and `render-d1-gateway-config.mjs` | Remove the assumption that `SEAMS_D1_HOME_ACCOUNT_ID` and `SEAMS_D1_HOME_DATABASE_ID` identify the home of every wallet in a tenant. A regional backend may still bind its own `SIGNER_DB` resource after admission. |
| Private `deployment/wallet-system/targets.json`, `scripts/deploy-backend.mjs`, generated Wrangler config and smoke scripts | Render and verify US, WEUR and APAC resource/backend bindings; remove singular `signerD1` assumptions after the regional set replaces them. Do not commit locally rendered secrets or IDs. |
| Public `hosted-wallet-gateway.ts`, Cloudflare runtime env and local hosted adapter | Resolve wallet ownership before selecting the regional `SIGNER_DB`; remove direct single-database composition for wallet-scoped paths. |
| Public `deployment_resource_challenges` and private `tenant-resource-challenge.mjs`/`resourceChallenge.ts` | Active storage and challenge contracts renamed on October 3; old storage exists only in ordered migration history. Complete per-region deployment-set verification and admission. |
| Private `tenant-deployment-binding.e2e`, `tenant-home-challenge.e2e`, helper environments and type fixtures | Replace singular-home assertions with multiple admitted backend resources and per-wallet ownership; retain actual wrong-resource and stale-version rejection. |
| Private `docs/refactor-127.md` operator commands | Remove or supersede the deleted `adopt-home` instructions before the new regional operator runbook is used. |

Retain ordinary namespace authorization and resource/version verification. The
final deletion sweep must search source, tests, scripts, config renderers and
generated outputs after the replacement is wired, then verify no obsolete
runtime path remains.


### October 3 continuation and dispatch checkpoint

The private Gateway now invokes setup transport after the public route authenticates
its publishable key, Origin and policy. `ConsoleRegistrationHomeAdmission` reuses
that request's reservation result for local execution. A fixed US/WEUR/APAC binding
forwards to the named `WalletHomeGateway` entrypoint; the entrypoint passes a trusted
home-hop state rather than trusting a request header. A mismatched receiver fails
instead of forwarding again. Provider failures become 503 and redirects are rejected.

Directory dispatch covers registration respond/activate/near-admission/near-provisioning
and existing explicit `/wallets/:walletId/` custody, signer, auth-method, recovery-status
and NEAR-funding paths. This is transport selection; destination route authentication
remains mandatory. OPTIONS bypasses directory lookup. Shared locators, opaque sessions,
all direct Yao paths, Wallet Runtime fan-out and deferred work still require coverage.

Registration respond, NEAR admission, activation and NEAR provisioning also verify
ceremony/wallet/home through the authority before their effects. Successful operation
receipts reconcile Console establishment before local cleanup. Definitive cancellation
reconciles its Console tombstone before deletion. Establishment and cancellation are
idempotent; conflicting terminal outcomes fail. Setup replay of an established wallet
never reinstalls an initial mutable ceremony.

Next structural changes are the deployment binding/decoder's single `home`,
`bindTenantDeploymentToRuntimeEnvironmentV1` resource selection, writer activation and
provider challenge verification over the complete regional backend set, and the
configuration renderer. Those checks must continue rejecting stale/unproven writers
throughout the replacement. No regional deployment has been activated by this checkpoint.

### October 3 resource-set activation checkpoint

`TenantDeploymentBindingV1.resources` replaces its singular `home`; the exact-key
decoder accepts the new shape only and the revision hashes its canonical resource
set. `TenantResourceVerificationV1` replaces the former home-named proof. Activation
requires a nonempty proof set covering every resource with distinct Gateway/Runtime
names and versions. Runtime and placement-service requests carry role, version,
account and database; Console verifies the exact tuple. A configured catalog with
an unverified resource returns 503 before any wallet-home reservation.

Console migration 0054 clears old active pointers and fails pending cutovers for
restart, preserves activation history and consumed challenges, removes singular
activation columns, and consumes each proof through a transactionally coupled
challenge table. A partial replay cannot advance the active pointer. No hosted
migration was run. The migration E2E starts with an existing single-resource
activation and unfinished cutover, then exercises the replacement.

Remaining concrete deployment edits: canonical target schema and renderer,
US/WEUR/APAC Worker/runtime service bindings, complete-set operator provider and
runtime challenges, and regional readiness inspection. Explicit version renewal
was completed in the following October 3 checkpoint. The one-resource operator collector now
sends an array but remains unable to satisfy the hosted three-resource catalog.
These paths must be completed before deployment. Shared lookup authorities,
internal/deferred wallet enforcement and terminal expiry reconciliation remain open.

### October 3 admission-renewal checkpoint

`tenantDeployment/provisioning.ts` now distinguishes the explicit operator
activation path from reuse-only onboarding. Matching tenant/surface bindings no
longer skip new proof validation. Managed-key renewals authenticate and adopt the
current credential, then run candidate/readiness/activation/canary processing.
An explicitly configured adopted credential still follows its configured policy.

Failure cleanup covers tenant-root and credential resolution as well as readiness.
It records the actual failing phase and consults durable cutover state before
revocation, preserving a committed activation if its reply was lost. The composed
D1 renewal E2E verifies replacement writer admission and these failure paths.
This closes provisioner renewal only; the regional renderer, complete-set operator
collector and multi-region readiness composition remain open.

### October 3 regional-readiness checkpoint

`runtimeInspection.ts` binds local and remote inspectors to explicit physical
resources. Its composite rejects duplicate resources, aggregates all regional
counts, and propagates any inspection failure. `productionReadiness.ts` requires
exact resource-set coverage before issuing readiness evidence. Hosted Console
constructs three regional clients from its validated catalog; the local host
retains one explicitly identified local resource. Runtime inspection responses
include their resource identity and reject another namespace.

The renewal E2E now uses three production Runtime Workers with separate D1s. APAC
live-ceremony and outage faults prevent activation; the old pointer survives and
retry succeeds after recovery. Runtime cross-wiring and incomplete coverage fail.
Configuration generation and complete-set provider/runtime challenge collection
remain open. The new regional bindings are required by Console composition and
must be rendered before hosted deployment. Remaining wallet-path work is unchanged.

### October 3 regional-challenge checkpoint

`resourceChallenge.ts` requires a parsed resource identity on protected requests,
checks namespace and catalog membership, and selects the exact regional writer
pair. Console no longer selects challenges using `SEAMS_D1_HOME_*` or singular
`WALLET_GATEWAY`; its composition requires all three Gateway and Runtime bindings.
The operator sends the explicit resource, and provider checkpoint output uses
`resource`. Type fixtures reject omitted or spread-forged resource identities.

The composed challenge E2E uses one Console for all three local resources and checks
cross-resource, unlisted-resource and foreign-namespace rejection. Canonical target
schema/rendering and complete-set CLI collection are still pending; no replacement
region UUIDs were invented or provisioned. Existing shared/control Runtime routing
and the remaining wallet-path work still require completion.

### October 3 regional deployment checkpoint

Schema 5 now models US/WEUR/APAC resources directly. Canonical APAC IDs remain;
US/WEUR allocations are explicitly pending. Rendering supplies seven Worker
configurations, the catalog and regional bindings; migration/deployment commands
iterate the regional set. The operator collects all three proofs and rechecks all
six serving writers before activation. Four focused E2Es passed in 22.6s, including
third-region lost-response cleanup; targeted TypeScript/lint passed. Full details,
repeat command and receipt hashes are in `refactor-152-results.md` under
“regional configuration and complete-set operator collection”.

Remaining: verified regional allocations and service-target bootstrap, shared
credential/recovery/session locators, direct Yao and Runtime routing, internal and
deferred enforcement, expiry reconciliation, and hosted concurrency/travel tests.
The existing update command requires pre-existing service-binding targets. No
hosted deployment or new geographic latency result; the 0.8.0 release remains held.

### October 3: opaque session and exchange routing

Console migration 0055 adds a tenant-scoped digest-to-wallet index. Gateway hashes
opaque primary/hosted credentials and exchange codes, resolves their wallet home,
and forwards through the existing fixed regional binding. Explicit wallet paths
must agree with the session wallet. Unknown credentials return 401; directory
outages return 503. The home-local authorization store still owns validity,
expiry, exchange consumption and revocation.

Only an admitted writer at the wallet's physical home can publish a locator.
Primary credentials (including linked-device activation) now share one preparation
path. Direct credential and exchange locators publish before local persistence;
a failed local commit can leave an inert locator. Hosted child credentials publish
after successful home-local exchange consumption and before returning the token.
If that publication fails, the caller receives no token and needs a fresh exchange;
the parent session remains usable. This is fail-closed ordering across two D1s,
with no distributed atomicity claim. Expired locators remain routable so the home
can apply current lifecycle rules; expiry metadata alone grants no authority.

The three-region Worker/D1 scenario passes with 12 digest-only locators. It checks
remote ingress, one winning concurrent exchange redemption, wrong-home publication,
wallet/token disagreement, publication outage, retirement of primary and child
credentials, and continued access by a second device of the same wallet. It uses
the production authorization preparation and local commit statements used by linked
devices; the complete device-linking ceremony is outside this test. Three existing
directory/challenge/activation E2Es also pass (25.3s). SDK build, public and
candidate-backed private type checks, focused lint and public bloat checks pass.

Remaining: passkey/external-identity/recovery/delivery lookup and shared uniqueness;
direct Yao, Runtime and deferred home enforcement; expiry/fresh-attempt handling;
verified regional allocations and service-target bootstrap; hosted concurrency and
travel acceptance. The replacement remains incomplete and 0.8.0 remains held.
No hosted deployment, reset, publication or geographic measurement occurred.

### October 3: direct Yao registration continuation routing

The private Gateway now resolves `/router-ab/ed25519/yao/registration/admit` from
`scope.lifecycle_id` and `/router-ab/ed25519/yao/registration/execute` from
`binding.lifecycle.lifecycle_id`. Both use the existing Console ceremony index
before regional service construction, including requests with the initial
registration credential. A supplied Wallet Session must name the same wallet as
the ceremony. The receiving Gateway repeats home resolution and rejects an
incorrect binding instead of forwarding again. Full request/proof validation
continues in the existing public registration handlers; the routing locator alone
confers no authority. No wire format or authorization policy changed.

The three-home directory E2E passed in 9.4s. Its controlled application/continuation
fixture records 12 effects (admit and execute, before and after establishment,
for each home) exclusively in the assigned D1. Malformed, unknown and cancelled
ceremonies, unavailable targets, misdirected bindings and a directory outage are
rejected before fixture effects. The production session-authorization composition
also passed, including six session/ceremony wallet disagreement rejections.
Candidate-backed TypeScript and focused lint pass. This verifies routing and local
composition; it does not execute Yao cryptography or measure hosted latency.

Direct Yao recovery/export routing, shared identity/recovery/delivery indexes,
Runtime/deferred enforcement, terminal expiry/fresh attempts, remaining cleanup
and hosted acceptance remain open. Release 0.8.0 remains held; no remote changes.

### October 3: recovery code and operation routing

Console migration 0056 owns immutable, tenant-scoped `wallet_recovery_routes`:
`code` contains the existing contextual recovery-code digest; `operation` contains
the server-issued recovery operation ID. Neither stores a recovery code, custody
secret, envelope, factor proof or credential. Publication requires the admitted
writer at the wallet's exact physical home. A conflicting code anywhere in a
submitted set prevents all new claims in that set. Identical retries are accepted.

The public custody commit store publishes code routes before registration and
rotation's existing local atomic batches. Successful publication followed by a
failed local CAS can leave inert metadata. Rotation/consumption removes or changes
home-local usable material; shared lookup metadata alone cannot make a code usable.
Old route entries remain bound to their original wallet. A scoped disposable-data
reset must include this table alongside homes and session locators. No legacy
namespace routing or migration fallback was added.

Preparation publishes its operation ID after reserving the code and before exposing
the prepared operation. A publication outage returns a distinct `routing_unavailable`
result, rendered as HTTP 503 `wallet_home_unavailable`. An interrupted attempt can
retain its existing local hold until the reservation timeout; this change adds no
cross-D1 transaction or rollback. Subsequent local attempt/proof checks remain
mandatory even when a shared operation route exists.

| Route | Home lookup |
| --- | --- |
| `/wallets/recovery/prepare` | Decode transiently, derive the existing contextual digest, zero the decoded bytes, resolve shared code route |
| `/wallets/recovery/finalize`, `google/verify`, `email-otp/verify`, `email-otp/release`, `google-email-otp/finalize` | Shared recovery operation ID; reject a supplied wallet ID that differs |
| `/wallets/recovery/read`, `rotate`, `acknowledge-backup` | Scoped wallet ID from the request body |

An accompanying session must resolve to the same wallet. Unknown recovery lookup
and home-local absent/retired codes use the generic recovery-code refusal. Home
proof verification remains authoritative. Direct Yao recovery/export lifecycle IDs
are a separate remaining lookup seam, as are passkey/provider uniqueness, delivery,
internal/deferred enforcement, expiry/fresh attempts and hosted acceptance.

### October 3: direct Yao entry routing and linked-device seam

The Gateway resolves four direct POST entry points before constructing regional
services. Recovery bootstrap uses `walletId`; recovery admission uses
`application_binding.wallet_id`; recovery status uses
`admission.application_binding.wallet_id`; export admission uses
`protocol.application_binding.wallet_id`. All use the existing scoped wallet
home directory. A supplied Wallet Session must resolve to the same wallet.
Invalid identities return 400, unknown/cancelled assignments 404, directory
outages 503. Full protocol and authorization validation stays in the home handler.
No protocol payload, persistence schema or authorization grant changed.

Remaining direct continuations are recovery execute/activate
(`binding.lifecycle.lifecycle_id`) and export execute
(`protocol.binding.ceremony.lifecycle.lifecycle_id`). Their opaque lifecycle IDs
need authenticated publication and immutable wallet ownership before exposure;
replays, publication outages, lifecycle expiry and execution must agree. Neither
NEAR `account_id` nor caller-provided region is a wallet-home authority.

Linked-device inventory finding: `createUnclaimedSessionV1` persists a
`displaying_qr` record before the owner wallet is known. The QR payload supplies a
link-session ID and target-device proof, so a wallet-home index cannot route this
initial step. Required follow-up inventory/design covers shared pre-wallet creation,
polling and claim coordination; owner approval's immutable session-to-wallet binding;
subsequent target preparation, credentials, contributions, factor delivery, export
packages and receipts at that home; and cancellation/expiry on both sides. Preserve
existing proof and atomic state-transition invariants. No temporary namespace-home
fallback or initial-device-location wallet assignment was introduced.

### October 3: opaque Yao lifecycle routing

Recovery execute/activate now extract `binding.lifecycle.lifecycle_id`; export
execute extracts `protocol.binding.ceremony.lifecycle.lifecycle_id`. The Gateway
resolves the scoped operation-kind/ID before constructing regional services, checks
any Wallet Session against the same wallet, and repeats lookup at the receiving
home. Unknown routes return 404, malformed IDs 400, conflicts 403 and lookup outages
503. The home still owns full protocol authorization, expiry and one-use state.

The public recovery handler publishes after successful authorization and admission
preparation, before the prepared claim is committed or backend admission runs.
The export handler publishes after its existing atomic authorization commit and
before backend admission. Publication conflicts return 409 `wallet_home_conflict`;
outages return 503 `wallet_home_unavailable`. An export publication failure can leave
an authorized local record; its existing exact-request replay handles retry. There
is no cross-D1 transaction. A later local/backend failure can leave inert route
metadata; the locator alone grants no authority and is never reassigned.

Console migration 0057 consolidates recovery code/operation and Yao lifecycle
locators into `wallet_routes`, preserving existing claims and dropping the former
`wallet_recovery_routes` table and its triggers. The single immutable store and
service endpoints replace the recovery-only implementation; no compatibility
endpoint remains. Only the admitted writer at the wallet's physical home can
publish. Scoped reset must include `wallet_routes` with homes and session locators.

Remaining: shared passkey/provider uniqueness and lookup, pre-wallet linked-device
coordination and approved delivery, internal/deferred home enforcement, terminal
expiry/fresh attempts, cleanup and full hosted acceptance. Release 0.8.0 stays held.

### October 3: passkey challenge and explicit-wallet authentication routing

The Gateway now resolves `/auth/passkey/options` from `user_id`, passkey
`/wallet/unlock/challenge` from `userId`, and both corresponding verification
routes from the opaque challenge ID. Email OTP unlock challenge/verify plus
`/wallet/email-otp/challenge` and `factor-release` resolve the supplied `walletId`.
Any Wallet Session and any supplied wallet ID must agree with the resolved home.
Existing home-local proof, active-method, enrollment, expiry and consumption checks
remain authoritative.

The actual D1 WebAuthn service publishes a `passkey_challenge` locator after finding
an active credential and before writing/exposing its local login challenge.
Migration 0058 adds this kind to the existing immutable `wallet_routes` index,
preserving all claims and leaving no parallel table or compatibility endpoint.
Publication conflicts return 409; outages return 503 through both public challenge
handlers. A later local-write failure may leave inert metadata, which grants no
authority. Consumed/expired challenges retain their home route and fail in the local
store. Route retention/cleanup remains part of terminal-state work.

Review found the public auth parser accepted repeated/trailing slashes while home
dispatch used exact paths. It now requires canonical paths; the regional E2E checks
both aliases return 404 without creating challenges. No alias fallback remains.

This closes challenge-based passkey entry routing, not global credential/provider
uniqueness, provider discovery or full hosted unlock acceptance. Shared identity,
pre-wallet linked-device coordination, internal/deferred home enforcement, terminal
reconciliation/cleanup and hosted lifecycle/travel verification remain open.

### October 3: explicitly selected Google login

`/auth/google/verify` with `account_mode: login` and `wallet_id` now resolves that
wallet's scoped home before constructing regional services. Invalid selections and
register-mode selections are rejected; directory outages and conflicting Wallet
Sessions fail closed. Provider token verification remains in the home handler.
Requests without `wallet_id` retain their separate discovery/registration path,
whose shared authority remains unfinished.

Review found `resolveLoginSession` could fall back from a mismatched selected
wallet to another locally linked/discovered wallet, or to registration after a
miss. It now returns the precise `wallet_identity_mismatch` failure, with required
selected-wallet and verified-provider fields. The new branch rejects registration
fields and mismatched mode/code combinations in type fixtures. An explicit
selection never silently changes wallet identity.

The three-home composition uses the production request parser, resolver, D1
identity store and D1 enrollment store. Valid selections succeed through foreign
ingress; another valid account/wallet in the same home cannot substitute for the
selection. Missing enrollment fails without registration; session conflicts and
outages are rejected. Google token verification and enrollment ciphertext are
controlled fixtures. Shared provider/credential uniqueness, discovery, linking,
internal/deferred enforcement, terminal cleanup and hosted acceptance remain open.

### October 3: shared identity authority

Hosted Gateway auth composition injects `WalletHomeServiceClient` as its
`IdentityStore`. Console `/identity` operations reuse `D1IdentityStore` and the
`0059_wallet_shared_identity.sql` schema. Tenant scope comes from admitted writer
context, never the submitted command. Claims may precede wallet reservation;
provider proof remains the caller's responsibility. Only identity metadata lives
here; enrollment/proof state stays regional. Service failures propagate without
regional fallback. Standalone SDK deployments retain their configured local D1
store. Runtime/internal entry enforcement, provider forwarding, shared offers,
credential uniqueness and rate limits remain open.

### October 3: verified Google discovery routing

For `/auth/google/verify` login without `wallet_id`, Gateway parses the request and
runs the existing Google RS256 signature/issuer/audience/expiry checks through the
shared read-only `verifyGoogleOidcToken` function. It resolves
`wallet:google:<verified subject>` in Console, then the wallet home. Both ingress
and receiving Gateway apply the same lookup; the receiving endpoint refuses a
second hop. A linked identity with no live home fails closed. No matching identity
continues to the existing registration/discovery handler; shared offers and removal
of remaining local pre-wallet discovery assumptions remain required. Explicit-wallet
login still validates the provider against the selected enrollment at home.

### October 3: shared Google offer store

Hosted Gateway composition supplies `RegistrationOfferClient` to the resolver,
challenge service and auth-method service through the registration-attempt store
port. `/registration-offer` uses Console migration 0060 and the existing D1 store;
commands and records are parsed at the service boundary and runtime policy must
match the admitted tenant's org/project/environment. No regional fallback occurs.
Standalone deployments continue to use their local D1 implementation.

Creation atomically inserts only if the same provider/email/owner-proof/runtime
scope has no live pending offer, then returns the winning offer. Reading a started
offer no longer rewrites its timestamp. Updates target existing pending records;
they cannot insert deleted records, revive terminal records or downgrade finalized
state. Sequential restart abandons the old offer and later regional retries reuse
the replacement. Candidate selection, concurrent restart/completion, expiry and
reservation reconciliation still need full acceptance; this checkpoint establishes
shared storage and concurrent creation, not the whole registration lifecycle.

### October 3: candidate claim boundary

Signer migration 0043 and Console migration 0061 add a persistence-only
`selection_digest` claim. `claimCandidate` atomically verifies live pending state,
candidate membership and wallet identity, then binds the selected candidate to the
verified registration-intent digest. The auth-method service calls it after proof,
runtime-scope and duplicate-method checks and before returning authority. A repeated
identical claim succeeds; another candidate or intent is rejected. Generic pending
updates must preserve the selection, and cannot abandon a claimed offer. The old
candidate-rewrite builder was deleted.

The three-region composition races different candidates through the shared store;
it does not execute the full custody ceremony. Shared identity publication and
offer completion still need atomicity/reconciliation review, including expiry and
home reservation. Do not count candidate claim storage as completed registration.

### October 3: atomic offer completion and identity publication

`GoogleEmailOtpRegistrationAttemptStore.complete` owns a D1 batch containing
conditional identity publication, offer activation and acknowledgement lookup.
All statements use authenticated tenant scope and the claimed wallet. Publication
requires a live pending offer with a candidate claim. Existing same-owner links
and sole-identity moves retain the prior policy; an old owner with other identities
blocks completion. The resolver delegates completion to this store, so hosted
execution uses Console and standalone execution uses signer D1. Removed the old
sequential link/put path and its unused active/failed record builders.

Generic offer updates cannot mark an offer active. Completed offers survive the
pending-offer expiry cleanup, allowing acknowledgement retry after a lost response.
A retry requires the active offer and its matching identity link; it cannot move a
link that changed after completion. Regional enrollment/custody persistence still
precedes the shared transaction and requires interrupted-flow reconciliation with
home reservation and expiry. This change closes the two shared writes, not that
cross-database boundary.

### October 3: completion after offer expiry

The post-wallet-commit finalizer now passes the authority's original registration
intent digest through `completeCommittedRegistrationAttempt`. The shared completion
transaction checks that digest against the candidate claim instead of the offer's
pre-registration expiry. Console additionally requires a non-cancelled wallet-home
assignment matching the authenticated writer resource. Ordinary offer completion
retains its live-expiry check. A completed acknowledgement on the committed path
also checks the original digest.

Cleanup retains claimed records, and generic pending writes cannot expire them.
Fresh creation cannot replace the same scoped claimed attempt merely because its
offer expiry elapsed. Retention prevents losing possible committed work. The full
regional commit/crash/replay route and authoritative terminal claim/home-reservation
cleanup are still acceptance gates; retention is not a completed cleanup policy.

### October 3: claimed-offer deletion audit

Removed the public/shared `delete` operation from the registration-offer store,
command union and service handler. Malformed-record cleanup is private and its
SQL deletes only unclaimed rows. Wallet-allocation checks treat a pending candidate
claim as occupied after offer expiry. This closes ordinary cleanup bypasses;
authoritative cleanup after a terminal home/custody decision remains unfinished.

### October 3 counter and terminal-boundary checkpoint

Hosted Email OTP policy counters now use Console authority via the injected
EmailOtpRateLimitCounter; standalone D1 retains its own counter implementation.
The four policy scopes share atomic counters, scoped by admitted tenant identity.
Other cross-wallet quotas still require inventory. Console migrations 0062/0063
provide terminal offer cleanup and the counter table. Full custody crash/replay,
shared passkey reservations, linked-device bootstrap and internal/deferred routing
remain open. See refactor-152-results.md for repeatable composition evidence.

### October 3 passkey write-path inventory

The hosted credentialClaims dependency now reaches all binding mutations:
`d1WalletRegistrationCommitStore.commit`, WebAuthn binding insertion used by
`d1WalletAuthMethodService`, recovery installation in `d1WalletCustodyCommitStore`,
and credential promotion in `d1LinkedDeviceAuthorityInstallService`.
Console `wallet_passkey_claims` owns immutable scoped RP/credential-to-wallet claims;
regional binding, counter and authority records stay transactional with custody.
Claims survive ambiguous regional failure and confer no authentication authority.
Publication/discovery and terminal reconciliation remain open, as do full lifecycle
acceptance runs exercising the shared authority at each of these four call sites.

### October 3 terminal/sync follow-up

Console home cancellation now excludes wallets with retained passkey claims, with
migration 0065 enforcing the same boundary at D1. There is no unsafe claim-release
endpoint. Reconciliation remains required to close an uncertain regional outcome.
`authenticationDispatch` now covers `/sync-account/options` by explicit account ID
and `/sync-account/verify` by shared challenge locator. Production sync challenge
creation publishes the locator before storing/returning the local challenge.
Wallet-less hosted sync fails explicitly until shared discovery is completed.

### October 3: shared sync discovery authority

This supersedes the earlier wallet-less sync rejection checkpoint and the proposed
active-credential publication index. Console `wallet_sync_challenges` holds scoped,
expiring challenges and consumption tombstones. SDK sync storage uses the injected
shared port; known-wallet sync no longer writes a redundant local challenge or
publishes a generic lifecycle locator. Login/unlock locators remain unchanged.

Discovery routes by RP + credential claim within the challenge scope. Console
consumption requires the assigned home writer, a live home and matching expected
wallet when supplied. The home verifier checks committed binding, active auth method
and WebAuthn. This preserves one authoritative active-method state and avoids
cross-database publication/revocation races. A claim never authenticates by itself.

Creation retries cannot overwrite records or revive consumed challenges. Full hosted
WebAuthn acceptance and terminal claim reconciliation remain open. Include shared
sync challenges in scoped test resets and operational expired-row cleanup.

### October 3: discovery proof acceptance boundary

The regional composition now generates P-256 credentials and authenticates discovery
with the SDK's real ES256 verifier. The same public key is persisted in the regional
authenticator and active method. Known-wallet and wallet-less proofs resolve to the
correct home; shared single-use consumption admits one concurrent winner. Signature,
signed-origin and challenge mismatches fail without returning a wallet identity.
Revoking a local auth method after challenge issuance rejects its valid proof even
while the immutable shared claim continues to resolve the home.

The fixture supplies expected origin directly because Miniflare's transport rejects
external Origin headers. It also supplies the signer manifest and invokes the sync
verification service through a test handler. Full browser headers, signer-manifest
persistence, discovery session bootstrap and custody installation remain unverified
in this composition. These are explicit hosted acceptance tasks.

Next implementation boundaries remain linked-device pre-wallet coordination and
terminal claim reconciliation. Linked-device session creation, target proof nonces,
claim CAS and transcript publication must have one shared authority before ownership
is known. Once owner authorization binds a wallet, target credential installation,
source contribution, delivery and receipts must execute at that wallet's home.
Moving only the session table would split its CAS guards and transcript transactions;
adding a route locator alone cannot solve creation/polling before the owner is known.
Terminal cleanup similarly requires a durable home-side outcome receipt: deleting a
ceremony before shared cancellation loses replay state, while cancelling first can
abandon committed work. Retain claims until that protocol is implemented and tested.

### October 3: shared linked-device proof nonces

The hosted Gateway injects `LinkedDeviceRequestProofNonceStoreV1` through its existing
composition options. Console migration 0067 stores the existing scoped nonce schema;
its authenticated `device-proof-nonce` command reuses the SDK's D1 boundary parser and
store. The core proof verifier validates the signature before calling this port.
Nonce input is normalized at the D1 boundary; no parallel Console nonce validation or
storage implementation was introduced. Bounded expiry pruning remains in that store.

All hosted device proof checks now share this authority, including wallet-less create
and later device-authenticated requests. Shared failures are typed unavailable
results, mapped to HTTP 503. Standalone composition retains its single local store.
Regional nonce deletion during local session cleanup cannot release shared nonces;
shared expiry pruning owns them. Include the new Console table in scoped reset plans.

Remaining linked-device work: shared QR creation/polling/cancellation and an immutable
owner-authorized home handoff with crash-safe local installation. No session or
transcript CAS was moved by this change. The existing regional session stores still
require replacement for those wallet-less entry points before hosted release.

### October 3: claimed linked-device home binding

`LinkedDeviceSessionServiceV1.claimSessionV1` publishes a `linked_device` lifecycle
locator after owner authorization, QR/claim validation and next-record construction,
before calling the existing regional session/transcript CAS. Both D1 service
compositions receive the existing lifecycle publisher. Console migration 0068 extends
the immutable route-kind constraint; no parallel session-routing table was added.
The shared authority admits only the writer assigned to the selected wallet home.

Gateway dispatch extracts the canonical link-session ID from all session subpaths,
including nested Email OTP challenge/resend/verify and source-contribution execute.
An existing locator routes device-only requests to the home; an owner token for
another wallet fails 403. Missing locators retain the existing owner-session routing
for the initial claim. This does not solve region-local QR creation/polling.
Cancellation retains the locator. A lost publication reply leaves the local QR
unclaimed and an exact retry can complete the claim. Concurrent owners can commit
only the wallet admitted by the immutable shared route.

Shared QR creation, polling and cancellation remain open. Full handoff must install
the winning QR/claim snapshot at the home with a durable local import receipt in the
same transaction as its session/transcript writes. A receipt must survive session
cleanup so shared bootstrap state cannot resurrect a deleted local session. Resolve
claim/cancel races in shared authority and retain enough state for replay after
publication or local commit reply loss. No shared-to-local import was introduced in
this checkpoint.

### October 3: shared QR and atomic home import

This replaces the preceding separate publication/local-claim sequence. Console
migration 0069 owns unclaimed QR snapshots and their claimed/cancelled/expired
bootstrap outcomes. Claim publishes the immutable linked-device route and winning
snapshot in one D1 batch. Generic lifecycle publication rejects linked-device IDs.
The assigned regional writer imports session, transcript and migration 0044 import
receipt in one batch. Receipts survive regional session cleanup; shared terminal
snapshots remain retained. Scoped operational resets must account for both tables.

Three-home local composition verifies shared reads without regional QR rows,
competing owners, foreign-writer rejection, claim/cancel contention, shared batch
rollback, outages and lost acknowledgements, failed import retry and cleanup without
resurrection. Owner authorization and downstream device actions remain controlled;
full approval/delivery/authority installation remains an acceptance gate.

### October 3: signed HTTP creation retries after claim

Creation POSTs now extract the QR link-session locator before regional dispatch.
Once a shared claim binds that locator, creation retries reach the wallet home.
The SDK resolves the home session instead of returning the frozen shared claim
snapshot. A cancelled session remains cancelled; a cleaned-up session returns
conflict while its surviving import receipt prevents resurrection.

The three-home E2E now exercises real signed HTTP creation, polling and target
cancellation through regional Worker dispatch. It demonstrated the stale `claimed`
response after cancellation before the fix. Owner claim authorization remains
controlled, and approval/delivery/authority installation remains open.

### October 3: approval persistence and signed approval polling

The regional HTTP scenario now uses the production owner authorization provider for
claim/approval rules. Its source manifest comes from the existing coherent wallet
authority fixture; source-metadata lookup and owner HTTP authentication remain
controlled. Approval POSTs forwarded to WEUR persist one approval transcript there
and none in US/APAC. Exact retries succeed, changed approvals conflict, and a
different wallet's session is rejected at dispatch. Signed approval polling returns
the canonical wire approval. Invalid signatures fail without consuming the valid
request's nonce. Cancelled sessions return invalid-state instead of approval.

No production change was required by these checks. This verifies approval transcript
delivery, not committed signer-package delivery. The next boundary is target factor
preparation/registration, source contribution and committed package installation;
its dependencies are `targetCredential`, `sourceContributionRouter` and
`installationReceipt` on the existing D1 route-service composition. Final acceptance
must use real owner authentication and source metadata and complete installation,
acknowledgement-loss retry and cleanup.

### October 3: target-preparation concurrent replay

The production target credential provider compared the losing planner's newly
allocated challenge digest against the stored winner and threw on a valid concurrent
request. Both existing-row and insert-race paths now validate and return the stored
preparation through the same replay check. A different recipient remains a typed
conflict. No challenge or recipient is overwritten.

The regional scenario reaches approved state via HTTP, then races two provider
calls at WEUR with a controlled planner generating independent canonical passkey
preparations. It verifies one home row, identical responses/retries and rejection
of recipient changes. Preparation HTTP authentication, actual target WebAuthn
registration, source contribution and final installation remain open.

### October 3: preparation HTTP authentication

The regional scenario now supplies production route definitions and Console's
publishable-key adapter/service to target-preparation HTTP requests. Keys use
in-memory storage; their creation, hashing and origin/environment authentication
execute production code. The scenario uses a valid `regional:dev` environment ID.
Miniflare routes explicitly admit the two test Origin hosts so its local proxy
reaches the product policy checks.

Signed requests from APAC reach WEUR. Missing/invalid keys return 401; missing or
blocked origins and a different environment return 403. An authenticated request
returns the durable preparation, while a changed recipient returns 409. Requests
do not allocate more preparations. Source planning remains controlled, and target
WebAuthn registration, source contribution and final installation are still open.

### October 3: browser target verification and source-failure rollback

The regional E2E now creates a real registration response with Chromium's virtual
authenticator at `https://wallet.test`. The target verifier accepts it and rejects an
altered challenge or changed expected configuration. A signed credential POST from
APAC executes at WEUR. The source-reader fixture deliberately fails after successful
factor verification: the target row stays `prepared`, commit reservations are released,
and a fresh signed retry reaches source lookup again. Invalid challenge requests do
not reach source lookup.

This closes browser-response verification and failure/retry coverage at the credential
HTTP boundary. It does not complete credential persistence: the next composition must
supply a coherent source-authority reader and source-contribution preparation planner,
then verify the `registered`/`awaiting_source_contribution` transition and replay before
committed package delivery and final installation. Browser-generated registration is
real; the source authority and cryptographic provisioning remain outside this run.

### October 3: successful target credential commit and retry

The regional browser scenario now continues past the deliberate source failure.
It reads the existing owner session, method and authority from WEUR D1, supplies
controlled signer protocol material/contribution preparations, and sends the real
WebAuthn credential through APAC. The production credential provider persists the
registered target and the route advances the session to `awaiting_source_contribution`.
US and APAC have no target credential row. Exact retry reports `replayed`, returns
identical credential contents and session, and performs no second source read or plan.

This closes local credential commit/retry composition. The fixture does not exercise
the production source signer resolver or cryptographic contribution planner. Replace
those controlled boundaries with actual owner material before claiming full device
linking acceptance; contribution, package delivery and authority activation remain open.

### October 3: production source reader in regional credential registration

The regional credential scenario now uses `createD1LinkedDeviceVerifiedLinkSourceReaderV1`
with production D1 session, auth-method, authority and wallet stores. The owner fixture
uses a matching Ed25519 key identity and material activation. Its synthetic signer is
constructed with the production signer builder, validated by the persistence parser,
and inserted through `D1WalletStore.putSigner`.

Before insertion, signed APAC credential HTTP reaches WEUR and fails on the missing
signer, before contribution planning; the durable reservation is released. After
insertion, registration succeeds and exact retry returns unchanged credential/session
without another source read or plan. Home-only credential persistence still passes.
This removes the handwritten source verification path from the scenario.

The registration capability material is synthetic. The source-contribution planner
remains controlled; a real custody ceremony, source-child resolution/contribution,
package delivery and activation still require composed acceptance. No production
behavior changed and no geographic latency measurement was added.

### October 3: Console mixed-home wallet identity reads

Console's hosted wallet balance reader now resolves every wallet through the shared
home directory before issuing identity reads. It groups selectors by US/WEUR/APAC,
sends one request per home, deduplicates selectors within that request, and returns
results in caller order. Missing/non-established homes and regional HTTP failures
reject the read; unrequested or duplicate response identities are rejected. The
existing Runtime contract still omits wallets without both chain identities.

The regional E2E uses the production directory, regional resolver and HTTP client
across three Worker transports. It checks mixed homes, duplicate inputs, missing
homes, a failed region, foreign/duplicate response identities and incomplete wallets.
Regional response payloads are controlled fixtures. This closes Console caller
routing; direct Runtime entry enforcement, relocation races/write fencing and
signed-delegate ownership remain separate gates. No hosted deployment occurred.

### October 3: direct Runtime identity home enforcement

The private Wallet Runtime now handles its internal identity endpoint through a
home guard before the signer read. The boundary parses once, checks the active
tenant scope, resolves every wallet using the authenticated Console home client,
and compares the assigned account/database with the local resource. Unknown or
non-established homes return 404, wrong homes 409, scope mismatch 403, invalid input
400 and directory failure 503. A rejected batch never invokes the local reader.
The guard reuses the existing production D1 identity reader, now exported by the
hosted gateway module. The request body is not reparsed by the generic handler.

The three-Worker regional E2E composes this production guard with a Wallet Runtime
writer-authenticated home client. It verifies mixed-home rejection including a
local-first/remote-second batch, missing homes, tenant mismatch, malformed batches,
directory outage and successful home-routed requests. Regional identity payloads
remain controlled. This closes direct identity-read home enforcement; signed-delegate
and control operations, in-flight relocation fencing, deferred work and full linked
device installation remain open. No deployment or release occurred.

### October 3: Runtime ownership audit and deferred continuation routing

The remaining Runtime operations were traced to their effects:

| Operation | Ownership and consequence |
| --- | --- |
| Wallet identities | Wallet-scoped D1 reads; Console fan-out and direct Runtime home guard are implemented. |
| Signed delegate execution | `CloudflareD1SignedDelegateExecutor.execute` uses configured tenant relayer credentials and NEAR RPC to submit an already-signed delegate. It does not claim wallet signing quota or mutate wallet signer rows. Keep tenant relayer execution separate from wallet-home admission; relayer nonce/submission safety is its existing service responsibility. |
| Relayer account | Returns configured tenant relayer identity; no wallet selector or wallet-local mutation. |
| Tenant-root control | Enumerated control operations forward to MPC Router, control-plane or deriver bindings under internal service authentication. These are tenant-owned creation/refresh/restore/recovery operations; a signing-root identifier is not a wallet ownership key. |
| Deployment resource proof/inspection | Local resource identity/readiness, independent of any wallet. |

Removed an unreachable `/wallets/register/setup` admission branch from the private
Runtime Worker. Its downstream handler serves internal Runtime/control operations;
registration setup is a Gateway responsibility. No registration support was removed.

Production NEAR admission and provisioning already call
`admitRegistrationReservationHome` before protocol work or side-effect claims. The
regional E2E now covers both `/wallets/register/near-admission` and
`/wallets/register/near-provisioning` across all nine ingress/home pairs (18 cases),
repeat home selection, conflicting Wallet Sessions, unknown/malformed ceremonies
and directory outages. Protocol execution is deliberately disabled in this routing
scenario; it does not prove deferred commit behavior.

Remaining fence gap: `ed25519_yao_lifecycle.rs` launches Deriver B execution with
`context.wait_until` after capturing the admitted pair/root scope. The current
routing check does not establish a relocation-generation check at the eventual
material/effect commit. R152/R153 must coordinate a current-owner write fence at that
boundary and at pending NEAR side-effect commits before relocation is enabled.
This audit is not exhaustive proof of every refill/DO/Container effect. Full
linked-device source contribution, package delivery and activation remain open.

### October 3: production linked-device source preparation

The regional E2E now uses production source-child resolution, durable owner
metadata, owner-lane projection and contribution preparation. The handwritten
contribution planner was deleted. A real browser credential submitted through
APAC commits at WEUR; a fresh-proof retry replays the stored preparation without
replanning. Missing source material rejects before planning, and US/APAC receive
no target credential rows.

Owner protocol material and target preparation remain controlled fixtures. Real
contribution execution, package delivery and final linked-device activation remain
R152 acceptance work. Relocation fencing belongs to R153 and is outside this
R152 continuation. See [results](refactor-152-results.md) for receipt and command.

### October 3: owner binding at linked-device home handlers

The shared owner-session handler now compares the authenticated wallet with the
session's durable claim before exposing source preparation, invoking source
execution or accessing export-root transfers. Redundant per-route checks were
removed. Regional dispatch already rejected foreign Wallet Sessions; the direct
handler previously returned preparation data to an authenticated different wallet.

The regional E2E covers preparation retrieval through all three ingress regions,
Gateway scope rejection and direct-handler rejection after controlled owner
authentication. Contribution execution and final installation remain open.
See [results](refactor-152-results.md) for the evidence and verification scope.

### October 3: real local linked-device protocol acceptance

- [x] Run the existing real-Worker three-device contract: Device 2 links Device 3;
  Device 3 signs NEAR/Tempo and exports both keys; earlier devices still sign.
- [x] Run the lost-response contract: contribution execution replays the same
  reservation; activation replays the same receipt/result; the linked device signs
  both curves, revocation blocks it, and the owner continues signing.
- [x] Retain five device traces with zero lifecycle violations, logs and build hashes.
- [ ] Complete the same installation through production Console authentication and
  three regional D1 homes; verify final state and cleanup only at the assigned home.
- [ ] Repeat the completed flow on the hosted candidate before release acceptance.

These contracts use real local MPC Workers and fresh D1 state. Regional fixtures
remain separate evidence; their controlled source/authentication is not replaced by
these standalone runs. No new geographic latency measurement or deployment.
See [results](refactor-152-results.md) for commands, timings and the receipt.

### October 3: regional owner authentication uses production D1 readers

The regional linked-device scenario now uses the production owner bearer
authenticator and active/exhausted session readers. The token-comparison fixture
was deleted. Approval and source-preparation reads validate durable session,
authority, method and capability state. A foreign wallet authenticated against its
own real home is still rejected by the downstream claimed-wallet guard; Gateway
scope rejection also passes across all three ingress regions.

Regional E2E, focused lint and public bloat checks passed. Private receipt:
`.artifacts/r152/owner-auth-20261003/regional-session-routing-evidence.json`;
SHA-256 `05438478f525d73d86435b7c67405daff993ebb813410741b7676bf1c0ba4460`.
Approval source facts and target preparation remain controlled; regional protocol
execution and final installation remain open. No deployment or release.

### October 3: regional approval source facts use D1

Removed the hard-coded approval signer manifest and custody digest. Approval now
uses the production verified source reader and metadata provider against home D1.
Missing signer material rejects approval and leaves the claim unapproved. Inserting
the signer at WEUR allows approval, registration and replay to complete through
the existing regional scenario. The target planner and owner protocol material
remain controlled; real regional installation remains open. See the
[results](refactor-152-results.md) for the receipt and verification limits.

### October 3: production target planner and authenticated claim HTTP

Deleted the handwritten target preparation fixture. The existing production
planner now generates challenges, target method IDs, export-root preparation and
recipient requirements; the fixture only synchronizes concurrent entry. Two plans
converge on one durable preparation, changed recipients conflict, and browser
registration succeeds. The initial claim now travels through authenticated HTTP
from APAC to WEUR and replays identically through US, replacing the direct service
call with a manufactured owner context in this composed scenario.

Regional E2Es, focused lint and public bloat checks passed. Real owner protocol
material and complete regional installation remain open; see
[results](refactor-152-results.md) for receipts and reproduction.
