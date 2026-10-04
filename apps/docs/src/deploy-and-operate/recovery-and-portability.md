---
title: Recovery and portability
description: Distinguish released Wallet SDKs, managed tenant-root backups, recovery CLI availability, and planned wallet portability.
---

# Recovery and portability

A backup protects a specific set of material. Recovering one tenant derivation
root does not by itself restore every wallet, signing lane, or application
setting that used it.

## Availability

Status checked October 4, 2026:

| Capability | Status | Scope |
| --- | --- | --- |
| Wallet browser and server SDKs | Published as 0.8.0 | Wallet lifecycle, signing, fixed per-wallet regional routing, and ownership contracts |
| Managed tenant-root backup and refresh | Implemented in Wallet Server | Role-private D1 shares and separate R2 backups; verify custody and refresh policy in the deployed environment |
| Tenant-controlled root recovery | CLI launcher published as 0.6.0; native assets unavailable at the public release URL | Dashboard approval, holder-key custody, and an approved empty destination are also required |
| Wallet/deployment portability | Planned | Wallet inventory, signing-participant handoff, destination provisioning, and explicit cutover |
| Owner-selected or automatic wallet-region relocation | Planned | 0.8.0 retains a fixed home across devices and travel |

Wallet SDK publication does not establish recovery-tool availability or enable
every administrative flow in every environment. See the
[recovery CLI](/deploy-and-operate/recovery-cli) for current installation status
and commands. Rehearse the dashboard approval, backup verification, empty-destination
restore, activation, and cleanup against the environment you operate.

## Managed tenant-root recovery

R120's service-held backups use separate A/B R2 buckets and Google KMS keys.
An authorized one-role restore verifies the recovered share and requires a
forward refresh. It depends on retained backup objects, usable wrapping keys,
and authoritative tenant identity and activation records. It does not promise
recovery from total database loss using two ciphertext objects alone.

See [tenant-root backups](/deploy-and-operate/tenant-root-backups) for ownership,
cost, and key-destruction limitations.

## Tenant-controlled root recovery

The **Derivation root security** dashboard implements manual operational-share
rotation with fresh administrative step-up, durable progress, and R120's
one-successful-refresh-per-hour policy. Check the deployed policy and scheduler
before relying on either.

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

Browser download issuance is distinguished from a CLI-verified durable
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
