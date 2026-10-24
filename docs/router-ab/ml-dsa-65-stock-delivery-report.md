# ML-DSA initial-stock delivery

Initial-stock delivery now needs four requests per participant, compared with eight in the control.
Each request installs up to two batches atomically.
The two candidate registrations take 4.432 and 4.186 seconds, including client verification.
These samples do not establish consistent five-second registration.
Signing still exceeds the target: a separate recovered-key signature takes 8.225 seconds and verifies successfully.

## Implementation

A signing batch contains two candidates. A paired delivery carries two batches, or four candidates.
Online signing still consumes two candidates at a time.
The preparation window remains two batches per participant.

The private command uses a typed one-batch or two-batch delivery.
Fixed-size arrays reject an oversized request during decoding.
A pair must contain consecutive ordinals and start at an even ordinal.
Every batch must match the live claim, wallet, key slot, epoch, schedule, expiry, and derived batch ID.
The receiver installs all batches in one transaction. An invalid second batch rolls back the first write.

The sender retains the exact persisted ciphertext for retries.
It sends both pending batches together, then commits their installed markers in one transaction after acknowledgement.
It drains both preparation futures before handling an ordinary error.
The existing registration mutex serializes retries. The claim deadline still bounds waiting, delivery, and completion.
A late remote success cannot complete an expired registration.

This change replaces the former private request shape. It adds no compatibility decoder.
The existing per-record installation primitive retains its replay and consumed-state checks.
Fresh hosted namespaces qualify this request shape. They do not qualify mixed-version deployment with registrations already in flight.

Wallet-seed recovery, standard FIPS seed/key export, and the cryptographic protocol remain unchanged.
Preparation stays on Workers and produces four candidates per preparation group.
Pool capacity remains thirty-two candidates per wallet. Admission requires sixteen ready candidates.
Cooldown remains sixty seconds, and service signing capacity remains one operation.
The bounded batch count does not prove unchanged peak memory. Combined JSON buffers can allocate differently.

## Cloudflare results

The control uses commit `c7b33392`. The candidate uses the same parent plus this delivery change.
Both arms use the same six approved Worker names, credential payloads, wallet fixture, native client, policy, and forwarding topology.
Each arm starts with fresh storage namespaces. Only the forwarding front is public.
Client timing includes response handling and verification. Public login, browser UI, and testnet submission are outside this screen.

| Arm | Ceremony | Prior preparation | Prepared registration | Initial signing result |
| --- | --- | ---: | ---: | --- |
| Control | Creation | 79.905 s | 4.748 s | Verified, 2.629 s, one pair |
| Control | Recovery | 59.693 s | 4.342 s | Verified, 1.288 s, one pair |
| Candidate | Creation | 80.509 s | 4.432 s | Verified, 2.774 s, two pairs |
| Candidate | Recovery | 53.409 s | 4.186 s | Wallet cooldown preserved |

All four ceremonies reproduce exactly the same canonical public key.
Exact replay returns the completed registration, and changed replay is rejected.
Each arm also checks the explicit empty-pool retry response.

Preparation includes generic key-generation material plus sixteen initial signing candidates.
These durations are not four-candidate refill timings or sustained throughput measurements.
The prepared registration figures require ready material.

The candidate's original `latencyTargetMet` remains false because recovery returns cooldown instead of a verified initial signature.
A separate request after cooldown verifies under the recovered key in **8.225 seconds**, using five pairs and ten candidates.
Its measured cooldown wait is zero because cooldown already elapsed before that request.
Its ready stock and cache state can differ from the initial-stock screen.
This supplemental result preserves the slow signing outcome and does not replace the original artifact.

Both arms are sequential. Placement, platform load, code caches, and rejection outcomes remain uncontrolled.
Two registrations per arm do not establish a causal latency gain, CPU savings, or production tail latency.
Retain the change for its deterministic request reduction and atomic delivery.

## Installation observations

Distinct pool-dispatch call IDs confirm eight control requests and four candidate requests per role, in both ceremonies.
The following measurements use Worker-clock stage marks:

| Arm | Ceremony | A stock interval | B stock interval | A full installation | B full installation |
| --- | --- | ---: | ---: | ---: | ---: |
| Control | Creation | 1111 ms | 1690 ms | 1214 ms | 2082 ms |
| Control | Recovery | 1009 ms | 1400 ms | 1079 ms | 1494 ms |
| Candidate | Creation | 1164 ms | 1252 ms | 1257 ms | 1860 ms |
| Candidate | Recovery | 1021 ms | 1233 ms | 1104 ms | 1296 ms |

B's stock intervals decrease in this screen. A's intervals increase slightly.
These are stage observations, not exact wall-time partitions.
B's control recovery stock interval exceeds its 1353 ms provider invocation wall time.
Worker clocks can include preceding CPU and scheduling. These marks cannot isolate storage latency or prove a percentage gain.

| Capture | Sanitized invocations | Reported truncation | Reported exceptions |
| --- | ---: | ---: | ---: |
| Control | 356 | 0 | 0 |
| Candidate | 416 | 0 | 0 |
| Separate recovery signature | 120 | 0 | 0 |

A false truncation flag does not prove complete capture of every event.
The earlier storage failures do not recur. Their underlying cause remains unresolved.
Independent review reproduced the request counts, public-key equality, and safety outcomes.

## Safety validation

The local real-Worker E2E campaign passes these behaviors:

- A three-batch request is rejected during decoding.
- An invalid second role rolls back the first batch. Inspection returns two missing records.
- A committed pair loses its reply, then exact retries succeed after restart and under concurrent requests.
- Both replayed batch ordinals retain their exact payload hash. Later batches install once.
- The preparation window never exceeds two batches.
- Completed claims reject installation retries.
- A stalled reply reaches the existing deadline after 30.004 seconds. Expired retries fail promptly.
- Releasing that successful reply later cannot complete the expired registration.
- Canonical creation and wallet-seed recovery pass, with a verified signature and the recovery cooldown preserved.

The first local fixture failed because it expected the parser substring `length 2`.
The receiver rejected the oversized request with the boundary error category `JSON is invalid`.
This failure is classified as `valid_test_needs_update`.
The fixture now requires that boundary category. Unexpected fetch errors still fail the test.
The original failed artifact, log, and fixture hash remain in the evidence archive.
Production behavior did not change for that fixture correction.

Host checking, all three Worker release builds, and formatting of the three changed Rust files pass.
The full crate formatting check reports pre-existing differences outside this change.
The required bloat check retains the inherited 13,972 versus 13,754 Rust duplication failure.
This change adds no Rust duplication over its parent. The baseline remains unchanged.

## Next implementation targets

1. Reduce repeated pair activation and checking costs while preserving private commitments and single-use rules.
2. Isolate first-use material loading and key-state construction with complete A/B captures.
3. Repeat registration and signing qualification across cold and reused execution, then measure sustained refill at the same capacity.

The supplemental signing request spends approximately 7.679 seconds inside Router execution for five pairs.
A's entry-to-material-loaded interval is approximately 962 ms, compared with 98 ms on B.
These intervals include permit checks and can include CPU, storage, peer waits, and scheduling. They identify targets without isolating a cause.
UI and GPU work remain deferred.

All six temporary Workers were deleted after each arm.
The [evidence summary](../evidence/ml-dsa-65-stock-delivery-20261024.json) links the sanitized archive, source patch, scripts, versions, and cleanup receipts.
