use router_ab_core::{
    Ed25519YaoOperationV1, NormalSigningRound1PrepareResponseV1, PublicDigest32,
    RouterAbProtocolError, RouterAbProtocolErrorCode,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::{DurableObject, Env, Request, Response, SqlStorage, SqlStorageValue, State};

use crate::{
    ed25519_yao_signing_worker::{
        build_output_activation_record, combine_signing_worker_yao_packages_v1,
        evaluate_initial_registration_finalization_v1, http_active_receipt,
        SigningWorkerYaoDurableStateV1,
    },
    handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2,
    handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2,
    signing_worker::SigningWorkerPrivateD1CipherV1,
    CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1,
    CloudflareEd25519YaoNormalSigningHandlerV1, CloudflareScopedEd25519YaoPackagePairDeliveryV1,
    CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    CloudflareSigningWorkerInitialRegistrationFinalizationSnapshotV1,
    CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    CloudflareSigningWorkerNormalSigningTerminalV1,
    CloudflareSigningWorkerOutputActivationRecordV1, CloudflareSigningWorkerRound1LookupV1,
    CloudflareSigningWorkerRound1RecordV1, CloudflareSigningWorkerRuntimeV1,
    CloudflareSigningWorkerWalletScopeV1,
};

const BINDING: &str = "SIGNING_WORKER_WALLET_DO";
const PATH: &str = "/router-ab/internal/signing-worker/wallet";
const REGISTRATION_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_registrations (
    registration_key TEXT PRIMARY KEY,
    active_key TEXT NOT NULL UNIQUE,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum SigningWorkerWalletDoRequestV1 {
    DeliverRegistration(CloudflareScopedEd25519YaoPackagePairDeliveryV1),
    LookupRegistration(CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1),
    PrepareNear {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
        now_unix_ms: u64,
    },
    FinalizeNear {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
        now_unix_ms: u64,
    },
}

fn validate_normal_signing_scope(
    scope: &CloudflareSigningWorkerWalletScopeV1,
    metadata: &crate::CloudflareRouterNormalSigningTrustedMetadataV1,
    wallet_id: &str,
) -> Result<(), RouterAbProtocolError> {
    scope.validate()?;
    metadata.validate()?;
    if scope.org_id != metadata.org_id
        || scope.project_id != metadata.project_id
        || scope.wallet_id != wallet_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "SigningWorker wallet scope differs from trusted admission",
        ));
    }
    Ok(())
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

fn missing_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MissingLocalBinding, message)
}

impl SigningWorkerWalletDoRequestV1 {
    fn scope(&self) -> &CloudflareSigningWorkerWalletScopeV1 {
        match self {
            Self::DeliverRegistration(request) => &request.scope,
            Self::LookupRegistration(request) => &request.scope,
            Self::PrepareNear { scope, .. } | Self::FinalizeNear { scope, .. } => scope,
        }
    }

    fn validate(&self) -> Result<(), RouterAbProtocolError> {
        match self {
            Self::DeliverRegistration(request) => request.validate(),
            Self::LookupRegistration(request) => request.validate(),
            Self::PrepareNear {
                scope,
                request,
                now_unix_ms,
            } => {
                request.validate()?;
                if request.wallet_scope.as_ref() != Some(scope) {
                    return Err(wallet_error("SigningWorker prepare wallet scope changed"));
                }
                validate_normal_signing_scope(
                    scope,
                    &request.trusted_admission.metadata,
                    &request.scope.account_id,
                )?;
                crate::require_positive_ms("SigningWorker prepare time", *now_unix_ms)
            }
            Self::FinalizeNear {
                scope,
                request,
                now_unix_ms,
            } => {
                request.validate()?;
                if request.wallet_scope.as_ref() != Some(scope) {
                    return Err(wallet_error("SigningWorker finalize wallet scope changed"));
                }
                validate_normal_signing_scope(
                    scope,
                    &request.trusted_admission.metadata,
                    &request.request.scope.account_id,
                )?;
                crate::require_positive_ms("SigningWorker finalize time", *now_unix_ms)
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

#[derive(Deserialize)]
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
    env: Env,
}

impl DurableObject for RouterAbSigningWorkerWalletDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            sql: state.storage().sql(),
            env,
        }
    }

    async fn fetch(&self, mut request: Request) -> worker::Result<Response> {
        if request.method() != worker::Method::Post || request.path() != PATH {
            return Response::error("Unknown SigningWorker wallet object request", 404);
        }
        let command: SigningWorkerWalletDoRequestV1 = request.json().await?;
        if let Err(error) = command.validate() {
            return Response::error(error.message(), 400);
        }
        self.sql.exec(REGISTRATION_SCHEMA, None)?;
        self.sql.exec(ROUND1_SCHEMA, None)?;
        match self.execute(command) {
            Ok(response) => Ok(response),
            Err(error) => Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                crate::cloudflare_router_error_status(error.code()),
            ),
        }
    }
}

impl RouterAbSigningWorkerWalletDurableObject {
    fn execute(
        &self,
        command: SigningWorkerWalletDoRequestV1,
    ) -> Result<Response, RouterAbProtocolError> {
        match command {
            SigningWorkerWalletDoRequestV1::DeliverRegistration(request) => {
                self.deliver_registration(request)
            }
            SigningWorkerWalletDoRequestV1::LookupRegistration(request) => {
                self.lookup_registration(request)
            }
            SigningWorkerWalletDoRequestV1::PrepareNear {
                scope,
                request,
                now_unix_ms,
            } => self.prepare_near(scope, request, now_unix_ms),
            SigningWorkerWalletDoRequestV1::FinalizeNear {
                scope,
                request,
                now_unix_ms,
            } => self.finalize_near(scope, request, now_unix_ms),
        }
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
            return Response::from_json(&http_active_receipt(receipt)).map_err(sql_error);
        }
        let existing = self
            .read_registration(&request.scope, &registration_key)?
            .ok_or_else(|| wallet_error("SigningWorker registration write is uncertain"))?;
        self.replay_registration(&request, existing)
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
        let result = evaluate_initial_registration_finalization_v1(&request, snapshot)?;
        Response::from_json(&result).map_err(sql_error)
    }

    fn prepare_near(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
        now_unix_ms: u64,
    ) -> Result<Response, RouterAbProtocolError> {
        let binding_key = digest_hex(request.round1_binding_digest()?);
        let request_digest_hex = request_digest_hex("near-prepare", &request)?;
        if let Some(row) = self.read_round1("binding_key", &binding_key)? {
            return self.replay_prepare(&scope, &request, now_unix_ms, &request_digest_hex, row);
        }
        let activation = self.load_near_activation(&scope, &request.material_source)?;
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
        let activation = self.load_near_activation(&scope, &request.material_source)?;
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
        let rows = self.sql.exec(
            "SELECT registration_key, owner_json, ciphertext_json FROM wallet_registrations WHERE active_key = ?",
            vec![SqlStorageValue::String(key)],
        ).map_err(sql_error)?.to_array::<RegistrationRowV1>().map_err(sql_error)?;
        let [row] = rows.as_slice() else {
            return Err(missing_error(
                "SigningWorker registration material is missing",
            ));
        };
        let stored = self.decode_registration_row(scope, row)?;
        if !matches!(
            stored.lifecycle,
            SigningWorkerYaoDurableStateV1::Active { .. }
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
    scope.validate()?;
    let encoded = serde_json::to_vec(scope)
        .map_err(|error| wallet_error(format!("SigningWorker wallet scope is invalid: {error}")))?;
    let mut hash = Sha256::new();
    hash.update(b"seams/signing-worker/wallet-do/v1");
    hash.update(encoded);
    Ok(format!(
        "signing-worker-wallet-{}",
        crate::ed25519_yao_lifecycle::role_d1::encode_hex_slice(&hash.finalize()),
    ))
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
