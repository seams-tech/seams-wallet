use crate::{
    local_ed25519_yao_pair_sqlite::ensure_local_deriver_a_pair_schema_v1,
    local_signing_worker_near_sqlite, LocalDeriverAPairSqliteV1,
    LocalEd25519YaoDeriverBEffectiveStateV1, LocalEd25519YaoPairRoleRecordV1,
    LocalEd25519YaoWorkerStateV1, LocalRolePrivateSqliteStorageV1, LocalWorkerRoleConfigV1,
};
use router_ab_cloudflare::{
    CloudflareEd25519YaoPairExecuteResponseV1, CloudflareEd25519YaoPairWorkV1,
    CloudflareEd25519YaoTenantRootContextV2, CloudflareServerOutputMaterialRecordV1,
    CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
};
use router_ab_core::{
    ActiveSigningWorkerStateV1, Ed25519YaoExecutionIdV1, Ed25519YaoInputPairBindingV1,
    Ed25519YaoPairRecordV1, Ed25519YaoPairReservationV1, Ed25519YaoPairStartClaimV1,
    Ed25519YaoPairStoreResultV1, LocalServiceRoleV1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult, TenantRootSignedActivationReceiptV1,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, fs, path::PathBuf};

const STATE_KEY: &str = "ed25519-yao/worker-state-v2";
const DERIVER_B_PAIR_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS local_deriver_b_yao_pairs (
    session_hex TEXT PRIMARY KEY,
    pair_digest_hex TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    record_json TEXT NOT NULL
)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalDeriverAPairPayloadV1 {
    pub tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    pub work: CloudflareEd25519YaoPairWorkV1,
    pub input: router_ab_core::Ed25519YaoEncryptedInputV1,
}

pub type LocalDeriverAPairRecordV1 =
    Ed25519YaoPairRecordV1<LocalDeriverAPairPayloadV1, CloudflareEd25519YaoPairExecuteResponseV1>;
pub type LocalDeriverAPairResultV1 = Ed25519YaoPairStoreResultV1<
    LocalDeriverAPairPayloadV1,
    CloudflareEd25519YaoPairExecuteResponseV1,
>;

#[derive(Debug, Clone)]
pub struct LocalDeriverAPairScopeV1 {
    tenant_identity_digest_hex: String,
    wallet_id: String,
}

impl LocalDeriverAPairScopeV1 {
    pub fn from_context(
        root: &CloudflareEd25519YaoTenantRootContextV2,
        pair: &Ed25519YaoInputPairBindingV1,
    ) -> RouterAbProtocolResult<Self> {
        root.validate_for_pair(pair)?;
        let receipt_bytes = root.custody_binding.activation_receipt_bytes()?;
        let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Deriver A tenant-root receipt is invalid: {error}"),
            )
        })?;
        Ok(Self {
            tenant_identity_digest_hex: hex::encode(receipt.identity_digest().as_bytes()),
            wallet_id: pair.binding().lifecycle.account_id.clone(),
        })
    }
}

pub struct LocalEd25519YaoSqliteHostV1 {
    connection: RefCell<Connection>,
    role_state_snapshot: RefCell<Option<Vec<u8>>>,
}

impl LocalEd25519YaoSqliteHostV1 {
    pub fn open(config: &LocalWorkerRoleConfigV1) -> Result<Self, Box<dyn std::error::Error>> {
        let path = match config {
            LocalWorkerRoleConfigV1::DeriverA(config) => config.role_private_storage_path.as_str(),
            LocalWorkerRoleConfigV1::DeriverB(config) => config.role_private_storage_path.as_str(),
            LocalWorkerRoleConfigV1::SigningWorker(config) => {
                config.role_private_storage_path.as_str()
            }
            LocalWorkerRoleConfigV1::Router(_) => {
                return Err("Router does not own local Ed25519 Yao secret state".into());
            }
        };
        let path = PathBuf::from(path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        LocalRolePrivateSqliteStorageV1::new(&connection)?;
        if config.role() == LocalServiceRoleV1::DeriverA {
            ensure_local_deriver_a_pair_schema_v1(&connection)?;
        } else if config.role() == LocalServiceRoleV1::DeriverB {
            connection
                .execute_batch(DERIVER_B_PAIR_SCHEMA)
                .map_err(pair_lookup_error)?;
        } else if config.role() == LocalServiceRoleV1::SigningWorker {
            local_signing_worker_near_sqlite::ensure_schema(&connection)?;
        }
        Ok(Self {
            connection: RefCell::new(connection),
            role_state_snapshot: RefCell::new(None),
        })
    }

    pub fn load_state(
        &self,
        role: LocalServiceRoleV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoWorkerStateV1> {
        let connection = self.connection.borrow();
        let storage = LocalRolePrivateSqliteStorageV1::new(&connection)?;
        let bytes = storage.get_bytes(STATE_KEY)?;
        if matches!(
            role,
            LocalServiceRoleV1::DeriverB | LocalServiceRoleV1::SigningWorker
        ) {
            *self.role_state_snapshot.borrow_mut() = bytes.clone();
        }
        let Some(bytes) = bytes else {
            return Ok(LocalEd25519YaoWorkerStateV1::default());
        };
        LocalEd25519YaoWorkerStateV1::decode_durable_state_for_role_v1(role, &bytes)
    }

    pub fn persist_state(
        &self,
        role: LocalServiceRoleV1,
        state: &LocalEd25519YaoWorkerStateV1,
    ) -> RouterAbProtocolResult<()> {
        let bytes = state.encode_durable_state_for_role_v1(role)?;
        if matches!(
            role,
            LocalServiceRoleV1::DeriverB | LocalServiceRoleV1::SigningWorker
        ) {
            let mut connection = self.connection.borrow_mut();
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(pair_lookup_error)?;
            let storage = LocalRolePrivateSqliteStorageV1::new(&transaction)?;
            if storage.get_bytes(STATE_KEY)? != *self.role_state_snapshot.borrow() {
                return Err(pair_lookup_conflict(
                    "role state changed in another process",
                ));
            }
            storage.put_bytes(STATE_KEY, &bytes)?;
            transaction.commit().map_err(pair_lookup_error)?;
            *self.role_state_snapshot.borrow_mut() = Some(bytes);
            return Ok(());
        }
        let connection = self.connection.borrow();
        LocalRolePrivateSqliteStorageV1::new(&connection)?.put_bytes(STATE_KEY, &bytes)
    }

    pub fn prepare_near(
        &self,
        request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
        active: ActiveSigningWorkerStateV1,
        material: CloudflareServerOutputMaterialRecordV1,
        now_ms: u64,
    ) -> RouterAbProtocolResult<String> {
        let connection = self.connection.borrow();
        local_signing_worker_near_sqlite::prepare(&connection, request, active, material, now_ms)
    }

    pub fn finalize_near(
        &self,
        request: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
        active: ActiveSigningWorkerStateV1,
        material: CloudflareServerOutputMaterialRecordV1,
        now_ms: u64,
    ) -> RouterAbProtocolResult<String> {
        let connection = self.connection.borrow();
        local_signing_worker_near_sqlite::finalize(&connection, request, active, material, now_ms)
    }

    pub fn read_near_terminal(
        &self,
        request: &CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    ) -> RouterAbProtocolResult<Option<String>> {
        let connection = self.connection.borrow();
        local_signing_worker_near_sqlite::read_terminal(&connection, request)
    }

    pub fn read_b_pair(
        &self,
        session: [u8; 32],
        pair_digest: [u8; 32],
    ) -> RouterAbProtocolResult<Option<LocalEd25519YaoPairRoleRecordV1>> {
        let connection = self.connection.borrow();
        read_b_pair_row(&connection, session, pair_digest).map(|row| row.map(|(_, record)| record))
    }

    pub fn transition_b_pair<T>(
        &self,
        session: [u8; 32],
        pair_digest: [u8; 32],
        decide: impl FnOnce(
            Option<&LocalEd25519YaoPairRoleRecordV1>,
        )
            -> RouterAbProtocolResult<(Option<LocalEd25519YaoPairRoleRecordV1>, T)>,
    ) -> RouterAbProtocolResult<T> {
        let mut connection = self.connection.borrow_mut();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(pair_lookup_error)?;
        let current = read_b_pair_row(&transaction, session, pair_digest)?;
        let (next, result) = decide(current.as_ref().map(|(_, record)| record))?;
        write_b_pair_row(
            &transaction,
            session,
            pair_digest,
            current.as_ref(),
            next.as_ref(),
        )?;
        transaction.commit().map_err(pair_lookup_error)?;
        Ok(result)
    }

    pub fn complete_b_pair(
        &self,
        session: [u8; 32],
        pair_digest: [u8; 32],
        running: &LocalEd25519YaoPairRoleRecordV1,
        completed: &LocalEd25519YaoPairRoleRecordV1,
        effective_delta: Option<LocalEd25519YaoDeriverBEffectiveStateV1>,
    ) -> RouterAbProtocolResult<()> {
        let mut connection = self.connection.borrow_mut();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(pair_lookup_error)?;
        let current = read_b_pair_row(&transaction, session, pair_digest)?;
        let Some((_, selected)) = &current else {
            return Err(pair_lookup_conflict(
                "Deriver B pair disappeared before completion",
            ));
        };
        if selected != running {
            return Err(pair_lookup_conflict(
                "Deriver B pair execution changed before completion",
            ));
        }
        match (running, completed) {
            (
                LocalEd25519YaoPairRoleRecordV1::Running {
                    execution_id: running_id,
                    root_metadata_digest: running_root,
                    ..
                },
                LocalEd25519YaoPairRoleRecordV1::Completed {
                    execution_id: completed_id,
                    root_metadata_digest: completed_root,
                    execution,
                    ..
                },
            ) if running_id == completed_id
                && running_root == completed_root
                && execution.deriver() == router_ab_core::Ed25519YaoDeriverRoleV1::DeriverB =>
            {
                execution
                    .validate()
                    .map_err(|_| pair_lookup_conflict("Deriver B completion is invalid"))?;
            }
            _ => {
                return Err(pair_lookup_conflict(
                    "Deriver B completion does not own its execution",
                ))
            }
        }
        let storage = LocalRolePrivateSqliteStorageV1::new(&transaction)?;
        let bytes = storage.get_bytes(STATE_KEY)?;
        let mut durable_state = match bytes {
            Some(bytes) => LocalEd25519YaoWorkerStateV1::decode_durable_state_for_role_v1(
                LocalServiceRoleV1::DeriverB,
                &bytes,
            )?,
            None => LocalEd25519YaoWorkerStateV1::default(),
        };
        durable_state.apply_deriver_b_effective_delta(effective_delta)?;
        let updated =
            durable_state.encode_durable_state_for_role_v1(LocalServiceRoleV1::DeriverB)?;
        storage.put_bytes(STATE_KEY, &updated)?;
        write_b_pair_row(
            &transaction,
            session,
            pair_digest,
            current.as_ref(),
            Some(completed),
        )?;
        transaction.commit().map_err(pair_lookup_error)?;
        *self.role_state_snapshot.borrow_mut() = Some(updated);
        Ok(())
    }

    pub fn read_a_pair(
        &self,
        scope: &LocalDeriverAPairScopeV1,
        pair: &Ed25519YaoInputPairBindingV1,
    ) -> RouterAbProtocolResult<Option<(u64, LocalDeriverAPairRecordV1)>> {
        let mut connection = self.connection.borrow_mut();
        LocalDeriverAPairSqliteV1::new(
            &mut connection,
            &scope.tenant_identity_digest_hex,
            &scope.wallet_id,
        )?
        .read(pair)
    }

    pub fn read_a_pair_by_lookup(
        &self,
        session: [u8; 32],
        pair_digest: [u8; 32],
    ) -> RouterAbProtocolResult<Option<(LocalDeriverAPairScopeV1, LocalDeriverAPairRecordV1)>> {
        let candidates = {
            let connection = self.connection.borrow();
            let mut statement = connection
                .prepare(
                    "SELECT tenant_id, wallet_id, record_json FROM local_deriver_a_yao_pairs \
                     WHERE session_hex = ?1",
                )
                .map_err(pair_lookup_error)?;
            let rows = statement
                .query_map(params![hex::encode(session)], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(pair_lookup_error)?;
            let mut candidates = Vec::new();
            for row in rows {
                let (tenant_id, wallet_id, record_json) = row.map_err(pair_lookup_error)?;
                let record: LocalDeriverAPairRecordV1 = serde_json::from_str(&record_json)
                    .map_err(|error| {
                        RouterAbProtocolError::new(
                            RouterAbProtocolErrorCode::InvalidLifecycleState,
                            format!("Deriver A pair record is malformed: {error}"),
                        )
                    })?;
                if record.pair_binding().pair_digest().bytes == pair_digest {
                    candidates.push((tenant_id, wallet_id, record.pair_binding().clone()));
                }
            }
            candidates
        };
        let [(tenant_identity_digest_hex, wallet_id, pair_binding)] = candidates.as_slice() else {
            if candidates.is_empty() {
                return Ok(None);
            }
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Deriver A pair lookup is ambiguous across tenant scopes",
            ));
        };
        let scope = LocalDeriverAPairScopeV1 {
            tenant_identity_digest_hex: tenant_identity_digest_hex.clone(),
            wallet_id: wallet_id.clone(),
        };
        let (_, record) = self.read_a_pair(&scope, pair_binding)?.ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Deriver A pair disappeared during lookup",
            )
        })?;
        Ok(Some((scope, record)))
    }

    pub fn prepare_a_pair(
        &self,
        scope: &LocalDeriverAPairScopeV1,
        record: LocalDeriverAPairRecordV1,
        now_ms: u64,
    ) -> RouterAbProtocolResult<LocalDeriverAPairResultV1> {
        let mut connection = self.connection.borrow_mut();
        self.a_store(&mut connection, scope)?
            .prepare(record, now_ms)
    }

    pub fn reserve_a_pair(
        &self,
        scope: &LocalDeriverAPairScopeV1,
        reservation: Ed25519YaoPairReservationV1<'_>,
    ) -> RouterAbProtocolResult<LocalDeriverAPairResultV1> {
        let mut connection = self.connection.borrow_mut();
        self.a_store(&mut connection, scope)?.reserve(reservation)
    }

    pub fn claim_a_pair(
        &self,
        scope: &LocalDeriverAPairScopeV1,
        claim: Ed25519YaoPairStartClaimV1<'_>,
    ) -> RouterAbProtocolResult<LocalDeriverAPairResultV1> {
        let mut connection = self.connection.borrow_mut();
        self.a_store(&mut connection, scope)?.claim(claim)
    }

    pub fn complete_a_pair(
        &self,
        scope: &LocalDeriverAPairScopeV1,
        pair: &Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
        outcome: CloudflareEd25519YaoPairExecuteResponseV1,
        now_ms: u64,
        state: &LocalEd25519YaoWorkerStateV1,
    ) -> RouterAbProtocolResult<LocalDeriverAPairResultV1> {
        let bytes = state.encode_durable_state_for_role_v1(LocalServiceRoleV1::DeriverA)?;
        let mut connection = self.connection.borrow_mut();
        self.a_store(&mut connection, scope)?.complete_with(
            pair,
            execution_id,
            outcome,
            now_ms,
            60_000,
            |transaction| {
                let storage = LocalRolePrivateSqliteStorageV1::new(transaction)?;
                storage.put_bytes(STATE_KEY, &bytes)
            },
        )
    }

    pub fn burn_a_pair(
        &self,
        scope: &LocalDeriverAPairScopeV1,
        pair: &Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
    ) -> RouterAbProtocolResult<LocalDeriverAPairResultV1> {
        let mut connection = self.connection.borrow_mut();
        self.a_store(&mut connection, scope)?
            .burn(pair, execution_id)
    }

    pub fn expire_a_pair(
        &self,
        scope: &LocalDeriverAPairScopeV1,
        pair: &Ed25519YaoInputPairBindingV1,
        now_ms: u64,
    ) -> RouterAbProtocolResult<LocalDeriverAPairResultV1> {
        let mut connection = self.connection.borrow_mut();
        self.a_store(&mut connection, scope)?.expire(pair, now_ms)
    }

    fn a_store<'a>(
        &self,
        connection: &'a mut Connection,
        scope: &LocalDeriverAPairScopeV1,
    ) -> RouterAbProtocolResult<LocalDeriverAPairSqliteV1<'a>> {
        LocalDeriverAPairSqliteV1::new(
            connection,
            &scope.tenant_identity_digest_hex,
            &scope.wallet_id,
        )
    }
}

fn pair_lookup_error(error: rusqlite::Error) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("Deriver A pair lookup failed: {error}"),
    )
}

fn pair_lookup_conflict(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

fn read_b_pair_row(
    connection: &Connection,
    session: [u8; 32],
    pair_digest: [u8; 32],
) -> RouterAbProtocolResult<Option<(i64, LocalEd25519YaoPairRoleRecordV1)>> {
    let row = connection
        .query_row(
            "SELECT pair_digest_hex, revision, record_json FROM local_deriver_b_yao_pairs WHERE session_hex = ?1",
            params![hex::encode(session)],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?)),
        )
        .optional()
        .map_err(pair_lookup_error)?;
    row.map(|(stored_digest, revision, json)| {
        if stored_digest != hex::encode(pair_digest) || revision <= 0 {
            return Err(pair_lookup_conflict(
                "Deriver B pair scope conflicts with its session",
            ));
        }
        let record: LocalEd25519YaoPairRoleRecordV1 = serde_json::from_str(&json)
            .map_err(|_| pair_lookup_conflict("Deriver B pair record is malformed"))?;
        if record.session() != session || record.pair_digest() != pair_digest {
            return Err(pair_lookup_conflict(
                "Deriver B pair record identity changed",
            ));
        }
        crate::local_ed25519_yao_worker::validate_pair_role_record(
            LocalServiceRoleV1::DeriverB,
            &record,
        )?;
        Ok((revision, record))
    })
    .transpose()
}

fn write_b_pair_row(
    transaction: &rusqlite::Transaction<'_>,
    session: [u8; 32],
    pair_digest: [u8; 32],
    current: Option<&(i64, LocalEd25519YaoPairRoleRecordV1)>,
    next: Option<&LocalEd25519YaoPairRoleRecordV1>,
) -> RouterAbProtocolResult<()> {
    let Some(next) = next else {
        return Ok(());
    };
    if current.is_some_and(|(_, record)| record == next) {
        return Ok(());
    }
    if next.session() != session || next.pair_digest() != pair_digest {
        return Err(pair_lookup_conflict(
            "Deriver B pair transition changed identity",
        ));
    }
    crate::local_ed25519_yao_worker::validate_pair_role_record(LocalServiceRoleV1::DeriverB, next)?;
    let json = serde_json::to_string(next)
        .map_err(|_| pair_lookup_conflict("Deriver B pair record cannot be encoded"))?;
    let written = match current {
        None => transaction.execute(
            "INSERT INTO local_deriver_b_yao_pairs (session_hex, pair_digest_hex, revision, record_json) VALUES (?1, ?2, 1, ?3) ON CONFLICT DO NOTHING",
            params![hex::encode(session), hex::encode(pair_digest), json],
        ),
        Some((revision, _)) => transaction.execute(
            "UPDATE local_deriver_b_yao_pairs SET revision = revision + 1, record_json = ?1 WHERE session_hex = ?2 AND pair_digest_hex = ?3 AND revision = ?4",
            params![json, hex::encode(session), hex::encode(pair_digest), revision],
        ),
    }
    .map_err(pair_lookup_error)?;
    if written != 1 {
        return Err(pair_lookup_conflict(
            "Deriver B pair conditional write is uncertain",
        ));
    }
    // A terminal record ends the attempt here, so the same transaction
    // settles its root-use admission.
    if matches!(
        next,
        LocalEd25519YaoPairRoleRecordV1::Completed { .. }
            | LocalEd25519YaoPairRoleRecordV1::Burned { .. }
            | LocalEd25519YaoPairRoleRecordV1::Expired { .. }
    ) {
        transaction
            .execute(
                router_ab_cloudflare::TENANT_ROOT_SETTLE_ROOT_USE_ADMISSION_SQL_V1,
                params![
                    "deriver_b",
                    router_ab_cloudflare::TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1,
                    hex::encode(session)
                ],
            )
            .map_err(pair_lookup_error)?;
    }
    Ok(())
}
