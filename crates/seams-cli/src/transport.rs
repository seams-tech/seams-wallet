//! The console transport boundary.
//!
//! The recovery commands are deliberately written against a transport trait
//! rather than a concrete HTTP client. Two reasons:
//!
//! - **The socket is the only untested part.** Everything above it — request
//!   shapes, response parsing, durability, redaction, exit codes — is exercised
//!   by process tests against a scripted transport.
//! - **A recovery binary's dependencies are a security decision.** This binary
//!   ships signed, with an SBOM and pinned release roots. Adding a TLS stack is
//!   a change someone should make deliberately, in one place, rather than
//!   inheriting it from a convenience.
//!
//! No implementation ships in this build: a network command fails closed with
//! an explicit message rather than silently doing nothing.

use std::collections::BTreeMap;

/// One console request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleRequestV1 {
    /// HTTP method.
    pub method: &'static str,
    /// Absolute request URL.
    pub url: String,
    /// Request headers, sorted so a test can assert them exactly.
    pub headers: BTreeMap<String, String>,
    /// Request body, when the method carries one.
    pub body: Option<Vec<u8>>,
}

/// One console response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleResponseV1 {
    /// HTTP status code.
    pub status: u16,
    /// Response body bytes.
    pub body: Vec<u8>,
    /// Response content type, when the server sent one.
    pub content_type: Option<String>,
}

/// Why one transport attempt failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleTransportErrorV1 {
    message: String,
    retryable: bool,
}

impl ConsoleTransportErrorV1 {
    /// Records one transport failure.
    pub fn new(message: impl Into<String>, retryable: bool) -> Self {
        Self {
            message: message.into(),
            retryable,
        }
    }

    /// Returns the redacted operator-facing message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Returns whether retrying the same request could succeed.
    pub const fn retryable(&self) -> bool {
        self.retryable
    }
}

/// Sends one console request.
pub trait ConsoleTransportV1 {
    /// Sends one request and returns its response.
    fn send(&self, request: ConsoleRequestV1)
        -> Result<ConsoleResponseV1, ConsoleTransportErrorV1>;
}

/// The transport this build ships with: none.
///
/// Recovery commands that need the network fail closed here, naming what is
/// missing, rather than appearing to run offline and doing nothing.
#[derive(Debug, Clone, Copy, Default)]
pub struct UnavailableConsoleTransportV1;

impl ConsoleTransportV1 for UnavailableConsoleTransportV1 {
    fn send(
        &self,
        request: ConsoleRequestV1,
    ) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
        Err(ConsoleTransportErrorV1::new(
            format!(
                "this build has no console transport, so {} {} cannot be sent; \
                 use the offline commands, or build with a transport",
                request.method, request.url
            ),
            false,
        ))
    }
}
