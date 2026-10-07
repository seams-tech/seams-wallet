//! Durable public history after linked presignature secrets are destroyed.

use router_ab_core::{
    ActiveSigningWorkerStateV1, PublicDigest32, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult,
};
use serde::{Deserialize, Serialize};

use super::ecdsa_presign_live_session::{
    CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1 as Completion,
    CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionDoProgressV1 as Progress,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "reason", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Retirement {
    Consumed { at_ms: u64 },
    Expired { at_ms: u64 },
    WalletRelocated { move_id: String },
}

impl Retirement {
    fn validate(&self, expires_at_ms: u64) -> RouterAbProtocolResult<()> {
        match self {
            Self::Consumed { at_ms } if *at_ms > 0 && *at_ms < expires_at_ms => Ok(()),
            Self::Expired { at_ms } if *at_ms >= expires_at_ms => Ok(()),
            Self::WalletRelocated { move_id } => {
                crate::require_non_empty("Linked presign retirement move", move_id)
            }
            _ => Err(inconsistent()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RetiredCompletion {
    presign_session_id: String,
    terminal_step_digest: PublicDigest32,
    scope_digest: PublicDigest32,
    active_signing_worker_state: ActiveSigningWorkerStateV1,
    created_at_ms: u64,
    response: Progress,
    retirement: Retirement,
}

impl RetiredCompletion {
    pub(super) fn from_completion(
        completed: &Completion,
        retirement: Retirement,
    ) -> RouterAbProtocolResult<Self> {
        completed.record.validate()?;
        retirement.validate(completed.record.expires_at_ms)?;
        let Progress::Complete {
            presign_session_id,
            server_presignature_id,
            server_big_r33_b64u,
            signing_worker_rerandomization_contribution32_b64u,
            prepared_response,
        } = &completed.response
        else {
            return Err(inconsistent());
        };
        if *presign_session_id != completed.presign_session_id
            || *server_presignature_id != completed.record.server_presignature_id
            || *server_big_r33_b64u != completed.record.server_big_r33_b64u
            || *signing_worker_rerandomization_contribution32_b64u
                != completed
                    .record
                    .signing_worker_rerandomization_contribution32_b64u
            || prepared_response.server_presignature_id != *server_presignature_id
            || prepared_response.server_big_r33_b64u != *server_big_r33_b64u
            || prepared_response.signing_worker_rerandomization_contribution32_b64u
                != *signing_worker_rerandomization_contribution32_b64u
            || prepared_response.request_digest != completed.record.request_digest
            || prepared_response.signing_digest != completed.record.admitted_signing_digest
            || prepared_response.prepared_at_ms != completed.record.created_at_ms
            || prepared_response.expires_at_ms != completed.record.expires_at_ms
            || prepared_response.scope.scope_digest()? != completed.scope_digest
        {
            return Err(inconsistent());
        }
        Ok(Self {
            presign_session_id: completed.presign_session_id.clone(),
            terminal_step_digest: completed.terminal_step_digest,
            scope_digest: completed.scope_digest,
            active_signing_worker_state: completed.record.active_signing_worker_state.clone(),
            created_at_ms: completed.record.created_at_ms,
            response: completed.response.clone(),
            retirement,
        })
    }

    pub(super) fn validate_for_authority(
        &self,
        authority: &crate::CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1,
    ) -> RouterAbProtocolResult<()> {
        authority.validate()?;
        self.active_signing_worker_state.validate()?;
        let Progress::Complete {
            presign_session_id,
            prepared_response,
            server_presignature_id,
            server_big_r33_b64u,
            signing_worker_rerandomization_contribution32_b64u,
        } = &self.response
        else {
            return Err(inconsistent());
        };
        prepared_response.validate_for_request(&authority.request)?;
        self.retirement.validate(prepared_response.expires_at_ms)?;
        if self.presign_session_id != authority.presign_session_id
            || *presign_session_id != self.presign_session_id
            || self.scope_digest != authority.request.scope.scope_digest()?
            || self.active_signing_worker_state.account_id != authority.wallet_scope.wallet_id
            || self.active_signing_worker_state.material_activation
                != authority.request.material_activation
            || self.created_at_ms != prepared_response.prepared_at_ms
            || *server_presignature_id != prepared_response.server_presignature_id
            || *server_big_r33_b64u != prepared_response.server_big_r33_b64u
            || *signing_worker_rerandomization_contribution32_b64u
                != prepared_response.signing_worker_rerandomization_contribution32_b64u
        {
            return Err(inconsistent());
        }
        Ok(())
    }
}

pub(super) fn storage_key(server_presignature_id: &str) -> String {
    format!(
        "linked-ecdsa-presignature-retired/v1/{}",
        super::ecdsa_presign_live_session::linked_completion_storage_suffix(server_presignature_id)
    )
}

pub(super) async fn retire(
    transaction: &worker::Transaction,
    completed: &Completion,
    retirement: Retirement,
) -> worker::Result<RetiredCompletion> {
    let history = RetiredCompletion::from_completion(completed, retirement)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    persist_retirement(transaction, &history).await?;
    Ok(history)
}

pub(super) async fn persist_retirement(
    transaction: &worker::Transaction,
    history: &RetiredCompletion,
) -> worker::Result<()> {
    let Progress::Complete {
        server_presignature_id,
        ..
    } = &history.response
    else {
        return Err(worker::Error::RustError(
            "Linked presign retirement has no completion".into(),
        ));
    };
    let key = storage_key(server_presignature_id);
    if super::ecdsa_presign_live_session::transaction_get_optional::<RetiredCompletion>(
        transaction,
        &key,
    )
    .await?
    .is_some()
    {
        return Err(worker::Error::RustError(
            "Linked presign history already exists".into(),
        ));
    }
    transaction.put(&key, history).await
}

fn inconsistent() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        "Linked presign public completion history is inconsistent",
    )
}

// The old shape exists only at the storage boundary. Its serialization remains
// the input to the wallet inventory digest until that record is relocated.
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
pub(super) enum StoredAuthority {
    Current(crate::CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1),
    GenerationOne(GenerationOneAuthority),
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GenerationOneAuthority {
    wallet_scope: crate::CloudflareSigningWorkerWalletScopeV1,
    request: router_ab_core::RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningRequestV1,
    material_source: crate::CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    presign_session_id: String,
    expires_at_ms: u64,
}

impl StoredAuthority {
    pub(super) fn into_request(self) -> crate::CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1 {
        match self {
            Self::Current(request) => request,
            Self::GenerationOne(stored) => crate::CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1 {
                ownership_generation: 1,
                wallet_scope: stored.wallet_scope,
                request: stored.request,
                material_source: stored.material_source,
                presign_session_id: stored.presign_session_id,
                expires_at_ms: stored.expires_at_ms,
            },
        }
    }
}

pub(super) fn deserialize_stored_authority<'de, D>(
    deserializer: D,
) -> Result<crate::CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1, D::Error>
where
    D: serde::Deserializer<'de>,
{
    StoredAuthority::deserialize(deserializer).map(StoredAuthority::into_request)
}
