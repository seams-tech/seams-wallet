use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use router_ab_core::{
    PublicDigest32, RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningPrepareResponseV1,
    RouterAbEcdsaDerivationSignatureSchemeV1,
};
use router_ab_ecdsa_presign::session::{
    derive_presign_pair_context, PresignSessionEvent, PresignSessionStage,
    SigningWorkerPresignSession,
};
use router_ab_ecdsa_presign::AdditiveKeyShare;
use router_ab_ecdsa_wire::{CompressedPointBytes, ScalarBytes};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{
    durable_object_error_status, CloudflareSigningWorkerEcdsaPresignatureRecordV1,
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
};
use crate::{
    cloudflare_now_unix_ms_v1, decode_base64url_bytes_v1, decode_base64url_fixed_32_v1,
    decode_base64url_fixed_33_v1, encode_base64url_bytes_v1, require_non_empty,
    require_positive_ms, ActiveSigningWorkerStateV1, CloudflareSignerProofGetrandomRngV1,
    CloudflareSigningWorkerEcdsaPresignRequestedStageV1,
    CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
    CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1,
    CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1,
    CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionStepRequestV1,
    CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1,
    RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1,
    RouterAbEcdsaDerivationNormalSigningScopeV1,
    CLOUDFLARE_SIGNING_WORKER_ECDSA_PRESIGN_SESSION_DO_INIT_PATH,
    CLOUDFLARE_SIGNING_WORKER_ECDSA_PRESIGN_SESSION_DO_STEP_PATH,
    CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGNATURE_DO_CONSUME_PATH,
    CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGN_SESSION_DO_INIT_PATH,
    CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGN_SESSION_DO_STEP_PATH,
};

pub(super) struct CloudflareSigningWorkerEcdsaPresignLiveSessionV1 {
    scope: RouterAbEcdsaDerivationNormalSigningScopeV1,
    ceremony_expires_at_ms: u64,
    material_expires_at_ms: u64,
    session: SigningWorkerPresignSession,
}

pub(super) type CloudflareSigningWorkerEcdsaPresignLiveSessionsV1 =
    RefCell<BTreeMap<String, CloudflareSigningWorkerEcdsaPresignLiveSessionV1>>;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareSigningWorkerEcdsaPresignSessionDoInitRequestV1 {
    pub(crate) request: CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
    pub(crate) relayer_share32_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1 {
    Continue {
        presign_session_id: String,
        stage: String,
        event: String,
        outgoing_messages_b64u: Vec<String>,
    },
    Complete {
        outgoing_messages_b64u: Vec<String>,
        pool_put_request:
            CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1,
    },
}

pub(super) struct CloudflareSigningWorkerLinkedDeviceEcdsaPresignLiveSessionV1 {
    request: router_ab_core::RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningRequestV1,
    scope: RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1,
    expires_at_ms: u64,
    request_digest: router_ab_core::PublicDigest32,
    signing_digest: router_ab_core::PublicDigest32,
    active_signing_worker_state: ActiveSigningWorkerStateV1,
    session: SigningWorkerPresignSession,
}

pub(super) type CloudflareSigningWorkerLinkedDeviceEcdsaPresignLiveSessionsV1 =
    RefCell<BTreeMap<String, CloudflareSigningWorkerLinkedDeviceEcdsaPresignLiveSessionV1>>;

pub(super) type CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordsV1 = RefCell<
    BTreeMap<String, CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1>,
>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1 {
    /// Session id used to replay the exact terminal step after DO restart.
    pub(super) presign_session_id: String,
    /// Digest of the complete terminal step request, including protocol messages.
    pub(super) terminal_step_digest: PublicDigest32,
    pub(super) scope_digest: PublicDigest32,
    pub(super) record: CloudflareSigningWorkerEcdsaPresignatureRecordV1,
    pub(super) response: CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoInitRequestV1 {
    pub(crate) request: CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1,
    pub(crate) active_signing_worker_state: ActiveSigningWorkerStateV1,
    pub(crate) relayer_share32_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeRequestV1 {
    pub(crate) server_presignature_id: String,
    pub(crate) scope_digest: router_ab_core::PublicDigest32,
    pub(crate) request_digest: router_ab_core::PublicDigest32,
    pub(crate) signing_digest: router_ab_core::PublicDigest32,
    pub(crate) now_unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1 {
    Continue {
        presign_session_id: String,
        stage: String,
        event: String,
        outgoing_messages_b64u: Vec<String>,
    },
    Complete {
        presign_session_id: String,
        server_presignature_id: String,
        server_big_r33_b64u: String,
        signing_worker_rerandomization_contribution32_b64u: String,
        prepared_response: RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningPrepareResponseV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeResponseV1 {
    pub(crate) record: CloudflareSigningWorkerEcdsaPresignatureRecordV1,
}

#[cfg(feature = "workers-rs")]
pub(super) async fn handle_cloudflare_signing_worker_ecdsa_presign_session_do_fetch_v1(
    mut request: worker::Request,
    sessions: &CloudflareSigningWorkerEcdsaPresignLiveSessionsV1,
    storage: &worker::Storage,
) -> worker::Result<worker::Response> {
    let started_at_ms = cloudflare_now_unix_ms_v1().unwrap_or_default();
    if request.method() != worker::Method::Post {
        return worker::Response::error("SigningWorker ECDSA presign session requires POST", 405);
    }
    let now_unix_ms = match cloudflare_now_unix_ms_v1() {
        Ok(value) => value,
        Err(error) => return presign_do_error_response(error),
    };
    let result = match request.path().as_str() {
        CLOUDFLARE_SIGNING_WORKER_ECDSA_PRESIGN_SESSION_DO_INIT_PATH => {
            let parsed = match request
                .json::<CloudflareSigningWorkerEcdsaPresignSessionDoInitRequestV1>()
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    return worker::Response::error(
                        format!("SigningWorker ECDSA presign init JSON parse failed: {error}"),
                        400,
                    );
                }
            };
            if let Err(error) = parsed.request.validate_at(now_unix_ms) {
                return presign_do_error_response(error);
            }
            // Claim before emitting any server message; failed or interrupted ceremonies also burn the identity.
            let claimed = Rc::new(std::cell::Cell::new(false));
            let claim_result = Rc::clone(&claimed);
            storage
                .transaction(move |transaction| async move {
                    claim_result.set(false);
                    if transaction_get_optional::<bool>(&transaction, "owner-presign-initialized")
                        .await?
                        .is_some()
                    {
                        return Ok(());
                    }
                    transaction.put("owner-presign-initialized", true).await?;
                    claim_result.set(true);
                    Ok(())
                })
                .await?;
            if !claimed.get() {
                return presign_do_error_response(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ReplayedLocalRequest,
                    "SigningWorker ECDSA presign identity was already initialized",
                ));
            }
            storage
                .set_alarm(std::time::Duration::from_millis(
                    parsed
                        .request
                        .ceremony_expires_at_ms
                        .saturating_sub(now_unix_ms)
                        + 1,
                ))
                .await?;
            create_presign_session(parsed, sessions, now_unix_ms)
        }
        CLOUDFLARE_SIGNING_WORKER_ECDSA_PRESIGN_SESSION_DO_STEP_PATH => {
            let parsed = match request
                .json::<CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1>()
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    return worker::Response::error(
                        format!("SigningWorker ECDSA presign step JSON parse failed: {error}"),
                        400,
                    );
                }
            };
            step_presign_session(parsed, sessions, now_unix_ms)
        }
        _ => {
            return worker::Response::error("SigningWorker ECDSA presign DO route not found", 404);
        }
    };
    match result {
        Ok(progress) => presign_do_json_response(&progress, started_at_ms),
        Err(error) => presign_do_error_response(error),
    }
}

#[cfg(feature = "workers-rs")]
fn presign_do_json_response<T: Serialize>(
    value: &T,
    started_at_ms: u64,
) -> worker::Result<worker::Response> {
    let response = worker::Response::from_json(value)?;
    let elapsed_ms = cloudflare_now_unix_ms_v1()
        .unwrap_or_default()
        .saturating_sub(started_at_ms);
    response
        .headers()
        .set("Server-Timing", &format!("do_total;dur={elapsed_ms}"))?;
    Ok(response)
}

fn create_presign_session(
    input: CloudflareSigningWorkerEcdsaPresignSessionDoInitRequestV1,
    sessions: &CloudflareSigningWorkerEcdsaPresignLiveSessionsV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1> {
    input.request.validate_at(now_unix_ms)?;
    let relayer_share = decode_base64url_fixed_32_v1(
        "SigningWorker ECDSA presign relayer share",
        &input.relayer_share32_b64u,
    )?;
    let wallet_public_key = decode_base64url_fixed_33_v1(
        "SigningWorker ECDSA presign threshold public key",
        &input
            .request
            .scope
            .public_identity
            .threshold_public_key33_b64u,
    )?;
    let context = derive_presign_pair_context(
        CompressedPointBytes::new(wallet_public_key),
        &input.request.presign_session_id,
    )
    .map_err(presign_protocol_error)?;
    let key_share = AdditiveKeyShare::from_bytes(ScalarBytes::new(relayer_share))
        .map_err(presign_protocol_error)?;
    let session = SigningWorkerPresignSession::new(
        context,
        key_share,
        CompressedPointBytes::new(wallet_public_key),
        &mut CloudflareSignerProofGetrandomRngV1,
    )
    .map_err(presign_protocol_error)?;
    let mut sessions = sessions.borrow_mut();
    sessions.retain(|_, entry| entry.ceremony_expires_at_ms > now_unix_ms);
    if sessions.contains_key(&input.request.presign_session_id) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ReplayedLocalRequest,
            "SigningWorker ECDSA presign session id already exists",
        ));
    }
    let mut entry = CloudflareSigningWorkerEcdsaPresignLiveSessionV1 {
        scope: input.request.scope,
        ceremony_expires_at_ms: input.request.ceremony_expires_at_ms,
        material_expires_at_ms: input.request.material_expires_at_ms,
        session,
    };
    let first_message = decode_base64url_bytes_v1(
        "ECDSA presign first message",
        &input.request.first_message_b64u,
    )?;
    entry
        .session
        .message(&first_message, &mut CloudflareSignerProofGetrandomRngV1)
        .map_err(presign_protocol_error)?;
    let progress = continue_progress(&input.request.presign_session_id, entry.session.poll());
    sessions.insert(input.request.presign_session_id, entry);
    Ok(progress)
}

fn step_presign_session(
    input: CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1,
    sessions: &CloudflareSigningWorkerEcdsaPresignLiveSessionsV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1> {
    input.validate_at(now_unix_ms)?;
    let mut entry = sessions
        .borrow_mut()
        .remove(&input.presign_session_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "SigningWorker ECDSA presign session is missing; restart pool fill",
            )
        })?;
    if entry.ceremony_expires_at_ms <= now_unix_ms
        || entry.ceremony_expires_at_ms != input.ceremony_expires_at_ms
        || entry.material_expires_at_ms != input.material_expires_at_ms
        || entry.scope != input.scope
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "SigningWorker ECDSA presign session scope or expiry mismatch",
        ));
    }

    match (input.requested_stage, entry.session.stage()) {
        (
            CloudflareSigningWorkerEcdsaPresignRequestedStageV1::Triples,
            PresignSessionStage::Triples,
        )
        | (
            CloudflareSigningWorkerEcdsaPresignRequestedStageV1::Presign,
            PresignSessionStage::Presign,
        ) => {}
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "SigningWorker ECDSA presign session stage mismatch",
            ))
        }
    }

    for message_b64u in &input.outgoing_messages_b64u {
        let message =
            decode_base64url_bytes_v1("SigningWorker ECDSA presign message", message_b64u)?;
        entry
            .session
            .message(&message, &mut CloudflareSignerProofGetrandomRngV1)
            .map_err(presign_protocol_error)?;
        if entry.session.stage() == PresignSessionStage::TriplesDone {
            entry
                .session
                .start_presign()
                .map_err(presign_protocol_error)?;
        }
    }
    let progress = entry.session.poll();
    if progress.event == PresignSessionEvent::PresignDone
        || progress.stage == PresignSessionStage::Done
    {
        let presignature = entry
            .session
            .take_presignature_97()
            .map_err(presign_protocol_error)?;
        if presignature.len() != 97 {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "SigningWorker ECDSA presign output must contain 97 bytes",
            ));
        }
        let big_r = &presignature[..33];
        let k_share = &presignature[33..65];
        let sigma_share = &presignature[65..97];
        let presignature_id = format!(
            "presig-{}",
            encode_base64url_bytes_v1(Sha256::digest(big_r).as_slice())
        );
        let pool_put_request =
            CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1::new(
                entry.scope,
                presignature_id,
                encode_base64url_bytes_v1(big_r),
                encode_base64url_bytes_v1(k_share),
                encode_base64url_bytes_v1(sigma_share),
                entry.material_expires_at_ms,
            )?;
        return Ok(
            CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Complete {
                pool_put_request,
                outgoing_messages_b64u: progress
                    .outgoing
                    .iter()
                    .map(|message| encode_base64url_bytes_v1(message))
                    .collect(),
            },
        );
    }
    let response = continue_progress(&input.presign_session_id, progress);
    sessions
        .borrow_mut()
        .insert(input.presign_session_id, entry);
    Ok(response)
}

fn continue_progress(
    presign_session_id: &str,
    progress: router_ab_ecdsa_presign::session::PresignSessionProgress,
) -> CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1 {
    CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Continue {
        presign_session_id: presign_session_id.to_owned(),
        stage: progress.stage.as_str().to_owned(),
        event: progress.event.as_str().to_owned(),
        outgoing_messages_b64u: progress
            .outgoing
            .iter()
            .map(|message| encode_base64url_bytes_v1(message))
            .collect(),
    }
}

#[cfg(feature = "workers-rs")]
pub(super) async fn handle_cloudflare_signing_worker_linked_ecdsa_presign_session_do_fetch_v1(
    mut request: worker::Request,
    sessions: &CloudflareSigningWorkerLinkedDeviceEcdsaPresignLiveSessionsV1,
    completed_records: &CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordsV1,
    storage: &worker::Storage,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "SigningWorker linked ECDSA presign session requires POST",
            405,
        );
    }
    let now_unix_ms = match cloudflare_now_unix_ms_v1() {
        Ok(value) => value,
        Err(error) => return presign_do_error_response(error),
    };
    if request.path().as_str()
        == CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGNATURE_DO_CONSUME_PATH
    {
        let parsed = match request
            .json::<CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeRequestV1>()
            .await
        {
            Ok(value) => value,
            Err(error) => {
                return worker::Response::error(
                    format!(
                        "SigningWorker linked ECDSA presign consume JSON parse failed: {error}"
                    ),
                    400,
                );
            }
        };
        return match consume_linked_presignature(parsed, completed_records, storage).await {
            Ok(response) => worker::Response::from_json(&response),
            Err(error) => presign_do_error_response(error),
        };
    }
    let result = match request.path().as_str() {
        CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGN_SESSION_DO_INIT_PATH => {
            let parsed = match request
                .json::<CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoInitRequestV1>()
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    return worker::Response::error(
                        format!(
                            "SigningWorker linked ECDSA presign init JSON parse failed: {error}"
                        ),
                        400,
                    );
                }
            };
            create_linked_presign_session(parsed, sessions, now_unix_ms)
        }
        CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_PRESIGN_SESSION_DO_STEP_PATH => {
            let parsed = match request
                .json::<CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionStepRequestV1>()
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    return worker::Response::error(
                        format!(
                            "SigningWorker linked ECDSA presign step JSON parse failed: {error}"
                        ),
                        400,
                    );
                }
            };
            step_linked_presign_session(parsed, sessions, completed_records, storage, now_unix_ms)
                .await
        }
        _ => {
            return worker::Response::error(
                "SigningWorker linked ECDSA presign DO route not found",
                404,
            );
        }
    };
    match result {
        Ok(progress) => worker::Response::from_json(&progress),
        Err(error) => presign_do_error_response(error),
    }
}

fn create_linked_presign_session(
    input: CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoInitRequestV1,
    sessions: &CloudflareSigningWorkerLinkedDeviceEcdsaPresignLiveSessionsV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1> {
    input.request.validate_at(now_unix_ms)?;
    let relayer_share = decode_base64url_fixed_32_v1(
        "linked SigningWorker ECDSA presign relayer share",
        &input.relayer_share32_b64u,
    )?;
    let wallet_public_key = decode_base64url_fixed_33_v1(
        "linked SigningWorker ECDSA presign threshold public key",
        &input.request.request.scope.threshold_public_key33_b64u,
    )?;
    let context = derive_presign_pair_context(
        CompressedPointBytes::new(wallet_public_key),
        &input.request.presign_session_id,
    )
    .map_err(presign_protocol_error)?;
    let key_share = AdditiveKeyShare::from_bytes(ScalarBytes::new(relayer_share))
        .map_err(presign_protocol_error)?;
    let session = SigningWorkerPresignSession::new(
        context,
        key_share,
        CompressedPointBytes::new(wallet_public_key),
        &mut CloudflareSignerProofGetrandomRngV1,
    )
    .map_err(presign_protocol_error)?;
    let request_digest = input.request.request.request_digest()?;
    let signing_digest = input.request.request.signing_digest()?;
    let linked_request = input.request.request;
    let scope = linked_request.scope.clone();
    let mut sessions = sessions.borrow_mut();
    sessions.retain(|_, entry| entry.expires_at_ms > now_unix_ms);
    if sessions.contains_key(&input.request.presign_session_id) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ReplayedLocalRequest,
            "SigningWorker linked ECDSA presign session id already exists",
        ));
    }
    let session_id = input.request.presign_session_id.clone();
    let mut entry = CloudflareSigningWorkerLinkedDeviceEcdsaPresignLiveSessionV1 {
        request: linked_request,
        scope,
        expires_at_ms: input.request.expires_at_ms,
        request_digest,
        signing_digest,
        active_signing_worker_state: input.active_signing_worker_state,
        session,
    };
    let progress = linked_continue_progress(&session_id, entry.session.poll());
    sessions.insert(session_id, entry);
    Ok(progress)
}

async fn step_linked_presign_session(
    input: CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionStepRequestV1,
    sessions: &CloudflareSigningWorkerLinkedDeviceEcdsaPresignLiveSessionsV1,
    completed_records: &CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordsV1,
    storage: &worker::Storage,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1> {
    input.validate_at(now_unix_ms)?;
    completed_records
        .borrow_mut()
        .retain(|_, record| record.record.expires_at_ms > now_unix_ms);
    let terminal_step_digest = linked_terminal_step_digest(&input)?;
    if let Some(replayed) = completed_records
        .borrow()
        .get(&input.presign_session_id)
        .cloned()
    {
        if replayed.terminal_step_digest == terminal_step_digest {
            return Ok(replayed.response);
        }
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ReplayedLocalRequest,
            "linked ECDSA presign terminal step does not match the completed request",
        ));
    }
    if let Some(replayed) = load_linked_terminal_replay(storage, &input.presign_session_id)
        .await
        .map_err(durable_storage_protocol_error)?
    {
        if replayed.terminal_step_digest == terminal_step_digest {
            return Ok(replayed.response);
        }
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ReplayedLocalRequest,
            "linked ECDSA presign terminal step does not match the completed request",
        ));
    }
    let mut entry = sessions
        .borrow_mut()
        .remove(&input.presign_session_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "SigningWorker linked ECDSA presign session is missing; restart presign",
            )
        })?;
    if entry.expires_at_ms <= now_unix_ms
        || entry.expires_at_ms != input.expires_at_ms
        || entry.scope != input.request.scope
        || entry.request != input.request
        || entry.request_digest != input.request.request_digest()?
        || entry.signing_digest != input.request.signing_digest()?
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "SigningWorker linked ECDSA presign session binding does not match request",
        ));
    }

    match (input.requested_stage, entry.session.stage()) {
        (
            CloudflareSigningWorkerEcdsaPresignRequestedStageV1::Triples,
            PresignSessionStage::Triples,
        )
        | (
            CloudflareSigningWorkerEcdsaPresignRequestedStageV1::Presign,
            PresignSessionStage::Presign,
        ) => {}
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "SigningWorker linked ECDSA presign session stage mismatch",
            ))
        }
    }

    for message_b64u in &input.outgoing_messages_b64u {
        let message = decode_base64url_bytes_v1("linked ECDSA presign message", message_b64u)?;
        entry
            .session
            .message(&message, &mut CloudflareSignerProofGetrandomRngV1)
            .map_err(presign_protocol_error)?;
        if entry.session.stage() == PresignSessionStage::TriplesDone {
            entry
                .session
                .start_presign()
                .map_err(presign_protocol_error)?;
        }
    }
    let progress = entry.session.poll();
    if progress.event == PresignSessionEvent::PresignDone
        || progress.stage == PresignSessionStage::Done
    {
        let presignature = entry
            .session
            .take_presignature_97()
            .map_err(presign_protocol_error)?;
        if presignature.len() != 97 {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "SigningWorker linked ECDSA presign output must contain 97 bytes",
            ));
        }
        let mut contribution = [0_u8; 32];
        getrandom::getrandom(&mut contribution).map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "SigningWorker linked ECDSA rerandomization RNG failed",
            )
        })?;
        let server_big_r33_b64u = encode_base64url_bytes_v1(&presignature[..33]);
        let server_presignature_id = entry.request.client_presignature_id.clone();
        let signing_worker_rerandomization_contribution32_b64u =
            encode_base64url_bytes_v1(&contribution);
        let record = CloudflareSigningWorkerEcdsaPresignatureRecordV1::new(
            entry.active_signing_worker_state.clone(),
            server_presignature_id.clone(),
            entry.request_digest,
            entry.signing_digest,
            server_big_r33_b64u.clone(),
            signing_worker_rerandomization_contribution32_b64u.clone(),
            encode_base64url_bytes_v1(&presignature[33..65]),
            encode_base64url_bytes_v1(&presignature[65..97]),
            now_unix_ms,
            entry.expires_at_ms,
        )?;
        let prepared_response =
            RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningPrepareResponseV1 {
                scope: entry.scope.clone(),
                request_id: entry.request.request_id.clone(),
                request_digest: entry.request_digest,
                signing_digest: entry.signing_digest,
                server_presignature_id: server_presignature_id.clone(),
                server_big_r33_b64u: server_big_r33_b64u.clone(),
                signing_worker_rerandomization_contribution32_b64u:
                    signing_worker_rerandomization_contribution32_b64u.clone(),
                signature_scheme:
                    RouterAbEcdsaDerivationSignatureSchemeV1::EcdsaSecp256k1RecoverableV1,
                prepared_at_ms: now_unix_ms,
                expires_at_ms: entry.expires_at_ms,
            };
        let response =
            CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1::Complete {
                presign_session_id: input.presign_session_id.clone(),
                server_presignature_id,
                server_big_r33_b64u,
                signing_worker_rerandomization_contribution32_b64u,
                prepared_response,
            };
        let completed = CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1 {
            presign_session_id: input.presign_session_id,
            terminal_step_digest,
            scope_digest: entry.scope.scope_digest()?,
            record,
            response: response.clone(),
        };
        persist_linked_terminal_completion(storage, &completed)
            .await
            .map_err(durable_storage_protocol_error)?;
        completed_records
            .borrow_mut()
            .insert(completed.presign_session_id.clone(), completed);
        return Ok(response);
    }
    let response = linked_continue_progress(&input.presign_session_id, progress);
    sessions
        .borrow_mut()
        .insert(input.presign_session_id, entry);
    Ok(response)
}

fn linked_continue_progress(
    presign_session_id: &str,
    progress: router_ab_ecdsa_presign::session::PresignSessionProgress,
) -> CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1 {
    CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1::Continue {
        presign_session_id: presign_session_id.to_owned(),
        stage: progress.stage.as_str().to_owned(),
        event: progress.event.as_str().to_owned(),
        outgoing_messages_b64u: progress
            .outgoing
            .iter()
            .map(|message| encode_base64url_bytes_v1(message))
            .collect(),
    }
}

async fn consume_linked_presignature(
    input: CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeRequestV1,
    completed_records: &CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordsV1,
    storage: &worker::Storage,
) -> RouterAbProtocolResult<CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeResponseV1>
{
    require_non_empty(
        "linked ECDSA server presignature id",
        &input.server_presignature_id,
    )?;
    require_positive_ms(
        "linked ECDSA presignature consume now_unix_ms",
        input.now_unix_ms,
    )?;
    completed_records
        .borrow_mut()
        .retain(|_, record| record.record.expires_at_ms > input.now_unix_ms);
    let storage_key = linked_completion_server_storage_key(&input.server_presignature_id);
    let outcome: Rc<
        RefCell<
            Option<
                RouterAbProtocolResult<
                    CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeResponseV1,
                >,
            >,
        >,
    > = Rc::new(RefCell::new(None));
    let outcome_for_transaction = Rc::clone(&outcome);
    let session_key_holder = Rc::new(RefCell::new(None::<String>));
    let session_key_for_transaction = Rc::clone(&session_key_holder);
    let server_presignature_id = input.server_presignature_id.clone();
    let scope_digest = input.scope_digest;
    let request_digest = input.request_digest;
    let signing_digest = input.signing_digest;
    let now_unix_ms = input.now_unix_ms;
    storage
        .transaction(move |transaction| async move {
            let candidate = match transaction_get_optional::<
                CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1,
            >(&transaction, &storage_key)
            .await
            {
                Ok(Some(value)) => value,
                Ok(None) => {
                    outcome_for_transaction.replace(Some(Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::ExpiredLocalRequest,
                        "linked ECDSA presignature record is missing or already consumed",
                    ))));
                    return Ok(());
                }
                Err(error) => return Err(error),
            };
            session_key_for_transaction.replace(Some(linked_completion_session_storage_key(
                &candidate.presign_session_id,
            )));
            if candidate.scope_digest != scope_digest {
                outcome_for_transaction.replace(Some(Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "linked ECDSA presignature scope digest does not match finalize request",
                ))));
                return Ok(());
            }
            if let Err(error) = candidate.record.validate_for_request(
                &candidate.record.active_signing_worker_state,
                &server_presignature_id,
                request_digest,
                signing_digest,
                now_unix_ms,
            ) {
                if error.code() == RouterAbProtocolErrorCode::ExpiredLocalRequest {
                    transaction.delete(&storage_key).await?;
                    let session_key = session_key_for_transaction.borrow().clone();
                    if let Some(session_key) = session_key {
                        transaction.delete(&session_key).await?;
                    }
                }
                outcome_for_transaction.replace(Some(Err(error)));
                return Ok(());
            }
            transaction.delete(&storage_key).await?;
            let session_key = session_key_for_transaction.borrow().clone();
            if let Some(session_key) = session_key {
                transaction.delete(&session_key).await?;
            }
            outcome_for_transaction.replace(Some(Ok(
                CloudflareSigningWorkerLinkedDeviceEcdsaPresignatureDoConsumeResponseV1 {
                    record: candidate.record,
                },
            )));
            Ok(())
        })
        .await
        .map_err(durable_storage_protocol_error)?;
    let outcome = outcome.borrow_mut().take().unwrap_or_else(|| {
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "linked ECDSA presignature consume transaction returned no outcome",
        ))
    });
    if outcome.is_ok() {
        completed_records.borrow_mut().retain(|_, record| {
            record.record.server_presignature_id != input.server_presignature_id
        });
    }
    outcome
}

const LINKED_ECDSA_COMPLETION_SESSION_STORAGE_PREFIX_V1: &str = "linked-ecdsa-presign-session/v1/";
const LINKED_ECDSA_COMPLETION_SERVER_STORAGE_PREFIX_V1: &str = "linked-ecdsa-presignature/v1/";

fn linked_completion_storage_suffix(value: &str) -> String {
    encode_base64url_bytes_v1(Sha256::digest(value.as_bytes()).as_slice())
}

fn linked_completion_session_storage_key(session_id: &str) -> String {
    format!(
        "{LINKED_ECDSA_COMPLETION_SESSION_STORAGE_PREFIX_V1}{}",
        linked_completion_storage_suffix(session_id)
    )
}

fn linked_completion_server_storage_key(server_presignature_id: &str) -> String {
    format!(
        "{LINKED_ECDSA_COMPLETION_SERVER_STORAGE_PREFIX_V1}{}",
        linked_completion_storage_suffix(server_presignature_id)
    )
}

fn linked_terminal_step_digest(
    input: &CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionStepRequestV1,
) -> RouterAbProtocolResult<PublicDigest32> {
    let encoded = serde_json::to_vec(input).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("linked ECDSA terminal step digest encoding failed: {error}"),
        )
    })?;
    Ok(PublicDigest32::new(Sha256::digest(encoded).into()))
}

async fn load_linked_terminal_replay(
    storage: &worker::Storage,
    session_id: &str,
) -> worker::Result<Option<CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1>> {
    storage
        .get(&linked_completion_session_storage_key(session_id))
        .await
}

async fn persist_linked_terminal_completion(
    storage: &worker::Storage,
    completed: &CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1,
) -> worker::Result<()> {
    let session_key = linked_completion_session_storage_key(&completed.presign_session_id);
    let server_key = linked_completion_server_storage_key(&completed.record.server_presignature_id);
    let completed = completed.clone();
    storage
        .transaction(move |transaction| async move {
            if transaction_get_optional::<
                CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1,
            >(&transaction, &session_key)
            .await?
            .is_some()
                || transaction_get_optional::<
                    CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1,
                >(&transaction, &server_key)
                .await?
                .is_some()
            {
                return Err(worker::Error::RustError(
                    "linked ECDSA presignature terminal completion already exists".to_owned(),
                ));
            }
            transaction.put(&session_key, &completed).await?;
            transaction.put(&server_key, &completed).await
        })
        .await
}

async fn transaction_get_optional<T: DeserializeOwned>(
    transaction: &worker::Transaction,
    key: &str,
) -> worker::Result<Option<T>> {
    match transaction.get(key).await {
        Ok(value) => Ok(Some(value)),
        Err(worker::Error::JsError(message)) if message == "No such value in storage." => Ok(None),
        Err(error) => Err(error),
    }
}

fn durable_storage_protocol_error(error: worker::Error) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("linked ECDSA presignature durable storage failed: {error}"),
    )
}

fn presign_protocol_error(error: impl std::fmt::Display) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("SigningWorker ECDSA presign protocol rejected input: {error}"),
    )
}

#[cfg(feature = "workers-rs")]
fn presign_do_error_response(error: RouterAbProtocolError) -> worker::Result<worker::Response> {
    worker::Response::error(
        format!("{:?}: {}", error.code(), error.message()),
        durable_object_error_status(error.code()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use router_ab_core::{
        MpcMaterialActivationRefV1, RouterAbEcdsaDerivationPublicIdentityV1,
        RouterAbEcdsaDerivationStableKeyContextV1, ServerIdentityV1,
    };
    use router_ab_ecdsa_presign::session::ClientPresignSession;

    fn scope() -> RouterAbEcdsaDerivationNormalSigningScopeV1 {
        let context =
            RouterAbEcdsaDerivationStableKeyContextV1::new(encode_base64url_bytes_v1(&[7; 32]))
                .unwrap();
        let binding =
            encode_base64url_bytes_v1(context.context_binding_digest().unwrap().as_bytes());
        let identity = RouterAbEcdsaDerivationPublicIdentityV1::new(
            binding.clone(),
            "Anm-Zn753LusVaBilc6HCwcCm_zbLc4o2VnygVsW-BeY",
            "AsYEf5RB7X1tMEVAbpXAfNhcd45LjO88p6usCblccJ7l",
            "AvkwigGSWMMQSTRPhfidUim1MchFg2-ZsIYB8RO84Db5",
            encode_base64url_bytes_v1(&[17; 20]),
            0,
            0,
        )
        .unwrap();
        RouterAbEcdsaDerivationNormalSigningScopeV1::new(
            "wallet",
            "key",
            "root",
            "1",
            context,
            identity,
            ServerIdentityV1::new("worker", "epoch", "x25519:public-key").unwrap(),
            "root-epoch",
            MpcMaterialActivationRefV1::new(
                "activation",
                "capability",
                "wallet",
                binding,
                "lifecycle",
                "worker",
            )
            .unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn owner_pool_completes_in_six_exchanges_with_matching_output() {
        let scope = scope();
        let expires = 30_001;
        let session_id = format!(
            "ecdsa-presign-v2:{expires}:{}",
            encode_base64url_bytes_v1(&[9; 32])
        );
        let key = CompressedPointBytes::new(
            decode_base64url_fixed_33_v1("key", &scope.public_identity.threshold_public_key33_b64u)
                .unwrap(),
        );
        let context = derive_presign_pair_context(key, &session_id).unwrap();
        let mut client_share = [0; 32];
        client_share[31] = 1;
        let mut worker_share = [0; 32];
        worker_share[31] = 2;
        let mut rng = CloudflareSignerProofGetrandomRngV1;
        let mut client = ClientPresignSession::new(
            context,
            AdditiveKeyShare::from_bytes(ScalarBytes::new(client_share)).unwrap(),
            key,
            &mut rng,
        )
        .unwrap();
        let first = client.poll().outgoing.remove(0);
        let sessions = Default::default();
        let mut progress = create_presign_session(
            CloudflareSigningWorkerEcdsaPresignSessionDoInitRequestV1 {
                request: CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1 {
                    scope: scope.clone(),
                    presign_session_id: session_id.clone(),
                    first_message_b64u: encode_base64url_bytes_v1(&first),
                    ceremony_expires_at_ms: expires,
                    material_expires_at_ms: expires,
                },
                relayer_share32_b64u: encode_base64url_bytes_v1(&worker_share),
            },
            &sessions,
            1,
        )
        .unwrap();
        let mut exchanges = 1;
        loop {
            match progress {
                CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Complete {
                    pool_put_request,
                    outgoing_messages_b64u,
                } => {
                    assert_eq!(exchanges, 6);
                    assert_eq!(outgoing_messages_b64u.len(), 1);
                    for message in outgoing_messages_b64u {
                        client
                            .message(
                                &decode_base64url_bytes_v1("message", &message).unwrap(),
                                &mut rng,
                            )
                            .unwrap();
                    }
                    let client_output = client.take_presignature_97().unwrap();
                    assert_eq!(
                        pool_put_request.server_big_r33_b64u,
                        encode_base64url_bytes_v1(&client_output[..33])
                    );
                    assert!(client.take_presignature_97().is_err());
                    assert!(sessions.borrow().is_empty());
                    break;
                }
                CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Continue {
                    stage,
                    outgoing_messages_b64u,
                    ..
                } => {
                    assert!(exchanges < 6);
                    if exchanges == 1 {
                        assert_eq!(outgoing_messages_b64u.len(), 2);
                    }
                    for message in outgoing_messages_b64u {
                        client
                            .message(
                                &decode_base64url_bytes_v1("message", &message).unwrap(),
                                &mut rng,
                            )
                            .unwrap();
                        if client.stage() == PresignSessionStage::TriplesDone {
                            client.start_presign().unwrap();
                        }
                    }
                    let requested_stage = match stage.as_str() {
                        "triples" => CloudflareSigningWorkerEcdsaPresignRequestedStageV1::Triples,
                        "presign" => CloudflareSigningWorkerEcdsaPresignRequestedStageV1::Presign,
                        _ => panic!("Unexpected server stage"),
                    };
                    progress = step_presign_session(
                        CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1 {
                            scope: scope.clone(),
                            presign_session_id: session_id.clone(),
                            requested_stage,
                            outgoing_messages_b64u: client
                                .poll()
                                .outgoing
                                .iter()
                                .map(|message| encode_base64url_bytes_v1(message))
                                .collect(),
                            ceremony_expires_at_ms: expires,
                            material_expires_at_ms: expires,
                        },
                        &sessions,
                        1,
                    )
                    .unwrap();
                    exchanges += 1;
                }
            }
        }
    }
}
