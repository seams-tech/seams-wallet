# Seams services (`packages/host`)

This folder holds the code that only an operator deploys. It becomes the source of the published
`@seams/host` package when Release B moves the package manifest here
(`docs/refactor-251-auth-wallet-checkout-modules.md`, Slice 9). Until then,
`packages/mpc-wallet-server` builds and publishes `@seams/host`, and it bundles this folder.

## `src/credentials`

The checks of the project credentials, for each service:

| File | What it holds |
| --- | --- |
| `ports.ts` | The ports to the operator's key store: key principals, scopes, environments, the registration context and the usage meter |
| `routePolicy.ts` | What a route declares (`RouteAuthPolicy`) and the one check before a handler (`enforceRoutePolicy`) |
| `keyChecks.ts` | The publishable key check (key, origin, environment) and the secret key check (scopes of the route) |
| `registrationContext.ts` | A checked publishable key joined to its active environment |
| `walletConsoleOps.ts`, `walletConsoleOpsClient.ts` | The private service binding to the Wallet Console and its client |
| `staticWalletConsoleBinding.ts` | The same binding from a static configuration, for a self-hosted deployment |

Rules:

- A module declares the plane, the credential kinds and the scopes of each route. This folder
  checks them and gives the handler the checked principal.
- The operator keeps the keys. The code here calls the key store only through the ports.
- This folder imports no module code. It imports from `packages/shared-ts` only. Two contracts
  there (the external auth configuration and the Wallet Session limits) move to their owners in
  Slice 8.
