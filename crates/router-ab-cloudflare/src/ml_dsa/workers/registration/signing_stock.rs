//! Key-independent signing batches prepared before registration, then rebound once.
use super::*;
use ed25519_yao::ml_dsa_signing::prepared_signing::gmw::prepare_gmw_reservation;
const DOMAIN: &[u8] = b"seams/ml-dsa/registration-signing-stock/v1";
#[derive(Serialize, Deserialize)]
struct Stored {
    encapsulated_key: [u8; 32],
    chunks: usize,
}
fn batch(job: &core::Job, ordinal: usize) -> Result<[u8; 32]> {
    digest(DOMAIN, &(job.id, ordinal))
}
pub(super) async fn prepare(
    env: &Env,
    state: &State,
    job: &core::Job,
    role: SigningRole,
    seed: &[u8; 32],
    wire: &mut impl ed25519_yao::ml_dsa_runtime::boolean_comparison::Transport,
) -> Result<()> {
    let schedules = super::super::schedules::load()?;
    if execution::schedule_digest(&schedules) != job.signing_schedule {
        return Err(invalid("Registration signing schedule changed"));
    }
    let participant = configured_role(env).map_err(storage_error)?;
    let mut topologies = Default::default();
    for ordinal in 0..job.signing_batches {
        let id = batch(job, ordinal)?;
        let prepared = prepare_gmw_reservation(role, id, 4, &schedules, &mut topologies, wire)
            .await
            .map_err(runtime_error)?;
        let sealed = sealing::seal_bound(
            prepared.into_storage(),
            DOMAIN,
            &(job, participant, ordinal),
            seed,
        )?;
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
        })
        .await?;
    }
    Ok(())
}
pub(super) async fn install(
    env: &Env,
    state: &State,
    claim: &core::Claim,
    key: &KeyScope,
) -> Result<()> {
    let participant = configured_role(env).map_err(storage_error)?;
    let (version, seed) = executor::wrapping_key(env)?;
    for ordinal in 0..claim.job.signing_batches {
        let name = format!("registration-signing/{ordinal}/installed");
        if state
            .storage()
            .get::<bool>(&name)
            .await
            .map_err(storage_error)?
            .unwrap_or(false)
        {
            continue;
        }
        let sealed = transaction(state, move |store| async move {
            let prefix = format!("registration-signing/{ordinal}");
            let record: Stored = store
                .get(&format!("{prefix}/record"))
                .await?
                .ok_or_else(|| invalid("Missing generic signing preparation"))?;
            sealing::Sealed::load_chunks(&store, &prefix, record.chunks, record.encapsulated_key)
                .await
        })
        .await?;
        let bytes =
            sealing::open_bound(sealed, DOMAIN, &(&claim.job, participant, ordinal), &seed)?;
        let binding = Binding {
            key: key.clone(),
            role: participant,
            batch: batch(&claim.job, ordinal)?,
            expires_at_ms: claim.job.expires_at,
            wrapping_key_version: version.clone(),
        };
        let sealed = sealing::seal(bytes, &binding, &seed)?;
        // Persist the rebound ciphertext before delivery so a lost response retries exact bytes.
        let delivery = format!("registration-signing/{ordinal}/delivery");
        let sealed = transaction(state, move |store| async move {
            let record_name = format!("{delivery}/record");
            if let Some(record) = store.get::<Stored>(&record_name).await? {
                return Sealed::load_chunks(
                    &store,
                    &delivery,
                    record.chunks,
                    record.encapsulated_key,
                )
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
        state
            .storage()
            .put(&name, &true)
            .await
            .map_err(storage_error)?;
    }
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
