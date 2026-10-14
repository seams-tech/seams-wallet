//! Reject mismatched stored-key bindings and public requests before private circuits.

use crate::{InvestigationResult, private_execution, private_signing, require};
use private_signing::{Operation, Randomness};
use serde_json::{Value, json};
use std::{ffi::OsStr, fs, path::Path};

pub(super) fn run(
    schedules: &Path,
    own_a: &Path,
    own_b: &Path,
    public_key: &Path,
) -> InvestigationResult<Value> {
    let operation = Operation {
        operation_id: private_signing::fresh_operation_id()?,
        engine: crate::complete_engine_evidence::Engine::HalfGates,
        message: [0x42; 32],
        context: b"seams/ml-dsa/request-binding/v1".to_vec(),
        randomness: Randomness::JointRandom,
    };
    let mut results = Vec::new();
    for field in [
        "operation-id",
        "public-key",
        "message",
        "context",
        "randomness-mode",
    ] {
        let directory = tempfile::tempdir()?;
        let request_a = directory.path().join("request-a.json");
        let request_b = directory.path().join("request-b.json");
        let public_b = directory.path().join("public-key-b.bin");
        let result_a = directory.path().join("result-a.json");
        let result_b = directory.path().join("result-b.json");
        let mut changed = operation.clone();
        let mut public_bytes = fs::read(public_key)?;
        match field {
            "operation-id" => changed.operation_id[0] ^= 1,
            "public-key" => public_bytes[32] ^= 1,
            "message" => changed.message[0] ^= 1,
            "context" => changed.context[0] ^= 1,
            "randomness-mode" => changed.randomness = Randomness::Deterministic,
            _ => unreachable!("fixed mismatch scenarios"),
        }
        fs::write(&request_a, serde_json::to_vec(&operation)?)?;
        fs::write(&request_b, serde_json::to_vec(&changed)?)?;
        fs::write(&public_b, public_bytes)?;
        let error = private_execution::run_duplex_children(
            &[
                OsStr::new("private-signing-role-a"),
                schedules.as_os_str(),
                own_a.as_os_str(),
                public_key.as_os_str(),
                request_a.as_os_str(),
                result_a.as_os_str(),
            ],
            &[
                OsStr::new("private-signing-role-b"),
                schedules.as_os_str(),
                own_b.as_os_str(),
                public_b.as_os_str(),
                request_b.as_os_str(),
                result_b.as_os_str(),
            ],
        )
        .err()
        .ok_or("Mismatched signing requests produced a complete operation.")?;
        let failure: Value =
            serde_json::from_slice(&fs::read(result_b.with_extension("failure.json"))?)?;
        let (expected_error, expected_received_bytes) = match field {
            "public-key" => ("MaterialOpen", 0),
            "operation-id" | "message" | "context" | "randomness-mode" => ("RequestBinding", 73),
            _ => unreachable!("fixed mismatch scenarios"),
        };
        require(
            failure["error"] == expected_error
                && failure["completed_private_circuits"] == 0
                && failure["non_circuit_sent_bytes"] == 0
                && failure["non_circuit_received_bytes"] == expected_received_bytes
                && !result_a.exists()
                && !result_b.exists(),
            "A request mismatch did not fail at its storage or public binding boundary.",
        )?;
        results.push(json!({
            "different_field": field,
            "role_b_failure": failure,
            "neither_role_produced_a_signature": true,
            "peer_error": error.to_string(),
        }));
    }
    Ok(json!({
        "scope": "Separate role processes reject a mismatched public key at encrypted material opening and reject the remaining mismatched request fields at the peer exchange. All fail before private circuits. This establishes stored-key binding and peer agreement, with no production admission or durable replay claim.",
        "cases": results,
    }))
}
