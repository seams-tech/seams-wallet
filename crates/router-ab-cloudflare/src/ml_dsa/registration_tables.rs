//! Authenticated evaluator table frames. All mutations require a storage transaction.
use super::{registration_preparation as preparation, *};
use zeroize::Zeroizing;
const DOMAIN: &[u8] = b"seams/ml-dsa/registration-table/v1";
const MAX_FRAME: usize = 65_544;
const MAX_CIRCUITS: usize = 35;
const MAX_FRAMES: usize = 8192;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Circuit {
    binding: [u8; 32],
    frames: usize,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Lifecycle {
    Writing,
    Retiring { circuit: usize, frame: usize },
    Retired,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    preparation: preparation::Binding,
    circuits: Vec<Circuit>,
    lifecycle: Lifecycle,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum FrameRecord {
    Ready {
        length: usize,
        digest: [u8; 32],
        encapsulated_key: [u8; 32],
        chunks: usize,
    },
    Consumed,
}
#[derive(Serialize)]
struct FrameBinding<'a> {
    preparation: &'a preparation::Binding,
    circuit: [u8; 32],
    ordinal: usize,
    length: usize,
}
fn prefix(binding: &preparation::Binding) -> String {
    format!("registration-tables/{}", hex(&binding.reservation))
}
fn frame_name(binding: &preparation::Binding, circuit: &[u8; 32], ordinal: usize) -> String {
    format!("{}/{}/{ordinal}", prefix(binding), hex(circuit))
}
fn frame_shape(
    binding: &preparation::Binding,
    circuit: &[u8; 32],
    ordinal: usize,
    length: usize,
) -> Result<()> {
    if binding.role != Participant::B
        || *circuit == [0; 32]
        || ordinal >= MAX_FRAMES
        || !(8..=MAX_FRAME).contains(&length)
    {
        return Err(invalid("Invalid ML-DSA registration table frame"));
    }
    Ok(())
}
/// Stores frames sequentially. Exact retries cannot overwrite an existing frame.
pub async fn put(
    store: &impl Store,
    binding: &preparation::Binding,
    circuit: [u8; 32],
    ordinal: usize,
    bytes: &[u8],
    seed: &[u8; 32],
    now: u64,
) -> Result<()> {
    preparation::valid(binding, now)?;
    frame_shape(binding, &circuit, ordinal, bytes.len())?;
    preparation::require_unpublished(store, binding).await?;
    let key = prefix(binding);
    let mut index = store.get::<Index>(&key).await?.unwrap_or(Index {
        preparation: binding.clone(),
        circuits: Vec::new(),
        lifecycle: Lifecycle::Writing,
    });
    if index.preparation != *binding || !matches!(index.lifecycle, Lifecycle::Writing) {
        return Err(invalid(
            "ML-DSA registration tables are closed or substituted",
        ));
    }
    let frame = frame_name(binding, &circuit, ordinal);
    let hash: [u8; 32] = Sha256::digest(bytes).into();
    if let Some(record) = store.get::<FrameRecord>(&frame).await? {
        return match record {
            FrameRecord::Ready { length, digest, .. }
                if length == bytes.len() && digest == hash =>
            {
                Ok(())
            }
            _ => Err(invalid("ML-DSA registration table was consumed or changed")),
        };
    }
    let position = match index
        .circuits
        .iter()
        .position(|entry| entry.binding == circuit)
    {
        Some(position) => position,
        None if index.circuits.len() < MAX_CIRCUITS => {
            index.circuits.push(Circuit {
                binding: circuit,
                frames: 0,
            });
            index.circuits.len() - 1
        }
        None => return Err(invalid("Too many ML-DSA registration circuits")),
    };
    if index.circuits[position].frames != ordinal
        || index
            .circuits
            .iter()
            .map(|entry| entry.frames)
            .sum::<usize>()
            >= MAX_FRAMES
    {
        return Err(invalid("ML-DSA registration table sequence changed"));
    }
    let aad = FrameBinding {
        preparation: binding,
        circuit,
        ordinal,
        length: bytes.len(),
    };
    let sealed = sealing::seal_bound(Zeroizing::new(bytes.to_vec()), DOMAIN, &aad, seed)?;
    let chunks = sealed
        .store_chunks(store, &format!("{frame}/ciphertext"))
        .await?;
    store
        .put(
            &frame,
            &FrameRecord::Ready {
                length: bytes.len(),
                digest: hash,
                encapsulated_key: sealed.encapsulated_key,
                chunks,
            },
        )
        .await?;
    index.circuits[position].frames += 1;
    store.put(&key, &index).await
}
/// Opens one frame only after the private preparation's consume has committed.
/// The frame consume commits before its bytes leave the adapter transaction.
pub async fn take(
    store: &impl Store,
    binding: &preparation::Binding,
    ceremony: [u8; 32],
    circuit: [u8; 32],
    ordinal: usize,
    length: usize,
    seed: &[u8; 32],
    now: u64,
) -> Result<Vec<u8>> {
    frame_shape(binding, &circuit, ordinal, length)?;
    preparation::require_consumed(store, binding, ceremony, now).await?;
    let index = store
        .get::<Index>(&prefix(binding))
        .await?
        .ok_or_else(|| invalid("Missing ML-DSA table index"))?;
    if index.preparation != *binding || !matches!(index.lifecycle, Lifecycle::Writing) {
        return Err(invalid("ML-DSA registration tables are retired"));
    }
    let name = frame_name(binding, &circuit, ordinal);
    let Some(FrameRecord::Ready {
        length: stored_length,
        encapsulated_key,
        chunks,
        ..
    }) = store.get::<FrameRecord>(&name).await?
    else {
        return Err(invalid("ML-DSA table frame is missing or consumed"));
    };
    if length != stored_length {
        return Err(invalid("ML-DSA registration table length changed"));
    }
    let prefix = format!("{name}/ciphertext");
    let sealed = sealing::Sealed::load_chunks(store, &prefix, chunks, encapsulated_key).await?;
    let aad = FrameBinding {
        preparation: binding,
        circuit,
        ordinal,
        length,
    };
    let bytes = sealing::open_bound(sealed, DOMAIN, &aad, seed)?;
    sealing::erase_chunks(store, &prefix, chunks).await?;
    store.put(&name, &FrameRecord::Consumed).await?;
    Ok(bytes.to_vec())
}
/// Retires all branches, including unused fallbacks, in bounded retryable steps.
/// True means cleanup finished. The index remains as a permanent tombstone.
pub async fn retire_next(store: &impl Store, binding: &preparation::Binding) -> Result<bool> {
    let key = prefix(binding);
    let Some(mut index) = store.get::<Index>(&key).await? else {
        store
            .put(
                &key,
                &Index {
                    preparation: binding.clone(),
                    circuits: Vec::new(),
                    lifecycle: Lifecycle::Retired,
                },
            )
            .await?;
        return Ok(true);
    };
    if index.preparation != *binding {
        return Err(invalid("ML-DSA registration table cleanup binding changed"));
    }
    let (mut circuit, mut frame) = match index.lifecycle {
        Lifecycle::Writing => (0, 0),
        Lifecycle::Retiring { circuit, frame } => (circuit, frame),
        Lifecycle::Retired => return Ok(true),
    };
    for _ in 0..32 {
        while circuit < index.circuits.len() && frame == index.circuits[circuit].frames {
            circuit += 1;
            frame = 0;
        }
        if circuit == index.circuits.len() {
            index.lifecycle = Lifecycle::Retired;
            store.put(&key, &index).await?;
            return Ok(true);
        }
        let name = frame_name(binding, &index.circuits[circuit].binding, frame);
        if let Some(FrameRecord::Ready { chunks, .. }) = store.get::<FrameRecord>(&name).await? {
            sealing::erase_chunks(store, &format!("{name}/ciphertext"), chunks).await?;
        }
        store.delete(&name).await?;
        frame += 1;
    }
    index.lifecycle = Lifecycle::Retiring { circuit, frame };
    store.put(&key, &index).await?;
    Ok(false)
}

/// The producer calls publication only after all 35 circuit preparations complete.
/// This check also prevents publishing private state after table cancellation.
pub(super) async fn require_publishable(
    store: &impl Store,
    binding: &preparation::Binding,
) -> Result<()> {
    if binding.role == Participant::A {
        return Ok(());
    }
    let index = store
        .get::<Index>(&prefix(binding))
        .await?
        .ok_or_else(|| invalid("ML-DSA registration tables are incomplete"))?;
    if index.preparation != *binding
        || !matches!(index.lifecycle, Lifecycle::Writing)
        || index.circuits.len() != MAX_CIRCUITS
        || index.circuits.iter().any(|entry| entry.frames == 0)
    {
        return Err(invalid(
            "ML-DSA registration tables are incomplete or retired",
        ));
    }
    Ok(())
}
