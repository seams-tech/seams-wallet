# ML-DSA-65 threshold signing investigation plan

Status: complete host and deployed Worker key generation and threshold signing verified, 2026-10-13.
Follow-up: exact arithmetic optimization passes host and local Worker E2E checks. Hosted remeasurement awaits approval for its new disposable token.
Starting source and research review: 2026-10-05.

Build the fastest practical 2-of-2 ML-DSA-65 signing library for the Wallet SDK on Cloudflare Router A/B.
Select the fastest measured complete protocol that preserves the security and recovery contract.
Use current research to find candidates. Publication date does not determine the winner.
The investigation must cover key generation, signing, recovery, export, and deployment.
The [experiment contract](ml-dsa-65-experiment-contract.md) defines the first executable slice.
The [host harness](../../tools/ml-dsa-investigation/README.md) checks references, private key generation, and authorized test export.
Complete host and Worker threshold signing now pass. Independent verifiers accept their standard signatures.

The [preliminary key-generation report](ml-dsa-65-preliminary-keygen-report.md) now measures the complete deployed key-generation flow.
Five fresh joint keys took 12.44 seconds at the median, with an observed range of 11.79–12.53 seconds.
These results exceed the provisional five-second generation target.
The current shared-core native harness records a 1.87-second median across its five key-generation cases.
The earlier checkpoints below retain their original artifact measurements.
The [arithmetic optimization report](ml-dsa-65-optimization-report.md) records the next implementation and its remaining measurement limits.

## Current implementation evidence — October 13, 2026

The [kernel and private key-generation report](../evidence/ml-dsa-65-kernels-20261013.json) extends the foundation evidence below.
Two persistent processes execute eighteen circuits with genuine oblivious transfer, or OT.
OT delivers each private input label without revealing the input to its peer.
The circuits expand the hidden seed, sample eleven secret polynomials, and round six shared public-key polynomials.
Each process computes public matrix expansion and linear arithmetic on its own shares.
Neither normal role receives the complete seed, private stream, or expanded key.

Four reference seeds and one jointly generated disposable seed pass the complete host flow.
After generation, a separate authorized test recipient reconstructs the seed and every private-key field.
Its full 4,032-byte expanded encoding matches OpenSSL independently for all five keys.
Each participant retains 17,472 bytes of disposable seed, `K`, and polynomial shares.
The recipient's ordinary signatures verify. This early checkpoint establishes recovery.
The later complete baseline below verifies threshold signatures before authorized recovery.

| Complete private host key generation | Measured bytes |
| --- | ---: |
| Garbled AND tables | 118,728,192 |
| A to B, including OT, input labels, frames, and output translations | 122,426,379 |
| B to A, including OT and public results | 736,875 |
| Both directions | 123,163,254 |
| OT, already included in those directions | 2,129,280 |

The five observed key-generation runs took approximately 2.5–2.8 seconds each on the recorded native host.
They include fresh OT for every circuit, process startup, and schedule loading.
They exclude compilation, authorized recovery, Cloudflare execution, production admission, and persistence.
Five different keys do not establish a latency distribution or a production p95.
Shared-host process separation provides no operating-system isolation claim.
Local native arithmetic still needs a constant-time review and target-runtime measurements.

The [hosted transport report](../evidence/ml-dsa-transport-hosted-20261013.json) measures synthetic 8, 32, and 64 MB transfers.
It compares HTTP and WebSocket transfer through direct Service Bindings and a pair of probe wallet Durable Objects.
The 128 KiB frame results at 64 MB show these medians:

| Probe path | HTTP | WebSocket |
| --- | ---: | ---: |
| Direct Worker to Worker | 0.726 seconds | 0.341 seconds |
| Through both probe wallet Durable Objects | 0.973 seconds | 1.134 seconds |

Each transfer group contains five measured samples after one excluded warm-up.
Concurrency groups use 1, 4, and 16 simultaneous 8 MB HTTP transfers to the same wallet.
Authentication rejection, truncated payloads, and a delayed receiver also pass.
The report records source hashes, tool identities, frame counts, checksums, raw samples, and reproduction commands.
The sender limits application buffers. Runtime peak memory and copy counts remain unmeasured.
These probes do not guarantee same-region execution or reveal physical Durable Object placement.
They use no D1 and do not measure the production Router admission or storage path.

The [CPU report](../evidence/ml-dsa-transport-cpu-20261013.json) contains Cloudflare's aggregate transport CPU and wall-time buckets.
The schema identifies their units as microseconds.
Buckets can combine several workloads. They cannot establish per-key CPU, cryptographic cost, or a campaign percentile.
The [cleanup record](../evidence/ml-dsa-transport-cleanup-20261013.json) verifies deletion of both temporary Workers and their Durable Object namespaces.

The [signing assessment](ml-dsa-65-signing-options.md) defines the next protocol questions.
The host report also measures private `ExpandMask`, which generates the five signing-mask polynomials for one attempt.
Each polynomial uses 222,400 AND gates and 7,116,800 table bytes.
Five polynomials therefore require 35,584,000 table bytes before commitment hashing, checks, hints, or final encoding.
Five nonce cases match an independent SHAKE implementation through genuine OT execution.
A receives no decoded mask output. Each participant retains only its own additive mask share.
The measured host kernel pairs take approximately 0.15–0.18 seconds each, including fresh OT and process startup.
These measurements establish one signing component. They do not establish complete signing latency.
Keep rejected `w1` private. Investigate private commitment hashing followed by a public challenge hash separately.
That possible disclosure needs a complete composition argument before selection.
Mithril's short-share privacy loss and Trilithium's replacement preprocessing remain unresolved.

## Resumable execution and deployed private kernels

The [resumable host report](../evidence/ml-dsa-65-resumable-20261013.json) uses one cryptographic runtime for host and Worker execution.
The [runtime](../../crates/ed25519-yao/src/passive/ml_dsa_runtime.rs) has no blocking I/O or clock.
It validates a trusted schedule digest and advances through consuming send, receive, and complete states.
Host and Worker adapters drive the same OT and half-gate implementation.
B retains private decoded outputs. A receives only each circuit's declared public outputs.
Fresh session nonces bind OT flights to the complete schedule digest and gate domain.
The repeated host key-generation and authorized recovery checks pass for all five keys.

The [hosted kernel campaign](../evidence/ml-dsa-65-worker-kernels-hosted-20261013.json) executes four private kernels through a Service Binding and binary WebSocket.
Each kernel has five measured samples after one excluded warm-up.
Both Workers check only their own public fixture inputs and expected outputs.
The report checks equal execution bindings, exact runtime byte counts, and separate completion reports.

| Private kernel | Hosted client median | Garbled table bytes |
| --- | ---: | ---: |
| Seed expansion | 264.2 ms | 1,210,368 |
| One sampling polynomial | 1,122.5 ms | 9,619,968 |
| One rounding polynomial | 350.7 ms | 1,949,696 |
| One signing-mask polynomial | 906.3 ms | 7,116,800 |

These are individual kernel measurements. Summing their medians does not establish complete pipeline latency.
The entry request reported NRT. This does not establish both Workers' physical location.
The adapter permits eight outstanding messages and limits each table message to 65,544 bytes, including its envelope.
The largest admitted control message has 188,464 bytes.
Observed Wasm linear memory stayed between approximately 19.5 and 20.7 MB across this campaign.
That value is an isolate-wide high-water mark. It excludes JavaScript buffers and total Worker memory.

The [CPU evidence](../evidence/ml-dsa-65-worker-kernels-cpu-20261013.json) records Cloudflare's microsecond analytics buckets.
It includes genuine OT and garbling, unlike the earlier synthetic transport report.
Bucket quantiles and asynchronous WebSocket attribution still prevent a precise per-signature cost claim.
An initial B teardown error occurred after successful output checks.
Explicit server-side closure removed the error in all 24 repeated sessions.
The [diagnosis record](../evidence/ml-dsa-65-worker-close-20261013.json) retains the before-and-after evidence.

Each deployed bundle embeds four public schedules, totaling 18,014,670 uncompressed schedule bytes.
The deployed bundles are approximately 19 MB each and started in 10–12 ms.
Cloudflare currently permits 64 MiB of uncompressed Worker code and 128 MB of isolate memory.
See the [Worker limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size).
The earlier thirteen unique key-generation schedules occupied 91,254,494 encoded bytes.
A public nonce input now replaces eleven sampling descriptions with one description.
This reduces stored descriptions. It does not remove any private SHAKE computation or table traffic.

Six further signing circuits pass independent cleartext fixtures in the resumable host report.
They cover signing-seed expansion, commitment high bits, commitment hashing, response norms, row norms and hints, and aggregate acceptance.
The reciprocal HighBits formula agrees with FIPS Decompose for every residue below `q`.
The hash fixture checks the corrected `mu || w1` order across multiple SHAKE input blocks.
Strict norm boundaries and the 55-hint limit pass.
These checks establish circuit arithmetic. The complete host composition below now produces standard signatures.
A complete security argument and independent review remain open.

## Complete host threshold signing

The [complete host report](../evidence/ml-dsa-65-threshold-host-20261013.json) produces signatures before authorized test recovery.
A shared, resumable [signing state machine](../../crates/ed25519-yao/src/passive/ml_dsa_signing.rs) controls both roles.
The host adapter supplies schedules and byte transport. It adds no second cryptographic implementation.
Each role reads only its own 17,472-byte material file.

The five key-generation cases now each produce a standard 3,309-byte threshold signature.
They include deterministic and jointly randomized signing, with empty and nonempty FIPS contexts.
RustCrypto and OpenSSL accept each signature and reject altered messages, contexts, keys, and signatures.
After signing, the authorized recipient reconstructs the ordinary key and checks exact deterministic signature bytes.
Running either role without its peer fails without producing a signature.

The signer keeps rejected masks, commitments, responses, hints, and individual validity checks private.
It opens challenge hashes and one aggregate acceptance bit per candidate.
It exchanges accepted response and hint shares only after that bit permits release.
The circuit loop supports up to 821 candidates and destroys rejected candidate shares before continuing.
This implements the proposed public-challenge boundary. Its complete composition proof still needs independent review.

| Baseline signing resource | Exact measured bytes |
| --- | ---: |
| Garbled tables for signing-seed setup | 1,193,984 |
| Garbled tables per candidate | 81,345,984 |
| Both directions per candidate, including fresh OT and frames | 91,498,125 |
| Accepted-share exchange | 5,312 |
| Standard signature return | 3,309 |

The deterministic zero and incrementing fixtures each require five candidates.
Their complete host operations each take approximately eight seconds on the recorded machine.
Different keys and attempt counts do not establish a signing latency distribution or p95.
The baseline is a correctness and resource comparison. It does not meet the speed objective by itself.

A public nonce input now reuses one sampling schedule and one signing-mask schedule.
The complete three-key-generation and seven-signing circuit set occupies 33,076,075 encoded bytes.
All five private mask nonce checks use the same schedule digest and match their independent oracle.
The nonce change reduces packaged descriptions. It leaves per-candidate table traffic unchanged.
Complete deployed key generation now passes through the same core used by the host harness.
Production admission, persistence, SDK integration, and protocol selection remain open.

## Complete deployed Worker baseline

The [fixed signing report](../evidence/ml-dsa-65-worker-threshold-fixture-hosted-20261013.json) matches the canonical public key and deterministic signature exactly.
Its measured complete operation took 74.37 seconds, including key generation and five signing candidates.
The [joint signing report](../evidence/ml-dsa-65-worker-threshold-joint-hosted-20261013.json) uses independent role-local seed contributions without seed reconstruction.
Its measured complete operation took 78.36 seconds with four candidates.
The separate joint warm-up required thirteen candidates and took 214.63 seconds.
Each group has one measured sample after one excluded warm-up.
These observations establish successful complete execution. They do not establish a signing latency distribution.

Both Workers verify each standard signature through RustCrypto.
The client verifies through OpenSSL and rejects altered messages, signatures, and public keys.
Both roles agree on complete circuit counts, fresh execution bindings, and exact transport counters.
All runtime traffic remains on a binary WebSocket through the Service Binding.
The shared consuming [key-generation core](../../crates/ed25519-yao/src/passive/ml_dsa_signing/keygen.rs) now replaces the host-only orchestration.
Both adapters also use the same signing core.

The ten unique descriptions occupy 33,076,075 encoded bytes.
Named static schedule data removes duplicate descriptions from each approximately 34 MB deployed bundle.
This reduces code size. It leaves cryptographic traffic unchanged.
Deployed startup observations were 40 ms for A and 30 ms for B.
The [deployment record](../evidence/ml-dsa-65-worker-complete-deployment-20261013.json) pins both versions and build hashes.
The [aggregate CPU record](../evidence/ml-dsa-65-worker-complete-cpu-20261013.json) preserves attribution and billing limits.
The [cleanup record](../evidence/ml-dsa-65-worker-complete-cleanup-20261013.json) verifies deletion of both temporary Workers and the local probe-token file.
Its sanitized tails match all four completed signing sessions and contain zero Worker exceptions.

An initial signing client connection failed with `EHOSTUNREACH`.
An unchanged retry passed. Preserved retry logs show successful completion without Worker exceptions.
The exact initial network cause remains unknown.
This is an infrastructure failure classification, with no claim that the uncorrelated initial request never reached a Worker.

The baseline establishes feasibility under the accepted passive profile.
It exceeds the speed targets and requires optimization before protocol selection.
Prioritize the sampling selection/conversion cost and the complete per-candidate signing cost.
Keep independent composition review, target constant-time qualification, and production lifecycle integration open.

## Foundation evidence — October 13, 2026

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
At this foundation checkpoint, half-gate bytes were estimates from compiled gates.
The later report above measures sampling, private outputs, arithmetic, conversions, OT, framing, and actual garbling.

Compiler simplification reduces the earlier 55.296 MB hashing estimate by about 0.7 percent.
It does not materially reduce the bandwidth requirement.
The next implementation supplied deployed transport probes, actual half-gates, oblivious coefficient selection, and share conversion.
Compare GMW with complete preprocessing costs before choosing a smaller-traffic engine.

The starting review covered repository sources at `seams-wallet` commit `7dc2a5cd`, installed Wallet Server 0.8.0 artifacts, and the primary references below.
The generated report records the later experiment's source revision and file identities separately.
The transport report pins its disposable Cloudflare artifacts.
Production role versions, physical placement, and target-network activation remain unverified.

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
The [state ownership audit](../archive/refactor-150-155.md#state-ownership) also distinguishes benchmark probe Containers from authoritative wallet roles.
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

The [read-only network observations](../evidence/ml-dsa-near-network-20261013.json) record final protocol versions on October 13, 2026.
Mainnet reports version 86. Testnet reports version 87.
Both exceed the pinned source's version-85 feature gate.
This supports investigating current network integration. It does not execute the deployed verifier or prove a transaction succeeds.

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

- [x] Record the exact FIPS edition, applicable errata, NEAR protocol version, and message encoding for the experimental baseline.
- [x] Pin the deployed experimental Cloudflare artifacts and reconcile their runtime with the source and packaged manifests.
- [ ] Verify NEAR feature activation and the exact signing input, including context and prehash behavior.
- [ ] Pin paper revisions, source commits, dependency versions, implementation licenses, and parameter sets for each candidate.
- [ ] Record proof assumptions, prototype limits, security losses, and required external parties.
- [ ] Confirm support for canonical existing keys without plaintext key import at either server.
- [x] Pin an independent ML-DSA-65 implementation as the reference for public test seeds and signature verification.
- [x] Specify the exact share format that the first signing prototype consumes from key generation.
  The uniformly masked format passes complete host and deployed Worker signing before authorized test recovery.
- [ ] Specify the admitted key-generation, signing, refresh, recovery, and export operations.
- [x] Define the experimental roles' inputs, outputs, private material, permitted disclosures, and abort behavior.
  The complete privacy argument and production persistence contract remain open.
- [ ] Specify seed creation and retention, key identity checks, and recovery after permanent participant loss.
- [ ] Choose the intended signing entrypoints and role-private persistence owners.
- [x] Record provisional performance targets before selecting a protocol.
- [ ] Fix the primary signing workload, deployment constraints, and permitted preprocessing storage before ranking candidates.

Output: a concise contract and candidate matrix linked from this plan.
Exit condition: every candidate has an explicit fit, exclusion, or unresolved question.
Refresh the research survey before the final protocol decision.

### 2 Measure the deployed Cloudflare transport

- [x] Extend the existing separate-role benchmark transport with isolated synthetic probes.
- [ ] Record the actual Worker and Durable Object path. Record Container configuration separately if the verified deployment uses Containers.
- [x] Stream synthetic binary payloads of 8, 32, and 64 MB without cryptographic evaluation.
- [ ] Measure the deployed path first. Compare WebSocket, HTTP streaming, and RPC streaming where their runtime boundaries support them.
- [ ] Record actual compute placement and both D1 primary locations separately.
- [x] Measure setup, first byte, last byte, receiver completion, acknowledgments, and application buffer bounds on the probe paths.
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

- [x] Use the existing half-gates engine for the first executable measurements.
- [x] Run A and B in separate processes before repeating the workload in the selected Cloudflare runtime.
- [x] Measure one Keccak permutation, complete seed expansion, and all secret polynomial streams on the native host.
- [x] Include secret sampling, coefficient selection, share conversion, and private outputs in the host pipeline.
- [x] Record generated gate counts, live-wire counts, directional bytes, and native stage latency.
- [ ] Establish target peak memory and exact per-stage CPU attribution. Current Wasm high-water marks exclude total isolate memory.
- [x] Verify exact coefficient values and order against the independent reference using public synthetic fixtures.
- [x] Test fixed sampler exhaustion through controlled synthetic inputs without changing production bounds.
- [ ] Compare GMW on the same workload, including two-party preprocessing generation and all share conversions.

Output: executable kernel measurements and a stage-by-stage resource breakdown.
Exit condition: establish whether hashing, sampling, conversion, transport, or memory creates the largest cost.
Use these results to prioritize the remaining engine options.
Gate counts alone do not establish CPU cost or elapsed time.

### 4 Complete canonical key generation

- [x] Combine the measured secret computation with local arithmetic on shares on the native host.
- [x] Include local matrix expansion, arithmetic, rounding, and public-key encoding in the host pipeline.
- [ ] Compare full Yao estimates with the measured hybrid implementations.
- [ ] Include preprocessing generation and every conversion between computation methods.
- [ ] Include the real transport and role-private persistence path in complete operation timings.
- [x] Compare regenerated public keys across independent standard implementations.
- [x] Reconstruct the test seed only at the authorized export recipient and compare the complete ordinary expanded keypair.
- [x] Verify role-local seed and signing material through the shared-core host and Worker harnesses.
  This check supplies no shared-host operating-system isolation claim.
- [ ] Record separate timings for first use and repeated use of public matrix data.

Output: complete key-generation measurements, public synthetic vectors, and exact share-format descriptions.
Exit condition: reproduce the canonical public key and recovery result within the selected runtime's resource limits.
Retain the current half-gates implementation as the comparison baseline until selection.

### 5 Produce and compare complete signatures

- [ ] Specify how each candidate consumes the exact outputs from key generation.
- [x] Produce the first valid signature from generated shares before expanding SDK integration.
- [x] Measure general 2PC signing with local linear operations on the host and deployed Workers.
- [ ] Evaluate Mithril and Trilithium only after their share and preprocessing requirements are explicit.
- [x] Keep rejected masks, commitments, responses, hints, and individual checks private in the baseline.
  The baseline opens challenge hashes and one aggregate acceptance bit. Its composition argument still requires review.
- [x] Account for fresh randomness, retry counts, candidate selection, conversions, and final encoding in complete baseline runs.
- [ ] Measure empty and prepared preprocessing pools separately.
- [ ] Measure successful signatures across all attempts, including abandoned work.
- [ ] Identify each finalist's largest latency costs and optimize those costs before the final comparison.
- [ ] Measure sustained signing with pool replenishment active and compare results after pool exhaustion.
- [x] Verify threshold signatures with RustCrypto and OpenSSL, including altered-input rejection checks.
- [ ] Verify threshold signatures against the pinned NEAR verifier and a deployed NEAR transaction.
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

1. Reduce exact arithmetic-circuit costs. Use one-AND carry and borrow identities, then repeat canonical key generation, signing, and recovery checks.
2. Measure the revised complete host and Worker flows. Preserve the earlier reports and compare gate counts, bytes, retries, and elapsed time.
3. Compare GMW, ABY2.0, and smaller garbling with complete preprocessing and conversion costs. Prioritize the largest measured sampling and signing costs.
4. Review the exact challenge/count disclosure, share composition, and target constant-time behavior before production integration.
   The [source review](ml-dsa-65-privacy-review.md) records these boundaries.
   Division-free local arithmetic passes complete host interoperability and compiled core checks.
   The complete proof, final Worker qualification, and independent review remain open.
5. Add role-private persistence and admitted Router A/B operations. Define one-use material, cancellation, restart, refresh, export, and restore states.
6. Add explicit SDK ML-DSA encodings. Verify a threshold-signed NEAR transaction with public disposable test keys.
7. Exercise recovery, refresh, peer loss, interruptions, replay rejection, concurrency, and preprocessing exhaustion through E2E scenarios.
8. Rank complete candidates under one workload. Select and package the fastest measured design, then consume exact releases in the private application.

The complete deployed baseline now passes. The first speed experiment changes only Boolean arithmetic identities.
It preserves the canonical seed, share format, protocol sequence, and permitted disclosures.
It provides no new privacy assumption and makes no speed claim before measurement.
Keep implementation and benchmark reports linked from this document as the investigation proceeds.
