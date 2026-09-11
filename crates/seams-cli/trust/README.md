# Pinned trust for the `seams` binary

The two JSON files are compiled into `seams`. They contain public keys only;
verification works offline. The private signing keys are held in distinct GitHub
environments in `seams-tech/seams-monorepo`.

| Public pin | Private-key environment | Signing secret |
| --- | --- | --- |
| `recovery-trust-bundle.json` | `recovery-signing` | `SEAMS_RECOVERY_SIGNING_KEY` |
| `release-root.json` | `release-signing` | `SEAMS_RELEASE_SIGNING_KEY` |

Each environment also holds its corresponding `SEAMS_*_SIGNER_KEY_ID` secret.
Both environments allow the `main` branch only. The keys are distinct randomly
generated Ed25519 seeds; each pin names its production key with the
`-production-2026-09` suffix. Fixture roots remain in test fixtures and are not
trusted by the production binary.

These are CI-held signing authorities. Workflow code with access to an
environment can use that environment's key. Normal application deployments,
Derivers and the tenant-root control-plane Worker receive public certificates
and trust material; these root private keys are never bound to Workers.

## Recovery trust signing

`Sign recovery trust` (`.github/workflows/sign-recovery-trust.yml`) is manually
invoked on `main`. It builds `seams-recovery-authority` before exposing the
recovery key, signs a typed request, verifies the resulting signature against
the compiled production pin, and uploads the public artifact. It has no release
key and does not deploy or publish the artifact automatically.

Certificate request (replace the public key and validity window):

```json
{"kind":"certificate","subject_key_id":"deriver-a-recovery-1","verifying_key":"<base64url Ed25519 public key>","role":"deriver_a","not_before":"2026-09-08T00:00:00.000Z","not_after":"2027-09-08T00:00:00.000Z"}
```

Roles are `deriver_a`, `deriver_b` and `control_plane`.

Revocation snapshot request:

```json
{"kind":"revocation_snapshot","version":1,"issued_at":"2026-09-08T00:00:00.000Z","entries":[]}
```

Each subsequent snapshot must retain the complete revocation history and use a
higher version. Entry shapes are `{"kind":"retired","subject_key_id":"..."}`
and `{"kind":"compromised","subject_key_id":"...","invalid_before":"..."}`.
The signing workflow does not maintain this history for the operator. Install
the verified artifact explicitly as the destination control plane's
`TENANT_ROOT_RECOVERY_TRUST_SNAPSHOT_JSON`, or supply it to offline verification.

## Release signing

`Release seams CLI` uses only `release-signing`. It builds Unix binaries without
private keys, signs their checksum manifest and SBOM, verifies those artifacts
with the release binary, and publishes the verified set. Its signing tool is a
separate program from the shipped `seams` binary.

## Trust updates

A runtime `--trust-bundle` must continue the compiled recovery pin through valid
rotation bridges. An unrelated root is refused. `seams-wallet derivation-root trust
update` installs such a continuation bundle durably. Recovery commands never
fetch or install new roots implicitly. Root rotation remains an explicit
operation requiring the appropriate signing authorities.
