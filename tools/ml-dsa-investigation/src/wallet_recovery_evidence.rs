//! Repeat wallet-seed derivation with fresh private shares before authorized export.

use crate::custody_delivery_evidence::WalletRecoveryCase;
use crate::{
    InvestigationResult, command_text, digest, private_keygen, private_signing, reference, require,
};
use ml_dsa_threshold::{
    ml_dsa_runtime::TrustedMlDsaSchedule,
    ml_dsa_signing::{
        CircuitMetrics, SigningRole, keygen::KeygenStep, wallet_seed::prepare_wallet_keygen,
    },
};
use ed25519_yao_generator::compile_ml_dsa_wallet_seed_circuit_v1;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use signer_core::ml_dsa_custody::MlDsaKeyContinuityV1;
use signer_core::wallet_seed_derivation::{
    compute_ml_dsa65_application_binding_digest_v1, derive_ecdsa_client_root_share_from_seed_v1,
    derive_ed25519_yao_client_root_from_seed_v1, derive_ml_dsa65_owner_root_from_seed_v1,
};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    process::Command,
    time::Instant,
};
use zeroize::Zeroizing;

pub(super) fn owner_root(
    name: &str,
    binding: &[u8; 32],
) -> InvestigationResult<Zeroizing<[u8; 32]>> {
    Ok(derive_ml_dsa65_owner_root_from_seed_v1(
        &reference::fixture_bytes(name, 32)?,
        binding,
    )?)
}

// Only the disposable fixture verifier calls this after threshold signing and export.
pub(super) fn canonical_seed(name: &str, binding: &[u8; 32]) -> InvestigationResult<Vec<u8>> {
    let root = owner_root(name, binding)?;
    let mut input = b"seams/ml-dsa-65/canonical-seed/v1".to_vec();
    input.extend_from_slice(root.as_ref());
    Ok(crate::circuit_evidence::reference_shake256(&input, 32))
}

pub(super) fn begin_role(
    role: SigningRole,
    root_share: &[u8; 32],
    schedules: &Path,
    reader: &mut impl Read,
    writer: &mut impl Write,
) -> InvestigationResult<(KeygenStep, Value)> {
    let started = Instant::now();
    let bytes = fs::read(schedules.join("wallet-seed.bin"))?;
    let schedule = TrustedMlDsaSchedule::parse(&bytes, Sha256::digest(&bytes).into())?;
    let request = prepare_wallet_keygen(role, root_share)?;
    let (output, observation) = private_signing::drive_runtime(
        request.begin(&schedule)?,
        reader,
        writer,
        &mut crate::signing_lifecycle_evidence::WireFault::Direct,
    )?;
    require(
        output.metrics.public_return_bytes == 0,
        "Wallet seed circuit opened a public output.",
    )?;
    let (next, metrics) = request.accept(output)?;
    let metrics =
        crate::complete_engine_evidence::encode_metrics(&CircuitMetrics::HalfGates(metrics), role);
    crate::complete_engine_evidence::verify_observation(&metrics, &observation, role)?;
    Ok((
        next,
        json!({"metrics": metrics, "observation": observation, "wall_ns_including_schedule_read": started.elapsed().as_nanos()}),
    ))
}

pub(super) fn run(output: &Path) -> InvestigationResult<()> {
    let schedules = tempfile::tempdir()?;
    let keygen = private_keygen::compile_schedules(schedules.path())?;
    let signing = private_signing::compile_schedules(schedules.path())?;
    let wallet_seed = compile_wallet_seed_schedule(schedules.path())?;
    let binding =
        compute_ml_dsa65_application_binding_digest_v1("ml-dsa-wallet-fixture", "near-key-1")?;
    require(
        compute_ml_dsa65_application_binding_digest_v1("", "near-key-1").is_err()
            && compute_ml_dsa65_application_binding_digest_v1("ml-dsa-wallet-fixture", "").is_err(),
        "An empty wallet or key identity was admitted.",
    )?;
    let root = owner_root("zero", &binding)?;
    let seed = reference::fixture_bytes("zero", 32)?;
    require(
        *root != *derive_ed25519_yao_client_root_from_seed_v1(&seed, &binding)?
            && *root != *derive_ecdsa_client_root_share_from_seed_v1(&seed, &binding)?,
        "ML-DSA root collided with another signing root in the fixture.",
    )?;
    let mut cases: Vec<Value> = Vec::new();
    for (index, (name, wallet_id, signing_key_id)) in [
        ("zero", "ml-dsa-wallet-fixture", "near-key-1"),
        ("zero", "ml-dsa-wallet-fixture", "near-key-1"),
        ("incrementing", "ml-dsa-wallet-fixture", "near-key-1"),
        ("zero", "ml-dsa-other-wallet", "near-key-1"),
        ("zero", "ml-dsa-wallet-fixture", "near-key-2"),
    ]
    .into_iter()
    .enumerate()
    {
        let continuity = if index == 1 {
            let digest = cases[0]["result"]["client_completion"]["manifest_digest_hex"]
                .as_str()
                .ok_or("Missing recorded manifest.")?;
            MlDsaKeyContinuityV1::Recover {
                recorded_manifest_digest: hex::decode(digest)?
                    .try_into()
                    .map_err(|_| "Invalid manifest length")?,
            }
        } else {
            MlDsaKeyContinuityV1::Create
        };
        let case = WalletRecoveryCase {
            wallet_id,
            signing_key_id,
            continuity,
            material_epoch: index as u64,
        };
        let result = private_keygen::run_case(
            schedules.path(),
            Some(name),
            private_keygen::Campaign::WalletRecovery(&case),
        )?;
        cases.push(json!({"wallet_seed_fixture": name, "application_binding_digest_hex": hex::encode(case.application_binding()?), "result": result}));
    }
    let fresh = WalletRecoveryCase {
        wallet_id: "ml-dsa-fresh-custody",
        signing_key_id: "near-key-1",
        continuity: MlDsaKeyContinuityV1::Create,
        material_epoch: 0,
    };
    let result = private_keygen::run_case(
        schedules.path(),
        None,
        private_keygen::Campaign::WalletRecovery(&fresh),
    )?;
    cases.push(json!({"wallet_seed_fixture": "fresh-custody", "application_binding_digest_hex": hex::encode(fresh.application_binding()?), "result": result}));
    let delivery_rejections =
        crate::custody_delivery_evidence::verify_rejections(&cases[0]["result"])?;
    require(
        cases[0]["result"]["public_key_sha256"] == cases[1]["result"]["public_key_sha256"],
        "Fresh wallet recovery changed the key.",
    )?;
    require(
        cases[0]["result"]["threshold_signing"]["signature_hex"]
            == cases[1]["result"]["threshold_signing"]["signature_hex"],
        "Recovered key changed the deterministic signature.",
    )?;
    for index in [2, 3, 4] {
        require(
            cases[0]["result"]["public_key_sha256"] != cases[index]["result"]["public_key_sha256"],
            "Changed seed or binding reproduced the fixture key.",
        )?;
    }
    require(
        cases[0]["result"]["role_a"]["wallet_seed_stage"]["metrics"]["execution_binding_sha256"]
            != cases[1]["result"]["role_a"]["wallet_seed_stage"]["metrics"]["execution_binding_sha256"],
        "Recovery reused its wallet-seed execution binding.",
    )?;
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository root.")?;
    let mut sources = Vec::new();
    for path in [
        "crates/signer-core/src/wallet_seed_derivation.rs",
        "crates/signer-core/src/ml_dsa_custody.rs",
        "crates/signer-core/src/ml_dsa_custody/material.rs",
        "tools/ml-dsa-investigation/src/material_storage_evidence.rs",
        "crates/signer-core/Cargo.toml",
        "wasm/wallet_custody_ceremony/src/ml_dsa.rs",
        "wasm/wallet_custody_ceremony/src/ceremony.rs",
        "wasm/wallet_custody_ceremony/Cargo.toml",
        "wasm/wallet_custody_ceremony/Cargo.lock",
        "tools/ml-dsa-investigation/src/custody_delivery_evidence.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/wallet_seed.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/keygen.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_keygen.rs",
        "tools/ed25519-yao-generator/src/circuit/ir.rs",
        "tools/ml-dsa-investigation/src/private_keygen.rs",
        "tools/ml-dsa-investigation/src/private_signing.rs",
        "tools/ml-dsa-investigation/src/wallet_recovery_evidence.rs",
        "tools/ml-dsa-investigation/Cargo.lock",
    ] {
        sources.push(json!({"path": path, "sha256": digest(&fs::read(repository.join(path))?)}));
    }
    let report = json!({
        "schema": "seams.ml-dsa-wallet-seed-recovery.v3", "public_fixture_only": false, "disposable_test_keys_only": true, "production_eligible": false,
        "source_revision": command_text(Command::new("git").args(["rev-parse", "HEAD"]).current_dir(repository))?,
        "executable_sha256": digest(&fs::read(std::env::current_exe()?)?),
        "sources": sources, "keygen_schedules": keygen, "signing_schedules": signing, "wallet_seed_schedule": wallet_seed,
        "same_wallet_seed_and_binding_reproduce_key": true, "changed_seed_or_binding_changes_key": true,
        "fixture_owner_root_separated_from_ed25519_and_ecdsa": true,
        "scope": "Separate roles derive the canonical seed privately, generate key shares, and sign before authorized fixture export. Repeated recovery uses fresh root sharing, seed masks, and OT. Encrypted role delivery and authenticated results use fixture holder keys. Native custody states cover establishment, joining, and code recovery. Separate signing processes reopen authenticated role material from encrypted files. This shared-host check supplies no production admission, durable activation, isolated storage, or rollback protection claim.",
        "cases": cases,
        "delivery_and_manifest_rejections": delivery_rejections,
    });
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    println!(
        "Wrote wallet-seed recovery evidence to {}",
        output.display()
    );
    Ok(())
}

pub(super) fn compile_wallet_seed_schedule(directory: &Path) -> InvestigationResult<Value> {
    let started = Instant::now();
    let circuit = compile_ml_dsa_wallet_seed_circuit_v1();
    let identity = private_keygen::save_schedule(
        directory,
        "wallet-seed.bin",
        "wallet-owner-root-to-canonical-seed",
        &circuit,
        started,
    )?;
    drop(circuit);
    Ok(identity)
}
