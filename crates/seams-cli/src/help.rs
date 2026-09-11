//! Task overview and command-specific terminal help.

/// Default help for the wallet CLI.
pub const SEAMS_USAGE_V1: &str = "\
Seams Wallet CLI

Usage
  seams-wallet derivation-root <command>

Everyday tasks
  recovery-key setup    Set up recovery with browser approval
  backup verify         Verify an extracted recovery backup
  backup kit            Download and verify a complete recovery ZIP
  backup check          Check that the saved key decrypts its package
  status                Check your environment
  restore --help        See the recovery steps for a replacement deployment

Quick start
  seams-wallet derivation-root backup verify

Help
  Add --help to any command for its options.
  seams-wallet derivation-root recovery-key setup --help
  seams-wallet help advanced

  --json    Machine-readable output
  version   Show the installed version";

pub(crate) fn help_text(path: &[&str]) -> Option<&'static str> {
    match path {
        [] | ["derivation-root"] => Some(SEAMS_USAGE_V1),
        ["advanced"] => Some(
            "\
Advanced commands
Run these with seams-wallet derivation-root, then add --help for details.

  recovery-key create        Create a key without enrollment
  recovery-key enroll        Enroll an existing key
  backup download            Download one encrypted package
  backup manifest download   Download the manifest
  rotate                     Rotate operational shares
  rotation status            Check a rotation job
  trust show                 Inspect recovery trust
  trust update               Update recovery trust

Release verification
  seams-wallet release verify --help

Secrets are prompted for without echoing or read from file descriptors.
They are never accepted as arguments or environment variables.",
        ),
        ["derivation-root", "recovery-key"] => Some(
            "Wrapper keys

  setup    Set up and enroll a key with browser approval
  create   Create a key manually
  enroll   Enroll an existing key

  seams-wallet derivation-root recovery-key <command> --help",
        ),
        ["derivation-root", "backup"] => Some(
            "Backups

  verify              Verify an extracted recovery backup
  download            Download one encrypted package
  manifest download   Download the manifest

  seams-wallet derivation-root backup <command> --help",
        ),
        ["derivation-root", "backup", "manifest"] => Some(
            "Recovery manifest

  seams-wallet derivation-root backup manifest download --help",
        ),
        ["derivation-root", "rotation"] => Some(
            "Rotation

  seams-wallet derivation-root rotation status --help",
        ),
        ["derivation-root", "trust"] => Some(
            "Recovery trust

  show     Inspect the trust bundle
  connect  Save this deployment’s authority through verified HTTPS
  update   Install a bundle that continues the trusted root

  seams-wallet derivation-root trust <command> --help",
        ),
        ["release"] => Some(
            "Release verification

  seams-wallet release verify --help",
        ),
        ["derivation-root", "restore"] => Some(
            "\
Restore
Each holder runs one command from their extracted recovery folder.
Requires a configured empty destination. Approve the matching code in your dashboard.

Usage
  seams-wallet derivation-root restore --destination <url> --role <deriver-a|deriver-b>
    [--folder <path>] [--wrapping-key-file <path>] [--trust-bundle <path>]
    --console-url <url> --environment <id>

Verifies the package, registers the manifest, imports your share, and saves
private retry state. Run the same command to retry an interrupted import.
Defaults: manifest.json, deriver-a.backup / deriver-b.backup, and the matching .key.

After both holders finish, use restore status, then explicitly restore activate.
Use restore <step> --help for individual operator commands.",
        ),
        ["derivation-root", "backup", "kit"] => Some(
            "backup kit
Download the exact recovery set after dashboard approval, verify both keys, and save a ZIP locally.

  seams-wallet derivation-root backup kit --console-url <https-origin> --environment <id> --recovery-set <id> [--key-a <path>] [--key-b <path>] [--output <path>]

Defaults: ./deriver-a-wrapper.key, ./deriver-b-wrapper.key, ./seams-recovery.zip.
Prompts for an optional ZIP password. Private keys stay on your computer.",
        ),
        ["derivation-root", "backup", "verify"] => Some(
            "\
backup verify
Verify both encrypted backup packages in the extracted recovery folder.
Defaults to manifest.json, deriver-a.backup, and deriver-b.backup.
Use --role to verify one package. --package requires --role.

Usage
  seams-wallet derivation-root backup verify [--manifest <path>] \\
    [--role <deriver-a|deriver-b>] [--package <path>] \\
    [--trust-bundle <path>] [--trust-snapshot <path>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "recovery-key", "setup"] => Some(
            "\
recovery-key setup
Generate a wrapper keypair and approve enrollment of its public key in your browser.
The public key encrypts the recovery package; the private wrapper key decrypts it.
--wrapping-key-file is where setup saves the local wrapper key file (created if absent).
Defaults: ./deriver-a-wrapper.key for deriver-a, ./deriver-b-wrapper.key for deriver-b.
The console provides the dashboard address automatically.

Usage
  seams-wallet derivation-root recovery-key setup \\
    --console-url <url> \\
    --environment <id> --role <deriver-a|deriver-b> \\
    [--wrapping-key-file <path>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "recovery-key", "create"] => Some(
            "\
recovery-key create
Create a wrapper key file for one holder.

Usage
  seams-wallet derivation-root recovery-key create \\
    --role <deriver-a|deriver-b> \\
    --wrapping-key-file <path>

  --json    Machine-readable output",
        ),
        ["derivation-root", "recovery-key", "enroll"] => Some(
            "\
recovery-key enroll
Enroll an existing wrapper key for one holder.

Usage
  seams-wallet derivation-root recovery-key enroll \\
    --console-url <url> \\
    --environment <environment-id> --role <deriver-a|deriver-b> \\
    --wrapping-key-file <path> [--credential-fd <n>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "status"] => Some(
            "\
status
Check the environment’s derivation-root and recovery status.

Usage
  seams-wallet derivation-root status \\
    --console-url <url> \\
    --environment <environment-id> [--credential-fd <n>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "rotate"] => Some(
            "\
rotate
Rotate operational shares for an environment.

Usage
  seams-wallet derivation-root rotate \\
    --console-url <url> \\
    --environment <environment-id> --idempotency-key <key> \\
    [--credential-fd <n>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "rotation", "status"] => Some(
            "\
rotation status
Check a rotation job’s progress.

Usage
  seams-wallet derivation-root rotation status \\
    --console-url <url> \\
    --environment <environment-id> --job <job-id> [--credential-fd <n>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "backup", "download"] => Some(
            "\
backup download
Download and verify one holder’s encrypted backup package.

Usage
  seams-wallet derivation-root backup download \\
    --console-url <url> \\
    --environment <environment-id> --role <deriver-a|deriver-b> \\
    --output <path> --manifest <path> [--trust-bundle <path>] \\
    [--credential-fd <n>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "backup", "manifest", "download"] => Some(
            "\
backup manifest download
Download the recovery manifest.

Usage
  seams-wallet derivation-root backup manifest download \\
    --console-url <url> \\
    --environment <environment-id> --output <path> [--credential-fd <n>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "restore", "start"] => Some(
            "\
restore start
Register the recovery manifest on an empty destination deployment.

Usage
  seams-wallet derivation-root restore start \\
    --destination <url> \\
    --manifest <path> --console-url <url> --environment <id>

  --json    Machine-readable output",
        ),
        ["derivation-root", "restore", "share"] => Some(
            "\
restore share
Decrypt and import one holder’s backup package.
The destination-encrypted envelope is saved before upload. Retries use
that same envelope without reopening the wrapper key.

Usage
  seams-wallet derivation-root restore share \\
    --destination <url> \\
    --operation-id <id> --role <deriver-a|deriver-b> --package <path> \\
    --wrapping-key-file <path> \\
    --manifest <path> --envelope-file <path> \\
    [--trust-bundle <path>] \\
    --console-url <url> --environment <id>

  --json    Machine-readable output",
        ),
        ["derivation-root", "restore", "status"] => Some(
            "\
restore status
Check progress on the destination deployment.

Usage
  seams-wallet derivation-root restore status \\
    --destination <url> --console-url <url> --environment <id>

  --json    Machine-readable output",
        ),
        ["derivation-root", "restore", "activate"] => Some(
            "\
restore activate
Verify continuity and activate the restored root.

Usage
  seams-wallet derivation-root restore activate \\
    --destination <url> \\
    --session-file <path> [--acknowledge-offline-trust] --console-url <url> --environment <id>

  --json    Machine-readable output",
        ),
        ["derivation-root", "trust", "connect"] => Some(
            "trust connect
Save a deployment’s recovery authority over verified HTTPS for offline use.
Run from your extracted recovery folder using the console URL in the dashboard.

Usage
  seams-wallet derivation-root trust connect --console-url <url> [--manifest <path>]

An existing authority can only be updated through verified root continuity.",
        ),
        ["derivation-root", "backup", "check"] => Some(
            "backup check
Verify that the saved wrapper key decrypts its matching backup package.
Run from the extracted recovery folder.

Usage
  seams-wallet derivation-root backup check --role <deriver-a|deriver-b>
    [--manifest <path>] [--package <path>] [--wrapping-key-file <path>]
",
        ),
        ["derivation-root", "trust", "show"] => Some(
            "\
trust show
Inspect the pinned or supplied recovery trust bundle.

Usage
  seams-wallet derivation-root trust show [--trust-bundle <path>]

  --json    Machine-readable output",
        ),
        ["derivation-root", "trust", "update"] => Some(
            "\
trust update
Install a trust bundle that continues the pinned root.

Usage
  seams-wallet derivation-root trust update \\
    --bundle <path> --output <path>

  --json    Machine-readable output",
        ),
        ["release", "verify"] => Some(
            "\
release verify
Verify a release artifact against its signed checksum manifest.

Usage
  seams-wallet release verify \\
    --manifest <path> --artifact <path>

  --json    Machine-readable output",
        ),
        _ => None,
    }
}
