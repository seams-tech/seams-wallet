//! Role-store checkpoints and command replay.

use super::*;

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {
    pub(super) fn command_execution_checkpoint_statement(
        &self,
        reservation: &ReservedTenantRootCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<RoleSqlStatement<'_, S>> {
        self.require_command_role(reservation.key())?;
        let key = reservation.key();
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let command_digest_hex = encode_hex(reservation.command_digest().as_bytes());
        let reserved_at_ms = timestamp_i64(reservation.reserved_at_ms())?.to_string();
        let executed_at_ms = timestamp_i64(executed_at_ms)?.to_string();
        self.session.prepare(MARK_COMMAND_EXECUTED_SQL).bind_refs(
            [
                RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                RoleSqlValue::Text(identity_digest_hex.as_str()),
                RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                RoleSqlValue::Text(session_id_hex.as_str()),
                RoleSqlValue::Text(nonce_hex.as_str()),
                RoleSqlValue::Text(key.role().as_str()),
                RoleSqlValue::Text(command_digest_hex.as_str()),
                RoleSqlValue::Text(reserved_at_ms.as_str()),
                RoleSqlValue::Text(executed_at_ms.as_str()),
            ]
            .iter(),
        )
    }

    pub(super) async fn run_lifecycle_checkpoint(
        &self,
        lifecycle_statement: RoleSqlStatement<'_, S>,
        expected_lifecycle_changes: usize,
        checkpoint_statement: RoleSqlStatement<'_, S>,
        reservation: ReservedTenantRootCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<ExecutedTenantRootCommandV1> {
        if executed_at_ms < reservation.reserved_at_ms() {
            return Err(store_error(
                "tenant-root command execution checkpoint precedes its reservation",
            ));
        }
        let results = self
            .session
            .transaction(vec![
                lifecycle_statement.expect_changes(expected_lifecycle_changes),
                checkpoint_statement.expect_changes(1),
            ])
            .await?;
        if results.len() != 2 {
            return Err(store_error(
                "tenant-root lifecycle checkpoint returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root lifecycle checkpoint statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        require_changes(
            &results[0],
            expected_lifecycle_changes,
            "tenant-root lifecycle changed concurrently",
        )?;
        require_one_change(
            &results[1],
            "tenant-root command execution checkpoint changed concurrently",
        )?;
        reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))
    }

    /// Removes an abandoned ceremony's pending initial row, if one exists, and
    /// tombstones its lineage, in one batch with the command checkpoint.
    pub(super) async fn clean_abandoned_ceremony(
        &self,
        reservation: ReservedTenantRootCommandV1,
        authorization: &VerifiedTenantRootRoleCleanupCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<ExecutedTenantRootCommandV1> {
        if executed_at_ms < reservation.reserved_at_ms() {
            return Err(store_error(
                "tenant-root command execution checkpoint precedes its reservation",
            ));
        }
        let TenantRootRoleCleanupTargetV1::AbandonedCeremony { session_id, .. } =
            authorization.target()
        else {
            return Err(store_error(
                "tenant-root abandoned-ceremony cleanup requires an abandoned-ceremony authorization",
            ));
        };
        let identity_digest_hex = encode_hex(authorization.identity_digest().as_bytes());
        let custody_lineage_b64u = authorization.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(session_id.as_bytes());
        let created_at_ms = executed_at_ms.to_string();
        let delete = self.session.prepare(DELETE_ABANDONED_CEREMONY_PENDING_SQL).bind_refs(
            [
                RoleSqlValue::Text(identity_digest_hex.as_str()),
                RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                RoleSqlValue::Text(self.cipher.role.as_str()),
            ]
            .iter(),
        )?;
        let tombstone = self.session.prepare(INSERT_CREATION_TOMBSTONE_SQL).bind_refs(
            [
                RoleSqlValue::Text(identity_digest_hex.as_str()),
                RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                RoleSqlValue::Text(self.cipher.role.as_str()),
                RoleSqlValue::Text(session_id_hex.as_str()),
                RoleSqlValue::Text(created_at_ms.as_str()),
            ]
            .iter(),
        )?;
        let checkpoint = self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        // The delete may remove one row or none; the tombstone and the
        // checkpoint must each land exactly once, or the batch aborts.
        let results = self
            .session
            .transaction(vec![
                delete.into(),
                tombstone.expect_changes(1),
                checkpoint.expect_changes(1),
            ])
            .await?;
        if results.len() != 3 || results.iter().any(|result| !result.success()) {
            return Err(store_error(
                "tenant-root abandoned-ceremony cleanup batch failed",
            ));
        }
        require_one_change(
            &results[1],
            "tenant-root abandoned-ceremony tombstone changed concurrently",
        )?;
        require_one_change(
            &results[2],
            "tenant-root command execution checkpoint changed concurrently",
        )?;
        reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))
    }

    /// Whether an abandonment tombstoned this lineage for this role.
    pub(crate) async fn creation_tombstoned(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RoleStoreResult<bool> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let row = self
            .session
            .prepare(LOAD_CREATION_TOMBSTONE_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootCreationTombstoneRowV1>(None)
            .await?;
        Ok(row.is_some())
    }

    pub(super) async fn checkpoint_command_without_lifecycle(
        &self,
        reservation: ReservedTenantRootCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<ExecutedTenantRootCommandV1> {
        if executed_at_ms < reservation.reserved_at_ms() {
            return Err(store_error(
                "tenant-root command execution checkpoint precedes its reservation",
            ));
        }
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let results = self
            .session
            .transaction(vec![checkpoint_statement.expect_changes(1)])
            .await?;
        if results.len() != 1 {
            return Err(store_error(
                "tenant-root command-only checkpoint returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root command-only checkpoint statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        require_one_change(
            &results[0],
            "tenant-root command execution checkpoint changed concurrently",
        )?;
        reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))
    }

    pub(super) async fn run_epoch_transition_checkpoint(
        &self,
        source_statement: RoleSqlStatement<'_, S>,
        activate_statement: RoleSqlStatement<'_, S>,
        checkpoint_statement: RoleSqlStatement<'_, S>,
        reservation: ReservedTenantRootCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<ExecutedTenantRootCommandV1> {
        if executed_at_ms < reservation.reserved_at_ms() {
            return Err(store_error(
                "tenant-root command execution checkpoint precedes its reservation",
            ));
        }
        let results = self
            .session
            .transaction(vec![
                source_statement.expect_changes(1),
                activate_statement.expect_changes(1),
                checkpoint_statement.expect_changes(1),
            ])
            .await?;
        if results.len() != 3 {
            return Err(store_error(
                "tenant-root epoch transition checkpoint returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root epoch transition checkpoint statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown SQL error".to_owned())
                )));
            }
        }
        require_one_change(
            &results[0],
            "tenant-root epoch transition source changed concurrently",
        )?;
        require_one_change(
            &results[1],
            "tenant-root epoch transition successor changed concurrently",
        )?;
        require_one_change(
            &results[2],
            "tenant-root epoch transition execution checkpoint changed concurrently",
        )?;
        reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))
    }

    pub(super) fn open_row(
        &self,
        row: Option<TenantRootRoleD1RowV1>,
    ) -> Pin<
        Box<
            dyn Future<Output = RoleStoreResult<Option<CloudflareStoredTenantRootRoleShareV1>>> + '_,
        >,
    > {
        // Keep authenticated receipt decoding in a heap-backed future; the
        // Workers WASM stack is too small for the complete encrypted row path.
        Box::pin(async move {
            let Some(row) = row else {
                return Ok(None);
            };
            if row.revision <= 0 {
                return Err(store_error(
                    "tenant-root role-private row has an invalid revision",
                ));
            }
            let revision = row.revision;
            let record = self.cipher.open(&row)?;
            Ok(Some(CloudflareStoredTenantRootRoleShareV1 {
                record,
                revision,
            }))
        })
    }

    pub(super) async fn commit_command_terminal(
        &self,
        input: TenantRootCommandTerminalInputV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        let TenantRootCommandTerminalCommitDataV1 {
            key,
            command_digest,
            reserved_at_ms,
            executed_at_ms,
            receipt_bytes,
            receipt_digest,
            terminal_at_ms,
            terminal_kind,
        } = input.into_commit_data()?;
        self.require_command_role(&key)?;
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let command_digest_hex = encode_hex(command_digest.as_bytes());
        let receipt_b64u = encode_base64url_bytes_v1(&receipt_bytes);
        let receipt_digest_hex = encode_hex(receipt_digest.as_bytes());
        let terminal_at_ms_text = timestamp_i64(terminal_at_ms)?.to_string();
        let reserved_at_ms_text = timestamp_i64(reserved_at_ms)?.to_string();
        let executed_at_ms_text = timestamp_i64(executed_at_ms.unwrap_or_default())?.to_string();
        let result = self
            .session
            .prepare(COMMIT_COMMAND_TERMINAL_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(terminal_kind.as_str()),
                    RoleSqlValue::Text(receipt_b64u.as_str()),
                    RoleSqlValue::Text(receipt_digest_hex.as_str()),
                    RoleSqlValue::Text(terminal_at_ms_text.as_str()),
                    RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(session_id_hex.as_str()),
                    RoleSqlValue::Text(nonce_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(command_digest_hex.as_str()),
                    RoleSqlValue::Text(reserved_at_ms_text.as_str()),
                    RoleSqlValue::Text(terminal_kind.expected_status()),
                    RoleSqlValue::Text(executed_at_ms_text.as_str()),
                ]
                .iter(),
            )?
            .run()
            .await?;
        match result_changes(&result)? {
            1 => Ok(CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }),
            0 => {
                let stored = self.load_command_replay(&key).await?.ok_or_else(|| {
                    store_error(
                        "tenant-root terminal command conflict has no durable replay record",
                    )
                })?;
                let decision = reserve_tenant_root_command_v1(
                    Some(&stored.record),
                    key,
                    command_digest,
                    reserved_at_ms,
                )
                .map_err(|error| store_error(error.message()))?;
                let matches_terminal_kind = matches!(
                    (terminal_kind, decision),
                    (
                        TenantRootCommandTerminalKindV1::Completed,
                        TenantRootCommandReplayDecisionV1::ReplayCompleted { .. }
                    ) | (
                        TenantRootCommandTerminalKindV1::Failed,
                        TenantRootCommandReplayDecisionV1::ReplayFailed { .. }
                    )
                );
                let stored_receipt = stored.receipt_bytes.ok_or_else(|| {
                    store_error("tenant-root terminal replay omitted its exact receipt bytes")
                })?;
                if !matches_terminal_kind || stored_receipt != receipt_bytes {
                    return Err(store_error(
                        "tenant-root command terminal receipt conflicts with durable state",
                    ));
                }
                Ok(CloudflareTenantRootCommandTerminalCommitV1::Replay {
                    receipt_bytes: stored_receipt,
                })
            }
            _ => Err(store_error(
                "tenant-root command terminal commit returned an invalid change count",
            )),
        }
    }

    pub(super) async fn load_command_replay(
        &self,
        key: &TenantRootCommandReplayKeyV1,
    ) -> RoleStoreResult<Option<StoredTenantRootCommandReplayV1>> {
        self.require_command_role(key)?;
        let replay_key_digest = key
            .storage_key_digest()
            .map_err(|error| store_error(error.message()))?;
        self.load_command_replay_by_storage_key_digest(replay_key_digest)
            .await
    }

    pub(super) async fn load_command_replay_by_storage_key_digest(
        &self,
        replay_key_digest: TenantRootProtocolDigestV1,
    ) -> RoleStoreResult<Option<StoredTenantRootCommandReplayV1>> {
        let replay_key_digest_hex = encode_hex(replay_key_digest.as_bytes());
        let row = self
            .session
            .prepare(LOAD_COMMAND_REPLAY_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootCommandReplayD1RowV1>(None)
            .await?;
        row.map(|row| self.open_command_replay_row(row)).transpose()
    }

    pub(super) fn open_command_replay_row(
        &self,
        row: TenantRootCommandReplayD1RowV1,
    ) -> RoleStoreResult<StoredTenantRootCommandReplayV1> {
        if row.role != self.cipher.role.as_str() {
            return Err(store_error(
                "tenant-root command replay row belongs to the other Deriver",
            ));
        }
        let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root command identity digest",
            &row.tenant_identity_digest_hex,
        )?);
        let custody_lineage = TenantRootCustodyLineageId::from_base64url(&row.custody_lineage_b64u)
            .map_err(|error| store_error(error.message()))?;
        let session_id = TenantRootCeremonySessionIdV1::from_bytes(decode_lower_hex_fixed::<16>(
            "tenant-root command session id",
            &row.session_id_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
        let nonce = TenantRootCeremonyNonceV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root command nonce",
            &row.nonce_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
        let key = match self.cipher.role {
            CloudflareTenantRootDeriverRoleV1::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
                identity_digest,
                custody_lineage,
                session_id,
                nonce,
            ),
            CloudflareTenantRootDeriverRoleV1::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
                identity_digest,
                custody_lineage,
                session_id,
                nonce,
            ),
        };
        if encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        ) != row.replay_key_digest_hex
        {
            return Err(store_error(
                "tenant-root command replay lookup digest does not match its row",
            ));
        }
        let command_digest = TenantRootProtocolDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root command payload digest",
            &row.command_digest_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
        let admission_digest = row
            .admission_digest_hex
            .as_deref()
            .map(|value| {
                TenantRootProtocolDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
                    "tenant-root command admission digest",
                    value,
                )?)
                .map_err(|error| store_error(error.message()))
            })
            .transpose()?;
        let refresh_state = match (
            row.refresh_state_b64u.as_deref(),
            row.refresh_state_digest_hex.as_deref(),
        ) {
            (None, None) => None,
            (Some(state_b64u), Some(state_digest_hex)) => {
                let state = decode_refresh_durable_state(state_b64u, state_digest_hex)?;
                if admission_digest.is_none() {
                    return Err(store_error(
                        "tenant-root refresh durable state omitted its admission digest",
                    ));
                }
                let command_bytes = state.command_bytes()?;
                let command_digest: [u8; 32] = Sha256::digest(&command_bytes).into();
                if admission_digest
                    != Some(
                        TenantRootProtocolDigestV1::from_bytes(command_digest)
                            .map_err(|error| store_error(error.message()))?,
                    )
                {
                    return Err(store_error(
                        "tenant-root refresh durable command does not match its admission digest",
                    ));
                }
                if !state.kind_matches_status(&row.status) {
                    return Err(store_error(
                        "tenant-root refresh durable state does not match replay status",
                    ));
                }
                Some(state)
            }
            _ => {
                return Err(store_error(
                    "tenant-root refresh durable state columns must be written together",
                ));
            }
        };
        let reserved_at_ms = positive_u64_from_i64(
            "tenant-root command reservation timestamp",
            row.reserved_at_ms,
        )?;
        let reservation =
            match reserve_tenant_root_command_v1(None, key, command_digest, reserved_at_ms)
                .map_err(|error| store_error(error.message()))?
            {
                TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
                _ => {
                    return Err(store_error(
                        "persisted tenant-root command could not reconstruct its reservation",
                    ));
                }
            };
        let (record, receipt_bytes, executed_at_ms) = match row.status.as_str() {
            "reserved"
                if row.receipt_b64u.is_none()
                    && row.receipt_digest_hex.is_none()
                    && row.executed_at_ms.is_none()
                    && row.terminal_at_ms.is_none() =>
            {
                (
                    TenantRootCommandReplayRecordV1::Reserved(reservation),
                    None,
                    None,
                )
            }
            "executed"
                if row.receipt_b64u.is_none()
                    && row.receipt_digest_hex.is_none()
                    && row.terminal_at_ms.is_none() =>
            {
                let executed_at_ms = positive_u64_from_i64(
                    "tenant-root command execution timestamp",
                    row.executed_at_ms.ok_or_else(|| {
                        store_error("executed tenant-root command row omitted execution timestamp")
                    })?,
                )?;
                let executed = reservation
                    .checkpoint_executed(executed_at_ms)
                    .map_err(|error| store_error(error.message()))?;
                (
                    TenantRootCommandReplayRecordV1::Executed(executed),
                    None,
                    Some(executed_at_ms),
                )
            }
            "completed" => {
                let terminal_receipt = decode_stored_terminal_receipt(
                    TenantRootCommandTerminalKindV1::Completed,
                    row.receipt_b64u.as_deref(),
                    row.receipt_digest_hex.as_deref(),
                    row.terminal_at_ms,
                    key,
                    command_digest,
                )?;
                let executed_at_ms = positive_u64_from_i64(
                    "tenant-root command execution timestamp",
                    row.executed_at_ms.ok_or_else(|| {
                        store_error("completed tenant-root command row omitted execution timestamp")
                    })?,
                )?;
                let executed = reservation
                    .checkpoint_executed(executed_at_ms)
                    .map_err(|error| store_error(error.message()))?;
                let record = executed
                    .complete(
                        terminal_receipt.receipt_digest,
                        terminal_receipt.terminal_at_ms,
                    )
                    .map_err(|error| store_error(error.message()))?;
                (
                    record,
                    Some(terminal_receipt.receipt_bytes),
                    Some(executed_at_ms),
                )
            }
            "failed" if row.executed_at_ms.is_none() => {
                let terminal_receipt = decode_stored_terminal_receipt(
                    TenantRootCommandTerminalKindV1::Failed,
                    row.receipt_b64u.as_deref(),
                    row.receipt_digest_hex.as_deref(),
                    row.terminal_at_ms,
                    key,
                    command_digest,
                )?;
                let record = reservation
                    .fail(
                        terminal_receipt.receipt_digest,
                        terminal_receipt.terminal_at_ms,
                    )
                    .map_err(|error| store_error(error.message()))?;
                (record, Some(terminal_receipt.receipt_bytes), None)
            }
            _ => {
                return Err(store_error(
                    "tenant-root command replay row has an invalid lifecycle shape",
                ));
            }
        };
        Ok(StoredTenantRootCommandReplayV1 {
            record,
            admission_digest,
            refresh_state,
            receipt_bytes,
            reserved_at_ms,
            executed_at_ms,
        })
    }

    pub(super) fn reconcile_command_retry(
        &self,
        stored: &StoredTenantRootCommandReplayV1,
        key: TenantRootCommandReplayKeyV1,
        command_digest: TenantRootProtocolDigestV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandReplayDecisionV1> {
        match reserve_tenant_root_command_v1(
            Some(&stored.record),
            key,
            command_digest,
            stored.reserved_at_ms,
        )
        .map_err(|error| store_error(error.message()))?
        {
            TenantRootCommandReplayDecisionV1::Execute(_) => Err(store_error(
                "durable tenant-root command replay returned a fresh execution",
            )),
            TenantRootCommandReplayDecisionV1::InProgress => match &stored.record {
                TenantRootCommandReplayRecordV1::Reserved(_) => Ok(
                    CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution {
                        reservation: replay_reservation_from_stored(stored)?,
                    },
                ),
                TenantRootCommandReplayRecordV1::Executed(_) => Ok(
                    CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion {
                        executed: replay_executed_from_stored(stored)?,
                    },
                ),
                _ => Err(store_error(
                    "tenant-root command replay reported in-progress for a terminal row",
                )),
            },
            TenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_digest } => {
                let receipt_bytes = stored.receipt_bytes.clone().ok_or_else(|| {
                    store_error("completed tenant-root command omitted prior receipt bytes")
                })?;
                require_receipt_digest(&receipt_bytes, receipt_digest)?;
                Ok(CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes })
            }
            TenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_digest,
            } => {
                let failure_receipt_bytes = stored.receipt_bytes.clone().ok_or_else(|| {
                    store_error("failed tenant-root command omitted prior receipt bytes")
                })?;
                require_receipt_digest(&failure_receipt_bytes, failure_receipt_digest)?;
                Ok(CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                })
            }
        }
    }

    pub(super) fn reconcile_initial_creation_retry(
        &self,
        stored: &StoredTenantRootCommandReplayV1,
        key: TenantRootCommandReplayKeyV1,
        creation_admission_digest: TenantRootProtocolDigestV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandReplayDecisionV1> {
        if stored.admission_digest != Some(creation_admission_digest) {
            return Err(store_error(
                "tenant-root creation session was reused with different issuer-authorized bytes",
            ));
        }
        match self.reconcile_command_retry(stored, key, stored.record.command_digest())? {
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { .. }
            | CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { .. } => {
                Ok(CloudflareTenantRootCommandReplayDecisionV1::InProgress)
            }
            decision => Ok(decision),
        }
    }

    pub(super) fn reconcile_authorized_cleanup_retry(
        &self,
        stored: &StoredTenantRootCommandReplayV1,
        key: TenantRootCommandReplayKeyV1,
        authorization_digest: TenantRootProtocolDigestV1,
        expected_command_digest: Option<TenantRootProtocolDigestV1>,
    ) -> RoleStoreResult<CloudflareTenantRootCommandReplayDecisionV1> {
        if stored.admission_digest != Some(authorization_digest) {
            return Err(store_error(
                "tenant-root cleanup session was reused with different authorization bytes",
            ));
        }
        if expected_command_digest
            .is_some_and(|expected| stored.record.command_digest() != expected)
        {
            return Err(store_error(
                "tenant-root cleanup session was reused after the pending row changed",
            ));
        }
        self.reconcile_command_retry(stored, key, stored.record.command_digest())
    }

    pub(super) fn require_command_role(&self, key: &TenantRootCommandReplayKeyV1) -> RoleStoreResult<()> {
        if key.role().as_str() != self.cipher.role.as_str() {
            return Err(store_error(
                "tenant-root command replay key belongs to the other Deriver",
            ));
        }
        Ok(())
    }
}
