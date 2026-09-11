//! The HTTPS console transport.
//!
//! This is the only place the recovery binary touches a network. Its
//! configuration is the security-relevant part:
//!
//! - **No redirects.** A redirect would hand the console credential or the
//!   destination bootstrap token to whatever host the response named.
//! - **A response cap.** A recovery tool must not be pushed into unbounded
//!   allocation by whatever answers the socket.
//! - **Timeouts.** An operator recovering a root under pressure needs a
//!   failure, not a hang.
//!
//! TLS uses rustls and the operating system’s certificate verifier. `ureq` is the only network
//! dependency this binary has, and it is pinned; the release SBOM records the
//! exact tree it was built from.

use std::time::Duration;

use crate::console::CONSOLE_RESPONSE_MAX_BYTES_V1;
use crate::transport::{
    ConsoleRequestV1, ConsoleResponseV1, ConsoleTransportErrorV1, ConsoleTransportV1,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// One HTTPS console transport.
pub struct HttpsConsoleTransportV1 {
    agent: ureq::Agent,
}

impl core::fmt::Debug for HttpsConsoleTransportV1 {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.debug_struct("HttpsConsoleTransportV1").finish()
    }
}

impl Default for HttpsConsoleTransportV1 {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpsConsoleTransportV1 {
    /// Creates the transport with the recovery tool's fixed configuration.
    pub fn new() -> Self {
        Self::with_roots(ureq::tls::RootCerts::PlatformVerifier)
    }

    /// Uses an explicitly supplied CA for local or private deployments.
    pub fn from_environment() -> Result<Self, String> {
        match std::env::var_os("SSL_CERT_FILE") {
            None => Ok(Self::new()),
            Some(path) => {
                let bytes =
                    std::fs::read(path).map_err(|_| "Cannot read SSL_CERT_FILE".to_owned())?;
                if bytes.len() > 1024 * 1024 {
                    return Err("SSL_CERT_FILE is too large".to_owned());
                }
                let cert = ureq::tls::Certificate::from_pem(&bytes)
                    .map_err(|_| "Invalid SSL_CERT_FILE certificate".to_owned())?;
                Ok(Self::with_roots(ureq::tls::RootCerts::new_with_certs(&[
                    cert,
                ])))
            }
        }
    }

    fn with_roots(roots: ureq::tls::RootCerts) -> Self {
        let config = ureq::Agent::config_builder()
            // Following a redirect would send the credential to the host the
            // response chose. There is no legitimate redirect on these routes.
            .tls_config(ureq::tls::TlsConfig::builder().root_certs(roots).build())
            .max_redirects(0)
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(REQUEST_TIMEOUT))
            .http_status_as_error(false)
            .build();
        Self {
            agent: config.new_agent(),
        }
    }
}

fn transport_error(error: &ureq::Error) -> ConsoleTransportErrorV1 {
    // A connection-level failure may succeed on a retry; a protocol or TLS
    // failure will not, and telling an operator to retry it wastes their time.
    let retryable = matches!(
        error,
        ureq::Error::Io(_) | ureq::Error::Timeout(_) | ureq::Error::ConnectionFailed
    );
    ConsoleTransportErrorV1::new(format!("console request failed: {error}"), retryable)
}

impl ConsoleTransportV1 for HttpsConsoleTransportV1 {
    fn send(
        &self,
        request: ConsoleRequestV1,
    ) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
        if !request.url.starts_with("https://") {
            return Err(ConsoleTransportErrorV1::new(
                "the recovery tool only speaks https",
                false,
            ));
        }
        // The two builder shapes are distinct types, so each method arm runs
        // its own request rather than sharing one builder.
        let mut response = match (request.method, &request.body) {
            ("GET", None) => {
                let mut builder = self.agent.get(&request.url);
                for (name, value) in &request.headers {
                    builder = builder.header(name.as_str(), value.as_str());
                }
                builder.call()
            }
            ("POST", Some(body)) => {
                let mut builder = self.agent.post(&request.url);
                for (name, value) in &request.headers {
                    builder = builder.header(name.as_str(), value.as_str());
                }
                builder.send(&body[..])
            }
            ("POST", None) => {
                let mut builder = self.agent.post(&request.url);
                for (name, value) in &request.headers {
                    builder = builder.header(name.as_str(), value.as_str());
                }
                builder.send_empty()
            }
            (other, _) => {
                return Err(ConsoleTransportErrorV1::new(
                    format!("unsupported method {other}"),
                    false,
                ))
            }
        }
        .map_err(|error| transport_error(&error))?;

        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response
            .body_mut()
            // One byte over the cap is read so an oversized response is
            // refused rather than silently truncated into a parse failure.
            .with_config()
            .limit(
                u64::try_from(CONSOLE_RESPONSE_MAX_BYTES_V1)
                    .unwrap_or(u64::MAX)
                    .saturating_add(1),
            )
            .read_to_vec()
            .map_err(|error| {
                ConsoleTransportErrorV1::new(format!("could not read the response: {error}"), true)
            })?;
        if body.len() > CONSOLE_RESPONSE_MAX_BYTES_V1 {
            return Err(ConsoleTransportErrorV1::new(
                "the console response exceeds the size limit",
                false,
            ));
        }

        Ok(ConsoleResponseV1 {
            status,
            body,
            content_type,
        })
    }
}
