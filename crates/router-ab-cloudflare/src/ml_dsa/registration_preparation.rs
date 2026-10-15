//! Generic registration preparation. Each adapter call runs in one storage transaction.
//! Trusted admission owns the pool scope, role, schedule, expiry, and ceremony identity.
use super::*;
use zeroize::Zeroizing;
const DOMAIN: &[u8] = b"seams/ml-dsa/registration-preparation/v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub pool_scope: [u8; 32],
    pub role: Participant,
    pub reservation: [u8; 32],
    pub schedule_digest: [u8; 32],
    pub expires_at_ms: u64,
    pub wrapping_key_version: Identifier,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Record {
    Ready {
        binding: Binding,
        encapsulated_key: [u8; 32],
        chunks: usize,
        envelope_digest: [u8; 32],
    },
    Consumed {
        binding: Binding,
        ceremony: [u8; 32],
    },
}
fn name(binding: &Binding) -> String {
    format!("registration-preparation/{}", hex(&binding.reservation))
}
pub(super) fn valid(binding: &Binding, now: u64) -> Result<()> {
    if binding.pool_scope == [0; 32]
        || binding.reservation == [0; 32]
        || binding.schedule_digest == [0; 32]
        || now >= binding.expires_at_ms
    {
        return Err(invalid(
            "Invalid or expired ML-DSA registration preparation",
        ));
    }
    Ok(())
}
pub fn seal(
    bytes: Zeroizing<Vec<u8>>,
    binding: &Binding,
    seed: &[u8; 32],
) -> Result<sealing::Sealed> {
    sealing::seal_bound(bytes, DOMAIN, binding, seed)
}
/// Call only on an envelope returned by a committed consume transaction.
pub fn open(
    sealed: sealing::Sealed,
    binding: &Binding,
    seed: &[u8; 32],
) -> Result<Zeroizing<Vec<u8>>> {
    sealing::open_bound(sealed, DOMAIN, binding, seed)
}
pub async fn publish(
    store: &impl Store,
    binding: Binding,
    sealed: sealing::Sealed,
    now: u64,
) -> Result<()> {
    valid(&binding, now)?;
    sealed.validate()?;
    super::registration_tables::require_publishable(store, &binding).await?;
    let owner = (binding.pool_scope, binding.role);
    if let Some(current) = store
        .get::<([u8; 32], Participant)>("registration-preparation-owner")
        .await?
    {
        if current != owner {
            return Err(invalid(
                "ML-DSA registration pool belongs to another scope or role",
            ));
        }
    }
    let key = name(&binding);
    if let Some(current) = store.get::<Record>(&key).await? {
        if let Record::Ready {
            binding: existing,
            envelope_digest,
            ..
        } = current
        {
            if existing == binding && envelope_digest == digest(DOMAIN, &sealed)? {
                return Ok(());
            }
        }
        return Err(invalid(
            "ML-DSA registration preparation already exists or was consumed",
        ));
    }
    store.put("registration-preparation-owner", &owner).await?;
    let chunks = sealed
        .store_chunks(store, &format!("{key}/ciphertext"))
        .await?;
    let envelope_digest = digest(DOMAIN, &sealed)?;
    store
        .put(
            &key,
            &Record::Ready {
                binding,
                encapsulated_key: sealed.encapsulated_key,
                chunks,
                envelope_digest,
            },
        )
        .await
}
/// The tombstone commits before the caller can open private preparation.
/// An interrupted or unsuccessful ceremony must obtain a fresh reservation.
pub async fn consume(
    store: &impl Store,
    expected: &Binding,
    ceremony: [u8; 32],
    now: u64,
) -> Result<sealing::Sealed> {
    valid(expected, now)?;
    if ceremony == [0; 32] {
        return Err(invalid("ML-DSA registration requires a ceremony identity"));
    }
    let key = name(expected);
    let Some(Record::Ready {
        binding,
        encapsulated_key,
        chunks,
        ..
    }) = store.get::<Record>(&key).await?
    else {
        return Err(invalid("ML-DSA registration preparation unavailable"));
    };
    if binding != *expected {
        return Err(invalid("ML-DSA registration preparation binding changed"));
    }
    super::registration_tables::require_publishable(store, expected).await?;
    let prefix = format!("{key}/ciphertext");
    let sealed = sealing::Sealed::load_chunks(store, &prefix, chunks, encapsulated_key).await?;
    sealing::erase_chunks(store, &prefix, chunks).await?;
    store
        .put(&key, &Record::Consumed { binding, ceremony })
        .await?;
    Ok(sealed)
}

pub(super) async fn require_unpublished(store: &impl Store, binding: &Binding) -> Result<()> {
    if store.get::<Record>(&name(binding)).await?.is_some() {
        return Err(invalid(
            "ML-DSA registration preparation is already published",
        ));
    }
    Ok(())
}
pub(super) async fn require_consumed(
    store: &impl Store,
    expected: &Binding,
    ceremony: [u8; 32],
    now: u64,
) -> Result<()> {
    valid(expected, now)?;
    match store.get::<Record>(&name(expected)).await? {
        Some(Record::Consumed {
            binding,
            ceremony: actual,
        }) if binding == *expected && actual == ceremony => Ok(()),
        _ => Err(invalid(
            "ML-DSA registration preparation has no matching consume",
        )),
    }
}
