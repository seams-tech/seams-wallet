use super::*;
use crate::tenant_root_role_d1::RootUseAccess;

/// Loads the tenant-root role share an authenticated custody binding names.
///
/// The custody binding is resolved by the authenticated request boundary. The
/// operation is admitted on the binding's epoch first, and the store returns
/// that epoch's share: the active share, or, for an operation admitted before
/// a refresh retired the epoch, the retired share until it is erased. An
/// unused binding for a retired epoch and a binding for an epoch not yet
/// active here are refused. The host's role chooses the local role; no
/// selector is accepted from the request body.
/// The store refused this attempt's admission: it is admitted here under
/// another binding. Only the admission step below constructs it, before any
/// share is opened, so a caller may look for its own preparation and retry.
#[derive(Debug)]
pub(crate) struct AttemptConflictV1(());

impl AttemptConflictV1 {
    pub(crate) fn into_error(self) -> RouterAbProtocolError {
        tenant_root_attempt_conflict_error_v1()
    }
}

pub async fn tenant_root_deriver_load_bound_role_share_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    authenticated_custody_binding: &router_ab_core::TenantRootCustodyBindingV1,
    attempt: &crate::tenant_root_role_d1::TenantRootRootUseAttemptV1,
    now_ms: u64,
) -> RouterAbProtocolResult<VerifiedTenantRootOnlineRoleShareV1> {
    load_role_share_with_access(
        host,
        authenticated_custody_binding,
        attempt,
        now_ms,
        RootUseAccess::Admit,
    )
    .await?
    .map_err(AttemptConflictV1::into_error)
}

pub(crate) async fn load_role_share_with_access<Host: TenantRootDeriverHostV1>(
    host: &Host,
    authenticated_custody_binding: &router_ab_core::TenantRootCustodyBindingV1,
    attempt: &crate::tenant_root_role_d1::TenantRootRootUseAttemptV1,
    now_ms: u64,
    access: RootUseAccess,
) -> RouterAbProtocolResult<Result<VerifiedTenantRootOnlineRoleShareV1, AttemptConflictV1>> {
    let worker_role = host.worker_role();
    let expected_role = match worker_role {
        crate::CloudflareWorkerRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        crate::CloudflareWorkerRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidRole,
                "this Worker has no tenant-root role share",
            ));
        }
    };
    authenticated_custody_binding
        .validate()
        .map_err(crate::map_root_share_to_protocol)?;

    let store = host.role_store().map_err(|error| {
        crate::map_cloudflare_tenant_root_role_store_error_v1(
            "tenant-root role store lookup",
            error,
        )
    })?;
    let sealed = match store
        .load_bound_with_access(authenticated_custody_binding, attempt, now_ms, access)
        .await
        .map_err(|error| {
            crate::map_cloudflare_tenant_root_role_store_error_v1(
                "tenant-root bound role-share lookup",
                error,
            )
        })? {
        crate::tenant_root_role_d1::TenantRootBoundShareV1::Readable(sealed) => sealed,
        crate::tenant_root_role_d1::TenantRootBoundShareV1::EpochClosed => {
            return Err(tenant_root_epoch_closed_error_v1());
        }
        crate::tenant_root_role_d1::TenantRootBoundShareV1::NotYetActive => {
            return Err(tenant_root_epoch_not_yet_active_error_v1());
        }
        crate::tenant_root_role_d1::TenantRootBoundShareV1::AttemptConflict => {
            return Ok(Err(AttemptConflictV1(())));
        }
        crate::tenant_root_role_d1::TenantRootBoundShareV1::Cancelled => {
            return Err(tenant_root_attempt_cancelled_error_v1());
        }
        crate::tenant_root_role_d1::TenantRootBoundShareV1::Erased => {
            return Err(tenant_root_epoch_erased_error_v1());
        }
    };
    if sealed.binding().role() != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "tenant-root bound role-share row does not belong to this Deriver",
        ));
    }

    let mut provider =
        crate::env::load_tenant_root_operational_rotation_provider_v1(worker_role, host.env())?;
    let opened = open_tenant_root_online_role_share_v1(sealed, &mut provider)
        .map_err(crate::map_root_share_to_protocol)?;
    if opened.role() != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "tenant-root online role-share provider returned the wrong Deriver role",
        ));
    }
    // An ECDSA operation reads its share once per request; having read it, it
    // needs the epoch no longer. Its settlement races recovery's cancellation
    // for the admission, and the share is used only if a settlement of this
    // exact attempt won. A Yao pair settles when its record here completes.
    if matches!(
        attempt,
        crate::tenant_root_role_d1::TenantRootRootUseAttemptV1::EcdsaOperation
    ) {
        match store
            .settle_root_use_admission(attempt, authenticated_custody_binding)
            .await
            .map_err(|error| {
                crate::map_cloudflare_tenant_root_role_store_error_v1(
                    "tenant-root root-use settlement",
                    error,
                )
            })? {
            crate::tenant_root_role_d1::TenantRootSettlementOutcomeV1::Won
            | crate::tenant_root_role_d1::TenantRootSettlementOutcomeV1::AlreadySettled => {}
            crate::tenant_root_role_d1::TenantRootSettlementOutcomeV1::CancellationWon => {
                return Err(tenant_root_attempt_cancelled_error_v1());
            }
        }
    }
    Ok(Ok(opened))
}
