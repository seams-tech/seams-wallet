mod ed25519_settlement;
mod ed25519_snapshot;
mod linked_ed25519;
mod transaction;

use router_ab_core::{
    Ed25519YaoOperationV1, NormalSigningRound1PrepareResponseV1, PublicDigest32,
    RouterAbEcdsaDerivationEvmDigestSigningResponseV1, RouterAbProtocolError,
    RouterAbProtocolErrorCode,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{cell::RefCell, rc::Rc};
use worker::{DurableObject, Env, Request, Response, SqlStorage, SqlStorageValue, State, Storage};

use crate::{
    ed25519_yao_signing_worker::{
        active_output_key_v1, build_output_activation_record,
        combine_signing_worker_yao_packages_v1, evaluate_initial_registration_finalization_v1,
        http_active_receipt, http_staged_receipt, public_activation_receipt_v1,
        reservation_record_key_from_binding_v1, reservation_record_key_from_material_activation_v1,
        settle_linked_ed25519_activation_v1, settle_linked_ed25519_deactivation_v1,
        settle_linked_ed25519_reservation_v1, settle_signing_worker_yao_recovery_delivery_v1,
        settle_signing_worker_yao_recovery_promotion_v1, source_preserving_reservation_id_v1,
        CloudflareEd25519YaoActivateReservationRequestV1,
        CloudflareEd25519YaoDeactivateReservationRequestV1,
        CloudflareEd25519YaoInactiveReservationResponseV1,
        CloudflareEd25519YaoReservationActivationResponseV1,
        CloudflareEd25519YaoReservationDeactivationResponseV1,
        CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1,
        CloudflareScopedEd25519YaoRecoveryPromotionRequestV1, LinkedEd25519ActivationV1,
        LinkedEd25519DeactivationV1, LinkedEd25519ReservationV1, SigningWorkerYaoDurableStateV1,
        SigningWorkerYaoRecoveryDeliveryV1, SigningWorkerYaoRecoveryPromotionV1,
        SigningWorkerYaoReservationStateV1,
    },
    handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2,
    handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2,
    signing_worker::SigningWorkerPrivateD1CipherV1,
    signing_worker_activation_retired_error_v1, CloudflareActiveSigningWorkerStateLookupV1,
    CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1,
    CloudflareEd25519YaoNormalSigningHandlerV1, CloudflareScopedEd25519YaoPackagePairDeliveryV1,
    CloudflareServerOutputMaterialRecordV1,
    CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    CloudflareSigningWorkerEcdsaPoolCommandV1,
    CloudflareSigningWorkerInitialRegistrationFinalizationSnapshotV1,
    CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    CloudflareSigningWorkerNormalSigningTerminalV1,
    CloudflareSigningWorkerOutputActivationRecordV1,
    CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
    CloudflareSigningWorkerRound1LookupV1, CloudflareSigningWorkerRound1RecordV1,
    CloudflareSigningWorkerRuntimeV1, CloudflareSigningWorkerWalletScopeV1,
};

const BINDING: &str = "SIGNING_WORKER_WALLET_DO";
const PATH: &str = "/router-ab/internal/signing-worker/wallet";
const REGISTRATION_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_registrations (
    registration_key TEXT PRIMARY KEY,
    active_key TEXT NOT NULL UNIQUE,
    owner_json TEXT NOT NULL,
    ciphertext_json TEXT NOT NULL)";
/// Activations a recovery replaced. A retired key never signs or activates
/// again here; the row that held it now holds the promoted activation.
const RETIRED_ACTIVATION_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_retired_activations (
    active_key TEXT PRIMARY KEY,
    registration_key TEXT NOT NULL)";
/// Devices linked to this wallet: Ed25519 material reserved from this
/// wallet's active material, then activated or revoked here. An active row
/// names its activation's key, where normal signing finds it.
const LINKED_ED25519_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_linked_ed25519 (
    record_key TEXT PRIMARY KEY,
    active_key TEXT UNIQUE,
    owner_json TEXT NOT NULL,
    ciphertext_json TEXT NOT NULL)";
const ROUND1_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_round1 (
    binding_key TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    request_digest_hex TEXT NOT NULL,
    ciphertext_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('prepared', 'claimed', 'completed')),
    effect_operation_key TEXT UNIQUE,
    authorization_key TEXT UNIQUE,
    authorization_json TEXT,
    effect_request_digest_hex TEXT,
    terminal_json TEXT)";
/// Harness only: the private harness loses or fences a registration's
/// activation here. This object keeps an activation in one record with its
/// lifecycle and has no revocation of its own, so neither state arises
/// otherwise; the finalization lookup reports both.
#[cfg(debug_assertions)]
const HARNESS_FAULT_PATH: &str =
    "/router-ab/internal/signing-worker/wallet/harness-activation-fault";
#[cfg(debug_assertions)]
const HARNESS_FAULT_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS harness_activation_faults (
    active_key TEXT PRIMARY KEY,
    fault TEXT NOT NULL CHECK (fault IN ('lost', 'fenced')))";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum SigningWorkerWalletDoRequestV1 {
    DeliverPackages(CloudflareScopedEd25519YaoPackagePairDeliveryV1),
    FenceEd25519(crate::SigningWorkerEd25519FenceCommandV1),
    SettleEd25519(crate::SigningWorkerEd25519FenceCommandV1),
    Ed25519Snapshot { request: crate::SigningWorkerEd25519SnapshotCommandV1 },
    PromoteRecovery(CloudflareScopedEd25519YaoRecoveryPromotionRequestV1),
    LookupRegistration(CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1),
    ReserveLinkedEd25519(CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1),
    ActivateLinkedEd25519(CloudflareEd25519YaoActivateReservationRequestV1),
    DeactivateLinkedEd25519(CloudflareEd25519YaoDeactivateReservationRequestV1),
    ReserveLinkedEcdsa(crate::CloudflareEcdsaSourcePreservingInactiveMaterialReservationRequestV1),
    ActivateLinkedEcdsa(crate::CloudflareEcdsaActivateReservationRequestV1),
    DeactivateLinkedEcdsa(crate::CloudflareEcdsaDeactivateReservationRequestV1),
    ActivateEcdsa {
        scope: CloudflareSigningWorkerWalletScopeV1,
        activation: CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
        material: CloudflareServerOutputMaterialRecordV1,
        activated_at_ms: u64,
    },
    LoadEcdsaPresignActivation {
        scope: CloudflareSigningWorkerWalletScopeV1,
        lookup: CloudflareActiveSigningWorkerStateLookupV1,
    },
    ClaimEcdsaPresignAuthority(crate::CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1),
    RegisterLinkedPresignSession(crate::CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1),
    AuthorizeLinkedPresignFence {
        scope: CloudflareSigningWorkerWalletScopeV1,
        presign_session_id: String,
        server_presignature_id: String,
        request: crate::SigningWorkerRelocationRequestV1,
    },
    AdmitEcdsaPresignStep(crate::CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1),
    PublishEcdsaPresignature {
        scope: CloudflareSigningWorkerWalletScopeV1,
        presign_session_id: String,
        completed_at_ms: u64,
        request: crate::CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1,
    },
    LoadEcdsaActivation {
        scope: CloudflareSigningWorkerWalletScopeV1,
        lookup: CloudflareActiveSigningWorkerStateLookupV1,
    },
    PrepareNear {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
        now_unix_ms: u64,
    },
    PrepareEcdsa {
        request:
            crate::CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
        now_unix_ms: u64,
    },
    FinalizeNear {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
        now_unix_ms: u64,
    },
    CheckEcdsaPoolAdmission {
        scope: CloudflareSigningWorkerWalletScopeV1,
    },
    FreezeEcdsaPool(crate::SigningWorkerPoolFreezeCommandV1),
    ExportEcdsaSnapshot(crate::SigningWorkerEcdsaExportRequestV1),
    ListLinkedPresignSessions(crate::SigningWorkerLinkedPresignInventoryRequestV1),
    ListPreparingLinkedPresignSessions(crate::SigningWorkerLinkedPresignPreparationInventoryRequestV1),
    RecordLinkedPresignFreeze {
        receipt: crate::SigningWorkerLinkedPresignFreezeReceiptV1,
    },
    TransferEcdsaSnapshot(crate::SigningWorkerEcdsaTransferRequestV1),
    EcdsaPoolMutate {
        scope: CloudflareSigningWorkerWalletScopeV1,
        mutation: CloudflareSigningWorkerEcdsaPoolCommandV1,
    },
    ClaimAndConsumeEcdsaEffect {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
        now_unix_ms: u64,
    },
    CommitEcdsaTerminal {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
        response: RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
        now_unix_ms: u64,
    },
}

fn digest_hex(digest: PublicDigest32) -> String {
    crate::ed25519_yao_lifecycle::role_d1::encode_hex_slice(digest.as_bytes())
}

fn request_digest_hex<T: Serialize>(
    domain: &str,
    request: &T,
) -> Result<String, RouterAbProtocolError> {
    let encoded = serde_json::to_vec(request)
        .map_err(|error| wallet_error(format!("SigningWorker request is invalid: {error}")))?;
    let mut hash = Sha256::new();
    hash.update(b"seams/signing-worker/wallet-do/v1");
    hash.update(domain.as_bytes());
    hash.update(encoded);
    Ok(crate::ed25519_yao_lifecycle::role_d1::encode_hex_slice(
        &hash.finalize(),
    ))
}

fn active_key(active: &router_ab_core::ActiveSigningWorkerStateV1) -> String {
    format!(
        "active-signing-worker/{}/{}/{}",
        active.account_id,
        active.material_activation.activation_id,
        active.signing_worker.server_id,
    )
}

fn replay_terminal(
    request: &CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    effect_digest_hex: &str,
    row: &Round1RowV1,
) -> Result<Response, RouterAbProtocolError> {
    if row.effect_request_digest_hex.as_deref() != Some(effect_digest_hex) {
        return Err(replay_error(
            "SigningWorker operation key has different request material",
        ));
    }
    let Some(terminal_json) = row.terminal_json.as_deref() else {
        return Err(replay_error(
            "SigningWorker normal-signing effect is still pending",
        ));
    };
    if row.state != "completed" {
        return Err(wallet_error(
            "SigningWorker terminal row has an invalid state",
        ));
    }
    let terminal: CloudflareSigningWorkerNormalSigningTerminalV1 =
        serde_json::from_str(terminal_json)
            .map_err(|error| wallet_error(format!("SigningWorker terminal is invalid: {error}")))?;
    terminal.validate_for_request(request)?;
    terminal_response(terminal)
}

fn terminal_response(
    terminal: CloudflareSigningWorkerNormalSigningTerminalV1,
) -> Result<Response, RouterAbProtocolError> {
    match terminal.into_result() {
        Ok(response) => Response::from_json(&response).map_err(sql_error),
        Err(error) => Response::error(
            format!("{:?}: {}", error.code(), error.message()),
            crate::cloudflare_router_error_status(error.code()),
        )
        .map_err(sql_error),
    }
}

fn replay_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ReplayedLocalRequest, message)
}

fn lifecycle_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

fn missing_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MissingLocalBinding, message)
}

impl SigningWorkerWalletDoRequestV1 {
    fn scope(&self) -> &CloudflareSigningWorkerWalletScopeV1 {
        match self {
            Self::DeliverPackages(request) => &request.scope,
            Self::FenceEd25519(command) | Self::SettleEd25519(command) => &command.scope,
            Self::Ed25519Snapshot { request } => request.scope(),
            Self::PromoteRecovery(request) => &request.scope,
            Self::LookupRegistration(request) => &request.scope,
            Self::ReserveLinkedEd25519(request) => &request.scope,
            Self::ActivateLinkedEd25519(request) => &request.scope,
            Self::DeactivateLinkedEd25519(request) => &request.scope,
            Self::ReserveLinkedEcdsa(request) => &request.scope,
            Self::ActivateLinkedEcdsa(request) => &request.scope,
            Self::DeactivateLinkedEcdsa(request) => &request.scope,
            Self::ActivateEcdsa { scope, .. }
            | Self::LoadEcdsaActivation { scope, .. }
            | Self::LoadEcdsaPresignActivation { scope, .. } => scope,
            Self::PrepareNear { scope, .. } | Self::FinalizeNear { scope, .. } => scope,
            Self::PrepareEcdsa { request, .. } => &request.wallet_scope,
            Self::EcdsaPoolMutate { scope, .. } | Self::PublishEcdsaPresignature { scope, .. } => {
                scope
            }
            Self::FreezeEcdsaPool(command) => &command.scope,
            Self::ExportEcdsaSnapshot(command) => &command.receipt.scope,
            Self::ListLinkedPresignSessions(command) => &command.scope,
            Self::ListPreparingLinkedPresignSessions(command) => &command.scope,
            Self::RecordLinkedPresignFreeze { receipt } => &receipt.command.wallet_scope,
            Self::TransferEcdsaSnapshot(command) => command.scope(),
            Self::CheckEcdsaPoolAdmission { scope } => scope,
            Self::ClaimEcdsaPresignAuthority(request) => request.authority.wallet_scope(),
            Self::RegisterLinkedPresignSession(request) => &request.wallet_scope,
            Self::AuthorizeLinkedPresignFence { scope, .. } => scope,
            Self::AdmitEcdsaPresignStep(request) => request.authority.wallet_scope(),
            Self::ClaimAndConsumeEcdsaEffect { scope, .. }
            | Self::CommitEcdsaTerminal { scope, .. } => scope,
        }
    }

    fn validate(&self) -> Result<(), RouterAbProtocolError> {
        match self {
            Self::ListLinkedPresignSessions(command) => command.scope.validate(),
            Self::ListPreparingLinkedPresignSessions(command) => command.scope.validate(),
            Self::RecordLinkedPresignFreeze { receipt } => receipt.validate(),
            Self::AuthorizeLinkedPresignFence {
                scope,
                presign_session_id,
                server_presignature_id,
                request,
            } => {
                scope.validate()?;
                request.validate()?;
                crate::require_non_empty("Linked presign session", presign_session_id)?;
                crate::require_non_empty("Linked server presignature", server_presignature_id)
            }
            Self::RegisterLinkedPresignSession(request) => request.validate_at(crate::cloudflare_now_unix_ms_v1()?),
            Self::ClaimEcdsaPresignAuthority(request) => {
                request.validate_at(crate::cloudflare_now_unix_ms_v1()?)
            }
            Self::AdmitEcdsaPresignStep(request) => {
                request.validate_at(crate::cloudflare_now_unix_ms_v1()?)
            }
            Self::DeliverPackages(request) => request.validate(),
            Self::FenceEd25519(command) | Self::SettleEd25519(command) => command.validate(),
            Self::Ed25519Snapshot { request } => request.validate(),
            Self::PromoteRecovery(request) => request.validate(),
            Self::LookupRegistration(request) => request.validate(),
            Self::ReserveLinkedEd25519(request) => request.validate(),
            Self::ActivateLinkedEd25519(request) => request.validate(),
            Self::DeactivateLinkedEd25519(request) => request.validate(),
            Self::ReserveLinkedEcdsa(request) => request.validate(),
            Self::ActivateLinkedEcdsa(request) => request.validate(),
            Self::DeactivateLinkedEcdsa(request) => request.validate(),
            Self::ActivateEcdsa {
                scope,
                activation,
                material,
                activated_at_ms,
            } => {
                scope.validate()?;
                activation.validate()?;
                material.validate()?;
                if activation.activation_context.lifecycle.account_id != scope.wallet_id {
                    return Err(wallet_error("ECDSA activation wallet owner changed"));
                }
                crate::require_positive_ms("ECDSA activation time", *activated_at_ms)
            }
            Self::LoadEcdsaActivation { scope, lookup }
            | Self::LoadEcdsaPresignActivation { scope, lookup } => {
                scope.validate()?;
                lookup.validate()?;
                if lookup.account_id != scope.wallet_id {
                    return Err(wallet_error("ECDSA activation lookup wallet owner changed"));
                }
                Ok(())
            }
            Self::PrepareNear {
                scope,
                request,
                now_unix_ms,
            } => {
                request.validate()?;
                crate::require_signing_worker_normal_signing_wallet_scope_v1(
                    scope,
                    &request.wallet_scope,
                    &request.trusted_admission.metadata,
                    &request.scope.account_id,
                )?;
                crate::require_positive_ms("SigningWorker prepare time", *now_unix_ms)
            }
            Self::PrepareEcdsa {
                request,
                now_unix_ms,
            } => {
                request.validate()?;
                crate::require_positive_ms("SigningWorker prepare time", *now_unix_ms)
            }
            Self::FinalizeNear {
                scope,
                request,
                now_unix_ms,
            } => {
                request.validate()?;
                crate::require_signing_worker_normal_signing_wallet_scope_v1(
                    scope,
                    &request.wallet_scope,
                    &request.trusted_admission.metadata,
                    &request.request.scope.account_id,
                )?;
                crate::require_positive_ms("SigningWorker finalize time", *now_unix_ms)
            }
            Self::FreezeEcdsaPool(command) => command.scope.validate(),
            Self::ExportEcdsaSnapshot(command) => command.receipt.scope.validate(),
            Self::TransferEcdsaSnapshot(command) => command.scope().validate(),
            Self::CheckEcdsaPoolAdmission { scope } => scope.validate(),
            Self::PublishEcdsaPresignature {
                scope,
                presign_session_id,
                completed_at_ms,
                request,
            } => {
                scope.validate()?;
                crate::require_non_empty("Presign session identity", presign_session_id)?;
                crate::require_positive_ms("Presign completion time", *completed_at_ms)?;
                request.validate_at(crate::cloudflare_now_unix_ms_v1()?)
            }
            Self::EcdsaPoolMutate { scope, mutation } => {
                if matches!(
                    mutation,
                    CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable { .. }
                ) {
                    return Err(wallet_error(
                        "Presign publication requires its original session identity",
                    ));
                }
                scope.validate()?;
                mutation.validate()?;
                if scope.wallet_id != mutation.scope().wallet_id {
                    return Err(wallet_error(
                        "SigningWorker ECDSA pool wallet scope changed",
                    ));
                }
                Ok(())
            }
            Self::ClaimAndConsumeEcdsaEffect {
                scope,
                request,
                now_unix_ms,
            } => {
                crate::validate_wallet_ecdsa_effect_scope_v1(scope, request)?;
                crate::require_positive_ms("SigningWorker ECDSA effect time", *now_unix_ms)
            }
            Self::CommitEcdsaTerminal {
                scope,
                request,
                response,
                now_unix_ms,
            } => {
                crate::validate_wallet_ecdsa_effect_scope_v1(scope, request)?;
                response.validate_for_request(&request.request)?;
                crate::require_positive_ms("SigningWorker ECDSA terminal time", *now_unix_ms)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WalletRegistrationV1 {
    lifecycle: SigningWorkerYaoDurableStateV1,
    activation: CloudflareSigningWorkerOutputActivationRecordV1,
}

/// One linked device's reserved Ed25519 material, and while it is active the
/// activation normal signing uses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WalletLinkedEd25519V1 {
    state: SigningWorkerYaoReservationStateV1,
    activation: Option<CloudflareSigningWorkerOutputActivationRecordV1>,
}

#[derive(Deserialize)]
struct LinkedRowV1 {
    record_key: String,
    owner_json: String,
    ciphertext_json: String,
}

#[derive(Deserialize)]
struct RegistrationRowV1 {
    registration_key: String,
    owner_json: String,
    ciphertext_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PreparedRound1V1 {
    request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    response: NormalSigningRound1PrepareResponseV1,
    record: CloudflareSigningWorkerRound1RecordV1,
}

#[derive(Serialize, Deserialize)]
struct Round1RowV1 {
    binding_key: String,
    handle: String,
    request_digest_hex: String,
    ciphertext_json: String,
    state: String,
    effect_operation_key: Option<String>,
    authorization_key: Option<String>,
    authorization_json: Option<String>,
    effect_request_digest_hex: Option<String>,
    terminal_json: Option<String>,
}

impl Round1RowV1 {
    fn validate(&self) -> Result<(), RouterAbProtocolError> {
        let claim_complete = self.effect_operation_key.is_some()
            && self.authorization_key.is_some()
            && self.authorization_json.is_some()
            && self.effect_request_digest_hex.is_some();
        let valid = match self.state.as_str() {
            "prepared" => {
                !claim_complete
                    && self.effect_operation_key.is_none()
                    && self.authorization_key.is_none()
                    && self.authorization_json.is_none()
                    && self.effect_request_digest_hex.is_none()
                    && self.terminal_json.is_none()
            }
            "claimed" => claim_complete && self.terminal_json.is_none(),
            "completed" => claim_complete && self.terminal_json.is_some(),
            _ => false,
        };
        if valid {
            Ok(())
        } else {
            Err(wallet_error(
                "SigningWorker round-1 row has an invalid lifecycle",
            ))
        }
    }
}

#[derive(Deserialize)]
struct ClaimedRowV1 {
    handle: String,
}

#[derive(Deserialize)]
struct InsertedRowV1 {
    registration_key: String,
}

/// Harness only: one lost or fenced activation, by its active key.
#[cfg(debug_assertions)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HarnessActivationFaultV1 {
    active_key: String,
    fault: String,
}

/// The wallet Durable Object's own SQLite storage, as the shared wallet
/// store's statement executor.
struct DurableObjectWalletSqlV1<'a>(&'a SqlStorage);

impl crate::SigningWorkerWalletSqlV1 for DurableObjectWalletSqlV1<'_> {
    fn query<T: serde::de::DeserializeOwned>(
        &self,
        statement: &str,
        params: Vec<crate::SigningWorkerWalletSqlValueV1>,
    ) -> Result<Vec<T>, RouterAbProtocolError> {
        let values = params
            .into_iter()
            .map(|value| match value {
                crate::SigningWorkerWalletSqlValueV1::Null => SqlStorageValue::Null,
                crate::SigningWorkerWalletSqlValueV1::Text(value) => SqlStorageValue::String(value),
                crate::SigningWorkerWalletSqlValueV1::Integer(value) => {
                    // SQLite column affinity restores the integer without an f64 conversion.
                    SqlStorageValue::String(value.to_string())
                }
            })
            .collect::<Vec<_>>();
        self.0
            .exec(statement, values)
            .map_err(sql_error)?
            .to_array::<T>()
            .map_err(sql_error)
    }
}

pub(crate) async fn call_signing_worker_wallet_do_v1(
    env: &Env,
    command: SigningWorkerWalletDoRequestV1,
) -> Result<Response, RouterAbProtocolError> {
    command.validate()?;
    let scope = command.scope();
    let name = object_name(scope)?;
    let namespace = env.durable_object(BINDING).map_err(|error| {
        wallet_error(format!("SigningWorker wallet binding is missing: {error}"))
    })?;
    let stub = namespace.get_by_name(&name).map_err(|error| {
        wallet_error(format!("SigningWorker wallet identity is invalid: {error}"))
    })?;
    let body = serde_json::to_string(&command).map_err(|error| {
        wallet_error(format!("SigningWorker wallet command is invalid: {error}"))
    })?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = Request::new_with_init(&format!("https://router-ab-do.internal{PATH}"), &init)
        .map_err(|error| wallet_error(format!("SigningWorker wallet request failed: {error}")))?;
    stub.fetch_with_request(request)
        .await
        .map_err(|error| wallet_error(format!("SigningWorker wallet call failed: {error}")))
}

#[worker::durable_object]
pub struct RouterAbSigningWorkerWalletDurableObject {
    sql: SqlStorage,
    storage: Rc<Storage>,
    env: Env,
    timing: super::command_timing::WalletCommandTiming,
}

impl DurableObject for RouterAbSigningWorkerWalletDurableObject {
    fn new(state: State, env: Env) -> Self {
        let storage = Rc::new(state.storage());
        Self {
            timing: super::command_timing::WalletCommandTiming::new(state.id().to_string()),
            sql: storage.sql(),
            storage,
            env,
        }
    }

    async fn fetch(&self, request: Request) -> worker::Result<Response> {
        let path = request.path();
        let observation = self.timing.begin("signing_worker", path);
        let result = self.fetch_wallet_request(request).await;
        observation.finish(result)
    }
}

impl RouterAbSigningWorkerWalletDurableObject {
    async fn fetch_wallet_request(&self, mut request: Request) -> worker::Result<Response> {
        #[cfg(debug_assertions)]
        if request.method() == worker::Method::Post && request.path() == HARNESS_FAULT_PATH {
            return self.record_harness_activation_fault(request.json().await?);
        }
        if request.method() != worker::Method::Post || request.path() != PATH {
            return Response::error("Unknown SigningWorker wallet object request", 404);
        }
        let command: SigningWorkerWalletDoRequestV1 = request.json().await?;
        if let Err(error) = command.validate() {
            return Response::error(error.message(), 400);
        }
        self.sql.exec(REGISTRATION_SCHEMA, None)?;
        self.sql.exec(RETIRED_ACTIVATION_SCHEMA, None)?;
        self.sql.exec(LINKED_ED25519_SCHEMA, None)?;
        self.sql.exec(ROUND1_SCHEMA, None)?;
        self.sql
            .exec(crate::SIGNING_WORKER_ED25519_EXECUTION_SCHEMA_V1, None)?;
        self.sql
            .exec(crate::SIGNING_WORKER_ED25519_FENCE_SCHEMA_V1, None)?;
        self.sql
            .exec(crate::SIGNING_WORKER_ED25519_SETTLEMENT_SCHEMA_V1, None)?;
        self.sql.exec(ed25519_snapshot::STATE_SCHEMA, None)?;
        self.sql.exec(ed25519_snapshot::CLEANUP_SCHEMA, None)?;
        self.sql.exec(ed25519_snapshot::SEGMENT_SCHEMA, None)?;
        self.sql.exec(ed25519_snapshot::IMPORT_SCHEMA, None)?;
        self.sql.exec(ed25519_snapshot::IMPORT_SEGMENT_SCHEMA, None)?;
        for schema in crate::SIGNING_WORKER_WALLET_ECDSA_SCHEMA_V1 {
            self.sql.exec(schema, None)?;
        }
        match self.execute(command).await {
            Ok(response) => Ok(response),
            Err(error) => Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                crate::cloudflare_router_error_status(error.code()),
            ),
        }
    }

    async fn execute(
        &self,
        command: SigningWorkerWalletDoRequestV1,
    ) -> Result<Response, RouterAbProtocolError> {
        match command {
            SigningWorkerWalletDoRequestV1::Ed25519Snapshot { request } => {
                self.with_wallet_transaction(move |wallet| wallet.ed25519_snapshot(request)).await
            }
            SigningWorkerWalletDoRequestV1::SettleEd25519(command) => {
                self.with_wallet_transaction(move |wallet| wallet.settle_ed25519(command))
                    .await
            }
            SigningWorkerWalletDoRequestV1::FenceEd25519(command) => {
                self.with_wallet_transaction(move |wallet| {
                    let sql = DurableObjectWalletSqlV1(&wallet.sql);
                    let receipt =
                        crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql).fence(command)?;
                    Response::from_json(&receipt).map_err(sql_error)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::DeliverPackages(request) => {
                match request.delivery.deriver_a.binding.operation {
                    Ed25519YaoOperationV1::Registration => self.with_wallet_transaction(move |wallet| wallet.deliver_registration(request)).await,
                    Ed25519YaoOperationV1::Recovery => self.with_wallet_transaction(move |wallet| wallet.deliver_recovery(request)).await,
                    _ => Err(wallet_error(
                        "SigningWorker wallet object accepts registration and recovery deliveries only",
                    )),
                }
            }
            SigningWorkerWalletDoRequestV1::PromoteRecovery(request) => {
                self.with_wallet_transaction(move |wallet| wallet.promote_recovery(request))
                    .await
            }
            SigningWorkerWalletDoRequestV1::LookupRegistration(request) => {
                self.lookup_registration(request)
            }
            SigningWorkerWalletDoRequestV1::ReserveLinkedEd25519(request) => {
                self.with_wallet_transaction(move |wallet| wallet.reserve_linked_ed25519(request))
                    .await
            }
            SigningWorkerWalletDoRequestV1::ActivateLinkedEd25519(request) => {
                self.with_wallet_transaction(move |wallet| wallet.activate_linked_ed25519(request))
                    .await
            }
            SigningWorkerWalletDoRequestV1::DeactivateLinkedEd25519(request) => {
                self.with_wallet_transaction(move |wallet| {
                    wallet.deactivate_linked_ed25519(request)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::ReserveLinkedEcdsa(request) => {
                let server_key = self.server_output_key()?;
                self.with_ecdsa_transaction(move |store| {
                    store.reserve_linked(&request, &server_key)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::ActivateLinkedEcdsa(request) => {
                let server_key = self.server_output_key()?;
                let activated_at_ms = crate::cloudflare_now_unix_ms_v1()?;
                self.with_ecdsa_transaction(move |store| {
                    store.activate_linked(&request, &server_key, activated_at_ms)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::DeactivateLinkedEcdsa(request) => {
                let now_unix_ms = crate::cloudflare_now_unix_ms_v1()?;
                self.with_ecdsa_transaction(move |store| {
                    store.deactivate_linked(&request, now_unix_ms)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::ActivateEcdsa {
                scope,
                activation,
                material,
                activated_at_ms,
            } => {
                self.with_ecdsa_transaction(move |store| {
                    store.activate(scope, activation, material, activated_at_ms)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::LoadEcdsaPresignActivation { scope, lookup } => {
                let sql = DurableObjectWalletSqlV1(&self.sql);
                self.open_ecdsa_store(&sql)?
                    .require_mutation_admission(&scope)?;
                self.load_ecdsa_activation(scope, lookup)
            }
            SigningWorkerWalletDoRequestV1::LoadEcdsaActivation { scope, lookup } => {
                self.load_ecdsa_activation(scope, lookup)
            }
            SigningWorkerWalletDoRequestV1::PrepareNear {
                scope,
                request,
                now_unix_ms,
            } => {
                self.with_wallet_transaction(move |wallet| {
                    wallet.prepare_near(scope, request, now_unix_ms)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::PrepareEcdsa {
                request,
                now_unix_ms,
            } => {
                let mut contribution = [0u8; 32];
                contribution.copy_from_slice(&crate::cloudflare_random_bytes_v1(32)?);
                self.with_ecdsa_transaction(move |store| {
                    crate::prepare_signing_worker_wallet_ecdsa_from_pool_v1(
                        store,
                        request,
                        now_unix_ms,
                        contribution,
                    )
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::FinalizeNear {
                scope,
                request,
                now_unix_ms,
            } => {
                self.with_wallet_transaction(move |wallet| {
                    wallet.finalize_near(scope, request, now_unix_ms)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::CheckEcdsaPoolAdmission { scope } => {
                let sql = DurableObjectWalletSqlV1(&self.sql);
                Response::from_json(&self.open_ecdsa_store(&sql)?.pool_admission(&scope)?)
                    .map_err(sql_error)
            }
            SigningWorkerWalletDoRequestV1::ClaimEcdsaPresignAuthority(request) => {
                let now_unix_ms = crate::cloudflare_now_unix_ms_v1()?;
                self.with_ecdsa_transaction(move |store| {
                    store.claim_presign_authority(&request, now_unix_ms)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::RegisterLinkedPresignSession(request) => {
                let now_unix_ms = crate::cloudflare_now_unix_ms_v1()?;
                self.with_ecdsa_transaction(move |store| store.register_linked_presign_session(&request, now_unix_ms)).await
            }
            SigningWorkerWalletDoRequestV1::AuthorizeLinkedPresignFence {
                scope,
                presign_session_id,
                server_presignature_id,
                request,
            } => {
                self.with_ecdsa_transaction(move |store| {
                    store.authorize_linked_presign_fence(
                        &scope,
                        &presign_session_id,
                        &server_presignature_id,
                        &request,
                    )
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::PublishEcdsaPresignature {
                scope,
                presign_session_id,
                completed_at_ms,
                request,
            } => {
                self.with_ecdsa_transaction(move |store| {
                    crate::admit_signing_worker_wallet_ecdsa_presignature_v1(
                        store,
                        &scope,
                        &presign_session_id,
                        completed_at_ms,
                        request,
                        crate::cloudflare_now_unix_ms_v1()?,
                    )
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::AdmitEcdsaPresignStep(request) => {
                let sql = DurableObjectWalletSqlV1(&self.sql);
                self.open_ecdsa_store(&sql)?.admit_presign_step(
                    &request,
                    crate::cloudflare_now_unix_ms_v1()?,
                )?;
                Response::from_json(&()).map_err(sql_error)
            }
            SigningWorkerWalletDoRequestV1::TransferEcdsaSnapshot(command) => {
                self.with_ecdsa_transaction(move |store| store.transfer_ecdsa_snapshot(command)).await
            }
            SigningWorkerWalletDoRequestV1::ExportEcdsaSnapshot(command) => {
                self.with_ecdsa_transaction(move |store| store.export_ecdsa_snapshot(command)).await
            }
            SigningWorkerWalletDoRequestV1::RecordLinkedPresignFreeze { receipt } => {
                self.with_ecdsa_transaction(move |store| {
                    store.record_linked_presign_freeze(receipt)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::ListPreparingLinkedPresignSessions(command) => {
                self.with_ecdsa_transaction(move |store| {
                    store.list_preparing_linked_presign_sessions(command)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::ListLinkedPresignSessions(command) => {
                self.with_ecdsa_transaction(move |store| {
                    store.list_relocating_linked_presign_sessions(command)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::FreezeEcdsaPool(command) => {
                self.with_ecdsa_transaction(move |store| {
                    store.freeze_pool_for_relocation(command.scope, command.request)
                })
                .await
            }
            SigningWorkerWalletDoRequestV1::EcdsaPoolMutate { scope, mutation } => {
                self.with_ecdsa_transaction(move |store| store.mutate_pool(scope, mutation))
                    .await
            }
            SigningWorkerWalletDoRequestV1::ClaimAndConsumeEcdsaEffect {
                scope,
                request,
                now_unix_ms,
            } => {
                self.claim_and_consume_ecdsa_effect(scope, request, now_unix_ms)
                    .await
            }
            SigningWorkerWalletDoRequestV1::CommitEcdsaTerminal {
                scope,
                request,
                response,
                now_unix_ms,
            } => {
                self.with_ecdsa_transaction(move |store| {
                    store.commit_terminal(&scope, &request, &response, now_unix_ms)
                })
                .await
            }
        }
    }

    fn load_ecdsa_activation(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        lookup: CloudflareActiveSigningWorkerStateLookupV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let sql = DurableObjectWalletSqlV1(&self.sql);
        let loaded = self
            .open_ecdsa_store(&sql)?
            .load_activation(&scope, &lookup)?;
        Response::from_json(&loaded).map_err(sql_error)
    }

    async fn claim_and_consume_ecdsa_effect(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
        now_unix_ms: u64,
    ) -> Result<Response, RouterAbProtocolError> {
        self.with_ecdsa_transaction(move |store| {
            store.claim_and_consume_effect(scope, request, now_unix_ms)
        })
        .await
    }

    fn server_output_key(
        &self,
    ) -> Result<crate::SigningWorkerServerOutputKeyV1, RouterAbProtocolError> {
        crate::SigningWorkerServerOutputKeyV1::load(
            &CloudflareSigningWorkerRuntimeV1::from_worker_env(&self.env)?,
            &crate::CloudflareWorkerEnvReaderV1::new(&self.env),
        )
    }

    fn open_ecdsa_store<'a>(
        &self,
        sql: &'a DurableObjectWalletSqlV1<'a>,
    ) -> Result<
        crate::SigningWorkerWalletEcdsaStoreV1<'a, DurableObjectWalletSqlV1<'a>>,
        RouterAbProtocolError,
    > {
        crate::SigningWorkerWalletEcdsaStoreV1::open(
            sql,
            &crate::CloudflareWorkerEnvReaderV1::new(&self.env),
        )
    }

    fn deliver_registration(
        &self,
        request: CloudflareScopedEd25519YaoPackagePairDeliveryV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let binding = &request.delivery.deriver_a.binding;
        if binding.operation != Ed25519YaoOperationV1::Registration {
            return Err(wallet_error(
                "SigningWorker wallet object accepts initial registration only",
            ));
        }
        let registration_key = registration_key(binding);
        if let Some(stored) = self.read_registration(&request.scope, &registration_key)? {
            return self.replay_registration(&request, stored);
        }
        let candidate = combine_signing_worker_yao_packages_v1(&self.env, &request.delivery, None)?;
        let (material, receipt) = candidate.into_parts();
        let runtime = CloudflareSigningWorkerRuntimeV1::from_worker_env(&self.env)?;
        let activation = build_output_activation_record(&runtime, &material, &receipt)?;
        let lifecycle = SigningWorkerYaoDurableStateV1::Active {
            deriver_a: request.delivery.deriver_a.clone(),
            deriver_b: request.delivery.deriver_b.clone(),
            material,
            receipt: receipt.clone(),
        };
        lifecycle.validate()?;
        let stored = WalletRegistrationV1 {
            lifecycle,
            activation,
        };
        let owner_json = serde_json::to_string(&request.scope).map_err(|error| {
            wallet_error(format!("SigningWorker wallet owner is invalid: {error}"))
        })?;
        let cipher = SigningWorkerPrivateD1CipherV1::from_env_for_wallet_do(&self.env)?;
        let ciphertext = cipher.seal(
            "registration",
            &registration_identity(&request.scope, &registration_key)?,
            &stored,
        )?;
        let active_key = active_key(stored.activation.active_signing_worker_state());
        let inserted = self.sql.exec(
            "INSERT INTO wallet_registrations (registration_key, active_key, owner_json, ciphertext_json)
             VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING registration_key",
            vec![
                SqlStorageValue::String(registration_key.clone()),
                SqlStorageValue::String(active_key),
                SqlStorageValue::String(owner_json),
                SqlStorageValue::String(ciphertext),
            ],
        ).map_err(sql_error)?.to_array::<InsertedRowV1>().map_err(sql_error)?;
        if inserted.len() == 1 && inserted[0].registration_key == registration_key {
            let sql = DurableObjectWalletSqlV1(&self.sql);
            crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql).register(&request.scope)?;
            return Response::from_json(&http_active_receipt(receipt)).map_err(sql_error);
        }
        let existing = self
            .read_registration(&request.scope, &registration_key)?
            .ok_or_else(|| wallet_error("SigningWorker registration write is uncertain"))?;
        self.replay_registration(&request, existing)
    }

    /// Settles a recovery delivery on the wallet's lifecycle, as every
    /// SigningWorker store does. A staged candidate is stored with the
    /// lifecycle; the activation that signs stays the active one until the
    /// recovery promotes.
    fn deliver_recovery(
        &self,
        request: CloudflareScopedEd25519YaoPackagePairDeliveryV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let registration_key = registration_key(&request.delivery.deriver_a.binding);
        let attempt = request
            .recovery_attempt
            .ok_or_else(|| wallet_error("SigningWorker recovery names no attempt"))?;
        let stored = self.read_registration(&request.scope, &registration_key)?;
        let settled = settle_signing_worker_yao_recovery_delivery_v1(
            stored.as_ref().map(|stored| stored.lifecycle.clone()),
            &request.delivery,
            attempt,
            |active| {
                combine_signing_worker_yao_packages_v1(&self.env, &request.delivery, Some(active))
            },
        )?;
        let receipt = settled.receipt().clone();
        if let SigningWorkerYaoRecoveryDeliveryV1::Stage { state: staged, .. } = settled {
            self.require_ed25519_unfenced(&request.scope)?;
            let stored = stored.ok_or_else(|| {
                wallet_error("SigningWorker recovery staged without a stored lifecycle")
            })?;
            let activation = stored.activation.clone();
            self.replace_registration(
                &request.scope,
                &registration_key,
                &stored,
                WalletRegistrationV1 {
                    lifecycle: staged,
                    activation,
                },
            )?;
        }
        Response::from_json(&http_staged_receipt(receipt)).map_err(sql_error)
    }

    /// Promotes the exact staged recovery candidate. In one write the
    /// wallet's row takes the promoted lifecycle and its activation, and the
    /// activation it replaces is retired: no request signs with it again,
    /// though a signature it already made still answers.
    fn promote_recovery(
        &self,
        request: CloudflareScopedEd25519YaoRecoveryPromotionRequestV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let registration_key = registration_key(&request.promotion.binding);
        let stored = self.read_registration(&request.scope, &registration_key)?;
        let settled = settle_signing_worker_yao_recovery_promotion_v1(
            stored.as_ref().map(|stored| stored.lifecycle.clone()),
            &request.promotion,
        )?;
        let stored = stored
            .ok_or_else(|| wallet_error("SigningWorker promotion has no stored lifecycle"))?;
        match settled {
            SigningWorkerYaoRecoveryPromotionV1::Repeat { material, receipt } => {
                if stored
                    .activation
                    .active_signing_worker_state()
                    .material_activation
                    != *material.binding().material_activation()
                {
                    return Err(wallet_error(
                        "SigningWorker promoted activation conflicts with durable state",
                    ));
                }
                Response::from_json(&http_active_receipt(receipt)).map_err(sql_error)
            }
            SigningWorkerYaoRecoveryPromotionV1::Promote { active, retired } => {
                self.require_ed25519_unfenced(&request.scope)?;
                let retired_state = stored.activation.active_signing_worker_state();
                if retired_state.material_activation != *retired.binding().material_activation() {
                    return Err(wallet_error(
                        "SigningWorker recovery would retire an activation it does not hold",
                    ));
                }
                let retired_key = active_key(retired_state);
                let SigningWorkerYaoDurableStateV1::Active {
                    material, receipt, ..
                } = &active
                else {
                    unreachable!("promotion constructs active state");
                };
                let runtime = CloudflareSigningWorkerRuntimeV1::from_worker_env(&self.env)?;
                let activation = build_output_activation_record(&runtime, material, receipt)?;
                let receipt = receipt.clone();
                // No await separates these writes, so they commit together.
                self.replace_registration(
                    &request.scope,
                    &registration_key,
                    &stored,
                    WalletRegistrationV1 {
                        lifecycle: active,
                        activation,
                    },
                )?;
                self.sql
                    .exec(
                        "INSERT INTO wallet_retired_activations (active_key, registration_key)
                         VALUES (?, ?) ON CONFLICT (active_key) DO NOTHING",
                        vec![
                            SqlStorageValue::String(retired_key),
                            SqlStorageValue::String(registration_key),
                        ],
                    )
                    .map_err(sql_error)?;
                Response::from_json(&http_active_receipt(receipt)).map_err(sql_error)
            }
        }
    }

    /// Replaces the stored registration `previous` with `next`, provided the
    /// row still holds `previous`'s activation.
    fn replace_registration(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        registration_key: &str,
        previous: &WalletRegistrationV1,
        next: WalletRegistrationV1,
    ) -> Result<(), RouterAbProtocolError> {
        next.lifecycle.validate()?;
        next.activation.validate()?;
        let next_active_key = active_key(next.activation.active_signing_worker_state());
        if self.activation_retired(&next_active_key)? {
            return Err(signing_worker_activation_retired_error_v1());
        }
        let cipher = SigningWorkerPrivateD1CipherV1::from_env_for_wallet_do(&self.env)?;
        let ciphertext = cipher.seal(
            "registration",
            &registration_identity(scope, registration_key)?,
            &next,
        )?;
        let updated = self
            .sql
            .exec(
                "UPDATE wallet_registrations SET active_key = ?, ciphertext_json = ?
                 WHERE registration_key = ? AND active_key = ? RETURNING registration_key",
                vec![
                    SqlStorageValue::String(next_active_key),
                    SqlStorageValue::String(ciphertext),
                    SqlStorageValue::String(registration_key.to_owned()),
                    SqlStorageValue::String(active_key(
                        previous.activation.active_signing_worker_state(),
                    )),
                ],
            )
            .map_err(sql_error)?
            .to_array::<InsertedRowV1>()
            .map_err(sql_error)?;
        if updated.len() != 1 {
            return Err(wallet_error(
                "SigningWorker registration changed while it was written",
            ));
        }
        Ok(())
    }

    fn activation_retired(&self, active_key: &str) -> Result<bool, RouterAbProtocolError> {
        Ok(!self
            .sql
            .exec(
                "SELECT active_key AS registration_key FROM wallet_retired_activations WHERE active_key = ?",
                vec![SqlStorageValue::String(active_key.to_owned())],
            )
            .map_err(sql_error)?
            .to_array::<InsertedRowV1>()
            .map_err(sql_error)?
            .is_empty())
    }

    fn replay_registration(
        &self,
        request: &CloudflareScopedEd25519YaoPackagePairDeliveryV1,
        stored: WalletRegistrationV1,
    ) -> Result<Response, RouterAbProtocolError> {
        stored.lifecycle.validate()?;
        stored.activation.validate()?;
        let SigningWorkerYaoDurableStateV1::Active {
            deriver_a,
            deriver_b,
            receipt,
            ..
        } = stored.lifecycle
        else {
            return Err(wallet_error("SigningWorker registration is unfinished"));
        };
        if deriver_a != request.delivery.deriver_a || deriver_b != request.delivery.deriver_b {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "SigningWorker registration delivery conflicts with durable state",
            ));
        }
        let expected = stored.activation.active_signing_worker_state();
        if expected.account_id != request.scope.wallet_id
            || expected.activation_transcript_digest
                != router_ab_core::PublicDigest32::new(receipt.transcript)
        {
            return Err(wallet_error(
                "SigningWorker registration activation conflicts with durable state",
            ));
        }
        Response::from_json(&http_active_receipt(receipt)).map_err(sql_error)
    }

    fn lookup_registration(
        &self,
        request: CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let key = registration_key(&request.delivery.deriver_a.binding);
        let snapshot = match self.read_registration(&request.scope, &key)? {
            Some(stored) => CloudflareSigningWorkerInitialRegistrationFinalizationSnapshotV1 {
                lifecycle: Some(stored.lifecycle),
                activation: Some(stored.activation),
                fenced: false,
            },
            None => CloudflareSigningWorkerInitialRegistrationFinalizationSnapshotV1 {
                lifecycle: None,
                activation: None,
                fenced: false,
            },
        };
        #[cfg(debug_assertions)]
        let snapshot = self.with_harness_activation_fault(snapshot)?;
        let result = evaluate_initial_registration_finalization_v1(&request, snapshot)?;
        Response::from_json(&result).map_err(sql_error)
    }

    /// Harness only: marks one stored registration's activation lost or
    /// fenced. The record itself is left as it is.
    #[cfg(debug_assertions)]
    fn record_harness_activation_fault(
        &self,
        fault: HarnessActivationFaultV1,
    ) -> worker::Result<Response> {
        let stored = self
            .sql
            .exec(
                "SELECT registration_key FROM wallet_registrations WHERE active_key = ?",
                vec![SqlStorageValue::String(fault.active_key.clone())],
            )?
            .to_array::<InsertedRowV1>()?;
        if stored.len() != 1 {
            return Response::error("SigningWorker registration activation is missing", 404);
        }
        self.sql.exec(HARNESS_FAULT_SCHEMA, None)?;
        self.sql.exec(
            "INSERT INTO harness_activation_faults (active_key, fault) VALUES (?, ?)
             ON CONFLICT (active_key) DO UPDATE SET fault = excluded.fault",
            vec![
                SqlStorageValue::String(fault.active_key),
                SqlStorageValue::String(fault.fault),
            ],
        )?;
        Response::empty()
    }

    /// Harness only: the lookup's snapshot with a recorded fault applied. A
    /// lost activation is absent; a fenced one is absent and fenced, as the
    /// role store reports an exact deactivation.
    #[cfg(debug_assertions)]
    fn with_harness_activation_fault(
        &self,
        mut snapshot: CloudflareSigningWorkerInitialRegistrationFinalizationSnapshotV1<
            SigningWorkerYaoDurableStateV1,
        >,
    ) -> Result<
        CloudflareSigningWorkerInitialRegistrationFinalizationSnapshotV1<
            SigningWorkerYaoDurableStateV1,
        >,
        RouterAbProtocolError,
    > {
        let Some(activation) = &snapshot.activation else {
            return Ok(snapshot);
        };
        self.sql
            .exec(HARNESS_FAULT_SCHEMA, None)
            .map_err(sql_error)?;
        let faults = self
            .sql
            .exec(
                "SELECT active_key, fault FROM harness_activation_faults WHERE active_key = ?",
                vec![SqlStorageValue::String(active_key(
                    activation.active_signing_worker_state(),
                ))],
            )
            .map_err(sql_error)?
            .to_array::<HarnessActivationFaultV1>()
            .map_err(sql_error)?;
        if let Some(fault) = faults.first() {
            snapshot.activation = None;
            snapshot.fenced = fault.fault == "fenced";
        }
        Ok(snapshot)
    }

    fn prepare_near(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
        now_unix_ms: u64,
    ) -> Result<Response, RouterAbProtocolError> {
        let sql = DurableObjectWalletSqlV1(&self.sql);
        crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql)
            .require_generation(&scope, request.ownership_generation)?;
        crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql).require_unfenced(&scope)?;
        // A prepare needs an activation that still signs, replay or not.
        let activation = self.load_near_activation(&scope, &request.material_source)?;
        let binding_key = digest_hex(request.round1_binding_digest()?);
        let request_digest_hex = request_digest_hex("near-prepare", &request)?;
        if let Some(row) = self.read_round1("binding_key", &binding_key)? {
            return self.replay_prepare(&scope, &request, now_unix_ms, &request_digest_hex, row);
        }
        let prepared = handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2(
            &CloudflareEd25519YaoNormalSigningHandlerV1,
            now_unix_ms,
            request.clone(),
            activation.active_signing_worker_state().clone(),
            activation.material().clone(),
        )?;
        let stored = PreparedRound1V1 {
            request,
            response: prepared.response.clone(),
            record: prepared.record,
        };
        let cipher = SigningWorkerPrivateD1CipherV1::from_env_for_wallet_do(&self.env)?;
        let ciphertext = cipher.seal(
            "round1",
            &registration_identity(&scope, &binding_key)?,
            &stored,
        )?;
        let inserted = self
            .sql
            .exec(
                "INSERT INTO wallet_round1
             (binding_key, handle, request_digest_hex, ciphertext_json, state)
             VALUES (?, ?, ?, ?, 'prepared')
             ON CONFLICT DO NOTHING RETURNING handle",
                vec![
                    SqlStorageValue::String(binding_key.clone()),
                    SqlStorageValue::String(stored.record.server_round1_handle.clone()),
                    SqlStorageValue::String(request_digest_hex.clone()),
                    SqlStorageValue::String(ciphertext),
                ],
            )
            .map_err(sql_error)?
            .to_array::<ClaimedRowV1>()
            .map_err(sql_error)?;
        if inserted.len() == 1 && inserted[0].handle == stored.record.server_round1_handle {
            return Response::from_json(&stored.response).map_err(sql_error);
        }
        let existing = self
            .read_round1("binding_key", &binding_key)?
            .ok_or_else(|| wallet_error("SigningWorker round-1 write is uncertain"))?;
        self.replay_prepare(
            &scope,
            &stored.request,
            now_unix_ms,
            &request_digest_hex,
            existing,
        )
    }

    fn replay_prepare(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        request: &CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
        now_unix_ms: u64,
        request_digest_hex: &str,
        row: Round1RowV1,
    ) -> Result<Response, RouterAbProtocolError> {
        if row.request_digest_hex != request_digest_hex {
            return Err(replay_error(
                "SigningWorker round-1 binding has different request material",
            ));
        }
        if row.state != "prepared" {
            return Err(replay_error(
                "SigningWorker round-1 material is already consumed",
            ));
        }
        let stored = self.open_round1(scope, &row)?;
        if stored.request != *request || now_unix_ms >= stored.record.expires_at_ms {
            return Err(replay_error(
                "SigningWorker round-1 retry is changed or expired",
            ));
        }
        Response::from_json(&stored.response).map_err(sql_error)
    }

    fn finalize_near(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
        now_unix_ms: u64,
    ) -> Result<Response, RouterAbProtocolError> {
        let operation_key = request.effect_operation_key()?;
        let effect_digest_hex = digest_hex(request.effect_request_digest()?);
        if let Some(row) = self.read_round1("effect_operation_key", &operation_key)? {
            return replay_terminal(&request, &effect_digest_hex, &row);
        }
        let sql = DurableObjectWalletSqlV1(&self.sql);
        crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql)
            .require_generation(&scope, request.ownership_generation)?;
        crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql)
            .require_finalization_admission(&scope)?;
        // Before expiry: a delayed request for a retired activation is refused
        // as retired.
        let activation = self.load_near_activation(&scope, &request.material_source)?;
        request.request.validate_at(now_unix_ms)?;
        let authorization_key = request.effect_claim.near_authorization_key();
        if self
            .read_round1("authorization_key", &authorization_key)?
            .is_some()
        {
            return Err(replay_error(
                "SigningWorker authorization already claimed another effect",
            ));
        }
        let active = activation.active_signing_worker_state().clone();
        let round1_handle = request.request.server_round1_handle().to_owned();
        let row = self
            .read_round1("handle", &round1_handle)?
            .ok_or_else(|| missing_error("SigningWorker round-1 material is missing"))?;
        if row.state != "prepared" {
            return Err(replay_error(
                "SigningWorker round-1 material is already consumed",
            ));
        }
        let stored = self.open_round1(&scope, &row)?;
        let lookup = CloudflareSigningWorkerRound1LookupV1::new(
            active.clone(),
            round1_handle.clone(),
            request.request.round1_binding_digest(),
            now_unix_ms,
        )?;
        stored.record.validate_for_lookup(&lookup)?;
        if stored.request.ownership_generation != request.ownership_generation {
            return Err(replay_error(
                "SigningWorker finalize generation differs from prepared round-1",
            ));
        }
        if stored.request.scope != request.request.scope {
            return Err(replay_error(
                "SigningWorker finalize scope differs from prepared round-1",
            ));
        }
        let authorization_json = serde_json::to_string(&request.effect_claim).map_err(|error| {
            wallet_error(format!("SigningWorker authorization is invalid: {error}"))
        })?;
        let claimed = self
            .sql
            .exec(
                "UPDATE wallet_round1
             SET state = 'claimed', effect_operation_key = ?, authorization_key = ?,
                 authorization_json = ?, effect_request_digest_hex = ?
             WHERE handle = ? AND state = 'prepared' AND binding_key = ?
             RETURNING handle",
                vec![
                    SqlStorageValue::String(operation_key.clone()),
                    SqlStorageValue::String(authorization_key),
                    SqlStorageValue::String(authorization_json),
                    SqlStorageValue::String(effect_digest_hex.clone()),
                    SqlStorageValue::String(round1_handle.clone()),
                    SqlStorageValue::String(row.binding_key),
                ],
            )
            .map_err(sql_error)?
            .to_array::<ClaimedRowV1>()
            .map_err(sql_error)?;
        if claimed.len() != 1 || claimed[0].handle != round1_handle {
            return Err(replay_error(
                "SigningWorker round-1 claim lost to another execution",
            ));
        }
        let terminal = CloudflareSigningWorkerNormalSigningTerminalV1::from_result(
            handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2(
                &CloudflareEd25519YaoNormalSigningHandlerV1,
                now_unix_ms,
                request.clone(),
                active,
                activation.material().clone(),
                stored.record,
            ),
        );
        terminal.validate_for_request(&request)?;
        let terminal_json = serde_json::to_string(&terminal)
            .map_err(|error| wallet_error(format!("SigningWorker terminal is invalid: {error}")))?;
        let committed = self
            .sql
            .exec(
                "UPDATE wallet_round1 SET state = 'completed', terminal_json = ?
             WHERE handle = ? AND state = 'claimed' AND effect_operation_key = ?
                   AND effect_request_digest_hex = ? RETURNING handle",
                vec![
                    SqlStorageValue::String(terminal_json),
                    SqlStorageValue::String(round1_handle),
                    SqlStorageValue::String(operation_key.clone()),
                    SqlStorageValue::String(effect_digest_hex.clone()),
                ],
            )
            .map_err(sql_error)?
            .to_array::<ClaimedRowV1>()
            .map_err(sql_error)?;
        if committed.len() == 1 {
            return terminal_response(terminal);
        }
        let row = self
            .read_round1("effect_operation_key", &operation_key)?
            .ok_or_else(|| wallet_error("SigningWorker terminal write is uncertain"))?;
        replay_terminal(&request, &effect_digest_hex, &row)
    }

    /// The material a linked device's reservation is made from: the wallet's
    /// active registration material, or an active linked device's.
    fn linked_ed25519_source_material(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        source_binding: &router_ab_core::Ed25519YaoCeremonyBindingV1,
    ) -> Result<router_ab_ed25519_yao::Ed25519YaoActiveSigningMaterialV1, RouterAbProtocolError>
    {
        let source_key = reservation_record_key_from_binding_v1(source_binding)?;
        if let Some(linked) = self.read_linked_ed25519(scope, &source_key)? {
            return match linked.state {
                SigningWorkerYaoReservationStateV1::Active {
                    delivery,
                    candidate,
                    ..
                } if delivery.deriver_a.binding == *source_binding
                    && candidate.binding() == source_binding =>
                {
                    Ok(candidate)
                }
                SigningWorkerYaoReservationStateV1::Inactive { delivery, .. }
                | SigningWorkerYaoReservationStateV1::Activating { delivery, .. }
                    if delivery.deriver_a.binding == *source_binding =>
                {
                    Err(lifecycle_error(
                        "source Ed25519 material reservation is not active",
                    ))
                }
                SigningWorkerYaoReservationStateV1::Deactivating { binding, .. }
                | SigningWorkerYaoReservationStateV1::Revoked { binding, .. }
                    if binding == *source_binding =>
                {
                    Err(lifecycle_error(
                        "source Ed25519 material reservation is revoked",
                    ))
                }
                _ => Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ConflictingPair,
                    "source Ed25519 material activation identity conflicts with the reservation",
                )),
            };
        }
        let registration = self
            .read_registration(scope, &registration_key(source_binding))?
            .ok_or_else(|| missing_error("source Ed25519 material is missing"))?;
        match registration.lifecycle {
            SigningWorkerYaoDurableStateV1::Active { material, .. }
                if material.binding() == source_binding =>
            {
                Ok(material)
            }
            SigningWorkerYaoDurableStateV1::Active { .. } => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "source Ed25519 material activation identity conflicts with the lifecycle state",
            )),
            SigningWorkerYaoDurableStateV1::RegistrationStaged { .. }
            | SigningWorkerYaoDurableStateV1::RecoveryStaged { .. } => Err(lifecycle_error(
                "source Ed25519 material reservation is not active",
            )),
        }
    }

    fn read_linked_ed25519(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        record_key: &str,
    ) -> Result<Option<WalletLinkedEd25519V1>, RouterAbProtocolError> {
        let rows = self.sql.exec(
            "SELECT record_key, owner_json, ciphertext_json FROM wallet_linked_ed25519 WHERE record_key = ?",
            vec![SqlStorageValue::String(record_key.to_owned())],
        ).map_err(sql_error)?.to_array::<LinkedRowV1>().map_err(sql_error)?;
        match rows.as_slice() {
            [] => Ok(None),
            [row] => Ok(Some(self.decode_linked_row(scope, row)?)),
            _ => Err(wallet_error(
                "SigningWorker linked Ed25519 lookup returned duplicate rows",
            )),
        }
    }

    fn load_linked_near_activation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        lookup: &CloudflareActiveSigningWorkerStateLookupV1,
        active_key: &str,
    ) -> Result<CloudflareSigningWorkerOutputActivationRecordV1, RouterAbProtocolError> {
        let rows = self.sql.exec(
            "SELECT record_key, owner_json, ciphertext_json FROM wallet_linked_ed25519 WHERE active_key = ?",
            vec![SqlStorageValue::String(active_key.to_owned())],
        ).map_err(sql_error)?.to_array::<LinkedRowV1>().map_err(sql_error)?;
        let [row] = rows.as_slice() else {
            return Err(missing_error(
                "SigningWorker registration material is missing",
            ));
        };
        let stored = self.decode_linked_row(scope, row)?;
        let (SigningWorkerYaoReservationStateV1::Active { .. }, Some(activation)) =
            (&stored.state, stored.activation)
        else {
            return Err(missing_error("SigningWorker linked material is inactive"));
        };
        activation.validate()?;
        lookup.validate_active_state(activation.active_signing_worker_state())?;
        Ok(activation)
    }

    fn decode_linked_row(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        row: &LinkedRowV1,
    ) -> Result<WalletLinkedEd25519V1, RouterAbProtocolError> {
        let owner_json = serde_json::to_string(scope).map_err(|error| {
            wallet_error(format!("SigningWorker wallet owner is invalid: {error}"))
        })?;
        if row.owner_json != owner_json {
            return Err(wallet_error("SigningWorker wallet owner conflict"));
        }
        let cipher = SigningWorkerPrivateD1CipherV1::from_env_for_wallet_do(&self.env)?;
        let stored: WalletLinkedEd25519V1 = cipher.open(
            "linked_ed25519",
            &registration_identity(scope, &row.record_key)?,
            &row.ciphertext_json,
        )?;
        stored.state.validate()?;
        Ok(stored)
    }

    fn seal_linked_ed25519(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        record_key: &str,
        stored: &WalletLinkedEd25519V1,
    ) -> Result<String, RouterAbProtocolError> {
        let cipher = SigningWorkerPrivateD1CipherV1::from_env_for_wallet_do(&self.env)?;
        cipher.seal(
            "linked_ed25519",
            &registration_identity(scope, record_key)?,
            stored,
        )
    }

    fn load_near_activation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        source: &CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    ) -> Result<CloudflareSigningWorkerOutputActivationRecordV1, RouterAbProtocolError> {
        let CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation { lookup } =
            source
        else {
            return Err(wallet_error(
                "SigningWorker wallet object requires registration material",
            ));
        };
        let key = format!(
            "active-signing-worker/{}/{}/{}",
            lookup.account_id, lookup.material_activation_id, lookup.signing_worker_id,
        );
        if self.activation_retired(&key)? {
            return Err(signing_worker_activation_retired_error_v1());
        }
        let rows = self.sql.exec(
            "SELECT registration_key, owner_json, ciphertext_json FROM wallet_registrations WHERE active_key = ?",
            vec![SqlStorageValue::String(key.clone())],
        ).map_err(sql_error)?.to_array::<RegistrationRowV1>().map_err(sql_error)?;
        let [row] = rows.as_slice() else {
            // A linked device signs with its own activation of this wallet.
            return self.load_linked_near_activation(scope, lookup, &key);
        };
        let stored = self.decode_registration_row(scope, row)?;
        if !matches!(
            stored.lifecycle,
            SigningWorkerYaoDurableStateV1::Active { .. }
                | SigningWorkerYaoDurableStateV1::RecoveryStaged { .. }
        ) {
            return Err(missing_error(
                "SigningWorker registration material is inactive",
            ));
        }
        stored.activation.validate()?;
        lookup.validate_active_state(stored.activation.active_signing_worker_state())?;
        Ok(stored.activation)
    }

    fn read_registration(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        key: &str,
    ) -> Result<Option<WalletRegistrationV1>, RouterAbProtocolError> {
        let rows = self.sql.exec(
            "SELECT registration_key, owner_json, ciphertext_json FROM wallet_registrations WHERE registration_key = ?",
            vec![SqlStorageValue::String(key.to_owned())],
        ).map_err(sql_error)?.to_array::<RegistrationRowV1>().map_err(sql_error)?;
        let [row] = rows.as_slice() else {
            return if rows.is_empty() {
                Ok(None)
            } else {
                Err(wallet_error(
                    "SigningWorker registration lookup returned duplicate rows",
                ))
            };
        };
        Ok(Some(self.decode_registration_row(scope, row)?))
    }

    fn decode_registration_row(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        row: &RegistrationRowV1,
    ) -> Result<WalletRegistrationV1, RouterAbProtocolError> {
        let owner_json = serde_json::to_string(scope).map_err(|error| {
            wallet_error(format!("SigningWorker wallet owner is invalid: {error}"))
        })?;
        if row.owner_json != owner_json {
            return Err(wallet_error("SigningWorker wallet owner conflict"));
        }
        let cipher = SigningWorkerPrivateD1CipherV1::from_env_for_wallet_do(&self.env)?;
        cipher.open(
            "registration",
            &registration_identity(scope, &row.registration_key)?,
            &row.ciphertext_json,
        )
    }

    fn read_round1(
        &self,
        column: &str,
        value: &str,
    ) -> Result<Option<Round1RowV1>, RouterAbProtocolError> {
        let query = match column {
            "binding_key" => "SELECT * FROM wallet_round1 WHERE binding_key = ?",
            "handle" => "SELECT * FROM wallet_round1 WHERE handle = ?",
            "effect_operation_key" => "SELECT * FROM wallet_round1 WHERE effect_operation_key = ?",
            "authorization_key" => "SELECT * FROM wallet_round1 WHERE authorization_key = ?",
            _ => {
                return Err(wallet_error(
                    "SigningWorker round-1 lookup column is invalid",
                ))
            }
        };
        let rows = self
            .sql
            .exec(query, vec![SqlStorageValue::String(value.to_owned())])
            .map_err(sql_error)?
            .to_array::<Round1RowV1>()
            .map_err(sql_error)?;
        match rows.len() {
            0 => Ok(None),
            1 => {
                let row = rows.into_iter().next().expect("one row was checked");
                row.validate()?;
                Ok(Some(row))
            }
            _ => Err(wallet_error(
                "SigningWorker round-1 lookup returned duplicate rows",
            )),
        }
    }

    fn open_round1(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        row: &Round1RowV1,
    ) -> Result<PreparedRound1V1, RouterAbProtocolError> {
        if row.handle.is_empty() || row.request_digest_hex.is_empty() {
            return Err(wallet_error("SigningWorker round-1 row is incomplete"));
        }
        let cipher = SigningWorkerPrivateD1CipherV1::from_env_for_wallet_do(&self.env)?;
        let stored: PreparedRound1V1 = cipher.open(
            "round1",
            &registration_identity(scope, &row.binding_key)?,
            &row.ciphertext_json,
        )?;
        stored.request.validate()?;
        stored.response.validate()?;
        stored.record.validate()?;
        if stored.record.server_round1_handle != row.handle
            || digest_hex(stored.request.round1_binding_digest()?) != row.binding_key
            || request_digest_hex("near-prepare", &stored.request)? != row.request_digest_hex
        {
            return Err(wallet_error(
                "SigningWorker round-1 index differs from its sealed record",
            ));
        }
        Ok(stored)
    }
}

fn registration_key(binding: &router_ab_core::Ed25519YaoCeremonyBindingV1) -> String {
    crate::ed25519_yao_lifecycle::role_d1::encode_hex_slice(
        &binding.stable_key_context_binding.into_bytes(),
    )
}

fn registration_identity(
    scope: &CloudflareSigningWorkerWalletScopeV1,
    key: &str,
) -> Result<String, RouterAbProtocolError> {
    Ok(format!("{}/{}", object_name(scope)?, key))
}

fn object_name(
    scope: &CloudflareSigningWorkerWalletScopeV1,
) -> Result<String, RouterAbProtocolError> {
    crate::signing_worker_wallet_object_name_v1(scope)
}

fn wallet_error(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}

fn sql_error(error: worker::Error) -> RouterAbProtocolError {
    wallet_error(format!("SigningWorker wallet SQLite failed: {error}"))
}
