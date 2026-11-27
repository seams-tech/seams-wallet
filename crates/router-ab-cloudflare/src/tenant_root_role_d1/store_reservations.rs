//! Role-store reservations: activate, swap, forward refresh, cleanup and scoped commands.

use super::*;

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {
    /// Reserves one exact initial-activation command.
    pub(crate) async fn reserve_activate_initial_pending(
        &self,
        scope: TenantRootCommandScopeV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        activation: CloudflareTenantRootActivationV1,
        updated_at_ms: u64,
        reserved_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootActivateInitialPendingDecisionV1> {
        validate_pending_stored_record(&self.cipher, &pending)?;
        if pending.record.epoch != TenantRootShareEpoch::INITIAL {
            return Err(store_error(
                "tenant-root initial activation requires epoch 1",
            ));
        }
        let expected_revision = pending.revision;
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_revision,
            "tenant-root initial activation",
        )?;
        pending
            .record
            .clone()
            .into_active(activation.clone(), updated_at_ms)?;
        let operation =
            TenantRootCommandOperationV1::activate_initial(activate_initial_payload_digest(
                &pending,
                &activation,
                updated_at_ms,
                expected_revision,
            )?);
        match self
            .reserve_scoped_command(scope, operation, reserved_at_ms)
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::Execute {
                    command: CloudflareTenantRootActivateInitialPendingCommandV1 {
                        scope,
                        reservation,
                        pending,
                        activation,
                        updated_at_ms,
                        expected_revision,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootActivateInitialPendingDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootActivateInitialPendingCommandV1 {
                        scope,
                        reservation,
                        pending,
                        activation,
                        updated_at_ms,
                        expected_revision,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::ResumeCompletion { executed },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::ReplayCompleted {
                    receipt_bytes,
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Reserves one exact active-epoch-swap command.
    pub(crate) async fn reserve_swap_active_epoch(
        &self,
        scope: TenantRootCommandScopeV1,
        active: CloudflareStoredTenantRootRoleShareV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        activation: CloudflareTenantRootActivationV1,
        retirement: CloudflareTenantRootRetirementV1,
        updated_at_ms: u64,
        reserved_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootSwapActiveEpochDecisionV1> {
        validate_active_stored_record(&self.cipher, &active)?;
        validate_pending_stored_record(&self.cipher, &pending)?;
        validate_epoch_swap_inputs(&active, &pending)?;
        validate_activation_receipt_against_swap_records(&activation, &active, &pending)?;
        let expected_active_revision = active.revision;
        let expected_pending_revision = pending.revision;
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_pending_revision,
            "tenant-root epoch swap",
        )?;
        active
            .record
            .clone()
            .into_retired(retirement.clone(), updated_at_ms)?;
        pending
            .record
            .clone()
            .into_active(activation.clone(), updated_at_ms)?;
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
        match self
            .reserve_scoped_command(scope, operation, reserved_at_ms)
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => {
                Ok(CloudflareTenantRootSwapActiveEpochDecisionV1::Execute {
                    command: CloudflareTenantRootSwapActiveEpochCommandV1 {
                        scope,
                        reservation,
                        active,
                        pending,
                        activation,
                        retirement,
                        updated_at_ms,
                        expected_active_revision,
                        expected_pending_revision,
                    },
                })
            }
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootSwapActiveEpochDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootSwapActiveEpochDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootSwapActiveEpochCommandV1 {
                        scope,
                        reservation,
                        active,
                        pending,
                        activation,
                        retirement,
                        updated_at_ms,
                        expected_active_revision,
                        expected_pending_revision,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                Ok(CloudflareTenantRootSwapActiveEpochDecisionV1::ResumeCompletion { executed })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootSwapActiveEpochDecisionV1::ReplayCompleted { receipt_bytes },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootSwapActiveEpochDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Reserves the mandatory forward refresh for a managed-restore source.
    ///
    /// The restored row is deliberately kept pending. Execution consumes that
    /// row and activates only the exact next refresh row in one D1 batch.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn reserve_managed_restore_forward_refresh(
        &self,
        scope: TenantRootCommandScopeV1,
        restored_pending: CloudflareStoredTenantRootRoleShareV1,
        refresh_pending: CloudflareStoredTenantRootRoleShareV1,
        activation: CloudflareTenantRootActivationV1,
        capability_digest: TenantRootLifecycleReceiptDigestV1,
        backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        updated_at_ms: u64,
        reserved_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1> {
        validate_managed_restore_forward_refresh_inputs(
            &self.cipher,
            &scope,
            &restored_pending,
            &refresh_pending,
            &activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
        )?;
        let expected_restored_revision = restored_pending.revision;
        let expected_refresh_revision = refresh_pending.revision;
        let operation_payload_digest = managed_restore_forward_refresh_payload_digest(
            &scope,
            &restored_pending,
            &refresh_pending,
            &activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
            expected_restored_revision,
            expected_refresh_revision,
        )?;
        let operation = TenantRootCommandOperationV1::swap_active_epoch(operation_payload_digest);
        match self
            .reserve_scoped_command(scope, operation, reserved_at_ms)
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::Execute {
                    command: CloudflareTenantRootManagedRestoreForwardRefreshCommandV1 {
                        scope,
                        reservation,
                        restored_pending,
                        refresh_pending,
                        activation,
                        capability_digest,
                        backup_receipt_digest,
                        installation_receipt_digest,
                        updated_at_ms,
                        expected_restored_revision,
                        expected_refresh_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootManagedRestoreForwardRefreshCommandV1 {
                        scope,
                        reservation,
                        restored_pending,
                        refresh_pending,
                        activation,
                        capability_digest,
                        backup_receipt_digest,
                        installation_receipt_digest,
                        updated_at_ms,
                        expected_restored_revision,
                        expected_refresh_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ResumeCompletion {
                    executed,
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ReplayCompleted {
                    receipt_bytes,
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Applies the mandatory managed-restore forward refresh atomically.
    ///
    /// The source pending row is deleted only in the same batch that activates
    /// its exact next-epoch refresh row and checkpoints command execution.
    pub(crate) async fn execute_managed_restore_forward_refresh(
        &self,
        command: CloudflareTenantRootManagedRestoreForwardRefreshCommandV1,
        executed_at_ms: u64,
    ) -> RoleStoreResult<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootManagedRestoreForwardRefreshCommandV1 {
            scope,
            reservation,
            restored_pending,
            refresh_pending,
            activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
            expected_restored_revision,
            expected_refresh_revision,
            operation_payload_digest,
        } = command;
        validate_managed_restore_forward_refresh_inputs(
            &self.cipher,
            &scope,
            &restored_pending,
            &refresh_pending,
            &activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
        )?;
        if expected_restored_revision != restored_pending.revision
            || expected_refresh_revision != refresh_pending.revision
        {
            return Err(store_error(
                "managed-restore forward-refresh command revision changed",
            ));
        }
        let expected_payload_digest = managed_restore_forward_refresh_payload_digest(
            &scope,
            &restored_pending,
            &refresh_pending,
            &activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
            expected_restored_revision,
            expected_refresh_revision,
        )?;
        if operation_payload_digest != expected_payload_digest {
            return Err(store_error(
                "managed-restore forward-refresh command payload does not match its inputs",
            ));
        }
        let operation = TenantRootCommandOperationV1::swap_active_epoch(operation_payload_digest);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "managed-restore forward refresh",
        )?;
        let activated_revision = next_revision(expected_refresh_revision)?;
        let activated_record = refresh_pending
            .record
            .clone()
            .into_active(activation, updated_at_ms)?;
        let activated_metadata = record_metadata(&activated_record)?;
        let activated_ciphertext_json = self.cipher.seal(&activated_record, activated_revision)?;
        let restored_metadata = record_metadata(&restored_pending.record)?;
        if restored_metadata.identity_digest_hex != activated_metadata.identity_digest_hex
            || restored_metadata.custody_lineage_b64u != activated_metadata.custody_lineage_b64u
            || restored_metadata.role != activated_metadata.role
        {
            return Err(store_error(
                "managed-restore forward-refresh metadata changed during transition",
            ));
        }
        let restored_epoch = restored_metadata.epoch.to_string();
        let refresh_epoch = activated_metadata.epoch.to_string();
        let restored_revision = expected_restored_revision.to_string();
        let refresh_revision = expected_refresh_revision.to_string();
        let updated_at_ms = timestamp_i64(updated_at_ms)?.to_string();
        let delete_statement = self
            .session
            .prepare(DELETE_MANAGED_RESTORE_FORWARD_REFRESH_PENDING_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(restored_metadata.identity_digest_hex.as_str()),
                    RoleSqlValue::Text(restored_metadata.custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restored_epoch.as_str()),
                    RoleSqlValue::Text(restored_metadata.role.as_str()),
                    RoleSqlValue::Text(restored_revision.as_str()),
                ]
                .iter(),
            )?;
        let activate_statement = self
            .session
            .prepare(ACTIVATE_MANAGED_RESTORE_FORWARD_REFRESH_PENDING_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(activated_ciphertext_json.as_str()),
                    RoleSqlValue::Text(updated_at_ms.as_str()),
                    RoleSqlValue::Text(activated_metadata.identity_digest_hex.as_str()),
                    RoleSqlValue::Text(activated_metadata.custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(refresh_epoch.as_str()),
                    RoleSqlValue::Text(activated_metadata.role.as_str()),
                    RoleSqlValue::Text(refresh_revision.as_str()),
                    RoleSqlValue::Text(restored_epoch.as_str()),
                ]
                .iter(),
            )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let executed = self
            .run_epoch_transition_checkpoint(
                delete_statement,
                activate_statement,
                checkpoint_statement,
                reservation,
                executed_at_ms,
            )
            .await?;
        Ok((
            CloudflareStoredTenantRootRoleShareV1 {
                record: activated_record,
                revision: activated_revision,
            },
            executed,
        ))
    }

    /// Reserves a cleanup that a control-plane authorization permits.
    ///
    /// This is the authorized path. The raw `reserve_cleanup_pending` below
    /// takes a caller-supplied scope and asks no one's permission, so it can
    /// only be reached from inside this store; every external cleanup must
    /// present a signed command naming the exact row.
    ///
    /// The scope is derived from the command's own nonce, not the ceremony's,
    /// so a cleanup is a distinct one-use command from the creation it undoes.
    /// A replayed creation command therefore cannot authorize deleting the
    /// share it created.
    pub(crate) async fn reserve_authorized_cleanup(
        &self,
        authorization: VerifiedTenantRootRoleCleanupCommandV1,
        reserved_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootAuthorizedCleanupDecisionV1> {
        let record_role = authorization.role();
        if record_role.as_str() != self.cipher.role.as_str() {
            return Err(store_error(
                "tenant-root cleanup authorization names another role",
            ));
        }
        let key = TenantRootCommandReplayKeyV1::new(
            authorization.identity_digest(),
            authorization.custody_lineage(),
            // The cleanup's own session coordinate is its nonce, which makes
            // its replay key disjoint from the creation command's.
            router_ab_core::TenantRootCeremonySessionIdV1::from_bytes(
                authorization.nonce().as_bytes()[..16]
                    .try_into()
                    .expect("sixteen nonce bytes"),
            )
            .map_err(|error| store_error(error.message()))?,
            authorization.nonce(),
            record_role,
        );
        let scope = TenantRootCommandScopeV1::new(
            key,
            authorization.epoch(),
            TENANT_ROOT_AUTHORIZED_CLEANUP_CONTROL_PLANE_REVISION_V1,
        )
        .map_err(|error| store_error(error.message()))?;
        let authorization_digest = authorization
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let replay = self.load_command_replay(scope.key()).await?;
        if let Some(stored) = replay.as_ref() {
            match &stored.record {
                TenantRootCommandReplayRecordV1::Executed(_)
                | TenantRootCommandReplayRecordV1::Completed(_)
                | TenantRootCommandReplayRecordV1::Failed(_) => {
                    return match self.reconcile_authorized_cleanup_retry(
                        stored,
                        key,
                        authorization_digest,
                        None,
                    )? {
                        CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion {
                            executed,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                                executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                    executed,
                                    authorization,
                                },
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                                receipt_bytes,
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed { .. } => {
                            Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed)
                        }
                        _ => Err(store_error(
                            "durable tenant-root cleanup replay returned an invalid decision",
                        )),
                    };
                }
                TenantRootCommandReplayRecordV1::Reserved(_) => {}
            }
        } else {
            authorization
                .require_fresh(reserved_at_ms)
                .map_err(|error| store_error(error.message()))?;
        }

        match authorization.target() {
            TenantRootRoleCleanupTargetV1::Pending { .. } => {
                let pending = self
                    .load_epoch_by_identity_digest(
                        authorization.identity_digest(),
                        authorization.custody_lineage(),
                        authorization.epoch(),
                    )
                    .await?
                    .ok_or_else(|| store_error("tenant-root cleanup pending row does not exist"))?;
                validate_authorized_cleanup_pending(&self.cipher, &authorization, &pending)?;
                let operation_payload_digest = authorized_cleanup_pending_payload_digest(
                    &authorization,
                    &pending,
                    pending.revision,
                )?;
                match self
                    .reserve_cleanup_pending_with_payload_digest(
                        scope,
                        pending,
                        reserved_at_ms,
                        operation_payload_digest,
                        Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(
                            authorization_digest,
                        )),
                    )
                    .await?
                {
                    CloudflareTenantRootCleanupPendingDecisionV1::Execute { command } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute {
                            command: CloudflareTenantRootAuthorizedCleanupCommandV1::Pending(
                                CloudflareTenantRootAuthorizedCleanupPendingCommandV1 {
                                    command,
                                    authorization,
                                },
                            ),
                        })
                    }
                    CloudflareTenantRootCleanupPendingDecisionV1::InProgress => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress)
                    }
                    CloudflareTenantRootCleanupPendingDecisionV1::ResumeExecution { command } => {
                        Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeExecution {
                                command: CloudflareTenantRootAuthorizedCleanupCommandV1::Pending(
                                    CloudflareTenantRootAuthorizedCleanupPendingCommandV1 {
                                        command,
                                        authorization,
                                    },
                                ),
                            },
                        )
                    }
                    CloudflareTenantRootCleanupPendingDecisionV1::ResumeCompletion { executed } => {
                        Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                                executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                    executed,
                                    authorization,
                                },
                            },
                        )
                    }
                    CloudflareTenantRootCleanupPendingDecisionV1::ReplayCompleted {
                        receipt_bytes,
                    } => Ok(
                        CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        },
                    ),
                    CloudflareTenantRootCleanupPendingDecisionV1::ReplayFailed { .. } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed)
                    }
                }
            }
            TenantRootRoleCleanupTargetV1::AbandonedCeremony {
                session_id,
                ceremony_nonce,
                ..
            } => {
                // The row may be absent, or may still be written by a command
                // admitted before the window closed; the tombstone written
                // with the cleanup refuses that later write. A row present now
                // must be this ceremony's and must still be pending.
                if let Some(existing) = self
                    .load_epoch_by_identity_digest(
                        authorization.identity_digest(),
                        authorization.custody_lineage(),
                        TenantRootShareEpoch::INITIAL,
                    )
                    .await?
                {
                    if !matches!(
                        existing.record.lifecycle,
                        CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
                    ) {
                        return Err(store_error(
                            "tenant-root abandoned-ceremony cleanup refuses a share that is not pending",
                        ));
                    }
                    // The Router holds one journal per lineage, so the row is
                    // this ceremony's exactly when its creation command's
                    // replay record, keyed by the ceremony, exists.
                    let creation_key = TenantRootCommandReplayKeyV1::new(
                        authorization.identity_digest(),
                        authorization.custody_lineage(),
                        *session_id,
                        *ceremony_nonce,
                        record_role,
                    );
                    if self.load_command_replay(&creation_key).await?.is_none() {
                        return Err(store_error(
                            "tenant-root abandoned-ceremony cleanup names another ceremony's share",
                        ));
                    }
                }
                let operation_payload_digest =
                    authorized_cleanup_abandoned_ceremony_payload_digest(&authorization)?;
                match self
                    .reserve_scoped_command_with_admission_digest(
                        scope,
                        TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest),
                        reserved_at_ms,
                        Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(authorization_digest)),
                    )
                    .await?
                {
                    CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation }
                    | CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::AbandonedCeremony {
                            reservation,
                            authorization,
                        })
                    }
                    CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress)
                    }
                    CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                            executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                executed,
                                authorization,
                            },
                        })
                    }
                    CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        })
                    }
                    CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed { .. } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed)
                    }
                }
            }
            TenantRootRoleCleanupTargetV1::Retired {
                retired_epoch,
                expected_retired_revision,
                expected_active_epoch,
                expected_active_revision,
                ..
            } => {
                let active = self
                    .load_epoch_by_identity_digest(
                        authorization.identity_digest(),
                        authorization.custody_lineage(),
                        *expected_active_epoch,
                    )
                    .await?
                    .ok_or_else(|| {
                        store_error("tenant-root cleanup active successor row does not exist")
                    })?;
                let retired = self
                    .load_epoch_by_identity_digest(
                        authorization.identity_digest(),
                        authorization.custody_lineage(),
                        *retired_epoch,
                    )
                    .await?;
                let Some(retired) = retired else {
                    validate_authorized_cleanup_retired_absent(
                        &self.cipher,
                        &authorization,
                        &active,
                    )?;
                    let operation_payload_digest =
                        authorized_cleanup_retired_absent_payload_digest(&authorization)?;
                    return match self
                        .reserve_scoped_command_with_admission_digest(
                            scope,
                            TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest),
                            reserved_at_ms,
                            Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(
                                authorization_digest,
                            )),
                        )
                        .await?
                    {
                        CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation }
                        | CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution {
                            reservation,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::RetiredAlreadyAbsent {
                                reservation,
                                authorization,
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                            Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress)
                        }
                        CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion {
                            executed,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                                executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                    executed,
                                    authorization,
                                },
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                                receipt_bytes,
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed { .. } => {
                            Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed)
                        }
                    };
                };
                validate_authorized_cleanup_retired(
                    &self.cipher,
                    &authorization,
                    &retired,
                    &active,
                )?;
                let operation_payload_digest = authorized_cleanup_retired_payload_digest(
                    &authorization,
                    &retired,
                    *expected_retired_revision,
                    *expected_active_epoch,
                    *expected_active_revision,
                )?;
                match self
                    .reserve_cleanup_retired_with_payload_digest(
                        scope,
                        retired,
                        *expected_retired_revision,
                        *expected_active_epoch,
                        *expected_active_revision,
                        reserved_at_ms,
                        operation_payload_digest,
                        Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(
                            authorization_digest,
                        )),
                    )
                    .await?
                {
                    CloudflareTenantRootCleanupRetiredDecisionV1::Execute { command } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute {
                            command: CloudflareTenantRootAuthorizedCleanupCommandV1::Retired(
                                CloudflareTenantRootAuthorizedCleanupRetiredCommandV1 {
                                    command,
                                    authorization,
                                },
                            ),
                        })
                    }
                    CloudflareTenantRootCleanupRetiredDecisionV1::InProgress => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress)
                    }
                    CloudflareTenantRootCleanupRetiredDecisionV1::ResumeExecution { command } => {
                        Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeExecution {
                                command: CloudflareTenantRootAuthorizedCleanupCommandV1::Retired(
                                    CloudflareTenantRootAuthorizedCleanupRetiredCommandV1 {
                                        command,
                                        authorization,
                                    },
                                ),
                            },
                        )
                    }
                    CloudflareTenantRootCleanupRetiredDecisionV1::ResumeCompletion { executed } => {
                        Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                                executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                    executed,
                                    authorization,
                                },
                            },
                        )
                    }
                    CloudflareTenantRootCleanupRetiredDecisionV1::ReplayCompleted {
                        receipt_bytes,
                    } => Ok(
                        CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        },
                    ),
                    CloudflareTenantRootCleanupRetiredDecisionV1::ReplayFailed { .. } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed)
                    }
                }
            }
        }
    }

    /// Executes one authorized cleanup and returns its exact terminal receipt bytes.
    pub(crate) async fn persist_authorized_cleanup(
        &self,
        authorization: VerifiedTenantRootRoleCleanupCommandV1,
        role_signer: &CloudflareTenantRootCreationRoleSignerV1,
        reserved_at_ms: u64,
        executed_at_ms: u64,
        terminal_at_ms: u64,
    ) -> RoleStoreResult<Vec<u8>> {
        if role_signer.role() != authorization.role() {
            return Err(store_error(
                "tenant-root cleanup receipt signer does not match the authorized role",
            ));
        }
        let authorization_bytes = authorization
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        let decision = self
            .reserve_authorized_cleanup(authorization, reserved_at_ms)
            .await?;
        let executed = match decision {
            CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute { command }
            | CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeExecution { command } => {
                self.execute_authorized_cleanup(command, executed_at_ms)
                    .await?
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion { executed } => {
                executed
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::RetiredAlreadyAbsent {
                reservation,
                authorization,
            } => {
                let executed = self
                    .checkpoint_command_without_lifecycle(reservation, executed_at_ms)
                    .await?;
                CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                    executed,
                    authorization,
                }
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::AbandonedCeremony {
                reservation,
                authorization,
            } => {
                let executed = self
                    .clean_abandoned_ceremony(reservation, &authorization, executed_at_ms)
                    .await?;
                CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                    executed,
                    authorization,
                }
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted { receipt_bytes } => {
                return Ok(receipt_bytes);
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress => {
                return Err(store_error(
                    "tenant-root authorized cleanup is already in progress",
                ));
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed => {
                return Err(store_error(
                    "tenant-root authorized cleanup previously failed",
                ));
            }
        };
        let receipt = role_signer
            .sign_verified_success_terminal_receipt(
                &executed.executed,
                &authorization_bytes,
                terminal_at_ms,
            )
            .map_err(|error| store_error(error.message()))?;
        match self.complete_authorized_cleanup(executed, receipt).await? {
            CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }
            | CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => {
                Ok(receipt_bytes)
            }
        }
    }

    pub(super) async fn reserve_cleanup_pending_with_payload_digest(
        &self,
        scope: TenantRootCommandScopeV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        reserved_at_ms: u64,
        operation_payload_digest: TenantRootProtocolDigestV1,
        admission: Option<TenantRootCommandAdmissionV1>,
    ) -> RoleStoreResult<CloudflareTenantRootCleanupPendingDecisionV1> {
        validate_pending_stored_record(&self.cipher, &pending)?;
        let expected_revision = pending.revision;
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_revision,
            "tenant-root pending cleanup",
        )?;
        let operation = TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest);
        match self
            .reserve_scoped_command_with_admission_digest(
                scope,
                operation,
                reserved_at_ms,
                admission,
            )
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => {
                Ok(CloudflareTenantRootCleanupPendingDecisionV1::Execute {
                    command: CloudflareTenantRootCleanupPendingCommandV1 {
                        scope,
                        reservation,
                        pending,
                        expected_revision,
                        operation_payload_digest,
                    },
                })
            }
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootCleanupPendingDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootCleanupPendingDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootCleanupPendingCommandV1 {
                        scope,
                        reservation,
                        pending,
                        expected_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                Ok(CloudflareTenantRootCleanupPendingDecisionV1::ResumeCompletion { executed })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                Ok(CloudflareTenantRootCleanupPendingDecisionV1::ReplayCompleted { receipt_bytes })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(CloudflareTenantRootCleanupPendingDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            }),
        }
    }

    pub(super) async fn reserve_cleanup_retired_with_payload_digest(
        &self,
        scope: TenantRootCommandScopeV1,
        retired: CloudflareStoredTenantRootRoleShareV1,
        expected_retired_revision: i64,
        expected_active_epoch: TenantRootShareEpoch,
        expected_active_revision: i64,
        reserved_at_ms: u64,
        operation_payload_digest: TenantRootProtocolDigestV1,
        admission: Option<TenantRootCommandAdmissionV1>,
    ) -> RoleStoreResult<CloudflareTenantRootCleanupRetiredDecisionV1> {
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
        match self
            .reserve_scoped_command_with_admission_digest(
                scope,
                operation,
                reserved_at_ms,
                admission,
            )
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => {
                Ok(CloudflareTenantRootCleanupRetiredDecisionV1::Execute {
                    command: CloudflareTenantRootCleanupRetiredCommandV1 {
                        scope,
                        reservation,
                        retired,
                        expected_retired_revision,
                        expected_active_epoch,
                        expected_active_revision,
                        operation_payload_digest,
                    },
                })
            }
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootCleanupRetiredDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootCleanupRetiredDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootCleanupRetiredCommandV1 {
                        scope,
                        reservation,
                        retired,
                        expected_retired_revision,
                        expected_active_epoch,
                        expected_active_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                Ok(CloudflareTenantRootCleanupRetiredDecisionV1::ResumeCompletion { executed })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                Ok(CloudflareTenantRootCleanupRetiredDecisionV1::ReplayCompleted { receipt_bytes })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(CloudflareTenantRootCleanupRetiredDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            }),
        }
    }

    pub(super) async fn reserve_scoped_command(
        &self,
        scope: TenantRootCommandScopeV1,
        operation: TenantRootCommandOperationV1,
        reserved_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootCommandReplayDecisionV1> {
        self.reserve_scoped_command_with_admission_digest(scope, operation, reserved_at_ms, None)
            .await
    }

    pub(super) async fn reserve_scoped_command_with_admission_digest(
        &self,
        scope: TenantRootCommandScopeV1,
        operation: TenantRootCommandOperationV1,
        reserved_at_ms: u64,
        admission: Option<TenantRootCommandAdmissionV1>,
    ) -> RoleStoreResult<CloudflareTenantRootCommandReplayDecisionV1> {
        // Reservation commits before an executable command leaves this adapter.
        // Atomic reservation-plus-lifecycle mutation needs a D1 transaction path.
        let key = *scope.key();
        self.require_command_role(&key)?;
        let command_digest = scope
            .command_digest(operation)
            .map_err(|error| store_error(error.message()))?;
        let reservation =
            match reserve_tenant_root_command_v1(None, key, command_digest, reserved_at_ms)
                .map_err(|error| store_error(error.message()))?
            {
                TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
                _ => {
                    return Err(store_error(
                        "fresh tenant-root command reservation returned an invalid decision",
                    ));
                }
            };
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
        let admission_digest_hex = admission.map(|value| encode_hex(value.digest().as_bytes()));
        let reserved_at_ms_text = timestamp_i64(reserved_at_ms)?.to_string();
        let admission_digest_value = admission_digest_hex
            .as_deref()
            .map_or(RoleSqlValue::Null, RoleSqlValue::Text);
        let result = self
            .session
            .prepare(INSERT_COMMAND_RESERVATION_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(session_id_hex.as_str()),
                    RoleSqlValue::Text(nonce_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(command_digest_hex.as_str()),
                    admission_digest_value,
                    RoleSqlValue::Text(reserved_at_ms_text.as_str()),
                ]
                .iter(),
            )?
            .run()
            .await?;
        match result_changes(&result)? {
            1 => Ok(CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation }),
            0 => {
                let stored = self
                    .load_command_replay(&key)
                    .await?
                    .ok_or_else(|| {
                        store_error(
                            "tenant-root command reservation conflict disappeared before reconciliation",
                        )
                    })?;
                match admission {
                    Some(TenantRootCommandAdmissionV1::InitialCreation(admission_digest)) => {
                        self.reconcile_initial_creation_retry(&stored, key, admission_digest)
                    }
                    Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(admission_digest)) => self
                        .reconcile_authorized_cleanup_retry(
                            &stored,
                            key,
                            admission_digest,
                            Some(command_digest),
                        ),
                    None => self.reconcile_command_retry(&stored, key, command_digest),
                }
            }
            _ => Err(store_error(
                "tenant-root command reservation returned an invalid change count",
            )),
        }
    }

    /// Commits one exact successful signed public receipt for an executed command.
    pub(super) async fn complete_command(
        &self,
        executed: ExecutedTenantRootCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        self.commit_command_terminal(TenantRootCommandTerminalInputV1 {
            executed,
            receipt,
        })
        .await
    }

    /// Commits the initial-creation receipt whose payload is the exact evidence wire.
    pub(crate) async fn complete_initial_creation(
        &self,
        executed: CloudflareTenantRootInitialCreationExecutedCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        let CloudflareTenantRootInitialCreationExecutedCommandV1 { executed, evidence } = executed;
        validate_initial_creation_success_receipt_payload(&evidence, &receipt)?;
        self.complete_command(executed, receipt).await
    }

    /// Commits an activation receipt whose payload is the exact issuer-signed
    /// activation receipt consumed by the lifecycle transition.
    pub(crate) async fn complete_activation(
        &self,
        executed: ExecutedTenantRootCommandV1,
        activation: &CloudflareTenantRootActivationV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        if receipt.payload_bytes() != activation.activation_receipt_bytes() {
            return Err(store_error(
                "tenant-root activation receipt payload does not match its exact activation receipt",
            ));
        }
        self.complete_command(executed, receipt).await
    }

    /// Commits a forward-refresh receipt bound to the exact activation receipt.
    pub(crate) async fn complete_managed_restore_forward_refresh(
        &self,
        executed: ExecutedTenantRootCommandV1,
        activation: &CloudflareTenantRootActivationV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        if receipt.payload_bytes() != activation.activation_receipt_bytes() {
            return Err(store_error(
                "managed-restore forward-refresh receipt payload does not match its exact activation receipt",
            ));
        }
        self.complete_command(executed, receipt).await
    }

}
