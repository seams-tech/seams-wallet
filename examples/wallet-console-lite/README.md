# Wallet Console Lite

This example runs one local Wallet project against the public Seams Wallet SDK and
local Wallet system. It contains the smallest useful project setup, Wallet lifecycle,
signing check, and server threshold-share recovery command guide.

## Run it

From the repository root:

```sh
pnpm install
pnpm router
pnpm site
```

Run the commands in separate terminals. Open `http://localhost:4001`, enter an organisation
and project name once, then create or unlock a Wallet. Reloads reconnect to the
existing project automatically. The browser remembers only these display names so
it can reconnect after a site-controller restart; public runtime configuration is
always fetched from the controller. No `.env` file, private Console
service, or `seams-monorepo` checkout is required.

Use `pnpm router -- --root ./path/to/runtime` to select the backend runtime directory.
Use `pnpm site -- --skip-build` after the public Wallet artifacts have already been built.
If a run is interrupted, stop any remaining `wrangler dev` processes before restarting.

## Prediction-market transaction review

Choose **Preview component** for a sample YES purchase of 0.1 test units.
The React review and wallet approval share one modal that resizes between screens.
**Confirm in wallet** opens the transaction confirmer; its Back arrow returns to
the review. Approval is simulated, with no sign-in, signing, or transaction submission.
Reopening the preview refreshes its 90-second fixture quote.

This repository-only UI showcase imports SDK internals through the
`@wallet-preview` Vite alias and uses a separate fixture iframe. See
[`docs/transaction-review.md`](../../docs/transaction-review.md) for the public
`review` API used with real transactions.

The component and renderer live in `src/PurchaseReviewExample.tsx`; styling lives
in `src/styles.css`. `TransactionReviewHost` is mounted in `WalletConsoleLite.tsx`.

## Local ports

- `http://localhost:4001` — Wallet Console Lite
- `http://docs.localhost:4003/docs/` — Wallet documentation
- `http://localhost:4002` — hosted Wallet iframe and SDK assets
- `http://localhost:4101` — Caddy proxy to the Wallet Gateway
- `http://127.0.0.1:4100` — Wallet Gateway
- `http://127.0.0.1:4102-4106` — isolated Wallet role Workers

The loopback setup controller listens on `127.0.0.1:4203` and accepts workspace setup
only through the Caddy site origin. Its response contains browser-safe public Wallet
configuration after confirming that `pnpm router` is ready. Role credentials, recovery
issuer material, local secret API keys, Worker bindings, and persistence paths remain
in the backend process.

The recovery page generates `seams-wallet` CLI commands for export, operational-share
rotation, and restoring a deployment. Private wrapper keys and credentials remain in
the terminal; the browser does not receive or execute them. Install the CLI with
`npm install --global @seams/wallet-cli` before running those commands.
