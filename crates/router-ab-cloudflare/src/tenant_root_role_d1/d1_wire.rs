//! D1 AAD, ciphertext and row wire structs of the role-share records, and the KEK checks.

use super::*;

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRoleD1AadV1<'a> {
    pub(super) environment: &'a str,
    pub(super) worker_role: CloudflareTenantRootDeriverRoleV1,
    pub(super) tenant_identity_digest_hex: &'a str,
    pub(super) custody_lineage_b64u: &'a str,
    pub(super) tenant_root_share_epoch: u64,
    pub(super) record_role: CloudflareTenantRootDeriverRoleV1,
    pub(super) lifecycle: &'a str,
    pub(super) revision: i64,
    pub(super) purpose: &'static str,
    pub(super) schema: &'static str,
    pub(super) record_key: &'a str,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRoleD1CiphertextV1 {
    pub(super) key_version: String,
    pub(super) tenant_identity_digest_hex: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) tenant_root_share_epoch: u64,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) lifecycle: String,
    pub(super) ciphertext_b64u: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRoleD1RecordWireV1 {
    pub(super) identity: TenantRootIdentityV1,
    pub(super) custody_lineage: TenantRootCustodyLineageId,
    pub(super) epoch: TenantRootShareEpoch,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) sealed_share: CloudflareTenantRootSealedRoleShareV1,
    pub(super) share_commitment: MpcPrfShareCommitmentWireV1,
    pub(super) epoch_wrapping_key_ref: String,
    pub(super) lifecycle: TenantRootRoleD1LifecycleWireV1,
    pub(super) created_at_ms: u64,
    pub(super) updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    content = "state",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub(super) enum TenantRootRoleD1LifecycleWireV1 {
    Pending(TenantRootRoleD1PendingWireV1),
    Active(TenantRootRoleD1ActiveWireV1),
    Retired(TenantRootRoleD1RetiredWireV1),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRoleD1PendingWireV1 {
    pub(super) installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
    pub(super) staged_at_ms: u64,
    pub(super) origin: CloudflareTenantRootPendingShareOriginV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRoleD1ActiveWireV1 {
    pub(super) pending: TenantRootRoleD1PendingWireV1,
    pub(super) activation: TenantRootRoleD1ActivationWireV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRoleD1RetiredWireV1 {
    pub(super) active: TenantRootRoleD1ActiveWireV1,
    pub(super) retirement: TenantRootRoleD1RetirementWireV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRoleD1ActivationWireV1 {
    pub(super) availability: TenantRootRoleD1AvailabilityWireV1,
    pub(super) activation_receipt_b64u: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum TenantRootRoleD1AvailabilityWireV1 {
    CurrentRoleBackup {
        role_backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        role: TenantRootManagedRestoreRoleV1,
        epoch: TenantRootShareEpoch,
        share_commitment: MpcPrfShareCommitmentWireV1,
    },
    AcceptedPermanentDerivationLoss {
        authorization_digest: [u8; 32],
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        role: TenantRootManagedRestoreRoleV1,
        epoch: TenantRootShareEpoch,
        share_commitment: MpcPrfShareCommitmentWireV1,
    },
    TenantHeldExternal {
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        destination_fingerprint: [u8; 32],
        restore_session_id: [u8; 16],
        recovery_set_id: TenantRootRecoverySetId,
        manifest_digest: [u8; 32],
        deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        deriver_a_imported_commitment: MpcPrfShareCommitmentWireV1,
        deriver_b_imported_commitment: MpcPrfShareCommitmentWireV1,
        stable_root_commitment: [u8; 32],
        restore_context_digest: TenantRootProtocolDigestV1,
        restore_refresh_command_digest: TenantRootProtocolDigestV1,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRoleD1RetirementWireV1 {
    pub(super) retirement_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    pub(super) retired_at_ms: u64,
}

impl TenantRootRoleD1RecordWireV1 {
    pub(super) fn into_record(self) -> RoleStoreResult<CloudflareTenantRootRoleShareRecordV1> {
        CloudflareTenantRootRoleShareRecordV1::new(CloudflareTenantRootRoleShareRecordInputV1 {
            identity: self.identity,
            custody_lineage: self.custody_lineage,
            epoch: self.epoch,
            role: self.role,
            sealed_share: self.sealed_share,
            share_commitment: self.share_commitment,
            epoch_wrapping_key_ref: self.epoch_wrapping_key_ref,
            lifecycle: self.lifecycle.into_lifecycle()?,
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
        })
    }
}

impl TenantRootRoleD1LifecycleWireV1 {
    pub(super) fn into_lifecycle(self) -> RoleStoreResult<CloudflareTenantRootRoleShareLifecycleV1> {
        match self {
            Self::Pending(pending) => Ok(CloudflareTenantRootRoleShareLifecycleV1::Pending(
                pending.into_pending()?,
            )),
            Self::Active(active) => Ok(CloudflareTenantRootRoleShareLifecycleV1::Active(
                active.into_active()?,
            )),
            Self::Retired(retired) => Ok(CloudflareTenantRootRoleShareLifecycleV1::Retired(
                retired.into_retired()?,
            )),
        }
    }
}

impl TenantRootRoleD1PendingWireV1 {
    pub(super) fn into_pending(self) -> RoleStoreResult<CloudflareTenantRootPendingShareV1> {
        CloudflareTenantRootPendingShareV1::from_stored_digest_with_origin(
            self.installation_evidence_digest,
            self.staged_at_ms,
            self.origin,
        )
    }
}

impl TenantRootRoleD1ActiveWireV1 {
    pub(super) fn into_active(self) -> RoleStoreResult<CloudflareTenantRootActiveShareV1> {
        CloudflareTenantRootActiveShareV1::from_pending(
            self.pending.into_pending()?,
            self.activation.into_activation()?,
        )
    }
}

impl TenantRootRoleD1RetiredWireV1 {
    pub(super) fn into_retired(self) -> RoleStoreResult<CloudflareTenantRootRetiredShareV1> {
        CloudflareTenantRootRetiredShareV1::from_active(
            self.active.into_active()?,
            self.retirement.into_retirement()?,
        )
    }
}

impl TenantRootRoleD1ActivationWireV1 {
    pub(super) fn into_activation(self) -> RoleStoreResult<CloudflareTenantRootActivationV1> {
        let receipt_bytes = decode_base64url_bytes_v1(
            "tenant-root activation receipt",
            &self.activation_receipt_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&receipt_bytes) != self.activation_receipt_b64u {
            return Err(store_error(
                "tenant-root activation receipt bytes are not canonical base64url",
            ));
        }
        let receipt = decode_activation_receipt_bytes(&receipt_bytes)?;
        CloudflareTenantRootActivationV1::from_stored_receipt_bytes(
            self.availability
                .into_availability(receipt.availability())?,
            receipt_bytes,
        )
    }
}

impl TenantRootRoleD1AvailabilityWireV1 {
    pub(super) fn into_availability(
        self,
        receipt_availability: &TenantRootActivationReceiptAvailabilityV1,
    ) -> RoleStoreResult<CloudflareTenantRootAvailabilityEvidenceV1> {
        Ok(match self {
            Self::CurrentRoleBackup {
                role_backup_receipt_digest,
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
            } => {
                let TenantRootActivationReceiptAvailabilityV1::CurrentRoleBackups { receipts } =
                    receipt_availability
                else {
                    return Err(store_error(
                        "tenant-root current-backup availability does not match activation receipt",
                    ));
                };
                let receipt_digest = match role {
                    TenantRootManagedRestoreRoleV1::DeriverA => receipts.deriver_a(),
                    TenantRootManagedRestoreRoleV1::DeriverB => receipts.deriver_b(),
                };
                if receipt_digest != role_backup_receipt_digest {
                    return Err(store_error(
                        "tenant-root current-backup receipt digest does not match activation receipt",
                    ));
                }
                CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
                    role_backup_receipt_digest,
                    identity_digest,
                    custody_lineage,
                    role,
                    epoch,
                    share_commitment,
                }
            }
            Self::AcceptedPermanentDerivationLoss {
                authorization_digest,
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
            } => {
                let TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss {
                    authorization_digest: receipt_digest,
                    ..
                } = receipt_availability
                else {
                    return Err(store_error(
                        "tenant-root accepted-loss availability does not match activation receipt",
                    ));
                };
                if receipt_digest.as_bytes() != &authorization_digest {
                    return Err(store_error(
                        "tenant-root accepted-loss authorization digest does not match activation receipt",
                    ));
                }
                CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
                    authorization_digest: *receipt_digest,
                    identity_digest,
                    custody_lineage,
                    role,
                    epoch,
                    share_commitment,
                }
            }
            Self::TenantHeldExternal {
                identity_digest,
                custody_lineage,
                destination_fingerprint,
                restore_session_id,
                recovery_set_id,
                manifest_digest,
                deriver_a_acceptance_receipt_digest,
                deriver_b_acceptance_receipt_digest,
                deriver_a_imported_commitment,
                deriver_b_imported_commitment,
                stable_root_commitment,
                restore_context_digest,
                restore_refresh_command_digest,
            } => {
                let TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { provenance } =
                    receipt_availability
                else {
                    return Err(store_error(
                        "tenant-root tenant-held external availability does not match activation receipt",
                    ));
                };
                if provenance.identity_digest() != identity_digest
                    || provenance.custody_lineage() != custody_lineage
                    || provenance.destination_fingerprint().as_bytes() != &destination_fingerprint
                    || provenance.restore_session_id().as_bytes() != &restore_session_id
                    || provenance.recovery_set_id() != recovery_set_id
                    || provenance.manifest_digest() != &manifest_digest
                    || provenance.deriver_a_acceptance_receipt_digest()
                        != deriver_a_acceptance_receipt_digest
                    || provenance.deriver_b_acceptance_receipt_digest()
                        != deriver_b_acceptance_receipt_digest
                    || provenance.deriver_a_imported_commitment() != &deriver_a_imported_commitment
                    || provenance.deriver_b_imported_commitment() != &deriver_b_imported_commitment
                    || provenance.stable_root_commitment() != &stable_root_commitment
                    || provenance.restore_context_digest() != restore_context_digest
                    || provenance.restore_refresh_command_digest() != restore_refresh_command_digest
                {
                    return Err(store_error(
                        "tenant-root tenant-held external availability does not match activation receipt",
                    ));
                }
                CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal {
                    provenance: provenance.clone(),
                }
            }
        })
    }
}

impl TenantRootRoleD1RetirementWireV1 {
    pub(super) fn into_retirement(self) -> RoleStoreResult<CloudflareTenantRootRetirementV1> {
        CloudflareTenantRootRetirementV1::new(self.retirement_receipt_digest, self.retired_at_ms)
    }
}

pub(super) fn validate_role_private_d1_kek_key_pair(
    public_key: &<CloudflareHpkeKemV1 as Kem>::PublicKey,
    private_key: &<CloudflareHpkeKemV1 as Kem>::PrivateKey,
) -> RoleStoreResult<()> {
    let mut rng = CloudflareHpkeGetrandomRngV1;
    let (encapped_shared_secret, encapped_key) =
        match CloudflareHpkeKemV1::encap(&mut rng, public_key) {
            Ok(pair) => pair,
            Err(error) => {
                return Err(store_error(format!(
                    "role-private D1 KEK public key validation failed: {error}"
                )));
            }
        };
    let decapped_shared_secret =
        CloudflareHpkeKemV1::decap(&encapped_key, private_key).map_err(|error| {
            store_error(format!(
                "role-private D1 KEK private key validation failed: {error}"
            ))
        })?;
    if !constant_time_bytes_equal(
        encapped_shared_secret.as_ref(),
        decapped_shared_secret.as_ref(),
    ) {
        return Err(store_error(
            "role-private D1 KEK public key does not match private key",
        ));
    }
    Ok(())
}

pub(super) fn constant_time_bytes_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (left, right) in left.iter().zip(right) {
        difference |= left ^ right;
    }
    difference == 0
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TenantRootRoleD1MetadataV1 {
    pub(super) identity_digest_hex: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) epoch: u64,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) lifecycle: String,
}

impl TenantRootRoleD1MetadataV1 {
    pub(super) fn record_key(&self) -> String {
        format!(
            "{}/{}/{}/{}",
            self.identity_digest_hex,
            self.custody_lineage_b64u,
            self.epoch,
            self.role.as_str()
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(super) struct TenantRootRoleD1RowV1 {
    pub(super) tenant_identity_digest_hex: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) tenant_root_share_epoch: i64,
    pub(super) role: String,
    pub(super) lifecycle: String,
    pub(super) ciphertext_json: String,
    pub(super) revision: i64,
    pub(super) created_at_ms: i64,
    pub(super) updated_at_ms: i64,
}
