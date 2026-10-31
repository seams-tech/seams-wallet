# ML-DSA command and lifecycle boundaries — November 1, 2026

The three architecture changes are implemented on `ml-dsa`.
The SDK extraction is committed as `a83942073`.
The command contracts and Worker split are committed as `f77a5d2d1`.
Commit `915ae9664` corrects build metadata under colored terminal output.

## Commands own their replies

`workers/commands.rs` declares all fifty internal commands with their exact replies and decoders.
The same declaration defines each existing wire variant and its typed request constructor.
A caller cannot choose a different result type for that request.
Opaque request fields prevent construction of a request with a substituted reply type.

Admission and pool dispatch encode values through reply types from that declaration.
Ordinary replies use JSON. Material consumption uses the existing bounded binary decoder.
Signing-input delivery uses its own existing binary decoder. Peer commands require a WebSocket upgrade.
No additional ciphertext clone or binary-to-JSON conversion enters those paths.

The local client distinguishes transport failure, HTTP refusal, and response decoding failure.
Participant execution preserves `material_unavailable` and `invalid_material` at their existing boundaries.
A refused registration installation retains its HTTP status.
Fixed-signature compiler fixtures check the lookup, inventory, material, and signing-input constructors.

## Worker adapters own platform mechanics

The Worker entry module now contains 301 lines. It previously contained 1,494 lines.
The extracted files have specific responsibilities:

| File | Responsibility |
| --- | --- |
| `workers/admission_actor.rs` | Authenticated admission requests, transactional dispatch, and registration alarms |
| `workers/pool_actor.rs` | Participant pool requests, transactions, and reservation recovery |
| `workers/storage.rs` | Cloudflare storage transactions and bounded ciphertext chunks |
| `workers/rpc.rs` | Authenticated HTTP requests and typed replies |
| `workers/role_authorization.rs` | Live admission and participant authority checks before mutations |
| `producer.rs` | Storage-independent producer queue transitions |
| `registration/queue.rs` | Registration stock claims and preparation demand |

The host reads the clock and passes the time into producer admission.
The domain chooses whether the next job runs, requires recovery, needs settlement, or leaves the queue idle.
Only terminal producer states can enter settlement or produce a settlement outcome.
The host still performs cryptographic execution, paired-publication checks, network calls, and alarm writes.

Registration now claims stock and records replacement demand through one domain operation.
The existing transaction still covers both decisions.
Actor class names, object identities, storage keys, wire tags, and stored state shapes remain unchanged.
Queue bounds, alarm timing, FIFO fairness, compute guards, and deadlines remain unchanged.

## The SDK owns signer lifecycle construction

`NearSigningKeysLifecycle` is available from `@seams/wallet/advanced`.
React calls the shared SDK lifecycle. Other SDK clients can use it without the settings component.
The SDK constructs published signer capabilities, enrollment continuations, registration requests, and NEAR client configuration.
React retains navigation, loading indicators, cancellation guards, and display text.

The lifecycle exposes metadata reads, creation, activation, default selection, and key export.
Creation and activation remain separate actions. Default selection still requires an explicit user action.
The existing combined creation-and-enrollment API shares the same publisher.

Enrollment and publication implementations remain dynamic imports.
The compiled React entry and lifecycle module have no static dependency on either implementation or the optional ML-DSA cryptography module.
The graph check measures import reachability. It does not measure browser network timing or cold-start latency.
No stylesheet changed.

## Validation

The [public evidence](../evidence/ml-dsa-layering-20261101.json) records source identities, build identities, lifecycle results, and standard signatures.
Private role keys and encrypted fixture records are excluded.

Completed checks:

- Wallet, Gateway, intended-browser, and wallet-state type checks pass.
- Wallet SDK and Gateway builds pass.
- Runtime entry and static asset checks pass.
- Nine retained standard signatures verify independently. Altered messages fail verification.
- All three strict release Worker builds pass. Their build times follow the final Worker source changes.
- All forty-eight packaged Worker files match the package manifest. The three ML-DSA modules match the tested builds.
- Real Workerd tests pass for preparation, signing, partial consumption, restart, lost replies, and producer recovery.
- The composed Gateway/SDK test passes for registration, canonical recovery, exact replay, linked owners, and participant restoration.
  The recovered epoch preserves the signing cooldown.
- The existing browser settings scenario passes.
  It covers interrupted activation, RPC recovery, status checks without resubmission, and explicit default changes.
- The SQLite lifecycle E2E passes with an added producer restart and lost-settlement scenario.
  It rejects changed identities and out-of-order removal. A committed publication cannot restart preparation.

The browser settings scenario uses controlled ML-DSA metadata and NEAR RPC responses.
Its result establishes settings behavior. Actual ML-DSA key generation, signing, and export require the separate lifecycle tests.
The SQLite producer scenario uses a host-supplied publication result. The separate Worker run verifies actual paired publication.
The Gateway failure matrix uses authenticated completion faults after actual material consumption.

Package validation also found a build-tooling regression under `FORCE_COLOR=1`.
Node colored numeric timestamps, which made five ordinary build records invalid JSON.
The timestamp writer now emits a string value. The metadata was regenerated from its recorded values.
All recorded build times and Worker binaries remain unchanged. Package validation then passes.

The bloat gate retains its inherited failure: 13,992 duplicated Rust lines against a 13,754 baseline.
This change does not increase that count or change the baseline.
No Cloudflare deployment or new hosted latency measurement occurs in this task.

Wallet-seed recovery, standard FIPS seed/key export, and separate participant custody remain unchanged.
Preparation stays on Workers. Preparation groups contain four candidates. Signing consumes two candidates at a time.
Per-wallet capacity remains thirty-two candidates. Service defaults and admission limits remain unchanged.

## Repeat the validation

Use fresh disposable output directories. Build the three ML-DSA roles from `crates/router-ab-cloudflare`:

```sh
bash scripts/build-strict-worker.sh router ml-dsa
bash scripts/build-strict-worker.sh deriver-a ml-dsa
bash scripts/build-strict-worker.sh deriver-b ml-dsa
```

From the repository directory:

```sh
ML_DSA_E2E_REPORT=/tmp/ml-dsa-state.json cargo test --locked --manifest-path crates/router-ab-cloudflare/Cargo.toml --features ml-dsa --test ml_dsa_durable_pool_e2e
ML_DSA_WORKER_FIXTURE_DIRECTORY=/tmp/ml-dsa-roles cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /tmp/ml-dsa-native.json
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /tmp/ml-dsa-roles /tmp/ml-dsa-worker.json
node tests/e2e/ml-dsa-registration-worker.e2e.mjs /tmp/ml-dsa-registration /tmp/ml-dsa-registration.json
node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/signing-keys.contract.test.ts --grep 'ML-DSA setup resumes'
```

The browser runner starts its normal local Wallet dependencies.
The Worker runners require the existing ordinary Worker and native-client dependencies.
These runs emit repeatable result artifacts. Each fresh run uses disposable operation identities.

Check the retained signatures without starting Workers:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
const evidence = JSON.parse(readFileSync('docs/evidence/ml-dsa-layering-20261101.json'));
const prefix = Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex');
for (const sample of evidence.signatures) {
  const key = createPublicKey({
    format: 'der', type: 'spki',
    key: Buffer.concat([prefix, Buffer.from(sample.publicKeyHex, 'hex')]),
  });
  const message = Buffer.from(sample.messageHex, 'hex');
  const signature = Buffer.from(sample.signatureHex, 'hex');
  assert.equal(verify(null, message, key, signature), true);
  assert.equal(verify(null, Buffer.concat([message, Buffer.from([1])]), key, signature), false);
}
console.log(`${evidence.signatures.length} signatures verified; altered messages rejected`);
JS
```

This offline check verifies the retained signatures. Repeat the E2Es to verify execution and failure handling.
