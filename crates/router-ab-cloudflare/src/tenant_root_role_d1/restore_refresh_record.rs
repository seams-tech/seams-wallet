//! Validated restore-refresh records and provider-promotion lifecycle states.

use super::*;

/// Lifecycle of one role-local refresh attempt after restore import.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1 {
    Pending,
    Refreshed,
    Closed,
}

impl CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1 {
    pub(super) fn parse(value: &str) -> RoleStoreResult<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "refreshed" => Ok(Self::Refreshed),
            "closed" => Ok(Self::Closed),
            _ => Err(store_error(
                "tenant-root restore refresh attempt lifecycle is invalid",
            )),
        }
    }
}

/// Lifecycle of the provider promotion attached to one refreshed attempt.
///
/// Promotion state lives on the refresh-attempt row so the staged share,
/// provider ciphertext, and canary have one durable replay boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootRestoreRefreshPromotionLifecycleV1 {
    Unstarted,
    Reserved,
    Completed,
}

impl CloudflareTenantRootRestoreRefreshPromotionLifecycleV1 {
    pub(super) fn parse(value: &str) -> RoleStoreResult<Self> {
        match value {
            "unstarted" => Ok(Self::Unstarted),
            "reserved" => Ok(Self::Reserved),
            "completed" => Ok(Self::Completed),
            _ => Err(store_error(
                "tenant-root restore refresh promotion lifecycle is invalid",
            )),
        }
    }
}

/// The exact staged share and evidence loaded for one promotion reservation.
pub(crate) struct CloudflareTenantRootRestoreRefreshPromotionSourceV1 {
    pub(super) refreshed_share: SigningRootShareWire,
    pub(super) evidence_bytes: Vec<u8>,
    pub(super) refreshed_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshPromotionSourceV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshPromotionSourceV1")
            .field("refreshed_share", &"[redacted]")
            .field("evidence_bytes", &self.evidence_bytes.len())
            .field("refreshed_at_ms", &self.refreshed_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreRefreshPromotionSourceV1 {
    pub(crate) fn into_parts(self) -> (SigningRootShareWire, Vec<u8>, u64) {
        (
            self.refreshed_share,
            self.evidence_bytes,
            self.refreshed_at_ms,
        )
    }
}

/// Provider bytes and public canary retained after a promotion completes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1 {
    pub(super) provider_ciphertext: Vec<u8>,
    pub(super) provider_binding_aad: Vec<u8>,
    pub(super) provider_canary_receipt_bytes: Vec<u8>,
    pub(super) completed_at_ms: u64,
}

impl CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1 {
    pub(crate) fn provider_ciphertext(&self) -> &[u8] {
        &self.provider_ciphertext
    }

    pub(crate) fn provider_binding_aad(&self) -> &[u8] {
        &self.provider_binding_aad
    }

    pub(crate) fn provider_canary_receipt_bytes(&self) -> &[u8] {
        &self.provider_canary_receipt_bytes
    }

    pub(crate) const fn completed_at_ms(&self) -> u64 {
        self.completed_at_ms
    }
}

/// Decision returned by the durable promotion reservation.
pub(crate) enum CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1 {
    Execute {
        source: CloudflareTenantRootRestoreRefreshPromotionSourceV1,
    },
    Resume {
        source: CloudflareTenantRootRestoreRefreshPromotionSourceV1,
    },
    Replay {
        artifacts: CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1,
    },
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self {
            Self::Execute { .. } => "execute",
            Self::Resume { .. } => "resume",
            Self::Replay { .. } => "replay",
        };
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1")
            .field("kind", &kind)
            .finish()
    }
}

/// Outcome returned after provider output and canary persistence.
pub(crate) enum CloudflareTenantRootRestoreRefreshPromotionCompletionV1 {
    Committed {
        artifacts: CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1,
    },
    Replay {
        artifacts: CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1,
    },
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshPromotionCompletionV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self {
            Self::Committed { .. } => "committed",
            Self::Replay { .. } => "replay",
        };
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshPromotionCompletionV1")
            .field("kind", &kind)
            .finish()
    }
}

/// Result of durable restore-refresh admission before peer contact.
pub(crate) enum CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1 {
    /// The first request owns the sampled replay seed.
    Execute {
        replay_seed: zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]>,
        admitted_at_ms: u64,
    },
    /// A retry owns the already persisted replay seed.
    Resume {
        replay_seed: zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]>,
        admitted_at_ms: u64,
    },
    /// The refresh was already durably staged; the caller can replay the exact
    /// evidence and reconstruct any request-local contribution from the same seed.
    Refreshed {
        replay_seed: zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]>,
        admitted_at_ms: u64,
        evidence_bytes: Vec<u8>,
    },
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self {
            Self::Execute { .. } => "execute",
            Self::Resume { .. } => "resume",
            Self::Refreshed { .. } => "refreshed",
        };
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1")
            .field("kind", &kind)
            .field("admitted_at_ms", &self.admitted_at_ms())
            .field(
                "evidence_bytes",
                &match self {
                    Self::Refreshed { evidence_bytes, .. } => Some(evidence_bytes.len()),
                    _ => None,
                },
            )
            .finish()
    }
}

impl CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1 {
    pub(crate) const fn admitted_at_ms(&self) -> u64 {
        match self {
            Self::Execute { admitted_at_ms, .. }
            | Self::Resume { admitted_at_ms, .. }
            | Self::Refreshed { admitted_at_ms, .. } => *admitted_at_ms,
        }
    }

    pub(crate) fn seed(
        &self,
    ) -> &zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]> {
        match self {
            Self::Execute { replay_seed, .. }
            | Self::Resume { replay_seed, .. }
            | Self::Refreshed { replay_seed, .. } => replay_seed,
        }
    }
}

/// The exact accepted import and issuer command selected by one restore
/// refresh attempt. The import binding is copied into the attempt row so a
/// later request cannot rebind a durable seed to another accepted import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1 {
    pub(super) import_binding: CloudflareTenantRootRestoreImportKeyBindingV1,
    pub(super) command_digest: [u8; 32],
    pub(super) issued_at_ms: u64,
    pub(super) expires_at_ms: u64,
    pub(super) admitted_at_ms: u64,
}

impl CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1 {
    pub(crate) fn new(
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        command_digest: [u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
        admitted_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        record.validate()?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed {
            return Err(store_error(
                "tenant-root restore refresh requires an accepted import",
            ));
        }
        Self::from_import_binding(
            record.binding.clone(),
            command_digest,
            issued_at_ms,
            expires_at_ms,
            admitted_at_ms,
        )
    }

    pub(super) fn from_import_binding(
        import_binding: CloudflareTenantRootRestoreImportKeyBindingV1,
        command_digest: [u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
        admitted_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        import_binding.validate()?;
        require_nonzero_bytes(
            "tenant-root restore refresh command digest",
            &command_digest,
        )?;
        require_timestamp(
            "tenant-root restore refresh command issue timestamp",
            issued_at_ms,
        )?;
        require_timestamp(
            "tenant-root restore refresh command expiry timestamp",
            expires_at_ms,
        )?;
        require_timestamp(
            "tenant-root restore refresh admission timestamp",
            admitted_at_ms,
        )?;
        if expires_at_ms <= issued_at_ms {
            return Err(store_error(
                "tenant-root restore refresh command lifetime is invalid",
            ));
        }
        Ok(Self {
            import_binding,
            command_digest,
            issued_at_ms,
            expires_at_ms,
            admitted_at_ms,
        })
    }

    pub(crate) const fn import_binding(&self) -> &CloudflareTenantRootRestoreImportKeyBindingV1 {
        &self.import_binding
    }

    pub(crate) const fn command_digest(&self) -> &[u8; 32] {
        &self.command_digest
    }

    pub(crate) const fn issued_at_ms(&self) -> u64 {
        self.issued_at_ms
    }

    pub(crate) const fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub(crate) const fn admitted_at_ms(&self) -> u64 {
        self.admitted_at_ms
    }
}

/// One role-local durable restore-refresh attempt. Secret fields are always
/// represented as authenticated ciphertext and omitted from Debug output.
pub(crate) struct CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1 {
    pub(super) binding: CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
    pub(super) encrypted_seed_json: Option<String>,
    pub(super) encrypted_refreshed_share_json: Option<String>,
    pub(super) installation_evidence_b64u: Option<String>,
    pub(super) installation_evidence_digest: Option<[u8; 32]>,
    pub(super) lifecycle: CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1,
    pub(super) refreshed_at_ms: Option<u64>,
    pub(super) promotion_lifecycle: CloudflareTenantRootRestoreRefreshPromotionLifecycleV1,
    pub(super) promotion_reserved_at_ms: Option<u64>,
    pub(super) encrypted_online_role_share_json: Option<String>,
    pub(super) provider_canary_receipt_b64u: Option<String>,
    pub(super) promotion_completed_at_ms: Option<u64>,
    pub(super) created_at_ms: u64,
    pub(super) updated_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1")
            .field("binding", &self.binding)
            .field(
                "encrypted_seed_json",
                &self.encrypted_seed_json.as_ref().map(|_| "[redacted]"),
            )
            .field(
                "encrypted_refreshed_share_json",
                &self
                    .encrypted_refreshed_share_json
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field(
                "installation_evidence_digest",
                &self.installation_evidence_digest,
            )
            .field("lifecycle", &self.lifecycle)
            .field("refreshed_at_ms", &self.refreshed_at_ms)
            .field("promotion_lifecycle", &self.promotion_lifecycle)
            .field("promotion_reserved_at_ms", &self.promotion_reserved_at_ms)
            .field(
                "encrypted_online_role_share_json",
                &self
                    .encrypted_online_role_share_json
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field(
                "provider_canary_receipt_b64u",
                &self
                    .provider_canary_receipt_b64u
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field("promotion_completed_at_ms", &self.promotion_completed_at_ms)
            .field("created_at_ms", &self.created_at_ms)
            .field("updated_at_ms", &self.updated_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1 {
    pub(crate) const fn binding(&self) -> &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1 {
        &self.binding
    }

    pub(crate) const fn lifecycle(
        &self,
    ) -> CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1 {
        self.lifecycle
    }

    pub(crate) fn installation_evidence_bytes(&self) -> RoleStoreResult<Vec<u8>> {
        let encoded = self.installation_evidence_b64u.as_deref().ok_or_else(|| {
            store_error("tenant-root restore refresh attempt has no installation evidence")
        })?;
        let bytes =
            decode_base64url_bytes_v1("tenant-root restore refresh installation evidence", encoded)
                .map_err(|error| store_error(error.message()))?;
        if bytes.is_empty()
            || bytes.len()
                > router_ab_core::TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1
            || encode_base64url_bytes_v1(&bytes) != encoded
            || self.installation_evidence_digest != Some(Sha256::digest(&bytes).into())
        {
            return Err(store_error(
                "tenant-root restore refresh installation evidence is malformed",
            ));
        }
        Ok(bytes)
    }

    pub(crate) const fn refreshed_at_ms(&self) -> Option<u64> {
        self.refreshed_at_ms
    }

    pub(crate) const fn promotion_lifecycle(
        &self,
    ) -> CloudflareTenantRootRestoreRefreshPromotionLifecycleV1 {
        self.promotion_lifecycle
    }

    pub(crate) const fn promotion_reserved_at_ms(&self) -> Option<u64> {
        self.promotion_reserved_at_ms
    }

    pub(super) fn encrypted_online_role_share_json(&self) -> RoleStoreResult<&str> {
        self.encrypted_online_role_share_json
            .as_deref()
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion has no provider ciphertext")
            })
    }

    pub(super) fn provider_canary_receipt_b64u(&self) -> RoleStoreResult<&str> {
        self.provider_canary_receipt_b64u.as_deref().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no provider canary")
        })
    }

    pub(crate) const fn promotion_completed_at_ms(&self) -> Option<u64> {
        self.promotion_completed_at_ms
    }

    pub(super) fn encrypted_seed_json(&self) -> RoleStoreResult<&str> {
        self.encrypted_seed_json
            .as_deref()
            .ok_or_else(|| store_error("tenant-root restore refresh attempt has no replay seed"))
    }

    pub(super) fn encrypted_refreshed_share_json(&self) -> RoleStoreResult<&str> {
        self.encrypted_refreshed_share_json
            .as_deref()
            .ok_or_else(|| {
                store_error("tenant-root restore refresh attempt has no refreshed share")
            })
    }

    pub(super) fn installation_evidence_digest(&self) -> Option<[u8; 32]> {
        self.installation_evidence_digest
    }

    pub(super) fn matches_request(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        command_digest: &[u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> bool {
        self.binding.import_binding == record.binding
            && self.binding.command_digest == *command_digest
            && self.binding.issued_at_ms == issued_at_ms
            && self.binding.expires_at_ms == expires_at_ms
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        self.binding.import_binding.validate()?;
        if self.created_at_ms != 0 || self.updated_at_ms != 0 {
            if self.created_at_ms == 0
                || self.updated_at_ms < self.created_at_ms
                || self.updated_at_ms > i64::MAX as u64
            {
                return Err(store_error(
                    "tenant-root restore refresh attempt timestamps are invalid",
                ));
            }
        }
        match self.lifecycle {
            CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Pending => {
                if self.encrypted_seed_json.is_none()
                    || self.encrypted_refreshed_share_json.is_some()
                    || self.installation_evidence_b64u.is_some()
                    || self.installation_evidence_digest.is_some()
                    || self.refreshed_at_ms.is_some()
                    || self.promotion_lifecycle
                        != CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted
                    || self.promotion_reserved_at_ms.is_some()
                    || self.encrypted_online_role_share_json.is_some()
                    || self.provider_canary_receipt_b64u.is_some()
                    || self.promotion_completed_at_ms.is_some()
                {
                    return Err(store_error(
                        "pending tenant-root restore refresh attempt is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed => {
                if self.encrypted_seed_json.is_none()
                    || self.encrypted_refreshed_share_json.is_none()
                    || self.installation_evidence_b64u.is_none()
                    || self.installation_evidence_digest.is_none()
                    || self.refreshed_at_ms.is_none()
                {
                    return Err(store_error(
                        "refreshed tenant-root restore refresh attempt is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed => {
                if self.encrypted_seed_json.is_some()
                    || self.encrypted_refreshed_share_json.is_some()
                    || self.installation_evidence_b64u.is_some()
                    || self.installation_evidence_digest.is_some()
                    || self.refreshed_at_ms.is_some()
                    || self.promotion_lifecycle
                        != CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted
                    || self.promotion_reserved_at_ms.is_some()
                    || self.encrypted_online_role_share_json.is_some()
                    || self.provider_canary_receipt_b64u.is_some()
                    || self.promotion_completed_at_ms.is_some()
                {
                    return Err(store_error(
                        "closed tenant-root restore refresh attempt retains secret state",
                    ));
                }
            }
        }
        match self.promotion_lifecycle {
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted => {
                if self.promotion_reserved_at_ms.is_some()
                    || self.encrypted_online_role_share_json.is_some()
                    || self.provider_canary_receipt_b64u.is_some()
                    || self.promotion_completed_at_ms.is_some()
                {
                    return Err(store_error(
                        "unstarted tenant-root restore refresh promotion is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Reserved => {
                let Some(reserved_at_ms) = self.promotion_reserved_at_ms else {
                    return Err(store_error(
                        "reserved tenant-root restore refresh promotion has no reservation timestamp",
                    ));
                };
                require_timestamp(
                    "tenant-root restore refresh promotion reservation timestamp",
                    reserved_at_ms,
                )?;
                if self.lifecycle
                    != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
                    || self.encrypted_online_role_share_json.is_some()
                    || self.provider_canary_receipt_b64u.is_some()
                    || self.promotion_completed_at_ms.is_some()
                {
                    return Err(store_error(
                        "reserved tenant-root restore refresh promotion is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed => {
                let Some(reserved_at_ms) = self.promotion_reserved_at_ms else {
                    return Err(store_error(
                        "completed tenant-root restore refresh promotion has no reservation timestamp",
                    ));
                };
                let Some(completed_at_ms) = self.promotion_completed_at_ms else {
                    return Err(store_error(
                        "completed tenant-root restore refresh promotion has no completion timestamp",
                    ));
                };
                require_timestamp(
                    "tenant-root restore refresh promotion reservation timestamp",
                    reserved_at_ms,
                )?;
                require_timestamp(
                    "tenant-root restore refresh promotion completion timestamp",
                    completed_at_ms,
                )?;
                if self.lifecycle
                    != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
                    || self.encrypted_online_role_share_json.is_none()
                    || self.provider_canary_receipt_b64u.is_none()
                {
                    return Err(store_error(
                        "completed tenant-root restore refresh promotion is incomplete",
                    ));
                }
                let encrypted_output =
                    self.encrypted_online_role_share_json().map_err(|error| {
                        store_error(format!(
                        "completed tenant-root restore refresh promotion output is invalid: {error}"
                    ))
                    })?;
                if encrypted_output.len() > 8 * 1024 {
                    return Err(store_error(
                        "tenant-root restore refresh promotion ciphertext JSON exceeds its size limit",
                    ));
                }
                let canary_encoded = self.provider_canary_receipt_b64u()?;
                let canary_bytes = decode_base64url_bytes_v1(
                    "tenant-root restore refresh provider canary",
                    canary_encoded,
                )
                .map_err(|error| store_error(error.message()))?;
                if canary_bytes.is_empty()
                    || canary_bytes.len() > TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1
                    || encode_base64url_bytes_v1(&canary_bytes) != canary_encoded
                {
                    return Err(store_error(
                        "tenant-root restore refresh provider canary is malformed",
                    ));
                }
                TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&canary_bytes)
                    .map_err(|error| store_error(error.message()))?;
            }
        }
        Ok(())
    }
}
