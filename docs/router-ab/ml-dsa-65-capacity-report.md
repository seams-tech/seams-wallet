# ML-DSA-65 refill recovery and multi-wallet capacity

Date: 2026-10-17. Experimental private Router A/B routes. Production integration remains gated.

All 25 successful hosted signing requests finish within five seconds in the new two-wallet screen.
They take 1.012–2.531 seconds, with a 1.159-second median.
Complete demand latency, including empty-pool retries, still reaches 87.359 seconds.
The five-second target passes for these prepared requests. It fails when preparation and admission waits are included.
Only five of the 25 complete successful demands finish within five seconds.

The previous 91.011-second result also measured complete demand latency.
It includes waiting for fresh signing material, preparation capacity, and admission.
It does not measure 91 seconds of online Yao evaluation.
Canonical key generation uses prepared Yao half-gates. Signing uses GMW with fresh silent correlations.
Those correlations and fresh masks serve a role similar to presignatures. Their preparation still requires private computation.

## Changes

The global preparation lease now serves a durable first-in, first-out queue.
Each waiting key gets one fresh batch per turn.
An active producer cannot queue another turn ahead of an existing waiter.
Full and inactive keys withdraw their pending turns.
Queue entries expire after thirty seconds without renewal. The queue holds at most 64 keys.
Maintenance normally renews demand every five seconds.
Fairness applies to admitted, renewing keys when foreground work permits preparation.
This is per-key fairness. The hosted screen uses one key per wallet.

An interrupted producer now checks recovery every five seconds.
Cloudflare serializes alarm handlers for each Durable Object, so this alarm cannot interrupt its healthy preparation handler.
Early release requires both participant stores to report the exact batch as ready or reserved.
The producer commits its interrupted state before releasing the exact global lease.
An old settlement cannot clear a newer lease.
Recovery never restarts private preparation under the old batch identifier.

Missing, retired, or unknown publication keeps the original ninety-second deadline.
This condition protects against a delayed, previously authorized publication request.
Retired records also represent burned or missing-key material. They do not prove completed publication.
An inspection failure or settlement failure retains a recovery path.
The [Cloudflare alarm contract](https://developers.cloudflare.com/durable-objects/api/alarms/) defines serialization and retry behavior.

Preparation also reuses the existing cache of immutable public circuit topology.
Private correlations, masks, shares, and nonce state remain outside that cache.
Empty-pool admission now cancels its claim before any reservation occurs.
This removes four unnecessary participant fence/release calls from that path.
Partial reservations, admitted operations, and terminal settlement retain their existing protections.
An empty request remains declined on replay after refill. A fresh operation can use the replenished stock.

## Hosted comparison

Both campaigns use two independent recovered wallets and separate participant stores.
Each wallet starts with four ready batches. Each batch contains eight candidates.
One global producer and one active signing operation remain configured.
The saturation client maintains one outstanding demand per wallet for ten minutes.
Its test cooldown is one second. The product default remains sixty seconds.
All eight starting batches are excluded from refill capacity measurements.
The same wallets, canonical keys, epochs, storage, credentials, and pool caps serve both campaigns.
All five Workers receive the new release before the second campaign starts.
No deployment occurs during either load interval.

| Measurement | Baseline | Fair queue and recovery |
| --- | ---: | ---: |
| Client interval | 600.001 s | 600.000 s |
| Independently verified signatures | 19 | 25 |
| Signatures per wallet | 7 / 12 | 12 / 13 |
| Successful HTTP minimum | 1.302 s | 1.012 s |
| Successful HTTP median | 1.600 s | 1.159 s |
| Successful HTTP maximum | 3.163 s | 2.531 s |
| Successful HTTP requests below five seconds | 19/19 | 25/25 |
| Complete successful demand median | 35.170 s | 48.650 s |
| Complete successful demand maximum | 430.454 s | 87.359 s |
| New paired batches first observed during load | 20 | 19 |
| Observed new paired batches per minute | 2.000 | 1.900 |
| Peak observed ready plus reserved batches per role and wallet | 4 | 4 |

The worst observed demand wait falls, while the median demand wait rises.
The second campaign does not establish a preparation throughput improvement.
Sequential hosted runs can experience different CPU, network, and storage conditions.
The test changes several implementation details together. It cannot assign a causal speedup percentage to each change.

The new campaign records twenty acquired producer leases, with ten grants per wallet.
All twenty alternate between the two keys.
This supports the observed fair-turn behavior. It does not establish fairness for an unlimited queue or interrupted renewals.
The baseline has no grant log. Its observed producer starts become uneven during the interval.
The baseline results establish imbalance in this run, with no claim of permanent starvation.

Two interrupted producers confirm paired publication during the new load interval.
Fresh leases follow 1.767 and 4.344 seconds after those confirmations.
They begin 69.495 and 53.112 seconds before the old deadlines.
These observations show that the recovery path releases capacity early after confirmed publication.
They do not identify the internal cause of either interruption.
Two producer exceptions carry Cloudflare's code-update reset category despite no deployment during load.
That category remains an observation. The platform's internal reset cause stays unknown.

## Refill accounting and capacity limits

The new campaign consumes 25 distinct batches for 25 verified signatures.
Every successful operation uses one batch. This campaign adds no hosted two-batch latency evidence.
Its complete stock identity balance is `8 initial + 25 new = 25 consumed + 8 final`.
Both wallets return to four ready batches, with no reservation remaining.
The later of their first observed full reserves arrives 153.020 seconds after the client interval.
The baseline's corresponding restoration takes 192.149 seconds.
Restoration lies outside each ten-minute capacity window.

Initial stock is fully consumed by 61.831 seconds in the new campaign.
The following 538.169 seconds contain seventeen new paired arrivals and seventeen verified signatures.
That observed rate is 1.895 batches and successful signatures per minute across both wallets.
Pending demands at the cutoff remain recorded as censored demands.
The captured successful producer completions during load take 16.772–46.447 seconds, with an 18.673-second median.
Two observed paired arrivals lack a successful producer-completion record.
Their material identities are present in inventories and consumption records.
The stock identity balance is complete. Producer-completion accounting remains incomplete.

Four verified baseline signatures lack Router consumption outcomes in the captured tail.
Their consumed batch counts and identities remain unknown.
The summaries do not infer them from timing or signature success.
This gap prevents proof of a common initial-stock depletion time for the baseline.
Its common post-depletion rate remains null.
Across the full ten minutes, subtracting all eight starting batches gives conservative lower bounds:
at least eleven baseline signatures and seventeen new-campaign signatures used newly prepared material.
These bounds equal 1.100 and 1.700 signatures per minute. They are not exact steady-state rates.
No captured consumed batch identifier is reused within or across the campaigns.
Missing baseline outcomes limit the scope of that check.

A sixty-second wallet cooldown does not create global preparation capacity.
Two wallets each requesting once per minute need two signatures per minute.
This exceeds the observed aggregate rate of 1.895 per minute, even with one-batch signatures.
Candidate rejection, interruptions, registration, and additional wallets require further capacity or admission limits.
Larger pools remain outside this experiment. The configured per-wallet pool cap stays four.
The five-second empty-pool target remains open.

## Instrument checks and fault controls

Client monotonic timing measures each complete HTTP request and each demand across retries.
The client retains unavailable responses, declined replays, failures, successes, and cutoff censoring.
Node's OpenSSL-backed verifier checks each standard ML-DSA-65 signature.
Public traces retain exact Worker versions, batch identities, key digests, epochs, grants, and recovery events.
Headers, credentials, private fixture data, and unselected logs are excluded.
Cloudflare stage clocks do not provide a complete partition of CPU, network, and storage time.
The [earlier clock controls](ml-dsa-65-online-profile-report.md#instruments-and-controls) still apply.
Do not sum parallel invocation walls or subtract CPU to infer pure waiting time.

The existing real-Worker E2E now holds a publication response after both role stores commit the batch.
It resets the runtime while producer state remains running.
One inspection and one lease-settlement request each fail with an injected HTTP 503.
Confirmed global lease release takes 11.185 seconds after reset, before the original deadline.
The earlier 1.218-second preliminary figure measured only a terminal state commit.
It did not measure confirmed lease release. That interpretation is withdrawn.
The old baseline fails the same fifteen-second early-recovery assertion.
Its original deadline still has about eighty seconds remaining.

A second reset occurs before either store publishes material.
The producer retains its lease after seven seconds and falls back to the original deadline.
A fresh batch begins after 92.210 seconds. An old settlement cannot clear its lease.
The expired producer retry is refused. No private preparation restarts under the old identifier.
These fault proxies exist only in the local E2E runtime.

The existing SQLite lifecycle E2E checks queue renewal, restart, withdrawal, epoch changes, expiry, and the 64-entry bound.
It uses trusted activation fixtures and simulated clocks.
The real Worker E2Es separately exercise private preparation and standard signature verification.
The final local Worker campaign verifies three signatures in 0.155–0.454 seconds and closes a stalled peer within its permit deadline.
Empty-pool replay remains declined after refill. Fresh signing and automatic refill continue to pass.

Current local registration and recovery reproduce the canonical FIPS key in 1.032 and 1.197 seconds online.
Their preparation takes 25.180 and 52.568 seconds outside those online measurements.
The baseline hosted registration controls create two keys in 3.500 and 3.764 seconds online.
Hosted recovery takes 3.385 and 4.483 seconds and restores each ordinary canonical key.
Those hosted controls precede the new Worker deployment. The current registration change is qualified locally.
The canonical wallet-derived seed, standard FIPS export contract, and separate participant stores remain unchanged.
The native canonical-key and prepared-signing screen also passes.

## Diagnosis record

| Fact | Instrument | Where and limit |
| --- | --- | --- |
| Ready signing remains below five seconds | Verified client responses | 25 exact-campaign successes; all use one batch |
| Demand waits remain much longer | Complete demand monotonic timer | Includes retries; unfinished demands are retained |
| Producer turns alternate | Typed grant logs after durable admission | Twenty grants, two renewing keys, exact versions |
| Interrupted paired publication releases capacity early | Recovery log and next fresh grant | Two hosted cases; local reset control confirms lease release |
| Unknown publication keeps the original deadline | Real Worker reset before publication | Both exact batch inspections initially report missing |
| Pool size remains bounded | Ready and reserved inventories | Peak four per role and wallet; complete candidate stock balance |
| Trace capture is incomplete | Client/Router/producer record reconciliation | Four baseline consumption outcomes and two candidate completion records missing |

| Candidate cause | Ready signing | Uneven wallet service | Interrupted refill | Result |
| --- | --- | --- | --- | --- |
| Online Yao evaluation causes the entire long wait | Contradicted by short verified online requests and the signing protocol | Says nothing | Says nothing | Removed as an explanation for the complete demand delay |
| Preparation cost limits supply | Compatible | Cannot explain ordering alone | Says nothing | Capacity remains near two batches per minute |
| No global turn order | Says nothing | Fits baseline; new grants alternate | Says nothing | Replaced with a bounded durable queue |
| Interrupted producer retains its original lease | Says nothing | Can block both wallets | Fits reset control and early fresh grants | Early release added for confirmed paired publication |
| Unnecessary empty-path storage calls | Additional observed implementation work | No fairness guarantee | Says nothing | Four calls removed per empty admission |
| Platform CPU, storage, or runtime variation | Compatible with varying producer durations | Can change timing | Internal reset cause unknown | Requires further platform evidence |
| Measurement overhead or missing capture | Cannot erase verified client timings | Limits baseline accounting | Limits completion accounting | Retained as an explicit comparison limit |
| Our implementation | Public topology rebuilding and admission work add cost | Global queue was absent | Original recovery waited for deadline | Direct changes qualified by controls |

Independent review checks signature verification, altered-message/signature rejection, exact-version summaries, fair grants, and material accounting.
All 44 signatures verify again. All 88 altered-message and altered-signature checks reject.
Both summaries reproduce byte-for-byte. All three earlier complete summaries remain unchanged.
Review corrections count verified client completions after established depletion even when a Router outcome is missing.
The baseline's unknown depletion remains unknown.

Product parity covers private durable registration and signing routes, including separate role storage and admission.
Login, public Wallet session routes, user interface, NEAR submission, and finality remain outside these timings.
Two wallets and ten minutes do not establish a production percentile, capacity guarantee, or malicious-security claim.
The passive honest server-blind model remains unchanged. GPU work stays deferred.

## Evidence and reproduction

- [Hosted clients, frozen public traces, stock snapshots, and summaries](../evidence/ml-dsa-65-capacity-hosted-20261017.json.gz).
- [Native, real Worker reset, registration, and queue lifecycle checks](../evidence/ml-dsa-65-capacity-local-20261017.json.gz).
- [Independent review scripts and verification receipts](../evidence/ml-dsa-65-capacity-review-20261017.json).
- [Source/build provenance, parser controls, validation, and cleanup](../evidence/ml-dsa-65-capacity-provenance-20261017.json).

Compressed bundles retain exact UTF-8 evidence text under `files`.
Extract both bundles into one isolated directory, preserving `hosted/` and `review/` paths.
Run `summarize_multi_wallet.py CLIENT hosted-traces.json VERSIONS OUTPUT` with the exact per-role version map.
Run the retained independent signature verifier against both client files.
The baseline and candidate client sources differ only in diagnostic assertions, reporting, and client-error capture.
Their load loop and ten-minute request cadence are unchanged. Both exact source texts and hashes remain in the evidence.

All five temporary Workers were deleted. All five owned tail sessions were stopped.
Private benchmark files and raw tails were removed after scanning the retained evidence for credentials and common key encodings.
The inherited bloat failure remains Rust 13,984 against 13,754 and TypeScript 10,238 against 10,216.
The baseline is unchanged.

Next, qualify paced demand at the production cooldown with more wallets and repeated multi-batch successes.
Retain empty waits, recovery demand, and candidate exhaustion in the capacity result.
Measure interrupted unpublished preparation separately before changing its conservative deadline.
Investigate runtime resets with platform evidence. Current logs cannot identify their internal cause.
Production integration remains gated by sustained capacity, broader lifecycle checks, and security review.
