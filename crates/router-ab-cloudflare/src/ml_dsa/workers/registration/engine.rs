use super::*;
use signer_core::ml_dsa_custody::{
    material::{seal_ml_dsa_role_material_v1, MlDsaMaterialBindingV1},
    open_ml_dsa_role_input_v1, MlDsaCeremonyBindingV1, MlDsaRoleV1,
};
use signer_core::wallet_seed_derivation::{
    compute_wallet_key_set_manifest_digest_v1, WalletKeySetManifestV1,
};
pub(super) fn pair(a: core::RoleResult, b: core::RoleResult) -> Result<core::Completed> {
    if a.public_key != b.public_key || a.activation != b.activation {
        return Err(invalid("Registration participant keys disagree"));
    }
    Ok(core::Completed { a, b })
}
async fn begin(
    state: &State,
    command: &Command,
    binding: &registration_preparation::Binding,
) -> Result<()> {
    let marker = match command {
        Command::Prepare { .. } | Command::PreparePeer { .. } => "preparation-started",
        _ => "execution-started",
    };
    let binding = binding.clone();
    let job = command.job().clone();
    transaction(state, move |store| async move {
        if store.get::<bool>(marker).await?.is_some() {
            return Err(invalid("Registration execution already started"));
        }
        store.put(marker, &true).await?;
        store.put("binding", &binding).await?;
        store.put("job", &job).await
    })
    .await
}
pub(super) async fn connected(
    env: &Env,
    state: &Rc<State>,
    command: &Command,
    socket: &WebSocket,
) -> Result<serde_json::Value> {
    check(env, command).await?;
    let role = configured_role(env).map_err(storage_error)?;
    let signing_role = match role {
        Participant::A => SigningRole::A,
        Participant::B => SigningRole::B,
    };
    let job = command.job();
    let schedules = schedules::load()?;
    if execution::schedule_digest(&schedules) != job.schedule {
        return Err(invalid("Registration circuit schedule changed"));
    }
    if signing_schedule_digest(env)? != job.signing_schedule
        || job.signing_batches != policy(env)?.minimum_ready_batches().max(2)
    {
        return Err(invalid("Registration signing group configuration changed"));
    }
    let (version, seed) = executor::wrapping_key(env)?;
    let binding = registration_preparation::Binding {
        pool_scope: job.scope,
        role,
        reservation: job.id,
        schedule_digest: job.schedule,
        expires_at_ms: job.expires_at,
        wrapping_key_version: version.clone(),
    };
    begin(state, command, &binding).await?;
    let now = crate::cloudflare_now_unix_ms_v1()?;
    let (deadline, ceremony) = match command {
        Command::Prepare { .. } | Command::PreparePeer { .. } => (job.prepare_until, [0; 32]),
        Command::Execute { claim } | Command::ExecutePeer { claim } => {
            (claim.deadline, claim.request.operation)
        }
        _ => return Err(invalid("Invalid registration execution command")),
    };
    let cleanup_at = if ceremony == [0; 32] {
        job.expires_at
    } else {
        deadline.saturating_add(1000)
    };
    schedule_refill_alarm(state, cleanup_at.saturating_sub(now))
        .await
        .map_err(storage_error)?;
    let wire = match command {
        Command::Prepare { .. } | Command::PreparePeer { .. } => {
            transport::Duplex::for_preparation(socket, deadline)
        }
        Command::Execute { .. } | Command::ExecutePeer { .. } => {
            transport::Duplex::new(socket, deadline)
        }
        _ => return Err(invalid("Invalid registration execution command")),
    }
    .map_err(storage_error)?;
    let mut adapter = adapter::Adapter {
        wire,
        state: Rc::clone(state),
        binding: binding.clone(),
        seed: seed.clone(),
        ceremony,
        loaded_frames: 0,
        loaded_bytes: 0,
        read_transactions: 0,
        peak_cached_frames: 0,
        frames: None,
        pending_frames: Vec::new(),
        written_frames: 0,
        write_transactions: 0,
        peak_pending_frames: 0,
    };
    if matches!(
        command,
        Command::Prepare { .. } | Command::PreparePeer { .. }
    ) {
        let prepared = prepare_keygen(signing_role, &schedules, &mut adapter)
            .await
            .map_err(runtime_error)?;
        // Ready private state must never refer to buffered, uncommitted tables.
        adapter.flush_tables().await?;
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_registration_preparation_v1",
                "role": role,
                "written_frames": adapter.written_frames,
                "write_transactions": adapter.write_transactions,
                "peak_pending_frames": adapter.peak_pending_frames,
            })
        );
        check(env, command).await?;
        let sealed =
            registration_preparation::seal(prepared.into_storage(job.id), &binding, &seed)?;
        let stored = binding.clone();
        let now = crate::cloudflare_now_unix_ms_v1()?;
        transaction(state, move |store| async move {
            registration_preparation::publish(&store, stored, sealed, now).await
        })
        .await?;
        signing_stock::prepare(env, state, job, signing_role, &seed, &mut adapter.wire).await?;
        // Only public readiness is exchanged; each role keeps its own private state.
        adapter.send(&[1]).await.map_err(runtime_error)?;
        if adapter.receive(1).await.map_err(runtime_error)? != [1] {
            return Err(invalid("Registration preparation acknowledgement changed"));
        }
        let _: bool = service_call(
            env,
            CallAuthority::Internal,
            &AdmissionCommand::ReadyRegistration {
                job: job.clone(),
                role,
            },
        )
        .await?;
        adapter.send(&[2]).await.map_err(runtime_error)?;
        if adapter.receive(1).await.map_err(runtime_error)? != [2] {
            return Err(invalid("Registration readiness acknowledgement changed"));
        }
        return Ok(serde_json::json!(true));
    }
    let claim = match command {
        Command::Execute { claim } | Command::ExecutePeer { claim } => claim,
        _ => return Err(invalid("Missing registration claim")),
    };
    let ceremony_binding = MlDsaCeremonyBindingV1::new(
        String::from(claim.request.wallet.wallet.clone()),
        String::from(claim.request.key_id.clone()),
        claim.request.operation,
        claim.request.epoch,
    )
    .map_err(runtime_error)?;
    let (_, holder) = executor::holder_key(env)?;
    let role_kind = match role {
        Participant::A => MlDsaRoleV1::A,
        Participant::B => MlDsaRoleV1::B,
    };
    let input = match role {
        Participant::A => &claim.request.input_a,
        Participant::B => &claim.request.input_b,
    };
    let (root, reply) = open_ml_dsa_role_input_v1(input, &ceremony_binding, role_kind, &holder)
        .map_err(runtime_error)?
        .into_parts();
    let expected = binding.clone();
    let now = crate::cloudflare_now_unix_ms_v1()?;
    let sealed = transaction(state, move |store| async move {
        registration_preparation::consume(&store, &expected, ceremony, now).await
    })
    .await?;
    let bytes = registration_preparation::open(sealed, &binding, &seed)?;
    let prepared = PreparedKeygen::from_consumed_storage(signing_role, job.id, &schedules, bytes)
        .map_err(runtime_error)?;
    let (key, _) = prepared
        .run(&root, &mut adapter)
        .await
        .map_err(runtime_error)?;
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_registration_execution_v1",
            "role": role,
            "loaded_frames": adapter.loaded_frames,
            "loaded_bytes": adapter.loaded_bytes,
            "table_read_transactions": adapter.read_transactions,
            "peak_cached_frames": adapter.peak_cached_frames,
        })
    );
    check(env, command).await?;
    let manifest = WalletKeySetManifestV1::NearMlDsa65 {
        wallet_id: ceremony_binding.wallet_id().to_owned(),
        ml_dsa65_signing_key_id: ceremony_binding.signing_key_id().to_owned(),
        registered_public_key: Box::new(key.public_key),
    };
    let manifest_digest =
        compute_wallet_key_set_manifest_digest_v1(&manifest).map_err(runtime_error)?;
    let public_key_digest = Sha256::digest(key.public_key).into();
    if let core::Continuity::Recover {
        public_key_digest: expected,
        manifest_digest: expected_manifest,
    } = &claim.request.continuity
    {
        if *expected != public_key_digest || *expected_manifest != manifest_digest {
            return Err(invalid("Recovered registration key differs from custody"));
        }
    }
    let activation = admission::KeyActivation {
        key: KeyScope {
            wallet: claim.request.wallet.clone(),
            key_id: claim.request.key_id.clone(),
            epoch: claim.request.epoch,
            public_key_digest,
            schedule_digest: claim.job.signing_schedule,
        },
        ceremony_id: ceremony,
        manifest_digest,
    };
    let storage_binding = MlDsaMaterialBindingV1::new(
        &hex(&digest(
            b"seams/ml-dsa/custody-storage-scope/v1",
            &activation.key.wallet,
        )?),
        &String::from(version.clone()),
        &ceremony_binding,
        role_kind,
        &key.public_key,
    )
    .map_err(runtime_error)?;
    let sealed_material = seal_ml_dsa_role_material_v1(&key.own_material, &storage_binding, &seed)
        .map_err(runtime_error)?;
    let record = material::Record {
        activation: activation.clone(),
        role,
        public_key: key.public_key.to_vec(),
        wrapping_key_version: version,
        sealed: sealed_material,
    };
    let own = core::RoleResult {
        public_key: key.public_key.to_vec(),
        activation,
        reply: reply
            .seal_result(&holder, &key.public_key)
            .map_err(runtime_error)?,
    };
    let stored_result = own.clone();
    transaction(state, move |store| async move {
        store.put("material", &record).await?;
        store.put("own-result", &stored_result).await
    })
    .await?;
    let peer = exchange(signing_role, &own, &mut adapter).await?;
    let result = match role {
        Participant::A => pair(own, peer)?,
        Participant::B => pair(peer, own)?,
    };
    if role == Participant::A {
        state
            .storage()
            .put("pair-result", &result)
            .await
            .map_err(storage_error)?;
    }
    serde_json::to_value(result).map_err(runtime_error)
}
async fn exchange(
    role: SigningRole,
    own: &core::RoleResult,
    transport: &mut impl Transport,
) -> Result<core::RoleResult> {
    let bytes = serde_json::to_vec(own).map_err(runtime_error)?;
    if bytes.len() > 32768 {
        return Err(invalid("Registration result too large"));
    }
    if role == SigningRole::A {
        transport
            .send(&(bytes.len() as u32).to_be_bytes())
            .await
            .map_err(runtime_error)?;
        transport.send(&bytes).await.map_err(runtime_error)?;
    }
    let size = transport.receive(4).await.map_err(runtime_error)?;
    let size = u32::from_be_bytes(size.as_slice().try_into().map_err(runtime_error)?) as usize;
    if size > 32768 {
        return Err(invalid("Peer registration result too large"));
    }
    let peer = transport.receive(size).await.map_err(runtime_error)?;
    if role == SigningRole::B {
        transport
            .send(&(bytes.len() as u32).to_be_bytes())
            .await
            .map_err(runtime_error)?;
        transport.send(&bytes).await.map_err(runtime_error)?;
    }
    serde_json::from_slice(&peer).map_err(runtime_error)
}
