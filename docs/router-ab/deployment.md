# Router A/B Cloudflare deployment

Status: current deployment topology and release procedure.

One trusted organisation operates Deriver A and Deriver B. Separate Workers
provide logical role separation, with separate entrypoints, Secrets, stores,
and encryption keys. Each role receives only its own plaintext inputs and
tenant-root share.

The current hosted configuration places the role Workers in one Cloudflare
account per deployment lane. Service bindings connect the roles. The
organisation may place A and B in separate Cloudflare accounts for additional
administrative isolation. Both accounts remain under the same organisation.
Independent operators are not required.

Each account arrangement requires authenticated inter-role communication and
the same wallet, operation, replay, and ownership checks. A separate-account
deployment must validate its authenticated transport before activation. The
current manifests and hosted measurements cover the same-account configuration.

The deployable Worker artifacts are built and packaged by `seams-wallet`. The
private `seams-monorepo` consumes an exact `@seams/wallet-server` release and
owns deployment targets, provisioned resource identifiers, migrations,
deployment sequencing, and smoke checks.

## Worker topology

| Worker | Inbound exposure | Outbound bindings | Persistence |
| --- | --- | --- | --- |
| `router-ab-mpc-router` | Gateway-facing Router endpoints and authenticated internal tenant-root operations | Deriver A, Deriver B, SigningWorker, Tenant Root Control Plane | Router-owned tenant-root lifecycle Durable Object |
| `router-ab-tenant-root-control-plane` | Private internal service routes | External binding to the Router-owned tenant-root Durable Object | No role-share database; owns the tenant-root issuer key |
| `router-ab-deriver-a` | Private service routes | Deriver B and the Router-owned tenant-root Durable Object | A-only D1 and A-only managed-backup R2 |
| `router-ab-deriver-b` | Private service routes | Deriver A and the Router-owned tenant-root Durable Object | B-only D1 and B-only managed-backup R2 |
| `router-ab-signing-worker` | Private service routes | Its own presign-session Durable Object | SigningWorker-only D1 and presign-session Durable Object |

The Router Durable Object serializes tenant-root creation, refresh, restore,
activation, and cutover state. Deriver shares remain in their role-private D1
databases. SigningWorker's Durable Object serializes live ECDSA presign
sessions; its durable lane and pool records remain in SigningWorker D1.

## Deriver database placement

Deriver A and Deriver B must keep separate D1 databases for share isolation,
and those database primaries should be in the same Cloudflare metro. The Yao
protocol has dependent A/B rounds, so placing the primaries in different metros
adds cross-region latency throughout a ceremony.

A D1 location such as `apac` is a broad placement hint. Cloudflare applies the
hint when the database is created and does not guarantee a particular city or
that two databases with the same hint will share a metro. Verify every new
Deriver database with a remote query before activating the lane:

```sh
pnpm exec wrangler d1 execute <database-name> \
  --remote \
  --json \
  --command "SELECT 1 AS ready"
```

Require `meta.served_by_primary` to be `true` and compare
`meta.served_by_colo` for the two results. Both values should name the same
metro. See Cloudflare's [D1 data location documentation](https://developers.cloudflare.com/d1/configuration/data-location/).

After the D1 primaries are verified, configure both Deriver Workers for the
corresponding region in the hosted deployment target. Worker placement controls
where the Worker executes; it does not move an existing D1 primary. Cloudflare
[Custom Regions](https://blog.cloudflare.com/custom-regions/) controls where
eligible traffic is decrypted and processed, including Worker execution. It
does not select a D1 primary location.

If Cloudflare places the databases in different metros, keep the active
databases available for rollback while replacing one or both:

1. Create replacement databases and verify their actual metros before copying
   data.
2. Export each active database and import it into the verified replacement.
3. Deploy the Deriver with the replacement D1 binding and matching Worker
   placement.
4. Re-export the old database after cutover and compare it with the pre-cutover
   export to detect writes that arrived during migration.
5. Validate the active Worker version, D1 binding, placement, health checks, and
   a complete ceremony before retiring the old database.

Use the exact migration and rollback procedure owned by the private deployment
repository. D1 exports contain private protocol state and must stay in protected
deployment storage.

## Binding ownership

The committed Wrangler manifests are the binding source of truth:

- [`wrangler.router.toml`](../../crates/router-ab-cloudflare/wrangler.router.toml)
- [`wrangler.tenant-root-control-plane.toml`](../../crates/router-ab-cloudflare/wrangler.tenant-root-control-plane.toml)
- [`wrangler.deriver-a.toml`](../../crates/router-ab-cloudflare/wrangler.deriver-a.toml)
- [`wrangler.deriver-b.toml`](../../crates/router-ab-cloudflare/wrangler.deriver-b.toml)
- [`wrangler.signing-worker.toml`](../../crates/router-ab-cloudflare/wrangler.signing-worker.toml)

Deployment tooling replaces lane-specific D1 placeholders and renders the
final Worker configuration from the selected deployment target. Keep binding
names stable unless the persistence and deployment migration are changed
together.

## Secret separation

Each Worker receives only the keys required by its role:

| Worker | Secret classes |
| --- | --- |
| Router | Internal service authentication; JWT verification configuration; public Deriver and SigningWorker recipient keys |
| Tenant Root Control Plane | Internal service authentication; tenant-root issuer signing key; recovery trust configuration |
| Deriver A | Internal service authentication; A D1 KEK; A envelope private key; A backup-protection material |
| Deriver B | Internal service authentication; B D1 KEK; B envelope private key; B backup-protection material |
| SigningWorker | Internal service authentication; SigningWorker D1 KEK; SigningWorker recipient private key and lane-protection material |

Deriver A and Deriver B must use distinct private databases, R2 buckets, KEKs,
and envelope keys. A Worker must fail startup if a required binding is absent or
if forbidden cross-role material is present.

The same-account topology isolates Worker roles and resources under a trusted
account administrator. Separate accounts can also separate credentials and
deployment permissions. Neither arrangement claims protection from an operator
or deployment authority that controls both roles.

The Derivers hold no peer-message signing key, and no Worker reads a peer
verifying key. The Ed25519 Yao pair runs over authenticated service calls
([R155C](../refactor-155C-yao-peer-connection.md)), and ECDSA derivation sends
no message from one Deriver to the other. Role encryption keys, tenant-root
lifecycle signing keys, and authenticated transport remain required.

### Retiring the peer-signing keys from a deployment

Versions before this removal fail startup without the peer-signing
configuration. Retire it in two steps:

1. Activate, on every role, a version that no longer reads it. That version
   ignores leftover `DERIVER_*_PEER_SIGNING_KEY` Secrets and the
   `DERIVER_*_PEER_SIGNING_KEY_BINDING`, `DERIVER_*_PEER_SIGNING_KEY_EPOCH`, and
   `DERIVER_*_PEER_VERIFYING_KEY_HEX` variables.
2. Delete those Secrets and variables once no older version can be restored.
   A rollback to an older version needs them back first.

The Router keyset no longer carries `signer_peer_verifying_keys`. The Gateway
rejects a configured keyset that still names it, and an older Gateway rejects a
keyset without it, so update the Gateway's `ROUTER_AB_PUBLIC_KEYSET_JSON` in the
same activation as the Gateway version.

Router, Deriver A, and Deriver B change together for R155C. A Router of that
version sends no receipt, a Deriver A accepts none, and a Deriver B expects no
receipt header. Settle running ceremonies and activate the three roles
together.

## Deployment lanes

The private deployment repository defines three backend lanes:

- `staging-testnet`
- `production-testnet`
- `production-mainnet`

Each lane resolves exact Worker names, D1 database IDs, R2 buckets, domains,
Secrets, and release branch policy from
`deployment/wallet-system/targets.json`. Application code must not choose a
deployment profile at runtime.

## Build and package verification

Run these commands from `seams-wallet` before publishing a Wallet Server
release:

```sh
pnpm build:workers
pnpm router:deploy:dry-run
pnpm -C crates/router-ab-cloudflare test:private-d1
cargo test --locked --manifest-path crates/router-ab-cloudflare/Cargo.toml
```

`build:workers` builds all five role artifacts, including the tenant-root
control plane. `test:private-d1` builds the development Worker profile and
exercises role-private persistence, tenant-root lifecycle, managed restore,
and recovery boundaries.

The published `@seams/wallet-server` package must contain the five Worker
artifacts, manifests, and migrations referenced by its artifact manifest. The
hosted deployment consumes that package; it does not rebuild from an unrelated
Wallet checkout.

## Hosted deployment sequence

Run hosted deployment commands from `seams-monorepo`. Inspect the exact plan
first:

```sh
pnpm deploy:backend plan --lane staging-testnet --component wallet-system
```

For an already-provisioned lane, the deployment orchestrator applies this
order:

1. Build the Wallet-system artifacts once and verify the lane branch.
2. Migrate the Gateway signer database.
3. Migrate and deploy SigningWorker, Deriver A, and Deriver B.
4. Deploy Tenant Root Control Plane.
5. Deploy Router after the control plane and all three private role Workers.
6. Deploy Wallet Runtime.
7. Deploy Gateway.
8. Smoke Gateway, Wallet Runtime, and Router A/B endpoints.

The control plane uses an external binding to the Router-owned Durable Object,
while Router uses a service binding to the control plane. Existing lanes
already have the Router namespace required to break this deployment dependency
cycle. Provisioning a fresh lane requires a bootstrap Router configuration,
then the control plane, then the final Router configuration; the current deploy
script intentionally accepts only provisioned lanes.

The available operations are:

```sh
pnpm deploy:backend build --lane staging-testnet --component wallet-system
pnpm deploy:backend migrate --lane staging-testnet --component wallet-system
pnpm deploy:backend preflight --lane staging-testnet --component deriver-a
pnpm deploy:backend deploy --lane staging-testnet --component deriver-a
pnpm deploy:backend smoke --lane staging-testnet --component wallet-system
```

`preflight` and `deploy` operate on one component. `build`, `migrate`, and
`smoke` operate on the composed Wallet system. Production commands use the
same interface with the appropriate production lane and enforced branch.

## Release checks

A release is incomplete until all of these hold:

- the packaged Wallet Server artifact manifest matches the deployed release;
- all D1 migrations for both Derivers and SigningWorker have applied;
- the Router tenant-root Durable Object and SigningWorker presign-session
  Durable Object migrations are present;
- each Deriver has its own managed-backup R2 bucket and role-private keys;
- the control-plane issuer key is available only to the control-plane Worker;
- Router keyset and Gateway ceremony JWKS endpoints return the expected keys;
- health and readiness checks pass for Gateway and both curve families;
- a tenant-root status read agrees with both Deriver active epochs;
- normal signing succeeds without Deriver traffic;
- logs and traces contain identifiers and digests without secret shares,
  plaintext recipient packages, authorization tokens, or private keys.

Rollback must preserve storage compatibility and one-use signing state. Never
roll back a Worker binary across an applied schema or Durable Object migration
unless the release procedure explicitly proves that combination safe.


## Application hosting contract

The Wallet Server uses the Workers programming model on both supported hosts.
Cloudflare runs the released Worker handlers and WASM artifacts through workerd.
Self-hosted qualification runs the same artifacts through the pinned private celld build on Google Cloud.
Runtime packaging, permissions, and process supervision belong to the deployment boundary.
The application uses Worker service bindings, Durable Objects, D1, KV, and separate A/B object-storage bindings.

The Server package no longer publishes `@seams/wallet-server/router/express`.
The Express Router constructor, response conversion, session-seal registration, and Express-specific source-IP helpers are removed.
Use the existing Worker/fetch entrypoints, including `router/cloudflare` and `hosted-wallet-gateway-worker`.
The `router/cloudflare` name identifies the Workers API surface used by both hosts.
No deprecated export or Node HTTP bridge replaces the removed Express entrypoint.

The Node Gateway, its SQLite facade, and the VM Wallet launcher are removed.
SQLite inspection remains only in test evidence tooling.
The removed Node listener supplied a 1 MiB request-body cap. Configure and qualify request limits at the self-hosted HTTPS ingress.
Remaining native VM server removal continues on the implementation branch.
A local candidate must pass the same lifecycle contracts before release and deployment.
Deployments with durable state require an inventoried, state-safe cutover; source deletion does not migrate that state.
