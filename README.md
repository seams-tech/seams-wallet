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
