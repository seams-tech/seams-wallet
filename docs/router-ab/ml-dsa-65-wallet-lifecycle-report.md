# ML-DSA enrollment and retained-signer lifecycle

The advanced SDK now publishes an ML-DSA signer and enrolls its ordinary key on an existing
NEAR account. Recovered owners and full-owner linked devices can discover and use the
existing server-held signer. The signer keeps its public key and material epoch.

These functions ship through `@seams/wallet/advanced`:

| Function | Result |
| --- | --- |
| `addMlDsaNearSigner` | Runs existing-wallet signer publication, then owner-approved NEAR enrollment. |
| `enrollMlDsaNearSigner` | Enrolls an existing published signer reference. Checks finalized chain state before requesting another approval. |
| `resumeMlDsaNearEnrollment` | Checks an uncertain submission through a public continuation. It accepts no signing port. |
| `prepareMlDsaSignerInventory` | Requests a Gateway-issued read-only approval challenge. |
| `fetchMlDsaSignerInventory` | Returns public signer identities after fresh full-owner approval. |
| `serializeMlDsaWebAuthnApproval` | Serializes a native assertion and removes extension outputs. It requires no PRF result. |

## Enrollment

Supply an explicit Wallet Session reference, NEAR account reference, relying-party identifier,
and signer slot to `addMlDsaNearSigner`. Its `wallet` argument uses the existing public
`registration` and `near` capabilities. Its `nearClient` supplies finalized access-key reads.
Use the Wallet's configured NEAR network for that client.

The result distinguishes failed registration from a published signer. A published result
contains the enrollment outcome. Only `enrollment.kind === 'enrolled'` confirms chain readiness.
Publication and chain enrollment are separate durable facts.

Enrollment validates the publication's wallet against the supplied Wallet Session. It then
uses the existing NEAR approval surface for one self-addressed `AddKey` action with full access.
It never derives a private key or changes the ML-DSA participant protocol.
An existing full-access key returns `enrolled` without another owner prompt. An existing restricted key is refused.

NEAR access-key lists represent ML-DSA keys by a hashed handle. Transactions and `AddKey`
actions carry the full key. The implementation uses the existing Rust `PublicKeyHandle`
codec for this distinction, as specified by [NEP-645](https://github.com/near/NEPs/blob/master/neps/nep-0645.md).
The new Wasm export processes public key bytes only.

An RPC failure before submission returns `unavailable`. No owner signing request started.
An uncertain submission returns `pending` with a continuation containing public references.
Persist that continuation and call `resumeMlDsaNearEnrollment`. Resume recomputes identifiers
from the published key and reads finalized chain state. It never submits another transaction.
A resumed read cannot replace the full key with an independently supplied hash.
Caller objects are projected through the existing reference builders before submission or continuation storage.

## Recovery and linked devices

Normal wallet recovery first completes the existing seed-recovery and replacement-factor
ceremony. Its new active owner can then collect a fresh inventory assertion under the Wallet
origin. The recovered factor does not need to receive an ML-DSA signing share.

First call `POST /wallets/:walletId/ml-dsa/inventory/prepare`. The Gateway selects and retains
the nonce and expiry. Check for a `prepared` result before collecting the passkey assertion.
The SDK checks the returned actor and challenge against the configured Wallet origin.

The approved read uses `POST /wallets/:walletId/ml-dsa/inventory`. Its proof binds the wallet, relying
party, credential, random nonce, expiry, and actual configured origin. The Gateway bounds
validity to five minutes and requires the exact issued challenge and authority. It verifies the assertion, commits the authenticator counter, and
rechecks the active authority before returning metadata. It consumes no ML-DSA pool material.
The issuer retains one challenge per actor and origin. Repeated preparation reuses a live
challenge. Expiry or an authority change replaces that record. Caller-selected future
timestamps or nonces cannot authorize inventory.

Inventory returns either a published public key manifest or an explicit unpublished phase
for each stored registration. It refuses malformed records and oversized inventories instead
of silently omitting entries. The caller can retain the returned public references after
recovery or device linking. Signing still needs a separate exact-transaction approval.

The first linked-device release requires all four owner permissions and an installed NEAR
activation. Signing-only devices remain outside ML-DSA admission. An ECDSA-only linked
authority also lacks this NEAR access. The existing device-linking ceremony must complete
target activation before its authority can resolve as active.

Each request uses the selected method's own passkey and current authority digest. The
Gateway retains its counter, revocation, publication-version, and wallet-generation checks.
A revoked linked method loses inventory, fresh signing, and cached-signature access.
Other owners retain their separate access.

The retention path leaves the ML-DSA publication, seed binding, epoch, and participant shares
unchanged. It restores access to durable server material. Replacing lost participant material
still needs a dedicated public re-establishment flow using the recorded canonical manifest.
Native and private-protocol recovery support already exists for that separate operation.

## Evidence

The [testnet enrollment artifact](../evidence/ml-dsa-65-key-enrollment-20261021.json) records
an Ed25519-owned disposable account that adds the previously verified threshold-generated
ML-DSA key. The runner checks the exact `AddKey` action and successful `FINAL` outcome.
It independently computes the expected SHA3 handle with Node OpenSSL.
After an injected lost acknowledgement and RPC outage, continuation resumes without a second
broadcast. A repeated enrollment also preserves the single broadcast. A different wallet is
refused before submission.

The account's owner signature uses a disposable Node Ed25519 key and the production native
NEAR codec. This test qualifies enrollment orchestration and chain encoding. The Wallet's
Ed25519 approval UI remains covered by its existing tests.

The [composed Worker artifact](../evidence/ml-dsa-65-lifecycle-20261021.json) adds recovered
and linked full-owner authorities through shared branch-specific fixture factories. It then
uses actual Gateway routes, local D1, fresh P-256 assertions, and local A/B Workers.
The SDK and Node OpenSSL independently verify the resulting ML-DSA signatures.

The cases check retained-key discovery and signing, unchanged custody/publication, shared
wallet cooldown, rejection of signing-only and ECDSA-only linked devices, revocation of
cached and fresh access, and continued access from a separate recovered owner.
The additional controls reject an unissued nonce, an extended inventory expiry, and an inventory assertion
presented as transaction approval.
The campaign passes 19 registration checks, 20 signing checks, and 12 lifecycle checks.
The separate testnet enrollment campaign passes six checks. Both artifacts match the final source hashes.

The SDK build, Wallet/server types, lifecycle type fixtures, intended-test types, generated
Wasm import checks, and isolated package consumers pass. The package checks include the new
advanced ML-DSA imports and reject declaration aliases that degrade their inputs to `any`.
All 38 Cargo lockfiles pass the locked check. The bloat check retains the inherited Rust
duplication excess of 13,984 lines against 13,754. Its baseline remains unchanged.

These authority fixtures begin at completed recovery/device activation. They do not run
the browser recovery-code or QR-link ceremonies. Those combined browser campaigns remain
qualification work. The earlier [hosted browser campaign](ml-dsa-65-browser-hosted-report.md)
qualifies signing and finality under its documented existing-owner fixture scope.

Repeat the enrollment campaign with a private output directory:

```sh
cargo build --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml
wasm-pack build wasm/near_signer --release --target web --out-dir pkg
node tests/e2e/ml-dsa-enrollment.e2e.mjs <private-directory> <enrollment-evidence.json>
```

The runner uses only a disposable testnet faucet account and public ML-DSA fixture metadata.
It never writes the disposable Ed25519 private key to the artifact.

Repeat the composed campaign with separate local participant keys and matching strict Worker builds:

```sh
node tests/e2e/ml-dsa-registration-worker.e2e.mjs <private-role-key-directory> <lifecycle-evidence.json>
```

## Preserved requirements

- Wallet-seed derivation and canonical FIPS seed/key export remain unchanged.
- Preparation remains on Workers. Groups prepare four candidates and consume independent pairs.
- Pool target remains 32 candidates, with 16 ready candidates required for admission.
- The wallet cooldown remains 60 seconds. Linked and recovered owners share that wallet limit.
- GPU preparation and UI redesign remain deferred.
- No new cryptographic protocol or stronger privacy claim is introduced.
