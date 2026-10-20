# ML-DSA public signing integration

The advanced SDK signs a NEAR transaction through fresh passkey approval, authoritative
Gateway admission, durable operation claims, and the existing A/B Workers signer.
The standard Wallet signing UI and reusable ML-DSA sessions remain separate integration tasks.

## Public flow

1. Call `prepareMlDsaNearSigning` with the wallet, signing-key identifier, operation identifier,
   passkey identity, exact unsigned Borsh transaction, and expected registered public key.
2. Review `preparation.transaction.displayJson`. Collect a WebAuthn assertion for
   `preparation.challengeB64u` under the configured Wallet origin and relying party.
3. Call `executeMlDsaNearSigning` with that preparation and assertion. Preserve both for retries.
4. A `retry` result gives an explicit retry time. A `signed` result contains verified standard
   NEAR transaction bytes. `submitMlDsaNearTransaction` verifies them again and uses the existing
   NEAR JSON-RPC client for submission.

These functions are exported from `@seams/wallet/advanced`.
The HTTP routes are `POST /wallets/:walletId/ml-dsa/sign/prepare` and
`POST /wallets/:walletId/ml-dsa/sign`.
They require the Wallet management protocol header and a configured Wallet origin.
Signing requires fresh passkey approval from an active direct wallet owner.

The Gateway reads the public key, epoch, manifest, schedule, and wallet generation from the
published registration. Clients cannot select those values or supply a transaction hash.
The existing Rust Borsh implementation decodes the transaction and computes its hash and display.
Both the Gateway and SDK require the transaction's full public key to match the published key.

The approval challenge binds the operation fingerprint, origin, and five-minute expiry.
The fingerprint includes the exact native transaction display and signing target.
The Gateway commits passkey counter advancement, approval state, and the authorized operation
in one D1 transaction. Both owner authority and publication version must still match.
A delayed or duplicate request cannot replace the selected assertion or spend another operation.
The Router retains its existing wallet cooldown, service capacity, and rejection-retry rules.

The Gateway verifies the signature before retaining its completed response.
The SDK independently verifies the signature and checks the complete signed bytes.
A cached response still requires current ownership, auth-method status, publication version,
wallet generation, origin, and approval validity.

Unsigned transactions are limited to 32 KiB. This keeps signed responses within the existing
64 KiB durable replay limit. Nonces remain exact decimal strings at the JSON boundary.
The transaction format uses the full 1952-byte public key and standard 3309-byte signature.

## Preserved requirements

- Wallet-seed derivation and ordinary FIPS seed/key export remain unchanged.
- The existing A/B protocol retains each private signing share inside its participant boundary.
- Preparation remains on Workers. It prepares four candidates and consumes independent pairs.
- Pool capacity remains 32 candidates, with 16 candidates required for admission.
- The default wallet cooldown remains 60 seconds. Duplicate requests reuse their operation.
- Existing seed envelopes and recovery sets remain byte-identical through the composed flow.
- GPU work and UI redesign remain deferred.

## Evidence and validation

The [composed E2E artifact](../evidence/ml-dsa-65-public-signing-20261021.json) records actual
Gateway routes, D1 migrations and claims, real P-256 WebAuthn verification, two-role Worker
key generation, threshold signing, and native custody completion.
The SDK client runs in Node for this campaign. A simulated NEAR RPC endpoint checks submission
bytes. RustCrypto and Node OpenSSL verify the signature independently.

The campaign tests approval binding, malformed assertions, PRF-output rejection, changed
transactions, exact retries, competing first approvals, lost replies, D1 restart, revocation,
positive passkey counters, cooldown responses, large nonces, signature corruption, and
standard NEAR encoding. It also preserves the prior registration and expiry-race checks.
All 20 public signing checks and 18 registration checks pass.
The schema upgrade retains existing Ed25519 and ECDSA evidence rows byte for byte.
Wallet and server TypeScript checks, lifecycle type fixtures, native release compilation,
and the Wasm release build pass. All 38 Cargo lockfiles pass the repository's locked check.
The bloat check retains the inherited Rust duplication failure: 13,984 lines against 13,754.
Its baseline remains unchanged. No new bloat category fails.

Repeat with a private directory containing separate disposable `a-kek` and `b-kek` values:

```sh
cargo build --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml
wasm-pack build wasm/near_signer --release --target web --out-dir pkg
node tests/e2e/ml-dsa-registration-worker.e2e.mjs <private-fixture-directory> <evidence.json>
```

Use the matching strict Worker bundles under `crates/router-ab-cloudflare/build`.
The runner writes source and binary hashes. It must use disposable test credentials.

The added verification code processes public transaction, public-key, and signature data.
It accepts no signing seed or private key. It uses the existing pinned RustCrypto `ml-dsa`
version with default random-key-generation features disabled for the browser build.
This review does not qualify the complete threshold implementation for production.

## Diagnosis record

| Observation | Classification | Resolution |
| --- | --- | --- |
| The evidence table excluded the ML-DSA transaction operation. `INSERT OR IGNORE` omitted it, and claim CAS failed. | Missing production schema integration | Migration 0083 adds exactly this operation and restores all prior authorization guards. |
| Existing add-signer test assertions reused counter zero after public signing advanced it to two. | Valid test fixture needs update | Use subsequent positive counters. Preserve production counter checks. |
| Duplicate checks initially exercised completed responses only. | E2E coverage gap | Pause the first approval before commit and let its concurrent duplicate win. Verify one durable claim and one counter advancement. |

The failure hypotheses were checked against these controls:

| Hypothesis | Result | Evidence |
| --- | --- | --- |
| Threshold signing or verification failed. | Contradicted for the initial claim failure. | Key generation and native inspection passed. The failure occurred before Router signing. |
| The evidence schema omitted the operation. | Supported and corrected. | The exact old schema inserted one Ed25519 control row and zero ML-DSA rows under `INSERT OR IGNORE`. The Worker run reported claim CAS failure. Adding the operation made public signing succeed. |
| Production counter verification regressed. | Contradicted. | The authenticator stored counter two after two approved operations. The later fixture sent zero. Subsequent valid counters passed. |
| Cached replay alone proves competing initial claims. | Contradicted. | The first test repeated completed results. The added claim barrier verifies the earlier race directly. |

An independent read-only review checked counter atomicity, exact replay, revocation,
publication pinning, and the schema change. It found no additional concrete bypass in this scope.

## Network support and remaining qualification

A [read-only network check](../evidence/ml-dsa-65-network-support-20261021.json) observed mainnet
protocol 86 and testnet protocol 87 on October 21, 2026, Japan time.
[NEP-645](https://github.com/near/NEPs/blob/master/neps/nep-0645.md) specifies activation at
protocol 85. These status observations support protocol availability. They do not prove
that this campaign enrolled an access key or confirmed a transaction on either network.

Next work:

1. Connect the standard Wallet review and iframe surfaces to the advanced signing flow.
2. Connect on-chain access-key enrollment and verify a transaction on the selected NEAR network.
3. Qualify the full browser SDK flow against matching hosted Gateway and Worker builds.
4. Connect public recovery, interrupted-operation reconciliation, export, and device authorization.
5. Complete participant relocation before enabling it for ML-DSA wallets.

This campaign does not establish hosted latency or a consistent five-second target.
