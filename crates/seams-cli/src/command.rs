//! The exact parsed command union.
//!
//! Role-local commands carry exactly one role and one file for that role. The
//! other role's fields are not representable in the branch, so no invocation
//! can be constructed that handles both recovery keys at once.
//!
//! Credentials are read from a dedicated descriptor or an interactive terminal.
//! Private recovery key files are read directly; storage protection belongs to the tenant.
//!
//! Trust is never a command-line value either. `--trust-bundle` names a
//! bundle that must continue the root compiled into this binary; it cannot
//! introduce one.

use router_ab_core::TwoPartyDeriverRole;
use std::path::PathBuf;

/// Encrypted packages to verify; private recovery keys are never read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackupPackagesV1 {
    /// Verify the standard Deriver A and B files in the working directory.
    Both,
    /// Verify one explicitly selected role.
    Single {
        /// The expected package role.
        role: TwoPartyDeriverRole,
        /// The encrypted package path.
        package: PathBuf,
    },
}

/// Where a destination or console credential is read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretInputV1 {
    /// A file descriptor the caller opened for this purpose.
    FileDescriptor(u16),
    /// An interactive terminal prompt.
    InteractiveTty,
}

/// How a restore obtains its destination-bound administration session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RestoreAuthorizationV1 {
    /// Explicit operator automation input.
    Bootstrap(SecretInputV1),
    /// Tenant approval through the authenticated console.
    Browser {
        /// Console origin managing recovery access.
        console_url: String,
        /// Expected environment, checked against the approving session.
        environment: String,
    },
}

/// Trust evidence the caller supplied for one verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrustEvidenceSourceV1 {
    /// Only the trusted authority bundle; revocation state is unknown.
    OfflineRootsOnly,
    /// A saved signed revocation snapshot.
    TrustSnapshot(PathBuf),
}

/// One exact `seams` invocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeamsCommandV1 {
    /// Connect this backup to its console's HTTPS-authenticated recovery authority.
    TrustConnect {
        /// Console HTTPS origin.
        console_url: String,
        /// Backup manifest whose identity is being connected.
        manifest: PathBuf,
    },
    /// Create or reuse a local key and enroll it after browser approval.
    RecoveryKeySetup {
        /// Trusted Console API origin.
        console_url: String,
        /// Expected environment.
        environment: String,
        /// Recovery key role.
        role: TwoPartyDeriverRole,
        /// Optional wrapper-key output path; defaults to the role-specific filename.
        key_file: Option<PathBuf>,
    },
    /// Create one local recovery key file for one role.
    RecoveryKeyCreate {
        /// The single role this key serves.
        role: TwoPartyDeriverRole,
        /// Where the new key file is written. It is never overwritten.
        key_file: PathBuf,
    },
    /// Prove control of one role's recovery key to the console and enrol it.
    RecoveryKeyEnroll {
        /// The console base URL.
        console_url: String,
        /// The environment this enrolment must act on.
        environment: String,
        /// The single role being enrolled.
        role: TwoPartyDeriverRole,
        /// That role's local recovery key file.
        key_file: PathBuf,

        /// Where the console credential is read from.
        credential: SecretInputV1,
    },
    /// Verify one role package against its manifest and deployment trust, offline.
    BackupVerify {
        /// The signed public manifest.
        manifest: PathBuf,
        /// Verify both standard files, or one explicitly selected role.
        packages: BackupPackagesV1,
        /// A bundle continuing the pinned root, when the pinned one is stale.
        trust_bundle: Option<PathBuf>,
        /// Revocation evidence, when the caller has any.
        trust: TrustEvidenceSourceV1,
    },
    /// Download and verify a complete recovery kit after browser approval.
    BackupKit {
        /// A single holder, or both when omitted.
        role: Option<TwoPartyDeriverRole>,
        /// Console HTTPS origin.
        console_url: String,
        /// Selected environment.
        environment: String,
        /// Exact recovery set to download.
        recovery_set: String,
        /// Deriver A private key on this computer.
        key_a: PathBuf,
        /// Deriver B private key on this computer.
        key_b: PathBuf,
        /// New ZIP path.
        output: PathBuf,
    },
    /// Check that one holder's saved key decrypts their backup.
    BackupCheck {
        /// Manifest in the extracted kit.
        manifest: PathBuf,
        /// Holder role.
        role: TwoPartyDeriverRole,
        /// Encrypted package.
        package: PathBuf,
        /// Saved key.
        key_file: PathBuf,
    },
    /// Read the derivation-root status for the selected environment.
    Status {
        /// The console base URL.
        console_url: String,
        /// The environment this command must act on.
        environment: String,
        /// Where the console credential is read from.
        credential: SecretInputV1,
    },
    /// Start one operational-share rotation.
    Rotate {
        /// The console base URL.
        console_url: String,
        /// The environment this command must act on.
        environment: String,
        /// Where the console credential is read from.
        credential: SecretInputV1,
        /// The caller's idempotency key; repeating it returns the same job.
        idempotency_key: String,
    },
    /// Read the state of the rotation job.
    RotationStatus {
        /// The console base URL.
        console_url: String,
        /// The environment this command must act on.
        environment: String,
        /// Where the console credential is read from.
        credential: SecretInputV1,
        /// The job the caller is asking about.
        job: String,
    },
    /// Download one role's encrypted recovery package.
    BackupDownload {
        /// The console base URL.
        console_url: String,
        /// The environment this command must act on.
        environment: String,
        /// The single role being downloaded.
        role: TwoPartyDeriverRole,
        /// Where the package is written. It is never overwritten.
        output: PathBuf,
        /// The signed public manifest to verify the package against.
        manifest: PathBuf,
        /// A bundle continuing the pinned root, when the pinned one is stale.
        trust_bundle: Option<PathBuf>,
        /// Where the console credential is read from.
        credential: SecretInputV1,
    },
    /// Download the public recovery manifest, without either role package.
    ManifestDownload {
        /// The console base URL.
        console_url: String,
        /// The environment this command must act on.
        environment: String,
        /// Where the manifest is written. It is never overwritten.
        output: PathBuf,
        /// Where the console credential is read from.
        credential: SecretInputV1,
    },
    /// Register or resume a backup and import one holder's share.
    Restore {
        /// The empty destination deployment API.
        destination_url: String,
        /// The holder participating in recovery.
        role: TwoPartyDeriverRole,
        /// Directory containing the manifest, package, and private retry files.
        folder: PathBuf,
        /// The holder’s recovery key.
        key_file: PathBuf,
        /// Optional continuation of the pinned trust bundle.
        trust_bundle: Option<PathBuf>,

        /// Destination authentication input.
        bootstrap: RestoreAuthorizationV1,
    },
    /// Start one restore session on an empty destination.
    RestoreStart {
        /// The destination deployment URL.
        destination_url: String,
        /// The signed public manifest to register.
        manifest: PathBuf,
        /// Browser approval or an explicitly supplied operator credential.
        bootstrap: RestoreAuthorizationV1,
    },
    /// Open one role package and reseal its share to the destination.
    RestoreShare {
        /// The destination deployment URL.
        destination_url: String,
        /// The caller's durable restore operation ID; retries reuse this ID.
        operation_id: String,
        /// The single role being restored.
        role: TwoPartyDeriverRole,
        /// That role's encrypted package.
        package: PathBuf,
        /// That role's local recovery key file.
        key_file: PathBuf,
        /// The signed public manifest.
        manifest: PathBuf,
        /// Where the destination-encrypted import envelope is saved for retry.
        envelope_file: PathBuf,
        /// A bundle continuing the pinned root, when the pinned one is stale.
        trust_bundle: Option<PathBuf>,

        /// Browser approval or an explicitly supplied operator credential.
        bootstrap: RestoreAuthorizationV1,
    },
    /// Read the state of the destination's restore session.
    RestoreStatus {
        /// The destination deployment URL.
        destination_url: String,
        /// Browser approval or an explicitly supplied operator credential.
        bootstrap: RestoreAuthorizationV1,
    },
    /// Verify, forward-refresh, and activate the restored root.
    RestoreActivate {
        /// The destination deployment URL.
        destination_url: String,
        /// Whether the operator accepts activating on offline verification alone.
        acknowledge_offline_trust: bool,
        /// Browser approval or an explicitly supplied operator credential.
        bootstrap: RestoreAuthorizationV1,
        /// Private administration-session file, created before activation and reused on retry.
        session_file: PathBuf,
    },
    /// Show the trust bundle this binary verifies with.
    TrustShow {
        /// A bundle continuing the pinned root, to show instead.
        trust_bundle: Option<PathBuf>,
    },
    /// Install a bundle that continues the pinned root, for later use.
    TrustUpdate {
        /// The candidate bundle.
        bundle: PathBuf,
        /// Where the accepted bundle is written. It is never overwritten.
        output: PathBuf,
    },
    /// Verify one release artifact against its signed checksum manifest.
    ReleaseVerify {
        /// The signed release checksum manifest.
        manifest: PathBuf,
        /// The downloaded artifact.
        artifact: PathBuf,
    },
    /// Print usage.
    Help {
        /// Validated command help.
        text: &'static str,
    },
    /// Print the build version.
    Version,
}

/// Why one invocation could not be parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandParseErrorV1 {
    message: String,
}

impl CommandParseErrorV1 {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// Returns the operator-facing message.
    pub fn message(&self) -> &str {
        &self.message
    }
}

/// One parsed invocation and its output mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedInvocationV1 {
    /// The exact command.
    pub command: SeamsCommandV1,
    /// Whether results are machine-readable.
    pub json: bool,
}

/// Parses one argument list, excluding the program name.
pub fn parse_invocation_v1(args: &[String]) -> Result<ParsedInvocationV1, CommandParseErrorV1> {
    let mut positional: Vec<&str> = Vec::new();
    let mut options: Vec<(&str, Option<&str>)> = Vec::new();
    let mut json = false;
    let mut help = false;

    let mut index = 0;
    while index < args.len() {
        let argument = args[index].as_str();
        if let Some(name) = argument.strip_prefix("--") {
            if name == "help" {
                help = true;
                index += 1;
                continue;
            }
            if name == "json" {
                json = true;
                index += 1;
                continue;
            }
            if name.contains('=') {
                return Err(CommandParseErrorV1::new(format!(
                    "--{name} must be given as a separate value, not with '='"
                )));
            }
            let value = args.get(index + 1).map(String::as_str);
            let value = value.filter(|value| !value.starts_with("--"));
            options.push((name, value));
            index += if value.is_some() { 2 } else { 1 };
            continue;
        }
        positional.push(argument);
        index += 1;
    }

    let help_path = if positional.first() == Some(&"help") {
        Some(&positional[1..])
    } else if help || positional.is_empty() {
        Some(positional.as_slice())
    } else {
        None
    };
    let command = if let Some(path) = help_path {
        reject_unknown(&options, &[])?;
        let text = crate::help::help_text(path).ok_or_else(|| {
            CommandParseErrorV1::new("unknown help topic; run 'seams-wallet help'")
        })?;
        SeamsCommandV1::Help { text }
    } else {
        parse_command(&positional, &options)?
    };
    Ok(ParsedInvocationV1 { command, json })
}

fn parse_command(
    positional: &[&str],
    options: &[(&str, Option<&str>)],
) -> Result<SeamsCommandV1, CommandParseErrorV1> {
    match positional {
        ["version"] => Ok(SeamsCommandV1::Version),
        ["derivation-root", "recovery-key", "setup"] => {
            reject_unknown(
                options,
                &["console-url", "environment", "role", "wrapping-key-file"],
            )?;
            Ok(SeamsCommandV1::RecoveryKeySetup {
                console_url: require(options, "console-url")?.to_owned(),
                environment: require(options, "environment")?.to_owned(),
                role: parse_role(require(options, "role")?)?,
                key_file: find(options, "wrapping-key-file").map(PathBuf::from),
            })
        }
        ["derivation-root", "recovery-key", "create"] => {
            reject_unknown(options, &["role", "wrapping-key-file"])?;
            Ok(SeamsCommandV1::RecoveryKeyCreate {
                role: parse_role(require(options, "role")?)?,
                key_file: PathBuf::from(require(options, "wrapping-key-file")?),
            })
        }
        ["derivation-root", "recovery-key", "enroll"] => {
            reject_unknown(
                options,
                &[
                    "console-url",
                    "environment",
                    "role",
                    "wrapping-key-file",
                    "credential-fd",
                ],
            )?;
            Ok(SeamsCommandV1::RecoveryKeyEnroll {
                console_url: require(options, "console-url")?.to_owned(),
                environment: require(options, "environment")?.to_owned(),
                role: parse_role(require(options, "role")?)?,
                key_file: PathBuf::from(require(options, "wrapping-key-file")?),

                credential: parse_descriptor(options, "credential-fd")?,
            })
        }
        ["derivation-root", "backup", "kit"] => {
            reject_unknown(
                options,
                &[
                    "console-url",
                    "environment",
                    "recovery-set",
                    "key-a",
                    "key-b",
                    "output",
                    "role",
                ],
            )?;
            Ok(SeamsCommandV1::BackupKit {
                role: find(options, "role").map(parse_role).transpose()?,
                console_url: require(options, "console-url")?.to_owned(),
                environment: require(options, "environment")?.to_owned(),
                recovery_set: require(options, "recovery-set")?.to_owned(),
                key_a: PathBuf::from(find(options, "key-a").unwrap_or("./deriver-a-wrapper.key")),
                key_b: PathBuf::from(find(options, "key-b").unwrap_or("./deriver-b-wrapper.key")),
                output: PathBuf::from(find(options, "output").unwrap_or("./seams-recovery.zip")),
            })
        }
        ["derivation-root", "backup", "check"] => {
            reject_unknown(
                options,
                &["role", "manifest", "package", "wrapping-key-file"],
            )?;
            let role = parse_role(require(options, "role")?)?;
            let name = match role {
                TwoPartyDeriverRole::DeriverA => "deriver-a",
                TwoPartyDeriverRole::DeriverB => "deriver-b",
            };
            Ok(SeamsCommandV1::BackupCheck {
                manifest: PathBuf::from(find(options, "manifest").unwrap_or("./manifest.json")),
                role,
                package: find(options, "package")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from(format!("./{name}.backup"))),
                key_file: find(options, "wrapping-key-file")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from(format!("./{name}-wrapper.key"))),
            })
        }
        ["derivation-root", "backup", "verify"] => {
            reject_unknown(
                options,
                &[
                    "manifest",
                    "role",
                    "package",
                    "trust-bundle",
                    "trust-snapshot",
                ],
            )?;
            Ok(SeamsCommandV1::BackupVerify {
                manifest: PathBuf::from(find(options, "manifest").unwrap_or("./manifest.json")),
                packages: match find(options, "role") {
                    Some(value) => {
                        let role = parse_role(value)?;
                        let default = match role {
                            TwoPartyDeriverRole::DeriverA => "./deriver-a.backup",
                            TwoPartyDeriverRole::DeriverB => "./deriver-b.backup",
                        };
                        BackupPackagesV1::Single {
                            role,
                            package: PathBuf::from(find(options, "package").unwrap_or(default)),
                        }
                    }
                    None => {
                        if find(options, "package").is_some() {
                            return Err(CommandParseErrorV1 {
                                message: "--package requires --role".to_owned(),
                            });
                        }
                        BackupPackagesV1::Both
                    }
                },
                trust_bundle: find(options, "trust-bundle").map(PathBuf::from),
                trust: match find(options, "trust-snapshot") {
                    Some(path) => TrustEvidenceSourceV1::TrustSnapshot(PathBuf::from(path)),
                    None => TrustEvidenceSourceV1::OfflineRootsOnly,
                },
            })
        }
        ["derivation-root", "status"] => {
            reject_unknown(options, &["console-url", "environment", "credential-fd"])?;
            Ok(SeamsCommandV1::Status {
                console_url: require(options, "console-url")?.to_owned(),
                environment: require(options, "environment")?.to_owned(),
                credential: parse_descriptor(options, "credential-fd")?,
            })
        }
        ["derivation-root", "rotate"] => {
            reject_unknown(
                options,
                &[
                    "console-url",
                    "environment",
                    "credential-fd",
                    "idempotency-key",
                ],
            )?;
            Ok(SeamsCommandV1::Rotate {
                console_url: require(options, "console-url")?.to_owned(),
                environment: require(options, "environment")?.to_owned(),
                credential: parse_descriptor(options, "credential-fd")?,
                idempotency_key: require(options, "idempotency-key")?.to_owned(),
            })
        }
        ["derivation-root", "rotation", "status"] => {
            reject_unknown(
                options,
                &["console-url", "environment", "credential-fd", "job"],
            )?;
            Ok(SeamsCommandV1::RotationStatus {
                console_url: require(options, "console-url")?.to_owned(),
                environment: require(options, "environment")?.to_owned(),
                credential: parse_descriptor(options, "credential-fd")?,
                job: require(options, "job")?.to_owned(),
            })
        }
        ["derivation-root", "backup", "download"] => {
            reject_unknown(
                options,
                &[
                    "console-url",
                    "environment",
                    "role",
                    "output",
                    "manifest",
                    "trust-bundle",
                    "credential-fd",
                ],
            )?;
            Ok(SeamsCommandV1::BackupDownload {
                console_url: require(options, "console-url")?.to_owned(),
                environment: require(options, "environment")?.to_owned(),
                role: parse_role(require(options, "role")?)?,
                output: PathBuf::from(require(options, "output")?),
                manifest: PathBuf::from(require(options, "manifest")?),
                trust_bundle: find(options, "trust-bundle").map(PathBuf::from),
                credential: parse_descriptor(options, "credential-fd")?,
            })
        }
        ["derivation-root", "backup", "manifest", "download"] => {
            reject_unknown(
                options,
                &["console-url", "environment", "output", "credential-fd"],
            )?;
            Ok(SeamsCommandV1::ManifestDownload {
                console_url: require(options, "console-url")?.to_owned(),
                environment: require(options, "environment")?.to_owned(),
                output: PathBuf::from(require(options, "output")?),
                credential: parse_descriptor(options, "credential-fd")?,
            })
        }
        ["derivation-root", "restore"] => {
            reject_unknown(
                options,
                &[
                    "destination",
                    "role",
                    "folder",
                    "wrapping-key-file",
                    "trust-bundle",
                    "bootstrap-fd",
                    "console-url",
                    "environment",
                ],
            )?;
            let folder = PathBuf::from(find(options, "folder").unwrap_or("."));
            let role = parse_role(require(options, "role")?)?;
            let default_key = match role {
                TwoPartyDeriverRole::DeriverA => "deriver-a-wrapper.key",
                TwoPartyDeriverRole::DeriverB => "deriver-b-wrapper.key",
            };
            let key_file = find(options, "wrapping-key-file")
                .map(PathBuf::from)
                .unwrap_or_else(|| folder.join(default_key));
            Ok(SeamsCommandV1::Restore {
                destination_url: require(options, "destination")?.to_owned(),
                role,
                folder,
                key_file,
                trust_bundle: find(options, "trust-bundle").map(PathBuf::from),

                bootstrap: parse_restore_authorization(options)?,
            })
        }
        ["derivation-root", "restore", "start"] => {
            reject_unknown(
                options,
                &[
                    "destination",
                    "manifest",
                    "bootstrap-fd",
                    "console-url",
                    "environment",
                ],
            )?;
            Ok(SeamsCommandV1::RestoreStart {
                destination_url: require(options, "destination")?.to_owned(),
                manifest: PathBuf::from(require(options, "manifest")?),
                bootstrap: parse_restore_authorization(options)?,
            })
        }
        ["derivation-root", "restore", "share"] => {
            reject_unknown(
                options,
                &[
                    "destination",
                    "operation-id",
                    "role",
                    "package",
                    "wrapping-key-file",
                    "manifest",
                    "envelope-file",
                    "trust-bundle",
                    "bootstrap-fd",
                    "console-url",
                    "environment",
                ],
            )?;
            Ok(SeamsCommandV1::RestoreShare {
                destination_url: require(options, "destination")?.to_owned(),
                operation_id: require(options, "operation-id")?.to_owned(),
                role: parse_role(require(options, "role")?)?,
                package: PathBuf::from(require(options, "package")?),
                key_file: PathBuf::from(require(options, "wrapping-key-file")?),
                manifest: PathBuf::from(require(options, "manifest")?),
                envelope_file: PathBuf::from(require(options, "envelope-file")?),
                trust_bundle: find(options, "trust-bundle").map(PathBuf::from),

                bootstrap: parse_restore_authorization(options)?,
            })
        }
        ["derivation-root", "restore", "status"] => {
            reject_unknown(
                options,
                &["destination", "bootstrap-fd", "console-url", "environment"],
            )?;
            Ok(SeamsCommandV1::RestoreStatus {
                destination_url: require(options, "destination")?.to_owned(),
                bootstrap: parse_restore_authorization(options)?,
            })
        }
        ["derivation-root", "restore", "activate"] => {
            reject_unknown(
                options,
                &[
                    "destination",
                    "acknowledge-offline-trust",
                    "bootstrap-fd",
                    "console-url",
                    "environment",
                    "session-file",
                ],
            )?;
            Ok(SeamsCommandV1::RestoreActivate {
                destination_url: require(options, "destination")?.to_owned(),
                acknowledge_offline_trust: flag(options, "acknowledge-offline-trust")?,
                bootstrap: parse_restore_authorization(options)?,
                session_file: PathBuf::from(require(options, "session-file")?),
            })
        }
        ["derivation-root", "trust", "connect"] => {
            reject_unknown(options, &["console-url", "manifest"])?;
            Ok(SeamsCommandV1::TrustConnect {
                console_url: require(options, "console-url")?.to_owned(),
                manifest: PathBuf::from(find(options, "manifest").unwrap_or("./manifest.json")),
            })
        }
        ["derivation-root", "trust", "show"] => {
            reject_unknown(options, &["trust-bundle"])?;
            Ok(SeamsCommandV1::TrustShow {
                trust_bundle: find(options, "trust-bundle").map(PathBuf::from),
            })
        }
        ["derivation-root", "trust", "update"] => {
            reject_unknown(options, &["bundle", "output"])?;
            Ok(SeamsCommandV1::TrustUpdate {
                bundle: PathBuf::from(require(options, "bundle")?),
                output: PathBuf::from(require(options, "output")?),
            })
        }
        ["release", "verify"] => {
            reject_unknown(options, &["manifest", "artifact"])?;
            Ok(SeamsCommandV1::ReleaseVerify {
                manifest: PathBuf::from(require(options, "manifest")?),
                artifact: PathBuf::from(require(options, "artifact")?),
            })
        }
        _ => Err(CommandParseErrorV1::new(format!(
            "unknown command '{}'; run 'seams help'",
            positional.join(" ")
        ))),
    }
}

fn parse_role(value: &str) -> Result<TwoPartyDeriverRole, CommandParseErrorV1> {
    match value {
        "deriver-a" => Ok(TwoPartyDeriverRole::DeriverA),
        "deriver-b" => Ok(TwoPartyDeriverRole::DeriverB),
        _ => Err(CommandParseErrorV1::new(
            "--role must be 'deriver-a' or 'deriver-b'",
        )),
    }
}

/// Parses one dedicated-descriptor option.
///
/// Secrets never arrive as argument values, and descriptors 0, 1, and 2 are
/// shared with protocol data and diagnostics rather than dedicated to one
/// secret.
fn parse_descriptor(
    options: &[(&str, Option<&str>)],
    name: &'static str,
) -> Result<SecretInputV1, CommandParseErrorV1> {
    let Some(value) = find(options, name) else {
        return Ok(SecretInputV1::InteractiveTty);
    };
    let descriptor: u16 = value.parse().map_err(|_| {
        CommandParseErrorV1::new(format!("--{name} must be a file descriptor number"))
    })?;
    if descriptor <= 2 {
        return Err(CommandParseErrorV1::new(format!(
            "--{name} must be a dedicated descriptor, not standard input or output"
        )));
    }
    Ok(SecretInputV1::FileDescriptor(descriptor))
}

/// Parses one boolean flag, which takes no value.
fn flag(options: &[(&str, Option<&str>)], name: &'static str) -> Result<bool, CommandParseErrorV1> {
    match options.iter().find(|(option, _)| *option == name) {
        None => Ok(false),
        Some((_, None)) => Ok(true),
        Some((_, Some(_))) => Err(CommandParseErrorV1::new(format!("--{name} takes no value"))),
    }
}

fn require<'a>(
    options: &[(&'a str, Option<&'a str>)],
    name: &str,
) -> Result<&'a str, CommandParseErrorV1> {
    find(options, name).ok_or_else(|| CommandParseErrorV1::new(format!("--{name} is required")))
}

fn find<'a>(options: &[(&'a str, Option<&'a str>)], name: &str) -> Option<&'a str> {
    options
        .iter()
        .find(|(option, _)| *option == name)
        .and_then(|(_, value)| *value)
}

fn reject_unknown(
    options: &[(&str, Option<&str>)],
    allowed: &[&str],
) -> Result<(), CommandParseErrorV1> {
    for (name, _) in options {
        // Checked before the allowed-list so the operator is told *why*, not
        // merely that the option is unknown.

        if *name == "credential"
            || *name == "token"
            || *name == "console-token"
            || *name == "bootstrap"
        {
            return Err(CommandParseErrorV1::new(
                "a console credential is never accepted as a command-line value",
            ));
        }
        if *name == "trust-root" || *name == "root-key" {
            return Err(CommandParseErrorV1::new(
                "a trust root is never accepted as a command-line value; \
                 only a bundle that continues the pinned root is",
            ));
        }
        if !allowed.contains(name) {
            return Err(CommandParseErrorV1::new(format!(
                "--{name} is not an option of this command"
            )));
        }
    }
    let mut seen: Vec<&str> = Vec::new();
    for (name, _) in options {
        if seen.contains(name) {
            return Err(CommandParseErrorV1::new(format!(
                "--{name} was given more than once"
            )));
        }
        seen.push(name);
    }
    Ok(())
}

fn parse_restore_authorization(
    options: &[(&str, Option<&str>)],
) -> Result<RestoreAuthorizationV1, CommandParseErrorV1> {
    if find(options, "bootstrap-fd").is_some() {
        if ["console-url", "environment"]
            .iter()
            .any(|key| find(options, key).is_some())
        {
            return Err(CommandParseErrorV1::new(
                "Choose browser approval or operator credential input",
            ));
        }
        return Ok(RestoreAuthorizationV1::Bootstrap(parse_descriptor(
            options,
            "bootstrap-fd",
        )?));
    }
    Ok(RestoreAuthorizationV1::Browser {
        console_url: require(options, "console-url")?.to_owned(),
        environment: require(options, "environment")?.to_owned(),
    })
}
