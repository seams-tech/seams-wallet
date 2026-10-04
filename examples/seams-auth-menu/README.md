# Hosted auth-menu example

This React example uses the public `@seams/wallet` 0.8.0 provider and hosted
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

Use a wallet origin running the matching 0.8.0 assets and an environment that
allows this application's origin. These variables are visible in the browser;
keep private API keys and role credentials on the server.

```sh
pnpm -C examples/seams-auth-menu dev
pnpm -C examples/seams-auth-menu type-check
pnpm -C examples/seams-auth-menu build
```

The example configures NEAR testnet. It logs `HostedAuthMenuOutcome`; adapt the
handler to render success, cancellation, and failure in your application.
When copying the example into another app, install `@seams/wallet@0.8.0`, React,
and React DOM and preserve the `@seams/wallet/react/styles` import.
