//! The SigningWorker's at-rest cipher for its private state.
//!
//! It seals every private SigningWorker record under the role's key-encryption
//! key: the private D1 rows and the wallet Durable Object's rows on
//! Cloudflare, and the same wallet rows in a VM SigningWorker's role-private
//! SQLite file.

use super::*;
use crate::hpke::{
    parse_cloudflare_hpke_x25519_public_key_v1, CloudflareHpkeGetrandomRngV1, CloudflareHpkeKemV1,
    CloudflareHpkeSuiteV1,
};
use hpke_ng::Kem;
use serde::de::DeserializeOwned;

pub const SIGNING_WORKER_PRIVATE_D1_KEK_SECRET_V1: &str = "SIGNING_WORKER_PRIVATE_D1_KEK";
pub const SIGNING_WORKER_PRIVATE_D1_KEK_VERSION_ENV_V1: &str =
    "SIGNING_WORKER_PRIVATE_D1_KEK_VERSION";
pub const SIGNING_WORKER_PRIVATE_D1_KEK_PUBLIC_KEY_ENV_V1: &str =
    "SIGNING_WORKER_PRIVATE_D1_KEK_PUBLIC_KEY";
pub const SIGNING_WORKER_PRIVATE_D1_ENVIRONMENT_ENV_V1: &str =
    "SIGNING_WORKER_PRIVATE_D1_ENVIRONMENT";
const SIGNING_WORKER_PRIVATE_D1_HPKE_INFO_V1: &[u8] = b"seams/signing-worker/private-d1/hpke/v1";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
const SIGNING_WORKER_PRIVATE_D1_SCHEMA_LABEL_V1: &str = "signing-worker-private-d1/v1";
const SIGNING_WORKER_WALLET_DO_SCHEMA_LABEL_V1: &str = "signing-worker-wallet-do/v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SigningWorkerPrivateD1CiphertextV1 {
    key_version: String,
    ciphertext_b64u: String,
}

pub(crate) struct SigningWorkerPrivateD1CipherV1 {
    environment: String,
    schema: &'static str,
    key_version: String,
    public_key: <CloudflareHpkeKemV1 as Kem>::PublicKey,
    private_key: <CloudflareHpkeKemV1 as Kem>::PrivateKey,
}

impl SigningWorkerPrivateD1CipherV1 {
    /// The cipher for SigningWorker-private D1 rows.
    #[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
    pub(crate) fn for_private_d1(
        env: &(impl CloudflareEnvReaderV1 + CloudflareSecretReaderV1),
    ) -> RouterAbProtocolResult<Self> {
        Self::from_reader(env, SIGNING_WORKER_PRIVATE_D1_SCHEMA_LABEL_V1)
    }

    /// The cipher for SigningWorker wallet rows: the wallet Durable Object on
    /// Cloudflare, the role-private wallet store on a VM.
    pub(crate) fn for_wallet_do(
        env: &(impl CloudflareEnvReaderV1 + CloudflareSecretReaderV1),
    ) -> RouterAbProtocolResult<Self> {
        Self::from_reader(env, SIGNING_WORKER_WALLET_DO_SCHEMA_LABEL_V1)
    }

    fn from_reader(
        env: &(impl CloudflareEnvReaderV1 + CloudflareSecretReaderV1),
        schema: &'static str,
    ) -> RouterAbProtocolResult<Self> {
        let environment = required_config_v1(env, SIGNING_WORKER_PRIVATE_D1_ENVIRONMENT_ENV_V1)?;
        let key_version = required_config_v1(env, SIGNING_WORKER_PRIVATE_D1_KEK_VERSION_ENV_V1)?;
        let encoded_public_key =
            required_config_v1(env, SIGNING_WORKER_PRIVATE_D1_KEK_PUBLIC_KEY_ENV_V1)?;
        let public_key = parse_cloudflare_hpke_x25519_public_key_v1(&encoded_public_key)?;
        let encoded_private_key = env
            .secret_text(SIGNING_WORKER_PRIVATE_D1_KEK_SECRET_V1)
            .map_err(|error| {
                d1_error(format!(
                    "SigningWorker private D1 KEK secret is missing: {}",
                    error.message()
                ))
            })?;
        let mut private_key_bytes =
            decode_cloudflare_server_output_hpke_private_key_secret_v1(&encoded_private_key)?;
        let private_key_result = CloudflareHpkeKemV1::sk_from_bytes(&private_key_bytes)
            .map_err(|error| d1_error(format!("SigningWorker private D1 KEK is invalid: {error}")));
        private_key_bytes.zeroize();
        let private_key = private_key_result?;
        Ok(Self {
            environment,
            schema,
            key_version,
            public_key,
            private_key,
        })
    }

    pub(crate) fn seal<T: Serialize>(
        &self,
        purpose: &'static str,
        identity: &str,
        value: &T,
    ) -> RouterAbProtocolResult<String> {
        let mut plaintext = encode_json("SigningWorker private D1 secret", value)?;
        let aad = self.aad(purpose, identity);
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let sealed = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            SIGNING_WORKER_PRIVATE_D1_HPKE_INFO_V1,
            aad.as_bytes(),
            plaintext.as_bytes(),
        );
        plaintext.zeroize();
        let (encapped_key, ciphertext) = sealed.map_err(|error| {
            d1_error(format!(
                "SigningWorker private D1 secret encryption failed: {error}"
            ))
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        encode_json(
            "SigningWorker private D1 ciphertext",
            &SigningWorkerPrivateD1CiphertextV1 {
                key_version: self.key_version.clone(),
                ciphertext_b64u: encode_base64url_bytes_v1(&payload),
            },
        )
    }

    pub(crate) fn open<T: DeserializeOwned>(
        &self,
        purpose: &'static str,
        identity: &str,
        encoded: &str,
    ) -> RouterAbProtocolResult<T> {
        let envelope = decode_json::<SigningWorkerPrivateD1CiphertextV1>(
            "SigningWorker private D1 ciphertext",
            encoded,
        )?;
        if envelope.key_version != self.key_version {
            return Err(d1_error(
                "SigningWorker private D1 ciphertext key version is unavailable",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "SigningWorker private D1 ciphertext",
            &envelope.ciphertext_b64u,
        )?;
        if payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN {
            return Err(d1_error("SigningWorker private D1 ciphertext is truncated"));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|error| {
            d1_error(format!(
                "SigningWorker private D1 encapsulated key is invalid: {error}"
            ))
        })?;
        let aad = self.aad(purpose, identity);
        let plaintext = CloudflareHpkeSuiteV1::open_base(
            &encapped_key,
            &self.private_key,
            SIGNING_WORKER_PRIVATE_D1_HPKE_INFO_V1,
            aad.as_bytes(),
            ciphertext,
        )
        .map_err(|error| {
            d1_error(format!(
                "SigningWorker private D1 secret decryption failed: {error}"
            ))
        })?;
        let mut plaintext = String::from_utf8(plaintext)
            .map_err(|_| d1_error("SigningWorker private D1 plaintext is not UTF-8"))?;
        let decoded = decode_json("SigningWorker private D1 secret", &plaintext);
        plaintext.zeroize();
        decoded
    }

    fn aad(&self, purpose: &'static str, identity: &str) -> String {
        format!(
            "environment={};purpose={};schema={};identity={}",
            self.environment, purpose, self.schema, identity
        )
    }
}

fn required_config_v1(
    env: &impl CloudflareEnvReaderV1,
    name: &'static str,
) -> RouterAbProtocolResult<String> {
    let value = env.get_text(name)?.ok_or_else(|| {
        d1_error(format!(
            "SigningWorker private D1 config is missing: {name}"
        ))
    })?;
    require_non_empty(name, &value)?;
    Ok(value)
}

fn d1_error(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}

fn encode_json<T: Serialize>(label: &'static str, value: &T) -> RouterAbProtocolResult<String> {
    serde_json::to_string(value)
        .map_err(|error| d1_error(format!("{label} serialization failed: {error}")))
}

fn decode_json<T: DeserializeOwned>(label: &'static str, value: &str) -> RouterAbProtocolResult<T> {
    serde_json::from_str(value)
        .map_err(|error| d1_error(format!("{label} decoding failed: {error}")))
}
