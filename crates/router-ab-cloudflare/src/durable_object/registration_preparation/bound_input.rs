//! One irreversible choice of input for a prepared registration grant.

use router_ab_core::{Ed25519YaoInputPairBindingV1, TenantRootCustodyBindingV1};
use serde::{Deserialize, Serialize};
use worker::{Env, SqlStorage, SqlStorageValue};

use super::{digest, error, require_unfenced};
use crate::registration_pair_preparation::RegistrationPreparation;
use crate::tenant_root_role_d1::TenantRootRootUseAttemptV1;
use crate::{CloudflareEd25519YaoTenantRootContextV2, CloudflareWorkerEnvReaderV1, WalletObjectId};

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum PreparationUse {
    Bound {
        preparation: RegistrationPreparation,
        attempt_digest: [u8; 32],
        bound_at_ms: u64,
    },
    Released,
}

/// Only a checked durable local binding can authorize the prepared D1 grant.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct BoundRegistrationUse {
    preparation_digest: [u8; 32],
    attempt_digest: [u8; 32],
    session: [u8; 32],
    object_id: WalletObjectId,
}

impl BoundRegistrationUse {
    pub(crate) fn preparation_digest(self) -> [u8; 32] {
        self.preparation_digest
    }

    pub(crate) fn authorizes(
        self,
        attempt: &TenantRootRootUseAttemptV1,
        digest: &[u8; 32],
    ) -> bool {
        self.attempt_digest == *digest
            && matches!(attempt, TenantRootRootUseAttemptV1::Ed25519YaoPairSession {
                session, pair_object: Some(object),
            } if *session == self.session && object == self.object_id.as_str())
    }
}

pub(super) enum PreparationAccess {
    Unbound,
    Released,
    Bound(BoundRegistrationUse),
}

#[derive(Deserialize)]
struct StoredUse {
    use_json: String,
}

fn load(sql: &SqlStorage, session: &[u8; 32]) -> worker::Result<Option<PreparationUse>> {
    let session_hex = crate::ed25519_yao_lifecycle::role_d1::encode_hex(*session);
    let row = sql
        .exec(
            "SELECT use_json FROM yao_registration_input_binding WHERE session_hex = ?",
            vec![SqlStorageValue::String(session_hex)],
        )?
        .to_array::<StoredUse>()?
        .into_iter()
        .next();
    row.map(|row| serde_json::from_str(&row.use_json).map_err(error))
        .transpose()
}

fn insert_once(sql: &SqlStorage, session: &[u8; 32], value: PreparationUse) -> worker::Result<()> {
    sql.exec(
        "INSERT INTO yao_registration_input_binding (session_hex, use_json) VALUES (?, ?) \
         ON CONFLICT DO NOTHING",
        vec![
            SqlStorageValue::String(crate::ed25519_yao_lifecycle::role_d1::encode_hex(*session)),
            SqlStorageValue::String(serde_json::to_string(&value).map_err(error)?),
        ],
    )?;
    Ok(())
}

fn authenticate_execution(
    env: &Env,
    context: &CloudflareEd25519YaoTenantRootContextV2,
    pair: &Ed25519YaoInputPairBindingV1,
) -> worker::Result<TenantRootCustodyBindingV1> {
    context.validate_for_pair(pair).map_err(error)?;
    let binding = context
        .custody_binding
        .authenticate_for_ed25519_yao_v1(
            &CloudflareWorkerEnvReaderV1::new(env),
            pair,
            &context.application,
            context.participant_ids,
            worker::Date::now().as_millis(),
        )
        .map_err(error)?;
    if context.identity.digest().map_err(error)? != binding.identity_digest() {
        return Err(error("Registration input names another root identity"));
    }
    Ok(binding)
}

pub(super) fn access(
    object_id: &str,
    sql: &SqlStorage,
    env: &Env,
    context: &CloudflareEd25519YaoTenantRootContextV2,
    pair: &Ed25519YaoInputPairBindingV1,
) -> worker::Result<PreparationAccess> {
    let Some(record) = load(sql, &pair.session())? else {
        return Ok(PreparationAccess::Unbound);
    };
    let PreparationUse::Bound {
        preparation,
        attempt_digest,
        bound_at_ms,
    } = record
    else {
        return Ok(PreparationAccess::Released);
    };
    if preparation.session() != pair.session() || !preparation.matches_execution(context, pair) {
        return Err(error(
            "Registration input conflicts with its durable preparation",
        ));
    }
    // The original grant had to be valid when consumed. Its prompt deadline
    // does not renew, nor cancel an already bound execution on expiry.
    let grant = preparation
        .authenticate(&CloudflareWorkerEnvReaderV1::new(env), bound_at_ms)
        .map_err(error)?;
    let execution = authenticate_execution(env, context, pair)?;
    if digest(&execution)? != attempt_digest {
        return Err(error("Registration input differs from its durable binding"));
    }
    require_unfenced(sql, &preparation)?;
    Ok(PreparationAccess::Bound(BoundRegistrationUse {
        preparation_digest: digest(&grant)?,
        attempt_digest,
        session: pair.session(),
        object_id: WalletObjectId::parse(object_id).map_err(error)?,
    }))
}

pub(super) fn consume(
    object_id: &str,
    sql: &SqlStorage,
    env: &Env,
    preparation: &RegistrationPreparation,
    context: &CloudflareEd25519YaoTenantRootContextV2,
    pair: &Ed25519YaoInputPairBindingV1,
) -> worker::Result<BoundRegistrationUse> {
    let now = worker::Date::now().as_millis();
    preparation
        .authenticate(&CloudflareWorkerEnvReaderV1::new(env), now)
        .map_err(error)?;
    let execution = authenticate_execution(env, context, pair)?;
    if !preparation.matches_execution(context, pair)
        || super::read(sql)?.as_ref() != Some(preparation)
        || !super::is_admitted(sql)?
    {
        return Err(error(
            "Registration preparation changed before input binding",
        ));
    }
    require_unfenced(sql, preparation)?;
    // No await separates the check and insert. Release competes for this same
    // row, and neither Bound nor Released can ever replace the other.
    insert_once(
        sql,
        &pair.session(),
        PreparationUse::Bound {
            preparation: preparation.clone(),
            attempt_digest: digest(&execution)?,
            bound_at_ms: now,
        },
    )?;
    match access(object_id, sql, env, context, pair)? {
        PreparationAccess::Bound(binding) => Ok(binding),
        PreparationAccess::Released | PreparationAccess::Unbound => Err(error(
            "Registration preparation was released before input binding",
        )),
    }
}

/// Linearizes release locally before awaiting D1. A consumed grant stays live
/// until the existing object-first settlement/cancellation protocol closes it.
pub(super) fn release_unconsumed(
    sql: &SqlStorage,
    preparation: &RegistrationPreparation,
) -> worker::Result<bool> {
    insert_once(sql, &preparation.session(), PreparationUse::Released)?;
    Ok(matches!(
        load(sql, &preparation.session())?,
        Some(PreparationUse::Released)
    ))
}

pub(super) fn replay(
    sql: &SqlStorage,
    incoming: &RegistrationPreparation,
) -> worker::Result<Option<RegistrationPreparation>> {
    match load(sql, &incoming.session())? {
        None => Ok(None),
        Some(PreparationUse::Released) => Err(error("Registration preparation was released")),
        Some(PreparationUse::Bound { preparation, .. }) => {
            if preparation.request != incoming.request
                || preparation.wallet_route != incoming.wallet_route
                || preparation.custody_binding.activation_receipt_b64u
                    != incoming.custody_binding.activation_receipt_b64u
            {
                return Err(error(
                    "Registration preparation conflicts with its consumed grant",
                ));
            }
            require_unfenced(sql, &preparation)?;
            Ok(Some(preparation))
        }
    }
}
