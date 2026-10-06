use super::*;

pub const SIGNING_WORKER_POOL_FREEZE_PATH_V1: &str = "/router-ab/signing-worker/wallet/pool/freeze";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerPoolFreezeCommandV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub request: SigningWorkerPoolFreezeRequestV1,
}

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_pool_relocation (
    owner_json TEXT PRIMARY KEY,
    state_json TEXT NOT NULL)";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SigningWorkerPoolAdmissionV1 {
    Open,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerPoolFreezeRequestV1 {
    pub move_id: String,
    pub source_generation: u64,
    pub invalidated_at_ms: u64,
}

impl SigningWorkerPoolFreezeRequestV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        if self.move_id.len() != 49
            || !self.move_id.starts_with("wmove_")
            || !self.move_id.as_bytes()[6..]
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
            || self.source_generation == 0
            || self.source_generation >= 9_007_199_254_740_991
        {
            return Err(wallet_error("Pool relocation identity is invalid"));
        }
        crate::require_positive_ms("Pool relocation time", self.invalidated_at_ms)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerPoolFreezeReceiptV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub request: SigningWorkerPoolFreezeRequestV1,
    pub record_count: u64,
    pub wallet_records_digest_hex: String,
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
pub(super) enum Fence {
    Cleaning {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
    Cleaned {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
    Draining {
        request: SigningWorkerPoolFreezeRequestV1,
    },
    Frozen {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
    Prepared {
        request: SigningWorkerPoolFreezeRequestV1,
        chunk_bytes: u32,
    },
    Importing {
        receipt: SigningWorkerPoolFreezeReceiptV1,
        chunk_bytes: u32,
        segment_count: u32,
        next_segment: u32,
    },
    Verified {
        receipt: SigningWorkerPoolFreezeReceiptV1,
        chunk_bytes: u32,
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
    pub(super) fn pool_fence(
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

    pub fn pool_admission(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<SigningWorkerPoolAdmissionV1> {
        Ok(match self.pool_fence(scope)? {
            None => SigningWorkerPoolAdmissionV1::Open,
            Some(_) => SigningWorkerPoolAdmissionV1::Closed,
        })
    }

    /// Checks wallet mutation admission inside the caller's storage transaction.
    pub fn require_mutation_admission(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        match self.pool_admission(scope)? {
            SigningWorkerPoolAdmissionV1::Open => Ok(()),
            SigningWorkerPoolAdmissionV1::Closed => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
                "Wallet relocation has closed ECDSA pool admission",
            )),
        }
    }

    pub(super) fn save_pool_fence(
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

    pub(super) fn require_frozen_receipt(
        &self,
        receipt: &SigningWorkerPoolFreezeReceiptV1,
    ) -> RouterAbProtocolResult<()> {
        match self.pool_fence(&receipt.scope)? {
            Some(Fence::Frozen { receipt: stored }) if stored == *receipt => Ok(()),
            _ => Err(wallet_error(
                "ECDSA export requires its frozen source receipt",
            )),
        }
    }

    /// The host must serialize this operation with wallet ECDSA writes in one storage transaction.
    /// Pending effects retain the fence and can finish through their original commit path.
    pub fn freeze_pool_for_relocation(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerPoolFreezeRequestV1,
    ) -> RouterAbProtocolResult<SigningWorkerPoolFreezeResponseV1> {
        scope.validate()?;
        request.validate()?;
        match self.execution_authority(&scope)? {
            Some(authority) if authority.generation()? != request.source_generation => {
                return Err(wallet_error("ECDSA source ownership generation differs"));
            }
            None => {
                if self.ecdsa_snapshot(&scope)?.record_count() != 0
                    || self.import_activation(&scope)?.is_some()
                {
                    return Err(wallet_error("ECDSA source execution authority is missing"));
                }
                self.install_execution_authority(
                    &scope,
                    execution::ExecutionAuthority::EmptySource {
                        request: request.clone(),
                    },
                )?;
            }
            Some(_) => {}
        }
        match self.pool_fence(&scope)? {
            Some(
                Fence::Frozen { receipt }
                | Fence::Cleaning { receipt }
                | Fence::Cleaned { receipt },
            ) => {
                if receipt.request == request && receipt.scope == scope {
                    return Ok(SigningWorkerPoolFreezeResponseV1::Frozen { receipt });
                }
                return Err(wallet_error("Pool relocation inputs changed"));
            }
            Some(Fence::Draining { request: prior }) if prior != request => {
                return Err(wallet_error("Pool relocation inputs changed"))
            }
            Some(Fence::Draining { .. }) => {}
            Some(Fence::Prepared { .. } | Fence::Importing { .. } | Fence::Verified { .. }) => {
                return Err(wallet_error(
                    "An import destination cannot freeze as a source",
                ));
            }
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
            self.mutate_pool_record(scope.clone(), command)?;
        }
        let snapshot = self.ecdsa_snapshot(&scope)?;
        let encoded = snapshot.encode(&scope, &request)?;
        let receipt = SigningWorkerPoolFreezeReceiptV1 {
            scope: scope.clone(),
            request,
            record_count: snapshot.record_count(),
            wallet_records_digest_hex: snapshot::snapshot_digest(&encoded),
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
