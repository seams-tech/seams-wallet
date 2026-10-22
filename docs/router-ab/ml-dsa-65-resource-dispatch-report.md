# ML-DSA preparation memory and client dispatch

The repeat Cloudflare screen verifies nineteen load signatures. Eleven final HTTP attempts finish below five seconds.
Their median is 3.568 seconds, with a 1.252–6.891-second range. The five-second target remains unmet.
The earlier `loadShed` outcome does not recur. These observations establish no source speedup or cancellation fix.
The [evidence](../evidence/ml-dsa-65-resource-dispatch-20261022.json) retains public records, controls, source hashes, and negative results.

## Scope and implementation

Preparation logs now record allocated Wasm memory, module identity, and the resource observation time.
The resource time belongs to the logging boundary. Some existing stage times describe earlier events.
The collector retains these public fields and classifies generic provider internal errors without exposing their reference strings.
Local inspector sampling records counters, request/receipt times, partial observations, and explicit disconnect failures.
The inspector uses bounded commands and connection waits. Repeated closure is safe.

The cryptographic protocol is unchanged. Wallet-seed recovery, standard FIPS export, private commitments, and participant separation remain required.
Preparation makes four candidates, with a smaller final refill when capacity requires it. Signing consumes two candidates at a time.
Each wallet retains a thirty-two-candidate cap and a sixteen-candidate admission minimum.
The screen permits one signing operation and one preparation producer at a time.
Its cooldown is one second for saturation. The production default remains sixty seconds.
GPU work and UI changes remain deferred.

The local lifecycle E2E passes three signatures, replay, restart, stalled peers, interrupted publication, and producer handoff.
It also checks private commitments before publication and the 214-layer online bound for each consumed pair.
Independent Node/OpenSSL review verifies all twenty-three hosted signatures, including four initial-stock signatures.
Altered messages and altered signatures fail verification.

## Hosted measurements

| Measurement | Result |
| --- | ---: |
| Verified load signatures | 19 |
| Final HTTP attempts below five seconds | 11/19 |
| Final HTTP median | 3.568 s |
| Final HTTP range | 1.252–6.891 s |
| Complete demands below five seconds | 6/19 |
| Complete demand median | 6.496 s |
| Complete demand range | 1.324–81.561 s |
| Four-candidate producer invocation median | 19.146 s |
| Four-candidate producer invocation range | 16.129–24.561 s |

Two demands remain unfinished at cutoff, after 161.001 and 175.922 seconds.
No signing operation reaches a failed terminal state. Three load successes lack complete peer traces.
Prepared creation takes 8.380 and 6.413 seconds. Recovery takes 8.552 and 6.854 seconds.
All four ceremonies preserve the canonical key. Their initial preparation takes 60.464–121.880 seconds and is excluded from those ceremony times.

Both pools restore fully. Public identities balance thirty-two initial groups plus forty-seven fresh groups against forty-seven consumed and thirty-two final groups.
Every identified consumed group is unique. This screen consumes ninety-four candidates for nineteen signatures.
That sample does not replace the long-term rejection estimate.
The common window after starting stock is consumed has zero completed signatures. It cannot qualify sustained signing capacity.

Captured preparer-A invocation time is 23.875 seconds per verified load signature, including reserve restoration.
This is one role's captured wall time. It excludes a complete two-role service-cost claim.
Twenty-two unidentified producer invocations are canceled, report zero CPU, and total 734 ms of captured wall time.
Cost accounting remains incomplete. Missing identities do not establish unidentified heavy work.

## Memory and cancellation

| Counter | Preparer A | Preparer B |
| --- | ---: | ---: |
| Hosted maximum observed Wasm capacity | 89.375 MiB | 89.563 MiB |
| Local maximum JS used heap | 11.50 MiB | 7.42 MiB |
| Local maximum JS backing storage | 9.89 MiB | 11.19 MiB |

These are separate observed maxima. They must not be added as a simultaneous isolate peak.
Wasm capacity can remain high after allocations are freed. Sampling can miss transient peaks.
The JavaScript readings come from local workerd. Hosted JavaScript memory remains unmeasured.
Cloudflare applies its [memory limit per isolate](https://developers.cloudflare.com/workers/platform/limits/), including JavaScript and Wasm.
The available counters do not reproduce the provider's complete memory accounting.

All forty-three captured preparer-B invocations report `ok`. None reports `loadShed`.
There are no false producer completions during load or reserve restoration.
Two earlier epoch-one jobs report false completion. Both roles reach `crypto_completed`; neither logs encrypted publication.
Their exact A/B record pairs are 4534/4650 and 4559/4659. Both B protocol completions request close code 1011.
Their causes remain unassigned. Provider invocation success and protocol completion are separate facts.

The absence of shedding in this repeat cannot explain the previous thirty-two shedding outcomes.
The runs differ in runtime conditions and rejection outcomes. No matched hosted instrumentation control was run.

## Client dispatch control

In the previous screen, all ten pre-send waits above four seconds end within two milliseconds of another request completing on the same socket.
The current screen retains the same pattern. Seventeen waits above one second end within one millisecond of the preceding response.
Those requests use HTTP/2. The maximum pre-send wait among successful requests is 4.686 seconds.

A local TLS control reproduces the behavior with Node 26.4.0 and its bundled Undici 8.5.0 HTTP client:

| Server permits 100 streams per session | Observed behavior |
| --- | --- |
| Two shared-client JSON POSTs | One active request; second send waits 303.916 ms for a 300 ms response |
| Same POSTs through separate warmed wallet clients | Two active requests; both sends below 1 ms |
| Shared-client GETs | Two active requests |

This identifies a client contribution to this probe's latency. It does not establish browser or public SDK behavior.
It also does not explain all slow signing. An eight-pair committed operation takes 6.429 seconds inside participant A.
Subtracting the pre-send interval would not qualify complete user-visible latency.

The control also records a one-stream case. The client opens another connection, so both POSTs overlap.
A newly created session can expose provisional remote settings. The diagnostic records settings at stream creation.
That field alone does not establish the final peer limit.

## Instrument checks and remaining causes

| Fact | Instrument | Check |
| --- | --- | --- |
| Wasm capacity is measured correctly | Same Rust `memory_size` expression in local workerd | Exact exported-buffer matches before and after seven-page and thirteen-page growth |
| Local CDP backing storage excludes Wasm | Separate JS and touched-Wasm allocations | Eight MiB JS allocation changes the counter; touched Wasm allocation and growth do not |
| Disconnect preserves partial evidence | Inspector closure during sampling | Explicit incomplete result, retained rows, and repeated stop pass |
| Long client sends follow previous responses | Exact request and socket identities | Current and preceding campaigns retain the same ordering |
| Separate clients remove the local queue | TLS POST/GET and per-wallet connection controls | Same public request body and server delay |
| Canonical keys and signatures remain valid | Hosted ceremonies and independent OpenSSL pass | Recovery key equality and twenty-three verified signatures |

| Candidate cause | Evidence | Assessment |
| --- | --- | --- |
| Client connection scheduling adds latency | Hosted socket ordering and the controlled TLS reproduction | Supported for this Node probe; browser parity remains open |
| Client queuing explains every slow signature | Eight-pair A invocation lasts 6.429 seconds | Removed as a complete explanation |
| Memory pressure caused earlier shedding | Earlier provider outcomes; current partial memory readings | Unresolved; the strongest failure signal did not recur |
| A protocol or application defect caused earlier shedding | Some previous failures occurred during cryptographic work | Unresolved; this repeat cannot exclude a runtime interaction |
| The measurement itself changes behavior | Inspector sampling and additional hosted log fields | Local counters are calibrated; hosted perturbation remains uncontrolled |

The evidence retains corrected measurement assumptions. CDP storage was initially treated as including Wasm.
A per-session stream limit was initially treated as a limit across all client connections.
The TLS control now snapshots each server phase before later warmups can change it.

## Next work

1. Give each simulated wallet its own HTTP client. Repeat hosted load, then compare the public browser SDK path.
2. Profile the remaining private challenge hash and bound checks. Target the slow multi-pair cases and preparation CPU cost.
3. Reduce generic registration-stock activation and installation costs. Preserve canonical recovery and the existing capacity.
4. Reproduce provider cancellations with version-matched controls before choosing a memory or scheduling change.

The branch was rebased cleanly onto `dev` at `3fd5a9f0` while the frozen hosted campaign ran.
The hosted artifacts identify the earlier build source. A post-rebase Wasm compilation check passes.
The bloat gate reports 14,030 duplicated Rust lines against a 13,754-line baseline.
The rebased HEAD produces the same count without this change. The baseline remains unchanged.
All five temporary Workers were deleted after collection.
