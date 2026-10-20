//! Public codec for disposable enrollment E2E. This command never signs or broadcasts.
use crate::{InvestigationResult, require};
use base64ct::{Base64UrlUnpadded, Encoding};
use serde::Deserialize;
use serde_json::json;
use std::io::{self, BufRead, Write};
use wasm_signer_worker::{ActionParams, PublicKey, Signature, Transaction};

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Input {
    MlDsaTransfer {
        account_id: String,
        public_key_b64u: String,
    },
    Encode {
        account_id: String,
        signer_public_key: String,
        added_public_key: String,
        nonce: String,
        block_hash: String,
    },
    Finalize {
        unsigned_transaction_borsh_b64u: String,
        signature_b64u: String,
    },
}

pub(super) fn run() -> InvestigationResult<bool> {
    if std::env::args().nth(1).as_deref() != Some("near-enrollment-fixture") {
        return Ok(false);
    }
    for line in io::stdin().lock().lines() {
        let reply = match serde_json::from_str::<Input>(&line?)? {
            Input::MlDsaTransfer {
                account_id,
                public_key_b64u,
            } => {
                let public_key: [u8; 1952] = Base64UrlUnpadded::decode_vec(&public_key_b64u)?
                    .try_into()
                    .map_err(|_| "Invalid ML-DSA public key length")?;
                let tx = wasm_signer_worker::build_transaction_with_actions(
                    &account_id,
                    &account_id,
                    9,
                    &[0x42; 32],
                    PublicKey::MlDsa65(Box::new(public_key)),
                    vec![wasm_signer_worker::NearAction::Transfer { deposit: 1 }],
                )?;
                json!({"unsignedTransactionBorshB64u": Base64UrlUnpadded::encode_string(&borsh::to_vec(&tx)?)})
            }
            Input::Encode {
                account_id,
                signer_public_key,
                added_public_key,
                nonce,
                block_hash,
            } => {
                let signer: PublicKey = signer_public_key.parse()?;
                let added: PublicKey = added_public_key.parse()?;
                require(
                    matches!(signer, PublicKey::Ed25519(_)),
                    "Enrollment fixture requires an Ed25519 owner",
                )?;
                require(
                    matches!(added, PublicKey::MlDsa65(_)),
                    "Enrollment fixture requires a full ML-DSA key",
                )?;
                let parsed_nonce = nonce.parse::<u64>()?;
                require(
                    parsed_nonce.to_string() == nonce,
                    "Nonce must be canonical decimal",
                )?;
                let block = bs58::decode(block_hash).into_vec()?;
                let action = ActionParams::AddKey {
                    public_key: added_public_key,
                    access_key: r#"{"nonce":0,"permission":{"FullAccess":{}}}"#.into(),
                }
                .to_action()?;
                let tx = wasm_signer_worker::build_transaction_with_actions(
                    &account_id,
                    &account_id,
                    parsed_nonce,
                    &block,
                    signer,
                    vec![action],
                )?;
                json!({
                    "unsignedTransactionBorshB64u": Base64UrlUnpadded::encode_string(&borsh::to_vec(&tx)?),
                    "transactionHashB64u": Base64UrlUnpadded::encode_string(&tx.get_hash_and_size().0.0),
                })
            }
            Input::Finalize {
                unsigned_transaction_borsh_b64u,
                signature_b64u,
            } => {
                let tx: Transaction = borsh::from_slice(&Base64UrlUnpadded::decode_vec(
                    &unsigned_transaction_borsh_b64u,
                )?)?;
                let bytes: [u8; 64] = Base64UrlUnpadded::decode_vec(&signature_b64u)?
                    .try_into()
                    .map_err(|_| "Invalid Ed25519 fixture signature length")?;
                let hash = wasm_signer_worker::calculate_transaction_hash(&tx);
                let signed =
                    wasm_signer_worker::encode_signed_transaction(tx, Signature::Ed25519(bytes))?;
                json!({ "signedTransactionBorshB64u": Base64UrlUnpadded::encode_string(&signed), "transactionHash": hash })
            }
        };
        println!("{reply}");
        io::stdout().flush()?;
    }
    Ok(true)
}
