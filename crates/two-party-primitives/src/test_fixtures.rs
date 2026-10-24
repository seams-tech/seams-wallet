//! Deterministic public fixtures for cross-crate wire-equivalence tests.
//! This module is enabled only by a development dependency.
use crate::{GarblerWire, GlobalDelta, WireLabel, LABEL_BYTES};

/// Construct a fixed public-fixture offset with the required low bit.
pub fn global_delta(bytes: [u8; LABEL_BYTES]) -> GlobalDelta {
    GlobalDelta::from_test_bytes(bytes)
}

/// Construct a fixed public-fixture zero label.
pub fn garbler_wire(bytes: [u8; LABEL_BYTES]) -> GarblerWire {
    GarblerWire::from_zero_label(WireLabel::from_secret_bytes(bytes))
}
