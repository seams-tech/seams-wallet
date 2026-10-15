//! Consuming persistence boundary for fresh, key-independent reservations.
use super::*;
use crate::passive::ml_dsa_runtime::boolean_comparison::prepared::storage::{number, Reader};
const MAGIC: &[u8; 8] = b"MDGMW001";

impl<'a> PreparedGmwReservation<'a> {
    /// Moves private preparation into a wiping buffer for role-private sealing.
    /// Persist only encrypted bytes. The live preparation handle is destroyed.
    pub fn into_storage(self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(self.private_bytes() + 32768));
        bytes.extend_from_slice(MAGIC);
        bytes.push(match self.role {
            SigningRole::A => 0,
            SigningRole::B => 1,
        });
        bytes.extend_from_slice(&self.id);
        number(&mut bytes, self.values.len());
        for value in &self.values {
            for poly in &value.y[..COLUMNS] {
                for coefficient in poly {
                    bytes.extend_from_slice(&coefficient.to_le_bytes());
                }
            }
        }
        self.masks.store(&mut bytes);
        for batch in [
            &self.commitments,
            &self.hashes,
            &self.bounds,
            &self.decisions,
        ] {
            batch.store(&mut bytes);
        }
        bytes
    }

    /// Restores a role-local reservation only after its durable record was consumed.
    /// Expected identity and schedules come from trusted admission, never the blob.
    /// This parser does not establish storage freshness or authorize reuse.
    pub fn from_consumed_storage(
        role: SigningRole,
        id: [u8; 32],
        candidates: u16,
        schedules: &'a [TrustedMlDsaSchedule<'a>],
        topologies: &mut PublicTopologies,
        bytes: Zeroizing<Vec<u8>>,
    ) -> Result<Self> {
        if candidates == 0 || candidates > 32 || bytes.len() > 16 * 1024 * 1024 {
            return Err(SigningError::CircuitOutput);
        }
        Self::decode(role, id, candidates, schedules, topologies, &bytes).map_err(runtime_error)
    }
    fn decode(
        role: SigningRole,
        id: [u8; 32],
        candidates: u16,
        schedules: &'a [TrustedMlDsaSchedule<'a>],
        topologies: &mut PublicTopologies,
        bytes: &[u8],
    ) -> core::result::Result<Self, crate::passive::ml_dsa_runtime::RuntimeError> {
        use crate::passive::ml_dsa_runtime::RuntimeError;
        let count = usize::from(candidates);
        let mut reader = Reader::new(bytes);
        let role_byte = match role {
            SigningRole::A => 0,
            SigningRole::B => 1,
        };
        if reader.take(8)? != MAGIC
            || reader.take(1)? != [role_byte]
            || reader.take(32)? != id
            || reader.number()? != count
        {
            return Err(RuntimeError::SessionBinding);
        }
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            let mut value = Zeroizing::new(Candidate::empty());
            for poly in &mut value.y[..COLUMNS] {
                for coefficient in poly {
                    *coefficient = u32::from_le_bytes(
                        reader
                            .take(4)?
                            .try_into()
                            .map_err(|_| RuntimeError::InputLength)?,
                    );
                    if *coefficient >= Q {
                        return Err(RuntimeError::InputLength);
                    }
                }
            }
            values.push(value);
        }
        let masks = BatchMetrics::restore(&mut reader)?;
        let lookup = |kind| schedule(schedules, kind).map_err(|_| RuntimeError::ScheduleShape);
        let commitments = PreparedGmwBatch::restore(
            role,
            &vec![lookup(0x96)?; count * ROWS],
            topologies,
            &mut reader,
        )?;
        let hashes =
            PreparedGmwBatch::restore(role, &vec![lookup(0x8d)?; count], topologies, &mut reader)?;
        let bound_layout =
            bound_schedules(count, schedules).map_err(|_| RuntimeError::ScheduleShape)?;
        let bounds = PreparedGmwBatch::restore(role, &bound_layout, topologies, &mut reader)?;
        let decisions =
            PreparedGmwBatch::restore(role, &vec![lookup(0x98)?; count], topologies, &mut reader)?;
        reader.finish()?;
        Ok(Self {
            role,
            id,
            values,
            commitments,
            hashes,
            bounds,
            decisions,
            masks,
        })
    }
}
