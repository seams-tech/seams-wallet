# Production scalar arithmetic proofs

Charon and Aeneas extract the actual production `arithmetic/modular.rs` file.
The extraction facade imports it by path. There is no copied arithmetic implementation.
Production NTT and polynomial operations call these same scalar functions.

Lean proves these properties for every input within the stated bounds:

| Function | Input condition | Result |
| --- | --- | --- |
| `reduce_once(v)` | `v < 2q` | `v mod q`, below `q` |
| `add_mod(a, b)` | `a < q` and `b < q` | `(a + b) mod q`, below `q` |
| `subtract_mod(a, b)` | `a < q` and `b < q` | `(a + q - b) mod q`, below `q` |
| `multiply_mod(a, b)` | `a < q` and `b < q` | `(a * b) mod q`, below `q` |

Here `q = 8,380,417`. The extracted computation must return successfully.
The proofs establish that checked arithmetic, shifts, and casts do not fail under these bounds.
Multiplication retains its original three-fold reduction. A separate lemma proves that each fold preserves the residue.

The assumption gate permits only `propext`, `Classical.choice`, and `Quot.sound`.
It rejects `sorryAx`, native-reflection assumptions, and added cryptographic axioms.
Some unused upstream library declarations contain admitted proofs. None occur in these theorem dependencies.

Reuse the repository's existing pinned toolchain. If it is missing, run:

```sh
bash crates/ed25519-yao/formal-verification/lean-boundary/scripts/setup-aeneas.sh
```

Then run:

```sh
python3 crates/ml-dsa-threshold/formal-verification/check.py
```

The check validates tool pins, regenerates extraction in a temporary directory,
rejects unsupported external definitions and generated-source drift, and checks the Lean proofs.
It writes `verification.json` with source hashes, pins, and theorem assumptions.
For an intentional production-source update, regenerate with `--update-generated`, then review the generated diff and proofs.

The trusted boundary includes the Rust frontend, pinned Charon/Aeneas translation,
the scalar models in the pinned Aeneas library, and Lean's kernel.
The proof does not establish NTT correctness, complete FIPS equivalence, distributional privacy,
constant-time execution, memory erasure, or durable storage behavior.
