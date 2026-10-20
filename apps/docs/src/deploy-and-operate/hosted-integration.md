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

## Prepare registration through the hosted menu

Use `HostedSeamsAuthMenu` for registration when setup should start before the
user selects the passkey button. The menu prepares the exact wallet, signer
selection, and passkey challenge while the registration view is open. The
passkey button consumes that preparation. Closing the menu cancels its local
preparation. An expired preparation cannot start a credential request.

<<< ../examples/hosted-auth-menu.tsx

Render `HostedRegistration` inside `SeamsWebProvider`. Supply the outcome handler
for your application. `SignInIntentButton` downloads code on intent and calls
your `onOpen` handler on click. That handler mounts your hosted auth menu.

`authMenu.prepare()` downloads sign-in code. It does not reserve a wallet or
prepare a registration challenge. The registration view starts that work.
Calling `registration.registerWallet()` directly starts setup within the call,
before the passkey prompt. There is no separate public preparation handle.

The hosted Gateway schedules optional pair preparation through `waitUntil`.
It persists the wallet's object addresses before the setup response. Pair
preparation can overlap the passkey prompt, but Yao execution still requires
the verified passkey proof. The normal execution path can recover when optional
preparation fails or expires.

Earlier setup reduces the wait after the user's passkey selection only when
the menu stays open long enough. It does not reduce total server work.

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

## Upgrading to 0.15.4

Pin `@seams/wallet` and `@seams/wallet-server` to **0.15.4**. Use `@seams/wallet-cli` **0.15.0**.

Publication status was checked October 20, 2026. See [release notes](/releases)
for individual patches and prepared changes. The instructions below describe
the published baseline.

From a release before 0.15.4: APAC wallet objects now request Southeast Asia
placement. Verify the actual object and database locations before accepting a
hosted deployment.

The auth menu retains the 0.15.2 passkey ring spinner. Account-menu row arrows
and hover states prepared as 0.15.3 first published on npm in 0.15.4.
Deploy the matching custody Workers
and update the private Console relocation caller for the new APAC hint.

An expired initial tenant authorization can be renewed only before its creation journal starts.
The Router records a durable fence before Console issues the replacement authorization.
The fence blocks delayed requests under the expired authorization.
Started ceremonies retain their exact original authorization for recovery.
Deploy the matching wallet host, Gateway, Wallet Runtime, Router, control plane,
both Derivers, and Signing Worker.
The private address-allocation response now carries a batch, so the custody
Workers must move together. The public wallet iframe protocol is **16.0.0**. A 0.13 client and a
0.14-or-later wallet host report a protocol mismatch. Upgrade both together.

Registration reuses committed admission, commits custody with its completion
receipt, and can finish after A's validated completion without waiting for B's
preparation reply. Hosted activation also schedules obsolete ceremony cleanup
after its response. These changes preserve proof, custody, and replay checks.

The SDK removes the `relink_required` result variants that no operation produces.
Remove those branches from TypeScript consumers. The unexported Vite/Next hosting
plugins and unused account-menu modal implementation are also removed.

## Registration completion

Apply Gateway D1 migration `0081_registration_directory_publications.sql` before the
new Gateway serves. It adds the table that holds registration completions that the
directory has not acknowledged.

A registration response no longer waits for the directory write of its completion.
The Gateway activates the wallet and records the completion as pending in one local
transaction, then sends the completion after the response. Signing works at once.
If that write fails, the Gateway's scheduled handler resends the same session digest
and expiry until the directory acknowledges it. A Gateway that you assemble with your
own registration authority must call `resumeRegistrationDirectoryPublicationsV1` from
`@seams/wallet-server/cloud-host` in its scheduled handler, for example once a minute.
The bundled local Gateway Worker does this.

Until the directory acknowledges a completion, normally within a second, the wallet
is absent from the Console wallet list and the wallet cannot move to another region.
A backend that reads the wallet list right after a registration can miss the new
wallet for that time.

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
