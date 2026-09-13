# Seams Wallet

Open-source browser and server Wallet SDKs, signer runtimes, Rust/Wasm
implementation crates, documentation, examples, and recovery CLI.

Published packages:

- `@seams/wallet`
- `@seams/wallet-server`
- `@seams/wallet-cli`

The TypeScript packages are MIT licensed. Rust crates and the recovery CLI
are Apache-2.0 licensed. See `LICENSE-MIT` and `LICENSE-APACHE`.

The hosted Seams Console, product sites, and deployment configuration live
in the private `seams-tech/seams-monorepo` repository.

Local development uses two terminals:

```sh
pnpm router
pnpm site
```

`pnpm router` starts the five isolated MPC Router roles, bootstraps the local tenant
root, migrates signer D1, and serves the Wallet Gateway. `pnpm site` starts Caddy,
Wallet Console Lite, the hosted Wallet iframe/assets, and the Wallet documentation.
Together they provide a complete local Wallet stack without `seams-monorepo`.

Wallet Console Lite supports local organisation/project setup, registration, unlock,
session inspection, safe message signing, and the public CLI workflows for server-share
export, rotation, and deployment restore. See
[`examples/wallet-console-lite`](./examples/wallet-console-lite/README.md).

### Packaged local runtime

`@seams/wallet-server` includes prebuilt Worker roles, signer/private-role
migrations, and the native local identity initializer. Consumers can run
`seams-wallet-server-local` (complete local Wallet system),
`seams-wallet-server-local-roles`, or `seams-wallet-server-local-init --root <directory>`.
Supported initializer targets match the CLI release: macOS arm64/x64 and Linux
x64. `pnpm build:local-tools` builds the host initializer in this source repo;
the npm release pipeline assembles all supported targets.

Private Console adapters use `@seams/wallet-server/local-runtime` for local
configuration and `@seams/wallet-server/tenant-root` for portable protocol
contracts. Console governance/security-state models stay in the private repo.

## Architecture specifications

Start with the [`docs` architecture guide](./docs/README.md) for the system map,
core vocabulary, user journeys, repository landmarks, and role-specific reading
paths. The numbered `spec-{x}-{title}.md` documents define the current Wallet
architecture. [`docs/intended-behaviours.md`](./docs/intended-behaviours.md)
owns supported user-visible lifecycle behaviour, while
[`docs/spec-9-behaviour-and-test-authority.md`](./docs/spec-9-behaviour-and-test-authority.md)
defines the complete documentation and test authority order.

1. [Runtime and platform boundaries](./docs/spec-1-runtime-and-platform-boundaries.md)
2. [Authentication, custody, and credentials](./docs/spec-2-auth-custody-and-credentials.md)
3. [Wallet sessions and execution lanes](./docs/spec-3-wallet-sessions-and-execution-lanes.md)
4. [Persistence and durable authority](./docs/spec-4-persistence-and-durable-authority.md)
5. [Router A/B threshold protocol](./docs/spec-5-router-ab-threshold-protocol.md)
6. [Tenant roots, recovery, and portability](./docs/spec-6-tenant-roots-recovery-and-portability.md)
7. [Hosted surfaces and provider boundaries](./docs/spec-7-hosted-surfaces-and-provider-boundaries.md)
8. [Agent authority, spending, and payment rails](./docs/spec-8-agent-authority-spending-and-payment-rails.md)
9. [Behaviour and test authority](./docs/spec-9-behaviour-and-test-authority.md)
