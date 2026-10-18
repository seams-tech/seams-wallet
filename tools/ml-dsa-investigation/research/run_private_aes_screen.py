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
AES = Path("crates/ed25519-yao/src/passive/gate_aes.rs")
EIGHT = AES.with_suffix("") / "eight.rs"
CORRELATION = Path("crates/ed25519-yao/src/passive/ml_dsa_runtime/boolean_comparison/silent/correlation_aes.rs")

RUST = r'''
use aes::{
    cipher::{BlockCipherEncrypt, KeyInit},
    Aes128,
};
use zeroize::Zeroizing;
mod baseline;
mod passive {
    mod correlation_aes;
    mod baseline_adapter;
    pub(crate) mod gate_aes;
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
  for (const mode of [3, 4]) probe.throughput(mode, 32768, repetition + 1);
}
const samples = [];
for (let repetition = 0; repetition < 20; repetition++) {
  const pair = [];
  for (const mode of repetition % 2 === 0 ? [3, 4] : [4, 3]) {
    const started = performance.now();
    const checksum = probe.throughput(mode, 32768, repetition + 100);
    const row = {mode, repetition, elapsedMs: performance.now() - started, checksum};
    samples.push(row);
    pair.push(row);
  }
  assert.equal(pair[0].checksum, pair[1].checksum);

}
const medians = [];
for (const mode of [3, 4]) {
  const times = [];
  for (const sample of samples) if (sample.mode === mode) times.push(sample.elapsedMs);
  times.sort(ascending);
  medians.push((times[9] + times[10]) / 2);
}
await writeFile(process.argv[3], JSON.stringify({
  scope: 'Isolated Node Wasm SIMD. Full-byte RustCrypto AES 0.9.1 comparison for 256 keys and 256 blocks per key in each of baseline scalar, production wide, and production scalar. Production CorrelationAes lengths 0..33 also checked for each key, including unchanged suffix. Timing compares the previous copying adapter (mode 3) with the current borrowed-buffer adapter (mode 4), using repeated encryption, with checksum outside the loop. No complete Worker speed claim.',
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
ml-dsa-runtime-benchmark = []
'''

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--baseline", default="317aca2b")
    parser.add_argument("--adapter-baseline", default="a60af34e")
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
        baseline = subprocess.check_output(["git", "show", f"{args.baseline}:{AES}"], cwd=ROOT)
        (source / "baseline.rs").write_bytes(baseline)
        adapter = subprocess.check_output(["git", "show", f"{args.adapter_baseline}:{CORRELATION}"], cwd=ROOT).decode()
        adapter = adapter.replace("encrypt_eight(&mut batch)", "encrypt_eight(&mut batch.0)")
        (source / "passive/baseline_adapter.rs").write_text(adapter)
        (source / "lib.rs").write_text(RUST)
        (work / "Cargo.toml").write_text(MANIFEST)
        (work / "run.mjs").write_text(JAVASCRIPT)
        subprocess.run(["rustfmt", "--edition", "2021", "--config", "skip_children=true", str(source / "lib.rs")], check=True)
        environment = dict(os.environ, RUSTFLAGS="-C target-feature=+simd128")
        subprocess.run(["cargo", "build", "--offline", "--release", "--target", "wasm32-unknown-unknown",
                        "--features", "ml-dsa-runtime-benchmark"], cwd=work, env=environment, check=True)
        wasm = work / "target/wasm32-unknown-unknown/release/ml_dsa_aes_screen.wasm"
        subprocess.run(["node", str(work / "run.mjs"), str(wasm), str(args.output.resolve())], check=True)
        result = json.loads(args.output.read_text())
        result["production_source_sha256"] = {
            str(relative): digest(source / "passive" / destination)
            for relative, destination in source_copies
        }
        result["harness_source_sha256"] = digest(source / "lib.rs")
        result["manifest_sha256"] = digest(work / "Cargo.toml")
        result["lock_sha256"] = digest(work / "Cargo.lock")
        result["baseline_revision"] = subprocess.check_output(["git", "rev-parse", args.baseline], cwd=ROOT, text=True).strip()
        result["adapter_baseline_revision"] = args.adapter_baseline
        result["adapted_baseline_sha256"] = digest(source / "passive/baseline_adapter.rs")
        result["script_sha256"] = digest(Path(__file__))
        args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
