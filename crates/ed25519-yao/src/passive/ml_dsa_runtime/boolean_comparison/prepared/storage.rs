//! Bounded private persistence encoding. Public topology is reconstructed.
use super::*;

pub(crate) struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    pub(crate) fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or(RuntimeError::InputLength)?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or(RuntimeError::InputLength)?;
        self.offset = end;
        Ok(bytes)
    }
    pub(crate) fn number(&mut self) -> Result<usize> {
        let value = u64::from_le_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| RuntimeError::InputLength)?,
        );
        usize::try_from(value).map_err(|_| RuntimeError::InputLength)
    }
    pub(crate) fn finish(self) -> Result<()> {
        check(self.offset == self.bytes.len(), RuntimeError::InputLength)
    }
}
pub(crate) fn number(out: &mut Vec<u8>, value: usize) {
    out.extend_from_slice(&(value as u64).to_le_bytes());
}
fn phases(out: &mut Vec<u8>, values: &[PhaseBytes; 6]) {
    for value in values {
        number(out, value.sent);
        number(out, value.received);
    }
}
fn read_phases(reader: &mut Reader<'_>) -> Result<[PhaseBytes; 6]> {
    let mut values = [PhaseBytes::default(); 6];
    for value in &mut values {
        value.sent = reader.number()?;
        value.received = reader.number()?;
    }
    Ok(values)
}
impl BatchMetrics {
    pub(crate) fn store(&self, out: &mut Vec<u8>) {
        phases(out, &self.phases);
        for value in [
            self.instances,
            self.and_gates,
            self.and_exchanges,
            self.topology_allocation_bytes,
            self.private_state_allocation_bytes,
        ] {
            number(out, value);
        }
    }
    pub(crate) fn restore(reader: &mut Reader<'_>) -> Result<Self> {
        Ok(Self {
            phases: read_phases(reader)?,
            instances: reader.number()?,
            and_gates: reader.number()?,
            and_exchanges: reader.number()?,
            topology_allocation_bytes: reader.number()?,
            private_state_allocation_bytes: reader.number()?,
        })
    }
}
impl<'a> PreparedGmwBatch<'a> {
    pub(crate) fn store(&self, out: &mut Vec<u8>) {
        phases(out, &self.bytes);
        for instance in &self.instances {
            out.extend_from_slice(&self.groups[instance.group].schedule.digest);
            out.extend_from_slice(&instance.binding);
        }
        for group in &self.groups {
            out.extend_from_slice(&group.left);
            out.extend_from_slice(&group.right);
            out.extend_from_slice(&group.products);
        }
    }
    pub(crate) fn restore(
        role: SigningRole,
        schedules: &[&'a TrustedMlDsaSchedule<'a>],
        topologies: &mut PublicTopologies,
        reader: &mut Reader<'_>,
    ) -> Result<Self> {
        let bytes = read_phases(reader)?;
        let (mut groups, mut instances) = build_layout(schedules, topologies);
        for instance in &mut instances {
            check(
                reader.take(32)? == groups[instance.group].schedule.digest,
                RuntimeError::SessionBinding,
            )?;
            instance.binding.copy_from_slice(reader.take(32)?);
        }
        for group in &mut groups {
            for bits in [&mut group.left, &mut group.right, &mut group.products] {
                let length = bits.len();
                bits.copy_from_slice(reader.take(length)?);
                // Padding lanes must never carry correlations for another circuit.
                if group.lanes % 8 != 0 {
                    let stride = group.lanes.div_ceil(8);
                    let mask = !((1u8 << (group.lanes % 8)) - 1);
                    for chunk in bits.chunks_exact(stride) {
                        check(chunk[stride - 1] & mask == 0, RuntimeError::InputLength)?;
                    }
                }
            }
        }
        Ok(Self {
            role,
            groups,
            instances,
            bytes,
        })
    }
}
