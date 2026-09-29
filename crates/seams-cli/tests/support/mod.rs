use std::path::{Path, PathBuf};

use router_ab_core::TenantRootRecoveryTrustBundleV1;

pub fn recovery_trust() -> TenantRootRecoveryTrustBundleV1 {
    TenantRootRecoveryTrustBundleV1::from_canonical_json(include_bytes!(
        "../../../router-ab-core/tests/fixtures/tenant-root-recovery/trust-bundle.json"
    ))
    .expect("canonical fixture trust bundle")
}

/// A fresh temporary directory, removed on drop. Its name starts with `prefix`,
/// which keeps each test file's directories apart from the others'.
pub struct Scratch {
    pub root: PathBuf,
}

impl Scratch {
    pub fn new(prefix: &str, name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("{prefix}-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("scratch directory");
        Self { root }
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// Returns a file from router-ab-core's committed recovery artifact set.
pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../router-ab-core/tests/fixtures/tenant-root-recovery")
        .join(name)
}
