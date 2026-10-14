# Resident key generation and prepared GMW signing

Date: October 14, 2026. Branch: `ml-dsa`. Production integration remains paused.

## Current result

Resident prepared key generation meets the five-second target in all nine hosted requests.
The eight measured requests have a 1.308-second median and a 1.129–2.003-second range.
The warm-up takes 1.069 seconds. The genuine SHAKE continuation takes 1.613 seconds.
All requests reproduce their canonical wallet-seed recovery keys and close normally after acknowledged cleanup.
The [hosted artifact](../evidence/ml-dsa-65-resident-keygen-worker-hosted-20261014.json) retains every request.

Prepared GMW signing now produces ordinary signatures in native, local Worker, and hosted four-candidate experiments.
The complete 32-candidate implementation passes native and local Worker checks.
The first hosted 32-candidate setup failed before readiness. A controlled allocation follow-up is in progress.
A four-candidate pool cannot establish consistent successful signing because it can exhaust.

## Key-generation storage changes

The cryptographic key-generation flow retains the reviewed public sampler decisions, adaptive SHAKE, and public Power2Round.
Normal online work remains 1,303,008 AND gates. Wallet-seed derivation and canonical key identity remain unchanged.

Consecutive normal-path tables now share one R2 object.
The writer uses multipart uploads with a five-MiB Rust buffer.
Each fallback has its own object, so the normal stream can pause across a real continuation.
Frame ordering, reserved ranges, exact lengths, and final EOF remain checked.

| Hosted key-generation profile         | Measured median | Maximum | Measured misses |
| ------------------------------------- | --------------: | ------: | --------------: |
| Prior read-ahead                      |         4.806 s | 6.609 s |             3/8 |
| Grouped streamed reads                |         3.460 s | 5.359 s |             1/8 |
| First group resident before readiness |         1.308 s | 2.003 s |             0/8 |

The [grouped-stream campaign](../evidence/ml-dsa-65-grouped-keygen-worker-hosted-20261014.json) keeps all reads online.
It reduces normal-path GETs from thirteen to one without changing table bytes or protocol outputs.
A real continuation needs a second GET.

The resident profile loads the first 41,701,400-byte group before it declares readiness.
Its JavaScript buffer avoids copying the complete group into Wasm memory.
Online execution copies bounded frames from that buffer. Fallback groups still stream from R2 online.
Readiness takes 37.015–51.875 seconds in this campaign and includes the first-group load.
This timing change is explicit. It is not a cold-pool result.
The [local normal and continuation cases](../evidence/ml-dsa-65-resident-keygen-worker-local-20261014.json) also pass.

## Signing changes and disclosure boundary

The [prepared-signing review](ml-dsa-65-prepared-signing-review.md) records the accepted passive composition.
Both roles prepare fresh joint mask shares and privately decompose the shared commitment before the message arrives.
Secret response bounds remain private. The protocol opens only their combined decision for each candidate.
After both bounds pass, response reconstruction, correction checks, hints, and encoding run outside secure computation.

Commitments remain private when either secret bound fails.
The implementation does not adopt the additional LWR assumption needed to expose those commitments.
Canonical `s1` and `s2` shares must come from the standard key generator.
A parser that checks residue ranges alone does not establish canonical provenance for arbitrary imported material.

Direct random mask sampling replaces FIPS 204's prescribed message-bound hedged nonce derivation.
The signatures retain the ordinary ML-DSA-65 encoding and verify with standard implementations.
Wallet-seed recovery, the canonical FIPS seed, and ordinary key identity remain unchanged.

### Prepared Yao comparison

One reduced online candidate uses 580,159 AND gates and 18,567,376 framed table bytes.
The hosted comparison uses twelve fresh candidates and keeps the first candidate's tables resident before readiness.
Later candidates require one R2 read each.

The [hosted campaign](../evidence/ml-dsa-65-prepared-yao-signing-worker-hosted-20261014.json) records four valid signatures, one exhaustion, and one preparation failure.
Successful signature times range from 3.329 to 13.821 seconds. Only one successful request finishes below five seconds.
The exhausted request takes 17.447 seconds and produces no signature.
Cloudflare reports `loadShed` for A during the final preparation; B reports cancellation.
That infrastructure failure remains distinct from an online deadline miss.
The campaign stops there and does not complete all nine requested cases.

These results reject prepared Yao as the selected online signing design.
Candidate count alone does not explain every slow request: a two-candidate signature takes 13.821 seconds.
The available whole-invocation traces do not isolate the cause of that outlier.

### Packed GMW comparison

GMW uses XOR shares and fresh private correlations for Boolean AND operations.
The implementation packs independent instances into integer bit lanes and shares their immutable public circuit topology.
All challenges run together, followed by all private checks and then the combined decisions.
The three stages require 227 dependent AND-layer exchanges, plus binding and output exchanges.
Every evaluated candidate is consumed, including candidates unused after an earlier success.

The [hosted four-candidate campaign](../evidence/ml-dsa-65-gmw4-signing-worker-hosted-20261014.json) completes three requests.
Two produce verified signatures at 0.297 and 0.288 seconds.
One exhausts its pool at 0.240 seconds and produces no signature.
The [local four-candidate campaign](../evidence/ml-dsa-65-gmw4-signing-worker-local-20261014.json) also contains one exhaustion and one verified signature.
Its failed warm-up must not be counted as a successful signature.

The [local 32-candidate Worker](../evidence/ml-dsa-65-gmw32-signing-worker-local-20261014.json) produces a verified signature in 0.137 seconds.
Its readiness takes 143.463 seconds. The [native complete signer](../evidence/ml-dsa-65-prepared-signing-engines-native-20261014.json) also verifies before authorized canonical recovery.
That native run evaluates all 32 candidates, accepts candidate nine, and takes 47.3 milliseconds online.
Its 91.055-second preparation is a single-run observation, with no throughput claim.
These local results do not establish hosted latency or a production percentile.

## Preparation cost and resource bounds

The Boolean extension batch grows from 4,096 to 16,384 choices, using a new family code.
Every batch still generates fresh base OTs. No reusable base-OT state was added.
A further reviewed encoding transfers one-byte Boolean messages while preserving all sixteen-byte Yao labels.
Its family code is distinct. The full SHA-256 KDF, 128-bit columns, and base-OT security parameters remain unchanged.
Setup batches per candidate fall from 144 to 40, while padding and transfer grow.
The optimized implementation also transposes eight columns together, reuses a public SHA-256 prefix, and batches AES counter blocks.
Independent review confirms byte equivalence for these runtime changes.

The initial optimized control uses a 524,336-byte masked OT frame.
The subsequent byte-message encoding reduces that frame to 32,816 bytes; its extension matrix remains 262,192 bytes.
The largest 32-candidate norm opening is 495,616 bytes.
The [byte-message native E2E](../evidence/ml-dsa-65-byte-ot-complete-native-20261014.json) verifies a complete 32-candidate signature before canonical recovery.
Total native preparation traffic falls from 2,622,013,570 to 1,363,722,370 bytes in the paired artifacts.
Boolean OT alone falls from 2,034,728,960 to 776,437,760 bytes across 1,280 bidirectional batches.
The remaining preparation includes fresh-mask conversion, private commitment decomposition, and protocol binding.
Native online signing takes 42.1 milliseconds in that run. This is one sample, with no percentile claim.
The local byte-message Worker passes at 123.3 milliseconds online and 144.759 seconds readiness.
Its measured Wasm highwater is 97,714,176 bytes at A and 97,779,712 bytes at B.
Hosted byte-message performance remains unmeasured at this checkpoint.
The control-message limit is one MiB. Garbled table frames retain their separate 65,544-byte bound.
The mixed native E2E crosses 32-bit lane boundaries and checks SHAKE, strict bounds, output ownership, and all role traffic.
A mismatched ordered layout is rejected after a 32-byte exchange per role, before private preprocessing.

An initial Worker signing build exceeded the one-MiB Wasm stack through an oversized async constructor.
The [compiled record](../evidence/ml-dsa-65-worker-stack-before-20261014.txt) identifies a 1,080,224-byte frame.
Boxing the signing futures removes that frame. The [controlled follow-up](../evidence/ml-dsa-65-prepared-signing-stack-fixed-20261014.json) completes the same request through pool exhaustion.
Duplicate embedded schedules were also removed before deployment, bringing the bundles below the upload limit.

## Hosted setup failure and allocation control

The [first hosted GMW32 campaign](../evidence/ml-dsa-65-gmw32-signing-worker-hosted-failure-20261014.json) produces no signature.
A reports `loadShed` at 231.243 seconds CPU and 472.244 seconds wall time. B reports cancellation at 234.935 seconds CPU.
The client later reaches its 900-second timeout. This is a setup failure, not a measured online signing interval.
All five A exceptions contain generic internal errors.

| Fact                                                          | Instrument                                         | Scope and check                                     |
| ------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| Both CPU totals are below 300 seconds                         | Sanitized Worker traces and deployed configuration | Whole invocation; not online CPU                    |
| A reports load shedding; B reports cancellation               | Version-pinned traces                              | No explicit memory-limit error                      |
| Local GMW32 completes at about 105 MB linear memory           | Same protocol in local workerd                     | JavaScript and runtime allocations excluded         |
| The client timeout occurs after platform termination          | Client artifact and trace timestamps               | Client timeout cannot explain earlier termination   |
| Exact allocation reduces local linear memory to about 99.5 MB | Rebuilt local control                              | Same circuits, gates, ordering, and candidate count |

| Candidate cause                                        | Evidence                                              | Status                                              |
| ------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| Public topology allocation and runtime memory pressure | Large measured footprint; spare layout capacity found | Plausible; total hosted peak memory remains unknown |
| Normal configured CPU-limit termination                | CPU below limit; outcome is not `exceededCpu`         | Not supported by these traces                       |
| Platform overload or internal failure                  | Generic internal errors and `loadShed`                | Remains possible                                    |
| Client timeout                                         | Occurs after platform failure                         | Excluded as the initial cause                       |
| Protocol correctness defect                            | Native and local complete signatures pass             | Weakened; hosted-only defects are not ruled out     |

The public topology compiler now counts each layer before allocating its vectors.
The second pass preserves the original gate traversal, wire identifiers, depth recurrence, and output mapping.
Independent review passes this control. Native and local Worker E2Es still pass.
Fewer allocations can also change scheduling and CPU work, so a successful follow-up alone would not prove memory pressure.
Cloudflare documents separate `exceededMemory` and `exceededCpu` outcomes in its [limits reference](https://developers.cloudflare.com/workers/platform/limits/).

The benchmark is not the production Router path. Production parity remains unestablished.
Phase-level hosted memory observations and repeated complete runs would narrow the remaining causes.
An earlier proposed removal of old benchmark routes was rejected by automatic approval review because it could disturb active work.
Those routes and files remain intact. The bounded allocation control replaces that proposed cleanup.

## Measurement limits and deployment work

The client timer measures input delivery, online exchanges, later table reads, both Worker verifiers, and completion delivery.
Preparation/readiness and acknowledged cleanup have separate intervals.
Worker `Date.now()` remains unsuitable for splitting CPU from storage wait.
Runtime traces report whole-invocation CPU and wall time, including preparation and cleanup.

The Workers communicate through a Service Binding. Cloudflare documents same-thread, same-server execution by default.
These runs provide no separate physical-placement attestation or cross-account latency claim.
See [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

The prototype retains a live, consuming reservation in memory. It does not implement a durable production pool.
A cold or empty pool has no five-second successful-signing claim.
Current signing preparation starts after the fixture key exists. These runs do not measure a new key followed immediately by its first signature.
Generic correlations can be prepared before key creation; key-specific commitment preparation still needs a separate activation measurement.
A consumed or uncertain reservation must be burned; it must never return to the pool.
Durable admission, restart handling, epoch changes, cancellation, replay protection, and concurrency qualification remain required.
The current sequential campaigns establish observed performance, not a production p99 or a universal deadline guarantee.
A finite candidate pool can still exhaust. Using independent attempts and mean 5.14 as a model gives roughly 0.1% exhaustion at 32 candidates.
That is a model, not a measured failure rate or worst-case security bound.
Consistent service needs additional fresh reservations, reliable replenishment, and explicit admission behavior when capacity is unavailable.

## Reproduce

Build the investigation tool and regenerate disposable fixtures before building both Worker roles.
Use the pinned Wasm helper described in the [earlier hosted report](ml-dsa-65-prepared-hosted-report.md#reproduce-the-worker-campaign).
The current runner supports these operations:

```sh
node crates/ed25519-yao-cloudflare-bench/scripts/run_prepared_keygen.mjs \
  --operation keygen --local --indices 0,8 --output /private/tmp/keygen.json
node crates/ed25519-yao-cloudflare-bench/scripts/run_prepared_keygen.mjs \
  --operation gmw-signing --local --indices 0 --output /private/tmp/signing.json
```

For hosted measurements, replace `--local` with the temporary endpoint and benchmark secrets-file arguments.
Keep fixture books, source hashes, binary hashes, deployment versions, failures, and cleanup results.
The keygen fixture book includes repeated recovery identities, changed wallet inputs, and a real SHAKE continuation.
The signing runner changes the public message while retaining a canonical wallet-derived fixture key.
