use crate::ed25519_yao_lifecycle::role_d1::RolePairCipherV1;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use worker::{Env, Method, Request, Response, SqlStorage, SqlStorageValue};

pub(crate) mod snapshot;

pub(crate) const SOURCE_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_relocation_source (id INTEGER PRIMARY KEY CHECK (id = 1), request_json TEXT NOT NULL)";

pub(crate) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_relocation_preparation (id INTEGER PRIMARY KEY CHECK (id = 1), request_json TEXT NOT NULL)";

pub(crate) trait WalletOwner: Serialize + DeserializeOwned + Clone + 'static {
    type Pair: snapshot::import::Pair<Self>;
    fn object_id(route: crate::WalletObjectRoute) -> crate::WalletObjectId;
    const LABEL: &'static str;
    const PAIR_SNAPSHOT_JSON: &'static str;
    fn parts(&self) -> [&str; 4];
    fn cipher(env: &Env) -> worker::Result<RolePairCipherV1>;
    fn object_name(&self) -> worker::Result<String>;
    fn physical_object_name(&self, generation: u64) -> worker::Result<String> {
        crate::wallet_object::physical_wallet_object_name(&self.object_name()?, generation)
            .map_err(|error| pair_error(error.to_string()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Preparation<Owner> {
    pub(crate) owner: Owner,
    move_id: String,
    request_digest_hex: String,
    cipher_context_digest_hex: String,
    source_generation: u64,
    destination_generation: u64,
}

impl<Owner: WalletOwner> Preparation<Owner> {
    pub(crate) fn validate(&self) -> worker::Result<()> {
        for value in self.owner.parts() {
            crate::require_non_empty("Deriver wallet owner", value)
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
            || self.cipher_context_digest_hex.len() != 64
            || !self
                .cipher_context_digest_hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || self.source_generation == 0
            || self.source_generation >= 9_007_199_254_740_991
            || self.destination_generation != self.source_generation + 1
        {
            return Err(pair_error("Deriver relocation identity is invalid"));
        }
        Ok(())
    }

    pub(crate) fn context_matches(&self, env: &Env) -> worker::Result<bool> {
        Ok(Owner::cipher(env)?.relocation_context_digest()? == self.cipher_context_digest_hex)
    }
}

#[derive(Deserialize)]
struct ReservationRow {
    request_json: String,
}

#[derive(Serialize)]
struct Receipt<Owner> {
    kind: &'static str,
    request: Preparation<Owner>,
    destination_object: String,
}

pub(crate) async fn call_preparation<Owner: WalletOwner>(
    mut request: Request,
    env: &Env,
    binding: &str,
    path: &str,
) -> worker::Result<Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != Method::Post {
        return Response::error("Deriver relocation preparation requires POST", 405);
    }
    let command: Preparation<Owner> =
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
    if !command.context_matches(env)? {
        return Response::error("Deriver encryption context differs from source", 409);
    }
    let namespace = env.durable_object(binding)?;
    let stub = Owner::object_id(wallet_objects).stub(&namespace, wallet_objects.home)?;
    let body = serde_json::to_string(&command).map_err(|error| pair_error(error.to_string()))?;
    let forwarded = Request::new_with_init(
        &format!("https://router-ab-do.internal{path}"),
        &worker::RequestInit::new()
            .with_method(Method::Post)
            .with_body(Some(body.into())),
    )?;
    stub.fetch_with_request(forwarded).await
}

pub(crate) async fn reserve<Owner: WalletOwner>(
    storage: &worker::Storage,
    sql: SqlStorage,
    command: Preparation<Owner>,
) -> worker::Result<Response> {
    let response = std::rc::Rc::new(std::cell::RefCell::new(None));
    let returned = std::rc::Rc::clone(&response);
    let committed = storage
        .transaction(move |_| async move {
            let outcome = reserve_destination(&sql, command)?;
            let rejected = outcome.status_code() >= 400;
            *returned.borrow_mut() = Some(outcome);
            if rejected {
                return Err(pair_error("Deriver destination preparation conflicts"));
            }
            Ok(())
        })
        .await;
    let result = response.borrow_mut().take();
    match (committed, result) {
        (Ok(()), Some(outcome)) => Ok(outcome),
        (Err(_), Some(outcome)) if outcome.status_code() >= 400 => Ok(outcome),
        (Err(error), _) => Err(error),
        (Ok(()), None) => Err(pair_error("Deriver preparation returned no response")),
    }
}

fn reserve_destination<Owner: WalletOwner>(
    sql: &SqlStorage,
    command: Preparation<Owner>,
) -> worker::Result<Response> {
    sql.exec(super::registration_preparation::SCHEMA, None)?;
    if snapshot::import::activated_preparation(sql, &command)? {
        return Response::from_json(&Receipt {
            kind: "prepared",
            destination_object: command.owner.object_name()?,
            request: command,
        });
    }
    // SQL guards also reject deferred writers that entered before preparation.
    for table in [
        "yao_pair_sessions",
        "yao_pair_admission_fences",
        "yao_registration_preparation",
        "yao_registration_input_binding",
    ] {
        for operation in ["INSERT", "UPDATE", "DELETE"] {
            sql.exec(&format!("CREATE TRIGGER IF NOT EXISTS relocation_{table}_{operation} BEFORE {operation} ON {table} WHEN EXISTS (SELECT 1 FROM wallet_relocation_preparation) BEGIN SELECT RAISE(ABORT, 'Deriver destination is reserved'); END"), None)?;
        }
    }
    let request_json =
        serde_json::to_string(&command).map_err(|error| pair_error(error.to_string()))?;
    sql.exec(
        "INSERT INTO wallet_relocation_preparation (id, request_json) SELECT 1, ? WHERE NOT EXISTS (SELECT 1 FROM yao_pair_sessions) AND NOT EXISTS (SELECT 1 FROM yao_pair_admission_fences) AND NOT EXISTS (SELECT 1 FROM yao_registration_preparation) AND NOT EXISTS (SELECT 1 FROM yao_registration_input_binding) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_source) ON CONFLICT DO NOTHING",
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
            "Deriver destination is nonempty or reserved for another move",
            409,
        ),
    }
}

pub(crate) fn source_is_frozen(sql: &SqlStorage) -> worker::Result<bool> {
    Ok(!sql
        .exec(
            "SELECT request_json FROM wallet_relocation_source WHERE id = 1",
            None,
        )?
        .to_array::<ReservationRow>()?
        .is_empty())
}

pub(crate) fn require_open<Owner: WalletOwner>(sql: &SqlStorage) -> worker::Result<()> {
    if source_is_frozen(sql)? {
        return Err(pair_error(format!("{} source is frozen", Owner::LABEL)));
    }

    let rows = sql
        .exec(
            "SELECT request_json FROM wallet_relocation_preparation WHERE id = 1",
            None,
        )?
        .to_array::<ReservationRow>()?;
    if !rows.is_empty() {
        return Err(pair_error(format!(
            "{} destination is reserved",
            Owner::LABEL
        )));
    }
    Ok(())
}

fn pair_error(message: impl Into<String>) -> worker::Error {
    worker::Error::RustError(message.into())
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ContextRequest<Owner> {
    Cipher,
    Wallet {
        owner: Owner,
        ownership_generation: u64,
    },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CipherContext {
    DeriverCipherContext {
        digest_hex: String,
    },
    DeriverWalletContext {
        digest_hex: String,
        object_id: String,
    },
}

pub(crate) async fn read_context<Owner: WalletOwner>(
    mut request: Request,
    env: &Env,
) -> worker::Result<Response> {
    if request.method() != Method::Post {
        return Response::error("Deriver encryption context requires POST", 405);
    }
    let context: ContextRequest<Owner> =
        match crate::durable_object::tenant_root_creation::decode_bounded_json_request(
            &mut request,
            8192,
        )
        .await
        {
            Ok(command) => command,
            Err(error) => return crate::router_coordinator::protocol_error_response(error),
        };
    let digest_hex = Owner::cipher(env)?.relocation_context_digest()?;
    let response = match context {
        ContextRequest::Cipher => CipherContext::DeriverCipherContext { digest_hex },
        ContextRequest::Wallet {
            owner,
            ownership_generation,
        } => {
            owner.physical_object_name(ownership_generation)?;
            let route = crate::WalletObjectRoute::from_gateway_request(&request)
                .map_err(|error| pair_error(error.to_string()))?;
            let object_id = Owner::object_id(route).as_str().to_owned();
            CipherContext::DeriverWalletContext {
                digest_hex,
                object_id,
            }
        }
    };
    Response::from_json(&response)
}

#[derive(Deserialize)]
struct PendingPairs {
    count: u64,
}

pub(crate) fn fence_settled_source<Owner: WalletOwner>(
    sql: &SqlStorage,
    command: Preparation<Owner>,
    queued_inputs: usize,
) -> worker::Result<Response> {
    sql.exec(super::registration_preparation::SCHEMA, None)?;
    snapshot::import::require_source_generation(sql, &command)?;
    let request_json =
        serde_json::to_string(&command).map_err(|error| pair_error(error.to_string()))?;
    let existing = sql
        .exec(
            "SELECT request_json FROM wallet_relocation_source WHERE id = 1",
            None,
        )?
        .to_array::<ReservationRow>()?;
    if let [row] = existing.as_slice() {
        if row.request_json != request_json {
            return Response::error("Deriver source is fenced for another move", 409);
        }
    } else {
        require_open::<Owner>(sql)?;
        let pending = sql.exec(
            "SELECT (SELECT COUNT(*) FROM yao_pair_sessions WHERE lifecycle NOT IN ('completed', 'burned', 'expired')) + \
             (SELECT COUNT(*) FROM yao_registration_preparation) + \
             (SELECT COUNT(*) FROM yao_registration_input_binding b \
              WHERE json_extract(b.use_json, '$.kind') = 'bound' \
              AND NOT EXISTS (SELECT 1 FROM yao_pair_sessions p WHERE p.session_hex = b.session_hex \
                              AND p.lifecycle IN ('completed', 'burned', 'expired')) \
              AND NOT EXISTS (SELECT 1 FROM yao_pair_admission_fences f WHERE f.session_hex = b.session_hex)) AS count",
            None,
        )?.to_array::<PendingPairs>()?;
        let [pending] = pending.as_slice() else {
            return Err(pair_error("Deriver source inventory is unavailable"));
        };
        let pending_count = pending.count
            + u64::try_from(queued_inputs).map_err(|error| pair_error(error.to_string()))?;
        if pending_count != 0 {
            return Response::from_json(&serde_json::json!({
                "kind": "pending", "pending_pairs": pending_count,
            }));
        }
        // Synchronous SQL runs without an await between the inventory check and fence.
        // Guards also cover deferred writes that entered before this request.
        for table in [
            "yao_pair_sessions",
            "yao_pair_admission_fences",
            "yao_registration_preparation",
            "yao_registration_input_binding",
        ] {
            for operation in ["INSERT", "UPDATE", "DELETE"] {
                sql.exec(&format!("CREATE TRIGGER IF NOT EXISTS relocation_source_{table}_{operation} BEFORE {operation} ON {table} WHEN EXISTS (SELECT 1 FROM wallet_relocation_source) BEGIN SELECT RAISE(ABORT, 'Deriver source is frozen'); END"), None)?;
            }
        }
        sql.exec(
            "INSERT INTO wallet_relocation_source (id, request_json) VALUES (1, ?)",
            vec![SqlStorageValue::String(request_json)],
        )?;
    }
    Response::from_json(&serde_json::json!({
        "kind": "settled_fence", "source_object": command.owner.object_name()?, "request": command,
    }))
}
