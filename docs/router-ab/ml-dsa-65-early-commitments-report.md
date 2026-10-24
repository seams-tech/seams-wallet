# Earlier ML-DSA key-bound commitments

Date: October 24, 2026. Source parent: `31cf1379`. Branch: `ml-dsa`.

Keep the current runtime. Sequential early commitments miss the five-second registration target.
The prototype moves private work from signing into registration and produces standard signatures.
Its prepared registration takes 9.968 and 15.992 seconds.
The patch is archived and removed from the active source.

## Tested change

Initial registration stock is key-independent before a wallet arrives.
The prototype first derives the canonical key, then commits all eight initial pairs to that public key and epoch.
It publishes participant results only after committed stock persists.
The current role Workers continue to execute signing.
Refill already makes key-bound commitments, so its protocol remains unchanged.

Each pair contains two candidates. The existing private commitment step needs public key data and fresh nonce shares.
Long-term signing shares do not enter that step.
Online signing removes 113 Boolean AND layers from each generic pair: 327 layers become 214.
An AND layer requires a private protocol exchange. It is separate from the number of AND gates.
Captured frame counters reproduce these counts and show which material each operation consumes.

Registration commits eight pairs sequentially, adding 904 AND layers per participant.
Each pair also requires a committed input-burn transaction and a committed output-publication transaction.
Opening, restoring, resealing, and storing material occur between those boundaries.
The experiment tests this sequential scheduling choice. It does not establish the cost of a batched commitment protocol.

## Fixed requirements

Wallet-seed recovery and ordinary FIPS seed/key export remain unchanged.
Canonical public keys match across both hosted arms and recovery.
The passive, honest-execution privacy model and private commitments remain unchanged.
No cryptographic primitive, circuit, sampler rule, or security assumption changes.
This focused lifecycle review does not complete the release security review.

Preparation remains on Workers. Four candidates are prepared together and two are consumed per pair.
Capacity stays at thirty-two candidates. Admission requires sixteen ready candidates.
The hosted policy keeps one active signing operation, a sixty-second wallet cooldown, and a thirty-second signing deadline.
GPU and UI work remain deferred.

## Hosted results

| Arm | Registration: create / recovery, s | Successful signing range, s | Signatures below 5 s | Consumed pairs |
| --- | --- | --- | --- | --- |
| Control | 4.916 / 5.818 | 2.383–6.790 | 4/6 | 17 |
| Candidate | 9.968 / 15.992 | 2.272–8.640 | 4/6 | 17 |

Each arm uses two prepared ceremonies and four later recovered-key signing requests.
Signatures verify with independent OpenSSL verification.
Cooldown scheduling is outside each signing timer.
Rejection sampling changes the consumed-pair count, so the signing ranges are not a controlled causal estimate of a speedup.
Every hosted signing operation has complete A/B traces, correlated by its public operation identifier.

| Arm | Epoch | Initial preparation, s | First signature, s | Registration + first signature, s |
| --- | --- | --- | --- | --- |
| Control | 1 | 65.889 | 6.790 | 11.706 |
| Control | 2 | 97.346 | 4.768 | 10.586 |
| Candidate | 1 | 97.709 | 4.532 | 14.500 |
| Candidate | 2 | 94.397 | 3.766 | 19.758 |

Registration starts after key-independent material is ready. It includes client verification of the custody result.
Signing ends after the HTTP response body is decoded. Independent signature verification follows that timer.
Public login, browser UI, transaction submission, and NEAR finality are outside these timers.
Initial preparation includes key-generation material and sixteen signing candidates. It is not a four-candidate refill measurement.
An empty pool still adds preparation or queue wait. This experiment establishes no preparation throughput gain.

Both arms consume seventeen pairs across six signatures: 5.67 burned candidates per successful signature in this sample.
Their per-request counts differ. The candidate's five-pair requests take 4.532 and 8.640 seconds.
Its one-pair requests take 2.272 and 3.924 seconds.
This variation prevents a fixed latency estimate per pair.

## Where the added time appears

| Ceremony | A commitment interval, s | B commitment interval, s |
| --- | --- | --- |
| Create | 4.357 | 4.900 |
| Recovery | 10.491 | 11.130 |

These Worker-clock intervals include computation, peer waits, serialization, and storage waits.
Whole registration execution invocations report 1.411–3.868 seconds of CPU and 7.799–13.151 seconds of wall time.
Those provider totals cannot partition CPU within the commitment interval.
Zero-valued table-read clocks do not establish zero table cost.
Local workerd observes about 0.36 seconds for the first eight-pair commitment phase.
Local tests overlap other work and serve as functional evidence.
They do not predict hosted latency.

Across captured role/pair intervals, median activation is 225 ms for control generic stock.
It is 20.5 ms for control committed stock and 20 ms for candidate committed stock.
Candidate private-check intervals still take 628 ms median, with a 318–1,101 ms range.
These are elapsed intervals with waits. They do not isolate cryptographic CPU cost.
The remaining check and request costs require further profiling.

## Safety and recovery checks

In the tested prototype, the input transaction erases source chunks and marks the pair `Committing` before private state opens.
An interrupted pair cannot resume from that state.
Output publication requires the live consumed preparation and the original claim deadline.
Installation accepts only `Committed` stock.
A final transaction checks the same live preparation before publishing role material and its cached result.
Prototype online execution burns and refuses generic stock before private activation.

Six native canonical-key cases pass.
The native durable lifecycle isolates one generic pair, burns it, and requires the exact committed-only refusal.
Only one thirty-two-byte public execution-binding message passes each way before refusal.
Later committed operations still produce signatures and preserve replay, duplicate, and consumption-ledger checks.

The real-Worker retirement test holds B's output after input consumption, retires preparation while the claim is live, then releases publication.
Late output fails. The first source chunk stays absent, no B result or role material publishes, and restart preserves failure.
A fresh job then completes canonical creation and recovery.
This checks usability after retirement. It does not prove immediate physical deletion of every ciphertext chunk.
Interruptions before computation and after all stock commits remain separate coverage gaps.

The delivery test passes atomic two-pair rollback, lost acknowledgements, concurrent exact replay, restart, and refusal after the claim ends.
The full Gateway campaign passes canonical recovery, device signing, participant restoration, and standard transaction-signature checks.

One original retirement campaign passes its retirement checks and both canonical ceremonies, then fails Gateway migration.
Its runner copied the live normal campaign's entire wallet directory, including an initialized database.
The delivery-only copied fixture also contains that database despite skipping Gateway migration.
The failed artifact stays archived and remains classified as an environment failure.
A key-only fixture repeat passes without production or binary changes.
The independent review supports this classification. Exact contents of the deleted failed database remain unavailable.

The offline verifier rechecks 22 retained HTTP/transaction signatures and rejects altered messages.

## Facts and competing explanations

| Fact | Instrument | Check |
| --- | --- | --- |
| Prepared registration misses five seconds | Client timer and canonical-result verification | Both prototype ceremonies complete and preserve the key |
| Early commitments add a long registration phase | Correlated A/B stage marks | Both roles capture the new non-zero interval |
| Online work loses the commitment circuit | Frame counters and restored topology counts | 327 versus 214 AND layers per pair |
| Capacity and recovery policy stay fixed | Frozen configurations and ordinary-library checks | Same policy and canonical keys across both arms |
| Original retirement campaign fails in database setup | Preserved artifact, read-only copied-DB inspection, independent review | Fresh key-only repeat passes |

| Explanation | Evidence | Status |
| --- | --- | --- |
| Sequential front-loading delays registration | Eight commitment calls and the measured added phase | Supported for this prototype |
| A changed key or pool size explains the result | Canonical keys and fixed policy match | Contradicted |
| Earlier commitments guarantee fast complete signing | Candidate signing still exceeds five seconds | Contradicted |
| A specific network, storage, or CPU cause explains the long phase | Whole-invocation totals do not isolate these costs | Unresolved |
| Placement, cold execution, cache state, or rejection counts affect the comparison | Sequential deployments do not control them | Remain possible |

## Decision and next experiments

Remove the tested runtime, storage-format, native-fixture, and fault-flag changes.
Keep the replayable patch and evidence. The current preparation format and signing behavior remain selected.
The prototype changes private registration messages and advances the stock sealing domain to v3.
Fresh test namespaces do not establish mixed-version or existing-record compatibility.
Any future adoption needs coordinated preparation retirement and regeneration before release.

The next commitment experiment should reduce serial exchanges across the same eight independently consumable pairs.
Keep each pair's single-use identity, durable burn, and private commitment output.
Measure full registration plus first signing, including added persistence cost.
A separate binary-delivery experiment can test per-pair material loading in the current role Workers.
Neither experiment requires a larger pool or a new recovery format.
Cold/warm tails, sustained refill, multi-wallet capacity, intermittent storage failures, and release security review remain open.

## Reproduce and inspect

The [summary](../evidence/ml-dsa-65-early-commitments-20261024.json) records build hashes, policy, verification, and cleanup.
The [compressed archive](../evidence/ml-dsa-65-early-commitments-20261024-data.json.gz) contains the exact patch, sanitized traces, failures, scripts, and configurations.
Raw provider tails, credentials, role wrapping keys, and account identifiers are excluded.
Both arms reuse the same six approved Worker destinations and exact approved credential payloads.
All six Workers are deleted after each arm.
Sequential fresh deployments do not control placement, provider load, tiering, or cache state.
This bounded screen establishes no sustained capacity or five-second guarantee.

Extract `scripts["verify.py"]` from the gzip JSON, then run it against the archive with Python and an ML-DSA-capable Node runtime.
The tested Node runtime is v26.4.0.
The bloat check retains its inherited failure: 13,972 duplicated Rust lines against a 13,754 baseline.
The baseline is unchanged.
