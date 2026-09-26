//! Each VM role's view of its Cloudflare bindings.
//!
//! The shared role code reads the binding names and formats a Cloudflare
//! Worker is deployed with. A VM role keeps the same keys in its own env file,
//! some under VM names and formats. This view presents them as the Worker sees
//! them, and fixes the constants the Worker's Wrangler config pins. It is only
//! a set of names and values: no Cloudflare service runs behind it.

use router_ab_cloudflare::{
    encode_cloudflare_server_output_hpke_private_key_secret_v1,
    encode_cloudflare_signer_envelope_hpke_private_key_secret_v1, CloudflareEnvMapV1,
    CloudflareWorkerRoleV1, DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
    DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV, DERIVER_A_PEER_BINDING_ENV,
    DERIVER_A_PEER_SIGNING_KEY_BINDING_ENV, DERIVER_A_PEER_SIGNING_KEY_EPOCH_ENV,
    DERIVER_A_PEER_VERIFYING_KEY_HEX_ENV, DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
    DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV, DERIVER_B_PEER_BINDING_ENV,
    DERIVER_B_PEER_SIGNING_KEY_BINDING_ENV, DERIVER_B_PEER_SIGNING_KEY_EPOCH_ENV,
    DERIVER_B_PEER_VERIFYING_KEY_HEX_ENV, SIGNING_WORKER_PRESIGN_SESSION_DO_BINDING_ENV,
    SIGNING_WORKER_PRESIGN_SESSION_DO_KEY_PREFIX_ENV, SIGNING_WORKER_PRESIGN_SESSION_DO_OBJECT_ENV,
    SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH_ENV,
    SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_BINDING_ENV,
};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use std::collections::BTreeMap;

use super::{
    required_env_v1, LOCAL_DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1,
    LOCAL_DERIVER_A_PEER_VERIFYING_KEY_ENV_V1, LOCAL_DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1,
    LOCAL_DERIVER_B_PEER_VERIFYING_KEY_ENV_V1, LOCAL_SIGNING_WORKER_KEY_EPOCH_ENV_V1,
    LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_ENV_V1,
};

/// The key epoch the local Gateway publishes for each role's keys, as the
/// Workers' Wrangler configs pin it.
const LOCAL_KEY_EPOCH_V1: &str = "epoch-1";

/// A Deriver's Cloudflare binding view: its tenant-root bindings as they
/// are, plus the signer runtime bindings the ECDSA Deriver handlers read.
pub(crate) fn local_deriver_cloudflare_env_v1(
    worker_role: CloudflareWorkerRoleV1,
    env: &BTreeMap<String, String>,
) -> RouterAbProtocolResult<CloudflareEnvMapV1> {
    let (
        private_key_env,
        private_key_binding_env,
        key_epoch_env,
        peer_signing_key_binding_env,
        peer_signing_key_epoch_env,
        peer_binding_env,
        peer_binding,
    ) = match worker_role {
        CloudflareWorkerRoleV1::DeriverA => (
            LOCAL_DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1,
            DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_A_PEER_SIGNING_KEY_BINDING_ENV,
            DERIVER_A_PEER_SIGNING_KEY_EPOCH_ENV,
            DERIVER_B_PEER_BINDING_ENV,
            "DERIVER_B",
        ),
        CloudflareWorkerRoleV1::DeriverB => (
            LOCAL_DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1,
            DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            DERIVER_B_PEER_SIGNING_KEY_BINDING_ENV,
            DERIVER_B_PEER_SIGNING_KEY_EPOCH_ENV,
            DERIVER_A_PEER_BINDING_ENV,
            "DERIVER_A",
        ),
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidRole,
                "a Deriver binding view needs Deriver A or Deriver B",
            ))
        }
    };
    // The VM keeps the raw key; the Worker Secret carries its versioned form.
    let private_key = decode_hex_32(&required_env_v1(env, private_key_env)?, private_key_env)?;
    let private_key_secret =
        encode_cloudflare_signer_envelope_hpke_private_key_secret_v1(&private_key)?;
    Ok(entries(env).with_overrides(vec![
        (private_key_binding_env, private_key_env.to_owned()),
        (private_key_env, private_key_secret),
        (key_epoch_env, LOCAL_KEY_EPOCH_V1.to_owned()),
        (
            peer_signing_key_binding_env,
            peer_signing_key_env(worker_role).to_owned(),
        ),
        (peer_signing_key_epoch_env, LOCAL_KEY_EPOCH_V1.to_owned()),
        (
            DERIVER_A_PEER_VERIFYING_KEY_HEX_ENV,
            required_env_v1(env, LOCAL_DERIVER_A_PEER_VERIFYING_KEY_ENV_V1)?,
        ),
        (
            DERIVER_B_PEER_VERIFYING_KEY_HEX_ENV,
            required_env_v1(env, LOCAL_DERIVER_B_PEER_VERIFYING_KEY_ENV_V1)?,
        ),
        (peer_binding_env, peer_binding.to_owned()),
    ]))
}

/// The SigningWorker's Cloudflare binding view. The presignature-session
/// Durable Object names only satisfy the runtime's parser; a VM SigningWorker
/// keeps its sessions in its role-private SQLite file.
pub(crate) fn local_signing_worker_cloudflare_env_v1(
    env: &BTreeMap<String, String>,
) -> RouterAbProtocolResult<CloudflareEnvMapV1> {
    let private_key_env = LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_ENV_V1;
    let private_key = decode_hex_32(&required_env_v1(env, private_key_env)?, private_key_env)?;
    let private_key_secret =
        encode_cloudflare_server_output_hpke_private_key_secret_v1(&private_key)?;
    Ok(entries(env).with_overrides(vec![
        (
            SIGNING_WORKER_PRESIGN_SESSION_DO_BINDING_ENV,
            "SIGNING_WORKER_PRESIGN_SESSION_DO".to_owned(),
        ),
        (
            SIGNING_WORKER_PRESIGN_SESSION_DO_OBJECT_ENV,
            "signing-worker-presign-session".to_owned(),
        ),
        (
            SIGNING_WORKER_PRESIGN_SESSION_DO_KEY_PREFIX_ENV,
            "signing-worker-presign-session/".to_owned(),
        ),
        (
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_BINDING_ENV,
            private_key_env.to_owned(),
        ),
        (private_key_env, private_key_secret),
        (
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH_ENV,
            required_env_v1(env, LOCAL_SIGNING_WORKER_KEY_EPOCH_ENV_V1)?,
        ),
    ]))
}

fn peer_signing_key_env(worker_role: CloudflareWorkerRoleV1) -> &'static str {
    match worker_role {
        CloudflareWorkerRoleV1::DeriverA => super::LOCAL_DERIVER_A_PEER_SIGNING_KEY_ENV_V1,
        _ => super::LOCAL_DERIVER_B_PEER_SIGNING_KEY_ENV_V1,
    }
}

fn entries(env: &BTreeMap<String, String>) -> CloudflareEnvMapV1 {
    CloudflareEnvMapV1::new(
        env.iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    )
}

fn decode_hex_32(value: &str, name: &str) -> RouterAbProtocolResult<[u8; 32]> {
    hex::decode(value)
        .ok()
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{name} must be 32 bytes of hex"),
            )
        })
}
