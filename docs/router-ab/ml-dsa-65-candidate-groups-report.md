# ML-DSA-65 independently consumed candidate groups

Date: 2026-10-17. Experimental private Router A/B routes.

## Hosted results

No group size meets both performance targets in this screen.
Four-candidate groups have the lowest captured producer time.
It still exceeds twenty-four seconds per successful signature.
Two-candidate groups also miss the online signing target in sixteen of seventeen successful requests.
The library default remains eight candidates. All three sizes remain experimental.

| Measurement | 8 candidates | 4 candidates | 2 candidates |
| --- | ---: | ---: | ---: |
| Verified signatures during ten-minute load | 20 | 24 | 17 |
| Successful HTTP minimum / median / maximum | 1.149 / 1.330 / 4.301 s | 1.063 / 1.306 / 3.681 s | 4.192 / 9.052 / 25.207 s |
| Successful HTTP requests below five seconds | 20/20 | 24/24 | 1/17 |
| Admitted operations that exhausted their material | 0 | 1 | 1 |
| Consumed groups, including failed operations | 24 | 44 | 63 |
| Consumed candidates per verified signature | 9.600 | 7.333 | 7.412 |
| Matched producer invocation median per completed group | 22.196 s | 11.070 s | 10.596 s |
| Captured producer invocation time per verified signature | 32.841 s | 24.840 s | 35.449 s |
| Complete load-and-restoration cycle per verified signature | 39.916 s | 32.594 s | 59.773 s |
| Full reserve restoration after load | 198.278 s | 182.208 s | 416.144 s |
| Successful signatures per minute after starting stock depletion | 1.549 | 1.618 | 1.137 |

Captured producer time includes failed and recovery invocations on participant A.
Its accounting remains incomplete. Each profile lacks one final group's completion record.
Even the captured producer time exceeds ten seconds per verified signature.
The complete cycle also includes online signing, queue waits, and reserve restoration.
It measures this service configuration's output rate.

The four-candidate failure exhausted four groups, or sixteen candidates.
Its demand remained unfinished at the cutoff. Its consumed material is included above.
An interim claim that its retry succeeded is withdrawn.
The two-candidate failure exhausted eight groups, also sixteen candidates. Its demand also remained unfinished at the cutoff.
All successful eight- and four-candidate responses stayed below five seconds, while admission and refill waits remained much longer.
The four-candidate screen does not establish uninterrupted sub-five-second signing.

The complete successful demand maxima are 126.984, 166.569, and 165.318 seconds for groups of eight, four, and two.
These include admission and empty-pool retries. Unfinished demands at the cutoff remain separate.

Material identities balance in every profile: `8 + 24 = 24 + 8`, `16 + 44 = 44 + 16`, and `32 + 63 = 63 + 32` groups.
Each equation means starting stock plus fresh stock equals consumed stock plus final stock.
No identified consumed group repeats. The peak observed ready plus reserved capacity remains thirty-two candidates per participant and wallet through restoration.

All twelve hosted create/recovery ceremonies reproduce the ordinary canonical keys.
For each wallet, the public key is identical across all three group sizes.
Online registration, including client verification, takes 3.834–5.103 seconds with eight candidates, 5.943–11.312 seconds with four, and 8.280–22.450 seconds with two.
Those timers exclude generic key-generation preparation and the preparation of the initial sixteen signing candidates.
Registration installs 2, 4, or 8 independent groups to preserve that initial candidate count.
The observed registration cost also matters when choosing a group size.
Sequential runs and hosted CPU variation prevent attribution of the full latency difference to group size alone.

## What the slow two-candidate run establishes

More rollover work alone cannot explain the difference.
The two one-group successes already take 4.192 and 5.161 seconds at the client.
Matched participant-A one-group invocations have these medians:

| Group size | Matched one-group calls | Invocation wall time | Invocation CPU |
| --- | ---: | ---: | ---: |
| 8 | 14 | 939 ms | 236.5 ms |
| 4 | 15 | 837 ms | 188 ms |
| 2 | 2 | 2,695.5 ms | 361 ms |

The two-candidate successful traces all report schedule-cache hits and zero public-topology builds.
Those cache rebuilds therefore do not explain the traced delays.
Router service-clock readings also increase across inventory, reservation, fencing, and release calls.
They measure clock advancement, which does not partition storage, network, and CPU time.
No measured placement or matched-runtime control establishes which host effect caused the increase.

Participant A records 354 pending socket events for one group and 349 additional events for each extra group across the profiles.
These counters are event counts, not network round-trip counts.
Independent groups repeat protocol and storage work. Smaller groups also reduce the material discarded after a successful group.
This experiment measures that tradeoff under the observed deployment conditions.

The slowest client response takes 25.207 seconds.
Its Router invocation reports 14.277 seconds, while participant A and B report 12.018 and 11.904 seconds.
The retained measurements do not explain the full client interval.
Do not assign the difference to network, admission, startup, or storage without new evidence.
Three eight-candidate operations and two four-candidate operations lack complete, unique participant trace coverage.
All eighteen terminal two-candidate operations have one Router outcome and one trace per participant.

| Candidate explanation | Evidence | Conclusion |
| --- | --- | --- |
| Rollover count alone causes the slow two-candidate result | Its one-group calls are also slower | Insufficient explanation |
| Public schedule or topology rebuilding causes those calls | Successful two-candidate traces report cache hits and zero builds | Contradicted for those caches |
| Group size and repeated work affect cost | Candidate consumption and event counts change | Supported as part of the tradeoff, without an isolated timing effect |
| Hosted CPU, placement, or service variation affects cost | Participant and Router readings vary across sequential deployments | Remains possible; the cause is unresolved |
| Starting stock or omitted exhaustion creates the apparent throughput | Full reserves are restored; consumed identities include failed operations | Excluded from the reported balanced cycle |
| Trace shutdown or runtime interruption loses the final preparation record | Each missing completion belongs to the final restored group | Both remain possible |

The collector stops its tails after observing full stock, without waiting for the final producer-completion record.
An early trace cutoff is a plausible measurement cause for the missing final records.
The evidence does not distinguish it from a runtime interruption after publication.
Future collection needs a terminal-record drain before shutdown.

## Next decision

Keep eight candidates as the default until repeated measurements qualify a replacement.
Four candidates are the stronger candidate for the next controlled comparison.
Repeat the comparison with matched deployment conditions and verified client-to-participant timing coverage.
Retain fresh epochs, independently bound groups, the same candidate cap, and full reserve restoration.

Group size alone did not achieve the preparation target.
Further gains require lower preparation cost per candidate and reliable hosted request latency.
Measure setup, correlation generation, activation, and storage before selecting the next optimization.
Preparing several independently bound groups in one request can be investigated for shared overhead, with single-use protections preserved.
The [preparation function](../../crates/ed25519-yao/src/passive/ml_dsa_signing/prepared_signing/gmw.rs) starts a fresh correlation stream for each group.
The [stream](../../crates/ed25519-yao/src/passive/ml_dsa_runtime/boolean_comparison/silent.rs) consumes correlations once and wipes unused final correlations.
The prototype does not reuse a consumed correlation or divide an old eight-candidate blob.

## Experiment

This experiment compares independently prepared and consumed groups of 2, 4, and 8 signing candidates.
Each candidate can fail the ML-DSA rejection checks after the message arrives.
An evaluated group is single-use, including when every candidate fails.
An untouched group remains available after successful settlement.

The targets are 5–10 seconds of preparation per successful signature and less than five seconds for online signing.
Preparation per group and preparation per successful signature have different denominators.
The comparison includes groups consumed by failed operations and restores the starting reserve after each load interval.
Empty-pool waits remain part of complete demand latency.

| Candidates per group | Admission minimum, groups | Reserve target, groups | Reserve target, candidates |
| --- | ---: | ---: | ---: |
| 8 | 2 | 4 | 32 |
| 4 | 4 | 8 | 32 |
| 2 | 8 | 16 | 32 |

Each profile uses two wallets, one global producer, and one active signing operation.
The admission minimum remains sixteen candidates per wallet.
The benchmark cooldown is one second. The product default remains sixty seconds.
Each load interval lasts ten minutes and maintains one outstanding demand per wallet.
Every profile starts and ends with the full reserve.
Starting group identifiers and prestarted production are excluded from post-depletion throughput.

The profiles run sequentially in the order 8, 4, 2.
Each uses a separate temporary five-Worker deployment with separate participant storage and preparation services.
The same release binaries serve every profile. Deployment policy selects the group size.
Each deployment is deleted before the next profile starts.
Sequential runs can experience different Cloudflare CPU, network, and storage conditions.
This screen does not isolate a causal speedup from those conditions or establish production percentiles.

## Implementation and invariants

The existing preparation primitive creates each group independently.
The prototype does not divide previously generated eight-candidate material.
The trusted deployment policy accepts group sizes of 2, 4, or 8.
A signing-layout digest binds the circuit schedules and group size to activation, preparation, reservation, and execution.
Changing the group size requires fresh preparation and key re-establishment with an advanced epoch.
The ordinary public key can remain the same after canonical recovery.

Registration selects stock with the exact key-generation schedule, signing layout, and required initial group count.
Participant routes reject a mismatched layout before consuming reserved material.
Existing permanent consumption records, operation identifiers, epoch fences, and paired publication checks remain active.

Canonical key generation still uses prepared Yao half-gates.
Signing still uses GMW with fresh silent correlations and masks.
The wallet-derived canonical FIPS seed and ordinary FIPS key/seed export contract remain unchanged.
The passive, honest-execution server-blind model remains unchanged.
This experiment changes public group layout and lifecycle policy. It does not introduce a new cryptographic construction.
GPU work remains deferred.

## Validation and measurement boundaries

The native lifecycle E2E checks that a registration claim cannot consume stock from another signing layout or group count.
The full local Worker E2E checks wrong-layout refusal without consuming reserved material, replay, refill, and interrupted publication.
Local registration and recovery checks cover groups of 2 and 4.
Native canonical-key controls compare wallet-seed recovery with ordinary ML-DSA key generation.

The local publication fixture has explicit barriers before and after participant A's write.
The earlier count-change precondition could miss a producer already present in its first snapshot.
That failed fixture did not establish a production regression.
The corrected unpaired-publication control observes B Ready and A Missing before reset.
The original lease remains active during the recovery interval, then expires before a fresh job begins.
The paired-publication control retains inspection and settlement fault injection.

The hosted client records successful responses, failures, unavailable responses, duplicate controls, and unfinished demands.
Online HTTP latency measures the complete successful request, including durable settlement.
Complete demand latency also includes admission retries and empty-pool waits.
Repeated pending-operation responses require a wider online boundary and prevent a final-HTTP-only target claim.
Independent verification checks standard ML-DSA signatures and rejects altered messages and signatures.

Producer completion logs contain Worker clock deltas, which can omit execution time.
They cannot qualify the elapsed preparation target.
Matched Cloudflare producer-invocation wall measurements include setup, preparation, and settlement.
Only participant A's producer duration enters the preparation total. Adding both participants would count overlapping protocol work twice.
These measurements do not partition CPU, protocol, network, and storage costs.
Missing completions and interrupted producer work remain explicit accounting gaps.
The complete cycle includes load, idle gaps, failures, and restoration of the same candidate reserve.
No billing estimate follows from these measurements.

Product parity covers the private durable registration and signing routes used here.
Login, public Wallet session routes, user interface, NEAR submission, and finality remain outside these measurements.
Production integration remains gated.

## Evidence and reproduction

- [Hosted registrations, clients, public traces, stock snapshots, and comparison](../evidence/ml-dsa-65-candidate-groups-hosted-20261017.json.gz).
- [Native canonical-key controls and local Worker lifecycle checks](../evidence/ml-dsa-65-candidate-groups-local-20261017.json.gz).
- [Source/build hashes, deployment policy, exact clients, and independent review](../evidence/ml-dsa-65-candidate-groups-provenance-20261017.json.gz).
- [Credential scan, cleanup, and validation receipt](../evidence/ml-dsa-65-candidate-groups-validation-20261017.json).

Each compressed bundle retains exact UTF-8 evidence text under `files`.
Extract the bundles into one directory under `.artifacts/`, preserving their relative paths.
Reproduce each profile summary with `summarize_multi_wallet.py CLIENT TRACES VERSIONS OUTPUT` from `tools/ml-dsa-investigation/research/`.
Reproduce the comparison with `summarize_candidate_groups.py DIRECTORY OUTPUT` from the same directory.
Run `node review/verify_hosted_profiles.mjs --include-ledger --require-all` from the extracted directory.
The verifier requires Node with standard ML-DSA support.
Run `python3 review/verify_raw_profile.py SIZE` for each group size.

The retained client verifies duplicate response equality during each run.
The independent verifier checks the original signature bytes and the recorded duplicate assertion.
The artifacts do not retain duplicate signature bytes for a second independent equality check.
The exact client source identifies that limit.

Independent review verifies all 61 load-test signatures and rejects all 122 altered-message or altered-signature cases.
The summaries and aggregate comparison reproduce from the frozen public records.
Instrument controls reject unpaired stock, missing failed-operation outcomes, wrong group widths, and capacity overflow during restoration.
Prior capacity summaries also reproduce with their original four-group target.

Fresh hosted reproduction requires new benchmark credentials, separate participant wrapping keys, fresh Worker names, and rebuilt release artifacts.
The retained deployment configurations and orchestration scripts record the experiment setup.
The Worker build commands are `pnpm -C crates/router-ab-cloudflare build:router`, `build:deriver-a`, and `build:deriver-b`.
The same frozen outputs must serve all three profiles.
Production credentials and wallets are outside this campaign.

All fifteen temporary Workers were deleted. All fifteen owned tail processes stopped.
The retained evidence passed an exact generated-credential and wrapping-key scan, including common encodings and normalized JSON arrays.
The scan found no matches. The 59 selected local secret, private-fixture, and raw-tail files were removed afterward.
The native lifecycle E2E, six canonical-key controls, local Worker checks, and three frozen release builds passed.
The bloat gate retains its inherited failure: Rust duplicate lines 13,984 against 13,754, and TypeScript 10,238 against 10,216.
The baseline remains unchanged.
