//! Bounded multipart writes and one streamed R2 read per online table group.

use super::failure;
use serde_json::{json, Value};
use wasm_bindgen::{JsCast, JsValue};
use worker::js_sys::{Function, Object, Promise, Reflect, Uint8Array};
use worker::wasm_bindgen_futures::JsFuture;
use worker::{Bucket, MultipartUpload, ResponseBody, UploadedPart};

const FRAME_BYTES: usize = 65544;
const PART_BYTES: usize = 5 * 1024 * 1024;
const MAX_GROUP_BYTES: usize = 64 * 1024 * 1024;

struct TableReader {
    reader: JsValue,
    read_at_least: Function,
    release_lock: Function,
}
impl TableReader {
    fn new(body: ResponseBody) -> worker::Result<Self> {
        let ResponseBody::Stream(stream) = body else {
            return Err(failure("Prepared table body is not a stream."));
        };
        let options = Object::new();
        Reflect::set(&options, &"mode".into(), &"byob".into())?;
        let get_reader = Reflect::get(&stream, &"getReader".into())?.dyn_into::<Function>()?;
        let reader = get_reader.call1(&stream, &options)?;
        let read_at_least = Reflect::get(&reader, &"readAtLeast".into())?.dyn_into::<Function>()?;
        let release_lock = Reflect::get(&reader, &"releaseLock".into())?.dyn_into::<Function>()?;
        Ok(Self {
            reader,
            read_at_least,
            release_lock,
        })
    }
    async fn read(&self, length: usize) -> worker::Result<Option<Vec<u8>>> {
        if length == 0 || length > FRAME_BYTES {
            return Err(failure("Prepared stream read exceeds one frame."));
        }
        // The runtime transfers this buffer. Never expose Wasm linear memory.
        let buffer = Uint8Array::new_with_length(length as u32);
        let promise = self
            .read_at_least
            .call2(&self.reader, &JsValue::from(length as u32), &buffer)?
            .dyn_into::<Promise>()?;
        let result = JsFuture::from(promise).await?;
        let done = Reflect::get(&result, &"done".into())?
            .as_bool()
            .ok_or_else(|| failure("Prepared stream result has no done state."))?;
        let value = Reflect::get(&result, &"value".into())?;
        if done && value.is_undefined() {
            return Ok(None);
        }
        let bytes = value.dyn_into::<Uint8Array>()?;
        if done && bytes.length() == 0 {
            return Ok(None);
        }
        if done || bytes.length() as usize > length {
            return Err(failure("Prepared stream result has an invalid length."));
        }
        Ok(Some(bytes.to_vec()))
    }
}
impl Drop for TableReader {
    fn drop(&mut self) {
        let _ = self.release_lock.call0(&self.reader);
    }
}

#[derive(Clone, Copy)]
pub(super) enum Layout {
    /// The first thirteen circuits share a stream. Each fallback stands alone.
    Keygen,
    /// Each candidate's thirteen online circuits share one stream.
    Signing,
}
impl Layout {
    fn group(self, index: usize) -> usize {
        match self {
            Self::Keygen if index < 13 => 0,
            Self::Keygen => index - 12,
            Self::Signing => index / 13,
        }
    }
}
struct Location {
    binding: [u8; 32],
    group: usize,
    offset: usize,
    length: usize,
    frames: usize,
    read_frames: usize,
}
struct Group {
    key: String,
    length: usize,
}
struct Writing {
    index: usize,
    key: String,
    upload: MultipartUpload,
    parts: Vec<UploadedPart>,
    pending: Vec<u8>,
    length: usize,
}
struct Reading {
    group: usize,
    offset: usize,
    stream: GroupReader,
}

pub(super) struct Tables {
    bucket: Bucket,
    prefix: String,
    layout: Layout,
    writing: Option<Writing>,
    groups: Vec<Group>,
    locations: Vec<Location>,
    reading: Vec<Reading>,
    gets: usize,
    resident_bytes: usize,
    parts: usize,
    read_bytes: usize,
    chunks: usize,
    largest_chunk: usize,
}
impl Tables {
    #[cfg(feature = "ml-dsa-b")]
    pub(super) fn new(bucket: Bucket, run_id: &str, layout: Layout) -> Self {
        Self {
            bucket,
            prefix: format!("{run_id}/"),
            layout,
            writing: None,
            groups: Vec::new(),
            locations: Vec::new(),
            reading: Vec::new(),
            gets: 0,
            resident_bytes: 0,
            parts: 0,
            read_bytes: 0,
            chunks: 0,
            largest_chunk: 0,
        }
    }
    /// Reads only input-independent tables before declaring a live reservation ready.
    /// The JS buffer avoids a second full-size copy into Wasm linear memory.
    #[cfg(feature = "ml-dsa-b")]
    pub(super) async fn preload_first(&mut self) -> worker::Result<()> {
        if self.writing.is_some() || !self.reading.is_empty() || self.gets != 0 {
            return Err(failure(
                "Resident preparation requires completed, unread groups.",
            ));
        }
        let group = self
            .groups
            .first()
            .ok_or_else(|| failure("No prepared table group."))?;
        let object = self
            .bucket
            .get(&group.key)
            .execute()
            .await?
            .ok_or_else(|| failure("Prepared group is absent."))?;
        if object.size() as usize != group.length {
            return Err(failure("Prepared group length changed."));
        }
        let ResponseBody::Stream(stream) = object
            .body()
            .ok_or_else(|| failure("Prepared group has no body."))?
            .response_body()?
        else {
            return Err(failure("Prepared group body is not a stream."));
        };
        let response = worker::web_sys::Response::new_with_opt_readable_stream(Some(&stream))?;
        let buffer = JsFuture::from(response.array_buffer()?).await?;
        let bytes = Uint8Array::new(&buffer);
        if bytes.length() as usize != group.length {
            return Err(failure("Resident group length changed."));
        }
        self.resident_bytes = group.length;
        self.gets += 1;
        self.reading.push(Reading {
            group: 0,
            offset: 0,
            stream: GroupReader::Resident { bytes, position: 0 },
        });
        Ok(())
    }
    pub(super) async fn store(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        bytes: &[u8],
    ) -> worker::Result<()> {
        if bytes.is_empty() || bytes.len() > FRAME_BYTES {
            return Err(failure("Invalid table frame size."));
        }
        let same = self
            .locations
            .last()
            .is_some_and(|location| location.binding == binding);
        if !same {
            if ordinal != 0
                || self
                    .locations
                    .iter()
                    .any(|location| location.binding == binding)
            {
                return Err(failure("A table must start once at frame zero."));
            }
            let group = self.layout.group(self.locations.len());
            if self
                .writing
                .as_ref()
                .is_some_and(|writing| writing.index != group)
            {
                self.flush().await?;
            }
            if self.writing.is_none() {
                if group != self.groups.len() {
                    return Err(failure("Table group order changed."));
                }
                let key = format!("{}group-{group}", self.prefix);
                let upload = self.bucket.create_multipart_upload(&key).execute().await?;
                self.writing = Some(Writing {
                    index: group,
                    key,
                    upload,
                    parts: Vec::new(),
                    pending: Vec::with_capacity(PART_BYTES),
                    length: 0,
                });
            }
            let writing = self
                .writing
                .as_ref()
                .ok_or_else(|| failure("Missing group writer."))?;
            self.locations.push(Location {
                binding,
                group,
                offset: writing.length,
                length: 0,
                frames: 0,
                read_frames: 0,
            });
        }
        let location = self
            .locations
            .last_mut()
            .ok_or_else(|| failure("Missing table location."))?;
        if ordinal != location.frames {
            return Err(failure("Table frame order changed."));
        }
        let writing = self
            .writing
            .as_mut()
            .ok_or_else(|| failure("Missing group writer."))?;
        if writing.length + bytes.len() > MAX_GROUP_BYTES {
            return Err(failure("Table group exceeds its size bound."));
        }
        location.frames += 1;
        location.length += bytes.len();
        writing.length += bytes.len();
        let mut remaining = bytes;
        while !remaining.is_empty() {
            let take = remaining.len().min(PART_BYTES - writing.pending.len());
            writing.pending.extend_from_slice(&remaining[..take]);
            remaining = &remaining[take..];
            if writing.pending.len() == PART_BYTES {
                upload_part(writing).await?;
                self.parts += 1;
            }
        }
        Ok(())
    }
    pub(super) async fn flush(&mut self) -> worker::Result<()> {
        let Some(writing) = self.writing.as_mut() else {
            return Ok(());
        };
        if !writing.pending.is_empty() {
            upload_part(writing).await?;
            self.parts += 1;
        }
        let upload_id = writing.upload.upload_id().await;
        let completing = self
            .bucket
            .resume_multipart_upload(&writing.key, upload_id)?;
        let parts = std::mem::take(&mut writing.parts);
        // Cancellation must leave the original upload and key available to cleanup.
        completing.complete(parts).await?;
        let writing = self
            .writing
            .take()
            .ok_or_else(|| failure("Missing completed writer."))?;
        self.groups.push(Group {
            key: writing.key,
            length: writing.length,
        });
        Ok(())
    }
    pub(super) async fn load(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        length: usize,
    ) -> worker::Result<Vec<u8>> {
        let location_index = self
            .locations
            .iter()
            .position(|location| location.binding == binding)
            .ok_or_else(|| failure("Unreserved table binding."))?;
        let location = &self.locations[location_index];
        if ordinal != location.read_frames || ordinal >= location.frames || length > FRAME_BYTES {
            return Err(failure("Table read order or size changed."));
        }
        let group_index = location.group;
        let expected_offset = location.offset + ordinal * FRAME_BYTES;
        let group = self
            .groups
            .get(group_index)
            .ok_or_else(|| failure("Group is not ready."))?;
        let stream_index = match self
            .reading
            .iter()
            .position(|read| read.group == group_index)
        {
            Some(index) => index,
            None => {
                if expected_offset != 0 || self.reading.len() >= 2 {
                    return Err(failure("Group read skipped data or exceeded two streams."));
                }
                let object = self
                    .bucket
                    .get(&group.key)
                    .execute()
                    .await?
                    .ok_or_else(|| failure("Prepared group is absent."))?;
                if object.size() as usize != group.length {
                    return Err(failure("Prepared group length changed."));
                }
                let stream = TableReader::new(
                    object
                        .body()
                        .ok_or_else(|| failure("Prepared group has no body."))?
                        .response_body()?,
                )?;
                self.reading.push(Reading {
                    group: group_index,
                    offset: 0,
                    stream: GroupReader::Stream(stream),
                });
                self.gets += 1;
                self.reading.len() - 1
            }
        };
        let read = &mut self.reading[stream_index];
        if read.offset != expected_offset
            || read.offset + length > location.offset + location.length
        {
            return Err(failure("Table read crossed its reserved range."));
        }
        let bytes = read
            .stream
            .read(length)
            .await?
            .ok_or_else(|| failure("Prepared group ended early."))?;
        if bytes.len() != length {
            return Err(failure("Prepared group returned a partial frame."));
        }
        read.offset += length;
        self.locations[location_index].read_frames += 1;
        self.read_bytes += length;
        self.chunks += 1;
        self.largest_chunk = self.largest_chunk.max(length);
        if read.offset == group.length {
            if read.stream.read(1).await?.is_some() {
                return Err(failure("Prepared group has trailing data."));
            }
            self.reading.remove(stream_index);
        }
        Ok(bytes)
    }
    #[cfg(feature = "ml-dsa-b")]
    pub(super) fn finish_reads(&self) -> worker::Result<()> {
        if !self.reading.is_empty() {
            return Err(failure("Prepared group did not reach exact EOF."));
        }
        Ok(())
    }
    pub(super) fn report(&self) -> Value {
        let start_policy = if self.resident_bytes == 0 {
            "all-groups-stream-online"
        } else {
            "first-group-resident-before-admission"
        };
        json!({"objects_written": self.groups.len(), "objects_read": self.gets,
            "objects_read_before_admission": usize::from(self.resident_bytes != 0),
            "objects_read_online": self.gets - usize::from(self.resident_bytes != 0),
            "resident_table_bytes_before_admission": self.resident_bytes,
            "table_bytes_written": self.groups.iter().map(|group| group.length).sum::<usize>(),
            "table_bytes_read": self.read_bytes, "stream_chunks": self.chunks,
            "largest_stream_chunk_bytes": self.largest_chunk, "multipart_parts": self.parts,
            "maximum_write_buffer_bytes": PART_BYTES, "maximum_read_bytes": FRAME_BYTES,
            "reader": "byob-read-at-least", "source_bound_open_table_streams": 2,
            "storage_start_policy": start_policy, "scope": "Read counts separate pre-admission resident loading from online streaming. The writer buffers at most one five-MiB Rust part. Online frame copies are bounded. Resident bytes are explicit; total runtime memory is not measured."})
    }
    #[cfg(feature = "ml-dsa-b")]
    pub(super) async fn cleanup(&self) -> worker::Result<()> {
        let aborted = match &self.writing {
            Some(writing) => writing.upload.abort().await,
            None => Ok(()),
        };
        let mut keys: Vec<_> = self.groups.iter().map(|group| group.key.clone()).collect();
        if let Some(writing) = &self.writing {
            keys.push(writing.key.clone());
        }
        if !keys.is_empty() {
            self.bucket.delete_multiple(keys).await?;
        }
        // Delete a possibly committed object even if the abort outcome is unknown.
        // An abort error still prevents a successful cleanup acknowledgement.
        aborted
    }
}
async fn upload_part(writing: &mut Writing) -> worker::Result<()> {
    let bytes = std::mem::take(&mut writing.pending);
    let number = u16::try_from(writing.parts.len() + 1).map_err(super::runtime_failure)?;
    writing
        .parts
        .push(writing.upload.upload_part(number, bytes).await?);
    writing.pending = Vec::with_capacity(PART_BYTES);
    Ok(())
}

enum GroupReader {
    Stream(TableReader),
    Resident { bytes: Uint8Array, position: usize },
}
impl GroupReader {
    async fn read(&mut self, length: usize) -> worker::Result<Option<Vec<u8>>> {
        match self {
            Self::Stream(stream) => stream.read(length).await,
            Self::Resident { bytes, position } => {
                if length == 0 || length > FRAME_BYTES {
                    return Err(failure("Invalid resident frame size."));
                }
                if *position == bytes.length() as usize {
                    return Ok(None);
                }
                let end = (*position + length).min(bytes.length() as usize);
                let output = bytes.subarray(*position as u32, end as u32).to_vec();
                *position = end;
                Ok(Some(output))
            }
        }
    }
}
