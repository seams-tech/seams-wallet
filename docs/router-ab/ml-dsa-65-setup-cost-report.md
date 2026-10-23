# ML-DSA first-use setup and per-pair allocation screen

Keep the two small component reductions. They do not establish a hosted latency gain.
Consistent five-second registration and signing remain open.
Wallet-seed recovery, canonical FIPS export, private commitments, prepare-four/consume-two policy, and the thirty-two-candidate cap remain unchanged.

## Runtime changes

Public circuit indices use a validated width of one to four bytes.
The decoder uses direct big-endian loads for each width instead of a byte loop.
The parser still checks the artifact digest, header, bounds, initialized operands, and outputs.
Its branches depend on public widths. No private input determines the decoding path.

Each GMW batch allocates one outgoing buffer for its largest public layer.
The capacity sums twice each group's layer AND count times its packed lane-byte count.
Successful layers wipe the used bytes before clearing the buffer.
Errors and cancellation drop its `Zeroizing` owner. The pinned zeroize implementation wipes the complete capacity.
A committed pair therefore uses three batch buffers instead of separate buffer lifetimes across 214 nonempty AND layers, before geometric reallocations.
This count describes the outgoing buffer only. Receive buffers and other allocations remain.
The buffer stays allocated through output decoding, so fewer allocations do not establish lower peak memory.
Circuit bytes, correlation order, gate counts, exchanges, storage formats, and signature encoding remain identical.
Each participant Wasm binary grows by 741 bytes. The Router grows by 762 bytes.

## Component evidence

The public Node/Wasm probe embeds the production decoder, compiler, and slot-reuse code.
Its standalone parser counts AND gates. It excludes SHA-256 and full trusted-schedule validation.
It also excludes Worker startup, transport, and private inputs. Complete first-use parity is not established.
One AND-count parse plus three constructions of the largest commitment-hash layout take 43.902 ms median in the control and 36.484 ms in the candidate.
This approximately seventeen-percent reduction applies to the warm isolated probe.
Both variants pass structural checks across twenty public circuit files.

Three alternating native observations per variant use fresh correlations and 105 independent oracle outputs.
The cases cross the thirty-two-lane packing boundary.
Role B online median is 13.505 ms for the control and 11.380 ms for the candidate.
All outputs, gate counts, exchanges, and phase byte counts agree.
Mixed old/new roles pass in both directions for two-, three-, and four-byte circuit indices.
Canonical key-generation, recovery, export, storage, replay, and private-signing checks pass.

Both corrected local durable Worker lifecycle runs pass.
The reused one-pair observations are 96.441 ms for the control and 92.971 ms for the candidate.
These are single observations. First-use runs consume four and eight pairs respectively, so their totals do not isolate setup cost.
The candidate's complete local Gateway registration, recovery, and participant-restoration flow passes.

## Cloudflare evidence

The first control and candidate screens each run two independent wallet clients for eight minutes.
The reversal and candidate repeat each run for six minutes after a separate demand warm-up and full-reserve checkpoint.
The repeats use the same five Worker names and wallet stores, with fresh operation IDs and fresh correlations.
Deployments reset modules and can change placement. Same Worker names do not fix compilation or scheduling conditions.
No builds, deployments, compression, or CPU benchmarks from this task overlap measured load.
The evidence records exact deployed versions, frozen binary hashes, starting material IDs, partial traces, and censored demands.

| Screen | Verified signatures | HTTP below five seconds | HTTP median | HTTP maximum | Complete-demand median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Control, first screen | 48 | 44/48 | 1.955 s | 12.239 s | 20.093 s |
| Candidate, first screen | 19 | 12/19 | 4.010 s | 11.873 s | 38.987 s |
| Control, same Worker names | 9 | 4/9 | 5.366 s | 9.281 s | 20.732 s |
| Candidate, same Worker names | 20 | 12/20 | 4.830 s | 9.369 s | 30.744 s |

HTTP latency measures the successful final request. Complete demand also includes admission retries and capacity waits.
One control operation and one reversal operation each exhaust eight pairs, or sixteen candidates.
Those terminal failures take 5.486 and 6.063 seconds respectively and remain outside the successful-latency table.
These measurements exclude login, UI, NEAR submission, and finality.
Benchmark cooldown is one second. Production cooldown remains sixty seconds.
The configured service admits one operation and runs one producer at a time in this screen.
Every measured screen restores both reserves. Material ledgers balance and the pool target remains unchanged.
Warm-up minimum-success failures remain in their raw artifacts. Warm-up is separate from measured functional qualification.

Prepared creation/recovery takes 4.484–5.390 seconds in the first control screen and 6.661–9.265 seconds in the first candidate screen.
Three of four control ceremonies exceed five seconds. All four candidate ceremonies exceed five seconds.
The reversal and repeat reuse existing wallets. They supply no new registration measurements.
Initial signing also remains variable. All eight first-screen initial signatures verify.

The first candidate screen is slower across signing, registration, and preparation.
The control reversal remains slow too. The initial comparison therefore does not isolate the candidate binary's effect.
The data do not establish the platform's cause or rule out smaller code effects.
Rejection counts, generic-versus-committed stock, module reuse, and observation windows differ.
The archived joins preserve these distinctions instead of treating every pair as equal work.

The following comparison uses newly started, exact-version four-candidate jobs during measured load.
It requires one role invocation per side and both publication markers.
Warm-up, smaller jobs, old versions, partial joins, and failed jobs remain separate in the evidence.
CPU covers the complete invocation.
Archived cross-clock publication deltas combine A invocation time with A/B log timestamps.
Clock alignment is unqualified. These deltas do not establish elapsed preparation duration.
The earlier commentary describing 18.4 and 19.7 seconds as preparation durations is withdrawn.

| Screen | A schedule cache hit | Jobs | A CPU median | B CPU median |
| --- | --- | ---: | ---: | ---: |
| baseline | True | 44 | 4.162 s | 4.237 s |
| packed | True | 20 | 8.024 s | 8.355 s |
| reversal | True | 15 | 8.636 s | 9.367 s |
| rechallenge | True | 16 | 8.223 s | 8.500 s |

Observed preparation Wasm memory reaches 90.125 MiB on A and 90.000 MiB on B in all four screens.
These checkpoints do not measure total isolate peak memory or establish a peak-memory reduction.

## Corrected interruption evidence

The first candidate local run verifies three signatures, then fails a publication-evidence assertion.
The test deliberately holds the final A `Put` response after the durable store returns success.
It observes both Ready inventories and restarts the runtime.
A later producer `published` marker can be absent while that successful response is held.
The failure is classified as `valid_test_needs_update`.

The E2E now records the exact interrupted-job IDs, both Ready inventories, and the preparation-event count at that checkpoint.
It accepts a missing marker only for those exact paired Ready batches, with commitment completion already observed.
Recorded-marker ordering stays strict. Missing markers elsewhere still fail.
Source ordering, the successful-storage fault, paired Ready state, and later verified consumption support the invariant together.
Event-array order alone does not timestamp durable commitment.
The corrected reruns capture these checkpoints but need no missing-marker fallback.
The original failed artifact and original test source remain available for review.
No production publication, retry, or single-use behavior changes.

## Facts and remaining hypotheses

| Fact | Instrument and limit |
| --- | --- |
| Public layout construction is faster in the isolated probe. | Alternating Node/Wasm observations. Full setup parity is absent. |
| Native execution preserves outputs and phase bytes. | Fresh correlations, independent oracles, mixed-version execution. |
| The control reversal remains slow. | Exact deployed versions and fixed-work jobs. Redeployment can change placement and compilation. |
| Interrupted publication can lack its later log marker. | Held successful storage reply, paired Ready checkpoint, and verified consumption. |
| Observed Wasm capacity is similar. | Stage checkpoints only. Total isolate memory is unmeasured. |

| Candidate explanation | Finding |
| --- | --- |
| The observed slowdown requires the candidate binary. | Contradicted by the slow control reversal. An effect from the candidate code remains possible. |
| Hosted execution or compilation conditions vary. | Consistent with the reversal. Hardware placement and engine tiering remain unmeasured. |
| Rejection sampling alone explains all preparation CPU variation. | Fixed-size preparation jobs vary too. Rejection counts still affect signing totals. |
| Installation is independent of circuit decoding. | Withdrawn. Its scope check can load and validate schedules on first use. |
| Fewer buffer allocations imply lower peak memory. | Unestablished. The buffer remains live through output decoding. |
| The missing marker proves publication before commitment completion. | Contradicted by the injected fault boundary and paired Ready observations. |

Keep these changes as bounded component optimizations. Do not present them as a five-second product qualification.
The next useful work is:

1. Profile complete first-use schedule validation, layout compilation, Wasm initialization, and dispatch separately with calibrated instruments.
2. Measure repeated key-state construction and restoration per committed pair before adding any cache.
3. Reduce the largest measured cost while preserving reservation binding and single-use material.
4. Repeat matched fixed-work controls and end-to-end capacity tests. Keep failed operations and empty-pool waits in the result.

Provider-level placement and compilation evidence would be needed to explain the remaining hosted CPU variation.
No platform cause is asserted by this screen.

## Reproduction and checks

The [summary](../evidence/ml-dsa-65-setup-cost-20261023.json) links the credential-scanned archive and its SHA-256 digest.
The [archive](../evidence/ml-dsa-65-setup-cost-20261023-data.json.gz) contains public fixtures, sanitized traces, source patches, binary receipts, failures, and analysis recipes.
Raw request headers, credential payloads, role keys, and Cloudflare account identifiers are excluded.
Extract the archive's `files` map into a directory, then run its `verify_offline.py` with the archive path.
The four analyses must reproduce their recorded JSON exactly. This replay makes no network calls and reuses no cryptographic material.
Hosted repetition requires fresh correlations and new operation IDs. Never reuse captured private preparations.
The control is commit `00397c8eb1652045f51aa3cf3e719501207734b0`; frozen Wasm receipts identify the tested binaries.
Current test source receipts do not identify older control binary sources.

All ten temporary Workers are deleted after the final repeat.
The bloat check retains the inherited Rust-duplicate failure: 13,972 lines against a 13,754-line baseline.
The baseline remains unchanged. This screen adds no dependency, protocol flag, persistence migration, or alternate runtime.
