//! Command execution.
//!
//! Recovery commands use a deployment authority saved through verified HTTPS
//! or the built-in production authority. All network access crosses the same
//! bounded HTTPS transport; offline verification never contacts a service.

use rand_core_09::{OsRng, UnwrapErr};
use router_ab_core::{
    decode_tenant_root_recovery_manifest_v1, TenantRootCustodyLineageId,
    TenantRootRecoveryRevocationSnapshotV1, TenantRootRecoveryTrustBundleV1,
    TenantRootRecoveryTrustEvidenceV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreImportEnvelopeV1, TenantRootRestoreImportPublicKeyV1,
    TenantRootRestoreSessionIdV1, TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
    TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_MAX_BYTES,
    TENANT_ROOT_RECOVERY_TRUST_BUNDLE_MAX_BYTES, TENANT_ROOT_RESTORE_IMPORT_MAX_BYTES,
};
use seams_recovery_core::{
    check_role_backup_decryption_v1, open_and_reseal_role_share_v1,
    prove_recovery_recipient_control_from_bytes_v1, read_capped_file_v1,
    require_trust_bundle_continues_pinned_root_v1, verify_role_package_offline_v1,
    write_new_file_durably_v1, DurableWriteOutcomeV1, RecoveryCoreError, RecoveryCoreErrorCode,
    RecoveryHostSecretCapabilitiesV1, RecoveryKeyFileV1, ReleaseChecksumManifestV1,
    RestoreDestinationBindingV1, RECOVERY_FILE_MODE_V1, RECOVERY_KEY_FILE_MAX_BYTES,
    RELEASE_MANIFEST_MAX_BYTES_V1,
};
use std::path::Path;
use zeroize::Zeroizing;

use crate::command::{SeamsCommandV1, SecretInputV1, TrustEvidenceSourceV1};
use crate::console::{
    activate_restored_root_v1, confirm_recipient_v1, download_recovery_manifest_v1,
    download_role_package_v1, import_role_share_v1, issue_role_import_key_v1,
    open_restore_session_v1, read_console_rotation_v1, read_console_status_v1,
    read_restore_status_v1, record_durable_verification_v1, register_restore_manifest_v1,
    start_console_rotation_v1, start_recipient_challenge_v1, start_restore_session_v1,
    ConsoleCredentialV1, ConsoleEndpointV1, ConsoleErrorKindV1, ConsoleErrorV1,
    ConsoleRotationOutcomeV1, DestinationBootstrapV1, DestinationSessionV1,
    DurableVerificationReportV1, RestoreSessionReportV1,
};
use crate::output::{RecoveryKeyCreatedV1, SeamsExitCodeV1, SeamsResultV1, TrustBundleSummaryV1};
use crate::transport::ConsoleTransportV1;
use crate::trust::{
    pinned_recovery_trust_bundle_v1, pinned_release_root_v1, resolve_recovery_trust_bundle_v1,
};

/// Largest release artifact this tool will read to verify.
const RELEASE_ARTIFACT_MAX_BYTES_V1: usize = 256 * 1024 * 1024;
/// Largest secret accepted from a dedicated descriptor.
const SECRET_MAX_BYTES_V1: usize = 4096;

const CONSOLE_CREDENTIAL: &str = "console credential";
const BOOTSTRAP_CREDENTIAL: &str = "destination bootstrap credential";

/// Why one command failed, in the exit-code vocabulary.
pub(crate) struct CommandFailure {
    exit: SeamsExitCodeV1,
    retryable: bool,
    message: String,
}

impl CommandFailure {
    fn new(exit: SeamsExitCodeV1, message: impl Into<String>) -> Self {
        Self {
            exit,
            retryable: exit.retryable(),
            message: message.into(),
        }
    }

    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new(SeamsExitCodeV1::UsageOrInvalidInput, message)
    }

    fn trust(message: impl Into<String>) -> Self {
        Self::new(SeamsExitCodeV1::ArtifactOrTrustFailure, message)
    }
}

impl From<RecoveryCoreError> for CommandFailure {
    fn from(error: RecoveryCoreError) -> Self {
        let exit = match error.code() {
            RecoveryCoreErrorCode::InvalidLocalInput => SeamsExitCodeV1::UsageOrInvalidInput,
            RecoveryCoreErrorCode::ArtifactVerificationFailed => {
                SeamsExitCodeV1::ArtifactOrTrustFailure
            }
            RecoveryCoreErrorCode::KeyProviderFailure => SeamsExitCodeV1::KeyProviderFailure,
            RecoveryCoreErrorCode::FilesystemDurabilityFailure => {
                SeamsExitCodeV1::FilesystemDurabilityFailure
            }
            RecoveryCoreErrorCode::AuthorizationFailure => SeamsExitCodeV1::AuthorizationFailure,
            RecoveryCoreErrorCode::RetryableServiceFailure => {
                SeamsExitCodeV1::RetryableServiceFailure
            }
        };
        Self::new(exit, error.message().to_owned())
    }
}

/// Maps one console failure onto the frozen exit codes.
///
/// A refused operation is a lifecycle or restore-state failure, except when
/// the console says the named environment is not the one the session resolves:
/// that is the operator's input, not the service's state.
impl From<ConsoleErrorV1> for CommandFailure {
    fn from(error: ConsoleErrorV1) -> Self {
        let exit = match error.kind() {
            ConsoleErrorKindV1::InvalidInput => SeamsExitCodeV1::UsageOrInvalidInput,
            ConsoleErrorKindV1::Unauthorized => SeamsExitCodeV1::AuthorizationFailure,
            ConsoleErrorKindV1::Refused => match error.code() {
                Some("environment_mismatch") => SeamsExitCodeV1::UsageOrInvalidInput,
                _ => SeamsExitCodeV1::RestoreStateFailure,
            },
            ConsoleErrorKindV1::Unavailable => SeamsExitCodeV1::RetryableServiceFailure,
            ConsoleErrorKindV1::UnexpectedResponse => SeamsExitCodeV1::InternalInvariantFailure,
        };
        Self {
            exit,
            retryable: error.retryable(),
            message: error.message().to_owned(),
        }
    }
}

/// Runs one parsed command.
pub fn run_command_v1(
    command: &SeamsCommandV1,
    capabilities: RecoveryHostSecretCapabilitiesV1,
    transport: &dyn ConsoleTransportV1,
) -> (SeamsResultV1, SeamsExitCodeV1) {
    let result = pinned_recovery_trust_bundle_v1()
        .map_err(CommandFailure::from)
        .and_then(|trust| {
            let manifest = match command {
                SeamsCommandV1::BackupVerify { manifest, .. }
                | SeamsCommandV1::BackupCheck { manifest, .. }
                | SeamsCommandV1::BackupDownload { manifest, .. }
                | SeamsCommandV1::RestoreShare { manifest, .. } => Some(manifest.clone()),
                SeamsCommandV1::Restore { folder, .. } => Some(folder.join("manifest.json")),
                _ => None,
            };
            let trust = match manifest {
                Some(path) => crate::deployment::trust_for_manifest(&path, &trust)
                    .map_err(CommandFailure::trust)?,
                None => trust,
            };
            execute(command, capabilities, transport, &trust)
        });
    command_outcome(result)
}

/// Runs a command against an explicit recovery trust authority supplied by its host.
/// The shipped executable uses `run_command_v1` and its compiled production pins.
pub fn run_command_with_recovery_trust_v1(
    command: &SeamsCommandV1,
    capabilities: RecoveryHostSecretCapabilitiesV1,
    transport: &dyn ConsoleTransportV1,
    recovery_trust: &TenantRootRecoveryTrustBundleV1,
) -> (SeamsResultV1, SeamsExitCodeV1) {
    command_outcome(execute(command, capabilities, transport, recovery_trust))
}

fn command_outcome(
    result: Result<SeamsResultV1, CommandFailure>,
) -> (SeamsResultV1, SeamsExitCodeV1) {
    match result {
        Ok(result) => (result, SeamsExitCodeV1::Success),
        Err(failure) => (
            SeamsResultV1::Failed {
                category: failure.exit.category().to_owned(),
                retryable: failure.retryable,
                message: failure.message,
            },
            failure.exit,
        ),
    }
}

fn execute(
    command: &SeamsCommandV1,
    capabilities: RecoveryHostSecretCapabilitiesV1,
    transport: &dyn ConsoleTransportV1,
    recovery_trust: &TenantRootRecoveryTrustBundleV1,
) -> Result<SeamsResultV1, CommandFailure> {
    match command {
        SeamsCommandV1::TrustConnect {
            console_url,
            manifest,
        } => {
            let path = crate::deployment::connect_manifest(transport, console_url, manifest)
                .map_err(CommandFailure::trust)?;
            Ok(SeamsResultV1::Usage { text: format!("SUCCESS: Recovery trust connected to {console_url}.\nSaved for offline verification: {}", path.display()) })
        }
        SeamsCommandV1::Help { text } => Ok(SeamsResultV1::Usage {
            text: (*text).to_owned(),
        }),
        SeamsCommandV1::Version => Ok(SeamsResultV1::Version {
            version: format!("seams-wallet {}", env!("CARGO_PKG_VERSION")),
        }),
        SeamsCommandV1::RecoveryKeySetup {
            console_url,
            environment,
            role,
            key_file,
        } => run_browser_enrollment(
            transport,
            console_url,
            environment,
            *role,
            key_file.as_deref(),
        ),
        SeamsCommandV1::RecoveryKeyCreate { role, key_file } => {
            let (file, material) = RecoveryKeyFileV1::create(*role, &mut UnwrapErr(OsRng))?;
            let outcome = write_new_file_durably_v1(key_file, &file.to_bytes()?)?;
            Ok(SeamsResultV1::RecoveryKeyCreated(RecoveryKeyCreatedV1 {
                role: role.as_str().to_owned(),
                key_file: outcome.path().display().to_string(),
                public_key_b64u: encode(material.public_key().as_bytes()),
                fingerprint_b64u: encode(material.fingerprint().as_bytes()),
                host_capabilities: capabilities,
            }))
        }
        SeamsCommandV1::RecoveryKeyEnroll {
            console_url,
            environment,
            role,
            key_file,

            credential,
        } => {
            // Validate the key before asking for destination credentials.
            let saved_key = RecoveryKeyFileV1::decode(&Zeroizing::new(read_capped_file_v1(
                key_file,
                RECOVERY_KEY_FILE_MAX_BYTES,
            )?))?;
            if saved_key.role() != *role {
                return Err(CommandFailure::new(
                    SeamsExitCodeV1::KeyProviderFailure,
                    "this wrapper key file belongs to the other Deriver role",
                ));
            }
            let public_key_b64u = encode(saved_key.public_key().as_bytes());
            let endpoint = console_endpoint(console_url, environment, credential)?;
            let challenge = start_recipient_challenge_v1(
                transport,
                &endpoint,
                role.as_str(),
                &public_key_b64u,
            )?;

            warn_about_host_capabilities(capabilities);

            // The private key is used only to open the challenge; the proof
            // carries public material and a confirmation, never the secret.
            let proof = prove_recovery_recipient_control_from_bytes_v1(
                key_file,
                *role,
                &challenge.envelope,
            )?;
            if proof.challenge_id_b64u != challenge.challenge_id_b64u {
                return Err(CommandFailure::trust(
                    "the challenge envelope does not carry the challenge id the console named",
                ));
            }
            let enrolled = confirm_recipient_v1(
                transport,
                &endpoint,
                role.as_str(),
                &proof.challenge_id_b64u,
                &proof.confirmation_b64u,
            )?;
            if enrolled.role != role.as_str()
                || enrolled.recipient_fingerprint_b64u != proof.fingerprint_b64u
            {
                return Err(CommandFailure::new(
                    SeamsExitCodeV1::InternalInvariantFailure,
                    "the console staged a recipient other than the one that proved control",
                ));
            }
            Ok(SeamsResultV1::RecipientEnrolled {
                role: enrolled.role,
                environment: environment.clone(),
                public_key_b64u: proof.public_key_b64u,
                fingerprint_b64u: enrolled.recipient_fingerprint_b64u,
                challenge_id_b64u: proof.challenge_id_b64u,
            })
        }
        SeamsCommandV1::BackupVerify {
            manifest,
            packages,
            trust_bundle,
            trust,
        } => {
            let bundle = resolve_recovery_trust_bundle_v1(recovery_trust, trust_bundle.as_deref())?;
            let snapshot = match trust {
                TrustEvidenceSourceV1::OfflineRootsOnly => None,
                TrustEvidenceSourceV1::TrustSnapshot(path) => Some(read_snapshot(path)?),
            };
            let evidence = match snapshot.as_ref() {
                None => TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
                Some(snapshot) => TenantRootRecoveryTrustEvidenceV1::TrustSnapshot { snapshot },
            };
            let selected = match packages {
                crate::command::BackupPackagesV1::Both => vec![
                    (
                        router_ab_core::TwoPartyDeriverRole::DeriverA,
                        manifest
                            .parent()
                            .unwrap_or(std::path::Path::new("."))
                            .join("deriver-a.backup"),
                    ),
                    (
                        router_ab_core::TwoPartyDeriverRole::DeriverB,
                        manifest
                            .parent()
                            .unwrap_or(std::path::Path::new("."))
                            .join("deriver-b.backup"),
                    ),
                ],
                crate::command::BackupPackagesV1::Single { role, package } => {
                    vec![(*role, package.clone())]
                }
            };
            let mut reports = Vec::new();
            for (role, package) in selected {
                reports.push(verify_role_package_offline_v1(
                    manifest,
                    &package,
                    role,
                    bundle.bundle(),
                    &evidence,
                )?);
            }
            Ok(SeamsResultV1::BackupVerified { reports })
        }
        SeamsCommandV1::BackupKit {
            role,
            console_url,
            environment,
            recovery_set,
            key_a,
            key_b,
            output,
        } => {
            warn_about_host_capabilities(capabilities);
            crate::backup_kit::create(
                *role,
                transport,
                console_url,
                environment,
                recovery_set,
                key_a,
                key_b,
                output,
            )
        }
        SeamsCommandV1::BackupCheck {
            manifest,
            role,
            package,
            key_file,
        } => {
            warn_about_host_capabilities(capabilities);

            let report = check_role_backup_decryption_v1(
                manifest,
                package,
                key_file,
                *role,
                recovery_trust,
            )?;
            Ok(SeamsResultV1::BackupDecryptionChecked { report })
        }
        SeamsCommandV1::Status {
            console_url,
            environment,
            credential,
        } => {
            let endpoint = console_endpoint(console_url, environment, credential)?;
            let report = read_console_status_v1(transport, &endpoint)?;
            Ok(SeamsResultV1::Status {
                // The console resolved this from the session and checked it
                // against the environment the operator named.
                environment: report.environment_id,
                lifecycle_revision: report.lifecycle_revision,
                active_epoch: report.operational_shares.active_epoch,
                deriver_a_status: report.operational_shares.deriver_a_status,
                deriver_b_status: report.operational_shares.deriver_b_status,
                rotation_job_status: report.operational_shares.job.map(|job| job.status),
                recovery_backup_status: report.recovery_backup_status,
            })
        }
        SeamsCommandV1::Rotate {
            console_url,
            environment,
            credential,
            idempotency_key,
        } => {
            let endpoint = console_endpoint(console_url, environment, credential)?;
            let started = start_console_rotation_v1(transport, &endpoint, idempotency_key)?;
            let (outcome, retry_at_ms, lifecycle_revision) = match started.outcome {
                ConsoleRotationOutcomeV1::Completed {
                    lifecycle_revision, ..
                } => ("completed", None, lifecycle_revision),
                ConsoleRotationOutcomeV1::Throttled { retry_at_ms } => {
                    ("throttled", Some(retry_at_ms), None)
                }
                ConsoleRotationOutcomeV1::InProgress { .. } => ("in_progress", None, None),
            };
            Ok(SeamsResultV1::RotationStarted {
                environment: environment.clone(),
                operation_id: started.operation_id,
                outcome: outcome.to_owned(),
                retry_at_ms,
                lifecycle_revision,
            })
        }
        SeamsCommandV1::RotationStatus {
            console_url,
            environment,
            credential,
            job,
        } => {
            let endpoint = console_endpoint(console_url, environment, credential)?;
            let current = read_console_rotation_v1(transport, &endpoint, job)?;
            Ok(SeamsResultV1::RotationStatus {
                environment: environment.clone(),
                job_id: job.clone(),
                status: current.map(|current| current.status),
            })
        }
        SeamsCommandV1::BackupDownload {
            console_url,
            environment,
            role,
            output,
            manifest,
            trust_bundle,
            credential,
        } => {
            // Trust is resolved before the network is touched, so a bad
            // override fails without a download to clean up.
            let bundle = resolve_recovery_trust_bundle_v1(recovery_trust, trust_bundle.as_deref())?;
            let endpoint = console_endpoint(console_url, environment, credential)?;
            let artifact = download_role_package_v1(transport, &endpoint, role.as_str())?;

            // Durable first, then verified from disk: a response that never
            // reached storage is not a backup.
            let outcome = write_new_file_durably_v1(output, &artifact.bytes)?;
            let verified = verify_role_package_offline_v1(
                manifest,
                outcome.path(),
                *role,
                bundle.bundle(),
                &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
            )
            .map_err(CommandFailure::from)
            .and_then(|report| {
                if report.package_digest_b64u == artifact.content_digest_b64u {
                    Ok(report)
                } else {
                    Err(CommandFailure::trust(
                        "the installed package does not match the digest the service recorded",
                    ))
                }
            });
            let report = match verified {
                Ok(report) => report,
                // An unverified file must not stay where a retry would need to
                // write; only the file this download installed is removed.
                Err(failure) => return Err(discard_unverified(outcome, failure)),
            };

            let recorded = record_durable_verification_v1(
                transport,
                &endpoint,
                &DurableVerificationReportV1 {
                    artifact: format!("{}_package", role.as_str()),
                    content_digest_b64u: report.package_digest_b64u.clone(),
                    trust_level: Some(report.trust_level.clone()),
                },
            )
            .is_ok();

            Ok(SeamsResultV1::ArtifactDownloaded {
                artifact: format!("{}_package", role.as_str()),
                output: outcome.path().display().to_string(),
                content_digest_b64u: report.package_digest_b64u.clone(),
                durable_verification_recorded: recorded,
                trust_level: Some(report.trust_level),
            })
        }
        SeamsCommandV1::ManifestDownload {
            console_url,
            environment,
            output,
            credential,
        } => {
            let endpoint = console_endpoint(console_url, environment, credential)?;
            let artifact = download_recovery_manifest_v1(transport, &endpoint)?;
            let outcome = write_new_file_durably_v1(output, &artifact.bytes)?;
            let digest = encode(outcome.sha256());
            if digest != artifact.content_digest_b64u {
                return Err(discard_unverified(
                    outcome,
                    CommandFailure::trust(
                        "the installed manifest does not match the digest the service recorded",
                    ),
                ));
            }
            let recorded = record_durable_verification_v1(
                transport,
                &endpoint,
                &DurableVerificationReportV1 {
                    artifact: "manifest".to_owned(),
                    content_digest_b64u: digest.clone(),
                    // The manifest is verified as part of a role package; on
                    // its own this tool reports durability, not trust.
                    trust_level: None,
                },
            )
            .is_ok();
            Ok(SeamsResultV1::ArtifactDownloaded {
                artifact: "manifest".to_owned(),
                output: outcome.path().display().to_string(),
                content_digest_b64u: digest,
                durable_verification_recorded: recorded,
                trust_level: None,
            })
        }
        SeamsCommandV1::Restore {
            destination_url,
            role,
            folder,
            key_file,
            trust_bundle,

            bootstrap,
        } => {
            use sha2::{Digest, Sha256};
            let role_name = match role {
                router_ab_core::TwoPartyDeriverRole::DeriverA => "deriver-a",
                router_ab_core::TwoPartyDeriverRole::DeriverB => "deriver-b",
            };
            let manifest = folder.join("manifest.json");
            let package = folder.join(format!("{role_name}.backup"));
            let bundle = resolve_recovery_trust_bundle_v1(recovery_trust, trust_bundle.as_deref())?;
            verify_role_package_offline_v1(
                &manifest,
                &package,
                *role,
                bundle.bundle(),
                &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
            )?;
            let manifest_bytes =
                read_capped_file_v1(&manifest, TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES)?;
            let scope = serde_json::to_vec(&(destination_url, role_name, encode(&manifest_bytes)))
                .map_err(|_| CommandFailure::invalid("could not bind restore retry state"))?;
            let operation_id = encode(&Sha256::digest(&scope));
            let session_file = folder.join(format!(".restore-{operation_id}.session.json"));
            let envelope_file = folder.join(format!(".restore-{operation_id}.envelope.json"));
            let session = activation_session(transport, destination_url, bootstrap, &session_file)?;
            let current = read_restore_status_v1(transport, &session)?;
            if current.status == "none" {
                start_restore_session_v1(transport, &session)?;
            }
            match current.status.as_str() {
                "none" | "awaiting_manifest" | "awaiting_role_imports" => {
                    register_restore_manifest_v1(transport, &session, &manifest_bytes)?;
                }
                // The last import can succeed even when its response is lost.
                // Replay the saved envelope so the server can return its receipt.
                "verifying" | "ready_to_activate"
                    if restore_envelope_exists_v1(&envelope_file)? => {}
                _ => {
                    return Err(CommandFailure::new(
                        SeamsExitCodeV1::RestoreStateFailure,
                        format!(
                            "Restore is {}. Use restore status to inspect it; use restore activate only when both holder imports are ready.",
                            current.status
                        ),
                    ))
                }
            }
            import_holder_share(
                transport,
                &session,
                &operation_id,
                role,
                &package,
                key_file,
                &manifest,
                &envelope_file,
                bundle.bundle(),
                capabilities,
            )
        }
        SeamsCommandV1::RestoreStart {
            destination_url,
            manifest,
            bootstrap,
        } => {
            // The manifest is read before any credential is presented.
            let manifest_bytes =
                read_capped_file_v1(manifest, TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES)?;
            let session = destination_session(transport, destination_url, bootstrap)?;
            let started = match start_restore_session_v1(transport, &session) {
                Ok(started) => started,
                // A session this operator already started, whose registration
                // failed last time, is resumed rather than abandoned.
                Err(error) if error.kind() == ConsoleErrorKindV1::Refused => {
                    let current = read_restore_status_v1(transport, &session)?;
                    if current.status == "awaiting_manifest" {
                        current
                    } else {
                        return Err(error.into());
                    }
                }
                Err(error) => return Err(error.into()),
            };
            if started.status != "awaiting_manifest" {
                return Err(CommandFailure::new(
                    SeamsExitCodeV1::RestoreStateFailure,
                    format!(
                        "the destination's restore session is {}, not awaiting a manifest",
                        started.status
                    ),
                ));
            }
            // Registration failure is the failure of this command: a session
            // without a manifest cannot accept a share, so reporting the bare
            // session as success would send the operator on to a step that
            // must fail.
            let registered = register_restore_manifest_v1(transport, &session, &manifest_bytes)?;
            Ok(restore_result(&registered, None, None))
        }
        SeamsCommandV1::RestoreShare {
            destination_url,
            operation_id,
            role,
            package,
            key_file,
            manifest,
            envelope_file,
            trust_bundle,

            bootstrap,
        } => {
            let bundle = resolve_recovery_trust_bundle_v1(recovery_trust, trust_bundle.as_deref())?;
            let session = destination_session(transport, destination_url, bootstrap)?;
            import_holder_share(
                transport,
                &session,
                operation_id,
                role,
                package,
                key_file,
                manifest,
                envelope_file,
                bundle.bundle(),
                capabilities,
            )
        }

        SeamsCommandV1::RestoreStatus {
            destination_url,
            bootstrap,
        } => {
            let session = destination_session(transport, destination_url, bootstrap)?;
            let current = read_restore_status_v1(transport, &session)?;
            Ok(restore_result(&current, None, None))
        }
        SeamsCommandV1::RestoreActivate {
            destination_url,
            acknowledge_offline_trust,
            bootstrap,
            session_file,
        } => {
            let session = activation_session(transport, destination_url, bootstrap, session_file)?;
            let activated =
                match activate_restored_root_v1(transport, &session, *acknowledge_offline_trust) {
                    Ok(activated) => activated,
                    Err(error) if error.code() == Some("bootstrap_reauthentication_stale") => {
                        eprintln!("Activation approval expired. Requesting fresh restore access…");
                        let renewed = destination_session(transport, destination_url, bootstrap)?;
                        let temporary =
                            session_file.with_extension(format!("{}.renewed", std::process::id()));
                        write_new_file_durably_v1(&temporary, &renewed.checkpoint_bytes()?)?;
                        std::fs::rename(&temporary, session_file).map_err(|_| {
                            CommandFailure::invalid("could not save renewed restore session")
                        })?;
                        activate_restored_root_v1(transport, &renewed, *acknowledge_offline_trust)?
                    }
                    Err(error) => return Err(error.into()),
                };
            Ok(restore_result(&activated, None, None))
        }
        SeamsCommandV1::TrustShow { trust_bundle } => {
            let resolved =
                resolve_recovery_trust_bundle_v1(recovery_trust, trust_bundle.as_deref())?;
            Ok(SeamsResultV1::TrustBundle(summarize(
                resolved.bundle(),
                resolved.is_pinned(),
            )))
        }
        SeamsCommandV1::TrustUpdate { bundle, output } => {
            let bytes = read_capped_file_v1(bundle, TENANT_ROOT_RECOVERY_TRUST_BUNDLE_MAX_BYTES)?;
            let candidate = TenantRootRecoveryTrustBundleV1::from_canonical_json(&bytes)
                .map_err(|error| CommandFailure::trust(error.message().to_owned()))?;
            require_trust_bundle_continues_pinned_root_v1(recovery_trust, &candidate)?;
            // The bytes that were verified are the bytes that are installed.
            let outcome = write_new_file_durably_v1(output, &bytes)?;
            Ok(SeamsResultV1::TrustUpdated {
                output: outcome.path().display().to_string(),
                bundle_version: candidate.bundle_version(),
                current_root_key_id: candidate.current_root().key_id().to_owned(),
            })
        }
        SeamsCommandV1::ReleaseVerify { manifest, artifact } => {
            let root = pinned_release_root_v1()?;
            let manifest = ReleaseChecksumManifestV1::decode(&read_capped_file_v1(
                manifest,
                RELEASE_MANIFEST_MAX_BYTES_V1,
            )?)?;
            manifest.verify(&root)?;
            let filename = artifact
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .ok_or_else(|| CommandFailure::invalid("--artifact must name a file"))?;
            let bytes = read_capped_file_v1(artifact, RELEASE_ARTIFACT_MAX_BYTES_V1)?;
            manifest.verify_artifact(filename, &bytes)?;
            Ok(SeamsResultV1::ReleaseVerified {
                artifact: filename.to_owned(),
                release_version: manifest.release_version().to_owned(),
                source_revision: manifest.source_revision().to_owned(),
                signer_key_id: root.key_id().to_owned(),
            })
        }
    }
}

fn summarize(bundle: &TenantRootRecoveryTrustBundleV1, pinned: bool) -> TrustBundleSummaryV1 {
    TrustBundleSummaryV1 {
        pinned,
        bundle_version: bundle.bundle_version(),
        current_root_key_id: bundle.current_root().key_id().to_owned(),
        historical_root_key_ids: bundle
            .historical_roots()
            .iter()
            .map(|root| root.key_id().to_owned())
            .collect(),
        bridge_count: bundle.bridges().len(),
    }
}

fn restore_envelope_exists_v1(path: &Path) -> Result<bool, CommandFailure> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(CommandFailure::new(
            SeamsExitCodeV1::FilesystemDurabilityFailure,
            format!(
                "could not inspect restore envelope {}: {error}",
                path.display()
            ),
        )),
    }
}

#[cfg(unix)]
fn require_private_file_mode_v1(path: &Path) -> Result<(), CommandFailure> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        CommandFailure::new(
            SeamsExitCodeV1::FilesystemDurabilityFailure,
            format!(
                "could not inspect private restore file {}: {error}",
                path.display()
            ),
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CommandFailure::new(
            SeamsExitCodeV1::FilesystemDurabilityFailure,
            format!(
                "private restore file {} is not a regular file",
                path.display()
            ),
        ));
    }
    let mode = metadata.permissions().mode() & 0o777;
    if mode != RECOVERY_FILE_MODE_V1 {
        return Err(CommandFailure::new(
            SeamsExitCodeV1::FilesystemDurabilityFailure,
            format!(
                "private restore file {} must use owner-only mode 600; found {mode:o}",
                path.display()
            ),
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn require_private_file_mode_v1(_path: &Path) -> Result<(), CommandFailure> {
    Ok(())
}

fn require_restore_binding_match_v1(
    matches: bool,
    field: &'static str,
) -> Result<(), CommandFailure> {
    if matches {
        Ok(())
    } else {
        Err(CommandFailure::trust(format!(
            "saved restore envelope binding does not match {field}"
        )))
    }
}

fn read_saved_restore_envelope_v1(
    envelope_file: &Path,
    manifest_path: &Path,
    package_path: &Path,
    role: router_ab_core::TwoPartyDeriverRole,
    bundle: &TenantRootRecoveryTrustBundleV1,
    destination: &RestoreDestinationBindingV1,
) -> Result<Vec<u8>, CommandFailure> {
    require_private_file_mode_v1(envelope_file)?;
    let bytes = read_capped_file_v1(envelope_file, TENANT_ROOT_RESTORE_IMPORT_MAX_BYTES)?;
    let envelope = TenantRootRestoreImportEnvelopeV1::decode(&bytes).map_err(binding_failure)?;
    let report = verify_role_package_offline_v1(
        manifest_path,
        package_path,
        role,
        bundle,
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )?;
    let manifest = decode_tenant_root_recovery_manifest_v1(&read_capped_file_v1(
        manifest_path,
        TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
    )?)
    .map_err(binding_failure)?;
    let manifest_digest = manifest.digest().map_err(binding_failure)?;
    require_restore_binding_match_v1(
        report.manifest_digest_b64u == encode(&manifest_digest),
        "verified manifest readback",
    )?;
    let descriptor = manifest.descriptor();
    let role_descriptor = descriptor.role(role);
    let binding = envelope.binding();
    let import_public_key_digest = destination.import_public_key.digest();

    require_restore_binding_match_v1(binding.role() == role, "role")?;
    require_restore_binding_match_v1(
        binding.destination_fingerprint() == destination.destination_fingerprint,
        "destination fingerprint",
    )?;
    require_restore_binding_match_v1(
        binding.destination_lineage() == destination.destination_lineage,
        "destination lineage",
    )?;
    require_restore_binding_match_v1(
        binding.restore_session_id() == destination.restore_session_id,
        "restore session",
    )?;
    require_restore_binding_match_v1(
        binding.import_key_id() == destination.import_key_id,
        "import key",
    )?;
    require_restore_binding_match_v1(
        binding.import_public_key_digest() == &import_public_key_digest,
        "import public key",
    )?;
    require_restore_binding_match_v1(
        binding.issued_at_ms() == destination.issued_at_ms,
        "import-key issuance time",
    )?;
    require_restore_binding_match_v1(
        binding.expires_at_ms() == destination.expires_at_ms,
        "import-key expiry",
    )?;
    require_restore_binding_match_v1(
        binding.destination_identity_digest() == descriptor.tenant_root_identity_digest(),
        "tenant identity",
    )?;
    require_restore_binding_match_v1(
        binding.recovery_set_id() == descriptor.recovery_set_id(),
        "recovery set",
    )?;
    require_restore_binding_match_v1(
        binding.recovery_share_commitment() == role_descriptor.recovery_share_commitment(),
        "recovery-share commitment",
    )?;
    require_restore_binding_match_v1(
        binding.stable_root_commitment() == descriptor.stable_root_commitment(),
        "stable root commitment",
    )?;
    require_restore_binding_match_v1(report.role == role.as_str(), "verified package role")?;
    require_restore_binding_match_v1(
        report.recovery_set_id == binding.recovery_set_id().to_base64url(),
        "verified recovery set",
    )?;
    require_restore_binding_match_v1(
        report.manifest_digest_b64u == encode(binding.manifest_digest()),
        "verified manifest",
    )?;
    require_restore_binding_match_v1(
        report.package_digest_b64u == encode(binding.source_package_digest().as_bytes()),
        "verified package",
    )?;
    require_restore_binding_match_v1(
        report.root_commitment_b64u == encode(&binding.stable_root_commitment().to_bytes()),
        "verified root commitment",
    )?;
    Ok(bytes)
}

/// Removes a file that was written durably but failed verification.
///
/// The original failure is what the operator needs to see; a removal failure
/// is appended so a retry that then hits "already exists" is explained.
fn discard_unverified(outcome: DurableWriteOutcomeV1, failure: CommandFailure) -> CommandFailure {
    let path = outcome.path().display().to_string();
    match outcome.discard() {
        Ok(()) => CommandFailure {
            message: format!("{}; {path} was removed", failure.message),
            ..failure
        },
        Err(error) => CommandFailure {
            message: format!(
                "{}; the unverified file could not be removed: {}",
                failure.message,
                error.message()
            ),
            ..failure
        },
    }
}

/// Tells the operator what this host could not guarantee about secrets in
/// memory, before a command that will hold one.
fn warn_about_host_capabilities(capabilities: RecoveryHostSecretCapabilitiesV1) {
    if capabilities.is_complete() {
        return;
    }
    for warning in capabilities.warnings() {
        crate::output::terminal_notice(
            "WARNING · Secret memory protection",
            &warning.replace("; ", ";\n"),
            "1;33",
        );
    }
}

/// Builds one console endpoint from the URL, environment, and credential.
fn console_endpoint(
    console_url: &str,
    environment: &str,
    credential: &SecretInputV1,
) -> Result<ConsoleEndpointV1, CommandFailure> {
    if environment.trim().is_empty() {
        return Err(CommandFailure::invalid(
            "--environment must name an environment",
        ));
    }
    let credential = read_credential(credential, CONSOLE_CREDENTIAL)?;
    Ok(ConsoleEndpointV1::new(console_url, credential)?.for_environment(environment))
}

/// Opens one restore administration session on the destination.
///
/// Browser approval supplies a destination session. Operators can explicitly
/// exchange a credential read from a file descriptor for the same session type.
fn destination_session(
    transport: &dyn ConsoleTransportV1,
    destination_url: &str,
    bootstrap: &crate::command::RestoreAuthorizationV1,
) -> Result<DestinationSessionV1, CommandFailure> {
    let source = match bootstrap {
        crate::command::RestoreAuthorizationV1::Browser {
            console_url,
            environment,
        } => {
            return browser_restore_session(transport, destination_url, console_url, environment);
        }
        crate::command::RestoreAuthorizationV1::Bootstrap(source) => source,
    };
    let credential = read_credential(source, BOOTSTRAP_CREDENTIAL)?;
    let destination = DestinationBootstrapV1::new(destination_url, credential)?;
    Ok(open_restore_session_v1(transport, &destination)?)
}

fn activation_session(
    transport: &dyn ConsoleTransportV1,
    destination_url: &str,
    bootstrap: &crate::command::RestoreAuthorizationV1,
    session_file: &Path,
) -> Result<DestinationSessionV1, CommandFailure> {
    if session_file
        .try_exists()
        .map_err(|_| CommandFailure::invalid("could not inspect restore session file"))?
    {
        require_private_file_mode_v1(session_file)?;
        let bytes = Zeroizing::new(read_capped_file_v1(session_file, 16 * 1024)?);
        return Ok(DestinationSessionV1::from_checkpoint(
            destination_url,
            &bytes,
        )?);
    }
    let session = destination_session(transport, destination_url, bootstrap)?;
    write_new_file_durably_v1(session_file, &session.checkpoint_bytes()?)?;
    Ok(session)
}

fn read_credential(
    source: &SecretInputV1,
    label: &'static str,
) -> Result<ConsoleCredentialV1, CommandFailure> {
    let secret = read_secret(source, label)?;
    let text = Zeroizing::new(
        String::from_utf8(secret.to_vec())
            .map_err(|_| CommandFailure::invalid(format!("the {label} is not valid UTF-8")))?,
    );
    Ok(ConsoleCredentialV1::new(text.as_str())?)
}

fn restore_result(
    session: &RestoreSessionReportV1,
    role: Option<String>,
    receipt_digest_b64u: Option<String>,
) -> SeamsResultV1 {
    SeamsResultV1::RestoreSession {
        status: session.status.clone(),
        session_id: session.session_id.clone(),
        role,
        receipt_digest_b64u,
        destination_lineage_id: session.destination_lineage_id.clone(),
    }
}

fn decode_fixed<const N: usize>(
    value: &str,
    field: &'static str,
) -> Result<[u8; N], CommandFailure> {
    use base64ct::{Base64UrlUnpadded, Encoding};
    let decoded = Base64UrlUnpadded::decode_vec(value)
        .map_err(|_| CommandFailure::trust(format!("{field} is not canonical base64url")))?;
    decoded
        .try_into()
        .map_err(|_| CommandFailure::trust(format!("{field} has an invalid length")))
}

fn binding_failure(error: router_ab_core::RouterAbDerivationError) -> CommandFailure {
    CommandFailure::trust(error.message().to_owned())
}

fn decode_fingerprint(
    value: &str,
) -> Result<TenantRootRestoreDestinationFingerprintV1, CommandFailure> {
    TenantRootRestoreDestinationFingerprintV1::from_bytes(decode_fixed(
        value,
        "destination fingerprint",
    )?)
    .map_err(binding_failure)
}

fn decode_lineage(value: &str) -> Result<TenantRootCustodyLineageId, CommandFailure> {
    TenantRootCustodyLineageId::from_bytes(decode_fixed(value, "destination lineage")?)
        .map_err(binding_failure)
}

fn decode_session_id(value: &str) -> Result<TenantRootRestoreSessionIdV1, CommandFailure> {
    TenantRootRestoreSessionIdV1::from_bytes(decode_fixed(value, "restore session id")?)
        .map_err(binding_failure)
}

fn decode_import_public_key(
    value: &str,
) -> Result<TenantRootRestoreImportPublicKeyV1, CommandFailure> {
    TenantRootRestoreImportPublicKeyV1::from_bytes(decode_fixed(value, "import public key")?)
        .map_err(binding_failure)
}

fn read_snapshot(path: &Path) -> Result<TenantRootRecoveryRevocationSnapshotV1, CommandFailure> {
    TenantRootRecoveryRevocationSnapshotV1::from_canonical_json(&read_capped_file_v1(
        path,
        TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_MAX_BYTES,
    )?)
    .map_err(|error| CommandFailure::trust(error.message().to_owned()))
}

/// Reads one secret from its dedicated source.
///
/// The descriptor is opened through `/dev/fd`, so no unsafe descriptor
/// adoption is needed. A trailing newline is stripped: an operator piping a
/// secret should not have to strip it themselves. The label names which
/// secret is being read, in the prompt and in every failure, so the operator
/// can never be asked for one secret while the tool expects another.
fn read_secret(
    source: &SecretInputV1,
    label: &'static str,
) -> Result<Zeroizing<Vec<u8>>, CommandFailure> {
    match source {
        SecretInputV1::FileDescriptor(descriptor) => {
            let path = Path::new("/dev/fd").join(descriptor.to_string());
            let mut bytes = read_descriptor(&path, label)?;
            while matches!(bytes.last(), Some(b'\n' | b'\r')) {
                bytes.pop();
            }
            if bytes.is_empty() {
                return Err(CommandFailure::invalid(format!(
                    "the {label} descriptor produced nothing"
                )));
            }
            Ok(bytes)
        }
        SecretInputV1::InteractiveTty => read_from_terminal_without_echo(label),
    }
}

/// Prompts on the controlling terminal with echo disabled.
///
/// Echo is turned off through `stty` on `/dev/tty` and restored on every exit
/// path, including failure. The prompt goes to standard error so `--json`
/// output stays a single machine-readable object on standard output.
///
/// A hard kill between disabling and restoring echo leaves the terminal
/// without echo; `stty sane` recovers it. Avoiding that entirely needs a
/// signal handler this build does not install.
#[cfg(unix)]
pub(crate) fn read_from_terminal_without_echo(
    label: &'static str,
) -> Result<Zeroizing<Vec<u8>>, CommandFailure> {
    use std::io::{BufRead, BufReader, Read, Write};

    let terminal_path = Path::new("/dev/tty");
    let saved = stty(terminal_path, &["-g"])?;
    let saved = saved.trim().to_owned();
    if saved.is_empty() {
        return Err(CommandFailure::invalid(
            "no controlling terminal is available; supply the secret with a file descriptor",
        ));
    }

    stty(terminal_path, &["-echo"])?;
    let read = (|| -> Result<Zeroizing<Vec<u8>>, CommandFailure> {
        let mut error = std::io::stderr();
        let _ = write!(error, "{}: ", capitalize(label));
        let _ = error.flush();
        let terminal = std::fs::File::open(terminal_path).map_err(|error| {
            CommandFailure::invalid(format!("could not read the terminal: {error}"))
        })?;
        let mut line = Zeroizing::new(String::new());
        BufReader::new(terminal)
            .take(u64::try_from(SECRET_MAX_BYTES_V1).unwrap_or(u64::MAX))
            .read_line(&mut line)
            .map_err(|error| {
                CommandFailure::invalid(format!("could not read the terminal: {error}"))
            })?;
        let mut bytes = Zeroizing::new(line.as_bytes().to_vec());
        while matches!(bytes.last(), Some(b'\n' | b'\r')) {
            bytes.pop();
        }
        if bytes.is_empty() && label != "ZIP password (optional; Enter for no encryption)" {
            return Err(CommandFailure::invalid(format!("no {label} was entered")));
        }
        Ok(bytes)
    })();
    // Restore the terminal whether or not the read succeeded.
    let _ = stty(terminal_path, &[saved.as_str()]);
    let _ = std::io::stderr().write_all(b"\n");
    read
}

#[cfg(not(unix))]
pub(crate) fn read_from_terminal_without_echo(
    label: &'static str,
) -> Result<Zeroizing<Vec<u8>>, CommandFailure> {
    Err(CommandFailure::invalid(format!(
        "this platform cannot prompt for the {label} without echoing; \
         supply it with a file descriptor"
    )))
}

fn capitalize(label: &str) -> String {
    let mut characters = label.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}

/// Runs `stty` against the controlling terminal and returns its output.
#[cfg(unix)]
fn stty(terminal_path: &Path, arguments: &[&str]) -> Result<String, CommandFailure> {
    let terminal = std::fs::File::open(terminal_path).map_err(|error| {
        CommandFailure::invalid(format!(
            "no controlling terminal is available: {error}; \
             supply the secret with a file descriptor"
        ))
    })?;
    let output = std::process::Command::new("stty")
        .args(arguments)
        .stdin(std::process::Stdio::from(terminal))
        .output()
        .map_err(|error| {
            CommandFailure::invalid(format!("could not configure the terminal: {error}"))
        })?;
    if !output.status.success() {
        return Err(CommandFailure::invalid(
            "could not configure the terminal for a hidden prompt",
        ));
    }
    String::from_utf8(output.stdout).map_err(|_| {
        CommandFailure::invalid("the terminal returned settings this build cannot restore")
    })
}

/// Reads one secret from a descriptor, refusing one over the size cap.
///
/// One byte past the cap is read so an oversized secret is refused rather
/// than silently truncated into an invalid credential.
fn read_descriptor(path: &Path, label: &'static str) -> Result<Zeroizing<Vec<u8>>, CommandFailure> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|error| {
        CommandFailure::invalid(format!("could not read the {label} descriptor: {error}"))
    })?;
    let mut bytes = Zeroizing::new(Vec::new());
    file.by_ref()
        .take(
            u64::try_from(SECRET_MAX_BYTES_V1)
                .unwrap_or(u64::MAX)
                .saturating_add(1),
        )
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CommandFailure::invalid(format!("could not read the {label} descriptor: {error}"))
        })?;
    if bytes.len() > SECRET_MAX_BYTES_V1 {
        return Err(CommandFailure::invalid(format!(
            "the {label} exceeds {SECRET_MAX_BYTES_V1} bytes"
        )));
    }
    Ok(bytes)
}

fn encode(bytes: &[u8]) -> String {
    use base64ct::{Base64UrlUnpadded, Encoding};
    Base64UrlUnpadded::encode_string(bytes)
}

pub(crate) fn enrollment_field(
    value: &serde_json::Value,
    field: &str,
) -> Result<String, CommandFailure> {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 32768)
        .map(str::to_owned)
        .ok_or_else(|| CommandFailure::invalid("Invalid browser approval response"))
}

fn enrollment_post(
    transport: &dyn ConsoleTransportV1,
    origin: &str,
    action: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, CommandFailure> {
    browser_post(transport, origin, "cli-enrollment", action, body)
}

pub(crate) fn browser_post(
    transport: &dyn ConsoleTransportV1,
    origin: &str,
    flow: &str,
    action: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, CommandFailure> {
    let mut headers = std::collections::BTreeMap::new();
    headers.insert("content-type".to_owned(), "application/json".to_owned());
    let request = crate::transport::ConsoleRequestV1 {
        method: "POST",
        url: format!("{origin}/console/tenant-root/security/{flow}/{action}"),
        headers,
        body: Some(
            serde_json::to_vec(&body)
                .map_err(|_| CommandFailure::invalid("Invalid browser approval request"))?,
        ),
    };
    let mut attempts = 0;
    let response = loop {
        attempts += 1;
        match transport.send(request.clone()) {
            Ok(response) if response.status == 429 || response.status >= 500 => {
                if attempts >= 3 {
                    return Err(CommandFailure::invalid(
                        "Console temporarily unavailable; rerun the same command",
                    ));
                }
            }
            Ok(response) => break response,
            Err(error) => {
                if !error.retryable() || attempts >= 3 {
                    return Err(CommandFailure::invalid(error.message()));
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
    };
    if response.status != 200 {
        return Err(CommandFailure::invalid(format!(
            "Console refused browser approval ({}); check the dashboard configuration and rerun the same command",
            response.status
        )));
    }
    let parsed: serde_json::Value = serde_json::from_slice(&response.body)
        .map_err(|_| CommandFailure::invalid("Invalid browser approval response"))?;
    if parsed.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
        return Err(CommandFailure::invalid("Browser approval was refused"));
    }
    Ok(parsed)
}

pub(crate) fn enrollment_origin(value: &str, dashboard: bool) -> Result<String, CommandFailure> {
    let parsed: ureq::http::Uri = value
        .parse()
        .map_err(|_| CommandFailure::invalid("Invalid enrollment origin"))?;
    if !(parsed.scheme_str() == Some("https")
        || (dashboard
            && parsed.scheme_str() == Some("http")
            && matches!(parsed.host(), Some("localhost" | "127.0.0.1"))))
        || parsed.authority().is_none()
        || parsed.authority().is_some_and(|a| a.as_str().contains('@'))
        || parsed.path_and_query().is_some_and(|p| p.as_str() != "/")
    {
        return Err(CommandFailure::invalid("Use an HTTPS console origin"));
    }
    Ok(value.trim_end_matches('/').to_owned())
}

fn run_browser_enrollment(
    transport: &dyn ConsoleTransportV1,
    console_url: &str,
    environment: &str,
    role: router_ab_core::TwoPartyDeriverRole,
    key_file: Option<&Path>,
) -> Result<SeamsResultV1, CommandFailure> {
    let origin = enrollment_origin(console_url, false)?;
    let dashboard =
        crate::deployment::dashboard_origin(transport, &origin).map_err(CommandFailure::invalid)?;
    let trust =
        crate::deployment::fetch_trust(transport, &origin).map_err(CommandFailure::trust)?;
    let path = match key_file {
        Some(path) => path.to_path_buf(),
        None => std::path::PathBuf::from(match role {
            router_ab_core::TwoPartyDeriverRole::DeriverA => "./deriver-a-wrapper.key",
            router_ab_core::TwoPartyDeriverRole::DeriverB => "./deriver-b-wrapper.key",
        }),
    };
    if path.as_os_str().is_empty() {
        return Err(CommandFailure::invalid("Key path is required"));
    }
    if path.exists()
        && read_terminal_text("File exists. Type reuse to enroll this saved key")? != "reuse"
    {
        return Err(CommandFailure::invalid("Existing file left unchanged"));
    }
    let creating = !path.exists();
    if creating {
        let (file, _) = RecoveryKeyFileV1::create(role, &mut UnwrapErr(OsRng))?;
        write_new_file_durably_v1(&path, &file.to_bytes()?)?;
    }
    let saved_key = RecoveryKeyFileV1::decode(&Zeroizing::new(read_capped_file_v1(
        &path,
        RECOVERY_KEY_FILE_MAX_BYTES,
    )?))?;
    if saved_key.role() != role {
        return Err(CommandFailure::invalid(
            "Existing key belongs to the other role",
        ));
    }
    let material = saved_key.open()?;
    let public_key = encode(material.public_key().as_bytes());
    eprintln!(
        "Wrapper key saved: {}. Keep it private. Run the dashboard’s recovery kit command from this folder to save your complete backup.",
        path.display()
    );
    let start = enrollment_post(
        transport,
        &origin,
        "start",
        serde_json::json!({"environmentId":environment,"role":role.as_str(),"publicKeyB64u":public_key}),
    )?;
    let id = enrollment_field(&start, "id")?;
    if id.len() != 22
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(CommandFailure::invalid("Invalid enrollment identifier"));
    }
    let polling_secret = Zeroizing::new(enrollment_field(&start, "pollingSecret")?);
    let approval_url = format!("{dashboard}/dashboard/derivation-root?cliEnrollment={id}");
    eprintln!(
        "Approve wrapper key enrollment in your browser. Compare code: {}",
        id[..8].to_uppercase()
    );
    eprintln!("{approval_url}");
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open")
        .arg(&approval_url)
        .status();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open")
        .arg(&approval_url)
        .status();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let result = enrollment_post(
            transport,
            &origin,
            "poll",
            serde_json::json!({"id":id,"pollingSecret":polling_secret.as_str()}),
        )?;
        match enrollment_field(&result, "state")?.as_str() {
            "pending" => continue,
            "approved" => {
                let challenge_id = enrollment_field(&result, "challengeIdB64u")?;
                let envelope = enrollment_field(&result, "envelopeB64u")?;
                use base64ct::{Base64UrlUnpadded, Encoding};
                let envelope = Base64UrlUnpadded::decode_vec(&envelope)
                    .map_err(|_| CommandFailure::invalid("Invalid challenge encoding"))?;
                let proof = prove_recovery_recipient_control_from_bytes_v1(&path, role, &envelope)?;
                if proof.challenge_id_b64u != challenge_id {
                    return Err(CommandFailure::invalid("Enrollment challenge mismatch"));
                }
                std::thread::sleep(std::time::Duration::from_secs(3));
                let completed = enrollment_post(
                    transport,
                    &origin,
                    "confirm",
                    serde_json::json!({"id":id,"pollingSecret":polling_secret.as_str(),"confirmationB64u":proof.confirmation_b64u}),
                )?;
                let recipient = completed
                    .get("recipient")
                    .ok_or_else(|| CommandFailure::invalid("Missing enrolled key"))?;
                if enrollment_field(recipient, "recipientPublicKeyB64u")? != public_key
                    || enrollment_field(recipient, "role")? != role.as_str()
                {
                    return Err(CommandFailure::invalid("Enrolled key mismatch"));
                }
                let identity = enrollment_field(&completed, "identityDigestB64u")?;
                crate::deployment::save_trust(&origin, &identity, &trust)
                    .map_err(CommandFailure::trust)?;
                return Ok(SeamsResultV1::RecipientEnrolled {
                    role: role.as_str().to_owned(),
                    environment: environment.to_owned(),
                    public_key_b64u: public_key,
                    fingerprint_b64u: proof.fingerprint_b64u,
                    challenge_id_b64u: challenge_id,
                });
            }
            "denied" | "expired" => {
                return Err(CommandFailure::invalid(
                    "Browser approval denied or expired. Retry using the saved key",
                ))
            }
            _ => return Err(CommandFailure::invalid("Unexpected enrollment state")),
        }
    }
    Err(CommandFailure::invalid(
        "Browser approval expired. Retry using the saved key",
    ))
}

fn read_terminal_text(label: &str) -> Result<String, CommandFailure> {
    use std::io::{BufRead, BufReader, Read, Write};
    eprint!("{label}: ");
    let _ = std::io::stderr().flush();
    let terminal = std::fs::File::open("/dev/tty")
        .map_err(|_| CommandFailure::invalid("An interactive terminal is required"))?;
    let mut value = String::new();
    BufReader::new(terminal)
        .take(4096)
        .read_line(&mut value)
        .map_err(|_| CommandFailure::invalid("Cannot read terminal"))?;
    Ok(value.trim().to_owned())
}

fn import_holder_share(
    transport: &dyn ConsoleTransportV1,
    session: &DestinationSessionV1,
    operation_id: &str,
    role: &router_ab_core::TwoPartyDeriverRole,
    package: &Path,
    key_file: &Path,
    manifest: &Path,
    envelope_file: &Path,
    bundle: &TenantRootRecoveryTrustBundleV1,

    capabilities: RecoveryHostSecretCapabilitiesV1,
) -> Result<SeamsResultV1, CommandFailure> {
    let key = issue_role_import_key_v1(transport, &session, role.as_str(), operation_id)?;
    let binding = RestoreDestinationBindingV1 {
        destination_fingerprint: decode_fingerprint(&key.destination_fingerprint_b64u)?,
        destination_lineage: decode_lineage(&key.destination_lineage_b64u)?,
        restore_session_id: decode_session_id(&key.restore_session_id_b64u)?,
        import_key_id: key.import_key_id.clone(),
        import_public_key: decode_import_public_key(&key.import_public_key_b64u)?,
        issued_at_ms: key.issued_at_ms,
        expires_at_ms: key.expires_at_ms,
    };

    let envelope_bytes = if restore_envelope_exists_v1(envelope_file)? {
        read_saved_restore_envelope_v1(envelope_file, manifest, package, *role, bundle, &binding)?
    } else {
        warn_about_host_capabilities(capabilities);

        // The opened share exists only between here and the reseal; it
        // is never returned, written, or logged. The opaque envelope
        // is made durable before the network import begins.
        let resealed = open_and_reseal_role_share_v1(
            manifest,
            package,
            key_file,
            *role,
            bundle,
            &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
            &binding,
            &mut UnwrapErr(OsRng),
        )?;
        let envelope_bytes = resealed.envelope_bytes().to_owned();
        write_new_file_durably_v1(envelope_file, &envelope_bytes)?;
        envelope_bytes
    };

    let imported = import_role_share_v1(transport, &session, role.as_str(), &envelope_bytes)?;
    Ok(restore_result(
        &imported.session,
        Some(role.as_str().to_owned()),
        Some(imported.receipt_digest_b64u),
    ))
}

fn browser_restore_session(
    transport: &dyn ConsoleTransportV1,
    destination: &str,
    console_url: &str,
    environment: &str,
) -> Result<DestinationSessionV1, CommandFailure> {
    let origin = enrollment_origin(console_url, false)?;
    let dashboard =
        crate::deployment::dashboard_origin(transport, &origin).map_err(CommandFailure::invalid)?;
    let destination = enrollment_origin(destination, false)?;
    let start = browser_post(
        transport,
        &origin,
        "restore-access",
        "start",
        serde_json::json!({"environmentId": environment, "destination": destination}),
    )?;
    let id = enrollment_field(&start, "id")?;
    decode_fixed::<16>(&id, "approval request id")?;
    let secret = Zeroizing::new(enrollment_field(&start, "pollingSecret")?);
    decode_fixed::<32>(&secret, "approval polling secret")?;
    let url = format!("{dashboard}/dashboard/derivation-root?cliRestore={id}");
    eprintln!(
        "Approve restore access in your browser. Compare code: {}\nDestination: {}\n{}",
        id[..8].to_uppercase(),
        destination,
        url
    );
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&url).status();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let result = browser_post(
            transport,
            &origin,
            "restore-access",
            "poll",
            serde_json::json!({"id":id, "pollingSecret":secret.as_str()}),
        )?;
        match enrollment_field(&result, "state")?.as_str() {
            "pending" => continue,
            "approved" => {
                let session = result
                    .get("session")
                    .ok_or_else(|| CommandFailure::invalid("Missing approved restore session"))?;
                let bytes = Zeroizing::new(
                    serde_json::to_vec(session)
                        .map_err(|_| CommandFailure::invalid("Invalid restore session"))?,
                );
                return Ok(DestinationSessionV1::from_checkpoint(&destination, &bytes)?);
            }
            "denied" | "expired" => {
                return Err(CommandFailure::invalid(
                    "Restore approval denied or expired. Run the command again to request access.",
                ))
            }
            _ => return Err(CommandFailure::invalid("Invalid restore approval state")),
        }
    }
    Err(CommandFailure::invalid(
        "Restore approval expired. Run the command again.",
    ))
}
