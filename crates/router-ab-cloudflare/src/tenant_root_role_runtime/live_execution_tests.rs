use super::admission_tests::*;
use super::tests::InMemoryProvider;
use super::*;
use rand_chacha::ChaCha20Rng;
use rand_core_06::SeedableRng;

const ONLINE_REF: &str = "online-key/tenant-7/epoch-1";
const BACKUP_PROVIDER: &str = "backup-provider-a";
const BACKUP_VERSION: &str = "backup-key-a/tenant-7/epoch-1";

pub(crate) fn test_provider_config() -> TenantRootRoleRuntimeProviderConfigV1 {
    provider_config()
}

fn provider_config() -> TenantRootRoleRuntimeProviderConfigV1 {
    TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
        .expect("provider config")
}

fn execute(
    role: TwoPartyDeriverRole,
    peer: Option<&[u8]>,
    seed: u8,
) -> RouterAbProtocolResult<TenantRootRoleCreationProgressV1> {
    let mut online = InMemoryProvider::new();
    let mut backup = InMemoryProvider::new();
    futures::executor::block_on(execute_tenant_root_role_creation_v1(
        &package_bytes(role, &ISSUER_KEY),
        peer,
        role,
        authority(),
        &trusted_issuer_keys(),
        &test_role_keys(),
        &signer(role),
        &provider_config(),
        &mut online,
        &mut backup,
        ISSUED_AT_MS + 2,
        &mut ChaCha20Rng::from_seed([seed; 32]),
    ))
}

/// The first leg commits without creating anything durable.
#[test]
fn the_first_leg_commits_and_produces_nothing_durable() {
    let progress = execute(TwoPartyDeriverRole::DeriverA, None, 0x77).expect("committed");
    match progress {
        TenantRootRoleCreationProgressV1::Committed { pending } => {
            assert_eq!(pending.role(), TwoPartyDeriverRole::DeriverA);
            assert!(!pending.commitment_bytes().is_empty());
        }
        TenantRootRoleCreationProgressV1::Sealed { .. } => {
            panic!("no peer commitment must not produce sealed material")
        }
    }
}

/// The second leg finalizes and seals in one call, so the scalar never has
/// to survive a request boundary.
#[test]
fn the_second_leg_finalizes_and_seals_in_one_call() {
    let TenantRootRoleCreationProgressV1::Committed { pending: a } =
        execute(TwoPartyDeriverRole::DeriverA, None, 0x77).expect("A committed")
    else {
        panic!("expected a committed first leg")
    };
    let a_commitment = a.commitment_bytes().to_vec();

    let progress =
        execute(TwoPartyDeriverRole::DeriverB, Some(&a_commitment), 0x88).expect("B sealed");
    let TenantRootRoleCreationProgressV1::Sealed {
        signed_commitment,
        signed_installation_evidence,
        input,
        managed_backup,
        ..
    } = progress
    else {
        panic!("expected a sealed second leg")
    };
    assert!(!signed_commitment.is_empty());
    assert!(!signed_installation_evidence.is_empty());
    assert_eq!(
        input.installation_evidence_bytes(),
        signed_installation_evidence
    );
    let _ = managed_backup;
}

/// A Deriver executes its own role, never the peer's, even when handed the
/// peer's package: the role comes from the Worker runtime.
#[test]
fn a_deriver_will_not_execute_a_package_addressed_to_its_peer() {
    for (packaged, worker) in [
        (TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB),
        (TwoPartyDeriverRole::DeriverB, TwoPartyDeriverRole::DeriverA),
    ] {
        let mut online = InMemoryProvider::new();
        let mut backup = InMemoryProvider::new();
        assert!(
            futures::executor::block_on(execute_tenant_root_role_creation_v1(
                &package_bytes(packaged, &ISSUER_KEY),
                None,
                worker,
                authority(),
                &trusted_issuer_keys(),
                &test_role_keys(),
                &signer(worker),
                &provider_config(),
                &mut online,
                &mut backup,
                ISSUED_AT_MS + 2,
                &mut ChaCha20Rng::from_seed([0x77; 32]),
            ))
            .is_err(),
            "{worker:?} must refuse a {packaged:?} package"
        );
    }
}

/// The request surface cannot select role, authority, clock, or signer.
#[test]
fn the_deriver_request_surface_carries_only_signed_and_public_material() {
    let request = CloudflareDeriverTenantRootCreateRoleShareRequestV1::Initiator {
        role_creation_command_package_b64u: "abc".to_owned(),
        peer_role_creation_command_package_b64u: "peer-package".to_owned(),
    };
    let json = serde_json::to_value(&request).expect("json");
    assert_eq!(json["kind"], "initiator");
    assert_eq!(json["role_creation_command_package_b64u"], "abc");
    assert_eq!(
        json["peer_role_creation_command_package_b64u"],
        "peer-package"
    );

    let request = CloudflareDeriverTenantRootCreateRoleShareRequestV1::PeerCompletion {
        role_creation_command_package_b64u: "peer-package".to_owned(),
        initiator_signed_commitment_b64u: "commitment".to_owned(),
    };
    let json = serde_json::to_value(&request).expect("json");
    assert_eq!(json["kind"], "peer_completion");
    assert_eq!(json["role_creation_command_package_b64u"], "peer-package");
    assert_eq!(json["initiator_signed_commitment_b64u"], "commitment");

    for smuggled in [
        r#"{"role_creation_command_package_b64u":"a","role":"deriver_a"}"#,
        r#"{"role_creation_command_package_b64u":"a","authority_id_b64u":"x"}"#,
        r#"{"role_creation_command_package_b64u":"a","now_ms":1}"#,
        r#"{"role_creation_command_package_b64u":"a","signing_key_id":"k"}"#,
        r#"{"kind":"initiator","role_creation_command_package_b64u":"a"}"#,
        r#"{"kind":"initiator","role_creation_command_package_b64u":"a","peer_role_creation_command_package_b64u":"b","initiator_signed_commitment_b64u":"c"}"#,
        r#"{"kind":"peer_completion","role_creation_command_package_b64u":"a"}"#,
        r#"{"kind":"peer_completion","role_creation_command_package_b64u":"a","initiator_role_creation_command_package_b64u":"b","initiator_signed_commitment_b64u":"c"}"#,
        r#"{"kind":"peer_completion","role_creation_command_package_b64u":"a","initiator_signed_commitment_b64u":"c","pending_persisted":true}"#,
    ] {
        assert!(
            serde_json::from_str::<CloudflareDeriverTenantRootCreateRoleShareRequestV1>(
                smuggled
            )
            .is_err(),
            "request must reject {smuggled}"
        );
    }
}

#[test]
fn managed_restore_request_and_response_are_strictly_staged() {
    let request = CloudflareDeriverTenantRootManagedRestoreRequestV1 {
        public_state_b64u: "state".to_owned(),
        restore_capability_b64u: "capability".to_owned(),
    };
    let request_json = serde_json::to_value(&request).expect("request json");
    assert_eq!(request_json["public_state_b64u"], "state");
    assert_eq!(request_json["restore_capability_b64u"], "capability");
    for smuggled in [
        r#"{"public_state_b64u":"state","restore_capability_b64u":"capability","role":"deriver_a"}"#,
        r#"{"public_state_b64u":"state","restore_capability_b64u":"capability","epoch":1}"#,
        r#"{"public_state_b64u":"state"}"#,
    ] {
        assert!(
            serde_json::from_str::<CloudflareDeriverTenantRootManagedRestoreRequestV1>(
                smuggled
            )
            .is_err(),
            "managed-restore request must reject {smuggled}"
        );
    }

    let response = CloudflareDeriverTenantRootManagedRestoreResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::DeriverA,
        status: CloudflareDeriverTenantRootManagedRestoreStatusV1::StagedForForwardRefresh,
        capability_digest_b64u: "digest".to_owned(),
        staging_terminal_receipt_b64u: "receipt".to_owned(),
    };
    let response_json = serde_json::to_value(&response).expect("response json");
    assert_eq!(response_json["status"], "staged_for_forward_refresh");
    assert!(!response_json.to_string().contains("activation"));
}

#[test]
fn managed_restore_forward_refresh_request_requires_exact_inputs() {
    let request = CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1 {
        public_state_b64u: "state".to_owned(),
        restore_capability_b64u: "capability".to_owned(),
        refresh_context_b64u: "context".to_owned(),
        role_refresh_command_b64u: "command".to_owned(),
    };
    let json = serde_json::to_value(&request).expect("forward-refresh request json");
    assert_eq!(json["public_state_b64u"], "state");
    assert_eq!(json["restore_capability_b64u"], "capability");
    assert_eq!(json["refresh_context_b64u"], "context");
    assert_eq!(json["role_refresh_command_b64u"], "command");

    for smuggled in [
        r#"{"public_state_b64u":"state","restore_capability_b64u":"capability","refresh_context_b64u":"context","role_refresh_command_b64u":"command","role":"deriver_a"}"#,
        r#"{"public_state_b64u":"state","restore_capability_b64u":"capability","refresh_context_b64u":"context"}"#,
        r#"{"public_state_b64u":"state","restore_capability_b64u":"capability","role_refresh_command_b64u":"command"}"#,
    ] {
        assert!(
            serde_json::from_str::<
                CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1,
            >(smuggled)
            .is_err(),
            "managed-restore forward-refresh request must reject {smuggled}"
        );
    }
}

#[test]
fn cleanup_response_distinguishes_pending_from_retired_erasure() {
    let pending = CloudflareDeriverTenantRootCleanupResponseV1::PendingDeleted {
        role: CloudflareTenantRootCreateRoleV1::DeriverA,
        cleanup_receipt_b64u: "pending-receipt".to_owned(),
    };
    let retired = CloudflareDeriverTenantRootCleanupResponseV1::RetiredDeleted {
        role: CloudflareTenantRootCreateRoleV1::DeriverA,
        cleanup_receipt_b64u: "retired-receipt".to_owned(),
        r2_deletion: serde_json::from_value(serde_json::json!({
            "managed_backup_object_key": "managed-backup",
            "provider_canary_object_key": "provider-canary",
            "managed_backup": "removed",
            "provider_canary": "already_absent",
            "cryptographic_erasure": "cryptographic_erasure_unverified"
        }))
        .expect("R2 deletion receipt"),
        cryptographic_erasure:
            CloudflareTenantRootCryptographicErasureStatusV1::CryptographicErasureUnverified,
        cancelled_admissions: 0,
    };

    let pending_json = serde_json::to_value(pending).expect("pending cleanup response");
    let retired_json = serde_json::to_value(retired).expect("retired cleanup response");
    assert_eq!(pending_json["kind"], "pending_deleted");
    assert!(pending_json.get("cryptographic_erasure").is_none());
    assert_eq!(retired_json["kind"], "retired_deleted");
    assert_eq!(
        retired_json["cryptographic_erasure"],
        "cryptographic_erasure_unverified"
    );
    assert_eq!(retired_json["r2_deletion"]["managed_backup"], "removed");
    assert_eq!(
        retired_json["r2_deletion"]["provider_canary"],
        "already_absent"
    );
    assert_eq!(
        retired_json["r2_deletion"]["cryptographic_erasure"],
        "cryptographic_erasure_unverified"
    );
}

/// The scalar-leak proof, extended over the sealed persistence input.
#[test]
fn no_deriver_response_field_carries_share_material() {
    let TenantRootRoleCreationProgressV1::Committed { pending: a } =
        execute(TwoPartyDeriverRole::DeriverA, None, 0x77).expect("A committed")
    else {
        panic!("expected a committed first leg")
    };
    let a_commitment = a.commitment_bytes().to_vec();
    let TenantRootRoleCreationProgressV1::Sealed {
        signed_commitment,
        signed_installation_evidence,
        input,
        managed_backup,
        completion:
            TenantRootRoleCreationCompletionV1::RoleOnly {
                provider_canary_receipt,
            },
        ..
    } = execute(TwoPartyDeriverRole::DeriverB, Some(&a_commitment), 0x88).expect("B sealed")
    else {
        panic!("expected a sealed second leg")
    };

    // Everything this Deriver would put on the wire back to the Router.
    let signed_managed_backup = managed_backup.canonical_bytes().to_vec();
    let response = CloudflareDeriverTenantRootCreateRoleShareResponseV1::PeerCompleted {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(TwoPartyDeriverRole::DeriverB),
        signed_commitment_b64u: crate::encode_base64url_bytes_v1(&signed_commitment),
        signed_installation_evidence_b64u: crate::encode_base64url_bytes_v1(
            &signed_installation_evidence,
        ),
        signed_managed_backup_b64u: crate::encode_base64url_bytes_v1(&signed_managed_backup),
        terminal_receipt_b64u: crate::encode_base64url_bytes_v1(b"terminal-receipt"),
        provider_canary_receipt_b64u: crate::encode_base64url_bytes_v1(
            &provider_canary_receipt,
        ),
    };
    let response_json = serde_json::to_string(&response).expect("response json");
    assert!(response_json.contains("\"kind\":\"peer_completed\""));
    assert!(response_json.contains("signed_managed_backup_b64u"));
    assert!(response_json.contains("provider_canary_receipt_b64u"));
    assert!(response_json.contains("terminal_receipt_b64u"));
    assert!(!response_json.contains("pending_persisted"));
    for incomplete in [
        r#"{"role":"deriver_b","signed_commitment_b64u":"c","signed_installation_evidence_b64u":"e","signed_managed_backup_b64u":"b","terminal_receipt_b64u":"r","provider_canary_receipt_b64u":"p"}"#,
        r#"{"kind":"peer_completed","role":"deriver_b","signed_commitment_b64u":"c","signed_installation_evidence_b64u":"e"}"#,
        r#"{"kind":"peer_completed","role":"deriver_b","signed_commitment_b64u":"c","signed_installation_evidence_b64u":"e","signed_managed_backup_b64u":"b","terminal_receipt_b64u":"r","provider_canary_receipt_b64u":"p","pending_persisted":true}"#,
    ] {
        assert!(
            serde_json::from_str::<CloudflareDeriverTenantRootCreateRoleShareResponseV1>(
                incomplete
            )
            .is_err(),
            "response must reject {incomplete}"
        );
    }

    // B's scalar, recovered from the record it is about to persist.
    let sealed = input.sealed_share_ciphertext_for_test();
    assert!(!sealed.is_empty());

    // The commitment is a public point; the evidence is a proof. Neither,
    // nor the serialized response, may contain the sealed ciphertext.
    for (label, wire) in [
        ("signed commitment", signed_commitment.as_slice()),
        (
            "signed installation evidence",
            signed_installation_evidence.as_slice(),
        ),
        ("response json", response_json.as_bytes()),
    ] {
        assert!(
            !wire
                .windows(sealed.len())
                .any(|window| window == sealed.as_slice()),
            "{label} contains sealed share material"
        );
    }
}
