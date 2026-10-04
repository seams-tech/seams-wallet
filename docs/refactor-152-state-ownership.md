# R152 state ownership baseline for R153

Revision 5 — October 4, 2026.

This freezes the **schema inventory and ownership obligations**, not a copy-ready
relocation implementation. R153 must fail closed for unresolved ownership below.
A table with a `wallet_id` column is not necessarily regional, and a table without
one is not necessarily shared. No namespace-wide copy is safe.

Original schema baseline source revisions: Wallet `126766e11b7301fd398c5edbfc3dbe9c0e4d9c6c`, private
Console `09e28d6661e19f32ccccf6c64e2cfd803026edbe`. Signer migrations through
`0044_linked_device_bootstrap_imports.sql`; Console through
`0069_linked_device_bootstrap.sql`. Concurrent R153 changes to `home.ts` and migration
0070 are excluded. Any later schema or ownership change requires a new revision.

Evidence in the private repo:
`.artifacts/r152/ownership-freeze-20261003/schema-baseline.json`, SHA-256
`eced8076c98170b3dd88093d3b892c0d3d63cd65627f9fd77efa557224026e01`.
All baseline migrations applied to fresh SQLite: 56 signer tables and 84 Console
tables, integrity checks `ok`, no foreign-key violations. The artifact includes
migration hashes and every effective table's columns and primary-key order.
This is schema evidence, not a running-wallet relocation test.

## Selection and transaction rules

The wallet ownership key is namespace + organization + project + environment +
wallet ID. Tables using `tenant_id` must derive its exact stored identity from the
wallet's authorized session/tenant records; never equate it to organization ID.
Preserve all primary keys, replay digests, counters, versions and terminal records.
An expired row may still prevent resurrection or double consumption.

Select direct wallet rows first, then their scoped children. A join must retain the
full available tenant scope. An ambiguous, orphaned or unknown record stops the
move; it is never silently omitted. Installation order must respect destination
triggers and parents. Schema guard tables are initialized by migrations, not copied.

Drain or fence active writers before a snapshot. This includes source-device
contributions, target acknowledgements, session issuance/redemption, signing quota
claims, recovery commits, deferred NEAR provisioning and material refill. A request
that started before relocation must not commit into an old home after cutover.
Copying D1 does not move Durable Object state or Container-held material.

## Complete signer-table classification

“Wallet” means regional ownership, with the specified selector. “Blocked” means
R153 has no approved complete row selector yet. This is an exhaustive table list
for the baseline, grouped only where the selector and obligations agree.

| Tables | Owner / selection / copy obligation |
| --- | --- |
| `wallets`, `wallet_signers`, `wallet_auth_methods`, `wallet_authorities` | Wallet: exact scoped `wallet_id`; preserve signer activation, method and authority provenance together. |
| `wallet_auth_method_revocation_replays` | Wallet: exact scoped `wallet_id`; retain committed answers and proof digests. |
| `wallet_ecdsa_pending_session_activations`, `wallet_recovery_code_locators`, `yao_lifecycle_decisions` | Wallet: exact scoped `wallet_id`; preserve pending/terminal lifecycle decisions and recovery uniqueness. Shared routing entries remain in Console. |
| `email_otp_auth_states`, `email_otp_unlock_challenges`, `email_otp_wallet_enrollments` | Wallet: exact scoped `wallet_id`; provider subject alone is not unique wallet ownership. |
| `email_otp_challenges`, `email_otp_grants` | Wallet: exact `(namespace, org_id, project_id, env_id, wallet_id)`. Both tables require a nonempty wallet ID matching parsed JSON. Registration challenges carry the candidate wallet ID before activation; shared registration offers remain in Console. Retain challenge/grant/registration-consumption atomicity and the verification receipt described below. |
| `wallet_session_authorizations_v2`, `wallet_session_hosted_credentials_v2`, `wallet_session_hosted_exchange_codes_v2` | Wallet: exact scoped `wallet_id`; preserve issuance, retirement, redemption and parent-child lifecycle triggers. |
| `authorization_wallet_session_quotas` | Wallet child: join the selected session's namespace, tenant, quota and session IDs; preserve remaining uses and retirement. |
| `authorized_operations`, `authorized_operation_audit_events` | Blocked selector: derive all ordinary and linked authorization branches through exact parent authorization/evidence/quota identities. `linked_wallet_id` covers only the linked branch. Preserve replay/result and audit state atomically with quota claims. |
| `verified_owner_proof_consumptions`, `verified_wallet_operation_evidence_sets` | Wallet: scoped wallet identity plus tenant; retain consumed proofs and evidence used by operations. |
| `lane_enrollments`, `lane_protocol_operations`, `lane_product_epochs`, `lane_effect_journal` | Wallet: exact scoped `wallet_id`; keep enrollment, operation, epoch and durable effects together. Drain/fence in-progress protocol effects. |
| `lane_locks`, `lane_receipts` | Wallet children: join scoped selected enrollment/operation IDs; do not transfer a live lock as fresh ownership. Preserve replay receipts. |
| `linked_device_authority_allocations`, `linked_device_authority_installations`, `linked_device_ed25519_export_root_transfers`, `linked_device_email_otp_grants`, `linked_device_target_credentials`, `linked_device_wallet_session_credential_deliveries_v1` | Wallet: exact scoped `wallet_id`; preserve installation, encrypted packages, reservation IDs, delivery and acknowledgement/cleanup receipts together. |
| `linked_device_sessions`, `linked_device_session_transcripts`, `linked_device_target_commit_reservations`, `linked_device_bootstrap_imports` | Wallet children: resolve scoped link IDs through Console `wallet_routes` kind `linked_device`, plus validated local session/claim records. Import receipts may survive deletion of sessions and target rows; select those via the shared route, never only via surviving local parents. |
| `near_public_keys` | Blocked selector: `user_id` is not a wallet ID contract. Resolve through validated wallet signer/auth identity; retain removal markers. |
| `webauthn_authenticators` | Wallet counter state: resolve RP/credential through scoped wallet auth methods and bindings. Do not infer wallet from `user_id`; preserve counters. |
| `webauthn_challenges` | Mixed lifecycle: shared sync challenges use Console. Local login/unlock/registration challenge records require kind-specific parsed wallet/ceremony ownership and shared challenge routes. Block unknown kinds and unresolved pre-wallet challenges. |
| `webauthn_credential_bindings` | Regional credential projection: select credentials belonging to selected wallet auth methods; Console `wallet_passkey_claims` is the shared uniqueness/routing authority. Local bindings are not authority to reassign a credential. |
| `registration_ceremony_records` | Wallet: exact tenant scope, supported record scope and parsed wallet identity from the selector table below. Preserve setup snapshots, claims and terminal replies independently of surviving ceremony parents. |
| `router_ab_yao_capability_replacements` | Wallet: migration 0045 requires exact scoped `wallet_id`. Copy old/new capability decisions and replay fingerprints together, including terminal receipts after lifecycle cleanup. Retries verify the same wallet. |
| `router_ab_yao_versioned_json_records` | Mixed, blocked selector: classify by supported prefix and parsed record ownership. Includes custody/recovery secrets and replay state; never copy all namespace rows or omit the table. |
| `router_ab_normal_signing_admission_records` | Explicit split after migration 0046: `abuse` rows require scoped `wallet_id`; `project_policy` rows require NULL wallet ownership and remain tenant policy. Select all wallet abuse rows across signing-root versions, retaining authority-specific keys and decisions. Retired quota records and columns are removed; active quota state lives in `authorization_wallet_session_quotas`. Existing atomic credential/policy SQL reads are preserved. |
| `identity_links`, `email_otp_registration_attempts`, `email_otp_rate_limits`, `linked_device_request_proof_nonces` | Hosted shared authority is Console. Do not relocate or independently reset/consume these signer-schema copies. Verify every hosted caller uses the injected shared service; table existence also supports self-hosted composition. |
| `vault_proxy_secrets` | Shared tenant/vault/item state, no wallet ownership. Excluded from wallet relocation. |
| `deployment_resource_challenges` | Resource-local deployment proof, excluded; the destination must prove its own identity. |
| `lane_cas_guard`, `linked_device_session_cas_guard`, `registration_ceremony_cas_guard`, `router_ab_yao_versioned_json_cas_guard`, `wallet_authority_cas_guard` | Schema guard tables, excluded from row copy. Destination migrations install them and their triggers. |

## Authorization operation selection

Start with the wallet's fully scoped `wallet_session_authorizations_v2` rows and
its `verified_wallet_operation_evidence_sets` rows under the validated tenant ID.
Resolve operation ownership by its authorization discriminant:

- `authorization_source_kind = 'authorization_grant'`: exact join on
  `(namespace, tenant_id, authorization_id)` to the selected session set. For a
  consuming operation, require its `quota_id` to match the session quota; include
  that quota by `(namespace, tenant_id, quota_id, wallet_session_id)`.
- `authorization_source_kind = 'verified_step_up'`: exact join on
  `(namespace, tenant_id, evidence_set_digest)` to the selected evidence set.
- Linked operations additionally require `linked_wallet_id` and their linked
  organization/project/environment to agree with the selected wallet. That field
  is a consistency check, not the selector for ordinary owner operations.

Select audit rows by `(namespace, tenant_id, authorized_operation_id)` from the
selected operations and verify their fingerprint and authorization identity agree.
Retain pending and completed operations, result bodies, audits, expired/retired
sessions, evidence and exhausted quotas together. Public active-session readers
are unsuitable for this extraction. A missing parent or conflicting ownership
stops extraction; the current schema does not independently encode full wallet
ownership on operation/audit rows. Proving parent retention across every lifecycle
cleanup remains necessary before declaring this selector closed.

## Capability replacement ownership (revision 2)

Migration `0045_wallet_owned_capability_receipts.sql` adds required wallet ownership
by replacing the empty receipt table. Existing unowned receipts cause migration to
stop before dropping the table; the disposable-wallet reset must precede it. There
is no inference, legacy reader, nullable owner or compatibility fallback.

The exact selector is `(namespace, org_id, project_id, env_id, wallet_id)`, indexed
by `capability_replacements_wallet`. The operation primary key remains scoped by
namespace/organization/project/environment so reusing an operation ID for a different
wallet is a conflict. The persistence service rejects previous/next capabilities
with different wallet IDs before any mutation and checks receipt ownership on replay.

Verification: Wallet `.artifacts/r152/wallet-owned-receipts-20261004/verify.py`
reapplies all 45 signer migrations and produces `evidence.json`: exact two-wallet
selection, rejection of an empty owner, rejection of populated unowned-table upgrade
without receipt loss, and SQLite integrity `ok`. Wallet-server type checking passes.
This closes this receipt selector; it does not claim the remaining opaque selectors
or relocation execution are complete.

## Shared Console records

All 84 Console tables remain at the shared Console authority. Relocation updates
its explicit placement state; it does not copy Console rows into regional signer D1.
Wallet-associated Console indexes, balance snapshots, key-export workflow, audit,
policy, billing and sponsorship rows remain shared even when they contain wallet IDs.

The placement-sensitive subset is:

- `wallet_homes`: one placement authority; R153 owns its explicit move transition.
- `wallet_routes`: scoped opaque locator → wallet. Resolve the current home by join;
  retain retired/cancelled link routes needed to locate import tombstones.
- `wallet_session_locators`: opaque session/exchange credential → wallet and expiry.
- `wallet_passkey_claims`: scoped RP/credential → wallet; relocation does not release
  or reassign credential ownership.
- `identity_links`, `email_otp_registration_attempts`, `email_otp_rate_limits`:
  identity uniqueness, pre-wallet offers and cross-region rate consumption.
- `wallet_sync_challenges`, `linked_device_bootstrap`,
  `linked_device_request_proof_nonces`: shared pre-wallet discovery/bootstrap and
  one-use request protection. Retain consumption history during a move.

## Opaque-record and deferred-work inventory

The hosted registration store uses the literal `gateway-registration:` prefix on
`record_id`. Select the exact namespace/organization/project/environment first,
then dispatch by `record_scope` and parse `record_json` with the corresponding
`parseD1Stored…` function in `d1RegistrationCeremonyRecords.ts`:

| `record_scope` | Parser suffix | Exact owner after parsing |
| --- | --- | --- |
| `setup-ceremony`, `ceremony` | `WalletRegistrationCeremony` | `intent.walletId` |
| `add-signer-intent` | `AddSignerIntent` | `intent.walletId` |
| `add-auth-method-intent` | `AddAuthMethodIntent` | `intent.walletId` |
| `add-signer` | `WalletAddSignerCeremony` | `intent.walletId` |
| `add-auth-method` | `WalletAddAuthMethodCeremony` | `intent.walletId` |
| `add-signer-finalize-replay`, `add-signer-finalize-claim` | `WalletAddSignerFinalizeReplay` | `response.walletId` |
| `add-auth-method-finalize-replay` | `WalletAddAuthMethodFinalizeReplay` | `response.walletId` |

The store encodes the parsed domain value directly. Retain its full record ID,
version, expiry and JSON, including expired rows. Do not use public getter methods
for extraction: several deliberately hide expired records. Select both finalize
replay and claim rows even after their source ceremony is consumed. Validate each
record's ID using the construction in `d1RegistrationCeremonyStore.ts`; the
add-signer replay has a composite ID built by `addSignerFinalizeReplayKey`.

Email OTP registration verification also writes `registration_ceremony_records`
under `record_scope = 'email-otp-registration-verification-v1'`. Its `record_id`
is the complete challenge ID, **without** `gateway-registration:`. Parse with
`parseEmailOtpRegistrationVerificationReceiptV1` in `d1EmailOtpRecords.ts`; the
exact owner is `verified.walletId`, within all four tenant scope columns. Require
`verified.challengeId` to equal the record ID and `verified.orgId` to match the
organization. Preserve the request fingerprint, version and expiry. Challenge
consumption and receipt creation share one guarded D1 batch; the receipt remains
selectable after its challenge is deleted. An extraction must read expired rows
without using `readRegistrationVerificationReceipt`, which can prune them.

Email OTP challenge/grant extraction uses the stored `wallet_id` and the existing
`parseCurrentEmailOtpChallengeRow` / `parseCurrentEmailOtpGrantRow` boundary parsers
in `EmailOtpRecords.ts`; require parsed ownership to agree with that column.
A provider subject or `user_id` cannot replace the wallet selector. The effective
challenge schema (migration 0027) and grant schema (0001) require nonempty wallet
ownership and JSON agreement. Unactivated registration state remains with its
candidate wallet; it is never reassigned by matching a provider subject. A row
whose wallet allocation cannot be resolved must block extraction.

`local-registration-authority:` is the standalone host's authority and must be
absent from a hosted extraction. Its `setup-reservation` payload contains
`reservation.walletId`; `setup-ceremony-index` and `setup-terminal` contain
`walletId`. Hosted admission keeps that authority in Console. Unknown prefixes,
record scopes or invalid parsed records stop extraction.

The production composition places registration side-effect records in
`router_ab_yao_versioned_json_records` under `router-ab-yao-sponsored-account:`,
`wallet-registration-activate:`, `wallet-registration-near-provisioning:`,
`wallet-add-signer-start:` and `wallet-add-signer-finalize:`. These must accompany
the corresponding ceremony or wallet, including completed replay answers.

Other known versioned-JSON namespaces include `passkey-envelope:` (also recovery
sets and backup acknowledgements written by the custody commit store),
`passkey-credential-activity:`, `wallet-recovery-google-email-otp:` and the default
`router-ab-yao:`. Parse each payload using its owning store/domain contract before
assigning it to a wallet; text matching a wallet ID inside JSON is not an ownership
rule. This prefix list is a starting boundary inventory, **not** an
exhaustive approved extraction registry. Unknown prefixes block a move until their
owning store and exact selector are accounted for.

Registration activation and NEAR-provisioning effects have durable shared
ownership even after local ceremony cleanup: select the wallet's Console
`wallet_homes.ceremony_id`, then the exact keys
`wallet-registration-activate:registration-activate:<ceremonyId>:<idempotencyKey>`
and `wallet-registration-near-provisioning:near-provisioning:<ceremonyId>:<idempotencyKey>`.
Use the complete server-allocated ceremony ID and its separator; never a partial
wallet-ID match. Validate records using their existing side-effect parsers. Their
prepared authority/device/auth-method IDs must agree with the shared allocation;
completed receipts must agree with the wallet. Retain claims as well as completions,
including the request/prepared fingerprints and replay receipts.

The `wallet-add-signer-start:` payload retains
`prepared.storedIntent.intent.walletId` in both claim and completion variants.
Parse with `parseD1WalletAddSignerStartSideEffectRecord` before selecting that owner.
The `wallet-add-signer-finalize:` prefix now requires `prepared.walletId` on both
curve branches and on both claims and completions. Parse with
`parseD1WalletAddSignerFinalizeSideEffectRecord`; successful response ownership must
agree with the prepared owner. Execution resumed from a claim checks that owner
against the ceremony or surviving replay. This remains selectable after ceremony
cleanup, including a failed terminal response with no response-level wallet ID.
Unowned old records are rejected; disposable-wallet reset handles the cutover.
The `router-ab-yao-sponsored-account:` prefix now requires `prepared.walletId`
plus `prepared.transaction` in both claims and completions. Select the exact tenant
scope and parsed prepared wallet ID, retaining the entire signed transaction,
fingerprints, claim version and terminal response. `d1SponsoredNearAccount.ts`
validates this boundary; unowned prior payloads are rejected. The request fingerprint
includes the wallet and the prepared fingerprint binds that owner to the existing
validated signed-transaction fingerprint. A resumed broadcast also checks the owner.
No surviving ceremony or NEAR-account-name inference is needed.

The custody and Google recovery prefixes have these concrete selectors. Always
apply all four tenant scope columns before interpreting the key:

| Prefix | Exact selection and validation |
| --- | --- |
| `passkey-envelope:` with a JSON-array suffix | Decode the complete array emitted by `passkeyCustodyEnvelopeRecordKey`; its first element is the wallet ID. Validate the payload with `parsePasskeyCustodyEnvelopeRecord` and require its `walletId` to agree. Retain every factor/envelope branch and revoked state. |
| `passkey-envelope:recovery-set:` | Exact suffix is the wallet ID, built by `walletRecoveryEnvelopeSetRecordKey`; validate the recovery-set payload and matching wallet. |
| `passkey-envelope:wallet-recovery-backup-ack/` | Exact suffix is the wallet ID, built by `walletRecoveryBackupAcknowledgementRecordKey`; retain backup acknowledgement with its recovery set. |
| `passkey-credential-activity:` | Decode the JSON array `[walletId, envelopeId]` emitted by `activityRecordKey`; validate the matching activity payload. |
| `wallet-recovery-google-email-otp:` | Parse with `parseWalletRecoveryGoogleEmailOtpAttemptRecord`; select its required `walletId`, including completed attempts. Check the full key against `walletRecoveryGoogleEmailOtpAttemptKey(recoveryOperationId)`. |

Use unfiltered persisted rows for this accounting, including expiries, versions,
revocations and terminal decisions. User-facing list methods can cap results or
filter retired material. These selectors close the listed prefixes only; the
side-effect prefixes and default `router-ab-yao:` still need their exact extraction
contract completed.

Gateway dispatch already recognizes registration `near-admission` and
`near-provisioning` continuations by ceremony allocation. That routing alone does
not prove an in-flight deferred write is fenced across home changes. Scheduled
Router prewarm uses tenant deployment scope before a wallet exists; it must remain
tenant-owned, with no attempt to derive a wallet from a root or capability ID.

## Wallet DO and pending execution ownership

The current Rust source uses wallet Durable Objects plus role-private D1. These
are separate persistence authorities from signer D1. Object identity includes the
regional binding/namespace as well as the name; identical names in different
regional namespaces do not refer to the same object.

| Authority | Wallet selector and retained state |
| --- | --- |
| `DERIVER_A_WALLET_DO` | `DeriverAWalletOwnerV1`: organization, project, environment, wallet. Name is `deriver-a-wallet-` plus SHA-256 of domain `seams/deriver-a/wallet-do/v1` and serialized owner. Retain `wallet_owner`, all `yao_pair_sessions` revisions/ciphertexts/lifecycle/claimed state and `yao_pair_admission_fences`. Root rotation does not change the object name. |
| `DERIVER_B_WALLET_DO` | `DeriverBWalletOwnerV1`: same four owner dimensions; wallet comes from validated `pair_binding.binding().lifecycle.account_id`. Domain/name use `deriver-b`. Retain `wallet_owner`, pair sessions (including expiry and root digest), and admission fences. |
| `SIGNING_WORKER_WALLET_DO` | `CloudflareSigningWorkerWalletScopeV1`: organization, project, project environment, wallet. Name is `signing-worker-wallet-` plus domain-separated SHA-256 (`seams/signing-worker/wallet-do/v1`) of serialized scope. Retain the eight tables listed below together. |
| `SIGNING_WORKER_PRESIGN_SESSION_DO` | Per-presign execution authority. Durable `owner-presign-authority` pins the request; subsequent steps compare the complete authority. Live owner/linked cryptographic sessions are in memory. Completed linked presignatures have durable session/server-key indexes and consumption semantics. These require separate accounting from the wallet DO. |

The SigningWorker wallet tables are `wallet_registrations`,
`wallet_retired_activations`, `wallet_linked_ed25519`, `wallet_round1`,
`wallet_ecdsa_pool`, `wallet_ecdsa_effects`, `wallet_ecdsa_activations`, and
`wallet_linked_ecdsa` (eight tables; harness fault tables are excluded).
Preserve round-one prepared/claimed/completed state, pool versions, activation
retirement, effect authorization uniqueness, request digests and terminal answers.
Pending pool material is single-use cryptographic state; it cannot be regenerated
under an already-consumed identity or treated as an ordinary cache.

Pending execution rules verified against source:

- Deriver B's `ed25519_yao_lifecycle.rs` background WebSocket execution captures its
  original `Env`, role runtime, validated pair binding and tenant-root context.
  Before scheduling, the claimed pair/root are checked against the admitted scope.
  Its failure completion uses that same wallet pair scope and captured environment.
  There is no location-based re-selection after scheduling.
- Presign expiry alarms clear the owner in-memory session and its durable authority
  claim. The authority identity includes immutable expiry. A move must account for
  these alarms and linked completion records separately; copying D1 cannot transfer
  a live protocol session.
- Registration NEAR admission/provisioning continuations resolve the ceremony's
  fixed home before claiming their persisted effect. The 30-second resumable effect
  lease is retry coordination, not permission to execute at another home.
- Tenant-root rotation/recovery and tenant prewarm are tenant-owned. Their records
  and root-use admissions are not wallet material simply because a wallet caused
  an admission. Wallet pair fences and role-private root-use claims must both be
  settled before retiring a running pair.

R152 supplies fixed-home execution. R153 must drain or fence these writers before
snapshot/cutover and abort/restart live protocols with fresh identities where they
cannot be transferred. Existing `wait_until` capture is not a relocation fence.
The tracked Cloudflare role configs contain Workers/DO bindings; no Container
application is declared there. An October 4 read-only Wrangler inventory of account
`ba924da36f2ffc3839e8d323000b66b4` returned 11 applications, including the three
`r150-bench-20260925-probe-probe{enam,weur,apac}` applications. These correspond to
the regional Playwright probe in `tests/r150-hosted/probe/worker.mjs`: its DO is named
`probe`, forwards browser attempts, and does not write authoritative wallet records.
Probe browser state and results are experiment artifacts, excluded from wallet
relocation. Eight unrelated applications were excluded from this task. No Container
was stopped or changed. The sanitized receipt is
`.artifacts/r152/wallet-owned-receipts-20261004/wallet-container-accounting.json`.
This account inventory does not prove deployed role Worker versions match current
source; that remains part of the regional deployment verification.

Source anchors: `durable_object/deriver_a_pair.rs`, `deriver_b_pair.rs`,
`signing_worker_wallet.rs`, `ecdsa_presign_live_session.rs`, `durable_object/mod.rs`,
`signing_worker/wallet_ecdsa_store.rs`, and `ed25519_yao_lifecycle.rs` under
`crates/router-ab-cloudflare/src`.

## October 4 ownership evidence

The existing regional recovery E2E now records ownership counts in its receipt.
A US Email-OTP-founded wallet recovered through APAC after a lost finalization
response and Gateway restart, then signed NEAR and concurrent EVM transactions.
The run passed: one retained `setup-ceremony` and six authorization-grant operations
resolved to that wallet in US, each operation retained its audit row, and both
remote homes contained none. This exercises the ordinary authorization join and
setup retention; it does not exercise step-up/linked operation ownership or every
terminal ceremony scope.

Private artifact:
`.artifacts/r152/ceremony-ownership-20261004/google-recovery-email_otp-US/recovery-evidence.json`
SHA-256 `bb534ff270b465a39f79084803d82b88f2a8e6e89883de4cd936507fa1e1d711`.
The initial attempt stopped before registration because the Google token expired;
the repository token-refresh command succeeded and the retry passed. ESLint and
diff checks passed. Reproduce with `SEAMS_WALLET_SERVER_CANDIDATE` pointing to the
public package and `node tests/scripts/run-regional-real.mjs
 google-email-otp.recovery.contract.test.ts --grep 'US email_otp-founded'` in the
private repository. `SEAMS_INTENDED_SKIP_BUILD=1` reuses already-built binaries
when sources have not changed; the successful run rebuilt its candidate.

## Closure gates owned by R152

- [x] Internal Wallet Runtime routing: `regionalWalletIdentities.ts` partitions
  identity batches by authoritative wallet home; the Runtime rejects wrong-home
  direct reads. Signed-delegate execution and relayer/root controls remain
  tenant-owned. See the subsequent Runtime evidence in the per-wallet inventory;
  the original revision-1 statement that this dispatch was absent is superseded.
- [ ] Deferred work: complete the inventory of persisted continuations, alarms,
  refills and background writes, and verify they retain their admitted fixed-home
  context. R153 owns relocation write fences and queued-before-move cutover tests.
- [ ] Credential locators: complete issuance/consumption/revocation reconciliation
  for all opaque credentials, challenge kinds and delivery acknowledgements;
  ensure wrong-home or unavailable-directory paths fail before local mutation.
- [ ] Linked-device installation: replace controlled contribution planning with
  production source-child resolution and protocol execution. Verify committed
  packages, lost replies, local-install acknowledgement, active authority/session,
  cancellation and cleanup across ingress regions. Current source-read E2E stops
  at `awaiting_source_contribution` and uses synthetic owner material.
- [ ] Resolve every blocked row selector above, prove complete selection with a
  medium/hard composed wallet lifecycle and retain a repeatable receipt.
- [ ] Account for wallet-scoped DO/Container material, including refill pools,
  reservations and operation replay. D1 row transfer cannot stand in for this.

Until these gates close, R153 may implement its state machine against this baseline,
but must not enable a general relocation copy/cutover path. This document does not
claim R152 completion or authorize release 0.8.0.

### Add-signer finalize ownership closure — October 4

The required prepared owner is included in the existing prepared-artifact
fingerprint. The two curve branches reject mixed timing state at compile time;
missing wallet ownership is also rejected by the type fixture. The implementation
and parser live in `d1WalletAddSignerFinalizeRecord.ts`, extracted from the existing
service without a compatibility export or second execution path.

Both existing intended-behaviour E2Es passed: Ed25519 add-signer (27.0s), and ECDSA
add-signer across a lost finalize response followed by NEAR/Tempo/Arc signing and
unlock (32.2s). Wallet-server build, type check and bloat check passed. Evidence:
`.artifacts/r152/add-signer-ownership-20261004/evidence.json` and `e2e.log` in Wallet.
Reproduce with `SEAMS_INTENDED_SKIP_BUILD=1 node
tests/scripts/run-wallet-intended-isolated.mjs
passkey.ed25519-yao-local.contract.test.ts --grep 'public (ECDSA|Ed25519 Yao) add-signer'`
after building Wallet-server and the local runtime. These are local protocol E2Es;
they do not claim hosted regional cutover verification.

### Sponsored NEAR ownership closure — October 4

The effect journal now carries a required wallet owner throughout preparation,
uncertain broadcast, reconciliation and terminal replay. The registration service
passes the validated ceremony wallet into this boundary. The previous provisioning
implementation moved out of the oversized auth service; its signature validation,
exact signed-byte replay and 30-second lease semantics remain in use. There is no
legacy payload reader or compatibility export.

`node tests/e2e/sponsored-account-ownership.e2e.mjs` passed using production signing
WASM, all signer migrations on real SQLite, and a local HTTP NEAR RPC stub. It made
one `send_tx` attempt, retained the owner through a simulated lost reply/readback
outage, rejected another wallet's retry before RPC, waited for lease expiry, and
reconciled through transaction status without rebroadcast. The terminal exact retry
made no RPC call. This verifies the persistence/RPC boundary locally; it does not
claim a real-chain sponsored-account broadcast or hosted D1 latency measurement.

Evidence: Wallet `.artifacts/r152/sponsored-owner-20261004/evidence.json` and
`e2e.log`. Build, type fixtures and bloat checks passed. Initial harness failures
were test bundling and RPC-stub schema/method mismatches, corrected against the
existing decoder and client without changing production validation.

### Email OTP selector audit — October 4

The regional recovery E2E passed in 1.1 minutes for a US Email-OTP-founded wallet
recovering through APAC after a lost finalization response and Gateway restart,
then unlocking and signing NEAR plus concurrent EVM transactions. Its expanded
receipt found one auth-state row and one enrollment in US, none in WEUR/APAC,
and no remaining challenge, grant or unlock-challenge rows in any region. Six
retained authorization-grant operations and their audit ownership checks passed.

The verification-receipt selector above is established by the production writer,
parser and transactional consumption path. This run retained no verification
receipt and does not provide behavioral coverage of that branch or pending OTP
row extraction. The evidence helper now recognizes that scope when present,
validates it with the production parser and checks that its challenge was consumed.
No production behavior or schema change was required for these selectors.

Private artifact:
`.artifacts/r152/email-ownership-20261004/google-recovery-email_otp-US/recovery-evidence.json`,
SHA-256 `060b1ebd167b1457c8d61fd8c1b7ae3d3b6cdf41e71765e9ff5ff6727577dcb1`.
Reproduce with the regional recovery command above and
`SEAMS_TEST_ARTIFACT_DIR=.artifacts/r152/email-ownership-20261004`.
The first attempt stopped before registration on an expired Google token; the
standard token refresh and rerun succeeded. ESLint, diff and bloat checks passed.


### Signing-admission ownership closure — October 4

Migration `0046_wallet_owned_signing_abuse.sql` requires a nonempty `wallet_id`
for each abuse decision, with a constraint binding that owner and its tenant/root
scope to the existing authority-specific key. Project-policy rows require NULL
wallet ownership; they are tenant configuration and must be provisioned separately
at a destination. The exact wallet selector is `(namespace, org_id, project_id,
env_id, wallet_id)` with `record_kind = 'abuse'`, across every signing-root version.
Use the stored runtime policy scope exactly; do not substitute deployment IDs.
The `signing_abuse_wallet` partial index supports that selection.

The writer uses a discriminated owner type and persists ownership on every insert.
The migration removes the unused `quota` branch and its request/lifecycle/expiry
columns. It requires the old table to be empty before replacement; a populated
upgrade fails without deleting its records. There is no legacy key parser or
compatibility writer. Existing credential-snapshot policy joins and admission
roundtrip counts are unchanged.

`node tests/r150-hosted/gateway/admissionPolicy.e2e.mjs` passed on local Workers D1,
the Node SQLite adapter and memory. It exercises Ed25519 and ECDSA policy changes,
wallet/environment/root-version/namespace isolation, shared-policy precedence,
expiry rejection, and independent clearing of one wallet's abuse decision.
Persisted rows show two explicit wallet owners and one shared policy. Both SQL
adapters reject wrong-owner, NULL-decision and retired-quota writes. A deliberately
corrupted SQLite decision still fails closed on read. This is admission-boundary
E2E evidence; it does not claim hosted Cloudflare execution or full signing.

Evidence: `.artifacts/r152/admission-ownership/result.json`, `e2e.log`,
`migration-evidence.json` and the repeatable `verify-migrations.py` in Wallet.
All 46 signer migrations apply cleanly, integrity is `ok`, and the populated-upgrade
guard preserves the old row. Wallet-server type checking, build and bloat checks
passed. The initial test mismatch was SQLite's null-prototype result objects;
normalizing the comparison fixed the fixture without changing production behavior.
