#![forbid(unsafe_code)]
//! CI-only certificate and revocation signing with the pinned recovery root.

use base64ct::{Base64UrlUnpadded, Encoding};
use router_ab_core::{
    TenantRootRecoveryRevocationEntryV1, TenantRootRecoveryRevocationSnapshotV1,
    TenantRootRecoverySignerCertificateV1, TenantRootRecoverySignerRoleV1,
};
use serde::Deserialize;
use std::io::{Read, Write};
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Certificate {
        subject_key_id: String,
        verifying_key: String,
        role: Role,
        not_before: String,
        not_after: String,
    },
    RevocationSnapshot {
        version: u64,
        issued_at: String,
        entries: Vec<Revocation>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Role {
    DeriverA,
    DeriverB,
    ControlPlane,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Revocation {
    Retired {
        subject_key_id: String,
    },
    Compromised {
        subject_key_id: String,
        invalid_before: String,
    },
}

fn main() {
    match run() {
        Ok(bytes) => {
            if std::io::stdout().write_all(&bytes).is_err() {
                std::process::exit(2);
            }
        }
        Err(error) => {
            eprintln!("error: {error}");
            std::process::exit(2);
        }
    }
}

fn run() -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 4 || args[0] != "--request" || args[2] != "--signing-key-fd" {
        return Err(
            "usage: seams-recovery-authority --request <json-file> --signing-key-fd <n>".into(),
        );
    }
    let fd: u16 = args[3].parse()?;
    let request_bytes =
        seams_recovery_core::read_capped_file_v1(std::path::Path::new(&args[1]), 65_536)?;
    let request: Request = serde_json::from_slice(&request_bytes)?;
    let mut encoded = Zeroizing::new(String::new());
    std::fs::File::open(format!("/dev/fd/{fd}"))?
        .take(128)
        .read_to_string(&mut encoded)?;
    let decoded = Zeroizing::new(Base64UrlUnpadded::decode_vec(encoded.trim())?);
    let key = Zeroizing::new(<[u8; 32]>::try_from(decoded.as_slice())?);
    let bundle = seams_cli::pinned_recovery_trust_bundle_v1()?;
    let root = bundle.current_root();
    match request {
        Request::Certificate {
            subject_key_id,
            verifying_key,
            role,
            not_before,
            not_after,
        } => {
            let public: [u8; 32] = Base64UrlUnpadded::decode_vec(&verifying_key)?
                .try_into()
                .map_err(|_| "verifying_key must encode 32 bytes")?;
            let role = match role {
                Role::DeriverA => TenantRootRecoverySignerRoleV1::DeriverA,
                Role::DeriverB => TenantRootRecoverySignerRoleV1::DeriverB,
                Role::ControlPlane => TenantRootRecoverySignerRoleV1::ControlPlane,
            };
            let certificate = TenantRootRecoverySignerCertificateV1::sign(
                root.key_id(),
                &key,
                subject_key_id,
                public,
                role,
                not_before,
                not_after,
            )?;
            certificate.verify_issued_by(root)?;
            Ok(certificate.canonical_json()?)
        }
        Request::RevocationSnapshot {
            version,
            issued_at,
            entries,
        } => {
            let mut revocations = Vec::with_capacity(entries.len());
            for entry in entries {
                revocations.push(match entry {
                    Revocation::Retired { subject_key_id } => {
                        TenantRootRecoveryRevocationEntryV1::retired(subject_key_id)?
                    }
                    Revocation::Compromised {
                        subject_key_id,
                        invalid_before,
                    } => TenantRootRecoveryRevocationEntryV1::compromised(
                        subject_key_id,
                        invalid_before,
                    )?,
                });
            }
            let snapshot = TenantRootRecoveryRevocationSnapshotV1::sign(
                version,
                issued_at,
                root.key_id(),
                &key,
                revocations,
            )?;
            snapshot.verify(&bundle)?;
            Ok(snapshot.canonical_json()?)
        }
    }
}
