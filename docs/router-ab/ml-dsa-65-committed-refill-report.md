# ML-DSA private commitment preparation during refill

Key-bound refill now completes private commitment evaluation before it publishes signing material.
This removes 113 dependent AND layers from each committed pair's signing interval.
Canonical recovery, standard FIPS seed/key export, private commitments, and pool capacity remain unchanged.
The implementation passes correctness and lifecycle checks, but the hosted five-second target fails.
Only four of seventeen final HTTP attempts finish below five seconds. Every complete logical demand exceeds five seconds.
The [evidence summary](../evidence/ml-dsa-65-committed-refill-20261022.json) retains the negative results.

## Implemented lifecycle

The core has two explicit preparation states:

- Generic registration stock contains nonce shares and unused commitment correlations. It exists before the public key.
- Committed refill contains nonce shares, private high/low commitment shares, and unused signing correlations. It is bound to one key and epoch.

Refill obtains public-key bytes in the existing authenticated `StartRefill` reply.
The reply contains no signing share. No additional service call is needed for this public input.
The computation uses the public matrix and twiddles with each participant's fresh private nonce shares.
It consumes commitment correlations before sealing the output. Committed storage omits those consumed correlations.
Each role publishes material only after its private commitment evaluation and encrypted storage finish.

Signing commits durable consumption before it decrypts or restores either state.
Committed activation checks the stored key, epoch, reservation, and candidate binding before transport.
The exact circuit set remains pinned through trusted restoration and the durable key-scope epoch digest.
The existing public `t0` exchange remains in signing. Generic registration stock still performs commitment evaluation there.
The two formats represent current lifecycle states. They have no compatibility toggle or decoder fallback.

| Per two-candidate pair | Generic stock | Committed refill |
| --- | ---: | ---: |
| Dependent online AND layers | 327 | 214 |
| Commitment layers during signing | 113 | 0 |
| Ciphertext chunks per participant | 30 | 24 |
| Commitments before private bounds pass | Private | Private |

The layer count excludes binding, input, output, acknowledgment, and control messages.
The committed path has 168 hash layers, 42 bound layers, and four decision layers.
Total circuit AND count is unchanged. The work moves into preparation.
All twenty generated circuit files remain byte-identical to the previous campaign.
The chunk comparison uses the same two-candidate width and storage chunk size.
It establishes a stored-size reduction, with no claim about peak isolate memory.

## Correctness and privacy review

The native campaign passes six canonical-key cases and eleven durable signatures.
Its durable scenario consumes two generic groups and eighteen committed groups through sealed SQLite storage and the real executor core.
Each role rejects six changed storage shapes and two wrong key/epoch cases.
The wrong key/epoch cases send no transport messages.
All thirty-four recorded native source hashes match, including the new commitment and executor files.
An earlier successful native run remains archived as a diagnostic, with its incomplete source list clearly superseded.

Both local Worker campaigns pass standard signatures, replay, empty-pool retry, stalled peers, interrupted publication, and producer handoff.
The final campaign also checks restart, completed commitments before publication, and the 214-layer signing budget.
It measures three signatures at 0.100–0.443 seconds with signing profiling enabled.
These are local diagnostics, with no hosted timing qualification.
The calibrated profiles contain only 30–132 samples each and cannot assign precise CPU fractions.

Independent review finds no new privacy or single-use blocker within this change.
No long-term signing share enters refill, and no new secret output becomes public.
Commitments remain private until both private bounds pass.
All twenty-one hosted signatures pass a separate Node/OpenSSL verification, including altered-message and altered-signature rejection.
Full protocol composition and production runtime qualification remain open.

## Hosted results

The six-minute saturation screen uses separate Router, signing A/B, and preparation A/B Workers.
Preparation creates four candidates. Signing consumes two at a time.
Each wallet keeps thirty-two candidates, with sixteen required for admission.
One signing operation and one preparation producer can run at a time.
The fixture cooldown is one second. The production default remains sixty seconds.

| Measurement | Result |
| --- | ---: |
| Verified load signatures | 17 |
| Successful final HTTP attempts below five seconds | 4/17 |
| Successful final HTTP median | 6.039 s |
| Successful final HTTP range | 1.383–20.835 s |
| Complete successful demand median | 22.048 s |
| Complete successful demand range | 5.472–156.620 s |
| Completed four-candidate producer invocation median | 14.363 s |
| Completed four-candidate producer invocation range | 11.051–17.658 s |
| Captured preparer-A invocation time per verified load signature | 24.754 s |

The wallets complete nine and eight signatures. Both meet the four-success requirement, so `functionalPassed` is true.
There are no failed terminal signing operations or client verification errors.
The client receives 282 empty-pool replies and one service-capacity reply.
Two demands remain unfinished at cutoff, with observed waits of 86.672 and 66.237 seconds.

Complete peer traces classify sixteen of seventeen successful load operations:

| Consumed material | Signatures | Below five seconds | HTTP median | HTTP range |
| --- | ---: | ---: | ---: | ---: |
| Generic only | 2 | 0 | 10.541 s | 5.672–15.411 s |
| Mixed | 2 | 0 | 15.841 s | 10.847–20.835 s |
| Committed only | 12 | 3 | 5.905 s | 1.383–12.087 s |

One successful request below five seconds lacks a completed B trace. Its state remains unclassified in this paired comparison.
The committed-only subset still misses the target. The subset establishes no causal speedup over generic stock.
Different rejection counts, runtime state, and routing remain uncontrolled.

Prepared creation and recovery also miss five seconds:

| Wallet | Creation | Recovery |
| --- | ---: | ---: |
| First | 9.890 s | 13.766 s |
| Second | 8.932 s | 12.710 s |

These times include client verification and exclude initial preparation.
Initial preparation takes 69.343–111.110 seconds. The four initial-stock signatures take 9.576–17.783 seconds.
All four ceremonies preserve the canonical key. Their initial-stock signatures use generic material.
Registration and first-use signing therefore remain separate optimization tasks.

## Preparation completion and provider outcomes

All thirty-two false producer-completion events match exact-job B-side invocations with provider outcome `loadShed`.
Twenty-eight occur during load and reserve restoration.
The label does not identify memory, CPU, scheduler pressure, or an application resource cause.
No causal source speedup or slowdown is established without a matched hosted control.

A false protocol completion does not prove that material was never published:

- Four of thirty-two jobs record complete publication at both roles, producing seven pairs.
- All seven pairs are later consumed. Five belong to starting stock and two are fresh during load.
- One of twenty-eight jobs during load/restoration completes both publications, producing those two fresh pairs.

The remaining failure stages vary. Some invocations end during cryptographic work.
Others end after encrypted publication and before normal protocol completion.
The report preserves completion status and observed publication as separate facts.
Cloudflare lists separate [memory and CPU limits](https://developers.cloudflare.com/workers/platform/limits/). This screen does not measure peak isolate memory or identify the cancellation mechanism.

Both reserves restore fully. The identity sets balance thirty-two initial groups plus forty-three fresh groups against forty-three consumed and thirty-two final groups.
Every consumed group ID is unique. No captured event establishes material reuse.
The group width remains two, so signing consumes eighty-six candidates across seventeen successes.
That sample does not replace the long-term rejection estimate.

The 24.754-second figure is captured preparer-A invocation wall time during load and full reserve restoration.
It includes captured failed work and charges each invocation once.
It is neither total two-role cost nor a complete service-cost estimate.
Four group costs and unidentified producer invocations remain unresolved.
The common post-stock window lasts 222.861 seconds and completes five signatures, or 1.346 signatures per minute.
The short window, cancellations, and incomplete costs prevent production capacity qualification.

## Facts and remaining causes

| Fact | Instrument and scope | Check |
| --- | --- | --- |
| Committed pairs skip 113 AND layers | Exact-version completed participant traces | Independent reconstruction gives 214 versus 327; non-AND traffic excluded |
| All twenty-one hosted signatures verify | Separate Node/OpenSSL pass | Altered messages and signatures fail |
| Every false producer completion matches B-side `loadShed` | Exact job IDs in raw provider outcomes and sanitized records | Thirty-two matches, including twenty-eight during load/restoration |
| Some failures occur after paired publication | Per-role publication stages and later consumption IDs | Four jobs and seven pairs; one job and two pairs during load/restoration |
| Client dispatch observations reach seconds | Exact HTTP-attempt diagnostics | Maximum pre-send interval 14.540 s |
| A committed six-pair operation has substantial server duration | Matched participant trace | A invocation 9.689 s; client 12.087 s |
| Ingress routing changes during the screen | Successful-response `CF-Ray` headers | PDX once, DFW nine times, NRT seven times |

| Candidate cause | Supporting facts | Limitation or contradiction | Assessment |
| --- | --- | --- | --- |
| Commitment activation still runs online for committed refill | Would explain unchanged depth | Complete committed traces have 214 layers and no commitment phase | Removed for those traces |
| Invalid cryptography explains producer failure | Would fit an internal error | Provider reports `loadShed`; seven post-publication pairs remain usable; all signatures verify | Unsupported; no invalid result observed |
| Client dispatch explains all slow signing | Pre-send observations reach 14.540 s | A committed six-pair invocation lasts 9.689 s | Explains only a possible probe component |
| Resource pressure or runtime cancellation disrupts refill | Exact B-side `loadShed` matches | No peak memory, scheduler, or limit diagnostics | Remains unresolved |
| Rejection count and remaining dependent layers contribute to latency | Multiple pairs repeat the 214-layer path | Whole invocations also include loading, setup, and other work | Remains |
| The change itself causes the worse aggregate latency | Current observed results are worse than the earlier screen | No matched control; ingress, runtime state, and workloads differ | Unresolved; no causal claim |

Whole invocation wall time can include post-response work. Hosted stage clocks cannot isolate CPU, storage, or network time.
Node dispatch observations do not establish browser behavior.
Ingress labels do not establish the participants' internal placement.
These are private protocol routes with synthetic Gateway authority. Public SDK timing parity is not established.

## Next implementation tasks

1. Measure Wasm memory, JavaScript allocation, and cancellation stages during preparation. Determine why the provider reports `loadShed` before changing resource limits or architecture.
   If measurements show memory pressure, evaluate a smaller preparation-only Worker build with the same two trust boundaries.
2. Reproduce dispatch delays through the public SDK and an independent HTTP client. Keep exact request IDs and separate critical-path timings from background invocation duration.
3. Optimize generic registration stock and installation. Compare batched commitment conversion after key creation against its added registration cost.
4. Reduce preparation AND count with an equivalent bound-check circuit. Retain universal equivalence checks, recovery tests, and unchanged-capacity hosted measurements.

Keep Workers preparation, wallet-seed recovery, FIPS export, two-candidate consumption, and existing capacity.
GPU research and UI changes remain deferred.

## Evidence and repeat

- [Hosted clients, sanitized traces, exact versions, state classification, and shedding joins](../evidence/ml-dsa-65-committed-refill-20261022-hosted.json.gz)
- [Native and local Worker E2Es, calibrated signing profiles, circuit digests, and build receipts](../evidence/ml-dsa-65-committed-refill-20261022-local.json.gz)
- [Final source snapshots, runners, analysis, and packaging](../evidence/ml-dsa-65-committed-refill-20261022-provenance.json.gz)

The bundles record each input's content and SHA-256 digest. Credentials and raw tails are excluded.
The collector now retains the three new commitment stages. It was rerun against the original captured tails.
All five temporary Workers are deleted.
The bloat gate reports 14,008 duplicated Rust lines, compared with 13,988 before this change and the 13,754 baseline.
The baseline remains unchanged.
