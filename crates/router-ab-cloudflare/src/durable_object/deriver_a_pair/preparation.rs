use super::{pair_error, DeriverAWalletOwnerV1};
use serde::{Deserialize, Serialize};
use worker::{Env, Method, Request, Response, SqlStorage, SqlStorageValue};

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_relocation_preparation (id INTEGER PRIMARY KEY CHECK (id = 1), request_json TEXT NOT NULL)";

pub(crate) const PREPARATION_PATH: &str = "/router-ab/internal/deriver-a/wallet/prepare-relocation";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Preparation {
    pub(super) owner: DeriverAWalletOwnerV1,
    move_id: String,
    request_digest_hex: String,
    source_generation: u64,
    destination_generation: u64,
}

impl Preparation {
    pub(super) fn validate(&self) -> worker::Result<()> {
        for value in [
            &self.owner.org_id,
            &self.owner.project_id,
            &self.owner.env_id,
            &self.owner.wallet_id,
        ] {
            crate::require_non_empty("Deriver A wallet owner", value)
                .map_err(|error| pair_error(error.to_string()))?;
        }
        if self.move_id.len() != 49
            || !self.move_id.starts_with("wmove_")
            || !self.move_id.as_bytes()[6..]
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
            || self.request_digest_hex.len() != 64
            || !self
                .request_digest_hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || self.source_generation == 0
            || self.source_generation >= 9_007_199_254_740_991
            || self.destination_generation != self.source_generation + 1
        {
            return Err(pair_error("Deriver A relocation identity is invalid"));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct ReservationRow {
    request_json: String,
}

#[derive(Serialize)]
struct Receipt {
    kind: &'static str,
    request: Preparation,
    destination_object: String,
}

pub(crate) async fn call_preparation(mut request: Request, env: &Env) -> worker::Result<Response> {
    if request.method() != Method::Post {
        return Response::error("Deriver A relocation preparation requires POST", 405);
    }
    let command: Preparation =
        match crate::durable_object::tenant_root_creation::decode_bounded_json_request(
            &mut request,
            8192,
        )
        .await
        {
            Ok(command) => command,
            Err(error) => return crate::router_coordinator::protocol_error_response(error),
        };
    command.validate()?;
    let namespace = env.durable_object(super::PAIR_DO_BINDING)?;
    let stub = namespace.get_by_name(&command.owner.object_name()?)?;
    let body = serde_json::to_string(&command).map_err(|error| pair_error(error.to_string()))?;
    let forwarded = Request::new_with_init(
        &format!("https://router-ab-do.internal{PREPARATION_PATH}"),
        &worker::RequestInit::new()
            .with_method(Method::Post)
            .with_body(Some(body.into())),
    )?;
    stub.fetch_with_request(forwarded).await
}

pub(super) fn reserve(sql: &SqlStorage, command: Preparation) -> worker::Result<Response> {
    // SQL guards also reject deferred writers that entered before preparation.
    for table in ["yao_pair_sessions", "yao_pair_admission_fences"] {
        for operation in ["INSERT", "UPDATE", "DELETE"] {
            sql.exec(&format!("CREATE TRIGGER IF NOT EXISTS relocation_{table}_{operation} BEFORE {operation} ON {table} WHEN EXISTS (SELECT 1 FROM wallet_relocation_preparation) BEGIN SELECT RAISE(ABORT, 'Deriver A destination is reserved'); END"), None)?;
        }
    }
    let request_json =
        serde_json::to_string(&command).map_err(|error| pair_error(error.to_string()))?;
    sql.exec(
        "INSERT INTO wallet_relocation_preparation (id, request_json) SELECT 1, ? WHERE NOT EXISTS (SELECT 1 FROM yao_pair_sessions) AND NOT EXISTS (SELECT 1 FROM yao_pair_admission_fences) ON CONFLICT DO NOTHING",
        vec![SqlStorageValue::String(request_json.clone())],
    )?;
    let rows = sql
        .exec(
            "SELECT request_json FROM wallet_relocation_preparation WHERE id = 1",
            None,
        )?
        .to_array::<ReservationRow>()?;
    match rows.as_slice() {
        [row] if row.request_json == request_json => Response::from_json(&Receipt {
            kind: "prepared",
            destination_object: command.owner.object_name()?,
            request: command,
        }),
        _ => Response::error(
            "Deriver A destination is nonempty or reserved for another move",
            409,
        ),
    }
}

pub(super) fn require_open(sql: &SqlStorage) -> worker::Result<()> {
    let rows = sql
        .exec(
            "SELECT request_json FROM wallet_relocation_preparation WHERE id = 1",
            None,
        )?
        .to_array::<ReservationRow>()?;
    if !rows.is_empty() {
        return Err(pair_error("Deriver A destination is reserved"));
    }
    Ok(())
}
