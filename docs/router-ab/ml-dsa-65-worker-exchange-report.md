# ML-DSA preparation and Worker exchange investigation

Both runtime prototypes were removed because matched tests show no clear speed gain.
The retained implementation keeps its existing correlation consumption and role-ordered transport.
Consistent signing below five seconds remains unqualified.
The [evidence summary](../evidence/ml-dsa-65-worker-exchange-20261022.json) records all six hosted screens.

The retained fix improves material accounting. Complete participant traces now establish consumed material for failed terminal operations.
Signature verification remains a separate fact. Missing failure reasons remain unknown.
Wallet-seed recovery, canonical FIPS export, and pool capacity remain unchanged.

## Hosted comparison

The final comparison reuses the same two wallet keys, namespaces, storage, and Router.
Only the four participant builds change between the control and the exchange prototype.
Both wallets start and finish with thirty-two candidates each. Admission requires sixteen ready candidates.
Preparation creates four candidates. Signing consumes two candidates at a time.
One signing operation and one preparation producer can run at a time.
The saturation fixture uses a one-second cooldown. The production default remains sixty seconds.

| Measurement | Existing transport | Send-first prototype |
| --- | ---: | ---: |
| Verified signatures | 14 | 17 |
| Successful HTTP calls below five seconds | 11/14 | 15/17 |
| Successful HTTP median | 2.800 s | 3.175 s |
| Successful HTTP range | 1.163–10.213 s | 1.078–8.561 s |
| Four-candidate preparation median | 9.868 s | 10.111 s |
| Four-candidate preparation range | 9.089–13.210 s | 9.671–13.195 s |
| Captured producer time per verified signature | 15.577 s | 14.552 s |
| Successful demand median, including waits | 10.062 s | 20.734 s |
| Maximum successful demand | 128.249 s | 46.213 s |

Captured producer time includes the load and full reserve restoration. Its attribution remains incomplete.
Different rejection outcomes affect material consumption. Sequential deployments and uncontrolled placement prevent causal speedup claims.
Both final screens reach the NRT ingress. This does not establish identical internal Worker placement.
Earlier screens include NRT/PDX routing changes.

These are private Worker protocol measurements with synthetic Gateway admission.
They exclude the public browser SDK, human authentication, enrollment, NEAR submission, and finality.
Product timing parity is not established. Registration was not requalified with the exchange prototype.

## Rejected prototypes

The bulk-consumption prototype borrowed bounded correlation chunks and erased consumed chunks together.
Its isolated local reserve means were 38.089 seconds for the control and 37.607 seconds for the prototype.
That difference is smaller than the observer's one-second polling interval.
The fresh hosted deployments appeared to halve preparation time. A repeat contradicted that attribution.

| Four-candidate preparation median | Existing consumption | Bulk consumption |
| --- | ---: | ---: |
| Fresh deployments | 18.004 s | 9.991 s |
| Same logical deployment, preparers replaced | 10.396 s | 9.865 s |

The twofold source-attributed gain is withdrawn. The bulk code is archived in the provenance bundle.

The exchange prototype let both Workers send an independent masked message before receiving the peer's message.
Blocking native transports retained role ordering. Received buffers stayed protected by automatic erasure across waits and failures.
Bounded passive-model review found no blocking privacy or deadlock issue.
The native mixed batch passes all 105 cases. Six key-generation cases preserve the canonical FIPS key.
The local Worker campaign passes standard signatures, restart, replay, stalled peers, interrupted publication, and producer handoff.
Those correctness results do not establish a latency gain. The exchange code is also archived and removed.

## Facts and remaining causes

| Fact | Instrument and scope | Check |
| --- | --- | --- |
| All 132 hosted signatures verify | Independent Node/OpenSSL pass over six clients | Altered messages and signatures are rejected |
| Fresh-deployment preparation differences do not repeat at the same scale | Exact-version job records and isolated local controls | Four-candidate medians above |
| Both slow exchange results include server work | Matched HTTP, Router, and participant traces | Client 7.031/8.561 s; Router 6.546/7.713 s; A 4.754/7.065 s |
| Both slow results close normally | Participant socket records | Completed peer close and code 1000 |
| Complete role traces send 340 online data frames per checked pair | Online-to-Output frame counters in 57 traces | Eight pairs produce 2,720 frames per role |
| The control has a 5.987-second pre-send observation | Node HTTP diagnostic events | No task build or upload overlaps the load |

The phase counters exclude acknowledgements. The GMW evaluator exchanges one message per nonempty dependent AND layer.
GMW is the Boolean secure-computation engine used for these checks.
Dependent layers must finish in order. Fewer dependent layers are the next circuit optimization to evaluate.
The frame count establishes communication depth. It does not assign elapsed time to the network.

| Candidate cause | Supporting facts | Limitation or contradiction | Assessment |
| --- | --- | --- | --- |
| Per-gate correlation consumption explains the apparent twofold gain | Fresh deployments differ | Repeated control approaches the prototype; isolated local difference is small | Removed as that gain's cause |
| Ordered exchange is the main signing bottleneck | Independent messages were sent in sequence | Sending both first shows no overall gain | Unconfirmed; prototype removed |
| Rejection count and dependent circuit layers contribute to long signing | Slow requests consume four and eight pairs | Invocation time also includes material loading and other work | Measure lower-depth equivalent circuits next |
| Node request dispatch explains all slow results | Pre-send observations reach seconds | Slow exchange results also have long server invocations | Explains only a possible probe component |
| Protocol deadlock or failed socket closure explains the slow successes | Would fit long requests | Valid results and clean completion contradict it | Removed for these successes |
| Runtime allocation, placement, and storage waits vary | CPU/wall and routing observations vary | Internal placement and physical stage costs are unobserved | Remain unresolved |

Hosted service clocks advance at I/O boundaries. Their spans cannot separate CPU, storage, serialization, and network time.
Cloudflare service telemetry would be needed to distinguish hidden placement and runtime allocation.
Browser measurements must establish whether Node dispatch observations also occur through the public SDK.

## Accounting corrections and limits

The first baseline has matching completed participant traces for a failed operation that checked eight pairs.
Its identified consumption therefore rises from seventy-five to eighty-three groups.
The summary preserves the unknown terminal outcome. It does not mark this operation signed.
Two consumed groups lack sampled paired-inventory observations, so that ledger remains incomplete.

The final control has thirty inferred starting groups, while its initial snapshots contain thirty-two paired groups.
Its initial-identity flag is false. Post-stock throughput is correctly withheld.
One successful control operation lacks complete peer traces.

The exchange prototype's identity ledger balances thirty-two initial groups plus forty-eight fresh groups against forty-eight consumed and thirty-two final groups.
Each group contains two candidates. No captured event shows reuse across different operations.
Two successful operations still lack complete peer traces. Identity balance and trace coverage remain separate claims.
Unattributed canceled producer alarms retain their captured costs and incomplete-attribution flag.

The earlier bulk prototype's local registration campaign preserves the canonical key, then exhausts sixteen candidates during a recovery signing check.
Its functional result remains failed. The evidence retains this stochastic exhaustion.

## Evidence and repeat

- [Hosted clients, sanitized traces, versions, and stock records](../evidence/ml-dsa-65-worker-exchange-20261022-hosted.json.gz)
- [Native checks, local Worker campaigns, and CPU profiles](../evidence/ml-dsa-65-worker-exchange-20261022-local.json.gz)
- [Prototype source, patches, scripts, and review scope](../evidence/ml-dsa-65-worker-exchange-20261022-provenance.json.gz)

The bundles map each input path to its content and SHA-256 digest.
Recompute material joins with `summarize_preparation_coverage.py` and `summarize_candidate_groups.py`.
Recompute HTTP joins with `summarize_http_timing.py`.
The provenance includes the hosted runners, independent verification, packaging, and communication-depth derivation.
Raw tails and credentials are excluded. All ten temporary Workers are deleted.

The existing bloat gate still reports 13,988 duplicated Rust lines against the 13,754 baseline.
This investigation leaves that baseline unchanged.

Next, compare equivalent circuits with fewer dependent AND layers and measure complete preparation cost.
Then repeat the public SDK workload with production cooldown and measure material activation and client dispatch separately.
Keep wallet-seed recovery, FIPS export, Workers preparation, two-candidate consumption, and existing capacity.
GPU work and UI changes remain deferred.
