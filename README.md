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

After building the Worker artifacts, run the Console-free local Wallet backend with
`pnpm wallet-system:local`. It starts the five isolated Router roles, bootstraps a
local tenant root, migrates signer D1, and serves the Wallet Gateway at
`http://127.0.0.1:4100`.

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
