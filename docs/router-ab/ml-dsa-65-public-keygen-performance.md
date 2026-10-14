# Public-decision ML-DSA key generation

Date: October 14, 2026. Branch: `ml-dsa`. Production integration remains paused.

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
  Signing performance is unchanged by this key-generation work and remains outside the five-second goal.

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

## Next controlled measurement

Test bounded read-ahead of the next normal-path table while the current circuit evaluates.
Keep all R2 reads inside the online interval. Keep circuit bytes, messages, masks, and public disclosures unchanged.
Measure normal and continuation paths again. Do not infer a five-second result from native timing or gate reduction alone.
