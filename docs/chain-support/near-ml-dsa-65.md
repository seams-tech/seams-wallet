# NEAR ML-DSA-65 threshold signer support

Status: investigation in progress. Production ML-DSA custody, signing routes,
NEAR encoders, and Wallet SDK APIs remain unimplemented.

The [investigation plan](../router-ab/ml-dsa-65-investigation-plan.md) defines
this work. The [experiment contract](../router-ab/ml-dsa-65-experiment-contract.md)
defines the first reference harness and provisional share format.

## Custody and recovery

Use two server participants, A and B, under passive, honest execution.
Jointly create a hidden 32-byte FIPS seed `xi`.
Neither participant receives the complete seed or expanded private key.
Secret key-generation operations use secure computation or operate on secret shares.
It must reproduce `ML-DSA-65.KeyGen_internal(xi)` exactly.
Normal signing requires both participants and emits a standard signature.

The client authorizes the operation. The Router holds no secret share.
A and B keep their own seed shares, signing shares, and one-use material.
Keep this seed separate from the wallet custody seed and tenant derivation roots.
The existing client/SigningWorker Ed25519 arrangement does not define ML-DSA custody.

An authorized recipient may reconstruct the seed from both exported shares.
That seed must reproduce the same ordinary ML-DSA keypair.
Backup ownership and recovery after permanent participant loss need a separate design.
Do not claim that one remaining share can restore the key.

The host reference harness uses fixed public fixtures.
Its complete test keys do not establish private threshold execution.
Production protocol selection requires complete signing and recovery measurements.
Mithril, Trilithium, and general 2PC remain candidates under the investigation plan.

## NEAR wire boundary

The experiment contract pins nearcore source and records the algorithm baseline.
The reviewed source defines these values:

| Value | Representation |
| --- | --- |
| Full public key | `ml-dsa-65:` plus base58-encoded 1,952 bytes |
| Expanded private key | 4,032 bytes; excluded from server persistence and logs |
| Signature | Wire tag 2 plus 3,309 bytes |
| Access-key list handle | `ml-dsa-65-hash:` plus a 32-byte digest |

Full public keys and access-key handles require distinct types.
A handle cannot replace a full key in signing or verification.
The handle digest uses SHA3-256 with the domain
`near:ml-dsa-65-pubkey-hash:v1` followed by the full public-key bytes.

The reviewed transaction path signs the SHA-256 digest of exact Borsh transaction bytes.
Confirm pure ML-DSA context behavior through the pinned NEAR verifier before integration.
Query active protocol configuration from the target network before enrollment.
A node's software version does not establish network activation.

Existing NEAR representations in this repository assume Ed25519.
Add precise ML-DSA variants only after the investigation selects a protocol.
Include key parsing, exact Borsh encoding, access-key lookup, and transaction-size accounting.
Do not assume an ML-DSA key has an Ed25519 implicit-account identifier.

## Integration conditions

The investigation must establish these results before public SDK enablement:

- Standard key and signature encodings pass independent implementations and the pinned NEAR verifier.
- Private key generation produces shares that the selected signing protocol consumes directly.
- Both roles execute separately through the intended Cloudflare transport and storage boundaries.
- Seed export reproduces the exact public key at the authorized recipient.
- Refresh, interruption, unavailable-peer, restart, concurrency, and exhausted-material scenarios produce repeatable evidence.
- Wallet authorization binds the exact wallet, key, message, operation, material version, and export recipient.
- Every released signature passes verification before the signing boundary returns it.
- Performance reports include preprocessing, failed attempts, queue time, and replenishment.
- Dependency licenses, implementation assumptions, and the complete privacy composition receive review.

ML-DSA output alone does not establish post-quantum confidentiality for OT,
envelopes, transport, authentication, or recovery delivery.
Keep those claims separate in the selected library's documentation.
