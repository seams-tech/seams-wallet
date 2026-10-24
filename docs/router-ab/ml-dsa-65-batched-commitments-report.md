# Batched ML-DSA commitment exchanges

Date: October 24, 2026. Source parent: `5b58906f`. Branch: `ml-dsa`.

Batching works, but the tested early-commitment placement remains unselected.
Eight independent pairs share 113 AND-layer exchanges instead of 904.
Complete prepared registration still takes 6.213 and 6.954 seconds.
All six hosted candidate signatures verify below five seconds, but their lower rejection count limits the latency comparison.
The prototype and evidence are archived. The current runtime remains selected.

## What the prototype does

The prototype uses the existing GMW evaluator once for several independently prepared pairs.
GMW is a two-party protocol that evaluates Boolean gates on secret shares.
Each existing circuit group keeps its lane count, private correlations, instance binding, and output ownership.
Only group indexes move when the evaluator receives the complete cohort.
Equal schedules remain separate groups. Repacking their correlation bytes would change their meaning.

A new public binding covers the ordered cohort, pair boundaries, and each request binding.
The evaluator also binds every instance and schedule digest.
After evaluation, outputs return to separate two-candidate reservations with their original individual key, epoch, and material bindings.
Each reservation remains independently consumable.
Long-term signing shares never enter this commitment step.

The Worker burns every selected input in one committed transaction before opening private state.
It publishes every selected output in one transaction after checking all `Committing` markers and the live consumed preparation.
A publication error rolls back every output. Consumed input cannot resume.
The default initial stock uses one eight-pair cohort.
Larger permitted jobs use bounded cohorts of up to eight pairs and thirty-two candidates.
The existing role Workers continue to execute signing.

## Fixed requirements

Wallet-seed recovery, ordinary FIPS seed/key export, and private commitments remain unchanged.
The passive, honest-execution privacy model gains no new assumption.
No circuit, sampler, signature encoding, cryptographic primitive, or public SDK wire format changes.
Canonical public keys match across the matched hosted arms and recovery.

Preparation stays on Workers. Four candidates are prepared together and two are consumed per pair.
Pool capacity stays at thirty-two candidates. Admission requires sixteen ready candidates.
The hosted policy keeps a sixty-second wallet cooldown, one active signing operation, and a thirty-second signing deadline.
GPU and UI work remain deferred.

## Hosted comparison

| Arm | Registration: create / recovery, s | Successful signing range, s | Signatures below 5 s | Consumed pairs |
| --- | --- | --- | --- | --- |
| Control | 5.224 / 5.201 | 3.388–6.970 | 5/6 | 19 |
| Candidate | 6.213 / 6.954 | 1.660–3.079 | 6/6 | 12 |

Each arm completes two canonical ceremonies and four later recovered-key signing requests.
All twelve hosted signatures verify. Every signing operation has complete A/B traces.
The candidate consumes twenty-four candidates; the control consumes thirty-eight.
The control's slowest signature consumes nine pairs. Candidate requests consume one to four pairs.
These differences prevent a causal latency estimate from the six-request ranges.

| Arm | Epoch | Initial preparation, s | Registration + first signature, s |
| --- | --- | --- | --- |
| Control | 1 | 67.460 | 8.613 |
| Control | 2 | 56.428 | 9.615 |
| Candidate | 1 | 66.495 | 8.416 |
| Candidate | 2 | 96.955 | 10.033 |

Complete registration plus first signing shows no demonstrated improvement over the matched control.
Prepared registration starts after key-independent material is ready and includes client custody verification.
Signing ends after the HTTP response body is decoded. Independent verification follows that timer.
Cooldown scheduling, login, browser UI, transaction submission, and NEAR finality are outside these timers.
Initial preparation includes key-generation material and sixteen signing candidates. It is not a four-candidate refill measurement.
This experiment establishes no sustained preparation throughput gain or empty-pool latency improvement.

The [earlier sequential screen](ml-dsa-65-early-commitments-report.md) registers in 9.968/15.992 seconds.
Its commitment phase takes 4.357–11.130 seconds, compared with 0.966–2.627 seconds here.
That screen uses a different wallet context and separate deployments. Its timings are reference observations, rather than a matched reversal.

## Exchanges, traffic, and memory

| Eight-pair workload | Sequential singleton calls | One cohort |
| --- | --- | --- |
| AND-layer exchanges | 904 | 113 |
| Actual AND gates | 4,866,048 | 4,866,048 |
| Traffic in both directions, bytes | 3,327,488 | 3,327,040 |
| Largest logical message, bytes | 23,552 | 188,416 |

The native sequential comparison uses eight singleton calls to the new cohort API.
It tests cohort width, rather than equivalence against the old `commit` transcript.
The inputs are fresh and disjoint. No valid reservation is evaluated twice.
Only 448 traffic bytes disappear. The gain comes from fewer dependent exchanges.
The 188,416-byte logical message stays below the runtime's 1,048,576-byte limit.

A transport wrapper records actual bytes and maximum message size.
It checks aggregate accounting against the encoder before returning.
Shared binding traffic and each shared exchange are attributed to the first participating pair.
Those attributed metrics describe shared execution; they do not describe each pair's standalone cost.
Distinct topology allocations use `Rc::ptr_eq`, because equal schedules can exist in separate caches.

| Hosted commitment phase | A, s | B, s |
| --- | --- | --- |
| Create | 1.523 | 2.141 |
| Recovery | 0.966 | 2.627 |

These elapsed intervals include input burn, restoration, evaluation, resealing, and output publication.
They cannot partition cryptographic CPU, peer waits, and storage waits.
Hosted post-publication Wasm allocation is 90.063 MiB on B and 111.875 MiB on A.
This reading measures allocated linear memory, rather than total Worker peak memory.
Local reused isolates reach 137.688 MiB on A. That allocation already appears before commitment in both the previous sequential and current batched campaigns.
These observations do not establish a batching-induced memory increase or safe sustained memory use.

## Safety and lifecycle evidence

Six native canonical-key cases pass.
The durable two-process fixture compares eight singleton calls with eight-pair and three-pair cohorts.
Its twenty-slot functional ledger is unchanged; it is separate from the sixteen-pair product pool.
Every stored pair is consumed independently. Five signatures verify, including three accepted from batched outputs.
One isolated generic pair is burned and refused before private activation.

Fresh negative cohorts cover reordered pairs, duplicate IDs, mixed roles, a mismatched public key, and a mismatched epoch.
Duplicate and mixed-role requests send no messages.
The other mismatches exchange only one thirty-two-byte public binding in each direction.
All five cases fail before gate exchanges.
Restored committed state also rejects substituted storage bindings, wrong keys, and wrong epochs.

The real-Worker retirement test holds output after the complete eight-pair input burn.
It retires preparation while admission remains live and then releases publication.
All selected inputs remain unusable, including after restart. A fresh job preserves the canonical key.

The publication test injects failure after writes reach the fifth output record.
A snapshot immediately after rollback shows all eight records still `Committing`, with no source chunks, role result, or combined result published.
Restart preserves consumption. A may publish its local result after its own cohort commits; the combined result still requires B.
The test checks each selected record and its first chunk. It does not prove immediate physical deletion of every ciphertext chunk.

The publication fault checks pass, but its later fresh signing request exhausts all sixteen admitted candidates.
The complete campaign correctly reports `functionalPassed: false`.
Its next recovered-key request preserves cooldown. This failed complete-flow sample remains in the evidence without a green repeat.
No production or test behavior changes to conceal that outcome.

The normal, retirement, and lost-delivery campaigns complete successfully.
The normal Gateway campaign covers recovery, device signing, participant restoration, and standard transaction signatures.
The delivery campaign checks atomic installation rollback, concurrent exact ciphertext replay, restart, and refusal after the claim ends.
The offline verifier rechecks eighteen retained HTTP/transaction signatures and rejects altered messages.

A control A-pool invocation rejects an inactive preprocessing lease.
Its public call identifier and error remain archived. The exact command and trigger are unresolved.
Top-level registration and signing complete, and no candidate exception is reported.
The absence of a candidate exception establishes no fix for the earlier lease problem.

One initial Wasm build fails because the new log event attempts to serialize `SigningRole`.
The event now uses the existing serializable `Participant` tag. This logging regression is fixed before deployment.
The focused review finds no material privacy or transaction defect. Production security qualification remains open.

## Facts and competing explanations

| Fact | Instrument | Checked scope |
| --- | --- | --- |
| Batched commitments reduce dependent exchanges | Native evaluator and transport accounting | 904 versus 113, with the same gate count |
| Prepared registration still misses five seconds | Client timer and canonical-result verification | Both candidate ceremonies |
| Candidate signing samples finish below five seconds | HTTP timer and independent signature verification | Six requests; twelve consumed pairs |
| Rejection counts differ | Correlated role traces and consumed material IDs | Nineteen control pairs versus twelve candidate pairs |
| Atomic burn and rollback preserve single use | Real-Worker faults and restart | All eight selected records |
| One later local signature exhausts its reservation | Correlated terminal outcome | Sixteen candidates, complete lifecycle remains failed |

| Explanation | Evidence | Status |
| --- | --- | --- |
| Fewer dependent exchanges improve the commitment schedule | Fixed gate count and lower exchange count | Supported for the mechanism |
| Batching eliminates commitment computation or traffic | Gate count is unchanged and traffic barely changes | Contradicted |
| Early commitments now meet both latency targets | Both prepared registrations exceed five seconds | Contradicted |
| Lower rejection counts explain part of the signing range | Candidate consumes fewer pairs | Uncontrolled contributor |
| A specific CPU, storage, or network cause explains remaining latency | Whole-invocation totals and elapsed marks cannot isolate it | Unresolved |
| Placement, tiering, cache state, or measurement load affect the comparison | Sequential deployments and overlapping local work do not control them | Remain possible |

## Selection and next work

Keep the current runtime. Remove the tested core, Worker, native-fixture, and fault-flag changes after preserving their exact patch.
The batching mechanism remains available as a replayable prototype.
Its early-commitment placement increases registration cost and establishes no useful complete first-use gain.
No alternate backend, rollout flag, or compatibility path remains active.

A future candidate should remove repeated work around the batched phase before selection.
The current prototype seals committed stock, then installation opens, reseals, and persists delivery ciphertext again.
Test sealing directly for the final participant storage binding, with the same exact-replay cache and admission barrier.
Measure the complete first-use path. Do not infer a five-second result from reduced exchange counts.
Private-check costs, cold/warm tails, sustained refill, multi-wallet memory, inactive leases, and release security review remain open.
Capture the rejected command tag and producer lease epoch under its public call identifier to isolate the lease failure.
Measure repeated registrations by module identity and sampling boundary to qualify reused-isolate memory.

The private cohort transcript, tagged stock lifecycle, and v3 stock sealing domain require coordinated regeneration before any future rollout.
Fresh test namespaces establish no compatibility with old preparations or mixed binaries.

## Reproduce and inspect

The [summary](../evidence/ml-dsa-65-batched-commitments-20261024.json) records fixed policy, verification, build hashes, and cleanup.
The [compressed archive](../evidence/ml-dsa-65-batched-commitments-20261024-data.json.gz) contains the exact patch, sanitized captures, native evidence, failed lifecycle, and scripts.
Extract `scripts["verify.py"]`, then run it against the archive with Python and an ML-DSA-capable Node runtime.
The tested Node runtime is v26.4.0.
Raw provider tails, credentials, role wrapping keys, and account identifiers are excluded.
Both arms reuse the same six approved Worker destinations and credential payloads. All six Workers are deleted after each arm.
Local work and compilation overlap parts of capture. Neither hosted placement nor cache state is randomized.
The bloat check keeps its inherited failure: 13,972 duplicated Rust lines against a 13,754 baseline.
The baseline remains unchanged. This bounded screen establishes no consistent five-second or sustained-capacity guarantee.
