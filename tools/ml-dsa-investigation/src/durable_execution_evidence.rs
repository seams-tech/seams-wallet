//! Two processes consume actual stored preparation through the Worker executor core.
use crate::{
    InvestigationResult,
    boolean_engine_evidence::run_ready,
    durable_preparation_evidence::{Db, error, identifier, tx},
    prepared_keygen_evidence::HostTransport,
    reference, require,
};
use ed25519_yao::{
    ml_dsa_runtime::{
        TrustedMlDsaSchedule,
        prepared::{Phase, Transport},
    },
    ml_dsa_signing::{SigningRole, prepared_signing::gmw::prepare_gmw_reservations},
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
            let sealed = sealing::seal(prepared.into_storage(), &binding, &seed)?;
            tx(&db, pool::put(&db, binding, sealed, 1_000))?;
        }
    }
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
            pool::reserve(&db, &request, &inventory.ready, claim.expires_at_ms, now),
        )?;
        sync(role, transport)?;
        if role == SigningRole::A {
            require(
                matches!(
                    tx(
                        &router,
                        admission::admit(&router, &policy, claim, inventory.ready, now)
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
        ))??;
        let elapsed_ns = operation_started.elapsed().as_nanos();
        sync(role, transport)?;
        let completion = match &outcome {
            execution::Outcome::Signed { signature, .. } => {
                reference::verify_signature_rustcrypto(public_key, message, context, signature)?;
                Completion::Succeeded {
                    public_key: public_key.to_vec(),
                    message: message.to_vec(),
                    context: context.to_vec(),
                    signature: signature.clone(),
                }
            }
            execution::Outcome::Exhausted { .. } => Completion::Failed,
        };
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
        let settlement = if matches!(outcome, execution::Outcome::Signed { .. }) {
            pool::Settlement::Succeeded
        } else {
            pool::Settlement::Failed
        };
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
        operations.push(json!({"outcome": outcome, "consumed_ids": consumed.iter().map(hex::encode).collect::<Vec<_>>(), "message_digest": hex::encode(request.message_digest), "online_ns": elapsed_ns, "replay_rejected": true, "duplicate_cached": true}));
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
        json!({"result":{"status":"durable-execution", "operations":operations, "preparation_groups":preparation_groups}, "offline_ns":preparation_ns, "online_ns":started.elapsed().as_nanos(), "offline":transport.counts[0].json(), "online":transport.counts[1].json()}),
    )
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
