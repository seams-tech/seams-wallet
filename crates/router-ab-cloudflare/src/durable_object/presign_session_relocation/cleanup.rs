use super::*;
use crate::durable_object::ecdsa_presign_live_session::transaction_get_optional;

const CLEANUP_KEY: &str = "linked-presign-relocation-cleanup";
const DELETE_LIMIT: usize = 128;

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Cleanup {
    Cleaning { receipt: LinkedPresignFreezeReceipt },
    Cleaned { receipt: LinkedPresignFreezeReceipt },
}

pub(super) async fn require_not_started(transaction: &worker::Transaction) -> worker::Result<()> {
    if transaction_get_optional::<Cleanup>(transaction, CLEANUP_KEY).await?.is_some() {
        return Err(transaction_error("Linked presign source cleanup already started"));
    }
    Ok(())
}

// The authenticated move coordinator supplies this receipt only after activation.
// Retain the fence and cleanup result; remove all other source session material.
pub(super) async fn advance(
    transaction: &worker::Transaction,
    receipt: LinkedPresignFreezeReceipt,
) -> worker::Result<import::Receipt> {
    match transaction_get_optional::<Cleanup>(transaction, CLEANUP_KEY).await? {
        Some(Cleanup::Cleaned { receipt: previous }) if previous == receipt => {
            return Ok(import::Receipt::Cleaned { receipt });
        }
        Some(Cleanup::Cleaning { receipt: previous }) if previous == receipt => {}
        Some(_) => return Err(transaction_error("Linked presign cleanup receipt changed")),
        None => {
            let fence = transaction_get_optional::<LinkedPresignFenceReceipt>(transaction, FENCE_KEY).await?;
            let snapshot = transaction_get_optional::<FrozenSnapshot>(transaction, SNAPSHOT_KEY).await?;
            if !fence.is_some_and(|fence| fence.command == receipt.command
                && !matches!(fence.initialization, Initialization::Imported))
                || !snapshot.is_some_and(|snapshot| snapshot.receipt == receipt)
            {
                return Err(transaction_error("Linked presign cleanup requires its frozen source"));
            }
            transaction.put(CLEANUP_KEY, &Cleanup::Cleaning { receipt: receipt.clone() }).await?;
        }
    }
    let records = transaction.list_with_options(worker::ListOptions::new().limit(DELETE_LIMIT + 2)).await?;
    let mut deleted = 0;
    for key in records.keys() {
        let key = key.map_err(worker::Error::from)?.as_string()
            .ok_or_else(|| transaction_error("Linked presign storage key is invalid"))?;
        if key == FENCE_KEY || key == CLEANUP_KEY {
            continue;
        }
        if deleted == DELETE_LIMIT {
            return Ok(import::Receipt::Cleaning);
        }
        transaction.delete(&key).await?;
        deleted += 1;
    }
    // A full page can hide more records. The next bounded call proves exhaustion.
    if records.size() as usize == DELETE_LIMIT + 2 {
        return Ok(import::Receipt::Cleaning);
    }
    transaction.put(CLEANUP_KEY, &Cleanup::Cleaned { receipt: receipt.clone() }).await?;
    Ok(import::Receipt::Cleaned { receipt })
}
