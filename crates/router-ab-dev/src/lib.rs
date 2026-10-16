#![forbid(unsafe_code)]
//! Worker deployment inputs and independent protocol-evidence helpers.

use base64::Engine;
use router_ab_core::{
    LocalServiceRoleV1, RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

mod local_ed25519_yao_api;
mod local_ed25519_yao_delivery;
mod local_ed25519_yao_input;
mod local_ed25519_yao_refresh;
mod local_ed25519_yao_router;
mod local_tenant_root_env;

pub use local_ed25519_yao_api::{
    build_local_activation_deriver_a_with_server_v1,
    build_local_activation_deriver_b_with_server_v1, build_local_export_deriver_a_with_server_v1,
    build_local_export_deriver_b_with_server_v1, build_local_refresh_deriver_a_v1,
    build_local_refresh_deriver_b_v1, LocalEd25519YaoActivationDeriverARequestV1,
    LocalEd25519YaoActivationDeriverBRequestV1, LocalEd25519YaoActivationRecipientsV1,
    LocalEd25519YaoClientContributionV1, LocalEd25519YaoExportDeriverARequestV1,
    LocalEd25519YaoExportDeriverBRequestV1, LocalEd25519YaoExportRecipientV1,
    LocalEd25519YaoRefreshDeriverARequestV1, LocalEd25519YaoRefreshDeriverBRequestV1,
};
pub use local_ed25519_yao_delivery::{
    derive_local_ed25519_yao_recipient_key_pair_v1,
    generate_local_ed25519_yao_recipient_key_pair_v1, open_local_ed25519_yao_client_package_v1,
    open_local_ed25519_yao_signing_worker_package_v1, seal_local_ed25519_yao_package_v1,
    LocalEd25519YaoRecipientKeyPairV1, LocalEd25519YaoRecipientPrivateKeyV1,
};
pub use local_ed25519_yao_input::{
    local_ed25519_yao_refresh_binding_digest_v1,
    open_local_ed25519_yao_activation_deriver_a_input_v1,
    open_local_ed25519_yao_activation_deriver_b_input_v1,
    open_local_ed25519_yao_export_deriver_a_input_v1,
    open_local_ed25519_yao_export_deriver_b_input_v1,
    open_local_ed25519_yao_refresh_deriver_a_input_v1,
    open_local_ed25519_yao_refresh_deriver_b_input_v1,
    seal_local_ed25519_yao_activation_deriver_a_input_v1,
    seal_local_ed25519_yao_activation_deriver_b_input_v1,
    seal_local_ed25519_yao_refresh_deriver_a_input_v1, LocalEd25519YaoEncryptedRefreshInputV1,
};
pub use local_ed25519_yao_refresh::{
    derive_local_ed25519_yao_joint_refresh_delta_v1,
    generate_local_ed25519_yao_deriver_a_refresh_delta_v1,
    generate_local_ed25519_yao_deriver_b_refresh_delta_v1, LocalEd25519YaoDeriverAEffectiveStateV1,
    LocalEd25519YaoDeriverAPreparedRefreshV1, LocalEd25519YaoDeriverARefreshDeltaWireV1,
    LocalEd25519YaoDeriverBEffectiveStateV1, LocalEd25519YaoDeriverBPreparedRefreshV1,
    LocalEd25519YaoDeriverBRefreshDeltaWireV1,
};
pub use local_ed25519_yao_router::{
    admit_local_ed25519_yao_registration_v1, LocalEd25519YaoRefreshActiveEpochsV1,
    LocalEd25519YaoRouterRefreshAdmissionRequestV1, LocalEd25519YaoRouterRefreshStateV1,
    LocalEd25519YaoRouterRegistrationAdmissionV1,
};
pub use router_ab_core::{
    Ed25519YaoDeriverRoleV1, Ed25519YaoEncryptedInputV1, Ed25519YaoEncryptedPackageV1,
    Ed25519YaoInputKindV1, Ed25519YaoPackageKindV1, RouterAbEd25519YaoActivationAdmissionReceiptV1,
    RouterAbEd25519YaoActivationExecuteRequestV1, RouterAbEd25519YaoActivationKeysetV1,
    RouterAbEd25519YaoActivationPublicReceiptV1, RouterAbEd25519YaoActivationResultV1,
    RouterAbEd25519YaoApplicationBindingFactsV1, RouterAbEd25519YaoLifecycleScopeV1,
    RouterAbEd25519YaoRegistrationAdmissionRequestV1,
    ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
    ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
};

pub const LOCAL_WORKER_ROLE_ENV_V1: &str = "ROUTER_AB_LOCAL_WORKER_ROLE";
pub const LOCAL_GATEWAY_PUBLIC_URL_ENV_V1: &str = "GATEWAY_PUBLIC_URL";
pub const LOCAL_DERIVER_A_URL_ENV_V1: &str = "DERIVER_A_URL";
pub const LOCAL_DERIVER_B_URL_ENV_V1: &str = "DERIVER_B_URL";
pub const LOCAL_SIGNING_WORKER_URL_ENV_V1: &str = "SIGNING_WORKER_URL";
pub const LOCAL_DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1: &str =
    "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY";
pub const LOCAL_DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1: &str =
    "DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY";
pub const LOCAL_DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY_ENV_V1: &str =
    "DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY";
pub const LOCAL_DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY_ENV_V1: &str =
    "DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY";
pub const LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_ENV_V1: &str =
    "SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY";
pub const LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV_V1: &str =
    "SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY";
pub const LOCAL_ROUTER_ENV_FILE_V1: &str = ".env.router-ab.router.local";
pub const LOCAL_DERIVER_A_ENV_FILE_V1: &str = ".env.router-ab.deriver-a.local";
pub const LOCAL_DERIVER_B_ENV_FILE_V1: &str = ".env.router-ab.deriver-b.local";
pub const LOCAL_SIGNING_WORKER_ENV_FILE_V1: &str = ".env.router-ab.signing-worker.local";
pub const LOCAL_TENANT_ROOT_CONTROL_PLANE_ENV_FILE_V1: &str =
    ".env.router-ab.tenant-root-control-plane.local";
pub const LOCAL_TENANT_ROOT_OPERATOR_ENV_FILE_V1: &str =
    ".env.router-ab.tenant-root-operator.local";
pub const LOCAL_TENANT_ROOT_CONTROL_PLANE_ENV_LABEL_V1: &str = "tenant_root_control_plane";
pub const LOCAL_TENANT_ROOT_OPERATOR_ENV_LABEL_V1: &str = "tenant_root_operator";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LocalEnvMaterializedFileV1 {
    /// Role that owns this env file.
    pub role: LocalServiceRoleV1,
    /// Relative path to write.
    pub path: String,
    /// File contents.
    pub contents: String,
}

/// A generated env file for the tenant-root control plane or the operator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LocalEnvMaterializedTenantRootFileV1 {
    /// `tenant_root_control_plane` or `tenant_root_operator`.
    pub label: String,
    /// Relative path to write.
    pub path: String,
    /// File contents.
    pub contents: String,
}

/// The loopback HTTP origin of one local role. The port is a `u16`, so an
/// origin cannot name a port outside the TCP range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalLoopbackOriginV1(u16);

impl LocalLoopbackOriginV1 {
    /// The origin on `port`.
    pub const fn on_port(port: u16) -> Self {
        Self(port)
    }
}

impl std::fmt::Display for LocalLoopbackOriginV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "http://127.0.0.1:{}", self.0)
    }
}

impl std::str::FromStr for LocalLoopbackOriginV1 {
    type Err = RouterAbProtocolError;

    /// Parses `http://127.0.0.1:<port>`.
    fn from_str(url: &str) -> RouterAbProtocolResult<Self> {
        let port = url
            .strip_prefix("http://127.0.0.1:")
            .and_then(|port| port.parse().ok());
        port.map(Self).ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("local role origin must be http://127.0.0.1:<port>: {url}"),
            )
        })
    }
}

/// The origin of every role in one local stack. An env plan writes each origin
/// under the env keys that name its role, so no URL text is searched or
/// rewritten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalStackOriginsV1 {
    /// The Router, which is also the JWT issuer.
    pub router: LocalLoopbackOriginV1,
    /// Deriver A.
    pub deriver_a: LocalLoopbackOriginV1,
    /// Deriver B.
    pub deriver_b: LocalLoopbackOriginV1,
    /// The SigningWorker.
    pub signing_worker: LocalLoopbackOriginV1,
    /// The tenant-root control plane.
    pub control_plane: LocalLoopbackOriginV1,
}

impl Default for LocalStackOriginsV1 {
    /// The fixed ports the env templates show.
    fn default() -> Self {
        Self {
            router: LocalLoopbackOriginV1(4100),
            deriver_a: LocalLoopbackOriginV1(4103),
            deriver_b: LocalLoopbackOriginV1(4104),
            signing_worker: LocalLoopbackOriginV1(4105),
            control_plane: LocalLoopbackOriginV1(4106),
        }
    }
}

impl LocalStackOriginsV1 {
    fn for_env_key(&self, key: &str) -> Option<LocalLoopbackOriginV1> {
        match key {
            LOCAL_GATEWAY_PUBLIC_URL_ENV_V1 | router_ab_cloudflare::ROUTER_JWT_ISSUER_ENV => {
                Some(self.router)
            }
            LOCAL_DERIVER_A_URL_ENV_V1 => Some(self.deriver_a),
            LOCAL_DERIVER_B_URL_ENV_V1 => Some(self.deriver_b),
            LOCAL_SIGNING_WORKER_URL_ENV_V1 => Some(self.signing_worker),
            _ => None,
        }
    }

    /// Sets every key of `contents` that names a role origin.
    fn write_into_env(&self, contents: &str) -> String {
        let write_line = |line: &str| {
            let key = line.split_once('=').map_or(line, |(key, _)| key);
            match self.for_env_key(key) {
                Some(origin) => format!("{key}={origin}\n"),
                None => line.to_owned(),
            }
        };
        contents.split_inclusive('\n').map(write_line).collect()
    }
}

/// Generated inputs for the local Workers deployment tools.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LocalEnvMaterializationPlanV1 {
    /// Env files to write.
    pub files: Vec<LocalEnvMaterializedFileV1>,
    /// The control-plane and operator env files.
    pub tenant_root_files: Vec<LocalEnvMaterializedTenantRootFileV1>,
}

impl LocalEnvMaterializationPlanV1 {
    /// Validates every generated env file parses into the matching role branch.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_exact_len_v1("local env materialization files", self.files.len(), 4)?;
        require_exact_len_v1(
            "local env materialization tenant-root files",
            self.tenant_root_files.len(),
            2,
        )?;
        for file in &self.tenant_root_files {
            parse_local_env_file_contents_v1(&file.contents)?;
        }
        for file in &self.files {
            require_non_empty("local env file path", &file.path)?;
            require_non_empty("local env file contents", &file.contents)?;
            let entries = parse_local_env_file_contents_v1(&file.contents)?;
            let label = entries
                .iter()
                .find(|(key, _)| key == LOCAL_WORKER_ROLE_ENV_V1)
                .map(|(_, value)| value.as_str())
                .ok_or_else(|| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MissingLocalBinding,
                        "generated env must identify its Worker role",
                    )
                })?;
            if parse_local_service_role_label_v1(label)? != file.role {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    "local env materialization produced wrong role branch",
                ));
            }
        }
        Ok(())
    }
}

/// Builds local Worker env files from a caller-provided seed.
pub fn local_env_materialization_plan_v1(
    seed: &[u8],
) -> RouterAbProtocolResult<LocalEnvMaterializationPlanV1> {
    local_env_materialization_plan_at_v1(seed, &LocalStackOriginsV1::default())
}

/// Builds the plan with each role at its origin in `origins`.
pub fn local_env_materialization_plan_at_v1(
    seed: &[u8],
    origins: &LocalStackOriginsV1,
) -> RouterAbProtocolResult<LocalEnvMaterializationPlanV1> {
    require_non_empty("local env materialization seed", &hex::encode(seed))?;
    let tenant_root = local_tenant_root_env::local_tenant_root_env_lines_v1(seed)?;
    let role_file = |role, path: &str, template: &str, tenant_root_lines: &str| {
        Ok::<_, RouterAbProtocolError>(LocalEnvMaterializedFileV1 {
            role,
            path: path.to_owned(),
            contents: origins.write_into_env(&materialize_template_v1(
                &format!("{template}{tenant_root_lines}"),
                seed,
            )?),
        })
    };
    let plan = LocalEnvMaterializationPlanV1 {
        files: vec![
            role_file(
                LocalServiceRoleV1::Router,
                LOCAL_ROUTER_ENV_FILE_V1,
                include_str!("../env/router.local.example"),
                &tenant_root.router,
            )?,
            role_file(
                LocalServiceRoleV1::DeriverA,
                LOCAL_DERIVER_A_ENV_FILE_V1,
                include_str!("../env/deriver-a.local.example"),
                &tenant_root.deriver_a,
            )?,
            role_file(
                LocalServiceRoleV1::DeriverB,
                LOCAL_DERIVER_B_ENV_FILE_V1,
                include_str!("../env/deriver-b.local.example"),
                &tenant_root.deriver_b,
            )?,
            role_file(
                LocalServiceRoleV1::SigningWorker,
                LOCAL_SIGNING_WORKER_ENV_FILE_V1,
                include_str!("../env/signing-worker.local.example"),
                "",
            )?,
        ],
        tenant_root_files: vec![
            LocalEnvMaterializedTenantRootFileV1 {
                label: LOCAL_TENANT_ROOT_CONTROL_PLANE_ENV_LABEL_V1.to_owned(),
                path: LOCAL_TENANT_ROOT_CONTROL_PLANE_ENV_FILE_V1.to_owned(),
                contents: origins
                    .write_into_env(&materialize_template_v1(&tenant_root.control_plane, seed)?),
            },
            LocalEnvMaterializedTenantRootFileV1 {
                label: LOCAL_TENANT_ROOT_OPERATOR_ENV_LABEL_V1.to_owned(),
                path: LOCAL_TENANT_ROOT_OPERATOR_ENV_FILE_V1.to_owned(),
                contents: tenant_root.operator,
            },
        ],
    };
    plan.validate()?;
    Ok(plan)
}

/// Parses simple `KEY=value` local env file contents.
pub fn parse_local_env_file_contents_v1(
    contents: &str,
) -> RouterAbProtocolResult<Vec<(String, String)>> {
    let mut entries = Vec::new();
    for (index, line) in contents.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("local env line {} must use KEY=value", index + 1),
            ));
        };
        entries.push((key.to_owned(), value.to_owned()));
    }
    Ok(entries)
}

/// Parses one local worker role label.
pub fn parse_local_service_role_label_v1(
    label: &str,
) -> RouterAbProtocolResult<LocalServiceRoleV1> {
    match label {
        "router" => Ok(LocalServiceRoleV1::Router),
        "deriver-a" | "deriver_a" => Ok(LocalServiceRoleV1::DeriverA),
        "deriver-b" | "deriver_b" => Ok(LocalServiceRoleV1::DeriverB),
        "signing-worker" | "signing_worker" => Ok(LocalServiceRoleV1::SigningWorker),
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("unknown local worker role '{label}'"),
        )),
    }
}

fn materialize_template_v1(template: &str, seed: &[u8]) -> RouterAbProtocolResult<String> {
    require_non_empty("local env materialization template", template)?;
    let mut contents = template.to_owned();
    for (placeholder, label) in [
        (
            "dev-only-role-shared-service-auth",
            "role-shared-service-auth",
        ),
        ("dev-only-gateway-to-router-auth", "gateway-to-router-auth"),
        (
            "dev-only-router-to-signing-worker-ecdsa-auth",
            "router-to-signing-worker-ecdsa-auth",
        ),
        (
            "dev-only-gateway-to-signing-worker-presign-auth",
            "gateway-to-signing-worker-presign-auth",
        ),
    ] {
        let seed_bytes = local_generated_secret_bytes_v1(label, seed)?;
        let material = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(seed_bytes);
        contents = contents.replace(placeholder, &material);
    }
    for (private_placeholder, public_placeholder, label) in [
        (
            "1111111111111111111111111111111111111111111111111111111111111111",
            "x25519:1111111111111111111111111111111111111111111111111111111111111111",
            "deriver-a-ed25519-yao-input-hpke-key-pair",
        ),
        (
            "2222222222222222222222222222222222222222222222222222222222222222",
            "x25519:2222222222222222222222222222222222222222222222222222222222222222",
            "deriver-b-ed25519-yao-input-hpke-key-pair",
        ),
    ] {
        let ikm = local_generated_secret_bytes_v1(label, seed)?;
        let key_pair = derive_local_ed25519_yao_recipient_key_pair_v1(&ikm)?;
        contents = contents.replace(
            public_placeholder,
            &format!("x25519:{}", hex::encode(key_pair.public_key)),
        );
        contents = contents.replace(
            private_placeholder,
            &hex::encode(key_pair.private_key.as_bytes()),
        );
    }
    let gateway_ceremony_seed =
        local_generated_secret_bytes_v1("gateway-ceremony-jwt-signing-key", seed)?;
    let gateway_ceremony_public = ed25519_dalek::SigningKey::from_bytes(&gateway_ceremony_seed)
        .verifying_key()
        .to_bytes();
    contents = contents.replace(
        "-AzM3OSuHAeuIIoq35mjEK5CB-Awb6AjYRCwaCe7uNA",
        &base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(gateway_ceremony_public),
    );
    let signing_worker_hpke_ikm =
        local_generated_secret_bytes_v1("signing-worker-server-output-hpke-key-pair", seed)?;
    let signing_worker_hpke =
        derive_local_ed25519_yao_recipient_key_pair_v1(&signing_worker_hpke_ikm)?;
    contents = contents.replace(
        "4444444444444444444444444444444444444444444444444444444444444444",
        &hex::encode(signing_worker_hpke.private_key.as_bytes()),
    );
    contents = contents.replace(
        "x25519:3333333333333333333333333333333333333333333333333333333333333333",
        &format!("x25519:{}", hex::encode(signing_worker_hpke.public_key)),
    );
    // The key that seals the SigningWorker's wallet rows at rest.
    let wallet_kek_ikm =
        local_generated_secret_bytes_v1("signing-worker-private-d1-kek-key-pair", seed)?;
    let wallet_kek = derive_local_ed25519_yao_recipient_key_pair_v1(&wallet_kek_ikm)?;
    contents = contents.replace(
        "6666666666666666666666666666666666666666666666666666666666666666",
        &hex::encode(wallet_kek.private_key.as_bytes()),
    );
    contents = contents.replace(
        "x25519:5555555555555555555555555555555555555555555555555555555555555555",
        &format!("x25519:{}", hex::encode(wallet_kek.public_key)),
    );
    Ok(contents)
}

pub(crate) fn local_generated_secret_bytes_v1(
    label: &str,
    seed: &[u8],
) -> RouterAbProtocolResult<[u8; 32]> {
    require_non_empty("local generated secret label", label)?;
    if seed.is_empty() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::EmptyField,
            "local env materialization seed must not be empty",
        ));
    }
    let mut hasher = Sha256::new();
    push_hash_field_v1(&mut hasher, b"router-ab-dev/local-env-materialization/v1");
    push_hash_field_v1(&mut hasher, label.as_bytes());
    push_hash_field_v1(&mut hasher, seed);
    Ok(hasher.finalize().into())
}

fn require_non_empty(field: &str, value: &str) -> RouterAbProtocolResult<()> {
    if value.is_empty() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::EmptyField,
            format!("{field} must not be empty"),
        ));
    }
    Ok(())
}

fn require_exact_len_v1(field: &str, actual: usize, expected: usize) -> RouterAbProtocolResult<()> {
    if actual != expected {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} expected {expected} entries, received {actual}"),
        ));
    }
    Ok(())
}

fn push_hash_field_v1(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u32).to_be_bytes());
    hasher.update(bytes);
}
