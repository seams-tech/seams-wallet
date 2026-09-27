use router_ab_core::{
    burn_ed25519_yao_pair_v1, claim_ed25519_yao_pair_v1, complete_ed25519_yao_pair_v1,
    expire_ed25519_yao_pair_v1, prepare_ed25519_yao_pair_v1, reserve_ed25519_yao_pair_v1,
    Ed25519YaoExecutionIdV1, Ed25519YaoInputPairBindingV1, Ed25519YaoPairRecordV1,
    Ed25519YaoPairRejectionV1, Ed25519YaoPairReservationV1, Ed25519YaoPairStartClaimV1,
    Ed25519YaoPairStoreResultV1, Ed25519YaoPairTransitionV1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{de::DeserializeOwned, Serialize};

const PAIR_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS local_deriver_a_yao_pairs (
        tenant_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        session_hex TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        record_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, wallet_id, session_hex)
    );
";

pub(crate) fn ensure_local_deriver_a_pair_schema_v1(
    connection: &Connection,
) -> RouterAbProtocolResult<()> {
    connection.execute_batch(PAIR_SCHEMA).map_err(sqlite_error)
}

/// One Deriver A process's role-private database, scoped by its trusted route.
pub struct LocalDeriverAPairSqliteV1<'connection> {
    connection: &'connection mut Connection,
    tenant_id: String,
    wallet_id: String,
}

impl<'connection> LocalDeriverAPairSqliteV1<'connection> {
    pub fn new(
        connection: &'connection mut Connection,
        tenant_id: &str,
        wallet_id: &str,
    ) -> RouterAbProtocolResult<Self> {
        if tenant_id.trim().is_empty() || wallet_id.trim().is_empty() {
            return Err(pair_store_error("Deriver A tenant and wallet are required"));
        }
        ensure_local_deriver_a_pair_schema_v1(connection)?;
        Ok(Self {
            connection,
            tenant_id: tenant_id.to_owned(),
            wallet_id: wallet_id.to_owned(),
        })
    }

    pub fn read<P: DeserializeOwned, O: DeserializeOwned>(
        &self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
    ) -> RouterAbProtocolResult<Option<(u64, Ed25519YaoPairRecordV1<P, O>)>> {
        self.check_wallet(pair_binding)?;
        let session_hex = hex::encode(pair_binding.session());
        let row = self
            .connection
            .query_row(
                "SELECT revision, record_json FROM local_deriver_a_yao_pairs \
                 WHERE tenant_id = ?1 AND wallet_id = ?2 AND session_hex = ?3",
                params![self.tenant_id, self.wallet_id, session_hex],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(sqlite_error)?;
        decode_row(row, pair_binding)
    }

    pub fn prepare<P, O>(
        &mut self,
        proposed: Ed25519YaoPairRecordV1<P, O>,
        now_ms: u64,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + PartialEq + Serialize + DeserializeOwned,
        O: Clone + Serialize + DeserializeOwned,
    {
        let binding = proposed.pair_binding().clone();
        self.transition(&binding, |current| {
            prepare_ed25519_yao_pair_v1(current, proposed, now_ms)
        })
    }

    pub fn claim<P, O>(
        &mut self,
        claim: Ed25519YaoPairStartClaimV1<'_>,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + Serialize + DeserializeOwned,
        O: Clone + Serialize + DeserializeOwned,
    {
        self.transition(claim.pair_binding, |current| match current {
            Some(current) => claim_ed25519_yao_pair_v1(current, claim),
            None => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch),
        })
    }

    pub fn reserve<P, O>(
        &mut self,
        reservation: Ed25519YaoPairReservationV1<'_>,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + Serialize + DeserializeOwned,
        O: Clone + Serialize + DeserializeOwned,
    {
        self.transition(reservation.pair_binding, |current| match current {
            Some(current) => reserve_ed25519_yao_pair_v1(current, reservation),
            None => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch),
        })
    }

    pub fn complete<P, O>(
        &mut self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
        outcome: O,
        now_ms: u64,
        running_lifetime_ms: u64,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + Serialize + DeserializeOwned,
        O: Clone + PartialEq + Serialize + DeserializeOwned,
    {
        self.complete_with(
            pair_binding,
            execution_id,
            outcome,
            now_ms,
            running_lifetime_ms,
            |_| Ok(()),
        )
    }

    pub fn complete_with<P, O>(
        &mut self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
        outcome: O,
        now_ms: u64,
        running_lifetime_ms: u64,
        persist_role_state: impl FnOnce(&Transaction<'_>) -> RouterAbProtocolResult<()>,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + Serialize + DeserializeOwned,
        O: Clone + PartialEq + Serialize + DeserializeOwned,
    {
        self.transition_with(
            pair_binding,
            |current| match current {
                Some(current) => complete_ed25519_yao_pair_v1(
                    current,
                    execution_id,
                    outcome,
                    now_ms,
                    running_lifetime_ms,
                ),
                None => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
                }
            },
            persist_role_state,
        )
    }

    pub fn expire<P, O>(
        &mut self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
        now_ms: u64,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + Serialize + DeserializeOwned,
        O: Clone + Serialize + DeserializeOwned,
    {
        self.transition(pair_binding, |current| match current {
            Some(current) => expire_ed25519_yao_pair_v1(current, now_ms),
            None => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch),
        })
    }

    pub fn burn<P, O>(
        &mut self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + Serialize + DeserializeOwned,
        O: Clone + Serialize + DeserializeOwned,
    {
        self.transition(pair_binding, |current| match current {
            Some(current) => burn_ed25519_yao_pair_v1(current, execution_id),
            None => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch),
        })
    }

    fn transition<P, O>(
        &mut self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
        decide: impl FnOnce(Option<&Ed25519YaoPairRecordV1<P, O>>) -> Ed25519YaoPairTransitionV1<P, O>,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + Serialize + DeserializeOwned,
        O: Clone + Serialize + DeserializeOwned,
    {
        self.transition_with(pair_binding, decide, |_| Ok(()))
    }

    fn transition_with<P, O>(
        &mut self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
        decide: impl FnOnce(Option<&Ed25519YaoPairRecordV1<P, O>>) -> Ed25519YaoPairTransitionV1<P, O>,
        persist_role_state: impl FnOnce(&Transaction<'_>) -> RouterAbProtocolResult<()>,
    ) -> RouterAbProtocolResult<Ed25519YaoPairStoreResultV1<P, O>>
    where
        P: Clone + Serialize + DeserializeOwned,
        O: Clone + Serialize + DeserializeOwned,
    {
        self.check_wallet(pair_binding)?;
        let session_hex = hex::encode(pair_binding.session());
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sqlite_error)?;
        let row = transaction
            .query_row(
                "SELECT revision, record_json FROM local_deriver_a_yao_pairs \
                 WHERE tenant_id = ?1 AND wallet_id = ?2 AND session_hex = ?3",
                params![self.tenant_id, self.wallet_id, session_hex],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(sqlite_error)?;
        let selected: Option<(u64, Ed25519YaoPairRecordV1<P, O>)> = decode_row(row, pair_binding)?;
        match decide(selected.as_ref().map(|(_, record)| record)) {
            Ed25519YaoPairTransitionV1::Reject(reason) => {
                Ok(Ed25519YaoPairStoreResultV1::Rejected(reason))
            }
            Ed25519YaoPairTransitionV1::Duplicate => {
                let (revision, record) = selected.ok_or_else(|| {
                    pair_store_error("duplicate pair transition has no selected record")
                })?;
                Ok(Ed25519YaoPairStoreResultV1::Duplicate { revision, record })
            }
            Ed25519YaoPairTransitionV1::Persist(record) => {
                let record_json = serde_json::to_string(&record).map_err(|error| {
                    pair_store_error(format!("Deriver A pair encoding failed: {error}"))
                })?;
                let revision = match selected {
                    None => 1,
                    Some((revision, _)) => revision
                        .checked_add(1)
                        .filter(|value| *value <= i64::MAX as u64)
                        .ok_or_else(|| pair_store_error("Deriver A pair revision overflow"))?,
                };
                let changes = if revision == 1 {
                    transaction.execute(
                        "INSERT INTO local_deriver_a_yao_pairs \
                         (tenant_id, wallet_id, session_hex, revision, record_json) \
                         VALUES (?1, ?2, ?3, 1, ?4) ON CONFLICT DO NOTHING",
                        params![self.tenant_id, self.wallet_id, session_hex, record_json],
                    )
                } else {
                    transaction.execute(
                        "UPDATE local_deriver_a_yao_pairs SET revision = ?4, record_json = ?5 \
                         WHERE tenant_id = ?1 AND wallet_id = ?2 AND session_hex = ?3 \
                         AND revision = ?6",
                        params![
                            self.tenant_id,
                            self.wallet_id,
                            session_hex,
                            revision as i64,
                            record_json,
                            (revision - 1) as i64,
                        ],
                    )
                }
                .map_err(sqlite_error)?;
                if changes != 1 {
                    return Ok(Ed25519YaoPairStoreResultV1::StaleVersion);
                }
                // Claiming or completing the pair needs its root-use
                // admission here to be live, in this transaction: the claim
                // marks it claimed, and completion settles it. A cancelled
                // attempt can do neither. A burned or expired record neither
                // settles nor keeps role state: its executor may still hold
                // what it read.
                match &record {
                    Ed25519YaoPairRecordV1::Running { .. } => move_live_pair_admission_v1(
                        &transaction,
                        "deriver_a",
                        &session_hex,
                        router_ab_cloudflare::TENANT_ROOT_CLAIM_ROOT_USE_ADMISSION_SQL_V1,
                    )?,
                    Ed25519YaoPairRecordV1::Completed { .. } => {
                        move_live_pair_admission_v1(
                            &transaction,
                            "deriver_a",
                            &session_hex,
                            router_ab_cloudflare::TENANT_ROOT_SETTLE_ROOT_USE_ADMISSION_SQL_V1,
                        )?;
                        persist_role_state(&transaction)?;
                    }
                    _ => {}
                }
                if transaction.commit().is_err() {
                    return Ok(Ed25519YaoPairStoreResultV1::UncertainWrite);
                }
                Ok(Ed25519YaoPairStoreResultV1::Applied { revision, record })
            }
        }
    }

    fn check_wallet(
        &self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
    ) -> RouterAbProtocolResult<()> {
        pair_binding.validate()?;
        if pair_binding.binding().lifecycle.account_id != self.wallet_id {
            return Err(pair_store_error(
                "Deriver A pair wallet does not match its trusted scope",
            ));
        }
        Ok(())
    }
}

fn decode_row<P: DeserializeOwned, O: DeserializeOwned>(
    row: Option<(i64, String)>,
    pair_binding: &Ed25519YaoInputPairBindingV1,
) -> RouterAbProtocolResult<Option<(u64, Ed25519YaoPairRecordV1<P, O>)>> {
    row.map(|(revision, record_json)| {
        let revision = u64::try_from(revision)
            .ok()
            .filter(|revision| *revision > 0)
            .ok_or_else(|| pair_store_error("Deriver A pair revision is invalid"))?;
        let record: Ed25519YaoPairRecordV1<P, O> =
            serde_json::from_str(&record_json).map_err(|error| {
                pair_store_error(format!("Deriver A pair record is malformed: {error}"))
            })?;
        if record.pair_binding() != pair_binding {
            return Err(pair_store_error("Deriver A pair record identity changed"));
        }
        Ok((revision, record))
    })
    .transpose()
}

/// Moves one pair session's root-use admission at `role` in the transaction
/// that claims or completes the pair, with the claim or settlement SQL.
/// Unless exactly one row moved, the transition is refused and the
/// transaction rolls back: a cancelled attempt can neither start nor complete.
pub(crate) fn move_live_pair_admission_v1(
    transaction: &Transaction<'_>,
    role: &'static str,
    session_hex: &str,
    sql: &'static str,
) -> RouterAbProtocolResult<()> {
    let kind = router_ab_cloudflare::TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1;
    let moved = transaction
        .execute(sql, params![role, kind, session_hex])
        .map_err(sqlite_error)?;
    if moved == 1 {
        return Ok(());
    }
    Err(pair_admission_not_live_error_v1(transaction, role, session_hex)?)
}

/// Refuses to start a pair unless its root-use admission at `role` is still
/// only admitted.
pub(crate) fn require_admitted_pair_admission_v1(
    transaction: &Transaction<'_>,
    role: &'static str,
    session_hex: &str,
) -> RouterAbProtocolResult<()> {
    if pair_admission_status_v1(transaction, role, session_hex)?.as_deref() == Some("admitted") {
        return Ok(());
    }
    Err(pair_admission_not_live_error_v1(transaction, role, session_hex)?)
}

fn pair_admission_status_v1(
    transaction: &Transaction<'_>,
    role: &'static str,
    session_hex: &str,
) -> RouterAbProtocolResult<Option<String>> {
    transaction
        .query_row(
            router_ab_cloudflare::TENANT_ROOT_ROOT_USE_ADMISSION_STATUS_SQL_V1,
            params![
                role,
                router_ab_cloudflare::TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1,
                session_hex
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sqlite_error)
}

fn pair_admission_not_live_error_v1(
    transaction: &Transaction<'_>,
    role: &'static str,
    session_hex: &str,
) -> RouterAbProtocolResult<RouterAbProtocolError> {
    Ok(match pair_admission_status_v1(transaction, role, session_hex)?.as_deref() {
        Some("cancelled") => RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
            "this tenant-root operation's admission was cancelled here; start it again",
        ),
        _ => pair_store_error("the pair's tenant-root admission is not live here"),
    })
}

fn sqlite_error(error: rusqlite::Error) -> RouterAbProtocolError {
    pair_store_error(format!("Deriver A pair SQLite failure: {error}"))
}

fn pair_store_error(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use router_ab_core::{
        Ed25519YaoCeremonyBindingV1, Ed25519YaoCeremonyIdentityV1, Ed25519YaoDeriverRoleV1,
        Ed25519YaoOperationV1, Ed25519YaoRoleReadinessReceiptV1, Ed25519YaoRoleSignatureSchemeV1,
        Ed25519YaoRoleSignatureV1, Ed25519YaoRoleStartAcceptanceV1, Ed25519YaoSessionIdV1,
        Ed25519YaoStableKeyContextBindingV1, ExpensiveWorkKindV1, LifecycleScopeV1,
        MpcMaterialActivationRefV1, PublicDigest32, RootShareEpoch,
    };
    use std::{
        fs,
        path::PathBuf,
        sync::{Arc, Barrier},
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    type TestRecord = Ed25519YaoPairRecordV1<u8, String>;
    type TestResult = Ed25519YaoPairStoreResultV1<u8, String>;

    fn path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "router-ab-a-pair-{label}-{}-{nanos}.sqlite",
            std::process::id()
        ))
    }

    fn pair() -> Ed25519YaoInputPairBindingV1 {
        let lifecycle = LifecycleScopeV1::new(
            "lifecycle-1",
            ExpensiveWorkKindV1::RegistrationPrepare,
            RootShareEpoch::new("epoch-1").expect("epoch"),
            "wallet-1",
            "session-1",
            "signer-set-1",
            "server-1",
        )
        .expect("lifecycle");
        let ceremony = Ed25519YaoCeremonyBindingV1::new(
            lifecycle,
            Ed25519YaoOperationV1::Registration,
            Ed25519YaoSessionIdV1::new([1; 32]).expect("session"),
            Ed25519YaoStableKeyContextBindingV1::new([2; 32]),
            MpcMaterialActivationRefV1::new(
                "activation-1",
                "capability-1",
                "wallet-1",
                "key-1",
                "lifecycle-1",
                "server-1",
            )
            .expect("activation"),
        )
        .expect("ceremony");
        Ed25519YaoInputPairBindingV1::new(
            Ed25519YaoCeremonyIdentityV1::from_binding(ceremony).expect("identity"),
            PublicDigest32::new([3; 32]),
            PublicDigest32::new([4; 32]),
            PublicDigest32::new([5; 32]),
            PublicDigest32::new([6; 32]),
        )
        .expect("pair")
    }

    fn signature() -> Ed25519YaoRoleSignatureV1 {
        Ed25519YaoRoleSignatureV1::new(Ed25519YaoRoleSignatureSchemeV1::Ed25519V1, [9; 64])
            .expect("signature")
    }

    fn receipt(
        pair: &Ed25519YaoInputPairBindingV1,
        role: Ed25519YaoDeriverRoleV1,
    ) -> Ed25519YaoRoleReadinessReceiptV1 {
        let (input, root) = match role {
            Ed25519YaoDeriverRoleV1::DeriverA => (pair.deriver_a_input_digest(), [7; 32]),
            Ed25519YaoDeriverRoleV1::DeriverB => (pair.deriver_b_input_digest(), [8; 32]),
        };
        Ed25519YaoRoleReadinessReceiptV1::new(
            role,
            pair.ceremony().binding().session_id,
            pair.pair_digest(),
            input,
            PublicDigest32::new(root),
            100,
            150,
            signature(),
        )
        .expect("receipt")
    }

    fn acceptance(
        pair: &Ed25519YaoInputPairBindingV1,
        id: Ed25519YaoExecutionIdV1,
    ) -> Ed25519YaoRoleStartAcceptanceV1 {
        Ed25519YaoRoleStartAcceptanceV1::new(
            Ed25519YaoDeriverRoleV1::DeriverB,
            pair.ceremony().binding().session_id,
            pair.pair_digest(),
            id,
            PublicDigest32::new([8; 32]),
            100,
            200,
            signature(),
        )
        .expect("acceptance")
    }

    fn prepared(pair: &Ed25519YaoInputPairBindingV1) -> TestRecord {
        TestRecord::Prepared {
            pair_binding: pair.clone(),
            root_metadata_digest: [7; 32],
            expires_at_ms: 150,
            receipt: receipt(pair, Ed25519YaoDeriverRoleV1::DeriverA),
            payload: 42,
        }
    }

    fn reserve_in_connection(
        path: &PathBuf,
        pair: &Ed25519YaoInputPairBindingV1,
        id: Ed25519YaoExecutionIdV1,
    ) -> Result<TestResult, Box<dyn std::error::Error + Send + Sync>> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        let mut store = LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
        let local = receipt(pair, Ed25519YaoDeriverRoleV1::DeriverA);
        let peer = receipt(pair, Ed25519YaoDeriverRoleV1::DeriverB);
        Ok(store.reserve(Ed25519YaoPairReservationV1 {
            pair_binding: pair,
            local_receipt: &local,
            peer_receipt: &peer,
            execution_id: id,
            now_ms: 119,
        })?)
    }

    #[test]
    fn separate_connections_compete_for_one_claim_and_replay_after_restart(
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path = path("contention");
        let pair = pair();
        {
            let mut connection = Connection::open(&path)?;
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            assert!(matches!(
                store.prepare(prepared(&pair), 110)?,
                TestResult::Applied { revision: 1, .. }
            ));
        }
        let barrier = Arc::new(Barrier::new(3));
        let mut threads = Vec::new();
        for fill in [10, 11] {
            let path = path.clone();
            let pair = pair.clone();
            let barrier = Arc::clone(&barrier);
            threads.push(thread::spawn(move || {
                let id = Ed25519YaoExecutionIdV1::new([fill; 32]).expect("id");
                barrier.wait();
                reserve_in_connection(&path, &pair, id)
            }));
        }
        barrier.wait();
        let results = threads
            .into_iter()
            .map(|handle| handle.join().expect("claim thread"))
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, TestResult::Applied { .. }))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(
                    result,
                    TestResult::Rejected(Ed25519YaoPairRejectionV1::ConflictingExecution)
                ))
                .count(),
            1
        );
        let (winning_id, outcome) = match results.into_iter().find_map(|result| match result {
            TestResult::Applied {
                record: TestRecord::Starting { execution_id, .. },
                ..
            } => Some((execution_id, "durable outcome".to_owned())),
            _ => None,
        }) {
            Some(value) => value,
            None => panic!("no winning claim"),
        };
        {
            let mut connection = Connection::open(&path)?;
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            let local = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverA);
            let peer = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverB);
            let accepted = acceptance(&pair, winning_id);
            assert!(matches!(
                store.claim::<u8, String>(Ed25519YaoPairStartClaimV1 {
                    pair_binding: &pair,
                    local_receipt: &local,
                    peer_receipt: &peer,
                    acceptance: &accepted,
                    execution_id: winning_id,
                    now_ms: 120,
                })?,
                TestResult::Applied { revision: 3, .. }
            ));
            assert!(matches!(
                store.complete::<u8, String>(&pair, winning_id, outcome.clone(), 125, 60_000)?,
                TestResult::Applied { revision: 4, .. }
            ));
        }
        {
            let mut connection = Connection::open(&path)?;
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            let (_, record): (_, TestRecord) = store.read(&pair)?.expect("completed record");
            assert_eq!(record.outcome(), Some(&outcome));
            assert!(matches!(
                store.complete::<u8, String>(&pair, winning_id, outcome, 126, 60_000)?,
                TestResult::Duplicate { revision: 4, .. }
            ));
        }
        {
            let mut connection = Connection::open(&path)?;
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            let local = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverA);
            let peer = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverB);
            let accepted = acceptance(&pair, winning_id);
            assert!(matches!(
                store.claim::<u8, String>(Ed25519YaoPairStartClaimV1 {
                    pair_binding: &pair,
                    local_receipt: &local,
                    peer_receipt: &peer,
                    acceptance: &accepted,
                    execution_id: winning_id,
                    now_ms: 120,
                })?,
                TestResult::Duplicate { revision: 4, .. }
            ));
        }
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn identical_reservations_on_separate_connections_have_one_executor(
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path = path("identical-reservation");
        let pair = pair();
        let id = Ed25519YaoExecutionIdV1::new([10; 32])?;
        {
            let mut connection = Connection::open(&path)?;
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            store.prepare(prepared(&pair), 110)?;
        }
        let barrier = Arc::new(Barrier::new(3));
        let mut threads = Vec::new();
        for _ in 0..2 {
            let path = path.clone();
            let pair = pair.clone();
            let barrier = Arc::clone(&barrier);
            threads.push(thread::spawn(move || {
                barrier.wait();
                reserve_in_connection(&path, &pair, id)
            }));
        }
        barrier.wait();
        let results = threads
            .into_iter()
            .map(|handle| handle.join().expect("reservation thread"))
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, TestResult::Applied { .. }))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, TestResult::Duplicate { .. }))
                .count(),
            1
        );
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn restart_after_reservation_does_not_reopen_prepared_material(
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path = path("reservation-restart");
        let pair = pair();
        let execution_id = Ed25519YaoExecutionIdV1::new([10; 32])?;
        {
            let mut connection = Connection::open(&path)?;
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            store.prepare(prepared(&pair), 110)?;
            let local = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverA);
            let peer = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverB);
            assert!(matches!(
                store.reserve::<u8, String>(Ed25519YaoPairReservationV1 {
                    pair_binding: &pair,
                    local_receipt: &local,
                    peer_receipt: &peer,
                    execution_id,
                    now_ms: 119,
                })?,
                TestResult::Applied { revision: 2, .. }
            ));
        }
        {
            let mut connection = Connection::open(&path)?;
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            let (revision, record): (_, TestRecord) = store.read(&pair)?.expect("reserved pair");
            assert_eq!(revision, 2);
            assert!(matches!(record, TestRecord::Starting { .. }));
            let local = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverA);
            let peer = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverB);
            assert!(matches!(
                store.reserve::<u8, String>(Ed25519YaoPairReservationV1 {
                    pair_binding: &pair,
                    local_receipt: &local,
                    peer_receipt: &peer,
                    execution_id,
                    now_ms: 120,
                })?,
                TestResult::Duplicate { revision: 2, .. }
            ));
            assert!(matches!(
                store.prepare(prepared(&pair), 120)?,
                TestResult::Rejected(Ed25519YaoPairRejectionV1::ConflictingExecution)
            ));
        }
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn terminal_outcome_and_role_state_commit_together(
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path = path("terminal-atomicity");
        let pair = pair();
        let id = Ed25519YaoExecutionIdV1::new([10; 32])?;
        let local = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverA);
        let peer = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverB);
        let accepted = acceptance(&pair, id);
        let mut connection = Connection::open(&path)?;
        {
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            store.prepare(prepared(&pair), 110)?;
            store.reserve::<u8, String>(Ed25519YaoPairReservationV1 {
                pair_binding: &pair,
                local_receipt: &local,
                peer_receipt: &peer,
                execution_id: id,
                now_ms: 119,
            })?;
            store.claim::<u8, String>(Ed25519YaoPairStartClaimV1 {
                pair_binding: &pair,
                local_receipt: &local,
                peer_receipt: &peer,
                acceptance: &accepted,
                execution_id: id,
                now_ms: 120,
            })?;
        }
        connection.execute_batch(
            "CREATE TABLE role_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); \
             CREATE TRIGGER reject_role_state BEFORE INSERT ON role_state \
             BEGIN SELECT RAISE(ABORT, 'role state write failed'); END;",
        )?;
        {
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            assert!(store
                .complete_with::<u8, String>(
                    &pair,
                    id,
                    "terminal output".to_owned(),
                    125,
                    60_000,
                    |transaction| {
                        transaction
                            .execute(
                                "INSERT INTO role_state (id, value) VALUES (1, 'active')",
                                [],
                            )
                            .map_err(sqlite_error)?;
                        Ok(())
                    },
                )
                .is_err());
            let (revision, record): (_, TestRecord) = store.read(&pair)?.expect("running pair");
            assert_eq!(revision, 3);
            assert!(matches!(record, TestRecord::Running { .. }));
        }
        drop(connection);
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn failed_conditional_write_preserves_prepared_state_and_scope(
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path = path("failed-write");
        let pair = pair();
        let id = Ed25519YaoExecutionIdV1::new([10; 32])?;
        let mut connection = Connection::open(&path)?;
        {
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            store.prepare(prepared(&pair), 110)?;
        }
        connection.execute_batch(
            "CREATE TRIGGER reject_pair_claim BEFORE UPDATE ON local_deriver_a_yao_pairs \
             BEGIN SELECT RAISE(ABORT, 'claim write failed'); END;",
        )?;
        {
            let mut store =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-1")?;
            let local = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverA);
            let peer = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverB);
            assert!(store
                .reserve::<u8, String>(Ed25519YaoPairReservationV1 {
                    pair_binding: &pair,
                    local_receipt: &local,
                    peer_receipt: &peer,
                    execution_id: id,
                    now_ms: 119,
                })
                .is_err());
            let (revision, record): (_, TestRecord) = store.read(&pair)?.expect("record");
            assert_eq!(revision, 1);
            assert!(matches!(record, TestRecord::Prepared { .. }));
            let changed_pair = Ed25519YaoInputPairBindingV1::new(
                pair.ceremony().clone(),
                pair.deriver_a_input_digest(),
                pair.deriver_b_input_digest(),
                pair.recipient_set_digest(),
                PublicDigest32::new([12; 32]),
            )?;
            assert!(store.read::<u8, String>(&changed_pair).is_err());
        }
        {
            let other_tenant =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-2", "wallet-1")?;
            assert!(other_tenant.read::<u8, String>(&pair)?.is_none());
        }
        {
            let other_wallet =
                LocalDeriverAPairSqliteV1::new(&mut connection, "tenant-1", "wallet-2")?;
            assert!(other_wallet.read::<u8, String>(&pair).is_err());
        }
        drop(connection);
        fs::remove_file(path)?;
        Ok(())
    }
}
