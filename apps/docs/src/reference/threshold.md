---
title: Threshold APIs
description: Stable threshold session-policy helpers, PRF salts, and intent digest exports from @seams/mpc-wallet/client.
---

# Threshold APIs

`@seams/mpc-wallet/client` also has the stable protocol-facing exports for applications
that must reproduce threshold session-policy inputs or registration digests.

It exports:

- `THRESHOLD_SESSION_POLICY_VERSION`.
- `buildEd25519SessionPolicy`.
- `computeEd25519SessionPolicyDigest32`.
- the `Ed25519SessionPolicy` type.
- `PRF_FIRST_SALT_V1` and `PRF_SECOND_SALT_V1`.
- `computeThresholdEcdsaKeygenIntentDigest`.

Keep policy construction at a trusted boundary. The digest binds authorization to the
precise policy. Changing an input creates a different authorization object. Most browser
integrations should let `SeamsWeb` own this work.

Read [threshold signing](/concepts/threshold-signing/) before integrating this
entrypoint directly.
