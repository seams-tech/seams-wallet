#![forbid(unsafe_code)]
//! Passive two-party ML-DSA-65 key generation, preparation, and signing.
//! Host admission, authenticated transport, and durable storage live in adapters.

pub mod circuits;
pub mod runtime;
pub mod signing;

/// Synthetic-fixture measurement adapters. Never provide wallet secrets.
#[cfg(feature = "benchmarks")]
pub mod benchmarks {
    pub mod ml_dsa_kernel;
    pub mod ml_dsa_private;
}
