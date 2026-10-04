---
title: Passkeys
description: Understand WebAuthn user presence, PRF-derived material, RP ID scope, and passkey recovery boundaries.
---

# Passkeys

Passkeys use WebAuthn to verify user presence. Where available, a pseudorandom function
(PRF) derives holder-side material.

## Role in the model

Passkeys can:

1. prove local user presence.
2. derive or unlock holder-side material.
3. step up expired or exhausted Wallet Session quotas.
4. authorize sensitive operations when policy requires a cryptographic factor.

Passkeys do not make app sessions into signing authority. The SDK converts passkey
results into the same lane, Wallet Session quota, capability-grant, and policy model
used by other authentication methods.

## Register with a passkey

The React integration keeps registration results typed by capability and
provisioning state.

::: details Runnable React example

<<< ../../examples/registration.tsx

:::
