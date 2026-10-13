# Review of the Yao label wipe and four-block AES change

Date: October 13, 2026.

**No introduced Yao protocol invariant violation was found.** This is a scoped
review of commit `ab91d575d46a13be28deccb95660d6517c9164f3` against its parent.
It does not claim a complete cryptographic security proof.

The review used an immutable archive of that commit. Concurrent source edits
were excluded. No deployment or production code change was made.

## Invariants checked

| Invariant | Evidence | Result |
| --- | --- | --- |
| Same fixed-key garbling hash | `passive.rs`: `FixedAesGarblingHash`, `prepare_hash_input`, `finish_hash_output`; unchanged frozen hash answer | Preserved: `AES_K(double(label) XOR tweak) XOR (double(label) XOR tweak)` |
| Separate gate and half-gate domains | `GateTweak::new`, `SessionDomain`, `GateOrdinal`, and `HalfGate` unchanged | Preserved |
| Free-XOR label relation and delta selection bit | `GlobalDelta`, garbler/evaluator logic, and truth-table cases | Preserved |
| Same half-gate table and outputs | Frozen table answer and every permutation-bit pair with generated labels | Passed |
| Same role messages and authorized outputs | Runtime conformance: 12 activation and 12 export cases; public-shape and vector checks | Passed |
| Labels are private, redacted, and wiped | `WireLabel` remains non-`Copy`, with `Zeroize` and `ZeroizeOnDrop`; label test and optimized WebAssembly IR | Preserved for owned label storage |
| No new secret-dependent AES branch or lookup table | Source review, RustCrypto comparison, and optimized probe IR | No such dependency found |

## Independent cipher check

The new module is a reduced copy of RustCrypto `aes` 0.8.4's 64-bit fixslice.
Twenty-five helper bodies match after comments and whitespace are removed.
The adapted schedule and encryption functions remove the compact alternative.
Encryption additionally wraps and wipes its state. Output initialization uses
plain arrays. The MixColumns macro removes its decryption half and retains its
encryption equations.

An additional probe compiles the unchanged `gate_aes.rs` to WebAssembly with
release optimization, fat LTO, and SIMD128. Node executes that module and compares
all output bytes against OpenSSL AES-128-ECB without padding.

**2,000 generated key/input batches passed: 8,000 AES blocks.** These are synthetic
probe cases, separate from the existing FIPS vector, edge-block, and lane tests.
They establish sampled functional agreement, not mathematical equivalence for all inputs.

The reviewed AES branches depend on round counters and fixed bounds. The optimized
probe retains fixed-loop branches and a public output-index bound check. The S-box
uses Boolean operations instead of secret-indexed memory. This does not establish
constant timing for every Cloudflare JIT or hardware implementation.

## Wipe check

`SecretBlock` contains exactly 16 bytes and derives a zero-valued `Default`.
Its `DefaultIsZeroes` implementation therefore satisfies the `zeroize` contract.
The marker's blanket implementation uses a volatile write and an optimization barrier.
`WireLabel` retains automatic wiping on drop. Its debug representation stays redacted.

The optimized production-engine WebAssembly IR retains a volatile 16-byte copy
from a zeroed value, then the barrier. The AES probe likewise retains a volatile
64-byte wipe of the bitsliced state. Thus the optimization removes repeated
per-byte barriers without removing the wipe of these owned values.

“One write” describes the Rust operation. It does not guarantee one machine
instruction or atomicity. Neither the old implementation nor this change guarantees
removal of register spills, compiler-created copies, or microarchitectural traces.
The dependency documents those limits in `zeroize` 1.9.0, “Stack/Heap Zeroing Notes”.

## Repeated checks

All commands ran against the archived commit:

- Engine with `local-protocol`: 68 passed, one statistical timing case ignored;
  11 integration cases and six compile-fail documentation cases also passed.
- Router adapter: ten cases passed.
- `cargo yao-fv vectors-check`.
- `cargo yao-fv runtime-conformance-check`.
- `cargo yao-fv passive-public-shape-check`.
- `cargo yao-fv passive-security-check`.
- `cargo yao-fv anti-drift`.
- Existing optimized-host code-generation assertions for label and IKNP selection.
- Optimized WebAssembly cipher comparison and engine wipe inspection described above.

## Verification limits

The existing constant-time code-generation gate checks label selection and IKNP.
It does not certify the entire new AES routine. This review adds a separate source
and generated-code examination plus a WebAssembly functional comparison.

The passive-security model explicitly excludes timing, memory access, and erasure.
It assumes component security bounds and does not prove production privacy.
See `formal-verification/docs/passive-security-real-ideal-v1.md`, “Claim”,
“Corruption Scope”, and “Remaining Critical Proof”. A passing gate preserves this
conditional result. It does not strengthen it into a full security proof.

The unavailable Aeneas track extracts the reference generator's
`wrapping_add_le_256` and `clamp_rfc8032`. Neither function changed here.
The initial review did not rerun the complete formal-verification suite.
The follow-up below records the subsequent run of every standard track.

## Reproduction

Local raw evidence and scripts: `.artifacts/yao-ab91-review/` in `seams-wallet`.
`check.py` runs the engine, adapter, and protocol checks. `verify-wasm.mjs` compares
the compiled cipher. The folder retains generated IR, disassembly, logs, and
upstream diffs. [Sanitized results](refactor-155h-yao-ab91-review.json) record the
commit, commands, outcome, and WebAssembly digest.


## Follow-up: full formal-verification suite

The October 13 follow-up invoked `cargo yao-fv all` against the same archived
commit. The runner stopped at its clean-checkout check. Every remaining standard
track then ran individually, with no change to the expected results or source.

**12 of 14 standard tracks passed. Two tracks remain blocked by the environment.**
No protocol mismatch or failed proof obligation was reported.

- Lean verified 169 theorems.
- Verus verified 27 obligations with the pinned release.
- Parity passed with 83 production tests and 407 generator tests.
- Reference specifications, vectors, cross-language verification, reconciliation,
  exit-evidence readiness, manifest reproducibility, anti-drift, runtime
  conformance, and public message shapes passed.
- The additional passive-security and constant-time tooling qualification checks passed.

The Phase 2B review-subject track passed its 12 builder tests, then rejected the
checkout state. A frozen archive cannot satisfy its clean Git checkout requirement.
The Aeneas track rejected the absence of its pinned Aeneas tool checkout. The main
repository also lacks the configured tool checkout. These are environment failures.
Neither track is marked as passed.

The aggregate command returned exit code 1. Thus the full suite is **not green**.
Its completion still needs the clean-checkout review and the pinned extraction
toolchain. The existing conditional-security limits above continue to apply.

[Full results](refactor-155h-yao-formal-suite.json) record all 16 attempted tracks,
including the two additional checks. Raw logs and the remaining-track runner are
in `.artifacts/yao-ab91-review/full-suite/`. No live resources changed.
