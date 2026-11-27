//! Role-store execution: activation, epoch swap, cleanup, root-use and Yao admission.

use super::*;

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {
    /// Activates epoch 1 only when this role has no active epoch for the root.
    pub(crate) async fn activate_initial_pending(
        &self,
        command: CloudflareTenantRootActivateInitialPendingCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootActivateInitialPendingCommandV1 {
            scope,
            pending,
            reservation,
            activation,
            updated_at_ms,
            expected_revision,
        } = command;
        validate_pending_stored_record(&self.cipher, &pending)?;
        if pending.record.epoch != TenantRootShareEpoch::INITIAL {
            return Err(store_error(
                "tenant-root initial activation requires epoch 1",
            ));
        }
        if expected_revision != pending.revision {
            return Err(store_error(
                "tenant-root initial activation command revision changed",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_revision,
            "tenant-root initial activation",
        )?;
        let operation =
            TenantRootCommandOperationV1::activate_initial(activate_initial_payload_digest(
                &pending,
                &activation,
                updated_at_ms,
                expected_revision,
            )?);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "tenant-root initial activation",
        )?;
        let revision = next_revision(expected_revision)?;
        let record = pending.record.into_active(activation, updated_at_ms)?;
        let metadata = record_metadata(&record)?;
        let ciphertext_json = self.cipher.seal(&record, revision)?;
        let epoch = metadata.epoch.to_string();
        let updated_at_ms = record.updated_at_ms.to_string();
        let expected_revision_text = expected_revision.to_string();
        let lifecycle_statement = self
            .session
            .prepare(ACTIVATE_INITIAL_PENDING_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(ciphertext_json.as_str()),
                    RoleSqlValue::Text(updated_at_ms.as_str()),
                    RoleSqlValue::Text(metadata.identity_digest_hex.as_str()),
                    RoleSqlValue::Text(metadata.custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(epoch.as_str()),
                    RoleSqlValue::Text(metadata.role.as_str()),
                    RoleSqlValue::Text(expected_revision_text.as_str()),
                ]
                .iter(),
            )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let executed = self
            .run_lifecycle_checkpoint(
                lifecycle_statement,
                1,
                checkpoint_statement,
                reservation,
                executed_at_ms,
            )
            .await?;
        Ok((
            CloudflareStoredTenantRootRoleShareV1 { record, revision },
            executed,
        ))
    }

    /// Atomically retires one active epoch and activates its exact next pending epoch.
    ///
    /// The returned pair contains the retired row first and the newly active row second.
    pub(crate) async fn swap_active_epoch(
        &self,
        command: CloudflareTenantRootSwapActiveEpochCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<(
        (
            CloudflareStoredTenantRootRoleShareV1,
            CloudflareStoredTenantRootRoleShareV1,
        ),
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootSwapActiveEpochCommandV1 {
            scope,
            reservation,
            active,
            pending,
            activation,
            retirement,
            updated_at_ms,
            expected_active_revision,
            expected_pending_revision,
        } = command;
        validate_active_stored_record(&self.cipher, &active)?;
        validate_pending_stored_record(&self.cipher, &pending)?;
        validate_epoch_swap_inputs(&active, &pending)?;
        validate_activation_receipt_against_swap_records(&activation, &active, &pending)?;
        if expected_active_revision != active.revision
            || expected_pending_revision != pending.revision
        {
            return Err(store_error(
                "tenant-root epoch-swap command revision changed",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_pending_revision,
            "tenant-root epoch swap",
        )?;
        let operation =
            TenantRootCommandOperationV1::swap_active_epoch(swap_active_epoch_payload_digest(
                &active,
                &pending,
                &activation,
                &retirement,
                updated_at_ms,
                expected_active_revision,
                expected_pending_revision,
            )?);
        validate_reserved_command(&scope, &reservation, operation, "tenant-root epoch swap")?;
        let retired_revision = next_revision(expected_active_revision)?;
        let activated_revision = next_revision(expected_pending_revision)?;
        let retired_record = active.record.into_retired(retirement, updated_at_ms)?;
        let activated_record = pending.record.into_active(activation, updated_at_ms)?;
        let retired_metadata = record_metadata(&retired_record)?;
        let activated_metadata = record_metadata(&activated_record)?;
        if retired_metadata.identity_digest_hex != activated_metadata.identity_digest_hex
            || retired_metadata.custody_lineage_b64u != activated_metadata.custody_lineage_b64u
            || retired_metadata.role != activated_metadata.role
        {
            return Err(store_error(
                "tenant-root epoch swap metadata changed during transition",
            ));
        }
        let current_epoch = retired_metadata.epoch.to_string();
        let next_epoch = activated_metadata.epoch.to_string();
        let current_revision = active.revision.to_string();
        let next_revision = pending.revision.to_string();
        let updated_at_ms = timestamp_i64(updated_at_ms)?.to_string();
        let retired_ciphertext_json = self.cipher.seal(&retired_record, retired_revision)?;
        let activated_ciphertext_json = self.cipher.seal(&activated_record, activated_revision)?;
        // Retire before activating so the unique active-root index holds at
        // every statement. Both mutations and the checkpoint commit together.
        let parameters = [
            RoleSqlValue::Text(retired_metadata.identity_digest_hex.as_str()),
            RoleSqlValue::Text(retired_metadata.custody_lineage_b64u.as_str()),
            RoleSqlValue::Text(current_epoch.as_str()),
            RoleSqlValue::Text(retired_metadata.role.as_str()),
            RoleSqlValue::Text(current_revision.as_str()),
            RoleSqlValue::Text(next_epoch.as_str()),
            RoleSqlValue::Text(next_revision.as_str()),
            RoleSqlValue::Text(retired_ciphertext_json.as_str()),
            RoleSqlValue::Text(activated_ciphertext_json.as_str()),
            RoleSqlValue::Text(updated_at_ms.as_str()),
        ];
        let retire_statement = self
            .session
            .prepare(RETIRE_ACTIVE_FOR_SWAP_SQL)
            .bind_refs(parameters.iter())?;
        let activate_statement = self
            .session
            .prepare(ACTIVATE_PENDING_FOR_SWAP_SQL)
            .bind_refs(parameters.iter())?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let executed = self
            .run_epoch_transition_checkpoint(
                retire_statement,
                activate_statement,
                checkpoint_statement,
                reservation,
                executed_at_ms,
            )
            .await?;
        Ok((
            (
                CloudflareStoredTenantRootRoleShareV1 {
                    record: retired_record,
                    revision: retired_revision,
                },
                CloudflareStoredTenantRootRoleShareV1 {
                    record: activated_record,
                    revision: activated_revision,
                },
            ),
            executed,
        ))
    }

    /// Validates one reserved pending cleanup and prepares its row removal and
    /// execution checkpoint.
    pub(super) fn cleanup_pending_statements(
        &self,
        command: CloudflareTenantRootCleanupPendingCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<(
        RoleSqlStatement<'_, S>,
        RoleSqlStatement<'_, S>,
        ReservedTenantRootCommandV1,
        TenantRootRoleD1MetadataV1,
    )> {
        let CloudflareTenantRootCleanupPendingCommandV1 {
            scope,
            reservation,
            pending,
            expected_revision,
            operation_payload_digest,
        } = command;
        validate_pending_stored_record(&self.cipher, &pending)?;
        if expected_revision != pending.revision {
            return Err(store_error(
                "tenant-root pending-cleanup command revision changed",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_revision,
            "tenant-root pending cleanup",
        )?;
        let operation = TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "tenant-root pending cleanup",
        )?;
        let metadata = record_metadata(&pending.record)?;
        let epoch = metadata.epoch.to_string();
        let revision = expected_revision.to_string();
        let lifecycle_statement = self.session.prepare(CLEANUP_PENDING_SQL).bind_refs(
            [
                RoleSqlValue::Text(metadata.identity_digest_hex.as_str()),
                RoleSqlValue::Text(metadata.custody_lineage_b64u.as_str()),
                RoleSqlValue::Text(epoch.as_str()),
                RoleSqlValue::Text(metadata.role.as_str()),
                RoleSqlValue::Text(revision.as_str()),
            ]
            .iter(),
        )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        Ok((lifecycle_statement, checkpoint_statement, reservation, metadata))
    }

    /// Removes an abandoned creation's recorded pending row and tombstones its
    /// lineage in the same batch, as the ceremony-bound cleanup does, so a
    /// late attempt of that creation knows its writes were abandoned.
    pub(super) async fn clean_abandoned_pending(
        &self,
        command: CloudflareTenantRootCleanupPendingCommandV1,
        ceremony_session_id: TenantRootCeremonySessionIdV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<ExecutedTenantRootCommandV1> {
        let (lifecycle_statement, checkpoint_statement, reservation, metadata) =
            self.cleanup_pending_statements(command, executed_at_ms)?;
        if metadata.epoch != TenantRootShareEpoch::INITIAL.get().get() {
            return Err(store_error(
                "tenant-root abandoned-creation cleanup requires an initial-epoch row",
            ));
        }
        if executed_at_ms < reservation.reserved_at_ms() {
            return Err(store_error(
                "tenant-root command execution checkpoint precedes its reservation",
            ));
        }
        let session_id_hex = encode_hex(ceremony_session_id.as_bytes());
        let created_at_ms = executed_at_ms.to_string();
        let tombstone = self.session.prepare(INSERT_CREATION_TOMBSTONE_SQL).bind_refs(
            [
                RoleSqlValue::Text(metadata.identity_digest_hex.as_str()),
                RoleSqlValue::Text(metadata.custody_lineage_b64u.as_str()),
                RoleSqlValue::Text(metadata.role.as_str()),
                RoleSqlValue::Text(session_id_hex.as_str()),
                RoleSqlValue::Text(created_at_ms.as_str()),
            ]
            .iter(),
        )?;
        let results = self
            .session
            .transaction(vec![
                lifecycle_statement.expect_changes(1),
                tombstone.expect_changes(1),
                checkpoint_statement.expect_changes(1),
            ])
            .await?;
        if results.len() != 3 || results.iter().any(|result| !result.success()) {
            return Err(store_error("tenant-root abandoned pending cleanup transaction failed"));
        }
        for (index, what) in [
            (0, "tenant-root pending row changed concurrently"),
            (1, "tenant-root abandoned-creation tombstone changed concurrently"),
            (2, "tenant-root command execution checkpoint changed concurrently"),
        ] {
            require_one_change(&results[index], what)?;
        }
        reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))
    }

    /// Settles one exact attempt's admission here and reports which commit
    /// won. Settlement and recovery's cancellation race for the same row;
    /// only a settlement, this one or an earlier one of the same attempt,
    /// lets the attempt go on.
    pub(crate) async fn settle_root_use_admission(
        &self,
        attempt: &TenantRootRootUseAttemptV1,
        custody_binding: &TenantRootCustodyBindingV1,
    ) -> RoleStoreResult<TenantRootSettlementOutcomeV1> {
        let identity_digest_hex = encode_hex(custody_binding.identity_digest().as_bytes());
        let custody_lineage_b64u = custody_binding.custody_lineage().to_base64url();
        let attempt_key_hex = attempt.key_hex(custody_binding);
        let attempt_digest_hex = encode_hex(
            custody_binding
                .attempt_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let settled = self
            .session
            .prepare(SETTLE_EXACT_ROOT_USE_ADMISSION_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(attempt.kind()),
                    RoleSqlValue::Text(attempt_key_hex.as_str()),
                    RoleSqlValue::Text(attempt_digest_hex.as_str()),
                ]
                .iter(),
            )?
            .run()
            .await?
            .changes()?;
        if settled == 1 {
            return Ok(TenantRootSettlementOutcomeV1::Won);
        }
        let admission = self
            .session
            .prepare(LOAD_ROOT_USE_ADMISSION_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(attempt.kind()),
                    RoleSqlValue::Text(attempt_key_hex.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRootUseAdmissionRowV1>(None)
            .await?
            .ok_or_else(|| store_error("tenant-root admission to settle does not exist"))?;
        if admission.attempt_digest_hex != attempt_digest_hex {
            return Err(store_error(
                "tenant-root admission to settle belongs to another binding of the attempt",
            ));
        }
        match admission.status.as_str() {
            "settled" => Ok(TenantRootSettlementOutcomeV1::AlreadySettled),
            "cancelled" => Ok(TenantRootSettlementOutcomeV1::CancellationWon),
            _ => Err(store_error("tenant-root admission settlement changed no row")),
        }
    }

    /// Counts the root-use admissions on one epoch at this role that are not
    /// yet settled or cancelled. A retired epoch is erased only at zero.
    pub(crate) async fn unsettled_root_use_admissions(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> RoleStoreResult<u64> {
        self.count_root_use_admissions(
            COUNT_UNSETTLED_ROOT_USE_ADMISSIONS_SQL,
            identity_digest,
            custody_lineage,
            epoch,
        )
        .await
    }

    /// Counts the root-use admissions on one epoch at this role that recovery
    /// cancelled. The rows outlive the erasure, so the count replays exactly.
    pub(crate) async fn cancelled_root_use_admissions(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> RoleStoreResult<u64> {
        self.count_root_use_admissions(
            COUNT_CANCELLED_ROOT_USE_ADMISSIONS_SQL,
            identity_digest,
            custody_lineage,
            epoch,
        )
        .await
    }

    /// The unsettled admissions on one epoch here whose pairs are held in
    /// wallet objects, oldest first.
    pub(crate) async fn unsettled_wallet_object_admissions(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> RoleStoreResult<Vec<TenantRootWalletObjectAdmissionV1>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let epoch = epoch_i64(epoch)?.to_string();
        Ok(self
            .session
            .prepare(LIST_WALLET_OBJECT_ADMISSIONS_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(epoch.as_str()),
                ]
                .iter(),
            )?
            .all()
            .await?
            .results::<TenantRootWalletObjectAdmissionV1>()?)
    }

    /// Records a wallet object's report for one admission here: settled when
    /// the object says the pair completed, cancelled when it fenced it.
    /// Replaying either changes nothing.
    pub(crate) async fn record_wallet_object_reconciliation(
        &self,
        attempt_key_hex: &str,
        pair_object_id: &str,
        reconciliation: TenantRootWalletPairReconciliationV1,
    ) -> RoleStoreResult<()> {
        let sql = match reconciliation {
            TenantRootWalletPairReconciliationV1::Completed => {
                TENANT_ROOT_SETTLE_WALLET_OBJECT_ADMISSION_SQL_V1
            }
            TenantRootWalletPairReconciliationV1::Fenced => CANCEL_WALLET_OBJECT_ADMISSION_SQL,
            TenantRootWalletPairReconciliationV1::Claimed
            | TenantRootWalletPairReconciliationV1::Open => return Ok(()),
        };
        self.session
            .prepare(sql)
            .bind_refs(
                [
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1),
                    RoleSqlValue::Text(attempt_key_hex),
                    RoleSqlValue::Text(pair_object_id),
                ]
                .iter(),
            )?
            .run()
            .await?;
        Ok(())
    }

    /// One Yao pair session's admission here, if it was ever admitted.
    pub(crate) async fn yao_admission(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        session_hex: &str,
    ) -> RoleStoreResult<Option<TenantRootYaoAdmissionStateV1>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let row = self
            .session
            .prepare(LOAD_ROOT_USE_ADMISSION_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1),
                    RoleSqlValue::Text(session_hex),
                ]
                .iter(),
            )?
            .first::<TenantRootRootUseAdmissionRowV1>(None)
            .await?;
        Ok(row.map(|row| TenantRootYaoAdmissionStateV1 {
            status: row.status,
            pair_object_id: row.pair_object_id,
        }))
    }

    /// The epoch active at this role for one lineage, if any.
    pub(crate) async fn lineage_active_epoch(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RoleStoreResult<Option<u64>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        self.session
            .prepare(LOAD_LINEAGE_ACTIVE_EPOCH_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootActiveEpochRowV1>(None)
            .await?
            .map(|row| {
                u64::try_from(row.tenant_root_share_epoch)
                    .map_err(|_| store_error("tenant-root active epoch is negative"))
            })
            .transpose()
    }

    /// Deriver A's claimed admissions on one epoch here, with pairs in this
    /// store, still unsettled at the cutoff: their pair session keys.
    pub(crate) async fn claimed_yao_admissions(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
        admitted_at_or_before_ms: u64,
    ) -> RoleStoreResult<Vec<String>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let epoch = epoch_i64(epoch)?.to_string();
        let cutoff = admitted_at_or_before_ms.to_string();
        Ok(self
            .session
            .prepare(LIST_CLAIMED_ROOT_USE_ADMISSIONS_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(epoch.as_str()),
                    RoleSqlValue::Text(TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1),
                    RoleSqlValue::Text(cutoff.as_str()),
                ]
                .iter(),
            )?
            .all()
            .await?
            .results::<TenantRootAttemptKeyRowV1>()?
            .into_iter()
            .map(|row| row.attempt_key_hex)
            .collect())
    }

    /// Cancels one Yao attempt's admission here, as the fence it is in this
    /// store: `claimed` for Deriver A's executor once its peer can no longer
    /// complete the pair, or only `admitted` for a peer fencing its own side.
    /// It moves only a row in that state whose pair is in this store.
    pub(crate) async fn cancel_yao_admission(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        session_hex: &str,
        claimed: bool,
    ) -> RoleStoreResult<()> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        self.session
            .prepare(if claimed {
                CANCEL_CLAIMED_ROOT_USE_ADMISSION_SQL
            } else {
                CANCEL_ADMITTED_ROOT_USE_ADMISSION_SQL
            })
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1),
                    RoleSqlValue::Text(session_hex),
                ]
                .iter(),
            )?
            .run()
            .await?;
        Ok(())
    }

    /// Recovery cancels the admissions on one epoch here that are still
    /// unclaimed at a cutoff and whose later steps this store fences
    /// ([`CANCEL_UNCLAIMED_ROOT_USE_ADMISSIONS_SQL`]).
    pub(crate) async fn cancel_unclaimed_root_use_admissions(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
        admitted_at_or_before_ms: u64,
    ) -> RoleStoreResult<()> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let epoch = epoch_i64(epoch)?.to_string();
        let cutoff = admitted_at_or_before_ms.to_string();
        self.session
            .prepare(CANCEL_UNCLAIMED_ROOT_USE_ADMISSIONS_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(epoch.as_str()),
                    RoleSqlValue::Text(cutoff.as_str()),
                ]
                .iter(),
            )?
            .run()
            .await?;
        Ok(())
    }

    pub(super) async fn count_root_use_admissions(
        &self,
        sql: &'static str,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> RoleStoreResult<u64> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let epoch = epoch_i64(epoch)?.to_string();
        let row = self
            .session
            .prepare(sql)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(epoch.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootAdmissionCountRowV1>(None)
            .await?
            .ok_or_else(|| store_error("tenant-root admission count returned no row"))?;
        u64::try_from(row.admissions)
            .map_err(|_| store_error("tenant-root admission count is negative"))
    }

    /// Removes one exact retired revision while its expected active successor
    /// still exists at the bound revision and every root-use admission on the
    /// retired epoch here is settled or cancelled.
    pub(crate) async fn cleanup_retired(
        &self,
        command: CloudflareTenantRootCleanupRetiredCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<ExecutedTenantRootCommandV1> {
        let CloudflareTenantRootCleanupRetiredCommandV1 {
            scope,
            reservation,
            retired,
            expected_retired_revision,
            expected_active_epoch,
            expected_active_revision,
            operation_payload_digest,
        } = command;
        validate_retired_stored_record(&self.cipher, &retired)?;
        if expected_retired_revision != retired.revision {
            return Err(store_error(
                "tenant-root retired-cleanup command revision changed",
            ));
        }
        if expected_active_revision <= 0 {
            return Err(store_error(
                "tenant-root retired-cleanup command has an invalid active successor revision",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &retired.record,
            expected_retired_revision,
            "tenant-root retired cleanup",
        )?;
        let operation = TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "tenant-root retired cleanup",
        )?;
        let metadata = record_metadata(&retired.record)?;
        let retired_epoch = metadata.epoch.to_string();
        let retired_revision = expected_retired_revision.to_string();
        let active_epoch = epoch_i64(expected_active_epoch)?.to_string();
        let active_revision = expected_active_revision.to_string();
        let lifecycle_statement = self.session.prepare(CLEANUP_RETIRED_SQL).bind_refs(
            [
                RoleSqlValue::Text(metadata.identity_digest_hex.as_str()),
                RoleSqlValue::Text(metadata.custody_lineage_b64u.as_str()),
                RoleSqlValue::Text(retired_epoch.as_str()),
                RoleSqlValue::Text(metadata.role.as_str()),
                RoleSqlValue::Text(retired_revision.as_str()),
                RoleSqlValue::Text(active_epoch.as_str()),
                RoleSqlValue::Text(active_revision.as_str()),
            ]
            .iter(),
        )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        self.run_lifecycle_checkpoint(
            lifecycle_statement,
            1,
            checkpoint_statement,
            reservation,
            executed_at_ms,
        )
        .await
    }

    pub(crate) async fn execute_authorized_cleanup(
        &self,
        command: CloudflareTenantRootAuthorizedCleanupCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootAuthorizedCleanupExecutedCommandV1> {
        let (executed, authorization) = match command {
            CloudflareTenantRootAuthorizedCleanupCommandV1::Pending(command) => {
                let CloudflareTenantRootAuthorizedCleanupPendingCommandV1 {
                    command,
                    authorization,
                } = command;
                let TenantRootRoleCleanupTargetV1::Pending { session_id, .. } =
                    authorization.target()
                else {
                    return Err(store_error(
                        "tenant-root pending cleanup requires a pending authorization",
                    ));
                };
                (
                    self.clean_abandoned_pending(command, *session_id, executed_at_ms)
                        .await?,
                    authorization,
                )
            }
            CloudflareTenantRootAuthorizedCleanupCommandV1::Retired(command) => {
                let CloudflareTenantRootAuthorizedCleanupRetiredCommandV1 {
                    command,
                    authorization,
                } = command;
                (
                    self.cleanup_retired(command, executed_at_ms).await?,
                    authorization,
                )
            }
        };
        Ok(CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
            executed,
            authorization,
        })
    }

    pub(crate) async fn complete_authorized_cleanup(
        &self,
        executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        let CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
            executed,
            authorization,
        } = executed;
        let authorization_bytes = authorization
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        if receipt.payload_bytes() != authorization_bytes {
            return Err(store_error(
                "tenant-root cleanup receipt payload does not match its exact authorization",
            ));
        }
        self.complete_command(executed, receipt).await
    }

}
