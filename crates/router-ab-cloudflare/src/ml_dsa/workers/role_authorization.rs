//! Live role authority checks before pool mutations.
use super::*;
use crate::ml_dsa::registration as registration_core;

pub(super) async fn authorize_role_command(env: &Env, command: &RoleCommand) -> Result<()> {
    let (request, expected) = match command {
        RoleCommand::InitializeRegistrationStorage { claim } => {
            let allowed: bool = service_call(
                env,
                CallAuthority::Internal,
                &admission_requests::check_registration_claim(claim.clone()),
            )
            .await?;
            return if allowed {
                Ok(())
            } else {
                Err(invalid(
                    "Storage initialization requires a live registration",
                ))
            };
        }
        RoleCommand::InstallRegistrationStock { claim, delivery } => {
            let allowed: bool = service_call(
                env,
                CallAuthority::Internal,
                &admission_requests::check_registration_claim(claim.clone()),
            )
            .await?;
            if !allowed {
                return Err(invalid("Registration signing stock lacks exact admission"));
            }
            if let RegistrationStockDelivery::Pair([first, second]) = delivery {
                if first.ordinal % 2 != 0 || first.ordinal.checked_add(1) != Some(second.ordinal) {
                    return Err(invalid("Registration stock delivery has invalid ordinals"));
                }
            }
            for batch in delivery.batches() {
                let binding = &batch.binding;
                check_signing_scope(env, &binding.key)?;
                let expected_batch =
                    registration_core::signing_batch_id(&claim.job, batch.ordinal)?;
                if batch.ordinal >= claim.job.signing_batches
                    || binding.batch != expected_batch
                    || binding.key.wallet != claim.request.wallet
                    || binding.key.key_id != claim.request.key_id
                    || binding.key.epoch != claim.request.epoch
                    || binding.key.schedule_digest != claim.job.signing_schedule
                    || binding.expires_at_ms != claim.job.expires_at
                {
                    return Err(invalid("Registration signing stock lacks exact admission"));
                }
            }
            return Ok(());
        }
        RoleCommand::StartRefill { job } | RoleCommand::Put { job, .. } => {
            return preparation::check_job(env, job).await;
        }
        RoleCommand::Reserve { claim, batches } => {
            if batches.len() > policy(env)?.refill_target_batches() {
                return Err(invalid(
                    "ML-DSA reservation exceeds configured candidate capacity",
                ));
            }
            (
                &claim.request,
                Status::Preparing {
                    claim: claim.clone(),
                },
            )
        }
        RoleCommand::Take { permit, .. } | RoleCommand::LoadSigningInputs { permit } => (
            &permit.request,
            Status::Running {
                permit: permit.clone(),
            },
        ),
        RoleCommand::Fence { request, .. } => {
            let actual: Option<Status> = service_call(
                env,
                CallAuthority::Internal,
                &admission_requests::lookup(request.clone()),
            )
            .await?;
            return match actual {
                Some(
                    Status::Succeeded { .. } | Status::Failed { .. } | Status::Declined { .. },
                ) => Ok(()),
                _ => Err(invalid("ML-DSA operation is still active")),
            };
        }
        RoleCommand::Release {
            request,
            settlement,
            ..
        } => {
            let actual: Option<Status> = service_call(
                env,
                CallAuthority::Internal,
                &admission_requests::lookup(request.clone()),
            )
            .await?;
            let expected = match actual {
                Some(Status::Succeeded { .. }) => pool::Settlement::Succeeded,
                Some(Status::Failed { .. }) => pool::Settlement::Failed,
                Some(Status::Declined { .. }) => pool::Settlement::Declined,
                _ => return Err(invalid("ML-DSA operation is still active")),
            };
            return if *settlement == expected {
                Ok(())
            } else {
                Err(invalid("ML-DSA settlement changed"))
            };
        }
        RoleCommand::InstallMaterial { record } => {
            let actual: Option<admission::KeyState> = service_call(
                env,
                CallAuthority::Internal,
                &admission_requests::key_state(record.activation.key.clone()),
            )
            .await?;
            if actual.as_ref().map(admission::KeyState::activation) != Some(&record.activation) {
                return Err(invalid("ML-DSA role material lacks custody authorization"));
            }
            let secrets = executor::wrapping_key(env)?;
            drop(record.open(
                configured_role(env).map_err(storage_error)?,
                &secrets.0,
                &secrets.1,
            )?);
            return Ok(());
        }
        RoleCommand::Install { key } => {
            let actual: Option<admission::KeyState> = service_call(
                env,
                CallAuthority::Internal,
                &admission_requests::key_state(key.clone()),
            )
            .await?;
            if actual.as_ref().map(|value| &value.activation().key) != Some(key) {
                return Err(invalid(
                    "ML-DSA installation lacks Gateway custody authorization",
                ));
            }
            return Ok(());
        }
        RoleCommand::WakeRefill { key } => {
            check_signing_scope(env, key)?;
            let active: Option<admission::KeyActivation> = service_call(
                env,
                CallAuthority::Internal,
                &admission_requests::active_key(key.clone()),
            )
            .await?;
            return if active.as_ref().map(|activation| &activation.key) == Some(key) {
                Ok(())
            } else {
                Err(invalid("ML-DSA refill wake key is inactive"))
            };
        }
        RoleCommand::CheckMaterial { .. }
        | RoleCommand::Inventory { .. }
        | RoleCommand::LiveInventory { .. }
        | RoleCommand::RefillStatus { .. }
        | RoleCommand::PublicationRecorded { .. }
        | RoleCommand::Inspect { .. }
        | RoleCommand::RetireSpent { .. }
        | RoleCommand::RetireUnpaired { .. } => return Ok(()),
    };
    check_signing_scope(env, &request.key)?;
    let actual: Option<Status> = service_call(
        env,
        CallAuthority::Internal,
        &admission_requests::lookup(request.clone()),
    )
    .await?;
    if actual.as_ref() != Some(&expected) {
        return Err(invalid("ML-DSA Router admission is absent or stale"));
    }
    Ok(())
}
