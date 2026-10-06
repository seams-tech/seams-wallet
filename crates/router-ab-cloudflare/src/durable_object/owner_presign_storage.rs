//! Expiry-bound identity claims for sessions sharing an owner material host.

use sha2::{Digest, Sha256};

const AUTHORITY_PREFIX: &str = "owner-presign-authority/";
const CLEANUP_BATCH_SIZE: usize = 128;

pub(super) fn authority_key(session_id: &str, expires_at_ms: u64) -> String {
    format!(
        "{AUTHORITY_PREFIX}{expires_at_ms:020}/{}",
        crate::encode_base64url_bytes_v1(&Sha256::digest(session_id.as_bytes())),
    )
}

pub(super) async fn schedule_expiry(
    storage: &worker::Storage,
    expires_at_ms: u64,
) -> worker::Result<()> {
    let deadline = i64::try_from(expires_at_ms).map_err(|_| {
        worker::Error::RustError("Presign expiry exceeds the alarm timestamp range".into())
    })?;
    if storage
        .get_alarm()
        .await?
        .is_none_or(|current| deadline < current)
    {
        let now_ms = worker::Date::now().as_millis();
        storage
            .set_alarm(std::time::Duration::from_millis(
                expires_at_ms.saturating_sub(now_ms),
            ))
            .await?;
    }
    Ok(())
}

/// Session identifiers bind their expiry. Once it passes, validation rejects reuse.
pub(super) async fn expire_authorities(
    storage: &worker::Storage,
    now_ms: u64,
) -> worker::Result<Option<u64>> {
    let records = storage
        .list_with_options(
            worker::ListOptions::new()
                .prefix(AUTHORITY_PREFIX)
                .limit(CLEANUP_BATCH_SIZE),
        )
        .await?;
    let mut expired = Vec::new();
    let mut next_expiry = None;
    for key in records.keys() {
        let key = key.map_err(worker::Error::from)?;
        let key = key.as_string().ok_or_else(|| {
            worker::Error::RustError("Presign authority storage key is invalid".into())
        })?;
        let expires_at_ms = key
            .strip_prefix(AUTHORITY_PREFIX)
            .and_then(|suffix| suffix.split_once('/'))
            .and_then(|(expiry, _)| expiry.parse::<u64>().ok())
            .ok_or_else(|| {
                worker::Error::RustError("Presign authority expiry is invalid".into())
            })?;
        if expires_at_ms > now_ms {
            next_expiry = Some(expires_at_ms);
            break;
        }
        expired.push(key);
    }
    let has_more = expired.len() == CLEANUP_BATCH_SIZE;
    if !expired.is_empty() {
        storage.delete_multiple(expired).await?;
    }
    if has_more {
        return Ok(Some(now_ms.saturating_add(1)));
    }
    Ok(next_expiry)
}
