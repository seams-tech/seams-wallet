//! VM Router A/B ECDSA registration, activation, presignatures, signing and
//! explicit export.
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
    admit_cloudflare_router_ab_ecdsa_derivation_export_v1,
    parse_cloudflare_router_ab_ecdsa_derivation_export_command_v1_json,
    preflight_signing_worker_wallet_ecdsa_export_v1, prepare_cloudflare_deriver_ecdsa_export_v1,
    seal_signing_worker_wallet_ecdsa_export_share_v1,
    validate_cloudflare_signing_worker_ecdsa_export_share_envelope_v1,
    CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1,
    CloudflareRouterAbEcdsaDerivationExportAdmissionResponseV1,
    CloudflareRouterAbEcdsaExportAdmissionV1, CloudflareSignerClientRecipientProofBundleResponseV1,
    CloudflareSigningWorkerEcdsaExportPreflightResponseV1,
    CloudflareSigningWorkerEcdsaExportShareRequestV1, EcdsaSigningWorkerExportShareEnvelopeV1,
    CLOUDFLARE_DERIVER_A_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_DERIVER_B_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ADD_SIGNER_PUBLIC_REQUEST_PATH,
    CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PUBLIC_REQUEST_PATH,
    CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PREFLIGHT_PATH,
    CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_SHARE_PATH,
};
use router_ab_cloudflare::{
    admit_cloudflare_router_ab_ecdsa_derivation_activation_v1,
    admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_v1,
    admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_v1,
    admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_step_up_finalize_v1,
    admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_step_up_prepare_v1,
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
    signing_worker_ecdsa_stored_terminal_response_v1, signing_worker_wallet_ecdsa_scope_v1,
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
    CloudflareSigningWorkerEcdsaClaimAndConsumeV1,
    CloudflareSigningWorkerEcdsaPresignLiveSessionMapV1,
    CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1,
    CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
    CloudflareSigningWorkerEcdsaPresignSessionProgressV1,
    CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1, CloudflareSigningWorkerRuntimeV1,
    CloudflareSigningWorkerTerminalResponseCommitV1,
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
    SIGNING_WORKER_ECDSA_EFFECT_IN_PROGRESS_V1,
};
use router_ab_core::{
    LocalServiceRoleV1, RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
    RouterAbEcdsaDerivationRegistrationPurposeV1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult,
};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    sync::{Mutex, MutexGuard},
    time::Instant,
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

/// One ECDSA route's response, with the `Server-Timing` spans the Workers
/// role reports for the same route.
pub struct LocalRouterAbEcdsaResponseV1 {
    pub status: u16,
    pub body: String,
    pub server_timing: Option<String>,
}

/// Serves one ECDSA route this role owns, or returns `None` for any other
/// path.
pub fn local_router_ab_ecdsa_route_v1(
    config: &LocalWorkerRoleConfigV1,
    request: &LocalDevHttpRequestPartsV1,
) -> Option<LocalRouterAbEcdsaResponseV1> {
    let path = request.path.as_str();
    let server_timing = RefCell::new(None);
    let result = match config {
        LocalWorkerRoleConfigV1::Router(router) => match path {
            CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PUBLIC_REQUEST_PATH => {
                Some(ceremony_authorized(request, |authorization| {
                    register_at_router(
                        router,
                        request,
                        authorization,
                        RouterAbEcdsaDerivationRegistrationPurposeV1::WalletRegistration,
                    )
                }))
            }
            CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ADD_SIGNER_PUBLIC_REQUEST_PATH => {
                Some(ceremony_authorized(request, |authorization| {
                    register_at_router(
                        router,
                        request,
                        authorization,
                        RouterAbEcdsaDerivationRegistrationPurposeV1::WalletAddSigner,
                    )
                }))
            }
            CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PUBLIC_REQUEST_PATH => {
                Some(ceremony_authorized(request, |authorization| {
                    activate_at_router(router, request, authorization)
                }))
            }
            CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PUBLIC_REQUEST_PATH => {
                Some(ceremony_authorized(request, |authorization| {
                    export_at_router(router, request, authorization)
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
        LocalWorkerRoleConfigV1::DeriverA(deriver) => match path {
            CLOUDFLARE_DERIVER_A_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &deriver.internal_service_auth,
                    request,
                    |private_request| register_at_deriver(&deriver.tenant_root, private_request),
                ))
            }
            CLOUDFLARE_DERIVER_A_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &deriver.internal_service_auth,
                    request,
                    |private_request| export_at_deriver(&deriver.tenant_root, private_request),
                ))
            }
            _ => None,
        },
        LocalWorkerRoleConfigV1::DeriverB(deriver) => match path {
            CLOUDFLARE_DERIVER_B_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &deriver.internal_service_auth,
                    request,
                    |private_request| register_at_deriver(&deriver.tenant_root, private_request),
                ))
            }
            CLOUDFLARE_DERIVER_B_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PRIVATE_REQUEST_PATH => {
                Some(authorized(
                    &deriver.internal_service_auth,
                    request,
                    |private_request| export_at_deriver(&deriver.tenant_root, private_request),
                ))
            }
            _ => None,
        },
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
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PREFLIGHT_PATH => {
                Some(authorized(
                    &signing_worker.router_to_signing_worker_ecdsa_auth,
                    request,
                    |export| export_preflight_at_signing_worker(signing_worker, export),
                ))
            }
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_SHARE_PATH => {
                Some(authorized(
                    &signing_worker.router_to_signing_worker_ecdsa_auth,
                    request,
                    |export| export_share_at_signing_worker(signing_worker, export),
                ))
            }
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_INIT_PATH => {
                Some(authorized(
                    &signing_worker.gateway_to_signing_worker_presign_auth,
                    request,
                    |init| start_presign_session(signing_worker, init, &server_timing),
                ))
            }
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_STEP_PATH => {
                Some(authorized(
                    &signing_worker.gateway_to_signing_worker_presign_auth,
                    request,
                    |step| step_presign_session(signing_worker, step, &server_timing),
                ))
            }
            _ => None,
        },
    }?;
    let (status, body) = result.unwrap_or_else(error_response);
    Some(LocalRouterAbEcdsaResponseV1 {
        status,
        body,
        server_timing: server_timing.into_inner(),
    })
}

/// `Server-Timing` spans for one presignature step, named as the Workers
/// SigningWorker names them. The in-process session map stands where the
/// Workers presignature-session Durable Object does, so its time also
/// reports as that Durable Object's total.
struct LocalPresignTimingV1 {
    started: Instant,
    entries: Vec<(&'static str, u128)>,
}

impl LocalPresignTimingV1 {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            entries: Vec::new(),
        }
    }

    fn mark(&mut self, name: &'static str, since: Instant) {
        self.entries.push((name, since.elapsed().as_millis()));
    }

    fn mark_session(&mut self, since: Instant) {
        self.mark("ecdsa_presign_sw_session", since);
        self.mark("ecdsa_presign_sw_do_total", since);
    }

    fn finish(mut self, into: &RefCell<Option<String>>) {
        let started = self.started;
        self.mark("ecdsa_presign_sw_total", started);
        let header = self
            .entries
            .iter()
            .map(|(name, duration_ms)| format!("{name};dur={duration_ms}"))
            .collect::<Vec<_>>()
            .join(", ");
        into.replace(Some(header));
    }
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

/// Registers ECDSA material for a new wallet, or for an existing wallet's
/// added signer: the same Router, Deriver and SigningWorker work, bound to its
/// purpose.
fn register_at_router(
    config: &LocalRouterWorkerConfigV1,
    request: &LocalDevHttpRequestPartsV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
    purpose: RouterAbEcdsaDerivationRegistrationPurposeV1,
) -> RouterAbProtocolResult<String> {
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

fn export_at_router(
    config: &LocalRouterWorkerConfigV1,
    request: &LocalDevHttpRequestPartsV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
) -> RouterAbProtocolResult<String> {
    let command = parse_cloudflare_router_ab_ecdsa_derivation_export_command_v1_json(&request.body)?;
    let (identity_digest, custody_lineage) = command.tenant_root.resolve()?;
    let active_receipt = local_router_tenant_root_admission_receipt_v1(
        &config.tenant_root,
        identity_digest,
        custody_lineage,
    )?;
    let verifier =
        build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(&config.admission_bindings.jwt)?;
    // A VM Router writes export audit lines to its process log.
    let mut audit = |line: &str| eprintln!("{line}");
    let forward = match admit_cloudflare_router_ab_ecdsa_derivation_export_v1(
        &config.admission_bindings,
        local_now_ms_v1()?,
        command,
        &active_receipt,
        authorization,
        router_trusted_source_digest_v1(None, None),
        verifier,
        &mut audit,
    )? {
        CloudflareRouterAbEcdsaExportAdmissionV1::Forward(forward) => forward,
        CloudflareRouterAbEcdsaExportAdmissionV1::Stopped(response) => return json(&response),
    };
    let client = LocalHttpServiceBindingClientV1::default();
    let preflight = client
        .post_json_authenticated_v1::<_, CloudflareSigningWorkerEcdsaExportPreflightResponseV1>(
            &config.signing_worker_url,
            LocalServiceRoleV1::SigningWorker,
            CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PREFLIGHT_PATH,
            &config.router_to_signing_worker_ecdsa_auth,
            &forward.signing_worker,
        )?;
    if !preflight.ready {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "SigningWorker rejected active ECDSA export material preflight",
        ));
    }
    // Both Derivers work at once, as the Cloudflare Router's joined calls do.
    let post = |url: &str, role, path, private_request| {
        client
            .post_json_authenticated_v1::<_, CloudflareSignerClientRecipientProofBundleResponseV1>(
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
                CLOUDFLARE_DERIVER_A_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PRIVATE_REQUEST_PATH,
                &forward.deriver_a,
            )
        });
        let deriver_b = post(
            &config.deriver_b_url,
            LocalServiceRoleV1::DeriverB,
            CLOUDFLARE_DERIVER_B_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PRIVATE_REQUEST_PATH,
            &forward.deriver_b,
        );
        (deriver_a.join(), deriver_b)
    });
    let deriver_a = deriver_a.map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Deriver A export call panicked",
        )
    })?;
    let deriver_a =
        forward.accept_deriver_result(CloudflareWorkerRoleV1::DeriverA, deriver_a, &mut audit)?;
    let deriver_b =
        forward.accept_deriver_result(CloudflareWorkerRoleV1::DeriverB, deriver_b, &mut audit)?;
    let response = forward.client_bundles(deriver_a, deriver_b, &mut audit)?;
    let envelope = client.post_json_authenticated_v1::<_, EcdsaSigningWorkerExportShareEnvelopeV1>(
        &config.signing_worker_url,
        LocalServiceRoleV1::SigningWorker,
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_SHARE_PATH,
        &config.router_to_signing_worker_ecdsa_auth,
        &forward.signing_worker,
    )?;
    json(&CloudflareRouterAbEcdsaDerivationExportAdmissionResponseV1::forwarded(
        response,
        validate_cloudflare_signing_worker_ecdsa_export_share_envelope_v1(envelope)?,
    )?)
}

fn export_at_deriver(
    tenant_root: &LocalDeriverTenantRootConfigV1,
    private_request: CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1,
) -> RouterAbProtocolResult<String> {
    match tenant_root.worker_role {
        CloudflareWorkerRoleV1::DeriverA => {
            let runtime = CloudflareDeriverAWorkerRuntimeV1::new(
                parse_cloudflare_deriver_a_bindings_v1(&tenant_root.env)?,
            )?;
            export_with_runtime(tenant_root, &runtime, private_request)
        }
        CloudflareWorkerRoleV1::DeriverB => {
            let runtime = CloudflareDeriverBWorkerRuntimeV1::new(
                parse_cloudflare_deriver_b_bindings_v1(&tenant_root.env)?,
            )?;
            export_with_runtime(tenant_root, &runtime, private_request)
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "ECDSA export is served by Deriver A or Deriver B",
        )),
    }
}

fn export_with_runtime(
    tenant_root: &LocalDeriverTenantRootConfigV1,
    runtime: &impl CloudflareDeriverSignerRuntimeV1,
    private_request: CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1,
) -> RouterAbProtocolResult<String> {
    let now_ms = local_now_ms_v1()?;
    let export = futures::executor::block_on(prepare_cloudflare_deriver_ecdsa_export_v1(
        &LocalTenantRootDeriverHostV1::new(tenant_root),
        runtime,
        private_request,
        now_ms,
        Vec::new(),
    ))?;
    json(&export.execute_deriver_export(&tenant_root.env, runtime, now_ms)?)
}

fn export_preflight_at_signing_worker(
    config: &LocalSigningWorkerConfigV1,
    export: CloudflareSigningWorkerEcdsaExportShareRequestV1,
) -> RouterAbProtocolResult<String> {
    let now_ms = local_now_ms_v1()?;
    let response = with_local_signing_worker_wallet_store_v1(config, |store, _| {
        preflight_signing_worker_wallet_ecdsa_export_v1(store, &export, now_ms)
    })?;
    json(&response)
}

fn export_share_at_signing_worker(
    config: &LocalSigningWorkerConfigV1,
    export: CloudflareSigningWorkerEcdsaExportShareRequestV1,
) -> RouterAbProtocolResult<String> {
    let now_ms = local_now_ms_v1()?;
    let mut seal_seed = [0u8; 32];
    getrandom::getrandom(&mut seal_seed).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("SigningWorker randomness is unavailable: {error}"),
        )
    })?;
    let envelope = with_local_signing_worker_wallet_store_v1(config, |store, _| {
        seal_signing_worker_wallet_ecdsa_export_share_v1(store, &export, now_ms, seal_seed)
    })?;
    json(&envelope)
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

fn start_presign_session(
    config: &LocalSigningWorkerConfigV1,
    request: CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
    server_timing: &RefCell<Option<String>>,
) -> RouterAbProtocolResult<String> {
    let mut timing = LocalPresignTimingV1::new();
    let now_ms = local_now_ms_v1()?;
    request.validate_at(now_ms)?;
    let wallet_scope = request.authority.wallet_scope().clone();
    // The wallet's material is read and the session's authority claimed in
    // one transaction, before the session emits any server message.
    let material_started = Instant::now();
    let start = with_local_signing_worker_wallet_store_v1(config, |store, sql| {
        let (active, material) = store.load_activated_material(&wallet_scope, &request.scope)?;
        claim_local_presign_authority_v1(sql, &request, now_ms)?;
        signing_worker_ecdsa_presign_session_start_v1(request, &active, &material)
    })?;
    timing.mark("ecdsa_presign_sw_material", material_started);
    let session_started = Instant::now();
    let progress = create_signing_worker_ecdsa_presign_session_v1(
        start,
        &mut *live_presign_sessions()?,
        now_ms,
    )?;
    timing.mark_session(session_started);
    timing.finish(server_timing);
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
    server_timing: &RefCell<Option<String>>,
) -> RouterAbProtocolResult<String> {
    let mut timing = LocalPresignTimingV1::new();
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
    let session_started = Instant::now();
    let progress = step_signing_worker_ecdsa_presign_session_v1(
        request,
        &mut *live_presign_sessions()?,
        now_ms,
    )?;
    timing.mark_session(session_started);
    match progress {
        CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Continue {
            presign_session_id,
            stage,
            event,
            outgoing_messages_b64u,
        } => {
            timing.finish(server_timing);
            json(
                &CloudflareSigningWorkerEcdsaPresignSessionProgressV1::Continue {
                    presign_session_id,
                    stage,
                    event,
                    outgoing_messages_b64u,
                },
            )
        }
        CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Complete {
            authority,
            pool_put_request,
            outgoing_messages_b64u,
        } => {
            let wallet_scope = authority.wallet_scope().clone();
            let server_presignature_id = pool_put_request.server_presignature_id.clone();
            let server_big_r33_b64u = pool_put_request.server_big_r33_b64u.clone();
            let admission_started = Instant::now();
            with_local_signing_worker_wallet_store_v1(config, |store, _| {
                admit_signing_worker_wallet_ecdsa_presignature_v1(
                    store,
                    &wallet_scope,
                    pool_put_request,
                    now_ms,
                )
            })?;
            timing.mark("ecdsa_presign_sw_admit", admission_started);
            timing.finish(server_timing);
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

/// How the Gateway authorized one forwarded ECDSA signing request. The VM
/// Router serves an owner Wallet Session and a verified operation step-up;
/// linked-device signing fails closed.
enum GatewayEcdsaAuthorizationV1 {
    OwnerWalletSession,
    OperationStepUp,
}

fn gateway_ecdsa_authorization(
    authorized_operation: &CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    request: &LocalDevHttpRequestPartsV1,
) -> RouterAbProtocolResult<GatewayEcdsaAuthorizationV1> {
    match &authorized_operation.binding {
        CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. } => {
            // The Gateway strips the user's bearer token; a Wallet Session
            // request that still carries one did not come through its proxy.
            if request.authorization.is_some() {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                    "Gateway Wallet Session requests must omit Authorization",
                ));
            }
            Ok(GatewayEcdsaAuthorizationV1::OwnerWalletSession)
        }
        CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp { .. } => {
            Ok(GatewayEcdsaAuthorizationV1::OperationStepUp)
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "VM Router ECDSA signing serves Gateway owner Wallet Sessions and verified step-up",
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
    // A VM Router has no edge source metadata.
    let trusted_source_digest = router_trusted_source_digest_v1(None, None);
    let now_ms = local_now_ms_v1()?;
    let admitted = match gateway_ecdsa_authorization(&authorized_operation, request)? {
        GatewayEcdsaAuthorizationV1::OwnerWalletSession => {
            let credential = authorized_operation
                .gateway_owner_wallet_session_credential(trusted_source_digest)?;
            admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_v1(
                &config.admission_bindings,
                now_ms,
                signing_request,
                authorized_operation,
                presign_source,
                credential,
                trusted_source_digest,
                build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(
                    &config.admission_bindings.jwt,
                )?,
            )?
        }
        GatewayEcdsaAuthorizationV1::OperationStepUp => {
            admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_step_up_prepare_v1(
                &config.admission_bindings,
                now_ms,
                signing_request,
                authorized_operation,
                presign_source,
                trusted_source_digest,
            )?
        }
    };
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
    let trusted_source_digest = router_trusted_source_digest_v1(None, None);
    let now_ms = local_now_ms_v1()?;
    let admitted = match gateway_ecdsa_authorization(&authorized_operation, request)? {
        GatewayEcdsaAuthorizationV1::OwnerWalletSession => {
            let credential = authorized_operation
                .gateway_owner_wallet_session_credential(trusted_source_digest)?;
            admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_v1(
                &config.admission_bindings,
                now_ms,
                signing_request,
                authorized_operation,
                credential,
                trusted_source_digest,
                build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(
                    &config.admission_bindings.jwt,
                )?,
            )?
        }
        GatewayEcdsaAuthorizationV1::OperationStepUp => {
            admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_step_up_finalize_v1(
                &config.admission_bindings,
                now_ms,
                signing_request,
                authorized_operation,
                trusted_source_digest,
            )?
        }
    };
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
        signing_worker_wallet_ecdsa_scope_v1(admitted.wallet_scope.as_ref())?.clone();
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
                SIGNING_WORKER_ECDSA_EFFECT_IN_PROGRESS_V1,
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
