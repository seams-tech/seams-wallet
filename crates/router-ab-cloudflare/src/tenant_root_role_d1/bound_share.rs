//! Bound-root admission and coherent share reads.
use super::*;

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

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {
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
        custody_binding
            .validate()
            .map_err(|error| store_error(error.message()))?;
        // Only a retired share is ever erased. Without its row, every outcome
        // below is a refusal, so the binding is not checked against it.
        #[cfg(feature = "workers-rs")]
        let initial_read_started_ms = worker::Date::now().as_millis();
        let stored = self
            .load_epoch_by_identity_digest(
                custody_binding.identity_digest(),
                custody_binding.custody_lineage(),
                custody_binding.epoch(),
            )
            .await?;
        #[cfg(feature = "workers-rs")]
        let initial_read_ms = worker::Date::now()
            .as_millis()
            .saturating_sub(initial_read_started_ms);
        let lifecycle_is_active = match stored.as_ref().map(|stored| stored.record().lifecycle()) {
            Some(CloudflareTenantRootRoleShareLifecycleV1::Pending(_)) => {
                return Ok(TenantRootBoundShareV1::NotYetActive);
            }
            Some(CloudflareTenantRootRoleShareLifecycleV1::Active(_)) => true,
            Some(CloudflareTenantRootRoleShareLifecycleV1::Retired(_)) | None => false,
        };
        if let Some(stored) = &stored {
            self.verify_bound_row(stored, custody_binding)?;
        }
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
                            .pair_object_name()
                            .map_or(RoleSqlValue::Null, RoleSqlValue::Text),
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
        let results = self.session.batch(statements).await?;
        #[cfg(feature = "workers-rs")]
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "bound_root_d1_timing",
                "role": self.cipher.role.as_str(),
                "attempt_kind": attempt_kind,
                "attempt_key": attempt_key_hex,
                "round_trips": 2,
                "statements": expected_results + 1,
                "initial_read_and_open_ms": initial_read_ms,
                "batch_ms": worker::Date::now().as_millis().saturating_sub(batch_started_ms),
            })
        );
        if results.len() != expected_results || results.iter().any(|result| !result.success()) {
            return Err(store_error("bound-root admission batch failed"));
        }
        let mut results = results.into_iter();
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
        match admission {
            Some(admission) => {
                if admission.tenant_root_share_epoch.to_string() != epoch
                    || admission.activation_receipt_digest_hex != receipt_digest_hex
                    || admission.attempt_digest_hex != attempt_digest_hex
                    || admission.pair_object_name.as_deref() != attempt.pair_object_name()
                {
                    return Ok(TenantRootBoundShareV1::AttemptConflict);
                }
                if admission.status == "cancelled" {
                    return Ok(TenantRootBoundShareV1::Cancelled);
                }
                // The active snapshot includes the epoch row from this same
                // transaction. Resolve and decrypt it once, including uniqueness.
                let stored = match row {
                    Some(row) if row.lifecycle == "active" => Some(
                        self.resolve_active_rows(custody_binding.identity_digest(), active_rows)
                            .await?
                            .require_active()?,
                    ),
                    row => self.open_row(row).await?,
                };
                match (admission.status.as_str(), stored) {
                    (_, Some(stored)) => match stored.record().lifecycle() {
                        CloudflareTenantRootRoleShareLifecycleV1::Active(_)
                        | CloudflareTenantRootRoleShareLifecycleV1::Retired(_) => {
                            self.verify_bound_row(&stored, custody_binding)?;
                            Ok(TenantRootBoundShareV1::Readable(stored))
                        }
                        CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => {
                            Ok(TenantRootBoundShareV1::NotYetActive)
                        }
                    },
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
}
