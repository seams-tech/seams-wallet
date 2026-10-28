# ML-DSA four-wallet capacity checkpoint

The current Workers serve **38 verified signatures in ten minutes**, or **3.8 signatures/minute**.
Including observed reserve restoration gives approximately **3.78 signatures/minute**.
The four-wallet target of four to five signatures/minute remains open.

Preparation is the limiting resource in this campaign. Four-candidate jobs have a 17.1-second median checkpoint span under load.
A short idle comparison still takes 18–24 seconds per four-candidate job.
Signing load alone does not explain the slower preparation. No runtime optimization is retained from this campaign.

## Scope and fixed policy

Eight approved temporary Workers run the selected software implementation.
Four distinct synthetic wallets complete creation, wallet-seed recovery, and standard-signature checks before load starts.
Every wallet starts with thirty-two candidates, represented by sixteen independently consumable pairs.

The test retains these settings:

- Two candidates consumed per attempt group.
- Four-candidate preparation groups, with bounded two-candidate replacements when one pair of capacity is free.
- Sixteen-candidate admission minimum and thirty-two-candidate capacity per wallet.
- Sixty-second wallet cooldown and one service-wide active signing operation.
- Two experimental preparation slots. The production one-slot default remains unchanged.
- Wallet-seed recovery, canonical FIPS export, separate participant custody, and the passive execution model.

The durable load driver maintains one outstanding demand per wallet.
It schedules the next demand sixty seconds after the preceding demand starts, or after that demand finishes if it takes longer.
Four wallets therefore have a theoretical ceiling of four admitted operations/minute under this policy.
A five-signature/minute test requires a separately identified shorter benchmark cooldown.

The load path runs inside Cloudflare through the forwarding front Worker, ML-DSA Router, and participants.
It excludes the public SDK, login, human approval, client network, and NEAR finality.
These results do not establish public SDK signing latency.

## Signing and waiting

| Measurement | Result |
| --- | ---: |
| Verified signatures | 38 |
| Per-wallet successes | 8 / 10 / 10 / 10 |
| Window throughput | 3.80 signatures/minute |
| Throughput including observed reserve restoration | Approximately 3.78 signatures/minute |
| Final successful Router call, excluding earlier waits | Median 0.831 s; p95 3.906 s; maximum 4.923 s |
| Same-operation wait, including unavailable responses | Median 14.743 s; p95 61.122 s; maximum 113.041 s |
| Complete successful demand, including failed-operation retry | Median 14.743 s; p95 61.122 s; maximum 164.189 s |
| Demand unfinished at the cutoff | One, waiting at least 13.697 s |

All thirty-eight final successful calls take less than five seconds.
This is the final-call boundary. Earlier cooldown, capacity, and empty-pool waits remain in the operation and demand measurements.
For example, one operation spans 113.041 seconds across fifty-two requests before its final 464 ms successful call.
The successful-demand statistics exclude the unfinished demand. Its lower bound remains in the evidence.
The reported p95 values describe this small cohort, not a production service guarantee.

The driver receives 165 cooldown responses, eleven service-capacity responses, and sixty-nine empty-pool responses.
The empty-pool responses affect two demands on one wallet. Their recorded retry delays total sixty-nine seconds.
Response counts are polling counts, rather than separate admitted operations.

One operation exhausts twenty candidates without a signature. Its cost remains in the totals.
The same wallet's first successful operation consumes thirty candidates.
These rejection tails account for substantial material demand and demonstrate why a ready pool needs reserve capacity.

## Preparation and material accounting

Seventy preparation jobs complete during the load and restoration cycle.
Fifty-one jobs publish four candidates. Nineteen bounded replacements publish two candidates.
Their total output is 242 candidates, exactly matching consumption.

| Four-candidate measurement | Result |
| --- | ---: |
| Controller-to-paired-publication checkpoint span | Median 17.054 s; p95 21.244 s; maximum 21.784 s |
| Primary A / B invocation CPU medians | 7.826 / 8.292 s |
| Secondary A / B invocation CPU medians | 8.513 / 8.713 s |
| Primary / secondary A invocation wall medians | 17.206 / 18.188 s |

Cross-actor checkpoint clocks have limited precision. Treat the publication span as an approximate checkpoint measurement.
It is distinct from exact dispatch latency or a standalone CPU measurement.

Within the same A producer, the median span from `crypto_started` to `correlations_completed` is 15.574 seconds.
The following span to `crypto_completed` is 747 milliseconds.
These wall spans include work and waits. They do not isolate correlation CPU.
Correlation generation creates the paired secret randomness used by the two-party computation.
These measurements identify it as the next stage to investigate.

The complete ledger balances:

| Material | Pairs | Candidates |
| --- | ---: | ---: |
| Initial reserve across four wallets | 64 | 128 |
| Fresh paired publications | 121 | 242 |
| Consumed by successful operations | 111 | 222 |
| Consumed by the failed operation | 10 | 20 |
| Final reserve across four wallets | 64 | 128 |

All initial pairs are consumed. Successful and failed operations also consume fifty-seven fresh pairs.
No material ID is taken by two operation IDs. Both participants agree on takes for every verified signature.
No consumed material returns to the final reserve. No published material is unexplained.
This complete replacement cycle prevents initial stock from hiding the preparation cost.

Consumption averages **6.37 candidates per verified signature**, including the failed operation.
The cycle captures 1,092.319 seconds of invocation CPU, or 28.75 CPU seconds per verified signature.
This sum includes both participants, online signing, controllers, and failed work in captured protocol Workers.
It excludes the benchmark front/driver/collector CPU and external client CPU. It is not a billing estimate.

All seventy refill completion receipts report publication success.
The measured cycle contains 7,143 `ok` invocations and seventy-one `canceled` invocations.
It contains no recorded exception, load shedding, or truncated trace.
Canceled control or alarm invocations remain in the capture and CPU totals.

## Restoration measurement and its limit

The external closing inventory read starts about 390 seconds after the load window ends.
It immediately finds full reserves. That observer delay is excluded from reported preparation time.

The archive also contains earlier inventories from the Workers themselves.
For each wallet, the analysis selects the first inventory after its last terminal operation that matches the exact final IDs.
Every selected inventory has sixteen ready pairs at A and B, with zero reserved pairs.
The last such observation occurs approximately 3.5 seconds after the window ends.
No later conflicting inventory or take appears before external confirmation.
All driver requests are terminal or unavailable; no nonterminal admitted operation remains.

An independent reviewer reproduces these observations and the approximately 3.78-signature/minute complete-cycle result.
Cross-actor clocks limit millisecond precision. The raw late external read remains in the evidence.
A future comparison should start its closing observer with the load driver, so an external observation is available immediately after drain.

## Idle comparison

The same Workers then replace four fresh four-candidate groups without signing load.
The test deliberately retires sixteen unused candidates and verifies sixteen fresh replacements.
This benchmark waste is separate from the sustained-cycle ledger and throughput denominator.
Pool capacity, policy, binaries, and deployed versions remain unchanged.

| Case | A / B CPU | A invocation wall |
| --- | ---: | ---: |
| Isolated first wallet, primary | 8.398 / 8.729 s | 18.705 s |
| Isolated second wallet, primary | 10.955 / 11.778 s | 24.025 s |
| Two idle wallets, primary | 8.330 / 8.558 s | 17.887 s |
| Two idle wallets, secondary | 7.805 / 8.307 s | 17.501 s |

All four replacements publish matching fresh IDs at both participants. No signing trace overlaps these controls.
These small controls show that signing load alone does not explain the slow preparation.
They do not identify placement, host contention, runtime scheduling, or compiler behavior as its cause.

The participant Wasm files are byte-identical to the preceding hosted baseline.
That campaign's quiet four-candidate medians were near ten seconds.
The old campaign used compatibility date `2026-10-25`; this campaign uses the checked-in date `2026-06-12`.
Date, deployment conditions, and workload were not varied independently. No causal date or platform claim follows from that comparison.

## Registration and recovery

All four wallets reproduce their canonical public key through wallet-seed recovery.
Eight creation/recovery calls have a 5.953-second median and a 5.078–9.339-second range.
Seven of eight calls fall within the five-to-seven-second target.
Eight setup signatures pass independent standard verification.

Generic registration preparation is a separate setup cost: 49.546–98.460 seconds, with a 75.173-second median.
The online figures start with this material ready. They do not include an empty generic pool.
Recovery and ordinary FIPS seed/key semantics remain unchanged.

The full pre-control capture retains 162 exception outcomes outside the measured load/restoration cycle.
Setup includes deliberate refusal checks and recovery transitions. This campaign does not determine every exception's cause.
The report therefore limits the clean-refill claim to the measured cycle.

## Facts, causes, and next work

| Hypothesis | Evidence | Result |
| --- | --- | --- |
| Failed preparation wastes the measured reserve | All seventy jobs publish; both ledgers balance | Unsupported in this cycle |
| Initial stock explains the throughput | All 128 initial candidates are consumed; full reserves are restored | Rejected |
| Signing load alone doubles preparation cost | Idle jobs remain slow and variable | Rejected as the sole explanation |
| A changed participant binary explains the older/fresh difference | Wasm hashes match the earlier hosted baseline | Rejected |
| Earlier unavailable responses can be omitted from user latency | One operation waits 113 s before a 464 ms final call | Rejected |
| Compatibility settings or execution conditions explain the difference | They were not independently controlled | Unresolved |

The next high-impact work is a matched CPU calibration inside the producer execution environment.
It should distinguish slow execution from extra correlation work before another inner-loop rewrite.
Then compare the identified runtime or correlation change with the same binaries, group sizes, and complete material accounting where applicable.
Keep the sixty-second policy for operational capacity qualification. Defer the forty-five-second profile until sustainable preparation improves.
Public SDK latency and the registration outlier still require their own timing boundaries.

All eight temporary Workers are deleted. Independent absence checks pass for every Worker.
No production route, admission default, pool capacity, recovery rule, or export format changes.
No production code is modified in this checkpoint.

[Replayable evidence](../evidence/ml-dsa-65-four-wallet-capacity-20261028.json) includes raw requests, signatures, complete provider captures, versions, ledgers, controls, and cleanup receipts.

The required bloat check retains its inherited Rust duplication failure: 13,992 lines against the 13,754-line baseline.
This checkpoint adds no production Rust lines and does not change the baseline.
