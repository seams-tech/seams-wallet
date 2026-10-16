use super::*;
use ed25519_yao::ml_dsa_runtime::{prepared, RuntimeError};
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
        let binding = self.binding.clone();
        let seed = self.seed.clone();
        let bytes = bytes.to_vec();
        let now = crate::cloudflare_now_unix_ms_v1().map_err(failed)?;
        transaction(&self.state, move |store| async move {
            registration_tables::put(&store, &binding, circuit, ordinal, &bytes, &seed, now).await
        })
        .await
        .map_err(failed)
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
