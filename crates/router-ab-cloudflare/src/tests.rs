use super::*;
use hpke_ng::Kem;
use rand_core::{CryptoRng, RngCore};
use router_ab_core::{
    decode_recipient_proof_bundle_payload_v1,
    verify_recipient_proof_bundle_ciphertext_payload_v1, EcdsaThresholdPrfProofBatchPayloadV1,
    MpcPrfDleqProofWireV1, MpcPrfPartialBindingV1, MpcPrfPartialProofBundleV1,
    MpcPrfPartialWireV1, MpcPrfShareCommitmentWireV1, MpcPrfSignerPartialV1,
    MpcPrfStableProofBundleWireV2, MpcPrfStableRecipientProofBundlePayloadV2, OpenedShareKind,
    RecipientProofBundleEncryptionRequestV1, RecipientProofBundlePayloadV1, RootShareEpoch,
    SecretMaterial32, SignerIdentityV1, TenantRootProtocolDigestV1,
    MPC_PRF_COMMITMENT_WIRE_V1_LEN, MPC_PRF_DLEQ_PROOF_WIRE_V1_LEN,
    MPC_PRF_PARTIAL_WIRE_V1_LEN,
};
use threshold_prf::PrfPurpose;

#[cfg(feature = "workers-rs")]
#[test]
fn boundary_timing_retains_nested_presign_durable_object_duration() {
    let mut timing = CloudflareEcdsaBoundaryTimingV1::new();

    timing.merge_role(
        "ecdsa_presign_sw",
        Some("do_total;dur=42, descriptive;desc=ignored".to_owned()),
    );

    assert_eq!(timing.server_timing(), "ecdsa_presign_sw_do_total;dur=42");
}

#[test]
fn cloudflare_hpke_recipient_output_encryptor_round_trips() {
    let (recipient_private_key, recipient_public_key) =
        CloudflareHpkeKemV1::derive_key_pair(&[0x42; 32]).expect("recipient keypair derives");
    let recipient_public_key = format!(
        "x25519:{}",
        lower_hex(&CloudflareHpkeKemV1::pk_to_bytes(&recipient_public_key))
    );
    let plaintext = SecretMaterial32::new([0x5a; 32]);
    let request = RecipientOutputEncryptionRequestV1::new(
        Role::Client,
        OpenedShareKind::XClientBase,
        "client",
        recipient_public_key,
        digest(0x11),
        digest(0x22),
        &plaintext,
    )
    .expect("recipient output encryption request");
    let mut encryptor = CloudflareHpkeRecipientOutputEncryptorV1::new();
    let envelope = encryptor
        .encrypt_recipient_output_v1(request)
        .expect("hpke recipient output encrypts");

    assert_eq!(
        envelope.algorithm,
        RecipientOutputEncryptionAlgorithmV1::HpkeX25519HkdfSha256Aes256GcmV1
    );
    assert_eq!(
        envelope.nonce(),
        &CLOUDFLARE_HPKE_RECIPIENT_OUTPUT_ENVELOPE_NONCE_V1
    );
    let aad = encode_recipient_output_ciphertext_aad_v1(&envelope).expect("hpke aad");
    let ciphertext_and_tag = envelope.ciphertext_and_tag().as_bytes();
    let (encapped_key, ciphertext) =
        ciphertext_and_tag.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
    let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).expect("encapped key");
    let decrypted = CloudflareHpkeSuiteV1::open_base(
        &encapped_key,
        &recipient_private_key,
        CLOUDFLARE_HPKE_RECIPIENT_OUTPUT_INFO_V1,
        &aad,
        ciphertext,
    )
    .expect("hpke recipient output opens");

    assert_eq!(decrypted, plaintext.as_bytes());
}

#[test]
fn cloudflare_hpke_recipient_proof_bundle_encryptor_round_trips() {
    let (recipient_private_key, recipient_public_key) =
        CloudflareHpkeKemV1::derive_key_pair(&[0x44; 32]).expect("recipient keypair derives");
    let recipient_public_key = format!(
        "x25519:{}",
        lower_hex(&CloudflareHpkeKemV1::pk_to_bytes(&recipient_public_key))
    );
    let payload = sample_recipient_proof_bundle_payload();
    let request = RecipientProofBundleEncryptionRequestV1::new(&payload, recipient_public_key)
        .expect("recipient proof-bundle encryption request");
    let mut encryptor = CloudflareHpkeRecipientProofBundleEncryptorV1::new();
    let envelope = encryptor
        .encrypt_recipient_proof_bundle_v1(request)
        .expect("hpke recipient proof bundle encrypts");

    assert_eq!(
        envelope.algorithm,
        RecipientOutputEncryptionAlgorithmV1::HpkeX25519HkdfSha256Aes256GcmV1
    );
    assert_eq!(
        envelope.nonce(),
        &CLOUDFLARE_HPKE_RECIPIENT_OUTPUT_ENVELOPE_NONCE_V1
    );
    assert_eq!(envelope.recipient_role, Role::Client);
    assert_eq!(envelope.opened_share_kind, OpenedShareKind::XClientBase);
    assert_eq!(envelope.recipient_identity, "client");
    assert_eq!(envelope.payload_digest, payload.digest());

    let aad =
        encode_recipient_proof_bundle_ciphertext_aad_v1(&envelope).expect("proof bundle aad");
    let ciphertext_and_tag = envelope.ciphertext_and_tag().as_bytes();
    let (encapped_key, ciphertext) =
        ciphertext_and_tag.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
    let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).expect("encapped key");
    let decrypted = CloudflareHpkeSuiteV1::open_base(
        &encapped_key,
        &recipient_private_key,
        CLOUDFLARE_HPKE_RECIPIENT_PROOF_BUNDLE_INFO_V1,
        &aad,
        ciphertext,
    )
    .expect("hpke recipient proof bundle opens");
    let decoded = decode_recipient_proof_bundle_payload_v1(&decrypted)
        .expect("proof-bundle payload decodes after HPKE open");

    assert_eq!(decoded, payload);
    verify_recipient_proof_bundle_ciphertext_payload_v1(&envelope, &decoded)
        .expect("proof-bundle envelope matches decrypted payload");
    let recipient_private_key_bytes = CloudflareHpkeKemV1::sk_to_bytes(&recipient_private_key);
    let opened = open_cloudflare_recipient_proof_bundle_hpke_payload_v1(
        &envelope,
        &recipient_private_key_bytes,
    )
    .expect("proof bundle opens through Cloudflare helper");
    assert_eq!(opened, payload);
}

#[test]
fn cloudflare_hpke_stable_recipient_proof_bundle_round_trips() {
    let (recipient_private_key, recipient_public_key) =
        CloudflareHpkeKemV1::derive_key_pair(&[0x45; 32]).expect("recipient keypair derives");
    let recipient_public_key = format!(
        "x25519:{}",
        lower_hex(&CloudflareHpkeKemV1::pk_to_bytes(&recipient_public_key))
    );
    let payload = MpcPrfStableRecipientProofBundlePayloadV2::new(
        signer(Role::SignerA, "signer-a"),
        Role::Client,
        "client",
        MpcPrfStableProofBundleWireV2::new(
            TenantRootProtocolDigestV1::from_bytes([0x31; 32]).expect("stable context digest"),
            TenantRootProtocolDigestV1::from_bytes([0x32; 32]).expect("custody binding digest"),
            PrfPurpose::RouterAbXClientBaseV1,
            Role::SignerA,
            MpcPrfPartialWireV1::new(fixed_share_wire_bytes(
                Role::SignerA,
                0x33,
                MPC_PRF_PARTIAL_WIRE_V1_LEN,
            ))
            .expect("partial wire"),
            MpcPrfShareCommitmentWireV1::new(fixed_share_wire_bytes(
                Role::SignerA,
                0x34,
                MPC_PRF_COMMITMENT_WIRE_V1_LEN,
            ))
            .expect("commitment wire"),
            MpcPrfDleqProofWireV1::new(vec![0x35; MPC_PRF_DLEQ_PROOF_WIRE_V1_LEN])
                .expect("proof wire"),
        )
        .expect("stable proof bundle"),
    )
    .expect("stable recipient payload");
    let outer_transcript_digest = digest(0x36);
    let request = RecipientProofBundleEncryptionRequestV1::new_stable_v2(
        &payload,
        recipient_public_key,
        outer_transcript_digest,
    )
    .expect("stable encryption request");
    let envelope = CloudflareHpkeRecipientProofBundleEncryptorV1::new()
        .encrypt_recipient_proof_bundle_v1(request)
        .expect("stable proof bundle encrypts");
    let private_key_bytes = CloudflareHpkeKemV1::sk_to_bytes(&recipient_private_key);
    let opened = open_cloudflare_recipient_proof_bundle_hpke_payload_v2(
        &envelope,
        &private_key_bytes,
        outer_transcript_digest,
    )
    .expect("stable proof bundle opens");

    assert_eq!(opened, payload);
    assert!(open_cloudflare_recipient_proof_bundle_hpke_payload_v2(
        &envelope,
        &private_key_bytes,
        digest(0x37),
    )
    .is_err());
}

#[test]
fn cloudflare_hpke_recipient_proof_bundle_has_deterministic_seal_vector() {
    let (recipient_private_key, recipient_public_key) =
        CloudflareHpkeKemV1::derive_key_pair(&[0x44; 32]).expect("recipient keypair derives");
    let recipient_public_key_text = format!(
        "x25519:{}",
        lower_hex(&CloudflareHpkeKemV1::pk_to_bytes(&recipient_public_key))
    );
    let payload = sample_recipient_proof_bundle_payload();
    let request =
        RecipientProofBundleEncryptionRequestV1::new(&payload, recipient_public_key_text)
            .expect("recipient proof-bundle encryption request");
    let aad = cloudflare_hpke_recipient_proof_bundle_aad_v1(&request).expect("HPKE AAD");
    let mut rng = DeterministicHpkeTestRng::new(0xa5);
    let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
        &mut rng,
        &recipient_public_key,
        CLOUDFLARE_HPKE_RECIPIENT_PROOF_BUNDLE_INFO_V1,
        &aad,
        request.plaintext(),
    )
    .expect("deterministic HPKE seal");
    let mut ciphertext_and_tag =
        Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
    ciphertext_and_tag.extend_from_slice(encapped_key.as_ref());
    ciphertext_and_tag.extend_from_slice(&ciphertext);

    const EXPECTED_CIPHERTEXT_AND_TAG_HEX: &str = concat!(
        "1f2e708b104ceb54ac93c4e807ac5a9b1d3f98ccb4f246ada513b6797b76d33c",
        "5ffdda942753a730080168afee463ac3108e9a4d1832439dcf72738758df8d5c",
        "38d7b8d6bcbdd0a79d51c30b795de0d8c283edf361b32875ad18a5970d80175f",
        "4b90e236700389abcba20540ca0d6924d1c660353fd3e0dc4c68631f56fd14bc",
        "02a111b0106c967f261a5ad44a7a7955d1b23903484accd5bcbae95d7f32d81f",
        "c8697f1f1d6e91bd7a1d7ae758630708309304f70dc22aa16867560f0d9e95d4",
        "a0be1fffdc55037c8495f239a82ce4a070cbcfc709b5703f734622b1ed69ed14",
        "fc224de9de6249ee85247b35862adea0d6d91e765c76a3b70be8f764854a5dd2",
        "22ea885ef86dc7aac8a70eb429913222a57c37be10c148249bb630abed09c6c0",
        "a4196d23ce10f98d0fb9990633fa04241f074d800d671a8c85099637a0ec20a2",
        "25dcc961eff9519b18d8c27f3d89c45d06d11b1ba8da326dcd86762197414e1d",
        "35bc6c5ef0fdeef2b96823a31180b164e79360a9dd60e2e526094ccf4a25ea3a",
        "2beda19132251de82ab37afb0eed9f996c7877f180653085dd10e929fcd399eb",
        "f2f604a260e456fbd68ec510629e3935ea472215714ece038b9254d89c5f9ceb",
        "43117d9cfdb97be3ef50c27fd86f188cd2a5d6c7589536b989bb601572df6a47",
        "62cb0acab07966d0f16d426f3e525268143c7e2183efae6030352c905b94bd07",
        "3068930531b6f05f57375663137041267faf7bbaf9501812ca9ba3cad9a6f4f9",
        "9bad2ad7d8b59d8f7fedb1c8bd0a318fcd34798e12b7db182640e6cf420eca20",
        "5d6beaed924ee6606b714463e4725627cae7d96103c70a1fbe6df33c4e9d2325",
        "633052c652e19c9fc976a2a7aaef602265ab43f65a00a63e346962acdfb169a3",
        "bb271a812f5c2c3947bf08f91a5079daa1710ecc86eec5319e0632d7db37536c",
        "1165861fca386a977109050b6e5b45e3d63d014e30a8e87e1ebb2e67ac6a4814",
        "301ed9b1d0a53021c0311c77e2f71d5b5f7f04b2a2fd827d19ce80df21574607",
        "8e24f07ea871b5f783b4ca646fbc",
    );
    assert_eq!(
        lower_hex(&ciphertext_and_tag),
        EXPECTED_CIPHERTEXT_AND_TAG_HEX
    );

    let envelope = RecipientProofBundleCiphertextV1::new(
        RecipientOutputEncryptionAlgorithmV1::HpkeX25519HkdfSha256Aes256GcmV1,
        request.signer().clone(),
        request.recipient_role(),
        request.opened_share_kind(),
        request.recipient_identity(),
        request.recipient_encryption_key(),
        request.transcript_digest(),
        request.payload_digest(),
        CLOUDFLARE_HPKE_RECIPIENT_OUTPUT_ENVELOPE_NONCE_V1,
        EncryptedPayloadV1::new(ciphertext_and_tag).expect("deterministic ciphertext"),
    )
    .expect("deterministic HPKE envelope");
    let recipient_private_key_bytes = CloudflareHpkeKemV1::sk_to_bytes(&recipient_private_key);
    let opened = open_cloudflare_recipient_proof_bundle_hpke_payload_v1(
        &envelope,
        &recipient_private_key_bytes,
    )
    .expect("deterministic HPKE vector opens");

    assert_eq!(opened, payload);
}

#[test]
fn cloudflare_hpke_suite_opens_rfc9180_aes256_base_vector() {
    let info = decode_hex("4f6465206f6e2061204772656369616e2055726e");
    let ikm_r = decode_hex("dac33b0e9db1b59dbbea58d59a14e7b5896e9bdf98fad6891e99d1686492b9ee");
    let expected_pk_r =
        decode_hex("430f4b9859665145a6b1ba274024487bd66f03a2dd577d7753c68d7d7d00c00c");
    let enc = decode_hex("6c93e09869df3402d7bf231bf540fadd35cd56be14f97178f0954db94b7fc256");
    let aad = decode_hex("436f756e742d30");
    let ciphertext = decode_hex(
        "e5d84cd531cfb583096e7cfa9641bd3079cf3a91cda813c52deb5f512be9931980a41de125a925cdad859d5b7a",
    );
    let plaintext = decode_hex("4265617574792069732074727574682c20747275746820626561757479");

    let (recipient_private_key, recipient_public_key) =
        CloudflareHpkeKemV1::derive_key_pair(&ikm_r).expect("recipient keypair derives");
    assert_eq!(
        CloudflareHpkeKemV1::pk_to_bytes(&recipient_public_key),
        expected_pk_r
    );

    let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(&enc).expect("encapped key");
    let opened = CloudflareHpkeSuiteV1::open_base(
        &encapped_key,
        &recipient_private_key,
        &info,
        &aad,
        &ciphertext,
    )
    .expect("RFC 9180 AES-256-GCM base vector opens");
    assert_eq!(opened, plaintext);

    let err = CloudflareHpkeSuiteV1::open_base(
        &encapped_key,
        &recipient_private_key,
        &info,
        b"wrong-aad",
        &ciphertext,
    )
    .expect_err("modified AAD must fail");
    assert_eq!(err, hpke_ng::HpkeError::OpenError);
}

#[test]
fn cloudflare_hpke_recipient_output_rejects_uppercase_public_key() {
    let err = parse_cloudflare_hpke_x25519_public_key_v1(
        "x25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    )
    .expect_err("uppercase public key hex must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn cloudflare_hpke_recipient_output_rejects_noncanonical_public_key() {
    let (_, recipient_public_key) =
        CloudflareHpkeKemV1::derive_key_pair(&[0x43; 32]).expect("recipient keypair derives");
    let mut public_key_bytes = CloudflareHpkeKemV1::pk_to_bytes(&recipient_public_key);
    public_key_bytes[31] |= 0x80;
    let encoded = format!("x25519:{}", lower_hex(&public_key_bytes));
    let err = parse_cloudflare_hpke_x25519_public_key_v1(&encoded)
        .expect_err("noncanonical public key must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn ecdsa_export_private_authorization_matches_public_branch() {
    let evidence_set_digest =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x52; 32]);
    let public_step_up =
        NormalSigningAuthorizationV1::operation_step_up().expect("operation step-up marker");
    let private_step_up = CloudflareSigningWorkerEcdsaExportAuthorizationV1::OperationStepUp {
        evidence_set_digest: evidence_set_digest.clone(),
    };
    private_step_up
        .validate_for_public_authorization(&public_step_up)
        .expect("private evidence binds to operation step-up marker");
    assert_eq!(
        private_step_up.binding_authorization_kind(),
        "verified_step_up"
    );
    assert_eq!(private_step_up.authorization_id(), evidence_set_digest);

    let hostile_branch =
        CloudflareSigningWorkerEcdsaExportAuthorizationV1::ReusableWalletSession {
            wallet_session_id: "wallet-session-1".to_owned(),
        };
    let error = hostile_branch
        .validate_for_public_authorization(&public_step_up)
        .expect_err("reusable private authority must not substitute for step-up");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let malformed_digest = CloudflareSigningWorkerEcdsaExportAuthorizationV1::OperationStepUp {
        evidence_set_digest: "malformed".to_owned(),
    };
    let error = malformed_digest
        .validate_for_public_authorization(&public_step_up)
        .expect_err("private evidence digest must be a fixed digest");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

fn decode_hex(value: &str) -> Vec<u8> {
    assert_eq!(value.len() % 2, 0);
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|chunk| (decode_hex_nibble(chunk[0]) << 4) | decode_hex_nibble(chunk[1]))
        .collect()
}

fn decode_hex_nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        _ => panic!("test vector hex must be lowercase"),
    }
}

fn digest(seed: u8) -> PublicDigest32 {
    PublicDigest32::new([seed; 32])
}

fn sample_recipient_proof_bundle_payload() -> RecipientProofBundlePayloadV1 {
    let transcript_digest = digest(0x77);
    let root_share_epoch = RootShareEpoch::new("epoch-1").expect("root epoch");
    let proof_batch = EcdsaThresholdPrfProofBatchPayloadV1::new(
        signer(Role::SignerA, "signer-a"),
        signer(Role::SignerB, "signer-b"),
        transcript_digest,
        root_share_epoch.clone(),
        vec![sample_mpc_prf_proof_bundle(
            transcript_digest,
            root_share_epoch,
            OpenedShareKind::XClientBase,
            Role::Client,
            "client",
            Role::SignerA,
            "signer-a",
            0x77,
        )],
    )
    .expect("proof batch");
    RecipientProofBundlePayloadV1::new(
        "lifecycle-1",
        signer(Role::SignerA, "signer-a"),
        Role::Client,
        OpenedShareKind::XClientBase,
        "client",
        transcript_digest,
        proof_batch,
    )
    .expect("recipient proof-bundle payload")
}

fn signer(role: Role, signer_id: &str) -> SignerIdentityV1 {
    SignerIdentityV1::new(role, signer_id, "key-epoch-1").expect("signer identity")
}

fn fixed_share_wire_bytes(role: Role, fill: u8, len: usize) -> Vec<u8> {
    let share_id = match role {
        Role::SignerA => 1u16,
        Role::SignerB => 2u16,
        _ => panic!("fixed share wire requires a Deriver role"),
    };
    let mut bytes = vec![fill; len];
    bytes[..2].copy_from_slice(&share_id.to_be_bytes());
    bytes
}

#[allow(clippy::too_many_arguments)]
fn sample_mpc_prf_proof_bundle(
    transcript_digest: PublicDigest32,
    root_share_epoch: RootShareEpoch,
    opened_share_kind: OpenedShareKind,
    recipient_role: Role,
    recipient_identity: &str,
    signer_role: Role,
    signer_identity: &str,
    seed: u8,
) -> MpcPrfPartialProofBundleV1 {
    let binding = MpcPrfPartialBindingV1 {
        transcript_digest,
        root_share_epoch,
        opened_share_kind,
        recipient_role,
        recipient_identity: recipient_identity.to_owned(),
        signer_role,
        signer_identity: signer_identity.to_owned(),
    };
    let signer_partial = MpcPrfSignerPartialV1::new(
        binding,
        MpcPrfPartialWireV1::new(fixed_share_wire_bytes(
            signer_role,
            seed,
            MPC_PRF_PARTIAL_WIRE_V1_LEN,
        ))
        .expect("partial wire"),
    )
    .expect("signer partial");
    MpcPrfPartialProofBundleV1::new(
        signer_partial,
        MpcPrfShareCommitmentWireV1::new(fixed_share_wire_bytes(
            signer_role,
            seed.wrapping_add(1),
            MPC_PRF_COMMITMENT_WIRE_V1_LEN,
        ))
        .expect("commitment wire"),
        MpcPrfDleqProofWireV1::new(vec![seed.wrapping_add(2); MPC_PRF_DLEQ_PROOF_WIRE_V1_LEN])
            .expect("DLEQ proof wire"),
    )
    .expect("proof bundle")
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

struct DeterministicHpkeTestRng {
    next: u8,
}

impl DeterministicHpkeTestRng {
    fn new(seed: u8) -> Self {
        Self { next: seed }
    }
}

impl RngCore for DeterministicHpkeTestRng {
    fn next_u32(&mut self) -> u32 {
        let mut bytes = [0u8; 4];
        self.fill_bytes(&mut bytes);
        u32::from_le_bytes(bytes)
    }

    fn next_u64(&mut self) -> u64 {
        let mut bytes = [0u8; 8];
        self.fill_bytes(&mut bytes);
        u64::from_le_bytes(bytes)
    }

    fn fill_bytes(&mut self, dst: &mut [u8]) {
        for byte in dst {
            *byte = self.next;
            self.next = self.next.wrapping_add(0x3d);
        }
    }
}

impl CryptoRng for DeterministicHpkeTestRng {}
