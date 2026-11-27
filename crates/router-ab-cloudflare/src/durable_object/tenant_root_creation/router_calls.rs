//! Router-side clients of the creation object, its state transport and the response validators.

use super::*;

pub(super) fn validate_cloudflare_tenant_root_creation_journal_response_v1(
    response: &CloudflareTenantRootCreationJournalResponseV1,
    expected_revision: u64,
    expected_journal_digest: TenantRootProtocolDigestV1,
    expected_capability_digest: TenantRootProtocolDigestV1,
) -> RouterAbProtocolResult<()> {
    if response.revision != expected_revision {
        return Err(malformed_input(
            "tenant-root creation journal response revision does not match the submitted journal",
        ));
    }
    validate_response_digest(
        "tenant-root creation journal response journal digest",
        &response.journal_digest_b64u,
        expected_journal_digest,
    )?;
    validate_response_digest(
        "tenant-root creation journal response capability digest",
        &response.capability_digest_b64u,
        expected_capability_digest,
    )
}

pub(super) fn validate_response_digest(
    field: &str,
    encoded: &str,
    expected: TenantRootProtocolDigestV1,
) -> RouterAbProtocolResult<()> {
    let decoded = decode_canonical_base64url(field, encoded, 32, base64url_len_for_bytes(32))?;
    if decoded.as_slice() != expected.as_bytes() {
        return Err(malformed_input(format!(
            "{field} does not match the submitted tenant-root creation value"
        )));
    }
    Ok(())
}

/// Persists a started creation journal and its capability at the creation
/// state and validates the recorded outcome, on any host.
pub async fn tenant_root_creation_journal_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    journal: &TenantRootCreationJournalV1,
    capability: &TenantRootCreationCapabilityV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalResponseV1> {
    let identity = tenant_root_creation_identity_v1(journal)?;
    let custody_lineage = journal.custody_lineage();
    journal
        .rebuild(identity.clone(), custody_lineage)
        .map_err(candidate_derivation_error)?;
    let identity_digest = identity.digest().map_err(candidate_derivation_error)?;
    let journal_digest = journal.digest().map_err(candidate_derivation_error)?;
    let revision = journal.revision();
    if capability.identity_digest() != identity_digest
        || capability.custody_lineage() != custody_lineage
        || capability.started_journal_digest() != journal_digest
        || capability.expected_revision() != revision
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation capability does not match the submitted journal",
        ));
    }
    let journal_bytes = journal
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    let capability_bytes = capability
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    let capability_digest = capability.digest().map_err(candidate_derivation_error)?;
    let request = CloudflareTenantRootCreationJournalRequestV1 {
        journal_b64u: encode_base64url_bytes_v1(&journal_bytes),
        creation_capability_b64u: encode_base64url_bytes_v1(&capability_bytes),
    };
    let response: CloudflareTenantRootCreationJournalResponseV1 = state
        .creation_state_call(
            capability.authority_id(),
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_PATH,
            "tenant-root creation journal",
            &request,
            TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_JOURNAL_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    validate_cloudflare_tenant_root_creation_journal_response_v1(
        &response,
        revision,
        journal_digest,
        capability_digest,
    )?;
    Ok(response)
}

/// Reads one tenant root's creation state, on any host.
pub async fn tenant_root_creation_journal_read_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalReadResponseV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH,
            "tenant-root creation read",
            &CloudflareTenantRootCreationJournalReadRequestV1 {
                identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
                custody_lineage_b64u: encode_base64url_bytes_v1(custody_lineage.as_bytes()),
            },
            TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_JOURNAL_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await
}

/// Reads the Router's own progress for one creation, on any host. Unlike the
/// journal read, a creation that has not started is an outcome, not an error.
pub(crate) async fn tenant_root_creation_progress_read_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationProgressV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH,
            "tenant-root creation progress read",
            &CloudflareTenantRootCreationJournalReadRequestV1 {
                identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
                custody_lineage_b64u: encode_base64url_bytes_v1(custody_lineage.as_bytes()),
            },
            TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_PROGRESS_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await
}

/// Abandons one uncommitted creation in the Router's creation state, on any
/// host, and returns the installed roles that must then be cleaned.
pub(crate) async fn tenant_root_creation_abandonment_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationAbandonmentResponseV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH,
            "tenant-root creation abandonment",
            &CloudflareTenantRootCreationJournalReadRequestV1 {
                identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
                custody_lineage_b64u: encode_base64url_bytes_v1(custody_lineage.as_bytes()),
            },
            TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
        )
        .await
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn execute_cloudflare_router_tenant_root_creation_journal_call_v1(
    env: &worker::Env,
    journal: &TenantRootCreationJournalV1,
    capability: &TenantRootCreationCapabilityV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalResponseV1> {
    tenant_root_creation_journal_call_v1(
        &CloudflareTenantRootCreationStateTransportV1::new(env),
        journal,
        capability,
    )
    .await
}

/// Reaches the Router-owned creation state for one tenant root.
///
/// On Cloudflare this is the creation Durable Object, addressed by name and
/// checked against its authority id. A VM Router serves the same operations
/// from its own SQLite store; other VM roles reach it over HTTP.
#[allow(async_fn_in_trait)]
pub trait TenantRootCreationStateTransportV1 {
    /// The creation authority id for one tenant root's creation state.
    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1>;

    /// Executes one creation-state operation and returns its JSON response.
    #[allow(clippy::too_many_arguments)]
    async fn creation_state_call<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        request_max_bytes: usize,
        response_max_bytes: usize,
    ) -> RouterAbProtocolResult<TResponse>;
}

/// The Cloudflare creation-state transport: the creation Durable Object.
#[cfg(feature = "workers-rs")]
pub(crate) struct CloudflareTenantRootCreationStateTransportV1<'a> {
    pub(super) env: &'a worker::Env,
}

#[cfg(feature = "workers-rs")]
impl<'a> CloudflareTenantRootCreationStateTransportV1<'a> {
    pub(crate) const fn new(env: &'a worker::Env) -> Self {
        Self { env }
    }
}

#[cfg(feature = "workers-rs")]
impl TenantRootCreationStateTransportV1 for CloudflareTenantRootCreationStateTransportV1<'_> {
    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        Ok(derive_tenant_root_creation_authority_object_v1(
            self.env,
            identity_digest,
            custody_lineage,
        )?
        .0)
    }

    async fn creation_state_call<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        request_max_bytes: usize,
        response_max_bytes: usize,
    ) -> RouterAbProtocolResult<TResponse> {
        execute_cloudflare_router_tenant_root_creation_private_call_v1(
            self.env,
            authority_id,
            identity_digest,
            custody_lineage,
            path,
            label,
            request,
            request_max_bytes,
            response_max_bytes,
        )
        .await
    }
}

#[cfg(feature = "workers-rs")]
#[allow(clippy::too_many_arguments)]
pub(super) async fn execute_cloudflare_router_tenant_root_creation_private_call_v1<
    TRequest: Serialize,
    TResponse: DeserializeOwned,
>(
    env: &worker::Env,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    path: &str,
    label: &str,
    request: &TRequest,
    request_max_bytes: usize,
    response_max_bytes: usize,
) -> RouterAbProtocolResult<TResponse> {
    let object_name = tenant_root_creation_object_name_v1(identity_digest, custody_lineage);
    let namespace = env
        .durable_object(ROUTER_TENANT_ROOT_CREATION_DO_BINDING_V1)
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingLocalBinding,
                format!("{label} Durable Object namespace lookup failed: {error}"),
            )
        })?;
    let object_id = namespace.id_from_name(&object_name).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} Durable Object id derivation failed: {error}"),
        )
    })?;
    let object_id = object_id.to_string();
    validate_tenant_root_creation_object_binding_v1(&object_id, authority_id)?;
    let stub = namespace.get_by_name(&object_name).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} Durable Object stub lookup failed: {error}"),
        )
    })?;
    execute_cloudflare_router_tenant_root_stub_private_call_v1(
        env,
        stub,
        path,
        label,
        request,
        request_max_bytes,
        response_max_bytes,
    )
    .await
}

/// Runs one restore-refresh checkpoint operation in the destination's
/// Router-owned creation state, which the grant names.
pub(crate) async fn tenant_root_restore_refresh_checkpoint_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    request: &CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointResponseV1> {
    let grant_b64u = restore_refresh_checkpoint_grant_b64u_v1(request);
    let (_, grant, _) = restore_refresh_checkpoint_scope_from_grant_v1(grant_b64u)?;
    let identity_digest = grant.destination_identity_digest();
    let custody_lineage = grant.destination_lineage();
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH,
            "tenant-root restore-refresh checkpoint",
            request,
            TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_RESPONSE_MAX_BYTES_V1,
        )
        .await
}

/// Reads or authenticates the destination's bootstrap authority in the
/// Router-owned creation state, carrying the credential the caller presented.
pub(crate) async fn tenant_root_destination_bootstrap_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    request: &CloudflareTenantRootDestinationBootstrapRequestV1,
    token_b64u: Option<&str>,
) -> RouterAbProtocolResult<CloudflareTenantRootDestinationBootstrapResponseV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            crate::CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_PRIVATE_REQUEST_PATH,
            "tenant-root destination bootstrap",
            &CloudflareTenantRootDestinationBootstrapCallV1 {
                request: request.clone(),
                token_b64u: token_b64u.map(str::to_owned),
            },
            TENANT_ROOT_DESTINATION_BOOTSTRAP_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_DESTINATION_BOOTSTRAP_RESPONSE_MAX_BYTES_V1,
        )
        .await
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_router_tenant_root_stub_private_call_v1<
    TRequest: Serialize,
    TResponse: DeserializeOwned,
>(
    env: &worker::Env,
    stub: worker::Stub,
    path: &str,
    label: &str,
    request: &TRequest,
    request_max_bytes: usize,
    response_max_bytes: usize,
) -> RouterAbProtocolResult<TResponse> {
    let request_body = serde_json::to_string(request).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{label} request JSON encoding failed: {error}"),
        )
    })?;
    if request_body.len() > request_max_bytes {
        return Err(malformed_input(format!(
            "{label} request exceeds its maximum size"
        )));
    }
    let headers = worker::Headers::new();
    headers
        .set("content-type", "application/json")
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{label} request headers failed: {error}"),
            )
        })?;
    crate::set_cloudflare_internal_service_auth_header_v1(env, &headers, label)?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_headers(headers)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&request_body)));
    let request =
        worker::Request::new_with_init(&format!("https://router-ab-do.internal{path}"), &init)
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{label} request construction failed: {error}"),
                )
            })?;
    let mut response = stub.fetch_with_request(request).await.map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} request failed: {error}"),
        )
    })?;
    let status = response.status_code();
    if !(200..=299).contains(&status) {
        let response_body =
            read_bounded_response_body(&mut response, response_max_bytes, label).await?;
        let response_detail = String::from_utf8_lossy(&response_body);
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} returned HTTP {status}: {}", response_detail.trim()),
        ));
    }
    if !response_has_json_content_type(&response, label)? {
        return Err(malformed_input(format!(
            "{label} response content-type is not application/json"
        )));
    }
    decode_bounded_json_response(&mut response, response_max_bytes, label).await
}

#[cfg(feature = "workers-rs")]
pub(super) fn tenant_root_cutover_stub_v1(env: &worker::Env) -> RouterAbProtocolResult<worker::Stub> {
    let namespace = env
        .durable_object(ROUTER_TENANT_ROOT_CREATION_DO_BINDING_V1)
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingLocalBinding,
                format!("tenant-root cutover Durable Object namespace lookup failed: {error}"),
            )
        })?;
    namespace
        .get_by_name(TENANT_ROOT_CUTOVER_OBJECT_NAME_V1)
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("tenant-root cutover Durable Object stub lookup failed: {error}"),
            )
        })
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn execute_cloudflare_router_tenant_root_cutover_read_call_v1(
    env: &worker::Env,
) -> RouterAbProtocolResult<CloudflareTenantRootCutoverReadResponseV1> {
    execute_cloudflare_router_tenant_root_stub_private_call_v1(
        env,
        tenant_root_cutover_stub_v1(env)?,
        CLOUDFLARE_TENANT_ROOT_CUTOVER_READ_PATH,
        "tenant-root cutover read",
        &CloudflareTenantRootCutoverReadRequestV1 {},
        TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1,
        TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1,
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn execute_cloudflare_router_tenant_root_cutover_write_call_v1(
    env: &worker::Env,
    request: &CloudflareTenantRootCutoverWriteRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCutoverWriteResponseV1> {
    execute_cloudflare_router_tenant_root_stub_private_call_v1(
        env,
        tenant_root_cutover_stub_v1(env)?,
        CLOUDFLARE_TENANT_ROOT_CUTOVER_WRITE_PATH,
        "tenant-root cutover write",
        request,
        TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1,
        TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1,
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(super) fn response_has_json_content_type(
    response: &worker::Response,
    label: &str,
) -> RouterAbProtocolResult<bool> {
    let Some(content_type) = response.headers().get("content-type").map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{label} response content-type header read failed: {error}"),
        )
    })?
    else {
        return Ok(false);
    };
    Ok(content_type
        .split(';')
        .next()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json")))
}

#[cfg(feature = "workers-rs")]
pub(super) async fn read_bounded_response_body(
    response: &mut worker::Response,
    max_bytes: usize,
    label: &str,
) -> RouterAbProtocolResult<Vec<u8>> {
    use futures::StreamExt;

    if let Ok(mut stream) = response.stream() {
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("{label} response body read failed: {error}"),
                )
            })?;
            let next_len = body.len().checked_add(chunk.len()).ok_or_else(|| {
                malformed_input(format!("{label} response body length overflows"))
            })?;
            if next_len > max_bytes {
                return Err(malformed_input(format!(
                    "{label} response exceeds its maximum size"
                )));
            }
            body.extend_from_slice(&chunk);
        }
        return Ok(body);
    }
    let body = response.bytes().await.map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{label} response body read failed: {error}"),
        )
    })?;
    if body.len() > max_bytes {
        return Err(malformed_input(format!(
            "{label} response exceeds its maximum size"
        )));
    }
    Ok(body)
}

#[cfg(feature = "workers-rs")]
pub(super) async fn decode_bounded_json_response<T: DeserializeOwned>(
    response: &mut worker::Response,
    max_bytes: usize,
    label: &str,
) -> RouterAbProtocolResult<T> {
    let body = read_bounded_response_body(response, max_bytes, label).await?;
    serde_json::from_slice(&body).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{label} response JSON parse failed: {error}"),
        )
    })
}

pub(super) fn validate_commitment_wire_for_role_command(
    bytes: &[u8],
    command: &VerifiedTenantRootRoleCreationCommandV1,
    expected_role: TwoPartyDeriverRole,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootCreationCommitmentV1> {
    let signed = TenantRootSignedCreationCommitmentV1::decode_canonical_bytes(bytes)
        .map_err(candidate_derivation_error)?;
    let context = signed.transcript().context().clone();
    let context_digest = context.digest().map_err(candidate_derivation_error)?;
    if context_digest != command.creation_context_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation commitment does not match its role creation command",
        ));
    }
    let role = signed.role();
    if role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation commitment role does not match its role creation command",
        ));
    }
    verify_creation_commitment(signed, &context, expected_role, role_keys)
}

pub(super) fn validate_creation_commitment_response_v1(
    response: &CloudflareTenantRootCreationCommitmentResponseV1,
    command: &VerifiedTenantRootRoleCreationCommandV1,
    candidate_bytes: &[u8],
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationCommitmentOutcomeV1> {
    let command_digest = command.digest();
    validate_response_digest(
        "tenant-root creation commitment response command digest",
        &response.command_digest_b64u,
        command_digest,
    )?;
    validate_response_digest(
        "tenant-root creation commitment response journal digest",
        &response.journal_digest_b64u,
        command.started_journal_digest(),
    )?;
    validate_response_digest(
        "tenant-root creation commitment response identity digest",
        &response.identity_digest_b64u,
        TenantRootProtocolDigestV1::from_bytes(*command.identity_digest().as_bytes())
            .map_err(candidate_derivation_error)?,
    )?;
    validate_response_lineage(
        "tenant-root creation commitment response custody lineage",
        &response.custody_lineage_b64u,
        command.custody_lineage(),
    )?;
    validate_response_digest(
        "tenant-root creation commitment response ceremony context digest",
        &response.ceremony_context_digest_b64u,
        command.creation_context_digest(),
    )?;
    match &response.outcome {
        CloudflareTenantRootCreationCommitmentResponseOutcomeV1::WaitingForPeer {
            role,
            signed_commitment_b64u,
        } => {
            if role.to_protocol() != command.role() {
                return Err(malformed_input(
                    "tenant-root creation commitment response role is invalid",
                ));
            }
            let returned = decode_canonical_base64url(
                "tenant-root creation commitment response signed commitment",
                signed_commitment_b64u,
                TENANT_ROOT_SIGNED_CREATION_COMMITMENT_MAX_BYTES_V1,
                TENANT_ROOT_CREATION_COMMITMENT_MAX_BASE64URL_BYTES_V1,
            )?;
            if returned != candidate_bytes {
                return Err(malformed_input(
                    "tenant-root creation commitment response does not replay the submitted commitment",
                ));
            }
            validate_commitment_wire_for_role_command(
                &returned,
                command,
                command.role(),
                role_keys,
            )?;
            Ok(CloudflareTenantRootCreationCommitmentOutcomeV1::WaitingForPeer { role: *role })
        }
        CloudflareTenantRootCreationCommitmentResponseOutcomeV1::BothRolesCommitted {
            deriver_a_signed_commitment_b64u,
            deriver_b_signed_commitment_b64u,
            pair_digest_b64u,
        } => {
            let deriver_a_bytes = decode_canonical_base64url(
                "tenant-root creation commitment response Deriver A commitment",
                deriver_a_signed_commitment_b64u,
                TENANT_ROOT_SIGNED_CREATION_COMMITMENT_MAX_BYTES_V1,
                TENANT_ROOT_CREATION_COMMITMENT_MAX_BASE64URL_BYTES_V1,
            )?;
            let deriver_b_bytes = decode_canonical_base64url(
                "tenant-root creation commitment response Deriver B commitment",
                deriver_b_signed_commitment_b64u,
                TENANT_ROOT_SIGNED_CREATION_COMMITMENT_MAX_BYTES_V1,
                TENANT_ROOT_CREATION_COMMITMENT_MAX_BASE64URL_BYTES_V1,
            )?;
            let deriver_a = validate_commitment_wire_for_role_command(
                &deriver_a_bytes,
                command,
                TwoPartyDeriverRole::DeriverA,
                role_keys,
            )?;
            let deriver_b = validate_commitment_wire_for_role_command(
                &deriver_b_bytes,
                command,
                TwoPartyDeriverRole::DeriverB,
                role_keys,
            )?;
            let pair = VerifiedTenantRootCreationCommitmentPairV1::new(deriver_a, deriver_b)
                .map_err(candidate_derivation_error)?;
            validate_response_digest(
                "tenant-root creation commitment response pair digest",
                pair_digest_b64u,
                pair.digest(),
            )?;
            let expected_candidate = match command.role() {
                TwoPartyDeriverRole::DeriverA => pair.deriver_a().canonical_bytes(),
                TwoPartyDeriverRole::DeriverB => pair.deriver_b().canonical_bytes(),
            };
            if expected_candidate != candidate_bytes {
                return Err(malformed_input(
                    "tenant-root creation commitment response pair omits the submitted commitment",
                ));
            }
            Ok(CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { pair })
        }
    }
}

pub(super) fn validate_response_lineage(
    field: &str,
    encoded: &str,
    expected: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<()> {
    let decoded = decode_canonical_base64url(field, encoded, 16, base64url_len_for_bytes(16))?;
    if decoded.as_slice() != expected.as_bytes() {
        return Err(malformed_input(format!(
            "{field} does not match the submitted tenant-root creation value"
        )));
    }
    Ok(())
}

/// Submits one role's verified creation commitment to the creation state and
/// validates the rendezvous outcome, on any host.
pub(crate) async fn tenant_root_creation_commitment_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    command: &VerifiedTenantRootRoleCreationCommandV1,
    commitment: &VerifiedTenantRootCreationCommitmentV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationCommitmentOutcomeV1> {
    let command_bytes = command.canonical_bytes().to_vec();
    let commitment_bytes = commitment.canonical_bytes().to_vec();
    validate_commitment_wire_for_role_command(
        &commitment_bytes,
        command,
        command.role(),
        role_keys,
    )?;
    let request = CloudflareTenantRootCreationCommitmentRequestV1 {
        role_creation_command_b64u: encode_base64url_bytes_v1(&command_bytes),
        signed_commitment_b64u: encode_base64url_bytes_v1(&commitment_bytes),
    };
    let response = state.creation_state_call(
        command.authority_id(),
        command.identity_digest(),
        command.custody_lineage(),
        CLOUDFLARE_TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_PATH,
        "tenant-root creation commitment",
        &request,
        TENANT_ROOT_CREATION_COMMITMENT_REQUEST_MAX_BYTES_V1,
        TENANT_ROOT_CREATION_COMMITMENT_RESPONSE_MAX_BYTES_V1,
    )
    .await?;
    validate_creation_commitment_response_v1(&response, command, &commitment_bytes, role_keys)
}

pub(super) fn validate_installation_response_v1(
    response: &CloudflareTenantRootCreationInstallationResponseV1,
    command: &VerifiedTenantRootRoleCreationCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationInstallationOutcomeV1> {
    let command_digest = command.digest();
    validate_response_digest(
        "tenant-root installation response command digest",
        &response.command_digest_b64u,
        command_digest,
    )?;
    validate_response_digest(
        "tenant-root installation response journal digest",
        &response.journal_digest_b64u,
        command.started_journal_digest(),
    )?;
    validate_response_digest(
        "tenant-root installation response identity digest",
        &response.identity_digest_b64u,
        TenantRootProtocolDigestV1::from_bytes(*command.identity_digest().as_bytes())
            .map_err(candidate_derivation_error)?,
    )?;
    validate_response_lineage(
        "tenant-root installation response custody lineage",
        &response.custody_lineage_b64u,
        command.custody_lineage(),
    )?;
    validate_response_digest(
        "tenant-root installation response ceremony context digest",
        &response.ceremony_context_digest_b64u,
        command.creation_context_digest(),
    )?;
    let transcript = evidence.evidence().transcript();
    if transcript.role() != command.role()
        || transcript
            .context()
            .digest()
            .map_err(candidate_derivation_error)?
            != command.creation_context_digest()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root installation evidence does not match its role creation command",
        ));
    }
    match &response.outcome {
        CloudflareTenantRootCreationInstallationResponseOutcomeV1::WaitingForPeer { role } => {
            if role.to_protocol() != command.role() {
                return Err(malformed_input(
                    "tenant-root installation response role is invalid",
                ));
            }
            Ok(CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer { role: *role })
        }
        CloudflareTenantRootCreationInstallationResponseOutcomeV1::BothRolesReady {
            root_commitment_b64u,
        } => {
            let _ = decode_fixed_base64url_32(
                "tenant-root installation response root commitment",
                root_commitment_b64u,
            )?;
            Ok(
                CloudflareTenantRootCreationInstallationOutcomeV1::BothRolesReady {
                    root_commitment_b64u: root_commitment_b64u.clone(),
                },
            )
        }
    }
}

/// Submits one role's verified installation evidence to the creation state
/// and validates the checkpoint outcome, on any host.
pub(crate) async fn tenant_root_creation_installation_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    command: &VerifiedTenantRootRoleCreationCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationInstallationOutcomeV1> {
    let command_bytes = command.canonical_bytes().to_vec();
    let evidence_bytes = evidence.canonical_bytes();
    let transcript = evidence.evidence().transcript();
    if transcript.role() != command.role()
        || transcript
            .context()
            .digest()
            .map_err(candidate_derivation_error)?
            != command.creation_context_digest()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root installation evidence does not match its role creation command",
        ));
    }
    let request = CloudflareTenantRootCreationInstallationRequestV1 {
        role_creation_command_b64u: encode_base64url_bytes_v1(&command_bytes),
        signed_evidence_b64u: encode_base64url_bytes_v1(evidence_bytes),
    };
    let response = state.creation_state_call(
        command.authority_id(),
        command.identity_digest(),
        command.custody_lineage(),
        CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH,
        "tenant-root installation checkpoint",
        &request,
        TENANT_ROOT_CREATION_INSTALLATION_REQUEST_MAX_BYTES_V1,
        TENANT_ROOT_CREATION_INSTALLATION_RESPONSE_MAX_BYTES_V1,
    )
    .await?;
    validate_installation_response_v1(&response, command, evidence)
}

/// Sends one verified cleanup command and its exact successful terminal receipt
/// to the Router-owned creation state, on any host.
pub async fn tenant_root_creation_cleanup_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    command: &VerifiedTenantRootRoleCleanupCommandV1,
    receipt_bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareTenantRootCreationCleanupResponseV1> {
    let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(receipt_bytes)
        .map_err(candidate_derivation_error)?;
    let TenantRootCommandTerminalReceiptV1::Success(receipt) = receipt else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation cleanup requires a successful terminal receipt",
        ));
    };
    let receipt_digest = receipt.digest().map_err(candidate_derivation_error)?;
    let command_bytes = command
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    let authority_id =
        state.creation_authority_id(command.identity_digest(), command.custody_lineage())?;
    let request = CloudflareTenantRootCreationCleanupRequestV1 {
        cleanup_command_b64u: encode_base64url_bytes_v1(&command_bytes),
        cleanup_receipt_b64u: encode_base64url_bytes_v1(receipt_bytes),
    };
    let response: CloudflareTenantRootCreationCleanupResponseV1 =
        state.creation_state_call(
            authority_id,
            command.identity_digest(),
            command.custody_lineage(),
            CLOUDFLARE_TENANT_ROOT_CREATION_CLEANUP_CHECKPOINT_PATH,
            "tenant-root creation cleanup checkpoint",
            &request,
            TENANT_ROOT_CREATION_CLEANUP_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_CLEANUP_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    if response.role.to_protocol() != command.role() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation cleanup response role does not match its command",
        ));
    }
    validate_response_digest(
        "tenant-root creation cleanup response receipt digest",
        &response.cleanup_receipt_digest_b64u,
        receipt_digest,
    )?;
    Ok(response)
}

/// Sends a control-plane initial-activation receipt to the Router-owned
/// creation state for authoritative persistence, on any host.
pub(crate) async fn tenant_root_creation_initial_activation_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    receipt_bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareTenantRootCreationInitialActivationResponseV1> {
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(receipt_bytes)
        .map_err(candidate_derivation_error)?;
    if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root initial activation persistence requires an initial-creation receipt",
        ));
    }
    let receipt_digest = receipt.digest().map_err(candidate_derivation_error)?;
    let authority_id =
        state.creation_authority_id(receipt.identity_digest(), receipt.custody_lineage())?;
    let request = CloudflareTenantRootCreationInitialActivationRequestV1 {
        activation_receipt_b64u: encode_base64url_bytes_v1(receipt_bytes),
    };
    let response: CloudflareTenantRootCreationInitialActivationResponseV1 =
        state.creation_state_call(
            authority_id,
            receipt.identity_digest(),
            receipt.custody_lineage(),
            CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH,
            "tenant-root initial activation",
            &request,
            TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    let response_digest = decode_lifecycle_receipt_digest(
        "tenant-root initial activation response receipt digest",
        &response.activation_receipt_digest_b64u,
    )?;
    if response_digest != receipt_digest {
        return Err(malformed_input(
            "tenant-root initial activation response receipt digest does not match the submitted receipt",
        ));
    }
    if response.lifecycle_revision != receipt.result_control_plane_revision() {
        return Err(malformed_input(
            "tenant-root initial activation response revision does not match the submitted receipt",
        ));
    }
    Ok(response)
}

/// Sends a control-plane restore activation receipt to the Router-owned
/// creation object. The object binds it to its promoted restore checkpoint
/// before consuming the destination bootstrap authority.
/// Activates a restored root in the Router-owned creation state from the
/// verified initial-creation receipt its restore promoted.
pub(crate) async fn tenant_root_restore_initial_activation_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    receipt_bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreInitialActivationResponseV1> {
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(receipt_bytes)
        .map_err(candidate_derivation_error)?;
    if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore initial activation persistence requires an initial-creation receipt",
        ));
    }
    let receipt_digest = receipt.digest().map_err(candidate_derivation_error)?;
    let authority_id =
        state.creation_authority_id(receipt.identity_digest(), receipt.custody_lineage())?;
    let request = CloudflareTenantRootRestoreInitialActivationRequestV1 {
        activation_receipt_b64u: encode_base64url_bytes_v1(receipt_bytes),
    };
    let response: CloudflareTenantRootRestoreInitialActivationResponseV1 = state
        .creation_state_call(
            authority_id,
            receipt.identity_digest(),
            receipt.custody_lineage(),
            crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH,
            "tenant-root restore initial activation",
            &request,
            TENANT_ROOT_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_RESTORE_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    let response_digest = decode_lifecycle_receipt_digest(
        "tenant-root restore initial activation response receipt digest",
        &response.activation_receipt_digest_b64u,
    )?;
    if response_digest != receipt_digest {
        return Err(malformed_input(
            "tenant-root restore initial activation response receipt digest does not match the submitted receipt",
        ));
    }
    if response.lifecycle_revision != receipt.result_control_plane_revision() {
        return Err(malformed_input(
            "tenant-root restore initial activation response revision does not match the submitted receipt",
        ));
    }
    Ok(response)
}

/// Sends a verified refresh-swap activation receipt to the Router-owned
/// creation object after both role-private swaps have committed.
pub(crate) async fn tenant_root_refresh_activation_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    receipt_bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshActivationResponseV1> {
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(receipt_bytes)
        .map_err(candidate_derivation_error)?;
    if receipt.transition() != TenantRootActivationReceiptTransitionV1::RefreshSwap {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation persistence requires a refresh-swap receipt",
        ));
    }
    let receipt_digest = receipt.digest().map_err(candidate_derivation_error)?;
    let authority_id = state.creation_authority_id(receipt.identity_digest(), receipt.custody_lineage())?;
    let request = CloudflareTenantRootRefreshActivationRequestV1 {
        activation_receipt_b64u: encode_base64url_bytes_v1(receipt_bytes),
    };
    let response: CloudflareTenantRootRefreshActivationResponseV1 =
        state.creation_state_call(
            authority_id,
            receipt.identity_digest(),
            receipt.custody_lineage(),
            CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH,
            "tenant-root refresh activation",
            &request,
            TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_REFRESH_ACTIVATION_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    let response_digest = decode_lifecycle_receipt_digest(
        "tenant-root refresh activation response receipt digest",
        &response.activation_receipt_digest_b64u,
    )?;
    if response_digest != receipt_digest {
        return Err(malformed_input(
            "tenant-root refresh activation response receipt digest does not match the submitted receipt",
        ));
    }
    if response.lifecycle_revision != receipt.result_control_plane_revision() {
        return Err(malformed_input(
            "tenant-root refresh activation response revision does not match the submitted receipt",
        ));
    }
    Ok(response)
}

/// Issuer-verified active public state read from the Router-owned object.
pub struct CloudflareVerifiedTenantRootActiveStateV1 {
    pub(crate) activation_receipt: router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
    pub(crate) lifecycle_revision: u64,
    pub(crate) refresh_fence: CloudflareTenantRootRefreshFenceV1,
    pub(crate) managed_restore_fence: CloudflareTenantRootManagedRestoreFenceV1,
    pub(crate) job: Option<CloudflareTenantRootRefreshJobReadV1>,
    pub(crate) last_manual_refresh_completed_at_ms: Option<u64>,
    pub(crate) last_refresh_completed_at_ms: Option<u64>,
    pub(crate) delivery: Option<CloudflareTenantRootDeliveryV1>,
    pub(crate) refresh_pending: Option<CloudflareTenantRootRefreshPendingV1>,
}

impl CloudflareVerifiedTenantRootActiveStateV1 {
    /// The roles still waiting for the committed receipt; empty when both have
    /// it.
    pub(crate) fn pending_delivery(&self) -> Vec<TwoPartyDeriverRole> {
        match &self.delivery {
            Some(delivery) => delivery.pending_roles(),
            None => vec![TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB],
        }
    }

    /// The issuer-verified active activation receipt.
    pub fn activation_receipt(&self) -> &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1 {
        &self.activation_receipt
    }

    /// The creation state's lifecycle revision for this active receipt.
    pub const fn lifecycle_revision(&self) -> u64 {
        self.lifecycle_revision
    }
}

/// Reads the authoritative active receipt together with its current lifecycle
/// revision, verified against the trusted issuer keys, on any host.
pub async fn tenant_root_creation_active_state_with_revision_read_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<CloudflareVerifiedTenantRootActiveStateV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    let request = CloudflareTenantRootCreationActiveStateReadRequestV1::Read {
        identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
        custody_lineage_b64u: custody_lineage.to_base64url(),
    };
    let response: CloudflareTenantRootCreationActiveStateReadResponseV1 =
        state.creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
            "tenant-root active-state read",
            &request,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    decode_verified_active_state_response_v1(
        issuer_keys,
        authority_id,
        identity_digest,
        custody_lineage,
        response,
    )
}

/// Reads the outcome of one completed managed restore, named by its exact
/// issuer-signed public state and capability, with the issuer-verified active
/// state. The outcome is `None` until that restore's forward refresh commits.
pub(crate) async fn tenant_root_managed_restore_completion_read_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    public_state_b64u: String,
    capability_b64u: String,
) -> RouterAbProtocolResult<(
    Option<CloudflareTenantRootRefreshActivationResponseV1>,
    CloudflareVerifiedTenantRootActiveStateV1,
)> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    let request =
        CloudflareTenantRootCreationActiveStateReadRequestV1::ReadManagedRestoreCompletion {
            identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: custody_lineage.to_base64url(),
            public_state_b64u,
            capability_b64u,
        };
    let mut response: CloudflareTenantRootCreationActiveStateReadResponseV1 = state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
            "tenant-root managed-restore completion read",
            &request,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    let completed = response.managed_restore_completion.take();
    let active = decode_verified_active_state_response_v1(
        issuer_keys,
        authority_id,
        identity_digest,
        custody_lineage,
        response,
    )?;
    Ok((completed, active))
}

/// Reads the authoritative active receipt together with its current lifecycle revision.
#[cfg(feature = "workers-rs")]
pub(crate) async fn execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
    env: &worker::Env,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<CloudflareVerifiedTenantRootActiveStateV1> {
    let issuer_keys = crate::env::decode_issuer_verifying_keys(&read_required_worker_var(
        env,
        crate::TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
    )?)?;
    tenant_root_creation_active_state_with_revision_read_call_v1(
        &CloudflareTenantRootCreationStateTransportV1::new(env),
        &issuer_keys,
        identity_digest,
        custody_lineage,
    )
    .await
}

/// Reserves one managed-restore authorization against the Router's active
/// state and returns the exact persisted challenge. A terminal retry returns
/// the challenge from that terminal fence.
pub(crate) async fn tenant_root_managed_restore_reservation_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    authorization: CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootManagedRestoreAuthorizationChallengeV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    let request = CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveManagedRestore {
        identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
        custody_lineage_b64u: custody_lineage.to_base64url(),
        authorization,
    };
    let response: CloudflareTenantRootCreationActiveStateReadResponseV1 = state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
            "tenant-root managed-restore authorization reservation",
            &request,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    let active = decode_verified_active_state_response_v1(
        issuer_keys,
        authority_id,
        identity_digest,
        custody_lineage,
        response,
    )?;
    match active.managed_restore_fence {
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Terminal { challenge, .. } => Ok(challenge),
        CloudflareTenantRootManagedRestoreFenceV1::Open
        | CloudflareTenantRootManagedRestoreFenceV1::Expired { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. } => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root managed-restore reservation response omitted its persisted challenge",
        )),
    }
}

/// Checkpoints the exact issuer-signed managed-restore artifacts in the
/// Router's creation state and returns the issuer-verified active state.
pub(crate) async fn tenant_root_managed_restore_checkpoint_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    checkpoint: CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1,
) -> RouterAbProtocolResult<CloudflareVerifiedTenantRootActiveStateV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    let request = CloudflareTenantRootCreationActiveStateReadRequestV1::CheckpointManagedRestore {
        identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
        custody_lineage_b64u: custody_lineage.to_base64url(),
        checkpoint,
    };
    let response: CloudflareTenantRootCreationActiveStateReadResponseV1 = state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
            "tenant-root managed-restore authorization checkpoint",
            &request,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    decode_verified_active_state_response_v1(
        issuer_keys,
        authority_id,
        identity_digest,
        custody_lineage,
        response,
    )
}

/// Reserves the exact refresh context and both issuer commands before either
/// Deriver is invoked. A replay returns the already persisted attempt, so a
/// restarted Router resumes the same session and nonce.
pub(crate) async fn tenant_root_refresh_attempt_reservation_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    refresh_context_b64u: String,
    deriver_a_refresh_command_b64u: String,
    deriver_b_refresh_command_b64u: String,
    manual_operation_id: Option<String>,
) -> RouterAbProtocolResult<CloudflareVerifiedTenantRootActiveStateV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    let request = CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveRefresh {
        identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
        custody_lineage_b64u: custody_lineage.to_base64url(),
        refresh_context_b64u,
        deriver_a_refresh_command_b64u,
        deriver_b_refresh_command_b64u,
        manual_operation_id,
    };
    let response: CloudflareTenantRootCreationActiveStateReadResponseV1 =
        state.creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
            "tenant-root refresh attempt reservation",
            &request,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    decode_verified_active_state_response_v1(
        issuer_keys,
        authority_id,
        identity_digest,
        custody_lineage,
        response,
    )
}

/// Atomically admits one manual refresh before command minting or role work.
pub(crate) async fn tenant_root_refresh_admission_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    operation_id: String,
    trigger: CloudflareTenantRootRefreshTriggerV1,
    expected_lifecycle_revision: u64,
    expires_at_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshAdmissionOutcomeV1> {
    validate_refresh_operation_id_v1(&operation_id)?;
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    let request = CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveRefreshAdmission {
        identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
        custody_lineage_b64u: custody_lineage.to_base64url(),
        operation_id,
        expected_lifecycle_revision,
        expires_at_ms,
        trigger,
    };
    let response: CloudflareTenantRootCreationActiveStateReadResponseV1 =
        state.creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
            "tenant-root manual refresh admission",
            &request,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    response.refresh_admission.ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root manual refresh admission response omitted its outcome",
        )
    })
}

/// Verifies an active-state response against the request and the trusted
/// issuer keys.
pub(super) fn decode_verified_active_state_response_v1(
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    response: CloudflareTenantRootCreationActiveStateReadResponseV1,
) -> RouterAbProtocolResult<CloudflareVerifiedTenantRootActiveStateV1> {
    let response_identity_digest =
        TenantRootIdentityDigestV1::from_bytes(decode_fixed_base64url_32(
            "tenant-root active-state response identity digest",
            &response.identity_digest_b64u,
        )?);
    if response_identity_digest != identity_digest {
        return Err(malformed_input(
            "tenant-root active-state response identity digest does not match the request",
        ));
    }
    let response_custody_lineage = decode_lineage_b64u(
        "tenant-root active-state response custody lineage",
        &response.custody_lineage_b64u,
    )?;
    if response_custody_lineage != custody_lineage {
        return Err(malformed_input(
            "tenant-root active-state response custody lineage does not match the request",
        ));
    }
    let receipt_bytes = decode_canonical_base64url(
        "tenant-root active-state response activation receipt",
        &response.activation_receipt_b64u,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1,
    )?;
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(candidate_derivation_error)?;
    let issuer_verifying_key = issuer_keys.get(receipt.issuer_key_id()).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root active-state response receipt issuer is not trusted",
        )
    })?;
    let receipt = receipt
        .verify_issuer_signature(issuer_verifying_key)
        .map_err(candidate_authorization_error)?;
    if receipt.identity_digest() != identity_digest
        || receipt.custody_lineage() != custody_lineage
        || receipt.binding().authority_id() != authority_id
    {
        return Err(malformed_input(
            "tenant-root active-state response receipt does not match the request authority",
        ));
    }
    let response_receipt_digest = decode_lifecycle_receipt_digest(
        "tenant-root active-state response receipt digest",
        &response.activation_receipt_digest_b64u,
    )?;
    if response_receipt_digest != receipt.digest() {
        return Err(malformed_input(
            "tenant-root active-state response receipt digest does not match its receipt",
        ));
    }
    if response.lifecycle_revision == 0
        || response.lifecycle_revision < receipt.result_control_plane_revision()
    {
        return Err(malformed_input(
            "tenant-root active-state response lifecycle revision is invalid",
        ));
    }
    validate_refresh_fence(&response.fence)?;
    validate_managed_restore_fence_shape(&response.managed_restore_fence)?;
    validate_refresh_job_read_v1(response.job.as_ref())?;
    if let Some(pending) = &response.refresh_pending {
        validate_refresh_pending_v1(pending)?;
    }
    Ok(CloudflareVerifiedTenantRootActiveStateV1 {
        activation_receipt: receipt,
        job: response.job,
        last_manual_refresh_completed_at_ms: response.last_manual_refresh_completed_at_ms,
        last_refresh_completed_at_ms: response.last_refresh_completed_at_ms,
        lifecycle_revision: response.lifecycle_revision,
        refresh_fence: response.fence,
        managed_restore_fence: response.managed_restore_fence,
        delivery: response.delivery,
        refresh_pending: response.refresh_pending,
    })
}

/// Records that one Deriver has activated the committed receipt with this
/// digest. An acknowledgement for a receipt that is no longer committed
/// changes nothing.
pub(crate) async fn tenant_root_record_delivery_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    activation_receipt_digest_b64u: String,
    role: TwoPartyDeriverRole,
    swap: Option<CloudflareTenantRootSwapAcknowledgementV1>,
) -> RouterAbProtocolResult<CloudflareVerifiedTenantRootActiveStateV1> {
    active_state_record_call_v1(
        state,
        issuer_keys,
        identity_digest,
        custody_lineage,
        "tenant-root delivery record",
        CloudflareTenantRootCreationActiveStateReadRequestV1::RecordDelivery {
            identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: custody_lineage.to_base64url(),
            activation_receipt_digest_b64u,
            role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(role),
            swap,
        },
    )
    .await
}

/// Records that one Deriver erased a retired epoch the record of the
/// committed swap with this digest holds: the swap's own, or one it carries.
/// A report for another receipt, or of an erasure already recorded, changes
/// nothing.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn tenant_root_record_retirement_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    activation_receipt_digest_b64u: String,
    role: TwoPartyDeriverRole,
    retired_epoch: u64,
    erasure: CloudflareTenantRootRetiredErasureV1,
) -> RouterAbProtocolResult<CloudflareVerifiedTenantRootActiveStateV1> {
    active_state_record_call_v1(
        state,
        issuer_keys,
        identity_digest,
        custody_lineage,
        "tenant-root retirement record",
        CloudflareTenantRootCreationActiveStateReadRequestV1::RecordRetirement {
            identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: custody_lineage.to_base64url(),
            activation_receipt_digest_b64u,
            role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(role),
            retired_epoch,
            erasure,
        },
    )
    .await
}

pub(super) async fn active_state_record_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    label: &'static str,
    request: CloudflareTenantRootCreationActiveStateReadRequestV1,
) -> RouterAbProtocolResult<CloudflareVerifiedTenantRootActiveStateV1> {
    let authority_id = state.creation_authority_id(identity_digest, custody_lineage)?;
    let response: CloudflareTenantRootCreationActiveStateReadResponseV1 = state
        .creation_state_call(
            authority_id,
            identity_digest,
            custody_lineage,
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
            label,
            &request,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1,
        )
        .await?;
    decode_verified_active_state_response_v1(
        issuer_keys,
        authority_id,
        identity_digest,
        custody_lineage,
        response,
    )
}
