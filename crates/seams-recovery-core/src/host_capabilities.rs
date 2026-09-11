//! What the host could actually provide for in-memory secret handling.
//!
//! The CLI never claims a general-purpose host is a hardware security boundary.
//! When the platform refuses memory locking or crash-dump suppression the
//! operation still proceeds, but the capability is reported as false and the
//! operator sees a warning — there is no silent, platform-dependent refusal.

use serde::Serialize;

/// Host secret-handling capabilities obtained for one CLI invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryHostSecretCapabilitiesV1 {
    /// Whether secret pages were locked out of swap.
    pub memory_locking: bool,
    /// Whether crash dumps of this process were suppressed.
    pub crash_dump_suppression: bool,
}

impl RecoveryHostSecretCapabilitiesV1 {
    /// Records what the platform adapter actually achieved.
    pub const fn new(memory_locking: bool, crash_dump_suppression: bool) -> Self {
        Self {
            memory_locking,
            crash_dump_suppression,
        }
    }

    /// Returns true when both protections were obtained.
    pub const fn is_complete(self) -> bool {
        self.memory_locking && self.crash_dump_suppression
    }

    /// Returns one warning per protection the host could not provide.
    pub fn warnings(self) -> Vec<&'static str> {
        let mut warnings = Vec::new();
        if !self.memory_locking {
            warnings.push(
                "this host could not lock secret memory; recovery key material may reach swap",
            );
        }
        if !self.crash_dump_suppression {
            warnings.push(
                "this host could not suppress crash dumps; a crash may write recovery key material to disk",
            );
        }
        warnings
    }
}
