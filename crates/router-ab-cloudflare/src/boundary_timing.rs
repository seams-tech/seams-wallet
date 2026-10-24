use crate::{cloudflare_now_unix_ms_v1, CloudflareTraceIdV1};

/// Upper bound on metrics folded in from one role worker's `Server-Timing`.
/// Role headers are internal, but a merged header still grows with every hop,
/// so the fold is bounded rather than trusting the peer to stay terse.
#[cfg(feature = "workers-rs")]
const MERGED_ROLE_METRIC_LIMIT: usize = 12;

/// Request-local service and storage timings. These observations carry no authority.
/// Workers clocks advance across I/O, so synchronous CPU work can measure zero.
#[cfg(feature = "workers-rs")]
#[derive(Default)]
pub struct CloudflareBoundaryTimingV1 {
    entries: Vec<(String, u64)>,
    trace_id: Option<CloudflareTraceIdV1>,
}

#[cfg(feature = "workers-rs")]
impl CloudflareBoundaryTimingV1 {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_trace_id(trace_id: Option<CloudflareTraceIdV1>) -> Self {
        Self {
            entries: Vec::new(),
            trace_id,
        }
    }

    pub(crate) fn trace_id(&self) -> Option<CloudflareTraceIdV1> {
        self.trace_id
    }

    pub(crate) fn now_ms() -> u64 {
        cloudflare_now_unix_ms_v1().unwrap_or_default()
    }

    pub(crate) fn mark(&mut self, name: &str, started_at_ms: u64) {
        let elapsed = Self::now_ms().saturating_sub(started_at_ms);
        self.entries.push((name.to_owned(), elapsed));
    }

    pub(crate) fn push(&mut self, name: &str, duration_ms: u64) {
        self.entries.push((name.to_owned(), duration_ms));
    }

    pub(crate) fn emit_io_diagnostic(&self) {
        // Keep trace identities and protocol data out of timing diagnostics.
        worker::console_log!(
            "{}",
            serde_json::json!({ "event": "ecdsa_io_timing", "durationsMs": &self.entries })
        );
    }

    /// Folds one role worker's own `Server-Timing` into this header, renaming
    /// each metric with the role prefix so the role that produced it stays
    /// visible after the merge. Entries without a finite non-negative `dur`
    /// are dropped, which also discards Cloudflare's descriptive metrics.
    pub(crate) fn merge_role(&mut self, role_prefix: &str, header: Option<String>) {
        let Some(header) = header else {
            return;
        };
        let mut merged = 0usize;
        for entry in header.split(',') {
            if merged >= MERGED_ROLE_METRIC_LIMIT {
                return;
            }
            let mut parts = entry.split(';');
            let name = parts.next().map(str::trim).unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            for part in parts {
                let Some((key, value)) = part.split_once('=') else {
                    continue;
                };
                if key.trim() != "dur" {
                    continue;
                }
                let Ok(duration) = value.trim().parse::<f64>() else {
                    break;
                };
                if !duration.is_finite() || duration < 0.0 {
                    break;
                }
                self.entries
                    .push((format!("{role_prefix}_{name}"), duration as u64));
                merged += 1;
                break;
            }
        }
    }

    /// Attaches these spans to a response, leaving the header off entirely
    /// when nothing was measured rather than emitting an empty one.
    pub(crate) fn apply_to(&self, response: &worker::Response) -> worker::Result<()> {
        if self.entries.is_empty() {
            return Ok(());
        }
        response
            .headers()
            .set("Server-Timing", &self.server_timing())
    }

    pub(crate) fn server_timing(&self) -> String {
        self.entries
            .iter()
            .map(|(name, duration_ms)| format!("{name};dur={duration_ms}"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}
