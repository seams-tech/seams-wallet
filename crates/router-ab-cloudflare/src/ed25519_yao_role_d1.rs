use std::{cell::RefCell, future::Future, rc::Rc};

use hpke_ng::Kem;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use worker::{D1DatabaseSession, D1SessionConstraint, D1Type, Env, SqlStorage, SqlStorageValue};
use zeroize::Zeroize;

use super::{PairYaoSessionRecordV1, YAO_RUNNING_LIFETIME_MS};
use crate::{
    encoding::{decode_base64url_bytes_v1, encode_base64url_bytes_v1},
    hpke::{
        parse_cloudflare_hpke_x25519_public_key_v1, CloudflareHpkeGetrandomRngV1,
        CloudflareHpkeKemV1, CloudflareHpkeSuiteV1,
    },
};

const ROLE_PRIVATE_D1_BINDING: &str = "DERIVER_ROLE_PRIVATE_DB";
const ROLE_PRIVATE_D1_KEK_BINDING_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_KEK_BINDING";
const ROLE_PRIVATE_D1_KEK_VERSION_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_KEK_VERSION";
const ROLE_PRIVATE_D1_KEK_PUBLIC_KEY_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_KEK_PUBLIC_KEY";
const ROLE_PRIVATE_D1_ENVIRONMENT_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_ENVIRONMENT";
const ROLE_PRIVATE_D1_ROLE_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_ROLE";
const ROLE_PRIVATE_D1_KEK_SECRET_PREFIX: &str = "hpke-x25519-role-private-d1-private-v1:";
const ROLE_PRIVATE_D1_HPKE_INFO: &[u8] = b"seams/deriver/role-private-d1/hpke/v1";
const ROLE_PRIVATE_D1_SCHEMA: &str = "deriver-role-private-d1/v1";
const DERIVER_A_WALLET_DO_SCHEMA: &str = "deriver-a-wallet-do/v1";
const DERIVER_B_WALLET_DO_SCHEMA: &str = "deriver-b-wallet-do/v1";
const ROLE_PRIVATE_D1_PURPOSE: &str = "yao-pair-lifecycle";
const LOAD_PAIR_SQL: &str =
    "SELECT ciphertext_json, revision FROM yao_pair_sessions WHERE session_hex = ?1";
const LOAD_WALLET_PAIR_SQL: &str = "SELECT ciphertext_json, revision, root_identity_digest_hex \
    FROM yao_pair_sessions WHERE session_hex = ?1";
const INSERT_PAIR_SQL: &str = "INSERT INTO yao_pair_sessions \
    (session_hex, pair_digest_hex, lifecycle, ciphertext_json, revision, expires_at_ms, updated_at_ms) \
    VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6) ON CONFLICT(session_hex) DO NOTHING";
/// Settles this role's root-use admission for a pair session whose record
/// just became terminal, in the same D1 batch as that write. A batch does not
/// stop when the write's compare-and-swap misses, so the settlement checks
/// that the session's row really is terminal.
const SETTLE_TERMINAL_PAIR_ADMISSION_SQL: &str = "UPDATE tenant_root_root_use_admissions \
    SET status = 'settled' WHERE role = ?1 AND attempt_kind = ?2 AND attempt_key_hex = ?3 \
    AND status = 'admitted' AND EXISTS (SELECT 1 FROM yao_pair_sessions \
    WHERE session_hex = ?3 AND lifecycle IN ('completed', 'burned', 'expired'))";
const UPDATE_PAIR_SQL: &str = "UPDATE yao_pair_sessions SET pair_digest_hex = ?2, \
    lifecycle = ?3, ciphertext_json = ?4, revision = revision + 1, expires_at_ms = ?5, \
    updated_at_ms = ?6 WHERE session_hex = ?1 AND revision = ?7";
const INSERT_WALLET_PAIR_SQL: &str = "INSERT INTO yao_pair_sessions \
    (session_hex, pair_digest_hex, lifecycle, ciphertext_json, revision, expires_at_ms, updated_at_ms, root_identity_digest_hex) \
    VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7) ON CONFLICT(session_hex) DO NOTHING \
    RETURNING session_hex";
const UPDATE_WALLET_PAIR_SQL: &str = "UPDATE yao_pair_sessions SET pair_digest_hex = ?2, \
    lifecycle = ?3, ciphertext_json = ?4, revision = revision + 1, expires_at_ms = ?5, \
    updated_at_ms = ?6 WHERE session_hex = ?1 AND revision = ?7 AND root_identity_digest_hex = ?8 \
    RETURNING session_hex";

#[derive(Deserialize)]
struct PairRowV1 {
    ciphertext_json: String,
    revision: i64,
}

#[derive(Deserialize)]
struct WalletPairRowV1 {
    ciphertext_json: String,
    revision: i64,
    root_identity_digest_hex: String,
}

#[derive(Deserialize)]
struct ChangedWalletPairRowV1 {
    #[serde(rename = "session_hex")]
    _session_hex: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RolePairRecordScopeV1 {
    pub(crate) signer_set_id: String,
    pub(crate) root_share_epoch: String,
    pub(crate) root_metadata_digest_hex: String,
}

#[derive(Clone)]
struct CachedPairV1 {
    record_json: String,
    revision: i64,
    scope: RolePairRecordScopeV1,
}

#[derive(Clone)]
struct PendingPairV1 {
    record_json: String,
    pair_digest_hex: String,
    lifecycle: &'static str,
    expires_at_ms: u64,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RolePairRoleV1 {
    DeriverA,
    DeriverB,
}

impl RolePairRoleV1 {
    const fn as_str(&self) -> &'static str {
        match self {
            Self::DeriverA => "deriver_a",
            Self::DeriverB => "deriver_b",
        }
    }

    fn parse(value: &str) -> worker::Result<Self> {
        match value {
            "deriver_a" => Ok(Self::DeriverA),
            "deriver_b" => Ok(Self::DeriverB),
            _ => Err(role_d1_error(
                "DERIVER_ROLE_PRIVATE_D1_ROLE must be deriver_a or deriver_b",
            )),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct RolePairAadV1<'a> {
    environment: &'a str,
    role: RolePairRoleV1,
    signer_set_id: &'a str,
    root_share_epoch: &'a str,
    root_metadata_digest_hex: &'a str,
    purpose: &'static str,
    schema: &'static str,
    identity: &'a str,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RolePairCiphertextV1 {
    key_version: String,
    signer_set_id: String,
    root_share_epoch: String,
    root_metadata_digest_hex: String,
    ciphertext_b64u: String,
}

pub(crate) struct RolePairCipherV1 {
    environment: String,
    role: RolePairRoleV1,
    key_version: String,
    public_key: <CloudflareHpkeKemV1 as Kem>::PublicKey,
    private_key: <CloudflareHpkeKemV1 as Kem>::PrivateKey,
    schema: &'static str,
}

pub(crate) struct OpenedRolePairRecordV1 {
    pub(crate) record_json: String,
    pub(crate) scope: RolePairRecordScopeV1,
}

impl RolePairCipherV1 {
    fn from_env(env: &Env) -> worker::Result<Self> {
        Self::from_env_with_schema(env, ROLE_PRIVATE_D1_SCHEMA)
    }

    pub(crate) fn from_env_for_wallet_do(env: &Env) -> worker::Result<Self> {
        let cipher = Self::from_env_with_schema(env, DERIVER_A_WALLET_DO_SCHEMA)?;
        if cipher.role != RolePairRoleV1::DeriverA {
            return Err(role_d1_error(
                "Deriver A wallet DO requires the Deriver A role key",
            ));
        }
        Ok(cipher)
    }

    pub(crate) fn from_env_for_deriver_b_wallet_do(env: &Env) -> worker::Result<Self> {
        let cipher = Self::from_env_with_schema(env, DERIVER_B_WALLET_DO_SCHEMA)?;
        if cipher.role != RolePairRoleV1::DeriverB {
            return Err(role_d1_error(
                "Deriver B wallet DO requires the Deriver B role key",
            ));
        }
        Ok(cipher)
    }

    fn from_env_with_schema(env: &Env, schema: &'static str) -> worker::Result<Self> {
        let environment = required_env_var(env, ROLE_PRIVATE_D1_ENVIRONMENT_ENV)?;
        let role = RolePairRoleV1::parse(&required_env_var(env, ROLE_PRIVATE_D1_ROLE_ENV)?)?;
        let key_version = required_env_var(env, ROLE_PRIVATE_D1_KEK_VERSION_ENV)?;
        let public_key = parse_cloudflare_hpke_x25519_public_key_v1(&required_env_var(
            env,
            ROLE_PRIVATE_D1_KEK_PUBLIC_KEY_ENV,
        )?)
        .map_err(|error| role_d1_error(error.message()))?;
        let secret_binding = required_env_var(env, ROLE_PRIVATE_D1_KEK_BINDING_ENV)?;
        let secret = env.secret(&secret_binding).map_err(|error| {
            role_d1_error(format!(
                "role-private D1 KEK Secret binding {secret_binding} is unavailable: {error}"
            ))
        })?;
        let mut encoded_private_key = secret.to_string();
        let mut private_key_bytes = decode_role_private_d1_private_key(&encoded_private_key)?;
        encoded_private_key.zeroize();
        let private_key = CloudflareHpkeKemV1::sk_from_bytes(&private_key_bytes)
            .map_err(|error| role_d1_error(format!("role-private D1 KEK is invalid: {error}")))?;
        private_key_bytes.zeroize();
        Ok(Self {
            environment,
            role,
            key_version,
            public_key,
            private_key,
            schema,
        })
    }

    pub(crate) fn seal(
        &self,
        identity: &str,
        scope: &RolePairRecordScopeV1,
        record_json: &str,
    ) -> worker::Result<String> {
        validate_scope(scope)?;
        let aad = self.aad(identity, scope)?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            ROLE_PRIVATE_D1_HPKE_INFO,
            &aad,
            record_json.as_bytes(),
        )
        .map_err(|error| {
            role_d1_error(format!(
                "role-private D1 lifecycle encryption failed: {error}"
            ))
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        serde_json::to_string(&RolePairCiphertextV1 {
            key_version: self.key_version.clone(),
            signer_set_id: scope.signer_set_id.clone(),
            root_share_epoch: scope.root_share_epoch.clone(),
            root_metadata_digest_hex: scope.root_metadata_digest_hex.clone(),
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            role_d1_error(format!(
                "role-private D1 ciphertext encoding failed: {error}"
            ))
        })
    }

    pub(crate) fn open(
        &self,
        identity: &str,
        encoded: &str,
    ) -> worker::Result<OpenedRolePairRecordV1> {
        let envelope: RolePairCiphertextV1 = serde_json::from_str(encoded).map_err(|error| {
            role_d1_error(format!(
                "role-private D1 ciphertext decoding failed: {error}"
            ))
        })?;
        if envelope.key_version != self.key_version {
            return Err(role_d1_error(
                "role-private D1 ciphertext key version is unavailable",
            ));
        }
        let scope = RolePairRecordScopeV1 {
            signer_set_id: envelope.signer_set_id,
            root_share_epoch: envelope.root_share_epoch,
            root_metadata_digest_hex: envelope.root_metadata_digest_hex,
        };
        validate_scope(&scope)?;
        let payload =
            decode_base64url_bytes_v1("role-private D1 ciphertext", &envelope.ciphertext_b64u)
                .map_err(|error| role_d1_error(error.message()))?;
        if payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN {
            return Err(role_d1_error("role-private D1 ciphertext is truncated"));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|error| {
            role_d1_error(format!(
                "role-private D1 encapsulated key is invalid: {error}"
            ))
        })?;
        let aad = self.aad(identity, &scope)?;
        let plaintext = CloudflareHpkeSuiteV1::open_base(
            &encapped_key,
            &self.private_key,
            ROLE_PRIVATE_D1_HPKE_INFO,
            &aad,
            ciphertext,
        )
        .map_err(|error| {
            role_d1_error(format!(
                "role-private D1 lifecycle decryption failed: {error}"
            ))
        })?;
        let record_json = String::from_utf8(plaintext)
            .map_err(|_| role_d1_error("role-private D1 plaintext is not UTF-8"))?;
        Ok(OpenedRolePairRecordV1 { record_json, scope })
    }

    fn aad(&self, identity: &str, scope: &RolePairRecordScopeV1) -> worker::Result<Vec<u8>> {
        serde_json::to_vec(&RolePairAadV1 {
            environment: &self.environment,
            role: self.role,
            signer_set_id: &scope.signer_set_id,
            root_share_epoch: &scope.root_share_epoch,
            root_metadata_digest_hex: &scope.root_metadata_digest_hex,
            purpose: ROLE_PRIVATE_D1_PURPOSE,
            schema: self.schema,
            identity,
        })
        .map_err(|error| role_d1_error(format!("role-private D1 AAD encoding failed: {error}")))
    }
}

fn required_env_var(env: &Env, name: &'static str) -> worker::Result<String> {
    let value = env
        .var(name)
        .map_err(|error| role_d1_error(format!("required env {name} is unavailable: {error}")))?
        .to_string();
    if value.trim().is_empty() {
        return Err(role_d1_error(format!("required env {name} is empty")));
    }
    Ok(value)
}

fn validate_scope(scope: &RolePairRecordScopeV1) -> worker::Result<()> {
    if scope.signer_set_id.trim().is_empty()
        || scope.root_share_epoch.trim().is_empty()
        || scope.root_metadata_digest_hex.len() != 64
        || !scope
            .root_metadata_digest_hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(role_d1_error(
            "role-private D1 lifecycle scope is malformed",
        ));
    }
    Ok(())
}

fn decode_role_private_d1_private_key(encoded: &str) -> worker::Result<[u8; 32]> {
    let hex = encoded
        .trim()
        .strip_prefix(ROLE_PRIVATE_D1_KEK_SECRET_PREFIX)
        .ok_or_else(|| {
            role_d1_error("role-private D1 KEK Secret has an unsupported encoding prefix")
        })?;
    if hex.len() != 64 {
        return Err(role_d1_error(
            "role-private D1 KEK Secret must contain 32 bytes",
        ));
    }
    let mut bytes = [0_u8; 32];
    for (index, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        bytes[index] = (decode_hex_nibble(chunk[0])? << 4) | decode_hex_nibble(chunk[1])?;
    }
    Ok(bytes)
}

fn decode_hex_nibble(byte: u8) -> worker::Result<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        _ => Err(role_d1_error(
            "role-private D1 KEK Secret must use lowercase hex",
        )),
    }
}

fn role_d1_error(message: impl Into<String>) -> worker::Error {
    worker::Error::RustError(message.into())
}

/// One request-scoped, primary-anchored view of a role-private Yao session row.
pub(super) struct RolePairD1StorageV1 {
    backend: RolePairStorageBackendV1,
    session_hex: String,
    record_identity: String,
    root_identity_digest_hex: Option<String>,
    cipher: RolePairCipherV1,
    creation_scope: RefCell<Option<RolePairRecordScopeV1>>,
    cached: RefCell<Option<Option<CachedPairV1>>>,
}

enum RolePairStorageBackendV1 {
    D1(D1DatabaseSession),
    WalletDo(SqlStorage),
}

impl RolePairD1StorageV1 {
    pub(super) fn from_env(env: &Env, session_id: [u8; 32]) -> worker::Result<Self> {
        let database = env.d1(ROLE_PRIVATE_D1_BINDING).map_err(|error| {
            worker::Error::RustError(format!(
                "role-private D1 binding {ROLE_PRIVATE_D1_BINDING} is unavailable: {error}"
            ))
        })?;
        let session = database
            .with_session_constraint(D1SessionConstraint::FirstPrimary)
            .map_err(|error| {
                worker::Error::RustError(format!(
                    "role-private D1 primary session could not be created: {error}"
                ))
            })?;
        let session_hex = encode_hex(session_id);
        Ok(Self {
            backend: RolePairStorageBackendV1::D1(session),
            record_identity: session_hex.clone(),
            session_hex,
            root_identity_digest_hex: None,
            cipher: RolePairCipherV1::from_env(env)?,
            creation_scope: RefCell::new(None),
            cached: RefCell::new(None),
        })
    }

    pub(super) fn from_deriver_b_wallet_do(
        env: &Env,
        sql: SqlStorage,
        session_id: [u8; 32],
        object_name: &str,
        root_identity_digest_hex: &str,
    ) -> worker::Result<Self> {
        let session_hex = encode_hex(session_id);
        Ok(Self {
            backend: RolePairStorageBackendV1::WalletDo(sql),
            record_identity: format!("{object_name}:{root_identity_digest_hex}:{session_hex}"),
            session_hex,
            root_identity_digest_hex: Some(root_identity_digest_hex.to_owned()),
            cipher: RolePairCipherV1::from_env_for_deriver_b_wallet_do(env)?,
            creation_scope: RefCell::new(None),
            cached: RefCell::new(None),
        })
    }

    pub(super) fn bind_creation_scope(
        &self,
        signer_set_id: &str,
        root_share_epoch: &str,
        root_metadata_digest: [u8; 32],
    ) -> worker::Result<()> {
        let scope = RolePairRecordScopeV1 {
            signer_set_id: signer_set_id.to_owned(),
            root_share_epoch: root_share_epoch.to_owned(),
            root_metadata_digest_hex: encode_hex(root_metadata_digest),
        };
        validate_scope(&scope)?;
        self.creation_scope.replace(Some(scope));
        Ok(())
    }

    pub(super) async fn get<T: DeserializeOwned>(&self, _key: &str) -> worker::Result<Option<T>> {
        let row = self.load().await?;
        row.map(|row| {
            serde_json::from_str(&row.record_json).map_err(|error| {
                worker::Error::RustError(format!(
                    "role-private D1 Yao record is malformed: {error}"
                ))
            })
        })
        .transpose()
    }

    pub(super) async fn transaction<F, Fut>(&self, closure: F) -> worker::Result<()>
    where
        F: FnOnce(RolePairD1TransactionV1) -> Fut,
        Fut: Future<Output = worker::Result<()>>,
    {
        let initial = self.load().await?;
        let pending = Rc::new(RefCell::new(None));
        closure(RolePairD1TransactionV1 {
            initial: initial.clone(),
            pending: Rc::clone(&pending),
        })
        .await?;
        let pending = pending.borrow_mut().take();
        if let Some(pending) = pending {
            self.persist_from(initial, pending).await?;
        }
        Ok(())
    }

    async fn load(&self) -> worker::Result<Option<CachedPairV1>> {
        if let Some(cached) = self.cached.borrow().clone() {
            return Ok(cached);
        }
        let row = match &self.backend {
            RolePairStorageBackendV1::D1(session) => {
                let statement = session
                    .prepare(LOAD_PAIR_SQL)
                    .bind_refs([D1Type::Text(self.session_hex.as_str())].iter())?;
                statement.first::<PairRowV1>(None).await?
            }
            RolePairStorageBackendV1::WalletDo(sql) => {
                let rows = sql
                    .exec(
                        LOAD_WALLET_PAIR_SQL,
                        vec![SqlStorageValue::String(self.session_hex.clone())],
                    )?
                    .to_array::<WalletPairRowV1>()?;
                if rows.len() > 1 {
                    return Err(role_d1_error(
                        "Deriver B wallet pair selection is ambiguous",
                    ));
                }
                rows.into_iter()
                    .next()
                    .map(|row| {
                        if self.root_identity_digest_hex.as_deref()
                            != Some(row.root_identity_digest_hex.as_str())
                        {
                            return Err(role_d1_error(
                                "Deriver B wallet pair root identity changed",
                            ));
                        }
                        Ok(PairRowV1 {
                            ciphertext_json: row.ciphertext_json,
                            revision: row.revision,
                        })
                    })
                    .transpose()?
            }
        };
        let row = row
            .map(|row| {
                self.cipher
                    .open(&self.record_identity, &row.ciphertext_json)
                    .map(|opened| CachedPairV1 {
                        record_json: opened.record_json,
                        revision: row.revision,
                        scope: opened.scope,
                    })
            })
            .transpose()?;
        self.cached.replace(Some(row.clone()));
        Ok(row)
    }

    async fn persist_from(
        &self,
        initial: Option<CachedPairV1>,
        pending: PendingPairV1,
    ) -> worker::Result<()> {
        let scope = initial
            .as_ref()
            .map(|row| row.scope.clone())
            .or_else(|| self.creation_scope.borrow().clone())
            .ok_or_else(|| {
                role_d1_error("role-private D1 initial lifecycle scope is unavailable")
            })?;
        validate_pending_scope(&pending.record_json, &scope)?;
        let ciphertext_json =
            self.cipher
                .seal(&self.record_identity, &scope, &pending.record_json)?;
        let expires_at_ms = pending.expires_at_ms.to_string();
        let updated_at_ms = pending.updated_at_ms.to_string();
        // A terminal record ends the attempt at this role, so the same D1
        // batch settles its root-use admission. The wallet object's pair rows
        // live in another database; admissions it leaves are cancelled by
        // retirement recovery instead.
        let terminal = matches!(pending.lifecycle, "completed" | "burned" | "expired");
        let changes = match (&self.backend, &initial) {
            (RolePairStorageBackendV1::D1(session), initial) => {
                let revision_text = initial.as_ref().map(|current| current.revision.to_string());
                let write = match &revision_text {
                    None => session.prepare(INSERT_PAIR_SQL).bind_refs(
                        [
                            D1Type::Text(self.session_hex.as_str()),
                            D1Type::Text(pending.pair_digest_hex.as_str()),
                            D1Type::Text(pending.lifecycle),
                            D1Type::Text(ciphertext_json.as_str()),
                            D1Type::Text(expires_at_ms.as_str()),
                            D1Type::Text(updated_at_ms.as_str()),
                        ]
                        .iter(),
                    )?,
                    Some(revision_text) => session.prepare(UPDATE_PAIR_SQL).bind_refs(
                        [
                            D1Type::Text(self.session_hex.as_str()),
                            D1Type::Text(pending.pair_digest_hex.as_str()),
                            D1Type::Text(pending.lifecycle),
                            D1Type::Text(ciphertext_json.as_str()),
                            D1Type::Text(expires_at_ms.as_str()),
                            D1Type::Text(updated_at_ms.as_str()),
                            D1Type::Text(revision_text.as_str()),
                        ]
                        .iter(),
                    )?,
                };
                if terminal {
                    let settle = session.prepare(SETTLE_TERMINAL_PAIR_ADMISSION_SQL).bind_refs(
                        [
                            D1Type::Text(self.cipher.role.as_str()),
                            D1Type::Text(crate::TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1),
                            D1Type::Text(self.session_hex.as_str()),
                        ]
                        .iter(),
                    )?;
                    let results = session.batch(vec![write, settle]).await?;
                    results
                        .first()
                        .ok_or_else(|| role_d1_error("role-private Yao lifecycle batch returned no result"))?
                        .meta()?
                        .and_then(|meta| meta.changes)
                        .unwrap_or_default()
                } else {
                    write
                        .run()
                        .await?
                        .meta()?
                        .and_then(|meta| meta.changes)
                        .unwrap_or_default()
                }
            }
            (RolePairStorageBackendV1::WalletDo(sql), None) => sql
                .exec(
                    INSERT_WALLET_PAIR_SQL,
                    vec![
                        SqlStorageValue::String(self.session_hex.clone()),
                        SqlStorageValue::String(pending.pair_digest_hex.clone()),
                        SqlStorageValue::String(pending.lifecycle.to_owned()),
                        SqlStorageValue::String(ciphertext_json.clone()),
                        SqlStorageValue::String(expires_at_ms.clone()),
                        SqlStorageValue::String(updated_at_ms.clone()),
                        SqlStorageValue::String(
                            self.root_identity_digest_hex
                                .clone()
                                .ok_or_else(|| role_d1_error("wallet pair root is unavailable"))?,
                        ),
                    ],
                )?
                .to_array::<ChangedWalletPairRowV1>()?
                .len(),
            (RolePairStorageBackendV1::WalletDo(sql), Some(current)) => sql
                .exec(
                    UPDATE_WALLET_PAIR_SQL,
                    vec![
                        SqlStorageValue::String(self.session_hex.clone()),
                        SqlStorageValue::String(pending.pair_digest_hex.clone()),
                        SqlStorageValue::String(pending.lifecycle.to_owned()),
                        SqlStorageValue::String(ciphertext_json.clone()),
                        SqlStorageValue::String(expires_at_ms.clone()),
                        SqlStorageValue::String(updated_at_ms.clone()),
                        SqlStorageValue::String(current.revision.to_string()),
                        SqlStorageValue::String(
                            self.root_identity_digest_hex
                                .clone()
                                .ok_or_else(|| role_d1_error("wallet pair root is unavailable"))?,
                        ),
                    ],
                )?
                .to_array::<ChangedWalletPairRowV1>()?
                .len(),
        };
        if changes != 1 {
            let phase = if initial.is_some() {
                "update"
            } else {
                "insert"
            };
            return Err(role_d1_error(format!(
                "role-private Yao lifecycle {phase} conflict (rows written: {changes})"
            )));
        }
        let next_revision = initial
            .as_ref()
            .map_or(1, |row| row.revision.saturating_add(1));
        self.cached.replace(Some(Some(CachedPairV1 {
            record_json: pending.record_json,
            revision: next_revision,
            scope,
        })));
        Ok(())
    }
}

pub(super) struct RolePairD1TransactionV1 {
    initial: Option<CachedPairV1>,
    pending: Rc<RefCell<Option<PendingPairV1>>>,
}

impl RolePairD1TransactionV1 {
    pub(super) async fn get<T: DeserializeOwned>(&self, _key: &str) -> worker::Result<T> {
        let row = self
            .initial
            .as_ref()
            .ok_or_else(|| worker::Error::JsError("No such value in storage.".to_owned()))?;
        serde_json::from_str(&row.record_json).map_err(|error| {
            worker::Error::RustError(format!("role-private D1 Yao record is malformed: {error}"))
        })
    }

    pub(super) async fn put(
        &self,
        _key: &str,
        value: PairYaoSessionRecordV1,
    ) -> worker::Result<()> {
        self.pending.replace(Some(pending_pair(value)?));
        Ok(())
    }
}

fn pending_pair(value: PairYaoSessionRecordV1) -> worker::Result<PendingPairV1> {
    let lifecycle = match &value {
        PairYaoSessionRecordV1::Prepared { .. } => "prepared",
        PairYaoSessionRecordV1::Running { .. } => "running",
        PairYaoSessionRecordV1::Completed { .. } => "completed",
        PairYaoSessionRecordV1::Burned { .. } => "burned",
        PairYaoSessionRecordV1::Expired { .. } => "expired",
    };
    let expires_at_ms = match &value {
        PairYaoSessionRecordV1::Prepared { expires_at_ms, .. } => *expires_at_ms,
        PairYaoSessionRecordV1::Running { started_at_ms, .. } => {
            started_at_ms.saturating_add(YAO_RUNNING_LIFETIME_MS)
        }
        PairYaoSessionRecordV1::Completed { .. }
        | PairYaoSessionRecordV1::Burned { .. }
        | PairYaoSessionRecordV1::Expired { .. } => 0,
    };
    let updated_at_ms = super::cloudflare_yao_now_unix_ms()?;
    Ok(PendingPairV1 {
        record_json: serde_json::to_string(&value).map_err(|error| {
            worker::Error::RustError(format!(
                "role-private D1 Yao record encoding failed: {error}"
            ))
        })?,
        pair_digest_hex: encode_hex(value.pair_digest()),
        lifecycle,
        expires_at_ms,
        updated_at_ms,
    })
}

fn validate_pending_scope(record_json: &str, scope: &RolePairRecordScopeV1) -> worker::Result<()> {
    let record: PairYaoSessionRecordV1 = serde_json::from_str(record_json).map_err(|error| {
        role_d1_error(format!(
            "role-private D1 Yao record scope validation failed: {error}"
        ))
    })?;
    let record_root_metadata_digest = match record {
        PairYaoSessionRecordV1::Prepared {
            root_metadata_digest,
            ..
        }
        | PairYaoSessionRecordV1::Running {
            root_metadata_digest,
            ..
        }
        | PairYaoSessionRecordV1::Completed {
            root_metadata_digest,
            ..
        } => Some(root_metadata_digest),
        PairYaoSessionRecordV1::Burned { .. } | PairYaoSessionRecordV1::Expired { .. } => None,
    };
    if record_root_metadata_digest
        .map(encode_hex)
        .is_some_and(|digest| digest != scope.root_metadata_digest_hex)
    {
        return Err(role_d1_error(
            "role-private D1 lifecycle root metadata scope changed",
        ));
    }
    Ok(())
}

pub(crate) fn encode_hex(value: [u8; 32]) -> String {
    encode_hex_slice(&value)
}

pub(crate) fn encode_hex_slice(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(value.len() * 2);
    for byte in value {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cipher(role: RolePairRoleV1, seed: u8) -> RolePairCipherV1 {
        let (private_key, public_key) = CloudflareHpkeKemV1::derive_key_pair(&[seed; 32])
            .expect("test role-private D1 keypair derives");
        RolePairCipherV1 {
            environment: "test".to_owned(),
            role,
            key_version: "epoch-1".to_owned(),
            public_key,
            private_key,
            schema: ROLE_PRIVATE_D1_SCHEMA,
        }
    }

    #[test]
    fn role_private_d1_cipher_binds_role_key_and_scope() {
        let scope = RolePairRecordScopeV1 {
            signer_set_id: "signer-set-1".to_owned(),
            root_share_epoch: "root-epoch-1".to_owned(),
            root_metadata_digest_hex: encode_hex([0x33; 32]),
        };
        let cipher = test_cipher(RolePairRoleV1::DeriverA, 0x41);
        let ciphertext = cipher
            .seal("session-1", &scope, "{\"status\":\"prepared\"}")
            .expect("record encrypts");
        let opened = cipher
            .open("session-1", &ciphertext)
            .expect("record decrypts");
        assert_eq!(opened.record_json, "{\"status\":\"prepared\"}");
        assert_eq!(opened.scope, scope);
        assert!(cipher.open("session-2", &ciphertext).is_err());

        let wrong_role = test_cipher(RolePairRoleV1::DeriverB, 0x41);
        assert!(wrong_role.open("session-1", &ciphertext).is_err());

        let wrong_key = test_cipher(RolePairRoleV1::DeriverA, 0x42);
        assert!(wrong_key.open("session-1", &ciphertext).is_err());

        let do_cipher = RolePairCipherV1 {
            schema: DERIVER_A_WALLET_DO_SCHEMA,
            ..test_cipher(RolePairRoleV1::DeriverA, 0x41)
        };
        assert!(do_cipher.open("session-1", &ciphertext).is_err());
        let do_ciphertext = do_cipher
            .seal("session-1", &scope, "{\"status\":\"prepared\"}")
            .expect("DO record encrypts");
        assert!(cipher.open("session-1", &do_ciphertext).is_err());

        let mut envelope: RolePairCiphertextV1 =
            serde_json::from_str(&ciphertext).expect("ciphertext envelope decodes");
        envelope.root_share_epoch = "root-epoch-2".to_owned();
        let tampered = serde_json::to_string(&envelope).expect("tampered envelope encodes");
        assert!(cipher.open("session-1", &tampered).is_err());
    }
}
