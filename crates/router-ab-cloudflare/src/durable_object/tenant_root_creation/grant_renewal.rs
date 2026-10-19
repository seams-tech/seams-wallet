//! Fences expired authorizations before an unused creation can be renewed.

use super::*;
#[cfg(feature = "workers-rs")]
use router_ab_core::TenantRootCreationGrantV1;

#[cfg(feature = "workers-rs")]
pub(crate) const RENEWAL_PATH: &str = "/router-ab/internal/tenant-root/creation/v1/renewal-fence";
const FENCE_KEY: &str = "creation/v1/authorization-fence";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthorizationFence {
    expired_through_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[cfg(feature = "workers-rs")]
pub(crate) enum RenewalOutcome {
    Started,
    RenewalPermitted {
        grant_digest_b64u: String,
        expired_through_ms: u64,
    },
}

#[cfg(feature = "workers-rs")]
async fn fence_unused_authorization<Store: TenantRootCreationStoreV1>(
    store: &Store,
    grant: &router_ab_core::VerifiedTenantRootCreationGrantV1,
    grant_digest_b64u: String,
    now_ms: u64,
) -> RouterAbProtocolResult<RenewalOutcome> {
    store.require_scope(grant.identity_digest(), grant.custody_lineage())?;
    if store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?
        .is_some()
    {
        return Ok(RenewalOutcome::Started);
    }
    if now_ms < grant.expires_at_ms() {
        return Err(malformed_input(
            "Tenant-root creation authorization is still valid",
        ));
    }
    let existing = store.get_json::<AuthorizationFence>(FENCE_KEY).await?;
    let expired_through_ms = existing.map_or(grant.expires_at_ms(), |fence| {
        fence.expired_through_ms.max(grant.expires_at_ms())
    });
    store
        .put_json(FENCE_KEY, &AuthorizationFence { expired_through_ms })
        .await?;
    Ok(RenewalOutcome::RenewalPermitted {
        grant_digest_b64u,
        expired_through_ms,
    })
}

/// Runs inside the same transaction as the initial journal write. An old
/// request cannot pass a renewal fence with a timestamp captured earlier.
async fn require_authorization_above_fence<Store: TenantRootCreationStoreV1>(
    store: &Store,
    candidate: &ValidatedTenantRootCreationJournalV1,
) -> RouterAbProtocolResult<()> {
    if let Some(fence) = store.get_json::<AuthorizationFence>(FENCE_KEY).await? {
        if candidate.ceremony_context.expires_at_ms() <= fence.expired_through_ms {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "Tenant-root creation authorization was fenced for renewal",
            ));
        }
    }
    Ok(())
}

/// Persists the started journal and its creation capability once.
pub async fn tenant_root_creation_persist_journal_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    request: CloudflareTenantRootCreationJournalRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalResponseV1> {
    let authority_id = store.authority_id();
    let candidate = validate_creation_record(request.into_record(), authority_id, issuer_keys)?;
    store.require_scope(candidate.identity_digest, candidate.custody_lineage)?;
    let existing = store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?;
    if existing.is_none() {
        require_authorization_above_fence(store, &candidate).await?;
    }
    match evaluate_creation_record(existing, candidate, authority_id, issuer_keys, now_ms)? {
        TenantRootCreationJournalEvaluationV1::Commit { record, response } => {
            store
                .put_json(TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1, &record)
                .await?;
            Ok(response)
        }
        TenantRootCreationJournalEvaluationV1::Replay(response) => Ok(response),
    }
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn renewal_call(
    env: &worker::Env,
    request: &crate::CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
) -> RouterAbProtocolResult<RenewalOutcome> {
    let bytes =
        decode_base64url_bytes_v1("tenant-root creation grant", &request.creation_grant_b64u)?;
    let grant = TenantRootCreationGrantV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)?;
    let (identity_digest, custody_lineage) =
        grant.claimed_scope().map_err(candidate_derivation_error)?;
    let (authority_id, _) =
        derive_tenant_root_creation_authority_object_v1(env, identity_digest, custody_lineage)?;
    execute_cloudflare_router_tenant_root_creation_private_call_v1(
        env,
        authority_id,
        identity_digest,
        custody_lineage,
        RENEWAL_PATH,
        "tenant-root creation authorization renewal",
        request,
        TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
        1024,
    )
    .await
}

#[cfg(feature = "workers-rs")]
impl RouterAbTenantRootCreationDurableObject {
    pub(super) async fn handle_creation_grant_route(
        &self,
        request: &mut worker::Request,
    ) -> Option<worker::Result<worker::Response>> {
        let path = request.path();
        if path != RENEWAL_PATH && path != CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_PATH {
            return None;
        }
        match request_has_json_content_type(request) {
            Ok(true) => {}
            Ok(false) => {
                return Some(worker::Response::error(
                    "Tenant-root creation request requires JSON",
                    415,
                ))
            }
            Err(error) => return Some(Err(error)),
        }
        let result = if path == RENEWAL_PATH {
            match decode_bounded_json_request::<
                crate::CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
            >(request, TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1)
            .await
            {
                Ok(parsed) => self
                    .fence_authorization(parsed)
                    .await
                    .and_then(serialize_outcome),
                Err(error) => Err(error),
            }
        } else {
            match decode_bounded_creation_request(request).await {
                Ok(parsed) => self.persist(parsed).await.and_then(serialize_outcome),
                Err(error) => Err(error),
            }
        };
        Some(match result {
            Ok(response) => Ok(response),
            Err(error) => tenant_root_creation_do_error_response(error),
        })
    }

    async fn fence_authorization(
        &self,
        request: crate::CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
    ) -> RouterAbProtocolResult<RenewalOutcome> {
        let bytes =
            decode_base64url_bytes_v1("tenant-root creation grant", &request.creation_grant_b64u)?;
        let grant = TenantRootCreationGrantV1::decode_canonical_bytes(&bytes)
            .map_err(candidate_derivation_error)?;
        let reader = crate::CloudflareWorkerEnvReaderV1::new(&self.env);
        let keys = crate::parse_cloudflare_tenant_root_creation_grant_authority_verifying_keys_v1(
            &reader,
        )?;
        let key = keys.for_grant_key_id(grant.grant_key_id()).ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "Tenant-root grant authority is not trusted",
            )
        })?;
        let verified = grant
            .verify(grant.grant_key_id(), key)
            .map_err(candidate_authorization_error)?;
        let digest = encode_base64url_bytes_v1(&Sha256::digest(&bytes));
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = fence_unused_authorization(&store, &verified, digest, now_ms).await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                captured.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "Authorization fence transaction returned no outcome",
            )
        })?;
        result
    }
}

#[cfg(feature = "workers-rs")]
fn serialize_outcome<T: Serialize>(value: T) -> RouterAbProtocolResult<worker::Response> {
    worker::Response::from_json(&value).map_err(durable_storage_protocol_error)
}
