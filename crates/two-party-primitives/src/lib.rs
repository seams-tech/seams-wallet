#![forbid(unsafe_code)]
//! Shared passive two-party gates, oblivious transfer, and private AES primitives.
//! Protocol domains and wire encodings are stable across algorithm-specific adapters.

use core::fmt;

use aes::cipher::{Block, BlockEncrypt, KeyInit};
use aes::Aes128;
use subtle::{Choice, ConditionallySelectable};
use zeroize::{DefaultIsZeroes, Zeroize, ZeroizeOnDrop};

pub mod arena;
pub mod decoding;
pub mod gate_aes;
pub mod ot;
#[cfg(feature = "test-fixtures")]
pub mod test_fixtures;
#[cfg(test)]
mod tests;

/// Bytes in one private wire label.
pub const LABEL_BYTES: usize = 16;
/// Bytes in a half-gates AND table.
pub const AND_GATE_BYTES: usize = 2 * LABEL_BYTES;
const FIXED_AES_KEY: [u8; LABEL_BYTES] = [0_u8; LABEL_BYTES];
const GF128_REDUCTION: u8 = 0x87;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
/// One private input bit, reduced to zero or one.
pub struct WireValue(u8);

impl WireValue {
    const ZERO: Self = Self(0);
    const ONE: Self = Self(1);

    /// Role-private bytes owned by this value.
    pub const fn from_secret_bit(bit: u8) -> Self {
        Self(bit & 1)
    }

    const fn as_u8(self) -> u8 {
        self.0
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct ChoiceBit(u8);

impl From<WireValue> for ChoiceBit {
    fn from(value: WireValue) -> Self {
        Self(value.as_u8())
    }
}

impl ChoiceBit {
    #[cfg(test)]
    const fn as_u8(self) -> u8 {
        self.0
    }
}

/// Sixteen secret bytes that one volatile write wipes.
///
/// The derived wipe of a byte array writes and fences each byte on its own.
/// A ceremony drops millions of labels, and on WebAssembly that wipe took
/// about a third of garbling and of evaluation. `DefaultIsZeroes` selects the
/// same volatile write for the whole value at once, as for an integer.
#[derive(Clone, Copy, Default)]
pub struct SecretBlock(pub [u8; LABEL_BYTES]);

impl DefaultIsZeroes for SecretBlock {}

impl SecretBlock {
    fn conditional_xor(&mut self, other: &Self, choice: Choice) {
        let mut index = 0_usize;
        while index < LABEL_BYTES {
            self.0[index] ^= u8::conditional_select(&0, &other.0[index], choice);
            index += 1;
        }
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub(crate) struct WireLabel(SecretBlock);

impl WireLabel {
    const fn from_secret_bytes(bytes: [u8; LABEL_BYTES]) -> Self {
        Self(SecretBlock(bytes))
    }

    const fn bytes(&self) -> &[u8; LABEL_BYTES] {
        &self.0 .0
    }

    const fn selection_bit(&self) -> ChoiceBit {
        ChoiceBit(self.bytes()[LABEL_BYTES - 1] & 1)
    }

    fn xor(&self, other: &Self) -> Self {
        let mut output = [0_u8; LABEL_BYTES];
        let mut index = 0_usize;
        while index < LABEL_BYTES {
            output[index] = self.bytes()[index] ^ other.bytes()[index];
            index += 1;
        }
        Self::from_secret_bytes(output)
    }

    fn duplicate(&self) -> Self {
        Self(self.0)
    }

    fn conditional_xor(&mut self, other: &Self, choice: ChoiceBit) {
        self.0.conditional_xor(&other.0, Choice::from(choice.0));
    }

    #[cfg(test)]
    const fn test_bytes(&self) -> &[u8; LABEL_BYTES] {
        self.bytes()
    }

    #[cfg(test)]
    const fn from_test_bytes(bytes: [u8; LABEL_BYTES]) -> Self {
        Self::from_secret_bytes(bytes)
    }
}

impl fmt::Debug for WireLabel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("WireLabel([REDACTED])")
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
/// Private free-XOR offset, wiped when dropped.
pub struct GlobalDelta(WireLabel);

impl GlobalDelta {
    /// Draws a fresh private free-XOR offset.
    pub fn random() -> Result<Self, getrandom::Error> {
        let mut bytes = [0_u8; LABEL_BYTES];
        getrandom::getrandom(&mut bytes)?;
        bytes[LABEL_BYTES - 1] |= 1;
        Ok(Self(WireLabel::from_secret_bytes(bytes)))
    }

    const fn label(&self) -> &WireLabel {
        &self.0
    }

    #[cfg(any(test, feature = "test-fixtures"))]
    fn from_test_bytes(mut bytes: [u8; LABEL_BYTES]) -> Self {
        bytes[LABEL_BYTES - 1] |= 1;
        Self(WireLabel::from_secret_bytes(bytes))
    }
}

impl fmt::Debug for GlobalDelta {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("GlobalDelta([REDACTED])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Nonzero public domain separating circuit executions.
pub struct SessionDomain(u64);

impl SessionDomain {
    /// Returns the validated public domain value for its wire encoding.
    #[inline]
    pub const fn protocol_value(self) -> u64 {
        self.0
    }

    #[cfg(test)]
    pub fn random() -> Result<Self, getrandom::Error> {
        loop {
            let mut bytes = [0_u8; 8];
            getrandom::getrandom(&mut bytes)?;
            let value = u64::from_be_bytes(bytes);
            bytes.zeroize();
            if value != 0 {
                return Ok(Self(value));
            }
        }
    }

    /// Role-private bytes owned by this value.
    pub const fn from_protocol_value(value: u64) -> Option<Self> {
        if value == 0 {
            None
        } else {
            Some(Self(value))
        }
    }

    #[cfg(test)]
    const fn from_test_value(value: u64) -> Option<Self> {
        Self::from_protocol_value(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Public gate index in a circuit schedule.
pub struct GateOrdinal(u64);

impl GateOrdinal {
    /// Role-private bytes owned by this value.
    pub const fn from_schedule_index(value: u64) -> Option<Self> {
        if value < (1_u64 << 63) {
            Some(Self(value))
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HalfGate {
    Garbler = 0,
    Evaluator = 1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GateTweak([u8; LABEL_BYTES]);

impl GateTweak {
    fn new(domain: SessionDomain, gate_ordinal: GateOrdinal, half: HalfGate) -> Self {
        let encoded_ordinal = (gate_ordinal.0 << 1) | half as u64;
        let mut encoded = [0_u8; LABEL_BYTES];
        encoded[..8].copy_from_slice(&domain.0.to_be_bytes());
        encoded[8..].copy_from_slice(&encoded_ordinal.to_be_bytes());
        Self(encoded)
    }
}

/// The fixed-key hash of both half gates. The evaluator hashes two labels per
/// AND gate through the `aes` crate. The garbler hashes four, in one pass of
/// the four-block cipher.
struct FixedAesGarblingHash {
    cipher: Aes128,
    four_blocks: gate_aes::FourBlockAes128,
}

/// Two cipher blocks that one volatile write wipes.
#[derive(Clone, Copy, Default)]
struct TwoCipherBlocks([Block<Aes128>; 2]);

impl DefaultIsZeroes for TwoCipherBlocks {}

impl FixedAesGarblingHash {
    fn new() -> Self {
        Self {
            cipher: Aes128::new(&FIXED_AES_KEY.into()),
            four_blocks: gate_aes::FourBlockAes128::new(&FIXED_AES_KEY),
        }
    }

    #[cfg(test)]
    fn hash(&self, label: &WireLabel, tweak: GateTweak) -> WireLabel {
        let [output, mut unused] = self.hash_two(label, tweak, label, tweak);
        unused.zeroize();
        output
    }

    fn hash_two(
        &self,
        first_label: &WireLabel,
        first_tweak: GateTweak,
        second_label: &WireLabel,
        second_tweak: GateTweak,
    ) -> [WireLabel; 2] {
        let mut inputs = [
            prepare_hash_input(first_label, first_tweak),
            prepare_hash_input(second_label, second_tweak),
        ];
        let mut blocks = TwoCipherBlocks([inputs[0].0.into(), inputs[1].0.into()]);
        self.cipher.encrypt_blocks(&mut blocks.0);
        let outputs = [
            finish_hash_output(&inputs[0], blocks.0[0].as_ref()),
            finish_hash_output(&inputs[1], blocks.0[1].as_ref()),
        ];
        inputs.zeroize();
        blocks.zeroize();
        outputs
    }

    fn hash_four(&self, labels: [&WireLabel; 4], tweaks: [GateTweak; 4]) -> [WireLabel; 4] {
        let mut inputs = [
            prepare_hash_input(labels[0], tweaks[0]),
            prepare_hash_input(labels[1], tweaks[1]),
            prepare_hash_input(labels[2], tweaks[2]),
            prepare_hash_input(labels[3], tweaks[3]),
        ];
        let mut blocks = gate_aes::FourBlocks([inputs[0].0, inputs[1].0, inputs[2].0, inputs[3].0]);
        self.four_blocks.encrypt_four(&mut blocks);
        let outputs = [
            finish_hash_output(&inputs[0], &blocks.0[0]),
            finish_hash_output(&inputs[1], &blocks.0[1]),
            finish_hash_output(&inputs[2], &blocks.0[2]),
            finish_hash_output(&inputs[3], &blocks.0[3]),
        ];
        inputs.zeroize();
        blocks.zeroize();
        outputs
    }
}

/// The cipher input of one label: its double in GF(2^128), offset by the tweak.
fn prepare_hash_input(label: &WireLabel, tweak: GateTweak) -> SecretBlock {
    let mut doubled = SecretBlock(double_gf128(label.bytes()));
    let mut input = SecretBlock::default();
    let mut index = 0_usize;
    while index < LABEL_BYTES {
        input.0[index] = doubled.0[index] ^ tweak.0[index];
        index += 1;
    }
    doubled.zeroize();
    input
}

/// The hash output of one encrypted block. The caller wipes both arguments.
fn finish_hash_output(input: &SecretBlock, block: &[u8; LABEL_BYTES]) -> WireLabel {
    let mut output = [0_u8; LABEL_BYTES];
    let mut index = 0_usize;
    while index < LABEL_BYTES {
        output[index] = block[index] ^ input.0[index];
        index += 1;
    }
    WireLabel::from_secret_bytes(output)
}

fn double_gf128(input: &[u8; LABEL_BYTES]) -> [u8; LABEL_BYTES] {
    let carry = input[0] >> 7;
    let mut output = [0_u8; LABEL_BYTES];
    let mut index = 0_usize;
    while index + 1 < LABEL_BYTES {
        output[index] = (input[index] << 1) | (input[index + 1] >> 7);
        index += 1;
    }
    output[LABEL_BYTES - 1] = input[LABEL_BYTES - 1] << 1;
    output[LABEL_BYTES - 1] ^= u8::conditional_select(&0, &GF128_REDUCTION, Choice::from(carry));
    output
}

#[derive(Zeroize, ZeroizeOnDrop)]
/// The garbler-owned zero label for one wire.
pub struct GarblerWire {
    zero: WireLabel,
}

impl GarblerWire {
    /// Returns the zero-label translation bit.
    #[inline]
    pub fn selection_bit(&self) -> u8 {
        self.zero.selection_bit().0
    }

    /// Role-private bytes owned by this value.
    pub(crate) const fn from_zero_label(zero: WireLabel) -> Self {
        Self { zero }
    }

    /// Draws fresh private labels for the requested input count.
    pub fn random_batch(count: usize) -> Result<Vec<Self>, getrandom::Error> {
        let byte_count = count
            .checked_mul(LABEL_BYTES)
            .expect("fixed circuit input-label count fits usize");
        let mut bytes = vec![0_u8; byte_count];
        if let Err(error) = getrandom::getrandom(&mut bytes) {
            bytes.zeroize();
            return Err(error);
        }
        let mut wires = Vec::with_capacity(count);
        let mut offset = 0_usize;
        while offset < byte_count {
            let mut label = [0_u8; LABEL_BYTES];
            label.copy_from_slice(&bytes[offset..offset + LABEL_BYTES]);
            wires.push(Self::from_zero_label(WireLabel::from_secret_bytes(label)));
            offset += LABEL_BYTES;
        }
        bytes.zeroize();
        Ok(wires)
    }

    fn active_label(&self, delta: &GlobalDelta, value: WireValue) -> WireLabel {
        let mut active = self.zero.duplicate();
        active.conditional_xor(delta.label(), value.into());
        active
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
/// The evaluator-owned active label for one wire.
pub struct EvaluatorWire {
    active: WireLabel,
}

impl EvaluatorWire {
    /// Returns the active label translation bit.
    #[inline]
    pub fn selection_bit(&self) -> u8 {
        self.active.selection_bit().0
    }

    /// Role-private bytes owned by this value.
    pub(crate) const fn from_active_label(active: WireLabel) -> Self {
        Self { active }
    }

    /// Takes ownership of private active-label bytes.
    pub fn from_secret_bytes(bytes: [u8; LABEL_BYTES]) -> Self {
        Self::from_active_label(WireLabel::from_secret_bytes(bytes))
    }

    /// Appends the private active label to its protocol message.
    pub fn append_secret_bytes(&self, output: &mut Vec<u8>) {
        output.extend_from_slice(self.active.bytes());
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
/// The two masked table entries for one AND gate.
pub struct GarbledAndGate {
    garbler_half: WireLabel,
    evaluator_half: WireLabel,
}

impl GarbledAndGate {
    #[cfg(test)]
    #[inline]
    pub fn encode(&self) -> [u8; AND_GATE_BYTES] {
        let mut encoded = [0_u8; AND_GATE_BYTES];
        encoded[..LABEL_BYTES].copy_from_slice(self.garbler_half.bytes());
        encoded[LABEL_BYTES..].copy_from_slice(self.evaluator_half.bytes());
        encoded
    }

    /// Appends the two masked table entries.
    pub fn append_encoded(&self, encoded: &mut Vec<u8>) {
        encoded.extend_from_slice(self.garbler_half.bytes());
        encoded.extend_from_slice(self.evaluator_half.bytes());
    }

    /// Decodes the fixed-size masked AND table.
    pub fn decode(encoded: &[u8; AND_GATE_BYTES]) -> Self {
        let mut garbler_half = [0_u8; LABEL_BYTES];
        let mut evaluator_half = [0_u8; LABEL_BYTES];
        garbler_half.copy_from_slice(&encoded[..LABEL_BYTES]);
        evaluator_half.copy_from_slice(&encoded[LABEL_BYTES..]);
        Self {
            garbler_half: WireLabel::from_secret_bytes(garbler_half),
            evaluator_half: WireLabel::from_secret_bytes(evaluator_half),
        }
    }
}

/// Role-local half-gates garbling state.
pub struct Garbler {
    hash: FixedAesGarblingHash,
    delta: GlobalDelta,
    domain: SessionDomain,
}

impl Garbler {
    /// Consume the garbler and transfer its offset to final output decoding.
    pub fn into_delta(self) -> GlobalDelta {
        self.delta
    }

    /// Constructs the role-local primitive state.
    pub fn new(delta: GlobalDelta, domain: SessionDomain) -> Self {
        Self {
            hash: FixedAesGarblingHash::new(),
            delta,
            domain,
        }
    }

    /// Selects the active label for one private input bit.
    #[inline]
    pub fn encode(&self, wire: &GarblerWire, value: WireValue) -> EvaluatorWire {
        EvaluatorWire::from_active_label(wire.active_label(&self.delta, value))
    }

    /// Returns both private labels for authenticated input transfer.
    #[inline]
    pub fn encoded_pair(&self, wire: &GarblerWire) -> ([u8; LABEL_BYTES], [u8; LABEL_BYTES]) {
        (
            *wire.active_label(&self.delta, WireValue::ZERO).bytes(),
            *wire.active_label(&self.delta, WireValue::ONE).bytes(),
        )
    }

    /// Computes a free-XOR output wire.
    #[inline]
    pub fn xor(&self, left: &GarblerWire, right: &GarblerWire) -> GarblerWire {
        GarblerWire::from_zero_label(left.zero.xor(&right.zero))
    }

    /// Computes an inverted output wire.
    #[inline]
    pub fn invert(&self, input: &GarblerWire) -> GarblerWire {
        GarblerWire::from_zero_label(input.zero.xor(self.delta.label()))
    }

    /// Produces one AND output and its masked table entries.
    #[inline]
    pub fn garble_and(
        &self,
        gate_ordinal: GateOrdinal,
        left: &GarblerWire,
        right: &GarblerWire,
    ) -> (GarblerWire, GarbledAndGate) {
        let garbler_tweak = GateTweak::new(self.domain, gate_ordinal, HalfGate::Garbler);
        let evaluator_tweak = GateTweak::new(self.domain, gate_ordinal, HalfGate::Evaluator);

        let left_one = left.zero.xor(self.delta.label());
        let right_one = right.zero.xor(self.delta.label());
        let [left_hash_zero, left_hash_one, right_hash_zero, right_hash_one] = self.hash.hash_four(
            [&left.zero, &left_one, &right.zero, &right_one],
            [
                garbler_tweak,
                garbler_tweak,
                evaluator_tweak,
                evaluator_tweak,
            ],
        );

        let mut garbler_half = left_hash_zero.xor(&left_hash_one);
        garbler_half.conditional_xor(self.delta.label(), right.zero.selection_bit());

        let mut garbler_output = left_hash_zero;
        garbler_output.conditional_xor(&garbler_half, left.zero.selection_bit());

        let evaluator_half = right_hash_zero.xor(&right_hash_one).xor(&left.zero);
        let evaluator_choice = evaluator_half.xor(&left.zero);
        let mut evaluator_output = right_hash_zero;
        evaluator_output.conditional_xor(&evaluator_choice, right.zero.selection_bit());

        let output = GarblerWire::from_zero_label(garbler_output.xor(&evaluator_output));
        (
            output,
            GarbledAndGate {
                garbler_half,
                evaluator_half,
            },
        )
    }
}

/// Role-local half-gates evaluation state.
pub struct Evaluator {
    hash: FixedAesGarblingHash,
    domain: SessionDomain,
}

impl Evaluator {
    /// Constructs the role-local primitive state.
    pub fn new(domain: SessionDomain) -> Self {
        Self {
            hash: FixedAesGarblingHash::new(),
            domain,
        }
    }

    /// Computes a free-XOR output wire.
    #[inline]
    pub fn xor(&self, left: &EvaluatorWire, right: &EvaluatorWire) -> EvaluatorWire {
        EvaluatorWire::from_active_label(left.active.xor(&right.active))
    }

    /// Computes an inverted output wire.
    #[inline]
    pub fn invert(&self, input: &EvaluatorWire) -> EvaluatorWire {
        EvaluatorWire::from_active_label(input.active.duplicate())
    }

    /// Evaluates one AND table with active input labels.
    #[inline]
    pub fn evaluate_and(
        &self,
        gate_ordinal: GateOrdinal,
        left: &EvaluatorWire,
        right: &EvaluatorWire,
        table: &GarbledAndGate,
    ) -> EvaluatorWire {
        let garbler_tweak = GateTweak::new(self.domain, gate_ordinal, HalfGate::Garbler);
        let evaluator_tweak = GateTweak::new(self.domain, gate_ordinal, HalfGate::Evaluator);

        let [mut garbler_output, mut evaluator_output] =
            self.hash
                .hash_two(&left.active, garbler_tweak, &right.active, evaluator_tweak);
        garbler_output.conditional_xor(&table.garbler_half, left.active.selection_bit());

        let evaluator_choice = table.evaluator_half.xor(&left.active);
        evaluator_output.conditional_xor(&evaluator_choice, right.active.selection_bit());

        EvaluatorWire::from_active_label(garbler_output.xor(&evaluator_output))
    }
}
