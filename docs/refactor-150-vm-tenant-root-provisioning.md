# R150 VM tenant-root provisioning

Status: implementation plan, in progress. The VM role processes today load a
fabricated tenant root:

- an issuer-signed activation receipt from a fixed test key;
- plaintext A/B shares injected through env JSON;
- a fake control-plane authority and canary key.

Those come from `product_tenant_root_fixture` in
`crates/router-ab-dev/tests/local_worker_http.rs`. A real control plane would
reject that receipt. This plan replaces the fixture with the same creation
ceremony the Cloudflare deployment runs, executed by ordinary processes with
role-private SQLite and no Cloudflare service.

## Cloudflare flow, and what each step needs from its host

| Step | Cloudflare owner | Shared logic (host-neutral) | Host dependency |
| --- | --- | --- | --- |
| Grant | operator tooling | `TenantRootCreationGrantV1::sign` | the grant authority key, held by the operator |
| Genesis | control plane | grant verification, `derive_tenant_root_creation_ceremony_v1`, `authorize_tenant_root_creation_v1` | issuer seed; creation authority id; journal write and creation-state read |
| Role commands | control plane | `issue_tenant_root_role_creation_command_v1` | issuer seed; validated creation-state read |
| Role share (A initiates, B completes) | Derivers | `PendingTenantRootInitialRoleAttemptV1`, `compose_initial_tenant_root_role_runtime_v1` (seal, managed backup, canary) | role keys; role-share store (pending row, replay row, terminal receipt); backup store; commitment rendezvous and installation checkpoint; peer call |
| Activation receipt | control plane | evidence-bundle verification, `issue_tenant_root_initial_activation_receipt_v1` | issuer seed; creation-state read |
| Router activation | Router creation state | `validate_initial_activation_receipt_against_creation_state` | creation-state transaction |
| Role activation | Derivers | pending → active with the receipt | role-share store transaction |
| Yao-time load | Router, Derivers | `cloudflare_ed25519_yao_tenant_root_context_v2`; open the sealed share | active-state read; active role-share read |

The control plane is stateless. The Router owns the creation state, and on
Cloudflare the Derivers reach it through their own bindings.

## Extraction rule

Where Cloudflare code is gated only because its host calls are Worker
calls, extract a small host trait and keep one implementation of the logic.
Do not copy the logic into the VM crate.

1. **Pure logic is compiled on every host.** The control-plane authorization
   and validation functions and the creation-state evaluators
   (`validate_creation_record`, `evaluate_creation_record`,
   `evaluate_creation_commitment_rendezvous`,
   `evaluate_installation_checkpoint`, and the initial-activation
   validators) already compile outside `workers-rs`. Their module gates are
   removed.
2. **Control-plane handlers become generic over a host trait.** The trait
   provides the issuer seed, the creation authority id, journal persistence
   and creation-state reads. The Cloudflare implementation wraps `Env` and the
   creation DO. The VM implementation holds the issuer seed and calls the VM
   Router's creation-state endpoints.
3. **Creation-state transaction shells.**
   - Each DO persist method is a prelude, then get-evaluate-put. The
     preludes become shared functions.
   - The DO keeps its storage transaction.
   - The VM Router runs the same get-evaluate-put inside one SQLite
     `BEGIN IMMEDIATE` transaction over a key/value table. It uses the DO's
     storage keys, one database row per (identity, lineage).
4. **Deriver creation runtime becomes generic over a role host trait.** The
   trait covers the role signer and keys, the role-share store, the backup
   store, creation-state calls and the peer call. The D1 record format and
   its invariants (`tenant_root_role_d1.rs`) move behind the store trait
   together with the command-digest computation, so the VM does not
   re-derive them.
5. **Authority id.**
   - Cloudflare keeps the creation DO id.
   - The VM derives it with SHA-256 over a domain tag, a configured
     deployment authority id and `tenant_root_creation_object_name_v1`.
   - The issuer, the Router and both Derivers compute the same value.
6. **Issuer process.** The VM gets a fifth role process, the tenant-root
   control plane, which holds the issuer seed. The Router is forbidden from
   holding it, exactly as `ROUTER_FORBIDDEN_ENV_KEYS` forbids on Cloudflare.
7. **Backups.** The activation receipt binds backup digests, not a location.
   The VM stores each role's signed managed backup in that Deriver's own
   SQLite, using the HPKE provider. Google KMS remains Cloudflare-only and
   optional.

## Scope of the first slice

The first slice covers initial creation, activation and the Yao-time loads.

- **Fails closed:** the one-role-installed cleanup branch. The Router
  returns an explicit error and does not attempt cleanup.
- **Out of scope for this slice:** refresh, managed restore, source
  retirement and cutover. They stay gated to Cloudflare and remain governed
  by the unapproved retirement design.

## Verification

- A VM E2E creates a tenant root from a grant, using separate processes for
  the Router, control plane, Deriver A, Deriver B and SigningWorker, each
  with its own credential and SQLite file.
- The E2E then registers and signs using that root, with no fixture.
- It restarts every role between ceremony steps.
- It replays the grant.
- It rejects a grant from an untrusted authority.
- It proves no process can read another role's share store.

The same flow then backs the VM wallet-system launcher and the browser
contract.
