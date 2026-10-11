use super::*;
use relocation::snapshot::import::{decimal, require_digest};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PairRow {
    session_hex: String,
    pair_digest_hex: String,
    lifecycle: String,
    ciphertext_json: String,
    revision: String,
    expires_at_ms: String,
    updated_at_ms: String,
    root_identity_digest_hex: String,
}

impl relocation::snapshot::import::Pair<DeriverBWalletOwnerV1> for PairRow {
    fn key(&self) -> &str {
        &self.session_hex
    }

    fn restore(
        &self,
        sql: &SqlStorage,
        env: &Env,
        owner: &DeriverBWalletOwnerV1,
    ) -> worker::Result<()> {
        require_digest(&self.session_hex)?;
        require_digest(&self.pair_digest_hex)?;
        require_digest(&self.root_identity_digest_hex)?;
        let revision = decimal::<i64>(&self.revision)?;
        let expires_at_ms = decimal::<u64>(&self.expires_at_ms)?;
        let updated_at_ms = decimal::<u64>(&self.updated_at_ms)?;
        if revision <= 0 || expires_at_ms != 0 || updated_at_ms == 0 {
            return Err(pair_error(
                "Deriver B imported revision or timestamps differ",
            ));
        }
        let identity = format!(
            "{}:{}:{}",
            owner.object_name()?,
            self.root_identity_digest_hex,
            self.session_hex
        );
        let cipher = crate::ed25519_yao_lifecycle::role_d1::RolePairCipherV1::from_env_for_deriver_b_wallet_do(env)?;
        let opened = cipher.open(&identity, &self.ciphertext_json)?;
        crate::ed25519_yao_lifecycle::role_d1::validate_terminal_wallet_record(
            &opened,
            &self.pair_digest_hex,
            &self.lifecycle,
        )?;
        sql.exec("INSERT INTO yao_pair_sessions (session_hex, pair_digest_hex, lifecycle, ciphertext_json, revision, expires_at_ms, updated_at_ms, root_identity_digest_hex) VALUES (?, ?, ?, ?, CAST(? AS INTEGER), ?, ?, ?)",
            vec![SqlStorageValue::String(self.session_hex.clone()), SqlStorageValue::String(self.pair_digest_hex.clone()),
                SqlStorageValue::String(self.lifecycle.clone()), SqlStorageValue::String(self.ciphertext_json.clone()), SqlStorageValue::String(self.revision.clone()),
                SqlStorageValue::String(self.expires_at_ms.clone()), SqlStorageValue::String(self.updated_at_ms.clone()),
                SqlStorageValue::String(self.root_identity_digest_hex.clone())])?;
        Ok(())
    }
}
