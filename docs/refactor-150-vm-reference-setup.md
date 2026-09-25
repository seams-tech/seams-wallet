# R150 VM reference: setup

Status: local reference, 2026-09-25. This runs the Wallet on ordinary processes
and SQLite files, with no Cloudflare service, Wrangler or Miniflare. It is a
reference for portability, not a provisioning framework: AWS/GCP tooling,
PostgreSQL and multi-region custody are out of scope.

All roles on one machine, as this guide runs them, is a development topology.
It does not establish independent custody: production A/B isolation needs
separate hosts, administrators, service identities, keys, databases and
backups, and an explicit operator review.

## Processes

| Process | Binary | Holds | SQLite |
| --- | --- | --- | --- |
| Router | `router_ab_local_worker --role router` | Gateway-to-Router and role-shared credentials, Wallet Session JWT verifier, published tenant-root verifying keys | tenant-root creation state |
| Deriver A | `router_ab_local_worker --role deriver-a` | its role signing key, role-store record key, online and managed-backup provider keys, peer signing key | role-private store; managed backups |
| Deriver B | `router_ab_local_worker --role deriver-b` | the same, for B | role-private store; managed backups |
| SigningWorker | `router_ab_local_worker --role signing-worker` | server-output key | role-private store |
| Tenant-root control plane | `router_ab_local_tenant_root_control_plane` | the issuer signing key, and nothing else secret | none |
| Wallet Gateway | Node, `nodeHostedWalletGatewayMain.ts` | Gateway secrets | shared Gateway store |

Each role reads only its own env file. The tenant-root settings use the env
names the Cloudflare roles read (for example
`DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY`,
`TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY`, `DERIVER_ROLE_PRIVATE_D1_*`),
and the shared parsers refuse any key a role must not hold. The operator file
holds the creation grant authority and the recovery authorities and is loaded
by no process.

## One command

```bash
node crates/router-ab-dev/scripts/start-vm-wallet-system.mjs --root /tmp/seams-vm
```

It builds `router-ab-dev`, generates every env file, applies each role's
schema, starts the five role processes, creates the tenant root from an
operator-signed grant, prepares the Gateway configuration with the same
preparer the Worker launcher uses, migrates the Gateway store and serves the
Gateway on `http://127.0.0.1:4100`. Roles listen on 4102-4106. Set
`SEAMS_LOCAL_PORT_OFFSET` and `SEAMS_INTENDED_ROUTER_URL` together to move the
whole stack (the browser suites expect the Gateway at 4100 plus the offset).

The browser suites run against it with `SEAMS_INTENDED_WALLET_HOST=vm`.

## Step by step

1. Generate env files:

   ```bash
   cargo run --manifest-path crates/router-ab-dev/Cargo.toml --bin router_ab_local_init -- --root /tmp/seams-vm
   ```

   This writes `.env.router-ab.{router,deriver-a,deriver-b,signing-worker}.local`,
   `.env.router-ab.tenant-root-control-plane.local` and
   `.env.router-ab.tenant-root-operator.local`. Key material is derived per
   deployment from a fresh seed.

2. Apply each role's schema. The chains are embedded in the binary; a role
   refuses to serve with a pending or unknown migration.

   ```bash
   router_ab_local_worker --role deriver-a --env .env.router-ab.deriver-a.local --migrate
   ```

   Deriver A and B apply the same role-private migrations their D1 databases
   run, plus a managed-backup schema. The Router applies its creation-state
   schema.

3. Start the roles and the control plane, from the root directory.

4. Create the tenant root. The operator signs a creation grant and posts it to
   the Router's creation route with the role-shared credential:

   ```bash
   node crates/router-ab-cloudflare/scripts/bootstrap-local-tenant-root.mjs \
     --root /tmp/seams-vm --grant-authority-env /tmp/seams-vm/.env.router-ab.tenant-root-operator.local \
     --org-id org_local_wallet --project-id local-smoke-project --env-id local-smoke-project:dev \
     --signing-root-id local-smoke-project:dev --signing-root-version default \
     --router-url http://127.0.0.1:4102
   ```

   Replaying the same grant returns the same ready state. The control plane is
   needed only for creation; signing does not call it.

5. Prepare, migrate and serve the Gateway (`nodeHostedWalletGatewayMain.ts`
   `migrate`, `check`, `serve`). `serve-local` serves the local Gateway, which
   adds the intended-suite transport faults.

## Checks

- `router_ab_local_worker ... --migrate` prints what it applied; a started role
  that finds a pending migration exits with the file and the pending names.
- `nodeHostedWalletGatewayMain.ts check` reports the Gateway store's migration
  status without writing.
- Every role serves `GET /healthz`.
- `vm_tenant_root_creation_is_authorized_replayable_and_role_isolated` in
  `crates/router-ab-dev/tests/local_worker_http.rs` prints
  `R150_VM_TENANT_ROOT_E2E` with the creation evidence;
  `vm_tenant_root_partial_creation_is_cleaned_before_a_fresh_grant` prints
  `R150_VM_TENANT_ROOT_PARTIAL_CLEANUP_E2E`.
- `vm_tenant_root_committed_activation_is_delivered_after_the_ceremony_expires`
  prints `R150_VM_TENANT_ROOT_POST_COMMIT_E2E`: a delivery lost after the
  Router commits is finished by a retry, inside the ceremony window or after
  it, and a signed receipt the Router did not commit activates nothing.
- `vm_tenant_root_ready_creation_resumes_from_durable_evidence` prints
  `R150_VM_TENANT_ROOT_RESUME_E2E`: a creation that stops after both roles
  install and before the Router commits resumes from stored evidence.
- A creation left with one role installed is cleaned on the next retry of its
  grant, which then reports that a fresh grant is required.

## Not served on the VM

- Tenant-root refresh, managed restore, source retirement and cutover.
- Linked-device and step-up signing.
- Google Cloud KMS managed backup (HPKE only).
- Router and SigningWorker prewarm, which keeps Worker isolates warm and has no
  VM counterpart; the launcher sets `ROUTER_AB_PREWARM_ENABLED=false`.
