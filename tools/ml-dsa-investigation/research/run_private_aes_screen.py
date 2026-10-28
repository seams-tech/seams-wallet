#!/usr/bin/env python3
"""Check production private AES against RustCrypto and time its Wasm SIMD kernel."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
AES = Path("crates/two-party-primitives/src/gate_aes.rs")
EIGHT = AES.with_suffix("") / "eight.rs"
CORRELATION = Path("crates/ml-dsa-threshold/src/runtime/boolean_mpc/silent/correlation_aes.rs")

RUST = r'''
// The isolated harness exposes the copied production primitive through its crate path.
extern crate self as two_party_primitives;
pub use crate::passive::gate_aes;
use aes::{
    cipher::{BlockCipherEncrypt, KeyInit},
    Aes128,
};
use zeroize::Zeroizing;
mod baseline;
mod passive {
    mod correlation_aes;
    mod baseline_adapter;
    mod baseline_gate_aes;
    pub mod gate_aes;
    use gate_aes as candidate;

    use super::*;
    fn fill(bytes: &mut [u8], seed: &mut u32) {
        for word in bytes.chunks_mut(4) {
            *seed ^= *seed << 13;
            *seed ^= *seed >> 17;
            *seed ^= *seed << 5;
            word.copy_from_slice(&seed.to_le_bytes());
        }
    }
    #[no_mangle]
    pub extern "C" fn measure(mode: u32, rounds: u32, mut seed: u32, verify: u32) -> u32 {
        let mut key = [0u8; 16];
        fill(&mut key, &mut seed);
        let scalar = baseline::FourBlockAes128::new(&key);
        let four = candidate::FourBlockAes128::new(&key);
        let wide = candidate::EightBlockAes128::from_four(&four);
        let reference = Aes128::new(&key.into());
        let mut checksum = 0u32;
        for _ in 0..rounds {
            let mut input = Zeroizing::new(candidate::EightBlocks::default());
            for block in &mut input.0 {
                fill(block, &mut seed);
            }
            let mut expected = Zeroizing::new([aes::cipher::Block::<Aes128>::default(); 8]);
            if verify != 0 {
                for (dst, src) in expected.iter_mut().zip(input.0.iter()) {
                    dst.copy_from_slice(src);
                }
                reference.encrypt_blocks(&mut expected[..]);
            }
            if mode == 0 {
                for chunk in input.0.chunks_mut(4) {
                    let mut batch = Zeroizing::new(baseline::FourBlocks::default());
                    batch.0.copy_from_slice(chunk);
                    scalar.encrypt_four(&mut batch);
                    chunk.copy_from_slice(&batch.0);
                }
            } else if mode == 1 {
                wide.encrypt_eight(&mut input.0);
            } else {
                for chunk in input.0.chunks_mut(4) {
                    let mut batch = Zeroizing::new(candidate::FourBlocks::default());
                    batch.0.copy_from_slice(chunk);
                    four.encrypt_four(&mut batch);
                    chunk.copy_from_slice(&batch.0);
                }
            }
            for (block, reference) in input.0.iter().zip(expected.iter()) {
                for (&byte, &expected) in block.iter().zip(reference.iter()) {
                    if verify != 0 {
                        assert_eq!(byte, expected);
                    }
                    checksum = checksum.wrapping_mul(31).wrapping_add(u32::from(byte));
                }
            }
        }
        core::hint::black_box(checksum)
    }
    #[no_mangle]
    pub extern "C" fn throughput(mode: u32, rounds: u32, mut seed: u32) -> u32 {
        let mut key = [0u8; 16];
        fill(&mut key, &mut seed);
        let scalar = baseline::FourBlockAes128::new(&key);
        let previous_four = baseline_gate_aes::FourBlockAes128::new(&key);
        let four = candidate::FourBlockAes128::new(&key);
        let wide = candidate::EightBlockAes128::from_four(&four);
        let adapter = correlation_aes::CorrelationAes::new(&key);
        let old_adapter = baseline_adapter::CorrelationAes::new(&key);
        let mut input = Zeroizing::new(candidate::EightBlocks::default());
        for block in &mut input.0 {
            fill(block, &mut seed);
        }
        for _ in 0..rounds {
            if mode == 0 {
                for chunk in input.0.chunks_mut(4) {
                    let mut batch = Zeroizing::new(baseline::FourBlocks::default());
                    batch.0.copy_from_slice(chunk);
                    scalar.encrypt_four(&mut batch);
                    chunk.copy_from_slice(&batch.0);
                }
            } else if mode == 1 {
                wide.encrypt_eight(&mut input.0);
            } else if mode == 3 {
                old_adapter.encrypt(&mut input.0);
            } else if mode == 4 {
                adapter.encrypt(&mut input.0);
            } else if mode == 5 {
                for chunk in input.0.chunks_mut(4) {
                    let mut batch = Zeroizing::new(baseline_gate_aes::FourBlocks::default());
                    batch.0.copy_from_slice(chunk);
                    previous_four.encrypt_four(&mut batch);
                    chunk.copy_from_slice(&batch.0);
                }
            } else {
                for chunk in input.0.chunks_mut(4) {
                    let mut batch = Zeroizing::new(candidate::FourBlocks::default());
                    batch.0.copy_from_slice(chunk);
                    four.encrypt_four(&mut batch);
                    chunk.copy_from_slice(&batch.0);
                }
            }
        }
        let mut checksum = 0u32;
        for block in &input.0 {
            for byte in block {
                checksum = checksum.wrapping_mul(31).wrapping_add(u32::from(*byte));
            }
        }
        core::hint::black_box(checksum)
    }

    #[no_mangle]
    pub extern "C" fn component(mode: u32, rounds: u32, seed: u32) -> u32 {
        let key = [seed as u8; 16];
        let mut checksum = 0u32;
        if mode == 0 {
            for index in 0..rounds {
                let mut changing_key = key;
                changing_key[..4].copy_from_slice(&index.wrapping_add(seed).to_le_bytes());
                core::hint::black_box(candidate::FourBlockAes128::new(&changing_key));
            }
            return core::hint::black_box(rounds);
        }
        let four = candidate::FourBlockAes128::new(&key);
        if mode == 1 {
            for _ in 0..rounds {
                core::hint::black_box(candidate::EightBlockAes128::from_four(
                    core::hint::black_box(&four),
                ));
            }
            return core::hint::black_box(rounds);
        }
        let wide = candidate::EightBlockAes128::from_four(&four);
        let mut blocks = Zeroizing::new(candidate::EightBlocks([[seed as u8; 16]; 8]));
        wide.profile_component(mode, rounds, &mut blocks.0);
        for block in &blocks.0 {
            for byte in block {
                checksum = checksum.wrapping_mul(31).wrapping_add(u32::from(*byte));
            }
        }
        core::hint::black_box(checksum)
    }

    #[no_mangle]
    pub extern "C" fn verify_lengths(mut seed: u32) {
        let mut key = [0u8; 16];
        fill(&mut key, &mut seed);
        let cipher = correlation_aes::CorrelationAes::new(&key);
        let reference = Aes128::new(&key.into());
        for length in 0..=33 {
            let mut input = [[0u8; 16]; 33];
            for block in &mut input {
                fill(block, &mut seed);
            }
            let original = input;
            cipher.encrypt(&mut input[..length]);
            for (index, block) in input.iter().enumerate() {
                let mut expected = aes::cipher::Block::<Aes128>::from(original[index]);
                if index < length {
                    reference.encrypt_block(&mut expected);
                }
                assert_eq!(block.as_slice(), expected.as_slice());
            }
        }
    }
}
'''

COMPONENT_EIGHT = r'''
// Measurement-only methods appended to a temporary copy. Production APIs stay unchanged.
impl EightBlockAes128 {
    pub fn profile_component(&self, mode: u32, rounds: u32, blocks: &mut [[u8; 16]; 8]) {
        let transpose = wide::u8x16::new([0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15]);
        let mut state = zeroize::Zeroizing::new(WideState::default());
        for (word, block) in state.0.iter_mut().zip(&*blocks) {
            *word = wide::u8x16::new(*block).shuffle(transpose);
        }
        orthogonalize(&mut state.0);
        for _ in 0..rounds {
            match mode {
                2 => encrypt_state(core::hint::black_box(&self.keys.0), &mut state.0),
                3 => {
                    for (word, block) in state.0.iter_mut().zip(&*blocks) {
                        *word = wide::u8x16::new(*block).shuffle(transpose);
                    }
                    orthogonalize(&mut state.0);
                    core::hint::black_box(&mut state.0);
                    orthogonalize(&mut state.0);
                    for (block, word) in blocks.iter_mut().zip(&state.0) {
                        *block = word.shuffle(transpose).to_array();
                    }
                    state.zeroize();
                }
                4 => state.zeroize(),
                5 => self.encrypt_eight(blocks),
                _ => panic!("Unknown public component mode"),
            }
            core::hint::black_box(&mut state.0);
        }
        if mode == 2 {
            orthogonalize(&mut state.0);
            for (block, word) in blocks.iter_mut().zip(&state.0) {
                *block = word.shuffle(transpose).to_array();
            }
        }
    }
}
'''

JAVASCRIPT = r'''
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const bytes = await readFile(process.argv[2]);
const {instance: {exports: probe}} = await WebAssembly.instantiate(bytes, {});
for (let seed = 1; seed <= 256; seed++) {
  for (const mode of [0, 1, 2]) probe.measure(mode, 32, seed, 1);
  probe.verify_lengths(seed);
}
for (let repetition = 0; repetition < 10; repetition++) {
  for (const mode of [3, 4, 5, 2]) probe.throughput(mode, 32768, repetition + 1);
}
const samples = [];
for (let repetition = 0; repetition < 20; repetition++) {
  const pair = [];
  for (const mode of repetition % 2 === 0 ? [3, 4, 5, 2] : [2, 5, 4, 3]) {
    const started = performance.now();
    const checksum = probe.throughput(mode, 32768, repetition + 100);
    const row = {mode, repetition, elapsedMs: performance.now() - started, checksum};
    samples.push(row);
    pair.push(row);
  }
  for (const row of pair) assert.equal(row.checksum, pair[0].checksum);

}
const medians = [];
for (const mode of [3, 4, 5, 2]) {
  const times = [];
  for (const sample of samples) if (sample.mode === mode) times.push(sample.elapsedMs);
  times.sort(ascending);
  medians.push((times[9] + times[10]) / 2);
}
const componentNames = [
  'scalar key schedule and drop',
  'widen existing schedule and drop',
  'AES rounds on preconverted state',
  'input/output conversion and state wipe',
  'state wipe only',
  'complete production eight-block call',
];
const componentSamples = [];
const componentRounds = 65536;
for (let warmup = 0; warmup < 4; warmup++) {
  for (let mode = 0; mode < componentNames.length; mode++) {
    probe.component(mode, componentRounds, warmup + 1);
  }
}
for (let repetition = 0; repetition < 12; repetition++) {
  for (let index = 0; index < componentNames.length; index++) {
    const mode = repetition % 2 === 0 ? index : componentNames.length - 1 - index;
    const started = performance.now();
    const checksum = probe.component(mode, componentRounds, repetition + 100);
    componentSamples.push({ mode, repetition, rounds: componentRounds,
      elapsedMs: performance.now() - started, checksum });
  }
}
const components = [];
for (let mode = 0; mode < componentNames.length; mode++) {
  const times = [];
  for (const sample of componentSamples) if (sample.mode === mode) times.push(sample.elapsedMs);
  times.sort(ascending);
  components.push({ mode, name: componentNames[mode],
    medianNsPerCall: 1e6 * (times[5] + times[6]) / (2 * componentRounds) });
}
await writeFile(process.argv[3], JSON.stringify({
  scope: 'Isolated Node Wasm SIMD. Full-byte RustCrypto AES 0.9.1 comparison for 256 keys and 256 blocks per key in each of baseline scalar, production wide, and production scalar. Production CorrelationAes lengths 0..33 also checked for each key, including unchanged suffix. Timing compares the previous complete SIMD AES backend (mode 3) with the current backend (mode 4), using repeated encryption, with checksum outside the loop. Modes 5 and 2 additionally compare the previous and current scalar kernels. No complete Worker speed claim.',
  timingModes: ['baseline SIMD adapter (3)', 'candidate SIMD adapter (4)', 'baseline scalar (5)', 'candidate scalar (2)'],
  componentScope: 'Diagnostic copies expose setup, AES rounds, conversion, and erasure separately. Black-box barriers prevent cancellation. Component times are nonadditive and cannot predict complete preparation. The measurement harness does not modify checked-in sources.',
  components, componentSamples,
  passed: true, node: process.version,
  wasmSha256: createHash('sha256').update(bytes).digest('hex'), samples, medians,
}, null, 2));
console.log({passed: true, medians});
function ascending(left, right) { return left - right; }
'''

MANIFEST = '''
[package]
name = "ml-dsa-aes-screen"
version = "0.1.0"
edition = "2021"
[lib]
crate-type = ["cdylib"]
[dependencies]
wide = "=1.7.1"
aes = { version = "=0.9.1", features = ["zeroize"] }
zeroize = "=1.9.0"
cipher = { version = "=0.5.2", features = ["zeroize"] }
[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"

[features]
simd = []
'''

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def historical_source(revision, paths):
    """Resolve source locations only at the historical Git-object boundary."""
    for path in paths:
        result = subprocess.run(["git", "show", f"{revision}:{path}"], cwd=ROOT, capture_output=True)
        if result.returncode == 0:
            return result.stdout
    raise RuntimeError(f"Missing historical source at {revision}: {paths}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--baseline", default="317aca2b")
    parser.add_argument("--adapter-baseline", default="bf49d67b")
    parser.add_argument("--wasm-output", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="ml-dsa-private-aes-") as directory:
        work = Path(directory)
        source = work / "src"
        (source / "passive/gate_aes").mkdir(parents=True)
        source_copies = [
            (AES, "gate_aes.rs"),
            (EIGHT, "gate_aes/eight.rs"),
            (CORRELATION, "correlation_aes.rs"),
        ]
        for relative, destination in source_copies:
            shutil.copyfile(ROOT / relative, source / "passive" / destination)
        component_source = source / "passive/gate_aes/eight.rs"
        with component_source.open("a") as probe:
            probe.write(COMPONENT_EIGHT)
        baseline = historical_source(args.baseline, [AES, Path("crates/ed25519-yao/src/passive/gate_aes.rs")])
        (source / "baseline.rs").write_bytes(baseline)
        if b"mod eight;" in baseline:
            (source / "baseline").mkdir()
            (source / "baseline/eight.rs").write_bytes(historical_source(args.baseline, [EIGHT]))
        adapter = historical_source(args.adapter_baseline, [
            CORRELATION,
            Path("crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/silent/correlation_aes.rs"),
            Path("crates/ed25519-yao/src/passive/ml_dsa_runtime/boolean_comparison/silent/correlation_aes.rs"),
        ]).decode()
        for historical_import in [
            "crate::passive::gate_aes",
            "ed25519_yao::primitives::gate_aes",
            "two_party_primitives::gate_aes",
        ]:
            adapter = adapter.replace(historical_import, "crate::passive::baseline_gate_aes")
        (source / "passive/baseline_gate_aes").mkdir()
        for relative, destination in [(AES, "baseline_gate_aes.rs"), (EIGHT, "baseline_gate_aes/eight.rs")]:
            previous = Path(str(relative).replace("crates/two-party-primitives/src/", "crates/ed25519-yao/src/passive/"))
            original = historical_source(args.adapter_baseline, [relative, previous])
            original = original.replace(b"ml-dsa-runtime-benchmark", b"simd")
            original = original.replace(b"passive-primitives", b"simd")
            (source / "passive" / destination).write_bytes(original)
        (source / "passive/baseline_adapter.rs").write_text(adapter)
        (source / "lib.rs").write_text(RUST)
        (work / "Cargo.toml").write_text(MANIFEST)
        (work / "run.mjs").write_text(JAVASCRIPT)
        subprocess.run(["rustfmt", "--edition", "2021", "--config", "skip_children=true", str(source / "lib.rs")], check=True)
        environment = dict(os.environ, RUSTFLAGS="-C target-feature=+simd128")
        subprocess.run(["cargo", "build", "--offline", "--release", "--target", "wasm32-unknown-unknown",
                        "--features", "simd"], cwd=work, env=environment, check=True)
        wasm = work / "target/wasm32-unknown-unknown/release/ml_dsa_aes_screen.wasm"
        subprocess.run(["node", str(work / "run.mjs"), str(wasm), str(args.output.resolve())], check=True)
        if args.wasm_output is not None:
            args.wasm_output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(wasm, args.wasm_output)
        result = json.loads(args.output.read_text())
        result["production_source_sha256"] = {
            str(relative): digest(ROOT / relative)
            for relative, _ in source_copies
        }
        result["compiled_component_source_sha256"] = digest(component_source)
        result["harness_source_sha256"] = digest(source / "lib.rs")
        result["manifest_sha256"] = digest(work / "Cargo.toml")
        result["lock_sha256"] = digest(work / "Cargo.lock")
        result["baseline_revision"] = subprocess.check_output(["git", "rev-parse", args.baseline], cwd=ROOT, text=True).strip()
        result["adapter_baseline_revision"] = args.adapter_baseline
        result["baseline_gate_aes_sha256"] = digest(source / "passive/baseline_gate_aes.rs")
        result["baseline_eight_sha256"] = digest(source / "passive/baseline_gate_aes/eight.rs")
        result["adapted_baseline_sha256"] = digest(source / "passive/baseline_adapter.rs")
        result["script_sha256"] = digest(Path(__file__))
        args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
