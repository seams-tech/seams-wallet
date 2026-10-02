use serde::Serialize;

/// Required limitation for deployments without verified cryptographic erasure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TenantRootOperationalErasureClaimV1 {
    /// Service paths were removed; cryptographic erasure was not verified.
    CryptographicErasureUnverified,
}
