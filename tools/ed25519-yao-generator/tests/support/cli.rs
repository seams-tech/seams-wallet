//! Round trip through the `ed25519-yao-vectors` binary. Test crates include only the support
//! modules they call (`mod support { pub mod cli; }`), so none of them carries unused helpers.

use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Emits `corpus` to a temporary file, asserts it holds `expected`, then checks that file.
pub fn assert_emit_and_check(corpus: &str, expected: &[u8]) {
    let binary = env!("CARGO_BIN_EXE_ed25519-yao-vectors");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock follows Unix epoch")
        .as_nanos();
    let output = std::env::temp_dir().join(format!(
        "ed25519-yao-{corpus}-emit-{}-{nonce}.json",
        std::process::id()
    ));
    let path = output.to_str().expect("UTF-8 path");
    let emit = Command::new(binary)
        .arg(format!("emit-{corpus}"))
        .args(["--output", path])
        .output()
        .expect("run vector emitter");
    assert!(
        emit.status.success(),
        "{}",
        String::from_utf8_lossy(&emit.stderr)
    );
    assert_eq!(fs::read(&output).expect("emitted corpus"), expected);
    let check = Command::new(binary)
        .arg(format!("check-{corpus}"))
        .args(["--input", path])
        .output()
        .expect("run vector checker");
    assert!(
        check.status.success(),
        "{}",
        String::from_utf8_lossy(&check.stderr)
    );
    fs::remove_file(output).expect("remove emitted corpus");
}
