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
    LocalHttpServiceBindingClientV1, LocalWorkerRoleConfigV1,
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
        atomic::{AtomicBool, AtomicU8, Ordering},
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
fn local_signing_worker_ecdsa_state_uses_the_shared_wallet_store() {
    let lib_source = router_ab_dev_source();
    let ecdsa_source = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/local_router_ab_ecdsa.rs"),
    )
    .expect("router-ab-dev local ECDSA source should be readable");
    let store_source = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/local_signing_worker_wallet_sqlite.rs"),
    )
    .expect("router-ab-dev local wallet store source should be readable");
    for expected in [
        "prepare_signing_worker_wallet_ecdsa_from_pool_v1",
        "admit_signing_worker_wallet_ecdsa_presignature_v1",
        "claim_and_consume_effect",
        "commit_terminal",
    ] {
        assert!(
            ecdsa_source.contains(expected),
            "the VM SigningWorker must run the shared wallet-store step {expected}"
        );
    }
    assert!(
        store_source.contains("SigningWorkerWalletEcdsaStoreV1"),
        "the VM SigningWorker must keep ECDSA state in the shared wallet store"
    );
    for local_copy in [
        "apply_cloudflare_signing_worker_ecdsa_pool_command_v1",
        "local_signing_worker_ecdsa_pool_mutate_v1",
        "LocalSigningWorkerRouterAbEcdsaDerivationPresignaturePoolLifecycleV1",
    ] {
        assert!(
            !lib_source.contains(local_copy)
                && !ecdsa_source.contains(local_copy)
                && !store_source.contains(local_copy),
            "the VM must not keep its own ECDSA pool lifecycle: {local_copy}"
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
/// nothing. Both roles tombstone the lineage against a late write. The grant
/// is then spent; a fresh grant creates the root.
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
        (1, 1),
        "both roles' cleanups tombstone the lineage"
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
            "tombstoned_roles": ["deriver_a", "deriver_b"],
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

    // Inside the window: zero, then one, Deriver active. Both deliveries
    // are attempted together, so zero active loses both.
    let both = [&stack.proxy_a, &stack.proxy_b];
    for (label, proxies, expected) in [
        ("zero_active_retry_in_window", &both[..], (pending(), pending())),
        ("one_active_retry_in_window", &both[1..], (active(), pending())),
    ] {
        let (identity, lineage, lineage_b64u) = recovery_ceremony(&format!("post-commit-{label}"))?;
        let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
        let receipt = stack.lose_delivery(proxies, &grant, &lineage_b64u, expected)?;
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
        stack.lose_delivery(&both, &none_grant, &none_lineage, (pending(), pending()))?;
    let (identity, lineage, one_lineage) = recovery_ceremony("post-commit-one-active-expired")?;
    let one_grant =
        product_creation_grant_with_lifetime_b64u(&stack.temp, &identity, lineage, None, lifetime_ms)?;
    stack.proxy_control_plane.clear_captured();
    let one_receipt =
        stack.lose_delivery(&both[1..], &one_grant, &one_lineage, (active(), pending()))?;

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

/// Manual refresh commits at the Router before any Deriver swaps. B's delivery
/// is lost after A swaps; a retry of the same operation delivers the exact
/// committed receipt, an exact replay returns the durable outcome, and both
/// roles keep the retired epoch with retirement reported pending.
#[test]
fn vm_tenant_root_refresh_delivers_the_committed_receipt_after_a_lost_delivery(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-refresh")?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("refresh-delivery")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());

    // B's refresh activation is lost after the Router commits.
    stack
        .proxy_b
        .drop_next_on(router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_REFRESH_ACTIVATION_PRIVATE_REQUEST_PATH);
    let (lost_status, lost_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-1", created_revision)?;
    // A lost peer call is a server-side failure, as on Workers.
    assert_eq!(lost_status, 500, "{lost_body}");
    assert!(stack.proxy_b.dropped_on(), "the proxy must have dropped B's activation");
    let (committed_revision, committed_fence, committed_digest) =
        stack.active_state(&lineage_b64u)?;
    assert_eq!(committed_revision, created_revision + 1);
    assert_eq!(committed_fence, "terminal");
    let (a_epochs, b_epochs) = stack.epochs(&lineage_b64u)?;
    assert_eq!(a_epochs, vec![epoch(1, "retired"), epoch(2, "active")]);
    assert_eq!(b_epochs, vec![epoch(1, "active"), epoch(2, "pending")]);

    // A retry of the same operation delivers the committed receipt.
    let (retry_status, retry_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-1", created_revision)?;
    assert_eq!(retry_status, 200, "{retry_body}");
    let retry: serde_json::Value = serde_json::from_str(&retry_body)?;
    assert_eq!(retry["activation_receipt_digest_b64u"], json!(committed_digest));
    assert_eq!(retry["lifecycle_revision"], json!(committed_revision));
    for role in ["deriver_a", "deriver_b"] {
        assert_eq!(retry["retirement"][role]["kind"], "pending", "{retry}");
    }
    let retired_then_active = vec![epoch(1, "retired"), epoch(2, "active")];
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (retired_then_active.clone(), retired_then_active.clone())
    );
    assert_eq!(stack.active_state(&lineage_b64u)?.2, committed_digest);

    // An exact replay returns the durable outcome and changes nothing.
    let (replay_status, replay_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-1", created_revision)?;
    assert_eq!(replay_status, 200, "{replay_body}");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&replay_body)?, retry);

    // A new operation inside the manual-refresh interval is throttled.
    let (second_status, second_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-2", committed_revision)?;
    assert_eq!(second_status, 429, "{second_body}");

    // Nothing was erased: each role keeps both epochs' backups and canaries.
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((2, 2), (2, 2)));

    println!(
        "R150_VM_TENANT_ROOT_REFRESH_E2E {}",
        json!({
            "fault": "deriver_b_refresh_activation_lost_after_router_commit",
            "revisions": [created_revision, committed_revision],
            "lost_status": lost_status,
            "after_loss": { "router_fence": committed_fence, "deriver_a": [[1, "retired"], [2, "active"]], "deriver_b": [[1, "active"], [2, "pending"]] },
            "retry_status": retry_status,
            "retry_delivered_committed_receipt": true,
            "exact_replay_status": replay_status,
            "second_operation_status": second_status,
            "retirement": "pending",
            "epochs_after": [[1, "retired"], [2, "active"]],
            "backups_and_canaries_per_role": [2, 2],
        })
    );
    Ok(())
}

/// A refresh whose attempt misses its ceremony window before the Router commits
/// it is abandoned, and the next refresh supersedes what it left at each
/// Deriver. Both roles install the attempt, and the Router's request for its
/// receipt is lost. Inside the window another operation is refused as in
/// progress. After it, the stranded operation is refused as abandoned; the
/// attempt's correctly signed receipt can neither be committed nor activate a
/// Deriver; and a new operation refreshes the root, replacing the abandoned
/// attempt's pending rows, backups and canaries. It waits past the five-minute
/// refresh window, so it runs only on request.
#[test]
#[ignore = "waits past the five-minute refresh window; run with --ignored"]
fn vm_tenant_root_refresh_that_misses_its_window_is_abandoned_and_superseded(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-refresh-abandon")?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("refresh-abandonment")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, created_digest) = stack.active_state(&lineage_b64u)?;
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let code = |body: &str| -> Result<String, Box<dyn std::error::Error>> {
        Ok(serde_json::from_str::<serde_json::Value>(body)?["code"]
            .as_str()
            .unwrap_or_default()
            .to_owned())
    };

    // Both roles install the refresh; the Router's request for its receipt is lost.
    stack.proxy_control_plane.drop_next_on(
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REFRESH_ACTIVATION_PRIVATE_REQUEST_PATH,
    );
    let started = Instant::now();
    let (lost_status, lost_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-stranded", created_revision)?;
    assert_eq!(lost_status, 500, "{lost_body}");
    assert!(stack.proxy_control_plane.dropped_on(), "the proxy must have dropped the request");
    let (stranded_revision, stranded_fence, stranded_digest) = stack.active_state(&lineage_b64u)?;
    assert_eq!(stranded_revision, created_revision);
    assert_eq!(stranded_fence, "executed");
    assert_eq!(stranded_digest, created_digest);
    let installed = vec![epoch(1, "active"), epoch(2, "pending")];
    assert_eq!(stack.epochs(&lineage_b64u)?, (installed.clone(), installed.clone()));
    let stranded_objects = stack.epoch_objects(&lineage_b64u, 2)?;
    assert_eq!((stranded_objects.0.len(), stranded_objects.1.len()), (2, 2));
    // A correctly signed receipt for the stranded attempt, never committed.
    let uncommitted_receipt = stack.reissue_dropped_refresh_activation()?;

    // Inside the window the attempt is live: another operation must wait.
    let (busy_status, busy_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-next", created_revision)?;
    assert_eq!(busy_status, 409, "{busy_body}");
    assert_eq!(code(&busy_body)?, "tenant_root_refresh_in_progress");

    // The refresh context's window is five minutes from its issue; wait past it.
    let window = Duration::from_millis(router_ab_core::TENANT_ROOT_MAX_LIFETIME_MS_V1)
        + Duration::from_secs(2);
    if let Some(remaining) = window.checked_sub(started.elapsed()) {
        thread::sleep(remaining);
    }

    // After it, the stranded operation is abandoned with its attempt.
    let (abandoned_status, abandoned_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-stranded", created_revision)?;
    assert_eq!(abandoned_status, 409, "{abandoned_body}");
    assert_eq!(code(&abandoned_body)?, "tenant_root_refresh_abandoned");
    assert_eq!(stack.active_state(&lineage_b64u)?.1, "abandoned");

    // Abandonment won: the attempt's receipt can no longer be committed, and no
    // Deriver activates on it.
    let (commit_status, commit_body) = stack.creation_state(
        &identity,
        lineage,
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH,
        &json!({ "activation_receipt_b64u": uncommitted_receipt }),
    )?;
    assert_ne!(commit_status, 200, "{commit_body}");
    assert!(commit_body.contains("was abandoned"), "{commit_body}");
    assert_eq!(stack.active_state(&lineage_b64u)?.2, created_digest);
    let (deliver_status, deliver_body) = post_json_to_path_with_headers(
        &stack.deriver_a_url,
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_REFRESH_ACTIVATION_PRIVATE_REQUEST_PATH,
        &json!({ "activation_receipt_b64u": uncommitted_receipt }),
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
    )?;
    assert_ne!(deliver_status, 200, "{deliver_body}");
    assert_eq!(stack.epochs(&lineage_b64u)?, (installed.clone(), installed.clone()));

    // A new operation refreshes the root. Each Deriver supersedes the abandoned
    // attempt: its pending row, backup and canary are replaced by the new ones.
    let (next_status, next_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-next", created_revision)?;
    assert_eq!(next_status, 200, "{next_body}");
    let next: serde_json::Value = serde_json::from_str(&next_body)?;
    let (next_revision, next_fence, next_digest) = stack.active_state(&lineage_b64u)?;
    assert_eq!(next_revision, created_revision + 1);
    assert_eq!(next_fence, "terminal");
    assert_eq!(next["activation_receipt_digest_b64u"], json!(next_digest));
    for role in ["deriver_a", "deriver_b"] {
        assert_eq!(next["retirement"][role]["kind"], "pending", "{next}");
    }
    let retired_then_active = vec![epoch(1, "retired"), epoch(2, "active")];
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (retired_then_active.clone(), retired_then_active.clone())
    );
    let replaced_objects = stack.epoch_objects(&lineage_b64u, 2)?;
    assert_eq!((replaced_objects.0.len(), replaced_objects.1.len()), (2, 2));
    for (stranded, replaced) in stranded_objects
        .0
        .iter()
        .chain(&stranded_objects.1)
        .zip(replaced_objects.0.iter().chain(&replaced_objects.1))
    {
        assert_ne!(stranded, replaced, "the abandoned attempt's objects must be replaced");
    }
    assert_eq!(stack.backup_objects(&lineage_b64u)?, ((2, 2), (2, 2)));
    assert_eq!(stack.supersessions(&lineage_b64u)?, (1, 1));

    // An exact replay returns the durable outcome; the abandoned operation
    // stays abandoned.
    let (replay_status, replay_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-next", created_revision)?;
    assert_eq!(replay_status, 200, "{replay_body}");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&replay_body)?, next);
    let (still_status, still_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-stranded", created_revision)?;
    assert_eq!(still_status, 409, "{still_body}");
    assert_eq!(code(&still_body)?, "tenant_root_refresh_abandoned");

    println!(
        "R150_VM_TENANT_ROOT_REFRESH_ABANDONMENT_E2E {}",
        json!({
            "fault": "control_plane_refresh_activation_request_lost_then_window_closed",
            "after_loss": { "router_fence": stranded_fence, "deriver_a": [[1, "active"], [2, "pending"]], "deriver_b": [[1, "active"], [2, "pending"]] },
            "other_operation_inside_window": [busy_status, code(&busy_body)?],
            "stranded_operation_after_window": [abandoned_status, code(&abandoned_body)?],
            "signed_uncommitted_receipt_commit_after_abandonment": commit_status,
            "signed_uncommitted_receipt_delivery_after_abandonment": deliver_status,
            "new_operation_status": next_status,
            "revisions": [created_revision, next_revision],
            "epochs_after": [[1, "retired"], [2, "active"]],
            "epoch_2_backup_and_canary_replaced_per_role": true,
            "supersessions_per_role": [1, 1],
            "exact_replay_status": replay_status,
            "stranded_operation_later": [still_status, code(&still_body)?],
        })
    );
    Ok(())
}

/// The VM Router refreshes a root on its schedule, and a Router restarted while
/// a scheduled refresh is in flight resumes that same operation. The schedule's
/// interval is at its one-minute floor and the scheduler ticks every second.
/// The control plane cannot be reached for refresh activation when the root
/// first comes due, so the scheduled operation stays admitted with both roles
/// installed. The Router is restarted and the control plane becomes reachable;
/// the restarted scheduler then completes the operation it had admitted, under
/// the same id.
#[test]
fn vm_tenant_root_scheduled_refresh_runs_and_resumes_after_a_router_restart(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let mut stack = RecoveryStackV1::start_with_router_env(
        "vm-tenant-root-scheduled",
        &[
            ("TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS", "60000"),
            (router_ab_dev::LOCAL_TENANT_ROOT_REFRESH_SCHEDULER_TICK_MS_ENV_V1, "1000"),
        ],
    )?;
    let refresh_activation =
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REFRESH_ACTIVATION_PRIVATE_REQUEST_PATH;
    stack.proxy_control_plane.drop_every_on(refresh_activation);
    let (identity, lineage, lineage_b64u) = recovery_ceremony("scheduled-refresh")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let created_at = Instant::now();
    let (created_revision, _, _, _, _) = stack.refresh_bookkeeping(&lineage_b64u)?;
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());

    // Due within the interval plus its jitter, both at most a minute: the
    // scheduler admits a scheduled operation and both roles install it.
    let deadline = Instant::now() + Duration::from_secs(150);
    let scheduled_operation = loop {
        let (revision, fence, attempt_operation, pending_operation, pending_trigger) =
            stack.refresh_bookkeeping(&lineage_b64u)?;
        assert_eq!(revision, created_revision, "nothing commits while the control plane is unreachable");
        if fence == "executed" && pending_trigger.as_deref() == Some("scheduled") {
            let pending_operation = pending_operation.ok_or("a scheduled operation is pending")?;
            assert_eq!(attempt_operation.as_deref(), Some(pending_operation.as_str()));
            break pending_operation;
        }
        if Instant::now() > deadline {
            return Err(format!("no scheduled refresh was installed (fence {fence})").into());
        }
        thread::sleep(Duration::from_millis(250));
    };
    let due_after_ms = created_at.elapsed().as_millis();
    assert!(scheduled_operation.starts_with("scheduled-"), "{scheduled_operation}");
    let installed = vec![epoch(1, "active"), epoch(2, "pending")];
    assert_eq!(stack.epochs(&lineage_b64u)?, (installed.clone(), installed.clone()));

    // The Router restarts with the operation in flight; the control plane
    // becomes reachable again.
    stack.restart_router()?;
    stack.proxy_control_plane.stop_dropping();

    // The restarted scheduler completes the same operation.
    let deadline = Instant::now() + Duration::from_secs(30);
    let completed = loop {
        let bookkeeping = stack.refresh_bookkeeping(&lineage_b64u)?;
        if bookkeeping.0 == created_revision + 1 {
            break bookkeeping;
        }
        if Instant::now() > deadline {
            return Err(format!("the restarted scheduler did not complete the refresh: {bookkeeping:?}").into());
        }
        thread::sleep(Duration::from_millis(250));
    };
    let (_, completed_fence, completed_operation, pending_after, _) = completed;
    assert_eq!(completed_fence, "terminal");
    assert_eq!(completed_operation.as_deref(), Some(scheduled_operation.as_str()));
    assert_eq!(pending_after, None);
    // The commit comes first; delivery to both Derivers follows it.
    let retired_then_active = vec![epoch(1, "retired"), epoch(2, "active")];
    let delivered = (retired_then_active.clone(), retired_then_active.clone());
    let deadline = Instant::now() + Duration::from_secs(10);
    while stack.epochs(&lineage_b64u)? != delivered {
        if Instant::now() > deadline {
            return Err(format!("the committed refresh was not delivered: {:?}", stack.epochs(&lineage_b64u)?).into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    // Not due again until its next interval: no new operation starts at once.
    thread::sleep(Duration::from_secs(3));
    let (settled_revision, settled_fence, _, settled_pending, _) =
        stack.refresh_bookkeeping(&lineage_b64u)?;
    assert_eq!((settled_revision, settled_fence.as_str()), (created_revision + 1, "terminal"));
    assert_eq!(settled_pending, None);

    println!(
        "R150_VM_TENANT_ROOT_SCHEDULED_REFRESH_E2E {}",
        json!({
            "schedule": { "interval_ms": 60_000, "scheduler_tick_ms": 1_000 },
            "fault": "control_plane_refresh_activation_unreachable_until_router_restart",
            "due_after_creation_ms": due_after_ms,
            "before_restart": { "router_fence": "executed", "pending_trigger": "scheduled", "deriver_a": [[1, "active"], [2, "pending"]], "deriver_b": [[1, "active"], [2, "pending"]] },
            "router_restarted": true,
            "resumed_operation_is_the_admitted_one": true,
            "revisions": [created_revision, created_revision + 1],
            "epochs_after": [[1, "retired"], [2, "active"]],
            "no_new_operation_before_next_interval": true,
        })
    );
    Ok(())
}

/// An authorized restore that a completed refresh overtakes is superseded, and
/// the root stays usable. The operator reserves and authorizes a restore of
/// Deriver A, but both roles stay available and the restore never runs. A
/// manual refresh completes; the restore is then recorded as superseded, and
/// its execution, its challenge and its authorization are all refused. Before
/// this, the next refresh left a state that no read accepted. That refresh now
/// completes, a new challenge is reserved, and a wallet signs on epoch 3.
#[test]
fn vm_tenant_root_authorized_restore_overtaken_by_a_refresh_is_superseded(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start_with_envs(
        "vm-tenant-root-restore-superseded",
        &[
            ("TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS", "60000"),
            ("TENANT_ROOT_RETIREMENT_GRACE_MS", "1000"),
        ],
        &[],
        &[],
    )?;
    let signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("restore-superseded")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let identity_digest_b64u =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity.digest()?.as_bytes());
    let challenge_request = |incident: &str| -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let now_ms = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?;
        Ok(json!({
            "identity_digest_b64u": identity_digest_b64u,
            "custody_lineage_b64u": lineage_b64u,
            "incident_id": incident,
            "outage_observation_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(Sha256::digest(incident.as_bytes())),
            "issued_at_ms": now_ms,
            "expires_at_ms": now_ms + 120_000,
            "nonce_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(fresh_nonzero_bytes_32()?),
            "unavailable_role": "deriver_a",
        }))
    };
    let challenge_path =
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_CHALLENGE_PRIVATE_REQUEST_PATH;
    let authorize_path =
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_AUTHORIZE_PRIVATE_REQUEST_PATH;
    let superseded = "was superseded by a completed refresh before it ran";

    // The operator reserves and authorizes a restore of A that never runs.
    let first_challenge = challenge_request("vm-restore-overtaken")?;
    let (challenge_status, challenge_body) = stack.control_plane(challenge_path, &first_challenge)?;
    assert_eq!(challenge_status, 200, "{challenge_body}");
    let challenge: serde_json::Value = serde_json::from_str(&challenge_body)?;
    let authorize_request = json!({
        "identity_digest_b64u": identity_digest_b64u,
        "custody_lineage_b64u": lineage_b64u,
        "incident_authorization_b64u": stack.sign_deriver_a_incident_authorization(
            challenge["authorization_binding_b64u"].as_str().ok_or("a challenge carries its binding")?,
        )?,
    });
    let (authorize_status, authorize_body) = stack.control_plane(authorize_path, &authorize_request)?;
    assert_eq!(authorize_status, 200, "{authorize_body}");
    let authorization: serde_json::Value = serde_json::from_str(&authorize_body)?;
    assert_eq!(stack.managed_restore_fence(&lineage_b64u)?.0, "terminal");

    // Both roles are available, so a manual refresh completes and overtakes it.
    let (revision, _, _) = stack.active_state(&lineage_b64u)?;
    let (first_status, first_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-overtakes-restore", revision)?;
    assert_eq!(first_status, 200, "{first_body}");
    assert_eq!(stack.managed_restore_fence(&lineage_b64u)?.0, "superseded");

    // Every late step of the overtaken restore is refused.
    let restore_request = json!({
        "public_state_b64u": authorization["public_state_b64u"],
        "restore_capability_b64u": authorization["capability_b64u"],
    });
    // The Router and the control plane answer InvalidLifecycleState with 400.
    // The challenge is refused by the Router's creation state, so the control
    // plane relays it as 500 with its message.
    let (late_restore_status, late_restore_body) = stack.restore(&restore_request)?;
    assert_eq!(late_restore_status, 400, "{late_restore_body}");
    assert!(late_restore_body.contains(superseded), "{late_restore_body}");
    let (late_challenge_status, late_challenge_body) =
        stack.control_plane(challenge_path, &first_challenge)?;
    assert_eq!(late_challenge_status, 500, "{late_challenge_body}");
    assert!(late_challenge_body.contains(superseded), "{late_challenge_body}");
    let (late_authorize_status, late_authorize_body) =
        stack.control_plane(authorize_path, &authorize_request)?;
    assert_eq!(late_authorize_status, 400, "{late_authorize_body}");
    assert!(late_authorize_body.contains(superseded), "{late_authorize_body}");
    assert_eq!(stack.managed_restore_fence(&lineage_b64u)?.0, "superseded");

    // The next refresh, which found the stale authorization before, first
    // erases the epoch the overtaking refresh retired, then completes.
    thread::sleep(Duration::from_millis(61_000));
    let (revision, _, _) = stack.active_state(&lineage_b64u)?;
    let (second_status, second_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-after-superseded", revision)?;
    assert_eq!(second_status, 200, "{second_body}");
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let expected_epochs = vec![epoch(2, "retired"), epoch(3, "active")];
    assert_eq!(stack.epochs(&lineage_b64u)?, (expected_epochs.clone(), expected_epochs));

    // A wallet signs on epoch 3, and a new restore can be reserved.
    let signing_worker =
        stack.register_and_sign(signing_worker, &identity, &lineage_b64u, "account-after-superseded")?;
    drop(signing_worker);
    let (new_status, new_body) =
        stack.control_plane(challenge_path, &challenge_request("vm-restore-after-superseded")?)?;
    assert_eq!(new_status, 200, "{new_body}");
    assert_eq!(stack.managed_restore_fence(&lineage_b64u)?.0, "reserved");

    println!(
        "R150_VM_TENANT_ROOT_RESTORE_SUPERSEDED_E2E {}",
        json!({
            "authorized_restore_fence": "terminal",
            "overtaking_refresh_status": first_status,
            "fence_after_refresh": "superseded",
            "late_restore": [late_restore_status, superseded],
            "late_challenge": [late_challenge_status, superseded],
            "late_authorization": [late_authorize_status, superseded],
            "next_refresh_status": second_status,
            "epochs_after": [[1, "retired"], [2, "retired"], [3, "active"]],
            "signed_on_epoch_3": true,
            "new_challenge_status": new_status,
        })
    );
    Ok(())
}

/// Deriver A loses its active share, and the root is restored from A's managed
/// backup on the VM through the same control-plane, Router and Deriver code as
/// Cloudflare. The operator reserves a challenge; the operations authority and
/// A's custody authority both sign it; the control plane issues the restore
/// capability; the Router stages A's share from its backup and runs the
/// mandatory forward refresh. A wallet registered on the restored root signs;
/// another refresh follows and a second wallet signs; and an exact retry of
/// the original restore still returns its outcome.
#[test]
fn vm_tenant_root_restored_from_its_managed_backup_signs_refreshes_and_replays(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start_with_envs(
        "vm-tenant-root-managed-restore",
        &[("TENANT_ROOT_RETIREMENT_GRACE_MS", "1000")],
        &[],
        &[],
    )?;
    let mut signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("managed-restore")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let identity_digest_b64u =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity.digest()?.as_bytes());

    // Deriver A loses its active share; its managed backup remains.
    let removed = stack.a_store.execute(
        "DELETE FROM tenant_root_role_shares
         WHERE custody_lineage_b64u = ?1 AND role = 'deriver_a' AND lifecycle = 'active'",
        [&lineage_b64u],
    )?;
    assert_eq!(removed, 1, "A must hold exactly one active share to lose");

    // The operator reserves a challenge; an exact retry returns the same one.
    let now_ms = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?;
    let challenge_request = json!({
        "identity_digest_b64u": identity_digest_b64u,
        "custody_lineage_b64u": lineage_b64u,
        "incident_id": "vm-managed-restore-deriver-a",
        "outage_observation_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(b"vm-managed-restore-outage")),
        "issued_at_ms": now_ms,
        "expires_at_ms": now_ms + 60_000,
        "nonce_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(fresh_nonzero_bytes_32()?),
        "unavailable_role": "deriver_a",
    });
    let challenge_path =
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_CHALLENGE_PRIVATE_REQUEST_PATH;
    let (challenge_status, challenge_body) = stack.control_plane(challenge_path, &challenge_request)?;
    assert_eq!(challenge_status, 200, "{challenge_body}");
    assert_eq!(stack.control_plane(challenge_path, &challenge_request)?, (challenge_status, challenge_body.clone()));
    let challenge: serde_json::Value = serde_json::from_str(&challenge_body)?;
    assert_eq!(challenge["unavailable_role"], "deriver_a");

    // Both incident authorities sign it, and the control plane authorizes.
    let authorize_request = json!({
        "identity_digest_b64u": identity_digest_b64u,
        "custody_lineage_b64u": lineage_b64u,
        "incident_authorization_b64u": stack.sign_deriver_a_incident_authorization(
            challenge["authorization_binding_b64u"].as_str().ok_or("a challenge carries its binding")?,
        )?,
    });
    let authorize_path =
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_AUTHORIZE_PRIVATE_REQUEST_PATH;
    let (authorize_status, authorize_body) = stack.control_plane(authorize_path, &authorize_request)?;
    assert_eq!(authorize_status, 200, "{authorize_body}");
    assert_eq!(stack.control_plane(authorize_path, &authorize_request)?, (authorize_status, authorize_body.clone()));
    let authorization: serde_json::Value = serde_json::from_str(&authorize_body)?;

    // The Router restores A from its backup and runs the forward refresh.
    let restore_request = json!({
        "public_state_b64u": authorization["public_state_b64u"],
        "restore_capability_b64u": authorization["capability_b64u"],
    });
    let (restore_status, restore_body) = stack.restore(&restore_request)?;
    assert_eq!(restore_status, 200, "{restore_body}");
    let restored_at = Instant::now();
    let restored: serde_json::Value = serde_json::from_str(&restore_body)?;
    for role in ["deriver_a", "deriver_b"] {
        assert_eq!(restored["retirement"][role]["kind"], "pending", "{restored}");
    }
    let restore_revision = restored["lifecycle_revision"].as_i64().ok_or("a restore reports its revision")?;
    // The durable outcome replays exactly; its retirement is a live report.
    let durable = |body: &str| -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let body: serde_json::Value = serde_json::from_str(body)?;
        Ok(json!([body["activation_receipt_digest_b64u"], body["lifecycle_revision"]]))
    };
    let (replay_status, replay_body) = stack.restore(&restore_request)?;
    assert_eq!(replay_status, restore_status, "{replay_body}");
    assert_eq!(durable(&replay_body)?, durable(&restore_body)?);
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (vec![epoch(2, "active")], vec![epoch(1, "retired"), epoch(2, "active")])
    );

    // A wallet registered on the restored root signs.
    signing_worker =
        stack.register_and_sign(signing_worker, &identity, &lineage_b64u, "account-restored-root")?;
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![2], vec![2]));

    // Another refresh, once the grace after the restore's swap has passed:
    // it first erases the epoch that swap retired, then completes. A second
    // wallet signs on its epoch.
    thread::sleep(Duration::from_millis(1_100).saturating_sub(restored_at.elapsed()));
    let (refresh_status, refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-after-restore", restore_revision)?;
    assert_eq!(refresh_status, 200, "{refresh_body}");
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (
            vec![epoch(2, "retired"), epoch(3, "active")],
            vec![epoch(2, "retired"), epoch(3, "active")]
        )
    );
    signing_worker =
        stack.register_and_sign(signing_worker, &identity, &lineage_b64u, "account-refreshed-root")?;
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![2, 3], vec![2, 3]));

    // The original restore, retried, returns its outcome.
    let (late_status, late_body) = stack.restore(&restore_request)?;
    assert_eq!(late_status, restore_status, "{late_body}");
    assert_eq!(durable(&late_body)?, durable(&restore_body)?);
    let late: serde_json::Value = serde_json::from_str(&late_body)?;
    for role in ["deriver_a", "deriver_b"] {
        assert_eq!(late["retirement"][role]["kind"], "superseded", "{late}");
    }
    drop(signing_worker);

    println!(
        "R150_VM_TENANT_ROOT_MANAGED_RESTORE_E2E {}",
        json!({
            "fault": "deriver_a_active_share_lost",
            "challenge_and_authorization_retries_identical": true,
            "restore_status": restore_status,
            "restore_revision": restore_revision,
            "epochs_after_restore": { "deriver_a": [[2, "active"]], "deriver_b": [[1, "retired"], [2, "active"]] },
            "signed_after_restore": true,
            "refresh_after_restore_status": refresh_status,
            "epochs_after_refresh": { "deriver_a": [[2, "retired"], [3, "active"]], "deriver_b": [[1, "retired"], [2, "retired"], [3, "active"]] },
            "signed_after_refresh": true,
            "admissions": { "deriver_a": [2, 3], "deriver_b": [2, 3] },
            "restore_retry_after_refresh_returns_its_outcome": true,
        })
    );
    Ok(())
}

/// A restore reservation that is never authorized expires rather than holding
/// the tenant root. The operator reserves a challenge with a five-second
/// window and lets it lapse; while it stands, a manual refresh is refused as
/// in progress. After the window, a checkpoint of that challenge is refused as
/// expired and the fence records the expiry, the control plane refuses to
/// authorize it, and the refresh it held back runs. Deriver A then loses its
/// share for real, and a new challenge is reserved, authorized and restored.
#[test]
fn vm_tenant_root_restore_reservation_never_authorized_expires_and_frees_the_root(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-restore-reservation-expiry")?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("restore-reservation-expiry")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (revision, _, _) = stack.active_state(&lineage_b64u)?;
    let b64u = |bytes: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let identity_digest_b64u = b64u(identity.digest()?.as_bytes());
    let now_ms = || -> Result<u64, Box<dyn std::error::Error>> {
        Ok(u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?)
    };
    let challenge_request = |incident: &str, window_ms: u64| -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let issued_at_ms = now_ms()?;
        Ok(json!({
            "identity_digest_b64u": identity_digest_b64u,
            "custody_lineage_b64u": lineage_b64u,
            "incident_id": incident,
            "outage_observation_digest_b64u": b64u(Sha256::digest(incident.as_bytes()).as_slice()),
            "issued_at_ms": issued_at_ms,
            "expires_at_ms": issued_at_ms + window_ms,
            "nonce_b64u": b64u(&fresh_nonzero_bytes_32()?),
            "unavailable_role": "deriver_a",
        }))
    };
    let challenge_path =
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_CHALLENGE_PRIVATE_REQUEST_PATH;
    let authorize_path =
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_AUTHORIZE_PRIVATE_REQUEST_PATH;

    // The operator reserves a challenge and never authorizes it.
    let lapsed_request = challenge_request("vm-restore-reservation-lapsed", 5_000)?;
    let (challenge_status, challenge_body) = stack.control_plane(challenge_path, &lapsed_request)?;
    assert_eq!(challenge_status, 200, "{challenge_body}");
    let lapsed: serde_json::Value = serde_json::from_str(&challenge_body)?;
    let (fence_while_reserved, attempt) = stack.managed_restore_fence(&lineage_b64u)?;
    assert_eq!(fence_while_reserved, "reserved");
    let held_operation = "vm-refresh-held-by-a-restore-reservation";
    let (held_status, held_body) = stack.refresh(&identity, &lineage_b64u, held_operation, revision)?;
    assert_eq!(held_status, 409, "{held_body}");
    assert!(held_body.contains("tenant_root_refresh_in_progress"), "{held_body}");

    let expires_at_ms = lapsed_request["expires_at_ms"].as_u64().ok_or("a challenge has an expiry")?;
    while now_ms()? <= expires_at_ms + 250 {
        std::thread::sleep(Duration::from_millis(100));
    }

    // Its authorization arrives late: the checkpoint is refused, durably.
    // The challenge response carries the challenge's own fields beside the
    // binding the incident authorities sign.
    let mut lapsed_challenge = lapsed.clone();
    lapsed_challenge
        .as_object_mut()
        .ok_or("a challenge response is an object")?
        .remove("authorization_binding_b64u");
    let late_checkpoint = json!({
        "kind": "checkpoint_managed_restore",
        "identity_digest_b64u": identity_digest_b64u,
        "custody_lineage_b64u": lineage_b64u,
        "checkpoint": {
            "challenge": lapsed_challenge,
            "attempt": serde_json::from_str::<serde_json::Value>(
                attempt.as_deref().ok_or("a reserved fence carries its attempt")?,
            )?,
            "public_state_b64u": b64u(b"late-public-state"),
            "capability_b64u": b64u(b"late-capability"),
            "incident_authorization_b64u": b64u(b"late-incident-authorization"),
        },
    });
    let (late_checkpoint_status, late_checkpoint_body) = stack.creation_state(
        &identity,
        lineage,
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
        &late_checkpoint,
    )?;
    assert_eq!(late_checkpoint_status, 408, "{late_checkpoint_body}");
    assert!(late_checkpoint_body.contains("expired before it was authorized"), "{late_checkpoint_body}");
    let (fence_after_window, _) = stack.managed_restore_fence(&lineage_b64u)?;
    assert_eq!(fence_after_window, "expired");
    assert_eq!(
        stack.creation_state(
            &identity,
            lineage,
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
            &late_checkpoint,
        )?
        .0,
        408
    );
    let late_authorize = json!({
        "identity_digest_b64u": identity_digest_b64u,
        "custody_lineage_b64u": lineage_b64u,
        "incident_authorization_b64u": stack.sign_deriver_a_incident_authorization(
            lapsed["authorization_binding_b64u"].as_str().ok_or("a challenge carries its binding")?,
        )?,
    });
    let (late_authorize_status, late_authorize_body) = stack.control_plane(authorize_path, &late_authorize)?;
    assert_eq!(late_authorize_status, 408, "{late_authorize_body}");
    assert!(late_authorize_body.contains("expired before it was authorized"), "{late_authorize_body}");
    // Reserving the lapsed challenge again is refused by the Router; the
    // control plane relays that as its own service failure with the reason.
    let (lapsed_retry_status, lapsed_retry_body) = stack.control_plane(challenge_path, &lapsed_request)?;
    assert_eq!(lapsed_retry_status, 500, "{lapsed_retry_body}");
    assert!(lapsed_retry_body.contains("status 408: ExpiredLocalRequest"), "{lapsed_retry_body}");
    assert!(lapsed_retry_body.contains("expired before it was authorized"), "{lapsed_retry_body}");

    // The refresh it held back runs; the expiry stays on record.
    let (refresh_status, refresh_body) = stack.refresh(&identity, &lineage_b64u, held_operation, revision)?;
    assert_eq!(refresh_status, 200, "{refresh_body}");
    let refreshed: serde_json::Value = serde_json::from_str(&refresh_body)?;
    let refreshed_revision =
        refreshed["lifecycle_revision"].as_i64().ok_or("a refresh reports its revision")?;
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (vec![epoch(1, "retired"), epoch(2, "active")], vec![epoch(1, "retired"), epoch(2, "active")])
    );
    assert_eq!(stack.managed_restore_fence(&lineage_b64u)?.0, "expired");

    // Deriver A then loses its share; a new challenge restores it.
    let removed = stack.a_store.execute(
        "DELETE FROM tenant_root_role_shares
         WHERE custody_lineage_b64u = ?1 AND role = 'deriver_a' AND lifecycle = 'active'",
        [&lineage_b64u],
    )?;
    assert_eq!(removed, 1, "A must hold exactly one active share to lose");
    let outage_request = challenge_request("vm-restore-after-a-lapsed-reservation", 60_000)?;
    let (outage_status, outage_body) = stack.control_plane(challenge_path, &outage_request)?;
    assert_eq!(outage_status, 200, "{outage_body}");
    let outage: serde_json::Value = serde_json::from_str(&outage_body)?;
    assert_eq!(stack.managed_restore_fence(&lineage_b64u)?.0, "reserved");
    let authorize_request = json!({
        "identity_digest_b64u": identity_digest_b64u,
        "custody_lineage_b64u": lineage_b64u,
        "incident_authorization_b64u": stack.sign_deriver_a_incident_authorization(
            outage["authorization_binding_b64u"].as_str().ok_or("a challenge carries its binding")?,
        )?,
    });
    let (authorize_status, authorize_body) = stack.control_plane(authorize_path, &authorize_request)?;
    assert_eq!(authorize_status, 200, "{authorize_body}");
    let authorization: serde_json::Value = serde_json::from_str(&authorize_body)?;
    let restore_request = json!({
        "public_state_b64u": authorization["public_state_b64u"],
        "restore_capability_b64u": authorization["capability_b64u"],
    });
    let (restore_status, restore_body) = stack.restore(&restore_request)?;
    assert_eq!(restore_status, 200, "{restore_body}");
    let restored: serde_json::Value = serde_json::from_str(&restore_body)?;
    let restore_revision =
        restored["lifecycle_revision"].as_i64().ok_or("a restore reports its revision")?;
    let epochs_after_restore = stack.epochs(&lineage_b64u)?;
    assert_eq!(epochs_after_restore.0.last(), Some(&epoch(3, "active")));
    assert_eq!(epochs_after_restore.1.last(), Some(&epoch(3, "active")));
    assert_eq!(stack.managed_restore_fence(&lineage_b64u)?.0, "open");
    assert_eq!(stack.restore(&restore_request)?, (restore_status, restore_body.clone()));

    println!(
        "R150_VM_TENANT_ROOT_RESTORE_RESERVATION_EXPIRY_E2E {}",
        json!({
            "fault": "restore_challenge_reserved_and_never_authorized",
            "window_ms": 5_000,
            "refresh_while_reserved": [held_status, "tenant_root_refresh_in_progress"],
            "late_checkpoint_status": late_checkpoint_status,
            "late_checkpoint_retry_status": 408,
            "fence_after_window": fence_after_window,
            "late_authorize_status": late_authorize_status,
            "lapsed_challenge_retry": [lapsed_retry_status, "relayed router 408 expired before it was authorized"],
            "held_refresh_after_expiry": [refresh_status, refreshed_revision],
            "fence_after_refresh": "expired",
            "new_challenge_after_expiry": outage_status,
            "authorized_restore_status": [authorize_status, restore_status, restore_revision],
            "epochs_after_restore": {
                "deriver_a": epochs_after_restore.0,
                "deriver_b": epochs_after_restore.1,
            },
            "fence_after_restore": "open",
            "restore_retry_identical": true,
        })
    );
    Ok(())
}

/// A tenant's recovery kit restores its root into an empty VM deployment.
///
/// The kit is the committed fixture set: its manifest, both role packages and
/// the recovery trust bundle it chains to. Generating a kit on the VM waits on
/// the retention decision (docs/refactor-150-vm-recovery-retention.md). The
/// test stands in for the Console, signing each grant with the operator's
/// grant key, and for the tenant, opening each role package with its recovery
/// key and resealing the share to the destination Deriver's import key.
///
/// The destination is provisioned with a bootstrap authority for the root's
/// identity and a fresh custody lineage. After the restore refresh the root is
/// dormant: both Derivers hold pending epoch-1 shares and the Router has no
/// active state. The operator's activation makes it active, consumes the
/// bootstrap credential, and replays exactly. A wallet then registers on the
/// restored root and signs a NEAR transaction.
#[test]
fn vm_tenant_root_recovery_kit_restores_into_an_empty_deployment_and_signs(
) -> Result<(), Box<dyn std::error::Error>> {
    use router_ab_core::{
        decode_tenant_root_recovery_manifest_v1, decode_tenant_root_recovery_package_v1,
        verify_and_open_tenant_root_recovery_role_package_v1,
        verify_tenant_root_recovery_role_package_with_trust_v1, DestinationBootstrapAuthorityV1,
        ExpectedTenantRootRestoreImportV1, TenantRootLifecycleReceiptDigestV1,
        TenantRootProtocolDigestV1, TenantRootRecoveryRecipientKeypairV1,
        TenantRootRecoveryTrustBundleV1, TenantRootRecoveryTrustEvidenceV1,
        TenantRootRestoreAuthorizationNonceV1, TenantRootRestoreDestinationFingerprintV1,
        TenantRootRestoreImportEnvelopeV1, TenantRootRestoreImportPublicKeyV1,
        TenantRootRestoreRefreshGrantV1, TenantRootRestoreRoleImportGrantV1,
        TenantRootRestoreSessionIdV1, TwoPartyDeriverRole,
    };
    let _process_guard = local_worker_process_test_guard();
    let b64u = |bytes: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let unb64u = |text: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(text);
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../router-ab-core/tests/fixtures/tenant-root-recovery");
    let manifest_bytes = fs::read(fixtures.join("manifest.json"))?;
    let manifest = decode_tenant_root_recovery_manifest_v1(&manifest_bytes)?;
    let manifest_b64u = b64u(&manifest_bytes);
    let trust_bundle_json = fs::read_to_string(fixtures.join("trust-bundle.json"))?;
    let trust_bundle =
        TenantRootRecoveryTrustBundleV1::from_canonical_json(trust_bundle_json.trim().as_bytes())?;
    let identity =
        TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3")?;
    assert_eq!(manifest.descriptor().tenant_root_identity_digest(), identity.digest()?);

    // The operator provisions an empty destination for this root.
    let mut rng = rand_core_09::UnwrapErr(rand_core_09::OsRng);
    let lineage = TenantRootCustodyLineageId::from_bytes(fresh_nonzero_bytes_16()?)?;
    let lineage_b64u = b64u(lineage.as_bytes());
    let fingerprint = TenantRootRestoreDestinationFingerprintV1::from_bytes(fresh_nonzero_bytes_32()?)?;
    let (bootstrap_authority, bootstrap_token) =
        DestinationBootstrapAuthorityV1::initialize(fingerprint, &mut rng)?;
    let bootstrap_token_b64u = b64u(bootstrap_token.expose_once());
    let identity_b64u = b64u(&identity.canonical_bytes()?);
    let bootstrap_record = json!({
        "identity_b64u": identity_b64u,
        "deployment_fingerprint_b64u": b64u(fingerprint.as_bytes()),
        "custody_lineage_b64u": lineage_b64u,
        "token_digest_b64u": b64u(bootstrap_authority.token_digest()),
    })
    .to_string();
    let stack = RecoveryStackV1::start_with_envs(
        "vm-tenant-root-recovery-kit-restore",
        &[("TENANT_ROOT_DESTINATION_BOOTSTRAP_JSON", bootstrap_record.as_str())],
        &[("TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON", trust_bundle_json.trim())],
        &[],
    )?;
    let router = |path: &str, body: &serde_json::Value, headers: &[(&str, &str)]| {
        let mut all = vec![(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)];
        all.extend_from_slice(headers);
        post_json_to_path_with_headers(&stack.router_url, path, body, &all)
    };
    let bootstrap_path =
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_PRIVATE_REQUEST_PATH;
    let token_header =
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_TOKEN_HEADER_V1;
    let authenticate = json!({
        "kind": "authenticate",
        "identity_b64u": identity_b64u,
        "deployment_fingerprint_b64u": b64u(fingerprint.as_bytes()),
        "custody_lineage_b64u": lineage_b64u,
    });

    // The Console reads the destination, then authenticates with its credential.
    let (read_status, read_body) = router(
        bootstrap_path,
        &json!({ "kind": "read", "identity_b64u": identity_b64u, "custody_lineage_b64u": lineage_b64u }),
        &[],
    )?;
    assert_eq!(read_status, 200, "{read_body}");
    assert!(read_body.contains("\"read_ready\""), "{read_body}");
    let (wrong_status, wrong_body) =
        router(bootstrap_path, &authenticate, &[(token_header, &b64u(&fresh_nonzero_bytes_32()?))])?;
    assert_eq!(wrong_status, 200, "{wrong_body}");
    assert!(wrong_body.contains("authentication_failed"), "{wrong_body}");
    let (auth_status, auth_body) =
        router(bootstrap_path, &authenticate, &[(token_header, &bootstrap_token_b64u)])?;
    assert_eq!(auth_status, 200, "{auth_body}");
    assert!(auth_body.contains("\"authenticated\""), "{auth_body}");

    // The manifest registers against the destination's recovery trust.
    let (manifest_status, manifest_body) = router(
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_PRIVATE_REQUEST_PATH,
        &json!({ "manifest_b64u": manifest_b64u }),
        &[],
    )?;
    assert_eq!(manifest_status, 200, "{manifest_body}");

    // Each role imports its share: the Console grants an import key, the
    // tenant reseals the opened share to it, and the Deriver accepts it.
    let operator = stack.temp.join(router_ab_dev::LOCAL_TENANT_ROOT_OPERATOR_ENV_FILE_V1);
    let grant_key_id = env_value(&operator, router_ab_dev::LOCAL_TENANT_ROOT_GRANT_KEY_ID_ENV_V1)?;
    let grant_seed: [u8; 32] = unb64u(&env_value(
        &operator,
        router_ab_dev::LOCAL_TENANT_ROOT_GRANT_SIGNING_KEY_ENV_V1,
    )?)?
    .try_into()
    .map_err(|_| "operator grant key must be 32 bytes")?;
    let restore_session_id = TenantRootRestoreSessionIdV1::from_bytes(fresh_nonzero_bytes_16()?)?;
    let manifest_digest = manifest.digest()?;
    let now_ms = || -> Result<u64, Box<dyn std::error::Error>> {
        Ok(u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?)
    };
    let mut acceptance = Vec::new();
    for (role, key_material, package_file) in [
        (TwoPartyDeriverRole::DeriverA, [0xa1_u8; 32], "deriver-a.backup"),
        (TwoPartyDeriverRole::DeriverB, [0xb1_u8; 32], "deriver-b.backup"),
    ] {
        let issued_at_ms = now_ms()? - 1_000;
        let grant = TenantRootRestoreRoleImportGrantV1::sign(
            TenantRootProtocolDigestV1::from_bytes(fresh_nonzero_bytes_32()?)?,
            identity.digest()?,
            fingerprint,
            lineage,
            restore_session_id,
            manifest_digest,
            role,
            format!("vm-restore-import-{}", role.as_str()),
            1,
            TenantRootRestoreAuthorizationNonceV1::from_bytes(fresh_nonzero_bytes_32()?)?,
            issued_at_ms,
            issued_at_ms + TENANT_ROOT_MAX_LIFETIME_MS_V1,
            grant_key_id.clone(),
            &grant_seed,
        )?;
        let import_request = json!({
            "restore_grant_b64u": b64u(&grant.canonical_bytes()?),
            "manifest_b64u": manifest_b64u,
        });
        let (key_status, key_body) = router(
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH,
            &import_request,
            &[],
        )?;
        assert_eq!(key_status, 200, "{key_body}");
        let import_key: serde_json::Value = serde_json::from_str(&key_body)?;
        assert_eq!(
            router(
                router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH,
                &import_request,
                &[],
            )?,
            (key_status, key_body.clone()),
            "an import-key retry returns the same key"
        );

        let package = decode_tenant_root_recovery_package_v1(&fs::read(fixtures.join(package_file))?)?;
        let trust = verify_tenant_root_recovery_role_package_with_trust_v1(
            &manifest,
            &package,
            &trust_bundle,
            &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
        )?;
        let source = verify_and_open_tenant_root_recovery_role_package_v1(
            &manifest,
            &package,
            &TenantRootRecoveryRecipientKeypairV1::derive_from_ikm(key_material)?,
            trust.trusted_verifying_keys(),
        )?;
        let expected = ExpectedTenantRootRestoreImportV1::from_verified_source(
            &source,
            fingerprint,
            lineage,
            restore_session_id,
            import_key["import_key_id"].as_str().ok_or("an import key has an id")?,
            TenantRootRestoreImportPublicKeyV1::from_bytes(
                unb64u(import_key["import_public_key_b64u"].as_str().ok_or("an import key has a public key")?)?
                    .try_into()
                    .map_err(|_| "an import public key is 32 bytes")?,
            )?,
            import_key["issued_at_ms"].as_u64().ok_or("an import key has an issue time")?,
            import_key["expires_at_ms"].as_u64().ok_or("an import key has an expiry")?,
        )?;
        let envelope = TenantRootRestoreImportEnvelopeV1::seal(&source, &expected, &mut rng)?;
        let (accept_status, accept_body) = router(
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ROLE_IMPORT_ACCEPT_PRIVATE_REQUEST_PATH,
            &json!({
                "restore_grant_b64u": b64u(&grant.canonical_bytes()?),
                "manifest_b64u": manifest_b64u,
                "import_envelope_b64u": b64u(&envelope.to_bytes()?),
            }),
            &[],
        )?;
        assert_eq!(accept_status, 200, "{accept_body}");
        let accepted: serde_json::Value = serde_json::from_str(&accept_body)?;
        acceptance.push(TenantRootLifecycleReceiptDigestV1::from_bytes(
            unb64u(accepted["receipt_digest_b64u"].as_str().ok_or("an acceptance has a receipt")?)?
                .try_into()
                .map_err(|_| "an acceptance receipt digest is 32 bytes")?,
        )?);
    }

    // The restore refresh leaves the root dormant.
    let issued_at_ms = now_ms()? - 1_000;
    let refresh_grant = TenantRootRestoreRefreshGrantV1::sign(
        TenantRootProtocolDigestV1::from_bytes(fresh_nonzero_bytes_32()?)?,
        identity.digest()?,
        fingerprint,
        lineage,
        restore_session_id,
        manifest_digest,
        acceptance[0],
        acceptance[1],
        TenantRootRestoreAuthorizationNonceV1::from_bytes(fresh_nonzero_bytes_32()?)?,
        issued_at_ms,
        issued_at_ms + TENANT_ROOT_MAX_LIFETIME_MS_V1,
        grant_key_id.clone(),
        &grant_seed,
    )?;
    let restore_request = json!({
        "restore_refresh_grant_b64u": b64u(&refresh_grant.canonical_bytes()?),
        "manifest_b64u": manifest_b64u,
    });
    let (refresh_status, refresh_body) = router(
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH,
        &restore_request,
        &[],
    )?;
    assert_eq!(refresh_status, 200, "{refresh_body}");
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let pending_epochs = stack.epochs(&lineage_b64u)?;
    assert_eq!(pending_epochs, (vec![epoch(1, "pending")], vec![epoch(1, "pending")]));
    assert!(stack.active_state(&lineage_b64u).is_err(), "a dormant root has no active state");

    // The operator activates it; the bootstrap credential is consumed.
    let activation_path =
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH;
    let (activation_status, activation_body) = router(activation_path, &restore_request, &[])?;
    assert_eq!(activation_status, 200, "{activation_body}");
    let activation: serde_json::Value = serde_json::from_str(&activation_body)?;
    assert_eq!(activation["activated_epoch"], 1);
    assert_eq!(activation["destination_lineage_id"], lineage_b64u.as_str());
    let (retry_status, retry_body) = router(activation_path, &restore_request, &[])?;
    assert_eq!(retry_status, 200, "{retry_body}");
    let retried: serde_json::Value = serde_json::from_str(&retry_body)?;
    assert_eq!(
        retried["activation_receipt_digest_b64u"],
        activation["activation_receipt_digest_b64u"]
    );
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (vec![epoch(1, "active")], vec![epoch(1, "active")])
    );
    let (destroyed_status, destroyed_body) =
        router(bootstrap_path, &authenticate, &[(token_header, &bootstrap_token_b64u)])?;
    assert_eq!(destroyed_status, 200, "{destroyed_body}");
    assert!(destroyed_body.contains("\"destroyed\""), "{destroyed_body}");

    // Activation closed both import sessions. Cleanup retried as though the
    // activation reply was lost asks both Derivers again, and each returns
    // the receipt it gave the first time.
    assert_eq!(activation["cleanup"]["roles"]["kind"], "complete");
    let (cleanup_status, cleanup_body) = router(
        router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_CLEANUP_PRIVATE_REQUEST_PATH,
        &json!({
            "kind": "post_activation",
            "activation_receipt_b64u": activation["activation_receipt_b64u"],
            "cleanup": {
                "bootstrap": activation["cleanup"]["bootstrap"],
                "roles": {
                    "kind": "both_roles_incomplete",
                    "outstanding": {
                        "roles": ["deriver_a", "deriver_b"],
                        "description": "the activation reply was lost",
                    },
                },
            },
        }),
        &[],
    )?;
    assert_eq!(cleanup_status, 200, "{cleanup_body}");
    let cleanup: serde_json::Value = serde_json::from_str(&cleanup_body)?;
    assert_eq!(cleanup["roles"], activation["cleanup"]["roles"]);
    assert_eq!(cleanup["bootstrap"], activation["cleanup"]["bootstrap"]);

    // A wallet registers on the restored root and signs.
    let signing_worker = stack.start_signing_worker()?;
    let signing_worker =
        stack.register_and_sign(signing_worker, &identity, &lineage_b64u, "account-restored-kit")?;
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![1], vec![1]));

    // The restored root refreshes, and a second wallet signs on its new epoch.
    let (revision, _, _) = stack.active_state(&lineage_b64u)?;
    let (root_refresh_status, root_refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-restored-kit", revision)?;
    assert_eq!(root_refresh_status, 200, "{root_refresh_body}");
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (
            vec![epoch(1, "retired"), epoch(2, "active")],
            vec![epoch(1, "retired"), epoch(2, "active")]
        )
    );
    let signing_worker = stack.register_and_sign(
        signing_worker,
        &identity,
        &lineage_b64u,
        "account-restored-kit-refreshed",
    )?;
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![1, 2], vec![1, 2]));
    drop(signing_worker);

    println!(
        "R150_VM_TENANT_ROOT_RECOVERY_KIT_RESTORE_E2E {}",
        json!({
            "kit": "committed fixture manifest, packages and trust bundle",
            "bootstrap": { "read": read_status, "wrong_credential": "authentication_failed", "authenticated": true },
            "manifest_registered": manifest_status,
            "roles_imported": ["deriver_a", "deriver_b"],
            "import_key_retry_identical": true,
            "dormant_after_refresh": { "deriver_a": [[1, "pending"]], "deriver_b": [[1, "pending"]], "router_active_state": false },
            "activation": { "status": activation_status, "epoch": 1, "retry_identical": true },
            "bootstrap_after_activation": "destroyed",
            "cleanup_retry_after_lost_reply": [cleanup_status, "same receipts from both Derivers"],
            "epochs_after_activation": { "deriver_a": [[1, "active"]], "deriver_b": [[1, "active"]] },
            "signed_on_restored_root": true,
            "refresh_after_restore": [root_refresh_status, { "deriver_a": [[1, "retired"], [2, "active"]], "deriver_b": [[1, "retired"], [2, "active"]] }],
            "signed_after_refresh": true,
            "admissions": { "deriver_a": [1, 2], "deriver_b": [1, 2] },
        })
    );
    Ok(())
}

/// A root-use admission belongs to one execution attempt
/// (docs/refactor-150-admission-identity.md). For Ed25519 Yao that is the
/// pair session.
///
/// Deriver B prepares one registration's pair on epoch 1. The same pair
/// arrives again under a fresh window, as the Router stamps each retry. B
/// answers from its prepared record, and its admission stays one row. After a
/// refresh, the same pair bound to epoch 2 is refused as a different binding
/// for an admitted attempt, and still leaves one row. A fresh registration on
/// epoch 2 is its own attempt and gets its own row.
#[test]
fn vm_tenant_root_admission_follows_the_execution_attempt(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-admission-attempt")?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("admission-attempt")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let epoch_one_receipt = stack
        .committed_receipt(&lineage_b64u)?
        .ok_or("the Router must have committed epoch 1")?;
    let now_ms = || -> Result<u64, Box<dyn std::error::Error>> {
        Ok(u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?)
    };
    let prepare_b = |request: &router_ab_cloudflare::CloudflareEd25519YaoPairPrepareRequestV1| {
        post_json_to_path_with_headers(
            &stack.deriver_b_url,
            router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
            request,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    };
    let admitted_rows_b = || -> rusqlite::Result<Vec<(String, String, i64)>> {
        stack
            .b_store
            .prepare(
                "SELECT attempt_kind, attempt_key_hex, tenant_root_share_epoch
                 FROM tenant_root_root_use_admissions WHERE custody_lineage_b64u = ?1
                 ORDER BY tenant_root_share_epoch, attempt_key_hex",
            )?
            .query_map([&lineage_b64u], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect()
    };

    // B prepares the pair on epoch 1.
    let registration = stack.registration(&identity, &lineage_b64u)?;
    let first = direct_deriver_b_preparation_for_v1(
        &stack,
        &identity,
        &registration,
        &epoch_one_receipt,
        now_ms()?,
    )?;
    let session_hex = hex::encode(first.pair_binding.session());
    let (first_status, first_body) = prepare_b(&first)?;
    assert_eq!(first_status, 200, "{first_body}");
    assert_eq!(
        admitted_rows_b()?,
        vec![("ed25519_yao_pair_session".to_owned(), session_hex.clone(), 1)]
    );

    // A retry of the same attempt under a fresh window finds its admission.
    thread::sleep(Duration::from_millis(1_100));
    let retried = direct_deriver_b_preparation_for_v1(
        &stack,
        &identity,
        &registration,
        &epoch_one_receipt,
        now_ms()?,
    )?;
    assert_eq!(retried.pair_binding, first.pair_binding);
    assert_ne!(
        retried.tenant_root.custody_binding, first.tenant_root.custody_binding,
        "the retry carries a restamped binding"
    );
    let (retry_status, retry_body) = prepare_b(&retried)?;
    assert_eq!(retry_status, 200, "{retry_body}");
    assert_eq!(retry_body, first_body, "B answers the retry from its prepared record");
    assert_eq!(admitted_rows_b()?.len(), 1, "one attempt, one admission");

    // After a refresh, the same pair bound to epoch 2 is a different binding.
    let (refresh_status, refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-admission-attempt", created_revision)?;
    assert_eq!(refresh_status, 200, "{refresh_body}");
    let epoch_two_receipt = stack
        .committed_receipt(&lineage_b64u)?
        .ok_or("the Router must have committed epoch 2")?;
    let moved = direct_deriver_b_preparation_for_v1(
        &stack,
        &identity,
        &registration,
        &epoch_two_receipt,
        now_ms()?,
    )?;
    let (moved_status, moved_body) = prepare_b(&moved)?;
    // The VM Yao worker answers any refusal with 400; the code names it.
    assert_eq!(moved_status, 400, "{moved_body}");
    assert!(
        moved_body.contains("ConflictingPair: this tenant-root operation was admitted here under a different binding"),
        "{moved_body}"
    );
    assert_eq!(
        admitted_rows_b()?,
        vec![("ed25519_yao_pair_session".to_owned(), session_hex.clone(), 1)]
    );

    // A fresh registration on epoch 2 is its own attempt.
    let fresh = direct_deriver_b_preparation_v1(&stack, &identity, &lineage_b64u, &epoch_two_receipt)?;
    let (fresh_status, fresh_body) = prepare_b(&fresh)?;
    assert_eq!(fresh_status, 200, "{fresh_body}");
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![], vec![1, 2]));

    println!(
        "R150_VM_TENANT_ROOT_ADMISSION_ATTEMPT_E2E {}",
        json!({
            "attempt_key": "ed25519_yao_pair_session",
            "prepared_on_epoch_1": first_status,
            "retry_with_restamped_window": [retry_status, "same answer", "one admission row"],
            "refresh_status": refresh_status,
            "same_pair_bound_to_epoch_2": [moved_status, "ConflictingPair: admitted here under a different binding", "one admission row"],
            "fresh_registration_on_epoch_2": fresh_status,
            "admissions_at_deriver_b": [1, 2],
        })
    );
    Ok(())
}

/// A refreshed-out epoch is erased at a Deriver only once every root-use
/// admission on it there is settled or cancelled
/// (docs/refactor-150-admission-identity.md).
///
/// - A wallet registers and signs on epoch 1, so each Deriver's pair for it
///   completes and settles its admission.
/// - A second registration is admitted at Deriver B while Deriver A's
///   preparation is held. A refresh then moves the root to epoch 2, and A
///   refuses the held preparation. B's admission for that pair stays
///   unsettled.
/// - A's retired epoch 1 is erased at once. B's is refused as pending.
/// - After `W` (four seconds here), recovery at B cancels the stale admission,
///   and the erasure proceeds. The same command again replays its receipt.
/// - The cancelled attempt's own preparation, replayed at B, is refused by
///   the cancellation. A third wallet signs on epoch 2.
#[test]
fn vm_tenant_root_retired_epoch_is_erased_only_after_its_admissions_settle(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start_with_envs(
        "vm-tenant-root-settlement",
        &[],
        &[],
        &[(router_ab_dev::LOCAL_TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_ENV_V1, "4000")],
    )?;
    let signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("settlement")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let b64u = |bytes: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let identity_digest_b64u = b64u(identity.digest()?.as_bytes());
    let admission_statuses = |db: &Connection| -> rusqlite::Result<Vec<(i64, String)>> {
        db.prepare(
            "SELECT tenant_root_share_epoch, status FROM tenant_root_root_use_admissions
             WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch, admitted_at_ms",
        )?
        .query_map([&lineage_b64u], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
    };
    let row_revision = |db: &Connection, epoch: i64| -> rusqlite::Result<i64> {
        db.query_row(
            "SELECT revision FROM tenant_root_role_shares
             WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = ?2",
            rusqlite::params![lineage_b64u, epoch],
            |row| row.get(0),
        )
    };
    let execute_cleanup = |role: &str, command: &serde_json::Value| {
        post_json_to_path_with_headers(
            if role == "deriver_a" { &stack.deriver_a_url } else { &stack.deriver_b_url },
            router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH,
            &json!({ "cleanup_command_b64u": command }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    };
    // The operator's retirement of epoch 1 at one role: the control plane
    // signs the command, and the Deriver executes it.
    let retire = |role: &str| -> Result<(u16, String, serde_json::Value), Box<dyn std::error::Error>> {
        let db = if role == "deriver_a" { &stack.a_store } else { &stack.b_store };
        let (command_status, command_body) = stack.control_plane(
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
            &json!({
                "kind": "retired_after_refresh",
                "identity_digest_b64u": identity_digest_b64u,
                "custody_lineage_b64u": lineage_b64u,
                "role": role,
                "expected_retired_revision": row_revision(db, 1)?,
                "expected_active_revision": row_revision(db, 2)?,
            }),
        )?;
        assert_eq!(command_status, 200, "{command_body}");
        let command =
            serde_json::from_str::<serde_json::Value>(&command_body)?["cleanup_command_b64u"].clone();
        let (status, body) = execute_cleanup(role, &command)?;
        Ok((status, body, command))
    };
    let settled = |epoch: i64| (epoch, "settled".to_owned());

    // A completed registration settles both Derivers' admissions.
    let signing_worker =
        stack.register_and_sign(signing_worker, &identity, &lineage_b64u, "account-settled")?;
    assert_eq!(admission_statuses(&stack.a_store)?, vec![settled(1)]);
    assert_eq!(admission_statuses(&stack.b_store)?, vec![settled(1)]);

    // B admits a second registration; A's preparation is held over a refresh.
    // B's preparation is held just long enough to keep a copy of it.
    let registration = stack.registration(&identity, &lineage_b64u)?;
    stack
        .proxy_a
        .hold_next_request_on(router_ab_dev::LOCAL_DERIVER_A_ED25519_YAO_PREPARE_PAIR_PATH);
    stack
        .proxy_b
        .hold_next_request_on(router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH);
    let registering = {
        let router_url = stack.router_url.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
            )
            .map_err(|error| error.to_string())
        })
    };
    let deadline = Instant::now() + Duration::from_secs(15);
    let b_preparation: serde_json::Value = loop {
        if let Some(body) = stack.proxy_b.held_request() {
            break serde_json::from_slice(&body)?;
        }
        if Instant::now() > deadline {
            return Err("the second registration never reached Deriver B".into());
        }
        thread::sleep(Duration::from_millis(10));
    };
    stack.proxy_b.release_request();
    while stack.proxy_a.held_request().is_none() || admission_statuses(&stack.b_store)?.len() < 2 {
        if Instant::now() > deadline {
            return Err("the second registration never reached both Derivers".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
    let a_preparation: serde_json::Value = serde_json::from_slice(
        &stack.proxy_a.held_request().ok_or("A's preparation must be held")?,
    )?;
    let (refresh_status, refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-settlement", created_revision)?;
    assert_eq!(refresh_status, 200, "{refresh_body}");
    stack.proxy_a.release_request();
    let (registration_status, registration_body) = registering
        .join()
        .map_err(|_| "the registration thread panicked")??;
    assert_eq!(registration_status, 200, "{registration_body}");
    let refused: serde_json::Value = serde_json::from_str(&registration_body)?;
    assert_eq!(refused["status"], "recoverable_failure", "{registration_body}");
    let unsettled_at_b = admission_statuses(&stack.b_store)?;
    assert_eq!(unsettled_at_b, vec![settled(1), (1, "admitted".to_owned())]);

    // A's epoch 1 has only settled work: it is erased at once.
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let (a_status, a_body, _) = retire("deriver_a")?;
    assert_eq!(a_status, 200, "{a_body}");
    let a_retired: serde_json::Value = serde_json::from_str(&a_body)?;
    assert_eq!(a_retired["kind"], "retired_deleted");
    assert_eq!(a_retired["cancelled_admissions"], 0);
    assert_eq!(stack.epochs(&lineage_b64u)?.0, vec![epoch(2, "active")]);

    // The erasure changes no refusal. A's held preparation, replayed, is
    // still told its epoch closed here before it was admitted.
    let (a_late_status, a_late_body) = post_json_to_path_with_headers(
        &stack.deriver_a_url,
        router_ab_dev::LOCAL_DERIVER_A_ED25519_YAO_PREPARE_PAIR_PATH,
        &a_preparation,
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
    )?;
    // The VM Yao worker answers any refusal with 400; the code names it.
    assert_eq!(a_late_status, 400, "{a_late_body}");
    assert!(
        a_late_body.contains("LifecycleTransitionInProgress: the tenant-root epoch this operation is bound to was retired here before the operation was admitted"),
        "{a_late_body}"
    );
    assert_eq!(admission_statuses(&stack.a_store)?, vec![settled(1)]);

    // B's epoch 1 still has admitted work: retirement is pending.
    let (b_pending_status, b_pending_body, _) = retire("deriver_b")?;
    assert_eq!(b_pending_status, 503, "{b_pending_body}");
    assert!(
        b_pending_body.contains("retirement of epoch 1 is pending here: 1 admitted operation(s) are not settled"),
        "{b_pending_body}"
    );
    assert_eq!(
        stack.epochs(&lineage_b64u)?.1,
        vec![epoch(1, "retired"), epoch(2, "active")]
    );

    // After W, recovery cancels the stale admission and the epoch goes.
    thread::sleep(Duration::from_millis(4_200));
    let (b_status, b_body, b_command) = retire("deriver_b")?;
    assert_eq!(b_status, 200, "{b_body}");
    let b_retired: serde_json::Value = serde_json::from_str(&b_body)?;
    assert_eq!(b_retired["kind"], "retired_deleted");
    assert_eq!(b_retired["cancelled_admissions"], 1);
    assert_eq!(stack.epochs(&lineage_b64u)?.1, vec![epoch(2, "active")]);
    assert_eq!(
        admission_statuses(&stack.b_store)?,
        vec![settled(1), (1, "cancelled".to_owned())]
    );

    // The erasure is recorded once: the same command replays its signed
    // receipt and the cancellation count. The backup deletion is observed
    // again, and its objects are now already absent.
    let (replay_status, replay_body) = execute_cleanup("deriver_b", &b_command)?;
    assert_eq!(replay_status, 200, "{replay_body}");
    let replayed: serde_json::Value = serde_json::from_str(&replay_body)?;
    assert_eq!(replayed["kind"], "retired_deleted");
    assert_eq!(replayed["cleanup_receipt_b64u"], b_retired["cleanup_receipt_b64u"]);
    assert_eq!(replayed["cancelled_admissions"], 1);
    assert_eq!(replayed["r2_deletion"]["managed_backup"], "already_absent");
    assert_eq!(replayed["r2_deletion"]["provider_canary"], "already_absent");

    // The cancelled attempt takes no further step. Its own preparation,
    // replayed at B, is refused by the cancellation, not by the erased share.
    let (late_status, late_body) = post_json_to_path_with_headers(
        &stack.deriver_b_url,
        router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
        &b_preparation,
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
    )?;
    assert_eq!(late_status, 400, "{late_body}");
    assert!(
        late_body.contains("LifecycleTransitionInProgress: this tenant-root operation's admission was cancelled here"),
        "{late_body}"
    );
    assert_eq!(
        admission_statuses(&stack.b_store)?,
        vec![settled(1), (1, "cancelled".to_owned())]
    );

    // Work on epoch 2 is unaffected.
    let signing_worker =
        stack.register_and_sign(signing_worker, &identity, &lineage_b64u, "account-after-retirement")?;
    drop(signing_worker);
    assert_eq!(admission_statuses(&stack.a_store)?, vec![settled(1), settled(2)]);

    println!(
        "R150_VM_TENANT_ROOT_SETTLEMENT_E2E {}",
        json!({
            "settled_by_completed_registration": { "deriver_a": [[1, "settled"]], "deriver_b": [[1, "settled"]] },
            "refresh_status": refresh_status,
            "held_registration": refused["status"],
            "deriver_b_unsettled_after_refresh": [[1, "settled"], [1, "admitted"]],
            "deriver_a_epoch_1_erased": [a_status, a_retired["cryptographic_erasure"], a_retired["cancelled_admissions"]],
            "deriver_a_held_preparation_after_erasure": [a_late_status, "retired here before the operation was admitted"],
            "deriver_b_epoch_1_pending": [b_pending_status, "1 admitted operation(s) are not settled"],
            "recovery_window_ms": 4000,
            "deriver_b_epoch_1_erased_after_recovery": [b_status, b_retired["cancelled_admissions"]],
            "deriver_b_admissions_after": [[1, "settled"], [1, "cancelled"]],
            "same_command_replayed": [replay_status, "same signed receipt", replayed["cancelled_admissions"]],
            "cancelled_attempt_preparation_replayed": [late_status, "admission was cancelled here"],
            "signed_on_epoch_2_after_retirement": true,
        })
    );
    Ok(())
}

/// Cancellation stops a Yao execution that is paused after its root reads.
///
/// - A registration of one wallet is admitted on epoch 1. Its execute is held
///   while a refresh moves the root to epoch 2.
/// - Released, both Derivers read their epoch-1 shares. The execution is then
///   paused before Deriver A claims its pair: Deriver B's answer to A's peer
///   stream is held.
/// - Both Derivers are busy, so replicas on their stores run the operator's
///   retirement of epoch 1. Recovery cancels both unclaimed admissions, and
///   both shares are erased.
/// - Released, A's claim is refused. Neither role completes, and the Router
///   reports a failure. An exact retry of the old registration completes
///   nothing.
/// - A fresh registration of the same wallet completes on epoch 2 and signs.
///   The SigningWorker accepts it, so the old execution registered nothing.
#[test]
fn vm_tenant_root_execution_paused_after_its_root_reads_is_cancelled_and_retried(
) -> Result<(), Box<dyn std::error::Error>> {
    const WALLET: &str = "account-paused-then-retried";
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start_with_envs(
        "vm-tenant-root-paused-cancel",
        &[],
        &[],
        &[(router_ab_dev::LOCAL_TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_ENV_V1, "1000")],
    )?;
    let signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("paused-cancel")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let identity_digest_b64u =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity.digest()?.as_bytes());
    let admission_statuses = |db: &Connection| -> rusqlite::Result<Vec<(i64, String)>> {
        db.prepare(
            "SELECT tenant_root_share_epoch, status FROM tenant_root_root_use_admissions
             WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch, admitted_at_ms",
        )?
        .query_map([&lineage_b64u], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
    };
    let pair_states = |db: &Connection, table: &str| -> rusqlite::Result<Vec<String>> {
        db.prepare(&format!(
            "SELECT json_extract(record_json, '$.status') FROM {table} ORDER BY session_hex"
        ))?
        .query_map([], |row| row.get(0))?
        .collect()
    };
    let row_revision = |db: &Connection, epoch: i64| -> rusqlite::Result<i64> {
        db.query_row(
            "SELECT revision FROM tenant_root_role_shares
             WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = ?2",
            rusqlite::params![lineage_b64u, epoch],
            |row| row.get(0),
        )
    };
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let at = |number: i64, status: &str| (number, status.to_owned());

    // The Derivers will be busy with the paused execution, so replicas on
    // their stores serve the operator's retirement.
    let (_replica_a, replica_a_url) = stack.start_deriver_replica("deriver-a")?;
    let (_replica_b, replica_b_url) = stack.start_deriver_replica("deriver-b")?;
    let retire = |role: &str, deriver_url: &str| -> Result<(u16, String), Box<dyn std::error::Error>> {
        let db = if role == "deriver_a" { &stack.a_store } else { &stack.b_store };
        let (command_status, command_body) = stack.control_plane(
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
            &json!({
                "kind": "retired_after_refresh",
                "identity_digest_b64u": identity_digest_b64u,
                "custody_lineage_b64u": lineage_b64u,
                "role": role,
                "expected_retired_revision": row_revision(db, 1)?,
                "expected_active_revision": row_revision(db, 2)?,
            }),
        )?;
        assert_eq!(command_status, 200, "{command_body}");
        let command: serde_json::Value = serde_json::from_str(&command_body)?;
        post_json_to_path_with_headers(
            deriver_url,
            router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH,
            &json!({ "cleanup_command_b64u": command["cleanup_command_b64u"] }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    };

    // The wallet's registration is admitted on epoch 1; its execute is held.
    let (old_registration, _) = stack.wallet_registration(&identity, &lineage_b64u, WALLET)?;
    stack
        .proxy_a
        .hold_next_request_on(LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH);
    let registering = {
        let router_url = stack.router_url.clone();
        let registration = old_registration.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
            )
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
    wait_for("Deriver A's execute", &|| stack.proxy_a.held_request().is_some())?;
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "admitted")]);
    assert_eq!(admission_statuses(&stack.b_store)?, vec![at(1, "admitted")]);

    // A refresh moves the root to epoch 2 meanwhile.
    let (refresh_status, refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-paused-cancel", created_revision)?;
    assert_eq!(refresh_status, 200, "{refresh_body}");

    // Released, both Derivers read their epoch-1 shares. B's answer to A's
    // peer stream is held, before A claims its pair.
    stack.proxy_a_to_b.hold_next_stream_head();
    stack.proxy_a.release_request();
    wait_for("Deriver B's answer to the peer stream", &|| {
        stack.proxy_a_to_b.stream_head_held()
    })?;
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "admitted")], "A has not claimed");
    assert_eq!(pair_states(&stack.a_store, "local_deriver_a_yao_pairs")?, vec!["starting"]);
    assert_eq!(pair_states(&stack.b_store, "local_deriver_b_yao_pairs")?, vec!["running"]);

    // The operator retires epoch 1 at both roles. W has passed since the
    // admissions, so recovery cancels them, and both shares are erased.
    let admitted_at_ms: i64 = stack.a_store.query_row(
        "SELECT max(admitted_at_ms) FROM tenant_root_root_use_admissions",
        [],
        |row| row.get(0),
    )?;
    while u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?
        < u64::try_from(admitted_at_ms)? + 1_100
    {
        thread::sleep(Duration::from_millis(20));
    }
    let (a_status, a_body) = retire("deriver_a", &replica_a_url)?;
    assert_eq!(a_status, 200, "{a_body}");
    let (b_status, b_body) = retire("deriver_b", &replica_b_url)?;
    assert_eq!(b_status, 200, "{b_body}");
    let a_retired: serde_json::Value = serde_json::from_str(&a_body)?;
    let b_retired: serde_json::Value = serde_json::from_str(&b_body)?;
    assert_eq!(a_retired["cancelled_admissions"], 1, "{a_body}");
    assert_eq!(b_retired["cancelled_admissions"], 1, "{b_body}");
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "cancelled")]);
    assert_eq!(admission_statuses(&stack.b_store)?, vec![at(1, "cancelled")]);
    assert_eq!(stack.epochs(&lineage_b64u)?, (vec![epoch(2, "active")], vec![epoch(2, "active")]));

    // Released, the old execution cannot claim its pair: nothing completes.
    stack.proxy_a_to_b.release_stream_head();
    let (old_status, old_body) = registering
        .join()
        .map_err(|_| "the registration thread panicked")??;
    assert_eq!(old_status, 200, "{old_body}");
    let old_result: serde_json::Value = serde_json::from_str(&old_body)?;
    assert_ne!(old_result["status"], "succeeded", "{old_body}");
    let deriver_a_answer = String::from_utf8_lossy(
        &stack
            .proxy_a
            .held_response()
            .ok_or("Deriver A must have answered the held execute")?,
    )
    .into_owned();
    assert!(
        deriver_a_answer.contains("this tenant-root operation's admission was cancelled here"),
        "{deriver_a_answer}"
    );
    let a_pairs = pair_states(&stack.a_store, "local_deriver_a_yao_pairs")?;
    let b_pairs = pair_states(&stack.b_store, "local_deriver_b_yao_pairs")?;
    assert!(a_pairs.iter().all(|state| state != "completed"), "{a_pairs:?}");
    assert!(b_pairs.iter().all(|state| state != "completed"), "{b_pairs:?}");

    // An exact retry of the old registration completes nothing either.
    let (replay_status, replay_body) = stack.register(&old_registration)?;
    let replayed: serde_json::Value = serde_json::from_str(&replay_body)?;
    assert_ne!(replayed["status"], "succeeded", "{replay_status} {replay_body}");
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "cancelled")]);
    assert_eq!(admission_statuses(&stack.b_store)?, vec![at(1, "cancelled")]);

    // A fresh registration of the same wallet completes on epoch 2 and signs.
    // The SigningWorker accepts only a wallet's first registration.
    let signing_worker = stack.register_and_sign(signing_worker, &identity, &lineage_b64u, WALLET)?;
    drop(signing_worker);
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "cancelled"), at(2, "settled")]);
    assert_eq!(admission_statuses(&stack.b_store)?, vec![at(1, "cancelled"), at(2, "settled")]);

    println!(
        "R150_VM_TENANT_ROOT_PAUSED_EXECUTION_CANCELLED_E2E {}",
        json!({
            "paused_after": ["deriver_a_root_read", "deriver_b_root_read"],
            "paused_before": "deriver_a_claim",
            "pairs_while_paused": { "deriver_a": "starting", "deriver_b": "running" },
            "refresh_status": refresh_status,
            "retired_by_replicas": { "deriver_a": [a_status, a_retired["cancelled_admissions"]], "deriver_b": [b_status, b_retired["cancelled_admissions"]] },
            "old_registration": old_result["status"],
            "deriver_a_answer": "claim refused: admission was cancelled here",
            "pairs_after": { "deriver_a": a_pairs, "deriver_b": b_pairs },
            "exact_retry_of_old_registration": replayed["status"],
            "fresh_registration_of_same_wallet": "succeeded and signed on epoch 2",
            "admissions_after": { "deriver_a": [[1, "cancelled"], [2, "settled"]], "deriver_b": [[1, "cancelled"], [2, "settled"]] },
        })
    );
    Ok(())
}

/// A claimed Yao execution that fails is recovered, and retirement completes.
///
/// 1. A registration of one wallet is admitted on epoch 1. Its execute is
///    held while a refresh moves the root to epoch 2.
/// 2. Released, Deriver A claims its pair. Deriver B's messages after its
///    answer are held. The stream is then cut, and A's claimed pair burns.
///    A burned, claimed pair can never complete, and recovery used to leave
///    it pending for good.
/// 3. Deriver A restarts.
/// 4. The operator retires epoch 1. A's recovery first has Deriver B fence
///    the session: B had only admitted it, so B cancels its admission. A's
///    claimed admission is then cancelled, and both epochs are erased.
/// 5. The old execution's delayed work is refused: its execute replayed at A,
///    and the whole registration retried.
/// 6. A second refresh succeeds. A fresh registration of the same wallet
///    completes on epoch 3 and signs, so the old execution registered
///    nothing.
#[test]
fn vm_tenant_root_claimed_execution_that_fails_is_recovered_and_retirement_completes(
) -> Result<(), Box<dyn std::error::Error>> {
    const WALLET: &str = "account-claimed-then-failed";
    let _process_guard = local_worker_process_test_guard();
    let mut stack = RecoveryStackV1::start_with_envs(
        "vm-tenant-root-claimed-recovery",
        &[
            ("TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS", "60000"),
            ("TENANT_ROOT_RETIREMENT_GRACE_MS", "1000"),
        ],
        &[],
        &[(router_ab_dev::LOCAL_TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_ENV_V1, "1000")],
    )?;
    let signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("claimed-recovery")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let identity_digest_b64u =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity.digest()?.as_bytes());
    let admission_statuses = |db: &Connection| -> rusqlite::Result<Vec<(i64, String)>> {
        db.prepare(
            "SELECT tenant_root_share_epoch, status FROM tenant_root_root_use_admissions
             WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch, admitted_at_ms",
        )?
        .query_map([&lineage_b64u], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
    };
    let pair_states = |db: &Connection, table: &str| -> rusqlite::Result<Vec<String>> {
        db.prepare(&format!(
            "SELECT json_extract(record_json, '$.status') FROM {table} ORDER BY session_hex"
        ))?
        .query_map([], |row| row.get(0))?
        .collect()
    };
    let at = |number: i64, status: &str| (number, status.to_owned());
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let wait_for = |what: &str, ready: &dyn Fn() -> bool| -> Result<(), Box<dyn std::error::Error>> {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !ready() {
            if Instant::now() > deadline {
                return Err(format!("timed out waiting for {what}").into());
            }
            thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    };

    // 1. The wallet's registration is admitted on epoch 1; its execute is held
    // while a refresh moves the root to epoch 2.
    let (old_registration, _) = stack.wallet_registration(&identity, &lineage_b64u, WALLET)?;
    stack
        .proxy_a
        .hold_next_request_on(LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH);
    let registering = {
        let router_url = stack.router_url.clone();
        let registration = old_registration.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
            )
            .map_err(|error| error.to_string())
        })
    };
    wait_for("Deriver A's execute", &|| stack.proxy_a.held_request().is_some())?;
    let held_execute: serde_json::Value = serde_json::from_slice(
        &stack.proxy_a.held_request().ok_or("A's execute must be held")?,
    )?;
    let (first_refresh_status, first_refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-claimed-recovery", created_revision)?;
    assert_eq!(first_refresh_status, 200, "{first_refresh_body}");
    let first_refreshed_at = Instant::now();

    // 2. Released, A claims its pair; then the stream is cut.
    stack.proxy_a_to_b.hold_next_stream_body();
    stack.proxy_a.release_request();
    wait_for("Deriver B's answer to reach A", &|| stack.proxy_a_to_b.stream_body_held())?;
    wait_for("Deriver A's claim", &|| {
        admission_statuses(&stack.a_store).is_ok_and(|statuses| statuses == vec![at(1, "claimed")])
    })?;
    assert_eq!(pair_states(&stack.a_store, "local_deriver_a_yao_pairs")?, vec!["running"]);
    assert_eq!(pair_states(&stack.b_store, "local_deriver_b_yao_pairs")?, vec!["running"]);
    stack.proxy_a_to_b.cut_stream_body();
    let (old_status, old_body) = registering
        .join()
        .map_err(|_| "the registration thread panicked")??;
    let old_result: serde_json::Value = serde_json::from_str(&old_body)?;
    assert_ne!(old_result["status"], "succeeded", "{old_status} {old_body}");
    wait_for("Deriver A to burn its claimed pair", &|| {
        pair_states(&stack.a_store, "local_deriver_a_yao_pairs")
            .is_ok_and(|states| states == vec!["burned"])
    })?;
    // Burned and claimed: it can never complete, and nothing settles it.
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "claimed")]);
    assert_eq!(admission_statuses(&stack.b_store)?, vec![at(1, "admitted")]);

    // 3. Deriver A restarts.
    stack.restart_deriver_a()?;

    // 4. The operator retires epoch 1. A's recovery fences B first.
    let admitted_at_ms: i64 = stack.a_store.query_row(
        "SELECT max(admitted_at_ms) FROM tenant_root_root_use_admissions",
        [],
        |row| row.get(0),
    )?;
    while u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?
        < u64::try_from(admitted_at_ms)? + 1_100
    {
        thread::sleep(Duration::from_millis(20));
    }
    let row_revision = |db: &Connection, epoch: i64| -> rusqlite::Result<i64> {
        db.query_row(
            "SELECT revision FROM tenant_root_role_shares
             WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = ?2",
            rusqlite::params![lineage_b64u, epoch],
            |row| row.get(0),
        )
    };
    let retire = |role: &str| -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let (db, deriver_url) = if role == "deriver_a" {
            (&stack.a_store, &stack.deriver_a_url)
        } else {
            (&stack.b_store, &stack.deriver_b_url)
        };
        let (command_status, command_body) = stack.control_plane(
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
            &json!({
                "kind": "retired_after_refresh",
                "identity_digest_b64u": identity_digest_b64u,
                "custody_lineage_b64u": lineage_b64u,
                "role": role,
                "expected_retired_revision": row_revision(db, 1)?,
                "expected_active_revision": row_revision(db, 2)?,
            }),
        )?;
        assert_eq!(command_status, 200, "{command_body}");
        let command: serde_json::Value = serde_json::from_str(&command_body)?;
        let (status, body) = post_json_to_path_with_headers(
            deriver_url,
            router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH,
            &json!({ "cleanup_command_b64u": command["cleanup_command_b64u"] }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )?;
        assert_eq!(status, 200, "{role}: {body}");
        Ok(serde_json::from_str(&body)?)
    };
    let a_retired = retire("deriver_a")?;
    assert_eq!(a_retired["cancelled_admissions"], 1, "{a_retired}");
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "cancelled")]);
    assert_eq!(
        admission_statuses(&stack.b_store)?,
        vec![at(1, "cancelled")],
        "A's recovery fenced B first"
    );
    let b_retired = retire("deriver_b")?;
    assert_eq!(b_retired["cancelled_admissions"], 1, "{b_retired}");
    assert_eq!(stack.epochs(&lineage_b64u)?, (vec![epoch(2, "active")], vec![epoch(2, "active")]));

    // 5. The old execution's delayed work is refused.
    let (late_execute_status, late_execute_body) = post_json_to_path_with_headers(
        &stack.deriver_a_url,
        LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
        &held_execute,
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
    )?;
    assert_ne!(late_execute_status, 200, "{late_execute_body}");
    let (replay_status, replay_body) = stack.register(&old_registration)?;
    let replayed: serde_json::Value = serde_json::from_str(&replay_body)?;
    assert_ne!(replayed["status"], "succeeded", "{replay_status} {replay_body}");
    assert_eq!(pair_states(&stack.a_store, "local_deriver_a_yao_pairs")?, vec!["burned"]);
    let b_pairs = pair_states(&stack.b_store, "local_deriver_b_yao_pairs")?;
    assert!(b_pairs.iter().all(|state| state != "completed"), "{b_pairs:?}");

    // 6. A second refresh succeeds, and the wallet registers once, on epoch 3.
    let wait = Duration::from_millis(61_000).saturating_sub(first_refreshed_at.elapsed());
    thread::sleep(wait);
    let (revision, _, _) = stack.active_state(&lineage_b64u)?;
    let (second_refresh_status, second_refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-after-claimed-recovery", revision)?;
    assert_eq!(second_refresh_status, 200, "{second_refresh_body}");
    let retired_then_active = vec![epoch(2, "retired"), epoch(3, "active")];
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (retired_then_active.clone(), retired_then_active)
    );
    let signing_worker = stack.register_and_sign(signing_worker, &identity, &lineage_b64u, WALLET)?;
    drop(signing_worker);
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "cancelled"), at(3, "settled")]);
    assert_eq!(admission_statuses(&stack.b_store)?, vec![at(1, "cancelled"), at(3, "settled")]);

    println!(
        "R150_VM_TENANT_ROOT_CLAIMED_RECOVERY_E2E {}",
        json!({
            "claimed_then": "stream cut after the claim",
            "stuck_state_before_recovery": { "deriver_a_pair": "burned", "deriver_a_admission": "claimed", "deriver_b_admission": "admitted" },
            "old_registration": old_result["status"],
            "deriver_a_restarted": true,
            "retired": { "deriver_a": [a_retired["kind"], a_retired["cancelled_admissions"]], "deriver_b": [b_retired["kind"], b_retired["cancelled_admissions"]] },
            "deriver_b_fenced_by_a_recovery": true,
            "delayed_execute_at_a": late_execute_status,
            "exact_retry_of_old_registration": replayed["status"],
            "second_refresh_status": second_refresh_status,
            "fresh_registration_of_same_wallet": "succeeded and signed on epoch 3",
            "admissions_after": { "deriver_a": [[1, "cancelled"], [3, "settled"]], "deriver_b": [[1, "cancelled"], [3, "settled"]] },
        })
    );
    Ok(())
}

/// A completed registration is answered again after its epoch is erased
/// (docs/refactor-150-refresh-retirement.md, design item 4).
///
/// 1. A wallet registers on epoch 1. Deriver A's execute request is kept as
///    the Router sent it.
/// 2. A refresh moves the root to epoch 2, and the operator retires epoch 1
///    at both Derivers. Its admissions are settled, so both shares are
///    erased at once.
/// 3. The Router's replay of the registration returns the original result,
///    from both Derivers' completed pair records.
/// 4. Deriver A's execute, retried exactly, returns its stored response. A
///    changed request is refused. No share is left on epoch 1 to read.
/// 5. Neither retry changed an admission or a pair record.
#[test]
fn vm_tenant_root_completed_registration_replays_after_its_epoch_is_erased(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-replay-after-erasure")?;
    let _signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("replay-after-erasure")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let identity_digest_b64u =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity.digest()?.as_bytes());
    let admission_statuses = |db: &Connection| -> rusqlite::Result<Vec<(i64, String)>> {
        db.prepare(
            "SELECT tenant_root_share_epoch, status FROM tenant_root_root_use_admissions
             WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch, admitted_at_ms",
        )?
        .query_map([&lineage_b64u], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
    };
    let pair_records = |db: &Connection, table: &str| -> rusqlite::Result<Vec<String>> {
        db.prepare(&format!("SELECT record_json FROM {table} ORDER BY session_hex"))?
            .query_map([], |row| row.get(0))?
            .collect()
    };
    let settled = vec![(1, "settled".to_owned())];
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());

    // 1. The wallet registers on epoch 1; A's execute request is kept.
    let (registration, _) =
        stack.wallet_registration(&identity, &lineage_b64u, "account-replayed")?;
    stack
        .proxy_a
        .hold_next_request_on(LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH);
    let registering = {
        let router_url = stack.router_url.clone();
        let registration = registration.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
            )
            .map_err(|error| error.to_string())
        })
    };
    let deadline = Instant::now() + Duration::from_secs(20);
    let a_execute: serde_json::Value = loop {
        if let Some(body) = stack.proxy_a.held_request() {
            break serde_json::from_slice(&body)?;
        }
        if Instant::now() > deadline {
            return Err("the registration never reached Deriver A's execute".into());
        }
        thread::sleep(Duration::from_millis(10));
    };
    stack.proxy_a.release_request();
    let (registration_status, original) = registering
        .join()
        .map_err(|_| "the registration thread panicked")??;
    assert_eq!(registration_status, 200, "{original}");
    assert!(registration_succeeded(&original)?, "{original}");
    assert_eq!(admission_statuses(&stack.a_store)?, settled);
    assert_eq!(admission_statuses(&stack.b_store)?, settled);
    let a_pairs = pair_records(&stack.a_store, "local_deriver_a_yao_pairs")?;
    let b_pairs = pair_records(&stack.b_store, "local_deriver_b_yao_pairs")?;
    let [a_pair] = a_pairs.as_slice() else {
        return Err("Deriver A must hold exactly one pair".into());
    };
    let LocalDeriverAPairRecordV1::Completed { outcome, .. } = serde_json::from_str(a_pair)? else {
        return Err("Deriver A's pair must be completed".into());
    };

    // 2. A refresh, then epoch 1 is retired and erased at both Derivers.
    let (refresh_status, refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-replay-after-erasure", created_revision)?;
    assert_eq!(refresh_status, 200, "{refresh_body}");
    let row_revision = |db: &Connection, epoch: i64| -> rusqlite::Result<i64> {
        db.query_row(
            "SELECT revision FROM tenant_root_role_shares
             WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = ?2",
            rusqlite::params![lineage_b64u, epoch],
            |row| row.get(0),
        )
    };
    for (role, db, deriver_url) in [
        ("deriver_a", &stack.a_store, &stack.deriver_a_url),
        ("deriver_b", &stack.b_store, &stack.deriver_b_url),
    ] {
        let (command_status, command_body) = stack.control_plane(
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
            &json!({
                "kind": "retired_after_refresh",
                "identity_digest_b64u": identity_digest_b64u,
                "custody_lineage_b64u": lineage_b64u,
                "role": role,
                "expected_retired_revision": row_revision(db, 1)?,
                "expected_active_revision": row_revision(db, 2)?,
            }),
        )?;
        assert_eq!(command_status, 200, "{command_body}");
        let command: serde_json::Value = serde_json::from_str(&command_body)?;
        let (status, body) = post_json_to_path_with_headers(
            deriver_url,
            router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH,
            &json!({ "cleanup_command_b64u": command["cleanup_command_b64u"] }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )?;
        assert_eq!(status, 200, "{role}: {body}");
        let retired: serde_json::Value = serde_json::from_str(&body)?;
        assert_eq!(retired["kind"], "retired_deleted", "{role}: {body}");
        assert_eq!(retired["cancelled_admissions"], 0, "{role}: {body}");
    }
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (vec![epoch(2, "active")], vec![epoch(2, "active")])
    );

    // 3. The Router's replay returns the original result.
    let (replay_status, replay_body) = post_json_to_path_with_headers(
        &stack.router_url,
        LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        &registration,
        &[
            (LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH),
            (router_ab_cloudflare::ROUTER_ED25519_YAO_REPLAY_HEADER_V1, "1"),
        ],
    )?;
    assert_eq!(replay_status, 200, "{replay_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&replay_body)?,
        serde_json::from_str::<serde_json::Value>(&original)?,
        "the replay must return the original registration result"
    );

    // 4. A's execute, retried exactly, returns its stored response; a changed
    // request is refused.
    let execute = |request: &serde_json::Value| {
        post_json_to_path_with_headers(
            &stack.deriver_a_url,
            LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
            request,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    };
    let (a_replay_status, a_replay_body) = execute(&a_execute)?;
    assert_eq!(a_replay_status, 200, "{a_replay_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&a_replay_body)?,
        serde_json::to_value(&outcome)?
    );
    let mut changed = a_execute.clone();
    changed["tenant_root"]["custody_binding"]["issued_at_ms"] = json!(
        changed["tenant_root"]["custody_binding"]["issued_at_ms"]
            .as_u64()
            .ok_or("the execute request names its binding's issue time")?
            + 1
    );
    let (changed_status, changed_body) = execute(&changed)?;
    assert_ne!(changed_status, 200, "{changed_body}");

    // 5. Nothing changed.
    assert_eq!(admission_statuses(&stack.a_store)?, settled);
    assert_eq!(admission_statuses(&stack.b_store)?, settled);
    assert_eq!(pair_records(&stack.a_store, "local_deriver_a_yao_pairs")?, a_pairs);
    assert_eq!(pair_records(&stack.b_store, "local_deriver_b_yao_pairs")?, b_pairs);
    println!(
        "R150_VM_REPLAY_AFTER_ERASURE_E2E {}",
        json!({
            "registration": "succeeded on epoch 1",
            "retired": { "deriver_a": "retired_deleted", "deriver_b": "retired_deleted" },
            "epochs_after": [[2, "active"], [2, "active"]],
            "router_replay": [replay_status, "original result"],
            "deriver_a_execute_replay": [a_replay_status, "stored response"],
            "changed_execute": changed_status,
            "admissions_and_pair_records": "unchanged",
        })
    );
    Ok(())
}

/// The Router erases a refresh's retired epoch on a later pass, once the
/// grace after the swap has passed and each role's work on it has settled
/// (docs/refactor-150-refresh-retirement.md).
///
/// The grace is two seconds here, `W` eight, and the Router's scheduler is
/// kept out of the way.
/// 1. A wallet registers on epoch 1. A second registration is admitted at
///    Deriver B while A's preparation is held, and a refresh moves the root
///    to epoch 2. Both roles report the retired epoch kept: the grace.
/// 2. After the grace, an exact retry of the refresh is a pass. A erases
///    epoch 1, but its answer is lost. B's admission is unsettled, so B keeps
///    it.
/// 3. The next pass: A answers a fresh command from its store, and A's
///    erasure is recorded. B is now unreachable. A retry replays the
///    recorded erasure exactly.
/// 4. A new refresh is refused while B's retirement is pending.
/// 5. B is reachable again, and `W` has passed. The new refresh's own pass
///    has B cancel the stale admission and erase epoch 1. The refresh is then
///    admitted and completes on epoch 3.
#[test]
fn vm_tenant_root_refresh_retires_its_old_epoch_once_its_work_settles(
) -> Result<(), Box<dyn std::error::Error>> {
    const CLEANUP: &str = router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH;
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start_with_envs(
        "vm-tenant-root-retirement-trigger",
        &[
            ("TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS", "60000"),
            ("TENANT_ROOT_RETIREMENT_GRACE_MS", "2000"),
            (router_ab_dev::LOCAL_TENANT_ROOT_REFRESH_SCHEDULER_TICK_MS_ENV_V1, "3600000"),
        ],
        &[],
        &[(router_ab_dev::LOCAL_TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_ENV_V1, "8000")],
    )?;
    let signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("retirement-trigger")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let admission_statuses = |db: &Connection| -> rusqlite::Result<Vec<(i64, String)>> {
        db.prepare(
            "SELECT tenant_root_share_epoch, status FROM tenant_root_root_use_admissions
             WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch, admitted_at_ms",
        )?
        .query_map([&lineage_b64u], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
    };
    let at = |number: i64, status: &str| (number, status.to_owned());
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let kinds = |retirement: &serde_json::Value| {
        [
            retirement["deriver_a"]["kind"].as_str().unwrap_or_default().to_owned(),
            retirement["deriver_b"]["kind"].as_str().unwrap_or_default().to_owned(),
        ]
    };
    let refresh = |operation_id: &str, expected_revision: i64| {
        stack
            .refresh(&identity, &lineage_b64u, operation_id, expected_revision)
            .and_then(|(status, body)| Ok((status, serde_json::from_str::<serde_json::Value>(&body)?)))
    };

    // 1. A settled wallet on epoch 1, a second registration admitted only at
    // B, then the refresh.
    let _signing_worker =
        stack.register_and_sign(signing_worker, &identity, &lineage_b64u, "account-retired-settled")?;
    let registration = stack.registration(&identity, &lineage_b64u)?;
    stack
        .proxy_a
        .hold_next_request_on(router_ab_dev::LOCAL_DERIVER_A_ED25519_YAO_PREPARE_PAIR_PATH);
    let registering = {
        let router_url = stack.router_url.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
            )
            .map_err(|error| error.to_string())
        })
    };
    let deadline = Instant::now() + Duration::from_secs(20);
    while stack.proxy_a.held_request().is_none() || admission_statuses(&stack.b_store)?.len() < 2 {
        if Instant::now() > deadline {
            return Err("the second registration never reached both Derivers".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
    let (first_status, first) = refresh("vm-retirement-trigger-1", created_revision)?;
    assert_eq!(first_status, 200, "{first}");
    let refreshed_at = Instant::now();
    assert_eq!(kinds(&first["retirement"]), ["pending", "pending"], "{first}");
    assert!(
        first["retirement"]["deriver_a"]["reason"]
            .as_str()
            .is_some_and(|reason| reason.contains("the grace after the swap")),
        "{first}"
    );
    stack.proxy_a.release_request();
    let (registration_status, registration_body) = registering
        .join()
        .map_err(|_| "the registration thread panicked")??;
    assert_eq!(registration_status, 200, "{registration_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&registration_body)?["status"],
        "recoverable_failure",
        "{registration_body}"
    );
    assert_eq!(admission_statuses(&stack.a_store)?, vec![at(1, "settled")]);
    assert_eq!(admission_statuses(&stack.b_store)?, vec![at(1, "settled"), at(1, "admitted")]);

    // 2. After the grace: A erases epoch 1 and its answer is lost; B keeps it.
    thread::sleep(Duration::from_millis(2_100).saturating_sub(refreshed_at.elapsed()));
    stack.proxy_a.lose_next_response_on(CLEANUP);
    let (pass_status, pass) = refresh("vm-retirement-trigger-1", created_revision)?;
    assert_eq!(pass_status, 200, "{pass}");
    assert_eq!(kinds(&pass["retirement"]), ["pending", "pending"], "{pass}");
    assert!(stack.proxy_a.lost_response().is_some(), "A's cleanup answer must have been lost");
    assert!(
        pass["retirement"]["deriver_b"]["reason"]
            .as_str()
            .is_some_and(|reason| reason.contains("1 admitted operation(s) are not settled")),
        "{pass}"
    );
    assert_eq!(stack.epochs(&lineage_b64u)?.0, vec![epoch(2, "active")]);

    // 3. A fresh command is answered from A's store; B is unreachable.
    stack.proxy_b.drop_every_on(CLEANUP);
    let (recorded_status, recorded) = refresh("vm-retirement-trigger-1", created_revision)?;
    assert_eq!(recorded_status, 200, "{recorded}");
    assert_eq!(kinds(&recorded["retirement"]), ["erased", "pending"], "{recorded}");
    assert_eq!(recorded["retirement"]["deriver_a"]["cancelled_admissions"], 0);
    let (replayed_status, replayed) = refresh("vm-retirement-trigger-1", created_revision)?;
    assert_eq!(replayed_status, 200, "{replayed}");
    assert_eq!(
        replayed["retirement"]["deriver_a"], recorded["retirement"]["deriver_a"],
        "the recorded erasure replays exactly"
    );
    assert_eq!(
        stack.epochs(&lineage_b64u)?.1,
        vec![epoch(1, "retired"), epoch(2, "active")]
    );

    // 4. The next refresh waits for B's retirement.
    thread::sleep(Duration::from_millis(61_000).saturating_sub(refreshed_at.elapsed()));
    let (refreshed_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let (refused_status, refused) = refresh("vm-retirement-trigger-2", refreshed_revision)?;
    assert_eq!(refused_status, 409, "{refused}");
    assert_eq!(refused["code"], "tenant_root_retirement_pending", "{refused}");
    assert_eq!(kinds(&refused["retirement"]), ["erased", "pending"], "{refused}");

    // 5. B is reachable and W has passed: the refresh's own pass erases B's
    // epoch 1, then the refresh completes.
    stack.proxy_b.stop_dropping();
    let (second_status, second) = refresh("vm-retirement-trigger-2", refreshed_revision)?;
    assert_eq!(second_status, 200, "{second}");
    assert_eq!(kinds(&second["retirement"]), ["pending", "pending"], "{second}");
    assert_eq!(admission_statuses(&stack.b_store)?, vec![at(1, "settled"), at(1, "cancelled")]);
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (
            vec![epoch(2, "retired"), epoch(3, "active")],
            vec![epoch(2, "retired"), epoch(3, "active")],
        )
    );
    println!(
        "R150_VM_TENANT_ROOT_RETIREMENT_TRIGGER_E2E {}",
        json!({
            "grace_ms": 2000,
            "w_ms": 8000,
            "first_refresh": [first_status, kinds(&first["retirement"])],
            "after_grace_with_a_lost_answer": [kinds(&pass["retirement"]), pass["retirement"]["deriver_b"]["reason"]],
            "a_answers_a_fresh_command_from_its_store": kinds(&recorded["retirement"]),
            "recorded_erasure_replays_exactly": true,
            "next_refresh_while_b_is_unreachable": [refused_status, refused["code"]],
            "next_refresh_once_b_answers": [second_status, second["lifecycle_revision"]],
            "b_admissions_after": [[1, "settled"], [1, "cancelled"]],
            "epochs_after": [[2, "retired"], [3, "active"]],
        })
    );
    Ok(())
}

/// Work admitted before a refresh finishes on the epoch it started with. A
/// registration is admitted and prepared while epoch 1 is active, then held
/// before Deriver A reads it. A manual refresh then commits epoch 2 and both
/// Derivers swap, retiring epoch 1. Released, the registration completes: its
/// custody binding names epoch 1, so each Deriver reads its retired epoch-1
/// share. Nothing is erased.
#[test]
fn vm_tenant_root_work_admitted_before_a_refresh_finishes_on_its_epoch(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let binary = env!("CARGO_BIN_EXE_router_ab_local_worker");
    let stack = RecoveryStackV1::start("vm-tenant-root-inflight")?;
    let mut signing_worker = ChildGuard::spawn_in_root(
        binary,
        "signing-worker",
        stack.temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
        &stack.temp,
    )?;
    wait_for_health(&stack.signing_worker_url, signing_worker.child_mut())?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("work-across-refresh")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let epoch_one_receipt = stack
        .committed_receipt(&lineage_b64u)?
        .ok_or("the Router must have committed epoch 1")?;

    // A registration is admitted on epoch 1 and held before A reads it.
    let router_env = fs::read_to_string(stack.temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1))?;
    let fixture = ProductTenantRoot {
        tenant_root: CloudflareRouterEd25519YaoTenantRootV1 {
            identity: identity.clone(),
            custody_lineage_b64u: lineage_b64u.clone(),
        },
        application: RouterAbEd25519YaoApplicationBindingFactsV1::new(
            "account-product-benchmark",
            "ed25519ks_product_benchmark",
            "project:local",
            1,
        )?,
        participant_ids: [1, 2],
    };
    let (registration, _) = product_registration_request(&router_env, &fixture)?;
    stack
        .proxy_a
        .hold_next_request_on(LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH);
    let registering = {
        let router_url = stack.router_url.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
            )
            .map_err(|error| error.to_string())
        })
    };
    let deadline = Instant::now() + Duration::from_secs(15);
    let held = loop {
        if let Some(held) = stack.proxy_a.held_request() {
            break held;
        }
        if Instant::now() > deadline {
            return Err("the registration never reached Deriver A's execute".into());
        }
        thread::sleep(Duration::from_millis(10));
    };
    let held: serde_json::Value = serde_json::from_slice(&held)?;
    let bound_receipt = held["tenant_root"]["custody_binding"]["activation_receipt_b64u"]
        .as_str()
        .ok_or("the held execute must carry its custody binding")?
        .to_owned();
    assert_eq!(bound_receipt, epoch_one_receipt, "the work is bound to epoch 1");

    // Meanwhile a refresh commits epoch 2 and both Derivers swap.
    let (refresh_status, refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-inflight", created_revision)?;
    assert_eq!(refresh_status, 200, "{refresh_body}");
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let retired_then_active = vec![epoch(1, "retired"), epoch(2, "active")];
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (retired_then_active.clone(), retired_then_active.clone())
    );
    let epoch_two_receipt = stack
        .committed_receipt(&lineage_b64u)?
        .ok_or("the Router must have committed epoch 2")?;
    assert_ne!(epoch_two_receipt, epoch_one_receipt);

    // Released, the registration finishes on its retired epoch.
    stack.proxy_a.release_request();
    let (registration_status, registration_body) = registering
        .join()
        .map_err(|_| "the registration thread panicked")??;
    let deriver_a_answer = String::from_utf8_lossy(
        &stack
            .proxy_a
            .held_response()
            .ok_or("Deriver A must have answered the held execute")?,
    )
    .into_owned();
    let deriver_a_status = deriver_a_answer
        .split_whitespace()
        .nth(1)
        .ok_or("Deriver A's answer has no status")?
        .to_owned();
    assert_eq!(registration_status, 200, "{registration_body}");
    let result = serde_json::from_str::<RouterEd25519YaoExecuteResultV1>(&registration_body)?;
    let RouterEd25519YaoExecuteResultV1::Succeeded { result } = result else {
        return Err(format!(
            "the held registration did not succeed: {registration_body}; Deriver A answered: {}",
            deriver_a_answer.split("\r\n\r\n").nth(1).unwrap_or_default()
        )
        .into());
    };
    let RouterEd25519YaoExecuteSuccessV1::Registration { .. } = *result else {
        return Err("the held work was not a registration".into());
    };
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (retired_then_active.clone(), retired_then_active),
        "finishing on epoch 1 changes no role share"
    );

    println!(
        "R150_VM_TENANT_ROOT_WORK_ACROSS_REFRESH_E2E {}",
        json!({
            "work": "ed25519_yao_registration",
            "admitted_on_epoch": 1,
            "held_before": "deriver_a_execute_pair",
            "deriver_a_execute_status": deriver_a_status,
            "refresh_status": refresh_status,
            "epochs_while_held": [[1, "retired"], [2, "active"]],
            "work_bound_to_epoch_1_receipt": true,
            "registration_status": registration_status,
            "registration_outcome": "succeeded",
            "retirement": "pending",
        })
    );
    Ok(())
}

/// Whether a Router response is a successful Yao registration.
fn registration_succeeded(body: &str) -> Result<bool, Box<dyn std::error::Error>> {
    let Ok(result) = serde_json::from_str::<RouterEd25519YaoExecuteResultV1>(body) else {
        return Ok(false);
    };
    Ok(matches!(
        result,
        RouterEd25519YaoExecuteResultV1::Succeeded { result }
            if matches!(*result, RouterEd25519YaoExecuteSuccessV1::Registration { .. })
    ))
}

/// A binding unused before its epoch closes starts nothing. A registration is
/// admitted by the Router on epoch 1; Deriver B prepares it, admitting it on
/// epoch 1, while A's preparation is held. A manual refresh then commits
/// epoch 2 and both roles swap. Released, A's preparation is refused: A never
/// admitted the operation before epoch 1 closed there. A fresh registration
/// is then admitted on epoch 2 and completes.
#[test]
fn vm_tenant_root_binding_unused_before_its_epoch_closes_starts_nothing(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-unused-binding")?;
    let _signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("unused-binding")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;
    let epoch_one_receipt = stack
        .committed_receipt(&lineage_b64u)?
        .ok_or("the Router must have committed epoch 1")?;

    let registration = stack.registration(&identity, &lineage_b64u)?;
    stack
        .proxy_a
        .hold_next_request_on(router_ab_dev::LOCAL_DERIVER_A_ED25519_YAO_PREPARE_PAIR_PATH);
    let registering = {
        let router_url = stack.router_url.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
            )
            .map_err(|error| error.to_string())
        })
    };
    let deadline = Instant::now() + Duration::from_secs(15);
    let held = loop {
        if let Some(held) = stack.proxy_a.held_request() {
            break held;
        }
        if Instant::now() > deadline {
            return Err("the registration never reached Deriver A's preparation".into());
        }
        thread::sleep(Duration::from_millis(10));
    };
    let held: serde_json::Value = serde_json::from_slice(&held)?;
    assert_eq!(
        held["tenant_root"]["custody_binding"]["activation_receipt_b64u"],
        json!(epoch_one_receipt),
        "the held preparation is bound to epoch 1"
    );
    // B prepared concurrently and admitted the operation on epoch 1.
    let deadline = Instant::now() + Duration::from_secs(15);
    while stack.admissions(&lineage_b64u)?.1.is_empty() {
        if Instant::now() > deadline {
            return Err("Deriver B never admitted the registration".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![], vec![1]));

    let (refresh_status, refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-unused-binding", created_revision)?;
    assert_eq!(refresh_status, 200, "{refresh_body}");
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    let retired_then_active = vec![epoch(1, "retired"), epoch(2, "active")];
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (retired_then_active.clone(), retired_then_active.clone())
    );

    stack.proxy_a.release_request();
    let (registration_status, registration_body) = registering
        .join()
        .map_err(|_| "the registration thread panicked")??;
    let deriver_a_answer = String::from_utf8_lossy(
        &stack
            .proxy_a
            .held_response()
            .ok_or("Deriver A must have answered the held preparation")?,
    )
    .into_owned();
    let deriver_a_status = deriver_a_answer
        .split_whitespace()
        .nth(1)
        .ok_or("Deriver A's answer has no status")?
        .to_owned();
    assert_ne!(deriver_a_status, "200", "{deriver_a_answer}");
    assert!(
        deriver_a_answer.contains("was retired here before the operation was admitted"),
        "{deriver_a_answer}"
    );
    // The caller is told to retry.
    let refused: serde_json::Value = serde_json::from_str(&registration_body)?;
    assert_eq!(refused["status"], "recoverable_failure", "{registration_body}");
    // A admitted nothing on the closed epoch; B's epoch-1 admission remains,
    // an obligation a later retirement must see settled.
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![], vec![1]));

    // A fresh registration is admitted on epoch 2 and completes.
    let (retry_status, retry_body) =
        stack.register(&stack.registration(&identity, &lineage_b64u)?)?;
    assert_eq!(retry_status, 200, "{retry_body}");
    assert!(registration_succeeded(&retry_body)?, "{retry_body}");
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![2], vec![1, 2]));

    println!(
        "R150_VM_TENANT_ROOT_UNUSED_BINDING_E2E {}",
        json!({
            "work": "ed25519_yao_registration",
            "bound_to_epoch": 1,
            "held_before": "deriver_a_prepare_pair",
            "refresh_status": refresh_status,
            "deriver_a_prepare_status": deriver_a_status,
            "registration_status": registration_status,
            "registration_outcome": refused["status"],
            "admissions_after_refusal": { "deriver_a": [], "deriver_b": [1] },
            "fresh_registration_status": retry_status,
            "admissions_after_fresh_registration": { "deriver_a": [2], "deriver_b": [1, 2] },
        })
    );
    Ok(())
}

/// New work waits for the committed epoch's delivery. B's refresh activation
/// is lost after the Router commits epoch 2, and B stays unreachable for it.
/// A registration is then refused with a retryable answer, and no binding for
/// epoch 2 is issued while B has not activated it. A Deriver also refuses an
/// epoch it has not activated when a binding names it directly. Once B is
/// reachable, the next registration delivers the committed receipt to B and
/// runs on epoch 2.
#[test]
fn vm_tenant_root_new_work_waits_for_the_committed_epoch_delivery(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start("vm-tenant-root-delivery-gate")?;
    let _signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("delivery-gate")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let delivered = || (Some("delivered".to_owned()), Some("delivered".to_owned()));
    assert_eq!(stack.delivery(&lineage_b64u)?, delivered(), "creation is delivered");
    let (created_revision, _, _) = stack.active_state(&lineage_b64u)?;

    // B cannot be reached for its refresh activation.
    let refresh_activation =
        router_ab_cloudflare::CLOUDFLARE_DERIVER_TENANT_ROOT_REFRESH_ACTIVATION_PRIVATE_REQUEST_PATH;
    stack.proxy_b.drop_every_on(refresh_activation);
    let (refresh_status, refresh_body) =
        stack.refresh(&identity, &lineage_b64u, "vm-refresh-delivery-gate", created_revision)?;
    assert_ne!(refresh_status, 200, "{refresh_body}");
    let epoch = |number: i64, lifecycle: &str| (number, lifecycle.to_owned());
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (
            vec![epoch(1, "retired"), epoch(2, "active")],
            vec![epoch(1, "active"), epoch(2, "pending")],
        )
    );
    let b_pending = (Some("delivered".to_owned()), Some("pending".to_owned()));
    assert_eq!(stack.delivery(&lineage_b64u)?, b_pending);
    let epoch_two_receipt = stack
        .committed_receipt(&lineage_b64u)?
        .ok_or("the Router must have committed epoch 2")?;

    // New work is refused retryably while B lacks epoch 2.
    let (blocked_status, blocked_body) =
        stack.register(&stack.registration(&identity, &lineage_b64u)?)?;
    assert_eq!(blocked_status, 503, "{blocked_body}");
    assert!(blocked_body.contains("LifecycleTransitionInProgress"), "{blocked_body}");
    assert_eq!(stack.delivery(&lineage_b64u)?, b_pending);
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![], vec![]));

    // B refuses epoch 2 even when a binding names it directly.
    let direct =
        direct_deriver_b_preparation_v1(&stack, &identity, &lineage_b64u, &epoch_two_receipt)?;
    let (direct_status, direct_body) = post_json_to_path_with_headers(
        &stack.deriver_b_url,
        router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
        &direct,
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
    )?;
    assert_ne!(direct_status, 200, "{direct_body}");
    assert!(direct_body.contains("not yet active at this Deriver"), "{direct_body}");
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![], vec![]));

    // Once B is reachable, the next registration delivers epoch 2 to B first.
    stack.proxy_b.stop_dropping();
    let (status, body) = stack.register(&stack.registration(&identity, &lineage_b64u)?)?;
    assert_eq!(status, 200, "{body}");
    assert!(registration_succeeded(&body)?, "{body}");
    assert_eq!(stack.delivery(&lineage_b64u)?, delivered());
    let retired_then_active = vec![epoch(1, "retired"), epoch(2, "active")];
    assert_eq!(
        stack.epochs(&lineage_b64u)?,
        (retired_then_active.clone(), retired_then_active)
    );
    assert_eq!(stack.admissions(&lineage_b64u)?, (vec![2], vec![2]));

    println!(
        "R150_VM_TENANT_ROOT_DELIVERY_GATE_E2E {}",
        json!({
            "fault": "deriver_b_unreachable_for_refresh_activation",
            "refresh_status": refresh_status,
            "delivery_after_refresh": { "deriver_a": "delivered", "deriver_b": "pending" },
            "registration_while_pending_status": blocked_status,
            "registration_while_pending_code": "lifecycle_transition_in_progress",
            "direct_epoch_2_preparation_at_b_status": direct_status,
            "admissions_while_pending": { "deriver_a": [], "deriver_b": [] },
            "registration_after_reachable_status": status,
            "delivery_after_registration": { "deriver_a": "delivered", "deriver_b": "delivered" },
            "admissions_after": { "deriver_a": [2], "deriver_b": [2] },
        })
    );
    Ok(())
}

/// A Yao preparation for Deriver B whose custody binding names this receipt's
/// epoch, built as the Router builds one, for sending to B directly.
fn direct_deriver_b_preparation_v1(
    stack: &RecoveryStackV1,
    identity: &TenantRootIdentityV1,
    lineage: &str,
    receipt_b64u: &str,
) -> Result<router_ab_cloudflare::CloudflareEd25519YaoPairPrepareRequestV1, Box<dyn std::error::Error>>
{
    let registration = stack.registration(identity, lineage)?;
    let now_ms = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?;
    direct_deriver_b_preparation_for_v1(stack, identity, &registration, receipt_b64u, now_ms)
}

/// Deriver B's preparation of one registration's pair, bound to the receipt
/// given and stamped with a window opening at `now_ms`, as the Router stamps
/// each attempt.
fn direct_deriver_b_preparation_for_v1(
    stack: &RecoveryStackV1,
    identity: &TenantRootIdentityV1,
    registration: &CloudflareRouterEd25519YaoExecuteRequestV2,
    receipt_b64u: &str,
    now_ms: u64,
) -> Result<router_ab_cloudflare::CloudflareEd25519YaoPairPrepareRequestV1, Box<dyn std::error::Error>>
{
    let request = registration.target.clone().into_execute_request(
        PublicDigest32::new([0x5a; 32]),
        now_ms,
        now_ms + 60_000,
    )?;
    let router_ab_core::RouterEd25519YaoExecuteRequestV1::Registration {
        pair_binding,
        deriver_b_input,
        ..
    } = request
    else {
        return Err("the registration target is not a registration".into());
    };
    let env = router_ab_cloudflare::CloudflareEnvMapV1::new(
        parse_local_env_file_contents_v1(&fs::read_to_string(
            stack.temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
        )?)?
        .into_iter()
        .collect(),
    );
    let issuer_keys =
        router_ab_cloudflare::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(
            &env,
        )?;
    let receipt = router_ab_core::TenantRootSignedActivationReceiptV1::decode_canonical_bytes(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(receipt_b64u)?,
    )?;
    let issuer_key = issuer_keys
        .for_issuer_key_id(receipt.issuer_key_id())
        .ok_or("the committed receipt's issuer must be trusted")?;
    let receipt = receipt.verify_issuer_signature(issuer_key)?;
    let derivers =
        router_ab_cloudflare::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(&env)?
            .deriver_identities()?;
    let tenant_root = router_ab_cloudflare::cloudflare_ed25519_yao_tenant_root_context_v2(
        identity.clone(),
        &receipt,
        derivers,
        registration.application.clone(),
        registration.participant_ids,
        &pair_binding,
        now_ms,
        now_ms + 60_000,
    )?;
    Ok(router_ab_cloudflare::CloudflareEd25519YaoPairPrepareRequestV1 {
        pair_binding,
        tenant_root,
        work: router_ab_cloudflare::CloudflareEd25519YaoPairWorkV1::Ceremony,
        input: deriver_b_input,
    })
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
/// The interruption loses only A's command; B is cleaned regardless.
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

    // The retry fences the creation, then loses A's cleanup command: the
    // outage begins right after the fence. B is still cleaned, since one
    // role's failing cleanup does not hold back the other's.
    stack.proxy_control_plane.drop_next_on(
        router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
    );
    let (interrupted_status, interrupted_body) = stack.create(&grant)?;
    let fenced_at = Instant::now();
    assert_ne!(interrupted_status, 200, "{interrupted_body}");
    assert!(stack.proxy_control_plane.dropped_on(), "the cleanup command must have been lost");
    assert_eq!(stack.abandonment_records(&lineage_b64u)?, (1, 1), "fenced, only B cleaned");
    assert_eq!(stack.lifecycles(&lineage_b64u)?, (pending(), None));

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
            "fault": "deriver_a_cleanup_command_lost_right_after_the_fence",
            "cleaned_despite_the_loss": ["deriver_b"],
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
    // Both roles are tombstoned: A by the ceremony, B by its recorded
    // evidence, so a late attempt of either knows its writes were abandoned.
    assert_eq!(stack.tombstones(&lineage_b64u)?, (1, 1));
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
            "tombstones": [1, 1],
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
    signing_worker_url: String,
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
    /// The Router, both Derivers and the control plane, in that order.
    roles: Vec<ChildGuard>,
}

impl RecoveryStackV1 {
    fn start(label: &str) -> Result<Self, Box<dyn std::error::Error>> {
        Self::start_with_router_env(label, &[])
    }

    /// Starts the stack with extra settings in the Router's env file.
    fn start_with_router_env(
        label: &str,
        router_env: &[(&str, &str)],
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Self::start_with_envs(label, router_env, &[], &[])
    }

    /// Starts the stack with extra settings in the Router's, the control
    /// plane's and both Derivers' env files.
    fn start_with_envs(
        label: &str,
        router_env: &[(&str, &str)],
        control_plane_env: &[(&str, &str)],
        deriver_env: &[(&str, &str)],
    ) -> Result<Self, Box<dyn std::error::Error>> {
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
        if !router_env.is_empty() {
            let router_env_path = temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1);
            let mut contents = fs::read_to_string(&router_env_path)?;
            for (key, value) in router_env {
                contents.push_str(&format!("\n{key}={value}"));
            }
            fs::write(&router_env_path, contents)?;
        }
        for env_file in [
            router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1,
            router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1,
        ] {
            if deriver_env.is_empty() {
                break;
            }
            let path = temp.join(env_file);
            let mut contents = fs::read_to_string(&path)?;
            for (key, value) in deriver_env {
                contents.push_str(&format!("\n{key}={value}"));
            }
            fs::write(&path, contents)?;
        }
        if !control_plane_env.is_empty() {
            let control_plane_env_path =
                temp.join(router_ab_dev::LOCAL_TENANT_ROOT_CONTROL_PLANE_ENV_FILE_V1);
            let mut contents = fs::read_to_string(&control_plane_env_path)?;
            for (key, value) in control_plane_env {
                contents.push_str(&format!("\n{key}={value}"));
            }
            fs::write(&control_plane_env_path, contents)?;
        }
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
            roles: vec![router, deriver_a, deriver_b, control_plane],
            temp,
            router_url,
            signing_worker_url,
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

    /// Registers a new Yao wallet on one root, which derives its key from the
    /// root's active shares, then signs a NEAR transaction with that key
    /// through the Router and the SigningWorker. A wallet registers once.
    fn register_and_sign(
        &self,
        signing_worker: ChildGuard,
        identity: &TenantRootIdentityV1,
        lineage: &str,
        wallet_id: &str,
    ) -> Result<ChildGuard, Box<dyn std::error::Error>> {
        let (request, client_recipient_key) = self.wallet_registration(identity, lineage, wallet_id)?;
        let (status, body) = self.register(&request)?;
        assert_eq!(status, 200, "{body}");
        let RouterEd25519YaoExecuteResultV1::Succeeded { result } =
            serde_json::from_str::<RouterEd25519YaoExecuteResultV1>(&body)?
        else {
            return Err(format!("the Yao registration did not succeed: {body}").into());
        };
        let RouterEd25519YaoExecuteSuccessV1::Registration { result: activation } = *result else {
            return Err("the Yao result was not a registration".into());
        };
        let (client_share, _) = complete_client_activation_packages_v1(
            activation.binding(),
            [1, 2],
            activation.public_receipt(),
            client_recipient_key.as_bytes(),
            activation.deriver_a_client_package(),
            activation.deriver_b_client_package(),
        )?;
        product_near_signing_process_flow(
            env!("CARGO_BIN_EXE_router_ab_local_worker"),
            &self.temp,
            &self.router_url,
            &self.signing_worker_url,
            signing_worker,
            &activation,
            &client_share,
            identity,
        )
    }

    /// Calls one control-plane operation with the role-shared credential.
    fn control_plane(
        &self,
        path: &str,
        request: &serde_json::Value,
    ) -> Result<(u16, String), Box<dyn std::error::Error>> {
        post_json_to_path_with_headers(
            &self.control_plane_url,
            path,
            request,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    }

    /// Runs one managed restore through the Router.
    fn restore(&self, request: &serde_json::Value) -> Result<(u16, String), Box<dyn std::error::Error>> {
        post_json_to_path_with_headers(
            &self.router_url,
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_MANAGED_RESTORE_PRIVATE_REQUEST_PATH,
            request,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    }

    /// Signs a managed-restore incident binding with the operations authority
    /// and Deriver A's custody authority, from the operator's env file.
    fn sign_deriver_a_incident_authorization(
        &self,
        binding_b64u: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        use ed25519_dalek::Signer as _;
        let operator = self.temp.join(router_ab_dev::LOCAL_TENANT_ROOT_OPERATOR_ENV_FILE_V1);
        let seed = |key: &str| -> Result<[u8; 32], Box<dyn std::error::Error>> {
            Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(env_value(&operator, key)?)?
                .try_into()
                .map_err(|_| format!("{key} must be 32 bytes"))?)
        };
        let field = |bytes: &[u8]| {
            let mut out = u32::try_from(bytes.len()).expect("field length").to_be_bytes().to_vec();
            out.extend_from_slice(bytes);
            out
        };
        let binding = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(binding_b64u)?;
        let input = [
            field(b"tenant_root_managed_restore_incident_authorization_authentication_v1"),
            field(&binding),
        ]
        .concat();
        let operations = ed25519_dalek::SigningKey::from_bytes(&seed(
            "LOCAL_TENANT_ROOT_OPERATIONS_INCIDENT_SIGNING_KEY",
        )?);
        let custody = ed25519_dalek::SigningKey::from_bytes(&seed(
            "LOCAL_TENANT_ROOT_DERIVER_A_CUSTODY_AUTHORITY_SIGNING_KEY",
        )?);
        let authorization = [
            binding.clone(),
            field(&operations.sign(&input).to_bytes()),
            field(&custody.sign(&input).to_bytes()),
        ]
        .concat();
        Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(authorization))
    }

    /// Stops Deriver A's process and starts it again on the same store.
    fn restart_deriver_a(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        drop(self.roles.remove(1));
        let mut deriver_a = ChildGuard::spawn_in_root(
            env!("CARGO_BIN_EXE_router_ab_local_worker"),
            "deriver-a",
            self.temp.join(router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
            &self.temp,
        )?;
        wait_for_health(&self.deriver_a_url, deriver_a.child_mut())?;
        self.roles.insert(1, deriver_a);
        Ok(())
    }

    /// Stops the Router process and starts it again on the same state.
    fn restart_router(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        drop(self.roles.remove(0));
        let mut router = ChildGuard::spawn_in_root(
            env!("CARGO_BIN_EXE_router_ab_local_worker"),
            "router",
            self.temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
            &self.temp,
        )?;
        wait_for_health(&self.router_url, router.child_mut())?;
        self.roles.insert(0, router);
        Ok(())
    }

    /// The Router's refresh bookkeeping for one lineage: its lifecycle
    /// revision, fence kind, the fence attempt's operation, and the pending
    /// operation with its trigger.
    #[allow(clippy::type_complexity)]
    fn refresh_bookkeeping(
        &self,
        lineage: &str,
    ) -> rusqlite::Result<(i64, String, Option<String>, Option<String>, Option<String>)> {
        self.router_db.query_row(
            "SELECT json_extract(value_json, '$.lifecycle_revision'),
                    json_extract(value_json, '$.fence.kind'),
                    json_extract(value_json, '$.fence.attempt.manual_operation_id'),
                    json_extract(value_json, '$.manual_refresh_pending.operation_id'),
                    json_extract(value_json, '$.manual_refresh_pending.trigger')
             FROM local_tenant_root_creation_state
             WHERE storage_key = 'refresh/v1/active-state'
               AND json_extract(value_json, '$.custody_lineage_b64u') = ?1",
            [lineage],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
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

    /// Runs one manual refresh operation through the Router.
    fn refresh(
        &self,
        identity: &TenantRootIdentityV1,
        lineage: &str,
        operation_id: &str,
        expected_revision: i64,
    ) -> Result<(u16, String), Box<dyn std::error::Error>> {
        let expires_at_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() + 60_000;
        post_json_to_path_with_headers(
            &self.router_url,
            router_ab_cloudflare::CLOUDFLARE_ROUTER_TENANT_ROOT_REFRESH_PRIVATE_REQUEST_PATH,
            &json!({
                "operation_id": operation_id,
                "identity_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .encode(identity.digest()?.as_bytes()),
                "custody_lineage_b64u": lineage,
                "expected_lifecycle_revision": expected_revision,
                "expires_at_ms": expires_at_ms,
                "trigger": "manual",
            }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )
    }

    /// The Router's committed state for one lineage: its lifecycle revision,
    /// its refresh fence and its committed receipt's digest.
    fn active_state(&self, lineage: &str) -> rusqlite::Result<(i64, String, String)> {
        self.router_db.query_row(
            "SELECT json_extract(value_json, '$.lifecycle_revision'),
                    json_extract(value_json, '$.fence.kind'),
                    json_extract(value_json, '$.activation_receipt_digest_b64u')
             FROM local_tenant_root_creation_state
             WHERE storage_key = 'refresh/v1/active-state'
               AND json_extract(value_json, '$.custody_lineage_b64u') = ?1",
            [lineage],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
    }

    /// The Router's recorded delivery of its committed receipt to each Deriver.
    fn delivery(&self, lineage: &str) -> rusqlite::Result<(Option<String>, Option<String>)> {
        self.router_db.query_row(
            "SELECT json_extract(value_json, '$.delivery.deriver_a'),
                    json_extract(value_json, '$.delivery.deriver_b')
             FROM local_tenant_root_creation_state
             WHERE storage_key = 'refresh/v1/active-state'
               AND json_extract(value_json, '$.custody_lineage_b64u') = ?1",
            [lineage],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    /// The epochs of each Deriver's root-use admissions for one lineage.
    fn admissions(&self, lineage: &str) -> rusqlite::Result<(Vec<i64>, Vec<i64>)> {
        let epochs = |db: &Connection| {
            db.prepare(
                "SELECT tenant_root_share_epoch FROM tenant_root_root_use_admissions
                 WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch",
            )?
            .query_map([lineage], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<i64>>>()
        };
        Ok((epochs(&self.a_store)?, epochs(&self.b_store)?))
    }

    /// Starts the SigningWorker, which registration needs.
    fn start_signing_worker(&self) -> Result<ChildGuard, Box<dyn std::error::Error>> {
        let mut signing_worker = ChildGuard::spawn_in_root(
            env!("CARGO_BIN_EXE_router_ab_local_worker"),
            "signing-worker",
            self.temp.join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
            &self.temp,
        )?;
        wait_for_health(&self.signing_worker_url, signing_worker.child_mut())?;
        Ok(signing_worker)
    }

    /// A fresh Yao registration against one root, as the Gateway sends it.
    /// A fresh registration of one wallet on the root: a new pair session
    /// each time, with the wallet facts `register_and_sign` uses.
    fn wallet_registration(
        &self,
        identity: &TenantRootIdentityV1,
        lineage: &str,
        wallet_id: &str,
    ) -> Result<
        (CloudflareRouterEd25519YaoExecuteRequestV2, LocalEd25519YaoRecipientPrivateKeyV1),
        Box<dyn std::error::Error>,
    > {
        let router_env =
            fs::read_to_string(self.temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1))?;
        let fixture = ProductTenantRoot {
            tenant_root: CloudflareRouterEd25519YaoTenantRootV1 {
                identity: identity.clone(),
                custody_lineage_b64u: lineage.to_owned(),
            },
            application: RouterAbEd25519YaoApplicationBindingFactsV1::new(
                wallet_id,
                "ed25519ks_product_benchmark",
                identity.signing_root_id(),
                1,
            )?,
            participant_ids: [1, 2],
        };
        product_registration_request(&router_env, &fixture)
    }

    /// A second process for one Deriver on the same role store, listening on
    /// its own URL. It serves requests while the primary is busy.
    fn start_deriver_replica(
        &self,
        role: &str,
    ) -> Result<(ChildGuard, String), Box<dyn std::error::Error>> {
        let (env_file, primary_url) = match role {
            "deriver-a" => (router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1, &self.deriver_a_url),
            _ => (router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1, &self.deriver_b_url),
        };
        let replica_url = format!("http://127.0.0.1:{}", free_port()?);
        let primary_env = fs::read_to_string(self.temp.join(env_file))?;
        let replica_env = primary_env.replace(primary_url.as_str(), &replica_url);
        if replica_env == primary_env {
            return Err(format!("the {role} replica URL is missing from its environment").into());
        }
        let replica_env_path = self.temp.join(format!(".env.router-ab.{role}-replica.local"));
        fs::write(&replica_env_path, replica_env)?;
        let mut replica = ChildGuard::spawn_in_root(
            env!("CARGO_BIN_EXE_router_ab_local_worker"),
            role,
            replica_env_path,
            &self.temp,
        )?;
        wait_for_health(&replica_url, replica.child_mut())?;
        Ok((replica, replica_url))
    }

    fn registration(
        &self,
        identity: &TenantRootIdentityV1,
        lineage: &str,
    ) -> Result<CloudflareRouterEd25519YaoExecuteRequestV2, Box<dyn std::error::Error>> {
        let router_env =
            fs::read_to_string(self.temp.join(router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1))?;
        let fixture = ProductTenantRoot {
            tenant_root: CloudflareRouterEd25519YaoTenantRootV1 {
                identity: identity.clone(),
                custody_lineage_b64u: lineage.to_owned(),
            },
            application: RouterAbEd25519YaoApplicationBindingFactsV1::new(
                "account-product-benchmark",
                "ed25519ks_product_benchmark",
                "project:local",
                1,
            )?,
            participant_ids: [1, 2],
        };
        Ok(product_registration_request(&router_env, &fixture)?.0)
    }

    fn register(
        &self,
        registration: &CloudflareRouterEd25519YaoExecuteRequestV2,
    ) -> Result<(u16, String), Box<dyn std::error::Error>> {
        post_json_to_path_with_headers(
            &self.router_url,
            LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
            registration,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
        )
    }

    /// Each Deriver's role-share epochs and lifecycles for one lineage.
    #[allow(clippy::type_complexity)]
    fn epochs(&self, lineage: &str) -> rusqlite::Result<(Vec<(i64, String)>, Vec<(i64, String)>)> {
        let epochs = |db: &Connection| {
            db.prepare(
                "SELECT tenant_root_share_epoch, lifecycle FROM tenant_root_role_shares
                 WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch",
            )?
            .query_map([lineage], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()
        };
        Ok((epochs(&self.a_store)?, epochs(&self.b_store)?))
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
        proxies: &[&FaultProxyV1],
        grant: &str,
        lineage: &str,
        expected: (Option<String>, Option<String>),
    ) -> Result<String, Box<dyn std::error::Error>> {
        for proxy in proxies {
            proxy.drop_next();
        }
        let (status, body) = self.create(grant)?;
        assert_ne!(status, 200, "{body}");
        for proxy in proxies {
            assert!(proxy.dropped(), "the proxy must have dropped the delivery");
        }
        let receipt = self
            .committed_receipt(lineage)?
            .ok_or("the Router must have committed")?;
        assert_eq!(self.lifecycles(lineage)?, expected);
        Ok(receipt)
    }

    /// The Router's managed-restore fence for one lineage: its kind and, while
    /// it holds one, its attempt.
    fn managed_restore_fence(&self, lineage: &str) -> rusqlite::Result<(String, Option<String>)> {
        self.router_db.query_row(
            "SELECT json_extract(value_json, '$.managed_restore_fence.kind'),
                    json_extract(value_json, '$.managed_restore_fence.attempt')
             FROM local_tenant_root_creation_state
             WHERE storage_key = 'refresh/v1/active-state'
               AND json_extract(value_json, '$.custody_lineage_b64u') = ?1",
            [lineage],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
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

    /// Replays the refresh-activation request the control-plane proxy dropped,
    /// which has the control plane sign that attempt's receipt.
    fn reissue_dropped_refresh_activation(&self) -> Result<String, Box<dyn std::error::Error>> {
        let activation_request = self
            .proxy_control_plane
            .dropped_body()
            .ok_or("the control-plane refresh activation request must have been dropped")?;
        let (status, body) = post_bytes_to_path_with_headers(
            &self.control_plane_url,
            router_ab_cloudflare::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REFRESH_ACTIVATION_PRIVATE_REQUEST_PATH,
            &activation_request,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_ROLE_SHARED_SERVICE_AUTH)],
        )?;
        if status != 200 {
            return Err(format!("control-plane refresh reissue failed with {status}: {body}").into());
        }
        Ok(serde_json::from_str::<serde_json::Value>(&body)?["activation_receipt_b64u"]
            .as_str()
            .ok_or("the control plane must return an activation receipt")?
            .to_owned())
    }

    /// Each Deriver's stored managed backup and provider canary for one epoch
    /// of a lineage, as their exact bytes.
    #[allow(clippy::type_complexity)]
    fn epoch_objects(
        &self,
        lineage: &str,
        epoch: i64,
    ) -> rusqlite::Result<(Vec<Vec<u8>>, Vec<Vec<u8>>)> {
        let objects = |db: &Connection| {
            db.prepare(
                "SELECT canonical_bytes FROM local_tenant_root_managed_backups
                 WHERE instr(object_key, '/' || ?1 || '/') > 0
                   AND (object_key LIKE '%/' || ?2 || '.bin'
                        OR object_key LIKE '%/' || ?2 || '.provider-canary.bin')
                 ORDER BY object_key",
            )?
            .query_map(rusqlite::params![lineage, epoch], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<Vec<u8>>>>()
        };
        Ok((objects(&self.a_backups)?, objects(&self.b_backups)?))
    }

    /// The refresh attempts each Deriver recorded as superseded for one lineage.
    fn supersessions(&self, lineage: &str) -> rusqlite::Result<(i64, i64)> {
        let count = |db: &Connection| {
            db.query_row(
                "SELECT count(*) FROM tenant_root_refresh_supersessions
                 WHERE custody_lineage_b64u = ?1",
                [lineage],
                |row| row.get(0),
            )
        };
        Ok((count(&self.a_store)?, count(&self.b_store)?))
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
    dropped_body: Mutex<Option<Vec<u8>>>,
    drop_every_path: Mutex<Option<&'static str>>,
    drop_body: Mutex<Option<Vec<u8>>>,
    hold_path: Mutex<Option<&'static str>>,
    holding: AtomicBool,
    released: AtomicBool,
    hold_request_path: Mutex<Option<&'static str>>,
    lose_response_path: Mutex<Option<&'static str>>,
    lost_response: Mutex<Option<Vec<u8>>>,
    held_request: Mutex<Option<Vec<u8>>>,
    held_response: Mutex<Option<Vec<u8>>>,
    request_released: AtomicBool,
    captured: Mutex<Option<Vec<u8>>>,
    hold_stream_head: AtomicBool,
    stream_head_held: AtomicBool,
    stream_head_released: AtomicBool,
    hold_stream_body: AtomicBool,
    stream_body_held: AtomicBool,
    /// 0 while held, 1 to release the rest of the stream, 2 to cut it.
    stream_body_verdict: AtomicU8,
}

fn lock_proxy<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Forwards one peer's traffic. On `fault_path` it records the latest request
/// body, including one it drops, and, when armed, drops the next request
/// before the peer reads it. It can also drop the next request whose body
/// carries a marker, deliver the peer's response to one request only once
/// released, hold one request back from the peer until released, or let the
/// peer answer one request and lose that answer.
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

    /// The body of the last request `drop_next_on` dropped.
    fn dropped_body(&self) -> Option<Vec<u8>> {
        lock_proxy(&self.controls.dropped_body).clone()
    }

    /// Drops every request to `path`, as an unreachable peer would, until
    /// `stop_dropping` is called.
    fn drop_every_on(&self, path: &'static str) {
        *lock_proxy(&self.controls.drop_every_path) = Some(path);
    }

    fn stop_dropping(&self) {
        *lock_proxy(&self.controls.drop_every_path) = None;
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

    /// Holds the next request to `path` before the peer reads it, until
    /// `release_request` is called.
    fn hold_next_request_on(&self, path: &'static str) {
        *lock_proxy(&self.controls.held_request) = None;
        *lock_proxy(&self.controls.held_response) = None;
        self.controls.request_released.store(false, Ordering::SeqCst);
        *lock_proxy(&self.controls.hold_request_path) = Some(path);
    }

    /// Forwards the next request to `path`, lets the peer act on it and
    /// answer, then closes the caller's connection without the answer.
    fn lose_next_response_on(&self, path: &'static str) {
        *lock_proxy(&self.controls.lost_response) = None;
        *lock_proxy(&self.controls.lose_response_path) = Some(path);
    }

    /// The peer's answer that `lose_next_response_on` kept from the caller.
    fn lost_response(&self) -> Option<Vec<u8>> {
        lock_proxy(&self.controls.lost_response).clone()
    }

    /// The body of the request being held, once one is.
    fn held_request(&self) -> Option<Vec<u8>> {
        lock_proxy(&self.controls.held_request).clone()
    }

    fn release_request(&self) {
        self.controls.request_released.store(true, Ordering::SeqCst);
    }

    /// The peer's whole response to the held request, once it has answered.
    fn held_response(&self) -> Option<Vec<u8>> {
        lock_proxy(&self.controls.held_response).clone()
    }

    /// Whether the armed drop has happened.
    fn dropped(&self) -> bool {
        !self.controls.armed.load(Ordering::SeqCst)
    }

    /// Holds the peer's response head to the next streamed request, such as
    /// the Yao peer stream, until `release_stream_head` is called. The
    /// request itself and its body pass straight through.
    fn hold_next_stream_head(&self) {
        self.controls.stream_head_held.store(false, Ordering::SeqCst);
        self.controls.stream_head_released.store(false, Ordering::SeqCst);
        self.controls.hold_stream_head.store(true, Ordering::SeqCst);
    }

    /// Whether the peer has answered the held stream with its head.
    fn stream_head_held(&self) -> bool {
        self.controls.stream_head_held.load(Ordering::SeqCst)
    }

    fn release_stream_head(&self) {
        self.controls.stream_head_released.store(true, Ordering::SeqCst);
    }

    /// Delivers the peer's response head to the next streamed request at
    /// once, then holds the rest of its response until the stream is
    /// released or cut.
    fn hold_next_stream_body(&self) {
        self.controls.stream_body_held.store(false, Ordering::SeqCst);
        self.controls.stream_body_verdict.store(0, Ordering::SeqCst);
        self.controls.hold_stream_body.store(true, Ordering::SeqCst);
    }

    /// Whether the head has been delivered and the rest is held.
    fn stream_body_held(&self) -> bool {
        self.controls.stream_body_held.load(Ordering::SeqCst)
    }

    fn release_stream_body(&self) {
        self.controls.stream_body_verdict.store(1, Ordering::SeqCst);
    }

    /// Drops both sides of the held stream, as a lost connection would.
    fn cut_stream_body(&self) {
        self.controls.stream_body_verdict.store(2, Ordering::SeqCst);
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
        self.release_request();
        self.release_stream_head();
        self.release_stream_body();
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
    let chunked = head_text.lines().any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding")
                && value.trim().eq_ignore_ascii_case("chunked")
        })
    });
    if chunked {
        // A streamed body, such as the Yao peer stream, passes through
        // untouched in both directions, unless the peer's response head is
        // held.
        let mut upstream = TcpStream::connect(upstream)?;
        upstream.write_all(&request_head)?;
        let mut upstream_writer = upstream.try_clone()?;
        let pump = thread::spawn(move || {
            let _ = io::copy(&mut client_reader, &mut upstream_writer);
            let _ = upstream_writer.shutdown(Shutdown::Write);
        });
        let mut client_writer = client;
        let mut upstream_reader = BufReader::new(upstream);
        if controls.hold_stream_head.swap(false, Ordering::SeqCst) {
            let head = read_proxy_http_head(&mut upstream_reader)?;
            controls.stream_head_held.store(true, Ordering::SeqCst);
            while !controls.stream_head_released.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(5));
            }
            client_writer.write_all(&head)?;
        } else if controls.hold_stream_body.swap(false, Ordering::SeqCst) {
            let head = read_proxy_http_head(&mut upstream_reader)?;
            client_writer.write_all(&head)?;
            client_writer.flush()?;
            controls.stream_body_held.store(true, Ordering::SeqCst);
            loop {
                match controls.stream_body_verdict.load(Ordering::SeqCst) {
                    1 => break,
                    2 => {
                        let _ = client_writer.shutdown(Shutdown::Both);
                        let _ = upstream_reader.get_ref().shutdown(Shutdown::Both);
                        let _ = pump.join();
                        return Ok(());
                    }
                    _ => thread::sleep(Duration::from_millis(5)),
                }
            }
        }
        let copied = io::copy(&mut upstream_reader, &mut client_writer);
        let _ = client_writer.shutdown(Shutdown::Both);
        let _ = pump.join();
        return copied.map(|_| ());
    }
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
            *lock_proxy(&controls.dropped_body) = Some(body.clone());
            return client.shutdown(Shutdown::Both);
        }
    }
    if lock_proxy(&controls.drop_every_path).is_some_and(posts_to) {
        return client.shutdown(Shutdown::Both);
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
    let hold_request = {
        let mut hold_request_path = lock_proxy(&controls.hold_request_path);
        let hold = hold_request_path.is_some_and(posts_to);
        if hold {
            *hold_request_path = None;
        }
        hold
    };
    if hold_request {
        *lock_proxy(&controls.held_request) = Some(body.clone());
        while !controls.request_released.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
        }
    }
    let lose_response = {
        let mut lose_response_path = lock_proxy(&controls.lose_response_path);
        let lose = lose_response_path.is_some_and(posts_to);
        if lose {
            *lose_response_path = None;
        }
        lose
    };
    let mut upstream = TcpStream::connect(upstream)?;
    upstream.set_read_timeout(Some(Duration::from_secs(15)))?;
    upstream.set_write_timeout(Some(Duration::from_secs(15)))?;
    upstream.write_all(&request_head)?;
    upstream.write_all(&body)?;
    upstream.shutdown(Shutdown::Write)?;
    let mut client_writer = client;
    if lose_response {
        let mut response = Vec::new();
        upstream.read_to_end(&mut response)?;
        *lock_proxy(&controls.lost_response) = Some(response);
        return client_writer.shutdown(Shutdown::Both);
    }
    if hold_request {
        let mut response = Vec::new();
        upstream.read_to_end(&mut response)?;
        *lock_proxy(&controls.held_response) = Some(response.clone());
        client_writer.write_all(&response)?;
    } else if hold {
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
    // This wallet's signing operation, among any others the worker holds.
    let completed_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM local_signing_worker_near_round1
         WHERE state = 'completed' AND instr(prepare_json, ?1) > 0",
        [format!("product-near-sign-{}", activation.binding().lifecycle.account_id)],
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
    // One signing operation per wallet.
    let scope = NormalSigningScopeV1::new(
        format!("product-near-sign-{account_id}"),
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
            authorization_id: format!("authorization-{}", activation.binding().lifecycle.account_id),
            wallet_session_id: "wallet-session-product-benchmark".to_owned(),
            quota_id: format!("quota-{}", activation.binding().lifecycle.account_id),
            threshold_session_id: format!(
                "threshold-session-{}",
                activation.binding().lifecycle.account_id
            ),
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
    // The wallet this registration creates is the fixture's application
    // binding; its lifecycle identifiers follow from the wallet id.
    let application_binding = tenant_root_fixture.application.clone();
    let wallet_id = application_binding.wallet_id().to_owned();
    let wallet = wallet_id.strip_prefix("account-").unwrap_or(&wallet_id).to_owned();
    let application = Ed25519YaoApplicationBindingFactsV1::new(
        Ed25519YaoApplicationBindingWalletIdV1::parse(&wallet_id)?,
        Ed25519YaoApplicationBindingSigningKeyIdV1::parse(
            application_binding.near_ed25519_signing_key_id(),
        )?,
        Ed25519YaoApplicationBindingSigningRootIdV1::parse(application_binding.signing_root_id())?,
        Ed25519YaoApplicationBindingKeyCreationSignerSlotV1::new(
            application_binding.key_creation_signer_slot(),
        )?,
    );
    let context = Ed25519YaoStableKeyDerivationContextV1::new(application.digest(), 1, 2)?;
    let client_root = Ed25519YaoClientRootV1::from_secret_bytes(fresh_nonzero_bytes_32()?);
    let (client_a, client_b) =
        derive_ed25519_yao_client_contributions_v1(&client_root, &context)?.into_parts();
    let registration_id = format!("{wallet}-registration");
    let admission = admit_local_ed25519_yao_registration_v1(
        RouterAbEd25519YaoRegistrationAdmissionRequestV1::new(
            RouterAbEd25519YaoLifecycleScopeV1::new(
                registration_id.clone(),
                RootShareEpoch::new("local-root-v1")?,
                wallet_id.clone(),
                "wallet-session-product-benchmark",
                "signer-set-product-benchmark",
                "local-signing-worker",
                MpcMaterialActivationRefV1::new(
                    format!("activation-{wallet}"),
                    format!("capability-{wallet}"),
                    wallet_id.clone(),
                    format!("key-{wallet}"),
                    registration_id,
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
