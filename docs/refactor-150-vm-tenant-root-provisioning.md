# R150 VM tenant-root provisioning

Status: first slice implemented (2026-09-25). The VM roles now create a
tenant root with the same ceremony the Cloudflare deployment runs, executed by
ordinary processes with role-private SQLite and no Cloudflare service. The
fabricated fixture (`product_tenant_root_fixture`, the
`LOCAL_TENANT_ROOT_BINDINGS_JSON` and `LOCAL_TENANT_ROOT_ROLE_SHARES_JSON` env
maps) is deleted; every VM E2E that registers or signs now provisions its
root through the ceremony first.

What exists:

- Shared host traits in `router-ab-cloudflare`: `TenantRootServiceTransportV1`,
  `TenantRootCreationStateTransportV1`, `TenantRootDeriverHostV1`,
  `TenantRootRouterCreationHostV1`, and the existing
  `TenantRootControlPlaneHostV1`. The Workers implement them with Service
  Bindings, the creation Durable Object, D1 and R2; the VM implements them in
  `router-ab-dev/src/local_tenant_root.rs`.
- A fifth VM process, `router_ab_local_tenant_root_control_plane`, the only
  holder of the issuer signing Secret. It proves at startup that the Secret
  derives the published active key, and the shared parser refuses every key
  it must not hold.
- The VM Router serves the creation state from its own SQLite
  (`local_tenant_root_creation_state`, one row per creation-object storage
  key) through `tenant_root_creation_serve_without_refresh_v1`, one
  `BEGIN IMMEDIATE` transaction per operation. It serves connections on
  threads, because the control plane and both Derivers call back into its
  creation state while its coordinator waits on them.
- VM Derivers run the shared role-share store over their role-private SQLite
  (the same deriver-a/deriver-b migrations D1 runs) and keep signed managed
  backups in a separate SQLite file keyed by the R2 object key.
- Yao-time loads read the ceremony's state: the Router reads its verified
  active receipt; a Deriver authenticates the custody binding and opens its
  active share with its online provider.
- Each role's SQLite schema is applied by an explicit `--migrate` step and a
  role refuses to serve with a pending or unknown migration.
- Partial-creation cleanup is shared. When a retry finds exactly one role
  installed, the coordinator (`clean_partial_tenant_root_creation_v1`) asks
  the control plane for a cleanup command naming that role's pending row,
  verifies it with the Router's issuer keys, has the Deriver remove the row
  and its managed backup (`tenant_root_deriver_cleanup_v1`), and checkpoints
  the Deriver's terminal receipt in the creation state
  (`tenant_root_creation_persist_cleanup_v1`). The grant is then spent: a
  replay reports it abandoned and a fresh grant is required. Workers and VM
  run the same functions; only the backup deletion (R2 or SQLite) is
  host-specific.
- `local_env_materialization_plan_v1` generates per-deployment tenant-root
  key material under the Cloudflare env names, a control-plane env file and an
  operator file (grant and recovery authorities) that no role loads.

Verified by `vm_tenant_root_creation_is_authorized_replayable_and_role_isolated`
(`R150_VM_TENANT_ROOT_E2E`) and the product E2Es in
`crates/router-ab-dev/tests/local_worker_http.rs`: the Gateway credential and
an untrusted grant are refused; an operator grant reaches ready; exact
replays, including after every role restarts, return the same durable
outcome; each Deriver holds exactly its own active share and managed backup;
the Router holds creation state and no shares; registration and NEAR signing
then run on the created root.

Partial-creation cleanup is verified by
`vm_tenant_root_partial_creation_is_cleaned_before_a_fresh_grant`
(`R150_VM_TENANT_ROOT_PARTIAL_CLEANUP_E2E`). Deriver A's backup table is held
aside, so A fails after B has installed. The retry removes B's pending row
and backup and writes one cleanup checkpoint. Replays, including after every
role restarts, report the grant abandoned and add no second checkpoint. A
fresh grant for a new lineage then reaches ready with both shares active.

Open, and not silently worked around:

- **Resume gap, both hosts.** `Ready` means both installation checkpoints are
  written, and they are written before the control plane issues the
  activation receipt. If the coordinator stops after the initiator returns and
  before the creation state persists the activation, a retry reads `Ready`,
  finds no active state, and cannot continue: the evidence the control plane
  needs (installation evidence, signed backups, canary receipts) came back in
  the initiator's response and was not kept. Fixing this needs a decision on
  where that evidence is durably held; it is not patched here. Proposed fix,
  awaiting review: `refactor-150-tenant-root-creation-resume.md`.
- Refresh, managed restore, source retirement and cutover remain
  Cloudflare-only. The VM control plane refuses a retired-source cleanup
  command rather than skip it.

The original plan follows.

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

- **Fails closed (first slice; since served, see above):** the
  one-role-installed cleanup branch.
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
