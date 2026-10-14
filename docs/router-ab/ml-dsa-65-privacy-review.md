# ML-DSA-65 composition review

Reviewed October 14, 2026. Branch: `ml-dsa`.

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

The core now checks public request agreement before the first signing circuit.
Each role computes `SHAKE256(domain || operation_id || mu || mode, 64 bytes)`.
The domain is `seams/ml-dsa-65/signing-request/v1` and the operation identifier has exactly 32 bytes.
The mode byte is zero for deterministic signing or one for joint randomness.
Each direction sends exactly 73 bytes: `MLDSAS01`, one role byte, and the 64-byte digest.
A sends first. B checks A's binding before it returns its own binding.
A checks B's binding before it starts the signing-seed circuit.
The role bytes reject reflected headers. A different request aborts without a signature.

This exchange detects disagreement under the collision-resistance assumption of SHAKE256.
It does not authenticate the operation or prove that stored shares belong to the stated public key.
The caller must bind the operation identifier to an admitted wallet, key, material epoch, and trusted circuit set.
Authenticated peer transport must preserve each operation's ordered message stream.
Repeated execution of the same admitted identifier still needs a durable replay ledger.

The [request-binding campaign](../evidence/ml-dsa-65-request-binding-host-20261014.json) changes one request field at a time between separate role processes.
It covers operation identifier, public key, message, context, and randomness mode.
B rejects each case after receiving A's 73-byte header, with zero completed private circuits and no outbound protocol bytes.
Neither role writes a signature result.
The same campaign repeats canonical recovery, interruption, OT replay rejection, restart, concurrent signing, and offline SDK transaction verification.

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
The [request-binding rebuild](../evidence/ml-dsa-65-request-binding-arithmetic-audit-20261014.json) repeats this inspection with the new public request exchange.
Each final bundle retains all three named functions, with zero division or remainder instructions and no indirect calls in their bodies.
The report pins exact Wasm bytes, function offsets, body digests, branch sites, and direct calls.
Each role has 21 conditional control-flow sites across these functions.
Direct calls reach the inspected NTT functions or Rust's bounds-check panic handler.
The source uses fixed public dimensions for these bounds checks.
The earlier reports record branch sites without tracing their inputs.
The manual data-flow review below addresses these three final Wasm bodies.
Cloudflare JIT behavior, other primitives, and hardware timing still require qualification.

Public matrix expansion and challenge sampling branch on public hash streams.
Uniform output-mask generation rejects fresh random candidates independently of retained masks.
The rejection-count argument below assumes independent uniform random draws.
It does not cover failures or internal timing behavior of the operating-system random source.
Boundary validation can branch on malformed inputs and private-share encodings before protocol execution.
None of these observations supplies a blanket constant-time certificate.

The [complete division-free host campaign](../evidence/ml-dsa-65-threshold-host-division-free-20261013.json) passes key generation, threshold signing, and authorized recovery for all five cases.
All four fixed public keys match the previous campaign.
The two deterministic fixed signatures remain identical.
The fresh joint key and hedged signatures pass independent verification.
Native key generation records a 1.75-second median across five cases.
This small separate campaign establishes no controlled latency improvement or cloud prediction.

## Compiled arithmetic data-flow review — October 14, 2026

The [instruction evidence](../evidence/ml-dsa-65-arithmetic-dataflow-audit-20261014.json) records complete instruction streams for both rebuilt Worker bundles.
Schema v3 includes parameter types, local declarations, byte offsets, direct calls, and value-selection sites.
This is a manual review of the recorded bytes. The inspection tool does not perform automatic secret-data tracking.

The three functions contain 1,017 instructions per role: 265 in `inverse_ntt`, 566 in `matrix_product_plus_error`, and 186 in `ntt`.
The role bodies differ only in direct-call indices and constant addresses passed to bounds-panic handlers.
The calls resolve to the same functions in both roles.
Neither role contains division, remainder, or indirect calls in these bodies.

The following table identifies every explicit conditional branch by its absolute Wasm byte offset.
Local numbers refer to the function's Wasm parameters and locals, starting at zero.

| Function | A offsets | B offsets | Condition and origin |
| --- | --- | --- | --- |
| `inverse_ntt` | 574555 | 534669 | Local 10: block count derived from public transform length. |
| `inverse_ntt` | 574596 | 534710 | Local 6: twiddle index starts at 256 and decreases once per block. |
| `inverse_ntt` | 574660, 574673 | 534774, 534787 | Public block and coefficient counters select indices checked against 256. |
| `inverse_ntt` | 574838 | 534952 | Coefficient counter reaches the public transform length. |
| `inverse_ntt` | 574902, 574912 | 535016, 535026 | Remaining block count and transform length control the next iteration. |
| `inverse_ntt` | 575021 | 535135 | Normalization byte offset increases by four until 1,024. |
| `matrix_product_plus_error` | 429485, 429629, 429773, 429917, 430063 | 406580, 406724, 406868, 407012, 407158 | Local 5: each of five column loops traverses 1,024 bytes in steps of four. |
| `matrix_product_plus_error` | 430204 | 407299 | Local 5: output loop traverses 1,024 bytes in steps of eight. |
| `matrix_product_plus_error` | 430241 | 407336 | Local 8: row counter increases from zero to six. |
| `ntt` | 609321 | 562183 | Local 9: block count derived from public transform length. |
| `ntt` | 609358, 609403 | 562220, 562265 | Public twiddle and coefficient indices are checked against 256. |
| `ntt` | 609564 | 562426 | Coefficient byte offset reaches four times the public transform length. |
| `ntt` | 609583, 609594 | 562445, 562456 | Remaining block count and halved transform length control the next iteration. |

Memory addresses use incoming array pointers, the stack pointer, fixed offsets, and these public counters.
Coefficient loads feed arithmetic, value selection, and stores. They do not feed branch conditions or memory addresses in the reviewed bodies.
`matrix_product_plus_error` calls `ntt` five times and `inverse_ntt` once per row.
The only other direct calls are bounds-panic handlers controlled by public indices.
Bulk memory copies and fills use fixed lengths of 1,024 or 6,144 bytes.

The compiler converts masked reductions into Wasm `select` instructions.
There are four selection sites in `inverse_ntt`, twelve in `matrix_product_plus_error`, and three in `ntt`.
Their conditions depend on private coefficients. Their results stay in coefficient arithmetic and output stores.
These sites require inspection after Cloudflare's JIT compilation before a target constant-time claim is justified.
The review also excludes memory-erasure guarantees, machine-instruction timing, and unrelated callers or cryptographic primitives.

## Source-level control-flow review

| Path | Private values | Reviewed control or addressing behavior | Remaining check |
| --- | --- | --- | --- |
| `ml_dsa_runtime.rs` | Input bits, labels, output shares | Gate dispatch, arena indices, frame limits, and output lengths follow the pinned public schedule. | Inspect compiled runtime and its callees. |
| `passive.rs` half-gates | Labels, global delta, choice bits | Label selection uses fixed-length `subtle` conditional operations. Both evaluator half-gates execute. | Inspect compiled selections and AES paths. |
| `gate_aes.rs` | Four label blocks | S-box uses Boolean operations. Round branches and array indices use fixed round counters. | Inspect final Wasm and JIT code. |
| `ot.rs` | OT choices, seeds, scalars | Choice selection uses `subtle`. Matrix indices use public row and message counters. Base-response repair always executes twice. | Review compiled OT and dependency primitives. |
| `ml_dsa_signing.rs` | Candidate shares | Stage dispatch uses public role, stage, and index. Candidate retry follows the disclosed aggregate acceptance bit. | Complete the composition proof for these disclosures. |
| Accepted signature encoding | Reconstructed response and hints | Branches use accepted output values, which the standard signature reveals. Encoding starts only after aggregate acceptance. | Preserve this ordering in production adapters. |

These source observations do not qualify the compiled runtime, AES, or OT implementations.
They identify the inputs and review boundaries for that work.

### Uniform-mask rejection count

`fill_uniform` draws a fresh 23-bit candidate for each trial and accepts values below `q`.
Let `M = 2^23`, let `N` be the number of trials, and let `X` be the accepted value.
Under independent uniform draws, for every `n >= 1` and `0 <= x < q`:

```text
Pr[N = n, X = x] = ((M - q) / M)^(n - 1) / M
Pr[N = n]       = ((M - q) / M)^(n - 1) * q / M
Pr[X = x | N = n] = 1 / q
```

Thus the trial count is independent of the retained mask under this assumption.
A simulator can draw the count from the same geometric distribution without knowing that mask or the wallet key.
The argument applies separately to fresh key-generation and signing output masks drawn by this helper.
It does not cover the seed-derived bounded sampler, whose success bit remains an explicit protocol disclosure.
It also does not establish the behavior of the random-source implementation or its shared system state.

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

The [testnet E2E](../evidence/ml-dsa-65-near-testnet-e2e-20261014.json) records finalized execution of an SDK transaction signed by separate local roles.
The account uses a public fixture seed and faucet test tokens.
The test checks full public keys against distinct access-key handles, including the actual RPC request and response formats.
This establishes network interoperability. It supplies no production authorization, durable storage, or recovery guarantee.

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
