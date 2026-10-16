#!/usr/bin/env python3
"""Attribute calibrated producer samples using the exact compiled Wasm symbols."""
import argparse
import collections
import json
from pathlib import Path

from summarize_registration_profile import sha256, symbol
from summarize_preparation_baseline import read


def category(stack):
    text = "\n".join(stack)
    if "zeroize[" in text or ("silent::SecretBlocks as " in text and "::drop" in text):
        return "secret_erasure"
    if "cryprot_codes[" in text:
        return "code_matrix_encoding"
    if "::gate_aes::" in text:
        return "private_aes"
    if "curve25519_dalek[" in text:
        return "curve_arithmetic"
    if "::silent::pprf::" in text:
        return "pprf_other"
    if "::prepared::prepare_batch" in text:
        return "preparation_loop_other"
    if stack[0] == "(idle)":
        return "idle"
    return "other"


def summarize(item, symbols):
    profile = item["profile"]
    nodes = {node["id"]: node for node in profile["nodes"]}
    parents = {child: node["id"] for node in nodes.values() for child in node.get("children", [])}
    names = {index: symbol(node["callFrame"], symbols["functions"]) for index, node in nodes.items()}
    categories = collections.Counter()
    leaves = collections.Counter()
    for sample in profile["samples"]:
        stack = []
        current = sample
        while current is not None:
            stack.append(names[current])
            current = parents.get(current)
        categories[category(stack)] += 1
        leaves[stack[0]] += 1
    total = len(profile["samples"])
    return {
        "title": item["title"],
        "total_samples": total,
        "sampled_window_us": profile["endTime"] - profile["startTime"],
        "categories": {name: {"samples": count, "percent": 100 * count / total}
                       for name, count in categories.most_common()},
        "top_self_samples": [{"function": name, "samples": count}
                             for name, count in leaves.most_common(40)],
        "symbolized_nodes": names,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("campaign", type=Path)
    parser.add_argument("build_root", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    campaign = read(args.campaign)
    assert campaign["passed"] and campaign["profilerCalibration"]["passed"]
    profiles = []
    for item in campaign["preparationProfile"]["profiles"]:
        role = item["title"].rsplit("preparer-", 1)[1]
        assert role in ["a", "b"]
        wasm = args.build_root / f"deriver-{role}" / "index_bg.wasm"
        map_path = Path(str(wasm) + ".names.json")
        symbols = json.loads(map_path.read_text())
        assert symbols["wasmSha256"] == sha256(wasm) == campaign["workerWasmSha256"][f"deriver-{role}"]
        profiles.append({"wasm_sha256": sha256(wasm), "symbol_map_sha256": sha256(map_path),
                         **summarize(item, symbols)})
    report = {
        "schema": "seams.ml-dsa-preparation-stage-samples.v1",
        "scope": "Local workerd producer sampling through the first four-batch reserve. Categories are disjoint by stack precedence. Inlined work can remain in preparation_loop_other. Counts are samples, not elapsed or billed CPU. Hosted attribution is unproven.",
        "campaign_sha256": sha256(args.campaign),
        "script_sha256": sha256(Path(__file__)),
        "calibration": campaign["profilerCalibration"],
        "four_batch_refill_ms": campaign["initialFourBatchRefillMs"],
        "profiles": profiles,
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({item["title"]: item["categories"] for item in profiles}))


if __name__ == "__main__":
    main()
