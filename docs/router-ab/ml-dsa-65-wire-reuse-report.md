# ML-DSA prepared GMW wire reuse

The prepared GMW evaluator now reuses private value-buffer slots after their last public circuit use.
The mixed native engine check reduces private allocation from 8,763,760 to 2,007,628 bytes, or 77.1%.
This metric covers value and correlation capacities. It excludes compiler temporaries and total isolate memory.
Consistent registration and signing below five seconds remain unqualified.

The [evidence record](../evidence/ml-dsa-65-wire-reuse-20261023.json) binds the source patch, circuits, binaries, and measurements.
The [data archive](../evidence/ml-dsa-65-wire-reuse-20261023-data.json.gz) retains public profiles, sanitized traces, failed attempts, and reproduction scripts.

Public circuit structure determines every reuse decision.
All final outputs remain live. Inputs shared within an AND layer remain live until all layer outputs have separate slots.
The compiler preserves gate order, AND indices, layer membership, correlations, and protocol messages.
It caches public layout data only. Private value buffers keep their existing zeroization.

A packed compiler record uses twenty-four bits for the physical slot and eight bits for remaining public references.
Reference saturation pins a wire. The trusted schedule parser limits logical wires below the twenty-four-bit address range.
There are no new dependencies, public protocol options, storage formats, or backend flags.

A symbolic checker verifies actual evaluator order for all twenty current schedules.
It independently tracks each logical wire in its physical slot, including final outputs.
Calibration covers repeated operands, direct-input outputs, shared layer inputs, late and unused outputs, and reference saturation.
It rejects a deliberately changed output address.
The commitment hash needs 12,801 value slots instead of 1,363,360. The largest compact layout uses 38,628 slots.

The native mixed check checks 105 outputs against independent SHAKE and boundary oracles.
Both original-A/packed-B and packed-A/original-B combinations pass with fresh correlations.
The 2,467,738 AND gates, 168 online exchanges, and phase payload lengths remain unchanged.
Six canonical key-generation cases and the existing recovery, export, storage, replay, and private-signing checks pass.
The complete local Worker/Gateway lifecycle also passes participant restoration and interrupted publication.

The local profiler now records explicit operation IDs and retains full public stage/signing traces, including failure paths.
Exact operation joins identify both role profiles, checked pairs, consumed material, and actual module call counts.
The matched reused two-pair observation changes from 152.486 to 129.510 milliseconds.
The matched first-use one-pair observation changes from 372.356 to 402.114 milliseconds.
Each comparison has one observation. These mixed results establish no latency distribution or causal speedup.
Sample categories overlap. Sample counts are not CPU milliseconds or billed CPU.
Unassigned JavaScript get/put/delete samples do not identify storage CPU.
Missing wiping or compaction samples do not show that those operations disappeared.

The first prototype used separate address and reference arrays.
Its observed preparation Wasm capacity reached 99,549,184 bytes on each role.
The packed version reaches 94,502,912 bytes on A and 94,371,840 bytes on B.
The original maxima are 94,437,376 and 93,913,088 bytes.
These measurements show no total isolate-memory reduction.
They record allocated Wasm pages at preparation boundaries. They exclude JavaScript and host buffers and do not measure live signing peaks.
The initial prototype and its results remain separately archived.

The investigation keeps measured component facts separate from possible latency causes.

| Fact | Instrument and checked scope |
| --- | --- |
| Private value slots remain allocated after their public last use in the control. | Original compiler/evaluator source and calibrated local profiles. |
| Packed execution preserves all twenty public layouts' reads and outputs. | Independent symbolic occupancy checker, plus a changed-output negative control. |
| Mixed execution keeps the same gates, exchanges, and phase bytes. | Fresh native correlations, independent oracles, and both mixed-role directions. |
| Whole preparation Wasm capacity stays close to the original. | Observed allocated pages at preparation checkpoints. Total live memory is outside the instrument. |
| Warm and first-use local comparisons move in different directions. | Exact operation, module, pair-count, and payload joins. One observation per cohort. |

| Candidate cause or claim | Result against these facts |
| --- | --- |
| Oversized private value buffers add evaluation and wiping work. | The engine check shows the allocation reduction. Its contribution to complete hosted latency remains unqualified. |
| Decimal arrays dominate material transport. | Rejected before implementation. The existing ciphertext transport already uses base64. |
| Fewer protocol exchanges explain a gain. | Rejected. Exchanges and phase bytes remain unchanged. |
| JavaScript get/put/delete samples identify storage CPU. | Unresolved. Their ownership remains unassigned. |
| Smaller private buffers imply a lower total isolate peak. | Unresolved. The instrument measures page capacity and excludes other allocations. |

The Cloudflare campaign uses two synthetic wallets per profile, with creation and canonical recovery for each wallet.
Both profiles then run eight minutes of concurrent demand through separate wallet HTTP clients.
We deleted the control Workers before packed timing. No build, deployment, local CPU benchmark, or compression overlaps either timing window.
Both reserves restore to sixteen ready pairs, and both material ledgers balance without consumed-ID reuse.

| Complete hosted measurement | Control | Packed |
| --- | ---: | ---: |
| Prepared registration/recovery, median | 4.547 s | 5.218 s |
| Prepared registration/recovery, maximum | 6.222 s | 6.059 s |
| Registrations below five seconds | 3/4 | 2/4 |
| Preceding keygen plus sixteen-candidate preparation, range | 49.614–86.320 s | 66.018–109.562 s |
| Verified initial-stock signatures | 3/4 | 3/4 |
| Verified load signatures | 30 | 36 |
| Load signatures below five seconds | 26/30 | 34/36 |
| Successful load HTTP time, median | 2.354 s | 2.148 s |
| Successful load HTTP time, maximum | 7.415 s | 5.608 s |
| Complete successful demand, median | 22.311 s | 21.840 s |
| Complete successful demand, maximum | 148.722 s | 84.416 s |
| Exhausted operations during load | 2 | 0 |
| Unfinished demands at cutoff | 2 | 1 |
| Post-starting-stock signatures per minute | 2.501 | 3.830 |
| New paired batches per minute in that window | 11.768 | 11.785 |

Registration includes the admitted request, canonical key generation, durable installation, initial-stock delivery, activation, and client custody checks.
Its preceding preparation timer covers key-generation material plus sixteen signing candidates. It does not time one four-candidate preparation.
Load HTTP time measures each successful final request. Complete demand also includes pool and service-capacity waits and failed-operation retries.
Independent signature verification follows HTTP timing. Login, browser UI, public SDK transport, NEAR submission, and finality remain outside these measurements.

One initial signing operation per profile exhausts eight pairs. Both roles complete with provider outcome `ok`.
The control takes 14.116 seconds, and the packed version takes 8.163 seconds for those failed attempts.
The affected raw registration artifacts retain `functionalPassed: false`, while all eight `registrationChecksPassed` results remain true.
The first campaign precondition stopped on that control artifact. The continued run uses the same recovered wallets and preserves the failed attempt.
It does not repeat registration or replace the failed result.

Both profiles observe eighty new paired batches over their approximately 407-second post-starting-stock windows.
The almost identical material-arrival rates establish no refill-throughput gain.
Different rejection outcomes, cache histories, material lifecycles, and sequential hosting conditions prevent a causal full-latency claim.
Among complete successful traces, the control checks seven generic pairs across six operations. The packed version checks three across two operations.
Generic pairs add a public 113-layer commitment phase. Committed refill pairs complete that work during preparation.
Equal checked-pair counts alone therefore do not establish matched online work.
Four-candidate producer clock medians are 7.914–8.335 seconds across control wallets and 8.576–9.021 seconds across packed wallets.
These recorded producer intervals exclude queue admission and do not measure total preparation cost per successful signature.

The two slow packed successes check nine and eight pairs. Their role modules are first-use and mixed first/reused, respectively.
The four slow control successes include both first-use and reused modules.
Four successful load operations per profile lack a complete two-role trace join. All slow successes have complete joins.
Two control B registration-stage joins are partial. One control initial signature also lacks its A execution trace.
The report retains these missing observations explicitly. They do not indicate zero CPU, missing cryptographic checks, or complete telemetry.
The strict analyzer and its failure remain in the archive. The final analyzer separates trace coverage from client verification.

Collected non-ok invocations include canceled calls and exceptions. Their causes remain unassigned in this screen.
The evidence retains their versions and contexts. Internal phase clocks cannot partition CPU, storage waits, and protocol waits.
We deleted all ten temporary Workers. The receipts record Worker deletion and make no separate namespace-deletion claim.

Both profiles use the same public fixtures, client sources, and policy.
Capacity remains thirty-two candidates per wallet, with sixteen ready candidates required for admission.
Preparation produces four candidates, and signing consumes two at a time.
The functional campaign uses a one-second cooldown. The production default remains sixty seconds.
Worker preparation, private rejected commitments, wallet-seed recovery, and canonical FIPS seed/key export remain unchanged.
UI and GPU work remain deferred.

The first symbolic-verifier attempt decoded the public schedule header with the wrong byte order.
The corrected instrument uses the production format's big-endian encoding. Production parsing remained unchanged.
A later stale formatting receipt triggered a source-hash check. Regeneration restored the receipt and repeated all twenty checks.
The native and Worker checks used the final regenerated verifier and the frozen packed binaries.
We built the original control binaries for the preceding table-I/O screen before its runtime changes became commit `6384d3b9`.
Their exact Wasm receipts identify the measured code.
Current-worktree source hashes in the control E2E provenance do not identify those older binaries.

The required bloat check retains the existing failure: 13,972 duplicated Rust lines against 13,754 allowed.
The starting commit also has 13,972 duplicated Rust lines. This change leaves the baseline unchanged.
Rust formatting, JavaScript syntax, and diff whitespace checks pass.
Independent review finds no correctness blocker. Its material-lifecycle objection added the generic-pair comparison and limits above.

Next work should target complete hosted first-use execution and repeated per-pair setup.
Profile key activation, material restoration, and participant dispatch with exact operation and module identities.
A lower private-buffer allocation alone cannot establish fewer storage waits, fewer exchanges, or more service capacity.

To repeat the engine and lifecycle checks, build `tools/ml-dsa-investigation` in release mode.
Run `prepared-gmw` and `prepared-keygen` with separate output paths.
Build Router, participant A, and participant B sequentially with `scripts/build-strict-worker.sh` and the release profile.
Run the durable Worker E2E with fresh role fixtures and `--profile-signing`.
Run the registration Worker E2E with a fresh wallet fixture directory.

To check the recorded measurements offline, decompress the data archive and materialize its `files` entries.
Preserve JSON entries as JSON and text entries as text.
Run `analyze_registration.py`, `analyze_capture.py`, and `analyze_profiles.py` beside the extracted files.
Campaign-local paths in structural/native scripts require adjustment for a new checkout.
Those scripts retain their exact measured versions and schedule hashes.
A fresh hosted repeat needs new Worker names, credentials, role keys, and correlation material.
Use the archived policy and runners. Record full reserve snapshots before and after load.
Keep builds, deployments, local CPU benchmarks, and compression outside timing windows.
