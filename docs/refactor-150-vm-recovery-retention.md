# R150: recovery-package retention on the VM

Status: decided in review, 2026-09-27: **option 1**, local retention with an
honest erasure claim. Not yet implemented; it follows the settlement and
cancellation work.

Restore into an empty destination does not depend on it. It is served on the
VM and proven from a recovery kit
(`vm_tenant_root_recovery_kit_restores_into_an_empty_deployment_and_signs`).

## The question

Generating a recovery package needs a retention key at each Deriver. On
Cloudflare that key is a Google Cloud KMS key version, one per recovery set
and role. R150 keeps Google KMS out of the VM: HPKE is the portable path
([lifecycle scope](./refactor-150-lifecycle-scope.md)). What does the VM
Deriver use instead?

## What the retention key does

- **Across the five reshare phases,** it seals the attempt's replay seed and
  the active share it read. Each phase is a separate request, and it reopens
  them from the role store.
- **For the stored copy,** it wraps the package the Deriver keeps for
  Download. The package inside is already sealed to the tenant's recipient
  key, and only the tenant can open it.
- **For Destroy,** destroying the key version makes that set's stored
  material unopenable, without relying on storage forgetting the bytes.
- **The evidence rule.** The core module
  (`router-ab-core/src/derivation/tenant_root_retention_key.rs`) is explicit.
  Only a destructible provider's own evidence may satisfy
  `managed_healing_v1`. A local deletion "would be evidence of nothing".

## Options

1. **Local retention with an honest erasure claim (recommended).**
   - **The key:** the VM Deriver provisions the same per-set
     `TenantRootRetentionKeySecretV1`. It keeps the key in its role-private
     SQLite, sealed to its own HPKE key.
   - **Unchanged from Cloudflare:** Generate, Download, the grants, the five
     phases and the package bytes.
   - **Destroy:** deletes the key and the retained rows, and reports
     `CryptographicErasureUnverified`. That existing claim says service paths
     were removed but erasure was not verified. The VM never claims
     `managed_healing_v1`.
2. **No retained copy on the VM.**
   - The Package phase hands the sealed package back, and there is nothing to
     download or destroy.
   - The attempt material is sealed under the Deriver's existing HPKE key and
     deleted after packaging.
   - This breaks parity with the Cloudflare commands (Download, Destroy).
3. **Backup stays Cloudflare-only.** The VM serves restore into a new
   deployment only, from a kit produced elsewhere. The review asked for
   backup on the VM too, so this would narrow that request.

## Consequences of option 1

- **Crypto-erasure of a retained set.** A VM operator who needs it must
  destroy the disk or database that held it. The VM setup guide says so.
- **Snapshots and backups may keep the material.**
  - A snapshot or backup of the Deriver's disk or database copies the
    retained rows and the sealed retention key.
  - Destroy removes neither copy, which is one more reason the claim stays
    `CryptographicErasureUnverified`.
  - The setup guide says this too.
- **The claim never overstates.** Receipts and status report
  `CryptographicErasureUnverified` for VM destroys, and tests assert it.
- **One E2E proves the scenario.** A VM source generates the kit, and a fresh
  VM destination restores it, activates it and signs.
