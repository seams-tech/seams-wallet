use core::fmt;

use super::ir::{BuilderBit, CanonicalBooleanCircuitV1, CircuitBuilder};
use super::schedule::CanonicalLivenessScheduleV1;
use super::{
    BooleanCircuitMetricsV1, ProvisionalBenchmarkComponentDigest32V1,
    ProvisionalBenchmarkScheduleDigest32V1, ProvisionalScheduleMetricsV1,
};

const ZERO_BIT: BuilderBit = BuilderBit::Constant(false);
const SHAKE256_RATE_BYTES: usize = 136;
const KECCAK_STATE_BYTES: usize = 200;
const KECCAK_INPUT_SCHEMA: &[u8] =
    b"seams/ml-dsa-investigation/keccak-f1600/input/v1:state[200]:byte-major-lsb0";
const KECCAK_OUTPUT_SCHEMA: &[u8] =
    b"seams/ml-dsa-investigation/keccak-f1600/output/v1:state[200]:byte-major-lsb0";
const SEED_INPUT_SCHEMA: &[u8] =
    b"seams/ml-dsa-investigation/seed-expansion/input/v1:share-a[32],share-b[32]:byte-major-lsb0";
const SEED_OUTPUT_SCHEMA: &[u8] =
    b"seams/ml-dsa-investigation/seed-expansion/output/v1:rho[32],rho-prime[64],K[32]:byte-major-lsb0";
const POLYNOMIAL_INPUT_SCHEMA: &[u8] =
    b"seams/ml-dsa-investigation/expand-s-stream/input/v1:rho-prime[64]:nonce-public-le16:byte-major-lsb0";
const POLYNOMIAL_OUTPUT_SCHEMA: &[u8] =
    b"seams/ml-dsa-investigation/expand-s-stream/output/v1:stream[481]:byte-major-lsb0";

type Word = [BuilderBit; 64];
type State = [Word; 25];

const ROTATION_OFFSETS: [usize; 25] = [
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

const ROUND_CONSTANTS: [u64; 24] = [
    0x0000_0000_0000_0001,
    0x0000_0000_0000_8082,
    0x8000_0000_0000_808a,
    0x8000_0000_8000_8000,
    0x0000_0000_0000_808b,
    0x0000_0000_8000_0001,
    0x8000_0000_8000_8081,
    0x8000_0000_0000_8009,
    0x0000_0000_0000_008a,
    0x0000_0000_0000_0088,
    0x0000_0000_8000_8009,
    0x0000_0000_8000_000a,
    0x0000_0000_8000_808b,
    0x8000_0000_0000_008b,
    0x8000_0000_0000_8089,
    0x8000_0000_0000_8003,
    0x8000_0000_0000_8002,
    0x8000_0000_0000_0080,
    0x0000_0000_0000_800a,
    0x8000_0000_8000_000a,
    0x8000_0000_8000_8081,
    0x8000_0000_0000_8080,
    0x0000_0000_8000_0001,
    0x8000_0000_8000_8008,
];

/// Fixed, host-only hashing workloads for the ML-DSA-65 investigation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MlDsaHashWorkloadV1 {
    /// Permute an unknown 200-byte state through all 24 Keccak-f rounds.
    KeccakF1600,
    /// XOR two 32-byte seed shares, then expand the canonical ML-DSA-65 seed.
    SeedExpansion,
    /// Generate 481 SHAKE256 bytes for one secret polynomial's public nonce.
    ExpandSPolynomial {
        /// Polynomial index appended to rho-prime as two little-endian bytes.
        nonce: u16,
    },
}

impl MlDsaHashWorkloadV1 {
    const fn input_bytes(self) -> usize {
        match self {
            Self::KeccakF1600 => KECCAK_STATE_BYTES,
            Self::SeedExpansion | Self::ExpandSPolynomial { .. } => 64,
        }
    }

    const fn output_bytes(self) -> usize {
        match self {
            Self::KeccakF1600 => KECCAK_STATE_BYTES,
            Self::SeedExpansion => 128,
            Self::ExpandSPolynomial { .. } => 481,
        }
    }

    const fn schema(self) -> (u8, &'static [u8], &'static [u8]) {
        match self {
            Self::KeccakF1600 => (0x82, KECCAK_INPUT_SCHEMA, KECCAK_OUTPUT_SCHEMA),
            Self::SeedExpansion => (0x83, SEED_INPUT_SCHEMA, SEED_OUTPUT_SCHEMA),
            Self::ExpandSPolynomial { .. } => {
                (0x84, POLYNOMIAL_INPUT_SCHEMA, POLYNOMIAL_OUTPUT_SCHEMA)
            }
        }
    }
}

/// A public synthetic fixture has the wrong byte count for its fixed workload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MlDsaHashFixtureErrorV1 {
    /// Byte count required by the compiled workload.
    pub expected_bytes: usize,
    /// Byte count supplied by the caller.
    pub actual_bytes: usize,
}

impl fmt::Display for MlDsaHashFixtureErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "hash fixture requires {} bytes, received {}",
            self.expected_bytes, self.actual_bytes
        )
    }
}

impl std::error::Error for MlDsaHashFixtureErrorV1 {}

/// Host-only Boolean hashing circuit with no production or secure execution API.
pub struct MlDsaHashCircuitV1 {
    workload: MlDsaHashWorkloadV1,
    circuit: CanonicalBooleanCircuitV1,
    schedule: CanonicalLivenessScheduleV1,
}

impl MlDsaHashCircuitV1 {
    /// Returns the fixed workload and its public compile-time parameters.
    pub const fn workload(&self) -> MlDsaHashWorkloadV1 {
        self.workload
    }

    /// Returns counts measured from the finalized Boolean circuit.
    pub const fn metrics(&self) -> BooleanCircuitMetricsV1 {
        self.circuit.metrics()
    }

    /// Returns counts measured from the reusable-slot evaluation schedule.
    pub const fn schedule_metrics(&self) -> ProvisionalScheduleMetricsV1 {
        self.schedule.metrics()
    }

    /// Returns the identity of the exact canonical Boolean circuit bytes.
    pub const fn benchmark_component_digest(&self) -> ProvisionalBenchmarkComponentDigest32V1 {
        ProvisionalBenchmarkComponentDigest32V1(self.circuit.digest())
    }

    /// Returns the identity of the exact canonical evaluation schedule bytes.
    pub const fn benchmark_schedule_digest(&self) -> ProvisionalBenchmarkScheduleDigest32V1 {
        ProvisionalBenchmarkScheduleDigest32V1(self.schedule.digest())
    }

    /// Evaluates public fixtures in cleartext through the Boolean schedule.
    ///
    /// Keccak accepts its 200-byte state in lane order x + 5*y, with little-endian lanes.
    /// Seed expansion accepts share A followed by share B, each exactly 32 bytes.
    /// Polynomial expansion accepts exactly 64 bytes of rho-prime.
    /// This method provides no privacy or constant-time guarantee.
    pub fn evaluate_public_fixture(
        &self,
        input: &[u8],
    ) -> Result<Vec<u8>, MlDsaHashFixtureErrorV1> {
        if input.len() != self.workload.input_bytes() {
            return Err(MlDsaHashFixtureErrorV1 {
                expected_bytes: self.workload.input_bytes(),
                actual_bytes: input.len(),
            });
        }
        let mut bits = Vec::with_capacity(input.len() * 8);
        for byte in input {
            for bit in 0..8 {
                bits.push((byte >> bit) & 1 == 1);
            }
        }
        let outputs = self
            .schedule
            .evaluate(&bits)
            .expect("validated fixture has the compiled input count");
        let mut bytes = vec![0_u8; self.workload.output_bytes()];
        for (index, bit) in outputs.into_iter().enumerate() {
            bytes[index / 8] |= u8::from(bit) << (index % 8);
        }
        Ok(bytes)
    }
}

/// Compiles a fixed experiment without reading any secret input values.
pub fn compile_ml_dsa_hash_circuit_v1(workload: MlDsaHashWorkloadV1) -> MlDsaHashCircuitV1 {
    let input_count = u32::try_from(workload.input_bytes() * 8)
        .expect("fixed hashing workload input count fits u32");
    let mut builder = CircuitBuilder::new(input_count).expect("hashing workload has inputs");
    let inputs = builder.input_bits();
    let outputs = match workload {
        MlDsaHashWorkloadV1::KeccakF1600 => {
            let mut state = [[ZERO_BIT; 64]; 25];
            install_bits(&mut state, &inputs);
            keccak_f1600(&mut builder, &mut state);
            state.into_iter().flatten().collect()
        }
        MlDsaHashWorkloadV1::SeedExpansion => {
            let mut message = Vec::with_capacity(34 * 8);
            for bit in 0..256 {
                message.push(builder.xor(inputs[bit], inputs[256 + bit]));
            }
            append_constant_byte(&mut message, 6);
            append_constant_byte(&mut message, 5);
            shake256(&mut builder, &message, 128)
        }
        MlDsaHashWorkloadV1::ExpandSPolynomial { nonce } => {
            let mut message = inputs;
            for byte in nonce.to_le_bytes() {
                append_constant_byte(&mut message, byte);
            }
            shake256(&mut builder, &message, 481)
        }
    };
    let (component, input_schema, output_schema) = workload.schema();
    let circuit = builder
        .finish_ml_dsa_hash_component(outputs, component, input_schema, output_schema)
        .expect("fixed hashing circuit topology is canonical");
    let schedule = CanonicalLivenessScheduleV1::derive(&circuit);
    MlDsaHashCircuitV1 {
        workload,
        circuit,
        schedule,
    }
}

fn append_constant_byte(bits: &mut Vec<BuilderBit>, byte: u8) {
    for bit in 0..8 {
        bits.push(BuilderBit::Constant((byte >> bit) & 1 == 1));
    }
}

fn install_bits(state: &mut State, bits: &[BuilderBit]) {
    for (index, bit) in bits.iter().copied().enumerate() {
        state[index / 64][index % 64] = bit;
    }
}

fn shake256(
    builder: &mut CircuitBuilder,
    message: &[BuilderBit],
    output_bytes: usize,
) -> Vec<BuilderBit> {
    assert!(message.len().is_multiple_of(8));
    assert!(message.len() / 8 < SHAKE256_RATE_BYTES);
    let mut padded = message.to_vec();
    append_constant_byte(&mut padded, 0x1f);
    padded.resize(SHAKE256_RATE_BYTES * 8, ZERO_BIT);
    padded[SHAKE256_RATE_BYTES * 8 - 1] = BuilderBit::Constant(true);
    let mut state = [[ZERO_BIT; 64]; 25];
    install_bits(&mut state, &padded);
    let mut outputs = Vec::with_capacity(output_bytes * 8);
    while outputs.len() < output_bytes * 8 {
        keccak_f1600(builder, &mut state);
        let remaining = output_bytes * 8 - outputs.len();
        let block_bits = remaining.min(SHAKE256_RATE_BYTES * 8);
        for bit in 0..block_bits {
            outputs.push(state[bit / 64][bit % 64]);
        }
    }
    outputs
}

fn keccak_f1600(builder: &mut CircuitBuilder, state: &mut State) {
    for round_constant in ROUND_CONSTANTS {
        theta(builder, state);
        let mut permuted = [[ZERO_BIT; 64]; 25];
        for y in 0..5 {
            for x in 0..5 {
                let source = x + 5 * y;
                let destination = y + 5 * ((2 * x + 3 * y) % 5);
                permuted[destination] = rotate_left(state[source], ROTATION_OFFSETS[source]);
            }
        }
        for y in 0..5 {
            for x in 0..5 {
                for bit in 0..64 {
                    let inverted = builder.inv(permuted[(x + 1) % 5 + 5 * y][bit]);
                    let product = builder.and(inverted, permuted[(x + 2) % 5 + 5 * y][bit]);
                    state[x + 5 * y][bit] = builder.xor(permuted[x + 5 * y][bit], product);
                }
            }
        }
        for bit in 0..64 {
            state[0][bit] = builder.xor(
                state[0][bit],
                BuilderBit::Constant((round_constant >> bit) & 1 == 1),
            );
        }
    }
}

fn theta(builder: &mut CircuitBuilder, state: &mut State) {
    let mut columns = [[ZERO_BIT; 64]; 5];
    for x in 0..5 {
        for y in 0..5 {
            for bit in 0..64 {
                columns[x][bit] = builder.xor(columns[x][bit], state[x + 5 * y][bit]);
            }
        }
    }
    for x in 0..5 {
        let rotated = rotate_left(columns[(x + 1) % 5], 1);
        let mut delta = [ZERO_BIT; 64];
        for bit in 0..64 {
            delta[bit] = builder.xor(columns[(x + 4) % 5][bit], rotated[bit]);
        }
        for y in 0..5 {
            for bit in 0..64 {
                state[x + 5 * y][bit] = builder.xor(state[x + 5 * y][bit], delta[bit]);
            }
        }
    }
}

fn rotate_left(word: Word, amount: usize) -> Word {
    let mut rotated = [ZERO_BIT; 64];
    for bit in 0..64 {
        rotated[bit] = word[(bit + 64 - amount) % 64];
    }
    rotated
}
