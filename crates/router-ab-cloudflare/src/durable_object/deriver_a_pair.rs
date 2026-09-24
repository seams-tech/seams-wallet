use router_ab_core::{
    burn_ed25519_yao_pair_v1, claim_ed25519_yao_pair_v1, complete_ed25519_yao_pair_v1,
    expire_ed25519_yao_pair_v1, prepare_ed25519_yao_pair_v1, reserve_ed25519_yao_pair_v1,
    Ed25519YaoEncryptedInputV1, Ed25519YaoExecutionIdV1, Ed25519YaoInputPairBindingV1,
    Ed25519YaoPairRecordV1, Ed25519YaoPairRejectionV1, Ed25519YaoPairReservationV1,
    Ed25519YaoPairStartClaimV1, Ed25519YaoPairStoreResultV1, Ed25519YaoPairTransitionV1,
    Ed25519YaoRoleReadinessReceiptV1, Ed25519YaoRoleStartAcceptanceV1, TenantRootIdentityV1,
    TenantRootSignedActivationReceiptV1,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::{DurableObject, Env, Request, Response, SqlStorage, SqlStorageValue, State};

use crate::{
    ed25519_yao_lifecycle::role_d1::{
        encode_hex, encode_hex_slice, RolePairCipherV1, RolePairRecordScopeV1,
    },
    ed25519_yao_lifecycle::{verify_role_readiness_receipt_v1, verify_role_start_acceptance_v1},
    CloudflareDeriverAWorkerRuntimeV1, CloudflareEd25519YaoPairExecuteResponseV1,
    CloudflareEd25519YaoPairWorkV1, CloudflareEd25519YaoTenantRootContextV2,
};

const PAIR_DO_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair";
const PAIR_DO_BINDING: &str = "DERIVER_A_WALLET_DO";
const OWNER_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS wallet_owner (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner_json TEXT NOT NULL
    )
";
const PAIR_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS yao_pair_sessions (
        session_hex TEXT PRIMARY KEY,
        revision_text TEXT NOT NULL,
        ciphertext_json TEXT NOT NULL
    )
";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeriverAWalletOwnerV1 {
    org_id: String,
    project_id: String,
    env_id: String,
    wallet_id: String,
}

impl DeriverAWalletOwnerV1 {
    pub(crate) fn from_root_identity(
        root: &TenantRootIdentityV1,
        wallet_id: &str,
    ) -> worker::Result<Self> {
        if wallet_id.trim().is_empty() {
            return Err(pair_error("Deriver A wallet identity is empty"));
        }
        Ok(Self {
            org_id: root.org_id().to_owned(),
            project_id: root.project_id().to_owned(),
            env_id: root.env_id().to_owned(),
            wallet_id: wallet_id.to_owned(),
        })
    }

    fn object_name(&self) -> worker::Result<String> {
        let bytes = serde_json::to_vec(self).map_err(|error| pair_error(error.to_string()))?;
        let mut hasher = Sha256::new();
        hasher.update(b"seams/deriver-a/wallet-do/v1");
        hasher.update(bytes);
        Ok(format!(
            "deriver-a-wallet-{}",
            encode_hex_slice(&hasher.finalize())
        ))
    }

    fn check_pair(&self, pair: &Ed25519YaoInputPairBindingV1) -> worker::Result<()> {
        pair.validate()
            .map_err(|error| pair_error(error.to_string()))?;
        if pair.binding().lifecycle.account_id != self.wallet_id {
            return Err(pair_error(
                "Deriver A pair wallet differs from object owner",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeriverAPairPayloadV1 {
    pub(crate) tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    pub(crate) work: CloudflareEd25519YaoPairWorkV1,
    pub(crate) input: Ed25519YaoEncryptedInputV1,
}

type PairRecord =
    Ed25519YaoPairRecordV1<DeriverAPairPayloadV1, CloudflareEd25519YaoPairExecuteResponseV1>;
type PairResult =
    Ed25519YaoPairStoreResultV1<DeriverAPairPayloadV1, CloudflareEd25519YaoPairExecuteResponseV1>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum DeriverAPairDoCommandV1 {
    Prepare {
        owner: DeriverAWalletOwnerV1,
        root_identity: TenantRootIdentityV1,
        record: PairRecord,
        now_ms: u64,
    },
    Reserve {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        local_receipt: Ed25519YaoRoleReadinessReceiptV1,
        peer_receipt: Ed25519YaoRoleReadinessReceiptV1,
        execution_id: Ed25519YaoExecutionIdV1,
        now_ms: u64,
    },
    Claim {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        local_receipt: Ed25519YaoRoleReadinessReceiptV1,
        peer_receipt: Ed25519YaoRoleReadinessReceiptV1,
        acceptance: Ed25519YaoRoleStartAcceptanceV1,
        execution_id: Ed25519YaoExecutionIdV1,
        now_ms: u64,
    },
    Complete {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
        outcome: CloudflareEd25519YaoPairExecuteResponseV1,
        now_ms: u64,
        running_lifetime_ms: u64,
    },
    Expire {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        now_ms: u64,
    },
    Burn {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
    },
    Read {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
    },
}

impl DeriverAPairDoCommandV1 {
    fn owner(&self) -> &DeriverAWalletOwnerV1 {
        match self {
            Self::Prepare { owner, .. }
            | Self::Reserve { owner, .. }
            | Self::Claim { owner, .. }
            | Self::Complete { owner, .. }
            | Self::Expire { owner, .. }
            | Self::Burn { owner, .. }
            | Self::Read { owner, .. } => owner,
        }
    }
}

pub(crate) async fn call_deriver_a_pair_do_v1(
    env: &Env,
    command: &DeriverAPairDoCommandV1,
) -> worker::Result<DeriverAPairDoResponseV1> {
    let namespace = env.durable_object(PAIR_DO_BINDING)?;
    let stub = namespace.get_by_name(&command.owner().object_name()?)?;
    let body = serde_json::to_string(command).map_err(|error| pair_error(error.to_string()))?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = worker::Request::new_with_init(
        &format!("https://router-ab-do.internal{PAIR_DO_PATH}"),
        &init,
    )?;
    let mut response = stub.fetch_with_request(request).await?;
    if response.status_code() != 200 {
        return Err(pair_error(format!(
            "Deriver A wallet object returned HTTP {}",
            response.status_code()
        )));
    }
    response.json::<DeriverAPairDoResponseV1>().await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum DeriverAPairDoResponseV1 {
    Mutation { result: PairResult },
    Read { revision: u64, record: PairRecord },
    Missing,
}

#[derive(Deserialize)]
struct PairRowV1 {
    revision_text: String,
    ciphertext_json: String,
}

#[derive(Deserialize)]
struct OwnerRowV1 {
    owner_json: String,
}

#[derive(Deserialize)]
struct RevisionRowV1 {
    revision_text: String,
}

struct SelectedPairV1 {
    revision: u64,
    record: PairRecord,
    scope: RolePairRecordScopeV1,
}

/// All pair mutations run synchronously inside this wallet's object. Every
/// conditional SQL statement is atomic; no network call occurs between read
/// and CAS.
#[worker::durable_object]
pub struct RouterAbDeriverAWalletDurableObject {
    sql: SqlStorage,
    env: Env,
}

impl DurableObject for RouterAbDeriverAWalletDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            sql: state.storage().sql(),
            env,
        }
    }

    async fn fetch(&self, mut request: Request) -> worker::Result<Response> {
        if request.method() != worker::Method::Post || request.path() != PAIR_DO_PATH {
            return Response::error("Unknown Deriver A wallet object request", 404);
        }
        let command: DeriverAPairDoCommandV1 = request.json().await?;
        self.sql.exec(OWNER_SCHEMA, None)?;
        self.sql.exec(PAIR_SCHEMA, None)?;
        let response = self.execute(command)?;
        Response::from_json(&response)
    }
}

impl RouterAbDeriverAWalletDurableObject {
    fn execute(
        &self,
        command: DeriverAPairDoCommandV1,
    ) -> worker::Result<DeriverAPairDoResponseV1> {
        let owner = command.owner().clone();
        if let DeriverAPairDoCommandV1::Prepare {
            root_identity,
            record,
            ..
        } = &command
        {
            self.validate_preparation(&owner, root_identity, record)?;
            if let PairRecord::Prepared { receipt, .. } = record {
                let runtime = CloudflareDeriverAWorkerRuntimeV1::from_worker_env(&self.env)
                    .map_err(|error| pair_error(error.to_string()))?;
                verify_role_readiness_receipt_v1(receipt, runtime.peer_verifying_keys())
                    .map_err(|error| pair_error(error.to_string()))?;
            }
        }
        let may_initialize = matches!(command, DeriverAPairDoCommandV1::Prepare { .. });
        self.check_owner(&owner, may_initialize)?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        let result = match command {
            DeriverAPairDoCommandV1::Prepare { record, now_ms, .. } => {
                let pair = record.pair_binding().clone();
                self.mutate(&owner, &cipher, &pair, |current| {
                    prepare_ed25519_yao_pair_v1(current, record, now_ms)
                })?
            }
            DeriverAPairDoCommandV1::Reserve {
                pair_binding,
                local_receipt,
                peer_receipt,
                execution_id,
                now_ms,
                ..
            } => {
                let runtime = CloudflareDeriverAWorkerRuntimeV1::from_worker_env(&self.env)
                    .map_err(|error| pair_error(error.to_string()))?;
                for receipt in [&local_receipt, &peer_receipt] {
                    verify_role_readiness_receipt_v1(receipt, runtime.peer_verifying_keys())
                        .map_err(|error| pair_error(error.to_string()))?;
                }
                self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                    Some(record) => reserve_ed25519_yao_pair_v1(
                        record,
                        Ed25519YaoPairReservationV1 {
                            pair_binding: &pair_binding,
                            local_receipt: &local_receipt,
                            peer_receipt: &peer_receipt,
                            execution_id,
                            now_ms,
                        },
                    ),
                    None => Ed25519YaoPairTransitionV1::Reject(
                        Ed25519YaoPairRejectionV1::IdentityMismatch,
                    ),
                })?
            }
            DeriverAPairDoCommandV1::Claim {
                pair_binding,
                local_receipt,
                peer_receipt,
                acceptance,
                execution_id,
                now_ms,
                ..
            } => {
                let runtime = CloudflareDeriverAWorkerRuntimeV1::from_worker_env(&self.env)
                    .map_err(|error| pair_error(error.to_string()))?;
                for receipt in [&local_receipt, &peer_receipt] {
                    verify_role_readiness_receipt_v1(receipt, runtime.peer_verifying_keys())
                        .map_err(|error| pair_error(error.to_string()))?;
                }
                verify_role_start_acceptance_v1(&acceptance, runtime.peer_verifying_keys())
                    .map_err(|error| pair_error(error.to_string()))?;
                self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                    Some(record) => claim_ed25519_yao_pair_v1(
                        record,
                        Ed25519YaoPairStartClaimV1 {
                            pair_binding: &pair_binding,
                            local_receipt: &local_receipt,
                            peer_receipt: &peer_receipt,
                            acceptance: &acceptance,
                            execution_id,
                            now_ms,
                        },
                    ),
                    None => Ed25519YaoPairTransitionV1::Reject(
                        Ed25519YaoPairRejectionV1::IdentityMismatch,
                    ),
                })?
            }
            DeriverAPairDoCommandV1::Complete {
                pair_binding,
                execution_id,
                outcome,
                now_ms,
                running_lifetime_ms,
                ..
            } => {
                if outcome.deriver_a_execution.session() != pair_binding.session() {
                    return Err(pair_error("Deriver A outcome session differs from pair"));
                }
                self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                    Some(record) => complete_ed25519_yao_pair_v1(
                        record,
                        execution_id,
                        outcome,
                        now_ms,
                        running_lifetime_ms,
                    ),
                    None => Ed25519YaoPairTransitionV1::Reject(
                        Ed25519YaoPairRejectionV1::IdentityMismatch,
                    ),
                })?
            }
            DeriverAPairDoCommandV1::Expire {
                pair_binding,
                now_ms,
                ..
            } => self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                Some(record) => expire_ed25519_yao_pair_v1(record, now_ms),
                None => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
                }
            })?,
            DeriverAPairDoCommandV1::Burn {
                pair_binding,
                execution_id,
                ..
            } => self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                Some(record) => burn_ed25519_yao_pair_v1(record, execution_id),
                None => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
                }
            })?,
            DeriverAPairDoCommandV1::Read { pair_binding, .. } => {
                let row = self.read(&owner, &cipher, &pair_binding)?;
                return Ok(match row {
                    Some(row) => DeriverAPairDoResponseV1::Read {
                        revision: row.revision,
                        record: row.record,
                    },
                    None => DeriverAPairDoResponseV1::Missing,
                });
            }
        };
        Ok(DeriverAPairDoResponseV1::Mutation { result })
    }

    fn check_owner(
        &self,
        owner: &DeriverAWalletOwnerV1,
        may_initialize: bool,
    ) -> worker::Result<()> {
        let rows = self
            .sql
            .exec("SELECT owner_json FROM wallet_owner WHERE id = 1", None)?
            .to_array::<OwnerRowV1>()?;
        let owner_json =
            serde_json::to_string(owner).map_err(|error| pair_error(error.to_string()))?;
        match rows.as_slice() {
            [] if may_initialize => {
                self.sql.exec(
                    "INSERT INTO wallet_owner (id, owner_json) VALUES (1, ?) ON CONFLICT DO NOTHING",
                    vec![SqlStorageValue::String(owner_json.clone())],
                )?;
                let pinned = self
                    .sql
                    .exec("SELECT owner_json FROM wallet_owner WHERE id = 1", None)?
                    .one::<OwnerRowV1>()?;
                if pinned.owner_json != owner_json {
                    return Err(pair_error("Deriver A wallet object owner conflict"));
                }
            }
            [row] if row.owner_json == owner_json => {}
            [] => return Err(pair_error("Deriver A wallet object is uninitialized")),
            _ => return Err(pair_error("Deriver A wallet object owner conflict")),
        }
        Ok(())
    }

    fn validate_preparation(
        &self,
        owner: &DeriverAWalletOwnerV1,
        root_identity: &TenantRootIdentityV1,
        record: &PairRecord,
    ) -> worker::Result<()> {
        let PairRecord::Prepared {
            pair_binding,
            payload,
            ..
        } = record
        else {
            return Err(pair_error("Deriver A prepare requires a Prepared record"));
        };
        owner.check_pair(pair_binding)?;
        if owner != &DeriverAWalletOwnerV1::from_root_identity(root_identity, &owner.wallet_id)? {
            return Err(pair_error(
                "Deriver A root identity differs from wallet owner",
            ));
        }
        payload
            .tenant_root
            .validate_for_pair(pair_binding)
            .map_err(|error| pair_error(error.to_string()))?;
        let receipt_bytes = payload
            .tenant_root
            .custody_binding
            .activation_receipt_bytes()
            .map_err(|error| pair_error(error.to_string()))?;
        let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .map_err(|error| pair_error(error.to_string()))?;
        let expected_digest = root_identity
            .digest()
            .map_err(|error| pair_error(error.to_string()))?;
        if receipt.identity_digest() != expected_digest {
            return Err(pair_error(
                "Deriver A root receipt differs from trusted tenant scope",
            ));
        }
        Ok(())
    }

    fn read(
        &self,
        owner: &DeriverAWalletOwnerV1,
        cipher: &RolePairCipherV1,
        pair: &Ed25519YaoInputPairBindingV1,
    ) -> worker::Result<Option<SelectedPairV1>> {
        owner.check_pair(pair)?;
        let session_hex = encode_hex(pair.session());
        let rows = self.sql.exec(
            "SELECT revision_text, ciphertext_json FROM yao_pair_sessions WHERE session_hex = ?",
            vec![SqlStorageValue::String(session_hex.clone())],
        )?.to_array::<PairRowV1>()?;
        let Some(row) = rows.into_iter().next() else {
            return Ok(None);
        };
        let revision = row
            .revision_text
            .parse::<u64>()
            .ok()
            .filter(|revision| *revision > 0)
            .ok_or_else(|| pair_error("Deriver A pair revision is invalid"))?;
        let identity = format!("{}:{session_hex}", owner.object_name()?);
        let opened = cipher.open(&identity, &row.ciphertext_json)?;
        let record: PairRecord = serde_json::from_str(&opened.record_json)
            .map_err(|error| pair_error(format!("Deriver A pair record is malformed: {error}")))?;
        if record.pair_binding() != pair
            || opened.scope.signer_set_id != pair.binding().lifecycle.signer_set_id
            || opened.scope.root_share_epoch != pair.binding().lifecycle.root_share_epoch.as_str()
            || record_root_digest(&record)
                .is_some_and(|digest| encode_hex(digest) != opened.scope.root_metadata_digest_hex)
        {
            return Err(pair_error("Deriver A pair record scope changed"));
        }
        Ok(Some(SelectedPairV1 {
            revision,
            record,
            scope: opened.scope,
        }))
    }

    fn mutate(
        &self,
        owner: &DeriverAWalletOwnerV1,
        cipher: &RolePairCipherV1,
        pair: &Ed25519YaoInputPairBindingV1,
        decide: impl FnOnce(
            Option<&PairRecord>,
        ) -> Ed25519YaoPairTransitionV1<
            DeriverAPairPayloadV1,
            CloudflareEd25519YaoPairExecuteResponseV1,
        >,
    ) -> worker::Result<PairResult> {
        let selected = self.read(owner, cipher, pair)?;
        match decide(selected.as_ref().map(|row| &row.record)) {
            Ed25519YaoPairTransitionV1::Reject(reason) => Ok(PairResult::Rejected(reason)),
            Ed25519YaoPairTransitionV1::Duplicate => {
                let row = selected.ok_or_else(|| pair_error("Duplicate pair has no row"))?;
                Ok(PairResult::Duplicate {
                    revision: row.revision,
                    record: row.record,
                })
            }
            Ed25519YaoPairTransitionV1::Persist(record) => {
                let scope = match &selected {
                    Some(row) => row.scope.clone(),
                    None => initial_scope(&record)?,
                };
                let session_hex = encode_hex(pair.session());
                let identity = format!("{}:{session_hex}", owner.object_name()?);
                let record_json = serde_json::to_string(&record)
                    .map_err(|error| pair_error(error.to_string()))?;
                let ciphertext_json = cipher.seal(&identity, &scope, &record_json)?;
                let next_revision = selected
                    .as_ref()
                    .map_or(1, |row| row.revision.saturating_add(1));
                if next_revision == 0 || next_revision > 9_007_199_254_740_991 {
                    return Err(pair_error("Deriver A pair revision overflow"));
                }
                let rows = if let Some(row) = selected {
                    self.sql.exec(
                        "UPDATE yao_pair_sessions SET revision_text = ?, ciphertext_json = ? \
                         WHERE session_hex = ? AND revision_text = ? RETURNING revision_text",
                        vec![
                            SqlStorageValue::String(next_revision.to_string()),
                            SqlStorageValue::String(ciphertext_json),
                            SqlStorageValue::String(session_hex),
                            SqlStorageValue::String(row.revision.to_string()),
                        ],
                    )
                } else {
                    self.sql.exec(
                        "INSERT INTO yao_pair_sessions (session_hex, revision_text, ciphertext_json) \
                         VALUES (?, '1', ?) ON CONFLICT DO NOTHING RETURNING revision_text",
                        vec![
                            SqlStorageValue::String(session_hex),
                            SqlStorageValue::String(ciphertext_json),
                        ],
                    )
                };
                let rows = match rows {
                    Ok(cursor) => cursor.to_array::<RevisionRowV1>(),
                    Err(_) => return Ok(PairResult::UncertainWrite),
                };
                let rows = match rows {
                    Ok(rows) => rows,
                    Err(_) => return Ok(PairResult::UncertainWrite),
                };
                if rows.is_empty() {
                    return Ok(PairResult::StaleVersion);
                }
                if rows.len() != 1 || rows[0].revision_text != next_revision.to_string() {
                    return Ok(PairResult::UncertainWrite);
                }
                Ok(PairResult::Applied {
                    revision: next_revision,
                    record,
                })
            }
        }
    }
}

fn initial_scope(record: &PairRecord) -> worker::Result<RolePairRecordScopeV1> {
    let PairRecord::Prepared {
        pair_binding,
        root_metadata_digest,
        ..
    } = record
    else {
        return Err(pair_error("Initial Deriver A pair state must be Prepared"));
    };
    Ok(RolePairRecordScopeV1 {
        signer_set_id: pair_binding.binding().lifecycle.signer_set_id.clone(),
        root_share_epoch: pair_binding
            .binding()
            .lifecycle
            .root_share_epoch
            .as_str()
            .to_owned(),
        root_metadata_digest_hex: encode_hex(*root_metadata_digest),
    })
}

fn record_root_digest(record: &PairRecord) -> Option<[u8; 32]> {
    match record {
        PairRecord::Prepared {
            root_metadata_digest,
            ..
        }
        | PairRecord::Starting {
            root_metadata_digest,
            ..
        }
        | PairRecord::Running {
            root_metadata_digest,
            ..
        } => Some(*root_metadata_digest),
        PairRecord::Completed { claim_identity, .. } => {
            Some(claim_identity.local_receipt.root_metadata_digest().bytes)
        }
        PairRecord::Burned { .. } | PairRecord::Expired { .. } => None,
    }
}

fn pair_error(message: impl Into<String>) -> worker::Error {
    worker::Error::RustError(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(org: &str, version: &str) -> TenantRootIdentityV1 {
        TenantRootIdentityV1::new(org, "project-1", "env-1", "root-1", version)
            .expect("root identity")
    }

    #[test]
    fn wallet_object_name_is_stable_across_root_versions_and_isolates_tenants() {
        let first = DeriverAWalletOwnerV1::from_root_identity(&root("org-1", "v1"), "wallet-1")
            .expect("owner");
        let rotated = DeriverAWalletOwnerV1::from_root_identity(&root("org-1", "v2"), "wallet-1")
            .expect("rotated owner");
        let other_tenant =
            DeriverAWalletOwnerV1::from_root_identity(&root("org-2", "v1"), "wallet-1")
                .expect("other tenant");
        let other_wallet =
            DeriverAWalletOwnerV1::from_root_identity(&root("org-1", "v1"), "wallet-2")
                .expect("other wallet");
        assert_eq!(
            first.object_name().expect("name"),
            rotated.object_name().expect("name")
        );
        assert_ne!(
            first.object_name().expect("name"),
            other_tenant.object_name().expect("name")
        );
        assert_ne!(
            first.object_name().expect("name"),
            other_wallet.object_name().expect("name")
        );
    }
}
