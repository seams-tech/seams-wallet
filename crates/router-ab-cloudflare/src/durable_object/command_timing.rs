//! Request timing for one live wallet object instance. These counters convey no authority.
use std::{cell::Cell, rc::Rc};

#[derive(Clone)]
pub(super) struct WalletCommandTiming {
    object_id: String,
    received: Rc<Cell<u64>>,
    previous_start_ms: Rc<Cell<Option<u64>>>,
}

impl WalletCommandTiming {
    pub(super) fn new(object_id: String) -> Self {
        Self {
            object_id,
            received: Rc::new(Cell::new(0)),
            previous_start_ms: Rc::new(Cell::new(None)),
        }
    }

    pub(super) fn begin(
        &self,
        state: &worker::State,
        role: &'static str,
        path: String,
    ) -> CommandObservation {
        let started_ms = worker::Date::now().as_millis();
        let ordinal = self.received.get().saturating_add(1);
        self.received.set(ordinal);
        if ordinal == 1 {
            state.wait_until(log_host(role, self.object_id.clone()));
        }
        let previous_start_ms = self.previous_start_ms.replace(Some(started_ms));
        CommandObservation {
            object_id: self.object_id.clone(),
            role,
            path,
            ordinal,
            started_ms,
            since_previous_start_ms: previous_start_ms
                .map(|previous| started_ms.saturating_sub(previous)),
        }
    }
}

/// Logs once per instance which colo and host run it. The platform stops confirming durable
/// writes on a cycle of each host, so a stalled command can be explained only beside the host of
/// its object. The read runs beside the first command and holds no response.
async fn log_host(role: &'static str, object_id: String) {
    let Some((colo, host)) = super::custody_target::observe_host().await else {
        return;
    };
    let event = serde_json::json!({
        "event": "wallet_do_host",
        "role": role,
        "object_id": object_id,
        "colo": colo,
        "host": host,
    });
    worker::console_log!("{event}");
}

pub(super) struct CommandObservation {
    object_id: String,
    role: &'static str,
    path: String,
    ordinal: u64,
    started_ms: u64,
    since_previous_start_ms: Option<u64>,
}

impl CommandObservation {
    pub(super) fn finish(
        self,
        result: worker::Result<worker::Response>,
    ) -> worker::Result<worker::Response> {
        let handler_ms = worker::Date::now()
            .as_millis()
            .saturating_sub(self.started_ms);
        let event = serde_json::json!({
            "event": "wallet_do_command_timing",
            "role": self.role,
            "object_id": self.object_id,
            "path": self.path,
            "instance_command": self.ordinal,
            "first_command_after_constructor": self.ordinal == 1,
            "since_previous_start_ms": self.since_previous_start_ms,
            "started_ms": self.started_ms,
            "handler_ms": handler_ms,
            "status": result.as_ref().ok().map(worker::Response::status_code),
        });
        worker::console_log!("{event}");
        result
    }
}
