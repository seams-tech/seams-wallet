use super::*;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_pool_relocation (
    owner_json TEXT PRIMARY KEY,
    state_json TEXT NOT NULL)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerPoolFreezeRequestV1 {
    pub move_id: String,
    pub source_generation: u64,
    pub invalidated_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerPoolFreezeReceiptV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub request: SigningWorkerPoolFreezeRequestV1,
    pub record_count: u64,
    pub records_digest_hex: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerPoolFreezeResponseV1 {
    Draining {
        pending_effects: u64,
    },
    Frozen {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Fence {
    Draining {
        request: SigningWorkerPoolFreezeRequestV1,
    },
    Frozen {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
}

#[derive(Deserialize)]
struct FenceRow {
    state_json: String,
}

#[derive(Deserialize)]
struct PendingEffects {
    count: u64,
}

#[derive(Deserialize)]
struct PoolRow {
    pool_key: String,
    ciphertext_json: String,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    fn pool_fence(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<Option<Fence>> {
        scope.validate()?;
        let rows = self.sql.query::<FenceRow>(
            "SELECT state_json FROM wallet_ecdsa_pool_relocation WHERE owner_json = ?",
            vec![text(owner_json(scope, "pool relocation")?)],
        )?;
        match rows.as_slice() {
            [] => Ok(None),
            [row] => serde_json::from_str(&row.state_json)
                .map(Some)
                .map_err(|error| wallet_error(error.to_string())),
            _ => Err(wallet_error("Pool relocation has duplicate fences")),
        }
    }

    pub(super) fn require_pool_admission(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        if self.pool_fence(scope)?.is_some() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
                "Wallet relocation has closed ECDSA pool admission",
            ));
        }
        Ok(())
    }

    fn save_pool_fence(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        fence: &Fence,
    ) -> RouterAbProtocolResult<()> {
        let encoded =
            serde_json::to_string(fence).map_err(|error| wallet_error(error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ecdsa_pool_relocation (owner_json, state_json) VALUES (?, ?)
             ON CONFLICT(owner_json) DO UPDATE SET state_json = excluded.state_json",
            vec![text(owner_json(scope, "pool relocation")?), text(encoded)],
        )?;
        Ok(())
    }

    /// The host must serialize this operation with pool writes in one storage transaction.
    /// Pending effects retain the fence and can finish through their original commit path.
    pub fn freeze_pool_for_relocation(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerPoolFreezeRequestV1,
    ) -> RouterAbProtocolResult<SigningWorkerPoolFreezeResponseV1> {
        scope.validate()?;
        if request.move_id.len() != 49
            || !request.move_id.starts_with("wmove_")
            || !request.move_id.as_bytes()[6..]
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
            || request.source_generation == 0
            || request.source_generation >= 9_007_199_254_740_991
        {
            return Err(wallet_error("Pool relocation identity is invalid"));
        }
        crate::require_positive_ms("Pool relocation time", request.invalidated_at_ms)?;
        match self.pool_fence(&scope)? {
            Some(Fence::Frozen { receipt }) => {
                if receipt.request == request && receipt.scope == scope {
                    return Ok(SigningWorkerPoolFreezeResponseV1::Frozen { receipt });
                }
                return Err(wallet_error("Pool relocation inputs changed"));
            }
            Some(Fence::Draining { request: prior }) if prior != request => {
                return Err(wallet_error("Pool relocation inputs changed"))
            }
            Some(Fence::Draining { .. }) => {}
            None => self.save_pool_fence(
                &scope,
                &Fence::Draining {
                    request: request.clone(),
                },
            )?,
        }
        let owner = owner_json(&scope, "pool relocation")?;
        let pending = self.sql.query::<PendingEffects>(
            "SELECT COUNT(*) AS count FROM wallet_ecdsa_effects WHERE owner_json = ? AND terminal_json IS NULL",
            vec![text(owner.clone())],
        )?;
        let [pending] = pending.as_slice() else {
            return Err(wallet_error("Pool effect inventory is invalid"));
        };
        if pending.count != 0 {
            return Ok(SigningWorkerPoolFreezeResponseV1::Draining {
                pending_effects: pending.count,
            });
        }
        let rows = self.sql.query::<PoolRow>(
            "SELECT pool_key, ciphertext_json FROM wallet_ecdsa_pool WHERE owner_json = ? ORDER BY pool_key",
            vec![text(owner)],
        )?;
        let mut records = Vec::with_capacity(rows.len());
        for row in rows {
            let record: CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1 = self.cipher.open(
                "ecdsa_pool",
                &wallet_row_identity(&scope, &row.pool_key)?,
                &row.ciphertext_json,
            )?;
            let command = CloudflareSigningWorkerEcdsaPoolCommandV1::InvalidateForRelocation {
                scope: record.scope.clone(),
                server_presignature_id: record.server_presignature_id.clone(),
                expected_revision: record.lifecycle.revision().value(),
                now_unix_ms: request.invalidated_at_ms,
            };
            let key = CloudflareSigningWorkerPrivateD1RequestV1::EcdsaPoolMutate {
                command: command.clone(),
            }
            .storage_key();
            if key != row.pool_key {
                return Err(wallet_error(
                    "Pool record identity differs from its stored key",
                ));
            }
            let outcome = self.mutate_pool_record(scope.clone(), command)?;
            records.push((row.pool_key, outcome.record().clone()));
        }
        let encoded = serde_json::to_vec(&(&scope, &request, &records))
            .map_err(|error| wallet_error(error.to_string()))?;
        let mut digest = Sha256::new();
        digest.update(b"seams/signing-worker/pool-snapshot/v1");
        digest.update(encoded);
        let receipt = SigningWorkerPoolFreezeReceiptV1 {
            scope: scope.clone(),
            request,
            record_count: records.len() as u64,
            records_digest_hex: hex_slice(&digest.finalize()),
        };
        self.save_pool_fence(
            &scope,
            &Fence::Frozen {
                receipt: receipt.clone(),
            },
        )?;
        Ok(SigningWorkerPoolFreezeResponseV1::Frozen { receipt })
    }
}
