//! Environment binding parsers, the environment reader and error status mapping.

use super::*;

#[cfg(feature = "workers-rs")]
pub(crate) const TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1: &str = "TENANT_ROOT_CONTROL_PLANE";

/// Parses role-specific Worker bindings from an Env reader.
pub fn parse_cloudflare_worker_bindings_v1(
    worker_role: CloudflareWorkerRoleV1,
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareWorkerBindingsV1> {
    match worker_role {
        CloudflareWorkerRoleV1::Router => {
            CloudflareWorkerBindingsV1::router(parse_cloudflare_router_bindings_v1(env)?)
        }
        CloudflareWorkerRoleV1::DeriverA => {
            CloudflareWorkerBindingsV1::deriver_a(parse_cloudflare_deriver_a_bindings_v1(env)?)
        }
        CloudflareWorkerRoleV1::DeriverB => {
            CloudflareWorkerBindingsV1::deriver_b(parse_cloudflare_deriver_b_bindings_v1(env)?)
        }
        CloudflareWorkerRoleV1::SigningWorker => CloudflareWorkerBindingsV1::signing_worker(
            parse_cloudflare_signing_worker_bindings_v1(env)?,
        ),
        CloudflareWorkerRoleV1::TenantRootControlPlane => {
            CloudflareWorkerBindingsV1::tenant_root_control_plane(
                parse_cloudflare_tenant_root_control_plane_bindings_v1(env)?,
            )
        }
    }
}

/// Parses tenant-root control-plane Worker bindings from an Env reader.
pub fn parse_cloudflare_tenant_root_control_plane_bindings_v1(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneBindingsV1> {
    // The retained public keyset owns active role selection. Its decoder has
    // already proved each selector resolves under its exact role.
    let role_keys = parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(env)?;
    let identities = role_keys.deriver_identities()?;
    let deriver_a_signing_key_id = identities.deriver_a().to_owned();
    let deriver_b_signing_key_id = identities.deriver_b().to_owned();
    let deriver_a_verifying_key = *role_keys.for_role_and_key_id(
        threshold_prf::TwoPartyDeriverRole::DeriverA,
        &deriver_a_signing_key_id,
    )?;
    let deriver_b_verifying_key = *role_keys.for_role_and_key_id(
        threshold_prf::TwoPartyDeriverRole::DeriverB,
        &deriver_b_signing_key_id,
    )?;
    CloudflareTenantRootControlPlaneBindingsV1::new(
        parse_cloudflare_tenant_root_control_plane_issuer_signing_key_binding_v1(
            CloudflareWorkerRoleV1::TenantRootControlPlane,
            env,
        )?,
        parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(env)?,
        parse_cloudflare_tenant_root_creation_grant_authority_verifying_keys_v1(env)?,
        parse_cloudflare_operations_incident_verifier_v1(env)?,
        parse_cloudflare_custody_authority_verifiers_v1(env)?,
        deriver_a_signing_key_id,
        deriver_b_signing_key_id,
        deriver_a_verifying_key,
        deriver_b_verifying_key,
    )
}

/// Parses Router Worker bindings from an Env reader.
pub(crate) fn parse_cloudflare_router_bindings_v1(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareRouterBindingsV1> {
    reject_forbidden_env_keys(
        CloudflareWorkerRoleV1::Router,
        env,
        ROUTER_FORBIDDEN_ENV_KEYS,
    )?;
    CloudflareRouterBindingsV1::new(
        parse_cloudflare_router_admission_bindings_v1(env)?,
        read_peer_binding(
            env,
            CloudflareWorkerRoleV1::DeriverA,
            DERIVER_A_PEER_BINDING_ENV,
        )?,
        read_peer_binding(
            env,
            CloudflareWorkerRoleV1::DeriverB,
            DERIVER_B_PEER_BINDING_ENV,
        )?,
        read_peer_binding(
            env,
            CloudflareWorkerRoleV1::SigningWorker,
            SIGNING_WORKER_PEER_BINDING_ENV,
        )?,
        parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(env)?,
    )
}

/// Parses Router admission-provider bindings from an Env reader.
pub fn parse_cloudflare_router_admission_bindings_v1(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareRouterAdmissionBindingsV1> {
    reject_forbidden_env_keys(
        CloudflareWorkerRoleV1::Router,
        env,
        ROUTER_FORBIDDEN_ENV_KEYS,
    )?;
    let project_policy = match env.get_text(ROUTER_PROJECT_POLICY_BOOTSTRAP_JSON_ENV)? {
        Some(json) => {
            let json = json.trim().to_owned();
            require_non_empty(ROUTER_PROJECT_POLICY_BOOTSTRAP_JSON_ENV, &json)?;
            CloudflareRouterProjectPolicyBindingV1::from_json(&json)?
        }
        None => CloudflareRouterProjectPolicyBindingV1::AllowAll,
    };
    CloudflareRouterAdmissionBindingsV1::new(
        CloudflareRouterJwtVerifierBindingV1::new(
            read_required_env_text(env, ROUTER_JWT_ISSUER_ENV)?,
            read_required_env_text(env, ROUTER_JWT_AUDIENCE_ENV)?,
            read_required_env_text(env, ROUTER_JWT_JWKS_JSON_ENV)?,
        )?,
        project_policy,
    )
}

/// Parses public signer-envelope HPKE keys from an Env reader.
pub fn parse_cloudflare_signer_envelope_hpke_public_key_set_v1(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareSignerEnvelopeHpkePublicKeySetV1> {
    CloudflareSignerEnvelopeHpkePublicKeySetV1::new(
        read_signer_envelope_hpke_public_key(
            env,
            Role::SignerA,
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        )?,
        read_signer_envelope_hpke_public_key(
            env,
            Role::SignerB,
            DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        )?,
    )
}

/// Parses current and optional previous signer-envelope HPKE public keys.
pub fn parse_cloudflare_signer_envelope_hpke_rotation_public_key_set_v1(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1> {
    let current = parse_cloudflare_signer_envelope_hpke_public_key_set_v1(env)?;
    let previous_keys = [
        DERIVER_A_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
        DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        DERIVER_B_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
        DERIVER_B_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        ROUTER_AB_PREVIOUS_ENVELOPE_HPKE_RETIRE_AT_MS_ENV,
    ];
    let has_previous = previous_keys
        .iter()
        .map(|key| read_optional_env_text(env, key))
        .collect::<RouterAbProtocolResult<Vec<_>>>()?
        .into_iter()
        .any(|value| value.is_some());
    if !has_previous {
        return CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1::current_only(current);
    }
    let previous = CloudflareSignerEnvelopeHpkePublicKeySetV1::new(
        read_signer_envelope_hpke_public_key(
            env,
            Role::SignerA,
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        )?,
        read_signer_envelope_hpke_public_key(
            env,
            Role::SignerB,
            DERIVER_B_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_B_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        )?,
    )?;
    let previous_retire_at_ms =
        read_required_env_u64(env, ROUTER_AB_PREVIOUS_ENVELOPE_HPKE_RETIRE_AT_MS_ENV)?;
    CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1::current_and_previous(
        current,
        previous,
        previous_retire_at_ms,
    )
}

/// Builds the public Router A/B keyset discovery response from Env.
pub fn build_cloudflare_router_public_keyset_v2(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareRouterPublicKeysetV2> {
    CloudflareRouterPublicKeysetV2::new(
        "router_ab_keyset_v2",
        parse_cloudflare_signer_envelope_hpke_rotation_public_key_set_v1(env)?,
        CloudflarePublicHpkeKeyDescriptorV1::new(
            read_required_env_text(env, SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH_ENV)?,
            read_required_env_text(env, SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV)?,
        )?,
    )
}

/// Parses the current Worker's role-local signer-envelope HPKE private-key binding.
pub fn parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1(
    worker_role: CloudflareWorkerRoleV1,
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1> {
    match worker_role {
        CloudflareWorkerRoleV1::DeriverA => read_signer_envelope_hpke_decrypt_key_binding(
            env,
            Role::SignerA,
            DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        ),
        CloudflareWorkerRoleV1::DeriverB => read_signer_envelope_hpke_decrypt_key_binding(
            env,
            Role::SignerB,
            DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        ),
        CloudflareWorkerRoleV1::Router
        | CloudflareWorkerRoleV1::SigningWorker
        | CloudflareWorkerRoleV1::TenantRootControlPlane => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "this Worker cannot parse a signer-envelope HPKE decrypt key",
        )),
    }
}

/// Parses the current Worker's role-local signer-envelope HPKE private-key rotation set.
pub fn parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_set_v1(
    worker_role: CloudflareWorkerRoleV1,
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1> {
    let current = parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1(worker_role, env)?;
    match worker_role {
        CloudflareWorkerRoleV1::DeriverA => read_signer_envelope_hpke_decrypt_key_binding_set(
            env,
            current,
            Role::SignerA,
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        ),
        CloudflareWorkerRoleV1::DeriverB => read_signer_envelope_hpke_decrypt_key_binding_set(
            env,
            current,
            Role::SignerB,
            DERIVER_B_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            DERIVER_B_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_B_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
        ),
        CloudflareWorkerRoleV1::Router
        | CloudflareWorkerRoleV1::SigningWorker
        | CloudflareWorkerRoleV1::TenantRootControlPlane => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "this Worker cannot parse a signer-envelope HPKE decrypt-key rotation set",
        )),
    }
}

/// Parses Deriver A Worker bindings from an Env reader.
pub fn parse_cloudflare_deriver_a_bindings_v1(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareDeriverABindingsV1> {
    reject_forbidden_env_keys(
        CloudflareWorkerRoleV1::DeriverA,
        env,
        DERIVER_A_FORBIDDEN_ENV_KEYS,
    )?;
    CloudflareDeriverABindingsV1::new(
        parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_set_v1(
            CloudflareWorkerRoleV1::DeriverA,
            env,
        )?,
        read_peer_binding(
            env,
            CloudflareWorkerRoleV1::DeriverB,
            DERIVER_B_PEER_BINDING_ENV,
        )?,
        parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(env)?,
    )
}

/// Parses SigningWorker bindings from an Env reader.
pub fn parse_cloudflare_signing_worker_bindings_v1(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerBindingsV1> {
    reject_forbidden_env_keys(
        CloudflareWorkerRoleV1::SigningWorker,
        env,
        SIGNING_WORKER_FORBIDDEN_ENV_KEYS,
    )?;
    CloudflareSigningWorkerBindingsV1::new(
        read_signing_worker_presign_session_binding(
            env,
            SIGNING_WORKER_PRESIGN_SESSION_DO_BINDING_ENV,
            SIGNING_WORKER_PRESIGN_SESSION_DO_OBJECT_ENV,
            SIGNING_WORKER_PRESIGN_SESSION_DO_KEY_PREFIX_ENV,
        )?,
        read_server_output_hpke_decrypt_key_binding(
            env,
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_BINDING_ENV,
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH_ENV,
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV,
        )?,
    )
}

/// Parses Deriver B Worker bindings from an Env reader.
pub fn parse_cloudflare_deriver_b_bindings_v1(
    env: &impl CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<CloudflareDeriverBBindingsV1> {
    reject_forbidden_env_keys(
        CloudflareWorkerRoleV1::DeriverB,
        env,
        DERIVER_B_FORBIDDEN_ENV_KEYS,
    )?;
    CloudflareDeriverBBindingsV1::new(
        parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_set_v1(
            CloudflareWorkerRoleV1::DeriverB,
            env,
        )?,
        read_peer_binding(
            env,
            CloudflareWorkerRoleV1::DeriverA,
            DERIVER_A_PEER_BINDING_ENV,
        )?,
        parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(env)?,
    )
}

/// `workers-rs` Env reader for Cloudflare Worker startup parsing.
#[cfg(feature = "workers-rs")]
#[derive(Debug, Clone, Copy)]
pub(crate) struct CloudflareWorkerEnvReaderV1<'a> {
    pub(super) env: &'a worker::Env,
}

#[cfg(feature = "workers-rs")]
impl<'a> CloudflareWorkerEnvReaderV1<'a> {
    /// Creates a reader over a real Cloudflare Worker Env.
    pub fn new(env: &'a worker::Env) -> Self {
        Self { env }
    }
}

#[cfg(feature = "workers-rs")]
impl CloudflareEnvReaderV1 for CloudflareWorkerEnvReaderV1<'_> {
    fn get_text(&self, key: &str) -> RouterAbProtocolResult<Option<String>> {
        match self.env.var(key) {
            Ok(value) => Ok(Some(value.to_string())),
            Err(err) if worker_binding_is_missing(&err, key) => Ok(None),
            Err(err) => Err(worker_binding_error(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                key,
                "text Env",
                err,
            )),
        }
    }
}

#[cfg(feature = "workers-rs")]
impl CloudflareSecretReaderV1 for CloudflareWorkerEnvReaderV1<'_> {
    fn secret_text(&self, binding_name: &str) -> RouterAbProtocolResult<zeroize::Zeroizing<String>> {
        let secret = self.env.secret(binding_name).map_err(|err| {
            worker_binding_error(
                worker_binding_error_code(&err, binding_name),
                binding_name,
                "secret",
                err,
            )
        })?;
        Ok(zeroize::Zeroizing::new(secret.to_string()))
    }
}

/// Parses Worker bindings from a real Cloudflare Env and checks runtime bindings exist.
#[cfg(feature = "workers-rs")]
pub(crate) fn parse_cloudflare_worker_bindings_from_worker_env_v1(
    worker_role: CloudflareWorkerRoleV1,
    env: &worker::Env,
) -> RouterAbProtocolResult<CloudflareWorkerBindingsV1> {
    let reader = CloudflareWorkerEnvReaderV1::new(env);
    let bindings = parse_cloudflare_worker_bindings_v1(worker_role, &reader)?;
    validate_cloudflare_worker_env_bindings_v1(env, &bindings)?;
    Ok(bindings)
}

/// Checks the real Worker Env has every runtime binding required by descriptors.
#[cfg(feature = "workers-rs")]
pub(crate) fn validate_cloudflare_worker_env_bindings_v1(
    env: &worker::Env,
    bindings: &CloudflareWorkerBindingsV1,
) -> RouterAbProtocolResult<()> {
    match bindings {
        CloudflareWorkerBindingsV1::Router { bindings } => {
            require_worker_service(env, &bindings.deriver_a)?;
            require_worker_service(env, &bindings.deriver_b)?;
            require_worker_service(env, &bindings.signing_worker)
        }
        CloudflareWorkerBindingsV1::DeriverA { bindings } => {
            require_worker_hpke_secret_set(env, &bindings.envelope_decrypt_key)?;
            require_worker_service(env, &bindings.deriver_b)
        }
        CloudflareWorkerBindingsV1::DeriverB { bindings } => {
            require_worker_hpke_secret_set(env, &bindings.envelope_decrypt_key)?;
            require_worker_service(env, &bindings.deriver_a)
        }
        CloudflareWorkerBindingsV1::SigningWorker { bindings } => {
            require_worker_durable_object(env, &bindings.presign_session)?;
            require_worker_server_output_hpke_secret(env, &bindings.server_output_decrypt_key)
        }
        CloudflareWorkerBindingsV1::TenantRootControlPlane { bindings } => {
            require_worker_secret_binding_name(env, bindings.issuer_signing_key.binding_name())
        }
    }
}

pub(super) fn map_router_ab_ecdsa_derivation_error_v1(
    err: router_ab_ecdsa_derivation::RouterAbEcdsaDerivationError,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!(
            "Router A/B ECDSA derivation material validation failed: {}",
            err.message
        ),
    )
}

pub(super) fn require_peer_role(
    peer: &CloudflarePeerBindingV1,
    expected: CloudflareWorkerRoleV1,
) -> RouterAbProtocolResult<()> {
    peer.validate()?;
    if peer.peer_role == expected {
        return Ok(());
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!(
            "Cloudflare peer binding expected {} role, received {}",
            expected.as_str(),
            peer.peer_role.as_str()
        ),
    ))
}

pub(super) fn decode_cloudflare_recipient_proof_bundle_wire_v1(
    field: &str,
    message: &WireMessageV1,
    expected_signer_role: Role,
    expected_recipient_role: Role,
    expected_opened_share_kind: OpenedShareKind,
) -> RouterAbProtocolResult<RecipientProofBundleCiphertextV1> {
    require_signer_role(expected_signer_role)?;
    if message.kind != WireMessageKindV1::RecipientProofBundle {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} must be a recipient_proof_bundle wire message"),
        ));
    }
    let envelope = decode_recipient_proof_bundle_ciphertext_v1(message.payload.as_bytes())?;
    if envelope.transcript_digest != message.transcript_digest {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} transcript digest does not match ciphertext envelope"),
        ));
    }
    if envelope.signer.role != expected_signer_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidSignerIdentity,
            format!("{field} proof-bundle signer role is not expected"),
        ));
    }
    if envelope.recipient_role != expected_recipient_role
        || envelope.opened_share_kind != expected_opened_share_kind
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} proof-bundle recipient binding is invalid"),
        ));
    }
    Ok(envelope)
}

pub(super) fn expected_cloudflare_signer_identity_for_role_v1(
    router_payload: &RouterToSignerPayloadV1,
    role: Role,
) -> RouterAbProtocolResult<&SignerIdentityV1> {
    require_signer_role(role)?;
    match role {
        Role::SignerA => Ok(&router_payload.signer_set().signer_a),
        Role::SignerB => Ok(&router_payload.signer_set().signer_b),
        _ => unreachable!("require_signer_role accepted only signer roles"),
    }
}

pub(super) fn validate_cloudflare_recipient_proof_bundle_envelope_for_router_payload_v1(
    field: &str,
    envelope: &RecipientProofBundleCiphertextV1,
    router_payload: &RouterToSignerPayloadV1,
    expected_signer: &SignerIdentityV1,
) -> RouterAbProtocolResult<()> {
    envelope.validate()?;
    router_payload.validate()?;
    expected_signer.validate()?;
    if envelope.signer != *expected_signer {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidSignerIdentity,
            format!("{field} signer identity does not match signer set"),
        ));
    }
    if envelope.transcript_digest != router_payload.transcript_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} transcript digest does not match Router payload"),
        ));
    }
    match (envelope.recipient_role, envelope.opened_share_kind) {
        (Role::Client, OpenedShareKind::XClientBase) => {
            let metadata = router_payload.transcript_metadata();
            if envelope.recipient_identity != metadata.client_id
                || envelope.recipient_encryption_key != metadata.client_ephemeral_public_key
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{field} client recipient binding does not match Router payload"),
                ));
            }
        }
        (Role::Server, OpenedShareKind::XServerBase) => {
            let server = &router_payload.signer_set().selected_server;
            if envelope.recipient_identity != server.server_id
                || envelope.recipient_encryption_key != server.recipient_encryption_key
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{field} server recipient binding does not match Router payload"),
                ));
            }
        }
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{field} recipient proof-bundle binding is invalid"),
            ));
        }
    }
    Ok(())
}

pub(super) fn validate_cloudflare_recipient_proof_bundle_envelope_for_activation_context_v1(
    field: &str,
    envelope: &RecipientProofBundleCiphertextV1,
    activation_context: &SigningWorkerActivationContextV1,
    expected_signer: &SignerIdentityV1,
) -> RouterAbProtocolResult<()> {
    envelope.validate()?;
    activation_context.validate()?;
    expected_signer.validate()?;
    if envelope.signer != *expected_signer {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidSignerIdentity,
            format!("{field} signer identity does not match activation context"),
        ));
    }
    if envelope.transcript_digest != activation_context.transcript_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} transcript digest does not match activation context"),
        ));
    }
    if envelope.recipient_role != Role::Server
        || envelope.opened_share_kind != OpenedShareKind::XServerBase
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} SigningWorker activation bundle is not x_server_base"),
        ));
    }
    let selected_worker = &activation_context.signer_set().selected_server;
    if envelope.recipient_identity != selected_worker.server_id
        || envelope.recipient_encryption_key != selected_worker.recipient_encryption_key
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} recipient binding does not match selected SigningWorker"),
        ));
    }
    Ok(())
}

pub(super) fn expected_signer_private_request_kind_v1(
    worker_role: CloudflareWorkerRoleV1,
) -> RouterAbProtocolResult<WireMessageKindV1> {
    match worker_role {
        CloudflareWorkerRoleV1::DeriverA => Ok(WireMessageKindV1::RouterToSignerA),
        CloudflareWorkerRoleV1::DeriverB => Ok(WireMessageKindV1::RouterToSignerB),
        CloudflareWorkerRoleV1::Router
        | CloudflareWorkerRoleV1::SigningWorker
        | CloudflareWorkerRoleV1::TenantRootControlPlane => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "this Worker has no private signer request kind",
        )),
    }
}

pub(super) fn cloudflare_worker_signer_role_v1(
    worker_role: CloudflareWorkerRoleV1,
) -> RouterAbProtocolResult<Role> {
    match worker_role {
        CloudflareWorkerRoleV1::DeriverA => Ok(Role::SignerA),
        CloudflareWorkerRoleV1::DeriverB => Ok(Role::SignerB),
        CloudflareWorkerRoleV1::Router
        | CloudflareWorkerRoleV1::SigningWorker
        | CloudflareWorkerRoleV1::TenantRootControlPlane => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "this Worker has no signer plaintext role",
        )),
    }
}

pub(super) fn cloudflare_signer_identities_for_request_v1(
    request: &CloudflareValidatedSignerPrivateRequestV1,
    local_role: Role,
) -> RouterAbProtocolResult<(SignerIdentityV1, SignerIdentityV1, CloudflareWorkerRoleV1)> {
    require_signer_role(local_role)?;
    let assignment = request
        .router_payload()
        .require_recipient_role(local_role)?;
    let signer_set = request.router_payload().signer_set();
    let (expected_local, peer_signer, peer_worker_role) = match local_role {
        Role::SignerA => (
            signer_set.signer_a.clone(),
            signer_set.signer_b.clone(),
            CloudflareWorkerRoleV1::DeriverB,
        ),
        Role::SignerB => (
            signer_set.signer_b.clone(),
            signer_set.signer_a.clone(),
            CloudflareWorkerRoleV1::DeriverA,
        ),
        _ => unreachable!("require_signer_role accepted only signer roles"),
    };
    if assignment.signer != expected_local {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidSignerIdentity,
            "validated signer request assignment does not match signer set role",
        ));
    }
    Ok((assignment.signer.clone(), peer_signer, peer_worker_role))
}

pub(super) fn read_signing_worker_presign_session_binding(
    env: &impl CloudflareEnvReaderV1,
    binding_name_key: &str,
    object_name_key: &str,
    key_prefix_key: &str,
) -> RouterAbProtocolResult<CloudflareSigningWorkerPresignSessionBindingV1> {
    CloudflareSigningWorkerPresignSessionBindingV1::new(
        read_required_env_text(env, binding_name_key)?,
        read_required_env_text(env, object_name_key)?,
        read_required_env_text(env, key_prefix_key)?,
    )
}

pub(super) fn read_peer_binding(
    env: &impl CloudflareEnvReaderV1,
    peer_role: CloudflareWorkerRoleV1,
    binding_name_key: &str,
) -> RouterAbProtocolResult<CloudflarePeerBindingV1> {
    CloudflarePeerBindingV1::new(peer_role, read_required_env_text(env, binding_name_key)?)
}

pub(super) fn read_signer_envelope_hpke_public_key(
    env: &impl CloudflareEnvReaderV1,
    role: Role,
    key_epoch_key: &str,
    public_key_key: &str,
) -> RouterAbProtocolResult<CloudflareSignerEnvelopeHpkePublicKeyV1> {
    CloudflareSignerEnvelopeHpkePublicKeyV1::new(
        role,
        read_required_env_text(env, key_epoch_key)?,
        read_required_env_text(env, public_key_key)?,
    )
}

pub(super) fn read_signer_envelope_hpke_decrypt_key_binding(
    env: &impl CloudflareEnvReaderV1,
    role: Role,
    binding_name_key: &str,
    key_epoch_key: &str,
    public_key_key: &str,
) -> RouterAbProtocolResult<CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1> {
    CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        role,
        read_required_env_text(env, binding_name_key)?,
        read_required_env_text(env, key_epoch_key)?,
        read_required_env_text(env, public_key_key)?,
    )
}

pub(super) fn read_signer_envelope_hpke_decrypt_key_binding_set(
    env: &impl CloudflareEnvReaderV1,
    current: CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
    role: Role,
    previous_binding_name_key: &str,
    previous_key_epoch_key: &str,
    previous_public_key_key: &str,
) -> RouterAbProtocolResult<CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1> {
    let previous_keys = [
        previous_binding_name_key,
        previous_key_epoch_key,
        previous_public_key_key,
        ROUTER_AB_PREVIOUS_ENVELOPE_HPKE_RETIRE_AT_MS_ENV,
    ];
    let has_previous = previous_keys
        .iter()
        .map(|key| read_optional_env_text(env, key))
        .collect::<RouterAbProtocolResult<Vec<_>>>()?
        .into_iter()
        .any(|value| value.is_some());
    if !has_previous {
        return CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1::current_only(current);
    }
    let previous = read_signer_envelope_hpke_decrypt_key_binding(
        env,
        role,
        previous_binding_name_key,
        previous_key_epoch_key,
        previous_public_key_key,
    )?;
    let previous_retire_at_ms =
        read_required_env_u64(env, ROUTER_AB_PREVIOUS_ENVELOPE_HPKE_RETIRE_AT_MS_ENV)?;
    CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1::current_and_previous(
        current,
        previous,
        previous_retire_at_ms,
    )
}

pub(super) fn read_server_output_hpke_decrypt_key_binding(
    env: &impl CloudflareEnvReaderV1,
    binding_name_key: &str,
    key_epoch_key: &str,
    public_key_key: &str,
) -> RouterAbProtocolResult<CloudflareServerOutputHpkeDecryptKeyBindingV1> {
    CloudflareServerOutputHpkeDecryptKeyBindingV1::new(
        read_required_env_text(env, binding_name_key)?,
        read_required_env_text(env, key_epoch_key)?,
        read_required_env_text(env, public_key_key)?,
    )
}

pub(super) fn read_required_env_text(
    env: &impl CloudflareEnvReaderV1,
    key: &str,
) -> RouterAbProtocolResult<String> {
    match env.get_text(key)? {
        Some(value) => {
            let value = value.trim().to_owned();
            require_non_empty(key, &value)?;
            Ok(value)
        }
        None => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingLocalBinding,
            format!("Cloudflare Env is missing required key {key}"),
        )),
    }
}

pub(super) fn read_optional_env_text(
    env: &impl CloudflareEnvReaderV1,
    key: &str,
) -> RouterAbProtocolResult<Option<String>> {
    Ok(env.get_text(key)?.and_then(|value| {
        let value = value.trim().to_owned();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }))
}

pub(super) fn read_required_env_u64(
    env: &impl CloudflareEnvReaderV1,
    key: &str,
) -> RouterAbProtocolResult<u64> {
    let value = read_required_env_text(env, key)?;
    value.parse::<u64>().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            format!("Cloudflare Env key {key} must be an unsigned integer"),
        )
    })
}

pub(super) fn reject_forbidden_env_keys(
    worker_role: CloudflareWorkerRoleV1,
    env: &impl CloudflareEnvReaderV1,
    forbidden_keys: &[&str],
) -> RouterAbProtocolResult<()> {
    for key in forbidden_keys {
        if env.get_text(key)?.is_some() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                format!(
                    "{} Worker cannot receive Cloudflare Env key {key}",
                    worker_role.as_str()
                ),
            ));
        }
    }
    Ok(())
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_worker_durable_object(
    env: &worker::Env,
    binding: &CloudflareSigningWorkerPresignSessionBindingV1,
) -> RouterAbProtocolResult<()> {
    match env.durable_object(&binding.binding_name) {
        Ok(_) => Ok(()),
        Err(err) => Err(worker_binding_error(
            worker_binding_error_code(&err, &binding.binding_name),
            &binding.binding_name,
            "Durable Object",
            err,
        )),
    }
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_worker_service(
    env: &worker::Env,
    binding: &CloudflarePeerBindingV1,
) -> RouterAbProtocolResult<()> {
    match env.service(&binding.binding_name) {
        Ok(_) => Ok(()),
        Err(err) => Err(worker_binding_error(
            worker_binding_error_code(&err, &binding.binding_name),
            &binding.binding_name,
            "service",
            err,
        )),
    }
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_worker_hpke_secret(
    env: &worker::Env,
    binding: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
) -> RouterAbProtocolResult<()> {
    require_worker_secret_binding_name(env, &binding.binding_name)
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_worker_hpke_secret_set(
    env: &worker::Env,
    bindings: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
) -> RouterAbProtocolResult<()> {
    require_worker_hpke_secret(env, &bindings.current)?;
    if let Some(previous) = &bindings.previous {
        require_worker_hpke_secret(env, previous)?;
    }
    Ok(())
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_worker_server_output_hpke_secret(
    env: &worker::Env,
    binding: &CloudflareServerOutputHpkeDecryptKeyBindingV1,
) -> RouterAbProtocolResult<()> {
    require_worker_secret_binding_name(env, &binding.binding_name)
}

#[cfg(feature = "workers-rs")]
pub(super) fn require_worker_secret_binding_name(
    env: &worker::Env,
    binding_name: &str,
) -> RouterAbProtocolResult<()> {
    match env.secret(binding_name) {
        Ok(_) => Ok(()),
        Err(err) => Err(worker_binding_error(
            worker_binding_error_code(&err, binding_name),
            binding_name,
            "secret",
            err,
        )),
    }
}

#[cfg(feature = "workers-rs")]
pub(super) fn worker_binding_error_code(err: &worker::Error, binding_name: &str) -> RouterAbProtocolErrorCode {
    if worker_binding_is_missing(err, binding_name) {
        RouterAbProtocolErrorCode::MissingLocalBinding
    } else {
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    }
}

#[cfg(feature = "workers-rs")]
pub(super) fn worker_binding_error(
    code: RouterAbProtocolErrorCode,
    binding_name: &str,
    binding_kind: &str,
    err: worker::Error,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        code,
        format!("Cloudflare {binding_kind} binding `{binding_name}` failed validation: {err}"),
    )
}

#[cfg(feature = "workers-rs")]
pub(super) fn worker_binding_is_missing(err: &worker::Error, binding_name: &str) -> bool {
    match err {
        worker::Error::BindingError(name) => name == binding_name,
        worker::Error::JsError(message) | worker::Error::RustError(message) => {
            message == &format!("Env does not contain binding `{binding_name}`")
                || message == &format!("Binding `{binding_name}` is undefined.")
                || message == &format!("no binding found for `{binding_name}`")
        }
        _ => false,
    }
}

/// The code a role reports when a peer it called answered with an error. A
/// peer's failure is the caller's service failure, except a lifecycle
/// transition in progress, which stays retryable so the whole operation can
/// be admitted again.
pub(crate) fn router_ab_peer_error_code_v1(peer_body: &str) -> RouterAbProtocolErrorCode {
    // The code may be nested in another role's message, as each role that
    // relays a failure prefixes its own context.
    if peer_body.contains("LifecycleTransitionInProgress:") {
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress
    } else if peer_body.contains("SupersededAttempt:") {
        // A later attempt took this one's place: the answer is final.
        RouterAbProtocolErrorCode::SupersededAttempt
    } else if peer_body.contains(SIGNING_WORKER_ECDSA_EFFECT_IN_PROGRESS_V1)
        && peer_body.contains("ReplayedLocalRequest:")
    {
        // Another attempt claimed this signing effect and has not finished.
        // The operation is still in progress, so its caller may retry it and
        // receive the stored outcome once that attempt completes.
        RouterAbProtocolErrorCode::ReplayedLocalRequest
    } else {
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    }
}

/// The SigningWorker's refusal of a signing effect that another attempt has
/// claimed and not yet finished. The Gateway recognizes it, with HTTP 409, as
/// an operation still in progress.
pub(crate) const SIGNING_WORKER_ECDSA_EFFECT_IN_PROGRESS_V1: &str =
    "SigningWorker ECDSA effect is already in progress";

/// The HTTP status a Router A/B role returns for one protocol error code.
pub(crate) fn cloudflare_router_error_status(code: RouterAbProtocolErrorCode) -> u16 {
    match code {
        RouterAbProtocolErrorCode::EmptyField
        | RouterAbProtocolErrorCode::InvalidTimeRange
        | RouterAbProtocolErrorCode::InvalidGateDecision
        | RouterAbProtocolErrorCode::InvalidPrepareHandle
        | RouterAbProtocolErrorCode::InvalidRole
        | RouterAbProtocolErrorCode::InvalidSignerIdentity
        | RouterAbProtocolErrorCode::InvalidLifecycleState
        | RouterAbProtocolErrorCode::InvalidLocalHttpRequest
        | RouterAbProtocolErrorCode::InvalidLocalRoute
        | RouterAbProtocolErrorCode::MalformedWirePayload
        | RouterAbProtocolErrorCode::UnsupportedVectorVersion => 400,
        RouterAbProtocolErrorCode::ExpiredLocalRequest
        | RouterAbProtocolErrorCode::PairPreparationExpired => 408,
        RouterAbProtocolErrorCode::ReplayedLocalRequest
        | RouterAbProtocolErrorCode::ConflictingPair
        | RouterAbProtocolErrorCode::MissingPairPreparation => 409,
        RouterAbProtocolErrorCode::MissingLocalBinding
        | RouterAbProtocolErrorCode::ForbiddenLocalBinding
        | RouterAbProtocolErrorCode::InvalidLocalServiceConfig => 500,
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress => 503,
        RouterAbProtocolErrorCode::SupersededAttempt => 410,
    }
}

/// The Worker response for a Router A/B protocol error: `"{code:?}: {message}"`
/// with the status that `cloudflare_router_error_status` maps the code to.
#[cfg(feature = "workers-rs")]
pub(crate) fn cloudflare_protocol_error_response_v1(
    err: &RouterAbProtocolError,
) -> worker::Result<worker::Response> {
    worker::Response::error(
        format!("{:?}: {}", err.code(), err.message()),
        cloudflare_router_error_status(err.code()),
    )
}

#[cfg(feature = "workers-rs")]
pub(crate) fn cloudflare_now_unix_ms_v1() -> RouterAbProtocolResult<u64> {
    let now = worker::js_sys::Date::now();
    if !now.is_finite() || now <= 0.0 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            "Cloudflare Worker clock returned invalid Unix milliseconds",
        ));
    }
    Ok(now as u64)
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_random_bytes_v1(len: usize) -> RouterAbProtocolResult<Vec<u8>> {
    if len > CLOUDFLARE_DERIVER_HOST_RANDOM_PRELOAD_MAX_BYTES_V1 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Cloudflare random preload length exceeds maximum",
        ));
    }
    let mut out = vec![0u8; len];
    getrandom::getrandom(&mut out).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("Cloudflare random preload failed: {err}"),
        )
    })?;
    Ok(out)
}

pub(super) fn push_hash_field_v1(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u32).to_be_bytes());
    hasher.update(bytes);
}

pub(super) fn map_derivation_to_protocol(error: RouterAbDerivationError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!(
            "Cloudflare signer plaintext boundary rejected input: {:?}",
            error.code()
        ),
    )
}

pub(super) fn map_root_share_to_protocol(error: RouterAbDerivationError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!(
            "Cloudflare root-share wire boundary rejected input: {:?}",
            error.code()
        ),
    )
}

pub(super) fn map_cloudflare_tenant_root_role_store_error_v1(
    operation: &'static str,
    error: impl core::fmt::Display,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("{operation} failed: {error}"),
    )
}

pub(super) fn require_work_kind_set(
    field: &str,
    values: &[ExpensiveWorkKindV1],
) -> RouterAbProtocolResult<()> {
    if values.is_empty() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::EmptyField,
            format!("{field} must not be empty"),
        ));
    }
    for (index, value) in values.iter().enumerate() {
        if values.iter().skip(index + 1).any(|other| other == value) {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{field} must not contain duplicate work kinds"),
            ));
        }
    }
    Ok(())
}

pub(super) fn require_signer_role(role: Role) -> RouterAbProtocolResult<()> {
    match role {
        Role::SignerA | Role::SignerB => Ok(()),
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            format!(
                "Cloudflare signer root-share scope requires signer role, received {}",
                role.as_str()
            ),
        )),
    }
}
