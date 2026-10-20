//! Disposable existing-custody client for the Gateway publication E2E.
use crate::{InvestigationResult, require};
use base64ct::{Base64UrlUnpadded, Encoding};
use ml_dsa::{Keypair, MlDsa65, SigningKey};
use serde::Deserialize;
use serde_json::json;
use signer_core::ml_dsa_custody::{
    MlDsaCeremonyBindingV1, MlDsaKeyContinuityV1, MlDsaRoleV1, SealedMlDsaRoleResultV1,
};
use signer_core::passkey_custody::{
    PASSKEY_CUSTODY_KEK_VERSION_V1, PasskeyCustodyEnvelopeBindingV1,
    PasskeyCustodyEnvelopeOwnershipV1, PasskeyCustodySecretBindingV1,
    WALLET_SEED_DERIVATION_SCHEME_V1, WalletCustodyEnvelopeFactorV1,
    seal_wallet_custody_seed_envelope_v1,
};
use signer_core::wallet_recovery_custody::{
    derive_wallet_recovery_key_id_v1, seal_wallet_recovery_entry_v1,
    seal_wallet_recovery_manifest_kek_v1,
};
use std::{
    fs,
    io::{self, BufRead, Write},
};
use wallet_custody_ceremony::ceremony::{CeremonySeedHeldV1, ml_dsa::MlDsaCustodyCompletionV1};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Source {
    wallet_id: String,
    wallet_auth_method_id: String,
    rp_id: String,
    credential_id_b64u: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    signing_key_id: String,
    operation: [u8; 32],
    epoch: u64,
    holder_public_keys: [[u8; 32]; 2],
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Replies {
    role_a: SealedMlDsaRoleResultV1,
    role_b: SealedMlDsaRoleResultV1,
}

fn b64(value: &[u8]) -> String {
    Base64UrlUnpadded::encode_string(value)
}
fn nonce() -> InvestigationResult<[u8; 12]> {
    let mut bytes = [0; 12];
    getrandom::getrandom(&mut bytes)?;
    Ok(bytes)
}

pub(super) fn run() -> InvestigationResult<bool> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("gateway-registration-client") {
        return Ok(false);
    }
    let source: Source =
        serde_json::from_slice(&fs::read(args.get(2).ok_or("Missing fixture source")?)?)?;
    let binding = PasskeyCustodyEnvelopeBindingV1 {
        wallet_id: source.wallet_id.clone(),
        envelope_id: "ml-dsa-gateway-envelope".into(),
        factor: WalletCustodyEnvelopeFactorV1::Passkey {
            rp_id: source.rp_id,
            credential_id_b64u: source.credential_id_b64u,
            kek_version: PASSKEY_CUSTODY_KEK_VERSION_V1.into(),
        },
        envelope_revision: 1,
        binding: PasskeyCustodySecretBindingV1::WalletCustodySeed {
            derivation_scheme: WALLET_SEED_DERIVATION_SCHEME_V1.into(),
        },
        ownership: PasskeyCustodyEnvelopeOwnershipV1::MethodBound {
            wallet_auth_method_id: source.wallet_auth_method_id,
        },
    };
    let envelope_nonce = nonce()?;
    let sealed =
        seal_wallet_custody_seed_envelope_v1(&[0x61; 32], &binding, &envelope_nonce, &[0; 32])?;
    let manifest_kek = [0x72; 32];
    let entry_nonce = nonce()?;
    let entry =
        seal_wallet_recovery_entry_v1(&manifest_kek, &source.wallet_id, &entry_nonce, &[0; 32])?;
    let mut wraps = Vec::new();
    for index in 0..10 {
        let code = [0x80 + index; 32];
        let id = derive_wallet_recovery_key_id_v1(&source.wallet_id, &code)?;
        let wrap_nonce = nonce()?;
        let wrap = seal_wallet_recovery_manifest_kek_v1(
            &code,
            &source.wallet_id,
            &id,
            &wrap_nonce,
            &manifest_kek,
        )?;
        wraps.push(json!({"recoveryKeyId":id,"nonceB64u":b64(&wrap_nonce),"ciphertextB64u":b64(&wrap.ciphertext),"aadHashB64u":b64(&wrap.aad_hash)}));
    }
    println!(
        "{}",
        json!({"ready":true,"envelope":{
        "binding":binding,"nonceB64u":b64(&envelope_nonce),"ciphertextB64u":b64(&sealed.ciphertext),
        "aadHashB64u":b64(&sealed.aad_hash),"ciphertextDigestB64u":b64(&sealed.ciphertext_digest)
    },"recovery":{"wraps":wraps,"entryNonceB64u":b64(&entry_nonce),"entryCiphertextB64u":b64(&entry.ciphertext),"entryAadHashB64u":b64(&entry.aad_hash)}})
    );
    io::stdout().flush()?;
    let mut lines = io::stdin().lock().lines();
    let input: Input = serde_json::from_str(&lines.next().ok_or("Missing Gateway preparation")??)?;
    let custody = CeremonySeedHeldV1::join_existing_custody(
        &[0x61; 32],
        &binding,
        &envelope_nonce,
        &sealed.ciphertext,
        &sealed.aad_hash,
        &sealed.ciphertext_digest,
    )
    .map_err(|error| error.message().to_owned())?;
    let context = MlDsaCeremonyBindingV1::new(
        source.wallet_id.clone(),
        input.signing_key_id.clone(),
        input.operation,
        input.epoch,
    )?;
    let prepared = custody
        .prepare_ml_dsa65(
            context,
            input.holder_public_keys,
            MlDsaKeyContinuityV1::Create,
        )
        .map_err(|error| error.message().to_owned())?;
    println!(
        "{}",
        json!({"inputs":{"a":prepared.input(MlDsaRoleV1::A),"b":prepared.input(MlDsaRoleV1::B)}})
    );
    io::stdout().flush()?;
    let replies: Replies = serde_json::from_str(&lines.next().ok_or("Missing Gateway replies")??)?;
    let verified = prepared
        .complete(&replies.role_a, &replies.role_b)
        .map_err(|error| error.message().to_owned())?;
    let application =
        signer_core::wallet_seed_derivation::compute_ml_dsa65_application_binding_digest_v1(
            &source.wallet_id,
            &input.signing_key_id,
        )?;
    let seed: [u8; 32] = crate::wallet_recovery_evidence::canonical_seed("zero", &application)?
        .try_into()
        .map_err(|_| "Invalid canonical seed")?;
    let ordinary = SigningKey::<MlDsa65>::from_seed(&seed.into())
        .verifying_key()
        .encode();
    require(
        verified.key().public_key().as_slice() == ordinary.as_slice(),
        "Gateway key differs from the ordinary wallet-derived FIPS key",
    )?;
    let commit = verified
        .finish(MlDsaCustodyCompletionV1::Join)
        .map_err(|error| error.message().to_owned())?;
    let public_key: [u8; 1952] = ordinary
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid public key")?;
    let tx = wasm_signer_worker::build_transaction_with_actions(
        "ml-dsa-gateway.testnet",
        "ml-dsa-recipient.testnet",
        9_007_199_254_740_993,
        &[0x42; 32],
        wasm_signer_worker::PublicKey::MlDsa65(Box::new(public_key)),
        vec![wasm_signer_worker::NearAction::Transfer {
            deposit: 1_000_000_000_000,
        }],
    )?;
    println!(
        "{}",
        json!({"commit":commit,"canonicalKeyVerified":true,"holderResultsAuthenticated":true,
        "unsignedTransactionBorshB64u":b64(&borsh::to_vec(&tx)?)})
    );
    Ok(true)
}
