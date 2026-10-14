//! Public disposable wallet fixtures. Each deployed role receives only its own share.

use crate::{
    InvestigationResult, circuit_evidence::reference_shake256, digest, private_keygen,
    wallet_recovery_evidence,
};
use ml_dsa::{Keypair, MlDsa65, SigningKey};
use serde_json::json;
use signer_core::wallet_seed_derivation::{
    WalletKeySetManifestV1, compute_ml_dsa65_application_binding_digest_v1,
    derive_ml_dsa65_owner_root_from_seed_v1, establish_wallet_key_set_manifest_v1,
};
use std::{fs, path::Path};
use zeroize::Zeroizing;

pub(super) fn export(directory: &Path) -> InvestigationResult<()> {
    fs::create_dir_all(directory)?;
    let mut schedules = private_keygen::compile_schedules(directory)?;
    schedules.push(wallet_recovery_evidence::compile_wallet_seed_schedule(
        directory,
    )?);
    let mut a = Vec::new();
    let mut b = Vec::new();
    let mut public = Vec::new();
    for index in 0..8 {
        let wallet_id = if index == 7 {
            "prepared-other-wallet"
        } else {
            "prepared-wallet-fixture"
        };
        let key_id = "near-ml-dsa-65";
        let seed = if index == 6 { [1u8; 32] } else { [0u8; 32] };
        let binding = compute_ml_dsa65_application_binding_digest_v1(wallet_id, key_id)?;
        let root = derive_ml_dsa65_owner_root_from_seed_v1(&seed, &binding)?;
        let mut share_a = Zeroizing::new([0u8; 32]);
        getrandom::getrandom(share_a.as_mut())?;
        let mut share_b = Zeroizing::new(*root);
        for bit in 0..32 {
            share_b[bit] ^= share_a[bit];
        }
        let mut encoded = b"seams/ml-dsa-65/canonical-seed/v1".to_vec();
        encoded.extend_from_slice(root.as_ref());
        let xi: [u8; 32] = reference_shake256(&encoded, 32)
            .try_into()
            .expect("fixed seed");
        let pair = SigningKey::<MlDsa65>::from_seed(&xi.into());
        let public_key: [u8; 1952] = pair.verifying_key().encode().as_slice().try_into()?;
        let manifest =
            establish_wallet_key_set_manifest_v1(&WalletKeySetManifestV1::NearMlDsa65 {
                wallet_id: wallet_id.into(),
                ml_dsa65_signing_key_id: key_id.into(),
                registered_public_key: Box::new(public_key),
            })?;
        let record = json!({"index": index, "wallet_id": wallet_id, "signing_key_id": key_id,
            "public_key_hex": hex::encode(public_key), "key_manifest_digest_hex": hex::encode(manifest.digest()),
            "application_binding_digest_hex": hex::encode(binding)});
        let mut own_a = record.clone();
        own_a["own_root_share_hex"] = json!(hex::encode(share_a.as_ref()));
        let mut own_b = record.clone();
        own_b["own_root_share_hex"] = json!(hex::encode(share_b.as_ref()));
        a.push(own_a);
        b.push(own_b);
        let mut oracle = record;
        oracle["public_fixture_wallet_seed_hex"] = json!(hex::encode(seed));
        oracle["canonical_seed_sha256"] = json!(digest(&xi));
        public.push(oracle);
    }
    for (role, cases) in [("a", a), ("b", b), ("client", public)] {
        fs::write(
            directory.join(format!("prepared-{role}.json")),
            serde_json::to_vec_pretty(&json!({
                "schema": "seams.ml-dsa-prepared-worker-fixtures.v1", "role": role,
                "disposable_public_fixtures_only": true, "schedules": schedules, "cases": cases,
            }))?,
        )?;
    }
    Ok(())
}
