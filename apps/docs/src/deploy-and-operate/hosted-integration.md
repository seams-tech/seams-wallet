---
title: Hosted integration
description: Serve the Seams wallet service and SDK runtime assets from a dedicated HTTPS wallet origin and connect an allowed application origin.
---

# Hosted integration

The product application imports `@seams/wallet`. A dedicated wallet origin serves
the wallet service, SDK support assets, workers, and export viewer used by the
isolated iframe.

## Required routes

Deploy the wallet service at the configured `walletServicePath` and runtime assets at
`sdkBasePath`. Preserve asset content types. Cache immutable files whose names contain
content hashes. Prevent stale HTML from selecting an old runtime manifest.

The application configures the absolute HTTPS wallet origin. It should not
proxy wallet routes through the application origin or serve a second copy of
the runtime assets.

## Release verification

- Load the wallet service directly and confirm the expected release identity.
- Register and unlock from an allowed app origin.
- Verify that an unlisted origin is rejected.
- Exercise one signing confirmation, cancellation, and retryable failure.
- Confirm workers and WASM load under the production CSP.
- Confirm export content remains inside the wallet-origin viewer.

Use the published `@seams/wallet/web/wallet-iframe-client-html` asset only for the
supported hosted-wallet build path. Keep package code and hosted assets on the
same compatible release.

## Upgrading to 0.9.0

Pin the application package and backend package to **0.9.0**, and build the
wallet-origin runtime, workers, WASM, and support assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.9.0

# Backend deployment
pnpm add @seams/wallet-server@0.9.0
```

This release changes the registration contract and the wallet iframe protocol. The
wallet-management protocol is `3` and the iframe protocol is `15.0.0`. An already-open
0.8.0 client receives an HTTP 409 upgrade-required response from a 0.9.0 backend. Show
the reload or upgrade message. Stop the attempt. Reload with matching application and
wallet assets. Retrying the old payload cannot fix a version mismatch. A 0.8.0
application cannot connect to 0.9.0 wallet-origin assets, so release the application
and the wallet origin together.

Update integrations to the consolidated wallet API. `registerWallet`,
`connection.connect`, `signMessage`, and `signAndSendTransaction` replace the separate
registration, iframe-initialization, and execution calls. `auth.lock` replaces `logout`.
Remove the provider's `eager` prop. See the [SDK reference](/reference/) for the
complete surface.

Deploy the Gateway, wallet runtime, Router, both Derivers, and the Signing Worker from
the same release, and apply its complete D1 migration set. Remove
`signer_peer_verifying_keys` from `ROUTER_AB_PUBLIC_KEYSET_JSON` in the same activation.
Deriver migration `0019` renames a column that 0.8.0 reads. A rollback to 0.8.0 must
reverse that migration and restore the matching application, wallet assets, and
backend together.

Version 0.9.0 requires wallet-object addresses, which wallets registered on 0.8.0 do
not have. It does not provide a tool to migrate those wallets. Operators with durable
wallet state must resolve that migration before replacing their deployment.

## Regional routing

In a regional deployment, registration assigns each wallet its own home.
The shared directory routes future lifecycle and signing requests to that home,
including requests from linked devices and travelling users. The home changes
only when the owner moves the wallet to another region. Different wallets
in the same project can have different homes. See
[per-wallet homes](/concepts/architecture#per-wallet-regional-homes).

Use the configured Gateway URL from your project. Applications do not select a D1
database or pass a region on each signing request. Operators verify the regional Worker
bindings, D1 primary served region, and DO/Container placement before accepting a home.
A directory failure must report the operation as unavailable. It cannot authorize a
write in another region.