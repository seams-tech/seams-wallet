//! One reserved wallet-derived key generation, including all fallback branches.

use super::{prepare, PreparedCircuit, Transport};
use crate::passive::{
    ml_dsa_runtime::{RuntimeError, RuntimeMetrics, TrustedMlDsaSchedule},
    ml_dsa_signing::{
        keygen::{KeygenError, KeygenOutput, KeygenStep},
        wallet_seed::prepare_wallet_keygen,
        SigningRole,
    },
};

/// In-memory reservation. Every branch is consumed or discarded with this handle.
pub struct PreparedKeygen<'a> {
    role: SigningRole,
    circuits: Vec<(usize, PreparedCircuit<'a>)>,
}

/// Prepares wallet derivation, seed expansion, and three prefixes per polynomial.
/// Both roles reserve every possible continuation before online admission.
pub async fn prepare_keygen<'a>(
    role: SigningRole,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    transport: &mut impl Transport,
) -> Result<PreparedKeygen<'a>, RuntimeError> {
    let mut circuits = Vec::with_capacity(35);
    for (id, count) in [(0x91, 1), (0x87, 1), (0x93, 11), (0x94, 11), (0x95, 11)] {
        let schedule = schedules
            .iter()
            .find(|schedule| schedule.circuit_id() == id)
            .ok_or(RuntimeError::ScheduleShape)?;
        for ordinal in 0..count {
            circuits.push((ordinal, prepare(role, schedule, transport).await?));
        }
    }
    Ok(PreparedKeygen { role, circuits })
}

impl PreparedKeygen<'_> {
    /// Executes only the prefixes selected by public acceptance decisions.
    /// Unused preparation is discarded; no branch can be reused for another key.
    pub async fn run(
        mut self,
        own_root_share: &[u8; 32],
        transport: &mut impl Transport,
    ) -> Result<(Box<KeygenOutput>, RuntimeMetrics), KeygenError> {
        let (_, wallet) = self.circuits.remove(0);
        let request = prepare_wallet_keygen(self.role, own_root_share)?;
        let (mut step, wallet_metrics) = request.run_prepared(wallet, transport).await?;
        loop {
            step = match step {
                KeygenStep::Circuit(request) => {
                    let position = self
                        .circuits
                        .iter()
                        .position(|(ordinal, circuit)| {
                            *ordinal == request.ordinal()
                                && circuit.circuit_id() == request.kernel().circuit_id()
                        })
                        .ok_or(KeygenError::Schedule)?;
                    let (_, prepared) = self.circuits.remove(position);
                    request.run_prepared(prepared, transport).await?
                }
                KeygenStep::OpenPublicT(opening) => {
                    let own = opening.own_message();
                    let peer = match self.role {
                        SigningRole::A => {
                            transport
                                .send(&own)
                                .await
                                .map_err(|_| KeygenError::CircuitRuntime)?;
                            transport
                                .receive(own.len())
                                .await
                                .map_err(|_| KeygenError::CircuitRuntime)?
                        }
                        SigningRole::B => {
                            let peer = transport
                                .receive(own.len())
                                .await
                                .map_err(|_| KeygenError::CircuitRuntime)?;
                            transport
                                .send(&own)
                                .await
                                .map_err(|_| KeygenError::CircuitRuntime)?;
                            peer
                        }
                    };
                    opening.accept(&peer)?
                }
                KeygenStep::Complete(key) => return Ok((key, wallet_metrics)),
            };
        }
    }
}
