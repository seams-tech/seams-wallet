# Prepared signing privacy and one-use review

Date: October 14, 2026. Branch: `ml-dsa`. Production integration remains paused.

## Decision and scope

The conservative prepared signer passes the scoped passive disclosure review.
It retains wallet-seed recovery. Commitments stay private until both secret bounds pass.
The review does not establish a production security proof or a five-second deadline.

The key remains the canonical ML-DSA-65 key derived from the wallet custody seed.
Each role retains its own additive key shares. Neither role receives the full seed or secret signing coefficients.
The previously reviewed public sampler decisions and public `t0` remain in scope.
Transport authentication, durable admission, replay ledgers, and independent storage enforcement remain adapter requirements.

The signing nonce procedure changes. Both roles contribute fresh independent random bits directly to `y`.
This produces ordinary verifiable ML-DSA-65 signatures. It does not reproduce FIPS 204's prescribed message-bound hedged nonce derivation.
Canonical key generation, ordinary public-key encoding, signature encoding, and authorized recovery remain unchanged.
See [FIPS 204, Algorithm 7](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf).

## Preparation

For each candidate, the roles contribute independent XOR shares of 20-bit coefficients.
The private conversion computes `y = 2^19 - U` and returns independent uniform additive shares modulo `q`.
A's additive masks must be independent of its entropy bits.

Each role computes its share of `w = A*y` outside Yao.
A private decomposition returns XOR shares of `w1` and independently masked additive shares of `w0`.
Neither complete part becomes public during preparation.

Both roles also prepare fresh garbling and random oblivious transfer for the message-bound circuits.
Every candidate has independent masks, validity bits, labels, and transfer material.
The reservation binds the public key, material epoch, unique reservation identifier, and candidate count.

## Online disclosure boundary

1. Both roles agree on the reservation, operation identifier, and message digest `mu`.
2. A private Boolean circuit computes `H(mu || w1)` and opens the challenge hash.
3. Each role computes its shares of `z = y + c*s1` and `r_tilde = w0 - c*s2` locally.
4. Private circuits check every coefficient against both strict bounds.
5. One circuit opens only the conjunction of all eleven polynomial checks.
6. After that conjunction passes, the roles open `z` and compute public `r = A*z - c*t`.
7. Both roles compute `c*t0`, hints, and the remaining correctness checks publicly.
8. Both roles encode the standard signature and acknowledge its digest.

A failed secret bound leaves `w1`, `z`, `r_tilde`, and individual validity results private.
A later public hint rejection consumes the candidate without reusing it.
The disclosure distinction follows [Protecting Dilithium against Leakage, Section 3.2](https://research.dial.uclouvain.be/server/api/core/bitstreams/db763926-a2e9-4daa-8993-489aed9a3eca/content).
Opening `w1` after a failed secret bound would add the separate LWR assumption discussed there. This implementation does not make that disclosure.

## Why decomposition can move offline

For canonical ML-DSA-65, each coefficient of `c*s2` has magnitude at most `49*4 = 196`.
Under that bound, testing `|w0-c*s2| < gamma2-196` is equivalent to testing the low part of `w-c*s2`.
Any subtraction that crosses a decomposition boundary still fails the strict bound.
The exceptional residue `q-1` represents low part `-1` correctly.

The independent reviewer checked all 8,380,417 residues against decomposition.
The reviewer also checked 2,653,143 boundary pairs across every correction from -196 through 196.
These review checks support the argument; the retained E2E supplies executable circuit-boundary and signature evidence.

## One-use state and the combined view

`PreparedSigner::sign` consumes the complete reservation before message-bound corrections leave.
Rejected, canceled, failed, exhausted, and unused candidate handles are destroyed.
No API returns a candidate to the pool.
A production adapter must durably burn the reservation before invoking this consuming method.
An in-memory handle alone cannot enforce one-use state across process recovery.

Reusing a mask under different challenges can expose the secret through
`z1-z2 = (c1-c2)*s1`. Independent preparation and irreversible consumption are required.

A role's own entropy and uniformly masked shares remain independent of complete `y`.
After permitted reconstruction, the peer's response share equals the public response minus the role's existing share.
The public `r` and hints then follow from already permitted values.
This is the composition argument for honest passive execution. It does not cover malicious input selection or selective failure attacks.

## Retained preparation and timing

The garbler retains zero labels, the free-XOR delta, and precombined random-transfer pads.
If `Q0=L0 XOR P0` and `Q1=L1 XOR P1`, a correction of zero sends `(Q0,Q1)`.
A correction of one sends `(Q1 XOR delta,Q0 XOR delta)`.
These are the same online bytes as the uncompressed preparation because `L1=L0 XOR delta`.
The change halves retained garbler input material. All retained values, including delta, have drop-time wipes.

The online candidate uses 580,159 AND gates:
267,584 for the challenge, eleven checks of 28,415 each, and ten for the combined decision.
Its tables occupy 18,565,088 bytes, or 18,567,376 bytes with frame headers.
This count includes rejected attempts and establishes no latency by itself.

Secret arithmetic uses the existing fixed-operation modular implementation.
New branches use public roles, loop positions, declared public decisions, or local independent randomness.
Public signature completion can use variable-time arithmetic after the approved opening.
The source review is not a compiled side-channel certification.

## Packed GMW online backend

The same nonce and disclosure rules also support a GMW backend.
GMW represents each secret bit as two XOR shares. Fresh private correlations implement each AND operation.
Independent candidates occupy separate bit lanes in fixed-width integer words.
This packing shares only public circuit topology and preserves independent private randomness.

All candidate challenges run together. All eleven private checks per candidate then run together.
A final batch opens one combined decision per candidate.
The backend opens a candidate's response only after that candidate passes its complete secret checks.
All evaluated candidates are consumed, including unused candidates after an earlier success.

The three batches require 227 dependent AND-layer exchanges: 168 for challenges, 55 for bounds, and four for decisions.
Additional exchanges bind the layout and request, reconstruct permitted outputs, and confirm completion.
The layout agreement occurs before private preprocessing and rejects different ordered circuit lists.

The 32-candidate norm batch has a maximum 495,616-byte opening.
The larger private-transfer batch uses 16,384 choices, with fresh base transfers for every batch.
The current byte-message format uses a 32,816-byte masked-payload frame and a 262,192-byte extension-matrix frame.
The investigation transport bounds control messages at one MiB.
Table frames retain their separate 65,544-byte bound.

The OT implementation transposes eight adjacent columns together, caches only the public SHA-256 prefix,
and encrypts independent AES counter blocks in parallel.
These changes preserve the original bytes for each fixed family.
The byte-message Boolean-transfer family uses code 13, so previous-family frames fail validation.
No reusable base-OT state or additional rejected-commitment disclosure was introduced.

Independent review and native E2Es cover mixed circuits, more than 32 packed lanes, complete signatures, and canonical recovery.
Hosted measurements and pool lifecycle checks remain separate evidence requirements.

## Byte-sized Boolean OT messages

The Boolean correlation family now transfers one-byte messages under a distinct family code.
Its caller places one bit in byte zero and zeros in the other fifteen local buffer bytes.
The sender rejects nonzero suffixes. The receiver explicitly zeros unused output bytes after unmasking.
Other OT families still transfer complete sixteen-byte Yao labels.

Base OT, 128-bit matrix columns, AES keys, and SHA-256 pad derivation retain their security parameters.
Only the application message length changes. Unsent ciphertext suffixes carried masked known zeros.
This is ordinary short-message chosen OT under the existing passive IKNP assumptions.
It introduces no reusable base-OT state or nonce reuse.
The construction's message length and security parameter are separate, as described in [IKNP, sections 1.1 and 3](https://iacr.org/archive/crypto2003/27290145/27290145.pdf).
The code preserves fixed public indexing and masked choice selection.

The complete mixed-batch and signing E2Es must pass with the smaller messages before hosted selection.
Existing full-label-family vector checks remain required because the codec implementation is shared.

## Fresh base-OT arithmetic

The receiver computes the same two shared points with one fewer variable-base multiplication:

```text
shared_zero = aB
shared_one  = a(B - aG) = aB - (a² mod l)G
```

Here `l` is the prime group order. Dalek reduces scalar multiplication modulo `l`.
The fixed-base multiplication uses Dalek's existing constant-time precomputed table.
Equal Ristretto points have equal canonical compressed bytes, so the base-seed KDF inputs remain identical.
The new scalar square and point offset are wiped immediately after use.
Both shared points, derived seeds, and retained offer scalars retain their existing wipes.
This changes local arithmetic only. Base OTs remain fresh and their wire format remains unchanged.
Independent source review and the existing OT checks pass. The complete native and local Worker signers also pass.
This source review does not establish a generated-Wasm timing certification.
