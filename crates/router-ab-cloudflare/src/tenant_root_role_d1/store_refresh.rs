//! Role-store operations for pending inserts, managed-restore staging and refresh admission and persistence.

use super::*;

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {
    /// Reserves one exact pending-row insertion command.
    pub(super) async fn reserve_insert_pending(
        &self,
        scope: TenantRootCommandScopeV1,
        record: CloudflareTenantRootRoleShareRecordV1,
        reserved_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootInsertPendingDecisionV1> {
        let operation_payload_digest = insert_pending_payload_digest(&record, 1)?;
        self.reserve_insert_pending_with_payload_digest(
            scope,
            record,
            reserved_at_ms,
            operation_payload_digest,
            None,
        )
        .await
    }

    pub(super) async fn reserve_insert_pending_with_payload_digest(
        &self,
        scope: TenantRootCommandScopeV1,
        record: CloudflareTenantRootRoleShareRecordV1,
        reserved_at_ms: u64,
        operation_payload_digest: TenantRootProtocolDigestV1,
        admission: Option<TenantRootCommandAdmissionV1>,
    ) -> RoleStoreResult<CloudflareTenantRootInsertPendingDecisionV1> {
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
        let expected_revision = 1;
        validate_command_scope_for_record(
            &scope,
            &record,
            expected_revision,
            "tenant-root pending insertion",
        )?;
        let operation = TenantRootCommandOperationV1::insert_pending(operation_payload_digest);
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
                Ok(CloudflareTenantRootInsertPendingDecisionV1::Execute {
                    command: CloudflareTenantRootInsertPendingCommandV1 {
                        scope,
                        reservation,
                        record,
                        expected_revision,
                        operation_payload_digest,
                    },
                })
            }
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootInsertPendingDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootInsertPendingDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootInsertPendingCommandV1 {
                        scope,
                        reservation,
                        record,
                        expected_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                Ok(CloudflareTenantRootInsertPendingDecisionV1::ResumeCompletion { executed })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                Ok(CloudflareTenantRootInsertPendingDecisionV1::ReplayCompleted { receipt_bytes })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(CloudflareTenantRootInsertPendingDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            }),
        }
    }

    /// Loads the only sealed role artifact allowed as a managed-restore
    /// forward-refresh source. The source row must remain pending and retain
    /// all three receipt digests supplied by the verified restore flow.
    pub(crate) async fn load_managed_restore_forward_refresh_source(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        current_epoch: TenantRootShareEpoch,
        capability_digest: TenantRootLifecycleReceiptDigestV1,
        backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    ) -> RoleStoreResult<CloudflareTenantRootManagedRestoreForwardRefreshSourceV1> {
        let stored = self
            .load_epoch_by_identity_digest(identity_digest, custody_lineage, current_epoch)
            .await?
            .ok_or_else(|| {
                store_error(
                    "tenant-root managed-restore forward-refresh source pending row does not exist",
                )
            })?;
        validate_managed_restore_forward_refresh_source(
            &self.cipher,
            &stored,
            identity_digest,
            custody_lineage,
            current_epoch,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
        )?;
        let sealed_online_role_share = stored
            .record
            .into_online_role_share_artifact_with_installation_evidence_digest(
                installation_receipt_digest,
            )?;
        Ok(CloudflareTenantRootManagedRestoreForwardRefreshSourceV1 {
            sealed_online_role_share,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
        })
    }

    /// Reads the provenance that was authenticated when managed restore was staged.
    ///
    /// The returned digests are copied from the authenticated pending record;
    /// no caller-provided provenance can replace them at the activation boundary.
    pub(crate) fn managed_restore_forward_refresh_provenance(
        &self,
        stored: &CloudflareStoredTenantRootRoleShareV1,
    ) -> RoleStoreResult<CloudflareTenantRootManagedRestoreForwardRefreshProvenanceV1> {
        validate_pending_stored_record(&self.cipher, stored)?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &stored.record.lifecycle
        else {
            unreachable!("pending lifecycle was checked by validate_pending_stored_record");
        };
        let Some((capability_digest, backup_receipt_digest)) = pending.managed_restore_digests()
        else {
            return Err(store_error(
                "tenant-root forward-refresh provenance requires managed-restore material",
            ));
        };
        Ok(
            CloudflareTenantRootManagedRestoreForwardRefreshProvenanceV1 {
                capability_digest,
                backup_receipt_digest,
                installation_receipt_digest: pending.installation_evidence_digest(),
            },
        )
    }

    /// Reserves one role-local managed-restore staging insertion.
    ///
    /// The capability is fresh only for a first-seen replay key. Exact retries
    /// reconcile through the durable command row, including after capability
    /// expiry, while the row itself remains pending for forward refresh.
    pub(crate) async fn reserve_managed_restore_staging(
        &self,
        staging: CloudflareTenantRootManagedRestoreStagingInputV1,
        reserved_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootManagedRestoreStagingDecisionV1> {
        let CloudflareTenantRootManagedRestoreStagingInputV1 {
            capability,
            scope,
            record,
        } = staging;
        let capability_digest = capability.capability_digest();
        validate_managed_restore_staging_record(&record, capability_digest)?;
        validate_command_scope_for_record(
            &scope,
            &record,
            1,
            "tenant-root managed-restore staging",
        )?;
        let replay_exists = self.load_command_replay(scope.key()).await?.is_some();
        if !replay_exists {
            capability
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
                None,
            )
            .await?
        {
            CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::Execute {
                    command: CloudflareTenantRootManagedRestoreStagingPendingCommandV1 { command },
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::InProgress => {
                Ok(CloudflareTenantRootManagedRestoreStagingDecisionV1::InProgress)
            }
            CloudflareTenantRootInsertPendingDecisionV1::ResumeExecution { command } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootManagedRestoreStagingPendingCommandV1 { command },
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ResumeCompletion { executed } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::ResumeCompletion { executed },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::ReplayCompleted {
                    receipt_bytes,
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Durably admits one verified refresh before any randomness or provider
    /// material is produced. The replay row stores the exact issuer command
    /// bytes so a later worker can distinguish regeneration from resumption.
    // The insert-only admission chooses one encrypted seed before either contender publishes.
    pub(super) fn seal_refresh_seed(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
    ) -> RoleStoreResult<String> {
        let mut seed = zeroize::Zeroizing::new([0_u8; 32]);
        rand_core::RngCore::fill_bytes(&mut CloudflareHpkeGetrandomRngV1, seed.as_mut());
        let (encapped, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut CloudflareHpkeGetrandomRngV1,
            &self.cipher.public_key,
            b"seams/tenant-root/refresh-replay-seed/chacha20/v1",
            command.canonical_bytes(),
            seed.as_ref(),
        )
        .map_err(|_| store_error("refresh replay seed encryption failed"))?;
        let mut bytes = encapped.as_ref().to_vec();
        bytes.extend_from_slice(&ciphertext);
        Ok(encode_base64url_bytes_v1(&bytes))
    }

    pub(crate) fn open_refresh_seed(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        state: &CloudflareTenantRootRefreshDurableStateV1,
    ) -> RoleStoreResult<zeroize::Zeroizing<[u8; 32]>> {
        state.validate()?;
        if state.command_bytes()? != command.canonical_bytes() {
            return Err(store_error("refresh replay seed command mismatch"));
        }
        let CloudflareTenantRootRefreshDurableStateV1::Admitted {
            encrypted_seed_b64u,
            ..
        } = state
        else {
            return Err(store_error("refresh replay seed requires admitted state"));
        };
        let bytes = decode_base64url_bytes_v1("refresh replay seed", encrypted_seed_b64u)
            .map_err(|error| store_error(error.message()))?;
        let (encapped, ciphertext) = bytes.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped = CloudflareHpkeKemV1::enc_from_bytes(encapped)
            .map_err(|_| store_error("refresh replay seed encapsulation invalid"))?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped,
                &self.cipher.private_key,
                b"seams/tenant-root/refresh-replay-seed/chacha20/v1",
                command.canonical_bytes(),
                ciphertext,
            )
            .map_err(|_| store_error("refresh replay seed authentication failed"))?,
        );
        let mut seed = zeroize::Zeroizing::new([0_u8; 32]);
        if plaintext.len() != seed.len() {
            return Err(store_error("refresh replay seed length invalid"));
        }
        seed.copy_from_slice(&plaintext);
        Ok(seed)
    }

    pub(crate) async fn admit_refresh(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        now_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootRefreshAdmissionDecisionV1> {
        let scope = command.scope();
        let key = *scope.key();
        self.require_command_role(&key)?;
        let command_digest = command.digest();
        let command_bytes = command.canonical_bytes();
        if let Some(stored) = self.load_command_replay(&key).await? {
            return Self::reconcile_refresh_admission(&stored, key, command_digest, command_bytes);
        }
        command
            .require_fresh(now_ms)
            .map_err(|error| store_error(error.message()))?;
        let operation_digest = refresh_admission_operation_digest(&scope, command_digest)?;
        let state = CloudflareTenantRootRefreshDurableStateV1::admitted(
            command,
            self.seal_refresh_seed(command)?,
        )?;
        let (state_b64u, state_digest_hex) = state.encode()?;
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let role = self.cipher.role.as_str();
        let operation_digest_hex = encode_hex(operation_digest.as_bytes());
        let admission_digest_hex = encode_hex(command_digest.as_bytes());
        let reserved_at_ms_text = timestamp_i64(now_ms)?.to_string();
        let result = self
            .session
            .prepare(INSERT_REFRESH_ADMISSION_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(session_id_hex.as_str()),
                    RoleSqlValue::Text(nonce_hex.as_str()),
                    RoleSqlValue::Text(role),
                    RoleSqlValue::Text(operation_digest_hex.as_str()),
                    RoleSqlValue::Text(admission_digest_hex.as_str()),
                    RoleSqlValue::Text(reserved_at_ms_text.as_str()),
                    RoleSqlValue::Text(state_b64u.as_str()),
                    RoleSqlValue::Text(state_digest_hex.as_str()),
                ]
                .iter(),
            )?
            .run()
            .await?;
        match result_changes(&result)? {
            1 => Ok(CloudflareTenantRootRefreshAdmissionDecisionV1::Execute {
                durable_state: state,
                admission: CloudflareTenantRootRefreshAdmissionV1 {
                    key,
                    command_digest,
                    reserved_at_ms: now_ms,
                },
            }),
            0 => {
                let stored = self.load_command_replay(&key).await?.ok_or_else(|| {
                    store_error(
                        "tenant-root refresh admission conflict disappeared before reconciliation",
                    )
                })?;
                Self::reconcile_refresh_admission(&stored, key, command_digest, command_bytes)
            }
            _ => Err(store_error(
                "tenant-root refresh admission returned an invalid change count",
            )),
        }
    }

    pub(super) fn reconcile_refresh_admission(
        stored: &StoredTenantRootCommandReplayV1,
        key: TenantRootCommandReplayKeyV1,
        command_digest: TenantRootProtocolDigestV1,
        command_bytes: &[u8],
    ) -> RoleStoreResult<CloudflareTenantRootRefreshAdmissionDecisionV1> {
        if stored.record.key() != &key || stored.admission_digest != Some(command_digest) {
            return Err(store_error(
                "tenant-root refresh session was reused with different issuer-authorized bytes",
            ));
        }
        let admission = CloudflareTenantRootRefreshAdmissionV1 {
            key,
            command_digest,
            reserved_at_ms: stored.reserved_at_ms,
        };
        match &stored.record {
            TenantRootCommandReplayRecordV1::Reserved(_) => {
                let durable_state = refresh_replay_state_for_command(stored, command_bytes)?;
                Ok(
                    CloudflareTenantRootRefreshAdmissionDecisionV1::ResumeExecution {
                        admission,
                        durable_state,
                    },
                )
            }
            TenantRootCommandReplayRecordV1::Executed(_) => {
                let durable_state = refresh_replay_state_for_command(stored, command_bytes)?;
                Ok(
                    CloudflareTenantRootRefreshAdmissionDecisionV1::ResumeCompletion {
                        admission,
                        durable_state,
                    },
                )
            }
            TenantRootCommandReplayRecordV1::Completed(_) => {
                let durable_state = refresh_replay_state_for_command(stored, command_bytes)?;
                Ok(
                    CloudflareTenantRootRefreshAdmissionDecisionV1::ReplayCompleted {
                        receipt_bytes: stored.receipt_bytes.clone().ok_or_else(|| {
                            store_error("completed tenant-root refresh omitted prior receipt bytes")
                        })?,
                        durable_state,
                    },
                )
            }
            TenantRootCommandReplayRecordV1::Failed(_) => {
                if stored.refresh_state.is_some() {
                    return Err(store_error(
                        "failed tenant-root refresh replay row has durable refresh state",
                    ));
                }
                Ok(
                    CloudflareTenantRootRefreshAdmissionDecisionV1::ReplayFailed {
                        failure_receipt_bytes: stored.receipt_bytes.clone().ok_or_else(|| {
                            store_error("failed tenant-root refresh omitted prior receipt bytes")
                        })?,
                    },
                )
            }
        }
    }

    /// The older attempts of this refresh's epoch transition that no later
    /// attempt has superseded yet, with the pending row one of them left at the
    /// next epoch; `None` when there is nothing to supersede. The caller must
    /// confirm with the Router that this refresh is its current attempt after
    /// this load and before persisting with it.
    pub(crate) async fn refresh_supersession(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
    ) -> RoleStoreResult<Option<CloudflareTenantRootRefreshSupersessionV1>> {
        let own_key = *command.scope().key();
        self.require_command_role(&own_key)?;
        let own_key_digest = own_key
            .storage_key_digest()
            .map_err(|error| store_error(error.message()))?;
        let mut superseded = Vec::new();
        let mut superseded_keys = Vec::new();
        for row in self
            .list_refresh_replays(LIST_UNSUPERSEDED_REFRESH_REPLAYS_SQL, command)
            .await?
        {
            let replay_key_digest_hex = row.replay_key_digest_hex.clone();
            let status = row.status.clone();
            let refresh_state_digest_hex = row.refresh_state_digest_hex.clone().ok_or_else(|| {
                store_error("tenant-root refresh replay row omitted its durable state digest")
            })?;
            let stored = self.open_command_replay_row(row)?;
            let replay_key_digest = stored
                .record
                .key()
                .storage_key_digest()
                .map_err(|error| store_error(error.message()))?;
            if replay_key_digest == own_key_digest || !same_refresh_transition(&stored, command)? {
                continue;
            }
            superseded_keys.push(replay_key_digest);
            superseded.push(CloudflareTenantRootSupersededRefreshAttemptV1 {
                replay_key_digest_hex,
                status,
                refresh_state_digest_hex,
            });
        }
        let pending_row_revision = match self
            .load_epoch_by_identity_digest(
                command.identity_digest(),
                command.custody_lineage(),
                command.next_epoch(),
            )
            .await?
        {
            None => None,
            Some(stored) => {
                let left_by = match stored.record().lifecycle() {
                    CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
                        pending.refresh_replay_key_digest()
                    }
                    _ => None,
                };
                if !left_by.is_some_and(|digest| superseded_keys.contains(&digest)) {
                    return Err(store_error(
                        "tenant-root refresh next epoch holds a row no older attempt of its transition left",
                    ));
                }
                Some(stored.revision())
            }
        };
        if superseded.is_empty() {
            return Ok(None);
        }
        Ok(Some(CloudflareTenantRootRefreshSupersessionV1 {
            superseded,
            pending_row_revision,
        }))
    }

    /// The digests of the exact managed backups and provider canaries that
    /// superseded attempts of this refresh's epoch transition prepared. Only
    /// these may be replaced at the transition's backup coordinates.
    pub(crate) async fn superseded_refresh_artifact_digests(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
    ) -> RoleStoreResult<(Vec<[u8; 32]>, Vec<[u8; 32]>)> {
        self.require_command_role(command.scope().key())?;
        let mut managed_backups = Vec::new();
        let mut provider_canaries = Vec::new();
        for row in self
            .list_refresh_replays(LIST_SUPERSEDED_REFRESH_REPLAYS_SQL, command)
            .await?
        {
            let stored = self.open_command_replay_row(row)?;
            if !same_refresh_transition(&stored, command)? {
                continue;
            }
            let Some(state) = stored.refresh_state.as_ref() else {
                continue;
            };
            // An attempt superseded before its pending checkpoint prepared nothing.
            let Ok(prepared) = state.prepared_artifacts() else {
                continue;
            };
            managed_backups.push(Sha256::digest(prepared.managed_backup_bytes()?).into());
            provider_canaries
                .push(Sha256::digest(prepared.provider_canary_receipt_bytes()?).into());
        }
        Ok((managed_backups, provider_canaries))
    }

    pub(super) async fn list_refresh_replays(
        &self,
        sql: &str,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
    ) -> RoleStoreResult<Vec<TenantRootCommandReplayD1RowV1>> {
        let identity_digest_hex = encode_hex(command.identity_digest().as_bytes());
        let custody_lineage_b64u = command.custody_lineage().to_base64url();
        self.session
            .prepare(sql)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .all()
            .await?
            .results::<TenantRootCommandReplayD1RowV1>()
    }

    /// Persists the generated sealed role-share record and checkpoints the
    /// replay row in one D1 batch. The replay command digest is replaced with
    /// the exact role-private operation digest only in this atomic step.
    ///
    /// With a supersession, the same batch records each older attempt of the
    /// transition as superseded and removes the pending row one of them left,
    /// so the older attempt can neither keep nor rewrite it.
    pub(crate) async fn persist_refresh_pending(
        &self,
        admission: CloudflareTenantRootRefreshAdmissionV1,
        refresh: CloudflareTenantRootRefreshInputV1,
        prepared_artifacts: CloudflareTenantRootRefreshPreparedArtifactsV1,
        executed_at_ms: u64,
        supersession: Option<&CloudflareTenantRootRefreshSupersessionV1>,
    ) -> RoleStoreResult<(
        CloudflareStoredTenantRootRoleShareV1,
        CloudflareTenantRootRefreshExecutedCommandV1,
    )> {
        let CloudflareTenantRootRefreshInputV1 {
            command,
            evidence,
            record,
        } = refresh;
        prepared_artifacts.validate()?;
        let scope = command.scope();
        if scope.key() != admission.key()
            || command.digest() != admission.command_digest()
            || scope.key().role() != protocol_role_for_cloudflare(self.cipher.role)
        {
            return Err(store_error(
                "tenant-root refresh admission does not match its verified command",
            ));
        }
        if executed_at_ms < admission.reserved_at_ms() {
            return Err(store_error(
                "tenant-root refresh execution checkpoint precedes its admission",
            ));
        }
        require_timestamp("tenant-root refresh execution checkpoint", executed_at_ms)?;
        validate_refresh_command_evidence(&command, &evidence)?;
        validate_refresh_record_binding(&command, &evidence, &record)?;
        validate_refresh_replay_link(&record, admission.key())?;
        validate_command_scope_for_record(
            &scope,
            &record,
            1,
            "tenant-root refresh pending insertion",
        )?;
        record.validate()?;
        self.cipher.require_role(record.role)?;
        let operation_payload_digest = refresh_insert_pending_payload_digest(&command, &record, 1)?;
        let operation_digest = scope
            .command_digest(TenantRootCommandOperationV1::insert_pending(
                operation_payload_digest,
            ))
            .map_err(|error| store_error(error.message()))?;
        let stored_replay = self
            .load_command_replay(admission.key())
            .await?
            .ok_or_else(|| store_error("tenant-root refresh admission row does not exist"))?;
        if stored_replay.admission_digest != Some(admission.command_digest())
            || stored_replay.reserved_at_ms != admission.reserved_at_ms()
        {
            return Err(store_error(
                "tenant-root refresh admission row does not match its token",
            ));
        }
        let old_state = stored_replay.refresh_state.clone().ok_or_else(|| {
            store_error("tenant-root refresh admission row omitted durable state")
        })?;
        if !matches!(
            stored_replay.record,
            TenantRootCommandReplayRecordV1::Reserved(_)
        ) || !matches!(
            old_state,
            CloudflareTenantRootRefreshDurableStateV1::Admitted { .. }
        ) {
            return Err(store_error(
                "tenant-root refresh pending insertion requires a reserved admission",
            ));
        }
        let expected_admission_digest =
            refresh_admission_operation_digest(&scope, admission.command_digest())?;
        if stored_replay.record.command_digest() != expected_admission_digest {
            return Err(store_error(
                "tenant-root refresh admission row has an unexpected operation digest",
            ));
        }
        if old_state.command_bytes()? != command.canonical_bytes() {
            return Err(store_error(
                "tenant-root refresh admission row has different command bytes",
            ));
        }
        let (old_state_b64u, old_state_digest_hex) = old_state.encode()?;
        let next_state = CloudflareTenantRootRefreshDurableStateV1::Executed {
            command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
            evidence_b64u: encode_base64url_bytes_v1(evidence.canonical_bytes()),
            prepared_artifacts,
        };
        let (next_state_b64u, next_state_digest_hex) = next_state.encode()?;
        let metadata = record_metadata(&record)?;
        let ciphertext_json = self.cipher.seal(&record, 1)?;
        let epoch = metadata.epoch.to_string();
        let created_at_ms = record.created_at_ms.to_string();
        let updated_at_ms = record.updated_at_ms.to_string();
        let lifecycle_statement = self.session.prepare(INSERT_SQL).bind_refs(
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
        let replay_key_digest_hex = encode_hex(
            admission
                .key()
                .storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(admission.key().identity_digest().as_bytes());
        let custody_lineage_b64u = admission.key().custody_lineage().to_base64url();
        let session_id_hex = encode_hex(admission.key().session_id().as_bytes());
        let nonce_hex = encode_hex(admission.key().nonce().as_bytes());
        let old_operation_digest_hex = encode_hex(expected_admission_digest.as_bytes());
        let operation_digest_hex = encode_hex(operation_digest.as_bytes());
        let admission_digest_hex = encode_hex(admission.command_digest().as_bytes());
        let reserved_at_ms = timestamp_i64(admission.reserved_at_ms())?.to_string();
        let executed_at_ms_text = timestamp_i64(executed_at_ms)?.to_string();
        let replay_statement = self.session.prepare(MARK_REFRESH_EXECUTED_SQL).bind_refs(
            [
                RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                RoleSqlValue::Text(identity_digest_hex.as_str()),
                RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                RoleSqlValue::Text(session_id_hex.as_str()),
                RoleSqlValue::Text(nonce_hex.as_str()),
                RoleSqlValue::Text(self.cipher.role.as_str()),
                RoleSqlValue::Text(operation_digest_hex.as_str()),
                RoleSqlValue::Text(executed_at_ms_text.as_str()),
                RoleSqlValue::Text(next_state_b64u.as_str()),
                RoleSqlValue::Text(next_state_digest_hex.as_str()),
                RoleSqlValue::Text(old_operation_digest_hex.as_str()),
                RoleSqlValue::Text(admission_digest_hex.as_str()),
                RoleSqlValue::Text(reserved_at_ms.as_str()),
                RoleSqlValue::Text(old_state_b64u.as_str()),
                RoleSqlValue::Text(old_state_digest_hex.as_str()),
            ]
            .iter(),
        )?;
        let mut supersession_statements = Vec::new();
        if let Some(supersession) = supersession {
            for superseded in &supersession.superseded {
                supersession_statements.push((
                    self.session.prepare(INSERT_REFRESH_SUPERSESSION_SQL).bind_refs(
                        [
                            RoleSqlValue::Text(superseded.replay_key_digest_hex.as_str()),
                            RoleSqlValue::Text(identity_digest_hex.as_str()),
                            RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                            RoleSqlValue::Text(self.cipher.role.as_str()),
                            RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                            RoleSqlValue::Text(executed_at_ms_text.as_str()),
                            RoleSqlValue::Text(superseded.status.as_str()),
                            RoleSqlValue::Text(superseded.refresh_state_digest_hex.as_str()),
                        ]
                        .iter(),
                    )?,
                    "tenant-root refresh superseded attempt changed concurrently",
                ));
            }
            if let Some(revision) = supersession.pending_row_revision {
                let revision = revision.to_string();
                supersession_statements.push((
                    self.session.prepare(CLEANUP_PENDING_SQL).bind_refs(
                        [
                            RoleSqlValue::Text(metadata.identity_digest_hex.as_str()),
                            RoleSqlValue::Text(metadata.custody_lineage_b64u.as_str()),
                            RoleSqlValue::Text(epoch.as_str()),
                            RoleSqlValue::Text(metadata.role.as_str()),
                            RoleSqlValue::Text(revision.as_str()),
                        ]
                        .iter(),
                    )?,
                    "tenant-root refresh superseded pending row changed concurrently",
                ));
            }
        }
        self.run_refresh_pending_checkpoint(
            supersession_statements,
            lifecycle_statement,
            replay_statement,
        )
        .await?;
        let reservation = match reserve_tenant_root_command_v1(
            None,
            *admission.key(),
            operation_digest,
            admission.reserved_at_ms(),
        )
        .map_err(|error| store_error(error.message()))?
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => {
                return Err(store_error(
                    "tenant-root refresh operation could not reconstruct its execution token",
                ));
            }
        };
        let executed = reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))?;
        Ok((
            CloudflareStoredTenantRootRoleShareV1 {
                record,
                revision: 1,
            },
            CloudflareTenantRootRefreshExecutedCommandV1 { executed, evidence },
        ))
    }

    /// Reconstructs the exact executed token after a refresh interruption.
    /// Private operation digests and replay fields remain inside this adapter;
    /// the caller supplies only the verified command, durable state, and the
    /// pending row recovered from D1.
    pub(crate) async fn recover_refresh_executed(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        admission: CloudflareTenantRootRefreshAdmissionV1,
        durable_state: &CloudflareTenantRootRefreshDurableStateV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        role_verifying_key: &[u8; 32],
    ) -> RoleStoreResult<CloudflareTenantRootRefreshExecutedCommandV1> {
        let scope = command.scope();
        if scope.key() != admission.key()
            || command.digest() != admission.command_digest()
            || scope.key().role() != protocol_role_for_cloudflare(self.cipher.role)
        {
            return Err(store_error(
                "tenant-root refresh recovery command does not match its admission",
            ));
        }
        if !matches!(
            durable_state,
            CloudflareTenantRootRefreshDurableStateV1::Executed { .. }
                | CloudflareTenantRootRefreshDurableStateV1::Artifacts { .. }
        ) {
            return Err(store_error(
                "tenant-root refresh recovery requires an executed durable state",
            ));
        }
        if durable_state.command_bytes()? != command.canonical_bytes() {
            return Err(store_error(
                "tenant-root refresh recovery command bytes do not match admission",
            ));
        }
        let evidence_bytes = durable_state.evidence_bytes()?;
        let evidence =
            TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
                &evidence_bytes,
                role_verifying_key,
            )
            .map_err(|error| store_error(error.message()))?;
        validate_refresh_command_evidence(command, &evidence)?;
        validate_refresh_record_binding(command, &evidence, pending.record())?;
        let operation_payload_digest =
            refresh_insert_pending_payload_digest(command, pending.record(), 1)?;
        let operation_digest = scope
            .command_digest(TenantRootCommandOperationV1::insert_pending(
                operation_payload_digest,
            ))
            .map_err(|error| store_error(error.message()))?;
        let stored = self
            .load_command_replay(admission.key())
            .await?
            .ok_or_else(|| store_error("tenant-root refresh recovery replay row is missing"))?;
        if stored.admission_digest != Some(admission.command_digest())
            || stored.reserved_at_ms != admission.reserved_at_ms()
            || stored.record.command_digest() != operation_digest
            || stored.refresh_state.as_ref() != Some(durable_state)
            || !matches!(stored.record, TenantRootCommandReplayRecordV1::Executed(_))
        {
            return Err(store_error(
                "tenant-root refresh recovery state does not match D1",
            ));
        }
        let executed_at_ms = stored.executed_at_ms.ok_or_else(|| {
            store_error("tenant-root refresh recovery omitted execution timestamp")
        })?;
        let reservation = match reserve_tenant_root_command_v1(
            None,
            *admission.key(),
            operation_digest,
            admission.reserved_at_ms(),
        )
        .map_err(|error| store_error(error.message()))?
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => {
                return Err(store_error(
                    "tenant-root refresh recovery could not reconstruct its reservation",
                ));
            }
        };
        let executed = reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))?;
        Ok(CloudflareTenantRootRefreshExecutedCommandV1 { executed, evidence })
    }

    /// Commits supersession, the pending row, and the replay checkpoint together.
    /// Every statement must change exactly one row before commit.
    pub(super) async fn run_refresh_pending_checkpoint(
        &self,
        supersession_statements: Vec<(RoleSqlStatement<'_, S>, &'static str)>,
        lifecycle_statement: RoleSqlStatement<'_, S>,
        replay_statement: RoleSqlStatement<'_, S>,
    ) -> RoleStoreResult<()> {
        let mut statements = Vec::new();
        let mut conflicts = Vec::new();
        for (statement, conflict) in supersession_statements.into_iter().chain([
            (
                lifecycle_statement,
                "tenant-root refresh pending row changed concurrently",
            ),
            (
                replay_statement,
                "tenant-root refresh replay checkpoint changed concurrently",
            ),
        ]) {
            statements.push(statement.expect_changes(1));
            conflicts.push(conflict);
        }
        let results = self.session.transaction(statements).await?;
        if results.len() != conflicts.len() {
            return Err(store_error(
                "tenant-root refresh pending checkpoint returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root refresh pending checkpoint statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        for (index, conflict) in conflicts.into_iter().enumerate() {
            require_changes(&results[index], 1, conflict)?;
        }
        Ok(())
    }

    /// Attaches the exact immutable R2 object metadata after both artifacts
    /// have been written. The CAS is fenced by the executed replay state.
    pub(crate) async fn attach_refresh_artifacts(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        executed: &CloudflareTenantRootRefreshExecutedCommandV1,
        artifacts: CloudflareTenantRootRefreshArtifactMetadataV1,
    ) -> RoleStoreResult<()> {
        artifacts.validate()?;
        let scope = command.scope();
        if scope.key() != executed.executed().key()
            || scope.key().role() != protocol_role_for_cloudflare(self.cipher.role)
        {
            return Err(store_error(
                "tenant-root refresh artifact attachment command does not match execution",
            ));
        }
        let stored = self
            .load_command_replay(executed.executed().key())
            .await?
            .ok_or_else(|| store_error("tenant-root refresh execution replay row is missing"))?;
        let stored_state = stored.refresh_state.clone().ok_or_else(|| {
            store_error("tenant-root refresh execution replay row omitted durable state")
        })?;
        let prepared_artifacts = match &stored_state {
            CloudflareTenantRootRefreshDurableStateV1::Executed {
                prepared_artifacts, ..
            } => prepared_artifacts.clone(),
            CloudflareTenantRootRefreshDurableStateV1::Admitted { .. }
            | CloudflareTenantRootRefreshDurableStateV1::Artifacts { .. } => {
                return Err(store_error(
                    "tenant-root refresh artifact attachment requires prepared execution state",
                ));
            }
        };
        let expected_state = CloudflareTenantRootRefreshDurableStateV1::Executed {
            command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
            evidence_b64u: encode_base64url_bytes_v1(executed.evidence_bytes()),
            prepared_artifacts: prepared_artifacts.clone(),
        };
        let next_state = CloudflareTenantRootRefreshDurableStateV1::Artifacts {
            command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
            evidence_b64u: encode_base64url_bytes_v1(executed.evidence_bytes()),
            prepared_artifacts,
            artifacts,
        };
        let (expected_state_b64u, expected_state_digest_hex) = expected_state.encode()?;
        let (next_state_b64u, next_state_digest_hex) = next_state.encode()?;
        if stored.record.command_digest() != executed.executed().command_digest()
            || stored.admission_digest != Some(command.digest())
            || stored.refresh_state != Some(expected_state.clone())
        {
            return Err(store_error(
                "tenant-root refresh execution state does not match artifact attachment",
            ));
        }
        let key = executed.executed().key();
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let command_digest_hex = encode_hex(executed.executed().command_digest().as_bytes());
        let admission_digest_hex = encode_hex(command.digest().as_bytes());
        let reserved_at_ms = timestamp_i64(executed.executed().reserved_at_ms())?.to_string();
        let executed_at_ms = timestamp_i64(executed.executed().executed_at_ms())?.to_string();
        let statement = self
            .session
            .prepare(ATTACH_REFRESH_ARTIFACTS_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(next_state_b64u.as_str()),
                    RoleSqlValue::Text(next_state_digest_hex.as_str()),
                    RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(session_id_hex.as_str()),
                    RoleSqlValue::Text(nonce_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(command_digest_hex.as_str()),
                    RoleSqlValue::Text(admission_digest_hex.as_str()),
                    RoleSqlValue::Text(reserved_at_ms.as_str()),
                    RoleSqlValue::Text(executed_at_ms.as_str()),
                    RoleSqlValue::Text(expected_state_b64u.as_str()),
                    RoleSqlValue::Text(expected_state_digest_hex.as_str()),
                ]
                .iter(),
            )?;
        self.run_refresh_state_update(statement, "artifact attachment")
            .await
    }

    /// Terminalizes a refresh only when D1 already contains the exact R2
    /// object digests, generations, and key-generation references.
    pub(crate) async fn complete_refresh_with_artifacts(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        executed: CloudflareTenantRootRefreshExecutedCommandV1,
        artifacts: &CloudflareTenantRootRefreshArtifactMetadataV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        artifacts.validate()?;
        if command.scope().key() != executed.executed().key()
            || receipt.key() != executed.executed().key()
            || receipt.command_digest() != executed.executed().command_digest()
        {
            return Err(store_error(
                "tenant-root refresh terminal inputs do not match their command",
            ));
        }
        let evidence_bytes = executed.evidence_bytes().to_vec();
        validate_refresh_success_receipt_payload(&executed.evidence, &receipt)?;
        self.commit_refresh_terminal(
            executed,
            receipt,
            command.canonical_bytes().to_vec(),
            evidence_bytes,
            artifacts.clone(),
        )
        .await
    }

    pub(super) async fn commit_refresh_terminal(
        &self,
        executed: CloudflareTenantRootRefreshExecutedCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
        command_bytes: Vec<u8>,
        evidence_bytes: Vec<u8>,
        artifacts: CloudflareTenantRootRefreshArtifactMetadataV1,
    ) -> RoleStoreResult<CloudflareTenantRootCommandTerminalCommitV1> {
        let CloudflareTenantRootRefreshExecutedCommandV1 { executed, .. } = executed;
        let key = *executed.key();
        let command_digest = executed.command_digest();
        let stored_before = self
            .load_command_replay(&key)
            .await?
            .ok_or_else(|| store_error("tenant-root refresh terminal replay row is missing"))?;
        let expected_state = stored_before.refresh_state.clone().ok_or_else(|| {
            store_error("tenant-root refresh terminal replay row omitted durable state")
        })?;
        if !matches!(
            &expected_state,
            CloudflareTenantRootRefreshDurableStateV1::Artifacts { .. }
        ) || expected_state.command_bytes()? != command_bytes
            || expected_state.evidence_bytes()? != evidence_bytes
            || expected_state.artifacts()? != &artifacts
            || stored_before.record.command_digest() != command_digest
            || !matches!(
                stored_before.record,
                TenantRootCommandReplayRecordV1::Executed(_)
            )
        {
            return Err(store_error(
                "tenant-root refresh terminal state is not the attached artifact state",
            ));
        }
        let (state_b64u, state_digest_hex) = expected_state.encode()?;
        let receipt_digest = receipt.digest();
        let terminal_at_ms_value = receipt.terminal_at_ms();
        let receipt_bytes = receipt.into_canonical_bytes();
        let receipt_b64u = encode_base64url_bytes_v1(&receipt_bytes);
        let receipt_digest_hex = encode_hex(receipt_digest.as_bytes());
        let terminal_at_ms = timestamp_i64(terminal_at_ms_value)?.to_string();
        let expected_state = decode_refresh_durable_state(&state_b64u, &state_digest_hex)?;
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
        let admission_digest_hex = encode_hex(
            stored_before
                .admission_digest
                .ok_or_else(|| {
                    store_error("tenant-root refresh terminal admission digest is missing")
                })?
                .as_bytes(),
        );
        let reserved_at_ms = timestamp_i64(executed.reserved_at_ms())?.to_string();
        let executed_at_ms = timestamp_i64(executed.executed_at_ms())?.to_string();
        let statement = self
            .session
            .prepare(COMMIT_REFRESH_TERMINAL_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(receipt_b64u.as_str()),
                    RoleSqlValue::Text(receipt_digest_hex.as_str()),
                    RoleSqlValue::Text(terminal_at_ms.as_str()),
                    RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(session_id_hex.as_str()),
                    RoleSqlValue::Text(nonce_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(command_digest_hex.as_str()),
                    RoleSqlValue::Text(admission_digest_hex.as_str()),
                    RoleSqlValue::Text(reserved_at_ms.as_str()),
                    RoleSqlValue::Text(executed_at_ms.as_str()),
                    RoleSqlValue::Text(state_b64u.as_str()),
                    RoleSqlValue::Text(state_digest_hex.as_str()),
                ]
                .iter(),
            )?;
        let results = self.session.transaction(vec![statement.expect_changes(1)]).await?;
        if results.len() != 1 {
            return Err(store_error(
                "tenant-root refresh terminal commit returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root refresh terminal commit statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        if result_changes(&results[0])? == 1 {
            return Ok(CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes });
        }
        if result_changes(&results[0])? != 0 {
            return Err(store_error(
                "tenant-root refresh terminal commit returned an invalid change count",
            ));
        }
        let stored = self
            .load_command_replay(&key)
            .await?
            .ok_or_else(|| store_error("tenant-root refresh terminal replay row disappeared"))?;
        if !matches!(stored.record, TenantRootCommandReplayRecordV1::Completed(_))
            || stored.refresh_state != Some(expected_state)
            || stored.receipt_bytes.as_deref() != Some(receipt_bytes.as_slice())
        {
            return Err(store_error(
                "tenant-root refresh terminal replay conflicts with durable artifacts",
            ));
        }
        Ok(CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes })
    }

    pub(super) async fn run_refresh_state_update(
        &self,
        statement: RoleSqlStatement<'_, S>,
        operation: &str,
    ) -> RoleStoreResult<()> {
        let results = self.session.transaction(vec![statement.expect_changes(1)]).await?;
        if results.len() != 1 {
            return Err(store_error(format!(
                "tenant-root refresh {operation} returned an invalid result count"
            )));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root refresh {operation} statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        require_changes(
            &results[0],
            1,
            "tenant-root refresh state changed concurrently",
        )
    }

}
