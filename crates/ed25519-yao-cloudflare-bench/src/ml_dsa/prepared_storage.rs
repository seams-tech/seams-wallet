//! R2 stores one bounded table object per prepared circuit. Online reads stream.

use futures_channel::oneshot;
use serde_json::{json, Value};
use wasm_bindgen::{JsCast, JsValue};
use worker::js_sys::{Function, Object, Promise, Reflect, Uint8Array};
use worker::wasm_bindgen_futures::JsFuture;
use worker::{Bucket, ResponseBody};

use super::{encode_hex, failure};

const MAX_OBJECT_BYTES: usize = 10 * 1024 * 1024;
const FRAME_BYTES: usize = 65544;
// Wallet derivation, seed expansion, and eleven two-block samplers precede fallbacks.
const NORMAL_PATH_TABLES: usize = 13;

enum WriteState {
    Empty,
    Collecting {
        binding: [u8; 32],
        next_ordinal: usize,
        bytes: Vec<u8>,
    },
}
enum ReadState {
    Empty,
    Streaming {
        binding: [u8; 32],
        next_ordinal: usize,
        remaining: usize,
        stream: TableReader,
    },
}

// A normal reader returns 4 KiB chunks on hosted R2. readAtLeast fills one
// bounded frame before returning to Wasm, without buffering a complete object.
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

struct OpenedTable {
    size: usize,
    stream: TableReader,
    get_observed_ms: f64,
}
struct PrefetchedTable {
    key: String,
    response: oneshot::Receiver<worker::Result<OpenedTable>>,
}
async fn open_table(bucket: &Bucket, key: &str) -> worker::Result<OpenedTable> {
    let started = super::clock_ms();
    let object = bucket
        .get(key)
        .execute()
        .await?
        .ok_or_else(|| failure("Prepared table is absent."))?;
    let get_observed_ms = super::clock_ms() - started;
    let size = usize::try_from(object.size()).map_err(super::runtime_failure)?;
    if size == 0 || size > MAX_OBJECT_BYTES {
        return Err(failure("Prepared table size is invalid."));
    }
    let stream = TableReader::new(
        object
            .body()
            .ok_or_else(|| failure("Prepared table has no body."))?
            .response_body()?,
    )?;
    Ok(OpenedTable {
        size,
        stream,
        get_observed_ms,
    })
}
async fn prefetch_table(
    bucket: Bucket,
    key: String,
    sender: oneshot::Sender<worker::Result<OpenedTable>>,
) {
    let result = open_table(&bucket, &key).await;
    let _ = sender.send(result);
}

pub(super) struct Tables {
    bucket: Bucket,
    prefix: String,
    write: WriteState,
    read: ReadState,
    prefetched: Option<PrefetchedTable>,
    prefetch_started: usize,
    prefetch_hits: usize,
    keys: Vec<String>,
    puts: usize,
    gets: usize,
    written: usize,
    read_bytes: usize,
    chunks: usize,
    largest_chunk: usize,
    get_observed_ms: f64,
    read_wait_observed_ms: f64,
}
impl Tables {
    #[cfg(feature = "ml-dsa-b")]
    pub(super) fn new(bucket: Bucket, run_id: &str) -> Self {
        Self {
            bucket,
            prefix: format!("{run_id}/"),
            write: WriteState::Empty,
            read: ReadState::Empty,
            prefetched: None,
            prefetch_started: 0,
            prefetch_hits: 0,
            keys: Vec::new(),
            puts: 0,
            gets: 0,
            written: 0,
            read_bytes: 0,
            chunks: 0,
            largest_chunk: 0,
            get_observed_ms: 0.0,
            read_wait_observed_ms: 0.0,
        }
    }
    pub(super) async fn store(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        bytes: &[u8],
    ) -> worker::Result<()> {
        let same = matches!(&self.write, WriteState::Collecting { binding: current, .. } if *current == binding);
        if !same {
            self.flush().await?;
            if ordinal != 0 {
                return Err(failure("A prepared table must begin at frame zero."));
            }
            self.write = WriteState::Collecting {
                binding,
                next_ordinal: 0,
                bytes: Vec::new(),
            };
        }
        let WriteState::Collecting {
            next_ordinal,
            bytes: output,
            ..
        } = &mut self.write
        else {
            unreachable!("initialized table")
        };
        if ordinal != *next_ordinal || output.len() + bytes.len() > MAX_OBJECT_BYTES {
            return Err(failure(
                "The prepared table write exceeds its order or size bound.",
            ));
        }
        output.extend_from_slice(bytes);
        *next_ordinal += 1;
        Ok(())
    }
    pub(super) async fn flush(&mut self) -> worker::Result<()> {
        if let WriteState::Collecting { binding, bytes, .. } =
            std::mem::replace(&mut self.write, WriteState::Empty)
        {
            let key = format!("{}{}", self.prefix, encode_hex(&binding));
            let length = bytes.len();
            self.bucket.put(&key, bytes).execute().await?;
            self.keys.push(key);
            self.puts += 1;
            self.written += length;
        }
        Ok(())
    }
    pub(super) async fn load(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        length: usize,
    ) -> worker::Result<Vec<u8>> {
        let same = matches!(&self.read, ReadState::Streaming { binding: current, .. } if *current == binding);
        if !same {
            if !matches!(self.read, ReadState::Empty) || ordinal != 0 {
                return Err(failure("A prepared table read changed before exact EOF."));
            }
            let key = format!("{}{}", self.prefix, encode_hex(&binding));
            let opened = match self.prefetched.take() {
                Some(prefetched) if prefetched.key == key => {
                    self.prefetch_hits += 1;
                    prefetched
                        .response
                        .await
                        .map_err(super::runtime_failure)??
                }
                Some(prefetched) => {
                    // A rare continuation can interrupt the normal order. Retain
                    // the prefetched normal table until that polynomial is needed.
                    self.prefetched = Some(prefetched);
                    open_table(&self.bucket, &key).await?
                }
                None => open_table(&self.bucket, &key).await?,
            };
            self.get_observed_ms += opened.get_observed_ms;
            self.prefetch_next(&key);
            self.gets += 1;
            self.read = ReadState::Streaming {
                binding,
                next_ordinal: 0,
                remaining: opened.size,
                stream: opened.stream,
            };
        }
        let ReadState::Streaming {
            next_ordinal,
            remaining,
            stream,
            ..
        } = &mut self.read
        else {
            unreachable!("initialized stream")
        };
        if ordinal != *next_ordinal || length > *remaining || length > FRAME_BYTES {
            return Err(failure("Prepared table frame range is invalid."));
        }
        let started = super::clock_ms();
        let output = stream
            .read(length)
            .await?
            .ok_or_else(|| failure("Prepared table ended early."))?;
        self.read_wait_observed_ms += super::clock_ms() - started;
        if output.len() != length {
            return Err(failure("Prepared table returned a partial frame."));
        }
        self.chunks += 1;
        self.largest_chunk = self.largest_chunk.max(output.len());
        *remaining -= length;
        *next_ordinal += 1;
        self.read_bytes += length;
        if *remaining == 0 {
            if stream.read(1).await?.is_some() {
                return Err(failure("Prepared table has trailing bytes."));
            }
            self.read = ReadState::Empty;
        }
        Ok(output)
    }
    fn prefetch_next(&mut self, current_key: &str) {
        if self.prefetched.is_some() {
            return;
        }
        let Some(index) = self.keys.iter().position(|key| key == current_key) else {
            return;
        };
        // At most one future GET accompanies the current stream. Do not fetch
        // a fallback speculatively: its nonce is selected by public decisions.
        if index + 1 >= NORMAL_PATH_TABLES {
            return;
        }
        let Some(key) = self.keys.get(index + 1).cloned() else {
            return;
        };
        let (sender, response) = oneshot::channel();
        worker::wasm_bindgen_futures::spawn_local(prefetch_table(
            self.bucket.clone(),
            key.clone(),
            sender,
        ));
        self.prefetched = Some(PrefetchedTable { key, response });
        self.prefetch_started += 1;
    }
    #[cfg(feature = "ml-dsa-b")]
    pub(super) fn finish_reads(&self) -> worker::Result<()> {
        if !matches!(self.read, ReadState::Empty) || self.prefetched.is_some() {
            return Err(failure("Prepared table reads did not finish exactly."));
        }
        Ok(())
    }
    pub(super) fn report(&self) -> Value {
        json!({"objects_written": self.puts, "objects_read": self.gets,
            "table_bytes_written": self.written, "table_bytes_read": self.read_bytes,
            "stream_chunks": self.chunks, "largest_stream_chunk_bytes": self.largest_chunk,
            "get_observed_ms": self.get_observed_ms, "stream_wait_observed_ms": self.read_wait_observed_ms,
            "maximum_object_bytes": MAX_OBJECT_BYTES, "reader": "byob-read-at-least",
            "maximum_read_bytes": FRAME_BYTES,
            "prefetch_started": self.prefetch_started, "prefetch_hits": self.prefetch_hits,
            "source_bound_open_table_streams": 2, "storage_start_policy": "online",
            "scope": "One R2 PUT per prepared circuit and one streamed GET per used circuit. One next normal-path GET can overlap current evaluation. All reads begin online. Observed GET intervals can overlap and include CPU; they are not a phase partition."})
    }
    #[cfg(feature = "ml-dsa-b")]
    pub(super) async fn cleanup(&self) -> worker::Result<()> {
        self.bucket.delete_multiple(self.keys.clone()).await
    }
}
