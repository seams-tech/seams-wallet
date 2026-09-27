//! Cloudflare's Deriver routes for recovery-package generation: the shared
//! phases and access (`tenant_root_recovery_reshare`) over this Worker's
//! bindings, with its Google Cloud KMS retention key, and source retirement.

use crate::tenant_root_recovery_reshare::{
    tenant_root_deriver_recovery_access_v1, tenant_root_deriver_recovery_reshare_v1,
    TenantRootDeriverRecoveryHostV1, TenantRootRecoveryAccessRequestV1,
    TenantRootRecoveryAccessResponseV1, TenantRootRecoveryReshareRequestV1,
    TenantRootRecoveryReshareResponseV1, TENANT_ROOT_RECOVERY_PACKAGE_CONTENT_TYPE_V1,
};
use crate::tenant_root_role_d1::CloudflareTenantRootRoleShareStoreV1;
use crate::tenant_root_role_runtime::{CloudflareTenantRootDeriverHostV1, TenantRootDeriverHostV1};
use router_ab_core::*;
use threshold_prf::TwoPartyDeriverRole;

fn error(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}
fn crypto_error(value: RouterAbDerivationError) -> RouterAbProtocolError {
    error(value.message())
}
fn storage_error(value: impl core::fmt::Display) -> RouterAbProtocolError {
    error(&value.to_string())
}
fn decode(value: &str) -> RouterAbProtocolResult<Vec<u8>> {
    if value.len() > 24 * 1024 {
        return Err(error("recovery artifact exceeds wire limit"));
    }
    let bytes = crate::decode_base64url_bytes_v1("recovery artifact", value)?;
    if crate::encode_base64url_bytes_v1(&bytes) != value {
        return Err(error("recovery artifact is not canonical base64url"));
    }
    Ok(bytes)
}
fn encode(bytes: &[u8]) -> String {
    crate::encode_base64url_bytes_v1(bytes)
}

impl TenantRootDeriverRecoveryHostV1 for CloudflareTenantRootDeriverHostV1<'_> {
    type Retention = crate::tenant_root_google_kms::CloudflareTenantRootGoogleKmsRetentionKeyV1;

    fn recovery_retention(
        &self,
        id: router_ab_core::derivation::TenantRootRetentionKeyIdV1,
    ) -> RouterAbProtocolResult<Self::Retention> {
        crate::env::load_cloudflare_tenant_root_recovery_retention_key_v1(
            self.worker_env(),
            self.worker_role(),
            id,
        )
    }
}

pub(crate) async fn handle_recovery(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: TenantRootRecoveryReshareRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootRecoveryReshareResponseV1> {
    tenant_root_deriver_recovery_reshare_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}

pub(crate) async fn handle_recovery_access(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: TenantRootRecoveryAccessRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<worker::Response> {
    match tenant_root_deriver_recovery_access_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await?
    {
        TenantRootRecoveryAccessResponseV1::Package { bytes, file_name } => {
            let mut response =
                worker::Response::from_bytes(bytes.to_vec()).map_err(storage_error)?;
            let headers = response.headers_mut();
            for (name, value) in [
                ("Content-Type", TENANT_ROOT_RECOVERY_PACKAGE_CONTENT_TYPE_V1.to_owned()),
                ("Cache-Control", "no-store".to_owned()),
                ("X-Content-Type-Options", "nosniff".to_owned()),
                ("Content-Disposition", format!("attachment; filename=\"{file_name}\"")),
            ] {
                headers.set(name, &value).map_err(storage_error)?;
            }
            Ok(response)
        }
        TenantRootRecoveryAccessResponseV1::Destruction(outcome) => {
            worker::Response::from_json(&outcome).map_err(storage_error)
        }
    }
}

pub(crate) const SOURCE_RETIREMENT_PATH: &str =
    "/router-ab/deriver/tenant-root-recovery/retire-source";

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceRetirementRequestV1 {
    retirement_command_b64u: String,
}

pub(crate) async fn handle_source_retirement(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: SourceRetirementRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<serde_json::Value> {
    let role = match worker_role {
        crate::CloudflareWorkerRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        crate::CloudflareWorkerRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
        _ => return Err(error("source retirement requires a Deriver")),
    };
    let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
    let issuers =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(&reader)?;
    let raw = TenantRootSourceRetirementCommandV1::decode_canonical_bytes(&decode(
        &request.retirement_command_b64u,
    )?)
    .map_err(crypto_error)?;
    let key = issuers
        .for_issuer_key_id(raw.issuer_key_id())
        .ok_or_else(|| error("source retirement issuer is not trusted"))?;
    let command = raw
        .verify(role, raw.issuer_key_id(), key, now_ms)
        .map_err(crypto_error)?;
    let store = CloudflareTenantRootRoleShareStoreV1::from_env(env).map_err(storage_error)?;
    let retired_at_ms = store
        .retire_source_lineage(&command, now_ms)
        .await
        .map_err(storage_error)?;
    Ok(serde_json::json!({
        "status": "local_material_removed",
        "role": role.as_str(),
        "identity_digest_b64u": encode(command.identity_digest().as_bytes()),
        "custody_lineage_b64u": command.custody_lineage().to_base64url(),
        "destination_activation_receipt_digest_b64u": encode(command.destination_receipt_digest().as_bytes()),
        "retired_at_ms": retired_at_ms,
        "provider_retirement": "unverified"
    }))
}
