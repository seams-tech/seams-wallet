//! Filesystem primitives for recovery key files and downloaded artifacts.
//!
//! Two properties matter here and neither is the default:
//!
//! - **No overwrite, ever.** A recovery key file or downloaded package must
//!   never replace something already at that path, so installation uses a
//!   no-replace primitive rather than a rename.
//! - **Durable means verified.** Returning from `write` is not durability. A
//!   write is only reported durable after the bytes are synced, installed,
//!   the directory entry is synced, and the file is reopened, checked for
//!   ownership and mode, and re-digested from disk.
//!
//! Unix only in this release: creating a key file with anything less than
//! owner-only permissions is worse than refusing, so a platform without the
//! implemented permission model fails closed instead of writing.

use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::{RecoveryCoreError, RecoveryCoreErrorCode, RecoveryCoreResult};

/// Permissions required for a file holding recovery key material.
pub const RECOVERY_FILE_MODE_V1: u32 = 0o600;

const TEMPORARY_SUFFIX: &str = "seams-tmp";
const TEMPORARY_ATTEMPTS: u32 = 64;

/// Evidence that one file reached disk and reads back as written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableWriteOutcomeV1 {
    path: PathBuf,
    byte_length: u64,
    sha256: [u8; 32],
}

impl DurableWriteOutcomeV1 {
    /// Returns the installed path.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns the installed byte length.
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    /// Returns the SHA-256 digest read back from disk.
    pub const fn sha256(&self) -> &[u8; 32] {
        &self.sha256
    }

    /// Removes the file this write installed.
    ///
    /// For when the bytes were durable but failed a later check: leaving an
    /// unverified file at the path would block the retry that could succeed.
    /// Only the file this outcome installed is ever removed.
    pub fn discard(self) -> RecoveryCoreResult<()> {
        std::fs::remove_file(&self.path).map_err(|error| {
            durability_owned(format!(
                "could not remove the unverified file {}: {error}",
                self.path.display()
            ))
        })
    }
}

/// Writes one new file and verifies it is durable before returning.
///
/// The path must not exist. The bytes are written to a fresh owner-only
/// temporary file in the same directory, synced, installed without replacing
/// anything, the directory synced, then reopened and re-digested. Any failure
/// removes only the temporary file this call created.
pub fn write_new_file_durably_v1(
    path: &Path,
    contents: &[u8],
) -> RecoveryCoreResult<DurableWriteOutcomeV1> {
    #[cfg(not(unix))]
    {
        let _ = (path, contents);
        return Err(durability(
            "this release can only create owner-only recovery files on Unix hosts",
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty());
        let directory = parent.unwrap_or_else(|| Path::new("."));
        require_absent(path)?;

        let (temporary_path, mut file) = create_temporary(directory, path)?;
        // The temporary file was created by this process, so its owner is the
        // owner every installed file must have.
        let expected_owner = file
            .metadata()
            .map_err(|error| {
                durability_owned(format!("could not inspect the temporary file: {error}"))
            })?
            .uid();
        let result = write_and_sync(&mut file, contents);
        drop(file);
        if let Err(error) = result {
            remove_temporary(&temporary_path);
            return Err(error);
        }

        // A hard link fails when the destination exists, which is exactly the
        // no-replace install this needs; rename would silently clobber.
        if let Err(error) = std::fs::hard_link(&temporary_path, path) {
            remove_temporary(&temporary_path);
            return Err(durability_owned(format!(
                "could not install {} without replacing an existing file: {error}",
                path.display()
            )));
        }
        remove_temporary(&temporary_path);

        // The new directory entry is not durable until the directory is synced.
        sync_directory(directory)?;

        verify_installed(path, contents, expected_owner)
    }
}

/// Reads one regular file, refusing anything larger than the caller's cap.
///
/// The length is checked before the buffer is allocated, so an oversized or
/// hostile file cannot force a large allocation. The file that is opened must
/// be the file that was inspected: a symbolic link swapped in between the two
/// is detected by comparing device and inode numbers.
pub fn read_capped_file_v1(path: &Path, max_bytes: usize) -> RecoveryCoreResult<Vec<u8>> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| durability_owned(format!("could not read {}: {error}", path.display())))?;
    if metadata.file_type().is_symlink() {
        return Err(durability_owned(format!(
            "{} is a symbolic link",
            path.display()
        )));
    }
    if !metadata.is_file() {
        return Err(durability_owned(format!(
            "{} is not a regular file",
            path.display()
        )));
    }
    let length = usize::try_from(metadata.len())
        .map_err(|_| durability("file length exceeds this platform's addressable size"))?;
    if length > max_bytes {
        return Err(durability_owned(format!(
            "{} is larger than the {max_bytes}-byte limit for this artifact",
            path.display()
        )));
    }
    let file = File::open(path)
        .map_err(|error| durability_owned(format!("could not open {}: {error}", path.display())))?;
    require_same_file(&metadata, &file, path)?;
    let mut contents = Vec::with_capacity(length);
    let read = file
        .take(
            u64::try_from(max_bytes)
                .map_err(|_| durability("artifact size limit is invalid"))?
                .saturating_add(1),
        )
        .read_to_end(&mut contents)
        .map_err(|error| durability_owned(format!("could not read {}: {error}", path.display())))?;
    if read > max_bytes {
        return Err(durability_owned(format!(
            "{} grew past the {max_bytes}-byte limit while it was being read",
            path.display()
        )));
    }
    Ok(contents)
}

#[cfg(unix)]
fn require_same_file(
    inspected: &std::fs::Metadata,
    opened: &File,
    path: &Path,
) -> RecoveryCoreResult<()> {
    use std::os::unix::fs::MetadataExt;
    let actual = opened.metadata().map_err(|error| {
        durability_owned(format!(
            "could not inspect {} after opening it: {error}",
            path.display()
        ))
    })?;
    if actual.dev() != inspected.dev() || actual.ino() != inspected.ino() {
        return Err(durability_owned(format!(
            "{} changed between inspection and opening",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(not(unix))]
fn require_same_file(
    _inspected: &std::fs::Metadata,
    _opened: &File,
    _path: &Path,
) -> RecoveryCoreResult<()> {
    Ok(())
}

fn require_absent(path: &Path) -> RecoveryCoreResult<()> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Err(durability_owned(format!(
            "{} already exists; recovery files are never overwritten",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(durability_owned(format!(
            "could not inspect {}: {error}",
            path.display()
        ))),
    }
}

#[cfg(unix)]
fn create_temporary(directory: &Path, target: &Path) -> RecoveryCoreResult<(PathBuf, File)> {
    use std::os::unix::fs::OpenOptionsExt;

    let stem = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "recovery".to_owned());
    for attempt in 0..TEMPORARY_ATTEMPTS {
        let candidate = directory.join(format!(".{stem}.{attempt}.{TEMPORARY_SUFFIX}"));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(RECOVERY_FILE_MODE_V1)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(durability_owned(format!(
                    "could not create a temporary file in {}: {error}",
                    directory.display()
                )))
            }
        }
    }
    Err(durability_owned(format!(
        "could not find an unused temporary name in {}",
        directory.display()
    )))
}

fn write_and_sync(file: &mut File, contents: &[u8]) -> RecoveryCoreResult<()> {
    file.write_all(contents)
        .map_err(|error| durability_owned(format!("could not write recovery file: {error}")))?;
    file.sync_all()
        .map_err(|error| durability_owned(format!("could not sync recovery file: {error}")))
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> RecoveryCoreResult<()> {
    let handle = File::open(directory).map_err(|error| {
        durability_owned(format!(
            "could not open {} to sync it: {error}",
            directory.display()
        ))
    })?;
    handle.sync_all().map_err(|error| {
        durability_owned(format!("could not sync {}: {error}", directory.display()))
    })
}

fn remove_temporary(path: &Path) {
    // Only this invocation's temporary file is ever removed.
    let _ = std::fs::remove_file(path);
}

#[cfg(unix)]
fn verify_installed(
    path: &Path,
    expected: &[u8],
    expected_owner: u32,
) -> RecoveryCoreResult<DurableWriteOutcomeV1> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        durability_owned(format!(
            "could not reopen {} after installing it: {error}",
            path.display()
        ))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(durability_owned(format!(
            "{} is not a regular file after installation",
            path.display()
        )));
    }
    let mode = metadata.permissions().mode() & 0o777;
    if mode != RECOVERY_FILE_MODE_V1 {
        return Err(durability_owned(format!(
            "{} was installed with mode {mode:o}, not owner-only",
            path.display()
        )));
    }
    if metadata.uid() != expected_owner {
        return Err(durability_owned(format!(
            "{} is not owned by the user that created it",
            path.display()
        )));
    }
    let mut file = File::open(path).map_err(|error| {
        durability_owned(format!("could not reopen {}: {error}", path.display()))
    })?;
    require_same_file(&metadata, &file, path)?;
    let mut readback = Vec::with_capacity(expected.len());
    file.read_to_end(&mut readback).map_err(|error| {
        durability_owned(format!("could not read back {}: {error}", path.display()))
    })?;
    if readback != expected {
        return Err(durability_owned(format!(
            "{} does not read back as written",
            path.display()
        )));
    }
    Ok(DurableWriteOutcomeV1 {
        path: path.to_path_buf(),
        byte_length: metadata.len(),
        sha256: Sha256::digest(&readback).into(),
    })
}

fn durability(message: &'static str) -> RecoveryCoreError {
    RecoveryCoreError::new(RecoveryCoreErrorCode::FilesystemDurabilityFailure, message)
}

fn durability_owned(message: String) -> RecoveryCoreError {
    RecoveryCoreError::new(RecoveryCoreErrorCode::FilesystemDurabilityFailure, message)
}
