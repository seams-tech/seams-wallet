//! Compile-fail harness: a scratch crate that depends on the generator, checked with Cargo.
//! Test crates include only the support modules they call (`mod support { pub mod ui; }`), so
//! none of them carries unused helpers.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_HARNESS: AtomicU64 = AtomicU64::new(0);

/// A throwaway crate under the system temporary directory, removed on drop.
pub struct UiHarness {
    directory: PathBuf,
}

impl UiHarness {
    /// Creates `<label>-ui`, depending on this generator and on serde with derive.
    pub fn create(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock follows Unix epoch")
            .as_nanos();
        let sequence = NEXT_HARNESS.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "ed25519-yao-{label}-ui-{}-{nonce}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(directory.join("src")).expect("create UI harness source directory");
        let manifest_directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .expect("canonical generator path");
        let dependency_path = manifest_directory.to_string_lossy().replace('\\', "\\\\");
        fs::write(
            directory.join("Cargo.toml"),
            format!(
                "[package]\nname = \"{label}-ui\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\
                 [dependencies]\ned25519-yao-generator = {{ path = \"{dependency_path}\" }}\n\
                 serde = {{ version = \"1\", features = [\"derive\"] }}\n"
            ),
        )
        .expect("write UI harness manifest");
        Self { directory }
    }

    /// Runs `cargo check` on `source` as the crate's `main.rs`.
    pub fn check(&self, source: &str) -> Output {
        fs::write(self.directory.join("src/main.rs"), source).expect("write UI harness source");
        Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
            .args(["check", "--quiet", "--offline"])
            .current_dir(&self.directory)
            .env("CARGO_TARGET_DIR", self.directory.join("target"))
            .output()
            .expect("execute UI cargo check")
    }
}

impl Drop for UiHarness {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

/// Asserts that `source` fails to compile with error `code`, and returns the diagnostics.
pub fn assert_compile_failure(harness: &UiHarness, source: &str, code: &str) -> String {
    let output = harness.check(source);
    assert!(
        !output.status.success(),
        "UI case unexpectedly compiled:\n{source}"
    );
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(
        stderr.contains(code),
        "UI case failed without {code}:\n{stderr}"
    );
    stderr
}
