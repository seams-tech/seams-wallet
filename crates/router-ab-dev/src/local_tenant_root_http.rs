//! HTTP routes for tenant-root provisioning on the VM Router and Derivers.
//!
//! Every route takes the role-shared service credential, as the Cloudflare
//! routes do; the Router's creation route is not a Gateway route and does not
//! accept the Gateway-to-Router credential.

use router_ab_cloudflare::{
    cloudflare_router_error_status, control_plane_create_tenant_root_v1,
    control_plane_initial_activation_v1, control_plane_pending_creation_cleanup_command_v1,
    control_plane_role_creation_command_v1, decode_tenant_root_cleanup_scope_v1,
    tenant_root_deriver_cleanup_v1, tenant_root_deriver_creation_evidence_v1,
    CloudflareDeriverTenantRootCleanupRequestV1, CloudflareDeriverTenantRootCreationEvidenceRequestV1,
    CLOUDFLARE_DERIVER_TENANT_ROOT_CREATION_EVIDENCE_PRIVATE_REQUEST_PATH,
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
    tenant_root_router_coordinate_creation_v1, tenant_root_router_sweep_abandoned_creation_v1,
    CloudflareTenantRootCreationJournalReadRequestV1,
    CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_SWEEP_PRIVATE_REQUEST_PATH,
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
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_REFRESH_PRIVATE_REQUEST_PATH => {
                Some(authorized_with_status(
                    &router.internal_service_auth,
                    request,
                    |refresh: router_ab_cloudflare::CloudflareRouterTenantRootRefreshRequestV1| {
                        let result = futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_coordinate_refresh_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                refresh,
                            ),
                        )?;
                        let (status, body) = result.http_status_and_body();
                        Ok((status, json(&body)?))
                    },
                ))
            }
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_MANAGED_RESTORE_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &router.internal_service_auth,
                    request,
                    |restore: router_ab_cloudflare::CloudflareRouterTenantRootManagedRestoreRequestV1| {
                        json(&futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_coordinate_managed_restore_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                restore,
                            ),
                        )?)
                    },
                ))
            }
            // Restore into a new deployment.
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_PRIVATE_REQUEST_PATH => {
                let token = request.destination_bootstrap_token.as_deref();
                Some(authorized(
                    &router.internal_service_auth,
                    request,
                    |bootstrap: router_ab_cloudflare::CloudflareTenantRootDestinationBootstrapRequestV1| {
                        json(&futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_destination_bootstrap_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                bootstrap,
                                token,
                            ),
                        )?)
                    },
                ))
            }
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &router.internal_service_auth,
                    request,
                    |manifest: router_ab_cloudflare::CloudflareTenantRootControlPlaneRegisterManifestRequestV1| {
                        json(&futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_register_manifest_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                manifest,
                            ),
                        )?)
                    },
                ))
            }
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &router.internal_service_auth,
                    request,
                    |import: router_ab_cloudflare::CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1| {
                        json(&futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_restore_role_import_key_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                import,
                            ),
                        )?)
                    },
                ))
            }
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ROLE_IMPORT_ACCEPT_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &router.internal_service_auth,
                    request,
                    |accept: router_ab_cloudflare::CloudflareRouterTenantRootRestoreRoleImportAcceptRequestV1| {
                        json(&futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_restore_role_import_accept_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                accept,
                            ),
                        )?)
                    },
                ))
            }
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &router.internal_service_auth,
                    request,
                    |refresh: router_ab_cloudflare::CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1| {
                        json(&futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_restore_refresh_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                refresh,
                            ),
                        )?
                        .into_response_body()?)
                    },
                ))
            }
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &router.internal_service_auth,
                    request,
                    |activation: router_ab_cloudflare::CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1| {
                        json(&futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_restore_activation_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                activation,
                            ),
                        )?)
                    },
                ))
            }
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_CLEANUP_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &router.internal_service_auth,
                    request,
                    |cleanup: router_ab_cloudflare::CloudflareRouterTenantRootRestoreCleanupRequestV1| {
                        json(&futures::executor::block_on(
                            router_ab_cloudflare::tenant_root_router_restore_cleanup_v1(
                                &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                                cleanup,
                            ),
                        )?)
                    },
                ))
            }
            CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_SWEEP_PRIVATE_REQUEST_PATH => Some(authorized(
                &router.internal_service_auth,
                request,
                |scope: CloudflareTenantRootCreationJournalReadRequestV1| {
                    json(&futures::executor::block_on(
                        tenant_root_router_sweep_abandoned_creation_v1(
                            &LocalRouterTenantRootCreationHostV1::new(&router.tenant_root),
                            scope,
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
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_REFRESH_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |refresh: router_ab_cloudflare::CloudflareDeriverTenantRootRefreshRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_refresh_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            refresh,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_MANAGED_RESTORE_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |restore: router_ab_cloudflare::CloudflareDeriverTenantRootManagedRestoreRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_managed_restore_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            restore,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_MANAGED_RESTORE_FORWARD_REFRESH_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |refresh: router_ab_cloudflare::CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_managed_restore_forward_refresh_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            refresh,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_REFRESH_ACTIVATION_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |activation: router_ab_cloudflare::CloudflareDeriverTenantRootRefreshActivationRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_refresh_activation_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            activation,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |import: router_ab_cloudflare::CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_restore_role_import_key_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            import,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_ROLE_IMPORT_ACCEPT_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |accept: router_ab_cloudflare::CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_restore_role_import_accept_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            accept,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |phase: router_ab_cloudflare::CloudflareDeriverTenantRootRestoreRefreshRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_restore_refresh_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            phase,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_CLEANUP_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |cleanup: router_ab_cloudflare::CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_restore_session_cleanup_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            cleanup,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_PREACTIVATION_CLEANUP_PRIVATE_REQUEST_PATH => {
            Some(authorized(
                credential,
                request,
                |cleanup: router_ab_cloudflare::CloudflareDeriverTenantRootPreactivationCleanupRequestV1| {
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::tenant_root_deriver_restore_preactivation_cleanup_v1(
                            &LocalTenantRootDeriverHostV1::new(tenant_root),
                            cleanup,
                            crate::local_router_coordinator::local_now_ms_v1()?,
                        ),
                    )?)
                },
            ))
        }
        CLOUDFLARE_DERIVER_TENANT_ROOT_CREATION_EVIDENCE_PRIVATE_REQUEST_PATH => Some(authorized(
            credential,
            request,
            |evidence: CloudflareDeriverTenantRootCreationEvidenceRequestV1| {
                json(&futures::executor::block_on(tenant_root_deriver_creation_evidence_v1(
                    &LocalTenantRootDeriverHostV1::new(tenant_root),
                    evidence,
                ))?)
            },
        )),
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
    authorized_with_status(credential, request, |parsed| Ok((200, handler(parsed)?)))
}

/// As `authorized`, for a handler that chooses its own success status.
pub(crate) fn authorized_with_status<T: DeserializeOwned>(
    credential: &str,
    request: &LocalDevHttpRequestPartsV1,
    handler: impl FnOnce(T) -> RouterAbProtocolResult<(u16, String)>,
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
    handler(parsed)
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
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |manifest: router_ab_cloudflare::CloudflareTenantRootControlPlaneRegisterManifestRequestV1| {
                json(&futures::executor::block_on(
                    router_ab_cloudflare::control_plane_register_manifest_v1(&host, manifest),
                )?)
            },
        ),
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |import: router_ab_cloudflare::CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1| {
                json(&futures::executor::block_on(
                    router_ab_cloudflare::control_plane_restore_role_import_key_v1(&host, import),
                )?)
            },
        ),
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_REFRESH_COMMANDS_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |commands: router_ab_cloudflare::CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1| {
                json(&futures::executor::block_on(
                    router_ab_cloudflare::control_plane_restore_refresh_commands_v1(&host, commands),
                )?)
            },
        ),
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |activation: router_ab_cloudflare::CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1| {
                json(&futures::executor::block_on(
                    router_ab_cloudflare::control_plane_restore_initial_activation_v1(&host, activation),
                )?)
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
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REFRESH_COMMANDS_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |commands: router_ab_cloudflare::CloudflareTenantRootControlPlaneRefreshCommandsRequestV1| {
                json(&futures::executor::block_on(
                    router_ab_cloudflare::control_plane_refresh_commands_v1(&host, commands),
                )?)
            },
        ),
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_CHALLENGE_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |challenge: router_ab_cloudflare::CloudflareTenantRootControlPlaneManagedRestoreChallengeRequestV1| {
                json(&futures::executor::block_on(
                    router_ab_cloudflare::control_plane_managed_restore_challenge_v1(&host, challenge),
                )?)
            },
        ),
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_AUTHORIZE_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |authorize: router_ab_cloudflare::CloudflareTenantRootControlPlaneManagedRestoreAuthorizeRequestV1| {
                json(&futures::executor::block_on(
                    router_ab_cloudflare::control_plane_managed_restore_authorize_v1(&host, authorize),
                )?)
            },
        ),
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REFRESH_ACTIVATION_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |activation: router_ab_cloudflare::CloudflareTenantRootControlPlaneRefreshActivationRequestV1| {
                json(&futures::executor::block_on(
                    router_ab_cloudflare::control_plane_refresh_activation_v1(&host, activation),
                )?)
            },
        ),
        CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH => authorized(
            credential,
            request,
            |cleanup: CloudflareTenantRootControlPlaneCleanupCommandRequestV1| match cleanup {
                CloudflareTenantRootControlPlaneCleanupCommandRequestV1::PendingCreation {
                    identity_digest_b64u,
                    custody_lineage_b64u,
                    role,
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
                            role,
                        ),
                    )?)
                }
                // Erasing a refreshed-out epoch: the role store executes the
                // command only once every admission on that epoch is settled.
                CloudflareTenantRootControlPlaneCleanupCommandRequestV1::RetiredAfterRefresh {
                    identity_digest_b64u,
                    custody_lineage_b64u,
                    role,
                    expected_retired_revision,
                    expected_active_revision,
                } => {
                    let (identity_digest, custody_lineage) = decode_tenant_root_cleanup_scope_v1(
                        &identity_digest_b64u,
                        &custody_lineage_b64u,
                    )?;
                    json(&futures::executor::block_on(
                        router_ab_cloudflare::control_plane_retired_cleanup_command_v1(
                            &host,
                            identity_digest,
                            custody_lineage,
                            role,
                            expected_retired_revision,
                            expected_active_revision,
                        ),
                    )?)
                }
            },
        ),
        _ => Ok((404, "the tenant-root control plane does not serve this path".to_owned())),
    };
    outcome.unwrap_or_else(error_response)
}
