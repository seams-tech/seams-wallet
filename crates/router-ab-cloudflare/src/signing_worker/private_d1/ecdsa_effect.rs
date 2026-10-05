use super::*;

#[derive(Deserialize)]
struct EcdsaEffectSnapshotRow {
    pool_json: Option<String>,
    pool_version: Option<i64>,
    terminal_digest: Option<String>,
    terminal_json: Option<String>,
    claim_operation_key: Option<String>,
    claim_digest: Option<String>,
    claim_authorization_json: Option<String>,
}

/// Claims the authorization and consumes its exact reservation in one transaction.
/// Only the transaction that writes both records can release one-use material.
pub(crate) async fn claim_and_consume_cloudflare_signing_worker_ecdsa_effect_v1(
    env: &Env,
    request: &CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaClaimAndConsumeV1> {
    request.validate()?;
    require_positive_ms("SigningWorker ECDSA effect claimed_at_ms", now_unix_ms)?;
    let operation_key = request.effect_operation_key()?;
    let authorization_key = request.effect_authorization_key()?;
    let request_digest = private_d1_digest_hex_v1(request.effect_request_digest()?);
    let authorization_json = encode_json(
        "SigningWorker ECDSA effect authorization",
        &request.effect_claim,
    )?;
    let command = CloudflareSigningWorkerEcdsaPoolCommandV1::Consume {
        scope: request.request.scope.clone(),
        server_presignature_id: request.request.server_presignature_id.clone(),
        expected_revision: 1,
        request_digest: request.request.prepare_request_digest()?,
        now_unix_ms,
    };
    command.validate()?;
    let pool_request = CloudflareSigningWorkerPrivateD1RequestV1::EcdsaPoolMutate {
        command: command.clone(),
    };
    let pool_key = pool_request.storage_key();
    let database = signing_worker_private_d1_from_env_v1(env)?;
    let db = database
        .with_session_constraint(D1SessionConstraint::FirstPrimary)
        .map_err(|error| map_d1_error("SigningWorker ECDSA effect session failed", error))?;
    let cipher = SigningWorkerPrivateD1CipherV1::from_env(env)?;
    for _ in 0..3 {
        let snapshot = db.prepare(
            "SELECT pool.record_json AS pool_json, pool.version AS pool_version,
                    terminal.request_digest_hex AS terminal_digest, terminal.response_json AS terminal_json,
                    claim.operation_key AS claim_operation_key, claim.request_digest_hex AS claim_digest,
                    claim.authorization_json AS claim_authorization_json
             FROM (SELECT 1) AS anchor
             LEFT JOIN signing_worker_ecdsa_pool AS pool ON pool.record_key = ?1
             LEFT JOIN signing_worker_terminal_responses AS terminal ON terminal.operation_key = ?2
             LEFT JOIN signing_worker_effect_claims AS claim
               ON claim.operation_key = ?2 OR claim.authorization_key = ?3
             LIMIT 1",
        ).bind(&[js_string(&pool_key), js_string(&operation_key), js_string(&authorization_key)])
            .map_err(|error| map_d1_error("SigningWorker ECDSA effect snapshot bind failed", error))?
            .first::<EcdsaEffectSnapshotRow>(None).await
            .map_err(|error| map_d1_error("SigningWorker ECDSA effect snapshot failed", error))?
            .ok_or_else(|| d1_error("SigningWorker ECDSA effect snapshot is missing"))?;
        match (snapshot.terminal_digest, snapshot.terminal_json) {
            (Some(digest), Some(terminal_json)) if digest == request_digest => {
                return Ok(CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Replay { terminal_json });
            }
            (None, None) => {}
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ReplayedLocalRequest,
                    "SigningWorker ECDSA terminal conflicts with the request",
                ))
            }
        }
        request.request.validate_at(now_unix_ms)?;
        match (
            snapshot.claim_operation_key,
            snapshot.claim_digest,
            snapshot.claim_authorization_json,
        ) {
            (Some(operation), Some(digest), Some(authorization))
                if operation == operation_key
                    && digest == request_digest
                    && authorization == authorization_json =>
            {
                return Ok(CloudflareSigningWorkerEcdsaClaimAndConsumeV1::InProgress);
            }
            (None, None, None) => {}
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ReplayedLocalRequest,
                    "SigningWorker effect operation key was reused for different request material",
                ))
            }
        }
        let (json, version) = match (snapshot.pool_json, snapshot.pool_version) {
            (Some(json), Some(version)) => (json, version),
            (None, None) => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MissingLocalBinding,
                    "SigningWorker ECDSA reservation is missing",
                ))
            }
            _ => {
                return Err(d1_error(
                    "SigningWorker ECDSA reservation snapshot is incomplete",
                ))
            }
        };
        let record = cipher.open("ecdsa_pool", &pool_key, &json)?;
        let outcome =
            apply_cloudflare_signing_worker_ecdsa_pool_command_v1(Some(record), command.clone())?;
        let consumed_json = cipher.seal("ecdsa_pool", &pool_key, outcome.record())?;
        let cleanup_deadline = outcome
            .record()
            .cleanup_deadline_ms()
            .map(|value| js_u64("SigningWorker ECDSA pool cleanup deadline", value))
            .transpose()?
            .unwrap_or(JsValue::NULL);
        let claim = db.prepare(
            "INSERT OR IGNORE INTO signing_worker_effect_claims
             (operation_key, authorization_key, request_digest_hex, authorization_json, claimed_at_ms)
             SELECT ?1, ?2, ?3, ?4, ?5
             WHERE EXISTS (SELECT 1 FROM signing_worker_ecdsa_pool WHERE record_key = ?6 AND version = ?7)
               AND NOT EXISTS (SELECT 1 FROM signing_worker_terminal_responses WHERE operation_key = ?1)",
        ).bind(&[
            js_string(&operation_key), js_string(&authorization_key), js_string(&request_digest),
            js_string(&authorization_json), js_u64("SigningWorker ECDSA effect timestamp", now_unix_ms)?,
            js_string(&pool_key), JsValue::from_f64(version as f64),
        ]).map_err(|error| map_d1_error("SigningWorker ECDSA claim bind failed", error))?;
        // D1 executes the batch as one transaction. changes() refers to the claim
        // immediately above, so a competing or stale claim cannot consume material.
        let consume = db
            .prepare(
                "UPDATE signing_worker_ecdsa_pool
             SET record_json = ?1, version = version + 1, cleanup_deadline_ms = ?2
             WHERE record_key = ?3 AND version = ?4 AND changes() = 1",
            )
            .bind(&[
                js_string(&consumed_json),
                cleanup_deadline,
                js_string(&pool_key),
                JsValue::from_f64(version as f64),
            ])
            .map_err(|error| map_d1_error("SigningWorker ECDSA consume bind failed", error))?;
        let results = db
            .batch(vec![claim, consume])
            .await
            .map_err(|error| map_d1_error("SigningWorker ECDSA claim and consume failed", error))?;
        let [claim_result, consume_result] = results.as_slice() else {
            return Err(d1_error(
                "SigningWorker ECDSA claim and consume results are incomplete",
            ));
        };
        match (d1_changes(claim_result)?, d1_changes(consume_result)?) {
            (1, 1) => {
                return match outcome {
                    CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Consumed {
                        material,
                        ..
                    } => Ok(CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Claimed { material }),
                    CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Burned { .. } => {
                        Ok(CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Burned)
                    }
                    _ => Err(d1_error(
                        "SigningWorker ECDSA consume returned the wrong lifecycle outcome",
                    )),
                }
            }
            (0, 0) => continue,
            _ => {
                return Err(d1_error(
                    "SigningWorker ECDSA claim and consume did not commit together",
                ))
            }
        }
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::ConflictingPair,
        "SigningWorker ECDSA reservation changed concurrently",
    ))
}
