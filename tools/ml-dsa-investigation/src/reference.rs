use crate::{InvestigationResult, command_text, digest, require};
use ml_dsa::{EncodedSignature, Keypair, MlDsa65, Seed, Signature, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, hint::black_box, path::Path, process::Command, time::Instant};

const PUBLIC_FIXTURE_NAMES: [&str; 4] = ["zero", "incrementing", "all-ff", "alternating"];
const CONTEXTS: [&[u8]; 2] = [b"", b"seams.ml-dsa-investigation.v1"];
// DER AlgorithmIdentifier for ML-DSA-65, OID 2.16.840.1.101.3.4.3.18.
const ALGORITHM_IDENTIFIER: [u8; 13] = [
    0x30, 0x0b, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x12,
];

#[derive(Serialize, Deserialize)]
pub(super) struct RecoveryEvidence {
    fixture: String,
    seed_hex: String,
    public_key_sha256: String,
    reconstructed_signing_key_equals_fixture_signing_key: bool,
    deterministic_signature_sha256: Vec<String>,
}

pub(super) fn fixture_bytes(name: &str, length: usize) -> InvestigationResult<Vec<u8>> {
    require(
        PUBLIC_FIXTURE_NAMES.contains(&name),
        "Unknown public fixture name.",
    )?;
    let mut bytes = Vec::with_capacity(length);
    for index in 0..length {
        bytes.push(match name {
            "zero" => 0,
            "incrementing" => (index % 256) as u8,
            "all-ff" => 0xff,
            "alternating" => {
                if index % 2 == 0 {
                    0xaa
                } else {
                    0x55
                }
            }
            _ => unreachable!(),
        });
    }
    Ok(bytes)
}

fn public_message() -> [u8; 32] {
    Sha256::digest(b"Public synthetic transaction-shaped input for the ML-DSA-65 investigation v1")
        .into()
}

fn public_seed(name: &str) -> InvestigationResult<Seed> {
    Ok(fixture_bytes(name, 32)?.as_slice().try_into()?)
}

pub(super) fn recover_public_fixture(name: &str) -> InvestigationResult<RecoveryEvidence> {
    let seed = public_seed(name)?;
    let share_a = fixture_bytes("alternating", 32)?;
    let mut share_b = [0_u8; 32];
    let mut recovered = [0_u8; 32];
    for index in 0..32 {
        share_b[index] = seed[index] ^ share_a[index];
        recovered[index] = share_a[index] ^ share_b[index];
    }
    let key = SigningKey::<MlDsa65>::from_seed(&recovered.into());
    let fixture_key = SigningKey::<MlDsa65>::from_seed(&seed);
    let mut signatures = Vec::new();
    for context in CONTEXTS {
        signatures.push(digest(
            key.expanded_key()
                .sign_deterministic(&public_message(), context)?
                .encode()
                .as_slice(),
        ));
    }
    Ok(RecoveryEvidence {
        fixture: name.to_owned(),
        seed_hex: hex::encode(recovered),
        public_key_sha256: digest(key.verifying_key().encode().as_slice()),
        reconstructed_signing_key_equals_fixture_signing_key: key == fixture_key,
        deterministic_signature_sha256: signatures,
    })
}

pub(super) fn run(samples: usize) -> InvestigationResult<Value> {
    let openssl_version = command_text(Command::new("openssl").args(["version", "-a"]))?;
    let openssl_path = command_text(Command::new("which").arg("openssl"))?;
    let openssl_real_path = fs::canonicalize(&openssl_path)?;
    let provider = command_text(Command::new("openssl").args([
        "list",
        "-providers",
        "-verbose",
        "-provider",
        "default",
    ]))?;
    let mut cases = Vec::new();
    for name in PUBLIC_FIXTURE_NAMES {
        cases.push(run_fixture(name, samples)?);
    }
    Ok(json!({
        "algorithm": "Pure ML-DSA-65, FIPS 204 Algorithms 2, 3, and 6",
        "implementations": {"rustcrypto": "ml-dsa =0.1.1", "openssl": {"version": openssl_version, "executable": openssl_real_path, "executable_sha256": digest(&fs::read(&openssl_real_path)?), "provider": provider}},
        "message": {"hex": hex::encode(public_message()), "construction": "SHA256 of a fixed public marker. This is a 32-byte NEAR-shaped input. No Borsh transaction or NEAR network verifier is exercised."},
        "signature_randomness": "Deterministic FIPS 204 variant with rnd=00 repeated 32 times in both implementations.",
        "recovery_limit": "A separate recipient process reconstructs only fixed public XOR shares. It locally generates those public shares from the named fixture. This checks reproducibility across a process boundary. It does not transport shares or implement recipient authentication or confidential export.",
        "timing_method": "Reference comparisons run before measurement and warm each operation. Each sample covers one operation. OpenSSL samples include subprocess startup, file access, and key import. Neither timing is a Worker latency measurement.",
        "openssl_command_directory": "A temporary directory containing fixed public fixtures. All listed command arguments use filenames relative to that directory.",
        "openssl_commands": command_templates(),
        "fixtures": cases,
    }))
}

fn run_fixture(name: &str, samples: usize) -> InvestigationResult<Value> {
    let seed = public_seed(name)?;
    let message = public_message();
    let key = SigningKey::<MlDsa65>::from_seed(&seed);
    let public = key.verifying_key().encode();
    require(public.len() == 1952, "Unexpected ML-DSA-65 key sizes.")?;
    require(
        key.to_seed() == seed,
        "RustCrypto seed export differs from the input seed.",
    )?;

    let scratch = tempfile::tempdir()?;
    let directory = scratch.path();
    fs::write(
        directory.join("seed.pk8"),
        private_key_der(0x80, seed.as_slice()),
    )?;
    fs::write(directory.join("message.bin"), message)?;
    let mut changed_message = message;
    changed_message[0] ^= 1;
    fs::write(directory.join("changed-message.bin"), changed_message)?;
    openssl_command(directory, &public_key_command())?;
    require(
        fs::read(directory.join("public.der"))? == public_key_der(public.as_slice()),
        "OpenSSL and RustCrypto public keys differ.",
    )?;
    openssl_command(directory, &expanded_key_command())?;
    let expanded_der = fs::read(directory.join("expanded.pk8"))?;
    let expanded_length = 4032;
    let wrapper_length = private_key_der(0x04, &vec![0; expanded_length]).len() - expanded_length;
    require(
        expanded_der.len() == wrapper_length + expanded_length,
        "Unexpected expanded private key DER size.",
    )?;
    let expanded = &expanded_der[wrapper_length..];
    require(
        expanded_der == private_key_der(0x04, expanded),
        "Unexpected expanded private key DER wrapper.",
    )?;
    let mut changed_seed = seed;
    changed_seed[0] ^= 1;
    let wrong_key = SigningKey::<MlDsa65>::from_seed(&changed_seed);
    fs::write(
        directory.join("wrong-public.der"),
        public_key_der(wrong_key.verifying_key().encode().as_slice()),
    )?;

    let recovery_text = command_text(
        Command::new(std::env::current_exe()?).args(["recover-public-fixture", name]),
    )?;
    let recovery: RecoveryEvidence = serde_json::from_str(&recovery_text)?;
    require(
        recovery.fixture == name && recovery.seed_hex == hex::encode(seed.as_slice()),
        "Recovery process returned a different seed.",
    )?;
    require(
        recovery.public_key_sha256 == digest(public.as_slice())
            && recovery.reconstructed_signing_key_equals_fixture_signing_key,
        "Recovered keypair differs from the reference keypair.",
    )?;

    let mut contexts = Vec::new();
    for (index, context) in CONTEXTS.iter().enumerate() {
        let evidence = run_context(directory, &key, &wrong_key, context, samples)?;
        require(
            recovery.deterministic_signature_sha256[index]
                == evidence["signature_sha256"]
                    .as_str()
                    .ok_or("Missing signature digest.")?,
            "Recovered deterministic signature differs from the reference signature.",
        )?;
        contexts.push(evidence);
    }
    let mut keygen_ns = Vec::with_capacity(samples);
    for _ in 0..samples {
        let start = Instant::now();
        let generated = SigningKey::<MlDsa65>::from_seed(black_box(&seed));
        keygen_ns.push(start.elapsed().as_nanos());
        black_box(generated);
    }
    let mut openssl_keygen_ns = Vec::with_capacity(samples);
    for _ in 0..samples {
        let start = Instant::now();
        openssl_command(directory, &public_key_command())?;
        openssl_keygen_ns.push(start.elapsed().as_nanos());
    }
    Ok(json!({
        "fixture": name,
        "public_seed_hex": hex::encode(seed.as_slice()),
        "sizes_bytes": {"seed": seed.len(), "public_key": public.len(), "expanded_private_key": expanded.len(), "seed_pkcs8": private_key_der(0x80, seed.as_slice()).len(), "public_spki": public_key_der(public.as_slice()).len()},
        "public_key_sha256": digest(public.as_slice()),
        "openssl_expanded_private_key_sha256_public_fixture_only": digest(expanded),
        "seed_public_key_and_deterministic_signatures_identical_across_implementations": true,
        "expanded_private_export_limit": "Only OpenSSL exports the FIPS 204 expanded private encoding. RustCrypto 0.1.1 deprecates this export API. The tool uses its current seed and signing APIs.",
        "same_seed_recovery_identical": true,
        "recovery_recipient_process": recovery,
        "rust_keygen": timing_samples(keygen_ns),
        "openssl_seed_import_keygen_and_public_export_subprocess": timing_samples(openssl_keygen_ns),
        "contexts": contexts,
    }))
}

fn run_context(
    directory: &Path,
    key: &SigningKey<MlDsa65>,
    wrong_key: &SigningKey<MlDsa65>,
    context: &[u8],
    samples: usize,
) -> InvestigationResult<Value> {
    let message = public_message();
    let verifying_key = key.verifying_key();
    let signature = key.expanded_key().sign_deterministic(&message, context)?;
    let signature_bytes = signature.encode();
    require(
        signature_bytes.len() == 3309,
        "Unexpected ML-DSA-65 signature size.",
    )?;
    fs::write(directory.join("rust.sig"), signature_bytes.as_slice())?;
    openssl_command(directory, &sign_command(context))?;
    let openssl_bytes = fs::read(directory.join("openssl.sig"))?;
    require(
        openssl_bytes == signature_bytes.as_slice(),
        "Deterministic signatures differ between implementations.",
    )?;
    let encoded: EncodedSignature<MlDsa65> = openssl_bytes.as_slice().try_into()?;
    let openssl_signature =
        Signature::decode(&encoded).ok_or("OpenSSL signature does not decode.")?;
    require(
        verifying_key.verify_with_context(&message, context, &openssl_signature),
        "RustCrypto rejected the OpenSSL signature.",
    )?;
    require(
        openssl_verify(directory, "message.bin", "rust.sig", context)?,
        "OpenSSL rejected the RustCrypto signature.",
    )?;

    let mut changed_message = message;
    changed_message[0] ^= 1;
    let changed_context = b"seams.changed-context";
    let mut changed_bytes = signature_bytes;
    changed_bytes[0] ^= 1;
    fs::write(directory.join("changed.sig"), changed_bytes.as_slice())?;
    let changed_signature = Signature::decode(&changed_bytes);
    let changed_signature_rejected = match changed_signature {
        Some(value) => !verifying_key.verify_with_context(&message, context, &value),
        None => true,
    };
    require(
        !verifying_key.verify_with_context(&changed_message, context, &signature),
        "RustCrypto accepted a changed message.",
    )?;
    require(
        !verifying_key.verify_with_context(&message, changed_context, &signature),
        "RustCrypto accepted a changed context.",
    )?;
    require(
        changed_signature_rejected,
        "RustCrypto accepted a changed signature.",
    )?;
    require(
        !wrong_key
            .verifying_key()
            .verify_with_context(&message, context, &signature),
        "RustCrypto accepted the signature with a wrong public key.",
    )?;
    require(
        !openssl_verify_with_key(
            directory,
            "message.bin",
            "rust.sig",
            context,
            "wrong-public.der",
        )?,
        "OpenSSL accepted the signature with a wrong public key.",
    )?;
    require(
        !openssl_verify(directory, "changed-message.bin", "rust.sig", context)?,
        "OpenSSL accepted a changed message.",
    )?;
    require(
        !openssl_verify(directory, "message.bin", "rust.sig", changed_context)?,
        "OpenSSL accepted a changed context.",
    )?;
    require(
        !openssl_verify(directory, "message.bin", "changed.sig", context)?,
        "OpenSSL accepted a changed signature.",
    )?;

    let mut sign_ns = Vec::with_capacity(samples);
    let mut verify_ns = Vec::with_capacity(samples);
    let mut openssl_sign_ns = Vec::with_capacity(samples);
    let mut openssl_verify_ns = Vec::with_capacity(samples);
    for _ in 0..samples {
        let start = Instant::now();
        let signed = key
            .expanded_key()
            .sign_deterministic(black_box(&message), black_box(context))?;
        sign_ns.push(start.elapsed().as_nanos());
        black_box(signed);
        let start = Instant::now();
        let verified = verifying_key.verify_with_context(
            black_box(&message),
            black_box(context),
            black_box(&signature),
        );
        verify_ns.push(start.elapsed().as_nanos());
        require(
            verified,
            "RustCrypto verification failed during measurement.",
        )?;
        let start = Instant::now();
        openssl_command(directory, &sign_command(context))?;
        openssl_sign_ns.push(start.elapsed().as_nanos());
        let start = Instant::now();
        require(
            openssl_verify(directory, "message.bin", "rust.sig", context)?,
            "OpenSSL verification failed during measurement.",
        )?;
        openssl_verify_ns.push(start.elapsed().as_nanos());
    }
    Ok(json!({
        "context_hex": hex::encode(context),
        "signature_bytes": signature_bytes.len(),
        "signature_sha256": digest(signature_bytes.as_slice()),
        "deterministic_signatures_identical": true,
        "rust_verifies_openssl": true,
        "openssl_verifies_rust": true,
        "both_reject_changed_message_context_and_signature": true,
        "both_reject_wrong_public_key": true,
        "rust_sign": timing_samples(sign_ns),
        "rust_verify": timing_samples(verify_ns),
        "openssl_sign_subprocess": timing_samples(openssl_sign_ns),
        "openssl_verify_subprocess": timing_samples(openssl_verify_ns),
    }))
}

fn timing_samples(samples: Vec<u128>) -> Value {
    let mut sorted = samples.clone();
    sorted.sort_unstable();
    let p95_index = (sorted.len() * 95).div_ceil(100).saturating_sub(1);
    json!({
        "unit": "nanoseconds",
        "samples": samples,
        "minimum": sorted[0],
        "median": sorted[sorted.len() / 2],
        "p95": sorted[p95_index],
        "maximum": sorted[sorted.len() - 1],
    })
}

fn public_key_command() -> Vec<String> {
    strings(&[
        "pkey",
        "-provider",
        "default",
        "-inform",
        "DER",
        "-in",
        "seed.pk8",
        "-pubout",
        "-outform",
        "DER",
        "-out",
        "public.der",
    ])
}

fn expanded_key_command() -> Vec<String> {
    strings(&[
        "pkey",
        "-provider",
        "default",
        "-provparam",
        "default:ml-dsa.retain_seed=false",
        "-inform",
        "DER",
        "-in",
        "seed.pk8",
        "-outform",
        "DER",
        "-out",
        "expanded.pk8",
    ])
}

fn sign_command(context: &[u8]) -> Vec<String> {
    let mut command = strings(&[
        "pkeyutl",
        "-provider",
        "default",
        "-sign",
        "-rawin",
        "-keyform",
        "DER",
        "-inkey",
        "seed.pk8",
        "-in",
        "message.bin",
        "-out",
        "openssl.sig",
        "-pkeyopt",
        "deterministic:1",
    ]);
    append_context(&mut command, context);
    command
}

fn verify_command(message: &str, signature: &str, context: &[u8]) -> Vec<String> {
    verify_with_key_command(message, signature, context, "public.der")
}

fn verify_with_key_command(
    message: &str,
    signature: &str,
    context: &[u8],
    public_key_file: &str,
) -> Vec<String> {
    let mut command = strings(&[
        "pkeyutl",
        "-provider",
        "default",
        "-verify",
        "-rawin",
        "-pubin",
        "-keyform",
        "DER",
        "-inkey",
        public_key_file,
        "-in",
        message,
        "-sigfile",
        signature,
    ]);
    append_context(&mut command, context);
    command
}

fn append_context(command: &mut Vec<String>, context: &[u8]) {
    if !context.is_empty() {
        command.push("-pkeyopt".to_owned());
        command.push(format!("hexcontext-string:{}", hex::encode(context)));
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(ToString::to_string).collect()
}

fn openssl_command(directory: &Path, arguments: &[String]) -> InvestigationResult<()> {
    command_text(
        Command::new("openssl")
            .args(arguments)
            .current_dir(directory),
    )?;
    Ok(())
}

fn openssl_verify(
    directory: &Path,
    message: &str,
    signature: &str,
    context: &[u8],
) -> InvestigationResult<bool> {
    openssl_verify_with_key(directory, message, signature, context, "public.der")
}

fn openssl_verify_with_key(
    directory: &Path,
    message: &str,
    signature: &str,
    context: &[u8],
    public_key_file: &str,
) -> InvestigationResult<bool> {
    let output = Command::new("openssl")
        .args(verify_with_key_command(
            message,
            signature,
            context,
            public_key_file,
        ))
        .current_dir(directory)
        .output()?;
    if output.status.success() {
        require(
            String::from_utf8_lossy(&output.stdout).contains("Signature Verified Successfully"),
            "OpenSSL returned unexpected verification output.",
        )?;
        return Ok(true);
    }
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    require(
        output.status.code() == Some(1) && text.contains("Signature Verification Failure"),
        &format!("OpenSSL failed before signature verification: {text}"),
    )?;
    Ok(false)
}

fn command_templates() -> Value {
    json!({
        "keygen_from_seed_and_export_public": public_key_command(),
        "export_expanded_key": expanded_key_command(),
        "sign_empty_context": sign_command(CONTEXTS[0]),
        "sign_nonempty_context": sign_command(CONTEXTS[1]),
        "verify": verify_command("message.bin", "rust.sig", CONTEXTS[1]),
        "reject_changed_message": verify_command("changed-message.bin", "rust.sig", CONTEXTS[1]),
        "reject_changed_context": verify_command("message.bin", "rust.sig", b"seams.changed-context"),
        "reject_changed_signature": verify_command("message.bin", "changed.sig", CONTEXTS[1]),
        "reject_wrong_public_key": verify_with_key_command("message.bin", "rust.sig", CONTEXTS[1], "wrong-public.der"),
    })
}

fn private_key_der(inner_tag: u8, bytes: &[u8]) -> Vec<u8> {
    let mut content = vec![0x02, 0x01, 0x00];
    content.extend_from_slice(&ALGORITHM_IDENTIFIER);
    content.extend(der(0x04, &der(inner_tag, bytes)));
    der(0x30, &content)
}

fn public_key_der(bytes: &[u8]) -> Vec<u8> {
    let mut content = ALGORITHM_IDENTIFIER.to_vec();
    let mut bit_string = vec![0];
    bit_string.extend_from_slice(bytes);
    content.extend(der(0x03, &bit_string));
    der(0x30, &content)
}

fn der(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut output = vec![tag];
    if content.len() < 128 {
        output.push(content.len() as u8);
    } else {
        let length = content.len().to_be_bytes();
        let first = length
            .iter()
            .position(|byte| *byte != 0)
            .expect("Nonzero DER length.");
        output.push(0x80 | (length.len() - first) as u8);
        output.extend_from_slice(&length[first..]);
    }
    output.extend_from_slice(content);
    output
}
