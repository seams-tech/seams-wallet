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

const COMPLETED_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_relocation_completed_cleanup (
    move_id TEXT PRIMARY KEY, activation_json TEXT NOT NULL)";

#[derive(Deserialize)]
struct CompletedCleanup {
    activation_json: String,
}

pub(super) fn completed<Owner: WalletOwner>(
    sql: &SqlStorage,
    activation: &Activation<Owner>,
) -> worker::Result<bool> {
    sql.exec(COMPLETED_SCHEMA, None)?;
    let rows = sql
        .exec(
            "SELECT activation_json FROM wallet_relocation_completed_cleanup WHERE move_id = ?",
            vec![SqlStorageValue::String(
                activation.source.source.move_id.clone(),
            )],
        )?
        .to_array::<CompletedCleanup>()?;
    let Some(row) = rows.first() else {
        return Ok(false);
    };
    if row.activation_json != encode(activation)? {
        return Err(pair_error("Deriver completed cleanup identity differs"));
    }
    Ok(true)
}

pub(crate) fn prepare_return<Owner: WalletOwner>(
    sql: &SqlStorage,
    command: &Preparation<Owner>,
) -> worker::Result<()> {
    sql.exec(STATE_SCHEMA, None)?;
    let rows = sql
        .exec(
            "SELECT state_json FROM wallet_relocation_snapshot WHERE id = 1",
            None,
        )?
        .to_array::<StateRow>()?;
    let Some(row) = rows.first() else {
        return Ok(());
    };
    let state: State<Owner> = serde_json::from_str(&row.state_json).map_err(encoding_error)?;
    let State::Cleaned { activation } = state else {
        return Ok(());
    };
    let previous = &activation.source.source;
    if encode(&previous.owner)? != encode(&command.owner)?
        || command.source_generation <= previous.source_generation
        || command.move_id == previous.move_id
    {
        return Err(pair_error(
            "Deriver return requires a newer ownership generation",
        ));
    }
    sql.exec(COMPLETED_SCHEMA, None)?;
    sql.exec(
        "INSERT INTO wallet_relocation_completed_cleanup (move_id, activation_json) VALUES (?, ?)",
        vec![
            SqlStorageValue::String(previous.move_id.clone()),
            SqlStorageValue::String(encode(&activation)?),
        ],
    )?;
    import::ensure_schema(sql)?;
    for table in [
        "wallet_relocation_source",
        "wallet_relocation_snapshot",
        "wallet_relocation_import",
    ] {
        sql.exec(&format!("DELETE FROM {table} WHERE id = 1"), None)?;
    }
    Ok(())
}
