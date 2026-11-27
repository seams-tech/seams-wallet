//! Router-owned Durable Object entrypoint and transactional lifecycle calls.

use super::super::worker_storage::storage_transaction_value;
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
                match read_creation_json::<CloudflareTenantRootDestinationBootstrapCallV1>(
                    &mut request,
                    "tenant-root destination bootstrap",
                    TENANT_ROOT_DESTINATION_BOOTSTRAP_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => creation_response(self.destination_bootstrap_v1(parsed).await),
                    Err(response) => response,
                }
            }
            crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH => {
                match read_creation_json::<CloudflareTenantRootRestoreRefreshCheckpointRequestV1>(
                    &mut request,
                    "tenant-root restore-refresh checkpoint",
                    TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => {
                        creation_response(self.persist_restore_refresh_checkpoint_v1(parsed).await)
                    }
                    Err(response) => response,
                }
            }
            crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH => {
                match read_creation_json::<CloudflareTenantRootRestoreInitialActivationRequestV1>(
                    &mut request,
                    "tenant-root restore activation",
                    TENANT_ROOT_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => {
                        creation_response(self.persist_restore_initial_activation(parsed).await)
                    }
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CUTOVER_READ_PATH => {
                match read_creation_json::<CloudflareTenantRootCutoverReadRequestV1>(
                    &mut request,
                    "tenant-root cutover read",
                    TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(_) => creation_response(self.read_cutover_record().await),
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CUTOVER_WRITE_PATH => {
                match read_creation_json::<CloudflareTenantRootCutoverWriteRequestV1>(
                    &mut request,
                    "tenant-root cutover write",
                    TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => creation_response(self.persist_cutover_record(parsed).await),
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH => {
                match read_creation_json::<CloudflareTenantRootCreationJournalReadRequestV1>(
                    &mut request,
                    "tenant-root creation read",
                    TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Protocol,
                )
                .await
                {
                    Ok(parsed) => creation_response(self.read_creation_journal(parsed).await),
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH => {
                match read_creation_json::<CloudflareTenantRootCreationJournalReadRequestV1>(
                    &mut request,
                    "tenant-root creation progress",
                    TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Protocol,
                )
                .await
                {
                    Ok(parsed) => creation_response(self.read_creation_progress(parsed).await),
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH => match read_creation_json::<
                CloudflareTenantRootCreationJournalReadRequestV1,
            >(
                &mut request,
                "tenant-root creation abandonment",
                TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
                BodyRejection::Protocol,
            )
            .await
            {
                Ok(parsed) => creation_response(self.persist_creation_abandonment(parsed).await),
                Err(response) => response,
            },
            CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH => {
                match read_creation_json::<CloudflareTenantRootCreationInitialActivationRequestV1>(
                    &mut request,
                    "tenant-root initial activation",
                    TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => creation_response(self.persist_initial_activation(parsed).await),
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH => {
                match read_creation_json::<CloudflareTenantRootRefreshActivationRequestV1>(
                    &mut request,
                    "tenant-root refresh activation",
                    TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => creation_response(self.persist_refresh_activation(parsed).await),
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH => {
                match read_creation_json::<CloudflareTenantRootCreationActiveStateReadRequestV1>(
                    &mut request,
                    "tenant-root active-state read",
                    TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => creation_response(
                        self.read_or_reserve_authoritative_active_state(parsed)
                            .await,
                    ),
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_PATH => {
                match read_creation_json::<CloudflareTenantRootCreationCommitmentRequestV1>(
                    &mut request,
                    "tenant-root creation commitment",
                    TENANT_ROOT_CREATION_COMMITMENT_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => {
                        creation_response(self.persist_creation_commitment_rendezvous(parsed).await)
                    }
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH => {
                match read_creation_json::<CloudflareTenantRootCreationInstallationRequestV1>(
                    &mut request,
                    "tenant-root installation",
                    TENANT_ROOT_CREATION_INSTALLATION_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => {
                        creation_response(self.persist_installation_checkpoint(parsed).await)
                    }
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_CREATION_CLEANUP_CHECKPOINT_PATH => {
                match read_creation_json::<CloudflareTenantRootCreationCleanupRequestV1>(
                    &mut request,
                    "tenant-root creation cleanup",
                    TENANT_ROOT_CREATION_CLEANUP_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => {
                        creation_response(self.persist_creation_cleanup_checkpoint(parsed).await)
                    }
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_PATH => {
                match read_creation_json::<CloudflareTenantRootRefreshCommitmentRequestV1>(
                    &mut request,
                    "tenant-root refresh commitment",
                    TENANT_ROOT_REFRESH_COMMITMENT_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => {
                        creation_response(self.persist_refresh_commitment_checkpoint(parsed).await)
                    }
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_PATH => {
                match read_creation_json::<CloudflareTenantRootRefreshInstallationRequestV1>(
                    &mut request,
                    "tenant-root refresh installation",
                    TENANT_ROOT_REFRESH_INSTALLATION_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => creation_response(
                        self.persist_refresh_installation_checkpoint(parsed).await,
                    ),
                    Err(response) => response,
                }
            }
            CLOUDFLARE_TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_PATH => {
                match read_creation_json::<CloudflareTenantRootRefreshContributionRequestV1>(
                    &mut request,
                    "tenant-root refresh contribution",
                    TENANT_ROOT_REFRESH_CONTRIBUTION_REQUEST_MAX_BYTES_V1,
                    BodyRejection::Rejected,
                )
                .await
                {
                    Ok(parsed) => creation_response(
                        self.persist_refresh_contribution_rendezvous(parsed).await,
                    ),
                    Err(response) => response,
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
        self.in_store_transaction(
            "tenant-root destination bootstrap transaction did not produce an outcome",
            async move |store| {
                tenant_root_destination_bootstrap_v1(
                    store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    configured.as_deref(),
                    call,
                    now_ms,
                )
                .await
            },
        )
        .await
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
        let committed = storage_transaction_value(&self.storage, async move |transaction| {
            let current = transaction_get_optional::<TenantRootCutoverRecordV1>(
                &transaction,
                TENANT_ROOT_CUTOVER_STORAGE_KEY_V1,
            )
            .await?;
            let response = match evaluate_cutover_write(current.as_ref(), request) {
                Ok(response) => response,
                Err(error) => return Ok(Err(error)),
            };
            if response.outcome != CloudflareTenantRootCutoverWriteOutcomeV1::ExactReplay {
                transaction
                    .put(TENANT_ROOT_CUTOVER_STORAGE_KEY_V1, &response.record)
                    .await?;
            }
            Ok(Ok(response))
        })
        .await;
        transaction_outcome(
            committed,
            "tenant-root cutover transaction did not produce an outcome",
        )
    }

    /// Runs one creation-store operation in one storage transaction. A
    /// storage failure inside the operation aborts the transaction.
    pub(super) async fn in_store_transaction<T: 'static>(
        &self,
        missing_outcome: &'static str,
        operation: impl AsyncFnOnce(&OwnedDurableObjectTransactionStoreV1) -> RouterAbProtocolResult<T>
            + 'static,
    ) -> RouterAbProtocolResult<T> {
        let store = DurableObjectCreationStoreV1::new(&self.env, &self.authority_object_id)?;
        let committed = storage_transaction_value(&self.storage, async move |transaction| {
            let store = store.bind(transaction);
            let result = operation(&store).await;
            match store.take_storage_error() {
                Some(error) => Err(error),
                None => Ok(result),
            }
        })
        .await;
        transaction_outcome(committed, missing_outcome)
    }

    pub(super) async fn persist_restore_refresh_checkpoint_v1(
        &self,
        request: CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointResponseV1> {
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root restore-refresh checkpoint transaction did not produce an outcome",
            async move |store| {
                tenant_root_restore_refresh_checkpoint_v1(store, request, now_ms).await
            },
        )
        .await
    }

    pub(super) async fn persist_creation_abandonment(
        &self,
        request: CloudflareTenantRootCreationJournalReadRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationAbandonmentResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let env = self.env.clone();
        self.in_store_transaction(
            "tenant-root creation abandonment transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_persist_abandonment_v1(
                    store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    request,
                    now_ms,
                )
                .await
            },
        )
        .await
    }

    pub(super) async fn read_creation_progress(
        &self,
        request: CloudflareTenantRootCreationJournalReadRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationProgressV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let env = self.env.clone();
        self.in_store_transaction(
            "tenant-root creation progress transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_read_progress_v1(
                    store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    request,
                    now_ms,
                )
                .await
            },
        )
        .await
    }

    pub(crate) async fn read_creation_journal(
        &self,
        request: CloudflareTenantRootCreationJournalReadRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalReadResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let env = self.env.clone();
        self.in_store_transaction(
            "tenant-root creation read transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_read_journal_v1(
                    store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    request,
                )
                .await
            },
        )
        .await
    }

    pub(super) async fn read_or_reserve_authoritative_active_state(
        &self,
        request: CloudflareTenantRootCreationActiveStateReadRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationActiveStateReadResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let env = self.env.clone();
        let schedule = refresh_schedule_v1(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root active-state transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_active_state_read_v1(
                    store,
                    &issuer_keys,
                    move || read_tenant_root_creation_role_verifying_keys(&env),
                    request,
                    now_ms,
                    schedule,
                )
                .await
            },
        )
        .await
    }

    pub(super) async fn persist(
        &self,
        request: CloudflareTenantRootCreationJournalRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root creation journal transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_persist_journal_v1(store, &issuer_keys, request, now_ms).await
            },
        )
        .await
    }

    pub(crate) async fn persist_creation_commitment_rendezvous(
        &self,
        request: CloudflareTenantRootCreationCommitmentRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationCommitmentResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root creation commitment transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_persist_commitment_v1(
                    store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await
            },
        )
        .await
    }

    pub(crate) async fn persist_installation_checkpoint(
        &self,
        request: CloudflareTenantRootCreationInstallationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationInstallationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root installation checkpoint transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_persist_installation_v1(
                    store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await
            },
        )
        .await
    }

    pub(crate) async fn persist_creation_cleanup_checkpoint(
        &self,
        request: CloudflareTenantRootCreationCleanupRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationCleanupResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        self.in_store_transaction(
            "tenant-root creation cleanup transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_persist_cleanup_v1(store, &issuer_keys, &role_keys, request)
                    .await
            },
        )
        .await
    }

    pub(crate) async fn persist_initial_activation(
        &self,
        request: CloudflareTenantRootCreationInitialActivationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationInitialActivationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        self.in_store_transaction(
            "tenant-root initial activation transaction did not produce an outcome",
            async move |store| {
                tenant_root_creation_persist_initial_activation_v1(
                    store,
                    &issuer_keys,
                    &role_keys,
                    request,
                )
                .await
            },
        )
        .await
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
        self.in_store_transaction(
            "tenant-root restore initial activation transaction did not produce an outcome",
            async move |store| {
                tenant_root_restore_initial_activation_v1(store, &issuer_keys, request).await
            },
        )
        .await
    }

    pub(crate) async fn persist_refresh_activation(
        &self,
        request: CloudflareTenantRootRefreshActivationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRefreshActivationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root refresh active-state transaction did not produce an outcome",
            async move |store| {
                tenant_root_refresh_persist_activation_v1(
                    store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await
            },
        )
        .await
    }

    pub(crate) async fn persist_refresh_commitment_checkpoint(
        &self,
        request: CloudflareTenantRootRefreshCommitmentRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRefreshCommitmentResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root refresh commitment transaction did not produce an outcome",
            async move |store| {
                tenant_root_refresh_persist_commitment_v1(
                    store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await
            },
        )
        .await
    }

    pub(crate) async fn persist_refresh_installation_checkpoint(
        &self,
        request: CloudflareTenantRootRefreshInstallationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRefreshInstallationResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root refresh installation transaction did not produce an outcome",
            async move |store| {
                tenant_root_refresh_persist_installation_v1(
                    store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await
            },
        )
        .await
    }

    pub(crate) async fn persist_refresh_contribution_rendezvous(
        &self,
        request: CloudflareTenantRootRefreshContributionRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootRefreshContributionResponseV1> {
        let issuer_keys = self.issuer_verifying_keys()?;
        let role_keys = read_tenant_root_creation_role_verifying_keys(&self.env)?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        self.in_store_transaction(
            "tenant-root refresh contribution transaction did not produce an outcome",
            async move |store| {
                tenant_root_refresh_persist_contribution_v1(
                    store,
                    &issuer_keys,
                    &role_keys,
                    request,
                    now_ms,
                )
                .await
            },
        )
        .await
    }
}

/// The operation's result from a committed transaction, or the failure that
/// stopped the transaction.
fn transaction_outcome<T>(
    committed: worker::Result<Option<RouterAbProtocolResult<T>>>,
    missing_outcome: &'static str,
) -> RouterAbProtocolResult<T> {
    committed
        .map_err(durable_storage_protocol_error)?
        .unwrap_or_else(|| {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                missing_outcome,
            ))
        })
}

/// How a creation route answers a body that does not decode.
#[derive(Clone, Copy)]
enum BodyRejection {
    /// 400 with "{subject} request rejected".
    Rejected,
    /// The creation Durable Object's response for the protocol error.
    Protocol,
}

/// Reads a creation route's JSON body of at most `max_bytes`. A request
/// without a JSON content type is refused with 415 and "{subject} request
/// requires JSON".
async fn read_creation_json<T: DeserializeOwned>(
    request: &mut worker::Request,
    subject: &str,
    max_bytes: usize,
    rejection: BodyRejection,
) -> Result<T, worker::Result<worker::Response>> {
    match request_has_json_content_type(request) {
        Ok(true) => {}
        Ok(false) => {
            return Err(worker::Response::error(
                format!("{subject} request requires JSON"),
                415,
            ))
        }
        Err(error) => return Err(Err(error)),
    }
    decode_bounded_json_request(request, max_bytes)
        .await
        .map_err(|error| match rejection {
            BodyRejection::Rejected => {
                worker::Response::error(format!("{subject} request rejected"), 400)
            }
            BodyRejection::Protocol => tenant_root_creation_do_error_response(error),
        })
}

/// The JSON of a creation operation's value, or the creation Durable
/// Object's response for its error.
fn creation_response<T: Serialize>(
    result: RouterAbProtocolResult<T>,
) -> worker::Result<worker::Response> {
    match result {
        Ok(response) => worker::Response::from_json(&response),
        Err(error) => tenant_root_creation_do_error_response(error),
    }
}
