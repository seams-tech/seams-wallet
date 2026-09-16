# Router A/B Cloudflare deployment

Status: current deployment topology and release procedure.

The supported hosted topology places the Router A/B role Workers in one
Cloudflare account per deployment lane. Service bindings connect the roles.
Each role keeps separate entrypoints, Secrets, persistence bindings, and
protocol authority.

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
| Deriver A | Internal service authentication; A D1 KEK; A envelope private key; A peer-signing key; A backup-protection material |
| Deriver B | Internal service authentication; B D1 KEK; B envelope private key; B peer-signing key; B backup-protection material |
| SigningWorker | Internal service authentication; SigningWorker D1 KEK; SigningWorker recipient private key and lane-protection material |

Deriver A and Deriver B must use distinct private databases, R2 buckets, KEKs,
envelope keys, and peer-signing keys. A Worker must fail startup if a required
binding is absent or if forbidden cross-role material is present.

The same-account topology creates an operational separation boundary between
Workers and resources. It does not provide an independent Cloudflare account or
administrator boundary.

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
