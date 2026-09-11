use router_ab_core::TenantRootRecoveryTrustBundleV1;

pub fn recovery_trust() -> TenantRootRecoveryTrustBundleV1 {
    TenantRootRecoveryTrustBundleV1::from_canonical_json(include_bytes!(
        "../../../router-ab-core/tests/fixtures/tenant-root-recovery/trust-bundle.json"
    ))
    .expect("canonical fixture trust bundle")
}
