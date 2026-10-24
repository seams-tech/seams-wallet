//! Sign one disposable testnet self-transfer through separate threshold roles.

use crate::{InvestigationResult, command_text, digest, private_keygen, private_signing, require};
use aws_lc_rs::signature::{ML_DSA_65, UnparsedPublicKey};
use private_signing::{Operation, Randomness};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{fs, path::Path, process::Command};
use wasm_signer_worker::{
    NearAction, PublicKey, Signature, build_transaction_with_actions, calculate_transaction_hash,
    encode_signed_transaction,
};

const SIGNER: &str = "ml-dsa-e2e-20261014-bb976cccc038.testnet";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TestnetRequest {
    signer_id: String,
    public_key: String,
    nonce: u64,
    block_hash: String,
}

pub(super) fn run(request: &Path, output: &Path) -> InvestigationResult<()> {
    let schedules = tempfile::tempdir()?;
    let keygen_schedules = private_keygen::compile_schedules(schedules.path())?;
    let signing_schedules = private_signing::compile_schedules(schedules.path())?;
    let result = private_keygen::run_case(
        schedules.path(),
        Some("zero"),
        private_keygen::Campaign::NearTestnet(request),
    )?;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository root.")?;
    let mut sources = Vec::new();
    for path in [
        "tools/ml-dsa-investigation/src/near_testnet_evidence.rs",
        "tools/ml-dsa-investigation/src/near_transaction_evidence.rs",
        "tools/ml-dsa-investigation/src/private_keygen.rs",
        "tools/ml-dsa-investigation/src/private_signing.rs",
        "tools/ml-dsa-investigation/Cargo.lock",
        "crates/ml-dsa-threshold/src/signing.rs",
        "crates/ml-dsa-threshold/src/signing/keygen.rs",
        "crates/ml-dsa-threshold/src/signing/arithmetic.rs",
        "crates/ml-dsa-threshold/src/runtime.rs",
        "wasm/near_signer/src/types/near_keys.rs",
        "wasm/near_signer/src/types/near.rs",
        "wasm/near_signer/src/lib.rs",
        "wasm/near_signer/Cargo.toml",
        "wasm/near_signer/Cargo.lock",
        "wasm/near_signer/src/transaction.rs",
    ] {
        sources
            .push(json!({"repository_path": path, "sha256": digest(&fs::read(root.join(path))?)}));
    }
    let report = json!({
        "schema": "seams.ml-dsa-near-testnet-signing.v1",
        "public_fixture_only": true,
        "production_eligible": false,
        "source_revision": command_text(Command::new("git").args(["rev-parse", "HEAD"]).current_dir(root))?,
        "sources": sources,
        "request_sha256": digest(&fs::read(request)?),
        "keygen_schedules": keygen_schedules,
        "signing_schedules": signing_schedules,
        "result": result,
        "scope": "Public zero-seed fixture, freshly shared through canonical key generation. Two role processes sign before the authorized test recipient reconstructs the key. This command does not broadcast.",
    });
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    println!(
        "Wrote threshold-signed testnet transaction to {}",
        output.display()
    );
    Ok(())
}

pub(super) fn sign(
    request_path: &Path,
    schedules: &Path,
    own_a: &Path,
    own_b: &Path,
    public_key_path: &Path,
) -> InvestigationResult<Value> {
    let request: TestnetRequest = serde_json::from_slice(&fs::read(request_path)?)?;
    require(
        request.signer_id == SIGNER && request.nonce > 0,
        "Only the fixed disposable testnet account and a positive nonce are permitted.",
    )?;
    let public: [u8; 1952] = fs::read(public_key_path)?
        .try_into()
        .map_err(|_| "Invalid ML-DSA key length.")?;
    let key = PublicKey::MlDsa65(Box::new(public));
    let handle = crate::near_transaction_evidence::verify_access_key_handle(&key)?;
    require(
        request.public_key == key.to_string(),
        "Testnet request key differs from the threshold-generated fixture.",
    )?;
    let block_hash: [u8; 32] = bs58::decode(&request.block_hash)
        .into_vec()?
        .try_into()
        .map_err(|_| "Invalid testnet block hash length.")?;
    let transaction = build_transaction_with_actions(
        SIGNER,
        SIGNER,
        request.nonce,
        &block_hash,
        key,
        vec![NearAction::Transfer { deposit: 1 }],
    )?;
    let message = transaction.get_hash_and_size().0.0;
    let signing = private_signing::run_operation(
        schedules,
        own_a,
        own_b,
        public_key_path,
        Operation {
            operation_id: private_signing::fresh_operation_id()?,
            engine: crate::complete_engine_evidence::Engine::HalfGates,
            message,
            context: Vec::new(),
            randomness: Randomness::JointRandom,
        },
    )?;
    let bytes: [u8; 3309] = hex::decode(
        signing["signature_hex"]
            .as_str()
            .ok_or("Missing threshold signature.")?,
    )?
    .try_into()
    .map_err(|_| "Invalid signature length.")?;
    require(
        UnparsedPublicKey::new(&ML_DSA_65, public)
            .verify(&message, &bytes)
            .is_ok(),
        "AWS-LC rejected the testnet threshold signature.",
    )?;
    let hash = calculate_transaction_hash(&transaction);
    let signed = encode_signed_transaction(transaction, Signature::MlDsa65(Box::new(bytes)))?;
    Ok(json!({
        "signer_id": SIGNER, "receiver_id": SIGNER, "deposit_yocto_near": "1",
        "nonce": request.nonce, "block_hash": request.block_hash, "public_key": request.public_key,
        "public_key_handle": handle, "sdk_handle_boundary_checks_passed": true,
        "transaction_hash": hash, "signed_transaction_borsh_hex": hex::encode(&signed),
        "signed_transaction_sha256": digest(&signed), "aws_lc_verification": true,
        "threshold_signing": signing,
    }))
}
