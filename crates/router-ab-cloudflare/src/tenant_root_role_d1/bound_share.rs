//! Bound-root admission and coherent share reads.
use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum RootUseAccess {
    Admit,
    ReadAdmitted,
    PrepareRegistration,
    BindRegistration { preparation_digest: [u8; 32] },
}

fn one_row<T: serde::de::DeserializeOwned, O: RoleSqlOutcomeV1>(
    result: Option<O>,
    label: &str,
) -> RoleStoreResult<Option<T>> {
    let rows = result
        .ok_or_else(|| store_error(format!("missing {label} result")))?
        .results::<T>()?;
    let mut rows = rows.into_iter();
    let first = rows.next();
    if rows.next().is_some() {
        return Err(store_error(format!("ambiguous {label} result")));
    }
    Ok(first)
}

// Lives only for this admission request. Fresh database rows must match every
// persisted field before the authenticated plaintext can be reused.
struct VerifiedBoundRootSnapshot {
    row: TenantRootRoleD1RowV1,
    stored: CloudflareStoredTenantRootRoleShareV1,
}

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {
    pub(crate) async fn release_registration_preparation(
        &self,
        session: &[u8; 32],
        object_id: &str,
        preparation_digest: &[u8; 32],
    ) -> RoleStoreResult<()> {
        let session_hex = encode_hex(session);
        let digest_hex = encode_hex(preparation_digest);
        self.session
            .prepare(
                "DELETE FROM tenant_root_root_use_admissions WHERE role = $1 \
             AND attempt_kind = 'ed25519_yao_pair_session' AND attempt_key_hex = $2 \
             AND pair_object_id = $3 AND preparation_digest_hex = $4 AND status = 'admitted'",
            )
            .bind_refs(
                [
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                    RoleSqlValue::Text(&session_hex),
                    RoleSqlValue::Text(object_id),
                    RoleSqlValue::Text(&digest_hex),
                ]
                .iter(),
            )?
            .run()
            .await?;
        Ok(())
    }
    pub(super) async fn load_epoch_row_by_identity_digest(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> RoleStoreResult<Option<TenantRootRoleD1RowV1>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
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
        Ok(row)
    }

    /// Admit and read one exact root-use attempt without extending its epoch.
    pub(crate) async fn admit_bound(
        &self,
        custody_binding: &TenantRootCustodyBindingV1,
        attempt: &TenantRootRootUseAttemptV1,
        admitted_at_ms: u64,
    ) -> RoleStoreResult<TenantRootRootUseAdmissionV1> {
        Ok(
            match self
                .load_bound(custody_binding, attempt, admitted_at_ms)
                .await?
            {
                TenantRootBoundShareV1::Readable(_) => TenantRootRootUseAdmissionV1::Admitted,
                TenantRootBoundShareV1::EpochClosed => TenantRootRootUseAdmissionV1::EpochClosed,
                TenantRootBoundShareV1::NotYetActive => TenantRootRootUseAdmissionV1::NotYetActive,
                TenantRootBoundShareV1::AttemptConflict => {
                    TenantRootRootUseAdmissionV1::AttemptConflict
                }
                TenantRootBoundShareV1::Cancelled => TenantRootRootUseAdmissionV1::Cancelled,
                TenantRootBoundShareV1::Erased => TenantRootRootUseAdmissionV1::Erased,
            },
        )
    }

    /// Read an admitted share and active-root uniqueness from one transaction.
    pub(crate) async fn load_bound(
        &self,
        custody_binding: &TenantRootCustodyBindingV1,
        attempt: &TenantRootRootUseAttemptV1,
        admitted_at_ms: u64,
    ) -> RoleStoreResult<TenantRootBoundShareV1> {
        self.load_bound_with_access(
            custody_binding,
            attempt,
            admitted_at_ms,
            RootUseAccess::Admit,
        )
        .await
    }

    pub(crate) async fn load_bound_with_access(
        &self,
        custody_binding: &TenantRootCustodyBindingV1,
        attempt: &TenantRootRootUseAttemptV1,
        admitted_at_ms: u64,
        access: RootUseAccess,
    ) -> RoleStoreResult<TenantRootBoundShareV1> {
        custody_binding
            .validate()
            .map_err(|error| store_error(error.message()))?;
        // Only a retired share is ever erased. Without its row, every outcome
        // below is a refusal, so the binding is not checked against it.
        #[cfg(feature = "workers-rs")]
        let initial_read_started_ms = worker::Date::now().as_millis();
        let creates_admission = matches!(
            access,
            RootUseAccess::Admit | RootUseAccess::PrepareRegistration
        );
        let initial_snapshot = if creates_admission {
            let row = self
                .load_epoch_row_by_identity_digest(
                    custody_binding.identity_digest(),
                    custody_binding.custody_lineage(),
                    custody_binding.epoch(),
                )
                .await?;
            let stored = self.open_row(row.clone()).await?;
            match stored.as_ref().map(|stored| stored.record().lifecycle()) {
                Some(CloudflareTenantRootRoleShareLifecycleV1::Pending(_)) => {
                    return Ok(TenantRootBoundShareV1::NotYetActive);
                }
                _ => {}
            }
            if let Some(stored) = &stored {
                self.verify_bound_row(stored, custody_binding)?;
            }
            row.zip(stored)
                .map(|(row, stored)| VerifiedBoundRootSnapshot { row, stored })
        } else {
            None
        };
        let lifecycle_is_active = initial_snapshot.as_ref().is_some_and(|snapshot| {
            matches!(
                snapshot.stored.record().lifecycle(),
                CloudflareTenantRootRoleShareLifecycleV1::Active(_)
            )
        });
        #[cfg(feature = "workers-rs")]
        let initial_read_ms = worker::Date::now()
            .as_millis()
            .saturating_sub(initial_read_started_ms);
        let identity_digest_hex = encode_hex(custody_binding.identity_digest().as_bytes());
        let custody_lineage_b64u = custody_binding.custody_lineage().to_base64url();
        let binding_digest_hex = encode_hex(
            custody_binding
                .digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let attempt_digest_hex = encode_hex(
            custody_binding
                .attempt_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let attempt_kind = attempt.kind();
        let attempt_key_hex = attempt.key_hex(custody_binding);
        let epoch = epoch_i64(custody_binding.epoch())?.to_string();
        let receipt_digest_hex = encode_hex(custody_binding.activation_receipt_digest().as_bytes());
        let mut statements = Vec::new();
        if let RootUseAccess::BindRegistration { preparation_digest } = access {
            let preparation_digest_hex = encode_hex(&preparation_digest);
            let now_ms = admitted_at_ms.to_string();
            let expires_at_ms = custody_binding.expires_at_ms().to_string();
            statements.push(
                self.session
                    .prepare(
                        "UPDATE tenant_root_root_use_admissions SET attempt_digest_hex = $6, \
                 first_binding_digest_hex = $7, preparation_digest_hex = NULL, expires_at_ms = $13 \
                 WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
                 AND role = $3 AND attempt_kind = $4 AND attempt_key_hex = $5 \
                 AND preparation_digest_hex = $8 AND tenant_root_share_epoch = $9 \
                 AND activation_receipt_digest_hex = $10 AND pair_object_id = $11 \
                 AND status = 'admitted' AND expires_at_ms > $12",
                    )
                    .bind_refs(
                        [
                            RoleSqlValue::Text(&identity_digest_hex),
                            RoleSqlValue::Text(&custody_lineage_b64u),
                            RoleSqlValue::Text(self.cipher.role.as_str()),
                            RoleSqlValue::Text(attempt_kind),
                            RoleSqlValue::Text(&attempt_key_hex),
                            RoleSqlValue::Text(&attempt_digest_hex),
                            RoleSqlValue::Text(&binding_digest_hex),
                            RoleSqlValue::Text(&preparation_digest_hex),
                            RoleSqlValue::Text(&epoch),
                            RoleSqlValue::Text(&receipt_digest_hex),
                            attempt
                                .pair_object_id()
                                .map_or(RoleSqlValue::Null, RoleSqlValue::Text),
                            RoleSqlValue::Text(&now_ms),
                            RoleSqlValue::Text(&expires_at_ms),
                        ]
                        .iter(),
                    )?,
            );
        }
        if lifecycle_is_active {
            let issued_at_ms = custody_binding.issued_at_ms().to_string();
            let expires_at_ms = custody_binding.expires_at_ms().to_string();
            let admitted_at_ms = admitted_at_ms.to_string();
            statements.push(
                self.session.prepare(ADMIT_ROOT_USE_SQL).bind_refs(
                    [
                        RoleSqlValue::Text(identity_digest_hex.as_str()),
                        RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                        RoleSqlValue::Text(self.cipher.role.as_str()),
                        RoleSqlValue::Text(attempt_kind),
                        RoleSqlValue::Text(attempt_key_hex.as_str()),
                        RoleSqlValue::Text(epoch.as_str()),
                        RoleSqlValue::Text(receipt_digest_hex.as_str()),
                        RoleSqlValue::Text(attempt_digest_hex.as_str()),
                        RoleSqlValue::Text(binding_digest_hex.as_str()),
                        RoleSqlValue::Text(issued_at_ms.as_str()),
                        RoleSqlValue::Text(expires_at_ms.as_str()),
                        RoleSqlValue::Text(admitted_at_ms.as_str()),
                        attempt
                            .pair_object_id()
                            .map_or(RoleSqlValue::Null, RoleSqlValue::Text),
                        if access == RootUseAccess::PrepareRegistration {
                            RoleSqlValue::Text(&attempt_digest_hex)
                        } else {
                            RoleSqlValue::Null
                        },
                    ]
                    .iter(),
                )?,
            );
        }
        statements.push(
            self.session
                .prepare(LOAD_ROOT_USE_ADMISSION_SQL)
                .bind_refs(
                    [
                        RoleSqlValue::Text(identity_digest_hex.as_str()),
                        RoleSqlValue::Text(custody_lineage_b64u.as_str()),
                        RoleSqlValue::Text(self.cipher.role.as_str()),
                        RoleSqlValue::Text(attempt_kind),
                        RoleSqlValue::Text(attempt_key_hex.as_str()),
                    ]
                    .iter(),
                )?,
        );
        statements.push(
            self.session.prepare(LOAD_EPOCH_SQL).bind_refs(
                [
                    RoleSqlValue::Text(&identity_digest_hex),
                    RoleSqlValue::Text(&custody_lineage_b64u),
                    RoleSqlValue::Text(&epoch),
                    RoleSqlValue::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?,
        );
        statements.push(
            self.session
                .prepare(LOAD_ACTIVE_SQL)
                .bind_refs([RoleSqlValue::Text(&identity_digest_hex)].iter())?,
        );
        let expected_results = statements.len();
        #[cfg(feature = "workers-rs")]
        let batch_started_ms = worker::Date::now().as_millis();
        let results = self
            .session
            .transaction(statements.into_iter().map(Into::into).collect())
            .await?;
        #[cfg(feature = "workers-rs")]
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "bound_root_d1_timing",
                "role": self.cipher.role.as_str(),
                "attempt_kind": attempt_kind,
                "attempt_key": attempt_key_hex,
                "access": match access {
                    RootUseAccess::Admit => "admit",
                    RootUseAccess::ReadAdmitted => "read_admitted",
                    RootUseAccess::PrepareRegistration => "prepare_registration",
                    RootUseAccess::BindRegistration { .. } => "bind_registration",
                },
                "round_trips": if creates_admission { 2 } else { 1 },
                "statements": expected_results + usize::from(creates_admission),
                "initial_read_and_open_ms": initial_read_ms,
                "batch_ms": worker::Date::now().as_millis().saturating_sub(batch_started_ms),
            })
        );
        if results.len() != expected_results || results.iter().any(|result| !result.success()) {
            return Err(store_error("bound-root admission batch failed"));
        }
        let mut results = results.into_iter();
        if matches!(access, RootUseAccess::BindRegistration { .. }) {
            results.next();
        }
        if lifecycle_is_active {
            results.next();
        }
        let admission: Option<TenantRootRootUseAdmissionRowV1> =
            one_row(results.next(), "bound-root admission")?;
        let row: Option<TenantRootRoleD1RowV1> = one_row(results.next(), "bound-root epoch")?;
        let active_rows = results
            .next()
            .ok_or_else(|| store_error("missing active-root snapshot"))?
            .results::<TenantRootRoleD1RowV1>()?;
        // Read the share and its admission in the same transaction. A refresh,
        // cancellation or erasure cannot interleave these observations.
        if !creates_admission && admission.is_none() {
            return Err(store_error("prepared root-use admission is missing"));
        }
        match admission {
            Some(admission) => {
                if admission.tenant_root_share_epoch.to_string() != epoch
                    || admission.activation_receipt_digest_hex != receipt_digest_hex
                    || admission.attempt_digest_hex != attempt_digest_hex
                    || admission.pair_object_id.as_deref() != attempt.pair_object_id()
                    || (admission.preparation_digest_hex.is_some()
                        != (access == RootUseAccess::PrepareRegistration))
                {
                    return Ok(TenantRootBoundShareV1::AttemptConflict);
                }
                if admission.status == "cancelled" {
                    return Ok(TenantRootBoundShareV1::Cancelled);
                }
                let stored = self
                    .resolve_bound_snapshot(row, active_rows, initial_snapshot, custody_binding)
                    .await?;
                match (admission.status.as_str(), stored) {
                    (_, Some(stored)) => {
                        let installation_evidence_digest = match stored.record().lifecycle() {
                            CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
                                active.pending.installation_evidence_digest()
                            }
                            CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
                                retired.active.pending.installation_evidence_digest()
                            }
                            CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => {
                                return Ok(TenantRootBoundShareV1::NotYetActive);
                            }
                        };
                        // The decrypted row and activation are already verified. Consume
                        // that exact record without validating its unchanged fields again.
                        let sealed = stored
                            .record
                            .into_online_role_share_artifact_with_installation_evidence_digest(
                                installation_evidence_digest,
                            )?;
                        Ok(TenantRootBoundShareV1::Readable(sealed))
                    }
                    ("settled", None) => Ok(TenantRootBoundShareV1::Erased),
                    (_, None) => Err(store_error(
                        "tenant-root root-use admission is unsettled but its role share is gone",
                    )),
                }
            }
            // The conditional insert found the epoch no longer active: a
            // refresh retired it before this operation was admitted.
            None if row.is_some() => Ok(TenantRootBoundShareV1::EpochClosed),
            // Neither the share nor an admission: the epoch closed here before
            // this operation was admitted if a later one is active here.
            None => {
                let active = active_rows.iter().find(|row| {
                    row.custody_lineage_b64u == custody_lineage_b64u
                        && row.role == self.cipher.role.as_str()
                });
                match active {
                    Some(active)
                        if active.tenant_root_share_epoch > epoch_i64(custody_binding.epoch())? =>
                    {
                        Ok(TenantRootBoundShareV1::EpochClosed)
                    }
                    _ => Err(store_error(
                        "tenant-root role share named by the custody binding does not exist",
                    )),
                }
            }
        }
    }

    async fn resolve_bound_snapshot(
        &self,
        row: Option<TenantRootRoleD1RowV1>,
        active_rows: Vec<TenantRootRoleD1RowV1>,
        initial: Option<VerifiedBoundRootSnapshot>,
        custody_binding: &TenantRootCustodyBindingV1,
    ) -> RoleStoreResult<Option<CloudflareStoredTenantRootRoleShareV1>> {
        if let Some(initial) = initial {
            let unchanged = row.as_ref() == Some(&initial.row);
            let unique = initial.row.lifecycle != "active"
                || (active_rows.len() == 1 && active_rows[0] == initial.row);
            if unchanged && unique {
                return Ok(Some(initial.stored));
            }
        }
        let stored = match row {
            Some(row) if row.lifecycle == "active" => Some(
                self.resolve_active_rows(custody_binding.identity_digest(), active_rows)
                    .await?
                    .require_active()?,
            ),
            row => self.open_row(row).await?,
        };
        if let Some(stored) = &stored {
            if !matches!(
                stored.record().lifecycle(),
                CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
            ) {
                self.verify_bound_row(stored, custody_binding)?;
            }
        }
        Ok(stored)
    }
    /// Checks an activated row against every custody-binding field: identity,
    /// lineage, epoch, role, this role's commitment, and the activation
    /// receipt that made the epoch active. Both callers supply records already
    /// authenticated by `open_row` in this request.
    fn verify_bound_row(
        &self,
        stored: &CloudflareStoredTenantRootRoleShareV1,
        custody_binding: &TenantRootCustodyBindingV1,
    ) -> RoleStoreResult<()> {
        let record = stored.record();
        let activation_receipt_digest = match record.lifecycle() {
            CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
                active.activation.activation_receipt_digest
            }
            CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
                retired.active.activation.activation_receipt_digest
            }
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => {
                return Err(store_error(
                    "tenant-root role share named by the custody binding is not active",
                ));
            }
        };
        let expected_role = self.cipher.role.managed_restore_role();
        let expected_commitment = match expected_role {
            TenantRootManagedRestoreRoleV1::DeriverA => custody_binding.commitments().deriver_a(),
            TenantRootManagedRestoreRoleV1::DeriverB => custody_binding.commitments().deriver_b(),
        };
        let identity_digest = record
            .identity()
            .digest()
            .map_err(|error| store_error(error.message()))?;
        if identity_digest != custody_binding.identity_digest()
            || record.custody_lineage() != custody_binding.custody_lineage()
            || record.epoch() != custody_binding.epoch()
            || record.role().managed_restore_role() != expected_role
            || record.share_commitment() != expected_commitment
            || activation_receipt_digest != custody_binding.activation_receipt_digest()
        {
            return Err(store_error(
                "tenant-root role share does not match authenticated custody binding",
            ));
        }
        Ok(())
    }
}
