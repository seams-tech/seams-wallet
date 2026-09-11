//! Local service drill using the published recovery vectors and their test trust root.
use std::path::Path;

use rand_core_09::{CryptoRng, RngCore};
use router_ab_core::TwoPartyDeriverRole;
use seams_recovery_core::{write_new_file_durably_v1, RecoveryKeyFileV1};

struct FixtureRng {
    material: [u8; 32],
    first: bool,
    counter: u8,
}
impl RngCore for FixtureRng {
    fn next_u32(&mut self) -> u32 {
        let mut b = [0; 4];
        self.fill_bytes(&mut b);
        u32::from_le_bytes(b)
    }
    fn next_u64(&mut self) -> u64 {
        let mut b = [0; 8];
        self.fill_bytes(&mut b);
        u64::from_le_bytes(b)
    }
    fn fill_bytes(&mut self, bytes: &mut [u8]) {
        if self.first && bytes.len() == 32 {
            bytes.copy_from_slice(&self.material);
            self.first = false;
            return;
        }
        for byte in bytes {
            self.counter = self.counter.wrapping_add(1);
            *byte = self.counter;
        }
    }
}
impl CryptoRng for FixtureRng {}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../router-ab-core/tests/fixtures/tenant-root-recovery");
    if args.first().map(String::as_str) == Some("prepare") {
        let directory = Path::new(args.get(1).expect("prepare requires a new directory"));
        std::fs::create_dir(directory).expect("create new drill directory");
        for name in ["manifest.json", "deriver-a.backup", "deriver-b.backup"] {
            std::fs::copy(fixtures.join(name), directory.join(name)).expect("copy vector");
        }
        for (role, material, name) in [
            (TwoPartyDeriverRole::DeriverA, 0xa1, "deriver-a-wrapper.key"),
            (TwoPartyDeriverRole::DeriverB, 0xb1, "deriver-b-wrapper.key"),
        ] {
            let (key, _) = RecoveryKeyFileV1::create(
                role,
                &mut FixtureRng {
                    material: [material; 32],
                    first: true,
                    counter: 0,
                },
            )
            .expect("fixture key");
            write_new_file_durably_v1(&directory.join(name), &key.to_bytes().unwrap()).unwrap();
        }
        return;
    }
    panic!("Use prepare <directory> to write test fixtures");
}
