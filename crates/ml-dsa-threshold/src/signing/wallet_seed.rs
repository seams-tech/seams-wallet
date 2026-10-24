//! Derive the canonical FIPS seed privately before ordinary threshold keygen.

use zeroize::{Zeroize, Zeroizing};

use super::{
    append_bytes,
    keygen::{begin_keygen, KeygenError, KeygenStep},
    SigningRole,
};
use crate::runtime::{
    begin_evaluator, begin_garbler, RuntimeMetrics, RuntimeOutput, Step, TrustedMlDsaSchedule,
};

/// Consuming preparation for one private wallet-root-to-seed circuit.
/// The caller must admit the same stable wallet binding and deliver each root
/// share to its intended role before preparation. No full seed is returned.
pub struct WalletSeedCircuit {
    role: SigningRole,
    input: Zeroizing<Vec<bool>>,
    own_seed_mask: Zeroizing<[u8; 32]>,
}

/// Uses one role's owner-root share. A generates the fresh canonical-seed mask.
pub fn prepare_wallet_keygen(
    role: SigningRole,
    own_owner_root_share: &[u8; 32],
) -> Result<WalletSeedCircuit, KeygenError> {
    let mut input = Zeroizing::new(Vec::with_capacity(512));
    append_bytes(&mut input, own_owner_root_share);
    let mut own_seed_mask = Zeroizing::new([0; 32]);
    if role == SigningRole::A {
        super::random_bytes(own_seed_mask.as_mut()).map_err(|_| KeygenError::Randomness)?;
        append_bytes(&mut input, own_seed_mask.as_ref());
    }
    Ok(WalletSeedCircuit {
        role,
        input,
        own_seed_mask,
    })
}

impl WalletSeedCircuit {
    /// Starts only the pinned wallet-seed circuit. Each call uses fresh OT and labels.
    pub fn begin<'a>(
        &self,
        schedule: &'a TrustedMlDsaSchedule<'a>,
    ) -> Result<Step<'a>, KeygenError> {
        if schedule.circuit_id() != 0x91 {
            return Err(KeygenError::Schedule);
        }
        match self.role {
            SigningRole::A => begin_garbler(schedule, &self.input),
            SigningRole::B => begin_evaluator(schedule, &self.input),
        }
        .map_err(|_| KeygenError::CircuitRuntime)
    }

    /// Executes the private wallet-seed stage with matching one-use preparation.
    pub async fn run_prepared(
        self,
        prepared: crate::runtime::prepared::PreparedCircuit<'_>,
        transport: &mut impl crate::runtime::prepared::Transport,
    ) -> Result<(KeygenStep, RuntimeMetrics), KeygenError> {
        if prepared.circuit_id() != 0x91 || prepared.role() != self.role {
            return Err(KeygenError::Schedule);
        }
        let output = prepared
            .run(&self.input, transport)
            .await
            .map_err(|_| KeygenError::CircuitRuntime)?;
        self.accept(output)
    }

    /// Consumes only this role's permitted output and immediately starts keygen.
    pub fn accept(
        mut self,
        output: RuntimeOutput,
    ) -> Result<(KeygenStep, RuntimeMetrics), KeygenError> {
        match self.role {
            SigningRole::A if !output.output.is_empty() => return Err(KeygenError::CircuitOutput),
            SigningRole::B => {
                if output.output.len() != 32 {
                    return Err(KeygenError::CircuitOutput);
                }
                self.own_seed_mask.copy_from_slice(&output.output);
            }
            SigningRole::A => {}
        }
        self.input.zeroize();
        let next = begin_keygen(self.role, &self.own_seed_mask)?;
        Ok((next, output.metrics))
    }
}
