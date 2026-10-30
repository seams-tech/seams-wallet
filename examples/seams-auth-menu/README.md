# Hosted auth-menu example

## Settings drawer preview

Build the SDK artifacts as described below, then run
`pnpm -C examples/seams-auth-menu dev` and open `/settings-drawer.html`.
This interactive example uses `AccountMenuButtonMock` with `presentation="drawer"`.
It opens as a right-side drawer on desktop and a bottom sheet below 600px.
The content scrolls within the drawer while its header and footer stay visible.
Close the drawer to switch between Light and Dark, or open `?theme=dark` directly.
`?open=0` starts with the drawer closed.

The SDK owns the drawer styling, animation, scrolling, and focus behavior.
The preview supplies sample data and does not connect to a wallet.

## Hosted authentication

This React example uses the public `@seams/wallet` 0.30.0 provider and hosted
auth-menu entrypoints. The wallet origin owns registration and login prompts.

From the repository root, install dependencies and build the SDK artifacts:

```sh
pnpm install
pnpm build
```

Create `examples/seams-auth-menu/.env.local` with your project's public values:

```dotenv
VITE_WALLET_ORIGIN=https://wallet.example.com
VITE_RELAYER_URL=https://gateway.example.com
VITE_PROJECT_ENVIRONMENT_ID=YOUR_ENVIRONMENT
VITE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Use a wallet origin running the matching 0.30.0 assets and an environment that
allows this application's origin. These variables are visible in the browser;
keep private API keys and role credentials on the server.

```sh
pnpm -C examples/seams-auth-menu dev
pnpm -C examples/seams-auth-menu type-check
pnpm -C examples/seams-auth-menu build
```

The example configures NEAR testnet. It logs `HostedAuthMenuOutcome`; adapt the
handler to render success, cancellation, and failure in your application.
When copying the example into another app, install `@seams/wallet@0.30.0`, React,
and React DOM and preserve the `@seams/wallet/react/styles` import.


## Application-owned authentication

Open `/application-auth.html` after signing in to your application.
Mount `applicationWalletHandoff` from `src/applicationAuthBackend.ts` at `/api/wallet/handoff` on your backend.
Supply a verified session reader, the configured Ed25519 issuer key, environment ID, and secret API key.
The browser receives only the attempt's handoff code.

The example creates a NEAR-only owner wallet, links an application identity with fresh owner proof, and connects for reading.
Each self-transfer requires another owner approval.
The operation handle exposes cancellation and unknown outcomes.
Recovery queries the saved transaction and never broadcasts again.
Google and app-passkey login must resolve to the same stable application subject.
Wallet approval uses an enrolled wallet-origin passkey.

Run the composed contract with the existing intended-behaviour runner:

```sh
node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.near-submission.contract.test.ts --grep 'application handoff'
```

The contract uses the real Wallet ceremony, WebAuthn owner proof, MPC signing, and D1 stores.
Its Google login session and NEAR RPC are deterministic fixtures. App passkey login uses a real browser WebAuthn assertion.
The artifact records signed transactions, verifies their signatures against registered keys, and confirms zero reusable sessions and quotas.
