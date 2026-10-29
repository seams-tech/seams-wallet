//! Opt-in public command boundaries. These clocks do not isolate disk service time.
use super::*;
use std::cell::Cell;

#[derive(Clone)]
pub(super) struct DurableTrace {
    call: Option<crate::CloudflareTraceIdV1>,
    command: &'static str,
    job: Option<[u8; 32]>,
    operation: Option<[u8; 32]>,
    sequence: Rc<Cell<u32>>,
}
impl DurableTrace {
    pub(super) fn admission(
        env: &Env,
        command: &AdmissionCommand,
        call: Option<crate::CloudflareTraceIdV1>,
    ) -> Result<Option<Self>> {
        let (command, job, operation) = match command {
            AdmissionCommand::PrepareRegistration { .. } => ("prepare_registration", None, None),
            AdmissionCommand::RetireRegistration { job } => {
                ("retire_registration", Some(job.id), None)
            }
            AdmissionCommand::ReadyRegistration { job, .. } => {
                ("ready_registration", Some(job.id), None)
            }
            AdmissionCommand::CheckRegistrationJob { job } => {
                ("check_registration_job", Some(job.id), None)
            }
            AdmissionCommand::ClaimRegistration { request, .. } => {
                ("claim_registration", None, Some(request.operation))
            }
            AdmissionCommand::CheckRegistrationClaim { claim } => (
                "check_registration_claim",
                Some(claim.job.id),
                Some(claim.request.operation),
            ),
            AdmissionCommand::FinishRegistration { claim, .. } => (
                "finish_registration",
                Some(claim.job.id),
                Some(claim.request.operation),
            ),
            AdmissionCommand::AuthorizeKey { activation } => {
                ("authorize_key", None, Some(activation.ceremony_id))
            }
            AdmissionCommand::CommitKey { activation } => {
                ("commit_key", None, Some(activation.ceremony_id))
            }
            AdmissionCommand::KeyState { .. } => ("key_state", None, None),
            _ => return Ok(None),
        };
        Self::new(env, command, job, operation, call)
    }
    pub(super) fn role(
        env: &Env,
        command: &RoleCommand,
        call: Option<crate::CloudflareTraceIdV1>,
    ) -> Result<Option<Self>> {
        let (command, job, operation) = match command {
            RoleCommand::InitializeRegistrationStorage { claim } => (
                "initialize_registration_storage",
                Some(claim.job.id),
                Some(claim.request.operation),
            ),
            RoleCommand::InstallRegistrationStock { claim, .. } => (
                "install_registration_stock",
                Some(claim.job.id),
                Some(claim.request.operation),
            ),
            RoleCommand::InstallMaterial { record } => (
                "install_material",
                None,
                Some(record.activation.ceremony_id),
            ),
            RoleCommand::Install { .. } => ("install_pool", None, None),
            RoleCommand::Inventory { .. } => ("inventory", None, None),
            RoleCommand::LiveInventory { .. } => ("live_inventory", None, None),
            RoleCommand::WakeRefill { .. } => ("wake_refill", None, None),
            RoleCommand::Put { job, .. } => ("publish_refill", Some(job.batch), None),
            RoleCommand::Reserve { claim, .. } => ("reserve", None, Some(claim.request.operation)),
            RoleCommand::CheckMaterial { activation } => {
                ("check_material", None, Some(activation.ceremony_id))
            }
            _ => return Ok(None),
        };
        Self::new(env, command, job, operation, call)
    }
    fn new(
        env: &Env,
        command: &'static str,
        job: Option<[u8; 32]>,
        operation: Option<[u8; 32]>,
        call: Option<crate::CloudflareTraceIdV1>,
    ) -> Result<Option<Self>> {
        if !wait_trace::enabled(env)? {
            return Ok(None);
        }
        Ok(Some(Self {
            call,
            command,
            job,
            operation,
            sequence: Rc::new(Cell::new(0)),
        }))
    }
    pub(super) fn mark(&self, stage: &'static str) {
        self.event(stage, "mark", None);
    }
    fn event(&self, stage: &'static str, state: &'static str, observation: Option<u32>) {
        let sequence = self.sequence.get();
        self.sequence.set(sequence.saturating_add(1));
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_durable_boundary_v1", "call_id": self.call.map(crate::CloudflareTraceIdV1::as_hex),
                "command": self.command, "job": self.job.as_ref().map(|value| hex(value)),
                "operation": self.operation.as_ref().map(|value| hex(value)),
                "stage": stage, "state": state, "sequence": sequence, "observation": observation, "at_ms": crate::cloudflare_now_unix_ms_v1().ok(),
            })
        );
    }
}
pub(super) fn mark(trace: Option<&DurableTrace>, stage: &'static str) {
    if let Some(trace) = trace {
        trace.mark(stage);
    }
}
pub(super) async fn observe<T, E>(
    trace: Option<&DurableTrace>,
    stage: &'static str,
    work: impl Future<Output = std::result::Result<T, E>>,
) -> std::result::Result<T, E> {
    let observation = trace.map(|trace| trace.sequence.get());
    if let Some(trace) = trace {
        trace.event(stage, "begin", observation);
    }
    let result = work.await;
    if let Some(trace) = trace {
        trace.event(
            stage,
            if result.is_ok() { "end" } else { "error" },
            observation,
        );
    }
    result
}
