# ML-DSA quiet producer controls on Cloudflare

The producer CPU gap persists with equal work, quiet execution, reversed order, and an ordinary return build.
Fixed public workloads also show different active processing costs on the matched instances.
These tests establish no new speedup or sustained-throughput result.
No production cryptographic source or warmup change is retained.

The next useful optimization target is the actual conversion path and encoder inside a real four-candidate job.
Production conversion uses repeated sixteen-block A batches and eight-block B batches, with copying, bit extraction, and erasure.
The bulk AES probe does not measure those costs.

## Matched workload and results

Eight temporary Workers serve four synthetic wallets in two stable service groups.
The experiment keeps thirty-two candidates per wallet, a sixteen-candidate admission minimum, four-candidate preparation, and two-at-once consumption.
It uses two experimental preparation slots per group and a five-second benchmark cooldown.
Production defaults remain one group, one preparation slot, one signing slot, and a sixty-second cooldown.
Wallet-seed recovery, canonical FIPS export, and separate participant custody remain unchanged.

The frozen runtime revision is `f77984cee22db8fcedb1bd189b788ceea8e17152`.
Ordinary and diagnostic builds share production cryptographic source.
The diagnostic build adds fixed-public-input exports only in an isolated source copy.

Setup identifies the slower actor in group zero's secondary slot and the faster actor in group one's secondary slot.
The setup-informed selection is frozen before timed controls. It does not imply that a group or slot is inherently slower.
Both controls hold an unqueued primary lease on another fully stocked same-group wallet to select the secondary slot.
Every selected job sends 3,967,488 bytes from A and 1,434,560 bytes from B. All twenty-four jobs have the same transport shape.
No holder material is generated, retired, or used. Every holder remains authoritative until its `Unused` release.

The table reports CPU summed across both complete participant invocations and the complete A producer invocation's wall time.
Each job prepares four candidates. Wall time includes protocol and storage waits, rather than a complete client queue-to-ready boundary.
[Cloudflare's timing fields](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/) describe invocation CPU and wall time.

| Control | Jobs per actor | Slow paired CPU | Fast paired CPU | Slow A wall | Fast A wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary quiet controls | 4 | 15.742 s | 7.208 s | 16.695 s | 7.858 s |
| Diagnostic build, before probes | 1 | 15.009 s | 8.022 s | 16.541 s | 9.209 s |
| After empty probes | 1 | 15.271 s | 7.074 s | 16.326 s | 7.674 s |
| After heavy probes | 1 | 17.757 s | 6.951 s | 18.652 s | 7.594 s |
| Restored ordinary build | 2 | 16.282 s | 8.551 s | 17.504 s | 9.582 s |

Rows with several jobs report medians. One-job rows are individual observations.
These small screens do not establish steady-state percentiles or a latency guarantee.
Both unprobed diagnostic jobs miss the public schedule cache. Later diagnostic jobs hit it.
Each return median combines a first cache miss and a later hit.
The data establishes no warmup benefit. The slow actor remains slow after probes and restoration.

The first and reversed quiet repetitions have paired CPU ratios of 2.146 and 2.344.
Both pass the unchanged 1.5 diagnostic threshold with the same ordering.
All ordinary timed invocations hit the schedule cache.
Reported crypto lifetimes overlap in both concurrent-dispatch blocks. Physical CPU parallelism remains unmeasured.

## Same-instance public calibration

The encoder is the fixed linear transform used to generate silent-OT correlations.
The public encoder probe uses the full production dimensions: 1,048,576 blocks and a 524,288-symbol message.
Bulk AES processes 262,144 public blocks in one adapter call.
Each workload uses three fixed public seeds. Empty controls measure route and serialization overhead.

| Public workload | Slow A / B CPU median | Fast A / B CPU median |
| --- | ---: | ---: |
| Empty control | 0 / 0 ms | 0 / 0 ms |
| Bulk AES | 23 / 25 ms | 15 / 17 ms |
| Full encoder | 226 / 212 ms | 97 / 87 ms |

All thirty-six probes match both adjacent real jobs by Worker/version, actor, JS module UUID, core epoch, and Rust module UUID.
All checksums match the retained references. Heavy workloads produce nonzero CPU readings.
The actual preparation mutex excludes private preparation in that instance during probes.
No probe overlaps captured private cryptography or its complete invocation envelope.
The selected probe invocations total 2.162 seconds CPU. This excludes forwarding, front, and other campaign costs.

Wasm returns a thirty-two-bit checksum. The full ciphertext hashes belong to the independent Node/OpenSSL reference.
This validates checksum agreement, rather than every Wasm output byte.
Native encoder agreement checks the same pinned implementation across runtimes.
Public workload CPU also includes fixed input generation, allocation, checksum, authentication, and serialization.
Do not multiply these probe timings to estimate private component shares.

## Material, recovery, and signatures

All four wallets pass canonical creation and wallet-seed recovery, for eight ceremonies.
Private Router ceremonies take 5.80–7.52 seconds with generic stock ready, including client verification.
Generic key-independent preparation separately takes 51.10–89.33 seconds. It differs from a key-bound four-candidate refill.
These boundaries exclude public Gateway/SDK authentication, browser UI, NEAR submission, and finality.

Eight initial-stock setup signatures and four final signatures verify independently.
All twelve altered messages fail verification.
Initial-stock setup signatures span 1.07–9.07 seconds. Final checks take 3.497, 2.327, 1.766, and 1.135 seconds, one request each.
Those functional checks establish no new signing-latency distribution.

The twenty-four selected jobs publish forty-eight fresh pairs and replace forty-eight explicitly retired pairs.
Including final signing and its refill, thirty-one jobs remain below the forty-job cap.
The complete post-setup ledger is:

**64 initial + 59 fresh = 48 experiment retirements + 11 signature consumption + 64 final pairs.**

Both participants agree on every publication and take sequence. No consumed pair returns.
Each wallet finishes with sixteen matching pairs, zero reservations, and zero pending jobs.
Paired preparation CPU across all thirty-one jobs is 330.568 seconds.
Ordinary, diagnostic, return, and final-refill totals are 138.277, 70.084, 73.093, and 49.114 seconds.
This counts complete crypto-containing participant invocations. It is not a billing total.
Controlled retirement deliberately wastes material, so this experiment cannot report sustainable signatures per minute.

## Instrument checks and retained failures

All actual A crypto-containing invocations include the unconditional Rust alarm-entry marker.
The frozen collector includes that marker.
The first strict qualifier rejects twelve scheduled alarm records with canceled outcomes.
Independent review confirms expected Workers/versions, zero reported CPU, empty logs/exceptions, and no truncation.
They contain no evidence of entering the instrumented Rust alarm body and cannot numerically create the several-second CPU gap.
Their cause remains unknown. Zero reported CPU may conceal sub-resolution work.
The original rejection remains in the archive. Cancellations with CPU, logs, exceptions, truncation, or mismatched versions remain uncertain.

Normalization replaces twenty-one positively identified short-lived registration pairs before timing.
It preserves every existing normal pair and restores the same reserve with a ten-minute readiness horizon.
The first capture lacks four late A publication records. Positive origin checks stop before any retirement.
The complete capture and successful normalization remain separate from the failed setup record.

Eight setup-time Router exceptions follow deliberate changed-request replay refusals.
Their sanitized error categories remain unclassified. The source and completed artifacts provide that context without proving the exact error text.
The first final-capture decoder uses the wrong working directory. Raw records remain preserved and decode successfully from the repository.
No additional captured refill cryptographic failure or missing participant tail is found.

## Facts and remaining causes

| # | Fact | Instrument | Where and when | Checked |
| --- | --- | --- | --- | --- |
| F1 | Equal four-candidate work has different CPU cost | Job/actor/version/transport records and exact ledgers | October 31 Cloudflare controls, archived block records | Independent review |
| F2 | The gap persists quietly, in reversed order, and after ordinary restoration | Complete CPU, wall-time, and cache-state records | Ordinary and return phases | Independent review |
| F3 | Fixed public workloads also differ | 36 probes matched to both adjacent instances | Diagnostic phase | Public references and independent review |
| F4 | Cache state differs between first and later diagnostic jobs | Public schedule-cache records | Unprobed miss, later hits | Raw record replay |
| F5 | Ordinary signatures verify after recovery | Node/OpenSSL | Eight setup and four final signatures | 12 accepts and 12 altered-message rejections |

| Cause | F1 | F2 | F3 | Left |
| --- | --- | --- | --- | --- |
| One cold invocation alone | Says nothing | Contradicts repeated warm-cache gap | Says nothing | Rejected as sole cause |
| Extra candidates or protocol bytes | Contradicts matched work | Says nothing | Fixed public work also differs | Rejected as sole cause |
| Network or storage waiting alone | Says nothing | Cannot explain active CPU gap | Contradicts synchronous public-workload CPU | Rejected as sole cause |
| Overlapping application preparation alone | Says nothing | Contradicts quiet controls | Ordered guarded probes still differ | Rejected as sole cause |
| Our implementation or unmeasured allocation/context work | Fits | Fits | Fits | Unknown |
| Compiler or runtime tier | Fits | Fits | Fits | Unknown |
| Host hardware or unobserved platform contention | Fits | Fits | Fits | Unknown |
| Measurement or observer effects | Matching checks constrain this | Ordinary return constrains this | Probes remain an intervention | Not fully excluded |

The next implementation experiment should profile the actual conversion and encoder path, including eight/sixteen-block batches and erasure.
Compare bounded scratch reuse, copying, and public encoder expansion only when that profile supports the change.
Require fixed-output checks, unchanged single-use material, matched hosted controls, and repeated complete-job improvement before retaining a patch.
Larger active/idle wallet populations and production budgets remain a separate service-group qualification.
GPU work stays deferred.

## Replay and cleanup

Extract the [evidence archive](../evidence/ml-dsa-65-quiet-producer-hosted-20261031.tar.gz).
Run `python3 quiet-producer-hosted/replay-hosted.py` with Node ML-DSA support and Python3.
The replay verifies member hashes, complete job qualification, both analyses, all material ledgers, twelve signatures, and altered-message rejection.
No credentials or external calls are required. The credential scan finds zero private-key or token matches.
The [summary](../evidence/ml-dsa-65-quiet-producer-hosted-20261031.json) records archive identity, source/build hashes, and limits.

All test jobs are settled. The eight test Workers remain pending explicit deletion approval.
Automatic approval review rejected deletion because the earlier answer explicitly approved deployment and credential uploads.
The exact deletion scope and verified current test versions are retained locally for that approval.
