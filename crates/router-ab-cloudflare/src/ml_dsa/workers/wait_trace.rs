//! Opt-in boundary observations. Intervals include work polled inside each future.
use super::*;
use std::cell::Cell;
use std::sync::atomic::{AtomicU32, Ordering};

static CALLS: AtomicU32 = AtomicU32::new(0);
const MAX_EVENTS: u32 = 640;
const MAX_ERROR_EVENTS: u32 = 4;

pub(super) fn call_id() -> Option<crate::CloudflareTraceIdV1> {
    let module = signing_trace::module_identity()?;
    let number = CALLS
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
            value.checked_add(1)
        })
        .ok()?;
    crate::CloudflareTraceIdV1::parse(&format!("{}{:08x}", &module[..24], number)).ok()
}

pub(super) fn enabled(env: &Env) -> Result<bool> {
    match env
        .var("ML_DSA_WAIT_DIAGNOSTICS")
        .ok()
        .map(|value| value.to_string())
        .as_deref()
    {
        None | Some("0") => Ok(false),
        Some("1") => Ok(true),
        Some(_) => Err(invalid("Invalid ML-DSA wait diagnostics setting")),
    }
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum Kind {
    PeerConnect,
    PeerEvent,
    PeerPrepared,
    PublishReady,
    PeerReady,
    PeerResult,
    StoreTables,
    LoadTables,
    PublishPrivate,
    ConsumePrivate,
    StoreSigningStock,
}

pub(super) struct WaitTrace {
    call: Option<crate::CloudflareTraceIdV1>,
    events: Cell<u32>,
    sequence: Cell<u32>,
    peer_begin_logged: Cell<bool>,
    peer_ready: Cell<u32>,
    peer_pending: Cell<u32>,
    peer_boundary_ms: Cell<u64>,
}
impl WaitTrace {
    pub(super) fn new(
        env: &Env,
        job: [u8; 32],
        operation: Option<[u8; 32]>,
        role: Participant,
        call: Option<crate::CloudflareTraceIdV1>,
    ) -> Result<Option<Rc<Self>>> {
        if !enabled(env)? {
            return Ok(None);
        }
        let trace = Rc::new(Self {
            call,
            events: Cell::new(0),
            sequence: Cell::new(0),
            peer_begin_logged: Cell::new(false),
            peer_ready: Cell::new(0),
            peer_pending: Cell::new(0),
            peer_boundary_ms: Cell::new(0),
        });
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_wait_scope_v1", "call_id": call.map(crate::CloudflareTraceIdV1::as_hex),
                "job": hex(&job), "operation": operation.as_ref().map(|value| hex(value)), "role": role,
            })
        );
        Ok(Some(trace))
    }
    fn emit(&self, sequence: u32, kind: Kind, state: &str, pending: bool, failed: bool) {
        let emitted = self.events.get();
        let limit = if failed {
            MAX_EVENTS + MAX_ERROR_EVENTS
        } else {
            MAX_EVENTS
        };
        if emitted >= limit {
            return;
        }
        self.events.set(emitted.saturating_add(1));
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_wait_boundary_v1", "call_id": self.call.map(crate::CloudflareTraceIdV1::as_hex),
                "sequence": sequence, "kind": kind, "state": state, "pending": pending,
                "at_ms": crate::cloudflare_now_unix_ms_v1().ok(),
                "peer_ready": self.peer_ready.get(), "peer_pending": self.peer_pending.get(),
                "peer_boundary_ms": self.peer_boundary_ms.get(),
            })
        );
    }
}
impl Drop for WaitTrace {
    fn drop(&mut self) {
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_wait_summary_v1", "call_id": self.call.map(crate::CloudflareTraceIdV1::as_hex),
                "observations": self.sequence.get(), "emitted_events": self.events.get(),
                "event_limit_reached": self.events.get() >= MAX_EVENTS,
                "peer_ready": self.peer_ready.get(), "peer_pending": self.peer_pending.get(),
                "peer_boundary_ms": self.peer_boundary_ms.get(),
            })
        );
    }
}

pub(super) async fn observe<T, E>(
    trace: Option<&WaitTrace>,
    kind: Kind,
    work: impl Future<Output = std::result::Result<T, E>>,
) -> std::result::Result<T, E> {
    let Some(trace) = trace else {
        return work.await;
    };
    let sequence = trace.sequence.get();
    trace.sequence.set(sequence.saturating_add(1));
    // Count peer suspension throughout the call; log only its first occurrence.
    let peer = kind == Kind::PeerEvent;
    if !peer {
        trace.emit(sequence, kind, "begin", false, false);
    }
    let started = crate::cloudflare_now_unix_ms_v1().ok();
    futures::pin_mut!(work);
    let (result, pending) = match futures::poll!(work.as_mut()) {
        std::task::Poll::Ready(result) => {
            if peer {
                trace
                    .peer_ready
                    .set(trace.peer_ready.get().saturating_add(1));
            }
            (result, false)
        }
        std::task::Poll::Pending => {
            if peer {
                trace
                    .peer_pending
                    .set(trace.peer_pending.get().saturating_add(1));
                if !trace.peer_begin_logged.replace(true) {
                    trace.emit(sequence, kind, "begin", true, false);
                }
            }
            (work.await, true)
        }
    };
    if peer && pending {
        if let Some(elapsed) = crate::cloudflare_now_unix_ms_v1()
            .ok()
            .zip(started)
            .and_then(|(end, start)| end.checked_sub(start))
        {
            trace
                .peer_boundary_ms
                .set(trace.peer_boundary_ms.get().saturating_add(elapsed));
        }
    }
    if !peer || result.is_err() {
        trace.emit(
            sequence,
            kind,
            if result.is_ok() { "end" } else { "error" },
            pending,
            result.is_err(),
        );
    }
    result
}
