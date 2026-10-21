// Storage E2E: real PostgreSQL, runtime credentials, encrypted records, and signed commands.
// Run through scripts/test-postgres-role-store.mjs, which owns a disposable local database.

use super::*;
use crate::{apply_postgres_role_store_schema_v1, PostgresRoleSqlSessionV1};
use serde_json::json;
use tokio_postgres::{Client, Config, NoTls};

mod lifecycle;
mod protocol_proxy;

type Store = TenantRootRoleShareStoreV1<PostgresRoleSqlSessionV1>;

async fn connect(variable: &str) -> Client {
    let config: Config = std::env::var(variable)
        .expect("E2E database URL")
        .parse()
        .expect("database config");
    connect_config(&config).await
}

async fn connect_config(config: &Config) -> Client {
    let (client, connection) = config
        .connect(NoTls)
        .await
        .expect("local PostgreSQL connection");
    tokio::spawn(connection);
    client
}

async fn store(variable: &str, role: CloudflareTenantRootDeriverRoleV1) -> Store {
    store_with_client(connect(variable).await, role).await
}

async fn traced_store(
    variable: &str,
    role: CloudflareTenantRootDeriverRoleV1,
) -> (Store, protocol_proxy::ProtocolProbe) {
    let mut config: Config = std::env::var(variable)
        .expect("E2E database URL")
        .parse()
        .expect("database config");
    config.options("-c standard_conforming_strings=off");
    let (client, probe) = protocol_proxy::connect(&config).await;
    probe.reset();
    let store = store_with_client(client, role).await;
    assert_eq!(probe.exchanges(), 1, "one role check per new session");
    (store, probe)
}

async fn store_with_client(client: Client, role: CloudflareTenantRootDeriverRoleV1) -> Store {
    let session = PostgresRoleSqlSessionV1::new(client, role)
        .await
        .expect("role session");
    TenantRootRoleShareStoreV1 {
        session,
        cipher: test_cipher(role, 0x41 + role.share_id() as u8),
    }
}

fn creation(role: CloudflareTenantRootDeriverRoleV1) -> CloudflareTenantRootInitialCreationInputV1 {
    let context = test_creation_context();
    let evidence = test_initial_creation_evidence(&context, core_role(role));
    let sealed = test_sealed_online_share(&context, &evidence, core_role(role));
    CloudflareTenantRootInitialCreationInputV1::new(
        test_verified_initial_creation_command(core_role(role), 20, 100),
        evidence,
        CloudflareTenantRootInitialCreationShareInputV1::new(test_identity(), sealed, 10),
    )
    .expect("verified creation input")
}

fn scope(record: &CloudflareTenantRootRoleShareRecordV1, seed: u8) -> TenantRootCommandScopeV1 {
    let identity = record.identity().digest().expect("identity digest");
    let session = TenantRootCeremonySessionIdV1::from_bytes([seed; 16]).expect("session");
    let nonce = TenantRootCeremonyNonceV1::from_bytes([seed; 32]).expect("nonce");
    let key = match record.role() {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
            identity,
            record.custody_lineage(),
            session,
            nonce,
        ),
        CloudflareTenantRootDeriverRoleV1::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
            identity,
            record.custody_lineage(),
            session,
            nonce,
        ),
    };
    TenantRootCommandScopeV1::new(key, record.epoch(), 1).expect("command scope")
}

fn success_receipt(
    executed: &ExecutedTenantRootCommandV1,
    payload: &[u8],
    at: u64,
) -> VerifiedTenantRootCommandSuccessReceiptV1 {
    let key = SigningKey::from_bytes(&[0x31; 32]);
    let signed = TenantRootCommandTerminalReceiptV1::sign_success(
        *executed.key(),
        executed.command_digest(),
        payload.to_vec(),
        at,
        "postgres-e2e-command-key",
        key.as_bytes(),
    )
    .expect("signed terminal receipt");
    let bytes = signed.canonical_bytes().expect("receipt bytes");
    TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&bytes)
        .expect("decoded receipt")
        .verify_success(
            executed,
            "postgres-e2e-command-key",
            key.verifying_key().as_bytes(),
        )
        .expect("verified receipt")
}

async fn pending_creation(
    store: &Store,
    role: CloudflareTenantRootDeriverRoleV1,
) -> CloudflareTenantRootInitialCreationPendingCommandV1 {
    match store
        .reserve_initial_creation_pending(creation(role), 25)
        .await
        .expect("reserve creation")
    {
        CloudflareTenantRootInitialCreationDecisionV1::Execute { command }
        | CloudflareTenantRootInitialCreationDecisionV1::ResumeExecution { command } => command,
        _ => panic!("creation must be executable"),
    }
}

async fn create_and_activate(
    store: &Store,
    role: CloudflareTenantRootDeriverRoleV1,
) -> CloudflareStoredTenantRootRoleShareV1 {
    let command = pending_creation(store, role).await;
    let (pending, executed) = store
        .insert_initial_creation_pending(command, 26)
        .await
        .expect("persist encrypted pending share");
    let payload = executed.evidence.canonical_bytes();
    let receipt = success_receipt(&executed.executed, payload, 27);
    let expected_bytes = receipt.canonical_bytes().to_vec();
    match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => {
            let config: Config = std::env::var("POSTGRES_ROLE_E2E_A_URL")
                .expect("A URL")
                .parse()
                .expect("A config");
            let (client, mut proxy) = protocol_proxy::connect(&config).await;
            let through_proxy = store_with_client(client, role).await;
            proxy.drop_next_commit();
            assert!(
                through_proxy
                    .complete_initial_creation(executed, receipt)
                    .await
                    .is_err(),
                "lost COMMIT acknowledgement must remain an uncertain outcome"
            );
            proxy.assert_committed_fault().await;
        }
        CloudflareTenantRootDeriverRoleV1::DeriverB => {
            store
                .complete_initial_creation(executed, receipt)
                .await
                .expect("terminalize creation");
        }
    }
    match store
        .reserve_initial_creation_pending(creation(role), 28)
        .await
        .expect("creation replay")
    {
        CloudflareTenantRootInitialCreationDecisionV1::ReplayCompleted { receipt_bytes } => {
            assert_eq!(receipt_bytes, expected_bytes)
        }
        _ => panic!("completed creation must replay its exact receipt"),
    }
    let activation = current_backup_activation_for_record(&pending.record, 0x88, 0x89, 20);
    let activation_scope = scope(&pending.record, 0x71);
    let command = match store
        .reserve_activate_initial_pending(
            activation_scope,
            pending.clone(),
            activation.clone(),
            30,
            29,
        )
        .await
        .expect("reserve activation")
    {
        CloudflareTenantRootActivateInitialPendingDecisionV1::Execute { command } => command,
        _ => panic!("activation must be executable"),
    };
    let (active, executed) = store
        .activate_initial_pending(command, 30)
        .await
        .expect("activate");
    let receipt = success_receipt(&executed, activation.activation_receipt_bytes(), 31);
    store
        .complete_activation(executed, &activation, receipt)
        .await
        .expect("activation receipt");
    active
}

async fn checkpoint_rollback(store: &Store, admin: &Client) {
    let role = CloudflareTenantRootDeriverRoleV1::DeriverA;
    let pending =
        record_for_identity_epoch(test_identity(), role, 0x44, epoch(2), test_commitment(role));
    let command = match store
        .reserve_insert_pending(scope(&pending, 0x74), pending, 40)
        .await
        .expect("reserve rollback probe")
    {
        CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => command,
        _ => panic!("rollback probe must be executable"),
    };
    let before = store
        .load_epoch(&test_identity(), record(role).custody_lineage(), epoch(1))
        .await
        .expect("active row before fault");
    admin
        .batch_execute(
            "CREATE FUNCTION skip_checkpoint() RETURNS TRIGGER LANGUAGE plpgsql AS $$
         BEGIN IF NEW.status = 'executed' THEN RETURN NULL; END IF; RETURN NEW; END $$;
         CREATE TRIGGER skip_checkpoint BEFORE UPDATE ON tenant_root_command_replays
         FOR EACH ROW EXECUTE FUNCTION skip_checkpoint();",
        )
        .await
        .expect("inject zero-row checkpoint");
    let result = store.insert_pending(command, 41).await;
    assert!(
        result.is_err(),
        "missed checkpoint must abort the transaction"
    );
    assert!(store
        .load_epoch(&test_identity(), record(role).custody_lineage(), epoch(2))
        .await
        .expect("read after rollback")
        .is_none());
    assert_eq!(
        store
            .load_epoch(&test_identity(), record(role).custody_lineage(), epoch(1))
            .await
            .expect("active row after fault"),
        before
    );
    let rows = admin
        .query(
            "SELECT status, executed_at_ms FROM tenant_root_command_replays WHERE nonce_hex = $1",
            &[&encode_hex(&[0x74; 32])],
        )
        .await
        .expect("reserved replay");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get::<_, String>(0), "reserved");
    assert_eq!(rows[0].get::<_, Option<i64>>(1), None);
    admin.batch_execute("DROP TRIGGER skip_checkpoint ON tenant_root_command_replays; DROP FUNCTION skip_checkpoint();").await.expect("remove fault");
}

async fn root_admissions(store: &Store, probe: &protocol_proxy::ProtocolProbe) {
    let binding = test_custody_binding();
    let cancelled = TenantRootRootUseAttemptV1::Ed25519YaoPairSession {
        session: [0x01; 32],
        pair_object: None,
    };
    probe.reset();
    assert!(matches!(
        store
            .load_bound(&binding, &cancelled, 41)
            .await
            .expect("admit"),
        TenantRootBoundShareV1::Readable(_)
    ));
    assert_eq!(
        probe.exchanges(),
        2,
        "admission preserves D1's two exchanges"
    );
    store
        .cancel_unclaimed_root_use_admissions(
            binding.identity_digest(),
            binding.custody_lineage(),
            epoch(1),
            41,
        )
        .await
        .expect("cancel unclaimed");
    assert!(matches!(
        store
            .load_bound(&binding, &cancelled, 42)
            .await
            .expect("read cancelled"),
        TenantRootBoundShareV1::Cancelled
    ));
    let claimed = TenantRootRootUseAttemptV1::Ed25519YaoPairSession {
        session: [0x02; 32],
        pair_object: None,
    };
    assert!(matches!(
        store
            .load_bound(&binding, &claimed, 43)
            .await
            .expect("admit claim"),
        TenantRootBoundShareV1::Readable(_)
    ));
    let session_hex = encode_hex(&[0x02; 32]);
    let claim = store
        .session
        .prepare(TENANT_ROOT_CLAIM_ROOT_USE_ADMISSION_SQL_V1)
        .bind_refs(
            [
                RoleSqlValue::Text(store.cipher.role.as_str()),
                RoleSqlValue::Text(TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1),
                RoleSqlValue::Text(&session_hex),
            ]
            .iter(),
        )
        .expect("claim bindings");
    store
        .session
        .transaction(vec![claim.expect_changes(1)])
        .await
        .expect("claim admission");
    store
        .cancel_unclaimed_root_use_admissions(
            binding.identity_digest(),
            binding.custody_lineage(),
            epoch(1),
            43,
        )
        .await
        .expect("recovery preserves claim");
    assert!(matches!(
        store
            .load_bound(&binding, &claimed, 44)
            .await
            .expect("read claimed"),
        TenantRootBoundShareV1::Readable(_)
    ));
    let settlement = store
        .session
        .prepare(TENANT_ROOT_SETTLE_ROOT_USE_ADMISSION_SQL_V1)
        .bind_refs(
            [
                RoleSqlValue::Text(store.cipher.role.as_str()),
                RoleSqlValue::Text(TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1),
                RoleSqlValue::Text(&session_hex),
            ]
            .iter(),
        )
        .expect("pair-completion bindings");
    store
        .session
        .transaction(vec![settlement.expect_changes(1)])
        .await
        .expect("pair completion settles its claim");
    assert_eq!(
        store
            .unsettled_root_use_admissions(
                binding.identity_digest(),
                binding.custody_lineage(),
                epoch(1)
            )
            .await
            .expect("unsettled count"),
        0
    );
}

fn postgres_refresh_context() -> TenantRootCeremonyContextV1 {
    test_refresh_context_with_identity(test_identity(), 0x44, 1, 2, 0x75, 0x76)
}

fn refreshed_share(
    role: CloudflareTenantRootDeriverRoleV1,
) -> (
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    TenantRootSealedOnlineRoleShareV1,
) {
    let context = postgres_refresh_context();
    let evidence = test_signed_installation_evidence(&context, core_role(role), 18, 31);
    let scalar = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => 18_u64,
        CloudflareTenantRootDeriverRoleV1::DeriverB => 31_u64,
    };
    let share = SigningRootShare::from_canonical_bytes(
        core_role(role).share_id(),
        Scalar::from(scalar).to_bytes(),
    )
    .expect("refreshed share");
    let binding = TenantRootOnlineRoleShareBindingV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        core_role(role),
        epoch(2),
        pair_commitment(role, scalar),
        "kms://deriver/tenant/epoch-2",
        &evidence,
    )
    .expect("refreshed online binding");
    let sealed = TenantRootOnlineRoleShareSealRequestV1::new(
        binding,
        SigningRootShareWire::from_share(&share),
    )
    .expect("seal request")
    .complete(vec![0x67; 96])
    .expect("sealed refreshed share");
    (evidence, sealed)
}

fn refresh_activation(
    record: &CloudflareTenantRootRoleShareRecordV1,
    current: &TenantRootEpochCommitmentsV1,
) -> (
    CloudflareTenantRootActivationV1,
    VerifiedTenantRootSignedActivationReceiptV1,
) {
    let context = postgres_refresh_context();
    let target = TenantRootEpochCommitmentsV1::new(
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 18),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 31),
    )
    .expect("new commitments preserve the public root");
    assert_eq!(target.root_commitment(), current.root_commitment());
    let bundle =
        test_refresh_activation_bundle_for_context(&context, current, &target, 18, 31, 0x88, 0x8a);
    let key = SigningKey::from_bytes(&[0x89; 32]);
    let authority = TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]);
    let signed = TenantRootSignedActivationReceiptV1::sign_refresh_swap(
        &bundle,
        60,
        authority,
        "postgres-refresh-issuer",
        key.as_bytes(),
    )
    .expect("sign refresh activation");
    let receipt_bytes = signed.canonical_bytes().expect("refresh receipt bytes");
    let verified = signed
        .verify_refresh_swap(
            &bundle,
            60,
            authority,
            "postgres-refresh-issuer",
            key.verifying_key().as_bytes(),
        )
        .expect("verify refresh activation");
    let role = record.role();
    let own_evidence = test_signed_installation_evidence(&context, core_role(role), 18, 31);
    let (scalar, backup_seed) = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => (18, 0x88),
        CloudflareTenantRootDeriverRoleV1::DeriverB => (31, 0x89),
    };
    let own_backup = test_verified_managed_backup(
        &context,
        core_role(role),
        scalar,
        backup_seed,
        &own_evidence,
    );
    let activation =
        CloudflareTenantRootActivationV1::with_current_role_backup(record, &own_backup, verified)
            .expect("refresh activation");
    let retained = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("retained signed receipt")
        .verify_refresh_swap(
            &bundle,
            60,
            authority,
            "postgres-refresh-issuer",
            key.verifying_key().as_bytes(),
        )
        .expect("retained verified receipt");
    (activation, retained)
}

async fn successor_pending(
    store: &Store,
    pair: &TenantRootActiveRootPairV1,
) -> CloudflareStoredTenantRootRoleShareV1 {
    let role = store.cipher.role;
    let context = postgres_refresh_context();
    let key = SigningKey::from_bytes(&[0x47; 32]);
    let authority = TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]);
    let command = TenantRootRoleRefreshCommandV1::sign(
        pair,
        &context,
        core_role(role),
        1,
        authority,
        40,
        90,
        "postgres-refresh-command",
        key.as_bytes(),
    )
    .expect("signed refresh command")
    .verify(
        pair,
        &context,
        core_role(role),
        1,
        authority,
        "postgres-refresh-command",
        key.verifying_key().as_bytes(),
    )
    .expect("verified refresh command");
    let (evidence, sealed) = refreshed_share(role);
    let backup = test_verified_managed_backup(
        &context,
        core_role(role),
        match role {
            CloudflareTenantRootDeriverRoleV1::DeriverA => 18,
            CloudflareTenantRootDeriverRoleV1::DeriverB => 31,
        },
        0x88,
        &evidence,
    );
    let target = TenantRootEpochCommitmentsV1::new(
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 18),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 31),
    )
    .expect("refresh commitments");
    let canary = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        epoch(2),
        &target,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        0x8a,
    );
    let signed_canary =
        TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(canary.canonical_bytes())
            .expect("signed canary");
    let prepared = CloudflareTenantRootRefreshPreparedArtifactsV1::new(&backup, &signed_canary)
        .expect("prepared artifacts");
    let admission = match store
        .admit_refresh(&command, 50)
        .await
        .expect("admit refresh")
    {
        CloudflareTenantRootRefreshAdmissionDecisionV1::Execute { admission, .. } => admission,
        _ => panic!("fresh refresh admission"),
    };
    let refresh = CloudflareTenantRootRefreshInputV1::new(
        command,
        evidence,
        CloudflareTenantRootRefreshShareInputV1::new(test_identity(), sealed, 50),
    )
    .expect("verified refresh input");
    let (pending, _) = store
        .persist_refresh_pending(admission, refresh, prepared, 51, None)
        .await
        .expect("persist refresh and durable artifacts");
    pending
}

async fn swap_checkpoint_rollback(
    store: &Store,
    admin: &Client,
    active: &CloudflareStoredTenantRootRoleShareV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    command: CloudflareTenantRootSwapActiveEpochCommandV1,
) {
    let nonce = encode_hex(&[0x73; 32]);
    let replay_before = admin
        .query_one(
            "SELECT status, executed_at_ms, row_to_json(replay)::TEXT
             FROM tenant_root_command_replays AS replay WHERE nonce_hex = $1",
            &[&nonce],
        )
        .await
        .expect("reserved swap replay");
    assert_eq!(replay_before.get::<_, String>(0), "reserved");
    assert_eq!(replay_before.get::<_, Option<i64>>(1), None);
    admin
        .batch_execute(
            "CREATE FUNCTION skip_swap_checkpoint() RETURNS TRIGGER LANGUAGE plpgsql AS $$
             BEGIN
               IF NEW.status = 'executed' AND NEW.nonce_hex = repeat('73', 32) THEN
                 RETURN NULL;
               END IF;
               RETURN NEW;
             END $$;
             CREATE TRIGGER skip_swap_checkpoint BEFORE UPDATE ON tenant_root_command_replays
             FOR EACH ROW EXECUTE FUNCTION skip_swap_checkpoint();",
        )
        .await
        .expect("inject missed swap checkpoint");
    assert!(
        store.swap_active_epoch(command, 60).await.is_err(),
        "missed swap checkpoint must roll back retirement and activation"
    );
    for original in [active, pending] {
        assert_eq!(
            store
                .load_epoch(
                    &test_identity(),
                    original.record.custody_lineage(),
                    original.record.epoch(),
                )
                .await
                .expect("epoch after failed swap"),
            Some(original.clone()),
            "each epoch must retain its original lifecycle, revision, and encrypted record"
        );
    }
    let replay_after = admin
        .query_one(
            "SELECT row_to_json(replay)::TEXT
             FROM tenant_root_command_replays AS replay WHERE nonce_hex = $1",
            &[&nonce],
        )
        .await
        .expect("swap replay after rollback");
    assert_eq!(
        replay_after.get::<_, String>(0),
        replay_before.get::<_, String>(2),
        "the reserved replay must remain unchanged"
    );
    admin
        .batch_execute(
            "DROP TRIGGER skip_swap_checkpoint ON tenant_root_command_replays;
             DROP FUNCTION skip_swap_checkpoint();",
        )
        .await
        .expect("remove swap fault");
}

async fn rotate(
    store: &Store,
    admin: &Client,
    probe: &protocol_proxy::ProtocolProbe,
    active: CloudflareStoredTenantRootRoleShareV1,
    pair: &TenantRootActiveRootPairV1,
    current: &TenantRootEpochCommitmentsV1,
) -> (
    CloudflareStoredTenantRootRoleShareV1,
    CloudflareStoredTenantRootRoleShareV1,
    VerifiedTenantRootSignedActivationReceiptV1,
) {
    let pending = successor_pending(store, pair).await;
    let (activation, retained_receipt) = refresh_activation(&pending.record, current);
    let retirement = CloudflareTenantRootRetirementV1::new(
        lifecycle_receipt(0x76).expect("retirement receipt"),
        60,
    )
    .expect("retirement");
    let command = match store
        .reserve_swap_active_epoch(
            scope(&pending.record, 0x73),
            active.clone(),
            pending.clone(),
            activation.clone(),
            retirement.clone(),
            60,
            59,
        )
        .await
        .expect("reserve swap")
    {
        CloudflareTenantRootSwapActiveEpochDecisionV1::Execute { command } => command,
        _ => panic!("swap must be executable"),
    };
    swap_checkpoint_rollback(store, admin, &active, &pending, command).await;
    let command = match store
        .reserve_swap_active_epoch(
            scope(&pending.record, 0x73),
            active,
            pending,
            activation.clone(),
            retirement,
            60,
            59,
        )
        .await
        .expect("resume rolled-back swap")
    {
        CloudflareTenantRootSwapActiveEpochDecisionV1::ResumeExecution { command } => command,
        _ => panic!("rolled-back swap must resume execution"),
    };
    probe.reset();
    let ((retired, activated), executed) = store
        .swap_active_epoch(command, 60)
        .await
        .expect("atomic retire and activate");
    assert_eq!(
        probe.exchanges(),
        1,
        "all three mutations share one exchange"
    );
    let receipt = success_receipt(&executed, activation.activation_receipt_bytes(), 61);
    store
        .complete_activation(executed, &activation, receipt)
        .await
        .expect("complete swap");
    (retired, activated, retained_receipt)
}

async fn wait_for_advisory_waiter(admin: &Client, key: i64) {
    for _ in 0..500 {
        let row = admin.query_one("SELECT COUNT(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::BIGINT = $1", &[&key]).await.expect("advisory waiter");
        if row.get::<_, i64>(0) > 0 {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("transaction never reached its rendezvous");
}

async fn concurrent_write(admin: &Client, key: i64) {
    wait_for_advisory_waiter(admin, key).await;
    admin
        .execute(
            "UPDATE role_store_e2e_counter SET value = value + 1 WHERE id = 1",
            &[],
        )
        .await
        .expect("concurrent commit");
    admin
        .query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .await
        .expect("release reader");
}

async fn read_between_attempts(store: &Store, admin: &Client, key: i64) {
    wait_for_advisory_waiter(admin, key).await;
    let statement = store
        .session
        .prepare("SELECT value FROM role_store_e2e_counter WHERE id = 1");
    let queued_read = statement.first::<serde_json::Value>(None);
    tokio::pin!(queued_read);
    assert!(
        futures::poll!(queued_read.as_mut()).is_pending(),
        "the competing reader must queue while the first attempt owns the session"
    );
    concurrent_write(admin, key).await;
    assert_eq!(
        queued_read
            .await
            .expect("read during retry delay")
            .expect("counter row")["value"],
        1,
        "rollback must release the session before the second attempt increments to two"
    );
}

async fn snapshot_and_retry(store: &Store, admin: &Client, probe: &protocol_proxy::ProtocolProbe) {
    let key = 315_701_i64;
    admin
        .query_one("SELECT pg_advisory_lock($1)", &[&key])
        .await
        .expect("hold reader");
    let key_text = key.to_string();
    let first = store
        .session
        .prepare("SELECT value FROM role_store_e2e_counter WHERE id = 1");
    let rendezvous = store
        .session
        .prepare("SELECT 1 AS locked FROM pg_advisory_xact_lock($1)")
        .bind_refs([RoleSqlValue::Text(&key_text)].iter())
        .expect("rendezvous");
    let last = store
        .session
        .prepare("SELECT value FROM role_store_e2e_counter WHERE id = 1");
    let read = store
        .session
        .transaction(vec![first.into(), rendezvous.into(), last.into()]);
    probe.reset();
    let (read, ()) = tokio::join!(read, concurrent_write(admin, key));
    let read = read.expect("coherent snapshot");
    assert_eq!(
        probe.exchanges(),
        1,
        "three snapshot reads share one exchange"
    );
    assert_eq!(
        read[0].results::<serde_json::Value>().expect("first value")[0]["value"],
        0
    );
    assert_eq!(
        read[2].results::<serde_json::Value>().expect("last value")[0]["value"],
        0
    );
    admin
        .execute(
            "UPDATE role_store_e2e_counter SET value = 0 WHERE id = 1",
            &[],
        )
        .await
        .expect("reset counter");
    admin
        .query_one("SELECT pg_advisory_lock($1)", &[&key])
        .await
        .expect("hold writer");
    let first = store
        .session
        .prepare("SELECT value FROM role_store_e2e_counter WHERE id = 1");
    let rendezvous = store
        .session
        .prepare("SELECT 1 AS locked FROM pg_advisory_xact_lock($1)")
        .bind_refs([RoleSqlValue::Text(&key_text)].iter())
        .expect("rendezvous");
    let update = store
        .session
        .prepare("UPDATE role_store_e2e_counter SET value = value + 1 WHERE id = 1");
    let transaction = store.session.transaction(vec![
        first.into(),
        rendezvous.into(),
        update.expect_changes(1),
    ]);
    probe.reset();
    let (result, ()) = tokio::join!(transaction, read_between_attempts(store, admin, key));
    let result = result.expect("serialization retries the complete transaction");
    assert_eq!(
        probe.exchanges(),
        3,
        "two transaction attempts and the competing reader use three exchanges"
    );
    assert_eq!(
        result[0]
            .results::<serde_json::Value>()
            .expect("retried read")[0]["value"],
        1
    );
    assert_eq!(
        admin
            .query_one("SELECT value FROM role_store_e2e_counter WHERE id = 1", &[])
            .await
            .expect("final counter")
            .get::<_, i64>(0),
        2
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn postgres_role_store_e2e() {
    let mut admin_a = connect("POSTGRES_ROLE_E2E_ADMIN_A_URL").await;
    let mut admin_b = connect("POSTGRES_ROLE_E2E_ADMIN_B_URL").await;
    apply_postgres_role_store_schema_v1(&mut admin_a, CloudflareTenantRootDeriverRoleV1::DeriverA)
        .await
        .expect("A schema");
    apply_postgres_role_store_schema_v1(&mut admin_b, CloudflareTenantRootDeriverRoleV1::DeriverB)
        .await
        .expect("B schema");
    admin_a.batch_execute("CREATE TABLE role_store_e2e_counter (id INTEGER PRIMARY KEY, value BIGINT NOT NULL); INSERT INTO role_store_e2e_counter VALUES (1, 0); GRANT USAGE ON SCHEMA public TO runtime_a; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO runtime_a;").await.expect("A runtime grants");
    admin_b.batch_execute("GRANT USAGE ON SCHEMA public TO runtime_b; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO runtime_b;").await.expect("B runtime grants");
    let (a, probe_a) = traced_store(
        "POSTGRES_ROLE_E2E_A_URL",
        CloudflareTenantRootDeriverRoleV1::DeriverA,
    )
    .await;
    let (b, probe_b) = traced_store(
        "POSTGRES_ROLE_E2E_B_URL",
        CloudflareTenantRootDeriverRoleV1::DeriverB,
    )
    .await;
    assert!(PostgresRoleSqlSessionV1::new(
        connect("POSTGRES_ROLE_E2E_A_URL").await,
        CloudflareTenantRootDeriverRoleV1::DeriverB
    )
    .await
    .is_err());
    let mut wrong_database: Config = std::env::var("POSTGRES_ROLE_E2E_A_URL")
        .expect("A URL")
        .parse()
        .expect("A config");
    wrong_database.dbname("role_b");
    assert!(
        wrong_database.connect(NoTls).await.is_err(),
        "A credentials cannot open B's database"
    );
    let active_a = create_and_activate(&a, CloudflareTenantRootDeriverRoleV1::DeriverA).await;
    let active_b = create_and_activate(&b, CloudflareTenantRootDeriverRoleV1::DeriverB).await;
    for _ in 0..2 {
        probe_a.reset();
        assert_eq!(
            a.load_epoch(
                &test_identity(),
                active_a.record.custody_lineage(),
                epoch(1)
            )
            .await
            .expect("single-exchange read"),
            Some(active_a.clone())
        );
        assert_eq!(
            probe_a.exchanges(),
            1,
            "first and repeated reads use one exchange"
        );
    }
    let hostile = "'; COMMIT; DROP TABLE tenant_root_role_shares; --\\\n日本語 $2";
    let parameters = [
        RoleSqlValue::Null,
        RoleSqlValue::Text(hostile),
        RoleSqlValue::Null,
    ];
    probe_a.reset();
    let echoed = a
        .session
        .prepare(
            "SELECT $2::TEXT AS value, $2::TEXT AS repeated, $3::TEXT AS empty, '$2' AS literal",
        )
        .bind_refs(parameters.iter())
        .expect("hostile text bindings")
        .first::<serde_json::Value>(None)
        .await
        .expect("bound data remains literal")
        .expect("echoed row");
    assert_eq!(
        echoed,
        json!({"value": hostile, "repeated": hostile, "empty": null, "literal": "$2"})
    );
    assert_eq!(probe_a.exchanges(), 1);
    checkpoint_rollback(&a, &admin_a).await;
    root_admissions(&a, &probe_a).await;
    root_admissions(&b, &probe_b).await;
    let current_commitments = TenantRootEpochCommitmentsV1::new(
        active_a.record.share_commitment().clone(),
        active_b.record.share_commitment().clone(),
    )
    .expect("active commitments");
    let active_pair = resolve_active_tenant_root_pair_binding_v1(
        test_identity().digest().expect("identity"),
        &TenantRootActiveRoleResolutionV1::Active(active_a.active_binding().expect("A binding")),
        &TenantRootActiveRoleResolutionV1::Active(active_b.active_binding().expect("B binding")),
    )
    .expect("active pair resolution")
    .require_active()
    .expect("active pair")
    .clone();
    let restored = lifecycle::restore_pending(&a, &admin_a, &active_a).await;
    let (active_a, _) =
        lifecycle::forward_refresh(&a, restored, &active_pair, &current_commitments).await;
    let (retired_b, active_b, active_receipt_b) = rotate(
        &b,
        &admin_b,
        &probe_b,
        active_b,
        &active_pair,
        &current_commitments,
    )
    .await;
    lifecycle::cleanup_retired(&b, &retired_b, &active_b).await;
    lifecycle::restore_import_and_retention(&b, &active_b).await;
    lifecycle::source_retirement(&b, &active_b, active_receipt_b).await;
    assert_eq!(active_a.record.epoch(), epoch(2));
    assert_eq!(active_b.record.epoch(), epoch(2));
    let reopened = store(
        "POSTGRES_ROLE_E2E_A_URL",
        CloudflareTenantRootDeriverRoleV1::DeriverA,
    )
    .await;
    assert_eq!(
        reopened
            .load_epoch(
                &test_identity(),
                active_a.record.custody_lineage(),
                epoch(2)
            )
            .await
            .expect("restart load"),
        Some(active_a.clone())
    );
    snapshot_and_retry(&a, &admin_a, &probe_a).await;
    let version: String = admin_a
        .query_one("SELECT version()", &[])
        .await
        .expect("server version")
        .get(0);
    let evidence = json!({
        "kind": "postgres_role_store_e2e_v1", "server": version,
        "separateRoleDatabasesAndCredentials": true, "wrongRoleSessionRejected": true,
        "checkpointMismatchRollsBackEarlierShareInsert": true,
        "missedSwapCheckpointRestoresBothEpochsAndReplay": true,
        "managedRestoreRemainsPendingUntilForwardRefresh": true,
        "retiredEpochCleanupPreservesActiveSuccessor": true,
        "restoreImportAndRetentionRoundTrips": true,
        "sourceRetirementRejectsLateWrites": true,
        "encryptedCreationAndSignedReceiptReplay": true,
        "lostCommitAcknowledgementReconcilesExactReceipt": true,
        "unclaimedCancellationAndClaimedSettlement": true,
        "atomicEpochSwapPerRole": true, "reopenedConnectionDecryptsSameRecord": true,
        "coherentReadSnapshotAcrossConcurrentCommit": true,
        "serializationRetriesCompleteTransaction": true,
        "sessionAvailableDuringRetryDelay": true,
        "literalBindingsPreserveHostileTextAndNull": true,
        "protocolExchanges": {"sessionRoleCheck": 1, "singleRead": 1, "repeatedRead": 1, "rootAdmission": 2,
            "threeMutationEpochSwap": 1, "threeStatementSnapshot": 1,
            "serializationConflictAndConcurrentRead": 3},
        "activatedEpochs": [active_a.record.epoch().get().get(), active_b.record.epoch().get().get()]
    });
    let path = std::env::var("POSTGRES_ROLE_E2E_EVIDENCE_PATH").expect("evidence path");
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&evidence).expect("evidence JSON"),
    )
    .expect("save E2E artifact");
    println!("POSTGRES_ROLE_STORE_E2E {evidence}");
}
