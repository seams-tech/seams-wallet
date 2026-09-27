//! Tenant-root provisioning on conventional VMs.
//!
//! The VM roles run the tenant-root creation ceremony the Cloudflare
//! deployment runs, with the same shared code: control-plane genesis and role
//! commands, Deriver A as the initiating role, the issuer's activation receipt,
//! the Router-owned creation state and each Deriver's activation. What differs
//! is only the host:
//!
//! - roles reach each other over HTTP with the role-shared credential;
//! - the Router owns the creation state in its own SQLite file, one set of
//!   rows per tenant root, and every operation runs in one `BEGIN IMMEDIATE`
//!   transaction;
//! - each Deriver keeps its role-share store in its role-private SQLite file
//!   and its signed managed backups in a separate SQLite file;
//! - the creation authority id is derived from a configured deployment
//!   authority rather than a Durable Object id.
//!
//! Refresh (manual and scheduled) and managed restore run the same shared
//! code too. Source retirement and cutover are not served here.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use base64::Engine;
use router_ab_cloudflare::{
    decode_cloudflare_tenant_root_control_plane_issuer_signing_secret_v1,
    decode_issuer_verifying_keys, parse_cloudflare_tenant_root_creation_role_verifying_keys_v1,
    tenant_root_creation_journal_call_v1, tenant_root_creation_journal_read_call_v1,
    parse_tenant_root_refresh_schedule_v1, tenant_root_creation_object_name_v1,
    tenant_root_creation_serve_v1,
    verify_tenant_root_managed_backup_object_v1, verify_tenant_root_provider_canary_object_v1,
    CloudflareEnvMapV1, CloudflareEnvReaderV1,
    CloudflareSecretReaderV1, CloudflareTenantRootControlPlaneBindingsV1,
    CloudflareTenantRootManagedBackupDeletionReceiptV1, CloudflareWorkerRoleV1,
    TenantRootCallBoundsV1,
    TenantRootCreationStateTransportV1, TenantRootCreationStoreV1, TenantRootDeriverHostV1,
    TenantRootManagedBackupObjectCoordinatesV1, TenantRootRoleShareStoreV1,
    TenantRootRouterCreationHostV1, TenantRootServiceTargetV1, TenantRootServiceTransportV1,
    CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
    CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH,
    CLOUDFLARE_TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_PATH,
    CLOUDFLARE_TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_PATH,
    CLOUDFLARE_TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_CLEANUP_CHECKPOINT_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_PATH, CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH,
};
use router_ab_core::{
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
    TenantRootControlPlaneAuthorityIdV1, TenantRootCustodyLineageId, TenantRootIdentityDigestV1,
    TenantRootManagedRestoreRoleV1, TwoPartyDeriverRole, VerifiedTenantRootManagedBackupV1,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::local_service_http::LocalHttpServiceBindingClientV1;
use crate::local_tenant_root_role_sql::LocalRoleSqlSessionV1;

/// Deployment authority from which every VM role derives creation authority ids.
pub const LOCAL_TENANT_ROOT_DEPLOYMENT_AUTHORITY_ID_ENV_V1: &str =
    "LOCAL_TENANT_ROOT_DEPLOYMENT_AUTHORITY_ID";
/// The Router's creation-state SQLite file.
pub const LOCAL_ROUTER_TENANT_ROOT_CREATION_STORAGE_PATH_ENV_V1: &str =
    "ROUTER_TENANT_ROOT_CREATION_STORAGE_PATH";
/// A Deriver's managed-backup SQLite file.
pub const LOCAL_DERIVER_TENANT_ROOT_MANAGED_BACKUP_STORAGE_PATH_ENV_V1: &str =
    "DERIVER_TENANT_ROOT_MANAGED_BACKUP_STORAGE_PATH";
/// The control plane's private origin, for the Router.
pub const LOCAL_TENANT_ROOT_CONTROL_PLANE_URL_ENV_V1: &str = "LOCAL_TENANT_ROOT_CONTROL_PLANE_URL";
/// The Router's private origin, for the control plane and the Derivers.
pub const LOCAL_ROUTER_PRIVATE_URL_ENV_V1: &str = "LOCAL_ROUTER_PRIVATE_URL";
/// The Router-owned creation-state route.
pub const LOCAL_ROUTER_TENANT_ROOT_CREATION_STATE_PATH_V1: &str =
    "/router-ab/internal/tenant-root/creation-state/v1";

const LOCAL_TENANT_ROOT_AUTHORITY_DOMAIN_V1: &[u8] = b"seams/vm/tenant-root-creation-authority/v1";
const LOCAL_TENANT_ROOT_PRIVATE_RESPONSE_MAX_BYTES_V1: usize = 1024 * 1024;
const LOCAL_TENANT_ROOT_CREATION_STATE_REQUEST_MAX_BYTES_V1: usize = 1024 * 1024;

/// Derives the creation authority id for one tenant root on a VM deployment.
///
/// Cloudflare binds creation artifacts to the creation Durable Object's id.
/// A VM has no such id, so every role derives the same value from the
/// deployment's configured authority and the creation object name.
pub fn local_tenant_root_creation_authority_id_v1(
    deployment_authority_id: &str,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
    if deployment_authority_id.is_empty()
        || deployment_authority_id.len() > 256
        || deployment_authority_id
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
    {
        return Err(invalid_config(
            "VM tenant-root deployment authority id must be 1-256 bytes without whitespace",
        ));
    }
    let object_name = tenant_root_creation_object_name_v1(identity_digest, custody_lineage);
    let mut hasher = Sha256::new();
    hasher.update(LOCAL_TENANT_ROOT_AUTHORITY_DOMAIN_V1);
    hasher.update(u64::try_from(deployment_authority_id.len()).unwrap_or(u64::MAX).to_be_bytes());
    hasher.update(deployment_authority_id.as_bytes());
    hasher.update(object_name.as_bytes());
    Ok(TenantRootControlPlaneAuthorityIdV1::from_bytes(
        hasher.finalize().into(),
    ))
}

/// One creation-state operation addressed to one tenant root's creation state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalTenantRootCreationStateRequestV1 {
    pub authority_id_b64u: String,
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
    pub path: String,
    pub request_json: String,
}

/// The Router's tenant-root configuration.
#[derive(Clone, PartialEq, Eq)]
pub struct LocalRouterTenantRootConfigV1 {
    /// The Router's full env, read through the shared tenant-root parsers.
    pub env: CloudflareEnvMapV1,
    pub deployment_authority_id: String,
    pub creation_storage_path: PathBuf,
    pub control_plane_url: String,
    pub deriver_a_url: String,
    pub deriver_b_url: String,
    pub internal_service_auth: String,
}

/// A Deriver's tenant-root configuration.
#[derive(Clone, PartialEq, Eq)]
pub struct LocalDeriverTenantRootConfigV1 {
    pub worker_role: CloudflareWorkerRoleV1,
    /// The Deriver's full env, including its role-private Secrets.
    pub env: CloudflareEnvMapV1,
    pub deployment_authority_id: String,
    pub role_store_path: PathBuf,
    pub managed_backup_path: PathBuf,
    pub router_url: String,
    pub peer_url: String,
    pub internal_service_auth: String,
}

/// The control plane's tenant-root configuration.
#[derive(Clone, PartialEq, Eq)]
pub struct LocalTenantRootControlPlaneConfigV1 {
    pub env: CloudflareEnvMapV1,
    pub bindings: CloudflareTenantRootControlPlaneBindingsV1,
    pub deployment_authority_id: String,
    pub router_url: String,
    pub bind_url: String,
    pub internal_service_auth: String,
}

/// An empty configuration: every tenant-root operation on it fails closed.
impl Default for LocalRouterTenantRootConfigV1 {
    fn default() -> Self {
        Self {
            env: CloudflareEnvMapV1::new(Vec::<(String, String)>::new()),
            deployment_authority_id: String::new(),
            creation_storage_path: PathBuf::new(),
            control_plane_url: String::new(),
            deriver_a_url: String::new(),
            deriver_b_url: String::new(),
            internal_service_auth: String::new(),
        }
    }
}

// The configs hold each role's full env, Secrets included, so their Debug
// output names only the non-secret coordinates.
impl std::fmt::Debug for LocalRouterTenantRootConfigV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalRouterTenantRootConfigV1")
            .field("deployment_authority_id", &self.deployment_authority_id)
            .field("creation_storage_path", &self.creation_storage_path)
            .field("control_plane_url", &self.control_plane_url)
            .finish_non_exhaustive()
    }
}

impl std::fmt::Debug for LocalDeriverTenantRootConfigV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalDeriverTenantRootConfigV1")
            .field("worker_role", &self.worker_role)
            .field("deployment_authority_id", &self.deployment_authority_id)
            .field("role_store_path", &self.role_store_path)
            .field("managed_backup_path", &self.managed_backup_path)
            .finish_non_exhaustive()
    }
}

impl std::fmt::Debug for LocalTenantRootControlPlaneConfigV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalTenantRootControlPlaneConfigV1")
            .field("deployment_authority_id", &self.deployment_authority_id)
            .field("bind_url", &self.bind_url)
            .finish_non_exhaustive()
    }
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

/// Private calls from one VM role to the control plane or a Deriver.
#[derive(Debug, Clone)]
pub struct LocalTenantRootServiceTransportV1 {
    control_plane_url: Option<String>,
    deriver_a_url: Option<String>,
    deriver_b_url: Option<String>,
    internal_service_auth: String,
    client: LocalHttpServiceBindingClientV1,
}

impl LocalTenantRootServiceTransportV1 {
    pub fn new(
        control_plane_url: Option<String>,
        deriver_a_url: Option<String>,
        deriver_b_url: Option<String>,
        internal_service_auth: String,
    ) -> Self {
        Self {
            control_plane_url,
            deriver_a_url,
            deriver_b_url,
            internal_service_auth,
            client: LocalHttpServiceBindingClientV1::default(),
        }
    }
}

impl TenantRootServiceTransportV1 for LocalTenantRootServiceTransportV1 {
    async fn post_private_json<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        target: TenantRootServiceTargetV1,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        bounds: Option<TenantRootCallBoundsV1>,
    ) -> RouterAbProtocolResult<TResponse> {
        let origin = match target {
            TenantRootServiceTargetV1::ControlPlane => self.control_plane_url.as_deref(),
            TenantRootServiceTargetV1::Deriver(TwoPartyDeriverRole::DeriverA) => {
                self.deriver_a_url.as_deref()
            }
            TenantRootServiceTargetV1::Deriver(TwoPartyDeriverRole::DeriverB) => {
                self.deriver_b_url.as_deref()
            }
        }
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingLocalBinding,
                format!("{label}: this role has no route to the addressed peer"),
            )
        })?;
        let encoded = serde_json::to_vec(request).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} request encoding failed: {error}"),
            )
        })?;
        let response_max_bytes = match bounds {
            Some(bounds) => {
                if encoded.len() > bounds.request_max_bytes {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("{label} exceeds its maximum size"),
                    ));
                }
                bounds.response_max_bytes
            }
            None => LOCAL_TENANT_ROOT_PRIVATE_RESPONSE_MAX_BYTES_V1,
        };
        // The HTTP client blocks, so each call runs on its own thread and is
        // awaited. Calls the shared code joins, such as both Derivers'
        // refreshes meeting at the Router's rendezvous, then run concurrently
        // as they do over Service Bindings.
        let (sender, receiver) = futures::channel::oneshot::channel();
        let client = self.client.clone();
        let origin = origin.to_owned();
        let credential = self.internal_service_auth.clone();
        std::thread::spawn(move || {
            let _ = sender.send(client.post_private_bytes_to_origin_v1(
                &origin,
                path,
                &credential,
                &encoded,
                response_max_bytes,
            ));
        });
        let response = receiver.await.map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{label} call thread stopped without a response"),
            )
        })??;
        serde_json::from_slice(&response).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} response JSON parse failed: {error}"),
            )
        })
    }
}

/// A non-Router role's route to the Router-owned creation state.
#[derive(Debug, Clone)]
pub struct LocalTenantRootCreationStateClientV1 {
    router_url: String,
    deployment_authority_id: String,
    internal_service_auth: String,
    client: LocalHttpServiceBindingClientV1,
}

impl LocalTenantRootCreationStateClientV1 {
    pub fn new(
        router_url: String,
        deployment_authority_id: String,
        internal_service_auth: String,
    ) -> Self {
        Self {
            router_url,
            deployment_authority_id,
            internal_service_auth,
            client: LocalHttpServiceBindingClientV1::default(),
        }
    }
}

impl TenantRootCreationStateTransportV1 for LocalTenantRootCreationStateClientV1 {
    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        local_tenant_root_creation_authority_id_v1(
            &self.deployment_authority_id,
            identity_digest,
            custody_lineage,
        )
    }

    async fn creation_state_call<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        request_max_bytes: usize,
        response_max_bytes: usize,
    ) -> RouterAbProtocolResult<TResponse> {
        let envelope = creation_state_envelope_v1(
            authority_id,
            identity_digest,
            custody_lineage,
            path,
            label,
            request,
            request_max_bytes,
        )?;
        self.client.post_private_json_to_origin_v1(
            &self.router_url,
            LOCAL_ROUTER_TENANT_ROOT_CREATION_STATE_PATH_V1,
            &self.internal_service_auth,
            &envelope,
            response_max_bytes,
        )
    }
}

/// The Router's own route to its creation state: the same operation, served
/// in process.
#[derive(Debug, Clone, Copy)]
pub struct LocalRouterCreationStateV1<'a> {
    config: &'a LocalRouterTenantRootConfigV1,
}

impl<'a> LocalRouterCreationStateV1<'a> {
    pub const fn new(config: &'a LocalRouterTenantRootConfigV1) -> Self {
        Self { config }
    }
}

impl TenantRootCreationStateTransportV1 for LocalRouterCreationStateV1<'_> {
    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        local_tenant_root_creation_authority_id_v1(
            &self.config.deployment_authority_id,
            identity_digest,
            custody_lineage,
        )
    }

    async fn creation_state_call<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        request_max_bytes: usize,
        response_max_bytes: usize,
    ) -> RouterAbProtocolResult<TResponse> {
        let envelope = creation_state_envelope_v1(
            authority_id,
            identity_digest,
            custody_lineage,
            path,
            label,
            request,
            request_max_bytes,
        )?;
        let response = serve_local_tenant_root_creation_state_async_v1(self.config, &envelope).await?;
        if response.len() > response_max_bytes {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} response exceeds its maximum size"),
            ));
        }
        serde_json::from_slice(&response).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} response JSON parse failed: {error}"),
            )
        })
    }
}

fn creation_state_envelope_v1<TRequest: Serialize>(
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    path: &'static str,
    label: &'static str,
    request: &TRequest,
    request_max_bytes: usize,
) -> RouterAbProtocolResult<LocalTenantRootCreationStateRequestV1> {
    let request_json = serde_json::to_string(request).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{label} request JSON encoding failed: {error}"),
        )
    })?;
    if request_json.len() > request_max_bytes {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{label} request exceeds its maximum size"),
        ));
    }
    Ok(LocalTenantRootCreationStateRequestV1 {
        authority_id_b64u: b64u(authority_id.as_bytes()),
        identity_digest_b64u: b64u(identity_digest.as_bytes()),
        custody_lineage_b64u: custody_lineage.to_base64url(),
        path: path.to_owned(),
        request_json,
    })
}

// ---------------------------------------------------------------------------
// Router creation state
// ---------------------------------------------------------------------------

/// Serves one creation-state operation against the Router's SQLite store.
///
/// The request names its tenant root and the creation authority it expects;
/// the Router derives the authority itself and refuses a mismatch, as the
/// Cloudflare creation object refuses a capability for a different object.
/// Each operation runs in one `BEGIN IMMEDIATE` transaction. As on Cloudflare,
/// the transaction commits whatever the operation wrote unless storage itself
/// failed.
pub fn serve_local_tenant_root_creation_state_v1(
    config: &LocalRouterTenantRootConfigV1,
    request: &LocalTenantRootCreationStateRequestV1,
) -> RouterAbProtocolResult<Vec<u8>> {
    futures::executor::block_on(serve_local_tenant_root_creation_state_async_v1(config, request))
}

static LOCAL_CREATION_STATE_OPERATION_LOCK_V1: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The creation-state server itself, for callers already inside an executor
/// (the Router's own creation coordinator).
async fn serve_local_tenant_root_creation_state_async_v1(
    config: &LocalRouterTenantRootConfigV1,
    request: &LocalTenantRootCreationStateRequestV1,
) -> RouterAbProtocolResult<Vec<u8>> {
    if request.request_json.len() > LOCAL_TENANT_ROOT_CREATION_STATE_REQUEST_MAX_BYTES_V1 {
        return Err(malformed("tenant-root creation-state request exceeds its maximum size"));
    }
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_b64u_32(
        "tenant-root creation-state identity digest",
        &request.identity_digest_b64u,
    )?);
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&request.custody_lineage_b64u)
        .map_err(|error| malformed(format!("tenant-root creation-state lineage is invalid: {error}")))?;
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes(decode_b64u_32(
        "tenant-root creation-state authority id",
        &request.authority_id_b64u,
    )?);
    let expected = local_tenant_root_creation_authority_id_v1(
        &config.deployment_authority_id,
        identity_digest,
        custody_lineage,
    )?;
    if authority_id != expected {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation-state request names a foreign creation authority",
        ));
    }
    let path = creation_state_route_v1(&request.path)?;
    let issuer_keys = decode_issuer_verifying_keys(&required_env(
        &config.env,
        router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
    )?)?;
    let now_ms = crate::local_router_coordinator::local_now_ms_v1()?;
    let schedule = parse_tenant_root_refresh_schedule_v1(&config.env)?;
    let destination_bootstrap_config = {
        use router_ab_cloudflare::CloudflareEnvReaderV1 as _;
        config
            .env
            .get_text(LOCAL_TENANT_ROOT_DESTINATION_BOOTSTRAP_JSON_ENV_V1)?
    };

    // One operation at a time, as a Durable Object runs them. SQLite's write
    // lock alone serializes them unfairly: a waiter sleeps between attempts,
    // so a role polling the rendezvous can hold the store while its peer's
    // write keeps missing it. This lock wakes the next waiter on release.
    let _serialized = LOCAL_CREATION_STATE_OPERATION_LOCK_V1
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut connection = open_sqlite(&config.creation_storage_path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let store = LocalCreationStateStoreV1 {
        transaction: &transaction,
        object_name: tenant_root_creation_object_name_v1(identity_digest, custody_lineage),
        authority_id,
        identity_digest,
        custody_lineage,
        storage_error: RefCell::new(None),
    };
    let result = tenant_root_creation_serve_v1(
        &store,
        &issuer_keys,
        || parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(&config.env),
        destination_bootstrap_config.as_deref(),
        path,
        request.request_json.as_bytes(),
        now_ms,
        schedule,
    )
    .await;
    if let Some(error) = store.storage_error.take() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("tenant-root creation-state storage failed: {error}"),
        ));
    }
    drop(store);
    transaction.commit().map_err(sqlite_error)?;
    result
}

/// A destination Router's provisioned bootstrap authority, as JSON: the
/// identity, deployment fingerprint and custody lineage a restore into this
/// deployment may name, and the digest of its one-time bootstrap credential.
/// The first bootstrap read of an empty tenant root persists it.
pub const LOCAL_TENANT_ROOT_DESTINATION_BOOTSTRAP_JSON_ENV_V1: &str =
    "TENANT_ROOT_DESTINATION_BOOTSTRAP_JSON";

/// How often the VM Router offers each tenant root its scheduled refresh, in
/// milliseconds: one minute unless set, and at least one second.
pub const LOCAL_TENANT_ROOT_REFRESH_SCHEDULER_TICK_MS_ENV_V1: &str =
    "LOCAL_TENANT_ROOT_REFRESH_SCHEDULER_TICK_MS";

/// The VM Router's scheduled refresh worker, the counterpart of the external
/// trigger on Cloudflare.
///
/// Every tick it offers each tenant root the Router holds its scheduled
/// refresh, through the same coordinator the refresh route runs; the admission
/// answers "not due" until the root's schedule says otherwise. The job is the
/// Router's persisted pending admission, so a restarted Router resumes the
/// scheduled operation it had begun under that operation's own id. One root's
/// failure is logged and does not hold back the others.
pub fn run_local_tenant_root_refresh_scheduler_v1(
    config: &LocalRouterTenantRootConfigV1,
) -> RouterAbProtocolResult<()> {
    use router_ab_cloudflare::CloudflareEnvReaderV1 as _;
    let tick_ms = match config
        .env
        .get_text(LOCAL_TENANT_ROOT_REFRESH_SCHEDULER_TICK_MS_ENV_V1)?
    {
        Some(value) => value.parse::<u64>().ok().filter(|value| *value >= 1_000).ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "the refresh scheduler tick must be at least 1000 milliseconds",
            )
        })?,
        None => 60_000,
    };
    let host = LocalRouterTenantRootCreationHostV1::new(config);
    loop {
        std::thread::sleep(std::time::Duration::from_millis(tick_ms));
        let roots = match local_tenant_roots_v1(config) {
            Ok(roots) => roots,
            Err(error) => {
                log_scheduled_refresh_v1(None, &error.to_string());
                continue;
            }
        };
        for (identity_digest, custody_lineage) in roots {
            let outcome = scheduled_refresh_operation_id_v1().and_then(|operation_id| {
                futures::executor::block_on(router_ab_cloudflare::tenant_root_router_scheduled_refresh_v1(
                    &host,
                    identity_digest,
                    custody_lineage,
                    operation_id,
                    crate::local_router_coordinator::local_now_ms_v1()?,
                ))
            });
            let root = (identity_digest, custody_lineage);
            match outcome {
                Ok(router_ab_cloudflare::CloudflareRouterTenantRootRefreshResultV1::NotDue { .. }) => {}
                Ok(result) => {
                    let (status, body) = result.http_status_and_body();
                    log_scheduled_refresh_v1(Some(root), &format!("{status} {body}"));
                }
                Err(error) => log_scheduled_refresh_v1(Some(root), &error.to_string()),
            }
        }
    }
}

/// The tenant roots whose authoritative active state this Router holds.
fn local_tenant_roots_v1(
    config: &LocalRouterTenantRootConfigV1,
) -> RouterAbProtocolResult<Vec<(TenantRootIdentityDigestV1, TenantRootCustodyLineageId)>> {
    let connection = open_sqlite(&config.creation_storage_path)?;
    let mut statement = connection
        .prepare(
            "SELECT json_extract(value_json, '$.identity_digest_b64u'),
                    json_extract(value_json, '$.custody_lineage_b64u')
             FROM local_tenant_root_creation_state WHERE storage_key = ?1",
        )
        .map_err(sqlite_error)?;
    let rows = statement
        .query_map(
            [router_ab_cloudflare::TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(sqlite_error)?;
    let mut roots = Vec::new();
    for row in rows {
        let (identity_digest_b64u, custody_lineage_b64u) = row.map_err(sqlite_error)?;
        roots.push((
            TenantRootIdentityDigestV1::from_bytes(decode_b64u_32(
                "tenant-root scheduled refresh identity digest",
                &identity_digest_b64u,
            )?),
            TenantRootCustodyLineageId::from_base64url(&custody_lineage_b64u).map_err(|error| {
                malformed(format!("tenant-root scheduled refresh lineage is invalid: {error}"))
            })?,
        ));
    }
    Ok(roots)
}

fn scheduled_refresh_operation_id_v1() -> RouterAbProtocolResult<String> {
    let mut bytes = [0_u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("the VM Router could not read secure randomness: {error}"),
        )
    })?;
    Ok(format!("scheduled-{}", hex::encode(bytes)))
}

fn log_scheduled_refresh_v1(
    root: Option<(TenantRootIdentityDigestV1, TenantRootCustodyLineageId)>,
    outcome: &str,
) {
    eprintln!(
        "{}",
        serde_json::json!({
            "event": "tenant_root_scheduled_refresh",
            "identity_digest_b64u": root.map(|(identity, _)| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity.as_bytes())),
            "custody_lineage_b64u": root.map(|(_, lineage)| lineage.to_base64url()),
            "outcome": outcome,
        })
    );
}

fn creation_state_route_v1(path: &str) -> RouterAbProtocolResult<&'static str> {
    [
        CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_PATH,
        CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH,
        CLOUDFLARE_TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_PATH,
        CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH,
        CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH,
        CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
        CLOUDFLARE_TENANT_ROOT_CREATION_CLEANUP_CHECKPOINT_PATH,
        CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH,
        CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH,
        CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH,
        CLOUDFLARE_TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_PATH,
        CLOUDFLARE_TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_PATH,
        CLOUDFLARE_TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_PATH,
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_PRIVATE_REQUEST_PATH,
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH,
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH,
    ]
    .into_iter()
    .find(|known| *known == path)
    .ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "the VM Router does not serve this tenant-root creation-state operation",
        )
    })
}

struct LocalCreationStateStoreV1<'t> {
    transaction: &'t rusqlite::Transaction<'t>,
    object_name: String,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    storage_error: RefCell<Option<String>>,
}

impl LocalCreationStateStoreV1<'_> {
    fn record(&self, error: impl std::fmt::Display) -> RouterAbProtocolError {
        let message = error.to_string();
        self.storage_error.replace(Some(message.clone()));
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("tenant-root creation-state storage failed: {message}"),
        )
    }
}

impl TenantRootCreationStoreV1 for LocalCreationStateStoreV1<'_> {
    fn authority_id(&self) -> TenantRootControlPlaneAuthorityIdV1 {
        self.authority_id
    }

    fn require_scope(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<()> {
        if identity_digest != self.identity_digest || custody_lineage != self.custody_lineage {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root creation-state request names a different tenant root",
            ));
        }
        Ok(())
    }

    async fn get_json<T: DeserializeOwned>(&self, key: &str) -> RouterAbProtocolResult<Option<T>> {
        let value: Option<String> = self
            .transaction
            .query_row(
                "SELECT value_json FROM local_tenant_root_creation_state
                 WHERE object_name = ?1 AND storage_key = ?2",
                rusqlite::params![self.object_name, key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| self.record(error))?;
        value
            .map(|json| serde_json::from_str(&json).map_err(|error| self.record(error)))
            .transpose()
    }

    async fn put_json<T: Serialize>(&self, key: &str, value: &T) -> RouterAbProtocolResult<()> {
        let json = serde_json::to_string(value).map_err(|error| self.record(error))?;
        self.transaction
            .execute(
                "INSERT INTO local_tenant_root_creation_state (object_name, storage_key, value_json)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT (object_name, storage_key) DO UPDATE SET value_json = excluded.value_json",
                rusqlite::params![self.object_name, key, json],
            )
            .map_err(|error| self.record(error))?;
        Ok(())
    }

    async fn delete(&self, key: &str) -> RouterAbProtocolResult<()> {
        self.transaction
            .execute(
                "DELETE FROM local_tenant_root_creation_state
                 WHERE object_name = ?1 AND storage_key = ?2",
                rusqlite::params![self.object_name, key],
            )
            .map_err(|error| self.record(error))?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Router creation coordinator
// ---------------------------------------------------------------------------

/// The Router's creation host on a VM.
pub struct LocalRouterTenantRootCreationHostV1<'a> {
    config: &'a LocalRouterTenantRootConfigV1,
    transport: LocalTenantRootServiceTransportV1,
}

impl<'a> LocalRouterTenantRootCreationHostV1<'a> {
    pub fn new(config: &'a LocalRouterTenantRootConfigV1) -> Self {
        Self {
            config,
            transport: LocalTenantRootServiceTransportV1::new(
                Some(config.control_plane_url.clone()),
                Some(config.deriver_a_url.clone()),
                Some(config.deriver_b_url.clone()),
                config.internal_service_auth.clone(),
            ),
        }
    }
}

impl TenantRootServiceTransportV1 for LocalRouterTenantRootCreationHostV1<'_> {
    async fn post_private_json<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        target: TenantRootServiceTargetV1,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        bounds: Option<TenantRootCallBoundsV1>,
    ) -> RouterAbProtocolResult<TResponse> {
        self.transport
            .post_private_json(target, path, label, request, bounds)
            .await
    }
}

impl TenantRootCreationStateTransportV1 for LocalRouterTenantRootCreationHostV1<'_> {
    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        LocalRouterCreationStateV1::new(self.config)
            .creation_authority_id(identity_digest, custody_lineage)
    }

    async fn creation_state_call<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        request_max_bytes: usize,
        response_max_bytes: usize,
    ) -> RouterAbProtocolResult<TResponse> {
        LocalRouterCreationStateV1::new(self.config)
            .creation_state_call(
                authority_id,
                identity_digest,
                custody_lineage,
                path,
                label,
                request,
                request_max_bytes,
                response_max_bytes,
            )
            .await
    }
}

impl TenantRootRouterCreationHostV1 for LocalRouterTenantRootCreationHostV1<'_> {
    fn trusted_issuer_keys(&self) -> RouterAbProtocolResult<std::collections::BTreeMap<String, [u8; 32]>> {
        decode_issuer_verifying_keys(&required_env(
            &self.config.env,
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
        )?)
    }

    fn role_verifying_keys(
        &self,
    ) -> RouterAbProtocolResult<router_ab_cloudflare::TenantRootCreationRoleVerifyingKeysV1> {
        parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(&self.config.env)
    }

    fn grant_authority_verifying_keys(
        &self,
    ) -> RouterAbProtocolResult<router_ab_cloudflare::CloudflareTenantRootCreationGrantAuthorityVerifyingKeysV1>
    {
        router_ab_cloudflare::parse_cloudflare_tenant_root_creation_grant_authority_verifying_keys_v1(
            &self.config.env,
        )
    }

    fn now_ms(&self) -> RouterAbProtocolResult<u64> {
        crate::local_router_coordinator::local_now_ms_v1()
    }
}

// ---------------------------------------------------------------------------
// Deriver host
// ---------------------------------------------------------------------------

/// A Deriver's tenant-root host on a VM.
pub struct LocalTenantRootDeriverHostV1<'a> {
    config: &'a LocalDeriverTenantRootConfigV1,
    transport: LocalTenantRootServiceTransportV1,
    creation_state: LocalTenantRootCreationStateClientV1,
}

impl<'a> LocalTenantRootDeriverHostV1<'a> {
    pub fn new(config: &'a LocalDeriverTenantRootConfigV1) -> Self {
        let peer = Some(config.peer_url.clone());
        let (deriver_a_url, deriver_b_url) = match config.worker_role {
            CloudflareWorkerRoleV1::DeriverA => (None, peer),
            _ => (peer, None),
        };
        Self {
            config,
            transport: LocalTenantRootServiceTransportV1::new(
                None,
                deriver_a_url,
                deriver_b_url,
                config.internal_service_auth.clone(),
            ),
            creation_state: LocalTenantRootCreationStateClientV1::new(
                config.router_url.clone(),
                config.deployment_authority_id.clone(),
                config.internal_service_auth.clone(),
            ),
        }
    }

    fn backup_role(&self) -> RouterAbProtocolResult<TenantRootManagedRestoreRoleV1> {
        match self.config.worker_role {
            CloudflareWorkerRoleV1::DeriverA => Ok(TenantRootManagedRestoreRoleV1::DeriverA),
            CloudflareWorkerRoleV1::DeriverB => Ok(TenantRootManagedRestoreRoleV1::DeriverB),
            _ => Err(invalid_config("only a Deriver stores tenant-root managed backups")),
        }
    }
}

impl TenantRootServiceTransportV1 for LocalTenantRootDeriverHostV1<'_> {
    async fn post_private_json<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        target: TenantRootServiceTargetV1,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        bounds: Option<TenantRootCallBoundsV1>,
    ) -> RouterAbProtocolResult<TResponse> {
        self.transport
            .post_private_json(target, path, label, request, bounds)
            .await
    }
}

impl TenantRootCreationStateTransportV1 for LocalTenantRootDeriverHostV1<'_> {
    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        self.creation_state
            .creation_authority_id(identity_digest, custody_lineage)
    }

    async fn creation_state_call<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        request_max_bytes: usize,
        response_max_bytes: usize,
    ) -> RouterAbProtocolResult<TResponse> {
        self.creation_state
            .creation_state_call(
                authority_id,
                identity_digest,
                custody_lineage,
                path,
                label,
                request,
                request_max_bytes,
                response_max_bytes,
            )
            .await
    }
}

impl LocalTenantRootDeriverHostV1<'_> {
    /// Stores one immutable object and returns its generation: a fresh random
    /// value for a new write, the stored one for an identical replay. Different
    /// bytes at the same key are refused.
    /// Writes one object at a key that must not hold other bytes, as the R2
    /// store does. An object holding exactly these bytes is a replay. An object
    /// whose bytes have a digest in `replaceable` is replaced, conditionally on
    /// its exact stored generation.
    fn store_backup_object(
        &self,
        object_key: &str,
        bytes: &[u8],
        replaceable: &[[u8; 32]],
        conflict: &'static str,
    ) -> RouterAbProtocolResult<String> {
        use sha2::Digest as _;
        let mut generation = [0_u8; 16];
        getrandom::getrandom(&mut generation).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("the VM Deriver could not read secure randomness: {error}"),
            )
        })?;
        let generation = hex::encode(generation);
        let connection = open_sqlite(&self.config.managed_backup_path)?;
        // A lost race only restarts the write; a key that keeps changing fails.
        for _ in 0..3 {
            let inserted = connection
                .execute(
                    "INSERT INTO local_tenant_root_managed_backups
                       (object_key, canonical_bytes, object_generation)
                     VALUES (?1, ?2, ?3) ON CONFLICT (object_key) DO NOTHING",
                    rusqlite::params![object_key, bytes, generation],
                )
                .map_err(sqlite_error)?;
            if inserted == 1 {
                return Ok(generation);
            }
            let Some((existing, stored_generation)) = self.load_backup_object(object_key)? else {
                continue;
            };
            if existing == bytes {
                return Ok(stored_generation);
            }
            let existing_digest: [u8; 32] = sha2::Sha256::digest(&existing).into();
            if !replaceable.contains(&existing_digest) {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    conflict,
                ));
            }
            let replaced = connection
                .execute(
                    "UPDATE local_tenant_root_managed_backups
                       SET canonical_bytes = ?2, object_generation = ?3
                     WHERE object_key = ?1 AND object_generation = ?4",
                    rusqlite::params![object_key, bytes, generation, stored_generation],
                )
                .map_err(sqlite_error)?;
            if replaced == 1 {
                return Ok(generation);
            }
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "managed-backup object kept changing while it was written",
        ))
    }

    /// Loads one stored object's bytes and generation.
    fn load_backup_object(&self, object_key: &str) -> RouterAbProtocolResult<Option<(Vec<u8>, String)>> {
        open_sqlite(&self.config.managed_backup_path)?
            .query_row(
                "SELECT canonical_bytes, object_generation FROM local_tenant_root_managed_backups
                 WHERE object_key = ?1",
                rusqlite::params![object_key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(sqlite_error)
    }
}

/// The metadata the host reports for one stored object.
fn backup_object_metadata(
    object_key: String,
    bytes: &[u8],
    object_generation: String,
    wrapping_key_generation_ref: &str,
) -> RouterAbProtocolResult<router_ab_cloudflare::TenantRootManagedBackupObjectMetadataV1> {
    use sha2::Digest as _;
    router_ab_cloudflare::TenantRootManagedBackupObjectMetadataV1::new(
        object_key,
        sha2::Sha256::digest(bytes).into(),
        object_generation,
        wrapping_key_generation_ref.to_owned(),
    )
    .map_err(|error| RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLocalServiceConfig, error))
}

impl TenantRootDeriverHostV1 for LocalTenantRootDeriverHostV1<'_> {
    type Sql = LocalRoleSqlSessionV1;
    type Env = CloudflareEnvMapV1;

    fn worker_role(&self) -> CloudflareWorkerRoleV1 {
        self.config.worker_role
    }

    fn now_ms(&self) -> RouterAbProtocolResult<u64> {
        crate::local_router_coordinator::local_now_ms_v1()
    }

    fn env(&self) -> &Self::Env {
        &self.config.env
    }

    fn role_store(
        &self,
    ) -> router_ab_cloudflare::RoleStoreResult<TenantRootRoleShareStoreV1<Self::Sql>> {
        TenantRootRoleShareStoreV1::from_env_reader(
            LocalRoleSqlSessionV1::open(&self.config.role_store_path)?,
            &self.config.env,
        )
    }

    async fn put_managed_backup(
        &self,
        backup: &VerifiedTenantRootManagedBackupV1,
        replaceable: &[[u8; 32]],
    ) -> RouterAbProtocolResult<router_ab_cloudflare::TenantRootManagedBackupObjectMetadataV1> {
        if backup.role() != self.backup_role()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "managed backup belongs to the other Deriver",
            ));
        }
        let object_key =
            TenantRootManagedBackupObjectCoordinatesV1::from_binding(backup.binding()).object_key();
        let bytes = backup.canonical_bytes();
        let generation = self.store_backup_object(
            &object_key,
            bytes,
            replaceable,
            "managed-backup object key already contains different canonical bytes",
        )?;
        backup_object_metadata(object_key, bytes, generation, backup.binding().backup_key_version())
    }

    async fn get_managed_backup_with_metadata(
        &self,
        coordinates: TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<(VerifiedTenantRootManagedBackupV1, router_ab_cloudflare::TenantRootManagedBackupObjectMetadataV1)> {
        let object_key = coordinates.object_key();
        let (bytes, generation) = self
            .load_backup_object(&object_key)?
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "managed-backup object does not exist",
                )
            })?;
        let verified =
            verify_tenant_root_managed_backup_object_v1(&bytes, coordinates, trusted_role_verifying_key)
                .map_err(|error| {
                    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, error)
                })?;
        let metadata = backup_object_metadata(
            object_key,
            &bytes,
            generation,
            verified.binding().backup_key_version(),
        )?;
        Ok((verified, metadata))
    }

    async fn get_managed_backup(
        &self,
        coordinates: TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<VerifiedTenantRootManagedBackupV1> {
        let connection = open_sqlite(&self.config.managed_backup_path)?;
        let bytes: Vec<u8> = connection
            .query_row(
                "SELECT canonical_bytes FROM local_tenant_root_managed_backups WHERE object_key = ?1",
                rusqlite::params![coordinates.object_key()],
                |row| row.get(0),
            )
            .optional()
            .map_err(sqlite_error)?
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "managed-backup object does not exist",
                )
            })?;
        verify_tenant_root_managed_backup_object_v1(&bytes, coordinates, trusted_role_verifying_key)
            .map_err(|error| {
                RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, error)
            })
    }

    async fn delete_managed_backup(
        &self,
        coordinates: TenantRootManagedBackupObjectCoordinatesV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootManagedBackupDeletionReceiptV1> {
        if coordinates.role() != self.backup_role()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "managed-backup object belongs to the other Deriver",
            ));
        }
        let managed_backup_key = coordinates.object_key();
        let provider_canary_key = coordinates.provider_canary_object_key();
        let mut connection = open_sqlite(&self.config.managed_backup_path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sqlite_error)?;
        let delete = |key: &str| -> RouterAbProtocolResult<bool> {
            let removed = transaction
                .execute(
                    "DELETE FROM local_tenant_root_managed_backups WHERE object_key = ?1",
                    rusqlite::params![key],
                )
                .map_err(sqlite_error)?;
            let remaining: i64 = transaction
                .query_row(
                    "SELECT COUNT(*) FROM local_tenant_root_managed_backups WHERE object_key = ?1",
                    rusqlite::params![key],
                    |row| row.get(0),
                )
                .map_err(sqlite_error)?;
            if remaining != 0 {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "managed-backup object is still present after deletion",
                ));
            }
            Ok(removed == 1)
        };
        // The VM writes no provider canary; its receipt records it absent.
        let provider_canary_was_present = delete(&provider_canary_key)?;
        let managed_backup_was_present = delete(&managed_backup_key)?;
        transaction.commit().map_err(sqlite_error)?;
        Ok(CloudflareTenantRootManagedBackupDeletionReceiptV1::from_presence(
            coordinates,
            managed_backup_was_present,
            provider_canary_was_present,
        ))
    }

    async fn put_provider_canary(
        &self,
        coordinates: TenantRootManagedBackupObjectCoordinatesV1,
        canary_bytes: &[u8],
        trusted_role_verifying_key: &[u8; 32],
        replaceable: &[[u8; 32]],
    ) -> RouterAbProtocolResult<router_ab_cloudflare::TenantRootManagedBackupObjectMetadataV1> {
        if coordinates.role() != self.backup_role()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "provider canary belongs to the other Deriver",
            ));
        }
        let verified = verify_tenant_root_provider_canary_object_v1(
            canary_bytes,
            coordinates,
            trusted_role_verifying_key,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, error)
        })?;
        let object_key = coordinates.provider_canary_object_key();
        let generation = self.store_backup_object(
            &object_key,
            canary_bytes,
            replaceable,
            "provider canary object key already contains different canonical bytes",
        )?;
        backup_object_metadata(object_key, canary_bytes, generation, verified.provider_key_version_ref())
    }

    async fn get_provider_canary_with_metadata(
        &self,
        coordinates: TenantRootManagedBackupObjectCoordinatesV1,
        expected_binding: &router_ab_core::TenantRootProviderCanaryReceiptBindingV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<(router_ab_core::VerifiedTenantRootProviderCanaryReceiptV1, router_ab_cloudflare::TenantRootManagedBackupObjectMetadataV1)> {
        let object_key = coordinates.provider_canary_object_key();
        let (bytes, generation) = self
            .load_backup_object(&object_key)?
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "provider canary object does not exist",
                )
            })?;
        let verified =
            verify_tenant_root_provider_canary_object_v1(&bytes, coordinates, trusted_role_verifying_key)
                .map_err(|error| {
                    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, error)
                })?;
        if verified.binding() != expected_binding {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "provider canary object does not carry the expected binding",
            ));
        }
        let metadata =
            backup_object_metadata(object_key, &bytes, generation, verified.provider_key_version_ref())?;
        Ok((verified, metadata))
    }

    async fn get_provider_canary(
        &self,
        coordinates: TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<Vec<u8>> {
        let connection = open_sqlite(&self.config.managed_backup_path)?;
        let bytes: Vec<u8> = connection
            .query_row(
                "SELECT canonical_bytes FROM local_tenant_root_managed_backups WHERE object_key = ?1",
                rusqlite::params![coordinates.provider_canary_object_key()],
                |row| row.get(0),
            )
            .optional()
            .map_err(sqlite_error)?
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "provider canary object does not exist",
                )
            })?;
        verify_tenant_root_provider_canary_object_v1(&bytes, coordinates, trusted_role_verifying_key)
            .map_err(|error| {
                RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, error)
            })?;
        Ok(bytes)
    }
}

// ---------------------------------------------------------------------------
// Control plane host
// ---------------------------------------------------------------------------

/// The tenant-root control plane's host on a VM. It is the only VM process
/// that holds the issuer signing Secret.
pub struct LocalTenantRootControlPlaneHostV1<'a> {
    config: &'a LocalTenantRootControlPlaneConfigV1,
    creation_state: LocalTenantRootCreationStateClientV1,
}

impl<'a> LocalTenantRootControlPlaneHostV1<'a> {
    pub fn new(config: &'a LocalTenantRootControlPlaneConfigV1) -> Self {
        Self {
            config,
            creation_state: LocalTenantRootCreationStateClientV1::new(
                config.router_url.clone(),
                config.deployment_authority_id.clone(),
                config.internal_service_auth.clone(),
            ),
        }
    }
}

/// The control plane reaches the Router's creation state through its client.
impl TenantRootCreationStateTransportV1 for LocalTenantRootControlPlaneHostV1<'_> {
    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        self.creation_state
            .creation_authority_id(identity_digest, custody_lineage)
    }

    async fn creation_state_call<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        request_max_bytes: usize,
        response_max_bytes: usize,
    ) -> RouterAbProtocolResult<TResponse> {
        self.creation_state
            .creation_state_call(
                authority_id,
                identity_digest,
                custody_lineage,
                path,
                label,
                request,
                request_max_bytes,
                response_max_bytes,
            )
            .await
    }
}

impl router_ab_cloudflare::TenantRootControlPlaneHostV1 for LocalTenantRootControlPlaneHostV1<'_> {
    fn bindings(&self) -> &CloudflareTenantRootControlPlaneBindingsV1 {
        &self.config.bindings
    }

    fn now_ms(&self) -> RouterAbProtocolResult<u64> {
        crate::local_router_coordinator::local_now_ms_v1()
    }

    fn issuer_seed(&self) -> RouterAbProtocolResult<Zeroizing<[u8; 32]>> {
        let secret = self
            .config
            .env
            .secret_text(self.config.bindings.issuer_signing_key.binding_name())?;
        decode_cloudflare_tenant_root_control_plane_issuer_signing_secret_v1(&secret)
    }

    async fn read_creation_state(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<router_ab_cloudflare::CloudflareTenantRootCreationJournalReadResponseV1>
    {
        tenant_root_creation_journal_read_call_v1(&self.creation_state, identity_digest, custody_lineage)
            .await
    }

    async fn persist_creation_journal(
        &self,
        journal: &router_ab_core::TenantRootCreationJournalV1,
        capability: &router_ab_core::TenantRootCreationCapabilityV1,
    ) -> RouterAbProtocolResult<router_ab_cloudflare::CloudflareTenantRootCreationJournalResponseV1> {
        tenant_root_creation_journal_call_v1(&self.creation_state, journal, capability).await
    }

    async fn read_active_state(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<router_ab_cloudflare::CloudflareVerifiedTenantRootActiveStateV1> {
        router_ab_cloudflare::tenant_root_creation_active_state_with_revision_read_call_v1(
            &self.creation_state,
            self.config.bindings.issuer_verifying_keys.keys(),
            identity_digest,
            custody_lineage,
        )
        .await
    }

    fn random_bytes(&self, len: usize) -> RouterAbProtocolResult<Vec<u8>> {
        let mut bytes = vec![0_u8; len];
        getrandom::getrandom(&mut bytes).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("the VM control plane could not read secure randomness: {error}"),
            )
        })?;
        Ok(bytes)
    }

    fn recovery_trust(
        &self,
    ) -> RouterAbProtocolResult<(
        router_ab_core::derivation::TenantRootRecoveryTrustBundleV1,
        Option<router_ab_core::derivation::TenantRootRecoveryRevocationSnapshotV1>,
    )> {
        Ok((
            router_ab_cloudflare::parse_cloudflare_tenant_root_recovery_trust_bundle_v1(
                &self.config.env,
            )?,
            router_ab_cloudflare::parse_cloudflare_tenant_root_recovery_trust_snapshot_v1(
                &self.config.env,
            )?,
        ))
    }
}

// ---------------------------------------------------------------------------
// Yao-time loads
// ---------------------------------------------------------------------------

/// Resolves the Router's Yao tenant-root context from its own creation state.
///
/// The activation receipt is read from the Router-owned active state and
/// verified against the trusted issuer keys; the Deriver identities come from
/// the published role verifying keys, as on Cloudflare.
#[allow(clippy::too_many_arguments)]
pub fn resolve_local_router_tenant_root_context_v1(
    config: &LocalRouterTenantRootConfigV1,
    identity: &router_ab_core::TenantRootIdentityV1,
    coordinates: &router_ab_cloudflare::CloudflareTenantRootCoordinatesV1,
    application: &router_ab_core::RouterAbEd25519YaoApplicationBindingFactsV1,
    participant_ids: [u16; 2],
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> RouterAbProtocolResult<router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2> {
    let (identity_digest, custody_lineage) = coordinates.resolve()?;
    let admitted =
        local_router_tenant_root_admission_receipt_v1(config, identity_digest, custody_lineage)?;
    let receipt = &admitted;
    let requested = identity.digest().map_err(|error| {
        malformed(format!("Yao tenant-root identity is invalid: {error}"))
    })?;
    if requested != receipt.identity_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "Yao tenant-root identity differs from the active activation receipt",
        ));
    }
    let derivers =
        parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(&config.env)?.deriver_identities()?;
    router_ab_cloudflare::cloudflare_ed25519_yao_tenant_root_context_v2(
        identity.clone(),
        receipt,
        derivers,
        application.clone(),
        participant_ids,
        pair_binding,
        issued_at_ms,
        expires_at_ms,
    )
}

/// The activation receipt new work on one tenant root is admitted on: a
/// committed epoch both Derivers have activated. A pending refresh delivery
/// is finished first.
pub(crate) fn local_router_tenant_root_admission_receipt_v1(
    config: &LocalRouterTenantRootConfigV1,
    identity_digest: router_ab_core::TenantRootIdentityDigestV1,
    custody_lineage: router_ab_core::TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<router_ab_core::VerifiedTenantRootSignedActivationReceiptV1> {
    futures::executor::block_on(
        router_ab_cloudflare::tenant_root_router_admission_receipt_v1(
            &LocalRouterTenantRootCreationHostV1::new(config),
            identity_digest,
            custody_lineage,
        ),
    )
}

/// Authenticates one Yao pair's custody binding against the trusted issuer
/// keys and Deriver identities.
fn authenticate_local_yao_custody_binding_v1(
    config: &LocalDeriverTenantRootConfigV1,
    tenant_root: &router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2,
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
    now_ms: u64,
) -> RouterAbProtocolResult<router_ab_core::TenantRootCustodyBindingV1> {
    tenant_root.validate_for_pair(pair_binding)?;
    let custody = tenant_root.custody_binding.authenticate_for_ed25519_yao_v1(
        &config.env,
        pair_binding,
        &tenant_root.application,
        tenant_root.participant_ids,
        now_ms,
    )?;
    let requested = tenant_root.identity.digest().map_err(|error| {
        malformed(format!("Yao tenant-root identity is invalid: {error}"))
    })?;
    if requested != custody.identity_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "Yao tenant-root identity differs from the authenticated custody binding",
        ));
    }
    Ok(custody)
}

/// Admits one Yao pair's root-using work at this Deriver on the epoch its
/// custody binding names, when the pair is prepared. The pair's later root
/// reads then find it admitted, so a refresh that retires the epoch between
/// preparation and execution does not stop it; a pair prepared after the
/// epoch closed here is refused.
pub fn admit_local_deriver_tenant_root_work_v1(
    config: &LocalDeriverTenantRootConfigV1,
    tenant_root: &router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2,
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
) -> RouterAbProtocolResult<()> {
    let now_ms = crate::local_router_coordinator::local_now_ms_v1()?;
    let custody = authenticate_local_yao_custody_binding_v1(config, tenant_root, pair_binding, now_ms)?;
    futures::executor::block_on(router_ab_cloudflare::tenant_root_deriver_admit_bound_work_v1(
        &LocalTenantRootDeriverHostV1::new(config),
        &custody,
        &router_ab_cloudflare::TenantRootRootUseAttemptV1::Ed25519YaoPairSession {
            session: pair_binding.session(),
        },
        now_ms,
    ))
}

/// Loads this Deriver's role share for one authenticated Yao pair: the epoch
/// its custody binding names, for a pair admitted on that epoch.
pub fn load_local_deriver_tenant_root_role_share_v1(
    config: &LocalDeriverTenantRootConfigV1,
    tenant_root: &router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2,
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
) -> RouterAbProtocolResult<crate::LocalTenantRootRoleShareV1> {
    let now_ms = crate::local_router_coordinator::local_now_ms_v1()?;
    let custody = authenticate_local_yao_custody_binding_v1(config, tenant_root, pair_binding, now_ms)?;
    let opened = futures::executor::block_on(
        router_ab_cloudflare::tenant_root_deriver_load_bound_role_share_v1(
            &LocalTenantRootDeriverHostV1::new(config),
            &custody,
            &router_ab_cloudflare::TenantRootRootUseAttemptV1::Ed25519YaoPairSession {
                session: pair_binding.session(),
            },
            now_ms,
        ),
    )?;
    let (binding, share_wire) = opened.into_parts();
    Ok(crate::LocalTenantRootRoleShareV1 {
        binding,
        share_wire,
    })
}

// ---------------------------------------------------------------------------
// Storage and helpers
// ---------------------------------------------------------------------------

fn open_sqlite(path: &Path) -> RouterAbProtocolResult<Connection> {
    let connection = Connection::open(path).map_err(sqlite_error)?;
    connection
        .execute_batch("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .map_err(sqlite_error)?;
    Ok(connection)
}

fn required_env(env: &CloudflareEnvMapV1, key: &str) -> RouterAbProtocolResult<String> {
    env.get_text(key)?
        .ok_or_else(|| invalid_config(format!("{key} is required")))
}

fn decode_b64u_32(field: &str, value: &str) -> RouterAbProtocolResult<[u8; 32]> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| malformed(format!("{field} must be unpadded base64url")))?;
    bytes
        .try_into()
        .map_err(|_| malformed(format!("{field} must decode to 32 bytes")))
}

fn b64u(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn sqlite_error(error: rusqlite::Error) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("tenant-root SQLite failed: {error}"),
    )
}

fn malformed(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}

fn invalid_config(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLocalServiceConfig, message)
}
