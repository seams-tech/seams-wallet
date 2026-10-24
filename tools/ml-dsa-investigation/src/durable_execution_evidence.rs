//! Two processes consume actual stored preparation through the Worker executor core.
use crate::{
    InvestigationResult,
    boolean_engine_evidence::run_ready,
    durable_preparation_evidence::{Db, error, identifier, tx},
    prepared_keygen_evidence::HostTransport,
    reference, require,
};
use ml_dsa_threshold::{
    runtime::{
        TrustedMlDsaSchedule,
        prepared::{Phase, Transport},
    },
    signing::{
        OwnSigningShare, SigningRole,
        prepared_signing::gmw::{
            ConsumedGmwPreparation, PreparedGmwReservation, commit_gmw_reservations,
            prepare_gmw_reservations,
        },
    },
};
use router_ab_cloudflare::ml_dsa::{
    self as m,
    admission::{self, Completion, Decision, Permit, Status},
    execution::{self, Host, RoleSecrets},
    policy::Policy,
    pool, sealing, *,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Instant};
use zeroize::Zeroizing;

struct DurableHost<'a> {
    pool: &'a Db,
    router: &'a Db,
    role: Participant,
    now: u64,
}
impl Host for DurableHost<'_> {
    fn now_ms(&self) -> m::Result<u64> {
        Ok(self.now)
    }
    async fn take(
        &self,
        permit: &Permit,
        batch: [u8; 32],
    ) -> m::Result<(sealing::Binding, sealing::Sealed)> {
        let status = tx(
            self.router,
            admission::lookup(self.router, &permit.request, self.now),
        )
        .map_err(error)?;
        if status
            != Some(Status::Running {
                permit: permit.clone(),
            })
        {
            return Err(error("Permit is inactive"));
        }
        tx(
            self.pool,
            pool::take(self.pool, self.role, permit, batch, self.now),
        )
        .map_err(error)
    }
}
fn sync(role: SigningRole, transport: &mut HostTransport) -> InvestigationResult<()> {
    if role == SigningRole::A {
        run_ready(transport.send(&[1]))??;
        require(
            run_ready(transport.receive(1))?? == [1],
            "Peer synchronization failed",
        )?;
    } else {
        require(
            run_ready(transport.receive(1))?? == [1],
            "Peer synchronization failed",
        )?;
        run_ready(transport.send(&[1]))??;
    }
    Ok(())
}
pub(super) fn run(
    role: SigningRole,
    material: Zeroizing<Vec<u8>>,
    public_key: &[u8; 1952],
    schedules: &[TrustedMlDsaSchedule<'_>],
    group: [u8; 32],
    directory: &Path,
    message: &[u8],
    context: &[u8],
    transport: &mut HostTransport,
) -> InvestigationResult<Value> {
    let participant = if role == SigningRole::A {
        Participant::A
    } else {
        Participant::B
    };
    let key = KeyScope {
        wallet: WalletScope {
            org: identifier("e2e")?,
            project: identifier("ml-dsa")?,
            environment: identifier("local")?,
            wallet: identifier("canonical-wallet")?,
        },
        key_id: identifier("near")?,
        epoch: 1,
        public_key_digest: Sha256::digest(public_key).into(),
        schedule_digest: execution::signing_schedule_digest(schedules, 2),
    };
    let activation = admission::KeyActivation {
        key: key.clone(),
        ceremony_id: [41; 32],
        manifest_digest: [42; 32],
    };
    let pool_path = directory.join("executor-pool.sqlite");
    let router_path = directory
        .parent()
        .ok_or("Missing shared directory")?
        .join(format!("router-{}.sqlite", hex::encode(group)));
    let router = Db::open(&router_path)?;
    if role == SigningRole::A {
        tx(
            &router,
            admission::authorize_key(&router, activation.clone()),
        )?;
    }
    let db = Db::open(&pool_path)?;
    tx(&db, pool::install_key(&db, key.clone()))?;
    let mut kek = Zeroizing::new([0; 32]);
    getrandom::getrandom(kek.as_mut())?;
    let mut hash = Sha256::new();
    hash.update(b"seams/ml-dsa/role-wrapping-seed/v1");
    hash.update(kek.as_ref());
    let seed = Zeroizing::new(hash.finalize().into());
    if let Ok(output) = std::env::var("ML_DSA_WORKER_FIXTURE_DIRECTORY") {
        std::fs::create_dir_all(&output)?;
        std::fs::write(
            Path::new(&output).join(if role == SigningRole::A {
                "a-kek"
            } else {
                "b-kek"
            }),
            format!(
                "hpke-x25519-role-private-d1-private-v1:{}",
                hex::encode(kek.as_ref())
            ),
        )?;
    }
    let version = identifier("role-private-e2e")?;
    persist_material(
        &db,
        activation.clone(),
        participant,
        public_key,
        &version,
        material,
        &seed,
    )?;
    sync(role, transport)?;
    if role == SigningRole::A {
        tx(&router, admission::commit_key(&router, activation))?;
    }
    sync(role, transport)?;
    let started = Instant::now();
    let mut topologies = Default::default();
    let mut preparation_groups = Vec::new();
    let generic_id: [u8; 32] = Sha256::digest([group.as_slice(), &[0]].concat()).into();
    let mut committed_storage_checks = Vec::new();
    let epoch = execution::material_epoch(&key)?;
    let mut pending = Vec::new();
    let mut commitment_groups = Vec::new();
    for ordinal in 0u8..10 {
        let ids: Vec<[u8; 32]> = [ordinal * 2, ordinal * 2 + 1]
            .into_iter()
            .map(|index| Sha256::digest([group.as_slice(), &[index]].concat()).into())
            .collect();
        let prepared = run_ready(prepare_gmw_reservations(
            role,
            &ids,
            2,
            schedules,
            &mut topologies,
            transport,
        ))??;
        preparation_groups.push(ids.iter().map(hex::encode).collect::<Vec<_>>());
        for (id, prepared) in ids.into_iter().zip(prepared) {
            let binding = sealing::Binding {
                key: key.clone(),
                role: participant,
                batch: id,
                expires_at_ms: 10_000_000,
                wrapping_key_version: version.clone(),
            };
            if id == generic_id {
                // One isolated negative operation must burn and refuse uncommitted stock.
                let sealed = sealing::seal(prepared.into_storage(), &binding, &seed)?;
                tx(&db, pool::put(&db, binding, sealed, 1_000))?;
            } else {
                pending.push((binding, prepared));
            }
        }
    }
    while !pending.is_empty() {
        let count = if commitment_groups.len() < 8 {
            1
        } else {
            pending.len().min(8)
        };
        let (bindings, prepared): (Vec<_>, Vec<_>) = pending.drain(..count).unzip();
        let group = run_ready(commit_gmw_reservations(
            prepared, public_key, epoch, transport,
        ))??;
        require(
            group.metrics.and_exchanges == 113,
            "Commitment cohort did not share its AND exchanges",
        )?;
        require(
            group.maximum_message_bytes <= 1_048_576,
            "Commitment cohort exceeded the transport limit",
        )?;
        commitment_groups.push(json!({
            "mode": if count == 1 { "sequential" } else { "batched" },
            "pairs": count, "and_exchanges": group.metrics.and_exchanges,
            "and_gates": group.metrics.and_gates, "maximum_message_bytes": group.maximum_message_bytes,
            "sent_bytes": group.metrics.phases[3..].iter().map(|phase| phase.sent).sum::<usize>(),
            "received_bytes": group.metrics.phases[3..].iter().map(|phase| phase.received).sum::<usize>(),
        }));
        for (binding, committed) in bindings.into_iter().zip(group.reservations) {
            let bytes = committed.into_storage();
            if committed_storage_checks.is_empty() && count > 1 {
                let record = tx(&db, m::material::get(&db, &key))?;
                committed_storage_checks.push(check_committed_storage(
                    &bytes, &binding, public_key, schedules, &record, &seed, transport,
                )?);
            }
            let sealed = sealing::seal(bytes, &binding, &seed)?;
            tx(&db, pool::put(&db, binding, sealed, 1_000))?;
        }
    }
    let cohort_binding_checks = check_cohort_bindings(
        role,
        public_key,
        epoch,
        &group,
        schedules,
        &mut topologies,
        transport,
    )?;
    drop(db);
    drop(topologies);
    sync(role, transport)?;
    let preparation_ns = started.elapsed().as_nanos();
    transport.phase(Phase::Online);
    let started = Instant::now();
    let mut operations = Vec::new();
    let policy = Policy::parse(
        r#"{"wallet_cooldown":{"mode":"enabled","interval_ms":60000},"max_active_operations":1,"operation_timeout_ms":30000,"candidate_group_size":2,"preparation_group_size":4,"minimum_ready_batches":1,"refill_target_batches":20}"#,
    )?;
    for ordinal in 0u8..20 {
        let mut operation_message = message.to_vec();
        operation_message.push(ordinal);
        let message = operation_message.as_slice();
        let db = Db::open(&pool_path)?;
        let now = 2_000 + u64::from(ordinal) * 60_000;
        let inventory = tx(&db, pool::inventory(&db, &key, 20, now, now + 30_000))?;
        if inventory.ready.is_empty() {
            break;
        }
        let batches = if ordinal == 0 {
            vec![generic_id]
        } else {
            inventory.ready
        };
        let request = SigningRequest {
            key: key.clone(),
            operation: [ordinal + 1; 32],
            message_digest: Sha256::digest(message).into(),
            context_digest: Sha256::digest(context).into(),
        };
        if role == SigningRole::A {
            require(
                matches!(
                    tx(
                        &router,
                        admission::begin(&router, &policy, request.clone(), now)
                    )?,
                    Decision::Claimed { .. }
                ),
                "Operation was not claimed",
            )?;
        }
        sync(role, transport)?;
        let Status::Preparing { claim } =
            tx(&router, admission::lookup(&router, &request, now))?.ok_or("Missing claim")?
        else {
            return Err("Wrong claim status".into());
        };
        tx(
            &db,
            pool::reserve(&db, &request, &batches, claim.expires_at_ms, now),
        )?;
        sync(role, transport)?;
        if role == SigningRole::A {
            require(
                matches!(
                    tx(
                        &router,
                        admission::admit(&router, &policy, claim, batches.clone(), now)
                    )?,
                    Decision::Admitted { .. }
                ),
                "Operation was not admitted",
            )?;
        }
        sync(role, transport)?;
        let Status::Running { permit } =
            tx(&router, admission::lookup(&router, &request, now))?.ok_or("Missing permit")?
        else {
            return Err("Wrong permit status".into());
        };
        let host = DurableHost {
            pool: &db,
            router: &router,
            role: participant,
            now: now + 1,
        };
        let record = tx(&db, m::material::get(&db, &key))?;
        let bytes = record.open(participant, &version, &seed)?;
        let execution = execution::Request {
            permit: permit.clone(),
            message: message.to_vec(),
            context: context.to_vec(),
        };
        let operation_started = Instant::now();
        let before = transport.counts[1].json();
        let outcome = run_ready(execution::run(
            &execution,
            public_key,
            RoleSecrets {
                role: participant,
                material: bytes,
                wrapping_seed: seed.clone(),
                wrapping_key_version: version.clone(),
            },
            2,
            schedules,
            &host,
            transport,
        ))?;
        let elapsed_ns = operation_started.elapsed().as_nanos();
        let (outcome, completion, settlement) = if ordinal == 0 {
            let Err(failure) = outcome else {
                return Err("Generic stock reached online activation".into());
            };
            require(
                failure.message() == "ML-DSA signing requires prepared key-bound commitments",
                "Generic stock failed at an unexpected boundary",
            )?;
            let after = transport.counts[1].json();
            for field in ["sent_messages", "received_messages"] {
                let previous = before[field]
                    .as_u64()
                    .ok_or("Missing pre-execution count")?;
                let current = after[field]
                    .as_u64()
                    .ok_or("Missing post-execution count")?;
                require(
                    current == previous + 1,
                    "Generic refusal performed more than the public execution binding",
                )?;
            }
            for field in ["sent_bytes", "received_bytes"] {
                let previous = before[field]
                    .as_u64()
                    .ok_or("Missing pre-execution count")?;
                let current = after[field]
                    .as_u64()
                    .ok_or("Missing post-execution count")?;
                require(
                    current == previous + 32,
                    "Generic refusal entered private activation",
                )?;
            }
            (
                json!({"status":"generic-refused", "consumed_batches":1, "evaluated_candidates":0, "burned_candidates":2}),
                Completion::Failed,
                pool::Settlement::Failed,
            )
        } else {
            let outcome = outcome?;
            let completion = match &outcome {
                execution::Outcome::Signed { signature, .. } => {
                    reference::verify_signature_rustcrypto(
                        public_key, message, context, signature,
                    )?;
                    Completion::Succeeded {
                        public_key: public_key.to_vec(),
                        message: message.to_vec(),
                        context: context.to_vec(),
                        signature: signature.clone(),
                    }
                }
                execution::Outcome::Exhausted { .. } => Completion::Failed,
            };
            let settlement = if matches!(outcome, execution::Outcome::Signed { .. }) {
                pool::Settlement::Succeeded
            } else {
                pool::Settlement::Failed
            };
            (serde_json::to_value(outcome)?, completion, settlement)
        };
        sync(role, transport)?;
        if role == SigningRole::A {
            tx(
                &router,
                admission::finish(&router, &permit, completion, now + 2),
            )?;
        }
        sync(role, transport)?;
        require(
            run_ready(host.take(&permit, permit.batches[0]))?.is_err(),
            "Terminal execution accepted replay",
        )?;
        let consumed = tx(&db, pool::fence(&db, &request, &permit.batches))?;
        if ordinal == 0 {
            require(
                consumed == [generic_id],
                "Generic refusal did not irreversibly consume its isolated slot",
            )?;
        }
        // Both successful peers consumed the same prefix. Check that agreement on the channel.
        let consumed_digest = digest(b"consumed", &consumed)?;
        if role == SigningRole::A {
            run_ready(transport.send(&consumed_digest))??;
            require(
                run_ready(transport.receive(32))?? == consumed_digest,
                "Consumption differs",
            )?;
        } else {
            require(
                run_ready(transport.receive(32))?? == consumed_digest,
                "Consumption differs",
            )?;
            run_ready(transport.send(&consumed_digest))??;
        }
        tx(
            &db,
            pool::release(&db, &request, &permit.batches, settlement, &consumed),
        )?;
        require(
            matches!(
                tx(
                    &router,
                    admission::begin(&router, &policy, request.clone(), now + 3)
                )?,
                Decision::Existing { .. }
            ),
            "Duplicate operation was not cached",
        )?;
        require(
            matches!(
                tx(&db, pool::refill_status(&db, &key, now + 3))?,
                pool::RefillStatus::Requested { .. }
            ),
            "Consumption lost refill demand",
        )?;
        let generic_groups = usize::from(ordinal == 0);
        operations.push(json!({
            "outcome": outcome,
            "consumed_ids": consumed.iter().map(hex::encode).collect::<Vec<_>>(),
            "refused_generic_groups": generic_groups,
            "committed_groups": consumed.len() - generic_groups,
            "message_digest": hex::encode(request.message_digest),
            "online_ns": elapsed_ns, "replay_rejected": true, "duplicate_cached": true,
        }));
        sync(role, transport)?;
    }
    let db = Db::open(&pool_path)?;
    require(
        tx(&db, pool::inventory(&db, &key, 20, 2_000_000, 2_030_000))?
            .ready
            .is_empty(),
        "Durable test did not drain the pool",
    )?;
    Ok(
        json!({"result":{"status":"durable-execution", "operations":operations, "preparation_groups":preparation_groups, "committed_storage_checks":committed_storage_checks, "commitment_groups":commitment_groups, "cohort_binding_checks":cohort_binding_checks}, "offline_ns":preparation_ns, "online_ns":started.elapsed().as_nanos(), "offline":transport.counts[0].json(), "online":transport.counts[1].json()}),
    )
}

fn check_committed_storage(
    bytes: &Zeroizing<Vec<u8>>,
    binding: &sealing::Binding,
    public_key: &[u8; 1952],
    schedules: &[TrustedMlDsaSchedule<'_>],
    material: &m::material::Record,
    seed: &[u8; 32],
    transport: &mut HostTransport,
) -> InvestigationResult<Value> {
    let role = match binding.role {
        Participant::A => SigningRole::A,
        Participant::B => SigningRole::B,
    };
    let peer = match role {
        SigningRole::A => SigningRole::B,
        SigningRole::B => SigningRole::A,
    };
    let mut wrong_id = binding.batch;
    wrong_id[0] ^= 1;
    let mut truncated = bytes.clone();
    truncated.pop();
    let mut extended = bytes.clone();
    extended.push(0);
    for (expected_role, id, count, circuit_set, stored) in [
        (peer, binding.batch, 2, schedules, bytes.clone()),
        (role, wrong_id, 2, schedules, bytes.clone()),
        (role, binding.batch, 3, schedules, bytes.clone()),
        (
            role,
            binding.batch,
            2,
            &schedules[..schedules.len() - 1],
            bytes.clone(),
        ),
        (role, binding.batch, 2, schedules, truncated),
        (role, binding.batch, 2, schedules, extended),
    ] {
        require(
            ConsumedGmwPreparation::from_consumed_storage(
                expected_role,
                id,
                count,
                circuit_set,
                &mut Default::default(),
                stored,
            )
            .is_err(),
            "Committed storage accepted changed identity, circuit layout, or length",
        )?;
    }
    let epoch = execution::material_epoch(&binding.key)?;
    let mut wrong_key = *public_key;
    wrong_key[0] ^= 1;
    let mut wrong_epoch = epoch;
    wrong_epoch[0] ^= 1;
    for (expected_key, expected_epoch) in [(&wrong_key, epoch), (public_key, wrong_epoch)] {
        let restored = ConsumedGmwPreparation::from_consumed_storage(
            role,
            binding.batch,
            2,
            schedules,
            &mut Default::default(),
            bytes.clone(),
        )?;
        let own = material.open(binding.role, &binding.wrapping_key_version, seed)?;
        let own = OwnSigningShare::parse(&own)?;
        let before = transport.counts[0].json();
        require(
            matches!(
                run_ready(restored.activate(own, expected_key, expected_epoch, transport))?,
                Err(ml_dsa_threshold::signing::SigningError::RequestBinding)
            ),
            "Committed preparation accepted another key or epoch",
        )?;
        let after = transport.counts[0].json();
        require(
            before == after,
            "Rejected committed activation used the transport",
        )?;
    }
    Ok(json!({
        "serialized_bytes": bytes.len(), "changed_storage_bindings_rejected": 6,
        "wrong_key_and_epoch_rejected_before_transport": 2,
    }))
}

fn persist_material(
    db: &Db,
    activation: admission::KeyActivation,
    role: Participant,
    public_key: &[u8; 1952],
    version: &Identifier,
    material: Zeroizing<Vec<u8>>,
    seed: &[u8; 32],
) -> InvestigationResult<()> {
    use signer_core::ml_dsa_custody::{
        MlDsaCeremonyBindingV1, MlDsaRoleV1,
        material::{MlDsaMaterialBindingV1, seal_ml_dsa_role_material_v1},
    };
    let ceremony = MlDsaCeremonyBindingV1::new(
        "canonical-wallet".into(),
        "near".into(),
        activation.ceremony_id,
        activation.key.epoch,
    )?;
    let binding = MlDsaMaterialBindingV1::new(
        &hex::encode(digest(
            b"seams/ml-dsa/custody-storage-scope/v1",
            &activation.key.wallet,
        )?),
        &String::from(version.clone()),
        &ceremony,
        if role == Participant::A {
            MlDsaRoleV1::A
        } else {
            MlDsaRoleV1::B
        },
        public_key,
    )?;
    let sealed = seal_ml_dsa_role_material_v1(&material, &binding, seed)?;
    let record = m::material::Record {
        activation,
        role,
        public_key: public_key.to_vec(),
        wrapping_key_version: version.clone(),
        sealed,
    };
    if let Ok(output) = std::env::var("ML_DSA_WORKER_FIXTURE_DIRECTORY") {
        std::fs::write(
            Path::new(&output).join(if role == Participant::A {
                "a.json"
            } else {
                "b.json"
            }),
            serde_json::to_vec_pretty(&record)?,
        )?;
    }
    tx(db, m::material::put(db, record))?;
    Ok(())
}

#[derive(Clone, Copy)]
enum CohortFault {
    Reordered,
    Duplicate,
    MixedRole,
    Key,
    Epoch,
}
impl CohortFault {
    fn label(self) -> &'static str {
        match self {
            Self::Reordered => "reordered",
            Self::Duplicate => "duplicate",
            Self::MixedRole => "mixed-role",
            Self::Key => "key",
            Self::Epoch => "epoch",
        }
    }
    fn binding_bytes(self) -> u64 {
        match self {
            Self::Duplicate | Self::MixedRole => 0,
            Self::Reordered | Self::Key | Self::Epoch => 32,
        }
    }
}

fn check_cohort_bindings(
    role: SigningRole,
    public_key: &[u8; 1952],
    epoch: [u8; 32],
    group: &[u8; 32],
    schedules: &[TrustedMlDsaSchedule<'_>],
    topologies: &mut ml_dsa_threshold::runtime::boolean_mpc::prepared::PublicTopologies,
    transport: &mut HostTransport,
) -> InvestigationResult<Vec<Value>> {
    let mut checks = Vec::new();
    for fault in [
        CohortFault::Reordered,
        CohortFault::Duplicate,
        CohortFault::MixedRole,
        CohortFault::Key,
        CohortFault::Epoch,
    ] {
        let ids: Vec<[u8; 32]> = [0u8, 1]
            .into_iter()
            .map(|index| {
                Sha256::digest([group.as_slice(), fault.label().as_bytes(), &[index]].concat())
                    .into()
            })
            .collect();
        let mut prepared = if matches!(fault, CohortFault::MixedRole) {
            let mut first = run_ready(prepare_gmw_reservations(
                role,
                &ids[..1],
                2,
                schedules,
                topologies,
                transport,
            ))??;
            let other = match role {
                SigningRole::A => SigningRole::B,
                SigningRole::B => SigningRole::A,
            };
            first.extend(run_ready(prepare_gmw_reservations(
                other,
                &ids[1..],
                2,
                schedules,
                topologies,
                transport,
            ))??);
            first
        } else {
            run_ready(prepare_gmw_reservations(
                role, &ids, 2, schedules, topologies, transport,
            ))??
        };
        let mut key = *public_key;
        let mut key_epoch = epoch;
        match fault {
            CohortFault::Reordered => {
                if role == SigningRole::B {
                    prepared.reverse();
                }
            }
            CohortFault::Duplicate => {
                let bytes = prepared.remove(0).into_storage();
                prepared.clear();
                // These duplicate handles are deliberately invalid and must never enter a gate exchange.
                prepared.push(PreparedGmwReservation::from_consumed_storage(
                    role,
                    ids[0],
                    2,
                    schedules,
                    topologies,
                    bytes.clone(),
                )?);
                prepared.push(PreparedGmwReservation::from_consumed_storage(
                    role, ids[0], 2, schedules, topologies, bytes,
                )?);
            }
            CohortFault::MixedRole => {}
            CohortFault::Key => {
                if role == SigningRole::B {
                    key[32] ^= 1;
                }
            }
            CohortFault::Epoch => {
                if role == SigningRole::B {
                    key_epoch[0] ^= 1;
                }
            }
        }
        let before = transport.counts[0].json();
        require(
            run_ready(commit_gmw_reservations(
                prepared, &key, key_epoch, transport,
            ))?
            .is_err(),
            "Invalid commitment cohort was accepted",
        )?;
        let after = transport.counts[0].json();
        for field in ["sent_bytes", "received_bytes"] {
            require(
                after[field].as_u64().ok_or("Missing cohort count")?
                    == before[field].as_u64().ok_or("Missing pre-binding count")?
                        + fault.binding_bytes(),
                "Invalid cohort entered private evaluation",
            )?;
        }
        for field in ["sent_messages", "received_messages"] {
            require(
                after[field].as_u64().ok_or("Missing message count")?
                    == before[field]
                        .as_u64()
                        .ok_or("Missing pre-binding message count")?
                        + u64::from(fault.binding_bytes() != 0),
                "Invalid cohort exchanged unexpected messages",
            )?;
        }
        checks.push(json!({"fault":fault.label(),"rejected_before_gates":true,"binding_bytes_per_direction":fault.binding_bytes()}));
    }
    Ok(checks)
}
