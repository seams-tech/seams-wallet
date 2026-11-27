//! Role-store operations for initial creation and active and epoch loads.

use super::*;

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {
    /// Reserves initial creation with one exact verified evidence wire.
    ///
    /// The generic replay reservation remains below this creation-only boundary;
    /// this method is the only initial-creation entry point and carries evidence
    /// into every executable branch.
    pub(crate) async fn preflight_initial_creation(
        &self,
        command: &VerifiedTenantRootRoleCreationCommandV1,
        now_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootInitialCreationPreflightV1> {
        let scope = command.scope();
        self.require_command_role(scope.key())?;
        let Some(stored) = self.load_command_replay(scope.key()).await? else {
            command
                .require_fresh(now_ms)
                .map_err(|error| store_error(error.message()))?;
            return Ok(CloudflareTenantRootInitialCreationPreflightV1::Fresh);
        };
        match self.reconcile_initial_creation_retry(&stored, *scope.key(), command.digest())? {
            CloudflareTenantRootCommandReplayDecisionV1::InProgress
            | CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { .. }
            | CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { .. } => {
                Ok(CloudflareTenantRootInitialCreationPreflightV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootInitialCreationPreflightV1::ReplayCompleted { receipt_bytes },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootInitialCreationPreflightV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::Execute { .. } => Err(store_error(
                "durable initial creation replay returned a fresh execution",
            )),
        }
    }

    /// Persists one role's initial tenant-root share through its complete
    /// reserve, execution-checkpoint, and successful terminal-receipt path.
    pub(crate) async fn persist_initial_creation(
        &self,
        creation: CloudflareTenantRootInitialCreationInputV1,
        role_signer: &CloudflareTenantRootCreationRoleSignerV1,
        reserved_at_ms: u64,
        executed_at_ms: u64,
        terminal_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootInitialCreationPersistenceOutcomeV1> {
        validate_initial_creation_role_signer(&creation, role_signer)?;
        match self
            .preflight_initial_creation(&creation.command, reserved_at_ms)
            .await?
        {
            CloudflareTenantRootInitialCreationPreflightV1::Fresh => {}
            CloudflareTenantRootInitialCreationPreflightV1::InProgress => {
                return Ok(CloudflareTenantRootInitialCreationPersistenceOutcomeV1::InProgress);
            }
            CloudflareTenantRootInitialCreationPreflightV1::ReplayCompleted { receipt_bytes } => {
                return Ok(
                    CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayCompleted {
                        receipt_bytes,
                    },
                );
            }
            CloudflareTenantRootInitialCreationPreflightV1::ReplayFailed {
                failure_receipt_bytes,
            } => {
                return Ok(
                    CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayFailed {
                        failure_receipt_bytes,
                    },
                );
            }
        }

        let reservation = self
            .reserve_initial_creation_pending(creation, reserved_at_ms)
            .await?;
        let pending = match reservation {
            CloudflareTenantRootInitialCreationDecisionV1::Execute { command } => command,
            CloudflareTenantRootInitialCreationDecisionV1::InProgress
            | CloudflareTenantRootInitialCreationDecisionV1::ResumeExecution { .. }
            | CloudflareTenantRootInitialCreationDecisionV1::ResumeCompletion { .. } => {
                return Ok(CloudflareTenantRootInitialCreationPersistenceOutcomeV1::InProgress);
            }
            CloudflareTenantRootInitialCreationDecisionV1::ReplayCompleted { receipt_bytes } => {
                return Ok(
                    CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayCompleted {
                        receipt_bytes,
                    },
                );
            }
            CloudflareTenantRootInitialCreationDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => {
                return Ok(
                    CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayFailed {
                        failure_receipt_bytes,
                    },
                );
            }
        };
        let (_, executed) = self
            .insert_initial_creation_pending(pending, executed_at_ms)
            .await?;
        let receipt = role_signer
            .sign_verified_success_terminal_receipt(
                executed.executed(),
                executed.evidence_bytes(),
                terminal_at_ms,
            )
            .map_err(|error| store_error(error.message()))?;
        match self.complete_initial_creation(executed, receipt).await? {
            CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes } => Ok(
                CloudflareTenantRootInitialCreationPersistenceOutcomeV1::Committed {
                    receipt_bytes,
                },
            ),
            CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => Ok(
                CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayCompleted {
                    receipt_bytes,
                },
            ),
        }
    }

    pub(crate) async fn reserve_initial_creation_pending(
        &self,
        creation: CloudflareTenantRootInitialCreationInputV1,
        reserved_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootInitialCreationDecisionV1> {
        let CloudflareTenantRootInitialCreationInputV1 {
            command,
            evidence,
            record,
        } = creation;
        validate_initial_creation_binding(&command, &evidence, &record)?;
        let scope = initial_creation_scope_without_freshness(&command, &record)?;
        let creation_admission_digest = command.digest();
        // Freshness applies only before the first durable reservation. An exact
        // retry must still reconcile after the issuer command has expired.
        if self.load_command_replay(scope.key()).await?.is_none() {
            command
                .require_fresh(reserved_at_ms)
                .map_err(|error| store_error(error.message()))?;
        }
        let operation_payload_digest = insert_pending_payload_digest(&record, 1)?;
        match self
            .reserve_insert_pending_with_payload_digest(
                scope,
                record,
                reserved_at_ms,
                operation_payload_digest,
                Some(TenantRootCommandAdmissionV1::InitialCreation(
                    creation_admission_digest,
                )),
            )
            .await?
        {
            CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => {
                Ok(CloudflareTenantRootInitialCreationDecisionV1::Execute {
                    command: CloudflareTenantRootInitialCreationPendingCommandV1 {
                        command,
                        evidence,
                    },
                })
            }
            CloudflareTenantRootInsertPendingDecisionV1::InProgress => {
                Ok(CloudflareTenantRootInitialCreationDecisionV1::InProgress)
            }
            CloudflareTenantRootInsertPendingDecisionV1::ResumeExecution { command } => Ok(
                CloudflareTenantRootInitialCreationDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootInitialCreationPendingCommandV1 {
                        command,
                        evidence,
                    },
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ResumeCompletion { executed } => Ok(
                CloudflareTenantRootInitialCreationDecisionV1::ResumeCompletion {
                    executed: CloudflareTenantRootInitialCreationExecutedCommandV1 {
                        executed,
                        evidence,
                    },
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootInitialCreationDecisionV1::ReplayCompleted { receipt_bytes },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootInitialCreationDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Inserts one creation-only pending row and retains evidence for terminalization.
    pub(crate) async fn insert_initial_creation_pending(
        &self,
        command: CloudflareTenantRootInitialCreationPendingCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<(
        CloudflareStoredTenantRootRoleShareV1,
        CloudflareTenantRootInitialCreationExecutedCommandV1,
    )> {
        let CloudflareTenantRootInitialCreationPendingCommandV1 { command, evidence } = command;
        let (stored, executed) = self
            .insert_pending_with(command, executed_at_ms, INSERT_INITIAL_CREATION_SQL)
            .await?;
        Ok((
            stored,
            CloudflareTenantRootInitialCreationExecutedCommandV1 { executed, evidence },
        ))
    }

    /// Inserts a verified pending epoch exactly once using its reserved command.
    pub(super) async fn insert_pending(
        &self,
        command: CloudflareTenantRootInsertPendingCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        self.insert_pending_with(command, executed_at_ms, INSERT_SQL)
            .await
    }

    pub(super) async fn insert_pending_with(
        &self,
        command: CloudflareTenantRootInsertPendingCommandV1,
        executed_at_ms: u64,
        insert_sql: &'static str,
    ) -> RoleStoreResult<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootInsertPendingCommandV1 {
            scope,
            record,
            reservation,
            expected_revision,
            operation_payload_digest,
        } = command;
        record.validate()?;
        self.cipher.require_role(record.role)?;
        if !matches!(
            record.lifecycle,
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
        ) {
            return Err(store_error(
                "tenant-root role-private insertion requires a pending record",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &record,
            expected_revision,
            "tenant-root pending insertion",
        )?;
        if expected_revision != 1 {
            return Err(store_error(
                "tenant-root pending insertion has an invalid initial revision",
            ));
        }
        let operation = TenantRootCommandOperationV1::insert_pending(operation_payload_digest);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "tenant-root pending insertion",
        )?;
        let metadata = record_metadata(&record)?;
        let ciphertext_json = self.cipher.seal(&record, expected_revision)?;
        let epoch = metadata.epoch.to_string();
        let created_at_ms = record.created_at_ms.to_string();
        let updated_at_ms = record.updated_at_ms.to_string();
        let lifecycle_statement = self.session.prepare(insert_sql).bind_refs(
            [
                RoleSqlValue::Text(metadata.identity_digest_hex.as_str()),
                RoleSqlValue::Text(metadata.custody_lineage_b64u.as_str()),
                RoleSqlValue::Text(epoch.as_str()),
                RoleSqlValue::Text(metadata.role.as_str()),
                RoleSqlValue::Text(metadata.lifecycle.as_str()),
                RoleSqlValue::Text(ciphertext_json.as_str()),
                RoleSqlValue::Text(created_at_ms.as_str()),
                RoleSqlValue::Text(updated_at_ms.as_str()),
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
            CloudflareStoredTenantRootRoleShareV1 {
                record,
                revision: expected_revision,
            },
            executed,
        ))
    }

    /// Executes one reserved managed-restore staging insertion.
    pub(crate) async fn insert_managed_restore_pending(
        &self,
        command: CloudflareTenantRootManagedRestoreStagingPendingCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootManagedRestoreStagingPendingCommandV1 { command } = command;
        let expected_payload_digest = insert_pending_payload_digest(&command.record, 1)?;
        if command.operation_payload_digest != expected_payload_digest {
            return Err(store_error(
                "managed-restore staging command payload does not match its pending record",
            ));
        }
        let capability_digest = match &command.record.lifecycle {
            CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => pending
                .managed_restore_digests()
                .map(|(capability_digest, _)| capability_digest)
                .ok_or_else(|| {
                    store_error("managed-restore staging command lost restore provenance")
                })?,
            _ => {
                return Err(store_error(
                    "managed-restore staging command requires a pending record",
                ));
            }
        };
        validate_managed_restore_staging_record(&command.record, capability_digest)?;
        self.insert_pending(command, executed_at_ms).await
    }

    /// Commits one managed-restore staging receipt without changing lifecycle
    /// state. The pending row remains fenced from every activation path.
    pub(crate) async fn complete_managed_restore_staging(
        &self,
        executed: ExecutedTenantRootCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        self.complete_command(executed, receipt).await
    }

    /// Observes all active rows for the debug lifecycle probe.
    pub(super) async fn observe_active(
        &self,
        identity: &TenantRootIdentityV1,
    ) -> RoleStoreResult<CloudflareTenantRootActiveRoleShareV1> {
        let identity_digest = identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        self.load_active_resolution(identity_digest).await
    }

    pub(super) async fn load_active_resolution(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
    ) -> RoleStoreResult<CloudflareTenantRootActiveRoleShareV1> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let rows = self
            .session
            .prepare(LOAD_ACTIVE_SQL)
            .bind_refs([RoleSqlValue::Text(identity_digest_hex.as_str())].iter())?
            .all()
            .await?
            .results::<TenantRootRoleD1RowV1>()?;
        self.resolve_active_rows(identity_digest, rows).await
    }

    pub(super) async fn resolve_active_rows(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        rows: Vec<TenantRootRoleD1RowV1>,
    ) -> RoleStoreResult<CloudflareTenantRootActiveRoleShareV1> {
        let mut stored = Vec::with_capacity(rows.len());
        for row in rows {
            let opened = self
                .open_row(Some(row))
                .await?
                .ok_or_else(|| store_error("tenant-root role-private active row is missing"))?;
            stored.push(opened);
        }
        let mut observed = Vec::with_capacity(stored.len());
        for entry in &stored {
            observed.push(active_binding_from_stored(entry)?);
        }
        let resolution = resolve_active_tenant_root_role_binding_v1(
            identity_digest,
            self.cipher.role.managed_restore_role(),
            &observed,
        )
        .map_err(|error| store_error(error.message()))?;
        Ok(match resolution {
            TenantRootActiveRoleResolutionV1::Unprovisioned => {
                CloudflareTenantRootActiveRoleShareV1::Unprovisioned
            }
            TenantRootActiveRoleResolutionV1::Active(binding) => {
                let [stored] = stored
                    .try_into()
                    .map_err(|_| store_error("tenant-root active resolution lost its exact row"))?;
                let expected = active_binding_from_stored(&stored)?;
                if expected != binding {
                    return Err(store_error(
                        "tenant-root active resolution changed its stored commitment",
                    ));
                }
                CloudflareTenantRootActiveRoleShareV1::from_stored(stored)?
            }
            TenantRootActiveRoleResolutionV1::Ambiguous(ambiguity) => {
                CloudflareTenantRootActiveRoleShareV1::Ambiguous(ambiguity)
            }
        })
    }

    /// Loads one exact lineage and epoch for reconciliation or lifecycle work.
    pub async fn load_epoch(
        &self,
        identity: &TenantRootIdentityV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> RoleStoreResult<Option<CloudflareStoredTenantRootRoleShareV1>> {
        let identity_digest_hex = identity_digest_hex(identity)?;
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let epoch = epoch_i64(epoch)?.to_string();
        let row = self
            .session
            .prepare(LOAD_EPOCH_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(epoch.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRoleD1RowV1>(None)
            .await?;
        self.open_row(row).await
    }

    pub(crate) async fn load_epoch_by_identity_digest(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> RoleStoreResult<Option<CloudflareStoredTenantRootRoleShareV1>> {
        let row = self
            .load_epoch_row_by_identity_digest(identity_digest, custody_lineage, epoch)
            .await?;
        self.open_row(row).await
    }

    pub(crate) async fn load_initial_pending_for_activation(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RoleStoreResult<CloudflareStoredTenantRootRoleShareV1> {
        let stored = self
            .load_epoch_by_identity_digest(
                identity_digest,
                custody_lineage,
                TenantRootShareEpoch::INITIAL,
            )
            .await?
            .ok_or_else(|| store_error("tenant-root initial pending role share does not exist"))?;
        if !matches!(
            stored.record.lifecycle(),
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
                | CloudflareTenantRootRoleShareLifecycleV1::Active(_)
        ) {
            return Err(store_error(
                "tenant-root initial activation requires a pending or active role share",
            ));
        }
        Ok(stored)
    }

    /// Returns whether one exact activation command already has a
    /// durable replay row. Freshness is enforced only when this is false.
    pub(crate) async fn activation_replay_exists(
        &self,
        scope: &TenantRootCommandScopeV1,
    ) -> RoleStoreResult<bool> {
        self.require_command_role(scope.key())?;
        Ok(self.load_command_replay(scope.key()).await?.is_some())
    }

    /// Reconciles an activation retry after its lifecycle mutation committed.
    pub(crate) async fn reconcile_activation_after_swap(
        &self,
        scope: &TenantRootCommandScopeV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandReplayDecisionV1> {
        self.require_command_role(scope.key())?;
        let stored = self
            .load_command_replay(scope.key())
            .await?
            .ok_or_else(|| {
                store_error("tenant-root active successor has no activation replay record")
            })?;
        self.reconcile_command_retry(&stored, *scope.key(), stored.record.command_digest())
    }

    /// Loads the exact completed refresh artifacts linked from one pending row.
    /// The link is the replay row's primary-key digest, so activation never
    /// scans replay history or accepts a caller-selected refresh record.
    pub(crate) async fn load_refresh_artifact_checkpoint(
        &self,
        pending: &CloudflareStoredTenantRootRoleShareV1,
    ) -> RoleStoreResult<CloudflareTenantRootRefreshArtifactCheckpointV1> {
        validate_pending_stored_record(&self.cipher, pending)?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending_state) =
            pending.record.lifecycle()
        else {
            unreachable!("pending lifecycle was checked by validate_pending_stored_record");
        };
        let replay_key_digest = pending_state.refresh_replay_key_digest().ok_or_else(|| {
            store_error("tenant-root pending refresh row omitted its replay linkage")
        })?;
        let stored = self
            .load_command_replay_by_storage_key_digest(replay_key_digest)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root pending refresh row links to a missing replay row")
            })?;
        if !matches!(stored.record, TenantRootCommandReplayRecordV1::Completed(_)) {
            return Err(store_error(
                "tenant-root refresh artifact checkpoint requires a completed replay",
            ));
        }
        let state = stored.refresh_state.ok_or_else(|| {
            store_error("tenant-root completed refresh replay omitted its durable state")
        })?;
        let CloudflareTenantRootRefreshDurableStateV1::Artifacts {
            command_b64u,
            evidence_b64u,
            prepared_artifacts,
            artifacts,
        } = state
        else {
            return Err(store_error(
                "tenant-root completed refresh replay omitted its artifact checkpoint",
            ));
        };
        let command_bytes =
            decode_refresh_state_bytes("tenant-root refresh checkpoint command", &command_b64u)?;
        let command = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(&command_bytes)
            .map_err(|error| store_error(error.message()))?;
        let identity_digest = pending
            .record
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        if command.identity_digest() != identity_digest
            || command.custody_lineage() != pending.record.custody_lineage
            || command.next_epoch() != pending.record.epoch
            || command.role() != protocol_role_for_cloudflare(self.cipher.role)
        {
            return Err(store_error(
                "tenant-root refresh checkpoint command does not match its pending row",
            ));
        }
        let command_key = TenantRootCommandReplayKeyV1::new(
            command.identity_digest(),
            command.custody_lineage(),
            command.session_id(),
            command.nonce(),
            command.role(),
        );
        if command_key
            .storage_key_digest()
            .map_err(|error| store_error(error.message()))?
            != replay_key_digest
        {
            return Err(store_error(
                "tenant-root refresh checkpoint command does not match its replay link",
            ));
        }
        let evidence_bytes =
            decode_refresh_state_bytes("tenant-root refresh checkpoint evidence", &evidence_b64u)?;
        TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(&evidence_bytes)
            .map_err(|error| store_error(error.message()))?;
        let evidence_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(Sha256::digest(&evidence_bytes).into())
                .map_err(|error| store_error(error.message()))?;
        if evidence_digest != pending_state.installation_evidence_digest() {
            return Err(store_error(
                "tenant-root refresh checkpoint evidence does not match its pending row",
            ));
        }
        Ok(CloudflareTenantRootRefreshArtifactCheckpointV1 {
            command_bytes,
            evidence_bytes,
            prepared_artifacts,
            artifacts,
        })
    }

}
