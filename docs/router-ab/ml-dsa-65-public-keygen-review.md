# Public sampler decisions and public t0

Reviewed October 14, 2026 on `ml-dsa`.

## Decision and scope

The design passes this source-level privacy review for the agreed passive, honest-execution experiment, subject to the conditions below.
One worker may record its complete inputs, local state, messages, outputs, and public control flow.
It must remain unable to recover the wallet custody seed, canonical ML-DSA seed, secret signing coefficients, or sign alone.
This is a computational claim. It is neither zero leakage about the seed nor a formal protocol certification.
The existing classical OT, half-gate, pinned-schedule, authenticated-channel, and non-collusion assumptions remain in force.

The user explicitly permits public intermediate values that preserve this server-blind property.
Wallet-seed recovery and the canonical FIPS key identity remain required.
The review does not authorize a new signing disclosure, including rejected `w1`.

## Proposed public values

The new permitted keygen view contains:

- `rho` and the full vector `t = A*s1 + s2 mod q`.
- The acceptance bit for each candidate nibble in each evaluated sampler prefix.
- The selected positions, prefix length, continuation decision, and final exhaustion flag.

`Power2Round(t)` produces public `t1` and `t0`. The ordinary encoded public key remains `(rho, t1)`.
The wire public key and standard signature format do not change.
The sampling stream, candidate values, `rho_prime`, `K`, and `xi` remain inside secure computation or fresh secret shares.

## Sampler argument

ML-DSA-65 accepts a uniform nibble `U` exactly when `U < 9` and produces the coefficient `4-U`.
For each accepted nibble, conditioning on acceptance leaves a uniform value in `{0,...,8}`.
Independent uniform nibbles therefore give acceptance positions independent of their accepted values.
Selecting the first 256 accepted positions preserves the ordinary coefficient distribution and order.
A larger prefix changes the public positions examined. It does not change the accepted prefix already present.

SHAKE is deterministic. The independence argument applies to its ideal random stream, with the usual random-oracle assumption for hidden high-entropy inputs.
Acceptance bitmaps are deterministic fingerprints of the seed-derived stream. They permit offline checks of a guessed seed.
They do not supply an efficient seed-recovery method under that assumption.
This claim does not cover low-entropy wallet seeds or passwords used directly as seeds.
The existing wallet custody seed is a random secret, and its derivation remains unchanged.

Each candidate receives an independent uniform additive mask `R` modulo `q`.
A retains `R`; B receives `(4-U-R) mod q`. Each role's candidate-share vector remains uniform even conditioned on the public bitmap.
The host selects shares using only public positions. It does not inspect candidate values.
Unused accepted candidates and rejected candidates stay shared and are discarded.

The planned prefixes are 272, 408, and 481 bytes. They require two, three, and four SHAKE permutations respectively.
If a prefix is insufficient, the next circuit recomputes the same SHAKE prefix with independent masks and preprocessing.
The host selects all 256 coefficients from one successful branch. It does not combine partial polynomial outputs between branches.
The final cap remains 481 bytes. Final exhaustion aborts without replacing the wallet seed or deriving a different key.

Repeated recovery produces the same bitmap for the same seed and nonce. It uses new independent masks, labels, OT material, and sessions.
These repetitions preserve computational secrecy under the same assumptions. Correlated or reused masks would invalidate this argument.

## Public t0 and the combined view

Each worker computes `t_i = A*s1_i + s2_i` using its own additive shares.
The workers exchange these vectors and reconstruct `t`.
A receiver can already compute its own `t_i`. Given public `t`, the peer vector is exactly `t-t_i`.
The exchange therefore adds no independent equation beyond the explicitly opened `t`.

In the ideal-stream model, sampler decisions are independent of `(s1,s2)` and thus of `t`.
Combining the sampler decisions with full `t` therefore preserves the full-public-key Module-LWE key-recovery assumption.
The literature's full-`t` analysis supplies the black-box signature-security basis for this disclosure.
It also warns that public `t0` can help physical side-channel attacks. This review does not extend the accepted model to those attacks.

The signing material can encode `t0_A=t0` and `t0_B=0` in the existing additive layout.
Those six polynomials become public material. The eleven `s1,s2` polynomials remain uniformly shared.
Neither worker receives the other seed share, `K` share, or secret coefficient share.
Existing signing still requires both roles, protects its nonce values, and retains its existing rejection disclosures.
A later share refresh may randomize the public `t0` sharing without changing its value or privacy classification.

## Implementation and verification requirements

1. Preserve the wallet KDF, application binding, canonical seed derivation, SHAKE nonce encoding, and low-nibble-first order.
2. Use independent masks per candidate, polynomial, branch, and recovery. Destroy discarded secret buffers.
3. Reveal only acceptance bits. Pad a non-byte-aligned bitmap before private output bits, so public-byte extraction cannot reveal share bits.
4. Prepare every possible branch before readiness. Consume or discard each preparation exactly once.
5. Keep the 481-byte final cap and same-seed failure behavior.
6. Open only the prescribed `t` vector through the ordered role channel. Validate message shape, role, public `rho`, and residue bounds.
7. Exercise repeated recovery, changed inputs, a real continuation case, canonical reference equality, and signing with the new material.
8. Retain hosted timing from the client start through both completed roles, including table reads and public rounding.

The privacy argument does not depend on secret-dependent host branches being constant time after their controlling values become public.
Branches and memory access involving retained secret values still require review.
The performance campaign must report storage, message counts, preparation cost, and deadline misses separately from correctness.

## Primary references

- [FIPS 204](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf), Algorithms 6, 31, 33, and 35, and Appendix C: canonical sampling and the 481-byte minimum allowed cap.
- [Protecting Dilithium against Leakage](https://research.dial.uclouvain.be/server/api/core/bitstreams/db763926-a2e9-4daa-8993-489aed9a3eca/content), Sections 3.1 and 4.4: full `t` in the proof, and public sampling rejection decisions.
- [Uncompressing Dilithium's public key](https://eprint.iacr.org/2024/1373): the black-box and side-channel distinction for public `t0`.

The sampling-share and combined-view arguments above are this review's composition analysis. The references do not certify this implementation.

## Implementation review and evidence

An independent agent found no blocking deviation in the implemented output layout, masks, adaptive transitions, public rounding, or reservation ownership.
The [E2E and hosted report](ml-dsa-65-public-keygen-performance.md) records the resulting checks and performance limits.
Every sampler prefix and final public padding executes through real separate-role GC and OT in the native E2E.
The genuine three-block continuation executes in local and hosted Workers. Reconstructed private fields and standard signatures match ordinary implementations.
Natural final exhaustion is not observed. Its same-seed terminal error and zeroizing drop path received source review.
These checks support the bounded experiment. They do not expand the passive security claim.
