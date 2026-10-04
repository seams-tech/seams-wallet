---
title: Hosted integration
description: Serve the Seams wallet service and SDK runtime assets from a dedicated HTTPS wallet origin and connect an allowed application origin.
---

# Hosted integration

The product application imports `@seams/wallet`. A dedicated wallet origin serves
the wallet service, SDK support assets, workers, and export viewer used by the
isolated iframe.

## Required routes

Deploy the wallet service at the configured `walletServicePath` and runtime
assets at `sdkBasePath`. Preserve asset content types, cache immutable hashed
files, and prevent stale HTML from pinning an old runtime manifest.

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

## Upgrading to 0.8.0

Pin the application package and backend package to **0.8.0**, and build the
wallet-origin runtime, workers, WASM, and support assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.8.0

# Backend deployment
pnpm add @seams/wallet-server@0.8.0
```

This release changes wallet-management and ECDSA bootstrap contracts. An
already-open 0.7.x client can receive an HTTP 409 upgrade-required response.
Show the reload/upgrade message, stop the attempt, and reload with the matching
application and wallet assets. Retrying the old payload cannot repair version
skew. The iframe handshake version alone does not establish backend compatibility.

Update integrations to the exported 0.8.0 capability groups and result types.
Use `HostedSeamsAuthMenu` for the wallet-origin auth UI and keep WebAuthn prompts
on the wallet origin. Remove application-origin credential bridges and imports
of unexported SDK modules. Roll back application, wallet assets, and backend as
a coordinated release pair.

The regional cutover used disposable test wallets. Version 0.8.0 does not
provide an existing-wallet migration tool; operators with durable wallet state
must resolve that cutover before replacing their deployment.

## Regional routing

In a regional deployment, registration assigns each wallet its own fixed home.
The shared directory routes future lifecycle and signing requests to that home,
including requests from linked devices and travelling users. Different wallets
in the same project can have different homes. See
[per-wallet homes](/concepts/architecture#per-wallet-regional-homes).

Use the configured Gateway URL from your project. Applications do not select a
D1 database or pass a region on each signing request. Operators verify the
regional Worker bindings, D1 primary served region, and DO/Container placement
before accepting a home. Directory failure must surface as an unavailable
operation; it cannot authorize a write in another region.
