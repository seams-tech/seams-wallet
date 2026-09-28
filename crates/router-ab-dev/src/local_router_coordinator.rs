use router_ab_cloudflare::{
    CloudflareEd25519YaoPairExecuteRequestV1, CloudflareEd25519YaoPairExecuteResponseV1,
    CloudflareEd25519YaoPairLookupRequestV1, CloudflareEd25519YaoPairPrepareRequestV1,
    CloudflareEd25519YaoPairStatusResponseV1, CloudflareRouterEd25519YaoExecuteRequestV2,
    CloudflareRouterEd25519YaoRegistrationConsumeRequestV1, RouterWalletRegistrationV1,
    RouterWalletResponseV1,
};
use router_ab_core::{
    ed25519_yao_recipient_set_digest_v1, Ed25519YaoCeremonyBindingV1, Ed25519YaoDeriverRoleV1,
    Ed25519YaoInputPairBindingV1, Ed25519YaoOperationV1,
    RouterAbEd25519YaoActivationPublicReceiptV1, RouterAbEd25519YaoActivationResultV1,
    RouterAbEd25519YaoExportResultV1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult, RouterEd25519YaoExecuteFailureCodeV1, RouterEd25519YaoExecuteResultV1,
    RouterEd25519YaoExecuteSuccessV1, TenantRootIdentityV1,
};
use router_ab_ed25519_yao::{
    Ed25519YaoActivationRoleExecutionV1, Ed25519YaoRoleExecutionV1,
};
use serde::{Deserialize, Serialize};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

const ROUTER_AUTHORITY_TTL_MS: u64 = 60_000;

/// Local JSON boundary equivalent of the production recovery-promotion body.
/// The Cloudflare request type is worker-feature gated, so the local harness
/// keeps this exact wire shape at its own boundary. The tenant root names the
/// wallet's SigningWorker on Workers; the local SigningWorker holds every
/// wallet, so here it is only checked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalRouterEd25519YaoRecoveryPromotionRequestV1 {
    binding: router_ab_core::Ed25519YaoCeremonyBindingV1,
    public_receipt: RouterAbEd25519YaoActivationPublicReceiptV1,
    tenant_root: router_ab_cloudflare::CloudflareRouterEd25519YaoTenantRootV1,
}

use super::{
    decode_local_router_ed25519_yao_execute_request_v1, local_dev_http_route_error_v1,
    LocalDevHttpRequestPartsV1, LocalEd25519YaoInitialRegistrationFinalizationV1,
    LocalEd25519YaoSigningWorkerActivationReceiptV1, LocalEd25519YaoSigningWorkerPackageDeliveryV1,
    LocalEd25519YaoSigningWorkerPackagePairDeliveryV1,
    LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1, LocalHttpServiceBindingClientV1,
    LocalRouterRequestDispatcherV1, LocalRouterWorkerConfigV1, LocalServiceRoleV1,
    LOCAL_DERIVER_A_ED25519_YAO_BURN_PAIR_PATH, LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_PREPARE_PAIR_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH, LOCAL_DERIVER_B_ED25519_YAO_BURN_PAIR_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH, LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
    LOCAL_ROUTER_ED25519_YAO_RECOVERY_PROMOTE_PATH,
    LOCAL_SIGNING_WORKER_ED25519_YAO_ACTIVATION_PACKAGES_PATH,
    LOCAL_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_PATH,
    LOCAL_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH,
};

/// Native local equivalent of the private Router coordinator boundary.
///
/// The coordinator owns only authenticated routing metadata and opaque role
/// envelopes. Role workers retain all decrypted inputs and cryptographic state.
#[derive(Debug, Clone, Default)]
pub struct LocalRouterEd25519YaoCoordinatorV1 {
    client: LocalHttpServiceBindingClientV1,
}

impl LocalRouterEd25519YaoCoordinatorV1 {
    /// Answers one Gateway execute request with the Router's JSON answer. A
    /// registration is claimed in the Router's wallet object first, and its
    /// terminal answer recorded there, under the claim generation the run
    /// holds, before the reply: an exact retry gets that answer, byte for
    /// byte, and a retry after a claim's lease lapses takes the claim over and
    /// replays the run on the request the claim pinned. A run whose claim was
    /// taken over is answered that the execution is in progress.
    fn execute(
        &self,
        config: &LocalRouterWorkerConfigV1,
        body: &[u8],
        replay: bool,
    ) -> RouterAbProtocolResult<String> {
        let envelope = serde_json::from_slice::<CloudflareRouterEd25519YaoExecuteRequestV2>(body)
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("local Router Ed25519 Yao execute request is malformed: {error}"),
                )
            })?;
        let Some(registration) = RouterWalletRegistrationV1::from_request(&envelope)? else {
            return answer_json(&self.run_execution(config, body, replay)?);
        };
        if replay {
            return Err(router_ab_cloudflare::router_wallet_registration_replay_refused_v1());
        }
        let storage_path = &config.tenant_root.creation_storage_path;
        let answer = match crate::local_router_wallet::serve_local_router_wallet_v1(
            storage_path,
            registration.claim(
                local_now_ms_v1()?,
                router_ab_cloudflare::parse_router_yao_registration_lease_ms_v1(
                    &config.tenant_root.env,
                )?,
            ),
        )? {
            RouterWalletResponseV1::Run {
                request_json,
                replay,
                generation,
            } => {
                let result = self.run_execution(config, request_json.as_bytes(), replay)?;
                let Some(finish) = registration.finish(&result, generation, local_now_ms_v1()?)?
                else {
                    return answer_json(&result);
                };
                crate::local_router_wallet::serve_local_router_wallet_v1(storage_path, finish)?
            }
            answer => answer,
        };
        match answer {
            RouterWalletResponseV1::Answered { response_json } => Ok(response_json),
            RouterWalletResponseV1::InProgress { retry_after_ms } => {
                answer_json(&RouterEd25519YaoExecuteResultV1::recoverable(
                    RouterEd25519YaoExecuteFailureCodeV1::ExecutionInProgress,
                    retry_after_ms,
                )?)
            }
            RouterWalletResponseV1::Mismatch => {
                answer_json(&RouterEd25519YaoExecuteResultV1::rejected(
                    RouterEd25519YaoExecuteFailureCodeV1::ExecutionMismatch,
                ))
            }
            _ => Err(coordinator_error(
                "Router wallet object answered a registration execute with another command's response",
            )),
        }
    }

    /// Consumes one completed registration's activation for one finalization.
    fn consume_registration(
        &self,
        config: &LocalRouterWorkerConfigV1,
        body: &[u8],
    ) -> RouterAbProtocolResult<RouterWalletResponseV1> {
        let request = serde_json::from_slice::<CloudflareRouterEd25519YaoRegistrationConsumeRequestV1>(
            body,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("local Router registration consume request is malformed: {error}"),
            )
        })?;
        request.tenant_root.resolve()?;
        crate::local_router_wallet::serve_local_router_wallet_v1(
            &config.tenant_root.creation_storage_path,
            request.into_wallet_request(),
        )
    }

    fn run_execution(
        &self,
        config: &LocalRouterWorkerConfigV1,
        body: &[u8],
        replay: bool,
    ) -> RouterAbProtocolResult<RouterEd25519YaoExecuteResultV1> {
        let now_ms = local_now_ms_v1()?;
        let request = decode_local_router_ed25519_yao_execute_request_v1(
            body,
            local_recipient_set_digest_v1(config)?,
            now_ms,
            now_ms.saturating_add(ROUTER_AUTHORITY_TTL_MS),
            &config.tenant_root,
        )?;
        request.authority.validate_at(now_ms)?;
        // Only a run that took over a lapsed claim reconciles a prior run
        // before preparing; a first run goes straight to pair preparation.
        if replay {
            if let Some(replayed) = self.reconcile_completed_registration(
                config,
                &request.binding,
                &request.pair_binding,
                &request.tenant_root.identity,
            )? {
                return Ok(replayed);
            }
        }
        let pair = request.pair_binding.clone();
        let prepare_a = CloudflareEd25519YaoPairPrepareRequestV1 {
            pair_binding: pair.clone(),
            tenant_root: request.tenant_root.clone(),
            work: request.work.clone(),
            input: request.deriver_a_input.clone(),
        };
        let prepare_b = CloudflareEd25519YaoPairPrepareRequestV1 {
            pair_binding: pair.clone(),
            tenant_root: request.tenant_root.clone(),
            work: request.work.clone(),
            input: request.deriver_b_input.clone(),
        };
        let (receipt_a, receipt_b) = match self.prepare_pair(config, prepare_a, prepare_b) {
            Ok(receipts) => receipts,
            Err(_) => {
                if let Some(replayed) = self.reconcile_completed_registration(
                    config,
                    &request.binding,
                    &request.pair_binding,
                    &request.tenant_root.identity,
                )? {
                    return Ok(replayed);
                }
                self.burn_pair(config, &pair);
                return RouterEd25519YaoExecuteResultV1::recoverable(
                    RouterEd25519YaoExecuteFailureCodeV1::ServiceUnavailable,
                    1_000,
                );
            }
        };
        let readiness_now_ms = local_now_ms_v1()?;
        if router_ab_cloudflare::validate_router_ed25519_yao_readiness_v1(
            &receipt_a,
            &pair,
            readiness_now_ms,
            Ed25519YaoDeriverRoleV1::DeriverA,
            &config.peer_verifying_keys,
        )
        .is_err()
            || router_ab_cloudflare::validate_router_ed25519_yao_readiness_v1(
                &receipt_b,
                &pair,
                readiness_now_ms,
                Ed25519YaoDeriverRoleV1::DeriverB,
                &config.peer_verifying_keys,
            )
            .is_err()
        {
            self.burn_pair(config, &pair);
            return Ok(RouterEd25519YaoExecuteResultV1::burned(
                execution_id_for_pair(&pair)?,
                router_ab_core::RouterEd25519YaoBurnReasonV1::ProtocolFailure,
            ));
        }
        let execution = match self
            .client
            .post_json_authenticated_v1::<_, CloudflareEd25519YaoPairExecuteResponseV1>(
                &config.deriver_a_url,
                LocalServiceRoleV1::DeriverA,
                LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
                &config.internal_service_auth,
                &CloudflareEd25519YaoPairExecuteRequestV1 {
                    pair_binding: pair.clone(),
                    tenant_root: request.tenant_root.clone(),
                    work: request.work.clone(),
                    input: request.deriver_a_input.clone(),
                    local_receipt: receipt_a,
                    peer_receipt: receipt_b,
                },
            ) {
            Ok(execution) => execution,
            Err(_) => {
                if let Some(replayed) = self.reconcile_completed_registration(
                    config,
                    &request.binding,
                    &request.pair_binding,
                    &request.tenant_root.identity,
                )? {
                    return Ok(replayed);
                }
                self.burn_pair(config, &pair);
                return Ok(RouterEd25519YaoExecuteResultV1::burned(
                    execution_id_for_pair(&pair)?,
                    router_ab_core::RouterEd25519YaoBurnReasonV1::PeerUncertain,
                ));
            }
        };
        if router_ab_cloudflare::validate_router_ed25519_yao_role_execution_v1(
            &execution.deriver_a_execution,
            Ed25519YaoDeriverRoleV1::DeriverA,
            &request.binding,
            None,
        )
        .is_err()
        {
            self.burn_pair(config, &pair);
            return Ok(RouterEd25519YaoExecuteResultV1::burned(
                execution_id_for_pair(&pair)?,
                router_ab_core::RouterEd25519YaoBurnReasonV1::ProtocolFailure,
            ));
        }
        let completed = match serde_json::from_str::<Ed25519YaoRoleExecutionV1>(
            &execution.deriver_b_sealed_execution_json,
        ) {
            Ok(execution) => execution,
            Err(_) => {
                self.burn_pair(config, &pair);
                return Ok(RouterEd25519YaoExecuteResultV1::burned(
                    execution_id_for_pair(&pair)?,
                    router_ab_core::RouterEd25519YaoBurnReasonV1::ProtocolFailure,
                ));
            }
        };
        if router_ab_cloudflare::validate_router_ed25519_yao_role_execution_v1(
            &completed,
            Ed25519YaoDeriverRoleV1::DeriverB,
            &request.binding,
            Some(router_ab_cloudflare::ed25519_yao_role_execution_transcript_v1(
                &execution.deriver_a_execution,
            )),
        )
        .is_err()
        {
            self.burn_pair(config, &pair);
            return Ok(RouterEd25519YaoExecuteResultV1::burned(
                execution_id_for_pair(&pair)?,
                router_ab_core::RouterEd25519YaoBurnReasonV1::ProtocolFailure,
            ));
        }
        match self.finalize(config, &request, execution.deriver_a_execution, completed) {
            Ok(result) => Ok(result),
            Err(_) => {
                if let Some(replayed) = self.reconcile_completed_registration(
                    config,
                    &request.binding,
                    &request.pair_binding,
                    &request.tenant_root.identity,
                )? {
                    return Ok(replayed);
                }
                self.burn_pair(config, &pair);
                Ok(RouterEd25519YaoExecuteResultV1::burned(
                    execution_id_for_pair(&pair)?,
                    router_ab_core::RouterEd25519YaoBurnReasonV1::ProtocolFailure,
                ))
            }
        }
    }

    fn promote_recovery(
        &self,
        config: &LocalRouterWorkerConfigV1,
        body: &[u8],
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerActivationReceiptV1> {
        let request =
            serde_json::from_slice::<LocalRouterEd25519YaoRecoveryPromotionRequestV1>(body)
                .map_err(|error| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("local Router recovery promotion request is malformed: {error}"),
                    )
                })?;
        request.binding.validate()?;
        request.tenant_root.coordinates()?;
        if request.binding.operation != Ed25519YaoOperationV1::Recovery {
            return Err(coordinator_error(
                "Router recovery promotion requires a recovery binding",
            ));
        }
        let promotion = LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1 {
            binding: request.binding.clone(),
            session: request.binding.session_id.into_bytes(),
            transcript: request.public_receipt.transcript(),
            registered_public_key: request.public_receipt.registered_public_key(),
            joined_client_commitment: request.public_receipt.joined_client_commitment(),
            joined_signing_worker_commitment: request
                .public_receipt
                .joined_signing_worker_commitment(),
            signing_worker_verifying_share: request.public_receipt.signing_worker_verifying_share(),
            state_epoch: request.public_receipt.state_epoch(),
        };
        let receipt = self
            .client
            .post_json_authenticated_v1::<_, LocalEd25519YaoSigningWorkerActivationReceiptV1>(
                &config.signing_worker_url,
                LocalServiceRoleV1::SigningWorker,
                LOCAL_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH,
                &config.internal_service_auth,
                &promotion,
            )?;
        validate_recovery_promotion_receipt(&request, &receipt)?;
        Ok(receipt)
    }

    fn prepare_pair(
        &self,
        config: &LocalRouterWorkerConfigV1,
        prepare_a: CloudflareEd25519YaoPairPrepareRequestV1,
        prepare_b: CloudflareEd25519YaoPairPrepareRequestV1,
    ) -> RouterAbProtocolResult<(
        router_ab_core::Ed25519YaoRoleReadinessReceiptV1,
        router_ab_core::Ed25519YaoRoleReadinessReceiptV1,
    )> {
        let client = Arc::new(self.client.clone());
        let auth = config.internal_service_auth.clone();
        let auth_b = auth.clone();
        let url_a = config.deriver_a_url.clone();
        let url_b = config.deriver_b_url.clone();
        std::thread::scope(|scope| {
            let client_a = Arc::clone(&client);
            let client_b = Arc::clone(&client);
            let a = scope.spawn(move || {
                client_a.post_json_authenticated_v1(
                    &url_a,
                    LocalServiceRoleV1::DeriverA,
                    LOCAL_DERIVER_A_ED25519_YAO_PREPARE_PAIR_PATH,
                    &auth,
                    &prepare_a,
                )
            });
            let b = scope.spawn(move || {
                client_b.post_json_authenticated_v1(
                    &url_b,
                    LocalServiceRoleV1::DeriverB,
                    LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
                    &auth_b,
                    &prepare_b,
                )
            });
            let receipt_a = a
                .join()
                .map_err(|_| coordinator_error("Deriver A preparation thread panicked"))??;
            let receipt_b = b
                .join()
                .map_err(|_| coordinator_error("Deriver B preparation thread panicked"))??;
            Ok((receipt_a, receipt_b))
        })
    }

    fn reconcile_completed_registration(
        &self,
        config: &LocalRouterWorkerConfigV1,
        binding: &Ed25519YaoCeremonyBindingV1,
        pair_binding: &Ed25519YaoInputPairBindingV1,
        root_identity: &TenantRootIdentityV1,
    ) -> RouterAbProtocolResult<Option<RouterEd25519YaoExecuteResultV1>> {
        if !matches!(
            binding.operation,
            Ed25519YaoOperationV1::Registration | Ed25519YaoOperationV1::Recovery
        ) {
            return Ok(None);
        }
        let lookup = CloudflareEd25519YaoPairLookupRequestV1 {
            session: pair_binding.session(),
            pair_digest: pair_binding.pair_digest().bytes,
        };
        let status_a = self
            .client
            .post_json_authenticated_v1::<_, CloudflareEd25519YaoPairStatusResponseV1>(
                &config.deriver_a_url,
                LocalServiceRoleV1::DeriverA,
                LOCAL_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH,
                &config.internal_service_auth,
                &lookup,
            );
        let status_b = self
            .client
            .post_json_authenticated_v1::<_, CloudflareEd25519YaoPairStatusResponseV1>(
                &config.deriver_b_url,
                LocalServiceRoleV1::DeriverB,
                LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH,
                &config.internal_service_auth,
                &lookup,
            );
        let (status_a, status_b) = match (status_a, status_b) {
            (Ok(a), Ok(b)) => (a, b),
            _ => {
                return RouterEd25519YaoExecuteResultV1::recoverable(
                    RouterEd25519YaoExecuteFailureCodeV1::ServiceUnavailable,
                    1_000,
                )
                .map(Some)
            }
        };
        match (status_a, status_b) {
            (
                CloudflareEd25519YaoPairStatusResponseV1::Completed {
                    execution: execution_a,
                },
                CloudflareEd25519YaoPairStatusResponseV1::Completed {
                    execution: execution_b,
                },
            ) => {
                router_ab_cloudflare::validate_router_ed25519_yao_role_execution_v1(
                    &execution_a,
                    Ed25519YaoDeriverRoleV1::DeriverA,
                    binding,
                    None,
                )?;
                router_ab_cloudflare::validate_router_ed25519_yao_role_execution_v1(
                    &execution_b,
                    Ed25519YaoDeriverRoleV1::DeriverB,
                    binding,
                    Some(router_ab_cloudflare::ed25519_yao_role_execution_transcript_v1(
                        &execution_a,
                    )),
                )?;
                let a = router_ab_cloudflare::ed25519_yao_activation_role_execution_v1(&execution_a)?;
                let b = router_ab_cloudflare::ed25519_yao_activation_role_execution_v1(&execution_b)?;
                let delivery = activation_delivery(root_identity, binding, a, b)?;
                if binding.operation == Ed25519YaoOperationV1::Recovery {
                    // As on Workers: the same packages go to the SigningWorker
                    // again, which answers a delivery it already staged.
                    let receipt = match self.client.post_json_authenticated_v1::<_, LocalEd25519YaoSigningWorkerActivationReceiptV1>(
                        &config.signing_worker_url,
                        LocalServiceRoleV1::SigningWorker,
                        LOCAL_SIGNING_WORKER_ED25519_YAO_ACTIVATION_PACKAGES_PATH,
                        &config.internal_service_auth,
                        &delivery,
                    ) {
                        Ok(receipt) => receipt,
                        Err(_) => {
                            return RouterEd25519YaoExecuteResultV1::recoverable(
                                RouterEd25519YaoExecuteFailureCodeV1::SigningWorkerUncertain,
                                1_000,
                            )
                            .map(Some)
                        }
                    };
                    let public_receipt = activation_public_receipt(
                        receipt,
                        Ed25519YaoOperationV1::Recovery,
                        binding.material_activation().clone(),
                    )?;
                    let result = RouterAbEd25519YaoActivationResultV1::new(
                        binding.clone(),
                        a.client_package.clone(),
                        b.client_package.clone(),
                        public_receipt,
                    )?;
                    return Ok(Some(RouterEd25519YaoExecuteResultV1::succeeded(
                        RouterEd25519YaoExecuteSuccessV1::recovery(result)?,
                    )));
                }
                let finalization = self.client.post_json_authenticated_v1::<_, LocalEd25519YaoInitialRegistrationFinalizationV1>(
                    &config.signing_worker_url,
                    LocalServiceRoleV1::SigningWorker,
                    LOCAL_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_PATH,
                    &config.internal_service_auth,
                    &delivery,
                );
                let finalization = match finalization {
                    Ok(finalization) => finalization,
                    Err(_) => {
                        return RouterEd25519YaoExecuteResultV1::recoverable(
                            RouterEd25519YaoExecuteFailureCodeV1::SigningWorkerUncertain,
                            1_000,
                        )
                        .map(Some)
                    }
                };
                match finalization {
                    LocalEd25519YaoInitialRegistrationFinalizationV1::Committed { receipt } => {
                        let public_receipt = activation_public_receipt(
                            receipt,
                            Ed25519YaoOperationV1::Registration,
                            binding.material_activation().clone(),
                        )?;
                        let result = RouterAbEd25519YaoActivationResultV1::new(
                            binding.clone(),
                            a.client_package.clone(),
                            b.client_package.clone(),
                            public_receipt,
                        )?;
                        Ok(Some(RouterEd25519YaoExecuteResultV1::succeeded(
                            RouterEd25519YaoExecuteSuccessV1::registration(result)?,
                        )))
                    }
                    LocalEd25519YaoInitialRegistrationFinalizationV1::Missing
                    | LocalEd25519YaoInitialRegistrationFinalizationV1::Pending => {
                        RouterEd25519YaoExecuteResultV1::recoverable(
                            RouterEd25519YaoExecuteFailureCodeV1::SigningWorkerUncertain,
                            1_000,
                        )
                        .map(Some)
                    }
                    LocalEd25519YaoInitialRegistrationFinalizationV1::Revoked => {
                        Ok(Some(RouterEd25519YaoExecuteResultV1::rejected(
                            RouterEd25519YaoExecuteFailureCodeV1::AuthorizationRejected,
                        )))
                    }
                    LocalEd25519YaoInitialRegistrationFinalizationV1::Conflict => {
                        Ok(Some(RouterEd25519YaoExecuteResultV1::rejected(
                            RouterEd25519YaoExecuteFailureCodeV1::ConflictingPair,
                        )))
                    }
                }
            }
            (
                CloudflareEd25519YaoPairStatusResponseV1::Missing { .. }
                | CloudflareEd25519YaoPairStatusResponseV1::Prepared { .. },
                CloudflareEd25519YaoPairStatusResponseV1::Missing { .. }
                | CloudflareEd25519YaoPairStatusResponseV1::Prepared { .. },
            ) => Ok(None),
            (CloudflareEd25519YaoPairStatusResponseV1::Burned { .. }, _)
            | (_, CloudflareEd25519YaoPairStatusResponseV1::Burned { .. }) => {
                Ok(Some(RouterEd25519YaoExecuteResultV1::burned(
                    execution_id_for_pair(pair_binding)?,
                    router_ab_core::RouterEd25519YaoBurnReasonV1::PeerUncertain,
                )))
            }
            (CloudflareEd25519YaoPairStatusResponseV1::Expired { .. }, _)
            | (_, CloudflareEd25519YaoPairStatusResponseV1::Expired { .. }) => {
                RouterEd25519YaoExecuteResultV1::recoverable(
                    RouterEd25519YaoExecuteFailureCodeV1::CeremonyExpired,
                    1_000,
                )
                .map(Some)
            }
            // A pair running, or completed on one side only, when its run is
            // presumed dead is burned, as the role-store Workers Router burns
            // it: each role keeps its own record, so no role settles the pair
            // for the other. A registration then fails for good, and a
            // recovery goes on with a new attempt.
            _ => {
                self.burn_pair(config, pair_binding);
                Ok(Some(RouterEd25519YaoExecuteResultV1::burned(
                    execution_id_for_pair(pair_binding)?,
                    router_ab_core::RouterEd25519YaoBurnReasonV1::PeerUncertain,
                )))
            }
        }
    }

    fn burn_pair(
        &self,
        config: &LocalRouterWorkerConfigV1,
        pair: &router_ab_core::Ed25519YaoInputPairBindingV1,
    ) {
        let request = CloudflareEd25519YaoPairLookupRequestV1 {
            session: pair.session(),
            pair_digest: pair.pair_digest().bytes,
        };
        let _ = self.client.post_json_authenticated_v1::<_, router_ab_cloudflare::CloudflareEd25519YaoPairStatusResponseV1>(
            &config.deriver_a_url,
            LocalServiceRoleV1::DeriverA,
            LOCAL_DERIVER_A_ED25519_YAO_BURN_PAIR_PATH,
            &config.internal_service_auth,
            &request,
        );
        let _ = self.client.post_json_authenticated_v1::<_, router_ab_cloudflare::CloudflareEd25519YaoPairStatusResponseV1>(
            &config.deriver_b_url,
            LocalServiceRoleV1::DeriverB,
            LOCAL_DERIVER_B_ED25519_YAO_BURN_PAIR_PATH,
            &config.internal_service_auth,
            &request,
        );
    }

    fn finalize(
        &self,
        config: &LocalRouterWorkerConfigV1,
        request: &super::LocalRouterEd25519YaoPairDispatchV1,
        execution_a: Ed25519YaoRoleExecutionV1,
        execution_b: Ed25519YaoRoleExecutionV1,
    ) -> RouterAbProtocolResult<RouterEd25519YaoExecuteResultV1> {
        match request.operation {
            Ed25519YaoOperationV1::Registration | Ed25519YaoOperationV1::Recovery => {
                let a = router_ab_cloudflare::ed25519_yao_activation_role_execution_v1(&execution_a)?;
                let b = router_ab_cloudflare::ed25519_yao_activation_role_execution_v1(&execution_b)?;
                let delivery =
                    activation_delivery(&request.tenant_root.identity, &request.binding, a, b)?;
                let receipt = self.client.post_json_authenticated_v1::<_, LocalEd25519YaoSigningWorkerActivationReceiptV1>(
                    &config.signing_worker_url,
                    LocalServiceRoleV1::SigningWorker,
                    LOCAL_SIGNING_WORKER_ED25519_YAO_ACTIVATION_PACKAGES_PATH,
                    &config.internal_service_auth,
                    &delivery,
                )?;
                let public_receipt = activation_public_receipt(
                    receipt,
                    request.operation,
                    request.binding.material_activation().clone(),
                )?;
                let result = RouterAbEd25519YaoActivationResultV1::new(
                    request.binding.clone(),
                    a.client_package.clone(),
                    b.client_package.clone(),
                    public_receipt,
                )?;
                let success = match request.operation {
                    Ed25519YaoOperationV1::Registration => {
                        RouterEd25519YaoExecuteSuccessV1::registration(result)?
                    }
                    Ed25519YaoOperationV1::Recovery => {
                        RouterEd25519YaoExecuteSuccessV1::recovery(result)?
                    }
                    Ed25519YaoOperationV1::Refresh
                    | Ed25519YaoOperationV1::Export
                    | Ed25519YaoOperationV1::LaneProvisioning
                    | Ed25519YaoOperationV1::LaneRefresh => {
                        unreachable!("activation branch excludes non-activation operations")
                    }
                };
                Ok(RouterEd25519YaoExecuteResultV1::succeeded(success))
            }
            Ed25519YaoOperationV1::Export => {
                let export_binding = request
                    .export_binding
                    .clone()
                    .ok_or_else(|| coordinator_error("export binding is missing"))?;
                let a = router_ab_cloudflare::ed25519_yao_export_role_execution_v1(&execution_a)?;
                let b = router_ab_cloudflare::ed25519_yao_export_role_execution_v1(&execution_b)?;
                let result = RouterAbEd25519YaoExportResultV1::new(
                    export_binding,
                    a.transcript,
                    a.client_package.clone(),
                    b.client_package.clone(),
                )?;
                Ok(RouterEd25519YaoExecuteResultV1::succeeded(
                    RouterEd25519YaoExecuteSuccessV1::export(result)?,
                ))
            }
            Ed25519YaoOperationV1::Refresh => Err(coordinator_error(
                "Refresh is not an admitted Yao operation",
            )),
            Ed25519YaoOperationV1::LaneProvisioning | Ed25519YaoOperationV1::LaneRefresh => Err(
                coordinator_error("legacy local Router HTTP cannot durably commit lane material"),
            ),
        }
    }
}

fn local_recipient_set_digest_v1(
    config: &LocalRouterWorkerConfigV1,
) -> RouterAbProtocolResult<router_ab_core::PublicDigest32> {
    ed25519_yao_recipient_set_digest_v1(
        local_x25519_public_key_v1(
            &config.deriver_a_ed25519_yao_input_public_key,
            "Deriver A input public key",
        )?,
        local_x25519_public_key_v1(
            &config.deriver_b_ed25519_yao_input_public_key,
            "Deriver B input public key",
        )?,
        local_x25519_public_key_v1(
            &config.signing_worker_ed25519_yao_recipient_public_key,
            "SigningWorker recipient public key",
        )?,
    )
}

fn local_x25519_public_key_v1(
    value: &str,
    label: &'static str,
) -> RouterAbProtocolResult<[u8; 32]> {
    let encoded = value.strip_prefix("x25519:").ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} must use x25519:<hex> encoding"),
        )
    })?;
    let bytes = hex::decode(encoded).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} must be hex: {error}"),
        )
    })?;
    bytes.try_into().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} must contain 32 bytes"),
        )
    })
}

impl LocalRouterRequestDispatcherV1 for LocalRouterEd25519YaoCoordinatorV1 {
    fn dispatch(
        &self,
        config: &LocalRouterWorkerConfigV1,
        request: &LocalDevHttpRequestPartsV1,
    ) -> Result<Option<(u16, String)>, Box<dyn std::error::Error>> {
        if crate::local_router_normal_signing::is_local_router_normal_signing_path_v1(&request.path)
        {
            return match crate::local_router_normal_signing::serve_local_router_normal_signing_v1(
                &self.client,
                config,
                request,
            ) {
                Ok(body) => Ok(Some((200, body))),
                Err(error) => Ok(Some(local_dev_http_route_error_v1(
                    LocalServiceRoleV1::Router,
                    &request.path,
                    error,
                )?)),
            };
        }
        if request.path
            == router_ab_cloudflare::CLOUDFLARE_ROUTER_ED25519_YAO_REGISTRATION_CONSUME_PRIVATE_REQUEST_PATH
        {
            return match self.consume_registration(config, &request.body) {
                Ok(response) => Ok(Some((200, serde_json::to_string(&response)?))),
                Err(error) => Ok(Some(local_dev_http_route_error_v1(
                    LocalServiceRoleV1::Router,
                    &request.path,
                    error,
                )?)),
            };
        }
        if request.path != LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH {
            if request.path != LOCAL_ROUTER_ED25519_YAO_RECOVERY_PROMOTE_PATH {
                return Ok(None);
            }
            return match self.promote_recovery(config, &request.body) {
                Ok(receipt) => Ok(Some((200, serde_json::to_string(&receipt)?))),
                Err(error) => Ok(Some(local_dev_http_route_error_v1(
                    LocalServiceRoleV1::Router,
                    &request.path,
                    error,
                )?)),
            };
        }
        let replay = match router_ab_cloudflare::parse_router_ed25519_yao_replay_header_v1(
            request.yao_replay.as_deref(),
        ) {
            Ok(replay) => replay,
            Err(error) => {
                return Ok(Some(local_dev_http_route_error_v1(
                    LocalServiceRoleV1::Router,
                    &request.path,
                    error,
                )?))
            }
        };
        match self.execute(config, &request.body, replay) {
            Ok(body) => Ok(Some((200, body))),
            Err(error) => Ok(Some(local_dev_http_route_error_v1(
                LocalServiceRoleV1::Router,
                &request.path,
                error,
            )?)),
        }
    }
}

fn answer_json(result: &RouterEd25519YaoExecuteResultV1) -> RouterAbProtocolResult<String> {
    serde_json::to_string(result).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            format!("Router Yao execute answer is not encodable: {error}"),
        )
    })
}

fn validate_recovery_promotion_receipt(
    request: &LocalRouterEd25519YaoRecoveryPromotionRequestV1,
    receipt: &LocalEd25519YaoSigningWorkerActivationReceiptV1,
) -> RouterAbProtocolResult<()> {
    let LocalEd25519YaoSigningWorkerActivationReceiptV1::Active {
        session,
        transcript,
        registered_public_key,
        joined_client_commitment,
        joined_signing_worker_commitment,
        signing_worker_verifying_share,
        state_epoch,
    } = receipt
    else {
        return Err(coordinator_error(
            "recovery promotion requires an Active SigningWorker receipt",
        ));
    };
    let expected_session = request.binding.session_id.into_bytes();
    let public_receipt = &request.public_receipt;
    if *session != expected_session
        || *transcript != public_receipt.transcript()
        || *registered_public_key != public_receipt.registered_public_key()
        || *joined_client_commitment != public_receipt.joined_client_commitment()
        || *joined_signing_worker_commitment != public_receipt.joined_signing_worker_commitment()
        || *signing_worker_verifying_share != public_receipt.signing_worker_verifying_share()
        || *state_epoch != public_receipt.state_epoch()
    {
        return Err(coordinator_error(
            "recovery promotion receipt does not match the verified recovery result",
        ));
    }
    Ok(())
}

fn package_delivery(
    execution: &Ed25519YaoActivationRoleExecutionV1,
) -> LocalEd25519YaoSigningWorkerPackageDeliveryV1 {
    LocalEd25519YaoSigningWorkerPackageDeliveryV1 {
        binding: execution.binding.clone(),
        client_commitment: execution.client_commitment,
        signing_worker_commitment: execution.signing_worker_commitment,
        package: execution.signing_worker_package.clone(),
    }
}

fn activation_delivery(
    root_identity: &TenantRootIdentityV1,
    binding: &Ed25519YaoCeremonyBindingV1,
    a: &Ed25519YaoActivationRoleExecutionV1,
    b: &Ed25519YaoActivationRoleExecutionV1,
) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerPackagePairDeliveryV1> {
    Ok(LocalEd25519YaoSigningWorkerPackagePairDeliveryV1 {
        scope: router_ab_cloudflare::CloudflareSigningWorkerWalletScopeV1::from_tenant_root(
            root_identity,
            &binding.lifecycle.account_id,
        )?,
        deriver_a: package_delivery(a),
        deriver_b: package_delivery(b),
        deriver_a_client_package: a.client_package.clone(),
        deriver_b_client_package: b.client_package.clone(),
    })
}

fn activation_public_receipt(
    receipt: LocalEd25519YaoSigningWorkerActivationReceiptV1,
    operation: Ed25519YaoOperationV1,
    material_activation: router_ab_core::MpcMaterialActivationRefV1,
) -> RouterAbProtocolResult<RouterAbEd25519YaoActivationPublicReceiptV1> {
    let (
        status_operation,
        transcript,
        registered_public_key,
        joined_client_commitment,
        joined_signing_worker_commitment,
        signing_worker_verifying_share,
        state_epoch,
    ) = match receipt {
        LocalEd25519YaoSigningWorkerActivationReceiptV1::Active {
            session: _,
            transcript,
            registered_public_key,
            joined_client_commitment,
            joined_signing_worker_commitment,
            signing_worker_verifying_share,
            state_epoch,
        } => (
            Ed25519YaoOperationV1::Registration,
            transcript,
            registered_public_key,
            joined_client_commitment,
            joined_signing_worker_commitment,
            signing_worker_verifying_share,
            state_epoch,
        ),
        LocalEd25519YaoSigningWorkerActivationReceiptV1::Staged { promotion } => (
            Ed25519YaoOperationV1::Recovery,
            promotion.transcript,
            promotion.registered_public_key,
            promotion.joined_client_commitment,
            promotion.joined_signing_worker_commitment,
            promotion.signing_worker_verifying_share,
            promotion.state_epoch,
        ),
    };
    if status_operation != operation {
        return Err(coordinator_error(
            "SigningWorker receipt status does not match the admitted operation",
        ));
    }
    RouterAbEd25519YaoActivationPublicReceiptV1::new(
        transcript,
        registered_public_key,
        joined_client_commitment,
        joined_signing_worker_commitment,
        signing_worker_verifying_share,
        state_epoch,
        material_activation,
    )
}

fn execution_id_for_pair(
    pair: &router_ab_core::Ed25519YaoInputPairBindingV1,
) -> RouterAbProtocolResult<router_ab_core::Ed25519YaoExecutionIdV1> {
    router_ab_core::Ed25519YaoExecutionIdV1::new(pair.pair_digest().bytes)
}

pub(crate) fn local_now_ms_v1() -> RouterAbProtocolResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .map_err(|_| coordinator_error("local system clock predates the Unix epoch"))
}

fn coordinator_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

#[cfg(test)]
mod tests {
    use crate::LocalRouterTenantRootConfigV1;

    use super::*;

    /// Router admission bindings for in-module fixtures.
    fn fixture_admission_bindings() -> router_ab_cloudflare::CloudflareRouterAdmissionBindingsV1 {
        router_ab_cloudflare::CloudflareRouterAdmissionBindingsV1::new(
            router_ab_cloudflare::CloudflareRouterJwtVerifierBindingV1::new(
                "http://127.0.0.1:4100",
                "router-ab",
                r#"{"keys":[{"alg":"EdDSA","crv":"Ed25519","kid":"local-router-ab-r1","kty":"OKP","use":"sig","x":"-AzM3OSuHAeuIIoq35mjEK5CB-Awb6AjYRCwaCe7uNA"}]}"#,
            )
            .expect("fixture JWT binding"),
            router_ab_cloudflare::CloudflareRouterProjectPolicyBindingV1::AllowAll,
        )
        .expect("fixture admission bindings")
    }

    /// Deterministic peer verifying keys for in-module Router fixtures.
    fn fixture_peer_verifying_keys() -> router_ab_cloudflare::CloudflareSignerPeerVerifyingKeySetV1 {
        let key = |seed: u8, role: router_ab_core::Role| {
            router_ab_cloudflare::CloudflareSignerPeerVerifyingKeyBytesV1::new(
                role,
                ed25519_dalek::SigningKey::from_bytes(&[seed; 32])
                    .verifying_key()
                    .to_bytes(),
            )
            .expect("fixture verifying key")
        };
        router_ab_cloudflare::CloudflareSignerPeerVerifyingKeySetV1::new(
            key(1, router_ab_core::Role::SignerA),
            key(2, router_ab_core::Role::SignerB),
        )
        .expect("fixture verifying key set")
    }
    use crate::LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1;
    use router_ab_core::{
        Ed25519YaoSessionIdV1, Ed25519YaoStableKeyContextBindingV1, ExpensiveWorkKindV1,
        LifecycleScopeV1, RootShareEpoch,
    };
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn recovery_promotion_request() -> LocalRouterEd25519YaoRecoveryPromotionRequestV1 {
        let lifecycle = LifecycleScopeV1::new(
            "local-coordinator",
            ExpensiveWorkKindV1::Recovery,
            RootShareEpoch::new("local-root").expect("root epoch"),
            "local-account",
            "local-session",
            "local-signer-set",
            "local-worker",
        )
        .expect("lifecycle");
        let material_activation = router_ab_core::MpcMaterialActivationRefV1::new(
            "activation-1",
            "capability-1",
            "local-account",
            "key-1",
            "local-coordinator",
            "local-worker",
        )
        .expect("material activation");
        let binding = router_ab_core::Ed25519YaoCeremonyBindingV1::new(
            lifecycle,
            Ed25519YaoOperationV1::Recovery,
            Ed25519YaoSessionIdV1::new([0x11; 32]).expect("session"),
            Ed25519YaoStableKeyContextBindingV1::new([0x22; 32]),
            material_activation.clone(),
        )
        .expect("binding");
        let public_receipt = RouterAbEd25519YaoActivationPublicReceiptV1::new(
            [0x31; 32],
            [0x32; 32],
            [0x33; 32],
            [0x34; 32],
            [0x35; 32],
            router_ab_core::Ed25519YaoStateEpochV1::new(1).expect("state epoch"),
            material_activation,
        )
        .expect("public receipt");
        LocalRouterEd25519YaoRecoveryPromotionRequestV1 {
            binding,
            public_receipt,
            tenant_root: router_ab_cloudflare::CloudflareRouterEd25519YaoTenantRootV1 {
                identity: router_ab_core::TenantRootIdentityV1::new(
                    "org",
                    "project",
                    "env",
                    "local-root",
                    "v1",
                )
                .expect("root identity"),
                custody_lineage_b64u: "AQEBAQEBAQEBAQEBAQEBAQ".to_owned(),
            },
        }
    }

    fn active_promotion_receipt(
        request: &LocalRouterEd25519YaoRecoveryPromotionRequestV1,
    ) -> LocalEd25519YaoSigningWorkerActivationReceiptV1 {
        LocalEd25519YaoSigningWorkerActivationReceiptV1::Active {
            session: request.binding.session_id.into_bytes(),
            transcript: request.public_receipt.transcript(),
            registered_public_key: request.public_receipt.registered_public_key(),
            joined_client_commitment: request.public_receipt.joined_client_commitment(),
            joined_signing_worker_commitment: request
                .public_receipt
                .joined_signing_worker_commitment(),
            signing_worker_verifying_share: request.public_receipt.signing_worker_verifying_share(),
            state_epoch: request.public_receipt.state_epoch(),
        }
    }

    #[test]
    fn malformed_execute_body_is_rejected_before_any_role_call() {
        let error = decode_local_router_ed25519_yao_execute_request_v1(
            br#"{"operation":"registration","unknown":true}"#,
            router_ab_core::PublicDigest32::new([0xa1; 32]),
            1,
            100,
            &LocalRouterTenantRootConfigV1::default(),
        )
        .expect_err("malformed request must not reach a role");
        assert_eq!(
            error.code(),
            RouterAbProtocolErrorCode::MalformedWirePayload
        );
    }

    #[test]
    fn signing_worker_receipt_operation_mismatch_is_rejected() {
        let receipt = LocalEd25519YaoSigningWorkerActivationReceiptV1::Active {
            session: [1; 32],
            transcript: [2; 32],
            registered_public_key: [3; 32],
            joined_client_commitment: [4; 32],
            joined_signing_worker_commitment: [5; 32],
            signing_worker_verifying_share: [6; 32],
            state_epoch: router_ab_core::Ed25519YaoStateEpochV1::new(1).expect("epoch"),
        };
        let material_activation = router_ab_core::MpcMaterialActivationRefV1::new(
            "activation-1",
            "capability-1",
            "local-account",
            "key-1",
            "local-coordinator",
            "local-worker",
        )
        .expect("material activation");
        assert!(activation_public_receipt(
            receipt,
            Ed25519YaoOperationV1::Recovery,
            material_activation,
        )
        .is_err());
    }

    #[test]
    fn recovery_promotion_requires_exact_active_signing_worker_receipt() {
        let request = recovery_promotion_request();
        let receipt = active_promotion_receipt(&request);
        validate_recovery_promotion_receipt(&request, &receipt)
            .expect("matching active receipt should validate");

        let mut mismatched = receipt.clone();
        let LocalEd25519YaoSigningWorkerActivationReceiptV1::Active { transcript, .. } =
            &mut mismatched
        else {
            unreachable!();
        };
        transcript[0] ^= 1;
        assert!(validate_recovery_promotion_receipt(&request, &mismatched).is_err());

        let staged = LocalEd25519YaoSigningWorkerActivationReceiptV1::Staged {
            promotion: LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1 {
                binding: request.binding.clone(),
                session: request.binding.session_id.into_bytes(),
                transcript: request.public_receipt.transcript(),
                registered_public_key: request.public_receipt.registered_public_key(),
                joined_client_commitment: request.public_receipt.joined_client_commitment(),
                joined_signing_worker_commitment: request
                    .public_receipt
                    .joined_signing_worker_commitment(),
                signing_worker_verifying_share: request
                    .public_receipt
                    .signing_worker_verifying_share(),
                state_epoch: request.public_receipt.state_epoch(),
            },
        };
        assert!(validate_recovery_promotion_receipt(&request, &staged).is_err());
    }

    #[test]
    fn recovery_promotion_forwards_expanded_local_signing_worker_wire_shape() {
        let request = recovery_promotion_request();
        let receipt = active_promotion_receipt(&request);
        let expected_receipt = receipt.clone();
        let listener = TcpListener::bind("127.0.0.1:0").expect("fake SigningWorker listener");
        let signing_worker_url = format!(
            "http://{}",
            listener.local_addr().expect("listener address")
        );
        let server_receipt = receipt.clone();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("Router request");
            let mut request_bytes = Vec::new();
            stream
                .read_to_end(&mut request_bytes)
                .expect("read Router request");
            let request_text = String::from_utf8(request_bytes).expect("request is UTF-8");
            assert!(request_text.contains("/router-ab/signing-worker/ed25519-yao/recovery/promote"));
            assert!(request_text.contains("\"session\""));
            assert!(!request_text.contains("\"public_receipt\""));
            let body = serde_json::to_string(&server_receipt).expect("receipt JSON");
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write SigningWorker response");
        });
        let config = LocalRouterWorkerConfigV1 {
            public_url: "http://127.0.0.1:4102".to_owned(),
            deriver_a_url: "http://127.0.0.1:4103".to_owned(),
            deriver_b_url: "http://127.0.0.1:4104".to_owned(),
            signing_worker_url,
            deriver_a_ed25519_yao_input_public_key: "x25519:a".to_owned(),
            deriver_b_ed25519_yao_input_public_key: "x25519:b".to_owned(),
            signing_worker_ed25519_yao_recipient_public_key: "x25519:c".to_owned(),
            signing_worker_id: "local-signing-worker".to_owned(),
            internal_service_auth: "local-test-auth".to_owned(),
            gateway_to_router_auth: "local-test-gateway-auth".to_owned(),
            router_to_signing_worker_ecdsa_auth: "local-test-router-ecdsa-auth".to_owned(),
            peer_verifying_keys: fixture_peer_verifying_keys(),
            admission_bindings: fixture_admission_bindings(),
            tenant_root: LocalRouterTenantRootConfigV1::default(),
        };
        let body = serde_json::to_vec(&request).expect("promotion JSON");
        let promoted = LocalRouterEd25519YaoCoordinatorV1::default()
            .promote_recovery(&config, &body)
            .expect("promotion proxy");
        assert_eq!(promoted, expected_receipt);
        server.join().expect("fake SigningWorker server");
    }
}
