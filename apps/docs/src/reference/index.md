---
title: SDK reference
description: Choose the supported Seams SDK entrypoint for browser, React, threshold, advanced, or custom runtime integration.
---

# SDK reference

This reference describes **@seams/mpc-wallet 0.77.0** and the packages that ship with it.
Each import path says where its code runs: no package has a root import. Start with the
browser or React API. Use the lower-level exports only when your integration manages the
corresponding runtime or protocol.

| Import path | Use it for |
| --- | --- |
| [`@seams/mpc-wallet/client`](/reference/core) | Browser SDK configuration, registration, authentication, signing, recovery, devices, and public result types. |
| [`@seams/mpc-wallet/client`](/reference/advanced) | Also exact identity builders, RPC clients, encoders, and other low-level integration helpers. |
| [`@seams/mpc-wallet/client`](/reference/threshold) | Also stable threshold session-policy and cryptographic constants. |
| [`@seams/mpc-wallet/client`](/reference/runtime) | Also a custom signing runtime from explicit platform ports. |
| [`@seams/mpc-wallet/react`](/reference/react) | Providers, hooks, auth and profile components, QR flows, VoiceID visuals, and theme tokens. |
| `@seams/mpc-wallet/styles.css` | The stylesheet of the React components. |
| [`@seams/mpc-wallet/voiceid`](/concepts/auth-methods/voiceid) | The VoiceID descriptor `voiceIdAuthMethod()` and the VoiceID host contract. |
| [`@seams/mpc-wallet/server`](/guides/application-auth) | `createApplicationAuthAssertion` for your application backend. |
| [`@seams/wallet-connect/client` and `/react`](/reference/wallet-connect) | Connecting existing EVM and NEAR browser wallets, with no Seams account or custody. |
| [`@seams/host`](/reference/server) | Server services, Workers, migrations, local runtime entry points, the wallet origin document, and the VoiceID host plugin. |
| [`@seams/cli`](/deploy-and-operate/recovery-cli) | Signed native backup verification and tenant-root recovery tooling. |

The browser and server SDKs use **0.77.0**. The recovery CLI uses **0.29.0**.
See [Release 0.77.0](/releases) for integration and deployment requirements.

## Prepared NEAR connector

Version **0.77.0** includes these entry points. The connector remains a development preview.
See [external NEAR wallets](/guides/external-near-wallets) for availability, examples, and result branches.

| Import path                         | Exports                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@seams/wallet-connect/client` | `ExternalNearController`, `ExternalNearConfig`, `nearWalletName`, and external NEAR state/result types. |
| `@seams/wallet-connect/react` | `ExternalNearWalletPicker` and `useExternalNear`. |

## State and failure references

- [Configuration](/reference/configuration)
- [Results and recoverable errors](/reference/results-and-errors)
- [Events and progress](/reference/events-and-progress)

Public reference pages describe exported package surfaces. Internal source
modules and storage records are implementation details and can change without a
public migration path.
