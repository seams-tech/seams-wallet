---
title: Custom signing runtime
description: Ports and factories exported from @seams/mpc-wallet/client for applications that own a complete signing runtime.
---

# Custom signing runtime

`@seams/mpc-wallet/client` also has the runtime for hosts that supply the platform around the
signing engine. It is a lower-level integration than `SeamsWeb`. A bundler keeps only the runtime
modules that you import, and the package build checks that they load no browser code.

The entrypoint exports `createSigningRuntime`,
`createSigningRuntimeStatePorts`, and types for the runtime configuration,
services, state ports, UI dependencies, and warm-session UI ports.

The runtime receives platform services through ports: interfaces your host implements.
These cover:

- authentication.
- time and randomness.
- HTTP transport.
- durable records and secure secrets.
- signer cryptography.
- runtime-specific UI.

Choose one `RuntimePortsKind` and provide the complete matching `RuntimePorts` branch.
Validate raw host data before constructing those ports. A custom runtime also manages
secure storage, cancellation, lifecycle restoration, and checks for user presence. Use
the browser SDK unless you intend to manage these responsibilities.

Read [architecture](/concepts/architecture) and [origin and iframe
boundaries](/deploy-and-operate/security-boundaries) first.
