use super::*;
use crate::{ed25519_yao_signing_worker, ordinary_inactive_signer_material};

#[derive(Deserialize)]
struct EcdsaMaterialSnapshotRow {
    activation_json: Option<String>,
    active_state_json: Option<String>,
    material_key: Option<String>,
    reservation_json: Option<String>,
    reservation_updated_at_ms: Option<u64>,
    ed25519_reservation_json: Option<String>,
    fenced: i64,
}

/// Reads material and its lifecycle fences together from the primary database.
pub(crate) async fn load_cloudflare_signing_worker_ecdsa_active_material_v1(
    env: &Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
) -> RouterAbProtocolResult<(
    ActiveSigningWorkerStateV1,
    CloudflareServerOutputMaterialRecordV1,
)> {
    runtime
        .server_output_decrypt_key()
        .validate_matches_server(&scope.signing_worker)?;
    let lookup = CloudflareActiveSigningWorkerStateLookupV1::from_router_ab_ecdsa_derivation_normal_signing_scope(scope)?;
    let active_key = activation_active_key_v1(&lookup)?;
    let reservation_key =
        ordinary_inactive_signer_material::reservation_record_key_v1(&scope.material_activation)?;
    let ed25519_key =
        ed25519_yao_signing_worker::reservation_record_key_from_material_activation_v1(
            &scope.material_activation,
        )?;
    let database = signing_worker_private_d1_from_env_v1(env)?;
    let db = database
        .with_session_constraint(D1SessionConstraint::FirstPrimary)
        .map_err(|error| map_d1_error("SigningWorker material session failed", error))?;
    let row = db
        .prepare(
            "SELECT activation.record_json AS activation_json,
                    activation.active_state_json, activation.material_key,
                    reservation.ciphertext_json AS reservation_json,
                    reservation.updated_at_ms AS reservation_updated_at_ms,
                    ed25519.ciphertext_json AS ed25519_reservation_json,
                    fence.active_key IS NOT NULL AS fenced
             FROM (SELECT 1) AS anchor
             LEFT JOIN signing_worker_activations AS activation ON activation.active_key = ?1
             LEFT JOIN signing_worker_activation_revocation_fences AS fence ON fence.active_key = ?1
             LEFT JOIN signing_worker_secret_states AS reservation
               ON reservation.purpose = 'ecdsa_inactive_reservations' AND reservation.record_key = ?2
             LEFT JOIN signing_worker_secret_states AS ed25519
               ON ed25519.purpose = 'ed25519_yao_reservations' AND ed25519.record_key = ?3",
        )
        .bind(&[js_string(&active_key), js_string(&reservation_key), js_string(&ed25519_key)])
        .map_err(|error| map_d1_error("SigningWorker material snapshot bind failed", error))?
        .first::<EcdsaMaterialSnapshotRow>(None)
        .await
        .map_err(|error| map_d1_error("SigningWorker material snapshot failed", error))?
        .ok_or_else(|| d1_error("SigningWorker material snapshot is missing"))?;
    if row.fenced == 1 {
        return Err(crate::signing_worker_activation_retired_error_v1());
    }
    if row.fenced != 0 {
        return Err(d1_error("SigningWorker material fence is invalid"));
    }
    let cipher = SigningWorkerPrivateD1CipherV1::from_env(env)?;
    if let Some(json) = row.ed25519_reservation_json {
        let state = cipher.open("ed25519_yao_reservations", &ed25519_key, &json)?;
        ed25519_yao_signing_worker::validate_ed25519_material_active_v1(
            &state,
            &scope.material_activation,
        )?;
    }
    match (row.reservation_json, row.reservation_updated_at_ms) {
        (Some(json), Some(updated_at_ms)) => {
            let state = cipher.open("ecdsa_inactive_reservations", &reservation_key, &json)?;
            match ordinary_inactive_signer_material::source_preserving_ecdsa_material_v1(
                env,
                runtime,
                scope,
                &state,
                updated_at_ms,
            ) {
                Ok(material) => return Ok(material),
                Err(error) if error.code() == RouterAbProtocolErrorCode::MissingLocalBinding => {}
                Err(error) => return Err(error),
            }
        }
        (None, None) => {}
        _ => return Err(d1_error("SigningWorker material reservation is incomplete")),
    }
    let (json, active_state_json, material_key) =
        match (row.activation_json, row.active_state_json, row.material_key) {
            (Some(json), Some(active), Some(key)) => (json, active, key),
            (None, None, None) => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MissingLocalBinding,
                    "active SigningWorker state is missing",
                ))
            }
            _ => return Err(d1_error("SigningWorker activation snapshot is incomplete")),
        };
    let active = decode_json::<ActiveSigningWorkerStateV1>(
        "SigningWorker active state",
        &active_state_json,
    )?;
    lookup.validate_active_state(&active)?;
    if active.signing_worker_material_handle != material_key {
        return Err(d1_error(
            "SigningWorker activation material key does not match its active state",
        ));
    }
    let record = cipher.open::<CloudflareSigningWorkerOutputActivationRecordV1>(
        "activation",
        &material_key,
        &json,
    )?;
    record.validate()?;
    if record.active_signing_worker_state() != &active {
        return Err(d1_error(
            "SigningWorker activation material does not match its active state",
        ));
    }
    CloudflareSigningWorkerOutputMaterialLookupV1::new(active.clone())?
        .validate_material(record.material())?;
    Ok((active, record.into_material()))
}
