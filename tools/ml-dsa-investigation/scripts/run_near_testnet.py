#!/usr/bin/env python3
"""Repeat the disposable ML-DSA threshold transaction on NEAR testnet."""

import argparse
import base64
import hashlib
import json
import subprocess
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RPC = "https://rpc.testnet.near.org"
FAUCET = "https://helper.testnet.near.org/account"
ACCOUNT = "ml-dsa-e2e-20261014-bb976cccc038.testnet"
FIXTURE = ROOT / "docs/evidence/ml-dsa-65-request-binding-host-20261014.json"
BINARY = ROOT / "tools/ml-dsa-investigation/target/release/ml-dsa-investigation"


def save(report, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")


def call(report, output, endpoint, payload):
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    entry = {"endpoint": endpoint, "request": payload}
    report["requests"].append(entry)
    save(report, output)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            entry["http_status"] = response.status
            entry["response"] = json.load(response)
    except urllib.error.HTTPError as error:
        entry["http_status"] = error.code
        entry["response_text"] = error.read().decode()
        if error.code == 400:
            entry["response"] = json.loads(entry["response_text"])
            save(report, output)
            return entry["response"]
        save(report, output)
        raise
    except Exception as error:
        entry["transport_error"] = str(error)
        save(report, output)
        raise
    save(report, output)
    return entry["response"]


def rpc(report, output, method, params):
    return call(report, output, RPC, {
        "jsonrpc": "2.0", "id": "ml-dsa-disposable-testnet", "method": method, "params": params,
    })


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def base58(value):
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    number = int.from_bytes(value, "big")
    encoded = ""
    while number:
        number, digit = divmod(number, 58)
        encoded = alphabet[digit] + encoded
    return "1" * (len(value) - len(value.lstrip(b"\0"))) + encoded


def run(report, output):
    fixture = json.loads(FIXTURE.read_text())
    zero = next(case for case in fixture["private_key_generation"]["cases"] if case["case"] == "zero")
    public_key = zero["offline_sdk_near_transaction"]["public_key"]
    public_bytes = bytes.fromhex(zero["role_a"]["public_key_hex"])
    require(len(public_bytes) == 1952, "Invalid public fixture key length.")
    require(public_key == "ml-dsa-65:" + base58(public_bytes), "Fixture public-key encodings disagree.")
    handle = "ml-dsa-65-hash:" + base58(hashlib.sha3_256(
        b"near:ml-dsa-65-pubkey-hash:v1" + public_bytes,
    ).digest())
    report["account_id"] = ACCOUNT
    report["public_key"] = public_key
    report["access_key_handle"] = handle
    status = rpc(report, output, "status", [])
    require(status["result"]["chain_id"] == "testnet", "RPC is not testnet.")
    config = rpc(report, output, "EXPERIMENTAL_protocol_config", {"finality": "final"})
    require(config["result"]["protocol_version"] >= 85, "ML-DSA protocol feature gate is inactive.")
    account = rpc(report, output, "query", {
        "request_type": "view_account", "account_id": ACCOUNT, "finality": "final",
    })
    if account.get("error", {}).get("cause", {}).get("name") == "UNKNOWN_ACCOUNT":
        enrollment = call(report, output, FAUCET, {
            "newAccountId": ACCOUNT, "newAccountPublicKey": public_key,
        })
        require("SuccessValue" in enrollment.get("status", {}), "Faucet account creation did not succeed.")
        finalized = rpc(report, output, "tx", {
            "tx_hash": enrollment["transaction"]["hash"],
            "sender_account_id": enrollment["transaction"]["signer_id"], "wait_until": "FINAL",
        })
        require("SuccessValue" in finalized.get("result", {}).get("status", {}), "Enrollment finality is unconfirmed.")
    else:
        require("result" in account, "Account existence is inconclusive. No faucet request sent.")
    keys = rpc(report, output, "query", {
        "request_type": "view_access_key_list", "account_id": ACCOUNT, "finality": "final",
    })["result"]
    require(any(key["public_key"] == handle for key in keys["keys"]), "Key list does not contain the expected hash handle.")
    common = {"request_type": "view_access_key", "account_id": ACCOUNT, "block_id": keys["block_hash"]}
    full = rpc(report, output, "query", dict(common, public_key=public_key))
    hashed = rpc(report, output, "query", dict(common, public_key=handle))
    require("result" in full, "RPC rejected the enrolled full public key.")
    require(hashed.get("error", {}).get("code") == -32700
            and hashed["error"]["cause"]["name"] == "PARSE_ERROR",
            "Hash-handle query did not produce the expected parser rejection.")
    listed_key = next(key for key in keys["keys"] if key["public_key"] == handle)
    require(listed_key["access_key"]["nonce"] == full["result"]["nonce"], "List and full-key query nonce disagree.")
    report["rpc_key_contract"] = {
        "key_list_returns_hash_handle": True,
        "single_key_query_accepts_full_public_key": True,
        "single_key_query_rejects_hash_handle": True,
    }
    request = {
        "signer_id": ACCOUNT, "public_key": public_key,
        "nonce": full["result"]["nonce"] + 1, "block_hash": keys["block_hash"],
    }
    report["signing_request"] = request
    print("RPC key checks passed. Generate shares and threshold-sign the disposable transaction.", flush=True)
    with tempfile.TemporaryDirectory(prefix="ml-dsa-testnet-") as directory:
        request_path = Path(directory) / "public-request.json"
        signing_path = Path(directory) / "public-signing-report.json"
        request_path.write_text(json.dumps(request))
        subprocess.run([str(BINARY), "sign-near-testnet", str(request_path), str(signing_path)], cwd=ROOT, check=True)
        report["signing"] = json.loads(signing_path.read_text())
    signed = report["signing"]["result"]["testnet_transaction"]
    require(signed["public_key_handle"] == handle and signed["sdk_handle_boundary_checks_passed"], "SDK handle differs from the RPC key list.")
    require(signed["signer_id"] == ACCOUNT and signed["receiver_id"] == ACCOUNT, "Signer or receiver differs from the test account.")
    require(signed["nonce"] == request["nonce"] and signed["deposit_yocto_near"] == "1", "Unexpected disposable transaction action.")
    save(report, output)
    print("Threshold signature verified locally. Submit the one-yocto self-transfer.", flush=True)
    submission = rpc(report, output, "send_tx", {
        "signed_tx_base64": base64.b64encode(bytes.fromhex(signed["signed_transaction_borsh_hex"])).decode(),
        "wait_until": "FINAL",
    })
    require("result" in submission, "Transaction submission failed. Inspect the recorded RPC response before any retry.")
    result = submission["result"]
    require(result["final_execution_status"] == "FINAL", "Transaction did not reach finality.")
    require("SuccessValue" in result["status"], "Transaction execution failed.")
    require(result["transaction"]["hash"] == signed["transaction_hash"], "RPC transaction hash differs from the SDK hash.")
    require(result["transaction"]["public_key"] == public_key, "RPC transaction contains a different public key.")
    require(len(result["receipts_outcome"]) > 0, "Missing transaction receipts.")
    report["transaction_hash"] = signed["transaction_hash"]
    report["result"] = "finalized-success"
    save(report, output)
    print(f"Finalized threshold-signed transaction: {signed['transaction_hash']}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    options = parser.parse_args()
    report = {
        "schema": "seams.ml-dsa-near-testnet-e2e.v1",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "public_fixture_only": True, "production_eligible": False,
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "fixture_artifact_sha256": hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
        "binary_sha256": hashlib.sha256(BINARY.read_bytes()).hexdigest(),
        "requests": [], "result": "incomplete",
        "scope": "Public zero-seed key on testnet only. Threshold signing uses separate local role processes. No production custody, Cloudflare signing, or network latency claim.",
        "reproduce": "cargo build --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml && python3 tools/ml-dsa-investigation/scripts/run_near_testnet.py --out <new-report.json>",
    }
    try:
        run(report, options.out)
    except Exception as error:
        report["failure"] = str(error)
        save(report, options.out)
        raise


if __name__ == "__main__":
    main()
