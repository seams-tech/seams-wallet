use base64::Engine;
use router_ab_cloudflare::{
    CloudflareEd25519YaoPairExecuteRequestV1, CloudflareEd25519YaoPairLookupRequestV1,
    CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    CloudflareRouterEd25519AcceptedCapabilityBindingV1, CloudflareRouterEd25519AuthorizedOperationV1,
    CloudflareRouterEd25519CapabilityKindV1, CloudflareRouterEd25519OperationKindV1,
    CloudflareRouterEd25519YaoExecuteRequestV2, CloudflareRouterEd25519YaoTenantRootV1,
};
use router_ab_core::{
    LocalHttpPathV1, LocalServiceRoleV1, MpcMaterialActivationRefV1,
    NormalSigningAuthorizationV1,
    NormalSigningEd25519TwoPartyFrostCommitmentsV1, NormalSigningResponseV1,
    NormalSigningRound1PrepareResponseV1, NormalSigningScopeV1, PublicDigest32, RootShareEpoch,
    RouterAbEd25519NormalSigningFinalizeProtocolV2, RouterAbEd25519NormalSigningFinalizeRequestV2,
    RouterAbEd25519NormalSigningIntentV2, RouterAbEd25519NormalSigningPrepareBindingV2,
    RouterAbEd25519NormalSigningPrepareRequestV2, RouterAbEd25519SigningPayloadV2,
    RouterAbEd25519TwoPartyFrostFinalizeProtocolV2, RouterAbEd25519YaoActivationResultV1,
    RouterAbNearNetworkIdV2, RouterAbNearTransactionIntentV1, RouterEd25519YaoExecuteResultV1,
    RouterEd25519YaoExecuteSuccessV1, RouterEd25519YaoGatewayExecuteTargetV2,
    TenantRootCreationGrantNonceV1, TenantRootCreationGrantV1, TenantRootCustodyLineageId,
    TenantRootIdentityV1, TENANT_ROOT_MAX_LIFETIME_MS_V1,
};
use router_ab_dev::{
    admit_local_ed25519_yao_registration_v1, generate_local_ed25519_yao_recipient_key_pair_v1,
    local_env_materialization_plan_v1, parse_local_env_file_contents_v1,
    parse_local_worker_role_config_for_role_v1, run_example_local_router_ab_dev_http_ceremony_v1,
    seal_local_ed25519_yao_activation_deriver_a_input_v1,
    seal_local_ed25519_yao_activation_deriver_b_input_v1, LocalDeriverAPairRecordV1,
    LocalDeriverPeerMessageReceiptV1, LocalEd25519YaoActivationDeriverARequestV1,
    LocalEd25519YaoActivationDeriverBRequestV1, LocalEd25519YaoActivationRecipientsV1,
    LocalEd25519YaoClientContributionV1, LocalEd25519YaoRecipientPrivateKeyV1,
    LocalHttpServiceBindingClientV1,
    LocalSigningWorkerAdmittedRouterAbEcdsaDerivationFinalizeRequestV1, LocalWorkerRoleConfigV1,
    RouterAbEd25519YaoApplicationBindingFactsV1, RouterAbEd25519YaoLifecycleScopeV1,
    RouterAbEd25519YaoRegistrationAdmissionRequestV1,
    LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH, LOCAL_DERIVER_B_ED25519_YAO_PEER_PATH,
    LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
    LOCAL_ROUTER_NORMAL_SIGNING_PATH, LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH,
};
use router_ab_ed25519_yao::Ed25519YaoRoleExecutionV1;
use router_ab_ed25519_yao_client::complete_client_activation_packages_v1;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use signer_core::ed25519_yao_derivation::{
    derive_ed25519_yao_client_contributions_v1, Ed25519YaoApplicationBindingFactsV1,
    Ed25519YaoApplicationBindingKeyCreationSignerSlotV1,
    Ed25519YaoApplicationBindingSigningKeyIdV1, Ed25519YaoApplicationBindingSigningRootIdV1,
    Ed25519YaoApplicationBindingWalletIdV1, Ed25519YaoClientRootV1,
    Ed25519YaoStableKeyDerivationContextV1,
};
use signer_core::near_threshold_ed25519::{
    build_signing_package, client_round1_commit, client_round2_signature_share,
    key_package_from_signing_share_bytes, signature_share_to_b64u,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Barrier, Mutex, MutexGuard, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

fn router_ab_dev_source() -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"))
        .expect("router-ab-dev source should be readable")
}

fn router_ab_dev_local_service_http_source() -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/local_service_http.rs"))
        .expect("router-ab-dev local service HTTP source should be readable")
}

fn router_ab_dev_local_dev_http_source() -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/local_dev_http.rs"))
        .expect("router-ab-dev local dev HTTP source should be readable")
}

fn router_ab_dev_local_router_ab_ecdsa_derivation_pool_store_source() -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/local_router_ab_ecdsa_derivation_pool_store.rs"),
    )
    .expect("router-ab-dev local Router A/B ECDSA derivation pool store source should be readable")
}

fn router_ab_dev_local_worker_topology_source() -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/local_worker_topology.rs"))
        .expect("router-ab-dev local worker topology source should be readable")
}

fn router_ab_dev_bin_source(name: &str) -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/bin")
            .join(name),
    )
    .unwrap_or_else(|error| panic!("{name} should be readable: {error}"))
}

#[test]
fn local_dev_http_request_boundary_lives_outside_monolith() {
    let lib_source = router_ab_dev_source();
    let helper_source = router_ab_dev_local_dev_http_source();
    for expected in [
        "pub struct LocalDevHttpRequestPartsV1",
        "pub fn read_local_dev_http_request_v1",
        "pub fn write_local_dev_http_response_v1",
        "pub fn local_dev_http_error_body_v1",
    ] {
        assert!(
            helper_source.contains(expected),
            "local dev HTTP module should own {expected}"
        );
        assert!(
            !lib_source.contains(expected),
            "router-ab-dev lib.rs should not own {expected}"
        );
    }
}

#[test]
fn local_dev_http_dispatch_lives_outside_monolith() {
    let lib_source = router_ab_dev_source();
    let helper_source = router_ab_dev_local_dev_http_source();
    for expected in [
        "pub enum LocalDevHttpTopologyV1",
        "pub fn local_dev_http_handle_request_v1",
        "fn local_dev_signing_worker_private_route_v1",
        "fn local_dev_protocol_response_v1",
    ] {
        assert!(
            helper_source.contains(expected),
            "local dev HTTP module should own {expected}"
        );
        assert!(
            !lib_source.contains(expected),
            "router-ab-dev lib.rs should not own {expected}"
        );
    }
}

#[test]
fn local_worker_bins_delegate_to_shared_route_dispatcher() {
    for name in ["router_ab_local_worker.rs"] {
        let source = router_ab_dev_bin_source(name);
        assert!(
            source.contains("local_dev_http_handle_request_with_dispatcher_v1"),
            "{name} should delegate requests to the shared local dev dispatcher"
        );
        for forbidden in [
            "LOCAL_ROUTER_NORMAL_SIGNING",
            "LOCAL_ROUTER_AB_ECDSA_DERIVATION",
            "LOCAL_SIGNING_WORKER_NORMAL_SIGNING",
            "LOCAL_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION",
            "match request.path",
            "if request.path",
        ] {
            assert!(
                !source.contains(forbidden),
                "{name} should not carry route-dispatch logic: found {forbidden}"
            );
        }
    }
}

#[test]
fn local_signing_worker_private_http_helper_lives_outside_monolith() {
    let lib_source = router_ab_dev_source();
    let helper_source = router_ab_dev_local_service_http_source();
    for expected in [
        "pub struct LocalHttpServiceBindingClientV1",
        "pub struct LocalHttpServiceBindingEndpointV1",
        "pub fn local_http_service_binding_endpoint_v1",
    ] {
        assert!(
            helper_source.contains(expected),
            "local service HTTP module should own {expected}"
        );
        assert!(
            !lib_source.contains(expected),
            "router-ab-dev lib.rs should not own {expected}"
        );
    }
}

#[test]
fn local_worker_topology_helpers_live_outside_monolith() {
    let lib_source = router_ab_dev_source();
    let helper_source = router_ab_dev_local_worker_topology_source();
    for expected in [
        "pub struct LocalWorkerHealthResponseV1",
        "pub fn local_worker_bind_addr_v1",
        "pub fn local_worker_owned_paths_v1",
        "pub fn local_worker_health_response_v1",
    ] {
        assert!(
            helper_source.contains(expected),
            "local worker topology module should own {expected}"
        );
        assert!(
            !lib_source.contains(expected),
            "router-ab-dev lib.rs should not own {expected}"
        );
    }
}

#[test]
fn local_router_ab_ecdsa_derivation_pool_lifecycle_store_lives_outside_monolith() {
    let lib_source = router_ab_dev_source();
    let helper_source = router_ab_dev_local_router_ab_ecdsa_derivation_pool_store_source();
    for expected in [
        "CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1",
        "pub(crate) fn local_signing_worker_ecdsa_pool_mutate_v1",
        "apply_cloudflare_signing_worker_ecdsa_pool_command_v1",
    ] {
        assert!(
            helper_source.contains(expected),
            "local Router A/B ECDSA derivation pool-store module should own {expected}"
        );
    }
    for helper_only in [
        "pub(crate) fn local_signing_worker_ecdsa_pool_mutate_v1",
        "apply_cloudflare_signing_worker_ecdsa_pool_command_v1",
    ] {
        assert!(
            !lib_source.contains(helper_only),
            "router-ab-dev lib.rs should not own {helper_only}"
        );
    }
    for obsolete in [
        "LocalSigningWorkerRouterAbEcdsaDerivationPresignaturePoolLifecycleV1",
        "local_signing_worker_router_ab_ecdsa_derivation_presignature_pool_store_put_v1",
        "local_signing_worker_router_ab_ecdsa_derivation_presignature_pool_store_take_v1",
    ] {
        assert!(
            !lib_source.contains(obsolete) && !helper_source.contains(obsolete),
            "obsolete delete-based local ECDSA pool symbol must remain deleted: {obsolete}"
        );
    }
}

#[test]
fn local_workers_accept_direct_deriver_peer_messages_over_http(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    let temp = temp_dir("peer-http")?;
    let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
    write_deriver_envs(&temp, &deriver_a_url, &deriver_b_url)?;

    let mut deriver_a = ChildGuard::spawn(
        binary,
        "deriver-a",
        temp.join(".env.router-ab.deriver-a.local"),
    )?;
    let mut deriver_b = ChildGuard::spawn(
        binary,
        "deriver-b",
        temp.join(".env.router-ab.deriver-b.local"),
    )?;
    wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
    wait_for_health(&deriver_b_url, deriver_b.child_mut())?;

    let ceremony = run_example_local_router_ab_dev_http_ceremony_v1()?;
    let client = LocalHttpServiceBindingClientV1::default();

    let b_receipt: LocalDeriverPeerMessageReceiptV1 = client.post_json_v1(
        &deriver_b_url,
        LocalHttpPathV1::SignerAToSignerB,
        &ceremony
            .core_http_ceremony
            .deriver_a_peer_request
            .envelope
            .message,
    )?;
    let a_receipt: LocalDeriverPeerMessageReceiptV1 = client.post_json_v1(
        &deriver_a_url,
        LocalHttpPathV1::SignerBToSignerA,
        &ceremony
            .core_http_ceremony
            .deriver_b_peer_request
            .envelope
            .message,
    )?;

    assert_eq!(b_receipt.receiver_role, LocalServiceRoleV1::DeriverB);
    assert_eq!(b_receipt.status, "accepted");
    assert_eq!(b_receipt.proof_bundle_count, 2);
    assert_eq!(a_receipt.receiver_role, LocalServiceRoleV1::DeriverA);
    assert_eq!(a_receipt.status, "accepted");
    assert_eq!(a_receipt.proof_bundle_count, 2);
    drop(deriver_a);
    drop(deriver_b);
    let _ = fs::remove_dir_all(temp);
    Ok(())
}

#[test]
fn local_router_worker_exposes_health_and_rejects_malformed_pair_routes(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    let temp = temp_dir("router-boundary")?;
    let router_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
    let signing_worker_url = format!("http://127.0.0.1:{}", free_port()?);
    write_router_env(
        &temp,
        &router_url,
        &deriver_a_url,
        &deriver_b_url,
        &signing_worker_url,
    )?;
    let mut router = ChildGuard::spawn(
        binary,
        "router",
        temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
    )?;
    wait_for_health(&router_url, router.child_mut())?;
    assert!(get_health(&router_url).is_ok());
    for path in [
        router_ab_dev::LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        router_ab_dev::LOCAL_ROUTER_ED25519_YAO_RECOVERY_PROMOTE_PATH,
    ] {
        let (status, body) = post_json_to_path_with_headers(
            &router_url,
            path,
            &serde_json::json!({}),
            &[(
                router_ab_dev::LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                TEST_GATEWAY_TO_ROUTER_AUTH,
            )],
        )?;
        if path == router_ab_dev::LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH {
            assert_eq!(status, 400, "{path}: {body}");
            assert!(body.contains("malformed") || body.contains("MalformedWirePayload"));
        } else {
            assert_eq!(status, 400, "{path}: {body}");
            assert!(body.contains("malformed") || body.contains("MalformedWirePayload"));
        }
    }
    drop(router);
    let _ = fs::remove_dir_all(temp);
    Ok(())
}

#[test]
fn local_worker_survives_malformed_http_probe() -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    let temp = temp_dir("malformed-probe")?;
    let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
    write_deriver_envs(&temp, &deriver_a_url, &deriver_b_url)?;

    let mut deriver_a = ChildGuard::spawn(
        binary,
        "deriver-a",
        temp.join(".env.router-ab.deriver-a.local"),
    )?;
    wait_for_health(&deriver_a_url, deriver_a.child_mut())?;

    send_incomplete_http_probe(&deriver_a_url)?;
    thread::sleep(Duration::from_millis(100));
    assert!(
        deriver_a.child_mut().try_wait()?.is_none(),
        "malformed HTTP probe should not stop the local worker"
    );
    get_health(&deriver_a_url)?;

    drop(deriver_a);
    let _ = fs::remove_dir_all(temp);
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct LocalEd25519YaoProductLatencySampleV1 {
    schema: &'static str,
    profile: &'static str,
    registration_microseconds: u64,
}

#[test]
fn product_topology_completes_local_ed25519_yao_registration(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    let temp = temp_dir("product-yao-registration")?;
    let router_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
    let signing_worker_url = format!("http://127.0.0.1:{}", free_port()?);
    let router_env = write_product_worker_envs(
        &temp,
        &router_url,
        &deriver_a_url,
        &deriver_b_url,
        &signing_worker_url,
    )?;
    let tenant_root_fixture = provision_product_tenant_root(
        env!("CARGO_BIN_EXE_router_ab_local_worker"),
        &temp,
        &router_url,
        &deriver_a_url,
        &deriver_b_url,
    )?;

    let mut router = ChildGuard::spawn_in_root(
        binary,
        "router",
        temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
        &temp,
    )?;
    let mut deriver_a = ChildGuard::spawn_in_root(
        binary,
        "deriver-a",
        temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
        &temp,
    )?;
    let mut deriver_b = ChildGuard::spawn_in_root(
        binary,
        "deriver-b",
        temp.join(router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1),
        &temp,
    )?;
    let mut signing_worker = ChildGuard::spawn_in_root(
        binary,
        "signing-worker",
        temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
        &temp,
    )?;
    wait_for_health(&router_url, router.child_mut())?;
    wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
    wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
    wait_for_health(&signing_worker_url, signing_worker.child_mut())?;

    let deriver_b_env_path = temp.join(router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1);
    let replica_url = format!("http://127.0.0.1:{}", free_port()?);
    let primary_env = fs::read_to_string(&deriver_b_env_path)?;
    let replica_env = primary_env.replace(&deriver_b_url, &replica_url);
    if replica_env == primary_env {
        return Err("Deriver B replica URL is missing from its environment".into());
    }
    let replica_env_path = temp.join(".env.router-ab.deriver-b-replica.local");
    fs::write(&replica_env_path, replica_env)?;
    let mut deriver_b_replica =
        ChildGuard::spawn_in_root(binary, "deriver-b", replica_env_path, &temp)?;
    wait_for_health(&replica_url, deriver_b_replica.child_mut())?;

    let (request, client_recipient_key) =
        product_registration_request(&router_env, &tenant_root_fixture)?;
    let started = Instant::now();
    let (status, body) = post_json_to_path_with_headers(
        &router_url,
        LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        &request,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    let registration_microseconds =
        u64::try_from(started.elapsed().as_micros()).map_err(|_| "latency exceeds u64")?;
    assert_eq!(status, 200, "{body}");
    let result = serde_json::from_str::<RouterEd25519YaoExecuteResultV1>(&body)?;
    let RouterEd25519YaoExecuteResultV1::Succeeded { result } = result else {
        return Err(format!("product Yao registration did not succeed: {body}").into());
    };
    let RouterEd25519YaoExecuteSuccessV1::Registration { result: activation } = *result else {
        return Err("product Yao result was not registration".into());
    };
    let b_config = parse_local_worker_role_config_for_role_v1(
        LocalServiceRoleV1::DeriverB,
        parse_local_env_file_contents_v1(&primary_env)?,
    )?;
    let LocalWorkerRoleConfigV1::DeriverB(b_config) = b_config else {
        return Err("Deriver B env parsed as another role".into());
    };
    let b_connection = Connection::open(temp.join(&b_config.role_private_storage_path))?;
    let (session_hex, pair_digest_hex, completed_pair_json): (String, String, String) =
        b_connection.query_row(
            "SELECT session_hex, pair_digest_hex, record_json FROM local_deriver_b_yao_pairs",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    let session_bytes = hex::decode(session_hex)?;
    let pair_digest_bytes = hex::decode(pair_digest_hex)?;
    let pair_lookup = CloudflareEd25519YaoPairLookupRequestV1 {
        session: session_bytes.as_slice().try_into()?,
        pair_digest: pair_digest_bytes.as_slice().try_into()?,
    };
    let (replica_status, replica_body) = post_json_to_path_with_headers(
        &replica_url,
        router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH,
        &pair_lookup,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_eq!(replica_status, 200, "replica B pair status: {replica_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&replica_body)?["status"],
        "completed"
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&completed_pair_json)?["status"],
        "completed"
    );
    let terminal_pair_rows: i64 = b_connection.query_row(
        "SELECT COUNT(*) FROM local_deriver_b_yao_pairs",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(terminal_pair_rows, 1);
    let effective_before: Vec<u8> = b_connection.query_row(
        "SELECT value FROM local_role_private_state WHERE key = 'ed25519-yao/worker-state-v2'",
        [],
        |row| row.get(0),
    )?;
    let role_state: serde_json::Value = serde_json::from_slice(&effective_before)?;
    assert!(
        role_state["state"]["pair_roles"].is_null(),
        "B pair authority must live only in the pair row"
    );
    assert_eq!(
        role_state["state"]["effective"].as_array().map(Vec::len),
        Some(1),
        "registration must retain B effective material"
    );
    let (stale_status, _) = post_json_to_path_with_headers(
        &replica_url,
        router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_REFRESH_RESULT_PATH,
        &json!({}),
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_ne!(stale_status, 200, "stale replica cannot complete a refresh");
    let effective_after: Vec<u8> = b_connection.query_row(
        "SELECT value FROM local_role_private_state WHERE key = 'ed25519-yao/worker-state-v2'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(
        effective_before, effective_after,
        "stale B state must not overwrite custody"
    );
    drop(deriver_b);
    let mut deriver_b = ChildGuard::spawn_in_root(binary, "deriver-b", deriver_b_env_path, &temp)?;
    wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
    let (restarted_status, restarted_body) = post_json_to_path_with_headers(
        &deriver_b_url,
        router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH,
        &pair_lookup,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_eq!(
        restarted_status, 200,
        "restarted B pair status: {restarted_body}"
    );
    assert_eq!(
        replica_body, restarted_body,
        "B restart must replay one terminal outcome"
    );
    println!(
        "R150_VM_B_PAIR_E2E {}",
        json!({
            "shared_sqlite_processes": 2,
            "terminal_pair_rows": terminal_pair_rows,
            "stale_role_snapshot_rejected": true,
            "restart_terminal_replay": true,
        })
    );
    drop(b_connection);
    let a_env_path = temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1);
    let a_config = parse_local_worker_role_config_for_role_v1(
        LocalServiceRoleV1::DeriverA,
        parse_local_env_file_contents_v1(&fs::read_to_string(&a_env_path)?)?,
    )?;
    let LocalWorkerRoleConfigV1::DeriverA(a_config) = a_config else {
        return Err("Deriver A env parsed as another role".into());
    };
    let a_connection = Connection::open(temp.join(&a_config.role_private_storage_path))?;
    let a_pair_before: String = a_connection.query_row(
        "SELECT record_json FROM local_deriver_a_yao_pairs",
        [],
        |row| row.get(0),
    )?;
    let b_connection = Connection::open(temp.join(&b_config.role_private_storage_path))?;
    let b_pair_before: String = b_connection.query_row(
        "SELECT record_json FROM local_deriver_b_yao_pairs",
        [],
        |row| row.get(0),
    )?;
    let signing_worker_env_path = temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1);
    let sw_config = parse_local_worker_role_config_for_role_v1(
        LocalServiceRoleV1::SigningWorker,
        parse_local_env_file_contents_v1(&fs::read_to_string(&signing_worker_env_path)?)?,
    )?;
    let LocalWorkerRoleConfigV1::SigningWorker(sw_config) = sw_config else {
        return Err("SigningWorker env parsed as another role".into());
    };
    let sw_connection = Connection::open(temp.join(&sw_config.role_private_storage_path))?;
    let sw_state_before: Vec<u8> = sw_connection.query_row(
        "SELECT value FROM local_role_private_state WHERE key = 'ed25519-yao/worker-state-v2'",
        [],
        |row| row.get(0),
    )?;
    drop(router);
    drop(signing_worker);
    router = ChildGuard::spawn_in_root(
        binary,
        "router",
        temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
        &temp,
    )?;
    signing_worker =
        ChildGuard::spawn_in_root(binary, "signing-worker", signing_worker_env_path, &temp)?;
    wait_for_health(&router_url, router.child_mut())?;
    wait_for_health(&signing_worker_url, signing_worker.child_mut())?;
    let stored_sw_state: serde_json::Value = serde_json::from_slice(&sw_state_before)?;
    let finalization_lookup = stored_sw_state["state"]["active"]["active_identities"][0]
        ["initial_registration"]["request"]
        .clone();
    assert!(!finalization_lookup.is_null());
    let (lookup_status, lookup_body) = post_json_to_path_with_headers(
        &signing_worker_url,
        router_ab_dev::LOCAL_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_PATH,
        &finalization_lookup,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_eq!(lookup_status, 200, "{lookup_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&lookup_body)?["status"],
        "committed"
    );
    let mut wrong_scope_lookup = finalization_lookup;
    wrong_scope_lookup["scope"]["org_id"] = json!("another-org");
    let (wrong_scope_status, wrong_scope_body) = post_json_to_path_with_headers(
        &signing_worker_url,
        router_ab_dev::LOCAL_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_PATH,
        &wrong_scope_lookup,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_eq!(wrong_scope_status, 200, "{wrong_scope_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&wrong_scope_body)?["status"],
        "conflict"
    );
    let (router_replay_status, router_replay_body) = post_json_to_path_with_headers(
        &router_url,
        LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        &request,
        &[
            (
                LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                TEST_GATEWAY_TO_ROUTER_AUTH,
            ),
            (router_ab_cloudflare::ROUTER_ED25519_YAO_REPLAY_HEADER_V1, "1"),
        ],
    )?;
    assert_eq!(router_replay_status, 200, "{router_replay_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&router_replay_body)?,
        serde_json::from_str::<serde_json::Value>(&body)?,
        "Router restart must reconstruct the original result"
    );
    let a_pair_after: String = a_connection.query_row(
        "SELECT record_json FROM local_deriver_a_yao_pairs",
        [],
        |row| row.get(0),
    )?;
    let b_pair_after: String = b_connection.query_row(
        "SELECT record_json FROM local_deriver_b_yao_pairs",
        [],
        |row| row.get(0),
    )?;
    let sw_state_after: Vec<u8> = sw_connection.query_row(
        "SELECT value FROM local_role_private_state WHERE key = 'ed25519-yao/worker-state-v2'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(a_pair_before, a_pair_after);
    assert_eq!(b_pair_before, b_pair_after);
    assert_eq!(sw_state_before, sw_state_after);
    println!(
        "R150_VM_ROUTER_REPLAY_E2E {}",
        json!({
            "router_restart": true,
            "signing_worker_restart": true,
            "original_response_replayed": true,
            "a_b_and_signing_worker_records_unchanged": true,
        })
    );
    drop(a_connection);
    drop(b_connection);
    drop(sw_connection);
    let (client_share, _) = complete_client_activation_packages_v1(
        activation.binding(),
        [1, 2],
        activation.public_receipt(),
        client_recipient_key.as_bytes(),
        activation.deriver_a_client_package(),
        activation.deriver_b_client_package(),
    )?;
    signing_worker = product_near_signing_process_flow(
        binary,
        &temp,
        &router_url,
        &signing_worker_url,
        signing_worker,
        &activation,
        &client_share,
        &tenant_root_fixture.tenant_root.identity,
    )?;
    let a_env_path = temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1);
    let a_config = parse_local_worker_role_config_for_role_v1(
        LocalServiceRoleV1::DeriverA,
        parse_local_env_file_contents_v1(&fs::read_to_string(&a_env_path)?)?,
    )?;
    let LocalWorkerRoleConfigV1::DeriverA(a_config) = a_config else {
        return Err("Deriver A env parsed as another role".into());
    };
    let connection = Connection::open(temp.join(a_config.role_private_storage_path))?;
    let completed_json: String = connection.query_row(
        "SELECT record_json FROM local_deriver_a_yao_pairs",
        [],
        |row| row.get(0),
    )?;
    let completed: LocalDeriverAPairRecordV1 = serde_json::from_str(&completed_json)?;
    let LocalDeriverAPairRecordV1::Completed {
        pair_binding,
        claim_identity,
        payload,
        outcome,
        ..
    } = completed
    else {
        return Err("Deriver A did not durably complete its SQLite pair".into());
    };
    drop(connection);
    drop(deriver_a);
    drop(deriver_b);
    let mut deriver_a = ChildGuard::spawn_in_root(binary, "deriver-a", a_env_path, &temp)?;
    wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
    let lookup = CloudflareEd25519YaoPairLookupRequestV1 {
        session: pair_binding.session(),
        pair_digest: pair_binding.pair_digest().bytes,
    };
    let (status, body) = post_json_to_path_with_headers(
        &deriver_a_url,
        LOCAL_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH,
        &lookup,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_eq!(status, 200, "restart pair status: {body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body)?["status"],
        "completed"
    );
    let retry = CloudflareEd25519YaoPairExecuteRequestV1 {
        pair_binding,
        tenant_root: payload.tenant_root,
        work: payload.work,
        input: payload.input,
        local_receipt: claim_identity.local_receipt,
        peer_receipt: claim_identity.peer_receipt,
    };
    let (status, body) = post_json_to_path_with_headers(
        &deriver_a_url,
        LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
        &retry,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_eq!(status, 200, "restart execution replay: {body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body)?,
        serde_json::to_value(outcome)?
    );
    let mut changed_request = retry;
    changed_request.tenant_root.custody_binding.issued_at_ms += 1;
    let (status, _) = post_json_to_path_with_headers(
        &deriver_a_url,
        LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
        &changed_request,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_ne!(
        status, 200,
        "changed request identity must not replay A's outcome"
    );
    println!(
        "YAOS_AB_LOCAL_SAMPLE {}",
        serde_json::to_string(&LocalEd25519YaoProductLatencySampleV1 {
            schema: "seams-ed25519-yao-local-latency-sample-v2",
            profile: "ed25519-yao-product-topology",
            registration_microseconds,
        })?
    );

    drop(router);
    drop(deriver_a);
    drop(signing_worker);
    drop(deriver_b_replica);
    let _ = fs::remove_dir_all(temp);
    Ok(())
}

#[derive(Clone, Copy)]
enum PairReplyFault {
    LostSealedCompletion,
    TruncatedZeroChunk,
}

/// A tenant root is created on VM processes by the same ceremony Cloudflare
/// runs, and the creation route enforces the operator's authority.
///
/// Refused: the Gateway credential, and a grant from an authority the
/// control plane does not trust. Accepted: an operator grant, which reaches
/// ready; replaying it, before and after every role restarts, returns the
/// same ready state. Each role's SQLite holds only its own state.
#[test]
fn vm_tenant_root_creation_is_authorized_replayable_and_role_isolated(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    let temp = temp_dir("vm-tenant-root-creation")?;
    let router_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
    let signing_worker_url = format!("http://127.0.0.1:{}", free_port()?);
    write_product_worker_envs(
        &temp,
        &router_url,
        &deriver_a_url,
        &deriver_b_url,
        &signing_worker_url,
    )?;
    let start = |role: &str, env_file: &str| {
        ChildGuard::spawn_in_root(binary, role, temp.join(env_file), &temp)
    };
    let mut router = start("router", router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1)?;
    let mut deriver_a = start("deriver-a", router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1)?;
    let mut deriver_b = start("deriver-b", router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1)?;
    let (mut control_plane, control_plane_url) = spawn_control_plane(&temp)?;
    wait_for_health(&router_url, router.child_mut())?;
    wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
    wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
    wait_for_health(&control_plane_url, control_plane.child_mut())?;

    let identity = product_tenant_root_identity()?;
    let lineage = TenantRootCustodyLineageId::from_bytes(fresh_nonzero_bytes_16()?)?;
    let grant = product_creation_grant_b64u(&temp, &identity, lineage, None)?;

    let (gateway_status, _) = create_tenant_root(&router_url, &grant, TEST_GATEWAY_TO_ROUTER_AUTH)?;
    assert_eq!(gateway_status, 401, "the Gateway credential cannot create a tenant root");

    let untrusted = product_creation_grant_b64u(&temp, &identity, lineage, Some([0x5a; 32]))?;
    let (untrusted_status, untrusted_body) =
        create_tenant_root(&router_url, &untrusted, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_ne!(untrusted_status, 200, "{untrusted_body}");
    assert!(
        untrusted_body.contains("not trusted") || untrusted_body.contains("signature"),
        "untrusted grant must be refused by the control plane: {untrusted_body}"
    );

    let started = Instant::now();
    let (status, created_body) = create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    let creation_ms = u64::try_from(started.elapsed().as_millis())?;
    assert_eq!(status, 200, "{created_body}");
    let created: serde_json::Value = serde_json::from_str(&created_body)?;
    assert_eq!(created["status"]["kind"], "ready", "{created_body}");

    let (replay_status, replay_body) =
        create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_eq!(replay_status, 200, "{replay_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&replay_body)?,
        created,
        "an exact replay returns the durable outcome"
    );

    drop(router);
    drop(deriver_a);
    drop(deriver_b);
    drop(control_plane);
    let mut router = start("router", router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1)?;
    let mut deriver_a = start("deriver-a", router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1)?;
    let mut deriver_b = start("deriver-b", router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1)?;
    let (mut control_plane, _) = spawn_control_plane(&temp)?;
    wait_for_health(&router_url, router.child_mut())?;
    wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
    wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
    wait_for_health(&control_plane_url, control_plane.child_mut())?;
    let (restart_status, restart_body) =
        create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_eq!(restart_status, 200, "{restart_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&restart_body)?,
        created,
        "a replay after every role restarts returns the same durable outcome"
    );

    let router_db = Connection::open(temp.join(".router-ab-local/router/tenant-root-creation.sqlite"))?;
    let creation_rows: i64 = router_db.query_row(
        "SELECT count(*) FROM local_tenant_root_creation_state",
        [],
        |row| row.get(0),
    )?;
    let router_share_tables: i64 = router_db.query_row(
        "SELECT count(*) FROM sqlite_master WHERE name = 'tenant_root_role_shares'",
        [],
        |row| row.get(0),
    )?;
    assert!(creation_rows > 0);
    assert_eq!(router_share_tables, 0, "the Router holds no role shares");
    let mut role_rows = BTreeMap::new();
    for (label, env_file) in [
        ("deriver_a", router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
        ("deriver_b", router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1),
    ] {
        let storage = env_value(
            &temp.join(env_file),
            if label == "deriver_a" {
                "DERIVER_A_ROLE_PRIVATE_STORAGE_PATH"
            } else {
                "DERIVER_B_ROLE_PRIVATE_STORAGE_PATH"
            },
        )?;
        let db = Connection::open(temp.join(storage))?;
        let rows: Vec<(String, String)> = db
            .prepare("SELECT role, lifecycle FROM tenant_root_role_shares")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        assert_eq!(
            rows,
            vec![(label.to_owned(), "active".to_owned())],
            "{label} holds exactly its own active role share"
        );
        let backups = backup_object_counts(&Connection::open(temp.join(format!(
            ".router-ab-local/{}/managed-backups.sqlite",
            label.replace('_', "-")
        )))?)?;
        assert_eq!(
            backups,
            (1, 1),
            "{label} stores its own managed backup and provider canary"
        );
        role_rows.insert(label, rows.len());
    }
    let record_keys: BTreeSet<String> = [
        router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1,
        router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1,
    ]
    .into_iter()
    .map(|file| env_value(&temp.join(file), "DERIVER_ROLE_PRIVATE_D1_KEK_PUBLIC_KEY"))
    .collect::<Result<_, _>>()?;
    assert_eq!(record_keys.len(), 2, "each Deriver seals its store with its own record key");

    println!(
        "R150_VM_TENANT_ROOT_E2E {}",
        json!({
            "processes": ["router", "deriver_a", "deriver_b", "tenant_root_control_plane"],
            "creation_ms": creation_ms,
            "status": created["status"]["kind"],
            "gateway_credential_refused_status": gateway_status,
            "untrusted_grant_refused_status": untrusted_status,
            "replay_returns_durable_outcome": true,
            "replay_after_full_restart_returns_durable_outcome": true,
            "router_creation_state_rows": creation_rows,
            "router_role_share_tables": router_share_tables,
            "deriver_active_role_share_rows": role_rows,
            "distinct_role_store_record_keys": record_keys.len(),
        })
    );
    Ok(())
}

/// A creation that stops with only Deriver B installed is not cancelled by a
/// retry inside its ceremony window, since the other role's command may still
/// be running. A retry after the window abandons it through the shared
/// ceremony: the Router fences the creation, the control plane names B's
/// pending row, the Router verifies that command, B removes its row, managed
/// backup and canary, and the Router checkpoints B's terminal receipt. A,
/// which the fence does not record, is cleaned by the ceremony: it holds
/// nothing, and its lineage is tombstoned against a late write. The grant is
/// then spent; a fresh grant creates the root.
#[test]
fn vm_tenant_root_partial_creation_is_cleaned_before_a_fresh_grant(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    let temp = temp_dir("vm-tenant-root-partial-creation")?;
    let router_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
    let signing_worker_url = format!("http://127.0.0.1:{}", free_port()?);
    write_product_worker_envs(
        &temp,
        &router_url,
        &deriver_a_url,
        &deriver_b_url,
        &signing_worker_url,
    )?;
    let start = |role: &str, env_file: &str| {
        ChildGuard::spawn_in_root(binary, role, temp.join(env_file), &temp)
    };
    let mut router = start("router", router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1)?;
    let mut deriver_a = start("deriver-a", router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1)?;
    let mut deriver_b = start("deriver-b", router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1)?;
    let (mut control_plane, control_plane_url) = spawn_control_plane(&temp)?;
    wait_for_health(&router_url, router.child_mut())?;
    wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
    wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
    wait_for_health(&control_plane_url, control_plane.child_mut())?;

    let role_store = |env_file: &str, key: &str| -> Result<Connection, Box<dyn std::error::Error>> {
        Ok(Connection::open(temp.join(env_value(&temp.join(env_file), key)?))?)
    };
    let a_store = role_store(
        router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1,
        "DERIVER_A_ROLE_PRIVATE_STORAGE_PATH",
    )?;
    let b_store = role_store(
        router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1,
        "DERIVER_B_ROLE_PRIVATE_STORAGE_PATH",
    )?;
    let a_backups =
        Connection::open(temp.join(".router-ab-local/deriver-a/managed-backups.sqlite"))?;
    let b_backups =
        Connection::open(temp.join(".router-ab-local/deriver-b/managed-backups.sqlite"))?;
    let router_db =
        Connection::open(temp.join(".router-ab-local/router/tenant-root-creation.sqlite"))?;
    let share_rows = |db: &Connection| -> rusqlite::Result<Vec<(String, String)>> {
        db.prepare("SELECT role, lifecycle FROM tenant_root_role_shares ORDER BY role")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect()
    };
    let backup_rows = |db: &Connection| backup_object_counts(db);
    let cleanup_checkpoints = || -> rusqlite::Result<i64> {
        router_db.query_row(
            "SELECT count(*) FROM local_tenant_root_creation_state
             WHERE storage_key LIKE 'creation/v1/cleanup-checkpoint/%'",
            [],
            |row| row.get(0),
        )
    };
    let abandonment_fences = || -> rusqlite::Result<i64> {
        router_db.query_row(
            "SELECT count(*) FROM local_tenant_root_creation_state
             WHERE storage_key = 'creation/v1/abandonment'",
            [],
            |row| row.get(0),
        )
    };

    // Deriver A's managed-backup store is unavailable, so the initiator fails
    // after its peer B has installed and checkpointed its share.
    a_backups.execute_batch(
        "ALTER TABLE local_tenant_root_managed_backups RENAME TO held_aside_managed_backups",
    )?;
    let identity = product_tenant_root_identity()?;
    let lineage = TenantRootCustodyLineageId::from_bytes(fresh_nonzero_bytes_16()?)?;
    let lifetime_ms = 6_000;
    let signed_at = Instant::now();
    let grant =
        product_creation_grant_with_lifetime_b64u(&temp, &identity, lineage, None, lifetime_ms)?;
    let (failed_status, failed_body) =
        create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_ne!(failed_status, 200, "{failed_body}");
    assert!(
        failed_body.contains("no such table"),
        "the initiator fails on its unavailable backup store: {failed_body}"
    );
    assert_eq!(share_rows(&a_store)?, Vec::new(), "A installed nothing");
    assert_eq!(
        share_rows(&b_store)?,
        vec![("deriver_b".to_owned(), "pending".to_owned())],
        "B holds its installed, unactivated share"
    );
    assert_eq!(
        backup_rows(&b_backups)?,
        (1, 1),
        "B stored its managed backup and provider canary"
    );
    a_backups.execute_batch(
        "ALTER TABLE held_aside_managed_backups RENAME TO local_tenant_root_managed_backups",
    )?;

    // Inside the window a retry cancels nothing.
    let (open_status, open_body) =
        create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_ne!(open_status, 200, "{open_body}");
    assert!(
        open_body.contains("retry after its ceremony window closes to abandon it"),
        "{open_body}"
    );
    assert_eq!(
        share_rows(&b_store)?,
        vec![("deriver_b".to_owned(), "pending".to_owned())],
        "an ordinary retry inside the window keeps B's share"
    );
    assert_eq!(abandonment_fences()?, 0, "nothing is fenced inside the window");

    // The grant was issued a second before signing, so its window closes
    // `lifetime_ms - 1_000` after it; wait a second beyond that.
    if let Some(remaining) = Duration::from_millis(lifetime_ms).checked_sub(signed_at.elapsed()) {
        thread::sleep(remaining);
    }
    // After the window a retry abandons the partial creation instead of
    // resuming it.
    let (cleaned_status, cleaned_body) =
        create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_ne!(cleaned_status, 200, "{cleaned_body}");
    assert!(
        cleaned_body.contains("expired before activation and was abandoned; a fresh grant is required"),
        "{cleaned_body}"
    );
    assert_eq!(share_rows(&b_store)?, Vec::new(), "B's pending share is removed");
    assert_eq!(
        backup_rows(&b_backups)?,
        (0, 0),
        "B's managed backup and provider canary are removed"
    );
    assert_eq!(abandonment_fences()?, 1, "the Router fences the creation before cleaning");
    assert_eq!(cleanup_checkpoints()?, 2, "the Router checkpoints both roles' cleanups");
    let tombstones = |db: &Connection| -> rusqlite::Result<i64> {
        db.query_row("SELECT count(*) FROM tenant_root_creation_tombstones", [], |row| {
            row.get(0)
        })
    };
    assert_eq!(
        (tombstones(&a_store)?, tombstones(&b_store)?),
        (1, 0),
        "only the unrecorded role is tombstoned"
    );

    // The cleaned grant stays spent, including after every role restarts.
    let (abandoned_status, abandoned_body) =
        create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_eq!(abandoned_status, cleaned_status, "{abandoned_body}");
    assert!(
        abandoned_body.contains("abandoned; a fresh grant is required"),
        "{abandoned_body}"
    );
    drop(router);
    drop(deriver_a);
    drop(deriver_b);
    drop(control_plane);
    let mut router = start("router", router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1)?;
    let mut deriver_a = start("deriver-a", router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1)?;
    let mut deriver_b = start("deriver-b", router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1)?;
    let (mut control_plane, _) = spawn_control_plane(&temp)?;
    wait_for_health(&router_url, router.child_mut())?;
    wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
    wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
    wait_for_health(&control_plane_url, control_plane.child_mut())?;
    let (restart_status, restart_body) =
        create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_eq!(restart_status, cleaned_status, "{restart_body}");
    assert!(restart_body.contains("abandoned"), "{restart_body}");
    assert_eq!(cleanup_checkpoints()?, 2, "replays clean nothing twice");

    // A fresh grant for a new custody lineage creates the root.
    let fresh_lineage = TenantRootCustodyLineageId::from_bytes(fresh_nonzero_bytes_16()?)?;
    let fresh_grant = product_creation_grant_b64u(&temp, &identity, fresh_lineage, None)?;
    let (fresh_status, fresh_body) =
        create_tenant_root(&router_url, &fresh_grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    assert_eq!(fresh_status, 200, "{fresh_body}");
    let fresh: serde_json::Value = serde_json::from_str(&fresh_body)?;
    assert_eq!(fresh["status"]["kind"], "ready", "{fresh_body}");
    assert_eq!(
        share_rows(&a_store)?,
        vec![("deriver_a".to_owned(), "active".to_owned())]
    );
    assert_eq!(
        share_rows(&b_store)?,
        vec![("deriver_b".to_owned(), "active".to_owned())]
    );
    assert_eq!(backup_rows(&a_backups)?, (1, 1));
    assert_eq!(backup_rows(&b_backups)?, (1, 1));

    println!(
        "R150_VM_TENANT_ROOT_PARTIAL_CLEANUP_E2E {}",
        json!({
            "fault": "deriver_a_managed_backup_store_unavailable",
            "failed_attempt_status": failed_status,
            "installed_before_cleanup": ["deriver_b"],
            "retry_inside_window_status": open_status,
            "cleanup_retry_status": cleaned_status,
            "deriver_b_rows_after_cleanup": 0,
            "deriver_b_backups_after_cleanup": 0,
            "router_cleanup_checkpoints": cleanup_checkpoints()?,
            "tombstoned_roles": ["deriver_a"],
            "replay_reports_abandoned": true,
            "replay_after_full_restart_reports_abandoned": true,
            "fresh_grant_status": fresh["status"]["kind"],
        })
    );
    Ok(())
}

/// The Router's persisted initial-activation receipt is the commit point of a
/// creation. A delivery lost after it leaves zero or one Deriver active, and
/// the creation only rolls forward: a retry of the grant, inside the ceremony
/// window or after it, re-delivers the committed receipt, the active Deriver
/// replays and the pending one activates. A correctly signed receipt that the
/// Router did not commit activates nothing, at any time.
#[test]
fn vm_tenant_root_committed_activation_is_delivered_after_the_ceremony_expires(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-post-commit")?;
    let active = || Some("active".to_owned());
    let pending = || Some("pending".to_owned());
    let mut evidence = BTreeMap::new();

    // Inside the window: zero, then one, Deriver active.
    for (label, proxy, expected) in [
        ("zero_active_retry_in_window", &stack.proxy_a, (pending(), pending())),
        ("one_active_retry_in_window", &stack.proxy_b, (active(), pending())),
    ] {
        let (identity, lineage, lineage_b64u) = recovery_ceremony(&format!("post-commit-{label}"))?;
        let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
        let receipt = stack.lose_delivery(proxy, &grant, &lineage_b64u, expected)?;
        let (status, body) = stack.create(&grant)?;
        assert_eq!(status, 200, "{body}");
        assert_eq!(stack.lifecycles(&lineage_b64u)?, (active(), active()));
        assert_eq!(stack.committed_receipt(&lineage_b64u)?.as_deref(), Some(receipt.as_str()));
        evidence.insert(label.to_owned(), json!(status));
    }

    // After the window: the same two losses on short-lived grants.
    let lifetime_ms = 6_000;
    let signed_at = Instant::now();
    let (identity, lineage, none_lineage) = recovery_ceremony("post-commit-zero-active-expired")?;
    let none_grant =
        product_creation_grant_with_lifetime_b64u(&stack.temp, &identity, lineage, None, lifetime_ms)?;
    let none_receipt =
        stack.lose_delivery(&stack.proxy_a, &none_grant, &none_lineage, (pending(), pending()))?;
    let (identity, lineage, one_lineage) = recovery_ceremony("post-commit-one-active-expired")?;
    let one_grant =
        product_creation_grant_with_lifetime_b64u(&stack.temp, &identity, lineage, None, lifetime_ms)?;
    stack.proxy_control_plane.clear_captured();
    let one_receipt =
        stack.lose_delivery(&stack.proxy_b, &one_grant, &one_lineage, (active(), pending()))?;

    // A second, correctly signed receipt for the same evidence, which the
    // Router never committed: the control plane issues again on replay.
    let uncommitted_receipt = stack.reissue_captured_activation()?;
    assert_ne!(uncommitted_receipt, one_receipt, "the reissued receipt must differ");
    let (uncommitted_status, uncommitted_body) =
        stack.deliver(&stack.deriver_b_url, &uncommitted_receipt)?;
    assert_ne!(uncommitted_status, 200, "{uncommitted_body}");
    assert!(
        uncommitted_body.contains("is not the activation the Router committed"),
        "a fresh, signed but uncommitted receipt is refused: {uncommitted_body}"
    );
    evidence.insert(
        "uncommitted_receipt_in_window".to_owned(),
        json!(uncommitted_status),
    );

    // The grants were issued a second before signing, so their windows close
    // `lifetime_ms - 1_000` after it; wait a second beyond that.
    if let Some(remaining) = Duration::from_millis(lifetime_ms).checked_sub(signed_at.elapsed()) {
        thread::sleep(remaining);
    }
    let (uncommitted_status, uncommitted_body) =
        stack.deliver(&stack.deriver_b_url, &uncommitted_receipt)?;
    assert_ne!(uncommitted_status, 200, "{uncommitted_body}");
    assert!(
        uncommitted_body.contains("is not the activation the Router committed"),
        "{uncommitted_body}"
    );
    evidence.insert(
        "uncommitted_receipt_after_expiry".to_owned(),
        json!(uncommitted_status),
    );
    assert_eq!(stack.lifecycles(&one_lineage)?, (active(), pending()));

    for (label, grant, lineage, receipt) in [
        ("zero_active_retry_after_expiry", &none_grant, &none_lineage, &none_receipt),
        ("one_active_retry_after_expiry", &one_grant, &one_lineage, &one_receipt),
    ] {
        let (status, body) = stack.create(grant)?;
        assert_eq!(status, 200, "{label}: {body}");
        let response: serde_json::Value = serde_json::from_str(&body)?;
        assert_eq!(response["status"]["kind"], "ready", "{body}");
        assert_eq!(stack.lifecycles(lineage)?, (active(), active()), "{label}");
        assert_eq!(stack.committed_receipt(lineage)?.as_deref(), Some(receipt.as_str()));
        let (replay_status, replay_body) = stack.create(grant)?;
        assert_eq!(replay_status, 200, "{replay_body}");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&replay_body)?,
            response,
            "an exact replay after expiry returns the durable outcome"
        );
        evidence.insert(label.to_owned(), json!(status));
    }

    println!(
        "R150_VM_TENANT_ROOT_POST_COMMIT_E2E {}",
        json!({
            "fault": "initial_activation_delivery_lost_after_router_commit",
            "statuses": evidence,
            "retries_deliver_the_committed_receipt": true,
            "exact_replay_after_expiry_is_durable": true,
            "uncommitted_signed_receipt_refused": true,
        })
    );
    Ok(())
}

/// Before the Router commits, a creation whose roles are both installed resumes
/// from durable evidence: both installation evidences from the Router's
/// checkpoint, and each role's signed managed backup and provider canary from
/// that Deriver's own store.
#[test]
fn vm_tenant_root_ready_creation_resumes_from_durable_evidence(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-resume")?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("resume-before-commit")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;

    // The activation request never reaches the control plane: the Router stops
    // after the initiator returns, with nothing to commit.
    stack.proxy_control_plane.drop_next();
    let (lost_status, lost_body) = stack.create(&grant)?;
    assert_ne!(lost_status, 200, "{lost_body}");
    assert!(stack.proxy_control_plane.dropped(), "the proxy must have dropped the request");
    let pending = || Some("pending".to_owned());
    let active = || Some("active".to_owned());
    assert_eq!(stack.committed_receipt(&lineage_b64u)?, None, "nothing is committed");
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (pending(), pending()));
    assert_eq!(
        stack.backup_objects(&lineage_b64u)?,
        ((1, 1), (1, 1)),
        "each role holds its backup and canary before any commit"
    );

    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let response: serde_json::Value = serde_json::from_str(&body)?;
    assert_eq!(response["status"]["kind"], "ready", "{body}");
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (active(), active()));
    let receipt = stack
        .committed_receipt(&lineage_b64u)?
        .ok_or("the resume must commit an activation")?;
    let (replay_status, replay_body) = stack.create(&grant)?;
    assert_eq!(replay_status, 200, "{replay_body}");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&replay_body)?, response);
    assert_eq!(stack.committed_receipt(&lineage_b64u)?.as_deref(), Some(receipt.as_str()));

    // The evidence read is for pending shares only.
    let (evidence_status, evidence_body) = post_json_to_path_with_headers(
        &stack.deriver_a_url,
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_CREATION_EVIDENCE_PRIVATE_REQUEST_PATH,
        &json!({
            "identity_digest_b64u": response["identity_digest_b64u"],
            "custody_lineage_b64u": response["custody_lineage_b64u"],
        }),
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
    )?;
    assert_ne!(evidence_status, 200, "{evidence_body}");
    assert!(evidence_body.contains("already active"), "{evidence_body}");

    println!(
        "R150_VM_TENANT_ROOT_RESUME_E2E {}",
        json!({
            "fault": "control_plane_activation_request_lost_before_commit",
            "failed_attempt_status": lost_status,
            "durable_before_resume": {
                "router_committed": false,
                "deriver_rows": "pending",
                "backup_and_canary_per_role": [1, 1],
            },
            "resume_status": status,
            "replay_is_durable": true,
            "evidence_read_refuses_active_share": evidence_status,
        })
    );
    Ok(())
}

/// Before the Router commits, a creation that cannot finish inside its
/// ceremony window is abandoned. A retry after the window fences it in the
/// Router's creation state and cleans both installed roles. The fence and the
/// activation commit exclude each other, whichever lands first: after the
/// fence a correctly signed receipt cannot be committed, and a committed
/// creation cannot be fenced.
#[test]
fn vm_tenant_root_uncommitted_creation_is_abandoned_after_the_ceremony_expires(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-abandon")?;
    let pending = || Some("pending".to_owned());
    let active = || Some("active".to_owned());
    let abandonment_path = router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH;
    let scope = |lineage: &str, identity: &TenantRootIdentityV1| -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        Ok(json!({
            "identity_digest_b64u":
                base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity.digest()?.as_bytes()),
            "custody_lineage_b64u": lineage,
        }))
    };

    // Both roles install, the activation request never reaches the control
    // plane, and nothing is committed.
    let (identity, lineage, lineage_b64u) = recovery_ceremony("abandon-after-expiry")?;
    let lifetime_ms = 6_000;
    let signed_at = Instant::now();
    let grant =
        product_creation_grant_with_lifetime_b64u(&stack.temp, &identity, lineage, None, lifetime_ms)?;
    stack.proxy_control_plane.clear_captured();
    stack.proxy_control_plane.drop_next();
    let (lost_status, lost_body) = stack.create(&grant)?;
    assert_ne!(lost_status, 200, "{lost_body}");
    assert!(stack.proxy_control_plane.dropped(), "the proxy must have dropped the request");
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (pending(), pending()));
    assert_eq!(stack.committed_receipt(&lineage_b64u)?, None);
    // A correctly signed receipt for this ceremony, issued inside the window
    // and never committed.
    let uncommitted_receipt = stack.reissue_captured_activation()?;

    // Inside the window the creation resumes rather than being abandoned.
    let (open_status, open_body) =
        stack.creation_state(&identity, lineage, abandonment_path, &scope(&lineage_b64u, &identity)?)?;
    assert_ne!(open_status, 200, "{open_body}");
    assert!(open_body.contains("ceremony is still open"), "{open_body}");

    // The grant was issued a second before signing, so its window closes
    // `lifetime_ms - 1_000` after it; wait a second beyond that.
    if let Some(remaining) = Duration::from_millis(lifetime_ms).checked_sub(signed_at.elapsed()) {
        thread::sleep(remaining);
    }
    let (abandoned_status, abandoned_body) = stack.create(&grant)?;
    assert_ne!(abandoned_status, 200, "{abandoned_body}");
    assert!(
        abandoned_body.contains("expired before activation and was abandoned; a fresh grant is required"),
        "{abandoned_body}"
    );
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (None, None), "both pending rows are removed");
    assert_eq!(
        stack.backup_objects(&lineage_b64u)?,
        ((0, 0), (0, 0)),
        "both roles' backups and canaries are removed"
    );
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 2), "one fence, two cleanups");

    // Abandonment won: the signed receipt can no longer be committed, and no
    // Deriver activates on it.
    let (commit_status, commit_body) = stack.creation_state(
        &identity,
        lineage,
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH,
        &json!({ "activation_receipt_b64u": uncommitted_receipt }),
    )?;
    assert_ne!(commit_status, 200, "{commit_body}");
    assert!(commit_body.contains("cannot follow abandonment"), "{commit_body}");
    assert_eq!(stack.committed_receipt(&lineage_b64u)?, None);
    let (deliver_status, deliver_body) = stack.deliver(&stack.deriver_a_url, &uncommitted_receipt)?;
    assert_ne!(deliver_status, 200, "{deliver_body}");

    // A replay reports the abandonment and cleans nothing twice.
    let (replay_status, replay_body) = stack.create(&grant)?;
    assert_eq!(replay_status, abandoned_status, "{replay_body}");
    assert!(replay_body.contains("abandoned; a fresh grant is required"), "{replay_body}");
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 2));

    // Commit won: a committed creation cannot be abandoned.
    let (committed_identity, committed_lineage, committed_lineage_b64u) =
        recovery_ceremony("abandon-refused-after-commit")?;
    let committed_grant =
        product_creation_grant_b64u(&stack.temp, &committed_identity, committed_lineage, None)?;
    let (committed_status, committed_body) = stack.create(&committed_grant)?;
    assert_eq!(committed_status, 200, "{committed_body}");
    let (refused_status, refused_body) = stack.creation_state(
        &committed_identity,
        committed_lineage,
        abandonment_path,
        &scope(&committed_lineage_b64u, &committed_identity)?,
    )?;
    assert_ne!(refused_status, 200, "{refused_body}");
    assert!(
        refused_body.contains("a committed tenant-root creation cannot be abandoned"),
        "{refused_body}"
    );
    assert_eq!(stack.lifecycles(&committed_lineage_b64u)?, (active(), active()));

    // A fresh grant for the abandoned identity creates the root.
    let fresh_lineage = TenantRootCustodyLineageId::from_bytes(fresh_nonzero_bytes_16()?)?;
    let fresh_lineage_b64u =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(fresh_lineage.as_bytes());
    let fresh_grant = product_creation_grant_b64u(&stack.temp, &identity, fresh_lineage, None)?;
    let (fresh_status, fresh_body) = stack.create(&fresh_grant)?;
    assert_eq!(fresh_status, 200, "{fresh_body}");
    assert_eq!(stack.lifecycles(&fresh_lineage_b64u)?, (active(), active()));

    println!(
        "R150_VM_TENANT_ROOT_ABANDONMENT_E2E {}",
        json!({
            "fault": "control_plane_activation_request_lost_then_ceremony_expired",
            "fence_refused_inside_window": open_status,
            "retry_after_expiry_status": abandoned_status,
            "rows_backups_canaries_after_abandonment": 0,
            "router_fences_and_cleanups": [1, 2],
            "signed_uncommitted_receipt_commit_after_fence": commit_status,
            "signed_uncommitted_receipt_delivery_after_fence": deliver_status,
            "fence_refused_after_commit": refused_status,
            "fresh_grant_status": fresh_status,
        })
    );
    Ok(())
}

/// An abandonment interrupted after its fence, and retried only once the
/// cleanup commands' window has closed, still finishes. Each Deriver confirms
/// the Router's fence names it and judges the command at the fence, as does
/// the Router's checkpoint, so no pending row is left behind by the outage.
/// It waits past the five-minute cleanup window, so it runs only on request.
#[test]
#[ignore = "waits past the five-minute cleanup window; run with --ignored"]
fn vm_tenant_root_abandonment_finishes_after_a_long_outage(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-abandon-outage")?;
    let pending = || Some("pending".to_owned());
    let (identity, lineage, lineage_b64u) = recovery_ceremony("abandon-after-outage")?;
    let lifetime_ms = 6_000;
    let signed_at = Instant::now();
    let grant =
        product_creation_grant_with_lifetime_b64u(&stack.temp, &identity, lineage, None, lifetime_ms)?;
    stack.proxy_control_plane.drop_next();
    let (lost_status, lost_body) = stack.create(&grant)?;
    assert_ne!(lost_status, 200, "{lost_body}");
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (pending(), pending()));
    if let Some(remaining) = Duration::from_millis(lifetime_ms).checked_sub(signed_at.elapsed()) {
        thread::sleep(remaining);
    }

    // The retry fences the creation, then loses the first cleanup command:
    // the outage begins right after the fence.
    stack.proxy_control_plane.drop_next_on(
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
    );
    let (interrupted_status, interrupted_body) = stack.create(&grant)?;
    let fenced_at = Instant::now();
    assert_ne!(interrupted_status, 200, "{interrupted_body}");
    assert!(stack.proxy_control_plane.dropped_on(), "the cleanup command must have been lost");
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 0), "fenced, nothing cleaned");
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (pending(), pending()));

    // Past the cleanup commands' window, measured from the fence.
    let window = Duration::from_millis(router_ab_core::TENANT_ROOT_MAX_LIFETIME_MS_V1 + 5_000);
    if let Some(remaining) = window.checked_sub(fenced_at.elapsed()) {
        thread::sleep(remaining);
    }
    let (finished_status, finished_body) = stack.create(&grant)?;
    assert_ne!(finished_status, 200, "{finished_body}");
    assert!(
        finished_body.contains("abandoned; a fresh grant is required"),
        "{finished_body}"
    );
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (None, None), "both pending rows are removed");
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((0, 0), (0, 0)));
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 2));

    println!(
        "R150_VM_TENANT_ROOT_ABANDONMENT_OUTAGE_E2E {}",
        json!({
            "fault": "cleanup_command_lost_right_after_the_fence",
            "outage_ms": u64::try_from(fenced_at.elapsed().as_millis())?,
            "cleanup_window_ms": router_ab_core::TENANT_ROOT_MAX_LIFETIME_MS_V1,
            "interrupted_status": interrupted_status,
            "finished_after_outage": true,
            "router_fences_and_cleanups": [1, 2],
        })
    );
    Ok(())
}

/// A role that wrote its share, backup and canary, but whose installation
/// checkpoint never reached the Router, is cleaned by the abandoned ceremony
/// once the window closes. Deriver B's checkpoint is lost after B's writes, as
/// if B stopped there; A, whose peer call failed, wrote nothing. The fence
/// records no installed role, and each role's cleanup removes whatever it
/// holds and tombstones the lineage against a later write.
#[test]
fn vm_tenant_root_unrecorded_material_is_cleaned_after_the_ceremony_expires(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-unrecorded")?;
    let pending = || Some("pending".to_owned());
    let (identity, lineage, lineage_b64u) = recovery_ceremony("unrecorded-before-checkpoint")?;
    let lifetime_ms = 6_000;
    let signed_at = Instant::now();
    let grant =
        product_creation_grant_with_lifetime_b64u(&stack.temp, &identity, lineage, None, lifetime_ms)?;
    stack.proxy_b_to_router.drop_next_containing(format!(
        "\"path\":\"{}\"",
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH
    ));
    let (lost_status, lost_body) = stack.create(&grant)?;
    assert_ne!(lost_status, 200, "{lost_body}");
    assert!(
        stack.proxy_b_to_router.dropped_containing(),
        "B's installation checkpoint must have been lost"
    );
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (None, pending()));
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((0, 0), (1, 1)));

    if let Some(remaining) = Duration::from_millis(lifetime_ms).checked_sub(signed_at.elapsed()) {
        thread::sleep(remaining);
    }
    let (abandoned_status, abandoned_body) = stack.create(&grant)?;
    assert_ne!(abandoned_status, 200, "{abandoned_body}");
    assert!(
        abandoned_body.contains("expired before activation and was abandoned; a fresh grant is required"),
        "{abandoned_body}"
    );
    assert_eq!(stack.fenced_roles(&lineage_b64u)?.as_deref(), Some("[]"));
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (None, None), "B's unrecorded row is removed");
    assert_eq!(
        stack.backup_objects(&lineage_b64u)?,
        ((0, 0), (0, 0)),
        "B's unrecorded backup and canary are removed"
    );
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 2), "one fence, two cleanups");
    assert_eq!(stack.tombstones(&lineage_b64u)?, (1, 1));
    assert_eq!(
        stack.completed_commands(&lineage_b64u)?,
        (1, 2),
        "A only cleaned; B created, then cleaned"
    );

    // A replay reports the abandonment and cleans nothing twice.
    let (replay_status, replay_body) = stack.create(&grant)?;
    assert_eq!(replay_status, abandoned_status, "{replay_body}");
    assert!(replay_body.contains("abandoned; a fresh grant is required"), "{replay_body}");
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 2));
    assert_eq!(stack.completed_commands(&lineage_b64u)?, (1, 2));

    println!(
        "R150_VM_TENANT_ROOT_UNRECORDED_CLEANUP_E2E {}",
        json!({
            "fault": "deriver_b_installation_checkpoint_lost_after_its_writes",
            "before_abandonment": { "rows": [null, "pending"], "backups_canaries": [[0, 0], [1, 1]] },
            "fence_installed_roles": [],
            "retry_after_expiry_status": abandoned_status,
            "rows_backups_canaries_after_abandonment": 0,
            "tombstones": [1, 1],
            "router_fences_and_cleanups": [1, 2],
        })
    );
    Ok(())
}

/// The operator path for objects an abandoned creation can leave behind: a
/// Deriver that stops between a late write, refused by its tombstone, and the
/// compensating delete keeps that write's backup and canary, and the Router
/// has already checkpointed the role's cleanup. The residue is reproduced by
/// putting back the backup and canary B held before the abandonment. An
/// operator's sweep re-runs both roles' cleanup as exact replays, removing
/// them without recording anything new, and is refused for any creation that
/// is not abandoned.
#[test]
fn vm_tenant_root_operator_sweep_removes_what_an_abandoned_creation_left(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-operator-sweep")?;
    let pending = || Some("pending".to_owned());
    let active = || Some("active".to_owned());
    let not_abandoned = "only an abandoned tenant-root creation can be swept";
    let (identity, lineage, lineage_b64u) = recovery_ceremony("operator-sweep")?;
    let lifetime_ms = 6_000;
    let signed_at = Instant::now();
    let grant =
        product_creation_grant_with_lifetime_b64u(&stack.temp, &identity, lineage, None, lifetime_ms)?;
    stack.proxy_b_to_router.drop_next_containing(format!(
        "\"path\":\"{}\"",
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH
    ));
    let (lost_status, lost_body) = stack.create(&grant)?;
    assert_ne!(lost_status, 200, "{lost_body}");
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (None, pending()));
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((0, 0), (1, 1)));
    stack.b_backups.execute(
        "CREATE TEMP TABLE left_behind AS
         SELECT * FROM local_tenant_root_managed_backups
         WHERE instr(object_key, '/' || ?1 || '/') > 0",
        [&lineage_b64u],
    )?;

    // Inside the window nothing is abandoned, so nothing is swept.
    let (open_status, open_body) = stack.sweep(&identity, &lineage_b64u)?;
    assert_ne!(open_status, 200, "{open_body}");
    assert!(open_body.contains(not_abandoned), "{open_body}");
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((0, 0), (1, 1)));

    if let Some(remaining) = Duration::from_millis(lifetime_ms).checked_sub(signed_at.elapsed()) {
        thread::sleep(remaining);
    }
    let (abandoned_status, abandoned_body) = stack.create(&grant)?;
    assert_ne!(abandoned_status, 200, "{abandoned_body}");
    assert!(abandoned_body.contains("was abandoned"), "{abandoned_body}");
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((0, 0), (0, 0)));
    let recorded = (
        stack.abandonment_records(&lineage_b64u)?,
        stack.completed_commands(&lineage_b64u)?,
        stack.tombstones(&lineage_b64u)?,
    );
    assert_eq!(recorded, ((1, 2), (1, 2), (1, 1)));

    // The residue: B's backup and canary are back after its cleanup was
    // checkpointed, and an ordinary retry no longer cleans B.
    stack.b_backups.execute_batch(
        "INSERT INTO local_tenant_root_managed_backups SELECT * FROM temp.left_behind",
    )?;
    let (retry_status, retry_body) = stack.create(&grant)?;
    assert_eq!(retry_status, abandoned_status, "{retry_body}");
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((0, 0), (1, 1)), "a retry skips cleaned roles");

    // The runbook's search finds exactly this residue, and its sweep request,
    // built from the tombstone, removes it and records nothing new. A second
    // sweep replays.
    let residue = stack.documented_residue()?;
    let identity_hex = hex::encode(identity.digest()?.as_bytes());
    assert_eq!(
        residue,
        vec![("deriver-b".to_owned(), identity_hex.clone(), lineage_b64u.clone())]
    );
    let (swept_status, swept_body) = stack.sweep_digest(&residue[0].1, &residue[0].2)?;
    assert_eq!(swept_status, 200, "{swept_body}");
    let swept: serde_json::Value = serde_json::from_str(&swept_body)?;
    assert_eq!(swept["swept_roles"], json!(["deriver_a", "deriver_b"]), "{swept_body}");
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((0, 0), (0, 0)));
    assert_eq!(stack.documented_residue()?, Vec::new());
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (None, None));
    assert_eq!(
        (
            stack.abandonment_records(&lineage_b64u)?,
            stack.completed_commands(&lineage_b64u)?,
            stack.tombstones(&lineage_b64u)?,
        ),
        recorded,
        "the sweep only replays"
    );
    let (again_status, again_body) = stack.sweep(&identity, &lineage_b64u)?;
    assert_eq!((again_status, again_body.as_str()), (200, swept_body.as_str()));

    // A committed creation, and one never started, are refused.
    let (committed_identity, committed_lineage, committed_lineage_b64u) =
        recovery_ceremony("operator-sweep-committed")?;
    let committed_grant =
        product_creation_grant_b64u(&stack.temp, &committed_identity, committed_lineage, None)?;
    let (committed_status, committed_body) = stack.create(&committed_grant)?;
    assert_eq!(committed_status, 200, "{committed_body}");
    let (committed_sweep_status, committed_sweep_body) =
        stack.sweep(&committed_identity, &committed_lineage_b64u)?;
    assert_ne!(committed_sweep_status, 200, "{committed_sweep_body}");
    assert!(committed_sweep_body.contains(not_abandoned), "{committed_sweep_body}");
    assert_eq!(stack.lifecycles(&committed_lineage_b64u)?, (active(), active()));
    assert_eq!(stack.backup_objects(&committed_lineage_b64u)?, ((1, 1), (1, 1)));
    let (_, _, unknown_lineage_b64u) = recovery_ceremony("operator-sweep-unknown")?;
    let (unknown_status, unknown_body) = stack.sweep(&identity, &unknown_lineage_b64u)?;
    assert_ne!(unknown_status, 200, "{unknown_body}");
    assert!(unknown_body.contains(not_abandoned), "{unknown_body}");

    println!(
        "R150_VM_TENANT_ROOT_OPERATOR_SWEEP_E2E {}",
        json!({
            "residue": "deriver_b_backup_and_canary_after_its_cleanup_was_checkpointed",
            "sweep_inside_window_status": open_status,
            "ordinary_retry_leaves_residue": true,
            "found_by_documented_search": ["deriver-b"],
            "sweep_status": swept_status,
            "residue_after_sweep": 0,
            "router_fences_and_cleanups": [1, 2],
            "completed_commands": [1, 2],
            "second_sweep_identical": true,
            "sweep_of_committed_creation_status": committed_sweep_status,
            "sweep_of_unstarted_creation_status": unknown_status,
        })
    );
    Ok(())
}

/// A command admitted before the window closed may finish writing after the
/// Router has abandoned its creation. Deriver A's call to B returns only once
/// the window has closed and the Router has written the fence: A then writes
/// its backup, canary and pending row, and the Router refuses its commitment.
/// A VM Deriver serves one request at a time, so A's cleanup, sent after the
/// fence, runs after that late write and removes it. (On Workers, where the
/// cleanup can land first, the tombstone refuses the late row instead.)
#[test]
fn vm_tenant_root_write_that_lands_after_the_fence_is_cleaned(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-late-write")?;
    let pending = || Some("pending".to_owned());
    let (identity, lineage, lineage_b64u) = recovery_ceremony("write-after-the-fence")?;
    let lifetime_ms = 6_000;
    let signed_at = Instant::now();
    let grant =
        product_creation_grant_with_lifetime_b64u(&stack.temp, &identity, lineage, None, lifetime_ms)?;
    let create_in_background = |grant: &str| {
        let (router_url, grant) = (stack.router_url.clone(), grant.to_owned());
        thread::spawn(move || {
            create_tenant_root(&router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)
                .map_err(|error| error.to_string())
        })
    };
    let wait_for = |what: &str, ready: &dyn Fn() -> bool| -> Result<(), Box<dyn std::error::Error>> {
        let deadline = Instant::now() + Duration::from_secs(15);
        while !ready() {
            if Instant::now() > deadline {
                return Err(format!("timed out waiting for {what}").into());
            }
            thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    };

    // B installs and checkpoints; its answer to A is held.
    stack.proxy_a_to_b.hold_next_response_on(
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_CREATE_ROLE_SHARE_PRIVATE_REQUEST_PATH,
    );
    let first = create_in_background(&grant);
    wait_for("B's held answer", &|| stack.proxy_a_to_b.holding())?;
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (None, pending()));

    // The window closes, and a retry abandons the creation. Once the fence is
    // written, A's call returns and A writes.
    if let Some(remaining) = Duration::from_millis(lifetime_ms).checked_sub(signed_at.elapsed()) {
        thread::sleep(remaining);
    }
    let second = create_in_background(&grant);
    wait_for("the Router's fence", &|| {
        stack
            .abandonment_records(&lineage_b64u)
            .is_ok_and(|(fences, _)| fences == 1)
    })?;
    let a_before_late_write = stack.lifecycles(&lineage_b64u)?.0;
    stack.proxy_a_to_b.release_held();
    let (first_status, first_body) = first.join().map_err(|_| "first creation panicked")??;
    let (abandoned_status, abandoned_body) =
        second.join().map_err(|_| "abandoning retry panicked")??;

    assert_eq!(a_before_late_write, None, "A had written nothing when the fence landed");
    assert_ne!(first_status, 200, "{first_body}");
    assert_ne!(abandoned_status, 200, "{abandoned_body}");
    assert!(
        abandoned_body.contains("expired before activation and was abandoned; a fresh grant is required"),
        "{abandoned_body}"
    );
    assert_eq!(stack.fenced_roles(&lineage_b64u)?.as_deref(), Some(r#"["deriver_b"]"#));
    assert_eq!(
        stack.completed_commands(&lineage_b64u)?,
        (2, 2),
        "A's late creation completed before its cleanup"
    );
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (None, None), "A's late row is removed");
    assert_eq!(
        stack.backup_objects(&lineage_b64u)?,
        ((0, 0), (0, 0)),
        "A's late backup and canary are removed"
    );
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 2));
    // Only the unrecorded role is tombstoned. B was cleaned by its recorded
    // evidence: its creation had completed, so a retry could only replay it.
    assert_eq!(stack.tombstones(&lineage_b64u)?, (1, 0));
    assert_eq!(stack.committed_receipt(&lineage_b64u)?, None);

    // An operator sweep replays both cleanups, B's by its recorded evidence
    // although its row is gone, and records nothing new.
    let (swept_status, swept_body) = stack.sweep(&identity, &lineage_b64u)?;
    assert_eq!(swept_status, 200, "{swept_body}");
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 2));
    assert_eq!(stack.completed_commands(&lineage_b64u)?, (2, 2));

    println!(
        "R150_VM_TENANT_ROOT_LATE_WRITE_E2E {}",
        json!({
            "fault": "deriver_a_peer_answer_held_until_after_the_fence",
            "fence_installed_roles": ["deriver_b"],
            "a_row_when_fenced": null,
            "late_creation_status": first_status,
            "retry_after_expiry_status": abandoned_status,
            "a_late_creation_then_cleanup_completed": true,
            "rows_backups_canaries_after_abandonment": 0,
            "tombstones": [1, 0],
            "operator_sweep_replays_both_status": swept_status,
            "router_fences_and_cleanups": [1, 2],
        })
    );
    Ok(())
}

/// Points each named peer URL in one role's env file at its proxy. Every
/// route must name a key the file sets.
fn route_env_through_proxies(
    env_path: &Path,
    routes: &[(&str, &str)],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut routed = 0;
    let env = fs::read_to_string(env_path)?
        .lines()
        .map(|line| {
            for (key, url) in routes {
                if line.split_once('=').map(|(name, _)| name) == Some(*key) {
                    routed += 1;
                    return format!("{key}={url}");
                }
            }
            line.to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n");
    if routed != routes.len() {
        return Err(format!("{} must reach every peer through a proxy", env_path.display()).into());
    }
    fs::write(env_path, env + "\n")?;
    Ok(())
}

/// A fresh identity and lineage for one recovery ceremony, so ceremonies in
/// one stack never share an active role share.
fn recovery_ceremony(
    environment: &str,
) -> Result<(TenantRootIdentityV1, TenantRootCustodyLineageId, String), Box<dyn std::error::Error>> {
    let identity = TenantRootIdentityV1::new(
        "local-org",
        "local-project",
        environment,
        "project:local",
        "root-version-1",
    )?;
    let lineage = TenantRootCustodyLineageId::from_bytes(fresh_nonzero_bytes_16()?)?;
    let lineage_b64u = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(lineage.as_bytes());
    Ok((identity, lineage, lineage_b64u))
}

/// The Router, both Derivers and the control plane, with the Router reaching
/// each peer through a fault proxy: the Deriver proxies can drop one
/// initial-activation delivery, and the control-plane proxy can drop or record
/// its activation request. Deriver A reaches Deriver B, and Deriver B reaches
/// the Router's creation state, through proxies too.
struct RecoveryStackV1 {
    temp: PathBuf,
    router_url: String,
    deriver_a_url: String,
    deriver_b_url: String,
    control_plane_url: String,
    proxy_a: FaultProxyV1,
    proxy_b: FaultProxyV1,
    proxy_control_plane: FaultProxyV1,
    proxy_a_to_b: FaultProxyV1,
    proxy_b_to_router: FaultProxyV1,
    a_store: Connection,
    b_store: Connection,
    a_backups: Connection,
    b_backups: Connection,
    router_db: Connection,
    _roles: Vec<ChildGuard>,
}

impl RecoveryStackV1 {
    fn start(label: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
        let temp = temp_dir(label)?;
        let router_url = format!("http://127.0.0.1:{}", free_port()?);
        let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
        let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
        let signing_worker_url = format!("http://127.0.0.1:{}", free_port()?);
        write_product_worker_envs(
            &temp,
            &router_url,
            &deriver_a_url,
            &deriver_b_url,
            &signing_worker_url,
        )?;
        let control_plane_url = env_value(
            &temp.join(router_ab_dev::LOCAL_TENANT_ROOT_CONTROL_PLANE_ENV_FILE_V1),
            router_ab_dev::LOCAL_TENANT_ROOT_CONTROL_PLANE_URL_ENV_V1,
        )?;
        let deriver_activation =
            router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH;
        let proxy_a = FaultProxyV1::start(&deriver_a_url, deriver_activation)?;
        let proxy_b = FaultProxyV1::start(&deriver_b_url, deriver_activation)?;
        let proxy_control_plane = FaultProxyV1::start(
            &control_plane_url,
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
        )?;
        let creation_state = router_ab_dev::LOCAL_ROUTER_TENANT_ROOT_CREATION_STATE_PATH_V1;
        let proxy_a_to_b = FaultProxyV1::start(&deriver_b_url, creation_state)?;
        let proxy_b_to_router = FaultProxyV1::start(&router_url, creation_state)?;
        route_env_through_proxies(
            &temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
            &[
                (router_ab_dev::LOCAL_DERIVER_A_URL_ENV_V1, proxy_a.url.as_str()),
                (router_ab_dev::LOCAL_DERIVER_B_URL_ENV_V1, proxy_b.url.as_str()),
                (
                    router_ab_dev::LOCAL_TENANT_ROOT_CONTROL_PLANE_URL_ENV_V1,
                    proxy_control_plane.url.as_str(),
                ),
            ],
        )?;
        route_env_through_proxies(
            &temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
            &[(router_ab_dev::LOCAL_DERIVER_B_URL_ENV_V1, proxy_a_to_b.url.as_str())],
        )?;
        route_env_through_proxies(
            &temp.join(router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1),
            &[(router_ab_dev::LOCAL_ROUTER_PRIVATE_URL_ENV_V1, proxy_b_to_router.url.as_str())],
        )?;

        let start = |role: &str, env_file: &str| {
            ChildGuard::spawn_in_root(binary, role, temp.join(env_file), &temp)
        };
        let mut router = start("router", router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1)?;
        let mut deriver_a = start("deriver-a", router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1)?;
        let mut deriver_b = start("deriver-b", router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1)?;
        let (mut control_plane, _) = spawn_control_plane(&temp)?;
        wait_for_health(&router_url, router.child_mut())?;
        wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
        wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
        wait_for_health(&control_plane_url, control_plane.child_mut())?;

        let role_store = |env_file: &str, key: &str| -> Result<Connection, Box<dyn std::error::Error>> {
            Ok(Connection::open(temp.join(env_value(&temp.join(env_file), key)?))?)
        };
        Ok(Self {
            a_store: role_store(
                router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1,
                "DERIVER_A_ROLE_PRIVATE_STORAGE_PATH",
            )?,
            b_store: role_store(
                router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1,
                "DERIVER_B_ROLE_PRIVATE_STORAGE_PATH",
            )?,
            a_backups: Connection::open(
                temp.join(".router-ab-local/deriver-a/managed-backups.sqlite"),
            )?,
            b_backups: Connection::open(
                temp.join(".router-ab-local/deriver-b/managed-backups.sqlite"),
            )?,
            router_db: Connection::open(
                temp.join(".router-ab-local/router/tenant-root-creation.sqlite"),
            )?,
            _roles: vec![router, deriver_a, deriver_b, control_plane],
            temp,
            router_url,
            deriver_a_url,
            deriver_b_url,
            control_plane_url,
            proxy_a,
            proxy_b,
            proxy_control_plane,
            proxy_a_to_b,
            proxy_b_to_router,
        })
    }

    fn create(&self, grant: &str) -> Result<(u16, String), Box<dyn std::error::Error>> {
        create_tenant_root(&self.router_url, grant, TEST_ROLE_SHARED_SERVICE_AUTH)
    }

    /// Each Deriver's role-share lifecycle for one lineage.
    fn lifecycles(&self, lineage: &str) -> rusqlite::Result<(Option<String>, Option<String>)> {
        let lifecycle = |db: &Connection| {
            db.query_row(
                "SELECT lifecycle FROM tenant_root_role_shares WHERE custody_lineage_b64u = ?1",
                [lineage],
                |row| row.get(0),
            )
            .optional()
        };
        Ok((lifecycle(&self.a_store)?, lifecycle(&self.b_store)?))
    }

    /// Each Deriver's stored (managed backups, provider canaries) for one lineage.
    fn backup_objects(&self, lineage: &str) -> rusqlite::Result<((i64, i64), (i64, i64))> {
        let counts = |db: &Connection| {
            db.query_row(
                "SELECT
                     count(*) FILTER (WHERE object_key NOT LIKE '%.provider-canary.bin'),
                     count(*) FILTER (WHERE object_key LIKE '%.provider-canary.bin')
                 FROM local_tenant_root_managed_backups
                 WHERE instr(object_key, '/' || ?1 || '/') > 0",
                [lineage],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        };
        Ok((counts(&self.a_backups)?, counts(&self.b_backups)?))
    }

    /// The activation receipt the Router committed for one lineage.
    fn committed_receipt(&self, lineage: &str) -> rusqlite::Result<Option<String>> {
        self.router_db
            .query_row(
                "SELECT json_extract(value_json, '$.activation_receipt_b64u')
                 FROM local_tenant_root_creation_state
                 WHERE storage_key = 'refresh/v1/active-state'
                   AND json_extract(value_json, '$.custody_lineage_b64u') = ?1",
                [lineage],
                |row| row.get(0),
            )
            .optional()
    }

    /// Delivers an activation receipt directly to one Deriver.
    fn deliver(
        &self,
        deriver_url: &str,
        receipt: &str,
    ) -> Result<(u16, String), Box<dyn std::error::Error>> {
        post_json_to_path_with_headers(
            deriver_url,
            router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
            &json!({ "activation_receipt_b64u": receipt }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    }

    /// Loses the delivery to one Deriver after the Router commits, and returns
    /// the committed receipt.
    fn lose_delivery(
        &self,
        proxy: &FaultProxyV1,
        grant: &str,
        lineage: &str,
        expected: (Option<String>, Option<String>),
    ) -> Result<String, Box<dyn std::error::Error>> {
        proxy.drop_next();
        let (status, body) = self.create(grant)?;
        assert_ne!(status, 200, "{body}");
        assert!(proxy.dropped(), "the proxy must have dropped the delivery");
        let receipt = self
            .committed_receipt(lineage)?
            .ok_or("the Router must have committed")?;
        assert_eq!(self.lifecycles(lineage)?, expected);
        Ok(receipt)
    }

    /// Calls one operation on the Router's creation state directly, as a role
    /// holding the role-shared credential would.
    fn creation_state<T: Serialize>(
        &self,
        identity: &TenantRootIdentityV1,
        lineage: TenantRootCustodyLineageId,
        path: &str,
        request: &T,
    ) -> Result<(u16, String), Box<dyn std::error::Error>> {
        let deployment = env_value(
            &self.temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
            "LOCAL_TENANT_ROOT_DEPLOYMENT_AUTHORITY_ID",
        )?;
        let identity_digest = identity.digest()?;
        let authority_id =
            router_ab_dev::local_tenant_root_creation_authority_id_v1(&deployment, identity_digest, lineage)?;
        let b64u = |bytes: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        post_json_to_path_with_headers(
            &self.router_url,
            router_ab_dev::LOCAL_ROUTER_TENANT_ROOT_CREATION_STATE_PATH_V1,
            &json!({
                "authority_id_b64u": b64u(authority_id.as_bytes()),
                "identity_digest_b64u": b64u(identity_digest.as_bytes()),
                "custody_lineage_b64u": lineage.to_base64url(),
                "path": path,
                "request_json": serde_json::to_string(request)?,
            }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    }

    /// Counts the Router's abandonment fences and cleanup checkpoints for one
    /// lineage.
    fn abandonment_records(&self, lineage: &str) -> rusqlite::Result<(i64, i64)> {
        self.router_db.query_row(
            "SELECT
                 count(*) FILTER (WHERE storage_key = 'creation/v1/abandonment'),
                 count(*) FILTER (WHERE storage_key LIKE 'creation/v1/cleanup-checkpoint/%')
             FROM local_tenant_root_creation_state
             WHERE json_extract(value_json, '$.custody_lineage_b64u') = ?1",
            [lineage],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    /// The roles the Router's abandonment fence recorded as installed, as
    /// JSON, for one lineage.
    fn fenced_roles(&self, lineage: &str) -> rusqlite::Result<Option<String>> {
        self.router_db
            .query_row(
                "SELECT json_extract(value_json, '$.installed_roles')
                 FROM local_tenant_root_creation_state
                 WHERE storage_key = 'creation/v1/abandonment'
                   AND json_extract(value_json, '$.custody_lineage_b64u') = ?1",
                [lineage],
                |row| row.get(0),
            )
            .optional()
    }

    /// Each Deriver's creation tombstones for one lineage.
    fn tombstones(&self, lineage: &str) -> rusqlite::Result<(i64, i64)> {
        let count = |db: &Connection| {
            db.query_row(
                "SELECT count(*) FROM tenant_root_creation_tombstones
                 WHERE custody_lineage_b64u = ?1",
                [lineage],
                |row| row.get(0),
            )
        };
        Ok((count(&self.a_store)?, count(&self.b_store)?))
    }

    /// Each Deriver's completed commands for one lineage: its creation, if it
    /// wrote a share, and its cleanup.
    fn completed_commands(&self, lineage: &str) -> rusqlite::Result<(i64, i64)> {
        let count = |db: &Connection| {
            db.query_row(
                "SELECT count(*) FROM tenant_root_command_replays
                 WHERE custody_lineage_b64u = ?1 AND status = 'completed'",
                [lineage],
                |row| row.get(0),
            )
        };
        Ok((count(&self.a_store)?, count(&self.b_store)?))
    }

    /// Asks the Router to re-run both roles' cleanup of one abandoned
    /// creation, as an operator would.
    fn sweep(
        &self,
        identity: &TenantRootIdentityV1,
        lineage: &str,
    ) -> Result<(u16, String), Box<dyn std::error::Error>> {
        self.sweep_digest(&hex::encode(identity.digest()?.as_bytes()), lineage)
    }

    /// The sweep request as the runbook builds it, from a tombstone's hex
    /// identity digest.
    fn sweep_digest(
        &self,
        identity_digest_hex: &str,
        lineage: &str,
    ) -> Result<(u16, String), Box<dyn std::error::Error>> {
        let identity_digest = hex::decode(identity_digest_hex)?;
        post_json_to_path_with_headers(
            &self.router_url,
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_SWEEP_PRIVATE_REQUEST_PATH,
            &json!({
                "identity_digest_b64u":
                    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity_digest),
                "custody_lineage_b64u": lineage,
            }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    }

    /// The runbook's search for residue: each Deriver's tombstoned lineages
    /// that still hold initial-epoch objects, as (role, identity digest hex,
    /// lineage).
    fn documented_residue(&self) -> rusqlite::Result<Vec<(String, String, String)>> {
        let mut residue = Vec::new();
        for (role, store, backups) in [
            ("deriver-a", &self.a_store, &self.a_backups),
            ("deriver-b", &self.b_store, &self.b_backups),
        ] {
            let tombstones = store
                .prepare(
                    "SELECT tenant_identity_digest_hex, custody_lineage_b64u
                     FROM tenant_root_creation_tombstones",
                )?
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for (identity_hex, lineage) in tombstones {
                let prefix = format!("tenant-root-managed-backup/v1/{role}/{identity_hex}/{lineage}/1");
                let objects: i64 = backups.query_row(
                    "SELECT count(*) FROM local_tenant_root_managed_backups
                     WHERE object_key IN (?1 || '.bin', ?1 || '.provider-canary.bin')",
                    [&prefix],
                    |row| row.get(0),
                )?;
                if objects > 0 {
                    residue.push((role.to_owned(), identity_hex, lineage));
                }
            }
        }
        Ok(residue)
    }

    /// Replays the last recorded control-plane activation request, which has
    /// the control plane sign a second receipt for the same evidence.
    fn reissue_captured_activation(&self) -> Result<String, Box<dyn std::error::Error>> {
        let activation_request = self
            .proxy_control_plane
            .captured()
            .ok_or("the control-plane activation request must have been recorded")?;
        thread::sleep(Duration::from_millis(20));
        let (status, body) = post_bytes_to_path_with_headers(
            &self.control_plane_url,
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
            &activation_request,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )?;
        if status != 200 {
            return Err(format!("control-plane reissue failed with {status}: {body}").into());
        }
        Ok(serde_json::from_str::<serde_json::Value>(&body)?["activation_receipt_b64u"]
            .as_str()
            .ok_or("the control plane must return an activation receipt")?
            .to_owned())
    }
}

/// Counts a Deriver's stored managed backups and provider canaries.
fn backup_object_counts(db: &Connection) -> rusqlite::Result<(i64, i64)> {
    db.query_row(
        "SELECT
             count(*) FILTER (WHERE object_key NOT LIKE '%.provider-canary.bin'),
             count(*) FILTER (WHERE object_key LIKE '%.provider-canary.bin')
         FROM local_tenant_root_managed_backups",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

/// The faults one proxy injects. Each armed fault fires once, on the next
/// matching request.
#[derive(Default)]
struct FaultProxyControlsV1 {
    armed: AtomicBool,
    drop_path: Mutex<Option<&'static str>>,
    drop_body: Mutex<Option<Vec<u8>>>,
    hold_path: Mutex<Option<&'static str>>,
    holding: AtomicBool,
    released: AtomicBool,
    captured: Mutex<Option<Vec<u8>>>,
}

fn lock_proxy<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Forwards one peer's traffic. On `fault_path` it records the latest request
/// body, including one it drops, and, when armed, drops the next request
/// before the peer reads it. It can also drop the next request whose body
/// carries a marker, or deliver the peer's response to one request only once
/// released.
struct FaultProxyV1 {
    url: String,
    controls: Arc<FaultProxyControlsV1>,
    stop: Arc<AtomicBool>,
    accept: Option<thread::JoinHandle<()>>,
}

impl FaultProxyV1 {
    fn start(
        upstream_url: &str,
        fault_path: &'static str,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let url = format!("http://{}", listener.local_addr()?);
        let upstream = upstream_url
            .strip_prefix("http://")
            .ok_or("proxy upstream must be an http URL")?
            .to_owned();
        let controls = Arc::new(FaultProxyControlsV1::default());
        let stop = Arc::new(AtomicBool::new(false));
        let accept = {
            let (controls, stop) = (Arc::clone(&controls), Arc::clone(&stop));
            thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((client, _)) => {
                            let upstream = upstream.clone();
                            let controls = Arc::clone(&controls);
                            thread::spawn(move || {
                                let _ =
                                    proxy_fault_connection(client, &upstream, fault_path, &controls);
                            });
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => return,
                    }
                }
            })
        };
        Ok(Self {
            url,
            controls,
            stop,
            accept: Some(accept),
        })
    }

    fn drop_next(&self) {
        self.controls.armed.store(true, Ordering::SeqCst);
    }

    /// Drops the next request to `path`, which need not be the recorded path.
    fn drop_next_on(&self, path: &'static str) {
        *lock_proxy(&self.controls.drop_path) = Some(path);
    }

    /// Whether the drop armed by `drop_next_on` has happened.
    fn dropped_on(&self) -> bool {
        lock_proxy(&self.controls.drop_path).is_none()
    }

    /// Drops the next request whose body contains `marker`.
    fn drop_next_containing(&self, marker: impl Into<Vec<u8>>) {
        *lock_proxy(&self.controls.drop_body) = Some(marker.into());
    }

    /// Whether the drop armed by `drop_next_containing` has happened.
    fn dropped_containing(&self) -> bool {
        lock_proxy(&self.controls.drop_body).is_none()
    }

    /// Forwards the next request to `path` and reads the peer's whole
    /// response, but delivers it only once `release_held` is called.
    fn hold_next_response_on(&self, path: &'static str) {
        self.controls.holding.store(false, Ordering::SeqCst);
        self.controls.released.store(false, Ordering::SeqCst);
        *lock_proxy(&self.controls.hold_path) = Some(path);
    }

    /// Whether a response is held: the peer has answered, the caller has not
    /// yet been told.
    fn holding(&self) -> bool {
        self.controls.holding.load(Ordering::SeqCst)
    }

    fn release_held(&self) {
        self.controls.released.store(true, Ordering::SeqCst);
    }

    /// Whether the armed drop has happened.
    fn dropped(&self) -> bool {
        !self.controls.armed.load(Ordering::SeqCst)
    }

    fn clear_captured(&self) {
        *lock_proxy(&self.controls.captured) = None;
    }

    fn captured(&self) -> Option<Vec<u8>> {
        lock_proxy(&self.controls.captured).clone()
    }
}

impl Drop for FaultProxyV1 {
    fn drop(&mut self) {
        self.release_held();
        self.stop.store(true, Ordering::SeqCst);
        if let Some(accept) = self.accept.take() {
            let _ = accept.join();
        }
    }
}

fn proxy_fault_connection(
    client: TcpStream,
    upstream: &str,
    fault_path: &str,
    controls: &FaultProxyControlsV1,
) -> io::Result<()> {
    client.set_nonblocking(false)?;
    client.set_read_timeout(Some(Duration::from_secs(15)))?;
    client.set_write_timeout(Some(Duration::from_secs(15)))?;
    let mut client_reader = BufReader::new(client.try_clone()?);
    let request_head = read_proxy_http_head(&mut client_reader)?;
    let head_text = String::from_utf8_lossy(&request_head);
    let content_length = head_text
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    let mut body = vec![0_u8; content_length];
    client_reader.read_exact(&mut body)?;
    let posts_to = |path: &str| head_text.starts_with(&format!("POST {path} HTTP/1.1\r\n"));
    if posts_to(fault_path) {
        *lock_proxy(&controls.captured) = Some(body.clone());
        if controls.armed.swap(false, Ordering::SeqCst) {
            return client.shutdown(Shutdown::Both);
        }
    }
    {
        let mut drop_path = lock_proxy(&controls.drop_path);
        if drop_path.is_some_and(posts_to) {
            *drop_path = None;
            return client.shutdown(Shutdown::Both);
        }
    }
    {
        let mut drop_body = lock_proxy(&controls.drop_body);
        if drop_body.as_ref().is_some_and(|marker| {
            body.windows(marker.len()).any(|window| window == marker.as_slice())
        }) {
            *drop_body = None;
            return client.shutdown(Shutdown::Both);
        }
    }
    let hold = {
        let mut hold_path = lock_proxy(&controls.hold_path);
        let hold = hold_path.is_some_and(posts_to);
        if hold {
            *hold_path = None;
        }
        hold
    };
    let mut upstream = TcpStream::connect(upstream)?;
    upstream.set_read_timeout(Some(Duration::from_secs(15)))?;
    upstream.set_write_timeout(Some(Duration::from_secs(15)))?;
    upstream.write_all(&request_head)?;
    upstream.write_all(&body)?;
    upstream.shutdown(Shutdown::Write)?;
    let mut client_writer = client;
    if hold {
        let mut response = Vec::new();
        upstream.read_to_end(&mut response)?;
        controls.holding.store(true, Ordering::SeqCst);
        while !controls.released.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
        }
        client_writer.write_all(&response)?;
    } else {
        io::copy(&mut upstream, &mut client_writer)?;
    }
    client_writer.shutdown(Shutdown::Write)
}

#[test]
fn vm_pair_reply_loss_reconciles_only_after_clean_transport_eof(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    for fault in [
        PairReplyFault::LostSealedCompletion,
        PairReplyFault::TruncatedZeroChunk,
    ] {
        let temp = temp_dir("pair-reply-loss")?;
        let router_url = format!("http://127.0.0.1:{}", free_port()?);
        let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
        let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
        let signing_worker_url = format!("http://127.0.0.1:{}", free_port()?);
        let proxy_listener = TcpListener::bind("127.0.0.1:0")?;
        let proxy_url = format!("http://{}", proxy_listener.local_addr()?);
        let router_env = write_product_worker_envs(
            &temp,
            &router_url,
            &deriver_a_url,
            &deriver_b_url,
            &signing_worker_url,
        )?;
        let tenant_root_fixture = provision_product_tenant_root(
            env!("CARGO_BIN_EXE_router_ab_local_worker"),
            &temp,
            &router_url,
            &deriver_a_url,
            &deriver_b_url,
        )?;
        let a_env_path = temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1);
        let a_env = fs::read_to_string(&a_env_path)?;
        let proxied_a_env = a_env.replace(&deriver_b_url, &proxy_url);
        assert_ne!(
            proxied_a_env, a_env,
            "A must route its B peer through the proxy"
        );
        fs::write(&a_env_path, proxied_a_env)?;

        let mut router = ChildGuard::spawn_in_root(
            binary,
            "router",
            temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
            &temp,
        )?;
        let mut deriver_a = ChildGuard::spawn_in_root(binary, "deriver-a", a_env_path, &temp)?;
        let mut deriver_b = ChildGuard::spawn_in_root(
            binary,
            "deriver-b",
            temp.join(router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1),
            &temp,
        )?;
        let mut signing_worker = ChildGuard::spawn_in_root(
            binary,
            "signing-worker",
            temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
            &temp,
        )?;
        wait_for_health(&router_url, router.child_mut())?;
        wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
        wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
        wait_for_health(&signing_worker_url, signing_worker.child_mut())?;

        let b_authority = deriver_b_url.strip_prefix("http://").unwrap().to_owned();
        let proxy = thread::spawn(move || -> io::Result<(usize, usize)> {
            let deadline = Instant::now() + Duration::from_secs(15);
            let expected_connections = match fault {
                PairReplyFault::LostSealedCompletion => 2,
                PairReplyFault::TruncatedZeroChunk => 1,
            };
            let mut peer_connections = 0;
            let mut dropped_completions = 0;
            for _ in 0..expected_connections {
                let client = accept_proxy_client_until(&proxy_listener, deadline)?;
                let peer = proxy_pair_reply_connection(client, &b_authority, fault)?;
                if peer {
                    peer_connections += 1;
                    dropped_completions += 1;
                }
            }
            Ok((peer_connections, dropped_completions))
        });

        let (request, _) = product_registration_request(&router_env, &tenant_root_fixture)?;
        let (status, body) = post_json_to_path_with_headers(
            &router_url,
            LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
            &request,
            &[(
                LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                TEST_GATEWAY_TO_ROUTER_AUTH,
            )],
        )?;
        let (peer_connections, dropped_completions) =
            proxy.join().map_err(|_| "proxy panicked")??;
        assert_eq!(peer_connections, 1);
        assert_eq!(dropped_completions, 1);

        let b_env = fs::read_to_string(temp.join(router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1))?;
        let b_config = parse_local_worker_role_config_for_role_v1(
            LocalServiceRoleV1::DeriverB,
            parse_local_env_file_contents_v1(&b_env)?,
        )?;
        let LocalWorkerRoleConfigV1::DeriverB(b_config) = b_config else {
            return Err("Deriver B env parsed as another role".into());
        };
        let b_connection = Connection::open(temp.join(b_config.role_private_storage_path))?;
        let b_record_json: String = b_connection.query_row(
            "SELECT record_json FROM local_deriver_b_yao_pairs",
            [],
            |row| row.get(0),
        )?;
        let b_record: serde_json::Value = serde_json::from_str(&b_record_json)?;
        assert_eq!(
            b_record["status"], "completed",
            "B must commit before reply loss"
        );
        let lookup = json!({
            "pair_binding": b_record["pair_binding"],
            "root_metadata_digest": b_record["root_metadata_digest"],
            "execution_id": b_record["execution_id"],
        });
        let (outcome_status, outcome_body) = post_json_to_path_with_headers(
            &deriver_b_url,
            router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_OUTCOME_PATH,
            &lookup,
            &[(
                LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                TEST_ROLE_SHARED_SERVICE_AUTH,
            )],
        )?;
        assert_eq!(outcome_status, 200, "{outcome_body}");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&outcome_body)?,
            b_record["execution"]
        );
        let mut wrong_scope = lookup.clone();
        wrong_scope["root_metadata_digest"][0] = json!(
            wrong_scope["root_metadata_digest"][0]
                .as_u64()
                .ok_or("root digest byte is missing")?
                ^ 1
        );
        let (wrong_scope_status, _) = post_json_to_path_with_headers(
            &deriver_b_url,
            router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_OUTCOME_PATH,
            &wrong_scope,
            &[(
                LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                TEST_ROLE_SHARED_SERVICE_AUTH,
            )],
        )?;
        assert_ne!(wrong_scope_status, 200, "wrong root cannot read B outcome");
        let mut wrong_execution = lookup;
        wrong_execution["execution_id"][0] = json!(
            wrong_execution["execution_id"][0]
                .as_u64()
                .ok_or("execution id byte is missing")?
                ^ 1
        );
        let (wrong_execution_status, _) = post_json_to_path_with_headers(
            &deriver_b_url,
            router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_OUTCOME_PATH,
            &wrong_execution,
            &[(
                LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                TEST_ROLE_SHARED_SERVICE_AUTH,
            )],
        )?;
        assert_ne!(
            wrong_execution_status, 200,
            "wrong execution cannot read B outcome"
        );

        let a_env = fs::read_to_string(temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1))?;
        let a_config = parse_local_worker_role_config_for_role_v1(
            LocalServiceRoleV1::DeriverA,
            parse_local_env_file_contents_v1(&a_env)?,
        )?;
        let LocalWorkerRoleConfigV1::DeriverA(a_config) = a_config else {
            return Err("Deriver A env parsed as another role".into());
        };
        let a_connection = Connection::open(temp.join(a_config.role_private_storage_path))?;
        let a_record_json: String = a_connection.query_row(
            "SELECT record_json FROM local_deriver_a_yao_pairs",
            [],
            |row| row.get(0),
        )?;
        let a_record: serde_json::Value = serde_json::from_str(&a_record_json)?;
        match fault {
            PairReplyFault::LostSealedCompletion => {
                assert_eq!(status, 200, "{body}");
                assert!(matches!(
                    serde_json::from_str::<RouterEd25519YaoExecuteResultV1>(&body)?,
                    RouterEd25519YaoExecuteResultV1::Succeeded { .. }
                ));
                assert_eq!(a_record["status"], "completed");
                let completed: LocalDeriverAPairRecordV1 = serde_json::from_str(&a_record_json)?;
                let LocalDeriverAPairRecordV1::Completed {
                    pair_binding,
                    claim_identity,
                    payload,
                    outcome,
                    ..
                } = completed
                else {
                    return Err("A did not durably complete after reconciliation".into());
                };
                drop(deriver_a);
                deriver_a = ChildGuard::spawn_in_root(
                    binary,
                    "deriver-a",
                    temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
                    &temp,
                )?;
                wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
                let retry = CloudflareEd25519YaoPairExecuteRequestV1 {
                    pair_binding,
                    tenant_root: payload.tenant_root,
                    work: payload.work,
                    input: payload.input,
                    local_receipt: claim_identity.local_receipt,
                    peer_receipt: claim_identity.peer_receipt,
                };
                let (replay_status, replay_body) = post_json_to_path_with_headers(
                    &deriver_a_url,
                    LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
                    &retry,
                    &[(
                        LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                        TEST_ROLE_SHARED_SERVICE_AUTH,
                    )],
                )?;
                assert_eq!(replay_status, 200, "{replay_body}");
                assert_eq!(
                    serde_json::from_str::<serde_json::Value>(&replay_body)?,
                    serde_json::to_value(outcome)?
                );
            }
            PairReplyFault::TruncatedZeroChunk => {
                let result = serde_json::from_str::<RouterEd25519YaoExecuteResultV1>(&body)?;
                assert!(
                    !matches!(result, RouterEd25519YaoExecuteResultV1::Succeeded { .. }),
                    "truncated framing must fail closed: {body}"
                );
                assert_ne!(a_record["status"], "completed");
            }
        }
        println!(
            "R150_VM_B_REPLY_LOSS_E2E {}",
            json!({
                "fault": match fault {
                    PairReplyFault::LostSealedCompletion => "lost_sealed_completion",
                    PairReplyFault::TruncatedZeroChunk => "truncated_zero_chunk",
                },
                "b_completed": true,
                "a_completed": a_record["status"] == "completed",
                "authenticated_reconciliation": matches!(fault, PairReplyFault::LostSealedCompletion),
            })
        );
        drop(router);
        drop(deriver_a);
        drop(deriver_b);
        drop(signing_worker);
        drop(a_connection);
        drop(b_connection);
        fs::remove_dir_all(temp)?;
    }
    Ok(())
}

fn proxy_pair_reply_connection(
    mut client: TcpStream,
    b_authority: &str,
    fault: PairReplyFault,
) -> io::Result<bool> {
    client.set_read_timeout(Some(Duration::from_secs(15)))?;
    client.set_write_timeout(Some(Duration::from_secs(15)))?;
    let mut client_reader = BufReader::new(client.try_clone()?);
    let request_head = read_proxy_http_head(&mut client_reader)?;
    let is_peer = request_head.starts_with(
        format!("POST {LOCAL_DERIVER_B_ED25519_YAO_PEER_PATH} HTTP/1.1\r\n").as_bytes(),
    );
    let mut upstream = TcpStream::connect(b_authority)?;
    upstream.set_read_timeout(Some(Duration::from_secs(15)))?;
    upstream.set_write_timeout(Some(Duration::from_secs(15)))?;
    upstream.write_all(&request_head)?;
    let mut upstream_request = upstream.try_clone()?;
    let request_copy = thread::spawn(move || -> io::Result<()> {
        io::copy(&mut client_reader, &mut upstream_request)?;
        upstream_request.shutdown(Shutdown::Write)
    });

    if is_peer {
        let mut upstream_reader = BufReader::new(upstream);
        let response_head = read_proxy_http_head(&mut upstream_reader)?;
        client.write_all(&response_head)?;
        let mut dropped_completion = false;
        loop {
            let mut size_line = Vec::new();
            upstream_reader.read_until(b'\n', &mut size_line)?;
            let size_text = std::str::from_utf8(
                size_line
                    .strip_suffix(b"\r\n")
                    .ok_or_else(|| io::Error::other("proxy saw malformed chunk size"))?,
            )
            .map_err(io::Error::other)?;
            let size = usize::from_str_radix(size_text, 16).map_err(io::Error::other)?;
            let mut chunk = vec![0_u8; size + 2];
            upstream_reader.read_exact(&mut chunk)?;
            if size == 0 {
                if !dropped_completion {
                    return Err(io::Error::other("B did not send a sealed completion"));
                }
                match fault {
                    PairReplyFault::LostSealedCompletion => client.write_all(b"0\r\n\r\n")?,
                    PairReplyFault::TruncatedZeroChunk => client.write_all(b"0\r\n")?,
                }
                break;
            }
            if serde_json::from_slice::<Ed25519YaoRoleExecutionV1>(&chunk[..size]).is_ok() {
                dropped_completion = true;
                continue;
            }
            client.write_all(&size_line)?;
            client.write_all(&chunk)?;
        }
    } else {
        io::copy(&mut upstream, &mut client)?;
    }
    client.shutdown(Shutdown::Write)?;
    request_copy
        .join()
        .map_err(|_| io::Error::other("proxy request-copy thread panicked"))??;
    Ok(is_peer)
}

fn read_proxy_http_head(reader: &mut impl BufRead) -> io::Result<Vec<u8>> {
    let mut head = Vec::new();
    loop {
        let mut line = Vec::new();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Err(io::Error::other("proxy HTTP head ended early"));
        }
        head.extend_from_slice(&line);
        if line == b"\r\n" {
            return Ok(head);
        }
    }
}

fn accept_proxy_client_until(listener: &TcpListener, deadline: Instant) -> io::Result<TcpStream> {
    listener.set_nonblocking(true)?;
    loop {
        match listener.accept() {
            Ok((client, _)) => {
                client.set_nonblocking(false)?;
                return Ok(client);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "fault proxy did not receive the expected request",
                    ));
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(error),
        }
    }
}

#[derive(Clone, Copy)]
enum SigningWorkerFinalizationFault {
    LostReplyAfterCommit,
    MissingActivation,
}

#[test]
fn vm_router_reconciles_signing_worker_reply_loss_without_activating_missing_material(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    for fault in [
        SigningWorkerFinalizationFault::LostReplyAfterCommit,
        SigningWorkerFinalizationFault::MissingActivation,
    ] {
        let temp = temp_dir("signing-worker-finalization-loss")?;
        let router_url = format!("http://127.0.0.1:{}", free_port()?);
        let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
        let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
        let signing_worker_url = format!("http://127.0.0.1:{}", free_port()?);
        let proxy_listener = TcpListener::bind("127.0.0.1:0")?;
        let proxy_url = format!("http://{}", proxy_listener.local_addr()?);
        let router_env = write_product_worker_envs(
            &temp,
            &router_url,
            &deriver_a_url,
            &deriver_b_url,
            &signing_worker_url,
        )?;
        let tenant_root_fixture = provision_product_tenant_root(
            env!("CARGO_BIN_EXE_router_ab_local_worker"),
            &temp,
            &router_url,
            &deriver_a_url,
            &deriver_b_url,
        )?;
        let proxied_router_env = router_env.replace(&signing_worker_url, &proxy_url);
        assert_ne!(proxied_router_env, router_env);
        fs::write(
            temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
            proxied_router_env,
        )?;
        let mut router = ChildGuard::spawn_in_root(
            binary,
            "router",
            temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
            &temp,
        )?;
        let mut deriver_a = ChildGuard::spawn_in_root(
            binary,
            "deriver-a",
            temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
            &temp,
        )?;
        let mut deriver_b = ChildGuard::spawn_in_root(
            binary,
            "deriver-b",
            temp.join(router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1),
            &temp,
        )?;
        let mut signing_worker = ChildGuard::spawn_in_root(
            binary,
            "signing-worker",
            temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
            &temp,
        )?;
        wait_for_health(&router_url, router.child_mut())?;
        wait_for_health(&deriver_a_url, deriver_a.child_mut())?;
        wait_for_health(&deriver_b_url, deriver_b.child_mut())?;
        wait_for_health(&signing_worker_url, signing_worker.child_mut())?;
        let sw_authority = signing_worker_url
            .strip_prefix("http://")
            .unwrap()
            .to_owned();
        let proxy = thread::spawn(move || -> io::Result<(usize, usize)> {
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut activation_requests = 0;
            let mut finalization_lookups = 0;
            for _ in 0..2 {
                let client = accept_proxy_client_until(&proxy_listener, deadline)?;
                match proxy_signing_worker_finalization(client, &sw_authority, fault)? {
                    true => activation_requests += 1,
                    false => finalization_lookups += 1,
                }
            }
            Ok((activation_requests, finalization_lookups))
        });
        let (request, _) = product_registration_request(&router_env, &tenant_root_fixture)?;
        let (status, body) = post_json_to_path_with_headers(
            &router_url,
            LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
            &request,
            &[(
                LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                TEST_GATEWAY_TO_ROUTER_AUTH,
            )],
        )?;
        assert_eq!(status, 200, "{body}");
        let (activations, lookups) = proxy.join().map_err(|_| "proxy panicked")??;
        assert_eq!((activations, lookups), (1, 1));
        let result = serde_json::from_str::<RouterEd25519YaoExecuteResultV1>(&body)?;
        match fault {
            SigningWorkerFinalizationFault::LostReplyAfterCommit => {
                assert!(matches!(
                    result,
                    RouterEd25519YaoExecuteResultV1::Succeeded { .. }
                ));
            }
            SigningWorkerFinalizationFault::MissingActivation => {
                assert!(matches!(
                    result,
                    RouterEd25519YaoExecuteResultV1::RecoverableFailure { .. }
                ));
                drop(router);
                let router_env_path = temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1);
                fs::write(&router_env_path, &router_env)?;
                router = ChildGuard::spawn_in_root(binary, "router", router_env_path, &temp)?;
                wait_for_health(&router_url, router.child_mut())?;
                let (retry_status, retry_body) = post_json_to_path_with_headers(
                    &router_url,
                    LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                    &request,
                    &[
                        (
                            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                            TEST_GATEWAY_TO_ROUTER_AUTH,
                        ),
                        (router_ab_cloudflare::ROUTER_ED25519_YAO_REPLAY_HEADER_V1, "1"),
                    ],
                )?;
                assert_eq!(retry_status, 200, "{retry_body}");
                assert!(matches!(
                    serde_json::from_str::<RouterEd25519YaoExecuteResultV1>(&retry_body)?,
                    RouterEd25519YaoExecuteResultV1::RecoverableFailure { .. }
                ));
            }
        }
        let sw_env =
            fs::read_to_string(temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1))?;
        let sw_config = parse_local_worker_role_config_for_role_v1(
            LocalServiceRoleV1::SigningWorker,
            parse_local_env_file_contents_v1(&sw_env)?,
        )?;
        let LocalWorkerRoleConfigV1::SigningWorker(sw_config) = sw_config else {
            return Err("SigningWorker env parsed as another role".into());
        };
        let sw_connection = Connection::open(temp.join(sw_config.role_private_storage_path))?;
        let sw_state: Option<Vec<u8>> = sw_connection
            .query_row(
                "SELECT value FROM local_role_private_state WHERE key = 'ed25519-yao/worker-state-v2'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let has_activation = sw_state
            .as_deref()
            .map(serde_json::from_slice::<serde_json::Value>)
            .transpose()?
            .and_then(|state| {
                state["state"]["active"]["active_identities"]
                    .as_array()
                    .map(|identities| !identities.is_empty())
            })
            .unwrap_or(false);
        assert_eq!(
            has_activation,
            matches!(fault, SigningWorkerFinalizationFault::LostReplyAfterCommit)
        );
        println!(
            "R150_VM_SIGNING_WORKER_REPLY_LOSS_E2E {}",
            json!({
                "fault": match fault {
                    SigningWorkerFinalizationFault::LostReplyAfterCommit => "lost_reply_after_commit",
                    SigningWorkerFinalizationFault::MissingActivation => "missing_activation",
                },
                "router_succeeded": matches!(fault, SigningWorkerFinalizationFault::LostReplyAfterCommit),
                "signing_worker_active": has_activation,
                "activation_requests": activations,
                "read_only_lookups": lookups,
            })
        );
        drop(router);
        drop(deriver_a);
        drop(deriver_b);
        drop(signing_worker);
        drop(sw_connection);
        fs::remove_dir_all(temp)?;
    }
    Ok(())
}

fn proxy_signing_worker_finalization(
    mut client: TcpStream,
    sw_authority: &str,
    fault: SigningWorkerFinalizationFault,
) -> io::Result<bool> {
    client.set_read_timeout(Some(Duration::from_secs(15)))?;
    client.set_write_timeout(Some(Duration::from_secs(15)))?;
    let mut reader = BufReader::new(client.try_clone()?);
    let head = read_proxy_http_head(&mut reader)?;
    let is_activation = head.starts_with(
        format!(
            "POST {} HTTP/1.1\r\n",
            router_ab_dev::LOCAL_SIGNING_WORKER_ED25519_YAO_ACTIVATION_PACKAGES_PATH
        )
        .as_bytes(),
    );
    let is_lookup = head.starts_with(
        format!(
            "POST {} HTTP/1.1\r\n",
            router_ab_dev::LOCAL_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_PATH
        )
        .as_bytes(),
    );
    if !is_activation && !is_lookup {
        return Err(io::Error::other(
            "proxy received an unexpected SigningWorker route",
        ));
    }
    if is_activation && matches!(fault, SigningWorkerFinalizationFault::MissingActivation) {
        io::copy(&mut reader, &mut io::sink())?;
        client.shutdown(Shutdown::Write)?;
        return Ok(true);
    }
    let mut upstream = TcpStream::connect(sw_authority)?;
    upstream.set_read_timeout(Some(Duration::from_secs(15)))?;
    upstream.set_write_timeout(Some(Duration::from_secs(15)))?;
    upstream.write_all(&head)?;
    io::copy(&mut reader, &mut upstream)?;
    upstream.shutdown(Shutdown::Write)?;
    if is_activation {
        let mut committed_response = Vec::new();
        upstream.read_to_end(&mut committed_response)?;
        if !committed_response.starts_with(b"HTTP/1.1 200 ") {
            return Err(io::Error::other("SigningWorker did not commit activation"));
        }
    } else {
        io::copy(&mut upstream, &mut client)?;
    }
    client.shutdown(Shutdown::Write)?;
    Ok(is_activation)
}

#[test]
fn local_ecdsa_effect_claim_and_consume_survive_terminal_failure(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let worker_binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    let smoke_binary = env!("CARGO_BIN_EXE_router_ab_local_smoke");
    let temp = temp_dir("ecdsa-atomic-claim")?;
    let router_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_a_url = format!("http://127.0.0.1:{}", free_port()?);
    let deriver_b_url = format!("http://127.0.0.1:{}", free_port()?);
    let signing_worker_url = format!("http://127.0.0.1:{}", free_port()?);
    write_product_worker_envs(
        &temp,
        &router_url,
        &deriver_a_url,
        &deriver_b_url,
        &signing_worker_url,
    )?;
    let mut router = ChildGuard::spawn_in_root(
        worker_binary,
        "router",
        temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
        &temp,
    )?;
    let mut deriver_a = ChildGuard::spawn_in_root(
        worker_binary,
        "deriver-a",
        temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
        &temp,
    )?;
    let mut deriver_b = ChildGuard::spawn_in_root(
        worker_binary,
        "deriver-b",
        temp.join(router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1),
        &temp,
    )?;
    let signing_worker_env_path = temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1);
    let mut signing_worker = ChildGuard::spawn_in_root(
        worker_binary,
        "signing-worker",
        signing_worker_env_path.clone(),
        &temp,
    )?;
    for (url, worker) in [
        (&router_url, &mut router),
        (&deriver_a_url, &mut deriver_a),
        (&deriver_b_url, &mut deriver_b),
        (&signing_worker_url, &mut signing_worker),
    ] {
        wait_for_health(url, worker.child_mut())?;
    }

    let completed_fixture = temp.join("ecdsa-completed-finalize.json");
    let completed = Command::new(smoke_binary)
        .arg("--root")
        .arg(&temp)
        .arg("--save-finalize")
        .arg(&completed_fixture)
        .output()?;
    assert!(
        completed.status.success(),
        "VM ECDSA signing failed: {}",
        String::from_utf8_lossy(&completed.stderr)
    );
    drop(signing_worker);
    let mut signing_worker = ChildGuard::spawn_in_root(
        worker_binary,
        "signing-worker",
        signing_worker_env_path.clone(),
        &temp,
    )?;
    wait_for_health(&signing_worker_url, signing_worker.child_mut())?;
    let replay = Command::new(smoke_binary)
        .arg("--root")
        .arg(&temp)
        .arg("--verify-finalize-replay")
        .arg(&completed_fixture)
        .output()?;
    assert!(
        replay.status.success(),
        "VM ECDSA terminal replay failed: {}",
        String::from_utf8_lossy(&replay.stderr)
    );

    let config = parse_local_worker_role_config_for_role_v1(
        LocalServiceRoleV1::SigningWorker,
        parse_local_env_file_contents_v1(&fs::read_to_string(&signing_worker_env_path)?)?,
    )?;
    let LocalWorkerRoleConfigV1::SigningWorker(config) = config else {
        return Err("SigningWorker env parsed as another role".into());
    };
    let connection = Connection::open(temp.join(config.role_private_storage_path))?;
    connection.execute_batch(
        "CREATE TRIGGER reject_ecdsa_terminal BEFORE UPDATE OF terminal_json
         ON local_signing_worker_ecdsa_effect
         BEGIN SELECT RAISE(ABORT, 'injected terminal failure'); END;",
    )?;
    let pending_fixture = temp.join("ecdsa-pending-finalize.json");
    let interrupted = Command::new(smoke_binary)
        .arg("--root")
        .arg(&temp)
        .arg("--save-finalize")
        .arg(&pending_fixture)
        .output()?;
    let interrupted_error = String::from_utf8_lossy(&interrupted.stderr);
    assert!(
        !interrupted.status.success(),
        "terminal failure was not observed"
    );
    assert!(
        interrupted_error.contains("injected terminal failure"),
        "unexpected VM ECDSA failure: {interrupted_error}"
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fs::read(&pending_fixture)?)?["state"],
        "pending"
    );
    let (effect_state, terminal_json, pool_json): (String, Option<String>, String) = connection
        .query_row(
            "SELECT effect.state, effect.terminal_json, pool.record_json
             FROM local_signing_worker_ecdsa_effect AS effect
             JOIN local_signing_worker_ecdsa_pool AS pool
               ON pool.record_key = effect.presignature_key
             WHERE effect.state = 'claimed'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    assert_eq!(effect_state, "claimed");
    assert!(
        terminal_json.is_none(),
        "failed terminal write must not commit"
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&pool_json)?["material_state"]["state"],
        "consumed",
        "claimed presignature must stay consumed"
    );
    connection.execute_batch("DROP TRIGGER reject_ecdsa_terminal")?;
    drop(signing_worker);
    let mut signing_worker = ChildGuard::spawn_in_root(
        worker_binary,
        "signing-worker",
        signing_worker_env_path,
        &temp,
    )?;
    wait_for_health(&signing_worker_url, signing_worker.child_mut())?;
    let pending_replay = Command::new(smoke_binary)
        .arg("--root")
        .arg(&temp)
        .arg("--verify-finalize-replay")
        .arg(&pending_fixture)
        .output()?;
    assert!(
        pending_replay.status.success(),
        "interrupted ECDSA effect must remain pending: {}",
        String::from_utf8_lossy(&pending_replay.stderr)
    );
    let pending: serde_json::Value = serde_json::from_slice(&fs::read(&pending_fixture)?)?;
    let mut competing_request = serde_json::from_value::<
        LocalSigningWorkerAdmittedRouterAbEcdsaDerivationFinalizeRequestV1,
    >(pending["admitted"].clone())?;
    competing_request
        .request
        .operation_id
        .push_str("-contender");
    competing_request.trusted_admission.request_digest =
        competing_request.request.request_digest()?;
    let (competing_status, competing_body) = post_json_to_path_with_headers(
        &signing_worker_url,
        router_ab_dev::LOCAL_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH,
        &competing_request,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_ROLE_SHARED_SERVICE_AUTH,
        )],
    )?;
    assert_eq!(competing_status, 400, "{competing_body}");
    assert!(competing_body.contains("ReplayedLocalRequest"));
    let claimed_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM local_signing_worker_ecdsa_effect WHERE state = 'claimed'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(
        claimed_count, 1,
        "no second effect may claim spent material"
    );
    println!(
        "R150_VM_ECDSA_E2E {}",
        json!({
            "completed_replay": true,
            "failed_terminal_write": true,
            "interrupted_effect_state": effect_state,
            "interrupted_pool_material_state": "consumed",
            "restart_replay": "pending",
            "changed_operation_rejected": true,
        })
    );
    drop(connection);
    drop(signing_worker);
    drop(deriver_b);
    drop(deriver_a);
    drop(router);
    let _ = fs::remove_dir_all(temp);
    Ok(())
}

/// The NEAR owner-lane path as the Gateway drives it: a Gateway-shaped body
/// (signing request plus the Gateway's authorized operation) sent to the VM
/// Router with the dedicated Gateway credential. The Router admits it with
/// the Cloudflare Router's own admission and forwards to SigningWorker.
fn product_near_signing_process_flow(
    binary: &str,
    temp: &Path,
    router_url: &str,
    signing_worker_url: &str,
    signing_worker: ChildGuard,
    activation: &RouterAbEd25519YaoActivationResultV1,
    client_share: &[u8; 32],
    root_identity: &TenantRootIdentityV1,
) -> Result<ChildGuard, Box<dyn std::error::Error>> {
    let now_ms = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?;
    let expires_at_ms = now_ms + 120_000;
    let (prepare_request, unsigned) = product_near_prepare_request(activation, expires_at_ms)?;
    let authorized_operation =
        product_near_gateway_authorized_operation(activation, root_identity, &prepare_request, expires_at_ms)?;
    let prepare_body = gateway_signing_body(&prepare_request, &authorized_operation)?;
    let gateway_headers = [(
        LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
        TEST_GATEWAY_TO_ROUTER_AUTH,
    )];

    // Boundary checks the Router enforces before any SigningWorker work.
    let (role_shared_status, _) = post_json_to_path_with_headers(
        router_url,
        LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH,
        &prepare_body,
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
    )?;
    assert_eq!(role_shared_status, 401, "the role-shared credential cannot sign through the Router");
    let (bearer_status, bearer_body) = post_json_to_path_with_headers(
        router_url,
        LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH,
        &prepare_body,
        &[
            gateway_headers[0],
            ("authorization", "Bearer not-stripped-by-the-gateway"),
        ],
    )?;
    assert_ne!(bearer_status, 200, "a request still carrying Authorization is refused: {bearer_body}");
    let foreign_org = product_near_gateway_authorized_operation(
        activation,
        &TenantRootIdentityV1::new(
            "another-org",
            root_identity.project_id(),
            root_identity.env_id(),
            root_identity.signing_root_id(),
            root_identity.signing_root_version(),
        )?,
        &prepare_request,
        expires_at_ms,
    )?;
    let (foreign_status, foreign_body) = post_json_to_path_with_headers(
        router_url,
        LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH,
        &gateway_signing_body(&prepare_request, &foreign_org)?,
        &gateway_headers,
    )?;
    assert_ne!(foreign_status, 200, "another org's authority cannot use this wallet: {foreign_body}");

    let (status, body) = post_json_to_path_with_headers(
        router_url,
        LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH,
        &prepare_body,
        &gateway_headers,
    )?;
    assert_eq!(status, 200, "VM Router NEAR prepare: {body}");
    let prepared: NormalSigningRound1PrepareResponseV1 = serde_json::from_str(&body)?;

    drop(signing_worker);
    let mut signing_worker = ChildGuard::spawn_in_root(
        binary,
        "signing-worker",
        temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
        temp,
    )?;
    wait_for_health(signing_worker_url, signing_worker.child_mut())?;
    let (retry_status, retry_body) = post_json_to_path_with_headers(
        router_url,
        LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH,
        &prepare_body,
        &gateway_headers,
    )?;
    assert_eq!(retry_status, 200, "VM Router NEAR prepare replay: {retry_body}");
    assert_eq!(body, retry_body, "restart must preserve the original nonce handle");

    let finalize_request = product_near_finalize_request(
        activation,
        client_share,
        &prepare_request,
        &prepared,
        expires_at_ms,
    )?;
    let finalize_body = gateway_signing_body(&finalize_request, &authorized_operation)?;

    // A second SigningWorker process on the same role store, fronted by a
    // second Router process: the same finalize races through both paths.
    let signing_worker_env_path = temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1);
    let replica_url = format!("http://127.0.0.1:{}", free_port()?);
    let primary_env = fs::read_to_string(&signing_worker_env_path)?;
    let replica_env = primary_env.replace(signing_worker_url, &replica_url);
    if replica_env == primary_env {
        return Err("SigningWorker replica URL is missing from its environment".into());
    }
    let replica_env_path = temp.join(".env.router-ab.signing-worker-contender.local");
    fs::write(&replica_env_path, replica_env)?;
    let mut replica = ChildGuard::spawn_in_root(binary, "signing-worker", replica_env_path, temp)?;
    wait_for_health(&replica_url, replica.child_mut())?;
    let second_router_url = format!("http://127.0.0.1:{}", free_port()?);
    let router_env = fs::read_to_string(temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1))?;
    let second_router_env = router_env
        .replace(router_url, &second_router_url)
        .replace(signing_worker_url, &replica_url);
    let second_router_env_path = temp.join(".env.router-ab.router-contender.local");
    fs::write(&second_router_env_path, second_router_env)?;
    let mut second_router = ChildGuard::spawn_in_root(binary, "router", second_router_env_path, temp)?;
    wait_for_health(&second_router_url, second_router.child_mut())?;
    let barrier = Barrier::new(3);
    let (primary_attempt, contender_attempt) = thread::scope(|scope| {
        let primary = scope.spawn(|| {
            barrier.wait();
            post_json_to_path_with_headers(
                router_url,
                LOCAL_ROUTER_NORMAL_SIGNING_PATH,
                &finalize_body,
                &gateway_headers,
            )
            .map_err(|error| error.to_string())
        });
        let contender = scope.spawn(|| {
            barrier.wait();
            post_json_to_path_with_headers(
                &second_router_url,
                LOCAL_ROUTER_NORMAL_SIGNING_PATH,
                &finalize_body,
                &gateway_headers,
            )
            .map_err(|error| error.to_string())
        });
        barrier.wait();
        (primary.join(), contender.join())
    });
    let primary_attempt = primary_attempt
        .map_err(|_| "primary Router request thread panicked")?
        .map_err(std::io::Error::other)?;
    let contender_attempt = contender_attempt
        .map_err(|_| "contending Router request thread panicked")?
        .map_err(std::io::Error::other)?;
    for (status, body) in [&primary_attempt, &contender_attempt] {
        assert!(
            *status == 200 || body.contains("ReplayedLocalRequest"),
            "concurrent Router finalize returned {status}: {body}"
        );
    }
    let body = match (&primary_attempt, &contender_attempt) {
        ((200, first), (200, second)) => {
            assert_eq!(first, second, "concurrent replay must return one terminal response");
            first.clone()
        }
        ((200, first), _) => first.clone(),
        (_, (200, second)) => second.clone(),
        _ => return Err("no Router path completed the signing claim".into()),
    };
    for url in [router_url, second_router_url.as_str()] {
        let (status, retry_body) = post_json_to_path_with_headers(
            url,
            LOCAL_ROUTER_NORMAL_SIGNING_PATH,
            &finalize_body,
            &gateway_headers,
        )?;
        assert_eq!(status, 200, "VM Router finalize replay: {retry_body}");
        assert_eq!(retry_body, body, "both paths must replay one terminal result");
    }
    drop(second_router);
    drop(replica);
    let signed: NormalSigningResponseV1 = serde_json::from_str(&body)?;
    let signature_bytes: [u8; 64] = signed.signature.as_bytes().try_into()?;
    let signature = ed25519_dalek::Signature::from_bytes(&signature_bytes);
    let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(
        &activation.public_receipt().registered_public_key(),
    )?;
    use ed25519_dalek::Verifier;
    verifying_key.verify(&Sha256::digest(&unsigned), &signature)?;

    drop(signing_worker);
    let mut signing_worker = ChildGuard::spawn_in_root(
        binary,
        "signing-worker",
        temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
        temp,
    )?;
    wait_for_health(signing_worker_url, signing_worker.child_mut())?;
    let (retry_status, retry_body) = post_json_to_path_with_headers(
        router_url,
        LOCAL_ROUTER_NORMAL_SIGNING_PATH,
        &finalize_body,
        &gateway_headers,
    )?;
    assert_eq!(retry_status, 200, "VM Router terminal replay: {retry_body}");
    assert_eq!(body, retry_body, "restart must preserve the signed terminal result");
    let config = parse_local_worker_role_config_for_role_v1(
        LocalServiceRoleV1::SigningWorker,
        parse_local_env_file_contents_v1(&fs::read_to_string(&signing_worker_env_path)?)?,
    )?;
    let LocalWorkerRoleConfigV1::SigningWorker(config) = config else {
        return Err("SigningWorker env parsed as another role".into());
    };
    let connection = Connection::open(temp.join(config.role_private_storage_path))?;
    let completed_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM local_signing_worker_near_round1 WHERE state = 'completed'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(completed_count, 1, "one-use material must have one terminal row");
    println!(
        "R150_VM_NEAR_E2E {}",
        json!({
            "wallet_id": activation.binding().lifecycle.account_id,
            "signature_digest_hex": hex::encode(Sha256::digest(signature_bytes)),
            "completed_round1_rows": completed_count,
            "router_admitted": true,
            "worker_restarts": 2,
            "independent_router_signing_worker_paths": 2,
            "concurrent_claims": true,
            "role_shared_credential_rejected": true,
            "authorization_header_rejected": true,
            "foreign_org_authority_rejected": true,
        })
    );
    Ok(signing_worker)
}

/// A Gateway-forwarded body: the signing request with the Gateway's
/// authorized operation attached, as the TS Gateway proxy sends it.
fn gateway_signing_body<T: Serialize>(
    request: &T,
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut body = serde_json::to_value(request)?;
    let object = body.as_object_mut().ok_or("signing request must be a JSON object")?;
    object.insert("authorized_operation".to_owned(), serde_json::to_value(authorized_operation)?);
    Ok(body)
}

fn product_near_prepare_request(
    activation: &RouterAbEd25519YaoActivationResultV1,
    expires_at_ms: u64,
) -> Result<(RouterAbEd25519NormalSigningPrepareRequestV2, Vec<u8>), Box<dyn std::error::Error>> {
    let binding = activation.binding();
    let account_id = &binding.lifecycle.account_id;
    let scope = NormalSigningScopeV1::new(
        "product-near-sign-1",
        account_id,
        NormalSigningAuthorizationV1::reusable_wallet_session("wallet-session-product-benchmark")?,
        binding.material_activation.clone(),
        "local-signing-worker",
    )?;
    let unsigned = product_near_unsigned_transaction(
        account_id,
        &activation.public_receipt().registered_public_key(),
    );
    let unsigned_b64u = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&unsigned);
    let action_fingerprint = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        Sha256::digest(
            r#"[{"action_type":"FunctionCall","args":"{\"amount\":\"1\"}","deposit":"0","gas":"30000000000000","method_name":"transfer"}]"#
                .as_bytes(),
        ),
    );
    let intent = RouterAbEd25519NormalSigningIntentV2::NearTransactionV1 {
        operation_id: "product-near-operation-1".to_owned(),
        operation_fingerprint: "product-near-fingerprint-1".to_owned(),
        near_account_id: account_id.clone(),
        near_network_id: RouterAbNearNetworkIdV2::Testnet,
        transactions: vec![RouterAbNearTransactionIntentV1::new(
            "receiver.near",
            action_fingerprint,
        )?],
        unsigned_transaction_borsh_b64u: unsigned_b64u.clone(),
    };
    let signing_payload = RouterAbEd25519SigningPayloadV2::NearUnsignedTransactionBorshV1 {
        unsigned_transaction_borsh_b64u: unsigned_b64u,
        expected_signing_digest_b64u: base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(&unsigned)),
    };
    let request = RouterAbEd25519NormalSigningPrepareRequestV2::new(
        scope,
        expires_at_ms,
        PublicDigest32::new([0x91; 32]),
        intent,
        signing_payload,
    )?;
    Ok((request, unsigned))
}

/// The authorized operation the Gateway attaches after consuming the owner's
/// grant and quota. In the full VM product path the Node Gateway produces it;
/// here the test acts as that Gateway with its dedicated credential.
fn product_near_gateway_authorized_operation(
    activation: &RouterAbEd25519YaoActivationResultV1,
    root_identity: &TenantRootIdentityV1,
    request: &RouterAbEd25519NormalSigningPrepareRequestV2,
    expires_at_ms: u64,
) -> Result<CloudflareRouterEd25519AcceptedAuthorizedOperationV1, Box<dyn std::error::Error>> {
    let b64u = |bytes: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let material = request.admission_material()?;
    Ok(CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
        binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
            subject_id: "product-user-1".to_owned(),
            account_id: activation.binding().lifecycle.account_id.clone(),
            authorization_id: "authorization-product-1".to_owned(),
            wallet_session_id: "wallet-session-product-benchmark".to_owned(),
            quota_id: "quota-product-1".to_owned(),
            threshold_session_id: "threshold-session-product-1".to_owned(),
            org_id: root_identity.org_id().to_owned(),
            project_id: root_identity.project_id().to_owned(),
            environment: "dev".to_owned(),
            project_environment_id: root_identity.env_id().to_owned(),
            signing_worker_id: "local-signing-worker".to_owned(),
            expires_at_ms,
        },
        authorized_operation:
            CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                authorized_operation_id: "authorized-operation-product-1".to_owned(),
                operation_id: "product-near-operation-1".to_owned(),
                capability_kind: CloudflareRouterEd25519CapabilityKindV1::NearEd25519MpcSigning,
                operation_kind: CloudflareRouterEd25519OperationKindV1::SignTransaction,
                lane_digest_b64u: b64u(&Sha256::digest(b"product-near-owner-lane")),
                intent_digest_b64u: b64u(material.intent_digest.as_bytes()),
                display_digest_b64u: b64u(request.display_digest.as_bytes()),
                operation_fingerprint_digest: b64u(&Sha256::digest(b"product-near-fingerprint-1")),
            },
    })
}

fn product_near_unsigned_transaction(account_id: &str, public_key: &[u8; 32]) -> Vec<u8> {
    let mut out = Vec::new();
    push_borsh_string(&mut out, account_id);
    out.push(0);
    out.extend_from_slice(public_key);
    out.extend_from_slice(&7_u64.to_le_bytes());
    push_borsh_string(&mut out, "receiver.near");
    out.extend_from_slice(&[0x44; 32]);
    out.extend_from_slice(&1_u32.to_le_bytes());
    out.push(2);
    push_borsh_string(&mut out, "transfer");
    push_borsh_bytes(&mut out, br#"{"amount":"1"}"#);
    out.extend_from_slice(&30_000_000_000_000_u64.to_le_bytes());
    out.extend_from_slice(&0_u128.to_le_bytes());
    out
}

fn push_borsh_string(out: &mut Vec<u8>, value: &str) {
    push_borsh_bytes(out, value.as_bytes());
}

fn push_borsh_bytes(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value);
}

fn product_near_finalize_request(
    activation: &RouterAbEd25519YaoActivationResultV1,
    client_share: &[u8; 32],
    prepare: &RouterAbEd25519NormalSigningPrepareRequestV2,
    response: &NormalSigningRound1PrepareResponseV1,
    expires_at_ms: u64,
) -> Result<RouterAbEd25519NormalSigningFinalizeRequestV2, Box<dyn std::error::Error>> {
    let material = prepare.admission_material()?;
    let client_id = frost_ed25519::Identifier::try_from(1_u16)?;
    let server_id = frost_ed25519::Identifier::try_from(2_u16)?;
    let public_key = activation.public_receipt().registered_public_key();
    let key_package = key_package_from_signing_share_bytes(client_share, &public_key, client_id)?;
    let client_round1 = client_round1_commit(&key_package)?;
    let server_hiding = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&response.server_commitments.hiding)?;
    let server_binding = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&response.server_commitments.binding)?;
    let server_commitments = frost_ed25519::round1::SigningCommitments::new(
        frost_ed25519::round1::NonceCommitment::deserialize(&server_hiding)?,
        frost_ed25519::round1::NonceCommitment::deserialize(&server_binding)?,
    );
    let signing_package = build_signing_package(
        material.admitted_signing_digest.as_bytes(),
        BTreeMap::from([
            (client_id, client_round1.commitments),
            (server_id, server_commitments),
        ]),
    );
    let client_signature_share =
        client_round2_signature_share(&signing_package, &client_round1.nonces, &key_package)?;
    let client_verifying_share =
        signer_core::near_threshold_ed25519::verifying_share_bytes_from_signing_share_bytes(
            client_share,
        );
    let protocol = RouterAbEd25519NormalSigningFinalizeProtocolV2::Ed25519TwoPartyFrostFinalizeV1(
        RouterAbEd25519TwoPartyFrostFinalizeProtocolV2::new(
            NormalSigningEd25519TwoPartyFrostCommitmentsV1::new(
                client_round1.commitments_wire.hiding,
                client_round1.commitments_wire.binding,
            )?,
            response.server_commitments.clone(),
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(client_verifying_share),
            response.server_verifying_share_b64u.clone(),
            signature_share_to_b64u(&client_signature_share)?,
        )?,
    );
    let binding = RouterAbEd25519NormalSigningPrepareBindingV2::new(
        response.server_round1_handle.clone(),
        response.round1_binding_digest,
        material.intent_digest,
        material.signing_payload_digest,
    )?;
    Ok(RouterAbEd25519NormalSigningFinalizeRequestV2::new(
        prepare.scope.clone(),
        expires_at_ms,
        binding,
        protocol,
    )?)
}

fn product_registration_request(
    router_env: &str,
    tenant_root_fixture: &ProductTenantRoot,
) -> Result<
    (
        CloudflareRouterEd25519YaoExecuteRequestV2,
        LocalEd25519YaoRecipientPrivateKeyV1,
    ),
    Box<dyn std::error::Error>,
> {
    let application = Ed25519YaoApplicationBindingFactsV1::new(
        Ed25519YaoApplicationBindingWalletIdV1::parse("account-product-benchmark")?,
        Ed25519YaoApplicationBindingSigningKeyIdV1::parse("ed25519ks_product_benchmark")?,
        Ed25519YaoApplicationBindingSigningRootIdV1::parse("project:local")?,
        Ed25519YaoApplicationBindingKeyCreationSignerSlotV1::new(1)?,
    );
    let context = Ed25519YaoStableKeyDerivationContextV1::new(application.digest(), 1, 2)?;
    let client_root = Ed25519YaoClientRootV1::from_secret_bytes(fresh_nonzero_bytes_32()?);
    let (client_a, client_b) =
        derive_ed25519_yao_client_contributions_v1(&client_root, &context)?.into_parts();
    let application_binding = RouterAbEd25519YaoApplicationBindingFactsV1::new(
        "account-product-benchmark",
        "ed25519ks_product_benchmark",
        "project:local",
        1,
    )?;
    let admission = admit_local_ed25519_yao_registration_v1(
        RouterAbEd25519YaoRegistrationAdmissionRequestV1::new(
            RouterAbEd25519YaoLifecycleScopeV1::new(
                "product-benchmark-registration",
                RootShareEpoch::new("local-root-v1")?,
                "account-product-benchmark",
                "wallet-session-product-benchmark",
                "signer-set-product-benchmark",
                "local-signing-worker",
                MpcMaterialActivationRefV1::new(
                    "activation-product-benchmark",
                    "capability-product-benchmark",
                    "account-product-benchmark",
                    "key-product-benchmark",
                    "product-benchmark-registration",
                    "local-signing-worker",
                )?,
            )?,
            application_binding.clone(),
            [1, 2],
        )?,
    )?;
    let client_recipient = generate_local_ed25519_yao_recipient_key_pair_v1()?;
    let recipients = LocalEd25519YaoActivationRecipientsV1 {
        client_public_key: client_recipient.public_key,
        signing_worker_public_key: x25519_public_key_from_env(
            router_env,
            "SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY",
        )?,
    };
    let (client_a_y, client_a_tau) = client_a.into_parts();
    let (client_b_y, client_b_tau) = client_b.into_parts();
    let request_a = LocalEd25519YaoActivationDeriverARequestV1 {
        binding: admission.binding.clone(),
        application_binding: application_binding.clone(),
        participant_ids: [1, 2],
        client_contribution: LocalEd25519YaoClientContributionV1 {
            y: client_a_y.into_bytes(),
            tau: client_a_tau.into_bytes(),
        },
        recipients,
    };
    let request_b = LocalEd25519YaoActivationDeriverBRequestV1 {
        binding: admission.binding.clone(),
        application_binding,
        participant_ids: [1, 2],
        client_contribution: LocalEd25519YaoClientContributionV1 {
            y: client_b_y.into_bytes(),
            tau: client_b_tau.into_bytes(),
        },
        recipients,
    };
    let input_a = seal_local_ed25519_yao_activation_deriver_a_input_v1(
        &request_a,
        x25519_public_key_from_env(router_env, "DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY")?,
    )?;
    let input_b = seal_local_ed25519_yao_activation_deriver_b_input_v1(
        &request_b,
        x25519_public_key_from_env(router_env, "DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY")?,
    )?;
    Ok((
        CloudflareRouterEd25519YaoExecuteRequestV2 {
            tenant_root: tenant_root_fixture.tenant_root.clone(),
            application: tenant_root_fixture.application.clone(),
            participant_ids: tenant_root_fixture.participant_ids,
            target: RouterEd25519YaoGatewayExecuteTargetV2::registration(
                admission.binding,
                input_a,
                input_b,
            )?,
        },
        client_recipient.private_key,
    ))
}

fn x25519_public_key_from_env(
    contents: &str,
    key: &str,
) -> Result<[u8; 32], Box<dyn std::error::Error>> {
    let prefix = format!("{key}=x25519:");
    let encoded = contents
        .lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .ok_or("x25519 public key is missing")?;
    Ok(hex::decode(encoded)?
        .try_into()
        .map_err(|_| "x25519 key length")?)
}

struct ChildGuard {
    child: Child,
}

impl ChildGuard {
    fn spawn(
        binary: &str,
        role: &str,
        env_path: PathBuf,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        migrate_role(binary, role, &env_path, None)?;
        let child = Command::new(binary)
            .arg("--role")
            .arg(role)
            .arg("--env")
            .arg(env_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        Ok(Self { child })
    }

    fn spawn_in_root(
        binary: &str,
        role: &str,
        env_path: PathBuf,
        root: &Path,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        migrate_role(binary, role, &env_path, Some(root))?;
        let child = Command::new(binary)
            .arg("--role")
            .arg(role)
            .arg("--env")
            .arg(env_path)
            .current_dir(root)
            .stdout(Stdio::null())
            .stderr(role_log(root, role)?)
            .spawn()?;
        Ok(Self { child })
    }

    fn child_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}

/// Appends a role's stderr to `<root>/logs/<role>.log`, kept as evidence.
fn role_log(root: &Path, role: &str) -> Result<Stdio, Box<dyn std::error::Error>> {
    fs::create_dir_all(root.join("logs"))?;
    Ok(Stdio::from(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("logs").join(format!("{role}.log")))?,
    ))
}

/// Applies a role's shipped SQLite schema, as an operator does before
/// starting the role.
fn migrate_role(
    binary: &str,
    role: &str,
    env_path: &Path,
    root: Option<&Path>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut command = Command::new(binary);
    command
        .arg("--role")
        .arg(role)
        .arg("--env")
        .arg(env_path)
        .arg("--migrate")
        .stdout(Stdio::null());
    if let Some(root) = root {
        command.current_dir(root);
    }
    let output = command.output()?;
    if !output.status.success() {
        return Err(format!(
            "{role} migration failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(())
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The role-shared credential every test role process is started with.
const TEST_ROLE_SHARED_SERVICE_AUTH: &str = "vm-test-role-shared-service-auth-0123456789abcdef";
/// The dedicated credential the test acts with when it plays the Gateway.
const TEST_GATEWAY_TO_ROUTER_AUTH: &str = "vm-test-gateway-to-router-auth-0123456789abcdef";

/// Replaces generated credentials with fixed test values so the test can call
/// each role as its authorized caller would.
fn pin_test_service_credentials(contents: &str) -> String {
    contents
        .lines()
        .map(|line| {
            if line.starts_with("ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET=") {
                format!("ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET={TEST_ROLE_SHARED_SERVICE_AUTH}")
            } else if line.starts_with("ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET=") {
                format!("ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET={TEST_GATEWAY_TO_ROUTER_AUTH}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn write_deriver_envs(
    root: &Path,
    deriver_a_url: &str,
    deriver_b_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    write_deriver_envs_to_roots(root, root, deriver_a_url, deriver_b_url)
}

fn write_router_env(
    root: &Path,
    router_url: &str,
    deriver_a_url: &str,
    deriver_b_url: &str,
    signing_worker_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let seed = fresh_nonzero_bytes_32()?;
    let plan = local_env_materialization_plan_v1(&seed)?;
    let file = plan
        .files
        .into_iter()
        .find(|file| file.role == LocalServiceRoleV1::Router)
        .ok_or("local env plan is missing Router file")?;
    let contents = file
        .contents
        .replace("http://127.0.0.1:4100", router_url)
        .replace("http://127.0.0.1:4103", deriver_a_url)
        .replace("http://127.0.0.1:4104", deriver_b_url)
        .replace("http://127.0.0.1:4105", signing_worker_url);
    let contents = pin_test_service_credentials(&contents);
    fs::create_dir_all(root)?;
    fs::write(root.join(file.path), contents)?;
    Ok(())
}

fn write_product_worker_envs(
    root: &Path,
    router_url: &str,
    deriver_a_url: &str,
    deriver_b_url: &str,
    signing_worker_url: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let seed = fresh_nonzero_bytes_32()?;
    let control_plane_url = format!("http://127.0.0.1:{}", free_port()?);
    let plan = local_env_materialization_plan_v1(&seed)?;
    for directory in &plan.directories {
        fs::create_dir_all(root.join(directory))?;
    }
    let replace = |contents: &str| {
        pin_test_service_credentials(
            &contents
                .replace("http://127.0.0.1:4100", router_url)
                .replace("http://127.0.0.1:4103", deriver_a_url)
                .replace("http://127.0.0.1:4104", deriver_b_url)
                .replace("http://127.0.0.1:4105", signing_worker_url)
                .replace("http://127.0.0.1:4106", &control_plane_url),
        )
    };
    let mut router_env = None;
    for file in plan.files {
        let contents = replace(&file.contents);
        if file.role == LocalServiceRoleV1::Router {
            router_env = Some(contents.clone());
        }
        fs::write(root.join(file.path), contents)?;
    }
    for file in plan.tenant_root_files {
        fs::write(root.join(file.path), replace(&file.contents))?;
    }
    router_env.ok_or_else(|| "local env plan is missing Router file".into())
}

/// A tenant root created through the VM ceremony, and the application facts
/// the product flows register under it.
struct ProductTenantRoot {
    tenant_root: CloudflareRouterEd25519YaoTenantRootV1,
    application: RouterAbEd25519YaoApplicationBindingFactsV1,
    participant_ids: [u16; 2],
}

fn product_tenant_root_identity() -> Result<TenantRootIdentityV1, Box<dyn std::error::Error>> {
    Ok(TenantRootIdentityV1::new(
        "local-org",
        "local-project",
        "local-environment",
        "project:local",
        "root-version-1",
    )?)
}

/// Creates the product tenant root the way an operator does. The Router,
/// both Derivers and the control plane are started from the written envs, the
/// operator signs a creation grant, the Router drives the ceremony, and every
/// process is stopped again: what later steps use is only what the ceremony
/// left in each role's own SQLite.
fn provision_product_tenant_root(
    worker_binary: &str,
    root: &Path,
    router_url: &str,
    deriver_a_url: &str,
    deriver_b_url: &str,
) -> Result<ProductTenantRoot, Box<dyn std::error::Error>> {
    let identity = product_tenant_root_identity()?;
    let lineage = TenantRootCustodyLineageId::from_bytes(fresh_nonzero_bytes_16()?)?;
    let grant = product_creation_grant_b64u(root, &identity, lineage, None)?;
    let mut router = ChildGuard::spawn_in_root(
        worker_binary,
        "router",
        root.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
        root,
    )?;
    let mut deriver_a = ChildGuard::spawn_in_root(
        worker_binary,
        "deriver-a",
        root.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
        root,
    )?;
    let mut deriver_b = ChildGuard::spawn_in_root(
        worker_binary,
        "deriver-b",
        root.join(router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1),
        root,
    )?;
    let (mut control_plane, control_plane_url) = spawn_control_plane(root)?;
    wait_for_health(router_url, router.child_mut())?;
    wait_for_health(deriver_a_url, deriver_a.child_mut())?;
    wait_for_health(deriver_b_url, deriver_b.child_mut())?;
    wait_for_health(&control_plane_url, control_plane.child_mut())?;
    let (status, body) = create_tenant_root(router_url, &grant, TEST_ROLE_SHARED_SERVICE_AUTH)?;
    if status != 200 {
        return Err(format!("tenant-root creation failed ({status}): {body}").into());
    }
    let created: serde_json::Value = serde_json::from_str(&body)?;
    if created["status"]["kind"] != "ready" {
        return Err(format!("tenant-root creation did not reach ready: {body}").into());
    }
    Ok(ProductTenantRoot {
        tenant_root: CloudflareRouterEd25519YaoTenantRootV1 {
            identity,
            custody_lineage_b64u: lineage.to_base64url(),
        },
        application: RouterAbEd25519YaoApplicationBindingFactsV1::new(
            "account-product-benchmark",
            "ed25519ks_product_benchmark",
            "project:local",
            1,
        )?,
        participant_ids: [1, 2],
    })
}

fn spawn_control_plane(root: &Path) -> Result<(ChildGuard, String), Box<dyn std::error::Error>> {
    let env_path = root.join(router_ab_dev::LOCAL_TENANT_ROOT_CONTROL_PLANE_ENV_FILE_V1);
    let url = env_value(&env_path, router_ab_dev::LOCAL_TENANT_ROOT_CONTROL_PLANE_URL_ENV_V1)?;
    let child = Command::new(env!("CARGO_BIN_EXE_router_ab_local_tenant_root_control_plane"))
        .arg("--env")
        .arg(env_path)
        .current_dir(root)
        .stdout(Stdio::null())
        .stderr(role_log(root, "tenant-root-control-plane")?)
        .spawn()?;
    Ok((ChildGuard { child }, url))
}

/// Signs a creation grant with the operator's grant authority, or with
/// `untrusted_seed` to model a grant from an authority the control plane
/// does not trust.
fn product_creation_grant_b64u(
    root: &Path,
    identity: &TenantRootIdentityV1,
    lineage: TenantRootCustodyLineageId,
    untrusted_seed: Option<[u8; 32]>,
) -> Result<String, Box<dyn std::error::Error>> {
    product_creation_grant_with_lifetime_b64u(
        root,
        identity,
        lineage,
        untrusted_seed,
        TENANT_ROOT_MAX_LIFETIME_MS_V1,
    )
}

/// Signs a creation grant whose window is `lifetime_ms` long.
fn product_creation_grant_with_lifetime_b64u(
    root: &Path,
    identity: &TenantRootIdentityV1,
    lineage: TenantRootCustodyLineageId,
    untrusted_seed: Option<[u8; 32]>,
    lifetime_ms: u64,
) -> Result<String, Box<dyn std::error::Error>> {
    let operator = root.join(router_ab_dev::LOCAL_TENANT_ROOT_OPERATOR_ENV_FILE_V1);
    let key_id = env_value(&operator, router_ab_dev::LOCAL_TENANT_ROOT_GRANT_KEY_ID_ENV_V1)?;
    let seed: [u8; 32] = match untrusted_seed {
        Some(seed) => seed,
        None => base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(env_value(
                &operator,
                router_ab_dev::LOCAL_TENANT_ROOT_GRANT_SIGNING_KEY_ENV_V1,
            )?)?
            .try_into()
            .map_err(|_| "operator grant key must be 32 bytes")?,
    };
    let now_ms = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?;
    // A grant is fresh only strictly after its issue time, so issuing at the
    // current millisecond races the control plane's check. Issue it a second
    // earlier; the window keeps its full length.
    let issued_at_ms = now_ms - 1_000;
    let grant = TenantRootCreationGrantV1::sign(
        identity,
        lineage,
        TenantRootCreationGrantNonceV1::from_bytes(fresh_nonzero_bytes_32()?)?,
        issued_at_ms,
        issued_at_ms + lifetime_ms,
        &key_id,
        &seed,
    )?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(grant.canonical_bytes()?))
}

fn create_tenant_root(
    router_url: &str,
    grant_b64u: &str,
    credential: &str,
) -> Result<(u16, String), Box<dyn std::error::Error>> {
    post_json_to_path_with_headers(
        router_url,
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_PRIVATE_REQUEST_PATH,
        &json!({ "creation_grant_b64u": grant_b64u }),
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, credential)],
    )
}

fn env_value(path: &Path, key: &str) -> Result<String, Box<dyn std::error::Error>> {
    parse_local_env_file_contents_v1(&fs::read_to_string(path)?)?
        .into_iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value)
        .ok_or_else(|| format!("{} does not set {key}", path.display()).into())
}

fn fresh_nonzero_bytes_16() -> Result<[u8; 16], Box<dyn std::error::Error>> {
    let bytes = fresh_nonzero_bytes_32()?;
    Ok(bytes[..16].try_into()?)
}

fn write_deriver_envs_to_roots(
    deriver_a_root: &Path,
    deriver_b_root: &Path,
    deriver_a_url: &str,
    deriver_b_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let seed = fresh_nonzero_bytes_32()?;
    let plan = local_env_materialization_plan_v1(&seed)?;
    fs::create_dir_all(deriver_a_root)?;
    fs::create_dir_all(deriver_b_root)?;
    for file in plan.files {
        let root = match file.role {
            LocalServiceRoleV1::DeriverA => deriver_a_root,
            LocalServiceRoleV1::DeriverB => deriver_b_root,
            _ => continue,
        };
        let contents = file
            .contents
            .replace("http://127.0.0.1:4103", deriver_a_url)
            .replace("http://127.0.0.1:4104", deriver_b_url);
        let contents = pin_test_service_credentials(&contents);
        fs::write(root.join(file.path), contents)?;
    }
    Ok(())
}

fn post_json_to_path_with_headers<T: Serialize>(
    base_url: &str,
    path: &str,
    body: &T,
    headers: &[(&str, &str)],
) -> Result<(u16, String), Box<dyn std::error::Error>> {
    post_bytes_to_path_with_headers(base_url, path, &serde_json::to_vec(body)?, headers)
}

fn post_bytes_to_path_with_headers(
    base_url: &str,
    path: &str,
    body: &[u8],
    headers: &[(&str, &str)],
) -> Result<(u16, String), Box<dyn std::error::Error>> {
    let authority = base_url
        .strip_prefix("http://")
        .ok_or("post URL must use http://")?;
    let mut stream = TcpStream::connect(authority)?;
    write!(
        stream,
        "POST {path} HTTP/1.1\r\nhost: {authority}\r\ncontent-type: application/json\r\n",
    )?;
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n")?;
    }
    write!(
        stream,
        "content-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("response missing header terminator")?;
    let headers = std::str::from_utf8(&response[..header_end])?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("response missing status")?
        .parse::<u16>()?;
    Ok((
        status,
        String::from_utf8(response[header_end + 4..].to_vec())?,
    ))
}

fn wait_for_health(base_url: &str, child: &mut Child) -> Result<(), Box<dyn std::error::Error>> {
    for _ in 0..80 {
        if child.try_wait()?.is_some() {
            return Err("local worker exited before health check".into());
        }
        if get_health(base_url).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err("local worker did not become healthy".into())
}

fn get_health(base_url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let authority = base_url
        .strip_prefix("http://")
        .ok_or("health URL must use http://")?;
    let mut stream = TcpStream::connect(authority)?;
    write!(
        stream,
        "GET /healthz HTTP/1.1\r\nhost: {authority}\r\nconnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    if response.starts_with("HTTP/1.1 200 ") {
        Ok(())
    } else {
        Err("health response was not 200".into())
    }
}

fn send_incomplete_http_probe(base_url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let authority = base_url
        .strip_prefix("http://")
        .ok_or("probe URL must use http://")?;
    let mut stream = TcpStream::connect(authority)?;
    stream.write_all(b"GET /healthz HTTP/1.1\r\n")?;
    let _ = stream.shutdown(std::net::Shutdown::Both);
    Ok(())
}

fn free_port() -> Result<u16, Box<dyn std::error::Error>> {
    static ALLOCATED_PORTS: OnceLock<Mutex<BTreeSet<u16>>> = OnceLock::new();
    loop {
        let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
        let mut allocated = ALLOCATED_PORTS
            .get_or_init(|| Mutex::new(BTreeSet::new()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if allocated.insert(port) {
            return Ok(port);
        }
    }
}

fn fresh_nonzero_bytes_32() -> Result<[u8; 32], Box<dyn std::error::Error>> {
    loop {
        let mut bytes = [0_u8; 32];
        getrandom::getrandom(&mut bytes)?;
        if bytes.iter().any(|byte| *byte != 0) {
            return Ok(bytes);
        }
    }
}

fn local_worker_process_test_guard() -> MutexGuard<'static, ()> {
    static PROCESS_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    PROCESS_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn temp_dir(label: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let path =
        std::env::temp_dir().join(format!("router-ab-{label}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&path)?;
    Ok(path)
}
