//! Router-owned Durable Object entrypoint and transactional lifecycle calls.

use super::*;

#[cfg(all(
    feature = "workers-rs",
    any(feature = "strict-worker-router-entrypoint", test)
))]
#[worker::durable_object(fetch)]
pub struct RouterAbTenantRootCreationDurableObject {
    pub(super) storage: worker::Storage,
    pub(super) env: worker::Env,
    pub(super) authority_object_id: String,
}

#[cfg(all(
    feature = "workers-rs",
    any(feature = "strict-worker-router-entrypoint", test)
))]
impl worker::DurableObject for RouterAbTenantRootCreationDurableObject {
    fn new(state: worker::State, env: worker::Env) -> Self {
        Self {
            storage: state.storage(),
            env,
            authority_object_id: state.id().to_string(),
        }
    }

    async fn fetch(&self, mut request: worker::Request) -> worker::Result<worker::Response> {
        if let Err(error) =
            crate::require_cloudflare_internal_service_auth_request_v1(&request, &self.env)
        {
            return crate::cloudflare_private_service_auth_error_response_v1(error);
        }
        if request.method() != worker::Method::Post {
            return worker::Response::error(
                "Tenant-root creation private routes require POST",
                405,
            );
        }
        if let Some(response) = self.handle_creation_grant_route(&mut request).await {
            return response;
        }
        let path = request.path();
        match path.as_str() {
            crate::CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_PRIVATE_REQUEST_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root destination bootstrap request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootDestinationBootstrapCallV1,
                >(
                    &mut request,
                    TENANT_ROOT_DESTINATION_BOOTSTRAP_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root destination bootstrap request rejected",
                            400,
                        )
                    }
                };
                match self.destination_bootstrap_v1(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root restore-refresh checkpoint request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root restore-refresh checkpoint request rejected",
                            400,
                        )
                    }
                };
                match self.persist_restore_refresh_checkpoint_v1(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root restore activation request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootRestoreInitialActivationRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root restore activation request rejected",
                            400,
                        )
                    }
                };
                match self.persist_restore_initial_activation(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CUTOVER_READ_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root cutover read request requires JSON",
                        415,
                    );
                }
                if decode_bounded_json_request::<CloudflareTenantRootCutoverReadRequestV1>(
                    &mut request,
                    TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1,
                )
                .await
                .is_err()
                {
                    return worker::Response::error(
                        "tenant-root cutover read request rejected",
                        400,
                    );
                }
                match self.read_cutover_record().await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CUTOVER_WRITE_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root cutover write request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCutoverWriteRequestV1,
                >(
                    &mut request, TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root cutover write request rejected",
                            400,
                        )
                    }
                };
                match self.persist_cutover_record(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root creation read request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCreationJournalReadRequestV1,
                >(
                    &mut request, TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1
                )
                .await
                {
                    Ok(value) => value,
                    Err(error) => return tenant_root_creation_do_error_response(error),
                };
                match self.read_creation_journal(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root creation progress request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCreationJournalReadRequestV1,
                >(
                    &mut request, TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1
                )
                .await
                {
                    Ok(value) => value,
                    Err(error) => return tenant_root_creation_do_error_response(error),
                };
                match self.read_creation_progress(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root creation abandonment request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCreationJournalReadRequestV1,
                >(
                    &mut request, TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1
                )
                .await
                {
                    Ok(value) => value,
                    Err(error) => return tenant_root_creation_do_error_response(error),
                };
                match self.persist_creation_abandonment(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root initial activation request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCreationInitialActivationRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root initial activation request rejected",
                            400,
                        )
                    }
                };
                match self.persist_initial_activation(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root refresh activation request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootRefreshActivationRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root refresh activation request rejected",
                            400,
                        )
                    }
                };
                match self.persist_refresh_activation(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root active-state read request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCreationActiveStateReadRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root active-state read request rejected",
                            400,
                        )
                    }
                };
                match self
                    .read_or_reserve_authoritative_active_state(parsed)
                    .await
                {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root creation commitment request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCreationCommitmentRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_CREATION_COMMITMENT_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root creation commitment request rejected",
                            400,
                        )
                    }
                };
                match self.persist_creation_commitment_rendezvous(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root installation request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCreationInstallationRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_CREATION_INSTALLATION_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root installation request rejected",
                            400,
                        )
                    }
                };
                match self.persist_installation_checkpoint(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_CLEANUP_CHECKPOINT_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root creation cleanup request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootCreationCleanupRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_CREATION_CLEANUP_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root creation cleanup request rejected",
                            400,
                        )
                    }
                };
                match self.persist_creation_cleanup_checkpoint(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root refresh commitment request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootRefreshCommitmentRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_REFRESH_COMMITMENT_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root refresh commitment request rejected",
                            400,
                        )
                    }
                };
                match self.persist_refresh_commitment_checkpoint(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root refresh installation request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootRefreshInstallationRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_REFRESH_INSTALLATION_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root refresh installation request rejected",
                            400,
                        )
                    }
                };
                match self.persist_refresh_installation_checkpoint(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            CLOUDFLARE_TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_PATH => {
                if !request_has_json_content_type(&request)? {
                    return worker::Response::error(
                        "tenant-root refresh contribution request requires JSON",
                        415,
                    );
                }
                let parsed = match decode_bounded_json_request::<
                    CloudflareTenantRootRefreshContributionRequestV1,
                >(
                    &mut request,
                    TENANT_ROOT_REFRESH_CONTRIBUTION_REQUEST_MAX_BYTES_V1,
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => {
                        return worker::Response::error(
                            "tenant-root refresh contribution request rejected",
                            400,
                        )
                    }
                };
                match self.persist_refresh_contribution_rendezvous(parsed).await {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => tenant_root_creation_do_error_response(error),
                }
            }
            _ => worker::Response::error("Tenant-root creation private route not found", 404),
        }
    }
}

#[cfg(all(
    feature = "workers-rs",
    any(feature = "strict-worker-router-entrypoint", test)
))]
impl RouterAbTenantRootCreationDurableObject {
    pub(super) async fn destination_bootstrap_v1(
        &self,
        call: CloudflareTenantRootDestinationBootstrapCallV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootDestinationBootstrapResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let configured = self
            .env
            .var("TENANT_ROOT_DESTINATION_BOOTSTRAP_JSON")
            .ok()
            .map(|value| value.to_string());
        let env = self.env.clone();
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_destination_bootstrap_v1(
                    &store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    configured.as_deref(),
                    call,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root destination bootstrap transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(super) async fn read_cutover_record(
        &self,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCutoverReadResponseV1> {
        let record = storage_get_optional::<TenantRootCutoverRecordV1>(
            &self.storage,
            TENANT_ROOT_CUTOVER_STORAGE_KEY_V1,
        )
        .await
        .map_err(durable_storage_protocol_error)?;
        Ok(match record {
            Some(record) => CloudflareTenantRootCutoverReadResponseV1::Present { record },
            None => CloudflareTenantRootCutoverReadResponseV1::Empty,
        })
    }

    pub(super) async fn persist_cutover_record(
        &self,
        request: CloudflareTenantRootCutoverWriteRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCutoverWriteResponseV1> {
        let outcome: Rc<
            RefCell<Option<RouterAbProtocolResult<CloudflareTenantRootCutoverWriteResponseV1>>>,
        > = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let current = transaction_get_optional::<TenantRootCutoverRecordV1>(
                    &transaction,
                    TENANT_ROOT_CUTOVER_STORAGE_KEY_V1,
                )
                .await?;
                let response = match evaluate_cutover_write(current.as_ref(), request) {
                    Ok(response) => response,
                    Err(error) => {
                        outcome_for_transaction.replace(Some(Err(error)));
                        return Ok(());
                    }
                };
                if response.outcome != CloudflareTenantRootCutoverWriteOutcomeV1::ExactReplay {
                    transaction
                        .put(TENANT_ROOT_CUTOVER_STORAGE_KEY_V1, &response.record)
                        .await?;
                }
                outcome_for_transaction.replace(Some(Ok(response)));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let response = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root cutover transaction did not produce an outcome",
            )
        })?;
        response
    }

    pub(super) async fn persist_restore_refresh_checkpoint_v1(
        &self,
        request: CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointResponseV1> {
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result =
                    tenant_root_restore_refresh_checkpoint_v1(&store, request, now_ms).await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root restore-refresh checkpoint transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(super) async fn persist_creation_abandonment(
        &self,
        request: CloudflareTenantRootCreationJournalReadRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationAbandonmentResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let env = self.env.clone();
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_creation_persist_abandonment_v1(
                    &store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    request,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root creation abandonment transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(super) async fn read_creation_progress(
        &self,
        request: CloudflareTenantRootCreationJournalReadRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationProgressV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let env = self.env.clone();
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_creation_read_progress_v1(
                    &store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    request,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root creation progress transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn read_creation_journal(
        &self,
        request: CloudflareTenantRootCreationJournalReadRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalReadResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let env = self.env.clone();
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_creation_read_journal_v1(
                    &store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    request,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root creation read transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(super) async fn read_or_reserve_authoritative_active_state(
        &self,
        request: CloudflareTenantRootCreationActiveStateReadRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationActiveStateReadResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let env = self.env.clone();
        let schedule = refresh_schedule_v1(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_creation_active_state_read_v1(
                    &store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    request,
                    now_ms,
                    schedule,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root active-state transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(super) async fn persist(
        &self,
        request: CloudflareTenantRootCreationJournalRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result =
                    tenant_root_creation_persist_journal_v1(&store, &issuer_keys, request, now_ms)
                        .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root creation journal transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn persist_creation_commitment_rendezvous(
        &self,
        request: CloudflareTenantRootCreationCommitmentRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationCommitmentResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_creation_persist_commitment_v1(
                    &store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root creation commitment transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn persist_installation_checkpoint(
        &self,
        request: CloudflareTenantRootCreationInstallationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationInstallationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_creation_persist_installation_v1(
                    &store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root installation checkpoint transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn persist_creation_cleanup_checkpoint(
        &self,
        request: CloudflareTenantRootCreationCleanupRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationCleanupResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_creation_persist_cleanup_v1(
                    &store,
                    &issuer_keys,
                    &role_keys,
                    request,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root creation cleanup transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn persist_initial_activation(
        &self,
        request: CloudflareTenantRootCreationInitialActivationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationInitialActivationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_creation_persist_initial_activation_v1(
                    &store,
                    &issuer_keys,
                    &role_keys,
                    request,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root initial activation transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(super) fn issuer_verifying_keys(
        &self,
    ) -> RouterAbProtocolResult<BTreeMap<String, [u8; 32]>> {
        let issuer_keys_json = read_required_worker_var(
            &self.env,
            crate::TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
        )?;
        crate::env::decode_issuer_verifying_keys(&issuer_keys_json)
    }

    pub(crate) async fn persist_restore_initial_activation(
        &self,
        request: CloudflareTenantRootRestoreInitialActivationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRestoreInitialActivationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result =
                    tenant_root_restore_initial_activation_v1(&store, &issuer_keys, request).await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root restore initial activation transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn persist_refresh_activation(
        &self,
        request: CloudflareTenantRootRefreshActivationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRefreshActivationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_refresh_persist_activation_v1(
                    &store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root refresh active-state transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn persist_refresh_commitment_checkpoint(
        &self,
        request: CloudflareTenantRootRefreshCommitmentRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRefreshCommitmentResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_refresh_persist_commitment_v1(
                    &store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root refresh commitment transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn persist_refresh_installation_checkpoint(
        &self,
        request: CloudflareTenantRootRefreshInstallationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRefreshInstallationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_refresh_persist_installation_v1(
                    &store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root refresh installation transaction did not produce an outcome",
            )
        })?;
        result
    }

    pub(crate) async fn persist_refresh_contribution_rendezvous(
        &self,
        request: CloudflareTenantRootRefreshContributionRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRefreshContributionResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let outcome = Rc::new(RefCell::new(None));
        let outcome_for_transaction = Rc::clone(&outcome);
        self.storage
            .transaction(move |transaction| async move {
                let store = store.bind(transaction);
                let result = tenant_root_refresh_persist_contribution_v1(
                    &store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await;
                if let Some(error) = store.take_storage_error() {
                    return Err(error);
                }
                outcome_for_transaction.replace(Some(result));
                Ok(())
            })
            .await
            .map_err(durable_storage_protocol_error)?;
        let result = outcome.borrow_mut().take().ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root refresh contribution transaction did not produce an outcome",
            )
        })?;
        result
    }
}
