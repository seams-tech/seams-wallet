//! Router A/B ECDSA normal signing, shared by every host.
//!
//! The Router admits a Gateway-forwarded prepare or finalize against the
//! owner's Wallet Session and the operation it authorized. The SigningWorker
//! reserves a presignature from the wallet's pool for prepare, and for
//! finalize claims the signing effect and consumes that presignature before
//! it signs, then records the terminal response, so a retried finalize
//! returns the stored response and never consumes another presignature.

use crate::*;

/// Admits one owner ECDSA prepare at the Router.
#[allow(clippy::too_many_arguments)]
pub fn admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_v1<Verifier>(
    admission: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    presign_source: CloudflareEcdsaPrepareSourceV1,
    credential: CloudflareRouterWalletSessionCredentialV1,
    trusted_source_digest: PublicDigest32,
    mut verifier: Verifier,
) -> RouterAbProtocolResult<
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
>
where
    Verifier: CloudflareRouterWalletSessionVerifierV1,
{
    request.validate_at(now_unix_ms)?;
    let wallet_session = verifier.verify_wallet_session(
        &admission.jwt,
        &credential,
        trusted_source_digest,
        now_unix_ms,
    )?;
    wallet_session.validate_for_router_ab_ecdsa_derivation_evm_digest_signing_request_v1(
        &request,
        now_unix_ms,
    )?;
    authorized_operation.validate_for_wallet_session(&wallet_session)?;
    authorized_operation
        .authorized_operation
        .validate_for_prepare_request(&request)?;
    let wallet_scope = match &authorized_operation.binding {
        CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. } => {
            Some(authorized_operation.wallet_scope()?)
        }
        _ => None,
    };
    let candidate =
        CloudflareRouterAbEcdsaDerivationEvmDigestPrepareAdmissionCandidateV1::from_prepare_request(
            &wallet_session,
            &request,
            now_unix_ms,
        )?;
    let trusted_admission = admission.apply_project_policy_to_normal_signing_admission_v1(
        &request.request_id,
        derive_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_trusted_admission_v1(
            &request, &candidate,
        )?,
    )?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Router A/B ECDSA derivation prepare Router admission did not allow SigningWorker forwarding",
        ));
    }
    let mut admitted =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            request,
            trusted_admission,
        )?;
    admitted.presign_source = presign_source;
    admitted.wallet_scope = wallet_scope;
    admitted.validate()?;
    Ok(admitted)
}

/// Admits one owner ECDSA finalize at the Router, with the effect claim the
/// SigningWorker records before it signs.
#[allow(clippy::too_many_arguments)]
pub fn admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_v1<Verifier>(
    admission: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    credential: CloudflareRouterWalletSessionCredentialV1,
    trusted_source_digest: PublicDigest32,
    mut verifier: Verifier,
) -> RouterAbProtocolResult<
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
>
where
    Verifier: CloudflareRouterWalletSessionVerifierV1,
{
    request.validate_at(now_unix_ms)?;
    let wallet_session = verifier.verify_wallet_session(
        &admission.jwt,
        &credential,
        trusted_source_digest,
        now_unix_ms,
    )?;
    wallet_session.validate_for_router_ab_ecdsa_derivation_evm_digest_finalize_request_v1(
        &request,
        now_unix_ms,
    )?;
    authorized_operation.validate_for_wallet_session(&wallet_session)?;
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request_with_session(&request, None)?;
    let wallet_scope = match &authorized_operation.binding {
        CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. } => {
            Some(authorized_operation.wallet_scope()?)
        }
        _ => None,
    };
    let candidate =
        CloudflareRouterAbEcdsaDerivationEvmDigestFinalizeAdmissionCandidateV1::from_finalize_request(
            &wallet_session,
            &request,
            now_unix_ms,
        )?;
    let trusted_admission = admission.apply_project_policy_to_normal_signing_admission_v1(
        &request.request_id,
        derive_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_trusted_admission_v1(
            &request, &candidate,
        )?,
    )?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Router A/B ECDSA derivation finalize Router admission did not allow SigningWorker forwarding",
        ));
    }
    let authorized_operation_identity =
        authorized_operation.into_signing_worker_authorized_operation_identity()?;
    let authorization_id = authorized_operation.reusable_authorization_id()?.to_owned();
    let mut admitted =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1::new(
            request,
            trusted_admission,
            authorized_operation_identity,
            authorized_operation
                .authorized_operation
                .into_signing_worker_effect_claim(
                    wallet_session.wallet_session_id.clone(),
                    authorization_id,
                )?,
        )?;
    admitted.wallet_scope = wallet_scope;
    admitted.validate()?;
    Ok(admitted)
}

/// Admits one Gateway-verified operation step-up ECDSA prepare at the Router.
pub fn admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_step_up_prepare_v1(
    admission: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    presign_source: CloudflareEcdsaPrepareSourceV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
> {
    request.validate_at(now_unix_ms)?;
    let trusted_admission = cloudflare_router_ab_ecdsa_step_up_prepare_admission_v1(
        &request,
        &authorized_operation,
        trusted_source_digest,
    )?;
    let wallet_scope = require_step_up_wallet_scope_v1(
        authorized_operation.wallet_scope()?,
        &request.scope.wallet_id,
    )?;
    let trusted_admission = admission
        .apply_project_policy_to_normal_signing_admission_v1(&request.request_id, trusted_admission)?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Router A/B ECDSA derivation prepare Router admission did not allow SigningWorker forwarding",
        ));
    }
    let mut admitted =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            request,
            trusted_admission,
        )?;
    admitted.presign_source = presign_source;
    admitted.wallet_scope = Some(wallet_scope);
    admitted.validate()?;
    Ok(admitted)
}

/// Admits one Gateway-verified operation step-up ECDSA finalize at the
/// Router, with the effect claim the SigningWorker records before it signs.
pub fn admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_step_up_finalize_v1(
    admission: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
> {
    request.validate_at(now_unix_ms)?;
    let trusted_admission = cloudflare_router_ab_ecdsa_step_up_finalize_admission_v1(
        &request,
        &authorized_operation,
        trusted_source_digest,
    )?;
    let wallet_scope = require_step_up_wallet_scope_v1(
        authorized_operation.wallet_scope()?,
        &request.scope.wallet_id,
    )?;
    let trusted_admission = admission
        .apply_project_policy_to_normal_signing_admission_v1(&request.request_id, trusted_admission)?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Router A/B ECDSA derivation finalize Router admission did not allow SigningWorker forwarding",
        ));
    }
    let authorized_operation_identity =
        authorized_operation.into_signing_worker_authorized_operation_identity()?;
    let effect_claim = authorized_operation
        .authorized_operation
        .into_step_up_signing_worker_effect_claim()?;
    let mut admitted =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1::new(
            request,
            trusted_admission,
            authorized_operation_identity,
            effect_claim,
        )?;
    admitted.wallet_scope = Some(wallet_scope);
    admitted.validate()?;
    Ok(admitted)
}

/// The wallet a SigningWorker wallet-store signing request belongs to: the
/// Router admits one for an owner Wallet Session and for a verified step-up.
pub fn signing_worker_wallet_ecdsa_scope_v1(
    wallet_scope: Option<&CloudflareSigningWorkerWalletScopeV1>,
) -> RouterAbProtocolResult<&CloudflareSigningWorkerWalletScopeV1> {
    wallet_scope.ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "wallet-store ECDSA signing requires a Router-admitted wallet scope",
        )
    })
}

/// Prepares one owner ECDSA signature from the wallet's available pool:
/// reserves the presignature the client named for this exact request. An
/// exact retry returns the same reservation.
pub fn prepare_signing_worker_wallet_ecdsa_from_pool_v1<Sql: SigningWorkerWalletSqlV1>(
    store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
    request: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    now_unix_ms: u64,
    signing_worker_rerandomization_contribution32: [u8; 32],
) -> RouterAbProtocolResult<CloudflareEcdsaPrepareResponseV1> {
    request.validate()?;
    let wallet_scope =
        signing_worker_wallet_ecdsa_scope_v1(request.wallet_scope.as_ref())?.clone();
    if !matches!(
        request.presign_source,
        CloudflareEcdsaPrepareSourceV1::AvailablePool
    ) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "wallet-store ECDSA prepare requires available pool material",
        ));
    }
    let client_presignature_id = request.request.client_presignature_id.clone();
    let (active_signing_worker, material) = store.load_normal_signing_material(
        &wallet_scope,
        &request.request.scope,
        &request.material_source,
    )?;
    let materialized =
        CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            request,
            active_signing_worker,
            material,
            now_unix_ms,
        )?;
    let reserve = CloudflareSigningWorkerEcdsaPoolCommandV1::Reserve {
        scope: materialized.request.request.scope.clone(),
        server_presignature_id: client_presignature_id,
        expected_revision: 0,
        request_digest: materialized.request.request.request_digest()?,
        admitted_signing_digest: materialized.request.request.signing_digest()?,
        signing_worker_rerandomization_contribution32_b64u: encode_base64url_bytes_v1(
            &signing_worker_rerandomization_contribution32,
        ),
        reserved_at_ms: now_unix_ms,
        request_expires_at_ms: materialized.request.request.expires_at_ms,
    };
    let CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Reserved { record } =
        store.mutate_pool(wallet_scope, reserve)?
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker ECDSA pool reserve returned the wrong lifecycle outcome",
        ));
    };
    let reserved_material = record.reserved_material()?.clone();
    let response = RouterAbEcdsaDerivationEvmDigestSigningPrepareResponseV1::new_for_request(
        &materialized.request.request,
        reserved_material.server_presignature_id.clone(),
        reserved_material.server_big_r33_b64u.clone(),
        reserved_material
            .signing_worker_rerandomization_contribution32_b64u
            .clone(),
        now_unix_ms,
    )?;
    let prepared = CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestPreparedV1::new(
        response,
        reserved_material,
        &materialized,
    )?;
    Ok(CloudflareEcdsaPrepareResponseV1::AvailablePool(
        prepared.response,
    ))
}

/// Decodes one stored terminal response and checks it answers `request`.
pub fn signing_worker_ecdsa_stored_terminal_response_v1(
    terminal_json: &str,
    request: &RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationEvmDigestSigningResponseV1> {
    let response: RouterAbEcdsaDerivationEvmDigestSigningResponseV1 =
        serde_json::from_str(terminal_json).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("SigningWorker ECDSA terminal response JSON is invalid: {error}"),
            )
        })?;
    response.validate_for_request(request)?;
    Ok(response)
}
