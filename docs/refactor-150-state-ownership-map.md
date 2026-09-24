# R150 state ownership map

Status: design decision for the first new-wallet DO path. Existing wallets keep
their D1 authority until a separate, fenced conversion. The first complete path
is Ed25519 Yao registration and NEAR signing; ECDSA uses the same ownership
rules when lifecycle coverage expands.

An owner names the service allowed to decide and mutate a fact. A public key in
Gateway storage and a private share in a role store are different facts. A
reporting copy cannot authorize a wallet operation. The routing key for each
new wallet is a trusted tenant and wallet identity plus the fixed role; a client
location, request URL, or placement hint cannot select an authority.

## Record decisions

`SIGNER_DB` is the current Gateway D1 database. The target column describes
the new-wallet path; the existing-wallet D1 records stay authoritative until
conversion. Rows with tenant-wide or cross-wallet constraints stay in D1.
The VM adapter uses role-private SQLite for every target DO group and ordinary
SQL for the retained shared Gateway and tenant-wide groups.

| Records and current store | Owner | New-wallet authority | Required local atomic boundary |
| --- | --- | --- | --- |
| `wallets`, `wallet_signers`, `near_public_keys` in `SIGNER_DB` | Gateway | Gateway D1: canonical wallet identity, public key and address index | Commit public identity and signer projection with the registration receipt; reject competing wallet/key identity |
| `wallet_authorities`, `wallet_auth_methods`, `identity_links`, `webauthn_credential_bindings`, `webauthn_authenticators` in `SIGNER_DB` | Gateway | Gateway D1: authority and cross-wallet credential uniqueness | Install or revoke authority and factor together with their identity constraints |
| `registration_ceremony_records`, `registration_ceremony_cas_guard`, `registration_replay_opaque_wallet_session_tokens_v1`, `webauthn_challenges`, `email_otp_registration_attempts`, `email_otp_challenges`, `email_otp_rate_limits`, `email_otp_wallet_enrollments`, `email_otp_recovery_wrapped_enrollment_escrows` in `SIGNER_DB` | Gateway | Gateway D1: registration and owner-proof admission, including global credential and email constraints | CAS the ceremony and consume the proof/replay identity before an external effect |
| `email_otp_auth_states`, `email_otp_grants`, `email_otp_unlock_challenges`, `app_session_versions`, `google_email_otp_session_exchange_journals` in `SIGNER_DB` | Gateway | Gateway D1: owner authentication, exchange, and session-version authority | Consume each challenge or grant once and advance the relevant session version before dispatch |
| `router_ab_yao_versioned_json_records` with `passkey-envelope:` and `passkey-credential-activity:` keys in `SIGNER_DB` | Gateway | Gateway D1: recoverable factor ciphertext and cross-device credential lifecycle | CAS the envelope revision and credential activity with the factor or authority transition |
| `router_ab_yao_versioned_json_records` with `gateway-registration:`, `wallet-registration-activate:`, `wallet-registration-near-provisioning:`, `router-ab-yao-sponsored-account:`, and `wallet-add-signer-*:` keys in `SIGNER_DB` | Gateway | Gateway D1: durable registration and chain side-effect journals | Persist the exact effect claim and signed transaction identity before dispatch; retry the same effect |
| `router_ab_yao_versioned_json_records` with the `router-ab-ed25519-yao:shared` key in `SIGNER_DB` | Router | Shared D1: tenant-wide recovery capability/identity indexes and export nonce replay state | Keep cross-wallet identity and nonce claims atomic in the shared store |
| `router_ab_yao_versioned_json_records` with lifecycle-keyed Yao ceremony and execution partitions in `SIGNER_DB` | Router | Router D1 until registration finalization has a reviewed cross-owner protocol; target Router wallet DO SQLite | Claim and advance each ceremony/execution partition with one version check; persist outcome before calling a peer |
| `lane_enrollments`, `lane_protocol_operations`, `lane_product_epochs`, `lane_receipts`, `lane_locks`, `lane_effect_journal`, `lane_cas_guard` in `SIGNER_DB` | Router | Router wallet DO SQLite; these are cryptographic signing lanes | Claim one lane operation, transition its generation/lock, and record its receipt or effect identity atomically |
| `wallet_ecdsa_pending_session_activations` in `SIGNER_DB` | Router | Router wallet DO SQLite | Claim paired activation once, with a durable terminal outcome |
| `router_ab_normal_signing_admission_records` in `SIGNER_DB` | Gateway | Gateway D1: tenant project policy and abuse decisions | Keep project-wide policy and abuse decisions with their shared scope |
| `wallet_session_authorizations_v2`, `wallet_session_hosted_credentials_v2`, `wallet_session_hosted_exchange_codes_v2`, `hosted_wallet_session_exchange_codes`, `reusable_wallet_sessions`, `authorization_sessions`, `authorization_wallet_session_quotas` in `SIGNER_DB` | Gateway | Gateway D1: session and credential authority | Issue, retire, or exchange a credential with its session and quota in one D1 transaction |
| `authorized_operations`, `authorized_operation_audit_events`, `verified_grant_evidence_sets`, `verified_owner_proof_consumptions`, `verified_wallet_operation_evidence_sets`, `ecdsa_authorization_atomic_guards` in `SIGNER_DB` | Gateway | Gateway D1: grant, quota, replay and authorization authority | Consume an exact grant/quota and claim its operation and audit identity in one transaction; Router receives only the resulting scoped authorization |
| `router_ab_yao_capability_replacements` in `SIGNER_DB` | Gateway | Gateway D1 with wallet authority and session projections | Replace the public capability and affected session projection atomically after the role-private activation receipt |
| `yao_pair_sessions` in each Deriver private D1 | A or B, respectively | Separate A and B wallet DO SQLite namespaces and deployments | Claim/advance/burn the pair and its replay identity in the owning role before sending a peer message |
| `tenant_root_role_shares`, `tenant_root_command_replays`, `tenant_root_command_cas_guard`, `tenant_root_recovery_attempts`, `tenant_root_restore_import_sessions`, `tenant_root_restore_import_keys`, `tenant_root_restore_refresh_attempts`, `tenant_root_source_retirements` in each Deriver private D1 | A or B, respectively | Separate role-private D1: tenant-wide roots and fences shared by that role's wallets | Change a root epoch, replay claim, and retirement fence within the same role database; never join A and B storage |
| `signing_worker_activations`, `signing_worker_activation_revocation_fences`, `signing_worker_lane_material`, `signing_worker_secret_states` in SigningWorker private D1 | SigningWorker | SigningWorker wallet DO SQLite | Activate/revoke material with its fence and generation; never make retired material active on retry |
| `signing_worker_round1`, `signing_worker_ecdsa_pool`, `signing_worker_effect_claims`, `signing_worker_terminal_responses` in SigningWorker private D1 | SigningWorker | SigningWorker wallet DO SQLite | Reserve or consume one-use material with the effect claim and terminal replay response before any external call |
| SigningWorker presign-session DO records | SigningWorker | Existing session DO for rendezvous and terminal session result; wallet DO owns consumed material | Preserve a durable terminal outcome across eviction; memory-only live session state is never an authority for reuse |
| Router tenant-root-creation DO journal/checkpoints | Router | Existing tenant-root-creation DO | Keep tenant-wide creation idempotency and installation checkpoints together |

The `router_ab_yao_versioned_json_records` table contains several unrelated
record families. Conversion selects records by their validated domain key and
owner; copying that table wholesale would duplicate authority. The Yao
`shared` record is tenant-wide, while ceremony and execution records are
lifecycle-keyed. Registration finalization installs a capability into the
shared record, and the current D1 batch operation can update that record with
the lifecycle record. Preserve this D1 atomic unit during the first Deriver
execution-boundary slice. A later DO path must establish the failure and
visibility protocol for splitting finalization, including lost-reply
reconciliation, before it moves these records. Recovery/export transitions
need the same explicit review of their shared invariants. The same D1 CAS guard
currently protects multiple families; each target owner gets its own local
transaction rather than a copy of the shared guard. Historical bridge tables
in migration SQL are not additional current authorities.

## Operations crossing owners

No transaction spans Gateway, Router, A, B, SigningWorker, or a blockchain.
Registration uses a durable Gateway ceremony identity, then a Router operation
identity and role-local claims. A and B prepare their private pair state
independently. SigningWorker activates only from the protocol receipt. Gateway
commits the public wallet and capability after the required role receipts, and
retries use the same identities. A lost response reads the durable outcome from
the owner that performed the effect.

Signing first consumes the Gateway grant and quota with the authorized-operation
claim. Router then claims the protocol operation. Each Deriver claims its own
pair step, and SigningWorker reserves or consumes material with its terminal
response. Replays may return a recorded result or a terminal rejection; they
never allocate fresh one-use material for the same operation identity.

Public wallet identity, session authorization, and project policy are deliberate
D1 dependencies in the first prototype. Measure their serial calls. Moving
them later requires a new atomicity design for cross-wallet credential indexes
and exact grant/quota consumption.

## Reuse and missing contracts

- Reuse the pure Rust protocol transitions in `router-ab-core`, including its
  clock, random, key-store, peer-transport, and audit host traits. The role
  adapters still need domain-specific atomic claim/commit operations.
- Reuse the existing TS registration ceremony and signing-lane store interfaces
  where their compare-and-swap semantics match the target. Their D1 adapters
  remain for existing wallets. New DO and VM adapters implement the same
  behavioral contracts without sharing a writable backing record.
- Reuse the tenant-root-creation DO and SigningWorker presign-session DO for
  their current coordination units. The generic threshold and versioned-JSON
  DO stores demonstrate atomic operations; neither is a substitute for a
  role-specific claim spanning several protocol records.
- `LocalRolePrivateSqliteStorageV1` proves VM persistence and role separation.
  Its byte get/put API does not implement competing claims, version checks, or
  crash-safe effect journals. Extend the narrow role store contract when the
  representative path demonstrates each missing operation.

Recovery, factor management, export, linked devices, and background jobs need
their own inventory before full lifecycle coverage. Their current D1 records remain
authoritative until that work is implemented and tested.
