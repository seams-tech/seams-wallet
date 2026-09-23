# Router A/B local development

Status: current commands for the `seams-wallet` repository.

The local harness runs the same five Router A/B Worker artifacts used by the
hosted deployment:

- Router
- Tenant Root Control Plane
- Deriver A
- Deriver B
- SigningWorker

It also runs the local Wallet Gateway when using the full-system command. Local
Wrangler service bindings, D1 databases, Durable Objects, and generated Secrets
preserve the production role boundaries on one development machine.

## Prerequisites

- the repository's pinned Node.js and pnpm versions;
- Rust with the `wasm32-unknown-unknown` target;
- the Wrangler version installed by the workspace;
- Caddy for the browser example (`brew install caddy` on macOS).

Install dependencies from the repository root before starting the system.

## Run the complete local system

Start the backend in one terminal:

```sh
pnpm router
```

The command builds missing Worker artifacts, creates local role identities and
Secrets, applies role-private D1 migrations, starts all five role Workers,
creates and activates a local tenant root, renders the Gateway configuration,
applies the Gateway signer migration, and starts Gateway. Each default run uses
a fresh temporary runtime root; the ready line prints its path.
Set `WRANGLER_LOG=log` before `pnpm router` when detailed Wrangler output is needed.

Start the browser example in another terminal:

```sh
pnpm site
```

Open `http://localhost:4001`. The setup form creates the fixed local workspace
and connects it to the running Gateway. The hosted Wallet surface is available
at `http://localhost:4002`; Caddy proxies the Gateway at
`http://localhost:4101`.

Stop either process with Ctrl-C. A child Worker failure stops the process group
so the next run does not silently reuse a partial topology.

## Local ports

| Service | URL |
| --- | --- |
| Wallet Gateway, direct | `http://127.0.0.1:4100` |
| Wallet Gateway, browser proxy | `http://localhost:4101` |
| Router | `http://127.0.0.1:4102` |
| Deriver A | `http://127.0.0.1:4103` |
| Deriver B | `http://127.0.0.1:4104` |
| SigningWorker | `http://127.0.0.1:4105` |
| Tenant Root Control Plane | `http://127.0.0.1:4106` |
| Wallet Console Lite | `http://localhost:4001` |
| Hosted Wallet | `http://localhost:4002` |

The private role ports are development listeners. Product requests still enter
through Gateway; direct access is for focused adapter testing and requires the
generated internal authentication material.

## Focused role-worker development

Build the Workers:

```sh
pnpm build:workers
```

Start only the five role Workers:

```sh
pnpm -C crates/router-ab-cloudflare dev:local-roles
```

This command initializes local role identities when needed, applies Deriver and
SigningWorker D1 migrations, and waits for the Router keyset endpoint. It does
not start Gateway or provision a product workspace.

Start the composed role Workers and Gateway directly with:

```sh
pnpm -C crates/router-ab-cloudflare dev:local-wallet-system
```

The root `pnpm router` command is the preferred wrapper because it checks for
missing artifacts first.

Both scripts accept `--root <runtime-directory>` after `--`. Use an explicit,
new runtime directory when a test needs a known path:

```sh
pnpm router -- --root .runtime/router-ab-manual
```

Generated `.env.router-ab.*.local` files, ceremony keys, Wrangler state, and
rendered Gateway files live under that runtime root. They are development
credentials and must never be committed or copied into a hosted lane.

## Tenant-root bootstrap

`dev:local-wallet-system` bootstraps the tenant root automatically. For a
role-worker-only process, use the supported helper after the Router is ready:

```sh
pnpm -C crates/router-ab-cloudflare bootstrap:local-tenant-root -- \
  --root .runtime/router-ab-manual \
  --org-id org_local_wallet \
  --project-id local-smoke-project \
  --env-id local-smoke-project:dev \
  --signing-root-id local-smoke-project:dev \
  --signing-root-version default \
  --router-url http://127.0.0.1:4102
```

The helper signs a local creation grant and calls Router's private creation
endpoint. It succeeds only after both Derivers persist their role shares and
the tenant-root lifecycle reaches `ready`.

## Verification

Use the narrowest command for the boundary being changed:

```sh
# Worker persistence, tenant-root lifecycle, restore, and role boundaries
pnpm -C crates/router-ab-cloudflare test:private-d1

# Rust Cloudflare adapter and protocol tests
cargo test --locked --manifest-path crates/router-ab-cloudflare/Cargo.toml

# Worker-WASM vector adapters
pnpm -C crates/router-ab-cloudflare test:wasm-vectors

# Product lifecycle contracts
pnpm test:intended

# Browser integration
pnpm test:wallet-browser
```

`test:private-d1` builds all five Workers with the development profile before
running its integration harness. `test:intended` owns registration, unlock,
signing, step-up, and export behaviour; it starts an isolated runtime through
the test runner.

## Troubleshooting

### A role Worker exits during startup

Read the first Worker error. Startup validation deliberately rejects missing
bindings, invalid keys, unavailable databases, wrong-role configuration, and
forbidden cross-role material. Restart with a fresh runtime root after changing
generated local configuration.

### Router starts before a private role is ready

The supervisor starts private roles before Router and waits for every listener
plus `/.well-known/router-ab/keyset`. A child exit tears down the whole group.
Check for an occupied port or an earlier Wrangler process.

### The browser example reports that the backend is unavailable

Wait for the `wallet_local_system_ready_v1` line from `pnpm router`. Confirm
that `http://127.0.0.1:4100/readyz` responds, then submit the setup form again.

### The site reports that a port is already in use

Stop an earlier `pnpm site` process with Ctrl-C. If it has already exited,
identify any remaining local listeners with
`lsof -nP -iTCP:4201 -iTCP:4202 -sTCP:LISTEN`, inspect their commands with
`ps -p <PID> -o pid,ppid,command`, and stop only stale Wallet site processes.
Then run `pnpm site` again.

### Local state conflicts with a changed schema

Use a new `--root` directory. Local runtime state represents one coherent set
of Worker artifacts, migrations, generated keys, and tenant-root lifecycle
records.
