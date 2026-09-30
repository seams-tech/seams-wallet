use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const FORBIDDEN_PROTOCOL_INTERNALS: [&str; 6] = [
    "use ed25519_yao::",
    "ed25519_yao::local_protocol",
    "mod garbler",
    "mod evaluator",
    "mod ot",
    "mod role_protocol",
];

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn rust_sources(directory: &Path) -> Vec<PathBuf> {
    fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("{}: {error}", directory.display()))
        .map(|entry| entry.expect("source entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "rs"))
        .collect()
}

#[test]
fn protocol_sources_exclude_role_engine_internals() {
    let client = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let protocol_sources = client
        .parent()
        .expect("crates directory")
        .join("router-ab-ed25519-yao-protocol/src");
    for path in rust_sources(&protocol_sources) {
        let source = read(&path).to_lowercase();
        for forbidden in FORBIDDEN_PROTOCOL_INTERNALS {
            assert!(
                !source.contains(forbidden),
                "{} contains forbidden role-engine token {forbidden}",
                path.display()
            );
        }
    }
}

#[test]
fn resolved_normal_dependency_tree_excludes_role_engines() {
    let client = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let output = Command::new("cargo")
        .args([
            "tree",
            "--target",
            "wasm32-unknown-unknown",
            "--edges",
            "normal",
            "--prefix",
            "none",
            "--format",
            "{p}",
        ])
        .current_dir(&client)
        .output()
        .expect("cargo tree must be available for the dependency boundary test");
    assert!(
        output.status.success(),
        "cargo tree failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let tree = String::from_utf8(output.stdout).expect("cargo tree output must be UTF-8");
    let package_names: Vec<&str> = tree
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .collect();
    for forbidden in ["router-ab-ed25519-yao", "ed25519-yao"] {
        assert!(
            !package_names.contains(&forbidden),
            "normal Client dependency tree contains forbidden role engine {forbidden}"
        );
    }
}
