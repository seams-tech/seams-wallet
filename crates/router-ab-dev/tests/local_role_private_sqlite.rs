use router_ab_dev::LocalRolePrivateSqliteStorageV1;
use rusqlite::Connection;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn role_private_sqlite_state_survives_reopen() -> Result<(), Box<dyn std::error::Error>> {
    let path = temp_sqlite_path("persist");
    {
        let connection = Connection::open(&path)?;
        let store = LocalRolePrivateSqliteStorageV1::new(&connection)?;
        store.put_bytes("ed25519-yao/worker-state-v1", b"role-private-state")?;
    }
    {
        let connection = Connection::open(&path)?;
        let store = LocalRolePrivateSqliteStorageV1::new(&connection)?;
        assert_eq!(
            store.get_bytes("ed25519-yao/worker-state-v1")?,
            Some(b"role-private-state".to_vec())
        );
    }
    let _ = fs::remove_file(path);
    Ok(())
}

fn temp_sqlite_path(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "router-ab-role-private-{label}-{}-{nanos}.sqlite",
        std::process::id()
    ))
}
