//! The runtime of each Worker role, the preloaded signer host, Router admission and bearer parsing.

use super::*;

/// Thin Router Worker runtime context after Cloudflare startup validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareRouterWorkerRuntimeV1 {
    pub(super) bindings: CloudflareRouterBindingsV1,
}

/// Thin Deriver A Worker runtime context after startup validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareDeriverAWorkerRuntimeV1 {
    pub(super) bindings: CloudflareDeriverABindingsV1,
}

/// Thin Deriver B Worker runtime context after startup validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareDeriverBWorkerRuntimeV1 {
    pub(super) bindings: CloudflareDeriverBBindingsV1,
}

/// Thin SigningWorker runtime context after startup validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSigningWorkerRuntimeV1 {
    pub(super) bindings: CloudflareSigningWorkerBindingsV1,
}

/// Thin tenant-root control-plane Worker runtime context after startup validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CloudflareTenantRootControlPlaneRuntimeV1 {
    pub(super) bindings: CloudflareTenantRootControlPlaneBindingsV1,
}

impl CloudflareTenantRootControlPlaneRuntimeV1 {
    /// Creates a control-plane runtime context from parsed bindings.
    pub fn new(
        bindings: CloudflareTenantRootControlPlaneBindingsV1,
    ) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self { bindings })
    }

    /// Parses and validates a real Cloudflare Worker Env for control-plane startup.
    ///
    /// Fails closed on any forbidden key, a missing issuer Secret, a binding
    /// name that is not control-plane scoped, or an issuer Secret that does not
    /// derive the public key published under the configured active key ID.
    #[cfg(feature = "workers-rs")]
    pub fn from_worker_env(env: &worker::Env) -> RouterAbProtocolResult<Self> {
        let CloudflareWorkerBindingsV1::TenantRootControlPlane { bindings } =
            parse_cloudflare_worker_bindings_from_worker_env_v1(
                CloudflareWorkerRoleV1::TenantRootControlPlane,
                env,
            )?
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root control-plane Env parsing returned wrong binding branch",
            ));
        };
        let runtime = Self::new(bindings)?;
        runtime.require_issuer_key_provenance(env)?;
        Ok(runtime)
    }

    /// Proves at boot that the issuer Secret matches its published active key.
    #[cfg(feature = "workers-rs")]
    pub(super) fn require_issuer_key_provenance(&self, env: &worker::Env) -> RouterAbProtocolResult<()> {
        let binding = &self.bindings.issuer_signing_key;
        let secret = env.secret(binding.binding_name()).map_err(|err| {
            worker_binding_error(
                worker_binding_error_code(&err, binding.binding_name()),
                binding.binding_name(),
                "secret",
                err,
            )
        })?;
        let mut secret_value = secret.to_string();
        let result =
            crate::env::validate_cloudflare_tenant_root_control_plane_issuer_key_provenance_v1(
                binding,
                &self.bindings.issuer_verifying_keys,
                &secret_value,
            );
        secret_value.zeroize();
        result
    }

    /// Returns validated control-plane bindings.
    pub fn bindings(&self) -> &CloudflareTenantRootControlPlaneBindingsV1 {
        &self.bindings
    }
}

/// Input for loading a synchronous signer host from async Cloudflare resources.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSignerHostPreloadInputV1 {
    /// Signer set id whose local root-share metadata must be loaded.
    pub signer_set_id: String,
    /// Root-share epoch to load for the local signer role.
    pub root_share_epoch: RootShareEpoch,
    /// Number of random bytes to preload before entering synchronous core code.
    pub random_bytes_len: usize,
}

impl CloudflareSignerHostPreloadInputV1 {
    /// Creates a validated Deriver-host preload request.
    pub fn new(
        signer_set_id: impl Into<String>,
        root_share_epoch: RootShareEpoch,
        random_bytes_len: usize,
    ) -> RouterAbProtocolResult<Self> {
        let input = Self {
            signer_set_id: signer_set_id.into(),
            root_share_epoch,
            random_bytes_len,
        };
        input.validate()?;
        Ok(input)
    }

    /// Validates preload identity and random-buffer budget.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty("signer_set_id", &self.signer_set_id)?;
        require_non_empty("root_share_epoch", self.root_share_epoch.as_str())?;
        if self.random_bytes_len > CLOUDFLARE_DERIVER_HOST_RANDOM_PRELOAD_MAX_BYTES_V1 {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "signer host random preload length exceeds maximum",
            ));
        }
        Ok(())
    }
}

/// Synchronous signer host built from async Cloudflare adapter preload results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflarePreloadedSignerHostV1 {
    /// Worker-local time captured by the adapter.
    pub now_unix_ms: u64,
    /// Role-local root-share startup metadata loaded before engine execution.
    pub root_share_metadata: Vec<CloudflareRootShareStartupMetadataV1>,
    /// Random bytes supplied by the adapter before engine execution.
    pub random_bytes: Vec<u8>,
}

impl CloudflarePreloadedSignerHostV1 {
    /// Creates a validated preloaded signer host.
    pub fn new(
        now_unix_ms: u64,
        root_share_metadata: Vec<CloudflareRootShareStartupMetadataV1>,
        random_bytes: Vec<u8>,
    ) -> RouterAbProtocolResult<Self> {
        let host = Self {
            now_unix_ms,
            root_share_metadata,
            random_bytes,
        };
        host.validate()?;
        Ok(host)
    }

    /// Validates preloaded host material.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        if self.now_unix_ms == 0 {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "preloaded signer host now_unix_ms must be greater than zero",
            ));
        }
        for metadata in &self.root_share_metadata {
            metadata.validate()?;
            require_signer_role(metadata.signer_role)?;
        }
        Ok(())
    }

    /// Returns preloaded role-local root-share startup metadata.
    pub(crate) fn root_share_startup_metadata(
        &self,
        role: Role,
        epoch: &RootShareEpoch,
    ) -> RouterAbProtocolResult<&CloudflareRootShareStartupMetadataV1> {
        require_signer_role(role)?;
        require_non_empty("root_share_epoch", epoch.as_str())?;
        self.root_share_metadata
            .iter()
            .find(|metadata| metadata.signer_role == role && &metadata.root_share_epoch == epoch)
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MissingLocalBinding,
                    format!(
                        "preloaded signer host is missing {} root-share metadata",
                        role.as_str()
                    ),
                )
            })
    }
}

/// Builds a synchronous signer host from already loaded Cloudflare resources.
pub fn build_cloudflare_preloaded_signer_host_v1(
    now_unix_ms: u64,
    expected_role: Role,
    input: CloudflareSignerHostPreloadInputV1,
    root_share_metadata: CloudflareRootShareStartupMetadataV1,
    random_bytes: Vec<u8>,
) -> RouterAbProtocolResult<CloudflarePreloadedSignerHostV1> {
    require_signer_role(expected_role)?;
    input.validate()?;
    root_share_metadata.validate()?;
    if root_share_metadata.signer_role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "preloaded root-share metadata role does not match signer host role",
        ));
    }
    if root_share_metadata.signer_set_id != input.signer_set_id
        || root_share_metadata.root_share_epoch != input.root_share_epoch
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "preloaded root-share metadata does not match signer host preload input",
        ));
    }
    if random_bytes.len() != input.random_bytes_len {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "preloaded random byte length does not match signer host preload input",
        ));
    }
    CloudflarePreloadedSignerHostV1::new(now_unix_ms, vec![root_share_metadata], random_bytes)
}

impl Clock for CloudflarePreloadedSignerHostV1 {
    fn now_unix_ms(&self) -> u64 {
        self.now_unix_ms
    }
}

impl Csprng for CloudflarePreloadedSignerHostV1 {
    fn fill_random(&mut self, out: &mut [u8]) -> RouterAbProtocolResult<()> {
        if self.random_bytes.len() < out.len() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "preloaded signer host random buffer is exhausted",
            ));
        }
        out.copy_from_slice(&self.random_bytes[..out.len()]);
        self.random_bytes.drain(..out.len());
        Ok(())
    }
}

impl SignerKeyStore for CloudflarePreloadedSignerHostV1 {
    fn signer_identity(&self, role: Role) -> RouterAbProtocolResult<String> {
        require_signer_role(role)?;
        self.root_share_metadata
            .iter()
            .find(|metadata| metadata.signer_role == role)
            .map(|metadata| metadata.signer_id.clone())
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MissingLocalBinding,
                    format!(
                        "preloaded signer host is missing {} identity",
                        role.as_str()
                    ),
                )
            })
    }
}

impl SigningRootShareStore for CloudflarePreloadedSignerHostV1 {
    fn has_root_share(&self, role: Role, epoch: &RootShareEpoch) -> RouterAbProtocolResult<bool> {
        require_signer_role(role)?;
        require_non_empty("root_share_epoch", epoch.as_str())?;
        Ok(self
            .root_share_metadata
            .iter()
            .any(|metadata| metadata.signer_role == role && &metadata.root_share_epoch == epoch))
    }
}

impl AuditSink for CloudflarePreloadedSignerHostV1 {
    fn record_audit_event(&self, _event: AuditEventV1) -> RouterAbProtocolResult<()> {
        Ok(())
    }
}

impl CloudflareRouterWorkerRuntimeV1 {
    /// Creates a Router runtime context from already parsed bindings.
    pub fn new(bindings: CloudflareRouterBindingsV1) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self { bindings })
    }

    /// Parses and validates a real Cloudflare Worker Env for Router startup.
    #[cfg(feature = "workers-rs")]
    pub fn from_worker_env(env: &worker::Env) -> RouterAbProtocolResult<Self> {
        let CloudflareWorkerBindingsV1::Router { bindings } =
            parse_cloudflare_worker_bindings_from_worker_env_v1(
                CloudflareWorkerRoleV1::Router,
                env,
            )?
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "Router Worker Env parsing returned non-Router bindings",
            ));
        };
        Self::new(bindings)
    }

    /// Returns validated Router bindings.
    pub fn bindings(&self) -> &CloudflareRouterBindingsV1 {
        &self.bindings
    }

    /// Returns Router-owned admission bindings.
    pub fn admission_bindings(&self) -> &CloudflareRouterAdmissionBindingsV1 {
        &self.bindings.admission
    }

    /// Applies the deployment project policy to a trusted expensive-work admission.
    pub fn apply_project_policy_to_trusted_admission_v1(
        &self,
        request: &EcdsaThresholdPrfRequestV1,
        admission: CloudflareRouterTrustedAdmissionV1,
    ) -> RouterAbProtocolResult<CloudflareRouterTrustedAdmissionV1> {
        self.bindings
            .admission
            .apply_project_policy_to_trusted_admission_v1(request, admission)
    }

    /// Applies the deployment project policy to a trusted normal-signing admission.
    pub fn apply_project_policy_to_normal_signing_admission_v1(
        &self,
        request_id: &str,
        admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
    ) -> RouterAbProtocolResult<CloudflareRouterNormalSigningTrustedAdmissionV1> {
        self.bindings
            .admission
            .apply_project_policy_to_normal_signing_admission_v1(request_id, admission)
    }

    /// Evaluates the deployment project policy for a validated Yao ceremony.
    pub fn evaluate_project_policy_for_yao_work_kind_v1(
        &self,
        work_kind: ExpensiveWorkKindV1,
    ) -> RouterAbProtocolResult<CloudflareRouterProjectPolicyV1> {
        self.bindings
            .admission
            .project_policy
            .policy_for_yao_work_kind(work_kind)
    }

    /// Validates a public request with trusted admission and builds gate-aware work.
    pub fn public_request_admission_plan_at(
        &self,
        now_unix_ms: u64,
        request: EcdsaThresholdPrfRequestV1,
        trusted_admission: CloudflareRouterTrustedAdmissionV1,
    ) -> RouterAbProtocolResult<CloudflareRouterPublicAdmissionPlanV1> {
        self.bindings.admission.public_request_admission_plan_at(
            now_unix_ms,
            request,
            trusted_admission,
        )
    }

    /// Derives trusted admission from a provider and builds gate-aware work.
    pub fn public_request_admission_plan_from_provider_at(
        &self,
        now_unix_ms: u64,
        request: EcdsaThresholdPrfRequestV1,
        provider: &mut impl CloudflareRouterAdmissionProviderV1,
    ) -> RouterAbProtocolResult<CloudflareRouterPublicAdmissionPlanV1> {
        let trusted_admission =
            derive_cloudflare_router_trusted_admission_from_provider_v1(&request, provider)?;
        self.public_request_admission_plan_at(now_unix_ms, request, trusted_admission)
    }

    /// Returns the Deriver A peer binding used by the Router transport wrapper.
    pub fn deriver_a_peer(&self) -> &CloudflarePeerBindingV1 {
        &self.bindings.deriver_a
    }

    /// Returns the Deriver B peer binding used by the Router transport wrapper.
    pub fn deriver_b_peer(&self) -> &CloudflarePeerBindingV1 {
        &self.bindings.deriver_b
    }

    /// Returns the SigningWorker peer binding used by activation and normal signing.
    pub(crate) fn signing_worker_peer(&self) -> &CloudflarePeerBindingV1 {
        &self.bindings.signing_worker
    }
}

impl CloudflareDeriverAWorkerRuntimeV1 {
    /// Creates a Deriver A runtime context from parsed bindings.
    pub fn new(bindings: CloudflareDeriverABindingsV1) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self { bindings })
    }

    /// Parses and validates a real Cloudflare Worker Env for Deriver A startup.
    #[cfg(feature = "workers-rs")]
    pub fn from_worker_env(env: &worker::Env) -> RouterAbProtocolResult<Self> {
        let CloudflareWorkerBindingsV1::DeriverA { bindings } =
            parse_cloudflare_worker_bindings_from_worker_env_v1(
                CloudflareWorkerRoleV1::DeriverA,
                env,
            )?
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "Deriver A Worker Env parsing returned wrong binding branch",
            ));
        };
        Self::new(bindings)
    }

    /// Returns validated Deriver A bindings.
    pub fn bindings(&self) -> &CloudflareDeriverABindingsV1 {
        &self.bindings
    }

    /// Returns Deriver B peer binding used by direct A/B coordination.
    pub fn deriver_b_peer(&self) -> &CloudflarePeerBindingV1 {
        &self.bindings.deriver_b
    }

    /// Returns Deriver A's role-local signer-envelope HPKE decrypt-key descriptors.
    pub fn envelope_decrypt_key(&self) -> &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1 {
        &self.bindings.envelope_decrypt_key
    }
}

impl CloudflareSigningWorkerRuntimeV1 {
    /// Creates a SigningWorker runtime context from parsed bindings.
    pub fn new(bindings: CloudflareSigningWorkerBindingsV1) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self { bindings })
    }

    /// Parses and validates a real Cloudflare Worker Env for SigningWorker startup.
    #[cfg(feature = "workers-rs")]
    pub fn from_worker_env(env: &worker::Env) -> RouterAbProtocolResult<Self> {
        let CloudflareWorkerBindingsV1::SigningWorker { bindings } =
            parse_cloudflare_worker_bindings_from_worker_env_v1(
                CloudflareWorkerRoleV1::SigningWorker,
                env,
            )?
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "SigningWorker Env parsing returned wrong binding branch",
            ));
        };
        Self::new(bindings)
    }

    /// Returns validated SigningWorker bindings.
    pub fn bindings(&self) -> &CloudflareSigningWorkerBindingsV1 {
        &self.bindings
    }

    /// Builds a server-output activation call.
    pub(crate) fn signing_worker_output_activate_request(
        &self,
        activation: CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
        material: CloudflareServerOutputMaterialRecordV1,
        activated_at_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerPrivateD1RequestV1> {
        let request = CloudflareSigningWorkerPrivateD1RequestV1::OutputActivate {
            activation,
            material,
            activated_at_ms,
        };
        request.validate()?;
        Ok(request)
    }

    /// Builds an active SigningWorker-state lookup call.
    pub fn active_signing_worker_state_get_request(
        &self,
        lookup: CloudflareActiveSigningWorkerStateLookupV1,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerPrivateD1RequestV1> {
        let request = CloudflareSigningWorkerPrivateD1RequestV1::ActiveStateGet { lookup };
        request.validate()?;
        Ok(request)
    }

    /// Builds an active SigningWorker material lookup call.
    pub fn signing_worker_output_material_get_request(
        &self,
        lookup: CloudflareSigningWorkerOutputMaterialLookupV1,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerPrivateD1RequestV1> {
        let request = CloudflareSigningWorkerPrivateD1RequestV1::OutputMaterialGet { lookup };
        request.validate()?;
        Ok(request)
    }

    /// Builds a SigningWorker round-1 nonce persistence call.
    pub(crate) fn signing_worker_round1_put_request(
        &self,
        record: CloudflareSigningWorkerRound1RecordV1,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerPrivateD1RequestV1> {
        let request = CloudflareSigningWorkerPrivateD1RequestV1::Round1Put { record };
        request.validate()?;
        Ok(request)
    }

    /// Builds a SigningWorker round-1 nonce take call.
    pub(crate) fn signing_worker_round1_take_request(
        &self,
        lookup: CloudflareSigningWorkerRound1LookupV1,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerPrivateD1RequestV1> {
        let request = CloudflareSigningWorkerPrivateD1RequestV1::Round1Take { lookup };
        request.validate()?;
        Ok(request)
    }

    /// Builds one atomic SigningWorker ECDSA pool lifecycle mutation call.
    pub fn signing_worker_ecdsa_pool_mutate_request(
        &self,
        command: CloudflareSigningWorkerEcdsaPoolCommandV1,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerPrivateD1RequestV1> {
        let request = CloudflareSigningWorkerPrivateD1RequestV1::EcdsaPoolMutate { command };
        request.validate()?;
        Ok(request)
    }

    /// Returns SigningWorker's server-output HPKE decrypt-key descriptor.
    pub fn server_output_decrypt_key(&self) -> &CloudflareServerOutputHpkeDecryptKeyBindingV1 {
        &self.bindings.server_output_decrypt_key
    }
}

impl CloudflareDeriverBWorkerRuntimeV1 {
    /// Creates a Deriver B runtime context from parsed bindings.
    pub fn new(bindings: CloudflareDeriverBBindingsV1) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self { bindings })
    }

    /// Parses and validates a real Cloudflare Worker Env for Deriver B startup.
    #[cfg(feature = "workers-rs")]
    pub fn from_worker_env(env: &worker::Env) -> RouterAbProtocolResult<Self> {
        let CloudflareWorkerBindingsV1::DeriverB { bindings } =
            parse_cloudflare_worker_bindings_from_worker_env_v1(
                CloudflareWorkerRoleV1::DeriverB,
                env,
            )?
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "Deriver B Worker Env parsing returned wrong binding branch",
            ));
        };
        Self::new(bindings)
    }

    /// Returns validated Deriver B bindings.
    pub fn bindings(&self) -> &CloudflareDeriverBBindingsV1 {
        &self.bindings
    }

    /// Returns Deriver A peer binding used by direct A/B coordination.
    pub fn deriver_a_peer(&self) -> &CloudflarePeerBindingV1 {
        &self.bindings.deriver_a
    }

    /// Returns Deriver B's role-local signer-envelope HPKE decrypt-key descriptors.
    pub fn envelope_decrypt_key(&self) -> &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1 {
        &self.bindings.envelope_decrypt_key
    }
}

/// Loads the tenant-root role share the authenticated custody binding names,
/// admitting its operation on the binding's epoch first.
#[cfg(feature = "workers-rs")]
pub(crate) async fn load_cloudflare_bound_tenant_root_role_share_v1(
    env: &worker::Env,
    worker_role: CloudflareWorkerRoleV1,
    authenticated_custody_binding: &TenantRootCustodyBindingV1,
    attempt: &tenant_root_role_d1::TenantRootRootUseAttemptV1,
) -> RouterAbProtocolResult<VerifiedTenantRootOnlineRoleShareV1> {
    tenant_root_role_runtime::tenant_root_deriver_load_bound_role_share_v1(
        &tenant_root_role_runtime::CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        authenticated_custody_binding,
        attempt,
        cloudflare_now_unix_ms_v1()?,
    )
    .await
}

pub(super) fn cloudflare_router_allowed_admission_checks_v1(
    request_id: impl Into<String>,
) -> RouterAbProtocolResult<CloudflareRouterAdmissionChecksV1> {
    CloudflareRouterAdmissionChecksV1::new(
        CloudflareRouterProjectPolicyV1::Allowed,
        CloudflareRouterAbuseCheckV1::Allowed,
        CloudflareRouterQuotaCheckV1::Accepted {
            request_id: request_id.into(),
        },
    )
}

/// Derives trusted Router admission from the locally verified request policy.
pub(crate) fn derive_cloudflare_router_trusted_admission_from_signed_policy_v1(
    request: &EcdsaThresholdPrfRequestV1,
    metadata: CloudflareRouterTrustedRequestMetadataV1,
) -> RouterAbProtocolResult<CloudflareRouterTrustedAdmissionV1> {
    metadata.validate_for_request(request)?;
    let checks = cloudflare_router_allowed_admission_checks_v1(&request.request_nonce)?;
    derive_cloudflare_router_trusted_admission_v1(request, metadata, checks)
}

/// Derives trusted normal-signing v2 prepare admission from the verified Wallet Session.
pub(crate) fn derive_cloudflare_router_normal_signing_prepare_trusted_admission_v2(
    request: &RouterAbEd25519NormalSigningPrepareRequestV2,
    admission: &CloudflareRouterNormalSigningPrepareAdmissionCandidateV2,
) -> RouterAbProtocolResult<CloudflareRouterNormalSigningTrustedAdmissionV1> {
    admission.validate_for_prepare_request(request)?;
    let checks = cloudflare_router_allowed_admission_checks_v1(&request.scope.request_id)?;
    CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        admission.to_v1_trusted_metadata()?,
        checks.to_gate_decision()?,
    )
}

/// Derives trusted normal-signing v2 finalize admission from the verified Wallet Session.
pub(crate) fn derive_cloudflare_router_normal_signing_finalize_trusted_admission_v2(
    request: &RouterAbEd25519NormalSigningFinalizeRequestV2,
    admission: &CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2,
) -> RouterAbProtocolResult<CloudflareRouterNormalSigningTrustedAdmissionV1> {
    admission.validate_for_finalize_request(request)?;
    let checks = cloudflare_router_allowed_admission_checks_v1(&request.scope.request_id)?;
    CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        admission.to_v1_trusted_metadata()?,
        checks.to_gate_decision()?,
    )
}

/// Derives trusted Router A/B ECDSA derivation prepare admission from the verified Wallet Session.
pub fn derive_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_trusted_admission_v1(
    request: &RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    admission: &CloudflareRouterAbEcdsaDerivationEvmDigestPrepareAdmissionCandidateV1,
) -> RouterAbProtocolResult<CloudflareRouterNormalSigningTrustedAdmissionV1> {
    admission.validate_for_prepare_request(request)?;
    let checks = cloudflare_router_allowed_admission_checks_v1(&request.request_id)?;
    CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        admission.to_normal_signing_trusted_metadata()?,
        checks.to_gate_decision()?,
    )
}

/// Derives trusted Router A/B ECDSA derivation finalize admission from the verified Wallet Session.
pub fn derive_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_trusted_admission_v1(
    request: &RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    admission: &CloudflareRouterAbEcdsaDerivationEvmDigestFinalizeAdmissionCandidateV1,
) -> RouterAbProtocolResult<CloudflareRouterNormalSigningTrustedAdmissionV1> {
    admission.validate_for_finalize_request(request)?;
    let checks = cloudflare_router_allowed_admission_checks_v1(&request.request_id)?;
    CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        admission.to_normal_signing_trusted_metadata()?,
        checks.to_gate_decision()?,
    )
}

/// Derives trusted Router admission from a locally verified signed request policy.
#[cfg(feature = "workers-rs")]
pub(crate) fn derive_cloudflare_router_trusted_admission_from_worker_jwt_v1<Verifier>(
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: &EcdsaThresholdPrfRequestV1,
    request_policy_digest: PublicDigest32,
    authorization: CloudflareRouterBearerAuthorizationV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<CloudflareRouterTrustedAdmissionV1>
where
    Verifier: CloudflareRouterJwtVerifierV1,
{
    let mut session = CloudflareRouterJwtSessionProviderV1::new(
        runtime.admission_bindings().jwt.clone(),
        authorization,
        now_unix_ms,
        trusted_source_digest,
        request_policy_digest,
        verifier,
    )?;
    let metadata = session.verify_public_request_session(request)?;
    derive_cloudflare_router_trusted_admission_from_signed_policy_v1(request, metadata)
}

/// Builds the Ed25519 JWT verifier from the deployment-bound JWKS document.
pub(crate) fn build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(
    binding: &CloudflareRouterJwtVerifierBindingV1,
) -> RouterAbProtocolResult<CloudflareRouterEd25519JwksJwtVerifierV1> {
    binding.validate()?;
    Ok(binding.verifier.clone())
}

/// Parses the strict Router Bearer authorization header.
#[cfg(feature = "workers-rs")]
pub fn parse_cloudflare_router_bearer_authorization_from_request_v1(
    request: &worker::Request,
) -> RouterAbProtocolResult<CloudflareRouterBearerAuthorizationV1> {
    let header = request
        .headers()
        .get("authorization")
        .map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                format!("Router authorization header read failed: {err}"),
            )
        })?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                "Router public request requires Authorization header",
            )
        })?;
    CloudflareRouterBearerAuthorizationV1::from_authorization_header(&header)
}

/// Hashes trusted Cloudflare edge source metadata for admission decisions.
#[cfg(feature = "workers-rs")]
pub(crate) fn cloudflare_trusted_source_digest_v1(
    request: &worker::Request,
) -> RouterAbProtocolResult<PublicDigest32> {
    let headers = request.headers();
    let connecting_ip = headers.get("cf-connecting-ip").map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
            format!("cf-connecting-ip header read failed: {err}"),
        )
    })?;
    let ray_id = headers.get("cf-ray").map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
            format!("cf-ray header read failed: {err}"),
        )
    })?;
    Ok(router_trusted_source_digest_v1(
        connecting_ip.as_deref(),
        ray_id.as_deref(),
    ))
}

/// Digest of the trusted edge source metadata a Router binds into Wallet
/// Session admission. A VM Router has no edge metadata and passes `None`s.
pub(crate) fn router_trusted_source_digest_v1(
    connecting_ip: Option<&str>,
    ray_id: Option<&str>,
) -> PublicDigest32 {
    let mut hasher = Sha256::new();
    hasher.update(b"router-ab-cloudflare-trusted-source/v1");
    hash_optional_header_v1(&mut hasher, b"cf-connecting-ip", connecting_ip);
    hash_optional_header_v1(&mut hasher, b"cf-ray", ray_id);
    let digest = hasher.finalize();
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&digest);
    PublicDigest32::new(bytes)
}

/// The audit log line recording one ECDSA explicit-export decision.
pub(super) fn cloudflare_router_ab_ecdsa_derivation_explicit_export_audit_line_v1(
    request: &RouterAbEcdsaDerivationExplicitExportRequestV1,
    decision: router_ab_core::RouterAbEcdsaDerivationExplicitExportAuditDecisionV1,
    reason_code: &str,
) -> RouterAbProtocolResult<String> {
    request.validate()?;
    require_non_empty(
        "Router A/B ECDSA derivation export audit reason_code",
        reason_code,
    )?;
    let request_digest = request.request_digest()?;
    let event = AuditEventV1::RouterAbEcdsaDerivationExplicitExportDecision {
        operation: "router_ab_ecdsa_derivation_explicit_key_export".to_owned(),
        request_id: request.export_nonce.clone(),
        request_digest_b64u: encode_base64url_bytes_v1(request_digest.as_bytes()),
        wallet_id: request.lifecycle.account_id.clone(),
        account_id: request.lifecycle.account_id.clone(),
        session_id: request.lifecycle.session_id.clone(),
        selected_server_id: request.lifecycle.selected_server_id.clone(),
        application_binding_digest_b64u: request.context.application_binding_digest_b64u.clone(),
        export_authorization_digest_b64u: request.export_authorization_digest_b64u.clone(),
        decision,
        reason_code: reason_code.to_owned(),
    };
    let serialized = serde_json::to_string(&event).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("Router A/B ECDSA derivation export audit event serialization failed: {err}"),
        )
    })?;
    Ok(format!("router_ab_audit_event_v1={serialized}"))
}
