//! Public stage clocks. These clocks can omit CPU and do not measure isolated I/O.
use super::*;
use std::cell::Cell;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum Context {
    TakeCaller { material: [u8; 32] },
    TakeStore { material: [u8; 32] },
    RegistrationExecute { job: [u8; 32] },
    RegistrationInstall { job: [u8; 32] },
    RegistrationStock { job: [u8; 32], ordinal: usize },
}

#[derive(Serialize)]
struct Mark {
    stage: &'static str,
    at_ms: Option<u64>,
}

#[derive(Default, Serialize)]
struct TableReads {
    count: u64,
    measured: u64,
    elapsed_ms: u64,
    maximum_ms: u64,
}

pub(super) struct StageTrace {
    operation: [u8; 32],
    role: Participant,
    context: Context,
    marks: RefCell<Vec<Mark>>,
    table_reads: RefCell<TableReads>,
    completed: Cell<bool>,
}
impl StageTrace {
    pub(super) fn new(operation: [u8; 32], role: Participant, context: Context) -> Self {
        let trace = Self {
            operation,
            role,
            context,
            marks: RefCell::new(Vec::new()),
            table_reads: RefCell::new(TableReads::default()),
            completed: Cell::new(false),
        };
        trace.mark("started");
        trace
    }
    pub(super) fn mark(&self, stage: &'static str) {
        self.marks.borrow_mut().push(Mark {
            stage,
            at_ms: crate::cloudflare_now_unix_ms_v1().ok(),
        });
    }
    pub(super) fn table_read(&self, started: Option<u64>) {
        let mut reads = self.table_reads.borrow_mut();
        reads.count += 1;
        if let Some(elapsed) = crate::cloudflare_now_unix_ms_v1()
            .ok()
            .zip(started)
            .and_then(|(end, start)| end.checked_sub(start))
        {
            reads.measured += 1;
            reads.elapsed_ms = reads.elapsed_ms.saturating_add(elapsed);
            reads.maximum_ms = reads.maximum_ms.max(elapsed);
        }
    }
    pub(super) fn finish(&self) {
        self.completed.set(true);
        self.mark("completed");
    }
}
impl Drop for StageTrace {
    fn drop(&mut self) {
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_stage_trace_v1", "operation": hex(&self.operation),
                "role": self.role, "context": self.context,
                "module_instance": signing_trace::module_identity(),
                "completed": self.completed.get(), "marks": self.marks.borrow().as_slice(),
                "table_reads": &*self.table_reads.borrow(),
            })
        );
    }
}
