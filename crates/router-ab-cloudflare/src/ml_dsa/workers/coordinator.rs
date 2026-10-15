//! Gateway-authenticated admission. The Router never receives private preparation.
use super::*;

pub(crate) async fn handle_admit(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA admission requires POST", 405);
    }
    let input: super::super::SigningRequest = decode_bounded_json_request(&mut request, 16_384)
        .await
        .map_err(protocol_error)?;
    let policy = policy(env).map_err(protocol_error)?;
    let decision: Decision = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::Begin { request: input },
    )
    .await
    .map_err(protocol_error)?;
    let Decision::Claimed { claim } = decision else {
        return Response::from_json(&decision);
    };
    let outcome = reserve_pair(env, &policy, &claim).await;
    match outcome {
        Ok((batches, retry_at_ms)) if batches.len() >= policy.minimum_ready_batches() => {
            let result: Result<Decision> = service_call(
                env,
                CallAuthority::Gateway(request.headers()),
                &AdmissionCommand::Admit {
                    claim: claim.clone(),
                    batches: batches.clone(),
                },
            )
            .await;
            match result {
                Ok(decision) => Response::from_json(&decision),
                Err(error) => {
                    // Admission may have committed despite a lost response. Do not release.
                    let _ = retry_at_ms;
                    Err(protocol_error(error))
                }
            }
        }
        Ok((batches, retry_at_ms)) => {
            let _: bool = service_call(
                env,
                CallAuthority::Gateway(request.headers()),
                &AdmissionCommand::Cancel {
                    claim: claim.clone(),
                },
            )
            .await
            .map_err(protocol_error)?;
            release_pair(env, &claim.request, batches, pool::Settlement::Declined)
                .await
                .map_err(protocol_error)?;
            Response::from_json(&Decision::Unavailable {
                reason: admission::UnavailableReason::EmptyPool,
                retry_at_ms,
            })
        }
        Err(error) => {
            // No admission was attempted. Cancellation fences both participants.
            let _: bool = service_call(
                env,
                CallAuthority::Gateway(request.headers()),
                &AdmissionCommand::Cancel {
                    claim: claim.clone(),
                },
            )
            .await
            .map_err(protocol_error)?;
            // A partial reservation expires without ever exposing private material.
            Err(protocol_error(error))
        }
    }
}
async fn reserve_pair(env: &Env, policy: &Policy, claim: &Claim) -> Result<(Vec<[u8; 32]>, u64)> {
    let query = RoleCommand::Inventory {
        key: claim.request.key.clone(),
        target: policy.refill_target_batches(),
        ready_until_ms: claim.expires_at_ms,
    };
    let (a, b) = futures::join!(
        role_call::<pool::Inventory>(env, "DERIVER_A", &query),
        role_call::<pool::Inventory>(env, "DERIVER_B", &query)
    );
    let (a, b) = (a?, b?);
    let only_a: Vec<_> = a
        .ready
        .iter()
        .filter(|id| !b.ready.contains(id))
        .copied()
        .collect();
    let only_b: Vec<_> = b
        .ready
        .iter()
        .filter(|id| !a.ready.contains(id))
        .copied()
        .collect();
    let (retire_a, retire_b) = futures::join!(
        reconcile_unpaired(env, &claim.request.key, "DERIVER_A", "DERIVER_B", only_a),
        reconcile_unpaired(env, &claim.request.key, "DERIVER_B", "DERIVER_A", only_b),
    );
    retire_a?;
    retire_b?;

    let batches: Vec<_> = a
        .ready
        .iter()
        .filter(|id| b.ready.contains(id))
        .copied()
        .collect();
    let retry = a.retry_at_ms.max(b.retry_at_ms);
    if batches.len() < policy.minimum_ready_batches() {
        return Ok((Vec::new(), retry));
    }
    let command = RoleCommand::Reserve {
        claim: claim.clone(),
        batches: batches.clone(),
    };
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &command),
        role_call::<bool>(env, "DERIVER_B", &command)
    );
    if !a? || !b? {
        return Err(invalid("ML-DSA role refused reservation"));
    }
    Ok((batches, retry))
}
async fn release_pair(
    env: &Env,
    request: &super::super::SigningRequest,
    batches: Vec<[u8; 32]>,
    settlement: pool::Settlement,
) -> Result<()> {
    let fence = RoleCommand::Fence {
        request: request.clone(),
        batches: batches.clone(),
    };
    let (a, b) = futures::join!(
        role_call::<Vec<[u8; 32]>>(env, "DERIVER_A", &fence),
        role_call::<Vec<[u8; 32]>>(env, "DERIVER_B", &fence)
    );
    let mut consumed_union = a?;
    for id in b? {
        if !consumed_union.contains(&id) {
            consumed_union.push(id);
        }
    }
    let command = RoleCommand::Release {
        request: request.clone(),
        batches,
        settlement,
        consumed_union,
    };
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &command),
        role_call::<bool>(env, "DERIVER_B", &command)
    );
    if !a? || !b? {
        return Err(invalid("ML-DSA reservation release failed"));
    }
    Ok(())
}
async fn role_call<T: serde::de::DeserializeOwned>(
    env: &Env,
    binding: &str,
    command: &RoleCommand,
) -> Result<T> {
    let mut response = crate::router_coordinator::post_role_request(
        env,
        binding,
        "https://ml-dsa-role.internal",
        ROLE_PATH,
        "ML-DSA role storage",
        command,
        None,
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA role storage refused the request"));
    }
    response.json().await.map_err(storage_error)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteRequest {
    permit: Permit,
    completion: Completion,
}
pub(crate) async fn handle_complete(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA completion requires POST", 405);
    }
    let input: CompleteRequest = decode_bounded_json_request(&mut request, 131_072)
        .await
        .map_err(protocol_error)?;
    let result: Status = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::Finish {
            permit: input.permit.clone(),
            completion: input.completion,
        },
    )
    .await
    .map_err(protocol_error)?;
    let settlement = match result {
        Status::Succeeded { .. } => pool::Settlement::Succeeded,
        Status::Failed => pool::Settlement::Failed,
        Status::Declined => pool::Settlement::Declined,
        Status::Preparing { .. } | Status::Running { .. } => {
            return Response::error("ML-DSA completion is not terminal", 409)
        }
    };
    release_pair(env, &input.permit.request, input.permit.batches, settlement)
        .await
        .map_err(protocol_error)?;
    Response::from_json(&result)
}
pub(crate) async fn handle_status(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA status requires POST", 405);
    }
    let input: super::super::SigningRequest = decode_bounded_json_request(&mut request, 16_384)
        .await
        .map_err(protocol_error)?;
    let result: Option<Status> = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::Lookup { request: input },
    )
    .await
    .map_err(protocol_error)?;
    Response::from_json(&result)
}

/// The Gateway must complete its custody verification before calling this route.
/// The Router pins exact activation authority before either role can install it.
pub(crate) async fn handle_activate(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA activation requires POST", 405);
    }
    let activation: admission::KeyActivation = decode_bounded_json_request(&mut request, 16_384)
        .await
        .map_err(protocol_error)?;
    let command = RoleCommand::Install {
        key: activation.key.clone(),
    };
    let _: bool = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::AuthorizeKey { activation },
    )
    .await
    .map_err(protocol_error)?;
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &command),
        role_call::<bool>(env, "DERIVER_B", &command)
    );
    if !a.map_err(protocol_error)? || !b.map_err(protocol_error)? {
        return Response::error("ML-DSA key activation is incomplete", 503);
    }
    Response::from_json(&true)
}

async fn reconcile_unpaired(
    env: &Env,
    key: &KeyScope,
    owner: &str,
    peer: &str,
    batches: Vec<[u8; 32]>,
) -> Result<()> {
    if batches.is_empty() {
        return Ok(());
    }
    let states: Vec<pool::BatchAvailability> = role_call(
        env,
        peer,
        &RoleCommand::Inspect {
            key: key.clone(),
            batches: batches.clone(),
        },
    )
    .await?;
    if states.len() != batches.len() {
        return Err(invalid("ML-DSA peer inventory length changed"));
    }
    let retired: Vec<_> = batches
        .into_iter()
        .zip(states)
        .filter_map(retired_batch)
        .collect();
    if !retired.is_empty() {
        let accepted: bool = role_call(
            env,
            owner,
            &RoleCommand::RetireUnpaired {
                key: key.clone(),
                batches: retired,
            },
        )
        .await?;
        if !accepted {
            return Err(invalid("ML-DSA orphan retirement failed"));
        }
    }
    Ok(())
}
fn retired_batch((batch, state): ([u8; 32], pool::BatchAvailability)) -> Option<[u8; 32]> {
    if state == pool::BatchAvailability::Retired {
        Some(batch)
    } else {
        None
    }
}
