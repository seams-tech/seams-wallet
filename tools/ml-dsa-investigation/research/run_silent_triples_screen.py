#!/usr/bin/env python3
"""Record bounded native SilentOtTriple experiments with real base OT."""

import argparse
import datetime
import hashlib
import json
import pathlib
import platform
import subprocess


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def commit(path):
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("build", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    binary = args.build / "ml_dsa_triples_screen"
    harness = args.source / "silent_triples_screen.cpp"
    cache = args.build / "CMakeCache.txt"
    cases = []
    counts = [65536, 65539] + [65536] * 3 + [262144] * 3 + [1048576] * 3
    for index, count in enumerate(counts):
        sample = json.loads(subprocess.check_output([str(binary), str(count)], text=True))
        assert sample["requested_triples"] == count
        assert sample["generated_triples"] == (count + 127) // 128 * 128
        assert sample["fresh_base_ot"] and sample["profile_selected_before_base_ot"]
        assert sample["triple_invariant_verified"] and sample["shared_and_verified"]
        assert sample["mult_type"] == "ExConv7x24"
        assert sample["security_parameter_bits"] == 128
        assert sample["noise_distribution"] == "regular"
        assert all(value > 0 for value in sample["base_sent_bytes"])
        sample.update(index=index, warmup=index == 0, padding_case=index == 1)
        cases.append(sample)
    dependencies = []
    for directory in ["cryptoTools", "coproto", "macoro", "function2", "libdivide"]:
        path = args.source / "out" / directory
        if directory == "cryptoTools":
            path = args.source / directory
        dependencies.append({"directory": directory, "commit": commit(path)})
    report = {
        "schema": "seams.ml-dsa-silent-triples-native-screen.v1",
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "production_eligible": False,
        "source_repository": "https://github.com/osu-crypto/libOTe",
        "source_commit": commit(args.source),
        "dependencies": dependencies,
        "host": platform.platform(),
        "binary": {"path": str(binary), "sha256": sha256(binary)},
        "harness": {"path": str(harness), "sha256": sha256(harness)},
        "cmake_cache": {"path": str(cache), "sha256": sha256(cache)},
        "cases": cases,
        "scope": (
            "Two logical parties in one native process with independent OS-seeded randomness, "
            "genuine base OT, explicit ExConv7x24 before base setup, regular noise, and local "
            "coroutine sockets. Counts include base setup and expansion. Every triple and an "
            "independent shared AND are checked after timing. Process peak RSS covers both "
            "roles and excludes Worker overhead. No ML-DSA signing or Wasm performance claim."
        ),
        "assumptions": "Selected silent OT adds the published LPN assumption; Silver is excluded.",
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    for sample in cases:
        print(sample["requested_triples"], sample["total_ms"], sum(sample["total_sent_bytes"]),
              sample["two_role_process_peak_rss_bytes"])


if __name__ == "__main__":
    main()
