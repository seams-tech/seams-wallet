# R150 state ownership map

Status: design decision for the first new-wallet DO path. Current production
wallets are test-only and may be erased in a separately coordinated clean reset;
there is no existing-wallet conversion or compatibility route. The first complete path
is Ed25519 Yao registration and NEAR signing; ECDSA uses the same ownership
rules when lifecycle coverage expands.

An owner names the service allowed to decide and mutate a fact. A public key in
Gateway storage and a private share in a role store are different facts. A
reporting copy cannot authorize a wallet operation. The routing key for each
new wallet is the server-resolved org/project/environment scope and wallet
identity plus the fixed role; a client location, request URL, placement hint,
or root-version-dependent digest cannot select an authority.

## Record decisions

`SIGNER_DB` is the current Gateway D1 database. The target column describes
the DO-only new-wallet path after the clean reset. Rows with tenant-wide or
cross-wallet constraints stay in D1.
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
| `router_ab_yao_versioned_json_records` with lifecycle-keyed Yao ceremony partitions in `SIGNER_DB` | Gateway | Gateway D1 until each transition that commits it with the `shared` record has a reviewed cross-owner protocol | Claim and advance each ceremony partition with one version check: the admission, its intent credential, and the tenant root pinned at admission |
| Yao registration execution records: claim, lease and generation, pinned request, terminal outcome, consumer binding | Router | Router wallet DO SQLite (`ROUTER_WALLET_DO`); VM: `local_router_wallet_objects` in Router SQLite | Claim the execution under a lease and generation; record the terminal outcome, under the current generation only, before replying; bind the first consumer once |
| `lane_enrollments`, `lane_protocol_operations`, `lane_product_epochs`, `lane_receipts`, `lane_locks`, `lane_effect_journal`, `lane_cas_guard` in `SIGNER_DB` | Router | **Unfinished infrastructure, not migrated.** No supported product flow reaches these tables (see below). If rotatable lanes ship, the target is a Router wallet store that executes whole lifecycle transitions locally | Claim one lane operation, transition its generation/lock, and record its receipt or effect identity atomically |
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
record families. The replacement selects records by their validated domain key
and owner; copying that table wholesale would duplicate authority. The Yao
`shared` record is tenant-wide, while ceremony and execution records are
lifecycle-keyed. Registration finalization installs a capability into the
shared record, and the current D1 batch operation can update that record with
the lifecycle record. Preserve this D1 atomic unit during the first Deriver
execution-boundary slice. A later DO path must establish the failure and
visibility protocol for splitting finalization, including lost-reply
reconciliation, before it moves these records. Recovery/export transitions
need the same explicit review of their shared invariants. The proposed
protocol, awaiting review, is
[cross-owner finalization](./refactor-150-cross-owner-finalization.md); until
it is approved these records stay in D1. The same D1 CAS guard
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

## Retained Gateway D1 calls on the representative ECDSA path

The successful reusable-Wallet-Session branch still calls these Gateway-owned
services before or after role-local work. This is a method-level inventory, not
a count of SQL statements or a latency result.

| Request phase | Gateway D1 authority used | Existing timing bucket |
| --- | --- | --- |
| Client Wallet Session status refresh | Read the exact live session, quota, and authorization projection by operation credential. Background refill may request this repeatedly while a signature is in progress. | Captured as `/wallet/session/status` request fan-out; no ECDSA stage bucket |
| Presign pool-fill init and each of five steps | Read the live exact Wallet Session context, then resolve the active ECDSA material. Each of the six HTTP exchanges repeats both service calls. | `ecdsa_presign_authenticate`, `ecdsa_presign_material` |
| Signing prepare | Validate the Wallet Session and active material; resolve fresh material for the claim; atomically claim the authorized operation with its grant and quota; read the original pinned owner scope before Router dispatch. | `ecdsa_sign_authorize`, `ecdsa_sign_admit`, `ecdsa_sign_proxy` |
| Signing finalize | Revalidate the Wallet Session and material, reconcile the operation claim, then persist the terminal authorized-operation response after Router returns. | `ecdsa_sign_authorize`, `ecdsa_sign_admit`, `ecdsa_sign_proxy`, `ecdsa_sign_complete` |
| Registration response and activation | Maintain Gateway ceremony, identity, session, and side-effect journals around Router and SigningWorker receipts. | `ecdsa_respond_*`, `ecdsa_activate_*` |

The browser contract in `tests/e2e/intended-behaviours/passkey.presign-pool.contract.test.ts`
captures Gateway request counts and `Server-Timing` for a forced in-flight refill.
The capture includes concurrent background refill and NEAR provisioning traffic;
the counts are a user-visible window, not a per-signature causal bill. Its elapsed
time includes a deliberate test hold and is diagnostic only. The
same contract also records one unforced local registration return, first Tempo
signature, and subsequent same-target signature as separate windows. Those
signatures are verified; the initial single local sample could not establish
cold/warm p50/p95, role DO usage, regional network conditions, or production cost. Numeric
latency targets and a monthly cost ceiling remain unset pending product approval.
The earlier diagnostic records HTTP request counts. Neither it nor the matched
follow-up below measures per-request D1/DO operations, object active duration,
or stored bytes for a cost comparison.

### Matched local Gateway/browser diagnostic (2026-09-25)

The existing unforced passkey registration → first Tempo signature → second
Tempo signature test ran as a tagged set of three trials per profile on one
machine. Each run used a fresh local Wrangler state root and browser context.
All used the same client flow and dev Worker build profile, with no injected
delay or fault. All six runs verified
both ECDSA signatures. The DO profile selected the existing
`ROUTER_AB_WALLET_DO_HARNESS=enabled` build and local bindings; the D1 profile
used `disabled`. Reproduce with `ROUTER_AB_WORKER_BUILD_PROFILE=dev` and the
selected `ROUTER_AB_WALLET_DO_HARNESS` value before running the command in the
test artifact; give every trial a fresh local runtime root. These are
user-visible elapsed milliseconds, one observation per fresh run, not
geographic p50/p95 measurements.

| Profile / run | Registration return ms | First sign ms | Subsequent sign ms | Background refill init/step (registration; first; next) | Foreground refill steps (first; next) |
| --- | ---: | ---: | ---: | --- | --- |
| Wallet DO 1 | 3638.117 | 1494.096 | 1484.912 | 1/1; 1/5; 2/8 | 1; 0 |
| Wallet DO 2 | 3711.627 | 1495.198 | 1499.840 | 1/1; 1/7; 2/7 | 0; 0 |
| Wallet DO 3 | 3640.549 | 735.988 | 1488.834 | 1/1; 1/4; 1/1 | 0; 4 |
| D1 1 | 3640.309 | 1494.169 | 1484.241 | 1/1; 1/8; 2/6 | 0; 0 |
| D1 2 | 3622.904 | 1477.721 | 1503.551 | 1/1; 1/5; 2/8 | 1; 0 |
| D1 3 | 3600.424 | 1474.876 | 1486.011 | 1/1; 1/5; 2/8 | 1; 0 |

Each run also observed seven `/wallet/session/status` requests during
registration and four in each signing window. Each signing window sent one
Gateway prepare and one finalize. All presign requests had an identified
background or foreground tag; no foreground init occurred. Background requests
ran inside the measured user-visible windows, and work after each window is
excluded. Wallet DO run 3 reached a ready first entry sooner and observed fewer
first-window refill steps, so its 736 ms first sign is not evidence of a backend
speedup. The three-run medians were 3641/1494/1489 ms for DO and
3623/1478/1486 ms for D1 (registration/first/subsequent, rounded to the nearest
millisecond). The samples expose no clear local latency benefit from the
current hybrid topology.

SQLite inspection after every run confirmed the selected authority. The DO
profile had one Yao pair record in each of the separate A and B wallet objects,
zero Yao pair rows in their role D1 databases, and SigningWorker wallet-DO
ECDSA activation and two effect records; its corresponding SigningWorker D1
activation, pool, and effect tables stayed empty. The D1 profile had one Yao
pair row in each role D1 database, a SigningWorker D1 ECDSA activation and two
effect records, and no wallet-DO instances. In both profiles, A/B tenant-root
shares remained in role-private D1 and the Gateway held the wallet, authority,
and Wallet Session in D1. The DO profile is therefore a real wallet-DO path for
Yao pair and SigningWorker ECDSA state, with retained Gateway and role-root D1
dependencies. Router wallet-local ceremony/signing-operation ownership is not
yet a wallet DO.

The matched browser flow establishes local registration and two Tempo signs
through each selected topology; it does not exercise NEAR signing or other
lifecycle operations in this comparison. Remaining implementation includes
Router wallet-local ownership, cross-owner registration finalization, and
recovery/factor/export/retirement coverage. Consolidated concurrency, crash,
security, lifecycle, and packaging verification is separate from that missing
implementation. Root-retirement quiescence, numeric latency and cost limits,
hosted regional experiments, production setup, and cutover require review
before release. No hosted resources or production routing were changed.

## Reuse and missing contracts

- Reuse the pure Rust protocol transitions in `router-ab-core`, including its
  clock, random, key-store, peer-transport, and audit host traits. The role
  adapters still need domain-specific atomic claim/commit operations.
- Reuse the existing TS registration ceremony and signing-lane store interfaces
  where their compare-and-swap semantics match the target. Their D1 adapters
  remain only during development comparison and are retired when the DO-only
  path is verified. New DO and VM adapters implement the same behavioral
  contracts without sharing a writable backing record.
- Reuse the tenant-root-creation DO and SigningWorker presign-session DO for
  their current coordination units. The generic threshold and versioned-JSON
  DO stores demonstrate atomic operations; neither is a substitute for a
  role-specific claim spanning several protocol records.
- VM Deriver A and B pair records use role-private SQLite claims. B's pair
  claim and terminal result have one wallet/session row; its registration
  effective-state delta commits in the same transaction as completion. The
  broader role-state blob excludes B pair authority and rejects a stale
  process snapshot. SigningWorker NEAR and ECDSA have separate one-use effect
  journals. If B commits and its sealed completion reply is lost after a valid
  protocol and HTTP end-of-stream, A reads B's exact completed outcome using
  the original pair, root-receipt digest, and execution ID. A verifies that
  outcome against its own completed transcript and commits its result before
  replying. Malformed framing still fails closed. This only reconciles while
  A's process survives; A crash after B completion remains unresolved (fails
  closed; proposal: [fenced fresh attempt](./refactor-150-deriver-a-fresh-attempt.md)). Router
  registration replay now reads completed A/B records and an exact,
  read-only SigningWorker finalization record before any pair preparation.
  The initial SigningWorker receipt and active material commit in one
  compare-and-set SQLite state write. Missing finalization remains pending;
  a lost reply after commit can be reconstructed after process restart without
  another role execution or activation. The VM reference still lacks a
  tenant-root retirement fence and complete remaining lifecycle coverage.

## Router signing lanes: no product consumer (2026-09-25)

The rotatable signing-lane lifecycle was traced across both repositories
before any move.

- **Here:** the lane stores and their application-service factories are
  exported through `cloud-host.ts` and constructed nowhere. The client-side
  lane operation coordinators (`packages/wallet/src/core/signingEngine/session/lanes/operations/`)
  are not imported by any SDK surface. The Router's
  `/router-ab/internal/ed25519-yao/lane/execute` route has no caller.
- **In seams-monorepo (at `e7e1643`):** nothing calls the lane factories.
  The only reference is a local readiness check that lists the lane tables.

So no registration, signing, rotation or linked-device request reaches these
tables. They are unfinished infrastructure. A relocation was implemented
and then reverted: commit `0b40f43`, reverted by the next commit. It moved the
store into a per-wallet Router DO and a VM service, and its history keeps the
two-host E2E. It was reverted because it relocated unused tables, and because
its client made one remote call per store read or write rather than running
each lifecycle transition beside storage.

If lanes become a supported flow, these conditions apply first:

- Run each `LaneEnrollmentGatewayV1` transition as one call inside the
  owning store.
- Bind the store to the authenticated canonical tenant, environment and
  wallet of the operation, not to a caller-chosen owner.
- Review each tenant-wide constraint before partitioning: manifest digest,
  `target_material_activation_id`, operation and effect identity.

That run also found two defects in the D1 store. Neither is reachable today.

1. Product-epoch updates stamp `updated_at_ms` with request times, against
   a host-clock `created_at_ms`. A lagging caller clock therefore fails the
   `updated_at_ms >= created_at_ms` check during revocation.
2. `putEnrollmentAdmission` stores child jobs without parsing them, and an
   invalid job makes the enrollment unreadable.

Also noted: exact retries of prepare, effect recording and visibility commit
that arrive after later stages return conflict or rejection, not the
recorded outcome.

Recovery, factor management, export, linked devices, and background jobs need
their own inventory before full lifecycle coverage. Their current D1 records remain
authoritative until that work is implemented and tested.
