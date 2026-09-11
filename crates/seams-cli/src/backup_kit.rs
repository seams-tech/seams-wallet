use crate::{
    output::SeamsResultV1,
    run::{browser_post, enrollment_field, CommandFailure},
    transport::ConsoleTransportV1,
};
use base64ct::{Base64UrlUnpadded, Encoding};
use rand_core_09::{OsRng, RngCore, UnwrapErr};
use router_ab_core::TwoPartyDeriverRole;
use seams_recovery_core::{check_role_backup_decryption_v1, write_new_file_durably_v1};
use std::{
    io::{Cursor, Write},
    path::Path,
};
use zeroize::Zeroizing;

struct WorkDirectory(std::path::PathBuf);
impl Drop for WorkDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn create(
    selected_role: Option<TwoPartyDeriverRole>,
    transport: &dyn ConsoleTransportV1,
    console: &str,
    environment: &str,
    recovery_set: &str,
    key_a: &Path,
    key_b: &Path,
    output: &Path,
) -> Result<SeamsResultV1, CommandFailure> {
    if output.exists() {
        return Err(CommandFailure::invalid(
            "ZIP already exists. Choose a new --output path.",
        ));
    }
    // Validate the secure endpoint before asking for approval or reading private keys.
    let _ = crate::deployment::fetch_trust(transport, console).map_err(CommandFailure::invalid)?;
    let dashboard =
        crate::deployment::dashboard_origin(transport, console).map_err(CommandFailure::invalid)?;
    let roles: Vec<_> = [TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB]
        .into_iter()
        .filter(|role| selected_role.is_none() || Some(*role) == selected_role)
        .collect();
    let scope = selected_role.map(|role| role.as_str()).unwrap_or("both");
    for role in &roles {
        let key = if *role == TwoPartyDeriverRole::DeriverA {
            key_a
        } else {
            key_b
        };
        let metadata = std::fs::metadata(key).map_err(|_| {
            CommandFailure::invalid(format!(
                "Cannot read {}. Use the key saved during enrollment.",
                key.display()
            ))
        })?;
        if !metadata.is_file() || metadata.len() > 65536 {
            return Err(CommandFailure::invalid("Invalid wrapper key file"));
        }
    }
    let start = browser_post(
        transport,
        console,
        "backup-access",
        "start",
        serde_json::json!({"environmentId":environment,"recoverySetId":recovery_set,"scope":scope}),
    )?;
    let id = enrollment_field(&start, "id")?;
    let secret = Zeroizing::new(enrollment_field(&start, "pollingSecret")?);
    let code = enrollment_field(&start, "confirmationCode")?;
    let url = format!("{dashboard}/dashboard/derivation-root?cliBackup={id}");
    crate::output::terminal_notice(
        "1/3 · Approve in your browser",
        &format!("Compare code: {code}\nApprove only if this code matches the dashboard.\n\nOpen this link if the browser did not open:\n{url}"),
        "1;36",
    );
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&url).status();
    let started = std::time::Instant::now();
    let response = loop {
        if started.elapsed().as_secs() > 300 {
            return Err(CommandFailure::invalid(
                "Approval expired. Run the command again.",
            ));
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
        let response = browser_post(
            transport,
            console,
            "backup-access",
            "poll",
            serde_json::json!({"id":id,"pollingSecret":secret.as_str()}),
        )?;
        match enrollment_field(&response, "state")?.as_str() {
            "pending" => continue,
            "approved" => break response,
            _ => {
                return Err(CommandFailure::invalid(
                    "Request denied or expired. Run the command again to request approval.",
                ))
            }
        }
    };
    if enrollment_field(&response, "recoverySetId")? != recovery_set {
        return Err(CommandFailure::invalid("Recovery set changed"));
    }
    crate::output::terminal_notice(
        "2/3 · Verify recovery files",
        "Approval received. Checking the downloaded packages against your local keys…",
        "1;36",
    );
    let mut random = [0u8; 16];
    UnwrapErr(OsRng).fill_bytes(&mut random);
    let directory = std::env::temp_dir().join(format!(
        "seams-kit-{}",
        Base64UrlUnpadded::encode_string(&random)
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .map_err(|e| CommandFailure::invalid(e.to_string()))?;
    }
    let work = WorkDirectory(directory);
    let artifacts = response
        .get("artifacts")
        .ok_or_else(|| CommandFailure::invalid("Missing backup files"))?;
    for (field, name) in [
        ("manifest", "manifest.json"),
        ("deriver_a_package", "deriver-a.backup"),
        ("deriver_b_package", "deriver-b.backup"),
    ] {
        if field != "manifest" && scope != "both" && field != format!("{scope}_package") {
            continue;
        }
        let encoded = artifacts
            .get(field)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| CommandFailure::invalid("Missing backup file"))?;
        let bytes = Base64UrlUnpadded::decode_vec(encoded)
            .map_err(|_| CommandFailure::invalid("Invalid backup encoding"))?;
        write_new_file_durably_v1(&work.0.join(name), &bytes)?;
    }
    let manifest = work.0.join("manifest.json");
    crate::deployment::connect_manifest(transport, console, &manifest)
        .map_err(CommandFailure::invalid)?;
    let pinned = crate::trust::pinned_recovery_trust_bundle_v1()?;
    let trust = crate::deployment::trust_for_manifest(&manifest, &pinned)
        .map_err(CommandFailure::invalid)?;
    for (role, package, key) in [
        (TwoPartyDeriverRole::DeriverA, "deriver-a.backup", key_a),
        (TwoPartyDeriverRole::DeriverB, "deriver-b.backup", key_b),
    ] {
        if !roles.contains(&role) {
            continue;
        }
        let name = if role == TwoPartyDeriverRole::DeriverA {
            "deriver-a-wrapper.key"
        } else {
            "deriver-b-wrapper.key"
        };
        let bytes =
            Zeroizing::new(std::fs::read(key).map_err(|e| CommandFailure::invalid(e.to_string()))?);
        write_new_file_durably_v1(&work.0.join(name), &bytes)?;
        let report = check_role_backup_decryption_v1(
            &manifest,
            &work.0.join(package),
            &work.0.join(name),
            role,
            &trust,
        )?;
        if report.recovery_set_id != recovery_set {
            return Err(CommandFailure::invalid(
                "Manifest does not match the authorized recovery set",
            ));
        }
    }
    crate::output::terminal_notice(
        "✓ Recovery files verified",
        "Your wrapper keys successfully decrypted their matching backup packages.",
        "1;32",
    );
    crate::output::terminal_notice(
        "3/3 · Save your recovery ZIP",
        "Choose an optional ZIP password, or press Enter to save without encryption.",
        "1;36",
    );
    let password = crate::run::read_from_terminal_without_echo(
        "ZIP password (optional; Enter for no encryption)",
    )?;
    if !password.is_empty() {
        let confirmation = crate::run::read_from_terminal_without_echo("confirm ZIP password")?;
        if *password != *confirmation {
            return Err(CommandFailure::invalid(
                "Passwords do not match. No ZIP was written.",
            ));
        }
    }
    let bytes = archive(&work.0, &password, selected_role)?;
    write_new_file_durably_v1(output, &bytes)?;
    Ok(SeamsResultV1::BackupKitCreated {
        output: output.display().to_string(),
    })
}

fn archive(
    directory: &Path,
    password: &[u8],
    role: Option<TwoPartyDeriverRole>,
) -> Result<Zeroizing<Vec<u8>>, CommandFailure> {
    let password_text = std::str::from_utf8(password)
        .map_err(|_| CommandFailure::invalid("Password must be UTF-8"))?;
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let mut options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o600);
    if !password.is_empty() {
        options = options.with_aes_encryption(zip::AesMode::Aes256, password_text);
    }
    for (name, path) in [
        ("manifest.json", directory.join("manifest.json")),
        ("deriver-a.backup", directory.join("deriver-a.backup")),
        ("deriver-b.backup", directory.join("deriver-b.backup")),
        (
            "deriver-a-wrapper.key",
            directory.join("deriver-a-wrapper.key"),
        ),
        (
            "deriver-b-wrapper.key",
            directory.join("deriver-b-wrapper.key"),
        ),
    ] {
        if (role == Some(TwoPartyDeriverRole::DeriverA) && name.starts_with("deriver-b"))
            || (role == Some(TwoPartyDeriverRole::DeriverB) && name.starts_with("deriver-a"))
        {
            continue;
        }
        let bytes = Zeroizing::new(
            std::fs::read(path).map_err(|e| CommandFailure::invalid(e.to_string()))?,
        );
        writer
            .start_file(name, options)
            .map_err(|e| CommandFailure::invalid(e.to_string()))?;
        writer
            .write_all(&bytes)
            .map_err(|e| CommandFailure::invalid(e.to_string()))?;
    }
    writer
        .start_file("README.txt", options)
        .map_err(|e| CommandFailure::invalid(e.to_string()))?;
    writer.write_all(b"Seams recovery kit\nKeep this kit private: it contains both wrapper keys.\nExtract all files together. Follow Restore a deployment in your authenticated Seams dashboard.\nUse seams-wallet; approve the matching Terminal code in your browser.\nKeys and any ZIP password remain local. Never upload these private keys.\n").map_err(|e| CommandFailure::invalid(e.to_string()))?;
    let bytes = Zeroizing::new(
        writer
            .finish()
            .map_err(|e| CommandFailure::invalid(e.to_string()))?
            .into_inner(),
    );

    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    #[test]
    fn complete_kit_round_trips_with_optional_password() {
        let mut random = [0u8; 16];
        UnwrapErr(OsRng).fill_bytes(&mut random);
        let path = std::env::temp_dir().join(Base64UrlUnpadded::encode_string(&random));
        std::fs::create_dir(&path).unwrap();
        let work = WorkDirectory(path);
        let names = [
            "manifest.json",
            "deriver-a.backup",
            "deriver-b.backup",
            "deriver-a-wrapper.key",
            "deriver-b-wrapper.key",
        ];
        for name in names {
            std::fs::write(work.0.join(name), name.as_bytes()).unwrap();
        }
        for password in [b"".as_slice(), b"test password".as_slice()] {
            let bytes =
                archive(&work.0, password, None).unwrap_or_else(|_| panic!("Kit archive failed"));
            let mut zip = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
            assert_eq!(zip.len(), 6);
            for name in names {
                if !password.is_empty() {
                    assert!(zip.by_name_decrypt(name, b"wrong").is_err());
                }
                let mut file = zip.by_name_decrypt(name, password).unwrap();
                let mut restored = String::new();
                file.read_to_string(&mut restored).unwrap();
                assert_eq!(restored, name);
            }
            assert!(zip.by_name_decrypt("README.txt", password).is_ok());
        }
    }
}
