---
title: Recovery and portability
description: Distinguish managed tenant-root backups, tenant-controlled recovery delivery status, and planned wallet deployment portability.
---

# Recovery and portability

A backup protects a specific set of material. Recovering one tenant derivation
root does not by itself restore every wallet, signing lane, or application
setting that used it.

## Availability

Status recorded September 8, 2026:

| Capability | Status | Scope |
| --- | --- | --- |
| R120 managed tenant-root backup and refresh | Implemented; KMS-backed production creation demonstrated | Role-private D1 shares and separate R2 backups; full public release proof and throttle deployment remain pending |
| R121 tenant-root security dashboard and tenant-controlled recovery | Locally demonstrated; public delivery pending | Rotation, scheduling, and empty-destination restore have local operating evidence; recovery custody awaits real retention provisioning and a complete backup demonstration |
| R122 wallet/deployment portability | Planned after R121 | Wallet inventory, signing-participant handoff, destination provisioning, and explicit migration/cutover |

Local R121 evidence includes restore activation and cleanup, plus Ed25519
signing before, during, and after rotation on the restored destination. Hosted
production-session and physical-passkey verification, production trust, and
release signing remain delivery gates. The initial CLI release targets macOS
and Linux. Public operating instructions will accompany released tooling.

## Managed tenant-root recovery

R120's service-held backups use separate A/B R2 buckets and Google KMS keys.
An authorized one-role restore verifies the recovered share and requires a
forward refresh. It depends on retained backup objects, usable wrapping keys,
and authoritative tenant identity and activation records. It does not promise
recovery from total database loss using two ciphertext objects alone.

See [tenant-root backups](/deploy-and-operate/tenant-root-backups) for ownership,
cost, and key-destruction limitations.

## Tenant-controlled root recovery — delivery in progress

The **Derivation root security** dashboard implements manual operational-share
rotation with fresh administrative step-up, durable progress, and R120's
one-successful-refresh-per-hour policy. Rotation and the fixed scheduler work
locally; hosted rollout verification remains pending.

The recovery checkpoint adds tenant-controlled recipient keys and a dedicated
recovery sharing, independent of current operational epochs. It produces
separate encrypted A/B packages and a signed public manifest. Routine
operational refresh therefore does not require another tenant download.

Recovery private keys stay outside the hosted dashboard and Console. The native
CLI handles one role per invocation, opening that package locally and resealing
it to the destination role's one-use import key. Restore requires an empty,
already provisioned destination, preserves the exact logical tenant-root
identity, assigns a fresh custody lineage, and forward-refreshes before
activation.

Browser download issuance will be distinguished from a CLI-verified durable
file write. Tenant-held recovery copies cannot be revoked by deleting the
service's copies. Individually destructible recovery-set retention keys are a
separate requirement from the current shared A/B managed-backup KMS versions.

## Wallet/deployment portability — planned

R122 extends the same native CLI with deployment operations. It owns the
customer deployment compiler, wallet inventory package, curve-specific signing
participant handoff, domain/RP-ID handling, and fenced activation and cutover.

Its current design preserves existing wallet public keys and addresses through
per-wallet handoff while creating fresh destination derivation roots for new
registrations. A tenant-root recovery package alone is insufficient for that
migration. Owner-side participation and wallet authority remain separate from
tenant administration.

The portability package excludes source deployment credentials, raw databases,
and tenant derivation-root shares. R121's A/B recovery packages remain separate
artifacts with exact identity binding. R122's destination identity mapping must
not become a root-recovery rebinding option.

Running the code in customer infrastructure and migrating existing managed
wallets are distinct operating paths. Development deployments do not establish
the isolation, import, continuity, or cutover guarantees of the planned
production portability product.

## Wallet-user recovery

Wallet session restoration, recovery-factor use, and authorized wallet-key
export are separate user-facing flows. See
[recovery and export](/concepts/custody/recovery-and-export) for those paths.
