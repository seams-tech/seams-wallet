use super::pool_relocation_sqlite::Sqlite;
use router_ab_cloudflare::{
    SigningWorkerWalletOwnerStoreV1, SIGNING_WORKER_WALLET_OWNER_SCHEMA_V1,
};
use router_ab_core::RouterAbProtocolErrorCode;
use rusqlite::Connection;

fn object() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute(SIGNING_WORKER_WALLET_OWNER_SCHEMA_V1, [])
        .unwrap();
    connection
}

#[test]
fn a_wallet_object_serves_the_wallet_of_its_first_command() {
    let connection = object();
    let sql = Sqlite(&connection);
    let owner = SigningWorkerWalletOwnerStoreV1::new(&sql);

    owner.require("org/project/env/wallet-a").unwrap();
    // The same wallet keeps its object across commands.
    owner.require("org/project/env/wallet-a").unwrap();

    // An address is not authority: another wallet is refused.
    for object_name in ["org/project/env/wallet-b", "org/project/other-env/wallet-a"] {
        let refused = owner.require(object_name).unwrap_err();
        assert_eq!(
            refused.code(),
            RouterAbProtocolErrorCode::InvalidLifecycleState
        );
    }
    // A refusal changes nothing.
    owner.require("org/project/env/wallet-a").unwrap();
}

#[test]
fn each_object_records_its_own_wallet() {
    let first = object();
    let second = object();
    SigningWorkerWalletOwnerStoreV1::new(&Sqlite(&first))
        .require("org/project/env/wallet-a")
        .unwrap();
    let sql = Sqlite(&second);
    let owner = SigningWorkerWalletOwnerStoreV1::new(&sql);
    owner.require("org/project/env/wallet-b").unwrap();
    assert!(owner.require("org/project/env/wallet-a").is_err());
}
