# Seams Wallet

Open-source browser and server Wallet SDKs, signer runtimes, Rust/Wasm
implementation crates, documentation, examples, and recovery CLI.

Current SDK release: **0.28.0**. [Read the documentation](https://wallet.seams.sh/docs/) or start with the [release notes](./apps/docs/src/releases.md).

Packages for this release:

- `@seams/wallet@0.28.0` — browser SDK and React components.
- `@seams/wallet-server@0.28.0` — server SDK and packaged Worker runtimes.
- `@seams/voiceid@0.28.0` — optional VoiceID authentication plugin.
- `@seams/wallet-cli@0.28.0` — with its signed native release;
  see the [recovery CLI](./apps/docs/src/deploy-and-operate/recovery-cli.md).

Seams Wallet is licensed under Apache-2.0. See `LICENSE.md`.

The browser and server SDKs use wallet iframe protocol `18.0.0`. Upgrade the browser
SDK, wallet-origin assets, server SDK, and enabled VoiceID plugin together.
All four public Seams packages use version **0.28.0** in this release.
See [release notes](./apps/docs/src/releases.md) and the
[hosted integration guide](./apps/docs/src/deploy-and-operate/hosted-integration.md)
for changes and deployment requirements. The development checkout can contain
changes that npm does not yet publish.

The hosted Seams Console, product sites, and deployment configuration live
in the private `seams-tech/seams-monorepo` repository.

## New in 0.28.0

- **Bring your own Google authentication.** Reuse the app's Google ID token to open associated wallet settings without a second login.
  Existing wallets need a one-time owner-approved association. Signing and security changes retain their owner authentication requirements.
  Follow the [Google SSO guide](./apps/docs/src/guides/google-sso.md).
- **Wallet settings drawers.** Show localized account, method, and device views in a responsive settings panel.
- **Configurable VoiceID.** Select Citrinet or Aurora transcription models through the optional VoiceID package.

## Integrate the SDK

```sh
npm install @seams/wallet@0.28.0
# Server applications:
npm install @seams/wallet-server@0.28.0
# Applications that enable VoiceID:
npm install @seams/voiceid@0.28.0
```

Use `WalletConnectorMenu` from `@seams/wallet/react` inside `SeamsWebProvider` for
the default wallet selection panel. It supports Seams and configured external NEAR
wallets, including bundled official Meteor and HOT icons. Selecting Seams resizes
and animates the panel into hosted authentication. A back button returns to wallet
selection.

Apps can customize wallet choices, labels, descriptions, icons, and authentication
options. Connector controls and authentication success states use SDK theme tokens
for colors, spacing, corners, typography, and shadows. Transaction details scroll
inside the viewport, and receipt transitions stay within the wallet iframe.

Start with the [runnable connector example](./examples/seams-auth-menu/README.md),
the [React reference](./apps/docs/src/reference/react.md), and the
[hosted integration guide](./apps/docs/src/deploy-and-operate/hosted-integration.md).

## Local development

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
