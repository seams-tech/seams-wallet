//! Consuming persistence boundary for generic stock and key-specific commitments.
use super::*;
use crate::runtime::boolean_mpc::prepared::storage::{number, Reader};
use crate::runtime::RuntimeError;
const GENERIC_MAGIC: &[u8; 8] = b"MDGMW001";
const COMMITTED_MAGIC: &[u8; 8] = b"MDGMC001";

impl<'a> PreparedGmwReservation<'a> {
    /// Moves private preparation into a wiping buffer for role-private sealing.
    /// Persist only encrypted bytes. The live preparation handle is destroyed.
    pub fn into_storage(self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(self.private_bytes() + 32768));
        store_identity(
            &mut bytes,
            GENERIC_MAGIC,
            self.role,
            &self.id,
            self.values.len(),
        );
        for value in &self.values {
            store_polynomials(&mut bytes, &value.y[..COLUMNS]);
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
    ) -> core::result::Result<Self, crate::runtime::RuntimeError> {
        let count = usize::from(candidates);
        let mut reader = Reader::new(bytes);
        read_identity(&mut reader, GENERIC_MAGIC, role, &id, count)?;
        let values = read_nonce_shares(&mut reader, count)?;
        let masks = BatchMetrics::restore(&mut reader)?;
        let commitment = schedule(schedules, 0x96).map_err(|_| RuntimeError::ScheduleShape)?;
        let commitments = PreparedGmwBatch::restore(
            role,
            &vec![commitment; count * ROWS],
            topologies,
            &mut reader,
        )?;
        let (hashes, bounds, decisions) =
            read_online_batches(&mut reader, role, count, schedules, topologies)?;
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

impl<'a> CommittedGmwReservation<'a> {
    /// Restores key-bound signing material after irreversible durable consumption.
    /// Generic registration stock is rejected. Role, identity, and width come from admission.
    /// This parser validates the record and cannot establish storage freshness.
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
        if bytes.starts_with(GENERIC_MAGIC) {
            return Err(SigningError::PreparationState);
        }
        Self::decode(role, id, candidates, schedules, topologies, &bytes).map_err(runtime_error)
    }

    /// Destroys the live handle and emits role-private bytes for authenticated sealing.
    /// Commitment correlations are already consumed and are absent from this format.
    pub fn into_storage(self) -> Zeroizing<Vec<u8>> {
        let online_bytes = self.hashes.private_bytes()
            + self.bounds.private_bytes()
            + self.decisions.private_bytes();
        let mut bytes =
            Zeroizing::new(Vec::with_capacity(online_bytes + self.values.len() * 16384));
        store_identity(
            &mut bytes,
            COMMITTED_MAGIC,
            self.role,
            &self.id,
            self.values.len(),
        );
        bytes.extend_from_slice(&self.binding);
        for value in &self.values {
            store_polynomials(&mut bytes, &value.y[..COLUMNS]);
        }
        for value in &self.values {
            bytes.extend_from_slice(&value.high);
            store_polynomials(&mut bytes, &value.r);
        }
        for metrics in &self.nonce_batches {
            metrics.store(&mut bytes);
        }
        for batch in [&self.hashes, &self.bounds, &self.decisions] {
            batch.store(&mut bytes);
        }
        bytes
    }

    fn decode(
        role: SigningRole,
        id: [u8; 32],
        candidates: u16,
        schedules: &'a [TrustedMlDsaSchedule<'a>],
        topologies: &mut PublicTopologies,
        bytes: &[u8],
    ) -> core::result::Result<Self, RuntimeError> {
        let count = usize::from(candidates);
        let mut reader = Reader::new(bytes);
        read_identity(&mut reader, COMMITTED_MAGIC, role, &id, count)?;
        let binding = reader
            .take(64)?
            .try_into()
            .map_err(|_| RuntimeError::InputLength)?;
        let mut values = read_nonce_shares(&mut reader, count)?;
        for value in &mut values {
            value.high.copy_from_slice(reader.take(ROWS * 128)?);
            read_polynomials(&mut reader, &mut value.r)?;
        }
        let nonce_batches = [
            BatchMetrics::restore(&mut reader)?,
            BatchMetrics::restore(&mut reader)?,
        ];
        let (hashes, bounds, decisions) =
            read_online_batches(&mut reader, role, count, schedules, topologies)?;
        reader.finish()?;
        Ok(Self {
            role,
            id,
            binding,
            values,
            hashes,
            bounds,
            decisions,
            nonce_batches,
        })
    }
}

fn store_identity(
    bytes: &mut Vec<u8>,
    magic: &[u8; 8],
    role: SigningRole,
    id: &[u8; 32],
    count: usize,
) {
    bytes.extend_from_slice(magic);
    bytes.push(match role {
        SigningRole::A => 0,
        SigningRole::B => 1,
    });
    bytes.extend_from_slice(id);
    number(bytes, count);
}

fn read_identity(
    reader: &mut Reader<'_>,
    magic: &[u8; 8],
    role: SigningRole,
    id: &[u8; 32],
    count: usize,
) -> core::result::Result<(), RuntimeError> {
    let role_byte = match role {
        SigningRole::A => 0,
        SigningRole::B => 1,
    };
    if reader.take(8)? != magic
        || reader.take(1)? != [role_byte]
        || reader.take(32)? != id
        || reader.number()? != count
    {
        return Err(RuntimeError::SessionBinding);
    }
    Ok(())
}

fn store_polynomials(bytes: &mut Vec<u8>, polynomials: &[Polynomial]) {
    for polynomial in polynomials {
        for coefficient in polynomial {
            bytes.extend_from_slice(&coefficient.to_le_bytes());
        }
    }
}

fn read_polynomials(
    reader: &mut Reader<'_>,
    polynomials: &mut [Polynomial],
) -> core::result::Result<(), RuntimeError> {
    for polynomial in polynomials {
        for coefficient in polynomial {
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
    Ok(())
}

fn read_nonce_shares(
    reader: &mut Reader<'_>,
    count: usize,
) -> core::result::Result<Vec<Zeroizing<Candidate>>, RuntimeError> {
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        let mut value = Zeroizing::new(Candidate::empty());
        read_polynomials(reader, &mut value.y[..COLUMNS])?;
        values.push(value);
    }
    Ok(values)
}

fn read_online_batches<'a>(
    reader: &mut Reader<'_>,
    role: SigningRole,
    count: usize,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    topologies: &mut PublicTopologies,
) -> core::result::Result<
    (
        PreparedGmwBatch<'a>,
        PreparedGmwBatch<'a>,
        PreparedGmwBatch<'a>,
    ),
    RuntimeError,
> {
    let hash = schedule(schedules, 0x8d).map_err(|_| RuntimeError::ScheduleShape)?;
    let decision = schedule(schedules, 0x98).map_err(|_| RuntimeError::ScheduleShape)?;
    let hashes = PreparedGmwBatch::restore(role, &vec![hash; count], topologies, reader)?;
    let layout = bound_schedules(count, schedules).map_err(|_| RuntimeError::ScheduleShape)?;
    let bounds = PreparedGmwBatch::restore(role, &layout, topologies, reader)?;
    let decisions = PreparedGmwBatch::restore(role, &vec![decision; count], topologies, reader)?;
    Ok((hashes, bounds, decisions))
}
