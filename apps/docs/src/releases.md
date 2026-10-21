---
title: Releases and compatibility
description: Published SDK versions, release changes from 0.13, protocol compatibility, and prepared changes.
---

# Releases and compatibility

Publication status checked October 20, 2026:

| Component | Published version | Compatibility |
| --- | --- | --- |
| Browser SDK `@seams/wallet` | **0.15.4** | Match application code and wallet-origin assets |
| Server SDK `@seams/wallet-server` | **0.15.4** | Deploy the coordinated backend roles described below |
| Native CLI launcher `@seams/wallet-cli` | **0.15.0** | Use its signed native assets and the dashboard's commands |
| Wallet iframe protocol | **16.0.0** | Introduced in SDK 0.14.0 |

Package publication, hosted deployment, and source availability are separate
states. Check the release identity of the service you use. A development
checkout can contain prepared changes that npm does not yet publish.

## Current integration

Install the published browser SDK through [Start here](/). Follow
[hosted integration](/deploy-and-operate/hosted-integration) before upgrading
the wallet host or backend. A 0.13 client and a 0.14-or-later wallet host report
a protocol mismatch. Deploy application code and wallet assets together.

The CLI has a separate patch cadence. SDK 0.15.4 does not require a CLI 0.15.4.

## 0.15.4

APAC registration and relocation request Southeast Asia placement through
`apac-se`. Existing object addresses remain unchanged. Placement hints do not
guarantee a city. Operators must verify object hosts and database primaries.

Account-menu rows gain animated arrows and hover shading. These changes were
prepared under 0.15.3 and first published on npm in 0.15.4. Neither SDK package
has an npm 0.15.3 release. Two experimental registration changes were reverted
before publication and are excluded from the released behavior.

## 0.15.2

The passkey waiting screen uses a ring spinner in place of the fingerprint
illustration. It retains the device-prompt instruction.

## 0.15.1

An expired initial tenant authorization can be renewed only before its creation
journal starts. The Router persists a fence before Console issues a replacement.
The fence refuses delayed requests under the expired authorization. Started
ceremonies retain their original authorization for recovery.

Wallet Runtime relays renewal through Wallet control. Deploy the matching
Gateway, Wallet Runtime, Router, control plane, both Derivers, and Signing Worker.
Account-menu hover states also become more visible.

## 0.15.0

Registration performs less serial work:

- Reuses the committed admission while retaining credential, expiry, and binding checks.
- Commits custody and the terminal completion receipt in one transaction.
- Allocates eight unused object-address sets per batch within one binding environment.
- Finishes after A's validated completed result without waiting for B's redundant preparation reply.
- Schedules completed ECDSA and mixed ceremony cleanup after the hosted response.

The private address-allocation response changes. Deploy Router, both Derivers,
and Signing Worker together. The public iframe protocol remains 16.0.0.
New admission timing spans separate state reads, authorization, root waits,
backend work, and commit waits.

`KeyExportOutcome` now contains only `{ kind: 'exported' }`. Missing export
material or an unavailable exact lane rejects the operation. Remove
`relink_required` branches from TypeScript consumers. Device-link activation
also removes its unused variant. Unexported Vite/Next hosting plugins, an unused
owner-lane resolver, and unused account-menu modal code are removed.

Use the existing hosted registration menu to prepare setup before the user
selects passkey. There is no separate public registration-preparation handle.

## 0.14.0

When the wallet origin stores no wallet, boot code answers connection reads
without loading the full runtime or creating its database. Operations load
the runtime when needed. `authMenu.prepare()` downloads sign-in code on pointer,
focus, or touch intent. It does not prepare a registration challenge.

On the release test app, the signed-out mount fell from 105 files and 659 KB
to 39 files and 77 KB with Brotli compression. This is an asset measurement
for that app, rather than a download guarantee for every integration.

The iframe protocol changes to 16.0.0. No database migration is required for
this release. Update application code and wallet-origin assets together.

## 0.13.1

The default Arc testnet RPC endpoint changes to `https://rpc.testnet.arc.io`.
Applications with an explicit old `rpcUrl` must update their configuration.
This patch requires no migration or backend behavior change.

## 0.13.0

Registration activates the wallet and queues directory completion in one
Gateway transaction. The response no longer waits for Console's completion
write. Signing works immediately. Console listing and region moves wait for
directory acknowledgment. Scheduled retries resume pending publications.

Apply Gateway migration `0081_registration_directory_publications.sql` and
configure the scheduled handler described in
[the upgrade instructions](/deploy-and-operate/hosted-integration#registration-completion).

Recovery codes gain a printed-slip view and visible input selection. The
device-match choice gains theme colours for dark cards.

The recorded staging finalization p95 fell from 1,381 ms to 858 ms across
66 measured registrations. The populations ran at different times. This
comparison does not establish an overall registration latency guarantee.
See the [dated evidence](https://github.com/seams-tech/seams-wallet/blob/main/docs/evidence/release-0130-staging-20261017.md).

## Prepared changes

The development checkout contains version 0.16.0. Publication and deployment
are pending.

This release changes the React API. `useSeams()` now supplies authentication
actions and the current bound `wallet`. The `useWallet()` hook and
`UseWalletResult` type are removed. Replace the two hook calls with:

```tsx
const { unlock, lock, wallet } = useSeams();
```

The wallet is `null` while signed out. Its NEAR signer remains `null` until a
NEAR account is ready. Check `wallet?.near` before signing. Use the wallet
from the authenticated render after unlock completes.

Registration now defaults to a server-assigned wallet ID. Omit `wallet` in
`registerWallet` for that flow. Explicit wallet selection remains available.

The release also gives the Google sign-in waiting screen
the same ring, headline, and instruction layout as the passkey waiting screen.
It also loads the NEAR signing and export WASM modules before finalization,
with shared initialization for concurrent callers. It retains compatibility
with 0.15.4 custody Workers.
Use the published baseline until publication and deployment are verified.
