//! SigningWorker fetch handlers: activation, presign, export, linked ECDSA finalize and the presignature pool.

use super::*;

/// Handles SigningWorker's strict SigningWorker proof-bundle activation route.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_recipient_proof_bundle_activation_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "Router A/B SigningWorker proof-bundle activation route requires POST",
            405,
        );
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_PROOF_BUNDLE_ACTIVATION_PATH {
        return worker::Response::error(
            format!(
                "Router A/B SigningWorker proof-bundle activation must be served at {}",
                CLOUDFLARE_SIGNING_WORKER_PROOF_BUNDLE_ACTIVATION_PATH
            ),
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerRecipientProofBundleActivationRequestV1>()
        .await
    {
        Ok(parsed) => parsed,
        Err(err) => {
            return worker::Response::error(
                format!(
                    "Router A/B SigningWorker proof-bundle activation JSON parse failed: {err}"
                ),
                400,
            );
        }
    };
    let now_unix_ms = match cloudflare_now_unix_ms_v1() {
        Ok(now_unix_ms) => now_unix_ms,
        Err(err) => {
            return worker::Response::error(
                format!("{:?}: {}", err.code(), err.message()),
                cloudflare_router_error_status(err.code()),
            );
        }
    };
    match activate_cloudflare_signing_worker_server_output_v1(env, runtime, parsed, now_unix_ms)
        .await
    {
        Ok(response) => worker::Response::from_json(&response),
        Err(err) => worker::Response::error(
            format!("{:?}: {}", err.code(), err.message()),
            cloudflare_router_error_status(err.code()),
        ),
    }
}

/// Handles SigningWorker's Router A/B ECDSA derivation activation route.
#[cfg(feature = "workers-rs")]
#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub async fn handle_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    ctx: &worker::Context,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "Router A/B ECDSA derivation SigningWorker activation route requires POST",
            405,
        );
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH {
        return worker::Response::error(
            format!(
                "Router A/B ECDSA derivation SigningWorker activation must be served at {}",
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH
            ),
            404,
        );
    }
    /* Folded into the Router header under `ecdsa_sw_`. */
    let mut timing = CloudflareEcdsaBoundaryTimingV1::new();
    let total_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let activation = match request
        .json::<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1>()
        .await
    {
        Ok(activation) => activation,
        Err(err) => {
            return worker::Response::error(
                format!(
                    "Router A/B ECDSA derivation SigningWorker activation JSON parse failed: {err}"
                ),
                400,
            );
        }
    };
    timing.mark("parse", total_started_at_ms);
    let now_unix_ms = match cloudflare_now_unix_ms_v1() {
        Ok(now_unix_ms) => now_unix_ms,
        Err(err) => {
            return worker::Response::error(
                format!("{:?}: {}", err.code(), err.message()),
                cloudflare_router_error_status(err.code()),
            );
        }
    };
    let activate_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let wallet_scope = activation.pending.wallet_scope.clone();
    let ownership_generation = activation.pending.ownership_generation;
    match activate_cloudflare_router_ab_ecdsa_derivation_signing_worker_output_v1(
        env,
        wallet_objects,
        runtime,
        activation,
        now_unix_ms,
    )
    .await
    {
        Ok(response) => {
            ctx.wait_until(durable_object::warm_owner_presign_host(
                env.clone(),
                wallet_objects,
                runtime.bindings().presign_session.clone(),
                wallet_scope,
                ownership_generation,
                response.ecdsa_activation.material_activation.clone(),
            ));
            timing.mark("activate", activate_started_at_ms);
            timing.mark("total", total_started_at_ms);
            let response = worker::Response::from_json(&response)?;
            timing.apply_to(&response)?;
            Ok(response)
        }
        Err(err) => worker::Response::error(
            format!("{:?}: {}", err.code(), err.message()),
            cloudflare_router_error_status(err.code()),
        ),
    }
}

/// Handles SigningWorker's Router A/B ECDSA derivation activation-refresh route.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_refresh_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "Router A/B ECDSA derivation SigningWorker activation-refresh route requires POST",
            405,
        );
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH {
        return worker::Response::error(
            format!(
                "Router A/B ECDSA derivation SigningWorker activation refresh must be served at {}",
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH
            ),
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1>()
        .await
    {
        Ok(parsed) => parsed,
        Err(err) => {
            return worker::Response::error(
                format!(
                    "Router A/B ECDSA derivation SigningWorker activation-refresh JSON parse failed: {err}"
                ),
                400,
            );
        }
    };
    let now_unix_ms = match cloudflare_now_unix_ms_v1() {
        Ok(now_unix_ms) => now_unix_ms,
        Err(err) => {
            return worker::Response::error(
                format!("{:?}: {}", err.code(), err.message()),
                cloudflare_router_error_status(err.code()),
            );
        }
    };
    match refresh_cloudflare_router_ab_ecdsa_derivation_signing_worker_output_v1(
        env,
        runtime,
        parsed,
        now_unix_ms,
    )
    .await
    {
        Ok(response) => worker::Response::from_json(&response),
        Err(err) => worker::Response::error(
            format!("{:?}: {}", err.code(), err.message()),
            cloudflare_router_error_status(err.code()),
        ),
    }
}

#[cfg(feature = "workers-rs")]
pub(super) enum EcdsaMaterialRead {
    Signing,
    Presign,
}

#[cfg(feature = "workers-rs")]
pub(super) async fn load_cloudflare_signing_worker_active_ecdsa_derivation_material_v1(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    wallet_route: Option<SigningWorkerWalletRoute<'_>>,
    purpose: EcdsaMaterialRead,
) -> RouterAbProtocolResult<(
    ActiveSigningWorkerStateV1,
    CloudflareServerOutputMaterialRecordV1,
)> {
    #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
    if let Some(wallet_route) = wallet_route {
        if wallet_route.scope.wallet_id != scope.wallet_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA activation wallet scope differs from signing scope",
            ));
        }
        let lookup = CloudflareActiveSigningWorkerStateLookupV1::from_router_ab_ecdsa_derivation_normal_signing_scope(scope)?;
        let command = match purpose {
            EcdsaMaterialRead::Signing => {
                durable_object::SigningWorkerWalletDoRequestV1::LoadEcdsaActivation {
                    scope: wallet_route.scope.clone(),
                    ownership_generation: wallet_route.ownership_generation,
                    lookup,
                }
            }
            EcdsaMaterialRead::Presign => {
                durable_object::SigningWorkerWalletDoRequestV1::LoadEcdsaPresignActivation {
                    scope: wallet_route.scope.clone(),
                    ownership_generation: wallet_route.ownership_generation,
                    lookup,
                }
            }
        };
        let response = durable_object::call_signing_worker_wallet_do_v1(env, wallet_route.objects, command).await?;
        let loaded: SigningWorkerWalletEcdsaActivationMaterialV1 =
            parse_cloudflare_signing_worker_wallet_do_json_response_v1(
                response,
                "SigningWorker wallet-DO ECDSA material",
            )
            .await?;
        validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1(
            scope,
            &loaded.active,
            &loaded.material,
        )?;
        return Ok((loaded.active, loaded.material));
    }
    let _ = (wallet_route, purpose);
    let (active_signing_worker, material) =
        load_cloudflare_signing_worker_ecdsa_active_material_v1(env, runtime, scope).await?;
    validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1(
        scope,
        &active_signing_worker,
        &material,
    )?;
    Ok((active_signing_worker, material))
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_signing_worker_lane_material_record_v1(
    identity: &CloudflareSigningWorkerLaneMaterialIdentityV1,
    signing_worker: &ServerIdentityV1,
    bytes: [u8; 32],
) -> RouterAbProtocolResult<CloudflareServerOutputMaterialRecordV1> {
    let transcript = decode_base64url_fixed_32_v1(
        "lane material identity transcript_hash_b64u",
        &identity.transcript_hash_b64u,
    )?;
    CloudflareServerOutputMaterialRecordV1::new(
        PublicDigest32::new(transcript),
        router_ab_core::OpenedShareKind::XServerBase,
        router_ab_core::Role::Server,
        signing_worker.server_id.clone(),
        CloudflareSecretMaterial32V1::new(bytes),
    )
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_signing_worker_lane_active_state_for_scope_v1(
    scope: &NormalSigningScopeV1,
    identity: &CloudflareSigningWorkerLaneMaterialIdentityV1,
    group_public_key: &str,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<ActiveSigningWorkerStateV1> {
    let identity_digest =
        decode_base64url_fixed_32_v1("lane material identity digest", &identity.digest_b64u()?)?;
    let signing_worker = ServerIdentityV1::new(
        scope.signing_worker_id.clone(),
        "lane-material",
        identity.server_recipient_key_digest_b64u.clone(),
    )?;
    ActiveSigningWorkerStateV1::new(
        scope.account_id.clone(),
        scope.material_activation.clone(),
        group_public_key.to_owned(),
        signing_worker,
        PublicDigest32::new(decode_base64url_fixed_32_v1(
            "lane material identity transcript_hash_b64u",
            &identity.transcript_hash_b64u,
        )?),
        PublicDigest32::new(identity_digest),
        format!("lane-material/{}", identity.target_material_activation_id),
        now_unix_ms,
    )
}

#[cfg(feature = "workers-rs")]
pub(super) async fn load_cloudflare_signing_worker_normal_signing_material_v1(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    scope: &NormalSigningScopeV1,
    source: &CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    _now_unix_ms: u64,
) -> RouterAbProtocolResult<(
    ActiveSigningWorkerStateV1,
    CloudflareServerOutputMaterialRecordV1,
)> {
    source.validate_for_normal_scope(scope)?;
    match source {
        CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation { lookup } => {
            let call = runtime.active_signing_worker_state_get_request(lookup.clone())?;
            let response =
                execute_cloudflare_signing_worker_private_d1_request_v1(env, &call).await?;
            let active =
                require_signing_worker_output_active_state_get_response_v1(&call, response)?;
            let material_lookup =
                CloudflareSigningWorkerOutputMaterialLookupV1::new(active.clone())?;
            let material_call =
                runtime.signing_worker_output_material_get_request(material_lookup)?;
            let material_response =
                execute_cloudflare_signing_worker_private_d1_request_v1(env, &material_call)
                    .await?;
            let material = require_signing_worker_output_material_get_response_v1(
                &material_call,
                material_response,
            )?;
            Ok((active, material))
        }
        CloudflareSigningWorkerNormalSigningMaterialSourceV1::RotatableLane {
            lookup,
            group_public_key,
        } => {
            let (artifact, activated_at_ms) =
                load_cloudflare_signing_worker_normal_signing_lane_material_v1(env, lookup).await?;
            artifact
                .validate_kind(CloudflareSigningWorkerLaneArtifactKindV1::ActiveServerMaterial)?;
            let bytes = decode_base64url_bytes_v1(
                "lane active server material artifact",
                &artifact.payload_b64u,
            )?;
            let active_bytes = match lookup.identity.key_family {
                CloudflareSigningWorkerLaneKeyFamilyV1::EcdsaSecp256k1 => {
                    let parsed: CloudflareEcdsaLaneActiveServerMaterialV1 =
                        serde_json::from_slice(&bytes).map_err(|_| {
                            RouterAbProtocolError::new(
                                RouterAbProtocolErrorCode::MalformedWirePayload,
                                "ECDSA lane active server material is invalid",
                            )
                        })?;
                    parsed.share32()?.to_vec()
                }
                CloudflareSigningWorkerLaneKeyFamilyV1::Ed25519 => {
                    let parsed: CloudflareEd25519LaneActiveServerMaterialV1 =
                        serde_json::from_slice(&bytes).map_err(|_| {
                            RouterAbProtocolError::new(
                                RouterAbProtocolErrorCode::MalformedWirePayload,
                                "Ed25519 lane active server material is invalid",
                            )
                        })?;
                    parsed.scalar32()?.to_vec()
                }
            };
            let active_bytes: [u8; 32] = active_bytes.try_into().map_err(|_| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    "lane active server material must contain 32 bytes",
                )
            })?;
            let active = cloudflare_signing_worker_lane_active_state_for_scope_v1(
                scope,
                &lookup.identity,
                group_public_key,
                activated_at_ms,
            )?;
            let material = cloudflare_signing_worker_lane_material_record_v1(
                &lookup.identity,
                &active.signing_worker,
                active_bytes,
            )?;
            Ok((active, material))
        }
    }
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_signing_worker_lane_active_ecdsa_state_v1(
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    identity: &CloudflareSigningWorkerLaneMaterialIdentityV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<ActiveSigningWorkerStateV1> {
    let identity_digest =
        decode_base64url_fixed_32_v1("lane material identity digest", &identity.digest_b64u()?)?;
    ActiveSigningWorkerStateV1::new(
        scope.wallet_id.clone(),
        scope.material_activation.clone(),
        "lane-material",
        scope.signing_worker.clone(),
        PublicDigest32::new(decode_base64url_fixed_32_v1(
            "lane material identity transcript_hash_b64u",
            &identity.transcript_hash_b64u,
        )?),
        PublicDigest32::new(identity_digest),
        format!("lane-material/{}", identity.target_material_activation_id),
        now_unix_ms,
    )
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_signing_worker_lane_active_linked_ecdsa_state_v1(
    scope: &RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1,
    identity: &CloudflareSigningWorkerLaneMaterialIdentityV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<ActiveSigningWorkerStateV1> {
    let identity_digest =
        decode_base64url_fixed_32_v1("lane material identity digest", &identity.digest_b64u()?)?;
    ActiveSigningWorkerStateV1::new(
        scope.wallet_id.clone(),
        scope.material_activation.clone(),
        "lane-material",
        ServerIdentityV1::new(
            scope.signing_worker_participant_id.clone(),
            scope.signing_worker_recipient_key_id.clone(),
            scope.signing_worker_hpke_public_key_b64u.clone(),
        )?,
        PublicDigest32::new(decode_base64url_fixed_32_v1(
            "lane material identity transcript_hash_b64u",
            &identity.transcript_hash_b64u,
        )?),
        PublicDigest32::new(identity_digest),
        format!("lane-material/{}", identity.target_material_activation_id),
        now_unix_ms,
    )
}

#[cfg(feature = "workers-rs")]
pub(super) async fn load_cloudflare_signing_worker_linked_ecdsa_normal_signing_material_v1(
    env: &worker::Env,
    scope: &RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1,
    source: &CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    _now_unix_ms: u64,
) -> RouterAbProtocolResult<(
    ActiveSigningWorkerStateV1,
    CloudflareServerOutputMaterialRecordV1,
)> {
    source.validate_for_linked_ecdsa_scope(scope)?;
    let CloudflareSigningWorkerNormalSigningMaterialSourceV1::RotatableLane { lookup, .. } = source
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "linked ECDSA signing requires rotatable lane material",
        ));
    };
    let (artifact, activated_at_ms) =
        load_cloudflare_signing_worker_normal_signing_lane_material_v1(env, lookup).await?;
    artifact.validate_kind(CloudflareSigningWorkerLaneArtifactKindV1::ActiveServerMaterial)?;
    let bytes = decode_base64url_bytes_v1(
        "linked ECDSA lane active server material artifact",
        &artifact.payload_b64u,
    )?;
    let parsed: CloudflareEcdsaLaneActiveServerMaterialV1 = serde_json::from_slice(&bytes)
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "linked ECDSA lane active server material is invalid",
            )
        })?;
    let active = cloudflare_signing_worker_lane_active_linked_ecdsa_state_v1(
        scope,
        &lookup.identity,
        activated_at_ms,
    )?;
    let material = cloudflare_signing_worker_lane_material_record_v1(
        &lookup.identity,
        &active.signing_worker,
        parsed.share32()?,
    )?;
    validate_cloudflare_linked_device_ecdsa_normal_signing_active_material_v1(
        scope, &active, &material,
    )?;
    Ok((active, material))
}

#[cfg(feature = "workers-rs")]
pub(super) async fn load_cloudflare_signing_worker_ecdsa_normal_signing_material_v1(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    source: &CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    wallet_route: Option<SigningWorkerWalletRoute<'_>>,
    _now_unix_ms: u64,
) -> RouterAbProtocolResult<(
    ActiveSigningWorkerStateV1,
    CloudflareServerOutputMaterialRecordV1,
)> {
    source.validate_for_ecdsa_scope(scope)?;
    match source {
        CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation { .. } => {
            load_cloudflare_signing_worker_active_ecdsa_derivation_material_v1(
                env,
                runtime,
                scope,
                wallet_route,
                EcdsaMaterialRead::Signing,
            )
            .await
        }
        CloudflareSigningWorkerNormalSigningMaterialSourceV1::RotatableLane { lookup, .. } => {
            let (artifact, activated_at_ms) =
                load_cloudflare_signing_worker_normal_signing_lane_material_v1(env, lookup).await?;
            artifact
                .validate_kind(CloudflareSigningWorkerLaneArtifactKindV1::ActiveServerMaterial)?;
            let bytes = decode_base64url_bytes_v1(
                "ECDSA lane active server material artifact",
                &artifact.payload_b64u,
            )?;
            let parsed: CloudflareEcdsaLaneActiveServerMaterialV1 = serde_json::from_slice(&bytes)
                .map_err(|_| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        "ECDSA lane active server material is invalid",
                    )
                })?;
            let active = cloudflare_signing_worker_lane_active_ecdsa_state_v1(
                scope,
                &lookup.identity,
                activated_at_ms,
            )?;
            let material = cloudflare_signing_worker_lane_material_record_v1(
                &lookup.identity,
                &active.signing_worker,
                parsed.share32()?,
            )?;
            validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1(
                scope, &active, &material,
            )?;
            Ok((active, material))
        }
    }
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_signing_worker_presign_error_response_v1(
    error: RouterAbProtocolError,
) -> worker::Result<worker::Response> {
    worker::Response::error(
        format!("{:?}: {}", error.code(), error.message()),
        cloudflare_router_error_status(error.code()),
    )
}

/// Handles SigningWorker's private ECDSA presign-session init route.
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_signing_worker_ecdsa_presign_session_init_private_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    let mut timing = CloudflareEcdsaBoundaryTimingV1::new();
    let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    if request.method() != worker::Method::Post {
        return worker::Response::error("SigningWorker ECDSA presign init requires POST", 405);
    }
    if request.path()
        != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_INIT_PATH
    {
        return worker::Response::error("SigningWorker ECDSA presign init route not found", 404);
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1>()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker ECDSA presign init JSON parse failed: {error}"),
                400,
            );
        }
    };
    timing.mark("ecdsa_presign_sw_body", started_at_ms);
    if let Err(error) = parsed.validate_at(now_unix_ms) {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    let material_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let wallet_scope = Some(SigningWorkerWalletRoute { objects: wallet_objects, scope: parsed.authority.wallet_scope(), ownership_generation: parsed.authority.ownership_generation() });
    let (active_signing_worker, material) =
        match load_cloudflare_signing_worker_active_ecdsa_derivation_material_v1(
            env,
            runtime,
            &parsed.scope,
            wallet_scope,
            EcdsaMaterialRead::Presign,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
        };
    timing.mark("ecdsa_presign_sw_material", material_started_at_ms);
    let do_request = match signing_worker_ecdsa_presign_session_start_v1(
        parsed,
        &active_signing_worker,
        &material,
    ) {
        Ok(value) => value,
        Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
    };
    let session_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let do_response =
        match durable_object::execute_cloudflare_durable_object_custom_json_call_with_timing_v1(
            env,
            wallet_objects,
            &runtime.bindings().presign_session,
            CLOUDFLARE_SIGNING_WORKER_ECDSA_PRESIGN_SESSION_DO_INIT_PATH,
            durable_object::PresignHost::Owner {
                ownership_generation: do_request.request.authority.ownership_generation(),
                wallet: do_request.request.authority.wallet_scope(),
                material: &do_request.request.scope.material_activation,
            },
            &do_request,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
        };
    timing.mark("ecdsa_presign_sw_session", session_started_at_ms);
    timing.merge_role("ecdsa_presign_sw", do_response.server_timing);
    let progress = do_response.value;
    let CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Continue {
        presign_session_id,
        stage,
        event,
        outgoing_messages_b64u,
    } = progress
    else {
        return worker::Response::error(
            "SigningWorker ECDSA presign init returned terminal state",
            500,
        );
    };
    let response = worker::Response::from_json(
        &CloudflareSigningWorkerEcdsaPresignSessionProgressV1::Continue {
            presign_session_id,
            stage,
            event,
            outgoing_messages_b64u,
        },
    )?;
    timing.mark("ecdsa_presign_sw_total", started_at_ms);
    timing.apply_to(&response)?;
    Ok(response)
}

/// Handles SigningWorker's private linked-device ECDSA presign-session init
/// route. The linked request is admitted by Gateway before this call and is
/// kept in a dedicated Durable Object session, separate from the owner pool.
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_signing_worker_linked_ecdsa_presign_session_init_private_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "SigningWorker linked ECDSA presign init requires POST",
            405,
        );
    }
    if request.path()
        != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_LINKED_PRESIGNATURE_SESSION_INIT_PATH
    {
        return worker::Response::error(
            "SigningWorker linked ECDSA presign init route not found",
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1>()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker linked ECDSA presign init JSON parse failed: {error}"),
                400,
            );
        }
    };
    if let Err(error) = parsed.validate_at(now_unix_ms) {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    let (active_signing_worker, material) =
        match load_cloudflare_signing_worker_linked_ecdsa_normal_signing_material_v1(
            env,
            &parsed.request.scope,
            &parsed.material_source,
            now_unix_ms,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
        };
    let do_request =
        CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoInitRequestV1 {
            request: parsed,
            active_signing_worker_state: active_signing_worker,
            relayer_share32_b64u: encode_base64url_bytes_v1(material.output_material.as_bytes()),
        };
    let progress = match durable_object::execute_cloudflare_durable_object_custom_json_call_v1(
        env,
            wallet_objects,
        &runtime.bindings().presign_session,
        CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGN_SESSION_DO_INIT_PATH,
        durable_object::PresignHost::LinkedSession { session_id: &do_request.request.request.client_presignature_id, ownership_generation: do_request.request.ownership_generation },
        &do_request,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
    };
    let CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1::Continue {
        presign_session_id,
        stage,
        event,
        outgoing_messages_b64u,
    } = progress
    else {
        return worker::Response::error(
            "SigningWorker linked ECDSA presign init returned terminal state",
            500,
        );
    };
    worker::Response::from_json(
        &CloudflareSigningWorkerEcdsaPresignSessionProgressV1::Continue {
            presign_session_id,
            stage,
            event,
            outgoing_messages_b64u,
        },
    )
}

/// Validates active ECDSA export material without releasing a share.
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_signing_worker_ecdsa_export_preflight_private_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error("SigningWorker ECDSA export preflight requires POST", 405);
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PREFLIGHT_PATH
    {
        return worker::Response::error(
            "SigningWorker ECDSA export-preflight route not found",
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerEcdsaExportShareRequestV1>()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker ECDSA export-preflight JSON parse failed: {error}"),
                400,
            );
        }
    };
    if let Err(error) = parsed.validate_at(now_unix_ms) {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    if let Err(error) = load_cloudflare_signing_worker_ecdsa_normal_signing_material_v1(
        env,
        runtime,
        &parsed.export_authority.normal_signing_scope,
        &parsed.material_source,
        Some(SigningWorkerWalletRoute { objects: wallet_objects, scope: &parsed.wallet_scope, ownership_generation: parsed.ownership_generation }),
        now_unix_ms,
    )
    .await
    {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    worker::Response::from_json(&CloudflareSigningWorkerEcdsaExportPreflightResponseV1 {
        ready: true,
    })
}

/// Delivers the exact active additive share to one authenticated, replay-reserved export recipient.
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_signing_worker_ecdsa_export_share_private_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error("SigningWorker ECDSA export share requires POST", 405);
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_SHARE_PATH {
        return worker::Response::error("SigningWorker ECDSA export-share route not found", 404);
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerEcdsaExportShareRequestV1>()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker ECDSA export-share JSON parse failed: {error}"),
                400,
            );
        }
    };
    if let Err(error) = parsed.validate_at(now_unix_ms) {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    let (active_signing_worker, material) =
        match load_cloudflare_signing_worker_ecdsa_normal_signing_material_v1(
            env,
            runtime,
            &parsed.export_authority.normal_signing_scope,
            &parsed.material_source,
            Some(SigningWorkerWalletRoute { objects: wallet_objects, scope: &parsed.wallet_scope, ownership_generation: parsed.ownership_generation }),
            now_unix_ms,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
        };
    let mut seal_seed = [0_u8; 32];
    if getrandom::getrandom(&mut seal_seed).is_err() {
        return worker::Response::error("SigningWorker ECDSA export-share RNG failed", 500);
    }
    match seal_cloudflare_signing_worker_ecdsa_export_share_v1(
        &parsed,
        &active_signing_worker,
        &material,
        seal_seed,
    ) {
        Ok(envelope) => worker::Response::from_json(&envelope),
        Err(error) => cloudflare_signing_worker_presign_error_response_v1(error),
    }
}

/// Seals one exact active additive-lane server share to an admitted one-use recipient.
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_signing_worker_linked_ecdsa_export_share_private_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "SigningWorker linked ECDSA export share requires POST",
            405,
        );
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_EXPORT_SHARE_PATH {
        return worker::Response::error(
            "SigningWorker linked ECDSA export-share route not found",
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerLinkedEcdsaExportShareRequestV1>()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker linked ECDSA export-share JSON parse failed: {error}"),
                400,
            );
        }
    };
    if let Err(error) = parsed.validate_at(now_unix_ms) {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    let (_, material) =
        match load_cloudflare_signing_worker_linked_ecdsa_normal_signing_material_v1(
            env,
            &parsed.scope,
            &parsed.material_source,
            now_unix_ms,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
        };
    let mut seal_seed = [0_u8; 32];
    if getrandom::getrandom(&mut seal_seed).is_err() {
        return worker::Response::error("SigningWorker linked ECDSA export-share RNG failed", 500);
    }
    let envelope = match seal_ecdsa_signing_worker_export_share_v1(
        parsed.binding,
        material.output_material.as_bytes(),
        seal_seed,
    ) {
        Ok(value) => value,
        Err(_) => {
            return worker::Response::error(
                "SigningWorker linked ECDSA export-share encryption failed",
                500,
            );
        }
    };
    worker::Response::from_json(&envelope)
}

/// Handles SigningWorker's private ECDSA presign-session step route.
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_signing_worker_ecdsa_presign_session_step_private_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    let mut timing = CloudflareEcdsaBoundaryTimingV1::new();
    let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    if request.method() != worker::Method::Post {
        return worker::Response::error("SigningWorker ECDSA presign step requires POST", 405);
    }
    if request.path()
        != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_STEP_PATH
    {
        return worker::Response::error("SigningWorker ECDSA presign step route not found", 404);
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1>()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker ECDSA presign step JSON parse failed: {error}"),
                400,
            );
        }
    };
    timing.mark("ecdsa_presign_sw_body", started_at_ms);
    if let Err(error) = parsed.validate_at(now_unix_ms) {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    let session_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let do_request =
        CloudflareSigningWorkerEcdsaPresignSessionDoGatewayStepRequestV1 { request: parsed };
    let do_response =
        match durable_object::execute_cloudflare_durable_object_custom_json_call_with_timing_v1(
            env,
            wallet_objects,
            &runtime.bindings().presign_session,
            CLOUDFLARE_SIGNING_WORKER_ECDSA_PRESIGN_SESSION_DO_STEP_PATH,
            durable_object::PresignHost::Owner {
                ownership_generation: do_request.request.authority.ownership_generation(),
                wallet: do_request.request.authority.wallet_scope(),
                material: &do_request.request.scope.material_activation,
            },
            &do_request,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
        };
    timing.mark("ecdsa_presign_sw_session", session_started_at_ms);
    timing.merge_role("ecdsa_presign_sw", do_response.server_timing);
    let progress = do_response.value;
    let response = match progress {
        CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Continue {
            presign_session_id,
            stage,
            event,
            outgoing_messages_b64u,
        } => worker::Response::from_json(
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
            let presign_session_id = do_request.request.presign_session_id;
            let server_presignature_id = pool_put_request.server_presignature_id.clone();
            let server_big_r33_b64u = pool_put_request.server_big_r33_b64u.clone();
            let admission_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
            #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
            let admission = publish_cloudflare_wallet_presignature(
                env,
                wallet_objects,
                authority.ownership_generation(),
                authority.wallet_scope(),
                &presign_session_id,
                now_unix_ms,
                pool_put_request,
            )
            .await;
            #[cfg(not(feature = "strict-worker-signing-worker-entrypoint"))]
            let admission = admit_cloudflare_signing_worker_ecdsa_presignature_v1(
                pool_put_request,
                Some(SigningWorkerWalletRoute { objects: wallet_objects, scope: authority.wallet_scope(), ownership_generation: authority.ownership_generation() }),
                env,
                runtime,
                now_unix_ms,
            )
            .await;
            if let Err(error) = admission {
                return cloudflare_signing_worker_presign_error_response_v1(error);
            }
            timing.mark("ecdsa_presign_sw_admit", admission_started_at_ms);
            worker::Response::from_json(
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
    }?;
    timing.mark("ecdsa_presign_sw_total", started_at_ms);
    timing.apply_to(&response)?;
    Ok(response)
}

/// Handles SigningWorker's private linked-device ECDSA presign-session step
/// route. Completion is returned directly to Gateway and is never inserted in
/// the owner presignature pool.
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_signing_worker_linked_ecdsa_presign_session_step_private_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "SigningWorker linked ECDSA presign step requires POST",
            405,
        );
    }
    if request.path()
        != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_LINKED_PRESIGNATURE_SESSION_STEP_PATH
    {
        return worker::Response::error(
            "SigningWorker linked ECDSA presign step route not found",
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionStepRequestV1>()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker linked ECDSA presign step JSON parse failed: {error}"),
                400,
            );
        }
    };
    if let Err(error) = parsed.validate_at(now_unix_ms) {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    let progress = match durable_object::execute_cloudflare_durable_object_custom_json_call_v1(
        env,
            wallet_objects,
        &runtime.bindings().presign_session,
        CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGN_SESSION_DO_STEP_PATH,
        durable_object::PresignHost::LinkedSession { session_id: &parsed.request.client_presignature_id, ownership_generation: parsed.ownership_generation },
        &parsed,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
    };
    match progress {
        CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1::Continue {
            presign_session_id,
            stage,
            event,
            outgoing_messages_b64u,
        } => worker::Response::from_json(
            &CloudflareSigningWorkerEcdsaPresignSessionProgressV1::Continue {
                presign_session_id,
                stage,
                event,
                outgoing_messages_b64u,
            },
        ),
        CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1::Complete {
            presign_session_id,
            server_presignature_id,
            server_big_r33_b64u,
            signing_worker_rerandomization_contribution32_b64u,
            prepared_response,
        } => worker::Response::from_json(
            &CloudflareSigningWorkerEcdsaPresignSessionProgressV1::Complete {
                outgoing_messages_b64u: Vec::new(),
                presign_session_id,
                server_presignature_id,
                server_big_r33_b64u,
                signing_worker_rerandomization_contribution32_b64u:
                    Some(signing_worker_rerandomization_contribution32_b64u),
                prepared_response: Some(prepared_response),
            },
        ),
    }
}

/// Handles one linked-device ECDSA finalize request. The completed presignature
/// record is consumed inside the SigningWorker boundary and never serialized
/// into an HTTP response.
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_signing_worker_linked_ecdsa_finalize_private_fetch_v1<Handler>(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    handler: &Handler,
    now_unix_ms: u64,
) -> worker::Result<worker::Response>
where
    Handler: CloudflareSigningWorkerLinkedDeviceEcdsaFinalizeHandlerV1,
{
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "SigningWorker linked ECDSA finalize route requires POST",
            405,
        );
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_LINKED_SIGNING_PATH {
        return worker::Response::error("SigningWorker linked ECDSA finalize route not found", 404);
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerAdmittedLinkedDeviceEcdsaFinalizeRequestV1>()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker linked ECDSA finalize JSON parse failed: {error}"),
                400,
            );
        }
    };
    if let Err(error) = parsed.validate() {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    if let Err(error) = parsed.request.validate_at(now_unix_ms) {
        return cloudflare_signing_worker_presign_error_response_v1(error);
    }
    let (active_signing_worker, material) =
        match load_cloudflare_signing_worker_linked_ecdsa_normal_signing_material_v1(
            env,
            &parsed.request.scope,
            &parsed.material_source,
            now_unix_ms,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
        };
    let request_digest = match parsed.request.prepare_request_digest() {
        Ok(value) => value,
        Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
    };
    let signing_digest = match parsed.request.signing_digest() {
        Ok(value) => value,
        Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
    };
    let scope_digest = match parsed.request.scope.scope_digest() {
        Ok(value) => value,
        Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
    };
    let ownership_generation = match parsed.authorized_operation.ownership_generation() {
        Ok(value) => value,
        Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
    };
    let server_presignature = match consume_cloudflare_signing_worker_linked_ecdsa_presignature_v1(
        env,
            wallet_objects,
        runtime,
        ownership_generation,
        parsed.request.server_presignature_id.clone(),
        scope_digest,
        request_digest,
        signing_digest,
        now_unix_ms,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
    };
    let response =
        match handle_cloudflare_signing_worker_linked_device_ecdsa_finalize_private_request_v1(
            handler,
            now_unix_ms,
            parsed,
            active_signing_worker,
            material,
            server_presignature,
        ) {
            Ok(value) => value,
            Err(error) => return cloudflare_signing_worker_presign_error_response_v1(error),
        };
    worker::Response::from_json(&response)
}

/// Consumes one completed linked-device presignature inside the SigningWorker
/// boundary. The record remains private and is passed directly to linked
/// finalize materialization.
#[cfg(feature = "workers-rs")]
pub(crate) async fn consume_cloudflare_signing_worker_linked_ecdsa_presignature_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    ownership_generation: u64,
    server_presignature_id: String,
    scope_digest: PublicDigest32,
    request_digest: PublicDigest32,
    signing_digest: PublicDigest32,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignatureRecordV1> {
    let request =
        CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeRequestV1 {
            server_presignature_id,
            scope_digest,
            request_digest,
            signing_digest,
            now_unix_ms,
        };
    let response: CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeResponseV1 =
        durable_object::execute_cloudflare_durable_object_custom_json_call_v1(
            env,
            wallet_objects,
            &runtime.bindings().presign_session,
            CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGNATURE_DO_CONSUME_PATH,
            durable_object::PresignHost::LinkedSession { session_id: &request.server_presignature_id, ownership_generation },
            &request,
        )
        .await?;
    Ok(response.record)
}

/// Handles SigningWorker's private Router A/B ECDSA derivation presignature pool-fill route.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_presignature_pool_put_private_fetch_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "Router A/B ECDSA derivation presignature pool fill route requires POST",
            405,
        );
    }
    if request.path()
        != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_PUT_PATH
    {
        return worker::Response::error(
            format!(
                "Router A/B ECDSA derivation presignature pool fill must be served at {}",
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_PUT_PATH
            ),
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1>()
        .await
    {
        Ok(parsed) => parsed,
        Err(err) => {
            return worker::Response::error(
                format!(
                    "Router A/B ECDSA derivation presignature pool fill JSON parse failed: {err}"
                ),
                400,
            );
        }
    };
    match admit_cloudflare_signing_worker_ecdsa_presignature_v1(
        parsed,
        None,
        env,
        runtime,
        now_unix_ms,
    )
    .await
    {
        Ok(receipt) => worker::Response::from_json(&receipt),
        Err(error) => cloudflare_signing_worker_presign_error_response_v1(error),
    }
}

#[cfg(all(feature = "workers-rs", feature = "strict-worker-signing-worker-entrypoint"))]
pub(super) async fn publish_cloudflare_wallet_presignature(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    ownership_generation: u64,
    scope: &CloudflareSigningWorkerWalletScopeV1,
    presign_session_id: &str,
    completed_at_ms: u64,
    request: CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolAdmissionReceiptV1> {
    let response = durable_object::call_signing_worker_wallet_do_v1(
        env,
            wallet_objects,
        durable_object::SigningWorkerWalletDoRequestV1::PublishEcdsaPresignature {
            ownership_generation,
            scope: scope.clone(),
            presign_session_id: presign_session_id.to_owned(),
            completed_at_ms,
            request,
        },
    )
    .await?;
    parse_cloudflare_signing_worker_wallet_do_json_response_v1(
        response,
        "Wallet presignature publication",
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(super) async fn admit_cloudflare_signing_worker_ecdsa_presignature_v1(
    request: CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1,
    wallet_route: Option<SigningWorkerWalletRoute<'_>>,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolAdmissionReceiptV1> {
    request.validate_at(now_unix_ms)?;
    #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
    if wallet_route.is_none() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Wallet-DO ECDSA pool admission requires a pinned wallet scope",
        ));
    }
    let (active_signing_worker, active_material) =
        load_cloudflare_signing_worker_ecdsa_normal_signing_material_v1(
            env,
            runtime,
            &request.scope,
            &request.material_source,
            wallet_route,
            now_unix_ms,
        )
        .await?;
    let record = request.to_pool_record(active_signing_worker, &active_material, now_unix_ms)?;
    let outcome = execute_cloudflare_signing_worker_ecdsa_pool_mutation_for_wallet_v1(
        env,
        runtime,
        wallet_route,
        CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable {
            material: record.clone(),
        },
    )
    .await?;
    let CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Available { stored, .. } = outcome
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker ECDSA pool admission returned the wrong lifecycle outcome",
        ));
    };
    CloudflareSigningWorkerEcdsaPoolAdmissionReceiptV1::from_record(&record, stored)
}

#[cfg(feature = "workers-rs")]
pub(super) fn parse_cloudflare_signing_worker_normal_signing_terminal_v1(
    request: &CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    terminal_json: &str,
) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningTerminalV1> {
    let terminal: CloudflareSigningWorkerNormalSigningTerminalV1 =
        serde_json::from_str(terminal_json).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("SigningWorker terminal outcome JSON is invalid: {error}"),
            )
        })?;
    terminal.validate_for_request(request)?;
    Ok(terminal)
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_claimed_cloudflare_signing_worker_normal_signing_v1<Handler>(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    handler: &Handler,
    now_unix_ms: u64,
    request: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
) -> RouterAbProtocolResult<NormalSigningResponseV1>
where
    Handler: CloudflareSigningWorkerNormalSigningFinalizeHandlerV2,
{
    let (active_signing_worker, material) =
        load_cloudflare_signing_worker_normal_signing_material_v1(
            env,
            runtime,
            &request.request.scope,
            &request.material_source,
            now_unix_ms,
        )
        .await?;
    let round1_lookup = CloudflareSigningWorkerRound1LookupV1::new(
        active_signing_worker.clone(),
        request.request.server_round1_handle().to_owned(),
        request.request.round1_binding_digest(),
        now_unix_ms,
    )?;
    let round1_call = runtime.signing_worker_round1_take_request(round1_lookup)?;
    let round1_response =
        execute_cloudflare_signing_worker_private_d1_request_v1(env, &round1_call).await?;
    let server_round1 =
        require_signing_worker_round1_take_response_v1(&round1_call, round1_response)?;
    handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2(
        handler,
        now_unix_ms,
        request,
        active_signing_worker,
        material,
        server_round1,
    )
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_signing_worker_normal_signing_terminal_response_v1(
    terminal: CloudflareSigningWorkerNormalSigningTerminalV1,
) -> worker::Result<worker::Response> {
    match terminal.into_result() {
        Ok(response) => worker::Response::from_json(&response),
        Err(error) => worker::Response::error(
            format!("{:?}: {}", error.code(), error.message()),
            cloudflare_router_error_status(error.code()),
        ),
    }
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_signing_worker_output_activate_response_v1(
    request: &CloudflareSigningWorkerPrivateD1RequestV1,
    response: CloudflareSigningWorkerPrivateD1ResponseV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerOutputActivationReceiptV1> {
    response.validate_for_request(request)?;
    let CloudflareSigningWorkerPrivateD1ResponseV1::OutputActivated { receipt } = response else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker private D1 returned wrong response branch",
        ));
    };
    Ok(receipt)
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_signing_worker_output_active_state_get_response_v1(
    request: &CloudflareSigningWorkerPrivateD1RequestV1,
    response: CloudflareSigningWorkerPrivateD1ResponseV1,
) -> RouterAbProtocolResult<ActiveSigningWorkerStateV1> {
    response.validate_for_request(request)?;
    let CloudflareSigningWorkerPrivateD1ResponseV1::ActiveState { active_state } = response else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker private D1 returned wrong active-state response branch",
        ));
    };
    Ok(active_state)
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_signing_worker_output_material_get_response_v1(
    request: &CloudflareSigningWorkerPrivateD1RequestV1,
    response: CloudflareSigningWorkerPrivateD1ResponseV1,
) -> RouterAbProtocolResult<CloudflareServerOutputMaterialRecordV1> {
    response.validate_for_request(request)?;
    let CloudflareSigningWorkerPrivateD1ResponseV1::OutputMaterial { material } = response else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker private D1 returned wrong material response branch",
        ));
    };
    Ok(material)
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_signing_worker_round1_put_response_v1(
    request: &CloudflareSigningWorkerPrivateD1RequestV1,
    response: CloudflareSigningWorkerPrivateD1ResponseV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerRound1PutReceiptV1> {
    response.validate_for_request(request)?;
    let CloudflareSigningWorkerPrivateD1ResponseV1::Round1Stored { receipt } = response else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker private D1 returned wrong round-1 put response branch",
        ));
    };
    Ok(receipt)
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_signing_worker_round1_take_response_v1(
    request: &CloudflareSigningWorkerPrivateD1RequestV1,
    response: CloudflareSigningWorkerPrivateD1ResponseV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerRound1RecordV1> {
    response.validate_for_request(request)?;
    let CloudflareSigningWorkerPrivateD1ResponseV1::Round1Taken { record } = response else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker private D1 returned wrong round-1 response branch",
        ));
    };
    Ok(record)
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_signing_worker_ecdsa_pool_mutate_response_v1(
    request: &CloudflareSigningWorkerPrivateD1RequestV1,
    response: CloudflareSigningWorkerPrivateD1ResponseV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1> {
    response.validate_for_request(request)?;
    let CloudflareSigningWorkerPrivateD1ResponseV1::EcdsaPoolMutated { outcome } = response else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker private D1 returned wrong ECDSA pool mutation response branch",
        ));
    };
    Ok(outcome)
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_signing_worker_ecdsa_pool_mutation_v1(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    command: CloudflareSigningWorkerEcdsaPoolCommandV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1> {
    let call = runtime.signing_worker_ecdsa_pool_mutate_request(command)?;
    let response = execute_cloudflare_signing_worker_private_d1_request_v1(env, &call).await?;
    require_signing_worker_ecdsa_pool_mutate_response_v1(&call, response)
}

#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub(super) async fn parse_cloudflare_signing_worker_wallet_do_json_response_v1<
    T: serde::de::DeserializeOwned,
>(
    mut response: worker::Response,
    label: &str,
) -> RouterAbProtocolResult<T> {
    if response.status_code() != 200 {
        let status = response.status_code();
        let message = response.text().await.map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} error is unreadable: {error}"),
            )
        })?;
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} returned {status}: {message}"),
        ));
    }
    response.json::<T>().await.map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{label} outcome is invalid: {error}"),
        )
    })
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_signing_worker_ecdsa_pool_mutation_for_wallet_v1(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    wallet_route: Option<SigningWorkerWalletRoute<'_>>,
    command: CloudflareSigningWorkerEcdsaPoolCommandV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1> {
    #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
    {
        let _ = runtime;
        let wallet_route = wallet_route.ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Wallet-DO ECDSA pool requires a Router-admitted wallet scope",
            )
        })?;
        let response = durable_object::call_signing_worker_wallet_do_v1(
            env,
            wallet_route.objects,
            durable_object::SigningWorkerWalletDoRequestV1::EcdsaPoolMutate {
                scope: wallet_route.scope.clone(),
                    ownership_generation: wallet_route.ownership_generation,
                mutation: command,
            },
        )
        .await?;
        let outcome: CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1 =
            parse_cloudflare_signing_worker_wallet_do_json_response_v1(
                response,
                "SigningWorker wallet-DO ECDSA pool",
            )
            .await?;
        outcome.validate()?;
        return Ok(outcome);
    }
    #[cfg(not(feature = "strict-worker-signing-worker-entrypoint"))]
    {
        let _ = wallet_route;
        execute_cloudflare_signing_worker_ecdsa_pool_mutation_v1(env, runtime, command).await
    }
}

#[cfg(feature = "workers-rs")]
#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub(super) async fn commit_cloudflare_signing_worker_ecdsa_terminal_for_wallet_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    request: &CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    response: &RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerTerminalResponseCommitV1> {
    let scope = &request.wallet_scope;
    let do_response = durable_object::call_signing_worker_wallet_do_v1(
        env,
        wallet_objects,
        durable_object::SigningWorkerWalletDoRequestV1::CommitEcdsaTerminal {
            scope: scope.clone(),
            request: request.clone(),
            response: response.clone(),
            now_unix_ms,
        },
    )
    .await?;
    parse_cloudflare_signing_worker_wallet_do_json_response_v1(
        do_response,
        "SigningWorker wallet-DO ECDSA terminal",
    )
    .await
}
