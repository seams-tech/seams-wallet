use super::*;
use relocation::snapshot::import::{decimal, require_digest};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PairRow {
    session_hex: String,
    revision_text: String,
    root_identity_digest_hex: String,
    ciphertext_json: String,
    lifecycle: String,
    claimed: String,
}

impl relocation::snapshot::import::Pair<DeriverAWalletOwnerV1> for PairRow {
    fn key(&self) -> &str {
        &self.session_hex
    }

    fn restore(
        &self,
        sql: &SqlStorage,
        env: &Env,
        owner: &DeriverAWalletOwnerV1,
    ) -> worker::Result<()> {
        require_digest(&self.session_hex)?;
        require_digest(&self.root_identity_digest_hex)?;
        let claimed = decimal::<i64>(&self.claimed)?;
        let row = decode_pair(
            owner,
            &RolePairCipherV1::from_env_for_wallet_do(env)?,
            &self.session_hex,
            PairRowV1 {
                revision_text: self.revision_text.clone(),
                root_identity_digest_hex: self.root_identity_digest_hex.clone(),
                ciphertext_json: self.ciphertext_json.clone(),
            },
        )?;
        if !matches!(
            row.record,
            PairRecord::Completed { .. } | PairRecord::Burned { .. } | PairRecord::Expired { .. }
        ) || pair_record_lifecycle(&row.record) != self.lifecycle
            || !matches!(claimed, 0 | 1)
            || row.revision.to_string() != self.revision_text
        {
            return Err(pair_error("Deriver A imported lifecycle or indexes differ"));
        }
        sql.exec("INSERT INTO yao_pair_sessions (session_hex, revision_text, root_identity_digest_hex, ciphertext_json, lifecycle, claimed) VALUES (?, ?, ?, ?, ?, ?)",
            vec![SqlStorageValue::String(self.session_hex.clone()), SqlStorageValue::String(self.revision_text.clone()),
                SqlStorageValue::String(self.root_identity_digest_hex.clone()), SqlStorageValue::String(self.ciphertext_json.clone()),
                SqlStorageValue::String(self.lifecycle.clone()), SqlStorageValue::Integer(claimed)])?;
        Ok(())
    }
}

pub(super) fn decode_pair(
    owner: &DeriverAWalletOwnerV1,
    cipher: &RolePairCipherV1,
    session_hex: &str,
    row: PairRowV1,
) -> worker::Result<SelectedPairV1> {
    let revision = row
        .revision_text
        .parse::<u64>()
        .ok()
        .filter(|revision| *revision > 0)
        .ok_or_else(|| pair_error("Deriver A pair revision is invalid"))?;
    let identity = format!("{}:{session_hex}", owner.object_name()?);
    let opened = cipher.open(&identity, &row.ciphertext_json)?;
    let record_json = crate::ed25519_yao_lifecycle::role_d1::migrate_wallet_generation(&opened.record_json)?;
    let record: PairRecord = serde_json::from_str(&record_json)
        .map_err(|error| pair_error(format!("Deriver A pair record is malformed: {error}")))?;
    let pair = record.pair_binding();
    owner.check_pair(pair)?;
    if encode_hex(pair.session()) != session_hex
        || opened.scope.signer_set_id != pair.binding().lifecycle.signer_set_id
        || opened.scope.root_share_epoch != pair.binding().lifecycle.root_share_epoch.as_str()
        || record_root_digest(&record)
            .is_some_and(|digest| encode_hex(digest) != opened.scope.root_metadata_digest_hex)
    {
        return Err(pair_error("Deriver A pair record scope changed"));
    }
    Ok(SelectedPairV1 {
        revision,
        root_identity_digest_hex: row.root_identity_digest_hex,
        record,
        scope: opened.scope,
    })
}
