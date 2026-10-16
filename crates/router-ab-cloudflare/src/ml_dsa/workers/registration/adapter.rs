use super::*;
use ed25519_yao::ml_dsa_runtime::{prepared, RuntimeError};
const WRITE_BATCH_FRAMES: usize = 16;
pub(super) struct PendingFrame {
    circuit: [u8; 32],
    ordinal: usize,
    bytes: Vec<u8>,
}
pub(super) struct Adapter<'a> {
    pub wire: transport::Duplex<'a>,
    pub state: Rc<State>,
    pub binding: registration_preparation::Binding,
    pub seed: Zeroizing<[u8; 32]>,
    pub ceremony: [u8; 32],
    pub loaded_frames: usize,
    pub loaded_bytes: usize,
    pub read_transactions: usize,
    pub peak_cached_frames: usize,
    pub frames: Option<registration_tables::ConsumedFrames>,
    pub pending_frames: Vec<PendingFrame>,
    pub written_frames: usize,
    pub write_transactions: usize,
    pub peak_pending_frames: usize,
}
impl Adapter<'_> {
    pub(super) async fn flush_tables(&mut self) -> Result<()> {
        if self.pending_frames.is_empty() {
            return Ok(());
        }
        let frames = std::mem::take(&mut self.pending_frames);
        let count = frames.len();
        let binding = self.binding.clone();
        let seed = self.seed.clone();
        let now = crate::cloudflare_now_unix_ms_v1()?;
        transaction(&self.state, move |store| async move {
            for frame in frames {
                registration_tables::put(
                    &store,
                    &binding,
                    frame.circuit,
                    frame.ordinal,
                    &frame.bytes,
                    &seed,
                    now,
                )
                .await?;
            }
            Ok(())
        })
        .await?;
        self.written_frames += count;
        self.write_transactions += 1;
        Ok(())
    }
}
fn failed(_: impl std::fmt::Display) -> RuntimeError {
    RuntimeError::TableFrame
}
impl prepared::Transport for Adapter<'_> {
    async fn send(&mut self, bytes: &[u8]) -> std::result::Result<(), RuntimeError> {
        self.wire.send(bytes).await
    }
    async fn receive(&mut self, length: usize) -> std::result::Result<Vec<u8>, RuntimeError> {
        self.wire.receive(length).await
    }
    async fn store(
        &mut self,
        circuit: [u8; 32],
        ordinal: usize,
        bytes: &[u8],
    ) -> std::result::Result<(), RuntimeError> {
        if bytes.is_empty() || bytes.len() > registration_tables::MAX_FRAME {
            return Err(RuntimeError::TableFrame);
        }
        self.pending_frames.push(PendingFrame {
            circuit,
            ordinal,
            bytes: bytes.to_vec(),
        });
        self.peak_pending_frames = self.peak_pending_frames.max(self.pending_frames.len());
        if self.pending_frames.len() == WRITE_BATCH_FRAMES {
            self.flush_tables().await.map_err(failed)?;
        }
        Ok(())
    }

    async fn load(
        &mut self,
        circuit: [u8; 32],
        ordinal: usize,
        length: usize,
    ) -> std::result::Result<Vec<u8>, RuntimeError> {
        if self
            .frames
            .as_ref()
            .is_none_or(|frames| frames.remaining() == 0)
        {
            let binding = self.binding.clone();
            let seed = self.seed.clone();
            let ceremony = self.ceremony;
            let now = crate::cloudflare_now_unix_ms_v1().map_err(failed)?;
            let frames = transaction(&self.state, move |store| async move {
                registration_tables::take(
                    &store, &binding, ceremony, circuit, ordinal, length, &seed, now,
                )
                .await
            })
            .await
            .map_err(failed)?;
            self.peak_cached_frames = self.peak_cached_frames.max(frames.remaining());
            self.read_transactions += 1;
            self.frames = Some(frames);
        }
        let bytes = self
            .frames
            .as_mut()
            .ok_or(RuntimeError::TableFrame)?
            .next(circuit, ordinal, length)
            .map_err(failed)?;
        self.loaded_frames += 1;
        self.loaded_bytes += bytes.len();
        Ok(bytes)
    }
    fn phase(&mut self, _: prepared::Phase) {}
}
