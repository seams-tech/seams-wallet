//! Core lifecycle scenarios using separate disposable-key role processes.

use crate::{InvestigationResult, digest, private_execution, private_signing, require};
use ed25519_yao::{
    ml_dsa_runtime::MessageKind,
    ml_dsa_signing::{SigningKernel, SigningRole},
};
use private_signing::{Operation, Randomness};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs,
    io::Write,
    path::{Path, PathBuf},
    thread,
};
use zeroize::Zeroizing;

#[derive(Clone, Copy)]
pub(super) enum RoleExecution {
    Complete(SigningRole),
    InterruptAfterMask,
    ReplayBaseChoices,
}

impl RoleExecution {
    pub(super) const fn role(self) -> SigningRole {
        match self {
            Self::Complete(role) => role,
            Self::InterruptAfterMask | Self::ReplayBaseChoices => SigningRole::A,
        }
    }

    pub(super) fn wire_fault(self, result: &Path) -> WireFault {
        match self {
            Self::ReplayBaseChoices => WireFault::AwaitMask {
                diagnostic: result.with_extension("fault.json"),
            },
            Self::Complete(_) | Self::InterruptAfterMask => WireFault::Direct,
        }
    }

    pub(super) fn after_kernel(
        self,
        kernel: SigningKernel,
        result: &Path,
    ) -> InvestigationResult<()> {
        if matches!(self, Self::InterruptAfterMask) && kernel == SigningKernel::ExpandMask {
            fs::write(
                result.with_extension("fault.json"),
                serde_json::to_vec(&json!({
                    "injected": "interrupt-after-first-private-mask",
                    "complete_mask_circuits": 1,
                    "signature_produced": false,
                }))?,
            )?;
            return Err("Injected interruption after the first private mask circuit.".into());
        }
        Ok(())
    }
}

pub(super) enum WireFault {
    Direct,
    AwaitMask {
        diagnostic: PathBuf,
    },
    Capture {
        diagnostic: PathBuf,
    },
    Armed {
        diagnostic: PathBuf,
        base_choices: Zeroizing<Vec<u8>>,
    },
    Replayed,
}

impl WireFault {
    pub(super) fn start_kernel(&mut self, kernel: SigningKernel) {
        if kernel == SigningKernel::ExpandMask && matches!(self, Self::AwaitMask { .. }) {
            let Self::AwaitMask { diagnostic } = std::mem::replace(self, Self::Direct) else {
                unreachable!("the preceding branch requires the waiting state")
            };
            *self = Self::Capture { diagnostic };
        }
    }

    pub(super) fn write_message(
        &mut self,
        kind: MessageKind,
        bytes: &[u8],
        writer: &mut impl Write,
    ) -> InvestigationResult<()> {
        if kind != MessageKind::BaseChoices {
            writer.write_all(bytes)?;
            return Ok(());
        }
        match std::mem::replace(self, Self::Direct) {
            Self::Capture { diagnostic } => {
                *self = Self::Armed {
                    diagnostic,
                    base_choices: Zeroizing::new(bytes.to_vec()),
                };
                writer.write_all(bytes)?;
            }
            Self::Armed {
                diagnostic,
                base_choices,
            } => {
                require(
                    base_choices.len() == bytes.len(),
                    "The replay must preserve the exact family message length.",
                )?;
                require(
                    base_choices[..16] == bytes[..16] && base_choices[16..48] != bytes[16..48],
                    "The replay must use the same family header and a different session.",
                )?;
                fs::write(
                    diagnostic,
                    serde_json::to_vec(&json!({
                        "injected": "replay-first-mask-base-choices-at-second-mask",
                        "old_message_bytes": base_choices.len(),
                        "same_family_and_length": true,
                        "old_session_sha256": digest(&base_choices[16..48]),
                        "new_session_sha256": digest(&bytes[16..48]),
                    }))?,
                )?;
                writer.write_all(&base_choices)?;
                *self = Self::Replayed;
            }
            state => {
                *self = state;
                writer.write_all(bytes)?;
            }
        }
        Ok(())
    }
}

pub(super) fn run(
    schedules: &Path,
    own_a: &Path,
    own_b: &Path,
    public_key: &Path,
) -> InvestigationResult<Value> {
    let request_binding =
        crate::request_binding_evidence::run(schedules, own_a, own_b, public_key)?;
    let mut faults = Vec::new();
    for (mode, expected_injection, expected_failure) in [
        (
            "private-signing-interrupt-role-a",
            "interrupt-after-first-private-mask",
            "failed to fill whole buffer",
        ),
        (
            "private-signing-replay-role-a",
            "replay-first-mask-base-choices-at-second-mask",
            "ObliviousTransfer",
        ),
    ] {
        faults.push(run_fault(
            schedules,
            own_a,
            own_b,
            public_key,
            mode,
            expected_injection,
            expected_failure,
        )?);
    }
    let restarted =
        private_signing::run_operation(schedules, own_a, own_b, public_key, operation(0)?)?;
    let concurrent = thread::scope(|scope| {
        let mut handles = Vec::new();
        for index in 1..=4 {
            let operation = operation(index)?;
            handles.push(scope.spawn(move || {
                private_signing::run_operation(schedules, own_a, own_b, public_key, operation)
                    .map_err(|error| error.to_string())
            }));
        }
        let mut reports = Vec::new();
        for handle in handles {
            reports.push(
                handle
                    .join()
                    .map_err(|_| "Concurrent signing task panicked.")??,
            );
        }
        Ok::<_, Box<dyn std::error::Error>>(reports)
    })?;
    let mut bindings = HashSet::new();
    for report in std::iter::once(&restarted).chain(&concurrent) {
        let circuits = report["role_a"]["circuits"]
            .as_array()
            .ok_or("Missing lifecycle circuit evidence.")?;
        for circuit in circuits {
            let binding = circuit["execution_binding_sha256"]
                .as_str()
                .ok_or("Missing lifecycle circuit binding.")?;
            require(
                bindings.insert(binding),
                "Signing operations reused a circuit binding.",
            )?;
        }
    }
    eprintln!(
        "Verified interruption, OT replay rejection, restart, and four concurrent threshold signatures."
    );
    Ok(json!({
        "scope": "Host core execution with separate processes and role-local files. No production admission, durable replay ledger, refresh, backup restore, or Cloudflare lifecycle claim.",
        "production_eligible": false,
        "faults": faults,
        "request_binding": request_binding,
        "restart_after_faults": restarted,
        "concurrency": 4,
        "concurrent_operations": concurrent,
        "fresh_bindings_across_restart_and_concurrent_operations": bindings.len(),
        "timing_use": "Correctness stress only. Do not mix these contended process timings into serial latency measurements."
    }))
}

fn operation(index: u8) -> InvestigationResult<Operation> {
    Ok(Operation {
        operation_id: private_signing::fresh_operation_id()?,
        engine: crate::complete_engine_evidence::Engine::HalfGates,
        message: Sha256::digest([b"seams/ml-dsa/core-lifecycle/v1/".as_slice(), &[index]].concat())
            .into(),
        context: b"seams/ml-dsa/core-lifecycle/v1".to_vec(),
        randomness: Randomness::JointRandom,
    })
}

fn run_fault(
    schedules: &Path,
    own_a: &Path,
    own_b: &Path,
    public_key: &Path,
    mode: &str,
    injection: &str,
    expected_failure: &str,
) -> InvestigationResult<Value> {
    let directory = tempfile::tempdir()?;
    let operation_path = directory.path().join("public-operation.json");
    fs::write(&operation_path, serde_json::to_vec(&operation(5)?)?)?;
    let result_a = directory.path().join("public-a.json");
    let result_b = directory.path().join("public-b.json");
    let error = private_execution::run_duplex_children(
        &[
            OsStr::new(mode),
            schedules.as_os_str(),
            own_a.as_os_str(),
            public_key.as_os_str(),
            operation_path.as_os_str(),
            result_a.as_os_str(),
        ],
        &[
            OsStr::new("private-signing-role-b"),
            schedules.as_os_str(),
            own_b.as_os_str(),
            public_key.as_os_str(),
            operation_path.as_os_str(),
            result_b.as_os_str(),
        ],
    )
    .err()
    .ok_or("Fault injection unexpectedly produced a complete signature.")?;
    let diagnostic: Value =
        serde_json::from_slice(&fs::read(result_a.with_extension("fault.json"))?)?;
    require(
        diagnostic["injected"] == injection,
        "The intended fault did not execute.",
    )?;
    require(
        error.to_string().contains(expected_failure),
        &format!("Unexpected peer failure for {mode}: {error}"),
    )?;
    require(
        !result_a.exists() && !result_b.exists(),
        "An interrupted role wrote a complete signature result.",
    )?;
    Ok(json!({
        "injection": diagnostic,
        "peer_failure": error.to_string(),
        "neither_role_produced_a_signature": true,
    }))
}
