# Hosted auth-menu example

## Settings drawer preview

Build the SDK artifacts as described below, then run
`pnpm -C examples/seams-auth-menu dev` and open `/settings-drawer.html`.
This interactive mock uses the SDK's existing settings preview and native dialog.
It opens as a right-side drawer on desktop and a bottom sheet below 600px.
The content scrolls within the drawer while its header and footer stay visible.
Close the drawer to switch between Light and Dark, or open `?theme=dark` directly.
`?open=0` starts with the drawer closed.

Drawer styling is scoped to this preview. The mock does not add a public SDK
presentation mode or connect to a wallet.

## Hosted authentication

This React example uses the public `@seams/wallet` 0.14.0 provider and hosted
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

Use a wallet origin running the matching 0.14.0 assets and an environment that
allows this application's origin. These variables are visible in the browser;
keep private API keys and role credentials on the server.

```sh
pnpm -C examples/seams-auth-menu dev
pnpm -C examples/seams-auth-menu type-check
pnpm -C examples/seams-auth-menu build
```

The example configures NEAR testnet. It logs `HostedAuthMenuOutcome`; adapt the
handler to render success, cancellation, and failure in your application.
When copying the example into another app, install `@seams/wallet@0.14.0`, React,
and React DOM and preserve the `@seams/wallet/react/styles` import.
