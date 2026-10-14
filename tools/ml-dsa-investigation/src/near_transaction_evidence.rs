//! Threshold signing of an SDK-encoded NEAR transaction before test recovery.

use crate::{InvestigationResult, digest, private_signing, require};
use aws_lc_rs::signature::{ML_DSA_65, UnparsedPublicKey};
use private_signing::{Operation, Randomness};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sha3::Sha3_256;
use std::{fs, path::Path};
use wasm_signer_worker::{
    ActionParams, NearAction, PublicKey, PublicKeyHandle, Signature, SignedTransaction,
    Transaction, build_transaction_with_actions, calculate_transaction_hash,
    encode_signed_transaction,
};

const SIGNER: &str = "ml-dsa-investigation.testnet";
const RECEIVER: &str = "ml-dsa-receiver.testnet";
const BLOCK_HASH: [u8; 32] = [0x42; 32];

pub(super) fn run(
    schedules: &Path,
    own_a: &Path,
    own_b: &Path,
    public_key_path: &Path,
) -> InvestigationResult<Value> {
    let public_bytes: [u8; 1952] = fs::read(public_key_path)?
        .try_into()
        .map_err(|_| "Invalid NEAR ML-DSA public-key size.")?;
    let public_key = PublicKey::MlDsa65(Box::new(public_bytes));
    let public_string = public_key.to_string();
    require(
        public_string.parse::<PublicKey>()? == public_key,
        "SDK ML-DSA public-key text round trip failed.",
    )?;
    let transaction = build_fixture_transaction(public_key.clone(), 1)?;
    let unsigned = borsh::to_vec(&transaction)?;
    let expected_unsigned = encode_reference_transaction(&public_bytes);
    require(
        unsigned == expected_unsigned,
        "SDK transaction differs from the pinned NEAR V0 field encoding.",
    )?;
    let (message, size) = transaction.get_hash_and_size();
    require(
        message.0.as_slice() == Sha256::digest(&expected_unsigned).as_slice()
            && size == unsigned.len() as u64,
        "SDK transaction digest or size differs from the reference encoding.",
    )?;
    let signing = private_signing::run_operation(
        schedules,
        own_a,
        own_b,
        public_key_path,
        Operation {
            operation_id: private_signing::fresh_operation_id()?,
            engine: crate::complete_engine_evidence::Engine::HalfGates,
            message: message.0,
            context: Vec::new(),
            randomness: Randomness::JointRandom,
        },
    )?;
    let signature_bytes: [u8; 3309] = hex::decode(
        signing["signature_hex"]
            .as_str()
            .ok_or("Missing NEAR threshold signature.")?,
    )?
    .try_into()
    .map_err(|_| "Invalid NEAR threshold signature size.")?;
    let signature = Signature::MlDsa65(Box::new(signature_bytes));
    let verifier = UnparsedPublicKey::new(&ML_DSA_65, public_key.as_bytes());
    require(
        verifier.verify(&message.0, signature.as_bytes()).is_ok(),
        "The pinned NEAR AWS-LC algorithm rejected the threshold signature.",
    )?;
    let hash = calculate_transaction_hash(&transaction);
    let signed = encode_signed_transaction(transaction.clone(), signature.clone())?;
    let mut expected_signed = expected_unsigned;
    expected_signed.push(2);
    expected_signed.extend_from_slice(signature.as_bytes());
    require(
        signed == expected_signed,
        "SDK signed transaction differs from the standard NEAR encoding.",
    )?;
    let decoded: SignedTransaction = borsh::from_slice(&signed)?;
    require(
        decoded.transaction() == &transaction && decoded.signature() == &signature,
        "SDK signed transaction round trip failed.",
    )?;
    let altered = build_fixture_transaction(public_key.clone(), 2)?;
    require(
        verifier
            .verify(&altered.get_hash_and_size().0.0, signature.as_bytes())
            .is_err(),
        "NEAR verifier accepted an altered transaction nonce.",
    )?;
    let mut changed_signature = signature_bytes;
    changed_signature[0] ^= 1;
    require(
        verifier.verify(&message.0, &changed_signature).is_err(),
        "NEAR verifier accepted an altered signature.",
    )?;
    let handle_string = verify_access_key_handle(&public_key)?;
    require(
        handle_string.parse::<PublicKey>().is_err(),
        "SDK accepted a hash identifier as a full transaction public key.",
    )?;
    require(
        serde_json::from_value::<PublicKey>(json!({"keyType": 2, "keyData": vec![0; 32]})).is_err()
            && serde_json::from_value::<PublicKey>(json!({"keyType": 3, "keyData": vec![0; 32]}))
                .is_err(),
        "SDK accepted a malformed or hashed full-key encoding.",
    )?;
    require(
        serde_json::from_value::<PublicKey>(serde_json::to_value(&public_key)?)? == public_key,
        "SDK ML-DSA JSON key round trip failed.",
    )?;
    let wrong_signature = Signature::Ed25519([0; 64]);
    require(
        encode_signed_transaction(transaction.clone(), wrong_signature.clone()).is_err(),
        "SDK attached an Ed25519 signature to an ML-DSA transaction.",
    )?;
    require(
        serde_json::from_value::<SignedTransaction>(
            json!({"transaction": transaction, "signature": wrong_signature}),
        )
        .is_err(),
        "SDK JSON boundary accepted mismatched signature and public-key schemes.",
    )?;
    let mut wrong_borsh = unsigned.clone();
    wrong_borsh.push(0);
    wrong_borsh.extend_from_slice(&[0; 64]);
    require(
        borsh::from_slice::<SignedTransaction>(&wrong_borsh).is_err(),
        "SDK Borsh boundary accepted mismatched signature and public-key schemes.",
    )?;
    let add_key = ActionParams::AddKey {
        public_key: public_string.clone(),
        access_key: r#"{"nonce":0,"permission":{"FullAccess":{}}}"#.into(),
    }
    .to_action()?;
    let mut expected_add_key = vec![5, 2];
    expected_add_key.extend_from_slice(&public_bytes);
    expected_add_key.extend_from_slice(&0_u64.to_le_bytes());
    expected_add_key.push(1);
    require(
        borsh::to_vec(&add_key)? == expected_add_key,
        "SDK AddKey action differs from the pinned NEAR encoding.",
    )?;
    let delete_key = ActionParams::DeleteKey {
        public_key: public_string.clone(),
    }
    .to_action()?;
    let mut expected_delete_key = vec![6, 2];
    expected_delete_key.extend_from_slice(&public_bytes);
    require(
        borsh::to_vec(&delete_key)? == expected_delete_key,
        "SDK DeleteKey action differs from the pinned NEAR full-key encoding.",
    )?;
    let ed25519 = PublicKey::Ed25519([7; 32]);
    let mut expected_ed25519 = vec![0];
    expected_ed25519.extend_from_slice(&[7; 32]);
    require(
        borsh::to_vec(&ed25519)? == expected_ed25519,
        "SDK Ed25519 encoding changed.",
    )?;
    eprintln!(
        "Verified an SDK-encoded threshold-signed NEAR transaction with the pinned AWS-LC algorithm."
    );
    Ok(json!({
        "scope": "Offline SDK transaction encoding and threshold signing before authorized test recovery. No RPC broadcast or transaction receipt.",
        "nearcore_source_revision": "a45238b883d23673e7eac94549126bbb6f0d9307",
        "verifier": "aws-lc-rs =1.18.1, signature::ML_DSA_65, the algorithm used by the pinned nearcore source",
        "verifier_limit": "This invokes the same signature verification algorithm, not the complete nearcore transaction validation or state-transition code.",
        "network_intent": "testnet", "signer_id": SIGNER, "receiver_id": RECEIVER, "nonce": 1,
        "block_hash_hex": hex::encode(BLOCK_HASH), "public_key": public_string,
        "hashed_access_key_identifier": handle_string, "hashed_identifier_borsh_tag": 3,
        "public_key_borsh_tag": 2, "signature_borsh_tag": 2,
        "unsigned_transaction_borsh_hex": hex::encode(&unsigned), "unsigned_transaction_bytes": unsigned.len(),
        "transaction_digest_hex": hex::encode(message.0), "transaction_hash": hash,
        "signed_transaction_borsh_hex": hex::encode(&signed), "signed_transaction_bytes": signed.len(),
        "signed_transaction_sha256": digest(&signed),
        "independent_reference_field_encoding_matches": true,
        "aws_lc_verification": true, "altered_nonce_and_signature_rejected": true,
        "hashed_identifier_and_wrong_length_keys_rejected": true,
        "mismatched_signature_scheme_rejected_at_builder_json_and_borsh_boundaries": true,
        "add_and_delete_key_full_key_encodings_match": true, "ed25519_encoding_preserved": true,
        "threshold_signing": signing,
    }))
}

pub(super) fn verify_access_key_handle(public_key: &PublicKey) -> InvestigationResult<String> {
    let handle = PublicKeyHandle::from(public_key);
    let text = handle.to_string();
    let mut hash = Sha3_256::new();
    hash.update(b"near:ml-dsa-65-pubkey-hash:v1");
    hash.update(public_key.as_bytes());
    let expected: [u8; 32] = hash.finalize().into();
    let mut expected_borsh = vec![3];
    expected_borsh.extend_from_slice(&expected);
    require(
        text == format!("ml-dsa-65-hash:{}", bs58::encode(expected).into_string())
            && text.parse::<PublicKeyHandle>()? == handle
            && serde_json::from_value::<PublicKeyHandle>(json!(text))? == handle
            && serde_json::to_value(&handle)? == json!(text)
            && borsh::to_vec(&handle)? == expected_borsh
            && borsh::from_slice::<PublicKeyHandle>(&expected_borsh)? == handle,
        "SDK access-key handle does not match the NEAR hash, text, JSON, or Borsh contract.",
    )?;
    require(
        public_key.to_string().parse::<PublicKeyHandle>().is_err()
            && text.parse::<PublicKey>().is_err()
            && borsh::from_slice::<PublicKey>(&expected_borsh).is_err()
            && borsh::from_slice::<PublicKeyHandle>(&borsh::to_vec(public_key)?).is_err(),
        "SDK confused full public keys with hash handles.",
    )?;
    for length in [0, 31, 33, 1952] {
        let malformed = format!(
            "ml-dsa-65-hash:{}",
            bs58::encode(vec![0; length]).into_string()
        );
        require(
            malformed.parse::<PublicKeyHandle>().is_err(),
            "SDK accepted a wrong-length ML-DSA handle.",
        )?;
    }
    for key in [PublicKey::Ed25519([7; 32]), PublicKey::Secp256k1([9; 64])] {
        let key_handle = PublicKeyHandle::from(&key);
        require(
            key_handle.to_string() == key.to_string()
                && borsh::to_vec(&key_handle)? == borsh::to_vec(&key)?
                && key_handle.to_string().parse::<PublicKeyHandle>()? == key_handle,
            "SDK Ed25519 or secp256k1 handle encoding differs from its full key.",
        )?;
    }
    Ok(text)
}

fn build_fixture_transaction(
    public_key: PublicKey,
    nonce: u64,
) -> InvestigationResult<Transaction> {
    Ok(build_transaction_with_actions(
        SIGNER,
        RECEIVER,
        nonce,
        &BLOCK_HASH,
        public_key,
        vec![NearAction::Transfer { deposit: 1 }],
    )?)
}

fn encode_reference_transaction(public_key: &[u8; 1952]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&(SIGNER.len() as u32).to_le_bytes());
    bytes.extend_from_slice(SIGNER.as_bytes());
    bytes.push(2);
    bytes.extend_from_slice(public_key);
    bytes.extend_from_slice(&1_u64.to_le_bytes());
    bytes.extend_from_slice(&(RECEIVER.len() as u32).to_le_bytes());
    bytes.extend_from_slice(RECEIVER.as_bytes());
    bytes.extend_from_slice(&BLOCK_HASH);
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    bytes.push(3);
    bytes.extend_from_slice(&1_u128.to_le_bytes());
    bytes
}
