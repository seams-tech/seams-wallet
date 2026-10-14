# Mithril ML-DSA-65 feasibility, export, and recovery

Date: October 15, 2026. Investigation branch: `ml-dsa`. Production integration remains paused.

## Decision

**Mithril is eligible for a bounded research prototype. It is currently ineligible for production or a five-second service claim.**
Canonical private import is mathematically possible for two parties.
It requires secure conditional sampling and a new private-share constructor.
The stock seed constructor fails canonical key identity and handles all secrets centrally.

The main blocker is the security of the resulting short shares across the complete wallet lifecycle.
Secure computation protects the conversion transcript. It cannot remove information inherent in the output shares.
The current server-blind requirement is computational secrecy under passive, honest execution.
It does not require perfect statistical secrecy, but it does require a justified security bound for this new view.

Retain GMW with silent OT as the current implementation path.
Mithril could substantially reduce recurring traffic and dependent network exchanges.
Its native result justifies further investigation. It does not establish the safety or performance of canonical private import.

## Export options under investigation

Wallet-seed recovery and secret export are separate capabilities.
Recovery restores the same signer through the wallet's documented derivation procedure.
Export releases a seed, private key, or recovery package to an authorized recipient.
All three options below must produce standard ML-DSA-65 signatures that NEAR can verify.

The user requested comparison of these options. No replacement export policy is selected yet.
Standard FIPS seed/key export remains the active requirement until the user selects a different option.
The conditional conversion, security analysis, and cost estimates elsewhere in this report apply to option 1.
They do not establish the provisioning cost of options 2 or 3.

| Option | Supported export | Wallet-seed recovery | Implication for Mithril provisioning |
| --- | --- | --- | --- |
| **1. Standard FIPS seed/key export** | A canonical 32-byte FIPS seed that reproduces the same ordinary key, with corresponding standard private-key export | Reproduce the canonical FIPS key from the wallet seed and stable derivation binding | Requires canonical key generation followed by private conversion into Mithril-compatible shares |
| **2. Mithril-specific export** | A documented derivation seed or recovery package understood by compatible software | Reproduce the same signer through a specified Mithril derivation procedure | Permits Mithril-specific key generation and removes the requirement to convert a predetermined canonical FIPS key |
| **3. No export interface** | No supported release of signing secrets | Can still restore the same signer through the SDK's wallet-seed recovery procedure | Also permits Mithril-specific key generation. Removing the export interface alone supplies no additional cryptographic speedup |

### Compatibility and security boundaries

Standard verification does not imply standard seed derivation.
A Mithril-specific seed may reproduce its signer through our algorithm while producing a different key when imported through ordinary FIPS seed APIs.
The retained native screen demonstrates this difference for the stock constructor.

Standard expanded-private-key export is a separate question from canonical seed import.
Option 2 might permit reconstruction and export of an ordinary expanded private key despite lacking a corresponding canonical seed export.
That capability remains unverified. Test the exact encoding, imported coefficient ranges, independent signing, and signature verification before promising it.

Options 2 and 3 still require server-blind provisioning.
The stock constructor receives the full seed and creates all shares centrally, so it cannot run unchanged on either worker.
Investigate private deterministic share generation with only the necessary secret operations inside two-party computation.
Each worker must receive only its own share.
Keep signing randomness fresh and independent of the deterministic long-lived recovery material.

For Mithril-specific recovery, document the algorithm, parameters, encoding, coefficient order, and stable role assignment.
A recovery package must contain or identify every non-secret input needed to reproduce the same public key.
Keep the original derivation specification available for every supported recovery package.
Review repeated recovery, refresh, role reassignment, and accumulated observations for the selected construction.

The main possible provisioning simplification comes from permitting Mithril-specific derivation.
Both options 2 and 3 permit that change. Neither option yet has a measured private key-generation cost.
The stock native signing timings do not establish those costs.

If the wallet seed and documented procedure suffice to recreate the signer, independent reconstruction remains technically possible.
Under that design, option 3 defines a product interface policy. It cannot guarantee that a seed holder can never reconstruct signing secrets.

### Investigation tasks before policy selection

1. Retain option 1 as the canonical-export baseline and evaluate its private conversion costs.
2. Specify a deterministic, server-blind Mithril derivation for options 2 and 3. Verify that recovery reproduces the complete public key.
3. Define the minimum Mithril export package and test restoration without the original service or worker state.
4. Separately test standard expanded-private-key import and signing for a reconstructed Mithril key.
5. Measure complete private provisioning, first-signature latency, recurring signing traffic, and recovery for each eligible construction.
6. Present the compatibility and security tradeoffs for explicit policy selection before changing the implementation contract.

## Evidence and source limits

| Evidence | Established result | Limit |
| --- | --- | --- |
| [Retained native screen](../evidence/ml-dsa-65-mithril-native-screen-20261014.json) | 100 measured signatures, 2.110 ms median, 94,723.2 mean protocol bytes, 12 maximum attempts | One native process executes both roles. No private import, network, Worker, or isolation measurement |
| Independent OpenSSL checks in that artifact | All 101 signatures verify, including warm-up. Altered messages fail | The threshold key differs from the ordinary key derived from the same seed |
| [Pinned implementation](https://github.com/Threshold-ML-DSA/Threshold-ML-DSA/tree/66e269e75dd8f5d722675a3d276a1aedc58bc4ef) | ML-DSA-65 support and the PR #6 state-reuse fix | Academic prototype. No reviewed canonical-share conversion |
| Conditional sampler below | Explicit two-party distribution and conservative resource model | Mathematical derivation and arithmetic estimates. No compiled circuit or timed sampler |

The upstream `HEAD` query on October 15 returned the tested commit, `66e269e75dd8f5d722675a3d276a1aedc58bc4ef`.
The [ePrint entry](https://eprint.iacr.org/2026/013) identifies the USENIX Security 2026 revision and supersedes paper 2025/1166.
The ePrint PDF and version archive returned HTTP 403 during this review.
I read the [publisher's paper](https://www.usenix.org/system/files/conference/usenixsecurity26/sec26_prepub_celi.pdf), especially sections 3.1–3.5, and the pinned implementation.
Its PDF SHA-256 is `0ce86040bdae7dd5d26611a53ba14a05408bfce85c100cc44b8a8ba3bce7176f`.
Section 3.4 delegates some smoothing and hint-MLWE details to the extended version.
Those unavailable details remain a proof-review requirement. This report does not claim to verify them.

## Exact conversion for two parties

FIPS ML-DSA-65 has 2,816 secret coefficients across `s1` and `s2`: `(5 + 6) * 256`.
Each canonical coefficient belongs to `{-4,...,4}`.
The current private key generator supplies uniform additive shares modulo `q = 8,380,417`.
Let `a + b = s mod q`, where A knows `a` and B knows `b`.

For 2-of-2, the paper's replicated sharing has exactly two base shares.
Its zero-sum lattice is `{(v,-v): v ∈ Z}`.
The following derivation directly samples the ideal conditional Gaussian on its shifted lattice.
It avoids a general multidimensional GPV sampler.
GPV is a method for sampling discrete Gaussian vectors on lattices.

Define an underlying Gaussian weight by `gσ(x) = exp(-x²/(2σ²))`.
Here `σ` is the exponent's width parameter. A discrete distribution's actual standard deviation can differ from that parameter.
For a fixed canonical coefficient `s`, use:

```text
Pr[X = x | s] = gσ(x) gσ(s-x) / Σu gσ(u) gσ(s-u)
             = exp(-(x-s/2)²/σ²) / Σu exp(-(u-s/2)²/σ²)
Y = s - X
```

The equality follows from `x² + (s-x)² = 2(x-s/2)² + s²/2`.
It preserves the exact integer sum. Modulo-q arithmetic therefore preserves the canonical public key.

Write `s = 2h + e`, where `h = floor(s/2)` and `e ∈ {0,1}`.
Only two public probability tables are necessary:

```text
Pr[V = v | e] ∝ exp(-(v-e/2)²/σ²)
X = h + V
Y = h + e - V
```

This is a sampler for the paper's ideal conditional Gaussian.
It is not the stock implementation's uniform-share key generator.
Its signing parameters require separate qualification.

### Private execution

1. Recombine `a + b` modulo q inside secure computation.
2. Compute `u = (s + 4) mod q` internally. Its known range is 0 through 8.
3. Set hidden `e = u & 1` and `h = (u >> 1) - 2`.
4. Combine independent private random contributions into hidden uniform sampling bits.
5. Select the distribution using hidden `e` and sample hidden `V`.
6. Compute `X` and `Y`. Deliver only `X` to A and only `Y` to B.
7. Each role locally converts its signed coefficients to residues and computes its NTT cache.

The number-theoretic transform, or NTT, accelerates polynomial multiplication.
Private output delivery must follow the existing Yao output mechanism, including fresh masks where needed.
Neither role may receive a joint random tape, the parity, the selected table index, or the other output.
For example, knowing `V` and one's output can reveal `h`.

Validate raw encodings at the import boundary.
Core conversion accepts only normalized shares from canonical key generation.
It must never clamp a coefficient or replace a failed canonical seed.

Keep the existing wallet KDF, canonical seed `xi`, secret `K`, and public-key derivation unchanged.
KDF means key derivation function.
Preserve the seed and `K` shares for authorized reconstruction of the ordinary 4,032-byte private-key encoding.
Mithril signing does not need to reconstruct either field.
Recovery must compare the ordinary public key and expanded private key against an independent FIPS implementation.
These identities follow [FIPS 204's key generation and encoding rules](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf).

### Required implementation changes

The pinned [`NewThresholdKeysFromSeed`](https://github.com/Threshold-ML-DSA/Threshold-ML-DSA/blob/66e269e75dd8f5d722675a3d276a1aedc58bc4ef/implementation/sign/thmldsa/thmldsa65/internal/dilithium.go)
samples independent uniform shares and sums them centrally.
The canonical import constructor must instead accept one role's conditioned coefficients and the already established public key.
It must derive only that role's local caches.

The stock private-share codec assumes coefficients in `[-4,4]` and packs four bits per coefficient.
Gaussian shares exceed that interval. Reusing this codec would corrupt their values.
Use a bounded signed representation with an explicit sampler specification and encoding version at the persistence boundary.
The example below needs seven signed bits per coefficient.
Do not change the ordinary FIPS export encoding.

## Work placement and preparation

No operation inherently requires Yao rather than another secure-computation protocol.
Yao fits the existing implementation and has few network dependencies.
The minimum private functionality comprises modular recombination, parity-dependent sampling, secret selection, and role-specific output delivery.

| Operation | Private computation needed? | Earliest preparation |
| --- | --- | --- |
| Canonical seed expansion and coefficient sampling | Existing key-generation Yao | Garbling and random OT before the seed. Evaluation after the seed |
| Two conditional probability tables | No. Constants are public | Before the seed and matrix |
| Hidden draws for both parity cases | Yes, including jointly private random bits | Before the seed and matrix, if output as fresh XOR shares |
| Recombine canonical shares, select parity draw, form role outputs | Yes | Tables and OT before the seed. Evaluation after canonical coefficients exist |
| Matrix expansion, NTT, multiplication by public matrix | No | Once public `rho` is known |
| Mithril hyperball randomness | Local to each role | Before the seed and matrix, with fresh independent randomness |
| Mithril commitment `A*r + error` | Local to each role | After matrix A is known |
| Commitment hash | Local, then exchanged | After public-key hash and commitment exist |
| Challenge hash, products with local short shares, local rejection, combination | Local with protocol messages | Message-bound work follows request admission |

OT means oblivious transfer. It gives a participant its private circuit input without exposing that input to its peer.
Precompute both hidden draws `V0` and `V1`, then select one privately when `e` exists.
They may use independent tapes or one shared hidden uniform tape.
Only the selected distribution matters when neither candidate is disclosed.
Keep both draws masked until selection. Burn the unused draw with the selected draw.

A local plaintext sampler followed by secret sharing is insufficient.
Its sampler would remember both candidates and could combine them with its eventual output to infer the canonical coefficient.
Likewise, secure sampling must hide any rejection trace dependent on `s` or parity.
Use fixed schedules for this first prototype.

Mithril adds a secret error to each commitment and uses local rejection on an enlarged vector.
This permits its public commitment flow under its own security argument.
It does not authorize opening rejected commitments in the existing ordinary-algorithm signer.
See the separate [prepared-signing review](ml-dsa-65-prepared-signing-review.md).

## Conditional sampler resource model

Use `σ² = 20/3` only as a concrete sizing example.
This equals the variance of the stock uniform `[-4,4]` coefficient distribution before conditioning.
It does not establish the correct imported-share parameter.
After conditioning and averaging over canonical coefficients, each output's variance is approximately 5.
That differs from the stock share variance of `20/3`.

For this example, truncate `V` to `[-32,32]` and use a 192-bit inverse cumulative distribution.
The cumulative distribution lists the probability of all values at or below each table entry.
Set each threshold to `floor(2^192 * cumulative_probability)`.
Select the first threshold above a uniform 192-bit integer, with the final interval as the default.
Use high-precision public arithmetic to generate and independently check the tables.

Numerical summation with 100 decimal digits gives omitted tail masses near `2^-236.86` and `2^-230.77` for the two parities.
These are numerical estimates. A production table needs an analytic tail bound and certified rounding.
CDF rounding contributes at most `2,816 * 64 / 2^192`, approximately `2^-174.54`, for one selected vector.
The joint error budget must include truncation, both precomputed draws where relevant, numerical rounding, and repeated use across wallets.
This precision does not upgrade the existing 128-bit MPC primitives to 192-bit security.

### A deliberately simple circuit estimate

Compare the random integer against all 64 thresholds for each parity.
A comparison against a fixed 192-bit constant needs at most 191 nontrivial AND gates with free XOR.
Adjacent comparison results produce one-hot interval indicators using XOR.
Encoding those indicators against constant output values also uses XOR.
Select between the two seven-bit outputs with seven AND gates.

Budget 128 further AND gates per coefficient for normalized modular recombination and extraction.
Budget 14 for the two short additions or subtractions.
Those arithmetic budgets require confirmation in the existing circuit builder.
They are planning allowances, not measured gate counts or a proven optimum.

| Item | Analytical estimate |
| --- | ---: |
| Sampler comparisons per coefficient | `2 * 64 * 191 = 24,448` ANDs |
| Complete conversion allowance per coefficient | `24,448 + 7 + 128 + 14 = 24,597` ANDs |
| Complete conversion, 2,816 coefficients | 69,265,152 ANDs |
| Half-gate tables at 32 bytes per AND | 2,216,484,864 bytes, about 2.22 GB |
| Tables for a 16-coefficient chunk | 12,593,664 bytes |
| Two masked seven-bit draws per coefficient, per role | 4,928 packed bytes |
| Final seven-bit coefficient shares, per role | 2,464 packed bytes |
| Conversion after draws are prepared, excluding share reconstruction overhead | 419,584 ANDs, about 13.43 MB of tables |

The last line uses the same 149-AND arithmetic and selection allowance.
XOR reconstruction of precomputed draws adds no AND gates.
Input/output masking, OT, protocol headers, integrity metadata, and storage traffic still add bytes.

The conservative comparison circuit is expensive even though its mathematical function is simple.
Its one-time tables can exceed the old signer's recurring gigabyte-scale preparation.
The difference is that imported short shares can serve many signatures.
Amortizing import must include wallet lifetime, recovery, and abandoned preparations.

Joint fresh sampling needs 540,672 random input bits from each role, or 67,584 packed bytes each.
At 16 bytes per input label, each role's corresponding labels occupy about 8.65 MB.
Two-pad OT representations can double that component.
Tables dominate total bytes. They do not describe peak memory by themselves.
Gate schedules, wire labels, OT pads, Wasm memory, and JavaScript buffers also consume memory.

Cloudflare permits [128 MB per isolate, including Wasm and JavaScript](https://developers.cloudflare.com/workers/platform/limits/#memory).
The complete table set cannot reside in one isolate.
Stream bounded chunks and discard completed labels and tables.
Even one 256-coefficient polynomial exceeds 200 MB under this estimate.
The 16-coefficient chunk is a starting measurement unit, not a demonstrated memory fit.

No sampler latency was measured.
At an assumed effective rate of one million ANDs per second, 69.27 million ANDs take about 69 seconds per evaluated circuit.
At five million per second, they take about 13.9 seconds.
Moving 2.22 GB over an assumed 100 MB/s path takes about 22.2 seconds before other work.
These are sensitivity calculations, not Worker forecasts. Overlap can change the total.
Preparing the hidden draws moves most of this cost before key arrival.
It does not remove the work, storage, or pool replenishment cost.

Compile the fixed tables before choosing an optimized sampler.
Constant propagation, shared comparisons, symmetry, or a discrete distribution circuit could reduce this conservative count.
Any proposed replacement must retain the exact specified distribution or a bounded approximation.
An unbounded expected-time sampler provides no fixed latency or private rejection-trace guarantee.

### A smaller bounded-share alternative requires a different argument

Conditioning the stock uniform shares directly gives another exact sum:

```text
X uniformly samples [max(-4, s-4), min(4, s+4)]
Y = s - X
number of choices = 9 - abs(s)
```

This keeps both outputs within the existing codec's range.
It needs a small secret-dependent uniform sampler, rather than a wide Gaussian CDF.
Thus, the 2.22 GB estimate is not a lower bound on all possible canonical conversions.
The selected interval and any rejection count must remain private.
Its nine cases permit fixed-table sampling with a stated approximation error.

This alternative changes the hint distribution again.
For example, `X = 4` rules out every negative canonical coefficient.
Direct enumeration gives approximately 0.407289 bits of scalar mutual information under the independent uniform prior.
That exceeds the illustrative Gaussian value and supplies no lattice security bound.
The stock generator produces independent uniform shares before their sum defines a key.
Fixing a canonical uniform secret and then conditioning shares produces a different joint distribution.
Neither the stock benchmark nor the paper's Gaussian existing-key reduction qualifies this replacement.
Keep it as a separate parameter-analysis candidate if Gaussian import costs prove impractical.

## Security of the short-share view

For one coefficient, A sees a noisy observation centered exactly at `s/2`.
For the ideal distribution above, the posterior is:

```text
Pr[s | X=x] ∝ Pr[s] * exp(-(x-s/2)^2/σ²) / Zs
Zs = Σu exp(-(u-s/2)^2/σ²)
```

The normalization depends on parity. It must remain in the analysis.
This information exists during honest execution.
Yao cannot simulate it from a uniform modulo-q share alone.

Under the illustrative independent scalar prior `s ~ Uniform{-4,...,4}`, numerical enumeration gives:

| Quantity for `σ² = 20/3` | Numerical estimate |
| --- | ---: |
| Entropy of one coefficient before observing a short share | 3.169925 bits |
| Conditional entropy after observing one share | 2.878113 bits |
| Mutual information | 0.291812 bits |
| Best single-coefficient guessing probability | 0.208227 |

Entropy measures uncertainty. Mutual information measures its average reduction.
These scalar values are not a lattice attack estimate or a security-level claim.
Do not multiply them into a claimed seed leakage count.
The actual coefficients derive from a 256-bit seed and are computationally modeled as independent.
The whole view also includes `rho`, full public `t`, sampler acceptance positions, signatures, aborts, and previous shares.

The paper's quoted 7–12-bit security loss does not establish our ML-DSA-65 security loss.
Its formal existing-key reduction assumes Gaussian canonical secrets.
FIPS ML-DSA-65 uses bounded uniform coefficients with `eta = 4`.
Its small-width heuristic discussion uses `sqrt(2)`, which does not specify our selected import distribution.
Matching a variance alone also leaves different support, tails, and conditional distributions.

A parameter review must cover:

- The exact 2-of-2 conditional distribution and every truncation or rounding error.
- ML-DSA-65 dimensions, full public `t`, and each role's conditioned auxiliary information.
- Lattice attacks with those hints, including classical and quantum cost models and estimator versions.
- The bound on challenge-times-share norms for the imported Gaussian tails.
- Local rejection security, signing-query limits, and success probability under those new shares.
- The composition with canonical SHAKE generation, accepted public sampler decisions, and the MPC assumptions.

The pinned signer uses three parallel candidates, `nu = 6`, `r = 501495`, and `rPrime = 501613` for 2-of-2 ML-DSA-65.
These values belong to its current share generator.
They are starting inputs for analysis, not approved parameters for canonical Gaussian import.
The reviewed classical OT also does not establish post-quantum privacy for recorded provisioning transcripts.
This is an inherited MPC limitation that the feasibility comparison must preserve explicitly.

## Recovery, repeated leakage, and refresh

Fresh independent conditioned shares create fresh observations of the same canonical secret.
For approximately Gaussian noise, averaging `r` observations reduces the variance of their mean by `r`.
Twice that mean estimates `s` with variance approximately `2σ²/r`.
At the illustrative width, its standard deviation is approximately 0.365 after 100 sharings and 0.115 after 1,000.
These values illustrate accumulation. They are not a complete key-recovery attack analysis.
An unlimited fresh-sharing recovery API therefore has no support from the one-sharing argument.

**Deterministic recovery can avoid new output observations if it reproduces exactly the same role-assigned short shares.**
Derive a private sampling tape from a stable, domain-separated secret tied to the wallet's canonical key.
Use the same sampler, parameter set, coefficient order, and stable role mapping on every recovery.
Keep the tape inside secure computation.
Fresh Yao labels, input masks, OT, and transport sessions remain mandatory.
Under the required PRF or random-oracle composition argument, repeated transcripts then add no fresh conditional-share samples.
PRF means pseudorandom function.

Neither a public seed nor a role-known sampling tape works.
Deriving randomness from the current uniform shares also fails deterministic recovery because those shares change.
A new sharing version, endpoint identity, parameter, or epoch in the derivation can produce another observation.
Swapping role assignments can give one participant both complementary shares and immediately reconstruct the secret.
Recovery policy must bind the same role across backups, devices, and server replacement.

Determinism has a cost in preparation.
The final Gaussian draws now depend on the recovered secret and cannot be fully evaluated before that secret exists.
A simple SHAKE256 expansion of 67,584 tape bytes requires approximately 497 permutations.
At the existing 38,400-AND permutation cost, that adds about 19.08 million ANDs and 610.71 MB of half-gate tables.
Domain framing can add permutations. This estimate excludes the conditional sampler itself.
Pregenerated tables move communication earlier, but their evaluation still follows seed input.
A seed-only deterministic recovery path therefore has a larger online task than the fresh precomputed-draw path.
Persisting the original masked draws can accelerate restoration, but creates an additional recoverable artifact and rollback obligation.

Deterministic recovery also preserves previously compromised shares.
It provides no proactive refresh that invalidates an old share.
Adding a uniform zero sharing makes coefficients large and defeats the stock short-share signer.
Generating new conditioned short shares requires an accumulated-leakage bound and a finite policy for refresh.
A new ordinary key would change the required canonical key identity.
These tradeoffs need an explicit lifecycle decision before implementation can become eligible.

Signing randomness is separate from recovery randomness.
Never deterministically regenerate a signing reservation from only the wallet key and a counter that can roll back.

## Signing state, recurring resources, and first signature

The [state-reuse disclosure](https://www.projecteleven.com/blog/key-recovery-from-state-reuse) explains the underlying failure:
two responses from the same randomness under different challenges expose an equation in the secret share.
PR #6 already fixes in-memory reuse in the tested revision.
It moves state through Round2, consumes it in Round3 even on error, and clears its stored randomness.
Atomic state consumption rejects concurrent use of copied handles.
The fix cannot protect restored snapshots or persisted copies.

Each three-candidate attempt sends 45,760 protocol bytes across both roles:
64 bytes of commitment hashes, 26,496 bytes of commitments, and 19,200 bytes of responses.
Those values follow the implementation's codecs and agree with the native artifact.
The retained average consumes 2.07 attempts per signature. Its maximum is 12 attempts.
Those observations belong to the stock key and parameters.
Canonical conditioned shares may change retries and their cost.

Per role, three retained `FVec` values contain `3 * 2,816 * 8 = 67,584` bytes.
Packed commitments add 13,248 bytes. The retained core is approximately 80,832 bytes per attempt.
This excludes slices, allocation headers, matrix and key caches, scratch vectors, hashes, runtime memory, and storage encryption.
During generation, the implementation also allocates normal samples and a SHAKE buffer.
These are structural byte counts, not measured peak memory.

This signing preparation uses local randomness and local arithmetic. It needs no recurring Yao or OT pool.
Preparing commitments before message arrival can move Round1 work and its hash exchange offline after key identity is known.
Later rounds still bind the message and peer commitments.
Fresh attempts must replace all three candidates after failure or abandonment.

For stock measurements, about 167 KB of retained state is consumed per role per successful signature on average.
Persistence adds writes, reads, authentication metadata, tombstones, and abandoned states.
Local computation for replenishment remains unmeasured on Wasm.
The native timer includes replenishment in Round1. It excludes durable storage and admission.
Measure first-signature latency from canonical provisioning through complete verification, with import and empty-pool costs shown separately.

The pinned hyperball sampler uses Box–Muller normal sampling, floating-point norms, scaling, and rounding.
Those are local operations, so they require no floating-point Yao circuit.
A Worker port must qualify numerical precision, endpoint handling, finite-value checks, and distribution error against the proof.
For example, the code permits a zero input to `log` when its random integer is zero.
The continuous mathematical sampler and this finite-precision implementation need a separate comparison.
Do not infer distribution security from successful signature verification.

### Durable consumption requirements

Use a durable state machine such as `prepared → bound → spent`, with terminal failure states also spent.
One authoritative role-local ledger must cover every copy and concurrent request.

1. Bind each reservation to the key, stable roles, material version, unique attempt, and all candidate indices.
2. Durably bind the exact message, context, peer commitments, and transcript before the first message-bound use.
3. Durably spend it before releasing any response that depends on its randomness.
4. On uncertain completion, burn it. Never return it to a pool.
5. Retransmit only previously stored identical response bytes for the same bound transcript.
6. Use fresh randomness for every new challenge, retry, cancellation replacement, or exhausted reservation.
7. Reject duplicate concurrent claims atomically on each role.
8. Keep spent records outside any rollback domain that can restore the corresponding randomness.
9. On snapshot restore, retire old pools unless an independent durable authority can prove their unused state.

Cross-role completion need not be atomic to remain safe. An uncertain attempt can be lost.
Each role must independently prevent a second response.
Encryption, an in-memory consumed flag, or an epoch stored in the same rollback snapshot cannot enforce this property.
Lost responses, crashes between spend and send, stale replicas, and restored backups need explicit E2E coverage.

## Comparison with GMW and silent OT

The concurrent [silent-OT report](ml-dsa-65-silent-prototype-report.md) and its retained artifacts provide newer evidence than the original communication model.
These files belong to the parallel investigation. This review did not change them or deploy Workers.

| Property | Mithril with proposed canonical import | Current GMW plus silent OT |
| --- | --- | --- |
| Canonical private key generation | Reuses existing keygen, then adds unimplemented conditional import | Implemented and independently checked |
| Long-lived secret shares | Short, informative, parameter-dependent | Uniform modulo q |
| Recovery | Must bound fresh leakage or reproduce stable short shares | Fresh uniform masks preserve the reviewed view |
| Online protocol | Three rounds per attempt, with possible Round1 preparation | 227 dependent AND-layer exchanges per evaluated reservation, plus bindings and outputs |
| Recurring communication | Stock native mean 94.7 KB per signature. Imported-key value unknown | Hosted eight-candidate reservation: 9,886,081 preparation bytes and 2,332,200 online bytes on successful samples |
| Preparation | Local hyperball work per attempt. Potentially large one-time secure import | Silent correlations and private nonce/decomposition work per reservation |
| Extra security work | Conditioned-share hints, tails, recovery correlations, numerical sampler | LPN correlation construction and complete composition |
| Hosted successful-signature deadline | Unmeasured | Four of five measured reservations succeed below five seconds. One exhausts its candidates |

The [hosted eight-candidate artifact](../evidence/ml-dsa-65-silent-eight-worker-hosted-20261015.json) contains five measured requests after warm-up.
Successful requests take approximately 235.6–568.8 ms online.
The failed reservation completes in approximately 200.0 ms and supplies no signature.
Measured readiness takes approximately 89.9–158.3 seconds and includes fresh canonical key generation.
These times do not isolate steady-state refill cost.
The recurring byte counters exclude initial key generation and external storage traffic.
They exceed the earlier payload projection. Keep measured totals in the comparison.

Mithril trades a smaller recurring protocol for harder share-security and recovery questions.
GMW retains the current share contract and has deployed composition evidence, but its refill cost and pool exhaustion still fail the complete target.
Neither candidate currently establishes consistent successful signing below five seconds with practical cold and replenishment costs.

## Minimal prototype and exit conditions

**Stage 1: settle the distribution and lifecycle before importing a real key.**
Pin the conditional law, width, truncation, error budget, stable role assignment, and permitted number of fresh sharings.
Complete the ML-DSA-65 hint and rejection analysis.
Choose between fresh sharing with a bounded lifetime and deterministic recovery with persistent compromise exposure.
Do not reuse the paper's security-loss number as this decision's evidence.

**Stage 2: build a disposable, separate-process conversion prototype.**
Use the existing private canonical key generator and output one short share to each role.
Compile the two-table sampler and retain exact gate, wire, OT, and directional-byte counts.
Measure fresh precomputed draws and seed-derived deterministic draws separately.
Add a narrow role-local constructor and a correct short-share codec in the investigation implementation.
Preserve the production pause.

**Stage 3: run one demanding E2E campaign with repeatable artifacts.**
Cover canonical seeds with all nine coefficient values, sampler tails, repeated recovery, and stable role assignment.
Threshold-sign before authorized reconstruction.
Then reconstruct the original seed and full ordinary private key at the authorized test recipient.
Require byte equality with OpenSSL and independent verification of every threshold signature.
Include altered messages, candidate exhaustion, conflicting concurrent claims, interrupted responses, crashes, and rollback attempts.
Retain public fixture identities, source hashes, raw counters, state-transition outcomes, and reproduction commands.
Run at least 100 warm successful signatures after correctness, and use larger campaigns for tail claims.

**Stage 4: qualify Wasm locally before any separately authorized hosted experiment.**
Measure role-specific peak memory, compile size, sampler CPU, preparation throughput, and first-signature time.
Include all imported-key preparation, persisted reservations, unused candidates, and retries.
Test concurrent wallets and concurrent requests for one wallet.
Future hosted comparison must use the same admission, network, and completion boundaries as GMW.
Report successful latency separately from fast exhaustion and other failures.

Stop advancement if the parameter analysis cannot justify server-blind secrecy, recovery adds unbounded fresh observations, or the complete resource budget is impractical.
Successful FIPS verification alone cannot pass these conditions.

## Reproduce the scalar estimates

This calculation models the illustrative distribution only. It performs no protocol or production cryptography.
The finite summation ranges below make omitted numerical mass negligible for these displayed estimates.
They do not replace certified bounds for generated tables.

```python
from decimal import Decimal, getcontext
from math import log2

getcontext().prec = 100
width_squared = Decimal(20) / 3
probabilities = {}
for secret in range(-4, 5):
    weights = {}
    for share in range(-90, 91):
        offset = Decimal(share) - Decimal(secret) / 2
        weights[share] = (-(offset * offset) / width_squared).exp()
    total = sum(weights.values())
    probabilities[secret] = {
        share: float(weight / total) for share, weight in weights.items()
    }

conditional_entropy = 0.0
guess_probability = 0.0
for share in range(-90, 91):
    joint = [probabilities[secret][share] / 9 for secret in range(-4, 5)]
    marginal = sum(joint)
    if marginal:
        conditional_entropy -= sum(
            value * log2(value / marginal) for value in joint if value
        )
    guess_probability += max(joint)

print(conditional_entropy, log2(9) - conditional_entropy, guess_probability)
print(2816 * (2 * 64 * 191 + 7 + 128 + 14))
```
