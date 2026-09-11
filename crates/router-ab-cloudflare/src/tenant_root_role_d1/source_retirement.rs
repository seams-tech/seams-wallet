use super::*;
use router_ab_core::VerifiedTenantRootSourceRetirementCommandV1;

#[derive(Deserialize)]
struct RetirementRow {
    role: String,
    active_receipt_digest_b64u: String,
    destination_receipt_digest_b64u: String,
    retired_at_ms: i64,
}

impl CloudflareTenantRootRoleShareStoreV1 {
    /// Atomically bars new material and removes the named lineage's live role records.
    pub(crate) async fn retire_source_lineage(
        &self,
        command: &VerifiedTenantRootSourceRetirementCommandV1,
        now_ms: u64,
    ) -> worker::Result<i64> {
        if tenant_root_protocol_role_of(self.cipher.role) != command.role() {
            return Err(store_error("source retirement role mismatch"));
        }
        if let Some(row) = self.source_retirement_row(command).await? {
            require_retirement_matches(&row, command)?;
            return Ok(row.retired_at_ms);
        }
        let active = self
            .load_active_resolution(command.identity_digest())
            .await?
            .require_active()?;
        let binding = active.active_binding()?;
        if binding.custody_lineage() != command.custody_lineage()
            || binding.activation_receipt_digest() != command.active_receipt_digest()
        {
            return Err(store_error(
                "source retirement does not name the active role receipt",
            ));
        }
        let identity = encode_hex(command.identity_digest().as_bytes());
        let lineage = command.custody_lineage().to_base64url();
        let active_receipt = encode_base64url_bytes_v1(command.active_receipt_digest().as_bytes());
        let destination =
            encode_base64url_bytes_v1(command.destination_receipt_digest().as_bytes());
        let at =
            i64::try_from(now_ms).map_err(|_| store_error("invalid source retirement time"))?;
        let at_text = at.to_string();
        let epoch = active.record.epoch.get().get().to_string();
        let revision = active.revision().to_string();
        let mut statements = vec![self
            .session
            .prepare(
                "INSERT OR IGNORE INTO tenant_root_source_retirements SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (SELECT 1 FROM tenant_root_role_shares WHERE tenant_identity_digest_hex=?1 AND custody_lineage_b64u=?2 AND role=?3 AND lifecycle='active' AND tenant_root_share_epoch=?7 AND revision=?8)",
            )
            .bind_refs(
                [
                    D1Type::Text(&identity),
                    D1Type::Text(&lineage),
                    D1Type::Text(command.role().as_str()),
                    D1Type::Text(&active_receipt),
                    D1Type::Text(&destination),
                    D1Type::Text(&at_text),
                    D1Type::Text(&epoch),
                    D1Type::Text(&revision),
                ]
                .iter(),
            )?];
        // A rotation between the read and batch must leave its newer material intact.
        let admitted = "EXISTS (SELECT 1 FROM tenant_root_source_retirements WHERE tenant_identity_digest_hex=?1 AND custody_lineage_b64u=?2 AND active_receipt_digest_b64u=?3 AND destination_receipt_digest_b64u=?4)";
        for table in [
            "tenant_root_role_shares",
            "tenant_root_command_replays",
            "tenant_root_restore_import_keys",
            "tenant_root_restore_refresh_attempts",
        ] {
            statements.push(self.session.prepare(&format!("DELETE FROM {table} WHERE tenant_identity_digest_hex=?1 AND custody_lineage_b64u=?2 AND {admitted}"))
                .bind_refs([D1Type::Text(&identity),D1Type::Text(&lineage),D1Type::Text(&active_receipt),D1Type::Text(&destination)].iter())?);
        }
        statements.push(self.session.prepare(&format!("UPDATE tenant_root_recovery_attempts SET lifecycle='destroying', encrypted_material_b64u=NULL, encrypted_package_b64u=NULL, package_digest_b64u=NULL, descriptor_b64u=NULL, package_length=NULL WHERE tenant_identity_digest_hex=?1 AND custody_lineage_b64u=?2 AND lifecycle IN ('provisioning','pending','packaged') AND {admitted}"))
            .bind_refs([D1Type::Text(&identity),D1Type::Text(&lineage),D1Type::Text(&active_receipt),D1Type::Text(&destination)].iter())?);
        self.session.batch(statements).await?;
        let row = self
            .source_retirement_row(command)
            .await?
            .ok_or_else(|| store_error("source retirement barrier was not persisted"))?;
        require_retirement_matches(&row, command)?;
        Ok(row.retired_at_ms)
    }

    async fn source_retirement_row(
        &self,
        command: &VerifiedTenantRootSourceRetirementCommandV1,
    ) -> worker::Result<Option<RetirementRow>> {
        let identity = encode_hex(command.identity_digest().as_bytes());
        let lineage = command.custody_lineage().to_base64url();
        self.session.prepare("SELECT role,active_receipt_digest_b64u,destination_receipt_digest_b64u,retired_at_ms FROM tenant_root_source_retirements WHERE tenant_identity_digest_hex=?1 AND custody_lineage_b64u=?2")
            .bind_refs([D1Type::Text(&identity),D1Type::Text(&lineage)].iter())?.first::<RetirementRow>(None).await
    }
}
fn require_retirement_matches(
    row: &RetirementRow,
    command: &VerifiedTenantRootSourceRetirementCommandV1,
) -> worker::Result<()> {
    if row.role != command.role().as_str()
        || row.active_receipt_digest_b64u
            != encode_base64url_bytes_v1(command.active_receipt_digest().as_bytes())
        || row.destination_receipt_digest_b64u
            != encode_base64url_bytes_v1(command.destination_receipt_digest().as_bytes())
        || row.retired_at_ms <= 0
    {
        return Err(store_error(
            "source retirement retry changed its bound receipts",
        ));
    }
    Ok(())
}
