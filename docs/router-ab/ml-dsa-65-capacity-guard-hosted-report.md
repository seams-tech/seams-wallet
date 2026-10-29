# ML-DSA sustained capacity and refill guard

The higher-load baseline demonstrates 5.04 verified signatures per minute on Cloudflare, including reserve restoration.
The matched candidate demonstrates 5.07 verified signatures per minute. No sustained code-level gain is established.
The earlier 3.78 result was an achieved rate under a four-operation-per-minute policy ceiling.

## Fixed requirements and measurement boundary

Four synthetic wallets use canonical FIPS ML-DSA-65 keys and wallet-seed recovery.
Each wallet has thirty-two candidates, stored as sixteen independently consumed pairs.
Preparation stays on Workers. Each ordinary job prepares four candidates, with existing bounded two-candidate top-ups.
Signing consumes two candidates at a time. Admission requires sixteen ready candidates.
The service admits one signing operation at a time. Both benchmark profiles use two experimental preparation slots.
Production defaults remain one preparation slot and a sixty-second wallet cooldown.

The operational control uses a sixty-second cooldown. The matched capacity screens use a separate forty-five-second benchmark cooldown.
The driver has one outstanding demand per wallet. Backpressure reduces actual demand below the nominal ceiling.
Failed-operation retries can create additional operation IDs inside one demand.
A cooldown change does not establish a cryptographic speedup.

Requests run from Cloudflare durable test drivers through the forwarding front, private ML-DSA Router, and separate participants.
The figures exclude the public SDK, browser network, login, human approval, NEAR submission, and finality.
Final successful calls and complete demands have separate timing boundaries.
Operational, baseline-capacity, and candidate final-call medians are 1.074, 1.092, and 0.990 seconds.
Their maxima are 5.093, 4.368, and 5.160 seconds. The candidate therefore misses a strict five-second ceiling once.
Complete demand medians are 11.710, 11.683, and 8.340 seconds, including the configured cooldown and capacity waits.
Complete demands retain cooldown, service-capacity, empty-pool, and retry waits.

## Completed controls

| Metric | Operational baseline, 60 s | Capacity baseline, 45 s | Candidate, 45 s |
| --- | ---: | ---: | ---: |
| Requested load window | 10 min | 12 min | 12 min |
| Verified signatures | 40 | 64 | 64 |
| Complete cycle rate | 3.99092/min | 5.03547/min | 5.07189/min |
| External full-stock observation after cutoff | 1.365 s | 42.590 s | 37.114 s |
| Empty-pool responses | 0 | 0 | 0 |
| Fresh and consumed candidates | 218 | 398 | 354 |
| Four-candidate checkpoint median | 7.836 s | 7.888 s | 8.029 s |
| Captured preparation CPU | 426.463 s | 803.418 s | 720.333 s |

The external observation delay includes remaining work and polling. It is an upper bound, rather than an exact standalone refill duration.
All three screens replace all starting material and restore exact full reserves.
Their material ledgers balance. No consumed pair returns or serves two operations.
The baseline capacity cycle uses 64 initial + 199 fresh = 199 consumed + 64 final pairs.
The candidate uses 64 initial + 177 fresh = 177 consumed + 64 final pairs.
The candidate consumes 11.06% fewer candidates. Its CPU per candidate is 2.035 seconds, versus 2.019 seconds for baseline.
Its lower total CPU therefore does not establish a runtime improvement. No Unused job occurs in either sustained capacity window.
Actual deployed versions match. No screen records an exception or truncated trace during its cycle.
Independent standard verification accepts every signature and rejects each altered message.

The intended baseline Router and participant Wasm files are byte-identical to those from the older 3.78 campaign.
The lower observed preparation cost therefore does not identify a source-level improvement.
Placement, runtime execution conditions, first-touch history, and warmup remain possible causes of variation.
This finite screen does not establish maximum sustainable capacity or production percentiles.

## Closing tail and next optimization

The 42.6-second close follows one wallet's final signature consuming twenty-four candidates.
Six four-candidate jobs replace those twelve pairs. At cutoff, one of the final four jobs is active.
The next three leases are acquired afterward. These are sequential replenishment jobs, rather than three already queued jobs at cutoff.
The final four jobs use one primary actor and restore ready stock from eight through sixteen pairs.
Their same-actor settlement-to-next-run gaps are 301–396 milliseconds.
Their correlation spans total 35.874 seconds, including computation and waits.
This case does not reproduce the earlier twenty-seven-second wake gap.

The candidate has a separate scheduling observation.
An acknowledged wake preserves an alarm timestamp already 7.051 seconds overdue.
The next same-actor controller selection occurs thirty seconds after its predecessor.
The exact three records remain in `candidate-overdue-wake-evidence.json`.
This proves the overdue timestamp was retained. It does not prove why Cloudflare had not delivered that older alarm.
Preserve this control and evaluate scheduling changes separately from parallel refill.

One opportunity is fair parallel refill for a depleted wallet when another producer slot is idle.
It needs authoritative accounting of pending output capacity, independent single-use job IDs, and priority for other waiting wallets.
Keep the same per-wallet reserve. This optimization is not implemented by this campaign.

A second opportunity is CPU overlap between participants.
Cloudflare documents that service-bound Workers share a server thread by default.
Our preparation path uses this binding. Test independent execution with public fixed workloads before changing secret processing.
Then compare a dedicated B actor or authenticated independent routing while keeping preparation on Workers.
Physical placement and a causal benefit remain unverified.
[Cloudflare service-binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) supports the platform constraint.

## Setup, failures, and instrument checks

All four wallets create and recover the same canonical keys. Six setup signatures verify.
Eight online creation/recovery calls take 5.569–7.423 seconds, with a 6.914-second median.
They start with generic material ready. Separate generic preparation takes 51.749–91.899 seconds in setup.
Two initial-stock operations exhaust sixteen candidates. Their E2E signing samples remain failed.
Exact Router outcomes identify exhaustion, rather than a protocol error. Recovery and the recovered signatures pass.
These setup costs and failures stay outside the timed signing windows and remain in the archive.
Remaining short-lived registration stock is explicitly retired before measured load.
Normal refill stock replaces it without increasing the reserve target.

Review found that the closing observer treated non-admitted AwaitingStock records as live signing authority.
The production admission domain gives those records no active slot or permit. They do not expire through lookup.
The observer now waits for live Preparing/Running authority to end and retains censored waiting demands with all costs.
It was restarted before the capacity cutoff. All three screens end with no unresolved operation statuses.
This is a measurement correction. Production state and retention rules remain unchanged.

The early plan named revision 361588db3 as its baseline.
The pre-existing frozen provenance file and binary hashes identify 9b5263e4. No frozen artifact changed.
The candidate core revision is 0c6390852. The benchmark driver is committed at a311d7737.

## Candidate guard

Four forced full-stock or oversized jobs settle Unused before role claim or cryptographic work.
They output zero candidates and record no preparation transport. Their producer alarms total twenty-six milliseconds of CPU.
The four selected baseline jobs consume 35.882 seconds of paired invocation CPU.
This selected comparison excludes metadata reads, callers, and the candidate’s fresh smaller replacement jobs.
The client checks end with exact sixteen-pair reserves. Actual candidate producer versions match.
This controlled fault reduction alone does not establish a sustained-throughput improvement.

## Validation, cleanup, and evidence

Independent review and offline replay reproduce all three complete cycles. The final capture contains 30,909 normalized provider records.
Closed-window fingerprints remain identical in the later capture. All 174 retained setup and load signatures verify independently.
Every altered message fails verification. The candidate has 107 matching claims, running jobs, publications, and settlements.
All eight temporary Workers remain private and active for the fair parallel-refill prototype explicitly requested after this comparison.
They will be deleted after that follow-up. No new credential upload or production deployment is part of this checkpoint.
The inherited bloat threshold remains 13,992 Rust duplicated lines against 13,754. No cryptographic source change is made here.
