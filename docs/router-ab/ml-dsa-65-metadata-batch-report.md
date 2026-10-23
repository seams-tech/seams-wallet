# ML-DSA registration metadata batching screen

The metadata-batching prototype remains unselected. Local correctness passed, but the hosted run showed no demonstrated latency gain.
The selected production source is restored. Its rebuilt evaluator exactly matches the previous selected Wasm hash.
The candidate patch and all evidence remain in the archive. All six temporary Workers were deleted.

## Rebase and experiment

The `ml-dsa` branch was rebased onto `dev` at `4c13b3f3`.
The only merge conflict was the generated server artifact manifest. The canonical package script regenerated it.
The experiment started from the rebased head `f6003ac2`.

The prototype reads each bounded batch's metadata through one Worker `get_multiple` call.
It also starts consume-marker writes together and drains every write before returning an error.
Authentication still completes before mutation. Frames still leave the adapter only after transaction commit.
The cache remains limited to thirty-two frames. The stored format, authentication domains, and circuit protocol are unchanged.
The serializer dependency already existed transitively at the same pinned version.

The observed read path loads 643 frames in twenty-four batches.
This reduces metadata API calls from 643 to twenty-four. It does not reduce the number of authenticated frames or prove lower elapsed time.
The evaluator binary grows by 7,585 bytes during the experiment.

All six temporary Workers were recreated with the previously approved destinations and credential payloads.
Only B and preparer B used a changed binary. A, preparer A, the ML-DSA Router, and the ordinary forwarding Router retained their binary hashes.
Every deployment version ID changed. This was not an in-place two-Worker control experiment.

Wallet-seed recovery, canonical FIPS export semantics, four-candidate preparation, two-at-once consumption, and thirty-two-candidate capacity remain unchanged.
The sixty-second wallet cooldown and one-operation service limit remain unchanged.

## Validation

All six native key-generation cases reproduce the canonical key.
The existing SQLite lifecycle scenarios check corruption, replay, retirement, and transaction rollback.
The fault scenario now proves that multiple consume markers were written before rollback, including writes after the injected failure.
It also rejects a missing metadata record between present frames.

The original assertion required exactly one completed marker write. That assertion described the previous sequential implementation.
It was classified as a valid test needing an update. The replacement retains rollback checks and strengthens coverage for drained writes.
The test change belongs to the archived prototype and is also restored with the selected source.

The real workerd adapter passes the existing Worker/Gateway registration, recovery, publication, signing, restart, and lost-material restoration checks.
These checks exercise JavaScript Map decoding. The native backend alone does not exercise that adapter.
Recovered and linked authorities enter those local fixtures at trusted activation boundaries.
This screen does not repeat complete browser recovery-code or QR ceremonies.
Server and intended-lifecycle TypeScript checks pass after the rebase.

Native validation and the local Worker run overlapped other validation work. Their timings are not comparative performance evidence.
Build and native validation work completed before the hosted measurement began.

## Hosted result

| Observation | Result |
| --- | ---: |
| Initial registration preparation | 107.610 s |
| Prepared creation, including client verification | 15.418 s |
| Initial signing operation | Exhausted sixteen candidates after 19.937 s |
| Recovery preparation | HTTP 500 after 129.104 s |
| A registration execution | 337 ms provider CPU / 13,312 ms provider wall |
| B registration execution | 2,931 ms provider CPU / 13,230 ms provider wall |

Creation returns the canonical public key. The signature does not succeed.
The Router records eight consumed pairs and sixteen evaluated candidates for that signing operation.
Recovery preparation fails before a recovered key is produced.
The run therefore fails functional qualification and cannot establish recovery performance or consistent five-second latency.

The preceding separated-Worker screen measured four prepared operations at 5.545–8.372 seconds.
Those were different requests in an earlier window. They are historical context, not a controlled speedup or regression ratio.
Registration table-read timers again report zero elapsed time. They cannot isolate storage cost from the visible phase delay.

## Diagnostic record

| Fact | Instrument | Qualification |
| --- | --- | --- |
| One canonical creation took 15.418 seconds. | Client monotonic timer and ordinary-key verification. | One synthetic wallet. Browser login and chain submission excluded. |
| The signature exhausted sixteen candidates. | Router signing outcome matched to the client operation. | Bounded rejection exhaustion, not an invalid returned signature. |
| Recovery preparation returned HTTP 500. | Client request and matching Router request ID. | Exact client/Router association. |
| B reports storage internal-reset and timeout-reset categories. | Sanitized provider events at the recorded version. | Repeated categories within an invocation are not separate incidents. |
| A/B creation execution has explicit operation IDs. | Completed execution traces. | Their creation-stage timings are attributable to that operation. |
| Participant failure records lack request/operation IDs. | Sanitized failure traces. | Association with the failed recovery request remains a timing/path inference. |
| Local correctness and native fault checks pass. | Repeatable native and workerd artifacts. | They do not establish hosted latency or reliability. |

| Possible explanation | Evidence | Status |
| --- | --- | --- |
| Metadata batching worsened hosted behavior. | The candidate is slower than historical samples. No same-window control exists. | Open; no causal regression claim. |
| Storage or platform behavior dominates the run. | Storage resets recur and provider wall time exceeds CPU time. | Open; not proof of a platform-only cause. |
| Protocol-peer or scheduling waits contribute. | Both participants spend much longer in the execution phase than their reported CPU work. | Open; precise attribution is missing. |
| Observer overhead contributes. | Trace capture was enabled. | Open. |
| The client invented the HTTP failure. | The Router independently records the same request and upstream failure. | Contradicted. |
| Pool expansion produced the apparent result. | The policy and thirty-two-candidate cap were unchanged. | Contradicted. |

An independent reviewer verified the measurements, safety boundaries, and evidence limits.
The review supported conservative non-selection. It did not attribute the storage failures to this change.
Storage resets also occurred before this prototype. The change does not qualify as a fix for them.

## Next implementation priorities

1. Add reliable operation/phase correlation at storage and participant boundaries, including failed requests whose final trace is lost.
2. Separate storage waits from protocol-peer waits with calibrated measurements before choosing another I/O optimization.
3. Apply the measured change, then repeat creation, first-use signing, and a longer refill run that exhausts starting stock and balances its ledger.

Keep recovery, standard export, two-at-once consumption, and capacity unchanged. GPU and UI work remain deferred.

## Evidence

The [summary](../evidence/ml-dsa-65-metadata-batch-20261023.json) links the compressed archive.
The archive contains the candidate patch, native and local artifacts, sanitized hosted traces, exact asset hashes, and cleanup receipts.
It contains no benchmark credential values. The prototype can be reproduced by applying the patch to `f6003ac2` in a separate checkout.
Run the existing `prepared-keygen` native harness and `ml-dsa-registration-worker.e2e.mjs` against freshly built candidate Workers.
Generate fresh single-use preparation material for every run.

The selected evaluator was rebuilt after restoration and matches SHA-256 `ea854b2156fbe61edd0d7a4a6fe92d608945720795fc5677c1c4a5f34e941b26`.
The native investigation executable was also rebuilt from selected source.
The inherited bloat-check excess remains 13,972 duplicated Rust lines against a 13,754-line baseline.
