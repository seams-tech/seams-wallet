# ML-DSA per-pair activation and receive-deadline screen

Consistent five-second signing remains unproved. No runtime optimization from this screen is selected.
Two prototypes passed functional checks, but neither established a useful hosted latency gain.
Their patches and evidence remain archived. The active runtime matches parent `3a5dcbf2`.
The retained change strengthens the real-Worker cancellation test.

Wallet-seed recovery, standard FIPS seed/key export, private commitments, preparation on Workers,
two-at-once consumption, and thirty-two-candidate pool capacity remain unchanged.
GPU and UI work remain deferred.

## Hosted results

All timings are seconds. Registration includes client verification after prepared material is ready.
Signing ends after HTTP response decoding; OpenSSL verifies the returned signature afterward.
These requests use the authenticated Gateway route, standard Router forwarding, and separate A/B Workers.
Public login, browser UI, NEAR submission, and finality are outside this screen.

| Arm | Creation / recovery | Verified signing range | Successful requests below five seconds | Other outcomes |
| --- | ---: | ---: | ---: | --- |
| Control | 4.455 / 5.763 | 2.802–5.110 | 4 of 5 | Two cooldown refusals; one exhausted operation |
| Receive-deadline prototype | 5.474 / 4.676 | 1.513–7.732 | 4 of 6 | None observed |
| Same-Worker control reversal | 4.169 / 4.559 | 2.462–7.687 | 1 of 2 | None observed |

The control exhaustion consumes sixteen pairs, or thirty-two candidates, in 10.091 seconds.
It returns a failed operation. It is excluded from successful-signature ranges and remains in the evidence.
The cooldown refusals take 0.086 and 0.243 seconds and admit no new signing operation.
They are excluded from signing-success counts.

The original control follow-up scheduler used client request start plus sixty seconds.
Server cooldown starts at reservation, which occurs later.
This is classified as `valid_test_needs_update`; production admission behaved correctly.
Later requests wait at least sixty seconds after the preceding completed response.
Two separate control follow-up requests add one success and the exhausted operation.
The original refused requests and their artifacts remain unchanged.
The follow-up copies registration metadata; it adds no registration ceremonies.

Successful control requests consume 2, 2, 5, 4, and 2 pairs.
Prototype requests consume 6, 2, 1, 1, 3, and 2 pairs.
Reversal requests consume 1 and 6 pairs.
Different rejection outcomes and material types prevent a direct latency comparison.
A lower aggregate prototype median does not establish a speedup.

The original control and prototype use the same synthetic wallet and produce four identical canonical public keys.
The reversal uses another wallet ID in the existing namespaces.
Wallet identity enters seed derivation, so its canonical key differs. Recovery reproduces that key exactly.
All six ceremonies authenticate role replies, verify the manifest, and reject changed registration replays.

## Preparation variation

These preparation calls produce key-generation material and sixteen initial signing candidates.
They are separate from prepared registration latency. They are not four-candidate refill measurements.

| Arm | Creation preparation | Recovery preparation | Creation CPU A / B | Recovery CPU A / B |
| --- | ---: | ---: | ---: | ---: |
| Control | 49.421 | 64.037 | 22.173 / 23.657 | 21.711 / 25.552 |
| Prototype | 80.109 | 84.339 | 20.923 / 43.952 | 43.397 / 22.727 |
| Control reversal | 62.748 | 72.111 | 22.652 / 24.023 | 23.570 / 44.159 |

CPU values cover the complete role preparation invocation.
All six B preparations write 2,711 frames in 170 transactions, with sixteen pending frames at most.
The same large CPU increase recurs after restoring the control binary.
The prototype therefore cannot be identified as its sole cause.
The screen cannot isolate platform load, engine tiering, runtime scheduling, or a source/runtime interaction.
It establishes no preparation speedup or sustained refill capacity.

Control and prototype used sequential fresh deployments.
The reversal reuses Worker names and namespaces, with the original control binaries.
Placement, isolate reuse, background refill, cache state, and rejection counts remain uncontrolled.
These limits prevent a causal performance conclusion.
All six current temporary Workers were deleted after the reversal.

## What the traces show

A pair contains two independently prepared candidates consumed together.
Generic pre-key stock still needs online commitment work.
Key-bound committed stock finishes that work during refill.
The current committed path has 214 dependent AND layers; generic stock has 327.
An AND layer is a group of private Boolean gates that can run together before the next peer exchange.

The following values are medians over complete role traces in the original control and prototype.
They combine both roles and include the exhausted control operation.
They describe stage intervals from the Worker clock; they do not isolate CPU, storage, or network time.

| Arm / material | Role-pair observations | Take material | Restore material | Activate pair | Private signing checks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Control generic | 18 | 93 ms | 0 ms | 221.5 ms | 336.5 ms |
| Control committed | 42 | 119 ms | 0 ms | 13.5 ms | 363.5 ms |
| Prototype generic | 28 | 103 ms | 0 ms | 318.5 ms | 486 ms |
| Prototype committed | 2 | 140 ms | 0 ms | 14 ms | 888 ms |

A zero restore interval does not prove zero CPU cost. Cached Worker clocks limit resolution.
The prototype has only two complete committed role-pair observations.
These unequal samples cannot attribute a cost change to the prototype.

The archive contains 2,604 sanitized invocation records, with no reported exceptions or truncation.
Original control creation lacks its A trace; reversal creation lacks its B trace.
The control follow-up captures both role traces.
Observed material IDs do not repeat across operations within either role's captured traces.
Incomplete capture prevents a complete material-ledger claim.
A false truncation flag does not prove that every invocation or event was captured.

## Prototypes and selection

### Reuse expanded key state within one signing operation

This prototype shares parsed secret polynomials, their transforms, and the public matrix across pairs.
Existing key/epoch bindings and private checks remain enforced.
The native campaign verifies ten durable signatures across twenty distinct pairs, with rollover and exhaustion.
Malformed stored role, ID, count, layout, and length are rejected before protocol transport.

Twenty-two native key-expansion observations take 0.074 ms median, ranging from 0.072 to 0.087 ms.
This measured cost does not justify the extra ownership API.
The prototype is archived and removed. Native timing does not establish Wasm parity or exclude a larger hosted setup cost.
Its native artifact validates that unselected prototype; it does not measure the receive-deadline change.

### Reuse one absolute receive-deadline future per connection

The control constructs a `worker::Delay` on each receive attempt.
The prototype stores one pinned future and arms its timer on the first blocked receive.
Later frames preserve the original deadline.
This removes repeated future construction without changing protocol frames, acknowledgment windows, gates, or private values.
Outer operation guards and preparation yield timers remain.

The reduction is source-derived. Actual JavaScript timer callback totals were not measured.
For one local three-pair operation, control and prototype each record 671 receive events on A and 674 on B.
Those counts imply fewer `Delay` constructors in the prototype; they do not prove lower hosted latency.

The Worker `Delay` implementation retains the first task waker.
Reusing it requires one task to own the connection and terminate after a deadline error.
The observed callers satisfy those conditions, but the change adds assumptions without a demonstrated speed benefit.
Independent review requested the control reversal after seeing slower prototype preparation.
The reversal reproduces the CPU variation and a slow signature.
The prototype remains unselected because no useful benefit is established.

Two local timer-counter probes failed before yielding valid counts.
A second inspector connection closed the existing connection.
Reusing the CPU-profiler connection then failed because no default execution context was available.
Both are classified as `environment_or_infrastructure_failure` in the measurement adapter.
The probes were removed; their failures and patches remain archived.
No production behavior changed to satisfy them.

## Safety checks and instrument limits

The control and prototype local campaigns each verify three standard signatures with OpenSSL.
They exercise automatic refill, multi-pair rollover, restart replay, interrupted publication, and producer handoff.
The strengthened cancellation scenario sends two valid, delayed protocol exchanges before stalling the peer.
The connection closes with code 1011 at the original deadline.
Observed overruns are 9 ms for control and 13 ms for the prototype.
The first consumed pair remains retired, and an expired take request is rejected.
The final local campaign passes against the restored control runtime, with a 7 ms deadline overrun.

No secret arithmetic, disclosure, circuits, seed derivation, FIPS encoding, or protocol messages change.
This review covers the transport prototype's scope. It is not a new full cryptographic audit.
The experiment does not change the existing passive server-blind security claim.

| Fact | Instrument and location | Check |
| --- | --- | --- |
| Registration reproduces the canonical key | Native custody client and hosted creation/recovery replies | All six ceremonies pass |
| Standard signatures verify | Node/OpenSSL after response decoding | Stored signatures can be verified again offline |
| Later frames preserve deadline and single use | Miniflare/workerd E2E with two valid exchanges and a stalled peer | Control, prototype, and final artifacts retained |
| Preparation CPU varies at fixed frame/write counts | Provider invocation CPU and registration preparation counters | Variation also occurs in the control reversal |
| Receive constructor work decreases in the prototype | Source review plus receive counters | Callback allocation/scheduling totals remain unmeasured |

| Possible cause of slow requests | Evidence | Status |
| --- | --- | --- |
| Repeated native key expansion dominates | Native median is 0.074 ms | Contradicted for that native probe; hosted parity unknown |
| Deadline constructor work dominates | Structural reduction passes correctness but shows no useful hosted gain | Unsupported; prototype removed |
| Prototype alone causes high preparation CPU | Reversal B reaches 44.159 seconds on control code | Contradicted as the sole cause; interaction remains possible |
| Rejection count and generic commitment work add latency | Slow verified requests consume up to six pairs; traces show repeated private work | Contributes, but does not isolate all waits |
| Platform, cache, or runtime variation contributes | Same control code has materially different CPU at fixed preparation counts | Fits; individual causes remain unresolved |
| Measurement orchestration causes cooldown refusals | Scheduler used request start before server reservation | Confirmed for two refusals; corrected in later requests |

Earlier in this investigation, the first pair was described as unconsumed before protocol agreement.
That statement is withdrawn. Input loading consumes it before execution; the cancellation check proves retirement afterward.
Any claim that a lower prototype median proves improvement is also withdrawn.
No claim of measured JavaScript callback savings is supported.

To resolve the remaining uncertainty, measure complete first-use key loading and private hash/check execution on both roles.
Correlate those intervals with provider CPU, stock type, module identity, and pair count.
Keep clocks' limits explicit and compare cold and reused execution separately.
Then optimize the largest repeatable component and rerun full registration, signing, and sustained refill at unchanged capacity.
The 168 hash layers per committed pair remain a high-impact target; this screen changes none of them.

All three prototype Worker release builds and the native client build pass.
The final runtime is unchanged, and the retained E2E passes against the frozen control builds.
Scoped syntax, whitespace, and source-fingerprint checks pass.
The required bloat check retains the inherited 13,972 versus 13,754 Rust duplication failure.
The baseline remains unchanged.

The [evidence summary](../evidence/ml-dsa-65-receive-deadline-20261024.json) links the sanitized archive.
It includes source patches, original failures, capture analysis, build hashes, deployment versions, and cleanup receipts.
Extract `scripts.verify.py` from the archive and run it with the archive path using Python and a Node build with ML-DSA support.
It reproduces policy checks, lifecycle assertions, verification of all twenty-two stored signatures, and changed-message rejection without Cloudflare access.
