//! Role-store operations for restore import keys, restore refresh and promotion.

use super::*;

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {

    pub(crate) fn seal_restore_import_key_ikm(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        ikm: &[u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES],
    ) -> RoleStoreResult<String> {
        self.cipher.seal_restore_import_ikm(binding, ikm)
    }

    pub(crate) fn open_restore_import_key_ikm(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> RoleStoreResult<zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES]>> {
        self.cipher.open_restore_import_ikm(record)
    }

    pub(crate) fn seal_restore_imported_share(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        envelope_digest: &[u8; 32],
        share_bytes: &[u8],
    ) -> RoleStoreResult<String> {
        self.cipher
            .seal_restore_imported_share(binding, envelope_digest, share_bytes)
    }

    pub(crate) fn validate_restore_imported_share(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> RoleStoreResult<()> {
        self.open_restore_imported_share(record).map(drop)
    }

    pub(crate) fn open_restore_imported_share(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> RoleStoreResult<SigningRootShare> {
        self.cipher.open_restore_imported_share(record)
    }

    pub(super) async fn load_restore_refresh_attempt_by_replay(
        &self,
        replay_key_digest: [u8; 32],
    ) -> RoleStoreResult<Option<CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1>> {
        let replay_key_digest_hex = encode_hex(&replay_key_digest);
        let row = self
            .session
            .prepare(LOAD_RESTORE_REFRESH_ATTEMPT_SQL)
            .bind_refs([RoleSqlValue::Text(replay_key_digest_hex.as_str())].iter())?
            .first::<TenantRootRestoreRefreshRoleAttemptD1RowV1>(None)
            .await?;
        row.map(|row| restore_refresh_role_attempt_record_from_row(row, self.cipher.role))
            .transpose()
    }

    pub(super) async fn load_restore_refresh_attempt_by_command(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    ) -> RoleStoreResult<Option<CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1>> {
        let identity_digest_hex = encode_hex(command.identity_digest().as_bytes());
        let custody_lineage_b64u = command.custody_lineage().to_base64url();
        let restore_session_id_hex = encode_hex(command.restore_session_id().as_bytes());
        let role = match command.role() {
            TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
            TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
        };
        let command_digest_hex = encode_hex(command.digest().as_bytes());
        let row = self
            .session
            .prepare(LOAD_RESTORE_REFRESH_ATTEMPT_BY_COMMAND_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(role.as_str()),
                    RoleSqlValue::Text(command_digest_hex.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRestoreRefreshRoleAttemptD1RowV1>(None)
            .await?;
        row.map(|row| restore_refresh_role_attempt_record_from_row(row, self.cipher.role))
            .transpose()
    }

    pub(super) fn restore_refresh_promotion_source(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreRefreshPromotionSourceV1> {
        if record.lifecycle() != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
        {
            return Err(store_error(
                "tenant-root restore refresh promotion requires a refreshed attempt",
            ));
        }
        let refreshed_at_ms = record.refreshed_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no refresh timestamp")
        })?;
        let evidence_bytes = record.installation_evidence_bytes()?;
        let refreshed_share =
            SigningRootShareWire::from_share(&self.cipher.open_restore_refresh_share(record)?);
        Ok(CloudflareTenantRootRestoreRefreshPromotionSourceV1 {
            refreshed_share,
            evidence_bytes,
            refreshed_at_ms,
        })
    }

    /// Loads the exact finalized staged share and evidence for promotion.
    ///
    /// The share is opened only for the caller's immediate provider-sealing
    /// step. A closed or non-finalized attempt never crosses this boundary.
    pub(crate) async fn load_restore_refresh_promotion_source(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreRefreshPromotionSourceV1> {
        let record = self
            .load_restore_refresh_attempt_by_command(command)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion attempt was not found")
            })?;
        if record.binding().command_digest() != command.digest().as_bytes() {
            return Err(store_error(
                "tenant-root restore refresh promotion command digest does not match its row",
            ));
        }
        validate_restore_refresh_promotion_timestamp(command, &record)?;
        self.restore_refresh_promotion_source(&record)
    }

    pub(super) fn restore_refresh_promotion_artifacts(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1> {
        let (provider_ciphertext, provider_binding_aad, provider_canary_receipt_bytes) =
            self.cipher.open_restore_refresh_promotion_output(record)?;
        let completed_at_ms = record.promotion_completed_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no completion timestamp")
        })?;
        Ok(
            CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1 {
                provider_ciphertext,
                provider_binding_aad,
                provider_canary_receipt_bytes,
                completed_at_ms,
            },
        )
    }

    pub(super) fn promotion_source_or_replay(
        &self,
        record: CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
        execute: bool,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1> {
        match record.promotion_lifecycle() {
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed => Ok(
                CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Replay {
                    artifacts: self.restore_refresh_promotion_artifacts(&record)?,
                },
            ),
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Reserved => {
                let source = self.restore_refresh_promotion_source(&record)?;
                if execute {
                    Ok(
                        CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Execute {
                            source,
                        },
                    )
                } else {
                    Ok(
                        CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Resume {
                            source,
                        },
                    )
                }
            }
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted => Err(store_error(
                "tenant-root restore refresh promotion reservation did not persist",
            )),
        }
    }

    /// Reserves the one role-local restore promotion or returns its exact replay.
    ///
    /// The reservation is kept on the finalized restore-refresh row. A caller
    /// may safely retry after a crash between reservation and provider sealing;
    /// only completion makes provider bytes authoritative for replay.
    pub(crate) async fn reserve_restore_refresh_promotion(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
        now_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1> {
        require_timestamp(
            "tenant-root restore refresh promotion reservation timestamp",
            now_ms,
        )?;
        let record = self
            .load_restore_refresh_attempt_by_command(command)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion attempt was not found")
            })?;
        if record.binding().command_digest() != command.digest().as_bytes() {
            return Err(store_error(
                "tenant-root restore refresh promotion command digest does not match its row",
            ));
        }
        validate_restore_refresh_promotion_timestamp(command, &record)?;
        match record.promotion_lifecycle() {
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed
            | CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Reserved => {
                self.promotion_source_or_replay(record, false)
            }
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted => {
                if record.lifecycle()
                    != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
                {
                    return Err(store_error(
                        "tenant-root restore refresh promotion requires a refreshed attempt",
                    ));
                }
                if now_ms < command.context().issued_at_ms()
                    || now_ms > command.context().expires_at_ms()
                {
                    return Err(store_error(
                        "tenant-root restore refresh promotion command is expired",
                    ));
                }
                let identity_digest_hex = encode_hex(command.identity_digest().as_bytes());
                let custody_lineage_b64u = command.custody_lineage().to_base64url();
                let restore_session_id_hex = encode_hex(command.restore_session_id().as_bytes());
                let role = match command.role() {
                    TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
                    TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
                };
                let command_digest_hex = encode_hex(command.digest().as_bytes());
                let reserved_at_ms = timestamp_i64(now_ms)?.to_string();
                let statement = self
                    .session
                    .prepare(RESERVE_RESTORE_REFRESH_PROMOTION_SQL)
                    .bind_refs(
                        [
                            RoleSqlValue::Text(identity_digest_hex.as_str()),
                            RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                            RoleSqlValue::Text(restore_session_id_hex.as_str()),
                            RoleSqlValue::Text(role.as_str()),
                            RoleSqlValue::Text(command_digest_hex.as_str()),
                            RoleSqlValue::Text(reserved_at_ms.as_str()),
                        ]
                        .iter(),
                    )?;
                let result = statement.run().await?;
                if result_changes(&result)? == 1 {
                    let reserved = self
                        .load_restore_refresh_attempt_by_command(command)
                        .await?
                        .ok_or_else(|| {
                            store_error(
                                "tenant-root restore refresh promotion row disappeared after reservation",
                            )
                        })?;
                    self.promotion_source_or_replay(reserved, true)
                } else {
                    let current = self
                        .load_restore_refresh_attempt_by_command(command)
                        .await?
                        .ok_or_else(|| {
                            store_error(
                                "tenant-root restore refresh promotion reservation conflict disappeared",
                            )
                        })?;
                    self.promotion_source_or_replay(current, false)
                }
            }
        }
    }

    pub(super) fn validate_restore_refresh_promotion_canary(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
        canary_receipt_bytes: &[u8],
        now_ms: u64,
    ) -> RoleStoreResult<()> {
        if canary_receipt_bytes.is_empty()
            || canary_receipt_bytes.len() > TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1
        {
            return Err(store_error(
                "tenant-root restore refresh provider canary length is invalid",
            ));
        }
        let canary =
            TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(canary_receipt_bytes)
                .map_err(|error| store_error(error.message()))?;
        let binding = canary.binding();
        let role = tenant_root_protocol_role_of(record.binding().import_binding().role);
        let refreshed_at_ms = record.refreshed_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no refresh timestamp")
        })?;
        if binding.identity_digest() != command.identity_digest()
            || binding.custody_lineage() != command.custody_lineage()
            || binding.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation
            || binding.target_epoch() != TenantRootShareEpoch::INITIAL
            || binding.commitments().root_commitment() != command.stable_root_commitment()
            || binding.signing_key_id() != command.context().signing_key_id(role)
            || binding.issued_at_ms() != command.issued_at_ms()
            || binding.expires_at_ms() != command.expires_at_ms()
            || binding.completed_at_ms() < refreshed_at_ms
            || binding.completed_at_ms() != now_ms
        {
            return Err(store_error(
                "tenant-root restore refresh provider canary does not match its promotion",
            ));
        }
        Ok(())
    }

    pub(super) fn promotion_replay_matches(
        stored: &CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1,
        sealed: &TenantRootSealedOnlineRoleShareV1,
        canary_receipt_bytes: &[u8],
    ) -> RoleStoreResult<()> {
        let provider_binding_aad = sealed.aad().map_err(|error| store_error(error.message()))?;
        if stored.provider_ciphertext() != sealed.ciphertext()
            || stored.provider_binding_aad() != provider_binding_aad.as_slice()
            || stored.provider_canary_receipt_bytes() != canary_receipt_bytes
        {
            return Err(store_error(
                "tenant-root restore refresh promotion replay conflicts with its durable result",
            ));
        }
        Ok(())
    }

    /// Persists provider ciphertext and canary after one reservation.
    ///
    /// A completed row is authoritative. Any retry must reproduce both opaque
    /// provider bytes and canonical canary bytes exactly.
    pub(crate) async fn complete_restore_refresh_promotion(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
        identity: TenantRootIdentityV1,
        sealed: &TenantRootSealedOnlineRoleShareV1,
        canary_receipt_bytes: &[u8],
        now_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreRefreshPromotionCompletionV1> {
        require_timestamp(
            "tenant-root restore refresh promotion completion timestamp",
            now_ms,
        )?;
        let record = self
            .load_restore_refresh_attempt_by_command(command)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion attempt was not found")
            })?;
        if record.binding().command_digest() != command.digest().as_bytes() {
            return Err(store_error(
                "tenant-root restore refresh promotion command digest does not match its row",
            ));
        }
        if record.promotion_lifecycle()
            == CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed
        {
            let stored = self.restore_refresh_promotion_artifacts(&record)?;
            return Ok(
                CloudflareTenantRootRestoreRefreshPromotionCompletionV1::Replay {
                    artifacts: stored,
                },
            );
        }
        if record.promotion_lifecycle()
            != CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Reserved
        {
            return Err(store_error(
                "tenant-root restore refresh promotion was not reserved",
            ));
        }
        let reserved_at_ms = record.promotion_reserved_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no reservation timestamp")
        })?;
        let refreshed_at_ms = record.refreshed_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no refresh timestamp")
        })?;
        if now_ms < reserved_at_ms || now_ms < refreshed_at_ms {
            return Err(store_error(
                "tenant-root restore refresh promotion completion predates its durable state",
            ));
        }
        if now_ms < command.context().issued_at_ms() || now_ms > command.context().expires_at_ms() {
            return Err(store_error(
                "tenant-root restore refresh promotion command is expired",
            ));
        }
        validate_restore_refresh_promotion_timestamp(command, &record)?;
        self.validate_restore_refresh_promotion_canary(
            command,
            &record,
            canary_receipt_bytes,
            now_ms,
        )?;
        let encrypted_output = self
            .cipher
            .seal_restore_refresh_promotion_output(&record, sealed)?;
        let canary_b64u = encode_base64url_bytes_v1(canary_receipt_bytes);
        let completion_at_ms = timestamp_i64(now_ms)?.to_string();
        let identity_digest_hex = encode_hex(command.identity_digest().as_bytes());
        let custody_lineage_b64u = command.custody_lineage().to_base64url();
        let restore_session_id_hex = encode_hex(command.restore_session_id().as_bytes());
        let role = match command.role() {
            TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
            TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
        };
        let command_digest_hex = encode_hex(command.digest().as_bytes());
        let reserved_at_ms = reserved_at_ms.to_string();
        let statement = self
            .session
            .prepare(COMPLETE_RESTORE_REFRESH_PROMOTION_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(encrypted_output.as_str()),
                    RoleSqlValue::Text(canary_b64u.as_str()),
                    RoleSqlValue::Text(completion_at_ms.as_str()),
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(role.as_str()),
                    RoleSqlValue::Text(command_digest_hex.as_str()),
                    RoleSqlValue::Text(reserved_at_ms.as_str()),
                ]
                .iter(),
            )?;
        let binding = sealed.binding();
        if identity
            .digest()
            .map_err(|error| store_error(error.message()))?
            != command.identity_digest()
            || binding.identity_digest() != command.identity_digest()
            || binding.custody_lineage() != command.custody_lineage()
            || binding.epoch() != TenantRootShareEpoch::INITIAL
            || binding.role() != command.role()
        {
            return Err(store_error(
                "restore promotion pending scope does not match its command",
            ));
        }
        let pending = CloudflareTenantRootRoleShareRecordV1::new(
            CloudflareTenantRootRoleShareRecordInputV1 {
                identity,
                custody_lineage: command.custody_lineage(),
                epoch: TenantRootShareEpoch::INITIAL,
                role,
                sealed_share: CloudflareTenantRootSealedRoleShareV1::new(sealed.ciphertext())?,
                share_commitment: binding.share_commitment().clone(),
                epoch_wrapping_key_ref: binding.epoch_wrapping_key_ref().to_owned(),
                lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(
                    CloudflareTenantRootPendingShareV1::from_stored_digest(
                        binding.installation_evidence_digest(),
                        now_ms,
                    )?,
                ),
                created_at_ms: now_ms,
                updated_at_ms: now_ms,
            },
        )?;
        let ciphertext = self.cipher.seal(&pending, 1)?;
        let insert = self.session.prepare(INSERT_SQL).bind_refs(
            [
                RoleSqlValue::Text(&identity_digest_hex),
                RoleSqlValue::Text(&custody_lineage_b64u),
                RoleSqlValue::Text("1"),
                RoleSqlValue::Text(role.as_str()),
                RoleSqlValue::Text("pending"),
                RoleSqlValue::Text(&ciphertext),
                RoleSqlValue::Text(&completion_at_ms),
                RoleSqlValue::Text(&completion_at_ms),
            ]
            .iter(),
        )?;
        // The promoted provider result and its activation-ready row become durable together.
        let results = self
            .session
            .transaction(vec![statement.into(), insert.into()])
            .await?;
        if results.len() != 2 || results.iter().any(|result| !result.success()) {
            return Err(store_error("restore promotion persistence failed"));
        }
        let durable = self
            .load_initial_pending_for_activation(
                command.identity_digest(),
                command.custody_lineage(),
            )
            .await?;
        if durable.record().share_commitment() != pending.share_commitment()
            || durable.record().epoch_wrapping_key_ref() != pending.epoch_wrapping_key_ref()
        {
            return Err(store_error(
                "restore promotion conflicts with the durable role share",
            ));
        }
        if result_changes(&results[0])? == 1 {
            let stored_record = self
                .load_restore_refresh_attempt_by_command(command)
                .await?
                .ok_or_else(|| {
                    store_error(
                        "tenant-root restore refresh promotion row disappeared after completion",
                    )
                })?;
            let stored = self.restore_refresh_promotion_artifacts(&stored_record)?;
            Self::promotion_replay_matches(&stored, sealed, canary_receipt_bytes)?;
            return Ok(
                CloudflareTenantRootRestoreRefreshPromotionCompletionV1::Committed {
                    artifacts: stored,
                },
            );
        }
        let current = self
            .load_restore_refresh_attempt_by_command(command)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion completion conflict disappeared")
            })?;
        if current.promotion_lifecycle()
            == CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed
        {
            let stored = self.restore_refresh_promotion_artifacts(&current)?;
            return Ok(
                CloudflareTenantRootRestoreRefreshPromotionCompletionV1::Replay {
                    artifacts: stored,
                },
            );
        }
        Err(store_error(
            "tenant-root restore refresh promotion changed concurrently",
        ))
    }

    /// Atomically admits one restore refresh and samples its replay seed.
    /// Existing rows are authoritative, including after command expiry.
    pub(crate) async fn admit_restore_refresh(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        command_digest: [u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
        now_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1> {
        record.validate()?;
        self.cipher.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed {
            return Err(store_error(
                "tenant-root restore refresh requires an accepted import",
            ));
        }
        let replay_key_digest = record.binding.replay_key_digest;
        if let Some(existing) = self
            .load_restore_refresh_attempt_by_replay(replay_key_digest)
            .await?
        {
            if !existing.matches_request(record, &command_digest, issued_at_ms, expires_at_ms) {
                return Err(store_error(
                    "tenant-root restore refresh replay conflicts with its signed binding",
                ));
            }
            if existing.lifecycle()
                == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed
            {
                return Err(store_error("tenant-root restore refresh session is closed"));
            }
            self.validate_restore_imported_share(record)?;
            let replay_seed = self.cipher.open_restore_refresh_seed(&existing)?;
            return match existing.lifecycle() {
                CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Pending => Ok(
                    CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Resume {
                        replay_seed,
                        admitted_at_ms: existing.binding().admitted_at_ms(),
                    },
                ),
                CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed => Ok(
                    CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Refreshed {
                        replay_seed,
                        admitted_at_ms: existing.binding().admitted_at_ms(),
                        evidence_bytes: existing.installation_evidence_bytes()?,
                    },
                ),
                CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed => {
                    unreachable!("closed restore refresh attempt was rejected before seed opening")
                }
            };
        }
        require_timestamp("tenant-root restore refresh current timestamp", now_ms)?;
        if now_ms < issued_at_ms || now_ms >= expires_at_ms {
            return Err(store_error(
                "tenant-root restore refresh command is outside its admission window",
            ));
        }
        self.validate_restore_imported_share(record)?;
        let binding = CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1::new(
            record,
            command_digest,
            issued_at_ms,
            expires_at_ms,
            now_ms,
        )?;
        let mut replay_seed =
            zeroize::Zeroizing::new([0_u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]);
        rand_core::RngCore::fill_bytes(&mut CloudflareHpkeGetrandomRngV1, replay_seed.as_mut());
        require_nonzero_bytes(
            "tenant-root restore refresh replay seed",
            replay_seed.as_ref(),
        )?;
        let encrypted_seed_json = self
            .cipher
            .seal_restore_refresh_seed(&binding, &replay_seed)?;
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let generation = record.binding.generation.to_string();
        let import_key_id = record.binding.import_key_id.as_str();
        let import_replay_key_digest_hex = encode_hex(&record.binding.replay_key_digest);
        let import_command_digest_hex = encode_hex(&record.binding.command_digest);
        let import_operation_digest_hex = encode_hex(&record.binding.operation_digest);
        let recovery_set_id_b64u = record.binding.recovery_set_id.to_base64url();
        let manifest_digest_hex = encode_hex(&record.binding.manifest_digest);
        let stable_root_commitment_b64u =
            encode_base64url_bytes_v1(&record.binding.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&record.binding.share_commitment);
        let destination_fingerprint_hex =
            encode_hex(record.binding.destination_fingerprint.as_bytes());
        let import_public_key_b64u =
            encode_base64url_bytes_v1(record.binding.import_public_key.as_bytes());
        let import_issued_at_ms = timestamp_i64(record.binding.issued_at_ms)?.to_string();
        let import_expires_at_ms = timestamp_i64(record.binding.expires_at_ms)?.to_string();
        let refresh_command_digest_hex = encode_hex(&command_digest);
        let refresh_issued_at_ms = timestamp_i64(issued_at_ms)?.to_string();
        let refresh_expires_at_ms = timestamp_i64(expires_at_ms)?.to_string();
        let admitted_at_ms = timestamp_i64(now_ms)?.to_string();
        let insert = self
            .session
            .prepare(INSERT_RESTORE_REFRESH_ATTEMPT_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(generation.as_str()),
                    RoleSqlValue::Text(import_key_id),
                    RoleSqlValue::Text(import_replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(import_command_digest_hex.as_str()),
                    RoleSqlValue::Text(import_operation_digest_hex.as_str()),
                    RoleSqlValue::Text(recovery_set_id_b64u.as_str()),
                    RoleSqlValue::Text(manifest_digest_hex.as_str()),
                    RoleSqlValue::Text(stable_root_commitment_b64u.as_str()),
                    RoleSqlValue::Text(share_commitment_b64u.as_str()),
                    RoleSqlValue::Text(destination_fingerprint_hex.as_str()),
                    RoleSqlValue::Text(import_public_key_b64u.as_str()),
                    RoleSqlValue::Text(import_issued_at_ms.as_str()),
                    RoleSqlValue::Text(import_expires_at_ms.as_str()),
                    RoleSqlValue::Text(refresh_command_digest_hex.as_str()),
                    RoleSqlValue::Text(refresh_issued_at_ms.as_str()),
                    RoleSqlValue::Text(refresh_expires_at_ms.as_str()),
                    RoleSqlValue::Text(admitted_at_ms.as_str()),
                    RoleSqlValue::Text(encrypted_seed_json.as_str()),
                ]
                .iter(),
            )?;
        let result = insert.run().await?;
        match result_changes(&result)? {
            1 => Ok(
                CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Execute {
                    replay_seed,
                    admitted_at_ms: now_ms,
                },
            ),
            0 => {
                let existing = self
                    .load_restore_refresh_attempt_by_replay(replay_key_digest)
                    .await?
                    .ok_or_else(|| {
                        store_error(
                            "tenant-root restore refresh admission conflict disappeared before reconciliation",
                        )
                    })?;
                if !existing.matches_request(record, &command_digest, issued_at_ms, expires_at_ms) {
                    return Err(store_error(
                        "tenant-root restore refresh admission conflicts after concurrent insert",
                    ));
                }
                if existing.lifecycle()
                    == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed
                {
                    return Err(store_error("tenant-root restore refresh session is closed"));
                }
                self.validate_restore_imported_share(record)?;
                let replay_seed = self.cipher.open_restore_refresh_seed(&existing)?;
                match existing.lifecycle() {
                    CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Pending => Ok(
                        CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Resume {
                            replay_seed,
                            admitted_at_ms: existing.binding().admitted_at_ms(),
                        },
                    ),
                    CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed => Ok(
                        CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Refreshed {
                            replay_seed,
                            admitted_at_ms: existing.binding().admitted_at_ms(),
                            evidence_bytes: existing.installation_evidence_bytes()?,
                        },
                    ),
                    CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed => {
                        unreachable!(
                            "closed restore refresh attempt was rejected before seed opening"
                        )
                    }
                }
            }
            _ => Err(store_error(
                "tenant-root restore refresh admission returned an invalid change count",
            )),
        }
    }

    /// Atomically stages the verified refreshed share and signed evidence.
    /// A late response cannot write after the session tombstone or a prior
    /// finalization has won the exact replay row.
    pub(crate) async fn finalize_restore_refresh(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        command_digest: [u8; 32],
        refreshed_share: &SigningRootShareWire,
        evidence_bytes: &[u8],
        now_ms: u64,
    ) -> RoleStoreResult<Vec<u8>> {
        record.validate()?;
        self.cipher.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed {
            return Err(store_error(
                "tenant-root restore refresh requires an accepted import",
            ));
        }
        require_timestamp("tenant-root restore refresh finalization timestamp", now_ms)?;
        if evidence_bytes.is_empty()
            || evidence_bytes.len()
                > router_ab_core::TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1
        {
            return Err(store_error(
                "tenant-root restore refresh installation evidence is invalid",
            ));
        }
        let signed_evidence =
            TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(evidence_bytes)
                .map_err(|error| store_error(error.message()))?;
        let canonical_evidence = signed_evidence
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        if canonical_evidence.as_slice() != evidence_bytes
            || signed_evidence.role() != tenant_root_protocol_role_of(record.binding.role)
        {
            return Err(store_error(
                "tenant-root restore refresh installation evidence does not match its role",
            ));
        }
        let share = refreshed_share
            .to_share()
            .map_err(|_| store_error("tenant-root restore refreshed share is invalid"))?;
        if share.id() != tenant_root_protocol_role_of(record.binding.role).share_id() {
            return Err(store_error(
                "tenant-root restore refreshed share belongs to the wrong role",
            ));
        }
        let evidence_digest: [u8; 32] = Sha256::digest(evidence_bytes).into();
        let replay_key_digest = record.binding.replay_key_digest;
        let existing = self
            .load_restore_refresh_attempt_by_replay(replay_key_digest)
            .await?
            .ok_or_else(|| store_error("tenant-root restore refresh admission row is missing"))?;
        if !existing.matches_request(
            record,
            &command_digest,
            existing.binding().issued_at_ms(),
            existing.binding().expires_at_ms(),
        ) {
            return Err(store_error(
                "tenant-root restore refresh finalization conflicts with its signed binding",
            ));
        }
        if now_ms < existing.binding().admitted_at_ms() {
            return Err(store_error(
                "tenant-root restore refresh finalization predates admission",
            ));
        }
        if existing.lifecycle() == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed
        {
            return Err(store_error("tenant-root restore refresh session is closed"));
        }
        if existing.lifecycle()
            == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
        {
            let prior_evidence = existing.installation_evidence_bytes()?;
            let prior_share = self.cipher.open_restore_refresh_share(&existing)?;
            if prior_evidence != evidence_bytes
                || SigningRootShareWire::from_share(&prior_share).to_bytes()
                    != refreshed_share.to_bytes()
            {
                return Err(store_error(
                    "tenant-root restore refresh finalization conflicts with its durable result",
                ));
            }
            return Ok(prior_evidence);
        }
        let encrypted_refreshed_share_json = self.cipher.seal_restore_refresh_share(
            existing.binding(),
            &evidence_digest,
            refreshed_share,
        )?;
        let installation_evidence_b64u = encode_base64url_bytes_v1(evidence_bytes);
        let installation_evidence_digest_hex = encode_hex(&evidence_digest);
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let generation = record.binding.generation.to_string();
        let import_key_id = record.binding.import_key_id.as_str();
        let import_replay_key_digest_hex = encode_hex(&record.binding.replay_key_digest);
        let import_command_digest_hex = encode_hex(&record.binding.command_digest);
        let refresh_command_digest_hex = encode_hex(&command_digest);
        let refresh_issued_at_ms = existing.binding().issued_at_ms().to_string();
        let refresh_expires_at_ms = existing.binding().expires_at_ms().to_string();
        let finalization_at_ms = timestamp_i64(now_ms)?.to_string();
        let statement = self
            .session
            .prepare(FINALIZE_RESTORE_REFRESH_ATTEMPT_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(encrypted_refreshed_share_json.as_str()),
                    RoleSqlValue::Text(installation_evidence_b64u.as_str()),
                    RoleSqlValue::Text(installation_evidence_digest_hex.as_str()),
                    RoleSqlValue::Text(finalization_at_ms.as_str()),
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(generation.as_str()),
                    RoleSqlValue::Text(import_key_id),
                    RoleSqlValue::Text(import_replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(import_command_digest_hex.as_str()),
                    RoleSqlValue::Text(refresh_command_digest_hex.as_str()),
                    RoleSqlValue::Text(refresh_issued_at_ms.as_str()),
                    RoleSqlValue::Text(refresh_expires_at_ms.as_str()),
                ]
                .iter(),
            )?;
        let results = self.session.transaction(vec![statement.expect_changes(1)]).await?;
        if results.len() != 1 || results.iter().any(|result| !result.success()) {
            return Err(store_error(
                "tenant-root restore refresh finalization failed",
            ));
        }
        match result_changes(&results[0])? {
            1 => {
                let stored = self
                    .load_restore_refresh_attempt_by_replay(replay_key_digest)
                    .await?
                    .ok_or_else(|| {
                        store_error(
                            "tenant-root restore refresh row disappeared after finalization",
                        )
                    })?;
                let stored_evidence = stored.installation_evidence_bytes()?;
                let stored_share = self.cipher.open_restore_refresh_share(&stored)?;
                if stored_evidence != evidence_bytes
                    || SigningRootShareWire::from_share(&stored_share).to_bytes()
                        != refreshed_share.to_bytes()
                {
                    return Err(store_error(
                        "tenant-root restore refresh row is inconsistent after finalization",
                    ));
                }
                Ok(stored_evidence)
            }
            0 => {
                let stored = self
                    .load_restore_refresh_attempt_by_replay(replay_key_digest)
                    .await?
                    .ok_or_else(|| {
                        store_error(
                            "tenant-root restore refresh finalization conflict disappeared before reconciliation",
                        )
                    })?;
                if stored.lifecycle()
                    == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
                {
                    let stored_evidence = stored.installation_evidence_bytes()?;
                    let stored_share = self.cipher.open_restore_refresh_share(&stored)?;
                    if stored_evidence == evidence_bytes
                        && SigningRootShareWire::from_share(&stored_share).to_bytes()
                            == refreshed_share.to_bytes()
                    {
                        return Ok(stored_evidence);
                    }
                }
                Err(store_error(
                    "tenant-root restore refresh finalization changed concurrently",
                ))
            }
            _ => Err(store_error(
                "tenant-root restore refresh finalization returned an invalid change count",
            )),
        }
    }

    pub(crate) async fn load_restore_import_key_by_replay(
        &self,
        replay_key_digest: [u8; 32],
    ) -> RoleStoreResult<Option<CloudflareTenantRootRestoreImportKeyRecordV1>> {
        let replay_key_digest_hex = encode_hex(&replay_key_digest);
        let row = self
            .session
            .prepare(LOAD_RESTORE_IMPORT_KEY_BY_REPLAY_SQL)
            .bind_refs([RoleSqlValue::Text(replay_key_digest_hex.as_str())].iter())?
            .first::<TenantRootRestoreImportKeyD1RowV1>(None)
            .await?;
        row.map(|row| self.open_restore_import_key_row(row))
            .transpose()
    }

    pub(crate) async fn load_current_restore_import_key(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
    ) -> RoleStoreResult<Option<CloudflareTenantRootRestoreImportKeyRecordV1>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(restore_session_id.as_bytes());
        let row = self
            .session
            .prepare(LOAD_RESTORE_IMPORT_KEY_CURRENT_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRestoreImportKeyD1RowV1>(None)
            .await?;
        row.map(|row| self.open_restore_import_key_row(row))
            .transpose()
    }

    pub(super) async fn load_restore_import_session_tombstone(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
    ) -> RoleStoreResult<Option<CloudflareTenantRootRestoreImportSessionTombstoneV1>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(restore_session_id.as_bytes());
        let row = self
            .session
            .prepare(LOAD_RESTORE_IMPORT_SESSION_TOMBSTONE_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRestoreImportSessionTombstoneD1RowV1>(None)
            .await?;
        row.map(|row| {
            restore_import_session_tombstone_from_row(
                row,
                identity_digest,
                custody_lineage,
                restore_session_id,
                self.cipher.role,
            )
        })
        .transpose()
    }

    pub(crate) async fn restore_import_session_is_closed(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
    ) -> RoleStoreResult<bool> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(restore_session_id.as_bytes());
        let row = self
            .session
            .prepare(LOAD_RESTORE_IMPORT_SESSION_CLOSED_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRestoreImportSessionClosedD1RowV1>(None)
            .await?;
        if let Some(row) = row {
            positive_u64_from_i64(
                "tenant-root restore import session close timestamp",
                row.closed_at_ms,
            )?;
            return Ok(true);
        }
        Ok(false)
    }

    /// Stores one fresh role import key and its encrypted IKM atomically with
    /// predecessor supersession. The replay row is the dedicated key row, so
    /// a retry can return public metadata after the command itself expires.
    pub(crate) async fn persist_restore_import_key_issue(
        &self,
        record: CloudflareTenantRootRestoreImportKeyRecordV1,
        now_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreImportKeyIssueDecisionV1> {
        record.validate()?;
        self.cipher.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued {
            return Err(store_error(
                "tenant-root restore import key issue requires an issued record",
            ));
        }
        if self
            .restore_import_session_is_closed(
                record.binding.identity_digest,
                record.binding.custody_lineage,
                record.binding.restore_session_id,
            )
            .await?
        {
            return Err(store_error("tenant-root restore import session is closed"));
        }
        let replay_key_digest = record.binding.replay_key_digest;
        if let Some(existing) = self
            .load_restore_import_key_by_replay(replay_key_digest)
            .await?
        {
            if !existing.binding.matches_authorized_scope(&record.binding) {
                return Err(store_error(
                    "tenant-root restore import key replay conflicts with its signed binding",
                ));
            }
            if existing.lifecycle == CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed {
                return Err(store_error("tenant-root restore import session is closed"));
            }
            self.validate_restore_import_key_ciphertext(&existing)?;
            return Ok(CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Replay(
                existing,
            ));
        }
        if now_ms < record.binding.issued_at_ms || now_ms >= record.binding.expires_at_ms {
            return Err(store_error(
                "tenant-root restore import key issue command is expired",
            ));
        }
        let current = self
            .load_current_restore_import_key(
                record.binding.identity_digest,
                record.binding.custody_lineage,
                record.binding.restore_session_id,
            )
            .await?;
        if let Some(current) = &current {
            match current.lifecycle {
                CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed => {
                    return Err(store_error(
                        "tenant-root restore import role already has an installed share",
                    ));
                }
                CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued
                | CloudflareTenantRootRestoreImportKeyLifecycleV1::Expired => {}
                CloudflareTenantRootRestoreImportKeyLifecycleV1::Superseded
                | CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed => {
                    return Err(store_error(
                        "tenant-root restore import key has a terminal local lifecycle",
                    ));
                }
            }
            let expected_generation =
                current.binding.generation.checked_add(1).ok_or_else(|| {
                    store_error("tenant-root restore import key generation is exhausted")
                })?;
            if record.binding.generation != expected_generation {
                return Err(store_error(
                    "tenant-root restore import key generation is not monotonic",
                ));
            }
        } else if record.binding.generation != 1 {
            return Err(store_error(
                "first tenant-root restore import key generation must be one",
            ));
        }
        let mut persisted = record;
        persisted.created_at_ms = now_ms;
        persisted.updated_at_ms = now_ms;
        persisted.validate()?;
        let identity_digest_hex = encode_hex(persisted.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = persisted.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(persisted.binding.restore_session_id.as_bytes());
        let generation = persisted.binding.generation.to_string();
        let import_key_id = persisted.binding.import_key_id.as_str();
        let replay_key_digest_hex = encode_hex(&persisted.binding.replay_key_digest);
        let command_digest_hex = encode_hex(&persisted.binding.command_digest);
        let operation_digest_hex = encode_hex(&persisted.binding.operation_digest);
        let recovery_set_id_b64u = persisted.binding.recovery_set_id.to_base64url();
        let manifest_digest_hex = encode_hex(&persisted.binding.manifest_digest);
        let stable_root_commitment_b64u =
            encode_base64url_bytes_v1(&persisted.binding.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&persisted.binding.share_commitment);
        let destination_fingerprint_hex =
            encode_hex(persisted.binding.destination_fingerprint.as_bytes());
        let public_key_b64u =
            encode_base64url_bytes_v1(persisted.binding.import_public_key.as_bytes());
        let encrypted_ikm_json = persisted.encrypted_ikm_json()?;
        let issued_at_ms = timestamp_i64(persisted.binding.issued_at_ms)?.to_string();
        let expires_at_ms = timestamp_i64(persisted.binding.expires_at_ms)?.to_string();
        let now_ms = timestamp_i64(now_ms)?.to_string();
        let insert = self
            .session
            .prepare(INSERT_RESTORE_IMPORT_KEY_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(generation.as_str()),
                    RoleSqlValue::Text(import_key_id),
                    RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(command_digest_hex.as_str()),
                    RoleSqlValue::Text(operation_digest_hex.as_str()),
                    RoleSqlValue::Text(recovery_set_id_b64u.as_str()),
                    RoleSqlValue::Text(manifest_digest_hex.as_str()),
                    RoleSqlValue::Text(stable_root_commitment_b64u.as_str()),
                    RoleSqlValue::Text(share_commitment_b64u.as_str()),
                    RoleSqlValue::Text(destination_fingerprint_hex.as_str()),
                    RoleSqlValue::Text(public_key_b64u.as_str()),
                    RoleSqlValue::Text(encrypted_ikm_json),
                    RoleSqlValue::Text(issued_at_ms.as_str()),
                    RoleSqlValue::Text(expires_at_ms.as_str()),
                ]
                .iter(),
            )?;
        let results = if let Some(current) = current {
            let predecessor_generation = current.binding.generation.to_string();
            let supersede = self
                .session
                .prepare(SUPERSEDE_RESTORE_IMPORT_KEY_SQL)
                .bind_refs(
                    [
                        RoleSqlValue::Text(identity_digest_hex.as_str()),
                        RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                        RoleSqlValue::Text(restore_session_id_hex.as_str()),
                        RoleSqlValue::Text(self.cipher.role.as_str()),
                        RoleSqlValue::Text(predecessor_generation.as_str()),
                        RoleSqlValue::Text(now_ms.as_str()),
                    ]
                    .iter(),
                )?;
            self.session
                .transaction(vec![supersede.expect_changes(1), insert.expect_changes(1)])
                .await?
        } else {
            self.session.transaction(vec![insert.expect_changes(1)]).await?
        };
        if results.iter().all(|result| result.success()) {
            let stored = self
                .load_restore_import_key_by_replay(replay_key_digest)
                .await?
                .ok_or_else(|| {
                    store_error("tenant-root restore import key row disappeared after issue")
                })?;
            if !stored.binding.matches_authorized_scope(&persisted.binding) {
                return Err(store_error(
                    "tenant-root restore import key row conflicts with its command",
                ));
            }
            return Ok(CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Issued(
                stored,
            ));
        }
        if let Some(existing) = self
            .load_restore_import_key_by_replay(replay_key_digest)
            .await?
        {
            if !existing
                .binding
                .matches_authorized_scope(&persisted.binding)
            {
                return Err(store_error(
                    "tenant-root restore import key replay conflicts after concurrent issue",
                ));
            }
            return Ok(CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Replay(
                existing,
            ));
        }
        Err(store_error(
            "tenant-root restore import key issue changed concurrently",
        ))
    }

    /// Atomically stages one decrypted recovery share and marks the issued key
    /// installed. The tombstone predicate makes session close and acceptance
    /// serialize on the same primary D1 session.
    pub(crate) async fn persist_restore_import_key_accept(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        envelope_digest: [u8; 32],
        encrypted_imported_share_json: String,
        receipt_digest: [u8; 32],
        accepted_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreImportKeyAcceptDecisionV1> {
        record.validate()?;
        self.cipher.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued {
            return Err(store_error(
                "tenant-root restore import acceptance requires an issued key",
            ));
        }
        require_nonzero_bytes(
            "tenant-root restore imported share envelope digest",
            &envelope_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore imported share receipt digest",
            &receipt_digest,
        )?;
        require_timestamp(
            "tenant-root restore imported share acceptance timestamp",
            accepted_at_ms,
        )?;
        if accepted_at_ms < record.binding.issued_at_ms
            || accepted_at_ms >= record.binding.expires_at_ms
        {
            return Err(store_error(
                "tenant-root restore import key is outside its acceptance window",
            ));
        }
        if encrypted_imported_share_json.is_empty()
            || encrypted_imported_share_json.len() > 8 * 1024
        {
            return Err(store_error(
                "tenant-root restore imported share ciphertext JSON is invalid",
            ));
        }
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let generation = record.binding.generation.to_string();
        let import_key_id = record.binding.import_key_id.as_str();
        let replay_key_digest_hex = encode_hex(&record.binding.replay_key_digest);
        let command_digest_hex = encode_hex(&record.binding.command_digest);
        let operation_digest_hex = encode_hex(&record.binding.operation_digest);
        let envelope_digest_hex = encode_hex(&envelope_digest);
        let receipt_digest_hex = encode_hex(&receipt_digest);
        let accepted_at_ms = timestamp_i64(accepted_at_ms)?.to_string();
        let statement = self
            .session
            .prepare(ACCEPT_RESTORE_IMPORT_KEY_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(envelope_digest_hex.as_str()),
                    RoleSqlValue::Text(encrypted_imported_share_json.as_str()),
                    RoleSqlValue::Text(accepted_at_ms.as_str()),
                    RoleSqlValue::Text(receipt_digest_hex.as_str()),
                    RoleSqlValue::Text(accepted_at_ms.as_str()),
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(record.binding.role.as_str()),
                    RoleSqlValue::Text(generation.as_str()),
                    RoleSqlValue::Text(import_key_id),
                    RoleSqlValue::Text(replay_key_digest_hex.as_str()),
                    RoleSqlValue::Text(command_digest_hex.as_str()),
                    RoleSqlValue::Text(operation_digest_hex.as_str()),
                ]
                .iter(),
            )?;
        let results = self.session.transaction(vec![statement.expect_changes(1)]).await?;
        if results.len() != 1 || results.iter().any(|result| !result.success()) {
            return Err(store_error(
                "tenant-root restore imported share acceptance failed",
            ));
        }
        let changes = result_changes(&results[0])?;
        if changes == 1 {
            let stored = self
                .load_restore_import_key_by_replay(record.binding.replay_key_digest)
                .await?
                .ok_or_else(|| {
                    store_error(
                        "tenant-root restore imported share row disappeared after acceptance",
                    )
                })?;
            if stored.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed
                || stored.envelope_digest != Some(envelope_digest)
                || stored.receipt_digest != Some(receipt_digest)
            {
                return Err(store_error(
                    "tenant-root restore imported share acceptance row is inconsistent",
                ));
            }
            self.validate_restore_imported_share(&stored)?;
            return Ok(CloudflareTenantRootRestoreImportKeyAcceptDecisionV1::Accepted(stored));
        }
        if changes != 0 {
            return Err(store_error(
                "tenant-root restore imported share acceptance returned an invalid change count",
            ));
        }
        let stored = self
            .load_restore_import_key_by_replay(record.binding.replay_key_digest)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore imported share row disappeared after concurrent acceptance")
            })?;
        if !stored.binding.matches_authorized_scope(&record.binding) {
            return Err(store_error(
                "tenant-root restore imported share acceptance conflicts with its signed binding",
            ));
        }
        if stored.lifecycle == CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed
            && stored.envelope_digest == Some(envelope_digest)
            && stored.receipt_digest == Some(receipt_digest)
        {
            self.validate_restore_imported_share(&stored)?;
            return Ok(CloudflareTenantRootRestoreImportKeyAcceptDecisionV1::Replay(stored));
        }
        Err(store_error(
            "tenant-root restore imported share acceptance conflicts with its durable state",
        ))
    }

    pub(crate) async fn close_restore_before_activation(
        &self,
        grant: &router_ab_core::VerifiedTenantRootRestoreCleanupGrantV1,
        closed_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreSessionCleanupReceiptV1> {
        let identity = grant.destination_identity_digest();
        let lineage = grant.destination_lineage();
        let session = grant.restore_session_id();
        let identity_hex = encode_hex(identity.as_bytes());
        let lineage_b64u = lineage.to_base64url();
        let session_hex = encode_hex(session.as_bytes());
        let grant_b64u = encode_base64url_bytes_v1(grant.canonical_bytes());
        let grant_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(*grant.digest().as_bytes())
                .map_err(|error| store_error(error.message()))?;
        let receipt = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            identity,
            lineage,
            session,
            self.cipher.role,
            grant.operation(),
            grant_digest,
            closed_at_ms,
        )?;
        let receipt_b64u = encode_base64url_bytes_v1(receipt.bytes());
        let receipt_digest_hex = encode_hex(receipt.digest().as_bytes());
        let closed_text = timestamp_i64(closed_at_ms)?.to_string();
        let fingerprint_hex = encode_hex(grant.destination_fingerprint().as_bytes());
        // Admission races promotion in the same D1 database. Once promotion starts,
        // only activation-receipt cleanup may close the session.
        self.session.prepare("INSERT INTO tenant_root_restore_import_sessions \
            (tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, \
             closed_at_ms, role, cleanup_grant_b64u, cleanup_receipt_b64u, cleanup_receipt_digest_hex) \
            SELECT $1, $2, $3, $4, $5, $6, $7, $8 \
            WHERE NOT EXISTS (SELECT 1 FROM tenant_root_restore_refresh_attempts \
              WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
                AND restore_session_id_hex = $3 AND promotion_lifecycle <> 'unstarted') \
            AND NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_keys \
              WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
                AND restore_session_id_hex = $3 AND destination_fingerprint_hex <> $9) \
            ON CONFLICT DO NOTHING")
            .bind_refs([
                RoleSqlValue::Text(&identity_hex), RoleSqlValue::Text(&lineage_b64u), RoleSqlValue::Text(&session_hex),
                RoleSqlValue::Text(&closed_text), RoleSqlValue::Text(self.cipher.role.as_str()),
                RoleSqlValue::Text(&grant_b64u), RoleSqlValue::Text(&receipt_b64u),
                RoleSqlValue::Text(&receipt_digest_hex), RoleSqlValue::Text(&fingerprint_hex),
            ].iter())?.run().await?;
        #[derive(Deserialize)]
        struct Closure {
            cleanup_grant_b64u: String,
            closed_at_ms: i64,
        }
        let closure = self
            .session
            .prepare(
                "SELECT cleanup_grant_b64u, closed_at_ms \
            FROM tenant_root_restore_import_sessions WHERE tenant_identity_digest_hex = $1 \
            AND custody_lineage_b64u = $2 AND restore_session_id_hex = $3 \
            AND cleanup_grant_b64u IS NOT NULL",
            )
            .bind_refs(
                [
                    RoleSqlValue::Text(&identity_hex),
                    RoleSqlValue::Text(&lineage_b64u),
                    RoleSqlValue::Text(&session_hex),
                ]
                .iter(),
            )?
            .first::<Closure>(None)
            .await?
            .ok_or_else(|| {
                store_error("preactivation cleanup conflicts with promotion or destination scope")
            })?;
        let stored_bytes =
            decode_base64url_bytes_v1("restore cleanup grant", &closure.cleanup_grant_b64u)
                .map_err(|error| store_error(error.message()))?;
        let stored =
            router_ab_core::TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&stored_bytes)
                .map_err(|error| store_error(error.message()))?;
        if stored.destination_identity_digest() != identity
            || stored.destination_lineage() != lineage
            || stored.restore_session_id() != session
            || stored.destination_fingerprint() != grant.destination_fingerprint()
        {
            return Err(store_error(
                "preactivation cleanup replay changed destination scope",
            ));
        }
        let closed_at_ms = u64::try_from(closure.closed_at_ms)
            .map_err(|_| store_error("invalid cleanup closure timestamp"))?;
        self.close_restore_import_session_secrets(identity, lineage, session, closed_at_ms)
            .await?;
        let stored_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(Sha256::digest(&stored_bytes).into())
                .map_err(|error| store_error(error.message()))?;
        CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            identity,
            lineage,
            session,
            self.cipher.role,
            stored.operation(),
            stored_digest,
            closed_at_ms,
        )
    }

    /// Records a closed restore session before deleting its encrypted keys.
    /// The tombstone remains after the key rows lose their ciphertext.
    pub(crate) async fn close_restore_import_session(
        &self,
        activation: &VerifiedTenantRootSignedActivationReceiptV1,
        role: TwoPartyDeriverRole,
        closed_at_ms: u64,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreSessionCleanupReceiptV1> {
        let expected_role = match role {
            TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
            TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
        };
        if expected_role != self.cipher.role {
            return Err(store_error(
                "tenant-root restore-session cleanup belongs to the other Deriver",
            ));
        }
        let candidate = CloudflareTenantRootRestoreImportSessionTombstoneV1::from_activation(
            activation,
            expected_role,
            closed_at_ms,
        )?;
        if closed_at_ms < activation.activated_at_ms() {
            return Err(store_error(
                "tenant-root restore-session cleanup predates activation",
            ));
        }
        let active = self
            .load_epoch_by_identity_digest(
                candidate.identity_digest,
                candidate.custody_lineage,
                TenantRootShareEpoch::INITIAL,
            )
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore-session cleanup requires durable activation")
            })?;
        if active.record().role() != expected_role
            || !matches!(
                active.record().lifecycle(),
                CloudflareTenantRootRoleShareLifecycleV1::Active(_)
                    | CloudflareTenantRootRoleShareLifecycleV1::Retired(_)
            )
            || active.retained_activation_receipt_bytes()? != candidate.activation_receipt_bytes
        {
            return Err(store_error(
                "tenant-root restore-session cleanup activation does not match the active role share",
            ));
        }
        if let Some(existing) = self
            .load_restore_import_session_tombstone(
                candidate.identity_digest,
                candidate.custody_lineage,
                candidate.restore_session_id,
            )
            .await?
        {
            if !existing.matches(&candidate) {
                return Err(store_error(
                    "tenant-root restore-session cleanup conflicts with its tombstone",
                ));
            }
            self.close_restore_import_session_secrets(
                candidate.identity_digest,
                candidate.custody_lineage,
                candidate.restore_session_id,
                existing.closed_at_ms,
            )
            .await?;
            return Ok(existing.cleanup_receipt().clone());
        }
        let identity_digest_hex = encode_hex(candidate.identity_digest.as_bytes());
        let custody_lineage_b64u = candidate.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(candidate.restore_session_id.as_bytes());
        let closed_at_ms_text = timestamp_i64(candidate.closed_at_ms)?.to_string();
        let activation_receipt_b64u =
            encode_base64url_bytes_v1(&candidate.activation_receipt_bytes);
        let activation_receipt_digest_hex =
            encode_hex(candidate.activation_receipt_digest.as_bytes());
        let cleanup_receipt_b64u = encode_base64url_bytes_v1(candidate.cleanup_receipt.bytes());
        let cleanup_receipt_digest_hex = encode_hex(candidate.cleanup_receipt.digest().as_bytes());
        let insert = self
            .session
            .prepare(INSERT_RESTORE_IMPORT_SESSION_TOMBSTONE_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(closed_at_ms_text.as_str()),
                    RoleSqlValue::Text(expected_role.as_str()),
                    RoleSqlValue::Text(candidate.activation_operation.as_str()),
                    RoleSqlValue::Text(activation_receipt_b64u.as_str()),
                    RoleSqlValue::Text(activation_receipt_digest_hex.as_str()),
                    RoleSqlValue::Text(cleanup_receipt_b64u.as_str()),
                    RoleSqlValue::Text(cleanup_receipt_digest_hex.as_str()),
                ]
                .iter(),
            )?;
        let insert_result = insert.run().await?;
        let inserted = result_changes(&insert_result)?;
        if inserted > 1 {
            return Err(store_error(
                "tenant-root restore-session tombstone inserted an invalid change count",
            ));
        }
        if inserted == 0 {
            let existing = self
                .load_restore_import_session_tombstone(
                    candidate.identity_digest,
                    candidate.custody_lineage,
                    candidate.restore_session_id,
                )
                .await?
                .ok_or_else(|| {
                    store_error("tenant-root restore-session tombstone disappeared after insert")
                })?;
            if !existing.matches(&candidate) {
                return Err(store_error(
                    "tenant-root restore-session cleanup conflicts with its tombstone",
                ));
            }
            self.close_restore_import_session_secrets(
                candidate.identity_digest,
                candidate.custody_lineage,
                candidate.restore_session_id,
                existing.closed_at_ms,
            )
            .await?;
            return Ok(existing.cleanup_receipt().clone());
        }
        self.close_restore_import_session_secrets(
            candidate.identity_digest,
            candidate.custody_lineage,
            candidate.restore_session_id,
            candidate.closed_at_ms,
        )
        .await?;
        Ok(candidate.cleanup_receipt().clone())
    }

    pub(super) async fn close_restore_import_session_secrets(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        closed_at_ms: u64,
    ) -> RoleStoreResult<()> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(restore_session_id.as_bytes());
        let role = self.cipher.role.as_str();
        let closed_at_ms = timestamp_i64(closed_at_ms)?.to_string();
        let close = self
            .session
            .prepare(CLOSE_RESTORE_IMPORT_KEYS_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(closed_at_ms.as_str()),
                    RoleSqlValue::Text(role),
                ]
                .iter(),
            )?;
        let close_refresh_attempts = self
            .session
            .prepare(CLOSE_RESTORE_REFRESH_ATTEMPTS_SQL)
            .bind_refs(
                [
                    RoleSqlValue::Text(identity_digest_hex.as_str()),
                    RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                    RoleSqlValue::Text(restore_session_id_hex.as_str()),
                    RoleSqlValue::Text(closed_at_ms.as_str()),
                    RoleSqlValue::Text(role),
                ]
                .iter(),
            )?;
        let results = self
            .session
            .transaction(vec![close.into(), close_refresh_attempts.into()])
            .await?;
        if results.len() != 2 || results.iter().any(|result| !result.success()) {
            return Err(store_error(
                "tenant-root restore import session close failed",
            ));
        }
        Ok(())
    }

    pub(super) fn open_restore_import_key_row(
        &self,
        row: TenantRootRestoreImportKeyD1RowV1,
    ) -> RoleStoreResult<CloudflareTenantRootRestoreImportKeyRecordV1> {
        restore_import_key_record_from_row(row, self.cipher.role)
    }

    pub(super) fn validate_restore_import_key_ciphertext(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> RoleStoreResult<()> {
        let envelope: TenantRootRestoreImportKeyCiphertextV1 =
            serde_json::from_str(record.encrypted_ikm_json()?).map_err(|error| {
                store_error(format!(
                    "tenant-root restore import key ciphertext decoding failed: {error}"
                ))
            })?;
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let public_key_b64u =
            encode_base64url_bytes_v1(record.binding.import_public_key.as_bytes());
        if envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.key_version != self.cipher.key_version
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.role != record.binding.role
            || envelope.generation != record.binding.generation
            || envelope.import_key_id != record.binding.import_key_id
            || envelope.public_key_b64u != public_key_b64u
            || envelope.issued_at_ms != record.binding.issued_at_ms
            || envelope.expires_at_ms != record.binding.expires_at_ms
            || envelope.lifecycle != record.lifecycle.as_str()
            || envelope.ciphertext_b64u.is_empty()
        {
            return Err(store_error(
                "tenant-root restore import key ciphertext metadata does not match its row",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore import key ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
            || payload.len() > MAX_RESTORE_IMPORT_KEY_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore import key ciphertext is malformed",
            ));
        }
        Ok(())
    }

}
