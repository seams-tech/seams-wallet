//! Role-private prepared inputs. Table frames remain in authenticated external storage.
use super::*;
use crate::passive::ml_dsa_runtime::boolean_comparison::prepared::storage::{number, Reader};

impl PreparedCircuit<'_> {
    pub(super) fn storage_bytes(&self) -> usize {
        let private = match &self.secret {
            Secret::A {
                input_zeros,
                masked_pairs,
                ..
            } => 16 + input_zeros.len() * 16 + masked_pairs.len() * 32,
            Secret::B {
                choices,
                selected_pads,
                translation,
            } => choices.len() + selected_pads.len() * 16 + translation.len(),
        };
        32 + 8 + 32 + 3 * 8 + private
    }

    pub(super) fn store(&self, out: &mut Vec<u8>) {
        let common = &self.common;
        out.extend_from_slice(&common.schedule.digest);
        out.extend_from_slice(&common.domain.0.to_be_bytes());
        out.extend_from_slice(&common.metrics.execution_binding_sha256);
        number(out, self.offline_sent);
        number(out, self.offline_received);
        number(out, common.metrics.label_arena_allocation_bytes);
        match &self.secret {
            Secret::A {
                input_zeros,
                masked_pairs,
                delta,
            } => {
                out.extend_from_slice(&delta.0);
                for label in input_zeros.iter() {
                    out.extend_from_slice(label);
                }
                for (zero, one) in masked_pairs.iter() {
                    out.extend_from_slice(zero);
                    out.extend_from_slice(one);
                }
            }
            Secret::B {
                choices,
                selected_pads,
                translation,
            } => {
                out.extend_from_slice(choices);
                for pad in selected_pads.iter() {
                    out.extend_from_slice(pad);
                }
                out.extend_from_slice(translation);
            }
        }
    }
}
impl<'a> PreparedCircuit<'a> {
    pub(super) fn restore(
        role: SigningRole,
        schedule: &'a TrustedMlDsaSchedule<'a>,
        reader: &mut Reader<'_>,
    ) -> Result<Self> {
        check(
            reader.take(32)? == schedule.digest,
            RuntimeError::SessionBinding,
        )?;
        let domain = SessionDomain::from_protocol_value(u64::from_be_bytes(
            reader
                .take(8)?
                .try_into()
                .map_err(|_| RuntimeError::InputLength)?,
        ))
        .ok_or(RuntimeError::SessionBinding)?;
        let binding = reader
            .take(32)?
            .try_into()
            .map_err(|_| RuntimeError::InputLength)?;
        let session = OtSessionId::new(binding).map_err(ot_error)?;
        let offline_sent = reader.number()?;
        let offline_received = reader.number()?;
        let arena_bytes = reader.number()?;
        let mut common = Common::new(
            schedule,
            match role {
                SigningRole::A => Role::A,
                SigningRole::B => Role::B,
            },
            domain,
            session,
            binding,
        );
        common.metrics.label_arena_allocation_bytes = arena_bytes;
        let secret = match role {
            SigningRole::A => {
                let mut delta = Zeroizing::new(super::super::super::SecretBlock::default());
                delta.0.copy_from_slice(reader.take(16)?);
                let mut input_zeros = Zeroizing::new(vec![[0; 16]; schedule.garbler_input_bits()]);
                for label in input_zeros.iter_mut() {
                    label.copy_from_slice(reader.take(16)?);
                }
                let mut masked_pairs =
                    Zeroizing::new(vec![([0; 16], [0; 16]); schedule.evaluator_input_bits()]);
                for (zero, one) in masked_pairs.iter_mut() {
                    zero.copy_from_slice(reader.take(16)?);
                    one.copy_from_slice(reader.take(16)?);
                }
                Secret::A {
                    input_zeros,
                    masked_pairs,
                    delta,
                }
            }
            SigningRole::B => {
                let choices = Zeroizing::new(
                    reader
                        .take(schedule.evaluator_input_bits().div_ceil(8))?
                        .to_vec(),
                );
                let mut selected_pads =
                    Zeroizing::new(vec![[0; 16]; schedule.evaluator_input_bits()]);
                for pad in selected_pads.iter_mut() {
                    pad.copy_from_slice(reader.take(16)?);
                }
                let translation =
                    Zeroizing::new(reader.take(schedule.outputs.div_ceil(8))?.to_vec());
                Secret::B {
                    choices,
                    selected_pads,
                    translation,
                }
            }
        };
        Ok(Self {
            common,
            secret,
            offline_sent,
            offline_received,
        })
    }
}
