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

## Upgrading to 0.10.0

Pin the application package and backend package to **0.10.0** and build the
wallet-origin runtime, workers, WASM, and support assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.10.0

# Backend deployment
pnpm add @seams/wallet-server@0.10.0
```

This release changes the registration contract. The wallet-management protocol is `4`.
The iframe protocol stays `15.0.0`. An already-open 0.9 client receives an HTTP 409
upgrade-required response from a 0.10.0 backend. Show the reload or upgrade message.
Stop the attempt. Reload with matching application and wallet assets. Retrying the old
payload cannot fix a version mismatch. Release the application, the wallet origin and
the backend together.

The public SDK calls do not change. A NEAR-only passkey registration now sends the
passkey proof and the custody execution in one request, and registration no longer
writes the shared capability record of the environment. During the passkey prompt the
backend admits the two custody roles and connects them. This preparation holds no
client input and grants no execution authority.

Registration setup has a rate limit of 30 requests per minute for one publishable key
and one source address, counted in each region. A further request receives HTTP 429
with the code `rate_limited`. Show the message and let the user try again after one
minute. A backend that forwards the requests of many users from one address shares
one limit among them.

Deploy the Gateway, wallet runtime, Router, both Derivers, and the Signing Worker from
the same release, and apply its complete D1 migration set before the new versions
serve. Gateway migration `0079` adds three indexes, and `0080` adds the table of the
setup rate limit. Migration `0020` of each Deriver database adds one column to the
root-use admissions. A registration that started on 0.9 does not continue on 0.10.0:
start it again.

## Upgrading from 0.8.0 to 0.9

Release 0.9.0 changed the registration contract and the wallet iframe protocol. Its
wallet-management protocol is `3` and its iframe protocol is `15.0.0`. An already-open
0.8.0 client receives an HTTP 409 upgrade-required response from a 0.9 backend. A 0.8.0
application cannot connect to 0.9 wallet-origin assets, so release the application
and the wallet origin together.

Update integrations to the consolidated wallet API. `registerWallet`,
`connection.connect`, `signMessage`, and `signAndSendTransaction` replace the separate
registration, iframe-initialization, and execution calls. `auth.lock` replaces `logout`.
Remove the provider's `eager` prop. See the [SDK reference](/reference/) for the
complete surface.

Remove `signer_peer_verifying_keys` from `ROUTER_AB_PUBLIC_KEYSET_JSON` in the same
activation. Deriver migration `0019` renames a column that 0.8.0 reads. A rollback to
0.8.0 must reverse that migration and restore the matching application, wallet assets,
and backend together.

Version 0.9.0 requires wallet-object addresses, which wallets registered on 0.8.0 do
not have. It does not provide a tool to migrate those wallets. Operators with durable
wallet state must resolve that migration before replacing their deployment.

Version 0.9.3 added Gateway migration `0078`, which creates the table
`registration_passkey_claims`. Registration finalization reads that table, so apply the
migration before a Gateway of 0.9.3 or later serves. Releases 0.9.1 to 0.9.4 have no
wire or protocol change.

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