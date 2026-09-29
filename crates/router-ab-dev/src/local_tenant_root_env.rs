//! Generated tenant-root configuration for a local VM deployment.
//!
//! Every value uses the env name a Cloudflare role reads, so a VM role and a
//! Worker are configured the same way. Each Secret appears only in the env
//! file of the one role that holds it:
//!
//! - the control plane holds the issuer signing key;
//! - each Deriver holds its role signing key, its role-store record key and
//!   its online and managed-backup provider keys;
//! - the operator file holds the creation grant authority and the recovery
//!   authorities, and no role process loads it.
//!
//! Every role gets the published verifying keys it checks against.

use base64::Engine;
use router_ab_core::RouterAbProtocolResult;

use crate::local_ed25519_yao_delivery::derive_local_ed25519_yao_recipient_key_pair_v1;
use crate::local_generated_secret_bytes_v1;

/// Private origin the VM control plane binds by default.
pub const LOCAL_TENANT_ROOT_CONTROL_PLANE_DEFAULT_URL_V1: &str = "http://127.0.0.1:4106";
/// Grant authority signing key in the operator file.
pub const LOCAL_TENANT_ROOT_GRANT_SIGNING_KEY_ENV_V1: &str = "LOCAL_TENANT_ROOT_GRANT_SIGNING_KEY";
/// Grant authority key id in the operator file.
pub const LOCAL_TENANT_ROOT_GRANT_KEY_ID_ENV_V1: &str = "LOCAL_TENANT_ROOT_GRANT_KEY_ID";

const ROUTER_DEFAULT_URL: &str = "http://127.0.0.1:4100";
const ISSUER_KEY_ID: &str = "local-tenant-root-issuer-v1";
const GRANT_KEY_ID: &str = "local-tenant-root-grant-authority-v1";

/// The tenant-root lines appended to each generated env file.
pub(crate) struct LocalTenantRootEnvLinesV1 {
    /// Replaces the templates' deployment-authority placeholder.
    pub deployment_authority_id: String,
    pub router: String,
    pub deriver_a: String,
    pub deriver_b: String,
    pub control_plane: String,
    pub operator: String,
}

pub(crate) fn local_tenant_root_env_lines_v1(
    seed: &[u8],
) -> RouterAbProtocolResult<LocalTenantRootEnvLinesV1> {
    let secret = |label: &str| local_generated_secret_bytes_v1(label, seed);
    let verifying_hex = |seed: [u8; 32]| {
        hex::encode(ed25519_dalek::SigningKey::from_bytes(&seed).verifying_key().to_bytes())
    };
    let b64u = |bytes: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);

    let issuer = secret("tenant-root-issuer-signing-key")?;
    let grant = secret("tenant-root-grant-authority-signing-key")?;
    let operations = secret("tenant-root-operations-incident-signing-key")?;
    let custody_a = secret("tenant-root-deriver-a-custody-authority-signing-key")?;
    let custody_b = secret("tenant-root-deriver-b-custody-authority-signing-key")?;
    let role_a = secret("tenant-root-deriver-a-role-signing-key")?;
    let role_b = secret("tenant-root-deriver-b-role-signing-key")?;
    // The same derivation the env templates use for the A/B peer keys; the
    // shared parsers refuse a tenant-root role key that reuses one of them.
    let peer_a = verifying_hex(secret("deriver-a-peer-signing-key")?);
    let peer_b = verifying_hex(secret("deriver-b-peer-signing-key")?);
    let deployment = format!(
        "local-{}",
        &hex::encode(secret("tenant-root-deployment-authority")?)[..24]
    );

    let issuer_keys_json = format!(
        r#"{{"keys":[{{"issuer_key_id":"{ISSUER_KEY_ID}","verifying_key_hex":"{}"}}]}}"#,
        verifying_hex(issuer)
    );
    let role_keys_json = format!(
        r#"{{"active_deriver_a_signing_key_id":"local-tenant-root-role-a-v1","active_deriver_b_signing_key_id":"local-tenant-root-role-b-v1","keys":[{{"role":"deriver_a","signing_key_id":"local-tenant-root-role-a-v1","verifying_key_hex":"{}"}},{{"role":"deriver_b","signing_key_id":"local-tenant-root-role-b-v1","verifying_key_hex":"{}"}}]}}"#,
        verifying_hex(role_a),
        verifying_hex(role_b)
    );
    // Every role verifies operator grants, as on Cloudflare: the control plane
    // for creation and restore, and the Router and Derivers for restore cleanup.
    let published = format!(
        "TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON={issuer_keys_json}\n\
         TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON={{\"keys\":[{{\"issuer_key_id\":\"{GRANT_KEY_ID}\",\"verifying_key_hex\":\"{grant_public}\"}}]}}\n\
         ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON={role_keys_json}\n\
         DERIVER_A_PEER_VERIFYING_KEY_HEX={peer_a}\n\
         DERIVER_B_PEER_VERIFYING_KEY_HEX={peer_b}\n",
        grant_public = verifying_hex(grant),
    );

    let router = published.clone();

    let deriver = |upper: &str, lower: &str, role_seed: [u8; 32]| -> RouterAbProtocolResult<String> {
        let kek = derive_local_ed25519_yao_recipient_key_pair_v1(&secret(&format!(
            "tenant-root-deriver-{lower}-role-store-record-key"
        ))?)?;
        let online = derive_local_ed25519_yao_recipient_key_pair_v1(&secret(&format!(
            "tenant-root-deriver-{lower}-online-provider-key"
        ))?)?;
        let backup = derive_local_ed25519_yao_recipient_key_pair_v1(&secret(&format!(
            "tenant-root-deriver-{lower}-managed-backup-provider-key"
        ))?)?;
        Ok(format!(
            "{published}\
             DERIVER_{upper}_TENANT_ROOT_CREATION_SIGNING_KEY_BINDING=DERIVER_{upper}_TENANT_ROOT_CREATION_SIGNING_KEY\n\
             DERIVER_{upper}_TENANT_ROOT_CREATION_SIGNING_KEY_ID=local-tenant-root-role-{lower}-v1\n\
             DERIVER_{upper}_TENANT_ROOT_CREATION_SIGNING_KEY={role}\n\
             DERIVER_{upper}_TENANT_ROOT_ONLINE_EPOCH_WRAPPING_KEY_REF=local-tenant-root-{lower}-online-epoch-1\n\
             DERIVER_{upper}_TENANT_ROOT_ONLINE_HPKE_PUBLIC_KEY=x25519:{online_public}\n\
             DERIVER_{upper}_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY_BINDING=DERIVER_{upper}_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY\n\
             DERIVER_{upper}_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY=hpke-x25519-private-v1:{online_private}\n\
             DERIVER_{upper}_TENANT_ROOT_MANAGED_BACKUP_PROVIDER_ID=local-tenant-root-{lower}-managed-backup\n\
             DERIVER_{upper}_TENANT_ROOT_MANAGED_BACKUP_KEY_VERSION=local-tenant-root-{lower}-backup-v1\n\
             DERIVER_{upper}_TENANT_ROOT_MANAGED_BACKUP_HPKE_PUBLIC_KEY=x25519:{backup_public}\n\
             DERIVER_{upper}_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY_BINDING=DERIVER_{upper}_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY\n\
             DERIVER_{upper}_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY=hpke-x25519-private-v1:{backup_private}\n\
             DERIVER_ROLE_PRIVATE_D1_ENVIRONMENT=local\n\
             DERIVER_ROLE_PRIVATE_D1_ROLE=deriver_{lower}\n\
             DERIVER_ROLE_PRIVATE_D1_KEK_VERSION=local-v1\n\
             DERIVER_ROLE_PRIVATE_D1_KEK_PUBLIC_KEY=x25519:{kek_public}\n\
             DERIVER_ROLE_PRIVATE_D1_KEK_BINDING=DERIVER_{upper}_ROLE_PRIVATE_D1_KEK\n\
             DERIVER_{upper}_ROLE_PRIVATE_D1_KEK=hpke-x25519-role-private-d1-private-v1:{kek_private}\n",
            role = b64u(&role_seed),
            online_public = hex::encode(online.public_key),
            online_private = hex::encode(online.private_key.as_bytes()),
            backup_public = hex::encode(backup.public_key),
            backup_private = hex::encode(backup.private_key.as_bytes()),
            kek_public = hex::encode(kek.public_key),
            kek_private = hex::encode(kek.private_key.as_bytes()),
        ))
    };

    let control_plane = format!(
        "{published}\
         ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET=dev-only-role-shared-service-auth\n\
         TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_BINDING=TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY\n\
         TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID={ISSUER_KEY_ID}\n\
         TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY={issuer_secret}\n\
         OPERATIONS_INCIDENT_VERIFYING_KEY_HEX={operations_public}\n\
         DERIVER_A_CUSTODY_AUTHORITY_VERIFYING_KEY_HEX={custody_a_public}\n\
         DERIVER_B_CUSTODY_AUTHORITY_VERIFYING_KEY_HEX={custody_b_public}\n\
         LOCAL_TENANT_ROOT_DEPLOYMENT_AUTHORITY_ID={deployment}\n\
         LOCAL_ROUTER_PRIVATE_URL={ROUTER_DEFAULT_URL}\n\
         LOCAL_TENANT_ROOT_CONTROL_PLANE_URL={LOCAL_TENANT_ROOT_CONTROL_PLANE_DEFAULT_URL_V1}\n",
        issuer_secret = b64u(&issuer),
        operations_public = verifying_hex(operations),
        custody_a_public = verifying_hex(custody_a),
        custody_b_public = verifying_hex(custody_b),
    );

    let operator = format!(
        "# Operator authorities for this local deployment. No role process loads\n\
         # this file: the grant key authorizes tenant-root creation, and the\n\
         # operations and custody keys authorize managed restore.\n\
         {LOCAL_TENANT_ROOT_GRANT_KEY_ID_ENV_V1}={GRANT_KEY_ID}\n\
         {LOCAL_TENANT_ROOT_GRANT_SIGNING_KEY_ENV_V1}={}\n\
         LOCAL_TENANT_ROOT_OPERATIONS_INCIDENT_SIGNING_KEY={}\n\
         LOCAL_TENANT_ROOT_DERIVER_A_CUSTODY_AUTHORITY_SIGNING_KEY={}\n\
         LOCAL_TENANT_ROOT_DERIVER_B_CUSTODY_AUTHORITY_SIGNING_KEY={}\n",
        b64u(&grant),
        b64u(&operations),
        b64u(&custody_a),
        b64u(&custody_b),
    );

    Ok(LocalTenantRootEnvLinesV1 {
        deployment_authority_id: deployment,
        router,
        deriver_a: deriver("A", "a", role_a)?,
        deriver_b: deriver("B", "b", role_b)?,
        control_plane,
        operator,
    })
}
