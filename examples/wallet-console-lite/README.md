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
and project name, then create or unlock a Wallet. No `.env` file, private Console
service, or `seams-monorepo` checkout is required.

Use `pnpm router -- --root ./path/to/runtime` to select the backend runtime directory.
Use `pnpm site -- --skip-build` after the public Wallet artifacts have already been built.
If a run is interrupted, stop any remaining `wrangler dev` processes before restarting.

## Prediction-market transaction review

After local project setup, create or unlock a NEAR testnet wallet. In the
**Prediction market · R140 demo** panel, choose YES or NO and a fixture amount,
then select **Review prediction trade**. Your React trade summary opens inside
the SDK's existing transaction-confirmer modal. **Confirm in wallet** transitions
the same modal to the standard wallet approval; **Back to trade** cancels it.

Quotes expire after 90 seconds. The expired, slow, and failing review buttons
exercise the same SDK error and loading flows. The fixture market does not buy
positions: final approval sends a zero-value NEAR self-transfer and incurs
testnet gas. Actual network fees are shown by the wallet.

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
