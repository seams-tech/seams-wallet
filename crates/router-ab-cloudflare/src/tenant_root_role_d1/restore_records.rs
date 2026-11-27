//! Restore import-key lifecycle, bindings, records, row structs, cleanup receipts and session tombstones.

use super::*;

/// Lifecycle of one destination role import key retained in role-private D1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootRestoreImportKeyLifecycleV1 {
    Issued,
    Superseded,
    Installed,
    Expired,
    Closed,
}

impl CloudflareTenantRootRestoreImportKeyLifecycleV1 {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Issued => "issued",
            Self::Superseded => "superseded",
            Self::Installed => "installed",
            Self::Expired => "expired",
            Self::Closed => "closed",
        }
    }

    pub(super) fn parse(value: &str) -> RoleStoreResult<Self> {
        match value {
            "issued" => Ok(Self::Issued),
            "superseded" => Ok(Self::Superseded),
            "installed" => Ok(Self::Installed),
            "expired" => Ok(Self::Expired),
            "closed" => Ok(Self::Closed),
            _ => Err(store_error(
                "tenant-root restore import key lifecycle is invalid",
            )),
        }
    }
}

/// Immutable scope and public metadata signed by restore admission.
///
/// The private IKM is deliberately absent. It is generated and sealed only
/// after this binding has been verified at the Deriver boundary.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRestoreImportKeyBindingV1 {
    pub(super) identity_digest: TenantRootIdentityDigestV1,
    pub(super) custody_lineage: TenantRootCustodyLineageId,
    pub(super) restore_session_id: TenantRootRestoreSessionIdV1,
    pub(super) recovery_set_id: TenantRootRecoverySetId,
    pub(super) destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    pub(super) manifest_digest: [u8; 32],
    pub(super) stable_root_commitment: [u8; 32],
    pub(super) share_commitment: [u8; 34],
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) generation: u64,
    pub(super) import_key_id: String,
    pub(super) replay_key_digest: [u8; 32],
    pub(super) command_digest: [u8; 32],
    pub(super) operation_digest: [u8; 32],
    pub(super) import_public_key: TenantRootRestoreImportPublicKeyV1,
    pub(super) issued_at_ms: u64,
    pub(super) expires_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreImportKeyBindingV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreImportKeyBindingV1")
            .field("identity_digest", &self.identity_digest)
            .field("custody_lineage", &self.custody_lineage)
            .field("restore_session_id", &self.restore_session_id)
            .field("recovery_set_id", &self.recovery_set_id)
            .field("destination_fingerprint", &self.destination_fingerprint)
            .field("manifest_digest", &encode_hex(&self.manifest_digest))
            .field(
                "stable_root_commitment",
                &encode_hex(&self.stable_root_commitment),
            )
            .field("share_commitment", &encode_hex(&self.share_commitment))
            .field("role", &self.role)
            .field("generation", &self.generation)
            .field("import_key_id", &self.import_key_id)
            .field("replay_key_digest", &encode_hex(&self.replay_key_digest))
            .field("command_digest", &encode_hex(&self.command_digest))
            .field("operation_digest", &encode_hex(&self.operation_digest))
            .field("import_public_key", &self.import_public_key)
            .field("issued_at_ms", &self.issued_at_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreImportKeyBindingV1 {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        recovery_set_id: TenantRootRecoverySetId,
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        manifest_digest: [u8; 32],
        stable_root_commitment: [u8; 32],
        share_commitment: [u8; 34],
        role: CloudflareTenantRootDeriverRoleV1,
        generation: u64,
        import_key_id: impl Into<String>,
        replay_key_digest: [u8; 32],
        command_digest: [u8; 32],
        operation_digest: [u8; 32],
        import_public_key: TenantRootRestoreImportPublicKeyV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        let binding = Self {
            identity_digest,
            custody_lineage,
            restore_session_id,
            recovery_set_id,
            destination_fingerprint,
            manifest_digest,
            stable_root_commitment,
            share_commitment,
            role,
            generation,
            import_key_id: import_key_id.into(),
            replay_key_digest,
            command_digest,
            operation_digest,
            import_public_key,
            issued_at_ms,
            expires_at_ms,
        };
        binding.validate()?;
        Ok(binding)
    }

    pub(crate) const fn identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.identity_digest
    }

    pub(crate) const fn custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.custody_lineage
    }

    pub(crate) const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.restore_session_id
    }

    pub(crate) const fn recovery_set_id(&self) -> TenantRootRecoverySetId {
        self.recovery_set_id
    }

    pub(crate) const fn destination_fingerprint(
        &self,
    ) -> TenantRootRestoreDestinationFingerprintV1 {
        self.destination_fingerprint
    }

    pub(crate) const fn manifest_digest(&self) -> &[u8; 32] {
        &self.manifest_digest
    }

    pub(crate) const fn stable_root_commitment(&self) -> &[u8; 32] {
        &self.stable_root_commitment
    }

    pub(crate) const fn share_commitment(&self) -> &[u8; 34] {
        &self.share_commitment
    }

    pub(crate) const fn role(&self) -> CloudflareTenantRootDeriverRoleV1 {
        self.role
    }

    pub(crate) const fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn import_key_id(&self) -> &str {
        &self.import_key_id
    }

    pub(crate) const fn replay_key_digest(&self) -> &[u8; 32] {
        &self.replay_key_digest
    }

    pub(crate) const fn command_digest(&self) -> &[u8; 32] {
        &self.command_digest
    }

    pub(crate) const fn operation_digest(&self) -> &[u8; 32] {
        &self.operation_digest
    }

    pub(crate) const fn import_public_key(&self) -> TenantRootRestoreImportPublicKeyV1 {
        self.import_public_key
    }

    pub(crate) const fn issued_at_ms(&self) -> u64 {
        self.issued_at_ms
    }

    pub(crate) const fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    /// Compares the signed scope that selects one issuance, leaving the
    /// Deriver-generated public key and transport command digest out of the
    /// comparison. The first concurrent issuer owns the generated key; a
    /// retry or issuer-key rotation reuses its recorded public response.
    pub(crate) fn matches_authorized_scope(
        &self,
        other: &CloudflareTenantRootRestoreImportKeyBindingV1,
    ) -> bool {
        self.identity_digest == other.identity_digest
            && self.custody_lineage == other.custody_lineage
            && self.restore_session_id == other.restore_session_id
            && self.recovery_set_id == other.recovery_set_id
            && self.destination_fingerprint == other.destination_fingerprint
            && self.manifest_digest == other.manifest_digest
            && self.stable_root_commitment == other.stable_root_commitment
            && self.share_commitment == other.share_commitment
            && self.role == other.role
            && self.generation == other.generation
            && self.import_key_id == other.import_key_id
            && self.replay_key_digest == other.replay_key_digest
            && self.operation_digest == other.operation_digest
            && self.issued_at_ms == other.issued_at_ms
            && self.expires_at_ms == other.expires_at_ms
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        if self.generation == 0 {
            return Err(store_error(
                "tenant-root restore import key generation must be positive",
            ));
        }
        if self.import_key_id.is_empty()
            || self.import_key_id.len() > MAX_RESTORE_IMPORT_KEY_ID_BYTES
            || self.import_key_id.trim() != self.import_key_id
            || self
                .import_key_id
                .bytes()
                .any(|byte| byte.is_ascii_control())
        {
            return Err(store_error("tenant-root restore import key id is invalid"));
        }
        require_nonzero_bytes(
            "tenant-root restore import key replay digest",
            &self.replay_key_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import key command digest",
            &self.command_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import key operation digest",
            &self.operation_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import manifest digest",
            &self.manifest_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import stable root commitment",
            &self.stable_root_commitment,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import share commitment",
            &self.share_commitment,
        )?;
        if self.issued_at_ms == 0
            || self.expires_at_ms <= self.issued_at_ms
            || self.expires_at_ms - self.issued_at_ms != TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1 as u64
        {
            return Err(store_error(
                "tenant-root restore import key lifetime is invalid",
            ));
        }
        Ok(())
    }
}

/// One role-local import-key row, with encrypted IKM retained only on the
/// owning Deriver.
pub(crate) struct CloudflareTenantRootRestoreImportKeyRecordV1 {
    pub(super) binding: CloudflareTenantRootRestoreImportKeyBindingV1,
    pub(super) encrypted_ikm_json: Option<String>,
    pub(super) envelope_digest: Option<[u8; 32]>,
    pub(super) encrypted_imported_share_json: Option<String>,
    pub(super) lifecycle: CloudflareTenantRootRestoreImportKeyLifecycleV1,
    pub(super) installed_at_ms: Option<u64>,
    pub(super) receipt_digest: Option<[u8; 32]>,
    pub(super) created_at_ms: u64,
    pub(super) updated_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreImportKeyRecordV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreImportKeyRecordV1")
            .field("binding", &self.binding)
            .field(
                "encrypted_ikm_json",
                &self.encrypted_ikm_json.as_ref().map(|_| "[redacted]"),
            )
            .field(
                "envelope_digest",
                &self.envelope_digest.map(|digest| encode_hex(&digest)),
            )
            .field(
                "encrypted_imported_share_json",
                &self
                    .encrypted_imported_share_json
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field("lifecycle", &self.lifecycle)
            .field("installed_at_ms", &self.installed_at_ms)
            .field(
                "receipt_digest",
                &self.receipt_digest.map(|digest| encode_hex(&digest)),
            )
            .field("created_at_ms", &self.created_at_ms)
            .field("updated_at_ms", &self.updated_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreImportKeyRecordV1 {
    pub(crate) fn new_issued(
        binding: CloudflareTenantRootRestoreImportKeyBindingV1,
        encrypted_ikm_json: String,
    ) -> RoleStoreResult<Self> {
        if encrypted_ikm_json.is_empty() {
            return Err(store_error(
                "tenant-root restore import key ciphertext is empty",
            ));
        }
        let record = Self {
            binding,
            encrypted_ikm_json: Some(encrypted_ikm_json),
            envelope_digest: None,
            encrypted_imported_share_json: None,
            lifecycle: CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued,
            installed_at_ms: None,
            receipt_digest: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        record.validate()?;
        Ok(record)
    }

    pub(crate) fn binding(&self) -> &CloudflareTenantRootRestoreImportKeyBindingV1 {
        &self.binding
    }

    pub(crate) const fn lifecycle(&self) -> CloudflareTenantRootRestoreImportKeyLifecycleV1 {
        self.lifecycle
    }

    pub(crate) fn encrypted_ikm_json(&self) -> RoleStoreResult<&str> {
        self.encrypted_ikm_json.as_deref().ok_or_else(|| {
            store_error("closed tenant-root restore import key has no encrypted IKM")
        })
    }

    pub(crate) fn encrypted_imported_share_json(&self) -> RoleStoreResult<&str> {
        self.encrypted_imported_share_json
            .as_deref()
            .ok_or_else(|| {
                store_error("tenant-root restore import key has no staged imported share")
            })
    }

    pub(crate) const fn envelope_digest(&self) -> Option<[u8; 32]> {
        self.envelope_digest
    }

    pub(crate) const fn receipt_digest(&self) -> Option<[u8; 32]> {
        self.receipt_digest
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        self.binding.validate()?;
        if self.created_at_ms != 0 || self.updated_at_ms != 0 {
            if self.created_at_ms == 0
                || self.updated_at_ms < self.created_at_ms
                || self.updated_at_ms > i64::MAX as u64
            {
                return Err(store_error(
                    "tenant-root restore import key timestamps are invalid",
                ));
            }
        }
        match self.lifecycle {
            CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed => {
                if self.encrypted_ikm_json.is_some()
                    || self.envelope_digest.is_some()
                    || self.encrypted_imported_share_json.is_some()
                    || self.installed_at_ms.is_some()
                    || self.receipt_digest.is_some()
                {
                    return Err(store_error(
                        "closed tenant-root restore import key retains secret state",
                    ));
                }
            }
            CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed => {
                if self.encrypted_ikm_json.is_none()
                    || self.envelope_digest.is_none()
                    || self.encrypted_imported_share_json.is_none()
                    || self.installed_at_ms.is_none()
                    || self.receipt_digest.is_none()
                {
                    return Err(store_error(
                        "installed tenant-root restore import key is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued
            | CloudflareTenantRootRestoreImportKeyLifecycleV1::Superseded
            | CloudflareTenantRootRestoreImportKeyLifecycleV1::Expired => {
                if self.encrypted_ikm_json.is_none()
                    || self.envelope_digest.is_some()
                    || self.encrypted_imported_share_json.is_some()
                    || self.installed_at_ms.is_some()
                    || self.receipt_digest.is_some()
                {
                    return Err(store_error(
                        "uninstalled tenant-root restore import key is incomplete",
                    ));
                }
            }
        }
        Ok(())
    }
}

/// Outcome of one role-local import-key issuance transaction.
#[derive(Debug)]
pub(crate) enum CloudflareTenantRootRestoreImportKeyIssueDecisionV1 {
    Issued(CloudflareTenantRootRestoreImportKeyRecordV1),
    Replay(CloudflareTenantRootRestoreImportKeyRecordV1),
}

#[derive(Debug)]
pub(crate) enum CloudflareTenantRootRestoreImportKeyAcceptDecisionV1 {
    Accepted(CloudflareTenantRootRestoreImportKeyRecordV1),
    Replay(CloudflareTenantRootRestoreImportKeyRecordV1),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRestoreRefreshRoleAttemptD1RowV1 {
    pub(super) tenant_identity_digest_hex: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) restore_session_id_hex: String,
    pub(super) role: String,
    pub(super) generation: i64,
    pub(super) import_key_id: String,
    pub(super) import_replay_key_digest_hex: String,
    pub(super) import_command_digest_hex: String,
    pub(super) import_operation_digest_hex: String,
    pub(super) recovery_set_id_b64u: String,
    pub(super) manifest_digest_hex: String,
    pub(super) stable_root_commitment_b64u: String,
    pub(super) share_commitment_b64u: String,
    pub(super) destination_fingerprint_hex: String,
    pub(super) import_public_key_b64u: String,
    pub(super) import_issued_at_ms: i64,
    pub(super) import_expires_at_ms: i64,
    pub(super) refresh_command_digest_hex: String,
    pub(super) refresh_issued_at_ms: i64,
    pub(super) refresh_expires_at_ms: i64,
    pub(super) admitted_at_ms: i64,
    pub(super) encrypted_seed_json: Option<String>,
    pub(super) encrypted_refreshed_share_json: Option<String>,
    pub(super) installation_evidence_b64u: Option<String>,
    pub(super) installation_evidence_digest_hex: Option<String>,
    pub(super) lifecycle: String,
    pub(super) refreshed_at_ms: Option<i64>,
    pub(super) created_at_ms: i64,
    pub(super) updated_at_ms: i64,
    pub(super) promotion_lifecycle: String,
    pub(super) promotion_reserved_at_ms: Option<i64>,
    pub(super) encrypted_online_role_share_json: Option<String>,
    pub(super) provider_canary_receipt_b64u: Option<String>,
    pub(super) promotion_completed_at_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRestoreImportKeyD1RowV1 {
    pub(super) tenant_identity_digest_hex: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) restore_session_id_hex: String,
    pub(super) role: String,
    pub(super) generation: i64,
    pub(super) import_key_id: String,
    pub(super) replay_key_digest_hex: String,
    pub(super) command_digest_hex: String,
    pub(super) operation_digest_hex: String,
    pub(super) recovery_set_id_b64u: String,
    pub(super) manifest_digest_hex: String,
    pub(super) stable_root_commitment_b64u: String,
    pub(super) share_commitment_b64u: String,
    pub(super) destination_fingerprint_hex: String,
    pub(super) public_key_b64u: String,
    pub(super) encrypted_ikm_json: Option<String>,
    pub(super) envelope_digest_hex: Option<String>,
    pub(super) encrypted_imported_share_json: Option<String>,
    pub(super) issued_at_ms: i64,
    pub(super) expires_at_ms: i64,
    pub(super) lifecycle: String,
    pub(super) installed_at_ms: Option<i64>,
    pub(super) receipt_digest_hex: Option<String>,
    pub(super) created_at_ms: i64,
    pub(super) updated_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRestoreImportSessionTombstoneD1RowV1 {
    pub(super) closed_at_ms: i64,
    pub(super) role: Option<String>,
    pub(super) activation_operation: Option<String>,
    pub(super) activation_receipt_b64u: Option<String>,
    pub(super) activation_receipt_digest_hex: Option<String>,
    pub(super) cleanup_receipt_b64u: Option<String>,
    pub(super) cleanup_receipt_digest_hex: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRestoreImportSessionClosedD1RowV1 {
    pub(super) closed_at_ms: i64,
}

/// Exact public receipt returned when a tenant-held restore session is closed.
/// It commits only to authenticated public scope and receipt digests.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
    pub(super) bytes: Vec<u8>,
    pub(super) digest: TenantRootLifecycleReceiptDigestV1,
    pub(super) closed_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreSessionCleanupReceiptV1")
            .field("digest", &self.digest)
            .field("closed_at_ms", &self.closed_at_ms)
            .field("bytes", &"[public receipt bytes]")
            .finish()
    }
}

impl CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
    pub(super) fn new(
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        role: CloudflareTenantRootDeriverRoleV1,
        activation_operation: &str,
        activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        closed_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        require_timestamp(
            "tenant-root restore import session close timestamp",
            closed_at_ms,
        )?;
        let mut bytes = Vec::with_capacity(256);
        bytes.extend_from_slice(TENANT_ROOT_RESTORE_SESSION_CLEANUP_RECEIPT_DOMAIN_V1);
        push_command_field(&mut bytes, identity_digest.as_bytes())?;
        push_command_field(&mut bytes, custody_lineage.as_bytes())?;
        push_command_field(&mut bytes, restore_session_id.as_bytes())?;
        push_command_field(&mut bytes, role.as_str().as_bytes())?;
        push_command_field(&mut bytes, activation_operation.as_bytes())?;
        push_command_field(&mut bytes, activation_receipt_digest.as_bytes())?;
        push_command_u64(&mut bytes, closed_at_ms)?;
        let digest = TenantRootLifecycleReceiptDigestV1::from_bytes(Sha256::digest(&bytes).into())
            .map_err(|error| store_error(error.message()))?;
        Ok(Self {
            bytes,
            digest,
            closed_at_ms,
        })
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) const fn digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.digest
    }

    pub(crate) const fn closed_at_ms(&self) -> u64 {
        self.closed_at_ms
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct CloudflareTenantRootRestoreImportSessionTombstoneV1 {
    pub(super) identity_digest: TenantRootIdentityDigestV1,
    pub(super) custody_lineage: TenantRootCustodyLineageId,
    pub(super) restore_session_id: TenantRootRestoreSessionIdV1,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) activation_operation: String,
    pub(super) activation_receipt_bytes: Vec<u8>,
    pub(super) activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    pub(super) cleanup_receipt: CloudflareTenantRootRestoreSessionCleanupReceiptV1,
    pub(super) closed_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreImportSessionTombstoneV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreImportSessionTombstoneV1")
            .field("identity_digest", &self.identity_digest)
            .field("custody_lineage", &self.custody_lineage)
            .field("restore_session_id", &self.restore_session_id)
            .field("role", &self.role)
            .field("activation_operation", &self.activation_operation)
            .field("activation_receipt_digest", &self.activation_receipt_digest)
            .field("cleanup_receipt", &self.cleanup_receipt)
            .field("closed_at_ms", &self.closed_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreImportSessionTombstoneV1 {
    pub(super) fn from_activation(
        activation: &VerifiedTenantRootSignedActivationReceiptV1,
        role: CloudflareTenantRootDeriverRoleV1,
        closed_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        if activation.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
            return Err(store_error(
                "tenant-root restore-session cleanup requires initial-creation activation",
            ));
        }
        let provenance = activation
            .availability()
            .tenant_held_external_provenance()
            .ok_or_else(|| {
                store_error(
                    "tenant-root restore-session cleanup requires tenant-held external activation",
                )
            })?;
        let activation_operation = activation.transition().operation().to_owned();
        let activation_receipt_digest = activation.digest();
        let cleanup_receipt = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            activation.identity_digest(),
            activation.custody_lineage(),
            provenance.restore_session_id(),
            role,
            &activation_operation,
            activation_receipt_digest,
            closed_at_ms,
        )?;
        Ok(Self {
            identity_digest: activation.identity_digest(),
            custody_lineage: activation.custody_lineage(),
            restore_session_id: provenance.restore_session_id(),
            role,
            activation_operation,
            activation_receipt_bytes: activation.canonical_bytes().to_vec(),
            activation_receipt_digest,
            cleanup_receipt,
            closed_at_ms,
        })
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        require_timestamp(
            "tenant-root restore import session close timestamp",
            self.closed_at_ms,
        )?;
        if self.activation_operation
            != TenantRootActivationReceiptTransitionV1::InitialCreation.operation()
        {
            return Err(store_error(
                "tenant-root restore-session tombstone activation operation is invalid",
            ));
        }
        let receipt = decode_activation_receipt_bytes(&self.activation_receipt_bytes)?;
        if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation
            || receipt.identity_digest() != self.identity_digest
            || receipt.custody_lineage() != self.custody_lineage
            || receipt
                .availability()
                .tenant_held_external_provenance()
                .map(|provenance| provenance.restore_session_id())
                != Some(self.restore_session_id)
        {
            return Err(store_error(
                "tenant-root restore-session tombstone activation scope is invalid",
            ));
        }
        let activation_receipt_digest = receipt
            .digest()
            .map_err(|error| store_error(error.message()))?;
        if activation_receipt_digest != self.activation_receipt_digest {
            return Err(store_error(
                "tenant-root restore-session tombstone activation digest is invalid",
            ));
        }
        let expected_cleanup = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            self.identity_digest,
            self.custody_lineage,
            self.restore_session_id,
            self.role,
            &self.activation_operation,
            self.activation_receipt_digest,
            self.closed_at_ms,
        )?;
        if self.cleanup_receipt != expected_cleanup {
            return Err(store_error(
                "tenant-root restore-session tombstone cleanup receipt is invalid",
            ));
        }
        Ok(())
    }

    pub(super) fn matches(&self, other: &Self) -> bool {
        self.identity_digest == other.identity_digest
            && self.custody_lineage == other.custody_lineage
            && self.restore_session_id == other.restore_session_id
            && self.role == other.role
            && self.activation_operation == other.activation_operation
            && self.activation_receipt_bytes == other.activation_receipt_bytes
            && self.activation_receipt_digest == other.activation_receipt_digest
    }

    pub(crate) fn cleanup_receipt(&self) -> &CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
        &self.cleanup_receipt
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRestoreImportKeyCiphertextV1 {
    pub(super) key_version: String,
    pub(super) tenant_identity_digest_hex: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) restore_session_id_hex: String,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) generation: u64,
    pub(super) import_key_id: String,
    pub(super) public_key_b64u: String,
    pub(super) issued_at_ms: u64,
    pub(super) expires_at_ms: u64,
    pub(super) lifecycle: String,
    pub(super) ciphertext_b64u: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRestoreImportedShareCiphertextV1 {
    pub(super) key_version: String,
    pub(super) tenant_identity_digest_hex: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) restore_session_id_hex: String,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) generation: u64,
    pub(super) import_key_id: String,
    pub(super) envelope_digest_hex: String,
    pub(super) share_commitment_b64u: String,
    pub(super) ciphertext_b64u: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRestoreImportedShareAadV1<'a> {
    pub(super) environment: &'a str,
    pub(super) worker_role: CloudflareTenantRootDeriverRoleV1,
    pub(super) tenant_identity_digest_hex: &'a str,
    pub(super) custody_lineage_b64u: &'a str,
    pub(super) restore_session_id_hex: &'a str,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) generation: u64,
    pub(super) import_key_id: &'a str,
    pub(super) envelope_digest_hex: &'a str,
    pub(super) share_commitment_b64u: &'a str,
    pub(super) purpose: &'static str,
    pub(super) schema: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRestoreImportKeyAadV1<'a> {
    pub(super) environment: &'a str,
    pub(super) worker_role: CloudflareTenantRootDeriverRoleV1,
    pub(super) tenant_identity_digest_hex: &'a str,
    pub(super) custody_lineage_b64u: &'a str,
    pub(super) restore_session_id_hex: &'a str,
    pub(super) recovery_set_id_b64u: &'a str,
    pub(super) destination_fingerprint_hex: &'a str,
    pub(super) manifest_digest_hex: &'a str,
    pub(super) stable_root_commitment_b64u: &'a str,
    pub(super) share_commitment_b64u: &'a str,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) generation: u64,
    pub(super) import_key_id: &'a str,
    pub(super) replay_key_digest_hex: &'a str,
    pub(super) command_digest_hex: &'a str,
    pub(super) operation_digest_hex: &'a str,
    pub(super) public_key_b64u: &'a str,
    pub(super) issued_at_ms: u64,
    pub(super) expires_at_ms: u64,
    pub(super) lifecycle: &'a str,
    pub(super) purpose: &'static str,
    pub(super) schema: &'static str,
}

/// The fields of a restore refresh attempt that every refresh ciphertext
/// header and AAD carries, encoded from the attempt's binding, in the order
/// they are written.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(super) struct TenantRootRestoreRefreshAttemptFieldsV1 {
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    restore_session_id_hex: String,
    recovery_set_id_b64u: String,
    destination_fingerprint_hex: String,
    manifest_digest_hex: String,
    stable_root_commitment_b64u: String,
    share_commitment_b64u: String,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: String,
    import_replay_key_digest_hex: String,
    import_command_digest_hex: String,
    import_operation_digest_hex: String,
    import_public_key_b64u: String,
    import_issued_at_ms: u64,
    import_expires_at_ms: u64,
    refresh_command_digest_hex: String,
}

impl TenantRootRestoreRefreshAttemptFieldsV1 {
    pub(super) fn from_binding(
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
    ) -> Self {
        let import = binding.import_binding();
        Self {
            tenant_identity_digest_hex: encode_hex(import.identity_digest.as_bytes()),
            custody_lineage_b64u: import.custody_lineage.to_base64url(),
            restore_session_id_hex: encode_hex(import.restore_session_id.as_bytes()),
            recovery_set_id_b64u: import.recovery_set_id.to_base64url(),
            destination_fingerprint_hex: encode_hex(import.destination_fingerprint.as_bytes()),
            manifest_digest_hex: encode_hex(&import.manifest_digest),
            stable_root_commitment_b64u: encode_base64url_bytes_v1(&import.stable_root_commitment),
            share_commitment_b64u: encode_base64url_bytes_v1(&import.share_commitment),
            role: import.role,
            generation: import.generation,
            import_key_id: import.import_key_id.clone(),
            import_replay_key_digest_hex: encode_hex(&import.replay_key_digest),
            import_command_digest_hex: encode_hex(&import.command_digest),
            import_operation_digest_hex: encode_hex(&import.operation_digest),
            import_public_key_b64u: encode_base64url_bytes_v1(import.import_public_key.as_bytes()),
            import_issued_at_ms: import.issued_at_ms,
            import_expires_at_ms: import.expires_at_ms,
            refresh_command_digest_hex: encode_hex(binding.command_digest()),
        }
    }
}

/// Declares one restore refresh ciphertext header: the key version, the
/// attempt fields in the order of `TenantRootRestoreRefreshAttemptFieldsV1`,
/// the header's own fields, then the ciphertext. The attempt fields are
/// written out rather than flattened, because serde does not support
/// `deny_unknown_fields` on a struct with a flattened field.
macro_rules! restore_refresh_ciphertext_v1 {
    ($name:ident { $($field:ident: $type:ty),* $(,)? }) => {
        #[derive(Debug, Serialize, Deserialize)]
        #[serde(deny_unknown_fields)]
        pub(super) struct $name {
            pub(super) key_version: String,
            pub(super) tenant_identity_digest_hex: String,
            pub(super) custody_lineage_b64u: String,
            pub(super) restore_session_id_hex: String,
            pub(super) recovery_set_id_b64u: String,
            pub(super) destination_fingerprint_hex: String,
            pub(super) manifest_digest_hex: String,
            pub(super) stable_root_commitment_b64u: String,
            pub(super) share_commitment_b64u: String,
            pub(super) role: CloudflareTenantRootDeriverRoleV1,
            pub(super) generation: u64,
            pub(super) import_key_id: String,
            pub(super) import_replay_key_digest_hex: String,
            pub(super) import_command_digest_hex: String,
            pub(super) import_operation_digest_hex: String,
            pub(super) import_public_key_b64u: String,
            pub(super) import_issued_at_ms: u64,
            pub(super) import_expires_at_ms: u64,
            pub(super) refresh_command_digest_hex: String,
            $(pub(super) $field: $type,)*
            pub(super) ciphertext_b64u: String,
        }

        // Only the Deriver entries seal and open every header kind.
        #[cfg_attr(
            not(any(
                feature = "strict-worker-deriver-a-entrypoint",
                feature = "strict-worker-deriver-b-entrypoint"
            )),
            allow(dead_code)
        )]
        impl $name {
            pub(super) fn new(
                key_version: String,
                attempt: TenantRootRestoreRefreshAttemptFieldsV1,
                $($field: $type,)*
                ciphertext_b64u: String,
            ) -> Self {
                Self {
                    key_version,
                    tenant_identity_digest_hex: attempt.tenant_identity_digest_hex,
                    custody_lineage_b64u: attempt.custody_lineage_b64u,
                    restore_session_id_hex: attempt.restore_session_id_hex,
                    recovery_set_id_b64u: attempt.recovery_set_id_b64u,
                    destination_fingerprint_hex: attempt.destination_fingerprint_hex,
                    manifest_digest_hex: attempt.manifest_digest_hex,
                    stable_root_commitment_b64u: attempt.stable_root_commitment_b64u,
                    share_commitment_b64u: attempt.share_commitment_b64u,
                    role: attempt.role,
                    generation: attempt.generation,
                    import_key_id: attempt.import_key_id,
                    import_replay_key_digest_hex: attempt.import_replay_key_digest_hex,
                    import_command_digest_hex: attempt.import_command_digest_hex,
                    import_operation_digest_hex: attempt.import_operation_digest_hex,
                    import_public_key_b64u: attempt.import_public_key_b64u,
                    import_issued_at_ms: attempt.import_issued_at_ms,
                    import_expires_at_ms: attempt.import_expires_at_ms,
                    refresh_command_digest_hex: attempt.refresh_command_digest_hex,
                    $($field,)*
                    ciphertext_b64u,
                }
            }

            /// The attempt fields this header names.
            pub(super) fn attempt(&self) -> TenantRootRestoreRefreshAttemptFieldsV1 {
                TenantRootRestoreRefreshAttemptFieldsV1 {
                    tenant_identity_digest_hex: self.tenant_identity_digest_hex.clone(),
                    custody_lineage_b64u: self.custody_lineage_b64u.clone(),
                    restore_session_id_hex: self.restore_session_id_hex.clone(),
                    recovery_set_id_b64u: self.recovery_set_id_b64u.clone(),
                    destination_fingerprint_hex: self.destination_fingerprint_hex.clone(),
                    manifest_digest_hex: self.manifest_digest_hex.clone(),
                    stable_root_commitment_b64u: self.stable_root_commitment_b64u.clone(),
                    share_commitment_b64u: self.share_commitment_b64u.clone(),
                    role: self.role,
                    generation: self.generation,
                    import_key_id: self.import_key_id.clone(),
                    import_replay_key_digest_hex: self.import_replay_key_digest_hex.clone(),
                    import_command_digest_hex: self.import_command_digest_hex.clone(),
                    import_operation_digest_hex: self.import_operation_digest_hex.clone(),
                    import_public_key_b64u: self.import_public_key_b64u.clone(),
                    import_issued_at_ms: self.import_issued_at_ms,
                    import_expires_at_ms: self.import_expires_at_ms,
                    refresh_command_digest_hex: self.refresh_command_digest_hex.clone(),
                }
            }
        }
    };
}

restore_refresh_ciphertext_v1!(TenantRootRestoreRefreshSeedCiphertextV1 {
    issued_at_ms: u64,
    expires_at_ms: u64,
    admitted_at_ms: u64,
});

restore_refresh_ciphertext_v1!(TenantRootRestoreRefreshShareCiphertextV1 {
    evidence_digest_hex: String,
});

restore_refresh_ciphertext_v1!(TenantRootRestorePromotionRoleCiphertextV1 {
    provider_binding_aad_b64u: String,
});

#[derive(Debug, Serialize)]
pub(super) struct TenantRootRestoreRefreshSeedAadV1<'a> {
    pub(super) environment: &'a str,
    pub(super) worker_role: CloudflareTenantRootDeriverRoleV1,
    #[serde(flatten)]
    pub(super) attempt: &'a TenantRootRestoreRefreshAttemptFieldsV1,
    pub(super) issued_at_ms: u64,
    pub(super) expires_at_ms: u64,
    pub(super) admitted_at_ms: u64,
    pub(super) purpose: &'static str,
    pub(super) schema: &'static str,
}

#[derive(Debug, Serialize)]
pub(super) struct TenantRootRestoreRefreshShareAadV1<'a> {
    pub(super) environment: &'a str,
    pub(super) worker_role: CloudflareTenantRootDeriverRoleV1,
    #[serde(flatten)]
    pub(super) attempt: &'a TenantRootRestoreRefreshAttemptFieldsV1,
    pub(super) evidence_digest_hex: &'a str,
    pub(super) purpose: &'static str,
    pub(super) schema: &'static str,
}

#[derive(Debug, Serialize)]
pub(super) struct TenantRootRestorePromotionAadV1<'a> {
    pub(super) environment: &'a str,
    pub(super) worker_role: CloudflareTenantRootDeriverRoleV1,
    #[serde(flatten)]
    pub(super) attempt: &'a TenantRootRestoreRefreshAttemptFieldsV1,
    pub(super) provider_binding_aad_b64u: &'a str,
    pub(super) purpose: &'static str,
    pub(super) schema: &'static str,
}

pub(super) fn restore_import_key_record_from_row(
    row: TenantRootRestoreImportKeyD1RowV1,
    expected_role: CloudflareTenantRootDeriverRoleV1,
) -> RoleStoreResult<CloudflareTenantRootRestoreImportKeyRecordV1> {
    let role = CloudflareTenantRootDeriverRoleV1::parse(&row.role)?;
    if role != expected_role {
        return Err(store_error(
            "tenant-root restore import key row belongs to the other Deriver",
        ));
    }
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
        "tenant-root restore import identity digest",
        &row.tenant_identity_digest_hex,
    )?);
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&row.custody_lineage_b64u)
        .map_err(|error| store_error(error.message()))?;
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes(decode_lower_hex_fixed::<16>(
            "tenant-root restore import session id",
            &row.restore_session_id_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let recovery_set_id = TenantRootRecoverySetId::from_base64url(&row.recovery_set_id_b64u)
        .map_err(|error| store_error(error.message()))?;
    let destination_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root restore destination fingerprint",
            &row.destination_fingerprint_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let import_public_key =
        TenantRootRestoreImportPublicKeyV1::from_bytes(decode_base64url_fixed::<32>(
            "tenant-root restore import public key",
            &row.public_key_b64u,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let binding = CloudflareTenantRootRestoreImportKeyBindingV1::new(
        identity_digest,
        custody_lineage,
        restore_session_id,
        recovery_set_id,
        destination_fingerprint,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore import manifest digest",
            &row.manifest_digest_hex,
        )?,
        decode_base64url_fixed::<32>(
            "tenant-root restore stable root commitment",
            &row.stable_root_commitment_b64u,
        )?,
        decode_base64url_fixed::<34>(
            "tenant-root restore role commitment",
            &row.share_commitment_b64u,
        )?,
        role,
        positive_u64_from_i64("tenant-root restore import generation", row.generation)?,
        row.import_key_id,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore import replay digest",
            &row.replay_key_digest_hex,
        )?,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore import command digest",
            &row.command_digest_hex,
        )?,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore import operation digest",
            &row.operation_digest_hex,
        )?,
        import_public_key,
        positive_u64_from_i64(
            "tenant-root restore import issued timestamp",
            row.issued_at_ms,
        )?,
        positive_u64_from_i64(
            "tenant-root restore import expiry timestamp",
            row.expires_at_ms,
        )?,
    )?;
    let lifecycle = CloudflareTenantRootRestoreImportKeyLifecycleV1::parse(&row.lifecycle)?;
    let installed_at_ms = row
        .installed_at_ms
        .map(|value| {
            positive_u64_from_i64("tenant-root restore import installation timestamp", value)
        })
        .transpose()?;
    let receipt_digest = row
        .receipt_digest_hex
        .as_deref()
        .map(|value| {
            decode_lower_hex_fixed::<32>("tenant-root restore import receipt digest", value)
        })
        .transpose()?;
    let envelope_digest = row
        .envelope_digest_hex
        .as_deref()
        .map(|value| {
            decode_lower_hex_fixed::<32>("tenant-root restore import envelope digest", value)
        })
        .transpose()?;
    let record = CloudflareTenantRootRestoreImportKeyRecordV1 {
        binding,
        encrypted_ikm_json: row.encrypted_ikm_json,
        envelope_digest,
        encrypted_imported_share_json: row.encrypted_imported_share_json,
        lifecycle,
        installed_at_ms,
        receipt_digest,
        created_at_ms: positive_u64_from_i64(
            "tenant-root restore import creation timestamp",
            row.created_at_ms,
        )?,
        updated_at_ms: positive_u64_from_i64(
            "tenant-root restore import update timestamp",
            row.updated_at_ms,
        )?,
    };
    record.validate()?;
    Ok(record)
}

pub(super) fn restore_refresh_role_attempt_record_from_row(
    row: TenantRootRestoreRefreshRoleAttemptD1RowV1,
    expected_role: CloudflareTenantRootDeriverRoleV1,
) -> RoleStoreResult<CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1> {
    let role = CloudflareTenantRootDeriverRoleV1::parse(&row.role)?;
    if role != expected_role {
        return Err(store_error(
            "tenant-root restore refresh attempt row belongs to the other Deriver",
        ));
    }
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
        "tenant-root restore refresh identity digest",
        &row.tenant_identity_digest_hex,
    )?);
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&row.custody_lineage_b64u)
        .map_err(|error| store_error(error.message()))?;
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes(decode_lower_hex_fixed::<16>(
            "tenant-root restore refresh session id",
            &row.restore_session_id_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let recovery_set_id = TenantRootRecoverySetId::from_base64url(&row.recovery_set_id_b64u)
        .map_err(|error| store_error(error.message()))?;
    let destination_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh destination fingerprint",
            &row.destination_fingerprint_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let import_public_key =
        TenantRootRestoreImportPublicKeyV1::from_bytes(decode_base64url_fixed::<32>(
            "tenant-root restore refresh import public key",
            &row.import_public_key_b64u,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let import_binding = CloudflareTenantRootRestoreImportKeyBindingV1::new(
        identity_digest,
        custody_lineage,
        restore_session_id,
        recovery_set_id,
        destination_fingerprint,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh manifest digest",
            &row.manifest_digest_hex,
        )?,
        decode_base64url_fixed::<32>(
            "tenant-root restore refresh stable root commitment",
            &row.stable_root_commitment_b64u,
        )?,
        decode_base64url_fixed::<34>(
            "tenant-root restore refresh imported share commitment",
            &row.share_commitment_b64u,
        )?,
        role,
        positive_u64_from_i64(
            "tenant-root restore refresh import generation",
            row.generation,
        )?,
        row.import_key_id,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh import replay digest",
            &row.import_replay_key_digest_hex,
        )?,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh import command digest",
            &row.import_command_digest_hex,
        )?,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh import operation digest",
            &row.import_operation_digest_hex,
        )?,
        import_public_key,
        positive_u64_from_i64(
            "tenant-root restore refresh import issue timestamp",
            row.import_issued_at_ms,
        )?,
        positive_u64_from_i64(
            "tenant-root restore refresh import expiry timestamp",
            row.import_expires_at_ms,
        )?,
    )?;
    let command_digest = decode_lower_hex_fixed::<32>(
        "tenant-root restore refresh command digest",
        &row.refresh_command_digest_hex,
    )?;
    let issued_at_ms = positive_u64_from_i64(
        "tenant-root restore refresh command issue timestamp",
        row.refresh_issued_at_ms,
    )?;
    let expires_at_ms = positive_u64_from_i64(
        "tenant-root restore refresh command expiry timestamp",
        row.refresh_expires_at_ms,
    )?;
    let admitted_at_ms = positive_u64_from_i64(
        "tenant-root restore refresh admission timestamp",
        row.admitted_at_ms,
    )?;
    let binding = CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1::from_import_binding(
        import_binding,
        command_digest,
        issued_at_ms,
        expires_at_ms,
        admitted_at_ms,
    )?;
    let lifecycle =
        CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::parse(&row.lifecycle)?;
    let promotion_lifecycle =
        CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::parse(&row.promotion_lifecycle)?;
    let installation_evidence_digest = row
        .installation_evidence_digest_hex
        .as_deref()
        .map(|value| {
            decode_lower_hex_fixed::<32>(
                "tenant-root restore refresh installation evidence digest",
                value,
            )
        })
        .transpose()?;
    let record = CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1 {
        binding,
        encrypted_seed_json: row.encrypted_seed_json,
        encrypted_refreshed_share_json: row.encrypted_refreshed_share_json,
        installation_evidence_b64u: row.installation_evidence_b64u,
        installation_evidence_digest,
        lifecycle,
        refreshed_at_ms: row
            .refreshed_at_ms
            .map(|value| positive_u64_from_i64("tenant-root restore refresh timestamp", value))
            .transpose()?,
        promotion_lifecycle,
        promotion_reserved_at_ms: row
            .promotion_reserved_at_ms
            .map(|value| {
                positive_u64_from_i64(
                    "tenant-root restore refresh promotion reservation timestamp",
                    value,
                )
            })
            .transpose()?,
        encrypted_online_role_share_json: row.encrypted_online_role_share_json,
        provider_canary_receipt_b64u: row.provider_canary_receipt_b64u,
        promotion_completed_at_ms: row
            .promotion_completed_at_ms
            .map(|value| {
                positive_u64_from_i64(
                    "tenant-root restore refresh promotion completion timestamp",
                    value,
                )
            })
            .transpose()?,
        created_at_ms: positive_u64_from_i64(
            "tenant-root restore refresh attempt creation timestamp",
            row.created_at_ms,
        )?,
        updated_at_ms: positive_u64_from_i64(
            "tenant-root restore refresh attempt update timestamp",
            row.updated_at_ms,
        )?,
    };
    record.validate()?;
    if record.lifecycle == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed {
        record.installation_evidence_bytes()?;
    }
    Ok(record)
}
