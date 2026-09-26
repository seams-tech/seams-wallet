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
//! Refresh, managed restore, source retirement and cutover are not served
//! here, and a creation left with one role installed fails closed.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use base64::Engine;
use router_ab_cloudflare::{
    decode_cloudflare_tenant_root_control_plane_issuer_signing_secret_v1,
    decode_issuer_verifying_keys, parse_cloudflare_tenant_root_creation_role_verifying_keys_v1,
    tenant_root_creation_journal_call_v1, tenant_root_creation_journal_read_call_v1,
    parse_tenant_root_manual_refresh_interval_ms_v1, tenant_root_creation_object_name_v1,
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
        let response_max_bytes = match bounds {
            Some(bounds) => {
                let encoded = serde_json::to_vec(request).map_err(|error| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("{label} request encoding failed: {error}"),
                    )
                })?;
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
        self.client.post_private_json_to_origin_v1(
            origin,
            path,
            &self.internal_service_auth,
            request,
            response_max_bytes,
        )
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
    let manual_refresh_interval_ms = parse_tenant_root_manual_refresh_interval_ms_v1(&config.env)?;

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
        path,
        request.request_json.as_bytes(),
        now_ms,
        manual_refresh_interval_ms,
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

impl TenantRootDeriverHostV1 for LocalTenantRootDeriverHostV1<'_> {
    type Sql = LocalRoleSqlSessionV1;
    type Env = CloudflareEnvMapV1;

    fn worker_role(&self) -> CloudflareWorkerRoleV1 {
        self.config.worker_role
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
    ) -> RouterAbProtocolResult<()> {
        if backup.role() != self.backup_role()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "managed backup belongs to the other Deriver",
            ));
        }
        let object_key =
            TenantRootManagedBackupObjectCoordinatesV1::from_binding(backup.binding()).object_key();
        let bytes = backup.canonical_bytes();
        let connection = open_sqlite(&self.config.managed_backup_path)?;
        let inserted = connection
            .execute(
                "INSERT INTO local_tenant_root_managed_backups (object_key, canonical_bytes)
                 VALUES (?1, ?2) ON CONFLICT (object_key) DO NOTHING",
                rusqlite::params![object_key, bytes],
            )
            .map_err(sqlite_error)?;
        if inserted == 1 {
            return Ok(());
        }
        let existing: Vec<u8> = connection
            .query_row(
                "SELECT canonical_bytes FROM local_tenant_root_managed_backups WHERE object_key = ?1",
                rusqlite::params![object_key],
                |row| row.get(0),
            )
            .map_err(sqlite_error)?;
        if existing != bytes {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "managed-backup object key already contains different canonical bytes",
            ));
        }
        Ok(())
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
    ) -> RouterAbProtocolResult<()> {
        if coordinates.role() != self.backup_role()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "provider canary belongs to the other Deriver",
            ));
        }
        verify_tenant_root_provider_canary_object_v1(
            canary_bytes,
            coordinates,
            trusted_role_verifying_key,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, error)
        })?;
        let object_key = coordinates.provider_canary_object_key();
        let connection = open_sqlite(&self.config.managed_backup_path)?;
        let inserted = connection
            .execute(
                "INSERT INTO local_tenant_root_managed_backups (object_key, canonical_bytes)
                 VALUES (?1, ?2) ON CONFLICT (object_key) DO NOTHING",
                rusqlite::params![object_key, canary_bytes],
            )
            .map_err(sqlite_error)?;
        if inserted == 1 {
            return Ok(());
        }
        let existing: Vec<u8> = connection
            .query_row(
                "SELECT canonical_bytes FROM local_tenant_root_managed_backups WHERE object_key = ?1",
                rusqlite::params![object_key],
                |row| row.get(0),
            )
            .map_err(sqlite_error)?;
        if existing != canary_bytes {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "provider canary object key already contains different canonical bytes",
            ));
        }
        Ok(())
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

    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        self.creation_state
            .creation_authority_id(identity_digest, custody_lineage)
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
    let issuer_keys = decode_issuer_verifying_keys(&required_env(
        &config.env,
        router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
    )?)?;
    let active = futures::executor::block_on(
        router_ab_cloudflare::tenant_root_creation_active_state_with_revision_read_call_v1(
            &LocalRouterCreationStateV1::new(config),
            &issuer_keys,
            identity_digest,
            custody_lineage,
        ),
    )?;
    let receipt = active.activation_receipt();
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

/// Loads this Deriver's active role share for one authenticated Yao pair.
///
/// The custody binding is authenticated against the trusted issuer keys and
/// Deriver identities before the role-private store is read, and the store
/// returns only the active row that binding names.
pub fn load_local_deriver_tenant_root_role_share_v1(
    config: &LocalDeriverTenantRootConfigV1,
    tenant_root: &router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2,
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
) -> RouterAbProtocolResult<crate::LocalTenantRootRoleShareV1> {
    tenant_root.validate_for_pair(pair_binding)?;
    let custody = tenant_root.custody_binding.authenticate_for_ed25519_yao_v1(
        &config.env,
        pair_binding,
        &tenant_root.application,
        tenant_root.participant_ids,
        crate::local_router_coordinator::local_now_ms_v1()?,
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
    let opened = futures::executor::block_on(
        router_ab_cloudflare::tenant_root_deriver_load_active_role_share_v1(
            &LocalTenantRootDeriverHostV1::new(config),
            &custody,
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
