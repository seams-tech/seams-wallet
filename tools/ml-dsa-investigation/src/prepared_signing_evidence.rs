//! Separate-process prepared signing on material from canonical wallet keygen.

use crate::{
    InvestigationResult, boolean_engine_evidence::run_ready, digest, material_storage_evidence,
    prepared_keygen_evidence::HostTransport, private_execution, private_signing, reference,
    require,
};
use ed25519_yao::{
    ml_dsa_runtime::{
        TrustedMlDsaSchedule,
        prepared::{Phase, Transport},
    },
    ml_dsa_signing::{
        OwnSigningShare, SigningRole,
        prepared_signing::{self, Reservation},
    },
};
use ed25519_yao_generator::{
    MlDsaSigningWorkloadV1 as Workload, compile_ml_dsa_private_signing_circuit_v1,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{env, ffi::OsStr, fs, path::Path, time::Instant};

enum Prepared<'a> {
    HalfGates(prepared_signing::PreparedSigner<'a>),
    Gmw(prepared_signing::gmw::PreparedGmwSigner<'a>),
}

pub(super) fn compile_schedules(directory: &Path) -> InvestigationResult<Vec<Value>> {
    let mut identities = Vec::new();
    for (name, workload) in [
        ("fresh-mask", Workload::FreshMaskConversion),
        ("prepared-commitment", Workload::PreparedCommitment),
        ("commitment-hash", Workload::CommitmentHash),
        ("response-check", Workload::ResponseCheck),
        ("low-response-check", Workload::LowResponseCheck),
        ("bounds-decision", Workload::BoundsDecision),
    ] {
        let circuit = compile_ml_dsa_private_signing_circuit_v1(workload);
        let bytes = circuit.canonical_schedule_encoding();
        let schedule = TrustedMlDsaSchedule::parse(bytes, Sha256::digest(bytes).into())?;
        fs::write(directory.join(format!("{name}.bin")), bytes)?;
        identities.push(json!({"name": name, "schedule_sha256": digest(bytes), "and_gates": circuit.metrics().and_gate_count(),
            "a_input_bits": schedule.garbler_input_bits(), "b_input_bits": schedule.evaluator_input_bits(), "schedule_bytes": bytes.len()}));
    }
    Ok(identities)
}

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let args: Vec<_> = env::args().skip(1).collect();
    let role = match args.first().map(String::as_str) {
        Some("prepared-signing-role-a") => SigningRole::A,
        Some("prepared-signing-role-b") => SigningRole::B,
        _ => return Ok(false),
    };
    require(
        args.len() == 7,
        "Prepared signer needs schedules, own material, public key, operation, table directory, and result.",
    )?;
    let mut public_key: [u8; 1952] = fs::read(&args[3])?
        .try_into()
        .map_err(|_| "Invalid public key size")?;
    let material = material_storage_evidence::open(Path::new(&args[2]), role, &public_key)?;
    let own = OwnSigningShare::parse(&material)?;
    drop(material);
    let bytes = prepared_signing::SCHEDULES
        .iter()
        .map(|(name, _)| fs::read(Path::new(&args[1]).join(format!("{name}.bin"))))
        .collect::<Result<Vec<_>, _>>()?;
    let schedules = bytes
        .iter()
        .map(|bytes| TrustedMlDsaSchedule::parse(bytes, Sha256::digest(bytes).into()))
        .collect::<Result<Vec<_>, _>>()?;
    let operation: Value = serde_json::from_slice(&fs::read(&args[4])?)?;
    let reservation: [u8; 32] = hex::decode(
        operation["reservation"]
            .as_str()
            .ok_or("Missing reservation")?,
    )?
    .try_into()
    .map_err(|_| "Invalid reservation")?;
    let operation_id: [u8; 32] =
        hex::decode(operation["operation"].as_str().ok_or("Missing operation")?)?
            .try_into()
            .map_err(|_| "Invalid operation")?;
    let message = hex::decode(operation["message"].as_str().ok_or("Missing message")?)?;
    let context = hex::decode(operation["context"].as_str().ok_or("Missing context")?)?;
    let capacity = u16::try_from(operation["capacity"].as_u64().ok_or("Missing capacity")?)?;
    let scenario = operation["scenario"].as_str().ok_or("Missing scenario")?;
    require(
        ["sign", "key-mismatch", "epoch-mismatch", "lifecycle"].contains(&scenario),
        "Unknown scenario",
    )?;
    let mut transport = HostTransport::new(Path::new(&args[5]).to_owned(), 0);
    if operation["engine"] == "pool" {
        let report = crate::pool_evidence::run(
            role,
            own,
            &public_key,
            &schedules,
            reservation,
            &mut transport,
        )?;
        fs::write(&args[6], serde_json::to_vec_pretty(&report)?)?;
        return Ok(true);
    }
    let started = Instant::now();
    let reservation = Reservation {
        id: reservation,
        epoch: [1; 32],
        candidates: capacity,
    };
    let mut activation_ns = 0;
    let mut preparation_traffic = json!(null);
    let prepared = match operation["engine"].as_str() {
        Some("half-gates") => Prepared::HalfGates(run_ready(prepared_signing::prepare_signer(
            role,
            own,
            &public_key,
            reservation,
            &schedules,
            &mut transport,
        ))??),
        Some("gmw") => {
            let generic = run_ready(prepared_signing::gmw::prepare_gmw_reservation(
                role,
                reservation.id,
                capacity,
                &schedules,
                &mut Default::default(),
                &mut transport,
            ))??;
            run_ready(ready(role, &mut transport))??;
            preparation_traffic = transport.counts[0].json();
            let activation_started = Instant::now();
            let mut epoch = reservation.epoch;
            if role == SigningRole::B {
                match scenario {
                    "key-mismatch" => public_key[0] ^= 1,
                    "epoch-mismatch" => epoch[0] ^= 1,
                    _ => {}
                }
            }
            let activated = run_ready(generic.activate(own, &public_key, epoch, &mut transport))?;
            activation_ns = activation_started.elapsed().as_nanos();
            if scenario != "sign" {
                require(
                    matches!(
                        activated,
                        Err(ed25519_yao::ml_dsa_signing::SigningError::RequestBinding)
                    ),
                    "Activation accepted mismatched key or epoch",
                )?;
                let after = transport.counts[0].json();
                for field in ["sent_bytes", "received_bytes"] {
                    require(
                        after[field].as_u64().ok_or("Missing traffic")?
                            - preparation_traffic[field]
                                .as_u64()
                                .ok_or("Missing traffic")?
                            == 64,
                        "Rejected activation continued beyond public binding",
                    )?;
                }
                fs::write(
                    &args[6],
                    serde_json::to_vec_pretty(&json!({
                        "result": {"status": "binding-rejected", "attempts": 0},
                        "offline_ns": started.elapsed().as_nanos(), "online_ns": 0,
                        "activation_ns": activation_ns, "preparation_traffic": preparation_traffic,
                        "offline": after, "online": transport.counts[1].json(),
                    }))?,
                )?;
                return Ok(true);
            }
            Prepared::Gmw(activated?)
        }
        _ => return Err("Unknown prepared signer engine".into()),
    };
    // Both roles finish preparation before either starts online accounting.
    run_ready(ready(role, &mut transport))??;
    let offline_ns = started.elapsed().as_nanos();
    transport.phase(Phase::Online);
    let started = Instant::now();
    let result = match prepared {
        Prepared::HalfGates(prepared) => {
            let output =
                run_ready(prepared.sign(&message, &context, &operation_id, &mut transport))?;
            match output {
                Ok(output) => {
                    reference::verify_signature_rustcrypto(
                        &public_key,
                        &message,
                        &context,
                        &output.signature,
                    )?;
                    let circuits: Vec<_> = output.circuits.iter().map(|(id, metrics)| json!({"id": id, "metrics": private_execution::encode_runtime_metrics(metrics)})).collect();
                    Ok(
                        json!({"status": "signed", "signature_hex": hex::encode(output.signature), "attempts": output.attempts, "public_rejections": output.public_rejections, "circuits": circuits}),
                    )
                }
                Err(error) => Err(error),
            }
        }
        Prepared::Gmw(prepared) => {
            let output =
                run_ready(prepared.sign(&message, &context, &operation_id, &mut transport))?;
            match output {
                Ok(prepared_signing::gmw::GmwBatchResult::Signed(output)) => {
                    reference::verify_signature_rustcrypto(
                        &public_key,
                        &message,
                        &context,
                        &output.signature,
                    )?;
                    let batches: Vec<_> = output
                        .batches
                        .iter()
                        .map(crate::prepared_gmw_evidence::metrics)
                        .collect();
                    Ok(
                        json!({"status": "signed", "signature_hex": hex::encode(output.signature), "attempts": output.accepted_candidate,
                        "evaluated_candidates": output.evaluated_candidates, "public_rejections": output.public_rejections, "batches": batches, "preparation_batches": output.preparation_batches.iter().map(crate::prepared_gmw_evidence::metrics).collect::<Vec<_>>()}),
                    )
                }
                Ok(prepared_signing::gmw::GmwBatchResult::Exhausted(_)) => {
                    Err(ed25519_yao::ml_dsa_signing::SigningError::PreparedPoolExhausted)
                }
                Err(error) => Err(error),
            }
        }
    };
    let online_ns = started.elapsed().as_nanos();
    let result = match result {
        Ok(result) => result,
        Err(ed25519_yao::ml_dsa_signing::SigningError::PreparedPoolExhausted) => {
            json!({"status": "exhausted", "attempts": capacity})
        }
        Err(error) => return Err(error.into()),
    };
    fs::write(
        &args[6],
        serde_json::to_vec_pretty(
            &json!({"result": result, "offline_ns": offline_ns, "activation_ns": activation_ns, "preparation_traffic": preparation_traffic, "online_ns": online_ns,
        "offline": transport.counts[0].json(), "online": transport.counts[1].json()}),
        )?,
    )?;
    Ok(true)
}

async fn ready(
    role: SigningRole,
    transport: &mut HostTransport,
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

pub(super) fn run_operation(
    schedules: &Path,
    a_material: &Path,
    b_material: &Path,
    public_key: &Path,
) -> InvestigationResult<Value> {
    let directory = tempfile::tempdir()?;
    let public = fs::read(public_key)?;
    let mut cases = Vec::new();
    for (ordinal, (engine, capacity, scenario)) in [
        ("half-gates", 1u16, "sign"),
        ("half-gates", 24, "sign"),
        ("gmw", 4, "sign"),
        ("gmw", 8, "sign"),
        ("gmw", 1, "key-mismatch"),
        ("gmw", 1, "epoch-mismatch"),
        ("pool", 4, "lifecycle"),
    ]
    .into_iter()
    .enumerate()
    {
        let a_dir = directory.path().join(format!("a-{ordinal}"));
        let b_dir = directory.path().join(format!("b-{ordinal}"));
        fs::create_dir(&a_dir)?;
        fs::create_dir(&b_dir)?;
        let operation = directory.path().join(format!("operation-{ordinal}.json"));
        let a_result = a_dir.join("result.json");
        let b_result = b_dir.join("result.json");
        let message = reference::public_message();
        let context = format!("prepared-wallet-case-{ordinal}").into_bytes();
        fs::write(
            &operation,
            serde_json::to_vec(
                &json!({"reservation": hex::encode(private_signing::fresh_operation_id()?), "operation": hex::encode(private_signing::fresh_operation_id()?),
            "message": hex::encode(message), "context": hex::encode(&context), "capacity": capacity, "engine": engine, "scenario": scenario}),
            )?,
        )?;
        private_execution::run_duplex_children(
            &[
                OsStr::new("prepared-signing-role-a"),
                schedules.as_os_str(),
                a_material.as_os_str(),
                public_key.as_os_str(),
                operation.as_os_str(),
                a_dir.as_os_str(),
                a_result.as_os_str(),
            ],
            &[
                OsStr::new("prepared-signing-role-b"),
                schedules.as_os_str(),
                b_material.as_os_str(),
                public_key.as_os_str(),
                operation.as_os_str(),
                b_dir.as_os_str(),
                b_result.as_os_str(),
            ],
        )?;
        let a: Value = serde_json::from_slice(&fs::read(&a_result)?)?;
        let b: Value = serde_json::from_slice(&fs::read(&b_result)?)?;
        for field in [
            "status",
            "signature_hex",
            "attempts",
            "evaluated_candidates",
            "public_rejections",
            "circuits",
        ] {
            require(
                a["result"][field] == b["result"][field],
                "Prepared signers disagree",
            )?;
        }
        if engine == "gmw" && a["result"]["status"] == "signed" {
            require(
                a["result"]["evaluated_candidates"] == capacity,
                "GMW batch omitted candidates",
            )?;
            let mut layers = 0;
            for batch in 0..3 {
                layers += a["result"]["batches"][batch]["and_exchanges"]
                    .as_u64()
                    .ok_or("Missing GMW depth")?;
                for phase in 0..6 {
                    let left = &a["result"]["batches"][batch]["phases"][phase];
                    let right = &b["result"]["batches"][batch]["phases"][phase];
                    require(
                        left["sent_bytes"] == right["received_bytes"]
                            && right["sent_bytes"] == left["received_bytes"],
                        "GMW signing phase traffic differs",
                    )?;
                }
            }
            require(
                layers == 227,
                "GMW signing has an unexpected dependent layer count",
            )?;
        }
        for phase in ["offline", "online"] {
            require(
                a[phase]["sent_bytes"] == b[phase]["received_bytes"]
                    && b[phase]["sent_bytes"] == a[phase]["received_bytes"],
                "Prepared signer traffic differs",
            )?;
        }
        let verification = if engine == "pool" {
            crate::pool_evidence::verify(&public, &a, &b)?
        } else if a["result"]["status"] == "signed" {
            let signature = hex::decode(
                a["result"]["signature_hex"]
                    .as_str()
                    .ok_or("Missing signature")?,
            )?;
            reference::verify_threshold_signature(&public, &message, &context, &signature)?
        } else if scenario != "sign" {
            require(
                a["result"]["status"] == "binding-rejected",
                "Activation mismatch was not rejected",
            )?;
            json!({"activation_binding_rejected_before_commitment": true})
        } else {
            require(
                a["result"]["status"] == "exhausted",
                "Unexpected signing outcome",
            )?;
            json!({"pool_exhausted_without_signature": true})
        };
        if engine == "pool" {
            eprintln!("Pool lifecycle completed: {}", verification);
        } else {
            eprintln!(
                "Prepared signing case {ordinal}: {}, {} attempts, {} ms online",
                a["result"]["status"],
                a["result"]["attempts"],
                b["online_ns"].as_u64().ok_or("Missing online time")? / 1_000_000
            );
        }

        cases.push(json!({"engine": engine, "capacity": capacity, "scenario": scenario, "a": a, "b": b, "verification": verification}));
        fs::remove_dir_all(a_dir)?;
        fs::remove_dir_all(b_dir)?;
    }
    require(
        cases
            .iter()
            .any(|case| case["a"]["result"]["status"] == "signed"),
        "No prepared signature completed",
    )?;
    Ok(
        json!({"scope": "Native separate-process signing from a wallet-derived canonical key before test recovery. Direct uniform nonce sampling; no exact FIPS hedged nonce procedure claim.", "cases": cases}),
    )
}
