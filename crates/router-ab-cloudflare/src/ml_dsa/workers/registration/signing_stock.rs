//! Generic signing stock becomes key-bound before registration publishes its result.
use super::*;
use ml_dsa_threshold::ml_dsa_signing::prepared_signing::gmw::{
    commit_gmw_reservations, prepare_gmw_reservations, PreparedGmwReservation,
};
const DOMAIN: &[u8] = b"seams/ml-dsa/registration-signing-stock/v4";
#[derive(Serialize, Deserialize)]
struct Stored {
    encapsulated_key: [u8; 32],
    chunks: usize,
}
#[derive(Serialize, Deserialize)]
#[serde(
    tag = "state",
    content = "storage",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum Stock {
    Generic(Stored),
    Committing,
    Committed { binding: Binding, record: Stored },
}

pub(super) async fn prepare(
    env: &Env,
    state: &State,
    job: &core::Job,
    role: SigningRole,
    seed: &[u8; 32],
    wire: &mut impl ml_dsa_threshold::ml_dsa_runtime::boolean_comparison::Transport,
    waits: Option<&wait_trace::WaitTrace>,
) -> Result<()> {
    let schedules = super::super::schedules::load()?;
    if signing_schedule_digest(env)? != job.signing_schedule {
        return Err(invalid("Registration signing schedule changed"));
    }
    let participant = configured_role(env).map_err(storage_error)?;
    let policy = policy(env)?;
    let candidates = policy.candidate_group_size();
    let mut topologies = Default::default();
    let mut next = 0;
    while next < job.signing_batches {
        let count = policy
            .preparation_groups(job.signing_batches - next)
            .count();
        let mut ids = Vec::with_capacity(count);
        for ordinal in next..next + count {
            ids.push(core::signing_batch_id(job, ordinal)?);
        }
        let prepared =
            prepare_gmw_reservations(role, &ids, candidates, &schedules, &mut topologies, wire)
                .await
                .map_err(runtime_error)?;
        for (ordinal, prepared) in (next..next + count).zip(prepared) {
            let sealed = sealing::seal_bound(
                prepared.into_storage(),
                DOMAIN,
                &(job, participant, ordinal),
                seed,
            )?;
            wait_trace::observe(
                waits,
                wait_trace::Kind::StoreSigningStock,
                transaction(state, move |store| async move {
                    let prefix = format!("registration-signing/{ordinal}");
                    let chunks = sealed.store_chunks(&store, &prefix).await?;
                    store
                        .put(
                            &format!("{prefix}/record"),
                            &Stock::Generic(Stored {
                                encapsulated_key: sealed.encapsulated_key,
                                chunks,
                            }),
                        )
                        .await
                }),
            )
            .await?;
        }
        next += count;
    }
    Ok(())
}
pub(super) async fn commit(
    env: &Env,
    state: &State,
    claim: &core::Claim,
    registration: &registration_preparation::Binding,
    key: &KeyScope,
    public_key: &[u8; 1952],
    wire: &mut impl ml_dsa_threshold::ml_dsa_runtime::boolean_comparison::Transport,
) -> Result<()> {
    let participant = configured_role(env).map_err(storage_error)?;
    let role = match participant {
        Participant::A => SigningRole::A,
        Participant::B => SigningRole::B,
    };
    let (version, seed) = executor::wrapping_key(env)?;
    let schedules = super::super::schedules::load()?;
    let candidates = policy(env)?.candidate_group_size();
    let epoch = execution::material_epoch(key)?;
    let mut topologies = super::super::schedules::public_topologies();
    let maximum_pairs = (32 / usize::from(candidates)).min(8);
    let mut start = 0;
    while start < claim.job.signing_batches {
        let end = (start + maximum_pairs).min(claim.job.signing_batches);
        let active_claim = claim.clone();
        let expected = registration.clone();
        let sealed = transaction(state, move |store| async move {
            require_live_execution(&store, &active_claim, &expected).await?;
            let mut inputs = Vec::with_capacity(end - start);
            for ordinal in start..end {
                let prefix = format!("registration-signing/{ordinal}");
                let name = format!("{prefix}/record");
                let Some(Stock::Generic(record)) = store.get::<Stock>(&name).await? else {
                    return Err(invalid("Registration signing input is consumed or absent"));
                };
                let sealed =
                    Sealed::load_chunks(&store, &prefix, record.chunks, record.encapsulated_key)
                        .await?;
                sealing::erase_chunks(&store, &prefix, record.chunks).await?;
                store.put(&name, &Stock::Committing).await?;
                inputs.push(sealed);
            }
            Ok(inputs)
        })
        .await?;
        // Every selected input burn commits before any private state opens.
        let mut prepared = Vec::with_capacity(sealed.len());
        for (ordinal, sealed) in (start..end).zip(sealed) {
            let bytes =
                sealing::open_bound(sealed, DOMAIN, &(&claim.job, participant, ordinal), &seed)?;
            prepared.push(
                PreparedGmwReservation::from_consumed_storage(
                    role,
                    core::signing_batch_id(&claim.job, ordinal)?,
                    candidates,
                    &schedules,
                    &mut topologies,
                    bytes,
                )
                .map_err(runtime_error)?,
            );
        }
        let group = commit_gmw_reservations(prepared, public_key, epoch, wire)
            .await
            .map_err(runtime_error)?;
        let mut outputs = Vec::with_capacity(group.reservations.len());
        for (ordinal, committed) in (start..end).zip(group.reservations) {
            let binding = stock_binding(claim, key, participant, &version, ordinal)?;
            let sealed = sealing::seal(committed.into_storage(), &binding, &seed)?;
            outputs.push((binding, sealed));
        }
        if outputs.len() != end - start {
            return Err(invalid("Registration commitment output count changed"));
        }
        let active_claim = claim.clone();
        let expected = registration.clone();
        transaction(state, move |store| async move {
            require_live_execution(&store, &active_claim, &expected).await?;
            for ordinal in start..end {
                let name = format!("registration-signing/{ordinal}/record");
                if !matches!(store.get::<Stock>(&name).await?, Some(Stock::Committing)) {
                    return Err(invalid("Registration signing commitment was retired"));
                }
            }
            for (ordinal, (binding, sealed)) in (start..end).zip(outputs) {
                let prefix = format!("registration-signing/{ordinal}");
                let chunks = sealed.store_chunks(&store, &prefix).await?;
                store
                    .put(
                        &format!("{prefix}/record"),
                        &Stock::Committed {
                            binding,
                            record: Stored {
                                encapsulated_key: sealed.encapsulated_key,
                                chunks,
                            },
                        },
                    )
                    .await?;
            }
            Ok(())
        })
        .await?;
        #[cfg(target_arch = "wasm32")]
        let memory_bytes = Some(::core::arch::wasm32::memory_size::<0>() as u64 * 65_536);
        #[cfg(not(target_arch = "wasm32"))]
        let memory_bytes: Option<u64> = None;
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_commitment_batch_v1", "operation": hex(&claim.request.operation),
                "role": participant, "start": start, "pairs": end - start, "candidates_per_pair": candidates,
                "and_exchanges": group.metrics.and_exchanges, "and_gates": group.metrics.and_gates,
                "sent_bytes": group.metrics.phases[3..].iter().map(|phase| phase.sent).sum::<usize>(),
                "received_bytes": group.metrics.phases[3..].iter().map(|phase| phase.received).sum::<usize>(),
                "maximum_message_bytes": group.maximum_message_bytes, "wasm_linear_memory_bytes": memory_bytes,
            })
        );
        start = end;
    }
    super::super::schedules::retain_public_topologies(&topologies);
    Ok(())
}

pub(super) async fn install(
    env: &Env,
    state: &State,
    claim: &core::Claim,
    key: &KeyScope,
) -> Result<()> {
    check_signing_scope(env, key)?;
    if key.schedule_digest != claim.job.signing_schedule {
        return Err(invalid(
            "Registration stock belongs to another signing layout",
        ));
    }
    let participant = configured_role(env).map_err(storage_error)?;
    let (version, _) = executor::wrapping_key(env)?;
    let mut ordinal = 0;
    while ordinal < claim.job.signing_batches {
        let first = prepare_delivery(env, state, claim, key, participant, &version, ordinal);
        let (first, second) = if ordinal + 1 < claim.job.signing_batches {
            // Prepare at most the same two batches held by the original delivery window.
            futures::join!(
                first,
                prepare_delivery(env, state, claim, key, participant, &version, ordinal + 1)
            )
        } else {
            (first.await, Ok(StockPreparation::Installed))
        };
        match (first?, second?) {
            (StockPreparation::Installed, StockPreparation::Installed) => {}
            (StockPreparation::Pending { batch, trace }, StockPreparation::Installed)
            | (StockPreparation::Installed, StockPreparation::Pending { batch, trace }) => {
                deliver_stock(
                    env,
                    state,
                    claim,
                    RegistrationStockDelivery::Single([batch]),
                    &[trace],
                )
                .await?;
            }
            (
                StockPreparation::Pending {
                    batch: first,
                    trace: first_trace,
                },
                StockPreparation::Pending {
                    batch: second,
                    trace: second_trace,
                },
            ) => {
                deliver_stock(
                    env,
                    state,
                    claim,
                    RegistrationStockDelivery::Pair([first, second]),
                    &[first_trace, second_trace],
                )
                .await?;
            }
        }
        ordinal += 2;
    }
    Ok(())
}

enum StockPreparation {
    Installed,
    Pending {
        batch: RegistrationStockBatch,
        trace: stage_trace::StageTrace,
    },
}

async fn deliver_stock(
    env: &Env,
    state: &State,
    claim: &core::Claim,
    delivery: RegistrationStockDelivery,
    traces: &[stage_trace::StageTrace],
) -> Result<()> {
    let ordinals: Vec<_> = delivery
        .batches()
        .iter()
        .map(|batch| batch.ordinal)
        .collect();
    let response = local_call(
        env,
        &RoleCommand::InstallRegistrationStock {
            claim: claim.clone(),
            delivery,
        },
        None,
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("Initial signing stock installation failed"));
    }
    for trace in traces {
        trace.mark("delivery_acknowledged");
    }
    transaction(state, move |store| async move {
        for ordinal in ordinals {
            store
                .put(&format!("registration-signing/{ordinal}/installed"), &true)
                .await?;
        }
        Ok(())
    })
    .await?;
    for trace in traces {
        trace.finish();
    }
    Ok(())
}

async fn prepare_delivery(
    env: &Env,
    state: &State,
    claim: &core::Claim,
    key: &KeyScope,
    participant: Participant,
    version: &Identifier,
    ordinal: usize,
) -> Result<StockPreparation> {
    let trace = stage_trace::StageTrace::new(
        claim.request.operation,
        participant,
        stage_trace::Context::RegistrationStock {
            job: claim.job.id,
            ordinal,
        },
    );
    let name = format!("registration-signing/{ordinal}/installed");
    if state
        .storage()
        .get::<bool>(&name)
        .await
        .map_err(storage_error)?
        .unwrap_or(false)
    {
        trace.finish();
        return Ok(StockPreparation::Installed);
    }
    trace.mark("installation_checked");
    let binding = stock_binding(claim, key, participant, version, ordinal)?;
    let expected = binding.clone();
    let sealed = transaction(state, move |store| async move {
        let prefix = format!("registration-signing/{ordinal}");
        let Some(Stock::Committed { binding, record }) =
            store.get::<Stock>(&format!("{prefix}/record")).await?
        else {
            return Err(invalid("Registration signing stock is not committed"));
        };
        if binding != expected {
            return Err(invalid("Registration signing stock binding changed"));
        }
        Sealed::load_chunks(&store, &prefix, record.chunks, record.encapsulated_key).await
    })
    .await?;
    trace.mark("stock_loaded");
    // This immutable final ciphertext also serves exact retries after a lost acknowledgement.
    Ok(StockPreparation::Pending {
        batch: RegistrationStockBatch {
            ordinal,
            binding,
            sealed,
        },
        trace,
    })
}

fn stock_binding(
    claim: &core::Claim,
    key: &KeyScope,
    participant: Participant,
    version: &Identifier,
    ordinal: usize,
) -> Result<Binding> {
    Ok(Binding {
        key: key.clone(),
        role: participant,
        batch: core::signing_batch_id(&claim.job, ordinal)?,
        expires_at_ms: claim.job.expires_at,
        wrapping_key_version: version.clone(),
    })
}

pub(super) async fn retire_next(state: &State, count: usize) -> Result<bool> {
    transaction(state, move |store| async move {
        let ordinal: usize = store.get("signing-cleanup").await?.unwrap_or(0);
        if ordinal >= count {
            return Ok(true);
        }
        let prefix = format!("registration-signing/{ordinal}");
        if let Some(stock) = store.get::<Stock>(&format!("{prefix}/record")).await? {
            match stock {
                Stock::Generic(record) | Stock::Committed { record, .. } => {
                    sealing::erase_chunks(&store, &prefix, record.chunks).await?;
                }
                Stock::Committing => {}
            }
            store.delete(&format!("{prefix}/record")).await?;
        }
        store.put("signing-cleanup", &(ordinal + 1)).await?;
        Ok(ordinal + 1 == count)
    })
    .await
}
