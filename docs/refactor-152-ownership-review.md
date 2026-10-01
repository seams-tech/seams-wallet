# Regional D1: ownership review and first experiment

Date: October 1, 2026. Reviewed source: `1165e075`.

## Decision

Use an entire isolated deployment namespace as the owner for the first placement
experiment. Bind that namespace to exactly one writable database for its whole
lifetime. Create fresh wallets; retain existing owners at their current database.
The experiment needs no production home directory, cross-region routing, copied
wallets, or migration state machine.

A wallet-only partition cannot preserve the current local policy and rate-limit
boundaries without additional coordination. A project/environment partition is
also unproven: several authorization identities are scoped to namespace and
organization, without project/environment in their uniqueness keys. Keep all
projects of an existing namespace/organization together until that relationship
is proved at every entry point. The experimental whole-namespace boundary is
conservative; this review does not establish the smallest production owner.

## Evidence and dependencies

All 39 ordered migrations under `packages/wallet-server/migrations/d1-signer`
were applied to an empty local SQLite 3.53.3 database. The resulting schema has
54 tables and 30 triggers; integrity check returned `ok` and foreign-key check
returned no violations. `.artifacts/r152/ownership-20261001/effective-schema.json`
records each migration's SHA-256, the effective SQL, foreign keys, and source
revision. This verifies schema construction, not Cloudflare placement or a
populated-state migration. Review effective triggers after all migrations: the
owner claim trigger in migration 0032 is replaced by migration 0034.

| State | Current boundary and invariant | Regional consequence |
| --- | --- | --- |
| `wallet_session_authorizations_v2`, `wallet_authorities`, `wallet_auth_methods`, `authorization_wallet_session_quotas` | The claim trigger joins exact session, authority, method, principal, and quota; admission decrements the last use atomically. Quota uniqueness is namespace/tenant/quota and namespace/tenant/session. | These records and operation insertion must stay in one database transaction. A session quota is not evidence of a global project signing quota. |
| `authorized_operations`, `authorized_operation_audit_events` | Operation ID and fingerprint uniqueness use namespace/tenant. Claim/completion triggers maintain audit and completion semantics. | Keep the durable replay answer and its claim at the same home for retries and completion. |
| `verified_wallet_operation_evidence_sets`, `verified_owner_proof_consumptions` | Step-up evidence and consumed-proof/replay identities use namespace/tenant. | Preserve one-use proof consumption with the operation admission boundary. |
| `wallet_signers`, `linked_device_authority_installations` | Canonical and linked material are read in the credential snapshot; guarded admission/finalize statements compare verified material records. | Keep linked provenance and canonical candidates with authorization; preserve fresh retirement checks. |
| `router_ab_normal_signing_admission_records` | Project policy key includes org/project/environment/signing-root version; abuse adds wallet/material/curve. Policy reads occur before admission on prepare, finalize, and replay. | Project policy is shared across wallets. Independent writable copies could disagree. Existing policy evaluation is a fresh snapshot, not a newly promised transactional policy-update fence. |
| `email_otp_rate_limits`, `identity_links`, `webauthn_credential_bindings` | Project/environment scoped rate keys include IP, user, provider, wallet, and organization; identity and credential uniqueness also extends beyond one wallet. | A wallet split fragments existing rate limits and uniqueness unless another authority enforces them. These lifecycle paths remain relevant even when timing ECDSA-only signing. |
| `wallet_auth_method_revocation_replays`, authority/method/session records | Revocation stores its exact answer in the mutation batch. | Admin/revoke retries must reach the same home as signing reads. |
| Hosted credential/exchange/delivery tables | Effective triggers enforce session parents, immutable identities, retirement, and delivery lifecycle. | Unlock, iframe exchange, and linked delivery must follow the same home. |
| `vault_proxy_secrets` | The store upserts and reads by namespace/tenant/vault/item; project/environment and wallet are absent from that identity. Opening also checks the capability and destination. | Keep the vault item with its tenant authority; a project-only split would fragment its existing identity. |
| `lane_locks`, registration/lane/linked/authority/Yao CAS guards | Lane lock acquisition uses a scoped conditional upsert against expiry. CAS guards deliberately trigger a local constraint failure when the preceding update changes no row. | Preserve locks, their guarded records, and each mutation batch at one home. The guard tables enforce local CAS; they provide no cross-database writer fence. |
| Registration, recovery, lane journals/locks/receipts, Yao lifecycle, vault and remaining signer tables | Some are outside the measured normal ECDSA path. They are included in the generated schema inventory, without a complete semantic partition proof. | Keep the entire deployment database together for the experiment; do not selectively copy signing tables. Production ownership review remains open for these paths. |

The tenant ID is parsed from `options.orgId` in
[`d1RouterApiAuthService.ts`](../packages/wallet-server/src/router/cloudflare/d1/auth/d1RouterApiAuthService.ts).
That service constructs authorization and signer adapters from one database.
The relevant implementation boundaries are
[`authorizedOperationStatements.ts`](../packages/wallet-server/src/router/cloudflare/d1/authorization/authorizedOperationStatements.ts),
[`d1AuthorizationStore.ts`](../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts),
[`d1RouterAbNormalSigningAdmissionStore.ts`](../packages/wallet-server/src/router/cloudflare/d1/signingAdmission/d1RouterAbNormalSigningAdmissionStore.ts),
[`routerAbNormalSigningAdmissionCore.ts`](../packages/wallet-server/src/router/domains/signingOperations/routerAbNormalSigningAdmissionCore.ts),
and [`d1EmailOtpRateLimitStore.ts`](../packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRateLimitStore.ts).

## Namespace and uniqueness audit

A fresh local application of all 39 migrations at Wallet revision `82dad493`
confirms 54 application tables and 30 effective triggers, with `integrity_check`
returning `ok` and no foreign-key violations. The resulting
`.artifacts/r152/ownership-20261001/namespace-boundaries.json` records migration
hashes, scope columns, primary keys, every unique index, and effective trigger SQL.

Forty-nine tables carry `namespace`; their unique indexes all include that column.
The remaining five are the local CAS guard tables for registration, linked
sessions, lanes, wallet authority, and versioned Yao records. They are database
infrastructure, not independently routable owners.

Six tables have namespace/tenant uniqueness without project/environment:
`authorization_wallet_session_quotas`, `authorized_operations`,
`authorized_operation_audit_events`, `verified_owner_proof_consumptions`,
`verified_wallet_operation_evidence_sets`, and `vault_proxy_secrets`. Their keys
cover session/quota IDs, operation IDs/fingerprints, audit IDs, one-use proof and
replay identities, evidence digests, and vault/item IDs. Splitting an organization's
projects across writable homes would change these existing uniqueness boundaries.
An entire deployment namespace remains the conservative initial home unit.
This structural audit does not complete the semantic administration, stale-writer,
and migration proofs below.

## Routing and administration limits

### Registration and recovery transaction boundaries

A follow-up source review at Wallet `4ba3544e` identifies the following additional
local transaction boundaries. These are source-derived requirements for regional
ownership; the Tokyo signing cohorts do not exercise recovery or code rotation.

| Mutation | Records that must remain at one writable home |
| --- | --- |
| Wallet registration commit | Wallet subject, signer records, founding authority/method, passkey authenticator and credential binding when applicable, Email OTP commit statements, and lifecycle decision statements share one D1 batch. |
| Initial custody commit | The custody envelope, recovery envelope set, backup acknowledgement, and recovery-code locators are inserted together. Their insert-only/version checks prevent replacement of established custody. |
| Recovery-set rotation | The recovery set and existing backup acknowledgement share version checks with locator collision detection, old-locator deletion, and replacement-locator insertion. |
| Passkey recovery installation | Recovery-set consumption, the new envelope, authority/method, authenticator and credential binding, challenge consumption, and locator consumption share one guarded batch. Exact replay reads the committed target and consumed reservation from that same authority. |
| Email OTP recovery installation | Recovery-set consumption, the new envelope, authority/method and enrollment statements, challenge deletion, recovery-attempt finalization, and locator consumption share one guarded batch. |

The implementations are
[`D1WalletRegistrationCommitStore.commit`](../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationCommitStore.ts),
the commit/rotation methods of
[`CloudflareD1WalletCustodyCommitStore`](../packages/wallet-server/src/router/cloudflare/d1/passkeyCustody/d1WalletCustodyCommitStore.ts),
and their
[`putManyWithAdditionalStatements`](../packages/wallet-server/src/router/cloudflare/d1/versionedJson/d1VersionedJsonRecordStore.ts)
batch boundary. These transactions reinforce the whole-namespace experiment
boundary. Splitting recovery locators, authentication state, or envelope records
into independent regional authorities would break existing atomicity. This review
does not establish a whole-registration transaction across separate commits or
complete the scheduled-work, administration, role-DO, and transfer proofs.

### Runtime routing

[`hosted-wallet-gateway.ts`](../packages/wallet-server/src/hosted-wallet-gateway.ts)
selects `SIGNER_DB` and the namespace/org/project/environment from deployment
configuration. There is no production owner-to-region directory or home
generation in this path. This supports a statically pinned benchmark deployment;
it does not prove stale-route rejection or safe failover between databases.

The policy store exposes set/clear methods. The current benchmark policy E2E
updates isolated SQLite directly. This review found no production call site for
those setters in the Wallet source or Console apps/packages. Thus a complete
regional policy administration path remains to be designed and verified.

Production Gateway composition reaches Console through service-binding clients
for API/publishable-key authorization, environment resolution, usage, and active
tenant-root lineage. The benchmark substitutes the existing static Console
binding. Its placement result measures that isolated topology. It cannot
establish production latency or consistency for remote Console dependencies;
each affected production route needs a measured dependency inventory.

An October 1 follow-up inspected private Console source at `83eb3301` in
`seams-monorepo`. Its split Gateway
(`packages/wallet-console-server-ts/src/router/cloudflare/d1GatewayWorker.ts`)
resolves the active deployment binding through `WALLET_CONSOLE` before every
request and scheduled invocation. `tenantDeployment/d1.ts` implements that
resolution as one joined active-binding/binding D1 read. Thus the four-request
owner and two-request linked paths imply four and two additional Console D1
binding reads in that composition, before counting its other Console operations.
This is a source-derived request inventory, not a hosted production measurement.
The existing `wallet_gateway_binding` timing can help measure the added leg.

The follow-up private Gateway change `286bc83` extends the existing
`wallet_gateway_binding` and `wallet_gateway_total` Server-Timing entries to
`/wallet/session/status`. The two owner status requests previously omitted those
metrics, although they performed the same binding lookup. Existing ECDSA route
timing is retained. Type-checking, lint, and formatting passed. This change is
committed locally and has not been deployed; none of the hosted cohorts include it.
The timing is complete binding-lookup wall time, not isolated Console SQL time or
served-region metadata. Measuring those costs still requires an isolated deployment
of the real Console composition.

Private follow-up `78e3132` now retains D1 metadata from the same joined binding
query and forwards allowlisted wall/SQL/region/primary timing through the internal
service response to ECDSA and status responses. Its isolated local service E2E
verifies fresh revision reads, wrong-lane rejection, unavailable state, and timing
propagation through the production Console Worker and resolver. This proves the
measurement path locally; hosted Console latency and regional metadata remain
unmeasured. See [the Console preparation results](refactor-152-results.md#console-composition-preparation).

The normal prepare/finalize route definitions use session-principal authentication
and no API-key metering. The exact status handler reads the Wallet Session's
operation credential directly. Do not blindly add all Console client operations
to every signature budget merely because the composition provides them. Inventory
registration, unlock, refill, step-up, and recovery separately, and measure actual
service calls. The four/two active-binding reads above remain a source-derived
minimum for the private owner/linked composition.

Private follow-up `7eef6d4` verifies full Console Worker initialization and the
real Wallet 0.7.3 service client locally, including credential rotation/revocation
freshness, origin/environment rejection, environment resolution and missing-root
rejection. The production fixture audit prevents directly reusing the static
benchmark: its publishable-key format and `bench` environment are unsupported by
Console, and its reduced bootstrap receipt lacks the journal/capability digests
required by the Console grant store. A fresh development fixture must use normal
Console issuance/provisioning and preserve the full ready response. Keep one
Console authority fixed across the first authenticated Gateway-home comparison.
No successful root provisioning, usage ingestion, full signing or regional
latency is claimed by this local test. See the
[preflight evidence](refactor-152-results.md#authenticated-console-local-preflight-october-1).

Hosted fixture preparation subsequently provisions complete active root receipts
for fresh, disjoint development organizations. Console authority remains in the
APAC database while each Wallet namespace is bound to its one APAC or WEUR home.
The additional Console schema preserves all pre-existing Wallet schema objects.
Private E2E commit `afb77c6` verifies duplicate wallet-created usage delivery
produces one Console Wallet projection without a monthly active-resource charge.
This establishes local usage replay behavior and hosted root provisioning;
a subsequent hosted diagnostic verifies eighteen signatures, while exposing
a missing registration-to-Console Wallet projection path. That producer path is
now connected through a validated private Console operation. Hosted lost-reply
and exact replay checks create one projection per registration. A separately
built server candidate verifies eighteen reversed-order linked-chain signatures
and ten cold-unlock/burst signatures across APAC and WEUR. Four new Wallet
projections persist with zero monthly-active-resource rows; the two burst
samples use different recorded boots. Production routing remains gated on repeated
measurements, remaining workload coverage and the authority proofs below.
See the [fixture and startup evidence](refactor-152-results.md#hosted-console-fixture-provisioning-october-1).

A separate local Docker browser follow-up verifies ten cold-unlock/burst
signatures and two activation-loss recovery signatures against hosted services.
Ordinary cold unlock uses 39 Gateway D1 calls plus two Console calls; activation
recovery uses 35 plus two. Both include nine runtime schema/initialization calls,
a concrete target for a separately fingerprinted optimization. Recovery rejects
an altered activation digest, resumes the same wallet/key after reload and
creates exactly one Console projection per registration, with zero monthly
billing rows. These local-browser observations close diagnostic accounting and
ECDSA recovery correctness, without establishing regional browser placement or
production home-routing safety. See the [detailed evidence](refactor-152-results.md#unlock-accounting-and-activation-recovery-october-1).

The following candidate removes the nine initialization calls after verifying
the canonical migrations and singleton authority guard in both databases.
Thirty verified signatures cover cold unlock, activation-loss recovery and
two-generation linking. Cold unlock now uses 30 Gateway D1 calls and recovery
uses 26, with two Console calls each; remaining query multisets are unchanged.
Each unlock still reports 33 rows written. This optimization preserves the
transactional authority boundary and leaves production home-selection and
stale-writer fencing proofs open. The longer E2E also exposes and fixes an
IPv6/IPv4 test-service readiness mismatch; failed attempts remain in the log.
See the [candidate results and cleanup](refactor-152-results.md#removing-request-time-authority-initialization-october-1).

Reuse the existing deployment lane, canonical binding revision, activation
sequence, and bound tenant namespace as the starting routing model. The shared
`tenant_deployment_binding_v1` currently carries tenant identity, origins,
custody lineage, credentials, and policy digest; it carries no D1 database home.
The runtime binder validates the lane and replaces tenant identity fields while
leaving `SIGNER_DB` supplied by deployment configuration. Consequently, the
existing binding revision alone cannot prove database-home identity or fence a
stale writer. A new home directory should not duplicate this existing authority;
prove how deployment binding and the actual database are bound together first.

The private `d1WalletRuntimeWorker.ts` is another home-selection boundary. It
handles runtime inspection against `SIGNER_DB` and internal wallet-control
requests before resolving the active tenant binding. Registration setup also
checks the Console cutover-admission gate. Include those authenticated internal
paths explicitly in the ownership proof; a check added only to the public
Gateway would leave this control path outside that check.

The existing `tenantDeployment/runtimeInspection.ts` counts source and target
wallets in the same configured database, scoped to project/environment. It checks
in-flight ceremonies only in the target scope and returns the requested binding
revision as its acknowledgement. `tenantDeployment/readiness.ts` uses those
counts for environment cutover readiness. This establishes neither a whole
namespace's emptiness/drain status nor the identity of a regional database.
Regional home assignment needs those additional proofs; the existing readiness
response cannot authorize moving an existing namespace. This is a limit of
reusing the current environment-cutover protocol for regional routing.

The Wallet runtime's `readWalletRuntimeIdentities` in `hosted-wallet-gateway.ts`
also reads multiple wallet signers by namespace and organization, then filters
returned records by the requested project. Its control request can span projects.
Together with the vault store's namespace/tenant identity, this reinforces the
whole-namespace/organization starting boundary. It does not prove that every
remaining lifecycle operation is safely partitionable.

For the next routing implementation, extend the existing canonical deployment
binding with a server-assigned immutable initial database home. Bind that identity
to the actual database used by public Gateway, internal control/inspection, and
scheduled work before admitting mutations. Keep existing owners at their current
database. Prove wrong-home and stale-binding rejection with the same operation
sent through different entry regions, including last-quota and completed-replay
cases. A binding revision or local CAS guard alone cannot supply this proof.
Production Console dependency timing and the full lifecycle inventory remain
prerequisites to activation.

Custody remains in the existing role-specific DO deployments. Fresh wallet and
presign identities create new wallet/session objects; shared tenant-root objects
can remain shared. Record those distinctions and aggregate role placement. A D1
region hint never proves same-datacenter placement with any DO.

## First bounded experiment

The experiment starts from R151's London owner SDK median of 2,680.5 ms and linked
median of 2,487.0 ms. The owner has seven full-path D1 calls; linked signing has
five. Both retain five prepare/finalize calls and two write-bearing calls. Full
source/build identities and request accounting are in
[the R151 session-read evidence](refactor-151-session-read.md).

1. Reconcile cost and verify the restored benchmark state immediately before
   execution. Latest recorded cumulative spend is $1.0530 against $25, subject
   to accounting lag. Retain the cap and existing Cloudflare-only scope.
2. Create two empty benchmark databases: `r150-bench-20261001-r152-apac` with
   `apac`, and `r150-bench-20261001-r152-weur` with `weur`. Apply the same 39
   migrations to each. Record IDs, migration hashes, and observed served regions.
   This fresh APAC control avoids attributing database age to location.
3. Assign distinct deployment namespaces `r152-apac-control` and
   `r152-weur-treatment`. Keep the existing benchmark org/project/environment and
   service credentials. Each namespace uses its single database throughout.
   Reuse existing benchmark Gateway, ingress, role deployments, and London probe
   sequentially; restore the matching namespace/database pair when switching
   arms. Preflight the exact config delta, existing role bindings, and readiness
   before wallet operations. Do not change tenant-root identity merely to change
   Gateway storage placement.
4. Freeze SDK `a2c936ed`, Gateway implementation `dad8f5e9`, role builds,
   migrations, concurrency, refill settings, and static Console fixture. Change
   database/namespace only. Default Gateway placement is retained. Use fresh
   wallets in both arms and alternate APAC→WEUR then WEUR→APAC order. Do not reuse
   wallets across databases or change DO placement as a second treatment.
5. First run a diagnostic of three three-device cohorts per arm (27 signatures
   per arm), splitting the order into alternating blocks. Verify every signature,
   exact seven/five call accounting, served region/primary metadata, precompleted
   linked presigns, failed-attempt denominator, and stable probe boot/build.
   Report owner and linked distributions separately; this diagnostic is below
   the plan's acceptance sample target and cannot close the performance gate.
6. If the diagnostic succeeds and indicates full-path benefit, extend to at
   least 30 owner and 30 linked signatures per arm across repeated runs. Run
   immediate-first, ready-pool, and burst workloads separately before extending
   to other probe regions. Retain the 20% and 100 ms full-path p95 decision gate
   and report observed maxima and error rates. A warm-pool win does not establish
   the 1–2 second maximum.
7. Close access, stop probes, restore original Workers/images/configuration,
   and reconcile cost. Preserve the original D1 and all old evidence. Retain the
   new databases closed to benchmark traffic until evidence review; deletion is
   a separately explicit cleanup action. Never reset an existing wallet.

Cloudflare location hints apply at database creation and are best effort.
Verify actual metadata after provisioning. D1 batches execute transactionally
within one database; read replicas and session bookmarks do not create a
cross-database transaction or a globally fresh authorization authority. See
[data location](https://developers.cloudflare.com/d1/configuration/data-location/),
[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
and [read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).

The initial takeover scope allowed existing isolated resources only. After this
concrete plan was presented, the October 1 instruction to implement R152
authorized its two new isolated databases. Provisioning and verification are
recorded in [the experiment log](refactor-152-results.md). The $25 cap remains;
production activation, existing-owner migration, and new credentials are outside
this experiment.

The user subsequently approved one temporary Worker, DO namespace and Container
application to investigate the Tokyo blocker. This permits the isolated
`r150-bench-20261001-tokyo-recovery` probe with the existing credential and frozen
SDK image, followed by deletion of its temporary resources. The cumulative $25
cap and exclusion of staging/production changes remain in force.

## Verification and remaining proof

The focused Workers D1 run passed all three existing scenarios: canonical and
third-generation policy E2Es plus concurrent last-quota contention (42.2 seconds).
The policy cases verified six signatures, 18 denials, exact completed replay,
and unrelated-scope isolation. Evidence is retained alongside the schema in
`.artifacts/r152/ownership-20261001/`, including `verification-run.json`, both
`gateway-ecdsa-live-policy-*` artifacts, and `gateway-ecdsa-last-quota-workers_local.json`.
Reproduce with the intended-behavior runner on
`passkey.presign-pool.contract.test.ts --grep 'live signing policy denies|third-generation linked signing enforces live policy|distinct concurrent prepares consume the last quota'`.
These
checks establish current behavior on one authoritative database. They do not
test regional routing or dual-writer fencing.

Before production implementation, complete semantic ownership review for every
lifecycle/admin/scheduled path, define a trusted owner/home identity and stale
route rejection, inventory Console/shared authority costs, and run concurrent
entry-region/replay tests. Existing-owner migration remains a separate phase.

The subsequent Tokyo ready-material extension verifies 180 signatures and meets
the 30-owner/60-linked sample target per arm. Its APAC p95 advantage over WEUR is
34.9% for owners and 44.9% for linked signing. One additional collection attempt
failed with unknown Wallet outcome; preserve that denominator and the static
Console scope. Together with London, this supports continuing the regional home
design while retaining the correctness and production-composition gates above.
See the [complete comparison](refactor-152-results.md#tokyo-sample-extension-october-1).
