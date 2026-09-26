//! VM Router A/B ECDSA registration and activation.
//!
//! Every role runs the shared ECDSA steps from `router_ab_cloudflare`; this
//! module is only the VM transport between them. The Router authenticates
//! the Gateway's ceremony session and posts each Deriver's private request
//! over HTTP; each Deriver loads its tenant-root role share from its
//! role-private SQLite file; the SigningWorker keeps the activated material
//! in its wallet store.
//!
//! Each route answers as its Cloudflare counterpart does, including a
//! protocol error's status and `Code: message` text, and accepts the same
//! credential: the ceremony JWT alone at the Router, the role-shared
//! credential at a Deriver, and the Router's dedicated ECDSA credential at
//! the SigningWorker.

use router_ab_cloudflare::{
    admit_cloudflare_router_ab_ecdsa_derivation_activation_v1,
    admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_v1,
    admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_v1,
    admit_cloudflare_router_ab_ecdsa_derivation_registration_v1,
    admit_signing_worker_wallet_ecdsa_presignature_v1,
    build_cloudflare_router_ed25519_jwks_jwt_verifier_v1,
    cloudflare_tenant_root_registration_binding_wire_v1,
    create_signing_worker_ecdsa_presign_session_v1,
    handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_private_request_v1,
    open_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_v1,
    parse_cloudflare_deriver_a_bindings_v1, parse_cloudflare_deriver_b_bindings_v1,
    parse_cloudflare_router_ab_ecdsa_derivation_activation_request_v1_json,
    parse_cloudflare_router_ab_ecdsa_derivation_registration_gateway_request_v1,
    parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json,
    parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_prepare_request_v1_json,
    parse_cloudflare_signing_worker_bindings_v1, prepare_cloudflare_deriver_ecdsa_registration_v1,
    prepare_signing_worker_wallet_ecdsa_from_pool_v1, router_ab_service_credential_matches_v1,
    router_trusted_source_digest_v1, signing_worker_ecdsa_presign_session_start_v1,
    signing_worker_ecdsa_stored_terminal_response_v1, signing_worker_wallet_ecdsa_owner_scope_v1,
    step_signing_worker_ecdsa_presign_session_v1, CloudflareDeriverAWorkerRuntimeV1,
    CloudflareDeriverBWorkerRuntimeV1, CloudflareDeriverSignerRuntimeV1,
    CloudflareEcdsaPrepareResponseV1,
    CloudflareRoleSeparatedRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1,
    CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1,
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1,
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
    CloudflareRouterAbEcdsaRegistrationAdmissionV1, CloudflareRouterBearerAuthorizationV1,
    CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    CloudflareRouterEcdsaAcceptedCapabilityBindingV1,
    CloudflareSignerRecipientProofBundleResponseV1,
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    CloudflareSigningWorkerEcdsaClaimAndConsumeV1, CloudflareSigningWorkerEcdsaPresignAuthorityV1,
    CloudflareSigningWorkerEcdsaPresignLiveSessionMapV1,
    CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1,
    CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
    CloudflareSigningWorkerEcdsaPresignSessionProgressV1,
    CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1, CloudflareSigningWorkerRuntimeV1,
    CloudflareSigningWorkerTerminalResponseCommitV1, CloudflareSigningWorkerWalletScopeV1,
    CloudflareWorkerRoleV1,
    CLOUDFLARE_DERIVER_A_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_DERIVER_B_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PUBLIC_REQUEST_PATH,
    CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PUBLIC_REQUEST_PATH,
    CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH,
    CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH,
    CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH,
    CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_INIT_PATH,
    CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_STEP_PATH,
    CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH,
    CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH,
};
use router_ab_core::{
    LocalServiceRoleV1, RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
    RouterAbEcdsaDerivationRegistrationPurposeV1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult,
};
use std::{
    collections::BTreeMap,
    sync::{Mutex, MutexGuard},
};

use super::{
    local_router_coordinator::local_now_ms_v1,
    local_signing_worker_wallet_sqlite::{
        claim_local_presign_authority_v1, load_local_presign_authority_v1,
        with_local_signing_worker_wallet_store_v1,
    },
    local_tenant_root::{
        local_router_tenant_root_admission_receipt_v1, LocalTenantRootDeriverHostV1,
    },
    local_tenant_root_http::{authorized, error_response, json},
    LocalDeriverTenantRootConfigV1, LocalDevHttpRequestPartsV1, LocalHttpServiceBindingClientV1,
    LocalRouterWorkerConfigV1, LocalSigningWorkerConfigV1, LocalWorkerRoleConfigV1,
};

/// Serves one ECDSA registration or activation route this role owns, or
/// returns `None` for any other path.
pub fn local_router_ab_ecdsa_route_v1(
    config: &LocalWorkerRoleConfigV1,
    request: &LocalDevHttpRequestPartsV1,
) -> Option<(u16, String)> {
    let path = request.path.as_str();
    let result = match config {
        LocalWorkerRoleConfigV1::Router(router) => match path {
            CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PUBLIC_REQUEST_PATH => {
                Some(ceremony_authorized(request, |authorization| {
                    register_at_router(router, request, authorization)
                }))
            }
            CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PUBLIC_REQUEST_PATH => {
                Some(ceremony_authorized(request, |authorization| {
                    activate_at_router(router, request, authorization)
                }))
            }
            CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH => {
                Some(gateway_authorized(&router.gateway_to_router_auth, request, || {
                    prepare_at_router(router, request)
                }))
            }
            CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH => {
                Some(gateway_authorized(&router.gateway_to_router_auth, request, || {
                    finalize_at_router(router, request)
                }))
            }
            _ => None,
        },
        LocalWorkerRoleConfigV1::DeriverA(deriver)
            if path
                == CLOUDFLARE_DERIVER_A_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PRIVATE_REQUEST_PATH =>
        {
            Some(authorized(
                &deriver.internal_service_auth,
                request,
                |private_request| register_at_deriver(&deriver.tenant_root, private_request),
            ))
        }
        LocalWorkerRoleConfigV1::DeriverB(deriver)
            if path
                == CLOUDFLARE_DERIVER_B_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PRIVATE_REQUEST_PATH =>
        {
            Some(authorized(
                &deriver.internal_service_auth,
                request,
                |private_request| register_at_deriver(&deriver.tenant_root, private_request),
            ))
        }
        LocalWorkerRoleConfigV1::SigningWorker(signing_worker) => match path {
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH => Some(authorized(
                &signing_worker.router_to_signing_worker_ecdsa_auth,
                request,
                |activation| activate_at_signing_worker(signing_worker, activation),
            )),
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH => {
                Some(authorized(
                    &signing_worker.router_to_signing_worker_ecdsa_auth,
                    request,
                    |admitted| prepare_at_signing_worker(signing_worker, admitted),
                ))
            }
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH => Some(authorized(
                &signing_worker.router_to_signing_worker_ecdsa_auth,
                request,
                |admitted| finalize_at_signing_worker(signing_worker, admitted),
            )),
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_INIT_PATH => {
                Some(authorized(
                    &signing_worker.gateway_to_signing_worker_presign_auth,
                    request,
                    |init| start_presign_session(signing_worker, init),
                ))
            }
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_STEP_PATH => {
                Some(authorized(
                    &signing_worker.gateway_to_signing_worker_presign_auth,
                    request,
                    |step| step_presign_session(signing_worker, step),
                ))
            }
            _ => None,
        },
        _ => None,
    }?;
    Some(result.unwrap_or_else(error_response))
}

/// A Router ceremony route: POST with the Gateway's ceremony JWT, which is
/// the only credential these routes take on Cloudflare too.
fn ceremony_authorized(
    request: &LocalDevHttpRequestPartsV1,
    handler: impl FnOnce(CloudflareRouterBearerAuthorizationV1) -> RouterAbProtocolResult<String>,
) -> RouterAbProtocolResult<(u16, String)> {
    if request.method != "POST" {
        return Ok((405, "Router ECDSA ceremony route requires POST".to_owned()));
    }
    let header = request.authorization.as_deref().ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Bearer authorization is required",
        )
    })?;
    let authorization = CloudflareRouterBearerAuthorizationV1::from_authorization_header(header)?;
    Ok((200, handler(authorization)?))
}

/// A Router signing route: POST with the Gateway's Gateway-to-Router
/// credential, as on Cloudflare.
fn gateway_authorized(
    credential: &str,
    request: &LocalDevHttpRequestPartsV1,
    handler: impl FnOnce() -> RouterAbProtocolResult<String>,
) -> RouterAbProtocolResult<(u16, String)> {
    if request.method != "POST" {
        return Ok((405, "Router ECDSA signing route requires POST".to_owned()));
    }
    let presented = request.internal_service_auth.as_deref().unwrap_or_default();
    if !router_ab_service_credential_matches_v1(credential, presented) {
        return Ok((
            401,
            "Router ECDSA signing requires the Gateway-to-Router credential".to_owned(),
        ));
    }
    Ok((200, handler()?))
}

fn register_at_router(
    config: &LocalRouterWorkerConfigV1,
    request: &LocalDevHttpRequestPartsV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
) -> RouterAbProtocolResult<String> {
    let purpose = RouterAbEcdsaDerivationRegistrationPurposeV1::WalletRegistration;
    let (registration_request, identity_digest, custody_lineage) =
        parse_cloudflare_router_ab_ecdsa_derivation_registration_gateway_request_v1(&request.body)?;
    registration_request.validate_for_registration_purpose(purpose)?;
    let active_receipt = local_router_tenant_root_admission_receipt_v1(
        &config.tenant_root,
        identity_digest,
        custody_lineage,
    )?;
    let custody_binding = cloudflare_tenant_root_registration_binding_wire_v1(
        &registration_request,
        purpose,
        &active_receipt,
    )?;
    let verifier =
        build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(&config.admission_bindings.jwt)?;
    let admission = admit_cloudflare_router_ab_ecdsa_derivation_registration_v1(
        &config.admission_bindings,
        &config.tenant_root.env,
        local_now_ms_v1()?,
        registration_request,
        &custody_binding,
        authorization,
        // A VM Router has no edge source metadata.
        router_trusted_source_digest_v1(None, None),
        verifier,
    )?;
    let forward = match admission {
        CloudflareRouterAbEcdsaRegistrationAdmissionV1::Forward(forward) => forward,
        CloudflareRouterAbEcdsaRegistrationAdmissionV1::Stopped(response) => {
            return json(&response)
        }
    };
    // Both Derivers work at once, as the Cloudflare Router's joined calls do.
    let client = LocalHttpServiceBindingClientV1::default();
    let post = |url: &str, role, path, private_request| {
        client.post_json_authenticated_v1::<_, CloudflareSignerRecipientProofBundleResponseV1>(
            url,
            role,
            path,
            &config.internal_service_auth,
            private_request,
        )
    };
    let (deriver_a, deriver_b) = std::thread::scope(|scope| {
        let deriver_a = scope.spawn(|| {
            post(
                &config.deriver_a_url,
                LocalServiceRoleV1::DeriverA,
                CLOUDFLARE_DERIVER_A_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PRIVATE_REQUEST_PATH,
                &forward.deriver_a,
            )
        });
        let deriver_b = post(
            &config.deriver_b_url,
            LocalServiceRoleV1::DeriverB,
            CLOUDFLARE_DERIVER_B_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PRIVATE_REQUEST_PATH,
            &forward.deriver_b,
        );
        (deriver_a.join(), deriver_b)
    });
    let deriver_a = deriver_a.map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Deriver A registration call panicked",
        )
    })??;
    json(&forward.finish_with_deriver_responses(deriver_a, deriver_b?)?)
}

fn activate_at_router(
    config: &LocalRouterWorkerConfigV1,
    request: &LocalDevHttpRequestPartsV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
) -> RouterAbProtocolResult<String> {
    let command =
        parse_cloudflare_router_ab_ecdsa_derivation_activation_request_v1_json(&request.body)?;
    let verifier =
        build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(&config.admission_bindings.jwt)?;
    let signing_worker_request = admit_cloudflare_router_ab_ecdsa_derivation_activation_v1(
        &config.admission_bindings,
        local_now_ms_v1()?,
        command,
        authorization,
        router_trusted_source_digest_v1(None, None),
        verifier,
    )?;
    let receipt = LocalHttpServiceBindingClientV1::default()
        .post_json_authenticated_v1::<_, CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1>(
            &config.signing_worker_url,
            LocalServiceRoleV1::SigningWorker,
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH,
            &config.router_to_signing_worker_ecdsa_auth,
            &signing_worker_request,
        )?;
    receipt.validate()?;
    json(&receipt)
}

fn register_at_deriver(
    tenant_root: &LocalDeriverTenantRootConfigV1,
    private_request: CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1,
) -> RouterAbProtocolResult<String> {
    match tenant_root.worker_role {
        CloudflareWorkerRoleV1::DeriverA => {
            let runtime = CloudflareDeriverAWorkerRuntimeV1::new(
                parse_cloudflare_deriver_a_bindings_v1(&tenant_root.env)?,
            )?;
            register_with_runtime(tenant_root, &runtime, private_request)
        }
        CloudflareWorkerRoleV1::DeriverB => {
            let runtime = CloudflareDeriverBWorkerRuntimeV1::new(
                parse_cloudflare_deriver_b_bindings_v1(&tenant_root.env)?,
            )?;
            register_with_runtime(tenant_root, &runtime, private_request)
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "ECDSA registration is served by Deriver A or Deriver B",
        )),
    }
}

fn register_with_runtime(
    tenant_root: &LocalDeriverTenantRootConfigV1,
    runtime: &impl CloudflareDeriverSignerRuntimeV1,
    private_request: CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1,
) -> RouterAbProtocolResult<String> {
    let now_ms = local_now_ms_v1()?;
    let registration =
        futures::executor::block_on(prepare_cloudflare_deriver_ecdsa_registration_v1(
            &LocalTenantRootDeriverHostV1::new(tenant_root),
            runtime,
            private_request,
            now_ms,
            Vec::new(),
        ))?;
    json(&registration.execute_deriver_registration(&tenant_root.env, runtime, now_ms)?)
}

fn activate_at_signing_worker(
    config: &LocalSigningWorkerConfigV1,
    activation: CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
) -> RouterAbProtocolResult<String> {
    let runtime = CloudflareSigningWorkerRuntimeV1::new(
        parse_cloudflare_signing_worker_bindings_v1(&config.cloudflare_env)?,
    )?;
    let opened = open_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_v1(
        &runtime,
        &config.cloudflare_env,
        activation,
    )?;
    let activated_at_ms = local_now_ms_v1()?;
    let receipt = with_local_signing_worker_wallet_store_v1(config, |store, _| {
        opened.activate_in_wallet_store(store, activated_at_ms)
    })?;
    json(&receipt)
}

/// The SigningWorker's live presignature sessions. Like a presignature
/// session Durable Object's memory, they last only for the ceremony: a
/// restart loses them, and the Gateway restarts pool fill.
static PRESIGN_SESSIONS: Mutex<CloudflareSigningWorkerEcdsaPresignLiveSessionMapV1> =
    Mutex::new(BTreeMap::new());

fn live_presign_sessions(
) -> RouterAbProtocolResult<MutexGuard<'static, CloudflareSigningWorkerEcdsaPresignLiveSessionMapV1>>
{
    PRESIGN_SESSIONS.lock().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker presignature sessions are unavailable",
        )
    })
}

/// The wallet a presignature session fills. A VM SigningWorker serves the
/// owner Wallet Session path; operation step-up fails closed.
fn owner_wallet_scope(
    authority: &CloudflareSigningWorkerEcdsaPresignAuthorityV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerWalletScopeV1> {
    match authority {
        CloudflareSigningWorkerEcdsaPresignAuthorityV1::OwnerWalletSession { wallet_scope } => {
            Ok(wallet_scope.clone())
        }
        CloudflareSigningWorkerEcdsaPresignAuthorityV1::OperationStepUp => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "VM SigningWorker presignature sessions serve owner Wallet Sessions only",
            ))
        }
    }
}

fn start_presign_session(
    config: &LocalSigningWorkerConfigV1,
    request: CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
) -> RouterAbProtocolResult<String> {
    let now_ms = local_now_ms_v1()?;
    request.validate_at(now_ms)?;
    let wallet_scope = owner_wallet_scope(&request.authority)?;
    // The wallet's material is read and the session's authority claimed in
    // one transaction, before the session emits any server message.
    let start = with_local_signing_worker_wallet_store_v1(config, |store, sql| {
        let (active, material) = store.load_activated_material(&wallet_scope, &request.scope)?;
        claim_local_presign_authority_v1(sql, &request, now_ms)?;
        signing_worker_ecdsa_presign_session_start_v1(request, &active, &material)
    })?;
    let progress = create_signing_worker_ecdsa_presign_session_v1(
        start,
        &mut *live_presign_sessions()?,
        now_ms,
    )?;
    let CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Continue {
        presign_session_id,
        stage,
        event,
        outgoing_messages_b64u,
    } = progress
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker ECDSA presign init returned terminal state",
        ));
    };
    json(
        &CloudflareSigningWorkerEcdsaPresignSessionProgressV1::Continue {
            presign_session_id,
            stage,
            event,
            outgoing_messages_b64u,
        },
    )
}

fn step_presign_session(
    config: &LocalSigningWorkerConfigV1,
    request: CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1,
) -> RouterAbProtocolResult<String> {
    let now_ms = local_now_ms_v1()?;
    request.validate_at(now_ms)?;
    let pinned = with_local_signing_worker_wallet_store_v1(config, |_, sql| {
        load_local_presign_authority_v1(sql, &request.presign_session_id, now_ms)
    })?;
    if request.authority != pinned {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "SigningWorker ECDSA presign authority does not match initialized session",
        ));
    }
    let presign_session_id = request.presign_session_id.clone();
    let progress = step_signing_worker_ecdsa_presign_session_v1(
        request,
        &mut *live_presign_sessions()?,
        now_ms,
    )?;
    match progress {
        CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Continue {
            presign_session_id,
            stage,
            event,
            outgoing_messages_b64u,
        } => json(
            &CloudflareSigningWorkerEcdsaPresignSessionProgressV1::Continue {
                presign_session_id,
                stage,
                event,
                outgoing_messages_b64u,
            },
        ),
        CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Complete {
            authority,
            pool_put_request,
            outgoing_messages_b64u,
        } => {
            let wallet_scope = owner_wallet_scope(&authority)?;
            let server_presignature_id = pool_put_request.server_presignature_id.clone();
            let server_big_r33_b64u = pool_put_request.server_big_r33_b64u.clone();
            with_local_signing_worker_wallet_store_v1(config, |store, _| {
                admit_signing_worker_wallet_ecdsa_presignature_v1(
                    store,
                    &wallet_scope,
                    pool_put_request,
                    now_ms,
                )
            })?;
            json(
                &CloudflareSigningWorkerEcdsaPresignSessionProgressV1::Complete {
                    outgoing_messages_b64u,
                    presign_session_id,
                    server_presignature_id,
                    server_big_r33_b64u,
                    signing_worker_rerandomization_contribution32_b64u: None,
                    prepared_response: None,
                },
            )
        }
    }
}

/// The VM Router serves the Gateway owner Wallet Session path; linked-device
/// and operation step-up signing fail closed.
fn require_gateway_owner_wallet_session(
    authorized_operation: &CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    request: &LocalDevHttpRequestPartsV1,
) -> RouterAbProtocolResult<()> {
    // The Gateway strips the user's bearer token; a Wallet Session request
    // that still carries one did not come through the Gateway proxy.
    if request.authorization.is_some() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
            "Gateway Wallet Session requests must omit Authorization",
        ));
    }
    match &authorized_operation.binding {
        CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. } => {
            Ok(())
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "VM Router ECDSA signing serves Gateway owner Wallet Sessions only",
        )),
    }
}

fn prepare_at_router(
    config: &LocalRouterWorkerConfigV1,
    request: &LocalDevHttpRequestPartsV1,
) -> RouterAbProtocolResult<String> {
    let (signing_request, authorized_operation, presign_source) =
        parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_prepare_request_v1_json(
            &request.body,
        )?;
    require_gateway_owner_wallet_session(&authorized_operation, request)?;
    // A VM Router has no edge source metadata.
    let trusted_source_digest = router_trusted_source_digest_v1(None, None);
    let credential =
        authorized_operation.gateway_owner_wallet_session_credential(trusted_source_digest)?;
    let admitted = admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_v1(
        &config.admission_bindings,
        local_now_ms_v1()?,
        signing_request,
        authorized_operation,
        presign_source,
        credential,
        trusted_source_digest,
        build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(&config.admission_bindings.jwt)?,
    )?;
    let response = LocalHttpServiceBindingClientV1::default()
        .post_json_authenticated_v1::<_, CloudflareEcdsaPrepareResponseV1>(
            &config.signing_worker_url,
            LocalServiceRoleV1::SigningWorker,
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH,
            &config.router_to_signing_worker_ecdsa_auth,
            &admitted,
        )?;
    response.validate_for_request(&admitted.request, &admitted.presign_source)?;
    json(&response)
}

fn finalize_at_router(
    config: &LocalRouterWorkerConfigV1,
    request: &LocalDevHttpRequestPartsV1,
) -> RouterAbProtocolResult<String> {
    let (signing_request, authorized_operation) =
        parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json(
            &request.body,
        )?;
    require_gateway_owner_wallet_session(&authorized_operation, request)?;
    let trusted_source_digest = router_trusted_source_digest_v1(None, None);
    let credential =
        authorized_operation.gateway_owner_wallet_session_credential(trusted_source_digest)?;
    let admitted = admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_v1(
        &config.admission_bindings,
        local_now_ms_v1()?,
        signing_request,
        authorized_operation,
        credential,
        trusted_source_digest,
        build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(&config.admission_bindings.jwt)?,
    )?;
    let response = LocalHttpServiceBindingClientV1::default()
        .post_json_authenticated_v1::<_, RouterAbEcdsaDerivationEvmDigestSigningResponseV1>(
        &config.signing_worker_url,
        LocalServiceRoleV1::SigningWorker,
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH,
        &config.router_to_signing_worker_ecdsa_auth,
        &admitted,
    )?;
    response.validate_for_request(&admitted.request)?;
    json(&response)
}

fn prepare_at_signing_worker(
    config: &LocalSigningWorkerConfigV1,
    admitted: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
) -> RouterAbProtocolResult<String> {
    let now_ms = local_now_ms_v1()?;
    let mut contribution = [0u8; 32];
    getrandom::getrandom(&mut contribution).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("SigningWorker randomness is unavailable: {error}"),
        )
    })?;
    // The reservation and the response built from it commit together; a
    // failure before the response leaves the presignature available.
    let response = with_local_signing_worker_wallet_store_v1(config, |store, _| {
        prepare_signing_worker_wallet_ecdsa_from_pool_v1(store, admitted, now_ms, contribution)
    })?;
    json(&response)
}

fn finalize_at_signing_worker(
    config: &LocalSigningWorkerConfigV1,
    admitted: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
) -> RouterAbProtocolResult<String> {
    let now_ms = local_now_ms_v1()?;
    admitted.validate()?;
    let wallet_scope =
        signing_worker_wallet_ecdsa_owner_scope_v1(admitted.wallet_scope.as_ref())?.clone();
    // Stale material fails before the one-use claim. The claim and the
    // presignature it consumes commit before any signing work, as in the
    // wallet's Durable Object.
    let (active, material, claim) =
        with_local_signing_worker_wallet_store_v1(config, |store, _| {
            let (active, material) = store.load_normal_signing_material(
                &wallet_scope,
                &admitted.request.scope,
                &admitted.material_source,
            )?;
            let claim =
                store.claim_and_consume_effect(wallet_scope.clone(), admitted.clone(), now_ms)?;
            Ok((active, material, claim))
        })?;
    let presignature = match claim {
        CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Claimed { material } => material,
        CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Replay { terminal_json } => {
            return json(&signing_worker_ecdsa_stored_terminal_response_v1(
                &terminal_json,
                &admitted.request,
            )?);
        }
        CloudflareSigningWorkerEcdsaClaimAndConsumeV1::InProgress => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "SigningWorker ECDSA effect is already in progress",
            ));
        }
        CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Burned => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "SigningWorker ECDSA reservation was terminally burned before finalization",
            ));
        }
    };
    let response =
        handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_private_request_v1(
            &CloudflareRoleSeparatedRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1,
            now_ms,
            admitted.clone(),
            active,
            material,
            presignature,
        )?;
    response.validate_for_request(&admitted.request)?;
    let committed = with_local_signing_worker_wallet_store_v1(config, |store, _| {
        store.commit_terminal(&wallet_scope, &admitted, &response, now_ms)
    })?;
    match committed {
        CloudflareSigningWorkerTerminalResponseCommitV1::Committed => json(&response),
        CloudflareSigningWorkerTerminalResponseCommitV1::Replay { response_json } => json(
            &signing_worker_ecdsa_stored_terminal_response_v1(&response_json, &admitted.request)?,
        ),
    }
}
