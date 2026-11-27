use super::*;
use crate::CloudflareEd25519YaoRoleFailureResponseV1;
use router_ab_core::{
    Ed25519YaoCeremonyBindingV1, Ed25519YaoEncryptedPackageV1, Ed25519YaoInputPairBindingV1,
    Ed25519YaoOperationV1, Ed25519YaoPackageKindV1, Ed25519YaoSessionIdV1,
    Ed25519YaoStableKeyContextBindingV1, ExpensiveWorkKindV1, LifecycleScopeV1,
    MpcMaterialActivationRefV1, PublicDigest32, RootShareEpoch,
    RouterEd25519YaoExecuteFailureCodeV1,
};
use router_ab_ed25519_yao::Ed25519YaoActivationRoleExecutionV1;

fn encrypted_input(ciphertext_byte: u8) -> Ed25519YaoEncryptedInputV1 {
    Ed25519YaoEncryptedInputV1::new(
        Ed25519YaoInputKindV1::Activation,
        Ed25519YaoDeriverRoleV1::DeriverB,
        Ed25519YaoOperationV1::Registration,
        [1; 32],
        [2; 32],
        [3; 32],
        vec![ciphertext_byte; 16],
    )
    .expect("test input is valid")
}

fn pair_for_completion() -> (Ed25519YaoInputPairBindingV1, Ed25519YaoEncryptedInputV1) {
    let input_b = encrypted_input(4);
    let input_a = Ed25519YaoEncryptedInputV1::new(
        Ed25519YaoInputKindV1::Activation,
        Ed25519YaoDeriverRoleV1::DeriverA,
        Ed25519YaoOperationV1::Registration,
        [1; 32],
        [2; 32],
        [3; 32],
        vec![5; 16],
    )
    .expect("Deriver A input");
    let lifecycle = LifecycleScopeV1::new(
        "completion-test",
        ExpensiveWorkKindV1::RegistrationPrepare,
        RootShareEpoch::new("epoch").expect("epoch"),
        "account",
        "session",
        "signer-set",
        "server",
    )
    .expect("lifecycle");
    let binding = Ed25519YaoCeremonyBindingV1::new(
        lifecycle,
        Ed25519YaoOperationV1::Registration,
        Ed25519YaoSessionIdV1::new([1; 32]).expect("session"),
        Ed25519YaoStableKeyContextBindingV1::new([2; 32]),
        MpcMaterialActivationRefV1::new(
            "activation",
            "near-ed25519-yao",
            "account",
            "key-binding",
            "lifecycle-binding",
            "server",
        )
        .expect("material activation"),
    )
    .expect("binding");
    let pair = Ed25519YaoInputPairBindingV1::from_ceremony_binding(
        binding,
        &input_a,
        &input_b,
        PublicDigest32::new([13; 32]),
        PublicDigest32::new([14; 32]),
    )
    .expect("pair");
    (pair, input_a)
}

fn role_execution_for_pair(pair: &Ed25519YaoInputPairBindingV1) -> Ed25519YaoRoleExecutionV1 {
    let session = pair.session();
    let client_package = Ed25519YaoEncryptedPackageV1::new(
        Ed25519YaoPackageKindV1::ActivationClient,
        Ed25519YaoDeriverRoleV1::DeriverA,
        session,
        [4; 32],
        [5; 32],
        vec![6; 16],
    )
    .expect("client package");
    let signing_worker_package = Ed25519YaoEncryptedPackageV1::new(
        Ed25519YaoPackageKindV1::ActivationSigningWorker,
        Ed25519YaoDeriverRoleV1::DeriverA,
        session,
        [4; 32],
        [7; 32],
        vec![8; 16],
    )
    .expect("SigningWorker package");
    Ed25519YaoRoleExecutionV1::Activation(Ed25519YaoActivationRoleExecutionV1 {
        binding: pair.binding().clone(),
        deriver: Ed25519YaoDeriverRoleV1::DeriverA,
        transcript: [4; 32],
        client_commitment: [5; 32],
        signing_worker_commitment: [6; 32],
        client_package,
        signing_worker_package,
    })
}

fn tenant_root_context_for_pair(
    pair: &Ed25519YaoInputPairBindingV1,
) -> crate::CloudflareEd25519YaoTenantRootContextV2 {
    crate::CloudflareEd25519YaoTenantRootContextV2 {
        wallet_route: serde_json::from_value(serde_json::json!({
            "home": "US",
            "addresses": {
                "router": "11".repeat(32),
                "deriver_a": "22".repeat(32),
                "deriver_b": "33".repeat(32),
                "signing_worker": "44".repeat(32),
            },
        }))
        .expect("wallet route"),
        ownership_generation: 1,
        identity: router_ab_core::TenantRootIdentityV1::new(
            "org", "project", "env", "root", "v1",
        )
        .expect("root identity"),
        custody_binding: crate::CloudflareTenantRootCustodyBindingWireV1 {
            activation_receipt_b64u: "AQ".to_owned(),
            operation_id: router_ab_core::TenantRootDerivationOperationIdV1::from_bytes(
                [21; 16],
            )
            .expect("operation"),
            session_id: router_ab_core::TenantRootDerivationSessionIdV1::from_bytes([22; 16])
                .expect("session"),
            nonce: router_ab_core::TenantRootDerivationNonceV1::from_bytes([23; 32])
                .expect("nonce"),
            issued_at_ms: 1,
            expires_at_ms: 2,
        },
        outer_binding: Ed25519YaoOuterBindingV2::new(
            router_ab_core::Ed25519YaoPairSessionIdV2::from_yao_session(
                Ed25519YaoSessionIdV1::new(pair.session()).expect("pair session"),
            ),
            pair.binding().stable_key_context_binding,
            PublicDigest32::new([24; 32]),
            [25; 16],
            1,
            2,
        )
        .expect("outer binding"),
        application: router_ab_core::RouterAbEd25519YaoApplicationBindingFactsV1::new(
            "account", "near-key", "root", 1,
        )
        .expect("application"),
        participant_ids: [1, 2],
    }
}

#[test]
fn session_expiry_uses_checked_arithmetic() {
    assert_eq!(yao_expiry_from_now(10, 20).expect("expiry fits"), 30);
    assert!(yao_expiry_from_now(u64::MAX, 1).is_err());
}

#[test]
fn role_failure_mapping_preserves_only_sanitized_retry_class() {
    let expired = CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
        &RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::PairPreparationExpired,
            "diagnostic text is not part of the classification contract",
        ),
    );
    assert_eq!(
        expired,
        CloudflareEd25519YaoRoleFailureResponseV1::RecoverableFailure {
            code: RouterEd25519YaoExecuteFailureCodeV1::CeremonyExpired,
            retry_after_ms: 1_000,
        }
    );

    let missing = CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
        &RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingPairPreparation,
            "diagnostic text is not part of the classification contract",
        ),
    );
    assert_eq!(
        missing,
        CloudflareEd25519YaoRoleFailureResponseV1::Rejected {
            code: RouterEd25519YaoExecuteFailureCodeV1::MissingPreparation,
        }
    );

    let conflicting = CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
        &RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "the diagnostic is not part of the classification contract",
        ),
    );
    assert_eq!(
        conflicting,
        CloudflareEd25519YaoRoleFailureResponseV1::Rejected {
            code: RouterEd25519YaoExecuteFailureCodeV1::ConflictingPair,
        }
    );

    let untyped_conflict = CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
        &RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "Deriver B pair is already running",
        ),
    );
    assert_eq!(
        untyped_conflict,
        CloudflareEd25519YaoRoleFailureResponseV1::Rejected {
            code: RouterEd25519YaoExecuteFailureCodeV1::TerminalRoleFailure,
        }
    );
}

#[test]
fn preparation_store_failure_is_retryable_and_keeps_typed_refusals() {
    let transient = preparation_command_error_v1(invalid_lifecycle(
        "Deriver B wallet pair command failed: D1Error: Network connection lost",
    ));
    assert_eq!(
        CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(&transient),
        CloudflareEd25519YaoRoleFailureResponseV1::RecoverableFailure {
            code: RouterEd25519YaoExecuteFailureCodeV1::ServiceUnavailable,
            retry_after_ms: 1_000,
        }
    );
    let superseded = preparation_command_error_v1(invalid_lifecycle(
        "Deriver B wallet pair command failed: SupersededAttempt: a later attempt took its place",
    ));
    assert_eq!(
        CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(&superseded),
        CloudflareEd25519YaoRoleFailureResponseV1::Rejected {
            code: RouterEd25519YaoExecuteFailureCodeV1::AttemptSuperseded,
        }
    );
}

#[test]
fn pair_completion_transition_is_forward_only() {
    let (pair, input) = pair_for_completion();
    let input_digest = [12; 32];
    let pair_digest = [9; 32];
    let execution_id = [10; 32];
    let execution = role_execution_for_pair(&pair);
    let tenant_root = tenant_root_context_for_pair(&pair);
    let running = PairYaoSessionRecordV1::Running {
        pair_digest,
        input_digest,
        root_metadata_digest: [15; 32],
        execution_id,
        started_at_ms: 100,
        pair_binding: Box::new(pair.clone()),
        tenant_root: Box::new(tenant_root),
        input: Box::new(input),
        work: crate::CloudflareEd25519YaoPairWorkV1::Ceremony,
    };
    let completed =
        completed_pair_record_if_running(&running, pair_digest, input_digest, &execution, 101)
            .expect("running pair completes before its deadline");
    assert!(matches!(
        completed,
        PairYaoSessionRecordV1::Completed { .. }
    ));
    assert!(
        completed_pair_record_if_running(
            &completed,
            pair_digest,
            input_digest,
            &execution,
            102
        )
        .is_none(),
        "an exact completion replay cannot rewrite a terminal record"
    );
    assert!(matches!(
        completed_pair_record_if_running(
            &running,
            pair_digest,
            input_digest,
            &execution,
            100 + YAO_RUNNING_LIFETIME_MS,
        ),
        Some(PairYaoSessionRecordV1::Burned { .. })
    ));
    let burned = PairYaoSessionRecordV1::Burned {
        pair_digest,
        input_digest,
        execution_id,
    };
    assert!(completed_pair_record_if_running(
        &burned,
        pair_digest,
        input_digest,
        &execution,
        101
    )
    .is_none());
    assert!(completed_pair_record_if_running(
        &running,
        [16; 32],
        input_digest,
        &execution,
        101
    )
    .is_none());
    assert!(
        completed_pair_record_if_running(&running, pair_digest, [17; 32], &execution, 101)
            .is_none()
    );
}

#[test]
fn pair_start_refusal_answers_only_its_exact_execution() {
    let (pair, _) = pair_for_completion();
    let execution_id = Ed25519YaoExecutionIdV1::new(pair.pair_digest().bytes).expect("id");
    let refusal = CloudflareEd25519YaoPairStartRefusalV1 {
        session: pair.session(),
        pair_digest: pair.pair_digest().bytes,
        execution_id,
        reason: CloudflareEd25519YaoPairStartRefusalReasonV1::NotPrepared,
    };
    assert!(refusal.answers(&pair, execution_id));
    assert!(!refusal.answers(
        &pair,
        Ed25519YaoExecutionIdV1::new([9; 32]).expect("other id")
    ));
    let other_pair = CloudflareEd25519YaoPairStartRefusalV1 {
        pair_digest: [9; 32],
        ..refusal.clone()
    };
    assert!(!other_pair.answers(&pair, execution_id));
    let other_session = CloudflareEd25519YaoPairStartRefusalV1 {
        session: [9; 32],
        ..refusal
    };
    assert!(!other_session.answers(&pair, execution_id));
}
