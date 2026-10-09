use super::*;

pub const SIGNING_WORKER_WALLET_OWNER_SCHEMA_V1: &str =
    "CREATE TABLE IF NOT EXISTS wallet_object_owner (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        object_name TEXT NOT NULL)";

/// The one wallet a SigningWorker wallet object serves. A derived name once
/// selected the object, so the name bound the wallet. A stored address names
/// no wallet. The object records the name that its first command derives and
/// refuses a command that derives another.
///
/// The ownership generation is not bound here: a destination object replays
/// a signature that its source generation prepared.
pub struct SigningWorkerWalletOwnerStoreV1<'a, Sql> {
    sql: &'a Sql,
}

#[derive(Deserialize)]
struct OwnerRow {
    object_name: String,
}

impl<'a, Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletOwnerStoreV1<'a, Sql> {
    pub fn new(sql: &'a Sql) -> Self {
        Self { sql }
    }

    /// `object_name` is the wallet's stable object name, the same for every
    /// ownership generation.
    pub fn require(&self, object_name: &str) -> RouterAbProtocolResult<()> {
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_object_owner (id, object_name) VALUES (1, ?)
             ON CONFLICT(id) DO NOTHING",
            vec![SigningWorkerWalletSqlValueV1::Text(object_name.to_owned())],
        )?;
        let rows = self.sql.query::<OwnerRow>(
            "SELECT object_name FROM wallet_object_owner WHERE id = 1",
            Vec::new(),
        )?;
        match rows.as_slice() {
            [row] if row.object_name == object_name => Ok(()),
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "SigningWorker wallet object serves another wallet",
            )),
        }
    }
}
