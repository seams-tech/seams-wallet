# R150: recovery-package retention on the VM

Status: decided in review, 2026-09-27: **option 1**, local retention with an
honest erasure claim. **Implemented 2026-09-27** on branch
`codex/r150-do-backend` (see [Implementation](#implementation)). Not deployed.

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

## Implementation

- **One Deriver code path.** The five reshare phases, Download and Destroy
  are shared code (`tenant_root_recovery_reshare.rs`), used by the Workers
  routes and the VM routes alike.
- **The retention key behind a seam.** A host supplies the key for one
  recovery set and role.
  - Cloudflare keeps it in Google Cloud KMS, unchanged.
  - The VM keeps it in its role store, sealed to the role's own key: table
    `tenant_root_recovery_retention_keys`, migration 0018. The table stays
    empty on Cloudflare.
  - What the key seals is shared: the attempt's replay seed and active share,
    bound to the command's digest, and the package, bound to the set and
    role.
- **The control plane's part is shared too:** the generation commands, the
  access grants for Download and Destroy, the recipient-key proof and the
  manifest.
  - Source retirement stays Cloudflare-only: it moves authority, which R150
    excludes.
  - The signed descriptor and manifest times are formatted by the core,
    identically to JavaScript's `toISOString`, in place of the Workers-only
    `Date`.
- **Destroy on the VM** deletes the retained package and the key's row. It
  reports `cryptographic_erasure_unverified` in its receipt, and the VM never
  claims `managed_healing_v1`.
- **Download on the VM** answers with the package's bytes and the headers
  Cloudflare sends.
- **Evidence:** VM
  `vm_tenant_root_generates_a_recovery_kit_that_restores_into_an_empty_vm`
  (`R150_VM_TENANT_ROOT_RECOVERY_KIT_GENERATION_E2E`).
  - The test stands in for the Console. It certifies the source's role and
    control-plane keys under its own recovery root.
  - The source runs all five phases at both Derivers, and Package replays
    exactly.
  - Both packages download, and the control plane signs the manifest.
  - The kit restores into an empty VM, which activates and signs before and
    after a refresh.
  - Destroy then removes both roles' keys and packages and reports the
    erasure unverified. A later download is refused.
- **Not run:** Cloudflare's recovery-package generation still has no E2E; it
  needs a Google Cloud KMS key ring. Its code now shares the phases the VM
  E2E proves.
