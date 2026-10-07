use super::*;

#[derive(Deserialize)]
struct Removed {
    #[serde(rename = "removed")]
    _removed: u8,
}

pub(super) fn cleanup<Owner: WalletOwner>(
    sql: &SqlStorage,
    activation: Activation<Owner>,
    state: Option<State<Owner>>,
) -> worker::Result<Response> {
    if activation.destination_object != activation.source.source.owner.object_name()? {
        return Err(pair_error("Deriver cleanup destination differs"));
    }
    match state {
        Some(State::Cleaned { activation: stored }) if encode(&stored)? == encode(&activation)? => {
            return Response::from_json(&serde_json::json!({"kind": "cleaned", "receipt": stored}));
        }
        Some(State::Cleaning { activation: stored })
            if encode(&stored)? == encode(&activation)? => {}
        Some(State::Frozen { receipt }) if encode(&receipt)? == encode(&activation.source)? => {}
        _ => {
            return Err(pair_error(
                "Deriver cleanup requires its sealed snapshot and activation receipt",
            ))
        }
    }
    import::ensure_schema(sql)?;
    // Cleanup runs in the snapshot transaction without an await. The source fence
    // is restored before commit, including when the remaining inventory is empty.
    sql.exec("DELETE FROM wallet_relocation_source WHERE id = 1", None)?;
    let mut removed = false;
    for (table, key) in [
        ("yao_pair_sessions", "session_hex"),
        ("yao_pair_admission_fences", "session_hex"),
        ("wallet_relocation_snapshot_segments", "segment_index"),
        ("wallet_relocation_import_segments", "segment_index"),
    ] {
        let rows = sql.exec(&format!("DELETE FROM {table} WHERE {key} IN (SELECT {key} FROM {table} ORDER BY {key} LIMIT 16) RETURNING 1 AS removed"), None)?.to_array::<Removed>()?;
        if !rows.is_empty() {
            removed = true;
            break;
        }
    }
    sql.exec(
        "INSERT INTO wallet_relocation_source (id, request_json) VALUES (1, ?)",
        vec![SqlStorageValue::String(encode(&activation.source.source)?)],
    )?;
    let state = if removed {
        State::Cleaning { activation }
    } else {
        State::Cleaned { activation }
    };
    sql.exec(
        "UPDATE wallet_relocation_snapshot SET state_json = ? WHERE id = 1",
        vec![SqlStorageValue::String(encode(&state)?)],
    )?;
    match state {
        State::Cleaning { activation } => {
            Response::from_json(&serde_json::json!({"kind": "cleaning", "receipt": activation}))
        }
        State::Cleaned { activation } => {
            Response::from_json(&serde_json::json!({"kind": "cleaned", "receipt": activation}))
        }
        _ => Err(pair_error("Deriver cleanup did not retain its state")),
    }
}
