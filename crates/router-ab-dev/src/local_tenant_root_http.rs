//! HTTP routes for tenant-root provisioning on the VM Router and Derivers.
//!
//! Every route takes the role-shared service credential, as the Cloudflare
//! routes do; the Router's creation route is not a Gateway route and does not
//! accept the Gateway-to-Router credential.

use router_ab_cloudflare::{
    cloudflare_router_error_status, control_plane_create_tenant_root_v1,
    control_plane_initial_activation_v1, control_plane_pending_creation_cleanup_command_v1,
    control_plane_role_creation_command_v1, decode_tenant_root_cleanup_scope_v1,
    tenant_root_deriver_cleanup_v1, CloudflareDeriverTenantRootCleanupRequestV1,
    CloudflareTenantRootControlPlaneCleanupCommandRequestV1,
    CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
    parse_cloudflare_tenant_root_control_plane_bindings_v1, router_ab_service_credential_matches_v1,
    validate_cloudflare_tenant_root_control_plane_issuer_key_provenance_v1, CloudflareEnvMapV1,
    CloudflareEnvReaderV1, CloudflareSecretReaderV1,
    CloudflareTenantRootControlPlaneInitialActivationRequestV1,
    CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_ROLE_CREATION_COMMAND_PRIVATE_REQUEST_PATH,
    tenant_root_deriver_create_role_share_v1, tenant_root_deriver_initial_activation_v1,
    tenant_root_router_coordinate_creation_v1,
    CloudflareDeriverTenantRootCreateRoleShareRequestV1,
    CloudflareDeriverTenantRootInitialActivationRequestV1,
    CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
    CLOUDFLARE_DERIVER_TENANT_ROOT_CREATE_ROLE_SHARE_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_DERIVER_TENANT_ROOT_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_PRIVATE_REQUEST_PATH,
};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{de::DeserializeOwned, Serialize};

use crate::local_tenant_root::{
    serve_local_tenant_root_creation_state_v1, LocalDeriverTenantRootConfigV1,
    LocalTenantRootControlPlaneConfigV1, LocalTenantRootControlPlaneHostV1,
    LOCAL_ROUTER_PRIVATE_URL_ENV_V1, LOCAL_TENANT_ROOT_CONTROL_PLANE_URL_ENV_V1,
    LOCAL_TENANT_ROOT_DEPLOYMENT_AUTHORITY_ID_ENV_V1,
    LocalRouterTenantRootCreationHostV1, LocalTenantRootCreationStateRequestV1,
    LocalTenantRootDeriverHostV1, LOCAL_ROUTER_TENANT_ROOT_CREATION_STATE_PATH_V1,
};
use crate::{LocalDevHttpRequestPartsV1, LocalWorkerRoleConfigV1};

/// Serves a tenant-root route owned by this role, or returns `None` for any
/// other path.
pub fn local_tenant_root_route_v1(
    config: &LocalWorkerRoleConfigV1,
    request: &LocalDevHttpRequestPartsV1,
) -> Option<(u16, String)> {
    let result = match config {
        LocalWorkerRoleConfigV1::Router(router) => match request.path.as_str() {
            LOCAL_ROUTER_TENANT_ROOT_CREATION_STATE_PATH_V1 => Some(authorized(
                &router.internal_service_auth,
                request,
                |envelope: LocalTenantRootCreationStateRequestV1| {
                    let bytes = serve_local_tenant_root_creation_state_v1(&router.tenant_root, &envelope)?;
                    String::from_utf8(bytes).map_err(|_| {
                        RouterAbProtocolError::new(
                            RouterAbProtocolErrorCode::MalformedWirePayload,
                            "tenant-root creation-state response is not UTF-8 JSON",
                        )
                    })
                },
            )),
            CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_PRIVATE_REQUEST_PATH => Some(authorized(
                &router.internal_service_auth,
                request,
                |create: CloudflareTenantRootControlPlaneCreateTenantRootRequestV1| {
                    json(&futures::executor::block_on(
                        tenant_root_router_coordinate_creation_v1(
                            &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                            create,
                        ),
                    )?)
                },
            )),
            _ => None,
        },
        LocalWorkerRoleConfigV1::DeriverA(deriver) => {
            deriver_route(&deriver.internal_service_auth, &deriver.tenant_root, request)
        }
        LocalWorkerRoleConfigV1::DeriverB(deriver) => {
            deriver_route(&deriver.internal_service_auth, &deriver.tenant_root, request)
        }
        LocalWorkerRoleConfigV1::SigningWorker(_) => None,
    };
    result.map(|outcome| outcome.unwrap_or_else(error_response))
}

fn deriver_route(
    credential: &str,
    tenant_root: &LocalDeriverTenantRootConfigV1,
    request: &LocalDevHttpRequestPartsV1,
) -> Option<RouterAbProtocolResult<(u16, String)>> {
    match request.path.as_str() {
        CLOUDFLARE_DERIVER_TENANT_ROOT_CREATE_ROLE_SHARE_PRIVATE_REQUEST_PATH => Some(authorized(
            credential,
            request,
            |create: CloudflareDeriverTenantRootCreateRoleShareRequestV1| {
                json(&futures::executor::block_on(
                    tenant_root_deriver_create_role_share_v1(
                        &LocalTenantRootDeriverHostV1::new(tenant_root),
                        create,
                        crate::local_router_coordinator::local_now_ms_v1()?,
                    ),
                )?)
            },
        )),
        CLOUDFLARE_DERIVER_TENANT_ROOT_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |activation: CloudflareDeriverTenantRootInitialActivationRequestV1| {
                    json(&futures::executor::block_on(
                        tenant_root_deriver_initial_activation_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            activation,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH => Some(authorized(
            credential,
            request,
            |cleanup: CloudflareDeriverTenantRootCleanupRequestV1| {
                json(&futures::executor::block_on(tenant_root_deriver_cleanup_v1(
                    &LocalTenantRootDeriverHostV1::new(tenant_root),
                    cleanup,
                    crate::local_router_coordinator::local_now_ms_v1()?,
                ))?)
            },
        )),
        _ => None,
    }
}

/// Checks method and role-shared credential, decodes the JSON body and runs
/// the handler.
pub(crate) fn authorized<T: DeserializeOwned>(
    credential: &str,
    request: &LocalDevHttpRequestPartsV1,
    handler: impl FnOnce(T) -> RouterAbProtocolResult<String>,
) -> RouterAbProtocolResult<(u16, String)> {
    if request.method != "POST" {
        return Ok((405, "tenant-root route requires POST".to_owned()));
    }
    let presented = request.internal_service_auth.as_deref().unwrap_or_default();
    if !router_ab_service_credential_matches_v1(credential, presented) {
        return Ok((401, "tenant-root route requires the role-shared credential".to_owned()));
    }
    let parsed = serde_json::from_slice::<T>(&request.body).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("tenant-root request JSON is invalid: {error}"),
        )
    })?;
    Ok((200, handler(parsed)?))
}

pub(crate) fn json<T: Serialize>(value: &T) -> RouterAbProtocolResult<String> {
    serde_json::to_string(value).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("tenant-root response encoding failed: {error}"),
        )
    })
}

/// The same status and text a Cloudflare role returns for a protocol error.
pub(crate) fn error_response(error: RouterAbProtocolError) -> (u16, String) {
    (
        cloudflare_router_error_status(error.code()),
        format!("{:?}: {}", error.code(), error.message()),
    )
}

/// Parses the control plane's env and proves, before it serves, that its
/// issuer Secret derives the published active issuer key. The shared
/// bindings parser also refuses every key this role must not hold.
pub fn parse_local_tenant_root_control_plane_config_v1(
    entries: impl IntoIterator<Item = (String, String)>,
) -> RouterAbProtocolResult<LocalTenantRootControlPlaneConfigV1> {
    let env = CloudflareEnvMapV1::new(entries.into_iter().collect());
    let bindings = parse_cloudflare_tenant_root_control_plane_bindings_v1(&env)?;
    let secret = env.secret_text(bindings.issuer_signing_key.binding_name())?;
    validate_cloudflare_tenant_root_control_plane_issuer_key_provenance_v1(
        &bindings.issuer_signing_key,
        &bindings.issuer_verifying_keys,
        &secret,
    )?;
    drop(secret);
    let required = |key: &str| {
        env.get_text(key)?.ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{key} is required"),
            )
        })
    };
    Ok(LocalTenantRootControlPlaneConfigV1 {
        deployment_authority_id: required(LOCAL_TENANT_ROOT_DEPLOYMENT_AUTHORITY_ID_ENV_V1)?,
        router_url: required(LOCAL_ROUTER_PRIVATE_URL_ENV_V1)?,
        bind_url: required(LOCAL_TENANT_ROOT_CONTROL_PLANE_URL_ENV_V1)?,
        internal_service_auth: required(crate::LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_ENV_V1)?,
        bindings,
        env,
    })
}

/// Serves one control-plane request.
pub fn local_tenant_root_control_plane_route_v1(
    config: &LocalTenantRootControlPlaneConfigV1,
    request: &LocalDevHttpRequestPartsV1,
) -> (u16, String) {
    let host = LocalTenantRootControlPlaneHostV1::new(config);
    let credential = &config.internal_service_auth;
    let outcome = match request.path.as_str() {
        crate::LOCAL_WORKER_HEALTH_PATH | crate::LOCAL_WORKER_READY_PATH if request.method == "GET" => {
            Ok((200, r#"{"role":"tenant_root_control_plane","status":"ready"}"#.to_owned()))
        }
        CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |create: CloudflareTenantRootControlPlaneCreateTenantRootRequestV1| {
                json(&futures::executor::block_on(control_plane_create_tenant_root_v1(&host, create))?)
            },
        ),
        CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_ROLE_CREATION_COMMAND_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |command: CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1| {
                json(&futures::executor::block_on(control_plane_role_creation_command_v1(
                    &host, command,
                ))?)
            },
        ),
        CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |activation: CloudflareTenantRootControlPlaneInitialActivationRequestV1| {
                json(&futures::executor::block_on(control_plane_initial_activation_v1(
                    &host, activation,
                ))?)
            },
        ),
        CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |cleanup: CloudflareTenantRootControlPlaneCleanupCommandRequestV1| match cleanup {
                CloudflareTenantRootControlPlaneCleanupCommandRequestV1::PendingCreation {
                    identity_digest_b64u,
                    custody_lineage_b64u,
                } => {
                    let (identity_digest, custody_lineage) = decode_tenant_root_cleanup_scope_v1(
                        &identity_digest_b64u,
                        &custody_lineage_b64u,
                    )?;
                    json(&futures::executor::block_on(
                        control_plane_pending_creation_cleanup_command_v1(
                            &host,
                            identity_digest,
                            custody_lineage,
                        ),
                    )?)
                }
                // Retiring a refreshed-out source waits on the reviewed
                // retirement design; the VM refuses it rather than skip it.
                CloudflareTenantRootControlPlaneCleanupCommandRequestV1::RetiredAfterRefresh {
                    ..
                } => Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "the VM reference does not retire a refreshed-out tenant-root source",
                )),
            },
        ),
        _ => Ok((404, "the tenant-root control plane does not serve this path".to_owned())),
    };
    outcome.unwrap_or_else(error_response)
}
