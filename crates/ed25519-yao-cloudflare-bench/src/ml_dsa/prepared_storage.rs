//! R2 stores one bounded table object per prepared circuit. Online reads stream.

use futures_util::StreamExt;
use serde_json::{json, Value};
use worker::{Bucket, ByteStream};

use super::{encode_hex, failure};

const MAX_OBJECT_BYTES: usize = 10 * 1024 * 1024;
const FRAME_BYTES: usize = 65544;

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
        stream: ByteStream,
        chunk: Vec<u8>,
        offset: usize,
    },
}

pub(super) struct Tables {
    bucket: Bucket,
    prefix: String,
    write: WriteState,
    read: ReadState,
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
            let started = super::clock_ms();
            let object = self
                .bucket
                .get(&key)
                .execute()
                .await?
                .ok_or_else(|| failure("Prepared table is absent."))?;
            self.get_observed_ms += super::clock_ms() - started;
            let size = usize::try_from(object.size()).map_err(super::runtime_failure)?;
            if size == 0 || size > MAX_OBJECT_BYTES {
                return Err(failure("Prepared table size is invalid."));
            }
            let stream = object
                .body()
                .ok_or_else(|| failure("Prepared table has no body."))?
                .stream()?;
            self.gets += 1;
            self.read = ReadState::Streaming {
                binding,
                next_ordinal: 0,
                remaining: size,
                stream,
                chunk: Vec::new(),
                offset: 0,
            };
        }
        let ReadState::Streaming {
            next_ordinal,
            remaining,
            stream,
            chunk,
            offset,
            ..
        } = &mut self.read
        else {
            unreachable!("initialized stream")
        };
        if ordinal != *next_ordinal || length > *remaining || length > FRAME_BYTES {
            return Err(failure("Prepared table frame range is invalid."));
        }
        let mut output = Vec::with_capacity(length);
        while output.len() < length {
            if *offset == chunk.len() {
                let started = super::clock_ms();
                *chunk = stream
                    .next()
                    .await
                    .ok_or_else(|| failure("Prepared table ended early."))??;
                self.read_wait_observed_ms += super::clock_ms() - started;
                *offset = 0;
                if chunk.is_empty() {
                    continue;
                }
                self.chunks += 1;
                self.largest_chunk = self.largest_chunk.max(chunk.len());
            }
            let amount = (length - output.len()).min(chunk.len() - *offset);
            output.extend_from_slice(&chunk[*offset..*offset + amount]);
            *offset += amount;
        }
        *remaining -= length;
        *next_ordinal += 1;
        self.read_bytes += length;
        if *remaining == 0 {
            if *offset != chunk.len() || stream.next().await.is_some() {
                return Err(failure("Prepared table has trailing bytes."));
            }
            self.read = ReadState::Empty;
        }
        Ok(output)
    }
    pub(super) fn report(&self) -> Value {
        json!({"objects_written": self.puts, "objects_read": self.gets,
            "table_bytes_written": self.written, "table_bytes_read": self.read_bytes,
            "stream_chunks": self.chunks, "largest_stream_chunk_bytes": self.largest_chunk,
            "get_observed_ms": self.get_observed_ms, "stream_wait_observed_ms": self.read_wait_observed_ms,
            "maximum_object_bytes": MAX_OBJECT_BYTES,
            "scope": "One R2 PUT and one streamed GET per circuit. Worker clocks advance with I/O and are not CPU profiles."})
    }
    #[cfg(feature = "ml-dsa-b")]
    pub(super) async fn cleanup(&self) -> worker::Result<()> {
        self.bucket.delete_multiple(self.keys.clone()).await
    }
}
