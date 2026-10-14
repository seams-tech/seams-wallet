# Public-decision ML-DSA key generation

Date: October 14, 2026. Branch: `ml-dsa`. Production integration remains paused.

## Final measured result

Prepared key generation reaches a 4.806-second median with read-ahead, while the strict five-second requirement remains unmet.
Five of eight measured requests finish below five seconds. Two normal requests and the genuine continuation exceed it.
The excluded warm-up also exceeds five seconds. Including warm-up, four of nine requests miss the deadline.

| Cases | Count | Median | Range | Misses |
| --- | ---: | ---: | ---: | ---: |
| All measured | 8 | 4.806 s | 4.012–6.609 s | 3 |
| Normal measured | 7 | 4.695 s | 4.012–5.468 s | 2 |
| Genuine continuation | 1 | 6.609 s | — | 1 |
| Excluded warm-up | 1 | 7.652 s | — | 1 |

The [final hosted artifact](../evidence/ml-dsa-65-public-keygen-prefetch-worker-hosted-20261014.json) records every case.
All nine match the canonical recovery keys, acknowledge table cleanup, and close with checked WebSocket code 1000.
Preparation/readiness takes 33.503 seconds at the median. This remains outside the online interval.
An empty or cold pool therefore has no five-second success claim.

## Protocol and privacy result

The scoped [privacy review](ml-dsa-65-public-keygen-review.md) passes under the accepted passive server-blind model.
An independent agent checked the combined view and the implementation's output boundaries.
The implementation opens sampler decisions and full `t`, then performs selection and Power2Round outside Yao.
Secret candidate values, `rho_prime`, `K`, the canonical seed, and signing disclosures retain their prior protection.
Wallet-seed derivation and the ordinary key encoding remain unchanged.

Sampling starts at 272 bytes. It recomputes the identical stream at 408 and 481 bytes only when necessary.
Each branch uses fresh independent masks and preparation. The 481-byte final cap remains in force.
Normal key generation evaluates 1,303,008 AND gates, including wallet-root derivation.
The former private-selection and private-rounding path evaluated 3,546,908 AND gates.

## Hosted streamed-read baseline

The reduced protocol still misses five seconds with sequential R2 reads.
Eight measured requests take 6.628–9.042 seconds, with a 7.820-second median.
All eight miss the target. The excluded warm-up takes 7.883 seconds.
The genuine continuation case takes 8.285 seconds and returns the expected canonical key.

| Resource | Normal path | One three-block continuation |
| --- | ---: | ---: |
| Online circuits, including wallet derivation | 13 | 14 |
| Online AND gates | 1,303,008 | 1,470,736 |
| R2 objects read online | 13 | 14 |
| Table bytes read online | 41,701,400 | 47,069,352 |
| Prepared R2 objects | 35 | 35 |
| Table bytes prepared and stored | 176,480,440 | 176,480,440 |

Every fallback is reserved before readiness, so this prototype increases preparation storage while reducing online work.
Unused reservations are discarded. This measures a live prepared session, not a durable production pool.
The client timer includes the start exchange, input delivery, table reads, evaluation, public rounding, and both completed roles.
Preparation and acknowledged cleanup remain separate.

The [complete hosted artifact](../evidence/ml-dsa-65-public-keygen-worker-hosted-repeat-20261014.json) retains nine cases and exact traffic checks.
Cases 1–5 repeat one wallet with fresh shares. Cases 6 and 7 change the wallet seed and wallet ID.
Case 8 uses a real wallet seed whose second polynomial requires the three-block branch.
All cases match their independent canonical references and acknowledge cleanup.
The [deployment record](../evidence/ml-dsa-65-public-keygen-worker-deployment-20261014.json) retains actual version IDs and local module hashes.
It does not include remote module readback or independent physical-placement proof.

An [initial partial campaign](../evidence/ml-dsa-65-public-keygen-worker-hosted-20261014.json) completed only its warm-up at 8.464 seconds.
A later connection closed, and the client failed to settle its message iterator. That process exited with code 13.
The client now treats WebSocket close as iterator completion and records incomplete sessions as failures.
A [diagnostic request](../evidence/ml-dsa-65-public-keygen-worker-diagnostic-20261014.json) then completed in 7.093 seconds.
The completed repeated campaign is the reported distribution. The interrupted campaign is retained separately.

## Correctness evidence

- The [native E2E](../evidence/ml-dsa-65-public-keygen-prepared-native-20261014.json) checks all three samplers through separate processes with genuine OT.
  It compares every candidate share and public bitmap against an independent SHAKE oracle, including final-prefix zero padding.
- The same E2E signs before authorized test reconstruction. OpenSSL and RustCrypto verify the threshold signature.
  The reconstructed seed, `K`, `s1`, `s2`, and `t0` match the ordinary 4,032-byte private encoding.
  Missing either role prevents a signature.
- The [local prepared Worker cases](../evidence/ml-dsa-65-public-keygen-worker-local-20261014.json) verify normal and genuine continuation paths in the same packaged bundles.
- The [complete local Worker signing test](../evidence/ml-dsa-65-public-keygen-threshold-worker-local-20261014.json) verifies the existing signer with the new material and public `t0`.
  Signing circuits and the signing protocol remain unchanged. No five-second signing result is established by this work.

The final 481-byte circuit executes in the component E2E. A natural 481-byte exhaustion is not observed.
Its terminal error and destruction path received source review. No artificial production override was added to force that event.
The new host branches depend on public acceptance bits, public roles, or values already present in that role's view.
This is a source-level timing assessment, not a new compiled side-channel certification.

## Deployment and measurements

The first deployment exceeded Cloudflare's 64 MiB uncompressed bundle limit.
Both adapters embedded the new schedules separately. Shared static schedules reduced the bundles from about 70.7 MB to 53.5 MB.
The [size-failure record](../evidence/ml-dsa-65-public-keygen-deployment-size-20261014.json) retains the rejected bundle identity.
The deployed bundles pass the size check and match the local Worker builds.

Worker `Date.now()` measurements still cannot partition storage wait from evaluation CPU.
The [sanitized runtime traces](../evidence/ml-dsa-65-public-keygen-worker-traces-20261014.json) add actual whole-invocation CPU and wall times.
They include preprocessing and cleanup. They must not be reported as online CPU cost.
Client elapsed time remains the deadline instrument.

## Read-ahead comparison

The sequential-read implementation is preserved in commit `95258a02`.
The new adapter requests one next normal-path table while the current circuit evaluates.
A public continuation decision retains that pending normal object and reads the selected fallback separately.
A phase check prohibits table reads before online admission. The final boundary rejects leftover data or unused pending reads.
The source bounds the adapter to one current table stream and one pending table stream.
This is a source invariant, not a measurement of runtime buffering or full isolate memory.

Each successful run starts twelve prefetched GETs and later consumes all twelve.
A consumed prefetch can still require waiting. The counter does not mean that every response was ready without delay.
Normal requests retain thirteen GETs, 41,701,400 table bytes, and 2,531,394 online protocol bytes in 42 logical messages.
These messages share one A/B WebSocket. They are not forty-two HTTP requests.
The continuation retains fourteen GETs and 47,069,352 table bytes.
All reads stay inside the client online interval. The circuit and private-output boundaries remain unchanged.

The median decreases from 7.820 to 4.806 seconds, an observed 38.54% reduction.
Every corresponding case is faster in this campaign.
Deployment time, physical placement, scheduling, and graceful client teardown also differ, so the comparison does not isolate a precise causal contribution.
The client now waits for normal closure after cleanup, outside online timing, instead of terminating the socket immediately.

The [local read-ahead cases](../evidence/ml-dsa-65-public-keygen-prefetch-worker-local-20261014.json) match the hosted source, fixture, and module hashes.
The [deployment record](../evidence/ml-dsa-65-public-keygen-prefetch-worker-deployment-20261014.json) retains the actual Cloudflare versions.
An independent agent reproduced the timing distribution, deadline misses, unchanged protocol counts, and normal close codes.

The [read-ahead runtime traces](../evidence/ml-dsa-65-public-keygen-prefetch-worker-traces-20261014.json) contain whole-invocation CPU and wall times.
B's nine invocations report successful outcomes. A reports eight successful benchmark outcomes and one cancellation, despite all normal client close codes.
These runtime outcomes remain distinct from client correctness and latency checks.
The overlapping GET timing observations cannot be added to stream waits to estimate online CPU or storage cost.
These small sequential campaigns establish no production percentile or reliable five-second deadline.

## Remaining performance work

- Identify the warm-up overhead with an independent evaluator warm-up experiment. Never evaluate a reserved garbling twice with different inputs.
- Reduce the remaining per-candidate share-conversion cost, while preserving the reviewed disclosure boundary and canonical recovery.
- Investigate the continuation delay and require margin below five seconds before production qualification.
- Design durable pool admission, independent role storage, restart handling, and exhaustion behavior before integrating production Wallet flows.

The requested privacy reductions and adaptive SHAKE are implemented and tested.
The strict latency target remains open. Production integration remains paused.

## Reproduction and cleanup

Use the commands in [the hosted preprocessing report](ml-dsa-65-prepared-hosted-report.md#reproduce-the-worker-campaign) with the current configurations.
Regenerate both Worker fixture books and prepared fixture books before building.
The current client defaults to nine cases, including the real continuation fixture. Local smoke coverage uses `--indices 0,8`.
The current configurations name `ml-dsa-public-20261014-a`, `ml-dsa-public-20261014-b`, and `ml-dsa-public-20261014-tables`.
Use fresh temporary resource names for a new campaign and retain its deployment record.

The [cleanup artifact](../evidence/ml-dsa-65-public-keygen-worker-cleanup-20261014.json) verifies deletion of both Workers and the bucket.
The benchmark token and temporary raw log files were removed. Log capture processes were stopped.
Only this experiment's resources were removed.
