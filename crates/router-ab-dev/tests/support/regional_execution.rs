use super::*;

type ProbeResult<T> = Result<T, Box<dyn std::error::Error>>;

struct RegionalStack {
    root: PathBuf,
    urls: [String; 4],
    roles: Vec<ChildGuard>,
}

const ROLES: [(&str, &str); 4] = [
    ("router", router_ab_dev::LOCAL_ROUTER_ENV_FILE_V1),
    ("deriver-a", router_ab_dev::LOCAL_DERIVER_A_ENV_FILE_V1),
    ("deriver-b", router_ab_dev::LOCAL_DERIVER_B_ENV_FILE_V1),
    (
        "signing-worker",
        router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1,
    ),
];

impl RegionalStack {
    fn empty(label: &str) -> ProbeResult<Self> {
        let mut urls = Vec::new();
        for _ in 0..4 {
            urls.push(format!("http://127.0.0.1:{}", free_port()?));
        }
        Ok(Self {
            root: temp_dir(label)?,
            urls: urls.try_into().map_err(|_| "expected four role URLs")?,
            roles: Vec::new(),
        })
    }

    fn start(&mut self) -> ProbeResult<()> {
        assert!(self.roles.is_empty());
        for ((role, env_file), url) in ROLES.iter().zip(&self.urls) {
            let mut process = ChildGuard::spawn_in_root(
                env!("CARGO_BIN_EXE_router_ab_local_worker"),
                role,
                self.root.join(env_file),
                &self.root,
            )?;
            wait_for_health(url, process.child_mut())?;
            self.roles.push(process);
        }
        Ok(())
    }

    fn restart(&mut self) -> ProbeResult<()> {
        self.roles.clear();
        self.start()
    }

    fn copy_stopped_installation(&self, target: &Self) -> ProbeResult<()> {
        assert!(self.roles.is_empty());
        assert!(target.roles.is_empty());
        assert_eq!(self.round1_count(None)?, 0);
        copy_fixture_directory(&self.root, &target.root)?;
        for (_, env_file) in ROLES {
            let path = target.root.join(env_file);
            let mut contents = fs::read_to_string(&path)?;
            for (source_url, target_url) in self.urls.iter().zip(&target.urls) {
                contents = contents.replace(source_url, target_url);
            }
            fs::write(path, contents)?;
        }
        assert_ne!(self.worker_store()?, target.worker_store()?);
        assert_eq!(target.round1_count(None)?, 0);
        Ok(())
    }

    fn worker_store(&self) -> ProbeResult<PathBuf> {
        let contents = fs::read_to_string(
            self.root
                .join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
        )?;
        let config = parse_local_worker_role_config_for_role_v1(
            LocalServiceRoleV1::SigningWorker,
            parse_local_env_file_contents_v1(&contents)?,
        )?;
        let LocalWorkerRoleConfigV1::SigningWorker(config) = config else {
            return Err("expected SigningWorker configuration".into());
        };
        Ok(self.root.join(config.role_private_storage_path))
    }

    fn round1_count(&self, state: Option<&str>) -> ProbeResult<i64> {
        let db = Connection::open(self.worker_store()?)?;
        Ok(db.query_row(
            "SELECT COUNT(*) FROM local_signing_worker_near_round1
             WHERE ?1 IS NULL OR state = ?1",
            [state],
            |row| row.get(0),
        )?)
    }

    fn request(&self, path: &str, body: &serde_json::Value) -> ProbeResult<String> {
        let (status, reply) = post_json_to_path_with_headers(
            &self.urls[0],
            path,
            body,
            &[(
                LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                TEST_GATEWAY_TO_ROUTER_AUTH,
            )],
        )?;
        assert_eq!(status, 200, "regional role request failed: {reply}");
        Ok(reply)
    }
}

impl Drop for RegionalStack {
    fn drop(&mut self) {
        self.roles.clear();
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn copy_fixture_directory(source: &Path, target: &Path) -> ProbeResult<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let destination = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_fixture_directory(&entry.path(), &destination)?;
        } else if entry.file_type()?.is_file() {
            fs::copy(entry.path(), destination)?;
        } else {
            return Err("fixture snapshot contains an unsupported file type".into());
        }
    }
    Ok(())
}

fn verify_regional_signature(
    reply: &str,
    public_key: &[u8; 32],
    unsigned: &[u8],
) -> ProbeResult<String> {
    use ed25519_dalek::Verifier;
    let signed: NormalSigningResponseV1 = serde_json::from_str(reply)?;
    let bytes: [u8; 64] = signed.signature.as_bytes().try_into()?;
    let signature = ed25519_dalek::Signature::from_bytes(&bytes);
    ed25519_dalek::VerifyingKey::from_bytes(public_key)?
        .verify(&Sha256::digest(unsigned), &signature)?;
    Ok(hex::encode(bytes))
}

#[test]
fn independent_role_stores_require_executor_bound_authorization() -> ProbeResult<()> {
    let _guard = local_worker_process_test_guard();
    let mut source = RegionalStack::empty("regional-source")?;
    let mut destination = RegionalStack::empty("regional-destination")?;
    let router_env = write_product_worker_envs(
        &source.root,
        &source.urls[0],
        &source.urls[1],
        &source.urls[2],
        &source.urls[3],
    )?;
    let tenant = provision_product_tenant_root(
        env!("CARGO_BIN_EXE_router_ab_local_worker"),
        &source.root,
        &source.urls[0],
        &source.urls[1],
        &source.urls[2],
    )?;
    source.start()?;
    let (registration, recipient) = product_registration_request(&router_env, &tenant)?;
    let registration_body = serde_json::to_value(&registration)?;
    let registration_reply =
        source.request(LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH, &registration_body)?;
    let RouterEd25519YaoExecuteResultV1::Succeeded { result } =
        serde_json::from_str(&registration_reply)?
    else {
        return Err("regional fixture registration failed".into());
    };
    let RouterEd25519YaoExecuteSuccessV1::Registration { result: activation } = *result else {
        return Err("expected a registration activation".into());
    };
    let (client_share, _) = complete_client_activation_packages_v1(
        activation.binding(),
        [1, 2],
        activation.public_receipt(),
        recipient.as_bytes(),
        activation.deriver_a_client_package(),
        activation.deriver_b_client_package(),
    )?;

    // Copy only this disposable fixture, before either store has signing nonces.
    source.roles.clear();
    source.copy_stopped_installation(&destination)?;
    source.start()?;
    destination.start()?;

    let now_ms = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?;
    let expires_at_ms = now_ms + 120_000;
    let (prepare, unsigned) = product_near_prepare_request(&activation, expires_at_ms)?;
    let authorized = product_near_gateway_authorized_operation(
        &activation,
        &tenant.tenant_root.identity,
        &prepare,
        expires_at_ms,
    )?;
    let prepare_body = gateway_signing_body(&prepare, &authorized)?;
    let barrier = Barrier::new(2);
    let (source_prepare, destination_prepare) = thread::scope(|scope| {
        let first = scope.spawn(|| {
            barrier.wait();
            source
                .request(LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH, &prepare_body)
                .map_err(|error| error.to_string())
        });
        barrier.wait();
        let second = destination.request(LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH, &prepare_body);
        (first.join(), second)
    });
    let source_prepared: NormalSigningRound1PrepareResponseV1 = serde_json::from_str(
        &source_prepare
            .map_err(|_| "source prepare thread panicked")?
            .map_err(io::Error::other)?,
    )?;
    let destination_prepared: NormalSigningRound1PrepareResponseV1 =
        serde_json::from_str(&destination_prepare?)?;
    assert_ne!(
        source_prepared.server_commitments,
        destination_prepared.server_commitments
    );
    let source_finalize = product_near_finalize_request(
        &activation,
        &client_share,
        &prepare,
        &source_prepared,
        expires_at_ms,
    )?;
    let destination_finalize = product_near_finalize_request(
        &activation,
        &client_share,
        &prepare,
        &destination_prepared,
        expires_at_ms,
    )?;
    let source_body = gateway_signing_body(&source_finalize, &authorized)?;
    let destination_body = gateway_signing_body(&destination_finalize, &authorized)?;
    let proxy = FaultProxyV1::start(&source.urls[0], LOCAL_ROUTER_NORMAL_SIGNING_PATH)?;
    proxy.lose_next_response_on(LOCAL_ROUTER_NORMAL_SIGNING_PATH);
    let lost = post_json_to_path_with_headers(
        &proxy.url,
        LOCAL_ROUTER_NORMAL_SIGNING_PATH,
        &source_body,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    );
    assert!(lost.is_err(), "the proxy must lose the committed result");
    let hidden_reply = proxy
        .lost_response()
        .ok_or("proxy did not record a lost response")?;
    assert!(hidden_reply.starts_with(b"HTTP/1.1 200 "));
    assert_eq!(source.round1_count(Some("completed"))?, 1);
    drop(proxy);
    let destination_reply =
        destination.request(LOCAL_ROUTER_NORMAL_SIGNING_PATH, &destination_body)?;
    source.restart()?;
    let source_reply = source.request(LOCAL_ROUTER_NORMAL_SIGNING_PATH, &source_body)?;
    let hidden_body_start = hidden_reply
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("lost response lacks HTTP header terminator")?
        + 4;
    assert_eq!(source_reply.as_bytes(), &hidden_reply[hidden_body_start..]);
    let public_key = activation.public_receipt().registered_public_key();
    let source_signature = verify_regional_signature(&source_reply, &public_key, &unsigned)?;
    let destination_signature =
        verify_regional_signature(&destination_reply, &public_key, &unsigned)?;
    assert_ne!(source_signature, destination_signature);
    assert_eq!(source.round1_count(Some("completed"))?, 1);
    assert_eq!(destination.round1_count(Some("completed"))?, 1);

    source.restart()?;
    destination.restart()?;
    assert_eq!(
        source.request(LOCAL_ROUTER_NORMAL_SIGNING_PATH, &source_body)?,
        source_reply
    );
    assert_eq!(
        destination.request(LOCAL_ROUTER_NORMAL_SIGNING_PATH, &destination_body)?,
        destination_reply
    );
    assert_eq!(source.round1_count(Some("completed"))?, 1);
    assert_eq!(destination.round1_count(Some("completed"))?, 1);

    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = root.join(".artifacts/r155/independent-execution");
    fs::create_dir_all(&output)?;
    let revision = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&root)
        .output()?;
    assert!(revision.status.success());
    let evidence = json!({
        "kind": "independent_role_execution_feasibility_v1",
        "revision": String::from_utf8(revision.stdout)?.trim(),
        "runner_sha256": hex::encode(Sha256::digest(include_bytes!("regional_execution.rs"))),
        "reproduce": "cargo test --offline --locked --manifest-path crates/router-ab-dev/Cargo.toml --test local_worker_http regional_execution::independent_role_stores_require_executor_bound_authorization -- --exact",
        "scope": "Two local VM Router/Deriver A/Deriver B/SigningWorker process stacks with separate stores; same logical identities and fixture secrets. Real registration and Ed25519 signing. The driver supplies one Gateway-shaped authorization and client contributions. No SDK devices, permission service, Cloudflare deployment, or geographic measurement.",
        "public_key_hex": hex::encode(public_key),
        "unsigned_transaction_hex": hex::encode(unsigned),
        "signatures_hex": [source_signature, destination_signature],
        "verified_signature_count": 2,
        "source_signing_nonce_rows_at_snapshot": 0,
        "independent_fresh_server_commitments": true,
        "same_gateway_authorization": true,
        "same_operation_id": true,
        "concurrent_prepare_requests": true,
        "source_result_lost_after_http_200_commit": true,
        "completed_rows_per_region": [1, 1],
        "all_eight_role_processes_restarted": true,
        "each_region_replayed_its_own_exact_result": true,
        "gate_observation": "Current logical-role authorization permits two independent stores to execute the same admitted operation. R155 needs a physical executor assignment enforced by the roles before this topology is safe.",
        "limitations": ["One founding client share only", "Ed25519 only", "No revocation or wallet recovery", "No global allowance assertion", "No prepared signing nonces were copied", "Fixture snapshot is not a supported installation API"]
    });
    fs::write(
        output.join("evidence.json"),
        serde_json::to_string_pretty(&evidence)? + "\n",
    )?;
    println!(
        "Independent execution observation: {}",
        output.join("evidence.json").display()
    );
    Ok(())
}
