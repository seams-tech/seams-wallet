//! Tenant-root control-plane Worker binding tests.

// --- Tenant-root control-plane Worker --------------------------------------
//
// | Material                        | Owner                             |
// |---------------------------------|-----------------------------------|
// | issuer private signing key      | control-plane Worker only         |
// | issuer public verifying keyset  | Router, Deriver A, Deriver B      |

use super::*;

pub(super) fn tenant_root_control_plane_env() -> CloudflareEnvMapV1 {
    CloudflareEnvMapV1::new(vec![
        (
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID_ENV,
            "control-plane-issuer-v1".to_string(),
        ),
        (
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_BINDING_ENV,
            "TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY".to_string(),
        ),
        (
            TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
            ISSUER_VERIFYING_KEYS_JSON.to_string(),
        ),
        (
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON_ENV,
            GRANT_AUTHORITY_VERIFYING_KEYS_JSON.to_string(),
        ),
        (
            router_ab_cloudflare::OPERATIONS_INCIDENT_VERIFYING_KEY_HEX_ENV,
            control_plane_verifying_key_hex(0x61),
        ),
        (
            router_ab_cloudflare::DERIVER_A_CUSTODY_AUTHORITY_VERIFYING_KEY_HEX_ENV,
            control_plane_verifying_key_hex(0x62),
        ),
        (
            router_ab_cloudflare::DERIVER_B_CUSTODY_AUTHORITY_VERIFYING_KEY_HEX_ENV,
            control_plane_verifying_key_hex(0x63),
        ),
        (
            router_ab_cloudflare::ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON_ENV,
            ROLE_VERIFYING_KEYS_JSON.to_string(),
        ),
    ])
}

#[test]
fn control_plane_bindings_parse_and_describe_only_the_issuer_secret() {
    let bindings =
        parse_cloudflare_tenant_root_control_plane_bindings_v1(&tenant_root_control_plane_env())
            .expect("control-plane bindings");
    assert_eq!(
        bindings.issuer_signing_key.signing_key_id(),
        "control-plane-issuer-v1"
    );
    assert_eq!(
        bindings.issuer_signing_key.binding_name(),
        "TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY"
    );
    // The issuer holds its own published anchor so it can prove at boot that
    // its Secret derives the key registered under its active id.
    assert!(bindings
        .issuer_verifying_keys
        .for_issuer_key_id("control-plane-issuer-v1")
        .is_some());

    let parsed = parse_cloudflare_worker_bindings_v1(
        CloudflareWorkerRoleV1::TenantRootControlPlane,
        &tenant_root_control_plane_env(),
    )
    .expect("worker bindings");
    assert_eq!(
        parsed.worker_role(),
        CloudflareWorkerRoleV1::TenantRootControlPlane
    );
    assert!(matches!(
        parsed,
        router_ab_cloudflare::CloudflareWorkerBindingsV1::TenantRootControlPlane { .. }
    ));
}

#[test]
fn issuer_signing_secret_is_accepted_only_by_the_control_plane_worker() {
    // The parser itself refuses every other role before reading Env.
    for worker_role in [
        CloudflareWorkerRoleV1::Router,
        CloudflareWorkerRoleV1::DeriverA,
        CloudflareWorkerRoleV1::DeriverB,
        CloudflareWorkerRoleV1::SigningWorker,
    ] {
        let err = parse_cloudflare_tenant_root_control_plane_issuer_signing_key_binding_v1(
            worker_role,
            &tenant_root_control_plane_env(),
        )
        .expect_err("only the control plane may parse the issuer signing secret");
        assert_eq!(
            err.code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "{}",
            worker_role.as_str()
        );
    }

    // And every other Worker's own startup parser rejects the binding at boot.
    for worker_role in [
        CloudflareWorkerRoleV1::Router,
        CloudflareWorkerRoleV1::DeriverA,
        CloudflareWorkerRoleV1::DeriverB,
        CloudflareWorkerRoleV1::SigningWorker,
    ] {
        let env = CloudflareEnvMapV1::new(vec![(
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_BINDING_ENV,
            "TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY",
        )]);
        let err = parse_cloudflare_worker_bindings_v1(worker_role, &env)
            .expect_err("non-issuer Workers must reject the issuer private binding");
        assert_eq!(
            err.code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "{}",
            worker_role.as_str()
        );
    }
}

#[test]
fn control_plane_rejects_every_scalar_and_router_auth_config() {
    for (key, value) in [
        // Deriver scalar and Secret material.
        (
            DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
        ),
        (
            router_ab_cloudflare::DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY_BINDING_ENV,
            "DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY",
        ),
        (
            router_ab_cloudflare::DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY_ID_ENV,
            "deriver-a-signing-key-7",
        ),
        (
            router_ab_cloudflare::DERIVER_B_TENANT_ROOT_CREATION_SIGNING_KEY_ID_ENV,
            "deriver-b-signing-key-9",
        ),
        (
            router_ab_cloudflare::DERIVER_B_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY_BINDING_ENV,
            "DERIVER_B_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY",
        ),
        // SigningWorker material.
        (
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_BINDING_ENV,
            "SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY",
        ),
        // Router authorization configuration: the issuer validates from
        // authenticated capabilities and DO state, never raw credentials.
        (ROUTER_JWT_ISSUER_ENV, "https://issuer.example"),
        (ROUTER_JWT_JWKS_JSON_ENV, "{}"),
        (ROUTER_PROJECT_POLICY_BOOTSTRAP_JSON_ENV, "{}"),
    ] {
        // Start from a fully valid control plane, so the rejection is the
        // forbidden-material check and not a missing-configuration error.
        let err = parse_cloudflare_worker_bindings_v1(
            CloudflareWorkerRoleV1::TenantRootControlPlane,
            &control_plane_env_with(key, value),
        )
        .expect_err("control plane must reject foreign material");
        assert_eq!(
            err.code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "{key}"
        );
    }
}

/// The issuer must not be able to authorize the creations it then signs.
#[test]
fn a_grant_authority_may_not_reuse_a_control_plane_issuer_key() {
    let entries: Vec<(&str, String)> = tenant_root_control_plane_env()
        .entries()
        .iter()
        .map(|(key, value)| {
            let value = if key.as_str()
                == router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON_ENV
            {
                // Publish the ISSUER's key as a grant authority.
                ISSUER_VERIFYING_KEYS_JSON.to_string()
            } else {
                value.clone()
            };
            (
                Box::leak(key.clone().into_boxed_str()) as &str,
                value,
            )
        })
        .collect();
    let error = parse_cloudflare_worker_bindings_v1(
        CloudflareWorkerRoleV1::TenantRootControlPlane,
        &CloudflareEnvMapV1::new(entries),
    )
    .expect_err("a grant authority reusing an issuer key must fail closed");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );
}

/// The complete control-plane fixture with one entry overridden, so a boundary
/// test fails on the boundary it is testing rather than on missing config.
pub(super) fn control_plane_env_with(key: &str, value: &str) -> CloudflareEnvMapV1 {
    let mut entries: Vec<(String, String)> = tenant_root_control_plane_env()
        .entries()
        .iter()
        .map(|(name, existing)| (name.clone(), existing.clone()))
        .collect();
    match entries.iter_mut().find(|(name, _)| name == key) {
        Some(slot) => slot.1 = value.to_string(),
        None => entries.push((key.to_string(), value.to_string())),
    }
    CloudflareEnvMapV1::new(entries)
}

/// The public role keyset names both role signing IDs, and the control plane
/// never receives their Secret or duplicate ID bindings.
#[test]
fn the_control_plane_holds_role_signing_key_ids_but_never_their_bindings() {
    let bindings = parse_cloudflare_worker_bindings_v1(
        CloudflareWorkerRoleV1::TenantRootControlPlane,
        &tenant_root_control_plane_env(),
    )
    .expect("control-plane bindings");
    let CloudflareWorkerBindingsV1::TenantRootControlPlane {
        bindings: control_plane,
    } = bindings
    else {
        panic!("expected control-plane bindings");
    };
    assert_eq!(
        control_plane.deriver_a_signing_key_id,
        "deriver-a-signing-key-7"
    );
    assert_eq!(
        control_plane.deriver_b_signing_key_id,
        "deriver-b-signing-key-9"
    );

    for binding in [
        router_ab_cloudflare::DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY_BINDING_ENV,
        router_ab_cloudflare::DERIVER_B_TENANT_ROOT_CREATION_SIGNING_KEY_BINDING_ENV,
    ] {
        let mut entries: Vec<(String, String)> = tenant_root_control_plane_env()
            .entries()
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        entries.push((binding.to_string(), "SOME_SECRET".to_string()));
        assert_eq!(
            parse_cloudflare_worker_bindings_v1(
                CloudflareWorkerRoleV1::TenantRootControlPlane,
                &CloudflareEnvMapV1::new(entries),
            )
            .expect_err("a role signing Secret binding must be refused")
            .code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding
        );
    }
}

#[test]
fn control_plane_requires_its_active_issuer_key_id_to_be_published() {
    // Missing anchor: the issuer cannot boot without its own published set.
    let mut entries: Vec<(&str, String)> = vec![
        (
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID_ENV,
            "control-plane-issuer-v1".to_string(),
        ),
        (
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_BINDING_ENV,
            "TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY".to_string(),
        ),
        (
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON_ENV,
            GRANT_AUTHORITY_VERIFYING_KEYS_JSON.to_string(),
        ),
        (
            router_ab_cloudflare::OPERATIONS_INCIDENT_VERIFYING_KEY_HEX_ENV,
            control_plane_verifying_key_hex(0x61),
        ),
        (
            router_ab_cloudflare::DERIVER_A_CUSTODY_AUTHORITY_VERIFYING_KEY_HEX_ENV,
            control_plane_verifying_key_hex(0x62),
        ),
        (
            router_ab_cloudflare::DERIVER_B_CUSTODY_AUTHORITY_VERIFYING_KEY_HEX_ENV,
            control_plane_verifying_key_hex(0x63),
        ),
        (
            router_ab_cloudflare::ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON_ENV,
            ROLE_VERIFYING_KEYS_JSON.to_string(),
        ),
    ];
    parse_cloudflare_worker_bindings_v1(
        CloudflareWorkerRoleV1::TenantRootControlPlane,
        &CloudflareEnvMapV1::new(entries.clone()),
    )
    .expect_err("issuer requires its published anchor");

    // An anchor that does not publish the active key id fails closed: an issuer
    // signing under an unpublished id could never be verified.
    entries.push((
        TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
        ISSUER_VERIFYING_KEYS_JSON.to_string(),
    ));
    let set = |entries: &Vec<(&'static str, String)>, key: &str, value: &str| {
        let mut next = entries.clone();
        let slot = next
            .iter_mut()
            .find(|(name, _)| *name == key)
            .expect("fixture entry");
        slot.1 = value.to_string();
        next
    };

    let foreign = set(
        &entries,
        router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID_ENV,
        "control-plane-issuer-unpublished",
    );
    let err = parse_cloudflare_worker_bindings_v1(
        CloudflareWorkerRoleV1::TenantRootControlPlane,
        &CloudflareEnvMapV1::new(foreign),
    )
    .expect_err("unpublished active key id");
    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );

    // A malformed anchor fails at boot, not at first verification.
    let malformed = set(
        &entries,
        TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
        "{\"keys\":[]}",
    );
    parse_cloudflare_worker_bindings_v1(
        CloudflareWorkerRoleV1::TenantRootControlPlane,
        &CloudflareEnvMapV1::new(malformed),
    )
    .expect_err("empty published set");

    // The matching configuration parses.
    parse_cloudflare_worker_bindings_v1(
        CloudflareWorkerRoleV1::TenantRootControlPlane,
        &CloudflareEnvMapV1::new(entries),
    )
    .expect("published active issuer key id");
}

#[test]
fn control_plane_issuer_binding_must_be_control_plane_scoped_and_complete() {
    // Missing key ID.
    let err =
        parse_cloudflare_tenant_root_control_plane_bindings_v1(&CloudflareEnvMapV1::new(vec![(
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_BINDING_ENV,
            "TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY",
        )]))
        .expect_err("key id is required");
    assert_ne!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);

    // Missing binding name.
    parse_cloudflare_tenant_root_control_plane_bindings_v1(&CloudflareEnvMapV1::new(vec![(
        router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID_ENV,
        "control-plane-issuer-v1",
    )]))
    .expect_err("binding name is required");

    // A binding name that is not control-plane scoped: an operator must not be
    // able to point the issuer at a Deriver's or Router's Secret.
    for foreign in [
        "DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY",
        "ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET",
        "ISSUER_SIGNING_KEY",
    ] {
        let err = parse_cloudflare_tenant_root_control_plane_bindings_v1(&control_plane_env_with(
            router_ab_cloudflare::TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_BINDING_ENV,
            foreign,
        ))
        .expect_err("foreign binding name must be rejected");
        assert_eq!(
            err.code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "{foreign}"
        );
    }
}

#[test]
fn every_verifier_worker_requires_the_published_issuer_anchor_at_boot() {
    // A signed creation command is verified at each Worker's own boundary, so a
    // missing or malformed anchor must fail the Worker at startup rather than
    // at first verification.
    for (worker_role, env) in [
        (CloudflareWorkerRoleV1::Router, router_env()),
        (CloudflareWorkerRoleV1::DeriverA, deriver_a_env()),
        (CloudflareWorkerRoleV1::DeriverB, deriver_b_env()),
    ] {
        parse_cloudflare_worker_bindings_v1(worker_role, &env)
            .expect("published anchor parses at boot");

        let without: Vec<(String, String)> = env
            .entries()
            .iter()
            .filter(|(key, _)| {
                key.as_str() != TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV
            })
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        parse_cloudflare_worker_bindings_v1(worker_role, &CloudflareEnvMapV1::new(without.clone()))
            .expect_err("missing published anchor must fail closed");

        for malformed in [
            "",
            "{}",
            "not json",
            "{\"keys\":[]}",
            // Not a valid Ed25519 point.
            "{\"keys\":[{\"issuer_key_id\":\"k\",\"verifying_key_hex\":\"00000000000000000000000000000000000000000000000000000000000000ff\"}]}",
            // Duplicated issuer key id.
            "{\"keys\":[{\"issuer_key_id\":\"k\",\"verifying_key_hex\":\"0000000000000000000000000000000000000000000000000000000000000000\"},{\"issuer_key_id\":\"k\",\"verifying_key_hex\":\"0000000000000000000000000000000000000000000000000000000000000000\"}]}",
            // Unknown field: the wire denies them.
            "{\"keys\":[],\"extra\":1}",
        ] {
            let mut entries = without.clone();
            entries.push((
                TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV.to_string(),
                malformed.to_string(),
            ));
            assert!(
                parse_cloudflare_worker_bindings_v1(worker_role, &CloudflareEnvMapV1::new(entries))
                    .is_err(),
                "{} must reject a malformed published anchor",
                worker_role.as_str()
            );
        }
    }
}
