//! Protected role delivery and manifest failures inside the recovery E2E campaign.

use crate::{InvestigationResult, private_signing, reference, require};
use base64ct::{Base64UrlUnpadded, Encoding};
use hpke_ng::{DhKemX25519HkdfSha256, Kem};
use serde_json::{Value, json};
use signer_core::passkey_custody::{
    PASSKEY_CUSTODY_KEK_VERSION_V1, PasskeyCustodyEnvelopeBindingV1,
    PasskeyCustodyEnvelopeOwnershipV1, PasskeyCustodySecretBindingV1,
    WALLET_SEED_DERIVATION_SCHEME_V1, WalletCustodyEnvelopeFactorV1,
    open_wallet_custody_seed_envelope_v1, seal_wallet_custody_seed_envelope_v1,
};
use signer_core::wallet_recovery_custody::{
    derive_wallet_recovery_key_id_v1, seal_wallet_recovery_entry_v1,
    seal_wallet_recovery_manifest_kek_v1,
};
use signer_core::{
    ml_dsa_custody::{
        MlDsaCeremonyBindingV1, MlDsaKeyContinuityV1, MlDsaRoleV1, PreparedMlDsaCustodyV1,
        SealedMlDsaRoleInputV1, SealedMlDsaRoleResultV1, open_ml_dsa_role_input_v1,
        prepare_ml_dsa_custody_v1,
    },
    wallet_seed_derivation::compute_ml_dsa65_application_binding_digest_v1,
};
use wallet_custody_ceremony::ceremony::{
    CeremonySeedHeldV1, FactorSealInputsV1, RecoveryCustodyOpenInputsV1,
    ml_dsa::{MlDsaCeremonyPreparedV1, MlDsaCeremonyVerifiedV1, MlDsaCustodyCompletionV1},
};
use zeroize::Zeroizing;

pub(super) struct WalletRecoveryCase<'a> {
    pub wallet_id: &'a str,
    pub signing_key_id: &'a str,
    pub continuity: MlDsaKeyContinuityV1,
    pub material_epoch: u64,
}
impl WalletRecoveryCase<'_> {
    pub(super) fn application_binding(&self) -> InvestigationResult<[u8; 32]> {
        Ok(compute_ml_dsa65_application_binding_digest_v1(
            self.wallet_id,
            self.signing_key_id,
        )?)
    }
}

pub(super) fn prepare_delivery(
    fixture: Option<&str>,
    case: &WalletRecoveryCase<'_>,
) -> InvestigationResult<(MlDsaCeremonyPreparedV1, Zeroizing<[[u8; 32]; 2]>)> {
    let binding = MlDsaCeremonyBindingV1::new(
        case.wallet_id.into(),
        case.signing_key_id.into(),
        private_signing::fresh_operation_id()?,
        case.material_epoch,
    )?;
    let HolderKeys { secrets, publics } = holder_keys()?;
    let continuity = match &case.continuity {
        MlDsaKeyContinuityV1::Create => MlDsaKeyContinuityV1::Create,
        MlDsaKeyContinuityV1::Recover {
            recorded_manifest_digest,
        } => MlDsaKeyContinuityV1::Recover {
            recorded_manifest_digest: *recorded_manifest_digest,
        },
    };
    let custody = match fixture {
        Some(name) => fixture_custody(name, case.wallet_id, &continuity)?,
        None => CeremonySeedHeldV1::establish(case.wallet_id)
            .map_err(|error| error.message().to_string())?,
    };
    let prepared = custody
        .prepare_ml_dsa65(binding, publics, continuity)
        .map_err(|error| error.message().to_string())?;
    Ok((prepared, secrets))
}

struct HolderKeys {
    secrets: Zeroizing<[[u8; 32]; 2]>,
    publics: [[u8; 32]; 2],
}

fn holder_keys() -> InvestigationResult<HolderKeys> {
    let mut secrets = Zeroizing::new([[0; 32]; 2]);
    let mut publics = [[0; 32]; 2];
    for index in 0..2 {
        let mut entropy = Zeroizing::new([0; 32]);
        getrandom::getrandom(entropy.as_mut())?;
        let (secret, public) = DhKemX25519HkdfSha256::derive_key_pair(entropy.as_ref())?;
        let encoded_secret = Zeroizing::new(DhKemX25519HkdfSha256::sk_to_bytes(&secret));
        secrets[index].copy_from_slice(&encoded_secret);
        publics[index].copy_from_slice(&DhKemX25519HkdfSha256::pk_to_bytes(&public));
    }
    Ok(HolderKeys { secrets, publics })
}

fn binding(
    wallet: &str,
    key: &str,
    operation: [u8; 32],
    epoch: u64,
) -> InvestigationResult<MlDsaCeremonyBindingV1> {
    Ok(MlDsaCeremonyBindingV1::new(
        wallet.into(),
        key.into(),
        operation,
        epoch,
    )?)
}

fn seal_results(
    client: &PreparedMlDsaCustodyV1,
    secrets: &[[u8; 32]; 2],
    public_key: &[u8; 1952],
    disagree: bool,
) -> InvestigationResult<[SealedMlDsaRoleResultV1; 2]> {
    let a = open_ml_dsa_role_input_v1(
        client.input(MlDsaRoleV1::A),
        client.binding(),
        MlDsaRoleV1::A,
        &secrets[0],
    )?;
    let b = open_ml_dsa_role_input_v1(
        client.input(MlDsaRoleV1::B),
        client.binding(),
        MlDsaRoleV1::B,
        &secrets[1],
    )?;
    let (_, reply_a) = a.into_parts();
    let (_, reply_b) = b.into_parts();
    let mut other_key = *public_key;
    if disagree {
        other_key[0] ^= 1;
    }
    Ok([
        reply_a.seal_result(&secrets[0], public_key)?,
        reply_b.seal_result(&secrets[1], &other_key)?,
    ])
}

pub(super) fn verify_rejections(first: &Value) -> InvestigationResult<Value> {
    let public_key: [u8; 1952] = hex::decode(
        first["role_a"]["public_key_hex"]
            .as_str()
            .ok_or("Missing public key.")?,
    )?
    .try_into()
    .map_err(|_| "Invalid public key length")?;
    let recorded: [u8; 32] = hex::decode(
        first["client_completion"]["manifest_digest_hex"]
            .as_str()
            .ok_or("Missing manifest.")?,
    )?
    .try_into()
    .map_err(|_| "Invalid manifest length")?;
    let HolderKeys { secrets, publics } = holder_keys()?;
    let operation = private_signing::fresh_operation_id()?;
    let expected = binding("ml-dsa-wallet-fixture", "near-key-1", operation, 7)?;
    let client = prepare_ml_dsa_custody_v1(
        &[0; 32],
        expected.clone(),
        publics,
        MlDsaKeyContinuityV1::Create,
    )?;
    let mut rejected = Vec::new();
    for (name, changed) in [
        (
            "wrong-wallet",
            binding("other-wallet", "near-key-1", operation, 7)?,
        ),
        (
            "wrong-key",
            binding("ml-dsa-wallet-fixture", "other-key", operation, 7)?,
        ),
        (
            "wrong-operation",
            binding(
                "ml-dsa-wallet-fixture",
                "near-key-1",
                private_signing::fresh_operation_id()?,
                7,
            )?,
        ),
        (
            "wrong-epoch",
            binding("ml-dsa-wallet-fixture", "near-key-1", operation, 8)?,
        ),
    ] {
        require(
            open_ml_dsa_role_input_v1(
                client.input(MlDsaRoleV1::A),
                &changed,
                MlDsaRoleV1::A,
                &secrets[0],
            )
            .is_err(),
            name,
        )?;
        rejected.push(name);
    }
    require(
        open_ml_dsa_role_input_v1(
            client.input(MlDsaRoleV1::A),
            &expected,
            MlDsaRoleV1::B,
            &secrets[0],
        )
        .is_err(),
        "Wrong holder role opened an input.",
    )?;
    rejected.push("wrong-role");
    require(
        open_ml_dsa_role_input_v1(
            client.input(MlDsaRoleV1::A),
            &expected,
            MlDsaRoleV1::A,
            &secrets[1],
        )
        .is_err(),
        "Wrong holder key opened an input.",
    )?;
    rejected.push("wrong-recipient");
    for truncate in [false, true] {
        let mut wire = serde_json::to_value(client.input(MlDsaRoleV1::A))?;
        let bytes = wire["ciphertext"]
            .as_array_mut()
            .ok_or("Missing ciphertext.")?;
        if truncate {
            bytes.pop();
        } else {
            bytes[0] = json!(bytes[0].as_u64().ok_or("Invalid ciphertext byte")? ^ 1);
        }
        let changed: SealedMlDsaRoleInputV1 = serde_json::from_value(wire)?;
        require(
            open_ml_dsa_role_input_v1(&changed, &expected, MlDsaRoleV1::A, &secrets[0]).is_err(),
            "Damaged ciphertext opened.",
        )?;
        rejected.push(if truncate {
            "truncated-input"
        } else {
            "altered-input"
        });
    }
    let replies = seal_results(&client, &secrets, &public_key, false)?;
    require(
        client.complete(&replies[1], &replies[0]).is_err(),
        "Swapped holder results were accepted.",
    )?;
    rejected.push("swapped-results");
    let later = prepare_ml_dsa_custody_v1(
        &[0; 32],
        expected.clone(),
        publics,
        MlDsaKeyContinuityV1::Create,
    )?;
    require(
        later.complete(&replies[0], &replies[1]).is_err(),
        "A fresh completion state accepted an old reply.",
    )?;
    rejected.push("results-from-previous-client-state");
    let mut wrong_manifest = recorded;
    wrong_manifest[0] ^= 1;
    let changed = prepare_ml_dsa_custody_v1(
        &[0; 32],
        expected.clone(),
        publics,
        MlDsaKeyContinuityV1::Recover {
            recorded_manifest_digest: wrong_manifest,
        },
    )?;
    let replies = seal_results(&changed, &secrets, &public_key, false)?;
    require(
        changed.complete(&replies[0], &replies[1]).is_err(),
        "Wrong manifest was accepted.",
    )?;
    rejected.push("wrong-recorded-manifest");
    let changed = prepare_ml_dsa_custody_v1(
        &[0; 32],
        expected,
        publics,
        MlDsaKeyContinuityV1::Recover {
            recorded_manifest_digest: recorded,
        },
    )?;
    let replies = seal_results(&changed, &secrets, &public_key, true)?;
    require(
        changed.complete(&replies[0], &replies[1]).is_err(),
        "Different holder keys were accepted.",
    )?;
    rejected.push("disagreeing-public-keys");
    let expected = binding("ml-dsa-wallet-fixture", "near-key-1", operation, 7)?;
    let recovering = fixture_custody(
        "zero",
        "ml-dsa-wallet-fixture",
        &MlDsaKeyContinuityV1::Recover {
            recorded_manifest_digest: recorded,
        },
    )?;
    require(
        recovering
            .prepare_ml_dsa65(expected.clone(), publics, MlDsaKeyContinuityV1::Create)
            .is_err(),
        "Recovery bypassed manifest continuity.",
    )?;
    rejected.push("recovery-with-create-continuity");
    let establishing = CeremonySeedHeldV1::establish("ml-dsa-wallet-fixture")
        .map_err(|error| error.message().to_string())?;
    require(
        establishing
            .prepare_ml_dsa65(
                expected.clone(),
                publics,
                MlDsaKeyContinuityV1::Recover {
                    recorded_manifest_digest: recorded,
                },
            )
            .is_err(),
        "Fresh custody admitted recovery continuity.",
    )?;
    rejected.push("establishment-with-recovery-continuity");
    let joined = fixture_custody(
        "zero",
        "other-custody-wallet",
        &MlDsaKeyContinuityV1::Create,
    )?;
    require(
        joined
            .prepare_ml_dsa65(expected, publics, MlDsaKeyContinuityV1::Create)
            .is_err(),
        "A custody wallet prepared another wallet's ML-DSA key.",
    )?;
    rejected.push("custody-wallet-mismatch");
    Ok(
        json!({"rejected_cases": rejected, "scope": "Public fixture delivery and completion checks. Actual threshold generation and signatures run in separate roles in every recovery case. These negative checks establish no Router authorization or durable replay guarantee."}),
    )
}

fn factor() -> FactorSealInputsV1 {
    FactorSealInputsV1 {
        envelope_id: "ml-dsa-fixture-envelope".into(),
        factor: WalletCustodyEnvelopeFactorV1::Passkey {
            rp_id: "wallet.example".into(),
            credential_id_b64u: Base64UrlUnpadded::encode_string(&[0x62; 32]),
            kek_version: PASSKEY_CUSTODY_KEK_VERSION_V1.into(),
        },
        wallet_auth_method_id: "ml-dsa-fixture-passkey".into(),
        factor_secret: Zeroizing::new(vec![0x61; 32]),
    }
}
fn nonce() -> InvestigationResult<[u8; 12]> {
    let mut nonce = [0; 12];
    getrandom::getrandom(&mut nonce)?;
    Ok(nonce)
}
fn fixture_custody(
    fixture: &str,
    wallet_id: &str,
    continuity: &MlDsaKeyContinuityV1,
) -> InvestigationResult<CeremonySeedHeldV1> {
    let seed = reference::fixture_bytes(fixture, 32)?;
    match continuity {
        MlDsaKeyContinuityV1::Create => {
            let factor = factor();
            let binding = PasskeyCustodyEnvelopeBindingV1 {
                wallet_id: wallet_id.into(),
                envelope_id: factor.envelope_id,
                factor: factor.factor,
                envelope_revision: 1,
                binding: PasskeyCustodySecretBindingV1::WalletCustodySeed {
                    derivation_scheme: WALLET_SEED_DERIVATION_SCHEME_V1.into(),
                },
                ownership: PasskeyCustodyEnvelopeOwnershipV1::MethodBound {
                    wallet_auth_method_id: factor.wallet_auth_method_id,
                },
            };
            let nonce = nonce()?;
            let sealed = seal_wallet_custody_seed_envelope_v1(
                &factor.factor_secret,
                &binding,
                &nonce,
                &seed,
            )?;
            Ok(CeremonySeedHeldV1::join_existing_custody(
                &factor.factor_secret,
                &binding,
                &nonce,
                &sealed.ciphertext,
                &sealed.aad_hash,
                &sealed.ciphertext_digest,
            )
            .map_err(|error| error.message().to_string())?)
        }
        MlDsaKeyContinuityV1::Recover { .. } => {
            let code = [0x71; 32];
            let manifest_kek = [0x72; 32];
            let key_id = derive_wallet_recovery_key_id_v1(wallet_id, &code)?;
            let wrap_nonce = nonce()?;
            let entry_nonce = nonce()?;
            let wrap = seal_wallet_recovery_manifest_kek_v1(
                &code,
                wallet_id,
                &key_id,
                &wrap_nonce,
                &manifest_kek,
            )?;
            let entry =
                seal_wallet_recovery_entry_v1(&manifest_kek, wallet_id, &entry_nonce, &seed)?;
            Ok(CeremonySeedHeldV1::recover_with_code(
                &code,
                RecoveryCustodyOpenInputsV1 {
                    wallet_id: wallet_id.into(),
                    wrap_nonce: wrap_nonce.to_vec(),
                    wrapped_manifest_kek: wrap.ciphertext,
                    wrap_aad_hash: wrap.aad_hash,
                    entry_nonce: entry_nonce.to_vec(),
                    wrapped_custody_seed: entry.ciphertext,
                    entry_aad_hash: entry.aad_hash,
                },
            )
            .map_err(|error| error.message().to_string())?)
        }
    }
}

pub(super) fn finish_ceremony(
    verified: MlDsaCeremonyVerifiedV1,
    recovering: bool,
    fresh_custody: bool,
) -> InvestigationResult<Value> {
    let completion = match (recovering, fresh_custody) {
        (true, false) => MlDsaCustodyCompletionV1::Recover {
            replacement_factor: factor(),
        },
        (false, true) => {
            let mut recovery_codes = Vec::new();
            for index in 0..10 {
                recovery_codes.push(wallet_custody_ceremony::ceremony::RecoveryCodeInputV1 {
                    code_bytes: Zeroizing::new(vec![0x80 + index; 32]),
                });
            }
            MlDsaCustodyCompletionV1::Establish {
                factor: factor(),
                recovery_codes,
            }
        }
        (false, false) => MlDsaCustodyCompletionV1::Join,
        (true, true) => return Err("Recovery cannot establish fresh custody.".into()),
    };
    let commit = verified
        .finish(completion)
        .map_err(|error| error.message().to_string())?;
    Ok(serde_json::to_value(commit)?)
}

/// Opens only disposable fixture custody after the threshold signature and ordinary-key export passed.
pub(super) fn verify_custody_export(
    completion: &Value,
    recovered: &Value,
    fixture: Option<&str>,
) -> InvestigationResult<Value> {
    let commit = &completion["custody_commit"];
    let envelope = match commit["custodyAction"].as_str() {
        Some("recovered") => &commit["replacement"],
        Some("established") => &commit["custody"],
        Some("joined") => return Ok(json!({"joined_without_custody_write": true})),
        _ => return Err("Unexpected custody action.".into()),
    };
    let binding: PasskeyCustodyEnvelopeBindingV1 = serde_json::from_str(
        envelope["envelopeBindingJson"]
            .as_str()
            .ok_or("Missing envelope binding")?,
    )?;
    let (seed, _) = open_wallet_custody_seed_envelope_v1(
        &factor().factor_secret,
        &binding,
        &decode_field(envelope, "envelopeNonceB64u")?,
        &decode_field(envelope, "sealedCustodySecretB64u")?,
        &decode_field(envelope, "envelopeAadHashB64u")?,
        &decode_field(envelope, "envelopeCiphertextDigestB64u")?,
    )?;
    if let Some(fixture) = fixture {
        require(
            seed.as_slice() == reference::fixture_bytes(fixture, 32)?,
            "Replacement factor changed the custody seed.",
        )?;
    }
    let key = &commit["key"];
    let digest = compute_ml_dsa65_application_binding_digest_v1(
        key["walletId"].as_str().ok_or("Missing wallet id")?,
        key["signingKeyId"].as_str().ok_or("Missing key id")?,
    )?;
    let root = signer_core::wallet_seed_derivation::derive_ml_dsa65_owner_root_from_seed_v1(
        &seed, &digest,
    )?;
    let mut input = b"seams/ml-dsa-65/canonical-seed/v1".to_vec();
    input.extend_from_slice(root.as_ref());
    let expected = crate::circuit_evidence::reference_shake256(&input, 32);
    require(
        recovered["public_test_seed_hex"] == hex::encode(expected),
        "Sealed custody seed differs from exported canonical seed.",
    )?;
    if commit["custodyAction"] == "established" {
        let wraps = envelope["recoveryManifestKekWraps"]
            .as_array()
            .ok_or("Missing recovery wraps")?;
        require(
            wraps.len() == 10,
            "Fresh custody did not seal ten recovery codes.",
        )?;
        for (index, wrap) in wraps.iter().enumerate() {
            let code = [0x80 + index as u8; 32];
            let recovered_wallet = signer_core::wallet_recovery_custody::open_wallet_custody_seed_with_recovery_code_v1(
                binding.wallet_id.as_str(), &code,
                &[signer_core::wallet_recovery_custody::WalletRecoveryManifestKekWrapV1 {
                    recovery_key_id: wrap["recoveryKeyId"].as_str().ok_or("Missing recovery id")?,
                    nonce: &decode_field(wrap, "nonceB64u")?, ciphertext: &decode_field(wrap, "ciphertextB64u")?,
                }], &decode_field(envelope, "recoveryEntryNonceB64u")?, &decode_field(envelope, "recoveryEntryCiphertextB64u")?,
            )?.ok_or("A fresh recovery code did not open the wallet")?;
            require(
                recovered_wallet.as_slice() == seed.as_slice(),
                "A recovery code opened a different seed.",
            )?;
        }
    }
    Ok(
        json!({"factor_envelope_reproduces_canonical_seed": true, "fresh_custody_ten_codes_checked": commit["custodyAction"] == "established", "checked_after_threshold_signing_and_authorized_export": true}),
    )
}

fn decode_field(value: &Value, field: &str) -> InvestigationResult<Vec<u8>> {
    Ok(Base64UrlUnpadded::decode_vec(
        value[field]
            .as_str()
            .ok_or_else(|| format!("Missing {field}"))?,
    )?)
}
