# ML-DSA-65 signing options after private key generation

Reviewed October 13, 2026. This assessment selects no production protocol.
Continue with the uniformly masked key format in the [experiment contract](ml-dsa-65-experiment-contract.md).
Measure a private commitment-hash kernel before choosing the complete signing composition.

Every candidate must preserve the canonical public key from the hidden 32-byte FIPS seed `xi`.
Neither server may reconstruct `xi` or the complete private key during generation, import, conversion, or signing.
An existing-key sharing API satisfies this requirement only when its secret work executes inside two-party computation.
Only an authorized export recipient may reconstruct the seed outside that computation.
Use two passive, honest participants with separate secrets and no third trusted participant.

## Disclosures determine the implementation

The commitment `w1` and its hash `c_tilde` are different values.
Opening their rejected values has different security arguments.

**Source facts.** The [Dilithium designers' round-3 specification, sections 3.4 and 5.5](https://pq-crystals.org/dilithium/data/dilithium-specification-round3-20210208.pdf)
states that iteration counts do not disclose `s1` or `s2`.
It also permits disclosure of challenge hashes from rejected attempts in the random-oracle model, provided `w1` has high min-entropy.
A random oracle models the hash as an ideal random function.
High min-entropy means that no particular hash input has a substantial guessing probability.
These statements concern the ordinary implementation. They do not supply the complete proof for our share composition.

**Source facts.** [Quorus, section 1.3](https://www.usenix.org/system/files/conference/usenixsecurity26/sec26_prepub_bienstock.pdf)
explains why the usual accepted-transcript argument does not establish safety for opening rejected `w1`.
Quorus adds a small secret error to the commitment and proves security for its modified signing algorithm.
Its published MPC implementation assumes an honest majority.
Its algorithm analysis and that implementation assumption must be assessed separately.

**Inference.** A practical exact-algorithm baseline may keep `w1` private, compute its hash securely, and disclose only `c_tilde`.
The resulting challenge polynomial `c` can then be public.
This permits local multiplication of each key share by `c`.
Before adopting this boundary, document the joint view of challenge hashes, iteration counts, public keys, and each participant's shares.
Uniform masks help establish that view. They do not replace the argument about the disclosed outputs.
Do not infer permission to disclose `w1`, signing masks, rejected responses, or individual check failures.

## Exact-algorithm baseline

The following proposed stages follow [FIPS 204, Algorithm 7](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf):

1. Compute public `mu` from the exact formatted message and public-key hash.
2. Compute secret `rho_double_prime = H(K || rnd || mu)` using XOR-shared `K` and fresh joint randomness.
3. Compute `ExpandMask` securely. Output freshly masked additive shares of `y`.
4. Compute each share of `w = A*y` locally with public matrix data.
5. Recombine `w` only inside secure computation. Compute `HighBits`, its encoding, and the commitment hash there.
6. Compute the response products, low bits, norm checks, hints, and hint count with the selected disclosure boundary.
7. Release only an accepted standard signature. Destroy rejected material.

The number-theoretic transform, or NTT, permits efficient polynomial arithmetic.
Its linear operations can execute locally on additive shares.
If `c` remains private, `c*s1`, `c*s2`, and `c*t0` require secret multiplication.
Local NTT operations alone cannot compute those products.
Use secure product circuits or fresh two-party multiplication preprocessing in that case.
Any preprocessing comparison must include its generation, storage, conversions, and one-use consumption.

| Boundary | Consequence | Current decision |
| --- | --- | --- |
| All intermediates and acceptance remain private | Requires secret products and private selection of the first valid candidate. | Conservative resource baseline. |
| Only `c_tilde` and one aggregate acceptance result become public | Challenge products become local. Secure hashing and all rejected responses remain private. | Promising source-backed direction. Composition review remains required. |
| Rejected `w1` becomes public | Hashing becomes local. Ordinary ML-DSA analysis does not establish this disclosure. | Require a proven compatible protocol change. |

The first row needs a fixed public execution schedule to hide the successful attempt's position.
The [reviewed NIST corrections](https://csrc.nist.gov/files/pubs/fips/204/final/docs/fips-204-potential-updates.xlsx)
set the minimum bounded ML-DSA-65 signing loop at 821 attempts.
The experiment contract records the reviewed sheet digest.
This is a maximum limit. It does not require 821 attempts when the disclosure boundary permits stopping information.
Small batches still disclose a coarse stopping count if their completion controls further execution.

**Resource inference.** A direct fixed schedule needs approximately 34 Keccak permutations per attempt for masking, commitment hashing, and bounded challenge sampling.
At 38,400 AND gates per permutation and 32 table bytes per AND, hashing alone is approximately 34.30 GB across 821 attempts.
This estimate excludes compiler simplification, products, selection, hints, OT, and framing.
It establishes a resource comparison, not measured latency or an impossibility result.
Public challenge sampling removes its private circuit cost after review justifies the second boundary.

## Mithril with canonical existing keys

**Source facts.** [Efficient Threshold ML-DSA, sections 3.4–3.5](https://www.usenix.org/system/files/conference/usenixsecurity26/sec26_prepub_celi.pdf)
shares an existing secret using short Gaussian shares conditioned on their sum.
The paper explicitly identifies non-trivial information about the secret in those shares.
It reports 7–12 bits of security loss for existing-key sharing.
Its formal reduction uses Gaussian secrets. Its smaller parameters require a heuristic analysis beyond that reduction.
The [authors' implementation](https://github.com/Threshold-ML-DSA/Threshold-ML-DSA)
supports ML-DSA-65 and identifies itself as an unreviewed academic prototype.

**Inference.** Secure execution of the existing-key sampler could preserve canonical key identity without plaintext import.
It would still change our uniform-share privacy contract.
Independent repeated sharing also needs a separate bound.
For two conditioned Gaussian shares, one share resembles a noisy observation centered near half the secret.
Repeated observations can reduce that noise through averaging.
Single-sharing analysis cannot establish safety for unlimited recovery or refresh.
Do not select this option without explicit acceptance of its privacy difference and a complete lifecycle analysis.

## Trilithium with two-party preprocessing

**Source facts.** The [ePrint entry](https://eprint.iacr.org/2025/675)
identifies June 30, 2026 as the latest revision.
The paper PDF was unavailable through the research tool during this assessment.
Its latest complete proof and algorithms therefore remain unreviewed here.

The [authors' NIST preview, section 2.4](https://csrc.nist.gov/csrc/media/Projects/threshold-cryptography/documents/TCall-1/SplitForge-PW01.pdf)
describes additive sharing and a correlated randomness provider.
The provider supplies shared randomness used for nonlinear operations.
The preview states that an MLWR variant justifies public commitments, including rejected runs.
It reports up to 100 MiB from provider to server per signing attempt.
These provider costs must remain in any comparison.
Do not apply older criticism of a heuristic proof to the newer revision without checking that revision.

**Inference.** Two-party secure computation can generate the required correlations in principle.
Replacing the provider requires an exact correlation specification and a composition argument.
Import must securely convert our canonical shares, including any authentication material the protocol requires.
Neither participant may emulate the provider by learning both randomness shares.
The reported provider-assisted timings do not predict the replacement's cost.

## Next measurements

1. Compile private `ExpandMask`, `HighBits`, commitment hashing, aggregate checks, and hint encoding against independent public fixtures.
2. Measure one candidate with fresh private outputs before allocating a complete fixed schedule.
3. Specify and review the exact challenge/count disclosure functionality and its share-composition argument.
4. Measure the conservative private-product path and the justified public-challenge path with identical accounting.
5. Screen the Quorus algorithm change with two-party kernels separately from its honest-majority implementation.
6. Complete candidate revision, preprocessing, import, and lifecycle reviews before implementing Mithril or Trilithium conversions.
7. Produce a separate-role signature, check it independently, and then repeat on Cloudflare with complete resource records.

Successful verification establishes correctness and interoperability.
It does not establish privacy for an added disclosure or select the fastest candidate.
