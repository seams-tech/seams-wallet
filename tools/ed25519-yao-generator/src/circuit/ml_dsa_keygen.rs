use super::ir::{CanonicalBooleanCircuitV1, CircuitBuilder};
use super::keccak::{append_constant_byte, shake256};
use super::ml_dsa_rounding::rounding_bits;
use super::ml_dsa_sampling::sampling_bits;
use super::schedule::CanonicalLivenessScheduleV1;
use super::{
    BooleanCircuitMetricsV1, ProvisionalBenchmarkComponentDigest32V1,
    ProvisionalBenchmarkScheduleDigest32V1, ProvisionalScheduleMetricsV1,
};

const SEED_BITS: usize = 256;
const RHO_PRIME_BITS: usize = 512;
const POLYNOMIAL_RESIDUE_BITS: usize = 256 * 23;
const SEED_A_INPUT_BITS: usize = SEED_BITS + RHO_PRIME_BITS + SEED_BITS;
const SAMPLING_A_INPUT_BITS: usize = RHO_PRIME_BITS + POLYNOMIAL_RESIDUE_BITS;

const SEED_INPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/private-seed/input/v1:A:xi-share[32],rho-prime-mask[64],K-mask[32];B:xi-share[32]:byte-major-lsb0";
const SEED_OUTPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/private-seed/output/v1:public:rho[32];B:rho-prime-share[64],K-share[32]:byte-major-lsb0";
const SAMPLING_INPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/private-sampling/input/v1:A:rho-prime-share[64]:byte-major-lsb0,mask[256]:residue23-lsb0;B:rho-prime-share[64]:byte-major-lsb0:nonce-public-le16";
const SAMPLING_OUTPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/private-sampling/output/v1:public:success[1];B:s-share[256]:residue23-lsb0:zero-on-failure";
const ROUNDING_INPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/private-rounding/input/v1:A:t-share[256],t0-mask[256];B:t-share[256]:residue23-lsb0";
const ROUNDING_OUTPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/private-rounding/output/v1:public:t1[256]:unsigned10-lsb0;B:t0-share[256]:residue23-lsb0";

/// A host-only key-generation circuit with separate A and B input regions.
///
/// The compiler accepts no seed, share, or mask values. It constructs a fixed
/// Boolean topology. Private values remain wires until the output boundary.
/// A supplies fresh independent masks and retains them as its output shares.
/// Honest input formation is required by the passive investigation profile.
///
/// The schedule must run through a secure two-party executor with private input
/// transfer and the documented output ownership. Its encoding alone provides
/// no privacy. This type has no cleartext evaluation or production signing API.
pub struct MlDsaPrivateKeygenCircuitV1 {
    circuit: CanonicalBooleanCircuitV1,
    schedule: CanonicalLivenessScheduleV1,
}

impl MlDsaPrivateKeygenCircuitV1 {
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

    /// Returns the host benchmark schedule for two-party execution.
    pub fn canonical_schedule_encoding(&self) -> &[u8] {
        self.schedule.canonical_encoding()
    }
}

/// Compiles canonical ML-DSA-65 seed expansion with masked secret outputs.
///
/// A's first 1,024 input bits contain its 32-byte seed share, 64-byte rho-prime
/// mask, and 32-byte K mask. B's final 256 bits contain its seed share.
/// The circuit computes SHAKE256(xi_A XOR xi_B || 0x06 || 0x05, 128).
/// It outputs public rho, B's rho-prime share, then B's K share.
/// Each byte uses least-significant-bit-first order. A's masks are XOR shares.
pub fn compile_ml_dsa_private_seed_circuit_v1() -> MlDsaPrivateKeygenCircuitV1 {
    let mut builder = CircuitBuilder::new((SEED_A_INPUT_BITS + SEED_BITS) as u32)
        .expect("fixed private seed circuit has inputs");
    let inputs = builder.input_bits();
    let mut message = Vec::with_capacity(34 * 8);
    for bit in 0..SEED_BITS {
        message.push(builder.xor(inputs[bit], inputs[SEED_A_INPUT_BITS + bit]));
    }
    append_constant_byte(&mut message, 6);
    append_constant_byte(&mut message, 5);
    let expanded = shake256(&mut builder, &message, 128);
    let mut outputs = Vec::with_capacity(SEED_A_INPUT_BITS);
    outputs.extend_from_slice(&expanded[..SEED_BITS]);
    for bit in SEED_BITS..SEED_A_INPUT_BITS {
        outputs.push(builder.xor(expanded[bit], inputs[bit]));
    }
    finish_private_circuit(
        builder,
        outputs,
        0x87,
        SEED_INPUT_SCHEMA,
        SEED_OUTPUT_SCHEMA,
    )
}

/// Compiles secret polynomial expansion and eta=4 sampling as one circuit.
///
/// A's first 6,400 input bits contain its 64-byte rho-prime XOR share and 256
/// independent mask residues below q. B's final 512 bits contain its rho-prime
/// XOR share. Each residue uses 23 least-significant-bit-first bits.
/// The circuit samples the first 256 accepted nibbles from 481 SHAKE256 bytes.
/// It outputs public success followed by B's additive coefficient shares.
/// It never outputs rho-prime or the SHAKE stream. On failure, B's shares are
/// zero. Both parties must discard polynomial shares and retain the same seed.
pub fn compile_ml_dsa_private_sampling_circuit_v1(nonce: u16) -> MlDsaPrivateKeygenCircuitV1 {
    let mut builder = CircuitBuilder::new((SAMPLING_A_INPUT_BITS + RHO_PRIME_BITS) as u32)
        .expect("fixed private sampling circuit has inputs");
    let inputs = builder.input_bits();
    let mut message = Vec::with_capacity(66 * 8);
    for bit in 0..RHO_PRIME_BITS {
        message.push(builder.xor(inputs[bit], inputs[SAMPLING_A_INPUT_BITS + bit]));
    }
    for byte in nonce.to_le_bytes() {
        append_constant_byte(&mut message, byte);
    }
    let candidates = shake256(&mut builder, &message, 481);
    let outputs = sampling_bits(
        &mut builder,
        &candidates,
        &inputs[RHO_PRIME_BITS..SAMPLING_A_INPUT_BITS],
    );
    finish_private_circuit(
        builder,
        outputs,
        0x88,
        SAMPLING_INPUT_SCHEMA,
        SAMPLING_OUTPUT_SCHEMA,
    )
}

/// Compiles shared-input Power2Round with masked low coefficient outputs.
///
/// A's first 11,776 input bits contain 256 t shares, then 256 independent t0
/// mask residues below q. B's final 5,888 bits contain its 256 t shares.
/// Each residue uses 23 least-significant-bit-first bits.
/// Outputs contain 256 public 10-bit t1 values, then 256 B t0 shares.
/// The full t polynomial and the unmasked t0 polynomial remain internal wires.
pub fn compile_ml_dsa_private_rounding_circuit_v1() -> MlDsaPrivateKeygenCircuitV1 {
    let mut builder = CircuitBuilder::new((POLYNOMIAL_RESIDUE_BITS * 3) as u32)
        .expect("fixed private rounding circuit has inputs");
    let inputs = builder.input_bits();
    let outputs = rounding_bits(
        &mut builder,
        &inputs[..POLYNOMIAL_RESIDUE_BITS],
        &inputs[POLYNOMIAL_RESIDUE_BITS * 2..],
        &inputs[POLYNOMIAL_RESIDUE_BITS..POLYNOMIAL_RESIDUE_BITS * 2],
    );
    finish_private_circuit(
        builder,
        outputs,
        0x89,
        ROUNDING_INPUT_SCHEMA,
        ROUNDING_OUTPUT_SCHEMA,
    )
}

fn finish_private_circuit(
    builder: CircuitBuilder,
    outputs: Vec<super::ir::BuilderBit>,
    component: u8,
    input_schema: &[u8],
    output_schema: &[u8],
) -> MlDsaPrivateKeygenCircuitV1 {
    let circuit = builder
        .finish_ml_dsa_private_keygen_component(outputs, component, input_schema, output_schema)
        .expect("fixed private key-generation topology is canonical");
    let schedule = CanonicalLivenessScheduleV1::derive(&circuit);
    MlDsaPrivateKeygenCircuitV1 { circuit, schedule }
}
