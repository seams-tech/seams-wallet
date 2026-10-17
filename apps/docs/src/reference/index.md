---
title: SDK reference
description: Choose the supported Seams SDK entrypoint for browser, React, threshold, advanced, or custom runtime integration.
---

# SDK reference

This reference describes **@seams/wallet 0.13.1**. The Seams package provides a small set
of public import paths. Start with the browser or React API. Use lower-level import
paths only when your integration manages the corresponding runtime or protocol.

| Import path                                    | Use it for                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`@seams/wallet`](/reference/core)                | Browser SDK configuration, registration, authentication, signing, recovery, devices, and public result types. |
| [`@seams/wallet/react`](/reference/react)         | Providers, hooks, auth and profile components, QR flows, and theme tokens.                                    |
| [`@seams/wallet/advanced`](/reference/advanced)   | Exact identity builders, RPC clients, encoders, and other low-level integration helpers.                      |
| [`@seams/wallet/threshold`](/reference/threshold) | Stable threshold session-policy and cryptographic constants.                                                  |
| [`@seams/wallet/runtime`](/reference/runtime)     | Building a custom signing runtime from explicit platform ports.                                               |
| [`@seams/wallet/external-evm`](/guides/external-evm-wallets) | Connecting browser EVM wallet extensions independently of Seams custody. |

The package also publishes focused React component subpaths and the hosted
wallet HTML asset. Those surfaces are documented on the [React
reference](/reference/react) and [hosted integration](/deploy-and-operate/hosted-integration)
pages.

## State and failure references

- [Configuration](/reference/configuration)
- [Results and recoverable errors](/reference/results-and-errors)
- [Events and progress](/reference/events-and-progress)

Public reference pages describe exported package surfaces. Internal source
modules and storage records are implementation details and can change without a
public migration path.
