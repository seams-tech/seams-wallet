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

```tsx
import { HostedSeamsAuthMenu } from '@seams/wallet/react';
import type { HostedAuthMenuOutcome } from '@seams/wallet/react';

function onRegistrationOutcome(outcome: HostedAuthMenuOutcome): void {
  console.info(outcome.kind);
}

// Mount inside the application's SeamsWebProvider when registration opens.
<HostedSeamsAuthMenu initialMode="register" onOutcome={onRegistrationOutcome} />;
```

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

## Upgrading to 0.15.1

Pin `@seams/wallet` and `@seams/wallet-server` to **0.15.1**. Use `@seams/wallet-cli` **0.15.0**.

An expired initial tenant authorization can be renewed only before its creation journal starts.
The Router records a durable fence before Console issues the replacement authorization.
The fence blocks delayed requests under the expired authorization.
Started ceremonies retain their exact original authorization for recovery.
Deploy the matching wallet host, Gateway, Router, both Derivers, and Signing Worker.
The private address-allocation response now carries a batch, so the custody
Workers must move together. The public wallet iframe protocol remains **16.0.0**.

Registration reuses committed admission, commits custody with its completion
receipt, and can finish after A's validated completion without waiting for B's
preparation reply. Hosted activation also schedules obsolete ceremony cleanup
after its response. These changes preserve proof, custody, and replay checks.

The SDK removes the `relink_required` result variants that no operation produces.
Remove those branches from TypeScript consumers. The unexported Vite/Next hosting
plugins and unused account-menu modal implementation are also removed.

## Upgrading to 0.14.0

Pin the application package and backend package to **0.14.0**, and build the
wallet-origin assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.14.0

# Backend deployment
pnpm add @seams/wallet-server@0.14.0
```

The wallet iframe protocol moves to **16.0.0**. Deploy the application and the
wallet-origin assets together: a 0.13 application connected to a 0.14 wallet origin,
or the reverse, reports a protocol version mismatch.

A signed-out page now downloads much less from the wallet origin. While the wallet
origin stores no wallet, the wallet host answers the connection reads from its boot
code and does not load the wallet runtime or create its database. The runtime loads
with the first sign-in, registration or other operation. On the release test app the
signed-out mount fell from 105 files and 659 KB to 39 files and 77 KB (brotli).

Because the runtime now loads at sign-in, call `authMenu.prepare()` on sign-in intent,
such as pointer, focus or touch on a control that opens `HostedSeamsAuthMenu`:

```tsx
const { seams } = useSeams();
<button onPointerEnter={seams.authMenu.prepare} onFocus={seams.authMenu.prepare}>
  Sign in
</button>;
```

It starts the download in the background and never throws. A page that mounts
`HostedSeamsAuthMenu` at load needs no call. Release 0.14.0 has no migration and no
backend change.

## Upgrading to 0.13.1

Pin the application package and backend package to **0.13.1**, and build the
wallet-origin assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.13.1

# Backend deployment
pnpm add @seams/wallet-server@0.13.1
```

The default RPC URL of `arc-testnet` is now `https://rpc.testnet.arc.io`, Circle's
primary Arc testnet endpoint. The earlier default, `https://rpc.testnet.arc.network`,
no longer resolves. An application that sets its own `rpcUrl` for `arc-testnet` is not
affected; if it names a host under `testnet.arc.network`, move it to a host from the
[Arc RPC reference](https://docs.arc.io/arc/references/rpc-endpoints). A chain `rpcUrl` can
list more than one URL, separated by commas; the SDK tries the next URL after a network
error or an HTTP 429 or 5xx response. Release 0.13.1 has no migration and no backend
change.

## Upgrading to 0.13.0

Pin the application package and backend package to **0.13.0**, and build the
wallet-origin runtime, workers, WASM, and support assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.13.0

# Backend deployment
pnpm add @seams/wallet-server@0.13.0
```

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

The hosted wallet menu shows the recovery code as a printed slip and shows which part
of the code input is selected. The device-match choice uses theme colours on dark
cards.

## Upgrading to 0.12.0

Pin the application package and backend package to **0.12.0**, and build the
wallet-origin runtime, workers, WASM, and support assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.12.0

# Backend deployment
pnpm add @seams/wallet-server@0.12.0
```

Release 0.12.0 removes server exports that no Workers host uses:

- `createSelfHostedCloudflareSigningRouter`, `createSelfHostedCloudflareSigningWorker`,
  and the type `SelfHostedCloudflareSigningWorkerFactoryInput` from
  `@seams/wallet-server/router/cloudflare`. Both hosts use the same Worker entrypoints.
- The Node Redis TCP session-seal adapters
  (`createRedisTcpSigningSessionSealRateLimiter`,
  `createRedisTcpSigningSessionSealIdempotencyStore`) and the environment-based
  selectors (`resolveSigningSessionSealRateLimitFromEnv`,
  `resolveSigningSessionSealIdempotencyFromEnv`) from `@seams/wallet-server`. Use the
  Upstash, D1, in-memory, or HTTP-based providers.

The hosted wallet menu now takes the recovery code in its own step. After the code
passes a format check, the owner chooses the sign-in method that recovery adds: a new
Passkey, or Google with Email OTP. The code input accepts a pasted code with dashes in
any letter case, and reads O as 0 and I or L as 1.

The Router calls the Derivers and the Signing Worker from its stateless Worker again.
In 0.11.0 the Router's per-wallet object made these calls, and each call from such a
fresh object started a new isolate of the callee; on the staging lane the Router then
waited about 150 to 180 ms longer before it called the Derivers. The claim and the
finish of a registration stay in the Router's wallet object, and no role receives
protocol material before the claim is durable. A registration that is running while
the Router deploys can fail once; its retry runs on the new Router.

The wallet-management protocol stays `4`, and the registration and recovery requests
do not change: a 0.11 application works with a 0.12.0 backend. Of the role Workers,
only the Router changes, and the release adds no D1 migration.

## Upgrading to 0.11.0

Pin the application package and backend package to **0.11.0**, and build the
wallet-origin runtime, workers, WASM, and support assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.11.0

# Backend deployment
pnpm add @seams/wallet-server@0.11.0
```

Release 0.11.0 runs the Wallet backend on Cloudflare Workers only. It removes the
Node Wallet Gateway and the Express entry `@seams/wallet-server/router/express`. A
backend that imports that entry must move to the Workers host
(`@seams/wallet-server/router/cloudflare`) before it upgrades.

The wallet-management protocol stays `4`, and the registration contract does not
change: a 0.10 application works with a 0.11.0 backend. The Router and Deriver B
changed how they coordinate a registration, so deploy the Gateway, wallet runtime,
Router, both Derivers, and the Signing Worker from the same release. The release adds
no D1 migration.

When the registration response or finalization has not answered after five seconds,
the SDK sends one `onEvent` event for that step, with the message "Taking longer than
usual... waiting on the network…", and the hosted menu shows that message. Keep the
attempt open; it continues.

## Upgrading to 0.10.0

Pin the application package and backend package to **0.10.2**, the current patch
release of 0.10, and build the
wallet-origin runtime, workers, WASM, and support assets from the same release:

```sh
# Application
pnpm add @seams/wallet@0.10.2

# Backend deployment
pnpm add @seams/wallet-server@0.10.2
```

This release changes the registration contract. The wallet-management protocol is `4`.
The iframe protocol stays `15.0.0`. An already-open 0.9 client receives an HTTP 409
upgrade-required response from a 0.10 backend. Show the reload or upgrade message.
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
root-use admissions. A registration that started on 0.9 does not continue on 0.10:
start it again.

Release 0.10.1 has no wire, schema or protocol change: a 0.10.0 application works with
a 0.10.1 backend. On 0.10.0, registration setup answered HTTP 500 for a provided wallet
id that is not in the server-allocated format. Release 0.10.1 accepts that setup again
and leaves the refusal to the proof step, as 0.9.4 did.

Release 0.10.2 has no wire, schema or protocol change: a 0.10.0 or 0.10.1 application
works with a 0.10.2 backend. The registration response step now retries a transient D1
fault. If the fault continues, the step answers HTTP 503 with the code
`storage_unavailable`. Show the message and let the user try again.

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
