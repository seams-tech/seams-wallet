//! Router keyset, JWT verifier, project policy, admission bindings and the bindings of each Worker role.

use super::*;

/// Public Router A/B deployment keyset served by the Router.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareRouterPublicKeysetV2 {
    /// Wire format version for this discovery document.
    pub keyset_version: String,
    /// Current and optional previous signer-envelope HPKE keys for A/B envelopes.
    pub signer_envelope_hpke: CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1,
    /// Public SigningWorker server-output HPKE key.
    pub signing_worker_server_output_hpke: CloudflarePublicHpkeKeyDescriptorV1,
}

impl CloudflareRouterPublicKeysetV2 {
    /// Creates a validated Router public keyset response.
    pub fn new(
        keyset_version: impl Into<String>,
        signer_envelope_hpke: CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1,
        signing_worker_server_output_hpke: CloudflarePublicHpkeKeyDescriptorV1,
    ) -> RouterAbProtocolResult<Self> {
        let keyset = Self {
            keyset_version: keyset_version.into(),
            signer_envelope_hpke,
            signing_worker_server_output_hpke,
        };
        keyset.validate()?;
        Ok(keyset)
    }

    /// Validates all public descriptors in the keyset.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty("keyset_version", &self.keyset_version)?;
        self.signer_envelope_hpke.validate()?;
        self.signing_worker_server_output_hpke.validate()?;
        Ok(())
    }
}

/// Router JWT verifier configuration after Env parsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareRouterJwtVerifierBindingV1 {
    /// Expected JWT issuer.
    pub issuer: String,
    /// Expected JWT audience.
    pub audience: String,
    /// Validated Ed25519 verifier derived from the deployment JWKS.
    pub verifier: CloudflareRouterEd25519JwksJwtVerifierV1,
}

impl CloudflareRouterJwtVerifierBindingV1 {
    /// Creates validated JWT verifier configuration.
    pub fn new(
        issuer: impl Into<String>,
        audience: impl Into<String>,
        jwks_json: impl Into<String>,
    ) -> RouterAbProtocolResult<Self> {
        let jwks_json = jwks_json.into();
        let verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)?;
        let binding = Self {
            issuer: issuer.into(),
            audience: audience.into(),
            verifier,
        };
        binding.validate()?;
        Ok(binding)
    }

    /// Validates JWT verifier configuration fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty("jwt issuer", &self.issuer)?;
        require_non_empty("jwt audience", &self.audience)?;
        self.verifier.validate()
    }
}

/// Deployment-bound Router project policy parsed from the Worker Env.
///
/// Testnet profiles use the explicit allow-all variant. Production profiles
/// carry the generated identity and work-kind policy document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CloudflareRouterProjectPolicyBindingV1 {
    /// No production policy was supplied; the testnet profile remains open.
    AllowAll,
    /// Strict production policy document.
    Configured {
        /// Canonical organization id authorized by this deployment.
        org_id: String,
        /// Canonical project id authorized by this deployment.
        project_id: String,
        /// Deployment environment label authorized by this deployment.
        environment: String,
        /// Expensive work classes admitted by this deployment.
        allowed_work_kinds: Vec<ExpensiveWorkKindV1>,
        /// Whether normal signing is admitted by this deployment.
        allow_normal_signing: bool,
        /// Retry-after duration for policy denials.
        rejected_retry_after_ms: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CloudflareRouterProjectPolicyDocumentV1 {
    pub(super) org_id: String,
    pub(super) project_id: String,
    pub(super) environment: String,
    pub(super) allowed_work_kinds: Vec<ExpensiveWorkKindV1>,
    pub(super) allow_normal_signing: bool,
    pub(super) rejected_retry_after_ms: u64,
}

impl CloudflareRouterProjectPolicyBindingV1 {
    pub(super) fn from_json(json: &str) -> RouterAbProtocolResult<Self> {
        let document: CloudflareRouterProjectPolicyDocumentV1 = serde_json::from_str(json)
            .map_err(|err| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("Router project policy bootstrap JSON parse failed: {err}"),
                )
            })?;
        let policy = Self::Configured {
            org_id: document.org_id,
            project_id: document.project_id,
            environment: document.environment,
            allowed_work_kinds: document.allowed_work_kinds,
            allow_normal_signing: document.allow_normal_signing,
            rejected_retry_after_ms: document.rejected_retry_after_ms,
        };
        policy.validate()?;
        Ok(policy)
    }

    pub(super) fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::AllowAll => Ok(()),
            Self::Configured {
                org_id,
                project_id,
                environment,
                allowed_work_kinds,
                rejected_retry_after_ms,
                ..
            } => {
                require_non_empty("project policy org_id", org_id)?;
                require_non_empty("project policy project_id", project_id)?;
                require_non_empty("project policy environment", environment)?;
                require_work_kind_set("project policy allowed_work_kinds", allowed_work_kinds)?;
                require_positive_ms(
                    "project policy rejected_retry_after_ms",
                    *rejected_retry_after_ms,
                )
            }
        }
    }

    pub(super) fn policy_for_context(
        &self,
        context: &ExpensiveWorkGateContextV1,
        request: &EcdsaThresholdPrfRequestV1,
    ) -> RouterAbProtocolResult<CloudflareRouterProjectPolicyV1> {
        self.validate()?;
        context.validate()?;
        request.validate()?;
        self.policy_for_identity_and_work(
            &context.org_id,
            &context.project_id,
            &context.environment,
            context.work_kind,
        )
    }

    pub(super) fn policy_for_identity_and_work(
        &self,
        org_id_value: &str,
        project_id_value: &str,
        environment_value: &str,
        work_kind: ExpensiveWorkKindV1,
    ) -> RouterAbProtocolResult<CloudflareRouterProjectPolicyV1> {
        match self {
            Self::AllowAll => Ok(CloudflareRouterProjectPolicyV1::Allowed),
            Self::Configured {
                org_id,
                project_id,
                environment,
                allowed_work_kinds,
                rejected_retry_after_ms,
                ..
            } => {
                if org_id_value != org_id
                    || project_id_value != project_id
                    || environment_value != environment
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "Router project policy identity does not match verified request",
                    ));
                }
                if allowed_work_kinds.contains(&work_kind) {
                    Ok(CloudflareRouterProjectPolicyV1::Allowed)
                } else {
                    Ok(CloudflareRouterProjectPolicyV1::Rejected {
                        retry_after_ms: *rejected_retry_after_ms,
                    })
                }
            }
        }
    }

    pub(super) fn policy_for_yao_work_kind(
        &self,
        work_kind: ExpensiveWorkKindV1,
    ) -> RouterAbProtocolResult<CloudflareRouterProjectPolicyV1> {
        self.validate()?;
        match self {
            Self::AllowAll => self.policy_for_identity_and_work("", "", "", work_kind),
            Self::Configured {
                org_id,
                project_id,
                environment,
                ..
            } => self.policy_for_identity_and_work(org_id, project_id, environment, work_kind),
        }
    }

    pub(super) fn normal_signing_policy_for_metadata(
        &self,
        metadata: &CloudflareRouterNormalSigningTrustedMetadataV1,
        request_id: &str,
    ) -> RouterAbProtocolResult<ExpensiveWorkGateDecisionV1> {
        self.validate()?;
        metadata.validate()?;
        require_non_empty("normal signing request_id", request_id)?;
        match self {
            Self::AllowAll => ExpensiveWorkGateDecisionV1::accepted(request_id),
            Self::Configured {
                org_id,
                project_id,
                environment,
                allow_normal_signing,
                rejected_retry_after_ms,
                ..
            } => {
                if metadata.org_id != *org_id
                    || metadata.project_id != *project_id
                    || metadata.environment != *environment
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "Router project policy identity does not match normal-signing request",
                    ));
                }
                if *allow_normal_signing {
                    ExpensiveWorkGateDecisionV1::accepted(request_id)
                } else {
                    ExpensiveWorkGateDecisionV1::rejected(
                        GateRejectReasonV1::AbusePolicy,
                        *rejected_retry_after_ms,
                    )
                }
            }
        }
    }
}

/// Router admission-provider configuration after Env parsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareRouterAdmissionBindingsV1 {
    /// JWT verifier configuration.
    pub jwt: CloudflareRouterJwtVerifierBindingV1,
    /// Deployment-bound project policy.
    pub project_policy: CloudflareRouterProjectPolicyBindingV1,
}

impl CloudflareRouterAdmissionBindingsV1 {
    /// Creates validated Router admission-provider bindings.
    pub fn new(
        jwt: CloudflareRouterJwtVerifierBindingV1,
        project_policy: CloudflareRouterProjectPolicyBindingV1,
    ) -> RouterAbProtocolResult<Self> {
        let bindings = Self {
            jwt,
            project_policy,
        };
        bindings.validate()?;
        Ok(bindings)
    }

    /// Validates Router admission-provider bindings.
    /// Applies the deployment project policy to a trusted normal-signing admission.
    pub fn apply_project_policy_to_normal_signing_admission_v1(
        &self,
        request_id: &str,
        admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
    ) -> RouterAbProtocolResult<CloudflareRouterNormalSigningTrustedAdmissionV1> {
        admission.validate()?;
        let decision = self
            .project_policy
            .normal_signing_policy_for_metadata(&admission.metadata, request_id)?;
        CloudflareRouterNormalSigningTrustedAdmissionV1::new(admission.metadata, decision)
    }

    /// Applies the deployment project policy to a trusted expensive-work admission.
    pub fn apply_project_policy_to_trusted_admission_v1(
        &self,
        request: &EcdsaThresholdPrfRequestV1,
        admission: CloudflareRouterTrustedAdmissionV1,
    ) -> RouterAbProtocolResult<CloudflareRouterTrustedAdmissionV1> {
        admission.validate_for_request(request)?;
        let policy = self
            .project_policy
            .policy_for_context(&admission.context, request)?;
        let decision = match policy {
            CloudflareRouterProjectPolicyV1::Allowed => admission.decision,
            CloudflareRouterProjectPolicyV1::Rejected { retry_after_ms } => {
                ExpensiveWorkGateDecisionV1::rejected(
                    GateRejectReasonV1::AbusePolicy,
                    retry_after_ms,
                )?
            }
        };
        CloudflareRouterTrustedAdmissionV1::new(admission.context, decision)
    }

    /// Validates a public request with trusted admission and builds gate-aware work.
    pub fn public_request_admission_plan_at(
        &self,
        now_unix_ms: u64,
        request: EcdsaThresholdPrfRequestV1,
        trusted_admission: CloudflareRouterTrustedAdmissionV1,
    ) -> RouterAbProtocolResult<CloudflareRouterPublicAdmissionPlanV1> {
        request.validate_at(now_unix_ms)?;
        let trusted_admission =
            self.apply_project_policy_to_trusted_admission_v1(&request, trusted_admission)?;
        trusted_admission.validate_for_request(&request)?;
        let plan = if trusted_admission.allows_signer_forwarding()? {
            let (deriver_a_message, deriver_b_message) = request.to_signer_wire_messages()?;
            CloudflareRouterPublicAdmissionPlanV1::Forward {
                trusted_admission,
                deriver_a_message,
                deriver_b_message,
            }
        } else {
            CloudflareRouterPublicAdmissionPlanV1::Stop { trusted_admission }
        };
        plan.validate()?;
        Ok(plan)
    }

    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.jwt.validate()?;
        self.project_policy.validate()
    }
}

/// Router Worker startup bindings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareRouterBindingsV1 {
    /// Router-owned admission-provider bindings.
    pub admission: CloudflareRouterAdmissionBindingsV1,
    /// Deriver A peer binding.
    pub deriver_a: CloudflarePeerBindingV1,
    /// Deriver B peer binding.
    pub deriver_b: CloudflarePeerBindingV1,
    /// SigningWorker peer binding.
    pub signing_worker: CloudflarePeerBindingV1,
    /// Published control-plane issuer verifying keys.
    ///
    /// A signed creation command is verified at this Worker's own boundary, so
    /// the anchor is parsed at startup rather than per request.
    pub issuer_verifying_keys: CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
}

impl CloudflareRouterBindingsV1 {
    /// Creates validated Router Worker bindings.
    pub fn new(
        admission: CloudflareRouterAdmissionBindingsV1,
        deriver_a: CloudflarePeerBindingV1,
        deriver_b: CloudflarePeerBindingV1,
        signing_worker: CloudflarePeerBindingV1,
        issuer_verifying_keys: CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    ) -> RouterAbProtocolResult<Self> {
        let bindings = Self {
            admission,
            deriver_a,
            deriver_b,
            signing_worker,
            issuer_verifying_keys,
        };
        bindings.validate()?;
        Ok(bindings)
    }

    /// Validates Router Worker bindings.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.admission.validate()?;
        require_peer_role(&self.deriver_a, CloudflareWorkerRoleV1::DeriverA)?;
        require_peer_role(&self.deriver_b, CloudflareWorkerRoleV1::DeriverB)?;
        require_peer_role(&self.signing_worker, CloudflareWorkerRoleV1::SigningWorker)?;
        self.issuer_verifying_keys.validate()
    }
}

/// Deriver A Worker startup bindings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareDeriverABindingsV1 {
    /// Deriver A signer-envelope HPKE decrypt keys.
    pub envelope_decrypt_key: CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    /// Deriver B peer binding.
    pub deriver_b: CloudflarePeerBindingV1,
    /// Published control-plane issuer verifying keys.
    ///
    /// A signed creation command is verified at this Worker's own boundary, so
    /// the anchor is parsed at startup rather than per request.
    pub issuer_verifying_keys: CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
}

impl CloudflareDeriverABindingsV1 {
    /// Creates validated Deriver A Worker bindings.
    pub fn new(
        envelope_decrypt_key: impl Into<CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1>,
        deriver_b: CloudflarePeerBindingV1,
        issuer_verifying_keys: CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    ) -> RouterAbProtocolResult<Self> {
        let bindings = Self {
            envelope_decrypt_key: envelope_decrypt_key.into(),
            deriver_b,
            issuer_verifying_keys,
        };
        bindings.validate()?;
        Ok(bindings)
    }

    /// Validates Deriver A Worker bindings.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.envelope_decrypt_key
            .validate_visible_to(CloudflareWorkerRoleV1::DeriverA)?;
        require_peer_role(&self.deriver_b, CloudflareWorkerRoleV1::DeriverB)?;
        self.issuer_verifying_keys.validate()
    }
}

/// SigningWorker startup bindings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSigningWorkerBindingsV1 {
    /// Ephemeral ordered rendezvous for background ECDSA presign generation.
    pub presign_session: CloudflareSigningWorkerPresignSessionBindingV1,
    /// SigningWorker server-output HPKE decrypt key.
    pub server_output_decrypt_key: CloudflareServerOutputHpkeDecryptKeyBindingV1,
}

impl CloudflareSigningWorkerBindingsV1 {
    /// Creates validated SigningWorker bindings.
    pub fn new(
        presign_session: CloudflareSigningWorkerPresignSessionBindingV1,
        server_output_decrypt_key: CloudflareServerOutputHpkeDecryptKeyBindingV1,
    ) -> RouterAbProtocolResult<Self> {
        let bindings = Self {
            presign_session,
            server_output_decrypt_key,
        };
        bindings.validate()?;
        Ok(bindings)
    }

    /// Validates SigningWorker bindings.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.presign_session.validate()?;
        self.server_output_decrypt_key
            .validate_visible_to(CloudflareWorkerRoleV1::SigningWorker)
    }
}

/// Deriver B Worker startup bindings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareDeriverBBindingsV1 {
    /// Deriver B signer-envelope HPKE decrypt keys.
    pub envelope_decrypt_key: CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    /// Deriver A peer binding.
    pub deriver_a: CloudflarePeerBindingV1,
    /// Published control-plane issuer verifying keys.
    ///
    /// A signed creation command is verified at this Worker's own boundary, so
    /// the anchor is parsed at startup rather than per request.
    pub issuer_verifying_keys: CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
}

impl CloudflareDeriverBBindingsV1 {
    /// Creates validated Deriver B Worker bindings.
    pub fn new(
        envelope_decrypt_key: impl Into<CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1>,
        deriver_a: CloudflarePeerBindingV1,
        issuer_verifying_keys: CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    ) -> RouterAbProtocolResult<Self> {
        let bindings = Self {
            envelope_decrypt_key: envelope_decrypt_key.into(),
            deriver_a,
            issuer_verifying_keys,
        };
        bindings.validate()?;
        Ok(bindings)
    }

    /// Validates Deriver B Worker bindings.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.envelope_decrypt_key
            .validate_visible_to(CloudflareWorkerRoleV1::DeriverB)?;
        require_peer_role(&self.deriver_a, CloudflareWorkerRoleV1::DeriverA)?;
        self.issuer_verifying_keys.validate()
    }
}

/// Role-specific Cloudflare Worker startup bindings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "worker_role", rename_all = "snake_case")]
pub enum CloudflareWorkerBindingsV1 {
    /// Router Worker bindings.
    Router {
        /// Router bindings.
        bindings: CloudflareRouterBindingsV1,
    },
    /// Deriver A Worker bindings.
    DeriverA {
        /// Deriver A bindings.
        bindings: CloudflareDeriverABindingsV1,
    },
    /// Deriver B Worker bindings.
    DeriverB {
        /// Deriver B bindings.
        bindings: CloudflareDeriverBBindingsV1,
    },
    /// SigningWorker bindings.
    SigningWorker {
        /// SigningWorker bindings.
        bindings: CloudflareSigningWorkerBindingsV1,
    },
    /// Tenant-root control-plane Worker bindings.
    TenantRootControlPlane {
        /// Control-plane bindings.
        bindings: CloudflareTenantRootControlPlaneBindingsV1,
    },
}

/// Tenant-root control-plane Worker bindings.
///
/// The control plane holds exactly one Secret of its own: the issuer signing
/// key. Its Durable Object and service bindings are resolved per request from
/// Env, as the Router's are, so nothing else is retained here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareTenantRootControlPlaneBindingsV1 {
    /// Issuer signing Secret descriptor (binding name and key ID, never the seed).
    pub issuer_signing_key: CloudflareTenantRootControlPlaneIssuerSigningKeyBindingV1,
    /// Published control-plane issuer verifying keys.
    ///
    /// The issuer holds its own published set so it can prove at boot that its
    /// Secret derives the key registered under its active key ID.
    pub issuer_verifying_keys: CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    /// Authorities trusted to sign a tenant-root creation grant.
    pub(crate) grant_authority_verifying_keys: CloudflareTenantRootCreationGrantAuthorityVerifyingKeysV1,
    /// Public verifier for operations incident evidence.
    pub(crate) operations_incident_verifier: CloudflareOperationsIncidentVerifierV1,
    /// Separate public custody-authority verifiers for Deriver A and Deriver B.
    pub(crate) custody_authority_verifiers: CloudflareCustodyAuthorityVerifiersV1,
    /// Public role signing key ID the issuer names for Deriver A.
    pub deriver_a_signing_key_id: String,
    /// Public role signing key ID the issuer names for Deriver B.
    pub deriver_b_signing_key_id: String,
    /// Deriver A's published verifying key, resolved from the role keyset.
    ///
    /// Resolving at parse time is what proves the configured ID actually exists
    /// under its role; a typo or stale ID cannot reach a ceremony.
    pub(crate) deriver_a_verifying_key: [u8; 32],
    /// Deriver B's published verifying key, resolved from the role keyset.
    pub(crate) deriver_b_verifying_key: [u8; 32],
}

impl CloudflareTenantRootControlPlaneBindingsV1 {
    /// Creates validated control-plane bindings.
    pub fn new(
        issuer_signing_key: CloudflareTenantRootControlPlaneIssuerSigningKeyBindingV1,
        issuer_verifying_keys: CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
        grant_authority_verifying_keys: CloudflareTenantRootCreationGrantAuthorityVerifyingKeysV1,
        operations_incident_verifier: CloudflareOperationsIncidentVerifierV1,
        custody_authority_verifiers: CloudflareCustodyAuthorityVerifiersV1,
        deriver_a_signing_key_id: String,
        deriver_b_signing_key_id: String,
        deriver_a_verifying_key: [u8; 32],
        deriver_b_verifying_key: [u8; 32],
    ) -> RouterAbProtocolResult<Self> {
        let bindings = Self {
            issuer_signing_key,
            issuer_verifying_keys,
            grant_authority_verifying_keys,
            operations_incident_verifier,
            custody_authority_verifiers,
            deriver_a_signing_key_id,
            deriver_b_signing_key_id,
            deriver_a_verifying_key,
            deriver_b_verifying_key,
        };
        bindings.validate()?;
        Ok(bindings)
    }

    /// Validates all bindings.
    ///
    /// The active issuer key ID must be present in the published set: an issuer
    /// configured to sign under an unpublished id could never be verified.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.issuer_signing_key.validate()?;
        self.issuer_verifying_keys.validate()?;
        self.grant_authority_verifying_keys.validate()?;
        self.operations_incident_verifier.validate()?;
        self.custody_authority_verifiers.validate()?;
        let operations_verifying_key = self.operations_incident_verifier.verifying_key_bytes();
        if self.custody_authority_verifiers.deriver_a() == &operations_verifying_key
            || self.custody_authority_verifiers.deriver_b() == &operations_verifying_key
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "operations incident and custody authority verifiers must be distinct",
            ));
        }
        // A grant authority key may never double as the issuer key: the issuer
        // could then authorize the tenant creations it goes on to sign.
        for (grant_key_id, grant_key) in self.grant_authority_verifying_keys.keys() {
            if self
                .issuer_verifying_keys
                .keys()
                .values()
                .any(|issuer_key| issuer_key == grant_key)
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    format!(
                        "tenant-root creation grant authority {grant_key_id} reuses a control-plane issuer key"
                    ),
                ));
            }
        }
        if self
            .issuer_verifying_keys
            .for_issuer_key_id(self.issuer_signing_key.signing_key_id())
            .is_none()
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root control-plane active issuer key ID is not in the published verifying key set",
            ));
        }
        // A ceremony signer must be a Deriver, never the control plane. The IDs
        // themselves were proved to exist under their roles when the bindings
        // were parsed; these keys are what that resolution produced.
        for (signing_key_id, role_key) in [
            (
                self.deriver_a_signing_key_id.as_str(),
                &self.deriver_a_verifying_key,
            ),
            (
                self.deriver_b_signing_key_id.as_str(),
                &self.deriver_b_verifying_key,
            ),
        ] {
            if self
                .issuer_verifying_keys
                .keys()
                .values()
                .any(|key| key == role_key)
                || self
                    .grant_authority_verifying_keys
                    .keys()
                    .values()
                    .any(|key| key == role_key)
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    format!(
                        "tenant-root role signing key ID {signing_key_id} reuses a control-plane key"
                    ),
                ));
            }
        }
        if self.deriver_a_signing_key_id == self.deriver_b_signing_key_id
            || self.deriver_a_verifying_key == self.deriver_b_verifying_key
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root role signing keys must be distinct across roles",
            ));
        }
        Ok(())
    }
}

impl CloudflareWorkerBindingsV1 {
    /// Creates a Router Worker startup branch.
    pub fn router(bindings: CloudflareRouterBindingsV1) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self::Router { bindings })
    }

    /// Creates a Deriver A Worker startup branch.
    pub fn deriver_a(bindings: CloudflareDeriverABindingsV1) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self::DeriverA { bindings })
    }

    /// Creates a Deriver B Worker startup branch.
    pub fn deriver_b(bindings: CloudflareDeriverBBindingsV1) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self::DeriverB { bindings })
    }

    /// Creates a SigningWorker startup branch.
    pub fn signing_worker(
        bindings: CloudflareSigningWorkerBindingsV1,
    ) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self::SigningWorker { bindings })
    }

    /// Creates a tenant-root control-plane Worker startup branch.
    pub fn tenant_root_control_plane(
        bindings: CloudflareTenantRootControlPlaneBindingsV1,
    ) -> RouterAbProtocolResult<Self> {
        bindings.validate()?;
        Ok(Self::TenantRootControlPlane { bindings })
    }

    /// Returns the Worker role.
    pub fn worker_role(&self) -> CloudflareWorkerRoleV1 {
        match self {
            Self::Router { .. } => CloudflareWorkerRoleV1::Router,
            Self::DeriverA { .. } => CloudflareWorkerRoleV1::DeriverA,
            Self::DeriverB { .. } => CloudflareWorkerRoleV1::DeriverB,
            Self::SigningWorker { .. } => CloudflareWorkerRoleV1::SigningWorker,
            Self::TenantRootControlPlane { .. } => CloudflareWorkerRoleV1::TenantRootControlPlane,
        }
    }
}
