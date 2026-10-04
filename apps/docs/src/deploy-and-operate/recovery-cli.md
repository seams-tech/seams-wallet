---
title: Recovery CLI
description: Install and verify the Seams Wallet CLI, check tenant-held backup kits, and restore a tenant root into an approved empty destination.
---

# Recovery CLI

`seams-wallet` is the portable command-line tool for tenant-root backup and
recovery. It verifies signed artifacts locally and opens only the scoped browser
approvals required for hosted operations. The CLI never accepts recovery or
destination credentials through command-line arguments or environment
variables.

::: warning Native release availability
The npm launcher is published as **0.6.0**, separately from Wallet SDK 0.8.0.
As checked on October 4, 2026, its signed native release assets at
`seams-tech/seams-wallet` tag `seams-cli-v0.6.0` are unavailable. The launcher
cannot run on a fresh installation until those assets are published. An npm
installation alone does not establish a usable recovery tool.
:::

## Install and retain an offline copy

Use Node.js 22 or later to install the launcher. Once the matching signed native
release is available, verify that it executes:

```bash
npm install --global @seams/wallet-cli@0.6.0
seams-wallet --help
```

The npm launcher downloads the matching native binary and verifies its signed
release manifest before execution. Releases provide binaries for macOS on
Apple Silicon and Intel, plus Linux x86_64.

Keep a verified native binary with your recovery material when offline
recovery matters. Verify a downloaded asset before relying on it:

```bash
seams-wallet release verify \
  --manifest ./seams-release-manifest.json \
  --artifact ./seams-wallet-aarch64-apple-darwin
```

The launcher pins release-signing trust. Recovery authority belongs to the
deployment. On a device that has not connected to that deployment, run the
dashboard's trust command from the extracted recovery folder:

```bash
seams-wallet derivation-root trust connect \
  --console-url https://wallet.seams.sh
```

The command obtains the authority over verified HTTPS, verifies the manifest,
and saves it for offline use. A trust file inside a backup archive cannot
authorize itself. A supplied update must continue the trusted root. Inspect
and update that trust state with:

```bash
seams-wallet derivation-root trust show
seams-wallet derivation-root trust update \
  --bundle ./recovery-trust-bundle.json \
  --output ./trusted-recovery-roots.json
```

## Verify a backup kit

A complete recovery set contains a signed manifest, encrypted backup packages
for Deriver A and Deriver B, and the matching holder key files. Two-holder
governance gives each holder only their role's package and key.

From an extracted holder kit, verify one role:

```bash
seams-wallet derivation-root backup check --role deriver-a
```

Use `--role deriver-b` for the other holder. A single-owner kit containing both
roles can omit `--role`. Verification opens the encrypted package with the
holder key and checks the manifest and recovery authority without uploading the
key or opened share.

For signature-only verification that does not open a holder package, run:

```bash
seams-wallet derivation-root backup verify --role deriver-a
```

Offline verification reports `cryptographically_valid_offline`. Supplying a
valid signed trust snapshot can report `valid_at_trust_snapshot`; a current
online revocation check can report `current_trust_confirmed`. Signature,
certificate, role-authorization, and `invalidBefore` failures have no override.

## Enroll recovery keys

Use the role-specific setup command shown by the dashboard. It creates or
reuses a local encrypted key file, opens browser approval for that exact public
key, and proves local key control without uploading the private key:

```bash
seams-wallet derivation-root recovery-key setup \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT \
  --role deriver-a
```

The other holder runs the command with `--role deriver-b`. Confirm the scope
and comparison code in the browser before approving it. Both enrollments must
finish before the public key pair can be committed and used for a backup.

Setup defaults to `deriver-a-wrapper.key` or `deriver-b-wrapper.key`. Use
`--wrapping-key-file` to choose a different path. The CLI discovers the
dashboard URL from the console.

To save a complete recovery ZIP, use the exact recovery-set identifier shown
in the dashboard and run from the folder containing the enrolled wrapper keys:

```bash
seams-wallet derivation-root backup kit \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT \
  --recovery-set YOUR_RECOVERY_SET \
  --output ./seams-recovery.zip
```

The CLI verifies the packages and keys before writing the ZIP. An optional
password encrypts its entries with AES-256; extract it with a compatible tool
before using the restore commands. Keys and the password remain in the terminal.

Use the CLI download path when the service must record that a backup reached
disk and verified successfully:

```bash
seams-wallet derivation-root backup download \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT \
  --role deriver-a \
  --output ./deriver-a.backup \
  --manifest ./manifest.json
```

The command writes a new file, syncs it, reopens it, verifies it, and then
records durable receipt. It removes a failed output and never overwrites an
existing file.

## Restore into an empty destination

Restoration requires both role packages, both holder keys, the manifest, an
empty destination, and dashboard-approved scoped restore access. It does not
require the original deployment.

Each holder can run the bundled restore flow from their extracted folder:

```bash
seams-wallet derivation-root restore \
  --destination https://destination.example \
  --role deriver-a \
  --wrapping-key-file ./deriver-a-wrapper.key \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT
```

The other holder uses `--role deriver-b` and their own key. The CLI verifies
the artifacts, registers the manifest, opens one role package locally, reseals
that share to the destination's one-use import key, and uploads only the sealed
envelope. It never writes the opened share to disk.

Keep the generated `.restore-*` session and encrypted-envelope files until the
restore completes. Repeating the same command resumes a lost response without
reopening the holder key. The command never activates a root automatically.

After both holders finish, inspect and activate the destination:

```bash
seams-wallet derivation-root restore status \
  --destination https://destination.example \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT

seams-wallet derivation-root restore activate \
  --destination https://destination.example \
  --session-file ./destination-activation.session.json \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT
```

Activation verifies the stable root commitment, refreshes the operational
shares into the destination's custody lineage, destroys imported shares and
one-use keys, and consumes bootstrap access. Reuse the same private session
file after an interrupted activation; delete it after completion.

## Recovery boundaries

A successful restore does not alter or retire the source deployment. It also
does not make the destination unique: the same recovery set can restore another
approved empty destination. Every destination receives its own custody lineage.

Create a new recovery backup on the destination when it should provide managed
redownload. Retiring the source is a separate operator action and must produce
the required destruction, decrypt-probe, credential-revocation, and rejection
evidence for that exact source lineage.

Rehearse the complete procedure with the actual holders and a scratch empty
destination before an incident. A practice restore leaves the live deployment
unchanged.
