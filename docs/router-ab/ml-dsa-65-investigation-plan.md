# ML-DSA-65 threshold signing investigation plan

Status: local reference and circuit implementation in progress, 2026-10-13.
Starting source and research review: 2026-10-05.

Build the fastest practical 2-of-2 ML-DSA-65 signing library for the Wallet SDK on Cloudflare Router A/B.
Select the fastest measured complete protocol that preserves the security and recovery contract.
Use current research to find candidates. Publication date does not determine the winner.
The investigation must cover key generation, signing, recovery, export, and deployment.
The [experiment contract](ml-dsa-65-experiment-contract.md) defines the first executable slice.
The [host harness](../../tools/ml-dsa-investigation/README.md) checks public reference fixtures and hashing circuits.
Complete threshold signing and deployed measurements remain open.

## First local evidence — October 13, 2026

The [reference and circuit harness](../../tools/ml-dsa-investigation/README.md) passed.
Its [generated report](../evidence/ml-dsa-65-foundation-20261013.json) contains commands, source digests, public fixtures, and raw samples.
RustCrypto ML-DSA 0.1.1 and OpenSSL 3.6.3 agree on four public keys and eight deterministic signatures.
Both implementations reject changed messages, contexts, signatures, and public keys.
A separate public-fixture recipient reproduces the same keys and signatures from reconstructed seeds.
This verifies reference reproducibility. It does not implement confidential export or threshold execution.

| Compiled hashing kernel | AND gates | Reusable slots | Estimated half-gate table bytes |
| --- | ---: | ---: | ---: |
| Full Keccak-f[1600] control | 38,400 | 1,984 | 1,228,800 |
| Canonical seed expansion from XOR shares | 37,824 | 1,984 | 1,210,368 |
| One 481-byte polynomial prefix | 152,584 | 5,248 | 4,882,688 |
| Seed expansion plus eleven polynomial prefixes | 1,716,248 | Separate kernel schedules | 54,919,936 |

The hashing sum excludes the control circuit.
Each kernel matches its independent hash implementation on public fixtures.
The report includes all eleven polynomial nonces and all sixteen seed-share pattern pairs.
Half-gate bytes remain an estimate from compiled gates, rather than measured network traffic.
Sampling, private outputs, arithmetic, conversions, OT, framing, and actual garbling remain additional work.

Compiler simplification reduces the earlier 55.296 MB hashing estimate by about 0.7 percent.
It does not materially reduce the bandwidth requirement.
Next, measure the deployed transport and actual half-gate execution, then add oblivious coefficient selection and share conversion.
Compare GMW with complete preprocessing costs before choosing a smaller-traffic engine.

The starting review covered repository sources at `seams-wallet` commit `7dc2a5cd`, installed Wallet Server 0.8.0 artifacts, and the primary references below.
The generated report records the later experiment's source revision and file identities separately.
Live Cloudflare versions, placement, and target-network activation remain unverified.
Pin those deployment facts before recording performance results.

## First milestone: deployed feasibility and speed

Complete investigation steps 1–5 with one compatible key-generation and signing combination before broad SDK integration.
Start with the existing Yao half-gates engine as the execution baseline.
Compare alternatives against its measured costs.
Key-generation speed alone cannot establish signing feasibility.

The first milestone must produce one repeatable report that demonstrates:

- Exact agreement with an independent implementation for public test seeds.
- Canonical key recovery through an authorized test recipient.
- A standard signature from the generated shares, with A and B running separately on Cloudflare.
- Complete latency and resource measurements, including preprocessing and every signing attempt.
- A measured bottleneck and the next experiment most likely to reduce signing latency.

Include run commands, source revisions, deployment configuration, public vectors, raw samples, and verifier results in the report.
Keep known test seeds in the reference harness and authorized recovery recipient.
Give each protocol participant only its own input share.
Exclude production secrets from every artifact.

Keep SDK changes limited to the harness required for this milestone.
Complete the broader candidate comparison and lifecycle work before selecting the production library.

## Speed objective

Minimize end-to-end signing latency on the deployed architecture.
Use p95 latency under the agreed workload as the primary ranking metric.
The p95 value is the time within which 95 percent of measured operations finish.
Report median latency, sustained throughput, and resource use alongside it.
Throughput means successful signatures per second.

| Workload | Required comparison |
| --- | --- |
| Prepared material available | Rank complete signing latency, including admission, storage, transport, retries, and queue time. |
| Prepared material exhausted | Measure signing latency with all required preprocessing on the request path. |
| Sustained traffic | Measure the signing rate that both participants can maintain while replenishing prepared material. |
| Key generation and recovery | Rank their complete latency separately. Preserve exact canonical key identity. |

Preprocessing creates secret material before the signing request.
Specify a bounded pool and its replenishment policy for every result that uses prepared material.
A finite prepared pool cannot establish sustained throughput.
Measure wallet interaction and NEAR confirmation separately from signer service time.

Continue optimization after a candidate meets the provisional latency targets.
Those targets provide comparison points. They do not define completion of the speed investigation.
Compare finalists under identical deployment, workload, security parameters, and accounting boundaries.
Limit any claim of "fastest" to the evaluated candidates and measured conditions.

## Fixed requirements

- Keep the current passive security model. Both Derivers follow the protocol and do not collude.
- Use two server participants. Each participant receives only its own secret material.
- Jointly create a hidden 32-byte ML-DSA seed, named `xi` in this plan.
- Preserve exact equality with `ML-DSA-65.KeyGen_internal(xi)` for the selected FIPS 204 edition and applicable corrections.
- Never reconstruct `xi` or the complete private key outside secure computation during normal operation.
- Produce standard ML-DSA-65 public keys and signatures that unmodified verifiers accept.
- Allow an authorized export recipient to reconstruct `xi` and reproduce the same ordinary keypair.
- Keep the ML-DSA seed separate from the wallet custody seed and tenant derivation roots.
- Require both participants for signing. A missing participant causes failure without secret reconstruction.
- Run the selected implementation through the intended Cloudflare Router A/B deployment, with separate compute and storage for both participants.

Malicious security is outside this investigation's required scope.
Record the assumptions of each dependency without making a stronger claim than the current profile supports.
Classical OT and envelope protection do not establish post-quantum transcript confidentiality merely because the output signature uses ML-DSA.
Record that distinction in the final library documentation.

Canonical key recovery is a requirement. Identical signature bytes across different signing executions are unnecessary.
Use [FIPS 204 and its current errata](https://csrc.nist.gov/pubs/fips/204/final) as the algorithm reference.
The checked publication remains the August 2024 edition, with a July 2026 planning note for potential corrections.
The experiment contract records the reviewed spreadsheet identity and applicable interpretations.
Record which corrections apply instead of treating a planning note as a new standard edition.
Standard verifier compatibility does not establish FIPS module validation.

## Architecture and ownership

The requested investigation uses server A and server B as signing-share holders.
The existing Ed25519 protocol instead provisions shares for the client and SigningWorker.
Record this custody difference explicitly in the ML-DSA design.
Keep client authorization bound to the exact operation, key, and message.

Reuse the role separation in the [Router A/B protocol](./protocol.md) and the packaging boundary in the [deployment guide](./deployment.md).

The checked [Deriver A](../../crates/router-ab-cloudflare/wrangler.deriver-a.toml) and [Deriver B](../../crates/router-ab-cloudflare/wrangler.deriver-b.toml) manifests build Rust/WASM Workers with Service Bindings and role-private persistence.
The installed Wallet Server 0.8.0 manifests also declare Worker entrypoints without Container applications.
Use Worker/WASM execution as the source-backed baseline.

The [Streaming Yao narrative](../../apps/docs/src/concepts/threshold-signing/streaming-yao-ab.md) claims native Container compute, which conflicts with those manifests.
The [state ownership audit](../refactor-152-state-ownership.md) also distinguishes benchmark probe Containers from authoritative wallet roles.
Resolve the actual deployment from deployed artifacts before benchmarking. Do not infer the compute path from that narrative claim.
Assess Container execution separately only if deployment evidence or an explicit scope decision requires it.
Historical Worker/WebSocket measurements remain historical evidence, regardless of the selected runtime.

| Area | Responsibility |
| --- | --- |
| Wallet SDK | Expose ML-DSA operations through existing wallet APIs. Authorize requests and verify public results. |
| Gateway | Enforce identity, permissions, and allowance through existing admission paths. |
| Router | Coordinate admitted operations and public lifecycle state. Hold no ML-DSA secret share. |
| Participants A and B | Execute separate protocol roles. Keep seed shares, signing shares, and preprocessing material in role-private storage. |
| Rust protocol code | Own exact encodings, secret types, cryptographic operations, and session transitions. |
| Cloudflare adapters | Own transport, persistence, Worker entrypoints, and platform integration. |
| `seams-wallet` | Own the cryptographic library, SDK integration, Worker artifacts, and Wallet lifecycle contracts. |
| `seams-monorepo` | Consume exact package releases. Own deployment targets and composed Console acceptance tests. |

Before integration, specify whether normal ML-DSA signing executes in the Deriver entrypoints or separate signing-role entrypoints.
Preserve separate storage and credentials for A and B in either arrangement.
Keep this implementation choice distinct from the accepted two-server custody model.
Do not place both shares in the existing single SigningWorker.

Inspect these existing components before creating new abstractions:

- `crates/ed25519-yao` and `tools/ed25519-yao-generator` for circuits, streaming, and measurement patterns.
- `crates/router-ab-core` for admission, role contexts, and lifecycle types.
- `crates/router-ab-cloudflare` for Worker transport and role-private persistence.
- `crates/router-ab-dev` for separate-process execution and evidence reports.
- `packages/wallet` and `packages/wallet-server` for SDK APIs and release packaging.

Select one production protocol after the comparison.
Keep benchmark alternatives outside production routes.
Avoid a new general-purpose MPC framework or runtime-selectable cryptographic backend.

## NEAR integration baseline

[Current nearcore source](https://github.com/near/nearcore/blob/master/core/crypto/src/signature.rs) contains ML-DSA-65 keys and signatures with wire tag 2.
It distinguishes the full public key from its hashed access-key handle.
[NEP-645](https://github.com/near/NEPs/blob/master/neps/nep-0645.md) describes protocol gating and transaction support, but its document status remains Draft.
Pin nearcore code and verify the target network's feature activation before claiming deployed support.

The local [NEAR signer types](../../wasm/near_signer/src/types/near.rs) still encode 32-byte public keys and 64-byte signatures.
Those representations require explicit ML-DSA variants before Wallet transaction integration can work.
Include key parsing, Borsh encoding, access-key lookup, message/context handling, and transaction-size accounting in the integration scope.
NEAR transaction-signature support does not establish support for ML-DSA implicit-account identifiers.

## Options to investigate

Secure two-party computation, abbreviated 2PC, lets both participants compute over secrets without revealing those secrets.
The key-generation engine and the signing protocol are separate choices.
Their share formats must compose correctly.

| Key-generation option | Investigation | Main question |
| --- | --- | --- |
| Full Yao | Compile an exact circuit and measure its size. Execute it only if the resource estimate is useful. | How much does local arithmetic save? |
| Hybrid with current half-gates | Keep seed expansion and secret sampling in Yao. Compute public and linear operations locally on shares. | Can the existing runtime meet the target with limited changes? |
| Hybrid with three-halves garbling | Substitute the published smaller garbling construction. Keep the same cryptographic functionality. | Does lower traffic compensate for extra computation and implementation work? |
| Hybrid with GMW | Evaluate SHAKE through Boolean secret sharing. Use two-party preprocessing and local arithmetic shares. | Does lower traffic compensate for dependent communication steps? |
| Hybrid with ABY2.0 | Evaluate its Boolean protocol and conversion costs against GMW. | Does its preprocessing model improve the complete operation? |

[Three-halves garbling](https://eprint.iacr.org/2021/749) reduces communication per AND gate with additional computation.
[ABY2.0](https://encrypto.de/papers/PSSY21.pdf) provides a reference for Boolean sharing and mixed protocols.
The [SEEC implementation](https://github.com/encryptogroup/SEEC) is a candidate reference for passive GMW and ABY2.0.
Verify its dependencies against the selected runtime. Assess WASM portability separately for any Worker-only comparison.
Its [README](https://github.com/encryptogroup/SEEC/blob/main/README.md) identifies native SIMD dependencies and marks the Silver silent-OT option insecure.
Exclude that option. Pin the actual preprocessing backend before comparing its cost or security.

| Signing option | Investigation | Decision condition |
| --- | --- | --- |
| General 2PC signing | Execute the standard signing operations over uniformly masked shares. Keep linear operations local. | Establish the reference for canonical keys and private execution. |
| Mithril with canonical-key sharing | Execute its existing-key sharing procedure inside 2PC. Evaluate the resulting short shares. | Quantify privacy differences, security loss, refresh effects, and complete cost. |
| Trilithium-based signing | Evaluate its arithmetic protocol and secure rounding operations. Replace provider-generated randomness with two-party preprocessing. | Account for the replacement's security argument and full resource cost. |
| Native distributed key generation | Measure only as a comparison with canonical key generation. | Exclude from selection if ordinary key generation from `xi` cannot reproduce the key. |
| New research candidates | Screen current publications before implementing another prototype. | Require standard verification, two-party execution, canonical-key support, and plausible resource use in the selected deployment. |

Review [Mithril](https://eprint.iacr.org/2026/013) using its canonical-key sharing analysis and the corresponding complete execution costs.
The checked ePrint entry dates from January 2026 and supersedes 2025/1166.
The [USENIX paper, sections 3.4–3.5](https://www.usenix.org/system/files/conference/usenixsecurity26/sec26_prepub_celi.pdf) discusses a 7–12-bit security loss for existing-key sharing and heuristic parameter bounds.
Check the selected revision and repeated sharing before accepting those tradeoffs.

[Trilithium](https://eprint.iacr.org/2025/675) includes a correlated randomness provider.
Use its June 30, 2026 revision, which reports an improved protocol and security proof.
Its published timings do not establish the cost of replacing that provider with two workers.

Screen [THED](https://eprint.iacr.org/2026/638) as a current alternative.
The checked latest revision dates from September 13, 2026.
Its reported prototype uses GPU-based homomorphic computation and a different signing-mask construction.
Require a concrete implementation case for the selected Cloudflare runtime before allocating implementation work.

The review also identified these candidates and limits:

| Candidate and checked revision | Status for this investigation |
| --- | --- |
| [Quorus](https://eprint.iacr.org/2025/1163), January 28, 2026 | Its reported instantiation requires an honest majority. Exclude that instantiation from the required two-party privacy profile. |
| [TALUS v5](https://arxiv.org/abs/2603.22109v5), August 9, 2026 | Its distributed profile requires an honest majority. Its alternative adds trusted execution. The revision adds signing limits and addresses external cryptanalysis. Exclude its current profiles from direct selection. |
| [Shamir Nonce DKG v6](https://arxiv.org/abs/2601.20917v6), March 3, 2026 | Its distributed profile requires two honest signers for mask hiding. Other profiles and aggregate-signature key privacy require further review. Keep outside the first prototype. |

An honest-majority assumption requires more than half the participants to remain uncorrupted.
Two participants cannot satisfy that assumption while protecting secrets from either individual participant.
Screen other recent claims against their primary papers and source code through the same criteria.
Record exclusions with reasons instead of implementing every published scheme.

## Estimates to validate

These calculations describe the hashing portion of a conservative key-generation circuit.
They exclude sampling, conversions, inputs, outputs, and protocol framing.
They are estimates, not measured results.

| Method | Calculated hashing traffic | Accounting boundary |
| --- | ---: | --- |
| Current half-gates | 55.296 MB | Garbled AND tables |
| Three-halves garbling | 42.552 MB | Bit-packed gate data under the published formula |
| GMW with prepared Boolean triples | 0.864 MB | Online AND messages only |

The calculation uses 45 Keccak permutations and 38,400 AND gates per permutation.
It assumes 128-bit garbling labels and four SHAKE output blocks per secret polynomial.
Thus, the calculation contains 1,728,000 AND gates before compiler simplification.
Half-gates use 256 transmitted bits per AND gate. Three-halves uses 197 bits under its published formula.
MB means 1,000,000 bytes in this table.
The GMW calculation assumes four transmitted bits per AND gate across both participants.
Its preprocessing cost remains additional and unmeasured.
Never compare that online figure with a complete Yao operation as equivalent totals.

The starting sampler uses the 481-byte limit from [FIPS 204 Appendix C](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf).
Keep accepted coefficients in their original order.
Measure oblivious compaction, which selects accepted coefficients without revealing their positions.

Investigate these optimizations independently:

- Simplify constant circuit inputs and measure the actual generated gate counts.
- Compare compaction algorithms, live-wire counts, and conversion costs.
- Compare local `Power2Round` after opening `t` with secure rounding over shares.
- Compare fresh preprocessing on demand with a prepared pool of one-use material.
- Measure binary framing, bounded buffers, batching, and WASM copy costs.
- Evaluate shorter initial sampling schedules only with exact continuation and an explicit privacy argument.

FIPS 204 section 6.1 permits treating `t = A*s1+s2` as public.
The selected threshold composition must explicitly allow that disclosure alongside each participant's shares.
Opening signing intermediates requires a separate argument.

Early sampling termination can reveal seed-dependent control flow.
Do not change the sampler distribution or discard canonical seeds to achieve a benchmark target.
Preprocessing can reduce request latency while retaining its full CPU, storage, and traffic cost.
Reuse static circuit descriptions only. Consume secret preprocessing and garbled execution material once.
Do not budget compression savings for pseudorandom garbled tables.

## Investigation sequence

### 1 Freeze the contract and research baseline

- [ ] Record the exact FIPS edition, applicable errata, NEAR protocol version, and message encoding.
- [ ] Pin the deployed Cloudflare artifacts and reconcile their runtime with the source and packaged manifests.
- [ ] Verify NEAR feature activation and the exact signing input, including context and prehash behavior.
- [ ] Pin paper revisions, source commits, dependency versions, implementation licenses, and parameter sets for each candidate.
- [ ] Record proof assumptions, prototype limits, security losses, and required external parties.
- [ ] Confirm support for canonical existing keys without plaintext key import at either server.
- [x] Pin an independent ML-DSA-65 implementation as the reference for public test seeds and signature verification.
- [ ] Specify the exact share format that the first signing prototype consumes from key generation.
  The experiment contract defines a provisional uniformly masked format. Signing compatibility remains to be demonstrated.
- [ ] Specify the admitted key-generation, signing, refresh, recovery, and export operations.
- [ ] Define each role's inputs, outputs, persistent secrets, permitted disclosures, and abort behavior.
- [ ] Specify seed creation and retention, key identity checks, and recovery after permanent participant loss.
- [ ] Choose the intended signing entrypoints and role-private persistence owners.
- [ ] Set performance targets before selecting a protocol.
- [ ] Fix the primary signing workload, deployment constraints, and permitted preprocessing storage before ranking candidates.

Output: a concise contract and candidate matrix linked from this plan.
Exit condition: every candidate has an explicit fit, exclusion, or unresolved question.
Refresh the research survey before the final protocol decision.

### 2 Measure the deployed Cloudflare transport

- [ ] Extend the existing separate-role benchmark transport.
- [ ] Record the actual Worker and Durable Object path. Record Container configuration separately if the verified deployment uses Containers.
- [ ] Stream synthetic binary payloads of 8, 32, and 64 MB without cryptographic evaluation.
- [ ] Measure the deployed path first. Compare WebSocket, HTTP streaming, and RPC streaming where their runtime boundaries support them.
- [ ] Record actual compute placement and both D1 primary locations separately.
- [ ] Measure setup, first byte, last byte, receiver completion, acknowledgments, and bounded-buffer behavior.
- [ ] Measure CPU, memory, copied bytes, frame counts, and concurrency effects.
- [ ] Repeat with controlled delay to establish sensitivity to communication depth.

Output: raw samples and a transport report with reproducible commands.
Exit condition: separate transfer and runtime overhead from cryptographic computation.

Cloudflare documents default Service Binding execution on the same server thread.
Placement and the chosen entrypoint can change execution behavior.
Measure the deployed path instead of assuming parallel CPUs or a particular link speed.
That Service Binding behavior does not describe the execution or billing of a Container behind a Worker.
See [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) and [placement](https://developers.cloudflare.com/workers/configuration/placement/).

### 3 Benchmark the secret computation

- [ ] Use the existing half-gates engine for the first executable measurements.
- [ ] Run A and B in separate processes before repeating the workload in the selected Cloudflare runtime.
- [ ] Measure one Keccak permutation, complete seed expansion, and all secret polynomial streams.
- [ ] Include secret sampling, coefficient selection, share conversion, and private outputs.
- [ ] Record generated gate counts, live-wire counts, peak memory, directional bytes, CPU, and latency for each stage.
- [ ] Verify exact coefficient values and order against the independent reference using public synthetic fixtures.
- [ ] Test fixed sampler exhaustion through controlled synthetic inputs without changing production bounds.
- [ ] Compare GMW on the same workload, including two-party preprocessing generation and all share conversions.

Output: executable kernel measurements and a stage-by-stage resource breakdown.
Exit condition: establish whether hashing, sampling, conversion, transport, or memory creates the largest cost.
Use these results to prioritize the remaining engine options.
Gate counts alone do not establish CPU cost or elapsed time.

### 4 Complete canonical key generation

- [ ] Combine the measured secret computation with local arithmetic on shares.
- [ ] Include local matrix expansion, arithmetic, rounding, and public-key encoding.
- [ ] Compare full Yao estimates with the measured hybrid implementations.
- [ ] Include preprocessing generation and every conversion between computation methods.
- [ ] Include the real transport and role-private persistence path in complete operation timings.
- [ ] Compare regenerated public keys across independent standard implementations.
- [ ] Reconstruct the test seed only at the authorized export recipient and reproduce the exact ordinary keypair.
- [ ] Verify that each participant retains only its own seed and signing material.
- [ ] Record separate timings for first use and repeated use of public matrix data.

Output: complete key-generation measurements, public synthetic vectors, and exact share-format descriptions.
Exit condition: reproduce the canonical public key and recovery result within the selected runtime's resource limits.
Retain the current half-gates implementation as the comparison baseline until selection.

### 5 Produce and compare complete signatures

- [ ] Specify how each candidate consumes the exact outputs from key generation.
- [ ] Produce the first valid signature from generated shares before expanding SDK integration.
- [ ] Measure general 2PC signing with local linear operations.
- [ ] Evaluate Mithril and Trilithium only after their share and preprocessing requirements are explicit.
- [ ] Keep nonce material, rejected candidates, and secret acceptance checks inside the required privacy boundary.
- [ ] Account for fresh randomness, retry counts, candidate selection, conversions, and final encoding.
- [ ] Measure empty and prepared preprocessing pools separately.
- [ ] Measure successful signatures across all attempts, including abandoned work.
- [ ] Identify each finalist's largest latency costs and optimize those costs before the final comparison.
- [ ] Measure sustained signing with pool replenishment active and compare results after pool exhaustion.
- [ ] Verify signatures with an independent standard implementation and the pinned NEAR verifier.
- [ ] Evaluate repeated key sharing and refresh for any candidate with short shares.
- [ ] Document the complete passive privacy argument, including permitted intermediate disclosures.

First output: the deployed feasibility report specified at the start of this plan.
Milestone condition: one complete combination preserves canonical recovery and produces independently verified signatures with complete measurements.
If that condition fails, record the exact correctness, runtime, privacy, or performance blocker.

Then extend the report into a ranked signing comparison tied to exact key-generation engines and share formats.
Explain why each slower candidate lacks a credible remaining optimization that could change the selection.
Choose the production share format only after this comparison.

### 6 Prove lifecycle behavior through E2E scenarios

Use separate A and B runtimes with their real storage and transport boundaries.
Use the top-level `tests/` workspace for TypeScript E2E tests.
Read its instructions before implementation.
Use generated cryptographic vectors and type fixtures for their existing normative purposes.
Add no unit tests or source-text guards for this investigation.

- [ ] Generate a key, register it as a NEAR access key, and submit a threshold-signed transaction.
- [ ] Verify full-key and hashed-handle RPC behavior without assuming an Ed25519 implicit-account identifier.
- [ ] Interrupt signing after nonce or preprocessing consumption. Restart through a fresh operation and verify the next signature.
- [ ] Attempt signing with B unavailable. Verify terminal failure and safe subsequent operation.
- [ ] Refresh signing shares. Verify the same public key and reject stale operation state.
- [ ] Restore one role from its protected backup. Complete the required forward transition before signing.
- [ ] Export through a newly authorized recipient. Reproduce the key with an independent implementation and sign an ordinary transaction.
- [ ] Reject cross-wallet, wrong-role, expired, and replayed requests at their existing boundaries.
- [ ] Exercise concurrent signing, preprocessing exhaustion, cancellation, and worker restart together.

Each scenario must produce a repeatable artifact with public inputs, expected outcomes, run commands, and source revisions.
Record transaction identifiers and receipts for deployed NEAR scenarios.
Export public test keys only. Never include production secrets in traces or reports.
E2E success proves behavior and interoperability. It does not replace the protocol privacy argument.

Classify test failures before repair under the repository testing policy.
Preserve the current domain contract when retiring stale fixtures.

### 7 Select and integrate the library

- [ ] Select one key-generation engine and one compatible signing protocol.
- [ ] Select the fastest measured complete combination for the agreed signing workload.
- [ ] Record the measured costs, privacy assumptions, unresolved limitations, and reasons for rejecting other options.
- [ ] Implement the smallest Rust core and runtime interfaces that fit the selected protocol and deployment.
- [ ] Reuse existing Router admission, transport, storage, and lifecycle abstractions where their semantics match.
- [ ] Model key, session, restore, export, and preprocessing state with branch-specific types.
- [ ] Validate external values once at their boundaries. Keep raw and compatibility shapes outside core operations.
- [ ] Add type fixtures for invalid state combinations when changing shared domain types.
- [ ] Update the Wallet behavior specification and its E2E contracts with the implementation.
- [ ] Add explicit ML-DSA key and signature variants to the SDK and NEAR encoders without request-selected protocol backends.
- [ ] Package exact SDK and Worker artifacts in `seams-wallet` releases.
- [ ] Consume those exact releases in `seams-monorepo` and run composed staging acceptance scenarios.
- [ ] Obtain a focused review of the selected cryptographic composition before production use.
- [ ] Remove rejected production paths and temporary prototype abstractions.

Output: the selected library, integration, release evidence, and documented operating limits.
Exit condition: canonical recovery and standard signing pass the complete deployed lifecycle.

## Measurement and selection rules

Use provisional p95 targets of one second for warm signing and five seconds for key generation or recovery.
These are planning assumptions until the user selects targets.
Measure signer service time separately from wallet interaction and NEAR confirmation.
Start the service timer when the Gateway receives the admitted-operation request.
Stop the timer when the Gateway returns the valid standard signature or public key.
Include admission processing and queue time within that interval.
Report empty-pool latency even when the warm target assumes prepared material.

For each complete candidate, report:

- Source commits, artifact hashes, compiler settings, runtime versions, security parameters, and actual placement.
- Sample counts, failures, attempts per signature, p50, p95, and mean latency.
- p99 with its sample count and uncertainty when the campaign supports that estimate.
- CPU and peak memory for each participant, plus total CPU for the pair.
- Directional bytes for preprocessing, online protocol, persistence, and recovery.
- Unamortized setup cost, steady-state cost, pool refill rate, and one-use storage consumption.
- Performance at concurrency 1, 4, and 16, with queue time shown separately.
- First-observation timings after deployment, without claiming a verified cold-start distribution.
- Current platform cost assumptions and cost per successful operation.

Separate Worker CPU, Durable Objects, storage, and applicable network charges.
For Container comparisons, also report Container CPU, provisioned memory and disk, and idle-resource costs.
Include pool replenishment in deployment cost estimates.
Keep key-generation cost separate from cost per signature.
Do not multiply a historical Ed25519 bill by the AND-gate ratio to predict the complete ML-DSA bill.

Start with 100 warm successful operations per viable candidate.
Use a larger campaign for finalists and any p99 claim.
Repeat enough deployment cycles to distinguish first-observation effects from normal variation.
Use the same workload and measurement boundaries for each comparison.

Reject candidates that reconstruct secrets at a server, change canonical key recovery, or require an unapproved third trusted participant.
Reject candidates that require unsupported deployment resources or emit signatures that NEAR rejects.
Treat additional short-share leakage or changed cryptographic assumptions as explicit decisions, even under passive execution.

Among candidates that pass the contract, select the lowest measured p95 signing latency under the agreed workload.
Report the tradeoff when median latency, sustained throughput, or empty-pool latency favor a different candidate.
Use complete resource cost and implementation size to distinguish candidates whose measured performance overlaps within experimental uncertainty.
Require an explicit decision for any cost or deployment change that exceeds the agreed constraints.
If no candidate meets the targets, report measured limits and the smallest required scope decision.
Do not weaken the recovery contract or conceal preprocessing costs to claim success.

The final report must identify the fastest measured candidate, its nearest alternatives, and the evidence for selection.
State remaining opportunities that could change that ranking.

## Immediate work queue

1. Validate the pinned reference, canonical-key contract, and provisional uniformly masked share format through the host harness.
2. Measure raw transport through the actual Cloudflare compute path.
3. Benchmark secret expansion, sampling, and share conversion with half-gates and GMW.
4. Complete canonical key generation and authorized recovery using public test fixtures.
5. Produce a standard threshold signature and publish the complete feasibility and speed report.

Use that report to prioritize protocol optimization and the remaining lifecycle work.
Keep implementation and benchmark reports linked from this document as the investigation proceeds.
