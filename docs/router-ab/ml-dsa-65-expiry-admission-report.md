# ML-DSA expiry and admission results — October 25, 2026

The hosted tests confirm that empty-pool requests do not claim signing capacity.
Neither load loses newly refilled paired stock during its observation window.
The single-producer configuration still cannot sustain eight wallets signing once per minute.

The four-wallet run verifies 48 signatures. The eight-wallet run verifies 89.
Successful signing calls finish below five seconds in 136 of 137 cases.
Complete demands take longer because material waits, cooldowns, and retries accumulate.

The [hosted evidence](../evidence/ml-dsa-65-expiry-admission-hosted-20261025.json) links the public archive and its digest.
All six temporary Workers are deleted and independently confirmed absent.

## Implementation and unchanged limits

Runtime commit: `0f297d01`. Only the ML-DSA Router binary changes from the prior campaign.
The A/B participants, A/B preparers, and forwarding Router retain their exact Wasm hashes.

- Newly refilled material receives a one-hour sealed lifetime. Existing deadlines are never extended.
- Initial registration stock retains its fifteen-minute lifetime. Producer leases remain ninety seconds.
- Admission checks replay, custody, cooldown, and capacity before reading stock, without claiming a signing slot.
- An empty result retains the exact operation and retry time without charging cooldown.
- Ready requests repeat authoritative admission checks and inventory checks before reservation. This adds two exchanges.
- Wallet-seed recovery, canonical FIPS export, epoch fencing, single-use consumption, and the passive server-blind model remain unchanged.

| Limit | Value |
| --- | ---: |
| Candidates consumed together | 2 |
| Normal refill group | 4 candidates |
| Refill when only one pair fits | 2 candidates |
| Target per wallet | 32 candidates |
| Minimum admission reserve | 16 candidates |
| Wallet cooldown | 60 seconds |
| Service-wide active signing operations | 1 |
| Service-wide active preparation jobs | 1 |

Both runs observe at most sixteen pairs per participant and wallet.
Preparation stays on Workers. GPU work remains deferred.

## Hosted performance

Durable Cloudflare clients call the ordinary forwarding Router and the complete private Router A/B path.
Each wallet has one outstanding demand and a sixty-second minimum interval between new demands.
The driver retries unchanged operation IDs. Exhausted operations retain cooldown and require a fresh operation ID.
The driver can keep a demand pending beyond the public SDK's request deadline.

These timings exclude browser transport, public Gateway owner approval, UI, and NEAR finality.
Successful-call latency excludes prior admission waits. Complete demand latency includes those waits and retries.

| Measurement | 4 wallets, 12 minutes | 8 wallets, 20 minutes |
| --- | ---: | ---: |
| Independently verified signatures | 48 | 89 |
| Successful call minimum / median / maximum | 0.462 / 1.242 / 5.739 s | 0.519 / 1.272 / 4.566 s |
| Successful calls below 5 seconds | 47/48 | 89/89 |
| Complete demand median / maximum | 13.590 / 27.499 s | 28.733 / 369.485 s |
| Pending demands at cutoff | 0 | 8 |
| Longest pending demand at cutoff | — | 839.998 s |
| Consumed pairs | 140 | 266 |
| Candidates consumed per verified signature | 5.83 | 5.98 |
| Full reserve restoration after cutoff | 71.174 s | 393.042 s |
| Finite load-and-restoration cycle | 3.640 signatures/min | 3.352 signatures/min |

The 5.739-second call consumes twelve pairs, or twenty-four candidates.
The eight-wallet run also has two exhausted operations. They consume eighteen and sixteen candidates.
Their material use and subsequent waits remain in the figures.

The four-wallet cycle starts and ends with sixty-four paired ready records.
The eight-wallet cycle starts and ends with 128. Final snapshot ages span at most 23.150 seconds.
Every final pair has a known deadline. The shortest remaining eight-wallet lifetime is 44.63 minutes.
These finite cycles include observed refill and observation delays. They do not establish maximum production capacity.

The eight-wallet run consumes all excluded starting material before its later measurement interval.
It then verifies 36 signatures in 758.248 seconds, or **2.849 signatures/minute**.
The four-wallet run has one unresolved starting-pair deadline, so it has no qualified post-starting-stock rate.

## Expiry and admission comparison

The baseline uses the same workloads and pool limits. It is a historical comparison, not a randomized contemporaneous control.

| Measurement | 4-wallet baseline → candidate | 8-wallet baseline → candidate |
| --- | ---: | ---: |
| Verified signatures | 39 → 48 | 46 → 89 |
| Empty-pool responses | 327 → 3 | 3,031 → 2,323 |
| Service-capacity responses | 29 → 8 | 533 → 169 |
| Newly refilled unaccounted paired records | 0 → 0 | 30 → 0 |

All 2,326 candidate empty-pool responses have no exclusive-claim event.
Of these, 2,199 contain a fresh empty inventory check. The others reuse persisted waits.
This directly verifies the admission change.

One four-wallet starting pair becomes unavailable without consumption. Its individual deadline remains unrecorded.
It must remain an unresolved starting-stock loss. It is not newly refilled material.
The eight-wallet paired-stock ledger balances completely within the bounded observation horizon.
The main stock analysis ends 120 seconds after cutoff. A separate final capture proves later full restoration.

These windows do not test a complete one-hour idle-expiry cycle.
Zero newly refilled paired-stock loss in these windows does not establish zero preparation waste.

## Preparation speed and failures

| Completed preparation | Jobs | A median wall time | A median reported CPU |
| --- | ---: | ---: | ---: |
| Four-wallet F4 | 59 | 9.318 s | 4.015 s |
| Four-wallet F2 | 14 | 4.781 s | 1.974 s |
| Eight-wallet F4 | 94 | 9.738 s | 4.220 s |

F4 means four candidates. A signature can consume multiple groups.
The eight-wallet load starts 106 F4 attempts: 94 publish and twelve fail.
Successful-only timings above exclude cheap failed attempts.

Each failed attempt has a matching B `loadShed` outcome. All twenty-four intended pair identities remain untaken and unique.
One failure completes correlations and commitments, then briefly stores two B-side halves.
Neither half becomes paired ready stock or enters signing. Both are retired.
The twelve attempts consume 20.889 seconds of combined reported A/B CPU. This is not complete billing.
The provider outcome does not establish whether platform capacity or workload-induced resource pressure caused the failure.

The producer speed difference is substantial and unresolved:

| Four-wallet producer check | Baseline | Candidate |
| --- | ---: | ---: |
| F4 A wall median | 18.129 s | 9.318 s |
| F4 A CPU median, schedule-cache hits only | 8.385 s | 4.002 s |
| Correlation-phase clock median | 15.862 s | 7.359 s |
| Producer entry → crypto start | 0.183 s | 0.188 s |
| A schedule-cache hits | 35/36 | 57/59 |

Every compared F4 execution produces four candidates and exchanges the same byte counts.
A sends 3,967,488 bytes and receives 1,434,560. A/B event counts remain 556/1,558.
Schedule digests, Wasm hashes, compatibility date, CPU limit, and admission policy match.
Raw provider CPU/wall fields match the parsed values.
The schedule-cache flag does not measure every topology cache or runtime compilation effect.
The evidence locates the difference inside correlation preparation but does not establish its cause.
Do not attribute the full throughput gain to the expiry and admission changes.

## Validation and measurement repairs

- All eight synthetic wallets reproduce the same canonical key through recovery. Fifteen setup signatures verify; one creation-time signature exhausts sixteen candidates and remains recorded as failed.
- Node/OpenSSL independently verifies all 152 retained setup/load signatures and rejects 152 altered messages.
- All 3,470 load attempts have exact Router trace coverage. A/B takes match all 406 consumed pairs without reuse.
- Two captures reproduce 7,810 four-wallet and 41,970 eight-wallet closed-window records exactly.
- Independent review checks signatures, take identities, deadlines, partial publication, and restoration arithmetic.
- The archive reproduces the eight-wallet measurements and signature checks after extraction.

The new preflight invalidated the old assumption that each signing invocation logs one inventory.
The analysis now derives consumption from matching A/B take events.
Starting-stock classification no longer depends on whether its deadline is known.
Both historical cohorts reproduce their consumption and stock accounting under these changes.

The collector now separates the requested load duration from closure delay.
The eight-wallet driver closes 9.993 seconds late, with no new request start or signature completion after cutoff.
Raw requests and closure observations remain unchanged. Pending-demand times and derived wait totals stop at cutoff.
One preparation job that starts after cutoff belongs to restoration and is excluded from the load profile.

The prior [local evidence](../evidence/ml-dsa-65-expiry-admission-20261025.json) records passing durable lifecycle and dedicated Worker pool tests.
The broader local Gateway fixture still omits explicit ML-DSA activation for its synthetic recovered owner. That fixture remains unqualified; production authorization was not weakened.
The inherited bloat failure remains: 13,972 duplicated Rust lines against the 13,754 baseline. This work adds no duplicated Rust lines.

## Diagnosis and next work

| Fact | Instrument | Conclusion or limit |
| --- | --- | --- |
| Empty responses never acquire a signing claim | Matched request traces | Admission mechanism verified |
| Newly refilled paired stock remains accounted for | A/B take and inventory ledger | Supported within these windows |
| Two B halves are discarded after failed preparation | Publication and inventory traces | Failed preparation work remains |
| Identical producer binaries run faster | Raw CPU, wall, stage, and traffic counters | Cause unresolved |
| Twelve B calls report `loadShed` | Provider outcomes | Root cause unresolved |
| Eight wallets retain long or unfinished demands | Durable driver records | One producer cannot meet this offered demand |

The next high-impact step is a matched runtime control for CPU variation and the `loadShed` burst.
Then test controlled parallel refill with unchanged per-wallet capacity and separate participant trust boundaries.
Keep complete demand latency, failed work, and full reserve restoration in those comparisons.
