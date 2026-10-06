use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerRelocationRequestV1 {
    pub move_id: String,
    pub source_generation: u64,
    pub invalidated_at_ms: u64,
}

impl SigningWorkerRelocationRequestV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        if self.move_id.len() != 49
            || !self.move_id.starts_with("wmove_")
            || !self.move_id.as_bytes()[6..]
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
            || self.source_generation == 0
            || self.source_generation >= 9_007_199_254_740_991
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "SigningWorker relocation identity is invalid",
            ));
        }
        crate::require_positive_ms("SigningWorker relocation time", self.invalidated_at_ms)
    }
}
