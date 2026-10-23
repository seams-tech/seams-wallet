//! Key-independent signing batches prepared before registration, then rebound once.
use super::*;
use ed25519_yao::ml_dsa_signing::prepared_signing::gmw::prepare_gmw_reservations;
const DOMAIN: &[u8] = b"seams/ml-dsa/registration-signing-stock/v2";
#[derive(Serialize, Deserialize)]
struct Stored {
    encapsulated_key: [u8; 32],
    chunks: usize,
}
pub(super) async fn prepare(
    env: &Env,
    state: &State,
    job: &core::Job,
    role: SigningRole,
    seed: &[u8; 32],
    wire: &mut impl ed25519_yao::ml_dsa_runtime::boolean_comparison::Transport,
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
                            &Stored {
                                encapsulated_key: sealed.encapsulated_key,
                                chunks,
                            },
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
    let wrapping = executor::wrapping_key(env)?;
    let mut ordinal = 0;
    while ordinal < claim.job.signing_batches {
        let first = install_batch(env, state, claim, key, participant, &wrapping, ordinal);
        if ordinal + 1 < claim.job.signing_batches {
            // Drain both deliveries before returning an error or starting another pair.
            let (first, second) = futures::join!(
                first,
                install_batch(env, state, claim, key, participant, &wrapping, ordinal + 1),
            );
            first?;
            second?;
        } else {
            first.await?;
        }
        ordinal += 2;
    }
    Ok(())
}

async fn install_batch(
    env: &Env,
    state: &State,
    claim: &core::Claim,
    key: &KeyScope,
    participant: Participant,
    wrapping: &(Identifier, Zeroizing<[u8; 32]>),
    ordinal: usize,
) -> Result<()> {
    let (version, seed) = wrapping;
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
        return Ok(());
    }
    trace.mark("installation_checked");
    let sealed = transaction(state, move |store| async move {
        let prefix = format!("registration-signing/{ordinal}");
        let record: Stored = store
            .get(&format!("{prefix}/record"))
            .await?
            .ok_or_else(|| invalid("Missing generic signing preparation"))?;
        sealing::Sealed::load_chunks(&store, &prefix, record.chunks, record.encapsulated_key).await
    })
    .await?;
    trace.mark("stock_loaded");
    let bytes = sealing::open_bound(sealed, DOMAIN, &(&claim.job, participant, ordinal), &seed)?;
    let binding = Binding {
        key: key.clone(),
        role: participant,
        batch: core::signing_batch_id(&claim.job, ordinal)?,
        expires_at_ms: claim.job.expires_at,
        wrapping_key_version: version.clone(),
    };
    let sealed = sealing::seal(bytes, &binding, &seed)?;
    trace.mark("stock_resealed");
    // Persist the rebound ciphertext before delivery so a lost response retries exact bytes.
    let delivery = format!("registration-signing/{ordinal}/delivery");
    let sealed = transaction(state, move |store| async move {
        let record_name = format!("{delivery}/record");
        if let Some(record) = store.get::<Stored>(&record_name).await? {
            return Sealed::load_chunks(&store, &delivery, record.chunks, record.encapsulated_key)
                .await;
        }
        let chunks = sealed.store_chunks(&store, &delivery).await?;
        store
            .put(
                &record_name,
                &Stored {
                    encapsulated_key: sealed.encapsulated_key,
                    chunks,
                },
            )
            .await?;
        Ok(sealed)
    })
    .await?;
    trace.mark("delivery_persisted");
    let response = local_call(
        env,
        &RoleCommand::InstallRegistrationBatch {
            claim: claim.clone(),
            ordinal,
            binding,
            sealed,
        },
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("Initial signing stock installation failed"));
    }
    trace.mark("delivery_acknowledged");
    state
        .storage()
        .put(&name, &true)
        .await
        .map_err(storage_error)?;
    trace.finish();
    Ok(())
}

pub(super) async fn retire_next(state: &State, count: usize) -> Result<bool> {
    transaction(state, move |store| async move {
        let ordinal: usize = store.get("signing-cleanup").await?.unwrap_or(0);
        if ordinal >= count {
            return Ok(true);
        }
        for prefix in [
            format!("registration-signing/{ordinal}"),
            format!("registration-signing/{ordinal}/delivery"),
        ] {
            if let Some(record) = store.get::<Stored>(&format!("{prefix}/record")).await? {
                sealing::erase_chunks(&store, &prefix, record.chunks).await?;
                store.delete(&format!("{prefix}/record")).await?;
            }
        }
        store.put("signing-cleanup", &(ordinal + 1)).await?;
        Ok(ordinal + 1 == count)
    })
    .await
}
