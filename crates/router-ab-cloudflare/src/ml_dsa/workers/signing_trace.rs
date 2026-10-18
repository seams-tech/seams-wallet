//! Public diagnostics. No private values or prepared material enter this record.
use super::*;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    OnceLock,
};

struct ModuleInstance {
    id: Option<[u8; 16]>,
    signing_calls: AtomicU32,
}
static INSTANCE: OnceLock<ModuleInstance> = OnceLock::new();

pub(super) fn module_identity() -> Option<String> {
    match INSTANCE.get_or_init(new_instance).id.as_ref() {
        Some(bytes) => Some(hex(bytes)),
        None => None,
    }
}

fn new_instance() -> ModuleInstance {
    let mut bytes = [0; 16];
    let id = match getrandom::getrandom(&mut bytes) {
        Ok(()) => Some(bytes),
        Err(_) => None,
    };
    ModuleInstance {
        id,
        signing_calls: AtomicU32::new(0),
    }
}

#[derive(Serialize)]
struct Milestone {
    at_ms: Option<u64>,
    name: &'static str,
}
#[derive(Serialize)]
struct BatchMilestone {
    at_ms: Option<u64>,
    value: super::super::execution::ExecutionStage,
}

pub(super) struct SigningTrace {
    operation: [u8; 32],
    role: Participant,
    instance: &'static ModuleInstance,
    signing_call: u32,
    schedule_cache_hit: bool,
    milestones: RefCell<Vec<Milestone>>,
    batches: RefCell<Vec<BatchMilestone>>,
    transport: RefCell<Option<transport::Metrics>>,
    completed: bool,
}
impl SigningTrace {
    pub(super) fn new(operation: [u8; 32], role: Participant) -> Self {
        let instance = INSTANCE.get_or_init(new_instance);
        let trace = Self {
            operation,
            role,
            instance,
            signing_call: instance.signing_calls.fetch_add(1, Ordering::Relaxed),
            schedule_cache_hit: schedules::is_loaded(),
            milestones: RefCell::new(Vec::new()),
            batches: RefCell::new(Vec::new()),
            transport: RefCell::new(None),
            completed: false,
        };
        trace.mark("started");
        trace
    }
    pub(super) fn mark(&self, name: &'static str) {
        self.milestones.borrow_mut().push(Milestone {
            at_ms: crate::cloudflare_now_unix_ms_v1().ok(),
            name,
        });
    }
    pub(super) fn batch(&self, value: super::super::execution::ExecutionStage) {
        if matches!(
            value,
            super::super::execution::ExecutionStage::Taken { .. }
                | super::super::execution::ExecutionStage::Checked { .. }
        ) {
            worker::console_log!(
                "{}",
                serde_json::json!({
                    "event": "ml_dsa_material_stage_v1", "operation": hex(&self.operation),
                    "role": self.role, "value": value,
                })
            );
        }
        self.batches.borrow_mut().push(BatchMilestone {
            at_ms: crate::cloudflare_now_unix_ms_v1().ok(),
            value,
        });
    }
    pub(super) fn finish(&mut self, transport: transport::Metrics) {
        self.transport(transport);
        self.completed = true;
        self.mark("completed");
    }
    pub(super) fn transport(&self, metrics: transport::Metrics) {
        *self.transport.borrow_mut() = Some(metrics);
    }
}
impl Drop for SigningTrace {
    fn drop(&mut self) {
        let identity = match &self.instance.id {
            Some(bytes) => Some(hex(bytes)),
            None => None,
        };
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_signing_trace_v1",
                "operation": hex(&self.operation),
                "role": self.role,
                "module_instance": identity,
                "signing_call": self.signing_call,
                "schedule_cache_hit": self.schedule_cache_hit,
                "completed": self.completed,
                "milestones": self.milestones.borrow().as_slice(),
                "batches": self.batches.borrow().as_slice(),
                "transport": &*self.transport.borrow(),
            })
        );
    }
}
