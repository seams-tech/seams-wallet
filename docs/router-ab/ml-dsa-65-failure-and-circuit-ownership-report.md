# ML-DSA failure causes and circuit ownership — November 1, 2026

Both architecture changes are implemented on `ml-dsa`.
Circuit ownership is committed as `64ee728f7`. Typed failures are committed as `eae10c4cf`.

## Terminal signing causes

Participant execution and durable signing results carry explicit public causes.
These include candidate exhaustion, deadline expiry, interrupted transport, participant refusal,
unavailable or invalid material, configuration failure, and key replacement.
Opaque private protocol failures retain `protocol_failed`.

The Gateway preserves causes when it stores and replays completed operations.
SDK errors expose stable `ml_dsa_signing_*` codes. Wallet-origin normalization preserves those
codes instead of inferring another category from message text.
Public NEAR non-submission and uncertain-submission results carry an explicit `cause`.
Owner-operation receipts and error callbacks preserve the applicable cause.
Submission uncertainty remains authoritative. A failure code cannot prove that no transaction was submitted.

Pool and admission waits still retry the same operation.
Terminal failures do not automatically start another operation.
Cooldowns, grants, exact operation binding, and material consumption remain unchanged.
Older cause-less records normalize only at persistence or message boundaries.
They remain terminal and cannot consume fresh material through replay.

A real Worker test found a close-before-send failure path. B closed during A's setup.
A then failed before reading the queued close reason.
Data and acknowledgment writes now share an error-only terminal-event reader.
It keeps the original deadline and always returns failure after an unsuccessful write.
Successful protocol frames and their ordering are unchanged.
A bounded source review found no material-reuse or deadline defect in this fix.
The Workerd rerun confirmed the expected material failure causes and safe retained-material signing.

## Production circuit ownership

The eleven production circuit binaries and their pinned definitions live in `ml-dsa-threshold`.
Workers and benchmark adapters consume the same definitions.
Production builds no longer read circuit files from the benchmark fixture directory.
Obsolete benchmark aliases were removed.

Every byte hash and both ordered circuit-set digests are unchanged.
The existing prepared-fixture exporter regenerates all eleven circuits and checks them against the production owner.
No key derivation, arithmetic, circuit identifier, cryptographic domain, or material format changed.

## Verification

- Strict Router, A, and B release builds pass. Both benchmark role adapters compile.
- Configured Wallet, Gateway, intended-browser, and wallet-state type checks pass.
- Wallet SDK and Gateway package builds pass.
- Native canonical key-generation cases and independent prepared-component checks pass.
- SQLite lifecycle E2E verifies restart, strict new wire shapes, and terminal replay of older records.
- Real Workerd E2E verifies peer failure delivery, timeouts, partial consumption, retained pairs, and later standard signatures.
- Composed public Gateway/SDK E2E verifies real WebAuthn, D1 completion, exact replay, public causes, callbacks, recovery, and restoration.

The Gateway failure matrix injects terminal causes at authenticated completion after real paired consumption.
It does not claim to force cryptographic rejection. Actual peer faults have separate Workerd coverage.
A natural sixteen-candidate exhaustion exposed the old Gateway stored-outcome decoder during the first run.
That decoder was corrected. The E2E now records legitimate exhaustion before explicitly approving a fresh operation for its remaining success checks.

The bloat gate retains its inherited failure: 13,992 duplicated Rust lines against a 13,754 baseline.
This work does not increase that count or change the baseline.
No Cloudflare deployment or new hosted latency measurement occurred.
Wallet-seed recovery, standard FIPS seed/key export, two-at-once consumption, and thirty-two-candidate capacity remain unchanged.

## Retained evidence

[Public evidence](../evidence/ml-dsa-failure-causes-20261101.json) contains source identities,
public signatures, circuit hashes, and the recorded assertions.
[Original circuit move evidence](../evidence/ml-dsa-production-circuits-20261101.json) retains the previous paths and byte identities.
Private role keys and encrypted fixture records are excluded.

Run the offline verification:

```sh
node docs/evidence/ml-dsa-failure-causes-20261101.mjs
```

Repeat the native/Worker checks with fresh disposable output directories:

```sh
ML_DSA_E2E_REPORT=/tmp/ml-dsa-state.json cargo test --locked --manifest-path crates/router-ab-cloudflare/Cargo.toml --features ml-dsa --test ml_dsa_durable_pool_e2e
ML_DSA_WORKER_FIXTURE_DIRECTORY=/tmp/ml-dsa-roles cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /tmp/ml-dsa-native.json
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /tmp/ml-dsa-roles /tmp/ml-dsa-worker.json
node tests/e2e/ml-dsa-registration-worker.e2e.mjs /tmp/ml-dsa-registration /tmp/ml-dsa-registration.json
```

The Worker runners require the three current strict ML-DSA builds and the existing local fixture dependencies.
The offline verifier checks signatures, circuit bytes, and retained assertions. It does not rerun the live failure scenarios.
