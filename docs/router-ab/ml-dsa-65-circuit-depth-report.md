# ML-DSA signing circuit depth investigation

The retained change reduces dependent online exchanges from 340 to 327 per candidate pair.
It preserves the AND count, private outputs, wallet-seed recovery, and canonical FIPS seed/key export.
Consistent signing below five seconds remains unqualified.
The hosted screen also fails its minimum-success requirement for one wallet.
The [evidence summary](../evidence/ml-dsa-65-circuit-depth-20261022.json) preserves these negative results.

## Retained implementation

The secret-value comparison now groups consecutive equal bits of its public constant bound.
Each group uses a balanced AND tree before it combines with the lower-bit comparison.
The generator branches only on public bounds, widths, and circuit structure.
Secret wire values never control those branches.

| Compiled component | Previous | Retained |
| --- | ---: | ---: |
| Response-check dependent AND layers | 55 | 42 |
| Low-response-check dependent AND layers | 55 | 42 |
| AND gates per response or low-response polynomial | 28,415 | 28,415 |
| Response-check schedule bytes | 808,252 | 629,052 |
| Low-response-check schedule bytes | 802,876 | 630,844 |
| Activation plus signing layers per pair | 340 | 327 |
| Activation plus signing ANDs per candidate | 884,287 | 884,287 |

GMW is the Boolean secure-computation engine used here.
Each dependent AND layer requires the preceding layer's result.
The complete path has 113 commitment-activation layers, 168 hash layers, 42 bound-check layers, and four decision layers.
The message-bound work therefore uses 214 layers. Activation adds another 113.
The native evidence check now enforces a 214-layer message-bound budget.
The previous exact-227 assertion was a valid test update for the intended reduction.

Four compiled components change: response, low-response, row, and aggregate checks.
All key-generation circuits remain byte-identical.
Neither the transport nor the disclosure boundary changes.
Commitments remain private until both private bounds pass.

## Correctness and review

Four universal equivalence checks compare the complete previous and retained circuit outputs.
They cover every input bit without assuming canonical residues.
All four return UNSAT: no input makes the output vectors differ.
A deliberately complemented output returns SAT, which checks that the instrument detects a difference.
The first row-check solver strategy times out. The Boolean strategy then proves that same circuit equivalent.
The evidence retains both outcomes and verifies every authoritative query and circuit digest.

The native campaign passes six canonical-key cases and the complete prepared signing lifecycle.
The mixed GMW campaign passes 105 instances per participant.
The local Worker E2E passes standard signatures, empty-pool retry, restart, replay, interrupted publication, producer handoff, and stalled-peer closure.
Independent review finds no blocker within this bounded source and evidence review.
These checks preserve the reference behavior. They do not complete the protocol composition audit.
Native timings overlapped builds and solver work, so they support correctness only.

## Hosted results

The screen uses separate Router, signing A/B, and preparation A/B Workers.
It prepares four candidates together and consumes two at a time.
Each wallet retains a thirty-two-candidate cap and a sixteen-candidate admission minimum.
One signing operation and one preparation producer can run at a time.
The saturation fixture uses a one-second cooldown. The production default remains sixty seconds.

| Measurement | Result |
| --- | ---: |
| Verified load signatures | 10 |
| Successful HTTP calls below five seconds | 6/10 |
| Successful HTTP median | 3.265 s |
| Successful HTTP range | 1.410–5.823 s |
| Successful demand median, including waits | 16.251 s |
| Maximum successful demand | 115.801 s |
| Four-candidate producer invocation median | 10.425 s |
| Four-candidate producer invocation range | 9.614–12.655 s |
| Captured producer time per verified load signature | 22.522 s |

The screen lasts 180 seconds. It requires four successes per wallet.
The wallets complete eight and two successes, so `functionalPassed` remains false.
One admitted operation rejects all fourteen available pairs, consuming twenty-eight candidates in 13.977 seconds.
The driver then retries the logical demand with a fresh operation.
There are 158 empty-pool replies and one service-capacity reply.
Two demands remain unfinished at cutoff. Their observed waits are 59.544 and 49.820 seconds.
No correctness regression is demonstrated, and no test criterion was relaxed to pass this screen.

Creation and recovery each preserve the ordinary canonical key:

| Wallet | Prepared creation | Prepared recovery |
| --- | ---: | ---: |
| First | 7.117 s | 7.639 s |
| Second | 6.237 s | 6.818 s |

These registration times include client verification and exclude initial preparation.
Initial preparation takes 71.443–85.990 seconds across the four ceremonies.
The four initial-stock signatures take 3.280–7.673 seconds. Three finish below five seconds.
All fourteen hosted signatures pass a separate Node/OpenSSL verification pass.
All altered-message and altered-signature controls are rejected.

The material ledger balances thirty-two initial groups plus forty-two fresh groups against forty-two consumed and thirty-two final groups.
Each group contains two candidates. Both wallets restore their original thirty-two-candidate reserves.
No captured consumption reuses material across different operations. Complete participant traces cover every consumed operation.
Preparation cost attribution remains incomplete because canceled producer alarms remain unidentified.
The captured cost includes the exhausted operation and reserve restoration. It is not a population cost estimate.
The common post-stock window lasts only 59.594 seconds and completes one signature. It does not qualify sustained capacity.

These measurements use private Worker protocol routes and synthetic Gateway authority.
They exclude the public browser SDK, human authentication, enrollment, NEAR submission, and finality.
Product timing parity is not established.
There is no new matched hosted control, so the screen establishes no causal wall-time speedup.

## Facts and remaining causes

| Fact | Instrument and scope | Check |
| --- | --- | --- |
| The comparator preserves all declared outputs | Complete compiled-circuit Boolean miters | Four UNSAT results and one altered-output SAT control |
| The real path uses 327 online data frames per checked pair | Online-to-Output counters in thirty complete role traces | Phase depths repeat 113, 168, 42, 4; ACKs excluded |
| All fourteen hosted signatures verify | Separate Node/OpenSSL pass | Altered messages and signatures fail |
| Two slow successes include substantial Node dispatch time | Exact HTTP-attempt diagnostics | Pre-send waits of 2.877 and 2.293 s; Router invocations of 2.251 and 3.047 s |
| Two other slow successes include long server execution | Matched HTTP, Router, and participant traces | Five/six pairs; Router 5.228/5.798 s; participant A 4.780/5.447 s |
| A terminal operation exhausts fourteen pairs | Router outcome and agreeing complete participant traces | Twenty-eight candidates; no signature released |

| Candidate cause | Supporting facts | Contradiction or limit | Assessment |
| --- | --- | --- | --- |
| The new comparison changes rejection behavior | Could explain failed operations | Universal equivalence contradicts changed outputs | Removed for these compiled circuits |
| Invalid signatures explain the failed screen | Could explain a functional failure | All signatures verify; one wallet misses the success minimum | Removed |
| Client dispatch explains every slow success | Two requests contain long pre-send waits | Two others contain server invocations above five seconds | Explains only part of this probe's latency |
| Rejection count and dependent layers contribute to server latency | Five/six checked pairs and 327 sequential layers per pair | Invocation time also includes loading, activation, and other work | Remains; reduce message-independent online work next |
| Insufficient refill contributes to long complete demand | Empty-pool replies and censored demands | The short shared post-stock window cannot qualify a steady-state rate | Remains; repeat paced and sustained tests |
| Runtime placement, CPU allocation, or storage explains the remaining variation | Wall/CPU and dispatch observations vary | Physical stage costs and internal placement are unobserved | Remain unresolved |

Hosted service clocks cannot partition CPU, storage, serialization, and network time.
Browser measurements must establish whether the Node dispatch observations also occur through the SDK.
The local calibrated profile still attributes roughly 42–51% of preparation samples to private AES and 26% to matrix encoding.
Sample counts are not elapsed or billed CPU, and hosted attribution remains unproved.

## Next implementation tasks

1. The [committed-refill campaign](ml-dsa-65-committed-refill-report.md) implements key-specific commitment activation during refill.
   It removes 113 dependent online AND layers per committed pair and preserves private commitments and single-use storage.
   Its hosted screen still misses five seconds and records B-side `loadShed` outcomes. No causal wall-time gain is established.
2. Resolve initial registration stock separately. It is prepared before the public key exists, so it cannot receive key-specific commitments at that point.
   Measure key generation, stock installation, and first-sign activation separately before choosing where conversion belongs.
3. Reduce preparation AND count with an equivalent bound-check circuit. Compare total correlation cost and depth together.
   Repeat the universal circuit proofs, canonical recovery, single-use E2Es, and unchanged-capacity hosted screen before adoption.
4. Repeat the complete SDK workload with the production cooldown. Include rejection tails, exhausted operations, empty waits, and full reserve restoration.

A full prefix-arithmetic prototype lowers the path to 259 layers but raises activation/signing ANDs by 68.4%.
It was removed because that tradeoff increases the preparation burden under investigation.
The evidence also preserves the other rejected circuit variants.
GPU work and UI changes remain deferred.

## Evidence and repeat

- [Hosted clients, sanitized traces, exact versions, and reserve records](../evidence/ml-dsa-65-circuit-depth-20261022-hosted.json.gz)
- [Native and local Worker E2Es, calibrated profile, and build receipts](../evidence/ml-dsa-65-circuit-depth-20261022-local.json.gz)
- [Complete circuit inputs, proof receipts, and replay scripts](../evidence/ml-dsa-65-circuit-depth-20261022-formal.json.gz)
- [Source snapshots, rejected variants, runners, and packaging](../evidence/ml-dsa-65-circuit-depth-20261022-provenance.json.gz)

The bundles map each input path to its content and SHA-256 digest.
Use `equivalence-complete.json` for authoritative proof receipts. The earlier receipt is explicitly historical.
The proof scripts regenerate queries from the bundled baseline circuits and retained generated circuits.
The existing `export-custody-schedules` and `export-prepared-fixtures` commands regenerate the schedules.
Recompute material and HTTP joins with the existing research summarizers.
Credentials and raw tails are excluded. All five temporary Workers are deleted.
The inherited bloat gate still reports 13,988 duplicated Rust lines against the 13,754 baseline. This change leaves that baseline intact.
