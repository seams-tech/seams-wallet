//! Separated role-process adapters for public-fixture private compositions.
//!
//! The role processes use genuine OT. Their common parent is an authorized
//! public-fixture test recipient and may inspect B's shares for verification.
//! This adapter must never receive production wallet secrets.

use crate::{InvestigationResult, require};
use ed25519_yao::phase5_benchmark::ml_dsa_private::PrivateRoleMetrics;
use serde_json::{Value, json};
use std::{
    env,
    ffi::OsStr,
    process::{Command, Stdio},
};

/// Runs two role children with direct A-to-B and B-to-A pipes.
pub(super) fn run_duplex_children(
    arguments_a: &[&OsStr],
    arguments_b: &[&OsStr],
) -> InvestigationResult<()> {
    let executable = env::current_exe()?;
    let mut garbler = Command::new(&executable)
        .args(arguments_a)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let a_to_b = garbler
        .stdout
        .take()
        .ok_or("Missing A-to-B process pipe.")?;
    let b_to_a = garbler.stdin.take().ok_or("Missing B-to-A process pipe.")?;
    let evaluator = Command::new(&executable)
        .args(arguments_b)
        .stdin(Stdio::from(a_to_b))
        .stdout(Stdio::from(b_to_a))
        .stderr(Stdio::piped())
        .spawn();
    let evaluator = match evaluator {
        Ok(child) => child,
        Err(error) => {
            garbler.kill()?;
            garbler.wait()?;
            return Err(error.into());
        }
    };
    let evaluator_result = evaluator.wait_with_output()?;
    let garbler_result = garbler.wait_with_output()?;
    require(
        evaluator_result.status.success(),
        &format!(
            "Private evaluator child failed: {}",
            String::from_utf8_lossy(&evaluator_result.stderr)
        ),
    )?;
    require(
        garbler_result.status.success(),
        &format!(
            "Private garbler child failed: {}",
            String::from_utf8_lossy(&garbler_result.stderr)
        ),
    )?;
    Ok(())
}

pub(super) fn encode_metrics(metrics: &PrivateRoleMetrics) -> Value {
    json!({
        "table_bytes": metrics.table_bytes,
        "frame_count": metrics.frame_count,
        "garbler_to_evaluator_wire_bytes": metrics.garbler_to_evaluator_wire_bytes,
        "evaluator_to_garbler_wire_bytes": metrics.evaluator_to_garbler_wire_bytes,
        "ot_wire_bytes": metrics.ot_wire_bytes,
        "direct_label_bytes": metrics.direct_label_bytes,
        "output_translation_bytes": metrics.output_translation_bytes,
        "public_return_bytes": metrics.public_return_bytes,
        "label_arena_allocation_bytes": metrics.label_arena_allocation_bytes,
        "table_buffer_allocation_bytes": metrics.table_buffer_allocation_bytes,
        "largest_control_buffer_bytes": metrics.largest_control_buffer_bytes,
        "schedule_bytes": metrics.schedule_bytes,
        "setup_wall_ns": metrics.setup_wall_ns,
        "gate_compute_wall_ns": metrics.gate_compute_wall_ns,
        "table_io_wall_ns": metrics.table_io_wall_ns,
        "role_wall_ns": metrics.role_wall_ns,
        "execution_binding_sha256": hex::encode(metrics.execution_binding_sha256),
    })
}
