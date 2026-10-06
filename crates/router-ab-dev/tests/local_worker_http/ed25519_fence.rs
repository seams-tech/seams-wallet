use super::*;

pub(super) fn verify_rejected_wallet_delivery(
    temp: &std::path::Path,
    config: &router_ab_dev::LocalSigningWorkerConfigV1,
    signing_worker_url: &str,
    wallet_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = Connection::open(temp.join(&config.role_private_storage_path))?;
    let stored_prepare: String = connection.query_row(
        "SELECT prepare_json FROM local_signing_worker_near_round1 WHERE json_extract(prepare_json, '$.wallet_scope.wallet_id') = ?1",
        [wallet_id],
        |row| row.get(0),
    )?;
    let mut incomplete_prepare: serde_json::Value = serde_json::from_str(&stored_prepare)?;
    incomplete_prepare
        .as_object_mut()
        .ok_or("stored prepare must be an object")?
        .remove("wallet_scope");
    let (missing_scope_status, missing_scope_body) = post_json_to_path_with_headers(
        signing_worker_url,
        router_ab_dev::LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PREPARE_PATH,
        &incomplete_prepare,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            config.internal_service_auth.as_str(),
        )],
    )?;
    assert_eq!(missing_scope_status, 400, "{missing_scope_body}");
    assert!(
        missing_scope_body.contains("missing field `wallet_scope`"),
        "{missing_scope_body}"
    );
    let storage = router_ab_dev::LocalRolePrivateSqliteStorageV1::new(&connection)?;
    let before = storage
        .get_bytes("ed25519-yao/worker-state-v2")?
        .ok_or("SigningWorker durable state is missing")?;
    let state: serde_json::Value = serde_json::from_slice(&before)?;
    let identities = state["state"]["active"]["active_identities"]
        .as_array()
        .ok_or("SigningWorker identities are missing")?;
    let identity = identities
        .iter()
        .find(|identity| {
            identity["initial_registration"]["request"]["scope"]["wallet_id"] == wallet_id
        })
        .ok_or("registered wallet is missing")?;
    let delivery = &identity["initial_registration"]["request"];
    let (status, body) = post_json_to_path_with_headers(
        signing_worker_url,
        router_ab_dev::LOCAL_SIGNING_WORKER_ED25519_YAO_ACTIVATION_PACKAGES_PATH,
        delivery,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            config.internal_service_auth.as_str(),
        )],
    )?;
    assert_ne!(status, 200, "{body}");
    assert!(body.contains("closed new Ed25519 work"), "{body}");
    let after = storage
        .get_bytes("ed25519-yao/worker-state-v2")?
        .ok_or("SigningWorker durable state disappeared")?;
    assert_eq!(
        after, before,
        "rejected delivery must not change durable role state"
    );
    Ok(())
}
