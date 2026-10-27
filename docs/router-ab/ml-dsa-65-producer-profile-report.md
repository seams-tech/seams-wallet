# ML-DSA producer profiling and preparation experiments

The fresh hosted controls do not reproduce the earlier twofold producer speed difference.
Its cause remains unknown. Private AES dominates the calibrated local samples.
An AES output-bit experiment regressed on Workers and was removed.
The retained change consumes correlations in chunks. Two hosted runs use less paired producer invocation CPU than a return-to-baseline control.
Consistent refill-latency improvement remains unproven.
The historical slow state remains unexplained. The 6-second preparation target remains open.

## Scope and fixed requirements

The source base is `fc17fdf97`, after rebasing `ml-dsa` on `dev`.
The campaign uses eight temporary Workers and synthetic wallets.
Preparation stays on Workers. Wallet-seed recovery, canonical FIPS export, separate participant custody, and the passive model remain unchanged.
Each wallet holds at most thirty-two candidates. Admission requires sixteen candidates.
Preparation creates four candidates. Signing consumes two candidates at a time. The wallet cooldown remains sixty seconds.

The retirement screens deliberately remove ready stock, then measure its replacement.
They measure preparation cost and reserve restoration. They do not measure signatures per minute.
Registration and signing use the private Router path. Their timings exclude public SDK work, human approval, and NEAR finality.

## Historical producer difference

The replay script selects successful four-candidate invocations whose start timestamps fall within each recorded window.
Some completions occur after the window. These cohorts measure job cost, rather than throughput within the window.

| Phase | Producer | Jobs | A CPU median | B CPU median | Broad preparation span median |
| --- | --- | ---: | ---: | ---: | ---: |
| Warmup | Primary | 20 | 8.788 s | 9.132 s | 16.530 s |
| Warmup | Secondary | 35 | 4.023 s | 4.089 s | 7.207 s |
| Completion | Primary | 13 | 9.043 s | 9.539 s | 17.482 s |
| Completion | Secondary | 13 | 4.196 s | 4.265 s | 7.709 s |

All eighty-one jobs have a unique matching B invocation and complete public stage observations.
The difference remains after excluding cold topology construction on each participant separately.
The retained scope lists equal same-role Wasm hashes across producers. It records intended artifacts, rather than independent remote binary attestation.
All selected placement fields are unavailable. Module-local activity counters cannot measure host-wide contention.

The `correlations_completed` boundary includes nonce masks, topology work, and preparation of several circuit batches.
Its wall span does not isolate AES CPU. Wasm memory observations exclude transient peaks, JavaScript memory, and native allocations.

## Fresh slot and concurrency controls

Both isolated screens use the same native-fixture wallet, schedule, policy, and baseline participant artifacts.
The second screen directs that wallet's logical primary slot to the physical secondary producer.
Each screen retires sixteen pairs, publishes sixteen fresh pairs, and restores the full reserve through eight jobs.

| Baseline screen | Physical producer | Jobs | A CPU median | B CPU median | A invocation wall median | Full reserve restoration |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Isolated primary | Primary | 8 | 3.907 s | 4.117 s | 9.732 s | 82.084 s |
| Isolated secondary | Secondary | 8 | 4.121 s | 4.319 s | 9.649 s | 83.215 s |
| Concurrent control | Primary | 10 | 4.338 s | 4.493 s | 9.803 s | 115.313 s, both wallets |
| Concurrent control | Secondary | 6 | 4.631 s | 4.742 s | 10.551 s | Same window |

The concurrent control retires thirty-two pairs and publishes thirty-two replacements.
Ten cross-slot crypto lifetimes overlap. These observations establish overlapping work, without proving simultaneous CPU execution.
Protocol traffic is equal across the thirty-two baseline jobs: A sends 3,967,488 bytes and receives 1,434,560 bytes, with 556 pending exchanges.
The qualified baseline windows contain no exceptions, load shedding, or truncated trace records.

The first attempted concurrent control used stale swapped routing in an existing controller.
All sixteen jobs reached the physical secondary producer. Two invocation exceptions occurred.
That window took 216.705 seconds and is excluded from performance comparisons.
Its records remain in the evidence so the exclusion is repeatable.

A changed entry module removed the swapped controller from the corrected window.
The corrected window still contains two controller versions with normal routing.
Thus a successful deployment receipt does not establish the version or bindings of every active actor.
Each accepted comparison checks actual producer versions and observed logical-to-physical routing.
The campaign does not establish the platform cause of this actor-version behavior.

## Local preparation profile

The calibrated workerd profiler samples actual preparer A and B Workers through their first full reserve.
Symbol maps match the measured Wasm hashes. The baseline lifecycle passes.

| Sample category | A | B |
| --- | ---: | ---: |
| Private AES | 49.90% | 41.65% |
| Code-matrix encoding | 23.80% | 24.00% |
| Remaining preparation loop | 14.46% | 17.01% |
| Curve arithmetic | 6.18% | 7.64% |

These proportions are samples, rather than billed CPU. Inlining changes attribution.
Local profiling does not explain the hosted slot difference. Some baseline execution overlapped local build and native work.
Absolute local latency comparisons remain exploratory.

## Rejected AES output-bit experiment

Triple hashing needs one ciphertext bit per AES block.
The experiment ran the same AES rounds, then extracted those bits directly from the final SIMD bit planes.
It avoided unused ciphertext conversion, a duplicate input buffer, and an unnecessary full-output XOR loop.
Independent RustCrypto comparisons covered 256 keys and all lengths from zero through sixteen blocks.
Existing full-output AES checks, four genuine two-process correlation chunks, and the complete local Worker lifecycle passed.

Node-Wasm kernel screens improved by roughly four to ten percent across exploratory repeats.
The local full-reserve measurement changed from 38.086 seconds to 37.085 seconds, with the baseline overlap caveat above.
The complete hosted isolated screens regressed:

| Physical producer | Baseline A / B CPU medians | AES experiment A / B CPU medians | Baseline / experiment reserve restoration |
| --- | ---: | ---: | ---: |
| Primary | 3.907 / 4.117 s | 4.249 / 4.498 s | 82.084 / 86.143 s |
| Secondary | 4.121 / 4.319 s | 4.433 / 4.655 s | 83.215 / 92.146 s |

Both roles used more CPU. The experiment was removed before another concurrent screen.
A preliminary one-percent inlining experiment was also removed.
The evidence retains the rejected patch and results. No AES implementation change remains in production sources.

## Correlation consumption experiment

The existing loop awaited the correlation stream once for every AND gate.
The new loop borrows the next bounded contiguous slice, then packs that slice synchronously.
Chunk generation still uses the same fresh binding, counter, OT work, and protocol messages.
The stream advances before returning its exclusive mutable borrow.
Each source entry is cleared before packing. Temporary triples and abandoned chunks retain their erasure behavior.
A generation failure or cancellation still poisons the stream before the next await.
An exhausted chunk now retains its cleared allocation until the next request or drop.

Independent review found no new binding, ordering, reuse, aliasing, or secret-dependent branch defect.
This review does not establish a full composition proof, register erasure, or JIT constant-time guarantee.
The native mixed-circuit E2E passes 105 instances and 2,467,738 AND gates with genuine private OT.
Both roles match independent public oracles. Mismatched layouts fail before private preprocessing.
The complete local Worker lifecycle also passes, including interruptions, durable publication, retained unopened material, and standard signatures.
Its initial reserve takes 36.884 seconds. This absolute local comparison retains the baseline overlap caveat.
The native wallet-recovery campaign checks seed-derived restoration, the canonical public key, ordinary export, and signing.

The first hosted concurrent screen restores both reserves in 87.579 seconds through sixteen published jobs.
Primary A/B CPU medians are 4.540/4.706 seconds. Secondary medians are 4.081/4.266 seconds.
Two independently verified standard signatures take 3.415 and 3.147 seconds through the private Router path.
The second key is the wallet-seed-recovered key from the canonical registration campaign.
The final candidate/control/candidate sequence uses eight jobs on each physical slot in every window:

| Sequence | Primary A / B CPU medians | Secondary A / B CPU medians | Paired producer invocation CPU | Client observes both reserves restored |
| --- | ---: | ---: | ---: | ---: |
| Chunked run 1 | 4.540 / 4.706 s | 4.081 / 4.266 s | 142.334 s | 87.579 s |
| Return baseline | 4.439 / 4.550 s | 4.115 / 4.250 s | 145.839 s | 88.744 s |
| Chunked run 2 | 3.703 / 3.849 s | 3.964 / 4.142 s | 132.399 s | 84.019 s |

The CPU sum includes both participant invocations for the sixteen complete jobs.
It excludes producer dispatch calls, about 47–68 milliseconds per window, plus Router and pool-actor CPU.
The paired producer invocation CPU sums are about 2.4% and 9.2% lower than the return control.

The driver polls inventory every five seconds. Client-observed restoration includes that detection delay.
The latest logged paired publication occurs at 86.816, 84.388, and 79.250 seconds in sequence order.
Corresponding detection delays are 0.763, 4.356, and 4.769 seconds.
The first candidate publishes later than the control. Its shorter client-observed restoration time comes from the different detection delay.
The repeat candidate improves both observed publication and CPU. Consistent publication acceleration remains unproven.
All three windows publish thirty-two fresh pairs, exactly matching final ready stock at both participants.
Published pairs are unique and disjoint from the retired pairs. No exception, load shedding, or truncated record appears.
Canceled alarm invocations remain in the outcome counts. No unsuccessful invocation enters cryptographic work.
Actual participant versions match deployment records and the provider's retained deployment history.

The last candidate's A invocation wall medians are 8.306 and 8.874 seconds per four-candidate job.
Across both candidate runs, these medians range from 8.306 to 10.593 seconds.
These small cohorts do not establish a stable percentage improvement or a preparation tail bound.
The first candidate's primary all-job median regresses. Its warm cohort contains both 3.7–3.9-second and 5.1–5.3-second CPU jobs.
Raw job distributions and both warm/all-job summaries remain in the evidence.
The small change is retained as a bounded CPU optimization because both candidate screens use less paired producer invocation CPU.
The implementation removes per-gate asynchronous bookkeeping and preserves protocol outputs. No stable latency or percentage gain is claimed.
Further measurements must preserve execution variation in capacity estimates.

The earlier 115.313-to-87.579-second comparison does not establish a 24% implementation gain.
Its baseline secondary starts at t+25.85 seconds, versus t+1.75 seconds for the candidate, and the job split differs.
The return control narrows the observed difference substantially.

## Registration and recovery control

The baseline hosted registration runner verifies canonical key creation and recovery of the same key.
Creation takes 7.691 seconds including client verification. Recovery takes 5.322 seconds.
Their initial signatures take 2.387 and 3.098 seconds.
Generic registration preparation takes 107.612 and 54.112 seconds separately.
These two samples do not qualify a registration distribution or public SDK latency target.

## Findings and open causes

Measured:

- The historical twofold CPU difference survives separate warm-cache filters.
- Fresh isolated controls have similar costs on both physical slots.
- Private AES is the largest local sampled preparation category.
- The AES candidate regresses in complete hosted measurements despite an isolated kernel gain.
- Actor version and binding checks reject an otherwise plausible concurrent comparison.
- Both complete chunked runs use less paired producer invocation CPU than the return control, with variation between roles.
- Five-second inventory polling obscures small restoration differences. The first candidate publishes later than the control.

Inferred:

- Selecting the historical fast producer cannot support a reliable capacity claim.
- Complete published work and reserve restoration must decide whether a kernel optimization is useful.

Unknown:

- The historical difference's cause requires a repeat of the slow state with provider placement or execution data.
- Local sample attribution needs hosted parity before it can explain a hosted CPU difference.
- Four-wallet sustained signing needs another complete load and reserve-restoration campaign after an implementation qualifies.

| Candidate cause | Relevant fact | Status |
| --- | --- | --- |
| Cold topology construction alone | Historical gap survives warm filters | Contradicted as a complete explanation |
| Publication waits alone | Both participants also show a large CPU gap | Contradicted as a complete explanation |
| A permanent physical-slot penalty | Fresh isolated slot costs are similar | Contradicted as a universal explanation |
| Different intended Wasm artifacts | Archived same-role hashes agree | No supporting evidence. Independent remote attestation is unavailable |
| Host placement, execution conditions, or contention | Placement is unavailable. Fresh results differ | Open. Provider data or recurrence is required |
| Measurement setup | A stale swapped controller reached the wrong producer | Confirmed for the excluded concurrent screen only |
| Faster AES kernel implies faster preparation | Both complete hosted AES screens regressed | Contradicted for the rejected experiment |

Parity is established for the production preparation path and protocol outputs exercised by these Worker screens.
Parity with public SDK latency and sustained four-wallet signing is not established by retirement screens.
Earlier wording that described the AES candidate as retained is withdrawn. The hosted results reject it.
The earlier draft's historical count of eighty-three is corrected to eighty-one by exact-window replay.
Earlier progress wording that both candidates restore reserves sooner needs the client-observed qualifier.
It does not establish that both candidates publish sooner.

## Reproduction and next work

Run `summarize_producer_variation.py` on the normalized trace file and each retained phase window.
The script checks unique A completions, matching B invocations, complete stages, and role-specific warm-cache observations.
The script also counts all outcomes and checks both participants' publication IDs against final ready stock.
Configuration, actual versions, and routing need the separate retained records.

The evidence archive and machine-readable index are linked below.
The replay includes all outcome counts and verifies paired publication IDs against final ready stock.
No benchmark tokens, participant storage keys, or private fixtures belong in the archive.

- [Evidence index](../evidence/ml-dsa-65-producer-profile-20261027.json)
- [Public measurements and rejected experiment patches](../evidence/ml-dsa-65-producer-profile-20261027.tar.gz)

The next optimization must follow the measured hosted result.
Code-matrix encoding uses about one quarter of local samples and is the next distinct measured cost after private AES.
Profile its encoding and memory traffic before changing its loop or data layout.
Any change must preserve correlation order, code parameters, secret-independent access, and single use.
The registration, signing, preparation, and four-wallet targets in refactor-201 remain qualification goals.

## Validation and cleanup

The final Worker builds, native mixed-circuit E2E, wallet recovery/export campaign, and complete local Worker lifecycle pass.
Both hosted signatures also verify offline and reject altered messages. Fresh and historical offline replays exactly match the retained summaries.
The independent evidence review reproduces the final counts, versions, and timing caveat.
The required bloat check fails on inherited Rust duplication: 13,992 lines against a 13,754-line baseline.
This change leaves that count unchanged. No baseline was widened.
The native evidence helper was updated for the current persisted fence result and conservative failed settlement.
Its prior compilation failure was an obsolete helper API, rather than a production regression.
The Wasm instruction inventory now reads the actual ML-DSA build directory. It does not prove JIT constant-time execution.

All eight temporary Workers were deleted. Independent API checks return Worker-not-found code 10007 for every name.
The front Worker required one deletion retry after API code 10013. This cleanup error is separate from measured preparation outcomes.
No D1 database or R2 bucket was created. Benchmark credential payload files were removed after the artifact scan.
