# Seams Wallet CLI

The `seams-wallet` command runs on macOS (Apple Silicon or Intel) and Linux x86_64.
The npm launcher requires Node.js 22 or later and verifies the signed native
release before running it. Version 0.6.0 discovers the dashboard from the console
and uses explicit wrapper-key filenames.

```sh
npm install --global @seams/wallet-cli@0.6.0
```

Use the commands shown in your Seams dashboard. They include your console URL,
environment, and configured recovery destination. The same executable and HTTPS
verification run in local development and production. Install your development
CA in the operating system's trust store when using a local HTTPS deployment.

## Create and download a complete backup

Follow Recovery backup in the dashboard. Each holder runs the displayed key
setup command and approves the matching code in the browser. Setup saves their
private wrapper key file and the deployment's public recovery authority on their device.
Setup defaults to `deriver-a-wrapper.key` or `deriver-b-wrapper.key` for the selected
role. Use `--wrapping-key-file` to choose another path.

The CLI creates the ZIP locally with the manifest, role backup packages, and their
matching wrapper key files. Two-owner governance provides each holder's own package
and key; single-owner governance includes both. Keep these files safe.

ZIP password protection is optional. Press Enter at the password prompt for a normal
ZIP or enter a password for AES-256 encryption. Extract the ZIP before using the CLI;
extracted keys require no separate password.

## Verify the extracted files

From the extracted folder:

```sh
seams-wallet derivation-root backup verify
seams-wallet derivation-root backup check --role deriver-a
seams-wallet derivation-root backup check --role deriver-b
```

For a holder-specific ZIP, add `--role deriver-a` or `--role deriver-b` to
verification and run only that holder's decryption check. Verification checks
signatures and package integrity; `backup check` also confirms the saved key
can decrypt the package. Offline verification does not check revocation status
or perform a restore.

On a device that has not connected to this deployment, first run the dashboard's
`trust connect` command. It obtains the authority over verified HTTPS, verifies
the manifest, and saves the authority for subsequent offline use. A trust file
inside an archive cannot authorize itself. Release-signing trust remains
separate and compiled into the launcher.

## Restore

Copy each holder's bundled restore command from the dashboard. It includes
`--destination`, `--console-url`, and `--environment`. The CLI discovers the dashboard
address from the console over verified HTTPS.
The CLI opens the dashboard: compare the code and approve access using your
signed-in session. No tenant bootstrap credential is required.

The bundled command registers the manifest, imports that holder's share, and
saves retry state. It finds `manifest.json`, `deriver-a.backup` / `deriver-b.backup`,
and the matching `deriver-a-wrapper.key` / `deriver-b-wrapper.key` file in the current folder. Keep its `.restore-*` files
and rerun the same command after an interruption.

Once both imports complete, follow the dashboard's status and activation
commands. Activation is explicit. The destination must be configured for this
organization and environment and have no active derivation root.

Operators provisioning a destination may explicitly use `--bootstrap-fd` instead
of browser authorization. That credential stays on the server in the tenant
workflow. Tenant commands and production commands follow the same authorization
and destination-binding checks.

## Save a complete recovery kit

Copy the `backup kit` command from your dashboard and run it in the directory
containing both enrolled wrapper key files. Approve the matching browser code. The CLI
downloads the authorized recovery set, checks both keys decrypt their packages,
and saves `seams-recovery.zip` with private file permissions. An optional password
encrypts every ZIP entry with AES-256. Use an AES-compatible ZIP extractor.
The dashboard never reads the private keys or ZIP password.
