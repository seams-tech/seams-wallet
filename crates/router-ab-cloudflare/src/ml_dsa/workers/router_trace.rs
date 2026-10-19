//! Public HTTP-attempt diagnostics. Request IDs do not grant authority.
use super::*;

pub(super) const HEADER: &str = "x-ml-dsa-request-id";

#[derive(Serialize)]
struct Milestone {
    stage: &'static str,
    at_ms: Option<u64>,
}

pub(super) struct RouterTrace {
    request_id: String,
    operation: Option<[u8; 32]>,
    milestones: Vec<Milestone>,
    status: Option<u16>,
}
impl RouterTrace {
    pub(super) fn new(headers: &worker::Headers) -> worker::Result<Self> {
        let request_id = match headers.get(HEADER)? {
            Some(value)
                if value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) =>
            {
                value.to_ascii_lowercase()
            }
            Some(_) => {
                return Err(protocol_error(invalid(
                    "Invalid ML-DSA diagnostic request ID",
                )))
            }
            None => {
                let mut bytes = [0; 16];
                getrandom::getrandom(&mut bytes)
                    .map_err(|_| protocol_error(invalid("ML-DSA request ID unavailable")))?;
                hex(&bytes)
            }
        };
        let mut trace = Self {
            request_id,
            operation: None,
            milestones: Vec::new(),
            status: None,
        };
        trace.mark("entered");
        Ok(trace)
    }
    pub(super) fn bind(&mut self, operation: [u8; 32]) {
        self.operation = Some(operation);
        self.mark("decoded");
    }
    pub(super) fn mark(&mut self, stage: &'static str) {
        self.milestones.push(Milestone {
            stage,
            at_ms: crate::cloudflare_now_unix_ms_v1().ok(),
        });
    }
    pub(super) fn finish(&mut self, result: &mut worker::Result<Response>) -> worker::Result<()> {
        if let Ok(response) = result {
            self.status = Some(response.status_code());
            response.headers_mut().set(HEADER, &self.request_id)?;
        }
        self.mark("response_ready");
        Ok(())
    }
}
impl Drop for RouterTrace {
    fn drop(&mut self) {
        let operation = self.operation.as_ref().map(|value| hex(value));
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_router_trace_v1", "http_request": self.request_id,
                "operation": operation, "module_instance": signing_trace::module_identity(),
                "status": self.status, "milestones": self.milestones,
            })
        );
    }
}
