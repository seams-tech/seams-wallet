# ML-DSA larger AES batch screen — October 26, 2026

Keep the existing software AES runtime. Neither larger-buffer prototype establishes a useful hosted gain. The native path increases published-job CPU. The larger software batches also show no CPU reduction. Both runtime prototypes are removed. Their exact sources remain archived. New public benchmark correlation and the corrected activation fixtures remain.

The selected runtime keeps preparation on Cloudflare Workers.
Wallet-seed recovery, standard FIPS seed/key export, two-at-once consumption, and per-wallet capacity stay unchanged.
Refill retention stays at one hour. GPU work stays deferred.

## Hosted results

Eight synthetic wallets share two independent preparation slots.
Each wallet holds sixteen pairs, with two candidates per pair. The runtime default remains one preparation slot.
Both arms use the same capacity, admission policy, and expiry policy.
The control uses the committed software AES. The native candidate uses fresh native AES calls at 1,024-block public boundaries.
The final software candidate uses the larger buffers with the original Wasm AES backend.

Successful HTTP time excludes previous admission waits. Complete demand time includes pool, cooldown, and service-capacity waits.
These private Router measurements exclude browser transport and public Gateway approval.
The rate includes full reserve restoration after finite load. It is not a maximum-capacity guarantee.
A qualified cycle meets the version, capture, and availability-accounting checks. It does not mean every request succeeds.

| Phase | Verified signatures | HTTP seconds: min / median / max | Empty-pool responses | Failed operations / driver errors | Signatures/minute including restoration |
| --- | ---: | --- | ---: | ---: | ---: |
| precondition | 73 | 0.552 / 1.851 / 6.316 | 83 | 3 / 0 | 6.349 (unqualified) |
| control | 46 | 0.810 / 1.726 / 5.128 | 9 | 1 / 0 | 5.522 |
| candidate | 32 | 0.605 / 2.119 / 5.129 | 200 | 2 / 1 | 3.292 (unqualified) |
| software-precondition | 63 | 0.510 / 1.869 / 19.564 | 388 | 3 / 0 | 4.807 (unqualified) |
| software-batches | 42 | 0.664 / 2.197 / 11.368 | 0 | 0 / 1 | 5.493 (unqualified) |

Each four-candidate job publishes two independently consumable pairs.
The following table includes jobs with positive completion receipts. Other jobs and their costs remain in the cycle totals and evidence.
One durably published job has a failure receipt. The table excludes that job, as described below.
The archive preserves the original receipt-based publication_status field names.
Producer A CPU measures one invocation. Wall time includes waits. These are separate quantities.

| Phase | Producer | Positive receipts | A CPU median, seconds | A wall seconds: min / median / max |
| --- | --- | ---: | ---: | --- |
| precondition | preparer-a | 52 | 4.013 | 8.658 / 9.180 / 13.073 |
| precondition | preparer-a-secondary | 44 | 4.034 | 8.640 / 9.380 / 16.672 |
| control | preparer-a | 7 | 3.946 | 8.126 / 9.293 / 10.425 |
| control | preparer-a-secondary | 19 | 3.993 | 8.717 / 9.446 / 12.621 |
| candidate | preparer-a | 11 | 6.377 | 13.244 / 14.354 / 19.372 |
| candidate | preparer-a-secondary | 17 | 6.316 | 13.330 / 14.356 / 21.081 |
| software-precondition | preparer-a | 21 | 4.254 | 9.181 / 10.206 / 13.313 |
| software-precondition | preparer-a-secondary | 42 | 4.277 | 8.862 / 10.124 / 23.867 |
| software-batches | preparer-a | 18 | 4.415 | 9.183 / 10.143 / 14.404 |
| software-batches | preparer-a-secondary | 19 | 4.620 | 9.624 / 10.551 / 15.338 |

The replay verifies 278 hosted setup/load and local durable-worker signatures independently. All 278 altered messages fail verification.
No retained take event assigns the same pair to different operations.
Successful operations have matching A/B take sets. Failed operations can stop after only one participant records a take.

## Provider failures and material cost

- precondition: `{"b": 3}` provider `loadShed` invocations during the exact load window.
- control: `{"b": 1, "preparer-b": 12}` provider `loadShed` invocations during the exact load window.
- candidate: `{"b": 2, "preparer-b": 9}` provider `loadShed` invocations during the exact load window.
- software-precondition: `{"b": 1, "preparer-b": 24}` provider `loadShed` invocations during the exact load window.
- software-batches: `{}` provider `loadShed` invocations during the exact load window.

The phase ledgers include 94 failed-operation pair retirements without recorded takes.
The same ID can appear in only one phase's failure bucket. Both participants confirm exact-key retirement.
This bucket measures availability loss. `Retired` combines Consumed, Burned, and wrong-key states.
A crash can hide a durable take. The evidence does not prove a physical burn or zero consumption.
Both final signing traces and incremental material stages contribute observed takes.

The original precondition has four additional registration pairs without recorded takes.
Their recorded lifetime has 11.131 seconds remaining at first absence, below the 30-second readiness requirement.
This supports loss of readiness. It does not prove physical expiry pruning or its timing.
The precondition keeps its unbalanced raw ledger and stays unqualified.
The software warm-up also has one unaccounted old pair. Its exact job deadline leaves 28.180 seconds at first absence.
This also fits readiness exclusion. It stays unaccounted in the primary ledger, and that warm-up stays unqualified.

The software warm-up records one failed producer after both participants durably publish both pairs.
Both pairs later serve one successful operation with exactly one observed take at each participant.
The protocol publishes before its final acknowledgement, flush, and peer-close waits. Those waits can still fail.
The producer maps any error from the complete run to Failed. It does not reconcile paired publication on this error path.
The interrupted-producer path already has a paired-publication check.
The exact failing final call remains unknown. The producer receipt alone does not prove that material was unavailable.
The initial analysis assertion assumed otherwise and failed. Classification: invalid analysis assumption.
The revised audit records this contradiction and preserves the failed first audit. This failure receipt does not establish that the two pairs were unusable or reused.
This terminal-accounting gap remains a priority fix before release.

The native driver's interrupted request reaches an admission decision and response_ready.
Its complete HTTP 200 Router trace has no execution_done. Ordinary status is null, with no participant execution record.
The frontend invocation returns an ok provider outcome in 522 ms. Its response body and cancellation cause remain unknown.
The failed original result stays failed.
The software driver interruption has a successful ordinary server status. Its retained signature verifies independently.
Its frontend invocation returns an ok provider outcome in 5.870 seconds.
The original client failure and latency stay unchanged. No signing mutation is repeated.
Direct front capture retains both exact forwarding invocations. Their driver-stage events are absent.
The lost-response boundary remains unknown.

## Validation and limits

Local real-Worker lifecycle checks pass for the native prototype and larger software batches.
They cover verified signatures, durable single use, restart, interrupted production, publication failure, and bounded replacement.
The native prototype also passes 42 exact ciphertext cases across three public protocol keys and seven lengths.
Distinct block indices cross the 1,024-block boundary. An independent AES calculation reproduces every retained ciphertext hash.
An injected native constructor failure reaches the Rust encryption error.
Separate-process correlation checks pass four fresh 262,144-triple pairs, shared AND results, and wrong-binding refusal.
These native binaries do not exercise the Workers-native backend.

The unchanged runtime passes the final local canonical registration/Gateway lifecycle campaign with the corrected fixtures.
The first run exposes an obsolete fixture: an Ed25519-only recovered owner expects ML-DSA signing without activation.
Classification: `obsolete_test_or_fixture`. Production authorization correctly refuses that owner.
Positive fixtures now use the exact published ML-DSA activation through the existing authority builder.
An Ed25519-only full owner directly covers refusal without ML-DSA activation.
These fixtures begin at a trusted completed-activation boundary. They do not execute QR or recovery activation ceremonies.
An intermediate local setup and hosted wallet-three recovery setup exhaust sixteen candidates.
Those failures remain failed. No failed operation is submitted again.

The public hosted AES microprobe has incomplete exact-request CPU capture: 16 of 36 invocations.
Its checksums pass. It supplies no qualified CPU speedup claim.
Wasm boundary counters exclude transient peaks, JavaScript heap, and native allocations.
Native provider erasure and constant-time behavior remain unverified. The native integration is removed.
The software buffering prototype adds about 64 KiB of guarded triple buffers. Its indices and lengths remain public.
Neither prototype changes protocol messages, cryptographic domains, stored formats, or network hops.

## Fault investigation

| Fact | Instrument | Scope | Limit |
| --- | --- | --- | --- |
| Native published producer jobs cost more CPU than control | Exact-version provider invocation records | Fresh six-minute arms, four-candidate jobs | Runtime variation prevents assigning every difference to one code path |
| Primary B fails at two stages | Most earlier failures end at crypto_started. One software warm-up failure follows both published events | Exact load-window failures | The final failing call and peak memory remain unknown |
| Secondary B differs | Per-role outcome counts | Same phase and configured capacity | No proved provider placement or resource cause |
| Failed signing can retire more material than recorded takes | Exact claimed inventory, release milestone, both-role inspection | Retained failed requests | Consumed versus Burned remains hidden |
| Original four-pair readiness loss fits the margin | Recomputed registration IDs and signed expiry receipts | First precondition | No explicit retirement cause |

| Candidate cause | Evidence | Status |
| --- | --- | --- |
| AES regrouping changes ciphertext | 42 exact hashes and complete protocol signatures verify | Contradicted in tested cases |
| Native errors silently fall back | Injected failure reaches Rust | Contradicted in tested path |
| Larger pools or longer retention explain a gain | Capacity and expiry remain fixed | Excluded by configuration |
| Missing ML-DSA owner activation explains the first local Gateway failure | Explicit activation passes; Ed-only owner still fails | Confirmed fixture defect |
| Provider memory pressure causes loadShed | Boundary sizes also occur in successful jobs and omit peaks | Possible, unproved |
| Provider scheduling or isolate reuse explains role asymmetry | Primary/secondary outcomes differ | Possible, unproved |
| Benchmark interruption hides a successful native signature | Null ordinary status and no recorded execution | No successful signature can be credited |

The native microprobe gain from the previous campaign does not establish a private protocol gain.
This campaign rejects that extrapolation. It also withdraws the stronger claim that Retired proves a physical burn.
Further failure diagnosis needs inner correlation-stage timing and peak allocation data tied to exact invocation IDs.
First, reconcile completed durable publication before classifying a producer error. Validate this with a lost-completion E2E scenario.
Changing consumption, failure settlement, or reservation granularity needs a separate security review and lifecycle qualification.

## Reproduction and cleanup

The evidence archive retains raw public role traces, versions, source hashes, failed runs, local artifacts, and both rejected prototype sources.
`python3 replay.py` reproduces verification, profiles, stock accounting, and failure attribution without network access.
Closed captures remain stable across a 20-second interval. Unfiltered authority versions cover load through reserve restoration.
All eight temporary Workers are deleted. Independent deployment lookup confirms absence for each exact name.
Fresh credential payloads are removed. Private fixture stores remain outside the archive.
The public archive uses an explicit whitelist and scans fresh credentials, nested role keys, and decoded variants.

The required bloat check still fails at 13,972 duplicated Rust lines against the inherited 13,754-line baseline.
This change does not raise the baseline. Formatting, syntax, and local lifecycle checks pass.

[Evidence index](../evidence/ml-dsa-65-aes-batches-20261026.json) · [Replay archive](../evidence/ml-dsa-65-aes-batches-20261026.tar.gz)
