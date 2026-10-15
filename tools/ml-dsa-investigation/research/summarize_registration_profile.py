#!/usr/bin/env python3
"""Symbolize local registration CPU samples without treating them as elapsed CPU time."""
import argparse
import collections
import hashlib
import json
import pathlib
import re


def load(path):
    return json.loads(path.read_text())


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def symbol(frame, names):
    name = frame["functionName"]
    match = re.fullmatch(r"wasm-function\[(\d+)\]", name)
    if match:
        if match[1] not in names:
            raise ValueError(f"Missing Wasm symbol {match[1]}")
        return names[match[1]]
    return name


def summarize(profile_path, symbols):
    profile = load(profile_path)
    nodes = {node["id"]: node for node in profile["nodes"]}
    parents = {child: node["id"] for node in profile["nodes"] for child in node.get("children", [])}
    names = {key: symbol(node["callFrame"], symbols["functions"]) for key, node in nodes.items()}
    categories = collections.Counter()
    self_samples = collections.Counter()
    for sample in profile["samples"]:
        stack = []
        cursor = sample
        while cursor in nodes:
            stack.append(names[cursor])
            cursor = parents.get(cursor)
        text = "\n".join(stack)
        self_samples[stack[0]] += 1
        if "::aead::Aes256Gcm" in text:
            categories["hpke_aes_gcm_suite_inclusive"] += 1
        if "::aead::ChaCha20Poly1305" in text:
            categories["hpke_chacha_suite_inclusive"] += 1
        if "::SealingAead>::open" in text or "::SealingAead>::seal" in text:
            categories["storage_aead_primitive_inclusive"] += 1
        if "PreparedCircuit>::run" in text:
            categories["garbled_circuit_run_inclusive"] += 1
        if "registration::adapter::Adapter" in text and "::load::" in text:
            categories["table_load_inclusive"] += 1
        if stack[0] in ["get", "put", "delete"]:
            categories["storage_js_leaf"] += 1
        if stack[0] == "(idle)":
            categories["idle"] += 1
    total = len(profile["samples"])
    top = []
    for name, count in self_samples.most_common(30):
        top.append({"function": name, "samples": count})
    return {
        "profile_sha256": sha256(profile_path),
        "total_samples": total,
        "categories": {key: {"samples": count, "percent_of_all_samples": round(100 * count / total, 2)}
                       for key, count in sorted(categories.items())},
        "top_self_samples": top,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("symbols", type=pathlib.Path)
    parser.add_argument("wasm", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("profiles", type=pathlib.Path, nargs="+")
    parser.add_argument("--e2e", type=pathlib.Path, required=True)
    args = parser.parse_args()
    symbols = load(args.symbols)
    assert symbols["wasmSha256"] == sha256(args.wasm), "Symbols belong to another Wasm build"
    campaign = load(args.e2e)
    assert campaign["builds"]["deriver-b"] == symbols["wasmSha256"], "E2E used another Wasm build"
    assert campaign["profilerCalibration"]["passed"], "Profiler calibration did not pass"
    report = {
        "schema": "seams.ml-dsa-registration-cpu-samples.v1",
        "scope": "Local workerd participant B during complete registration, including stock installation and incidental cleanup. Categories overlap. Counts are statistical samples, not CPU milliseconds or hosted latency. Each profile needs a successful separate calibration.",
        "wasm_sha256": symbols["wasmSha256"],
        "symbol_map_sha256": sha256(args.symbols),
        "e2e_sha256": sha256(args.e2e),
        "profiles": [summarize(path, symbols) for path in args.profiles],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Saved {len(report['profiles'])} verified profile summaries")


if __name__ == "__main__":
    main()
