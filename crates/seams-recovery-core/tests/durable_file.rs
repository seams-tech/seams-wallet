//! Filesystem safety and durability vectors for recovery outputs.

#![cfg(unix)]

use seams_recovery_core::{read_capped_file_v1, write_new_file_durably_v1, RECOVERY_FILE_MODE_V1};
use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// One scratch directory per test, removed afterwards.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("seams-recovery-core-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("scratch directory");
        Self { root }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn temporaries(directory: &Path) -> Vec<String> {
    std::fs::read_dir(directory)
        .expect("read scratch")
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().to_string_lossy().into_owned();
            name.ends_with("seams-tmp").then_some(name)
        })
        .collect()
}

#[test]
fn a_durable_write_is_owner_only_and_reads_back_as_written() {
    let scratch = Scratch::new("durable-write");
    let path = scratch.path("deriver-a.key");
    let contents = b"recovery key file bytes".to_vec();

    let outcome = write_new_file_durably_v1(&path, &contents).expect("durable write");
    assert_eq!(outcome.path(), path.as_path());
    assert_eq!(outcome.byte_length(), contents.len() as u64);
    assert_eq!(
        outcome.sha256(),
        &<[u8; 32]>::from(Sha256::digest(&contents))
    );

    let metadata = std::fs::metadata(&path).expect("metadata");
    assert_eq!(metadata.permissions().mode() & 0o777, RECOVERY_FILE_MODE_V1);
    assert_eq!(std::fs::read(&path).expect("read"), contents);

    // Nothing of this invocation is left behind.
    assert!(temporaries(&scratch.root).is_empty());
}

#[test]
fn an_existing_path_is_never_overwritten() {
    let scratch = Scratch::new("no-overwrite");
    let path = scratch.path("deriver-a.key");
    std::fs::write(&path, b"existing").expect("seed");

    assert!(write_new_file_durably_v1(&path, b"replacement").is_err());
    assert_eq!(std::fs::read(&path).expect("read"), b"existing");
    assert!(temporaries(&scratch.root).is_empty());
}

#[test]
fn a_symlink_target_is_refused_rather_than_followed() {
    let scratch = Scratch::new("symlink");
    let victim = scratch.path("victim");
    std::fs::write(&victim, b"do not touch").expect("seed");
    let link = scratch.path("deriver-a.key");
    std::os::unix::fs::symlink(&victim, &link).expect("symlink");

    assert!(write_new_file_durably_v1(&link, b"replacement").is_err());
    assert_eq!(std::fs::read(&victim).expect("read"), b"do not touch");
    assert!(read_capped_file_v1(&link, 4096).is_err());

    // A dangling link is still an existing path, not a free slot.
    let dangling = scratch.path("dangling.key");
    std::os::unix::fs::symlink(scratch.path("missing"), &dangling).expect("symlink");
    assert!(write_new_file_durably_v1(&dangling, b"replacement").is_err());
    assert!(temporaries(&scratch.root).is_empty());
}

#[test]
fn a_failed_write_leaves_no_temporary_behind() {
    let scratch = Scratch::new("failed-write");
    let path = scratch.path("missing-directory").join("deriver-a.key");
    assert!(write_new_file_durably_v1(&path, b"contents").is_err());
    assert!(!path.exists());
    assert!(temporaries(&scratch.root).is_empty());
}

#[test]
fn reads_are_capped_before_allocation() {
    let scratch = Scratch::new("capped-read");
    let path = scratch.path("package.backup");
    std::fs::write(&path, vec![0x5a_u8; 1024]).expect("seed");

    assert_eq!(read_capped_file_v1(&path, 1024).expect("read").len(), 1024);
    assert!(read_capped_file_v1(&path, 1023).is_err());
    assert!(read_capped_file_v1(&scratch.path("absent"), 1024).is_err());
    assert!(read_capped_file_v1(&scratch.root, 1024).is_err());
}

#[test]
fn writes_into_the_same_directory_do_not_collide() {
    let scratch = Scratch::new("parallel-names");
    for index in 0..4 {
        let path = scratch.path(&format!("package-{index}.backup"));
        write_new_file_durably_v1(&path, format!("contents {index}").as_bytes())
            .expect("durable write");
    }
    assert!(temporaries(&scratch.root).is_empty());
    assert_eq!(
        std::fs::read_dir(&scratch.root).expect("read dir").count(),
        4
    );
}
