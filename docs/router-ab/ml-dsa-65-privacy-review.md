# ML-DSA-65 composition review

Reviewed October 13, 2026. Branch: `ml-dsa`.

The prototype preserves canonical key identity and produces standard signatures through separate role processes and Workers.
This source review identifies the privacy argument and the remaining integration requirements.
It does not provide an independent cryptographic review or a complete proof.

## Claim and assumptions

The intended claim covers one passive participant in an honest execution.
Passive means that the participant follows the protocol and records everything it can see.
The participants must use independent random sources and must not combine their private views.
Authenticated, confidential transport and valid operation admission belong to the deployment boundary.
The cryptographic core supplies neither boundary.

The ordinary ML-DSA key and signature use the FIPS ML-DSA-65 parameter set.
The current two-party engine uses classical Ristretto OT and 128-bit garbled labels.
These choices provide no post-quantum transcript-confidentiality claim or full ML-DSA category-3 threshold-security claim.
The accepted passive profile does not remove these distinctions.

The review assumes pinned, correctly generated schedules and the security assumptions of the existing OT and half-gate primitives.
Every invocation uses fresh randomness and a binding that includes its schedule, session nonce, and gate domain.
These bindings protect circuit execution boundaries.
They do not authenticate a wallet, key epoch, authorized message, or Router operation.

## Key-generation composition

The canonical seed is `xi = xi_A XOR xi_B`.
Neither normal role receives both contributions.
The seed circuit computes `H(xi || [6, 5], 128)` inside secure computation.
It opens `rho` and returns XOR shares of `rho_prime` and `K`.
See [FIPS 204, Algorithm 6](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf).

Eleven sampling invocations consume the same shared `rho_prime` with public nonces zero through ten.
Each invocation privately selects the first 256 accepted coefficients in their specified order.
A chooses independent uniform masks in the field modulo `q`.
B receives the sampled coefficients minus those masks.
An individual role's resulting polynomial shares therefore have the uniform marginal distribution required by the intended sharing contract.

Each role computes its share of `A*s1+s2` locally.
This computation is linear over the field and uses a public matrix.
Six rounding invocations open `t1` and return newly masked additive shares of `t0`.
The opened `rho` and `t1` comprise the ordinary public key.
The rounding outputs reuse neither the sample masks nor one another's masks.

The bounded sampler opens one success bit per polynomial.
Prefix exhaustion aborts generation and destroys incomplete state.
That event belongs in the permitted leakage and failure contract.
The implementation does not replace the seed after exhaustion.
Same-seed secure continuation remains open.

The resulting role material contains one seed share, one `K` share, and seventeen uniformly shared polynomials.
Its encoded size is 17,472 bytes per role.
Neither normal role holds the complete seed or expanded key.
Correctness evidence compares every reconstructed private field with an independent ordinary implementation after threshold signing.
This reconstruction occurs only in the disposable test recipient.

## Signing composition and permitted disclosures

The signing-seed circuit privately computes `rho_double_prime = H(K || rnd || mu, 64)`.
For hedged signing, the two roles contribute independent 32-byte values to `rnd` by XOR.
For deterministic reference checks, both contributions are zero.
`mu` binds the public key, FIPS context, and message.
Each role must receive the same admitted public operation before execution.

For each candidate, five private mask invocations produce uniform additive shares of `y`.
Local linear computation produces shares of `w = A*y`.
Six private rounding invocations produce XOR shares of the encoded high bits `w1`.
The commitment circuit hashes these shares with `mu` and opens the 48-byte challenge hash.
Public challenge sampling then supplies the sparse challenge polynomial used in local products.

Response and row circuits return masked validity and hint bits.
Only the aggregate circuit opens acceptance after all strict norm and hint-count checks.
Rejected masks, commitments, responses, low coefficients, hints, and individual validity checks remain shared.
The core wipes rejected candidate state before the next candidate begins.

After acceptance, A sends its response and hint shares to B.
B reconstructs the accepted standard signature and sends it to A.
These accepted shares reveal values already determined by the output signature and B's own shares.
The adapters independently check the final signature.

The proposed public leakage consists of:

- The admitted public operation and ordinary public key.
- Fixed circuit shapes and message lengths.
- Bounded-sampler success or abort during generation.
- Every candidate's challenge hash and aggregate acceptance bit.
- The retry count, final standard signature, and terminal failure.

The [Dilithium designers' specification, sections 3.4 and 5.5](https://pq-crystals.org/dilithium/data/dilithium-specification-round3-20210208.pdf) supports a random-oracle argument for rejected challenge hashes under a commitment-entropy condition.
A random oracle models the hash as an ideal random function.
The complete two-party proof must establish that condition against either role's view across all candidates and operations.
It must also account for the canonical seeded key, correlated signing masks, deterministic repeated messages, and aggregate stopping behavior.
The current interoperability tests establish no such proof.
Opening rejected `w1` would require a different argument and is outside this implementation's disclosure boundary.

## Constant-time review

The [earlier compiled triage](../evidence/ml-dsa-65-constant-time-triage-20261013.json) found remainder instructions in private polynomial arithmetic.
The current arithmetic replaces these instructions with fixed folds and masked subtraction.
The modulus satisfies `q = 2^23 - 8191`.
Each fold replaces the high part by 8191 times that part and preserves the residue modulo `q`.

Reduced operands bound the product by 70,231,372,333,056.
Three conservative fold bounds are 68,585,340,919, then 75,358,223, then 8,454,135.
The last bound is below `2*q = 16,760,834`.
One masked subtraction therefore produces a reduced residue.
The addition and subtraction inputs also stay below `2*q`.
Their wrapped differences identify borrow through the top bit because all inputs stay below `2^24`.

The [compiled audit](../evidence/ml-dsa-65-division-free-arithmetic-audit-20261013.json) finds zero division or remainder sites in the three private polynomial functions.
It checks release Wasm and the recorded AArch64 host assembly.
The report records conditional branch sites separately for data-flow review.
Loop controls and array indices in these functions depend on public dimensions.
The [final Worker audit](../evidence/ml-dsa-65-final-worker-arithmetic-audit-20261014.json) extends this check through `worker-build` for both roles.
Each final bundle retains all three named functions, with zero division or remainder instructions and no indirect calls in their bodies.
The report pins exact Wasm bytes, function offsets, body digests, branch sites, and direct calls.
Each role has 21 conditional control-flow sites across these functions.
Direct calls reach the inspected NTT functions or Rust's bounds-check panic handler.
The source uses fixed public dimensions for these bounds checks.
This inspection does not prove the compiled branch conditions or memory addresses independent of secrets.
Cloudflare JIT behavior, other primitives, and hardware timing still require qualification.

Public matrix expansion and challenge sampling branch on public hash streams.
Uniform output-mask generation rejects fresh random candidates independently of retained masks.
Its rejection count requires an explicit simulator argument, although it does not inspect a wallet key.
Boundary validation can branch on malformed inputs and private-share encodings before protocol execution.
None of these observations supplies a blanket constant-time certificate.

The [complete division-free host campaign](../evidence/ml-dsa-65-threshold-host-division-free-20261013.json) passes key generation, threshold signing, and authorized recovery for all five cases.
All four fixed public keys match the previous campaign.
The two deterministic fixed signatures remain identical.
The fresh joint key and hedged signatures pass independent verification.
Native key generation records a 1.75-second median across five cases.
This small separate campaign establishes no controlled latency improvement or cloud prediction.

## Integration requirements

Production integration must bind both roles to the same wallet, key identity, public key, material epoch, message, context, and operation identifier.
Each role must check admission independently before it opens its own stored share.
Use the existing Router authorization and encryption boundaries where their meanings match this two-server signer.
The Ed25519 Client/Signing Worker custody flow has different participant roles and cannot be copied without checking those meanings.

Store each role's material under its own credentials and encryption keys.
The Router must never fetch both plaintext shares.
Bind persisted records and backups to the role, wallet, key, public key, and material epoch.
Reject stale epochs, expired admission, wrong-role requests, and replayed operation identifiers.

Interrupted executions must terminate and destroy candidate state.
Retries need fresh execution identifiers and fresh garbling randomness.
Concurrent operations must hold separate state and must not share candidate or OT state.
Prepared correlations, if introduced, need atomic reservation and terminal consumption even after interruption.

The [host lifecycle campaign](../evidence/ml-dsa-65-threshold-host-lifecycle-20261013.json) now checks interruption after one private mask circuit and cross-session OT replay.
Both failures return no signature. A fresh restart and four concurrent signing operations then pass independent verification.
All 773 circuit bindings across those successful operations differ.
This evidence covers the host core and supplies no durable Router replay or Cloudflare storage claim.

Refresh must preserve the canonical seed and all reconstructed private fields while replacing both roles' shares.
It needs an atomic epoch transition and an explicit rollback and restore policy.
Restoring an old backup must require that transition before signing.
Authorized export must send each seed share directly to the authorized recipient through separately bound encrypted delivery.
Export authorization and recipient binding remain outside the current harness.

The source review remains open until the composition proof, target qualification, and independent review address these requirements.

## Complete engine composition evidence — October 14, 2026

The [complete native campaign](../evidence/ml-dsa-65-complete-engines-host-20261014.json) runs the same consuming core states with half-gates, GMW, and Boolean ABY2.0.
Each engine uses fresh private correlations and fresh bindings for each invocation.
The Boolean adapters require both investigation features and stay outside the default Worker build.
Each role supplies only its own circuit inputs and receives only its permitted outputs.
The adapters retain engine-specific counters and check them against actual directional pipe traffic.

All three engines must produce identical canonical public keys and deterministic signature bytes before the test recipient reconstructs any private field.
Recovery then checks the seed and complete expanded key against the ordinary implementation.
These checks extend interoperability evidence to the full Boolean compositions, including all rejected signing candidates.
They establish no composition proof, target timing guarantee, or production authorization boundary.
The [rebuilt arithmetic audit](../evidence/ml-dsa-65-engine-adapter-arithmetic-audit-20261014.json) still finds no division or remainder in the three private polynomial functions.
Its AArch64 and Wasm checks retain the same pre-link scope and target-qualification limits.
