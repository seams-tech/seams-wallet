//! The SigningWorker's owner ECDSA presignature session, shared by every host.
//!
//! A session's cryptographic state lives in memory for the ceremony's short
//! life: in the session's Durable Object on Cloudflare, in the SigningWorker
//! process on a VM. What must survive a restart is durable on both hosts: the
//! one-use claim of the session's authority, made before any server message,
//! and the finished presignature, admitted to the wallet's pool.

use std::collections::BTreeMap;

use router_ab_ecdsa_presign::session::{
    derive_presign_pair_context, PresignSessionEvent, PresignSessionStage,
    SigningWorkerPresignSession,
};
use router_ab_ecdsa_presign::AdditiveKeyShare;
use router_ab_ecdsa_wire::{CompressedPointBytes, ScalarBytes};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::*;

/// One owner presignature session's in-memory state.
pub struct CloudflareSigningWorkerEcdsaPresignLiveSessionV1 {
    scope: RouterAbEcdsaDerivationNormalSigningScopeV1,
    authority: CloudflareSigningWorkerEcdsaPresignAuthorityV1,
    ceremony_expires_at_ms: u64,
    material_expires_at_ms: u64,
    session: SigningWorkerPresignSession,
}

/// Live sessions by presignature-session id.
pub type CloudflareSigningWorkerEcdsaPresignLiveSessionMapV1 =
    BTreeMap<String, CloudflareSigningWorkerEcdsaPresignLiveSessionV1>;

/// A session's first message with the wallet's relayer share.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareSigningWorkerEcdsaPresignSessionDoInitRequestV1 {
    pub request: CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
    pub relayer_share32_b64u: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
/// Constructed only after the direct Gateway presign credential is verified.
pub struct CloudflareSigningWorkerEcdsaPresignSessionDoGatewayStepRequestV1 {
    pub request: CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1,
}

/// A session's progress after one message batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1 {
    Continue {
        presign_session_id: String,
        stage: String,
        event: String,
        outgoing_messages_b64u: Vec<String>,
    },
    Complete {
        authority: CloudflareSigningWorkerEcdsaPresignAuthorityV1,
        outgoing_messages_b64u: Vec<String>,
        pool_put_request:
            CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1,
    },
}

/// Starts one session from its first client message.
pub fn create_signing_worker_ecdsa_presign_session_v1(
    input: CloudflareSigningWorkerEcdsaPresignSessionDoInitRequestV1,
    sessions: &mut CloudflareSigningWorkerEcdsaPresignLiveSessionMapV1,
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
    sessions.retain(|_, entry| entry.ceremony_expires_at_ms > now_unix_ms);
    if sessions.contains_key(&input.request.presign_session_id) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ReplayedLocalRequest,
            "SigningWorker ECDSA presign session id already exists",
        ));
    }
    let mut entry = CloudflareSigningWorkerEcdsaPresignLiveSessionV1 {
        scope: input.request.scope,
        authority: input.request.authority,
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

/// Advances one session by one Gateway message batch.
pub fn step_signing_worker_ecdsa_presign_session_v1(
    input: CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1,
    sessions: &mut CloudflareSigningWorkerEcdsaPresignLiveSessionMapV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1> {
    input.validate_at(now_unix_ms)?;
    if sessions
        .get(&input.presign_session_id)
        .is_some_and(|entry| entry.authority != input.authority)
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "SigningWorker ECDSA presign authority does not match initialized session",
        ));
    }
    let mut entry = sessions.remove(&input.presign_session_id).ok_or_else(|| {
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
                authority: entry.authority,
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
    sessions.insert(input.presign_session_id, entry);
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

pub(crate) fn presign_protocol_error(error: impl std::fmt::Display) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("SigningWorker ECDSA presign protocol rejected input: {error}"),
    )
}

/// The session-start request for one owner presignature session: the
/// client's first message with the relayer share derived from the wallet's
/// active material.
pub fn signing_worker_ecdsa_presign_session_start_v1(
    request: CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
    active: &ActiveSigningWorkerStateV1,
    material: &CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignSessionDoInitRequestV1> {
    let (relayer_share, _) =
        cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_active_material_v1(
            &request.scope,
            active,
            material,
        )?;
    Ok(CloudflareSigningWorkerEcdsaPresignSessionDoInitRequestV1 {
        request,
        relayer_share32_b64u: encode_base64url_bytes_v1(&relayer_share.x_relayer32),
    })
}

/// Admits one finished presignature to its wallet's pool.
pub fn admit_signing_worker_wallet_ecdsa_presignature_v1<Sql: SigningWorkerWalletSqlV1>(
    store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
    wallet_scope: &CloudflareSigningWorkerWalletScopeV1,
    request: CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolAdmissionReceiptV1> {
    request.validate_at(now_unix_ms)?;
    let (active, material) = store.load_normal_signing_material(
        wallet_scope,
        &request.scope,
        &request.material_source,
    )?;
    let record = request.to_pool_record(active, &material, now_unix_ms)?;
    let outcome = store.mutate_pool(
        wallet_scope.clone(),
        CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable {
            material: record.clone(),
        },
    )?;
    let CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Available { stored, .. } = outcome
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "SigningWorker ECDSA pool admission returned the wrong lifecycle outcome",
        ));
    };
    CloudflareSigningWorkerEcdsaPoolAdmissionReceiptV1::from_record(&record, stored)
}
