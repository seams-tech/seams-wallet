//! Recovery key files holding the recipient keys the committed artifact set was
//! sealed to.

use std::path::PathBuf;

use rand_core_09::{CryptoRng, RngCore};
use router_ab_core::TwoPartyDeriverRole;
use seams_recovery_core::{write_new_file_durably_v1, RecoveryKeyFileV1};

use crate::support::Scratch;

pub const DERIVER_A_KEY_MATERIAL: [u8; 32] = [0xa1; 32];
pub const DERIVER_B_KEY_MATERIAL: [u8; 32] = [0xb1; 32];

/// Writes a key file for `role` holding exactly `material`.
pub fn key_file(scratch: &Scratch, role: TwoPartyDeriverRole, material: [u8; 32]) -> PathBuf {
    let (file, _) =
        RecoveryKeyFileV1::create(role, &mut ScriptedRng::new(material)).expect("key file");
    let path = scratch.path(&format!("{}.key", role.as_str()));
    write_new_file_durably_v1(&path, &file.to_bytes().expect("bytes")).expect("write key file");
    path
}

/// An RNG that yields fixed recipient key material first, then a deterministic
/// stream.
struct ScriptedRng {
    key_material: [u8; 32],
    consumed: bool,
    counter: u8,
}

impl ScriptedRng {
    const fn new(key_material: [u8; 32]) -> Self {
        Self {
            key_material,
            consumed: false,
            counter: 0,
        }
    }
}

impl RngCore for ScriptedRng {
    fn next_u32(&mut self) -> u32 {
        let mut bytes = [0_u8; 4];
        self.fill_bytes(&mut bytes);
        u32::from_le_bytes(bytes)
    }

    fn next_u64(&mut self) -> u64 {
        let mut bytes = [0_u8; 8];
        self.fill_bytes(&mut bytes);
        u64::from_le_bytes(bytes)
    }

    fn fill_bytes(&mut self, destination: &mut [u8]) {
        if !self.consumed && destination.len() == 32 {
            destination.copy_from_slice(&self.key_material);
            self.consumed = true;
            return;
        }
        for byte in destination.iter_mut() {
            self.counter = self.counter.wrapping_add(1);
            *byte = self.counter;
        }
    }
}

impl CryptoRng for ScriptedRng {}
