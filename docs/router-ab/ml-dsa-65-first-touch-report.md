# ML-DSA producer first-touch and warmup investigation

Early first-touch is a promising performance signal. Heavy compute warmup has no established added benefit.
The ordinary controls retain a roughly twofold producer CPU gap after repeated execution and public-cache reuse.
This screen does not establish a causal preparation speedup.

The campaign also found a concrete source of wasted preparation: a stale inventory read can trigger an unnecessary four-candidate batch.
That observed batch costs 17.243 seconds of combined participant CPU.
Production cryptographic source, the preparation backend, and runtime defaults remain unchanged.

## Scope and measurements

Eight temporary Cloudflare Workers serve two synthetic wallets.
The configured reserve stays at thirty-two candidates per wallet, represented by sixteen pairs.
Each measured block retires two unused pairs per wallet, then replaces them through two four-candidate jobs.
Signing consumes two candidates at a time.
Wallet-seed recovery, canonical FIPS export, separate participant custody, and the passive model remain unchanged.
Two preparation slots remain an experimental setting. The production default remains one slot.

Five cohorts use fresh producer object IDs, with identical producer Wasm.
The controller changes one routing-name byte in its Wasm data section. Every other Wasm section remains identical.
The wrapper cohorts use the same public diagnostic module and 2,228,224 bytes of auxiliary linear memory.
Its declared maximum is four MiB. Combined JavaScript, core Wasm, and native memory peaks remain unqualified.

Forty selected jobs publish eighty distinct fresh pairs at both participants.
Their versions, actor IDs, exact per-job publication sets, complete tails, and wallet ledgers pass independent review.
Starting and ending snapshots contain the same sixteen ready IDs at each participant, with no reservations.
Each cohort's starting material remains valid beyond its final block and readiness horizon.

The table reports medians of complete participant A invocations for one four-candidate job.
CPU excludes participant B here; the evidence separately accounts for both participants.
Wall time includes protocol and storage waits. These are producer measurements, not public SDK signing latency.

| Cohort | Primary / secondary jobs | Primary / secondary A CPU | Primary / secondary A wall |
| --- | ---: | ---: | ---: |
| Ordinary first control | 4 / 4 | 9.20 / 4.87 s | 19.91 / 10.94 s |
| Wrapper only | 4 / 4 | 10.61 / 4.91 s | 23.37 / 11.29 s |
| Light first-touch | 5 / 3 | 4.51 / 4.56 s | 10.13 / 10.19 s |
| Compute conditioning | 4 / 4 | 4.54 / 4.41 s | 10.24 / 9.79 s |
| Ordinary return control | 4 / 4 | 9.70 / 4.68 s | 21.36 / 10.53 s |

The wrapper's later idle observation has unequal warmup history because an extra job ran. It is excluded from matched idle conclusions.
The light cohort starts with two sequential primary jobs. Its first block is unbalanced.
These limitations prevent ranking complete designs from the table.

## First-stock cost includes conditioning

Light first-touch sends eight authenticated empty-control requests.
Compute conditioning uses the same routes and count, with fixed public AES and encoder inputs.
Both routes include A's actual binding to B.
The auxiliary workload does not directly invoke production private AES.

| Cohort | Conditioning participant CPU | Conditioning client elapsed | Conditioning start through both restored reserves |
| --- | ---: | ---: | ---: |
| Ordinary first control | 0 | 0 | 26.85 s |
| Wrapper only | 0 | 0 | 29.14 s |
| Light first-touch | 0.063 s | 5.91 s | 49.35 s |
| Compute conditioning | 3.124 s | 6.85 s | 25.38 s |
| Ordinary return control | 0 | 0 | 30.68 s |

The elapsed boundary includes conditioning, intervening inventory reads, dispatch, publication, and client polling.
Conditioning CPU includes A's forwarding work and B's workload. Front and controller CPU are excluded.
The first-stock measure replaces eight candidates across two wallets. It is not registration or one signature's preparation cost.

Light first-touch's first block has a roughly 27-second dispatch gap between its two jobs.
The second wallet's deficit is observed after the first primary job finishes.
The cause of that wake or controller delay remains unresolved.
Fast cryptographic jobs therefore do not guarantee a short reserve-restoration wait.

Four of eight target light-touch requests match each role's first actual protocol software instance.
All four primary requests match. The secondary software instances change before their first production jobs.
Compute conditioning matches eight of eight.
Software identities do not reveal physical hosts or placement.

The ordinary control keeps the same module identities and public-cache hits across repeated and idle work, while its CPU gap persists.
The earlier pilot reverses which logical slot is slow after a restart.
One-time initialization overhead alone therefore cannot explain the full variation.
Early first-touch, placement, compilation history, deployment order, and execution conditions remain coupled.
A balanced reversed-order repeat on fresh names is required before a production speedup claim.

## Unnecessary preparation from stale inventory

The wrapper controller observes wallet one's local stock before publication and peer stock after publication:
The following values are recorded stage/log times. They are not precise cross-actor grant timestamps.

1. A's inventory contains fourteen pairs at `1793195386598`.
2. The preceding job publishes A at `1793195387397`.
3. The controller logs its mixed snapshot, A fourteen and B sixteen, at `1793195387428`.
4. The preceding settlement is logged at `1793195387510`.
5. The controller logs an acquired claim at `1793195387511`, after its service call, using the earlier deficit.

Reconciliation preserves the preceding job's now-paired material.
The controller dispatches the new job without recalculating the deficit under its new lease.
See [preparation.rs](../../crates/router-ab-cloudflare/src/ml_dsa/workers/preparation.rs) and [refill.rs](../../crates/router-ab-cloudflare/src/ml_dsa/refill.rs).

Wallet one's ledger is sixteen initial pairs minus six retired pairs plus eight fresh pairs, leaving eighteen pairs at each participant.
The configured target remains sixteen. This is a transient controller overshoot to thirty-six candidates.
The unnecessary job consumes 8.413 seconds of A CPU and 8.830 seconds of B CPU.
Its two unused pairs are explicitly retired at both participants before the continuation.
Normalization does not repair the unequal warmup history; that idle comparison remains unqualified.

The next production optimization should revalidate the deficit after obtaining the authoritative lease and before dispatching expensive work.
An unnecessary lease needs a neutral release path that preserves fairness, wakeups, and failure backoff.
No such production change is included in this checkpoint.

## Interpretation and validation

| Hypothesis | Evidence | Result |
| --- | --- | --- |
| One-time initialization overhead alone creates the twofold gap | Slow work persists with the same module and a public-cache hit | Rejected as the sole cause |
| Loading the diagnostic wrapper guarantees fast work | Wrapper-only retains the ordinary gap | Rejected |
| Heavy compute adds a useful warmup gain | Light and heavy cohorts have similar job costs; heavy conditioning adds CPU and elapsed time | No added gain established |
| Early first-touch can improve execution conditions | Both early-touch cohorts have fast jobs; placement and order remain uncontrolled | Promising association |
| Expiry explains the wrapper surplus | Exact IDs and lease/publication records prove the stale-inventory race | Rejected |
| A successful deployment receipt proves active routing | The first return attempt reaches the old controller and old object IDs | Rejected |

The initial pilot's failed inventory counts were not retained.
Registration-stock expiry overlaps that failure, but its exact cause remains unknown.
The earlier expiry-only explanation is withdrawn.
The pilot remains separate from the five selected cohorts.

Phase names describe the planned order. Actual intervals govern interpretation.
Manual continuation delays the light cohort's first repeat by about 194 seconds.
The wrapper continuation follows surplus retirement and a fresh idle interval; its module identities also change.
The full evidence retains these gaps, module changes, failed preconditions, and extra costs.

The first return attempt uses stale controller routing and is rejected.
Its two completed jobs publish four pairs and consume another 18.836 seconds of paired producer CPU.
The corrected return attempt passes both controller-version and fresh-actor checks.
Forty selected jobs, the surplus job, and the rejected return jobs total 547.071 seconds of paired producer CPU.
This excludes setup, pilot, conditioning, controller, pool, Router, and collector work. It is not a billing total.

Two wallets pass canonical creation and wallet-seed recovery with unchanged public keys.
Four setup signatures and two final signatures verify independently through Node/OpenSSL.
All six altered-message checks fail verification as expected.
The final two private Router signing requests take 3.478 and 1.988 seconds. This small sample does not establish a signing percentile.

The full comparison capture retains four earlier Router exceptions and ninety-one canceled events.
All forty selected protocol jobs and the separately accounted extra/rejected jobs have successful, complete participant records.
Provider timestamps alone do not bound every log; idle checks use conservative metadata/log envelopes.
No sustained signatures-per-minute result is claimed by this preparation screen.

All eight temporary Workers are deleted, with independent absence checks.
The required bloat check retains its inherited Rust duplication failure: 13,992 lines against 13,754.
The baseline is unchanged. No production code change is retained.

[Replayable evidence](../evidence/ml-dsa-65-first-touch-20261028.json) contains exact versions, job ledgers, raw captures, qualification limits, signature checks, and cleanup receipts.

The next high-impact tasks are the stale-deficit dispatch guard, the delayed refill wake, and a balanced early-touch replication.
Heavy synthetic warmup should remain experimental until it provides a repeated net gain.
