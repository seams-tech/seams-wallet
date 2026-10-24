use core::mem::size_of;
use std::hint::black_box;
use std::time::Instant;

use super::*;

const WIRE_VALUES: [WireValue; 2] = [WireValue::ZERO, WireValue::ONE];
const TIMING_SAMPLE_COUNT: usize = 4_096;
const TIMING_BATCH_SIZE: usize = 512;

#[derive(Clone, Copy)]
struct TimingMoments {
    mean: f64,
    variance: f64,
}

fn timing_moments(samples: &[f64]) -> TimingMoments {
    let count = samples.len() as f64;
    let mean = samples.iter().sum::<f64>() / count;
    let squared_deviation = samples
        .iter()
        .map(|sample| {
            let deviation = sample - mean;
            deviation * deviation
        })
        .sum::<f64>();
    TimingMoments {
        mean,
        variance: squared_deviation / (count - 1.0),
    }
}

fn welch_t_statistic(left: &[f64], right: &[f64]) -> f64 {
    let left_moments = timing_moments(left);
    let right_moments = timing_moments(right);
    let denominator = (left_moments.variance / left.len() as f64
        + right_moments.variance / right.len() as f64)
        .sqrt();
    if denominator == 0.0 {
        0.0
    } else {
        (left_moments.mean - right_moments.mean) / denominator
    }
}

fn measure_conditional_xor_batch(choice: ChoiceBit) -> f64 {
    let other = WireLabel::from_test_bytes([0xa5; LABEL_BYTES]);
    let started_at = Instant::now();
    let mut accumulator = 0_u8;
    for iteration in 0..TIMING_BATCH_SIZE {
        let mut target = WireLabel::from_test_bytes([(iteration & 0xff) as u8; LABEL_BYTES]);
        target.conditional_xor(black_box(&other), black_box(choice));
        accumulator ^= target.test_bytes()[iteration % LABEL_BYTES];
    }
    black_box(accumulator);
    started_at.elapsed().as_nanos() as f64
}

fn collect_conditional_xor_timing_samples() -> (Vec<f64>, Vec<f64>) {
    let mut zero_samples = Vec::with_capacity(TIMING_SAMPLE_COUNT);
    let mut one_samples = Vec::with_capacity(TIMING_SAMPLE_COUNT);
    for sample_index in 0..TIMING_SAMPLE_COUNT {
        if sample_index & 1 == 0 {
            zero_samples.push(measure_conditional_xor_batch(ChoiceBit(0)));
            one_samples.push(measure_conditional_xor_batch(ChoiceBit(1)));
        } else {
            one_samples.push(measure_conditional_xor_batch(ChoiceBit(1)));
            zero_samples.push(measure_conditional_xor_batch(ChoiceBit(0)));
        }
    }
    (zero_samples, one_samples)
}

fn wire_value(bit: u8) -> WireValue {
    if bit == 0 {
        WireValue::ZERO
    } else {
        WireValue::ONE
    }
}

fn label(marker: u8, selection: WireValue) -> WireLabel {
    let mut bytes = [marker; LABEL_BYTES];
    bytes[LABEL_BYTES - 1] = (marker & 0xfe) | selection.as_u8();
    WireLabel::from_test_bytes(bytes)
}

fn next_test_bytes(state: &mut u64) -> [u8; LABEL_BYTES] {
    let mut output = [0_u8; LABEL_BYTES];
    let mut offset = 0_usize;
    while offset < LABEL_BYTES {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        output[offset..offset + 8].copy_from_slice(&state.to_be_bytes());
        offset += 8;
    }
    output
}

fn assert_active_label(
    output: &EvaluatorWire,
    zero: &GarblerWire,
    delta: &GlobalDelta,
    value: WireValue,
) {
    let expected = zero.active_label(delta, value);
    assert_eq!(output.active.test_bytes(), expected.test_bytes());
}

#[test]
fn labels_are_fixed_size_zeroizing_and_redacted() {
    assert_eq!(size_of::<WireLabel>(), LABEL_BYTES);
    assert!(core::mem::needs_drop::<WireLabel>());
    let mut wire = WireLabel::from_test_bytes([0xa5; LABEL_BYTES]);
    assert_eq!(format!("{wire:?}"), "WireLabel([REDACTED])");
    wire.zeroize();
    assert_eq!(wire.test_bytes(), &[0_u8; LABEL_BYTES]);

    let random = GarblerWire::random_batch(1).expect("OS randomness");
    assert_eq!(random[0].zero.test_bytes().len(), LABEL_BYTES);
}

#[test]
#[ignore = "bounded local statistical timing assurance"]
fn conditional_xor_choice_has_no_large_timing_class_separation() {
    for _ in 0..1_024 {
        black_box(measure_conditional_xor_batch(ChoiceBit(0)));
        black_box(measure_conditional_xor_batch(ChoiceBit(1)));
    }
    let (zero_samples, one_samples) = collect_conditional_xor_timing_samples();
    let t_statistic = welch_t_statistic(&zero_samples, &one_samples);
    println!("conditional_xor Welch t-statistic: {t_statistic:.3}");
    assert!(
        t_statistic.is_finite() && t_statistic.abs() < 10.0,
        "conditional_xor timing classes separated with Welch t={t_statistic:.3}"
    );
}

#[test]
fn delta_and_tweaks_freeze_select_and_uniqueness_rules() {
    let delta = GlobalDelta::from_test_bytes([0x42; LABEL_BYTES]);
    assert_eq!(delta.label().selection_bit().as_u8(), 1);
    let random_delta = GlobalDelta::random().expect("OS randomness");
    assert_eq!(random_delta.label().selection_bit().as_u8(), 1);
    assert_ne!(SessionDomain::random().expect("OS randomness").0, 0);

    let domain = SessionDomain::from_test_value(7).expect("nonzero domain");
    assert!(SessionDomain::from_test_value(0).is_none());
    let ordinal = GateOrdinal::from_schedule_index(9).expect("valid ordinal");
    let next_ordinal = GateOrdinal::from_schedule_index(10).expect("valid ordinal");
    let garbler = GateTweak::new(domain, ordinal, HalfGate::Garbler);
    let evaluator = GateTweak::new(domain, ordinal, HalfGate::Evaluator);
    let next = GateTweak::new(domain, next_ordinal, HalfGate::Garbler);
    assert_ne!(garbler, evaluator);
    assert_ne!(garbler, next);
    assert_eq!(garbler.0, [0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 18]);
    assert!(GateOrdinal::from_schedule_index(1_u64 << 63).is_none());
}

#[test]
fn fixed_aes_hash_has_frozen_known_answer() {
    let hash = FixedAesGarblingHash::new();
    let tweak = GateTweak::new(
        SessionDomain::from_test_value(0x0102_0304_0506_0708).expect("domain"),
        GateOrdinal::from_schedule_index(0x090a_0b0c_0d0e_0f10).expect("ordinal"),
        HalfGate::Evaluator,
    );
    let output = hash.hash(&WireLabel::from_test_bytes([0x11; LABEL_BYTES]), tweak);
    assert_eq!(
        output.test_bytes(),
        &[
            0x12, 0x12, 0x53, 0xf8, 0xa1, 0x1e, 0x35, 0xb1, 0x94, 0x5e, 0x36, 0xf1, 0x08, 0x39,
            0x31, 0x8c,
        ]
    );
}

#[test]
fn free_xor_and_inversion_cover_their_truth_tables() {
    let delta = GlobalDelta::from_test_bytes([0x81; LABEL_BYTES]);
    let domain = SessionDomain::from_test_value(1).expect("domain");
    let garbler = Garbler::new(delta, domain);
    let evaluator = Evaluator::new(domain);
    let left = GarblerWire::from_zero_label(label(0x20, WireValue::ONE));
    let right = GarblerWire::from_zero_label(label(0x40, WireValue::ZERO));
    let xor_output = garbler.xor(&left, &right);

    for left_value in WIRE_VALUES {
        for right_value in WIRE_VALUES {
            let left_active = garbler.encode(&left, left_value);
            let right_active = garbler.encode(&right, right_value);
            let output = evaluator.xor(&left_active, &right_active);
            assert_active_label(
                &output,
                &xor_output,
                &garbler.delta,
                wire_value(left_value.as_u8() ^ right_value.as_u8()),
            );
        }
    }

    let inverted = garbler.invert(&left);
    for value in WIRE_VALUES {
        let active = garbler.encode(&left, value);
        let output = evaluator.invert(&active);
        assert_active_label(
            &output,
            &inverted,
            &garbler.delta,
            wire_value(value.as_u8() ^ 1),
        );
    }
}

#[test]
fn half_gates_known_answer_freezes_table_and_all_outputs() {
    let delta = GlobalDelta::from_test_bytes([0xd2; LABEL_BYTES]);
    let domain = SessionDomain::from_test_value(0x1020_3040_5060_7080).expect("domain");
    let garbler = Garbler::new(delta, domain);
    let evaluator = Evaluator::new(domain);
    let left = GarblerWire::from_zero_label(label(0x12, WireValue::ONE));
    let right = GarblerWire::from_zero_label(label(0x34, WireValue::ONE));
    let ordinal = GateOrdinal::from_schedule_index(17).expect("ordinal");
    let (output_zero, table) = garbler.garble_and(ordinal, &left, &right);
    assert_eq!(
        output_zero.zero.test_bytes(),
        &[
            0xb1, 0xee, 0xf2, 0x3c, 0xa5, 0xff, 0xa1, 0x38, 0xef, 0xaa, 0x49, 0xb4, 0xb3, 0xfa,
            0x50, 0xdc,
        ]
    );
    let encoded = table.encode();
    assert_eq!(
        encoded,
        [
            0xfb, 0x2f, 0x1f, 0x74, 0x99, 0x72, 0x26, 0x9c, 0xf0, 0x0c, 0x34, 0x86, 0x04, 0xfa,
            0xaa, 0x07, 0x9a, 0x51, 0x90, 0x7b, 0xa1, 0x7c, 0xaf, 0xfc, 0x1d, 0x33, 0xd9, 0xe8,
            0xb0, 0x3d, 0xc1, 0x08,
        ]
    );
    let decoded = GarbledAndGate::decode(&encoded);

    for left_value in WIRE_VALUES {
        for right_value in WIRE_VALUES {
            let left_active = garbler.encode(&left, left_value);
            let right_active = garbler.encode(&right, right_value);
            let output = evaluator.evaluate_and(ordinal, &left_active, &right_active, &decoded);
            assert_active_label(
                &output,
                &output_zero,
                &garbler.delta,
                wire_value(left_value.as_u8() & right_value.as_u8()),
            );
        }
    }
}

#[test]
fn half_gates_covers_every_permutation_bit_pair_and_randomized_labels() {
    let mut state = 0x8f31_2a4b_09d7_e6c5_u64;
    let mut case = 0_u64;
    while case < 128 {
        let delta = GlobalDelta::from_test_bytes(next_test_bytes(&mut state));
        let domain = SessionDomain::from_test_value(case + 1).expect("domain");
        let garbler = Garbler::new(delta, domain);
        let evaluator = Evaluator::new(domain);
        let left_selection = wire_value((case & 1) as u8);
        let right_selection = wire_value(((case >> 1) & 1) as u8);
        let mut left_bytes = next_test_bytes(&mut state);
        let mut right_bytes = next_test_bytes(&mut state);
        left_bytes[LABEL_BYTES - 1] = (left_bytes[LABEL_BYTES - 1] & 0xfe) | left_selection.as_u8();
        right_bytes[LABEL_BYTES - 1] =
            (right_bytes[LABEL_BYTES - 1] & 0xfe) | right_selection.as_u8();
        let left = GarblerWire::from_zero_label(WireLabel::from_test_bytes(left_bytes));
        let right = GarblerWire::from_zero_label(WireLabel::from_test_bytes(right_bytes));
        let ordinal = GateOrdinal::from_schedule_index(case).expect("ordinal");
        let (output_zero, table) = garbler.garble_and(ordinal, &left, &right);

        for left_value in WIRE_VALUES {
            for right_value in WIRE_VALUES {
                let left_active = garbler.encode(&left, left_value);
                let right_active = garbler.encode(&right, right_value);
                let output = evaluator.evaluate_and(ordinal, &left_active, &right_active, &table);
                assert_active_label(
                    &output,
                    &output_zero,
                    &garbler.delta,
                    wire_value(left_value.as_u8() & right_value.as_u8()),
                );
            }
        }
        case += 1;
    }
}
