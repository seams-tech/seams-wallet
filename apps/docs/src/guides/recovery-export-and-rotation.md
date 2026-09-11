---
title: Recovery, export, and rotation
description: Design fresh-auth recovery, wallet export, signer rotation, and key-version changes as separate high-impact operations.
---

# Recovery, export, and rotation

Start with [Advanced wallet operations](/examples/advanced-wallet-operations) to
see recovery and export. Recovery restores authorized access. Export reveals
key material. Rotation changes a signer, custody share, or wallet key version.
Keep these operations separate in UI, policy, audit, and result handling.

This guide concerns wallet-user operations. Tenant administrators manage a
separate derivation-root lifecycle: refreshing A/B operational shares preserves
the effective tenant root and wallet identities. R120 implements that server
path. The administrative dashboard and native restore path have local operating
evidence; hosted verification, recovery-custody provisioning, and release signing
remain delivery gates. See [recovery and portability](/deploy-and-operate/recovery-and-portability)
for their availability and the later R122 migration boundary.

## Safety checklist

1. Require fresh operation-specific authentication.
2. Display the exact wallet and consequence.
3. Apply policy, cooldown, notification, and step-up requirements.
4. Complete the recovery, export, or rotation ceremony.
5. Verify resulting identity and public-key invariants.
6. Record the outcome. Handle revocation as an explicit action when required.

Code recovery adds a new method while preserving existing methods, linked
devices, and Wallet Sessions. It does not revoke compromised access automatically.

Keep export viewers on the wallet origin and minimize key exposure. Rotation
that preserves the wallet address needs explicit parity checks; rekeying can
intentionally create a new address.

Continue with [recovery and export](/concepts/custody/recovery-and-export) and
[key rotation](/concepts/delegation/key-rotation).
