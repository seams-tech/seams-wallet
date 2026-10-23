//! Authenticated evaluator table frames. All mutations require a storage transaction.
use super::{registration_preparation as preparation, *};
use hmac::{Hmac, Mac};
use std::collections::VecDeque;
use zeroize::Zeroizing;
const DOMAIN: &[u8] = b"seams/ml-dsa/public-registration-table/v1";
const KEY_DOMAIN: &[u8] = b"seams/ml-dsa/registration-table-auth-key/v1";
pub(super) const MAX_FRAME: usize = 65_544;
const MAX_CIRCUITS: usize = 35;
const MAX_FRAMES: usize = 8192;
const READ_BATCH_FRAMES: usize = 32;

/// A committed consume result. Dropping unused frames burns them permanently.
/// This handle cannot be cloned or serialized back into reusable preparation.
pub struct ConsumedFrames {
    circuit: [u8; 32],
    next_ordinal: usize,
    frames: VecDeque<Zeroizing<Vec<u8>>>,
}
impl ConsumedFrames {
    pub fn remaining(&self) -> usize {
        self.frames.len()
    }
    pub fn next(&mut self, circuit: [u8; 32], ordinal: usize, length: usize) -> Result<Vec<u8>> {
        if circuit != self.circuit
            || ordinal != self.next_ordinal
            || self.frames.front().map(|frame| frame.len()) != Some(length)
        {
            return Err(invalid("Consumed ML-DSA table coordinates changed"));
        }
        let frame = self
            .frames
            .pop_front()
            .ok_or_else(|| invalid("Consumed ML-DSA table batch is empty"))?;
        self.next_ordinal += 1;
        Ok(frame.to_vec())
    }
}

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
        authentication: [u8; 32],
        chunks: usize,
    },
    Consumed,
}
struct StoredFrame {
    key: String,
    ordinal: usize,
    length: usize,
    authentication: [u8; 32],
    chunks: usize,
}

#[derive(Serialize)]
struct FrameBinding<'a> {
    preparation: &'a preparation::Binding,
    circuit: [u8; 32],
    ordinal: usize,
    length: usize,
}
fn authenticator(
    seed: &[u8; 32],
    binding: &FrameBinding<'_>,
    bytes: &[u8],
) -> Result<Hmac<Sha256>> {
    let mut key = Zeroizing::new([0u8; 32]);
    hkdf::Hkdf::<Sha256>::new(Some(KEY_DOMAIN), seed)
        .expand(DOMAIN, key.as_mut())
        .map_err(|_| invalid("ML-DSA table authentication key failed"))?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_ref())
        .map_err(|_| invalid("ML-DSA table authentication key failed"))?;
    mac.update(DOMAIN);
    mac.update(&digest(DOMAIN, binding)?);
    mac.update(bytes);
    Ok(mac)
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
    // Only garbled AND ciphertexts and their public frame header enter this store.
    let authentication = authenticator(seed, &aad, bytes)?
        .finalize()
        .into_bytes()
        .into();
    let chunks = sealing::write_chunks(store, &format!("{frame}/data"), bytes).await?;
    store
        .put(
            &frame,
            &FrameRecord::Ready {
                length: bytes.len(),
                digest: hash,
                authentication,
                chunks,
            },
        )
        .await?;
    index.circuits[position].frames += 1;
    store.put(&key, &index).await
}
/// Authenticates at most 32 contiguous frames after the private preparation consume.
/// All frame consumes must commit before this result leaves the adapter transaction.
pub async fn take(
    store: &impl Store,
    binding: &preparation::Binding,
    ceremony: [u8; 32],
    circuit: [u8; 32],
    ordinal: usize,
    length: usize,
    seed: &[u8; 32],
    now: u64,
) -> Result<ConsumedFrames> {
    frame_shape(binding, &circuit, ordinal, length)?;
    preparation::require_consumed(store, binding, ceremony, now).await?;
    let index = store
        .get::<Index>(&prefix(binding))
        .await?
        .ok_or_else(|| invalid("Missing ML-DSA table index"))?;
    if index.preparation != *binding || !matches!(index.lifecycle, Lifecycle::Writing) {
        return Err(invalid("ML-DSA registration tables are retired"));
    }
    let frame_count = index
        .circuits
        .iter()
        .find(|entry| entry.binding == circuit)
        .map(|entry| entry.frames)
        .ok_or_else(|| invalid("Missing ML-DSA table circuit"))?;
    if ordinal >= frame_count || frame_count > MAX_FRAMES {
        return Err(invalid("Invalid ML-DSA table position"));
    }
    let end = frame_count.min(ordinal + READ_BATCH_FRAMES);
    let mut stored_frames = Vec::with_capacity(end - ordinal);
    let mut chunk_keys = Vec::new();
    for position in ordinal..end {
        let key = frame_name(binding, &circuit, position);
        let Some(FrameRecord::Ready {
            length: stored_length,
            authentication,
            chunks,
            ..
        }) = store.get::<FrameRecord>(&key).await?
        else {
            return Err(invalid("ML-DSA table frame is missing or consumed"));
        };
        frame_shape(binding, &circuit, position, stored_length)?;
        if position == ordinal && length != stored_length {
            return Err(invalid("ML-DSA registration table length changed"));
        }
        if chunks != stored_length.div_ceil(sealing::CHUNK_BYTES) {
            return Err(invalid("Invalid ML-DSA table chunk count"));
        }
        for chunk in 0..chunks {
            chunk_keys.push(format!("{key}/data/{chunk}"));
        }
        stored_frames.push(StoredFrame {
            key,
            ordinal: position,
            length: stored_length,
            authentication,
            chunks,
        });
    }
    // The existing 32-frame cache requires at most 64 stored chunks.
    let chunks = store.get_chunks(&chunk_keys, sealing::CHUNK_BYTES).await?;
    if chunks.len() != chunk_keys.len() {
        return Err(invalid("Invalid ML-DSA table chunk response length"));
    }
    let mut chunks = chunks.into_iter();
    let mut frames = VecDeque::with_capacity(stored_frames.len());
    for frame in &stored_frames {
        let mut bytes = Zeroizing::new(Vec::with_capacity(frame.length));
        for _ in 0..frame.chunks {
            let chunk = chunks
                .next()
                .flatten()
                .ok_or_else(|| invalid("Missing ML-DSA table chunk"))?;
            if chunk.len() > sealing::CHUNK_BYTES || bytes.len() + chunk.len() > frame.length {
                return Err(invalid("Oversized ML-DSA table chunk"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.len() != frame.length {
            return Err(invalid("Invalid ML-DSA table frame length"));
        }
        let aad = FrameBinding {
            preparation: binding,
            circuit,
            ordinal: frame.ordinal,
            length: frame.length,
        };
        authenticator(seed, &aad, &bytes)?
            .verify_slice(&frame.authentication)
            .map_err(|_| invalid("ML-DSA table authentication failed"))?;
        frames.push_back(bytes);
    }
    // Every authentication and consume must succeed in the caller's transaction.
    store.delete_many(&chunk_keys).await?;
    for frame in stored_frames {
        store.put(&frame.key, &FrameRecord::Consumed).await?;
    }
    Ok(ConsumedFrames {
        circuit,
        next_ordinal: ordinal,
        frames,
    })
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
            sealing::erase_chunks(store, &format!("{name}/data"), chunks).await?;
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
