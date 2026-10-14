# ML-DSA-65 experiment contract

Status: experimental canonical key generation, threshold signing, and authorized recovery. Reviewed October 14, 2026.
This contract defines the current implementation boundaries in the
[investigation plan](ml-dsa-65-investigation-plan.md).
It defines experiment boundaries. Half-gates is the selected engine for integration, subject to the remaining production qualification.

## Canonical key identity

The canonical input is the exact 32-byte FIPS seed `xi`.
Normal operation gives each server only one XOR share:
`xi = xi_A XOR xi_B`.
Each role contributes independent random bytes in the disposable joint-random experiment.
The reference harness also uses four fixed public seeds.

Use FIPS 204, August 13, 2024, Algorithm 6, with ML-DSA-65 parameters.
The first expansion is `SHAKE256(xi || 0x06 || 0x05, 128 bytes)`.
Its output is `rho[32] || rho_prime[64] || K[32]`.
Keep the seed distinct from the wallet custody seed and tenant derivation roots.

This investigation reviewed the
[NIST potential-updates sheet](https://csrc.nist.gov/files/pubs/fips/204/final/docs/fips-204-potential-updates.xlsx)
on October 13, 2026.
Its SHA-256 digest is
`5bc93ce63bc647e6d1d456cb2d3a171426c15aca4a7a0e0edd40d08b7a34c793`.
The sheet identifies potential corrections, rather than an official replacement edition.
The algorithm baseline needs these interpretations:

- Evaluate the polynomial once in the NTT definition.
- Use the internally formatted message `M_prime` in signing and verification.
- Hash the message representative before the encoded commitment when creating the challenge.
- Apply the revised signed Montgomery-reduction bounds if the implementation uses that reduction.
- Keep the hint's high coefficient below `(q - 1) / (2 * gamma2)`.
- Use 821 as the minimum permitted signing-loop limit when adding a bounded signer.
  The sheet updates the ML-DSA-65 expected attempt count to 5.14.

The reviewed corrections do not change Algorithm 6's seed expansion.
The sampler fixes each polynomial stream at 481 bytes.
It selects the first 256 accepted coefficients in their original order and converts them into additive shares.
It reports aggregate success or failure without exposing acceptance positions.
Prefix exhaustion aborts the operation and destroys intermediate outputs.
The experiment never substitutes a new seed to obtain success.
Secure continuation for the same canonical seed remains unimplemented.

## Reference execution

The [host tool](../../tools/ml-dsa-investigation/README.md) pins RustCrypto
`ml-dsa = 0.1.1` through its manifest and lockfile.
OpenSSL is the independent key-generation and signature reference.
The report records the installed OpenSSL version and executable identity.
The checked installation is OpenSSL 3.6.3.
RustCrypto distributes this crate under Apache-2.0 or MIT and reports no independent audit.
These are experiment dependencies, with no production approval implied.

The reference process holds complete fixed public seeds and private keys.
Separate A and B processes also execute private key generation for four fixed seeds and one disposable joint-random seed.
Each role in that pipeline receives only its own secret inputs and outputs.
The roles produce standard threshold signatures before the authorized test recipient starts.
The parent does not receive the joint-random seed before the separate test recipient reconstructs it.
The artifact publishes that disposable seed after recovery.
The tool must never process wallet secrets.

Compare exact public keys and deterministic signatures across the two implementations.
Check seed recovery, changed messages, changed signatures, wrong keys, and context mismatch.
Include empty and nonempty contexts.
Record hashes of expanded private fixture keys rather than their full encodings.
Record source revision, source-file hashes, lockfile identity, raw samples, and commands.

## Implemented execution boundaries

The [kernel artifact](../evidence/ml-dsa-65-kernels-20261013.json) separates three kinds of execution:

| Execution | Implemented evidence | Privacy limit |
| --- | --- | --- |
| Cleartext reference and hybrid composition | Canonical encodings agree with RustCrypto and OpenSSL. | The host process holds complete fixture secrets. |
| Public half-gates benchmarks | Separate processes execute actual garbling and evaluation with bounded table frames. | Both evaluator labels transfer openly. No OT protects inputs. |
| Private key-generation pipeline | Persistent A and B processes execute 18 kernels with genuine passive OT and private outputs. | Shared-host separation provides no operating-system isolation. Composition review remains open. |

The private pipeline reuses three distinct schedules and executes these stages for each key:

1. Expand the XOR-shared seed once. Publish `rho` and retain separate XOR shares of `rho_prime` and `K`.
2. Execute eleven sampling kernels. Keep `rho_prime` shared and output masked additive coefficients for `s1` and `s2`.
3. Expand public `A` and compute each share of `t = A*s1+s2` locally.
4. Execute six rounding kernels. Publish `t1` and retain additive shares of `t0`.
5. Encode the same ordinary 1,952-byte public key at both roles.

Each kernel uses fresh garbling material and an execution domain.
The private pipeline never opens complete `rho_prime` or `t`.
Each role discards its `rho_prime` share after sampling.
A samples independent uniform residue masks below `q` using fresh random bytes.
The deterministic masks in the cleartext reference checks serve only as boundary probes.

After both roles finish, a separate test recipient reads their temporary material files.
It reconstructs the seed and verifies the canonical public key.
It reconstructs `K`, `s1`, `s2`, and `t0`, then compares the complete 4,032-byte private encoding with OpenSSL.
It signs with the recovered ordinary key and verifies the resulting standard signature.
Before recipient reconstruction, separate roles consume their shares and produce standard threshold signatures.
The recovered-key signature supplies a separate recovery check.

The artifact records each private case once.
Its four fixed seeds are zero, incrementing bytes, all `ff`, and alternating `aa` and `55`.
Its fifth case creates a disposable seed from independent random contributions at A and B.
Reproduce the artifact from the repository directory:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  --samples 100 --garbled-samples 3 \
  --output docs/evidence/ml-dsa-65-threshold-host-one-and-20261013.json
```

The sample counts apply to reference operations and successful public garbling workloads respectively.
They do not establish a latency distribution for private key generation.
Random masks, execution domains, the disposable seed, and timings vary between runs.

## First compatible share format

The first signing baseline is general two-party computation with local linear arithmetic.
Use uniformly masked shares, without short-share leakage or a randomness provider.
The private pipeline emits the following format into temporary role-local files.
The format has no production persistence or protocol-compatibility approval.

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
The native representation uses 32-bit unsigned residues in `[0, q)` and little-endian byte order.
The 4,352 coefficient shares occupy 17,408 bytes per role before metadata.
The two XOR shares add 64 bytes per role.
Each role's implemented file therefore contains 17,472 bytes.
It uses mode `0600` in a temporary directory specific to that role.
The harness deletes the case directory after verification.
This deletion provides no secure-erasure guarantee.

Keep `rho_prime` inside secure computation and discard it after sampling.
The baseline also keeps `t` private and computes its rounding securely.
Opening `t` is a separate optimization requiring a composition argument alongside these shares.
Never expose signing masks, rejected candidates, or secret rejection checks to save communication.
Generate each output mask independently. Consume garbled execution material once.

The shared signing state machine consumes these shares directly.
Before its first private signing circuit, each role checks a public digest of the operation identifier and FIPS signing request.
The request includes the public key, message, context, and randomness mode.
The exchange adds 73 bytes in each direction and rejects mismatches without a signature.
The caller must authenticate the operation and bind it to the wallet, key, material epoch, and trusted circuits.
This agreement check supplies no admission or durable replay guarantee.
Mithril and Trilithium need separate share-conversion and preprocessing analyses.
Their implementations cannot inherit compatibility merely because their outputs use ML-DSA.

The [signing options](ml-dsa-65-signing-options.md) distinguish commitment `w1` from challenge hash `c_tilde`.
The implemented baseline opens `c_tilde` and one aggregate acceptance bit per candidate.
It keeps rejected `w1`, responses, masks, hints, and individual checks private.
The challenge, stopping-count, and share-composition arguments still need independent review.

## Roles, authorization, and recovery

A and B are separate server holders under passive, honest execution.
They follow the protocol and do not collude.
The Router receives public operation state and results.
It receives no seed, signing share, or preprocessing secret.
The client authorizes the exact wallet, key, message, operation, and recipient.

The deployed benchmark uses two temporary Workers connected through a Service Binding.
Keep each role's credentials and persistence separate.
This experiment choice does not approve a production signing route.
The production manifests declare Rust/WASM Workers and wallet Durable Objects.
The benchmark excludes those storage and Router admission paths.
Its [deployment record](../evidence/ml-dsa-65-worker-complete-deployment-20261013.json) pins temporary role versions and local build hashes.
Physical placement and production storage locations remain unverified.

The local generation experiment creates one key identity.
The proposed signing protocol must consume fresh one-use material.
Refresh must retain that key identity and reject stale operation state.
Export sends each seed share to the same newly authorized recipient.
Only that recipient reconstructs the seed and checks the expected public key.
Recovery must reproduce the canonical key before new shares become active.
Production must satisfy these behaviors. Production authorization and lifecycle flows remain unimplemented.

The private experiment uses a shared host with direct process pipes and temporary files.
Its parent controls both processes and starts the test recipient after threshold signing.
This arrangement establishes no operating-system isolation or production recipient authorization.
Local arithmetic provides no native constant-time guarantee.
Transport authentication, production admission, and durable secret storage remain unimplemented.
Composition privacy remains subject to review under the accepted passive profile.
The host crypto measurements do not establish Cloudflare timing.
The [preliminary report](ml-dsa-65-preliminary-keygen-report.md) records complete deployed key-generation timing separately.

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
The offline and testnet E2E checks now verify empty-context threshold signatures.

The [read-only network observations](../evidence/ml-dsa-near-network-20261013.json) record mainnet protocol 86 and testnet protocol 87 on October 13, 2026.
Both exceed the pinned source's protocol-85 feature gate.
This version comparison does not exercise either deployed verifier.

The host harness encodes SDK transactions and verifies signatures through RustCrypto, OpenSSL, and the pinned AWS-LC algorithm.
The [testnet E2E report](../evidence/ml-dsa-65-near-testnet-e2e-20261014.json) records successful finalized execution of a threshold-signed one-yocto self-transfer.
Its account uses the public zero-seed fixture. This test establishes interoperability and supplies no production custody claim.
The two local roles complete canonical key generation and signing before the test recipient reconstructs the seed.
The network driver records protocol configuration before it signs or submits a transaction.

Testnet's RPC returns `ml-dsa-65-hash:` handles in `view_access_key_list`.
The `view_access_key` request accepts the full `ml-dsa-65:` key and rejects the hash handle with a parse error.
Transactions, AddKey, and DeleteKey also require the full key.
Retain the full public key in wallet metadata. The hash handle cannot recover it.
The Rust SDK exposes distinct `PublicKey` and `PublicKeyHandle` types, with ML-DSA Borsh tags 2 and 3 respectively.
The SDK provides conversion from a full key to its handle.

## Engine selection and deferred alternatives

| Candidate | Current decision | Required next evidence |
| --- | --- | --- |
| Hybrid half-gates plus general 2PC signing | Selected for integration | Independent composition review, target qualification, and revised hosted measurements |
| Full Yao | Resource comparison | Exact complete circuit cost |
| Three-halves garbling | Alternative | Implementation, security parameters, CPU, and total traffic |
| GMW / ABY2.0 | Complete native comparison favors half-gates | Improved private preprocessing and deployed comparison, deferred |
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

Extend the complete deployed signing measurements to a controlled repeated workload.
Review each public disclosure against the generated share format.
Measure the largest sampling and signing costs before selecting the next optimization.
Retain complete circuit counts, byte totals, and raw latency samples for comparison.
