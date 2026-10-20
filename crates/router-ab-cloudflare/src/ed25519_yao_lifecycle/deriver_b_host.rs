//! Host-local pair authority and background settlement.
use super::*;

#[derive(Clone)]
pub(crate) enum DeriverBExecutionHostV1 {
    #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
    Wallet(crate::durable_object::RouterAbDeriverBWalletDurableObject),
    #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
    Worker(std::rc::Rc<Context>),
}

impl DeriverBExecutionHostV1 {
    pub(super) fn wait_until<F: Future<Output = ()> + 'static>(&self, future: F) {
        match self {
            #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
            Self::Wallet(object) => object.wait_until(future),
            #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
            Self::Worker(context) => context.wait_until(future),
        }
    }

    /// The revision of the pair record this host holds for the scope, or
    /// `None` without one. A connection waiting for this role's preparation
    /// tries its claim again when the revision changes.
    pub(super) fn pair_revision(
        &self,
        scope: &CloudflareDeriverBWalletPairScopeV1,
    ) -> RouterAbProtocolResult<Option<role_d1::PairRecordRevision>> {
        match self {
            #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
            Self::Wallet(object) => object
                .pair_revision(&scope.pair_binding.session())
                .map_err(|error| invalid_lifecycle(error.to_string())),
            // The role store has no local record to watch: every poll looks
            // like a change, so the claim is simply tried again.
            #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
            Self::Worker(_) => {
                let _ = scope;
                cloudflare_yao_now_unix_ms()
                    .map(|now| Some(role_d1::PairRecordRevision::Input(now)))
                    .map_err(|_| invalid_lifecycle("Yao clock is unavailable"))
            }
        }
    }

    /// Whether this role's preparation for the Router run named by
    /// `outer_binding` failed in this host, so a connection of that run need
    /// not wait for it.
    pub(super) fn preparation_failed(
        &self,
        session: [u8; 32],
        outer_binding: &Ed25519YaoOuterBindingV2,
    ) -> bool {
        match self {
            #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
            Self::Wallet(object) => object.preparation_failed(session, outer_binding),
            #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
            Self::Worker(_) => {
                let _ = (session, outer_binding);
                false
            }
        }
    }

    pub(super) fn root_use_access(
        &self,
        context: &crate::CloudflareEd25519YaoTenantRootContextV2,
        pair: &Ed25519YaoInputPairBindingV1,
    ) -> RouterAbProtocolResult<RootUseAccess> {
        match self {
            #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
            Self::Wallet(object) => object
                .admitted_root_use(context, pair)
                .map_err(|error| invalid_lifecycle(error.to_string())),
            #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
            Self::Worker(_) => {
                let _ = (context, pair);
                Ok(RootUseAccess::ReadAdmitted)
            }
        }
    }

    pub(super) fn require_unfenced(&self, session: &[u8; 32]) -> RouterAbProtocolResult<()> {
        match self {
            #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
            Self::Wallet(object) => object
                .require_root_use_unfenced(session)
                .map_err(|error| invalid_lifecycle(error.to_string())),
            #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
            Self::Worker(_) => {
                let _ = session;
                Ok(())
            }
        }
    }

    pub(super) async fn command(
        &self,
        env: &Env,
        scope: &CloudflareDeriverBWalletPairScopeV1,
        command: DeriverBYaoSessionCommandV1,
        trace_id: RoleTraceContextV1,
    ) -> RouterAbProtocolResult<DeriverBYaoSessionResponseV1> {
        match self {
            #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
            Self::Wallet(object) => {
                let mut response = object
                    .execute_protocol_command(scope.clone(), command)
                    .await
                    .map_err(|error| invalid_lifecycle(error.to_string()))?;
                if !(200..=299).contains(&response.status_code()) {
                    return Err(invalid_lifecycle(format!(
                        "Deriver B local pair command rejected with HTTP {}",
                        response.status_code()
                    )));
                }
                let result = response
                    .json::<DeriverBYaoSessionResponseV1>()
                    .await
                    .map_err(|_| invalid_lifecycle("Deriver B local pair response is malformed"))?;
                if matches!(result, DeriverBYaoSessionResponseV1::PairCompleted { .. }) {
                    let env = env.clone();
                    let scope = scope.clone();
                    object.wait_until(async move {
                        settle_deriver_b_wallet_admission(&env, &scope).await;
                    });
                }
                let _ = trace_id;
                Ok(result)
            }
            #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
            Self::Worker(_) => {
                let _ = scope;
                execute_deriver_b_session_command(env, command, trace_id).await
            }
        }
    }
}
