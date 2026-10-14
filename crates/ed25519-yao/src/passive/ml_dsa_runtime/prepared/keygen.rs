//! One reserved wallet-derived key-generation preparation, consumed as a unit.

use super::{prepare, PreparedCircuit, Transport};
use crate::passive::{
    ml_dsa_runtime::{RuntimeError, RuntimeMetrics, TrustedMlDsaSchedule},
    ml_dsa_signing::{
        keygen::{KeygenError, KeygenOutput, KeygenStep},
        wallet_seed::prepare_wallet_keygen,
        SigningRole,
    },
};

/// In-memory reservation for all nineteen circuits. It cannot be cloned.
pub struct PreparedKeygen<'a> {
    role: SigningRole,
    circuits: Vec<PreparedCircuit<'a>>,
}

/// Prepares wallet-seed, seed expansion, eleven samplers, and six roundings.
/// Inputs contain public schedules only. Both sides use the same ordered list.
pub async fn prepare_keygen<'a>(
    role: SigningRole,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    transport: &mut impl Transport,
) -> Result<PreparedKeygen<'a>, RuntimeError> {
    let mut circuits = Vec::with_capacity(19);
    for (id, count) in [(0x91, 1), (0x87, 1), (0x88, 11), (0x89, 6)] {
        let schedule = schedules
            .iter()
            .find(|schedule| schedule.circuit_id() == id)
            .ok_or(RuntimeError::ScheduleShape)?;
        for _ in 0..count {
            circuits.push(prepare(role, schedule, transport).await?);
        }
    }
    Ok(PreparedKeygen { role, circuits })
}

impl PreparedKeygen<'_> {
    /// Starts online work only after the caller reserves the complete preparation.
    /// Preserves the ordinary canonical keygen transitions and output ownership.
    pub async fn run(
        self,
        own_root_share: &[u8; 32],
        transport: &mut impl Transport,
    ) -> Result<(Box<KeygenOutput>, RuntimeMetrics), KeygenError> {
        let mut circuits = self.circuits.into_iter();
        let wallet = circuits.next().ok_or(KeygenError::Schedule)?;
        let request = prepare_wallet_keygen(self.role, own_root_share)?;
        let (mut step, wallet_metrics) = request.run_prepared(wallet, transport).await?;
        loop {
            step = match step {
                KeygenStep::Circuit(request) => {
                    let prepared = circuits.next().ok_or(KeygenError::Schedule)?;
                    request.run_prepared(prepared, transport).await?
                }
                KeygenStep::Complete(key) => {
                    if circuits.next().is_some() {
                        return Err(KeygenError::Schedule);
                    }
                    return Ok((key, wallet_metrics));
                }
            };
        }
    }
}
