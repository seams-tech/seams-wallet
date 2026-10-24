//! One reserved wallet-derived key generation, including all fallback branches.

use super::{prepare, PreparedCircuit, Transport};
use crate::{
    ml_dsa_runtime::{RuntimeError, RuntimeMetrics, TrustedMlDsaSchedule},
    ml_dsa_signing::{
        keygen::{KeygenError, KeygenOutput, KeygenStep},
        wallet_seed::prepare_wallet_keygen,
        SigningRole,
    },
};

const CIRCUIT_LAYOUT: [(u8, usize); 5] = [(0x91, 1), (0x87, 1), (0x93, 11), (0x94, 11), (0x95, 11)];

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
    for (id, count) in CIRCUIT_LAYOUT {
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

impl<'a> PreparedKeygen<'a> {
    /// Consumes the handle into a wiping buffer. Seal before durable storage.
    /// The adapter binds table frames to this reservation and keeps role stores separate.
    pub fn into_storage(self, reservation: [u8; 32]) -> zeroize::Zeroizing<Vec<u8>> {
        use crate::ml_dsa_runtime::boolean_comparison::prepared::storage::number;
        // Allocate once: growing a secret buffer would leave copies in freed allocations.
        let size = 8
            + 32
            + 1
            + 8
            + self
                .circuits
                .iter()
                .map(|(_, circuit)| 8 + circuit.storage_bytes())
                .sum::<usize>();
        let mut bytes = zeroize::Zeroizing::new(Vec::with_capacity(size));
        bytes.extend_from_slice(b"MDKEY001");
        bytes.extend_from_slice(&reservation);
        bytes.push(match self.role {
            SigningRole::A => 0,
            SigningRole::B => 1,
        });
        number(&mut bytes, self.circuits.len());
        for (ordinal, circuit) in &self.circuits {
            number(&mut bytes, *ordinal);
            circuit.store(&mut bytes);
        }
        bytes
    }

    /// Restore only after an atomic durable consume. This parser cannot enforce freshness.
    /// Expected role, reservation, and schedules must come from trusted admission.
    pub fn from_consumed_storage(
        role: SigningRole,
        reservation: [u8; 32],
        schedules: &'a [TrustedMlDsaSchedule<'a>],
        bytes: zeroize::Zeroizing<Vec<u8>>,
    ) -> Result<Self, RuntimeError> {
        use super::super::check;
        use crate::ml_dsa_runtime::boolean_comparison::prepared::storage::Reader;
        check(bytes.len() <= 16 * 1024 * 1024, RuntimeError::InputLength)?;
        let mut reader = Reader::new(&bytes);
        check(reader.take(8)? == b"MDKEY001", RuntimeError::SessionBinding)?;
        check(
            reader.take(32)? == reservation,
            RuntimeError::SessionBinding,
        )?;
        let role_byte = match role {
            SigningRole::A => 0,
            SigningRole::B => 1,
        };
        check(reader.take(1)? == [role_byte], RuntimeError::SessionBinding)?;
        check(reader.number()? == 35, RuntimeError::InputLength)?;
        let mut circuits = Vec::with_capacity(35);
        for (id, count) in CIRCUIT_LAYOUT {
            let schedule = schedules
                .iter()
                .find(|schedule| schedule.circuit_id() == id)
                .ok_or(RuntimeError::ScheduleShape)?;
            for ordinal in 0..count {
                check(reader.number()? == ordinal, RuntimeError::SessionBinding)?;
                circuits.push((
                    ordinal,
                    PreparedCircuit::restore(role, schedule, &mut reader)?,
                ));
            }
        }
        reader.finish()?;
        Ok(Self { role, circuits })
    }
}
