//! End-to-end wallet-seed reseal from an owner passkey to a VoiceID device factor.

use std::fs;
use std::path::PathBuf;

use base64ct::{Base64UrlUnpadded, Encoding};
use serde_json::json;
use sha2::{Digest, Sha256};
use signer_core::passkey_custody::{
    open_wallet_custody_seed_envelope_v1, reseal_wallet_custody_seed_under_new_factor_v1,
    seal_wallet_custody_seed_envelope_v1, PasskeyCustodyEnvelopeBindingV1,
    PasskeyCustodyEnvelopeOwnershipV1, PasskeyCustodySecretBindingV1,
    WalletCustodyEnvelopeFactorV1, EMAIL_OTP_FACTOR_KEK_VERSION_V1, PASSKEY_CUSTODY_KEK_VERSION_V1,
    VOICEID_DEVICE_FACTOR_KEK_VERSION_V1, WALLET_SEED_DERIVATION_SCHEME_V1,
};

const WALLET_ID: &str = "wallet:voiceid-custody-journey";
const SEED: [u8; 32] = [3; 32];
const PASSKEY_SECRET: [u8; 32] = [7; 32];
const VOICEID_SECRET: [u8; 32] = [11; 32];
const SOURCE_NONCE: [u8; 12] = [13; 12];
const TARGET_NONCE: [u8; 12] = [17; 12];

fn binding(
    wallet_id: &str,
    envelope_id: &str,
    method_id: &str,
    factor: WalletCustodyEnvelopeFactorV1,
) -> PasskeyCustodyEnvelopeBindingV1 {
    PasskeyCustodyEnvelopeBindingV1 {
        wallet_id: wallet_id.to_owned(),
        envelope_id: envelope_id.to_owned(),
        factor,
        envelope_revision: 1,
        binding: PasskeyCustodySecretBindingV1::WalletCustodySeed {
            derivation_scheme: WALLET_SEED_DERIVATION_SCHEME_V1.to_owned(),
        },
        ownership: PasskeyCustodyEnvelopeOwnershipV1::MethodBound {
            wallet_auth_method_id: method_id.to_owned(),
        },
    }
}

fn passkey_factor() -> WalletCustodyEnvelopeFactorV1 {
    WalletCustodyEnvelopeFactorV1::Passkey {
        rp_id: "wallet.example.test".to_owned(),
        credential_id_b64u: "Y3JlZGVudGlhbA".to_owned(),
        kek_version: PASSKEY_CUSTODY_KEK_VERSION_V1.to_owned(),
    }
}

fn voiceid_factor(device_key_id: &str) -> WalletCustodyEnvelopeFactorV1 {
    WalletCustodyEnvelopeFactorV1::VoiceId {
        device_key_id: device_key_id.to_owned(),
        kek_version: VOICEID_DEVICE_FACTOR_KEK_VERSION_V1.to_owned(),
    }
}

fn main() {
    let report_path = PathBuf::from(std::env::args().nth(1).expect("report path is required"));
    assert!(report_path.is_absolute(), "report path must be absolute");
    let device_key_id = Base64UrlUnpadded::encode_string(&Sha256::digest([19; 32]));
    let source = binding(
        WALLET_ID,
        "wallet-custody-envelope:source",
        "wallet-auth-method:passkey",
        passkey_factor(),
    );
    let sealed_source =
        seal_wallet_custody_seed_envelope_v1(&PASSKEY_SECRET, &source, &SOURCE_NONCE, &SEED)
            .expect("source passkey seal");
    let (opened, admitted) = open_wallet_custody_seed_envelope_v1(
        &PASSKEY_SECRET,
        &source,
        &SOURCE_NONCE,
        &sealed_source.ciphertext,
        &sealed_source.aad_hash,
        &sealed_source.ciphertext_digest,
    )
    .expect("source passkey open");
    assert_eq!(opened.as_slice(), SEED);

    let target = binding(
        WALLET_ID,
        "wallet-custody-envelope:voiceid",
        "wallet-auth-method:voiceid",
        voiceid_factor(&device_key_id),
    );
    let sealed_target = reseal_wallet_custody_seed_under_new_factor_v1(
        &VOICEID_SECRET,
        &target,
        &admitted,
        &TARGET_NONCE,
        &opened,
    )
    .expect("VoiceID reseal");
    let (voice_opened, _) = open_wallet_custody_seed_envelope_v1(
        &VOICEID_SECRET,
        &target,
        &TARGET_NONCE,
        &sealed_target.ciphertext,
        &sealed_target.aad_hash,
        &sealed_target.ciphertext_digest,
    )
    .expect("VoiceID open");
    assert_eq!(voice_opened.as_slice(), SEED);

    let wrong_method = binding(
        WALLET_ID,
        &target.envelope_id,
        "wallet-auth-method:other",
        voiceid_factor(&device_key_id),
    );
    let wrong_wallet = binding(
        "wallet:other",
        &target.envelope_id,
        "wallet-auth-method:voiceid",
        voiceid_factor(&device_key_id),
    );
    let wrong_key = Base64UrlUnpadded::encode_string(&Sha256::digest([23; 32]));
    let wrong_device = binding(
        WALLET_ID,
        &target.envelope_id,
        "wallet-auth-method:voiceid",
        voiceid_factor(&wrong_key),
    );
    for changed in [&wrong_method, &wrong_wallet, &wrong_device] {
        assert!(
            open_wallet_custody_seed_envelope_v1(
                &VOICEID_SECRET,
                changed,
                &TARGET_NONCE,
                &sealed_target.ciphertext,
                &sealed_target.aad_hash,
                &sealed_target.ciphertext_digest,
            )
            .is_err(),
            "changed envelope identity must fail"
        );
    }
    assert!(
        open_wallet_custody_seed_envelope_v1(
            &PASSKEY_SECRET,
            &target,
            &TARGET_NONCE,
            &sealed_target.ciphertext,
            &sealed_target.aad_hash,
            &sealed_target.ciphertext_digest,
        )
        .is_err(),
        "passkey secret cannot open VoiceID envelope"
    );
    assert!(
        reseal_wallet_custody_seed_under_new_factor_v1(
            &VOICEID_SECRET,
            &wrong_wallet,
            &admitted,
            &TARGET_NONCE,
            &opened,
        )
        .is_err(),
        "a reseal cannot move the wallet seed"
    );
    let wrong_version = WalletCustodyEnvelopeFactorV1::VoiceId {
        device_key_id,
        kek_version: EMAIL_OTP_FACTOR_KEK_VERSION_V1.to_owned(),
    };
    assert!(
        seal_wallet_custody_seed_envelope_v1(
            &VOICEID_SECRET,
            &binding(
                WALLET_ID,
                "wallet-custody-envelope:invalid-version",
                "wallet-auth-method:voiceid",
                wrong_version,
            ),
            &TARGET_NONCE,
            &SEED,
        )
        .is_err(),
        "VoiceID cannot declare another factor's KEK version"
    );

    let report = json!({
        "schemaVersion": "voiceid_custody_journey_v1",
        "status": "passed",
        "bindingJson": serde_json::to_string(&target).expect("binding wire"),
        "envelope": {
            "kind": "wallet_custody_envelope_v2",
            "envelopeId": target.envelope_id,
            "walletId": target.wallet_id,
            "ownership": {
                "kind": "method_bound",
                "walletAuthMethodId": "wallet-auth-method:voiceid"
            },
            "binding": target.binding,
            "factor": target.factor,
            "envelopeVersion": "wallet_custody_envelope_v2",
            "envelopeRevision": 1,
            "nonceB64u": Base64UrlUnpadded::encode_string(&TARGET_NONCE),
            "sealedCustodySecretB64u": sealed_target.ciphertext_b64u(),
            "ciphertextDigestB64u": sealed_target.ciphertext_digest_b64u(),
            "aadHashB64u": sealed_target.aad_hash_b64u(),
            "lifecycle": { "state": "active", "activatedAtMs": 1 },
            "createdAtMs": 1,
            "updatedAtMs": 1
        },
        "cases": [
            "passkey_to_voiceid_reseal",
            "voiceid_opens_same_seed",
            "other_method_rejected",
            "other_wallet_rejected",
            "other_device_key_rejected",
            "other_factor_secret_rejected",
            "cross_wallet_reseal_rejected",
            "wrong_kek_version_rejected"
        ]
    });
    fs::create_dir_all(report_path.parent().expect("report directory"))
        .expect("create report directory");
    fs::write(
        &report_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&report).expect("report JSON")
        ),
    )
    .expect("write report");
    println!("VoiceID custody journey passed: {}", report_path.display());
}
