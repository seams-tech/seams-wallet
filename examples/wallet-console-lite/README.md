# Wallet Console Lite

This example runs one local Wallet project against the public Seams Wallet SDK and
local Wallet system. It contains the smallest useful project setup, Wallet lifecycle,
signing check, and server threshold-share recovery command guide.

## Run it

From the repository root:

```sh
pnpm install
pnpm wallet-console-lite
```

Open `http://localhost:4201`, enter an organisation and project name, then create or
unlock a Wallet. The first setup starts the isolated local Wallet roles and Gateway.
No `.env` file or private Console service is required.

Use `pnpm wallet-console-lite -- --root ./path/to/runtime` to preserve local runtime
state. Use `--skip-build` after the public Wallet artifacts have already been built.
If a run is interrupted, stop any remaining `wrangler dev` processes before restarting.

## Local ports

- `http://localhost:4201` — Wallet Console Lite
- `http://localhost:4202` — hosted Wallet iframe and SDK assets
- `http://127.0.0.1:4100` — Wallet Gateway
- `http://127.0.0.1:4102-4106` — isolated Wallet role Workers

The loopback setup controller listens on `127.0.0.1:4203` and accepts workspace setup
only from the exact app origin. Its response contains browser-safe public Wallet
configuration. Role credentials, recovery issuer material, local secret API keys,
Worker bindings, and persistence paths remain in the controller/runtime process.

The recovery page generates `seams-wallet` CLI commands for export, operational-share
rotation, and restoring a deployment. Private wrapper keys and credentials remain in
the terminal; the browser does not receive or execute them. Install the CLI with
`npm install --global @seams/wallet-cli` before running those commands.
