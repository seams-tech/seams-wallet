# ML-DSA-65 experiment contract

Status: local reference and circuit investigation. Reviewed October 13, 2026.
This contract implements the first work item in the
[investigation plan](ml-dsa-65-investigation-plan.md).
It defines experiment boundaries. It does not select a production protocol.

## Canonical key identity

The canonical input is the exact 32-byte FIPS seed `xi`.
Normal operation gives each server only one XOR share:
`xi = xi_A XOR xi_B`.
Each role contributes independent random bytes in the intended protocol.
Fixed public fixtures replace randomness in the reference harness.

Use FIPS 204, August 13, 2024, Algorithm 6, with ML-DSA-65 parameters.
The first expansion is `SHAKE256(xi || 0x06 || 0x05, 128 bytes)`.
Its output is `rho[32] || rho_prime[64] || K[32]`.
Keep the seed distinct from the wallet custody seed and tenant derivation roots.

The [NIST potential-updates sheet](https://csrc.nist.gov/files/pubs/fips/204/final/docs/fips-204-potential-updates.xlsx)
was reviewed on October 13, 2026.
Its SHA-256 digest is
`5bc93ce63bc647e6d1d456cb2d3a171426c15aca4a7a0e0edd40d08b7a34c793`.
The sheet identifies potential corrections, rather than an official replacement edition.
The algorithm baseline needs these interpretations:

- Evaluate the polynomial once in the NTT definition.
- Use the internally formatted message `M_prime` in signing and verification.
- Hash the message representative before the encoded commitment when creating the challenge.
- Apply the corrected signed Montgomery-reduction bounds if that reduction is implemented.
- Keep the hint's high coefficient below `(q - 1) / (2 * gamma2)`.
- Use 821 as the minimum permitted signing-loop limit when adding a bounded signer.
  The sheet updates the ML-DSA-65 expected attempt count to 5.14.

The reviewed corrections do not change Algorithm 6's seed expansion.
The SHAKE experiment fixes a polynomial stream at 481 bytes.
It does not yet select or compact coefficients.
Exhaustion handling remains an explicit requirement for the sampler implementation.

## Reference execution

The [host tool](../../tools/ml-dsa-investigation/README.md) pins RustCrypto
`ml-dsa = 0.1.1` through its manifest and lockfile.
OpenSSL is the independent key-generation and signature reference.
The report records the installed OpenSSL version and executable identity.
The checked installation is OpenSSL 3.6.3.
RustCrypto distributes this crate under Apache-2.0 or MIT and reports no independent audit.
These are experiment dependencies, with no production approval implied.

Only named public fixtures enter the tool.
The reference process may hold their complete seeds and private keys.
The recovery recipient reconstructs only public fixture material.
Neither process is a threshold participant implementation.
All future server execution must preserve the hidden-seed contract.

Compare exact public keys and deterministic signatures across the two implementations.
Check seed recovery, altered messages, altered signatures, wrong keys, and context mismatch.
Include empty and nonempty contexts.
Record hashes of expanded private fixture keys rather than their full encodings.
Record source revision, source-file hashes, lockfile identity, raw samples, and commands.

## First compatible share format

The first signing baseline is general two-party computation with local linear arithmetic.
Use uniformly masked shares, without short-share leakage or a randomness provider.
The following logical format defines its key-generation output.
It is not a persisted wire schema, and no experiment currently emits signing shares.

| Material | Representation at each role | Reconstruction inside secure computation |
| --- | --- | --- |
| `xi` | One 32-byte XOR share | `xi_A XOR xi_B` |
| `K` | One independently masked 32-byte XOR share | `K_A XOR K_B` |
| `s1` | Five polynomials, each with 256 uniformly masked residues | Add the two shares modulo `q = 8,380,417` |
| `s2` | Six polynomials with the same residue representation | Add the two shares modulo `q` |
| `t0` | Six polynomials with the same residue representation | Add the two shares modulo `q` |
| `rho`, `tr`, public key | Public bytes | No secret reconstruction |

A polynomial is a fixed array of coefficients in the ML-DSA ring.
Use coefficient order from FIPS 204 and ordinary coefficients at the boundary.
The first native representation uses 32-bit unsigned residues in `[0, q)`.
The 4,352 coefficient shares occupy 17,408 bytes per role before metadata.
The two XOR shares add 64 bytes per role.
This is a storage calculation, rather than a measured encoding.

Keep `rho_prime` inside secure computation and discard it after sampling.
The baseline also keeps `t` private and computes its rounding securely.
Opening `t` is a separate optimization requiring a composition argument alongside these shares.
Never expose signing masks, rejected candidates, or secret rejection checks to save communication.
Generate each output mask independently. Consume garbled execution material once.

The general signing circuit must consume these shares directly.
Mithril and Trilithium need separate share-conversion and preprocessing analyses.
Their implementations cannot inherit compatibility merely because their outputs use ML-DSA.

## Roles, authorization, and recovery

A and B are separate server holders under passive, honest execution.
They follow the protocol and do not collude.
The Router receives public operation state and results.
It receives no seed, signing share, or preprocessing secret.
The client authorizes the exact wallet, key, message, operation, and recipient.

Use the existing Deriver A and B Worker entrypoints for the first deployed experiment.
Keep each role's credentials and persistence separate.
This experiment choice does not approve a production signing route.
The checked manifests declare Rust/WASM Workers and wallet Durable Objects.
Live versions, physical placement, storage locations, and resource limits still need a deployment record.

Generation creates one key identity. Signing consumes fresh one-use material.
Refresh must retain that key identity and reject stale operation state.
Export sends each seed share to the same newly authorized recipient.
Only that recipient reconstructs the seed and checks the expected public key.
Recovery must reproduce the canonical key before new shares become active.
These are required behaviors, rather than implemented authorization or lifecycle flows.

One seed share cannot recover a permanently lost peer's material.
The first recovery fixture requires both shares.
Protected backup ownership and restoration after permanent loss remain unresolved.
No result from this harness establishes those recovery properties.

## NEAR boundary

Pin nearcore at `a45238b883d23673e7eac94549126bbb6f0d9307` for source review.
Its [signature implementation](https://github.com/near/nearcore/blob/a45238b883d23673e7eac94549126bbb6f0d9307/core/crypto/src/signature.rs)
uses wire tag 2 and public-key/signature sizes of 1,952 and 3,309 bytes.
Its [protocol feature table](https://github.com/near/nearcore/blob/a45238b883d23673e7eac94549126bbb6f0d9307/core/primitives-core/src/version.rs)
sets `PostQuantumSignatures` at protocol version 85.
Its [transaction implementation](https://github.com/near/nearcore/blob/a45238b883d23673e7eac94549126bbb6f0d9307/core/primitives/src/transaction.rs)
hashes serialized transaction bytes before signing.
The signature path uses the ordinary AWS-LC signing API without an explicit context argument.
The eventual interoperability test must confirm empty-context behavior against that verifier.

The host harness verifies standard ML-DSA signatures through OpenSSL.
It does not execute the pinned NEAR verifier, encode a NEAR transaction, or prove network activation.
Record active protocol configuration from the selected RPC before enrollment.
Keep full public keys distinct from hashed access-key handles.

## Candidate decisions still open

| Candidate | Current decision | Required next evidence |
| --- | --- | --- |
| Hybrid half-gates plus general 2PC signing | First measurement baseline | Sampling, arithmetic conversion, actual garbling, separate-role execution, and a complete signature |
| Full Yao | Resource comparison | Exact complete circuit cost |
| Three-halves garbling | Alternative | Implementation, security parameters, CPU, and total traffic |
| GMW / ABY2.0 | Alternative | Two-party preprocessing, conversion, communication depth, and WASM execution |
| Mithril with canonical-key sharing | Alternative | Selected revision, short-share privacy loss, repeated sharing, licensing, and complete cost |
| Trilithium | Alternative | Selected revision and a two-party replacement for its randomness provider |
| THED | Screen before implementation | A concrete Worker/WASM resource case |
| Native DKG without seed recovery | Excluded | Fails canonical recovery |
| Honest-majority or trusted-hardware profiles | Excluded from this baseline | Do not fit the accepted two-server privacy contract |

The paper survey in the investigation plan remains the starting inventory.
Recheck revisions before implementing another candidate or selecting a winner.
Provisional p95 targets remain one second for warm signing and five seconds for generation or recovery.
The local reference timings cannot rank threshold protocols or predict Cloudflare costs.

## Next executable step

Implement coefficient selection and arithmetic-share conversion against the public reference fixtures.
Then expose the existing half-gates kernel through a benchmark-only execution boundary.
Measure actual garbling and evaluation in separate processes before repeating on Cloudflare.
Retain the generated circuit counts as the static comparison baseline.
