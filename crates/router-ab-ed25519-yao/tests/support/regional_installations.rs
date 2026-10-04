use super::*;
use router_ab_ecdsa_derivation::{
    derive_client_share, derive_relayer_share_for_client_public,
    RouterAbEcdsaDerivationStableKeyContext,
};
use router_ab_ecdsa_online::{
    compute_client_signature_share, finalize_signing_worker_signature, ClientPresignMaterial,
    OnlineClientInput, SigningWorkerOnlineInput, SigningWorkerPresignMaterial,
};
use router_ab_ecdsa_presign::{
    session::{
        derive_presign_pair_context, ClientPresignSession, PresignSessionStage,
        SigningWorkerPresignSession,
    },
    AdditiveKeyShare,
};
use router_ab_ecdsa_wire::{CompressedPointBytes, ScalarBytes};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fmt::Write, path::PathBuf, process::Command};

struct RegionalEd25519Material {
    binding: Ed25519YaoCeremonyBindingV1,
    public_key: [u8; 32],
    client_share: Zeroizing<[u8; 32]>,
    worker_share: Zeroizing<[u8; 32]>,
}

fn hex_bytes(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("encode bytes");
    }
    encoded
}

fn install_ed25519(region: &str, session_byte: u8) -> RegionalEd25519Material {
    let (context, client_a, client_b, server_a, server_b) = derive_vector_contributions();
    let worker_id = format!("signing-worker-{region}");
    let lifecycle_id = format!("regional-installation-{region}");
    let activation = MpcMaterialActivationRefV1::new(
        format!("regional-material-{region}"),
        "near-ed25519-mpc-signing",
        "wallet-fixture",
        "ed25519ks_fixture",
        &lifecycle_id,
        &worker_id,
    )
    .expect("activation");
    let lifecycle = LifecycleScopeV1::new(
        lifecycle_id,
        ExpensiveWorkKindV1::RegistrationPrepare,
        RootShareEpoch::new("epoch-1").expect("epoch"),
        "wallet-fixture",
        "same-owner-wallet-session",
        "signer-set-1",
        worker_id,
    )
    .expect("lifecycle");
    let binding = Ed25519YaoCeremonyBindingV1::new(
        lifecycle,
        Ed25519YaoOperationV1::Registration,
        Ed25519YaoSessionIdV1::new([session_byte; 32]).expect("session"),
        Ed25519YaoStableKeyContextBindingV1::new(context.binding_digest()),
        activation,
    )
    .expect("binding");
    let a = build_activation_deriver_a(
        &binding,
        ActivationDeriverAContribution::base(&context, client_a, server_a),
    )
    .expect("A activation");
    let b = build_activation_deriver_b(
        &binding,
        ActivationDeriverBContribution::base(&context, client_b, server_b),
    )
    .expect("B activation");
    let (a, b) = run_roles(
        binding.session_id.into_bytes(),
        a,
        b,
        ActivationDeriverA::handle,
        ActivationDeriverB::handle,
        ActivationDeriverA::instruction,
        ActivationDeriverB::instruction,
    );
    assert_eq!(a.final_transcript(), b.final_transcript());
    let receipt = derive_registration_receipt(ActivationPublicCommitments::new(
        a.client_commitment(),
        b.client_commitment(),
        a.signing_worker_commitment(),
        b.signing_worker_commitment(),
    ))
    .expect("activation receipt");
    let client_share = Zeroizing::new(
        combine_client_activation_packages(
            binding.session_id.into_bytes(),
            a.final_transcript(),
            a.client_package(),
            b.client_package(),
        )
        .expect("client material")
        .into_bytes(),
    );
    let worker_share = Zeroizing::new(
        combine_signing_worker_activation_packages(
            binding.session_id.into_bytes(),
            a.final_transcript(),
            a.signing_worker_package(),
            b.signing_worker_package(),
        )
        .expect("worker material")
        .into_bytes(),
    );
    RegionalEd25519Material {
        binding,
        public_key: *receipt.registered_public_key(),
        client_share,
        worker_share,
    }
}

fn sign_ed25519(
    material: &RegionalEd25519Material,
    original_client_share: &[u8; 32],
    message: &[u8],
) -> [u8; 64] {
    let client_id = frost_ed25519::Identifier::try_from(1_u16).expect("client ID");
    let worker_id = frost_ed25519::Identifier::try_from(2_u16).expect("worker ID");
    let mut client = key_package_from_signing_share_bytes(
        original_client_share,
        &material.public_key,
        client_id,
    )
    .expect("original client package");
    let mut worker = key_package_from_signing_share_bytes(
        &material.worker_share,
        &material.public_key,
        worker_id,
    )
    .expect("regional worker package");
    let mut client_round = client_round1_commit(&client).expect("client commitments");
    let mut worker_round = client_round1_commit(&worker).expect("worker commitments");
    let package = build_signing_package(
        message,
        BTreeMap::from([
            (client_id, client_round.commitments),
            (worker_id, worker_round.commitments),
        ]),
    );
    let client_signature = client_round2_signature_share(&package, &client_round.nonces, &client)
        .expect("client signature share");
    let worker_signature = client_round2_signature_share(&package, &worker_round.nonces, &worker)
        .expect("worker signature share");
    client_round.nonces.zeroize();
    worker_round.nonces.zeroize();
    let signature = aggregate_signature(
        &package,
        *client.verifying_key(),
        BTreeMap::from([
            (client_id, *client.verifying_share()),
            (worker_id, *worker.verifying_share()),
        ]),
        BTreeMap::from([(client_id, client_signature), (worker_id, worker_signature)]),
    )
    .expect("aggregate signature");
    VerifyingKey::from_bytes(&material.public_key)
        .expect("public key")
        .verify(message, &Signature::from_bytes(&signature))
        .expect("standard signature verification");
    client.zeroize();
    worker.zeroize();
    signature
}

fn presign_ecdsa(
    region: &str,
    client_share: [u8; 32],
    worker_share: [u8; 32],
    public_key: [u8; 33],
) -> (Zeroizing<Vec<u8>>, Zeroizing<Vec<u8>>) {
    let key = CompressedPointBytes::new(public_key);
    let context = derive_presign_pair_context(key, &format!("regional-presign-{region}"))
        .expect("presign context");
    let foreign = derive_presign_pair_context(key, &format!("foreign-presign-{region}"))
        .expect("foreign context");
    let mut rng = rand_core::OsRng;
    let mut client = ClientPresignSession::new(context, key_share(client_share), key, &mut rng)
        .expect("client session");
    let mut worker =
        SigningWorkerPresignSession::new(context, key_share(worker_share), key, &mut rng)
            .expect("regional worker session");
    let mut other_worker =
        SigningWorkerPresignSession::new(foreign, key_share(worker_share), key, &mut rng)
            .expect("other session");
    let mut client_pending = client.poll().outgoing;
    assert!(other_worker.message(&client_pending[0], &mut rng).is_err());
    let mut worker_pending = worker.poll().outgoing;
    for _ in 0..32 {
        for message in worker_pending.drain(..) {
            client
                .message(&message, &mut rng)
                .expect("client accepts frame");
            if client.stage() == PresignSessionStage::TriplesDone {
                client.start_presign().expect("client starts presign");
            }
        }
        client_pending.extend(client.poll().outgoing);
        for message in client_pending.drain(..) {
            worker
                .message(&message, &mut rng)
                .expect("worker accepts frame");
            if worker.stage() == PresignSessionStage::TriplesDone {
                worker.start_presign().expect("worker starts presign");
            }
        }
        worker_pending.extend(worker.poll().outgoing);
        if client.stage() == PresignSessionStage::Done
            && worker.stage() == PresignSessionStage::Done
        {
            break;
        }
    }
    let client_output = Zeroizing::new(client.take_presignature_97().expect("client output"));
    let worker_output = Zeroizing::new(worker.take_presignature_97().expect("worker output"));
    assert!(client.take_presignature_97().is_err());
    assert!(worker.take_presignature_97().is_err());
    assert_eq!(client_output[..33], worker_output[..33]);
    (client_output, worker_output)
}

fn key_share(bytes: [u8; 32]) -> AdditiveKeyShare {
    AdditiveKeyShare::from_bytes(ScalarBytes::new(bytes)).expect("additive share")
}

fn sign_ecdsa(client: &[u8], worker: &[u8], public_key: [u8; 33], digest: [u8; 32]) -> [u8; 65] {
    let big_r = client[..33].try_into().expect("R point");
    let mut entropy = [0_u8; 32];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut entropy);
    let client = ClientPresignMaterial::from_bytes(
        big_r,
        client[33..65].try_into().expect("client nonce share"),
        client[65..97].try_into().expect("client product share"),
    )
    .expect("client presignature")
    .reserve()
    .commit(OnlineClientInput::new(public_key, big_r, digest, entropy).expect("client input"))
    .expect("client commitment");
    let worker = SigningWorkerPresignMaterial::from_bytes(
        worker[..33].try_into().expect("worker R point"),
        worker[33..65].try_into().expect("worker nonce share"),
        worker[65..97].try_into().expect("worker product share"),
    )
    .expect("worker presignature")
    .reserve()
    .commit(
        SigningWorkerOnlineInput::new(public_key, big_r, digest, entropy).expect("worker input"),
    )
    .expect("worker commitment");
    finalize_signing_worker_signature(
        worker,
        compute_client_signature_share(client).expect("ECDSA client signature share"),
    )
    .expect("ECDSA signature and recovered public key verification")
}

#[test]
fn independent_regional_sessions_preserve_keys_and_client_shares() {
    let regions = ["weur", "apac", "us"];
    let context = RouterAbEcdsaDerivationStableKeyContext::new([0x42; 32]);
    let client = derive_client_share(&context, [0x11; 32]).expect("client share");
    let (_, identity) = derive_relayer_share_for_client_public(
        &context,
        [0x22; 32],
        &client.derivation_client_share_public_key33,
        client.retry_counter,
    )
    .expect("worker share");
    let mut installations = Vec::new();
    let mut ed25519_public_keys = BTreeSet::new();
    let mut ecdsa_nonce_points = BTreeSet::new();
    let mut material_ids = BTreeSet::new();
    let mut regional_ed25519_material = Vec::new();
    for (index, region) in regions.iter().enumerate() {
        regional_ed25519_material.push(install_ed25519(region, 0x81 + index as u8));
    }
    let original_client = &regional_ed25519_material[0].client_share;
    for (region, ed25519) in regions.iter().zip(&regional_ed25519_material) {
        assert_eq!(original_client.as_ref(), ed25519.client_share.as_ref());
        let message = format!("regional signing feasibility: {region}");
        let signature = sign_ed25519(ed25519, original_client, message.as_bytes());
        let (regional_worker, regional_identity) = derive_relayer_share_for_client_public(
            &context,
            [0x22; 32],
            &client.derivation_client_share_public_key33,
            client.retry_counter,
        )
        .expect("regional worker material");
        assert_eq!(regional_identity, identity);
        let (client_presign, worker_presign) = presign_ecdsa(
            region,
            client.x_client32,
            regional_worker.x_relayer32,
            identity.threshold_public_key33,
        );
        let digest: [u8; 32] = Sha256::digest(message.as_bytes()).into();
        let ecdsa_signature = sign_ecdsa(
            &client_presign,
            &worker_presign,
            identity.threshold_public_key33,
            digest,
        );
        ed25519_public_keys.insert(ed25519.public_key);
        assert!(ecdsa_nonce_points.insert(hex_bytes(&client_presign[..33])));
        assert!(material_ids.insert(ed25519.binding.material_activation.activation_id.clone()));
        installations.push(json!({
            "region_label": region,
            "ed25519_activation": ed25519.binding.material_activation,
            "ed25519_public_key_hex": hex_bytes(&ed25519.public_key),
            "ed25519_signature_hex": hex_bytes(&signature),
            "message_utf8": message,
            "ecdsa_public_key_hex": hex_bytes(&identity.threshold_public_key33),
            "ecdsa_address_hex": hex_bytes(&identity.threshold_ethereum_address20),
            "ecdsa_digest_hex": hex_bytes(&digest),
            "ecdsa_signature_hex": hex_bytes(&ecdsa_signature),
            "ecdsa_presign_nonce_point_hex": hex_bytes(&client_presign[..33]),
        }));
    }
    assert_eq!(ed25519_public_keys.len(), 1);
    assert_eq!(ecdsa_nonce_points.len(), regions.len());
    let return_message = b"return to WEUR without replacing its activation";
    let return_signature = sign_ed25519(
        &regional_ed25519_material[0],
        original_client,
        return_message,
    );
    let revision = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("source revision");
    assert!(revision.status.success());
    let artifact_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.artifacts/r155/protocol-feasibility");
    std::fs::create_dir_all(&artifact_dir).expect("artifact directory");
    let evidence = json!({
        "schema": "regional-signing-protocol-feasibility-v1",
        "source_revision": String::from_utf8(revision.stdout).expect("revision UTF-8").trim(),
        "runner_sha256": hex_bytes(&Sha256::digest(include_bytes!("regional_installations.rs"))),
        "scope": "Real Yao activation/FROST and ECDSA presign/online protocols in one process, using separate regional sessions and fixed test roots. No deployed storage, authenticated device enrollment, permission service, linked-device installation, recovery, or latency claim.",
        "original_client_shares_reused": true,
        "ecdsa_foreign_session_frames_rejected": true,
        "ecdsa_presign_outputs_taken_once": true,
        "ed25519_original_installation_still_signs": {
            "message_utf8": String::from_utf8_lossy(return_message),
            "signature_hex": hex_bytes(&return_signature),
        },
        "installations": installations,
    });
    std::fs::write(
        artifact_dir.join("evidence.json"),
        serde_json::to_vec_pretty(&evidence).expect("evidence JSON"),
    )
    .expect("write evidence");
}
