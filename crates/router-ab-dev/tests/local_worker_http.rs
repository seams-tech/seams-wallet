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
    TenantRootIdentityV1, };
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
    sync::{Barrier, Mutex, MutexGuard, OnceLock},
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
        let backups: i64 = Connection::open(temp.join(format!(
            ".router-ab-local/{}/managed-backups.sqlite",
            label.replace('_', "-")
        )))?
        .query_row("SELECT count(*) FROM local_tenant_root_managed_backups", [], |row| row.get(0))?;
        assert_eq!(backups, 1, "{label} stores its own managed backup");
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
    let grant = TenantRootCreationGrantV1::sign(
        identity,
        lineage,
        TenantRootCreationGrantNonceV1::from_bytes(fresh_nonzero_bytes_32()?)?,
        now_ms,
        now_ms + 300_000,
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
    let authority = base_url
        .strip_prefix("http://")
        .ok_or("post URL must use http://")?;
    let body = serde_json::to_vec(body)?;
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
