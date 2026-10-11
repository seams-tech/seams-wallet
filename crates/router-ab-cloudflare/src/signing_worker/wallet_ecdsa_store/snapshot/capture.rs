use super::*;
use std::io::Write;

trait SnapshotRow: Serialize + DeserializeOwned {
    const SELECT: &'static str;
    fn into_record(self) -> SnapshotRecord;
    fn key(&self) -> &str;
    fn parameters(
        scope: &CloudflareSigningWorkerWalletScopeV1,
        after: String,
    ) -> RouterAbProtocolResult<Vec<SigningWorkerWalletSqlValueV1>> {
        Ok(vec![
            text(owner_json(scope, "ECDSA snapshot")?),
            text(after),
        ])
    }
    fn validate<Sql: SigningWorkerWalletSqlV1>(
        &self,
        _store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        _scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        Ok(())
    }
}

impl SnapshotRow for PoolSnapshotRow {
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::Pool(self)
    }
    const SELECT: &'static str =
        "SELECT pool_key, owner_json, ciphertext_json, CAST(version AS TEXT) AS version
        FROM wallet_ecdsa_pool WHERE owner_json = ? AND pool_key > ? ORDER BY pool_key LIMIT ?";
    fn key(&self) -> &str {
        &self.pool_key
    }
}
impl SnapshotRow for ActivationSnapshotRow {
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::Activation(self)
    }
    const SELECT: &'static str = "SELECT material_key, active_key, owner_json, ciphertext_json
        FROM wallet_ecdsa_activations WHERE owner_json = ? AND material_key > ? ORDER BY material_key LIMIT ?";
    fn key(&self) -> &str {
        &self.material_key
    }
    fn validate<Sql: SigningWorkerWalletSqlV1>(
        &self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        store
            .read_activation(scope, ActivationColumnV1::MaterialKey, &self.material_key)?
            .ok_or_else(|| wallet_error("Frozen ECDSA activation is missing"))?;
        Ok(())
    }
}
impl SnapshotRow for LinkedSnapshotRow {
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::LinkedReservation(self)
    }
    const SELECT: &'static str = "SELECT record_key, active_key, owner_json, ciphertext_json
        FROM wallet_linked_ecdsa WHERE owner_json = ? AND record_key > ? ORDER BY record_key LIMIT ?";
    fn key(&self) -> &str {
        &self.record_key
    }
    fn validate<Sql: SigningWorkerWalletSqlV1>(
        &self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        store
            .read_linked(scope, &self.record_key)?
            .ok_or_else(|| wallet_error("Frozen linked ECDSA reservation is missing"))?;
        Ok(())
    }
}
impl SnapshotRow for EffectSnapshotRow {
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::Effect(self)
    }
    const SELECT: &'static str = "SELECT operation_key, authorization_key, owner_json, request_digest_hex,
        authorization_json, CAST(claimed_at_ms AS TEXT) AS claimed_at_ms,
        terminal_json, CAST(committed_at_ms AS TEXT) AS committed_at_ms
        FROM wallet_ecdsa_effects WHERE owner_json = ? AND operation_key > ? ORDER BY operation_key LIMIT ?";
    fn key(&self) -> &str {
        &self.operation_key
    }
}
impl SnapshotRow for presign_authority::PresignAuthorityRow {
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::PresignAuthority(self)
    }
    const SELECT: &'static str = "SELECT presign_session_id, authority_json,
        CAST(ceremony_expires_at_ms AS TEXT) AS ceremony_expires_at_ms FROM signing_worker_presign_authorities
        WHERE COALESCE(json_extract(authority_json, '$.authority.wallet_scope.org_id'), json_extract(authority_json, '$.wallet_scope.org_id')) = ?
        AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.project_id'), json_extract(authority_json, '$.wallet_scope.project_id')) = ?
        AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.project_environment_id'), json_extract(authority_json, '$.wallet_scope.project_environment_id')) = ?
        AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.wallet_id'), json_extract(authority_json, '$.wallet_scope.wallet_id')) = ?
        AND presign_session_id > ? ORDER BY presign_session_id LIMIT ?";
    fn key(&self) -> &str {
        &self.presign_session_id
    }
    fn parameters(
        scope: &CloudflareSigningWorkerWalletScopeV1,
        after: String,
    ) -> RouterAbProtocolResult<Vec<SigningWorkerWalletSqlValueV1>> {
        Ok(vec![
            text(scope.org_id.clone()),
            text(scope.project_id.clone()),
            text(scope.project_environment_id.clone()),
            text(scope.wallet_id.clone()),
            text(after),
        ])
    }
    fn validate<Sql: SigningWorkerWalletSqlV1>(
        &self,
        _store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        self.authority(scope)?;
        Ok(())
    }
}
impl SnapshotRow for linked_presign_inventory::LinkedPresignSessionRow {
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::LinkedPresignSession(self)
    }
    const SELECT: &'static str = "SELECT presign_session_id, server_presignature_id, owner_json, request_digest_hex, ownership_generation
        FROM wallet_linked_presign_sessions WHERE owner_json = ? AND presign_session_id > ? ORDER BY presign_session_id LIMIT ?";
    fn key(&self) -> &str {
        &self.presign_session_id
    }
    fn validate<Sql: SigningWorkerWalletSqlV1>(
        &self,
        _store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate(scope)
    }
}

fn write_rows<Row: SnapshotRow, Sql: SigningWorkerWalletSqlV1>(
    store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
    scope: &CloudflareSigningWorkerWalletScopeV1,
    after: &mut String,
    limit: u32,
    writer: &mut impl Write,
) -> RouterAbProtocolResult<u32> {
    let mut parameters = Row::parameters(scope, after.clone())?;
    parameters.push(SigningWorkerWalletSqlValueV1::Integer(i64::from(limit)));
    let rows = store.sql.query::<Row>(Row::SELECT, parameters)?;
    let count = rows.len() as u32;
    for row in rows {
        row.validate(store, scope)?;
        if row.key() <= after.as_str() {
            return Err(wallet_error("ECDSA snapshot row order changed"));
        }
        *after = row.key().to_owned();
        serde_json::to_writer(&mut *writer, &row.into_record())
            .map_err(|error| wallet_error(error.to_string()))?;
        writer
            .write_all(b"\n")
            .map_err(|error| wallet_error(error.to_string()))?;
    }
    Ok(count)
}

#[derive(Deserialize)]
struct InventoryCount {
    count: u64,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    pub(crate) fn ecdsa_snapshot_record_count(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<u64> {
        let rows = self.sql.query::<InventoryCount>(
            "SELECT (SELECT COUNT(*) FROM wallet_ecdsa_pool WHERE owner_json = ?1)
             + (SELECT COUNT(*) FROM wallet_ecdsa_activations WHERE owner_json = ?1)
             + (SELECT COUNT(*) FROM wallet_linked_ecdsa WHERE owner_json = ?1)
             + (SELECT COUNT(*) FROM wallet_ecdsa_effects WHERE owner_json = ?1)
             + (SELECT COUNT(*) FROM wallet_linked_presign_sessions WHERE owner_json = ?1)
             + (SELECT COUNT(*) FROM signing_worker_presign_authorities
                WHERE COALESCE(json_extract(authority_json, '$.authority.wallet_scope.org_id'), json_extract(authority_json, '$.wallet_scope.org_id')) = ?2
                AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.project_id'), json_extract(authority_json, '$.wallet_scope.project_id')) = ?3
                AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.project_environment_id'), json_extract(authority_json, '$.wallet_scope.project_environment_id')) = ?4
                AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.wallet_id'), json_extract(authority_json, '$.wallet_scope.wallet_id')) = ?5) AS count",
            vec![
                text(owner_json(scope, "ECDSA inventory")?),
                text(scope.org_id.clone()),
                text(scope.project_id.clone()),
                text(scope.project_environment_id.clone()),
                text(scope.wallet_id.clone()),
            ],
        )?;
        let [row] = rows.as_slice() else {
            return Err(wallet_error("ECDSA inventory count is missing"));
        };
        Ok(row.count)
    }

    pub(in crate::signing_worker::wallet_ecdsa_store) fn write_ecdsa_snapshot_batch(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        family: &mut SnapshotFamily,
        after: &mut String,
        writer: &mut impl Write,
    ) -> RouterAbProtocolResult<(u32, bool)> {
        const RECORDS_PER_STEP: u32 = 16;
        let mut count = 0;
        while count < RECORDS_PER_STEP {
            let limit = RECORDS_PER_STEP - count;
            let written = match family {
                SnapshotFamily::Pools => {
                    write_rows::<PoolSnapshotRow, Sql>(self, scope, after, limit, writer)?
                }
                SnapshotFamily::Activations => {
                    write_rows::<ActivationSnapshotRow, Sql>(self, scope, after, limit, writer)?
                }
                SnapshotFamily::LinkedReservations => {
                    write_rows::<LinkedSnapshotRow, Sql>(self, scope, after, limit, writer)?
                }
                SnapshotFamily::Effects => {
                    write_rows::<EffectSnapshotRow, Sql>(self, scope, after, limit, writer)?
                }
                SnapshotFamily::PresignAuthorities => {
                    write_rows::<presign_authority::PresignAuthorityRow, Sql>(
                        self, scope, after, limit, writer,
                    )?
                }
                SnapshotFamily::LinkedPresignSessions => {
                    write_rows::<linked_presign_inventory::LinkedPresignSessionRow, Sql>(
                        self, scope, after, limit, writer,
                    )?
                }
                SnapshotFamily::Complete => return Ok((count, true)),
            };
            count += written;
            if written < limit {
                *family = family.next();
                after.clear();
            }
        }
        Ok((count, false))
    }
}
