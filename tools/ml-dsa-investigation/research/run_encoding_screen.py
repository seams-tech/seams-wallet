#!/usr/bin/env python3
"""Compare complete production ExConv encoders in one Wasm module."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
VENDOR = ROOT / "crates/ed25519-yao/vendor"
SOURCE = VENDOR / "cryprot-codes/src/ex_conv.rs"

RUST = r'''
pub use cryprot_codes::Coeff;
use cryprot_core::Block;
mod baseline;

fn input(size: usize, seed: u32) -> Vec<Block> {
    let mut values = Vec::with_capacity(size);
    for index in 0..size {
        values.push(Block::from([
            (index as u64).wrapping_mul(0x9e3779b97f4a7c15) ^ u64::from(seed),
            (!(index as u64)).wrapping_mul(0x517cc1b727220a95),
        ]));
    }
    values
}

#[unsafe(no_mangle)]
pub extern "C" fn check(size: usize, seed: u32, accumulator: usize, twice: bool) {
    let matrix_seed = Block::from([u64::from(seed), !u64::from(seed)]);
    let old = baseline::ExConvCode::new_with_conf(size, baseline::ExConvCodeConfig {
        seed: matrix_seed, accumulator_size: accumulator, acc_twice: twice,
        ..Default::default()
    });
    let new = cryprot_codes::ExConvCode::new_with_conf(size, cryprot_codes::ExConvCodeConfig {
        seed: matrix_seed, accumulator_size: accumulator, acc_twice: twice,
        ..Default::default()
    });
    let mut left = input(2 * size, seed);
    let mut right = left.clone();
    old.dual_encode(&mut left);
    new.dual_encode(&mut right);
    assert_eq!(left, right);
    let mut left_bytes = vec![(seed & 255) as u8; 2 * size];
    let mut right_bytes = left_bytes.clone();
    old.dual_encode(&mut left_bytes);
    new.dual_encode(&mut right_bytes);
    assert_eq!(left_bytes, right_bytes);
}

#[unsafe(no_mangle)]
pub extern "C" fn measure(mode: u32, size: usize, seed: u32) -> u32 {
    let mut values = input(2 * size, seed);
    if mode == 0 {
        baseline::ExConvCode::new(size).dual_encode(&mut values);
    } else {
        cryprot_codes::ExConvCode::new(size).dual_encode(&mut values);
    }
    let mut checksum = 0u32;
    for value in values {
        for byte in bytemuck::bytes_of(&value) {
            checksum = checksum.wrapping_mul(31).wrapping_add(u32::from(*byte));
        }
    }
    core::hint::black_box(checksum)
}
'''

JS = r'''
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const bytes = await readFile(process.argv[2]);
const module = await WebAssembly.compile(bytes);
const imports = {};
for (const entry of WebAssembly.Module.imports(module)) {
  assert.equal(entry.kind, 'function');
  imports[entry.module] ??= {};
  imports[entry.module][entry.name] = unexpectedImport;
}
function unexpectedImport() { throw new Error('The deterministic encoder called a host import.'); }
const {exports: probe} = await WebAssembly.instantiate(module, imports);
let checks = 0;
for (const size of [256, 1024, 4096, 524288]) {
  for (const seed of [1, 17, 65537]) {
    for (const accumulator of [8, 17, 24, 32]) {
      for (const twice of [0, 1]) {
        probe.check(size, seed, accumulator, twice);
        checks++;
      }
    }
  }
}
for (let warmup = 0; warmup < 4; warmup++) {
  probe.measure(0, 524288, warmup);
  probe.measure(1, 524288, warmup);
}
const samples = [];
for (let repetition = 0; repetition < 20; repetition++) {
  const pair = [];
  for (const mode of repetition % 2 === 0 ? [0, 1] : [1, 0]) {
    const started = performance.now();
    const checksum = probe.measure(mode, 524288, repetition);
    const sample = {mode, repetition, elapsedMs: performance.now() - started, checksum};
    samples.push(sample);
    pair.push(sample);
  }
  assert.equal(pair[0].checksum, pair[1].checksum);
}
const medians = [];
for (const mode of [0, 1]) {
  const times = [];
  for (const sample of samples) if (sample.mode === mode) times.push(sample.elapsedMs);
  times.sort(ascending);
  medians.push((times[9] + times[10]) / 2);
}
function ascending(left, right) { return left - right; }
const result = {
  scope: 'Isolated Node Wasm SIMD complete ExConv encoder, including allocation and checksum. Each check compares all Block and byte outputs. No complete Worker claim.',
  passed: true, checks, node: process.version, samples, medians,
  wasmSha256: createHash('sha256').update(bytes).digest('hex'),
};
await writeFile(process.argv[3], JSON.stringify(result, null, 2));
console.log({passed: true, checks, medians});
'''


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--baseline", default="a60af34e")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="ml-dsa-encoding-") as directory:
        work = Path(directory)
        source = work / "src"
        source.mkdir()
        shutil.copytree(SOURCE.with_suffix(""), source / "baseline")
        relative = SOURCE.relative_to(ROOT)
        original = subprocess.check_output(["git", "show", f"{args.baseline}:{relative}"], cwd=ROOT)
        (source / "baseline.rs").write_bytes(original)
        (source / "lib.rs").write_text(RUST)
        (work / "run.mjs").write_text(JS)
        (work / "Cargo.toml").write_text(f'''
[package]
name = "ml-dsa-encoding-screen"
version = "0.1.0"
edition = "2024"
[lib]
crate-type = ["cdylib"]
[dependencies]
cryprot-codes = {{ path = "{VENDOR / 'cryprot-codes'}" }}
cryprot-core = {{ path = "{VENDOR / 'cryprot-core'}" }}
bytemuck = "1.25.0"
fastdivide = "0.4.2"
aes = {{ version = "=0.9.1", features = ["hazmat"] }}
rand = "0.10.0"
seq-macro = "=0.3.6"
getrandom = {{ version = "=0.4.3", features = ["wasm_js"] }}
[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
''')
        environment = dict(os.environ, RUSTFLAGS="-C target-feature=+simd128")
        subprocess.run(["cargo", "build", "--offline", "--release", "--target", "wasm32-unknown-unknown"],
                       cwd=work, env=environment, check=True)
        wasm = work / "target/wasm32-unknown-unknown/release/ml_dsa_encoding_screen.wasm"
        subprocess.run(["node", str(work / "run.mjs"), str(wasm), str(args.output.resolve())], check=True)
        result = json.loads(args.output.read_text())
        result["baseline_revision"] = subprocess.check_output(["git", "rev-parse", args.baseline], cwd=ROOT, text=True).strip()
        result["production_source_sha256"] = digest(SOURCE)
        result["baseline_source_sha256"] = digest(source / "baseline.rs")
        result["harness_source_sha256"] = digest(source / "lib.rs")
        result["lock_sha256"] = digest(work / "Cargo.lock")
        result["script_sha256"] = digest(Path(__file__))
        args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
