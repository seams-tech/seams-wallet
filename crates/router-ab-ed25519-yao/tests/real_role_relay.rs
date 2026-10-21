use core::fmt::Debug;
use std::collections::BTreeMap;

use curve25519_dalek::scalar::Scalar;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;
use rand_core_09::{OsRng, TryRngCore};

use router_ab_core::{
    Ed25519YaoCeremonyBindingV1, Ed25519YaoDeriverRoleV1, Ed25519YaoOperationV1,
    Ed25519YaoPackageKindV1, Ed25519YaoSessionIdV1, Ed25519YaoStableKeyContextBindingV1,
    ExpensiveWorkKindV1, LifecycleScopeV1, MpcMaterialActivationRefV1, RootShareEpoch,
    StableTenantDerivationContextV2,
};
use router_ab_ecdsa_derivation::shared::secp256k1::{
    add_secp256k1_public_keys_33, secp256k1_private_key_32_to_public_key_33,
    secp256k1_public_key_33_to_ethereum_address_20,
};
use router_ab_ed25519_yao::recipient::{
    client::{combine_client_activation_packages, combine_export_packages},
    signing_worker::combine_signing_worker_activation_packages,
};
use router_ab_ed25519_yao::relay::{
    derive_registration_receipt, verify_activation_continuity, ActivationPublicCommitments,
    DirectionalWireDecoder, DirectionalWireEncoder, RelayEvent, RelayInstruction, RelayStep,
    WireDirection, WireMessage, WireMessageKind,
};
use router_ab_ed25519_yao::{
    build_activation_deriver_a, build_activation_deriver_b, build_export_deriver_a,
    build_export_deriver_b, combine_ed25519_yao_signing_worker_packages_source_preserving_v1,
    combine_ed25519_yao_signing_worker_packages_v1, derive_ed25519_yao_recipient_key_pair_v1,
    seal_ed25519_yao_activation_deriver_a_execution_v1,
    seal_ed25519_yao_activation_deriver_b_execution_v1, seal_ed25519_yao_package_v1,
    verify_ed25519_yao_signing_worker_reissue_v1, ActivationDeriverA,
    ActivationDeriverAContribution, ActivationDeriverB, ActivationDeriverBContribution,
    Ed25519YaoActiveSigningMaterialV1, Ed25519YaoRoleExecutionV1,
    Ed25519YaoSigningWorkerPackageDeliveryV1, ExportDeriverA, ExportDeriverAContribution,
    ExportDeriverB, ExportDeriverBContribution, LocalEd25519YaoActivationRecipientsV1,
};
use signer_core::ed25519_yao_derivation::{
    derive_ed25519_yao_client_contributions_v1,
    derive_ed25519_yao_deriver_a_server_contribution_v1,
    derive_ed25519_yao_deriver_b_server_contribution_v1, Ed25519YaoApplicationBindingFactsV1,
    Ed25519YaoApplicationBindingKeyCreationSignerSlotV1,
    Ed25519YaoApplicationBindingSigningKeyIdV1, Ed25519YaoApplicationBindingSigningRootIdV1,
    Ed25519YaoApplicationBindingWalletIdV1, Ed25519YaoClientRootV1,
    Ed25519YaoDeriverAClientContributionV1, Ed25519YaoDeriverADerivationRootV1,
    Ed25519YaoDeriverAServerContributionV1, Ed25519YaoDeriverBClientContributionV1,
    Ed25519YaoDeriverBDerivationRootV1, Ed25519YaoDeriverBServerContributionV1,
    Ed25519YaoStableKeyDerivationContextV1,
};
use signer_core::near_ed25519_recovery::{
    build_near_ed25519_seed_export_artifact_v1, expand_ed25519_seed,
};
use signer_core::near_threshold_ed25519::{
    aggregate_signature, build_signing_package, client_round1_commit,
    client_round2_signature_share, key_package_from_signing_share_bytes,
    verifying_share_bytes_from_signing_share_bytes,
};
use signer_core::near_threshold_frost::compute_threshold_ed25519_group_public_key_2p_from_verifying_shares;
use threshold_prf::{
    apply_two_party_root_share_refresh, combine_verified_partials,
    complete_ed25519_deriver_a_target_v1, complete_ed25519_deriver_b_target_v1,
    evaluate_partial_with_dleq_proof, generate_two_party_root_share,
    prepare_ed25519_deriver_a_target_v1, prepare_ed25519_deriver_b_target_v1, PrfContext,
    PrfPurpose, RootShareRefreshCoefficient, SigningRootShare, SigningRootShareCommitment, SuiteId,
    ThresholdPolicy, TwoPartyDeriverRole, ValidatedThresholdSet,
};
use zeroize::{Zeroize, Zeroizing};

fn lifecycle(work_kind: ExpensiveWorkKindV1) -> LifecycleScopeV1 {
    LifecycleScopeV1::new(
        "local-lifecycle-1",
        work_kind,
        RootShareEpoch::new("epoch-1").expect("root epoch"),
        "account-1",
        "wallet-session-1",
        "signer-set-1",
        "signing-worker-1",
    )
    .expect("lifecycle")
}

fn binding(
    operation: Ed25519YaoOperationV1,
    work_kind: ExpensiveWorkKindV1,
    session: [u8; 32],
) -> Ed25519YaoCeremonyBindingV1 {
    activation_binding(operation, work_kind, session, "activation-1")
}

fn activation_binding(
    operation: Ed25519YaoOperationV1,
    work_kind: ExpensiveWorkKindV1,
    session: [u8; 32],
    activation_id: &str,
) -> Ed25519YaoCeremonyBindingV1 {
    Ed25519YaoCeremonyBindingV1::new(
        lifecycle(work_kind),
        operation,
        Ed25519YaoSessionIdV1::new(session).expect("session"),
        Ed25519YaoStableKeyContextBindingV1::new(decode_hex_32(
            "b5601ad156882b545a2e4a4a694e87c7982842d37a4c666645302604b2720655",
        )),
        MpcMaterialActivationRefV1::new(
            activation_id,
            "capability-1",
            "account-1",
            "key-1",
            "local-lifecycle-1",
            "signing-worker-1",
        )
        .expect("material activation"),
    )
    .expect("binding")
}

fn expect_continue<R, C>(step: RelayStep<R, C>) -> R {
    match step {
        RelayStep::Continue(role) => role,
        _ => panic!("expected continuation"),
    }
}

fn expect_send<R, C>(step: RelayStep<R, C>) -> (R, WireMessage) {
    match step {
        RelayStep::Send { role, message } => (role, message),
        _ => panic!("expected outbound message"),
    }
}

fn expect_complete<R, C>(step: RelayStep<R, C>) -> C {
    match step {
        RelayStep::Complete(completion) => completion,
        _ => panic!("expected completion"),
    }
}

fn route_message(
    message: WireMessage,
    encoder: &mut DirectionalWireEncoder,
    decoder: &mut DirectionalWireDecoder,
) -> WireMessage {
    let encoded = encoder.encode(message).expect("encode envelope");
    let mut offset = 0;
    while offset < encoded.len() {
        let end = core::cmp::min(offset + 19, encoded.len());
        let consumed = decoder.push(&encoded[offset..end]).expect("decode chunk");
        assert_ne!(consumed, 0);
        offset += consumed;
    }
    decoder
        .take_message()
        .expect("decode envelope")
        .expect("complete envelope")
}

fn receive_instruction(message: &WireMessage) -> RelayInstruction {
    RelayInstruction::Receive {
        kind: message.kind(),
        payload_bytes: message.as_bytes().len(),
    }
}

fn run_roles<A, B, AC, BC, E>(
    session: [u8; 32],
    mut a: A,
    mut b: B,
    handle_a: fn(A, RelayEvent) -> Result<RelayStep<A, AC>, E>,
    handle_b: fn(B, RelayEvent) -> Result<RelayStep<B, BC>, E>,
    instruction_a: fn(&A) -> Result<RelayInstruction, E>,
    instruction_b: fn(&B) -> Result<RelayInstruction, E>,
) -> (AC, BC)
where
    E: Debug,
{
    let mut a_to_b_encoder =
        DirectionalWireEncoder::new(WireDirection::DeriverAToDeriverB, session).expect("A encoder");
    let mut a_to_b_decoder =
        DirectionalWireDecoder::new(WireDirection::DeriverAToDeriverB, session).expect("B decoder");
    let mut b_to_a_encoder =
        DirectionalWireEncoder::new(WireDirection::DeriverBToDeriverA, session).expect("B encoder");
    let mut b_to_a_decoder =
        DirectionalWireDecoder::new(WireDirection::DeriverBToDeriverA, session).expect("A decoder");

    assert_eq!(
        instruction_b(&b).expect("B instruction"),
        RelayInstruction::Advance
    );
    let (next_b, offer) = expect_send(handle_b(b, RelayEvent::Advance).expect("B offer"));
    b = next_b;
    let offer = route_message(offer, &mut b_to_a_encoder, &mut b_to_a_decoder);
    assert_eq!(
        instruction_a(&a).expect("A receive offer"),
        receive_instruction(&offer)
    );
    a = expect_continue(handle_a(a, RelayEvent::Inbound(offer)).expect("A accepts offer"));

    let (next_a, choices) = expect_send(handle_a(a, RelayEvent::Advance).expect("A choices"));
    a = next_a;
    let choices = route_message(choices, &mut a_to_b_encoder, &mut a_to_b_decoder);
    b = expect_continue(handle_b(b, RelayEvent::Inbound(choices)).expect("B accepts choices"));

    let (next_a, direct) = expect_send(handle_a(a, RelayEvent::Advance).expect("A direct"));
    a = next_a;
    let direct = route_message(direct, &mut a_to_b_encoder, &mut a_to_b_decoder);
    let (next_b, extension) =
        expect_send(handle_b(b, RelayEvent::Inbound(direct)).expect("B extension"));
    b = next_b;
    let extension = route_message(extension, &mut b_to_a_encoder, &mut b_to_a_decoder);
    a = expect_continue(handle_a(a, RelayEvent::Inbound(extension)).expect("A accepts extension"));

    let (next_a, masked) = expect_send(handle_a(a, RelayEvent::Advance).expect("A masked"));
    a = next_a;
    let masked = route_message(masked, &mut a_to_b_encoder, &mut a_to_b_decoder);
    b = expect_continue(handle_b(b, RelayEvent::Inbound(masked)).expect("B accepts masked"));

    let (next_a, manifest) = expect_send(handle_a(a, RelayEvent::Advance).expect("A manifest"));
    a = next_a;
    let manifest = route_message(manifest, &mut a_to_b_encoder, &mut a_to_b_decoder);
    b = expect_continue(handle_b(b, RelayEvent::Inbound(manifest)).expect("B accepts manifest"));

    let translation = loop {
        let (next_a, message) =
            expect_send(handle_a(a, RelayEvent::Advance).expect("A stream step"));
        a = next_a;
        match message.kind() {
            WireMessageKind::TableFrame => {
                let frame = route_message(message, &mut a_to_b_encoder, &mut a_to_b_decoder);
                b = expect_continue(
                    handle_b(b, RelayEvent::Inbound(frame)).expect("B accepts frame"),
                );
            }
            WireMessageKind::OutputTranslation => break message,
            kind => panic!("unexpected stream message: {kind:?}"),
        }
    };

    let translation = route_message(translation, &mut a_to_b_encoder, &mut a_to_b_decoder);
    b = expect_continue(
        handle_b(b, RelayEvent::Inbound(translation)).expect("B accepts translation"),
    );

    let a_local_eof = a_to_b_encoder
        .finish_after_transport_close()
        .expect("A local EOF");
    a = expect_continue(
        handle_a(a, RelayEvent::LocalDirectionalEof(a_local_eof)).expect("A records EOF"),
    );
    let b_peer_eof = a_to_b_decoder
        .finish_at_transport_eof()
        .expect("B peer EOF");
    b = expect_continue(
        handle_b(b, RelayEvent::InboundDirectionalEof(b_peer_eof)).expect("B records peer EOF"),
    );

    let (next_b, returned) =
        expect_send(handle_b(b, RelayEvent::Advance).expect("B returned labels"));
    b = next_b;
    let returned = route_message(returned, &mut b_to_a_encoder, &mut b_to_a_decoder);
    a = expect_continue(
        handle_a(a, RelayEvent::Inbound(returned)).expect("A accepts returned labels"),
    );

    let b_local_eof = b_to_a_encoder
        .finish_after_transport_close()
        .expect("B local EOF");
    let b_completion = expect_complete(
        handle_b(b, RelayEvent::LocalDirectionalEof(b_local_eof)).expect("B completes"),
    );
    let a_peer_eof = b_to_a_decoder
        .finish_at_transport_eof()
        .expect("A peer EOF");
    let a_completion = expect_complete(
        handle_a(a, RelayEvent::InboundDirectionalEof(a_peer_eof)).expect("A completes"),
    );
    (a_completion, b_completion)
}

fn decode_hex_32(value: &str) -> [u8; 32] {
    let mut output = [0_u8; 32];
    assert_eq!(value.len(), 64);
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = (pair[0] as char).to_digit(16).expect("hex") as u8;
        let low = (pair[1] as char).to_digit(16).expect("hex") as u8;
        output[index] = (high << 4) | low;
    }
    output
}

fn derive_vector_contributions() -> (
    Ed25519YaoStableKeyDerivationContextV1,
    Ed25519YaoDeriverAClientContributionV1,
    Ed25519YaoDeriverBClientContributionV1,
    Ed25519YaoDeriverAServerContributionV1,
    Ed25519YaoDeriverBServerContributionV1,
) {
    let application = Ed25519YaoApplicationBindingFactsV1::new(
        Ed25519YaoApplicationBindingWalletIdV1::parse("wallet-fixture").expect("wallet"),
        Ed25519YaoApplicationBindingSigningKeyIdV1::parse("ed25519ks_fixture")
            .expect("signing key"),
        Ed25519YaoApplicationBindingSigningRootIdV1::parse("project-fixture:env-fixture")
            .expect("signing root"),
        Ed25519YaoApplicationBindingKeyCreationSignerSlotV1::new(1).expect("slot"),
    );
    let context = Ed25519YaoStableKeyDerivationContextV1::new(application.digest(), 1, 2)
        .expect("stable context");
    let client_root = Ed25519YaoClientRootV1::from_secret_bytes([0x11; 32]);
    let deriver_a_root = Ed25519YaoDeriverADerivationRootV1::from_secret_bytes([0x22; 32]);
    let deriver_b_root = Ed25519YaoDeriverBDerivationRootV1::from_secret_bytes([0x33; 32]);
    let (client_a, client_b) = derive_ed25519_yao_client_contributions_v1(&client_root, &context)
        .expect("client KDF")
        .into_parts();
    let server_a = derive_ed25519_yao_deriver_a_server_contribution_v1(&deriver_a_root, &context)
        .expect("A server KDF");
    let server_b = derive_ed25519_yao_deriver_b_server_contribution_v1(&deriver_b_root, &context)
        .expect("B server KDF");
    (context, client_a, client_b, server_a, server_b)
}

fn vector_activation_deliveries(
    binding: &Ed25519YaoCeremonyBindingV1,
    recipient: [u8; 32],
) -> (
    Ed25519YaoSigningWorkerPackageDeliveryV1,
    Ed25519YaoSigningWorkerPackageDeliveryV1,
) {
    let (context, client_a, client_b, server_a, server_b) = derive_vector_contributions();
    let role_a = build_activation_deriver_a(
        binding,
        ActivationDeriverAContribution::base(&context, client_a, server_a),
    )
    .expect("vector Deriver A");
    let role_b = build_activation_deriver_b(
        binding,
        ActivationDeriverBContribution::base(&context, client_b, server_b),
    )
    .expect("vector Deriver B");
    let session = binding.session_id.into_bytes();
    let (a, b) = run_roles(
        session,
        role_a,
        role_b,
        ActivationDeriverA::handle,
        ActivationDeriverB::handle,
        ActivationDeriverA::instruction,
        ActivationDeriverB::instruction,
    );
    let transcript = a.final_transcript();
    assert_eq!(transcript, b.final_transcript());
    let mut os_rng = OsRng;
    let mut rng = os_rng.unwrap_mut();
    let a_package = seal_ed25519_yao_package_v1(
        &mut rng,
        Ed25519YaoPackageKindV1::ActivationSigningWorker,
        Ed25519YaoDeriverRoleV1::DeriverA,
        session,
        transcript,
        recipient,
        &a.signing_worker_package().into_bytes(),
    )
    .expect("seal vector A package");
    let b_package = seal_ed25519_yao_package_v1(
        &mut rng,
        Ed25519YaoPackageKindV1::ActivationSigningWorker,
        Ed25519YaoDeriverRoleV1::DeriverB,
        session,
        transcript,
        recipient,
        &b.signing_worker_package().into_bytes(),
    )
    .expect("seal vector B package");
    (
        Ed25519YaoSigningWorkerPackageDeliveryV1 {
            binding: binding.clone(),
            client_commitment: a.client_commitment(),
            signing_worker_commitment: a.signing_worker_commitment(),
            package: a_package,
        },
        Ed25519YaoSigningWorkerPackageDeliveryV1 {
            binding: binding.clone(),
            client_commitment: b.client_commitment(),
            signing_worker_commitment: b.signing_worker_commitment(),
            package: b_package,
        },
    )
}

struct RegisteredAndRecovered {
    recipient: router_ab_ed25519_yao::Ed25519YaoRecipientKeyPairV1,
    source: router_ab_ed25519_yao::Ed25519YaoActiveSigningMaterialV1,
    recovery: Ed25519YaoCeremonyBindingV1,
    recovered: router_ab_ed25519_yao::Ed25519YaoActiveSigningMaterialV1,
}

/// Registers the vector key set (epoch 1) and recovers it (epoch 2).
fn register_and_recover_vector_source() -> RegisteredAndRecovered {
    let recipient =
        derive_ed25519_yao_recipient_key_pair_v1(&[0x71; 32]).expect("vector recipient");
    let registered = binding(
        Ed25519YaoOperationV1::Registration,
        ExpensiveWorkKindV1::RegistrationPrepare,
        [0x51; 32],
    );
    let (a, b) = vector_activation_deliveries(&registered, recipient.public_key);
    let (source, _) =
        combine_ed25519_yao_signing_worker_packages_v1(&recipient.private_key, a, b, None)
            .expect("register vector source")
            .into_parts();
    let mut recovery = binding(
        Ed25519YaoOperationV1::Recovery,
        ExpensiveWorkKindV1::Recovery,
        [0x52; 32],
    );
    recovery.material_activation.activation_id = "recovered-vector-material".to_owned();
    let (a, b) = vector_activation_deliveries(&recovery, recipient.public_key);
    let (recovered, _) =
        combine_ed25519_yao_signing_worker_packages_v1(&recipient.private_key, a, b, Some(&source))
            .expect("recover vector source")
            .into_parts();
    RegisteredAndRecovered {
        recipient,
        source,
        recovery,
        recovered,
    }
}

#[test]
fn recovered_source_links_with_the_registered_key_vector_and_next_epoch() {
    let RegisteredAndRecovered {
        recipient,
        source,
        recovery,
        recovered,
    } = register_and_recover_vector_source();
    let mut target = binding(
        Ed25519YaoOperationV1::Registration,
        ExpensiveWorkKindV1::RegistrationPrepare,
        [0x53; 32],
    );
    target.material_activation.activation_id = "linked-vector-material".to_owned();
    let (a, b) = vector_activation_deliveries(&target, recipient.public_key);
    let (linked, receipt) = combine_ed25519_yao_signing_worker_packages_source_preserving_v1(
        &recipient.private_key,
        a.clone(),
        b.clone(),
        &recovered,
    )
    .expect("link from recovered vector source")
    .into_parts();
    let expected =
        decode_hex_32("ccd255d0b88721771947038f1a7c29b49eee3902d6aa732e5e448251537bf077");
    assert_eq!(source.registered_public_key(), expected);
    assert_eq!(recovered.registered_public_key(), expected);
    assert_eq!(linked.registered_public_key(), expected);
    assert_eq!(source.state_epoch().get(), 1);
    assert_eq!(recovered.state_epoch().get(), 2);
    assert_eq!(linked.state_epoch().get(), 3);
    assert_eq!(receipt.state_epoch.get(), 3);
    assert_eq!(linked.binding(), &target);
    assert_eq!(recovered.binding(), &recovery);

    let mut changed_a = a;
    let mut changed_b = b;
    changed_a.binding.stable_key_context_binding =
        Ed25519YaoStableKeyContextBindingV1::new([0x99; 32]);
    changed_b.binding = changed_a.binding.clone();
    assert!(
        combine_ed25519_yao_signing_worker_packages_source_preserving_v1(
            &recipient.private_key,
            changed_a,
            changed_b,
            &recovered,
        )
        .is_err()
    );
}

#[test]
fn a_reissue_reproduces_the_recovered_signing_worker_share_and_keeps_the_epoch() {
    let RegisteredAndRecovered {
        recipient,
        source,
        recovery,
        recovered,
    } = register_and_recover_vector_source();
    // A recovery keeps the Signing Worker share and moves only the epoch.
    assert_eq!(recovered.scalar(), source.scalar());
    assert_eq!(recovered.state_epoch().get(), 2);

    let mut reissue = binding(
        Ed25519YaoOperationV1::Reissue,
        ExpensiveWorkKindV1::Reissue,
        [0x53; 32],
    );
    reissue.material_activation = recovery.material_activation.clone();
    let (a, b) = vector_activation_deliveries(&reissue, recipient.public_key);
    let receipt = verify_ed25519_yao_signing_worker_reissue_v1(
        &recipient.private_key,
        a.clone(),
        b.clone(),
        &recovered,
    )
    .expect("a reissue of the active material passes");
    assert_eq!(receipt.state_epoch.get(), 2);
    assert_eq!(
        receipt.registered_public_key,
        recovered.registered_public_key()
    );

    // An activation other than the active one is refused.
    let mut other = reissue.clone();
    other.material_activation.activation_id = "another-material".to_owned();
    let (other_a, other_b) = vector_activation_deliveries(&other, recipient.public_key);
    assert!(verify_ed25519_yao_signing_worker_reissue_v1(
        &recipient.private_key,
        other_a,
        other_b,
        &recovered,
    )
    .is_err());

    // A recovery run is not a reissue, and a reissue run is not an activation.
    let (recovery_a, recovery_b) = vector_activation_deliveries(&recovery, recipient.public_key);
    assert!(verify_ed25519_yao_signing_worker_reissue_v1(
        &recipient.private_key,
        recovery_a,
        recovery_b,
        &recovered,
    )
    .is_err());
    assert!(combine_ed25519_yao_signing_worker_packages_v1(
        &recipient.private_key,
        a,
        b,
        Some(&recovered),
    )
    .is_err());
}

#[test]
fn real_role_inputs_complete_activation_and_export() {
    let (context, client_a, client_b, server_a, server_b) = derive_vector_contributions();
    let expected_public_key =
        decode_hex_32("ccd255d0b88721771947038f1a7c29b49eee3902d6aa732e5e448251537bf077");
    let expected_seed =
        decode_hex_32("c6db6124f7fea8e20ec7ce7472d75210d647062c04d53d9311b3dab6d34bdfdc");
    let activation_session = [0x51; 32];
    let activation_binding = binding(
        Ed25519YaoOperationV1::Registration,
        ExpensiveWorkKindV1::RegistrationPrepare,
        activation_session,
    );
    let activation_a = build_activation_deriver_a(
        &activation_binding,
        ActivationDeriverAContribution::base(&context, client_a, server_a),
    )
    .expect("activation A");
    let activation_b = build_activation_deriver_b(
        &activation_binding,
        ActivationDeriverBContribution::base(&context, client_b, server_b),
    )
    .expect("activation B");
    let (activation_a, activation_b) = run_roles(
        activation_session,
        activation_a,
        activation_b,
        ActivationDeriverA::handle,
        ActivationDeriverB::handle,
        ActivationDeriverA::instruction,
        ActivationDeriverB::instruction,
    );
    assert_eq!(
        activation_a.final_transcript(),
        activation_b.final_transcript()
    );
    assert_eq!(activation_a.stream_metrics().frame_count(), 17);
    let commitments = ActivationPublicCommitments::new(
        activation_a.client_commitment(),
        activation_b.client_commitment(),
        activation_a.signing_worker_commitment(),
        activation_b.signing_worker_commitment(),
    );
    let receipt = derive_registration_receipt(commitments).expect("registration receipt");
    assert_eq!(receipt.registered_public_key(), &expected_public_key);
    assert_eq!(
        verify_activation_continuity(*receipt.registered_public_key(), commitments)
            .expect("activation continuity"),
        receipt
    );
    let mut wrong_public_key = *receipt.registered_public_key();
    wrong_public_key[0] ^= 1;
    assert!(verify_activation_continuity(wrong_public_key, commitments).is_err());
    let transcript = activation_a.final_transcript();
    let mut client_scalar = Zeroizing::new(
        combine_client_activation_packages(
            activation_session,
            transcript,
            activation_a.client_package(),
            activation_b.client_package(),
        )
        .expect("Client package combination")
        .into_bytes(),
    );
    let mut signing_worker_scalar = Zeroizing::new(
        combine_signing_worker_activation_packages(
            activation_session,
            transcript,
            activation_a.signing_worker_package(),
            activation_b.signing_worker_package(),
        )
        .expect("SigningWorker package combination")
        .into_bytes(),
    );
    let derived_public_key = compute_threshold_ed25519_group_public_key_2p_from_verifying_shares(
        &verifying_share_bytes_from_signing_share_bytes(&client_scalar),
        &verifying_share_bytes_from_signing_share_bytes(&signing_worker_scalar),
        1,
        2,
    )
    .expect("group public key");
    assert_eq!(&derived_public_key, receipt.registered_public_key());

    let client_id = frost_ed25519::Identifier::try_from(1_u16).expect("Client identifier");
    let signing_worker_id =
        frost_ed25519::Identifier::try_from(2_u16).expect("SigningWorker identifier");
    let mut client_key_package = key_package_from_signing_share_bytes(
        &client_scalar,
        receipt.registered_public_key(),
        client_id,
    )
    .expect("Client key package");
    let mut signing_worker_key_package = key_package_from_signing_share_bytes(
        &signing_worker_scalar,
        receipt.registered_public_key(),
        signing_worker_id,
    )
    .expect("SigningWorker key package");
    client_scalar.zeroize();
    signing_worker_scalar.zeroize();

    let mut client_round1 = client_round1_commit(&client_key_package).expect("Client round 1");
    let mut signing_worker_round1 =
        client_round1_commit(&signing_worker_key_package).expect("SigningWorker round 1");
    let admitted_signing_digest = [0x42_u8; 32];
    let signing_package = build_signing_package(
        &admitted_signing_digest,
        BTreeMap::from([
            (client_id, client_round1.commitments),
            (signing_worker_id, signing_worker_round1.commitments),
        ]),
    );
    let client_signature_share =
        client_round2_signature_share(&signing_package, &client_round1.nonces, &client_key_package)
            .expect("Client round 2");
    let signing_worker_signature_share = client_round2_signature_share(
        &signing_package,
        &signing_worker_round1.nonces,
        &signing_worker_key_package,
    )
    .expect("SigningWorker round 2");
    client_round1.nonces.zeroize();
    signing_worker_round1.nonces.zeroize();
    let threshold_signature = aggregate_signature(
        &signing_package,
        *client_key_package.verifying_key(),
        BTreeMap::from([
            (client_id, *client_key_package.verifying_share()),
            (
                signing_worker_id,
                *signing_worker_key_package.verifying_share(),
            ),
        ]),
        BTreeMap::from([
            (client_id, client_signature_share),
            (signing_worker_id, signing_worker_signature_share),
        ]),
    )
    .expect("aggregate threshold signature");
    let verifying_key = VerifyingKey::from_bytes(receipt.registered_public_key())
        .expect("registered verifying key");
    verifying_key
        .verify(
            &admitted_signing_digest,
            &Signature::from_bytes(&threshold_signature),
        )
        .expect("standard verification of threshold signature");
    client_key_package.zeroize();
    signing_worker_key_package.zeroize();

    let export_session = [0x61; 32];
    let export_binding = binding(
        Ed25519YaoOperationV1::Export,
        ExpensiveWorkKindV1::KeyExport,
        export_session,
    );
    let (context, client_a, client_b, server_a, server_b) = derive_vector_contributions();
    let export_a = build_export_deriver_a(
        &export_binding,
        ExportDeriverAContribution::from_derived(&context, client_a, server_a),
    )
    .expect("export A");
    let export_b = build_export_deriver_b(
        &export_binding,
        ExportDeriverBContribution::from_derived(&context, client_b, server_b),
    )
    .expect("export B");
    let (export_a, export_b) = run_roles(
        export_session,
        export_a,
        export_b,
        ExportDeriverA::handle,
        ExportDeriverB::handle,
        ExportDeriverA::instruction,
        ExportDeriverB::instruction,
    );
    assert_eq!(export_a.final_transcript(), export_b.final_transcript());
    assert_eq!(export_a.stream_metrics().frame_count(), 1);
    let mut exported_seed = Zeroizing::new(
        combine_export_packages(
            export_session,
            export_a.final_transcript(),
            export_a.export_package(),
            export_b.export_package(),
        )
        .expect("export package combination")
        .into_bytes(),
    );
    assert_eq!(*exported_seed, expected_seed);
    let expanded = expand_ed25519_seed(*exported_seed);
    assert_eq!(expanded.public_key_bytes, expected_public_key);
    let near_public_key = format!(
        "ed25519:{}",
        bs58::encode(expected_public_key).into_string()
    );
    let export_artifact =
        build_near_ed25519_seed_export_artifact_v1(*exported_seed, &near_public_key)
            .expect("seed export artifact");
    assert_eq!(export_artifact.public_key, near_public_key);

    let signing_key = SigningKey::from_bytes(&exported_seed);
    assert_eq!(signing_key.verifying_key().to_bytes(), expected_public_key);
    let export_proof_message = b"seams Phase 9C exact Ed25519 seed export";
    let standard_signature = signing_key.sign(export_proof_message);
    signing_key
        .verifying_key()
        .verify(export_proof_message, &standard_signature)
        .expect("standard signature from exported seed");
    exported_seed.zeroize();
}

#[test]
fn builders_reject_wrong_family_and_cross_lifecycle_activation_shapes() {
    let export_binding = binding(
        Ed25519YaoOperationV1::Export,
        ExpensiveWorkKindV1::KeyExport,
        [0x71; 32],
    );
    let (context, client_a, _, server_a, _) = derive_vector_contributions();
    assert!(build_activation_deriver_a(
        &export_binding,
        ActivationDeriverAContribution::base(&context, client_a, server_a),
    )
    .is_err());

    let refresh_binding = binding(
        Ed25519YaoOperationV1::Refresh,
        ExpensiveWorkKindV1::ServerShareRefresh,
        [0x72; 32],
    );
    let (context, _, client_b, _, server_b) = derive_vector_contributions();
    assert!(build_activation_deriver_b(
        &refresh_binding,
        ActivationDeriverBContribution::base(&context, client_b, server_b),
    )
    .is_err());

    let (context, _, client_b, _, server_b) = derive_vector_contributions();
    assert!(build_activation_deriver_b(
        &refresh_binding,
        ActivationDeriverBContribution::refresh(&context, client_b, server_b),
    )
    .is_ok());
}

/// Deterministic HPKE sealing randomness; no assertion depends on its output.
struct SealingRng(u64);

impl rand_core_09::RngCore for SealingRng {
    fn next_u32(&mut self) -> u32 {
        self.next_u64() as u32
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }

    fn fill_bytes(&mut self, destination: &mut [u8]) {
        for chunk in destination.chunks_mut(8) {
            let bytes = self.next_u64().to_le_bytes();
            chunk.copy_from_slice(&bytes[..chunk.len()]);
        }
    }
}

impl rand_core_09::CryptoRng for SealingRng {}

/// One real activation ceremony: the sealed Signing Worker deliveries and the
/// Client share combined from the same role completions.
struct SealedActivation {
    deriver_a: Ed25519YaoSigningWorkerPackageDeliveryV1,
    deriver_b: Ed25519YaoSigningWorkerPackageDeliveryV1,
    client_scalar: Zeroizing<[u8; 32]>,
}

fn signing_worker_delivery(
    execution: Ed25519YaoRoleExecutionV1,
) -> Ed25519YaoSigningWorkerPackageDeliveryV1 {
    let Ed25519YaoRoleExecutionV1::Activation(execution) = execution else {
        panic!("expected an activation role execution");
    };
    Ed25519YaoSigningWorkerPackageDeliveryV1 {
        binding: execution.binding,
        client_commitment: execution.client_commitment,
        signing_worker_commitment: execution.signing_worker_commitment,
        package: execution.signing_worker_package,
    }
}

fn seal_activation(
    rng: &mut SealingRng,
    binding: Ed25519YaoCeremonyBindingV1,
    recipients: LocalEd25519YaoActivationRecipientsV1,
) -> SealedActivation {
    let (context, client_a, client_b, server_a, server_b) = derive_vector_contributions();
    let session = binding.session_id.into_bytes();
    let role_a = build_activation_deriver_a(
        &binding,
        ActivationDeriverAContribution::base(&context, client_a, server_a),
    )
    .expect("activation A");
    let role_b = build_activation_deriver_b(
        &binding,
        ActivationDeriverBContribution::base(&context, client_b, server_b),
    )
    .expect("activation B");
    let (completion_a, completion_b) = run_roles(
        session,
        role_a,
        role_b,
        ActivationDeriverA::handle,
        ActivationDeriverB::handle,
        ActivationDeriverA::instruction,
        ActivationDeriverB::instruction,
    );
    let client_scalar = Zeroizing::new(
        combine_client_activation_packages(
            session,
            completion_a.final_transcript(),
            completion_a.client_package(),
            completion_b.client_package(),
        )
        .expect("Client package combination")
        .into_bytes(),
    );
    let deriver_a = signing_worker_delivery(
        seal_ed25519_yao_activation_deriver_a_execution_v1(
            rng,
            binding.clone(),
            recipients,
            &completion_a,
        )
        .expect("seal Deriver A execution"),
    );
    let deriver_b = signing_worker_delivery(
        seal_ed25519_yao_activation_deriver_b_execution_v1(rng, binding, recipients, &completion_b)
            .expect("seal Deriver B execution"),
    );
    SealedActivation {
        deriver_a,
        deriver_b,
        client_scalar,
    }
}

fn group_public_key(client_scalar: &[u8; 32], signing_worker_scalar: &[u8; 32]) -> [u8; 32] {
    compute_threshold_ed25519_group_public_key_2p_from_verifying_shares(
        &verifying_share_bytes_from_signing_share_bytes(client_scalar),
        &verifying_share_bytes_from_signing_share_bytes(signing_worker_scalar),
        1,
        2,
    )
    .expect("group public key")
}

fn source_preserving_refusal(
    private_key: &router_ab_ed25519_yao::Ed25519YaoRecipientPrivateKeyV1,
    deriver_a: Ed25519YaoSigningWorkerPackageDeliveryV1,
    deriver_b: Ed25519YaoSigningWorkerPackageDeliveryV1,
    source: &Ed25519YaoActiveSigningMaterialV1,
) -> String {
    combine_ed25519_yao_signing_worker_packages_source_preserving_v1(
        private_key,
        deriver_a,
        deriver_b,
        source,
    )
    .expect_err("source-preserving activation must refuse")
    .message()
    .to_owned()
}

/// Registration, then recovery, then a linked target registration whose
/// source is the recovered material. The source operation is the only fact
/// that separates the recovered source from a registered one: the same
/// material under a registration label preserves the key and advances the
/// epoch, while the target's own freshness, identity, pairing and recipient
/// checks still refuse stale or substituted packages.
#[test]
fn recovered_source_preserves_the_key_for_a_linked_target() {
    let expected_public_key =
        decode_hex_32("ccd255d0b88721771947038f1a7c29b49eee3902d6aa732e5e448251537bf077");
    let signing_worker =
        derive_ed25519_yao_recipient_key_pair_v1(&[0x71; 32]).expect("SigningWorker recipient");
    let client = derive_ed25519_yao_recipient_key_pair_v1(&[0x72; 32]).expect("Client recipient");
    let recipients = LocalEd25519YaoActivationRecipientsV1 {
        client_public_key: client.public_key,
        signing_worker_public_key: signing_worker.public_key,
    };
    let mut rng = SealingRng(0x5eed);

    let registration_session = [0x81; 32];
    let registration = seal_activation(
        &mut rng,
        activation_binding(
            Ed25519YaoOperationV1::Registration,
            ExpensiveWorkKindV1::RegistrationPrepare,
            registration_session,
            "registration-activation",
        ),
        recipients,
    );
    let (registered, _) = combine_ed25519_yao_signing_worker_packages_v1(
        &signing_worker.private_key,
        registration.deriver_a,
        registration.deriver_b,
        None,
    )
    .expect("registration activation")
    .into_parts();
    assert_eq!(registered.registered_public_key(), expected_public_key);
    assert_eq!(registered.state_epoch().get(), 1);
    assert_eq!(
        group_public_key(&registration.client_scalar, registered.scalar()),
        expected_public_key
    );

    let recovery_session = [0x82; 32];
    let recovery = seal_activation(
        &mut rng,
        activation_binding(
            Ed25519YaoOperationV1::Recovery,
            ExpensiveWorkKindV1::Recovery,
            recovery_session,
            "recovery-activation",
        ),
        recipients,
    );
    let replayed_recovery = (recovery.deriver_a.clone(), recovery.deriver_b.clone());
    let (recovered, _) = combine_ed25519_yao_signing_worker_packages_v1(
        &signing_worker.private_key,
        recovery.deriver_a,
        recovery.deriver_b,
        Some(&registered),
    )
    .expect("recovery activation")
    .into_parts();
    assert_eq!(
        recovered.binding().operation,
        Ed25519YaoOperationV1::Recovery
    );
    assert_eq!(recovered.registered_public_key(), expected_public_key);
    assert_eq!(recovered.state_epoch().get(), 2);
    assert_eq!(
        group_public_key(&recovery.client_scalar, recovered.scalar()),
        expected_public_key
    );

    let target_binding = activation_binding(
        Ed25519YaoOperationV1::Registration,
        ExpensiveWorkKindV1::RegistrationPrepare,
        [0x83; 32],
        "linked-target-activation",
    );
    let target = seal_activation(&mut rng, target_binding.clone(), recipients);

    // Today the combiner refuses the recovered source on its operation alone.
    assert_eq!(
        source_preserving_refusal(
            &signing_worker.private_key,
            target.deriver_a.clone(),
            target.deriver_b.clone(),
            &recovered,
        ),
        "source-preserving ordinary activation requires registered source material"
    );

    // The same recovered material under a registration label: scalar, epoch,
    // transcript, public key, session and activation stay the recovered ones.
    let relabeled_source = Ed25519YaoActiveSigningMaterialV1::from_parts(
        *recovered.scalar(),
        activation_binding(
            Ed25519YaoOperationV1::Registration,
            ExpensiveWorkKindV1::RegistrationPrepare,
            recovery_session,
            "recovery-activation",
        ),
        recovered.state_epoch(),
        recovered.transcript(),
        recovered.registered_public_key(),
    )
    .expect("relabeled recovered source");
    let (linked, linked_receipt) =
        combine_ed25519_yao_signing_worker_packages_source_preserving_v1(
            &signing_worker.private_key,
            target.deriver_a.clone(),
            target.deriver_b.clone(),
            &relabeled_source,
        )
        .expect("linked target from the recovered source")
        .into_parts();
    assert_eq!(linked.binding(), &target_binding);
    assert_eq!(linked.registered_public_key(), expected_public_key);
    assert_eq!(linked_receipt.registered_public_key, expected_public_key);
    assert_eq!(linked.state_epoch().get(), 3);
    assert_eq!(linked_receipt.state_epoch.get(), 3);
    assert_eq!(
        group_public_key(&target.client_scalar, linked.scalar()),
        expected_public_key
    );

    // Replayed recovery packages are not a registration target.
    assert_eq!(
        source_preserving_refusal(
            &signing_worker.private_key,
            replayed_recovery.0,
            replayed_recovery.1,
            &relabeled_source,
        ),
        "source-preserving ordinary activation requires a registration binding"
    );

    // A target that names the source activation is not fresh material.
    let mut reused_a = target.deriver_a.clone();
    let mut reused_b = target.deriver_b.clone();
    reused_a.binding.material_activation = relabeled_source.binding().material_activation.clone();
    reused_b.binding.material_activation = relabeled_source.binding().material_activation.clone();
    assert_eq!(
        source_preserving_refusal(
            &signing_worker.private_key,
            reused_a,
            reused_b,
            &relabeled_source,
        ),
        "source-preserving ordinary activation requires a fresh material activation"
    );

    // A target under another root share epoch changes the signing identity.
    let mut moved_a = target.deriver_a.clone();
    let mut moved_b = target.deriver_b.clone();
    let other_epoch = RootShareEpoch::new("epoch-2").expect("other root epoch");
    moved_a.binding.lifecycle.root_share_epoch = other_epoch.clone();
    moved_b.binding.lifecycle.root_share_epoch = other_epoch;
    assert_eq!(
        source_preserving_refusal(
            &signing_worker.private_key,
            moved_a,
            moved_b,
            &relabeled_source,
        ),
        "source-preserving ordinary activation changed the stable signing identity"
    );

    // Deriver packages from two target ceremonies do not form one pair.
    let other_target = seal_activation(
        &mut rng,
        activation_binding(
            Ed25519YaoOperationV1::Registration,
            ExpensiveWorkKindV1::RegistrationPrepare,
            [0x84; 32],
            "linked-target-activation",
        ),
        recipients,
    );
    assert_eq!(
        source_preserving_refusal(
            &signing_worker.private_key,
            target.deriver_a.clone(),
            other_target.deriver_b,
            &relabeled_source,
        ),
        "Signing Worker activation package bindings do not match"
    );

    // Packages sealed to this Signing Worker do not open under another key.
    let other_signing_worker =
        derive_ed25519_yao_recipient_key_pair_v1(&[0x73; 32]).expect("other recipient");
    assert!(
        combine_ed25519_yao_signing_worker_packages_source_preserving_v1(
            &other_signing_worker.private_key,
            target.deriver_a,
            target.deriver_b,
            &relabeled_source,
        )
        .is_err()
    );
}

fn preservation_rng(seed: u8) -> ChaCha20Rng {
    ChaCha20Rng::from_seed([seed; 32])
}

fn refresh_preservation_share(
    current: &SigningRootShare,
    recipient: TwoPartyDeriverRole,
    coefficient_a: &RootShareRefreshCoefficient,
    coefficient_b: &RootShareRefreshCoefficient,
) -> SigningRootShare {
    let contribution_a = coefficient_a
        .commitment()
        .verify_contribution(coefficient_a.contribution_for(recipient))
        .expect("Deriver A refresh contribution verifies");
    let contribution_b = coefficient_b
        .commitment()
        .verify_contribution(coefficient_b.contribution_for(recipient))
        .expect("Deriver B refresh contribution verifies");
    apply_two_party_root_share_refresh(current, contribution_a, contribution_b)
        .expect("tenant root share refresh succeeds")
}

fn evaluate_ecdsa_preservation_output(
    shares: &[SigningRootShare],
    stable_context: &StableTenantDerivationContextV2,
    purpose: PrfPurpose,
    proof_seed: u8,
) -> [u8; 32] {
    let context = PrfContext::new(
        SuiteId::Ristretto255Sha512,
        purpose,
        stable_context.canonical_context_bytes(),
    );
    let policy = ThresholdPolicy::from_u16s(2, 2).expect("fixed 2-of-2 policy");
    let mut proof_rng = preservation_rng(proof_seed);
    let bundles = ValidatedThresholdSet::from_proof_bundles(
        policy,
        shares
            .iter()
            .map(|share| {
                evaluate_partial_with_dleq_proof(share, &context, &mut proof_rng)
                    .expect("ECDSA partial proof evaluates")
            })
            .collect(),
    )
    .expect("ECDSA proof set validates");
    combine_verified_partials(&bundles, &context)
        .expect("ECDSA partials combine")
        .into_bytes()
}

fn ecdsa_preservation_identity(
    shares: &[SigningRootShare],
    stable_context: &StableTenantDerivationContextV2,
    proof_seed: u8,
) -> (Vec<u8>, Vec<u8>) {
    let client_base = evaluate_ecdsa_preservation_output(
        shares,
        stable_context,
        PrfPurpose::RouterAbXClientBaseV1,
        proof_seed,
    );
    let server_base = evaluate_ecdsa_preservation_output(
        shares,
        stable_context,
        PrfPurpose::RouterAbXServerBaseV1,
        proof_seed.wrapping_add(1),
    );
    let client_public_key =
        secp256k1_private_key_32_to_public_key_33(&client_base).expect("ECDSA client public key");
    let server_public_key =
        secp256k1_private_key_32_to_public_key_33(&server_base).expect("ECDSA server public key");
    let threshold_public_key = add_secp256k1_public_keys_33(&client_public_key, &server_public_key)
        .expect("ECDSA threshold public key");
    let address = secp256k1_public_key_33_to_ethereum_address_20(&threshold_public_key)
        .expect("ECDSA Ethereum address");
    (threshold_public_key, address)
}

fn ed25519_preservation_roots(
    shares: &[SigningRootShare],
    stable_context_bytes: &[u8],
    proof_seed: u8,
) -> ([u8; 32], [u8; 32]) {
    let deriver_a_commitment = SigningRootShareCommitment::from_share(&shares[0]);
    let deriver_b_commitment = SigningRootShareCommitment::from_share(&shares[1]);
    let mut proof_rng = preservation_rng(proof_seed);
    let (prepared_a, proof_a_to_b) = prepare_ed25519_deriver_a_target_v1(
        &shares[0],
        deriver_b_commitment,
        stable_context_bytes,
        &mut proof_rng,
    )
    .expect("Ed25519 Deriver A target prepares");
    let (prepared_b, proof_b_to_a) = prepare_ed25519_deriver_b_target_v1(
        &shares[1],
        deriver_a_commitment,
        stable_context_bytes,
        &mut proof_rng,
    )
    .expect("Ed25519 Deriver B target prepares");
    let root_a = complete_ed25519_deriver_a_target_v1(prepared_a, &proof_b_to_a)
        .expect("Ed25519 Deriver A target completes")
        .into_secret_bytes();
    let root_b = complete_ed25519_deriver_b_target_v1(prepared_b, &proof_a_to_b)
        .expect("Ed25519 Deriver B target completes")
        .into_secret_bytes();
    (*root_a, *root_b)
}

fn ed25519_preservation_public_key(
    context: &Ed25519YaoStableKeyDerivationContextV1,
    client_a: Ed25519YaoDeriverAClientContributionV1,
    client_b: Ed25519YaoDeriverBClientContributionV1,
    root_a: [u8; 32],
    root_b: [u8; 32],
) -> [u8; 32] {
    let server_a = derive_ed25519_yao_deriver_a_server_contribution_v1(
        &Ed25519YaoDeriverADerivationRootV1::from_secret_bytes(root_a),
        context,
    )
    .expect("Ed25519 Deriver A server KDF");
    let server_b = derive_ed25519_yao_deriver_b_server_contribution_v1(
        &Ed25519YaoDeriverBDerivationRootV1::from_secret_bytes(root_b),
        context,
    )
    .expect("Ed25519 Deriver B server KDF");
    let activation_session = [0x51; 32];
    let activation_binding = binding(
        Ed25519YaoOperationV1::Registration,
        ExpensiveWorkKindV1::RegistrationPrepare,
        activation_session,
    );
    let activation_a = build_activation_deriver_a(
        &activation_binding,
        ActivationDeriverAContribution::base(context, client_a, server_a),
    )
    .expect("Ed25519 activation A");
    let activation_b = build_activation_deriver_b(
        &activation_binding,
        ActivationDeriverBContribution::base(context, client_b, server_b),
    )
    .expect("Ed25519 activation B");
    let (activation_a, activation_b) = run_roles(
        activation_session,
        activation_a,
        activation_b,
        ActivationDeriverA::handle,
        ActivationDeriverB::handle,
        ActivationDeriverA::instruction,
        ActivationDeriverB::instruction,
    );
    let commitments = ActivationPublicCommitments::new(
        activation_a.client_commitment(),
        activation_b.client_commitment(),
        activation_a.signing_worker_commitment(),
        activation_b.signing_worker_commitment(),
    );
    *derive_registration_receipt(commitments)
        .expect("Ed25519 registration receipt")
        .registered_public_key()
}

#[test]
fn tenant_root_resharing_preserves_ecdsa_and_ed25519_public_keys() {
    let initial = vec![
        generate_two_party_root_share(TwoPartyDeriverRole::DeriverA, &mut preservation_rng(1)),
        generate_two_party_root_share(TwoPartyDeriverRole::DeriverB, &mut preservation_rng(2)),
    ];
    let coefficient_a = RootShareRefreshCoefficient::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverA,
        Scalar::from(17_u64).to_bytes(),
    )
    .expect("Deriver A refresh coefficient");
    let coefficient_b = RootShareRefreshCoefficient::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverB,
        Scalar::from(29_u64).to_bytes(),
    )
    .expect("Deriver B refresh coefficient");
    let refreshed = vec![
        refresh_preservation_share(
            &initial[0],
            TwoPartyDeriverRole::DeriverA,
            &coefficient_a,
            &coefficient_b,
        ),
        refresh_preservation_share(
            &initial[1],
            TwoPartyDeriverRole::DeriverB,
            &coefficient_a,
            &coefficient_b,
        ),
    ];
    assert_ne!(initial[0].to_bytes(), refreshed[0].to_bytes());
    assert_ne!(initial[1].to_bytes(), refreshed[1].to_bytes());

    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let before_ecdsa = ecdsa_preservation_identity(&initial, &stable_context, 10);
    let after_ecdsa = ecdsa_preservation_identity(&refreshed, &stable_context, 20);
    assert_eq!(before_ecdsa, after_ecdsa);

    let (context_before, client_a_before, client_b_before, _, _) = derive_vector_contributions();
    let (context_after, client_a_after, client_b_after, _, _) = derive_vector_contributions();
    let context_bytes = context_before.encode();
    let (root_a_before, root_b_before) = ed25519_preservation_roots(&initial, &context_bytes, 30);
    let (root_a_after, root_b_after) =
        ed25519_preservation_roots(&refreshed, &context_after.encode(), 40);
    assert_eq!(root_a_before, root_a_after);
    assert_eq!(root_b_before, root_b_after);
    let before_ed25519 = ed25519_preservation_public_key(
        &context_before,
        client_a_before,
        client_b_before,
        root_a_before,
        root_b_before,
    );
    let after_ed25519 = ed25519_preservation_public_key(
        &context_after,
        client_a_after,
        client_b_after,
        root_a_after,
        root_b_after,
    );
    assert_eq!(before_ed25519, after_ed25519);
}
