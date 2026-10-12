//! One in-memory activation ceremony that warms a Deriver's isolate.
//!
//! A wallet's objects run the protocol in an isolate that has never run it,
//! and a first run costs several times a later run. The likely cause is that
//! the platform compiles a function when it first executes. A wallet object
//! therefore runs one ceremony between two in-memory roles when it starts,
//! during the passkey prompt, once per isolate. The ceremony uses fixed public
//! inputs, touches no storage and no peer, and its output is dropped.
//!
//! The ceremony turns the event loop after every message and stops as soon as
//! real work reaches the isolate, so it never holds a request back by more
//! than one message's work.

use core::sync::atomic::{AtomicU8, Ordering};

use futures::channel::mpsc::{unbounded, UnboundedReceiver, UnboundedSender};
use futures::StreamExt;
use router_ab_ed25519_yao::build_activation_prewarm_pair_v1;
use router_ab_ed25519_yao::duplex::{
    run_activation_deriver_a, run_activation_deriver_b_open, YaoDuplexTransport, YaoInboundEvent,
};
use router_ab_ed25519_yao::relay::{
    DirectionalEofEvidence, DirectionalWireDecoder, DirectionalWireEncoder, WireDirection,
    WireMessage,
};

const NOT_STARTED: u8 = 0;
const RUNNING: u8 = 1;
const COMPLETED: u8 = 2;
const STOPPED: u8 = 3;
const FAILED: u8 = 4;

/// What became of this isolate's prewarm. A module-level value lives as long
/// as the isolate.
static PREWARM_STATE: AtomicU8 = AtomicU8::new(NOT_STARTED);
/// Set when a pair request reaches this isolate. The prewarm reads it between
/// frames.
static REAL_WORK_ARRIVED: AtomicU8 = AtomicU8::new(0);

/// The prewarm state, for the isolate counter record.
pub(crate) fn prewarm_state_label_v1() -> &'static str {
    match PREWARM_STATE.load(Ordering::Relaxed) {
        NOT_STARTED => "none",
        RUNNING => "running",
        COMPLETED => "completed",
        STOPPED => "stopped",
        _ => "failed",
    }
}

/// Tells a running prewarm that the isolate now has real work.
pub(crate) fn note_pair_work_arrived_v1() {
    REAL_WORK_ARRIVED.store(1, Ordering::Relaxed);
}

/// Whether this call may start the isolate's one prewarm.
fn claim_prewarm() -> bool {
    REAL_WORK_ARRIVED.load(Ordering::Relaxed) == 0
        && PREWARM_STATE
            .compare_exchange(NOT_STARTED, RUNNING, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PrewarmError {
    /// Real work reached the isolate.
    Stopped,
    /// The in-memory transport or its framing failed.
    Transport,
}

/// One end of the in-memory connection. `None` is the directional EOF.
struct InMemoryTransport<Y> {
    outbound: UnboundedSender<Option<Vec<u8>>>,
    inbound: UnboundedReceiver<Option<Vec<u8>>>,
    encoder: Option<DirectionalWireEncoder>,
    decoder: Option<DirectionalWireDecoder>,
    turn: Y,
}

impl<Y, F> YaoDuplexTransport for InMemoryTransport<Y>
where
    Y: FnMut() -> F,
    F: core::future::Future<Output = ()>,
{
    type Error = PrewarmError;
    type Completion = ();

    async fn send(&mut self, message: WireMessage) -> Result<Option<YaoInboundEvent>, Self::Error> {
        let envelope = self
            .encoder
            .as_mut()
            .ok_or(PrewarmError::Transport)?
            .encode(message)
            .map_err(|_| PrewarmError::Transport)?;
        self.outbound
            .unbounded_send(Some(envelope))
            .map_err(|_| PrewarmError::Transport)?;
        (self.turn)().await;
        if REAL_WORK_ARRIVED.load(Ordering::Relaxed) != 0 {
            return Err(PrewarmError::Stopped);
        }
        Ok(None)
    }

    async fn receive(&mut self) -> Result<YaoInboundEvent, Self::Error> {
        match self.inbound.next().await {
            Some(Some(bytes)) => {
                let decoder = self.decoder.as_mut().ok_or(PrewarmError::Transport)?;
                let mut offset = 0;
                while offset < bytes.len() {
                    let consumed = decoder
                        .push(&bytes[offset..])
                        .map_err(|_| PrewarmError::Transport)?;
                    if consumed == 0 {
                        return Err(PrewarmError::Transport);
                    }
                    offset += consumed;
                }
                decoder
                    .take_message()
                    .map_err(|_| PrewarmError::Transport)?
                    .map(YaoInboundEvent::Message)
                    .ok_or(PrewarmError::Transport)
            }
            Some(None) => self
                .decoder
                .take()
                .ok_or(PrewarmError::Transport)?
                .finish_at_transport_eof()
                .map(YaoInboundEvent::DirectionalEof)
                .map_err(|_| PrewarmError::Transport),
            // The peer role stopped and dropped its end.
            None => Err(PrewarmError::Stopped),
        }
    }

    async fn close_local_direction(
        &mut self,
    ) -> Result<(DirectionalEofEvidence, Option<YaoInboundEvent>), Self::Error> {
        let evidence = self
            .encoder
            .take()
            .ok_or(PrewarmError::Transport)?
            .finish_after_transport_close()
            .map_err(|_| PrewarmError::Transport)?;
        self.outbound
            .unbounded_send(None)
            .map_err(|_| PrewarmError::Transport)?;
        Ok((evidence, None))
    }

    async fn finish(self) -> Result<Self::Completion, Self::Error> {
        Ok(())
    }
}

/// Runs both roles of one activation ceremony to completion in this isolate.
/// `turn` yields to the host's event loop after each message.
async fn run_prewarm_ceremony<Y, F>(turn: Y) -> Result<(), PrewarmError>
where
    Y: FnMut() -> F + Clone,
    F: core::future::Future<Output = ()>,
{
    let (session, role_a, role_b) =
        build_activation_prewarm_pair_v1().map_err(|_| PrewarmError::Transport)?;
    let (a_to_b, from_a) = unbounded();
    let (b_to_a, from_b) = unbounded();
    let end = |outbound, inbound, send: WireDirection, receive: WireDirection, turn: Y| {
        Ok::<_, PrewarmError>(InMemoryTransport {
            outbound,
            inbound,
            encoder: Some(
                DirectionalWireEncoder::new(send, session).map_err(|_| PrewarmError::Transport)?,
            ),
            decoder: Some(
                DirectionalWireDecoder::new(receive, session)
                    .map_err(|_| PrewarmError::Transport)?,
            ),
            turn,
        })
    };
    let transport_a = end(
        a_to_b,
        from_b,
        WireDirection::DeriverAToDeriverB,
        WireDirection::DeriverBToDeriverA,
        turn.clone(),
    )?;
    let transport_b = end(
        b_to_a,
        from_a,
        WireDirection::DeriverBToDeriverA,
        WireDirection::DeriverAToDeriverB,
        turn,
    )?;
    let (a, b) = futures::join!(
        run_activation_deriver_a(role_a, transport_a),
        run_activation_deriver_b_open(role_b, transport_b),
    );
    let stopped = REAL_WORK_ARRIVED.load(Ordering::Relaxed) != 0;
    match (a.is_ok(), b.is_ok()) {
        (true, true) => Ok(()),
        _ if stopped => Err(PrewarmError::Stopped),
        _ => Err(PrewarmError::Transport),
    }
}

/// Runs this isolate's one prewarm if it has not started and no pair work has
/// arrived. The caller keeps the object alive until the future ends.
#[cfg(feature = "workers-rs")]
pub(crate) async fn prewarm_role_isolate_v1(role: &'static str) {
    if !claim_prewarm() {
        return;
    }
    let turn = || worker::Delay::from(core::time::Duration::from_millis(0));
    // Let the start request's answer leave before the first computation.
    turn().await;
    let outcome = run_prewarm_ceremony(turn).await;
    let state = match outcome {
        Ok(()) => COMPLETED,
        Err(PrewarmError::Stopped) => STOPPED,
        Err(PrewarmError::Transport) => FAILED,
    };
    PREWARM_STATE.store(state, Ordering::Relaxed);
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "router_ab_yao_role_isolate_prewarm_v1",
            "role": role,
            "outcome": prewarm_state_label_v1(),
        })
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block_on<F: core::future::Future>(future: F) -> F::Output {
        futures::executor::block_on(future)
    }

    // The statics are process-wide, so one test owns their whole lifecycle.
    #[test]
    fn the_prewarm_ceremony_completes_and_stops_when_real_work_arrives() {
        REAL_WORK_ARRIVED.store(0, Ordering::Relaxed);
        assert_eq!(
            block_on(run_prewarm_ceremony(|| core::future::ready(()))),
            Ok(()),
            "both in-memory roles must finish one activation ceremony"
        );
        assert!(claim_prewarm(), "an idle isolate starts its prewarm once");
        assert!(!claim_prewarm(), "a second start in the same isolate is refused");
        assert_eq!(prewarm_state_label_v1(), "running");

        note_pair_work_arrived_v1();
        assert_eq!(
            block_on(run_prewarm_ceremony(|| core::future::ready(()))),
            Err(PrewarmError::Stopped),
            "the ceremony stops at the first message after real work arrives"
        );
        PREWARM_STATE.store(NOT_STARTED, Ordering::Relaxed);
        assert!(!claim_prewarm(), "no prewarm starts once real work has arrived");
    }
}
