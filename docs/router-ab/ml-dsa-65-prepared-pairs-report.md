# ML-DSA-65: prepare four candidates, consume pairs

Date: 2026-10-18. Experimental private Router A/B routes.

The pair mechanism works, but this screen does not justify changing the default.
Median successful HTTP latency increases from 2.20 to 3.86 seconds.
Captured preparation work per verified signature is similar, at 24.07 and 23.36 seconds.
The prototype remains available through deployment policy. Four-at-once remains the default.
Neither profile meets the five-second target consistently.

## Hosted comparison

Each profile signs for two wallets during a ten-minute saturation run.
The measurement cooldown is one second. The product default remains sixty seconds.
Both profiles start and finish with thirty-two candidates per wallet.
The two profiles use identical frozen Worker binaries and separate temporary deployments.

| Measurement | Four-at-once | Prepare four, consume pairs |
| --- | ---: | ---: |
| Verified signatures during load | 26 | 26 |
| Successful HTTP minimum / median / maximum | 1.093 / 2.198 / 7.039 s | 1.175 / 3.863 / 7.087 s |
| Successful HTTP requests under five seconds | 24/26 | 18/26 |
| Failed admitted operations during load | 0 | 0 |
| Complete demand median / mean | 37.918 / 41.072 s | 21.143 / 42.825 s |
| Complete demand maximum | 113.864 s | 115.382 s |
| Incomplete demands at cutoff | 2 | 2 |
| Directly identified evaluated candidates | 172 | 178 |
| Additional candidates reconstructed from participant traces | 8 | 0 |
| Matched four-candidate job median / mean | 11.964 / 13.819 s | 10.925 / 13.634 s |
| Captured producer-A alarm time per verified signature | 24.066 s | 23.359 s |
| Observed post-starting-stock signatures per minute | 1.877 | 1.693 |
| Peak observed candidates per participant and wallet | 32 | 32 |

Successful HTTP latency includes the admitted request and durable settlement.
Complete demand latency also includes admission retries and pool waits.
Login, SDK prompts, NEAR submission, and finality are outside these timings.
Both incomplete demands remain censored rather than being counted as completed signatures.

Eleven four-candidate preparation jobs supply pairs consumed in distinct successful operations with different messages.
These jobs cover eighteen distinct verified operations.
Five jobs have both pairs as the final consumed group of their respective operations.
The other six include a pair consumed before later groups complete the operation.
This demonstrates preservation and later consumption of untouched pairs. It does not mean each of the eleven jobs produces two signatures.

The pair material ledger balances:

```text
32 initial pairs + 89 fresh pairs = 89 consumed pairs + 32 final pairs
```

All eighty-nine consumed pair IDs are distinct. All twenty-six verified operations have Router consumption records.
No fresh pair lacks its publication completion in the retained observations.
The pair profile has forty-four completed four-candidate jobs and one two-candidate capacity top-up during load and restoration.
Those jobs account for 605.912 seconds of producer invocation wall time.
Forty-five canceled alarms add 1.421 seconds, for 607.333 captured seconds in total.
The canceled alarms have zero captured CPU but no job identity. Their attribution remains unknown.

The baseline has one missing Router outcome and one missing normal producer completion.
Router records identify 172 evaluated candidates.
Both completed participant traces for the missing operation show two evaluated groups, reconstructing eight more candidates.
The resulting total is 180 candidates. Assigning the two unmatched material IDs to that operation remains an inference.
The baseline material ledger therefore remains explicitly incomplete.

The baseline captures 625.705 seconds of producer-A alarm time.
This includes a 16.174-second invocation with a runtime code-update-reset category and a 0.126-second recovery invocation.
Recovery confirms paired publication of the missing producer's material.
The reset invocation lacks a job ID, so its assignment to that job remains inferred.
It occurs during load with the expected version, well before cleanup. Its category does not prove an operator redeploy.

The captured 2.94% difference in alarm time per signature is not an established cost improvement.
The matched four-candidate job means differ by only 1.34%.
Both profiles retain incomplete invocation-attribution flags.
Equal division of a shared job produces a 5.505-second median allocated pair cost. That is an accounting estimate, not measured preparation latency.
Rejection varies between runs. Twenty-six signatures per profile do not validate the expected long-run material saving.
CPU variation and placement remain uncontrolled.
The lower pair demand median accompanies a higher mean, so the experiment does not establish a general demand-latency improvement.

Full reserves are observed 182.151 seconds after baseline load and 173.308 seconds after pair load.
These values include observation delay. They are not exact restoration durations.
Observed capacity remains unchanged; snapshots do not prove the absence of every transient excess.

## Registration and recovery

All eight creation/recovery ceremonies reproduce their canonical keys.
Each wallet has the same public key in both profiles.
The independent replay verifies all fifty-two retained load signatures through Node/OpenSSL.
It also rejects modified messages and signatures.

| Online ceremony, including client verification | Four-at-once | Consume pairs |
| --- | --- | --- |
| Creation, two wallets | 4.212 / 4.913 s | 4.888 / 5.842 s |
| Recovery, two wallets | 3.737 / 5.591 s | 5.428 / 4.240 s |
| Generic preparation, including sixteen initial candidates | 54.916–77.974 s | 51.872–86.940 s |

Preparation is outside the online ceremony interval.
Registration also misses five seconds in some samples.
The baseline's initial signing checks contain three verified signatures at 2.394–2.963 seconds and one exhausted operation at 6.355 seconds.
That failed operation consumes sixteen candidates after recovery. It is separate from the load window and remains in the evidence.
All four initial pair-profile signatures verify at 2.629–4.251 seconds.

## Decision

Keep four-at-once as the default for now.
Preserve this prototype for preparation-efficiency work, with the same recovery and single-use rules.
A useful next experiment is to retain four-candidate nonce-conversion batching while producing separately owned pairs.
That requires a careful split of private state and honest accounting of shared work.
This prototype already shares correlation generation, but evaluates nonce conversion separately for each pair.
A longer comparison is needed to distinguish the expected rejection-related material saving from sampling variation.
Future measurements should log explicit operation-to-material IDs and producer-invocation-to-job IDs.
GPU work remains deferred.

## Construction

One preparation session creates two independently bound two-candidate reservations.
The session uses one fresh silent-OT correlation stream.
The ordered reservation IDs, candidate width, and circuit digests bind that stream.
Each reservation consumes a distinct segment of the stream and receives fresh nonce shares.
Unused final correlations are erased when the complete preparation session ends.

The prototype shares correlation generation across pairs. It evaluates each pair's preparation circuits in sequence.
It does not split or reuse a previously evaluated four-candidate signing batch.
Each pair has separate encrypted storage, identity, admission, and consumption records.
Online signing evaluates one pair and consumes both candidates in that pair.
An untouched second pair can survive settlement and serve a later message.
The existing executor burns each selected pair before opening its private material.

The preparation policy is separate from the online consumption width.
The baseline prepares and consumes four candidates together.
The prototype prepares four and consumes two at a time.
With only one pair of free capacity, refill prepares two candidates to avoid excess stock or forced disposal.
Registration prepares its initial stock through the same grouped API.
The default policy remains four-at-once pending the comparison.

## Preserved boundaries

- Wallet custody seed derivation and canonical FIPS seed/key export are unchanged.
- The cryptographic circuits, nonce distribution, rejection checks, and disclosure rules are unchanged.
- Each participant retains only its own private material.
- Each correlation and evaluated candidate remains single-use.
- Duplicate publication, request replay, key epoch checks, and durable consumption remain enforced.
- Both benchmark profiles retain thirty-two candidates per wallet and sixteen candidates for admission.
- The pair profile has sixteen pool records. The baseline has eight records.
- Each profile has one active signer and one preparation producer.
- GPU work remains deferred.

## Security review scope

The new loop dimensions, ID comparisons, hashing inputs, and publication indexes are public.
No new branch or memory address depends on nonce shares or correlation values.
CorrelationStream::take moves each triple out of its current chunk before advancing.
The grouped preparation API transfers each returned reservation into its own consuming persistence boundary.
The stream itself is never persisted or restored.
A restart cannot resume preparation under an already claimed job ID.
This source review addresses the existing passive model. It does not certify generated machine code or establish malicious-party security.

## Measurement method

Use the same frozen Worker binaries for both profiles, with fresh temporary deployments.
Run real registration and recovery for two wallets in each profile.
Verify canonical keys and standard signatures independently.
Start with a full thirty-two-candidate reserve per wallet.
Run ten minutes of two-wallet saturation, then restore the original reserve.
Retain exhausted operations, unsuccessful requests, incomplete demands, and refill recovery work.

Report complete successful HTTP latency separately from demand latency, which includes pool waits.
Count candidate consumption across successful and failed operations.
Charge each preparation invocation once, even when it publishes two pairs.
Any per-pair allocation of a shared invocation divides its time equally and is an accounting estimate.
Use hosted invocation wall time for preparation. Worker clock deltas can omit CPU execution.
Drain trace delivery after stock restoration to retain the final preparation completion.

## Validation and results

The native cryptographic campaign passes. It verifies three standard signatures and consumes twenty distinct pairs.
Two four-candidate preparation groups supply pairs to different messages across durable store reopenings.
The native checks reject replay and verify canonical wallet-derived keys against ordinary ML-DSA implementations.

The transactional pool E2E passes with two records under one producer lease and duplicate-publication rejection.
The local Worker registration E2E passes creation, recovery, authenticated holder results, key manifests, restart, and replay checks.
The first native campaign used a stale outer verifier after the scenario began signing distinct messages.
Classification: valid_test_needs_update. Updating that verifier to the exact per-operation message resolves the failure.

The bloat gate still fails at the inherited duplication counts: Rust 13,984 versus 13,754 and TypeScript 10,238 versus 10,216.
This change does not increase those counts or change the baseline.

The existing local Worker fault campaign also passes automatic refill, restart, duplicate requests, changed-layout rejection, and stalled-operation handling.
An independent reviewer reproduces both comparison summaries and the pair identity ledger.
The review leads to fixes for prestarted jobs with two outputs, malformed publication metadata, and observations containing only a second pair.
Historical baseline replay preserves its prior candidate counts and captured cost.
No production qualification is claimed.

## Evidence and reproduction

- [Comparison and baseline count reconstruction](../evidence/ml-dsa-65-prepared-pairs-comparison-20261018.json)
- [Hosted clients, sanitized traces, registrations, and stock observations](../evidence/ml-dsa-65-prepared-pairs-hosted-20261018.json.gz)
- [Native cryptographic and local Worker checks](../evidence/ml-dsa-65-prepared-pairs-local-20261018.json.gz)
- [Frozen build hashes, campaign scripts, source snapshots, and review](../evidence/ml-dsa-65-prepared-pairs-provenance-20261018.json.gz)
- [Validation, credential scan, and cleanup receipt](../evidence/ml-dsa-65-prepared-pairs-validation-20261018.json)

The provenance bundle retains the deployment and campaign scripts.
The hosted bundle retains both policies: consume four with eight groups, or consume two with sixteen groups.
Both policies prepare four candidates per full job and require sixteen candidates for admission.
The new `preparation_group_size` policy field is required when an explicit policy is supplied.
These experiments use fresh durable namespaces. Existing job records require a persistence-boundary migration before any production adoption.

Build the Router and both derivers with the existing release scripts.
The native `prepared-keygen` campaign includes the durable pair scenario and emits its public verification receipt.
The existing registration E2E selects the pair profile with `ML_DSA_TEST_CANDIDATE_GROUP_SIZE=2` and `ML_DSA_TEST_PREPARATION_GROUP_SIZE=4`.
The multi-wallet E2E uses the registration artifacts and a 600000-millisecond load window.
Restore both reserves, drain traces, then run the existing collectors and the saved comparison script.
All ten temporary Workers were deleted after collection. Local test credentials and raw traces are removed after packaging.
