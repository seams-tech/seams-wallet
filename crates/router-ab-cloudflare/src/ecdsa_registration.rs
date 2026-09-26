//! Router A/B ECDSA registration and activation, shared by every host.
//!
//! Each step here is host-neutral. A host supplies only the transport between
//! them: the Cloudflare Router posts the Deriver and SigningWorker requests over
//! Service Bindings, a VM Router over HTTP to ordinary processes.

use crate::*;

/// Router admission of one ECDSA registration.
pub enum CloudflareRouterAbEcdsaRegistrationAdmissionV1 {
    /// Both Derivers receive their private request, then the Router finishes.
    Forward(Box<CloudflareRouterAbEcdsaRegistrationForwardV1>),
    /// Project policy stopped the registration before any Deriver work.
    Stopped(CloudflareRouterAbEcdsaDerivationRegistrationAdmissionResponseV1),
}

/// One admitted registration: the private request for each Deriver, and what
/// the Router needs to finish once both respond.
pub struct CloudflareRouterAbEcdsaRegistrationForwardV1 {
    /// Deriver A's private registration request.
    pub deriver_a: CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1,
    /// Deriver B's private registration request.
    pub deriver_b: CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1,
    deriver_a_message: WireMessageV1,
    deriver_b_message: WireMessageV1,
    request: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    custody_binding_digest: TenantRootProtocolDigestV1,
    wallet_scope: CloudflareSigningWorkerWalletScopeV1,
    environment_key: String,
}

/// Admits one ECDSA registration at the Router.
///
/// Authenticates the tenant-root custody binding against the trusted issuer
/// keys, verifies the Gateway ceremony session, applies project policy and,
/// when policy allows, builds each Deriver's private request.
#[allow(clippy::too_many_arguments)]
pub fn admit_cloudflare_router_ab_ecdsa_derivation_registration_v1<Verifier>(
    admission: &CloudflareRouterAdmissionBindingsV1,
    env: &impl CloudflareEnvReaderV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    tenant_root_custody_binding: &CloudflareTenantRootCustodyBindingWireV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaRegistrationAdmissionV1>
where
    Verifier: CloudflareRouterJwtVerifierV1,
{
    request.validate_at(now_unix_ms)?;
    let custody_binding_digest = tenant_root_custody_binding
        .authenticate_for_registration(env, &request, now_unix_ms)?
        .digest()
        .map_err(map_root_share_to_protocol)?;
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
    let trusted_admission = derive_cloudflare_router_trusted_admission_from_signed_policy_v1(
        &public_request,
        verified_metadata.clone(),
    )?;
    let wallet_scope = CloudflareSigningWorkerWalletScopeV1::new(
        &verified_metadata.org_id,
        &verified_metadata.project_id,
        project_environment_id,
        &verified_metadata.account_id,
    )?;
    let plan = admission.public_request_admission_plan_at(
        now_unix_ms,
        public_request,
        trusted_admission,
    )?;
    let (deriver_a_message, deriver_b_message) = match plan {
        CloudflareRouterPublicAdmissionPlanV1::Forward {
            deriver_a_message,
            deriver_b_message,
            ..
        } => (deriver_a_message, deriver_b_message),
        CloudflareRouterPublicAdmissionPlanV1::Stop { trusted_admission } => {
            return Ok(CloudflareRouterAbEcdsaRegistrationAdmissionV1::Stopped(
                CloudflareRouterAbEcdsaDerivationRegistrationAdmissionResponseV1::stopped(
                    trusted_admission.decision,
                )?,
            ));
        }
    };
    let private_request = |worker_role, message: &WireMessageV1| {
        validate_cloudflare_signer_private_request_v1(worker_role, message)?;
        let signer_bootstrap =
            cloudflare_signer_private_bootstrap_from_ecdsa_derivation_registration_v1(
                worker_role,
                &request,
                message.clone(),
            )?;
        CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1::new(
            worker_role,
            request.clone(),
            signer_bootstrap,
            tenant_root_custody_binding.clone(),
        )
    };
    let deriver_a = private_request(CloudflareWorkerRoleV1::DeriverA, &deriver_a_message)?;
    let deriver_b = private_request(CloudflareWorkerRoleV1::DeriverB, &deriver_b_message)?;
    Ok(CloudflareRouterAbEcdsaRegistrationAdmissionV1::Forward(
        Box::new(CloudflareRouterAbEcdsaRegistrationForwardV1 {
            deriver_a,
            deriver_b,
            deriver_a_message,
            deriver_b_message,
            request,
            custody_binding_digest,
            wallet_scope,
            environment_key: verified_metadata.environment,
        }),
    ))
}

impl CloudflareRouterAbEcdsaRegistrationForwardV1 {
    /// Checks one Deriver's response against the request it was sent.
    pub fn validate_deriver_response(
        &self,
        worker_role: CloudflareWorkerRoleV1,
        response: &CloudflareSignerRecipientProofBundleResponseV1,
    ) -> RouterAbProtocolResult<()> {
        let message = match worker_role {
            CloudflareWorkerRoleV1::DeriverA => &self.deriver_a_message,
            CloudflareWorkerRoleV1::DeriverB => &self.deriver_b_message,
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidRole,
                    "ECDSA registration responses come from Deriver A or Deriver B",
                ))
            }
        };
        validate_cloudflare_signer_recipient_proof_bundle_private_response_v1(
            worker_role,
            message,
            response,
        )
    }

    /// Finishes the registration from both Derivers' responses: the client's
    /// proof bundles, and the pending SigningWorker activation the Gateway
    /// holds until the client verifies them.
    pub fn finish_with_deriver_responses(
        self,
        deriver_a_response: CloudflareSignerRecipientProofBundleResponseV1,
        deriver_b_response: CloudflareSignerRecipientProofBundleResponseV1,
    ) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationRegistrationAdmissionResponseV1>
    {
        self.validate_deriver_response(CloudflareWorkerRoleV1::DeriverA, &deriver_a_response)?;
        self.validate_deriver_response(CloudflareWorkerRoleV1::DeriverB, &deriver_b_response)?;
        let router_payload =
            decode_router_to_signer_payload_v1(self.deriver_a_message.payload.as_bytes())?;
        let response = CloudflareRouterRecipientProofBundleResponseV1::new(
            deriver_a_response.client_bundle.clone(),
            deriver_b_response.client_bundle.clone(),
        )?;
        response.validate_for_router_payload(&router_payload)?;
        let pending_activation =
            CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1::new(
                self.request,
                self.custody_binding_digest,
                self.wallet_scope,
                self.environment_key,
                router_payload,
                CloudflareSigningWorkerRecipientProofBundleActivationV1::new(
                    deriver_a_response.server_bundle,
                    deriver_b_response.server_bundle,
                )?,
            )?;
        CloudflareRouterAbEcdsaDerivationRegistrationAdmissionResponseV1::forwarded(
            response,
            pending_activation,
        )
    }
}

/// Admits the second registration phase at the Router: the client has
/// verified both proof bundles, and the same ceremony session owner asks the
/// SigningWorker to activate its material.
pub fn admit_cloudflare_router_ab_ecdsa_derivation_activation_v1<Verifier>(
    admission: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    command: CloudflareRouterAbEcdsaDerivationActivationCommandV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1>
where
    Verifier: CloudflareRouterJwtVerifierV1,
{
    command.validate()?;
    let public_request = command.pending.registration.to_threshold_prf_request()?;
    let mut session = CloudflareRouterJwtSessionProviderV1::new(
        admission.jwt.clone(),
        authorization,
        now_unix_ms,
        trusted_source_digest,
        command.pending.registration.request_digest()?,
        verifier,
    )?;
    let (verified_metadata, project_environment_id) =
        session.verify_ecdsa_ceremony_session(&public_request)?;
    let verified_scope = CloudflareSigningWorkerWalletScopeV1::new(
        &verified_metadata.org_id,
        &verified_metadata.project_id,
        project_environment_id,
        &verified_metadata.account_id,
    )?;
    if command.pending.wallet_scope != verified_scope {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "ECDSA activation owner differs from the verified ceremony session",
        ));
    }
    if command.pending.environment_key != verified_metadata.environment {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "ECDSA activation environment key differs from the original ceremony",
        ));
    }
    command.into_signing_worker_request()
}

/// The Deriver runtime facts the ECDSA Deriver handlers read.
pub trait CloudflareDeriverSignerRuntimeV1 {
    /// The Deriver role this runtime serves.
    fn worker_role(&self) -> CloudflareWorkerRoleV1;
    /// The role's signer-envelope HPKE decrypt-key descriptors.
    fn envelope_decrypt_key(&self) -> &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1;
    /// Trusted A/B peer verifying keys bound to a request signer set.
    fn peer_verifying_keys_for_signer_set(
        &self,
        signer_set: &SignerSetV1,
    ) -> RouterAbProtocolResult<Vec<AbPeerMessageVerifyingKeyV1>>;
}

impl CloudflareDeriverSignerRuntimeV1 for CloudflareDeriverAWorkerRuntimeV1 {
    fn worker_role(&self) -> CloudflareWorkerRoleV1 {
        CloudflareWorkerRoleV1::DeriverA
    }

    fn envelope_decrypt_key(&self) -> &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1 {
        CloudflareDeriverAWorkerRuntimeV1::envelope_decrypt_key(self)
    }

    fn peer_verifying_keys_for_signer_set(
        &self,
        signer_set: &SignerSetV1,
    ) -> RouterAbProtocolResult<Vec<AbPeerMessageVerifyingKeyV1>> {
        CloudflareDeriverAWorkerRuntimeV1::peer_verifying_keys_for_signer_set(self, signer_set)
    }
}

impl CloudflareDeriverSignerRuntimeV1 for CloudflareDeriverBWorkerRuntimeV1 {
    fn worker_role(&self) -> CloudflareWorkerRoleV1 {
        CloudflareWorkerRoleV1::DeriverB
    }

    fn envelope_decrypt_key(&self) -> &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1 {
        CloudflareDeriverBWorkerRuntimeV1::envelope_decrypt_key(self)
    }

    fn peer_verifying_keys_for_signer_set(
        &self,
        signer_set: &SignerSetV1,
    ) -> RouterAbProtocolResult<Vec<AbPeerMessageVerifyingKeyV1>> {
        CloudflareDeriverBWorkerRuntimeV1::peer_verifying_keys_for_signer_set(self, signer_set)
    }
}

/// Builds this Deriver's signer host for one authenticated private request.
pub(crate) fn preload_cloudflare_deriver_signer_host_v1(
    runtime: &impl CloudflareDeriverSignerRuntimeV1,
    authenticated_request: &CloudflareAuthenticatedSignerPrivateBootstrapRequestV1,
    now_unix_ms: u64,
    random_bytes: Vec<u8>,
) -> RouterAbProtocolResult<(
    CloudflareSignerHostPreloadPlanV1,
    CloudflarePreloadedSignerHostV1,
)> {
    let worker_role = runtime.worker_role();
    let protocol_role = cloudflare_worker_signer_role_v1(worker_role)?;
    let bootstrap = &authenticated_request.bootstrap;
    let preload_plan =
        CloudflareSignerHostPreloadPlanV1::from_private_bootstrap(worker_role, bootstrap)?;
    let verifying_keys = runtime.peer_verifying_keys_for_signer_set(&preload_plan.signer_set)?;
    let preload_input = preload_plan.to_host_preload_input(Vec::new(), verifying_keys, 0)?;
    let root_share_metadata = CloudflareRootShareStartupMetadataV1::new(
        preload_plan.signer_set_id.clone(),
        protocol_role,
        preload_plan.local_signer.signer_id.clone(),
        preload_plan.local_signer.key_epoch.clone(),
        preload_plan.root_share_epoch.clone(),
        format!(
            "tenant-root-role-private-d1/{}/active",
            worker_role.as_str()
        ),
    )?;
    let host = build_cloudflare_preloaded_signer_host_v1(
        now_unix_ms,
        protocol_role,
        preload_input,
        root_share_metadata,
        random_bytes,
    )?;
    Ok((preload_plan, host))
}

/// One Deriver signer request after authentication and preload: what every
/// ECDSA Deriver operation needs to decrypt the Router's envelope and prove.
pub(crate) struct CloudflareDeriverPreparedSignerV1 {
    pub(crate) signer_bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
    pub(crate) tenant_root_custody_binding: TenantRootCustodyBindingV1,
    pub(crate) outer_request: EcdsaThresholdPrfOuterRequestV2,
    pub(crate) host: CloudflarePreloadedSignerHostV1,
    pub(crate) root_share_metadata: CloudflareRootShareStartupMetadataV1,
    pub(crate) tenant_root_share: VerifiedTenantRootOnlineRoleShareV1,
}

/// The tenant-root host and the signer runtime must serve the same Deriver.
pub(crate) fn require_same_deriver_role_v1(
    host: &impl TenantRootDeriverHostV1,
    runtime: &impl CloudflareDeriverSignerRuntimeV1,
) -> RouterAbProtocolResult<()> {
    if host.worker_role() != runtime.worker_role() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "Deriver tenant-root host and signer runtime serve different roles",
        ));
    }
    Ok(())
}

/// Preloads the signer host for one authenticated Deriver request and loads
/// this role's share of the bound tenant root.
pub(crate) async fn prepare_cloudflare_deriver_signer_v1<Host>(
    host: &Host,
    runtime: &impl CloudflareDeriverSignerRuntimeV1,
    authenticated: CloudflareAuthenticatedSignerPrivateBootstrapRequestV1,
    public_request: &EcdsaThresholdPrfRequestV1,
    custody_wire: &CloudflareTenantRootCustodyBindingWireV1,
    now_unix_ms: u64,
    random_bytes: Vec<u8>,
) -> RouterAbProtocolResult<CloudflareDeriverPreparedSignerV1>
where
    Host: TenantRootDeriverHostV1,
{
    let outer_request = build_cloudflare_ecdsa_threshold_prf_outer_request_v2(
        public_request,
        authenticated.tenant_root_custody_binding(),
        custody_wire,
    )?;
    let (preload_plan, signer_host) = preload_cloudflare_deriver_signer_host_v1(
        runtime,
        &authenticated,
        now_unix_ms,
        random_bytes,
    )?;
    let root_share_metadata = signer_host
        .root_share_startup_metadata(
            cloudflare_worker_signer_role_v1(runtime.worker_role())?,
            &preload_plan.root_share_epoch,
        )?
        .clone();
    let tenant_root_share = tenant_root_deriver_load_bound_role_share_v1(
        host,
        authenticated.tenant_root_custody_binding(),
        now_unix_ms,
    )
    .await?;
    Ok(CloudflareDeriverPreparedSignerV1 {
        signer_bootstrap: authenticated.bootstrap,
        tenant_root_custody_binding: authenticated.tenant_root_custody_binding,
        outer_request,
        host: signer_host,
        root_share_metadata,
        tenant_root_share,
    })
}

/// One Deriver's ECDSA registration after authentication and preload, ready
/// to execute.
pub struct CloudflareDeriverEcdsaRegistrationV1 {
    registration_request: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    signer: CloudflareDeriverPreparedSignerV1,
}

/// Authenticates one Deriver's private registration request against the
/// tenant root, and loads the signer host and this role's tenant-root share.
pub async fn prepare_cloudflare_deriver_ecdsa_registration_v1<Host>(
    host: &Host,
    runtime: &impl CloudflareDeriverSignerRuntimeV1,
    private_request: CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1,
    now_unix_ms: u64,
    random_bytes: Vec<u8>,
) -> RouterAbProtocolResult<CloudflareDeriverEcdsaRegistrationV1>
where
    Host: TenantRootDeriverHostV1,
{
    require_same_deriver_role_v1(host, runtime)?;
    let (registration_request, authenticated, custody_wire) = private_request
        .into_authenticated_parts(host.env(), runtime.worker_role(), now_unix_ms)?;
    let public_request = registration_request.to_threshold_prf_request()?;
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
    Ok(CloudflareDeriverEcdsaRegistrationV1 {
        registration_request,
        signer,
    })
}

impl CloudflareDeriverEcdsaRegistrationV1 {
    /// Decrypts the Router's envelope and produces this Deriver's proof
    /// bundles for the client and the SigningWorker.
    pub fn execute_deriver_registration(
        self,
        secrets: &impl CloudflareSecretReaderV1,
        runtime: &impl CloudflareDeriverSignerRuntimeV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareSignerRecipientProofBundleResponseV1> {
        let signer = self.signer;
        decrypt_and_handle_cloudflare_router_ab_ecdsa_derivation_registration_signer_private_request_v1(
            secrets,
            runtime.worker_role(),
            &signer.host,
            self.registration_request,
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

/// One SigningWorker ECDSA activation with its server-output material opened.
pub struct CloudflareSigningWorkerEcdsaActivationV1 {
    activation: CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
    generic_activation: CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
    material: CloudflareServerOutputMaterialRecordV1,
}

/// Opens both Derivers' SigningWorker proof bundles for one activation with
/// the SigningWorker's server-output key.
pub fn open_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_v1(
    runtime: &CloudflareSigningWorkerRuntimeV1,
    secrets: &impl CloudflareSecretReaderV1,
    activation: CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaActivationV1> {
    activation.validate()?;
    let selected_server = activation
        .pending
        .activation_context
        .signer_set()
        .selected_server
        .clone();
    runtime
        .server_output_decrypt_key()
        .validate_matches_server(&selected_server)?;
    let generic_activation = activation.to_recipient_proof_bundle_activation_request()?;
    let binding = runtime.server_output_decrypt_key();
    binding.validate_visible_to(CloudflareWorkerRoleV1::SigningWorker)?;
    let secret = secrets.secret_text(&binding.binding_name)?;
    let mut private_key_bytes =
        decode_cloudflare_server_output_hpke_private_key_secret_v1(&secret)?;
    let material = cloudflare_server_output_material_record_from_ecdsa_activation_request_v2(
        &activation,
        &private_key_bytes,
    );
    private_key_bytes.zeroize();
    Ok(CloudflareSigningWorkerEcdsaActivationV1 {
        activation,
        generic_activation,
        material: material?,
    })
}

impl CloudflareSigningWorkerEcdsaActivationV1 {
    /// The wallet that owns this activation.
    pub fn wallet_scope(&self) -> &CloudflareSigningWorkerWalletScopeV1 {
        &self.activation.pending.wallet_scope
    }

    /// The activation and material the SigningWorker stores.
    pub fn stored_parts(
        &self,
    ) -> (
        &CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
        &CloudflareServerOutputMaterialRecordV1,
    ) {
        (&self.generic_activation, &self.material)
    }

    /// Stores this activation in the wallet store and returns the receipt.
    pub fn activate_in_wallet_store<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        activated_at_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1>
    {
        let signing_worker_output = store.activate(
            self.wallet_scope().clone(),
            self.generic_activation.clone(),
            self.material.clone(),
            activated_at_ms,
        )?;
        self.receipt(signing_worker_output)
    }

    /// The Router-facing receipt for the stored activation.
    pub fn receipt(
        self,
        signing_worker_output: CloudflareSigningWorkerOutputActivationReceiptV1,
    ) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1>
    {
        let ecdsa_receipt =
            cloudflare_router_ab_ecdsa_derivation_activation_receipt_from_material_v1(
                &self.activation,
                &self.material,
                signing_worker_output
                    .active_signing_worker_state
                    .activated_at_ms,
            )?;
        CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1::new(
            ecdsa_receipt,
            signing_worker_output,
        )
    }
}
