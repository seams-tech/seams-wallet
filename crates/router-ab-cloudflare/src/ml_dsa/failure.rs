//! Public terminal causes. These values never contain participant secrets.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "reason", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningFailure {
    CandidatesExhausted {
        consumed_batches: usize,
        evaluated_candidates: usize,
    },
    DeadlineExceeded,
    TransportInterrupted,
    ParticipantRejected {
        status: u16,
    },
    ParticipantUnavailable {
        status: u16,
    },
    InvalidParticipantResponse,
    AdmissionRejected,
    MaterialUnavailable,
    InvalidMaterial,
    ConfigurationInvalid,
    ClockUnavailable,
    KeyChanged,
    Cancelled,
    /// Private protocol checks failed, or a persisted older result lacks a cause.
    ProtocolFailed,
}

impl SigningFailure {
    pub(super) fn from_http_status(status: u16) -> Self {
        match status {
            400..=499 => Self::ParticipantRejected { status },
            500..=599 => Self::ParticipantUnavailable { status },
            _ => Self::InvalidParticipantResponse,
        }
    }
}

/// Normalize only persisted pre-cause operation records. New wire results require a cause.
pub(super) fn stored_status<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<super::admission::Status, D::Error> {
    let mut raw = serde_json::Value::deserialize(deserializer)?;
    if let Some(record) = raw.as_object_mut() {
        if matches!(
            record.get("state").and_then(serde_json::Value::as_str),
            Some("failed" | "declined")
        ) && !record.contains_key("failure")
        {
            record.insert(
                "failure".into(),
                serde_json::json!({"reason": "protocol_failed"}),
            );
        }
    }
    serde_json::from_value(raw).map_err(serde::de::Error::custom)
}
