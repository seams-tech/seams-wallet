//! Disposable client: wallet seed and reply private key stay outside Workers.
use crate::{require, InvestigationResult};
use hpke_ng::{DhKemX25519HkdfSha256, Kem};
use ml_dsa::{Keypair, MlDsa65, SigningKey};
use router_ab_cloudflare::ml_dsa::{registration, Identifier, WalletScope};
use serde::Deserialize;
use serde_json::json;
use signer_core::{
    ml_dsa_custody::{
        prepare_ml_dsa_custody_v1, MlDsaCeremonyBindingV1, MlDsaKeyContinuityV1, MlDsaRoleV1,
    },
    wallet_seed_derivation::{
        compute_ml_dsa65_application_binding_digest_v1, derive_ml_dsa65_owner_root_from_seed_v1,
    },
};
use std::{
    fs,
    io::{self, BufRead, Write},
    os::unix::fs::PermissionsExt,
    path::Path,
};
use zeroize::Zeroizing;
#[derive(Deserialize)]
struct Input {
    holder_public_keys: [[u8; 32]; 2],
    wallet: WalletScope,
    key_id: Identifier,
    epoch: u64,
    operation: [u8; 32],
    continuity: registration::Continuity,
}
pub(super) fn run() -> InvestigationResult<bool> {
    let args: Vec<String> = std::env::args().collect();
    if !matches!(
        args.get(1).map(String::as_str),
        Some("worker-registration-client" | "worker-registration-keys")
    ) {
        return Ok(false);
    }
    let directory = Path::new(args.get(2).ok_or("Missing disposable key directory")?);
    fs::create_dir_all(directory)?;
    let public_path = directory.join("publics.json");
    if !public_path.exists() {
        let mut publics = [[0u8; 32]; 2];
        for (index, role) in ["a", "b"].iter().enumerate() {
            let mut entropy = Zeroizing::new([0u8; 32]);
            getrandom::getrandom(entropy.as_mut())?;
            let (secret, public) = DhKemX25519HkdfSha256::derive_key_pair(entropy.as_ref())?;
            let bytes = DhKemX25519HkdfSha256::sk_to_bytes(&secret);
            let file = directory.join(format!("{role}-kek"));
            fs::write(
                &file,
                format!(
                    "hpke-x25519-role-private-d1-private-v1:{}",
                    hex::encode(bytes.as_slice())
                ),
            )?;
            fs::set_permissions(file, fs::Permissions::from_mode(0o600))?;
            publics[index].copy_from_slice(public.as_ref());
        }
        fs::write(&public_path, serde_json::to_vec(&publics)?)?;
    }
    let publics: [[u8; 32]; 2] = serde_json::from_slice(&fs::read(public_path)?)?;
    println!("{}", json!({"ready":true,"holder_public_keys":publics}));
    io::stdout().flush()?;
    if args[1] == "worker-registration-keys" {
        return Ok(true);
    }
    let mut lines = io::stdin().lock().lines();
    let input: Input = serde_json::from_str(&lines.next().ok_or("Missing client input")??)?;
    let wallet = String::from(input.wallet.wallet.clone());
    let key_id = String::from(input.key_id.clone());
    let context =
        MlDsaCeremonyBindingV1::new(wallet.clone(), key_id.clone(), input.operation, input.epoch)?;
    let continuity = match input.continuity {
        registration::Continuity::Create => MlDsaKeyContinuityV1::Create,
        registration::Continuity::Recover {
            manifest_digest, ..
        } => MlDsaKeyContinuityV1::Recover {
            recorded_manifest_digest: manifest_digest,
        },
    };
    let seed = Zeroizing::new([0u8; 32]);
    let prepared =
        prepare_ml_dsa_custody_v1(seed.as_ref(), context, input.holder_public_keys, continuity)?;
    let request = registration::Request {
        wallet: input.wallet,
        key_id: input.key_id,
        epoch: input.epoch,
        operation: input.operation,
        continuity: input.continuity,
        input_a: prepared.input(MlDsaRoleV1::A).clone(),
        input_b: prepared.input(MlDsaRoleV1::B).clone(),
    };
    let binding = compute_ml_dsa65_application_binding_digest_v1(&wallet, &key_id)?;
    let root = derive_ml_dsa65_owner_root_from_seed_v1(seed.as_ref(), &binding)?;
    let mut canonical_input = Zeroizing::new(b"seams/ml-dsa-65/canonical-seed/v1".to_vec());
    canonical_input.extend_from_slice(root.as_ref());
    let canonical: [u8; 32] = crate::circuit_evidence::reference_shake256(&canonical_input, 32)
        .try_into()
        .map_err(|_| "Invalid canonical seed")?;
    let expected = SigningKey::<MlDsa65>::from_seed(&canonical.into())
        .verifying_key()
        .encode();
    println!(
        "{}",
        json!({"request":request,"expected_public_key":expected.as_slice()})
    );
    io::stdout().flush()?;
    let result: registration::Completed =
        serde_json::from_str(&lines.next().ok_or("Missing registration result")??)?;
    let verified = prepared.complete(&result.a.reply, &result.b.reply)?;
    require(
        verified.public_key().as_slice() == expected.as_slice(),
        "Hosted registration differs from canonical recovery",
    )?;
    require(
        *verified.manifest().digest() == result.a.activation.manifest_digest,
        "Worker manifest differs from client verification",
    )?;
    println!(
        "{}",
        json!({"verified":true,"canonical_key_verified":true,"holder_results_authenticated":true,"manifest_verified":true})
    );
    Ok(true)
}
