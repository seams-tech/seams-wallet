//! Router A/B ECDSA explicit export, shared by every host.
//!
//! The Router admits an export against the Gateway ceremony session and the
//! active tenant root, asks the SigningWorker to confirm the wallet's active
//! material, collects both Derivers' client bundles, then has the SigningWorker
//! seal its share to the export recipient. A host supplies only the transport
//! between these steps and where audit lines go.

use crate::*;

/// Router admission of one ECDSA explicit export.
pub enum CloudflareRouterAbEcdsaExportAdmissionV1 {
    /// The SigningWorker and both Derivers receive their requests, then the
    /// Router finishes.
    Forward(Box<CloudflareRouterAbEcdsaExportForwardV1>),
    /// Project policy stopped the export before any role work.
    Stopped(CloudflareRouterAbEcdsaDerivationExportAdmissionResponseV1),
}

/// One admitted export: each role's private request, and what the Router
/// needs to check their responses.
pub struct CloudflareRouterAbEcdsaExportForwardV1 {
    /// The SigningWorker's preflight and share request.
    pub signing_worker: CloudflareSigningWorkerEcdsaExportShareRequestV1,
    /// Deriver A's private export request.
    pub deriver_a: CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1,
    /// Deriver B's private export request.
    pub deriver_b: CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1,
    deriver_a_message: WireMessageV1,
    deriver_b_message: WireMessageV1,
}

/// Admits one ECDSA explicit export at the Router.
///
/// Verifies the Gateway ceremony session, whose claims name the wallet and its
/// Console project environment, binds the export to the active tenant root and
/// applies project policy.
#[allow(clippy::too_many_arguments)]
pub fn admit_cloudflare_router_ab_ecdsa_derivation_export_v1<Verifier>(
    admission: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    command: CloudflareRouterAbEcdsaDerivationExportCommandV1,
    active_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
    audit: &mut impl FnMut(&str),
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaExportAdmissionV1>
where
    Verifier: CloudflareRouterJwtVerifierV1,
{
    command.validate_at(now_unix_ms)?;
    let CloudflareRouterAbEcdsaDerivationExportCommandV1 {
        request,
        export_authority,
        material_source,
        private_authorization,
        tenant_root: _,
    } = command;
    let tenant_root_custody_binding =
        cloudflare_tenant_root_export_binding_wire_v1(&request, active_receipt)?;
    let public_request = request.to_threshold_prf_request()?;
    let mut session = CloudflareRouterJwtSessionProviderV1::new(
        admission.jwt.clone(),
        authorization,
        now_unix_ms,
        trusted_source_digest,
        request.request_digest()?,
        verifier,
    )?;
    let (verified_metadata, project_environment_id) =
        session.verify_ecdsa_ceremony_session(&public_request)?;
    let wallet_scope = CloudflareSigningWorkerWalletScopeV1::new(
        &verified_metadata.org_id,
        &verified_metadata.project_id,
        project_environment_id,
        &verified_metadata.account_id,
    )?;
    let trusted_admission =
        derive_cloudflare_router_trusted_admission_from_signed_policy_v1(
            &public_request,
            verified_metadata,
        )?;
    let plan = admission.public_request_admission_plan_at(
        now_unix_ms,
        public_request.clone(),
        trusted_admission,
    )?;
    let (deriver_a_message, deriver_b_message) = match plan {
        CloudflareRouterPublicAdmissionPlanV1::Forward {
            deriver_a_message,
            deriver_b_message,
            ..
        } => (deriver_a_message, deriver_b_message),
        CloudflareRouterPublicAdmissionPlanV1::Stop { trusted_admission } => {
            audit(&cloudflare_router_ab_ecdsa_derivation_explicit_export_audit_line_v1(
                &request,
                router_ab_core::RouterAbEcdsaDerivationExplicitExportAuditDecisionV1::Stopped,
                "router_admission_stopped_export",
            )?);
            return Ok(CloudflareRouterAbEcdsaExportAdmissionV1::Stopped(
                CloudflareRouterAbEcdsaDerivationExportAdmissionResponseV1::stopped(
                    trusted_admission.decision,
                )?,
            ));
        }
    };
    let signing_worker = CloudflareSigningWorkerEcdsaExportShareRequestV1 {
        request: request.clone(),
        export_authority,
        material_source,
        private_authorization,
        wallet_scope,
    };
    signing_worker.validate_at(now_unix_ms)?;
    let private_request = |worker_role, message: &WireMessageV1| {
        validate_cloudflare_signer_private_request_v1(worker_role, message)?;
        let signer_bootstrap = cloudflare_signer_private_bootstrap_from_public_request_v1(
            worker_role,
            &public_request,
            message.clone(),
        )?;
        CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1::new(
            worker_role,
            request.clone(),
            signer_bootstrap,
            tenant_root_custody_binding.clone(),
        )
    };
    let deriver_a = private_request(CloudflareWorkerRoleV1::DeriverA, &deriver_a_message)?;
    let deriver_b = private_request(CloudflareWorkerRoleV1::DeriverB, &deriver_b_message)?;
    Ok(CloudflareRouterAbEcdsaExportAdmissionV1::Forward(Box::new(
        CloudflareRouterAbEcdsaExportForwardV1 {
            signing_worker,
            deriver_a,
            deriver_b,
            deriver_a_message,
            deriver_b_message,
        },
    )))
}

impl CloudflareRouterAbEcdsaExportForwardV1 {
    /// Accepts one Deriver's export result: an error is audited as a
    /// rejection, and a response must answer the request that Deriver was sent.
    pub fn accept_deriver_result(
        &self,
        worker_role: CloudflareWorkerRoleV1,
        result: RouterAbProtocolResult<CloudflareSignerClientRecipientProofBundleResponseV1>,
        audit: &mut impl FnMut(&str),
    ) -> RouterAbProtocolResult<CloudflareSignerClientRecipientProofBundleResponseV1> {
        let (message, reason_code) = match worker_role {
            CloudflareWorkerRoleV1::DeriverA => {
                (&self.deriver_a_message, "deriver_a_export_service_error")
            }
            CloudflareWorkerRoleV1::DeriverB => {
                (&self.deriver_b_message, "deriver_b_export_service_error")
            }
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidRole,
                    "ECDSA export responses come from Deriver A or Deriver B",
                ))
            }
        };
        let response = match result {
            Ok(response) => response,
            Err(error) => {
                audit(&cloudflare_router_ab_ecdsa_derivation_explicit_export_audit_line_v1(
                    &self.signing_worker.request,
                    router_ab_core::RouterAbEcdsaDerivationExplicitExportAuditDecisionV1::Rejected,
                    reason_code,
                )?);
                return Err(error);
            }
        };
        validate_cloudflare_signer_client_recipient_proof_bundle_private_response_v1(
            worker_role,
            message,
            &response,
        )?;
        Ok(response)
    }

    /// Combines both Derivers' client bundles into the client's export
    /// response and audits that it was forwarded.
    pub fn client_bundles(
        &self,
        deriver_a_response: CloudflareSignerClientRecipientProofBundleResponseV1,
        deriver_b_response: CloudflareSignerClientRecipientProofBundleResponseV1,
        audit: &mut impl FnMut(&str),
    ) -> RouterAbProtocolResult<CloudflareRouterRecipientProofBundleResponseV1> {
        let router_payload =
            decode_router_to_signer_payload_v1(self.deriver_a_message.payload.as_bytes())?;
        let response = CloudflareRouterRecipientProofBundleResponseV1::new(
            deriver_a_response.client_bundle,
            deriver_b_response.client_bundle,
        )?;
        response.validate_for_router_payload(&router_payload)?;
        audit(&cloudflare_router_ab_ecdsa_derivation_explicit_export_audit_line_v1(
            &self.signing_worker.request,
            router_ab_core::RouterAbEcdsaDerivationExplicitExportAuditDecisionV1::Forwarded,
            "forwarded_client_export_bundles",
        )?);
        Ok(response)
    }
}

/// Checks the SigningWorker's sealed share before the Router returns it.
pub fn validate_cloudflare_signing_worker_ecdsa_export_share_envelope_v1(
    envelope: EcdsaSigningWorkerExportShareEnvelopeV1,
) -> RouterAbProtocolResult<EcdsaSigningWorkerExportShareEnvelopeV1> {
    envelope.validate().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "SigningWorker returned an invalid ECDSA export-share envelope",
        )
    })?;
    Ok(envelope)
}

/// One Deriver's ECDSA export after authentication and preload, ready to
/// execute.
pub struct CloudflareDeriverEcdsaExportV1 {
    export_request: RouterAbEcdsaDerivationExplicitExportRequestV1,
    signer: CloudflareDeriverPreparedSignerV1,
}

/// Authenticates one Deriver's private export request against the active
/// tenant root, and loads the signer host and this role's tenant-root share.
pub async fn prepare_cloudflare_deriver_ecdsa_export_v1<Host>(
    host: &Host,
    runtime: &impl CloudflareDeriverSignerRuntimeV1,
    private_request: CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1,
    now_unix_ms: u64,
    random_bytes: Vec<u8>,
) -> RouterAbProtocolResult<CloudflareDeriverEcdsaExportV1>
where
    Host: TenantRootDeriverHostV1,
{
    require_same_deriver_role_v1(host, runtime)?;
    let (export_request, authenticated, custody_wire) =
        private_request.into_authenticated_parts(host.env(), runtime.worker_role(), now_unix_ms)?;
    let public_request = export_request.to_threshold_prf_request()?;
    let signer = prepare_cloudflare_deriver_signer_v1(
        host,
        runtime,
        authenticated,
        &public_request,
        &custody_wire,
        now_unix_ms,
        random_bytes,
    )
    .await?;
    Ok(CloudflareDeriverEcdsaExportV1 {
        export_request,
        signer,
    })
}

impl CloudflareDeriverEcdsaExportV1 {
    /// Decrypts the Router's envelope and produces this Deriver's client-only
    /// export bundle.
    pub fn execute_deriver_export(
        self,
        secrets: &impl CloudflareSecretReaderV1,
        runtime: &impl CloudflareDeriverSignerRuntimeV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareSignerClientRecipientProofBundleResponseV1> {
        let signer = self.signer;
        decrypt_and_handle_cloudflare_router_ab_ecdsa_derivation_export_signer_private_request_v1(
            secrets,
            runtime.worker_role(),
            &signer.host,
            self.export_request,
            signer.signer_bootstrap,
            signer.tenant_root_custody_binding,
            signer.outer_request,
            signer.tenant_root_share,
            runtime.envelope_decrypt_key(),
            &signer.root_share_metadata,
            now_unix_ms,
        )
    }
}

/// Confirms the wallet's active ECDSA material can be exported, without
/// releasing anything.
pub fn preflight_signing_worker_wallet_ecdsa_export_v1<Sql: SigningWorkerWalletSqlV1>(
    store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
    request: &CloudflareSigningWorkerEcdsaExportShareRequestV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaExportPreflightResponseV1> {
    request.validate_at(now_unix_ms)?;
    store.load_normal_signing_material(
        &request.wallet_scope,
        &request.export_authority.normal_signing_scope,
        &request.material_source,
    )?;
    Ok(CloudflareSigningWorkerEcdsaExportPreflightResponseV1 { ready: true })
}

/// Seals the wallet's active SigningWorker share to the one admitted export
/// recipient.
pub fn seal_signing_worker_wallet_ecdsa_export_share_v1<Sql: SigningWorkerWalletSqlV1>(
    store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
    request: &CloudflareSigningWorkerEcdsaExportShareRequestV1,
    now_unix_ms: u64,
    seal_seed: [u8; 32],
) -> RouterAbProtocolResult<EcdsaSigningWorkerExportShareEnvelopeV1> {
    request.validate_at(now_unix_ms)?;
    let scope = &request.export_authority.normal_signing_scope;
    let (active_signing_worker, material) =
        store.load_normal_signing_material(&request.wallet_scope, scope, &request.material_source)?;
    seal_cloudflare_signing_worker_ecdsa_export_share_v1(
        request,
        &active_signing_worker,
        &material,
        seal_seed,
    )
}

/// Seals the SigningWorker share of loaded active material to the export
/// recipient the request binds.
pub(crate) fn seal_cloudflare_signing_worker_ecdsa_export_share_v1(
    request: &CloudflareSigningWorkerEcdsaExportShareRequestV1,
    active_signing_worker: &ActiveSigningWorkerStateV1,
    material: &CloudflareServerOutputMaterialRecordV1,
    seal_seed: [u8; 32],
) -> RouterAbProtocolResult<EcdsaSigningWorkerExportShareEnvelopeV1> {
    let (relayer_share, _) =
        cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_active_material_v1(
            &request.export_authority.normal_signing_scope,
            active_signing_worker,
            material,
        )?;
    seal_ecdsa_signing_worker_export_share_v1(
        request.export_share_binding()?,
        &relayer_share.x_relayer32,
        seal_seed,
    )
    .map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker ECDSA export-share encryption failed",
        )
    })
}
