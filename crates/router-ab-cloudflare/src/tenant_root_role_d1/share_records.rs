//! Role-share domain records: roles, sealed, pending, active and retired shares, activation, availability evidence, and active-pair resolution.

use super::*;

/// Exact role owning one private tenant-root share store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareTenantRootDeriverRoleV1 {
    /// Deriver A owns threshold share identifier one.
    DeriverA,
    /// Deriver B owns threshold share identifier two.
    DeriverB,
}

impl CloudflareTenantRootDeriverRoleV1 {
    pub(super) fn parse(value: &str) -> RoleStoreResult<Self> {
        match value {
            "deriver_a" => Ok(Self::DeriverA),
            "deriver_b" => Ok(Self::DeriverB),
            _ => Err(store_error(
                "DERIVER_ROLE_PRIVATE_D1_ROLE must be deriver_a or deriver_b",
            )),
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::DeriverA => "deriver_a",
            Self::DeriverB => "deriver_b",
        }
    }

    #[cfg(test)]
    pub(super) const fn share_id(self) -> u16 {
        match self {
            Self::DeriverA => 1,
            Self::DeriverB => 2,
        }
    }

    pub(super) const fn managed_restore_role(self) -> TenantRootManagedRestoreRoleV1 {
        match self {
            Self::DeriverA => TenantRootManagedRestoreRoleV1::DeriverA,
            Self::DeriverB => TenantRootManagedRestoreRoleV1::DeriverB,
        }
    }
}

/// Ciphertext returned by the role's epoch wrapping-key provider.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootSealedRoleShareV1 {
    pub(super) ciphertext_b64u: String,
    pub(super) ciphertext_digest_hex: String,
}

impl CloudflareTenantRootSealedRoleShareV1 {
    /// Normalizes one non-empty bounded ciphertext and commits its exact bytes.
    pub fn new(ciphertext: &[u8]) -> RoleStoreResult<Self> {
        if ciphertext.is_empty() || ciphertext.len() > MAX_SEALED_ROLE_SHARE_BYTES {
            return Err(store_error(
                "tenant-root sealed role share has an invalid ciphertext length",
            ));
        }
        Ok(Self {
            ciphertext_b64u: encode_base64url_bytes_v1(ciphertext),
            ciphertext_digest_hex: encode_hex(Sha256::digest(ciphertext).as_ref()),
        })
    }

    /// Returns the canonical unpadded base64url ciphertext.
    pub fn ciphertext_b64u(&self) -> &str {
        &self.ciphertext_b64u
    }

    /// Returns the public digest of the exact sealed ciphertext.
    pub(crate) fn ciphertext_digest_hex(&self) -> &str {
        &self.ciphertext_digest_hex
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        let ciphertext =
            decode_base64url_bytes_v1("tenant-root sealed role share", &self.ciphertext_b64u)
                .map_err(|error| store_error(error.message()))?;
        if ciphertext.is_empty()
            || ciphertext.len() > MAX_SEALED_ROLE_SHARE_BYTES
            || encode_base64url_bytes_v1(&ciphertext) != self.ciphertext_b64u
            || encode_hex(Sha256::digest(&ciphertext).as_ref()) != self.ciphertext_digest_hex
        {
            return Err(store_error("tenant-root sealed role share is malformed"));
        }
        require_digest_hex(
            "tenant-root sealed role share digest",
            &self.ciphertext_digest_hex,
        )
    }
}

impl fmt::Debug for CloudflareTenantRootSealedRoleShareV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootSealedRoleShareV1")
            .field("ciphertext", &"[redacted]")
            .field("ciphertext_digest_hex", &self.ciphertext_digest_hex)
            .finish()
    }
}

/// Provenance of a pending role-local tenant-root share.
///
/// Restore material remains a pending input until the mandatory forward
/// refresh replaces it. Keeping that provenance in the encrypted record lets
/// every activation boundary reject a direct restore-to-active transition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum CloudflareTenantRootPendingShareOriginV1 {
    Ceremony,
    Refresh {
        replay_key_digest: TenantRootProtocolDigestV1,
    },
    ManagedRestore {
        capability_digest: TenantRootLifecycleReceiptDigestV1,
        backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    },
}

/// Pending role-local tenant-root installation evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootPendingShareV1 {
    pub(super) installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
    pub(super) staged_at_ms: u64,
    pub(super) origin: CloudflareTenantRootPendingShareOriginV1,
}

impl CloudflareTenantRootPendingShareV1 {
    /// Creates one pending branch from exact verified installation evidence bytes.
    pub fn from_verified_installation_evidence(
        evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        staged_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        let installation_evidence_digest = evidence
            .lifecycle_receipt_digest()
            .map_err(|error| store_error(error.message()))?;
        Self::from_stored_digest(installation_evidence_digest, staged_at_ms)
    }

    pub(super) fn from_verified_refresh_installation_evidence(
        evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        staged_at_ms: u64,
        replay_key_digest: TenantRootProtocolDigestV1,
    ) -> RoleStoreResult<Self> {
        let installation_evidence_digest = evidence
            .lifecycle_receipt_digest()
            .map_err(|error| store_error(error.message()))?;
        Self::from_stored_digest_with_origin(
            installation_evidence_digest,
            staged_at_ms,
            CloudflareTenantRootPendingShareOriginV1::Refresh { replay_key_digest },
        )
    }

    pub(super) fn from_stored_digest(
        installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
        staged_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        Self::from_stored_digest_with_origin(
            installation_evidence_digest,
            staged_at_ms,
            CloudflareTenantRootPendingShareOriginV1::Ceremony,
        )
    }

    pub(super) fn from_managed_restore(
        installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
        capability_digest: TenantRootLifecycleReceiptDigestV1,
        backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        staged_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        Self::from_stored_digest_with_origin(
            installation_evidence_digest,
            staged_at_ms,
            CloudflareTenantRootPendingShareOriginV1::ManagedRestore {
                capability_digest,
                backup_receipt_digest,
            },
        )
    }

    pub(super) fn from_stored_digest_with_origin(
        installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
        staged_at_ms: u64,
        origin: CloudflareTenantRootPendingShareOriginV1,
    ) -> RoleStoreResult<Self> {
        let pending = Self {
            installation_evidence_digest,
            staged_at_ms,
            origin,
        };
        pending.validate()?;
        Ok(pending)
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        require_timestamp("tenant-root staged timestamp", self.staged_at_ms)
    }

    pub const fn installation_evidence_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.installation_evidence_digest
    }

    pub(super) fn is_managed_restore(&self) -> bool {
        matches!(
            &self.origin,
            CloudflareTenantRootPendingShareOriginV1::ManagedRestore { .. }
        )
    }

    pub(super) fn managed_restore_digests(
        &self,
    ) -> Option<(
        TenantRootLifecycleReceiptDigestV1,
        TenantRootLifecycleReceiptDigestV1,
    )> {
        match &self.origin {
            CloudflareTenantRootPendingShareOriginV1::Ceremony => None,
            CloudflareTenantRootPendingShareOriginV1::Refresh { .. } => None,
            CloudflareTenantRootPendingShareOriginV1::ManagedRestore {
                capability_digest,
                backup_receipt_digest,
            } => Some((*capability_digest, *backup_receipt_digest)),
        }
    }

    pub(super) fn refresh_replay_key_digest(&self) -> Option<TenantRootProtocolDigestV1> {
        match &self.origin {
            CloudflareTenantRootPendingShareOriginV1::Refresh { replay_key_digest } => {
                Some(*replay_key_digest)
            }
            CloudflareTenantRootPendingShareOriginV1::Ceremony
            | CloudflareTenantRootPendingShareOriginV1::ManagedRestore { .. } => None,
        }
    }
}

pub(super) fn require_pending_activation_source(
    pending: &CloudflareTenantRootPendingShareV1,
) -> RoleStoreResult<()> {
    if pending.is_managed_restore() {
        return Err(store_error(
            "managed-restore material must pass through the mandatory forward refresh before activation",
        ));
    }
    Ok(())
}

/// Exact availability evidence accepted before a role share may activate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootAvailabilityEvidenceV1 {
    /// The owning role durably stored its independently encrypted current backup.
    CurrentRoleBackup {
        /// Digest of the role-signed backup receipt.
        role_backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        /// Logical root bound by the signature-verified backup.
        identity_digest: TenantRootIdentityDigestV1,
        /// Custody lineage bound by the signature-verified backup.
        custody_lineage: TenantRootCustodyLineageId,
        /// Owning role bound by the signature-verified backup.
        role: TenantRootManagedRestoreRoleV1,
        /// Custody epoch bound by the signature-verified backup.
        epoch: TenantRootShareEpoch,
        /// Public role-share commitment bound by the signature-verified backup.
        share_commitment: MpcPrfShareCommitmentWireV1,
    },
    /// The deployment accepted permanent derivation loss with a verified
    /// dual-authority authorization retained by the activation receipt.
    AcceptedPermanentDerivationLoss {
        /// Digest of the exact signed accepted-loss authorization bytes.
        authorization_digest: TenantRootAcceptedPermanentLossAuthorizationDigestV1,
        /// Logical root bound by the signed activation receipt.
        identity_digest: TenantRootIdentityDigestV1,
        /// Custody lineage bound by the signed activation receipt.
        custody_lineage: TenantRootCustodyLineageId,
        /// Owning role bound by the signed activation receipt.
        role: TenantRootManagedRestoreRoleV1,
        /// Custody epoch bound by the signed activation receipt.
        epoch: TenantRootShareEpoch,
        /// Public role-share commitment bound by the signed activation receipt.
        share_commitment: MpcPrfShareCommitmentWireV1,
    },
    /// The tenant retains the verified source recovery set outside this deployment.
    TenantHeldExternal {
        /// Exact destination-bound provenance retained from the signed activation receipt.
        provenance: TenantRootTenantHeldExternalProvenanceV1,
    },
}

impl Serialize for CloudflareTenantRootAvailabilityEvidenceV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::CurrentRoleBackup {
                role_backup_receipt_digest,
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
            } => {
                let mut state =
                    serializer.serialize_struct("CloudflareTenantRootAvailabilityEvidenceV1", 7)?;
                state.serialize_field("kind", "current_role_backup")?;
                state.serialize_field("role_backup_receipt_digest", role_backup_receipt_digest)?;
                state.serialize_field("identity_digest", identity_digest)?;
                state.serialize_field("custody_lineage", custody_lineage)?;
                state.serialize_field("role", role)?;
                state.serialize_field("epoch", epoch)?;
                state.serialize_field("share_commitment", share_commitment)?;
                state.end()
            }
            Self::AcceptedPermanentDerivationLoss {
                authorization_digest,
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
            } => {
                let mut state =
                    serializer.serialize_struct("CloudflareTenantRootAvailabilityEvidenceV1", 7)?;
                state.serialize_field("kind", "accepted_permanent_derivation_loss")?;
                state.serialize_field("authorization_digest", authorization_digest.as_bytes())?;
                state.serialize_field("identity_digest", identity_digest)?;
                state.serialize_field("custody_lineage", custody_lineage)?;
                state.serialize_field("role", role)?;
                state.serialize_field("epoch", epoch)?;
                state.serialize_field("share_commitment", share_commitment)?;
                state.end()
            }
            Self::TenantHeldExternal { provenance } => {
                let mut state = serializer
                    .serialize_struct("CloudflareTenantRootAvailabilityEvidenceV1", 14)?;
                state.serialize_field("kind", "tenant_held_external")?;
                state.serialize_field("identity_digest", &provenance.identity_digest())?;
                state.serialize_field("custody_lineage", &provenance.custody_lineage())?;
                state.serialize_field(
                    "destination_fingerprint",
                    provenance.destination_fingerprint().as_bytes(),
                )?;
                state.serialize_field(
                    "restore_session_id",
                    provenance.restore_session_id().as_bytes(),
                )?;
                state.serialize_field("recovery_set_id", &provenance.recovery_set_id())?;
                state.serialize_field("manifest_digest", provenance.manifest_digest())?;
                state.serialize_field(
                    "deriver_a_acceptance_receipt_digest",
                    &provenance.deriver_a_acceptance_receipt_digest(),
                )?;
                state.serialize_field(
                    "deriver_b_acceptance_receipt_digest",
                    &provenance.deriver_b_acceptance_receipt_digest(),
                )?;
                state.serialize_field(
                    "deriver_a_imported_commitment",
                    provenance.deriver_a_imported_commitment(),
                )?;
                state.serialize_field(
                    "deriver_b_imported_commitment",
                    provenance.deriver_b_imported_commitment(),
                )?;
                state.serialize_field(
                    "stable_root_commitment",
                    provenance.stable_root_commitment(),
                )?;
                state.serialize_field(
                    "restore_context_digest",
                    &provenance.restore_context_digest(),
                )?;
                state.serialize_field(
                    "restore_refresh_command_digest",
                    &provenance.restore_refresh_command_digest(),
                )?;
                state.end()
            }
        }
    }
}

impl CloudflareTenantRootAvailabilityEvidenceV1 {
    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        match self {
            Self::CurrentRoleBackup { .. } => Ok(()),
            Self::AcceptedPermanentDerivationLoss {
                authorization_digest,
                ..
            } => {
                if authorization_digest
                    .as_bytes()
                    .iter()
                    .all(|byte| *byte == 0)
                {
                    return Err(store_error(
                        "tenant-root accepted-loss authorization digest must be non-zero",
                    ));
                }
                Ok(())
            }
            Self::TenantHeldExternal { .. } => Ok(()),
        }
    }
}

/// Evidence required to activate one pending role-local share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootActivationV1 {
    pub(super) availability: CloudflareTenantRootAvailabilityEvidenceV1,
    #[serde(
        rename = "activation_receipt_b64u",
        serialize_with = "serialize_activation_receipt_bytes"
    )]
    pub(super) activation_receipt_bytes: Vec<u8>,
    #[serde(skip)]
    pub(super) activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    #[serde(skip)]
    pub(super) activated_at_ms: u64,
}

impl CloudflareTenantRootActivationV1 {
    /// Creates one activation backed by the role's current managed backup.
    pub fn with_current_role_backup(
        record: &CloudflareTenantRootRoleShareRecordV1,
        verified_backup: &VerifiedTenantRootManagedBackupV1,
        activation_receipt: VerifiedTenantRootSignedActivationReceiptV1,
    ) -> RoleStoreResult<Self> {
        record.validate()?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
            return Err(store_error(
                "tenant-root activation requires a pending role-share record",
            ));
        };
        require_pending_activation_source(pending)?;
        let binding = verified_backup.binding();
        validate_activation_receipt_against_backup(&activation_receipt, verified_backup)?;
        let availability = CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            role_backup_receipt_digest: verified_backup.receipt_digest(),
            identity_digest: binding.identity_digest(),
            custody_lineage: binding.custody_lineage(),
            role: binding.role(),
            epoch: binding.epoch(),
            share_commitment: binding.share_commitment().clone(),
        };
        validate_activation_receipt_against_record(
            activation_receipt.canonical_bytes(),
            record,
            &availability,
        )?;
        Self::from_verified_receipt(availability, activation_receipt)
    }

    /// Creates one activation backed by a tenant-held external restore set.
    pub(crate) fn with_tenant_held_external(
        record: &CloudflareTenantRootRoleShareRecordV1,
        activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
    ) -> RoleStoreResult<Self> {
        record.validate()?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
            return Err(store_error(
                "tenant-root activation requires a pending role-share record",
            ));
        };
        require_pending_activation_source(pending)?;
        let provenance = activation_receipt
            .availability()
            .tenant_held_external_provenance()
            .ok_or_else(|| {
                store_error(
                    "tenant-root external activation requires tenant-held external provenance",
                )
            })?;
        validate_tenant_held_external_provenance_against_binding(
            provenance,
            activation_receipt.binding(),
        )?;
        let availability = CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal {
            provenance: provenance.clone(),
        };
        validate_activation_receipt_against_record(
            activation_receipt.canonical_bytes(),
            record,
            &availability,
        )?;
        Self::from_stored_receipt_bytes(availability, activation_receipt.canonical_bytes().to_vec())
    }

    /// Creates one activation backed by a verified dual-authority loss authorization.
    pub(crate) fn with_accepted_permanent_derivation_loss(
        record: &CloudflareTenantRootRoleShareRecordV1,
        activation_receipt: VerifiedTenantRootSignedActivationReceiptV1,
    ) -> RoleStoreResult<Self> {
        record.validate()?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
            return Err(store_error(
                "tenant-root activation requires a pending role-share record",
            ));
        };
        require_pending_activation_source(pending)?;
        let availability = accepted_loss_availability_from_verified_receipt(
            &activation_receipt,
            record.role.managed_restore_role(),
        )?;
        validate_activation_receipt_against_record(
            activation_receipt.canonical_bytes(),
            record,
            &availability,
        )?;
        Self::from_verified_receipt(availability, activation_receipt)
    }

    pub(super) fn from_verified_receipt(
        availability: CloudflareTenantRootAvailabilityEvidenceV1,
        activation_receipt: VerifiedTenantRootSignedActivationReceiptV1,
    ) -> RoleStoreResult<Self> {
        let activation_receipt_digest = activation_receipt.digest();
        let activated_at_ms = activation_receipt.activated_at_ms();
        let activation_receipt_bytes = activation_receipt.into_canonical_bytes();
        let activation = Self {
            availability,
            activation_receipt_bytes,
            activation_receipt_digest,
            activated_at_ms,
        };
        activation.validate()?;
        Ok(activation)
    }

    pub(super) fn from_stored_receipt_bytes(
        availability: CloudflareTenantRootAvailabilityEvidenceV1,
        activation_receipt_bytes: Vec<u8>,
    ) -> RoleStoreResult<Self> {
        let receipt = decode_activation_receipt_bytes(&activation_receipt_bytes)?;
        let activation_receipt_digest = receipt
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let activated_at_ms = receipt.activated_at_ms();
        let activation = Self {
            availability,
            activation_receipt_bytes,
            activation_receipt_digest,
            activated_at_ms,
        };
        activation.validate()?;
        Ok(activation)
    }

    /// Returns the exact canonical signed activation receipt bytes.
    pub fn activation_receipt_bytes(&self) -> &[u8] {
        &self.activation_receipt_bytes
    }

    /// Returns the digest derived from the exact canonical activation bytes.
    pub const fn activation_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.activation_receipt_digest
    }

    /// Returns the activation time derived from the signed receipt.
    pub const fn activated_at_ms(&self) -> u64 {
        self.activated_at_ms
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        self.availability.validate()?;
        let receipt = decode_activation_receipt_bytes(&self.activation_receipt_bytes)?;
        let digest = receipt
            .digest()
            .map_err(|error| store_error(error.message()))?;
        if digest != self.activation_receipt_digest
            || receipt.activated_at_ms() != self.activated_at_ms
        {
            return Err(store_error(
                "tenant-root activation receipt projection does not match its exact bytes",
            ));
        }
        require_timestamp("tenant-root activation timestamp", self.activated_at_ms)
    }

    pub(super) fn validate_for_record(
        &self,
        record: &CloudflareTenantRootRoleShareRecordV1,
    ) -> RoleStoreResult<()> {
        self.validate()?;
        let record_identity = record
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        match &self.availability {
            CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
                ..
            } => {
                if *identity_digest != record_identity
                    || *custody_lineage != record.custody_lineage
                    || *role != record.role.managed_restore_role()
                    || *epoch != record.epoch
                    || share_commitment != &record.share_commitment
                {
                    return Err(store_error(
                        "tenant-root managed-backup binding does not match the pending role share",
                    ));
                }
            }
            CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
                ..
            } => {
                if *identity_digest != record_identity
                    || *custody_lineage != record.custody_lineage
                    || *role != record.role.managed_restore_role()
                    || *epoch != record.epoch
                    || share_commitment != &record.share_commitment
                {
                    return Err(store_error(
                        "tenant-root accepted-loss binding does not match the pending role share",
                    ));
                }
            }
            CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { provenance } => {
                if provenance.identity_digest() != record_identity
                    || provenance.custody_lineage() != record.custody_lineage
                {
                    return Err(store_error(
                        "tenant-root tenant-held external binding does not match the pending role share",
                    ));
                }
            }
        }
        validate_activation_receipt_against_record(
            &self.activation_receipt_bytes,
            record,
            &self.availability,
        )?;
        Ok(())
    }
}

/// Active role-local tenant-root share retaining the exact activation receipt bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootActiveShareV1 {
    pub(super) pending: CloudflareTenantRootPendingShareV1,
    pub(super) activation: CloudflareTenantRootActivationV1,
}

impl CloudflareTenantRootActiveShareV1 {
    pub(super) fn from_pending(
        pending: CloudflareTenantRootPendingShareV1,
        activation: CloudflareTenantRootActivationV1,
    ) -> RoleStoreResult<Self> {
        require_pending_activation_source(&pending)?;
        let active = Self {
            pending,
            activation,
        };
        active.validate()?;
        Ok(active)
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        self.pending.validate()?;
        require_pending_activation_source(&self.pending)?;
        self.activation.validate()?;
        if self.activation.activated_at_ms < self.pending.staged_at_ms {
            return Err(store_error(
                "tenant-root activation predates role-share installation",
            ));
        }
        Ok(())
    }
}

/// Evidence required to retire one active role-local share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootRetirementV1 {
    pub(super) retirement_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    pub(super) retired_at_ms: u64,
}

impl CloudflareTenantRootRetirementV1 {
    /// Creates one signed forward-only retirement transition.
    pub fn new(
        retirement_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        retired_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        let retirement = Self {
            retirement_receipt_digest,
            retired_at_ms,
        };
        retirement.validate()?;
        Ok(retirement)
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        require_timestamp("tenant-root retirement timestamp", self.retired_at_ms)
    }
}

/// Retired role-local tenant-root share awaiting provider destruction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootRetiredShareV1 {
    pub(super) active: CloudflareTenantRootActiveShareV1,
    pub(super) retirement: CloudflareTenantRootRetirementV1,
}

impl CloudflareTenantRootRetiredShareV1 {
    pub(super) fn from_active(
        active: CloudflareTenantRootActiveShareV1,
        retirement: CloudflareTenantRootRetirementV1,
    ) -> RoleStoreResult<Self> {
        let retired = Self { active, retirement };
        retired.validate()?;
        Ok(retired)
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        self.active.validate()?;
        self.retirement.validate()?;
        if self.retirement.retired_at_ms < self.active.activation.activated_at_ms {
            return Err(store_error(
                "tenant-root retirement predates role-share activation",
            ));
        }
        Ok(())
    }
}

/// Exhaustive lifecycle for one persisted role-local share epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "state", rename_all = "snake_case")]
pub enum CloudflareTenantRootRoleShareLifecycleV1 {
    /// Installed and verified locally, with activation still pending.
    Pending(CloudflareTenantRootPendingShareV1),
    /// Selected as the one current epoch for this role and tenant.
    Active(CloudflareTenantRootActiveShareV1),
    /// Replaced by a newer active epoch and awaiting destruction.
    Retired(CloudflareTenantRootRetiredShareV1),
}

impl CloudflareTenantRootRoleShareLifecycleV1 {
    pub(super) fn as_str(&self) -> &'static str {
        match self {
            Self::Pending(_) => "pending",
            Self::Active(_) => "active",
            Self::Retired(_) => "retired",
        }
    }

    pub(super) fn event_at_ms(&self) -> u64 {
        match self {
            Self::Pending(state) => state.staged_at_ms,
            Self::Active(state) => state.activation.activated_at_ms,
            Self::Retired(state) => state.retirement.retired_at_ms,
        }
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        match self {
            Self::Pending(state) => state.validate(),
            Self::Active(state) => state.validate(),
            Self::Retired(state) => state.validate(),
        }
    }
}

/// Required fields for one role-private tenant-root share record.
pub(crate) struct CloudflareTenantRootRoleShareRecordInputV1 {
    /// Server-resolved logical root identity.
    pub identity: TenantRootIdentityV1,
    /// Random custody lineage for this physical share pair.
    pub custody_lineage: TenantRootCustodyLineageId,
    /// Monotonic role-share custody epoch.
    pub epoch: TenantRootShareEpoch,
    /// Exact Deriver role owning the record.
    pub role: CloudflareTenantRootDeriverRoleV1,
    /// Epoch-provider ciphertext containing one canonical role share.
    pub(crate) sealed_share: CloudflareTenantRootSealedRoleShareV1,
    /// Public commitment to the sealed role share.
    pub share_commitment: MpcPrfShareCommitmentWireV1,
    /// Opaque external key-version reference needed to open the sealed share.
    pub epoch_wrapping_key_ref: String,
    /// Current lifecycle branch.
    pub lifecycle: CloudflareTenantRootRoleShareLifecycleV1,
    /// Initial durable creation time.
    pub created_at_ms: u64,
    /// Last successful lifecycle update time.
    pub updated_at_ms: u64,
}

/// Encrypted-at-rest record for one role's tenant-root share epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootRoleShareRecordV1 {
    pub(super) identity: TenantRootIdentityV1,
    pub(super) custody_lineage: TenantRootCustodyLineageId,
    pub(super) epoch: TenantRootShareEpoch,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) sealed_share: CloudflareTenantRootSealedRoleShareV1,
    pub(super) share_commitment: MpcPrfShareCommitmentWireV1,
    pub(super) epoch_wrapping_key_ref: String,
    pub(super) lifecycle: CloudflareTenantRootRoleShareLifecycleV1,
    pub(super) created_at_ms: u64,
    pub(super) updated_at_ms: u64,
}

impl CloudflareTenantRootRoleShareRecordV1 {
    /// Validates and normalizes one role-private share record.
    pub fn new(input: CloudflareTenantRootRoleShareRecordInputV1) -> RoleStoreResult<Self> {
        let record = Self {
            identity: input.identity,
            custody_lineage: input.custody_lineage,
            epoch: input.epoch,
            role: input.role,
            sealed_share: input.sealed_share,
            share_commitment: input.share_commitment,
            epoch_wrapping_key_ref: input.epoch_wrapping_key_ref,
            lifecycle: input.lifecycle,
            created_at_ms: input.created_at_ms,
            updated_at_ms: input.updated_at_ms,
        };
        record.validate()?;
        Ok(record)
    }

    /// Returns the server-resolved logical root identity.
    pub fn identity(&self) -> &TenantRootIdentityV1 {
        &self.identity
    }

    /// Returns the physical custody lineage.
    pub const fn custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.custody_lineage
    }

    /// Returns the role-share custody epoch.
    pub const fn epoch(&self) -> TenantRootShareEpoch {
        self.epoch
    }

    /// Returns the exact owning Deriver role.
    pub const fn role(&self) -> CloudflareTenantRootDeriverRoleV1 {
        self.role
    }

    /// Returns the epoch-provider sealed share ciphertext.
    pub(crate) const fn sealed_share(&self) -> &CloudflareTenantRootSealedRoleShareV1 {
        &self.sealed_share
    }

    /// Returns the public share commitment.
    pub const fn share_commitment(&self) -> &MpcPrfShareCommitmentWireV1 {
        &self.share_commitment
    }

    /// Returns the opaque epoch wrapping-key reference.
    pub fn epoch_wrapping_key_ref(&self) -> &str {
        &self.epoch_wrapping_key_ref
    }

    /// Returns the exhaustive lifecycle branch.
    pub const fn lifecycle(&self) -> &CloudflareTenantRootRoleShareLifecycleV1 {
        &self.lifecycle
    }

    /// Returns the last timestamp durably written with this row.
    pub(crate) const fn updated_at_ms(&self) -> u64 {
        self.updated_at_ms
    }

    pub(super) fn into_online_role_share_artifact(self) -> RoleStoreResult<TenantRootSealedOnlineRoleShareV1> {
        let installation_evidence_digest = match &self.lifecycle {
            CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
                active.pending.installation_evidence_digest()
            }
            _ => {
                return Err(store_error(
                    "tenant-root online role-share artifact requires an active record",
                ));
            }
        };
        self.validate()?;
        validate_record_activation_binding(&self)?;
        self.into_online_role_share_artifact_with_installation_evidence_digest(
            installation_evidence_digest,
        )
    }

    pub(super) fn into_online_role_share_artifact_with_installation_evidence_digest(
        self,
        installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
    ) -> RoleStoreResult<TenantRootSealedOnlineRoleShareV1> {
        let identity_digest = self
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let ciphertext = decode_base64url_bytes_v1(
            "tenant-root sealed role share",
            self.sealed_share.ciphertext_b64u(),
        )
        .map_err(|error| store_error(error.message()))?;
        let binding = TenantRootOnlineRoleShareBindingV1::from_persisted(
            identity_digest,
            self.custody_lineage,
            protocol_role_for_cloudflare(self.role),
            self.epoch,
            self.share_commitment,
            self.epoch_wrapping_key_ref,
            installation_evidence_digest,
        )
        .map_err(|error| store_error(error.message()))?;
        TenantRootSealedOnlineRoleShareV1::from_persisted(binding, ciphertext)
            .map_err(|error| store_error(error.message()))
    }

    pub(super) fn identity_digest_hex(&self) -> RoleStoreResult<String> {
        self.identity
            .digest()
            .map(|digest| encode_hex(digest.as_bytes()))
            .map_err(|error| store_error(error.message()))
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        self.sealed_share.validate()?;
        self.lifecycle.validate()?;
        require_identifier(
            "tenant-root epoch wrapping-key reference",
            &self.epoch_wrapping_key_ref,
        )?;
        require_timestamp("tenant-root record creation timestamp", self.created_at_ms)?;
        require_timestamp("tenant-root record update timestamp", self.updated_at_ms)?;
        if self.updated_at_ms < self.created_at_ms
            || self.lifecycle.event_at_ms() < self.created_at_ms
            || self.lifecycle.event_at_ms() > self.updated_at_ms
        {
            return Err(store_error(
                "tenant-root role-share lifecycle timestamps are inconsistent",
            ));
        }
        validate_tenant_root_active_role_share_commitment_v1(
            self.role.managed_restore_role(),
            &self.share_commitment,
        )
        .map_err(|error| store_error(error.message()))?;
        epoch_i64(self.epoch)?;
        timestamp_i64(self.created_at_ms)?;
        timestamp_i64(self.updated_at_ms)?;
        Ok(())
    }

    pub(super) fn into_active(
        mut self,
        activation: CloudflareTenantRootActivationV1,
        updated_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        require_lifecycle_progression(
            "tenant-root activation",
            self.updated_at_ms,
            activation.activated_at_ms,
            updated_at_ms,
        )?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &self.lifecycle else {
            return Err(store_error(
                "only a pending tenant-root role share can become active",
            ));
        };
        require_pending_activation_source(pending)?;
        activation.validate_for_record(&self)?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = self.lifecycle else {
            unreachable!("pending lifecycle was checked before activation");
        };
        let active = CloudflareTenantRootActiveShareV1::from_pending(pending, activation)?;
        self.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Active(active);
        self.updated_at_ms = updated_at_ms;
        self.validate()?;
        Ok(self)
    }

    pub(super) fn into_retired(
        mut self,
        retirement: CloudflareTenantRootRetirementV1,
        updated_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        require_lifecycle_progression(
            "tenant-root retirement",
            self.updated_at_ms,
            retirement.retired_at_ms,
            updated_at_ms,
        )?;
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = self.lifecycle else {
            return Err(store_error(
                "only an active tenant-root role share can become retired",
            ));
        };
        let retired = CloudflareTenantRootRetiredShareV1::from_active(active, retirement)?;
        self.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Retired(retired);
        self.updated_at_ms = updated_at_ms;
        self.validate()?;
        Ok(self)
    }
}

/// One versioned record read from the primary role-private D1 session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudflareStoredTenantRootRoleShareV1 {
    pub(super) record: CloudflareTenantRootRoleShareRecordV1,
    pub(super) revision: i64,
}

impl CloudflareStoredTenantRootRoleShareV1 {
    /// Returns the validated encrypted-record plaintext.
    pub const fn record(&self) -> &CloudflareTenantRootRoleShareRecordV1 {
        &self.record
    }

    /// Returns the positive compare-and-set revision.
    pub const fn revision(&self) -> i64 {
        self.revision
    }

    /// Returns the validated public binding for this active role share.
    pub(crate) fn active_binding(&self) -> RoleStoreResult<TenantRootActiveRoleBindingV1> {
        active_binding_from_stored(self)
    }

    /// Returns the exact activation receipt retained by an active row.
    pub(crate) fn active_activation_receipt_bytes(&self) -> RoleStoreResult<&[u8]> {
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = &self.record.lifecycle
        else {
            return Err(store_error(
                "tenant-root initial activation retry requires an active record",
            ));
        };
        Ok(active.activation.activation_receipt_bytes())
    }

    pub(crate) fn retained_activation_receipt_bytes(&self) -> RoleStoreResult<&[u8]> {
        match &self.record.lifecycle {
            CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
                Ok(active.activation.activation_receipt_bytes())
            }
            CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
                Ok(retired.active.activation.activation_receipt_bytes())
            }
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => Err(store_error(
                "tenant-root retained activation receipt requires an active or retired record",
            )),
        }
    }

    /// Reconstructs the exact pending revision consumed by initial activation.
    pub(crate) fn initial_activation_retry_pending(&self) -> RoleStoreResult<Self> {
        self.record.validate()?;
        if self.record.epoch != TenantRootShareEpoch::INITIAL {
            return Err(store_error(
                "tenant-root initial activation retry requires epoch 1",
            ));
        }
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = &self.record.lifecycle
        else {
            return Err(store_error(
                "tenant-root initial activation retry requires an active record",
            ));
        };
        let revision = self
            .revision
            .checked_sub(1)
            .filter(|revision| *revision > 0)
            .ok_or_else(|| {
                store_error("tenant-root initial activation retry has no prior pending revision")
            })?;
        let mut record = self.record.clone();
        record.lifecycle =
            CloudflareTenantRootRoleShareLifecycleV1::Pending(active.pending.clone());
        record.updated_at_ms = active.pending.staged_at_ms;
        record.validate()?;
        Ok(Self { record, revision })
    }

    /// Reconstructs the exact pending revision consumed by a refresh activation.
    pub(crate) fn refresh_activation_retry_pending(&self) -> RoleStoreResult<Self> {
        self.record.validate()?;
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = &self.record.lifecycle
        else {
            return Err(store_error(
                "tenant-root refresh activation retry requires an active successor",
            ));
        };
        let revision = self
            .revision
            .checked_sub(1)
            .filter(|revision| *revision > 0)
            .ok_or_else(|| {
                store_error("tenant-root refresh activation retry has no prior pending revision")
            })?;
        let mut record = self.record.clone();
        record.lifecycle =
            CloudflareTenantRootRoleShareLifecycleV1::Pending(active.pending.clone());
        record.updated_at_ms = active.pending.staged_at_ms;
        record.validate()?;
        Ok(Self { record, revision })
    }

    /// Reconstructs the opaque provider artifact from one validated active D1 record.
    pub(crate) fn into_online_role_share_artifact(
        self,
    ) -> RoleStoreResult<TenantRootSealedOnlineRoleShareV1> {
        validate_active_stored_record_shape(&self)?;
        self.record.into_online_role_share_artifact()
    }

}

/// The execution attempt one root-use admission belongs to
/// (docs/archive/refactor-150-155.md, "Tenant-root lifecycle").
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRootUseAttemptV1 {
    /// One Ed25519 Yao ceremony, named by its canonical pair session: the key
    /// both pair stores keep its records under. It stays on the epoch it was
    /// admitted on.
    Ed25519YaoPairSession {
        session: [u8; 32],
        /// The wallet object that holds this role's pair record, or `None`
        /// when it is in this role store. It is bound at admission.
        pair_object: Option<String>,
    },
    /// One ECDSA operation on the binding's epoch. The same request re-sent
    /// after a refresh is a new attempt on the new epoch.
    EcdsaOperation,
}

impl TenantRootRootUseAttemptV1 {
    pub(super) const fn kind(&self) -> &'static str {
        match self {
            Self::Ed25519YaoPairSession { .. } => TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1,
            Self::EcdsaOperation => "ecdsa_operation",
        }
    }

    pub(super) fn pair_object_id(&self) -> Option<&str> {
        match self {
            Self::Ed25519YaoPairSession { pair_object, .. } => pair_object.as_deref(),
            Self::EcdsaOperation => None,
        }
    }

    pub(super) fn key_hex(&self, custody_binding: &TenantRootCustodyBindingV1) -> String {
        match self {
            Self::Ed25519YaoPairSession { session, .. } => encode_hex(session),
            Self::EcdsaOperation => format!(
                "{}{:016x}",
                encode_hex(custody_binding.operation_id().as_bytes()),
                custody_binding.epoch().get().get()
            ),
        }
    }
}

/// Whether an operation named by a custody binding is admitted on the
/// binding's epoch at this role.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TenantRootRootUseAdmissionV1 {
    /// Admitted now, or earlier while the epoch was active.
    Admitted,
    /// A refresh retired the epoch here before this operation was admitted.
    EpochClosed,
    /// The epoch is committed but this role has not yet activated it.
    NotYetActive,
    /// This attempt was admitted under a binding that differs in more than
    /// its window: another epoch, or another operation on the same session.
    AttemptConflict,
    /// Recovery cancelled this attempt here; it may take no further step.
    Cancelled,
    /// This attempt settled, and its retired epoch has since been erased
    /// here; it can read nothing more.
    Erased,
}

/// What a wallet object reports for one pair session when the role store
/// that owns its admission reconciles it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TenantRootWalletPairReconciliationV1 {
    /// The pair completed in the object: its admission settles.
    Completed,
    /// The object fenced the pair: it can neither start nor complete there,
    /// so its admission can be cancelled.
    Fenced,
    /// Deriver A's executor claimed the pair. Its messages may still reach
    /// Deriver B, so only its completion ends it.
    Claimed,
    /// Neither completed nor fenced. The object was not asked to fence.
    Open,
}

/// Role store to wallet object: report one pair session's outcome and, when
/// `fence` is set, fence it unless it is claimed or completed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TenantRootWalletPairReconcileRequestV1 {
    pub session_hex: String,
    pub fence: bool,
    /// Deriver B has answered that it completed the pair or can no longer
    /// complete it. Deriver A's executor then cannot complete it either, so
    /// Deriver A's object may fence even a claimed pair.
    pub peer_settled: bool,
    pub now_ms: u64,
}

/// One Yao attempt's admission at this role, as a peer's recovery sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TenantRootYaoAdmissionStateV1 {
    pub(crate) status: String,
    pub(crate) pair_object_id: Option<String>,
}

/// One unsettled admission whose pair a wallet object holds.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub(crate) struct TenantRootWalletObjectAdmissionV1 {
    pub(crate) attempt_key_hex: String,
    pub(crate) pair_object_id: String,
    pub(crate) admitted_at_ms: i64,
}

/// Which commit decided one attempt's admission when it tried to settle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TenantRootSettlementOutcomeV1 {
    /// This settlement moved the admission from admitted to settled.
    Won,
    /// The same attempt had already settled here; this is its replay.
    AlreadySettled,
    /// Recovery cancelled the attempt first. It may take no further step.
    CancellationWon,
}

/// The role share a custody binding names, if its operation may read it.
#[derive(Debug)]
pub(crate) enum TenantRootBoundShareV1 {
    Readable(TenantRootSealedOnlineRoleShareV1),
    EpochClosed,
    NotYetActive,
    AttemptConflict,
    Cancelled,
    Erased,
}

/// Exhaustive role-private active-share resolution for one authenticated tenant.
#[derive(Debug)]
pub enum CloudflareTenantRootActiveRoleShareV1 {
    /// This role holds no active share for the authenticated tenant root.
    Unprovisioned,
    /// Exactly one active share exists.
    Active(Box<CloudflareStoredTenantRootRoleShareV1>),
    /// More than one active share exists; reconciliation may observe this.
    Ambiguous(TenantRootActiveRoleAmbiguityV1),
}

impl CloudflareTenantRootActiveRoleShareV1 {
    pub(super) fn from_stored(stored: CloudflareStoredTenantRootRoleShareV1) -> RoleStoreResult<Self> {
        active_binding_from_stored(&stored)?;
        Ok(Self::Active(Box::new(stored)))
    }

    /// Returns the one active share, or fails closed.
    ///
    /// Derivation and runtime callers use this; reconciliation matches the
    /// variants directly so it can observe ambiguity without deriving from it.
    pub fn require_active(self) -> RoleStoreResult<CloudflareStoredTenantRootRoleShareV1> {
        match self {
            Self::Active(stored) => {
                validate_active_stored_record_shape(stored.as_ref())?;
                Ok(*stored)
            }
            Self::Unprovisioned => Err(store_error(
                "authenticated tenant root has no active role share",
            )),
            Self::Ambiguous(_) => Err(store_error(
                "authenticated tenant root resolves to more than one active role share",
            )),
        }
    }
}

impl CloudflareTenantRootActiveRoleShareV1 {
    /// Returns this role's public resolution, leaving every sealed value behind.
    ///
    /// Pair resolution consumes only this. A Deriver never receives its peer's
    /// opened record, so assembling a pair cannot move sealed share material
    /// across the role boundary.
    pub(crate) fn public_resolution(&self) -> RoleStoreResult<TenantRootActiveRoleResolutionV1> {
        match self {
            Self::Unprovisioned => Ok(TenantRootActiveRoleResolutionV1::Unprovisioned),
            Self::Active(stored) => Ok(TenantRootActiveRoleResolutionV1::Active(
                active_binding_from_stored(stored.as_ref())?,
            )),
            Self::Ambiguous(ambiguity) => Ok(TenantRootActiveRoleResolutionV1::Ambiguous(
                ambiguity.clone(),
            )),
        }
    }
}

/// Observes one authenticated tenant's active Deriver A/B root pair.
///
/// Each role's private store answers for itself, so this is where the two
/// halves meet for reconciliation. This intentionally does not authorize
/// derivation; callers that need a usable pair must supply the authority-derived
/// custody binding through `cloudflare_resolve_active_tenant_root_pair_v1`.
pub(crate) fn cloudflare_observe_active_tenant_root_pair_v1(
    identity: &TenantRootIdentityV1,
    deriver_a: &CloudflareTenantRootActiveRoleShareV1,
    deriver_b: &CloudflareTenantRootActiveRoleShareV1,
) -> RoleStoreResult<TenantRootActivePairResolutionV1> {
    let identity_digest = identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let deriver_a = deriver_a.public_resolution()?;
    let deriver_b = deriver_b.public_resolution()?;
    resolve_active_tenant_root_pair_binding_v1(identity_digest, &deriver_a, &deriver_b)
        .map_err(|error| store_error(error.message()))
}

/// Resolves one active root pair against the authority-derived custody binding.
///
/// The custody binding supplies the authenticated identity, lineage, epoch,
/// commitments, root commitment, and activation receipt expected from both
/// private stores. An observed pair is never sufficient for derivation.
pub(crate) fn cloudflare_resolve_active_tenant_root_pair_v1(
    custody_binding: &TenantRootCustodyBindingV1,
    deriver_a: &CloudflareTenantRootActiveRoleShareV1,
    deriver_b: &CloudflareTenantRootActiveRoleShareV1,
) -> RoleStoreResult<TenantRootActivePairResolutionV1> {
    let identity_digest = custody_binding.identity_digest();
    let deriver_a = deriver_a.public_resolution()?;
    let deriver_b = deriver_b.public_resolution()?;
    resolve_authoritative_active_tenant_root_pair_binding_v1(
        identity_digest,
        custody_binding,
        &deriver_a,
        &deriver_b,
    )
    .map_err(|error| store_error(error.message()))
}

/// Returns the one authority-matching active root pair, or fails closed.
///
/// Reconciliation calls `cloudflare_observe_active_tenant_root_pair_v1` instead
/// so it can observe an unsafe state without deriving from it.
pub(crate) fn cloudflare_require_active_tenant_root_pair_v1(
    custody_binding: &TenantRootCustodyBindingV1,
    deriver_a: &CloudflareTenantRootActiveRoleShareV1,
    deriver_b: &CloudflareTenantRootActiveRoleShareV1,
) -> RoleStoreResult<TenantRootActiveRootPairV1> {
    let resolution =
        cloudflare_resolve_active_tenant_root_pair_v1(custody_binding, deriver_a, deriver_b)?;
    let pair = resolution
        .require_active()
        .map_err(|error| store_error(error.message()))?;
    Ok(pair.clone())
}
