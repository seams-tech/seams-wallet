# ML-DSA-65 preparation and signing comparison

Status: investigation plan, October 15, 2026. Production continues with the current protocol.

Reduce recurring preparation while preserving canonical wallet-seed recovery and standard FIPS seed/key export.
Compare improvements to the current hybrid protocol with Quantus threshold signing after private canonical-key conversion.
Target 10–20 seconds for useful preparation and up to two seconds for online signing.
GPU research remains deferred. Use Cloudflare Workers for both participants.

This plan resumes focused preparation investigation.
It supplements the [main plan](ml-dsa-65-investigation-plan.md) and reuses the [Mithril conversion analysis](ml-dsa-65-mithril-feasibility.md).
Concurrent Gateway and SDK integration can continue against the current protocol.
Keep experimental signing engines outside the production path until the selection gate passes.

## Requirements that every candidate must preserve

- Two separate participants must cooperate for every signature.
- Preserve the passive, honest-execution privacy model. Each role learns only its specified private share and permitted disclosures.
- Keep the wallet custody seed, canonical FIPS seed, and complete expanded key hidden during normal service execution.
- Preserve the existing wallet derivation binding and the same ordinary ML-DSA-65 public key.
- Authorized export must reproduce the canonical seed and standard expanded private key with an independent implementation.
- Recovery from the wallet seed and existing public derivation metadata must work after both service stores are lost.
- Output ordinary ML-DSA-65 signatures that independent verifiers accept.
- Preserve role separation, authenticated admission, operation IDs, replay handling, epochs, and durable single-use protections.
- Keep the configurable wallet cooldown and separate service capacity controls. Internal retries belong to one admitted operation.
- Retain the accepted public sampler decisions and public `t0` boundary for canonical key generation.
- Document any additional transcript disclosure or cryptographic assumption before accepting it.

The passive model still requires analysis of what one honest participant can infer from its own view.
A valid signature alone does not establish share privacy.
A new short-share design must specify recovery and refresh limits before it can qualify for production.

## Baseline and measurement boundaries

The [Worker execution report](ml-dsa-65-worker-execution-report.md) records **45.5 seconds to fill four batches** in local workerd.
Each batch contains four candidates. A candidate is one attempt that can fail rejection checks.
Thus, four batches contain sixteen candidates and do not guarantee four signatures.
The observed average was about 11.4 seconds per batch, including persistence and alarm scheduling.

The [refill scheduling report](ml-dsa-65-refill-scheduling-report.md) records three later signing requests: **488, 305, and 293 milliseconds**.
These are local workerd results. They do not establish hosted percentiles or preparation throughput during sustained use.
The two reports describe distinct runs. Repeat them together before computing a combined throughput claim.
Earlier hosted measurements remain separate controls with their original configurations.

Use these timing boundaries for every design:

| Metric | Start and finish |
| --- | --- |
| First usable preparation | Refill demand recorded until both roles durably hold enough matching material for admission |
| One batch | Producer lease acquired until both halves are durable and usable |
| Full reserve | Empty configured pool until the target stock is durable at both roles |
| Registration | Authorized ceremony request until the canonical signer is installed and available |
| Online signing | Router request arrival until independent verification, durable result storage, and response |
| Empty-pool service delay | First eligible request until a verified signature, including refill waits and explicit retry responses |
| Recovery | Authorized wallet-seed recovery request until the same signer is usable again |
| Sustainable capacity | Successful signatures per minute while stock remains stable under the tested workload |

Measure protocol preparation, persistence, alarm delay, lease waiting, and network transport separately within these boundaries.
Count CPU time for A and B, elapsed time, traffic in both directions, stored bytes, peak memory, and billed operations.
Report active production time separately from queue time under load.

## Targets and decision rules

This plan proposes experiment acceptance criteria. Existing measurements do not establish these guarantees.
Use the existing admission threshold when comparing readiness.
Do not reduce reserved candidates or loosen security parameters solely to obtain a faster headline.

| Goal | Acceptance criterion |
| --- | --- |
| Useful preparation | p95 at most 20 seconds from an idle producer to the first admissible reserve. Aim for 10 seconds |
| Comparable full reserve | Aim for p95 at most 20 seconds for the current four-batch reserve, or equivalent measured success capacity |
| Online signing | p95 at most two seconds for admitted requests with ready material |
| Slow signing | Record p99, maximum, and the fraction over two and five seconds. Every failure remains in the request totals |
| Prepared registration | Retain the existing five-second goal. Include canonical conversion and installation in the candidate path |
| Cold registration and recovery | Report the complete time and all prerequisite work separately. Do not hide conversion as free setup |
| Availability | At least 99% completion within the experiment's fixed candidate/time budget. Report uncertainty and exhaustion separately |
| Sustainable refill | Produce at least as fast as the stated workload consumes stock, with explicit service capacity and headroom |

A candidate that meets first readiness but misses the equivalent full-reserve target earns a partial result.
A smaller pool must show its rejection risk and replenishment behavior under the same workload.
The cooldown controls demand. It does not prove sufficient capacity across many wallets.

## Designs to compare

| Design | Key generation | Signing and preparation | Main question |
| --- | --- | --- | --- |
| A0: current hybrid | Prepared Yao half-gates protect canonical seed expansion and sampling | GMW private checks, silent-OT correlations, durable ready pools | What accounts for preparation time in the current complete path? |
| A1: improved hybrid | Same canonical key and share contract | Optimize measured bottlenecks and preparation scheduling | Can modest changes meet the target without changing long-lived shares? |
| A2: hybrid with more online work | Same canonical key and share contract | Move selected preparation work into the two-second signing budget | Does total service cost fall while the full request remains fast enough? |
| B: Quantus with private import | Existing canonical derivation plus reviewed conversion to short shares | Local hyperball sampling and threshold signing | Does cheap recurring signing justify conversion, security review, and recovery costs? |

Yao uses garbled circuits to evaluate secret computations.
GMW evaluates Boolean circuits on shared bits. Silent OT supplies the private correlations that GMW consumes.
Short shares contain small coefficients. Hyperball sampling generates masks inside a bounded high-dimensional ball.

Pin Quantus to [`3b1464f751d536aba023a53df2a4f4533ab94f62`](https://github.com/Quantus-Network/qp-rusty-crystals/tree/3b1464f751d536aba023a53df2a4f4533ab94f62/threshold) for the first comparison.
Compile with default features disabled and explicit `ml-dsa-65` and `std` features.
Verify the effective parameter set in the resulting artifact. Its default feature selects ML-DSA-87.

The preliminary native screen verified 100 signatures across ten synthetic dealer-generated keys with RustCrypto.
It observed 5.2 ms median signing, 15.1 ms p95, and about 123 KB mean protocol traffic including retries.
Both roles ran in one process. This screen excludes canonical conversion, network, storage, and Worker execution.
All ten seeds produced different keys from standard FIPS derivation.
Retain the harness and raw results in Phase 1 before using this screen as durable comparison evidence.

## Phase 1: freeze and reproduce the baseline

The [local baseline report](ml-dsa-65-preparation-baseline-report.md) records the first completed comparison campaign.
Two unprofiled runs first observe admission stock at 20.12–21.14 seconds and the full reserve at 39.15–42.18 seconds.
Six successful requests take 314–488 ms. Canonical export and wallet-seed recovery pass native E2E checks.
CPU sampling identifies silent-OT generation and software AES as the next optimization target.
Stage-level cost separation, hosted measurements, sustained load, and Quantus canonical conversion remain open.


- [ ] Pin source revisions, Rust dependencies, Wasm bundles, runtime versions, deployment settings, and enabled features for each candidate.
- [ ] Retain the Quantus review harness, raw samples, reproduction command, and source hashes in the investigation tooling.
- [x] Repeat local canonical key generation and wallet-seed recovery alongside Worker four-batch refill and signing. Worker registration uses injected role material.
- [x] Confirm actual candidates per batch, admission threshold, expiry, reservation policy, and service-wide producer limit.
- [ ] Instrument silent-OT setup, correlation expansion, nonce work, private decomposition, circuit work, storage, and scheduling.
- [ ] Record work that can be shared across candidates without reusing any secret correlation or signing mask.
- [ ] Repeat a small hosted control with separate A/B storage and the same request boundaries.

Output: one baseline report with raw samples and a ranked list of preparation costs.
Do not infer a bottleneck from total elapsed time alone.

## Phase 2: test small improvements to the existing hybrid

- [ ] Compare preparation groups of 1, 2, 4, and 10 batches. Measure first publication and full-group completion separately.
- [ ] Publish each complete pair as soon as both halves are durable. Measure whether this changes first admission time.
- [ ] Reuse public schedules, public caches, and immutable matrix data where their bindings permit reuse.
- [ ] Profile Wasm execution, copies, encoding, and storage before changing the cryptographic protocol.
- [ ] Test bounded producer concurrency only within measured Worker memory and CPU capacity.
- [ ] Test local signing and timer responsiveness during legitimate refill. Include cross-wallet contention and service admission.
- [ ] Test whether topology work, restoration, or another measured component can move online within the two-second budget.
- [ ] Review any change to correlation setup, amortization, or protocol disclosures before benchmarking it as an eligible design.
- [ ] Compare total preparation plus signing cost. Identify optimizations that merely move waiting into another phase.

Output: A0/A1/A2 measurements with identical security parameters and stated success capacity.
Never reuse consumed correlations. Shared base setup requires a supported reviewed construction and fresh domain-separated outputs.
Ten sequential jobs do not establish a batching speedup.

## Phase 3: qualify canonical conversion for Quantus

Reuse the existing Mithril analysis. Avoid a second conflicting conversion specification.

- [ ] Confirm the exact Quantus share assumptions, constructor requirements, rejection bounds, and serialization behavior for 2-of-2 ML-DSA-65.
- [ ] Specify an exact distribution for short shares whose integer sum equals each canonical coefficient.
- [ ] Analyze conditional Gaussian conversion and the smaller bounded-share alternative already described in the Mithril report.
- [ ] Quantify the information each role receives. Evaluate lattice hardness, distribution tails, numerical error, and transcript composition.
- [ ] State a concrete security target and its assumptions. Document any reduction from the current security claim before selecting B.
- [ ] Review the ML-DSA-65 parameters against the imported distribution. Stock independent-share parameters do not automatically apply.
- [ ] Specify repeat recovery with stable role assignment and a private deterministic sampling tape, if the review justifies that method.
- [ ] Analyze share replacement, role compromise across time, epoch changes, and version changes. State any limit on fresh sharings.
- [ ] Preserve seed-only recovery after complete storage loss. Additional secret backup artifacts require a separate product decision.
- [ ] Measure circuit costs for both the conditional sampler and its secret-derived tape before implementing the full conversion.
- [ ] Compare compact lookup, comparison-tree, or arithmetic implementations that preserve the specified distribution and privacy.
- [ ] Trace every proposed public intermediate. Keep new secret-dependent selection patterns private unless separately justified.

The existing simple Gaussian circuit estimate is about 2.22 GB of tables, before deterministic-tape costs.
That estimate is illustrative. It is not an approved construction or a lower bound on compact implementations.
Use it as an early resource warning, not a reason to implement the large circuit first.

Output: a reviewed conversion contract and measured or bounded resource estimate.
Stop advancement if privacy, recovery, or registration cost cannot meet the retained requirements.
A scalar leakage calculation alone cannot qualify the complete lattice key.

## Phase 4: implement the smallest disposable comparison

Start this phase only after Phase 3 identifies a viable conversion contract.

- [ ] Keep the current canonical key generator. Output only the converted share intended for each role.
- [ ] Add a narrow role-local Quantus import boundary. Keep full-key reconstruction outside normal execution.
- [ ] Run both participants in separate processes before Worker integration.
- [ ] Compare local on-demand masks with locally prepared masks. Preserve fresh randomness and durable single-use ownership.
- [ ] Use existing Router operation identity, participant authentication, admission, expiry, and terminal-result storage.
- [ ] Measure network phases through Router A/B. Count retries and final settlement as part of the request.
- [ ] Keep preparation formats specific to each engine. Share existing lifecycle behavior where it fits without a new generic framework.
- [ ] Review sampler timing, floating-point behavior, secret branches, and generated Wasm against the actual threat model.

Output: an E2E artifact showing a threshold signature before authorized export and recovery.
Test canonical seed and expanded-key equality against an independent library.
A successful native or Wasm compile is only a portability check.

## Phase 5: compare complete Worker service behavior

Run a 100-operation local screen first. Advance only candidates that pass correctness and the resource screen.
For hosted qualification, collect at least 1,000 logical signing requests across multiple wallets and runs per shortlisted design.
Publish sample counts and uncertainty. This experiment size does not establish a production latency guarantee.

- [ ] Measure warm stock, initially empty stock, and continuous refill.
- [ ] Run one wallet at its configured cooldown and simultaneous requests from many permitted wallets.
- [ ] Measure service capacity with refill and signing active together. Record queueing and refusals.
- [ ] Exercise candidate rejection, reserve exhaustion, duplicate requests, and conflicting operation payloads.
- [ ] Interrupt paired publication, signing, and result delivery. Restart both role stores and test replay.
- [ ] Recover the canonical signer after deleting disposable service state. Sign again and independently verify the result.
- [ ] Test epoch changes, stable role mapping, secret-store restoration, and stale preparation rejection.
- [ ] Verify a standard signed NEAR transaction through the available SDK path. Report any missing integration explicitly.
- [ ] Record all timeouts and unsuccessful requests. Report successful latency separately from completion rate and exhaustion.

Use disposable test wallets. Store public fixtures, hashes, stage timings, byte counters, and lifecycle outcomes in repeatable artifacts.
Keep role secrets and benchmark credentials out of retained reports.
Record Cloudflare placement observations rather than assuming that both Workers share a region.

## Phase 6: select a complete design

Produce one comparison table with these columns:

- Canonical key generation, private conversion, registration, and recovery cost.
- First admissible stock and equivalent full-reserve time.
- Online signing p50, p95, p99, observed maximum, completion rate, and retry distribution.
- Preparation CPU, online CPU, traffic, persistent storage, memory, and total cost per successful signature.
- Sustainable signatures per minute, expiry waste, and pool exhaustion under the tested workload.
- Security assumptions, review coverage, dependency maintenance, license status, and remaining integration work.

For B, show lifetime cost after 1, 10, 100, and 1,000 successful signatures.
Include every registration, recovery conversion, discarded mask, and failed attempt in the relevant total.
Report the break-even signature count where B repays any additional conversion cost.

Select A1 or A2 if it reaches the targets with the current share contract and lower implementation risk.
Select B only after canonical conversion and recovery pass review and complete Worker measurements justify the extra work.
If both miss the targets, report the measured limiting component and the next bounded experiment.
Do not silently relax export, privacy, recovery, or the Worker architecture.

## Quantus-specific adoption gates

The [threshold README](https://github.com/Quantus-Network/qp-rusty-crystals/blob/3b1464f751d536aba023a53df2a4f4533ab94f62/threshold/README.md) labels ML-DSA-65 tables and resharing unaudited.
Its claimed threshold audit needs a report with matching scope and revision.
The included Neodyme report covers ordinary Dilithium and HD wallets.
The [sampler](https://github.com/Quantus-Network/qp-rusty-crystals/blob/3b1464f751d536aba023a53df2a4f4533ab94f62/threshold/src/protocol/primitives.rs) explicitly lacks timing and floating-point side-channel hardening.
The threshold manifest says GPL-3.0, while the root license contains Apache-2.0. Resolve this before adoption.

Use published evidence for this review. Contacting maintainers requires a separate explicit instruction.
GPU services, noncanonical derivation, and removal of export remain outside this investigation.
