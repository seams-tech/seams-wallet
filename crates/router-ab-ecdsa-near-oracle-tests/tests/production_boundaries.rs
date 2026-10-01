use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const FORBIDDEN_SOURCE_TOKENS: [&str; 14] = [
    "threshold_signatures",
    "signer_core",
    "cait_sith",
    "round_based",
    "futures::",
    "tokio::",
    "async_trait",
    "Box<dyn",
    "rmp_serde",
    "println!",
    "eprintln!",
    "dbg!",
    "tracing::",
    "log::",
];

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates directory")
        .parent()
        .expect("repository root")
        .to_path_buf()
}

fn production_source_roots(root: &Path) -> [PathBuf; 4] {
    [
        root.join("crates/router-ab-ecdsa-wire/src"),
        root.join("crates/router-ab-ecdsa-pool/src"),
        root.join("crates/router-ab-ecdsa-presign/src"),
        root.join("crates/router-ab-ecdsa-online/src"),
    ]
}

fn rust_sources(directory: &Path, output: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", directory.display()))
    {
        let path = entry.expect("source entry").path();
        if path.is_dir() {
            rust_sources(&path, output);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            output.push(path);
        }
    }
}

fn resolved_normal_packages(manifest: &Path, wasm_target: bool) -> Vec<String> {
    let mut command = Command::new("cargo");
    command.args([
        "tree",
        "--manifest-path",
        manifest.to_str().expect("UTF-8 manifest path"),
        "--locked",
        "--offline",
        "--edges",
        "normal",
        "--prefix",
        "none",
        "--format",
        "{p}",
    ]);
    if wasm_target {
        command.args(["--target", "wasm32-unknown-unknown"]);
    }
    let output = command.output().expect("cargo tree must be available");
    assert!(
        output.status.success(),
        "cargo tree failed for {}: {}",
        manifest.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("cargo tree output must be UTF-8")
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .map(str::to_owned)
        .collect()
}

#[test]
fn purpose_built_sources_exclude_generic_runtime_imports() {
    let root = repository_root();
    let mut sources = Vec::new();
    for directory in production_source_roots(&root) {
        rust_sources(&directory, &mut sources);
    }
    for path in sources {
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
        for forbidden in FORBIDDEN_SOURCE_TOKENS {
            assert!(
                !source.contains(forbidden),
                "{} contains forbidden production token {forbidden}",
                path.display()
            );
        }
    }
}

#[test]
fn default_presign_api_hides_protocol_internals_and_generic_topology() {
    let root = repository_root();
    let lib_path = root.join("crates/router-ab-ecdsa-presign/src/lib.rs");
    let lib_source = fs::read_to_string(&lib_path).expect("read presign crate root");
    for module in ["codec", "driver"] {
        assert!(
            lib_source.contains(&format!("mod {module};")),
            "default presign API must retain private {module} ownership"
        );
        assert!(
            !lib_source.contains(&format!("pub mod {module};")),
            "default presign API must hide internal {module} module"
        );
    }
    for module in ["proofs", "triples"] {
        let test_only_public_module =
            format!("#[cfg(any(test, feature = \"test-utils\"))]\npub mod {module};");
        assert!(
            lib_source.contains(&test_only_public_module),
            "{module} must be public only for unit tests and the pinned oracle"
        );
    }

    let session_path = root.join("crates/router-ab-ecdsa-presign/src/session.rs");
    let session_source = fs::read_to_string(&session_path).expect("read presign session source");
    for forbidden in ["participant", "threshold", "runtime_role", "role_selector"] {
        assert!(
            !session_source.contains(forbidden),
            "fixed production session surface contains generic topology token {forbidden}"
        );
    }
}

fn assert_leaf_graph_excludes(root: &Path, relative_manifest: &str, forbidden: &[&str]) {
    let manifest = root.join(relative_manifest);
    for package in resolved_normal_packages(&manifest, true) {
        assert!(
            !forbidden.iter().any(|name| package == *name),
            "{} resolves forbidden leaf package {package}",
            manifest.display()
        );
    }
}

#[test]
fn cloudflare_signing_worker_finalization_excludes_near_ecdsa_backend() {
    let root = repository_root();
    assert_leaf_graph_excludes(
        &root,
        "crates/router-ab-cloudflare/Cargo.toml",
        &["threshold-signatures", "cait-sith", "rmp-serde"],
    );
}
