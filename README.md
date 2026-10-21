# Seams Wallet

Open-source browser and server Wallet SDKs, signer runtimes, Rust/Wasm
implementation crates, documentation, examples, and recovery CLI.

Published packages:

- `@seams/wallet@0.17.0`
- `@seams/wallet-server@0.17.0`
- `@seams/wallet-cli@0.17.0` — with its signed native release;
  see the [recovery CLI](./apps/docs/src/deploy-and-operate/recovery-cli.md).

Seams Wallet is licensed under Apache-2.0. See `LICENSE.md`.

Publication status checked October 21, 2026. The browser and server SDKs use
wallet iframe protocol `16.0.0`. Keep application code and wallet-origin assets
on the same release. The CLI has its own release cadence.
See [release notes](./apps/docs/src/releases.md) and the
[hosted integration guide](./apps/docs/src/deploy-and-operate/hosted-integration.md)
for changes and deployment requirements. The development checkout can contain
changes that npm does not yet publish.

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

### TypeScript compiler

Project checks, declaration builds, and the packed SDK consumer check use the exact
`tsrs` version in the root `package.json`. The root `typescript` dependency supplies
the JavaScript API used by build-analysis scripts and declaration comparison.
Vite, Rolldown, and Bun still produce application JavaScript.

```sh
pnpm type-check
pnpm -C packages/wallet build:sdk
pnpm -C packages/wallet-server build
pnpm -C packages/wallet check:declarations-external
```

The SDK build uses existing WASM outputs. Use `pnpm build:wasm` when those outputs
need regeneration.

Compare tsrs with its matching upstream compiler from the repository root:

```sh
npm install --prefix .artifacts/typescript-reference --ignore-scripts --no-audit --no-fund typescript@7.1.0-dev.20260930.4
node tests/e2e/typescript-compiler-comparison.e2e.mjs \
  --reference .artifacts/typescript-reference/node_modules/typescript/bin/tsc \
  --candidate node_modules/.bin/tsrs
```

The comparison covers ten configurations, including lifecycle type fixtures and
browser tests, plus both declaration builds. It compares checked source files and
declaration syntax. Record property order may differ. Overload and signature order
must match. Declaration maps must have matching metadata and source paths, while
encoded position mappings may differ. Run the comparison without concurrent builds
or tests. It excludes one warmup and records three samples per project.

Logs, declarations, source manifests, times, and peak resident memory go to
`.artifacts/typescript-compiler-comparison/result/`. A successful run prints
`Verified` and sets `verified: true` in `result.json`. Linux requires GNU
`/usr/bin/time`; macOS uses its bundled `/usr/bin/time`.

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

Start with [How the wallet works](./docs/README.md), then choose a topic from the
numbered `spec-{x}-{title}.md` chapters. Each explains the main flow and links to
further detail. [Intended Behaviours](./docs/intended-behaviours.md) defines the
supported user journeys.
