//! Canonical production circuit artifacts and their immutable digest bindings.
//! Hosts and benchmarks share these exact bytes. They contain no private inputs.
use crate::runtime::{RuntimeError, TrustedMlDsaSchedule};

#[derive(Clone, Copy)]
pub struct Circuit {
    name: &'static str,
    bytes: &'static [u8],
    digest: [u8; 32],
}
impl Circuit {
    pub const fn name(&self) -> &'static str {
        self.name
    }
    pub const fn bytes(&self) -> &'static [u8] {
        self.bytes
    }
    pub const fn digest(&self) -> [u8; 32] {
        self.digest
    }
    pub fn parse(&self) -> Result<TrustedMlDsaSchedule<'static>, RuntimeError> {
        TrustedMlDsaSchedule::parse(self.bytes, self.digest)
    }
}

pub const FRESH_MASK: Circuit = Circuit {
    name: "fresh-mask",
    bytes: include_bytes!("../circuits/fresh-mask.bin"),
    digest: [
        249, 200, 2, 127, 189, 150, 141, 85, 250, 4, 24, 208, 71, 62, 17, 235, 81, 28, 25, 178, 65,
        141, 78, 163, 86, 167, 155, 210, 156, 114, 165, 237,
    ],
};

pub const PREPARED_COMMITMENT: Circuit = Circuit {
    name: "prepared-commitment",
    bytes: include_bytes!("../circuits/prepared-commitment.bin"),
    digest: [
        181, 121, 245, 123, 8, 158, 126, 211, 26, 190, 122, 150, 148, 14, 168, 120, 117, 2, 243, 2,
        153, 114, 245, 67, 111, 102, 109, 91, 36, 64, 67, 46,
    ],
};

pub const COMMITMENT_HASH: Circuit = Circuit {
    name: "commitment-hash",
    bytes: include_bytes!("../circuits/commitment-hash.bin"),
    digest: [
        92, 241, 146, 151, 32, 104, 19, 94, 151, 208, 202, 145, 115, 18, 30, 125, 218, 145, 189,
        73, 217, 243, 1, 182, 59, 37, 68, 199, 138, 72, 131, 97,
    ],
};

pub const RESPONSE_CHECK: Circuit = Circuit {
    name: "response-check",
    bytes: include_bytes!("../circuits/response-check.bin"),
    digest: [
        34, 216, 242, 37, 85, 236, 1, 73, 206, 21, 137, 19, 68, 54, 114, 21, 10, 80, 145, 174, 140,
        61, 146, 16, 241, 39, 247, 183, 208, 158, 4, 182,
    ],
};

pub const LOW_RESPONSE_CHECK: Circuit = Circuit {
    name: "low-response-check",
    bytes: include_bytes!("../circuits/low-response-check.bin"),
    digest: [
        173, 99, 238, 145, 102, 21, 50, 176, 168, 76, 136, 63, 143, 40, 154, 138, 41, 15, 246, 246,
        130, 232, 14, 146, 211, 190, 213, 51, 236, 76, 166, 135,
    ],
};

pub const BOUNDS_DECISION: Circuit = Circuit {
    name: "bounds-decision",
    bytes: include_bytes!("../circuits/bounds-decision.bin"),
    digest: [
        219, 233, 106, 178, 67, 85, 132, 195, 8, 46, 196, 242, 189, 223, 89, 187, 208, 89, 175, 3,
        148, 151, 209, 76, 243, 69, 0, 55, 134, 194, 20, 177,
    ],
};

pub const SIGNING: [Circuit; 6] = [
    FRESH_MASK,
    PREPARED_COMMITMENT,
    COMMITMENT_HASH,
    RESPONSE_CHECK,
    LOW_RESPONSE_CHECK,
    BOUNDS_DECISION,
];
pub const SIGNING_DIGEST: [u8; 32] = [
    247, 112, 70, 82, 98, 238, 136, 1, 220, 224, 124, 142, 51, 207, 97, 224, 103, 33, 181, 156, 87,
    209, 167, 162, 96, 196, 166, 224, 10, 228, 25, 82,
];

pub const WALLET_SEED: Circuit = Circuit {
    name: "wallet-seed",
    bytes: include_bytes!("../circuits/wallet-seed.bin"),
    digest: [
        7, 80, 9, 109, 60, 227, 11, 4, 223, 96, 55, 70, 127, 47, 80, 96, 69, 253, 91, 16, 157, 163,
        146, 37, 154, 110, 91, 164, 222, 12, 79, 169,
    ],
};

pub const SEED: Circuit = Circuit {
    name: "seed",
    bytes: include_bytes!("../circuits/seed.bin"),
    digest: [
        26, 116, 97, 234, 191, 125, 35, 215, 129, 69, 114, 17, 224, 53, 212, 207, 179, 16, 161, 66,
        43, 6, 228, 52, 145, 190, 33, 172, 8, 34, 246, 87,
    ],
};

pub const SAMPLING_TWO_BLOCKS: Circuit = Circuit {
    name: "sampling-two-blocks",
    bytes: include_bytes!("../circuits/sampling-two-blocks.bin"),
    digest: [
        56, 221, 72, 167, 68, 67, 247, 57, 62, 72, 242, 116, 165, 122, 101, 206, 221, 245, 121,
        255, 81, 70, 61, 15, 236, 15, 65, 103, 128, 79, 185, 110,
    ],
};

pub const SAMPLING_THREE_BLOCKS: Circuit = Circuit {
    name: "sampling-three-blocks",
    bytes: include_bytes!("../circuits/sampling-three-blocks.bin"),
    digest: [
        36, 242, 79, 44, 207, 206, 136, 173, 61, 155, 162, 169, 118, 9, 217, 250, 36, 180, 104,
        100, 197, 54, 26, 45, 102, 222, 135, 119, 201, 177, 113, 255,
    ],
};

pub const SAMPLING_FINAL_BOUND: Circuit = Circuit {
    name: "sampling-final-bound",
    bytes: include_bytes!("../circuits/sampling-final-bound.bin"),
    digest: [
        168, 78, 20, 93, 214, 36, 54, 24, 108, 123, 95, 98, 0, 165, 152, 26, 239, 109, 129, 1, 251,
        245, 19, 2, 111, 29, 30, 138, 211, 77, 70, 214,
    ],
};

pub const KEY_GENERATION: [Circuit; 5] = [
    WALLET_SEED,
    SEED,
    SAMPLING_TWO_BLOCKS,
    SAMPLING_THREE_BLOCKS,
    SAMPLING_FINAL_BOUND,
];
pub const KEY_GENERATION_DIGEST: [u8; 32] = [
    77, 25, 103, 214, 28, 164, 35, 162, 140, 109, 92, 105, 13, 171, 69, 26, 219, 224, 35, 38, 215,
    68, 56, 144, 15, 119, 227, 130, 252, 5, 222, 144,
];
