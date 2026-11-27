//! Destination bootstrap records, requests, validation and evaluation.

use super::*;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootDestinationBootstrapRecordV1 {
    pub(crate) identity_b64u: String,
    pub(crate) deployment_fingerprint_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) token_digest_b64u: String,
}

/// Public terminal record left after the bootstrap authority is consumed by
/// a successful restore activation. It intentionally contains no token
/// digest, so the old bearer credential cannot authorize a later request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootDestinationBootstrapDestroyedRecordV1 {
    pub(crate) identity_b64u: String,
    pub(crate) deployment_fingerprint_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) activation_receipt_digest_b64u: String,
    pub(crate) destruction_receipt_b64u: String,
    pub(crate) destruction_receipt_digest_b64u: String,
}

impl fmt::Debug for CloudflareTenantRootDestinationBootstrapRecordV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootDestinationBootstrapRecordV1")
            .field("identity_b64u", &self.identity_b64u)
            .field(
                "deployment_fingerprint_b64u",
                &self.deployment_fingerprint_b64u,
            )
            .field("custody_lineage_b64u", &self.custody_lineage_b64u)
            .field("token_digest_b64u", &"[redacted]")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootDestinationBootstrapRequestV1 {
    Read {
        identity_b64u: String,
        custody_lineage_b64u: String,
    },
    Authenticate {
        identity_b64u: String,
        deployment_fingerprint_b64u: String,
        custody_lineage_b64u: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareTenantRootDestinationBootstrapRefusalV1 {
    Uninitialized,
    CreationInProgress,
    ActiveRootPresent,
    Destroyed,
    ScopeMismatch,
    AuthenticationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootDestinationBootstrapScopeV1 {
    pub(crate) identity_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) deployment_fingerprint_b64u: String,
    pub(crate) custody_lineage_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootDestinationBootstrapResponseV1 {
    ReadReady {
        scope: CloudflareTenantRootDestinationBootstrapScopeV1,
    },
    ReadRefused {
        reason: CloudflareTenantRootDestinationBootstrapRefusalV1,
    },
    Authenticated {
        scope: CloudflareTenantRootDestinationBootstrapScopeV1,
        authenticated_at_ms: u64,
    },
    AuthenticationRefused {
        reason: CloudflareTenantRootDestinationBootstrapRefusalV1,
    },
}

#[derive(Clone)]
pub(super) struct ValidatedTenantRootDestinationBootstrapRecordV1 {
    pub(super) record: CloudflareTenantRootDestinationBootstrapRecordV1,
    pub(super) identity_digest: TenantRootIdentityDigestV1,
    pub(super) deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    pub(super) custody_lineage: TenantRootCustodyLineageId,
    pub(super) authority: DestinationBootstrapAuthorityV1,
}

#[derive(Clone)]
pub(super) struct ValidatedTenantRootDestinationBootstrapDestroyedRecordV1 {
    pub(super) record: CloudflareTenantRootDestinationBootstrapDestroyedRecordV1,
    pub(super) identity_digest: TenantRootIdentityDigestV1,
    pub(super) deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    pub(super) custody_lineage: TenantRootCustodyLineageId,
}

pub(super) enum ValidatedTenantRootDestinationBootstrapRequestV1 {
    Read {
        identity_b64u: String,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    },
    Authenticate {
        identity_b64u: String,
        identity_digest: TenantRootIdentityDigestV1,
        deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        custody_lineage: TenantRootCustodyLineageId,
    },
}

pub(super) enum TenantRootDestinationBootstrapStateV1 {
    Uninitialized,
    ScopeMismatch,
    Ready(ValidatedTenantRootDestinationBootstrapRecordV1),
    CreationInProgress(ValidatedTenantRootDestinationBootstrapRecordV1),
    ActiveRootPresent(ValidatedTenantRootDestinationBootstrapRecordV1),
    Destroyed(ValidatedTenantRootDestinationBootstrapDestroyedRecordV1),
}

pub(super) fn validate_tenant_root_destination_bootstrap_record_v1(
    record: CloudflareTenantRootDestinationBootstrapRecordV1,
) -> RouterAbProtocolResult<ValidatedTenantRootDestinationBootstrapRecordV1> {
    let record_wire_bytes = record
        .identity_b64u
        .len()
        .saturating_add(record.deployment_fingerprint_b64u.len())
        .saturating_add(record.custody_lineage_b64u.len())
        .saturating_add(record.token_digest_b64u.len());
    if record_wire_bytes > TENANT_ROOT_DESTINATION_BOOTSTRAP_RECORD_MAX_BYTES_V1 {
        return Err(malformed_input(
            "tenant-root destination bootstrap record exceeds its maximum size",
        ));
    }
    let identity_bytes = decode_canonical_base64url(
        "tenant-root destination bootstrap identity",
        &record.identity_b64u,
        TENANT_ROOT_DESTINATION_BOOTSTRAP_IDENTITY_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_DESTINATION_BOOTSTRAP_IDENTITY_MAX_BYTES_V1),
    )?;
    let identity = TenantRootIdentityV1::decode_canonical_bytes(&identity_bytes)
        .map_err(candidate_derivation_error)?;
    let identity_digest = identity.digest().map_err(candidate_derivation_error)?;
    let deployment_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes(decode_fixed_base64url_32(
            "tenant-root destination bootstrap deployment fingerprint",
            &record.deployment_fingerprint_b64u,
        )?)
        .map_err(candidate_derivation_error)?;
    let custody_lineage = decode_lineage_b64u(
        "tenant-root destination bootstrap custody lineage",
        &record.custody_lineage_b64u,
    )?;
    let authority = DestinationBootstrapAuthorityV1::from_persisted_digest(
        deployment_fingerprint,
        decode_fixed_base64url_32(
            "tenant-root destination bootstrap token digest",
            &record.token_digest_b64u,
        )?,
    )
    .map_err(candidate_derivation_error)?;
    Ok(ValidatedTenantRootDestinationBootstrapRecordV1 {
        record,
        identity_digest,
        deployment_fingerprint,
        custody_lineage,
        authority,
    })
}

pub(super) fn validate_tenant_root_destination_bootstrap_destroyed_record_v1(
    record: CloudflareTenantRootDestinationBootstrapDestroyedRecordV1,
) -> RouterAbProtocolResult<ValidatedTenantRootDestinationBootstrapDestroyedRecordV1> {
    let record_wire_bytes = record
        .identity_b64u
        .len()
        .saturating_add(record.deployment_fingerprint_b64u.len())
        .saturating_add(record.custody_lineage_b64u.len())
        .saturating_add(record.activation_receipt_digest_b64u.len())
        .saturating_add(record.destruction_receipt_b64u.len())
        .saturating_add(record.destruction_receipt_digest_b64u.len());
    if record_wire_bytes > TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTROYED_RECORD_MAX_BYTES_V1 {
        return Err(malformed_input(
            "tenant-root destination bootstrap destruction record exceeds its maximum size",
        ));
    }
    let identity_bytes = decode_canonical_base64url(
        "tenant-root destroyed bootstrap identity",
        &record.identity_b64u,
        TENANT_ROOT_DESTINATION_BOOTSTRAP_IDENTITY_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_DESTINATION_BOOTSTRAP_IDENTITY_MAX_BYTES_V1),
    )?;
    let identity = TenantRootIdentityV1::decode_canonical_bytes(&identity_bytes)
        .map_err(candidate_derivation_error)?;
    let identity_digest = identity.digest().map_err(candidate_derivation_error)?;
    let canonical_identity_b64u = encode_base64url_bytes_v1(&identity_bytes);
    if canonical_identity_b64u != record.identity_b64u {
        return Err(malformed_input(
            "tenant-root destroyed bootstrap identity is not canonical",
        ));
    }
    let deployment_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes(decode_fixed_base64url_32(
            "tenant-root destroyed bootstrap deployment fingerprint",
            &record.deployment_fingerprint_b64u,
        )?)
        .map_err(candidate_derivation_error)?;
    let custody_lineage = decode_lineage_b64u(
        "tenant-root destroyed bootstrap custody lineage",
        &record.custody_lineage_b64u,
    )?;
    let activation_digest =
        TenantRootLifecycleReceiptDigestV1::from_bytes(decode_fixed_base64url_32(
            "tenant-root destroyed bootstrap activation receipt digest",
            &record.activation_receipt_digest_b64u,
        )?)
        .map_err(candidate_derivation_error)?;
    let destruction_receipt_bytes = decode_canonical_base64url(
        "tenant-root bootstrap destruction receipt",
        &record.destruction_receipt_b64u,
        32,
        base64url_len_for_bytes(32),
    )?;
    if destruction_receipt_bytes.len() != 32
        || encode_base64url_bytes_v1(&destruction_receipt_bytes) != record.destruction_receipt_b64u
    {
        return Err(malformed_input(
            "tenant-root bootstrap destruction receipt is invalid",
        ));
    }
    let expected_destruction_digest = Sha256::digest(&destruction_receipt_bytes);
    if encode_base64url_bytes_v1(&expected_destruction_digest)
        != record.destruction_receipt_digest_b64u
    {
        return Err(malformed_input(
            "tenant-root bootstrap destruction receipt digest is invalid",
        ));
    }
    if activation_digest.as_bytes().iter().all(|byte| *byte == 0) {
        return Err(malformed_input(
            "tenant-root destroyed bootstrap activation receipt digest is invalid",
        ));
    }
    Ok(ValidatedTenantRootDestinationBootstrapDestroyedRecordV1 {
        record,
        identity_digest,
        deployment_fingerprint,
        custody_lineage,
    })
}

pub(super) fn validate_tenant_root_destination_bootstrap_request_v1(
    request: CloudflareTenantRootDestinationBootstrapRequestV1,
) -> RouterAbProtocolResult<ValidatedTenantRootDestinationBootstrapRequestV1> {
    match request {
        CloudflareTenantRootDestinationBootstrapRequestV1::Read {
            identity_b64u,
            custody_lineage_b64u,
        } => {
            let (identity_b64u, identity_digest, custody_lineage) =
                validate_destination_bootstrap_identity_and_lineage_v1(
                    identity_b64u,
                    custody_lineage_b64u,
                )?;
            Ok(ValidatedTenantRootDestinationBootstrapRequestV1::Read {
                identity_b64u,
                identity_digest,
                custody_lineage,
            })
        }
        CloudflareTenantRootDestinationBootstrapRequestV1::Authenticate {
            identity_b64u,
            deployment_fingerprint_b64u,
            custody_lineage_b64u,
        } => {
            let (identity_b64u, identity_digest, custody_lineage) =
                validate_destination_bootstrap_identity_and_lineage_v1(
                    identity_b64u,
                    custody_lineage_b64u,
                )?;
            let deployment_fingerprint =
                TenantRootRestoreDestinationFingerprintV1::from_bytes(decode_fixed_base64url_32(
                    "tenant-root destination bootstrap request deployment fingerprint",
                    &deployment_fingerprint_b64u,
                )?)
                .map_err(candidate_derivation_error)?;
            Ok(
                ValidatedTenantRootDestinationBootstrapRequestV1::Authenticate {
                    identity_b64u,
                    identity_digest,
                    deployment_fingerprint,
                    custody_lineage,
                },
            )
        }
    }
}

pub(super) fn validate_destination_bootstrap_identity_and_lineage_v1(
    identity_b64u: String,
    custody_lineage_b64u: String,
) -> RouterAbProtocolResult<(
    String,
    TenantRootIdentityDigestV1,
    TenantRootCustodyLineageId,
)> {
    let identity_bytes = decode_canonical_base64url(
        "tenant-root destination bootstrap request identity",
        &identity_b64u,
        TENANT_ROOT_DESTINATION_BOOTSTRAP_IDENTITY_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_DESTINATION_BOOTSTRAP_IDENTITY_MAX_BYTES_V1),
    )?;
    let identity = TenantRootIdentityV1::decode_canonical_bytes(&identity_bytes)
        .map_err(candidate_derivation_error)?;
    let identity_digest = identity.digest().map_err(candidate_derivation_error)?;
    let canonical_identity_b64u = encode_base64url_bytes_v1(&identity_bytes);
    let custody_lineage = decode_lineage_b64u(
        "tenant-root destination bootstrap request custody lineage",
        &custody_lineage_b64u,
    )?;
    Ok((canonical_identity_b64u, identity_digest, custody_lineage))
}

pub(super) fn destination_bootstrap_request_scope_v1(
    request: &ValidatedTenantRootDestinationBootstrapRequestV1,
) -> (TenantRootIdentityDigestV1, TenantRootCustodyLineageId) {
    match request {
        ValidatedTenantRootDestinationBootstrapRequestV1::Read {
            identity_digest,
            custody_lineage,
            ..
        }
        | ValidatedTenantRootDestinationBootstrapRequestV1::Authenticate {
            identity_digest,
            custody_lineage,
            ..
        } => (*identity_digest, *custody_lineage),
    }
}

/// Validates the public bootstrap request shape and derives the object scope
/// used by the strict Router forwarding boundary.
pub(crate) fn destination_bootstrap_request_scope_from_wire_v1(
    request: &CloudflareTenantRootDestinationBootstrapRequestV1,
) -> RouterAbProtocolResult<(TenantRootIdentityDigestV1, TenantRootCustodyLineageId)> {
    let validated = validate_tenant_root_destination_bootstrap_request_v1(request.clone())?;
    Ok(destination_bootstrap_request_scope_v1(&validated))
}

impl ValidatedTenantRootDestinationBootstrapRecordV1 {
    pub(super) fn matches_request_scope(
        &self,
        request: &ValidatedTenantRootDestinationBootstrapRequestV1,
    ) -> bool {
        let (identity_digest, custody_lineage) = destination_bootstrap_request_scope_v1(request);
        let identity_b64u = match request {
            ValidatedTenantRootDestinationBootstrapRequestV1::Read { identity_b64u, .. }
            | ValidatedTenantRootDestinationBootstrapRequestV1::Authenticate {
                identity_b64u,
                ..
            } => identity_b64u,
        };
        self.identity_digest == identity_digest
            && self.custody_lineage == custody_lineage
            && self.record.identity_b64u == *identity_b64u
    }

    pub(super) fn scope(&self) -> CloudflareTenantRootDestinationBootstrapScopeV1 {
        CloudflareTenantRootDestinationBootstrapScopeV1 {
            identity_b64u: self.record.identity_b64u.clone(),
            identity_digest_b64u: encode_base64url_bytes_v1(self.identity_digest.as_bytes()),
            deployment_fingerprint_b64u: self.record.deployment_fingerprint_b64u.clone(),
            custody_lineage_b64u: self.record.custody_lineage_b64u.clone(),
        }
    }
}

impl ValidatedTenantRootDestinationBootstrapDestroyedRecordV1 {
    pub(super) fn matches_request_scope(
        &self,
        request: &ValidatedTenantRootDestinationBootstrapRequestV1,
    ) -> bool {
        let (identity_digest, custody_lineage) = destination_bootstrap_request_scope_v1(request);
        let identity_b64u = match request {
            ValidatedTenantRootDestinationBootstrapRequestV1::Read { identity_b64u, .. }
            | ValidatedTenantRootDestinationBootstrapRequestV1::Authenticate {
                identity_b64u,
                ..
            } => identity_b64u,
        };
        self.identity_digest == identity_digest
            && self.custody_lineage == custody_lineage
            && self.record.identity_b64u == *identity_b64u
    }
}

pub(super) fn destination_bootstrap_refused_response_v1(
    request: &ValidatedTenantRootDestinationBootstrapRequestV1,
    reason: CloudflareTenantRootDestinationBootstrapRefusalV1,
) -> CloudflareTenantRootDestinationBootstrapResponseV1 {
    match request {
        ValidatedTenantRootDestinationBootstrapRequestV1::Read { .. } => {
            CloudflareTenantRootDestinationBootstrapResponseV1::ReadRefused { reason }
        }
        ValidatedTenantRootDestinationBootstrapRequestV1::Authenticate { .. } => {
            CloudflareTenantRootDestinationBootstrapResponseV1::AuthenticationRefused { reason }
        }
    }
}

pub(super) fn evaluate_tenant_root_destination_bootstrap_request_v1(
    state: &TenantRootDestinationBootstrapStateV1,
    request: &ValidatedTenantRootDestinationBootstrapRequestV1,
    token: Option<&DestinationBootstrapTokenV1>,
    authenticated_at_ms: u64,
) -> CloudflareTenantRootDestinationBootstrapResponseV1 {
    let record = match state {
        TenantRootDestinationBootstrapStateV1::Uninitialized => {
            return destination_bootstrap_refused_response_v1(
                request,
                CloudflareTenantRootDestinationBootstrapRefusalV1::Uninitialized,
            )
        }
        TenantRootDestinationBootstrapStateV1::ScopeMismatch => {
            return destination_bootstrap_refused_response_v1(
                request,
                CloudflareTenantRootDestinationBootstrapRefusalV1::ScopeMismatch,
            )
        }
        TenantRootDestinationBootstrapStateV1::Ready(record)
        | TenantRootDestinationBootstrapStateV1::CreationInProgress(record)
        | TenantRootDestinationBootstrapStateV1::ActiveRootPresent(record) => record,
        TenantRootDestinationBootstrapStateV1::Destroyed(record) => {
            if !record.matches_request_scope(request) {
                return destination_bootstrap_refused_response_v1(
                    request,
                    CloudflareTenantRootDestinationBootstrapRefusalV1::ScopeMismatch,
                );
            }
            return destination_bootstrap_refused_response_v1(
                request,
                CloudflareTenantRootDestinationBootstrapRefusalV1::Destroyed,
            );
        }
    };
    if !record.matches_request_scope(request) {
        return destination_bootstrap_refused_response_v1(
            request,
            CloudflareTenantRootDestinationBootstrapRefusalV1::ScopeMismatch,
        );
    }
    let refusal = match state {
        TenantRootDestinationBootstrapStateV1::CreationInProgress(_) => {
            Some(CloudflareTenantRootDestinationBootstrapRefusalV1::CreationInProgress)
        }
        TenantRootDestinationBootstrapStateV1::ActiveRootPresent(_) => {
            Some(CloudflareTenantRootDestinationBootstrapRefusalV1::ActiveRootPresent)
        }
        TenantRootDestinationBootstrapStateV1::Ready(_)
        | TenantRootDestinationBootstrapStateV1::Uninitialized
        | TenantRootDestinationBootstrapStateV1::ScopeMismatch
        | TenantRootDestinationBootstrapStateV1::Destroyed(_) => None,
    };
    if let Some(reason) = refusal {
        return destination_bootstrap_refused_response_v1(request, reason);
    }
    match request {
        ValidatedTenantRootDestinationBootstrapRequestV1::Read { .. } => {
            CloudflareTenantRootDestinationBootstrapResponseV1::ReadReady {
                scope: record.scope(),
            }
        }
        ValidatedTenantRootDestinationBootstrapRequestV1::Authenticate {
            deployment_fingerprint,
            ..
        } => {
            if *deployment_fingerprint != record.deployment_fingerprint {
                return destination_bootstrap_refused_response_v1(
                    request,
                    CloudflareTenantRootDestinationBootstrapRefusalV1::ScopeMismatch,
                );
            }
            let Some(token) = token else {
                return destination_bootstrap_refused_response_v1(
                    request,
                    CloudflareTenantRootDestinationBootstrapRefusalV1::AuthenticationFailed,
                );
            };
            if record
                .authority
                .verify(record.deployment_fingerprint, token)
                .is_err()
            {
                return destination_bootstrap_refused_response_v1(
                    request,
                    CloudflareTenantRootDestinationBootstrapRefusalV1::AuthenticationFailed,
                );
            }
            CloudflareTenantRootDestinationBootstrapResponseV1::Authenticated {
                scope: record.scope(),
                authenticated_at_ms,
            }
        }
    }
}
