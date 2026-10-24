#!/usr/bin/env python3
"""Extract production scalar arithmetic, check drift, and verify Lean proofs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import tomllib

HERE = Path(__file__).resolve().parent
SHARED = HERE.parents[1] / "ed25519-yao/formal-verification"
PINS = tomllib.loads((SHARED / "toolchain.toml").read_text())
TOOLS = SHARED / "lean-boundary/tools"


def run(args, cwd=HERE):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update-generated", action="store_true")
    args = parser.parse_args()
    for name in ["aeneas", "charon"]:
        revision = run(["git", "rev-parse", "HEAD"], TOOLS / name).strip()
        if revision != PINS[name]["rev"]:
            raise RuntimeError(f"Wrong {name} revision: {revision}")
    if (HERE / "lean-toolchain").read_text().strip() != PINS["lean"]["toolchain"]:
        raise RuntimeError("Wrong Lean toolchain")
    with tempfile.TemporaryDirectory(prefix="ml-dsa-arithmetic-") as directory:
        temporary = Path(directory)
        llbc = temporary / "ml_dsa_threshold.llbc"
        run([str(TOOLS / "charon/bin/charon"), "rustc", "--preset", "aeneas",
             "--dest-file", str(llbc), "--", "--crate-name", "ml_dsa_threshold",
             "--crate-type", "lib", "--edition", "2021", "--out-dir", str(temporary),
             "rust/modular.rs"])
        encoded = llbc.read_text()
        if encoded.count(str(llbc)) != 1:
            raise RuntimeError("Unexpected extraction destination encoding")
        llbc.write_text(encoded.replace(str(llbc), "ml_dsa_threshold.llbc"))
        run([str(TOOLS / "aeneas/bin/aeneas"), "-backend", "lean", "-dest", str(temporary),
             "-subdir", "MlDsa", "-split-files", str(llbc)])
        generated = temporary / "MlDsa"
        if sorted(path.name for path in generated.iterdir()) != ["Funs.lean", "Types.lean"]:
            raise RuntimeError("Extraction contains unsupported external definitions")
        for name in ["Funs.lean", "Types.lean"]:
            source = (generated / name).read_bytes()
            destination = HERE / "MlDsa" / name
            if args.update_generated:
                destination.write_bytes(source)
            elif destination.read_bytes() != source:
                raise RuntimeError(f"Generated proof input drifted: {name}")
    run(["lake", "build"])
    checked = run(["lake", "env", "lean", "MlDsaProofs.lean"])
    theorem_names = ["reduce_once_spec", "add_mod_spec", "subtract_mod_spec", "multiply_mod_spec"]
    for name in theorem_names:
        if f"MlDsaProofs.{name} checked assumptions:" not in checked:
            raise RuntimeError(f"Missing theorem assumption check: {name}")
    files = ["rust/modular.rs", "MlDsa/Types.lean", "MlDsa/Funs.lean", "MlDsaProofs.lean",
             "lakefile.lean", "lake-manifest.json", "lean-toolchain", "check.py"]
    report = {
        "schema": "seams.ml-dsa-production-arithmetic.v1",
        "passed": True,
        "theorems": theorem_names,
        "allowed_axioms": ["propext", "Classical.choice", "Quot.sound"],
        "production_source": "src/ml_dsa_signing/arithmetic/modular.rs",
        "production_source_sha256": sha(HERE.parent / "src/ml_dsa_signing/arithmetic/modular.rs"),
        "verification_sources": {name: sha(HERE / name) for name in files},
        "tool_pins": {name: PINS[name] for name in ["aeneas", "charon", "lean"]},
        "assumption_checks": checked.strip().splitlines(),
    }
    (HERE / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
