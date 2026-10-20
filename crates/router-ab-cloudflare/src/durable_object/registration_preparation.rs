//! Input-free root grants and durable, one-time registration input bindings.

mod bound_input;
pub(crate) use bound_input::BoundRegistrationUse;
use bound_input::PreparationAccess;

use router_ab_core::{
    Ed25519YaoInputPairBindingV1, RouterAbProtocolResult, TenantRootCustodyBindingV1,
};
use serde::Deserialize;
use worker::{Env, Response, SqlStorage, SqlStorageValue, State};

use crate::registration_pair_preparation::RegistrationPreparation;
use crate::tenant_root_role_d1::{
    CloudflareTenantRootRoleShareStoreV1, RootUseAccess, TenantRootRootUseAttemptV1,
};
use crate::tenant_root_role_runtime::AttemptConflictV1;
use crate::{CloudflareEd25519YaoTenantRootContextV2, CloudflareWorkerEnvReaderV1};

pub(crate) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS yao_registration_preparation (
    id INTEGER PRIMARY KEY CHECK (id = 1), preparation_json TEXT NOT NULL,
    admitted INTEGER NOT NULL CHECK (admitted IN (0, 1))
);
CREATE TABLE IF NOT EXISTS yao_registration_input_binding (
    session_hex TEXT PRIMARY KEY, use_json TEXT NOT NULL
)";

#[derive(Deserialize)]
struct Row {
    preparation_json: String,
    admitted: i32,
}

pub(crate) fn read(sql: &SqlStorage) -> worker::Result<Option<RegistrationPreparation>> {
    sql.exec(SCHEMA, None)?;
    let row = sql
        .exec(
            "SELECT preparation_json, admitted FROM yao_registration_preparation WHERE id = 1",
            None,
        )?
        .to_array::<Row>()?
        .into_iter()
        .next();
    row.map(|row| serde_json::from_str(&row.preparation_json).map_err(error))
        .transpose()
}

pub(crate) fn is_admitted(sql: &SqlStorage) -> worker::Result<bool> {
    Ok(sql
        .exec(
            "SELECT preparation_json, admitted FROM yao_registration_preparation WHERE id = 1",
            None,
        )?
        .to_array::<Row>()?
        .first()
        .is_some_and(|row| row.admitted == 1))
}

pub(crate) async fn admit(
    state: &State,
    sql: &SqlStorage,
    env: &Env,
    request: RegistrationPreparation,
) -> worker::Result<RegistrationPreparation> {
    sql.exec(SCHEMA, None)?;
    expire(state, sql, env).await?;
    let now = worker::Date::now().as_millis();
    request
        .authenticate(&CloudflareWorkerEnvReaderV1::new(env), now)
        .map_err(error)?;
    if let Some(prepared) = bound_input::replay(sql, &request)? {
        return Ok(prepared);
    }
    let encoded = serde_json::to_string(&request).map_err(error)?;
    sql.exec("INSERT INTO yao_registration_preparation (id, preparation_json, admitted) VALUES (1, ?, 0) ON CONFLICT DO NOTHING",
        vec![SqlStorageValue::String(encoded)])?;
    let row = sql
        .exec(
            "SELECT preparation_json, admitted FROM yao_registration_preparation WHERE id = 1",
            None,
        )?
        .one::<Row>()?;
    let stored: RegistrationPreparation =
        serde_json::from_str(&row.preparation_json).map_err(error)?;
    if stored.request != request.request || stored.wallet_route != request.wallet_route {
        return Err(error(
            "A registration preparation already occupies this wallet",
        ));
    }
    // The first request fixes the epoch and deadline. Retries cannot extend either.
    let binding = stored
        .authenticate(&CloudflareWorkerEnvReaderV1::new(env), now)
        .map_err(error)?;
    state
        .storage()
        .set_alarm(std::time::Duration::from_millis(
            stored.custody_binding.expires_at_ms.saturating_sub(now),
        ))
        .await?;
    if row.admitted == 0 {
        let store = CloudflareTenantRootRoleShareStoreV1::from_env(env).map_err(error)?;
        let outcome = store
            .load_bound_with_access(
                &binding,
                &TenantRootRootUseAttemptV1::Ed25519YaoPairSession {
                    session: stored.session(),
                    pair_object: Some(state.id().to_string()),
                },
                now,
                RootUseAccess::PrepareRegistration,
            )
            .await;
        match outcome {
            Ok(crate::tenant_root_role_d1::TenantRootBoundShareV1::Readable(_)) => {}
            Ok(_) => {
                release(&state.id().to_string(), sql, env, &stored).await?;
                return Err(error("Registration root preparation was refused"));
            }
            Err(cause) => {
                release(&state.id().to_string(), sql, env, &stored).await?;
                return Err(error(cause));
            }
        }
        // Expiry and cleanup can run while the role store is awaiting D1.
        if worker::Date::now().as_millis() >= stored.custody_binding.expires_at_ms
            || read(sql)?.as_ref() != Some(&stored)
        {
            release(&state.id().to_string(), sql, env, &stored).await?;
            return Err(error("Registration preparation expired during admission"));
        }
        // A fence can arrive during the role-store admission.
        require_unfenced(sql, &stored)?;
        sql.exec("UPDATE yao_registration_preparation SET admitted = 1 WHERE id = 1 AND preparation_json = ?",
            vec![SqlStorageValue::String(row.preparation_json)])?;
    }
    require_unfenced(sql, &stored)?;
    Ok(stored)
}

pub(crate) fn require_unfenced(
    sql: &SqlStorage,
    preparation: &RegistrationPreparation,
) -> worker::Result<()> {
    require_session_unfenced(sql, &preparation.session())
}

pub(crate) fn require_session_unfenced(sql: &SqlStorage, session: &[u8; 32]) -> worker::Result<()> {
    let session = crate::ed25519_yao_lifecycle::role_d1::encode_hex(*session);
    #[derive(Deserialize)]
    struct Count {
        count: u32,
    }
    let count = sql
        .exec(
            "SELECT (SELECT count(*) FROM wallet_relocation_source) + \
         (SELECT count(*) FROM wallet_relocation_preparation) + \
         (SELECT count(*) FROM yao_pair_admission_fences WHERE session_hex = ?) AS count",
            vec![SqlStorageValue::String(session)],
        )?
        .one::<Count>()?
        .count;
    if count != 0 {
        return Err(error("Registration preparation is fenced"));
    }
    Ok(())
}

pub(crate) async fn access_for_execution(
    state_id: &str,
    sql: &SqlStorage,
    env: &Env,
    context: &CloudflareEd25519YaoTenantRootContextV2,
    pair: &Ed25519YaoInputPairBindingV1,
) -> worker::Result<RootUseAccess> {
    sql.exec(SCHEMA, None)?;
    match bound_input::access(state_id, sql, env, context, pair)? {
        PreparationAccess::Bound(binding) => {
            return Ok(RootUseAccess::ReadPreparedRegistration(binding))
        }
        PreparationAccess::Released => return Ok(RootUseAccess::Admit),
        PreparationAccess::Unbound => {}
    }
    let Some(prepared) = read(sql)? else {
        return Ok(RootUseAccess::Admit);
    };
    while prepared.custody_binding.expires_at_ms > worker::Date::now().as_millis()
        && read(sql)?.as_ref() == Some(&prepared)
        && !is_admitted(sql)?
    {
        // A fence ends the preparation's admission without releasing its row.
        require_unfenced(sql, &prepared)?;
        worker::Delay::from(std::time::Duration::from_millis(10)).await;
    }
    if read(sql)?.as_ref() != Some(&prepared) {
        return Ok(RootUseAccess::Admit);
    }
    if prepared.custody_binding.expires_at_ms <= worker::Date::now().as_millis()
        || !prepared.matches_execution(context, pair)
    {
        release(state_id, sql, env, &prepared).await?;
        return Ok(RootUseAccess::Admit);
    }
    require_unfenced(sql, &prepared)?;
    let binding = bound_input::consume(state_id, sql, env, &prepared, context, pair)?;
    Ok(RootUseAccess::ReadPreparedRegistration(binding))
}

/// Restores the same local authority after eviction or a retained preparation.
/// A missing local binding uses the ordinary exact-input D1 admission format.
pub(crate) fn read_admitted_access(
    state_id: &str,
    sql: &SqlStorage,
    env: &Env,
    context: &CloudflareEd25519YaoTenantRootContextV2,
    pair: &Ed25519YaoInputPairBindingV1,
) -> worker::Result<RootUseAccess> {
    sql.exec(SCHEMA, None)?;
    match bound_input::access(state_id, sql, env, context, pair)? {
        PreparationAccess::Bound(binding) => Ok(RootUseAccess::ReadPreparedRegistration(binding)),
        PreparationAccess::Unbound | PreparationAccess::Released => Ok(RootUseAccess::ReadAdmitted),
    }
}

/// Runs `load` with this execution's root-use access.
///
/// An execution can reach a late-starting wallet object before the setup
/// preparation of its own pair. It then admits fresh, and if the
/// preparation's admission commits first, the fresh admission conflicts.
/// The preparation writes its row before its admission, so a second look
/// binds to it, as if the execution had arrived after it. A conflict with any
/// other admission still fails. The store refuses a conflicting admission
/// before any share is opened, so the share is still opened once.
pub(crate) async fn load_for_execution<T, Load, Loaded>(
    state_id: &str,
    sql: &SqlStorage,
    env: &Env,
    context: &CloudflareEd25519YaoTenantRootContextV2,
    pair: &Ed25519YaoInputPairBindingV1,
    load: Load,
) -> worker::Result<RouterAbProtocolResult<T>>
where
    Load: Fn(RootUseAccess) -> Loaded,
    Loaded: std::future::Future<Output = RouterAbProtocolResult<Result<T, AttemptConflictV1>>>,
{
    let access = access_for_execution(state_id, sql, env, context, pair).await?;
    let admitted_fresh = matches!(access, RootUseAccess::Admit);
    let loaded = match load(access).await {
        Ok(Err(conflict)) if admitted_fresh => {
            match access_for_execution(state_id, sql, env, context, pair).await? {
                RootUseAccess::Admit => Ok(Err(conflict)),
                access => load(access).await,
            }
        }
        loaded => loaded,
    };
    // Root lookup yields: a cancellation or relocation can fence this object
    // while D1 answers. No prepared pair may be published after that fence.
    require_session_unfenced(sql, &pair.session())?;
    Ok(loaded.and_then(|loaded| loaded.map_err(AttemptConflictV1::into_error)))
}

pub(crate) async fn expire(state: &State, sql: &SqlStorage, env: &Env) -> worker::Result<Response> {
    if let Some(preparation) = read(sql)? {
        if preparation.custody_binding.expires_at_ms <= worker::Date::now().as_millis() {
            release(&state.id().to_string(), sql, env, &preparation).await?;
        }
    }
    Response::from_json(&true)
}

async fn release(
    object_id: &str,
    sql: &SqlStorage,
    env: &Env,
    preparation: &RegistrationPreparation,
) -> worker::Result<()> {
    // Authenticate at issue time so expiry still permits cleanup of this exact row.
    let binding = preparation
        .authenticate(
            &CloudflareWorkerEnvReaderV1::new(env),
            preparation.custody_binding.issued_at_ms,
        )
        .map_err(error)?;
    if bound_input::release_unconsumed(sql, preparation)? {
        CloudflareTenantRootRoleShareStoreV1::from_env(env)
            .map_err(error)?
            .release_registration_preparation(&preparation.session(), object_id, &digest(&binding)?)
            .await
            .map_err(error)?;
    }
    sql.exec(
        "DELETE FROM yao_registration_preparation WHERE id = 1 AND preparation_json = ?",
        vec![SqlStorageValue::String(
            serde_json::to_string(preparation).map_err(error)?,
        )],
    )?;
    Ok(())
}

fn digest(binding: &TenantRootCustodyBindingV1) -> worker::Result<[u8; 32]> {
    Ok(*binding.attempt_digest().map_err(error)?.as_bytes())
}

fn error(value: impl std::fmt::Display) -> worker::Error {
    worker::Error::RustError(value.to_string())
}
