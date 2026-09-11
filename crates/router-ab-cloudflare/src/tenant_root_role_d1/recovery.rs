use super::*;
use router_ab_core::VerifiedTenantRootRecoveryReshareRoleCommandV1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RecoveryAttemptStateV1 {
    Provisioning,
    Pending {
        encrypted_material_b64u: String,
    },
    Packaged {
        encrypted_package_b64u: String,
        package_digest_b64u: String,
        descriptor_b64u: String,
        package_length: u32,
    },
    Destroying,
    DestructionScheduled {
        receipt: String,
    },
    Destroyed {
        receipt: String,
    },
}

#[derive(Deserialize)]
struct RecoveryAttemptRow {
    role: String,
    command_b64u: String,
    lifecycle: String,
    encrypted_material_b64u: Option<String>,
    encrypted_package_b64u: Option<String>,
    package_digest_b64u: Option<String>,
    destruction_receipt: Option<String>,
    descriptor_b64u: Option<String>,
    package_length: Option<u32>,
}

fn require_ciphertext(value: &str) -> worker::Result<()> {
    if value.len() > 90_000 {
        return Err(store_error("recovery ciphertext exceeds storage limit"));
    }
    let bytes = decode_base64url_bytes_v1("recovery ciphertext", value)
        .map_err(|e| store_error(e.message()))?;
    if bytes.is_empty() || encode_base64url_bytes_v1(&bytes) != value {
        return Err(store_error("invalid recovery ciphertext encoding"));
    }
    Ok(())
}

impl CloudflareTenantRootRoleShareStoreV1 {
    pub(crate) async fn load_recovery_attempt(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    ) -> worker::Result<Option<RecoveryAttemptStateV1>> {
        self.cipher.require_role(match command.role() {
            TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
            TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
        })?;
        let set_id = command.context().recovery_set_id().to_base64url();
        let row = self.session.prepare("SELECT role, command_b64u, lifecycle, encrypted_material_b64u, encrypted_package_b64u, package_digest_b64u, destruction_receipt, descriptor_b64u, package_length FROM tenant_root_recovery_attempts WHERE recovery_set_id_b64u = ?1")
            .bind_refs([D1Type::Text(&set_id)].iter())?.first::<RecoveryAttemptRow>(None).await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let command_bytes = command
            .canonical_bytes()
            .map_err(|e| store_error(e.message()))?;
        if row.role != command.role().as_str()
            || row.command_b64u != encode_base64url_bytes_v1(&command_bytes)
        {
            return Err(store_error(
                "recovery set was reused with a different signed command",
            ));
        }
        let metadata = match (
            row.lifecycle.as_str(),
            row.descriptor_b64u,
            row.package_length,
        ) {
            ("packaged", Some(descriptor_b64u), Some(package_length))
                if package_length > 0 && package_length <= 16 * 1024 =>
            {
                let bytes = decode_base64url_bytes_v1("recovery descriptor", &descriptor_b64u)
                    .map_err(|e| store_error(e.message()))?;
                let descriptor =
                    router_ab_core::TenantRootRecoveryDescriptorV1::from_canonical_json(&bytes)
                        .map_err(|e| store_error(e.message()))?;
                if encode_base64url_bytes_v1(&bytes) != descriptor_b64u
                    || descriptor.recovery_set_id() != command.context().recovery_set_id()
                    || descriptor.tenant_root_identity_digest()
                        != command.context().identity_digest()
                    || descriptor.source_custody_lineage()
                        != command.context().source_custody_lineage()
                {
                    return Err(store_error("stored recovery descriptor scope mismatch"));
                }
                Some((descriptor_b64u, package_length))
            }
            ("packaged", _, _) => {
                return Err(store_error("stored recovery package metadata is missing"))
            }
            (_, None, None) => None,
            _ => {
                return Err(store_error(
                    "recovery metadata exists outside packaged state",
                ))
            }
        };
        let state = match (
            row.lifecycle.as_str(),
            row.encrypted_material_b64u,
            row.encrypted_package_b64u,
            row.package_digest_b64u,
            row.destruction_receipt,
        ) {
            ("provisioning", None, None, None, None) => RecoveryAttemptStateV1::Provisioning,
            ("pending", Some(encrypted_material_b64u), None, None, None) => {
                require_ciphertext(&encrypted_material_b64u)?;
                RecoveryAttemptStateV1::Pending {
                    encrypted_material_b64u,
                }
            }
            ("packaged", None, Some(encrypted_package_b64u), Some(package_digest_b64u), None) => {
                require_ciphertext(&encrypted_package_b64u)?;
                let digest =
                    decode_base64url_bytes_v1("recovery package digest", &package_digest_b64u)
                        .map_err(|e| store_error(e.message()))?;
                if digest.len() != 32 || encode_base64url_bytes_v1(&digest) != package_digest_b64u {
                    return Err(store_error("invalid stored recovery package digest"));
                }
                let (descriptor_b64u, package_length) =
                    metadata.ok_or_else(|| store_error("packaged metadata missing"))?;
                RecoveryAttemptStateV1::Packaged {
                    encrypted_package_b64u,
                    package_digest_b64u,
                    descriptor_b64u,
                    package_length,
                }
            }
            ("destroying", None, None, None, None) => RecoveryAttemptStateV1::Destroying,
            ("destruction_scheduled", None, None, None, Some(receipt)) => {
                RecoveryAttemptStateV1::DestructionScheduled { receipt }
            }
            ("destroyed", None, None, None, Some(receipt)) => {
                RecoveryAttemptStateV1::Destroyed { receipt }
            }
            _ => return Err(store_error("invalid durable recovery lifecycle")),
        };
        Ok(Some(state))
    }

    pub(crate) async fn admit_recovery_attempt(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
        now_ms: u64,
    ) -> worker::Result<RecoveryAttemptStateV1> {
        if let Some(state) = self.load_recovery_attempt(command).await? {
            return Ok(state);
        }
        let context = command.context();
        if now_ms < context.issued_at_ms() || now_ms >= context.expires_at_ms() {
            return Err(store_error(
                "recovery admission is outside its signed lifetime",
            ));
        }
        let set_id = context.recovery_set_id().to_base64url();
        let identity = encode_hex(context.identity_digest().as_bytes());
        let lineage = context.source_custody_lineage().to_base64url();
        let bytes = command
            .canonical_bytes()
            .map_err(|e| store_error(e.message()))?;
        let encoded = encode_base64url_bytes_v1(&bytes);
        let timestamp = now_ms.to_string();
        self.session.prepare("INSERT INTO tenant_root_recovery_attempts (recovery_set_id_b64u, tenant_identity_digest_hex, custody_lineage_b64u, role, command_b64u, admitted_at_ms, lifecycle) VALUES (?1, ?2, ?3, ?4, ?5, CAST(?6 AS INTEGER), 'provisioning') ON CONFLICT(recovery_set_id_b64u) DO NOTHING")
            .bind_refs([D1Type::Text(&set_id), D1Type::Text(&identity), D1Type::Text(&lineage), D1Type::Text(command.role().as_str()), D1Type::Text(&encoded), D1Type::Text(&timestamp)].iter())?.run().await?;
        self.require_recovery_attempt(command).await
    }

    async fn require_recovery_attempt(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    ) -> worker::Result<RecoveryAttemptStateV1> {
        self.load_recovery_attempt(command)
            .await?
            .ok_or_else(|| store_error("recovery attempt is missing"))
    }

    pub(crate) async fn persist_recovery_material(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
        ciphertext_b64u: &str,
    ) -> worker::Result<RecoveryAttemptStateV1> {
        require_ciphertext(ciphertext_b64u)?;
        self.require_recovery_attempt(command).await?;
        let set_id = command.context().recovery_set_id().to_base64url();
        self.session.prepare("UPDATE tenant_root_recovery_attempts SET lifecycle = 'pending', encrypted_material_b64u = ?1 WHERE recovery_set_id_b64u = ?2 AND lifecycle = 'provisioning'")
            .bind_refs([D1Type::Text(ciphertext_b64u), D1Type::Text(&set_id)].iter())?.run().await?;
        self.require_recovery_attempt(command).await
    }

    pub(crate) async fn persist_recovery_package(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
        ciphertext_b64u: &str,
        package_digest: &[u8; 32],
        descriptor: &router_ab_core::TenantRootRecoveryDescriptorV1,
        package_length: u32,
    ) -> worker::Result<RecoveryAttemptStateV1> {
        require_ciphertext(ciphertext_b64u)?;
        self.require_recovery_attempt(command).await?;
        let set_id = command.context().recovery_set_id().to_base64url();
        let digest = encode_base64url_bytes_v1(package_digest);
        if package_length == 0 || package_length > 16 * 1024 {
            return Err(store_error("invalid recovery package length"));
        }
        let descriptor_b64u = encode_base64url_bytes_v1(
            &descriptor
                .canonical_bytes()
                .map_err(|e| store_error(e.message()))?,
        );
        let length = package_length.to_string();
        self.session.prepare("UPDATE tenant_root_recovery_attempts SET lifecycle = 'packaged', encrypted_material_b64u = NULL, encrypted_package_b64u = ?1, package_digest_b64u = ?2, descriptor_b64u = ?4, package_length = CAST(?5 AS INTEGER) WHERE recovery_set_id_b64u = ?3 AND lifecycle = 'pending'")
            .bind_refs([D1Type::Text(ciphertext_b64u), D1Type::Text(&digest), D1Type::Text(&set_id), D1Type::Text(&descriptor_b64u), D1Type::Text(&length)].iter())?.run().await?;
        let state = self.require_recovery_attempt(command).await?;
        if let RecoveryAttemptStateV1::Packaged {
            package_digest_b64u,
            ..
        } = &state
        {
            if package_digest_b64u != &digest {
                return Err(store_error("recovery package replay changed its digest"));
            }
        }
        Ok(state)
    }

    pub(crate) async fn begin_recovery_destruction(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    ) -> worker::Result<RecoveryAttemptStateV1> {
        self.require_recovery_attempt(command).await?;
        let set_id = command.context().recovery_set_id().to_base64url();
        self.session.prepare("UPDATE tenant_root_recovery_attempts SET lifecycle = 'destroying', encrypted_material_b64u = NULL, encrypted_package_b64u = NULL, package_digest_b64u = NULL, descriptor_b64u = NULL, package_length = NULL WHERE recovery_set_id_b64u = ?1 AND lifecycle IN ('provisioning', 'pending', 'packaged')")
            .bind_refs([D1Type::Text(&set_id)].iter())?.run().await?;
        self.require_recovery_attempt(command).await
    }

    pub(crate) async fn record_recovery_destruction(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
        outcome: &crate::tenant_root_google_kms::GoogleKmsRetentionDestructionV1,
    ) -> worker::Result<RecoveryAttemptStateV1> {
        self.require_recovery_attempt(command).await?;
        let (lifecycle, receipt) = match outcome {
            crate::tenant_root_google_kms::GoogleKmsRetentionDestructionV1::Scheduled {
                receipt,
            } => ("destruction_scheduled", receipt),
            crate::tenant_root_google_kms::GoogleKmsRetentionDestructionV1::Destroyed {
                receipt,
            } => ("destroyed", receipt),
        };
        let set_id = command.context().recovery_set_id().to_base64url();
        self.session.prepare("UPDATE tenant_root_recovery_attempts SET lifecycle = ?1, destruction_receipt = ?2 WHERE recovery_set_id_b64u = ?3 AND lifecycle IN ('destroying', 'destruction_scheduled')")
            .bind_refs([D1Type::Text(lifecycle), D1Type::Text(receipt), D1Type::Text(&set_id)].iter())?.run().await?;
        self.require_recovery_attempt(command).await
    }
}
