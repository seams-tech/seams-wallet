//! SigningWorker wallet ECDSA state: activations, the presignature pool and
//! signing effects.
//!
//! On Cloudflare these rows live in the wallet's Durable Object, in its own
//! SQLite storage. A VM SigningWorker keeps the same rows in its role-private
//! SQLite file. Both run this code: a host supplies only the statement
//! executor and, where an operation must be atomic, the transaction around it.

use super::*;
use crate::ordinary_inactive_signer_material as linked;
use serde::de::DeserializeOwned;

/// One bound parameter of a wallet statement.
pub enum SigningWorkerWalletSqlValueV1 {
    /// A TEXT value.
    Text(String),
    /// An INTEGER value.
    Integer(i64),
}

/// Runs one SQLite statement for the wallet store and returns its rows, each
/// decoded from its columns by name.
pub trait SigningWorkerWalletSqlV1 {
    /// Runs `statement` with its `?` parameters bound in order.
    fn query<T: DeserializeOwned>(
        &self,
        statement: &str,
        params: Vec<SigningWorkerWalletSqlValueV1>,
    ) -> RouterAbProtocolResult<Vec<T>>;
}

const ECDSA_POOL_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_pool (
    pool_key TEXT PRIMARY KEY,
    owner_json TEXT NOT NULL,
    ciphertext_json TEXT NOT NULL,
    version INTEGER NOT NULL)";
const ECDSA_EFFECT_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_effects (
    operation_key TEXT PRIMARY KEY,
    authorization_key TEXT NOT NULL UNIQUE,
    owner_json TEXT NOT NULL,
    request_digest_hex TEXT NOT NULL,
    authorization_json TEXT NOT NULL,
    claimed_at_ms INTEGER NOT NULL,
    terminal_json TEXT,
    committed_at_ms INTEGER)";
const ECDSA_ACTIVATION_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_activations (
    material_key TEXT PRIMARY KEY,
    active_key TEXT NOT NULL UNIQUE,
    owner_json TEXT NOT NULL,
    ciphertext_json TEXT NOT NULL)";
/// Devices linked to this wallet: ECDSA material reserved from this
/// wallet's active material, then activated or revoked here. An active row
/// names its activation's key, where signing finds it.
const LINKED_ECDSA_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_linked_ecdsa (
    record_key TEXT PRIMARY KEY,
    active_key TEXT UNIQUE,
    owner_json TEXT NOT NULL,
    ciphertext_json TEXT NOT NULL)";
/// The wallet store's ECDSA tables.
pub(crate) const SIGNING_WORKER_WALLET_ECDSA_SCHEMA_V1: [&str; 4] = [
    ECDSA_POOL_SCHEMA,
    ECDSA_EFFECT_SCHEMA,
    ECDSA_ACTIVATION_SCHEMA,
    LINKED_ECDSA_SCHEMA,
];

/// The outcome of claiming one signing effect and consuming its presignature.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareSigningWorkerEcdsaClaimAndConsumeV1 {
    /// This request claimed the effect and consumed the presignature.
    Claimed {
        material: CloudflareSigningWorkerEcdsaPresignatureRecordV1,
    },
    /// The effect already completed; its stored terminal response.
    Replay { terminal_json: String },
    /// The effect was claimed by an earlier attempt that has not finished.
    InProgress,
    /// The presignature was burned before this effect could claim it.
    Burned,
}

/// The outcome of recording one signing effect's terminal response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CloudflareSigningWorkerTerminalResponseCommitV1 {
    /// This call recorded the terminal response.
    Committed,
    /// A terminal response was already recorded; the stored one.
    Replay { response_json: String },
}

/// Active SigningWorker state and its server-output material for one wallet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerWalletEcdsaActivationMaterialV1 {
    /// The active SigningWorker state.
    pub active: router_ab_core::ActiveSigningWorkerStateV1,
    /// The server-output material the state names.
    pub material: CloudflareServerOutputMaterialRecordV1,
}

#[derive(Deserialize)]
struct EcdsaPoolRowV1 {
    owner_json: String,
    ciphertext_json: String,
    version: i64,
}

#[derive(Deserialize)]
struct WrittenEcdsaPoolRowV1 {
    pool_key: String,
}

#[derive(Deserialize)]
struct EcdsaEffectRowV1 {
    operation_key: String,
    authorization_key: String,
    owner_json: String,
    request_digest_hex: String,
    authorization_json: String,
    terminal_json: Option<String>,
}

#[derive(Deserialize)]
struct WrittenEcdsaEffectRowV1 {
    operation_key: String,
}

#[derive(Deserialize)]
struct EcdsaActivationRowV1 {
    material_key: String,
    owner_json: String,
    ciphertext_json: String,
}

#[derive(Deserialize)]
struct EcdsaActivationKeyV1 {
    material_key: String,
}

#[derive(Deserialize)]
struct LinkedEcdsaRowV1 {
    record_key: String,
    owner_json: String,
    ciphertext_json: String,
}

#[derive(Deserialize)]
struct LinkedEcdsaKeyV1 {
    record_key: String,
}

/// One linked device's ECDSA reservation, and while it is active the
/// material its signing uses.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WalletLinkedEcdsaV1 {
    state: linked::EcdsaReservationStateV1,
    activation: Option<SigningWorkerWalletEcdsaActivationMaterialV1>,
}

/// This SigningWorker's server-output key. A linked device's source
/// contribution is sealed to it, and so is the share reserved for that
/// device.
pub struct SigningWorkerServerOutputKeyV1 {
    binding: CloudflareServerOutputHpkeDecryptKeyBindingV1,
    private_key: zeroize::Zeroizing<[u8; 32]>,
}

impl SigningWorkerServerOutputKeyV1 {
    /// Loads the key the role's bindings name from its Secrets.
    pub fn load(
        runtime: &CloudflareSigningWorkerRuntimeV1,
        secrets: &impl CloudflareSecretReaderV1,
    ) -> RouterAbProtocolResult<Self> {
        let binding = runtime.server_output_decrypt_key().clone();
        binding.validate_visible_to(CloudflareWorkerRoleV1::SigningWorker)?;
        let secret = secrets.secret_text(&binding.binding_name)?;
        let private_key = zeroize::Zeroizing::new(
            crate::decode_cloudflare_server_output_hpke_private_key_secret_v1(&secret)?,
        );
        Ok(Self {
            binding,
            private_key,
        })
    }

    /// This SigningWorker, under the id an activation names it by.
    fn server(&self, server_id: &str) -> RouterAbProtocolResult<router_ab_core::ServerIdentityV1> {
        router_ab_core::ServerIdentityV1::new(
            server_id,
            self.binding.key_epoch.clone(),
            self.binding.public_key.clone(),
        )
    }
}

/// One wallet store session over a host's SQLite executor.
pub struct SigningWorkerWalletEcdsaStoreV1<'a, Sql> {
    sql: &'a Sql,
    cipher: SigningWorkerPrivateD1CipherV1,
}

impl<'a, Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'a, Sql> {
    /// Opens the store with the role's wallet cipher.
    pub fn open(
        sql: &'a Sql,
        env: &(impl CloudflareEnvReaderV1 + CloudflareSecretReaderV1),
    ) -> RouterAbProtocolResult<Self> {
        Ok(Self {
            sql,
            cipher: SigningWorkerPrivateD1CipherV1::for_wallet_do(env)?,
        })
    }

    /// Creates the ECDSA tables if they are missing.
    pub fn ensure_schema(&self) -> RouterAbProtocolResult<()> {
        for schema in SIGNING_WORKER_WALLET_ECDSA_SCHEMA_V1 {
            self.sql
                .query::<serde::de::IgnoredAny>(schema, Vec::new())?;
        }
        Ok(())
    }

    /// Stores one wallet's activated SigningWorker material. An exact replay
    /// returns the stored activation; different material for the same
    /// activation is refused.
    pub fn activate(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        activation: CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
        material: CloudflareServerOutputMaterialRecordV1,
        activated_at_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerOutputActivationReceiptV1> {
        scope.validate()?;
        activation.validate()?;
        material.validate()?;
        if activation.activation_context.lifecycle.account_id != scope.wallet_id {
            return Err(wallet_error("ECDSA activation wallet owner changed"));
        }
        crate::require_positive_ms("ECDSA activation time", activated_at_ms)?;
        let call = CloudflareSigningWorkerPrivateD1RequestV1::OutputActivate {
            activation: activation.clone(),
            material: material.clone(),
            activated_at_ms,
        };
        call.validate()?;
        let material_key = call.storage_key();
        let active_key = call.active_state_index_key()?;
        let active = crate::cloudflare_active_signing_worker_state_from_activation_request_v1(
            &activation,
            activation.material_activation.clone(),
            material_key.clone(),
            activated_at_ms,
        )?;
        let candidate = CloudflareSigningWorkerOutputActivationRecordV1::new(
            activation.clone(),
            active,
            material,
        )?;
        let owner_json = owner_json(&scope, "ECDSA activation")?;
        let ciphertext = self.cipher.seal(
            "ecdsa_activation",
            &wallet_row_identity(&scope, &material_key)?,
            &candidate,
        )?;
        let written = self.sql.query::<EcdsaActivationKeyV1>(
            "INSERT INTO wallet_ecdsa_activations
             (material_key, active_key, owner_json, ciphertext_json)
             VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING material_key",
            vec![
                text(material_key.clone()),
                text(active_key),
                text(owner_json),
                text(ciphertext),
            ],
        )?;
        let stored = if written.len() == 1 && written[0].material_key == material_key {
            candidate
        } else {
            let stored = self
                .read_activation(&scope, ActivationColumnV1::MaterialKey, &material_key)?
                .ok_or_else(|| wallet_error("ECDSA activation write is uncertain"))?;
            if !stored.matches_activation_and_material(&candidate) {
                return Err(replay_error(
                    "ECDSA activation conflicts with stored material",
                ));
            }
            stored
        };
        let context = &activation.activation_context;
        CloudflareSigningWorkerOutputActivationReceiptV1::new(
            context.lifecycle().lifecycle_id.clone(),
            context.signer_set().selected_server.server_id.clone(),
            context.transcript_digest(),
            stored.active_signing_worker_state().clone(),
            true,
        )
    }

    /// Loads one wallet's active SigningWorker state and material.
    pub fn load_activation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        lookup: &CloudflareActiveSigningWorkerStateLookupV1,
    ) -> RouterAbProtocolResult<SigningWorkerWalletEcdsaActivationMaterialV1> {
        scope.validate()?;
        lookup.validate()?;
        if lookup.account_id != scope.wallet_id {
            return Err(wallet_error("ECDSA activation lookup wallet owner changed"));
        }
        let key = format!(
            "active-signing-worker/{}/{}/{}",
            lookup.account_id, lookup.material_activation_id, lookup.signing_worker_id,
        );
        let Some(stored) = self.read_activation(scope, ActivationColumnV1::ActiveKey, &key)? else {
            return self.load_linked_activation(scope, lookup, &key);
        };
        lookup.validate_active_state(stored.active_signing_worker_state())?;
        Ok(SigningWorkerWalletEcdsaActivationMaterialV1 {
            active: stored.active_signing_worker_state().clone(),
            material: stored.material().clone(),
        })
    }

    /// Loads the active material one normal-signing scope names, for the
    /// wallet that owns it. A VM SigningWorker serves registration-activated
    /// material; lane material is not stored here.
    pub fn load_normal_signing_material(
        &self,
        wallet_scope: &CloudflareSigningWorkerWalletScopeV1,
        scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
        source: &CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    ) -> RouterAbProtocolResult<(
        router_ab_core::ActiveSigningWorkerStateV1,
        CloudflareServerOutputMaterialRecordV1,
    )> {
        source.validate_for_ecdsa_scope(scope)?;
        if !matches!(
            source,
            CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation { .. }
        ) {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "the wallet store holds registration-activated ECDSA material only",
            ));
        }
        self.load_activated_material(wallet_scope, scope)
    }

    /// Loads the registration-activated material for one normal-signing scope.
    pub fn load_activated_material(
        &self,
        wallet_scope: &CloudflareSigningWorkerWalletScopeV1,
        scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    ) -> RouterAbProtocolResult<(
        router_ab_core::ActiveSigningWorkerStateV1,
        CloudflareServerOutputMaterialRecordV1,
    )> {
        if wallet_scope.wallet_id != scope.wallet_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA activation wallet scope differs from signing scope",
            ));
        }
        let lookup = CloudflareActiveSigningWorkerStateLookupV1::from_router_ab_ecdsa_derivation_normal_signing_scope(scope)?;
        let loaded = self.load_activation(wallet_scope, &lookup)?;
        crate::validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1(
            scope,
            &loaded.active,
            &loaded.material,
        )?;
        Ok((loaded.active, loaded.material))
    }

    fn read_activation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        column: ActivationColumnV1,
        key: &str,
    ) -> RouterAbProtocolResult<Option<CloudflareSigningWorkerOutputActivationRecordV1>> {
        let query = match column {
            ActivationColumnV1::MaterialKey => "SELECT material_key, owner_json, ciphertext_json FROM wallet_ecdsa_activations WHERE material_key = ?",
            ActivationColumnV1::ActiveKey => "SELECT material_key, owner_json, ciphertext_json FROM wallet_ecdsa_activations WHERE active_key = ?",
        };
        let rows = self
            .sql
            .query::<EcdsaActivationRowV1>(query, vec![text(key.to_owned())])?;
        let [row] = rows.as_slice() else {
            return if rows.is_empty() {
                Ok(None)
            } else {
                Err(wallet_error(
                    "ECDSA activation lookup returned duplicate rows",
                ))
            };
        };
        if row.owner_json != owner_json(scope, "ECDSA activation")? {
            return Err(wallet_error("ECDSA activation owner conflict"));
        }
        let record: CloudflareSigningWorkerOutputActivationRecordV1 = self.cipher.open(
            "ecdsa_activation",
            &wallet_row_identity(scope, &row.material_key)?,
            &row.ciphertext_json,
        )?;
        record.validate()?;
        Ok(Some(record))
    }

    /// Applies one presignature-pool command to the wallet's pool.
    pub fn mutate_pool(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        command: CloudflareSigningWorkerEcdsaPoolCommandV1,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1> {
        scope.validate()?;
        command.validate()?;
        if scope.wallet_id != command.scope().wallet_id {
            return Err(wallet_error(
                "SigningWorker ECDSA pool wallet scope changed",
            ));
        }
        let key = CloudflareSigningWorkerPrivateD1RequestV1::EcdsaPoolMutate {
            command: command.clone(),
        }
        .storage_key();
        let owner_json = owner_json(&scope, "ECDSA pool")?;
        let rows = self.sql.query::<EcdsaPoolRowV1>(
            "SELECT owner_json, ciphertext_json, version FROM wallet_ecdsa_pool WHERE pool_key = ?",
            vec![text(key.clone())],
        )?;
        let current = match rows.as_slice() {
            [] => None,
            [row] => {
                if row.owner_json != owner_json {
                    return Err(wallet_error("ECDSA pool owner conflict"));
                }
                let record: CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1 = self.cipher.open(
                    "ecdsa_pool",
                    &wallet_row_identity(&scope, &key)?,
                    &row.ciphertext_json,
                )?;
                record.validate()?;
                Some(record)
            }
            _ => return Err(wallet_error("ECDSA pool lookup returned duplicate rows")),
        };
        let outcome = apply_cloudflare_signing_worker_ecdsa_pool_command_v1(current, command)?;
        outcome.validate()?;
        if matches!(
            outcome,
            CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Available { stored: false, .. }
        ) {
            return Ok(outcome);
        }
        let ciphertext = self.cipher.seal(
            "ecdsa_pool",
            &wallet_row_identity(&scope, &key)?,
            outcome.record(),
        )?;
        let written = match rows.as_slice() {
            [] => self.sql.query::<WrittenEcdsaPoolRowV1>(
                "INSERT INTO wallet_ecdsa_pool (pool_key, owner_json, ciphertext_json, version)
                 VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING RETURNING pool_key",
                vec![text(key.clone()), text(owner_json), text(ciphertext)],
            ),
            [row] => self.sql.query::<WrittenEcdsaPoolRowV1>(
                "UPDATE wallet_ecdsa_pool SET ciphertext_json = ?, version = version + 1
                 WHERE pool_key = ? AND owner_json = ? AND version = ? RETURNING pool_key",
                vec![
                    text(ciphertext),
                    text(key.clone()),
                    text(owner_json),
                    SigningWorkerWalletSqlValueV1::Integer(row.version),
                ],
            ),
            _ => unreachable!(),
        }?;
        if written.len() != 1 || written[0].pool_key != key {
            return Err(wallet_error("ECDSA pool write is uncertain"));
        }
        Ok(outcome)
    }

    /// Claims one signing effect and consumes the presignature it names.
    ///
    /// The host runs this inside one storage transaction, so the claim and
    /// the consumption commit together or not at all. A retry of a claimed
    /// effect never consumes another presignature: it returns the stored
    /// terminal response, or `InProgress` while the first attempt runs.
    pub fn claim_and_consume_effect(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaClaimAndConsumeV1> {
        validate_wallet_ecdsa_effect_scope_v1(&scope, &request)?;
        crate::require_positive_ms("SigningWorker ECDSA effect time", now_unix_ms)?;
        let operation_key = request.effect_operation_key()?;
        let authorization_key = request.effect_authorization_key()?;
        let request_digest_hex = digest_hex(request.effect_request_digest()?);
        let owner_json = owner_json(&scope, "ECDSA effect")?;
        let authorization_json = serde_json::to_string(&request.effect_claim).map_err(|error| {
            wallet_error(format!("ECDSA effect authorization is invalid: {error}"))
        })?;
        let existing = self.read_effects(&operation_key, Some(&authorization_key))?;
        if let [row] = existing.as_slice() {
            return ecdsa_effect_claim_outcome(
                row,
                &operation_key,
                &authorization_key,
                &owner_json,
                &request_digest_hex,
                &authorization_json,
            );
        }
        if !existing.is_empty() {
            return Err(wallet_error("ECDSA effect lookup returned duplicate rows"));
        }
        request.request.validate_at(now_unix_ms)?;
        // A linked device's revocation commits in this store too: once it
        // is revoked, no presignature is consumed for its material.
        self.require_linked_material_unrevoked(&scope, &request.request.scope.material_activation)?;
        let outcome = self.mutate_pool(
            scope,
            CloudflareSigningWorkerEcdsaPoolCommandV1::Consume {
                scope: request.request.scope.clone(),
                server_presignature_id: request.request.server_presignature_id.clone(),
                expected_revision: 1,
                request_digest: request.request.prepare_request_digest()?,
                now_unix_ms,
            },
        )?;
        let material = match outcome {
            CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Consumed { material, .. } => {
                material
            }
            CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Burned { .. } => {
                return Ok(CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Burned)
            }
            _ => {
                return Err(wallet_error(
                    "ECDSA consume returned the wrong lifecycle outcome",
                ))
            }
        };
        let inserted = self.sql.query::<WrittenEcdsaEffectRowV1>(
            "INSERT INTO wallet_ecdsa_effects
             (operation_key, authorization_key, owner_json, request_digest_hex,
              authorization_json, claimed_at_ms)
             VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING operation_key",
            vec![
                text(operation_key.clone()),
                text(authorization_key),
                text(owner_json),
                text(request_digest_hex),
                text(authorization_json),
                SigningWorkerWalletSqlValueV1::Integer(now_unix_ms.try_into().map_err(|_| {
                    wallet_error("ECDSA effect timestamp exceeds SQLite integer range")
                })?),
            ],
        )?;
        if inserted.len() != 1 || inserted[0].operation_key != operation_key {
            return Err(wallet_error("ECDSA effect claim is uncertain"));
        }
        Ok(CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Claimed { material })
    }

    /// Records one claimed effect's terminal response. A second call returns
    /// the response recorded first.
    pub fn commit_terminal(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        request: &CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
        response: &RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerTerminalResponseCommitV1> {
        validate_wallet_ecdsa_effect_scope_v1(scope, request)?;
        response.validate_for_request(&request.request)?;
        crate::require_positive_ms("SigningWorker ECDSA terminal time", now_unix_ms)?;
        let operation_key = request.effect_operation_key()?;
        let authorization_key = request.effect_authorization_key()?;
        let request_digest_hex = digest_hex(request.effect_request_digest()?);
        let owner_json = owner_json(scope, "ECDSA effect")?;
        let authorization_json = serde_json::to_string(&request.effect_claim).map_err(|error| {
            wallet_error(format!("ECDSA effect authorization is invalid: {error}"))
        })?;
        let existing = self.read_effects(&operation_key, None)?;
        let [row] = existing.as_slice() else {
            return Err(wallet_error("ECDSA terminal requires one claimed effect"));
        };
        validate_ecdsa_effect_row(
            row,
            &operation_key,
            &authorization_key,
            &owner_json,
            &request_digest_hex,
            &authorization_json,
        )?;
        if let Some(terminal_json) = &row.terminal_json {
            return Ok(CloudflareSigningWorkerTerminalResponseCommitV1::Replay {
                response_json: terminal_json.clone(),
            });
        }
        let response_json = serde_json::to_string(response)
            .map_err(|error| wallet_error(format!("ECDSA terminal is invalid: {error}")))?;
        let written = self.sql.query::<WrittenEcdsaEffectRowV1>(
            "UPDATE wallet_ecdsa_effects
             SET terminal_json = ?, committed_at_ms = ?
             WHERE operation_key = ? AND owner_json = ? AND request_digest_hex = ?
               AND authorization_json = ? AND terminal_json IS NULL
             RETURNING operation_key",
            vec![
                text(response_json),
                SigningWorkerWalletSqlValueV1::Integer(now_unix_ms.try_into().map_err(|_| {
                    wallet_error("ECDSA terminal timestamp exceeds SQLite integer range")
                })?),
                text(operation_key.clone()),
                text(owner_json),
                text(request_digest_hex),
                text(authorization_json),
            ],
        )?;
        if written.len() == 1 && written[0].operation_key == operation_key {
            return Ok(CloudflareSigningWorkerTerminalResponseCommitV1::Committed);
        }
        Err(wallet_error("ECDSA terminal write is uncertain"))
    }

    fn read_effects(
        &self,
        operation_key: &str,
        authorization_key: Option<&str>,
    ) -> RouterAbProtocolResult<Vec<EcdsaEffectRowV1>> {
        match authorization_key {
            Some(authorization_key) => self.sql.query(
                "SELECT operation_key, authorization_key, owner_json, request_digest_hex,
                        authorization_json, terminal_json FROM wallet_ecdsa_effects
                 WHERE operation_key = ? OR authorization_key = ?",
                vec![
                    text(operation_key.to_owned()),
                    text(authorization_key.to_owned()),
                ],
            ),
            None => self.sql.query(
                "SELECT operation_key, authorization_key, owner_json, request_digest_hex,
                        authorization_json, terminal_json FROM wallet_ecdsa_effects
                 WHERE operation_key = ?",
                vec![text(operation_key.to_owned())],
            ),
        }
    }
}

/// Devices linked to the wallet: their ECDSA material is reserved from the
/// wallet's active material, activated and revoked in the same store, and
/// signing and presignature consumption find it there.
impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    /// Reserves ECDSA material for a device linked to this wallet. Its
    /// source must be this wallet's active activation, exactly as the
    /// contribution names it, so a request scoped to one wallet cannot
    /// reserve from another's key. An exact retry answers the same packages.
    pub fn reserve_linked(
        &self,
        request: &CloudflareEcdsaSourcePreservingInactiveMaterialReservationRequestV1,
        server_key: &SigningWorkerServerOutputKeyV1,
    ) -> RouterAbProtocolResult<CloudflareEcdsaSourcePreservingInactiveMaterialReservationResponseV1>
    {
        request.validate()?;
        let scope = &request.scope;
        let binding = &request.source_contribution.binding;
        linked::validate_source_preserving_recipient_v1(&server_key.binding.public_key, binding)?;
        let target = linked::mpc_material_activation_from_ecdsa_ref_v1(&binding.target.activation)?;
        let record_key = linked::reservation_record_key_v1(&target)?;
        let reservation_id = linked::source_preserving_reservation_id_v1(
            &target,
            &linked::source_contribution_binding_digest_v1(binding)?,
        )?;
        let current = self.read_linked(scope, &record_key)?;
        if let linked::LinkedEcdsaReservationV1::Answer(response) =
            linked::settle_linked_ecdsa_reservation_v1(
                current.as_ref().map(|stored| &stored.state),
                request,
                &target,
                &reservation_id,
            )?
        {
            return Ok(response);
        }
        let source = linked::mpc_material_activation_from_ecdsa_ref_v1(&binding.source.activation)?;
        let stored = self
            .read_activation(
                scope,
                ActivationColumnV1::ActiveKey,
                &linked::active_output_key_v1(&source),
            )?
            .ok_or_else(|| {
                missing_error("linked-device ECDSA source is not this wallet's active material")
            })?;
        if stored.active_signing_worker_state().material_activation != source {
            return Err(wallet_error(
                "linked-device ECDSA source differs from this wallet's active material",
            ));
        }
        let (source_client_public_key33, source_relayer_public_key33) =
            linked::linked_ecdsa_source_public_keys_v1(binding)?;
        let source_share = crate::registration_source_relayer_share_v1(
            stored.material().output_material.as_bytes(),
            &binding.source.activation,
            &request.source_derivation,
            &source_client_public_key33,
            &source_relayer_public_key33,
        )?;
        let reserved = WalletLinkedEcdsaV1 {
            state: linked::linked_ecdsa_inactive_state_v1(
                request,
                &source_share,
                &server_key.private_key,
            )?,
            activation: None,
        };
        let written = self.sql.query::<LinkedEcdsaKeyV1>(
            "INSERT INTO wallet_linked_ecdsa (record_key, active_key, owner_json, ciphertext_json)
             VALUES (?, NULL, ?, ?) ON CONFLICT DO NOTHING RETURNING record_key",
            vec![
                text(record_key.clone()),
                text(owner_json(scope, "linked ECDSA reservation")?),
                text(self.seal_linked(scope, &record_key, &reserved)?),
            ],
        )?;
        if written.len() != 1 || written[0].record_key != record_key {
            return Err(wallet_error("linked ECDSA reservation write is uncertain"));
        }
        linked::source_preserving_response_from_state_v1(&reserved.state, "inactive")
    }

    /// Activates a linked device's reserved ECDSA material. Its share is
    /// opened once, here, and kept sealed with the reservation, where
    /// signing loads it like any activation. An active reservation answers
    /// again; a revoked one never activates.
    pub fn activate_linked(
        &self,
        request: &CloudflareEcdsaActivateReservationRequestV1,
        server_key: &SigningWorkerServerOutputKeyV1,
        activated_at_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareEcdsaSourcePreservingReservationActivationResponseV1>
    {
        request.validate()?;
        crate::require_positive_ms("linked ECDSA activation time", activated_at_ms)?;
        let scope = &request.scope;
        let record_key = linked::reservation_record_key_v1(&request.material_activation)?;
        let stored = self
            .read_linked(scope, &record_key)?
            .ok_or_else(|| lifecycle_error("linked ECDSA material reservation is missing"))?;
        if let linked::LinkedEcdsaActivationV1::Answer(response) =
            linked::settle_linked_ecdsa_activation_v1(&stored.state, request)?
        {
            return Ok(response);
        }
        let state = stored
            .state
            .into_source_preserving_phase_v1(linked::SourcePreservingPhaseV1::Active)?;
        let (active, material) = linked::linked_ecdsa_active_material_v1(
            &state,
            &request.material_activation,
            &server_key.server(&request.material_activation.signing_worker)?,
            &server_key.private_key,
            activated_at_ms,
        )?;
        let response = linked::source_preserving_response_from_state_v1(&state, "active")?;
        let activated = WalletLinkedEcdsaV1 {
            state,
            activation: Some(SigningWorkerWalletEcdsaActivationMaterialV1 { active, material }),
        };
        let written = self.sql.query::<LinkedEcdsaKeyV1>(
            "UPDATE wallet_linked_ecdsa SET active_key = ?, ciphertext_json = ?
             WHERE record_key = ? AND owner_json = ? AND active_key IS NULL
             RETURNING record_key",
            vec![
                text(linked::active_output_key_v1(&request.material_activation)),
                text(self.seal_linked(scope, &record_key, &activated)?),
                text(record_key.clone()),
                text(owner_json(scope, "linked ECDSA reservation")?),
            ],
        )?;
        if written.len() != 1 || written[0].record_key != record_key {
            return Err(wallet_error(
                "linked ECDSA reservation changed while it was activated",
            ));
        }
        Ok(response)
    }

    /// Revokes a linked device's ECDSA material. In one write its row keeps
    /// the revoked reservation and drops the activation, so signing no
    /// longer finds it and no presignature is consumed for it again. The
    /// same revocation answers again.
    pub fn deactivate_linked(
        &self,
        request: &CloudflareEcdsaDeactivateReservationRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareEcdsaReservationDeactivationResponseV1> {
        request.validate()?;
        crate::require_positive_ms("linked ECDSA revocation time", now_unix_ms)?;
        let scope = &request.scope;
        let record_key = linked::reservation_record_key_v1(&request.material_activation)?;
        let stored = self
            .read_linked(scope, &record_key)?
            .ok_or_else(|| lifecycle_error("linked ECDSA material reservation is missing"))?;
        let (binding, source_derivation, reservation_id, revoked_at_ms) =
            match linked::settle_linked_ecdsa_deactivation_v1(
                &stored.state,
                &request.material_activation,
            )? {
                linked::LinkedEcdsaDeactivationV1::Revoked(response) => return Ok(response),
                linked::LinkedEcdsaDeactivationV1::Resume {
                    binding,
                    source_derivation,
                    reservation_id,
                    revoked_at_ms,
                } => (binding, source_derivation, reservation_id, revoked_at_ms),
                linked::LinkedEcdsaDeactivationV1::Revoke {
                    binding,
                    source_derivation,
                    reservation_id,
                } => (binding, source_derivation, reservation_id, now_unix_ms),
            };
        let revoked = WalletLinkedEcdsaV1 {
            state: linked::EcdsaReservationStateV1::SourcePreservingRevoked {
                binding,
                source_derivation,
                material_activation: request.material_activation.clone(),
                reservation_id: reservation_id.clone(),
                revoked_at_ms,
            },
            activation: None,
        };
        let written = self.sql.query::<LinkedEcdsaKeyV1>(
            "UPDATE wallet_linked_ecdsa SET active_key = NULL, ciphertext_json = ?
             WHERE record_key = ? AND owner_json = ? RETURNING record_key",
            vec![
                text(self.seal_linked(scope, &record_key, &revoked)?),
                text(record_key.clone()),
                text(owner_json(scope, "linked ECDSA reservation")?),
            ],
        )?;
        if written.len() != 1 || written[0].record_key != record_key {
            return Err(wallet_error("linked ECDSA revocation write is uncertain"));
        }
        Ok(CloudflareEcdsaReservationDeactivationResponseV1 {
            state: "revoked",
            reservation_id,
            material_activation: request.material_activation.clone(),
            revoked_at_ms,
        })
    }

    /// A linked device's active material, by its activation's key.
    fn load_linked_activation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        lookup: &CloudflareActiveSigningWorkerStateLookupV1,
        active_key: &str,
    ) -> RouterAbProtocolResult<SigningWorkerWalletEcdsaActivationMaterialV1> {
        let rows = self.sql.query::<LinkedEcdsaRowV1>(
            "SELECT record_key, owner_json, ciphertext_json FROM wallet_linked_ecdsa
             WHERE active_key = ?",
            vec![text(active_key.to_owned())],
        )?;
        let stored = self
            .open_linked(scope, rows)?
            .ok_or_else(|| missing_error("ECDSA wallet activation material is missing"))?;
        let (linked::EcdsaReservationStateV1::SourcePreservingActive { .. }, Some(activation)) =
            (&stored.state, stored.activation)
        else {
            return Err(wallet_error(
                "linked ECDSA activation row holds no active material",
            ));
        };
        lookup.validate_active_state(&activation.active)?;
        Ok(activation)
    }

    /// Refuses material that belongs to a linked device that is no longer
    /// active. Material with no linked reservation is the wallet's own.
    fn require_linked_material_unrevoked(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        material_activation: &router_ab_core::MpcMaterialActivationRefV1,
    ) -> RouterAbProtocolResult<()> {
        let record_key = linked::reservation_record_key_v1(material_activation)?;
        match self.read_linked(scope, &record_key)? {
            None => Ok(()),
            Some(WalletLinkedEcdsaV1 {
                state: linked::EcdsaReservationStateV1::SourcePreservingActive { .. },
                activation: Some(_),
            }) => Ok(()),
            Some(_) => Err(lifecycle_error("linked ECDSA material is not active")),
        }
    }

    fn read_linked(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        record_key: &str,
    ) -> RouterAbProtocolResult<Option<WalletLinkedEcdsaV1>> {
        let rows = self.sql.query::<LinkedEcdsaRowV1>(
            "SELECT record_key, owner_json, ciphertext_json FROM wallet_linked_ecdsa
             WHERE record_key = ?",
            vec![text(record_key.to_owned())],
        )?;
        self.open_linked(scope, rows)
    }

    fn open_linked(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        rows: Vec<LinkedEcdsaRowV1>,
    ) -> RouterAbProtocolResult<Option<WalletLinkedEcdsaV1>> {
        let [row] = rows.as_slice() else {
            return if rows.is_empty() {
                Ok(None)
            } else {
                Err(wallet_error("linked ECDSA lookup returned duplicate rows"))
            };
        };
        if row.owner_json != owner_json(scope, "linked ECDSA reservation")? {
            return Err(wallet_error("linked ECDSA reservation owner conflict"));
        }
        let stored: WalletLinkedEcdsaV1 = self.cipher.open(
            "linked_ecdsa",
            &wallet_row_identity(scope, &row.record_key)?,
            &row.ciphertext_json,
        )?;
        stored.state.validate()?;
        Ok(Some(stored))
    }

    fn seal_linked(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        record_key: &str,
        stored: &WalletLinkedEcdsaV1,
    ) -> RouterAbProtocolResult<String> {
        self.cipher.seal(
            "linked_ecdsa",
            &wallet_row_identity(scope, record_key)?,
            stored,
        )
    }
}

enum ActivationColumnV1 {
    MaterialKey,
    ActiveKey,
}

pub(crate) fn validate_wallet_ecdsa_effect_scope_v1(
    scope: &CloudflareSigningWorkerWalletScopeV1,
    request: &CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
) -> RouterAbProtocolResult<()> {
    request.validate()?;
    if request.wallet_scope.as_ref() != Some(scope) {
        return Err(wallet_error(
            "SigningWorker ECDSA effect wallet scope changed",
        ));
    }
    Ok(())
}

fn validate_ecdsa_effect_row(
    row: &EcdsaEffectRowV1,
    operation_key: &str,
    authorization_key: &str,
    owner_json: &str,
    request_digest_hex: &str,
    authorization_json: &str,
) -> RouterAbProtocolResult<()> {
    if row.operation_key == operation_key
        && row.authorization_key == authorization_key
        && row.owner_json == owner_json
        && row.request_digest_hex == request_digest_hex
        && row.authorization_json == authorization_json
    {
        return Ok(());
    }
    Err(replay_error(
        "SigningWorker ECDSA effect identity or authorization changed",
    ))
}

fn ecdsa_effect_claim_outcome(
    row: &EcdsaEffectRowV1,
    operation_key: &str,
    authorization_key: &str,
    owner_json: &str,
    request_digest_hex: &str,
    authorization_json: &str,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaClaimAndConsumeV1> {
    validate_ecdsa_effect_row(
        row,
        operation_key,
        authorization_key,
        owner_json,
        request_digest_hex,
        authorization_json,
    )?;
    Ok(match &row.terminal_json {
        Some(terminal_json) => CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Replay {
            terminal_json: terminal_json.clone(),
        },
        None => CloudflareSigningWorkerEcdsaClaimAndConsumeV1::InProgress,
    })
}

fn owner_json(
    scope: &CloudflareSigningWorkerWalletScopeV1,
    label: &str,
) -> RouterAbProtocolResult<String> {
    serde_json::to_string(scope)
        .map_err(|error| wallet_error(format!("{label} owner is invalid: {error}")))
}

/// The cipher identity of one wallet row: the wallet's object name and the
/// row's key.
fn wallet_row_identity(
    scope: &CloudflareSigningWorkerWalletScopeV1,
    key: &str,
) -> RouterAbProtocolResult<String> {
    Ok(format!(
        "{}/{}",
        signing_worker_wallet_object_name_v1(scope)?,
        key
    ))
}

/// The wallet's Durable Object name on Cloudflare; on a VM it names the
/// wallet's rows in the same way, so sealed rows carry the same identity.
pub(crate) fn signing_worker_wallet_object_name_v1(
    scope: &CloudflareSigningWorkerWalletScopeV1,
) -> RouterAbProtocolResult<String> {
    scope.validate()?;
    let encoded = serde_json::to_vec(scope)
        .map_err(|error| wallet_error(format!("SigningWorker wallet scope is invalid: {error}")))?;
    let mut hash = Sha256::new();
    hash.update(b"seams/signing-worker/wallet-do/v1");
    hash.update(encoded);
    Ok(format!(
        "signing-worker-wallet-{}",
        hex_slice(&hash.finalize()),
    ))
}

fn digest_hex(digest: PublicDigest32) -> String {
    hex_slice(digest.as_bytes())
}

fn hex_slice(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn text(value: String) -> SigningWorkerWalletSqlValueV1 {
    SigningWorkerWalletSqlValueV1::Text(value)
}

fn wallet_error(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}

fn replay_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ReplayedLocalRequest, message)
}

fn missing_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MissingLocalBinding, message)
}

fn lifecycle_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}
