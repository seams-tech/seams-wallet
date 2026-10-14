//! Mixed private GMW circuits test lane packing, output ownership, and batching.

use crate::{
    InvestigationResult,
    boolean_engine_evidence::{PipeTransport, run_ready},
    circuit_evidence, digest, garbled_execution, prepared_signing_evidence, private_execution,
    require,
};
use ed25519_yao::{
    ml_dsa_runtime::{
        TrustedMlDsaSchedule,
        boolean_comparison::{
            Transport,
            prepared::{BatchMetrics, prepare_batch},
            silent::CorrelationStream,
        },
    },
    ml_dsa_signing::SigningRole,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{env, ffi::OsStr, fs, io, path::Path, time::Instant};
use zeroize::Zeroizing;

const Q: u32 = 8_380_417;

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let args: Vec<_> = env::args().skip(1).collect();
    let role = match args.first().map(String::as_str) {
        Some("prepared-gmw-role-a") => SigningRole::A,
        Some("prepared-gmw-role-b") => SigningRole::B,
        _ => return Ok(false),
    };
    require(
        args.len() == 4,
        "Prepared GMW role needs schedules, own fixtures, and report",
    )?;
    let book: Value = serde_json::from_slice(&fs::read(&args[2])?)?;
    let cases = book.as_array().ok_or("Missing cases")?;
    let names = [
        "commitment-hash",
        "response-check",
        "low-response-check",
        "bounds-decision",
    ];
    let bytes = names
        .iter()
        .map(|name| fs::read(Path::new(&args[1]).join(format!("{name}.bin"))))
        .collect::<Result<Vec<_>, _>>()?;
    let schedules = bytes
        .iter()
        .map(|bytes| TrustedMlDsaSchedule::parse(bytes, Sha256::digest(bytes).into()))
        .collect::<Result<Vec<_>, _>>()?;
    let mut requested = Vec::new();
    for case in cases {
        let index = names
            .iter()
            .position(|name| case["name"] == *name)
            .ok_or("Unknown workload")?;
        requested.push(&schedules[index]);
    }
    let mut transport = PipeTransport::new(io::stdin().lock(), io::stdout().lock());
    let mut correlations = CorrelationStream::new(role, [0x47; 32]);
    let started = Instant::now();
    let prepared = match run_ready(prepare_batch(
        role,
        &requested,
        &mut correlations,
        &mut transport,
    ))? {
        Ok(prepared) => prepared,
        Err(ed25519_yao::ml_dsa_runtime::RuntimeError::SessionBinding) => {
            fs::write(
                &args[3],
                serde_json::to_vec(
                    &json!({"status": "layout-rejected", "transport": transport.finish()}),
                )?,
            )?;
            return Ok(true);
        }
        Err(error) => return Err(error.into()),
    };
    run_ready(barrier(role, &mut transport))??;
    let offline_ns = started.elapsed().as_nanos();
    let mut inputs = Vec::new();
    for case in cases {
        let bytes = Zeroizing::new(hex::decode(
            case["input_hex"].as_str().ok_or("Missing input")?,
        )?);
        let mut bits = Zeroizing::new(garbled_execution::bytes_to_bits(&bytes));
        bits.truncate(case["input_bits"].as_u64().ok_or("Missing input count")? as usize);
        inputs.push(bits);
    }
    let started = Instant::now();
    let output = run_ready(prepared.run(&inputs, &[0x43; 32], &mut transport))??;
    let online_ns = started.elapsed().as_nanos();
    for (output, case) in output.outputs.iter().zip(cases) {
        require(
            hex::encode(output.as_slice()) == case["expected_hex"],
            "Prepared GMW differs from independent fixture oracle",
        )?;
    }
    fs::write(
        &args[3],
        serde_json::to_vec_pretty(&json!({"matched": true, "outputs": output.outputs.len(),
        "offline_ns": offline_ns, "online_ns": online_ns, "batch": metrics(&output.metrics), "transport": transport.finish()}))?,
    )?;
    Ok(true)
}

async fn barrier(
    role: SigningRole,
    transport: &mut impl Transport,
) -> Result<(), ed25519_yao::ml_dsa_runtime::RuntimeError> {
    match role {
        SigningRole::A => {
            transport.send(&[1]).await?;
            transport.receive(1).await?;
        }
        SigningRole::B => {
            transport.receive(1).await?;
            transport.send(&[1]).await?;
        }
    }
    Ok(())
}

pub(super) fn metrics(metrics: &BatchMetrics) -> Value {
    let phases: Vec<_> = metrics
        .phases
        .iter()
        .map(|phase| json!({"sent_bytes": phase.sent, "received_bytes": phase.received}))
        .collect();
    json!({"phases": phases, "instances": metrics.instances, "and_gates": metrics.and_gates,
        "and_exchanges": metrics.and_exchanges, "topology_allocation_bytes": metrics.topology_allocation_bytes,
        "private_state_allocation_bytes": metrics.private_state_allocation_bytes})
}

fn word(bits: &mut Vec<bool>, value: u32, width: usize) {
    for bit in 0..width {
        bits.push(value >> bit & 1 == 1);
    }
}
fn record(name: &str, input: &[bool], expected: &[u8]) -> Value {
    json!({"name": name, "input_hex": hex::encode(garbled_execution::pack_bits(input)), "input_bits": input.len(), "expected_hex": hex::encode(expected)})
}
fn append_hash(index: usize, a: &mut Vec<Value>, b: &mut Vec<Value>) {
    let high: Vec<u8> = (0..768).map(|offset| (offset + index * 23) as u8).collect();
    let mask: Vec<u8> = (0..768).map(|offset| (offset * 17 + index) as u8).collect();
    let peer: Vec<u8> = high
        .iter()
        .zip(&mask)
        .map(|(left, right)| left ^ right)
        .collect();
    let mu = [index as u8; 64];
    let mut message = mu.to_vec();
    message.extend_from_slice(&high);
    let expected = circuit_evidence::reference_shake256(&message, 48);
    let mut input = garbled_execution::bytes_to_bits(&mask);
    input.extend(garbled_execution::bytes_to_bits(&mu));
    a.push(record("commitment-hash", &input, &expected));
    b.push(record(
        "commitment-hash",
        &garbled_execution::bytes_to_bits(&peer),
        &expected,
    ));
}
fn append_norm(name: &str, bound: u32, index: usize, a: &mut Vec<Value>, b: &mut Vec<Value>) {
    let targets = [
        0,
        bound - 1,
        bound,
        bound + 1,
        Q - bound,
        Q - bound + 1,
        Q - 1,
    ];
    let target = targets[index % targets.len()];
    let mut left = Vec::new();
    let mut right = Vec::new();
    for coefficient in 0..256 {
        let full = if coefficient == 193 { target } else { 0 };
        let mask = (coefficient as u32 * 7919 + index as u32 * 539) % Q;
        word(&mut left, mask, 23);
        word(&mut right, (full + Q - mask) % Q, 23);
    }
    let validity_mask = index % 3 == 0;
    left.push(validity_mask);
    let valid = target < bound || target > Q - bound;
    a.push(record(name, &left, &[]));
    b.push(record(name, &right, &[u8::from(valid ^ validity_mask)]));
}
fn append_decision(index: usize, a: &mut Vec<Value>, b: &mut Vec<Value>) {
    let mut left = vec![false; 1664];
    let mut right = vec![false; 1664];
    let valid = index % 3 == 0;
    for bit in 0..11 {
        left[bit] = (bit + index) % 2 == 0;
        right[bit] = (valid || bit != index % 11) ^ left[bit];
    }
    let expected = [u8::from(valid)];
    a.push(record("bounds-decision", &left, &expected));
    b.push(record("bounds-decision", &right, &expected));
}

pub(super) fn run(output: &Path) -> InvestigationResult<()> {
    let directory = tempfile::tempdir()?;
    let schedules = prepared_signing_evidence::compile_schedules(directory.path())?;
    let mut a = Vec::new();
    let mut b = Vec::new();
    // Deliberately cross a 32-bit lane boundary with mixed input/output shapes.
    for index in 0..2 {
        append_hash(index, &mut a, &mut b);
    }
    for index in 0..33 {
        append_norm("response-check", (1 << 19) - 196, index, &mut a, &mut b);
    }
    for index in 0..35 {
        append_norm(
            "low-response-check",
            (Q - 1) / 32 - 196,
            index,
            &mut a,
            &mut b,
        );
    }
    for index in 0..35 {
        append_decision(index, &mut a, &mut b);
    }
    let a_path = directory.path().join("a.json");
    let b_path = directory.path().join("b.json");
    fs::write(&a_path, serde_json::to_vec(&a)?)?;
    fs::write(&b_path, serde_json::to_vec(&b)?)?;
    let a_out = directory.path().join("a-result.json");
    let b_out = directory.path().join("b-result.json");
    private_execution::run_duplex_children(
        &[
            OsStr::new("prepared-gmw-role-a"),
            directory.path().as_os_str(),
            a_path.as_os_str(),
            a_out.as_os_str(),
        ],
        &[
            OsStr::new("prepared-gmw-role-b"),
            directory.path().as_os_str(),
            b_path.as_os_str(),
            b_out.as_os_str(),
        ],
    )?;
    let a: Value = serde_json::from_slice(&fs::read(a_out)?)?;
    let b: Value = serde_json::from_slice(&fs::read(b_out)?)?;
    require(
        a["matched"] == true && b["matched"] == true,
        "A prepared batch failed",
    )?;
    require(
        a["outputs"] == 105 && b["outputs"] == 105,
        "The mixed batch lost an output",
    )?;
    require(
        a["batch"]["and_exchanges"] == 168 && b["batch"]["and_exchanges"] == 168,
        "The batched depth changed",
    )?;
    for phase in 0..6 {
        require(
            a["batch"]["phases"][phase]["sent_bytes"]
                == b["batch"]["phases"][phase]["received_bytes"]
                && b["batch"]["phases"][phase]["sent_bytes"]
                    == a["batch"]["phases"][phase]["received_bytes"],
            "Batch phase traffic differs",
        )?;
    }
    let mut unequal: Vec<Value> = serde_json::from_slice(&fs::read(&b_path)?)?;
    unequal.pop().ok_or("Missing mismatch fixture")?;
    let unequal_path = directory.path().join("b-unequal.json");
    fs::write(&unequal_path, serde_json::to_vec(&unequal)?)?;
    let rejected_a = directory.path().join("a-rejected.json");
    let rejected_b = directory.path().join("b-rejected.json");
    private_execution::run_duplex_children(
        &[
            OsStr::new("prepared-gmw-role-a"),
            directory.path().as_os_str(),
            a_path.as_os_str(),
            rejected_a.as_os_str(),
        ],
        &[
            OsStr::new("prepared-gmw-role-b"),
            directory.path().as_os_str(),
            unequal_path.as_os_str(),
            rejected_b.as_os_str(),
        ],
    )?;
    let mut mismatch = Vec::new();
    for path in [rejected_a, rejected_b] {
        let result: Value = serde_json::from_slice(&fs::read(path)?)?;
        require(
            result["status"] == "layout-rejected",
            "Mismatched batches were accepted",
        )?;
        require(
            result["transport"]["actual_pipe_sent_bytes"] == 32
                && result["transport"]["actual_pipe_received_bytes"] == 32,
            "Mismatched batches performed private preprocessing",
        )?;
        mismatch.push(result);
    }
    fs::write(
        output,
        serde_json::to_vec_pretty(
            &json!({"schema": "seams.ml-dsa-prepared-gmw-mixed.v1", "production_eligible": false,
        "scope": "Separate processes with genuine private OT. Two hashes,33 response checks,35 low checks,and35 decisions match independent public synthetic oracles. This is an engine test,not a complete signer or hosted timing result.",
        "executable_sha256": digest(&fs::read(env::current_exe()?)?), "schedules": schedules, "a": a, "b": b, "mismatched_count_rejected_before_private_preprocessing": mismatch}),
        )?,
    )?;
    println!(
        "Wrote prepared GMW mixed-batch evidence to {}",
        output.display()
    );
    Ok(())
}
