//! Constant-time comparison of returned labels before releasing decoded bits.
use crate::{ChoiceBit, EvaluatorWire, GarblerWire, GlobalDelta, WireLabel, LABEL_BYTES};

/// Invalid output shape or an active label outside its authenticated pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputDecodingError {
    /// Output labels must have matching byte-aligned counts.
    OutputCount,
    /// At least one returned label matches neither permitted label.
    InvalidOutputLabel,
}

/// Decode all labels, accumulating validity before returning any output.
pub fn decode_output_labels(
    delta: &GlobalDelta,
    output_zero_labels: &[GarblerWire],
    output_labels: &[EvaluatorWire],
) -> Result<Vec<u8>, OutputDecodingError> {
    if output_zero_labels.len() != output_labels.len()
        || !output_zero_labels.len().is_multiple_of(8)
    {
        return Err(OutputDecodingError::OutputCount);
    }
    let mut decoded = vec![0_u8; output_zero_labels.len() / 8];
    let mut invalid = 0_u8;
    let mut index = 0_usize;
    while index < output_zero_labels.len() {
        let zero = &output_zero_labels[index].zero;
        let one = zero.xor(delta.label());
        let active = &output_labels[index].active;
        let is_zero = labels_equal(active, zero);
        let is_one = labels_equal(active, &one);
        invalid |= (is_zero.0 | is_one.0) ^ 1;
        decoded[index / 8] |= is_one.0 << (index % 8);
        index += 1;
    }
    if invalid == 0 {
        Ok(decoded)
    } else {
        Err(OutputDecodingError::InvalidOutputLabel)
    }
}

fn labels_equal(left: &WireLabel, right: &WireLabel) -> ChoiceBit {
    let mut difference = 0_u8;
    let mut index = 0_usize;
    while index < LABEL_BYTES {
        difference |= left.bytes()[index] ^ right.bytes()[index];
        index += 1;
    }
    let nonzero = (difference | difference.wrapping_neg()) >> 7;
    ChoiceBit(nonzero ^ 1)
}
