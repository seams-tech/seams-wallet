# ML-DSA fair refill on Cloudflare

The two measured configurations exceed seven verified signatures per minute across four wallets, including complete reserve restoration.
The fair-refill prototype shortens the observed depleted-wallet restoration from 87.590 to 38.863 seconds.
These finite screens meet the six–seven-signature throughput target under the explicit benchmark policy.
They establish no production capacity ceiling or consistent five-second signing guarantee.

## Scope

Both windows use the same four canonical FIPS ML-DSA-65 keys, recovered through wallet-seed derivation.
Preparation stays on Workers. Each wallet holds thirty-two candidates and requires sixteen ready candidates before admission.
Jobs prepare four candidates, with existing bounded two-candidate top-ups. Signing consumes two candidates at a time.
Both configurations use two producer slots, one signing slot, and a thirty-second benchmark wallet cooldown.
The prototype permits idle-slot borrowing by one depleted wallet and corrects overdue refill scheduling.
No cryptographic kernel, seed derivation, export format, circuit identity, or sealed persistence format changes.

Production defaults remain one producer slot and a sixty-second wallet cooldown.
Four wallets under that cooldown have a four-operation-per-minute admission ceiling.
The previous forty-five-second workload offered at most 5.33 demands/minute. This workload offers at most eight.
The higher measured rate therefore does not establish a cryptographic speedup over the earlier five-signature campaign.

Cloudflare durable drivers call the private Router through a forwarding Worker.
Measurements exclude the public Gateway, SDK, browser network, login, human approval, NEAR submission, and finality.

## Complete-cycle comparison

| Metric | Serial per wallet | Fair idle-slot borrowing |
| --- | ---: | ---: |
| Requested load | 12 min | 12 min |
| Independently verified signatures | 93 | 94 |
| Complete-cycle signatures/minute | 7.313 | 7.621 |
| Full reserve observed after cutoff | 43.063 s | 20.078 s |
| Fresh and consumed candidates | 466 | 502 |
| Captured preparation CPU | 1,052.346 s | 1,029.543 s |
| Four-candidate preparation checkpoint median | 9.019 s | 8.071 s |
| Final successful Router call median | 1.100 s | 1.162 s |
| Final successful Router call maximum | 4.298 s | 7.699 s |
| Successful calls below five seconds | 93/93 | 93/94 |
| Complete demand median, including waits | 9.049 s | 20.678 s |
| Below-minimum stock responses (`empty_pool`) | 0 | 15 |
| Failed or declined signing operations | 0 | 0 |

Every starting pair is consumed. Both cases restore exact matching sixteen-pair reserves at A and B.
The serial ledger is 64 initial + 233 fresh = 233 consumed + 64 final pairs.
The prototype ledger is 64 initial + 251 fresh = 251 consumed + 64 final pairs.
No pair serves two operations. All 143 serial and 141 prototype jobs have matching claims, executions, publications, and settlements.
One serial demand and two prototype demands remain censored at the cutoff, without live signing authority.
Their requests and costs remain in the evidence.

The complete-cycle rate rises by about 4.2% in this comparison.
The prototype consumes more candidates, while its measured CPU per candidate falls from 2.258 to 2.051 seconds.
Four-candidate invocation CPU also differs. Job mix, execution conditions, and random rejection outcomes prevent isolated code-speedup attribution.
A faster final call does not imply a shorter complete user wait.

## Deliberately depleted wallet

Each control retires sixteen unused pairs for one wallet while the other three reserves remain unchanged.
Exactly eight four-candidate jobs replace them with sixteen distinct fresh pairs.

| Metric | Serial | Prototype |
| --- | ---: | ---: |
| Depletion through observed paired restoration | 87.590 s | 38.863 s |
| Distinct producers | 1 | 2 |
| Maximum overlapping cryptographic lifetimes | 1 | 2 |
| Selected paired invocation CPU | 76.244 s | 62.784 s |

The observed restoration time falls by 55.6%.
The prototype demonstrably uses both producers for the same wallet.
Overlapping lifetimes do not prove simultaneous physical CPU execution.
The different invocation CPU costs also contribute to the comparison. This is not an isolated scheduling-speedup percentage.

The earlier commentary used 88.6 seconds for serial whole-script elapsed and 38.9 seconds for prototype restoration.
The matching restoration boundaries are 87.590 and 38.863 seconds, as reported above.

## Remaining waits

The fifteen stock responses affect three operations. These pools contain material, but remain below the eight-pair admission minimum.

| Operation | Preceding signature consumes | Paired stock | First stock response through successful result |
| --- | ---: | ---: | ---: |
| Wallet 0, first case | 10 pairs / 20 candidates | 6, then 8 | 6.623 s |
| Wallet 0, second case | 5 pairs / 10 candidates | 7, then 9 | 8.425 s |
| Wallet 3 | 6 pairs / 12 candidates | 7, then 9 | 12.411 s |

Refill remains active and restores admission capacity. Two cases share the service with another wallet's refill.
The second case also acquires a borrowed slot before its earlier producer publishes.
The evidence supports rejection pressure and bounded shared refill capacity. It shows no dropped refill in these cases.
The last operation also receives service-capacity backpressure after material returns.
Its 12.411-second span includes capacity and signing waits, rather than preparation alone.

The private benchmark caps admission retry intervals at five seconds.
The public Gateway already caps service-capacity retries at 500 milliseconds. The SDK honors that result.
These complete-demand timings therefore cannot be presented as public SDK timings.

## Qualification and cleanup

Independent standard verification accepts all 187 signatures and rejects all 187 altered messages.
Actual producer versions match the deployment receipts. Every selected job executes cryptographic work once per role.
The final authoritative check finds zero pending preparation jobs across all four wallets.

The serial and prototype windows contain 133 and 129 provider events marked canceled.
They contain no cryptographic starts or exceptions and total six and three milliseconds of CPU.
Some carry queue receipts for jobs that later complete. These events do not establish failed preparation.
Their exact cancellation cause remains unknown. All captured costs remain in the comparison.

The archive keeps every complete invocation whose metadata/wall envelope or log timestamps intersect the continuous experiment interval.
It keeps unknown-time invocations and does not filter by status, version, or success.
The resulting 28,798 provider records preserve the original closed-window fingerprints.
Both analyses and job qualifications reproduce exactly from this final capture.

All eight temporary Workers are deleted. Independent queries confirm all eight are absent.
No new credentials or destinations were required for this comparison.
The archive scan checks the synthetic credential values and their encodings before publication.
The inherited bloat failure remains 13,992 Rust duplicated lines against 13,754, without a baseline change.

[Replayable evidence](../evidence/ml-dsa-65-fair-refill-hosted-20261030.json) records the archive hash and detailed results.
Extract its archive and run `python3 replay.py` with Python 3 and Node.js with ML-DSA support.
Replay verifies member hashes, rebuilds provider records, reproduces both analyses, and verifies every signature without network access.

## Next high-impact work

1. Measure sustained public Gateway/SDK traffic with its existing retry cadence, including below-minimum material waits.
2. Test independent participant CPU execution with fixed public workloads before changing private protocol routing.
3. Optimize the largest remaining measured preparation cost. Avoid repeating rejected AES and encoder experiments without a new profile.
4. Revisit registration and per-pair signing overhead when traces identify a material remaining cost.

Keep the same per-wallet reserve. Preserve wallet-seed recovery, canonical export, participant separation, and single use.
