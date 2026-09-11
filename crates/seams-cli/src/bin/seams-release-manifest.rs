#![forbid(unsafe_code)]
//! Generates one signed release checksum manifest.
//!
//! This runs in the release pipeline, not on an operator's machine. It is a
//! separate binary from `seams` so the recovery tool never links code that can
//! sign a release: the roots are separate, and so are the programs that use
//! them.
//!
//! The signing key is read from a dedicated file descriptor, never an argument
//! or an environment variable, so it does not reach a process listing or a CI
//! log through the command line.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use base64ct::{Base64UrlUnpadded, Encoding};
use seams_recovery_core::{ReleaseArtifactEntryV1, ReleaseChecksumManifestV1};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

fn main() {
    match run() {
        // Written without a trailing newline: the file must be exactly the
        // canonical manifest bytes, or a verifier that reads it whole will
        // reject its own release.
        Ok(manifest) => {
            use std::io::Write;
            let mut out = std::io::stdout();
            let _ = out.write_all(manifest.as_bytes());
            let _ = out.flush();
        }
        Err(message) => {
            eprintln!("error: {message}");
            std::process::exit(2);
        }
    }
}

fn run() -> Result<String, String> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let options = parse(&arguments)?;

    let mut entries: Vec<ReleaseArtifactEntryV1> = Vec::new();
    for (target, path) in &options.artifacts {
        let bytes = std::fs::read(path)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        let filename = path
            .file_name()
            .ok_or_else(|| format!("{} has no file name", path.display()))?
            .to_string_lossy()
            .into_owned();
        entries.push(ReleaseArtifactEntryV1 {
            target: target.clone(),
            filename,
            sha256_b64u: Base64UrlUnpadded::encode_string(&<[u8; 32]>::from(Sha256::digest(
                &bytes,
            ))),
        });
    }
    // The manifest requires a sorted, unique artifact list.
    entries.sort_by(|left, right| left.filename.cmp(&right.filename));

    let signing_key = read_signing_key(options.signing_key_fd)?;
    let manifest = ReleaseChecksumManifestV1::sign(
        options.release_version,
        options.source_revision,
        options.minimum_protocol_version,
        options.signer_key_id,
        entries,
        &signing_key,
    )
    .map_err(|error| error.message().to_owned())?;
    let bytes = manifest
        .canonical_json()
        .map_err(|error| error.message().to_owned())?;
    String::from_utf8(bytes).map_err(|_| "manifest is not valid UTF-8".to_owned())
}

struct Options {
    release_version: String,
    source_revision: String,
    minimum_protocol_version: String,
    signer_key_id: String,
    signing_key_fd: u16,
    /// Target triple to built artifact path.
    artifacts: Vec<(String, PathBuf)>,
}

fn parse(arguments: &[String]) -> Result<Options, String> {
    let mut values: BTreeMap<String, String> = BTreeMap::new();
    let mut artifacts: Vec<(String, PathBuf)> = Vec::new();
    let mut index = 0;
    while index < arguments.len() {
        let name = arguments[index]
            .strip_prefix("--")
            .ok_or_else(|| format!("unexpected argument {}", arguments[index]))?;
        let value = arguments
            .get(index + 1)
            .ok_or_else(|| format!("--{name} needs a value"))?;
        if name == "artifact" {
            let (target, path) = value
                .split_once('=')
                .ok_or_else(|| "--artifact must be <target>=<path>".to_owned())?;
            artifacts.push((target.to_owned(), PathBuf::from(path)));
        } else {
            values.insert(name.to_owned(), value.clone());
        }
        index += 2;
    }

    let take = |name: &str| -> Result<String, String> {
        values
            .get(name)
            .cloned()
            .ok_or_else(|| format!("--{name} is required"))
    };
    let signing_key_fd: u16 = take("signing-key-fd")?
        .parse()
        .map_err(|_| "--signing-key-fd must be a file descriptor number".to_owned())?;
    if signing_key_fd <= 2 {
        return Err(
            "--signing-key-fd must be a dedicated descriptor, not standard input or output"
                .to_owned(),
        );
    }
    if artifacts.is_empty() {
        return Err("at least one --artifact <target>=<path> is required".to_owned());
    }
    Ok(Options {
        release_version: take("release-version")?,
        source_revision: take("source-revision")?,
        minimum_protocol_version: take("minimum-protocol-version")?,
        signer_key_id: take("signer-key-id")?,
        signing_key_fd,
        artifacts,
    })
}

/// Reads the release signing seed from its dedicated descriptor.
fn read_signing_key(descriptor: u16) -> Result<[u8; 32], String> {
    let path = Path::new("/dev/fd").join(descriptor.to_string());
    let mut file = std::fs::File::open(&path)
        .map_err(|error| format!("could not read the signing key descriptor: {error}"))?;
    let mut encoded = Zeroizing::new(String::new());
    file.read_to_string(&mut encoded)
        .map_err(|error| format!("could not read the signing key descriptor: {error}"))?;
    let decoded = Zeroizing::new(
        Base64UrlUnpadded::decode_vec(encoded.trim())
            .map_err(|_| "the release signing key is not canonical base64url".to_owned())?,
    );
    decoded
        .as_slice()
        .try_into()
        .map_err(|_| "the release signing key must be 32 bytes".to_owned())
}
