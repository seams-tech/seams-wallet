# R152 state ownership baseline for R153

Revision 2 — October 4, 2026.

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
| `email_otp_challenges`, `email_otp_grants` | Mixed lifecycle: wallet-bound records belong with their wallet; pre-wallet records require explicit challenge/registration ownership. Block unresolved/pre-wallet rows; retain challenge/grant/registration-consumption atomicity. |
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
| `registration_ceremony_records` | Blocked selector: use parsed `record_scope`/record identity and Console ceremony/setup allocation; preserve preparation, activation and deferred continuation state. See opaque-record inventory below. |
| `router_ab_yao_capability_replacements` | Wallet: migration 0045 requires exact scoped `wallet_id`. Copy old/new capability decisions and replay fingerprints together, including terminal receipts after lifecycle cleanup. Retries verify the same wallet. |
| `router_ab_yao_versioned_json_records` | Mixed, blocked selector: classify by supported prefix and parsed record ownership. Includes custody/recovery secrets and replay state; never copy all namespace rows or omit the table. |
| `router_ab_normal_signing_admission_records` | Mixed, blocked split: project policy is shared; wallet abuse/quota/operation decisions need exact key-kind ownership. Existing SQL joins must be replaced or preserved under one authoritative transaction. |
| `identity_links`, `email_otp_registration_attempts`, `email_otp_rate_limits`, `linked_device_request_proof_nonces` | Hosted shared authority is Console. Do not relocate or independently reset/consume these signer-schema copies. Verify every hosted caller uses the injected shared service; table existence also supports self-hosted composition. |
| `vault_proxy_secrets` | Shared tenant/vault/item state, no wallet ownership. Excluded from wallet relocation. |
| `deployment_resource_challenges` | Resource-local deployment proof, excluded; the destination must prove its own identity. |
| `lane_cas_guard`, `linked_device_session_cas_guard`, `registration_ceremony_cas_guard`, `router_ab_yao_versioned_json_cas_guard`, `wallet_authority_cas_guard` | Schema guard tables, excluded from row copy. Destination migrations install them and their triggers. |

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

The registration intent store uses `gateway-registration:` over the partitioned
`registration_ceremony_records` table. Its `record_scope` and `record_id` must be
interpreted by the ceremony store, including child records and preparation state.
The standalone `local-registration-authority:` belongs to self-hosted registration
admission; Console-backed hosted admission is separate.

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

Gateway dispatch already recognizes registration `near-admission` and
`near-provisioning` continuations by ceremony allocation. That routing alone does
not prove an in-flight deferred write is fenced across home changes. Scheduled
Router prewarm uses tenant deployment scope before a wallet exists; it must remain
tenant-owned, with no attempt to derive a wallet from a root or capability ID.

## Closure gates owned by R152

- [ ] Internal Wallet Runtime: `d1WalletRuntimeWorker.ts` binds the local resource
  and calls `handleSplitGatewayWalletRuntimeRequest` without wallet-home dispatch.
  `getWalletIdentities` accepts up to ten wallet selectors and reads local signer
  rows. Partition by authoritative home and merge verified results, including
  mixed-home batches; test remote and missing homes without silent omissions.
  Audit signed-delegate/control operations separately for their actual ownership.
- [ ] Deferred work: inventory each persisted continuation, alarm, refill and
  background write; require a current home/write fence before effect commit.
  Prove queued-before-move work cannot mutate a retired home.
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
